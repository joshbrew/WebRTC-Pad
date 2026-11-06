import {guestPlatform,guestSetupNotes} from './guest-platform.js';
const $=id=>document.getElementById(id);
export class NativeGuestInput {
  constructor({session,probe,onPrepare,onActive,onState,onRelease,onBrowser,onPreference,onViewChange}){
    Object.assign(this,{session,probe,onPrepare,onActive,onState,onRelease,onBrowser,onPreference,onViewChange});this.pads=[];this.devices=[];this.selection=[];
    // Ignore the old per-device/copy-mode preference from earlier versions.
    // The simplified controller toggle starts on unless explicitly changed here.
    this.preferBlocking=true;try{this.preferBlocking=localStorage.getItem('webrtc-pad:block-local-controller-input:v2')!=='false';}catch{}
    $('nativeGuestBlockLocal').checked=this.preferBlocking;
    $('nativeGuestBlockLocal').onchange=()=>this.setPreference($('nativeGuestBlockLocal').checked);
    $('nativeGuestOptions').addEventListener('toggle',()=>{if($('nativeGuestOptions').open)this.connect();else if(!this.active && !this.switching)this.ws?.close();});
    $('nativeGuestRefresh').onclick=()=>{
      if(this.active || this.switching)return;
      this.paused=false;
      // Driver availability is read at helper startup. Reopen the idle reader
      // so Refresh works after installation instead of repeating stale notes.
      const previous=this.ws;this.ws=null;this.devices=[];this.available=false;this.renderDevices();this.paint();$('nativeGuestStatus').textContent='Checking devices…';
      if(previous && previous.readyState<3){previous.addEventListener('close',()=>{if($('nativeGuestOptions').open)this.connect();},{once:true});previous.close();}else this.connect();
    };
    $('nativeGuestIdentify').onclick=()=>this.post({type:'identify'});
    $('nativeGuestStart').onclick=()=>this.start();
    $('nativeGuestStop').onclick=()=>this.stop();
    $('nativeGuestBrowser').onclick=()=>this.setPreference(false);
    this.recovery=document.createElement('div');this.recovery.id='nativeGuestRecovery';this.recovery.className='native-setup-card';this.recovery.hidden=true;
    const note=this.recoveryNote=document.createElement('p');note.className='small';
    const setup=document.createElement('button');setup.className='button small-button';setup.textContent='Set up blocking';setup.onclick=()=>{$('controllerAdvanced').open=true;$('nativeGuestOptions').open=true;this.setupCard(true);$('nativeGuestCopySetup').focus();};
    const actions=document.createElement('div');actions.className='row';$('nativeGuestBrowser').textContent='Use without local blocking';actions.append($('nativeGuestBrowser'),setup);this.recovery.append(note,actions);$('connectedControllers').after(this.recovery);
    $('nativeGuestCopySetup').onclick=async()=>{try{await navigator.clipboard.writeText($('nativeGuestSetupCommand').textContent);$('nativeGuestCopySetup').textContent='Copied';}catch{$('nativeGuestStatus').textContent='Select and copy the setup command above, then run it in your app folder.';}};
    document.addEventListener('app-mode',()=>{if(this.isGuest){this.paused=false;this.prepare();}else this.releaseForHost();});
    this.timer=setInterval(()=>this.tick(),500);
    window.addEventListener('pagehide',()=>{this.post({type:'stop'});this.ws?.close();});
    this.paint();
  }
  get isGuest(){return document.body.dataset.mode==='client' && !this.hostingBlocked && !this.session().hosting;}
  get controllersEnabled(){return this.session().controllersEnabled!==false;}
  get browserFallback(){return this.isGuest && this.controllersEnabled && this.preferBlocking && this.localAvailable!==false && !this.active && !this.switching && (this.available===false || this.fallbackUnavailable===true || this.controllerSetupNeeded===true);}
  get blocksBrowser(){return this.isGuest && this.controllersEnabled && this.preferBlocking && this.localAvailable!==false && ['win32','linux','darwin'].includes(this.platform) && !this.active && !this.browserFallback;}
  get needsControllerSetup(){return this.isGuest && this.controllersEnabled && this.preferBlocking && this.localAvailable!==false && !this.switching && (this.available===false || this.controllerSetupNeeded===true || this.paused===true || this.devices.some(d=>d.kind==='gamepad' && !d.available));}
  controllerSharingChanged(){
    if(!this.controllersEnabled){clearTimeout(this.applyTimer);this.autoPending=false;this.stop('Controller sharing is off. Local inputs released.');this.latched=false;this.pads=[];this.selection=[];this.awaitingState=false;}
    else {this.paused=false;this.prepare();}
    this.paint();
  }
  releaseForHost(){
    clearTimeout(this.applyTimer);this.autoPending=false;this.stop('Hosting uses local controllers normally. Input blocking is off.');
    this.latched=false;this.pads=[];this.selection=[];this.devices=[];this.listPending=false;this.renderDevices();if(!this.hostingBlocked){const ws=this.ws;this.ws=null;ws?.close();}this.paint();
  }
  applySetupChoice(value){
    let previous;try{previous=localStorage.getItem('webrtc-pad:driver-setup-choice');}catch{}
    if(value.installDeclined && previous!=='skip')this.setPreference(false);
    if(value.installApproved && previous==='skip')this.setPreference(true);
    if(value.installDeclined || value.installApproved)try{localStorage.setItem('webrtc-pad:driver-setup-choice',value.installDeclined?'skip':'install');}catch{}
  }
  setLocalAvailable(value){this.localAvailable=value;$('nativeGuestBlockLocal').closest('label').hidden=!value;$('nativeGuestOptions').hidden=!value;this.paint();}
  setPreference(value){
    this.preferBlocking=value;this.paused=false;if(value)this.fallbackUnavailable=false;$('nativeGuestBlockLocal').checked=value;
    try{localStorage.setItem('webrtc-pad:block-local-controller-input:v2',String(value));}catch{}
    clearTimeout(this.applyTimer);this.autoPending=false;
    if(!value){if(this.active || this.switching)this.stop();this.latched=false;this.pads=[];this.onBrowser();}
    else {this.onPreference?.();this.prepare();}
    this.paint();
  }
  prepare(){if(this.isGuest && this.controllersEnabled && this.preferBlocking && !this.paused && this.localAvailable!==false && ['win32','linux','darwin'].includes(this.platform)){$('nativeGuestOptions').open=true;this.connect();this.reserveControllers();}}
  reserveControllers(){
    if(!this.isGuest || !this.controllersEnabled || !this.preferBlocking || this.browserFallback || this.paused || this.switching || this.active && !this.reservation)return;
    const ids=this.devices.filter(d=>d.kind==='gamepad' && d.available).map(d=>d.id);
    if(!ids.length || this.active && ids.length===this.selection.length && ids.every(id=>this.selection.includes(id)))return;
    this.autoPending=true;this.applySelection();
  }
  selectionChanged(){
    this.paint();
    if(!this.preferBlocking)return;
    clearTimeout(this.applyTimer);
    this.applyTimer=setTimeout(()=>{this.autoPending=true;this.applySelection();},350);
  }
  applySelection(){
    if(!this.isGuest || !this.controllersEnabled || !this.autoPending || this.switching)return;
    const ids=this.chosen();
    if(ids.some(id=>!id.startsWith('pad:')))return; // Keyboard/mouse require selecting devices and clicking Start.
    if(!ids.length){this.autoPending=false;if(this.active){this.onPrepare({reconfigure:true,devices:[]});this.stop('Selected controllers released.');}return;}
    this.autoPending=false;this.start(true);
  }
  connect(){
    if(!this.isGuest)return;
    if(this.ws && this.ws.readyState<2){if(this.ws.readyState===1 && !this.active && !this.switching && !this.devices.length && !this.listPending)this.post({type:'list'});return;}
    const ws=this.ws=new WebSocket(`${location.protocol==='https:'?'wss:':'ws:'}//${location.host}/guest-input`);
    ws.onopen=()=>this.post({type:'list'});
    ws.onmessage=event=>{let value;try{value=JSON.parse(event.data);}catch{return;}
      if(this.ws!==ws)return;
      if(value.type==='hosting'){this.hostingBlocked=value.active===true;if(this.hostingBlocked)this.releaseForHost();else{this.paused=false;this.prepare();}return;}
      if(!this.isGuest){this.releaseForHost();return;}
      if(value.type==='capability'){
        this.available=value.available;
        this.applySetupChoice(value);
        this.setPlatform(value.platform);this.setupCard(!value.available);$('nativeGuestStatus').textContent=value.installDeclined?'Using regular input sharing. Install optional blocking later with 09-Guest-Exclusive-Setup.':value.available?'Checking connected controllers…':'One-time setup is needed. Local input is still allowed.';
      }
      if(value.type==='devices'){
        this.listPending=false;
        this.controllerSetupNeeded=this.platform==='win32' && (value.notes || []).some(note=>typeof note==='string' && /HidHide is not available|controller isolation is unavailable/i.test(note));
        this.devices=value.devices;this.renderDevices();
        const notes=guestSetupNotes(value.notes,this.platform),list=$('nativeGuestSetupIssues');list.replaceChildren();
        for(const note of notes){const item=document.createElement('li');item.textContent=note;list.append(item);}
        const blockedPads=this.devices.some(d=>d.kind==='gamepad' && !d.available),readyPads=this.devices.some(d=>d.kind==='gamepad' && d.available);
        if(readyPads)this.fallbackUnavailable=false;else if(blockedPads)this.fallbackUnavailable=true;
        this.setupCard(this.controllerSetupNeeded);
        $('nativeGuestStatus').textContent=this.controllerSetupNeeded?'Controller input blocking needs setup. You can still use browser input sharing.':readyPads?this.active?'Local controller input is blocked.':this.preferBlocking?'Preparing local controller blocking…':'Local controller input is allowed.':blockedPads?'These controllers cannot be blocked right now. See advanced setup for details.':'Connect a controller and refresh.';
        if(this.devices.some(d=>d.reason==='reconnect-required'))$('nativeGuestStatus').textContent='Reconnect your controller to finish setup, or restart Windows, then refresh. Local input blocking is not active yet.';
        this.reserveControllers();
      }
      if(value.type==='activity'){
        const row=[...$('nativeGuestDevices').querySelectorAll('[data-device]')].find(row=>row.dataset.device===value.device);if(row){row.classList.add('input-activity');setTimeout(()=>row.classList.remove('input-activity'),600);$('nativeGuestActivity').textContent=`Input detected: ${row.querySelector('strong').textContent}`;}
      }
      if(value.type==='active'){if(!this.switching){this.post({type:'stop'});return;}this.switching=false;this.active=true;this.reservation=value.local===true;this.selection=value.devices;this.renderDevices();this.onActive(this.selection,this.keyboardMode);$('nativeGuestStatus').textContent=this.reservation?(this.platform==='win32'?'Controller blocking is active. Close and reopen local games or emulators that were already using the controller.':'Local controller input is blocked while this Join page is open.'):'Selected keyboard / mouse input is shared only with the host.';}
      // Device settings do not change with each input packet. Keep the hot
      // path on delivery; lease/status messages and tick() refresh controls.
      if(value.type==='state'){if(this.active){this.awaitingState=false;this.pads=value.gamepads || [];this.onState(value);}return;}
      if(['released','error'].includes(value.type)){
        this.listPending=false;
        const used=this.active || this.switching,controllerDisconnect=used && this.reservation && this.selection.length>0 && this.selection.every(id=>id.startsWith('pad:')) && /(?:controller|device) (?:disconnected|reconnected)|selected (?:HID )?device disconnected/i.test(value.error || value.reason || '');
        this.active=false;this.switching=false;this.pads=this.pads.map(p=>({...p,axes:p.axes.map(()=>0),buttons:p.buttons.map(()=>({pressed:false,value:0}))}));
        this.devices=[];this.renderDevices();
        if(used){this.paused=!controllerDisconnect;this.onRelease();}if(controllerDisconnect){this.pads=[];this.nextScan=performance.now()+800;}
        $('nativeGuestStatus').textContent=controllerDisconnect?'Controller disconnected. Reconnect it to continue.':guestSetupNotes([value.error || value.reason],this.platform)[0] || 'Devices released.';
      }
      this.paint();
    };
    ws.onclose=()=>{if(this.ws!==ws)return;this.ws=null;const used=this.active || this.switching;this.active=false;this.switching=false;if(used)this.onRelease();$('nativeGuestStatus').textContent='Native input disconnected. Devices are being released.';this.paint();};
    ws.onerror=()=>{};
  }
  post(value){if(this.ws?.readyState===1){if(value.type==='list')this.listPending=true;this.ws.send(JSON.stringify(value));}else if(value.type!=='stop')this.connect();}
  setPlatform(platform){this.platform=platform;this.setLocalAvailable(['win32','linux','darwin'].includes(platform));const info=guestPlatform(platform);$('nativeGuestIntro').textContent='Turn blocking off to use controllers in local apps too.';$('nativeGuestSetupCommand').textContent=platform==='win32'?'.\\windows\\shortcuts\\09-Guest-Exclusive-Setup.cmd':info.setup || 'npm run setup:guest';$('nativeGuestSetupHelp').textContent=info.intro+' '+info.help+' '+info.release;this.prepare();}
  setupCard(show){$('nativeGuestSetupCard').hidden=!show;}
  chosen(){return [...(this.preferBlocking && this.controllersEnabled?this.devices.filter(d=>d.kind==='gamepad' && d.available).map(d=>d.id):[]),...Array.from($('nativeGuestOtherList').querySelectorAll('input:checked'),input=>input.value)];}
  permitted(ids,session){return ids.every(id=>id.startsWith('mouse:')?session.mouseAllowed:id.startsWith('keyboard:')?(this.keyboardMode==='desktop'?session.typingAllowed:session.keyboardAllowed):true);}
  start(automatic=false){
    if(!this.isGuest){this.releaseForHost();return;}
    if(automatic && !this.controllersEnabled)return;
    const session=this.session(),devices=this.chosen();this.keyboardMode=$('nativeGuestKeyboardMode').value;
    const reservation=this.preferBlocking && devices.length>0 && devices.every(id=>id.startsWith('pad:'));
    if(!reservation && (!session.connected || !session.dynamic || !session.canPlay)){$('nativeGuestStatus').textContent='Connect to a host before sharing keyboard or mouse input.';return;}
    if(!this.permitted(devices,session)){$('nativeGuestStatus').textContent='Ask the host to allow the selected mouse or keyboard input first.';return;}
    if(!devices.length)return;
    const reconfigure=this.active;
    this.latched=true;this.switching=true;this.active=false;this.reservation=reservation;this.awaitingState=true;this.selection=devices;this.pads=[];this.onPrepare({reconfigure,devices});this.post({type:'start',devices,connected:session.connected,local:reservation});this.paint();
  }
  stop(message){this.paused=true;this.post({type:'stop'});const used=this.active || this.switching;this.active=false;this.switching=false;if(used)this.onRelease();if(message)$('nativeGuestStatus').textContent=message;this.paint();}
  endSession(){if(this.browserFallback && !this.active && !this.switching)return;if(!this.reservation || !(this.active || this.switching))this.stop();}
  prepareResume(){
    this.paused=false;$('nativeGuestOptions').open=true;this.connect();this.reserveControllers();
    $('nativeGuestStatus').textContent='Controller blocking resumes automatically. Select keyboard or mouse devices below if needed.';
    $('nativeGuestOptions').scrollIntoView({block:'center',behavior:'smooth'});
  }
  tick(){
    if(!this.isGuest){if(this.ws && !this.hostingBlocked || this.active || this.switching || this.autoPending)this.releaseForHost();return;}
    const now=performance.now(),scanIdle=this.controllersEnabled && ['win32','linux','darwin'].includes(this.platform) && this.preferBlocking && !this.paused && this.localAvailable!==false && !this.active && !this.switching && !this.controllerSetupNeeded;
    if(!this.ws || this.ws.readyState>1){if(scanIdle && now>=(this.nextScan || 0)){this.nextScan=now+2000;this.connect();}return;}
    if(this.ws.readyState!==1 || now-(this.lastTick ?? -Infinity)<400)return;this.lastTick=now;this.probe();
    // Re-enumerate an idle reader after hot-unplug, including controllers that
    // reconnect under a new native ID. Never refresh an active keyboard/mouse grab.
    if(scanIdle && this.available && !this.listPending && !this.devices.some(d=>d.kind==='gamepad' && d.available) && now>=(this.nextScan || 0)){this.nextScan=now+2000;this.post({type:'list'});}
    this.applySelection();
    const session=this.session();
    if((this.active || this.switching) && !this.reservation && (!session.connected || !session.enabled || !this.permitted(this.selection,session)))this.stop('Sharing paused or host permission changed. Devices released.');
    // Identify mode passes input through locally, but still has a short lease.
    this.post({type:'heartbeat',connected:this.active || this.switching?session.connected:true,local:this.reservation===true});this.paint();
  }
  renderDevices(){
    // Controller reservations cover the current inventory. Keyboard/mouse IDs
    // are never carried across inventories because native handles can be reused.
    $('nativeGuestControllers').replaceChildren();$('nativeGuestOtherList').replaceChildren();
    for(const device of this.devices){
      const controller=device.kind==='gamepad',row=document.createElement(controller?'div':'label');row.className='native-device check-row';row.dataset.device=device.id;
      const text=document.createElement('span'),name=document.createElement('strong'),detail=document.createElement('small');name.textContent=device.label;
      detail.textContent=!device.available?device.reason==='reconnect-required'?'Reconnect controller / restart Windows':this.controllerSetupNeeded && controller?'Setup needed':'Not ready':this.active && this.selection.includes(device.id)?'Local input blocked':controller && !this.preferBlocking?'Local input allowed':'Ready';row.title=device.detail || '';
      if(!controller){const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.value=device.id;checkbox.disabled=!device.available;checkbox.checked=this.active && this.selection.includes(device.id);checkbox.onchange=()=>this.selectionChanged();row.append(checkbox);}
      text.append(name,detail);row.append(text);$(controller?'nativeGuestControllers':'nativeGuestOtherList').append(row);
    }
    if(!this.devices.some(d=>d.kind==='gamepad'))$('nativeGuestControllers').textContent='No controllers found. Connect one and refresh.';
    if(!this.devices.some(d=>d.kind!=='gamepad'))$('nativeGuestOtherList').textContent=this.platform==='win32'?'No keyboards or mice detected. Restart Windows after setup, then refresh. If needed, close the app and run 09-Guest-Exclusive-Setup to repair input blocking.':'No keyboards or mice found. See advanced setup for device permissions.';
  }
  paint(){
    const running=this.active || this.switching,session=this.session();
    $('controllerSetup').dataset.inputMode=this.isGuest && this.controllersEnabled && this.preferBlocking && !this.browserFallback && this.localAvailable!==false && ['win32','linux','darwin'].includes(this.platform)?'native':'browser';
    $('nativeGuestBlockLocal').disabled=!this.isGuest;
    $('controllerSetup').dataset.blockingState=this.switching?'starting':this.active?'active':this.blocksBrowser?'waiting':'copy';
    const set=(element,key,value)=>{if(element[key]!==value)element[key]=value;};
    set($('nativeGuestStart'),'disabled',!!(!this.available || this.switching || this.active && !this.reservation || !this.chosen().length || !session.connected || !session.canPlay));
    set($('nativeGuestStop'),'disabled',!running);set($('nativeGuestStop'),'hidden',!running || this.reservation);set($('nativeGuestRefresh'),'disabled',!!running);set($('nativeGuestIdentify'),'disabled',!!(running || !this.available));
    set(this.recovery,'hidden',!this.needsControllerSetup);set($('nativeGuestBrowser'),'hidden',!this.needsControllerSetup || this.browserFallback);
    set(this.recoveryNote,'textContent',this.browserFallback?'Controllers are using browser input. Local input blocking is unavailable, so local games and Steam may respond too.':'Local input blocking needs setup. You can share controllers without it, but local games and Steam may respond too.');
    for(const input of $('nativeGuestDevices').querySelectorAll('input'))set(input,'disabled',!!(this.switching || this.active && !this.reservation || !this.devices.find(d=>d.id===input.value)?.available));
    set($('nativeGuestKeyboardMode'),'disabled',!!(running && !this.reservation));
    set($('nativeGuestInputCaution'),'hidden',!this.chosen().some(id=>!id.startsWith('pad:')));
    set($('nativeGuestStart'),'hidden',this.preferBlocking && !this.chosen().some(id=>!id.startsWith('pad:')));
    set($('backgroundGamepad'),'disabled',false);
    set($('backgroundGamepadOption'),'hidden',!!running);
    set($('backgroundGamepadHint'),'textContent',running?'Controller blocking keeps background input on automatically.':'Keep gamepad input active when Discord or another window is in front. Keyboard controls still require focus unless using native keyboard sharing.');
    set($('guestLocalInputNote'),'textContent',this.hostingBlocked || session.hosting?'Local input stays available while this computer is hosting.':!this.controllersEnabled?'Sharing off · controllers work on this computer.':running?'Local input blocked · background play is on.':this.browserFallback?'Browser controller sharing is ready · local input is not blocked.':this.preferBlocking && this.localAvailable!==false?'Local input blocking is on. Turn sharing off to use controllers here.':'Local input is allowed · controllers can also control apps on this computer.');
    if(this.blocksBrowser){
      for(const id of ['clientEnablePad','clientEnableGroup']){const button=$(id);set(button,'textContent','Check controller setup');button.setAttribute('aria-pressed','false');}
    }
    this.onViewChange?.(this);
  }
}
