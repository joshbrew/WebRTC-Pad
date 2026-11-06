import {sourcePicker} from './source-picker.js';
const element=(tag,text,className)=>{const node=document.createElement(tag);if(text)node.textContent=text;if(className)node.className=className;return node;};

// Extra views are captured only by explicit host actions. Native encoding starts
// lazily when a guest selects a view or opens its independent video window.
export class HostShares {
  constructor({root,primaryShared=()=>true,nativeAvailable,addNative,removeNative,controlNative,quality,changed,status}){
    Object.assign(this,{primaryShared,nativeAvailable,addNative,removeNative,controlNative,quality,changed,status});this.sources=new Map();this.generation=0;
    this.root=element('details',null,'advanced extra-shares');this.root.id='hostExtraShares';this.root.hidden=true;
    this.root.append(element('summary','Additional screens & windows'));
    this.root.append(element('p','Add views for guests to switch between or open in separate windows. Native windows can also accept mouse and typing when you allow it below.','small muted'));
    const actions=element('div',null,'row');this.add=element('button','Add another screen or window','button secondary');this.add.id='hostAddShare';actions.append(this.add);this.root.append(actions);
    this.picker=element('div');this.picker.hidden=true;
    this.select=element('select');this.select.id='hostExtraSource';this.select.setAttribute('aria-label','Additional window or screen');
    this.confirm=element('button','Add selected view','button secondary');this.confirm.id='hostConfirmShare';
    const browser=element('button','Choose with browser…','button small-button');browser.onclick=()=>this.chooseBrowser();
    this.picker.append(this.select,this.confirm,browser);this.root.append(this.picker);
    this.sourcePicker=sourcePicker(this.select,{refresh:()=>this.loadNativeTargets(),targets:()=>this.targets || [],title:'Choose another window or screen'});
    this.list=element('div',null,'extra-share-list');this.root.append(this.list);root.append(this.root);
    this.add.onclick=()=>this.nativeAvailable()?this.chooseNative():this.chooseBrowser();
    this.confirm.onclick=async()=>{
      const generation=this.generation;this.confirm.disabled=true;
      try{
        const value=await this.addNative(this.select.value);
        if(generation!==this.generation){this.removeNative(value.sourceId).catch(()=>{});return;}
        this.sources.set(value.sourceId,{id:value.sourceId,kind:'native',label:value.target.label,settings:value.target});this.sourcePicker.close();this.picker.hidden=true;this.render();await this.changed();
      }catch(error){this.status(error.message);}finally{this.confirm.disabled=false;}
    };
  }
  setActive(active){this.active=active;this.root.hidden=!active || !this.primaryShared() && !this.sources.size;if(!active)this.clear();}
  get(id){return this.sources.get(id);}
  async chooseNative(){
    this.picker.hidden=false;await this.sourcePicker.open();
  }
  async loadNativeTargets(){
    this.add.disabled=true;const generation=this.generation;
    try{
      const response=await fetch('/capture-targets'),value=await response.json();if(!response.ok)throw new Error(value.error || 'Could not list windows');
      if(generation!==this.generation)return;
      const selected=this.select.value;this.targets=value.targets;
      this.select.replaceChildren(...value.targets.map(target=>new Option(target.label,target.id)));
      if(value.targets.some(target=>target.id===selected))this.select.value=selected;
      this.confirm.disabled=!this.select.options.length;
    }catch(error){this.status(error.message);}finally{this.add.disabled=false;}
  }
  async chooseBrowser(){
    const generation=this.generation;this.add.disabled=true;
    try{
      const q=this.quality(),stream=await navigator.mediaDevices.getDisplayMedia({video:{frameRate:{ideal:q.frameRate || 60,max:q.frameRate || 60}},audio:false});
      if(generation!==this.generation){stream.getTracks().forEach(track=>track.stop());return;}
      const track=stream.getVideoTracks()[0];if(!track){stream.getTracks().forEach(track=>track.stop());return;}
      track.contentHint='motion';const id=crypto.randomUUID();
      this.sources.set(id,{id,kind:'browser',label:track.label || `Screen ${this.sources.size+2}`,stream,settings:track.getSettings()});
      track.onended=()=>this.remove(id);this.picker.hidden=true;this.render();Promise.resolve(this.changed()).catch(error=>this.status(error.message));
    }catch(error){if(error.name!=='NotAllowedError')this.status(error.message);}finally{this.add.disabled=false;}
  }
  async remove(id){
    const source=this.sources.get(id);if(!source)return;
    this.sources.delete(id);source.stream?.getTracks().forEach(track=>track.stop());this.render();
    // Switch viewers before disposing of the selected native capture.
    try{await this.changed();if(source.kind==='native')await this.removeNative(id);}catch(error){this.status(error.message);}
  }
  clear(){
    this.sourcePicker.close();
    this.generation++;const sources=[...this.sources.values()];this.sources.clear();this.picker.hidden=true;
    for(const source of sources){source.stream?.getTracks().forEach(track=>track.stop());if(source.kind==='native')this.removeNative(source.id).catch(()=>{});}
    this.render();
  }
  render(){
    document.dispatchEvent(new Event('host-shares-change'));
    this.root.hidden=!this.active || !this.primaryShared() && !this.sources.size;
    this.list.replaceChildren();
    for(const source of this.sources.values()){
      const row=element('div',null,'extra-share-row'),label=element('span',source.label),remove=element('button','Remove','button small-button');
      remove.setAttribute('aria-label',`Remove shared view ${source.label}`);remove.onclick=()=>this.remove(source.id);row.append(label);
      if(source.kind==='native' && source.settings?.kind==='window' && this.controlNative){
        const control=element('button',source.policy?.desktopMouse?'Stop window control':'Allow window control','button small-button');
        control.dataset.controlSource=source.id;control.setAttribute('aria-pressed',String(source.policy?.desktopMouse===true));
        control.onclick=async()=>{
          const enabled=!source.policy?.desktopMouse;
          control.disabled=true;
          try{const value=await this.controlNative(source.id,enabled);if(this.sources.get(source.id)!==source)return;source.policy=value.policy;this.render();await this.changed();}catch(error){this.status(error.message);control.disabled=false;}
        };row.append(control);const caution=element('p',null,'input-caution');caution.append(element('strong','CAUTION'),element('span','Allow window control lets guests click and type in this window. Typing works only while it is in front. Stop window control revokes access.'));row.append(caution);
      }
      row.append(remove);this.list.append(row);
    }
  }
}

export function guestViewSelector(root,selectView,popout=()=>{}){
  const group=element('div',null,'guest-view-selector');group.id='clientSharedViews';group.hidden=true;
  const label=element('label','Shared view','field-label'),select=element('select');select.id='clientSharedView';label.htmlFor=select.id;
  const note=element('p','Window control is available only when the host allows it. In a tiled layout, select a view before using mouse or typing.','small muted');
  const popouts=element('details');popouts.className='advanced';popouts.id='clientViewPopouts';popouts.append(element('summary','Open views in separate windows'));
  const list=element('div',null,'view-popout-list');popouts.append(list,element('p','Each window streams independently. Pop-out windows are for viewing. Use the main call for mouse and typing.','small muted'));
  group.append(label,select,note,popouts);root.before(group);
  select.onchange=()=>selectView(select.value);
  return {
    update(value){
      const sources=Array.isArray(value?.sources)?value.sources.slice(0,33):[];
      select.replaceChildren(...sources.filter(s=>typeof s?.id==='string' && s.id.length<=80 && typeof s.label==='string').map(s=>new Option(s.label.slice(0,120),s.id)));
      select.value=typeof value?.selected==='string'?value.selected:'';group.hidden=select.options.length<2;note.hidden=!select.value;
      const valid=sources.filter(s=>typeof s?.id==='string' && s.id.length<=80 && typeof s.label==='string');popouts.hidden=!valid.length;
      if(JSON.stringify(valid)!==list.dataset.sources){list.dataset.sources=JSON.stringify(valid);list.replaceChildren(...valid.map(source=>{const button=element('button',`Pop out ${source.label.slice(0,120)}`,'button small-button');button.dataset.sourceId=source.id;button.onclick=()=>popout(source.id);return button;}));}
    },
    clear(){group.hidden=true;select.replaceChildren();}
  };
}
