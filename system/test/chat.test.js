import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ChatHistory,SessionChat,chatLink,chatText,chatLimit} from '../public/chat.js';
const entry=seq=>({seq,author:'author-a',name:'Guest 1',text:`Hello ${seq}`,time:Date.now()});

test('call chat keeps a bounded, ordered, deduplicated memory history and UTF-8-sized handoff tail',()=>{
  const history=new ChatHistory();history.reset('call');history.merge(Array.from({length:200},(_,i)=>entry(i+1)).reverse());history.merge([entry(200),{...entry(201),text:''}]);assert.equal(history.entries.length,chatLimit);assert.equal(history.entries[0].seq,101);assert.ok(history.complete(200));assert.equal(history.complete(201),false);
  history.entries.forEach(e=>e.text='🎮'.repeat(500));assert.ok(new TextEncoder().encode(JSON.stringify(history.tail())).length<=16000);
  assert.equal(chatText(' \u0000Hello\nfriend\u0007 '),'Hello\nfriend');assert.equal(chatText('a'.repeat(2000)).length,1000);assert.equal(chatText('\ud800'),'\ufffd');assert.equal(chatText('a'.repeat(999)+' xyz'),'a'.repeat(999));history.reset();assert.equal(history.entries.length,0);assert.equal(history.epoch,null);
});
test('chat channel backpressure queues history and stops cleanly without dropping queued posts',()=>{
  const channel=Object.assign(new EventTarget(),{readyState:'open',bufferedAmount:65536,sent:[],send(raw){this.sent.push(JSON.parse(raw));}}),received=[];const link=chatLink(channel,msg=>received.push(msg));
  assert.ok(link.send({action:'history',entries:[entry(1)]}));assert.ok(link.send({action:'post',text:'hello'}));assert.equal(channel.sent.length,0);channel.bufferedAmount=0;channel.dispatchEvent(new Event('bufferedamountlow'));assert.deepEqual(channel.sent.map(m=>m.action),['history','post']);
  channel.onmessage({data:'not json'});channel.onmessage({data:JSON.stringify({action:'ok'})});assert.equal(received.length,1);link.stop();assert.equal(link.send({action:'post'}),false);
});
test('host stamps chat authors and sequence, deduplicates posts, limits bursts and locks during handoff',()=>{
  const sent=[],room=Object.assign(Object.create(SessionChat.prototype),{ready:true,host:true,history:new ChatHistory(),authors:new Map([['guest',{author:'real-author',name:'Guest 1'}]]),links:new Map([['guest',{send:m=>sent.push(m)}]]),render(){},arrived(){}});room.history.reset('call');
  const packet={request:'req-1',text:'hello',author:'spoofed',name:'Host',seq:100};room.accept('unknown',packet);room.accept('guest',packet);room.accept('guest',packet);assert.equal(room.history.entries.length,1);assert.equal(room.history.entries[0].author,'real-author');assert.equal(room.history.entries[0].name,'Guest 1');assert.equal(room.history.entries[0].seq,1);
  for(let i=2;i<20;i++)room.accept('guest',{request:`req-${i}`,text:'hey'});assert.equal(room.history.entries.length,10);assert.equal(sent.at(-1).action,'error');room.locked=true;room.accept('guest',{request:'locked',text:'hi'});assert.equal(room.history.entries.length,10);
});
test('a promoted host recovers missing history only from the previous host',()=>{
  const history=new ChatHistory();history.reset('call');const rows=Array.from({length:100},(_,i)=>entry(i+1));
  const room=Object.assign(Object.create(SessionChat.prototype),{history,self:'author-b',links:new Map(),peek:{},render(){}});
  room.rebase({host:true,mapping:{host:'previous','guest-b':'host'},snapshot:{epoch:'call',cursor:100,tail:rows.slice(-8),authors:[{id:'host',author:'author-a',name:'Host'},{id:'guest-b',author:'author-b',name:'Guest 1'}]},stage:{append(){}}});
  assert.equal(room.recovering,true);room.receiveHost('other',{action:'recovery-history',epoch:'call',entries:rows.slice(0,8)});assert.equal(room.history.entries.length,8);
  for(let i=0;i<100;i+=8)room.receiveHost('previous',{action:'recovery-history',epoch:'call',entries:rows.slice(i,i+8)});room.receiveHost('previous',{action:'recovery-ready',epoch:'call',cursor:100});assert.equal(room.recovering,false);assert.ok(room.history.complete(100));assert.equal(room.self,'author-b');assert.equal(room.authors.get('host').name,'Host');
});
