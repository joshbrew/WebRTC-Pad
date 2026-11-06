const el=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n;};

export class CaptureArea {
  constructor({root,preview,sourceSize,bounds,controlScope,prepare,apply,status}) {
    Object.assign(this,{preview,sourceSize,bounds,controlScope,prepare,apply,status});this.value=null;
    this.root=el('div');this.root.className='capture-area';this.root.id='captureArea';this.root.hidden=true;
    const row=el('div');row.className='row';this.choose=el('button','Select an area…');this.choose.className='button small-button';this.choose.id='chooseCaptureArea';
    this.reset=el('button','Share full source');this.reset.className='button small-button';this.reset.id='clearCaptureArea';this.reset.hidden=true;
    this.note=el('p','Choose a screen or window first, then select an area if needed.');this.note.className='small muted';this.note.setAttribute('role','status');
    const advanced=el('details');advanced.className='advanced';advanced.append(el('summary','Exact area dimensions'));
    const fields=el('div');fields.className='area-fields';this.fields={};
    for(const [key,label] of [['x','Left'],['y','Top'],['width','Width'],['height','Height']]){
      const wrap=el('label',label),input=el('input');input.type='number';input.min=['x','y'].includes(key)?'0':'2';input.max='32768';input.step='1';input.value=['x','y'].includes(key)?'0':'';input.id=`captureArea-${key}`;this.fields[key]=input;wrap.append(input);fields.append(wrap);
    }
    const save=el('button','Apply area');save.className='button small-button';save.onclick=()=>this.commit(Object.fromEntries(Object.entries(this.fields).map(([k,n])=>[k,Number(n.value)])));
    advanced.append(fields,save);row.append(this.choose,this.reset);this.root.append(row,this.note,advanced);root.append(this.root);
    this.choose.onclick=()=>this.draw();this.reset.onclick=()=>this.commit(null);this.render();
  }
  current(){return this.value;}
  async commit(value){
    const previous=this.value;
    try{
      if(value && (!Object.values(value).every(Number.isSafeInteger) || value.x<0 || value.y<0 || value.width<2 || value.height<2 || value.x+value.width>32768 || value.y+value.height>32768))throw new Error('Draw an area at least 2 × 2 pixels.');
      const size=this.bounds?.();if(value && (size?.width && value.x+value.width>size.width || size?.height && value.y+value.height>size.height))throw new Error('The area is outside this source. Choose a smaller area.');
      this.value=value;this.choose.disabled=true;await this.apply();this.render();
    }catch(error){this.value=previous;this.render();this.status(error.message);}finally{this.choose.disabled=false;}
  }
  render(){this.reset.hidden=!this.value;this.note.textContent=this.value?`Sharing ${this.value.width} × ${this.value.height} pixels. ${this.controlScope?.()?'Approved mouse control stays within this area; typing applies to the shared window.':'Desktop mouse and typing are off for this area.'}`:'Sharing the full source. Select an area to crop the picture; audio is unchanged.';for(const [k,n] of Object.entries(this.fields))n.value=this.value?.[k] ?? (['x','y'].includes(k)?0:'');}
  async draw(){
    // Never uncrop the live share merely to open the picker. A second drag
    // refines the current crop; only Share full source explicitly removes it.
    const base=this.value;
    try{await this.prepare?.();}catch(error){this.status(error.message);return;}
    const video=this.preview;
    if(!video.videoWidth || video.readyState<2 || !video.srcObject){this.status('Choose a source and show its preview before selecting an area.');return;}
    try{await video.play();}catch{}
    const dialog=el('dialog');dialog.className='area-dialog';dialog.id='captureAreaDialog';dialog.setAttribute('aria-labelledby','captureAreaTitle');
    const title=el('h3','Drag over the area to share');title.id='captureAreaTitle';const note=el('p',base?'Select within the current area. To choose elsewhere, close this dialog and use Share full source or Exact area dimensions.':'Only the selected rectangle will be sent. Audio continues from the selected sound source.');
    const canvas=el('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;canvas.style.touchAction='none';canvas.tabIndex=0;canvas.setAttribute('aria-label','Drag to select a capture area. Exact dimensions are also available outside this dialog.');
    const image=document.createElement('canvas');image.width=canvas.width;image.height=canvas.height;image.getContext('2d').drawImage(video,0,0);const ctx=canvas.getContext('2d');
    let start=null,rect=null;const paint=()=>{ctx.drawImage(image,0,0);if(rect){ctx.fillStyle='#0009';ctx.fillRect(0,0,canvas.width,rect.y);ctx.fillRect(0,rect.y+rect.height,canvas.width,canvas.height-rect.y-rect.height);ctx.fillRect(0,rect.y,rect.x,rect.height);ctx.fillRect(rect.x+rect.width,rect.y,canvas.width-rect.x-rect.width,rect.height);ctx.strokeStyle='#c8f69b';ctx.lineWidth=Math.max(2,canvas.width/500);ctx.strokeRect(rect.x,rect.y,rect.width,rect.height);}};
    const point=e=>{const b=canvas.getBoundingClientRect();return {x:Math.max(0,Math.min(canvas.width,Math.round((e.clientX-b.left)*canvas.width/b.width))),y:Math.max(0,Math.min(canvas.height,Math.round((e.clientY-b.top)*canvas.height/b.height)))};};
    const actions=el('div');actions.className='row';const cancel=el('button','Cancel'),confirm=el('button','Share selected area');cancel.className='button';confirm.className='button primary';confirm.disabled=true;
    canvas.onpointerdown=e=>{start=point(e);canvas.setPointerCapture(e.pointerId);};canvas.onpointermove=e=>{if(!start)return;const end=point(e);rect={x:Math.min(start.x,end.x),y:Math.min(start.y,end.y),width:Math.abs(end.x-start.x),height:Math.abs(end.y-start.y)};paint();confirm.disabled=rect.width<2 || rect.height<2;};canvas.onpointerup=()=>{start=null;};
    const close=()=>{dialog.close();dialog.remove();this.choose.focus();};cancel.onclick=close;dialog.addEventListener('cancel',()=>{dialog.remove();this.choose.focus();});confirm.onclick=()=>{const size=base || this.sourceSize?.() || {width:canvas.width,height:canvas.height},sx=size.width/canvas.width,sy=size.height/canvas.height;const x=Math.round(rect.x*sx),y=Math.round(rect.y*sy),selected={x:x+(base?.x || 0),y:y+(base?.y || 0),width:Math.min(size.width-x,Math.round(rect.width*sx)),height:Math.min(size.height-y,Math.round(rect.height*sy))};close();this.commit(selected);};
    actions.append(cancel,confirm);dialog.append(title,note,canvas,actions);document.body.append(dialog);paint();dialog.showModal();
  }
  browser(stream,fps=60){
    const raw=stream._areaSource || stream,previous=this.raw,source=raw.getVideoTracks()[0],size=source.getSettings();
    if(this.value && (size.width && this.value.x+this.value.width>size.width || size.height && this.value.y+this.value.height>size.height))throw new Error('The area is outside this source. Share the full source and select an area again.');
    this.stopBrowser(false);if(previous && previous!==raw)previous.getTracks().forEach(t=>t.stop());this.raw=raw;
    if(!this.value)return raw;
    const {x,y,width,height}=this.value;
    const video=el('video'),canvas=el('canvas');video.muted=true;video.playsInline=true;video.srcObject=raw;canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d',{alpha:false}),output=canvas.captureStream(0),track=output.getVideoTracks()[0];
    let stopped=false,timer,callback,worker,last=0;
    const draw=now=>{if(stopped || video.readyState<2 || now-last<1000/fps-1)return;ctx.fillStyle='#000';ctx.fillRect(0,0,width,height);if(x+width<=video.videoWidth && y+height<=video.videoHeight)ctx.drawImage(video,x,y,width,height,0,0,width,height);track.requestFrame();last=now;};
    const frame=now=>{draw(now);if(!stopped)callback=video.requestVideoFrameCallback(frame);};
    // Chromium may suspend callbacks for this offscreen source video. Reuse
    // the bounded worker clock so cropping also advances while the host plays
    // in another window; acknowledgements prevent a queued-frame backlog.
    const fallback=()=>{if(!stopped && !timer)timer=setInterval(()=>draw(performance.now()),1000/fps);};
    try{worker=new Worker(new URL('./input-clock.js',import.meta.url),{type:'module'});worker.onmessage=()=>{if(stopped)return;try{draw(performance.now());}finally{worker?.postMessage('ack');}};worker.onerror=()=>{worker?.terminate();worker=null;fallback();};}catch{fallback();}
    video.play().then(()=>{draw(performance.now());if(video.requestVideoFrameCallback)callback=video.requestVideoFrameCallback(frame);}).catch(error=>this.status(error.message));track.contentHint='motion';for(const audio of raw.getAudioTracks())output.addTrack(audio);output._areaSource=raw;
    const ended=()=>track.dispatchEvent(new Event('ended'));source.addEventListener('ended',ended,{once:true});
    this.browserCleanup=()=>{stopped=true;clearInterval(timer);worker?.terminate();if(callback)video.cancelVideoFrameCallback?.(callback);source.removeEventListener('ended',ended);video.pause();video.srcObject=null;track.stop();};return output;
  }
  stopBrowser(stopSource=true){this.browserCleanup?.();this.browserCleanup=null;if(stopSource)this.raw?.getTracks().forEach(t=>t.stop());this.raw=null;}
}
