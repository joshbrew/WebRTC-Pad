// Move the real controls into fullscreen so their state and handlers stay shared.
export function fullscreenToolbar(stage, toolbar, doc=document){
  const home=doc.createComment('Player controls');toolbar.before(home);
  let hideTimer=null,lastReveal=-Infinity;
  function reveal(force=false){
    if(doc.fullscreenElement!==stage)return;
    const now=performance.now();if(!force && now-lastReveal<200)return;
    lastReveal=now;stage.classList.add('controls-visible');clearTimeout(hideTimer);
    hideTimer=setTimeout(()=>stage.classList.remove('controls-visible'),2400);
  }
  function update(){
    clearTimeout(hideTimer);stage.classList.remove('controls-visible');
    if(doc.fullscreenElement===stage){stage.append(toolbar);stage.focus({preventScroll:true});reveal(true);}
    else if(toolbar.parentElement===stage)home.after(toolbar);
  }
  doc.addEventListener('fullscreenchange',update);
  // Tiles and panels stop events from reaching remote input handlers.
  stage.addEventListener('pointermove',()=>{if(!doc.pointerLockElement)reveal();},true);
  stage.addEventListener('pointerdown',()=>{if(!doc.pointerLockElement)reveal(true);},true);
  stage.addEventListener('focusin',event=>{if(event.target!==stage)reveal(true);});
  window.addEventListener('pagehide',()=>clearTimeout(hideTimer));
  return {reveal};
}
