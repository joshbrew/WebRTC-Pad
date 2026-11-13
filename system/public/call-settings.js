// Organize the existing controls; switching sections never touches a live stream.
import {readPreference,writePreference} from './call-comfort.js';

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
  content.addEventListener('toggle',event=>{if(event.target.tagName==='DETAILS' && event.target.open && !event.target.matches('.voice-preferences'))reveal(event.target);},true);
  select(current);return {select,reveal,panes,tabs,footer};
}
export function callHints(){
  const hint=document.createElement('div');hint.className='call-hint';hint.id='callControlHint';hint.setAttribute('role','tooltip');hint.hidden=true;document.body.append(hint);
  const selector='.call-toolbar button,.header-right button,.tile-layout-controls button,.view-swap-controls button,.participant-quick-button,.participant-media-button,.streamer-resize,.tile-quality-button,.tile-floating,.tile-maximize,.tile-sound';
  let timer,target;
  const descriptions=button=>(button.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
  function hide(){
    clearTimeout(timer);hint.hidden=true;
    if(target){
      const ids=descriptions(target);
      if(ids.includes(hint.id)){
        const remaining=ids.filter(id=>id!==hint.id);
        if(remaining.length)target.setAttribute('aria-describedby',remaining.join(' '));else target.removeAttribute('aria-describedby');
      }
    }
    target=null;
  }
  function hintText(button){
    if(button.title){button.dataset.tooltip=button.title;button.removeAttribute('title');}
    return button.dataset.tooltip || '';
  }
  function show(button){
    if(button===target)return;
    hide();
    if(!hintText(button))return;
    target=button;
    timer=setTimeout(()=>{
      if(!target?.isConnected || !target.getClientRects().length)return;
      const text=hintText(target);if(!text)return;
      hint.textContent=text;hint.hidden=false;
      const rect=target.getBoundingClientRect(),width=hint.offsetWidth,height=hint.offsetHeight;
      hint.style.left=`${Math.max(8,Math.min(innerWidth-width-8,rect.left+(rect.width-width)/2))}px`;
      hint.style.top=`${Math.max(8,Math.min(innerHeight-height-8,rect.top>height+16?rect.top-height-8:rect.bottom+8))}px`;
      if(hint.textContent!==target.getAttribute('aria-label'))target.setAttribute('aria-describedby',[...descriptions(target),hint.id].join(' '));
    },350);
  }
  document.addEventListener('pointerover',event=>{if(event.pointerType!=='touch'){const button=event.target.closest(selector);if(button)show(button);}});
  document.addEventListener('pointerout',event=>{if(target && (!(event.relatedTarget instanceof Node) || !target.contains(event.relatedTarget)))hide();});
  document.addEventListener('focusin',event=>{const button=event.target.closest(selector);if(button?.matches(':focus-visible'))show(button);});
  for(const name of ['pointerdown','focusout','scroll'])document.addEventListener(name,hide,true);window.addEventListener('resize',hide);
  window.addEventListener('blur',hide);document.addEventListener('visibilitychange',hide);document.addEventListener('keydown',event=>{if(event.key==='Escape')hide();},true);
  document.addEventListener('fullscreenchange',()=>{hide();(document.fullscreenElement?.matches('.video-stage')?document.fullscreenElement:document.body).append(hint);});
}
export function initSettingsSections({host,client,voice,camera,open}){
  const driver=$('#driverStatus'),capacity=$('#playerCountInfo'),hostQuality=$('#hostSettings');
  const driverHeading=driver.previousElementSibling,capacityHeading=capacity.previousElementSibling,slots=$('#hostSlotSummary').parentElement;
  const network=$('#hostNetworkSettings');network.open=true;
  const guestBody=$('#clientConnectionSettings .settings-body'),connectionNodes=[];let moving=false;
  for(const child of [...guestBody.children]){if(child.tagName==='H4' && child.textContent==='Live connection details')moving=true;if(child.contains($('#clientVideoToggle')))moving=false;if(moving)connectionNodes.push(child);}
  const clientNetwork=document.createElement('div');clientNetwork.className='settings-connection';for(const node of connectionNodes)clientNetwork.append(node);
  const hostNav=settingsNavigation(host,[
    {key:'screen',label:'Screen',icon:'share',nodes:[hostQuality,$('#hostLiveSource'),$('#qualityToggle')]},
    {key:'players',label:'Guests & access',icon:'people',nodes:[$('#hostGuestSettings'),$('#hostPlatformNote'),$('#hostPlatformGuide'),driverHeading,driver,capacityHeading,capacity,slots]},
    {key:'voice',label:'Voice',icon:'volume',nodes:[$('#hostVoice')]},
    {key:'connection',label:'Connection',icon:'connection',nodes:[network,$('#hostDiagnostics')]}
  ]);
  const clientNav=settingsNavigation(client,[
    {key:'screen',label:'Stream',icon:'share',nodes:[$('#clientConnectionSettings')]},
    {key:'voice',label:'Voice',icon:'volume',nodes:[$('#clientVoice')]},
    {key:'connection',label:'Connection',icon:'connection',nodes:[clientNetwork,$('#clientDiagnostics')]}
  ]);
  const videoStats=$('#clientVideoStats');
  const statsOption=document.createElement('label');statsOption.className='check-row';
  const showStats=document.createElement('input');showStats.type='checkbox';showStats.id='clientShowVideoStats';
  statsOption.append(showStats,' Show resolution and frame rate on video');
  clientNav.panes.get('connection').prepend(statsOption);
  showStats.checked=readPreference('showVideoStats',false)===true;
  const updateStatsOverlay=()=>{videoStats.hidden=!showStats.checked;};
  showStats.addEventListener('change',()=>{writePreference('showVideoStats',showStats.checked);updateStatsOverlay();});
  updateStatsOverlay();
  for(const sheet of [host,client]){
    const appearance=document.createElement('button');
    appearance.type='button';
    appearance.className='button secondary appearance-browse';
    appearance.dataset.appearanceBrowse='';
    appearance.setAttribute('aria-haspopup','dialog');
    appearance.innerHTML='<span>Appearance</span><span data-appearance-name></span><span class="appearance-chevron" aria-hidden="true"></span>';
    sheet.querySelector('.call-sheet-heading .help-button').before(appearance);
  }
  document.dispatchEvent(new Event('appearance-controls'));
  $('#hostLiveSource').open=false;
  $('#clientConnectionSettings > summary').textContent='Picture & sound';
  $('#hostSettings > summary').textContent='Stream quality';
  $('#hostSettings > summary').append($('#streamQualityLabel'));$('#qualityToggle').hidden=true;
  hostQuality.open = true;
  for (const side of ['host', 'client']) {
    const adaptive = side === 'host' ? $('#hostAutoThrottle') : $('#clientAutoThrottle');
    const hint = $(`#${side}AdaptiveHint`);
    const state = document.createElement('span');
    state.className = 'stream-quality-state';
    adaptive.closest('label').append(state);
    const update = () => {
      const hostFixed=side==='client' && $('#clientVideoSettings').classList.contains('host-fixed-resolution');
      adaptive.disabled=hostFixed;
      const label=hostFixed?'Off · set by host':adaptive.checked?'On':'Off';
      if(state.textContent!==label)state.textContent=label;
      const text = side==='host' ? 'Applies to screens using global settings.' : hostFixed ? 'The host has set fixed quality for this screen.' : adaptive.checked ? 'Lets the host adjust resolution or frame rate within your limits.' : 'Keeps the selected limits. The browser can still drop frames if needed.';
      if (hint.textContent !== text) hint.textContent = text;
    };
    adaptive.addEventListener('change', update);
    document.addEventListener('call-settings-refresh', update);
    update();
  }
  const advanced=document.createElement('details');
  advanced.className='advanced stream-quality-advanced';
  advanced.innerHTML='<summary>Advanced video settings</summary>';
  const priority=$('#streamPriority').closest('.stream-quality-field');
  priority.classList.add('stream-quality-adaptive');
  advanced.append($('#nativeCodecOptions'));
  $('#resetGlobalQuality').parentElement.before(advanced);
  const limits=$('#hostGlobalQualityFields .stream-quality-grid');
  const limitsHeading=document.createElement('h4');
  limitsHeading.className='stream-quality-heading';
  limitsHeading.textContent='Resolution & frame rate';
  limits.before(limitsHeading);
  const receiveLabel=$('#clientReceiveVideo').closest('label');receiveLabel.hidden=true;receiveLabel.setAttribute('aria-hidden','true');
  for(const heading of guestBody.querySelectorAll(':scope > h4'))if(heading.textContent==='Video & audio')heading.remove();
  for(const [side,nav] of [['host',hostNav],['client',clientNav]]){
    const pane=nav.panes.get('voice'),prompt=document.createElement('p');prompt.className='small muted';prompt.textContent='Choose your devices and test your microphone privately before joining.';pane.prepend(prompt);
    const actions=document.createElement('div');actions.className='settings-media-actions';
    const cam=document.createElement('button');cam.type='button';cam.className='button secondary';cam.innerHTML=icon('camera')+'<span>Camera settings</span>';cam.onclick=()=>open(`${side}Camera`,cam);actions.append(cam);prompt.after(actions);
    const help=$(`#${side}SettingsSheetHelp`);if(help)nav.footer.append(help);
    const mic=$(`#${side}CallMic`),settings=document.createElement('button');settings.type='button';settings.id=`${side}MicSettings`;settings.className='button control mic-settings-button';settings.setAttribute('aria-label','Microphone settings');settings.setAttribute('aria-controls',`${side}VoiceQuickSheet`);settings.setAttribute('aria-expanded','false');settings.title='Microphone settings';settings.innerHTML=icon('chevron');
    const voiceQuick=$(`#${side}VoiceQuickSheet`);
    settings.onclick=()=>{if(voiceQuick.open){voiceQuick.querySelector('.call-sheet-heading .help-button').click();return;}open(`${side}VoiceQuick`,settings);voice(side).devices();};
    voiceQuick.addEventListener('toggle',()=>settings.setAttribute('aria-expanded',String(voiceQuick.open)));
    mic.after(settings);
    const cameraSettings=$(`#${side}CameraSettings`);cameraSettings.innerHTML=icon('chevron');cameraSettings.title='Camera settings';
    // Media readiness follows the current role, including a host switch.
    const refresh=()=>{prompt.hidden=voice(side).ready;cam.disabled=!camera(side).ready && !camera(side).preparing;settings.disabled=!voice(side).ready && !voice(side).preparing;};
    const observer=new MutationObserver(refresh);observer.observe(voice(side).root,{attributes:true,attributeFilter:['hidden']});document.addEventListener('app-mode',refresh);document.addEventListener('call-settings-refresh',refresh);refresh();
  }
  const quick=document.createElement('div');quick.className='mobile-call-actions';const full=document.createElement('button');full.type='button';full.id='clientSettingsFullscreen';full.className='button secondary';full.innerHTML=icon('expand')+'<span>Fullscreen</span>';full.onclick=()=>{client.open=false;$('#clientFullscreen').click();};guestBody.querySelector('.call-stream-actions').append(quick);quick.append(full);
  const fullscreen=$('#clientFullscreen');
  const fullscreenShortcuts=[full,$('#clientViewFullscreen')];
  function syncFullscreen(){
    const active=['clientStage','clientVideo'].includes(document.fullscreenElement?.id);
    for(const button of fullscreenShortcuts){
      button.disabled=fullscreen.disabled;
      button.setAttribute('aria-label',active?'Exit fullscreen':'Fullscreen');
      button.querySelector('span').textContent=active?'Exit fullscreen':'Fullscreen';
    }
  }
  new MutationObserver(syncFullscreen).observe(fullscreen,{attributes:true,attributeFilter:['disabled']});
  document.addEventListener('fullscreenchange',syncFullscreen);syncFullscreen();
  callHints();return {host:hostNav,client:clientNav};
}
