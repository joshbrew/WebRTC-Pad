// Only opt into HEVC when WebRTC and efficient hardware decoding both work.
const checks=new Map();
export function codecSupport(settings={},api=globalThis){
  const width=settings.width || 1920,height=settings.height || 1080,frameRate=settings.frameRate || 60,bitrate=settings.maxBitrate || 8000000;
  const check=async()=>{
    const base={codecs:['h264'],hevcAvailable:false};
    try{
      if(!api.RTCRtpReceiver?.getCapabilities?.('video')?.codecs?.some(codec=>codec.mimeType.toLowerCase()==='video/h265'))return {...base,reason:'This browser does not offer H.265 for WebRTC.'};
      if(!api.navigator?.mediaCapabilities?.decodingInfo)return {...base,reason:'Hardware decoding could not be confirmed.'};
      const info=await api.navigator.mediaCapabilities.decodingInfo({type:'webrtc',video:{contentType:'video/H265',width,height,bitrate,framerate:frameRate}});
      if(!info.supported || !info.powerEfficient || !info.smooth)return {...base,reason:'Hardware-efficient H.265 decoding is unavailable at these settings.'};
      return {codecs:['h264','h265'],hevcAvailable:true,reason:'H.265 hardware decoding is available.'};
    }catch{return {...base,reason:'H.265 decoding could not be confirmed.'};}
  };
  if(api!==globalThis)return check();
  const key=`${width}x${height}-${frameRate}-${bitrate}`;if(!checks.has(key))checks.set(key,check());return checks.get(key);
}
export function selectedCodec(host,request={}){return host.codec==='h265' && request.codec!=='h264' && request.codecs?.includes('h265')?'h265':'h264';}
