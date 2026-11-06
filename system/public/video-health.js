// Detect a stuck decoder, not an intentionally idle captured window.
export function videoHealth(state,sample,now=performance.now()) {
  if(!sample || state?.id!==sample.id)return {...sample,at:now,stalled:0,retryAt:state?.retryAt || 0,recover:false};
  const receiving=sample.packets>state.packets,decoding=sample.frames>state.frames;
  const stalled=receiving && !decoding?(state.stalled || 0)+Math.max(0,now-state.at):0;
  const recover=stalled>=4500 && now-(state.retryAt || -Infinity)>=12000;
  return {...sample,at:now,stalled:recover?0:stalled,retryAt:recover?now:state.retryAt,recover};
}
