import { streamSettings } from './media.js';
import {selectedCodec} from './codecs.js';
const heights = [360, 480, 720, 1080, 1440, 2160];
const resolutionValues = heights.map(String);
export function secondaryResolution(value) {
  return resolutionValues.includes(value) ? value : 'main';
}
export function screenQuality(host, sourceId, override) {
  if (override) {
    const profile = streamSettings(override.resolution, override.frameRate, override.priority);
    return {...host, ...profile, autoThrottle:override.autoThrottle, minHeight:Math.min(override.minHeight,profile.height ?? Infinity)};
  }
  const resolution = secondaryResolution(host.secondaryResolution);
  if (!sourceId || resolution === 'main' || Number(resolution) >= (host.height || Infinity)) return host;
  const cap = streamSettings(resolution, host.frameRate, host.priority);
  return { ...host, ...cap, maxBitrate: Math.min(host.maxBitrate, cap.maxBitrate) };
}
export function clientQuality(value = {}) {
  const resolution = resolutionValues.includes(String(value.resolution)) ? String(value.resolution) : 'host';
  const frameRate = [0, 15, 30, 60, 120].includes(Number(value.frameRate)) ? Number(value.frameRate) : 0;
  const minHeight=[0,...heights].includes(Number(value.minHeight))?Number(value.minHeight):0;
  return { resolution, frameRate, minHeight, automatic: value.automatic !== false,codec:['h264','h265'].includes(value.codec)?value.codec:'auto',codecs:['h264',...(Array.isArray(value.codecs) && value.codecs.includes('h265')?['h265']:[])] };
}
export function qualityFloor(host,request={},source={}) {
  request=clientQuality(request);
  const ceiling=Math.min(host.height || source.height || 2160,source.height || Infinity,request.resolution==='host'?Infinity:Number(request.resolution));
  return Math.min(ceiling,Math.max(heights.includes(Number(host.minHeight))?Number(host.minHeight):480,request.minHeight));
}
export function effectiveQuality(host, request = {}, source = {}, adaptation = {}) {
  request = clientQuality(request);
  const hostHeight = Math.min(host.height || source.height || 2160, source.height || Infinity);
  const minHeight=qualityFloor(host,request,source);
  const automatic=host.autoThrottle!==false && request.automatic;
  const tuning=automatic && (!adaptation.priority || adaptation.priority===host.priority)?adaptation:{};
  const adaptiveHeight=tuning.height;
  const height = Math.min(hostHeight, request.resolution === 'host' ? Infinity : Number(request.resolution), adaptiveHeight ? Math.max(minHeight,adaptiveHeight):Infinity);
  const hostWidth = Math.min(host.width || source.width || Math.round(hostHeight * 16 / 9), source.width || Infinity);
  const width = Math.max(2,Math.floor(Math.min(hostWidth, height * (source.width && source.height ? source.width / source.height : 16 / 9)) / 2) * 2);
  const frameRate = Math.min(host.frameRate, request.frameRate || Infinity, source.frameRate || Infinity, tuning.frameRate || Infinity);
  const profile = streamSettings(String(heights.find(h => h >= height) || 2160), frameRate, host.priority);
  const original = host.resolution === 'native' && request.resolution === 'host' && (!automatic || !adaptiveHeight);
  return { ...host,minHeight,codec:selectedCodec(host,request), resolution: original ? 'native' : String(height), width: original ? undefined : width, height: original ? undefined : Math.max(2,Math.floor(height / 2) * 2), frameRate, maxBitrate: Math.min(host.maxBitrate, profile.maxBitrate), autoThrottle: automatic };
}
// Only encoder-affecting settings belong in a native transport's identity.
// UI policy changes must not replace an otherwise identical live encoder.
export function nativeEncodingKey(source,quality={}) {
  return JSON.stringify([source,quality.width || null,quality.height || null,quality.frameRate,quality.maxBitrate,quality.codec==='h265'?'h265':'h264',quality.encoderPreset || 'default']);
}
export function adaptQuality(state = {}, metrics = {}, ceiling, now = Date.now(),minimum=480,{priority='motion',frameRate=60}={}) {
  const next = { ...state };
  if(next.priority!==priority){
    if(next.priority){delete next.height;delete next.frameRate;delete next.changedAt;}
    next.priority=priority;next.bad=next.good=next.delayed=0;
  }
  const floor=Math.min(ceiling,minimum);
  const available = [...new Set([floor,...heights.filter(height => height>=floor && height < ceiling),ceiling])];
  const current = Math.min(ceiling,Math.max(floor,next.height || ceiling));
  const currentRate=Math.min(next.frameRate || frameRate,frameRate);
  const rates=(priority==='resolution'?[15,30,60]:[30,60]).filter(rate=>rate<frameRate).concat(frameRate);
  // Distance alone does not mean the video bitrate is too high. A healthy
  // long-distance route must not keep ratcheting the picture down to 360p.
  const poor = metrics.loss > .04 || metrics.bufferMs > 180 || metrics.freezeMs > 300 || metrics.rttMs > 220 && metrics.bufferMs > 80;
  const delayed=priority==='balanced' && (metrics.bufferMs>100 || metrics.decodeMs>=Math.max(6,800/currentRate));
  next.delayed=delayed?(next.delayed || 0)+1:0;
  next.bad = poor || delayed ? (next.bad || 0) + 1 : 0;
  const healthy=!poor && !delayed && !(metrics.loss>.01 || metrics.bufferMs>50 || metrics.freezeMs>0);
  next.good = healthy ? (next.good || 0) + 1 : 0;
  if (next.changedAt && now - next.changedAt < 20000) return next;
  if (next.bad >= 2) {
    const lowerHeight=available.findLast(height=>height<current),lowerRate=rates.findLast(rate=>rate<currentRate);
    // A slower cadence adds frame wait. Reduce pixel work first in latency
    // mode, then trade cadence for headroom if the delay persists.
    const lowerCadence=priority==='resolution' || priority==='balanced' && (!lowerHeight || next.delayed>=2 && (current<ceiling || currentRate>60));
    if(lowerRate && lowerCadence)next.frameRate=lowerRate;
    else if(lowerHeight)next.height=lowerHeight;
    else return next;
  } else if(next.good>=30 && (current<ceiling || currentRate<frameRate)){
    if(currentRate<frameRate && (priority!=='resolution' || current>=ceiling)){
      const higher=rates.find(rate=>rate>currentRate);
      if(higher>=frameRate)delete next.frameRate;else next.frameRate=higher;
    }else{
      const higher=available.find(height=>height>current);
      if(higher>=ceiling)delete next.height;else next.height=higher;
    }
  }else return next;
  next.changedAt=now;next.bad=next.good=next.delayed=0;
  return next;
}

export function adaptationMetrics(metrics) {
  return Object.fromEntries(['loss','rttMs','bufferMs','freezeMs','decodeMs'].map(key=>{
    const value=metrics?.[key];
    return [key,Number.isFinite(value)?Math.max(0,Math.min(key==='loss'?1:5000,value)):0];
  }));
}
