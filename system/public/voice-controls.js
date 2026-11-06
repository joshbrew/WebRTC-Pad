import {readPreference,writePreference} from './call-comfort.js';
export const voiceVolume = (master, member=1) => Math.max(0,Math.min(1,Number(master)*Number(member)));
export function extraVoiceControls(room) {
  const root=document.createElement('div');root.className='voice-extra-controls';
  root.innerHTML='<div class="voice-talk-row"><label class="check-row"><input data-extra="ptt" type="checkbox" /> Push to talk</label><button data-extra="key" type="button" class="button small-button" title="Change push-to-talk key">Right Alt</button></div><p class="voice-focus-note small muted">Talk key works while this app is focused.</p><p data-extra="hint" class="small muted" role="status"></p><label class="check-row voice-duck-option"><input data-extra="duck" type="checkbox" /> Lower game sound during speech</label><div data-extra="members" class="voice-member-levels" aria-label="Participant volume"></div>';
  room.root.querySelector('details').append(root);const $=name=>root.querySelector(`[data-extra="${name}"]`);let code='AltRight',pressed=false,listening=false,meterTimer,context,ducked=false,gate;
  const levels=new Map(),volumes=new Map();
  const keyLabel=value=>value.replace(/^Key/,'').replace(/Right$/,' (right)').replace(/Left$/,' (left)');
  const savedKey=readPreference('voice:talkKey');if(typeof savedKey==='string' && /^[A-Za-z][A-Za-z0-9]{0,31}$/.test(savedKey))code=savedKey;
  $('key').textContent=keyLabel(code);$('key').setAttribute('aria-label','Talk key: '+keyLabel(code));$('ptt').checked=readPreference('voice:ptt',false)===true;$('duck').checked=readPreference('voice:duck',false)===true;
  function apply(){const privateTest=room.preparing && !room.ready,enabled=!!room.mic && !room.muted && (privateTest || room.canSpeak() && (!$('ptt').checked || pressed));for(const track of room.mic?.getAudioTracks() || [])track.enabled=enabled;gate=enabled;}
  function updateVolumes(){for(const p of room.peers.values())if(p.audio)p.audio.volume=voiceVolume(room.$('volume').value,volumes.get(p.id) ?? 1);}
  function setDuck(value){if(ducked===value)return;ducked=value;room.root.dispatchEvent(new CustomEvent('voice-duck',{detail:value ? 0.35 : 1,bubbles:true}));}
  function clearMeters(){clearInterval(meterTimer);meterTimer=null;for(const meter of levels.values())meter.source.disconnect();levels.clear();context?.close().catch(()=>{});context=null;setDuck(false);}
  function meters(){
    if(!room.active || room.host || !$('duck').checked){clearMeters();return;}if(meterTimer)return;
    try{context=new AudioContext();context.resume().catch(()=>{});}catch{return;}
    let hold=0;meterTimer=setInterval(()=>{
      for(const [id,meter] of levels)if(id!=='self' && !room.peers.has(id) || id==='self' && meter.stream!==room.mic){meter.source.disconnect();levels.delete(id);}
      const streams=[...room.peers.values()].filter(p=>p.audio?.srcObject && !p.audio.muted && p.audio.volume>0).map(p=>[p.id,p.audio.srcObject]);if(room.mic)streams.push(['self',room.mic]);
      for(const [id,stream] of streams)if(!levels.has(id))try{const source=context.createMediaStreamSource(stream),analyser=context.createAnalyser();analyser.fftSize=256;source.connect(analyser);levels.set(id,{source,analyser,stream,data:new Float32Array(256)});}catch{}
      let talking=false;for(const [id,meter] of levels){if(id==='self' && !gate)continue;if(id!=='self' && (!room.peers.get(id)?.audio || room.peers.get(id).audio.muted || room.peers.get(id).audio.volume===0))continue;meter.analyser.getFloatTimeDomainData(meter.data);if(Math.sqrt(meter.data.reduce((sum,v)=>sum+v*v,0)/meter.data.length)>.025)talking=true;}
      if(talking)hold=Date.now()+400;setDuck(Date.now()<hold);
    },100);
  }
  $('key').onclick=()=>{listening=true;$('key').classList.add('is-listening');$('hint').textContent='Press a talk key. Escape cancels.';};
  window.addEventListener('keydown',event=>{
    if(listening){event.preventDefault();event.stopImmediatePropagation();listening=false;$('key').classList.remove('is-listening');if(event.code!=='Escape'){code=event.code;writePreference('voice:talkKey',code);$('key').textContent=keyLabel(code);$('key').setAttribute('aria-label','Talk key: '+keyLabel(code));}$('hint').textContent='';pressed=false;apply();return;}
    if(event.code===code && $('ptt').checked && room.active && room.mic && !event.target.closest('input,textarea,select,[contenteditable=true]')){event.preventDefault();event.stopImmediatePropagation();pressed=true;apply();}
  },true);
  window.addEventListener('keyup',event=>{if(event.code===code){pressed=false;apply();}},true);
  window.addEventListener('blur',()=>{pressed=false;listening=false;$('key').classList.remove('is-listening');$('hint').textContent='';apply();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){pressed=false;apply();}});
  $('ptt').onchange=()=>{writePreference('voice:ptt',$('ptt').checked);pressed=false;listening=false;$('key').classList.remove('is-listening');apply();$('hint').textContent='';};$('duck').onchange=()=>{writePreference('voice:duck',$('duck').checked);meters();};
  return {apply,updateVolumes,render(){apply();updateVolumes();$('duck').closest('label').hidden=room.host;meters();const members=$('members'),ids=new Set(room.peers.keys());for(const row of [...members.children])if(!ids.has(row.dataset.peer))row.remove();for(const p of room.peers.values())if(![...members.children].some(row=>row.dataset.peer===p.id)){const row=document.createElement('label');row.className='voice-member-level';row.dataset.peer=p.id;const name=document.createElement('span');name.textContent=p.id==='host'?'Host':'Guest '+(room.roster.findIndex(m=>m.id===p.id)+1);const slider=document.createElement('input');slider.type='range';slider.min=0;slider.max=1;slider.step=.05;slider.value=volumes.get(p.id) ?? 1;slider.setAttribute('aria-label',name.textContent+' volume');const output=document.createElement('output');output.textContent=Math.round(Number(slider.value)*100)+'%';slider.oninput=()=>{volumes.set(p.id,Number(slider.value));output.textContent=Math.round(Number(slider.value)*100)+'%';updateVolumes();};row.append(name,slider,output);members.append(row);}},stop(){pressed=false;listening=false;$('key').classList.remove('is-listening');$('hint').textContent='';clearMeters();if(!room.ready)volumes.clear();apply();},rebase(mapping){for(const [id,value] of [...volumes]){volumes.delete(id);if(mapping[id])volumes.set(mapping[id],value);}clearMeters();}};
}
