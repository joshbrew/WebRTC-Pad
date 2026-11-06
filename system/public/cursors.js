const palette = ['#c8f79c','#81d8ff','#ffb795','#d5b1ff','#ffe082','#ff97c8'];
export function cursorColor(id, slot) { const number = /^p\d+$/.test(slot || '') ? Number(slot.slice(1)) - 1 : [...id].reduce((sum, char) => sum + char.charCodeAt(0), 0); return number < palette.length ? palette[number] : `hsl(${Math.round(number * 137.508) % 360} 85% 70%)`; }
export function cursorLayer(stage, video) {
  const layer = document.createElement('div'); layer.className = 'guest-cursors'; layer.setAttribute('aria-hidden','true'); stage.append(layer);
  const cursors = new Map();
  let source=null,getSurface=null,pending=null,expiry=null;
  function cancel(){if(pending!==null)cancelAnimationFrame(pending);pending=null;clearTimeout(expiry);expiry=null;}
  function requestDraw(){if(cursors.size && pending===null)pending=requestAnimationFrame(draw);}
  function draw() {
    pending=null;if(!cursors.size)return;
    const current=getSurface?.(),sr=stage.getBoundingClientRect(),vr=source?sr:current?.getBoundingClientRect() || video.getBoundingClientRect(),now=Date.now();
    const width=source?.width || current?.videoWidth || video.videoWidth,height=source?.height || current?.videoHeight || video.videoHeight;
    const scale = width && height?Math.min(vr.width / width, vr.height / height):0;
    let next=Infinity;
    for (const cursor of cursors.values()) {
      cursor.element.hidden = !width || !height || !vr.width || !vr.height || now - cursor.at >= 4000 || cursor.visible === false;
      if(cursor.visible!==false && cursor.at+4000>now)next=Math.min(next,cursor.at+4000);
      if(cursor.element.hidden)continue;
      cursor.element.style.left = `${vr.left - sr.left + (vr.width - width * scale) / 2 + cursor.x * width * scale}px`;
      cursor.element.style.top = `${vr.top - sr.top + (vr.height - height * scale) / 2 + cursor.y * height * scale}px`;
    }
    clearTimeout(expiry);expiry=Number.isFinite(next)?setTimeout(requestDraw,Math.max(1,next-now)):null;
  }
  const sizeObserver=new ResizeObserver(requestDraw);sizeObserver.observe(stage); video.addEventListener('resize', requestDraw);
  window.addEventListener('pagehide',cancel);window.addEventListener('pageshow',requestDraw);document.addEventListener('visibilitychange',()=>{if(!document.hidden)requestDraw();});
  return {
    set(id, value) {
      if (!id || typeof id !== 'string' || id.length > 64 || ![value.x,value.y].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1)) return;
      let cursor = cursors.get(id);
      if (!cursor) {
        if (cursors.size >= 128) return;
        const element = document.createElement('div'); element.className = 'guest-cursor';
        element.innerHTML = '<svg viewBox="0 0 24 28"><path d="M2 2v21l6-6 5 9 4-2-5-9h9z"/></svg><span></span>';
        element.style.setProperty('--cursor-color', cursorColor(id));
        layer.append(element); cursor = { element,labelElement:element.querySelector('span') }; cursors.set(id, cursor);
      }
      cursor.x=value.x;cursor.y=value.y;cursor.visible=value.visible;cursor.at=Date.now();
      if(cursor.labelElement.textContent!==(value.label || 'Guest'))cursor.labelElement.textContent = value.label || 'Guest';
      if (/^(?:#[a-f0-9]{6}|hsl\(\d{1,3} 85% 70%\))$/i.test(value.color || '') && cursor.colorApplied!==value.color){cursor.element.style.setProperty('--cursor-color', value.color);cursor.colorApplied=value.color;}
      cursor.element.classList.toggle('is-clicking', !!value.pressed); requestDraw();
    },
    remove(id) { cursors.get(id)?.element.remove(); cursors.delete(id);if(!cursors.size)cancel();else requestDraw(); },
    labels(enabled) { layer.classList.toggle('labels-on', enabled); },
    source(value) { source = value; requestDraw(); },
    surface(value){getSurface=value;requestDraw();},
    mount(target,value){if(target && target!==stage){sizeObserver.unobserve(stage);stage=target;stage.append(layer);sizeObserver.observe(stage);}getSurface=value;requestDraw();},
    clear() { cancel();layer.replaceChildren(); cursors.clear(); }
  };
}
