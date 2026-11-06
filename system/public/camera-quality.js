const positive=(v,fallback)=>Number.isFinite(v)&&v>0?v:fallback;
export function cameraSettings(height=480,fps=24){
  height=Number(height);fps=Number(fps);
  return {height:[240,360,480,720,1080].includes(height)?height:480,fps:[10,15,24,30].includes(fps)?fps:24};
}
export function cameraLimit(value){
  return {height:[240,360,480,720,1080].includes(value?.height)?value.height:1080,fps:[10,15,24,30].includes(value?.fps)?value.fps:30,...(value?.automatic===false?{automatic:false}:{})};
}
export function boundedCamera(settings,...limits){
  return limits.reduce((s,value)=>{const limit=cameraLimit(value);return {height:Math.min(s.height,limit.height),fps:Math.min(s.fps,limit.fps),...(s.automatic===false || limit.automatic===false?{automatic:false}:{})};},settings);
}
// Bitrate can yield promptly. Pixel dimensions need sustained pressure and a
// dwell period so joins and brief channel/source handovers do not rescale video.
export function stableDimensions(previous={},level=0,busy=false,sample=true,now=Date.now()) {
  const state={spatialLevel:previous.spatialLevel || 0,spatialBad:previous.spatialBad || 0,spatialGood:previous.spatialGood || 0,spatialStartedAt:previous.spatialStartedAt ?? now,spatialChangedAt:previous.spatialChangedAt ?? null};
  if(!sample)return state;
  state.spatialBad=busy?state.spatialBad+1:0;
  state.spatialGood=busy?0:state.spatialGood+1;
  const elapsed=now-(state.spatialChangedAt ?? state.spatialStartedAt);
  if(level>state.spatialLevel && state.spatialBad>=3 && elapsed>=(state.spatialChangedAt===null?6000:15000)){
    state.spatialLevel++;state.spatialChangedAt=now;state.spatialBad=state.spatialGood=0;
  }else if(level<state.spatialLevel && state.spatialGood>=15 && elapsed>=30000){
    state.spatialLevel--;state.spatialChangedAt=now;state.spatialBad=state.spatialGood=0;
  }
  return state;
}
// Cameras share a bounded upload allowance, then yield further to game loss,
// buffering and delay. Recovery is deliberately slower than backing off.
export function cameraBudget(previous={},metrics={},settings=cameraSettings(),peers=1,sample=true,now=Date.now()){
  previous ||= {};
  if(settings.automatic===false)return {level:0,healthy:0,baseline:Infinity,bitrate:settings.height>=1080?1800000:settings.height>=720?1000000:settings.height>=480?600000:settings.height>=360?350000:150000,height:settings.height,fps:settings.fps};
  let level=previous.level || 0,healthy=previous.healthy || 0;
  const rtt=positive(metrics.rttMs,0),baseline=Math.min(previous.baseline || Infinity,rtt || Infinity);
  const busy=metrics.loss>.025 || metrics.bufferMs>45 || metrics.freezeMs>100 || metrics.decodeMs>30 || rtt>350 || rtt>baseline+55;
  if(sample && busy){level=Math.min(3,level+1);healthy=0;}
  else if(sample && ++healthy>=6){level=Math.max(0,level-1);healthy=0;}
  const ceiling=Math.min(settings.height>=1080?1800000:settings.height>=720?1000000:settings.height>=480?600000:settings.height>=360?350000:150000,1200000/Math.max(1,peers));
  const spatial=stableDimensions(previous,level,busy,sample,now);
  return {...spatial,level,healthy,baseline,bitrate:Math.max(Math.min(12000,ceiling),Math.round(ceiling/[1,2,5,10][level])),fps:Math.min(settings.fps,[30,15,10,5][level]),height:Math.min(settings.height,[1080,360,240,120][spatial.spatialLevel])};
}
