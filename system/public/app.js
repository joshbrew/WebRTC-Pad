import {GuestViewCheck,initCallComfort,guestCaption,addControllerTest,updateLiveTests,ReconnectGrace,cleanGuestView,readPreference,writePreference} from './call-comfort.js';
import {independentPlayback} from './playback.js';
import {prepareVideoHandover} from './video-handover.js';
import {videoHealth} from './video-health.js';
import {VoiceRoom} from './voice.js';
import {CameraRoom} from './camera.js';
import {ScreenRoom} from './screen-room.js';
import {ScreenLayouts} from './screen-layout.js';
import {SessionChat} from './chat.js';
import {connectionCheckUI} from './connection-check.js';
import {cleanRumble,playRumble} from './rumble.js';
import {relativeMouse} from './relative-mouse.js';
import {sessionPresets} from './session-presets.js';
import {loadLastSession,storeLastSession,restoreLastFields,lastSessionFields,matchLastSource,sessionPage,browserSourceLabel} from './last-session.js';
import {fileUploadAllowed} from './file-transfer.js';
import {Participants} from './participants.js';
import {HostHandoff,waitFor} from './handoff.js';
import {KeyboardMapping,keyName} from './keyboard-mapping.js';
import {voiceDescription} from './voice-quality.js';
import {Diagnostics} from './diagnostics.js';
import {ConnectionReports} from './connection-report.js';
import {NativeGuestInput} from './guest-input.js';
import { buttonLabels, packGamepadState, neutralState, keyboardState, inputPacer } from './input.js';
import {inputWireVersion,inputPayload,decodeInputPacket,inputQueueLimit} from './input-wire.js';
import {codecSupport} from './codecs.js';
import {SessionInvites} from './sessions.js';
import {controllerPresence} from './controller-presence.js';
import {HostShares,guestViewSelector} from './host-shares.js';
import {sourcePicker} from './source-picker.js';
import {CaptureArea} from './capture-region.js';
import {HostViewPopouts,GuestViewPopouts} from './view-popouts.js';
import {GuestTiles} from './guest-tiles.js';
import {initCallShell} from './call-shell.js';
import {AppInputs} from './app-inputs.js';
import {ReverseControllers} from './reverse-controllers.js';
import {fullscreenToolbar} from './stage-controls.js';
import { addCandidate, setRemote, acceptInput, replaceCapture, applySenderQuality, preferLowLatency, inputChannelOptions } from './rtc.js';
import { streamSettings, captureConstraints, applyCaptureSettings, qualityLabel } from './media.js';
import { isPlayerSlot, playerSlots } from './players.js';
import { receivedVideoStats, videoStatsLabel } from './stats.js';
import { clientQuality, effectiveQuality, adaptQuality, nativeEncodingKey, qualityFloor } from './quality.js';
import { desktopCodes, desktopSnapshot, videoPoint } from './desktop.js';
import { cursorLayer, cursorColor } from './cursors.js';
import { gatherIce, pairingPacket, parsePairing, downloadPairing, sanitizeIceConfig, connectionFailure, filePairingBrowserHint } from './pairing.js';
import { initUI, modeUI, hostSessionUI, hostSharingUI, peopleUI, pairingUI, pairingFeedback, playerConnectionUI, playerVideoUI, inputLatencyUI, controllerUI, inputSourceUI, soundUI, toast } from './ui.js';
const $ = selector => document.querySelector(selector);
$('#clientVideo').muted=readPreference('sharedSound',true)===false;
$('#clientAudio').muted=$('#clientVideo').muted;
$('#clientAudio').addEventListener('shared-audio-playback',()=>soundUI($('#clientVideo').muted));
let participants,inputStreams,reverseControllers;
function autoDownloadPairing(button){button.dataset.automaticDownload='true';try{button.click();}finally{delete button.dataset.automaticDownload;}}
const hostConnectionReports=new ConnectionReports('host'),clientConnectionReports=new ConnectionReports('guest');
async function saveConnectionReport(reports,button){
  button.disabled=true;const label=button.textContent;button.textContent='Preparing diagnostics…';
  try{await reports.download();}catch{toast('Could not save diagnostics. Please try again.');}finally{button.disabled=false;button.textContent=label;}
}
for(const [side,reports] of [['host',hostConnectionReports],['client',clientConnectionReports]]){
  const button=document.createElement('button');button.id=`${side}SaveConnectionReport`;button.className='button secondary full';button.textContent='Save connection diagnostics';button.onclick=()=>saveConnectionReport(reports,button);$(`#${side}NetworkGuide`).before(button);
}
const trackVoice=(pc,host)=>(host?hostConnectionReports:clientConnectionReports).track(pc,'voice');
const send = (ws, data) => { if (ws?.readyState === WebSocket.OPEN && ws.bufferedAmount < 32768) ws.send(JSON.stringify(data)); };
const socketUrl = route => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${route}`;
const parse = raw => { try { return JSON.parse(raw); } catch { return null; } };
let hostVoice=new VoiceRoom($('#hostVoice'),{host:true,ice:()=>fetchIce(hostRoom?.roomId),trackPeer:trackVoice});
let clientVoice=new VoiceRoom($('#clientVoice'),{ice:async()=>clientPeer?.pc.getConfiguration() || {iceServers:[]},trackPeer:trackVoice});
for(const side of ['host','client']){let original=null;$(`#${side}Voice`).addEventListener('voice-duck',event=>{const video=$(event.currentTarget.id==='hostVoice'?'#hostPreview':'#clientVideo');if(event.detail<1){if(original && original.video!==video){original.video.volume=original.volume;original=null;}original ||= {video,volume:video.volume};video.volume=original.volume*event.detail;}else if(original){original.video.volume=original.volume;original=null;}});}
const cameraRoot=side=>{const root=document.createElement('section');root.id=`${side}Camera`;root.className='sidebar-card camera-card';root.hidden=true;$(`#${side}Voice`).before(root);return root;};
let hostCamera=new CameraRoom(cameraRoot('host'),{host:true,stage:$('#hostStage'),ice:()=>fetchIce(hostRoom?.roomId),trackPeer:(pc,host)=>(host?hostConnectionReports:clientConnectionReports).track(pc,'camera'),pressure:id=>{const p=hostPeers.get(id);return performance.now()-(p?.cameraPressureAt || 0)<5000?p?.cameraPressure:null;}});
let clientCamera=new CameraRoom(cameraRoot('client'),{stage:$('#clientStage'),ice:async()=>clientPeer?.pc.getConfiguration() || {iceServers:[]},trackPeer:(pc,host)=>(host?hostConnectionReports:clientConnectionReports).track(pc,'camera'),pressure:()=>performance.now()-(clientPeer?.cameraPressureAt || 0)<5000?clientPeer?.cameraPressure:null,receivePressure:()=>performance.now()-(clientPeer?.cameraPressureAt || 0)<5000?clientPeer?.cameraPressure:null});
for(const room of [hostCamera,clientCamera])room.mediaControls=function(owner){return participantMediaControls(this.host?'host':'client',owner);};
const screenRoot=side=>{const root=document.createElement('section');root.id=`${side}Screens`;$(`#${side}Voice`).before(root);return root;};
let hostScreens=new ScreenRoom(screenRoot('host'),{host:true,stage:$('#hostStage'),ice:()=>fetchIce(hostRoom?.roomId),trackPeer:(pc,host)=>(host?hostConnectionReports:clientConnectionReports).track(pc,'guest-screen'),pressure:id=>hostCamera.pressure(id)});
let clientScreens=new ScreenRoom(screenRoot('client'),{stage:$('#clientStage'),ice:async()=>clientPeer?.pc.getConfiguration() || {iceServers:[]},trackPeer:(pc,host)=>(host?hostConnectionReports:clientConnectionReports).track(pc,'guest-screen'),pressure:()=>clientCamera.pressure(),receivePressure:()=>clientCamera.receivePressure()});
const screenPermission=document.createElement('label');screenPermission.className='check-row';screenPermission.innerHTML='<input id="hostAllowGuestScreens" type="checkbox" checked /> Screens';$('#hostMediaPermissions').append(screenPermission);$('#hostAllowGuestScreens').onchange=()=>hostScreens.setGuestVideoAllowed($('#hostAllowGuestScreens').checked);
$('#hostAllowGuestVideo').onchange=()=>hostCamera.setGuestVideoAllowed($('#hostAllowGuestVideo').checked);
$('#hostAllowGuestMic').onchange=()=>hostVoice.setGuestMicAllowed($('#hostAllowGuestMic').checked);
const chatRoot=side=>{const root=document.createElement('section');root.id=`${side}Chat`;$(`#${side}Voice`).before(root);return root;};
function chatFocus(){releaseClient();if(nativeGuest.active && nativeGuest.selection.some(id=>id.startsWith('keyboard:') || id.startsWith('mouse:')))nativeGuest.stop('Keyboard/mouse paused while using call controls.');}
let hostChat=new SessionChat(chatRoot('host'),{host:true,stage:$('#hostStage'),onFocus:chatFocus}),clientChat=new SessionChat(chatRoot('client'),{stage:$('#clientStage'),onFocus:chatFocus});
function filePriorities(){hostChat.files.canUpload=id=>!hostChat.locked && fileUploadAllowed(hostPeers.get(id));clientChat.files.canUpload=()=>!clientChat.locked && fileUploadAllowed(clientPeer);}
filePriorities();
const filePermissions=document.createElement('details');filePermissions.className='advanced';filePermissions.innerHTML='<summary>Chat files &amp; clipboard</summary><label class="check-row"><input id="hostAllowFiles" type="checkbox" checked /> File transfers · recipients choose what to receive</label><label class="check-row"><input id="hostAllowClipboard" type="checkbox" /> Clipboard text sharing · send and copy manually</label>';
$('#hostMediaPermissions').append(filePermissions);
for(const id of ['hostAllowFiles','hostAllowClipboard'])$(`#${id}`).onchange=()=>hostChat.files.setPolicy({files:$('#hostAllowFiles').checked,clipboard:$('#hostAllowClipboard').checked});
const chatting=()=>!!document.querySelector('dialog[open]') || !!document.activeElement?.closest('.chat-card');
const voiceSend=ch=>message=>{if(ch.readyState==='open' && ch.bufferedAmount<65536)ch.send(JSON.stringify(message));};
const hostDiagnostics=new Diagnostics($('#hostDiagnostics'),{source:'My preview'});
const clientDiagnostics=new Diagnostics($('#clientDiagnostics'));
let diagnosticGuestNumber=0;
const hostStatus = message => { $('#hostStatus').textContent = message; };
const clientStatus = message => { $('#clientStatus').textContent = message; };
const tutorialEvent = name => document.dispatchEvent(new CustomEvent('quick-start', { detail: name }));
const hostCursors = cursorLayer($('#hostStage'), $('#hostPreview')), guestCursors = cursorLayer($('#clientStage'), $('#clientVideo'));
const iceRequests=new Map();
async function fetchIce(room = '') {
  if(iceRequests.has(room))return iceRequests.get(room);
  const pending=(async()=>{
    const response = await fetch(`/ice?room=${encodeURIComponent(room)}`, { cache: 'no-store' });
    const config = await response.json();
    if (!response.ok) throw new Error(config.error || 'Could not load network settings');
    if (config.warning) $('#networkStatus').textContent = config.warning;
    return { iceServers: config.iceServers, iceTransportPolicy: config.iceTransportPolicy || 'all' };
  })();
  iceRequests.set(room,pending);
  try{return await pending;}finally{if(iceRequests.get(room)===pending)iceRequests.delete(room);}
}
connectionCheckUI($('#hostNetworkSettings'),()=>fetchIce(hostRoom?.roomId));
connectionCheckUI($('#clientNetworkGuide').parentElement,()=>fetchIce(),$('#clientNetworkGuide'));
function showPanel(mode) { $('#hostPanel').hidden = mode !== 'host'; $('#clientPanel').hidden = mode !== 'client'; $('#controllerSetup').hidden = mode !== 'client'; modeUI(mode);writePreference('lastMode',mode);document.dispatchEvent(new Event('app-mode')); }
$('#modeHost').onclick = () => showPanel('host');
$('#modeClient').onclick = () => {if(!hostRoom){if(hostWs?.starting)return;disengageHostPreview();}showPanel('client');};
const params = new URL(location.href).searchParams;
showPanel(sessionPage(location.href,readPreference('lastMode','host')));
const rememberPage=()=>writePreference('lastMode',document.body.dataset.mode==='client'?'client':'host');
window.addEventListener('focus',rememberPage);document.addEventListener('pointerdown',rememberPage,{passive:true});document.addEventListener('keydown',rememberPage,{passive:true});
if (!window.isSecureContext) {
  $('#contextWarning').hidden = false;
  $('#contextWarning').textContent = 'Use HTTPS for remote players. Screen sharing and controller access require a secure connection; localhost works for the host.';
}

let hostWs, injectWs, hostRoom, captureStream, injectReconnect;
let hostEnding=false;
let controllerOutputs=[];
let nativeCapture = false, nativePreview = null, nativeSource = {};
let captureBusy = false, captureEpoch = 0, capturePickerPending=false;
let selectedSource='none', captureSourceTargets=[], nativeCaptureAvailable=false;
let captureMethodInitialized=false, captureTargetsPending=null, nativeCaptureDescription='';
let encoderCheckLoaded=false,encoderCheckPending=false,encoderCheckResult=null,activeNativeEncoder=null;
let nativeAudioCapability={},nativeAudioReady=false,nativeAudioError='',nativeAudioBusy=false,nativeAudioConfigured=false;
let hostDesktopInputAvailable=true,localHostPlatform='',localWaylandPortal=false;
let hybridAudioPreview=null,hybridAudioSource=null,hybridAudioEpoch=0;
let lastHostSetup=loadLastSession(),lastHostConfigApplied=false,lastSharePending=!!lastHostSetup?.source,rememberedBrowserShare=false,restoredShareArea=false;
restoreLastFields(lastHostSetup);
const encoderNames={h264_nvenc:'NVIDIA NVENC',h264_qsv:'Intel Quick Sync',h264_amf:'AMD AMF',h264_videotoolbox:'Apple VideoToolbox',libx264:'CPU software encoding'};
function encoderCheckUI() {
  $('#encoderCheck').hidden=$('#captureBackend').value!=='native';
  $('#checkEncoderAgain').disabled=encoderCheckPending;
  const selected=encoderCheckResult?.encoders?.find(encoder=>encoder.id===encoderCheckResult.selected);
  $('#encoderStatus').textContent=nativeCapture && activeNativeEncoder?`Selected for this stream: ${encoderNames[activeNativeEncoder] || activeNativeEncoder}`:encoderCheckPending?'Checking your video encoders…':selected?`Ready to use ${selected.label}${selected.hardware?' · hardware encoding':' · software encoding'}`:encoderCheckResult?.error || 'Native encoder check is available when capture tools are installed.';
  $('#encoderSummary').textContent=selected?`Encoder: ${selected.label}`:'Graphics & encoder details';
  $('#encoderDevices').textContent=encoderCheckResult?.devices?.length?`Graphics found: ${encoderCheckResult.devices.join(' · ')}`:'Graphics names are unavailable. Encoder startup is still checked directly.';
  $('#encoderResults').replaceChildren(...(encoderCheckResult?.encoders || []).map(encoder=>{
    const item=document.createElement('li');item.textContent=`${encoder.label} · ${encoder.available?'passed':encoder.error || 'unavailable'}`;return item;
  }));
}
async function checkHostEncoder(force=false) {
  if(encoderCheckPending || encoderCheckLoaded && !force || !nativeCaptureAvailable)return;
  encoderCheckPending=true;encoderCheckUI();
  try {
    const response=await fetch(`/encoder-check${force?'?refresh=1':''}`);
    if(response.status===404)throw new Error('Restart the local app to enable encoder checks.');
    const value=await response.json();
    if(!response.ok)throw new Error(value.error || 'Encoder check could not finish.');
    encoderCheckResult=value;
  } catch(error){encoderCheckResult={error:`${error.message} Try Check again.`};}
  finally {encoderCheckLoaded=true;encoderCheckPending=false;encoderCheckUI();}
}
$('#checkEncoderAgain').onclick=()=>checkHostEncoder(true);
let nativePreviewQueue = Promise.resolve(), nativePreviewPending=0, overlayAvailable = false, desktopSimulation = false, windowTargetAvailable = false;
for (const id of ['hostPreviewToggle','hostPreviewAutoPause','backgroundGamepad']) {
  try { const saved=localStorage.getItem(`webrtc-pad:${id}`); if (saved!==null) $(`#${id}`).checked=saved==='true'; } catch { /* Session settings still work. */ }
}
let backgroundGamepadPreference=$('#backgroundGamepad').checked;
const previewWanted = () => !$('#hostAudioOnly').checked && !$('#hostPanel').hidden && $('#hostPreviewToggle').checked && !($('#hostPreviewAutoPause').checked && (document.hidden || !document.hasFocus()));
let hostShowGuestCursors=false,hostOverlayActive=false,hostOverlayPending=null,hostDesktopMode='off';
function syncCursorOverlay(){
  if(!hostRoom || hostWs?.readyState!==WebSocket.OPEN)return;
  const enabled=overlayAvailable && hostShowGuestCursors && (hostDesktopPolicy.pointerOverlaySafe || hostDesktopPolicy.desktopMouse && hostDesktopPolicy.desktopFullAccess);
  if((enabled!==hostOverlayActive || hostOverlayPending!==null && enabled!==hostOverlayPending) && hostOverlayPending!==enabled){hostOverlayPending=enabled;send(hostWs,{type:'cursor-overlay',enabled});}
}
$('#hostShowGuestCursors').onchange=()=>{hostShowGuestCursors=$('#hostShowGuestCursors').checked;if(!hostShowGuestCursors)hostCursors.clear();for(const [id,p] of hostPeers){p.cursorAt=0;if(!hostShowGuestCursors)send(hostWs,{type:'overlay-remove',peerId:id});shareInputPolicy(p);}syncCursorOverlay();};
let keyboardAllowed = true;
let hostDesktopPolicy = { desktopMouse: false, desktopKeyboard: false, desktopFullAccess: false }, desktopPolicyPending = false;
let preparedDesktopPolicy=null,preparedDesktopSource=null,previewExitPending=false;
let desktopInputChoices={desktopMouse:true,desktopKeyboard:true};
function selectedControlWindow(){
  if(!windowTargetAvailable)return null;
  if($('#captureBackend').value==='native')return captureSourceTargets.find(t=>t.id===selectedSource && t.kind==='window') || null;
  const track=(captureStream?._areaSource || captureStream)?.getVideoTracks()[0];
  if(selectedSource!=='browser-selected' || track?.getSettings().displaySurface!=='window')return null;
  const id=track.label.match(/^window:(\d+)(?::|$)/)?.[1],matches=captureSourceTargets.filter(t=>t.kind==='window' && (t.id===id || t.label===track.label));
  return matches.length===1?matches[0]:null;
}
const desktopSetupKey=()=>{const target=selectedControlWindow() || captureSourceTargets.find(t=>t.id===selectedSource);return JSON.stringify([$('#captureBackend').value,selectedSource,selectedSource==='browser-selected'?(captureStream?._areaSource || captureStream)?.getVideoTracks()[0]?.id:null,target?.pid,target?.processStart,captureArea.current()]);};
const desktopChoices=()=>preparedDesktopPolicy || hostDesktopPolicy;
function clearPreparedDesktop(resetMode=true){preparedDesktopPolicy=null;preparedDesktopSource=null;if(resetMode){hostDesktopMode='off';desktopInputChoices={desktopMouse:true,desktopKeyboard:true};}}
function queueDesktopSource(){if(hostDesktopMode!=='off'){preparedDesktopPolicy={...desktopInputChoices,desktopFullAccess:hostDesktopMode==='desktop'};preparedDesktopSource=null;}}
function desktopChoiceReady(policy){return hostDesktopMode==='off' || hostDesktopInputAvailable && !hostDesktopPolicy.desktopCropped && (policy.desktopFullAccess || hostDesktopPolicy.desktopScope==='window' || desktopSimulation);}
function setDesktopChoices(policy){
  if(hostDesktopMode!=='off')desktopInputChoices={desktopMouse:policy.desktopMouse,desktopKeyboard:policy.desktopKeyboard};
  if(!hostRoom){preparedDesktopPolicy=policy;preparedDesktopSource=desktopSetupKey();desktopAvailability();return;}
  if(!desktopChoiceReady(policy)){preparedDesktopPolicy=policy;preparedDesktopSource=null;if(hostDesktopPolicy.desktopMouse || hostDesktopPolicy.desktopKeyboard || hostDesktopPolicy.desktopFullAccess){desktopPolicyPending=true;send(hostWs,{type:'input-policy',allowKeyboard:keyboardAllowed,desktopMouse:false,desktopKeyboard:false,desktopFullAccess:false});}desktopAvailability();return;}
  clearPreparedDesktop(false);desktopPolicyPending=true;desktopAvailability();send(hostWs,{type:'input-policy',allowKeyboard:keyboardAllowed,...policy});
}
function applyPreparedDesktop(){
  if(!hostRoom)return;if(!preparedDesktopPolicy){syncCursorOverlay();return;}
  const policy=preparedDesktopPolicy,valid=preparedDesktopSource===null || preparedDesktopSource===desktopSetupKey();if(valid && desktopChoiceReady(policy))setDesktopChoices(policy);syncCursorOverlay();
}
async function disengageHostPreview(){
  clearPreparedDesktop();hostOverlayActive=false;hostOverlayPending=null;previewExitPending=true;
  try{await stopCapture();if(!hostRoom && !hostWs?.starting){const ws=hostWs;hostWs=null;ws?.close();}$('#hostAudioOnly').checked=false;$('#nativeAudioTarget').value='none';}
  catch(error){hostStatus(error.message);}finally{previewExitPending=false;desktopAvailability();captureSetupUI();}
}
document.addEventListener('call-share-ready',applyPreparedDesktop);document.addEventListener('desktop-scope-choice',desktopAvailability);
let hostCursorLabels = false;
$('#hostCursorLabels').onchange = () => { hostCursorLabels = $('#hostCursorLabels').checked; hostCursors.labels(hostCursorLabels); send(hostWs,{type:'overlay-labels',enabled:hostCursorLabels}); for (const p of hostPeers.values()) if (p.control?.readyState === 'open') p.control.send(JSON.stringify({ type: 'cursor-labels', enabled: hostCursorLabels })); };
// Keyboard-to-controller mappings are selected by each guest; they never grant desktop typing.
$('#hostAllowKeyboard').checked = keyboardAllowed;
function pointerDimensions(sourceId=''){
  const value=sourceId?hostShares.get(sourceId)?.settings:nativeCapture?nativeSource:captureStream?.getVideoTracks()[0]?.getSettings();
  return [value?.width,value?.height].every(n=>Number.isFinite(n) && n>0 && n<=32768)?{width:Math.round(value.width),height:Math.round(value.height)}:{width:1280,height:720};
}
function shareInputPolicy(p) {
  const sourceId=p.controlSourceId ?? p.videoSourceId ?? '',policy=sourceId?(hostShares.get(sourceId)?.policy || {desktopMouse:false,desktopKeyboard:false,desktopVideoMatches:false}):hostDesktopPolicy;
  if(p.control?.readyState==='open')p.control.send(JSON.stringify({type:'input-policy',allowKeyboard:keyboardAllowed,cursorLabels:hostCursorLabels,showCursors:hostShowGuestCursors,pointerSize:pointerDimensions(sourceId),...policy,desktopSourceId:sourceId,desktopToken:p.desktopToken}));
}
function shareCaptureInfo(p) {
  if(p.control?.readyState==='open')p.control.send(JSON.stringify({type:'capture-info',audioOnly:!p.videoSourceId && audioOnly(),audioBackend:hybridAudioWanted()?'native':'video',audio:!p.videoSourceId && $('#nativeCaptureAudio').checked && ((nativeCapture || hybridAudioWanted())?nativeAudioReady:captureStream?.getAudioTracks().some(t=>t.readyState==='live' && t.enabled && !t.muted)===true)}));
}
function desktopAvailability() {
  if(!hostRoom && preparedDesktopPolicy && preparedDesktopSource!==desktopSetupKey())preparedDesktopSource=desktopSetupKey();
  const choices=desktopChoices(),preparing=!hostRoom,target=selectedControlWindow(),windowReady=!!target,cropped=!!document.querySelector('#captureArea') && !!captureArea.current(),blockedArea=preparing?cropped && !(windowReady && localHostPlatform==='win32'):hostDesktopPolicy.desktopCropped===true;
  document.body.dataset.inputScope=hostDesktopPolicy.desktopScope || 'none';
  for (const [id, key] of [['hostDesktopMouse','desktopMouse'],['hostDesktopKeyboard','desktopKeyboard']]) { $(`#${id}`).disabled = hostDesktopMode==='off' || !hostDesktopInputAvailable || (preparing?captureBusy || previewExitPending || hostWs?.starting || blockedArea || !windowReady && !choices.desktopFullAccess && !desktopSimulation:hostWs?.readyState!==WebSocket.OPEN || desktopPolicyPending || blockedArea || hostDesktopPolicy.desktopScope!=='window' && !choices.desktopFullAccess && !desktopSimulation); if (!desktopPolicyPending) $(`#${id}`).checked = choices[key]; }
  $('#hostDesktopFull').disabled = !hostDesktopInputAvailable || (preparing?captureBusy || previewExitPending || hostWs?.starting || cropped:hostWs?.readyState!==WebSocket.OPEN || desktopPolicyPending || blockedArea);
  if (!desktopPolicyPending) $('#hostDesktopFull').checked = choices.desktopFullAccess === true;
  const scope=$('#hostDesktopScope');if(scope){scope.value=hostDesktopMode;scope.disabled=$('#hostDesktopFull').disabled;scope.querySelector('[value=window]').disabled=!windowTargetAvailable;scope.querySelector('[value=desktop]').textContent=localWaylandPortal?'System-approved screen':'Entire desktop';}
  $('#hostDesktopKeyboardLabel').textContent='Allow typing & keyboard shortcuts';
  const permissions=$('#hostDesktopPermissions');if(permissions)permissions.hidden=hostDesktopMode==='off';
  const modeNote=$('#hostDesktopModeNote');if(modeNote)modeNote.textContent=hostDesktopMode==='off'?'Desktop access is off. Guests can still map keys and mouse buttons to a controller.':'Mouse and typing are included. Turn off either option below if you do not want to share it.';
  const setupNote=$('#hostDesktopSetupNote');if(setupNote)setupNote.textContent=preparing?'Choose access for this session. It starts only after you click Start a session.':'Change guest access here. Stop desktop control releases all desktop input.';
  const stateLabel=$('#hostSessionControlsState');if(stateLabel)stateLabel.textContent=hostDesktopMode==='off' || !choices.desktopMouse && !choices.desktopKeyboard?'Off':hostDesktopMode==='desktop'?'Entire desktop':'Window only';
  $('#hostDesktopMouseLabel').textContent=desktopSimulation?'Allow mouse control in the test screen':'Allow guests to control my system mouse';
  const scoped=preparing?windowReady:hostDesktopPolicy.desktopScope==='window',windowName=preparing?target?.label:hostDesktopPolicy.sharedSource;
  let reason='';
  if(!hostDesktopInputAvailable)reason=localHostPlatform==='darwin'?'Open Mac setup in Settings to enable desktop input.':'Linux desktop input requires X11 or a working Wayland Remote Desktop portal with python3-gi.';
  else if(blockedArea)reason='Mouse and typing are unavailable for this selected area. Share the full source to enable them.';
  else if(!choices.desktopFullAccess && !scoped)reason=!windowTargetAvailable?'Window-only control is unavailable on this platform.':'Choose a specific window under Screen sharing to enable mouse and typing here. Whole-screen and browser-tab shares cannot be limited to one window. For browser windows that cannot be identified, use Native capture.';
  $('#hostMouseScopeNote').textContent=reason || (choices.desktopFullAccess?localWaylandPortal?'Approve one screen in the system dialog. Mouse and typing control that screen, even with video off. Choose the same screen for browser sharing.':'Mouse and typing will control the entire primary screen, even with video off.':`Mouse and typing are limited to ${windowName || 'the shared window'}. Typing works only while that window is in front. Control follows the selected window.`);
  $('#hostChooseControlWindow').hidden=!reason || !hostDesktopInputAvailable || blockedArea || !windowTargetAvailable || !nativeCaptureAvailable;
  $('#hostInputCaution span').textContent=desktopSimulation?'This test sends mouse and keyboard input only to the demo screen.':choices.desktopFullAccess?`Guests can move your real mouse pointer, click, type and use shortcuts on ${localWaylandPortal?'the screen approved by the system':'your primary screen'}, even with video off. Only allow access for people you trust.`:'Guests can move your real mouse pointer, click and type in the shared window. Only allow access for people you trust. Turn off mouse or typing to stop access.';
  $('#hostStopDesktop').hidden = !hostDesktopPolicy.desktopMouse && !hostDesktopPolicy.desktopKeyboard && ![...hostShares.sources.values()].some(s=>s.policy?.desktopMouse || s.policy?.desktopKeyboard);
  if(overlayAvailable)$('#hostOverlayNote').textContent='Point and show click feedback without controlling apps. Pointers also appear over the main shared window or screen when supported. Real mouse control is a separate permission.';
  hostCursors.source(!captureStream && !nativeCapture ? hostDesktopPolicy.desktopSize || pointerDimensions() : null);
}
$('#hostStopDesktop').onclick=()=>{hostDesktopMode='off';desktopAvailability();send(hostWs,{type:'desktop-stop'});};
document.addEventListener('click',event=>{
  if(!event.target.closest('#hostChooseControlWindow'))return;
  if($('#captureBackend').value!=='native'){$('#captureBackend').value='native';$('#captureBackend').dispatchEvent(new Event('change'));}
  const target=$('#captureTarget');document.dispatchEvent(new CustomEvent('reveal-call-setting',{detail:target}));
  for(let parent=target.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;
  target.scrollIntoView({block:'center',behavior:'smooth'});target.focus({preventScroll:true});
});
$('#hostDesktopFull').onchange=event=>{hostDesktopMode=$('#hostDesktopScope').value;const enabled=hostDesktopMode!=='off';setDesktopChoices({desktopFullAccess:event.target.checked,desktopMouse:enabled && desktopInputChoices.desktopMouse,desktopKeyboard:enabled && desktopInputChoices.desktopKeyboard});};
for(const [id,key] of [['hostDesktopMouse','desktopMouse'],['hostDesktopKeyboard','desktopKeyboard']])$(`#${id}`).onchange=event=>setDesktopChoices({...desktopChoices(),[key]:event.target.checked});
$('#hostAllowKeyboard').onchange = () => {
  keyboardAllowed = $('#hostAllowKeyboard').checked;
  try { localStorage.setItem('webrtc-pad:allow-keyboard', String(keyboardAllowed)); } catch { /* Session choice still applies. */ }
  send(hostWs, { type: 'input-policy', allowKeyboard: keyboardAllowed });
  for (const p of hostPeers.values()) shareInputPolicy(p);
};
const nativeRequests = new Map();
function nativeCommand(type, peerId, value = {}) {
  const previewCommands={'capture-source':'preview-source','native-offer':'preview-offer','native-answer':'preview-answer','native-close':'preview-close','native-stop':'preview-stop','native-audio':'preview-audio','native-ice':'preview-ice'};
  if (hostWs?.readyState !== WebSocket.OPEN || !hostRoom && (peerId!=='preview' || !previewCommands[type] && !type.startsWith('audio-'))) return Promise.reject(new Error('Open a local preview or start a session first'));
  if(!hostRoom && !type.startsWith('audio-'))type=previewCommands[type];
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { nativeRequests.delete(requestId); reject(new Error('Native capture timed out')); }, 60000);
    nativeRequests.set(requestId, { resolve, reject, timer }); send(hostWs, { type, peerId, requestId, ...value });
  });
}
let hostSlots = playerSlots(4);
async function refreshCaptureTargets(forWindowControl=false) {
  if(forWindowControl!==true && (!$('#hostAudioOnly').checked && $('#captureBackend').value!=='native' && !hybridAudioWanted() || !nativeCaptureAvailable && !nativeAudioCapability.streaming))return;
  if(captureTargetsPending)return captureTargetsPending;
  captureTargetsPending=(async()=>{
  try { const response=await fetch('/capture-targets'),value=await response.json();if(!response.ok)throw new Error(value.error);
    captureSourceTargets=value.targets;renderCaptureSources();restoreLastShareSource();renderCaptureSources();return true;
  } catch(error){$('#captureStatus').textContent=`Window list unavailable: ${error.message}. Try Refresh list, or choose Browser capture.`;return false;}
  finally {captureTargetsPending=null;}
  })();
  return captureTargetsPending;
}
$('#refreshCaptureTargets').onclick=()=>refreshCaptureTargets();
function renderCaptureSources() {
  const select=$('#captureTarget');select.replaceChildren(new Option('No screen sharing','none'));
  const native=$('#captureBackend').value==='native';
  $('#nativeCodecOptions').hidden=!native;
  if(native && nativeCaptureAvailable) {
    const targets=windowTargetAvailable?captureSourceTargets:[{kind:'desktop',id:'desktop',label:'Configured screen'}];
    for(const kind of ['desktop','window']) {
      const group=document.createElement('optgroup');group.label=kind==='desktop'?'Screens':'Windows';
      for(const target of targets.filter(t=>t.kind===kind))group.append(new Option(target.label,target.id));
      if(group.children.length)select.append(group);
    }
  }
  if(!native && selectedSource==='browser-selected'){const surface=captureStream?.getVideoTracks()[0]?.getSettings().displaySurface;select.add(new Option(surface==='window'?'Selected browser window':surface==='monitor'?'Selected browser screen':surface==='browser'?'Selected browser tab':'Selected browser source','browser-selected'));}
  if(![...select.options].some(option=>option.value===selectedSource))select.add(new Option(selectedSource==='audio-only'?'Audio source selected':'Selected window unavailable · choose another source',selectedSource));
  select.value=selectedSource;renderAudioTargets();captureSetupUI();
}
$('#captureTarget').onchange=async()=>{
  const value=$('#captureTarget').value;
  if(value==='browser-selected')return;
  lastSharePending=false;rememberedBrowserShare=false;
  if(restoredShareArea && value!==selectedSource){captureArea.value=null;captureArea.render();restoredShareArea=false;}
  if(value===selectedSource && nativeCapture)return;
  if(value!==selectedSource)nativeAudioError='';
  selectedSource=value;
  if(value==='none'){await stopCapture();return;}
  $('#captureBackend').value='native';
  try {localStorage.setItem('webrtc-pad:capture-method','native');}catch{}
  if(captureStream || nativeCapture)stopCapture(false).catch(error=>hostStatus(error.message));
  captureSetupUI();tutorialEvent('host-source-updated');
  await startCapture(true);
  rememberHostSetup();
};
const captureSourcePicker=sourcePicker($('#captureTarget'),{refresh:()=>refreshCaptureTargets(),targets:()=>captureSourceTargets});
const lastSourceNote=document.createElement('p');lastSourceNote.id='hostLastSourceNote';lastSourceNote.className='small muted';lastSourceNote.hidden=true;
const clearLastSource=document.createElement('button');clearLastSource.type='button';clearLastSource.className='button small-button';clearLastSource.textContent='Clear selection';
lastSourceNote.append(document.createElement('span'),clearLastSource);$('#hostSourceStatus').before(lastSourceNote);
clearLastSource.onclick=()=>{lastSharePending=false;rememberedBrowserShare=false;lastSourceNote.hidden=true;lastHostSetup={...lastHostSetup,source:{kind:'none',label:''},area:null,needsAreaReview:false};selectedSource='none';captureArea.value=null;captureArea.render();rememberHostSetup();renderCaptureSources();};
function restoreLastShareSource(){
  if(!lastSharePending || !lastHostSetup?.source || nativeCapture || captureStream || captureBusy)return;
  const saved=lastHostSetup.source;
  const show=message=>{lastSourceNote.firstElementChild.textContent=message;lastSourceNote.hidden=false;};
  if(audioOnly()){
    const audio=matchLastSource(lastHostSetup.audio,captureSourceTargets);
    if(audio){$('#nativeAudioTarget').value=audio.id;selectedSource='audio-only';lastSharePending=false;show(`Last audio source selected: ${audio.label}. Start session to share it.`);}
    else if(saved.kind==='browser'){$('#nativeAudioTarget').value='browser';rememberedBrowserShare=true;lastSharePending=false;show('Start session to choose the browser audio source again.');}
    else {show('Choose the audio source to use for this session.');}
    return;
  }
  if(saved.kind==='none'){lastSharePending=false;return;}
  if($('#captureBackend').value==='browser'){
    rememberedBrowserShare=!lastHostSetup.area && !lastHostSetup.needsAreaReview && !audioOnly();lastSharePending=false;
    show(lastHostSetup.area || lastHostSetup.needsAreaReview?'Your last share used a selected area. Choose the source and area again.':`Last shared: ${saved.label || 'browser source'}. Start session to choose it in the sharing dialog.`);return;
  }
  const target=matchLastSource(saved,captureSourceTargets);if(!target){show(`Last shared: ${saved.label || 'window'}. Open it or choose another source.`);return;}
  if(lastHostSetup.needsAreaReview || lastHostSetup.area && (target.width!==lastHostSetup.bounds?.width || target.height!==lastHostSetup.bounds?.height)){
    show('The last shared area needs checking. Choose the source and area again.');lastSharePending=false;return;
  }
  selectedSource=target.id;lastSharePending=false;
  if(lastHostSetup.area){captureArea.value={...lastHostSetup.area};captureArea.render();restoredShareArea=true;}
  if(lastHostSetup.audio){const target=matchLastSource(lastHostSetup.audio,captureSourceTargets);if(target)$('#nativeAudioTarget').value=target.id;}
  show(`Last source selected: ${target.label}. Start session to share it.`);
}
function rememberHostSetup(){
  if(!lastHostConfigApplied)return;
  const target=captureSourceTargets.find(t=>t.id===selectedSource),track=(captureStream?._areaSource || captureStream)?.getVideoTracks()[0],sound=captureSourceTargets.find(t=>t.id===$('#nativeAudioTarget').value);
  const source=$('#captureBackend').value==='native' && target?{kind:target.kind,label:target.label}:$('#captureBackend').value==='browser' && track?{kind:'browser',label:browserSourceLabel(track.label,track.getSettings().displaySurface)}:rememberedBrowserShare || lastSharePending?lastHostSetup?.source:{kind:'none',label:''};
  const pending=(!target && !track) && (rememberedBrowserShare || lastSharePending);
  lastHostSetup={version:1,fields:Object.fromEntries([...lastSessionFields,'hostControllerCount'].map(id=>{const el=$(`#${id}`);return [id,el?.type==='checkbox'?el.checked:el?.value];})),source,audio:sound?{kind:sound.kind,label:sound.label}:pending?lastHostSetup?.audio:null,area:pending?lastHostSetup?.area:captureArea.current(),bounds:pending?lastHostSetup?.bounds:target || track?.getSettings(),needsAreaReview:pending && lastHostSetup?.needsAreaReview};storeLastSession(lastHostSetup);
}
document.addEventListener('change',event=>{if([...lastSessionFields,'hostControllerCount','captureTarget','nativeAudioTarget'].includes(event.target.id)){if(event.target.id==='captureBackend'){lastSharePending=false;rememberedBrowserShare=false;}rememberHostSetup();}});
document.addEventListener('choose-main-source',()=>{
  if($('#captureBackend').value==='native')captureSourcePicker.open();
  else $('#chooseBrowserSource').click();
});
const audioOnly=()=>$('#hostAudioOnly').checked;
const nativeAudioToolsReady=()=>nativeAudioCapability.available && (nativeAudioCapability.streaming ?? nativeCaptureAvailable);
function nativeAudioEnabled(){const target=captureSourceTargets.find(t=>t.id===selectedSource);return $('#nativeCaptureAudio').checked && nativeAudioToolsReady() && (target?.kind!=='window' || nativeAudioCapability.window);}
const hostMediaActive=()=>!!captureStream || nativeCapture || audioOnly() && !!hybridAudioSource;
function voiceCaptureNote(){
  const native=$('#captureBackend').value==='native' && !audioOnly();
  const target=captureSourceTargets.find(t=>t.id===(native?selectedSource:$('#nativeAudioTarget').value));
  const system=target?.kind==='desktop' || !native && !hybridAudioWanted() && captureStream?.getVideoTracks()[0]?.getSettings().displaySurface==='monitor';
  const note=hostVoice.$('capture-note');note.hidden=!(hostVoice.active && hostVoice.peers.size && Number(hostVoice.$('volume').value)>0 && hostMediaActive() && $('#nativeCaptureAudio').checked && system);
  note.textContent='System sound can include this voice call. Use the game’s app audio, or play voices through a different output device, to avoid sending voices back to guests.';
}
hostVoice.onChange=voiceCaptureNote;
function captureSetupUI() {
  const target=captureSourceTargets.find(t=>t.id===selectedSource),only=audioOnly(),native=!only && $('#captureBackend').value==='native';
  const audioTarget=native?target:captureSourceTargets.find(t=>t.id===$('#nativeAudioTarget').value),ready=nativeAudioToolsReady();
  document.body.dataset.hostAudioOnly=String(only);
  const extras=$('#hostExtraShares');if(extras)extras.hidden=!hostRoom || !(!only && hostMediaActive()) && !extras.querySelector('.extra-share-row');
  const areaControls=document.querySelector('#captureArea');if(areaControls)areaControls.hidden=only || !hostMediaActive();
  voiceCaptureNote();
  if($('#captureAdvanced'))$('#captureAdvanced').hidden=only;
  $('#videoCaptureMethod').hidden=only;$('#captureTargetFields').hidden=only || !native;
  $('#browserCaptureFields').hidden=only || native;$('#nativeAudioFields').hidden=false;
  $('#nativeAudioLabel').textContent='Include audio';
  $('#nativeAudioTargetFields').hidden=!only && (native || !$('#nativeCaptureAudio').checked || !ready);
  $('#nativeAudioSourceOptions').hidden=$('#nativeAudioTargetFields').hidden;
  if(only)$('#nativeAudioSourceOptions').open=true;
  const canAudio=!native || ready && (target?.kind!=='window' || nativeAudioCapability.window);
  $('#nativeCaptureAudio').disabled=nativeAudioBusy || !canAudio;
  const browserSound=!native && (!only && !hybridAudioWanted() || $('#nativeAudioTarget').value==='browser');
  $('#nativeAudioNote').textContent=nativeAudioError?`Audio unavailable: ${nativeAudioError}. Choose another source or turn audio off and on to retry.`:browserSound?'Choose audio in the browser sharing dialog. Browser window audio may be unavailable.':audioTarget?.kind==='window'?`Audio from ${audioTarget.label}, including its other windows${localHostPlatform==='darwin'?'':' and child processes'}. Other applications are excluded.`:audioTarget?.kind==='desktop'?'System audio includes other apps, calls and notifications on the default sound output.':native && !canAudio?nativeAudioCapability.error || 'Audio is unavailable for this source. Choose another source or install native audio tools.':only?'Choose an app, system audio, or a browser source below. Native audio does not capture or encode video.':'Audio follows the selected source. You can turn it off at any time.';
  $('#nativeAudioNote').hidden=!$('#nativeCaptureAudio').checked && canAudio || !browserSound && selectedSource==='none' && !nativeAudioError;
  $('#nativeAudioStatus').hidden=!$('#nativeCaptureAudio').checked || browserSound || selectedSource==='none';
  $('#nativeAudioStatus').textContent=!$('#nativeCaptureAudio').checked?'Audio is off.':nativeAudioReady?hostRoom?'Audio is included in the stream.':'Audio source ready. Start a session to share it.':selectedSource==='none'?'Choose a source to include sound.':nativeAudioBusy?'Preparing audio…':!hostMediaActive()?'Audio starts when you share this source.':'Audio is not arriving from this source.';
  $('#browserAudioNote').hidden=!browserSound || !$('#nativeCaptureAudio').checked;
  $('#chooseBrowserSource').disabled=capturePickerPending && !captureBusy;
  $('#chooseBrowserSource').textContent=captureBusy?(hostMediaActive()?hostRoom?'Stop sharing':'Clear selection':'Cancel selection'):capturePickerPending?'Close the browser sharing dialog…':selectedSource==='browser-selected'?'Change window or screen…':'Choose window or screen…';
  cancelCaptureSelection.hidden=!captureBusy || !only && !native;cancelCaptureSelection.textContent=hostMediaActive()?'Stop sharing':'Cancel selection';cancelCaptureSelection.setAttribute('aria-label',cancelCaptureSelection.textContent);
  $('#hostSourceStatus').setAttribute('aria-busy',String(captureBusy));$('#hostCapture').setAttribute('aria-busy',String(captureBusy));
  $('#showHostPreview').disabled=captureBusy;
  $('#clearBrowserSource').hidden=selectedSource!=='browser-selected';$('#clearBrowserSource').disabled=captureBusy;
  document.body.dataset.selectedSurface=only?'none':selectedSource==='none'?'none':selectedSource==='browser-selected'?captureStream?.getVideoTracks()[0]?.getSettings().displaySurface || 'browser':target?.kind==='window'?'window':'screen';
  $('#captureTarget').disabled=captureBusy;$('#captureBackend').disabled=captureBusy;$('#hostAudioOnly').disabled=captureBusy;
  if(!hostRoom)$('#hostCreate').disabled=captureBusy || previewExitPending || hostWs?.starting===true;
  $('#refreshCaptureTargets').hidden=true;$('#refreshCaptureTargets').disabled=captureBusy;
  $('#hostSourceStatus').textContent=captureBusy?'Preparing the selected source…':selectedSource==='none'?only?'Choose an audio source, or start with controllers only.':'No screen shared. Share controls only, or choose a window or screen.':only?`${audioTarget?.label || 'Browser audio'} · ${hostRoom?'sharing audio only':'start a session to share audio'}`:`${$('#captureTarget').selectedOptions[0]?.textContent || 'Selected screen'} · ${hostRoom && hostMediaActive()?'sharing with connected guests':'start a session to share this source'}`;
  $('#showHostPreview').hidden=only || selectedSource==='none' || previewWanted();
  $('#hostVideoSettings').hidden=only;$('#hostPreviewSettings').hidden=only;$('#qualityToggle').hidden=only;
  const audio=captureStream?.getAudioTracks().filter(t=>t.readyState==='live') || [];
  $('#browserAudioStatus').textContent=selectedSource!=='browser-selected'?'':audio.length?(audio.some(t=>t.enabled && !t.muted)?'Audio included by the browser.':'Audio track included · currently muted or paused.'):'Video only · the browser did not include audio. Change source to check the sharing dialog’s audio option.';
  $('#captureStatus').textContent=only?'Share sound without sending a picture. Controllers and permitted desktop input stay independent.':native?(nativeCapture && nativeCaptureDescription || 'Choose a window or screen below.'):'Choose a window or screen in the browser sharing dialog.';
  $('#hostCapture').title=only?'Choose an audio source above':native?'Choose a native screen or window':'Open the browser’s screen sharing dialog';
  desktopAvailability();encoderCheckUI();if(only)$('#encoderCheck').hidden=true;
  if(native && nativeCaptureAvailable && !encoderCheckLoaded && !encoderCheckPending)checkHostEncoder();
  if(nativeCapture || captureStream)lastSourceNote.hidden=true;
  captureSourcePicker.render();
}
let videoBackendBeforeAudioOnly;
$('#hostAudioOnly').onchange=async()=>{
  const only=audioOnly();if(only)videoBackendBeforeAudioOnly=$('#captureBackend').value;
  await stopCapture();if(!only && videoBackendBeforeAudioOnly)$('#captureBackend').value=videoBackendBeforeAudioOnly;
  if(!only)$('#nativeAudioSourceOptions').open=false;
  $('#nativeAudioTarget').value='none';renderCaptureSources();await refreshCaptureTargets();captureSetupUI();hostSharingUI(false,!hostRoom);
};
const cancelCaptureSelection=document.createElement('button');cancelCaptureSelection.id='cancelCaptureSelection';cancelCaptureSelection.type='button';cancelCaptureSelection.className='button small-button';cancelCaptureSelection.textContent='Cancel selection';cancelCaptureSelection.hidden=true;$('#hostSourceStatus').after(cancelCaptureSelection);
cancelCaptureSelection.onclick=()=>{lastSharePending=false;rememberedBrowserShare=false;stopCapture().then(rememberHostSetup).catch(e=>hostStatus(e.message));};
$('#chooseBrowserSource').onclick=async()=>{if(captureBusy){cancelCaptureSelection.click();return;}if(await startCapture()){lastSharePending=false;rememberedBrowserShare=false;}rememberHostSetup();};
$('#showHostPreview').onclick=()=>{$('#hostPreviewToggle').checked=true;if(!hostMediaActive() && selectedSource!=='none')startCapture(true);else updateHostPreview();captureSetupUI();};
$('#clearBrowserSource').onclick=()=>{lastSharePending=false;rememberedBrowserShare=false;stopCapture().then(rememberHostSetup).catch(e=>hostStatus(e.message));};
function applyConfig(config) {
  if(config.sessionServer?.hosted)nativeGuest.setLocalAvailable(false);
  sessionInvites.configure(config.sessionServer);
  if(config.sessionServer?.hosted)return;
  if (!Array.isArray(config?.slots)) return;
  if(hostRoom?.config)config={...config,...hostRoom.config};
  hostSlots = config.slots;
  if(hostRoom){$('#hostDynamicControllers').checked=config.dynamicControllers===true;$('#hostManualCount').hidden=$('#hostDynamicControllers').checked;}
  controllerOutputs=config.controllerOutputs || [];
  const output=$('#hostControllerOutput'), selected=hostRoom?.config.controllerType || config.controllerType || 'native';
  output.replaceChildren(...controllerOutputs.map(item=>new Option(item.id==='ds4'?'HID gamepads (PlayStation layout) · larger groups':item.label,item.id)));
  output.value=selected;
  $('#hostOutputFields').hidden=controllerOutputs.length<2;
  populateHostCounts(hostRoom ? config.playerCount : Number($('#hostControllerCount').value));
  if(!lastHostConfigApplied && !hostRoom){
    restoreLastFields(lastHostSetup,document,{ids:['hostControllerOutput']});populateHostCounts();
    restoreLastFields(lastHostSetup,document,{ids:['hostControllerCount']});$('#hostManualCount').hidden=$('#hostDynamicControllers').checked;
  }
  windowTargetAvailable=config.windowMouse===true;
  localWaylandPortal=config.waylandPortal===true;
  hostDesktopInputAvailable=config.desktopInput!==false;
  document.body.dataset.desktopInput=String(hostDesktopInputAvailable);
  document.body.dataset.windowMouse=String(windowTargetAvailable);
  if(config.platform) {
    localHostPlatform=config.platform;
    $('#hostPlatformGuide').hidden=!['linux','darwin'].includes(config.platform);
    $('#hostPlatformGuide').href=config.platform==='darwin'?'/mac-desktop':'/linux-desktop';
    $('#hostPlatformGuide').textContent=config.platform==='darwin'?'Mac audio & desktop setup':'Linux audio & desktop setup';
    $('#hostDesktopFullLabel').textContent=config.waylandPortal?'Allow control of the screen I approve in the system dialog':config.platform==='linux'?'Allow control of my entire X11 desktop':'Allow control of my entire primary screen';
    document.body.dataset.platform=config.platform;
    if(config.guestInputSetup)nativeGuest.applySetupChoice(config.guestInputSetup);
    nativeGuest.setPlatform(config.platform);
    $('#hostPlatformNote').textContent=config.waylandPortal?'Linux Wayland · Use browser screen sharing. Desktop control opens the system permission dialog for one screen. Choose that same screen for video. Window-only enforcement and desktop overlays are unavailable.':config.platform==='win32'?'Windows host · Window-only mouse access and desktop cursor overlays are available. Desktop control starts off.':config.platform==='linux'?config.desktopSession==='x11'?'Linux · X11 session detected. Window-only mouse control, desktop cursors and native video are available with their prerequisites installed. Desktop control starts off.':config.desktopSession==='wayland'?'Linux Wayland · Browser sharing and native system audio are available. Desktop control requires a Remote Desktop portal backend and Python GObject bindings (python3-gi); restart the app after installing them.':'Linux · No X11 desktop session detected. Browser sharing and native audio remain available with their prerequisites.':config.platform==='darwin'?'macOS host · Native audio/video, window control and cursor overlays are experimental. Open Mac setup below for capture and Accessibility permissions. Virtual controllers have separate signing requirements.':'This platform’s native hosting features may be limited. Browser input and video are available when supported by your browser.';
  }
  desktopSimulation = config.desktopSimulation === true;
  $('#desktopSimulationNotice').hidden = !desktopSimulation;
  $('#hostDesktopMouseLabel').textContent = desktopSimulation ? 'Enable simulated mouse in the test screen' : 'Allow desktop mouse movement, clicks & scrolling';
  $('#clientDesktopMouseLabel').textContent = desktopSimulation ? 'Control the simulated test-screen mouse' : 'Control the host’s system mouse';
  overlayAvailable = config.cursorOverlay === true;
  $('#hostOverlayNote').textContent=desktopSimulation?'Demo mode: cursor markers stay inside the test screen.':overlayAvailable?['linux','darwin'].includes(localHostPlatform)?`Click-through cursors follow the selected window or ${localHostPlatform==='linux'?'X11 desktop':'main screen'}. They may appear in captured video; exclusive fullscreen may cover them.`:'Enable this to see guest cursors over desktop apps. Use windowed or borderless mode if a game hides them.':localHostPlatform==='linux'?'Desktop cursor overlays require an X11 login session. In-app colored cursors remain available.':'Desktop cursor overlays are unavailable on this platform. In-app colored cursors remain available.';
  desktopAvailability();
  if (config.nativeCapture) {
    nativeCaptureAvailable=config.nativeCapture.available;
    $('#captureBackend option[value="native"]').textContent=localHostPlatform==='darwin'?'Native capture · experimental on Mac':'Native capture · recommended';
    nativeAudioCapability=config.nativeCapture.audio || {};
    document.body.dataset.nativeAudio=String(nativeAudioCapability.available===true);
    $('#captureBackend option[value="native"]').disabled = !config.nativeCapture.available;
    let preferred; try { preferred = localStorage.getItem('webrtc-pad:capture-method'); } catch { /* Automatic selection. */ }
    if(!lastHostConfigApplied && lastHostSetup?.fields.captureBackend)preferred=lastHostSetup.fields.captureBackend;
    if(!captureMethodInitialized) {
      $('#captureBackend').value = preferred === 'browser' && params.get('capture') !== 'native' ? 'browser' : config.nativeCapture.available ? 'native' : 'browser';
      captureMethodInitialized=true;
    }
    $('#nativeCaptureNote').textContent=config.nativeCapture.available?'Native capture is ready.':`Native capture is unavailable. ${config.nativeCapture.error || 'Run the native host launcher to install capture tools.'}`;
    if($('#captureBackend').value==='native' && !nativeCaptureAvailable)$('#captureBackend').value='browser';
    if($('#captureBackend').value==='native' && !captureSourceTargets.length)refreshCaptureTargets();
    else if((audioOnly() || lastHostSetup?.audio) && !captureSourceTargets.length && nativeAudioCapability.available)refreshCaptureTargets();
  }
  for (const id of ['invitationRole']) {
    const select = $(`#${id}`), previous = select.value;
    select.replaceChildren();
    for (const [value, label] of [['play', 'Play · press a controller button to join'], ['watch', 'Just watching']]) {
      const option = document.createElement('option'); option.value = value; option.textContent = label; select.append(option);
    }
    select.value = [...select.options].some(o => o.value === previous) ? previous : 'play';
  }
  refreshPlayerCapacity();
  if(!lastHostConfigApplied)lastHostConfigApplied=true;
  renderCaptureSources();
  restoreLastShareSource();renderCaptureSources();
  refreshCodecSupport().catch(()=>{});
  $('#connectionSetupStatus').textContent=config.sessionServer?.url?'Hosted invitations are configured. Go online to share a session link, or use invite/reply files.':config.fallbackEnabled?'Invite/reply files with automatic recovery through your forwarded HTTPS address.':'Invite/reply files. No account, server sign-in or port forwarding is needed to exchange files.';
  $('#fallbackConfigStatus').hidden=!config.fallbackEnabled;
  $('#fallbackConfigStatus').textContent = config.fallbackEnabled ? `Enabled at ${config.publicUrl}. New invites include the authenticated fallback connection.` : 'Off. Text-file pairing still works. Follow the setup guide to enable automatic recovery through a forwarded port.';
}
function refreshPlayerCapacity(){
  const config=hostRoom?.config,output=controllerOutputs.find(item=>item.id===$('#hostControllerOutput').value);
  const dynamic=config?config.dynamicControllers:$('#hostDynamicControllers').checked;
  const adaptive=dynamic && (config?config.adaptiveControllers:output?.maxPlayers===null);
  const count=config?config.playerCount:Number($('#hostControllerCount').value),assigned=[...hostPeers.values()].reduce((n,p)=>n+(p.slots?.length || (p.slot?1:0)),0);
  $('#playerCapacityNote').textContent=adaptive?'Players join as controllers are used':dynamic?'XInput output · four slots total':`${count} reserved remote controllers`;
  $('#playerCountInfo').textContent=adaptive?'Players are added as controllers join and freed when removed. Limits depend on the selected output, driver and game.':dynamic?'XInput has four slots, shared with physical controllers on this computer. Choose Automatic output for a group that also uses HID.':`${count} controllers reserved manually. Enable press-to-join before starting to add controllers as players use them.`;
  $('#hostSlotSummary').textContent=adaptive?`${assigned} controller${assigned===1?'':'s'} joined`:`${assigned} of ${dynamic?4:count} assigned`;
}
function populateHostCounts(preferred=Number($('#hostControllerCount').value)) {
  const output=controllerOutputs.find(item=>item.id===$('#hostControllerOutput').value);
  if(!output)return;
  const select=$('#hostControllerCount');
  select.replaceChildren(...Array.from({length:output.maxPlayers ?? 64},(_,i)=>new Option(`${i+1} remote controller${i?'s':''}`,String(i+1))));
  select.value=String(Math.max(1,Math.min(output.maxPlayers ?? 64,preferred || 1)));
  $('#hostControllerCountNote').textContent=output.id==='auto'?'Windows provides four XInput slots shared with local controllers. Additional controllers use HID; your game must support HID to use them.':output.id==='x360' ? 'Up to four XInput controllers, including local pads. Choose Automatic or HID for larger groups if your game supports them.' : 'Players are added as controllers join. Your game, operating system and driver determine how many can be used.';
  $('#hostOutputNote').textContent=output.id==='auto'?'Leave Automatic selected for most games. Try a specific mode if your game does not recognize a guest’s controller.':output.id==='ds4'?'Select SDL, DirectInput or HID in your game’s controller settings. For games that require XInput, choose Xbox output.' : 'Select XInput in your game’s controller settings.';
}
$('#hostControllerOutput').onchange=()=>{populateHostCounts();refreshPlayerCapacity();};
$('#hostDynamicControllers').onchange=()=>{$('#hostManualCount').hidden=$('#hostDynamicControllers').checked;refreshPlayerCapacity();};
$('#hostControllerCount').onchange=refreshPlayerCapacity;
const sessionGuestPeers=new Map();
const sessionInvites=new SessionInvites({
  showClient:()=>showPanel('client'),
  async offer(guestId,name){
    if(handoff.busy)throw Error('Wait for the host switch to finish, then invite this guest.');
    if(!hostRoom)throw Error('Start a session before accepting guests.');
    const old=sessionGuestPeers.get(guestId);if(old)send(hostWs,{type:'kick',peerId:old});
    const packet=await prepareInvitation(true,'play');
    if(!packet)throw Error($('#hostPairStatus').textContent || 'Could not prepare the connection. Try accepting again.');
    const entry=invitations.get(packet.pairingId);entry.p.sessionGuestId=guestId;entry.p.sessionName=name;sessionGuestPeers.set(guestId,entry.peerId);renderPeers();
    return packet;
  },
  async answer(invitation){
    $('#clientInvitation').value=JSON.stringify(invitation);sessionInvites.preparingReply=true;try{await $('#createReply').onclick();}finally{sessionInvites.preparingReply=false;}
    if(lastReply?.pairingId!==invitation.pairingId)throw Error($('#clientPairStatus').textContent || 'Could not prepare the connection reply.');
    return lastReply;
  },
  async accept(reply,guestId){
    const entry=invitations.get(reply.pairingId);if(!entry || entry.p.sessionGuestId!==guestId)throw Error('This reply does not belong to that guest’s invitation.');$('#hostReply').value=JSON.stringify(reply);await $('#acceptReply').onclick();
    if(entry && entry.p.pc.remoteDescription?.sdp!==reply.sdp.sdp)throw Error($('#hostPairStatus').textContent || 'Could not accept this connection.');
  },
  remove(guestId){const peerId=sessionGuestPeers.get(guestId);if(peerId)send(hostWs,{type:'kick',peerId});sessionGuestPeers.delete(guestId);},
  ended:()=>disconnectClient('The host ended this session.')
});
fetch('/config').then(r => r.ok ? r.json() : null).then(config=>{if(config)applyConfig(config);}).catch(() => {});
let captureQuality = streamSettings();
function boundMinimumResolution(select,ceiling){
  for(const option of select.options)option.disabled=Number(option.value)>ceiling;
  if(select.selectedOptions[0]?.disabled){select.value=[...select.options].filter(option=>!option.disabled).at(-1)?.value || '0';if(select.id==='clientMinimumResolution')writePreference(select.id,select.value);}
}
try {
  const saved = JSON.parse(localStorage.getItem('webrtc-pad:stream-quality'));
  if (saved) captureQuality = { ...streamSettings(saved.resolution, saved.frameRate, saved.priority), minHeight:[360,480,720,1080,1440,2160].includes(saved.minHeight)?saved.minHeight:480,autoThrottle: saved.autoThrottle !== false,codec:saved.codec==='h265'?'h265':'h264',...(['p1','p2','p4'].includes(saved.encoderPreset)?{encoderPreset:saved.encoderPreset}:{}) };
} catch { /* Defaults work without browser storage. */ }
if(lastHostSetup){const saved=lastHostSetup.fields;captureQuality={...streamSettings(saved.streamResolution || captureQuality.resolution,saved.streamFramerate || captureQuality.frameRate,saved.streamPriority || captureQuality.priority),minHeight:Number(saved.streamMinimumResolution || captureQuality.minHeight || 480),autoThrottle:saved.hostAutoThrottle ?? captureQuality.autoThrottle,codec:saved.streamCodec || captureQuality.codec,...((saved.streamEncoderPreset ?? captureQuality.encoderPreset)?{encoderPreset:saved.streamEncoderPreset ?? captureQuality.encoderPreset}:{})};}
$('#streamResolution').value = captureQuality.resolution; $('#streamFramerate').value = String(captureQuality.frameRate);
$('#streamPriority').value = captureQuality.priority;
$('#streamCodec').value=captureQuality.codec || 'h264';$('#streamEncoderPreset').value=captureQuality.encoderPreset || '';
let localCodecSupport={codecs:['h264'],reason:'Checking hardware decoding…'},codecCheckSequence=0;
async function refreshCodecSupport(){
  const sequence=++codecCheckSequence,result=await codecSupport(captureQuality);if(sequence!==codecCheckSequence)return;
  localCodecSupport=result;
  const hostAvailable=result.hevcAvailable && localHostPlatform!=='darwin';
  $('#streamCodec option[value="h265"]').disabled=!hostAvailable;$('#clientCodec option[value="h265"]').disabled=!result.hevcAvailable;
  $('#hostCodecNote').textContent=localHostPlatform==='darwin'?'Mac native capture currently uses H.264.':result.reason;
  $('#clientCodecNote').textContent=result.reason+' Applies to native video; browser capture chooses its codecs.';
  if(!hostAvailable && $('#streamCodec').value==='h265'){$('#streamCodec').value='h264';changeStreamQuality();}
  requestClientQuality();
}
refreshCodecSupport().catch(()=>{});
$('#hostAutoThrottle').checked = captureQuality.autoThrottle !== false;
$('#streamMinimumResolution').value=String(captureQuality.minHeight || 480);
boundMinimumResolution($('#streamMinimumResolution'),Number($('#streamResolution').value) || Infinity);
$('#streamQualityLabel').textContent = qualityLabel(captureQuality);
function streamInfo(actual) {
  $('#streamQualityLabel').textContent = qualityLabel(captureQuality);
  $('#hostStreamInfo').textContent = actual?.width ? `Source: ${actual.width} × ${actual.height} at ${Math.round(actual.frameRate || 0)} fps. Sharing at up to ${qualityLabel(captureQuality)}; your screen and network set the available limits.` : 'Choose your settings before sharing, or adjust them during the session.';
}
let qualityQueue = Promise.resolve(),qualityRevision=0;
function changeStreamQuality() {
  const revision=++qualityRevision;
  boundMinimumResolution($('#streamMinimumResolution'),Number($('#streamResolution').value) || Infinity);
  const requested = { ...streamSettings($('#streamResolution').value, $('#streamFramerate').value, $('#streamPriority').value), minHeight:Number($('#streamMinimumResolution').value),autoThrottle: $('#hostAutoThrottle').checked,codec:$('#streamCodec').value,...($('#streamEncoderPreset').value?{encoderPreset:$('#streamEncoderPreset').value}:{}) };
  qualityQueue = qualityQueue.then(async () => {
    if(revision!==qualityRevision)return;
    try {
      const track = (captureStream?._areaSource || captureStream)?.getVideoTracks()[0],size=track?.getSettings();
      const actual = track ? await applyCaptureSettings(track, captureArea.current()?{...requested,width:size.width,height:size.height}:requested) : null;
      if(revision!==qualityRevision)return;
      captureQuality = requested;
      try { localStorage.setItem('webrtc-pad:stream-quality', JSON.stringify(requested)); } catch { /* Session settings still apply. */ }
      if (nativeCapture) await startNativePreview();
      else if(captureStream?._areaSource)await startCapture(true);
      for (const p of hostPeers.values()) await applyPeerQuality(p);
      streamInfo(actual || (nativeCapture ? nativeSource : null));
      refreshCodecSupport().catch(()=>{});
      if (track) toast('Stream quality updated.');
    } catch { $('#hostStreamInfo').textContent = 'Your screen cannot use that setting. Try a lower resolution or frame rate.'; }
  });
}
$('#streamResolution').onchange = changeStreamQuality; $('#streamFramerate').onchange = changeStreamQuality;
$('#streamPriority').onchange = changeStreamQuality;
$('#hostAutoThrottle').onchange = changeStreamQuality; $('#streamMinimumResolution').onchange=changeStreamQuality;
$('#streamCodec').onchange=changeStreamQuality;$('#streamEncoderPreset').onchange=changeStreamQuality;
$('#captureBackend').onchange = async () => {
  const method=$('#captureBackend').value;
  captureMethodInitialized=true;
  if(method==='browser') {
    // Request permission in this user gesture, before any asynchronous cleanup.
    const success=await startCapture();
    if(!success && selectedSource!=='none' && selectedSource!=='browser-selected')$('#captureBackend').value='native';
  } else {
    await stopCapture();
    await refreshCaptureTargets();
  }
  try {localStorage.setItem('webrtc-pad:capture-method',$('#captureBackend').value);}catch{}
  renderCaptureSources();tutorialEvent('host-source-updated');
  rememberHostSetup();
};
function hybridAudioWanted(){return (audioOnly() || $('#captureBackend').value==='browser') && $('#nativeCaptureAudio').checked && nativeAudioToolsReady() && !['none','browser'].includes($('#nativeAudioTarget').value);}
let browserOutboundStream;
function browserMediaStream(){
  const tracks=[...(audioOnly()?[]:captureStream?.getVideoTracks() || []),...($('#nativeCaptureAudio').checked && !hybridAudioWanted()?captureStream?.getAudioTracks() || []:[])];
  const stream=browserOutboundStream ||= new MediaStream();
  for(const track of stream.getTracks())if(!tracks.includes(track))stream.removeTrack(track);
  for(const track of tracks)if(!stream.getTracks().includes(track))stream.addTrack(track);
  return stream;
}
function renderAudioTargets(){
  const select=$('#nativeAudioTarget'),current=select.value;
  select.replaceChildren(new Option(audioOnly()?'Choose an audio source':'Browser sharing dialog','none'));
  if(audioOnly())select.add(new Option('Browser tab / screen audio…','browser'));
  const targets=captureSourceTargets.some(t=>t.kind==='desktop')?captureSourceTargets:[{kind:'desktop',id:'desktop',label:'System audio'},...captureSourceTargets];
  if(nativeAudioToolsReady())for(const target of targets)if(target.kind!=='window' || nativeAudioCapability.window)select.add(new Option(target.kind==='desktop'?'System audio · all apps on default output':target.label,target.id));
  if(current!=='none' && ![...select.options].some(option=>option.value===current))select.add(new Option('Selected audio app unavailable',current));
  select.value=current;
}
async function updateNativeAudio(){
  nativeAudioError='';
  if(captureBusy){captureSetupUI();return;}
  if(!nativeCapture){
    if(hybridAudioWanted())await refreshCaptureTargets();
    if(captureStream || audioOnly())await configureHybridAudio();
    captureSetupUI();return;
  }
  const epoch=captureEpoch,enabled=nativeAudioEnabled();
  nativeAudioBusy=true;nativeAudioReady=false;captureSetupUI();
  for(const p of hostPeers.values())shareCaptureInfo(p);
  try {
    const result=await nativeCommand('native-audio','preview',{enabled});
    if(epoch!==captureEpoch || !nativeCapture)return;
    nativeAudioConfigured=enabled;nativeAudioReady=result.audioAvailable===true;nativeAudioError=result.audioError || '';
  } catch(error){if(epoch===captureEpoch)nativeAudioError=error.message;}
  finally {if(epoch===captureEpoch){nativeAudioBusy=false;captureSetupUI();for(const p of hostPeers.values())shareCaptureInfo(p);}}
}
$('#nativeCaptureAudio').onchange=()=>updateNativeAudio().catch(error=>{nativeAudioError=error.message;captureSetupUI();});
$('#refreshAudioTargets').onclick=()=>refreshCaptureTargets();
$('#nativeAudioTarget').onchange=async()=>{
  nativeAudioError='';
  try{
    if(audioOnly()){
      const source=$('#nativeAudioTarget').value;
      if(source==='browser'){await startCapture();return;}
      await stopCapture(false);selectedSource=source==='none'?'none':'audio-only';
      if(source==='none'){renderCaptureSources();return;}
    }
    await configureHybridAudio();
  }catch(error){nativeAudioError=error.message;captureSetupUI();}
};
async function stopHybridAudio(){
  const active=!!hybridAudioSource || !!hybridAudioPreview || nativeAudioBusy && !nativeCapture;hybridAudioEpoch++;nativeAudioBusy=false;hybridAudioPreview?.close();hybridAudioPreview=null;hybridAudioSource=null;
  for(const p of hostPeers.values()){p.audioKey=null;p.audioNegotiation=null;if(p.control?.readyState==='open')p.control.send(JSON.stringify({type:'audio-stop'}));}
  if(active && hostWs?.readyState===WebSocket.OPEN)await nativeCommand('audio-stop','preview').catch(()=>{});
}
async function configureHybridAudio(){
  if(!captureStream && !audioOnly())return;
  if(!hybridAudioWanted()){
    await stopHybridAudio();nativeAudioReady=false;nativeAudioError='';await updateCapture();captureSetupUI();hostSharingUI(hostMediaActive(),!hostRoom);return;
  }
  const enabled=hybridAudioWanted(),source=$('#nativeAudioTarget').value,epoch=++hybridAudioEpoch;
  nativeAudioBusy=true;nativeAudioReady=false;nativeAudioError='';captureSetupUI();
  for(const p of hostPeers.values())shareCaptureInfo(p);
  try {
    if(!enabled){
      if(hybridAudioSource)await nativeCommand('audio-source','preview',{enabled:false});
    } else if(source!=='none'){
      if(!hostRoom)await connectHost(true);
      if(epoch!==hybridAudioEpoch)return;
      const changed=hybridAudioSource!==source;
      const audioState=await nativeCommand('audio-source','preview',{sourceId:source,enabled:true});
      if(epoch!==hybridAudioEpoch)return;
      if(changed || !hybridAudioPreview){
        hybridAudioPreview?.close();hybridAudioPreview=null;
        for(const p of hostPeers.values()){p.audioKey=null;p.audioNegotiation=null;if(p.control?.readyState==='open')p.control.send(JSON.stringify({type:'audio-stop'}));}
        const offer=await nativeCommand('audio-offer','preview');
        if(epoch!==hybridAudioEpoch)return;
        hybridAudioSource=source;
        const pc=hostConnectionReports.track(new RTCPeerConnection({iceServers:[]}),'preview');hybridAudioPreview=pc;
        pc.onicecandidate=event=>{if(event.candidate && hybridAudioPreview===pc)nativeCommand('audio-ice','preview',{candidate:event.candidate.toJSON()}).catch(()=>{});};
        await pc.setRemoteDescription(offer.sdp);await pc.setLocalDescription(await pc.createAnswer());
        await nativeCommand('audio-answer','preview',{sdp:pc.localDescription});
        if(epoch!==hybridAudioEpoch)return;
        nativeAudioReady=offer.audioAvailable===true;nativeAudioError=offer.audioError || '';
      } else {nativeAudioReady=audioState?.audioAvailable===true;nativeAudioError=audioState?.audioError || '';}
    } else await stopHybridAudio();
    if(epoch!==hybridAudioEpoch)return;
    await updateCapture();hostSharingUI(hostMediaActive(),!hostRoom);$('#hostStopCapture').disabled=!hostMediaActive();
  } finally {if(epoch===hybridAudioEpoch){nativeAudioBusy=false;captureSetupUI();for(const p of hostPeers.values())shareCaptureInfo(p);}}
}
async function startHybridAudioPeer(p){
  if(!hybridAudioWanted() || !hybridAudioSource || !nativeAudioReady || p.receiveVideo===false || p.control?.readyState!=='open')return;
  if(p.audioKey===hybridAudioSource || p.audioNegotiation)return;
  const id=[...hostPeers].find(([,value])=>value===p)?.[0];if(!id)return;
  const epoch=hybridAudioEpoch,offer=await nativeCommand('audio-offer',id);
  if(epoch!==hybridAudioEpoch || !captureStream && !audioOnly() || hostPeers.get(id)!==p || p.receiveVideo===false){nativeCommand('audio-close',id).catch(()=>{});return;}
  p.audioKey=hybridAudioSource;p.audioNegotiation=crypto.randomUUID();
  p.control.send(JSON.stringify({type:'audio-offer',id:p.audioNegotiation,sdp:offer.sdp,ice:offer.ice}));
}

const hostPeers = new Map();
const captureArea=new CaptureArea({controlScope:()=>nativeCapture && localHostPlatform==='win32' && captureSourceTargets.find(t=>t.id===selectedSource)?.kind==='window',root:$('#hostSourceSetup'),preview:$('#hostPreview'),sourceSize:()=>nativeCapture?nativeSource:(captureStream?._areaSource || captureStream)?.getVideoTracks()[0]?.getSettings(),bounds:()=>nativeCapture?captureSourceTargets.find(t=>t.id===selectedSource):(captureStream?._areaSource || captureStream)?.getVideoTracks()[0]?.getSettings(),status:toast,prepare:async()=>{
  $('#hostPreviewToggle').checked=true;updateHostPreview();
  if(!hostMediaActive())return;
  await waitFor(()=>$('#hostPreview').videoWidth>0 && $('#hostPreview').readyState>=2 && !!$('#hostPreview').srcObject,'The preview is not ready. Try again when its picture appears.',5000);
},apply:async()=>{if(!await startCapture(true))throw new Error('Could not apply the area. Check the selected source.');rememberHostSetup();}});
const hostViewPopouts=new HostViewPopouts({source:id=>{const extra=hostShares.get(id);return extra || (!id && !audioOnly() && hostMediaActive()?{kind:nativeCapture?'native':'browser',stream:captureStream,identity:nativeCapture?nativeSource:captureStream,settings:nativeSource}:null);},nativeCommand,ice:()=>fetchIce(hostRoom.roomId),quality:p=>p.quality || captureQuality});
const guestViewPopouts=new GuestViewPopouts({send:msg=>{if(clientPeer?.control?.readyState==='open')clientPeer.control.send(JSON.stringify(msg));},status:toast});
const hostShares=new HostShares({root:$('#hostLiveSourceBody'),primaryShared:()=>!audioOnly() && hostMediaActive(),nativeAvailable:()=>nativeCaptureAvailable && $('#captureBackend').value==='native',
  addNative:id=>nativeCommand('native-source-add','preview',{id}),removeNative:sourceId=>nativeCommand('native-source-remove','preview',{sourceId}),controlNative:(sourceId,enabled)=>nativeCommand('native-window-control','preview',{sourceId,enabled}),quality:()=>captureQuality,status:hostStatus,
  changed:async()=>{desktopAvailability();hostViewPopouts.prune();for(const p of hostPeers.values()){const available=sharedSources();if(p.videoSourceId && !hostShares.get(p.videoSourceId) || available.length && !available.some(s=>s.id===(p.videoSourceId || '')))await switchHostView(p,available[0]?.id || '');else{if(p.controlSourceId && !hostShares.get(p.controlSourceId))setControlView(p,p.videoSourceId || '');shareViews(p);shareInputPolicy(p);}}}
});
function chooseGuestView(sourceId){
  if(guestTiles.active){guestTiles.feature(sourceId);return;}
  if(clientPeer?.control?.readyState!=='open' || sourceId===guestTiles.primary)return;
  if(!guestTiles.switching)guestTiles.beginSwitch();
  releaseDesktopClient();updateDesktopMouse();
  clientPeer.control.send(JSON.stringify({type:'select-view',sourceId}));
}
const clientViews=guestViewSelector($('#clientStage'),chooseGuestView,sourceId=>guestViewPopouts.open(sourceId));
const guestTiles=new GuestTiles({stage:$('#clientStage'),video:$('#clientVideo'),views:$('#clientSharedViews'),subscriptions:guestViewPopouts,selectView:chooseGuestView,mediaControls:owner=>participantMediaControls('client',owner),changed:(active,featured)=>{
  releaseDesktopClient();if(clientPeer?.control?.readyState==='open')clientPeer.control.send(JSON.stringify({type:'control-view',sourceId:active?featured:guestTiles.primary}));updateDesktopMouse();
}});
clientCamera.changed=sources=>guestTiles.setCameras(sources);
function setControlView(p,sourceId){
  const id=[...hostPeers].find(([,peer])=>peer===p)?.[0];if(!id)return;
  p.controlSourceId=sourceId;p.desktopToken=crypto.randomUUID();send(hostWs,{type:'peer-control-view',peerId:id,sourceId,token:p.desktopToken});
  send(injectWs,{type:'desktop-release',peerId:id});hostCursors.remove(id);send(hostWs,{type:'overlay-remove',peerId:id});shareInputPolicy(p);
}
function sharedSources(){return [...(!audioOnly() && hostMediaActive()?[{id:'',label:'Main share'}]:[]),...[...hostShares.sources.values()].map(s=>({id:s.id,label:s.label}))];}
function shareViews(p){
  if(p.control?.readyState==='open')p.control.send(JSON.stringify({type:'shared-views',selected:p.videoSourceId || '',sources:sharedSources()}));
}
async function switchHostView(p,sourceId){
  const id=[...hostPeers].find(([,peer])=>peer===p)?.[0];if(!id)return;
  stopPeerVideo(p);p.videoSourceId=sourceId;p.controlSourceId=undefined;p.desktopToken=undefined;p.adaptation={};
  send(hostWs,{type:'peer-view',peerId:id,additional:!!sourceId,sourceId});
  send(injectWs,{type:'desktop-release',peerId:id});hostCursors.remove(id);send(hostWs,{type:'overlay-remove',peerId:id});
  shareInputPolicy(p);shareCaptureInfo(p);shareViews(p);
  await applyPeerQuality(p);
}
function sourceSettings(p) { const source=hostShares.get(p?.videoSourceId);return source?source.stream?.getVideoTracks()[0]?.getSettings() || source.settings || {}:nativeCapture ? nativeSource : captureStream?.getVideoTracks()[0]?.getSettings() || {}; }
function shareQualityLimit(p) {
  if (p.control?.readyState === 'open') p.control.send(JSON.stringify({ type: 'quality-limit', host: { ...captureQuality, ...sourceSettings(p), width: Math.min(captureQuality.width || Infinity, sourceSettings(p).width || Infinity), height: Math.min(captureQuality.height || Infinity, sourceSettings(p).height || Infinity), frameRate: Math.min(captureQuality.frameRate, sourceSettings(p).frameRate || Infinity) }, assigned: p.quality }));
}
async function applyPeerQuality(p) {
  if (captureQuality.autoThrottle === false || p.requestedQuality?.automatic === false) p.adaptation = {};
  p.quality = effectiveQuality(captureQuality, p.requestedQuality, sourceSettings(p), p.adaptation?.height);
  if(p.nativeCodecUnavailable || localHostPlatform==='darwin')p.quality.codec='h264';
  shareQualityLimit(p);
  if (p.receiveVideo === false) return;
  const extra=hostShares.get(p.videoSourceId);
  if ((extra?extra.kind==='native':nativeCapture) && p.control?.readyState === 'open') await startNativePeer(p);
  else if (p.control?.readyState === 'open'){if(extra?.stream || captureStream)await startBrowserPeer(p);if(!extra)await startHybridAudioPeer(p);}
}
function stopPeerVideo(p) {
  p.mediaEpoch=(p.mediaEpoch || 0)+1;
  p.media?.pc.close(); p.media = null; clearTimeout(p.mediaTimeout);
  p.nativeKey = null; p.nativeNegotiation = null; p.nativePresentationId=null; p.nativeAgain = false; clearTimeout(p.nativeTimeout);
  const id = [...hostPeers].find(([, value]) => value === p)?.[0];
  if (id){nativeCommand('native-close', id,{sourceId:p.nativeSourceId}).catch(() => {});nativeCommand('audio-close',id).catch(()=>{});}p.audioKey=null;p.audioNegotiation=null;
  if (p.control?.readyState === 'open'){p.control.send(JSON.stringify({ type: 'native-stop' }));p.control.send(JSON.stringify({type:'audio-stop'}));}
}
async function startBrowserPeer(p, force = false) {
  const extra=hostShares.get(p.videoSourceId),stream=extra?.stream || (!extra?browserMediaStream():null);
  if (!stream || !stream.getTracks().length || p.receiveVideo === false || p.control?.readyState !== 'open') return;
  if (p.media && !force) { p.media.quality = p.quality; await replaceCapture(p.media, stream); return; }
  if (p.mediaStarting) {p.mediaAgain=true;return;}
  p.mediaStarting = true;
  try {
    stopPeerVideo(p);const epoch=p.mediaEpoch;
    const ice = await fetchIce(hostRoom.roomId), pc = hostConnectionReports.track(new RTCPeerConnection(ice),'browser-video');
    const media = { pc, senders: {}, candidates: [], quality: p.quality, id: crypto.randomUUID() }; p.media = media;
    for (const kind of !extra && audioOnly()?['audio']:['video', 'audio']) media.senders[kind] = pc.addTransceiver(kind, { direction: 'sendonly' }).sender;
    await replaceCapture(media, stream);
    await pc.setLocalDescription(voiceDescription(await pc.createOffer(),192000,true)); await gatherIce(pc);
    if (p.media !== media || epoch!==p.mediaEpoch || !stream.getTracks().some(t=>t.readyState==='live') || p.receiveVideo === false || p.control.readyState !== 'open') { pc.close(); return; }
    p.control.send(JSON.stringify({ type: 'browser-offer', id: media.id, sdp: pc.localDescription, ice }));
    p.mediaTimeout = setTimeout(() => { if (p.media === media && pc.connectionState !== 'connected') { pc.close(); p.media = null; hostStatus('Video could not connect. Controller sharing is still available. Try sharing again.'); } }, 40000);
  } finally { p.mediaStarting = false;if(p.mediaAgain){p.mediaAgain=false;applyPeerQuality(p).catch(error=>hostStatus(error.message));} }
}
async function startNativePeer(p, force = false) {
  const sourceId=p.videoSourceId || '',extra=hostShares.get(sourceId);
  if (!(extra?extra.kind==='native':nativeCapture) || p.receiveVideo === false || p.control?.readyState !== 'open' || ![...hostPeers.values()].includes(p)) return;
  const quality={...p.quality},key = nativeEncodingKey(sourceId,quality);
  if (!force && p.nativeKey === key) return;
  if (p.nativeBusy || p.nativeNegotiation || !force && p.nativePresentationId) { p.nativeAgain = true; return; }
  p.nativeBusy = true;
  p.nativePresentationId=null;
  try {
    const id = [...hostPeers].find(([, value]) => value === p)?.[0]; if (!id) return;
    const epoch=p.mediaEpoch,sourceEpoch=captureEpoch;p.nativeSourceId=sourceId;let offer;
    try{offer=await nativeCommand('native-offer',id,{quality,sourceId});}
    catch(error){if(quality.codec!=='h265')throw error;p.nativeCodecUnavailable=true;quality.codec='h264';p.quality={...p.quality,codec:'h264'};offer=await nativeCommand('native-offer',id,{quality,sourceId});hostStatus('H.265 could not start for this guest. Using H.264.');shareQualityLimit(p);}
    if (epoch!==p.mediaEpoch || sourceId!==(p.videoSourceId || '') || (!extra && (!nativeCapture || sourceEpoch!==captureEpoch)) || extra && hostShares.get(sourceId)!==extra || hostPeers.get(id) !== p || p.control?.readyState !== 'open') { nativeCommand('native-close', id,{sourceId}).catch(() => {}); return; }
    if(extra && offer.sourceSize)extra.settings={...extra.settings,...offer.sourceSize};
    p.nativeKey = nativeEncodingKey(sourceId,quality);
    if(p.nativeKey!==nativeEncodingKey(sourceId,p.quality))p.nativeAgain=true; p.nativeNegotiation = crypto.randomUUID();
    p.nativePresentationId=p.nativeNegotiation;
    clearTimeout(p.nativeTimeout);
    p.nativeTimeout = setTimeout(() => { p.nativeNegotiation = null;p.nativePresentationId=null; p.nativeKey = null; hostStatus('Native video did not connect. Try Refresh connection or browser capture.'); }, 40000);
    p.control.send(JSON.stringify({ type: 'native-offer', id: p.nativeNegotiation, codec:quality.codec || 'h264',sdp: offer.sdp, ice: offer.ice }));
    nativeCaptureDescription=`${offer.capture || 'Native capture'} · ${offer.encoder || 'hardware encoder'} · ${offer.scaling || 'source-sized video'}. Adjust resolution and frame rate in the stream settings.`;
    activeNativeEncoder=offer.encoder || activeNativeEncoder;
    captureSetupUI();
  } finally {
    p.nativeBusy = false;
    if (p.nativeAgain && !p.nativeNegotiation && !p.nativePresentationId) { p.nativeAgain = false; startNativePeer(p).catch(error => hostStatus(error.message)); }
  }
}
function startNativePreview() {
  const epoch=captureEpoch;nativePreviewPending++;
  nativePreviewQueue = nativePreviewQueue.catch(() => {}).then(async () => {
  if (!nativeCapture || epoch!==captureEpoch)return;
  const previewKey=nativeEncodingKey(`${epoch}:${selectedSource}`,{...captureQuality,codec:localCodecSupport.hevcAvailable && localHostPlatform!=='darwin'?captureQuality.codec || 'h264':'h264'});
  if(nativePreview?.encodingKey===previewKey && !['failed','closed'].includes(nativePreview.connectionState))return;
  let offer;
  try{offer=await nativeCommand('native-offer','preview',{quality:{...captureQuality,codec:localCodecSupport.hevcAvailable && localHostPlatform!=='darwin'?captureQuality.codec || 'h264':'h264'}});}
  catch(error){if(epoch!==captureEpoch)return;if(captureQuality.codec!=='h265')throw error;captureQuality={...captureQuality,codec:'h264'};$('#streamCodec').value='h264';offer=await nativeCommand('native-offer','preview',{quality:captureQuality});hostStatus('H.265 could not start. Using H.264.');}
  if(epoch!==captureEpoch || !nativeCapture)return;
  nativeAudioReady=offer.audioAvailable===true;nativeAudioError=offer.audioError || '';
  activeNativeEncoder=offer.encoder || activeNativeEncoder;
  nativeCaptureDescription=`${offer.capture || 'Native capture'} · ${offer.encoder || 'hardware encoder'} · ${offer.scaling || 'source-sized video'}. Adjust resolution and frame rate in the stream settings.`;
  captureSetupUI();
  nativeSource = { ...offer.sourceSize, frameRate: captureQuality.frameRate };
  nativePreview?.close(); nativePreview = null;
  if (!nativeCapture || !previewWanted()) { $('#hostPreview').srcObject = null; await nativeCommand('native-close','preview'); hostSharingUI(nativeCapture); desktopAvailability(); return; }
  const pc = hostConnectionReports.track(new RTCPeerConnection({ iceServers: [] }),'preview'); nativePreview = pc;pc.encodingKey=previewKey;
  pc.onicecandidate=event=>{if(event.candidate && nativePreview===pc)nativeCommand('native-ice','preview',{candidate:event.candidate.toJSON()}).catch(error=>{if(nativePreview===pc)hostStatus(`Preview connection: ${error.message}`);});};
  const stream=new MediaStream();pc.previewStream=stream;
  pc.ontrack = event => { if (nativePreview === pc) {
    preferLowLatency(event.receiver);
    // The host already hears the game locally. Even muted audio in a video
    // element enables A/V synchronization and can delay this confidence view.
    // Keep the receiver available; only guest players consume native audio.
    if(event.track.kind!=='video')return;
    stream.addTrack(event.track);
    if($('#hostPreview').srcObject!==stream)$('#hostPreview').srcObject=stream;
    hostSharingUI(true,!hostRoom);
  } };
  await pc.setRemoteDescription(offer.sdp); await pc.setLocalDescription(await pc.createAnswer());
  await nativeCommand('native-answer', 'preview', { sdp: pc.localDescription });
  captureSetupUI();
  desktopAvailability();
  }).finally(()=>{nativePreviewPending--;});
  return nativePreviewQueue;
}
let previewStatsBusy=false, previewStatsPeer=null, previewStatsSample=null, previewFrameSample=null;
setInterval(async()=>{
  const label=$('#hostPreviewStats'),video=$('#hostPreview');
  if(!video.srcObject || video.hidden || document.hidden){label.hidden=true;previewStatsSample=null;previewFrameSample=null;return;}
  if(previewStatsBusy)return;
  previewStatsBusy=true;
  try {
    const pc=nativePreview;
    if(pc!==previewStatsPeer){previewStatsPeer=pc;previewStatsSample=null;}
    let value;
    if(pc && pc.connectionState==='connected') {
      const stats=await pc.getStats();if(nativePreview!==pc || !video.srcObject || video.hidden)return;
      value=receivedVideoStats(stats,previewStatsSample,video);previewStatsSample=value?.sample;
    } else if(captureStream && video.videoWidth) {
      const time=performance.now(),frames=video.getVideoPlaybackQuality?.().totalVideoFrames;
      const previous=previewFrameSample;
      const fps=previous?.stream===video.srcObject && Number.isFinite(frames)?Math.round(Math.max(0,frames-previous.frames)*1000/(time-previous.time)):null;
      previewFrameSample={stream:video.srcObject,time,frames};
      if(fps!==null)value={width:video.videoWidth,height:video.videoHeight,fps};
    }
    label.hidden=!value?.width;
    if(value?.width){label.textContent=`Preview · ${videoStatsLabel(value)}${Number.isFinite(value.bufferMs)?` · ${Math.round(value.bufferMs)} ms playback buffer`:''}`;hostDiagnostics.record({...value,lossPercent:value.loss==null?null:value.loss*100});}
    label.title=Number.isFinite(value?.decodeMs)?`Decoding: ${value.decodeMs.toFixed(1)} ms per frame. The playback buffer and decode time exclude capture and encoding delay.`:'Frame rate measured from local video playback. Guest connection statistics are separate.';
  } catch {/* An interrupted preview must not affect guest streaming. */}
  finally {previewStatsBusy=false;}
},1000);
const recoveringPeers = new Set();
const pendingIce = new Map();
const registrations = new Map(), invitations = new Map();
let lastInvitation, lastReply,clientReplyEpoch=0,invitationPreparation=null;
function expireInvitation(pairingId) {
  const pending=invitations.get(pairingId);if(!pending)return;
  invitations.delete(pairingId);clearTimeout(pending.p.expiryTimer);updateInviteExpiry();
  send(hostWs,{type:'kick',peerId:pending.peerId});
  if(lastInvitation?.pairingId===pairingId) {
    $('#downloadInvitation').disabled=true;$('#copyInvitation').disabled=true;
    $('#hostInvitation').value='';
    pairingUI('host','expired');
    $('#hostPairStatus').textContent='This invite expired before connecting. Create a fresh invite and send it to your guest.';
  }
}
function updateInviteExpiry() {
  const previousCount=$('#hostInviteCard').dataset.pending;
  $('#hostInviteCard').dataset.pending=String(invitations.size);
  $('#hostReplyStep').hidden=!invitations.size;
  if(previousCount!==String(invitations.size))tutorialEvent('refresh');
  const pending=hostRoom && invitations.get(lastInvitation?.pairingId);
  $('#hostInviteExpiry').hidden=!pending;
  if(!pending)return;
  const seconds=Math.max(0,Math.ceil((pending.p.expiresAt-Date.now())/1000));
  if(!seconds){expireInvitation(pending.p.pairingId);$('#hostInviteExpiry').hidden=true;return;}
  $('#hostInviteExpiry').textContent=`Invite expires in ${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}. Keep this page open.`;
}
setInterval(updateInviteExpiry,1000);
let driverReady=null;
function showDriver(driver) {
  driverReady=driver?.ready===true;
  $('#driverStatus').textContent = driver?.ready ? `${driver.backend} — ready` : `Controller unavailable: ${driver?.error || 'not initialized'}. See setup instructions. Video can still stream.`;
  $('#driverNotice').hidden = !!driver?.ready;
}
function releasePeer(peerId) { inputStreams?.releaseControllers(peerId);send(injectWs, { type: 'release', peerId }); }
function closeHostPeer(peerId) {
  inputStreams?.hostRemove(peerId);
  hostDiagnostics.removeSource(peerId);
  const p = hostPeers.get(peerId); if (!p) return;
  hostViewPopouts.closePeer(p);
  hostVoice.removeControl(peerId);hostCamera.removeControl(peerId);hostScreens.removeControl(peerId);hostChat.removePeer(peerId);
  stopPeerVideo(p); releasePeer(peerId); hostPeers.delete(peerId); clearTimeout(p.recovery); clearTimeout(p.expiryTimer); clearTimeout(p.updateTimeout); clearTimeout(p.fallbackTimer); clearTimeout(p.nativeTimeout);p.grace?.stop(); p.pc.close();
  if (p.pairingId) invitations.delete(p.pairingId);
  hostCursors.remove(peerId);
  if (p.nativeKey) nativeCommand('native-close', peerId).catch(() => {});
}
function renderPeers() {
  const active=document.activeElement,focused=active?.closest('#peerList .peerRow')?{peerId:active.closest('.peerRow').dataset.peerId,key:active.dataset.peerAction || active.getAttribute('aria-label') || active.textContent}:null;
  const openMenus=new Set([...$('#peerList').querySelectorAll('.peerRow')].filter(row=>row.querySelector('.peer-menu')?.open).map(row=>row.dataset.peerId));
  $('#peerList').replaceChildren();
  let summary=$('#hostControllerSummary');if(!summary){summary=document.createElement('p');summary.id='hostControllerSummary';summary.className='small';$('#peerList').before(summary);}
  const joined=[...hostPeers.values()].reduce((sum,p)=>sum+(p.slots?.length || 0),0);
  summary.textContent=`${joined} guest controller${joined===1?'':'s'} joined`;summary.hidden=!joined && ![...hostPeers.values()].some(p=>p.wantsController);
  $('#hostPeopleCard > details.advanced').hidden=summary.hidden;
  peopleUI([...hostPeers.values()].filter(p => p.pc.connectionState === 'connected').length);
  refreshPlayerCapacity();
  if (!hostPeers.size) { const empty = document.createElement('p'); empty.className = 'empty-people'; empty.textContent = 'Your friends will appear here when they join.'; $('#peerList').append(empty); }
  for (const [id, p] of hostPeers) {
    const row = document.createElement('div'); row.className = 'peerRow';row.dataset.peerId=id;
    row.dataset.connection=p.pc.connectionState;row.dataset.wantsController=String(p.wantsController===true);row.dataset.controllers=String(p.slots?.length || 0);row.dataset.controllerError=String(!!p.controllerError);
    const avatar = document.createElement('span'); avatar.className = 'avatar friend'; avatar.textContent = p.slot ? p.slot.slice(1) : 'W'; avatar.style.border = `2px solid ${cursorColor(id,p.slot)}`;
    const label = document.createElement('div'); label.className = 'peer-info'; label.textContent = p.sessionName || `Guest ${p.diagnosticNumber ??= ++diagnosticGuestNumber}`;
    const count=p.slots?.length || 0;
    const caption = document.createElement('button');caption.type='button';caption.dataset.peerAction='toggle-controllers'; caption.className = 'person-caption guest-status-action'; caption.textContent = p.controllerError && p.pc.connectionState==='connected' && !count?'Host controller setup needed':guestCaption({state:p.pc.connectionState,count,detected:p.controllerPresence?.detected,enabled:p.controllerPresence?.enabled!==false,wantsController:p.wantsController,setupRequired:p.controllerPresence?.setupRequired});
    caption.setAttribute('aria-expanded',String(p.controllersExpanded!==false));caption.setAttribute('aria-label',`${caption.textContent}. Show or hide these controllers`);caption.onclick=()=>{p.controllersExpanded=p.controllersExpanded===false;controllers.hidden=!p.controllersExpanded;caption.setAttribute('aria-expanded',String(p.controllersExpanded));};
    label.append(caption); row.append(avatar, label);
    if(p.pc.connectionState==='failed'){
      const failure=connectionFailure(p.pc),details=document.createElement('details'),summary=document.createElement('summary'),text=document.createElement('p');
      details.className='small connection-failure-details';summary.textContent='Connection details';text.textContent=failure.report;text.style.whiteSpace='pre-line';details.append(summary,text);label.append(details);
      const save=document.createElement('button');save.className='button small-button';save.textContent='Save diagnostics';save.onclick=()=>saveConnectionReport(hostConnectionReports,save);details.append(save);
    }
    const actions = document.createElement('div'); actions.className = 'actions';
    if(p.canHost && p.pc.connectionState==='connected' && p.control?.readyState==='open'){
      const button=document.createElement('button');button.textContent='Make host';button.disabled=handoff.busy || $('#createInvitation').disabled;
      button.onclick=()=>handoff.request(id);actions.append(button);
    }
    const assignment = document.createElement('select'); assignment.setAttribute('aria-label', 'Player assignment');
    for (const [value, text] of [['watch', 'Watching'], ...hostSlots.map(slot => [slot, `Player ${slot.slice(1)}`])]) {
      const option = document.createElement('option'); option.value = value; option.textContent = text; assignment.append(option);
    }
    assignment.hidden=hostRoom?.config.dynamicControllers===true;assignment.value = p.slot || 'watch'; assignment.onchange = () => send(hostWs, { type: 'force-assign', peerId: id, slot: assignment.value === 'watch' ? null : assignment.value }); actions.append(assignment);
    const peerMenu=document.createElement('details');peerMenu.className='peer-menu';peerMenu.open=openMenus.has(id);const menuLabel=document.createElement('summary');menuLabel.textContent='More';peerMenu.append(menuLabel);const extraActions=document.createElement('div');extraActions.className='peer-menu-actions';peerMenu.append(extraActions);peerMenu.addEventListener('click',event=>{if(event.target.closest('button'))peerMenu.open=false;});actions.append(peerMenu);
    const inspect=document.createElement('button');inspect.textContent='Check guest view';inspect.disabled=p.pc.connectionState!=='connected';inspect.onclick=()=>guestView.open(id);extraActions.append(inspect);
    for (const [text, slot] of [['Disconnect computer', 'kick']]) {
      const b = document.createElement('button'); b.textContent = text;b.dataset.peerDisconnect='true';
      b.onclick = () => {if(p.sessionGuestId)sessionInvites.rejectGuest(p.sessionGuestId);send(hostWs, { type: slot === 'kick' ? 'kick' : 'force-assign', peerId: id, slot });}; extraActions.append(b);
    }
    const controllers=document.createElement('div');controllers.className='guest-controllers';controllers.hidden=p.controllersExpanded===false;
    for(const [lane,slot] of (p.slots || []).entries()){
      const device=p.controllerPresence?.controllers.find(item=>item.index===lane),item=document.createElement('div');item.className='guest-controller';item.dataset.player=slot;
      const name=document.createElement('strong');name.textContent=`${slot.toUpperCase()} · ${device?.name || 'Controller'}`;
      const status=document.createElement('span');status.className='person-caption';status.textContent=p.pc.connectionState!=='connected'?'Not connected':!device?'Assigned':!device.connected?'Controller disconnected':p.controllerPresence.enabled?'Ready to play':'Sharing paused';
      item.dataset.state=p.pc.connectionState!=='connected' || device?.connected===false?'disconnected':p.controllerPresence?.enabled?'ready':'paused';
      const info=document.createElement('div');info.append(name,status);item.append(info);
      const remove=document.createElement('button');remove.className='button small-button';remove.textContent=`Remove ${slot.toUpperCase()}`;remove.setAttribute('aria-label',`Remove guest controller ${slot.toUpperCase()}`);remove.onclick=()=>send(hostWs,{type:'controller-remove',peerId:id,controller:lane,slot,generation:p.generation || 0});item.append(remove);controllers.append(item);
    }
    if(!p.slots?.length && p.pc.connectionState==='connected' && p.wantsController){const note=document.createElement('p');note.className='small muted';note.textContent=p.controllerError?'The guest selected a controller, but this host could not create it. Repair controller support on this computer.':p.controllerPresence?.setupRequired?'Ask this guest to open Controllers and choose “Use without local blocking” or set up blocking.':p.controllerPresence?.enabled===false?'Ask this guest to resume controller sharing.':p.controllerPresence?.detected?'Ask this guest to press a controller button or select its card in Controllers.':'Ask this guest to connect a controller and open Controllers to check it.';controllers.append(note);}
    if(p.controllerError){const failure=document.createElement('p');failure.className='input-caution';failure.textContent=`Host controller setup: ${p.controllerError}`;controllers.append(failure);}
    row.append(actions,controllers); $('#peerList').append(row);
    if (p.manual) {
      const refresh = document.createElement('button'); refresh.textContent = 'Refresh connection'; refresh.disabled = p.control?.readyState !== 'open' && !p.fallbackReady;
      refresh.onclick = () => (p.pc.connectionState === 'connected' && p.control?.readyState === 'open' ? updateManualPeer(p, true) : recoverHostPeer(id)).catch(error => hostStatus(error.message)); extraActions.append(refresh);
    }
    if(['failed','disconnected'].includes(p.pc.connectionState)){
      const retry=document.createElement('button');retry.type='button';retry.className='button small-button peer-reconnect';const canRetry=p.control?.readyState==='open' || p.fallbackReady;
      retry.textContent=canRetry?'Reconnect':document.body.dataset.sessionInvites==='true' && document.body.dataset.sessionHostFiles!=='true'?'Invite again':'Create fresh invite';retry.disabled=handoff.busy || $('#createInvitation').disabled;
      retry.onclick=()=>{if(canRetry){retry.disabled=true;recoverHostPeer(id).catch(error=>hostStatus(error.message)).finally(()=>renderPeers());}else{if(p.sessionGuestId)sessionInvites.rejectGuest(p.sessionGuestId);send(hostWs,{type:'kick',peerId:id});$('#inviteFocus').click();if(!(document.body.dataset.sessionInvites==='true' && document.body.dataset.sessionHostFiles!=='true'))$('#newInvitation').click();}};actions.prepend(retry);
      extraActions.querySelectorAll('button').forEach(button=>{if(button.textContent==='Refresh connection')button.remove();});
    }
    const disconnect=extraActions.querySelector('[data-peer-disconnect]');if(disconnect)extraActions.append(disconnect);
  }
  participants?.sync();
  if(focused){const row=[...$('#peerList').querySelectorAll('.peerRow')].find(el=>el.dataset.peerId===focused.peerId),target=row && [...row.querySelectorAll('button,select,summary')].find(el=>(el.dataset.peerAction || el.getAttribute('aria-label') || el.textContent)===focused.key && !el.disabled);(target || row?.querySelector('summary') || $('#inviteFocus')).focus({preventScroll:true});}
} 
function connectInjector() {
  clearTimeout(injectReconnect);
  if (!hostRoom || hostWs?.readyState !== WebSocket.OPEN) return;
  const ws = new WebSocket(socketUrl('/inject')); injectWs = ws;
  ws.onopen = () => send(ws, { type: 'auth', roomId: hostRoom.roomId, token: hostRoom.injectToken });
  ws.onmessage = ev => { const msg = parse(ev.data); if (msg?.type === 'driver-status') showDriver(msg); if(msg?.type==='input-receipt') { const p=hostPeers.get(msg.peerId); if(p?.control?.readyState==='open') p.control.send(JSON.stringify(msg)); } };
  ws.onclose = () => {
    if (injectWs !== ws) return;
    $('#driverStatus').textContent = 'Controller bridge disconnected; reconnecting…';
    injectReconnect = setTimeout(connectInjector, 1000);
  };
}
async function recoverHostPeer(peerId) {
  if(hostEnding)return;
  const previous = hostPeers.get(peerId);
  if (!previous?.manual || !previous.fallbackReady || recoveringPeers.has(peerId)) return;
  recoveringPeers.add(peerId);
  try {
    const config = await fetchIce(hostRoom.roomId);
    const p = await makeHostPeer(peerId, previous.slot, true, config);
    p.fallback = previous.fallback; p.fallbackReady = true; p.recoveryId = crypto.randomUUID();
    hostStatus('Reconnecting your friend through the backup connection…');
    await p.pc.setLocalDescription(await p.pc.createOffer()); await gatherIce(p.pc);
    send(hostWs, { type: 'fallback-offer', peerId, id: p.recoveryId, sdp: p.pc.localDescription, ice: config });
    p.fallbackTimer = setTimeout(() => { recoveringPeers.delete(peerId); hostStatus('Reconnecting timed out. Try Refresh connection or send a fresh invite.'); }, 30000);
  } catch (error) { recoveringPeers.delete(peerId); hostStatus(`Automatic reconnection failed: ${error.message}`); }
}
async function updateManualPeer(p, restart = false) {
  if (hostEnding || p.updating || p.pc.signalingState !== 'stable' || !p.pc.remoteDescription || p.control?.readyState !== 'open') return;
  p.updating = crypto.randomUUID();
  try {
    const config = await fetchIce(hostRoom.roomId); p.pc.setConfiguration(config);
    await p.pc.setLocalDescription(await p.pc.createOffer({ iceRestart: restart })); await gatherIce(p.pc);
    p.control.send(JSON.stringify({ type: 'rtc-offer', id: p.updating, sdp: p.pc.localDescription, ice: config }));
    p.updateTimeout = setTimeout(async () => {
      p.updating = null;
      try { if (p.pc.signalingState === 'have-local-offer') await p.pc.setLocalDescription({ type: 'rollback' }); } catch { /* Connection may be closed. */ }
      hostStatus('Connection update did not arrive. If the connection is lost, exchange fresh pairing files.');
    }, 15000);
  } catch (error) {
    p.updating = null;
    try { if (p.pc.signalingState === 'have-local-offer') await p.pc.setLocalDescription({ type: 'rollback' }); } catch { /* Closed while updating. */ }
    throw error;
  }
}
function hostChannel(p, id, ch) {
  if(ch.label==='files'){ch.onopen=()=>{if(hostPeers.get(id)===p)hostChat.files.attach(id,ch,p.sessionName || `Guest ${p.diagnosticNumber ??= ++diagnosticGuestNumber}`);};if(ch.readyState==='open')ch.onopen();return;}
  if(ch.label==='chat'){p.chat=ch;ch.onopen=()=>{if(hostPeers.get(id)===p)hostChat.addPeer(id,ch,p.sessionName || `Guest ${p.diagnosticNumber ??= ++diagnosticGuestNumber}`);};return;}
  if (ch.label === 'desktop' || ch.label === 'desktop-events') {
    const snapshots = ch.label === 'desktop'; if (snapshots) p.desktopChannel = ch;
    ch.onmessage = event => {
      if (hostEnding || hostPeers.get(id) !== p || typeof event.data !== 'string' || event.data.length > 4096) return;
      const value = parse(event.data);
      const sourceId=p.controlSourceId ?? p.videoSourceId ?? '';
      if((value?.sourceId ?? '')!==sourceId || value?.desktopToken!==p.desktopToken)return;
      if (snapshots && value?.type === 'cursor') {
        if(!hostShowGuestCursors)return;
        if (![value.x,value.y].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1) || Date.now() - (p.cursorAt || 0) < 25 && p.cursorPressed===(value.pressed===true) && p.cursorVisible===(value.visible!==false)) return;
        p.cursorAt = Date.now();p.cursorPressed=value.pressed===true;p.cursorVisible=value.visible!==false;const cursor = { type: 'cursor', sourceId,peerId: id, x: value.x, y: value.y, visible: value.visible !== false, pressed: value.pressed === true, color: cursorColor(id,p.slot), label: p.slot ? `Player ${p.slot.slice(1)}` : 'Guest' };
        if(!sourceId)hostCursors.set(id, cursor);
        if (!sourceId && hostOverlayActive) send(hostWs,{type:'overlay-cursor',peerId:id,cursor,labels:hostCursorLabels});
        for (const peer of hostPeers.values()) if (peer !== p && (peer.controlSourceId ?? peer.videoSourceId ?? '')===sourceId && peer.desktopChannel?.readyState === 'open' && peer.desktopChannel.bufferedAmount < 8192) peer.desktopChannel.send(JSON.stringify(cursor));
        return;
      }
      if (!p.slot && !(hostRoom?.config.dynamicControllers && p.wantsController)) return;
      if(snapshots && value?.type==='desktop-relative')send(injectWs,{type:'desktop-relative',peerId:id,sourceId,desktopToken:value.desktopToken,seq:value.seq,dx:value.dx,dy:value.dy});
      if (value?.type === 'desktop-state' && desktopSnapshot(value.state)) send(injectWs, { type: 'desktop-state', peerId: id, sourceId, desktopToken:value.desktopToken, state: value.state });
      if (snapshots && value?.type === 'desktop-move') send(injectWs, { type: 'desktop-move', peerId: id, sourceId, desktopToken:value.desktopToken, seq: value.seq, x: value.x, y: value.y });
      if (!snapshots && value?.type === 'desktop-event') send(injectWs, { type: 'desktop-event', peerId: id, sourceId, desktopToken:value.desktopToken, event: value.event });
    };
    ch.onclose = () => { if (hostPeers.get(id) === p) { send(injectWs, { type: 'desktop-release', peerId: id }); hostCursors.remove(id); send(hostWs,{type:'overlay-remove',peerId:id}); } };
    return;
  }
  if (ch.label === 'control') {
    p.control = ch;ch.onclose=()=>{if(hostPeers.get(id)===p){hostVoice.removeControl(id);hostCamera.removeControl(id);hostScreens.removeControl(id);}};
    ch.onopen = () => { inputStreams?.hostAttach(id,ch);reverseControllers?.hostAttach(id,ch);if(!p.handoff){hostVoice.addControl(id,voiceSend(ch));hostCamera.addControl(id,voiceSend(ch));hostScreens.addControl(id,voiceSend(ch));}ch.send(JSON.stringify({ type: 'slot', inputFormat:inputWireVersion, slot: p.slot, slots:p.slots, generation:p.generation || 0, capacity:hostRoom?.config.maxRemoteControllers,adaptiveControllers:hostRoom?.config.adaptiveControllers===true, controllerType:hostRoom?.config.controllerType,dynamicControllers:hostRoom?.config.dynamicControllers===true,wantsController:p.wantsController===true, cursorColor: cursorColor(id,p.slot) })); shareInputPolicy(p); shareCaptureInfo(p); shareQualityLimit(p); shareViews(p);renderPeers(); };
    let queue = Promise.resolve();
    ch.onmessage = e => {
      // Video signaling must not hold up the control latency probe.
      const probe = typeof e.data === 'string' && e.data.length <= 131072 ? parse(e.data) : null;
      if(['app-input','reverse-controller'].includes(probe?.type))return;
      if(probe?.type==='session-ended-ack'){if(hostPeers.get(id)===p && probe.id===p.endRequest)p.endAcknowledged?.();return;}
      if(hostEnding)return;
      if(probe?.type==='host-handoff'){if(hostPeers.get(id)===p || handoff.owns(ch))handoff.receive(id,probe,ch);return;}
      if(probe?.type==='host-capability'){if(hostPeers.get(id)===p){p.canHost=probe.enabled===true;renderPeers();}return;}
      if(probe?.type==='screen'){if(hostPeers.get(id)===p)hostScreens.receive(id,probe);return;}
      if(probe?.type==='camera'){if(hostPeers.get(id)===p)hostCamera.receive(id,probe);return;}
      if(probe?.type==='voice'){if(hostPeers.get(id)===p)hostVoice.receive(id,probe);return;}
      if (probe?.type === 'ping') { ch.send(JSON.stringify({ type: 'pong', id: probe.id })); return; }
      queue = queue.then(async () => {
      if (hostEnding || hostPeers.get(id) !== p || typeof e.data !== 'string' || e.data.length > 131072) return;
      const msg = parse(e.data);
      if(await hostViewPopouts.handle(p,id,msg))return;
      if (msg?.type === 'media-subscription') {
        p.receiveVideo = msg.enabled !== false;
        if (!p.receiveVideo) stopPeerVideo(p); else await applyPeerQuality(p);
        return;
      }
      if(msg?.type==='control-view'){if(typeof msg.sourceId==='string' && (!msg.sourceId || hostShares.get(msg.sourceId)))setControlView(p,msg.sourceId);return;}
      if(msg?.type==='select-view'){if(typeof msg.sourceId==='string' && (!msg.sourceId || hostShares.get(msg.sourceId)))await switchHostView(p,msg.sourceId);return;}
      if(msg?.type==='guest-view'){guestView.receive(id,p,msg);return;}
      if(msg?.type==='controller-status'){const presence=controllerPresence(msg);if(presence && JSON.stringify(presence)!==JSON.stringify(p.controllerPresence)){p.controllerPresence=presence;renderPeers();}return;}
      if(msg?.type==='audio-answer' && msg.id===p.audioNegotiation){await nativeCommand('audio-answer',id,{sdp:msg.sdp});p.audioNegotiation=null;return;}
      if(msg?.type==='audio-restart'){await nativeCommand('audio-close',id);p.audioKey=null;p.audioNegotiation=null;ch.send(JSON.stringify({type:'audio-stop'}));await startHybridAudioPeer(p);return;}
      if (msg?.type === 'browser-answer' && p.media?.id === msg.id) {
        await setRemote(p.media, msg.sdp); await applySenderQuality(p.media); clearTimeout(p.mediaTimeout); return;
      }
      if (msg?.type === 'browser-restart') { await startBrowserPeer(p, true);await startHybridAudioPeer(p); return; }
      if (msg?.type === 'quality-request') {
        p.nativeCodecUnavailable=false;
        p.requestedQuality = clientQuality(msg.quality); p.adaptation = {};
        await applyPeerQuality(p); return;
      }
      if (msg?.type === 'stream-metrics') {
        p.cameraPressureAt=performance.now();p.cameraPressure=Object.fromEntries(['loss','rttMs','bufferMs','freezeMs','decodeMs'].map(k=>[k,typeof msg.metrics?.[k]==='number' && Number.isFinite(msg.metrics[k])?Math.max(0,Math.min(k==='loss'?1:5000,msg.metrics[k])):0]));
        if(Date.now()-(p.lastDiagnostic || 0)>=1000){p.lastDiagnostic=Date.now();hostDiagnostics.record({...msg.metrics,lossPercent:typeof msg.metrics?.loss==='number'?msg.metrics.loss*100:null},{source:id,label:`Guest ${p.diagnosticNumber ??= ++diagnosticGuestNumber}`});}
        const automatic = captureQuality.autoThrottle !== false && p.requestedQuality?.automatic !== false;
        if (!automatic || p.nativeBusy || p.nativeNegotiation || p.nativePresentationId || Date.now()-(p.mediaSettledAt || 0)<4000 || Date.now() - (p.lastMetrics || 0) < 1000 || Date.now() - p.createdAt < 8000) return;
        p.lastMetrics = Date.now();
        const metrics = Object.fromEntries(['loss', 'rttMs', 'bufferMs', 'freezeMs'].map(key => [key, typeof msg.metrics?.[key] === 'number' && Number.isFinite(msg.metrics[key]) ? Math.max(0, Math.min(key === 'loss' ? 1 : 5000, msg.metrics[key])) : 0]));
        const ceiling = effectiveQuality(captureQuality, p.requestedQuality, sourceSettings(p)).height || sourceSettings(p).height || 2160;
        const previous = p.adaptation?.height;
        p.adaptation = adaptQuality(p.adaptation, metrics, ceiling,Date.now(),qualityFloor(captureQuality,p.requestedQuality,sourceSettings(p)));
        if (previous !== p.adaptation.height) await applyPeerQuality(p);
        return;
      }
      if (msg?.type === 'native-answer' && msg.id === p.nativeNegotiation) {
        await nativeCommand('native-answer', id, { sdp: msg.sdp,sourceId:p.nativeSourceId }); p.nativeNegotiation = null;return;
      }
      if (msg?.type === 'native-restart') { p.nativeKey = null; await startNativePeer(p, true); return; }
      if(msg?.type==='native-presented' && msg.id===p.nativePresentationId){await nativeCommand('native-ready',id,{sourceId:p.nativeSourceId});p.nativePresentationId=null;p.mediaSettledAt=Date.now();clearTimeout(p.nativeTimeout);if(p.nativeAgain){p.nativeAgain=false;await startNativePeer(p);}return;}
      if(msg?.type==='controller-remove'){send(hostWs,{type:'controller-remove',peerId:id,controller:msg.controller,generation:msg.generation});return;}
      if (msg?.type === 'controller-count') { send(hostWs,{type:'controller-count',peerId:id,count:Math.min(hostRoom?.config.adaptiveControllers?Infinity:hostRoom?.config.maxRemoteControllers ?? hostSlots.length,Math.max(hostRoom?.config.dynamicControllers?0:1,Number.isInteger(msg.count)?msg.count:1))}); return; }
      if (msg?.type === 'release') { if(Number.isSafeInteger(msg.seq)) { p.lastSeq=Math.max(p.lastSeq,msg.seq); p.lastSeqs=(p.slots || []).map((_,i)=>Math.max(p.lastSeqs?.[i] ?? -1,msg.seq)); } releasePeer(id); }
      if (msg?.type === 'desktop-release') {send(injectWs,{type:'desktop-release',peerId:id,seq:msg.seq});hostCursors.remove(id);send(hostWs,{type:'overlay-remove',peerId:id});for(const peer of hostPeers.values())if(peer!==p && peer.desktopChannel?.readyState==='open')peer.desktopChannel.send(JSON.stringify({type:'cursor-hidden',peerId:id}));}
      if (msg?.type === 'bye') send(hostWs, { type: 'kick', peerId: id });
      if (msg?.type === 'rtc-restart') await updateManualPeer(p, true);
      if (msg?.type === 'rtc-answer' && msg.id === p.updating) {
        await setRemote(p, msg.sdp); clearTimeout(p.updateTimeout); p.updating = null;
        hostStatus('Connection refreshed over WebRTC');
      }
    }).catch(error => hostStatus(`Connection update failed: ${error.message}`)); };
    return;
  }
  if (ch.label !== 'input') { ch.close(); return; }
  if (p.channel) p.channel.close(); p.channel = ch;
  ch.binaryType='arraybuffer';
  ch.onmessage = ev => {
    if (hostEnding || hostPeers.get(id) !== p || typeof ev.data==='string' && ev.data.length>4096) return;
    const msg = typeof ev.data==='string'?parse(ev.data):decodeInputPacket(ev.data);
    if (acceptInput(p, msg) && ['keyboard', 'gamepad'].includes(msg.source) && (msg.source !== 'keyboard' || keyboardAllowed)){inputStreams?.controller(id,msg);send(injectWs, { type: 'state', peerId: id, controller:msg.controller ?? 0, generation:msg.generation ?? 0, source: msg.source, state: msg.state });}
  };
  ch.onclose = () => { if (hostPeers.get(id) === p && p.channel === ch) { releasePeer(id); if (p.fallbackReady) recoverHostPeer(id); } };
}
async function makeHostPeer(id, slot, manual = false, config, ownership, transport) {
  const previous=hostPeers.get(id);
  closeHostPeer(id);
  const pc = transport?.pc || new RTCPeerConnection(config || await fetchIce(hostRoom.roomId));
  hostConnectionReports.track(pc,'controls');
  const p = { pc, handoff:!!transport,slot, wantsController:ownership?.wantsController ?? previous?.wantsController ?? !!slot, slots:previous?.slots || (slot ? [slot] : []), generation:previous?.generation || 0, manual, receiveVideo: false, quality: effectiveQuality(captureQuality, {}, sourceSettings()), requestedQuality: clientQuality(), createdAt: Date.now(), lastSeq: -1, candidates: [], senders: {} };
  hostPeers.set(id, p);
  // Bind senders to the viewer's media sections after applying its offer.
  // Pre-adding transceivers here creates unmatched sections in Chromium.
  pc.onicecandidate = e => { if (!manual && e.candidate) send(hostWs, { type: 'ice', peerId: id, candidate: e.candidate, negotiationId: p.negotiationId }); };
  pc.onconnectionstatechange = () => {
    if (hostPeers.get(id) !== p) return;
    renderPeers();
    if (pc.connectionState === 'connected') pairingUI('host', lastInvitation && invitations.has(lastInvitation.pairingId)?'ready':'connected');
    if (pc.connectionState === 'connected') applyPeerQuality(p).catch(error => hostStatus(error.message));
    clearTimeout(p.recovery);
    if (['disconnected', 'failed', 'closed'].includes(pc.connectionState)) releasePeer(id);
    if (manual && pc.connectionState === 'failed') { if (p.fallbackReady) recoverHostPeer(id); }
    if (manual && pc.connectionState === 'disconnected') p.recovery = setTimeout(() => (p.fallbackReady ? recoverHostPeer(id) : updateManualPeer(p, true)).catch(error => hostStatus(error.message)), 2000);
    if (!manual && pc.connectionState === 'failed') send(hostWs, { type: 'request-offer', peerId: id });
    if (!manual && pc.connectionState === 'disconnected') p.recovery = setTimeout(() => send(hostWs, { type: 'request-offer', peerId: id }), 4000);
  };
  pc.ondatachannel = e => hostChannel(p, id, e.channel);
  pc.onnegotiationneeded = () => { if (manual) updateManualPeer(p).catch(error => hostStatus(error.message)); };
  if(transport){
    transport.adopted=true;
    for(const channel of transport.channels.values()){hostChannel(p,id,channel);if(channel.readyState==='open')channel.onopen?.();}
    transport.flush();pc.onconnectionstatechange();
  }else if (manual) {
    hostChannel(p, id, pc.createDataChannel('input', inputChannelOptions));
    hostChannel(p, id, pc.createDataChannel('control'));
    hostChannel(p, id, pc.createDataChannel('desktop', inputChannelOptions));
    hostChannel(p, id, pc.createDataChannel('desktop-events', {priority:'high'}));
    hostChannel(p,id,pc.createDataChannel('chat',{ordered:true,priority:'very-low'}));
    hostChannel(p,id,pc.createDataChannel('files',{ordered:true,priority:'very-low'}));
  }
  renderPeers(); return p;
}
function hostStartPending(value){const button=$('#hostCreate');button.setAttribute('aria-busy',String(value));button.innerHTML=`${value?'Starting session…':'Start a session'} <svg class="icon"><use href="#i-arrow"/></svg>`;}
async function connectHost(previewOnly=false) {
  if(!previewOnly)hostStartPending(true);
  nativeGuest.releaseForHost();
  const command=()=>({ type: 'create', dynamicControllers:$('#hostDynamicControllers').checked,playerCount:Number($('#hostControllerCount').value),controllerType:$('#hostControllerOutput').value });
  if (hostWs?.readyState===WebSocket.OPEN){if(!previewOnly && !hostRoom){hostWs.starting=true;send(hostWs,command());}return;}
  if(hostWs?.readyState===WebSocket.CONNECTING){await new Promise((resolve,reject)=>{hostWs.addEventListener('open',resolve,{once:true});hostWs.addEventListener('error',reject,{once:true});});if(!previewOnly && !hostRoom)send(hostWs,command());return;}
  hostEnding=false;
  if(!previewOnly){$('#hostCreate').disabled = true;}
  const ws = new WebSocket(socketUrl('/ws')); hostWs = ws; hostStatus('Connecting…');
  ws.starting=!previewOnly;
  ws.onopen = () => {if(!previewOnly)send(ws,command());};
  let queue = Promise.resolve();
  ws.onmessage = ev => { queue = queue.then(async () => {
    if (hostWs !== ws) return;
    const msg = parse(ev.data); if (!msg) return;
    if (msg.type === 'native-result') {
      const pending = nativeRequests.get(msg.requestId); if (!pending) return;
      nativeRequests.delete(msg.requestId); clearTimeout(pending.timer);
      if (msg.error) pending.reject(new Error(msg.error)); else pending.resolve(msg.result); return;
    }
    if(msg.type==='capture-source-ended'){setTimeout(()=>stopCapture().catch(e=>hostStatus(e.message)),0);return;}
    if(msg.type==='capture-resized') {
      setTimeout(()=>{qualityQueue=qualityQueue.catch(()=>{}).then(async()=>{if(!nativeCapture)return;nativePreview?.close();nativePreview=null;for(const p of hostPeers.values()){if(p.videoSourceId)continue;p.nativeKey=null;p.nativeNegotiation=null;p.nativePresentationId=null;clearTimeout(p.nativeTimeout);}await startNativePreview();await updateCapture();streamInfo(nativeSource);}).catch(e=>hostStatus(`Window resized: ${e.message}`));},0);return;
    }
    if (msg.type === 'native-status') {
      if(msg.event==='handover-timeout') {
        const p=hostPeers.get(msg.peerId);
        if(p && (p.nativeSourceId || '')===(msg.sourceId || '')) {
          clearTimeout(p.nativeTimeout);p.nativeNegotiation=null;p.nativePresentationId=null;p.nativeKey=null;p.nativeAgain=false;
          if(p.control?.readyState==='open')p.control.send(JSON.stringify({type:'native-rollback'}));
          hostStatus('The quality change could not finish. Keeping the previous stream.');
        }
      }else if(msg.event==='audio-error'){nativeAudioReady=false;nativeAudioError=msg.error;captureSetupUI();for(const p of hostPeers.values())shareCaptureInfo(p);hostStatus(`Audio stopped: ${msg.error}. Video and controllers remain available.`);}else if (msg.event === 'error') hostStatus(msg.error);
      return;
    }
    if (msg.type === 'error') {ws.lastError=msg.error;desktopPolicyPending = false; desktopAvailability(); hostStatus(msg.error); if (!ws.roomReady) ws.close(); return; }
    if (['created', 'resumed'].includes(msg.type)) {
      ws.starting=false;hostStartPending(false);
      ws.roomReady = true; hostRoom = msg;diagnosticGuestNumber=0;
      // Fetch provider credentials while the user prepares the invitation;
      // simultaneous voice/invite requests share this lookup.
      fetchIce(msg.roomId).catch(()=>{});
      applyConfig(msg.config);hostVoice.setGuestMicAllowed($('#hostAllowGuestMic').checked);hostCamera.setGuestVideoAllowed($('#hostAllowGuestVideo').checked);hostVoice.setReady(true);hostCamera.setReady(true);hostScreens.setGuestVideoAllowed($('#hostAllowGuestScreens').checked);hostScreens.setReady(true);hostChat.setReady(true);hostChat.files.setPolicy({files:$('#hostAllowFiles').checked,clipboard:$('#hostAllowClipboard').checked});
      $('#hostCapture').disabled = false; $('#hostEnd').disabled = false; $('#createInvitation').disabled = false;
      hostSessionUI(true);hostShares.setActive(true); $('#hostPairStatus').textContent = 'Session ready. Create an invite for your friend.';
      sessionInvites.hostStarted();
      desktopAvailability();
      hostStatus('Session ready'); showDriver(msg.driver); connectInjector();
      if (msg.type === 'resumed') { keyboardAllowed = msg.allowKeyboard !== false; $('#hostAllowKeyboard').checked = keyboardAllowed; }
      send(ws, { type: 'input-policy', allowKeyboard: keyboardAllowed }); tutorialEvent('host-started');
      for (const id of hostPeers.keys()) closeHostPeer(id);
      for (const p of msg.peers || []) { const peer=await makeHostPeer(p.peerId,p.slot,false,undefined,p); peer.slots=p.slots || (p.slot?[p.slot]:[]); peer.generation=p.generation || 0; }
      renderPeers();
      // Native commands receive replies on this queue, so start capture after this message completes.
      if(selectedSource==='none')applyPreparedDesktop();
      if(selectedSource!=='none') {
        const room=hostRoom;
        if(msg.previewAdopted && nativeCapture){hostSharingUI(true);streamInfo(nativeSource);applyPreparedDesktop();}
        else setTimeout(()=>{if(hostRoom===room){if(audioOnly() && selectedSource==='audio-only')configureHybridAudio().then(applyPreparedDesktop).catch(error=>hostStatus(error.message));else startCapture(true);}},0);
      }
      return;
    }
    if(msg.type==='rumble'){const p=hostPeers.get(msg.peerId);if(p?.control?.readyState==='open' && p.control.bufferedAmount<8192)p.control.send(JSON.stringify(msg));return;}
    if (msg.type === 'driver-status') { showDriver(msg); return; }
    if (msg.type === 'cursor-overlay') { hostOverlayActive=msg.enabled===true;hostOverlayPending=null; desktopAvailability(); if (msg.error) hostStatus(msg.error); return; }
    if(msg.type==='view-input-policy'){const source=hostShares.get(msg.sourceId);if(source){source.policy=msg.policy;hostShares.render();desktopAvailability();for(const p of hostPeers.values())shareInputPolicy(p);}return;}
    if (msg.type === 'input-policy') { keyboardAllowed = msg.allowKeyboard !== false; $('#hostAllowKeyboard').checked = keyboardAllowed; hostDesktopPolicy = { desktopRelative:msg.desktopRelative===true,desktopMouse: msg.desktopMouse === true, desktopKeyboard: msg.desktopKeyboard === true, desktopSimulated: msg.desktopSimulated === true, desktopFullAccess:msg.desktopFullAccess===true, desktopScope:msg.desktopScope,pointerOverlaySafe:msg.pointerOverlaySafe===true,sharedSource:msg.sharedSource,desktopCropped:msg.desktopCropped===true, desktopSize: msg.desktopSize, desktopVideoMatches: msg.desktopVideoMatches === true }; desktopPolicyPending = false; desktopAvailability();syncCursorOverlay();if(!hostShowGuestCursors)hostCursors.clear();for (const p of hostPeers.values()) shareInputPolicy(p);if(preparedDesktopPolicy && !captureBusy)applyPreparedDesktop();return; }
    if (msg.type === 'fallback-connected' || msg.type === 'fallback-disconnected') {
      const p = hostPeers.get(msg.peerId); if (!p) return;
      p.fallbackReady = msg.type === 'fallback-connected'; renderPeers();
      if (p.fallbackReady && ['failed', 'disconnected', 'closed'].includes(p.pc.connectionState)) recoverHostPeer(msg.peerId);
      return;
    }
    if (msg.type === 'fallback-restart') { recoverHostPeer(msg.peerId); return; }
    if (msg.type === 'fallback-answer') {
      const p = hostPeers.get(msg.peerId);
      if (p?.recoveryId === msg.id) { await setRemote(p, msg.sdp); clearTimeout(p.fallbackTimer); p.recoveryId = null; recoveringPeers.delete(msg.peerId); hostStatus('Your friend reconnected automatically'); }
      return;
    }
    if (msg.type === 'fallback-error') { recoveringPeers.delete(msg.peerId); hostStatus(msg.error); return; }
    if (msg.type === 'peer-registered') { registrations.get(msg.requestId)?.(msg); registrations.delete(msg.requestId); return; }
    if (msg.type === 'peer-joined') { await makeHostPeer(msg.peerId, msg.slot,false,undefined,msg); return; }
    if (msg.type === 'peer-left') { closeHostPeer(msg.peerId); recoveringPeers.delete(msg.peerId); pendingIce.delete(msg.peerId); renderPeers(); return; }
    if(msg.type==='controller-error'){hostStatus(msg.error);const p=hostPeers.get(msg.peerId);if(p){p.controllerError=msg.error;if(p.control?.readyState==='open')p.control.send(JSON.stringify(msg));renderPeers();}return;}
    if (msg.type === 'slot-update') { const p = hostPeers.get(msg.peerId); if (p) { const changed=p.generation!==(msg.generation || 0);if(changed)releasePeer(msg.peerId); p.slot = msg.slot; p.slots=msg.slots || (msg.slot?[msg.slot]:[]); p.wantsController=msg.wantsController; p.generation=msg.generation || 0;if(changed){p.lastSeq=-1;p.lastSeqs=[];} if (p.control?.readyState === 'open') p.control.send(JSON.stringify({ type: 'slot', inputFormat:inputWireVersion, slot: p.slot, slots:p.slots, generation:p.generation || 0, removedController:msg.removedController, capacity:hostRoom?.config.maxRemoteControllers,adaptiveControllers:hostRoom?.config.adaptiveControllers===true, controllerType:hostRoom?.config.controllerType,dynamicControllers:hostRoom?.config.dynamicControllers===true,wantsController:p.wantsController===true, cursorColor: cursorColor(msg.peerId,p.slot) })); renderPeers(); } return; }
    if (msg.type === 'offer') {
      let p = hostPeers.get(msg.peerId); if (!p) return;
      if (p.pc.remoteDescription) p = await makeHostPeer(msg.peerId, p.slot);
      p.negotiationId = msg.negotiationId;
      const pending = pendingIce.get(msg.peerId);
      if (pending?.id === p.negotiationId) p.candidates.push(...pending.candidates);
      pendingIce.delete(msg.peerId);
      await setRemote(p, msg.sdp);
      await p.pc.setLocalDescription(await p.pc.createAnswer());
      send(ws, { type: 'answer', peerId: msg.peerId, sdp: p.pc.localDescription, negotiationId: p.negotiationId });
    }
    if (msg.type === 'ice') {
      const p = hostPeers.get(msg.peerId); if (!p) return;
      if (p.negotiationId === msg.negotiationId) await addCandidate(p, msg.candidate);
      else {
        let pending = pendingIce.get(msg.peerId);
        if (pending?.id !== msg.negotiationId) { pending = { id: msg.negotiationId, candidates: [] }; pendingIce.set(msg.peerId, pending); }
        if (pending.candidates.length < 64) pending.candidates.push(msg.candidate);
      }
    }
  }).catch(error => hostStatus(`Connection error: ${error.message}`)); };
  ws.onclose = () => {
    if (hostWs !== ws) return;
    handoff.cancel('Host disconnected. The host switch was cancelled.');
    ws.starting=false;hostStartPending(false);$('#hostEnd').setAttribute('aria-busy','false');if($('#hostEnd span'))$('#hostEnd span').textContent='Stop session';
    for (const request of nativeRequests.values()) { clearTimeout(request.timer); request.reject(new Error('Host session ended')); } nativeRequests.clear();
    nativeCapture = false; nativePreview?.close(); nativePreview = null;
    hostRoom = null;hostVoice.setReady(false);hostCamera.setReady(false);hostScreens.setReady(false);hostChat.setReady(false);
    clearPreparedDesktop();hostOverlayActive=false;hostOverlayPending=null;hostDesktopPolicy = { desktopMouse: false, desktopKeyboard: false }; desktopPolicyPending = false; desktopAvailability(); hostCursors.clear(); 
    hostStatus(hostEnding?'Session ended. Start a new session when you are ready.':!ws.roomReady?ws.lastError || 'Preview disconnected. Choose a source to try again.':'Host disconnected. Start a session and send fresh invitations.');
    hostEnding=false;
    clearTimeout(injectReconnect); injectWs?.close(); injectWs = null;
    for (const id of hostPeers.keys()) closeHostPeer(id);
    pendingIce.clear(); renderPeers(); $('#hostCreate').disabled = false; $('#hostEnd').disabled = true; $('#createInvitation').disabled = true;
    lastInvitation=null;$('#hostInvitation').value='';$('#downloadInvitation').disabled=true;$('#copyInvitation').disabled=true;updateInviteExpiry();pairingFeedback('host');
    stopCapture().then(()=>{if(ws.roomReady && !hostRoom && document.body.dataset.mode==='host'){lastSharePending=!!lastHostSetup?.source;restoreLastShareSource();renderCaptureSources();}}).catch(error=>hostStatus(error.message));
    hostSessionUI(false);hostShares.setActive(false);
    sessionInvites.endHosting();sessionGuestPeers.clear();
  };
  if(previewOnly)await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',()=>reject(new Error('Could not connect to the local preview service')),{once:true});ws.addEventListener('close',()=>reject(new Error('Local preview service closed')),{once:true});});
}
$('#hostCreate').onclick = async () => {
  if(captureBusy)return;
  $('#hostCreate').disabled=true;hostStartPending(true);
  try {
    if(captureBusy)return;
    if(rememberedBrowserShare && !captureStream){if(!await startCapture())return;rememberedBrowserShare=false;}
    if(selectedSource==='browser-selected' && captureStream?.getVideoTracks()[0]?.readyState!=='live' && !await startCapture())return;
    rememberHostSetup();
    await connectHost();
  } catch(error) {hostStatus(error.message);}
  finally {if(!hostWs?.starting)hostStartPending(false);if(!hostWs || hostWs.readyState>=WebSocket.CLOSING)$('#hostCreate').disabled=false;}
};
$('#hostEnd').onclick = async () => {
  if(hostEnding || !hostRoom)return;
  const endingWs=hostWs,endingRoom=hostRoom;
  hostEnding=true;$('#hostEnd').disabled=true;$('#hostEnd').setAttribute('aria-busy','true');if($('#hostEnd span'))$('#hostEnd span').textContent='Ending…';handoff.cancel('Host switch cancelled.');
  // Freeze input immediately; keep control transport briefly to deliver the end message.
  for(const id of hostPeers.keys())releasePeer(id);
  send(hostWs,{type:'desktop-stop'});
  const pending=[...hostPeers.values()].map(p=>{
    if(p.control?.readyState!=='open')return Promise.resolve();
    return new Promise(resolve=>{const timer=setTimeout(()=>{p.endAcknowledged=null;resolve();},300);p.endRequest=crypto.randomUUID();p.endAcknowledged=()=>{clearTimeout(timer);p.endAcknowledged=null;resolve();};try{p.control.send(JSON.stringify({type:'session-ended',id:p.endRequest}));}catch{p.endAcknowledged();}});
  });
  clearPreparedDesktop();hostOverlayActive=false;hostOverlayPending=null;hostVoice.setReady(false);hostCamera.setReady(false);hostScreens.setReady(false);hostChat.setReady(false);hostShares.clear();
  stopCapture().catch(e => hostStatus(e.message));
  await Promise.all(pending);if(hostWs===endingWs && hostRoom===endingRoom){send(endingWs, { type: 'end' });hostRoom=null;}
};
async function registerManualPeer(role) {
  if (hostWs?.readyState !== WebSocket.OPEN || !hostRoom) throw new Error('Start hosting first');
  const requestId = crypto.randomUUID();
  return await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { registrations.delete(requestId); reject(new Error('Player registration timed out')); }, 5000);
    registrations.set(requestId, msg => { clearTimeout(timeout); resolve(msg); });
    send(hostWs, { type: 'register-peer', role, requestId });
  });
}
async function prepareInvitation(fresh=false,role=$('#invitationRole').value) {
  if(invitationPreparation){const packet=await invitationPreparation;return fresh?prepareInvitation(true,role):packet;}
  if(handoff.busy || !hostRoom || hostWs?.readyState!==WebSocket.OPEN)return;
  if(!fresh && lastInvitation){
    if(lastInvitation.expiresAt<=Date.now())expireInvitation(lastInvitation.pairingId);
    if(invitations.has(lastInvitation.pairingId))return lastInvitation;
    toast('Click New invite to invite another guest.');return;
  }
  const room=hostRoom,ws=hostWs;
  const button = $('#createInvitation'); button.disabled = true;
  pairingFeedback('host');
  pairingUI('host', 'generating'); $('#hostPairStatus').textContent = 'Preparing connection settings…';
  invitationPreparation=(async()=>{
  let peerId;
  try {
    const config = await fetchIce(room.roomId);
    if(hostRoom!==room)return;
    const registered = await registerManualPeer(role); peerId = registered.peerId;
    if(hostRoom!==room)return;
    const p = await makeHostPeer(peerId, registered.slot, true, config,registered);
    p.fallback = registered.fallback;
    p.pairingId = crypto.randomUUID();
    await p.pc.setLocalDescription(await p.pc.createOffer());
    await gatherIce(p.pc,30000,{onProgress:stage=>{$('#hostPairStatus').textContent=stage==='relay'?'Checking the relay for remote connections…':'Preparing your invite file…';}});
    if(hostRoom!==room)return;
    if (config.iceServers.some(s => (Array.isArray(s.urls) ? s.urls : [s.urls]).some(u => /^turns?:/.test(u))) && !/ typ relay(?: |\r|\n)/.test(p.pc.localDescription.sdp)) $('#networkStatus').textContent = 'Direct routes found, but no relay route was discovered. Connections across some networks may fail.';
    lastInvitation = pairingPacket('offer', p.pairingId, p.pc.localDescription, config, p.slot, undefined, registered.fallback);
    hostConnectionReports.sharedDescription(p.pc,p.pc.localDescription);
    p.expiresAt = lastInvitation.expiresAt; invitations.set(p.pairingId, { peerId, p });
    $('#hostInviteCard').dataset.inviteAccess=role==='watch'?'Just watching':'Play';
    $('#hostInvitation').value = JSON.stringify(lastInvitation, null, 2); $('#downloadInvitation').disabled = false;$('#copyInvitation').disabled=false;updateInviteExpiry();
    pairingUI('host', 'ready'); $('#hostPairStatus').textContent = 'Invite ready. Download the file or copy the text, then send it to your guest.';
    tutorialEvent('host-invite-ready');
    p.expiryTimer = setTimeout(() => {
      if (invitations.has(p.pairingId) && p.pc.connectionState !== 'connected') expireInvitation(p.pairingId);
    }, 10 * 60 * 1000);
    return lastInvitation;
  } catch (error) {
    if(hostRoom!==room)return;
    pairingUI('host', 'error');
    $('#hostPairStatus').textContent = error.message;
    pairingFeedback('host',error.message,'invite');
    if (peerId) send(ws, { type: 'kick', peerId });
  } finally { button.disabled = !hostRoom || hostWs?.readyState !== WebSocket.OPEN; }
  })();
  try{return await invitationPreparation;}finally{invitationPreparation=null;}
}
$('#createInvitation').onclick = async (event,transfer='file',fresh=false) => {
  $('#hostInviteCard').dataset.transfer=transfer==='text'?'text':'file';
  const packet=await prepareInvitation(fresh);
  if(packet && transfer==='file' && !sessionInvites.preparingOffer){
    autoDownloadPairing($('#downloadInvitation'));
    $('#hostPairStatus').textContent='Invite downloaded. Send it to your guest, then open or paste their reply.';
  }
  return packet;
};
// Installed before initUI adds the export controls.
$('#newInvitation').onclick=()=>prepareInvitation(true);
$('#downloadInvitation').onclick = () => { if(lastInvitation && lastInvitation.expiresAt>Date.now())downloadPairing(lastInvitation);else if(lastInvitation)expireInvitation(lastInvitation.pairingId); };
$('#acceptReply').onclick = async () => {
  if($('#acceptReply').disabled)return;
  $('#acceptReply').disabled=true;pairingFeedback('host');
  try {
    if(!hostRoom)throw new Error('Start a session first, then create an invite for your guest.');
    const reply = parsePairing($('#hostReply').value, 'answer');
    const invitation = invitations.get(reply.pairingId);
    if (!invitation) {
      const previous=[...hostPeers.values()].find(p=>p.pairingId===reply.pairingId && p.pc.remoteDescription?.sdp===reply.sdp.sdp);
      if(previous){toast(previous.pc.connectionState==='connected'?'This guest is already connected.':'This reply is already accepted. Your guest is connecting.');return;}
      throw new Error('This reply belongs to another invite or an earlier session. Ask your guest to open an invite from this session and send its reply.');
    }
    if (invitation.p.expiresAt < Date.now()) throw new Error('The invitation expired. Create a fresh one.');
    await setRemote(invitation.p, reply.sdp); invitations.delete(reply.pairingId); clearTimeout(invitation.p.expiryTimer);updateInviteExpiry();
    if(lastInvitation?.pairingId===reply.pairingId){$('#downloadInvitation').disabled=true;$('#copyInvitation').disabled=true;}
    pairingUI('host', lastInvitation && invitations.has(lastInvitation.pairingId)?'ready':'connected'); $('#hostPairStatus').textContent = 'Reply received. Your friend is joining…'; $('#hostReply').value = '';
    tutorialEvent('host-reply-opened');
  } catch (error) { $('#hostPairStatus').textContent = error.message;pairingFeedback('host',error.message,!hostRoom?'start':/expired/.test(error.message)?'invite':'file'); }
  finally {$('#acceptReply').disabled=false;}
};
for (const [id, target] of [['hostReplyFile', 'hostReply'], ['clientInvitationFile', 'clientInvitation']]) {
  $(`#${id}`).onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    const side=id==='hostReplyFile'?'host':'client';
    try {
      if(file.size>131072)throw new Error('This file is too large. Choose the small invite or reply text file from the app.');
      if($(id==='hostReplyFile'?'#acceptReply':'#createReply').disabled)throw new Error('A file is already being prepared. Wait for it to finish, then try again.');
      $(`#${target}`).value = await file.text();
      if(side==='client')$('#clientPairing').dataset.transfer='file';
      $(id === 'hostReplyFile' ? '#acceptReply' : '#createReply').click();
    } catch(error) { const message=error.message || 'Could not open that file. Please try again.';pairingFeedback(side,message);$(`#${side}PairStatus`).textContent=message; }
    finally {e.target.value='';}
  };
}
async function updateCapture(expectedEpoch=captureEpoch) {
  hostViewPopouts.refreshMain();
  for (const [id, p] of hostPeers) {
    if(expectedEpoch!==captureEpoch)return;
    shareCaptureInfo(p);
    const available=sharedSources();if(available.length && !available.some(s=>s.id===(p.videoSourceId || ''))){await switchHostView(p,available[0].id);continue;}
    shareViews(p);
    try { if (!hostMediaActive() && !hostShares.get(p.videoSourceId)) stopPeerVideo(p); else await applyPeerQuality(p); }
    catch (error) { if(expectedEpoch===captureEpoch)hostStatus(`Updating video: ${error.message}. Controller sharing is still available.`); }
  }
}
async function stopCapture(clearSelection=true) {
  const epoch=++captureEpoch,wasNative=nativeCapture,wasBusy=captureBusy;
  captureBusy=false;$('#hostCapture').dataset.starting='false';
  if(clearSelection){selectedSource='none';captureArea.value=null;captureArea.render();restoredShareArea=false;}
  nativeCapture=false;nativePreview?.close();nativePreview=null;nativeCaptureDescription='';activeNativeEncoder=null;
  const old=captureStream;captureStream=null;captureArea.stopBrowser();old?.getTracks().forEach(track=>track.stop());
  $('#hostPreview').pause();$('#hostPreview').srcObject=null;
  const audioCleanup=stopHybridAudio();
  const cleanup=[audioCleanup];
  if(wasNative){
    for(const p of hostPeers.values()){if(p.videoSourceId)continue;p.nativeKey=null;p.nativeNegotiation=null;p.nativePresentationId=null;p.nativeAgain=false;clearTimeout(p.nativeTimeout);if(p.control?.readyState==='open')p.control.send(JSON.stringify({type:'native-stop'}));}
    cleanup.push(nativeCommand('native-stop','preview').catch(()=>{}));
  }
  if(hostRoom && hostWs?.readyState===WebSocket.OPEN)cleanup.push(nativeCommand('capture-source','preview',{kind:'none'}).catch(()=>{}));
  nativeAudioReady=false;nativeAudioError='';nativeAudioBusy=false;desktopAvailability();
  hostSharingUI(false);streamInfo(null);$('#hostCapture').disabled=!hostRoom;$('#hostStopCapture').disabled=true;renderCaptureSources();
  if(wasBusy)hostStatus(capturePickerPending?'Selection cancelled in the app. Close the browser sharing dialog if it is still open.':'Source selection cancelled.');
  // Notify viewers without holding the local controls until their negotiation finishes.
  updateCapture(epoch).catch(error=>{if(epoch===captureEpoch)hostStatus(error.message);});
  await Promise.all(cleanup);
}
async function startCapture(reusePrepared = false) {
  if(captureBusy)return false;
  if(capturePickerPending){hostStatus('Close the previous browser sharing dialog, then choose a source again.');return false;}
  if(audioOnly() && $('#nativeAudioTarget').value==='none'){$('#hostLiveSource').open=!!hostRoom;$('#nativeAudioTarget').focus({preventScroll:true});return false;}
  if(!audioOnly() && $('#captureBackend').value==='native' && selectedSource==='none') {
    if(hostRoom)$('#hostLiveSource').open=true;
    const trigger=$('#captureTarget').closest('.source-picker')?.querySelector('.source-picker-trigger');trigger?.scrollIntoView({block:'nearest'});trigger?.focus({preventScroll:true});
    await captureSourcePicker.open();
    return false;
  }
  captureMethodInitialized=true;
  captureBusy=true;
  $('#hostCapture').dataset.starting='true';
  let epoch=++captureEpoch;const room=hostRoom;
  $('#hostCapture').disabled = true;
  hostSharingUI(hostMediaActive(),!room);captureSetupUI();
  tutorialEvent('host-capture-updated');
  let stream;
  try {
    if(audioOnly() && $('#nativeAudioTarget').value!=='browser'){selectedSource='audio-only';await configureHybridAudio();return epoch===captureEpoch;}
    if (!audioOnly() && $('#captureBackend').value === 'native') {
      if(!room)await connectHost(true);
      if(epoch!==captureEpoch || hostRoom!==room)return false;
      nativeAudioConfigured=nativeAudioEnabled();
      if(room)queueDesktopSource();
      await nativeCommand('capture-source','preview',{kind:'native',id:selectedSource,audio:nativeAudioConfigured,region:captureArea.current()});
      if(epoch!==captureEpoch || hostRoom!==room)return false;
      for(const p of hostPeers.values()){if(p.videoSourceId)continue;p.nativeKey=null;p.nativeNegotiation=null;p.nativePresentationId=null;clearTimeout(p.nativeTimeout);if(p.control?.readyState==='open')p.control.send(JSON.stringify({type:'native-stop'}));}
      nativeCapture = true;
      await startNativePreview();
      if(epoch!==captureEpoch || hostRoom!==room)return false;
      for (const p of hostPeers.values()) { if(p.videoSourceId)continue;p.media?.pc.close(); p.media = null; }
      const previous = captureStream; captureStream = null;captureArea.stopBrowser();previous?.getTracks().forEach(track => track.stop());
      updateCapture(epoch).catch(error=>{if(epoch===captureEpoch)hostStatus(error.message);});hostSharingUI(true,!room);streamInfo(nativeSource);
      $('#hostStopCapture').disabled = false; hostStatus(!room?'Preview only. Check the picture, then click Start a session when ready.':nativeAudioReady?'Picture and sound are streaming.':'Picture is streaming. Audio is off.');
      if(!room)tutorialEvent('host-source-ready');document.dispatchEvent(new Event('call-share-ready'));return true;
    }
    if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('Screen sharing requires HTTPS or localhost and a supported browser.');
    if(reusePrepared && captureStream?.getVideoTracks()[0]?.readyState==='live')stream=captureStream;
    else{capturePickerPending=true;try{stream=await navigator.mediaDevices.getDisplayMedia({video:captureConstraints(captureQuality),audio:$('#nativeCaptureAudio').checked && !hybridAudioWanted(),systemAudio:'include',windowAudio:'window'});}finally{capturePickerPending=false;}}
    if(epoch!==captureEpoch || room!==hostRoom){if(stream!==captureStream)stream.getTracks().forEach(t=>t.stop());return false;}
    if(nativeCapture){const stoppedEpoch=captureEpoch+1;await stopCapture(false);if(captureEpoch!==stoppedEpoch || room!==hostRoom){stream.getTracks().forEach(t=>t.stop());return false;}epoch=stoppedEpoch;captureBusy=true;$('#hostCapture').dataset.starting='true';hostSharingUI(false,!room);captureSetupUI();}
    const rawTrack=(stream._areaSource || stream).getVideoTracks()[0],rawSize=rawTrack.getSettings();
    let actual = await applyCaptureSettings(rawTrack, captureArea.current()?{...captureQuality,width:rawSize.width,height:rawSize.height}:captureQuality);
    if(epoch!==captureEpoch || room!==hostRoom){if(stream!==captureStream)stream.getTracks().forEach(t=>t.stop());return false;}
    stream=captureArea.browser(stream,captureQuality.frameRate);actual={...actual,...stream.getVideoTracks()[0].getSettings()};
    if(epoch!==captureEpoch || room!==hostRoom) {if(stream!==captureStream)stream.getTracks().forEach(t=>t.stop());return false;}
    const track=stream.getVideoTracks()[0];
    if(room)queueDesktopSource();
    if(room)await nativeCommand('capture-source','preview',audioOnly()?{kind:'none'}:{kind:'browser',surface:actual.displaySurface,label:track.label,region:captureArea.current()});
    if(epoch!==captureEpoch || room!==hostRoom) {if(stream!==captureStream)stream.getTracks().forEach(t=>t.stop());return false;}
    const old = captureStream; captureStream = stream; if(old!==stream)old?.getTracks().filter(t=>!stream.getTracks().includes(t) && !(stream._areaSource || stream).getTracks().includes(t)).forEach(t => t.stop());
    selectedSource='browser-selected';
    if(actual.displaySurface==='window' && windowTargetAvailable)refreshCaptureTargets(true);
    try {localStorage.setItem('webrtc-pad:capture-method','browser');}catch{}
    renderCaptureSources();
    if (previewWanted()) $('#hostPreview').srcObject = stream; else { $('#hostPreview').pause(); $('#hostPreview').srcObject = null; }
    hostSharingUI(true,!room);
    streamInfo(actual);
    stream.getVideoTracks()[0].onended = () => { if (captureStream === stream) stopCapture().catch(e => hostStatus(e.message)); };
    for(const audio of stream.getAudioTracks())for(const event of ['ended','mute','unmute'])audio.addEventListener(event,()=>{if(captureStream===stream){captureSetupUI();if(hostRoom)updateCapture().catch(e=>hostStatus(e.message));}});
    $('#hostStopCapture').disabled = false;
    if(hybridAudioWanted())await configureHybridAudio();else if(hybridAudioSource)await stopHybridAudio();
    if(room)updateCapture(epoch).catch(error=>{if(epoch===captureEpoch)hostStatus(error.message);});
    if(epoch!==captureEpoch)return false;
    hostStatus(!room?'Screen selected. Start your session when ready.':stream.getAudioTracks().length ? 'Streaming video and audio' : 'Streaming video. This capture source did not provide audio.');
    if(!room)tutorialEvent('host-source-ready');
    document.dispatchEvent(new Event('call-share-ready'));
    return true;
  } catch (error) { if(epoch!==captureEpoch){if(stream && stream!==captureStream)stream.getTracks().forEach(t=>t.stop());return false;}if (stream && stream !== captureStream) stream.getTracks().forEach(t => t.stop()); const message=error.name==='NotAllowedError'?(selectedSource==='none'?'Screen selection cancelled. Start without video, or choose a source.':'Screen selection cancelled. Your previous source is kept.'):error.message;if(nativeCapture && error.name!=='NotAllowedError'){const cleanup=stopCapture();hostStatus(message);await cleanup;}else hostStatus(message);return false; }
  finally {if(epoch===captureEpoch){captureBusy=false;if(nativeCapture && nativeAudioConfigured!==nativeAudioEnabled())updateNativeAudio();$('#hostCapture').dataset.starting='false';$('#hostCapture').disabled=!hostRoom;if(selectedSource!=='none' && selectedSource!=='browser-selected')$('#captureBackend').value='native';hostSharingUI(hostMediaActive(),!hostRoom);renderCaptureSources();if(hostMediaActive())rememberHostSetup();tutorialEvent('host-capture-updated');}else captureSetupUI();}
}
$('#hostCapture').onclick = () => startCapture();
$('#hostStopCapture').onclick = () => {lastSharePending=false;rememberedBrowserShare=false;stopCapture().then(rememberHostSetup).catch(e => hostStatus(e.message));};
let previewTimer;
function updateHostPreview() {
  const video = $('#hostPreview'), wanted = previewWanted();
  hostSharingUI(hostMediaActive(),!hostRoom);
  if (!wanted) { video.pause(); video.srcObject = null; }
  else if (captureStream) { video.srcObject = captureStream; video.play().catch(() => {}); }
  if (nativeCapture) {
    // Focus changes affect local presentation only. Closing/recreating this
    // receiver also churns shared encoder references and native signaling.
    if(wanted && nativePreview){video.srcObject=nativePreview.previewStream;video.play().catch(()=>{});}
    else if (wanted && !nativePreviewPending) startNativePreview().catch(error => hostStatus(`Preview: ${error.message}. Guest streaming continues.`));
  }
}
for (const id of ['hostPreviewToggle','hostPreviewAutoPause']) $(`#${id}`).onchange = () => {
  try { localStorage.setItem(`webrtc-pad:${id}`,String($(`#${id}`).checked)); } catch { /* Session settings still work. */ }
  updateHostPreview();
};
$('#hostMonitorToggle').onclick=()=>{
  $('#hostPreviewToggle').checked=!$('#hostPreviewToggle').checked;
  $('#hostPreviewToggle').dispatchEvent(new Event('change'));
};
for (const event of ['focus','blur']) window.addEventListener(event, () => { clearTimeout(previewTimer); previewTimer=setTimeout(updateHostPreview,150); });
document.addEventListener('visibilitychange',updateHostPreview);
document.addEventListener('app-mode',updateHostPreview);

let clientPeer, sendTimer, statsTimer, assignedSlot = null, enabled = false, sequence = 0;
const desktopKeys = new Set(), desktopButtons = new Set();
let gameMouse,desktopSequence=0,desktopMoveSequence=0,desktopPosition=null,desktopPositionDirty=false,cursorSentAt=0,pointerPosition=null;const pointerButtons=new Set();
function releaseDesktopClient() {
  gameMouse?.exit();
  desktopKeys.clear(); desktopButtons.clear(); desktopPositionDirty = false;releaseGuestPointer();
  if (clientPeer?.control?.readyState === 'open') clientPeer.control.send(JSON.stringify({ type: 'desktop-release', seq: desktopSequence++ }));
}
function updateDesktopMouse() {
  $('#clientReleaseInputs').hidden=clientPeer?.pc.connectionState!=='connected' || !($('#clientDesktopMouse').checked || desktopTyping() || nativeGuest.active);
  const allowed = !guestTiles.viewOnly && !!clientPeer?.desktopMouse && canUseClientInputs() && clientPeer.pc.connectionState === 'connected' && clientPeer.channel?.readyState === 'open';
  $('#clientDesktopMouse').disabled = !allowed;
  if (!allowed) $('#clientDesktopMouse').checked = false;
  $('#clientStage').classList.toggle('remote-mouse', $('#clientDesktopMouse').checked);
  const videoLive = guestTiles.active?!!pointerSurface():hasClientVideo();
  const realMouse=$('#clientDesktopMouse').checked && clientPeer?.desktopMouse,padSize=realMouse?clientPeer?.desktopSize:clientPeer?.pointerSize;
  const pad=!videoLive && !!padSize && (realMouse || clientPeer?.showCursors && clientPeer.pc.connectionState==='connected');
  $('#clientStage').classList.toggle('mouse-pad',pad);
  if(pad){
    $('#clientStage').style.aspectRatio=`${padSize.width}/${padSize.height}`;$('#clientStage').classList.remove('has-video');$('#clientEmpty').hidden=false;$('#clientStageLabel').hidden=true;
    $('#clientStageTitle').textContent=realMouse?'Remote mouse pad':'Guest pointer pad';
    $('#clientStageNote').textContent=realMouse?'Click or drag inside this pad to move the host’s system pointer. Use your wheel to scroll.':'Point or click here to show your colored marker. This does not move the host’s mouse or click apps.';
  }else{$('#clientStage').style.removeProperty('aspect-ratio');if(!videoLive)playerVideoUI(false);}
  guestCursors.source(pad?padSize:null);guestCursors.surface(()=>pointerSurface());
  $('#clientDesktopNote').textContent = clientPeer?.desktopSimulated ? 'Demo mode: click, drag or scroll inside the test screen to try mouse control.' : clientPeer?.desktopSize ? `${clientPeer.desktopScope==='window' ? clientPeer.sharedSource || 'Shared window' : 'Host desktop'}: ${clientPeer.desktopSize.width} × ${clientPeer.desktopSize.height}. ${videoLive && !clientPeer.desktopVideoMatches ? 'This video does not match the approved mouse surface; turn video off to use the approved mouse pad.' : 'Click inside the picture or mouse pad to control this area.'}` : 'Ask the host to enable desktop control to use these options.';
  // Live call controls live in the toolbar. Native video controls pause on a
  // focus click, leaving a frozen picture while RTC keeps decoding frames.
  $('#clientVideo').controls = false;
  gameMouse?.refresh();
}
function desktopReady() { return !chatting() && !guestTiles.viewOnly && !guestTiles.switching && (!guestTiles.active || clientPeer?.desktopSourceId===guestTiles.featured) && !nativeGuest.blocksBrowser && canUseClientInputs() && (nativeGuest.active || !document.hidden && document.hasFocus()) && clientPeer?.pc.connectionState === 'connected' && clientPeer.channel?.readyState === 'open'; }
function hasClientVideo() { return $('#clientReceiveVideo').checked && $('#clientVideo').videoWidth > 0 && clientPeer?.nativePC?.connectionState === 'connected' && $('#clientVideo').srcObject?.getVideoTracks().some(track => track.readyState === 'live' && !track.muted); }
function pointerSurface(desktop = false) {
  const video = guestTiles.surface;
  if(guestTiles.active)return video?.videoWidth>0 && video.srcObject?.getVideoTracks().some(t=>t.readyState==='live' && !t.muted) && (!desktop || clientPeer?.desktopSourceId===guestTiles.featured && clientPeer?.desktopVideoMatches)?video:null;
  if(!desktop && $('#clientReceiveVideo').checked && video?.videoWidth>0 && video.srcObject?.getVideoTracks().some(t=>t.readyState==='live' && !t.muted))return video;
  if (hasClientVideo()) return !desktop || clientPeer?.desktopVideoMatches ? video : null;
  const size=desktop || $('#clientDesktopMouse').checked && clientPeer?.desktopMouse?clientPeer?.desktopSize:clientPeer?.pointerSize || clientPeer?.desktopSize;
  return size ? { videoWidth: size.width, videoHeight: size.height, getBoundingClientRect: () => $('#clientStage').getBoundingClientRect() } : null;
}
function sendDesktopSnapshot() {
  const p = clientPeer;
  if (!desktopReady() || p.desktopEvents?.readyState !== 'open' || p.desktopEvents.bufferedAmount > 8192) return;
  const mouse = $('#clientDesktopMouse').checked && p.desktopMouse && (nativeGuest.active || !!pointerSurface(true)), keyboard = desktopTyping() && p.desktopKeyboard;
  if (!mouse && !keyboard) return;
  const state = { seq: desktopSequence++, keys: keyboard ? [...desktopKeys] : [], buttons: mouse ? [...desktopButtons] : [] };
  if (mouse && desktopPositionDirty && desktopPosition && !document.pointerLockElement) { Object.assign(state, desktopPosition, { moveSeq: desktopMoveSequence++ }); desktopPositionDirty = false; }
  // Key/button transitions and their heartbeat are reliable and ordered.
  // A lost transition cannot be skipped by a newer unreliable movement packet.
  p.desktopEvents.send(JSON.stringify({ type: 'desktop-state', sourceId:p.desktopSourceId || '',desktopToken:p.desktopToken, state }));
}
function sendDesktopEvent(event) {
  if (desktopReady() && clientPeer?.desktopEvents?.readyState === 'open' && clientPeer.desktopEvents.bufferedAmount < 8192) clientPeer.desktopEvents.send(JSON.stringify({ type: 'desktop-event', sourceId:clientPeer.desktopSourceId || '',desktopToken:clientPeer.desktopToken, event }));
}
function pointerReady(){const nativeMouse=nativeGuest.active && $('#clientDesktopMouse').checked && clientPeer?.desktopMouse;return !chatting() && !guestTiles.viewOnly && !guestTiles.switching && (!guestTiles.active || clientPeer?.desktopSourceId===guestTiles.featured) && (nativeMouse || !document.hidden && document.hasFocus()) && !$('#clientPanel').hidden && clientPeer?.pc.connectionState==='connected' && clientPeer?.desktopChannel?.readyState==='open';}
function publishCursor(visible=true,force=false){
  if(!pointerPosition || visible && !pointerReady() || clientPeer?.showCursors!==true || clientPeer?.desktopChannel?.readyState!=='open')return;
  if(!force && visible && performance.now()-cursorSentAt<30)return;
  cursorSentAt=performance.now();const value={type:'cursor',...pointerPosition,visible,pressed:pointerButtons.size>0,sourceId:clientPeer.desktopSourceId || '',desktopToken:clientPeer.desktopToken};
  guestCursors.set('you',{...value,color:clientPeer.cursorColor,label:'You'});
  if(clientPeer.desktopChannel.bufferedAmount<8192)clientPeer.desktopChannel.send(JSON.stringify(value));
}
function releaseGuestPointer(){pointerButtons.clear();publishCursor(false,true);pointerPosition=null;guestCursors.remove('you');}
$('#clientDesktopMouse').onchange = () => {
  if(nativeGuest.active && !$('#clientDesktopMouse').checked)nativeGuest.stop('Mouse sharing stopped. Devices released.');
  releaseDesktopClient(); updateDesktopMouse();
};
$('#clientDesktopTyping').onchange=()=>{if(nativeGuest.active && !$('#clientDesktopTyping').checked)nativeGuest.stop('Typing stopped. Devices released.');releaseDesktopClient();updateDesktopMouse();};

$('#inputSource').addEventListener('change', () => {
  controllerUI(enabled);
  updateDesktopMouse();
});
const desktopVideo = $('#clientStage'); desktopVideo.tabIndex = 0;
gameMouse=relativeMouse(desktopVideo,{allowed:()=>!nativeGuest.active && clientPeer?.desktopRelative===true && $('#clientDesktopMouse').checked && desktopReady() && !guestTiles.viewOnly,send:delta=>{const p=clientPeer;if(p?.desktopChannel?.readyState==='open' && p.desktopChannel.bufferedAmount<8192)p.desktopChannel.send(JSON.stringify({type:'desktop-relative',seq:desktopMoveSequence++,sourceId:p.desktopSourceId || '',desktopToken:p.desktopToken,...delta}));},release:()=>{desktopButtons.clear();desktopKeys.clear();desktopPositionDirty=false;sendDesktopSnapshot();}});
$('#clientDesktopMouse').closest('label').after(gameMouse.button);document.addEventListener('call-settings-refresh',()=>gameMouse.refresh());
function pointerPoint(event){if(!pointerReady() || clientPeer?.showCursors!==true || event.target.closest('button,input,select,textarea,a,.call-toolbar,.call-sheet,.tile-title'))return null;const surface=pointerSurface();return surface?videoPoint(surface,event.clientX,event.clientY):null;}
desktopVideo.addEventListener('pointermove',event=>{const point=pointerPoint(event);if(!point){if(pointerPosition)releaseGuestPointer();return;}pointerPosition=point;publishCursor();},true);
desktopVideo.addEventListener('pointerdown',event=>{if(event.pointerType!=='mouse' || event.button<0 || event.button>4)return;const point=pointerPoint(event);if(!point)return;event.preventDefault();desktopVideo.focus({preventScroll:true});pointerPosition=point;pointerButtons.add(event.button);publishCursor(true,true);},true);
window.addEventListener('pointerup',event=>{if(pointerButtons.delete(event.button))publishCursor(true,true);});
for(const type of ['pointerleave','pointercancel','lostpointercapture'])desktopVideo.addEventListener(type,releaseGuestPointer);
window.addEventListener('blur',releaseGuestPointer);window.addEventListener('pagehide',releaseGuestPointer);document.addEventListener('visibilitychange',()=>{if(document.hidden)releaseGuestPointer();});

desktopVideo.addEventListener('pointermove', event => {
  if(nativeGuest.latched)return;
  if(event.target.closest('.call-toolbar'))return;
  const surface = pointerSurface(); if (!surface) return;
  const point = videoPoint(surface, event.clientX, event.clientY);
  if (!point) { if(desktopButtons.size)releaseDesktopClient(); return; }
  desktopPosition = point; desktopPositionDirty = true;
  if ($('#clientDesktopMouse').checked && pointerSurface(true) && desktopReady() && clientPeer?.desktopChannel?.readyState === 'open' && clientPeer.desktopChannel.bufferedAmount < 8192) {
    clientPeer.desktopChannel.send(JSON.stringify({ type: 'desktop-move', sourceId:clientPeer.desktopSourceId || '',desktopToken:clientPeer.desktopToken, seq: desktopMoveSequence++, ...point }));
  }
});
desktopVideo.addEventListener('pointerdown', event => {
  if(nativeGuest.latched)return;
  if (event.target.closest('button, input, select, textarea, a, .call-toolbar')) return;
  if (!$('#clientDesktopMouse').checked || !desktopReady() || ![0,1,2].includes(event.button)) return;
  if(gameMouse.locked()){event.preventDefault();desktopButtons.add(event.button);sendDesktopSnapshot();return;}
  const surface = pointerSurface(true); if (!surface) return;
  const point = videoPoint(surface, event.clientX, event.clientY); if (!point) return;
  event.preventDefault(); desktopVideo.focus({ preventScroll: true }); desktopVideo.setPointerCapture?.(event.pointerId);
  desktopPosition = point; desktopPositionDirty = true; desktopButtons.add(event.button); sendDesktopSnapshot();
});
desktopVideo.addEventListener('pointerup', event => { if(nativeGuest.latched)return; if (desktopButtons.delete(event.button)) { event.preventDefault(); sendDesktopSnapshot(); } });
desktopVideo.addEventListener('pointercancel', ()=>{if(!nativeGuest.latched)releaseDesktopClient();});
desktopVideo.addEventListener('lostpointercapture', () => { if(nativeGuest.latched)return; if (desktopButtons.size) releaseDesktopClient(); });

desktopVideo.addEventListener('contextmenu', event => { if (!event.target.closest('.call-toolbar') && ($('#clientDesktopMouse').checked || clientPeer?.showCursors && pointerReady())) event.preventDefault(); });
desktopVideo.addEventListener('wheel', event => {
  if(nativeGuest.latched)return;
  if (event.target.closest('button, input, select, textarea, a, .call-toolbar')) return;
  const surface = pointerSurface(true);
  if (!surface || !$('#clientDesktopMouse').checked || !desktopReady() || !videoPoint(surface, event.clientX, event.clientY)) return;
  event.preventDefault(); const units = event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? desktopVideo.clientHeight : 1;
  sendDesktopEvent({ event: 'wheel', dx: Math.max(-1200, Math.min(1200, event.deltaX * units * 1.2)), dy: Math.max(-1200, Math.min(1200, event.deltaY * units * 1.2)) });
}, { passive: false });
window.addEventListener('keydown', event => {
  if(nativeGuest.latched)return;
  if (!desktopTyping() || !clientPeer?.desktopKeyboard || !desktopReady() || document.activeElement!==desktopVideo || /INPUT|TEXTAREA|SELECT|BUTTON/.test(event.target.tagName) || !desktopCodes.has(event.code)) return;
  event.preventDefault(); desktopKeys.add(event.code); sendDesktopSnapshot(); if (event.repeat) sendDesktopEvent({ event: 'repeat', code: event.code });
});
window.addEventListener('keyup', event => { if(!nativeGuest.latched && desktopKeys.delete(event.code)) { event.preventDefault(); sendDesktopSnapshot(); } });
setInterval(sendDesktopSnapshot, 1000 / 30);
let qualityRequestTimer;
async function sendClientQuality(p=clientPeer){
    if(p?.control?.readyState!=='open')return;
    const requested=clientQuality({resolution:$('#clientResolution').value,minHeight:Number($('#clientMinimumResolution').value),frameRate:$('#clientFramerate').value,automatic:$('#clientAutoThrottle').checked,codec:$('#clientCodec').value});
    const limit=p.hostLimit || {},height=Math.min(limit.height || 1080,requested.resolution==='host'?Infinity:Number(requested.resolution));
    const support=await codecSupport({height,width:Math.min(limit.width || 1920,Math.round(height*16/9)),frameRate:Math.min(limit.frameRate || 60,requested.frameRate || 120),maxBitrate:limit.maxBitrate});
    if(clientPeer!==p || p.control?.readyState!=='open')return;
    $('#clientCodec option[value="h265"]').disabled=!support.hevcAvailable;$('#clientCodecNote').textContent=support.reason+' Applies to native video.';
    if(!support.hevcAvailable && requested.codec==='h265'){$('#clientCodec').value='auto';requested.codec='auto';}
    p.control.send(JSON.stringify({type:'quality-request',quality:{...requested,codecs:support.codecs}}));
}
function requestClientQuality() {
  boundMinimumResolution($('#clientMinimumResolution'),Math.min(clientPeer?.hostLimit?.height || 2160,Number($('#clientResolution').value) || Infinity));
  clearTimeout(qualityRequestTimer);
  qualityRequestTimer=setTimeout(()=>sendClientQuality().catch(()=>{}),250);
}
for (const id of ['clientResolution', 'clientMinimumResolution', 'clientFramerate', 'clientAutoThrottle','clientCodec']) $(`#${id}`).onchange = requestClientQuality;
let inputVideoCallback = null, pipInputWorker = null, pipWorkerFailed = false;
function stopInputVideoClock() {
  if (inputVideoCallback !== null) $('#clientVideo').cancelVideoFrameCallback?.(inputVideoCallback);
  inputVideoCallback = null;
  pipInputWorker?.terminate(); pipInputWorker = null; pipWorkerFailed = false;
}
function startInputVideoClock() {
  const video = $('#clientVideo');
  if(!enabled)return;
  if (!pipInputWorker && !pipWorkerFailed && typeof Worker !== 'undefined') {
    try {
      const worker = new Worker(new URL('./input-clock.js', import.meta.url), { type: 'module' }); pipInputWorker = worker;
      worker.onmessage = () => { if(pipInputWorker!==worker)return;try{sendInputs();}finally{worker.postMessage('ack');} };
      worker.onerror = () => { worker.terminate(); if (pipInputWorker === worker) { pipInputWorker = null; pipWorkerFailed = true; } };
    } catch { pipWorkerFailed = true; }
  }
  if (!video.requestVideoFrameCallback || inputVideoCallback !== null) return;
  // PiP rendering is an extra clock; controller-only sessions use the worker.
  if (document.pictureInPictureElement !== video) return;
  inputVideoCallback = video.requestVideoFrameCallback(() => { inputVideoCallback = null; sendInputs(); startInputVideoClock(); });
}
let fallbackWs = null, fallbackSession = null, fallbackReady = false, fallbackReconnectTimer, fallbackRetry = 1000;
function requestFallbackRestart() { if (fallbackReady && fallbackWs?.readyState === WebSocket.OPEN) send(fallbackWs, { type: 'restart' }); }
function connectFallback(session) {
  if (!session?.fallback || fallbackWs) return;
  const connection = session.fallback;
  const ws = new WebSocket(connection.url); fallbackWs = ws; fallbackSession = session;
  ws.onopen = () => send(ws, { type: 'auth', roomId: connection.roomId, peerId: connection.peerId, token: connection.token });
  let queue = Promise.resolve();
  ws.onmessage = ev => { queue = queue.then(async () => {
    if (fallbackWs !== ws) return;
    const msg = parse(ev.data); if (!msg) return;
    if (msg.type === 'ready') {
      fallbackReady = true; fallbackRetry = 1000; $('#clientFallbackStatus').hidden=false;$('#clientFallbackStatus').textContent = 'Connected · automatic recovery available';
      if (clientPeer && ['failed', 'disconnected', 'closed'].includes(clientPeer.pc.connectionState)) requestFallbackRestart();
    }
    if (msg.type === 'offer') {
      if (!msg.sdp || typeof msg.sdp.sdp !== 'string' || msg.sdp.sdp.length > 98304) return;
      assignedSlot = isPlayerSlot(msg.slot) ? msg.slot : null;
      $('#clientSlot').textContent = assignedSlot?.toUpperCase() || 'Watching';
      playerConnectionUI('connecting'); clientStatus('Reconnecting through the backup connection…');
      const reply = await negotiateClient({ ...session, sdp: msg.sdp, ice: sanitizeIceConfig(msg.ice), slot: assignedSlot });
      send(ws, { type: 'answer', id: msg.id, sdp: reply.sdp });
    }
  }).catch(error => clientStatus(`Automatic reconnection failed: ${error.message}`)); };
  ws.onclose = ev => {
    if (fallbackWs !== ws) return;
    fallbackWs = null; fallbackReady = false;
    $('#clientFallbackStatus').textContent = ev.code === 1008 ? 'Session ended · a fresh invitation is needed' : 'Offline · trying again';
    if (ev.code !== 1008 && fallbackSession === session) {
      fallbackReconnectTimer = setTimeout(() => connectFallback(session), fallbackRetry);
      fallbackRetry = Math.min(fallbackRetry * 2, 10000);
    }
  };
}
let selectedIndex = null, savedProfile = null;
const extraPadIndices=[], controllerReceipts=[], sessionProfiles=new Map(), extraPadCleared=new Set();
let assignedSlots=[], controllerGeneration=0, hostControllerCapacity=null, controllerPendingRemoval=false;
const joinedControllers=[], buttonSnapshots=new Map(),preparedControllers=new Map();
const controllerErrorNotice=document.createElement('p');controllerErrorNotice.id='clientControllerError';controllerErrorNotice.className='input-caution';controllerErrorNotice.setAttribute('role','status');controllerErrorNotice.hidden=true;$('#connectedControllers').before(controllerErrorNotice);
function dynamicMode(){return clientPeer?.dynamicControllers===true;}
function canUseClientInputs(){return !!assignedSlot || dynamicMode() && clientPeer?.wantsController===true;}
function hasKeyboardController(){return dynamicMode()?joinedControllers.some(d=>d.source==='keyboard'):$('#inputSource').value==='keyboard';}
function desktopTyping(){return $('#clientDesktopTyping').checked || !dynamicMode() && enabled && $('#inputSource').value==='desktop';}
const keys = new Set();
function releaseClient() {
  inputStreams?.releaseBrowser();
  keys.clear();
  releaseDesktopClient();
  if (clientPeer?.channel?.readyState === 'open') for(let controller=0;controller<assignedSlots.length;controller++) clientPeer.channel.send(inputPayload({seq:sequence++,controller,generation:controllerGeneration,source:controller===0 && $('#inputSource').value==='keyboard'?'keyboard':'gamepad',state:neutralState()},clientPeer.inputFormat));
  if (clientPeer?.control?.readyState === 'open') clientPeer.control.send(JSON.stringify({ type: 'release', seq:sequence++ }));
}
function closeClientPeer({preserveVoice=false,keepTransport=false,preserveNative=false,preserveCameraPreview=false}={}) {
  if(!preserveVoice){if(!preserveCameraPreview || clientVoice.ready)clientVoice.setReady(false);if(!preserveCameraPreview)clientCamera.setReady(false);clientScreens.setReady(false);clientChat.setReady(false);}
  if(!preserveNative)nativeGuest.endSession();
  guestTiles.clear();clientViews.clear();guestViewPopouts.clear();clearTimeout(videoRefreshTimer);videoRefreshUntil=0;
  stopInputVideoClock();
  releaseClient(); clearInterval(sendTimer); clearInterval(statsTimer);
  const previous = clientPeer;previous?.cancelVideoHandover?.();previous?.grace?.stop();document.dispatchEvent(new CustomEvent('call-recovery',{detail:'closed'})); clientPeer = null; previous?.nativePC?.close();previous?.retiredPC?.close();previous?.hybridAudioPC?.close(); previous?.playback?.close();if(!keepTransport)previous?.pc.close(); $('#clientVideo').srcObject = null;
  updateVideoRefresh();
  inputLatencyUI();
  delete $('#clientVideo').dataset.sharedAudio;delete $('#clientVideo').dataset.audioOnly;$('#clientVideoSettings').hidden=false;$('#clientVideoToggle').closest('label').hidden=false;$('#clientAudioOnlyNote').hidden=true;
  soundUI($('#clientVideo').muted);
  playerVideoUI(false);
  guestCursors.clear();
  updateDesktopMouse();
  $('#clientEnablePad').disabled = true; controllerUI(false);
}
function suspendClientControls() {
  nativeGuest.endSession();
  releaseClient(); stopInputVideoClock();
  $('#clientEnablePad').disabled = true; controllerUI(false);
  $('#clientDesktopMouse').checked = false;$('#clientDesktopTyping').checked=false; updateDesktopMouse(); guestCursors.clear();
  updateVideoRefresh();
}
function storageKey(gp) { return `webrtc-pad:layout:${navigator.userAgent}:${gp.id}`; }
function profileFor(gp) {
  if(!gp) return null;
  if(sessionProfiles.has(gp.id))return sessionProfiles.get(gp.id);
  let profile=null; try { profile=JSON.parse(localStorage.getItem(storageKey(gp))); } catch { /* No saved layout. */ }
  sessionProfiles.set(gp.id,profile); return profile;
}
function controllerCount() { return dynamicMode()?joinedControllers.length:Number($('#clientControllerCount').value) || 1; }
const rumbleLabel=document.createElement('label');rumbleLabel.className='check-row';rumbleLabel.innerHTML='<input id="clientRumble" type="checkbox" checked /> Controller vibration · when supported';$('#controllerAdvanced').append(rumbleLabel);
const orderButton=document.createElement('button');orderButton.type='button';orderButton.className='button small-button';orderButton.textContent='Remember this controller order';$('#controllerAdvanced').append(orderButton);let preferredControllerOrder=readPreference('controllerOrder',[]);if(!Array.isArray(preferredControllerOrder))preferredControllerOrder=[];
const orderIdentity=pad=>`${String(pad.id).replace(/^pad:\d+ · /,'')}#${pad.index}`;
orderButton.onclick=()=>{const choices=joinedControllers.length?joinedControllers:[...preparedControllers.values()];preferredControllerOrder=choices.filter(p=>p.source==='gamepad').map(orderIdentity);writePreference('controllerOrder',preferredControllerOrder);toast(preferredControllerOrder.length?'Selected controller order saved for future joins.':'Select controllers in the order you want, then save their order.');};
function receiveRumble(message){const value=cleanRumble(message);if(!value || !enabled || !$('#clientRumble').checked || value.generation!==controllerGeneration || !assignedSlots[value.controller])return;const choice=dynamicMode()?joinedControllers[value.controller]:{source:value.controller===0?$('#inputSource').value:'gamepad',index:value.controller===0?selectedIndex:extraPadIndices[value.controller-1]};if(choice?.source!=='gamepad')return;const pad=inputGamepads()[choice.index];if(!pad || choice.id && choice.id!==pad.id)return;if(nativeGuest.active && pad.id.startsWith('pad:'))nativeGuest.post({type:'rumble',device:pad.id.split(' · ')[0],large:value.large,small:value.small});else playRumble(pad,value);}
let liveControllerRows=[];
function renderConnectedControllers(view=nativeGuest) {
  const root=$('#connectedControllers'),sharing=$('#clientJoinControllers')?.checked!==false,native=$('#controllerSetup').dataset.inputMode==='native';
  root.dataset.sharing=String(sharing);const discovery=$('#controllerSetup .controller-discovery');if(discovery)discovery.hidden=!sharing;
  const connected=clientPeer?.pc.connectionState==='connected' && clientPeer?.channel?.readyState==='open';
  controllerErrorNotice.hidden=!clientPeer?.controllerError;const errorText=clientPeer?.controllerError?`Host controller setup: ${clientPeer.controllerError}`:'';if(controllerErrorNotice.textContent!==errorText)controllerErrorNotice.textContent=errorText;
  const pads=[...(view.latched && !view.browserFallback?view.pads:navigator.getGamepads?.() || [])].filter(p=>p && p.connected!==false);
  const entries=native?view.devices.filter(d=>d.kind==='gamepad').map(d=>({id:d.id,name:d.label,device:d,pad:pads.find(p=>p.id.split(' · ')[0]===d.id)})):pads.map(p=>({id:p.id+':'+p.index,name:p.id,pad:p}));
  const rows=entries.map(entry=>{
    const {pad,device}=entry;
    const lane=dynamicMode()?joinedControllers.findIndex(d=>d.source==='gamepad' && (pad?d.id===pad.id && d.index===pad.index:d.id.split(' · ')[0]===entry.id)):pad?[$('#inputSource').value==='gamepad'?selectedIndex:null,...extraPadIndices].indexOf(pad.index):-1;
    const slot=connected && lane>=0?assignedSlots[lane]:null;
    const prepared=preparedControllers.has(entry.id);
    const status=!sharing && !slot?'Sharing off':!connected && prepared?'Ready to join':slot?`${enabled?'In use':'Paused'} · ${slot.toUpperCase()}`:connected && dynamicMode() && lane>=0?clientPeer.controllerError?'Host controller setup needed':'Joining…':device && !device.available?'Setup needed':native && !view.active?view.paused?'Needs attention':'Preparing…':pad && pad.mapping!=='standard' && !profileFor(pad)?'Needs mapping':connected && clientPeer?.wantsController && dynamicMode()?'Press a button or select to join':'Connected';
    return {...entry,lane,status,used:!!slot,prepared};
  });
  if(!connected && preparedControllers.has('keyboard'))rows.push({id:'keyboard',name:'Keyboard & mouse controller',lane:-1,used:false,prepared:true,status:'Ready to join'});
  if(dynamicMode())for(let lane=0;lane<joinedControllers.length;lane++)if(joinedControllers[lane].source==='keyboard')rows.push({id:'keyboard',name:'Keyboard & mouse controller',lane,used:!!assignedSlots[lane],status:assignedSlots[lane]?`${enabled?'In use':'Paused'} · ${assignedSlots[lane].toUpperCase()}`:'Joining…'});
  if(!dynamicMode() && $('#inputSource').value==='keyboard' && assignedSlots[0])rows.push({id:'keyboard',name:'Keyboard & mouse controller',lane:0,used:true,status:`${enabled?'In use':'Paused'} · ${assignedSlots[0].toUpperCase()}`});
  if(discovery)discovery.hidden=!sharing || !rows.length || rows.every(row=>row.used || row.prepared);
  if(clientPeer?.control?.readyState==='open'){
    const controllers=dynamicMode()?joinedControllers.map((d,index)=>{const row=rows.find(r=>r.lane===index);return {index,name:row?.name || (d.source==='keyboard'?'Keyboard controller':'Controller'),connected:d.source==='keyboard' || !!row?.pad,keyboard:d.source==='keyboard'};}):rows.filter(r=>r.lane>=0).map(r=>({index:r.lane,name:r.name,connected:r.id==='keyboard' || !!r.pad,keyboard:r.id==='keyboard'}));
    const presence=JSON.stringify({type:'controller-status',...controllerPresence({detected:entries.length,enabled,setupRequired:view.blocksBrowser && view.needsControllerSetup,controllers})});
    if(clientPeer.lastControllerPresence!==presence && clientPeer.control.bufferedAmount<32768){clientPeer.control.send(presence);clientPeer.lastControllerPresence=presence;}
  }
  liveControllerRows=rows;
  const mappingEntry=$('#keyboardMapping > button');if(mappingEntry)mappingEntry.hidden=rows.some(r=>r.pad || r.id==='keyboard');
  const detectedCount=$('#controllerDetectedCount');if(detectedCount){const text=entries.length?`${entries.length} detected`:'';if(detectedCount.textContent!==text)detectedCount.textContent=text;}
  const empty=!sharing?'Turn on Share controllers to use a controller on the host.':native && view.paused?'Controller setup needs attention.':native && view.listPending?'Checking controllers…':'Connect a controller, then press a button.';
  const signature=JSON.stringify([rows.map(r=>[r.id,r.name,r.lane,r.status,r.used,!!r.pad,r.prepared]),connected,controllerPendingRemoval,empty]);
  if(root.dataset.signature===signature)return;const focused=root.contains(document.activeElement)?{id:document.activeElement.closest('[data-controller-id]')?.dataset.controllerId,label:document.activeElement.getAttribute('aria-label')}:null;
  const restoreFocus=()=>{if(!focused)return;const item=[...root.querySelectorAll('[data-controller-id]')].find(el=>el.dataset.controllerId===focused.id),target=item && [...item.querySelectorAll('button,input,summary')].find(el=>el.getAttribute('aria-label')===focused.label && !el.disabled);if(target)target.focus({preventScroll:true});else{root.tabIndex=-1;root.focus({preventScroll:true});}};
  const openTests=new Set([...root.querySelectorAll('.connected-controller')].filter(item=>item.querySelector('.pad-live-test')?.open).map(item=>item.dataset.controllerId));root.dataset.signature=signature;root.replaceChildren();
  if(!rows.length){const note=document.createElement('p');note.className='small muted';note.textContent=empty;root.append(note);restoreFocus();return;}
  for(const row of rows){
    const item=document.createElement('div');item.className='connected-controller';item.setAttribute('role','listitem');item.dataset.controllerId=row.id;if(row.lane>=0)item.dataset.player=String(row.lane%6+1);
    const glyph=document.createElementNS('http://www.w3.org/2000/svg','svg');glyph.classList.add('icon','controller-device-icon');glyph.setAttribute('aria-hidden','true');glyph.innerHTML=`<use href="#i-${row.id==='keyboard'?'keyboard':'pad'}"/>`;item.append(glyph);
    const text=document.createElement('button'),name=document.createElement('strong'),status=document.createElement('span');text.type='button';text.className='controller-select';text.setAttribute('aria-label',`Select ${row.name}`);text.setAttribute('aria-pressed',String(row.used || row.prepared || row.lane>=0));text.disabled=!(row.pad || row.device?.available || row.id==='keyboard') || connected && (!dynamicMode() || !clientPeer.wantsController || row.lane>=0 || controllerPendingRemoval || nativeGuest.blocksBrowser || nativeGuest.switching || nativeGuest.active && nativeGuest.awaitingState);text.onclick=()=>{
      if(!connected){if(row.prepared)preparedControllers.delete(row.id);else{setControllerSharing(true);preparedControllers.set(row.id,row.id==='keyboard'?{source:'keyboard',id:'Keyboard controller',index:null}:{source:'gamepad',id:row.pad?.id,index:row.pad?.index,deviceId:row.device?.id});}refreshGamepads();}
      else if(!row.used && row.pad)joinGamepad(row.pad,true);
    };name.textContent=friendlyControllerName(row.name);if(name.textContent!==row.name)name.title=row.name;status.className='controller-use-status';status.textContent=row.status;item.dataset.inUse=String(row.used && enabled);text.append(name,status);item.append(text);
    if(row.pad || row.id==='keyboard'){const map=document.createElement('button');map.className='button small-button controller-map';map.innerHTML='<svg class="icon" aria-hidden="true"><use href="#i-settings"/></svg><span>Map</span>';map.title=`Map ${row.name}`;map.setAttribute('aria-label',map.title);map.onclick=()=>keyboardMapping.open(row.id==='keyboard'?'keyboard':row.pad.index);item.append(map);}
    if(row.lane>=0 && clientPeer?.control?.readyState==='open'){const remove=document.createElement('button');remove.className='button small-button controller-remove';remove.textContent='×';remove.setAttribute('aria-label',`Stop using ${row.name}`);remove.title='Remove from this session';remove.disabled=controllerPendingRemoval;remove.onclick=()=>removeMyController(row.lane);item.append(remove);}
    if(row.pad){addControllerTest(item);item.querySelector('.pad-live-test').open=openTests.has(row.id);}root.append(item);
  }  restoreFocus();
}
function groupUI() {
  $('#clientEnablePad').dataset.count=String(assignedSlots.length || controllerCount());$('#clientEnablePad').dataset.dynamic=clientPeer?String(dynamicMode()):'pending';
  $('#clientEnablePad').dataset.canPlay=clientPeer?String(clientPeer.wantsController):'pending';
  $('#clientEnablePad').dataset.ready=String(clientPeer?.controllersRequested===true && clientPeer?.channel?.readyState==='open');
  $('#clientEnablePad').dataset.joined=String(assignedSlots.length);
  $('#clientEnablePad').dataset.pending=String(Math.max(0,joinedControllers.length-assignedSlots.length));$('#clientEnablePad').dataset.error=String(!!clientPeer?.controllerError);
  $('#clientSlot').textContent=assignedSlot ? (assignedSlots.length?assignedSlots:[assignedSlot]).map(s=>s.toUpperCase()).join(' · ') : clientPeer?clientPeer.wantsController?'Waiting for a free spot':'Watching':'Not assigned yet';
  const count=controllerCount();
  $('label[for="inputSource"]').textContent=`Controller 1${assignedSlots[0]?' · '+assignedSlots[0].toUpperCase():''} · play with`;
  $('#controllerGroupStatus').textContent= !clientPeer ? 'Open the host’s invite and send your reply to connect.' : !assignedSlot ? clientPeer.wantsController?'No free player spots yet. Ask the host to remove an old connection, then check for free spots.':'Watching only. Ask the host to assign a player spot to this computer.' : assignedSlots.length<count ? `${assignedSlots.length} of ${count} spots available. Ask the host to free spots or start with more remote controllers, then choose the count again.` : `${assignedSlots.length || 1} player spot${assignedSlots.length>1?'s':''} assigned. Test each controller, then enable controls.`;
  $('#retryControllerSpots').hidden=!clientPeer || !assignedSlot && !clientPeer.wantsController || assignedSlots.length>=count;
  controllerUI(enabled);
  $('#primaryControllerHeading').hidden=!dynamicMode() || !joinedControllers.length;$('#primaryControllerHeading').textContent=`Controller 1 · ${assignedSlots[0]?.toUpperCase() || 'waiting for a free spot'}`;
  $('#clientManualCount').hidden=!clientPeer || dynamicMode();
  $('#pressJoinStatus').hidden=!!clientPeer && !dynamicMode();
  $('#pressJoinStatus').textContent=!clientPeer?preparedControllers.size?`${preparedControllers.size} controller${preparedControllers.size===1?'':'s'} ready to join. Connect to the host to join automatically.`:'Press a button on each controller you want to use, or select it here.':!clientPeer.wantsController?'Watching only. Ask the host for a Play invite to join with a controller.':!enabled?'Controller sharing paused. Resume to join or play.':`${[...(inputGamepads() || [])].filter(Boolean).length} gamepads detected · ${joinedControllers.length} selected.`;
  if(dynamicMode()) {
    $('#clientSlot').textContent=assignedSlots.length?assignedSlots.map(s=>s.toUpperCase()).join(' · '):!clientPeer.wantsController?'Watching':clientPeer.controllerError?'Host controller setup needed':joinedControllers.length?'Joining…':'Press a button or select a controller';
    $('#controllerGroupStatus').textContent=!clientPeer.wantsController?'Watching only. Ask the host for a Play invite to join with a controller.':joinedControllers.length>assignedSlots.length?clientPeer.controllerError || `${assignedSlots.length} of ${joinedControllers.length} joined. ${clientPeer.adaptiveControllers?'Adding controllers…':'No free spot for the remaining controller yet; retry or remove it.'}${clientPeer.controllerType==='x360'?' Host Xbox output has only four XInput slots; HID output supports larger groups.':''}`:assignedSlots.length?'Press buttons to test. Use × beside a controller to remove it.':'Press a button on your controller, or choose Use keyboard & mouse as a controller.';
    $('#joinKeyboardController').hidden=!clientPeer.wantsController || clientPeer.allowKeyboard===false || joinedControllers.some(d=>d.source==='keyboard');
    $('#joinKeyboardController').disabled=!enabled || clientPeer.control?.readyState!=='open';
    $('#leavePrimaryController').hidden=!joinedControllers.length;$('#leavePrimaryController').disabled=controllerPendingRemoval || assignedSlots.length<joinedControllers.length && !!assignedSlots.length;
    $('#keyboardHelp').hidden=!hasKeyboardController();
    $('#inputSource').hidden=joinedControllers.length>0; $('label[for="inputSource"]').hidden=joinedControllers.length>0;
    $('#clientPadIndex').hidden=true;$('label[for="clientPadIndex"]').hidden=true;
  } else {$('#joinKeyboardController').hidden=!!clientPeer || preparedControllers.has('keyboard');$('#joinKeyboardController').disabled=!!clientPeer;$('#leavePrimaryController').hidden=!assignedSlots.length;}
  $('#keyboardPolicyNote').hidden=$('#inputSource').value!=='keyboard' && !hasKeyboardController();
  if(clientPeer && typeof clientPeer.wantsController!=='boolean') {
    $('#clientSlot').textContent='Waiting for host';
    $('#controllerGroupStatus').textContent='Send your reply to the host to finish connecting.';
    $('#pressJoinStatus').textContent='After connecting, press a button on each controller you want to use.';
  }
  nativeGuest.paint();
}
function requestClientControllers() {
  if(clientPeer?.control?.readyState==='open') clientPeer.control.send(JSON.stringify({type:'controller-count',count:controllerCount()}));
}
function refreshGamepads() {
  const pads = [...(inputGamepads() || [])].filter(gp=>gp && gp.connected!==false), select=$('#clientPadIndex');
  if(dynamicMode()){selectedIndex=joinedControllers[0]?.index ?? null;extraPadIndices.splice(0,extraPadIndices.length,...joinedControllers.slice(1).map(d=>d.index));$('#inputSource').value=joinedControllers[0]?.source || 'gamepad';}
  inputSourceUI();
  const used=new Set(extraPadIndices.slice(0,controllerCount()-1).filter(n=>n!==null && n!==undefined));
  if(selectedIndex===null && !dynamicMode()) selectedIndex=pads.find(gp=>!used.has(gp.index))?.index ?? null;
  select.replaceChildren(...pads.map(gp=>new Option(`Gamepad ${gp.index+1} · ${gp.id}`,String(gp.index))));
  if(selectedIndex!==null && !pads.some(gp=>gp.index===selectedIndex)) select.add(new Option('Disconnected · reconnect this controller',String(selectedIndex)));
  if(!select.options.length) select.add(new Option('Press a controller button to detect it',''));
  if(selectedIndex!==null) select.value=String(selectedIndex);
  select.disabled=!pads.length;
  const gp=pads.find(p=>p.index===selectedIndex); savedProfile=profileFor(gp);
  $('#padStatus').textContent=gp ? `${dynamicMode()?gp.id+' · ':''}${gp.mapping==='standard'?'Recognized layout':savedProfile?'Saved layout':'Custom layout needed · open controller mapping'}` : pads.length ? `${pads.length} controller${pads.length===1?'':'s'} detected. Press a button to join, or open mapping to configure a device.` : nativeGuest.latched ? 'No native gamepad is being read. Select a device above to use it on the host.' : 'Click this app, then press a controller button. Your browser may hide connected controllers until you use one.';
  const occupied=new Set($('#inputSource').value==='gamepad' && selectedIndex!==null ? [selectedIndex] : []);
  const container=$('#extraControllers'); container.replaceChildren();
  for(let lane=1;lane<controllerCount();lane++) {
    if(!dynamicMode() && (extraPadIndices[lane-1]===undefined || extraPadIndices[lane-1]===null && !extraPadCleared.has(lane))) extraPadIndices[lane-1]=pads.find(gp=>!occupied.has(gp.index) && !extraPadIndices.includes(gp.index))?.index ?? null;
    const index=extraPadIndices[lane-1]; if(index!==null)occupied.add(index);
    const row=document.createElement('div'); row.className='controller-device';
    const label=document.createElement('label'); label.className='field-label'; label.htmlFor=`extraPad${lane}`; label.textContent=`Controller ${lane+1} · ${assignedSlots[lane]?.toUpperCase() || 'waiting for a host spot'}`;
    const choice=document.createElement('select'); choice.id=`extraPad${lane}`; choice.dataset.controller=String(lane); choice.setAttribute('aria-label',`Controller ${lane+1} gamepad`); choice.add(new Option('Choose a controller',''));
    for(const gp of pads)choice.add(new Option(`Gamepad ${gp.index+1} · ${gp.id}`,String(gp.index)));
    if(index!==null && !pads.some(gp=>gp.index===index))choice.add(new Option('Disconnected · reconnect this controller',String(index)));
    choice.value=index===null?'':String(index); choice.onchange=()=>{releaseClient();extraPadIndices[lane-1]=choice.value===''?null:Number(choice.value);if(choice.value==='')extraPadCleared.add(lane);else extraPadCleared.delete(lane);refreshGamepads();};
    const test=document.createElement('p');test.id=`controllerTest${lane}`;test.className='controller-test'; test.setAttribute('role','status');
    if(dynamicMode()){const name=document.createElement('p');name.className='small muted';name.textContent=joinedControllers[lane].source==='keyboard'?'Keyboard controller':joinedControllers[lane].id;row.append(label,name,test);}else row.append(label,choice,test);
    const remove=document.createElement('button');remove.className='button small-button';remove.textContent='Remove my controller';remove.disabled=controllerPendingRemoval || dynamicMode() && assignedSlots.length<joinedControllers.length && lane<assignedSlots.length;remove.onclick=()=>removeMyController(lane);row.append(remove);container.append(row);
  }
  groupUI(); updateControllerTests();
}
function updateControllerTests(pads=inputGamepads()) {
  if(nativeGuest.blocksBrowser || nativeGuest.switching || nativeGuest.active && nativeGuest.awaitingState){
    const el=$('#primaryControllerTest'),text=nativeGuest.paused?'Controller setup needs attention.':'Waiting for controller input…';
    if(el.textContent!==text)el.textContent=text;return;
  }
  if(dynamicMode() && !joinedControllers.length){const el=$('#primaryControllerTest'),text='Press a button on your controller to join.';if(el.textContent!==text)el.textContent=text;return;}
  const used=new Set();
  for(let lane=0;lane<controllerCount();lane++) {
    const el=lane===0?$('#primaryControllerTest'):$(`#controllerTest${lane}`);if(!el)continue;
    const source=dynamicMode()?joinedControllers[lane]?.source:lane===0?$('#inputSource').value:'gamepad',index=lane===0?selectedIndex:extraPadIndices[lane-1],gp=pads[index];
    let text=source==='keyboard' ? `Keyboard controller · ${keys.size?'keys pressed':'click the picture, then press your assigned keys'}` : source==='desktop'?'Click the picture, then type to control the host desktop.' : !gp || gp.connected===false?(index==null?'Connect a controller, then press a button.':'Disconnected · reconnect this controller and press a button.') : used.has(index)?'Already used by another player · choose a different gamepad.' : gp.mapping!=='standard' && !profileFor(gp)?'Open controller mapping and save this device’s layout before playing.' : `Detected · ${gp.buttons.some(b=>b.pressed)||gp.axes.some(a=>Math.abs(a)>.2)?'Input active':'press a button or move a stick'}`;
    if(source==='gamepad' && index!==null)used.add(index);
    if(enabled && assignedSlots[lane])text+= Date.now()-(controllerReceipts[lane] || 0)<2200?' · Delivered to host': ' · Waiting for host receipt';
    if(el.textContent!==text)el.textContent=text;
  }
}
function rememberControllerButtons() {
  buttonSnapshots.clear();
  for(const gp of inputGamepads() || [])if(gp)buttonSnapshots.set(`${gp.index}:${gp.id}`,gp.buttons.map(b=>b.pressed || b.value>.5));
}
function joinGamepad(gp,resume=false) {
  if(resume && !$('#clientJoinControllers').checked)setControllerSharing(true);
  if(!gp || gp.connected===false || !dynamicMode() || !clientPeer.wantsController || clientPeer.control?.readyState!=='open' || nativeGuest.blocksBrowser || nativeGuest.switching || nativeGuest.active && nativeGuest.awaitingState)return;
  if(resume){enabled=true;controllerUI(true);startInputVideoClock();}
  if(!enabled)return;
  const lane=joinedControllers.findIndex(d=>d.source==='gamepad' && d.id===gp.id && d.index===gp.index);
  if(lane<0)joinedControllers.push({index:gp.index,id:gp.id,source:'gamepad'});
  if(lane<0 || lane>=assignedSlots.length){requestClientControllers();refreshGamepads();}
}
function applyPreparedControllers() {
  const p=clientPeer;
  if(!p?.controllersRequested || !p.dynamicControllers || !p.wantsController || !enabled || nativeGuest.blocksBrowser || nativeGuest.switching || nativeGuest.active && nativeGuest.awaitingState)return;
  const pads=[...(inputGamepads() || [])].filter(gp=>gp && gp.connected!==false);
  p.preparedApplied ||= new Set();let changed=false;
  for(const [key,choice] of [...preparedControllers].sort(([,a],[,b])=>{const rank=p=>{const i=preferredControllerOrder.indexOf(orderIdentity(p));return i<0?999:i;};return rank(a)-rank(b);})){ 
    if(p.preparedApplied.has(key))continue;
    const pad=choice.source==='gamepad'?pads.find(gp=>choice.deviceId?gp.id.split(' · ')[0]===choice.deviceId:gp.id===choice.id && gp.index===choice.index):null;
    if(choice.source==='keyboard'?p.allowKeyboard!==true:!pad)continue;
    const entry=pad?{source:'gamepad',id:pad.id,index:pad.index}:{...choice};
    p.preparedApplied.add(key);
    if(!joinedControllers.some(d=>d.source===entry.source && d.id===entry.id && d.index===entry.index)){joinedControllers.push(entry);changed=true;}
  }
  if(changed){requestClientControllers();refreshGamepads();}
}
function scanJoiningControllers() {
  if($('#clientPanel').hidden || keyboardMapping.dialog.open || nativeGuest.blocksBrowser || nativeGuest.switching || nativeGuest.active && nativeGuest.awaitingState)return;
  const preparing=!clientPeer?.controllersRequested;
  if(!$('#clientJoinControllers').checked)return;
  if(!preparing && !dynamicMode())return;
  if(!preparing)applyPreparedControllers();
  const pads=[...(inputGamepads() || [])].filter(gp=>gp && gp.connected!==false);
  const focused=nativeGuest.active || !document.hidden && document.hasFocus() || $('#backgroundGamepad').checked || document.pictureInPictureElement===$('#clientVideo');
  for(const gp of pads) {
    const key=`${gp.index}:${gp.id}`,snapshot=buttonSnapshots.get(key) || [];let pressed=false;
    for(let i=0;i<gp.buttons.length;i++){const down=gp.buttons[i].pressed || gp.buttons[i].value>.5;if(down && !snapshot[i])pressed=true;snapshot[i]=down;}
    buttonSnapshots.set(key,snapshot);
    if(preparing){
      if(pressed && focused){const deviceId=nativeGuest.latched && !nativeGuest.browserFallback?gp.id.split(' · ')[0]:undefined,key=deviceId || `${gp.id}:${gp.index}`;if(!preparedControllers.has(key)){preparedControllers.set(key,{source:'gamepad',id:gp.id,index:gp.index,deviceId});$('#clientJoinControllers').checked=true;refreshGamepads();}}
      continue;
    }
    if(!enabled || !focused || !clientPeer.wantsController || !pressed || clientPeer.control?.readyState!=='open')continue;
    joinGamepad(gp);
  }
  if(!preparing && !controllerPendingRemoval){const missing=joinedControllers.findIndex(d=>d.source==='gamepad' && !pads.some(gp=>gp.index===d.index && gp.id===d.id));if(missing>=0)removeMyController(missing);}
}
function removeMyController(lane) {
  if(nativeGuest.active)nativeGuest.endSession();
  if(clientPeer?.control?.readyState!=='open')return;
  releaseClient();
  if(dynamicMode() && lane>=assignedSlots.length){joinedControllers.splice(lane,1);refreshGamepads();requestClientControllers();return;}
  if(controllerPendingRemoval)return;
  controllerPendingRemoval=true;
  clientPeer.control.send(JSON.stringify({type:'controller-remove',controller:lane,generation:controllerGeneration}));refreshGamepads();
}
$('#leavePrimaryController').onclick=()=>removeMyController(0);
$('#joinKeyboardController').onclick=()=>{if(!$('#clientJoinControllers').checked)setControllerSharing(true);if(!clientPeer){preparedControllers.set('keyboard',{source:'keyboard',id:'Keyboard controller',index:null});refreshGamepads();return;}if(nativeGuest.blocksBrowser){nativeGuest.prepare();$('#nativeGuestOtherDevices').open=true;return;}if(!enabled || !dynamicMode() || clientPeer.allowKeyboard===false || joinedControllers.some(d=>d.source==='keyboard'))return;joinedControllers.push({index:null,id:'Keyboard controller',source:'keyboard'});refreshGamepads();requestClientControllers();};
$('#clientControllerCount').replaceChildren(...Array.from({length:64},(_,i)=>new Option(`${i+1} controller${i?'s':''}${i===2?' · three people at this TV':''}`,String(i+1))));
$('#clientControllerCount').value='1';
$('#retryControllerSpots').onclick=()=>{releaseClient();requestClientControllers();};
$('#clientControllerCount').onchange=()=>{releaseClient();controllerReceipts.length=0;refreshGamepads();requestClientControllers();};
window.addEventListener('gamepadconnected', refreshGamepads);
window.addEventListener('gamepaddisconnected', () => { releaseClient(); refreshGamepads(); });
$('#clientPadIndex').onchange = () => { releaseClient(); selectedIndex = Number($('#clientPadIndex').value);refreshGamepads(); };
$('#inputSource').onchange = () => { releaseClient();refreshGamepads(); };
$('#clientEnableGroup').onclick=()=>$('#clientEnablePad').click();
function sendInputs() {
  nativeGuest.tick();
  if(reverseControllers?.nativeActive())return;
  if(nativeGuest.blocksBrowser || nativeGuest.switching || nativeGuest.active && nativeGuest.awaitingState)return;
  if(keyboardMapping.dialog.open)return;
  scanJoiningControllers();
  const ch = clientPeer?.channel;
  if (!$('#clientJoinControllers').checked || !enabled || !assignedSlot || ch?.readyState !== 'open' || ch.bufferedAmount > inputQueueLimit(assignedSlots.length,clientPeer.inputFormat)) return;
  const now = performance.now();
  const used=new Set();
  for(let controller=0;controller<Math.min(controllerCount(),assignedSlots.length);controller++) {
    const source=dynamicMode()?joinedControllers[controller]?.source:controller===0?$('#inputSource').value:'gamepad';
    if(source==='desktop' || source==='keyboard' && clientPeer?.allowKeyboard===false)continue;
    let state=neutralState();
    if (nativeGuest.active || (!document.hidden && document.hasFocus()) || (source==='gamepad' && ($('#backgroundGamepad').checked || document.pictureInPictureElement===$('#clientVideo')))) {
      if(source==='keyboard')state=chatting()?neutralState():keyboardState(keys,keyboardMapping.bindings);
      else {
        const index=controller===0?selectedIndex:extraPadIndices[controller-1],gp=inputGamepads()[index];
        if(gp && gp.connected!==false && !used.has(index)) { try { state=packGamepadState(gp,profileFor(gp),profileFor(gp)?.deadzone ?? Number($('#deadzone').value)); } catch { /* Custom devices stay neutral until mapped. */ } used.add(index); }
      }
    }
    const value={generation:controllerGeneration,source,state};
    clientPeer.inputPacer ||= inputPacer();
    if(clientPeer.inputPacer(controller,value,now)){
      const payload=inputPayload({seq:sequence++,controller,...value},clientPeer.inputFormat);if(payload!==null)ch.send(payload);
    }
  }
}
let lastDeviceRefresh = 0, lastPadSignature='';
setInterval(() => {
  if(document.hidden || $('#clientPanel').hidden)return;
  const pads=inputGamepads(),gp = pads[selectedIndex];
  const readout=gp ? `Pressed: ${gp.buttons.map((b, i) => b.pressed ? i : null).filter(i => i !== null).join(', ') || 'none'} · Axes: ${gp.axes.map((a, i) => `${i}: ${a.toFixed(2)}`).join(' / ')}` : 'No controller detected';
  if($('#inputReadout').textContent!==readout)$('#inputReadout').textContent=readout;
  // Some browsers expose devices only after a button press without a connection event.
  updateControllerTests(pads);
  scanJoiningControllers();
  renderConnectedControllers();
  if(Date.now()-lastDeviceRefresh>1000) { lastDeviceRefresh=Date.now();const signature=JSON.stringify([...(pads || [])].map(p=>p && [p.index,p.id,p.connected]));if(signature!==lastPadSignature){lastPadSignature=signature;refreshGamepads();} }
}, 100);
let liveTestFrame=null;
let preparePollFrame=null;
function pollPreparedControllers(){preparePollFrame=null;if(document.hidden || $('#clientPanel').hidden || clientPeer?.controllersRequested)return;scanJoiningControllers();preparePollFrame=requestAnimationFrame(pollPreparedControllers);}
function schedulePreparedPoll(){if(preparePollFrame!==null)cancelAnimationFrame(preparePollFrame);preparePollFrame=null;if(!document.hidden && !$('#clientPanel').hidden && !clientPeer?.controllersRequested)preparePollFrame=requestAnimationFrame(pollPreparedControllers);}
document.addEventListener('visibilitychange',schedulePreparedPoll);document.addEventListener('app-mode',schedulePreparedPoll);schedulePreparedPoll();
// Show controllers the way players name them; the full browser id stays in the tooltip.
function friendlyControllerName(raw){
  const name=String(raw || '');
  if(/dualsense/i.test(name))return 'DualSense';
  if(/dualshock|playstation|vendor:\s*054c|^054c-/i.test(name))return 'PlayStation controller';
  if(/pro controller|vendor:\s*057e/i.test(name))return 'Switch Pro';
  if(/xbox|xinput|vendor:\s*045e/i.test(name))return 'Xbox controller';
  const clean=name.replace(/\s*\((?:standard gamepad|vendor:)[^)]*\)/ig,'').replace(/^[0-9a-f]{4}-[0-9a-f]{4}-\s*/i,'').trim();
  return clean.length>42?clean.slice(0,40)+'…':clean || name;
}
const liveTestsVisible=()=>!document.hidden && !$('#clientPanel').hidden && $('#connectedControllers').checkVisibility() && !!$('#connectedControllers .pad-live-test[open]');
function drawLiveTests(){
  liveTestFrame=null;if(!liveTestsVisible())return;
  updateLiveTests($('#connectedControllers'),liveControllerRows,[...(inputGamepads() || [])]);
  liveTestFrame=requestAnimationFrame(drawLiveTests);
}
function scheduleLiveTests(){
  if(!liveTestsVisible()){if(liveTestFrame!==null)cancelAnimationFrame(liveTestFrame);liveTestFrame=null;return;}
  if(liveTestFrame===null)liveTestFrame=requestAnimationFrame(drawLiveTests);
}
document.addEventListener('toggle',event=>{if(event.target.matches('.pad-live-test,#controllersSheet'))scheduleLiveTests();},true);
document.addEventListener('visibilitychange',scheduleLiveTests);document.addEventListener('app-mode',scheduleLiveTests);
window.addEventListener('pagehide',()=>{if(liveTestFrame!==null)cancelAnimationFrame(liveTestFrame);liveTestFrame=null;if(preparePollFrame!==null)cancelAnimationFrame(preparePollFrame);preparePollFrame=null;});
window.addEventListener('blur', ()=>{if(!nativeGuest.active)releaseClient();});
document.addEventListener('visibilitychange', () => { if (document.hidden) releaseClient(); });
window.addEventListener('keydown', e => {
  if(nativeGuest.latched)return;
  if(keyboardMapping.dialog.open)return;
  if (!enabled || !hasKeyboardController() || clientPeer?.allowKeyboard===false || /INPUT|TEXTAREA|SELECT|BUTTON/.test(e.target.tagName)) return;
  if (Object.values(keyboardMapping.bindings).includes(e.code)) { e.preventDefault();if(!keys.has(e.code)){keys.add(e.code);sendInputs();} }
});
window.addEventListener('keyup', e => {if(!nativeGuest.latched && keys.delete(e.code))sendInputs();});
const mappedMouseTimers=new Map();
function controllerMouseReady(event){return !nativeGuest.latched && !keyboardMapping.dialog.open && enabled && hasKeyboardController() && clientPeer?.allowKeyboard!==false && !chatting() && !event.target.closest('button,input,select,textarea,a,.call-toolbar,.call-sheet');}
$('#clientStage').addEventListener('pointerdown',event=>{
  const code=`Mouse${event.button}`;if(event.pointerType!=='mouse' || !controllerMouseReady(event) || !Object.values(keyboardMapping.bindings).includes(code))return;
  event.preventDefault();event.stopImmediatePropagation();desktopVideo.focus({preventScroll:true});desktopVideo.setPointerCapture?.(event.pointerId);keys.add(code);sendInputs();
},true);
window.addEventListener('pointerup',event=>{if(keys.delete(`Mouse${event.button}`))sendInputs();});
for(const type of ['pointercancel','lostpointercapture'])desktopVideo.addEventListener(type,()=>{let changed=false;for(let i=0;i<5;i++)changed=keys.delete(`Mouse${i}`)||changed;if(changed)sendInputs();});
$('#clientStage').addEventListener('wheel',event=>{
  const code=Math.abs(event.deltaY)>=Math.abs(event.deltaX)?event.deltaY<0?'WheelUp':'WheelDown':event.deltaX<0?'WheelLeft':'WheelRight';
  if(!(event.deltaY || event.deltaX) || !controllerMouseReady(event) || !Object.values(keyboardMapping.bindings).includes(code))return;
  event.preventDefault();event.stopImmediatePropagation();keys.add(code);sendInputs();clearTimeout(mappedMouseTimers.get(code));mappedMouseTimers.set(code,setTimeout(()=>{mappedMouseTimers.delete(code);if(keys.delete(code))sendInputs();},60));
},{capture:true,passive:false});
$('#clientStage').addEventListener('contextmenu',event=>{if(controllerMouseReady(event) && Object.values(keyboardMapping.bindings).includes('Mouse2'))event.preventDefault();});

async function negotiateClient(invitation,transport) {
  closeClientPeer(transport?{preserveVoice:true,keepTransport:true,preserveNative:true}:{preserveCameraPreview:!clientCamera.ready});
  const pc = transport?.pc || new RTCPeerConnection(invitation.ice);
  clientConnectionReports.track(pc,'controls');
  clientDiagnostics.clear();
  const p = { pc, handoff:!!transport,stream: new MediaStream(), manual: true, candidates: [] }; clientPeer = p;
  p.grace=new ReconnectGrace({waiting:()=>document.dispatchEvent(new CustomEvent('call-recovery',{detail:'waiting'})),recovered:()=>{document.dispatchEvent(new CustomEvent('call-recovery',{detail:'connected'}));toast('Reconnected · your player spots are ready');},expired:()=>document.dispatchEvent(new CustomEvent('call-recovery',{detail:'expired'}))});
  p.playback=independentPlayback($('#clientVideo'),$('#clientAudio'));p.playback.bind(p.stream);
  const observedTracks=new WeakSet();
  const attachTrack = (track, receiver) => {
    if (clientPeer !== p) return;
    if(track.kind==='video' && $('#clientVideo').dataset.audioOnly==='true')return;
    if(track.kind==='audio' && (track.muted || $('#clientVideo').dataset.sharedAudio!=='true' || (p.hybridAudio?.track===track)!==($('#clientVideo').dataset.audioBackend==='native')))return;
    for (const previous of p.stream.getTracks().filter(previous => previous.kind === track.kind && previous !== track)) p.stream.removeTrack(previous);
    p.stream.addTrack(track);
    p.playback.refresh();
    preferLowLatency(receiver);
    $('#clientVideo').play().catch(() => {});
    if(!observedTracks.has(track)) {
      observedTracks.add(track);
      track.addEventListener('ended', updateDesktopMouse, { once: true });
      if(track.kind==='audio')for(const event of ['ended','mute','unmute'])track.addEventListener(event,()=>{if(clientPeer===p)soundUI($('#clientVideo').muted);});
    }
    soundUI($('#clientVideo').muted);
    updateDesktopMouse();
  };
  const stopHybridReceiver=()=>{p.hybridAudioPC?.close();p.hybridAudioPC=null;if(p.hybridAudio)p.stream.removeTrack(p.hybridAudio.track);p.hybridAudio=null;p.playback.refresh();soundUI($('#clientVideo').muted);};
  const stopNative = (keepPicture=false) => {
    p.cancelVideoHandover?.();p.cancelVideoHandover=null;
    clearTimeout(p.codecFallbackTimer);
    if(keepPicture){releaseDesktopClient();if(p.retiredPC)p.nativePC?.close();else p.retiredPC=p.nativePC;p.nativePC=null;p.videoSample=null;p.nativeAudio=null;return;}
    if(p.retiredPC){for(const receiver of p.retiredPC.getReceivers())if(receiver.track)p.stream.removeTrack(receiver.track);p.retiredPC.close();p.retiredPC=null;}
    releaseDesktopClient(); const previous = p.nativePC; p.nativePC = null;
    for(const receiver of previous?.getReceivers() || [])if(receiver.track)p.stream.removeTrack(receiver.track);
    previous?.close(); p.videoSample = null;p.nativeAudio=null;p.mediaKind=null;updateVideoRefresh();
    if (p.browserVideo && !p.browserVideo.muted) attachTrack(p.browserVideo);
    else { for (const track of p.stream.getVideoTracks()) p.stream.removeTrack(track); playerVideoUI(false); }
    p.playback.refresh();soundUI($('#clientVideo').muted);updateDesktopMouse();
  };
  const receiveChannel = ch => {
    if(ch.label==='files'){ch.onopen=()=>{if(clientPeer===p)clientChat.files.attach('host',ch,'Host');};if(ch.readyState==='open')ch.onopen();return;}
    if(ch.label==='chat'){p.chat=ch;ch.onopen=()=>{if(clientPeer===p)clientChat.connect(ch);};if(ch.readyState==='open')ch.onopen();return;}
    if (ch.label === 'desktop' || ch.label === 'desktop-events') {
      if (ch.label === 'desktop') { p.desktopChannel = ch; ch.onmessage = event => { if (clientPeer !== p || typeof event.data !== 'string' || event.data.length > 2048) return; const value = parse(event.data); if(value?.type==='cursor-hidden')guestCursors.remove(value.peerId);if (value?.type === 'cursor' && p.showCursors===true && (value.sourceId || '')===(p.desktopSourceId || '')) guestCursors.set(value.peerId, value); }; }
      else p.desktopEvents = ch;
      return;
    }
    if (ch.label === 'control') {
      p.control = ch;ch.onclose=()=>{if(clientPeer===p){clientVoice.setReady(false);clientCamera.setReady(false);clientScreens.setReady(false);clientChat.setReady(false);}};
      ch.onopen = async () => { inputStreams?.guestAttach(ch);reverseControllers?.guestAttach(ch);if(!p.handoff){clientVoice.connect(voiceSend(ch));clientCamera.connect(voiceSend(ch));clientScreens.connect(voiceSend(ch));}ch.send(JSON.stringify({type:'host-capability',enabled:canBecomeHost()}));await sendClientQuality(p);if(clientPeer===p && ch.readyState==='open')ch.send(JSON.stringify({ type: 'media-subscription', enabled: $('#clientReceiveVideo').checked })); };
      let queue = Promise.resolve();
      ch.onmessage = ev => {
        const handoffMessage=typeof ev.data==='string' && ev.data.length<=131072?parse(ev.data):null;
        if(['app-input','reverse-controller'].includes(handoffMessage?.type))return;
        if(handoffMessage?.type==='session-ended' && clientPeer===p){try{ch.send(JSON.stringify({type:'session-ended-ack',id:handoffMessage.id}));}catch{}sessionInvites.leaveGuest();disconnectClient('The host ended this session.');return;}
        if(handoffMessage?.type==='host-handoff'){if(clientPeer===p || handoff.owns(ch))handoff.receive('host',handoffMessage,ch);return;}
        if(clientPeer===p && typeof ev.data==='string' && ev.data.length<=131072){const msg=parse(ev.data);if(msg?.type==='participants'){participants?.receive(msg);return;}if(msg?.type==='rumble'){receiveRumble(msg);return;}if(msg?.type==='screen'){clientScreens.receive(null,msg);return;}if(msg?.type==='camera'){clientCamera.receive(null,msg);return;}if(msg?.type==='voice'){clientVoice.receive(null,msg);return;}}
        queue = queue.then(async () => {
        if (clientPeer !== p || typeof ev.data !== 'string' || ev.data.length > 131072) return;
        const msg = parse(ev.data);
        if(msg?.type==='guest-view-request'){await sendGuestView(p,msg);return;}
        if(msg?.type==='shared-views'){clientViews.update(msg);guestViewPopouts.update(msg.sources || []);guestTiles.update(msg);return;}
        if(await guestViewPopouts.handle(msg))return;
        if(msg?.type==='capture-info') {
          $('#clientVideo').dataset.audioOnly=String(msg.audioOnly===true);
          if(msg.audioOnly===true)for(const track of p.stream.getVideoTracks())p.stream.removeTrack(track);
          $('#clientVideoSettings').hidden=msg.audioOnly===true;$('#clientVideoToggle').closest('label').hidden=msg.audioOnly===true;
          $('#clientVideo').dataset.sharedAudio=String(msg.audio===true);$('#clientVideo').dataset.audioBackend=msg.audioBackend || 'video';
          for(const audio of [p.nativeAudio,p.hybridAudio])if(audio){if(msg.audio===true && (audio===p.hybridAudio)===(msg.audioBackend==='native'))attachTrack(audio.track,audio.receiver);else p.stream.removeTrack(audio.track);}
          p.playback.refresh();soundUI($('#clientVideo').muted);if(msg.audioOnly===true)playerVideoUI(false);else tutorialEvent('refresh');return;
        }
        if (msg?.type === 'cursor-labels') { guestCursors.labels(msg.enabled === true); return; }
        if (msg?.type === 'input-policy') {
          guestCursors.labels(msg.cursorLabels === true);p.showCursors=msg.showCursors===true;if(!p.showCursors)releaseGuestPointer();if(!p.showCursors)guestCursors.clear();const pointerSize=msg.pointerSize;if([pointerSize?.width,pointerSize?.height].every(n=>Number.isInteger(n) && n>0 && n<=32768))p.pointerSize=pointerSize;
          p.allowKeyboard = msg.allowKeyboard !== false;
          if(!p.dynamicControllers && p.controllersRequested && p.wantsController && enabled && !p.preparedManualApplied){
            p.preparedManualApplied=true;const pads=[...(inputGamepads() || [])].filter(Boolean),chosen=[...preparedControllers.values()].filter(d=>d.source==='keyboard'?p.allowKeyboard:pads.some(pad=>pad.id===d.id && pad.index===d.index)).slice(0,64);
            // The manual compatibility mode has one keyboard lane, always first.
            chosen.sort((a,b)=>Number(b.source==='keyboard')-Number(a.source==='keyboard'));
            if(chosen.length){selectedIndex=chosen[0].index;$('#inputSource').value=chosen[0].source;extraPadIndices.splice(0,extraPadIndices.length,...chosen.slice(1).map(d=>d.index));$('#clientControllerCount').value=String(chosen.length);requestClientControllers();refreshGamepads();}
          }

          applyPreparedControllers();

          $('#inputSource option[value="keyboard"]').disabled = !p.allowKeyboard;
          $('#keyboardPolicyNote').textContent = p.allowKeyboard ? 'Use your keyboard to control a gamepad on the host.' : 'The host has turned off keyboard controls. Use a gamepad.';
          if (!p.allowKeyboard && $('#inputSource').value === 'keyboard') { releaseClient(); $('#inputSource').value = 'gamepad'; $('#inputSource').dispatchEvent(new Event('change')); }
          const size = msg.desktopSize;
          if(p.desktopSourceId!==msg.desktopSourceId || p.desktopToken!==msg.desktopToken){releaseDesktopClient();guestCursors.clear();}p.desktopSourceId=msg.desktopSourceId || '';p.desktopToken=msg.desktopToken;p.desktopScope=msg.desktopScope;p.sharedSource=msg.sharedSource;$('#clientPanel').dataset.desktopScope=p.desktopScope || 'none';$('#clientPanel').dataset.guestPointers=String(p.showCursors);
          p.desktopSimulated = msg.desktopSimulated === true;
          $('#clientDesktopMouseLabel').textContent = p.desktopSimulated ? 'Control the simulated test-screen mouse' : 'Control the host’s system mouse';
          $('#desktopSimulationNotice').hidden = !p.desktopSimulated;
          p.desktopMouse = msg.desktopMouse === true;p.desktopRelative=msg.desktopRelative===true; p.desktopKeyboard = msg.desktopKeyboard === true; p.desktopVideoMatches = msg.desktopVideoMatches === true;gameMouse.refresh();
          if ([size?.width,size?.height].every(n => Number.isInteger(n) && n > 0 && n <= 32768)) { if (p.desktopSize && (p.desktopSize.width !== size.width || p.desktopSize.height !== size.height)) releaseDesktopClient(); p.desktopSize = size; }
          $('#clientDesktopMouse').disabled = !p.desktopMouse || !canUseClientInputs();
          $('#inputSource option[value="desktop"]').disabled = !p.desktopKeyboard;$('#clientDesktopTyping').disabled=!p.desktopKeyboard;if(!p.desktopKeyboard)$('#clientDesktopTyping').checked=false;
          if (!p.desktopMouse) { $('#clientDesktopMouse').checked = false; updateDesktopMouse(); }
          if (!p.desktopKeyboard && $('#inputSource').value === 'desktop') { releaseClient(); $('#inputSource').value = 'gamepad'; $('#inputSource').dispatchEvent(new Event('change')); }
          updateDesktopMouse();if(p.showCursors)publishCursor();
          return;
        }
        if(msg?.type==='pong' && msg.id===p.nativePing?.id){p.nativePongAt=performance.now();p.nativePing=null;return;}
        if (msg?.type === 'pong' && msg.id === p.ping?.id) { p.inputMs=performance.now() - p.ping.at;inputLatencyUI(p.inputMs);p.inputAt=performance.now();p.ping = null; return; }
        if (msg?.type === 'quality-limit') {
          const fields=value=>JSON.stringify([value?.width,value?.height,value?.frameRate,value?.maxBitrate,value?.codec]);
          const changed=fields(p.hostLimit)!==fields(msg.host);
          p.hostLimit = msg.host;
          if(changed)requestClientQuality();
          const height = msg.host?.height || 2160, fps = msg.host?.frameRate || 120;
          for (const option of $('#clientResolution').options) option.disabled = option.value !== 'host' && Number(option.value) > height;
          for (const option of $('#clientFramerate').options) option.disabled = option.value !== '0' && Number(option.value) > fps;
          $('#clientHostLimit').textContent = `Host limit: ${msg.host?.height ? msg.host.height + 'p' : 'source size'} · ${fps} fps. Your stream: ${msg.assigned?.height ? msg.assigned.height + 'p' : 'source size'} · ${Math.round(msg.assigned?.frameRate || fps)} fps. ${msg.assigned?.autoThrottle===false?'Fixed resolution.':`Automatic · minimum ${msg.assigned?.minHeight || 480}p.`}`;
          return;
        }
        if(msg?.type==='audio-stop'){stopHybridReceiver();return;}
        if(msg?.type==='audio-offer'){
          if(!$('#clientReceiveVideo').checked)return;
          stopHybridReceiver();const audioPC=clientConnectionReports.track(new RTCPeerConnection(sanitizeIceConfig(msg.ice)),'native-audio');p.hybridAudioPC=audioPC;
          audioPC.ontrack=event=>{if(clientPeer!==p || p.hybridAudioPC!==audioPC)return;p.hybridAudio={track:event.track,receiver:event.receiver};attachTrack(event.track,event.receiver);event.track.onunmute=()=>{if(p.hybridAudioPC===audioPC)attachTrack(event.track,event.receiver);};};
          audioPC.onconnectionstatechange=()=>{if(clientPeer===p && p.hybridAudioPC===audioPC && audioPC.connectionState==='failed' && ch.readyState==='open')ch.send(JSON.stringify({type:'audio-restart'}));};
          await audioPC.setRemoteDescription(msg.sdp);await audioPC.setLocalDescription(voiceDescription(await audioPC.createAnswer(),192000,true));await gatherIce(audioPC);updateVideoRefresh();
          if(p.hybridAudioPC===audioPC && ch.readyState==='open')ch.send(JSON.stringify({type:'audio-answer',id:msg.id,sdp:audioPC.localDescription}));
          return;
        }
        if(msg?.type==='native-rollback') {
          p.cancelVideoHandover?.();p.cancelVideoHandover=null;clearTimeout(p.codecFallbackTimer);
          if(p.retiredPC) {
            const failed=p.nativePC;p.nativePC=p.retiredPC;p.retiredPC=null;p.videoSample=null;
            for(const receiver of p.nativePC.getReceivers())if(receiver.track?.readyState==='live')attachTrack(receiver.track,receiver);
            for(const receiver of failed?.getReceivers() || [])if(receiver.track)p.stream.removeTrack(receiver.track);
            failed?.close();p.playback.refresh();updateVideoRefresh();
            clientStatus('Keeping the previous stream. Your controllers stay connected.');
          }
          return;
        }
        if (msg?.type === 'native-stop') { stopNative(); return; }
        if (msg?.type === 'native-offer' || msg?.type === 'browser-offer') {
          if (!$('#clientReceiveVideo').checked) return;
          const native = msg.type === 'native-offer';
          stopNative(true); const media = clientConnectionReports.track(new RTCPeerConnection(sanitizeIceConfig(msg.ice)),native?'native-video':'browser-video'); p.nativePC = media; p.videoSample = null;p.mediaKind=native?'native':'browser';updateVideoRefresh();
          media.ontrack = event => {
            const attach=()=>{
              if(clientPeer!==p || p.nativePC!==media || event.track.muted)return;
              if(event.track.kind==='audio')p.nativeAudio={track:event.track,receiver:event.receiver};
              const commit=()=>{attachTrack(event.track,event.receiver);if(event.track.kind==='video' || $('#clientVideo').dataset.audioOnly==='true'){p.retiredPC?.close();p.retiredPC=null;if(native && ch.readyState==='open')ch.send(JSON.stringify({type:'native-presented',id:msg.id}));}};
              if(event.track.kind==='video' && p.retiredPC && !$('#clientVideo').hidden){
                p.cancelVideoHandover?.();p.cancelVideoHandover=prepareVideoHandover(event.track,{active:()=>clientPeer===p && p.nativePC===media,ready:()=>{p.cancelVideoHandover=null;commit();},failed:()=>{p.cancelVideoHandover=null;if(ch.readyState==='open')ch.send(JSON.stringify({type:native?'native-restart':'browser-restart'}));}});
              }else commit();
            };
            event.track.onunmute=attach;attach();
          };
          media.onconnectionstatechange = () => { if (clientPeer !== p || p.nativePC !== media) return; if (['failed','disconnected','closed'].includes(media.connectionState)) releaseDesktopClient(); updateDesktopMouse(); if (media.connectionState === 'failed' && ch.readyState === 'open') ch.send(JSON.stringify({ type: native ? 'native-restart' : 'browser-restart' })); };
          const fallbackCodec=()=>{if(clientPeer!==p || p.nativePC!==media)return;stopNative(true);$('#clientCodec').value='h264';requestClientQuality();clientStatus('Using H.264 for this device. Controller sharing stays connected.');};
          try{await media.setRemoteDescription(msg.sdp); await media.setLocalDescription(voiceDescription(await media.createAnswer(),192000,true)); await gatherIce(media);}
          catch(error){if(native && msg.codec==='h265'){fallbackCodec();return;}throw error;}
          if (p.nativePC === media && ch.readyState === 'open') ch.send(JSON.stringify({ type: native ? 'native-answer' : 'browser-answer', id: msg.id, sdp: media.localDescription }));
          if(native && msg.codec==='h265')p.codecFallbackTimer=setTimeout(async()=>{try{if(clientPeer===p && p.nativePC===media && ![...(await media.getStats()).values()].some(stat=>stat.type==='inbound-rtp' && stat.kind==='video' && stat.framesDecoded>0))fallbackCodec();}catch{/* A replaced connection has already stopped. */}},6000);
          return;
        }
        if (msg?.type === 'rtc-offer') {
          if (msg.ice) pc.setConfiguration(sanitizeIceConfig(msg.ice));
          await setRemote(p, msg.sdp); await pc.setLocalDescription(await pc.createAnswer()); await gatherIce(pc);
          ch.send(JSON.stringify({ type: 'rtc-answer', id: msg.id, sdp: pc.localDescription }));
          $('#clientPairStatus').textContent = 'Connection refreshed. You can keep playing.';
        }
        if(msg?.type==='input-receipt') { if(msg.generation===controllerGeneration && assignedSlots[msg.controller]===msg.slot)controllerReceipts[msg.controller]=Date.now(); return; }
        if(msg?.type==='controller-error'){if(nativeGuest.active)nativeGuest.endSession();p.controllerError=msg.error;clientStatus(msg.error);refreshGamepads();return;}
        if (msg?.type !== 'slot') return;
        p.inputFormat=msg.inputFormat===inputWireVersion?inputWireVersion:0;
        if(controllerGeneration!==(msg.generation || 0) || Number.isInteger(msg.removedController))releaseClient();
        if(Number.isInteger(msg.removedController)){if(dynamicMode())joinedControllers.splice(msg.removedController,1);else if(msg.removedController===0){selectedIndex=extraPadIndices.shift() ?? null;$('#inputSource').value='gamepad';}else extraPadIndices.splice(msg.removedController-1,1);}
        const previouslyAssigned=assignedSlots.length;
        if(Number.isInteger(msg.removedController) && !msg.dynamicControllers)$('#clientControllerCount').value=String(Math.max(1,msg.slots?.length || 0));
        controllerPendingRemoval=false;p.dynamicControllers=msg.dynamicControllers===true;
        assignedSlot = isPlayerSlot(msg.slot) ? msg.slot : null;
        assignedSlots=assignedSlot ? (Array.isArray(msg.slots)?msg.slots.filter(isPlayerSlot):[assignedSlot]):[]; controllerGeneration=msg.generation || 0; controllerReceipts.length=0;
        if(msg.removedController!==undefined && nativeGuest.active)nativeGuest.endSession();
        hostControllerCapacity=msg.capacity;p.adaptiveControllers=msg.adaptiveControllers===true;p.controllerType=msg.controllerType;if(assignedSlots.length>=joinedControllers.length)p.controllerError=null; p.wantsController=msg.wantsController===true || !!assignedSlot;
        if(p.adaptiveControllers && assignedSlots.length<joinedControllers.length && !p.controllerError)setTimeout(()=>{if(clientPeer===p)requestClientControllers();},0);
        if(!p.controllersRequested){p.controllersRequested=true;enabled=p.wantsController && $('#clientJoinControllers').checked;if(p.dynamicControllers){buttonSnapshots.clear();applyPreparedControllers();}else if(enabled)requestClientControllers();}
        for(const option of $('#clientControllerCount').options)option.disabled=hostControllerCapacity!==null && Number(option.value)>hostControllerCapacity;
        p.cursorColor = msg.cursorColor;
        if (/^(?:#[a-f0-9]{6}|hsl\(\d{1,3} 85% 70%\))$/i.test(msg.cursorColor || '')) $('#clientSlot').style.color = msg.cursorColor;
        $('#clientSlot').textContent = assignedSlot?.toUpperCase() || 'Watching';
        $('#clientEnablePad').disabled = !canUseClientInputs() || p.channel?.readyState !== 'open';
        updateDesktopMouse(); refreshGamepads();nativeGuest.prepare();tutorialEvent('client-controls-ready');if(dynamicMode() && !previouslyAssigned && assignedSlots.length)tutorialEvent('client-controller-enabled');
      }).catch(error => clientStatus(`Connection update failed: ${error.message}`)); };
      if(ch.readyState==='open')ch.onopen();
      return;
    }
    if (ch.label !== 'input') { ch.close(); return; }
    p.channel = ch;
    ch.onopen = () => {
      if (clientPeer !== p) return;
      $('#clientEnablePad').disabled = !canUseClientInputs();
      clearInterval(sendTimer); sendTimer = setInterval(sendInputs, 1000 / 60); refreshGamepads();if(enabled)startInputVideoClock();
      tutorialEvent('client-controls-ready');
    };
    ch.onclose = () => { if (clientPeer === p) { clearInterval(sendTimer);clientVoice.setReady(false);clientCamera.setReady(false);clientScreens.setReady(false);clientChat.setReady(false); suspendClientControls();exitClientFullscreen(); playerConnectionUI('disconnected'); if (p.manual) requestFallbackRestart(); } };
    if (ch.readyState === 'open') ch.onopen();
  };
  pc.ondatachannel = ev => receiveChannel(ev.channel);
  const playRemote = () => $('#clientVideo').play().catch(error => { if (error.name !== 'AbortError') clientStatus('Click the shared screen or Sound on to watch.'); });
  pc.ontrack = e => {
    if (e.track.kind === 'video') p.browserVideo = e.track;
    if (e.track.kind !== 'video' || !p.nativePC) attachTrack(e.track, e.receiver);
    preferLowLatency(e.receiver);
    e.track.onunmute = () => { if (e.track.kind !== 'video' || !p.nativePC) { attachTrack(e.track, e.receiver); playRemote(); if ($('#clientVideo').readyState >= 2) playerVideoUI(true); } };
    if (e.track.kind === 'video') e.track.onmute = () => { if (!p.nativePC) playerVideoUI(false); };
    playRemote();
    soundUI($('#clientVideo').muted);
  };
  pc.onconnectionstatechange = () => {
    if (clientPeer !== p) return;
    clientStatus(pc.connectionState);
    p.grace.update(pc.connectionState);
    updateVideoRefresh();
    playerConnectionUI(pc.connectionState);
    if (pc.connectionState === 'connected') { p.connectedOnce=true;$('#clientPairing').open = false; $('#clientEnablePad').disabled = !canUseClientInputs() || p.channel?.readyState !== 'open'; controllerUI(enabled); updateDesktopMouse();nativeGuest.prepare(); if (enabled) startInputVideoClock(); tutorialEvent('client-controls-ready'); }
    if (['failed','disconnected','closed'].includes(pc.connectionState)) {
      suspendClientControls();
      if (invitation) $('#clientPairStatus').textContent = pc.connectionState==='failed'?connectionFailure(pc).report:'Connection interrupted. If it cannot recover, ask the host for a fresh invitation and exchange replies again.';
      if(invitation && pc.connectionState==='failed' && !p.connectedOnce && (document.body.dataset.sessionInvites!=='true' || document.body.dataset.sessionGuestFiles==='true')){
        const hint=filePairingBrowserHint(navigator.userAgent,document.body.dataset.sessionInvites==='true');
        if(hint)$('#clientPairStatus').textContent=`${hint} Keep both apps open and exchange a fresh invite and reply after switching browsers.\n\n${connectionFailure(pc).report}`;
      }
      if (invitation && fallbackReady) requestFallbackRestart();
    }
  };
  if(transport){
    transport.adopted=true;
    for(const channel of transport.channels.values())receiveChannel(channel);
    transport.flush();pc.onconnectionstatechange();
  }else{
    await setRemote(p, invitation.sdp);
    await pc.setLocalDescription(await pc.createAnswer());await gatherIce(pc);clientConnectionReports.sharedDescription(pc,pc.localDescription);
  }
  statsTimer = setInterval(async () => {
    if(clientPeer!==p)return;
    if (p.control?.readyState === 'open') { p.ping = { id: crypto.randomUUID(), at: performance.now() }; p.control.send(JSON.stringify({ type: 'ping', id: p.ping.id })); }
    if(p.statsBusy)return;p.statsBusy=true;
    try {
      const mediaPC=p.stream.getVideoTracks().length?(p.nativePC || pc):null;
      const videoStats=mediaPC?await mediaPC.getStats():null;
      if (clientPeer !== p || mediaPC && mediaPC!==(p.nativePC || pc)) return;
      const video = videoStats?receivedVideoStats(videoStats, p.videoSample, $('#clientVideo')):null;
      clientDiagnostics.record({...video,inputMs:performance.now()-p.inputAt<5000?p.inputMs:null,lossPercent:video?.loss==null?null:video.loss*100});
      if (video) {
        p.videoHealth=videoHealth(p.videoHealth,video.sample);
        if(p.videoHealth.recover && !p.cancelVideoHandover && p.control?.readyState==='open' && p.mediaKind){p.control.send(JSON.stringify({type:p.mediaKind==='native'?'native-restart':'browser-restart'}));clientStatus('Refreshing the picture. Your controllers stay connected.');}
        p.lastVideoMetrics=video;
        p.cameraPressureAt=performance.now();p.cameraPressure=video;p.videoSample = video.sample; $('#clientVideoStats').textContent = videoStatsLabel(video); $('#clientStreamDetail').textContent = videoStatsLabel(video, true);
        const ms = value => value === null ? '—' : `${value.toFixed(1)} ms`;
        $('#clientMediaRtt').textContent = ms(video.rttMs); $('#clientJitter').textContent = ms(video.jitterMs); $('#clientDecode').textContent = ms(video.decodeMs); $('#clientBuffer').textContent = ms(video.bufferMs); $('#clientDecode').title=[video.codec,video.decoder,video.powerEfficient===true?'Hardware-efficient decoding':video.powerEfficient===false?'Software or inefficient decoding':''].filter(Boolean).join(' · ');
        $('#clientLoss').textContent = video.loss === null ? '—' : `${(video.loss * 100).toFixed(1)}%`; $('#clientDrops').textContent = video.dropped === null ? '—' : String(video.dropped);
        if (p.control?.readyState === 'open') p.control.send(JSON.stringify({ type: 'stream-metrics', metrics: { loss: video.loss, rttMs: video.rttMs, bufferMs: video.bufferMs, freezeMs: video.freezeMs,decodeMs:video.decodeMs,fps:video.fps,mbps:video.mbps,inputMs:performance.now()-p.inputAt<5000?p.inputMs:null } }));
      }
    } catch { /* Closed during a stats request. */ }
    finally{p.statsBusy=false;}
  }, 1500);
  if(!transport)return pairingPacket('answer', invitation.pairingId, pc.localDescription, null, null, invitation.expiresAt);
  return p;
}
function disconnectClient(message = 'Disconnected',{preserveCameraPreview=false}={}) {
  clientReplyEpoch++;$('#createReply').disabled=false;
  exitPopout();
  exitClientFullscreen();
  clearTimeout(fallbackReconnectTimer); fallbackSession = null; fallbackReady = false;
  const oldFallback = fallbackWs; fallbackWs = null; oldFallback?.close();
  $('#clientFallbackStatus').hidden=true;$('#clientFallbackStatus').textContent = 'Off · not included in this invitation';
  lastReply=null;$('#clientReply').value='';$('#downloadReply').disabled=true;$('#copyReply').disabled=true;
  if (clientPeer?.control?.readyState === 'open') clientPeer.control.send(JSON.stringify({ type: 'bye' }));
  closeClientPeer({preserveCameraPreview}); assignedSlot = null; assignedSlots=[];joinedControllers.length=0;buttonSnapshots.clear();controllerPendingRemoval=false;controllerGeneration=0;controllerReceipts.length=0;hostControllerCapacity=null;enabled = false;
  rememberControllerButtons();schedulePreparedPoll();
  for(const option of $('#clientControllerCount').options)option.disabled=false;
  refreshGamepads();
  $('#clientSlot').textContent = '—'; $('#clientRtt').textContent = '—';
  $('#clientVideoStats').textContent = 'Waiting for video'; $('#clientStreamDetail').textContent = '—';
  $('#clientDisconnect').disabled = true; $('#clientEnablePad').disabled = true; $('#clientEnablePad').textContent = 'Enable controller'; $('#clientUnmute').disabled = true;
  clientStatus(message);
  playerConnectionUI('idle'); controllerUI(false);pairingUI('client','idle');
}
$('#clientDisconnect').onclick = () => {handoff.cancel('Host switch cancelled.');sessionInvites.leaveGuest();disconnectClient();};
$('#createReply').onclick = async () => {
  if($('#createReply').disabled)return;
  pairingFeedback('client');
  let invitation;
  try {invitation=parsePairing($('#clientInvitation').value,'offer');}
  catch(error){$('#clientPairStatus').textContent=error.message;pairingFeedback('client',error.message);return;}
  if(lastReply?.pairingId===invitation.pairingId && clientPeer && !['failed','closed'].includes(clientPeer.pc.connectionState)) {
    if(clientPeer.pc.connectionState==='connected')$('#clientPairing').open=false;
    toast(clientPeer.pc.connectionState==='connected'?'You are already connected to this host.':'Your reply is already ready. Save it and send it to the host.');return;
  }
  const button = $('#createReply'); button.disabled = true;
  const validationEpoch=clientReplyEpoch;
  // Check replacement invites before releasing a working connection.
  if(clientPeer?.pc.connectionState==='connected') {
    let probe;
    try {probe=new RTCPeerConnection(invitation.ice);await probe.setRemoteDescription(invitation.sdp);}
    catch {
      if(validationEpoch!==clientReplyEpoch)return;
      const message='This invite contains an invalid connection description. Ask the host for a fresh invite.';
      pairingFeedback('client',message);$('#clientPairStatus').textContent=message;button.disabled=false;return;
    } finally {probe?.close();}
  }
  if(validationEpoch!==clientReplyEpoch)return;
  if(!sessionInvites.preparingReply)sessionInvites.leaveGuest();
  lastReply = null; $('#clientReply').value = ''; $('#downloadReply').disabled = true;
  let replyEpoch=clientReplyEpoch;
  try {
    enabled = false; controllerUI(false);
    disconnectClient('Preparing connection reply…',{preserveCameraPreview:!clientCamera.ready});
    pairingUI('client','generating');
    replyEpoch=clientReplyEpoch;button.disabled=true;
    assignedSlot = invitation.slot;assignedSlots=invitation.slot?[invitation.slot]:[]; $('#clientSlot').textContent = assignedSlot?.toUpperCase() || 'Waiting for host';
    $('#clientDisconnect').disabled = false;
    $('#clientPairStatus').textContent = 'Making your reply. This can take a few seconds…';
    const reply=await negotiateClient(invitation);
    if(replyEpoch!==clientReplyEpoch)return;
    lastReply=reply;
    if (invitation.fallback) { fallbackSession = invitation; connectFallback(invitation); }
    $('#clientReply').value = JSON.stringify(lastReply, null, 2); $('#downloadReply').disabled = false;$('#copyReply').disabled=false;
    pairingUI('client', 'ready'); $('#clientPairStatus').textContent = 'Save your reply file and send it back to your friend. Keep this page open.';
    tutorialEvent('client-reply-ready');
    if(!sessionInvites.preparingReply && $('#clientPairing').dataset.transfer!=='text'){autoDownloadPairing($('#downloadReply'));$('#clientPairStatus').textContent='Reply download started. Send the file back to your friend and keep this page open.';}
    else if(!sessionInvites.preparingReply){$('#clientReply').closest('details').open=true;$('#clientPairStatus').textContent='Copy your reply text and send it back to the host. Keep this page open.';}
  } catch (error) { if(replyEpoch===clientReplyEpoch){$('#clientPairStatus').textContent = error.message;pairingFeedback('client',error.message); disconnectClient(error.message);pairingUI('client','error');} }
  finally { if(replyEpoch===clientReplyEpoch){button.disabled = false; if (!lastReply) pairingUI('client', 'error');} }
};
$('#downloadReply').onclick = () => { if (lastReply) downloadPairing(lastReply); };
$('#clientEnablePad').onclick = () => {
  setControllerSharing(!enabled);
  tutorialEvent(enabled && (!dynamicMode() || assignedSlots.length) ? 'client-controller-enabled' : 'client-controls-ready');
};
function setControllerSharing(value){
  if(value && reverseControllers?.nativeActive()){toast('Turn off native controller receiving, or choose App-only, before sharing controllers back.');value=false;}
  $('#clientJoinControllers').checked=value;enabled=value && canUseClientInputs();
  if(dynamicMode())rememberControllerButtons();
  nativeGuest.controllerSharingChanged();
  if(!value){releaseClient();stopInputVideoClock();}else if(enabled)startInputVideoClock();
  controllerUI(enabled);clientStatus(value?'Controller sharing on':'Controller sharing off · local input released');refreshGamepads();updateDesktopMouse();
}
$('#backgroundGamepad').onchange = () => {
  backgroundGamepadPreference=$('#backgroundGamepad').checked;
  try{localStorage.setItem('webrtc-pad:backgroundGamepad',String(backgroundGamepadPreference));}catch{/* Keep this visit's preference. */}
  releaseClient(); stopInputVideoClock(); if (enabled) startInputVideoClock();
};
$('#clientReceiveVideo').onchange = () => {
  const active = $('#clientReceiveVideo').checked;
  if(!active)guestTiles.setLayout('single');
  $('#clientMediaToggle').textContent = active ? 'Stream on' : 'Stream off';
  $('#clientMediaToggle').setAttribute('aria-pressed', String(active));
  if (clientPeer?.control?.readyState === 'open') clientPeer.control.send(JSON.stringify({ type: 'media-subscription', enabled: active }));
  if (!active && clientPeer) { exitPopout();clientPeer.cancelVideoHandover?.();clientPeer.retiredPC?.close();clientPeer.retiredPC=null;clientPeer.hybridAudioPC?.close();clientPeer.hybridAudioPC=null;clientPeer.hybridAudio=null; clientPeer.nativePC?.close(); clientPeer.nativePC = null; clientPeer.stream = new MediaStream();clientPeer.playback.bind(clientPeer.stream); $('#clientVideo').srcObject = null; playerVideoUI(false); }
  soundUI($('#clientVideo').muted);
  updateVideoRefresh();
  if (!active) releaseDesktopClient();
  $('#clientVideoStats').textContent = active ? 'Waiting for video' : 'Controller only · video off';
  updateDesktopMouse();
  if (enabled) startInputVideoClock();
};
$('#clientMediaToggle').onclick = () => { $('#clientReceiveVideo').checked = !$('#clientReceiveVideo').checked; $('#clientReceiveVideo').dispatchEvent(new Event('change')); };
$('#clientVideoToggle').onchange = e => { $('#clientVideo').hidden = !e.target.checked; if (e.target.checked) $('#clientVideo').play().catch(() => {}); else { guestTiles.setLayout('single');exitPopout(); $('#clientVideo').pause(); } clientPeer?.playback?.refresh();updatePopout(); };
$('#clientUnmute').onclick = () => {
  if(!$('#clientAudio').playbackBlocked)$('#clientVideo').muted = !$('#clientVideo').muted;
  writePreference('sharedSound',!$('#clientVideo').muted);soundUI($('#clientVideo').muted);clientPeer?.playback?.play();
};
$('#clientReleaseInputs').onclick=()=>{
  setControllerSharing(false);
  $('#clientDesktopMouse').checked=false;$('#clientDesktopTyping').checked=false;
  controllerUI(false);updateDesktopMouse();clientStatus('All input paused. Resume controllers or enable mouse and typing to continue.');
};
let videoRefreshTimer,videoRefreshUntil=0;
function updateVideoRefresh(){
  const busy=performance.now()<videoRefreshUntil,button=$('#clientRefreshVideo');
  const kind=clientPeer?.mediaKind || ($('#clientVideo').dataset.audioOnly==='true' && clientPeer?.hybridAudioPC?'audio':null);
  button.hidden=!$('#clientReceiveVideo').checked || !kind && !busy;
  button.disabled=busy || !kind || !$('#clientReceiveVideo').checked || clientPeer.pc.connectionState!=='connected' || clientPeer.control?.readyState!=='open';
  button.textContent=busy?'Refreshing…':$('#clientVideo').dataset.audioOnly==='true'?'Refresh audio':'Refresh picture';
}
$('#clientRefreshVideo').onclick=()=>{
  const p=clientPeer,kind=p?.mediaKind || ($('#clientVideo').dataset.audioOnly==='true' && p?.hybridAudioPC?'audio':null);
  if(!kind || p.control?.readyState!=='open' || !$('#clientReceiveVideo').checked || performance.now()<videoRefreshUntil)return;
  p.control.send(JSON.stringify({type:kind==='audio'?'audio-restart':kind==='native'?'native-restart':'browser-restart'}));
  videoRefreshUntil=performance.now()+3000;updateVideoRefresh();clearTimeout(videoRefreshTimer);
  videoRefreshTimer=setTimeout(updateVideoRefresh,3000);
};
fullscreenToolbar($('#clientStage'),$('#clientToolbar'));
function exitPopout() {
  if (document.pictureInPictureElement === $('#clientVideo')) return document.exitPictureInPicture().catch(() => {});
}
function exitClientFullscreen(){
  if([$('#clientStage'),$('#clientVideo')].includes(document.fullscreenElement))return document.exitFullscreen().catch(()=>{});
}
function updatePopout() {
  const video = $('#clientVideo'), button = $('#clientPopout');
  const active = document.pictureInPictureElement === video;
  const supported = !!document.pictureInPictureEnabled && typeof video.requestPictureInPicture === 'function';
  button.disabled = !active && (!supported || !video.srcObject || video.readyState < 2 || !video.videoWidth || video.hidden);
  button.title = !supported ? 'Use desktop Chrome or Edge for pop-out video' : 'Watch in a floating Picture-in-Picture window';
  button.setAttribute('aria-label', active ? 'Close pop-out video' : 'Pop out video');
  button.setAttribute('aria-pressed', String(active)); button.classList.toggle('active', active);
  $('#clientPopout .popout-label').textContent = active ? 'Bring back' : 'Pop out';
}
$('#clientPopout').onclick = async () => {
  try {
    if (document.pictureInPictureElement === $('#clientVideo')) await document.exitPictureInPicture();
    else await $('#clientVideo').requestPictureInPicture();
  } catch { toast('Pop-out video is unavailable. Try desktop Chrome or Edge with the stream playing.'); }
  updatePopout();
};
for (const event of ['loadeddata', 'emptied', 'resize', 'enterpictureinpicture', 'leavepictureinpicture']) {
  $('#clientVideo').addEventListener(event, () => {
    if(event==='loadeddata' && $('#clientVideo').readyState>=2)guestTiles.finishSwitch();
    updatePopout(); updateDesktopMouse();
    if (event === 'enterpictureinpicture' || event === 'loadeddata') startInputVideoClock();
    if (event === 'leavepictureinpicture' || event === 'emptied') { stopInputVideoClock(); if (enabled) startInputVideoClock(); }
    if (event === 'leavepictureinpicture' && (document.hidden || !document.hasFocus())) releaseClient();
  });
}
updatePopout();
$('#clientFullscreen').onclick = async () => {
  try {
    const video = $('#clientVideo');
    if (document.fullscreenElement) await document.exitFullscreen();
    else if ($('#clientStage').requestFullscreen) await $('#clientStage').requestFullscreen();
    else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();
    else toast('Use your browser’s fullscreen control.');
  } catch { toast('Click the video and try fullscreen again.'); }
};
$('#clientVideo').addEventListener('dblclick', e => { if ($('#clientDesktopMouse').checked) return; e.preventDefault(); $('#clientFullscreen').click(); });
document.addEventListener('fullscreenchange', () => {
  const fullscreen = document.fullscreenElement === $('#clientStage') || document.fullscreenElement === $('#clientVideo');
  $('#clientFullscreen').setAttribute('aria-pressed', String(fullscreen));
  $('#clientFullscreen').setAttribute('aria-label', fullscreen ? 'Exit fullscreen' : 'Fullscreen video');
  $('#clientFullscreen .fullscreen-label').textContent = fullscreen ? 'Exit fullscreen' : 'Fullscreen';
});
function inputGamepads(){return nativeGuest.latched && !nativeGuest.browserFallback?nativeGuest.pads:navigator.getGamepads?.() || [];}
function nativeSession(){
  const p=clientPeer;
  return {controllersEnabled:$('#clientJoinControllers')?.checked!==false,hosting:!!hostRoom || hostWs?.starting===true,connected:!!p && p.pc.connectionState==='connected' && p.control?.readyState==='open' && p.channel?.readyState==='open' && Number.isFinite(p.nativePongAt) && performance.now()-p.nativePongAt<2200,canPlay:canUseClientInputs(),enabled,dynamic:dynamicMode(),mouseAllowed:!chatting() && !guestTiles.viewOnly && !guestTiles.switching && p?.desktopMouse===true && !!p.desktopSize,keyboardAllowed:p?.allowKeyboard!==false,typingAllowed:!chatting() && !guestTiles.viewOnly && !guestTiles.switching && p?.desktopKeyboard===true};
}
const nativeGuest=new NativeGuestInput({
  session:nativeSession,
  onViewChange:renderConnectedControllers,
  probe(){const p=clientPeer;if(p?.control?.readyState==='open' && (!p.nativePing || performance.now()-p.nativePing.at>1000)){p.nativePing={id:'native-'+crypto.randomUUID(),at:performance.now()};p.control.send(JSON.stringify({type:'ping',id:p.nativePing.id}));}},
  onPrepare({reconfigure=false,devices=[]}={}){
    releaseClient();enabled=true;$('#backgroundGamepad').checked=true;controllerUI(true);startInputVideoClock();
    if(reconfigure){
      const pads=devices.filter(id=>id.startsWith('pad:'));
      for(let i=joinedControllers.length-1;i>=0;i--){const entry=joinedControllers[i],index=pads.indexOf(entry.id.split(' · ')[0]);if(entry.source==='gamepad' && index>=0)entry.index=index;else if(entry.source==='gamepad')joinedControllers.splice(i,1);}
      selectedIndex=joinedControllers[0]?.index ?? 0;extraPadIndices.splice(0,extraPadIndices.length,...joinedControllers.slice(1).map(entry=>entry.index));
    }else joinedControllers.length=0;
    buttonSnapshots.clear();requestClientControllers();refreshGamepads();
  },
  onActive(devices,keyboardMode){
    enabled=true;$('#backgroundGamepad').checked=true;
    if(devices.some(id=>id.startsWith('keyboard:'))){if(keyboardMode==='gamepad')$('#joinKeyboardController').click();else $('#clientDesktopTyping').checked=true;}
    if(devices.some(id=>id.startsWith('mouse:')))$('#clientDesktopMouse').checked=true;
    controllerUI(true);updateDesktopMouse();startInputVideoClock();refreshGamepads();
  },
  onState(value){
    keys.clear();desktopKeys.clear();for(const code of value.keys || [])if(desktopCodes.has(code)){keys.add(code);desktopKeys.add(code);}
    if(nativeGuest.selection.some(id=>id.startsWith('mouse:')) && clientPeer?.desktopSize){
      desktopButtons.clear();for(const button of value.mouse.buttons || [])if([0,1,2].includes(button))desktopButtons.add(button);
      const size=clientPeer.desktopSize,old=desktopPosition || {x:.5,y:.5};desktopPosition=value.mouse.absolute?{x:value.mouse.x,y:value.mouse.y}:{x:Math.max(0,Math.min(1,old.x+value.mouse.dx/size.width)),y:Math.max(0,Math.min(1,old.y+value.mouse.dy/size.height))};desktopPositionDirty=true;
      if(value.mouse.wheelX || value.mouse.wheelY)sendDesktopEvent({event:'wheel',dx:Math.max(-1200,Math.min(1200,value.mouse.wheelX)),dy:Math.max(-1200,Math.min(1200,value.mouse.wheelY))});pointerPosition={...desktopPosition};pointerButtons.clear();for(const button of desktopButtons)pointerButtons.add(button);publishCursor(true,true);
    }
    sendInputs();sendDesktopSnapshot();
    if(desktopTyping())for(const code of value.repeats || [])if(desktopCodes.has(code))sendDesktopEvent({event:'repeat',code});
  },
  onRelease(){enabled=false;$('#backgroundGamepad').checked=backgroundGamepadPreference;releaseClient();stopInputVideoClock();$('#clientDesktopMouse').checked=false;$('#clientDesktopTyping').checked=false;controllerUI(false);updateDesktopMouse();},
  onBrowser(){$('#backgroundGamepad').checked=backgroundGamepadPreference;releaseClient();joinedControllers.length=0;buttonSnapshots.clear();enabled=$('#clientJoinControllers')?.checked!==false && canUseClientInputs();controllerUI(enabled);if(enabled)startInputVideoClock();requestClientControllers();refreshGamepads();},
  onPreference(){releaseClient();joinedControllers.length=0;buttonSnapshots.clear();requestClientControllers();refreshGamepads();updateDesktopMouse();}
});
function participantMediaControls(side,owner){
  const cam=side==='host'?hostCamera:clientCamera,voice=side==='host'?hostVoice:clientVoice,self=owner===cam.self,hidden=cam.localHidden.has(owner),muted=voice.localMuted.has(owner),member=cam.roster.find(m=>m.id===owner),talker=voice.roster.find(m=>m.id===owner),on=self?!!cam.stream:member?.camera===true && !hidden;
  return {camera:{on,enabled:self?!cam.busy && !cam.handoffLocked && (!!cam.stream || cam.canShare()):member?.camera===true || hidden,label:self?on?'Turn off my camera':'Turn on my camera':member?.camera || hidden?`${hidden?'Show':'Hide'} camera for me`:'Camera is off',toggle:()=>self?$(`#${side}CallCamera`).click():cam.setLocalHidden(owner,!hidden)},mic:{on:self?!!voice.mic && !voice.muted && voice.canSpeak():talker?.mic===true && !muted,enabled:self?!voice.busy && !voice.micBusy && voice.canSpeak():talker?.mic===true || muted,label:self?voice.mic && !voice.muted?'Mute my microphone':'Turn on my microphone':talker?.mic || muted?`${muted?'Unmute':'Mute'} microphone for me`:'Microphone is off',toggle:()=>self?$(`#${side}CallMic`).click():voice.setLocalMuted(owner,!muted)}};
}
function canBecomeHost(){return !!localHostPlatform && !hostRoom && !hostWs?.starting;}
function swapVoiceRoles(active){
  const hostRoot=hostVoice.root,clientRoot=clientVoice.root,marker=document.createTextNode('');
  hostRoot.before(marker);clientRoot.replaceWith(hostRoot);marker.replaceWith(clientRoot);
  hostRoot.id='clientVoice';clientRoot.id='hostVoice';[hostVoice,clientVoice]=[clientVoice,hostVoice];
  hostVoice.host=true;clientVoice.host=false;$('#hostAllowGuestMic').checked=hostVoice.guestMicAllowed!==false;
  const idle=active===hostVoice?clientVoice:hostVoice;
  idle.setReady(false);idle.controls.clear();idle.members.clear();idle.roster=[];idle.sendControl=null;idle.self=idle.host?'host':null;idle.render();
  hostVoice.getIce=()=>fetchIce(hostRoom?.roomId);clientVoice.getIce=async()=>clientPeer?.pc.getConfiguration() || {iceServers:[]};
  hostVoice.onChange=voiceCaptureNote;clientVoice.onChange=null;
}
function swapCameraRoles(active){
  const hostRoot=hostCamera.root,clientRoot=clientCamera.root,marker=document.createTextNode('');hostRoot.before(marker);clientRoot.replaceWith(hostRoot);marker.replaceWith(clientRoot);hostRoot.id='clientCamera';clientRoot.id='hostCamera';[hostCamera,clientCamera]=[clientCamera,hostCamera];
  hostCamera.host=true;clientCamera.host=false;$('#hostAllowGuestVideo').checked=hostCamera.guestVideoAllowed!==false;
  for(const [room,side] of [[hostCamera,'host'],[clientCamera,'client']]){room.stage=$(`#${side}Stage`);room.home.remove();room.stage.after(room.home);room.home.after(room.gallery);}
  const idle=active===hostCamera?clientCamera:hostCamera;idle.setReady(false);idle.sendControl=null;idle.self=idle.host?'host':null;
  hostCamera.getIce=()=>fetchIce(hostRoom?.roomId);clientCamera.getIce=async()=>clientPeer?.pc.getConfiguration() || {iceServers:[]};hostCamera.pressure=id=>{const p=hostPeers.get(id);return performance.now()-(p?.cameraPressureAt || 0)<5000?p?.cameraPressure:null;};clientCamera.pressure=()=>performance.now()-(clientPeer?.cameraPressureAt || 0)<5000?clientPeer?.cameraPressure:null;
  hostCamera.receivePressure=()=>({});clientCamera.receivePressure=()=>clientCamera.pressure();hostCamera.changed=()=>{};clientCamera.changed=sources=>guestTiles.setCameras(sources);guestTiles.setCameras(clientCamera.sources());
}
function swapScreenRoles(active){
  const hostRoot=hostScreens.root,clientRoot=clientScreens.root,marker=document.createTextNode('');hostRoot.before(marker);clientRoot.replaceWith(hostRoot);marker.replaceWith(clientRoot);hostRoot.id='clientScreens';clientRoot.id='hostScreens';[hostScreens,clientScreens]=[clientScreens,hostScreens];hostScreens.host=true;clientScreens.host=false;
  for(const [room,side] of [[hostScreens,'host'],[clientScreens,'client']]){room.stage=$(`#${side}Stage`);room.home.remove();room.stage.after(room.home);room.home.after(room.gallery);}
  const idle=active===hostScreens?clientScreens:hostScreens;idle.setReady(false);idle.sendControl=null;idle.self=idle.host?'host':null;
  hostScreens.getIce=()=>fetchIce(hostRoom?.roomId);clientScreens.getIce=async()=>clientPeer?.pc.getConfiguration() || {iceServers:[]};hostScreens.pressure=id=>hostCamera.pressure(id);clientScreens.pressure=()=>clientCamera.pressure();clientScreens.receivePressure=()=>clientCamera.receivePressure();
}
function swapChatRoles(active){
  const hostRoot=hostChat.root,clientRoot=clientChat.root,marker=document.createTextNode('');hostRoot.before(marker);clientRoot.replaceWith(hostRoot);marker.replaceWith(clientRoot);hostRoot.id='clientChat';clientRoot.id='hostChat';[hostChat,clientChat]=[clientChat,hostChat];hostChat.host=true;clientChat.host=false;hostChat.files.host=true;clientChat.files.host=false;$('#hostAllowFiles').checked=true;$('#hostAllowClipboard').checked=false;
  const idle=active===hostChat?clientChat:hostChat;idle.setReady(false);filePriorities();
}
function clearOldPairing(){
  clearTimeout(fallbackReconnectTimer);fallbackSession=null;fallbackReady=false;
  const socket=fallbackWs;fallbackWs=null;socket?.close();
  fallbackSession=null;lastReply=null;$('#clientReply').value='';$('#downloadReply').disabled=true;$('#copyReply').disabled=true;
  lastInvitation=null;invitations.clear();$('#hostInvitation').value='';$('#downloadInvitation').disabled=true;$('#copyInvitation').disabled=true;
  $('#clientInvitation').value='';$('#hostReply').value='';
  sessionInvites.leaveGuest();sessionGuestPeers.clear();
}
function resetHandoffDesktop(){
  clearPreparedDesktop();hostOverlayActive=false;hostOverlayPending=null;
  hostDesktopPolicy={desktopMouse:false,desktopKeyboard:false,desktopFullAccess:false};desktopPolicyPending=false;
  $('#clientDesktopMouse').checked=false;$('#clientDesktopTyping').checked=false;
  hostCursors.clear();guestCursors.clear();desktopAvailability();
}
const handoff=new HostHandoff({
  isHost:()=>!!hostRoom && !$('#hostPanel').hidden,
  canHost:canBecomeHost,
  confirm:()=>confirm('Become the host? The current game share will stop. Your voice and cameras stay connected. Choose your game window after switching; desktop control starts off.'),
  upstream:()=>clientPeer?.control,
  links:()=>new Map([...hostPeers].filter(([,p])=>p.pc.connectionState==='connected' && p.control?.readyState==='open').map(([id,p])=>[id,p.control])),
  members:()=>[{id:'host',wantsController:true,canHost:!!localHostPlatform},...[...hostPeers].filter(([,p])=>p.pc.connectionState==='connected' && p.control?.readyState==='open').map(([id,p])=>({id,wantsController:p.wantsController,canHost:p.canHost===true,name:p.sessionName}))],
  snapshot:()=>({host:!!hostRoom && !$('#hostPanel').hidden,voice:!$('#hostPanel').hidden?hostVoice:clientVoice,camera:!$('#hostPanel').hidden?hostCamera:clientCamera,screen:!$('#hostPanel').hidden?hostScreens:clientScreens,chat:!$('#hostPanel').hidden?hostChat:clientChat,peers:new Map(hostPeers),client:clientPeer,ws:hostWs}),
  voiceRoster:()=>hostVoice.roster.map(member=>({...member})),
  cameraRoster:()=>hostCamera.roster.map(member=>({...member})),
  screenRoster:()=>hostScreens.roster.map(member=>({...member})),
  screenPolicy:()=>({allowed:hostScreens.guestVideoAllowed,limit:hostScreens.sessionLimit,blocks:[...hostScreens.cameraBlocks],limits:[...hostScreens.memberLimits]}),
  chatSnapshot:()=>hostChat.snapshot(),
  moderationSnapshot:()=>participants?.snapshot(),
  status:(message,cancellable)=>{const notice=$('#handoffNotice');notice.hidden=false;$('#handoffStatus').textContent=message;$('#handoffCancel').hidden=!cancellable;const switching=handoff.state?.phase==='committing';$('#hostEnd').disabled=switching || !hostRoom;$('#clientDisconnect').disabled=switching || !clientPeer;},
  lock:locked=>{
    if(locked)keyboardMapping.dialog.close();
    sessionInvites.handoffActive=locked;document.body.dataset.handoff=String(locked);
    for(const room of [hostChat,clientChat]){room.locked=locked;room.renderState();}
    for(const voice of [hostVoice,clientVoice,hostCamera,clientCamera,hostScreens,clientScreens]){voice.handoffLocked=locked;voice.render();}
    $('#modeHost').disabled=locked;$('#modeClient').disabled=locked;
    $('#createInvitation').disabled=locked || !hostRoom;$('#hostCreate').disabled=locked || !!hostRoom;
    $('#createReply').disabled=locked;renderPeers();
  },
  async prepare(s){
    if(!canBecomeHost())throw Error('Run the local app on the new host and end any other hosted session first.');
    clearPreparedDesktop();hostOverlayActive=false;hostOverlayPending=null;s.preparingRoom=true;await stopCapture();$('#hostAudioOnly').checked=false;
    if(handoff.state!==s)return;
    await connectHost();s.preparedWs=hostWs;
    await waitFor(()=>{if(s.preparedWs?.lastError || s.preparedWs?.readyState===WebSocket.CLOSED)throw Error(s.preparedWs.lastError || 'The local host could not start');return !!hostRoom && injectWs?.readyState===WebSocket.OPEN;},'The local host could not start');
    if(handoff.state!==s){await this.rollback(s);return;}
    if(!hostRoom.driver?.ready && s.members.some(m=>m.wantsController))throw Error('The new host needs its controller driver. Open Settings & troubleshooting to finish setup, then try Make host again.');
    s.ice=await fetchIce(hostRoom.roomId);
  },
  async register(member,s){
    const registered=await registerManualPeer(member.wantsController?'play':'watch');
    return {peerId:registered.peerId,slot:registered.slot,wantsController:registered.wantsController,ice:s.ice,name:member.name,canHost:member.canHost};
  },
  async commit(s,roster,cameras=[],chat,moderation,screens=[],screenPolicy){
    clearOldPairing();resetHandoffDesktop();
    if(s.promoted){
      await exitPopout();await exitClientFullscreen();
      closeClientPeer({preserveVoice:true,keepTransport:true});enabled=false;joinedControllers.length=0;buttonSnapshots.clear();
      assignedSlot=null;assignedSlots=[];controllerGeneration=0;controllerReceipts.length=0;
      swapVoiceRoles(s.old.voice);swapCameraRoles(s.old.camera);swapScreenRoles(s.old.screen);swapChatRoles(s.old.chat);
      const controls=new Map([...s.stages.values()].map(stage=>[stage.info.peerId,voiceSend(stage.transport.channels.get('control'))]));
      hostVoice.rebase({host:true,mapping:s.mapping,roster,controls});hostCamera.rebase({host:true,mapping:s.mapping,roster:cameras,controls});hostScreens.rebase({host:true,mapping:s.mapping,roster:screens,controls});hostScreens.setGuestVideoAllowed(screenPolicy?.allowed!==false);$('#hostAllowGuestScreens').checked=screenPolicy?.allowed!==false;hostScreens.cameraBlocks=new Set((Array.isArray(screenPolicy?.blocks)?screenPolicy.blocks:[]).slice(0,256).filter(id=>s.mapping[id] && s.mapping[id]!=='host').map(id=>s.mapping[id]));hostScreens.setLimits(screenPolicy?.limit,new Map((Array.isArray(screenPolicy?.limits)?screenPolicy.limits:[]).slice(0,256).filter(entry=>Array.isArray(entry) && s.mapping[entry[0]]).map(([id,value])=>[s.mapping[id],value])));hostChat.rebase({host:true,mapping:s.mapping,snapshot:chat,stage:$('#hostStage')});
      for(const stage of s.stages.values()){
        const p=await makeHostPeer(stage.info.peerId,stage.info.slot,true,stage.info.ice,stage.info,stage.transport);
        p.canHost=stage.info.canHost;p.sessionName=stage.info.name;
      }
      participants?.rebase(moderation,s.mapping);hostSessionUI(true);hostShares.setActive(true);showPanel('host');$('#hostLiveSource').open=true;renderPeers();
    }else{
      if(s.old.host){
        await stopCapture();
        send(hostWs,{type:'input-policy',allowKeyboard:keyboardAllowed,desktopMouse:false,desktopKeyboard:false,desktopFullAccess:false});
        send(hostWs,{type:'cursor-overlay',enabled:false});
        for(const [id,p] of hostPeers){hostViewPopouts.closePeer(p);stopPeerVideo(p);releasePeer(id);for(const key of ['recovery','expiryTimer','updateTimeout','fallbackTimer','nativeTimeout'])clearTimeout(p[key]);hostDiagnostics.removeSource(id);}
        hostPeers.clear();hostWs=null;hostRoom=null;clearTimeout(injectReconnect);const socket=injectWs;injectWs=null;socket?.close();
        for(const request of nativeRequests.values()){clearTimeout(request.timer);request.reject(Error('Host switched'));}nativeRequests.clear();
        hostSessionUI(false);hostShares.setActive(false);swapVoiceRoles(s.old.voice);swapCameraRoles(s.old.camera);swapScreenRoles(s.old.screen);swapChatRoles(s.old.chat);joinedControllers.length=0;buttonSnapshots.clear();enabled=false;
      }
      assignedSlot=null;assignedSlots=[];controllerGeneration=0;controllerReceipts.length=0;hostControllerCapacity=null;
      const stage=s.client;await stage.transport.ready();
      // Rebase before adopting buffered messages; the new game channels do not
      // send voice hello until everyone has completed the switch.
      clientVoice.rebase({host:false,mapping:s.mapping,roster,send:voiceSend(stage.transport.channels.get('control'))});clientCamera.rebase({host:false,mapping:s.mapping,roster:cameras,send:voiceSend(stage.transport.channels.get('control'))});clientScreens.rebase({host:false,mapping:s.mapping,roster:screens,send:voiceSend(stage.transport.channels.get('control'))});clientChat.rebase({host:false,mapping:s.mapping,snapshot:chat,stage:$('#clientStage')});
      await negotiateClient(stage.info,stage.transport);
      $('#clientDisconnect').disabled=false;$('#clientUnmute').disabled=false;showPanel('client');
    }
    desktopAvailability();document.dispatchEvent(new Event('mobile-layout'));
  },
  finalize(s){
    if(s.old.host){sessionInvites.endHosting();send(s.old.ws,{type:'end'});s.old.ws?.close();for(const p of s.old.peers.values())p.pc.close();}
    else s.old.client?.pc.close();
    if(s.promoted){for(const p of hostPeers.values())p.handoff=false;hostVoice.broadcast();hostCamera.announce();hostScreens.announce();sessionInvites.hostStarted();hostStatus('You are hosting. Choose a window or screen, or play with controllers only.');}
    else{if(clientPeer)clientPeer.handoff=false;clientVoice.sendControl?.({type:'voice',action:'hello'});if(clientVoice.active)clientVoice.announce();else clientVoice.sendControl?.({type:'voice',action:'leave',session:clientVoice.session});clientCamera.announce();clientScreens.announce();clientStatus('Connected to the new host');}
    renderPeers();tutorialEvent('refresh');
  },
  async rollback(s){
    if(!s.promoted || !s.preparingRoom)return;
    if(s.preparedWs && hostWs===s.preparedWs){send(hostWs,{type:'end'});hostWs.close();}
    $('#hostCreate').disabled=false;
  },
  interrupted(s){
    if(s.applied)this.finalize(s);
    else if(s.promoted){send(hostWs,{type:'end'});hostWs?.close();}
    else if(s.old.host){send(s.old.ws,{type:'end'});s.old.ws?.close();}
  }
});
$('#handoffCancel').onclick=()=>handoff.cancel();
const keyboardMapping=new KeyboardMapping($('#keyboardMapping'),{
  release:()=>{
    const needsLocalDevices=nativeGuest.selection.some(id=>id.startsWith('keyboard:') || id.startsWith('mouse:'));
    if(nativeGuest.switching || nativeGuest.active && needsLocalDevices)nativeGuest.stop('Keyboard/mouse devices released to edit controls. Re-enable exclusive sharing when ready.');
    // Native controller-only capture can keep its device lock while the dialog
    // previews input. Remote snapshots stay paused until the dialog closes.
    if(!nativeGuest.active)nativeGuest.latched=false;
    releaseClient();
  },
  getPads:inputGamepads,profileFor,
  nativeActive:()=>nativeGuest.latched,
  afterClose:rememberControllerButtons,
  defaultDevice:()=>hasKeyboardController()?'keyboard':selectedIndex ?? [...inputGamepads()].find(p=>p && p.connected!==false)?.index ?? 'keyboard',
  saveProfile:(gp,profile)=>{sessionProfiles.set(gp.id,profile);let saved=true;try{localStorage.setItem(storageKey(gp),JSON.stringify(profile));}catch{saved=false;}refreshGamepads();return saved;},
  changed:bindings=>{
  const help=$('#keyboardHelp');help.replaceChildren();
  const note=document.createElement('p');note.textContent='Click the picture to play. Keys release when you switch windows.';help.append(note);
  for(const key of ['a','b','x','y','start','up','lxPositive'])if(bindings[key]){
    const line=document.createElement('p'),kbd=document.createElement('kbd');kbd.className='wp-kbd';kbd.textContent=keyName(bindings[key]);
    line.append(kbd,document.createTextNode(' '+(buttonLabels[key] || 'Left stick right')));help.append(line);
  }
}});
for(const id of ['clientResolution','clientMinimumResolution','clientFramerate','clientCodec','clientAutoThrottle']){const el=$(`#${id}`),saved=readPreference(id);if(el.type==='checkbox'){if(typeof saved==='boolean')el.checked=saved;}else if(typeof saved==='string' && [...el.options].some(o=>o.value===saved && !o.disabled))el.value=saved;el.addEventListener('change',()=>writePreference(id,el.type==='checkbox'?el.checked:el.value));}
const guestView=new GuestViewCheck({peers:()=>hostPeers,notify:toast});
sessionPresets({root:$('#hostSourceSetup'),busy:()=>!!hostRoom || captureBusy || !!captureStream || nativeCapture || nativeAudioBusy || nativeAudioReady,source:()=>({method:$('#captureBackend').value,label:$('#captureTarget').selectedOptions[0]?.textContent || '',audioLabel:$('#nativeAudioTarget').selectedOptions[0]?.textContent || ''}),changed:()=>{lastSharePending=false;rememberedBrowserShare=false;selectedSource='none';captureArea.value=null;captureArea.render();lastSourceNote.hidden=true;renderCaptureSources();changeStreamQuality();rememberHostSetup();},restore:async source=>{if(!source)throw Error('This preset has no saved source. Choose a screen or window.');if(source.method==='browser'){$('#captureBackend').value='browser';renderCaptureSources();$('#chooseBrowserSource').click();return;}if(!nativeCaptureAvailable)throw Error('Native capture is unavailable on this computer. Use browser sharing.');$('#captureBackend').value='native';await refreshCaptureTargets();const target=captureSourceTargets.find(t=>t.label===source.label);if(!target)throw Error('Saved window is unavailable. Open it or choose a different source.');const audio=[...$('#nativeAudioTarget').options].find(o=>o.textContent===source.audioLabel);if(audio)$('#nativeAudioTarget').value=audio.value;$('#captureTarget').value=target.id;await $('#captureTarget').onchange();}});
async function sendGuestView(p,message){
  if(clientPeer!==p || typeof message.request!=='string' || !/^[a-zA-Z0-9-]{1,64}$/.test(message.request) || performance.now()-(p.guestViewAt ?? -Infinity)<1500 || p.control?.readyState!=='open' || p.control.bufferedAmount>8192)return;
  p.guestViewAt=performance.now();const video=$('#clientVideo'),audio=$('#clientAudio');let image=null,audioStats=null,metrics=p.lastVideoMetrics || {};
  // Only our host's received game video can be returned, never a local camera or desktop.
  if(video.readyState>=2 && video.videoWidth && $('#clientReceiveVideo').checked && $('#clientVideoToggle').checked && p.pc.connectionState==='connected')try{
    const canvas=document.createElement('canvas');canvas.width=240;canvas.height=Math.max(1,Math.min(240,Math.round(240*video.videoHeight/video.videoWidth)));canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);const data=canvas.toDataURL('image/jpeg',.45);if(data.length<14000)image=data;
  }catch{/* A paused or unavailable picture still returns useful status. */}
  try{const videoPC=p.nativePC || p.pc;const stats=await videoPC.getStats();metrics=receivedVideoStats(stats,p.videoSample,video) || metrics;const soundStats=p.hybridAudioPC?await p.hybridAudioPC.getStats():stats;audioStats=[...soundStats.values()].find(r=>r.type==='inbound-rtp' && r.kind==='audio' && !r.isRemote);}catch{}
  if(clientPeer!==p || p.control?.readyState!=='open' || p.control.bufferedAmount>8192)return;
  const packets=(audioStats?.packetsReceived || 0)+Math.max(0,audioStats?.packetsLost || 0);
  p.control.send(JSON.stringify({type:'guest-view',request:message.request,image,metrics:{...metrics,width:video.videoWidth,height:video.videoHeight},audio:{receiving:!!audio.srcObject?.getAudioTracks().some(t=>t.readyState==='live' && !t.muted),muted:audio.muted || audio.volume===0,blocked:audio.paused,loss:packets?Math.max(0,audioStats.packetsLost || 0)/packets:null,jitterMs:typeof audioStats?.jitter==='number'?audioStats.jitter*1000:null}}));
  toast('Host checked the received game picture and sound.');
}
initUI(); refreshGamepads(); renderPeers();const callShell=initCallShell({screens:side=>side==='host'?hostScreens:clientScreens,voice:side=>side==='host'?hostVoice:clientVoice,camera:side=>side==='host'?hostCamera:clientCamera,chat:side=>side==='host'?hostChat:clientChat,notify:toast});
inputStreams=new AppInputs({state:()=>({hosting:!!hostRoom && !hostEnding,room:hostRoom,client:clientPeer,sourceId:guestTiles.active?guestTiles.featured:clientPeer?.desktopSourceId || '',sendHost:value=>send(hostWs,value),guestName:id=>hostPeers.get(id)?.sessionName || `Guest ${hostPeers.get(id)?.diagnosticNumber || ''}`}),source:()=>pointerSurface(false),blocked:()=>nativeGuest.latched || chatting(),notify:toast});
$('#clientJoinControllers').onchange=()=>setControllerSharing($('#clientJoinControllers').checked);
reverseControllers=new ReverseControllers({state:()=>({hosting:!!hostRoom && !hostEnding,client:clientPeer}),pads:()=>[...(navigator.getGamepads?.() || [])],pack:gp=>packGamepadState(gp,profileFor(gp),profileFor(gp)?.deadzone ?? Number($('#deadzone').value)),pauseOutgoing:()=>{if($('#clientJoinControllers').checked){$('#clientJoinControllers').checked=false;$('#clientJoinControllers').dispatchEvent(new Event('change',{bubbles:true}));}},notify:toast,hostAPI:packet=>inputStreams.api.publish({peerId:'host',...packet})});
participants=new Participants({screens:side=>side==='host'?hostScreens:clientScreens,state:()=>({hosting:!!hostRoom,peers:hostPeers}),voice:side=>side==='host'?hostVoice:clientVoice,camera:side=>side==='host'?hostCamera:clientCamera});
const screenLayouts=new ScreenLayouts({cursors:hostCursors,nativeCommand,quality:()=>captureQuality,hostShareList:()=>[...(!audioOnly() && hostMediaActive()?[{id:'',label:captureSourceTargets.find(t=>t.id===selectedSource)?.label || 'Main screen'}]:[]),...hostShares.sources.values()],removeShare:id=>id?hostShares.remove(id):stopCapture(),mediaControls:owner=>participantMediaControls('host',owner),hostScreens:()=>hostScreens,clientScreens:()=>clientScreens,hostCamera:()=>hostCamera,clientCamera:()=>clientCamera,guestTiles,hostSources:()=>{
  const sources=[];if(previewWanted()){const stream=nativeCapture?$('#hostPreview').srcObject:captureStream;if(!audioOnly() && stream?.getVideoTracks().length)sources.push({id:'host-main',owner:'host',kind:'screen',label:'Your main screen',stream,viewOnly:true,remove:()=>stopCapture()});for(const source of hostShares.sources.values())sources.push({id:`host-${source.id}`,owner:'host',kind:'screen',label:source.label,...(source.stream?{stream:source.stream}:{}),viewOnly:true,remove:()=>hostShares.remove(source.id)});}return sources;
}});

function prepareGuestMedia(){const preparing=document.body.dataset.mode==='client';clientCamera.setPreparing(preparing);clientVoice.setPreparing(preparing);}
document.addEventListener('app-mode',prepareGuestMedia);prepareGuestMedia();
initCallComfort({
  getState:()=>{const side=document.body.dataset.mode || 'host',picture=side==='host'?!!(nativeCapture || captureStream?.getVideoTracks().some(t=>t.readyState==='live')):$('#clientVideo').videoWidth>0 && !!$('#clientVideo').srcObject;
    const source=captureSourceTargets.find(t=>t.id===selectedSource),systemAudio=$('#nativeCaptureAudio').checked && (source?.kind==='desktop' || captureStream?.getVideoTracks()[0]?.getSettings().displaySurface==='monitor');
    return {side,driver:driverReady,hosting:!!hostRoom,connected:clientPeer?.pc.connectionState==='connected',count:[...(inputGamepads() || [])].filter(Boolean).length,picture,links:document.body.dataset.sessionInvites==='true' && document.body.dataset[side==='host'?'sessionHostFiles':'sessionGuestFiles']!=='true',canPlay:clientPeer?.wantsController!==false,audioOnly:side==='host'?audioOnly():$('#clientVideo').dataset.audioOnly==='true',audio:$('#nativeCaptureAudio').checked && (nativeAudioReady || captureStream?.getAudioTracks().some(t=>t.readyState==='live' && !t.muted)),systemAudio,guests:[...hostPeers.values()].filter(p=>p.pc.connectionState==='connected').length,joined:side==='host'?[...hostPeers.values()].reduce((n,p)=>n+(p.slots?.length || 0),0):assignedSlots.length};
  },voice:side=>side==='host'?hostVoice:clientVoice,showSettings:side=>callShell.open(`${side}Settings`),notify:toast,
  report:(side,topic)=>(side==='host'?hostConnectionReports:clientConnectionReports).download(topic).catch(()=>toast('Could not save diagnostics. Try again.')),
  refreshPicture:()=>$('#clientRefreshVideo').click(),onInputFocus:chatFocus
});

window.addEventListener('pagehide', () => { releaseClient(); hostWs?.close(); injectWs?.close(); captureStream?.getTracks().forEach(t => t.stop()); });
function refreshNetworkRoutes() {
  for (const [id, p] of hostPeers) if (p.manual) (p.pc.connectionState !== 'connected' && p.fallbackReady ? recoverHostPeer(id) : updateManualPeer(p, true)).catch(error => hostStatus(error.message));
  if (clientPeer?.manual && clientPeer.pc.connectionState !== 'connected') requestFallbackRestart();
  if (clientPeer?.manual && clientPeer.control?.readyState === 'open') clientPeer.control.send(JSON.stringify({ type: 'rtc-restart' }));
}
window.addEventListener('online', refreshNetworkRoutes);
navigator.connection?.addEventListener('change', refreshNetworkRoutes);
