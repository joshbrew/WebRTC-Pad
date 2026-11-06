export function cleanRumble(value) {
  return Number.isInteger(value?.controller) && value.controller>=0 && value.controller<256 && Number.isSafeInteger(value.generation) && [value.large,value.small].every(n=>typeof n==='number' && Number.isFinite(n) && n>=0 && n<=1) ? {controller:value.controller,generation:value.generation,large:value.large,small:value.small} : null;
}
export function playRumble(pad,value) {
  const actuator=pad?.vibrationActuator;if(!actuator?.playEffect)return false;
  try { const result=actuator.playEffect('dual-rumble',{startDelay:0,duration:value.large || value.small?180:0,strongMagnitude:value.large,weakMagnitude:value.small});result?.catch?.(()=>{});return true; } catch { return false; }
}
