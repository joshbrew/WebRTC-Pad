// Display metadata only. Player ownership always comes from the host bridge.
export function controllerPresence(value){
  if(!value || !Array.isArray(value.controllers))return null;
  const detected=Number.isSafeInteger(value.detected)?Math.max(0,Math.min(256,value.detected)):0;
  return {
    detected,
    needsMapping:Number.isSafeInteger(value.needsMapping)?Math.max(0,Math.min(detected,value.needsMapping)):0,
    enabled:value.enabled===true,
    setupRequired:value.setupRequired===true,
    controllers:value.controllers.slice(0,256).filter(item=>Number.isSafeInteger(item?.index) && item.index>=0 && item.index<256).map(item=>({
      index:item.index,name:typeof item.name==='string'?item.name.replace(/[\u0000-\u001f\u007f]/g,'').slice(0,80):'Controller',
      connected:item.connected===true,keyboard:item.keyboard===true
    }))
  };
}

export class LocalControllerJoin {
  known = new Set();
  outputsActive = false;
  static key(pad){return `${pad.index}:${pad.id}`;}
  observe(pads){
    if(this.outputsActive)return;
    for(const pad of pads)if(pad && pad.connected!==false)this.known.add(LocalControllerJoin.key(pad));
  }
  lock(){this.outputsActive=true;}
  needsSelection(pad){
    return this.outputsActive && !this.known.has(LocalControllerJoin.key(pad));
  }
}
