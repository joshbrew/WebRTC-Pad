import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import injection from './inject/index.js';
import states from './inject/state.js';
import { createIceProvider } from './ice.js';
import { readConfig } from './config.js';
import { createFallback } from './fallback.js';
import { NativeMedia, nativeCapability } from './native-media.js';
import {captureRegion} from './capture-region.js';
import {createEncoderScanner} from './encoder-scan.js';
import {nativeAudioCapability} from './native-audio.js';
import { captureTargets, createDesktopInjector } from './desktop-input.js';
import { createCursorOverlay } from './cursor-overlay.js';
import { desktopSnapshot, desktopCodes } from '../public/desktop.js';
import { playerSlots } from '../public/players.js';
import {GuestInputService,guestInputCapability} from './guest-input.js';
import {desktopCapabilities,waylandPortalAvailable} from './desktop-capabilities.js';
import {macPermissions} from './macos-desktop.js';
import {createSessionServer,sessionSettings} from './session-server.js';
import {AppInputBridge} from './app-input-bridge.js';
import {ControllerReceiver} from './controller-receiver.js';
import {controllerPlatform} from '../public/controller-platform.js';
import {sourceThumbnail} from './source-thumbnail.js';
export { readIce } from './ice.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));
// Only the chart package's browser source graph is public. Its npm 0.2.0
// archive does not include dist/, so resolve the shipped ESM sources instead.
const CHART_DIR=path.resolve(fileURLToPath(new URL('../../node_modules/uplot-webgpu/',import.meta.url)));
const CHART_FILES=new Map();
function chartFile(relative){
  if(CHART_FILES.has('/charts/'+relative))return;
  const absolute=path.resolve(CHART_DIR,relative);
  if(!absolute.startsWith(CHART_DIR+path.sep) || !/\.(js|css)$/.test(relative))return;
  try{
    const source=fs.readFileSync(absolute,'utf8');CHART_FILES.set('/charts/'+relative,absolute);
    for(const match of source.matchAll(/\b(?:import|export)\s+(?:[^'";]*?\s+from\s*)?['"](\.[^'"]+)['"]|\bimport\(['"](\.[^'"]+)['"]\)/g))chartFile(path.posix.normalize(path.posix.join(path.posix.dirname(relative),match[1] || match[2])));
  }catch{/* Missing dependencies are repaired by the platform launcher. */}
}
chartFile('scripts/uPlot.js');chartFile('scripts/uPlot.css');
const DESIGN_FILES=new Map();
function designFiles(directory=path.join(PUBLIC_DIR,'design')){
  if(!fs.existsSync(directory))return;
  for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
    const absolute=path.join(directory,entry.name);
    if(entry.isDirectory())designFiles(absolute);
    else if(entry.isFile() && /\.(css|svg|woff2)$/.test(entry.name))DESIGN_FILES.set('/'+path.relative(PUBLIC_DIR,absolute).split(path.sep).join('/'),absolute);
  }
}
designFiles();
const random = bytes => crypto.randomBytes(bytes).toString('hex');
const send = (ws, message) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message)); };
const local = req => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
const localCanHost = req => {
  try { return local(req) && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(`http://${req.headers.host}`).hostname); }
  catch { return false; }
};
const sameOrigin = req => {
  try { return new URL(req.headers.origin).host === req.headers.host; } catch { return false; }
};
export function createApp({ createInjector = options=>injection.createInjector({...options,env,platform}), createNativeMedia = (captureEnv=env) => new NativeMedia(captureEnv, platform,encoderScanner.peek()?.selected), createDesktop = () => createDesktopInjector(env, platform), createOverlay = (captureEnv=env) => createCursorOverlay(captureEnv, platform), getCaptureTargets = () => captureTargets(env,platform), getMacPermissions = action => macPermissions(action,env), encoderScanner, guestInputService, desktopSimulation = false, env = process.env, platform = process.platform, staleMs = 350 } = {}) {
  const sessionConfig=sessionSettings(env),canHost=req=>!sessionConfig.hosted && localCanHost(req);
  const sessions=sessionConfig.enabled?createSessionServer({maxClients:Number(env.SESSION_SERVER_MAX_CLIENTS || 512)}):null;
  encoderScanner ||= createEncoderScanner({ffmpeg:nativeCapability(env,platform).ffmpeg,env,platform});
  const rooms = new Map();
  const thumbnailTargets=new Map(),thumbnailCache=new Map();let thumbnailReaders=0;
  const appInputBridge=new AppInputBridge(rooms);
  const config = readConfig(env, platform);
  const controllerReceiver=new ControllerReceiver({createInjector,outputs:config.controllerOutputs});
  const guestInput = guestInputService || new GuestInputService({capability:guestInputCapability(platform)});
  const features=desktopCapabilities(env,platform);
  const sourceEnv=target=>target?.kind==='window'?{NATIVE_WINDOW_HANDLE:target.id,NATIVE_WINDOW_PID:String(target.pid),NATIVE_WINDOW_START:target.processStart || '',...(platform==='win32'?{NATIVE_WINDOWS_CAPTURE:'wgc'}:{})}:{NATIVE_WINDOW_HANDLE:'',NATIVE_WINDOW_PID:'',NATIVE_WINDOW_START:'',NATIVE_DISPLAY_INDEX:'0'};
  const sameProcess=(a,b)=>a?.pid===b?.pid && a?.processStart===b?.processStart;
  const publicConfig = (r) => { const native = nativeCapability(env, platform), audio=nativeAudioCapability(env,platform),waylandPortal=waylandPortalAvailable(env,platform); return { ...config, controllerReceiver:controllerPlatform(platform),maxRemoteControllers: r?r.controllerLimit:config.maxPlayers, ...(r ? {slots:r.slots,playerCount:r.slots.length,controllerType:r.controllerType,maxPlayers:r.controllerLimit,dynamicControllers:r.dynamicControllers,adaptiveControllers:r.adaptiveControllers} : {}), desktopSimulation, desktopSession:features.session,waylandPortal, desktopInput:desktopSimulation || waylandPortal || (platform==='darwin'?features.windowMouse:platform!=='linux' || features.session==='x11'),windowMouse:features.windowMouse, captureDefault: env.NATIVE_WINDOW_HANDLE || 'desktop', cursorOverlay:features.cursorOverlay && !desktopSimulation, nativeCapture: { available: native.available, error: native.error,audio:{available:audio.available,window:audio.window,streaming:!!native.helper && !!native.ffmpeg,error:audio.error} } }; };
  const validateCaptureQuality=q=>{if(!q || q.codec!==undefined && !['h264','h265'].includes(q.codec) || q.encoderPreset!==undefined && !['p1','p2','p4'].includes(q.encoderPreset) || ![15,30,60,120].includes(q.frameRate) || !Number.isFinite(q.maxBitrate) || q.maxBitrate<500000 || q.maxBitrate>60000000 || q.width!==undefined && (!Number.isInteger(q.width)||q.width<2||q.width>7680) || q.height!==undefined && (!Number.isInteger(q.height)||q.height<2||q.height>4320))throw new Error('Invalid capture quality');};
  async function nativeSource(id,audio=false,region=null) {
    const targets=String(id || 'desktop')==='desktop' && !region?[{kind:'desktop',id:'desktop',label:'Entire primary screen'}]:await getCaptureTargets();
    const target=targets.find(value=>value.id===String(id || 'desktop'));
    if(['win32','linux','darwin'].includes(platform) && !target)throw new Error('Selected screen/window is unavailable. Refresh the source list.');
    if(typeof audio!=='boolean')throw new Error('Invalid audio setting');
    if(audio){const capability=nativeAudioCapability(env,platform);if(!capability.available)throw new Error(capability.error);if(target?.kind==='window' && (!capability.window || !Number.isInteger(target.pid) || target.pid<=0))throw new Error('Application-only audio is unavailable for this window. System audio is never substituted.');}
    const size=[target?.width,target?.height].every(n=>Number.isInteger(n)&&n>1&&n<=32768)?`${target.width}x${target.height}`:'';
    const area=captureRegion(region,size?target:undefined);
    return {target,captureEnv:{...env,...sourceEnv(target),...(area && platform==='win32' && env.NATIVE_WINDOWS_CAPTURE!=='dda'?{NATIVE_WINDOWS_CAPTURE:'wgc'}:{}),NATIVE_CAPTURE_REGION:area?`${area.x},${area.y},${area.width},${area.height}`:'',NATIVE_CAPTURE_SOURCE_SIZE:size,NATIVE_AUDIO:audio?'1':'0',NATIVE_AUDIO_PID:audio && target?.kind==='window'?String(target.pid):'0',NATIVE_AUDIO_START:audio && target?.kind==='window'?target.processStart || '':''}};
  }
  async function changeNativeAudio(state,enabled) {
    if(typeof enabled!=='boolean')throw new Error('Invalid audio setting');
    if(!state?.target)throw new Error('Choose a native source first');
    // Revalidate app identity before enabling sound; never broaden to system audio.
    const source=enabled?await nativeSource(state.target.id,true,state.captureEnv.NATIVE_CAPTURE_REGION):{target:state.target,captureEnv:{...state.captureEnv,NATIVE_AUDIO:'0',NATIVE_AUDIO_PID:'0'}};
    if(!sameProcess(source.target,state.target))throw new Error('Selected window changed. Choose it again.');
    state.captureEnv=source.captureEnv;
    return await state.native?.setAudio(enabled,Number(source.captureEnv.NATIVE_AUDIO_PID)) || {audioAvailable:false};
  }
  function validatePreviewIce(msg) {
    if(msg.peerId && msg.peerId!=='preview' || typeof msg.candidate?.candidate!=='string' || msg.candidate.candidate.length>4096)throw new Error('Invalid preview ICE candidate');
  }
  const getIce = createIceProvider(env);
  const ttl = Math.max(500, Number(env.ROOM_TTL_MS) || 90000);
  const { maxPeers } = config;
  const fallback = createFallback({ rooms, config, send });
  const ownedSlots = p => p.slots || (p.slot ? [p.slot] : []);
  const pickSlot = (r, role) => {
    if (role !== 'play' && !r.slots.includes(role)) return null;
    const used = new Set([...r.peers.values()].flatMap(ownedSlots));
    return [role, ...r.slots].find(slot => r.slots.includes(slot) && !used.has(slot)) || null;
  };
  const serve = (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' wss:${sessionConfig.url?.startsWith('http:')?' '+sessionConfig.url.replace('http:','ws:'):''}; media-src 'self' blob:; img-src 'self' blob:; frame-ancestors 'none'`);
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
    catch { res.writeHead(400); res.end('Bad URL'); return; }
    if(pathname.startsWith('/api/inputs')){
      res.setHeader('Content-Type','application/json');if(!canHost(req) || req.headers.origin && !sameOrigin(req)){res.writeHead(403);res.end(JSON.stringify({error:'Local same-origin access only'}));return;}
      if(pathname==='/api/inputs' && req.method==='GET'){res.end(JSON.stringify({version:1,subscribe:'/api/inputs/subscribe',create:'/api/inputs/sessions',sdk:'/input-api.js',guide:'/app-inputs',kinds:['keyboard','mouse','midi','controller','device','reset'],sessions:[...appInputBridge.locals.values()].map(s=>({id:s.id,label:s.label,active:s.publisher?.readyState===1}))}));return;}
      if(pathname==='/api/inputs/sessions' && req.method==='POST'){let body='',tooLarge=false;req.setTimeout(5000,()=>req.destroy());req.on('data',data=>{body+=data;if(body.length>1024){tooLarge=true;req.destroy();}});req.on('end',()=>{if(tooLarge)return;try{const value=JSON.parse(body || '{}'),s=appInputBridge.create(value.label);res.writeHead(201);res.end(JSON.stringify({version:1,id:s.id,label:s.label,readToken:s.readToken,writeToken:s.writeToken}));}catch(error){res.writeHead(400);res.end(JSON.stringify({error:error.message}));}});return;}
      if(pathname.startsWith('/api/inputs/sessions/') && req.method==='DELETE'){const id=pathname.split('/').at(-1),s=appInputBridge.locals.get(id);if(!s || req.headers.authorization!==`Bearer ${s.writeToken}`){res.writeHead(403);res.end('{}');return;}appInputBridge.end(s);appInputBridge.locals.delete(id);res.end('{}');return;}
      res.writeHead(404);res.end('{}');return;
    }
    if (pathname === '/config') {
      if(sessionConfig.hosted){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({app:'webrtc-pad',sessionServer:{hosted:true,url:null}}));return;}
      if (!canHost(req)) { res.writeHead(403); res.end('Local access only'); return; }
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ...publicConfig(), platform, app: 'webrtc-pad',...(platform==='win32'?{guestInputSetup:{installDeclined:guestInput.capability.installDeclined===true,installApproved:guestInput.capability.installApproved===true}}:{}),...(sessionConfig.url?{sessionServer:{url:sessionConfig.url,hosted:false}}:{}) })); return;
    }
    if(pathname==='/mac-permissions'){
      if(platform!=='darwin' || !canHost(req) || req.method==='POST' && !sameOrigin(req)){res.writeHead(403);res.end('Local Mac access only');return;}
      const action=req.method==='GET'?'status':new URL(req.url,'http://localhost').searchParams.get('action');
      if(!['GET','POST'].includes(req.method) || !['status','screen','input'].includes(action)){res.writeHead(400);res.end('Invalid permission request');return;}
      res.setHeader('Content-Type','application/json');
      getMacPermissions(action).then(value=>res.end(JSON.stringify(value))).catch(error=>{res.writeHead(503);res.end(JSON.stringify({error:error.message}));});return;
    }
    if(pathname==='/encoder-check') {
      if(!canHost(req)){res.writeHead(403);res.end('Local access only');return;}
      if(req.method!=='GET'){res.writeHead(405,{Allow:'GET'});res.end('Use GET');return;}
      res.setHeader('Content-Type','application/json');
      encoderScanner.scan(new URL(req.url,'http://localhost').searchParams.get('refresh')==='1').then(value=>res.end(JSON.stringify(value))).catch(()=>{res.writeHead(503);res.end(JSON.stringify({error:'Encoder check could not finish. Try again.'}));});return;
    }
    if (pathname === '/capture-targets') {
      if (!canHost(req)) { res.writeHead(403); res.end('Local access only'); return; }
      res.setHeader('Content-Type','application/json');
      res.setHeader('Cache-Control','no-store');
      getCaptureTargets().then(targets=>{thumbnailTargets.clear();for(const target of targets)thumbnailTargets.set(target.id,target);res.end(JSON.stringify({targets}));}).catch(error=>{res.writeHead(503);res.end(JSON.stringify({error:error.message}));}); return;
    }
    if(pathname==='/capture-thumbnail'){
      const foreign=req.headers['sec-fetch-site']==='cross-site' || req.headers.origin && !sameOrigin(req) || req.headers.referer && (()=>{try{return new URL(req.headers.referer).host!==req.headers.host;}catch{return true;}})();
      if(!canHost(req) || foreign){res.writeHead(403);res.end();return;}
      if(req.method!=='GET'){res.writeHead(405,{Allow:'GET'});res.end();return;}
      const id=new URL(req.url,'http://localhost').searchParams.get('id'),target=thumbnailTargets.get(id);
      if(!target){res.writeHead(404);res.end();return;}
      res.setHeader('Cache-Control','no-store');res.setHeader('Cross-Origin-Resource-Policy','same-origin');
      const key=JSON.stringify([target.id,target.pid,target.processStart]),cached=thumbnailCache.get(key);
      if(cached && Date.now()-cached.at<3000){res.writeHead(200,{'Content-Type':'image/png'});res.end(cached.data);return;}
      if(thumbnailReaders>=2){res.writeHead(429);res.end();return;}
      thumbnailReaders++;
      sourceThumbnail(target,env,platform).then(data=>{thumbnailCache.set(key,{at:Date.now(),data});while(thumbnailCache.size>64)thumbnailCache.delete(thumbnailCache.keys().next().value);res.writeHead(200,{'Content-Type':'image/png'});res.end(data);}).catch(()=>{res.writeHead(204);res.end();}).finally(()=>thumbnailReaders--);return;
    }
    if (pathname === '/ice') {
      const room = new URL(req.url, 'http://localhost').searchParams.get('room');
      if (!canHost(req) && !rooms.has(room)) { res.writeHead(403); res.end('Join a room first'); return; }
      res.setHeader('Content-Type', 'application/json');
      getIce().then(config => res.end(JSON.stringify(config))).catch(error => { res.writeHead(503); res.end(JSON.stringify({ error: error.message })); });
      return;
    }
    // Serve an explicit allowlist, including browser modules; no directory traversal.
    const files = { '/': 'index.html', '/index.html': 'index.html', '/port-forwarding': 'port-forwarding.html', '/port-forwarding.html': 'port-forwarding.html', '/app.js': 'app.js', '/ui.js': 'ui.js', '/media.js': 'media.js', '/players.js': 'players.js', '/input.js': 'input.js', '/rtc.js': 'rtc.js', '/pairing.js': 'pairing.js', '/style.css': 'style.css' };
    files['/playback.js']='playback.js';
    files['/video-handover.js']='video-handover.js';
    files['/video-health.js']='video-health.js';
    files['/last-session.js']='last-session.js';
    files['/input-clock.js'] = 'input-clock.js';
    files['/input-wire.js']='input-wire.js';
    files['/codecs.js']='codecs.js';
    files['/sessions.js']='sessions.js';
    files['/stage-controls.js']='stage-controls.js';
    files['/chat.js']='chat.js';files['/camera.js']='camera.js';files['/camera-quality.js']='camera-quality.js';files['/voice.js']='voice.js';files['/voice-quality.js']='voice-quality.js';files['/handoff.js']='handoff.js';files['/keyboard-mapping.js']='keyboard-mapping.js';
    files['/diagnostics.js']='diagnostics.js';files['/diagnostic-history.js']='diagnostic-history.js';
    files['/connection-report.js']='connection-report.js';
    files['/controller-presence.js']='controller-presence.js';
    files['/file-transfer.js']='file-transfer.js';
    files['/connection-check.js']='connection-check.js';
    files['/voice-controls.js']='voice-controls.js';
    files['/rumble.js']='rumble.js';
    files['/relative-mouse.js']='relative-mouse.js';
    files['/session-presets.js']='session-presets.js';
    files['/participants.js']='participants.js';
    for(const name of ['screen-room','screen-quality','screen-layout','tile-adjustments','media-controls','app-inputs','app-input-wire','input-api','reverse-controllers','controller-platform'])files[`/${name}.js`]=`${name}.js`;
    files['/app-inputs']='app-inputs.html';
    files['/host-shares.js']='host-shares.js';
    files['/capture-region.js']='capture-region.js';files['/view-popouts.js']='view-popouts.js';
    files['/view-window.html']='view-window.html';files['/view-window.js']='view-window.js';
    files['/guest-tiles.js']='guest-tiles.js';
    files['/call-settings.js']='call-settings.js';files['/call-comfort.js']='call-comfort.js';files['/call-shell.js']='call-shell.js';files['/call-shell.css']='call-shell.css';files['/source-picker.js']='source-picker.js';
    files['/design-app.css']='design-app.css';files['/theme.js']='theme.js';
    files['/mobile-navigation.js']='mobile-navigation.js';
    files['/guest-input.js']='guest-input.js';
    files['/guest-platform.js']='guest-platform.js';
    files['/guest-device-isolation']='guest-device-isolation.html';
    files['/linux-desktop']='linux-desktop.html';
    files['/mac-desktop']='mac-desktop.html';files['/mac-desktop.js']='mac-desktop.js';
    files['/interaction-motion.js']='interaction-motion.js';
    files['/stats.js'] = 'stats.js';
    files['/quality.js'] = 'quality.js';
    files['/desktop.js'] = 'desktop.js';
    files['/cursors.js'] = 'cursors.js';
    const filename = files[pathname] || CHART_FILES.get(pathname) || DESIGN_FILES.get(pathname);
    if (!filename) { res.writeHead(404); res.end('Not found'); return; }
    fs.readFile(CHART_FILES.has(pathname) || DESIGN_FILES.has(pathname)?filename:path.join(PUBLIC_DIR, filename), (error, data) => {
      if (error) { res.writeHead(404); res.end('Not found'); return; }
      if(pathname==='/input-api.js')res.setHeader('Access-Control-Allow-Origin','*');
      res.setHeader('Content-Type', { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8','.svg':'image/svg+xml','.woff2':'font/woff2' }[path.extname(filename)]);
      // The package CSS includes demo-wide light color and forced-color rules.
      // Keep the app's theme/accessibility settings when charts are opened.
      if(pathname==='/charts/scripts/uPlot.css')data=data.toString().replace(/:root\s*\{[^}]*\}/,'').replace(/html,\s*body,\s*/,'');
      res.end(data);
    });
  };
  if (!!env.TLS_CERT !== !!env.TLS_KEY) throw new Error('Set both TLS_CERT and TLS_KEY');
  const server = env.TLS_CERT ? https.createServer({ cert: fs.readFileSync(env.TLS_CERT), key: fs.readFileSync(env.TLS_KEY) }, serve) : http.createServer(serve);
  const signal = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  const inputs = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  const guestInputs=new WebSocketServer({noServer:true,maxPayload:16384});
  guestInputs.on('connection',ws=>guestInput.attach(ws));
  const receiverSockets=new WebSocketServer({noServer:true,maxPayload:4096});receiverSockets.on('connection',ws=>controllerReceiver.attach(ws));
  server.on('upgrade', (req, socket, head) => {
    let pathname;try{pathname=new URL(req.url,'http://localhost').pathname;}catch{socket.destroy();return;}
    if(pathname==='/sessions'){
      if(!sessions){socket.destroy();return;}
      sessions.wss.handleUpgrade(req,socket,head,ws=>sessions.wss.emit('connection',ws,req));return;
    }
    if(sessionConfig.hosted){socket.destroy();return;}
    if(['/app-input','/api/inputs/subscribe','/api/inputs/publish'].includes(pathname)){
      if(!canHost(req) || pathname!=='/api/inputs/subscribe' && req.headers.origin && !sameOrigin(req)){socket.destroy();return;}
      appInputBridge.upgrade(req,socket,head);return;
    }
    if(pathname==='/controller-receiver'){
      if(!canHost(req) || !sameOrigin(req)){socket.destroy();return;}
      receiverSockets.handleUpgrade(req,socket,head,ws=>receiverSockets.emit('connection',ws,req));return;
    }
    if(pathname==='/guest-input'){
      if(!canHost(req) || !sameOrigin(req)){socket.destroy();return;}
      guestInputs.handleUpgrade(req,socket,head,ws=>guestInputs.emit('connection',ws,req));return;
    }
    if (pathname === '/fallback') {
      if (!config.fallbackEnabled) { socket.destroy(); return; }
      fallback.wss.handleUpgrade(req, socket, head, ws => fallback.wss.emit('connection', ws, req)); return;
    }
    if (!sameOrigin(req) || (pathname === '/inject' && !canHost(req))) { socket.destroy(); return; }
    const wss = pathname === '/ws' ? signal : pathname === '/inject' ? inputs : null;
    if (!wss) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  });
  function status(r) { return { ready: !!r.injector && env.INPUT_BACKEND !== 'none', backend: r.injector?.name || null, error: r.driverError || (env.INPUT_BACKEND === 'none' ? 'Video-only mode is enabled' : null) }; }
  function driverError(r, error) {
    r.driverError = error.message;
    try { r.injector?.close(); } catch { /* Already disconnected. */ }
    r.injector = null;
    r.active.clear();
    send(r.hostWs, { type: 'driver-status', ...status(r) });
  }
  function reset(r, slot) {
    if (!slot || r.dynamicControllers && !r.createdSlots.has(slot)) return;
    r.active.delete(slot); r.inputSources.delete(slot);
    try { r.injector?.setState(slot, states.neutralState()); } catch (error) { driverError(r, error); }
  }
  function resetAll(r) { for (const slot of r.slots) reset(r, slot); }
  function resetPeer(r, p) { for (const slot of ownedSlots(p)) reset(r, slot); }
  function removeDevice(r,slot) {
    if(!r.dynamicControllers || !r.createdSlots.delete(slot))return;
    Promise.resolve(r.injector?.removeController(slot)).catch(error=>send(r.hostWs,{type:'error',error:`Controller removal: ${error.message}`}));
  }
  function removePeerDevices(r,p) { for(const slot of ownedSlots(p))removeDevice(r,slot); }
  async function ensureDevice(r,slot) {
    if(!r.dynamicControllers || r.createdSlots.has(slot))return;
    if(!r.injector?.addController)throw new Error(r.driverError || 'The controller driver is unavailable or needs an updated helper');
    await r.injector.addController(slot);r.createdSlots.add(slot);
  }
  const croppedWindow=r=>!!r.captureEnv?.NATIVE_CAPTURE_REGION && platform==='win32' && r.captureKind==='native' && r.captureTarget?.kind==='window';
  function desktopPolicy(r) {
    if(r.captureEnv?.NATIVE_CAPTURE_REGION && !croppedWindow(r))return {desktopCropped:true,desktopMouse:false,desktopKeyboard:false,desktopFullAccess:false,desktopScope:'none',pointerOverlaySafe:false,sharedSource:'Selected area',desktopSimulated:desktopSimulation,desktopVideoMatches:false};
    const source = r.native?.sourceSize, display = r.desktop?.display || r.desktopDisplay;
    const scope = r.desktopFullAccess ? 'desktop' : r.captureTarget?.kind === 'window' ? 'window' : 'none';
    const matches = r.desktop?.simulatedSurface === true || scope === 'window' && r.captureTarget?.kind === 'window' || scope === 'desktop' && (r.captureTarget?.kind === 'desktop' || !env.NATIVE_WINDOW_HANDLE && !!r.native && Number(env.NATIVE_DISPLAY_INDEX || 0) === 0 && !!source && !!display && source.width === display.width && source.height === display.height);
    return { desktopRelative:r.desktop?.relativeMouse===true && (scope!=='window' || platform==='win32'),desktopMouse:r.desktopMouse===true, desktopKeyboard:r.desktopKeyboard===true, desktopFullAccess:r.desktopFullAccess===true, desktopScope:scope, pointerOverlaySafe:!r.captureEnv?.NATIVE_CAPTURE_REGION && (r.captureTarget?.kind==='window' || r.captureTarget?.kind==='desktop' && Number(r.captureEnv?.NATIVE_DISPLAY_INDEX || 0)===0), sharedSource:r.captureTarget?.label || '', desktopSimulated:desktopSimulation, desktopSize:display, desktopVideoMatches:matches };

  }
  function desktopState(r, position) {
    const snapshots = [...(r.desktopStates?.values() || [])];
    r.desktop?.setState({ keys: r.desktopKeyboard ? [...new Set(snapshots.flatMap(s => s.keys))] : [], buttons: r.desktopMouse ? [...new Set(snapshots.flatMap(s => s.buttons))] : [], ...(r.desktopMouse && position?.x !== undefined ? { x: position.x, y: position.y } : {}) });
  }
  const desktopContexts=r=>[r,...(r.extraCaptures?.values() || [])];
  function releaseDesktop(r,peerId) { for(const context of desktopContexts(r))releaseDesktopContext(context,peerId,r); }
  function releaseDesktopContext(r, peerId, owner=r) { r.desktopStates?.delete(peerId); r.overlay?.send({type:'remove',id:peerId}); try { desktopState(r); } catch (error) { stopDesktop(r);if(owner===r)send(owner.hostWs,{type:'input-policy',allowKeyboard:owner.allowKeyboard,...desktopPolicy(r)});else{const sourceId=[...owner.extraCaptures].find(([,s])=>s===r)?.[0];if(sourceId)send(owner.hostWs,{type:'view-input-policy',sourceId,policy:desktopPolicy(r)});}send(owner.hostWs,{type:'error',error:`Desktop input: ${error.message}`}); } }
  function stopDesktop(r) { r.desktopStates?.clear(); r.desktop?.close(); r.desktop = null; r.desktopMouse = false; r.desktopKeyboard = false; }
  const closeGuestMedia=(native,id)=>native?.closeGuest?native.closeGuest(id):native?.closePeer(id);
  function closeRoom(r) {
    if (!rooms.has(r.roomId)) return;
    rooms.delete(r.roomId); clearTimeout(r.timer); resetAll(r);
    appInputBridge.end(r);
    if(!rooms.size)guestInput.setHosting?.(false);
    stopDesktop(r);
    r.overlay?.close(); r.overlay = null;
    r.native?.close(); r.native = null;
    for(const source of r.extraCaptures?.values() || []){stopDesktop(source);source.native?.close();}r.extraCaptures?.clear();
    r.audioCapture?.native?.close();r.audioCapture=null;
    try { r.injector?.close(); } catch { /* Best effort on shutdown. */ }
    r.injectWs?.close(); r.hostWs?.close();
    for (const p of r.peers.values()) { fallback.closePeer(p); p.ws?.close(); }
  }
  function updateSlots(r, id, assigned, removedController) {
    const p = r.peers.get(id); if (!p) return;
    if (JSON.stringify(ownedSlots(p)) !== JSON.stringify(assigned)) {
      resetPeer(r,p); p.generation = (p.generation || 0) + 1;
      for(const slot of ownedSlots(p))if(!assigned.includes(slot))removeDevice(r,slot);
      releaseDesktop(r,id);
    }
    p.slots = assigned; p.slot = assigned[0] || null; p.role = p.slot || 'watch';
    const value = {type:'slot-update',slot:p.slot,slots:p.slots,generation:p.generation || 0,capacity:r.controllerLimit,adaptiveControllers:r.adaptiveControllers,wantsController:p.wantsController===true,dynamicControllers:r.dynamicControllers,removedController};
    send(p.ws,value); send(r.hostWs,{...value,peerId:id});
  }
  function updateSlot(r,id,slot) { const p=r.peers.get(id);if(p)p.wantsController=!!slot;updateSlots(r,id,slot ? [slot] : []); }
  signal.on('connection', (ws, req) => {
    ws.alive = true; ws.on('pong', () => { ws.alive = true; });
    let queue = Promise.resolve();
    ws.on('message', raw => {
      queue = queue.then(async () => {
        let msg; try { msg = JSON.parse(raw); } catch { return; }
        if (!msg || typeof msg.type !== 'string') return;
        if(msg.type.startsWith('audio-')) {
          try {
            const room=ws.roomId?rooms.get(ws.roomId):null;
            if(!canHost(req) || ws.roomId && room?.hostWs!==ws)throw new Error('Local host audio only');
            const owner=room || ws;
            let state=owner.audioCapture,result;
            if(msg.type==='audio-stop'){state?.native?.close();owner.audioCapture=null;}
            else if(msg.type==='audio-source') {
              if(typeof msg.enabled!=='boolean')throw new Error('Invalid audio setting');
              if(!msg.enabled)result=state?await changeNativeAudio(state,false):{audioAvailable:false};
              else {
                if(typeof msg.sourceId!=='string' || !msg.sourceId)throw new Error('Choose an audio application or system output');
                const source=await nativeSource(msg.sourceId,true);
                if(state?.target?.id===source.target?.id && !sameProcess(state.target,source.target))throw new Error('Selected audio application changed. Choose an audio source again.');
                if(!state || state.target?.id!==source.target?.id || state.target?.pid!==source.target?.pid){
                  state?.native?.close();state={...source,native:null};owner.audioCapture=state;
                } else result=await changeNativeAudio(state,true);
                state.captureEnv={...state.captureEnv,NATIVE_AUDIO_ONLY:'1'};
              }
            } else {
              if(!state)throw new Error('Choose a native audio source first');
              if(msg.peerId!=='preview' && !room?.peers.has(msg.peerId))throw new Error('Player is no longer in the session');
              if(msg.type==='audio-offer') {
                if(!state.native){state.native=createNativeMedia({...state.captureEnv,NATIVE_AUDIO_ONLY:'1'});state.native.on('status',value=>send(ws,{...value,type:'native-status'}));}
                result=await state.native.offer(msg.peerId,{},msg.peerId==='preview'?{iceServers:[]}:await getIce());
              } else if(msg.type==='audio-answer') {
                if(msg.sdp?.type!=='answer' || typeof msg.sdp.sdp!=='string' || msg.sdp.sdp.length>98304)throw new Error('Invalid audio answer');
                await state.native?.answer(msg.peerId,msg.sdp);
              } else if(msg.type==='audio-ice'){validatePreviewIce(msg);await state.native?.ice('preview',msg.candidate);}
              else if(msg.type==='audio-close')await state.native?.closePeer(msg.peerId);
              else throw new Error('Unknown audio command');
            }
            if(ws.readyState!==WebSocket.OPEN){state?.native?.close();return;}
            send(ws,{type:'native-result',requestId:msg.requestId,result});
          } catch(error){send(ws,{type:'native-result',requestId:msg.requestId,error:error.message});}
          return;
        }
        if(msg.type.startsWith('preview-')) {
          try {
            if(!canHost(req) || ws.roomId)throw new Error('Local pre-session preview only');
            if(msg.type==='preview-source') {
              const source=await nativeSource(msg.id,msg.audio ?? false,msg.region);ws.preview?.native?.close();ws.preview={...source,native:null};
              send(ws,{type:'native-result',requestId:msg.requestId,result:{target:source.target}});return;
            }
            if(msg.type==='preview-stop'){ws.preview?.native?.close();ws.preview=null;send(ws,{type:'native-result',requestId:msg.requestId});return;}
            const preview=ws.preview;if(!preview)throw new Error('Choose a preview source first');
            let result;
            if(msg.type==='preview-audio')result=await changeNativeAudio(preview,msg.enabled);
            else if(msg.type==='preview-offer') {
              validateCaptureQuality(msg.quality);
              if(!preview.native){preview.native=createNativeMedia(preview.captureEnv);preview.native.on('status',value=>send(ws,{...value,type:'native-status'}));}
              result=await preview.native.offer('preview',msg.quality,{iceServers:[]});
              if(ws.readyState!==WebSocket.OPEN){preview.native.close();return;}
            } else if(msg.type==='preview-answer') {
              if(msg.sdp?.type!=='answer' || typeof msg.sdp.sdp!=='string' || msg.sdp.sdp.length>98304)throw new Error('Invalid preview answer');
              await preview.native?.answer('preview',msg.sdp);
            } else if(msg.type==='preview-ice'){validatePreviewIce(msg);await preview.native?.ice('preview',msg.candidate);}
            else if(msg.type==='preview-close')await preview.native?.closePeer('preview');
            else throw new Error('Unknown preview command');
            send(ws,{type:'native-result',requestId:msg.requestId,result});
          } catch(error){send(ws,{type:'native-result',requestId:msg.requestId,error:error.message});}return;
        }
        if (['create', 'resume', 'join'].includes(msg.type)) {
          if (ws.roomId) throw new Error('Already in a room');
          if (msg.type !== 'join' && !canHost(req)) throw new Error('Open localhost on the gaming computer to host');
          if (msg.type === 'create') {
            for(const ws of receiverSockets.clients)ws.close(1000,'Hosting started');
            for (const room of rooms.values()) if (room.hostWs?.readyState !== WebSocket.OPEN) closeRoom(room);
            if (rooms.size) throw new Error('A session is already running in another host page. Stop it there before starting a new session.');
            if(ws.audioCapture?.target?.kind==='window' && ws.audioCapture.captureEnv.NATIVE_AUDIO==='1'){
              const source=await nativeSource(ws.audioCapture.target.id,true);
              if(!sameProcess(source.target,ws.audioCapture.target))throw new Error('Selected audio application changed. Choose it again.');
            }
            if(ws.preview?.target?.kind==='window') {
              const current=await nativeSource(ws.preview.target.id,ws.preview.captureEnv.NATIVE_AUDIO==='1');
              if(!sameProcess(current.target,ws.preview.target))throw new Error('Selected window changed. Choose it again before starting.');
            }
            const output=config.controllerOutputs.find(value=>value.id===(msg.controllerType ?? config.controllerType));
            if(!output)throw new Error('Choose an available host controller output');
            const dynamicControllers=msg.dynamicControllers===true;
            const adaptiveControllers=dynamicControllers && output.maxPlayers===null;
            const count = adaptiveControllers?0:dynamicControllers?output.maxPlayers:msg.playerCount ?? Math.min(config.playerCount,output.maxPlayers ?? 64);
            if (!Number.isInteger(count) || count < (adaptiveControllers?0:1) || !adaptiveControllers && count > (output.maxPlayers ?? 64)) throw new Error(`Choose 1–${output.maxPlayers ?? 64} initial remote controllers for ${output.label}`);
            const r = { adaptiveControllers,dynamicControllers,createdSlots:new Set(),controllerType:output.id,controllerLimit:dynamicControllers?output.maxPlayers:count,slots: playerSlots(count), roomId: random(6), hostKey: random(24), injectToken: random(24), appInputToken: random(24), hostWs: ws, peers: new Map(), active: new Map(), inputSources: new Map(), allowKeyboard: true, desktopMouse: false, desktopKeyboard: false, desktopStates: new Map(), injector: null };
            const previewAdopted=!!ws.preview?.native;
            if(ws.preview){r.native=ws.preview.native;r.captureKind='native';r.captureTarget=ws.preview.target;r.captureEnv=ws.preview.captureEnv;ws.preview=null;}
            r.audioCapture=ws.audioCapture;ws.audioCapture=null;
            rooms.set(r.roomId, r); ws.roomId = r.roomId; ws.role = 'host';
            try{await guestInput.setHosting?.(true);}catch(error){closeRoom(r);throw error;}
            try { r.injector = await createInjector({ playerCount: dynamicControllers?0:r.slots.length,controllerType:r.controllerType }); } catch (error) { r.driverError = error.message; }
            r.injector?.onFeedback?.(value=>{if(!rooms.has(r.roomId))return;for(const [peerId,peer] of r.peers){const controller=ownedSlots(peer).indexOf(value.slot);if(controller>=0 && r.active.has(value.slot))send(r.hostWs,{type:'rumble',peerId,controller,generation:peer.generation || 0,large:value.large,small:value.small});}});
            if (ws.readyState !== WebSocket.OPEN || !rooms.has(r.roomId)) { if (rooms.has(r.roomId)) closeRoom(r); else r.injector?.close(); return; }
            send(ws, { type: 'created', roomId: r.roomId, hostKey: r.hostKey, injectToken: r.injectToken, appInputToken:r.appInputToken, driver: status(r), config: publicConfig(r), allowKeyboard: r.allowKeyboard,previewAdopted });
            return;
          }
          const r = rooms.get(String(msg.roomId));
          if (!r) throw new Error('Room not found');
          if (msg.type === 'resume') {
            if (r.hostKey !== msg.hostKey) throw new Error('Resume failed');
            await guestInput.setHosting?.(true);
            ws.preview?.native?.close();ws.preview=null;ws.audioCapture?.native?.close();ws.audioCapture=null;
            clearTimeout(r.timer);
            const previous = r.hostWs; r.hostWs = ws; ws.roomId = r.roomId; ws.role = 'host';
            stopDesktop(r);
            r.desktopFullAccess=false;r.captureTarget=null;
            r.overlay?.close(); r.overlay = null;
            r.native?.close(); r.native = null;r.audioCapture?.native?.close();r.audioCapture=null;
            for(const source of r.extraCaptures?.values() || []){stopDesktop(source);source.native?.close();}r.extraCaptures?.clear();
            resetAll(r); r.injectWs?.close(); r.injectWs = null; previous?.close();
            for (const [id, p] of r.peers) if (p.manual) { removePeerDevices(r,p);fallback.closePeer(p); r.peers.delete(id); }
            send(ws, { type: 'resumed', roomId: r.roomId, hostKey: r.hostKey, injectToken: r.injectToken, appInputToken:r.appInputToken, driver: status(r), config: publicConfig(r), allowKeyboard: r.allowKeyboard, peers: [...r.peers].map(([peerId, p]) => ({ peerId, role: p.role, slot: p.slot, slots: ownedSlots(p), generation:p.generation || 0 })) });
            for (const p of r.peers.values()) send(p.ws, { type: 'host-resumed' });
            return;
          }
          if (r.hostWs?.readyState !== WebSocket.OPEN) throw new Error('Host is disconnected; try again after it resumes');
          if (maxPeers && r.peers.size >= maxPeers) throw new Error('Room full');
          const slot = r.dynamicControllers?null:pickSlot(r, msg.role);
          ws.preview?.native?.close();ws.preview=null;ws.audioCapture?.native?.close();ws.audioCapture=null;
          const peerId = random(8), role = slot || 'watch';
          r.peers.set(peerId, { ws, role, slot, wantsController:msg.role==='play' || r.slots.includes(msg.role), slots: slot ? [slot] : [], generation:0 }); ws.roomId = r.roomId; ws.role = 'peer'; ws.peerId = peerId;
          send(ws, { type: 'joined', roomId: r.roomId, peerId, role, slot });
          send(r.hostWs, { type: 'peer-joined', peerId, role, slot,wantsController:r.peers.get(peerId).wantsController });
          return;
        }
        const r = rooms.get(ws.roomId); if (!r) return;
        if (ws.role === 'peer') {
          if (['offer', 'ice'].includes(msg.type)) send(r.hostWs, { type: msg.type, peerId: ws.peerId, sdp: msg.sdp, candidate: msg.candidate, negotiationId: msg.negotiationId });
          return;
        }
        if (r.hostWs !== ws) return;
        if(msg.type==='app-input'){appInputBridge.publish(r,msg.peerId,msg.packet);return;}
        if (msg.type === 'capture-source') {
          try {
            let target=null,sourceState;
            if(msg.kind==='native') {
              sourceState=await nativeSource(msg.id,msg.audio ?? false,msg.region);target=sourceState.target;
            } else if(msg.kind==='browser') {
              if(msg.surface==='window') {
                const targets=await getCaptureTargets(), id=String(msg.label || '').match(/^window:(\d+)(?::|$)/)?.[1];
                const matches=targets.filter(t=>t.kind==='window' && (t.id===id || t.label===msg.label));
                if(matches.length===1)target=matches[0];
              } else if(msg.surface==='monitor' && /^screen:0:/.test(msg.label || '')) target={kind:'desktop',id:'desktop',label:'Entire primary screen'};
            } else if(msg.kind!=='none') throw new Error('Invalid shared source');
            r.captureKind=msg.kind;
            const region=captureRegion(msg.region);
            if(region){stopDesktop(r);r.desktopFullAccess=false;}
            if(sourceState && r.native && r.captureTarget?.kind===target?.kind && r.captureTarget?.id===target?.id && sameProcess(r.captureTarget,target)) {
              r.captureEnv=sourceState.captureEnv;r.native.close();r.native=null;
              send(ws,{type:'input-policy',allowKeyboard:r.allowKeyboard,...desktopPolicy(r)});
              send(ws,{type:'native-result',requestId:msg.requestId,result:{target}});return;
            }
            r.desktopStates.clear(); r.desktop?.setState({keys:[],buttons:[]});
            if(msg.kind!=='none' || !r.desktopFullAccess)stopDesktop(r);
            if(msg.kind!=='none') r.desktopFullAccess=false;
            if(!r.desktopKeyboard && !r.desktopMouse) {r.desktop?.close();r.desktop=null;}
            r.captureTarget=target; r.captureEnv={...env,...sourceEnv(target),NATIVE_CAPTURE_REGION:region?`${region.x},${region.y},${region.width},${region.height}`:''};
            if(sourceState)r.captureEnv=sourceState.captureEnv;
            r.overlay?.close();r.overlay=null;send(ws,{type:'cursor-overlay',enabled:false});
            if(r.native && msg.kind!=='none'){r.native.close();r.native=null;}
            send(ws,{type:'input-policy',allowKeyboard:r.allowKeyboard,...desktopPolicy(r)});
            send(ws,{type:'native-result',requestId:msg.requestId,result:{target}});
          } catch(error){send(ws,{type:'native-result',requestId:msg.requestId,error:error.message});} return;
        }
        if (msg.type === 'cursor-overlay') {
          if (typeof msg.enabled !== 'boolean') throw new Error('Invalid overlay setting');
          if (msg.enabled && desktopSimulation) { send(ws,{type:'cursor-overlay',enabled:false,error:'Demo mouse is confined to the test screen. Desktop overlays are available in the normal host app.'}); return; }
          if (msg.enabled && !r.overlay) {
            const overlay = await createOverlay(r.desktopFullAccess ? {...env,NATIVE_WINDOW_HANDLE:''} : r.captureEnv || env);
            if (r.hostWs !== ws || !rooms.has(r.roomId)) { overlay.close(); return; }
            r.overlay = overlay;
            overlay.on?.('failure', error => { if (r.overlay !== overlay) return; r.overlay = null; overlay.close(); send(ws,{type:'cursor-overlay',enabled:false,error:error.message}); });
          } else if (!msg.enabled) { r.overlay?.close(); r.overlay = null; }
          send(ws,{type:'cursor-overlay',enabled:!!r.overlay}); return;
        }
        if (msg.type === 'overlay-cursor') {
          if (!r.overlay || !r.peers.has(msg.peerId)) return;
          const value=msg.cursor;
          if (!value || ![value.x,value.y].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1)) return;
          const peer=r.peers.get(msg.peerId);
          if (Date.now()-(peer.overlayAt || 0)<25 && peer.overlayPressed===(value.pressed===true) && peer.overlayVisible===(value.visible!==false)) return;
          peer.overlayAt=Date.now();peer.overlayPressed=value.pressed===true;peer.overlayVisible=value.visible!==false;
          // The local host chooses presentation; peers cannot submit overlay commands or window handles.
          r.overlay.send({type:'cursor',id:msg.peerId,x:value.x,y:value.y,visible:value.visible!==false,pressed:value.pressed===true,color:typeof value.color==='string'?value.color.slice(0,40):'',label:peer.slot?`Player ${peer.slot.slice(1)}`:'Guest',labels:msg.labels===true}); return;
        }
        if (msg.type === 'overlay-remove') { r.overlay?.send({type:'remove',id:String(msg.peerId).slice(0,64)}); return; }
        if (msg.type === 'overlay-labels') { r.overlay?.send({type:'labels',enabled:msg.enabled===true}); return; }
        if(msg.type==='desktop-stop'){
          for(const [sourceId,context] of r.extraCaptures || []){stopDesktop(context);send(ws,{type:'view-input-policy',sourceId,policy:desktopPolicy(context)});}
          stopDesktop(r);r.desktopFullAccess=false;send(ws,{type:'input-policy',allowKeyboard:r.allowKeyboard,...desktopPolicy(r)});return;
        }
        if (msg.type === 'input-policy') {
          if (typeof msg.allowKeyboard !== 'boolean') throw new Error('Invalid keyboard setting');
          const mouse = msg.desktopMouse === undefined ? r.desktopMouse : msg.desktopMouse;
          const full = msg.desktopFullAccess === undefined ? r.desktopFullAccess === true : msg.desktopFullAccess;
          if(typeof full !== 'boolean') throw new Error('Invalid desktop permission');
          const keyboard = msg.desktopKeyboard === undefined ? r.desktopKeyboard : msg.desktopKeyboard;
          if((mouse || keyboard || full) && r.captureEnv?.NATIVE_CAPTURE_REGION && (!croppedWindow(r) || full))throw new Error('Desktop control is off while sharing a selected area. Share the full source to enable it.');
          if (typeof mouse !== 'boolean' || typeof keyboard !== 'boolean') throw new Error('Invalid desktop control setting');
          if((mouse || keyboard) && !full && !desktopSimulation && r.captureTarget?.kind!=='window') throw new Error('Allow full-screen mouse/keyboard access separately, or share a specific window first.');
          if (mouse || keyboard) {
            if (!r.desktop) {
              const desktop = await createDesktop();
              if (r.hostWs !== ws || ws.readyState!==WebSocket.OPEN || !rooms.has(r.roomId)) { desktop.close(); throw new Error('Host session ended'); }
              r.desktop = desktop;
              r.desktopDisplay = desktop.display;
              desktop.on?.('display', display => { if (r.desktop !== desktop) return; if(r.captureTarget?.kind==='window' && r.native){r.native.close();r.native=null;send(r.hostWs,{type:'capture-resized'});} r.desktopDisplay = display; r.desktopStates.clear(); desktopState(r); send(r.hostWs, { type: 'input-policy', allowKeyboard: r.allowKeyboard, ...desktopPolicy(r) }); });
              desktop.on?.('scope-lost',()=>{if(r.desktop!==desktop)return;stopDesktop(r);r.desktopFullAccess=false;r.captureTarget=null;r.native?.close();r.native=null;send(r.hostWs,{type:'capture-source-ended'});send(r.hostWs,{type:'input-policy',allowKeyboard:r.allowKeyboard,...desktopPolicy(r)});send(r.hostWs,{type:'error',error:'Shared window changed or closed. Mouse and typing access were revoked.'});});
              desktop.on?.('failure', error => { if (r.desktop !== desktop) return; stopDesktop(r); send(r.hostWs, { type:'input-policy', allowKeyboard:r.allowKeyboard, ...desktopPolicy(r) }); send(r.hostWs, { type:'error', error:`Desktop input: ${error.message}` }); });
            }
          }
          const changedScope=full!==!!r.desktopFullAccess;
          if(changedScope){r.overlay?.close();r.overlay=null;send(ws,{type:'cursor-overlay',enabled:false});}
          if(r.desktop && (mouse || keyboard) && r.desktop.setScope) {
            const scope=!full && r.captureTarget?.kind==='window' ? {...r.captureTarget,...(croppedWindow(r)?{region:captureRegion(r.captureEnv.NATIVE_CAPTURE_REGION)}:{})} : {kind:'desktop'};
            if(r.desktop.scopeKey!==JSON.stringify([scope.kind,scope.id,scope.pid,scope.processStart,scope.region])){r.desktopStates.clear();r.desktop.setState({keys:[],buttons:[]});await r.desktop.setScope(scope);}
            r.desktopDisplay=r.desktop.display;
          } else if((mouse || keyboard) && !full && !desktopSimulation && r.captureTarget?.kind==='window') throw new Error('This input backend cannot enforce window-only access');
          r.desktopFullAccess=full;
          r.allowKeyboard = msg.allowKeyboard;
          r.desktopMouse = mouse; r.desktopKeyboard = keyboard;
          if (!mouse && !keyboard) stopDesktop(r); else desktopState(r);
          if (!r.allowKeyboard) for (const [slot, source] of r.inputSources) if (source === 'keyboard') reset(r, slot);
          send(ws, { type: 'input-policy', allowKeyboard: r.allowKeyboard, ...desktopPolicy(r) }); return;
        }
        if (msg.type.startsWith('native-')) {
          try {
            let result;
            r.extraCaptures ||= new Map();
            if(msg.type==='native-source-add'){
              if(r.extraCaptures.size>=32)throw new Error('Remove an unused screen before adding another');
              const source=await nativeSource(msg.id,false),sourceId=random(8);
              if(ws.readyState!==WebSocket.OPEN || !rooms.has(r.roomId))return;
              // Additional views never inherit system/app audio or desktop access.
              source.captureEnv={...source.captureEnv,NATIVE_AUDIO:'0',NATIVE_AUDIO_ONLY:'0'};
              r.extraCaptures.set(sourceId,{...source,captureTarget:source.target,native:null,desktopStates:new Map()});
              send(ws,{type:'native-result',requestId:msg.requestId,result:{sourceId,target:source.target}});return;
            }
            const state=msg.sourceId?r.extraCaptures.get(msg.sourceId):r;
            if(!state)throw new Error('This shared screen is no longer available');
            if(msg.type==='native-window-control'){
              if(!msg.sourceId || typeof msg.enabled!=='boolean' || state.target?.kind!=='window')throw new Error('Choose a native window for window-only control');
              stopDesktop(state);
              if(msg.enabled){
                const current=await nativeSource(state.target.id,false);
                if(!sameProcess(current.target,state.target))throw new Error('This window closed or changed. Choose it again.');
                const desktop=await createDesktop();state.desktop=desktop;
                try{
                  if(!desktop.setScope)throw new Error('This input backend cannot enforce window-only access');
                  await desktop.setScope(state.target);
                  if(!rooms.has(r.roomId) || ws.readyState!==WebSocket.OPEN || r.hostWs!==ws || r.extraCaptures.get(msg.sourceId)!==state)throw new Error('Shared window ended');
                  state.desktopMouse=true;state.desktopKeyboard=true;
                  const policy=()=>send(r.hostWs,{type:'view-input-policy',sourceId:msg.sourceId,policy:desktopPolicy(state)});
                  desktop.on?.('display',()=>{if(state.desktop!==desktop)return;state.desktopStates.clear();desktopState(state);policy();});
                  for(const event of ['scope-lost','failure'])desktop.on?.(event,()=>{if(state.desktop!==desktop)return;stopDesktop(state);policy();});
                }catch(error){stopDesktop(state);throw error;}
              }
              result={policy:desktopPolicy(state)};
            }
            else if(msg.type==='native-source-remove'){if(!msg.sourceId)throw new Error('Choose an additional screen');stopDesktop(state);state.native?.close();r.extraCaptures.delete(msg.sourceId);}
            else if (msg.type === 'native-stop') { state.native?.close(); state.native = null; if(!msg.sourceId)send(ws, { type: 'input-policy', allowKeyboard: r.allowKeyboard, ...desktopPolicy(r) }); }
            else if(msg.type==='native-audio') {
              if(msg.sourceId)throw new Error('Additional screens use video only');
              const state={target:r.captureTarget,captureEnv:r.captureEnv,native:r.native};
              result=await changeNativeAudio(state,msg.enabled);r.captureEnv=state.captureEnv;
            }
            else {
              if (msg.peerId !== 'preview' && !r.peers.has(msg.peerId)) throw new Error('Player is no longer in the session');
              if(msg.viewer && msg.peerId==='preview')throw new Error('Pop-out views need a connected guest');
              const mediaPeer=msg.viewer?`${msg.peerId}:view:${msg.sourceId || 'main'}`:msg.peerId;
              if (msg.type === 'native-offer') {
                const q = msg.quality;
                validateCaptureQuality(q);
                if(msg.sourceId && state.target?.kind==='window'){
                  const current=await nativeSource(state.target.id,false);
                  if(!sameProcess(current.target,state.target))throw new Error('This window closed or changed. Remove it and choose a new window.');
                }
                if (!state.native) { state.native = createNativeMedia(state.captureEnv || env); state.native.on('status', value => { send(r.hostWs, { ...value, type: 'native-status',...(msg.sourceId?{sourceId:msg.sourceId}:{}) }); }); }
                result = await state.native.offer(mediaPeer, q, msg.peerId === 'preview' ? { iceServers: [] } : await getIce(),{videoOnly:msg.viewer===true});
                if(msg.peerId!=='preview' && !r.peers.has(msg.peerId)){closeGuestMedia(state.native,msg.peerId);throw new Error('Player is no longer in the session');}
                if (msg.peerId === 'preview' && !msg.sourceId) send(ws, { type: 'input-policy', allowKeyboard: r.allowKeyboard, ...desktopPolicy(r) });
              } else if (msg.type === 'native-answer') {
                if (msg.sdp?.type !== 'answer' || typeof msg.sdp.sdp !== 'string' || msg.sdp.sdp.length > 98304) throw new Error('Invalid native video answer');
                await state.native?.answer(mediaPeer, msg.sdp);
              } else if(msg.type==='native-ready'){state.native?.ready?.(mediaPeer);}
              else if(msg.type==='native-ice'){validatePreviewIce(msg);await state.native?.ice('preview',msg.candidate);}
              else if (msg.type === 'native-close') await state.native?.closePeer(mediaPeer);
              else throw new Error('Unknown native capture command');
            }
            if (r.hostWs === ws && rooms.has(r.roomId)) send(ws, { type: 'native-result', requestId: msg.requestId, result });
            else state.native?.close();
          } catch (error) { send(ws, { type: 'native-result', requestId: msg.requestId, error: error.message }); }
          return;
        }
        if (fallback.forwardHost(r, msg)) return;
        if (msg.type === 'end') { closeRoom(r); return; }
        if (msg.type === 'register-peer') {
          if (maxPeers && r.peers.size >= maxPeers) throw new Error('Room full');
          const slot = r.dynamicControllers?null:pickSlot(r, msg.role);
          const peerId = random(8), role = slot || 'watch';
          r.peers.set(peerId, { ws: null, role, slot, wantsController:msg.role==='play' || r.slots.includes(msg.role), slots: slot ? [slot] : [], generation:0, manual: true });
          send(ws, { type: 'peer-registered', peerId, role, slot,wantsController:r.peers.get(peerId).wantsController, requestId: msg.requestId, fallback: fallback.invitation(r, peerId) });
          return;
        }
        const p = r.peers.get(msg.peerId); if (!p) return;
        if(msg.type==='peer-view'){releaseDesktop(r,msg.peerId);p.viewOnly=msg.additional===true;p.viewSourceId=typeof msg.sourceId==='string'?msg.sourceId:null;p.controlSourceId=undefined;p.desktopToken=undefined;return;}
        if(msg.type==='peer-control-view'){
          if(typeof msg.sourceId!=='string' || msg.sourceId && !r.extraCaptures?.has(msg.sourceId))return;
          if(typeof msg.token!=='string' || msg.token.length>80)return;releaseDesktop(r,msg.peerId);p.controlSourceId=msg.sourceId;p.desktopToken=msg.token;return;
        }
        if (msg.type === 'controller-count') {
          if (!p.slot && !p.wantsController || !Number.isSafeInteger(msg.count) || msg.count < (r.dynamicControllers?0:1) || !r.adaptiveControllers && msg.count > r.slots.length) return;
          // Bound each allocation batch, not the room's player count. Larger
          // groups continue enrollment after the next acknowledgement.
          const wanted=r.adaptiveControllers?Math.min(msg.count,ownedSlots(p).length+16):msg.count;
          const assigned = ownedSlots(p).slice(0,wanted);
          const used = new Set([...r.peers.values()].filter(other=>other!==p).flatMap(ownedSlots));
          let failed=false;
          const claim=async slot=>{try{await ensureDevice(r,slot);assigned.push(slot);return true;}catch(error){failed=true;send(r.hostWs,{type:'controller-error',peerId:msg.peerId,error:error.message});return false;}};
          for (const slot of r.slots) if(assigned.length<wanted && !used.has(slot) && !assigned.includes(slot) && !await claim(slot))break;
          while(r.adaptiveControllers && !failed && assigned.length<wanted){
            const slot=`p${r.slots.length+1}`;
            if(!await claim(slot))break;
            r.slots.push(slot);
          }
          updateSlots(r,msg.peerId,assigned); return;
        }
        if(msg.type==='controller-remove') {
          const lane=msg.slot ? ownedSlots(p).indexOf(msg.slot) : msg.controller;
          if(!Number.isInteger(lane) || lane<0 || !ownedSlots(p)[lane] || !msg.slot && msg.generation!==(p.generation || 0))return;
          updateSlots(r,msg.peerId,ownedSlots(p).filter((_,i)=>i!==lane),lane);return;
        }
        if (msg.type === 'kick') { resetPeer(r, p); removePeerDevices(r,p);releaseDesktop(r, msg.peerId); fallback.closePeer(p); closeGuestMedia(r.native,msg.peerId);for(const source of r.extraCaptures?.values() || [])closeGuestMedia(source.native,msg.peerId);r.audioCapture?.native?.closePeer(msg.peerId); r.peers.delete(msg.peerId); p.ws?.close(); send(ws, { type: 'peer-left', peerId: msg.peerId }); }
        if (msg.type === 'force-assign') {
          const slot = r.slots.includes(msg.slot) ? msg.slot : null;
          for (const [id, other] of r.peers) if (id !== msg.peerId && slot && ownedSlots(other).includes(slot)) updateSlots(r, id, ownedSlots(other).filter(s=>s!==slot));
          if(slot)await ensureDevice(r,slot);
          updateSlot(r, msg.peerId, slot);
        }
        if (['answer', 'ice', 'request-offer'].includes(msg.type)) send(p.ws, { type: msg.type, sdp: msg.sdp, candidate: msg.candidate, negotiationId: msg.negotiationId });
      }).catch(error => send(ws, { type: 'error', error: error.message }));
    });
    ws.on('close', () => {
      ws.preview?.native?.close();ws.preview=null;ws.audioCapture?.native?.close();ws.audioCapture=null;
      const r = rooms.get(ws.roomId); if (!r) return;
      if (ws.role === 'host' && r.hostWs === ws) {
        appInputBridge.end(r);
        for(const context of desktopContexts(r)){stopDesktop(context);if(context!==r){context.native?.close();context.native=null;}}
        r.desktopFullAccess=false;r.captureTarget=null;
        r.overlay?.close(); r.overlay = null;
        r.native?.close(); r.native = null;r.audioCapture?.native?.close();r.audioCapture=null;
        resetAll(r); r.injectWs?.close(); r.injectWs = null;
        r.timer = setTimeout(() => closeRoom(r), ttl);
        for (const p of r.peers.values()) send(p.ws, { type: 'host-left' });
      }
      if (ws.role === 'peer') {
        const p = r.peers.get(ws.peerId);
        if (p) { resetPeer(r, p);removePeerDevices(r,p); releaseDesktop(r, ws.peerId); closeGuestMedia(r.native,ws.peerId);for(const source of r.extraCaptures?.values() || [])closeGuestMedia(source.native,ws.peerId);r.audioCapture?.native?.closePeer(ws.peerId); r.peers.delete(ws.peerId); send(r.hostWs, { type: 'peer-left', peerId: ws.peerId }); }
      }
    });
    ws.on('error', () => ws.terminate());
  });
  inputs.on('connection', ws => {
    let r = null;
    ws.alive = true; ws.on('pong', () => { ws.alive = true; });
    const authTimer = setTimeout(() => ws.close(), 5000);
    ws.on('message', raw => {
      try {
        const msg = JSON.parse(raw);
        if (!msg || typeof msg !== 'object') return;
        if (!r) {
          r = rooms.get(msg.roomId);
          if (msg.type !== 'auth' || !r || msg.token !== r.injectToken || r.hostWs?.readyState !== WebSocket.OPEN) { r = null; ws.close(); return; }
          clearTimeout(authTimer); const old = r.injectWs; r.injectWs = ws; resetAll(r); old?.close();
          send(ws, { type: 'driver-status', ...status(r) }); return;
        }
        if (r.injectWs !== ws) return;
        const p = r.peers.get(msg.peerId);
        if (!p || !p.slot && !(r.dynamicControllers && p.wantsController)) return;
        if (msg.type === 'desktop-release') { if (Number.isSafeInteger(msg.seq)) p.desktopSeq = Math.max(p.desktopSeq || -1, msg.seq); releaseDesktop(r, msg.peerId); return; }
        const sourceId=p.controlSourceId ?? (p.viewOnly?p.viewSourceId:'');
        const context=sourceId?r.extraCaptures?.get(sourceId):sourceId===''?r:null;
        if(msg.type.startsWith('desktop-') && (!context || (msg.sourceId ?? '')!==sourceId || msg.desktopToken!==p.desktopToken))return;
        if(msg.type==='desktop-relative'){
          if(!context.desktopMouse || !context.desktop?.relativeMouse || context.captureTarget?.kind==='window' && platform!=='win32' || !Number.isSafeInteger(msg.seq) || msg.seq<=(p.desktopMoveSeq ?? -1) || ![msg.dx,msg.dy].every(v=>typeof v==='number' && Number.isFinite(v) && Math.abs(v)<=500))return;
          p.desktopMoveSeq=msg.seq;try{context.desktop.event({event:'relative',dx:msg.dx,dy:msg.dy});}catch{stopDesktop(context);send(r.hostWs,{type:'input-policy',allowKeyboard:r.allowKeyboard,...desktopPolicy(r)});}return;
        }
        if (msg.type === 'desktop-move') {
          if (!context.desktop || !context.desktopMouse || !Number.isSafeInteger(msg.seq) || msg.seq <= (p.desktopMoveSeq ?? -1) || ![msg.x,msg.y].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1)) return;
          if (Date.now() - (p.desktopMoveAt || 0) < 10) return;
          p.desktopMoveAt = Date.now(); p.desktopMoveSeq = msg.seq;
          try { context.desktop.event({ event: 'move', x: msg.x, y: msg.y }); } catch (error) { stopDesktop(context); send(r.hostWs, sourceId?{type:'view-input-policy',sourceId,policy:desktopPolicy(context)}:{type:'input-policy',allowKeyboard:r.allowKeyboard,...desktopPolicy(r)}); send(r.hostWs, { type: 'error', error: `Desktop input: ${error.message}` }); }
          return;
        }
        if (msg.type === 'desktop-state') {
          if (!context.desktop) return;
          const state = desktopSnapshot(msg.state), previous = context.desktopStates.get(msg.peerId);
          if (!state || state.seq <= (p.desktopSeq ?? -1)) return;
          const now = Date.now(); if (previous && now - previous.at < 10 && JSON.stringify(previous.keys) === JSON.stringify(state.keys) && JSON.stringify(previous.buttons) === JSON.stringify(state.buttons)) return;
          if (state.x !== undefined) { if (state.moveSeq !== undefined && state.moveSeq <= (p.desktopMoveSeq ?? -1)) { delete state.x; delete state.y; } else if (state.moveSeq !== undefined) p.desktopMoveSeq = state.moveSeq; }
          if (!context.desktopKeyboard) state.keys = []; if (!context.desktopMouse) { state.buttons = []; delete state.x; delete state.y; }
          p.desktopSeq = state.seq; context.desktopStates.set(msg.peerId, { ...state, at: now });
          try { desktopState(context, state); } catch (error) { stopDesktop(context); send(r.hostWs, { type: 'error', error: `Desktop input: ${error.message}` }); send(r.hostWs, sourceId?{type:'view-input-policy',sourceId,policy:desktopPolicy(context)}:{type:'input-policy',allowKeyboard:r.allowKeyboard,...desktopPolicy(r)}); }
          return;
        }
        if (msg.type === 'desktop-event') {
          if (!context.desktop || Date.now() - (p.desktopEventAt || 0) < 10) return;
          p.desktopEventAt = Date.now();
          const event = msg.event;
          try {
            if (event?.event === 'wheel' && context.desktopMouse && [event.dx,event.dy].every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1200)) context.desktop.event(event);
            if (event?.event === 'repeat' && context.desktopKeyboard && desktopCodes.has(event.code) && context.desktopStates.get(msg.peerId)?.keys.includes(event.code)) context.desktop.event(event);
          } catch (error) { stopDesktop(context); send(r.hostWs, sourceId?{type:'view-input-policy',sourceId,policy:desktopPolicy(context)}:{type:'input-policy',allowKeyboard:r.allowKeyboard,...desktopPolicy(r)}); send(r.hostWs, { type: 'error', error: `Desktop input: ${error.message}` }); }
          return;
        }
        if (msg.type === 'release') { resetPeer(r, p); return; }
        if (msg.type !== 'state') return;
        const lane=msg.controller ?? 0, slot=ownedSlots(p)[lane];
        if (!Number.isInteger(lane) || lane < 0 || !slot || (msg.generation ?? 0) !== (p.generation || 0)) return;
        if (!['keyboard', 'gamepad'].includes(msg.source) || msg.source === 'keyboard' && !r.allowKeyboard) return;
        let state;
        try { state = states.normalizeState(msg.state); } catch { return; }
        r.injector?.setState(slot, state);
        r.active.set(slot, Date.now()); r.inputSources.set(slot, msg.source);
        p.receipts ||= [];
        if (r.injector && env.INPUT_BACKEND!=='none' && Date.now() - (p.receipts[lane] || 0) > 800) {
          p.receipts[lane]=Date.now(); send(ws,{type:'input-receipt',peerId:msg.peerId,controller:lane,slot,generation:p.generation || 0});
        }
      } catch (error) { if (r && error.name !== 'SyntaxError') driverError(r, error); }
    });
    ws.on('close', () => { clearTimeout(authTimer); if (r?.injectWs === ws) { r.injectWs = null; resetAll(r); for(const context of desktopContexts(r))for(const id of context.desktopStates?.keys() || [])releaseDesktop(r,id); } });
    ws.on('error', () => ws.terminate());
  });
  const watchdog = setInterval(() => {
    for (const r of rooms.values()) for (const [slot, updated] of r.active) if (Date.now() - updated > staleMs) reset(r, slot);
    for(const r of rooms.values())for(const context of desktopContexts(r))for(const [id,state] of context.desktopStates || [])if(Date.now()-state.at>staleMs)releaseDesktopContext(context,id,r);
  }, Math.min(staleMs, 100));
  const ping = setInterval(() => {
    for (const wss of [signal, inputs, fallback.wss]) for (const ws of wss.clients) {
      if (!ws.alive) ws.terminate(); else { ws.alive = false; ws.ping(); }
    }
  }, 10000);
  return { server, rooms, sessions, async close() {
    appInputBridge.close();
    controllerReceiver.close();for(const ws of receiverSockets.clients)ws.terminate();receiverSockets.close();
    sessions?.close();
    guestInput.close();for(const ws of guestInputs.clients)ws.terminate();guestInputs.close();
    clearInterval(watchdog); clearInterval(ping);
    for (const r of rooms.values()) closeRoom(r);
    for (const wss of [signal, inputs, fallback.wss]) { for (const ws of wss.clients) ws.terminate(); wss.close(); }
    await new Promise(resolve => server.close(resolve));
  } };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const app = createApp();
  const port = Number(process.env.PORT || 8787);
  app.server.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`[webrtc-pad] Open ${process.env.TLS_CERT ? 'https' : 'http'}://localhost:${port} on this computer`));
  app.server.on('error', error => { console.error(error.message); app.close(); process.exitCode = 1; });
  for (const event of ['SIGINT', 'SIGTERM']) process.once(event, () => app.close());
}
