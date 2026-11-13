import {initSettingsSections} from './call-settings.js';
import {mediaCaption,accessCaption,controllersReady} from './call-comfort.js';
const $=selector=>document.querySelector(selector);
const icon=name=>`<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const micIcon='<svg class="icon" aria-hidden="true" viewBox="0 0 24 24"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8"/></svg>';

// Reuse the actual controls and their handlers. Opening a panel never touches
// tracks, controller leases or peer connections.
export function initCallShell({voice,camera,chat,screens,notify=()=>{}}){
  let openingRevision=0;const clickRevisions=new WeakMap();
  document.addEventListener('click',event=>clickRevisions.set(event,openingRevision),true);
  const sheets=new Map(),buttons=new Map();let previousHost=false,previousGuests=0,previousConnected=false,lastHostError=false,lastClientError=false,queued=false;
  const mode=()=>document.body.dataset.mode || 'host';
  document.body.classList.add('call-shell');
  let nextAction;
  let seenControllers=new Set();
  const nudge=control=>document.dispatchEvent(new CustomEvent('ui-attention',{detail:control}));
  function cueNextAction(control){
    if(control===nextAction)return;
    nextAction?.removeAttribute('data-next-action');
    nextAction=control;
    if(control){control.dataset.nextAction='';nudge(control);}
  }
  function close(sheet,restore=false){sheet.open=false;sheet.releaseContent?.();if(restore){const target=sheet.returnFocus;requestAnimationFrame(()=>{if(target?.isConnected && target.getClientRects().length)target.focus({preventScroll:true});else $(`#mode${mode()==='host'?'Host':'Client'}`).focus({preventScroll:true});});}}
  function open(key,trigger){
    const sheet=sheets.get(key);if(!sheet)return;
    openingRevision++;
    if(key==='clientPair')$('#clientPairing').open=true;
    const opener=trigger || document.activeElement;
    const sourceSheet=opener?.closest('.call-sheet[open]');
    for(const other of sheets.values())if(other!==sheet)close(other);
    sheet.returnFocus=sourceSheet && sourceSheet!==sheet?sourceSheet.returnFocus || opener:opener;
    sheet.dataset.prejoinMic=String(trigger?.id==='clientPrepareMic');
    const quick=trigger?.matches('.mic-settings-button,.camera-settings-button');
    sheet.classList.toggle('device-quick-sheet',!!quick);
    if(trigger?.matches('.camera-settings-button') && sheet.querySelector('.camera-tuning'))sheet.querySelector('.camera-tuning').open=false;
    sheet.acquireContent?.();sheet.open=true;schedulePanelPosition();
    requestAnimationFrame(()=>{if(!sheet.open || sheet.contains(document.activeElement))return;const target=[...sheet.querySelectorAll('.call-sheet-content [role=tab][aria-selected=true]')].find(el=>el.getClientRects().length) || [...sheet.content.querySelectorAll('input,button,select,textarea,a[href]')].find(el=>!el.disabled && el.getClientRects().length);(target || sheet).focus({preventScroll:true});});
  }
  function panel(key,title,nodes){
    const sheet=document.createElement('details');sheet.className='call-sheet';sheet.id=`${key}Sheet`;sheet.dataset.callSheet=key;
    sheet.tabIndex=-1;sheet.setAttribute('role','region');sheet.setAttribute('aria-labelledby',`${key}SheetTitle`);
    const summary=document.createElement('summary');summary.textContent=title;sheet.append(summary);
    const heading=document.createElement('div');heading.className='call-sheet-heading';
    const label=document.createElement('h3');label.id=`${key}SheetTitle`;label.textContent=title;
    const dismiss=document.createElement('button');dismiss.type='button';dismiss.className='help-button';dismiss.textContent='×';dismiss.setAttribute('aria-label',`Close ${title.toLowerCase()}`);dismiss.onclick=()=>close(sheet,true);
    heading.append(label,dismiss);sheet.append(heading);
    const content=document.createElement('div');content.className='call-sheet-content';sheet.append(content);sheet.content=content;
    nodes[0].before(sheet);for(const node of nodes)content.append(node);
    sheet.addEventListener('toggle',()=>{
      if(sheet.open){for(const other of sheets.values())if(other!==sheet)close(other);}
      else sheet.releaseContent?.();
      if(['hostChat','clientChat'].includes(key))chat(key==='hostChat'?'host':'client').setOpen(sheet.open);
      if(sheet.open && ['hostCamera','clientCamera'].includes(key))camera(key==='hostCamera'?'host':'client').devices();
      for(const button of buttons.get(key) || [])button.setAttribute('aria-expanded',String(sheet.open));
      if(key==='hostInvite' || key==='clientPair')schedule();
    });
    // A panel inside fullscreen must never forward its clicks or scrolls to
    // the approved remote desktop surface behind it.
    for(const event of ['pointerdown','pointermove','pointerup','wheel'])sheet.addEventListener(event,event=>event.stopPropagation());
    sheet.addEventListener('keydown',event=>{if(event.key!=='Escape')event.stopPropagation();});
    sheets.set(key,sheet);return sheet;
  }
  function action(id,label,name,key,parent){
    const button=document.createElement('button');button.type='button';button.id=id;button.setAttribute('aria-label',label);button.className='button control';button.innerHTML=icon(name)+`<span>${label}</span>`;
    if(key){button.setAttribute('aria-controls',`${key}Sheet`);button.setAttribute('aria-expanded','false');button.onclick=()=>{const sheet=sheets.get(key);sheet.open?close(sheet,true):open(key,button);};buttons.set(key,[...(buttons.get(key) || []),button]);}
    parent.append(button);return button;
  }
  const hostToolbar=$('#hostMonitor .call-toolbar');hostToolbar.id='hostToolbar';$('#hostPanel').append(hostToolbar);
  const hostActions=$('#hostToolbar .toolbar-actions'),clientActions=$('#clientToolbar .toolbar-actions');
  for(const side of ['host','client']){const status=$(`#${side}Status`).parentElement;status.classList.add('call-status');$(`#${side}Panel .view-heading`).after(status);}
  const routineStatus=/^(Ready when you are|Ready to join|Session ready|connected|Connection refreshed over WebRTC|Your friend reconnected automatically|Streaming video and audio|Streaming video\. This capture source did not provide audio\.|Picture and sound are streaming\.|Picture is streaming\. Audio is off\.)$/i;
  const connectionStatus=/^(disconnected|failed|closed|connecting|new)$/i;
  const hostSettings=panel('hostSettings','Settings',[$('#hostLiveSource'),$('#hostSettings'),$('#hostGuestSettings'),$('#hostVoice')]);
  const hostInvite=panel('hostInvite','Invite guests',[$('#hostInviteCard')]);
  const hostPeoplePanel=panel('hostPeople','In this session',[$('#hostPeopleCard')]);
  const hostControllerPanel=panel('hostControllers','Controllers',[$('#hostControllerPanelContent')]);
  const hostControllerActions = document.createElement('div');
  hostControllerActions.className = 'host-controller-actions';
  const checkControllers = document.createElement('button');
  checkControllers.type = 'button';
  checkControllers.className = 'button small-button';
  checkControllers.textContent = 'Check controllers';
  const controllerHelp = $('#hostControllerHelp');
  checkControllers.setAttribute('aria-controls', controllerHelp.id);
  checkControllers.setAttribute('aria-expanded', 'false');
  checkControllers.onclick = () => {
    controllerHelp.open = !controllerHelp.open;
  };
  controllerHelp.addEventListener('toggle', () => checkControllers.setAttribute('aria-expanded', String(controllerHelp.open)));
  hostControllerActions.append(checkControllers);
  $('#hostPeopleCard .section-heading').append(hostControllerActions);
  const clientPair=panel('clientPair','Join a session',[$('#clientPairing')]);
  const controllers=panel('controllers','Controllers',[$('#controllerSetup')]);
  const joinSetup=document.createElement('section');joinSetup.id='clientJoinSetup';joinSetup.className='join-device-setup';
  joinSetup.innerHTML=`<div class="join-device-heading"><h4>Before you join</h4><div class="join-device-heading-actions"><button id="clientJoinSettings" type="button" class="button small-button" aria-label="Stream and connection settings">${icon('settings')}<span>Settings</span></button><button id="clientCancelJoin" type="button" class="button small-button" hidden>Cancel connection</button></div></div><div class="join-device-choices"><button id="clientPrepareControllers" type="button" class="button device-choice">${icon('pad')}<span>Controllers</span><b class="join-device-state"></b></button><button id="clientPrepareCamera" type="button" class="button device-choice">${icon('camera')}<span>Camera</span><b class="join-device-state">Off</b></button><button id="clientPrepareMic" type="button" class="button device-choice">${icon('volume')}<span>Microphone</span><b class="join-device-state">Off</b></button></div>`;
  $('#clientStage').after(joinSetup);
  for(const [id,key] of [['clientPrepareControllers','controllers'],['clientPrepareCamera','clientCamera'],['clientPrepareMic','clientSettings']]){const button=$(`#${id}`);button.setAttribute('aria-controls',`${key}Sheet`);button.setAttribute('aria-expanded','false');buttons.set(key,[...(buttons.get(key) || []),button]);}
  $('#clientJoinSettings').onclick=()=>{open('clientSettings',$('#clientJoinSettings'));settingsSections.client.select('screen');};$('#clientCancelJoin').onclick=()=>$('#clientDisconnect').click();
  $('#clientPrepareControllers').onclick=()=>open('controllers',$('#clientPrepareControllers'));
  $('#clientPrepareCamera').onclick=()=>open('clientCamera',$('#clientPrepareCamera'));
  $('#clientPrepareMic').onclick=()=>{open('clientSettings',$('#clientPrepareMic'));settingsSections.client.select('voice');$('#clientVoice details').open=true;};

  const joinControllers=document.createElement('label');joinControllers.className='check-row';joinControllers.id='clientJoinControllersOption';joinControllers.innerHTML='<span>Share controllers</span><input id="clientJoinControllers" type="checkbox" aria-describedby="guestLocalInputNote" checked />';joinControllers.title='Turning this off also releases local controller input blocking.';const sharingCard=document.createElement('div');sharingCard.className='controller-sharing-card';$('#controllerSetup .section-heading').after(sharingCard);sharingCard.append(joinControllers,$('#guestLocalInputNote'));
  const clientConnection=$('#clientPanel > .sidebar > .settings-card');clientConnection.id='clientConnectionSettings';
  const hostCameraSettings=panel('hostCamera','Camera',[$('#hostCamera')]),clientCameraSettings=panel('clientCamera','Camera',[$('#clientCamera')]);
  for(const [side,sheet] of [['host',hostCameraSettings],['client',clientCameraSettings]])sheet.releaseContent=()=>{const room=camera(side);if(room.privatePreview)room.stopCamera();};
  const hostChatPanel=panel('hostChat','Chat',[$('#hostChat')]),clientChatPanel=panel('clientChat','Chat',[$('#clientChat')]);
  for(const sheet of [hostChatPanel,clientChatPanel]){
    sheet.classList.add('chat-sheet');
    const heading=sheet.querySelector('.call-sheet-heading'),dismiss=heading.querySelector('button');
    heading.hidden=true;
    dismiss.classList.add('chat-close');
    // The chat card moves to the other panel when a participant changes roles.
    dismiss.onclick=()=>close(dismiss.closest('.chat-sheet'),true);
    sheet.querySelector('.chat-footer').append(dismiss);
  }
  const clientScreenPanel=panel('clientScreen','Share your screen',[$('#clientScreens')]);
  const clientSettings=panel('clientSettings','Settings',[clientConnection,$('#clientVoice')]);
  const voiceQuickPanels=[];
  for(const side of ['host','client']){
    const placeholder=document.createElement('div'),home=document.createComment('Voice settings');
    voice(side).root.after(placeholder);
    const quick=panel(`${side}VoiceQuick`,'Microphone & speakers',[placeholder]);
    (side==='host'?hostSettings:clientSettings).after(quick);
    const advanced=document.createElement('button');advanced.type='button';advanced.className='button small-button device-settings-link';
    advanced.innerHTML=icon('settings')+'<span>Voice settings</span>';
    advanced.onclick=()=>{open(`${side}Settings`,quick.returnFocus);settingsSections[side].select('voice');};
    quick.content.append(advanced);
    quick.acquireContent=()=>{const room=voice(side);if(!placeholder.contains(room.root)){room.root.before(home);room.$('device').closest('.voice-preferences').open=true;placeholder.append(room.root);}};
    quick.releaseContent=()=>{if(placeholder.firstElementChild)home.after(placeholder.firstElementChild);};
    voiceQuickPanels.push(quick);
  }
  const clientPeople=document.createElement('section');clientPeople.id='clientPeopleCard';clientSettings.before(clientPeople);
  const clientPeoplePanel=panel('clientPeople','In this session',[clientPeople]);
  clientConnection.open=true;

  // Keep the main bar focused on actions used during a call.
  const controllerActions=document.createElement('div');controllerActions.className='call-controller-actions';$('#controllerSetup .section-heading').after(controllerActions);controllerActions.append($('#clientEnablePad'));$('#controllerAdvanced').append(controllerActions);
  const streamActions=document.createElement('div');streamActions.className='row call-stream-actions';clientConnection.querySelector('.settings-body').prepend(streamActions);
  streamActions.append($('#clientMediaToggle'),$('#clientPopout'),$('#clientRefreshVideo'));
  const floatScreens=document.createElement('button');
  floatScreens.id='clientFloatScreens';
  floatScreens.type='button';
  floatScreens.className='button small-button float-screens-action';
  floatScreens.innerHTML=$('#clientPopout').querySelector('svg').outerHTML+'<span>Pop out</span>';
  floatScreens.hidden=true;
  floatScreens.onclick=()=>$('#clientPopout').click();
  $('#clientViewPopouts').before(floatScreens);
  const viewFullscreen=action('clientViewFullscreen','Fullscreen','expand',null,$('#clientSharedViews'));
  viewFullscreen.className='button small-button';
  viewFullscreen.onclick=()=>$('#clientFullscreen').click();
  controllerActions.append($('#clientReleaseInputs'));
  const controllerOptions=document.createElement('div');controllerOptions.className='controller-setup-actions';$('#keyboardMapping').before(controllerOptions);controllerOptions.append($('#joinKeyboardController'),$('#keyboardMapping'));$('#joinKeyboardController').innerHTML=icon('keyboard')+'<span>Use keyboard &amp; mouse as a controller</span>';
  const deviceCount=document.createElement('span');deviceCount.id='controllerDetectedCount';deviceCount.className='small muted';deviceCount.setAttribute('aria-live','polite');controllers.querySelector('.call-sheet-heading h3').after(deviceCount);
  hostSettings.content.append($('#qualityToggle'));
  const hostMore=action('hostCallSettings','Settings','settings','hostSettings',hostActions);
  const hostPeopleAction=action('hostCallPeople','People','people','hostPeople',hostActions);
  const hostControllersAction=action('hostCallControllers','Controllers','pad','hostControllers',hostActions);
  hostActions.insertBefore(hostControllersAction,hostPeopleAction);
  hostPeopleAction.after($('#inviteFocus'));
  const hostFullscreen=action('hostCallFullscreen','Fullscreen','expand',null,hostActions);hostFullscreen.onclick=()=>{const stage=$('#hostWatchStage');if(document.fullscreenElement===stage)document.exitFullscreen();else{document.dispatchEvent(new Event('expand-host-call'));stage?.requestFullscreen().catch(()=>{});}};
  const clientControls=action('clientCallControllers','Controllers','pad','controllers',clientActions);
  const clientPeopleAction=action('clientCallPeople','People','people','clientPeople',clientActions);clientActions.insertBefore(clientPeopleAction,$('#clientFullscreen'));
  const clientMore=action('clientCallSettings','Settings','settings','clientSettings',clientActions);
  const screenButton=action('clientCallShare','Share screen','share',null,clientActions);clientActions.insertBefore(screenButton,$('#clientCallPeople'));screenButton.onclick=()=>screens('client').toggle();
  const screenSettings=action('clientScreenSettings','Screen sharing settings','chevron','clientScreen',clientActions);screenSettings.classList.add('screen-settings-button');screenSettings.querySelector('span').classList.add('sr-only');clientActions.insertBefore(screenSettings,$('#clientCallPeople'));
  const hostEndActions=document.createElement('div');hostEndActions.className='host-end-actions';hostEndActions.append(hostMore,$('#hostEnd'));hostActions.append(hostEndActions);
  clientActions.insertBefore(clientControls,$('#clientFullscreen'));clientActions.insertBefore(clientMore,$('#clientDisconnect'));
  for(const [side,parent] of [['host',hostActions],['client',clientActions]]){
    const mic=action(`${side}CallMic`,'Mic off','volume',null,parent);mic.innerHTML=micIcon+'<span>Mic off</span>';mic.querySelector('svg').insertAdjacentHTML('beforeend','<path class="control-off-stroke" d="M3 3 21 21"/>');parent.prepend(mic);
    mic.onclick=async()=>{const room=voice(side);if(room.busy || room.micBusy){room.cancelMic();refresh();return;}if(room.active){if(room.canSpeak())await room.toggleMic();else notify('The host has disabled guest microphones. You can still listen.');}else await room.join(room.canSpeak());refresh();if(!room.busy && !room.mic)notify(room.$('status').textContent);};
    mic.setAttribute('aria-pressed','false');
    const messages=action(`${side}CallChat`,'Chat','chat',`${side}Chat`,parent);parent.insertBefore(messages,side==='host'?hostControllersAction:clientControls);const count=document.createElement('b');count.className='chat-unread';count.hidden=true;messages.append(count);
    const cam=action(`${side}CallCamera`,'Camera off','camera',null,parent),settings=action(`${side}CameraSettings`,'Camera settings','settings',`${side}Camera`,parent);settings.classList.add('camera-settings-button');settings.querySelector('span').classList.add('sr-only');settings.title='Camera settings';
    parent.insertBefore(cam,mic.nextSibling);parent.insertBefore(settings,cam.nextSibling);cam.querySelector('svg').insertAdjacentHTML('beforeend','<path class="control-off-stroke" d="M3 3 21 21"/>');cam.setAttribute('aria-pressed','false');cam.onclick=async()=>{const room=camera(side);await room.toggle();refresh();if(!room.stream && !room.busy && room.failure)notify(room.$('status').textContent);};

  }
  const globalSettings=action('callSettings','Settings','settings',null,$('.header-right'));
  globalSettings.onclick=()=>open(mode()==='host'?'hostSettings':'clientSettings',globalSettings);
  const headerInvite=action('hostHeaderInvite','Invite guests','plus','hostInvite',$('.header-right'));
  headerInvite.classList.remove('control');
  headerInvite.classList.add('primary');
  headerInvite.hidden=true;
  headerInvite.before(globalSettings);
  for(const sheet of [hostSettings,clientSettings]){const help=action(`${sheet.id}Help`,'Quick start & help','file',null,sheet.content);help.classList.add('full');help.onclick=()=>$('#showHelp').click();}
  const toolbarInvite=$('#inviteFocus');
  toolbarInvite.setAttribute('aria-controls',hostInvite.id);
  toolbarInvite.setAttribute('aria-expanded','false');
  buttons.get('hostInvite').push(toolbarInvite);
  toolbarInvite.addEventListener('click',()=>open('hostInvite',toolbarInvite),true);
  $('#hostCapture').addEventListener('click',()=>{open('hostSettings',$('#hostCapture'));settingsSections.host.select('screen');$('#hostLiveSource').open=true;},true);
  const changeSource=action('hostChangeSource','Change shared window or screen','share',null,hostActions);hostActions.insertBefore(changeSource,$('#hostStopCapture'));
  changeSource.onclick=()=>{
    open('hostSettings',changeSource);settingsSections.host.select('screen');$('#hostLiveSource').open=true;
    document.dispatchEvent(new Event('choose-main-source'));
  };
  const addScreen=action('hostCallAddScreen','Add screen or window','share',null,hostActions);addScreen.querySelector('svg').setAttribute('viewBox','0 0 24 24');addScreen.querySelector('svg').innerHTML='<g fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="7" width="16" height="13" rx="2"/><path d="M15 3h7m-3.5-3.5v7"/></g>';hostActions.insertBefore(addScreen,$('#hostStopCapture'));
  addScreen.onclick=()=>{open('hostSettings',addScreen);settingsSections.host.select('screen');$('#hostLiveSource').open=true;const extra=$('#hostExtraShares');extra.hidden=false;extra.open=true;$('#hostAddShare').click();};
  new MutationObserver(()=>{const busy=$('#hostAddShare').disabled;addScreen.disabled=busy;addScreen.setAttribute('aria-busy',String(busy));}).observe($('#hostAddShare'),{attributes:true,attributeFilter:['disabled']});
  for(const id of ['joinFocus','joinStepInvite'])$(`#${id}`).addEventListener('click',()=>open('clientPair',$(`#${id}`)),true);
  const joinActions=document.createElement('div');joinActions.className='join-actions';$('#clientEmpty').append(joinActions);
  joinActions.append($('#joinFocus'));
  const paste=action('joinPasteAction','Paste invite text','copy',null,joinActions);paste.classList.add('secondary');
  const alternateReply=action('clientReplyAlternate','Copy reply text','copy',null,joinActions);
  alternateReply.className='button secondary';alternateReply.hidden=true;
  alternateReply.onclick=()=>($('#clientPairing').dataset.transfer==='text'?$('#downloadReply'):$('#copyReply')).click();
  joinActions.insertBefore($('#clientReplyAction'),alternateReply);
  joinActions.append($('#clientControlsFocus'));
  const replyExpiry=document.createElement('p');
  replyExpiry.id='clientReplyExpiry';replyExpiry.className='small muted';replyExpiry.hidden=true;
  joinActions.after(replyExpiry);
  const linkInvites=()=>document.body.dataset.sessionInvites==='true' && document.body.dataset.sessionGuestFiles!=='true';
  function openJoinInvite(trigger,pasteText){
    open('clientPair',trigger);
    if(linkInvites())$('#sessionInviteLink')?.focus({preventScroll:true});
    else if(pasteText)$('#clientPasteInvite').click();
  }
  document.addEventListener('reopen-invite',event=>openJoinInvite(event.detail,$('#clientPairing').dataset.transfer==='text'));
  paste.onclick=()=>{
    openJoinInvite(paste,true);
  };
  $('#clientControlsFocus').addEventListener('click',()=>open('controllers',$('#clientControlsFocus')),true);
  const inviteInPeople=action('hostPeopleInvite','Invite guests','plus','hostInvite',hostPeoplePanel.content);
  hostPeoplePanel.querySelector('.call-sheet-heading .help-button').before(inviteInPeople);
  const previewOptions=document.createElement('details');previewOptions.className='call-preview-options';const summary=document.createElement('summary');summary.textContent='Preview options';previewOptions.append(summary);$('#hostPreviewSettings').before(previewOptions);previewOptions.append($('#hostPreviewSettings'));
  const previewHeading=document.createElement('div');previewHeading.className='call-preview-heading';const previewTitle=document.createElement('h3');previewTitle.textContent='Your preview';previewHeading.append(previewTitle,$('#hostMonitorToggle'));$('#hostStage').before(previewHeading);
  hostSettings.content.append($('#hostDiagnostics'));
  $('#clientSettingsSheet .settings-card > summary').textContent='Incoming stream';
  $('#hostSettings > summary').textContent='Stream quality & advanced';
  const captureAdvanced=document.createElement('details');captureAdvanced.id='captureAdvanced';captureAdvanced.className='advanced capture-advanced';captureAdvanced.innerHTML='<summary>Capture method & encoder</summary>';
  $('#hostSourceSetup').append(captureAdvanced);captureAdvanced.append($('#videoCaptureMethod'),$('#encoderCheck'));
  const methodLabel=document.createElement('label');methodLabel.className='field-label';methodLabel.htmlFor='captureBackend';methodLabel.textContent='Capture method';$('#captureBackend').before(methodLabel);
  $('#hostSourceSetup > .source-setup-heading .field-label').htmlFor='captureTarget';
  $('#captureOptions').append($('#browserAudioNote'));
  $('#driverNotice').textContent='Controller setup is needed. Open Settings for details. Screen sharing still works.';
  const connection=document.createElement('div');connection.className='call-connection';connection.append($('#hostLiveBadge'),$('#clientConnectionBadge'));$('.header-right').prepend(connection);

  const settingsSections=initSettingsSections({host:hostSettings,client:clientSettings,voice,camera,open});settingsSections.host.panes.get('screen').append($('#hostScreens'));
  function openScreenQuality(side,sourceId,trigger){
    open(`${side}Settings`,trigger);
    settingsSections[side].select('screen');
    $(side==='host'?'#hostSettings':'#clientConnectionSettings').open=true;
    if(side==='host')$('#hostLiveSource').open=false;
    if(side==='host')document.dispatchEvent(new CustomEvent('select-host-screen-quality',{detail:{sourceId,focus:true}}));
    else $('#clientResolution').focus();
  }
  document.addEventListener('screen-quality-settings',event=>{
    const {side,sourceId,trigger}=event.detail;
    openScreenQuality(side,sourceId,trigger);
  });
  for(const trigger of [hostMore,globalSettings])trigger.addEventListener('click',()=>{
    if(mode()==='host' && hostSettings.open){
      $('#hostLiveSource').open=false;
      $('#hostSettings').open=true;
      settingsSections.host.select('screen');
      document.dispatchEvent(new Event('select-host-screen-quality'));
    }
  });
  const shareSettings=action('clientScreenSettingsMore','Screen sharing settings','share','clientScreen',streamActions);
  shareSettings.className='button secondary';
  const inputSetup=document.createElement('details');inputSetup.id='hostSessionControls';inputSetup.className='advanced session-input-setup';
  inputSetup.innerHTML=`<summary><span>Keyboard &amp; mouse</span><span id="hostSessionControlsState">Off</span></summary>`;
  $('#hostPlayerOptions').before(inputSetup);
  const guestControls=$('#hostGuestSettings'),desktopAccess=guestControls.querySelector('details');desktopAccess.id='hostDesktopAccess';desktopAccess.open=true;
  desktopAccess.querySelector('summary').textContent='Keyboard & mouse access';
  const cursorOptions=document.createElement('details');cursorOptions.className='advanced';cursorOptions.innerHTML='<summary>Guest cursors</summary>';
  for(const child of [...desktopAccess.children]){if(child.tagName==='SUMMARY')continue;if(child.tagName==='H4' && child.textContent==='Guest cursors'){child.remove();continue;}if(child.tagName==='H4' && child.textContent.startsWith('Desktop control')){child.remove();break;}cursorOptions.append(child);}
  desktopAccess.append(cursorOptions);
  const setupNote=document.createElement('p');setupNote.id='hostDesktopSetupNote';setupNote.className='small muted';desktopAccess.querySelector('summary').after(setupNote);
  const keyboardOption=$('#hostAllowKeyboard').closest('label');keyboardOption.hidden=true;keyboardOption.nextElementSibling.hidden=true;
  const fullLabel=$('#hostDesktopFull').closest('label');fullLabel.hidden=true;
  const scopeLabel=document.createElement('label');scopeLabel.className='field-label';scopeLabel.htmlFor='hostDesktopScope';scopeLabel.textContent='Desktop control';
  const scope=document.createElement('select');scope.id='hostDesktopScope';scope.innerHTML='<option value="off">Off</option><option value="window">Shared window only</option><option value="desktop">Entire desktop</option>';fullLabel.before(scopeLabel,scope);
  scope.onchange=()=>{const full=$('#hostDesktopFull');full.checked=scope.value==='desktop';full.dispatchEvent(new Event('change'));document.dispatchEvent(new Event('desktop-scope-choice'));};
  const sourceAction=document.createElement('button');sourceAction.id='hostChooseControlWindow';sourceAction.type='button';sourceAction.className='button small-button';sourceAction.textContent='Choose a window…';$('#hostMouseScopeNote').after(sourceAction);
  const caution=document.createElement('p');caution.id='hostInputCaution';caution.className='input-caution';caution.innerHTML='<strong>CAUTION</strong><span></span>';sourceAction.after(caution);
  const oldWarning=caution.nextElementSibling;if(oldWarning?.tagName==='P')oldWarning.remove();
  const modeNote=document.createElement('p');modeNote.id='hostDesktopModeNote';modeNote.className='small muted';scope.after(modeNote);
  const permissions=document.createElement('div');permissions.id='hostDesktopPermissions';$('#hostMouseScopeNote').before(permissions);
  let moving=false;for(const child of [...desktopAccess.children]){if(child.id==='hostMouseScopeNote')moving=true;if(child===cursorOptions)break;if(moving)permissions.append(child);}
  inputSetup.append(guestControls);
  const hostAccess=document.createElement('p');hostAccess.id='hostAccessSummary';hostAccess.className='access-summary';guestControls.prepend(hostAccess);
  const clientAccess=document.createElement('p');clientAccess.id='clientAccessSummary';clientAccess.className='access-summary';$('#clientStage').before(clientAccess);
  const mediaNotice=document.createElement('p');mediaNotice.id='clientMediaPermissionNote';mediaNotice.className='media-permission-note';$('#clientStage').after(mediaNotice);
  const audioAction=$('#clientUnmute');
  const setText=(el,text)=>{if(el.textContent!==text)el.textContent=text;};
  for(const side of ['host','client']){voice(side).onChange=schedule;camera(side).onChange=schedule;screens(side).onChange=schedule;}

  let panelTopFrame;
  function positionPanels(){
    panelTopFrame=null;
    const header=$('.app-header');
    const panelTop=getComputedStyle(header).getPropertyValue('--theme-panel-top');
    const top=panelTop.trim() || `${Math.max(8,Math.round(header.getBoundingClientRect().bottom+10))}px`;
    const bar=mode()==='host'?hostToolbar:$('#clientToolbar');
    const rect=bar.getBoundingClientRect();
    const aboveToolbar=rect.height && (getComputedStyle(bar).position==='fixed' || document.fullscreenElement?.contains(bar));
    const bottom=aboveToolbar?Math.max(12,Math.round(innerHeight-rect.top+10)):18;
    const style=document.documentElement.style;
    for(const [property,value] of [['--call-panel-top',top],['--call-panel-bottom',`${bottom}px`]]){
      if(style.getPropertyValue(property)!==value)style.setProperty(property,value);
    }
    const quick=$('.device-quick-sheet[open]');
    if(quick?.returnFocus){
      const trigger=quick.returnFocus.getBoundingClientRect(),width=quick.offsetWidth;
      const centered=trigger.left+(trigger.width-width)/2;
      quick.style.setProperty('--device-panel-left',`${Math.max(8,Math.min(innerWidth-width-8,centered))}px`);
    }
  }
  function schedulePanelPosition(){if(!panelTopFrame)panelTopFrame=requestAnimationFrame(positionPanels);}
  const panelPositionObserver=new ResizeObserver(schedulePanelPosition);for(const element of [$('.app-header'),hostToolbar,$('#clientToolbar')])panelPositionObserver.observe(element);for(const event of ['app-mode','appearance-change','fullscreenchange'])document.addEventListener(event,schedulePanelPosition);window.addEventListener('scroll',schedulePanelPosition,{passive:true});window.addEventListener('resize',schedulePanelPosition,{passive:true});positionPanels();


  function hostedLayout(){
    const host=$('#sessionHostInvite'),guest=$('#sessionGuestInvite'),connection=$('#sessionConnection');
    if(host && host.parentElement!==hostInvite.content)hostInvite.content.prepend(host);
    if(guest && guest.parentElement!==clientPair.content)clientPair.content.prepend(guest);
    const target=mode()==='host'?hostInvite:clientPair;
    if(connection && connection.parentElement!==target.content)target.content.prepend(connection);
  }
  function refresh(){
    changeSource.hidden=$('#hostStopCapture').hidden || $('#hostAudioOnly').checked || $('#hostCapture').dataset.starting==='true';
    const screen=screens('client'),sharing=!!screen.stream;screenButton.querySelector('span').textContent=screen.busy?'Cancel sharing':sharing?'Stop share':'Share screen';screenButton.classList.toggle('active',sharing);screenButton.setAttribute('aria-pressed',String(sharing));screenButton.disabled=!screen.ready || !screen.canShare() && !sharing || screen.handoffLocked===true;screenButton.setAttribute('aria-busy',String(!!screen.busy));screenButton.title=screen.busy?'Cancel screen selection':sharing?'Stop sharing your screen':!screen.canShare()?'Screen sharing is disabled by the host':'Share a window or screen';screenSettings.disabled=!screen.ready;shareSettings.hidden=!screen.ready;
    queued=false;hostedLayout();
    const active=$('#hostPanel').dataset.session==='active',connected=$('#clientConnectionText').textContent==='Connected',guests=Number($('#peopleCount').textContent)-1;
    document.body.dataset.callActive=String(mode()==='host'?active:connected);
    headerInvite.hidden=!active || mode()!=='host';
    if(active && !previousHost && !$('#helpDialog').open)open('hostInvite',headerInvite);
    if(!active && previousHost)for(const sheet of [hostInvite,hostSettings,hostChatPanel,hostPeoplePanel,hostControllerPanel])close(sheet);
    const extraCount=$('#hostExtraShares').querySelectorAll('.extra-share-row').length;if(active && $('#hostStopCapture').hidden){if(extraCount)setText($('#hostLiveText'),`Sharing ${extraCount} ${extraCount===1?'screen':'screens'}`);else if(/^Sharing \d+ screens?$/.test($('#hostLiveText').textContent))setText($('#hostLiveText'),'Not sharing yet');$('#hostLiveBadge').classList.toggle('is-live',extraCount>0);}
    addScreen.classList.toggle('active',extraCount>0);
    hostPeopleAction.setAttribute('aria-label',`People · ${Math.max(1,guests+1)} in session`);hostPeopleAction.dataset.count=String(Math.max(1,guests+1));
    if(guests>previousGuests && !$('#helpDialog').open)close(hostInvite);
    if(connected && !previousConnected && !$('#helpDialog').open)close(clientPair);
    if(!connected && previousConnected){close(clientChatPanel);close(clientPeoplePanel);}clientPeopleAction.hidden=!connected;
    previousHost=active;previousGuests=guests;previousConnected=connected;document.dispatchEvent(new Event('call-settings-refresh'));$('#hostLiveBadge').hidden=mode()!=='host';$('#clientConnectionBadge').hidden=mode()!=='client';
    const controllerSummary = $('#hostControllerSummary');
    if (controllerSummary && controllerSummary.parentElement !== hostControllerActions) hostControllerActions.prepend(controllerSummary);
    const recovering=['waiting','expired'].includes(document.body.dataset.callRecovery);joinSetup.hidden=connected || recovering;$('#clientPanel').dataset.prejoin=String(!connected && !recovering);$('#clientToolbar').hidden=!connected && !recovering;$('#clientCancelJoin').hidden=connected || $('#clientDisconnect').disabled;const permissions=$('#hostMediaPermissions'),permissionParent=$('#hostGuestSettings');if(active){if(permissions.parentElement!==permissionParent)permissionParent.prepend(permissions);}else if(permissions.nextElementSibling!==inputSetup)inputSetup.before(permissions);
    const preparedCamera=camera('client'),preparing=mode()==='client' && !connected && !recovering && !document.fullscreenElement;
    for(const sheet of [controllers,clientCameraSettings,clientSettings]){
      const inline=preparing;sheet.classList.toggle('prejoin-sheet',inline);
      if(inline){if(sheet.parentElement!==joinSetup)joinSetup.append(sheet);}
      else if(document.fullscreenElement===$('#clientStage')){if(sheet.parentElement!==$('#clientStage'))$('#clientStage').append(sheet);}
      else if(sheet.home && sheet.parentElement!==sheet.home.parentElement)sheet.home.after(sheet);
    }
    const gallery=preparedCamera.gallery;if(preparing){if(gallery.parentElement!==joinSetup)joinSetup.append(gallery);}else if(gallery.parentElement===joinSetup)preparedCamera.home.after(gallery);
    const controllerRows=[...$('#connectedControllers').querySelectorAll('[data-controller-id]')];
    const detectedControllers=new Set(controllerRows.map(row=>row.dataset.controllerId).filter(id=>id!=='keyboard'));
    const selected=controllerRows.filter(row=>row.querySelector('.controller-select[aria-pressed=true]')).length;
    const controllersOn=$('#clientJoinControllers').checked;
    const preparedControls=$('#clientPrepareControllers');
    setText(preparedControls.querySelector('.join-device-state'),!controllersOn?'Off':selected?`${selected} ready`:detectedControllers.size?`${detectedControllers.size} detected`:'Connect & press a button');
    preparedControls.classList.toggle('device-ready',controllersOn && (selected>0 || detectedControllers.size>0));
    setText($('#clientPrepareCamera .join-device-state'),preparedCamera.busy?'Opening…':preparedCamera.stream?'Private preview':'Off');
    const preparedMic=voice('client');setText($('#clientPrepareMic .join-device-state'),preparedMic.micBusy?'Opening…':preparedMic.mic && !preparedMic.muted?'Private mic test':'Off');
    const hostPermission=accessCaption({scope:$('#hostDesktopScope').value,mouse:$('#hostDesktopScope').value!=='off' && $('#hostDesktopMouse').checked && !$('#hostDesktopMouse').disabled,keyboard:$('#hostDesktopScope').value!=='off' && $('#hostDesktopKeyboard').checked && !$('#hostDesktopKeyboard').disabled,pointers:$('#hostShowGuestCursors').checked});setText(hostAccess,hostPermission);
    const guestAccess={scope:$('#clientPanel').dataset.desktopScope,mouse:$('#clientDesktopMouse').checked && !$('#clientDesktopMouse').disabled,keyboard:$('#clientDesktopTyping').checked && !$('#clientDesktopTyping').disabled,pointers:$('#clientPanel').dataset.guestPointers==='true'};
    clientAccess.hidden=!connected || !(guestAccess.mouse || guestAccess.keyboard || guestAccess.pointers);
    setText(clientAccess,accessCaption(guestAccess));
    const blocked=[];
    if(!preparedCamera.guestVideoAllowed)blocked.push('cameras');
    if(!voice('client').canSpeak())blocked.push('microphones');
    mediaNotice.hidden=!connected || !blocked.length;
    setText(mediaNotice,blocked.length?`Host disabled guest ${blocked.join(' and ')}.`:'');
    for(const row of $('#peerList').querySelectorAll('.peerRow')){let state=row.querySelector('.guest-media-status');if(!state){state=document.createElement('span');state.className='guest-media-status';row.querySelector('.peer-info').append(state);}const member=camera('host').roster.find(m=>m.id===row.dataset.peerId),talker=voice('host').roster.find(m=>m.id===row.dataset.peerId);setText(state,[mediaCaption({camera:member?.camera,mic:talker?.mic,voice:!!talker}),screens('host').roster.some(m=>m.id===row.dataset.peerId && m.camera)?'Sharing screen':''].filter(Boolean).join(' · '));}

    const controllerStatus=$('#clientEnablePad').dataset;
    const inUse=Number(controllerStatus.joined || 0);
    const paused=inUse>0 && $('#clientEnablePad').getAttribute('aria-pressed')==='false';
    const text=paused?'Controllers paused':inUse?`Controllers · ${inUse}`:'Controllers';if(clientControls.querySelector('span').textContent!==text)clientControls.querySelector('span').textContent=text;
    clientControls.dataset.count=inUse?String(inUse):'';
    clientControls.classList.toggle('active',inUse>0 && !paused);clientControls.setAttribute('aria-label',inUse?text:detectedControllers.size?`Controllers · ${detectedControllers.size} detected`:'Controllers');
    const waitingForHost=['Waiting for your friend','Connecting','Reconnecting'].includes($('#clientConnectionText').textContent);
    const linkOnly=linkInvites();
    $('#joinFocus').hidden=linkOnly || connected || recovering || waitingForHost;
    paste.hidden=connected || recovering || waitingForHost;
    paste.classList.toggle('primary',linkOnly);paste.classList.toggle('secondary',!linkOnly);
    setText(paste.querySelector('span'),linkOnly?'Use session link':'Paste invite text');
    const peerReadiness=[...$('#peerList').querySelectorAll('.peerRow')].map(row=>({state:row.dataset.connection,wantsController:row.dataset.wantsController==='true',count:Number(row.dataset.controllers),error:row.dataset.controllerError==='true'}));
    const guestControllerCount=peerReadiness.reduce((total,peer)=>total+(peer.count || 0),0);
    hostControllersAction.setAttribute('aria-label',guestControllerCount?`Controllers · ${guestControllerCount} joined`:'Controllers');
    hostControllersAction.dataset.count=guestControllerCount?String(guestControllerCount):'';
    hostControllersAction.classList.toggle('active',guestControllerCount>0);
    const newController=[...detectedControllers].some(id=>!seenControllers.has(id));
    seenControllers=detectedControllers;
    const desktopControl=$('#hostDesktopScope').value!=='off' && ($('#hostDesktopMouse').checked && !$('#hostDesktopMouse').disabled || $('#hostDesktopKeyboard').checked && !$('#hostDesktopKeyboard').disabled);
    const hostStep=$('#hostNextStep');
    hostStep.classList.toggle('call-step-complete',hostStep.dataset.action==='players' && controllersReady(peerReadiness,{desktopControl}));
    for(const side of ['host','client']){
      const roomChat=chat(side),chatButton=$(`#${side}CallChat`),count=chatButton.querySelector('.chat-unread');chatButton.hidden=!roomChat.ready;count.hidden=!roomChat.unread;const unread=String(roomChat.unread);if(count.textContent!==unread)count.textContent=unread;chatButton.setAttribute('aria-label',roomChat.unread?`Chat, ${roomChat.unread} unread messages`:'Chat');chatButton.classList.toggle('has-unread',roomChat.unread>0);roomChat.onOpen=()=>open(`${side}Chat`,chatButton);
      const camRoom=camera(side),camButton=$(`#${side}CallCamera`),camOn=!!camRoom.stream,camLabel=camRoom.busy?'Cancel camera':camOn?camRoom.canShare()?'Camera on':'Camera preview':'Camera off';if(camButton.querySelector('span').textContent!==camLabel)camButton.querySelector('span').textContent=camLabel;camButton.setAttribute('aria-busy',String(!!camRoom.busy));camButton.disabled=!camRoom.ready || camRoom.handoffLocked===true;camButton.classList.toggle('active',camOn);camButton.setAttribute('aria-pressed',String(camOn));camButton.title=camRoom.busy?'Cancel camera':camOn?camRoom.canShare()?'Turn camera off':'Private preview · not shared':!camRoom.host && camRoom.guestVideoAllowed===false?'Guest cameras are disabled by the host':'Turn camera on';camButton.setAttribute('aria-label',`${camLabel}. ${camButton.title}`);camButton.dataset.on=String(camOn);$(`#${side}CameraSettings`).disabled=!camRoom.ready;
      const room=voice(side),button=$(`#${side}CallMic`),on=room.active && room.mic && !room.muted;
      if(side==='client')for(const control of [button,camButton]){
        const ids=(control.getAttribute('aria-describedby') || '').split(/\s+/).filter(id=>id && id!==mediaNotice.id);
        if(blocked.length)ids.push(mediaNotice.id);
        const description=ids.join(' ');
        if(description)control.setAttribute('aria-describedby',description);else control.removeAttribute('aria-describedby');
      }
      const text=room.busy || room.micBusy?'Cancel mic':!room.canSpeak() && room.ready?room.active?'Listening':'Listen only':on?'Mic on':'Mic off';if(button.querySelector('span').textContent!==text)button.querySelector('span').textContent=text;
      button.disabled=!room.ready || room.handoffLocked===true;button.setAttribute('aria-busy',String(!!(room.busy || room.micBusy)));button.classList.toggle('active',!!on);button.setAttribute('aria-pressed',String(!!on));button.title=room.busy || room.micBusy?'Cancel microphone setup':!room.canSpeak()?room.active?'Guest microphones are disabled by the host · listening only':'Listen to the call · guest microphones are disabled by the host':on?'Mute microphone':room.active?'Turn microphone on':'Join voice with your microphone';button.setAttribute('aria-label',`${text}. ${button.title}`);button.dataset.on=String(!!on);
      const status=$(`#${side}Status`);
      if(side==='client')status.dataset.connectionProgress=String(/^(new|connecting)$/i.test(status.textContent));
      status.parentElement.hidden=!status.textContent || routineStatus.test(status.textContent) || side==='client' && recovering && connectionStatus.test(status.textContent);
    }
    const hostError=!$('#hostPairError').hidden,clientError=!$('#clientPairError').hidden;
    if(hostError && !lastHostError && mode()==='host')open('hostInvite');
    if(clientError && !lastClientError && mode()==='client')open('clientPair');lastHostError=hostError;lastClientError=clientError;
    if(mode()==='host'){
      const hasReply=hostStep.dataset.action==='hostReplyFile';
      const needsInvite=guests===0 && !hostError;
      const panelAction=hasReply?$('label[for=hostReplyFile]'):$('#'+hostStep.dataset.action);
      const visibleAction=hostInvite.open?panelAction:$('#hostNextAction').getClientRects().length?$('#hostNextAction'):headerInvite;
      cueNextAction(!active?$('#hostCreate'):hasReply || needsInvite?visibleAction:null);
    }else{
      const canPlay=controllerStatus.ready==='true' && controllerStatus.canPlay==='true';
      const needsController=controllersOn && canPlay && !inUse && !Number(controllerStatus.pending) && !controllers.open;
      const joinAction=clientPair.open?(linkOnly?$('#sessionJoinLink'):$('#clientInvitation').closest('details').open?$('#createReply'):$('label[for=clientInvitationFile]')):linkOnly?paste:$('#joinFocus');
      const soundBlocked=audioAction.classList.contains('needs-audio-gesture');
      const action=recovering?(clientPair.open?joinAction:$('#callReconnecting button:not([hidden])')):connected?(needsController?clientControls:soundBlocked?audioAction:null):waitingForHost?($('#clientReplyAction').classList.contains('primary') && !$('#clientReplyAction').hidden?$('#clientReplyAction'):null):joinAction;
      if(newController && controllersOn && !controllers.open && (!connected || canPlay) && (action!==clientControls || nextAction===clientControls))nudge(connected?clientControls:preparedControls);
      cueNextAction(action);
    }
    labelControls();
  }
  function schedule(){if(queued)return;queued=true;requestAnimationFrame(refresh);}
  const observer=new MutationObserver(schedule);
  for(const [selector,options] of [
    ['#hostPanel',{attributes:true,attributeFilter:['data-session']}],['#peopleCount',{childList:true}],['#hostControllerSummary',{childList:true}],
    ['#hostStopCapture',{attributes:true,attributeFilter:['hidden']}],
    ['#hostNextTitle',{childList:true}],['#peerList',{childList:true}],['#clientConnectionText',{childList:true}],['#clientEnablePad',{attributes:true,attributeFilter:['data-joined','data-ready','data-can-play','data-pending','aria-pressed']}],['#clientDesktopMouse',{attributes:true,attributeFilter:['disabled']}],['#clientDesktopTyping',{attributes:true,attributeFilter:['disabled']}],['#hostDesktopMouse',{attributes:true,attributeFilter:['disabled']}],['#hostDesktopKeyboard',{attributes:true,attributeFilter:['disabled']}],
    ['#connectedControllers',{childList:true,subtree:true,characterData:true}],['#hostStatus',{childList:true}],['#clientStatus',{childList:true}],
    ['#clientUnmute',{attributes:true,attributeFilter:['class']}],
    ['#hostPairError',{attributes:true,attributeFilter:['hidden']}],['#clientPairError',{attributes:true,attributeFilter:['hidden']}],
    ['#hostCamera',{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','disabled','aria-pressed']}],['#clientCamera',{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','disabled','aria-pressed']}],
    ['#hostVoice',{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','disabled','aria-pressed']}],['#clientVoice',{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','disabled','aria-pressed']}]
  ]){const target=$(selector);if(target)observer.observe(target,options);}
  controllers.addEventListener('toggle',schedule);
  $('#clientInvitation').closest('details').addEventListener('toggle',schedule);
  document.addEventListener('reveal-call-setting',event=>{
    const target=event.detail;if(!target?.closest)return;const owner=target.closest('.call-sheet');
    for(const sheet of sheets.values())if(sheet!==owner)close(sheet);
    if(owner){openingRevision++;owner.open=true;}
  });
  document.addEventListener('call-recovery',event=>{document.body.dataset.callRecovery=event.detail;schedule();});document.addEventListener('change',schedule);document.addEventListener('chat-state',schedule);document.addEventListener('mobile-layout',schedule);document.addEventListener('quick-start',event=>{
    if(['session-invited','guest-requested'].includes(event.detail))open(mode()==='host'?'hostInvite':'clientPair');schedule();
  });
  document.addEventListener('host-shares-change',schedule);
  document.addEventListener('call-share-ready',()=>{if(!$('#helpDialog').open && $('#hostLiveSource').open)close(hostSettings);});
  document.addEventListener('app-mode',()=>{for(const sheet of sheets.values())close(sheet);schedule();});
  document.addEventListener('keydown',event=>{
    if(event.key!=='Escape' || document.querySelector('dialog[open]'))return;
    const menus=[...document.querySelectorAll('.peer-menu[open]')];if(menus.length){for(const menu of menus){menu.open=false;menu.querySelector('summary')?.focus({preventScroll:true});}event.preventDefault();event.stopPropagation();return;}
    for(const sheet of sheets.values())if(sheet.open){event.preventDefault();close(sheet,true);}
  });
  // Dismiss menus before a click reaches a remote desktop surface. A dismiss
  // click must not also click the host's application underneath the panel.
  const dismissedPointers=new Set();
  document.addEventListener('pointerdown',event=>{
    dismissedPointers.delete(event.pointerId);
    if(document.querySelector('dialog[open]'))return;
    const peerMenu=event.target.closest('.peer-menu'),menus=[...document.querySelectorAll('.peer-menu[open]')].filter(menu=>menu!==peerMenu);for(const menu of menus)menu.open=false;
    const onSurface=event.target.closest('.video-stage') && !event.target.closest('.call-sheet,.call-toolbar,button,input,select,textarea,a,summary,[role=separator],.streamer-camera,.tile-layout-controls,.view-swap-controls,.controller-join-prompt,.single-view-picker');
    if(!onSurface)return;
    const panels=[...sheets.values()].filter(sheet=>sheet.open && !sheet.classList.contains('chat-sheet') && !sheet.classList.contains('prejoin-sheet'));
    if(!menus.length && !panels.length)return;
    for(const sheet of panels)close(sheet,true);dismissedPointers.add(event.pointerId);event.preventDefault();event.stopPropagation();
  },true);
  for(const type of ['pointerup','pointercancel','click','contextmenu'])document.addEventListener(type,event=>{if(!dismissedPointers.has(event.pointerId))return;if(type==='pointerup')setTimeout(()=>dismissedPointers.delete(event.pointerId),0);else dismissedPointers.delete(event.pointerId);event.preventDefault();event.stopPropagation();},true);
  window.addEventListener('blur',()=>dismissedPointers.clear());
  // Dismiss ordinary outside clicks after the target has handled its action.
  // Closing on pointerdown can reflow the page and move a control before pointerup.
  document.addEventListener('click',event=>{
    // An opener's click must not immediately dismiss the panel it just opened.
    if(clickRevisions.get(event)!==openingRevision)return;
    const path=event.composedPath(),peerMenu=path.find(node=>node.matches?.('.peer-menu'));for(const menu of document.querySelectorAll('.peer-menu[open]'))if(menu!==peerMenu)menu.open=false;
    // Some controls rebuild their label during the click; keep its original ancestry.
    if(document.querySelector('dialog[open]') || path.some(node=>node.matches?.('dialog, .call-sheet, .call-toolbar, .header-right, .join-device-choices, .join-device-heading-actions')))return;
    for(const sheet of sheets.values())if(!sheet.classList.contains('chat-sheet'))close(sheet);
  });
  // Fullscreen retains these exact panels and controls, including their state.
  const [hostVoiceQuick,clientVoiceQuick]=voiceQuickPanels;
  const clientFullscreenPanels=[clientPair,controllers,clientChatPanel,clientCameraSettings,clientSettings,clientScreenPanel,clientPeoplePanel,clientVoiceQuick];
  const hostFullscreenPanels=[hostInvite,hostPeoplePanel,hostControllerPanel,hostSettings,hostChatPanel,hostCameraSettings,hostVoiceQuick];
  const sharedFullscreenPanels=[$('#helpDialog'),$('#handoffPrompt'),$('#switchInvitePrompt'),$('#toast')],fullscreenPanels=[...clientFullscreenPanels,...hostFullscreenPanels,...sharedFullscreenPanels];
  for(const sheet of fullscreenPanels){sheet.home=document.createComment('Call panel');sheet.before(sheet.home);}
  document.addEventListener('fullscreenchange',()=>{
    const stage=document.fullscreenElement,host=stage===$('#hostWatchStage'),client=stage===$('#clientStage');hostFullscreen.querySelector('span').textContent=host?'Exit fullscreen':'Fullscreen';hostFullscreen.setAttribute('aria-pressed',String(host));
    for(const sheet of fullscreenPanels){const wanted=host && (hostFullscreenPanels.includes(sheet) || sharedFullscreenPanels.includes(sheet)) || client && (clientFullscreenPanels.includes(sheet) || sharedFullscreenPanels.includes(sheet));if(wanted)stage.append(sheet);else sheet.home.after(sheet);}
  });
  function labelControls(){
    for(const button of document.querySelectorAll('.call-toolbar button')){
      const raw=[...button.childNodes].filter(n=>n.nodeType===Node.TEXT_NODE && n.textContent.trim());
      if(raw.length){const label=document.createElement('span');label.textContent=raw.map(n=>n.textContent.trim()).join(' ');for(const node of raw)node.remove();button.append(label);}
      const managed=/Call(Mic|Camera|Controllers|Chat|People)$|CameraSettings$|MicSettings$|^clientUnmute$/.test(button.id);
      if(!managed){
        const label=button.querySelector('span')?.textContent.trim();
        if(label)button.setAttribute('aria-label',button.id.endsWith('CallSettings')?'More settings':label);
      }
      const usesOwnHint=/CameraSettings$|MicSettings$|^clientUnmute$|^clientCallShare$/.test(button.id);
      const tooltip=button.title || (usesOwnHint?button.dataset.tooltip:'') || button.getAttribute('aria-label') || button.textContent.trim();
      if(button.dataset.tooltip!==tooltip)button.dataset.tooltip=tooltip;
      if(button.hasAttribute('title'))button.removeAttribute('title');
    }
  }
  const labelObserver=new MutationObserver(labelControls);for(const bar of [hostActions,clientActions])labelObserver.observe(bar,{childList:true,subtree:true,characterData:true});labelControls();
  refresh();if($('#helpDialog').open)document.dispatchEvent(new CustomEvent('quick-start',{detail:'refresh'}));
  return {open,settings:settingsSections,closeAll:()=>{for(const sheet of sheets.values())close(sheet);}};
}
