// Event-driven effects only. Actions never wait for animations; no frame loop
// or media observers run alongside gameplay.
export function initInteractionMotion(root=document){
  const reduced=matchMedia('(prefers-reduced-motion: reduce)'),running=new Map(),channels=new WeakMap(),ripples=new WeakMap(),switches=new Set();
  const cancel=(group=null)=>{for(const [animation,channel] of running)if(!group || channel.startsWith(group)){animation.cancel();running.delete(animation);}};
  const available=control=>control && !reduced.matches && !document.hidden && !control.disabled && !control.matches(':disabled') && !control.closest('[inert],[aria-disabled=true],[data-no-motion]') && control.getClientRects().length && typeof control.animate==='function';
  function play(control,frames,options={},channel='press'){
    if(!available(control))return;
    let active=channels.get(control);if(!active){active=new Map();channels.set(control,active);}active.get(channel)?.cancel();
    const animation=control.animate(frames,{duration:260,easing:'cubic-bezier(.2,.75,.25,1)',...options});
    active.set(channel,animation);running.set(animation,channel);
    const settled=()=>{running.delete(animation);if(active.get(channel)===animation)active.delete(channel);};
    animation.onfinish=settled;animation.oncancel=settled;return animation;
  }
  const interactive='button,a[href],summary,input,select,textarea';
  const iconsFor=control=>[...control.querySelectorAll('svg,.appearance-chevron')].filter(icon=>{
    const owner=icon.closest(interactive);
    return !icon.parentElement.closest('svg') && (!owner || owner===control) && available(icon);
  });
  function ripple(control,origin){
    const {left,top,width,height}=origin.getBoundingClientRect();
    if(!width || !height)return;
    ripples.get(control)?.cancel();
    const ring=document.createElement('span');
    ring.className='ui-press-ripple';
    ring.setAttribute('aria-hidden','true');
    const dialog=control.closest('dialog[open]');
    const host=dialog || document.fullscreenElement || document.body;
    const bounds=dialog?.getBoundingClientRect();
    const size=Math.min(30,Math.max(16,width,height)+4);
    const x=left+width/2-size/2-(dialog?bounds.left+dialog.clientLeft-dialog.scrollLeft:0);
    const y=top+height/2-size/2-(dialog?bounds.top+dialog.clientTop-dialog.scrollTop:0);
    Object.assign(ring.style,{
      position:dialog?'absolute':'fixed',left:x+'px',top:y+'px',width:size+'px',height:size+'px',
      margin:'0',zIndex:'1100',pointerEvents:'none',color:getComputedStyle(origin).color,
      background:'radial-gradient(circle, transparent 34%, color-mix(in srgb,currentColor 50%,transparent) 52%, transparent 70%)',
    });
    host.append(ring);
    const effect=play(ring,[{opacity:.82,scale:'.72'},{opacity:0,scale:'2.35'}],{duration:360,easing:'cubic-bezier(.18,.64,.4,1)'},'ripple');
    if(!effect){ring.remove();return;}
    ripples.set(control,effect);
    const remove=()=>{ring.remove();if(ripples.get(control)===effect)ripples.delete(control);};
    effect.finished.then(remove,remove);
  }
  const click=event=>{
    if(event.button>0)return;
    const input=event.target?.closest?.(interactive);
    if(!input?.matches('button,a[href],summary,input[type=checkbox],input[type=radio],input[type=file]') || input.matches('.streamer-resize,[role=separator]'))return;
    const control=input.matches('input[type=file]')?input.closest('.file-button') || input:input;
    if(!available(control) || input.disabled)return;
    if(input.matches('input[type=checkbox],input[type=radio]')){commit(control);return;}
    const icons=iconsFor(control);
    if(control.matches('a:not(.button)') && !icons.length){play(control,[{opacity:.6},{opacity:1}],{duration:220});return;}
    const wide=control.matches('summary,.large,.full,.controller-select,.source-tile,.file-button');
    // Keep the hit target fixed. Only the glyph or label moves.
    const decorations=icons.length?icons:[...control.children].filter(child=>child.matches('span:not(.chat-unread),.source-preview') && !child.querySelector(interactive));
    ripple(control,icons.find(icon=>icon.contains(event.target)) || icons[0] || control);
    for(const decoration of decorations){
      channels.get(decoration)?.get('press')?.cancel();
      channels.get(decoration)?.get('attention')?.cancel();
      const base=getComputedStyle(decoration).scale;
      const resting=base==='none'?'1':base;
      const glyph=icons.includes(decoration);
      play(decoration,[
        {scale:resting,easing:'ease-out',offset:0},
        {scale:glyph?'.94':wide?'.98':'.96',easing:'ease-in-out',offset:.18},
        {scale:glyph?'1.14':wide?'1.025':'1.06',easing:'ease-out',offset:.48},
        {scale:resting,offset:1}
      ],{duration:240,easing:'linear'});
    }
  };
  function commit(control){
    if(!available(control))return;
    channels.get(control)?.get('commit')?.cancel();
    const style=getComputedStyle(control),tint=style.getPropertyValue('--accent-soft').trim() || 'rgba(200,247,156,.2)';
    play(control,[{boxShadow:`inset 0 0 0 2px ${tint}, 0 0 0 3px ${tint}`},{boxShadow:style.boxShadow}],{duration:210,easing:'ease-out'},'commit');
  }
  function finishSwitch(control){
    switches.delete(control);delete control.dataset.switchMotion;for(const property of ['--ui-switch-from','--ui-switch-end','--ui-switch-over'])control.style.removeProperty(property);control.removeEventListener('animationend',switchEnded);control.removeEventListener('animationcancel',switchEnded);
  }
  function switchMotion(control){
    if(!available(control) || !control.closest('.check-row,#clientJoinControllersOption') || getComputedStyle(control,'::before').content==='none')return;
    // Animate the decorative thumb, never the input's hit box. Capture its
    // current pose so fast reversals continue smoothly without a forced reflow.
    const from=getComputedStyle(control,'::before').transform;
    control.style.setProperty('--ui-switch-from',from==='none'?'translateX(0px)':from);
    control.style.setProperty('--ui-switch-end',control.checked?'16px':'0px');control.style.setProperty('--ui-switch-over',control.checked?'18px':'-2px');
    if(!switches.has(control)){control.addEventListener('animationend',switchEnded);control.addEventListener('animationcancel',switchEnded);}
    control.dataset.switchMotion=control.dataset.switchMotion==='a'?'b':'a';switches.add(control);
  }
  const switchEnded=event=>{
    const control=event.target;
    if(event.pseudoElement==='::before' && switches.has(control) && event.animationName===`ui-switch-${control.dataset.switchMotion}`)finishSwitch(control);
  };
  const change=event=>{
    if(!event.isTrusted)return;
    if(event.target?.matches?.('input[type=checkbox]'))switchMotion(event.target);
    else if(event.target?.matches?.('select,input[type=range],input[type=number],input[type=color]'))commit(event.target);
  };
  const committed=event=>commit(event.detail?.target);
  const attention=event=>{
    const control=event.detail;
    if(!available(control) || ripples.has(control) || document.querySelector('dialog[open]'))return;
    const [glyph]=iconsFor(control);
    if(!glyph){commit(control);return;}
    play(glyph,[{rotate:'0deg'},{rotate:'-10deg',offset:.23},{rotate:'8deg',offset:.49},{rotate:'-4deg',offset:.74},{rotate:'0deg'}],{duration:490},'attention');
  };
  const toggle=event=>{
    const disclosure=event.target;
    if(!disclosure?.matches?.('details[open]:not(.call-sheet,.peer-menu)') || document.querySelector('#helpDialog[open]') || disclosure.querySelector('video,canvas,.video-stage,.pad-live,.mapper-stick,[data-no-motion]'))return;
    for(const child of [...disclosure.children].filter(el=>el.tagName!=='SUMMARY' && el.getClientRects().length).slice(0,3))play(child,[{opacity:.62},{opacity:1}],{duration:150,easing:'ease-out'},'disclosure');
  };
  const guide=event=>{
    cancel('guide');const {dialog,target,previous}=event.detail || {};if(!available(dialog))return;
    const left=parseFloat(dialog.style.left),top=parseFloat(dialog.style.top);
    if(previous && Number.isFinite(left) && Number.isFinite(top)){
      // Keep short hops on-screen when guide steps differ in position or size.
      const x=Math.max(12,Math.min(innerWidth-dialog.offsetWidth-12,previous.left)),y=Math.max(12,Math.min(innerHeight-dialog.offsetHeight-12,previous.top));
      let dx=Math.max(-40,Math.min(40,x-left)),dy=Math.max(-30,Math.min(30,y-top));
      // Stay on the outside of the highlighted action throughout the hop.
      if(dialog.dataset.side==='right')dx=Math.max(0,dx);if(dialog.dataset.side==='left')dx=Math.min(0,dx);
      if(dialog.dataset.side==='above')dy=Math.min(0,dy);if(dialog.dataset.side==='below')dy=Math.max(0,dy);
      play(dialog,[{translate:`${dx}px ${dy}px`},{translate:'0px 0px'}],{duration:260,easing:'cubic-bezier(.2,1.15,.35,1)'},'guide-position');
    }
    for(const id of ['tourTitle','tourProgress','tourBody','tourTip']){
      const text=dialog.querySelector(`#${id}`);if(text)play(text,[{opacity:.35,translate:'0px 3px'},{opacity:1,translate:'0px 0px'}],{duration:200},'guide-content');
    }
    if(target)play(target,[{outlineOffset:'11px'},{outlineOffset:'4px',offset:.65},{outlineOffset:'5px'}],{duration:340},'guide-target');
  };
  const anchorMove=event=>channels.get(event.detail?.dialog)?.get('guide-position')?.cancel();
  const endGuide=()=>cancel('guide'),stop=()=>{cancel();for(const control of [...switches])finishSwitch(control);},visibility=()=>{if(document.hidden)stop();};
  // Capture reaches protected panels without consuming or forwarding inputs.
  root.addEventListener('click',click,true);root.addEventListener('change',change,true);root.addEventListener('toggle',toggle,true);
  root.addEventListener('ui-control-commit',committed);root.addEventListener('ui-attention',attention);root.addEventListener('tour-step-motion',guide);root.addEventListener('tour-motion-end',endGuide);root.addEventListener('tour-anchor-move',anchorMove);
  reduced.addEventListener('change',stop);document.addEventListener('visibilitychange',visibility);window.addEventListener('pagehide',stop);window.addEventListener('resize',endGuide);
  return ()=>{stop();root.removeEventListener('click',click,true);root.removeEventListener('change',change,true);root.removeEventListener('toggle',toggle,true);root.removeEventListener('ui-control-commit',committed);root.removeEventListener('ui-attention',attention);root.removeEventListener('tour-step-motion',guide);root.removeEventListener('tour-motion-end',endGuide);root.removeEventListener('tour-anchor-move',anchorMove);reduced.removeEventListener('change',stop);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pagehide',stop);window.removeEventListener('resize',endGuide);};
}
if(typeof document!=='undefined')initInteractionMotion();
