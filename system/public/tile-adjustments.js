import {readPreference,writePreference} from './call-comfort.js';
import {syncMediaControls} from './media-controls.js';
export const clampUnit=(value,fallback=.98)=>Number.isFinite(value)?Math.max(0,Math.min(1,value)):fallback;
export function splitTracks(tracks,index,delta,minimum=48){
  const next=[...tracks],total=next[index]+next[index+1],floor=Math.min(minimum,total/3);
  next[index]=Math.max(floor,Math.min(total-floor,next[index]+delta));next[index+1]=total-next[index];return next;
}
const tracks=(element,axis)=>getComputedStyle(element)[axis==='x'?'gridTemplateColumns':'gridTemplateRows'].split(' ').map(parseFloat).filter(Number.isFinite);
const weights=value=>Array.isArray(value) && value.length<=34 && value.every(v=>Number.isFinite(v) && v>0)?value:null;
export class TileAdjustments{
  constructor(tiles){
    this.tiles=tiles;this.key=`tileGeometry:${tiles.side}`;const saved=readPreference(this.key,{});
    this.saved=saved && typeof saved==='object' && !Array.isArray(saved)?saved:{};this.handles=new Map();
    this.observer=new ResizeObserver(()=>this.refresh());for(const element of [tiles.root,tiles.strip,tiles.cameraStrip])this.observer.observe(element);
  }
  persist(){this.saved=Object.fromEntries(Object.entries(this.saved).slice(-64));writePreference(this.key,this.saved);}
  reset(){this.saved={};this.persist();this.tiles.render();}
  overlay(entry,source){
    if(this.tiles.mode!=='streamer'){if(entry.overlay){entry.overlay.video.srcObject=null;entry.overlay.box.remove();entry.overlay=null;}return;}
    const owner=typeof source.owner==='string'?source.owner:'host',camera=this.tiles.cameras.find(c=>c.owner===owner),key=`pip:${source.id || 'main'}`;
    if(!entry.overlay){
      const box=document.createElement('div');box.className='streamer-camera';box.tabIndex=0;box.setAttribute('role','group');box.setAttribute('aria-roledescription','Movable camera overlay');
      const video=document.createElement('video');video.muted=true;video.autoplay=true;video.playsInline=true;const avatar=document.createElement('span');avatar.className='streamer-avatar';avatar.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="8" r="4"/><path d="M4 22v-2a8 8 0 0 1 16 0v2"/></svg>';
      const size=document.createElement('button');size.type='button';size.className='streamer-resize';size.setAttribute('aria-label','Resize camera overlay');size.title='Drag to resize · arrow keys also work';size.innerHTML='<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 13 9-9M8 13l5-5" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
      box.append(video,avatar,size);entry.tile.append(box);entry.overlay={box,video,avatar,size};
      for(const event of ['click','dblclick','pointerdown','pointermove','pointerup','pointercancel','wheel','keydown','keyup'])box.addEventListener(event,e=>e.stopPropagation());
      const change=(position,save=false)=>{this.saved[key]=position;this.position(entry,position);if(save)this.persist();};
      const initial=()=>this.saved[key] || {x:.98,y:.98};
      box.addEventListener('dblclick',event=>{event.preventDefault();delete this.saved[key];this.persist();this.position(entry,{});});
      box.addEventListener('keydown',event=>{if(event.target!==box || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home'].includes(event.key))return;event.preventDefault();if(event.key==='Home'){delete this.saved[key];this.persist();this.position(entry,{});return;}const p=initial();change({...p,x:clampUnit(p.x)+(event.key==='ArrowLeft'?-.03:event.key==='ArrowRight'?.03:0),y:clampUnit(p.y)+(event.key==='ArrowUp'?-.03:event.key==='ArrowDown'?.03:0)},true);});
      const begin=(event,resizing)=>{
        if(event.button!==0)return;event.preventDefault();event.stopPropagation();const target=resizing?size:box,p={...initial()},bounds=entry.tile.getBoundingClientRect(),rect=box.getBoundingClientRect(),startX=event.clientX,startY=event.clientY,mode=this.tiles.mode;target.setPointerCapture(event.pointerId);
        const move=e=>{if(this.tiles.mode!==mode)return;const dx=e.clientX-startX,dy=e.clientY-startY;
          if(resizing){const ratio=rect.width/rect.height,delta=Math.abs(dx)>=Math.abs(dy*ratio)?dx:dy*ratio;change({...p,width:Math.max(Math.min(64/bounds.width,.8),Math.min(.65,(rect.width+delta)/bounds.width))});}
          else change({...p,x:clampUnit(clampUnit(p.x)+dx/Math.max(1,bounds.width-rect.width-16)),y:clampUnit(clampUnit(p.y)+dy/Math.max(1,bounds.height-rect.height-16))});
        };
        const end=()=>{target.removeEventListener('pointermove',move);target.removeEventListener('lostpointercapture',end);this.persist();};target.addEventListener('pointermove',move);target.addEventListener('lostpointercapture',end,{once:true});
      };
      box.addEventListener('pointerdown',e=>{if(!e.target.closest('button'))begin(e,false);});size.addEventListener('pointerdown',e=>begin(e,true));
      size.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();event.stopPropagation();const p=initial(),width=box.getBoundingClientRect().width/Math.max(1,entry.tile.clientWidth);change({...p,width:Math.max(.08,Math.min(.65,width+(['ArrowLeft','ArrowDown'].includes(event.key)?-.025:.025)))},true);});
    }
    const {box,video,avatar}=entry.overlay;box.dataset.camera=String(!!camera);box.setAttribute('aria-label',`${source.label} ${camera?'camera':'avatar'} · drag to move`);box.title='Drag to move · drag corner to resize · double-click to reset';avatar.hidden=!!camera;video.hidden=!camera;
    syncMediaControls(box,this.tiles.mediaControls?.(owner));
    if(video.srcObject!==(camera?.stream || null)){video.srcObject=camera?.stream || null;if(camera)video.play().catch(()=>{});}
    let hash=0;for(const char of owner)hash=(hash*31+char.charCodeAt(0))>>>0;box.style.setProperty('--streamer-accent',`hsl(${hash%360} 50% 72%)`);this.position(entry,this.saved[key] || {});
  }
  position(entry,value){const box=entry.overlay.box;box.style.setProperty('--pip-x',String(clampUnit(value.x)));box.style.setProperty('--pip-y',String(clampUnit(value.y)));box.style.setProperty('--pip-width',String(Number.isFinite(value.width)?Math.max(.08,Math.min(.65,value.width)):box.dataset.camera==='true'?.2:.09));}
  refresh(){
    const t=this.tiles,wanted=new Set();if(!t.active || t.root.hidden){for(const h of this.handles.values())h.remove();this.handles.clear();return;}
    for(const [name,element] of [['main',t.root],['strip',t.strip],['cameras',t.cameraStrip]]){
      element.style.gridTemplateColumns='';element.style.gridTemplateRows='';if(element.hidden || !element.clientWidth || !element.clientHeight)continue;
      const defaults={x:tracks(element,'x'),y:tracks(element,'y')};const signature=`${t.mode}:${name}:${defaults.x.length}x${defaults.y.length}`,saved=this.saved[signature] || {};
      for(const axis of ['x','y']){
        const property=axis==='x'?'gridTemplateColumns':'gridTemplateRows',values=weights(saved[axis]);if(values?.length===defaults[axis].length)element.style[property]=values.map(v=>`minmax(0,${v}fr)`).join(' ');
        const sizes=tracks(element,axis);if(name==='main' && axis==='x' && sizes.length)element.style.setProperty('--last-screen-width',`${sizes[0]}px`);if(sizes.length<2)continue;
        const style=getComputedStyle(element),padding=parseFloat(axis==='x'?style.paddingLeft:style.paddingTop)||0,gap=parseFloat(axis==='x'?style.columnGap:style.rowGap)||0;let offset=padding;
        for(let i=0;i<sizes.length-1;i++){
          offset+=sizes[i]+gap;const id=`${signature}:${axis}:${i}`;wanted.add(id);let h=this.handles.get(id);
          if(!h){h=document.createElement('div');h.className=`tile-divider tile-divider-${axis}`;h.tabIndex=0;h.setAttribute('role','separator');h.setAttribute('aria-orientation',axis==='x'?'vertical':'horizontal');h.setAttribute('aria-label',`Resize ${name==='main'?'screen':name==='strip'?'featured strip':'camera'} ${axis==='x'?'columns':'rows'}`);h.title='Drag to resize · arrow keys also work';element.append(h);this.handles.set(id,h);
            const update=(sizes,delta,save)=>{const next=splitTracks(sizes,i,delta),sum=next.reduce((a,b)=>a+b,0);this.saved[signature]={...this.saved[signature],[axis]:next.map(v=>v/sum)};this.refresh();if(save)this.persist();};
            h.onpointerdown=e=>{if(e.button!==0)return;e.preventDefault();e.stopPropagation();h.setPointerCapture(e.pointerId);const initial=tracks(element,axis),at=axis==='x'?e.clientX:e.clientY;h.classList.add('dragging');const move=event=>{event.stopPropagation();update(initial,(axis==='x'?event.clientX:event.clientY)-at,false);};const end=()=>{h.classList.remove('dragging');h.removeEventListener('pointermove',move);this.persist();};h.addEventListener('pointermove',move);h.addEventListener('lostpointercapture',end,{once:true});};
            h.onkeydown=e=>{e.stopPropagation();if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();update(tracks(element,axis),['ArrowLeft','ArrowUp'].includes(e.key)?-20:20,true);};for(const event of ['pointerup','pointermove','click','dblclick','wheel','keyup'])h.addEventListener(event,e=>e.stopPropagation());
          }
          h.style[axis==='x'?'left':'top']=`${offset-gap/2-4}px`;h.setAttribute('aria-valuenow',String(Math.round(sizes[i]/(sizes[i]+sizes[i+1])*100)));h.setAttribute('aria-valuemin','0');h.setAttribute('aria-valuemax','100');
        }
      }
    }
    for(const [id,h] of this.handles)if(!wanted.has(id)){h.remove();this.handles.delete(id);}
  }
}
