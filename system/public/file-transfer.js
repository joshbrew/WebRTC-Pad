// Files have their own reliable, low-priority channel. Offers contain metadata
// only; bytes are sent only after Receive and never written or opened remotely.
export const fileLimit = 64 * 1024 * 1024, fileChunk = 8192;
export function fileUploadAllowed(peer,now=performance.now()){
  if(!peer || peer.pc?.connectionState!=='connected' || (peer.channel?.bufferedAmount || 0)>4096 || (peer.control?.bufferedAmount || 0)>8192)return false;
  const metrics=now-(peer.cameraPressureAt || 0)<5000?peer.cameraPressure:null;
  return !metrics || !(metrics.loss>.03 || metrics.bufferMs>150 || metrics.rttMs>350 || metrics.freezeMs>500);
}
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
export function fileOffer(value) {
  if (!uuid(value?.id) || !Number.isSafeInteger(value.size) || value.size < 0 || value.size > fileLimit || typeof value.name !== 'string') return null;
  const name = value.name.split(/[\\/]/).at(-1).replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 180);
  return name ? { id: value.id, size: value.size, name } : null;
}
export function filePacket(route, index, bytes) {
  const packet = new Uint8Array(40 + bytes.byteLength);
  packet.set(new TextEncoder().encode(route)); new DataView(packet.buffer).setUint32(36, index); packet.set(new Uint8Array(bytes), 40); return packet.buffer;
}
export function readFilePacket(buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 40 || buffer.byteLength > fileChunk + 40) return null;
  const route = new TextDecoder().decode(new Uint8Array(buffer, 0, 36));
  return uuid(route) ? { route, index: new DataView(buffer).getUint32(36), bytes: buffer.slice(40) } : null;
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
export class FileTransfers {
  constructor({ host = false, changed = () => {}, clipboard = () => {} } = {}) {
    Object.assign(this, { host, changed, clipboard }); this.links = new Map(); this.offers = new Map(); this.routes = new Map(); this.policy = { files: true, clipboard: false }; this.active = true;
  }
  send(peer, message) { const ch = this.links.get(peer)?.channel; if (ch?.readyState !== 'open' || ch.bufferedAmount > 32768) return false; try { ch.send(typeof message === 'object' && !(message instanceof ArrayBuffer) ? JSON.stringify(message) : message); return true; } catch { return false; } }
  broadcast(message, except) { for (const id of this.links.keys()) if (id !== except) this.send(id, message); }
  attach(id, channel, name = 'Guest') {
    this.removePeer(id); channel.binaryType = 'arraybuffer'; this.links.set(id, { channel, name: String(name).slice(0, 48) });
    channel.onmessage = event => {
      if (this.links.get(id)?.channel !== channel) return;
      if (event.data instanceof ArrayBuffer) { this.chunk(id, event.data); return; }
      if (typeof event.data !== 'string' || event.data.length > 18000) return;
      try { this.receive(id, JSON.parse(event.data)); } catch { /* Invalid peer data is ignored. */ }
    };
    channel.onclose = () => { if (this.links.get(id)?.channel === channel) this.removePeer(id); };
    if (this.host) this.send(id, { type: 'policy', ...this.policy });
    if (this.policy.files) for (const offer of this.offers.values()) if (this.host || offer.owner === 'self') this.send(id, { type: 'offer', ...fileOffer(offer), author: offer.author });
    this.changed();
  }
  setPolicy(policy) {
    this.policy = { files: policy.files === true, clipboard: policy.clipboard === true };
    if (!this.policy.files) { for (const route of [...this.routes.keys()]) this.cancel(route, 'File sharing turned off.'); for (const offer of this.offers.values()) if (offer.url) URL.revokeObjectURL(offer.url); this.offers.clear(); }
    if (this.host) this.broadcast({ type: 'policy', ...this.policy }); this.changed();
  }
  offer(file) {
    if (!this.active || !this.policy.files || this.offers.size >= 32 || [...this.offers.values()].filter(o => o.owner === 'self').length >= 8) throw Error('Remove an earlier file before adding another.');
    const meta = fileOffer({ id: crypto.randomUUID(), name: file.name, size: file.size });
    if (!meta) throw Error('Choose a file up to 64 MB.');
    const offer = { ...meta, file, owner: 'self', author: this.host ? 'Host' : 'You', status: 'Available' }; this.offers.set(meta.id, offer);
    this.broadcast({ type: 'offer', ...meta }); this.changed(); return meta.id;
  }
  request(id) {
    const offer = this.offers.get(id); if (!offer || offer.owner === 'self' || !this.policy.files || offer.receiving || offer.url) return false;
    if ([...this.routes.values()].some(route => route.target === 'self')) throw Error('Receive one file at a time.');
    if([...this.offers.values()].reduce((sum,o)=>sum+(o.blob?.size || 0),0)+offer.size>128*1024*1024)throw Error('Remove some received files before receiving another (128 MB cache limit).');
    const route = crypto.randomUUID(); this.routes.set(route, { id, source: offer.owner, target: 'self', next: 0, bytes: 0, parts: [], at: Date.now() }); offer.receiving = route; offer.status = 'Waiting…';
    if (!this.send(offer.owner, { type: 'request', id, route })) this.cancel(route, 'Not connected.');
    this.watch(); this.changed(); return true;
  }
  receive(from, msg) {
    if (!this.active || !msg || typeof msg !== 'object') return;
    if (msg.type === 'policy' && !this.host) { this.setPolicy(msg); return; }
    if (msg.type === 'clipboard') {
      if (!this.policy.clipboard || typeof msg.text !== 'string' || msg.text.length > 8000) return;
      const link = this.links.get(from), now = Date.now(); if (!link || now - (link.clipboardAt || 0) < 1500) return; link.clipboardAt = now;
      const author = this.host ? link.name : String(msg.author || 'Host').slice(0, 48);
      this.clipboard({ text: msg.text, author }); if (this.host) this.broadcast({ type: 'clipboard', text: msg.text, author }, from); return;
    }
    if (!this.policy.files) return;
    if (msg.type === 'offer') {
      const meta = fileOffer(msg); if (!meta || this.offers.has(meta.id) || this.offers.size >= 32 || [...this.offers.values()].filter(o => o.owner === from).length >= (this.host ? 8 : 32)) return;
      const author = this.host ? this.links.get(from)?.name : String(msg.author || 'Host').slice(0, 48);
      this.offers.set(meta.id, { ...meta, owner: from, author, status: 'Available' });
      if (this.host) this.broadcast({ type: 'offer', ...meta, author }, from); this.changed(); return;
    }
    if (msg.type === 'withdraw') { const offer = this.offers.get(msg.id); if (offer?.owner === from) this.withdraw(msg.id); return; }
    if (msg.type === 'request') {
      const offer = this.offers.get(msg.id);
      if (!offer || offer.owner === from || !uuid(msg.route) || this.routes.has(msg.route) || this.routes.size >= 4) return;
      if (!this.host && offer.owner !== 'self') return;
      const route = { id: offer.id, source: offer.owner, target: from, next: 0, bytes: 0, at: Date.now() }; this.routes.set(msg.route, route); this.watch();
      if (offer.owner === 'self') this.pump(msg.route, offer).catch(() => this.cancel(msg.route, 'Transfer stopped.'));
      else if (!this.send(offer.owner, { type: 'request', id: offer.id, route: msg.route })) this.cancel(msg.route, 'Sender disconnected.'); return;
    }
    if (msg.type === 'cancel') { const route = this.routes.get(msg.route); if (route && (route.source === from || route.target === from)) this.cancel(msg.route, 'Transfer cancelled.'); return; }
    if (msg.type === 'end') {
      const route = this.routes.get(msg.route), offer = this.offers.get(route?.id); if (!route || route.source !== from || !offer) return;
      if (route.bytes !== offer.size) { this.cancel(msg.route, 'Incomplete file. Try again.'); return; }
      if (route.target === 'self') { offer.blob = new Blob(route.parts, { type: 'application/octet-stream' }); offer.url = URL.createObjectURL(offer.blob); offer.status = 'Ready to save'; delete offer.receiving; }
      else this.send(route.target, { type: 'end', route: msg.route }); this.routes.delete(msg.route); this.changed();
    }
  }
  chunk(from, raw) {
    const packet = readFilePacket(raw), route = this.routes.get(packet?.route), offer = this.offers.get(route?.id);
    if (!packet || !route || route.source !== from || !offer) return;
    if (packet.index !== route.next || !packet.bytes.byteLength || route.bytes + packet.bytes.byteLength > offer.size) { this.cancel(packet.route, 'Invalid file data.'); return; }
    route.at = Date.now(); route.next++; route.bytes += packet.bytes.byteLength;
    if (route.target === 'self') route.parts.push(packet.bytes);
    else if (!this.send(route.target, raw)) { this.cancel(packet.route, 'Receiver is busy. Try again.'); return; }
    if (route.target === 'self') { offer.status = `${Math.round(route.bytes / Math.max(1, offer.size) * 100)}% received`; this.changed(); }
  }
  async pump(id, offer) {
    const route = this.routes.get(id); if (!route) return;
    for (let offset = 0, index = 0; offset < offer.size; offset += fileChunk, index++) {
      while (this.routes.get(id) === route && (this.paused || this.canUpload && !this.canUpload(route.target) || (this.links.get(route.target)?.channel.bufferedAmount || 0) > 16384)) await pause(50);
      if (this.routes.get(id) !== route) return;
      const bytes = await offer.file.slice(offset, offset + fileChunk).arrayBuffer();
      if (this.routes.get(id) !== route) return;
      if (!this.send(route.target, filePacket(id, index, bytes))) { this.cancel(id, 'Receiver disconnected.'); return; }
      route.at = Date.now(); await pause(32); // At most 256 KB/s per transfer; never queue a whole file.
    }
    if (this.routes.get(id) !== route) return;
    while(this.routes.get(id)===route && (this.links.get(route.target)?.channel.bufferedAmount || 0)>16384)await pause(50);
    if(this.routes.get(id)!==route)return;
    if(!this.send(route.target, { type: 'end', route: id })){this.cancel(id,'Receiver disconnected.');return;} this.routes.delete(id); this.changed();
  }
  cancel(id, reason = 'Transfer cancelled.') {
    const route = this.routes.get(id); if (!route) return; this.routes.delete(id);
    for (const peer of [route.source, route.target]) if (peer !== 'self') this.send(peer, { type: 'cancel', route: id });
    const offer = this.offers.get(route.id); if (offer?.receiving === id) { delete offer.receiving; offer.status = reason; } this.changed();
  }
  withdraw(id) {
    const offer = this.offers.get(id); if (!offer) return;
    for (const [key, route] of this.routes) if (route.id === id) this.cancel(key, 'File removed.');
    if (offer.url) URL.revokeObjectURL(offer.url); this.offers.delete(id);
    if (this.host || offer.owner === 'self') this.broadcast({ type: 'withdraw', id }); this.changed();
  }
  shareClipboard(text) { if (!this.policy.clipboard) throw Error('The host has not enabled clipboard sharing.'); if (typeof text !== 'string' || text.length > 8000) throw Error('Clipboard text must be at most 8,000 characters.'); this.broadcast({ type: 'clipboard', text, author: this.host ? 'Host' : 'Guest' }); }
  watch() { if (!this.timer) this.timer = setInterval(() => { for (const [id, route] of this.routes) if (!this.paused && Date.now() - route.at > 60000) this.cancel(id, 'Transfer timed out.'); if (!this.routes.size) { clearInterval(this.timer); this.timer = null; } }, 5000); this.timer?.unref?.(); }
  removePeer(id) { for (const [key, route] of this.routes) if (route.source === id || route.target === id) this.cancel(key, 'Peer disconnected.'); for (const [key, offer] of this.offers) if (offer.owner === id) this.withdraw(key); this.links.delete(id); this.changed(); }
  reset() { for (const id of [...this.routes.keys()]) this.cancel(id, 'Call ended.'); clearInterval(this.timer); this.timer = null; for (const offer of this.offers.values()) if (offer.url) URL.revokeObjectURL(offer.url); this.offers.clear(); for (const link of this.links.values()) { link.channel.onmessage = null; link.channel.onclose = null; try { link.channel.close(); } catch {} } this.links.clear(); this.changed(); }
}

export function chatAttachments(chat) {
  const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const area = document.createElement('div'); area.className = 'chat-attachments';
  area.innerHTML = `<div class="chat-attachment-tools"><button type="button" class="button small-button" data-file="add" title="Share a file · up to 64 MB">${icon('attach')} File</button><button type="button" class="button small-button" data-file="clipboard" hidden>${icon('copy')} Send clipboard</button><label class="check-row chat-upload-pause"><input type="checkbox" data-file="pause" /> Pause uploads</label></div><input type="file" data-file="picker" hidden /><div data-file="list" class="chat-file-list"></div><p class="small muted" data-file="note" role="status"></p>`;
  chat.root.querySelector('.chat-compose').before(area); const $ = name => area.querySelector(`[data-file="${name}"]`);
  const noticed = new Set();
  const hub = new FileTransfers({ host: chat.host, changed: () => render(), clipboard: ({ text, author }) => {
    const row = document.createElement('div'); row.className = 'chat-file chat-clipboard'; row.dataset.clipboard = 'true';
    row.innerHTML = `${icon('copy')}<div class="chat-file-copy"><strong>Clipboard text</strong><span class="chat-file-meta"></span></div><button type="button" class="button small-button">Copy</button>`;
    row.querySelector('.chat-file-meta').textContent = author;
    const copy = row.querySelector('button');
    copy.onclick = () => navigator.clipboard.writeText(text).then(() => { copy.textContent = 'Copied'; }).catch(() => {
      $('note').textContent = 'Select the text below to copy it.';
      let field = row.querySelector('textarea');
      if (!field) { field = document.createElement('textarea'); field.readOnly = true; field.setAttribute('aria-label', 'Shared clipboard text'); row.append(field); }
      field.value = text; field.select();
    });
    $('list').append(row);
    while ($('list').querySelectorAll('[data-clipboard]').length > 5) $('list').querySelector('[data-clipboard]').remove();
    chat.onOpen?.();
  } });
  function render() {
    $('add').disabled = !chat.ready || chat.locked || !hub.policy.files || !hub.links.size;
    $('clipboard').hidden = !hub.policy.clipboard; $('clipboard').disabled = !chat.ready || chat.locked || !hub.links.size;
    if (!hub.offers.size) noticed.clear();
    if (!chat.ready || !hub.policy.clipboard) for (const row of $('list').querySelectorAll('[data-clipboard]')) row.remove();
    if (!chat.ready) { $('note').textContent = ''; $('pause').checked = false; hub.paused = false; }
    $('pause').closest('label').hidden = ![...hub.offers.values()].some(o => o.owner === 'self');
    chat.$('empty').hidden = chat.history.entries.length > 0 || hub.offers.size > 0;
    const existing = new Map([...$('list').querySelectorAll('[data-file-id]')].map(row => [row.dataset.fileId, row]));
    for (const offer of hub.offers.values()) {
      let row = existing.get(offer.id); existing.delete(offer.id);
      if (!row) {
        row = document.createElement('div'); row.className = 'chat-file'; row.dataset.fileId = offer.id;
        row.innerHTML = `${icon('file')}<div class="chat-file-copy"><strong></strong><span class="chat-file-meta"></span><span class="chat-file-status"></span><progress max="100" aria-label="File received" hidden></progress></div><div class="chat-file-actions"></div>`;
        $('list').append(row);
      }
      const name = row.querySelector('strong'), meta = row.querySelector('.chat-file-meta'), status = row.querySelector('.chat-file-status');
      const size = offer.size < 1024 ? `${offer.size} B` : offer.size >= 1024 * 1024 ? `${(offer.size / 1024 / 1024).toFixed(1)} MB` : `${(offer.size / 1024).toFixed(offer.size < 10240 ? 1 : 0)} KB`;
      if (name.textContent !== offer.name) { name.textContent = offer.name; name.title = offer.name; }
      const caption = `${size} · ${offer.author}`;
      if (meta.textContent !== caption) meta.textContent = caption;
      if (status.textContent !== offer.status) status.textContent = offer.status;
      const progress = row.querySelector('progress'); progress.hidden = !offer.receiving;
      progress.value = Number(offer.status.match(/^(\d+)%/)?.[1] || 0);
      row.classList.toggle('is-ready', !!offer.url);
      if (offer.owner !== 'self' && chat.ready && !noticed.has(offer.id)) {
        noticed.add(offer.id);
        if (!chat.open) { chat.unread = Math.min(100, chat.unread + 1); chat.peek.textContent = `${offer.author} shared ${offer.name}`; chat.peek.hidden = false; clearTimeout(chat.peekTimer); chat.peekTimer = setTimeout(() => { chat.peek.hidden = true; }, 5000); queueMicrotask(() => chat.state()); }
      }
      const action = offer.owner === 'self' ? 'own' : offer.url ? 'save' : offer.receiving ? 'cancel' : 'receive';
      if (row.dataset.action === action) continue;
      row.dataset.action = action;
      const actions = row.querySelector('.chat-file-actions'); actions.replaceChildren();
      const button = document.createElement('button'); button.type = 'button'; button.className = 'button small-button';
      if (offer.owner === 'self' || offer.url) {
        button.classList.add('chat-file-remove'); button.innerHTML = icon('close'); button.title = 'Remove file'; button.setAttribute('aria-label', `Remove ${offer.name}`); button.onclick = () => hub.withdraw(offer.id);
        if (offer.url) { const link = document.createElement('a'); link.className = 'button small-button chat-file-save'; link.href = offer.url; link.download = offer.name; link.innerHTML = `${icon('download')} Save file`; actions.append(link); }
      } else if (offer.receiving) { button.textContent = 'Cancel'; button.onclick = () => hub.cancel(offer.receiving); }
      else { button.textContent = 'Receive'; button.onclick = () => { try { hub.request(offer.id); } catch (error) { $('note').textContent = error.message; } }; }
      actions.append(button);
    }
    for (const row of existing.values()) row.remove();
  }
  $('add').onclick = () => $('picker').click();
  $('picker').onchange = () => { const file = $('picker').files[0]; if (file) try { hub.offer(file); $('note').textContent = 'Shared with this call · up to 64 MB per file.'; } catch (error) { $('note').textContent = error.message; } $('picker').value = ''; };
  $('pause').onchange = () => { hub.paused = $('pause').checked; };
  $('clipboard').onclick = async () => { try { hub.shareClipboard(await navigator.clipboard.readText()); $('note').textContent = 'Clipboard shared. Others can choose Copy.'; } catch (error) { $('note').textContent = error.message; } };
  chat.root.addEventListener('chat-state', () => { if (!chat.ready && hub.links.size) hub.reset(); render(); });
  return hub;
}
