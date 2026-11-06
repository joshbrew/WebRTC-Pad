import {launchTestBrowser} from './browser-fixture.mjs';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';
import fs from 'node:fs/promises';
import {createApp} from '../src/server.js';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const apps=[],errors=[];let browser;
try{
  browser=await launchTestBrowser(chromium,{channel:'msedge',headless:true});const context=await browser.newContext({viewport:{width:1366,height:768}});
  await context.addInitScript(()=>{localStorage.setItem('webrtc-pad:block-local-controller-input:v2','false');for(const role of ['host','client'])localStorage.setItem(`webrtc-pad:tour-v1:${role}`,'seen');localStorage.setItem('webrtc-pad:capture-method','browser');});
  for(const fixture of [
    {name:'local',env:{},hosted:false,forwarded:false,description:/Invite\/reply files/},
    {name:'hosted',env:{SESSION_SERVER_URL:'https://invites.example.com'},hosted:true,forwarded:false,description:/Hosted invitations/},
    {name:'forwarded',env:{PUBLIC_URL:'https://recovery.example.com',SIGNALING_FALLBACK:'1'},hosted:false,forwarded:true,description:/automatic recovery/}
  ]){
    const app=createApp({env:fixture.env,platform:'linux'});apps.push(app);app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(`http://127.0.0.1:${app.server.address().port}`);await page.waitForFunction(()=>!!document.body.dataset.platform);
    for(const id of ['hostResume','hostRoom','hostKey','publicUrl','copyJoin','clientRoom','clientRole','clientConnect'])assert.equal(await page.locator('#'+id).count(),0,`${fixture.name}: obsolete controls are absent`);
    assert.equal(await page.locator('#sessionConnection').count(),fixture.hosted?1:0);
    assert.match(await page.locator('#connectionSetupStatus').textContent(),fixture.description);
    assert.equal(await page.locator('#fallbackConfigStatus').getAttribute('hidden')!==null,!fixture.forwarded);
    assert.equal(await page.locator('#clientFallbackStatus').getAttribute('hidden')!==null,true);
    assert.equal(await page.locator('#nativeCaptureAudio').isChecked(),true);
    for(const id of ['captureOptions','hostPlayerOptions']){
      const summary=page.locator(`#${id}>summary`);
      assert.equal(await summary.evaluate(el=>getComputedStyle(el).display),'flex');
      assert.equal(await summary.evaluate(el=>getComputedStyle(el,'::before').content),'""');
      assert.ok(await summary.evaluate(el=>el.getBoundingClientRect().left>=el.parentElement.getBoundingClientRect().left),'Disclosure arrow stays inside its section');
      const before=await page.locator('#'+id).evaluate(el=>el.open);await summary.focus();await page.keyboard.press('Enter');
      assert.equal(await page.locator('#'+id).evaluate(el=>el.open),!before);await page.keyboard.press('Enter');
    }
    await page.setViewportSize({width:390,height:780});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    if(fixture.name==='local'){await fs.mkdir('.local/screenshots',{recursive:true});await page.screenshot({path:'.local/screenshots/aligned-disclosures-mobile.png',fullPage:true});await page.setViewportSize({width:1366,height:768});await page.screenshot({path:'.local/screenshots/aligned-disclosures.png',fullPage:true});}
    if(fixture.name==='local'){
      await page.locator('#modeClient').click();
      await page.locator('#clientStatus').evaluate(el=>el.textContent='The connection could not be restored. Ask your host for a fresh invite and keep this page open.');
      for(const width of [1280,390]){
        await page.setViewportSize({width,height:780});
        assert.ok(await page.locator('#clientStatus').evaluate(el=>el.clientWidth>=el.scrollWidth),'Call status must remain readable beside the controls');
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      }
      await page.screenshot({path:'.local/screenshots/guest-toolbar-mobile.png',fullPage:true});
    }
    await page.close();console.log(`PASS: ${fixture.name} settings show only usable invitations/recovery controls; audio defaults on; phone layout fits`);
  }
  assert.deepEqual(errors,[]);
}finally{await browser?.close();for(const app of apps.reverse())await app.close();}
