// Full-band Opus with a generous receive ceiling; live sender limits adapt
// without renegotiating or touching the game's input/media connections.
export function voiceDescription(description, ceiling=192000,stereo=false){
  if(!description?.sdp)return description;
  const lines=description.sdp.split('\r\n'),payloads=[];
  for(const line of lines){const match=/^a=rtpmap:(\d+) opus\/48000/i.exec(line);if(match)payloads.push(match[1]);}
  for(const payload of payloads){
    const prefix=`a=fmtp:${payload} `,index=lines.findIndex(line=>line.startsWith(prefix)),values=new Map();
    if(index>=0)for(const item of lines[index].slice(prefix.length).split(';')){const [key,...value]=item.trim().split('=');if(key)values.set(key,value.join('='));}
    for(const [key,value] of Object.entries({maxaveragebitrate:ceiling,maxplaybackrate:48000,useinbandfec:1,usedtx:0}))values.set(key,String(value));
    if(stereo){values.set('stereo','1');values.set('sprop-stereo','1');}
    const fmtp=prefix+[...values].map(([key,value])=>`${key}=${value}`).join(';');
    if(index>=0)lines[index]=fmtp;else lines.splice(lines.findIndex(line=>line.startsWith(`a=rtpmap:${payload} `))+1,0,fmtp);
  }
  return {type:description.type,sdp:lines.join('\r\n')};
}
export function voiceBudget(previous={},metrics={},ceiling=128000,automatic=true){
  const rates=[64000,96000,128000,192000].filter(rate=>rate<=ceiling);
  let bitrate=rates.includes(previous.bitrate)?previous.bitrate:ceiling,healthy=previous.healthy || 0;
  if(!automatic)return {bitrate:ceiling,healthy:0};
  if(metrics.loss>.05 || metrics.rttMs>350){bitrate=rates[Math.max(0,rates.indexOf(bitrate)-1)];healthy=0;}
  else if(metrics.loss<=.015 && metrics.rttMs<180){if(++healthy>=4){bitrate=rates[Math.min(rates.length-1,rates.indexOf(bitrate)+1)];healthy=0;}}
  else healthy=0;
  return {bitrate,healthy};
}
