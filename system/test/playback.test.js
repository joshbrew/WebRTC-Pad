import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {independentPlayback} from '../public/playback.js';
class Stream extends EventTarget{
  constructor(tracks=[]){super();this.tracks=[...tracks];}
  getTracks(){return [...this.tracks];}getVideoTracks(){return this.tracks.filter(t=>t.kind==='video');}getAudioTracks(){return this.tracks.filter(t=>t.kind==='audio');}
  addTrack(track){if(!this.tracks.includes(track)){this.tracks.push(track);}}
  removeTrack(track){this.tracks=this.tracks.filter(t=>t!==track);}
}
class Player extends EventTarget{
  srcObject=null;muted=true;volume=1;paused=true;hidden=false;plays=0;
  play(){const changed=this.paused;this.paused=false;this.plays++;if(changed)this.dispatchEvent(new Event('play'));return Promise.resolve();}
  pause(){this.paused=true;this.dispatchEvent(new Event('pause'));}
}
test('late/changing audio never enters or replaces the video player; mute, pause and disconnect affect audio',async()=>{
  const video=new Player(),audio=new Player(),playback=independentPlayback(video,audio,Stream),picture={kind:'video'},a={kind:'audio'},b={kind:'audio'};
  const source=new Stream([picture]);playback.bind(source);const stable=video.srcObject;
  assert.deepEqual(video.srcObject.getTracks(),[picture]);assert.equal(audio.srcObject,null);assert.equal(video.paused,false);
  source.addTrack(a);playback.refresh();assert.equal(video.srcObject,stable);assert.deepEqual(video.srcObject.getAudioTracks(),[]);assert.deepEqual(audio.srcObject.getTracks(),[a]);
  video.muted=false;video.volume=.4;video.dispatchEvent(new Event('volumechange'));await playback.play();assert.equal(audio.muted,false);assert.equal(audio.volume,.4);assert.equal(audio.paused,false);
  source.removeTrack(a);source.addTrack(b);playback.refresh();assert.equal(video.srcObject,stable);assert.deepEqual(audio.srcObject.getTracks(),[b]);
  video.pause();assert.equal(audio.paused,true);await video.play();assert.equal(audio.paused,false);
  playback.close();assert.equal(video.srcObject,null);assert.equal(audio.srcObject,null);assert.equal(audio.paused,true);
  source.addTrack(a);assert.equal(audio.srcObject,null,'Closed connections must never resume old audio');
});

test('a decoded replacement never empties either live player or changes its stream identity',()=>{
  class ContinuousStream extends Stream {
    removeTrack(track){
      super.removeTrack(track);
      if(this.mustStayLive)assert.ok(this.tracks.length,'A replacement must be attached before retiring the current track');
    }
  }
  const video=new Player(),audio=new Player(),playback=independentPlayback(video,audio,ContinuousStream);
  const source=new Stream([{kind:'video'},{kind:'audio'}]);playback.bind(source);
  const picture=video.srcObject,sound=audio.srcObject;picture.mustStayLive=sound.mustStayLive=true;
  for(let n=0;n<12;n++) {
    for(const track of source.getTracks())source.removeTrack(track);
    const nextVideo={kind:'video'},nextAudio={kind:'audio'};source.addTrack(nextVideo);source.addTrack(nextAudio);playback.refresh();
    assert.equal(video.srcObject,picture);assert.equal(audio.srcObject,sound);
    assert.deepEqual(picture.getTracks(),[nextVideo]);assert.deepEqual(sound.getTracks(),[nextAudio]);
  }
  picture.mustStayLive=sound.mustStayLive=false;playback.close();
});

test('native replacements with reused track IDs switch without detaching the video or audio player',()=>{
  class NativeStream extends Stream {
    addTrack(track){if(!this.tracks.some(t=>t.id===track.id))super.addTrack(track);}
  }
  const video=new Player(),audio=new Player(),playback=independentPlayback(video,audio,NativeStream);
  const source=new NativeStream([{id:'video',kind:'video'},{id:'audio',kind:'audio'}]);playback.bind(source);
  const picture=video.srcObject,sound=audio.srcObject;
  for(let n=0;n<5;n++){
    for(const track of source.getTracks())source.removeTrack(track);
    const nextVideo={id:'video',kind:'video'},nextAudio={id:'audio',kind:'audio'};
    source.addTrack(nextVideo);source.addTrack(nextAudio);playback.refresh();
    assert.equal(video.srcObject,picture);assert.equal(audio.srcObject,sound);
    assert.deepEqual(picture.getTracks(),[nextVideo]);assert.deepEqual(sound.getTracks(),[nextAudio]);
  }
  playback.close();
});
test('controller worker coalesces ticks while the page is stalled instead of queueing old work',()=>{
  let tick,interval,notifications=0;const context=vm.createContext({onmessage:null,setInterval:(callback,ms)=>{tick=callback;interval=ms;},postMessage:()=>notifications++});
  vm.runInContext(fs.readFileSync(new URL('../public/input-clock.js',import.meta.url),'utf8'),context);
  assert.ok(interval<=1000/120,'Sample controller changes between 60 Hz video frames');
  for(let n=0;n<100;n++)tick();assert.equal(notifications,1);
  context.onmessage({data:'ack'});tick();assert.equal(notifications,2);tick();assert.equal(notifications,2);
});

test('audio-only playback works before video and survives picture removal without stale pause events silencing it',async()=>{
  const video=new Player(),audio=new Player(),playback=independentPlayback(video,audio,Stream),sound={kind:'audio'},picture={kind:'video'};
  const stream=new Stream([sound]);playback.bind(stream);
  assert.equal(video.srcObject,null);assert.equal(audio.paused,false);assert.equal(audio.muted,true);
  video.muted=false;video.dispatchEvent(new Event('volumechange'));await playback.play();assert.equal(audio.muted,false);
  stream.addTrack(picture);playback.refresh();assert.equal(video.paused,false);
  stream.removeTrack(picture);playback.refresh();video.dispatchEvent(new Event('pause'));
  assert.equal(video.srcObject,null);assert.equal(audio.paused,false,'A late video pause must not silence an audio-only stream');
  playback.close();assert.equal(audio.paused,true);assert.equal(audio.srcObject,null);
});

test('hiding the picture preserves sound without playing hidden video, including late audio',async()=>{
  const video=new Player(),audio=new Player(),playback=independentPlayback(video,audio,Stream),sound={kind:'audio'},picture={kind:'video'};
  const stream=new Stream([picture,sound]);playback.bind(stream);video.muted=false;await playback.play();
  video.hidden=true;video.pause();playback.refresh();assert.equal(video.paused,true);assert.equal(audio.paused,false);assert.equal(audio.muted,false);
  await playback.play();assert.equal(video.paused,true,'Unmuting must not restart a hidden picture');
  stream.removeTrack(sound);playback.refresh();assert.equal(audio.srcObject,null);
  stream.addTrack(sound);playback.refresh();assert.equal(audio.paused,false);assert.equal(video.paused,true);
  video.hidden=false;await video.play();video.pause();assert.equal(audio.paused,true,'Pausing visible playback still pauses sound');
  playback.close();
});

test('unmuted audio reports browser autoplay rejection and a successful user retry clears it',async()=>{
  const video=new Player(),audio=new Player();video.muted=false;
  audio.play=()=>Promise.reject(new DOMException('Needs a click','NotAllowedError'));
  const playback=independentPlayback(video,audio,Stream);let changes=0;audio.addEventListener('shared-audio-playback',()=>changes++);
  playback.bind(new Stream([{kind:'audio'}]));await playback.play();
  assert.equal(audio.muted,false);assert.equal(audio.playbackBlocked,true);
  audio.play=Player.prototype.play;await playback.play();
  assert.equal(audio.playbackBlocked,false);assert.equal(audio.paused,false);assert.equal(changes,2);playback.close();
});
