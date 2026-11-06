// Video and audio have separate players: an audio playout buffer must not hold
// the latest game picture. The combined source remains owned by the connection.
export function independentPlayback(video,audio,Stream=MediaStream){
  const picture=new Stream(),sound=new Stream();let source=null,closed=false;
  const copy=(target,tracks)=>{
    // Native connections reuse track IDs. MediaStream.addTrack ignores a
    // replacement with an ID already present, even if it is a new object.
    // Replace those collisions in one turn without detaching the player.
    for(const track of target.getTracks())if(!tracks.includes(track) && track.id && tracks.some(next=>next.id===track.id))target.removeTrack(track);
    for(const track of tracks)if(!target.getTracks().includes(track))target.addTrack(track);
    for(const track of target.getTracks())if(!tracks.includes(track))target.removeTrack(track);
  };
  const syncVolume=()=>{audio.muted=video.muted;audio.volume=video.volume;};
  const blocked=value=>{if(audio.playbackBlocked===value)return;audio.playbackBlocked=value;audio.dispatchEvent(new Event('shared-audio-playback'));};
  const quietPlay=element=>{
    if(!element.srcObject?.getTracks().length)return Promise.resolve();
    const failed=error=>{if(element===audio && error?.name==='NotAllowedError' && !audio.muted)blocked(true);};
    try{return Promise.resolve(element.play()).then(()=>{if(element===audio)blocked(false);},failed);}catch(error){failed(error);return Promise.resolve();}
  };
  const playAudio=()=>{syncVolume();return quietPlay(audio);};
  const pauseAudio=()=>{if(picture.getTracks().length && !video.hidden)audio.pause();};
  const refresh=()=>{
    if(closed)return;
    copy(picture,source?.getVideoTracks() || []);copy(sound,source?.getAudioTracks() || []);
    const nextVideo=picture.getTracks().length?picture:null,nextAudio=sound.getTracks().length?sound:null;
    if(video.srcObject!==nextVideo)video.srcObject=nextVideo;
    if(audio.srcObject!==nextAudio)audio.srcObject=nextAudio;
    syncVolume();if(nextVideo && !video.hidden)quietPlay(video);
    if(nextAudio && (!nextVideo || video.hidden || !video.paused))playAudio();else if(!nextAudio)audio.pause();
  };
  video.addEventListener('volumechange',syncVolume);video.addEventListener('play',playAudio);video.addEventListener('pause',pauseAudio);
  const bind=stream=>{
    source?.removeEventListener('addtrack',refresh);source?.removeEventListener('removetrack',refresh);source=stream;
    source?.addEventListener('addtrack',refresh);source?.addEventListener('removetrack',refresh);refresh();
  };
  return {bind,refresh,async play(){await Promise.all([video.hidden?Promise.resolve():quietPlay(video),playAudio()]);},close(){
    bind(null);closed=true;audio.pause();audio.srcObject=null;video.srcObject=null;
    video.removeEventListener('volumechange',syncVolume);video.removeEventListener('play',playAudio);video.removeEventListener('pause',pauseAudio);
  }};
}
