import {defaultKeyboardBindings,cleanKeyboardBindings,buttonLabels,standardProfile,keyboardState,packGamepadState,neutralState,cleanCalibration,calibrationFromSamples} from './input.js';

const storageKey='webrtc-pad:keyboard-layout-v1',profilesKey='webrtc-pad:input-profiles-v1';
export const mappingTemplates={
  generic:{label:'Generic · button positions',buttons:{}},
  xbox:{label:'Xbox / XInput',buttons:{a:'A',b:'B',x:'X',y:'Y',lb:'LB',rb:'RB',back:'View',start:'Menu',guide:'Xbox / Guide'}},
  playstation:{label:'PlayStation / HID',buttons:{a:'Cross ×',b:'Circle ○',x:'Square □',y:'Triangle △',lb:'L1',rb:'R1',back:'Share',start:'Options',guide:'PS / Guide'}},
  switch:{label:'Switch Pro',buttons:{a:'B',b:'A',x:'Y',y:'X',lb:'L',rb:'R',back:'−',start:'+',guide:'Home'}}
};
export function keyName(code){if(/^Mouse[0-4]$/.test(code))return ['Left click','Middle click','Right click','Mouse back','Mouse forward'][Number(code.slice(5))];if(/^Wheel/.test(code))return code.replace('Wheel','Wheel ');return code?code.replace(/^Key/,'').replace(/^Digit/,'').replace(/^Arrow/,'').replace(/(Left|Right)$/,' $1'):'Unassigned';}
export function cleanGamepadProfile(value){
  const index=n=>Number.isInteger(n) && n>=0 && n<256?n:-1,profile={buttons:{},axes:{},triggers:{},deadzone:Math.max(0,Math.min(.5,Number(value?.deadzone) || 0))};
  for(const key of Object.keys(buttonLabels)){const b=value?.buttons?.[key];profile.buttons[key]=b && typeof b==='object'?{axis:index(b.axis),invert:b.invert===true,threshold:.5}:index(b);}
  for(const key of ['lx','ly','rx','ry']){const b=value?.axes?.[key];profile.axes[key]={index:index(b?.index),invert:b?.invert===true};}
  for(const key of ['lt','rt']){const b=value?.triggers?.[key];profile.triggers[key]=index(b?.button)>=0?{button:b.button}:index(b?.axis)>=0?{axis:b.axis,invert:b.invert===true,...(b.half===true?{half:true}:{})}:{};}
  profile.calibration=cleanCalibration(value?.calibration);return profile;
}
export function portableProfile(value){
  if(value?.version!==1 || !['keyboard','gamepad'].includes(value.kind) || !Object.hasOwn(mappingTemplates,value.template))throw Error('Choose a WebRTC Pad mapping profile.');
  return {version:1,kind:value.kind,template:value.template,name:typeof value.name==='string'?value.name.slice(0,48):'',...(value.kind==='keyboard'?{bindings:cleanKeyboardBindings(value.bindings)}:{profile:cleanGamepadProfile(value.profile)})};
}
const sections=[['buttons','Buttons',['a','b','x','y','lb','rb','back','start','ls','rs','guide']],['left-stick','Control stick',['lyPositive','lyNegative','lxNegative','lxPositive']],['right-stick','Right stick',['ryPositive','ryNegative','rxNegative','rxPositive']],['triggers','Triggers',['lt','rt']],['dpad','D-pad',['up','down','left','right']]];
const directions={lyPositive:'Up',lyNegative:'Down',lxNegative:'Left',lxPositive:'Right',ryPositive:'Up',ryNegative:'Down',rxNegative:'Left',rxPositive:'Right'};

// Input profiles do not change the host driver or grant desktop permissions.
export class KeyboardMapping{
  constructor(root,{release=()=>{},changed=()=>{},getPads=()=>[],profileFor=()=>null,saveProfile=()=>{},afterClose=()=>{},defaultDevice=()=>'keyboard',nativeActive=()=>false}={}){
    Object.assign(this,{root,release,changed,getPads,profileFor,saveProfile,afterClose,defaultDevice,nativeActive});this.bindings={...defaultKeyboardBindings};this.template='generic';this.profiles=Object.create(null);
    try{const saved=JSON.parse(localStorage.getItem(storageKey));if(saved?.version===1){this.bindings=cleanKeyboardBindings(saved.bindings);if(Object.hasOwn(mappingTemplates,saved.template))this.template=saved.template;}
      const profiles=JSON.parse(localStorage.getItem(profilesKey));if(profiles && typeof profiles==='object' && !Array.isArray(profiles))this.profiles=Object.assign(Object.create(null),profiles);
    }catch{/* Defaults work without browser storage. */}
    root.innerHTML=`<button data-keyboard="open" class="button small-button full"><svg class="icon" aria-hidden="true"><use href="#i-settings"/></svg> Controller &amp; keyboard mapping</button>
      <dialog class="wp-dialog keyboard-dialog emulator-mapper" data-keyboard="dialog" aria-labelledby="keyboardLayoutTitle">
      <div class="wp-dialog-heading dialog-heading"><h3 id="keyboardLayoutTitle">Controller mapping</h3><button data-keyboard="close" class="help-button" aria-label="Close controller mapping">×</button></div>
      <p class="small muted">Choose a device and template. Click a control, then press a key, button or stick direction to bind it.</p>
      <div class="mapper-setup">
        <fieldset><legend>Device</legend><select data-keyboard="device" aria-label="Mapping device"></select><button data-keyboard="refresh" class="button small-button">Refresh</button></fieldset>
        <fieldset><legend>Template</legend><select data-keyboard="names" aria-label="Controller template"></select><button data-keyboard="template" class="button small-button">Load template</button></fieldset>
        <fieldset><legend>Profile</legend><select data-keyboard="profiles" aria-label="Saved mapping profile"></select><button data-keyboard="load" class="button small-button">Load</button></fieldset>
      </div>
      <p data-keyboard="discovery" class="small muted" role="status" hidden>Click this app, then press a controller button or move a stick. Your browser may hide connected controllers until you use one. The device list updates automatically.</p>
      <div class="mapper-options"><label data-keyboard="preset-field" class="field-label">Keyboard starting layout<select data-keyboard="preset"><option value="arrows">Arrows · D-pad</option><option value="wasd">WASD · left stick</option><option value="custom">Custom</option></select></label><label data-keyboard="deadzone-field" class="field-label">Stick deadzone (%)<input data-keyboard="deadzone" type="number" min="0" max="50" step="1" value="12" /></label><p data-keyboard="device-note" class="small muted"></p></div>
      <div data-keyboard="tabs" class="wp-tabs keyboard-tabs" role="tablist" aria-label="Controller controls"><button data-group="all" type="button" role="tab" aria-controls="keyboardLayoutFields">All controls</button><button data-group="buttons" type="button" role="tab" aria-controls="keyboardLayoutFields">Buttons</button><button data-group="movement" type="button" role="tab" aria-controls="keyboardLayoutFields">Sticks &amp; D-pad</button></div>
      <div id="keyboardLayoutFields" data-keyboard="fields" class="mapper-sections" role="tabpanel"></div>
      <p data-keyboard="status" class="small muted mapper-status" role="status"></p>
      <div class="mapper-footer"><label class="field-label">Profile name (optional)<input data-keyboard="profile-name" maxlength="48" placeholder="e.g. My platformer layout" /></label><div class="row"><button data-keyboard="save" class="button primary">Save layout</button><button data-keyboard="reset" class="button small-button">Default</button><button data-keyboard="clear" class="button small-button">Clear</button></div></div>
      <details class="advanced mapper-profile-tools"><summary>Calibration &amp; profiles</summary><div class="row"><button data-keyboard="calibrate" class="button small-button">Calibrate sticks &amp; triggers</button><button data-keyboard="import" class="button small-button"><svg class="icon" aria-hidden="true"><use href="#i-file"/></svg> Import</button><button data-keyboard="export" class="button small-button"><svg class="icon" aria-hidden="true"><use href="#i-download"/></svg> Export</button><input data-keyboard="file" type="file" accept=".json,application/json" hidden /></div><p class="small muted">To calibrate, release the sticks first, then move sticks and triggers through their full range. Save layout to apply your changes.</p></details>
      <p class="small muted">Templates use browser-standard button positions. For an unrecognized gamepad, bind each control before saving. The host chooses its virtual output (XInput, HID or platform gamepad). Keys, mouse buttons and wheel directions can control a gamepad without desktop access. These stick and trigger bindings are digital.</p>
      </dialog>`;
    this.$=name=>root.querySelector(`[data-keyboard="${name}"]`) || this.dialog?.querySelector(`[data-keyboard="${name}"]`);
    this.dialog=this.$('dialog');document.body.append(this.dialog);this.device='keyboard';this.group='all';
    for(const [value,template] of Object.entries(mappingTemplates))this.$('names').add(new Option(template.label,value));this.$('names').value=this.template;
    this.$('open').onclick=()=>this.open(this.defaultDevice());this.$('close').onclick=()=>this.dialog.close();
    this.dialog.addEventListener('close',()=>{this.cancel();cancelAnimationFrame(this.frame);this.testKeys?.clear();this.afterClose();if(!this.returnFocus?.isConnected){const sheet=this.root.closest('.call-sheet');if(sheet?.open)sheet.querySelector('.call-sheet-heading button')?.focus({preventScroll:true});}});
    this.dialog.addEventListener('keydown',event=>{
      if(this.listening || /INPUT|SELECT|TEXTAREA/.test(event.target.tagName))return;
      if(Object.values(this.draft).includes(event.code)){this.testKeys.add(event.code);if(event.code!=='Enter' || event.target.tagName!=='BUTTON')event.preventDefault();}
    });
    const assignMouse=(event,code)=>{if(!this.dialog.open || !this.keyboard || !this.listening || event.target.closest('[data-keyboard=save],[data-keyboard=close]'))return;event.preventDefault();event.stopPropagation();const key=this.listening;this.draft[key]=code;this.assigned(key);};
    this.dialog.addEventListener('pointerdown',event=>{if(event.pointerType==='mouse' && event.button>=0 && event.button<=4)assignMouse(event,`Mouse${event.button}`);},true);
    this.dialog.addEventListener('wheel',event=>{if(event.deltaY || event.deltaX)assignMouse(event,Math.abs(event.deltaY)>=Math.abs(event.deltaX)?event.deltaY<0?'WheelUp':'WheelDown':event.deltaX<0?'WheelLeft':'WheelRight');},{capture:true,passive:false});
    this.dialog.addEventListener('contextmenu',event=>{if(this.keyboard)event.preventDefault();});
    window.addEventListener('keyup',event=>this.testKeys?.delete(event.code));window.addEventListener('blur',()=>{this.cancel();this.testKeys?.clear();});
    this.$('refresh').onclick=()=>this.refreshDevices();this.$('device').onchange=()=>this.selectDevice(this.$('device').value);
    this.$('names').onchange=()=>{this.template=this.$('names').value;this.cancel();this.render();};
    this.$('template').onclick=()=>this.defaults();this.$('reset').onclick=()=>this.defaults();
    this.$('clear').onclick=()=>{this.cancel();this.draft=cleanKeyboardBindings({});this.profile=cleanGamepadProfile({});this.$('deadzone').value='0';this.render();this.status('All controls cleared. Assign controls, then Save layout.');};
    this.$('preset').onchange=()=>{if(this.$('preset').value!=='custom')this.defaults(this.$('preset').value);};
    this.$('deadzone').oninput=()=>{this.profile.deadzone=Math.max(0,Math.min(.5,Number(this.$('deadzone').value)/100 || 0));};
    this.$('load').onclick=()=>this.load();this.$('save').onclick=()=>this.save();
    this.$('export').onclick=()=>{const profile=portableProfile({version:1,kind:this.keyboard?'keyboard':'gamepad',template:this.template,name:this.$('profile-name').value,bindings:this.draft,profile:this.profile}),url=URL.createObjectURL(new Blob([JSON.stringify(profile,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='webrtc-pad-controller-profile.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
    this.$('import').onclick=()=>this.$('file').click();this.$('file').onchange=async()=>{try{const file=this.$('file').files[0];if(!file)return;if(file.size>32768)throw Error('Profile files must be smaller than 32 KB.');const profile=portableProfile(JSON.parse(await file.text()));if((profile.kind==='keyboard')!==this.keyboard)throw Error(`Select ${profile.kind==='keyboard'?'Keyboard':'a controller'} before importing this profile.`);this.cancel();this.template=profile.template;this.$('names').value=this.template;this.$('profile-name').value=profile.name;if(this.keyboard)this.draft=profile.bindings;else{this.profile=profile.profile;this.$('deadzone').value=String(Math.round(this.profile.deadzone*100));}this.render();this.status('Profile imported. Test the controls, then Save layout.');}catch(error){this.status(error.message);}finally{this.$('file').value='';}};
    this.$('calibrate').onclick=()=>{if(this.keyboard || !this.pad()){this.status('Select a connected controller first.');return;}if(this.calibrating){try{this.profile.calibration=calibrationFromSamples(this.calibrating.rest,this.calibrating.samples);this.calibrating=null;this.$('calibrate').textContent='Calibrate sticks & triggers';this.status('Calibration ready. Test the sticks and triggers, then Save layout.');}catch(error){this.status(error.message);}return;}this.cancel();const rest=packGamepadState(this.pad(),{...this.profile,calibration:{}},0);this.calibrating={rest,samples:[]};this.$('calibrate').textContent='Finish calibration';this.status('Rotate both sticks fully and pull both triggers, then click Finish calibration.');};
    this.$('profiles').onchange=()=>{this.$('load').disabled=!this.$('profiles').value;};
    for(const button of this.$('tabs').children)button.onclick=()=>{this.cancel();this.group=button.dataset.group;this.render();};
    this.$('tabs').onkeydown=event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const buttons=[...this.$('tabs').children],index=buttons.findIndex(b=>b.dataset.group===this.group),next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowRight'?1:buttons.length-1))%buttons.length;buttons[next].click();buttons[next].focus();};
    this.testKeys=new Set();this.draft={...this.bindings};this.profile=cleanGamepadProfile({...standardProfile,deadzone:.12});this.refreshDevices();this.changed(this.bindings);
    const refresh=()=>{if(this.dialog.open)this.refreshDevices();};
    for(const event of ['gamepadconnected','gamepaddisconnected','focus'])window.addEventListener(event,refresh);
  }
  get keyboard(){return this.device==='keyboard';}
  pad(){return [...this.getPads()].find(p=>p?.connected!==false && p?.index===this.padIndex && p?.id===this.padId);}
  open(device='keyboard'){
    this.returnFocus=document.activeElement;
    this.release();this.device=typeof device==='number'?String(device):device;this.group='all';this.refreshDevices();this.selectDevice(this.device);this.dialog.showModal();this.testKeys.clear();this.tick();
  }
  refreshDevices(){
    const pads=[...this.getPads()].filter(pad=>pad && pad.connected!==false),native=this.nativeActive();
    this.$('discovery').hidden=pads.length>0 || native;
    const signature=JSON.stringify([this.device,native,pads.map(pad=>[pad.index,pad.id])]);
    if(signature===this.deviceSignature)return;this.deviceSignature=signature;
    const select=this.$('device');select.replaceChildren(new Option('Keyboard','keyboard'));
    for(const pad of pads)select.add(new Option(`Controller ${pad.index+1} · ${pad.id}`,String(pad.index)));
    if(![...select.options].some(option=>option.value===this.device))select.add(new Option('Disconnected controller · reconnect or choose a device',this.device));
    select.value=this.device;
  }
  selectDevice(value){
    this.cancel();this.release();this.device=value;this.$('device').value=value;
    const gp=[...this.getPads()].find(p=>p?.index===Number(value));this.padIndex=gp?.index;this.padId=gp?.id;
    this.draft={...this.bindings};this.profile=cleanGamepadProfile(gp?(this.profileFor(gp) || {...standardProfile,deadzone:.12}):{...standardProfile,deadzone:.12});
    this.$('preset').value=JSON.stringify(this.bindings)===JSON.stringify(defaultKeyboardBindings)?'arrows':'custom';
    this.$('deadzone').value=String(Math.round(this.profile.deadzone*100));this.$('preset-field').hidden=!this.keyboard;this.$('deadzone-field').hidden=this.keyboard;
    this.$('device-note').textContent=this.keyboard?'Gameplay input pauses while this editor is open. Click a heading to test your assigned keys.':gp?.mapping==='standard'?'Browser-standard controller recognized. Move sticks or press buttons to test. Gameplay input pauses while editing.':'Bind each control on this device, then save. Gameplay input pauses while editing.';
    this.$('profile-name').value='';this.profileList();this.render();this.status('Click a binding to change it. Escape cancels; Delete clears the selected binding.');
  }
  profileList(){
    const select=this.$('profiles');select.replaceChildren(new Option('Choose a saved profile',''));
    for(const name of Object.keys(this.profiles).sort())if(this.profiles[name]?.kind===(this.keyboard?'keyboard':'gamepad'))select.add(new Option(name,name));
    this.$('load').disabled=true;
  }
  defaults(preset='arrows'){
    this.cancel();this.draft={...defaultKeyboardBindings};this.profile=cleanGamepadProfile({...standardProfile,deadzone:.12});
    if(preset==='wasd')Object.assign(this.draft,{lxNegative:'KeyA',lxPositive:'KeyD',lyPositive:'KeyW',lyNegative:'KeyS',a:'Space',b:'KeyE',x:'KeyJ',y:'KeyK',lb:'KeyQ',rb:'KeyR'});
    this.$('preset').value=preset;this.$('deadzone').value='12';this.render();this.status('Template loaded. Review the controls, then Save layout.');
  }
  status(text){this.$('status').textContent=text;}
  cancel(){this.listening=null;this.calibrating=null;if(this.$('calibrate'))this.$('calibrate').textContent='Calibrate sticks & triggers';}
  binding(key){
    if(this.keyboard)return keyName(this.draft[key]);
    if(directions[key]){const axis=key.slice(0,2),b=this.profile.axes[axis];return b?.index>=0?`Axis ${b.index} ${(key.endsWith('Positive')!==b.invert)?'+':'−'}`:'Unassigned';}
    if(['lt','rt'].includes(key)){const b=this.profile.triggers[key];return b?.button>=0?`Button ${b.button}`:b?.axis>=0?`Axis ${b.axis}${b.invert?' −':' +'}`:'Unassigned';}
    const b=this.profile.buttons[key];return typeof b==='number'?b>=0?`Button ${b}`:'Unassigned':b?.axis>=0?`Axis ${b.axis}${b.invert?' −':' +'}`:'Unassigned';
  }
  clear(key){if(this.keyboard)this.draft[key]='';else if(directions[key])this.profile.axes[key.slice(0,2)]={index:-1};else if(['lt','rt'].includes(key))this.profile.triggers[key]={};else this.profile.buttons[key]=-1;}
  render(){
    const fields=this.$('fields');fields.replaceChildren();fields.dataset.group=this.group;const names=mappingTemplates[this.template].buttons;
    for(const button of this.$('tabs').children){button.setAttribute('aria-selected',String(button.dataset.group===this.group));button.tabIndex=button.dataset.group===this.group?0:-1;}
    for(const [id,title,controls] of sections){
      if(this.group==='buttons' && id!=='buttons' && id!=='triggers' || this.group==='movement' && ['buttons','triggers'].includes(id))continue;
      const section=document.createElement('fieldset');section.className=`mapper-group mapper-${id}`;const legend=document.createElement('legend');legend.textContent=title;section.append(legend);
      if(id.endsWith('stick')){const stick=document.createElement('div');stick.className='mapper-stick';stick.dataset.stick=id==='left-stick'?'l':'r';const dot=document.createElement('span');dot.className='mapper-stick-dot';stick.append(dot);const readout=document.createElement('output');readout.className='small muted';stick.append(readout);section.append(stick);}
      for(const key of controls){
        const row=document.createElement('label'),label=document.createElement('span'),button=document.createElement('button');row.className='mapper-binding-row';label.textContent=names[key] || directions[key] || (key==='lt'?'Left analog':key==='rt'?'Right analog':buttonLabels[key]);
        button.type='button';button.className='button keyboard-binding';button.classList.toggle('is-listening',this.listening===key);button.dataset.binding=key;button.setAttribute('aria-pressed',String(this.listening===key));button.textContent=this.listening===key?'Press input…':this.binding(key);button.setAttribute('aria-label',`Assign ${this.keyboard?'key':'input'} for ${label.textContent}`);
        button.onclick=()=>{this.release();this.testKeys.clear();this.listening=key;const gp=this.pad();this.baseline={buttons:gp?.buttons.map(b=>b.value) || [],axes:[...(gp?.axes || [])]};this.listenUntil=performance.now()+15000;this.render();this.$('fields').querySelector(`[data-binding="${key}"]`).focus();this.status(this.keyboard?'Press a key, click a mouse button or scroll. Escape cancels; Delete clears this control.':'Release held inputs, then press a button or move a stick in the requested direction. Escape cancels; Delete clears.');};
        button.onkeydown=event=>{
          if(this.listening!==key)return;event.preventDefault();event.stopPropagation();
          if(event.code==='Escape'){this.cancel();this.render();this.status('Assignment cancelled.');return;}
          if(event.code==='Delete'){this.clear(key);this.assigned(key);return;}
          if(!this.keyboard)return;const value=cleanKeyboardBindings({[key]:event.code})[key];if(!value){this.status('Choose a letter, number, arrow or modifier key.');return;}this.draft[key]=value;this.assigned(key);
        };
        row.append(label,button);section.append(row);
        if(['lt','rt'].includes(key)){const meter=document.createElement('progress');meter.max=1;meter.value=0;meter.dataset.trigger=key;meter.setAttribute('aria-label',key==='lt'?'Left trigger input':'Right trigger input');section.append(meter);}
      }
      fields.append(section);
    }
  }
  assigned(key){this.cancel();this.$('preset').value='custom';this.render();const button=this.$('fields').querySelector(`[data-binding="${key}"]`);button?.focus();document.dispatchEvent(new CustomEvent('ui-control-commit',{detail:{target:button}}));this.status('Binding changed. Click Save layout to use it.');}
  detect(gp){
    const key=this.listening;if(!key || this.keyboard || !gp)return;
    if(performance.now()>this.listenUntil){this.cancel();this.render();this.status('No input detected. Click a binding to try again.');return;}
    // Held inputs must be released before they can become a new binding.
    gp.buttons.forEach((b,i)=>{if(b.value<.2)this.baseline.buttons[i]=0;});
    const button=gp.buttons.findIndex((b,i)=>b.value>.6 && (this.baseline.buttons[i] || 0)<.2);
    gp.axes.forEach((v,i)=>{if(Math.abs(v)<.2)this.baseline.axes[i]=0;});
    const axis=gp.axes.findIndex((v,i)=>Math.abs(v)>.6 && Math.abs(v-(this.baseline.axes[i] || 0))>.6);
    if(directions[key]){if(axis<0)return;this.profile.axes[key.slice(0,2)]={index:axis,invert:(gp.axes[axis]>0)!==key.endsWith('Positive')};}
    else if(['lt','rt'].includes(key)){if(button>=0)this.profile.triggers[key]={button};else if(axis>=0)this.profile.triggers[key]={axis,invert:gp.axes[axis]<this.baseline.axes[axis],...(Math.abs(this.baseline.axes[axis])<.2?{half:true}:{})};else return;}
    else{if(button>=0)this.profile.buttons[key]=button;else if(axis>=0)this.profile.buttons[key]={axis,invert:gp.axes[axis]<0,threshold:.5};else return;}
    this.assigned(key);
  }
  tick(){
    if(!this.dialog.open)return;
    // Browser exposure and native hot-plug reports may arrive without an event.
    // Update only the inventory; leave the selected device and draft intact.
    if(!this.lastInventory || performance.now()-this.lastInventory>=1000){this.lastInventory=performance.now();this.refreshDevices();}
    if(!this.lastPaint || performance.now()-this.lastPaint>=33){
      this.lastPaint=performance.now();const gp=this.pad();this.detect(gp);
      if(this.calibrating && gp){this.calibrating.samples.push(packGamepadState(gp,{...this.profile,calibration:{}},0));if(this.calibrating.samples.length>600)this.calibrating.samples.shift();}
      let state=neutralState();try{state=this.keyboard?keyboardState(this.testKeys,this.draft):gp?packGamepadState(gp,this.profile,this.profile.deadzone):state;}catch{/* An unplugged or incomplete device previews neutral. */}
      for(const stick of this.$('fields').querySelectorAll('[data-stick]')){const x=state.axes[stick.dataset.stick+'x'],y=state.axes[stick.dataset.stick+'y'];stick.querySelector('span').style.transform=`translate(${x*35}px,${-y*35}px)`;stick.querySelector('output').textContent=`X ${x.toFixed(2)} · Y ${y.toFixed(2)}`;}
      for(const meter of this.$('fields').querySelectorAll('[data-trigger]'))meter.value=state.axes[meter.dataset.trigger];
      for(const button of this.$('fields').querySelectorAll('[data-binding]')){const key=button.dataset.binding;button.classList.toggle('input-active',!!state.buttons[key] || ['lt','rt'].includes(key) && state.axes[key]>.1);}
    }
    this.frame=requestAnimationFrame(()=>this.tick());
  }
  load(){
    const name=this.$('profiles').value,saved=this.profiles[name];if(!saved)return;
    this.cancel();if(Object.hasOwn(mappingTemplates,saved.template))this.template=saved.template;this.$('names').value=this.template;
    if(this.keyboard)this.draft=cleanKeyboardBindings(saved.bindings);else{this.profile=cleanGamepadProfile(saved.profile);this.$('deadzone').value=String(Math.round(this.profile.deadzone*100));}
    this.$('profile-name').value=name;this.render();this.status('Profile loaded. Review the controls, then Save layout.');
  }
  save(){
    this.release();this.cancel();let saved=true;
    const name=this.$('profile-name').value.trim(),entry={kind:this.keyboard?'keyboard':'gamepad',template:this.template};
    if(this.keyboard){this.bindings=cleanKeyboardBindings(this.draft);entry.bindings=this.bindings;this.changed(this.bindings);try{localStorage.setItem(storageKey,JSON.stringify({version:1,bindings:this.bindings,template:this.template}));}catch{saved=false;}}
    else{const gp=this.pad();if(!gp){this.status('This controller disconnected. Reconnect it before saving.');return;}this.profile=cleanGamepadProfile(this.profile);entry.profile=this.profile;try{saved=this.saveProfile(gp,this.profile)!==false;}catch{saved=false;}}
    if(name){this.profiles[name]=entry;try{localStorage.setItem(profilesKey,JSON.stringify(this.profiles));}catch{saved=false;}}
    this.status(saved?'Layout saved. Click the picture to play.':'Layout applied for this visit. Browser storage is unavailable.');this.dialog.close();
  }
}
