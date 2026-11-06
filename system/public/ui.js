import {initMobileNavigation,revealMobileTarget} from './mobile-navigation.js';
import {filePairingBrowserHint} from './pairing.js';
const $ = selector => document.querySelector(selector);
let sessionActive = false, sharing = false, hostPairState = 'idle', playerState = 'idle', hasVideo = false, toastTimer;
let inviteSaved=false, replySaved=false, hostNextTarget='createInvitation';
let clientWasConnected=false;
const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const refreshQuickStart = () => document.dispatchEvent(new CustomEvent('quick-start', {detail:'refresh'}));
export function toast(message) {
  clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 3200);
}
export function pairingFeedback(side, message='', action='file') {
  $(`#${side}PairError`).hidden=!message;
  $(`#${side}PairErrorText`).textContent=message;
  if(message && side==='client')$('#clientPairing').open=true;
  const button=$(`#${side}PairRetry`);button.dataset.action=action;
  button.textContent=action==='invite'?'Create a fresh invite':action==='start'?'Start a session':side==='host'?'Choose a reply file':'Choose an invite file';
}
export function modeUI(mode) {
  document.body.dataset.mode = mode;
  for (const [id, selected] of [['modeHost', mode === 'host'], ['modeClient', mode === 'client']]) {
    $(`#${id}`).setAttribute('aria-selected', String(selected));
    $(`#${id}`).tabIndex = selected ? 0 : -1;
  }
}
function focusSection(selector) {
  const target=$(selector);
  document.dispatchEvent(new CustomEvent('reveal-call-setting',{detail:target}));
  revealMobileTarget(target);
  for(let parent=target?.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;
  target?.scrollIntoView({block:'center',behavior:'smooth'});
  target?.focus({preventScroll:true});
}
function sessionFlowUI() {
  let browserNote=$('#clientFileBrowserNote');
  if(!browserNote){browserNote=document.createElement('p');browserNote.id='clientFileBrowserNote';browserNote.className='notice warning small';browserNote.setAttribute('role','note');$('#clientPairing > summary').after(browserNote);}
  const hostedInvites=document.body.dataset.sessionInvites==='true',files=!hostedInvites || document.body.dataset.sessionGuestFiles==='true';
  browserNote.textContent=filePairingBrowserHint(navigator.userAgent,hostedInvites);browserNote.hidden=!browserNote.textContent || !files || playerState==='connected';
  $('#hostSetupTitle').textContent=sessionActive?'Your session is running':'Start a session';
  $('#hostSetupIntro').hidden=sessionActive;
  $('#hostNextStep').hidden=!sessionActive;
  if(sessionActive)$('#hostStartStatus').textContent='Session ready. Keep this page open while you play.';
  let next;
  if(document.body.dataset.sessionInvites==='true' && document.body.dataset.sessionHostFiles!=='true'){
    const ready=!!$('#sessionShareLink')?.value;
    next=document.body.dataset.sessionOnline!=='true'?['Reconnect invitations','Go online to invite more people. Existing game connections can keep running.','Go online','sessionConnect']:Number($('#peopleCount').textContent)>1?['Check the guest controllers','Ask guests to press a button on each controller, then assign their gamepads in your game.','Check controllers','players']:ready?['Invite your guests','Copy the session link, or send a direct invite to someone online. Accept each link request below.','Copy invite link','sessionCopyLink']:['Invite your guests','Create a session link or send a direct invite.','Create invite link','sessionCreateLink'];
  }
  else if(hostPairState==='generating')next=['Making your invite','Keep this page open while the invite is prepared.','Making invite…','createInvitation'];
  else if(hostPairState==='ready' && !inviteSaved)next=$('#hostInviteCard').dataset.transfer==='text'?['Send the invite','Copy the invite text and send it to your guest through your chat app.','Copy invite text','createInvitationText']:['Send the invite','Download the invite file and send it to your guest through your chat app.','Download invite file','createInvitation'];
  else if(hostPairState==='ready' || Number($('#hostInviteCard').dataset.pending)>0)next=['Open your guest’s reply','Your guest sends a reply back. Open their file or paste their reply text to connect.','Open reply file','hostReplyFile'];
  else if(hostPairState==='connected')next=['Check the guest controllers','Ask guests to join with their controllers, then assign their gamepads in your game.','Check controllers','players'];
  else if(hostPairState==='expired')next=['Your invite expired','Create a new invite and send it to your guest.','New invite','newInvitation'];
  else next=['Invite your guests','Send a file or copy the invite text. Use New invite for each additional computer.','Create invite file','createInvitation'];
  const [title,note,label,target]=next;
  $('#hostNextTitle').textContent=title;$('#hostNextNote').textContent=note;
  $('#hostNextAction').textContent=label;$('#hostNextAction').disabled=hostPairState==='generating';hostNextTarget=target;
  if($('#hostNextInvite')){$('#hostNextInvite').disabled=hostPairState==='generating';$('#hostNextPasteReply').hidden=document.body.dataset.sessionInvites==='true' && document.body.dataset.sessionHostFiles!=='true' || !['ready','connected'].includes(hostPairState);}
  const connected=playerState==='connected', replyReady=!$('#downloadReply').disabled;
  const textReply=$('#clientPairing').dataset.transfer==='text';
  $('#clientReplyStep .step-content > p').textContent=textReply?'Copy your reply text and send it to your friend. They paste it to connect you.':'Send the downloaded reply file to your friend. They open it to connect you.';
  $('#clientInviteStep .step-content > p').textContent='Open a file or paste the invite text your host sends you.';
  $('#clientPairing > .card-intro').textContent='Ask your host to send you an invite file or invite text.';
  $('#downloadInvitation').innerHTML=`${icon('download')} ${inviteSaved?'Save invite again':'Save invite file'}`;
  $('#downloadReply').innerHTML=`${icon('download')} ${replySaved?'Save reply again':'Save reply file'}`;
  const audioOnly=$('#clientVideo').dataset.audioOnly==='true',receiveStream=$('#clientReceiveVideo').checked;
  $('#clientMediaToggle').textContent=receiveStream?'Stream on':'Stream off';
  $('#clientMediaToggle').setAttribute('aria-pressed',String(receiveStream));
  $('#clientMediaToggle').title=receiveStream?'Pause picture and sound; keep controls connected':'Receive the host’s picture and sound';
  $('#clientVideoSettings').hidden=audioOnly || !receiveStream;
  $('#clientVideoDetails').hidden=audioOnly || !receiveStream;
  $('#clientVideoToggle').closest('label').hidden=audioOnly || !receiveStream;
  $('#clientPopout').hidden=audioOnly;
  const waiting=!clientWasConnected && ['waiting','connecting'].includes(playerState) && replyReady;
  $('#clientReplyAction').hidden=!waiting || document.body.dataset.sessionInvites==='true' && document.body.dataset.sessionGuestFiles!=='true';
  $('#clientReplyAction').textContent=textReply?replySaved?'Copy reply again':'Copy reply text':replySaved?'Save reply again':'Save reply & send it back';
  $('#clientReplyAction').classList.toggle('primary',!replySaved);
  $('#clientReplyAction').classList.toggle('secondary',replySaved);
  if(waiting) {
    $('#clientStageTitle').textContent=replySaved?'Send your reply to the host':'Your reply is ready';
    $('#clientStageNote').textContent=replySaved?'Send the saved file or copied text through your chat app. The host opens it to connect you. Keep this page open.':textReply?'Copy your reply text and send it back through your chat app. The host pastes it to connect you.':'Save your reply file and send it back through your chat app. The host opens it to connect you.';
  }
  const step=connected?2:['idle','closed','failed'].includes(playerState)?0:replyReady?1:0;
  for(const [index,id] of ['joinStepInvite','joinStepReply','joinStepControls'].entries()) {
    const button=$(`#${id}`);
    if(index===step)button.setAttribute('aria-current','step');else button.removeAttribute('aria-current');
    button.classList.toggle('is-complete',index<step || index===1 && replySaved || index===2 && connected && Number($('#clientEnablePad').dataset.joined)>0);
  }
  const watching=$('#clientEnablePad').dataset.ready==='true' && $('#clientEnablePad').dataset.canPlay==='false';
  $('#joinStepControls').textContent=watching?'3 · Watch the game':'3 · Join a controller';
  $('#clientControlsFocus').hidden=!connected || watching || $('#clientEnablePad').dataset.ready!=='true' || $('#clientStage').classList.contains('mouse-pad');
  if(connected && !hasVideo && !$('#clientStage').classList.contains('mouse-pad')) {
    const controls=$('#clientEnablePad').dataset,failed=controls.error==='true',pending=Number(controls.pending)>0;
    $('#clientStageTitle').textContent=audioOnly?'Audio-only session':watching?'Connected as a viewer':failed?'Host controller setup needed':pending?'Joining controllers…':Number(controls.joined)>0?'Ready to play':'Join with your controller';
    $('#clientStageNote').textContent=failed?'The host could not create your controller. Open Controllers for the setup error.':pending?'Your selected controllers are joining. You do not need to press another button.':!receiveStream?'The stream is paused. Turn it on to receive picture and sound here.':audioOnly?'This session uses sound without a picture. Use the sound button below when audio is available.':watching?'Ask the host to share their screen to watch here.':Number(controls.joined)>0?'Keep this page open while playing. Your host can share their screen here.':'Press a controller button to join, or select a controller in the controller panel.';
  }
  $('#clientAudioOnlyNote').hidden=!connected || !audioOnly || !receiveStream;
}
export function hostSessionUI(active) {
  sessionActive = active;
  const audioOnly=$('#hostAudioOnly').checked;
  $('#hostPanel').dataset.session=active?'active':'setup';
  $('#hostSetupCard').hidden=active;
  $('#hostSessionContent').hidden=!active;
  $('#hostLiveSource').hidden=!active;
  $('#hostEnd').hidden=!active;$('#inviteFocus').hidden=!active;
  const source=$('#hostSourceSetup'),monitor=$('#hostMonitor');
  if(monitor.parentElement!==$('#hostMonitorDock'))$('#hostMonitorDock').append(monitor);
  if(active){
    if(source.parentElement!==$('#hostLiveSourceBody'))$('#hostLiveSourceBody').insertBefore(source,$('#hostExtraShares'));
  } else {
    if(source.parentElement!==$('#hostSetupCard'))$('#hostSetupCard').insertBefore(source,$('#hostSessionControls') || $('#hostCreate'));
  }
  const inputSetup=$('#hostSessionControls'),guestControls=$('#hostGuestSettings'),inputHome=$('#hostSettingsSheet-players');
  if(inputSetup){inputSetup.hidden=active;const parent=active?inputHome:inputSetup;if(parent && guestControls.parentElement!==parent)parent.prepend(guestControls);}
  $('#hostCreate').hidden = active;
  $('#hostControllerCount').disabled = active; $('#hostControllerOutput').disabled=active; $('#hostDynamicControllers').disabled=active;$('#hostStartStatus').hidden = !active; $('#hostStartStatus').textContent='Session ready. Create an invite in step 2.';
  $('#startShareScreen').hidden = !active || sharing;
  $('#startShareScreen').innerHTML=`${icon('share')} ${audioOnly?'Choose audio source':'Share your screen'}`;
  $('#hostCapture').innerHTML=`${icon('share')} ${audioOnly?'Share audio':'Share screen'}`;
  $('#hostStageTitle').textContent = audioOnly?'Choose an audio source':'Screen sharing is optional';
  $('#hostStageNote').textContent = audioOnly?'Choose an audio source to share sound, or start with controllers only.':active ? 'Add video now, or keep playing with controllers only.' : 'Choose a window or screen to include video, or start with controllers only.';
  if (!active) {
    hostPairState='idle';
    inviteSaved=false;
    $('#inviteReady').hidden = true;
    $('#hostInviteCard').dataset.prepared='false';
    $('#hostInviteCard').dataset.exportable='true';
    $('#newInvitation').hidden=true;
    $('#createInvitation').innerHTML = `Create invite file ${icon('download')}`;
  }
  $('#hostStage').classList.toggle('controller-only',active && !sharing);
  sessionFlowUI();
}
export function hostSharingUI(active, prepared = !sessionActive) {
  sharing = active;
  const only=$('#hostAudioOnly').checked;
  const preview = active && !only && !$('#hostPanel').hidden && $('#hostPreviewToggle').checked && !($('#hostPreviewAutoPause').checked && (document.hidden || !document.hasFocus()));
  $('#hostMonitorToggle').hidden=!active || only;
  $('#hostMonitorToggle').textContent=$('#hostPreviewToggle').checked?'Hide preview':'Show preview';
  $('#hostMonitorToggle').setAttribute('aria-pressed',String($('#hostPreviewToggle').checked));
  $('#hostMonitorToggle').title=$('#hostPreviewToggle').checked?'Pause your local preview; guests keep watching':'Show your local preview';
  $('#hostPreview').hidden = !preview;
  $('#hostStage').classList.toggle('has-video', preview);
  $('#hostStage').classList.toggle('controller-only',sessionActive && !active);
  $('#hostEmpty').hidden = preview;
  $('#hostStageLabel').hidden = !preview;
  $('#hostLiveBadge').classList.toggle('is-live', active && !prepared);
  $('#hostLiveText').textContent = active ? only ? prepared?'Audio selected':'Audio sharing on' : prepared ? 'Private preview' : 'Screen is live' : 'Not sharing yet';
  $('#hostStageLabel .muted').textContent = prepared ? '· private preview' : '· sharing your screen';
  const pending=$('#hostCapture').dataset.starting==='true',stopLabel=pending && !active?'Cancel sharing':prepared?'Clear selection':'Stop sharing';
  $('#hostStopCapture').dataset.pending=String(pending && !active);$('#hostCapture').hidden=active || pending;$('#hostStopCapture').hidden=!active && !pending;$('#hostStopCapture').disabled=!active && !pending;
  $('#hostStopCapture').innerHTML=`${icon('stop')} <span>${stopLabel}</span>`;$('#hostStopCapture').title=stopLabel;$('#hostStopCapture').setAttribute('aria-label',stopLabel);
  $('#startShareScreen').hidden=!sessionActive || active || pending;
  if(active && only){
    $('#hostStageTitle').textContent='Audio-only sharing';
    $('#hostStageNote').textContent=prepared?'Your audio source is ready. Start a session to share it.':'Your guests can listen and use controllers without a picture.';
  } else if (active && !preview) {
    $('#hostStageTitle').textContent = prepared ? 'Your screen is selected' : 'Your friends can see your screen.';
    $('#hostStageNote').textContent = prepared ? 'Click Start a session to share this source with connected guests.' : 'Your preview is paused. Screen sharing is still on.';
  } else if (!active) hostSessionUI(sessionActive);
  sessionFlowUI();
  refreshQuickStart();
}
export function peopleUI(count) { const text=String(count+1);if($('#peopleCount').textContent!==text){$('#peopleCount').textContent=text;sessionFlowUI();} }
export function pairingUI(side, state) {
  if (side === 'host') {
    hostPairState=state;
    if(state==='generating')inviteSaved=false;
    const ready = state === 'ready' || state === 'connected';
    $('#inviteReady').hidden = true;
    if(state==='ready')$('#hostInviteCard').dataset.prepared='true';
    const prepared=$('#hostInviteCard').dataset.prepared==='true';
    $('label[for="invitationRole"]').textContent=prepared?'Access for next invite':'Invite access';
    const draftNote=$('.invite-draft-note');if(draftNote)draftNote.textContent=prepared?`${$('#hostInviteCard').dataset.inviteAccess} invite · file and text use the same invite.`:'Download a file or copy the text to send through chat.';
    $('#newInvitation').hidden=!prepared && state!=='expired';
    $('#hostInviteCard').dataset.exportable=String(state==='ready' || !prepared && !['expired','connected'].includes(state));
    $('#createInvitation').innerHTML = state === 'generating' ? 'Preparing invite…' : `${icon('download')} ${prepared?'Download invite file':'Create invite file'}`;
    $('#hostInviteStep').classList.toggle('is-complete', ready);
    $('#hostReplyStep').classList.toggle('is-complete', state === 'connected');
    if(state==='connected') { $('#hostPairStatus').textContent=$('#hostDynamicControllers').checked ? 'Connected. Ask each guest to press a controller button to join.' : 'Connected. Ask guests to choose their controller devices under Advanced and resume sharing if paused.'; $('#hostStartStatus').textContent='Connected. Open your game’s controller settings to assign guest controllers.'; }
  } else {
    if(state==='generating' || state==='ready')replySaved=false;
    $('#clientInviteStep').classList.toggle('is-complete', state === 'ready' || state === 'connected');
    $('#clientReplyStep').classList.toggle('is-complete', state === 'connected');
    $('#createReply').innerHTML = state === 'generating' ? 'Making your reply…' : `Make my reply ${icon('arrow')}`;
    if (state === 'ready') playerConnectionUI('waiting');
  }
  sessionFlowUI();
}
export function playerConnectionUI(state) {
  playerState = state;
  if(state!=='connected')inputLatencyUI();
  if(state==='connected')clientWasConnected=true;
  if(state==='connected') {$('#downloadReply').disabled=true;$('#copyReply').disabled=true;}
  if(state==='idle' || state==='closed')clientWasConnected=false;
  const connected = state === 'connected';
  const labels = { idle: 'Not connected', closed: 'Not connected', connected: 'Connected', connecting: 'Connecting', waiting: 'Waiting for your friend', disconnected: 'Reconnecting', failed: 'Connection lost' };
  $('#clientConnectionText').textContent = labels[state] || state;
  $('#clientConnectionBadge').classList.toggle('is-live', connected);
  $('#clientStage').classList.toggle('controller-only',connected && !hasVideo);
  $('#joinFocus').hidden = connected || state === 'waiting' || state === 'connecting';
  $('#clientStageTitle').textContent = connected ? "Connected to your host" : state === 'waiting' ? 'Send your reply to the host' : 'Open your host’s invite';
  $('#clientStageNote').textContent = connected ? "Press a controller button to join. Ask your host to share their screen if you want to watch here." : state === 'waiting' ? 'Send your reply file to your friend. Keep this page open while they connect you.' : "Open the invite file. Your reply downloads automatically; send it back to the host.";
  if (connected) { $('#clientPairing').open = false; pairingUI('client', 'connected'); }
  if (state === 'idle' || state === 'closed' || state === 'failed') playerVideoUI(false);
  if(state==='idle' || state==='closed')replySaved=false;
  sessionFlowUI();
  refreshQuickStart();
}
export function playerVideoUI(available) {
  hasVideo = available;
  if(!available)resetMediaStats();
  const visible = available && $('#clientVideoToggle').checked;
  $('#clientStage').classList.toggle('has-video', visible);
  $('#clientStage').classList.toggle('controller-only',playerState==='connected' && !available);
  $('#clientEmpty').hidden = visible;
  $('#clientStageLabel').hidden = !visible;
  if (available && !visible) {
    $('#clientStageTitle').textContent = 'Picture hidden';
    $('#clientStageNote').textContent = 'Sound and controls stay on. Enable Show shared screen in Connection settings to see the picture again.';
  } else if (!available && playerState === 'connected') {
    $('#clientStageTitle').textContent = "Connected to your host";
    $('#clientStageNote').textContent = $('#clientReceiveVideo').checked ? 'Ask the host to share their game window or screen to watch here.' : 'Video is off. Watch through your other call and keep this page open to play.';
  }
  sessionFlowUI();
}
function resetMediaStats(){
  $('#clientVideoStats').textContent='Waiting for video';
  for(const id of ['clientStreamDetail','clientMediaRtt','clientLoss','clientJitter','clientDecode','clientBuffer','clientDrops'])$(`#${id}`).textContent='—';
  $('#clientDecode').title='';
}
export function inputLatencyUI(milliseconds=null){
  const valid=playerState==='connected' && Number.isFinite(milliseconds) && milliseconds>=0;
  const text=valid?`${Math.round(milliseconds)} ms`:'—';
  if($('#clientRtt').textContent!==text)$('#clientRtt').textContent=text;
  const badge=$('#clientInputHealth');badge.hidden=!valid;
  if(valid && badge.textContent!==`Input round trip · ${text}`)badge.textContent=`Input round trip · ${text}`;
}
export function controllerUI(enabled) {
  const button = $('#clientEnablePad');
  const desktop = $('#inputSource').value === 'desktop';
  const count = Number(button.dataset.count || 1), group = count > 1 ? `${count} controllers` : 'controller';
  button.innerHTML = `${icon('pad')} ${desktop ? enabled ? 'Desktop keys on' : 'Enable desktop keys' : enabled ? count > 1 ? `${count} controllers on` : 'Controller on' : `Enable ${group}`}`;
  if(button.dataset.dynamic==='true')button.innerHTML=`${icon('pad')} ${enabled ? 'Pause controller sharing':'Resume controller sharing'}`;
  $('#clientEnableGroup').innerHTML = button.innerHTML; $('#clientEnableGroup').disabled = button.disabled; $('#clientEnableGroup').setAttribute('aria-pressed',String(enabled));
  button.classList.toggle('active', enabled); button.setAttribute('aria-pressed', String(enabled));
  $('#playerFooterHint').textContent = playerState!=='connected' ? 'Connect to your host, then press a controller button to join.' : button.dataset.ready==='false' ? 'Finishing your connection. Keep this page open.' : button.dataset.canPlay==='false' ? 'Watching only. Ask the host for a Play invite to join with a controller.' : enabled ? 'Controls are on. Test your buttons in the controller panel before playing.' : 'Turn on your controls in the controller panel to play.';
  if(playerState==='connected' && button.dataset.ready==='true' && button.dataset.canPlay==='true' && button.dataset.dynamic==='true')$('#playerFooterHint').textContent=enabled?Number(button.dataset.joined || 0)>0?'Press a button on another controller to add a player.':'Press a button on your controller to join.':'Controller sharing is paused. Open Controllers to resume.';
}
export function soundUI(muted) {
  const stream=$('#clientAudio').srcObject || $('#clientVideo').srcObject;
  const available=$('#clientVideo').dataset.sharedAudio!=='false' && stream?.getAudioTracks().some(track=>track.readyState==='live' && !track.muted)===true;
  const needsClick=available && !muted && $('#clientAudio').playbackBlocked===true;
  const button=$('#clientUnmute');
  button.disabled=!available;
  button.innerHTML = `${icon('volume')} ${available ? needsClick ? 'Enable sound' : muted ? 'Play sound' : 'Sound on' : 'No audio'}`;
  button.title=available ? needsClick ? 'Your browser needs a click to play audio. Click to enable sound.' : muted ? 'Play the host’s shared audio' : 'Mute the host’s shared audio' : 'No shared audio is arriving. Ask the host to include audio for the selected source.';
  button.dataset.on=String(available && !muted && !needsClick);button.setAttribute('aria-label',`${available?needsClick?'Enable sound':muted?'Play sound':'Sound on':'No audio'}. ${button.title}`);button.querySelector('svg').insertAdjacentHTML('beforeend','<path class="control-off-stroke" d="M3 3 21 21"/>');
  button.classList.toggle('active', available && !muted && !needsClick);
  button.classList.toggle('needs-audio-gesture',needsClick);
  button.setAttribute('aria-pressed', String(available && !muted && !needsClick));
  if($('#clientVideo').dataset.audioOnly==='true')$('#clientAudioOnlyNote').textContent=available?needsClick?'Audio-only stream · click Enable sound to listen. Controllers work as usual.':muted?'Audio-only stream · click Play sound to listen. Controllers work as usual.':'Audio-only stream · sound is on. Controllers work as usual.':'Audio-only stream · waiting for the host’s audio. Controllers work as usual.';
}
export function inputSourceUI() {
  const keyboard = $('#inputSource').value !== 'gamepad';
  $('#keyboardHelp').hidden = $('#inputSource').value !== 'keyboard';
  $('#clientPadIndex').hidden = keyboard;
  $('label[for="clientPadIndex"]').hidden = keyboard;
  $('#padStatus').hidden = keyboard;
}
export function initUI() {
  initMobileNavigation();
  const createText=document.createElement('button');createText.id='createInvitationText';createText.className='button secondary';createText.innerHTML=`${icon('copy')} Copy invite text`;createText.disabled=$('#createInvitation').disabled;
  createText.onclick=async()=>{const packet=await $('#createInvitation').onclick(undefined,'text');if(packet)await $('#copyInvitation').onclick();};$('#createInvitation').after(createText);
  const exports=document.createElement('div');exports.className='invite-exports';$('#createInvitation').before(exports);exports.append($('#createInvitation'),createText);$('#createInvitation').classList.remove('full');
  $('#downloadInvitation').hidden=true;$('#copyInvitation').hidden=true;$('#hostReplyStep').hidden=true;
  const rawInvite=$('#hostInvitation').closest('details');rawInvite.querySelector('summary').textContent='View invite text';rawInvite.classList.add('invite-raw');
  const draftNote=document.createElement('p');draftNote.className='small muted invite-draft-note';draftNote.textContent='File and text contain the same invite. Use New invite for another guest.';exports.after(draftNote,$('#newInvitation'));
  function inviteButtons(){const busy=$('#createInvitation').disabled,exportable=$('#hostInviteCard').dataset.exportable!=='false';createText.disabled=busy || !exportable;$('#newInvitation').disabled=busy;$('#createInvitation').setAttribute('aria-disabled',String(busy || !exportable));$('#invitationRole').disabled=busy;}
  new MutationObserver(inviteButtons).observe($('#createInvitation'),{attributes:true,attributeFilter:['disabled']});
  new MutationObserver(inviteButtons).observe($('#hostInviteCard'),{attributes:true,attributeFilter:['data-exportable']});inviteButtons();
  $('#invitationRole').addEventListener('change',()=>{if($('#hostInviteCard').dataset.prepared==='true')toast('Access applies to the next New invite.');});
  function pasteButton(fieldId,id,label){
    const details=$(`#${fieldId}`).closest('details'),button=document.createElement('button');button.id=id;button.className='button secondary full pairing-paste';button.textContent=label;
    button.onclick=()=>{if(fieldId==='clientInvitation')$('#clientPairing').dataset.transfer='text';details.open=true;focusSection(`#${fieldId}`);};details.before(button);details.querySelector('summary').hidden=true;return button;
  }
  pasteButton('hostReply','hostPasteReply','Paste reply text');pasteButton('clientInvitation','clientPasteInvite','Paste invite text');
  const nextActions=document.createElement('div');nextActions.className='next-step-actions';$('#hostNextStep').append(nextActions);nextActions.append($('#hostNextAction'));
  const pasteReply=document.createElement('button');pasteReply.id='hostNextPasteReply';pasteReply.className='button secondary';pasteReply.textContent='Paste reply text';pasteReply.onclick=()=>$('#hostPasteReply').click();nextActions.append(pasteReply);
  const inviteGuest=document.createElement('button');inviteGuest.id='hostNextInvite';inviteGuest.className='button secondary';inviteGuest.textContent='Invite another guest';inviteGuest.onclick=()=>{$('#inviteFocus').click();if($('#hostInviteCard').dataset.prepared==='true')focusSection('#newInvitation');};nextActions.append(inviteGuest);
  $('#inviteFocus').innerHTML=`${icon('people')} Invite guests`;
  $('#clientReplyAction').onclick=()=>($('#clientPairing').dataset.transfer==='text'?$('#copyReply'):$('#downloadReply')).click();
  $('#hostPairRetry').onclick=()=>($('#hostPairRetry').dataset.action==='invite'?$('#newInvitation'):$('#hostPairRetry').dataset.action==='start'?$('#hostCreate'):$('#hostReplyFile')).click();
  $('#clientPairRetry').onclick=()=>$('#clientInvitationFile').click();
  $('#clientControlsFocus').onclick=()=>focusSection($('#controllerSetup').dataset.blockingState==='waiting'?'#connectedControllers':$('#clientEnablePad').dataset.dynamic==='false'?'#clientEnableGroup':'#connectedControllers');
  $('#hostNextAction').onclick=()=>{if(hostNextTarget==='players')focusSection('#peerList');else{focusSection(`#${hostNextTarget}`);$(`#${hostNextTarget}`).click();}};
  $('#joinStepInvite').onclick=()=>{$('#clientPairing').open=true;$('#clientInvitationFile').click();};
  $('#joinStepReply').onclick=()=>{if($('#downloadReply').disabled){toast('Open your host’s invite first.');focusSection('label[for="clientInvitationFile"]');}else ($('#clientPairing').dataset.transfer==='text'?$('#copyReply'):$('#downloadReply')).click();};
  $('#joinStepControls').onclick=()=>focusSection(playerState!=='connected'?'#clientPairStatus':$('#clientEnablePad').dataset.canPlay==='false'?'#clientStage':$('#controllerSetup').dataset.blockingState==='waiting'?'#connectedControllers':$('#clientEnablePad').dataset.dynamic==='false'?'#clientEnableGroup':'#connectedControllers');
  for(const id of ['clientInvitationFile','hostReplyFile']) {
    const input=$(`#${id}`),zone=$(`label[for="${id}"]`);
    for(const event of ['dragenter','dragover'])zone.addEventListener(event,e=>{if(![...(e.dataTransfer?.types || [])].includes('Files'))return;e.preventDefault();e.dataTransfer.dropEffect='copy';zone.classList.add('is-dragging');});
    zone.addEventListener('dragleave',e=>{if(!zone.contains(e.relatedTarget))zone.classList.remove('is-dragging');});
    zone.addEventListener('drop',e=>{
      e.preventDefault();e.stopPropagation();zone.classList.remove('is-dragging');
      const files=e.dataTransfer?.files;
      if(files?.length!==1){toast('Drop one invite or reply file at a time.');return;}
      if(files[0].size>131072){toast('This file is too large. Use the invite or reply text file from the app.');return;}
      try {input.files=files;input.dispatchEvent(new Event('change',{bubbles:true}));}
      catch {toast('Use the Open file button to select this file in your browser.');}
    });
  }
  // Accept pairing files anywhere on the current page instead of navigating
  // away from a live session when the file misses the smaller drop target.
  document.addEventListener('dragover',event=>{
    if(![...(event.dataTransfer?.types || [])].includes('Files'))return;
    event.preventDefault();event.dataTransfer.dropEffect='copy';
  });
  document.addEventListener('drop',event=>{
    if(![...(event.dataTransfer?.types || [])].includes('Files'))return;
    event.preventDefault();
    const id=document.body.dataset.mode==='host'?'hostReplyFile':'clientInvitationFile';
    $(`label[for="${id}"]`).dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:event.dataTransfer}));
  });
  $('#startShareScreen').onclick = () => $('#hostCapture').click();
  $('#qualityToggle').onclick = () => { $('#hostSettings').open = true; focusSection('#streamResolution'); };
  $('#inviteFocus').onclick = () => {
    if(document.body.dataset.sessionInvites==='true' && document.body.dataset.sessionHostFiles!=='true'){
      if(document.body.dataset.sessionOnline!=='true'){focusSection('#sessionConnection');$('#sessionConnect').focus({preventScroll:true});return;}
      focusSection('#sessionHostInvite');($('#sessionShareLink').value?$('#sessionCopyLink'):$('#sessionCreateLink')).focus({preventScroll:true});return;
    }
    focusSection('#hostInviteCard');
    (sessionActive ? $('#createInvitation') : $('#hostCreate')).focus({ preventScroll: true });
  };
  $('#joinFocus').onclick = () => { $('#clientPairing').open = true; $('#clientInvitationFile').click(); };
  for (const [id, textarea] of [['copyInvitation', 'hostInvitation'], ['copyReply', 'clientReply']]) {
    $(`#${id}`).onclick = async () => {
      const field = $(`#${textarea}`);
      if (!field.value) { toast('Create an invite or reply first, then copy it.'); return; }
      try { await navigator.clipboard.writeText(field.value);if(id==='copyInvitation')inviteSaved=true;else replySaved=true;sessionFlowUI();toast('Copied. Send it to your friend.'); }
      catch { field.closest('details').open=true;focusSection(`#${textarea}`);field.select();toast('Select and copy the text below.'); }
    };
  }
  const help = $('#helpDialog');
  const topics=document.createElement('details');topics.id='tourTopics';topics.className='tour-topics';topics.innerHTML='<summary>Other guides</summary>';
  const topicsLabel=$('label[for="tourScenario"]');topicsLabel.before(topics);topics.append(topicsLabel,$('#tourScenario'));
  const guideContent=document.createElement('div');guideContent.className='tour-content';help.querySelector('.dialog-heading').after(guideContent);guideContent.append(topics,$('#tourProgress'),$('#tourBody'),$('#tourTip'));
  const guideFooter=document.createElement('div');guideFooter.className='tour-footer';help.append(guideFooter);guideFooter.append(help.querySelector('.tour-actions'),$('#tourOptional'),$('#helpDone'));

  let tourStep = 0, tourMode = 'host', target = null, invitationReady = false, lastTourMotionKey=null;
  const tours = {
    host: [
      ['Start your session', 'Choose an optional screen share, allow guest cameras and microphones separately, then click Start a session.', '#hostCreate', 'Skip screen sharing to play while watching through Discord or another call.'],
      ['Send an invite', 'Download the invite file or copy its text and send it through chat. Both buttons use the same invite.', '#createInvitation', 'Click New invite for another computer. Each computer can join with several controllers.'],
      ['Open their reply', 'Open your guest’s reply file, or click Paste reply text and paste the text they send back.', 'label[for="hostReplyFile"]', 'Keep this page open while they reply. Use Invite another guest to connect another computer.'],
      ['Set up the players', 'Ask each guest to press a button on each controller they want to use. Assign the joined gamepads in your game’s controller settings.', '#peerList', 'Remove frees a controller spot. Make host lets a guest take over the game after accepting; your voice and cameras stay connected.']
    ],
    client: [
      ['Open the invite', 'Open the host’s invite file, drop it anywhere on this page, or click Paste invite text.', 'label[for="clientInvitationFile"]', 'Before opening the invite, use Join with to preview your camera, choose controllers and map their buttons. Opening a file downloads your reply automatically.'],
      ['Send your reply', 'Send the downloaded reply file back to your host through your chat app. Use Save reply again if you need another copy.', '#downloadReply', 'Keep this page open while the host opens your reply.'],
      ['Set up your controllers', 'Open Advanced to choose your reserved controller devices. Resume controller sharing if it is paused.', '#controllerAdvanced > summary', 'Use keyboard & mouse as a controller to play with mapped keys and mouse buttons.'],
      ['Play the game', 'Watch or listen here. In Settings, turn Stream off to use another video call while keeping your controls connected.', '#clientMediaToggle', 'Move the mouse in fullscreen to show call controls. Controllers opens each device’s mapping. Camera and Mic are optional. Background gamepad input is on by default.']
    ]
  };
  let scenario = 'connect';
  function currentTour() {
    const socketSetup=document.body.dataset.sessionInvites==='true' && (tourMode==='host'?document.body.dataset.sessionHostFiles:document.body.dataset.sessionGuestFiles)!=='true';
    const inviteStep=socketSetup?$('#sessionConnect').textContent==='Online'?['You are online','Your temporary name is shown here. Invite friends from the session link panel.','#sessionIdentity','Friends must use this same invite server.']:['Go online','Connect to the configured invite server. A temporary name is optional.','#sessionConnect','Your friends use the same server. No account or password is needed.']:$('#hostInviteCard').dataset.exportable==='false' && !$('#newInvitation').hidden?['Create a new invite','Choose access for the next guest, then click New invite. Download its file or copy its text.','#newInvitation','Each additional computer needs a separate invite. Existing guests stay connected.']:tours.host[1];
    const acceptStep=socketSetup?['Invite your friends','Create and copy a session link, then accept the guests who ask to join. Or send a direct invite to a temporary name.','#sessionHostInvite','Replies are sent automatically. Stop session invalidates the link.']:$('#hostInviteCard').dataset.transfer==='text'?['Paste their reply','Click Paste reply text, paste the complete reply your guest sends back, then click Connect.','#hostPasteReply','You can also open a reply file. Keep the page open while waiting.']:tours.host[2];
    const openStep=socketSetup?['Open a session link','Paste your host’s session link and click Ask to join, or accept a direct invite above.','#sessionGuestInvite','The host decides which link requests to accept.']:tours.client[0];
    const hostStart=sessionActive ? ['Your session is running','Keep this page open and invite your guests.','#hostNextStep','Choose a screen or audio source at any time.'] : $('#hostAudioOnly').checked ? ['Start audio sharing','Choose a sound source, then click Start a session.','#hostCreate','Guests can hear the shared audio and use controllers without a video stream.'] : tours.host[0];
    const manual=$('#clientEnablePad').dataset.dynamic==='false';
    const ready=$('#clientEnablePad').dataset.ready==='true';
    const watching=ready && $('#clientEnablePad').dataset.canPlay==='false';
    const joinPending=document.body.dataset.sessionJoinPending==='true';
    const replyStep=socketSetup?['Wait for the connection','The app exchanges connection details automatically after the host accepts you.','#sessionJoinStatus',joinPending?'Keep this page open. Use Cancel request to withdraw.':'Keep this page open. Controller and desktop permissions are unchanged.']:playerState==='connected'
      ? ['Your host accepted the reply','Your connection is ready. Continue to the next step.','#clientConnectionBadge','Keep this page open while playing.']
      : $('#clientReplyAction').hidden?tours.client[1]:$('#clientPairing').dataset.transfer==='text'?['Send your reply','Click Copy reply text and send it to your host through your chat app.','#clientReplyAction','The host pastes your reply to connect you. Keep this page open.']:['Send your reply','Click Save reply & send it back, then send the file to your host through your chat app.','#clientReplyAction','Keep this page open while the host opens your reply.'];
    const waiting=socketSetup && joinPending || ['waiting','connecting','disconnected'].includes(playerState) || playerState==='connected' && !ready;
    const waitStep=socketSetup?['Connecting to your host','Wait for host approval and the automatic connection reply.','#sessionJoinStatus','No invite or reply files are needed with this setup.']:playerState==='connected'
      ? ['Finishing your connection','Keep this page open while the input connection becomes ready.','#clientPairStatus','The next instruction appears automatically.']
      : ['Wait for your host','Send your saved reply to the host. Keep this page open while they click Open reply file.','#clientPairStatus','You can start playing once the connection is ready.'];
    let joinStep;
    if(waiting)joinStep=waitStep;
    else if(watching)joinStep=['You are connected','This invite lets you watch or listen. Your host chooses what to share.','#clientMediaToggle','Ask for a Play invite if you want to control the game.'];
    else if(playerState==='connected' && $('#controllerSetup').dataset.inputMode==='native' && $('#controllerSetup').dataset.blockingState==='waiting')joinStep=['Check controller status','Block local controller input is on by default. Connected controllers are reserved automatically; press a button after connecting to join.','#connectedControllers','Open Advanced if a controller needs setup.'];
    else if(manual)joinStep=tours.client[2];
    else if(playerState==='connected' && $('#clientEnablePad').getAttribute('aria-pressed')==='false')joinStep=['Turn on your controllers','Turn on Share controllers, then press a button on your controller.','#clientJoinControllers','Keep this page open while playing.'];
    else joinStep=['Join with your controllers','Controllers selected before joining connect automatically. Press a button on any additional controller to add it.','#connectedControllers','For keyboard play, choose Use keyboard & mouse as a controller. Click Map beside any joined device to change its controls.'];
    const clientFinish=$('#clientVideo').dataset.audioOnly==='true' ? ['Listen to the shared audio','Click Play sound to hear your host. Keep this page open while listening or playing.','#clientUnmute','Refresh audio reconnects sound while your controllers stay connected.'] : watching ? ['Watch the stream','Click Fullscreen to fill your display, or Pop out to watch beside another app.','#clientFullscreen','Click Play sound to hear shared audio when available.'] : $('#clientReceiveVideo').checked ? tours.client[3] : ['Play with your other call','The stream is off here. Keep this page open for your controllers while watching through another call.','#clientMediaToggle','Background gamepad input is on by default. Selected native devices remain reserved for the host while another window is in front.'];
    const connectedGuests=[...$('#peerList').querySelectorAll('.peerRow[data-connection=connected]')];
    const viewersOnly=connectedGuests.length>0 && connectedGuests.every(row=>row.dataset.wantsController==='false');
    const hostPlay=viewersOnly?['Your guests are connected','Share a screen or audio source whenever you are ready. Camera, microphone and chat controls stay on the call bar.','#peerList','Use Invite guests to connect another computer, or Make host to switch who is sharing.']:$('#hostDynamicControllers').checked ? tours.host[3] : ['Assign the guest controllers','Ask guests to select their devices and resume sharing under Advanced if paused. Assign the listed gamepads in your game.','#peerList','Check each guest’s input tests before playing.'];
    if(scenario==='connect')return tourMode==='host'?[hostStart,inviteStep,acceptStep,hostPlay]:[openStep,replyStep,joinStep,clientFinish];
    if(scenario==='server' && socketSetup)return tourMode==='host'?[hostStart,inviteStep,acceptStep,hostPlay]:[openStep,replyStep,joinStep,clientFinish];
    if(scenario==='server')return tourMode==='host'
      ? [['Check connection setup','Open the relay and recovery guide if guests cannot connect. Use Connection Setup to change your network settings.','a[href="/port-forwarding"]','Restart the app after saving settings, then return here.'],hostStart,['Send fresh invites','Create a new invite for each guest after restarting with new settings.',$('#newInvitation').hidden?'#createInvitation':'#newInvitation','Existing invite files keep their original network settings.']]
      : [['Check the connection guide','Ask your host to check their connection settings if pairing fails.','#clientNetworkGuide','The host sends a fresh invite after changing settings.'],['Open the fresh invite','Open the new invite and send its reply back.','label[for="clientInvitationFile"]','Keep this page open after sending the reply.']];
    const game=scenario==='input';
    if(tourMode==='client')return [openStep,replyStep,
      waiting?waitStep:watching?['Ask for control access','Ask your host for a Play invite before using keyboard and mouse control.','#clientPairStatus','Watching invites cannot control the host.']
        : ['Enable your mouse',`Ask the host to allow mouse control${game?' for the game':''}. Enable Control the host’s system mouse.`,'#clientDesktopMouse','This stays off until both you and your host approve it.'],
      ['Enable your keyboard','Ask the host to allow desktop typing. Enable Type on the host desktop.',manual?'#inputSource':'#clientDesktopTyping',manual?'Choose Keyboard → host desktop in the controller panel.':'Your keys go to the host while the picture or mouse pad is focused.'],
      [game?'Play with keyboard and mouse':'Control the shared computer','Click the picture or mouse pad, then use your mouse and keyboard.','#clientStage','Turn off mouse and typing controls when you finish. With video off, the picture area works as a mouse pad.']
    ];
    if(document.body.dataset.desktopInput==='false')return [
      ['Desktop control is unavailable here',document.body.dataset.platform==='darwin'?'Run the native Mac launcher, then open Mac audio & desktop setup in Settings & troubleshooting. Allow Accessibility before enabling input.':'This Linux session does not allow native mouse and keyboard injection. Use an X11 login session for desktop control.','#hostPlatformNote','Controllers, browser screen sharing and separately configured native audio remain available.'],hostStart,inviteStep,acceptStep
    ];
    const windowScope=document.body.dataset.windowMouse==='true' && (sessionActive?document.body.dataset.inputScope==='window':document.body.dataset.selectedSurface==='window') && $('#hostDesktopScope').value==='window';
    const scope=$('#hostDesktopScope').value==='off'
      ? ['Enable desktop control','Choose Shared window only for a verified window, or Entire desktop for access across the screen. Read the CAUTION message. Mouse and typing are checked by default; turn either off if needed.','#hostDesktopScope','Desktop control is optional. Keyboard and mouse mappings to virtual controllers work while it is off.']
      : $('#hostCapture').dataset.starting==='true'
      ? ['Preparing your source','Keep this page open while capture starts.','#hostSourceStatus','Mouse and typing permissions remain off.']
      : windowScope?['Keep access in the shared window','Mouse clicks and typing are limited to the selected window. Changing or closing it revokes access.','#hostMouseScopeNote','Select the game window directly in Native capture for verified window-only access.']
      : sessionActive && document.body.dataset.windowMouse==='true' && document.body.dataset.selectedSurface==='window' && $('#hostDesktopScope').value==='window'?['Choose a verified window','Choose Native capture, then select the game window for window-only input access.','#captureBackend','This browser source could not be matched to a local window. Whole-screen access requires separate approval in settings.']
      : ['Allow screen access',document.body.dataset.platform==='linux'?'Choose Entire desktop under Desktop control. Guests can then click anywhere on that desktop.':'Choose Entire desktop under Desktop control. Guests can then click anywhere on that screen.','#hostDesktopScope','Only grant this to guests you trust. Screen sharing alone does not grant control.'];
    return [
      $('#hostAudioOnly').checked?['Choose what to share','Audio-only mode is selected. Choose a sound source, or turn it off to share a window.','#hostSourceSetup','You can use controllers, mouse and keyboard without video. Desktop access still requires your approval.']:[game?'Choose the game window':'Choose what to show',game?'Choose your game window and check its preview before starting. Skip this step if you use another call for picture and sound.':'Choose a window or screen and check its preview, or skip this step to use controls without video.', $('#captureBackend').value==='native'?'#captureTarget':'#chooseBrowserSource',document.body.dataset.nativeAudio==='true'?'App audio works with either video method. Browser audio is chosen in its sharing dialog. Input permissions are granted separately.':'Audio depends on what your browser and OS offer in the sharing dialog. Use another call for sound if needed.'],
      scope,
      ['Allow mouse control','Leave Allow guests to control my system mouse checked to share movement, clicks and scrolling.','#hostDesktopMouse','Click Stop desktop control to revoke access.'],
      ['Allow keyboard control','Leave Allow typing & keyboard shortcuts checked to share typing, or turn it off to share only the mouse.','#hostDesktopKeyboard','Guests share the host’s system mouse and keyboard while these controls are enabled.'],
      hostStart,inviteStep,acceptStep
    ];
  }
  function positionTour() {
    if (!help.open || !target) return;
    const beforeLayout=[help.style.left,help.style.top,help.style.width,help.style.maxHeight].join('|');
    const rect = target.getBoundingClientRect(), width = Math.min(360, innerWidth - 24);
    help.style.width = `${width}px`;
    help.style.maxHeight = `${innerHeight - 24}px`;
    let height = Math.min(help.offsetHeight, innerHeight - 24);
    const right = rect.right + 18, left = rect.left - width - 18;
    let x, y;
    if (right + width <= innerWidth - 12) { x = right; y = rect.top - 35; help.dataset.side = 'right'; }
    else if (left >= 12) { x = left; y = rect.top - 35; help.dataset.side = 'left'; }
    else {
      x = rect.left + rect.width / 2 - width / 2;
      const above = Math.max(90, rect.top - 30), below = Math.max(90, innerHeight - rect.bottom - 30);
      const useAbove = height > below && above > below;
      help.style.maxHeight = `${Math.min(innerHeight - 24, useAbove ? above : below)}px`;
      height = help.offsetHeight;
      y = useAbove ? rect.top - height - 18 : rect.bottom + 18; help.dataset.side = useAbove ? 'above' : 'below';
    }
    help.style.left = `${Math.max(12, Math.min(innerWidth - width - 12, x))}px`;
    help.style.top = `${Math.max(12, Math.min(innerHeight - height - 12, y))}px`;
    if(beforeLayout!==[help.style.left,help.style.top,help.style.width,help.style.maxHeight].join('|'))document.dispatchEvent(new CustomEvent('tour-anchor-move',{detail:{dialog:help}}));
  }
  function renderTour(scroll = true) {
    if(!help.open)return;
    const steps = currentTour(); tourStep=Math.min(tourStep,steps.length-1);
    const [title, body, selector, tip] = steps[tourStep];
    const previousTarget=target,previousPosition=lastTourMotionKey?{left:parseFloat(help.style.left),top:parseFloat(help.style.top)}:null;
    target?.classList.remove('tour-target');
    const readyInvite=tourMode==='host' && selector==='#createInvitation' && invitationReady;
    target = $(readyInvite ? $('#hostInviteCard').dataset.transfer==='text'?'#createInvitationText':'#createInvitation' : selector);
    if(target?.classList.contains('source-picker-select'))target=target.closest('.source-picker').querySelector('.source-picker-trigger');
    if(selector==='#clientFullscreen' && matchMedia('(max-width:700px)').matches && $('#clientSettingsFullscreen'))target=$('#clientSettingsFullscreen');
    document.dispatchEvent(new CustomEvent('reveal-call-setting',{detail:target}));
    revealMobileTarget(target);
    for(let parent=target?.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;
    target.classList.add('tour-target');
    help.dataset.scenario=scenario; help.dataset.mode=tourMode;
    $('#tourTitle').textContent = title;
    $('#tourProgress').textContent = `${tourMode==='host'?'Hosting':'Joining'} · ${tourStep+1} / ${steps.length}`;
    $('#tourBody').textContent = readyInvite ? 'Send the invite file or copied text to your guest. Downloading or copying again uses this same invite.' : body;
    $('#tourTip').textContent = tip; $('#tourBack').disabled = tourStep === 0;
    const sendingFile=['#createInvitation','#downloadReply','#clientReplyAction'].includes(selector);
    $('#tourNext').disabled=selector==='#hostDesktopScope' && ($('#hostDesktopScope').value==='off' || $('#hostDesktopMouse').disabled && $('#hostDesktopKeyboard').disabled);
    $('#tourNext').textContent = tourStep===steps.length-1?'Done':scenario==='connect' && tourStep===1 && sendingFile?'I sent it':'Next';
    $('#tourOptional').hidden = scenario!=='connect' || tourStep !== 3 || tourMode !== 'host';
    if ((scroll || target!==previousTarget) && !target.hidden) target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    positionTour(); requestAnimationFrame(positionTour);
    const motionKey=[tourMode,scenario,tourStep,selector,readyInvite].join(':');
    if(motionKey!==lastTourMotionKey){guideContent.scrollTop=0;lastTourMotionKey=motionKey;document.dispatchEvent(new CustomEvent('tour-step-motion',{detail:{dialog:help,target,previous:previousPosition}}));}
  }
  function openTour() {
    tourMode = document.body.dataset.mode || 'host'; invitationReady = !$('#downloadInvitation').disabled;
    const desktop=tourMode==='host'?$('#hostDesktopScope').value!=='off':$('#clientDesktopMouse').checked || $('#clientDesktopTyping').checked;
    $('#tourScenario').value=desktop?'desktop':'connect';topics.open=false;
    scenario=$('#tourScenario').value || 'connect';
    // Replay starts at the first action that is still needed.
    tourStep = startingStep();
    help.show(); renderTour();
    // Nonmodal tips leave the highlighted application button usable.
    if (!target.disabled) target.focus({ preventScroll: true });
  }
  function finishTour() {
    document.dispatchEvent(new Event('tour-motion-end'));lastTourMotionKey=null;target?.classList.remove('tour-target'); target = null; help.close();
    try { localStorage.setItem(`webrtc-pad:tour-v1:${tourMode}`, 'seen'); } catch { /* Optional storage. */ }
  }
  function nextTour() {
    const steps=currentTour(),next=steps[tourStep+1];
    if(tourMode==='host' && !sessionActive && next && $(next[2])?.closest('#hostSessionContent')) {
      tourStep=Math.max(0,steps.findIndex(step=>step[2]==='#hostCreate'));
      renderTour();toast('Click Start a session to continue.');return;
    }
    if(tourMode==='host' && next && $(next[2])?.closest('#hostReplyStep') && $('#hostReplyStep').hidden){
      if(hostPairState==='connected'){tourStep=steps.length-1;renderTour();}
      else toast('Create an invite and send it to your guest first.');
      return;
    }
    if(tourStep<steps.length-1){tourStep++;renderTour();}else finishTour();
  }
  function startingStep() {
    if(document.body.dataset.sessionInvites==='true' && tourMode==='host' && document.body.dataset.sessionHostFiles!=='true' && sessionActive)return $('#sessionConnect').textContent!=='Online'?1:Number($('#peopleCount').textContent)>1 && !$('#sessionJoinRequests').children.length?3:2;
    if(tourMode==='host' && sessionActive) {
      if(scenario==='connect')return Number($('#hostInviteCard').dataset.pending)>0?invitationReady && !inviteSaved?1:2:hostPairState==='connected'?3:1;
      if(scenario!=='server')return 0;
    }
    if(tourMode==='client' && ['connect','input','desktop'].includes(scenario)) {
      if(document.body.dataset.sessionJoinPending==='true')return 1;
      if(playerState==='connected')return scenario==='connect' && $('#clientEnablePad').dataset.canPlay==='true' && Number($('#clientEnablePad').dataset.joined)>0?3:2;
      if(['waiting','connecting'].includes(playerState))return 1;
    }
    return 0;
  }
  $('#tourScenario').onchange=()=>{scenario=$('#tourScenario').value;tourStep=startingStep();renderTour();};
  $('#showHelp').onclick = openTour;
  $('#tourBack').onclick = () => { if (tourStep) tourStep--; renderTour(); };
  $('#tourNext').onclick = nextTour;
  $('#tourShare').onclick = () => { finishTour(); $('#hostCapture').click(); };
  $('#tourSettings').onclick = () => { finishTour(); $('#qualityToggle').click(); };
  for (const id of ['closeHelp', 'helpDone']) $(`#${id}`).onclick = finishTour;
  window.addEventListener('keydown', event => { if (help.open && event.key === 'Escape') { event.preventDefault(); finishTour(); } });
  window.addEventListener('resize', () => {if(help.open && target)target.scrollIntoView({block:'center',behavior:'auto'});positionTour();}); window.addEventListener('scroll', positionTour, true);
  new ResizeObserver(positionTour).observe(help);
  document.addEventListener('quick-start', event => {
    sessionFlowUI();
    if (!help.open) return;
    const action = event.detail;
    if(tourMode==='client' && ['session-requested','session-request-cancelled'].includes(action)){tourStep=action==='session-requested'?1:0;renderTour();return;}
    if(['client-controls-ready','refresh','host-capture-updated','host-source-updated','host-source-ready'].includes(action)){renderTour(false);return;}
    if(scenario!=='connect') {
      const selector=currentTour()[tourStep]?.[2];
      if(action==='host-started' && ['#hostCreate','#hostNextStep'].includes(selector) || action==='client-reply-ready' && selector==='label[for="clientInvitationFile"]')nextTour();
      if(action==='host-invite-ready' && ['#createInvitation','#newInvitation'].includes(selector)){invitationReady=true;renderTour();}
      if(action==='host-reply-opened' && selector==='label[for="hostReplyFile"]' || action==='client-controller-enabled' && ['#clientEnablePad','#clientEnableGroup','#clientJoinControllers','#connectedControllers'].includes(selector))nextTour();
      return;
    }
    if (tourMode === 'host') {
      if(action==='session-online' && document.body.dataset.sessionInvites==='true' && tourStep===1){nextTour();return;}
      if (action === 'host-started' && tourStep === 0) nextTour();
      if (action === 'host-invite-ready' && tourStep === 1) { invitationReady = true; renderTour(); }
      if (action === 'host-reply-opened') { tourStep = 3; renderTour(); }
    } else {
      if (action === 'client-reply-ready' && tourStep === 0) nextTour();
      if (action === 'client-controller-enabled') { tourStep = 3; renderTour(); }
    }
  });
  $('#downloadInvitation').addEventListener('click', event => {inviteSaved=true;sessionFlowUI();if(event.currentTarget.dataset.automaticDownload==='true'){if(help.open)renderTour(false);return;}if (help.open && tourMode==='host' && currentTour()[tourStep]?.[2]==='#createInvitation')nextTour();});
  $('#downloadReply').addEventListener('click', event => {replySaved=true;sessionFlowUI();if(event.currentTarget.dataset.automaticDownload==='true'){if(help.open)renderTour(false);return;}if (help.open && tourMode==='client' && ['#downloadReply','#clientReplyAction'].includes(currentTour()[tourStep]?.[2]))nextTour();});
  for(const id of ['captureBackend','captureTarget','hostDynamicControllers','clientReceiveVideo','hostDesktopFull'])$(`#${id}`).addEventListener('change',()=>renderTour(false));
  function firstVisit() {
    if (help.open && tourMode !== document.body.dataset.mode) finishTour();
    let seen = false;
    try { seen = localStorage.getItem(`webrtc-pad:tour-v1:${document.body.dataset.mode}`) === 'seen'; } catch { seen = true; }
    if (!seen && !help.open) openTour();
  }
  for (const id of ['modeHost', 'modeClient']) $(`#${id}`).addEventListener('click', firstVisit);
  // The call shell moves setup controls and creates the desktop scope selector
  // immediately after initUI. Start guidance once those controls exist.
  queueMicrotask(firstVisit);
  $('.mode-switch').addEventListener('keydown', e => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const buttons=[$('#modeHost'),$('#modeClient')].filter(button=>!button.hidden);
    const index=Math.max(0,buttons.indexOf(document.activeElement));
    const button=e.key==='Home'?buttons[0]:e.key==='End'?buttons.at(-1):buttons[(index+(e.key==='ArrowLeft'?-1:1)+buttons.length)%buttons.length];
    button?.click();button?.focus();
  });
  $('#clientVideo').addEventListener('loadeddata', () => playerVideoUI(true));
  $('#clientVideo').addEventListener('volumechange', () => soundUI($('#clientVideo').muted));
  $('#clientVideo').controls = false;
  $('#clientVideo').addEventListener('click', () => { const video = $('#clientVideo'); video.focus(); if ($('#clientVideoToggle').checked && video.srcObject) video.play().catch(() => {}); });
  $('#clientVideo').tabIndex = 0;
  $('#clientVideoToggle').addEventListener('change', () => playerVideoUI(hasVideo));
  $('#hostPreviewToggle').addEventListener('change', () => hostSharingUI(sharing));
  $('#inputSource').addEventListener('change', inputSourceUI);
  inputSourceUI();
  sessionFlowUI();
}
