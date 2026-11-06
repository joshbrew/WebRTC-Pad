// Optional hosted signaling. File pairing stays the default without configuration.
export function inviteLink(server, token) {
  const url = new URL(server); url.search = '?mode=join'; url.hash = `invite=${token}`; return url.href;
}
export function parseSessionLink(value, server) {
  let url;try{url=new URL(value);}catch{throw Error('Paste the full session link your host sent.');}
  const token = new URLSearchParams(url.hash.slice(1)).get('invite');
  if (url.origin !== new URL(server).origin || !/^[a-f0-9]{64}$/.test(token || '')) throw Error('Use an invite link from your configured invite server.');
  return token;
}
export class SessionInvites {
  constructor(callbacks) {
    this.callbacks = callbacks; this.pending = new Map(); this.queue = Promise.resolve(); this.hostActive = false;this.hostGeneration=0;
  }
  createUI() {
    const create = (id, content) => { const node = document.createElement('section'); node.id = id; node.className = 'sidebar-card session-card'; node.hidden = true; node.innerHTML = content; return node; };
    this.connection = create('sessionConnection', '<div class="section-heading"><h3>Online invites</h3><span id="sessionIdentity" class="status-pill is-live" hidden></span></div><div class="session-signin"><label>Temporary name (optional)<input id="sessionName" maxlength="24" autocomplete="off" placeholder="Leave blank for a guest name" /></label><button id="sessionConnect" class="button">Go online</button></div><p id="sessionStatus" class="small" role="status">Connect to send or receive an invite. No account needed.</p><div id="sessionIncoming"></div><details class="advanced"><summary>Server details</summary><p id="sessionServerAddress" class="small muted"></p><p class="small muted">Temporary names last while this sign-in is active. Friends must use the same invite server.</p></details>');
    document.querySelector('main').before(this.connection);
    this.host = create('sessionHostInvite', '<h3>Invite friends</h3><div id="sessionHostActions"><p class="small muted">Share a session link, or invite someone by their temporary name on this server.</p><button id="sessionCreateLink" class="button primary full">Create session link</button><div id="sessionLinkReady" hidden><label class="field-label" for="sessionShareLink">Session link</label><input id="sessionShareLink" readonly /><button id="sessionCopyLink" class="button full" disabled>Copy session link</button><p class="small muted">People with this link ask to join. You choose who to accept. The link ends when you stop the session.</p></div><details class="advanced"><summary>Invite someone by temporary name</summary><label class="field-label" for="sessionRecipient">Their name on this invite server</label><input id="sessionRecipient" maxlength="24" placeholder="Your friend’s name on this server" /><button id="sessionInviteName" class="button full">Send direct invite</button></details><div id="sessionJoinRequests" aria-live="polite"></div></div><button id="sessionUseFiles" class="button small-button">Use invite/reply files instead</button>');
    document.querySelector('#hostInviteCard').before(this.host);
    this.guest = create('sessionGuestInvite', '<h3>Join with a session link</h3><label class="field-label" for="sessionInviteLink">Invite link</label><input id="sessionInviteLink" type="url" placeholder="Paste your host’s session link" /><button id="sessionJoinLink" class="button primary full">Ask to join</button><button id="sessionCancelJoin" class="button full" hidden>Cancel request</button><p id="sessionJoinStatus" class="small" role="status">Your host accepts the request. The connection reply is sent automatically.</p><button id="sessionGuestFiles" class="button small-button">Use an invite file instead</button>');
    document.querySelector('#clientPairing').before(this.guest);
    this.$ = id => document.getElementById(id);
    this.originalButtons=new Map(['joinFocus','joinStepInvite','joinStepReply'].map(id=>[id,this.$(id).innerHTML]));
    for(const id of this.originalButtons.keys())this.$(id).addEventListener('click',event=>{
      if(!this.url || this.guestFiles)return;event.preventDefault();event.stopImmediatePropagation();
      const target=this.$(id==='joinStepReply'?'sessionJoinStatus':'sessionInviteLink');for(let parent=target.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;target.scrollIntoView({block:'center',behavior:'smooth'});target.focus();
    },true);
    const action = (id, handler) => { this.$(id).onclick = async () => { const button = this.$(id); button.disabled = true; try { await handler(); } catch (error) { this.status(error.message);if(id==='sessionJoinLink')this.$('sessionJoinStatus').textContent=error.message; } finally { button.disabled = id==='sessionConnect' && !!this.user;this.update(); } }; };
    action('sessionConnect', () => this.connect());
    action('sessionCreateLink', () => this.createRoom());
    action('sessionCopyLink', async () => {
      const field=this.$('sessionShareLink');
      try{await navigator.clipboard.writeText(field.value);this.status('Link copied. Send it to your friends.');}
      catch{field.focus();field.select();this.status('The link is selected. Copy it, then send it to your friends.');}
    });
    action('sessionInviteName', async () => { await this.createRoom(); const result = await this.request({ type: 'invite', roomId: this.roomId, to: this.$('sessionRecipient').value }); this.status(`Invite sent to ${result.name}. They choose whether to join.`); });
    action('sessionJoinLink', () => this.join(parseSessionLink(this.$('sessionInviteLink').value, this.url)));
    this.$('sessionUseFiles').onclick = () => { this.files = !this.files; this.update();document.dispatchEvent(new CustomEvent('quick-start',{detail:'refresh'})); };
    this.$('sessionGuestFiles').onclick = () => { if(!this.guestFiles)this.cancelJoin();this.guestFiles = !this.guestFiles; this.update();document.dispatchEvent(new CustomEvent('quick-start',{detail:'refresh'})); };
    this.$('sessionCancelJoin').onclick=()=>this.cancelJoin();
    document.querySelector('#hostEnd').addEventListener('click', () => this.endHosting());
    document.addEventListener('quick-start', () => this.update());
    this.uiReady=true;
  }
  configure(settings) {
    if (!settings) return;
    this.url = settings.hosted ? location.origin : settings.url;
    if (!this.url) return;
    if(!this.uiReady)this.createUI();
    this.hosted = settings.hosted; this.connection.hidden = false;
    try{if(!this.resume)this.resume=sessionStorage.getItem(`webrtc-pad:session-signin:${this.url}`);}catch{/* Optional session storage. */}
    this.$('sessionServerAddress').textContent = this.url;
    if (this.hosted) { document.querySelector('#modeHost').hidden = true;document.querySelector('.app-footer span:last-child').textContent='Hosted join page · WebRTC connection'; this.callbacks.showClient(); }
    try { const token = parseSessionLink(location.href, this.url); this.$('sessionInviteLink').value = inviteLink(this.url, token); this.callbacks.showClient(); } catch { /* Ordinary app launch. */ }
    this.update();document.dispatchEvent(new Event('mobile-layout'));
  }
  status(message) { if(this.uiReady && this.$('sessionStatus').textContent!==message)this.$('sessionStatus').textContent = message; }
  notify(action){document.dispatchEvent(new CustomEvent('quick-start',{detail:action}));}
  update() {
    if (!this.url || !this.uiReady) return;
    document.body.dataset.sessionInvites = 'true';
    document.body.dataset.sessionOnline=String(!!this.user);
    this.$('sessionCopyLink').disabled=!this.user || !this.roomId;
    document.body.dataset.sessionHostFiles=this.files?'true':'false';document.body.dataset.sessionGuestFiles=this.guestFiles?'true':'false';
    document.body.dataset.sessionJoinPending=String(!!this.pendingJoin);
    this.host.hidden = !this.hostActive || !!this.files;
    this.$('sessionHostActions').hidden = !!this.files;
    this.$('sessionUseFiles').textContent = this.files ? 'Use session links instead' : 'Use invite/reply files instead';
    document.querySelector('#hostInviteCard').hidden = !this.files || !this.hostActive;
    const fileButton=this.$('sessionUseFiles'),fileParent=this.files?document.querySelector('#hostInviteCard'):this.host;
    if(fileButton.parentElement!==fileParent){if(this.files)fileParent.prepend(fileButton);else fileParent.append(fileButton);}
    this.guest.hidden = false;
    this.$('sessionCancelJoin').hidden=!this.pendingJoin;
    document.querySelector('#clientPairing').hidden = !this.guestFiles;
    this.$('sessionGuestFiles').textContent = this.guestFiles ? 'Hide invite file options' : 'Use an invite file instead';
    if(this.renderedGuestFiles!==!!this.guestFiles){
      for(const [id,original] of this.originalButtons)this.$(id).innerHTML=this.guestFiles?original:id==='joinStepReply'?'2 · Wait for host':id==='joinStepInvite'?'1 · Paste session link':'Paste a session link';
      this.renderedGuestFiles=!!this.guestFiles;
    }
    this.connection.classList.toggle('session-online',!!this.user);this.$('sessionIdentity').hidden=!this.user;
    if(!this.guestFiles && document.querySelector('#clientConnectionText').textContent!=='Connected'){
      this.$('clientStageTitle').textContent=this.pendingJoin?'Waiting for your host':'Join your host’s session';
      this.$('clientStageNote').textContent=this.pendingJoin?'Your host needs to accept your request. Keep this page open, or click Cancel request to withdraw.':'Paste the session link, or accept a direct invite from your host. Connection replies are sent automatically.';
    }
  }
  async connect() {
    if (!this.url) throw Error('Configure SESSION_SERVER_URL first.');
    if (this.ws?.readyState === WebSocket.OPEN && this.user) return;
    if (this.connecting) return this.connecting;
    this.status('Connecting to the invite server…'); this.stopping = false;
    this.connecting = new Promise((resolve, reject) => {
      const address = new URL('/sessions', this.url); address.protocol = address.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(address); this.ws = ws;let welcomed=false;
      const timer = setTimeout(() => { reject(Error('Invite server did not answer. Check its URL and HTTPS setup.')); ws.close(); }, 10000);
      ws.onopen = () => ws.send(JSON.stringify({ type: 'hello', name: this.$('sessionName').value, ...(this.resume ? { resume: this.resume } : {}) }));
      ws.onmessage = event => {
        let message; try { message = JSON.parse(event.data); } catch { return; }
        if (message.type === 'welcome') {
          clearTimeout(timer);welcomed=true;this.retryDelay=1500; this.user = message.userId; this.resume = message.resume;
          const lostRoom=this.roomId && this.roomId!==message.roomId;
          if(lostRoom)this.clearHostInvite();
          if(message.roomId && (!this.hostActive || this.roomId!==message.roomId))this.send({type:'leave',roomId:message.roomId});
          try{sessionStorage.setItem(`webrtc-pad:session-signin:${this.url}`,this.resume);}catch{/* Optional session storage. */}
          this.$('sessionName').value = message.name; this.$('sessionName').disabled = true;this.$('sessionIdentity').textContent=`Online · ${message.name}`;
          this.$('sessionConnect').textContent = 'Online';this.$('sessionConnect').disabled=true; this.status(lostRoom?'Your old invite expired. Create a new session link. Connected players can keep playing.':'Ready to send and receive invitations.');document.dispatchEvent(new CustomEvent('quick-start',{detail:'session-online'})); resolve(); return;
        }
        if (message.type === 'session-error') {
          const error = Error(message.error), pending = this.pending.get(message.requestId);
          if (pending) { this.pending.delete(message.requestId); pending.reject(error); }
          else this.status(error.message);
          if (!this.user) { clearTimeout(timer);if(this.resume){this.clearHostInvite();this.pendingJoin=false;this.joinedRoom=this.activeGuestRoom || null;error.message='Your invitation access expired. Click Go online to reconnect. An existing game connection can continue.';this.status(error.message);this.update();} this.resume = null;this.$('sessionName').disabled=false;try{sessionStorage.removeItem(`webrtc-pad:session-signin:${this.url}`);}catch{} reject(error); ws.close(); }
          return;
        }
        const pending = this.pending.get(message.requestId);
        if (pending) { this.pending.delete(message.requestId); pending.resolve(message); return; }
        this.queue = this.queue.catch(() => {}).then(() => this.receive(message)).catch(error => this.status(error.message));
      };
      ws.onerror = () => { clearTimeout(timer); reject(Error('Cannot reach the invite server. Check its address and HTTPS setup.')); };
      ws.onclose = event => {
        if(!welcomed)reject(Error('Invite server closed the connection. Try Go online again.'));
        clearTimeout(timer);if(this.ws!==ws)return; this.user = null;this.update();this.notify('refresh');
        this.$('sessionConnect').disabled=false;this.$('sessionConnect').textContent='Go online';
        for (const pending of this.pending.values()) pending.reject(Error('Invite server disconnected.')); this.pending.clear();
        if(event.code===1000 && event.reason==='Resumed in another window'){this.stopping=true;this.status('This temporary sign-in moved to another window.');}
        if (!this.stopping && this.resume) { this.status('Invite server disconnected. Reconnecting… Gameplay can continue peer to peer.'); clearTimeout(this.retry);const delay=this.retryDelay || 1500;this.retryDelay=Math.min(delay*2,15000); this.retry = setTimeout(() => this.connect().catch(error => this.status(error.message)), delay); }
      };
    }).finally(() => { this.connecting = null; });
    await this.connecting;
  }
  request(message) {
    if (this.ws?.readyState !== WebSocket.OPEN || !this.user) return Promise.reject(Error('Go online on the invite server first.'));
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(requestId); reject(Error('Invite server request timed out.')); }, 12000);
      this.pending.set(requestId, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
      this.ws.send(JSON.stringify({ ...message, requestId }));
    });
  }
  send(message) { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message)); }
  hostStarted() { this.hostGeneration++;this.hostActive = true; this.update(); }
  clearHostInvite(){this.roomId=null;if(!this.uiReady)return;this.$('sessionShareLink').value='';this.$('sessionCopyLink').disabled=true;this.$('sessionCreateLink').hidden=false;this.$('sessionLinkReady').hidden=true;this.$('sessionJoinRequests').replaceChildren();}
  endHosting() { this.hostGeneration++;if (this.roomId) this.send({ type: 'leave', roomId: this.roomId }); this.hostActive = false;this.clearHostInvite();this.update(); }
  async createRoom() {
    if (!this.hostActive) throw Error('Start a session on this computer first.');
    const generation=this.hostGeneration;
    // A new host session waits for an old request's cleanup before creating its
    // link, so an abandoned response cannot revoke the new session's room.
    const task=Promise.resolve(this.roomCreation).catch(()=>{}).then(async()=>{
      const current=()=>this.hostActive && this.hostGeneration===generation;
      if(!current())throw Error('Hosting stopped. Start a session before creating a link.');
      await this.connect();
      if(!current())throw Error('Hosting stopped. Start a session before creating a link.');
      const room=await this.request({type:'create'});
      if(!current()){this.send({type:'leave',roomId:room.roomId});throw Error('Hosting stopped. The unused invite was closed.');}
      this.roomId=room.roomId;
      this.$('sessionShareLink').value=inviteLink(this.url,room.token);this.$('sessionCopyLink').disabled=false;
      this.$('sessionCreateLink').hidden=true;this.$('sessionLinkReady').hidden=false;this.$('sessionCopyLink').classList.add('primary');
      this.notify('refresh');this.status('Session link ready. Copy it for friends, or invite a temporary name.');
    });
    this.roomCreation=task;
    try{await task;}finally{if(this.roomCreation===task)this.roomCreation=null;}
  }
  async join(token) {
    this.callbacks.showClient(); await this.connect();
    const result = await this.request({ type: 'join', token });
    if(this.joinedRoom && this.joinedRoom!==result.roomId && this.joinedRoom!==this.activeGuestRoom)this.send({type:'leave',roomId:this.joinedRoom});
    this.joinedRoom = result.roomId;this.pendingJoin=this.joinedRoom!==this.activeGuestRoom;
    this.$('sessionJoinStatus').textContent = 'Request sent. Waiting for your host…';
    this.update();
    this.notify('session-requested');
  }
  cancelJoin(){
    if(!this.pendingJoin)return;
    if(this.joinedRoom && this.joinedRoom!==this.activeGuestRoom)this.send({type:'leave',roomId:this.joinedRoom});
    this.joinedRoom=this.activeGuestRoom || null;this.pendingJoin=false;
    this.$('sessionJoinStatus').textContent='Request cancelled. You can ask to join again when ready.';this.update();
    this.notify('session-request-cancelled');
  }
  leaveGuest() { for(const roomId of new Set([this.joinedRoom,this.activeGuestRoom]))if(roomId)this.send({type:'leave',roomId}); this.joinedRoom = null;this.activeGuestRoom=null;this.pendingJoin=false;if(this.uiReady)this.update(); }
  rejectGuest(guestId){if(this.roomId)this.send({type:'reject',roomId:this.roomId,guestId});this.status('Guest removed. Send another invite when you are ready.');}
  async receive(message) {
    if (message.type === 'invited') {
      const row = document.createElement('div'), text = document.createElement('p'), accept = document.createElement('button'), decline = document.createElement('button');
      text.textContent = `${message.name} invited you to play.`; accept.textContent = 'Accept invite'; decline.textContent = 'Dismiss'; accept.className = 'button primary'; decline.className = 'button';
      accept.onclick = async () => { try { await this.join(message.token); row.remove(); } catch (error) { this.status(error.message); } }; decline.onclick = () => row.remove();
      row.append(text, accept, decline); this.$('sessionIncoming').append(row);this.notify('session-invited'); return;
    }
    if (message.type === 'join-request' && message.roomId === this.roomId) {
      if([...this.$('sessionJoinRequests').children].some(row=>row.dataset.guestId===message.guestId))return;
      this.status(`${message.name} is asking to join. Accept or decline below.`);
      const row = document.createElement('div'), text = document.createElement('p'), accept = document.createElement('button'), decline = document.createElement('button');
      row.dataset.guestId = message.guestId; text.textContent = `${message.name} wants to join.`; accept.textContent = 'Accept guest'; decline.textContent = 'Decline'; accept.className = 'button primary'; decline.className = 'button';
      accept.onclick = () => { this.send({ type: 'accept', roomId: this.roomId, guestId: message.guestId }); row.remove(); }; decline.onclick = () => { this.send({ type: 'reject', roomId: this.roomId, guestId: message.guestId }); row.remove(); };
      row.append(text,accept,decline);this.$('sessionJoinRequests').append(row);this.notify('guest-requested'); return;
    }
    if (message.type === 'guest-accepted' && message.roomId === this.roomId) {
      const payload = await this.callbacks.offer(message.guestId, message.name);
      this.send({ type: 'signal', roomId: this.roomId, guestId: message.guestId, payload }); this.status(`Connecting ${message.name}…`); return;
    }
    if (message.type === 'signal') {
      if (message.payload?.kind === 'offer' && message.roomId === this.joinedRoom) {
        this.pendingJoin=false;this.update();
        let payload;
        try{payload=await this.callbacks.answer(message.payload);}catch(error){if(this.joinedRoom!==message.roomId)return;throw error;}
        if(this.joinedRoom!==message.roomId)return;
        if(this.activeGuestRoom && this.activeGuestRoom!==message.roomId)this.send({type:'leave',roomId:this.activeGuestRoom});this.activeGuestRoom=message.roomId;
        this.send({ type: 'signal', roomId: message.roomId, payload }); this.$('sessionJoinStatus').textContent = 'Reply sent automatically. Connecting…';
      } else if (message.payload?.kind === 'answer' && message.roomId === this.roomId) {
        await this.callbacks.accept(message.payload,message.guestId); this.status(`${message.name} is connecting. Ask them to press a controller button to join.`);
      }
      return;
    }
    if (message.type === 'guest-left' && message.roomId === this.roomId) {for(const row of this.$('sessionJoinRequests').children)if(row.dataset.guestId===message.guestId)row.remove();if(message.reason!=='guest-offline')this.callbacks.remove(message.guestId);}
    if (['session-ended','join-rejected'].includes(message.type) && [this.joinedRoom,this.activeGuestRoom].includes(message.roomId)) {
      this.pendingJoin=false;
      const active=message.roomId===this.activeGuestRoom;if(active)this.activeGuestRoom=null;
      if(message.roomId===this.joinedRoom)this.joinedRoom=this.activeGuestRoom || null;
      const expired=message.type==='session-ended' && message.reason==='host-offline';
      this.$('sessionJoinStatus').textContent=expired?active?'The invite expired while the host was offline. Your game connection stays open.':'The invite expired while the host was offline. Ask for a fresh link.':message.type==='session-ended'?'The host ended this session. Ask for a new link.':'The host declined or ended this connection.';
      if(active && !expired && !this.handoffActive)this.callbacks.ended();
      this.update();
    }
  }
}
