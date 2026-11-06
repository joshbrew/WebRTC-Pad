export function relativeDelta(dx,dy){return [dx,dy].every(n=>typeof n==='number' && Number.isFinite(n)) ? {dx:Math.max(-500,Math.min(500,dx)),dy:Math.max(-500,Math.min(500,dy))}:null;}
export function relativeMouse(stage,{allowed,send,release}){
  const button=document.createElement('button');button.type='button';button.className='button small-button';button.textContent='Lock mouse for games';button.title='Use relative mouse movement. Escape releases the mouse.';button.id='clientRelativeMouse';
  let frame,dx=0,dy=0;const locked=()=>document.pointerLockElement===stage;
  button.onclick=async()=>{if(locked()){document.exitPointerLock();return;}if(!allowed())return;try{await stage.requestPointerLock({unadjustedMovement:true});}catch{try{await stage.requestPointerLock();}catch{button.textContent='Mouse lock unavailable';}}};
  const exit=()=>{if(locked())document.exitPointerLock();};
  window.addEventListener('keydown',event=>{if(event.code==='Escape' && locked()){event.preventDefault();event.stopImmediatePropagation();exit();}},true);
  stage.addEventListener('mousemove',event=>{if(!locked())return;event.preventDefault();event.stopImmediatePropagation();if(!allowed()){exit();return;}dx+=event.movementX;dy+=event.movementY;if(!frame)frame=requestAnimationFrame(()=>{frame=null;const value=relativeDelta(dx,dy);dx=dy=0;if(value && locked() && allowed())send(value);});},true);
  // Pointer events remain available for clicks, but must not become absolute moves.
  stage.addEventListener('pointermove',event=>{if(locked())event.stopImmediatePropagation();},true);
  document.addEventListener('pointerlockchange',()=>{dx=dy=0;cancelAnimationFrame(frame);frame=null;release();button.textContent=locked()?'Release mouse · Esc':'Lock mouse for games';});
  for(const event of ['blur','pagehide'])window.addEventListener(event,exit);document.addEventListener('visibilitychange',()=>{if(document.hidden)exit();});
  return {button,locked,refresh(){button.disabled=!allowed() && !locked();if(locked() && !allowed())exit();},exit};
}
