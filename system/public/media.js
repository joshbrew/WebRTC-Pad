const resolutions = { '360': [640, 360], '480': [854, 480], '720': [1280, 720], '1080': [1920, 1080], '1440': [2560, 1440], '2160': [3840, 2160] };
export function streamSettings(resolution = '1080', frameRate = 60, priority = 'motion') {
  resolution = resolution === 'native' || resolutions[resolution] ? resolution : '1080';
  frameRate = [15, 30, 60, 120].includes(Number(frameRate)) ? Number(frameRate) : 60;
  const [width, height] = resolutions[resolution] || [];
  const baseMbps = { '360': 1.2, '480': 2.2, '720': 5, '1080': 8, '1440': 14, '2160': 26, native: 18 }[resolution];
  const maxBitrate = Math.round(baseMbps * (frameRate > 60 ? 1.5 : frameRate <= 30 ? .65 : 1) * 1000000);
  priority = ['motion', 'resolution', 'balanced'].includes(priority) ? priority : 'motion';
  return { resolution, width, height, frameRate, maxBitrate, priority };
}
export function captureConstraints(settings) {
  return {
    ...(settings.width ? { width: { ideal: settings.width, max: settings.width }, height: { ideal: settings.height, max: settings.height } } : {}),
    frameRate: { ideal: settings.frameRate, max: settings.frameRate }
  };
}
export async function applyCaptureSettings(track, settings) {
  try { await track.applyConstraints(captureConstraints(settings)); }
  catch(error){
    if(!['OverconstrainedError','NotSupportedError'].includes(error.name))throw error;
    // Some Firefox/fixed-size sources cannot honor capture caps. Keep their
    // actual track alive; RTP sender scaling/frame limits still bound output.
    const ideal={...(settings.width?{width:{ideal:settings.width},height:{ideal:settings.height}}:{}),frameRate:{ideal:settings.frameRate}};
    try { await track.applyConstraints(ideal); }
    catch(fallback){if(!['OverconstrainedError','NotSupportedError'].includes(fallback.name))throw fallback;}
  }
  track.contentHint = settings.priority === 'resolution' ? 'detail' : 'motion';
  return track.getSettings();
}
export function qualityLabel(settings) { return `${settings.resolution === 'native' ? 'Source size' : settings.resolution + 'p'} · ${settings.frameRate} fps`; }
