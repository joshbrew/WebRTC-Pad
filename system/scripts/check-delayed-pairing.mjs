import {launchTestBrowser} from './browser-fixture.mjs';
// Two real browser peers with manual-file delays; only safe diagnostic data is printed.
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';
import {createApp} from '../src/server.js';
import {createIceProvider} from '../src/ice.js';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const ice=await createIceProvider(process.env)();
if(!ice.iceServers.some(server=>(Array.isArray(server.urls)?server.urls:[server.urls]).some(url=>/^turns?:/.test(url))))throw Error('This check requires configured TURN');
const delayMs=Number(process.argv.find(value=>value.startsWith('--delay='))?.split('=')[1] || 45000);
if(!Number.isInteger(delayMs) || delayMs<0 || delayMs>120000)throw Error('Delay must be 0–120000 ms');
const app=createApp({env:{},createInjector:async()=>({name:'Delayed pairing check',setState(){},close(){}})});let browser;
try{
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
  browser=await launchTestBrowser(chromium,{...process.argv.includes('--brave')?{executablePath:'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe'}:{channel:'msedge'},headless:true});const page=await browser.newPage();await page.goto(`http://127.0.0.1:${app.server.address().port}`);
  console.log(JSON.stringify({browser:browser.version(),delayMs}));
  const selectedStage=process.argv.find(value=>value.startsWith('--stage='))?.split('=')[1];
  if(selectedStage && !['immediate','offer','answer'].includes(selectedStage))throw Error('Invalid test stage');
  for(const stage of selectedStage?[selectedStage]:['immediate','offer','answer']){
    const result=await page.evaluate(async({ice,stage,delayMs})=>{
      const {gatherIce}=await import('/pairing.js'),{ConnectionReports}=await import('/connection-report.js');
      const hostLog=new ConnectionReports('host'),guestLog=new ConnectionReports('guest');
      const a=hostLog.track(new RTCPeerConnection({...ice,iceTransportPolicy:'relay'})),b=guestLog.track(new RTCPeerConnection({...ice,iceTransportPolicy:'relay'}));
      const channel=a.createDataChannel('check'),start=performance.now();let timer;
      const reply=new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error('timeout')),delayMs+20000);b.ondatachannel=event=>{event.channel.onmessage=()=>event.channel.send('ok');};channel.onopen=()=>channel.send('ping');channel.onmessage=resolve;});reply.catch(()=>{});
      let connected=false;
      try{
        await a.setLocalDescription(await a.createOffer());await gatherIce(a);const offer=a.localDescription;hostLog.sharedDescription(a,offer);
        if(stage==='offer')await new Promise(resolve=>setTimeout(resolve,delayMs));
        await b.setRemoteDescription(offer);await b.setLocalDescription(await b.createAnswer());await gatherIce(b);const answer=b.localDescription;guestLog.sharedDescription(b,answer);
        if(stage==='answer')await new Promise(resolve=>setTimeout(resolve,delayMs));
        await a.setRemoteDescription(answer);await reply;connected=true;
      }catch{/* Report states and counters instead of potentially private browser errors. */}
      finally{clearTimeout(timer);}
      const result={stage,connected,milliseconds:Math.round(performance.now()-start),host:await hostLog.report(),guest:await guestLog.report()};a.close();b.close();return result;
    },{ice,stage,delayMs});
    console.log(JSON.stringify(result));
  }
}finally{await browser?.close();await app.close();}
