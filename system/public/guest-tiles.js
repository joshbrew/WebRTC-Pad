import {readPreference,writePreference} from './call-comfort.js';
import {TileAdjustments} from './tile-adjustments.js';
import {syncMediaControls} from './media-controls.js';
const node=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n;};
const layouts=new Set(['single','grid','columns','stacked','focus','streamer']);
export class GuestTiles {
  constructor({stage,video,views,subscriptions,selectView,changed,side='client',mediaControls}){
    Object.assign(this,{stage,video,views,subscriptions,selectView,changed,side,mediaControls});this.mode='single';this.preferenceKey=side==='host'?'hostViewLayout':'viewLayout';this.preferred=readPreference(this.preferenceKey,'single');this.sources=[];this.screenSources=[];this.liveScreens=[];this.cameras=[];this.primary='';this.featured='';this.localSingle='';this.tiles=new Map();
    this.root=node('div');this.root.hidden=true;this.root.className='tile-grid';this.root.id=`${side}TileGrid`;this.strip=node('div');this.strip.className='tile-strip';this.cameraStrip=node('div');this.cameraStrip.className='tile-camera-strip';this.root.append(this.strip,this.cameraStrip);stage.append(this.root);
    const controls=node('div');controls.className='tile-layout-controls';controls.id=`${side}TileControls`;controls.setAttribute('role','toolbar');controls.setAttribute('aria-label','View layout');this.buttons=new Map();
    const icons={streamer:'<rect x="3" y="4" width="18" height="16" rx="2"/><rect x="13" y="12" width="7" height="7" rx="1"/>',single:'<rect x="3" y="4" width="18" height="16" rx="2"/>',grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',columns:'<rect x="3" y="4" width="8" height="16" rx="1"/><rect x="14" y="4" width="7" height="16" rx="1"/>',stacked:'<rect x="3" y="3" width="18" height="7" rx="1"/><rect x="3" y="14" width="18" height="7" rx="1"/>',focus:'<rect x="3" y="4" width="12" height="16" rx="1"/><rect x="18" y="4" width="3" height="6" rx=".5"/><rect x="18" y="14" width="3" height="6" rx=".5"/>'};
    for(const [id,text] of [['single','Single view'],['grid','Grid'],['columns','Side by side'],['stacked','Top and bottom'],['focus','Featured view'],['streamer','Streamer view']]){
      const button=node('button');button.type='button';button.dataset.layout=id;button.title=text;button.setAttribute('aria-label',text);button.setAttribute('aria-pressed',String(id===this.mode));button.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6">${icons[id]}</svg>`;button.onclick=()=>this.setLayout(id);this.buttons.set(id,button);controls.append(button);
    }
    this.adjustments=new TileAdjustments(this);const reset=node('button');reset.type='button';reset.className='tile-layout-reset';reset.setAttribute('aria-label','Reset layouts');reset.title='Reset all layout sizes and camera overlays';reset.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/></svg>';reset.onclick=()=>this.adjustments.reset();controls.append(reset);
    controls.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;const buttons=[...controls.querySelectorAll('button')].filter(button=>!button.disabled && button.getClientRects().length),index=buttons.indexOf(document.activeElement);if(index<0)return;event.preventDefault();event.stopPropagation();buttons[event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowLeft'?-1:1)+buttons.length)%buttons.length]?.focus({preventScroll:true});});
    views.querySelector('label').before(controls);
    this.sharedSelect=views.querySelector('select');this.sharedLabel=views.querySelector('label');
    this.sharedSelect.hidden=true;this.sharedLabel.hidden=true;
    this.swap=node('div');this.swap.className='view-swap-controls';this.swap.id=`${side}ViewSwap`;
    const previous=node('button','‹'),next=node('button','›');this.currentName=node('span');this.currentName.setAttribute('aria-live','polite');
    for(const [button,label,delta] of [[previous,'Previous view',-1],[next,'Next view',1]]){button.type='button';button.className='view-swap-button';button.title=label;button.setAttribute('aria-label',label);button.onclick=()=>{const screens=this.sources.filter(s=>!this.isCamera(s)),index=screens.findIndex(s=>s.id===(this.localSingle || this.primary));const source=screens[(index+delta+screens.length)%screens.length];if(source)this.selectSingle(source);};}
    this.swap.append(previous,this.currentName,next);controls.after(this.swap);
    for(const type of ['pointerdown','pointerup','pointermove','wheel','keydown'])this.swap.addEventListener(type,event=>event.stopPropagation());
    this.home=document.createComment('Shared view controls');views.before(this.home);
    document.addEventListener('fullscreenchange',()=>{if(document.fullscreenElement===stage)stage.append(views);else this.home.after(views);});
    for(const type of ['pointerdown','pointerup','pointermove','wheel','keydown'])controls.addEventListener(type,event=>event.stopPropagation());
  }
  beginSwitch(video=this.video){
    this.finishSwitch();this.switching=true;this.transition=node('div');this.transition.className='view-transition';
    if(video.videoWidth && video.readyState>=2){const canvas=node('canvas'),scale=Math.min(1,1920/video.videoWidth);canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale);try{canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);this.transition.append(canvas);}catch{}}
    const note=node('span','Switching view…');note.setAttribute('role','status');this.transition.append(note);this.stage.append(this.transition);this.stage.classList.add('switching-view');this.switchTimer=setTimeout(()=>this.finishSwitch(),20000);
  }
  finishSwitch(){clearTimeout(this.switchTimer);this.switching=false;this.transition?.remove();this.transition=null;this.stage.classList.remove('switching-view');}
  get active(){return this.mode!=='single' || !!this.localSingle;}
  isCamera(source){return source.kind==='camera' || source.id.startsWith('camera-');}
  setScreens(sources){this.liveScreens=sources;this.update({sources:this.screenSources,selected:this.primary});}
  selectSingle(source){this.mode='single';this.preferred='single';this.featured=source.id;this.localSingle=source.stream?source.id:'';this.render();this.changed?.(this.active,source.id);if(!source.stream)this.selectView?.(source.id);}
  setCameras(sources){this.cameras=sources;this.update({sources:this.screenSources,selected:this.primary});}
  get viewOnly(){return this.active && this.sources.find(s=>s.id===this.featured)?.viewOnly===true;}
  update(value){
    const wasActive=this.active;
    this.screenSources=(value.sources || []).filter(s=>typeof s?.id==='string' && s.id.length<=80 && typeof s.label==='string').slice(0,33);this.sources=[...this.screenSources,...this.liveScreens,...this.cameras];if(this.localSingle && !this.sources.some(s=>s.id===this.localSingle))this.localSingle='';if((this.sources.length>=2 || this.sources.length && this.preferred==='streamer') && this.mode==='single' && layouts.has(this.preferred))this.mode=this.preferred;this.primary=value.selected || '';const oldFeatured=this.featured;
    if(!this.active || !this.sources.some(s=>s.id===this.featured))this.featured=this.sources.find(s=>s.id===this.primary)?.id ?? this.sources[0]?.id ?? '';
    if(this.mode!=='streamer' && !this.screenSources.length && this.sources.length===1 && this.sources[0].stream){this.mode='single';this.localSingle=this.sources[0].id;this.featured=this.localSingle;}
    if(this.sources.length<2 && this.active && this.mode!=='streamer'){this.mode='single';this.render();this.changed?.(this.active,this.featured);}else{this.render();if(this.active && (oldFeatured!==this.featured || !wasActive))this.changed?.(true,this.featured);}
  }
  setLayout(value){
    if(!layouts.has(value))return;if(value==='streamer' && this.isCamera(this.sources.find(s=>s.id===this.featured) || {id:''}))this.featured=this.sources.find(s=>!this.isCamera(s))?.id || '';this.preferred=value;writePreference(this.preferenceKey,value);if(this.mode===value){this.render();return;}
    const local=value==='single' && this.sources.find(s=>s.id===this.featured)?.stream;const keepFeatured=this.active && value==='single' && this.featured!==this.primary && !local && !this.viewOnly;if(keepFeatured)this.beginSwitch(this.surface);else if(value!=='single')this.finishSwitch();this.localSingle=local?this.featured:'';this.mode=value;this.render();this.changed?.(this.active,this.featured);if(keepFeatured)this.selectView?.(this.featured);
  }
  feature(id){if(!this.sources.some(s=>s.id===id))return;this.featured=id;if(this.mode!=='streamer'){this.mode='focus';this.preferred='focus';writePreference(this.preferenceKey,'focus');}this.render();this.changed?.(true,id);}
  get surface(){return this.active?this.tiles.get(this.featured)?.video:this.video;}
  tile(source){
    const tile=node('section');tile.className='view-tile';tile.dataset.sourceId=source.id;tile.setAttribute('aria-label',source.label);
    const button=node('button',source.label);button.type='button';button.className='tile-title';button.title='Make this view larger';button.onclick=()=>{this.feature(source.id);this.stage.focus({preventScroll:true});};
    const video=source.id===this.primary?this.video:node('video');video.autoplay=true;if(video!==this.video)video.muted=true;video.playsInline=true;video.setAttribute('aria-label',source.label);
    const note=node('span','Connecting…');note.className='tile-status';note.setAttribute('role','status');tile.append(video,button,note);
    if(source.remove){const remove=node('button','×');remove.type='button';remove.className='tile-remove';remove.setAttribute('aria-label',`Stop sharing ${source.label}`);remove.onclick=event=>{event.stopPropagation();source.remove();};tile.append(remove);}
    if(source.toggleSound){const sound=node('button');sound.type='button';sound.className='tile-sound';sound.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7"><use href="#i-volume"/><path class="tile-sound-off" d="M3 3 21 21"/></svg>';sound.onclick=event=>{event.stopPropagation();source.toggleSound();};tile.append(sound);}
    tile.addEventListener('click',event=>{if(event.target!==button && source.id!==this.featured){this.feature(source.id);this.stage.focus({preventScroll:true});}});
    for(const type of ['pointerdown','pointerup','pointermove','wheel'])tile.addEventListener(type,event=>{if(source.viewOnly || source.id!==this.featured || event.target===button)event.stopPropagation();});
    const entry={tile,video,button,note,primary:source.id===this.primary};if(source.placeholder){tile.classList.add('camera-backdrop');video.hidden=true;note.hidden=true;entry.detach=()=>{};}else if(source.stream){video.srcObject=source.stream;note.hidden=video.readyState>=2;for(const event of ['loadeddata','playing'])video.addEventListener(event,()=>{if(video.readyState>=2)note.hidden=true;});entry.detach=()=>{video.srcObject=null;};}else if(!entry.primary)entry.detach=this.subscriptions.attach(source.id,video,note);else note.hidden=true;return entry;
  }
  render(){
    this.views.hidden=!this.sources.length;this.stage.dataset.cameraTiles=String(this.active && (this.cameras.length>0 || this.mode==='streamer'));
    for(const [id,button] of this.buttons){button.hidden=this.sources.length<2 && !['single','streamer'].includes(id);button.disabled=id==='streamer' && !this.sources.length;}
    for(const [id,button] of this.buttons)button.setAttribute('aria-pressed',String(id===this.mode));
    this.swap.hidden=this.mode!=='single' || this.sources.filter(s=>!this.isCamera(s)).length<2;this.currentName.textContent=this.sources.find(s=>s.id===(this.localSingle || this.primary))?.label || 'Shared view';this.currentName.title=this.currentName.textContent;
    this.views.classList.toggle('using-tiles',this.active);
    this.stage.classList.toggle('tiled-views',this.active);this.root.hidden=!this.active;this.root.dataset.layout=this.mode;this.sharedLabel.textContent=this.active?'View to feature':'Shared view';
    const displayed=this.mode==='streamer'?(this.sources.some(s=>!this.isCamera(s))?this.sources.filter(s=>!this.isCamera(s)):this.cameras.map(camera=>({id:`backdrop-${camera.id}`,owner:camera.owner,kind:'backdrop',label:camera.label,placeholder:true,viewOnly:true}))):this.mode==='single' && this.localSingle?this.sources.filter(s=>s.id===this.localSingle):this.sources;const wanted=new Set(this.active?displayed.map(s=>s.id):[]);
    for(const [id,tile] of [...this.tiles])if(!wanted.has(id) || tile.primary!==(id===this.primary)){tile.detach?.();if(tile.primary)this.stage.prepend(this.video);if(tile.overlay)tile.overlay.video.srcObject=null;tile.tile.remove();this.tiles.delete(id);}
    if(!this.active){this.adjustments.refresh();this.strip.replaceChildren();if(this.video.srcObject && !this.video.hidden)this.video.play().catch(()=>{});return;}
    const screenCount=displayed.filter(s=>!this.isCamera(s)).length,useRail=this.mode!=='focus' && this.mode!=='single' && screenCount>0 && displayed.some(s=>this.isCamera(s));
    for(const source of displayed){let tile=this.tiles.get(source.id);if(!tile){tile=this.tile(source);this.tiles.set(source.id,tile);}if(source.stream && tile.video.srcObject!==source.stream)tile.video.srcObject=source.stream;tile.button.textContent=source.label;tile.tile.dataset.featured=String(source.id===this.featured);tile.button.setAttribute('aria-pressed',String(source.id===this.featured));
      this.adjustments.overlay(tile,source);
      if(this.isCamera(source))syncMediaControls(tile.tile,this.mediaControls?.(source.owner));
      const sound=tile.tile.querySelector('.tile-sound');if(sound){sound.hidden=!source.audio;sound.classList.toggle('is-muted',source.muted);sound.setAttribute('aria-label',`${source.muted?'Play':'Mute'} ${source.label} sound`);sound.title=sound.getAttribute('aria-label');sound.setAttribute('aria-pressed',String(!source.muted));}
      const parent=this.mode==='focus' && source.id!==this.featured?this.strip:useRail && this.isCamera(source)?this.cameraStrip:this.root;if(tile.tile.parentElement!==parent)parent.append(tile.tile);tile.video.play().catch(()=>{});
    }
    // Keep the grid order stable when returning from a featured layout.
    const order=(parent,entries)=>{let previous=parent===this.root?this.strip:null;for(const entry of entries){const next=previous?previous.nextSibling:parent.firstChild;if(next!==entry.tile)parent.insertBefore(entry.tile,next);previous=entry.tile;}};
    order(this.root,displayed.filter(s=>(this.mode!=='focus' || s.id===this.featured) && (!useRail || !this.isCamera(s))).map(s=>this.tiles.get(s.id)));
    if(this.mode==='focus')order(this.strip,this.sources.filter(s=>s.id!==this.featured).map(s=>this.tiles.get(s.id)));
    for(const tile of this.tiles.values())if(tile.video.paused)tile.video.play().catch(()=>{});
    this.strip.hidden=this.mode!=='focus';this.cameraStrip.hidden=!useRail;this.root.dataset.cameraRail=String(useRail);this.root.dataset.screenCount=String(screenCount);const count=useRail?screenCount:displayed.length,columns=this.mode==='single'?1:this.mode==='columns'?count:this.mode==='stacked'?1:Math.ceil(Math.sqrt(count)),rows=this.mode==='single' || this.mode==='columns'?1:this.mode==='stacked'?count:Math.ceil(count/Math.max(1,columns));this.root.dataset.count=String(displayed.length);this.root.style.setProperty('--tile-count',String(count));this.root.style.setProperty('--tile-columns',String(Math.max(1,columns)));this.root.style.setProperty('--tile-rows',String(Math.max(1,rows)));
    this.sharedSelect.value=this.featured;this.cameraStrip.style.setProperty('--camera-count',String(this.cameras.length));this.adjustments.refresh();
  }
  clear(){this.finishSwitch();this.mode='single';this.localSingle='';this.sources=[];this.screenSources=[];this.liveScreens=[];this.cameras=[];this.primary='';this.featured='';this.render();}
}
