const fullscreen=document.querySelector('#viewFullscreen');
const notice=document.querySelector('#viewNotice');
const body=document.body;
let hideTimer,lastReveal=-Infinity;
function revealControls(force=false){
  const now=performance.now();
  if(!force && now-lastReveal<200)return;
  lastReveal=now;
  body.classList.add('popout-controls-visible');
  clearTimeout(hideTimer);
  hideTimer=setTimeout(()=>body.classList.remove('popout-controls-visible'),2400);
}
body.addEventListener('pointermove',()=>revealControls(),{passive:true});
body.addEventListener('pointerenter',()=>revealControls(true),{passive:true});
body.addEventListener('pointerdown',()=>revealControls(true),{passive:true});
body.addEventListener('focusin',()=>revealControls(true));
window.addEventListener('focus',()=>revealControls(true));
window.addEventListener('pagehide',()=>clearTimeout(hideTimer));

fullscreen.hidden=!document.fullscreenEnabled;
fullscreen.addEventListener('click',async()=>{
  notice.hidden=true;
  try{
    if(document.fullscreenElement)await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  }catch{
    notice.textContent='Fullscreen is unavailable in this window.';
    notice.hidden=false;
  }
});
document.addEventListener('fullscreenchange',()=>{
  fullscreen.textContent=document.fullscreenElement?'Exit fullscreen':'Fullscreen';
  revealControls(true);
});
revealControls(true);
if(window.opener)window.opener.postMessage({type:'view-window-ready'},location.origin);
else document.querySelector('[role=status]').textContent='Open a shared view from your active call to watch here.';
