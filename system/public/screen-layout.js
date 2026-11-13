import {GuestTiles,screenSoundButton,syncScreenSound} from './guest-tiles.js';
import {fullscreenToolbar} from './stage-controls.js';
import {preferLowLatency} from './rtc.js';
import {screenLimit} from './screen-quality.js';
import {readPreference,writePreference} from './call-comfort.js';
import {FloatingScreens,mirrorPlayer,mirrorVideo} from './view-popouts.js';
export class ScreenLayouts{
  constructor({hostScreens,clientScreens,hostCamera,clientCamera,guestTiles,hostSources,mediaControls,nativeCommand,quality,hostShareList,removeShare,cursors,notify}){
    Object.assign(this,{hostScreens,clientScreens,hostCamera,clientCamera,guestTiles,hostSources,nativeCommand,quality,hostShareList,removeShare,cursors});this.queued=false;this.nativeViews=new Map();this.nativeQueues=new Map();
    this.root=document.createElement('section');this.root.id='hostScreenWatch';this.root.hidden=true;this.root.className='host-screen-watch';
    this.root.innerHTML='<div class="host-watch-heading"><h3>In the call</h3><button class="button small-button" data-watch-fullscreen><svg class="icon" aria-hidden="true"><use href="#i-expand"/></svg> Fullscreen</button></div><div id="hostSharedViews" class="guest-view-selector"><label for="hostSharedView">View</label><select id="hostSharedView"></select></div><div id="hostWatchStage" class="video-stage host-watch-stage" tabindex="0"><video muted playsinline autoplay></video></div>';
    document.querySelector('#hostSessionContent').prepend(this.root);const stage=this.root.querySelector('.video-stage'),views=this.root.querySelector('.guest-view-selector'),video=stage.querySelector('video');
    this.handoffNotice=document.querySelector('#handoffNotice');this.handoffHome=document.createComment('Host switch status');this.handoffNotice.before(this.handoffHome);
    const heading=this.root.querySelector('.host-watch-heading');
    new ResizeObserver(()=>this.schedule()).observe(heading);
    fullscreenToolbar(stage,document.querySelector('#hostToolbar'));
    this.previewOptions=document.querySelector('.call-preview-options');this.optionsHome=document.createComment('Local preview options');this.previewOptions.before(this.optionsHome);
    this.previewButton=document.querySelector('#hostMonitorToggle');this.previewHome=document.createComment('Local preview control');this.previewButton.before(this.previewHome);
    this.streamerButton=document.createElement('button');this.streamerButton.type='button';this.streamerButton.className='button small-button';this.streamerButton.textContent='Streamer view';this.streamerButton.title='Put cameras in movable corner overlays';this.previewButton.before(this.streamerButton);this.streamerButton.onclick=()=>{this.compact=false;this.tiles.setLayout('streamer');this.schedule();};
    this.floating=new FloatingScreens({notify,side:'host',attach:(source,video,note)=>{
      if(source.id==='host-main')return mirrorPlayer(document.querySelector('#hostPreview'),video,note);
      if(source.stream)return mirrorVideo(video,note,source.stream);
      const existing=this.tiles.tiles.get(source.id)?.video;
      if(existing)return mirrorPlayer(existing,video,note);
      return this.attachNative(source.id,video,note);
    },changed:()=>{this.floatButton.textContent=this.floating.entries.size?'Close pop-out':'Pop out';}});
    this.tiles=new GuestTiles({stage,video,views,side:'host',mediaControls,subscriptions:{attach:(id,video,note)=>this.attachNative(id,video,note)},selectView:()=>{},openFloating:source=>this.floating.open(source).catch(()=>notify('Could not open the pop-out window.'))});
    const float=document.createElement('button');float.type='button';float.className='button small-button';float.textContent='Pop out';
    this.floatButton=float;this.root.querySelector('.host-watch-heading').append(float);
    float.onclick=()=>{
      const screens=this.tiles.sources.filter(source=>!this.tiles.isCamera(source));
      if(this.floating.entries.size){this.floating.clear();return;}
      this.floating.open(screens,{mode:this.tiles.maximized===null?this.tiles.mode:'single',featured:this.tiles.maximized ?? this.tiles.featured,remember:this.tiles.maximized===null}).catch(()=>notify('Could not open the pop-out window.'));
    };
    this.tiles.preferred=readPreference('hostViewLayout','grid');this.tiles.mode=this.tiles.preferred;views.addEventListener('click',()=>writePreference('hostViewLayout',this.tiles.preferred));views.addEventListener('click',()=>this.schedule());
    const expand=document.createElement('button');expand.type='button';expand.id='hostExpandCall';expand.className='button small-button';expand.textContent='Call view';expand.onclick=()=>{this.compact=false;this.schedule();};this.streamerButton.before(expand);
    this.empty=document.createElement('div');this.empty.className='host-call-empty';stage.append(this.empty);
    this.compactRoster=document.createElement('section');this.compactRoster.className='host-compact-roster';this.compactRoster.hidden=true;this.compactRoster.setAttribute('aria-labelledby','hostCompactRosterTitle');
    const rosterHeader=document.createElement('div');rosterHeader.className='host-compact-roster-heading';
    const rosterTitle=document.createElement('h3');rosterTitle.id='hostCompactRosterTitle';rosterTitle.textContent='In the call';
    const rosterAction=document.createElement('button');rosterAction.type='button';rosterAction.className='button small-button';rosterAction.innerHTML='<svg class="icon" aria-hidden="true"><use href="#i-people"/></svg> People';
    rosterAction.onclick=()=>document.querySelector('#hostCallPeople').click();
    rosterHeader.append(rosterTitle,rosterAction);this.compactRoster.append(rosterHeader);
    this.roster=document.createElement('div');this.roster.className='host-call-avatars';
    document.querySelector('#hostNextStep').after(this.compactRoster);
    this.pendingReplies = document.createElement('button');
    this.pendingReplies.type = 'button';
    this.pendingReplies.className = 'button small-button host-pending-replies';
    this.pendingReplies.hidden = true;
    this.pendingReplies.onclick = () => document.querySelector('#hostReplyFile').click();
    stage.before(this.pendingReplies);
    this.shareStrip=document.createElement('div');this.shareStrip.id='hostShareStrip';this.shareStrip.className='host-share-strip';this.shareStrip.setAttribute('aria-label','Your shared screens');this.root.append(this.shareStrip);
    this.previewSettings=document.createElement('button');this.previewSettings.type='button';this.previewSettings.className='button small-button';this.previewSettings.id='hostPreviewCallSettings';
    this.previewSettings.innerHTML='<svg class="icon" aria-hidden="true"><use href="#i-settings"/></svg> Settings';
    this.previewSettings.hidden=true;expand.after(this.previewSettings);
    this.previewSettings.onclick=()=>document.dispatchEvent(new CustomEvent('screen-quality-settings',{detail:{side:'host',trigger:this.previewSettings}}));
    const compact=document.createElement('button');compact.type='button';compact.id='hostSmallPreview';compact.className='button small-button';compact.textContent='Small preview';compact.title='Return to the small local preview';compact.onclick=async()=>{if(document.fullscreenElement===stage)await document.exitFullscreen();this.tiles.setLayout('single');this.compact=true;this.schedule();};this.root.querySelector('.host-watch-heading').append(compact);
    this.previewNote=document.createElement('span');this.previewNote.className='host-preview-note';this.previewNote.hidden=true;this.root.querySelector('.host-watch-heading h3').after(this.previewNote);
    this.root.querySelector('[data-watch-fullscreen]').onclick=()=>document.querySelector('#hostCallFullscreen').click();
    this.limits=document.createElement('details');this.limits.className='advanced screen-call-limits';this.limits.id='hostScreenLimits';this.limits.innerHTML='<summary>Guest screen limits</summary><div class="screen-quality-fields"><label class="field-label">Maximum size<select data-screen-limit="height"><option value="360">360p</option><option value="480">480p</option><option value="720">720p</option><option value="1080">1080p</option><option value="1440">1440p</option><option value="2160" selected>4K</option></select></label><label class="field-label">Maximum frame rate<select data-screen-limit="fps"><option value="15">15 fps</option><option value="30">30 fps</option><option value="60">60 fps</option><option value="120" selected>120 fps</option></select></label><label class="field-label">Upload budget per sharer<select data-screen-limit="bitrate"><option value="2000000">2 Mb/s</option><option value="4000000">4 Mb/s</option><option value="8000000">8 Mb/s</option><option value="12000000">12 Mb/s</option><option value="20000000">20 Mb/s</option><option value="40000000" selected>40 Mb/s</option></select></label></div><p class="small muted">Live ceilings for guest screen shares. Each guest can choose lower settings. Camera and main host-stream settings stay separate.</p>';
    document.querySelector('#hostMediaPermissions').append(this.limits);
    const savedLimits=readPreference('hostScreenLimits');if(savedLimits)this.hostScreens().setLimits(screenLimit(savedLimits));
    for(const select of this.limits.querySelectorAll('select'))select.onchange=()=>{this.hostScreens().setLimits(Object.fromEntries([...this.limits.querySelectorAll('select')].map(select=>[select.dataset.screenLimit,Number(select.value)])));writePreference('hostScreenLimits',this.hostScreens().sessionLimit);};
    document.addEventListener('expand-host-call',()=>{this.compact=false;this.refresh();});
    new MutationObserver(()=>this.schedule()).observe(document.querySelector('#peerList'),{childList:true,subtree:true,attributes:true,attributeFilter:['data-connection','data-controllers']});
    for(const event of ['call-media-change','call-share-ready','app-mode','host-shares-change','appearance-change'])document.addEventListener(event,()=>this.schedule());
    window.addEventListener('resize',()=>this.schedule());
    document.addEventListener('fullscreenchange',()=>this.schedule());
    for(const id of ['hostPreview','hostPreviewToggle','hostPreviewAutoPause']){const el=document.getElementById(id);if(el?.tagName==='VIDEO'){el.addEventListener('loadedmetadata',()=>this.schedule());el.addEventListener('emptied',()=>this.schedule());}else el?.addEventListener('change',()=>this.schedule());}
    this.schedule();
  }
  schedule(){if(this.queued)return;this.queued=true;requestAnimationFrame(()=>{this.queued=false;this.refresh();});}
  refresh(){
    const guest=this.clientScreens(),host=this.hostScreens();
    this.guestTiles.setScreens(guest.ready?guest.sources():[]);
    if(this.guestTiles.liveScreens.length && !this.guestTiles.screenSources.length && !this.guestTiles.active)this.guestTiles.selectSingle(this.guestTiles.liveScreens[0]);
    const limit=screenLimit(host.sessionLimit);for(const select of this.limits.querySelectorAll('select'))select.value=String(limit[select.dataset.screenLimit]);
    const ownSources=host.ready?this.hostSources():[],sources=host.ready?[...ownSources,...host.sources()]:[],cameras=host.ready?this.hostCamera().sources():[],active=host.ready && document.querySelector('#hostPanel').dataset.session==='active';
    if(!active)this.compact=false;
    if((!active || document.body.dataset.mode!=='host') && document.fullscreenElement===this.root.querySelector('.host-watch-stage'))document.exitFullscreen().catch(()=>{});
    const expanded=active && !this.compact;this.root.hidden=!expanded;this.compactRoster.hidden=!active || expanded;document.body.dataset.hostCallView=active?expanded?'call':'compact':'setup';
    const heading=this.root.querySelector('.host-watch-heading');
    if(expanded && document.body.dataset.mode==='host'){
      if(this.handoffNotice.parentElement!==heading)heading.querySelector('h3').after(this.handoffNotice);
    }else if(this.handoffNotice.previousSibling!==this.handoffHome)this.handoffHome.after(this.handoffNotice);
    this.previewSettings.hidden=!active || expanded;
    if(expanded)this.floating.updateSources(sources);else this.floating.clear();
    this.floatButton.hidden=!sources.length;
    this.streamerButton.disabled=!active || !(sources.length || cameras.length);document.querySelector('#hostExpandCall').disabled=!active;
    this.previewNote.hidden=!active || !this.hostShareList().length || !!ownSources.length;const previewText=document.querySelector('#hostPreviewToggle').checked?'Your screen preview is paused · guests can still watch':'Your screen preview is hidden · guests can still watch';if(this.previewNote.textContent!==previewText)this.previewNote.textContent=previewText;
    this.renderShares(active);if(active)this.previewButton.hidden=!this.hostShareList().length;
    if(!expanded){if(active)this.renderRoster(this.compactRoster);if(this.previewOptions.parentElement!==this.optionsHome.parentElement)this.optionsHome.after(this.previewOptions);this.cursors?.mount(document.querySelector('#hostStage'),()=>document.querySelector('#hostPreview'));const peek=this.root.querySelector('.chat-peek');if(peek)document.querySelector('#hostStage').append(peek);this.tiles.clear();if(this.previewButton.parentElement!==this.previewHome.parentElement)this.previewHome.after(this.previewButton);return;}
    const optionsParent=document.fullscreenElement===this.root.querySelector('.host-watch-stage')?document.fullscreenElement:heading;if(this.previewOptions.parentElement!==optionsParent)optionsParent.append(this.previewOptions);if(this.previewButton.parentElement!==heading)heading.append(this.previewButton);this.previewButton.textContent=document.querySelector('#hostPreviewToggle').checked?'Hide my screen':'Show my screen';
    this.tiles.setScreens(sources);this.tiles.setCameras(cameras);
    if(!this.tiles.active && this.tiles.sources.length){this.tiles.localSingle=this.tiles.featured || this.tiles.sources[0].id;this.tiles.render();}
    this.cursors?.mount(this.root.querySelector('.host-watch-stage'),()=>this.tiles.tiles.get('host-main')?.video || document.querySelector('#hostPreview'));
    this.empty.hidden=!!(sources.length || cameras.length);if(!this.empty.hidden)this.renderRoster(this.empty);
    const pendingNames = this.empty.hidden ? [...document.querySelectorAll('#peerList [data-waiting-for-reply="true"] .peer-info')].map(label => label.firstChild?.textContent || 'Guest') : [];
    this.pendingReplies.hidden = !pendingNames.length;
    if (pendingNames.length) {
      const note = `Waiting for ${pendingNames.join(', ')} to reply. Drop a reply file here or click to open.`;
      if (this.pendingReplies.textContent !== note) this.pendingReplies.textContent = note;
    }
    const peek=document.querySelector('#hostMonitor .chat-peek') || this.root.querySelector('.chat-peek');if(peek && peek.parentElement!==this.root.querySelector('.host-watch-stage'))this.root.querySelector('.host-watch-stage').append(peek);
    const stage=this.root.querySelector('.host-watch-stage'),bar=document.querySelector('#hostToolbar').getBoundingClientRect();
    const height=Math.max(160,(bar.height?bar.top-14:innerHeight-20)-(stage.getBoundingClientRect().top+scrollY)-(this.shareStrip.hidden?0:this.shareStrip.getBoundingClientRect().height+12));
    stage.style.setProperty('--host-watch-height',`${height}px`);
  }
  renderRoster(container){
    if(this.roster.parentElement!==container)container.append(this.roster);
    const people = [{ id: 'host', name: 'You', state: 'Host' }];
    for (const row of document.querySelectorAll('#peerList .peerRow')) {
      const waitingForReply = row.dataset.waitingForReply === 'true';
      const connection = row.dataset.connection;
      let state = 'Connecting…';
      if (waitingForReply) state = 'Waiting for reply file';
      else if (connection === 'connected') {
        const controllers = Number(row.dataset.controllers) || 0;
        state = controllers ? `${controllers} ${controllers===1?'controller':'controllers'}` : 'Connected';
      }
      else if (connection === 'failed' || connection === 'closed') state = 'Disconnected';
      else if (connection === 'disconnected') state = 'Reconnecting…';
      people.push({ id: row.dataset.peerId, name: row.querySelector('.peer-info')?.firstChild?.textContent || 'Guest', state, waitingForReply });
    }
    const key=JSON.stringify(people);if(this.roster.dataset.people===key)return;this.roster.dataset.people=key;this.roster.replaceChildren();
    for (const person of people) {
      const tile = document.createElement('div');
      tile.className = 'host-call-person';
      const avatar = document.createElement('span');
      avatar.className = 'avatar';
      avatar.textContent = person.name.slice(0, 1).toUpperCase();
      const name = document.createElement('strong');
      name.textContent = person.name;
      const state = document.createElement('span');
      state.className = 'host-call-person-status';
      state.textContent = person.state;
      tile.append(avatar, name, state);
      if (person.waitingForReply) {
        const reply = document.createElement('button');
        reply.type = 'button';
        reply.className = 'button small-button host-call-reply';
        reply.textContent = 'Open reply';
        reply.onclick = () => document.querySelector('#hostReplyFile').click();
        tile.append(reply);
      }
      this.roster.append(tile);
    }
  }
  renderShares(active){
    const sources=active?this.hostShareList():[],key=JSON.stringify(sources.map(s=>[s.id,s.label]));this.shareStrip.hidden=!sources.length;
    if(this.shareStrip.dataset.sources===key){for(const [index,source] of sources.entries())syncScreenSound(this.shareStrip.children[index].querySelector('.share-chip-sound'),source);return;}
    this.shareStrip.dataset.sources=key;this.shareStrip.replaceChildren();
    for(const source of sources){
      const card=document.createElement('div');card.className='host-share-chip';
      const label=document.createElement('span');label.textContent=source.label;
      const settings=document.createElement('button');settings.type='button';settings.className='button small-button share-chip-quality';
      settings.setAttribute('aria-label',`Stream quality for ${source.label}`);settings.title='Stream quality';
      settings.innerHTML='<svg class="icon" aria-hidden="true"><use href="#i-settings"/></svg>';
      settings.onclick=()=>document.dispatchEvent(new CustomEvent('screen-quality-settings',{detail:{side:'host',sourceId:source.id,trigger:settings}}));
      const remove=document.createElement('button');remove.type='button';remove.className='button small-button';remove.textContent='×';
      remove.setAttribute('aria-label',`Stop sharing ${source.label}`);remove.onclick=()=>this.removeShare(source.id);
      const sound=screenSoundButton(()=>this.hostShareList().find(item=>item.id===source.id)?.toggleSound?.(),'button small-button share-chip-sound');
      syncScreenSound(sound,source);
      card.append(label,settings,sound,remove);this.shareStrip.append(card);
    }
  }
  attachNative(id,video,note){
    const sourceId=id.startsWith('host-')?id.slice(5):null;if(!sourceId || !this.nativeCommand)return ()=>{};
    const entry={cancelled:false,pc:null};this.nativeViews.set(video,entry);
    entry.setup=(this.nativeQueues.get(sourceId) || Promise.resolve()).catch(()=>{}).then(async()=>{if(entry.cancelled)return;try{const offer=await this.nativeCommand('native-offer','preview',{sourceId,quality:{...this.quality(sourceId),codec:'h264'}});if(entry.cancelled)return;
      const pc=entry.pc=new RTCPeerConnection({iceServers:[]});pc.onicecandidate=e=>{if(e.candidate && !entry.cancelled)this.nativeCommand('native-ice','preview',{sourceId,candidate:e.candidate.toJSON()}).catch(()=>{});};
      pc.ontrack=e=>{if(entry.cancelled || e.track.kind!=='video')return;preferLowLatency(e.receiver);video.srcObject=new MediaStream([e.track]);video.play().catch(()=>{});video.onloadeddata=()=>{if(entry.cancelled)return;note.hidden=true;this.nativeCommand('native-ready','preview',{sourceId}).catch(()=>{});};};
      await pc.setRemoteDescription(offer.sdp);await pc.setLocalDescription(await pc.createAnswer());if(!entry.cancelled)await this.nativeCommand('native-answer','preview',{sourceId,sdp:pc.localDescription});
    }catch{if(!entry.cancelled)note.textContent='Preview unavailable · guests can still watch.';}});this.nativeQueues.set(sourceId,entry.setup);
    return ()=>{entry.cancelled=true;entry.pc?.close();video.srcObject=null;this.nativeViews.delete(video);const cleanup=entry.setup.catch(()=>{}).then(()=>this.nativeCommand('native-close','preview',{sourceId}).catch(()=>{}));this.nativeQueues.set(sourceId,cleanup);cleanup.finally(()=>{if(this.nativeQueues.get(sourceId)===cleanup)this.nativeQueues.delete(sourceId);});};
  }

}
