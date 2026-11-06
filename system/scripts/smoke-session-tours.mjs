import {launchTestBrowser} from './browser-fixture.mjs';
import assert from 'node:assert/strict';
import {once,EventEmitter} from 'node:events';
import {pathToFileURL} from 'node:url';
import {createApp} from '../src/server.js';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const app=createApp({env:{},desktopSimulation:true,createDesktop:()=>Object.assign(new EventEmitter(),{display:{width:1280,height:720},simulatedSurface:true,async setScope(){},setState(){},event(){},close(){}}),createInjector:async()=>({setState(){},close(){},addController(){},removeController(){}}),getCaptureTargets:async()=>[{kind:'desktop',id:'desktop',label:'Entire primary screen'}]});let browser;
try{
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');browser=await launchTestBrowser(chromium,{channel:'msedge',headless:true});
  const context=await browser.newContext({viewport:{width:1280,height:900}});await context.route('**/ice?*',r=>r.fulfill({json:{iceServers:[],iceTransportPolicy:'all'}}));await context.addInitScript(()=>{localStorage.setItem('webrtc-pad:block-local-controller-input:v2','false');for(const role of ['host','client'])localStorage.setItem(`webrtc-pad:tour-v1:${role}`,'seen');});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(`http://127.0.0.1:${app.server.address().port}`);
  assert.equal(await page.locator('#hostShareOnStart').count(),0);
  assert.deepEqual(await page.locator('#tourScenario option').evaluateAll(options=>options.map(o=>o.value)),['connect','input','desktop','server']);
  for(const mode of ['host','client']){
    await page.locator(mode==='host'?'#modeHost':'#modeClient').click();
    for(const scenario of ['connect','input','desktop','server']){
      await page.locator('#showHelp').click();await page.locator('#tourTopics').evaluate(el=>el.open=true);await page.locator('#tourScenario').selectOption(scenario);
      const steps=[];
      for(let step=0;step<12;step++){
        const target=page.locator('.tour-target');assert.equal(await target.count(),1);assert.equal(await target.isVisible(),true,`${mode}/${scenario}/${step}`);
        assert.equal(await page.locator('#helpDialog').getAttribute('data-scenario'),scenario);
        assert.equal(await page.locator('#tourScenario').inputValue(),scenario);
        steps.push({target:await target.evaluate(el=>el.id || el.getAttribute('for') || el.getAttribute('href')),text:await page.locator('#tourBody').textContent()});
        if(mode==='host' && await target.getAttribute('id')==='hostCreate'){await page.locator('#hostCreate').click();await page.waitForFunction(()=>!document.querySelector('#createInvitation').disabled);continue;}
        if(mode==='host' && ['createInvitation','newInvitation'].includes(await target.getAttribute('id')) && !await page.locator('#hostInvitation').inputValue()){if(scenario!=='server'){await page.locator('#tourNext').click();assert.equal(await target.isVisible(),true,'Guide must not highlight a hidden reply step before an invite exists');}await target.click();await page.waitForFunction(()=>!!document.querySelector('#hostInvitation').value);}
        if(mode==='host' && await target.getAttribute('id')==='hostDesktopScope'){await page.locator('#hostDesktopScope').selectOption('desktop');}
        if(await page.locator('#tourNext').textContent()==='Done'){await page.locator('#tourNext').click();break;}
        await page.locator('#tourNext').click();
      }
      assert.equal(await page.locator('#helpDialog').isVisible(),false);
      if(['input','desktop'].includes(scenario)) {
        assert.ok(steps.some(s=>s.target===(mode==='host'?'hostDesktopMouse':'clientDesktopMouse')));
        assert.ok(steps.some(s=>s.target===(mode==='host'?'hostDesktopKeyboard':'clientDesktopTyping')));
        if(mode==='host')assert.ok(steps.some(s=>['captureTargetTrigger','chooseBrowserSource'].includes(s.target)));
      }
      if(mode==='host' && scenario==='desktop')assert.ok(steps.some(s=>s.target==='hostDesktopScope'));
      if(mode==='client' && scenario==='server')assert.equal(steps[0].target,'clientNetworkGuide');
      // Reopening starts with guidance for the currently enabled controls.
      const inferred=await page.evaluate(()=>((document.body.dataset.mode==='host'?document.querySelector('#hostDesktopScope').value!=='off':document.querySelector('#clientDesktopMouse').checked || document.querySelector('#clientDesktopTyping').checked)?'desktop':'connect'));
      await page.locator('#showHelp').click();assert.equal(await page.locator('#helpDialog').getAttribute('data-scenario'),inferred);assert.equal(await page.locator('#tourScenario').inputValue(),inferred);assert.equal(await page.locator('#tourTopics').evaluate(el=>el.open),false);await page.locator('#helpDone').click();
      if(mode==='host'){await page.locator('#hostEnd').click();await page.waitForFunction(()=>!document.querySelector('#hostCreate').hidden);}
    }
  }
  await page.locator('#modeHost').click();await page.locator('#hostAudioOnly').check();await page.waitForFunction(()=>document.body.dataset.hostAudioOnly==='true');
  await page.locator('#showHelp').click();await page.locator('#tourTopics').evaluate(el=>el.open=true);await page.locator('#tourScenario').selectOption('desktop');
  assert.equal(await page.locator('#hostSourceSetup').evaluate(el=>el.classList.contains('tour-target')),true,'Audio-only desktop guide points to the visible source controls');
  assert.match(await page.locator('#tourBody').textContent(),/Audio-only/);await page.locator('#helpDone').click();
  await page.locator('#hostAudioOnly').uncheck();await page.waitForFunction(()=>document.body.dataset.hostAudioOnly==='false');
  await page.setViewportSize({width:390,height:700});await page.locator('#showHelp').click();await page.locator('#tourTopics').evaluate(el=>el.open=true);await page.locator('#tourScenario').selectOption('desktop');
  await page.waitForFunction(()=>{const r=document.querySelector('#helpDialog').getBoundingClientRect();return r.x>=0&&r.right<=innerWidth&&r.y>=0&&r.bottom<=innerHeight;});
  assert.deepEqual(errors,[]);console.log('PASS: all four task-based host/guest guides match their controls; keyboard/mouse, remote desktop, connection help, replay and mobile bounds pass');
}finally{await browser?.close();await app.close();}
