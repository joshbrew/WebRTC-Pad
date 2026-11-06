import {test} from 'node:test';
import assert from 'node:assert/strict';
import {HostViewPopouts,GuestViewPopouts} from '../public/view-popouts.js';

test('a delayed close cannot terminate a newer subscription to the same view',async()=>{
  const host=new HostViewPopouts({}),pc={close(){this.closed=true;}};
  host.entries.set('peer:view',{requestId:'new',pc});
  await host.handle({},'peer',{type:'view-close',sourceId:'view',requestId:'old'});
  assert.equal(host.entries.size,1);assert.equal(pc.closed,undefined);
  await host.handle({},'peer',{type:'view-close',sourceId:'view',requestId:'new'});
  assert.equal(host.entries.size,0);assert.equal(pc.closed,true);
});

test('late offers and errors from a removed tile cannot replace a re-opened view',async()=>{
  const oldWindow=globalThis.window;globalThis.window={addEventListener(){}};
  try{
    const guest=new GuestViewPopouts({send(){},status(){}}),entry=guest.entry('view');entry.pc={close(){this.closed=true;}};
    for(const type of ['view-error','view-offer'])await guest.handle({type,sourceId:'view',requestId:'previous',error:'old failure'});
    assert.equal(entry.pc.closed,undefined);assert.equal(entry.noteText,'Connecting… · video only');
    await guest.handle({type:'view-error',sourceId:'view',requestId:entry.requestId,error:'current failure'});
    assert.equal(entry.pc.closed,true);assert.equal(entry.noteText,'current failure');
  }finally{globalThis.window=oldWindow;}
});


test('reopening a view supersedes its previous lifetime even before the old close arrives',async()=>{
  const offers=[],p={control:{readyState:'open',send:raw=>offers.push(JSON.parse(raw))}};
  const host=new HostViewPopouts({source:()=>({kind:'native'}),quality:()=>({codec:'h264'}),nativeCommand:async()=>({sdp:{type:'offer',sdp:'fixture'},ice:{iceServers:[]}})});
  try{
    await host.handle(p,'peer',{type:'view-open',sourceId:'view',requestId:'old'});
    const oldToken=host.entries.get('peer:view').token;
    await host.handle(p,'peer',{type:'view-open',sourceId:'view',requestId:'new'});
    assert.equal(host.entries.get('peer:view').requestId,'new');assert.notEqual(host.entries.get('peer:view').token,oldToken);
    assert.deepEqual(offers.filter(m=>m.type==='view-offer').map(m=>m.requestId),['old','new']);
    await host.handle(p,'peer',{type:'view-close',sourceId:'view',requestId:'old'});assert.equal(host.entries.size,1);
  }finally{host.closePeer(p);}
});
