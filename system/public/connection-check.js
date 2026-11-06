export async function connectionCheck(configuration, { Peer = globalThis.RTCPeerConnection, timeoutMs = 7000, signal } = {}) {
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
  const pc = new Peer(configuration), counts = { direct: 0, reflexive: 0, relay: 0 }, types = new Set(); let timer, aborted;
  try {
    return await new Promise((resolve, reject) => {
      let done = false;
      const finish = complete => { if (done) return; done = true; resolve({ ...counts, complete, turnConfigured: (configuration.iceServers || []).some(s => [s.urls].flat().some(url => /^turns?:/i.test(url))), transports: [...types] }); };
      aborted = () => { if (!done) { done = true; reject(new DOMException('Cancelled', 'AbortError')); } }; signal?.addEventListener('abort', aborted, { once: true });
      pc.onicecandidate = event => {
        const candidate = event.candidate; if (!candidate) { finish(true); return; }
        const type = candidate.type || candidate.candidate?.match(/ typ (\w+)/)?.[1];
        if (type === 'relay') counts.relay++; else if (['srflx', 'prflx'].includes(type)) counts.reflexive++; else if (type === 'host') counts.direct++;
        const protocol = candidate.protocol || candidate.candidate?.split(' ')[2]?.toLowerCase(); if (['udp', 'tcp'].includes(protocol)) types.add(protocol);
      };
      pc.createDataChannel('check'); timer = setTimeout(() => finish(false), timeoutMs);
      pc.createOffer().then(offer => pc.setLocalDescription(offer)).catch(reject);
    });
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', aborted); pc.close(); }
}
export function connectionCheckUI(root, getIce, before) {
  const section = document.createElement('div'); section.className = 'connection-self-test';
  section.innerHTML = '<button class="button small-button" type="button"><svg class="icon" aria-hidden="true"><use href="#i-connection"/></svg><span>Check connection</span></button><p class="small muted" role="status">Check available routes before inviting someone.</p>';
  if(before)before.before(section);else if(root.tagName==='DETAILS')root.querySelector('summary').after(section);else root.prepend(section); const button = section.querySelector('button'), status = section.querySelector('p'); let abort;
  button.onclick = async () => {
    if (abort) { abort.abort(); return; } const request = abort = new AbortController(); button.querySelector('span').textContent = 'Cancel check'; section.setAttribute('aria-busy','true'); status.textContent = 'Checking network routes…';
    try {
      const result = await connectionCheck(await getIce(), { signal: request.signal });
      status.textContent = `${result.direct + result.reflexive} direct routes · ${result.relay} relay routes. ` + (result.relay ? 'A relay is available. Your friend still needs a reachable route too.' : result.turnConfigured ? 'No relay route was found. Check relay credentials, service limits and firewall settings.' : 'No TURN relay is configured. Direct connections may work; some networks need a relay.') + (result.complete ? '' : ' Gathering timed out; results may be incomplete.');
    } catch (error) { status.textContent = error.name === 'AbortError' ? 'Test cancelled.' : 'Could not test the connection. Check your network and connection settings.'; }
    finally { if (abort === request) abort = null; button.querySelector('span').textContent = 'Check connection'; section.removeAttribute('aria-busy'); }
  };
  window.addEventListener('pagehide', () => abort?.abort());
}
