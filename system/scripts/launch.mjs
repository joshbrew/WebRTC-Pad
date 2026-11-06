import { fileURLToPath } from 'node:url';
import { supportedNode, openBrowser, localAddress, runningApp, roleFromArgs, savedRole } from './install-utils.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
let app;
try {
  if (!supportedNode()) throw new Error('Node.js 22.9 or newer is required. Run the installer first.');
  if (args.some(arg => !['host', 'player', '--host', '--player', '--no-browser', '--native','--remember-page'].includes(arg))) throw new Error('Use start [host|player] [--no-browser].');
  const role = roleFromArgs(args) || await savedRole(root);
  const port = Number(process.env.PORT ?? 8787);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be between 0 and 65535.');
  const urlFor = port => `${localAddress(port, !!process.env.TLS_CERT)}/?ui=call${args.includes('--remember-page')?'':role === 'player' ? '&mode=join' : '&mode=host'}${args.includes('--native') ? '&capture=native' : ''}`;
  if (port && await runningApp(port, !!process.env.TLS_CERT)) {
    const url = urlFor(port); console.log(`WebRTC Pad is already running: ${url}`);
    if (!args.includes('--no-browser')) await openBrowser(url);
  } else {
    const { createApp } = await import('../src/server.js');
    app = createApp();
    let closing = false;
    const stop = async () => { if (!closing) { closing = true; await app.close(); } };
    app.server.on('error', error => {
      console.error(error.code === 'EADDRINUSE' ? `Port ${port} is in use. Close the other app or change PORT in .env.` : error.message);
      process.exitCode = 1; stop();
    });
    for (const event of ['SIGINT', 'SIGTERM']) process.once(event, stop);
    app.server.listen(port, process.env.HOST || '127.0.0.1', async () => {
      const url = urlFor(app.server.address().port);
      console.log(`WebRTC Pad is ready: ${url}\nKeep this window open while playing. Press Ctrl+C to stop.`);
      if (!args.includes('--no-browser')) await openBrowser(url);
    });
  }
} catch (error) { console.error(`Launch: ${error.message}\nUse Host or Join in your platform folder to repair missing dependencies.`); process.exitCode = 1; if (app) await app.close(); }
