import {launchTestBrowser} from './browser-fixture.mjs';
// Real browser ICE timing; report counts/timings only, never addresses or keys.
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';
import {createApp} from '../src/server.js';
import {readIce,createIceProvider} from '../src/ice.js';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const app=createApp({env:{},createInjector:async()=>({name:'Pairing benchmark',setState(){},close(){}})});
let browser;
try{
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
  const profiles=[{name:'public STUN defaults',ice:readIce({})}];
  if(process.argv.includes('--local-config')){
    const started=performance.now(),ice=await createIceProvider(process.env)();
    console.log(JSON.stringify({profile:'local configuration lookup',milliseconds:Math.round(performance.now()-started)}));
    profiles.push({name:'local configured servers',ice});
  }
  if(process.argv.includes('--configured')){
    const response=await fetch('http://127.0.0.1:8787/ice');if(!response.ok)throw Error('Running app ICE settings unavailable');
    const value=await response.json();profiles.push({name:'running app configuration',ice:{iceServers:value.iceServers,iceTransportPolicy:value.iceTransportPolicy}});
  }
  if(process.argv.includes('--verify-transports')){
    const source=profiles.at(-1).ice;
    for(const [name,match] of [['TURN over TCP',url=>/^turn:.*[?&]transport=tcp/.test(url)],['TURN over TLS',url=>/^turns:/.test(url)]]){
      const iceServers=source.iceServers.flatMap(server=>{
        const urls=(Array.isArray(server.urls)?server.urls:[server.urls]).filter(match);
        return urls.length?[{...server,urls}]:[];
      });
      if(iceServers.length)profiles.push({name,ice:{iceServers,iceTransportPolicy:'relay'}});
    }
  }
  browser=await launchTestBrowser(chromium,{channel:'msedge',headless:true});
  const page=await browser.newPage();await page.goto(`http://127.0.0.1:${app.server.address().port}`);
  for(const profile of profiles){
    const result=await page.evaluate(async ice=>{
      const {gatherIce}=await import('/pairing.js'),pc=new RTCPeerConnection(ice);pc.createDataChannel('input');const start=performance.now();
      try{await pc.setLocalDescription(await pc.createOffer());await gatherIce(pc);const sdp=pc.localDescription.sdp;return {milliseconds:Math.round(performance.now()-start),gathering:pc.iceGatheringState,host:(sdp.match(/ typ host/g)||[]).length,public:(sdp.match(/ typ srflx/g)||[]).length,relay:(sdp.match(/ typ relay/g)||[]).length};}finally{pc.close();}
    },profile.ice);
    console.log(JSON.stringify({profile:profile.name,...result}));
    if(process.argv.includes('--verify-relay') && profile.ice.iceServers.some(server=>(Array.isArray(server.urls)?server.urls:[server.urls]).some(url=>/^turns?:/.test(url)))){
      const roundtrip=await page.evaluate(async ice=>{
        const {gatherIce}=await import('/pairing.js'),a=new RTCPeerConnection({...ice,iceTransportPolicy:'relay'}),b=new RTCPeerConnection({...ice,iceTransportPolicy:'relay'}),start=performance.now();let timer;
        const channel=a.createDataChannel('pairing-check');
        const reply=new Promise((resolve,reject)=>{
          timer=setTimeout(()=>reject(Error('Relay-only connection timed out')),15000);
          b.ondatachannel=event=>{event.channel.onmessage=()=>event.channel.send('ok');};
          channel.onopen=()=>channel.send('ping');channel.onmessage=()=>resolve();
        });
        // Attach a rejection handler immediately while the file descriptions gather.
        reply.catch(()=>{});
        try{
          await a.setLocalDescription(await a.createOffer());await gatherIce(a);
          await b.setRemoteDescription(a.localDescription);await b.setLocalDescription(await b.createAnswer());await gatherIce(b);
          await a.setRemoteDescription(b.localDescription);await reply;return {milliseconds:Math.round(performance.now()-start),connected:true};
        }finally{clearTimeout(timer);a.close();b.close();}
      },profile.ice);
      console.log(JSON.stringify({profile:'relay-only invite/reply and data roundtrip',...roundtrip}));
    }
  }
}finally{await browser?.close();await app.close();}
