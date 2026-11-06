// Standalone optional rendezvous service; never initializes local input/capture.
import {createApp} from '../src/server.js';
const app=createApp({env:{SESSION_SERVER_ENABLED:'1',SESSION_SERVER_ONLY:'1',SESSION_SERVER_MAX_CLIENTS:process.env.SESSION_SERVER_MAX_CLIENTS,TLS_CERT:process.env.TLS_CERT,TLS_KEY:process.env.TLS_KEY}});
const port=Number(process.env.SESSION_SERVER_PORT || 8790),host=process.env.SESSION_SERVER_HOST || '127.0.0.1';
app.server.listen(port,host,()=>{
  console.log(`Temporary invite server listening on ${host}:${app.server.address().port}.`);
  console.log('Use an HTTPS reverse proxy for Internet access. Set SESSION_SERVER_URL in each local app to that public HTTPS address.');
  console.log('This service handles invitations and connection setup. Direct WebRTC and optional TURN carry input/video/audio.');
});
app.server.on('error',error=>{console.error(error.message);app.close();process.exitCode=1;});
for(const event of ['SIGINT','SIGTERM'])process.once(event,()=>app.close());
