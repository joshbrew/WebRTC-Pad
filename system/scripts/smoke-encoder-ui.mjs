import {launchTestBrowser} from './browser-fixture.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {EventEmitter,once} from 'node:events';
import {pathToFileURL} from 'node:url';
import {createApp} from '../src/server.js';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
let scans=0,fail=false;
const scanResult=()=>({selected:fail?null:'h264_amf',devices:['AMD Test Graphics','Intel Test Graphics'],encoders:[{id:'h264_amf',label:'AMD AMF',hardware:true,available:!fail}],error:fail?'No working native hardware encoder was found. Check your graphics drivers, or use browser capture.':null});
const app=createApp({env:{NATIVE_MEDIA_HELPER:process.execPath,FFMPEG_BIN:process.execPath},platform:'win32',
  encoderScanner:{peek:scanResult,scan:async()=>{scans++;return scanResult();}},
  getCaptureTargets:async()=>[{id:'desktop',kind:'desktop',label:'Entire primary screen'}],
  createInjector:async()=>({name:'Encoder UI fixture',setState(){},addController(){},removeController(){},close(){}}),
  createNativeMedia:()=>Object.assign(new EventEmitter(),{async offer(){return {sourceSize:{width:1280,height:720},encoder:'h264_qsv',scaling:'Native scaling',capture:'Windows Graphics Capture'};},async closePeer(){},close(){}})
});
let browser;
try {
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
  browser=await launchTestBrowser(chromium,{channel:'msedge',headless:true});
  const context=await browser.newContext({viewport:{width:1280,height:950}});
  await context.addInitScript(()=>{localStorage.setItem('webrtc-pad:block-local-controller-input:v2','false');
    for(const role of ['host','client'])localStorage.setItem(`webrtc-pad:tour-v1:${role}`,'seen');
    localStorage.setItem('webrtc-pad:capture-method','native');
    navigator.mediaDevices.getDisplayMedia=async()=>{const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;return canvas.captureStream(30);};
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${app.server.address().port}`);
  await page.waitForFunction(()=>document.querySelector('#encoderStatus').textContent.includes('Ready to use AMD AMF'));
  assert.equal(scans,1);assert.equal(await page.locator('#encoderCheck').isVisible(),true);
  await page.locator('#encoderCheck details').evaluate(element=>element.open=true);
  assert.match(await page.locator('#encoderDevices').textContent(),/AMD Test Graphics/);
  await page.locator('#hostSettings').evaluate(element=>element.open=true);await page.locator('#hostPreviewToggle').uncheck();
  await page.waitForFunction(()=>[...document.querySelector('#captureTarget').options].some(option=>option.value==='desktop'));
  await page.locator('#captureTarget').selectOption('desktop');await page.locator('#hostCreate').click();
  await page.waitForFunction(()=>document.querySelector('#encoderStatus').textContent==='Selected for this stream: Intel Quick Sync');
  assert.equal(scans,1,'Room updates must not repeat the scan');
  await page.locator('#hostEnd').click();await page.waitForFunction(()=>!document.querySelector('#hostCreate').hidden);
  assert.match(await page.locator('#encoderStatus').textContent(),/Ready to use AMD/);
  fail=true;await page.locator('#checkEncoderAgain').click();
  await page.waitForFunction(()=>document.querySelector('#encoderStatus').textContent.includes('No working native'));
  assert.equal(await page.locator('#hostCreate').isEnabled(),true,'Controller-only hosting remains available');
  await page.locator('#captureBackend').selectOption('browser');
  await page.waitForFunction(()=>document.querySelector('#captureTarget').value==='browser-selected');
  assert.equal(await page.locator('#encoderCheck').isVisible(),false);
  fail=false;await page.locator('#captureBackend').selectOption('native');
  await page.locator('#checkEncoderAgain').click();await page.waitForFunction(()=>document.querySelector('#encoderStatus').textContent.includes('Ready to use AMD'));
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await fs.mkdir('.local/screenshots',{recursive:true});await page.screenshot({path:'.local/screenshots/encoder-check-mobile.png',fullPage:true});
  assert.deepEqual(errors,[]);
  console.log('PASS: native encoder readiness, GPU details, live encoder override, cached room updates, unavailable recovery, browser separation and mobile layout');
} finally {await browser?.close();await app.close();}
