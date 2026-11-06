// One pending tick at most. If the page stalls, sample its newest controller
// state on recovery instead of processing a backlog of worker notifications.
let pending=false;
onmessage=()=>{pending=false;};
setInterval(()=>{if(!pending){pending=true;postMessage(null);}},1000/120);
