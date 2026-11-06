import { streamSettings } from './media.js';
import {selectedCodec} from './codecs.js';
const heights = [360, 480, 720, 1080, 1440, 2160];
export function clientQuality(value = {}) {
  const resolution = ['host', ...heights.map(String)].includes(String(value.resolution)) ? String(value.resolution) : 'host';
  const frameRate = [0, 15, 30, 60, 120].includes(Number(value.frameRate)) ? Number(value.frameRate) : 0;
  const minHeight=[0,...heights].includes(Number(value.minHeight))?Number(value.minHeight):0;
  return { resolution, frameRate, minHeight, automatic: value.automatic !== false,codec:['h264','h265'].includes(value.codec)?value.codec:'auto',codecs:['h264',...(Array.isArray(value.codecs) && value.codecs.includes('h265')?['h265']:[])] };
}
export function qualityFloor(host,request={},source={}) {
  request=clientQuality(request);
  const ceiling=Math.min(host.height || source.height || 2160,source.height || Infinity,request.resolution==='host'?Infinity:Number(request.resolution));
  return Math.min(ceiling,Math.max(heights.includes(Number(host.minHeight))?Number(host.minHeight):480,request.minHeight));
}
export function effectiveQuality(host, request = {}, source = {}, adaptiveHeight) {
  request = clientQuality(request);
  const hostHeight = Math.min(host.height || source.height || 2160, source.height || Infinity);
  const minHeight=qualityFloor(host,request,source);
  const automatic=host.autoThrottle!==false && request.automatic;
  const height = Math.min(hostHeight, request.resolution === 'host' ? Infinity : Number(request.resolution), automatic && adaptiveHeight ? Math.max(minHeight,adaptiveHeight):Infinity);
  const hostWidth = Math.min(host.width || source.width || Math.round(hostHeight * 16 / 9), source.width || Infinity);
  const width = Math.max(2,Math.floor(Math.min(hostWidth, height * (source.width && source.height ? source.width / source.height : 16 / 9)) / 2) * 2);
  const frameRate = Math.min(host.frameRate, request.frameRate || Infinity, source.frameRate || Infinity);
  const profile = streamSettings(String(heights.find(h => h >= height) || 2160), frameRate, host.priority);
  const original = host.resolution === 'native' && request.resolution === 'host' && (!automatic || !adaptiveHeight);
  return { ...host,minHeight,codec:selectedCodec(host,request), resolution: original ? 'native' : String(height), width: original ? undefined : width, height: original ? undefined : Math.max(2,Math.floor(height / 2) * 2), frameRate, maxBitrate: Math.min(host.maxBitrate, profile.maxBitrate), autoThrottle: automatic };
}
// Only encoder-affecting settings belong in a native transport's identity.
// UI policy changes must not replace an otherwise identical live encoder.
export function nativeEncodingKey(source,quality={}) {
  return JSON.stringify([source,quality.width || null,quality.height || null,quality.frameRate,quality.maxBitrate,quality.codec==='h265'?'h265':'h264',quality.encoderPreset || 'default']);
}
export function adaptQuality(state = {}, metrics = {}, ceiling, now = Date.now(),minimum=480) {
  const next = { ...state };
  const floor=Math.min(ceiling,minimum);
  const available = [...new Set([floor,...heights.filter(height => height>=floor && height <= ceiling)])];
  if (!available.length) return next;
  const current = Math.min(next.height || ceiling, ceiling);
  // Distance alone does not mean the video bitrate is too high. A healthy
  // long-distance route must not keep ratcheting the picture down to 360p.
  const poor = metrics.loss > .04 || metrics.bufferMs > 180 || metrics.freezeMs > 300 || metrics.rttMs > 220 && metrics.bufferMs > 80;
  next.bad = poor ? (next.bad || 0) + 1 : 0;
  const healthy=!poor && !(metrics.loss>.01 || metrics.bufferMs>50 || metrics.freezeMs>0);
  next.good = healthy ? (next.good || 0) + 1 : 0;
  if (next.changedAt && now - next.changedAt < 20000) return next;
  if (next.bad >= 2) {
    const lower = available.filter(h => h < current).at(-1);
    if (lower) { next.height = lower; next.changedAt = now; next.bad = next.good = 0; }
  } else if (next.good >= 30 && current < ceiling) {
    next.height = available.find(h => h > current) || ceiling; next.changedAt = now; next.good = 0;
    if (next.height >= ceiling) delete next.height;
  }
  return next;
}
