export const diagnosticFields=['inputMs','rttMs','bufferMs','decodeMs','fps','mbps','lossPercent'];

// A short, bounded recording. Missing measurements stay gaps, never zeroes.
export class DiagnosticHistory{
  constructor(limit=120){this.limit=limit;this.rows=[];this.started=null;}
  push(values,time=performance.now()){
    this.started ??= time;
    const row={seconds:Math.max(0,(time-this.started)/1000)};
    for(const key of diagnosticFields)row[key]=typeof values[key]==='number' && Number.isFinite(values[key]) && values[key]>=0?values[key]:null;
    if(this.rows.length && row.seconds<=this.rows.at(-1).seconds)row.seconds=this.rows.at(-1).seconds+.001;
    this.rows.push(row);if(this.rows.length>this.limit)this.rows.shift();return row;
  }
  clear(){this.rows=[];this.started=null;}
  data(keys){return [this.rows.map(r=>r.seconds),...keys.map(key=>this.rows.map(r=>r[key]))];}
  csv(){return ['seconds,'+diagnosticFields.join(','),...this.rows.map(row=>[row.seconds.toFixed(3),...diagnosticFields.map(key=>row[key]===null?'':row[key])].join(','))].join('\r\n')+'\r\n';}
}
