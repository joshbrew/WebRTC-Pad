const menus=new WeakMap();
const localControls='button,input,select,textarea,a,summary,.call-toolbar,.call-sheet,.screen-quick-controls,.streamer-camera,[role=separator],.tile-layout-controls,.view-swap-controls,.single-view-picker';

function menuFor(doc){
  if(menus.has(doc))return menus.get(doc);
  const menu=doc.createElement('div');
  menu.className='screen-quick-controls';
  menu.hidden=true;
  menu.setAttribute('role','dialog');
  menu.setAttribute('aria-label','Screen quick controls');
  menu.tabIndex=-1;
  menu.innerHTML='<header><div><strong></strong><p class="screen-quick-scope"></p></div><button type="button" aria-label="Close screen controls">×</button></header><p class="screen-quick-picture" hidden></p><p class="screen-quick-quality" hidden></p><div class="screen-quick-fields"></div>';
  const heading=menu.querySelector('strong');
  const scope=menu.querySelector('.screen-quick-scope');
  const picture=menu.querySelector('.screen-quick-picture');
  const quality=menu.querySelector('.screen-quick-quality');
  const fields=menu.querySelector('.screen-quick-fields');
  let returnTo, config, trigger, openedSource, video, anchor, surface;
  const videoEvents=['loadedmetadata','resize','emptied'];
  function position(){
    const rect=returnTo.getBoundingClientRect();
    const {clientWidth:width,clientHeight:height}=doc.documentElement;
    const x=anchor?.x ?? (returnTo===trigger?rect.right-menu.offsetWidth:rect.left);
    const below=anchor?.y ?? (returnTo===trigger?rect.bottom+6:rect.top+8);
    const above=(anchor?.y ?? rect.top)-menu.offsetHeight-6;
    menu.style.left=`${Math.max(8,Math.min(x,width-menu.offsetWidth-8))}px`;
    menu.style.top=`${Math.max(8,below+menu.offsetHeight<=height-8?below:above>=8?above:height-menu.offsetHeight-8)}px`;
  }
  function updatePicture(){
    const text=video?.videoWidth && video.videoHeight?`Picture · ${video.videoWidth} × ${video.videoHeight}`:'';
    if(picture.textContent!==text)picture.textContent=text;
    picture.hidden=!text;
    if(!menu.hidden)position();
  }
  function close(restore=false){
    if(menu.hidden)return;
    menu.hidden=true;
    for(const event of videoEvents)video?.removeEventListener(event,updatePicture);
    trigger?.setAttribute('aria-expanded','false');
    if(restore && returnTo?.isConnected)returnTo.focus({preventScroll:true});
    config=returnTo=trigger=openedSource=video=anchor=surface=null;
  }
  function currentSettings(){
    const settings=config?.();
    if(openedSource && settings && returnTo?.getClientRects().length && surface?.getClientRects().length &&
       settings.sourceId===openedSource.sourceId && settings.identity===openedSource.identity)return settings;
    close();
  }
  menu.querySelector('button').onclick=()=>close(true);
  menu.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(true);}});
  doc.addEventListener('focusin',event=>{
    if(!menu.hidden && !menu.contains(event.target) && !trigger?.contains(event.target))close();
  });
  menu.addEventListener('contextmenu',event=>event.preventDefault());
  doc.addEventListener('pointerdown',event=>{
    if(menu.hidden || menu.contains(event.target) || trigger?.contains(event.target))return;
    close();
    if(event.target.closest('#clientStage') && !event.target.closest(localControls)){
      event.preventDefault();event.stopImmediatePropagation();
    }
  },true);
  for(const event of ['app-mode','screen-quick-close'])doc.addEventListener(event,()=>close());
  doc.addEventListener('fullscreenchange',()=>{
    if(!menu.hidden && menu.parentElement!==(doc.fullscreenElement || doc.body))close();
  });
  doc.addEventListener('screen-quick-refresh',()=>{if(!menu.hidden)refresh();});
  doc.defaultView.addEventListener('resize',()=>{if(!menu.hidden && currentSettings())position();});
  doc.addEventListener('scroll',event=>{
    if(!menu.hidden && !menu.contains(event.target))close();
  },{capture:true,passive:true});

  const controls=new Map();
  function refresh(){
    const settings=currentSettings();
    if(!settings)return;
    if(heading.textContent!==settings.label)heading.textContent=settings.label;
    if(scope.textContent!==(settings.scope || ''))scope.textContent=settings.scope || '';
    quality.hidden=!settings.quality;
    if(quality.textContent!==(settings.quality || ''))quality.textContent=settings.quality || '';
    for(const [key,{input,label}] of controls){
      const field=settings.fields?.find(item=>item.key===key);
      label.hidden=!field || field.hidden===true;
      if(!field)continue;
      input.disabled=!!field.disabled;
      if(input.type==='checkbox')input.checked=field.value;
      else {
        for(const [index,option] of [...input.options].entries())option.disabled=!!field.options[index]?.[2];
        input.value=String(field.value);
      }
    }
    const sound=fields.querySelector('.screen-quick-sound');
    if(sound){
      const audio=settings.sound;
      sound.disabled=!audio?.audio || !!audio.soundBusy || sound.dataset.pending==='true';
      sound.textContent=!audio?.audio?'No shared sound':audio.soundMode==='share'?(audio.muted?'Share sound':'Stop sharing sound'):audio.soundBlocked?'Enable sound':audio.muted?'Unmute sound':'Mute sound';
    }
    const reset=fields.querySelector('.screen-quick-reset');
    if(reset)reset.disabled=settings.reset?.disabled===true;
    position();
  }
  const open=(event,target,getSettings,button)=>{
    const settings=getSettings();
    if(!settings)return false;
    if(!menu.hidden && trigger && event.currentTarget===trigger){close(true);return true;}
    close();
    config=getSettings;
    openedSource=settings;
    surface=target;
    trigger=button;
    returnTo=event.currentTarget===button?button:surface;
    anchor=event.type==='contextmenu' && (event.clientX || event.clientY)?{x:event.clientX,y:event.clientY}:null;
    video=surface.matches('video')?surface:surface.querySelector('video');
    for(const name of videoEvents)video?.addEventListener(name,updatePicture);
    trigger?.setAttribute('aria-expanded','true');
    const parent=doc.fullscreenElement || doc.body;
    parent.append(menu);
    fields.replaceChildren();controls.clear();
    for(const field of settings.fields || []){
      const label=doc.createElement('label');
      const input=doc.createElement(field.options?'select':'input');
      if(field.options){
        for(const [value,text,disabled] of field.options){
          const option=new doc.defaultView.Option(text,value);
          option.disabled=!!disabled;
          input.append(option);
        }
      } else {input.type='checkbox';label.className='check-row';}
      label.append(field.label,input);fields.append(label);controls.set(field.key,{input,label});
      input.onchange=()=>{
        currentSettings()?.change?.(field.key,input.type==='checkbox'?input.checked:input.value);
        if(!menu.hidden)refresh();
      };
    }
    const sound=doc.createElement('button');
    sound.type='button';sound.className='button secondary screen-quick-sound';
    sound.onclick=async()=>{
      const audio=currentSettings()?.sound;
      if(!audio?.audio || audio.soundBusy || sound.dataset.pending==='true')return;
      sound.dataset.pending='true';
      sound.setAttribute('aria-busy','true');
      let failed=false;
      try{await audio.toggleSound?.();}
      catch{failed=true;}
      finally{
        delete sound.dataset.pending;
        sound.removeAttribute('aria-busy');
        if(!menu.hidden && fields.contains(sound)){
          refresh();
          if(failed && !menu.hidden)sound.textContent='Try sound again';
        }
      }
    };
    fields.append(sound);
    if(settings.reset){
      const reset=doc.createElement('button');reset.type='button';reset.className='button secondary screen-quick-reset';reset.textContent=settings.reset.label;
      reset.onclick=()=>{
        currentSettings()?.reset?.run();
        if(!menu.hidden){refresh();if(reset.disabled)focusField();}
      };
      fields.append(reset);
    }
    if(settings.more && doc.defaultView===window){
      const more=doc.createElement('button');more.type='button';more.className='button secondary';more.textContent='More stream settings';
      more.onclick=()=>{const current=currentSettings(),opener=returnTo;close();current?.more?.(opener);};fields.append(more);
    }
    menu.style.left='8px';menu.style.top='8px';menu.hidden=false;
    menu.dispatchEvent(new doc.defaultView.Event('screen-quick-open',{bubbles:true}));
    updatePicture();refresh();
    if(menu.hidden)return true;
    if(!doc.defaultView.matchMedia('(prefers-reduced-motion: reduce)').matches){
      menu.animate([{opacity:.55},{opacity:1}],{duration:135,easing:'ease-out'});
    }
    focusField();
    return true;
  };
  function focusField(){
    (fields.querySelector('label:not([hidden]) :is(select,input):not(:disabled),button:not(:disabled)') || menu).focus({preventScroll:true});
  }
  menus.set(doc,open);
  return open;
}

export function bindScreenQuickControls(surface,getSettings,{allowContext=()=>true,button}={}){
  if(!surface.hasAttribute('tabindex'))surface.tabIndex=0;
  const open=event=>{
    if(menuFor(surface.ownerDocument)(event,surface,getSettings,button)){
      event.preventDefault();event.stopPropagation();
    }
  };
  surface.addEventListener('contextmenu',event=>{
    if(event.defaultPrevented || event.target.closest(localControls) || !allowContext(event))return;
    open(event);
  });
  surface.addEventListener('keydown',event=>{
    if(event.target===surface && (event.key==='ContextMenu' || event.shiftKey && event.key==='F10'))open(event);
  });
  if(button){button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-expanded','false');button.onclick=open;}
}

export function quickSelect(key,label,select,value,limit=Infinity){
  return {key,label,value,options:[...select.options].map(option=>[option.value,option.textContent,Number(option.value)>limit])};
}

export function quickMinimum(select,value,limit=Infinity,hidden=false){
  const field=quickSelect('minHeight','Minimum resolution',select,value,limit);
  if(Number(field.value)>limit)field.value=field.options.filter(option=>!option[2]).at(-1)?.[0] ?? '';
  return {...field,hidden};
}

export function screenQuickButton(doc){
  const button=doc.createElement('button');
  button.type='button';button.className='tile-quality-button';
  button.setAttribute('aria-label','Screen quick controls');button.title='Screen quick controls';
  button.innerHTML='<svg class="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M3 6h4m4 0h10M3 12h10m4 0h4M3 18h5m4 0h9"/><circle cx="9" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="10" cy="18" r="2"/></svg>';
  return button;
}
