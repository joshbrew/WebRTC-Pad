const video=document.querySelector('video');
document.querySelector('#viewFullscreen').onclick=()=>video.requestFullscreen?.().catch(()=>{});
if(window.opener)window.opener.postMessage({type:'view-window-ready'},location.origin);
else document.querySelector('[role=status]').textContent='Open a shared view from your active call to watch here.';
