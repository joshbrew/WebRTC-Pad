// One-shot thumbnails are limited to two workers and discarded on closing.
const thumbnailQueue=[];let thumbnailWorkers=0;
function queueThumbnail(job){thumbnailQueue.push(job);pumpThumbnails();}
function pumpThumbnails(){while(thumbnailWorkers<2 && thumbnailQueue.length){const job=thumbnailQueue.shift();thumbnailWorkers++;Promise.resolve().then(job).catch(()=>{}).finally(()=>{thumbnailWorkers--;pumpThumbnails();});}}
export function sourcePicker(select,{refresh,targets=()=>[],title='Choose a window or screen'}={}) {
  const root=document.createElement('div');root.className='source-picker';
  const trigger=document.createElement('button');trigger.type='button';trigger.id=`${select.id}Trigger`;trigger.className='button source-picker-trigger';trigger.setAttribute('aria-label',title);trigger.setAttribute('aria-expanded','false');
  const panel=document.createElement('section');panel.className='source-picker-panel';panel.id=`${select.id}Tiles`;panel.hidden=true;panel.setAttribute('aria-label',title);
  trigger.setAttribute('aria-controls',panel.id);select.before(root);root.append(trigger,panel,select);select.classList.add('source-picker-select');select.tabIndex=-1;select.setAttribute('aria-hidden','true');
  let generation=0,renderGeneration=0,observer,refreshing=null,refreshError='';const urls=new Set(),requests=new Set();
  const clearThumbnails=()=>{renderGeneration++;observer?.disconnect();for(const request of requests)request.abort();requests.clear();for(const url of urls)URL.revokeObjectURL(url);urls.clear();};
  const icon=(parent,name)=>{const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),use=document.createElementNS(svg.namespaceURI,'use');svg.classList.add('icon');svg.setAttribute('aria-hidden','true');use.setAttribute('href',`#i-${name}`);svg.append(use);parent.append(svg);};
  const close=(focus=false)=>{generation++;clearThumbnails();panel.hidden=true;panel.removeAttribute('aria-busy');trigger.setAttribute('aria-expanded','false');if(focus)trigger.focus({preventScroll:true});};
  const render=()=>{
    if(!trigger.firstElementChild){icon(trigger,'share');trigger.append(document.createElement('span'));icon(trigger,'chevron');}
    const current=trigger.querySelector('span'),sourceLabel=select.selectedOptions[0]?.textContent || title;if(current.textContent!==sourceLabel)current.textContent=sourceLabel;trigger.disabled=select.disabled;
    if(panel.hidden)return;
    clearThumbnails();const renderEpoch=renderGeneration;
    observer=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){observer.unobserve(entry.target);entry.target.loadThumbnail?.();}},{root:panel,rootMargin:'100px'});
    panel.replaceChildren();const heading=document.createElement('div');heading.className='source-picker-heading';const label=document.createElement('strong');label.textContent=title;const reload=document.createElement('button');reload.type='button';reload.className='button small-button';const busy=panel.getAttribute('aria-busy')==='true';reload.textContent=busy?'Refreshing…':'Refresh';reload.disabled=busy;reload.onclick=()=>open();heading.append(label,reload);panel.append(heading);
    if(busy || refreshError){const status=document.createElement('p');status.className='small muted source-picker-status';status.setAttribute('role','status');status.textContent=busy?'Refreshing windows and screens…':refreshError;panel.append(status);}
    const all=targets();
    for(const kind of ['none','desktop','window']){
      const options=[...select.options].filter(option=>kind==='none'?option.value==='none':all.some(target=>target.id===option.value && target.kind===kind));if(!options.length)continue;
      if(kind!=='none'){const title=document.createElement('h4');title.textContent=kind==='desktop'?'Screens':'Windows';panel.append(title);}
      const grid=document.createElement('div');grid.className='source-picker-grid';
      for(const option of options){
        const target=all.find(value=>value.id===option.value),button=document.createElement('button');button.type='button';button.className='source-tile';button.disabled=option.disabled;button.setAttribute('aria-pressed',String(option.value===select.value));button.dataset.sourceId=option.value;
        const preview=document.createElement('div');preview.className='source-preview';icon(preview,kind==='none'?'close':'share');button.append(preview);
        if(target && panel.getAttribute('aria-busy')!=='true'){
        preview.loadThumbnail=()=>queueThumbnail(async()=>{
          if(panel.hidden || renderEpoch!==renderGeneration)return;
          const request=new AbortController();requests.add(request);
          try{
            const response=await fetch(`/capture-thumbnail?id=${encodeURIComponent(target.id)}`,{cache:'no-store',signal:request.signal});if(response.status!==200)return;
            const blob=await response.blob();if(panel.hidden || renderEpoch!==renderGeneration)return;
            const url=URL.createObjectURL(blob);urls.add(url);const image=document.createElement('img');image.alt='';image.src=url;preview.replaceChildren(image);
          }catch{/* A source can close or decline a thumbnail without hiding its tile. */}finally{requests.delete(request);}
        });observer.observe(preview);}
        const text=document.createElement('span');text.textContent=option.textContent;button.append(text);
        const note=document.createElement('small');note.textContent=kind==='none'?'Controllers and calls still work':target?.width && target?.height?`${target.width} × ${target.height}`:kind==='desktop'?'Entire screen':'Application window';button.append(note);
        button.onclick=()=>{select.value=option.value;close(true);render();select.dispatchEvent(new Event('change',{bubbles:true}));};grid.append(button);
      }
      panel.append(grid);
    }
  };
  const open=async()=>{
    if(select.disabled)return;const epoch=++generation;refreshError='';panel.hidden=false;trigger.setAttribute('aria-expanded','true');panel.setAttribute('aria-busy','true');render();
    refreshing ||= Promise.resolve().then(()=>refresh?.()).then(result=>{if(result===false)throw Error('Source refresh failed');}).finally(()=>{refreshing=null;});
    try{await refreshing;}catch{if(epoch===generation)refreshError='Could not refresh the list. Try Refresh again.';}finally{if(epoch===generation){panel.removeAttribute('aria-busy');render();}}
  };
  trigger.onclick=()=>panel.hidden?open():close();select.addEventListener('change',render);
  root.addEventListener('keydown',event=>{if(event.key==='Escape' && !panel.hidden){event.preventDefault();event.stopPropagation();close(true);}});
  document.addEventListener('click',event=>{if(!panel.hidden && !root.contains(event.target))close();},true);
  document.addEventListener('app-mode',()=>close());window.addEventListener('pagehide',()=>close());
  document.addEventListener('toggle',event=>{if(event.target.tagName==='DETAILS' && !event.target.open && event.target.contains(root))close();},true);
  render();return {open,close,render};
}
