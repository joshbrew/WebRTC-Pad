import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';
import {createApp} from '../src/server.js';
import {launchTestBrowser} from './browser-fixture.mjs';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const app=createApp({env:{INPUT_BACKEND:'none'},createInjector:async()=>({setState(){},close(){}})});let browser;const errors=[];
try{
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');const origin=`http://127.0.0.1:${app.server.address().port}`;
  browser=await launchTestBrowser(chromium,{channel:'msedge',headless:true});
  const context=await browser.newContext({viewport:{width:1366,height:820}});context.setDefaultTimeout(12000);
  await context.route('**/ice?*',r=>r.fulfill({json:{iceServers:[],iceTransportPolicy:'all'}}));
  await context.addInitScript(()=>{
    for(const role of ['host','client'])localStorage.setItem(`webrtc-pad:tour-v1:${role}`,'seen');localStorage.setItem('webrtc-pad:block-local-controller-input:v2','false');
    window.motionActivations=[];window.motionEffects=[];const animate=Element.prototype.animate;Element.prototype.animate=function(frames,options){window.motionEffects.push({id:this.id,parent:this.parentElement?.id,keys:Object.keys(frames[0] || {})});if(frames?.[0]?.scale)window.motionActivations.push({id:this.id,tag:this.tagName});return animate.call(this,frames,options);};
    window.testPads=[];Object.defineProperty(navigator,'getGamepads',{value:()=>window.testPads});
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);
  await page.waitForFunction(()=>document.querySelector('#hostCreate').hasAttribute('data-next-action'));
  assert.equal(await page.locator('#hostSetupCard button').filter({hasText:/^Start session/}).count(),1);
  await page.locator('#hostAllowGuestVideo').uncheck();assert.equal(await page.locator('#hostAllowGuestVideo').isChecked(),false);
  assert.equal(await page.evaluate(()=>window.motionEffects.filter(a=>a.id==='hostAllowGuestVideo' && a.keys.includes('boxShadow')).length),1,'One toggle activation, no duplicate label feedback');
  const toggle=page.locator('#hostAllowGuestVideo'),toggleBounds=await toggle.boundingBox();
  assert.match(await toggle.evaluate(el=>getComputedStyle(el,'::before').animationName),/^ui-switch-/,'Switch thumbs receive their own spring animation');
  await toggle.press('Space');await toggle.press('Space');
  const pressedBounds=await toggle.boundingBox();assert.ok(Math.abs(pressedBounds.x-toggleBounds.x)<.5 && Math.abs(pressedBounds.width-toggleBounds.width)<.5,'Fast switch reversals keep the clickable area fixed');assert.equal(await toggle.isChecked(),false,'Every rapid keyboard activation changes state immediately');
  assert.equal(await toggle.evaluate(el=>getComputedStyle(el).translate==='none' && getComputedStyle(el).scale==='1'),true,'Thumb motion never scales or translates the input');
  await page.waitForFunction(()=>!document.querySelector('#hostAllowGuestVideo').dataset.switchMotion);
  await page.locator('label').filter({has:toggle}).click();assert.equal(await toggle.isChecked(),true);assert.match(await toggle.evaluate(el=>getComputedStyle(el,'::before').animationName),/^ui-switch-/,'Label activation animates the same thumb');await toggle.uncheck();
  await page.waitForFunction(()=>!document.querySelector('#hostAllowGuestVideo').dataset.switchMotion);
  await toggle.evaluate(el=>el.dispatchEvent(new Event('change',{bubbles:true})));assert.equal(await toggle.getAttribute('data-switch-motion'),null,'Background settings refreshes do not pulse');
  await page.locator('#hostSessionControls > summary').click();assert.equal(await page.locator('#hostSessionControls').evaluate(el=>el.open),true);
  await page.locator('#showHelp').click();assert.equal(await page.locator('.tour-target').count(),1);await page.locator('#tourTopics > summary').click();await page.locator('#tourScenario').focus();await page.keyboard.press('ArrowDown');await page.keyboard.press('Tab');assert.equal(await page.locator('#tourScenario').inputValue(),'input');
  assert.ok(await page.evaluate(()=>window.motionEffects.some(a=>a.id==='tourScenario' && a.keys.includes('boxShadow'))),'Native keyboard selection receives commit feedback');
  assert.ok(await page.evaluate(()=>window.motionEffects.some(a=>a.id==='helpDialog' && a.keys.includes('translate'))),'Guide steps receive a bounded directional hop');
  const guideEffects=await page.evaluate(()=>window.motionEffects.filter(a=>a.keys.includes('outlineOffset')).length);await page.evaluate(()=>document.dispatchEvent(new CustomEvent('quick-start',{detail:'refresh'})));assert.equal(await page.evaluate(()=>window.motionEffects.filter(a=>a.keys.includes('outlineOffset')).length),guideEffects,'Ambient guide refresh does not repeatedly pulse');assert.equal(await page.evaluate(async()=>{for(let i=0;i<15;i++){const r=document.querySelector('#helpDialog').getBoundingClientRect();if(r.top<0 || r.left<0 || r.right>innerWidth || r.bottom>innerHeight)return false;await new Promise(requestAnimationFrame);}return true;}),true,'Guide stays on-screen while its anchor scrolls');
  await page.waitForFunction(()=>{const d=document.querySelector('#helpDialog').getBoundingClientRect(),t=document.querySelector('.tour-target').getBoundingClientRect(),n=document.querySelector('#tourNext').getBoundingClientRect();return d.top>=0 && d.right<=innerWidth && d.bottom<=innerHeight && t.top>=0 && t.bottom<=innerHeight && n.bottom<=d.bottom && n.top>=d.top;});await fs.mkdir('.local/screenshots',{recursive:true});await page.screenshot({animations:'disabled',path:'.local/screenshots/motion-guide-desktop.png'});await page.setViewportSize({width:390,height:820});await page.waitForFunction(()=>{const r=document.querySelector('#helpDialog').getBoundingClientRect();return r.left>=0 && r.right<=innerWidth && r.top>=0 && r.bottom<=innerHeight;});await page.screenshot({animations:'disabled',path:'.local/screenshots/motion-guide-phone.png'});await page.keyboard.press('Escape');assert.equal(await page.locator('#helpDialog').isVisible(),false);assert.equal(await page.locator('.tour-target').count(),0);await page.setViewportSize({width:1366,height:820});await page.locator('#showHelp').click();await page.locator('#helpDialog .tour-footer').getByRole('button',{name:'Having trouble?',exact:true}).click();assert.equal(await page.locator('#callTroubleshooting').isVisible(),true);assert.equal(await page.locator('.tour-target').count(),0,'Switching from a guide to troubleshooting clears its highlight');await page.locator('#callTroubleshooting [data-help=close]').click();
  await page.locator('#modeClient').focus();await page.keyboard.press('Enter');assert.equal(await page.locator('body').getAttribute('data-mode'),'client','Keyboard action is immediate');
  assert.equal(await page.evaluate(()=>window.motionEffects.filter(a=>a.parent==='modeClient' && a.keys.includes('scale')).length),1,'Keyboard activation animates the tab label without moving its hit area');
  await page.evaluate(()=>{window.testPads.push({id:'USB controller',index:0,connected:true,mapping:'standard',axes:[0,0,0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0}))});window.dispatchEvent(new Event('gamepadconnected'));});
  await page.waitForFunction(()=>window.motionEffects.filter(a=>a.parent==='clientPrepareControllers' && a.keys.includes('rotate')).length===1);
  await page.evaluate(()=>window.dispatchEvent(new Event('gamepadconnected')));
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(()=>window.motionEffects.filter(a=>a.parent==='clientPrepareControllers' && a.keys.includes('rotate')).length),1,'Device refreshes do not replay a hotplug cue');
  await page.evaluate(()=>{window.testPads.length=0;window.dispatchEvent(new Event('gamepaddisconnected'));});
  const cameraButton=page.locator('#clientPrepareCamera');
  const edge=await cameraButton.boundingBox(),edgeX=edge.x+edge.width-1,edgeY=edge.y+edge.height/2;
  await page.mouse.move(edgeX,edgeY);await page.mouse.down();
  assert.equal(await cameraButton.evaluate((el,{x,y})=>el.contains(document.elementFromPoint(x,y)),{x:edgeX,y:edgeY}),true,'Pointer stays on a pressed control at its edge');
  await page.mouse.up();assert.equal(await page.locator('#clientCameraSheet').evaluate(el=>el.open),true);
  const plink=await cameraButton.evaluate(control=>{
    control.click();
    const icon=control.querySelector('svg'),ring=[...document.querySelectorAll('.ui-press-ripple')].at(-1);
    const rebound=icon.getAnimations().find(animation=>animation.effect.getKeyframes().some(frame=>frame.translate==='0px -3px'));
    const frames=ring.getAnimations()[0].effect.getKeyframes(),crest=frames[1],end=frames.at(-1);
    const drops=[...document.querySelectorAll('.ui-press-drop')].slice(-2).map(drop=>{
      const [fall]=drop.getAnimations(),poses=fall.effect.getKeyframes();
      return {startsAtOrigin:poses[0].translate.split(' ').every(value=>parseFloat(value)===0),last:poses.at(-1).translate,opacity:Number(poses.at(-1).opacity),delay:fall.effect.getTiming().delay,events:getComputedStyle(drop).pointerEvents};
    });
    const bounds=icon.getBoundingClientRect(),center=ring.getBoundingClientRect();
    return {scales:rebound?.effect.getKeyframes().map(frame=>frame.scale),expands:Number(crest.scale)<Number(end.scale),fades:Number(crest.opacity)>Number(end.opacity),centered:Math.abs(center.x+center.width/2-bounds.x-bounds.width/2)<1 && Math.abs(center.y+center.height/2-bounds.y-bounds.height/2)<1,pointerEvents:getComputedStyle(ring).pointerEvents,drops};
  });
  assert.deepEqual(plink.scales,['1','1.16 0.78','0.96 1.19','1'],'The icon squashes and stretches through a single rebound');
  assert.ok(plink.expands && plink.fades && plink.centered,'The ripple fades outward from the icon');
  assert.equal(plink.pointerEvents,'none');
  assert.deepEqual(plink.drops,[
    {startsAtOrigin:true,last:'11px 17px',opacity:0,delay:35,events:'none'},
    {startsAtOrigin:true,last:'-11px 17px',opacity:0,delay:65,events:'none'}
  ],'Two staggered droplets fall and fade without intercepting input');
  assert.equal(await page.locator('#clientCameraSheet').evaluate(el=>getComputedStyle(el).animationName),'pad-surface-in','Call panel gets a short entry fade');
  assert.equal(await page.locator('#clientCameraSheet').evaluate(el=>getComputedStyle(el).transform),'none','Panel entrance never moves the controls');
  const position=await page.evaluate(()=>({x:scrollX,y:scrollY}));await page.locator('#clientPrepareMic').click();assert.equal(await page.locator('#clientSettingsSheet').evaluate(el=>el.open),true);assert.deepEqual(await page.evaluate(()=>({x:scrollX,y:scrollY})),position,'Spring feedback never scrolls the page');await page.locator('#clientVoice [data-voice=volume]').focus();await page.keyboard.press('ArrowLeft');assert.ok(await page.locator('#clientVoice [data-voice=volume]').evaluate(el=>el.getAnimations().some(a=>a.effect.getKeyframes().some(k=>k.boxShadow))),'Slider commits receive a brief confirmation');
  await page.evaluate(()=>{const control=document.querySelector('#clientPrepareMic');control.click();control.click();control.click();});
  assert.equal(await page.locator('#clientPrepareMic').evaluate(el=>el.getAnimations().filter(a=>a.effect.getKeyframes().some(k=>k.scale)).length),0,'Interactive hit area never scales');assert.equal(await page.locator('#clientPrepareMic > .icon').evaluate(el=>el.getAnimations().filter(a=>a.effect.getKeyframes().some(k=>k.scale)).length),1,'Rapid activation replaces the decoration rebound');
  await page.emulateMedia({reducedMotion:'reduce'});await page.waitForFunction(()=>!document.querySelector('#clientPrepareMic > .icon').getAnimations().some(a=>a.effect.getKeyframes().some(k=>k.scale)));
  await page.waitForFunction(()=>!document.querySelector('.ui-press-ripple,.ui-press-drop'));
  const count=await page.evaluate(()=>window.motionActivations.length);await page.locator('#clientPrepareCamera').click();assert.equal(await page.evaluate(()=>window.motionActivations.length),count,'Reduced motion disables JS rebounds and cancels running ones');
  assert.equal(await page.locator('#clientPrepareCamera').evaluate(el=>getComputedStyle(el).scale),'1');
  await page.locator('#modeHost').click();await page.locator('#hostAllowGuestMic').uncheck();assert.equal(await page.locator('#hostAllowGuestMic').evaluate(el=>getComputedStyle(el,'::before').animationName),'none','Switch thumbs respect reduced motion');const reducedEffects=await page.evaluate(()=>window.motionEffects.length);await page.locator('#showHelp').click();await page.locator('#tourTopics > summary').click();await page.locator('#tourScenario').focus();await page.keyboard.press('ArrowDown');await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>window.motionEffects.length),reducedEffects,'Guide and selection effects also honor reduced motion');await page.keyboard.press('Escape');
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.locator('#modeClient').click();await page.locator('#clientPrepareControllers').click();await page.locator('#joinKeyboardController').click();if(await page.locator('[data-keyboard=open]').isVisible())await page.locator('[data-keyboard=open]').click();else await page.locator('.connected-controller .controller-map').first().click();await page.locator('[data-binding=a]').click();assert.equal(await page.locator('[data-binding=a]').getAttribute('aria-pressed'),'true');assert.equal(await page.locator('[data-binding=a]').evaluate(el=>el.classList.contains('is-listening')),true);await page.screenshot({animations:'disabled',path:'.local/screenshots/motion-mapping-listening.png'});await page.keyboard.press('KeyV');assert.equal(await page.locator('[data-binding=a]').textContent(),'V');assert.ok(await page.locator('[data-binding=a]').evaluate(el=>el.getAnimations().some(a=>a.effect.getKeyframes().some(k=>k.boxShadow))),'Freshly rendered mapping control confirms assignment');await page.locator('[data-keyboard=close]').click();assert.equal(await page.locator('#controllersSheet').evaluate(el=>el.open),true,'Closing a mapping dialog preserves its parent panel');
  await page.locator('#modeHost').click();await page.locator('#hostCreate').click();await page.waitForFunction(()=>document.querySelector('#hostPanel').dataset.session==='active');
  await page.waitForFunction(()=>document.querySelector('#createInvitation').hasAttribute('data-next-action'));
  const toolbarMotion=await page.locator('#hostToolbar').evaluate(toolbar=>[...toolbar.querySelectorAll('button:not(:disabled)')].filter(button=>button.querySelector('svg') && button.getClientRects().length).map(button=>{
    button.addEventListener('click',event=>event.stopImmediatePropagation(),{capture:true,once:true});
    const svg=button.querySelector('svg');
    const before=document.querySelectorAll('.ui-press-ripple').length;
    svg.dispatchEvent(new MouseEvent('click',{bubbles:true}));
    return {id:button.id,bounces:svg.getAnimations().filter(animation=>animation.effect.getKeyframes().some(frame=>frame.scale)).length,ripple:document.querySelectorAll('.ui-press-ripple').length===before+1};
  }));
  assert.ok(toolbarMotion.length>=6);
  for(const {id,bounces,ripple} of toolbarMotion){assert.equal(bounces,1,id);assert.equal(ripple,true,id);}
  await page.locator('#hostCallSettings').click();assert.equal(await page.locator('#hostSettingsSheet').evaluate(el=>el.open),true,'Toolbar panel action works while its button rebounds');
  await page.locator('#hostSettingsSheet-voice-tab').click();
  assert.equal(await page.locator('#hostSettingsSheet-voice').evaluate(el=>!el.hidden && getComputedStyle(el).animationName==='pad-surface-in' && getComputedStyle(el).transform==='none'),true,'Changing tabs fades the new settings in place');
  const media=await page.locator('#hostWatchStage').evaluate(el=>{const values=[];for(let node=el;node && node!==document.body;node=node.parentElement)values.push({transform:getComputedStyle(node).transform,animations:node.getAnimations().length});return values;});assert.ok(media.every(v=>v.transform==='none' && v.animations===0),'Live stage and ancestors are never animated by UI feedback');
  await page.keyboard.press('Escape');await page.locator('#hostEnd').click();await page.waitForFunction(()=>document.querySelector('#hostPanel').dataset.session!=='active');
  for(const width of [390,860,1366]){await page.setViewportSize({width,height:820});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
  await page.goto(origin+'/linux-desktop');assert.ok(await page.evaluate(()=>performance.getEntriesByType('resource').some(r=>r.name.endsWith('/interaction-motion.js'))),'Help pages share the same interaction layer');
  assert.deepEqual(errors,[]);console.log('PASS: edge clicks, fixed targets, panel and tab fades, click/keyboard rebounds, rapid-click replacement, reduced-motion cancellation, stable scroll, immediate session actions, unanimated media surface, responsive bounds, field feedback, guide transitions and mapping feedback.');
}finally{await browser?.close();await app.close();}
