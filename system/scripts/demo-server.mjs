// Isolated local demo backend: real gamepads, simulated desktop mouse/typing.
// The production launcher never imports this file.
import { EventEmitter } from 'node:events';
import { createApp } from '../src/server.js';
if(process.env.DEMO_MOUSE!=='1')throw new Error('This server is only for the explicit simulated mouse demo');
const report=value=>console.log('DEMO_MOUSE '+JSON.stringify(value));
const app=createApp({desktopSimulation:true,createDesktop:async()=>Object.assign(new EventEmitter(),{
  display:{width:1920,height:1080},simulatedSurface:true,
  setState(state){report({type:'state',state});},
  event(event){report({type:'event',event});},
  close(){report({type:'state',state:{keys:[],buttons:[]}});}
})});
app.server.listen(Number(process.env.PORT),'127.0.0.1');
for(const event of ['SIGINT','SIGTERM'])process.once(event,()=>app.close());
