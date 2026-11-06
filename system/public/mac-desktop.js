const status=document.querySelector('#macPermissionStatus');
const buttons=[...document.querySelectorAll('button')];
async function permissions(action='status'){
  buttons.forEach(button=>button.disabled=true);
  try{
    const response=await fetch(`/mac-permissions${action==='status'?'':`?action=${action}`}`,{method:action==='status'?'GET':'POST'});
    if(!response.headers.get('content-type')?.includes('application/json'))throw new Error('Open this guide from the app running locally on your Mac.');
    const value=await response.json();if(!response.ok)throw new Error(value.error);
    status.textContent=`Screen/audio: ${value.screen?'allowed':'not yet allowed'} · Accessibility: ${value.input?'allowed':'not yet allowed'}. If you changed a permission, reopen the app when macOS asks.`;
  }catch(error){status.textContent=error.message;}
  finally{buttons.forEach(button=>button.disabled=false);}
}
document.querySelector('#macScreen').onclick=()=>permissions('screen');
document.querySelector('#macInput').onclick=()=>permissions('input');
document.querySelector('#macRefresh').onclick=()=>permissions();
permissions();
