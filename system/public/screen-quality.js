import {stableDimensions} from './camera-quality.js';
const heights=[360,480,720,1080,1440,2160],rates=[15,30,60,120];
export function screenLimit(value){return {height:heights.includes(value?.height)?value.height:2160,fps:rates.includes(value?.fps)?value.fps:120,bitrate:Number.isFinite(value?.bitrate)?Math.max(1000000,Math.min(40000000,value.bitrate)):40000000};}
export function screenSettings(value={}){return {height:heights.includes(Number(value.height))?Number(value.height):1080,fps:rates.includes(Number(value.fps))?Number(value.fps):60,bitrate:Number.isFinite(Number(value.bitrate))?Math.max(1000000,Math.min(40000000,Number(value.bitrate))):8000000,automatic:value.automatic!==false,priority:value.priority==='detail'?'detail':'motion'};}
export function boundedScreen(settings,...limits){return limits.reduce((s,v)=>{const limit=screenLimit(v);return {...s,height:Math.min(s.height,limit.height),fps:Math.min(s.fps,limit.fps),bitrate:Math.min(s.bitrate,limit.bitrate)};},settings);}
export function screenBudget(previous={},metrics={},settings=screenSettings(),recipients=1,sample=true,now=Date.now()){
  previous ||= {};let level=settings.automatic?previous.level || 0:0,healthy=previous.healthy || 0;
  const rtt=Number.isFinite(metrics.rttMs)?Math.max(0,metrics.rttMs):0,baseline=Math.min(previous.baseline || Infinity,rtt || Infinity);
  const busy=metrics.loss>.025 || metrics.bufferMs>45 || metrics.freezeMs>100 || metrics.decodeMs>30 || rtt>350 || rtt>baseline+55;
  if(settings.automatic && sample){if(busy){level=Math.min(3,level+1);healthy=0;}else if(++healthy>=6){level=Math.max(0,level-1);healthy=0;}}
  const share=settings.bitrate/Math.max(1,recipients),ceiling=settings.height<=480?2200000:settings.height<=720?5000000:settings.height<=1080?8000000:settings.height<=1440?14000000:26000000;
  const spatial=settings.automatic?stableDimensions(previous,level,busy,sample,now):{spatialLevel:0};
  return {...spatial,level,healthy,baseline,height:Math.min(settings.height,[2160,720,480,360][spatial.spatialLevel]),fps:Math.min(settings.fps,[120,60,30,15][level]),bitrate:Math.floor(Math.min(share,ceiling)*[1,.65,.35,.18][level])};
}
