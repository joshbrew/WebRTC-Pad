// Small call helpers. No capture starts and no permission is remembered here.
const $=selector=>document.querySelector(selector);
const node=(tag,text,className)=>{const el=document.createElement(tag);if(text)el.textContent=text;if(className)el.className=className;return el;};
const key=name=>`webrtc-pad:preference:${name}`;
export function readPreference(name,fallback=null){try{const value=JSON.parse(localStorage.getItem(key(name)));return value===null?fallback:value;}catch{return fallback;}}
export function writePreference(name,value){try{localStorage.setItem(key(name),JSON.stringify(value));}catch{/* Preferences are optional. */}}
export function rememberControls(root,prefix,fields){
  for(const name of fields){const el=root.querySelector(`[data-${prefix}="${name}"]`);if(!el)continue;const saved=readPreference(`${prefix}:${name}`);
    if(el.type==='checkbox'){if(typeof saved==='boolean')el.checked=saved;}
    else if(typeof saved==='string' && (el.tagName!=='SELECT' || [...el.options].some(o=>o.value===saved)))el.value=saved;
    el.addEventListener('change',()=>writePreference(`${prefix}:${name}`,el.type==='checkbox'?el.checked:el.value));
  }
}
export function restoreDevice(select,name){const value=readPreference(name,select.value);if(typeof value==='string' && [...select.options].some(o=>o.value===value))select.value=value;}
export function guestCaption({state,count=0,detected=0,enabled=true,wantsController=true,setupRequired=false}){
  if(state==='new')return 'Waiting for reply';
  if(state==='disconnected')return 'Reconnecting · player spots kept';
  if(state==='failed')return 'Connection lost';
  if(state!=='connected')return state==='closed'?'Disconnected':'Connecting…';
  if(!count)return !wantsController?'Watching':setupRequired?'Guest controller setup needed':!enabled?'Controller sharing paused':detected?`${detected} controller${detected===1?'':'s'} detected · not joined`:'Waiting for a controller';
  return `${count} controller${count===1?'':'s'} ${enabled?'playing':'paused'}`;
}
export function mediaCaption({camera=false,mic=false,voice=false}={}){
  return `${camera===true?'Camera sharing':'Camera off'} · ${mic===true?'Mic on':voice===true?'Mic muted':'Mic off'}`;
}
export function controllersReady(peers,{desktopControl=false}={}){
  const connected=peers.filter(peer=>peer.state==='connected');
  return connected.length>0 && connected.every(peer=>!peer.error && (peer.wantsController===false || peer.count>0 || desktopControl));
}
export function accessCaption({scope='none',mouse=false,keyboard=false,pointers=false}={}){
  if(mouse || keyboard)return `${scope==='window'?'Window control':'Desktop control'} · ${[mouse?'system mouse':'',keyboard?'typing':''].filter(Boolean).join(' + ')}${pointers?' · colored cursors':''}`;
  return pointers?'Guest cursors only · no desktop control':'Desktop control off · guest cursors off';
}
export function readiness(state){
  if(state.side==='host')return [
    {label:'Controllers',value:state.driver===true?'Ready':state.driver===false?'Setup needed':'Checked when room starts',fix:state.driver===false?'driverStatus':null,level:state.driver===false?'attention':state.driver===true?'ready':'optional'},
    {label:'Picture',value:state.picture?'Ready':state.audioOnly?'Audio only':'Optional · controllers only',level:state.picture?'ready':'optional',fix:!state.picture && !state.audioOnly?'hostSourceSetup':null},
    {label:'Game audio',value:state.audio?'Ready':state.picture?'No audio captured':'Optional',level:state.audio?'ready':'optional',fix:state.picture && !state.audio?'hostSourceSetup':null}
  ];
  return [
    {label:'Connection',value:state.connected?'Ready':'Open an invite to connect',level:state.connected?'ready':'optional',fix:state.connected?null:'joinFocus'},
    {label:'Controllers',value:state.count?`${state.count} detected`:'Press a button to detect · keyboard also available',level:state.count?'ready':'optional',fix:'clientCallControllers'},
    {label:'Picture & sound',value:state.picture?'Receiving':state.connected?'Waiting for host · optional':'Provided by your host · optional',level:state.picture?'ready':'optional'}
  ];
}
// Retain ownership, but never retain a held key/button during a network gap.
export class ReconnectGrace{
  constructor({waiting=()=>{},recovered=()=>{},expired=()=>{},duration=15000}={}){Object.assign(this,{waiting,recovered,expired,duration});}
  update(state){
    if(state==='disconnected'){
      if(this.timer || this.exhausted)return;
      this.waiting();this.timer=setTimeout(()=>{this.timer=null;this.exhausted=true;this.expired();},this.duration);
    }else if(state==='connected'){
      const gap=!!this.timer || this.exhausted;this.stop();if(gap)this.recovered();
    }else if(state==='closed'){this.stop();}
    else if(state==='failed'){const gap=!!this.timer;this.stop();if(gap)this.expired();}
  }
  stop(){clearTimeout(this.timer);this.timer=null;this.exhausted=false;}
}
const finite=(value,max)=>typeof value==='number' && Number.isFinite(value)?Math.max(0,Math.min(max,value)):null;
export function cleanGuestView(value){
  if(!value || typeof value!=='object')return null;
  const image=typeof value.image==='string' && value.image.length<14000 && /^data:image\/jpeg;base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.image)?value.image:null;
  const metrics=Object.fromEntries(['width','height','fps','bufferMs','decodeMs','rttMs','mbps'].map(k=>[k,finite(value.metrics?.[k],k==='width' || k==='height'?16384:10000)]));
  return {image,metrics,audio:{receiving:value.audio?.receiving===true,muted:value.audio?.muted===true,blocked:value.audio?.blocked===true,loss:finite(value.audio?.loss,1),jitterMs:finite(value.audio?.jitterMs,5000)},capturedAt:Date.now()};
}
// Standard-gamepad drawing for the live test. Buttons keep browser-standard indices (0–16).
const PAD_NAMES=['Bottom','Right','Left','Top','LB','RB','LT','RT','Select','Start','L3','R3','Up','Down','Left','Right','Home'];
const PAD_SVG='<svg class="pad-live" viewBox="0 0 260 150" role="img" aria-label="Live controller buttons and sticks">'
  +'<path class="pad-trigger" d="M54 20 Q56 6 72 5 H86 Q96 6 96 20 Z"/><path class="pad-trigger-fill" data-trigger="6" d="M54 20 Q56 6 72 5 H86 Q96 6 96 20 Z"/>'
  +'<path class="pad-trigger" d="M164 20 Q164 6 174 5 H188 Q204 6 206 20 Z"/><path class="pad-trigger-fill is-right" data-trigger="7" d="M164 20 Q164 6 174 5 H188 Q204 6 206 20 Z"/>'
  +'<rect class="pad-key pad-bumper" data-button="4" x="52" y="21" width="48" height="10" rx="5"/><rect class="pad-key pad-bumper" data-button="5" x="160" y="21" width="48" height="10" rx="5"/>'
  +'<path class="pad-body" d="M70 34 C95 28 165 28 190 34 C214 40 226 60 236 100 C242 124 236 144 220 144 C208 144 200 136 190 122 L176 106 H84 L70 122 C60 136 52 144 40 144 C24 144 18 124 24 100 C34 60 46 40 70 34 Z"/>'
  +'<g class="pad-dpad"><rect class="pad-key" data-button="12" x="63" y="50" width="14" height="15" rx="3"/><rect class="pad-key" data-button="13" x="63" y="75" width="14" height="15" rx="3"/><rect class="pad-key" data-button="14" x="48" y="63" width="15" height="14" rx="3"/><rect class="pad-key" data-button="15" x="77" y="63" width="15" height="14" rx="3"/><rect class="pad-dpad-hub" x="63" y="63" width="14" height="14"/></g>'
  +'<g class="pad-face"><circle class="pad-key" data-button="3" cx="190" cy="54" r="8"/><circle class="pad-key" data-button="2" cx="174" cy="70" r="8"/><circle class="pad-key" data-button="1" cx="206" cy="70" r="8"/><circle class="pad-key" data-button="0" cx="190" cy="86" r="8"/></g>'
  +'<rect class="pad-key pad-small" data-button="8" x="105" y="56" width="16" height="7" rx="3.5"/><rect class="pad-key pad-small" data-button="9" x="139" y="56" width="16" height="7" rx="3.5"/>'
  +'<circle class="pad-key pad-home" data-button="16" cx="130" cy="80" r="7"/>'
  +'<circle class="pad-stick-well" cx="100" cy="106" r="17"/><circle class="pad-stick-ring" data-button="10" cx="100" cy="106" r="17"/>'
  +'<circle class="pad-stick-well" cx="160" cy="106" r="17"/><circle class="pad-stick-ring" data-button="11" cx="160" cy="106" r="17"/>'
  +'<line class="pad-stick-line" data-stick-line="0" x1="100" y1="106" x2="100" y2="106"/><line class="pad-stick-line" data-stick-line="1" x1="160" y1="106" x2="160" y2="106"/>'
  +'<circle class="pad-stick" data-stick="0" data-cx="100" data-cy="106" cx="100" cy="106" r="9"/><circle class="pad-stick" data-stick="1" data-cx="160" data-cy="106" cx="160" cy="106" r="9"/>'
  +'</svg>';
export function addControllerTest(item){
  const test=node('details',null,'pad-live-test'),summary=node('summary','Test');test.append(summary);
  test.innerHTML+='<div class="pad-live-body">'+PAD_SVG+'<p class="small muted" data-pad-reading aria-live="polite">Press buttons or move sticks to test.</p></div>';
  item.append(test);
}
const liveTestElements=new WeakMap();
export function updateLiveTests(root,rows,pads,keyboard){
  if(document.hidden || !root.getClientRects().length)return;
  for(const item of root.querySelectorAll('.connected-controller')){
    const test=item.querySelector('.pad-live-test');if(!test?.open)continue;
    let elements=liveTestElements.get(test);if(!elements){elements={buttons:[...test.querySelectorAll('[data-button]')],sticks:[...test.querySelectorAll('[data-stick]')],lines:[...test.querySelectorAll('[data-stick-line]')],triggers:[...test.querySelectorAll('[data-trigger]')],reading:test.querySelector('[data-pad-reading]')};liveTestElements.set(test,elements);}
    const row=rows.find(r=>r.id===item.dataset.controllerId),pad=row?.pad?pads.find(p=>p?.index===row.pad.index && p.id===row.pad.id):null;
    const state=row?.id==='keyboard'?keyboard:null;
    const pressed=[];
    for(const el of elements.buttons){const index=Number(el.dataset.button),active=pad?.buttons[index]?.pressed===true || (pad?.buttons[index]?.value || 0)>.1;el.classList.toggle('is-pressed',active);if(active)pressed.push(PAD_NAMES[index] || `Button ${index+1}`);}
    for(const el of elements.triggers){const value=Math.max(0,Math.min(1,pad?.buttons[Number(el.dataset.trigger)]?.value || 0)).toFixed(2);if(el.style.getPropertyValue('--v')!==value)el.style.setProperty('--v',value);}
    for(const el of elements.sticks){
      const i=Number(el.dataset.stick),x=Math.max(-1,Math.min(1,pad?.axes[i*2] || 0)),y=Math.max(-1,Math.min(1,pad?.axes[i*2+1] || 0));
      const cx=Number(el.dataset.cx || (i?151:88))+x*10,cy=Number(el.dataset.cy || 81)+y*10;
      for(const [name,value] of [['cx',cx.toFixed(1)],['cy',cy.toFixed(1)]])if(el.getAttribute(name)!==value)el.setAttribute(name,value);
      el.classList.toggle('is-moved',Math.hypot(x,y)>.15);
      const line=elements.lines[i];if(line){line.setAttribute('x2',cx.toFixed(1));line.setAttribute('y2',cy.toFixed(1));}
    }
    const text=state?'Keyboard test: focus the picture and press your mapped keys.':pad?pressed.length?`Pressed: ${pressed.join(', ')}`:'Move sticks or press a button.':'Controller disconnected.';
    const reading=elements.reading;if(reading.textContent!==text)reading.textContent=text;
  }
}
export function initCallComfort({getState,voice,showSettings,notify,report,refreshPicture,onInputFocus=()=>{}}){
  const roots=new Map();let previous=null,feedbackReady=false,context,previousMic=new Map(),lastJoined=0;
  const audioContext=()=>context ||= new (window.AudioContext || window.webkitAudioContext)();
  function tone(kind='join'){
    if(!readPreference('callSounds',true) || document.hidden)return;
    try{const ac=audioContext();if(ac.state!=='running')return;const gain=ac.createGain(),osc=ac.createOscillator(),now=ac.currentTime;gain.gain.setValueAtTime(.035,now);gain.gain.exponentialRampToValueAtTime(.001,now+.14);osc.frequency.setValueAtTime(kind==='leave'?420:660,now);osc.frequency.linearRampToValueAtTime(kind==='leave'?300:880,now+.12);osc.connect(gain).connect(ac.destination);osc.start();osc.stop(now+.15);osc.onended=()=>{osc.disconnect();gain.disconnect();};}catch{/* Optional feedback. */}
  }
  const wake=event=>{if(readPreference('callSounds',true) || voice('host').mic || voice('client').mic || event?.target?.closest('[id$=CallMic],[data-voice=join],[data-voice=mic]'))try{audioContext().resume().catch(()=>{});}catch{}};document.addEventListener('pointerdown',wake,{passive:true});document.addEventListener('keydown',event=>{if(event.key==='Enter' || event.key===' ')wake(event);});
  function focus(id){if(id==='hostSourceSetup' && !$('#hostAudioOnly').checked)id=$('#captureBackend').value==='native'?'captureTarget':'chooseBrowserSource';const el=$(`#${id}`);if(!el)return;document.dispatchEvent(new CustomEvent('reveal-call-setting',{detail:el}));if(el.closest('.call-sheet') && !el.closest('.call-sheet').open)showSettings(document.body.dataset.mode || 'host');for(let p=el.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;el.scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});if(!el.matches('button,input,select,textarea,a'))el.tabIndex=-1;el.focus({preventScroll:true});if(['clientCallControllers','joinFocus','chooseBrowserSource'].includes(id))el.click();else if(id==='captureTarget')try{el.showPicker?.();}catch{/* Focus remains on the source selector. */}}
  for(const side of ['host','client']){
    const root=node('div',null,'call-preflight');root.id=`${side}Preflight`;root.setAttribute('aria-label','Controller setup');root.hidden=true;
    if(side==='host')$('#hostCreate').after(root);else $('#clientPairing').after(root);roots.set(side,root);
    if(side==='host'){const invite=root.cloneNode();invite.id='hostInvitePreflight';$('#hostInviteCard').prepend(invite);}
    const settings=$(`#${side}SettingsSheet .call-sheet-content`),options=node('div',null,'comfort-options');
    const check=node('label',null,'check-row'),checkbox=node('input');checkbox.type='checkbox';checkbox.checked=readPreference('callSounds',true);checkbox.id=`${side}CallSounds`;check.append(checkbox,document.createTextNode(' Join and leave sounds'));options.append(check);
    checkbox.onchange=()=>{writePreference('callSounds',checkbox.checked);for(const el of document.querySelectorAll('[id$=CallSounds]'))el.checked=checkbox.checked;if(checkbox.checked){wake();tone();}};
    const sound=node('button','Play test sound','button small-button');sound.id=`${side}TestSound`;sound.type='button';sound.onclick=async()=>{try{const ac=audioContext();await ac.resume();const gain=ac.createGain(),osc=ac.createOscillator(),now=ac.currentTime;gain.gain.setValueAtTime(.07,now);gain.gain.exponentialRampToValueAtTime(.001,now+.35);osc.frequency.value=660;osc.connect(gain).connect(ac.destination);osc.start();osc.stop(now+.35);osc.onended=()=>{osc.disconnect();gain.disconnect();};notify('Test sound played through the browser’s output.');}catch{notify('Sound is blocked. Allow sound in your browser and try again.');}};options.append(sound);settings.querySelector('[data-settings-pane=voice]').append(options);
    const meter=node('div',null,'voice-meter'),label=node('label','Microphone level'),bar=node('meter');bar.min=0;bar.max=1;bar.value=0;bar.id=`${side}MicLevel`;bar.dataset.micLevel='true';label.htmlFor=bar.id;meter.append(label,bar);voice(side).root.querySelector('.voice-actions').after(meter);

  }
  const recovery=node('div',null,'call-reconnecting');const recoveryText=node('span'),recoveryHelp=node('button','Open a new invite','button small-button');recoveryHelp.onclick=()=>$('#joinFocus').click();recovery.append(recoveryText,recoveryHelp);recovery.id='callReconnecting';recovery.hidden=true;recovery.setAttribute('role','status');$('#clientStage').append(recovery);
  document.addEventListener('call-recovery',event=>{const state=event.detail;recovery.hidden=state==='connected' || state==='closed';recoveryHelp.hidden=state!=='expired';const hosted=document.body.dataset.sessionInvites==='true' && document.body.dataset.sessionGuestFiles!=='true';recoveryHelp.textContent=hosted?'Join again':'Open a new invite';recoveryText.textContent=state==='expired'?'Connection lost. Rejoin to continue.':'Reconnecting… Controllers are paused; player spots are kept.';});
  const trouble=node('dialog');trouble.id='callTroubleshooting';trouble.className='comfort-help';trouble.innerHTML='<div class="section-heading"><h2>Having trouble?</h2><button class="help-button" data-help="close" aria-label="Close help">×</button></div><div class="trouble-choices" role="group" aria-label="What needs fixing?"><button class="button" data-topic="connection">Connection</button><button class="button" data-topic="picture">Picture &amp; sound</button><button class="button" data-topic="controls">Controls</button></div><p data-help="advice"></p><div class="row"><button class="button secondary" data-help="fix">Open settings</button><button class="button small-button" data-help="save">Save diagnostic file</button></div><p class="small muted">The file excludes addresses, connection secrets, device names, messages and input contents.</p>';
  document.body.append(trouble);for(const type of ['pointerdown','pointermove','pointerup','wheel','keydown','keyup'])trouble.addEventListener(type,event=>event.stopPropagation());trouble.addEventListener('focusin',onInputFocus);let topic='connection';
  function help(next=topic){topic=next;const state=getState(),connected=state.side==='host'?state.guests>0:state.connected,pairing=state.links?'Send the session link and approve the guest’s request.':'Send the invite, then open the guest’s reply on the host.';for(const button of trouble.querySelectorAll('[data-topic]'))button.setAttribute('aria-pressed',String(button.dataset.topic===topic));
    const notes={connection:connected?`The call is connected. A brief interruption can recover automatically. If it stays disconnected, keep both apps open. ${state.links?'Rejoin through the session link.':'Exchange fresh invite/reply text or files.'} A relay may be needed on some networks.`:`Keep both apps open. ${pairing} ${state.links?'Check invitation server status in Settings if requests are not arriving.':'If fresh files still fail, check the relay settings with Connection help.'}`,picture:state.audioOnly?'This is an audio-only session. Turn sound on and check the host’s audio source. Refresh sound if playback stops.':state.side==='host'?'Check your preview first. Check guest view shows a small snapshot of their received picture. For missing sound, check the captured audio source; browser sharing needs audio approval in its picker.':'Turn the stream and sound on. If playback is blocked, press the sound button. Try Refresh picture before reconnecting the whole call; lower your maximum picture size if it stutters.',controls:state.side==='client' && !state.canPlay?'This invite is for watching. Ask the host for a Play invite to use controllers. You can still set up your button mappings in Controllers.':state.side==='host'?'Ask each guest to press a button on every controller they want to use. Their cards show whether they are playing, paused or watching. Assign the virtual controllers in your game’s own settings.':'Focus this app and press a controller button to detect it. Open Controllers to test buttons and sticks or choose Map. Keyboard players choose Use keyboard & mouse as a controller. Local input blocking is optional.'};trouble.querySelector('[data-help=advice]').textContent=notes[topic];trouble.querySelector('[data-help=fix]').textContent=topic==='controls'?'Open controllers':topic==='picture'?(state.side==='client'?state.audioOnly?'Refresh sound':'Refresh picture':'Open screen & audio'):'Open connection settings';}
  trouble.querySelector('[data-help=close]').onclick=()=>trouble.close();for(const button of trouble.querySelectorAll('[data-topic]'))button.onclick=()=>help(button.dataset.topic);
  trouble.querySelector('[data-help=fix]').onclick=()=>{trouble.close();const state=getState();if(topic==='controls')state.side==='client'?$('#clientCallControllers').click():focus('peerList');else if(topic==='picture' && state.side==='client')refreshPicture();else{showSettings(state.side);focus(state.side==='host'?(topic==='picture'?'hostSourceSetup':'hostNetworkSettings'):'clientNetworkGuide');}};
  trouble.querySelector('[data-help=save]').onclick=async event=>{const button=event.currentTarget;button.disabled=true;try{await report(getState().side,topic);}finally{button.disabled=false;}};
  function openHelp(){help();if(!trouble.open){onInputFocus();trouble.showModal();}}
  for(const side of ['host','client']){const button=node('button','Having trouble?','button small-button');button.id=`${side}Troubleshoot`;button.onclick=openHelp;$(`#${side}SettingsSheet .call-settings-footer`).append(button);}
  const guideHelp=node('button','Having trouble?','button small-button');guideHelp.onclick=()=>{$('#closeHelp').click();openHelp();};$('#helpDialog .tour-footer').append(guideHelp);
  document.addEventListener('fullscreenchange',()=>{if(document.fullscreenElement===$('#clientStage'))$('#clientStage').append(trouble);else document.body.append(trouble);});
  let metered=new Map();
  function stopMeter(side){const meter=metered.get(side);if(meter){meter.source.disconnect();meter.analyser.disconnect();metered.delete(side);}voice(side).root.querySelector('[data-mic-level]').value=0;}
  function updateMeters(){
    for(const side of ['host','client']){const room=voice(side),bar=room.root.querySelector('[data-mic-level]'),visible=!document.hidden && room.root.getClientRects().length && room.mic && !room.muted;
      if(!visible){stopMeter(side);continue;}
      try{const stream=room.mic;let meter=metered.get(side);if(meter?.stream!==stream){stopMeter(side);const ac=audioContext();if(ac.state!=='running')continue;const source=ac.createMediaStreamSource(stream),analyser=ac.createAnalyser();analyser.fftSize=256;source.connect(analyser);meter={stream,source,analyser,data:new Uint8Array(256)};metered.set(side,meter);}meter.analyser.getByteTimeDomainData(meter.data);bar.value=Math.min(1,Math.sqrt(meter.data.reduce((sum,n)=>sum+((n-128)/128)**2,0)/meter.data.length)*3);}catch{stopMeter(side);}
    }
  }
  function refresh(){
    if(document.hidden)return;const state=getState();
    // Show only actionable setup problems; optional media is chosen in its source controls.
    const warnings=readiness({...state,side:'host'}).filter(entry=>entry.level==='attention');
    for(const [root,visible] of [[roots.get('host'),state.side==='host' && !state.hosting],[roots.get('client'),false],[$('#hostInvitePreflight'),state.side==='host' && state.hosting]]){
      root.hidden=!visible || !warnings.length;if(root.hidden)continue;
      const signature=JSON.stringify(warnings);if(root.dataset.signature===signature)continue;root.dataset.signature=signature;root.replaceChildren();
      for(const entry of warnings){const row=node('div',null,'preflight-row');row.dataset.level='attention';row.append(node('span','Controller support needs setup on this computer.'));const button=node('button','Open controller setup','button small-button');button.onclick=()=>focus(entry.fix);row.append(button);root.append(row);}
    }
    const people=state.guests || 0,joined=state.joined || 0;if(feedbackReady && previous?.hosting && state.hosting && people!==previous.guests){tone(people>previous.guests?'join':'leave');notify(people>previous.guests?'Guest connected':'Guest left');}
    if(feedbackReady && joined>lastJoined){notify(`${joined} controller${joined===1?'':'s'} ready to play`);document.body.classList.remove('controller-joined');requestAnimationFrame(()=>document.body.classList.add('controller-joined'));}
    if(feedbackReady && previous?.side===state.side && state.side==='client' && previous.connected!==state.connected){tone(state.connected?'join':'leave');}
    for(const side of ['host','client']){const room=voice(side),bar=room.root.querySelector('[data-mic-level]');bar.id=`${side}MicLevel`;room.root.querySelector('.voice-meter label').htmlFor=bar.id;const on=!!room.mic && !room.muted;if(previousMic.has(side) && previousMic.get(side)!==on && room.ready)notify(on?'Microphone on':'Microphone muted');previousMic.set(side,on);}
    feedbackReady=true;previous={...state,guests:people};lastJoined=joined;
  }
  const timer=setInterval(refresh,1000),meterTimer=setInterval(updateMeters,100);document.addEventListener('visibilitychange',()=>{if(document.hidden)for(const side of ['host','client'])stopMeter(side);else refresh();});
  window.addEventListener('pagehide',()=>{clearInterval(timer);clearInterval(meterTimer);for(const side of ['host','client'])stopMeter(side);context?.close().catch(()=>{});});refresh();
  return {refresh,openHelp};
}

// User-requested thumbnails only: never continuously send a return video stream.
export class GuestViewCheck{
  constructor({peers,notify}){
    Object.assign(this,{peers,notify});this.root=node('dialog',null,'comfort-help guest-view-check');this.root.id='guestViewCheck';
    this.root.innerHTML='<div class="section-heading"><h2>Check guest view</h2><button class="help-button" data-view="close" aria-label="Close guest view">×</button></div><label class="field-label">Guest<select data-view="guest"></select></label><img data-view="image" alt="Snapshot of the picture received by this guest" hidden /><p data-view="status" class="small" role="status"></p><dl data-view="metrics" class="guest-view-metrics"></dl><button data-view="refresh" class="button secondary">Refresh snapshot</button><p class="small muted">This thumbnail is reduced in size; the readings show the actual stream. Sound readings describe delivery and playback; audio is not sent back. Nothing is saved.</p>';
    document.body.append(this.root);for(const type of ['pointerdown','pointermove','pointerup','wheel','keydown','keyup'])this.root.addEventListener(type,event=>event.stopPropagation());this.$=name=>this.root.querySelector(`[data-view="${name}"]`);
    this.$('close').onclick=()=>{this.clear();this.root.close();};this.$('refresh').onclick=()=>this.request();this.$('guest').onchange=()=>this.request();
    this.root.addEventListener('close',()=>this.clear());this.root.addEventListener('cancel',()=>this.clear());
    this.timer=setInterval(()=>{if(this.root.open && this.peers().get(this.$('guest').value)?.pc.connectionState!=='connected'){this.clear();this.root.close();}},1000);window.addEventListener('pagehide',()=>{clearInterval(this.timer);this.clear();});
  }
  clear(){clearTimeout(this.timeout);clearTimeout(this.cooldown);this.$('refresh').disabled=false;this.pending=null;if(this.imageURL){URL.revokeObjectURL(this.imageURL);this.imageURL=null;}this.$('image').removeAttribute('src');this.$('image').hidden=true;this.$('metrics').replaceChildren();}
  open(id){
    this.clear();const select=this.$('guest');select.replaceChildren();for(const [key,p] of this.peers())if(p.pc.connectionState==='connected')select.add(new Option(p.sessionName || `Guest ${p.diagnosticNumber || ''}`,key));
    if(!select.options.length){this.notify('Connect a guest to check their view.');return;}select.value=id || select.options[0].value;if(!this.root.open)this.root.showModal();this.request();
  }
  request(){
    const wait=1600-(performance.now()-(this.requestAt ?? -Infinity));if(wait>0){this.$('refresh').disabled=true;this.$('status').textContent='Refreshing shortly…';clearTimeout(this.cooldown);this.cooldown=setTimeout(()=>this.request(),wait);return;}
    this.clear();const id=this.$('guest').value,p=this.peers().get(id);if(p?.control?.readyState!=='open' || p.control.bufferedAmount>8192){this.$('status').textContent='Connection is busy. Try again in a moment.';return;}
    this.requestAt=performance.now();this.pending={id,peer:p,request:crypto.randomUUID()};p.control.send(JSON.stringify({type:'guest-view-request',request:this.pending.request}));this.$('status').textContent='Checking their received picture and sound…';this.$('refresh').disabled=true;
    this.timeout=setTimeout(()=>{this.pending=null;this.$('refresh').disabled=false;this.$('status').textContent='No snapshot arrived. The guest may need to update their app, or the connection is busy.';},5000);
  }
  receive(id,p,message){
    if(!this.root.open || this.pending?.id!==id || this.pending.peer!==p || message.request!==this.pending.request)return;
    const value=cleanGuestView(message);if(!value)return;clearTimeout(this.timeout);this.pending=null;this.$('refresh').disabled=false;
    this.$('image').hidden=!value.image;if(value.image){const bytes=Uint8Array.from(atob(value.image.split(',')[1]),c=>c.charCodeAt(0));this.imageURL=URL.createObjectURL(new Blob([bytes],{type:'image/jpeg'}));this.$('image').src=this.imageURL;}
    this.$('image').onerror=()=>{this.$('image').hidden=true;this.$('status').textContent='The guest picture could not be displayed. Refresh the snapshot to try again.';};
    this.$('status').textContent=value.image?'Small preview · latest received frame':'No game picture available. The guest may be using controllers only or have the picture paused.';
    const m=value.metrics,a=value.audio,reading=(number,unit)=>number===null?'—':`${Number(number.toFixed(1))}${unit}`;
    const rows=[['Picture',m.width && m.height?`${m.width} × ${m.height}`:'—'],['Frame rate',reading(m.fps,' fps')],['Buffer',reading(m.bufferMs,' ms')],['Decode',reading(m.decodeMs,' ms')],['Video data',reading(m.mbps,' Mbps')],['Game sound',!a.receiving?'Not receiving':a.muted?'Muted on guest':a.blocked?'Playback paused':'Playing'],['Audio packet loss',a.loss===null?'—':`${(a.loss*100).toFixed(1)}%`],['Audio variation',reading(a.jitterMs,' ms')]];
    const dl=this.$('metrics');dl.replaceChildren();for(const [name,text] of rows){dl.append(node('dt',name),node('dd',text));}
  }
}
