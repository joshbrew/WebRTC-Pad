import {launchTestBrowser} from './browser-fixture.mjs';
// Isolated Chromium/Firefox TURN interoperability check. No real app or devices.
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';
import {createIceProvider} from '../src/ice.js';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const answerDelay=Number(process.argv.find(value=>value.startsWith('--answer-delay='))?.split('=')[1] || 0);
if(!Number.isInteger(answerDelay) || answerDelay<0 || answerDelay>120000)throw Error('Invalid answer delay');
let ice=await createIceProvider(process.env)();
if(process.argv.includes('--tls-only'))ice={...ice,iceServers:ice.iceServers.flatMap(server=>{const urls=(Array.isArray(server.urls)?server.urls:[server.urls]).filter(url=>/^turns:/.test(url));return urls.length?[{...server,urls}]:[];})};
if(!ice.iceServers.some(server=>(Array.isArray(server.urls)?server.urls:[server.urls]).some(url=>/^turns?:/.test(url))))throw Error('Configured TURN required');
ice={...ice,iceTransportPolicy:process.argv.includes('--allow-direct')?'all':'relay'};
const token=crypto.randomBytes(16).toString('hex'),temporaryRoot=await fs.realpath(os.tmpdir()),profile=await fs.mkdtemp(path.join(temporaryRoot,'pad-firefox-check-'));
let seedResolve,answerResolve,guestResolve,browser,firefox;
const seed=new Promise(resolve=>{seedResolve=resolve;}),answer=new Promise(resolve=>{answerResolve=resolve;}),guest=new Promise(resolve=>{guestResolve=resolve;});
const server=http.createServer(async(req,res)=>{
  try{
    if(['/pairing.js','/players.js','/connection-report.js'].includes(req.url)){res.setHeader('Content-Type','text/javascript');res.end(await fs.readFile(new URL(`../public${req.url}`,import.meta.url)));return;}
    if(!req.url.startsWith('/'+token+'/')){res.writeHead(404);res.end();return;}
    const route=req.url.slice(token.length+2);
    if(route==='seed'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(await seed));return;}
    if(['answer','result'].includes(route) && req.method==='POST'){
      let body='';for await(const chunk of req){body+=chunk;if(body.length>2000000)throw Error('Large report');}
      const value=JSON.parse(body);if(route==='answer')answerResolve(value);else guestResolve(value);res.end('ok');return;
    }
    res.setHeader('Content-Type','text/html');
    res.end(`<!doctype html><title>Isolated Firefox connection check</title><script type="module">
      import {gatherIce} from '/pairing.js';import {ConnectionReports} from '/connection-report.js';
      if(location.pathname.endsWith('/guest')){
        const log=new ConnectionReports('guest');let pc;
        try{
          const seed=await(await fetch('seed')).json();pc=log.track(new RTCPeerConnection(seed.ice));
          const done=new Promise(resolve=>{const timer=setTimeout(resolve,seed.answerDelay+20000);pc.ondatachannel=e=>{e.channel.onmessage=()=>{e.channel.send('ok');setTimeout(()=>{clearTimeout(timer);resolve();},100);};};});
          await pc.setRemoteDescription(seed.offer);await pc.setLocalDescription(await pc.createAnswer());await gatherIce(pc);log.sharedDescription(pc,pc.localDescription);
          await fetch('answer',{method:'POST',body:JSON.stringify(pc.localDescription)});await done;
        }catch{/* Only safe reports leave this isolated page. */}
        await fetch('result',{method:'POST',body:JSON.stringify(await log.report())});pc?.close();
      }
    </script>`);
  }catch{res.writeHead(500);res.end('Check failed');}
});
let deadline;
try{
  server.listen(0,'127.0.0.1');await once(server,'listening');const origin=`http://127.0.0.1:${server.address().port}/${token}/`;
  browser=await launchTestBrowser(chromium,{...process.argv.includes('--brave')?{executablePath:'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe'}:{channel:'msedge'},headless:true});const page=await browser.newPage();await page.goto(origin+'host');
  firefox=spawn('C:/Program Files/Mozilla Firefox/firefox.exe',['--headless','--no-remote','--profile',profile,origin+'guest'],{windowsHide:true,stdio:'ignore'});
  const failure=new Promise((_,reject)=>{deadline=setTimeout(()=>reject(Error('Browser check timed out')),answerDelay+45000);firefox.once('error',()=>reject(Error('Firefox did not start')));});failure.catch(()=>{});
  const hostOffer=await page.evaluate(async ice=>{
    const {gatherIce}=await import('/pairing.js'),{ConnectionReports}=await import('/connection-report.js');
    window.log=new ConnectionReports('host');const pc=window.pc=log.track(new RTCPeerConnection(ice)),ch=pc.createDataChannel('check');
    window.ping=new Promise(resolve=>{ch.onopen=()=>ch.send('ping');ch.onmessage=()=>resolve(true);});
    await pc.setLocalDescription(await pc.createOffer());await gatherIce(pc);log.sharedDescription(pc,pc.localDescription);return pc.localDescription;
  },ice);seedResolve({ice,offer:hostOffer,answerDelay});
  const description=await Promise.race([answer,failure]);if(answerDelay)await new Promise(resolve=>setTimeout(resolve,answerDelay));await page.evaluate(description=>pc.setRemoteDescription(description),description);
  const guestReport=await Promise.race([guest,failure]);
  const hostReport=await page.evaluate(()=>log.report());
  console.log(JSON.stringify({hostBrowser:process.argv.includes('--brave')?'Brave':'Edge',chromiumVersion:browser.version(),tlsOnly:process.argv.includes('--tls-only'),policy:ice.iceTransportPolicy,answerDelay,host:hostReport,guest:guestReport}));
}finally{
  clearTimeout(deadline);await browser?.close();firefox?.kill();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  // Only this newly created temporary profile is removed.
  try{const resolved=await fs.realpath(profile);if(path.dirname(resolved)===temporaryRoot && path.basename(resolved).startsWith('pad-firefox-check-'))await fs.rm(resolved,{recursive:true,force:true,maxRetries:5,retryDelay:200});}catch{}
}
