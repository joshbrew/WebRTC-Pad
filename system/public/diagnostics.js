import {DiagnosticHistory} from './diagnostic-history.js';

const groups=[
  ['Delay · ms',[['inputMs','Controls','#d0f79b'],['rttMs','Video network','#81d8ff'],['bufferMs','Buffer','#ffb795'],['decodeMs','Decode','#d5b1ff']]],
  ['Frame rate · fps',[['fps','Video','#d0f79b']]],
  ['Video data · Mbps',[['mbps','Received','#81d8ff']]],
  ['Packet loss · %',[['lossPercent','Video','#ffb795']]]
];
let library;
async function loadCharts(){
  // The 0.2.0 npm archive ships source modules, without the advertised dist/.
  // Serve only its explicit module graph; no CDN or general node_modules access.
  if(!document.querySelector('link[data-diagnostic-style]')){const link=document.createElement('link');link.rel='stylesheet';link.href='/charts/scripts/uPlot.css';link.dataset.diagnosticStyle='';document.head.append(link);}
  return library ||= import('/charts/scripts/uPlot.js').then(module=>{
    const Plot=module.default;Plot.WebGPURenderer.setSharedRuntimeEnabled(true);Plot.configure({rendererOptions:{memoryMode:'low'}});return Plot;
  }).catch(error=>{library=null;throw error;});
}

export class Diagnostics{
  constructor(root,{source='This connection'}={}){
    this.root=root;this.sources=new Map();this.plots=[];
    root.innerHTML='<summary>Diagnostics &amp; charts</summary><div class="diagnostics-body"><div class="diagnostic-controls"><label class="field-label">Connection<select data-diagnostic="source"></select></label><label class="field-label">Chart<select data-diagnostic="metric"><option value="0">Delay · ms</option><option value="1">Frame rate · fps</option><option value="2">Video data · Mbps</option><option value="3">Packet loss · %</option></select></label></div><dl data-diagnostic="readings" class="diagnostic-readings"></dl><div data-diagnostic="plots" class="diagnostic-plots"></div><div class="diagnostic-actions"><button data-diagnostic="pause" class="button small-button">Pause</button><button data-diagnostic="reset" class="button small-button">Reset</button><button data-diagnostic="export" class="button small-button">Save CSV</button></div><p data-diagnostic="status" class="small muted" role="status">Waiting for connection samples.</p><p class="diagnostic-note muted">Delays measure separate parts of the connection, not total button-to-picture time.</p></div>';
    this.$=name=>root.querySelector(`[data-diagnostic="${name}"]`);this.addSource('default',source);
    this.$('source').onchange=()=>{this.failed=false;this.dispose();this.draw();};
    this.$('metric').onchange=()=>{this.failed=false;this.dispose();this.draw();};
    this.readings=[['inputMs','Controls','ms'],['bufferMs','Buffer','ms'],['fps','Picture','fps'],['mbps','Video data','Mbps'],['decodeMs','Decode','ms'],['lossPercent','Packet loss','%'],['rttMs','Video network','ms']].map(([key,label,unit])=>{const row=document.createElement('div'),term=document.createElement('dt'),value=document.createElement('dd');term.textContent=label;value.textContent='—';row.append(term,value);this.$('readings').append(row);return {key,unit,value};});
    this.$('pause').onclick=()=>{this.paused=!this.paused;this.$('pause').textContent=this.paused?'Resume':'Pause';this.draw();};
    this.$('reset').onclick=()=>{this.history?.clear();this.draw();};
    this.$('export').onclick=()=>{if(!this.history?.rows.length)return;const url=URL.createObjectURL(new Blob([this.history.csv()],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='webrtc-diagnostics.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
    root.addEventListener('toggle',()=>{if(this.visible)this.draw();else this.dispose();});
    const refresh=()=>{if(this.visible)this.draw();else this.dispose();};
    document.addEventListener('visibilitychange',refresh);document.addEventListener('app-mode',refresh);document.addEventListener('mobile-view',refresh);
    this.observer=new ResizeObserver(()=>{if(this.visible)this.resize();else this.dispose();});this.observer.observe(root);
    window.addEventListener('pagehide',()=>this.dispose());
  }
  get visible(){return this.root.open && !document.hidden && this.root.getClientRects().length>0;}
  get group(){return groups[Number(this.$('metric').value) || 0];}
  get history(){return this.sources.get(this.$('source').value)?.history;}
  addSource(id,label){if(this.sources.has(id))return;this.sources.set(id,{label,history:new DiagnosticHistory()});this.$('source').add(new Option(label,id));this.$('source').parentElement.hidden=this.sources.size<2;}
  removeSource(id){if(id==='default')return;this.sources.delete(id);for(const option of [...this.$('source').options])if(option.value===id)option.remove();this.$('source').parentElement.hidden=this.sources.size<2;this.dispose();this.draw();}
  record(values,{source='default',label}={}){if(this.paused)return;if(label)this.addSource(source,label);const entry=this.sources.get(source);if(!entry)return;entry.history.push(values);if(this.visible && source===this.$('source').value)this.draw();}
  clear(){for(const value of this.sources.values())value.history.clear();this.draw();}
  dispose(){this.epoch=(this.epoch || 0)+1;for(const plot of this.plots)plot.destroy();this.plots=[];this.$('plots').replaceChildren();}
  resize(){const width=Math.floor(this.$('plots').clientWidth);if(width<120)return;for(const plot of this.plots)if(plot.width!==width)plot.setSize({width,height:110});}
  async draw(){
    if(!this.visible)return;
    const history=this.history,rows=history?.rows || [];this.$('export').disabled=!rows.length;
    this.$('status').textContent=`${this.paused?'Paused · ':''}${rows.length} / 120 recent samples`;
    const latest=rows.at(-1);for(const {key,unit,value} of this.readings){const number=latest?.[key];value.textContent=number==null?'—':`${number.toFixed(key==='fps'?0:1)} ${unit}`;}
    if(!rows.length){for(const plot of this.plots)plot.setData([[],...plot.series.slice(1).map(()=>[])]);return;}
    if(this.failed){this.$('status').textContent='WebGPU charts are unavailable in this browser. Measurements can still be saved as CSV.';return;}
    if(this.loading)return;
    if(!this.plots.length){
      this.loading=true;const epoch=this.epoch;
      try{
        if(!navigator.gpu)throw Error('WebGPU unavailable');const Plot=await loadCharts();if(epoch!==this.epoch || !this.visible)return;
        const width=Math.floor(this.$('plots').clientWidth);if(width<120)return;
        const [,series]=this.group,target=document.createElement('div');this.$('plots').append(target);
        const plot=new Plot({width,height:110,padding:[8,4,8,4],legend:{show:series.length>1,live:false},cursor:{show:false},select:{show:false},scales:{x:{time:false},y:{range:(_u,min,max)=>[0,Math.max(1,max || 1)*1.1]}},axes:[{show:false},{show:false}],series:[{show:false},...series.map(([,label,stroke])=>({label,stroke,width:1.25,points:{show:false},spanGaps:false}))]},this.history.data(series.map(([key])=>key)),target);
        this.plots.push(plot);await plot.ctx.initPromise;if(epoch!==this.epoch || !this.visible)return;if(plot.ctx.failed || !plot.ctx.ready)throw Error('WebGPU initialization failed');
      }catch{if(epoch===this.epoch){this.failed=true;this.dispose();this.$('status').textContent='WebGPU charts are unavailable in this browser. Measurements can still be saved as CSV.';}}
      finally{this.loading=false;}
      if(epoch!==this.epoch){if(this.visible && !this.failed)this.draw();return;}
    }
    if(this.failed){this.draw();return;}
    this.resize();this.plots.forEach(plot=>plot.setData(this.history.data(this.group[1].map(([key])=>key))));
  }
}
