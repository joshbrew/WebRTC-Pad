// Organize the existing controls; switching sections never touches a live stream.
const $=selector=>document.querySelector(selector);
const icon=name=>`<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
export function settingsNavigation(sheet,sections){
  const content=sheet.content,nav=document.createElement('div');nav.className='settings-tabs';nav.setAttribute('role','tablist');nav.setAttribute('aria-label','Settings sections');
  const panes=new Map(),tabs=new Map();let current=sections[0].key;
  for(const section of sections){
    const pane=document.createElement('section');pane.className='settings-pane';pane.dataset.settingsPane=section.key;pane.id=`${sheet.id}-${section.key}`;pane.setAttribute('role','tabpanel');pane.setAttribute('aria-labelledby',`${pane.id}-tab`);pane.tabIndex=-1;
    const tab=document.createElement('button');tab.type='button';tab.id=`${pane.id}-tab`;tab.setAttribute('role','tab');tab.setAttribute('aria-controls',pane.id);tab.innerHTML=icon(section.icon)+`<span>${section.label}</span>`;tab.onclick=()=>select(section.key);nav.append(tab);
    content.append(pane);for(const node of section.nodes.filter(Boolean))pane.append(node);panes.set(section.key,pane);tabs.set(section.key,tab);
  }
  content.prepend(nav);sheet.classList.add('sectioned-settings');
  const footer=document.createElement('div');footer.className='call-settings-footer';content.append(footer);
  function select(key,{focus=false,reset=true}={}){if(!panes.has(key))return;current=key;for(const [id,pane] of panes){pane.hidden=id!==key;const tab=tabs.get(id);tab.setAttribute('aria-selected',String(id===key));tab.tabIndex=id===key?0:-1;}if(reset)content.scrollTop=0;if(focus)tabs.get(key).focus();}
  nav.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();event.stopPropagation();const keys=[...tabs.keys()],focused=[...tabs].find(([,tab])=>tab===document.activeElement)?.[0],index=keys.indexOf(focused || current);select(event.key==='Home'?keys[0]:event.key==='End'?keys.at(-1):keys[(index+(event.key==='ArrowLeft'?-1:1)+keys.length)%keys.length],{focus:true});});
  const reveal=target=>{const pane=target?.closest?.('[data-settings-pane]');if(pane && panes.get(pane.dataset.settingsPane)===pane)select(pane.dataset.settingsPane,{reset:current!==pane.dataset.settingsPane});};
  document.addEventListener('reveal-call-setting',event=>reveal(event.detail));
  // Programmatically opening an advanced group also reveals its settings section.
  content.addEventListener('toggle',event=>{if(event.target.tagName==='DETAILS' && event.target.open)reveal(event.target);},true);
  select(current);return {select,reveal,panes,tabs,footer};
}
export function callHints(){
  const hint=document.createElement('div');hint.className='call-hint';hint.id='callControlHint';hint.setAttribute('role','tooltip');hint.hidden=true;document.body.append(hint);let timer,target;
  const selector='.call-toolbar button[title],.header-right button[title],.tile-layout-controls button[title],.view-swap-controls button[title],.participant-quick-button[title],.participant-media-button[title],.streamer-resize[title]';
  function hide(){clearTimeout(timer);hint.hidden=true;if(target){const ids=(target.getAttribute('aria-describedby') || '').split(/\s+/).filter(id=>id && id!==hint.id);if(ids.length)target.setAttribute('aria-describedby',ids.join(' '));else target.removeAttribute('aria-describedby');}target=null;}
  function show(button){hide();if(button.disabled)return;target=button;timer=setTimeout(()=>{if(!target?.isConnected || !target.getClientRects().length || target.disabled)return;const text=target.title;if(!text)return;hint.textContent=text;hint.hidden=false;const r=target.getBoundingClientRect(),box=hint.getBoundingClientRect();hint.style.left=`${Math.max(8,Math.min(innerWidth-box.width-8,r.left+r.width/2-box.width/2))}px`;hint.style.top=`${Math.max(8,Math.min(innerHeight-box.height-8,r.top>box.height+12?r.top-box.height-9:r.bottom+9))}px`;const ids=new Set((target.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));ids.add(hint.id);target.setAttribute('aria-describedby',[...ids].join(' '));},350);}
  document.addEventListener('pointerover',event=>{if(event.pointerType==='touch')return;const button=event.target.closest(selector);if(button && button!==target)show(button);});
  document.addEventListener('pointerout',event=>{if(target && !target.contains(event.relatedTarget))hide();});
  document.addEventListener('focusin',event=>{const button=event.target.closest(selector);if(button?.matches(':focus-visible'))show(button);});
  for(const name of ['pointerdown','focusout','scroll'])document.addEventListener(name,hide,true);window.addEventListener('resize',hide);
  window.addEventListener('blur',hide);document.addEventListener('visibilitychange',hide);document.addEventListener('keydown',event=>{if(event.key==='Escape' && !hint.hidden){hide();event.preventDefault();event.stopImmediatePropagation();}},true);
  document.addEventListener('fullscreenchange',()=>{hide();(document.fullscreenElement?.id==='clientStage'?document.fullscreenElement:document.body).append(hint);});
}
export function initSettingsSections({host,client,voice,camera,open}){
  const driver=$('#driverStatus'),capacity=$('#playerCountInfo'),hostQuality=$('#hostSettings');
  const driverHeading=driver.previousElementSibling,capacityHeading=capacity.previousElementSibling,slots=$('#hostSlotSummary').parentElement;
  const network=$('#hostNetworkSettings');network.open=true;
  const guestBody=$('#clientConnectionSettings .settings-body'),connectionNodes=[];let moving=false;
  for(const child of [...guestBody.children]){if(child.tagName==='H4' && child.textContent==='Live connection details')moving=true;if(child.contains($('#clientVideoToggle')))moving=false;if(moving)connectionNodes.push(child);}
  const clientNetwork=document.createElement('div');clientNetwork.className='settings-connection';for(const node of connectionNodes)clientNetwork.append(node);
  const hostNav=settingsNavigation(host,[
    {key:'screen',label:'Screen',icon:'share',nodes:[$('#hostLiveSource'),hostQuality,$('#qualityToggle')]},
    {key:'players',label:'Guests & access',icon:'people',nodes:[$('#hostGuestSettings'),driverHeading,driver,capacityHeading,capacity,slots]},
    {key:'voice',label:'Voice',icon:'volume',nodes:[$('#hostVoice')]},
    {key:'connection',label:'Connection',icon:'connection',nodes:[network,$('#hostDiagnostics')]}
  ]);
  const clientNav=settingsNavigation(client,[
    {key:'screen',label:'Stream',icon:'share',nodes:[$('#clientConnectionSettings')]},
    {key:'voice',label:'Voice',icon:'volume',nodes:[$('#clientVoice')]},
    {key:'connection',label:'Connection',icon:'connection',nodes:[clientNetwork,$('#clientDiagnostics')]}
  ]);
  $('#hostLiveSource').open=true;
  $('#clientConnectionSettings > summary').textContent='Picture & sound';
  $('#hostSettings > summary').textContent='Stream quality';
  $('#hostSettings > summary').append($('#streamQualityLabel'));$('#qualityToggle').hidden=true;
  const receiveLabel=$('#clientReceiveVideo').closest('label');receiveLabel.hidden=true;receiveLabel.setAttribute('aria-hidden','true');
  for(const heading of guestBody.querySelectorAll(':scope > h4'))if(heading.textContent==='Video & audio')heading.remove();
  for(const [side,nav] of [['host',hostNav],['client',clientNav]]){
    const pane=nav.panes.get('voice'),prompt=document.createElement('p');prompt.className='small muted';prompt.textContent='Choose your devices and test your microphone privately before joining.';pane.prepend(prompt);
    const actions=document.createElement('div');actions.className='settings-media-actions';
    const cam=document.createElement('button');cam.type='button';cam.className='button secondary';cam.innerHTML=icon('camera')+'<span>Camera settings</span>';cam.onclick=()=>open(`${side}Camera`,cam);actions.append(cam);pane.append(actions);
    const help=$(`#${side}SettingsSheetHelp`);if(help)nav.footer.append(help);
    const mic=$(`#${side}CallMic`),settings=document.createElement('button');settings.type='button';settings.id=`${side}MicSettings`;settings.className='button control mic-settings-button';settings.setAttribute('aria-label','Microphone settings');settings.title='Microphone settings';settings.innerHTML=icon('chevron');settings.onclick=()=>{open(`${side}Settings`,settings);nav.select('voice');};mic.after(settings);
    const cameraSettings=$(`#${side}CameraSettings`);cameraSettings.innerHTML=icon('chevron');cameraSettings.title='Camera settings';
    // Media readiness follows the current role, including a host switch.
    const refresh=()=>{prompt.hidden=voice(side).ready;cam.disabled=!camera(side).ready && !camera(side).preparing;settings.disabled=!voice(side).ready && !voice(side).preparing;};
    const observer=new MutationObserver(refresh);observer.observe(voice(side).root,{attributes:true,attributeFilter:['hidden']});document.addEventListener('app-mode',refresh);document.addEventListener('call-settings-refresh',refresh);refresh();
  }
  const quick=document.createElement('div');quick.className='mobile-call-actions';const full=document.createElement('button');full.type='button';full.id='clientSettingsFullscreen';full.className='button secondary';full.innerHTML=icon('expand')+'<span>Fullscreen</span>';full.onclick=()=>{client.open=false;$('#clientFullscreen').click();};clientNav.panes.get('screen').prepend(quick);quick.append(full);
  const sync=()=>{full.disabled=$('#clientFullscreen').disabled;full.querySelector('span').textContent=document.fullscreenElement?.id==='clientStage'?'Exit fullscreen':'Fullscreen';};new MutationObserver(sync).observe($('#clientFullscreen'),{attributes:true,attributeFilter:['disabled']});document.addEventListener('fullscreenchange',sync);sync();
  callHints();return {host:hostNav,client:clientNav};
}
