// Decode a replacement's first frame before giving up the displayed picture.
// The warm-up player has no audio and exists only during a quality handover.
export function prepareVideoHandover(track,{active,ready,failed,timeout=12000}) {
  const warm=document.createElement('video');warm.muted=true;warm.playsInline=true;warm.setAttribute('aria-hidden','true');
  Object.assign(warm.style,{position:'fixed',width:'1px',height:'1px',left:'0',bottom:'0',opacity:'0',pointerEvents:'none'});
  let finished=false,frame;const timer=setTimeout(()=>{if(finished)return;cancel();if(active())failed?.();},timeout);
  const cancel=()=>{if(finished)return;finished=true;clearTimeout(timer);if(frame!==undefined)warm.cancelVideoFrameCallback?.(frame);warm.pause();warm.srcObject=null;warm.remove();};
  const commit=()=>{if(finished || warm.readyState<2)return;const valid=active();cancel();if(valid)ready();};
  warm.addEventListener('loadeddata',commit);warm.addEventListener('playing',commit);
  warm.srcObject=new MediaStream([track]);document.body.append(warm);
  if(warm.requestVideoFrameCallback)frame=warm.requestVideoFrameCallback(commit);
  warm.play().then(commit).catch(()=>{});
  return cancel;
}
