export function receivedVideoStats(stats, previous, video) {
  const stream = [...stats.values()].find(s => s.type === 'inbound-rtp' && s.kind === 'video' && !s.isRemote);
  if (!stream) return null;
  const seconds = previous?.id === stream.id ? (stream.timestamp - previous.timestamp) / 1000 : 0;
  const frameDelta = (stream.framesDecoded || 0) - (previous?.frames || 0);
  const byteDelta = (stream.bytesReceived || 0) - (previous?.bytes || 0);
  const same = previous?.id === stream.id;
  const delta = (field, prior) => same && typeof stream[field] === 'number' ? Math.max(0, stream[field] - (previous[prior] || 0)) : null;
  const received = delta('packetsReceived', 'packets'), lost = delta('packetsLost', 'lost');
  const decode = delta('totalDecodeTime', 'decode');
  const buffer = delta('jitterBufferDelay', 'buffer'), emitted = delta('jitterBufferEmittedCount', 'emitted');
  const freeze = delta('totalFreezesDuration', 'freeze');
  const transport = [...stats.values()].find(s => s.type === 'transport' && s.selectedCandidatePairId);
  const pair = stats.get(transport?.selectedCandidatePairId);
  const codec=stats.get(stream.codecId)?.mimeType?.replace(/^video\//i,'');
  return {
    width: stream.frameWidth || video.videoWidth || 0,
    codec:codec==='H265'?'H.265':codec==='H264'?'H.264':codec || null,
    decoder:typeof stream.decoderImplementation==='string'?stream.decoderImplementation.slice(0,120):null,
    powerEfficient:typeof stream.powerEfficientDecoder==='boolean'?stream.powerEfficientDecoder:null,
    height: stream.frameHeight || video.videoHeight || 0,
    fps: Math.round(stream.framesPerSecond ?? (seconds > 0 ? Math.max(0, frameDelta) / seconds : 0)),
    mbps: seconds > 0 ? Math.max(0, byteDelta) * 8 / seconds / 1000000 : null,
    rttMs: typeof pair?.currentRoundTripTime === 'number' ? pair.currentRoundTripTime * 1000 : null,
    loss: received !== null && lost !== null && received + lost > 0 ? lost / (received + lost) : null,
    jitterMs: typeof stream.jitter === 'number' ? stream.jitter * 1000 : null,
    decodeMs: decode !== null && frameDelta > 0 ? decode * 1000 / frameDelta : null,
    bufferMs: buffer !== null && emitted > 0 ? buffer * 1000 / emitted : null,
    freezeMs: freeze !== null ? freeze * 1000 : null,
    dropped: stream.framesDropped ?? null,
    sample: { id: stream.id, timestamp: stream.timestamp, frames: stream.framesDecoded || 0, bytes: stream.bytesReceived || 0, packets: stream.packetsReceived, lost: stream.packetsLost, decode: stream.totalDecodeTime, buffer: stream.jitterBufferDelay, emitted: stream.jitterBufferEmittedCount, freeze: stream.totalFreezesDuration }
  };
}
export function videoStatsLabel(value, detail = false) {
  if (!value?.width) return 'Waiting for video';
  return `${value.width} × ${value.height} · ${value.fps} fps${detail && value.codec?' · '+value.codec:''}${detail && value.mbps !== null ? ` · ${value.mbps.toFixed(1)} Mbps` : ''}`;
}
