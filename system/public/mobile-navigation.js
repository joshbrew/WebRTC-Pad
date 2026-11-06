const views={
  host:[['room','Room','people','#hostPanel > .call-main, #sessionConnection'],['screen','Screen','share','#hostMonitorDock, #hostLiveSource'],['voice','Voice','volume','#hostVoice'],['settings','Settings','settings','#hostSettings, #driverNotice']],
  client:[['game','Game','share','#clientPanel > .call-main, #clientPairing, #sessionGuestInvite, #sessionConnection'],['controllers','Controllers','pad','#controllerSetup'],['voice','Voice','volume','#clientVoice'],['settings','Settings','settings','#clientPanel > .sidebar > .settings-card']]
};
const selected={host:'room',client:'game'},phone=()=>matchMedia('(max-width:700px)').matches;
let navigation,buttonsMode;
function render(){
  if(!navigation)return;
  const mode=document.body.dataset.mode || 'host',list=views[mode],voice=document.getElementById(mode==='host'?'hostVoice':'clientVoice');
  if(selected[mode]==='voice' && voice.hidden)selected[mode]=list[0][0];
  if(buttonsMode!==mode){
    navigation.replaceChildren();buttonsMode=mode;
    for(const [key,label,icon] of list){const button=document.createElement('button');button.type='button';button.dataset.view=key;button.innerHTML=`<svg class="icon" aria-hidden="true"><use href="#i-${icon}"/></svg><span>${label}</span>`;button.onclick=()=>{selected[mode]=key;render();window.scrollTo({top:0,behavior:'instant'});};navigation.append(button);}
  }
  for(const button of navigation.children){button.disabled=button.dataset.view==='voice' && voice.hidden;button.setAttribute('aria-current',button.dataset.view===selected[mode]?'page':'false');}
  for(const [key,,,selector] of list)for(const element of document.querySelectorAll(selector)){element.dataset.mobilePane=key;element.classList.toggle('mobile-inactive',selected[mode]!==key);}
  document.body.dataset.mobileView=selected[mode];
  document.dispatchEvent(new Event('mobile-view'));
}
export function revealMobileTarget(element){
  if(!phone() || !navigation || !element)return;
  const mode=document.body.dataset.mode || 'host';
  for(const [key,,,selector] of views[mode])if([...document.querySelectorAll(selector)].some(owner=>owner===element || owner.contains(element))){if(selected[mode]!==key){selected[mode]=key;render();}return;}
}
export function initMobileNavigation(){
  if(navigation)return;
  navigation=document.createElement('nav');navigation.className='mobile-navigation';navigation.setAttribute('aria-label','Session views');document.querySelector('.app-shell').append(navigation);
  document.addEventListener('app-mode',render);document.addEventListener('mobile-layout',render);document.addEventListener('quick-start',()=>queueMicrotask(render));
  matchMedia('(max-width:700px)').addEventListener('change',()=>{render();revealMobileTarget(document.querySelector('.tour-target'));});
  render();
}
