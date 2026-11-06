// A browser may support either the standard millisecond target or Chromium's
// older seconds hint. Each is optional and must never interrupt track setup.
export function preferLowLatency(receiver) {
  if(!receiver)return;
  for(const property of ['jitterBufferTarget','playoutDelayHint']) {
    try {if(property in receiver)receiver[property]=0;}catch{/* Keep streaming if the browser rejects a hint. */}
  }
}
export const inputChannelOptions={ordered:false,maxRetransmits:0,priority:'high'};
export async function prioritizeAudio(sender){
  if(!sender?.track)return;
  try{const params=sender.getParameters();if(!params.encodings?.length)return;for(const encoding of params.encodings){encoding.maxBitrate=192000;encoding.priority='very-low';encoding.networkPriority='very-low';}await sender.setParameters(params);}catch{/* Optional browser priority hints. */}
}
export async function addCandidate(peer, candidate) {
  if (!candidate) return;
  if (!peer.pc.remoteDescription) peer.candidates.push(candidate);
  else await peer.pc.addIceCandidate(candidate);
}
export async function setRemote(peer, sdp) {
  await peer.pc.setRemoteDescription(sdp);
  for (const candidate of peer.candidates.splice(0)) await peer.pc.addIceCandidate(candidate);
}
export function acceptInput(peer, message) {
  const lane = message?.controller ?? 0;
  const slots = peer.slots || (peer.slot ? [peer.slot] : []);
  if (!peer.slot || !Number.isInteger(lane) || lane < 0 || !slots[lane] || !message?.state || !Number.isSafeInteger(message.seq) || message.seq < 0 || (message.generation ?? 0) !== (peer.generation ?? 0)) return false;
  peer.lastSeqs ||= [];
  if (message.seq <= (peer.lastSeqs[lane] ?? (lane === 0 ? peer.lastSeq : -1) ?? -1)) return false;
  peer.lastSeqs[lane] = message.seq;
  if (lane === 0) peer.lastSeq = message.seq;
  return true;
}
export async function applySenderQuality(peer) {
  await prioritizeAudio(peer.senders.audio);
  const sender = peer.senders.video;
  if (!sender?.track) return;
  const params = sender.getParameters();
  if (!params.encodings?.length) return; // Tuning becomes available after negotiation.
  const source = sender.track.getSettings?.() || {};
  const scale = peer.quality?.width && source.width && source.height ? Math.max(1, source.width / peer.quality.width, source.height / peer.quality.height) : 1;
  for (const encoding of params.encodings) {
    encoding.maxBitrate = peer.quality?.maxBitrate || 8000000;
    encoding.maxFramerate = peer.quality?.frameRate || 60;
    encoding.scaleResolutionDownBy = scale;
    encoding.priority='high';encoding.networkPriority='high';
  }
  // Spatial adaptation belongs to our floor/cooldown policy. Let the browser
  // reduce bitrate/frame rate under pressure, rather than resize underneath it.
  params.degradationPreference = peer.quality?.minHeight || peer.quality?.autoThrottle === false || peer.quality?.priority === 'resolution' ? 'maintain-resolution' : peer.quality?.priority === 'balanced' ? 'balanced' : 'maintain-framerate';
  try { await sender.setParameters(params); } catch {
    // Unsupported priority/degradation hints must not discard the actual
    // bitrate, frame-rate and scale limits on another browser/platform.
    delete params.degradationPreference;
    for(const encoding of params.encodings){delete encoding.priority;delete encoding.networkPriority;}
    try{await sender.setParameters(params);}catch{/* Capture constraints remain the final fallback. */}
  }
}
export async function replaceCapture(peer, stream) {
  for (const kind of ['video', 'audio']) {
    const sender = peer.senders[kind];
    if (!sender) continue; // The viewer's offer has not arrived yet.
    const track = stream?.getTracks().find(t => t.kind === kind && t.readyState !== 'ended') || null;
    if(stream){if(kind==='audio')sender.setStreams();else sender.setStreams(stream);}
    await sender.replaceTrack(track);
    if (track?.kind === 'video') {
      track.contentHint = peer.quality?.priority === 'resolution' ? 'detail' : 'motion';
      await applySenderQuality(peer);
    }
    if(track?.kind==='audio')await prioritizeAudio(sender);
  }
}
