import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { nativeCapability } from '../src/native-media.js';
import {createEncoderScanner,encoderNames} from '../src/encoder-scan.js';
import {nativeSourceHash} from './native-version.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
const tools = path.join(root, '.local/tools');
async function exists(file) { try { await fs.access(file); return true; } catch { return false; } }
function run(command, args, cwd = root, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, ...extraEnv }, stdio: 'inherit', windowsHide: true });
    child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Native setup step failed (${code})`)));
  });
}
async function download(url, file, digest) {
  const response = await fetch(url, { signal: AbortSignal.timeout(180000) });
  if (!response.ok) throw new Error('Native runtime download failed');
  const data = Buffer.from(await response.arrayBuffer());
  if (!/^[a-f0-9]{64}$/i.test(digest) || crypto.createHash('sha256').update(data).digest('hex') !== digest.toLowerCase()) throw new Error('Native runtime checksum did not match');
  await fs.writeFile(file, data);
}
async function unpack(archive, target) {
  await fs.mkdir(target, { recursive: true });
  if (archive.endsWith('.zip')) await run('powershell.exe', ['-NoProfile', '-Command', 'Expand-Archive -LiteralPath $env:PAD_NATIVE_ARCHIVE -DestinationPath $env:PAD_NATIVE_DEST -Force'], root, { PAD_NATIVE_ARCHIVE: archive, PAD_NATIVE_DEST: target });
  else await run('tar', ['-xzf', archive, '-C', target]);
}
try {
  if (process.argv.includes('--help')) console.log('npm run setup:native\nDownloads a checksum-verified portable Go compiler; builds the pinned Pion helper. On Windows x64 it can also download the upstream-linked FFmpeg build. Other platforms need FFmpeg installed separately. No desktop capture occurs during setup.');
  else {
    if (await exists(path.join(root, '.env'))) process.loadEnvFile(path.join(root, '.env'));
    await fs.mkdir(tools, { recursive: true });
    const go = path.join(tools, 'go/bin', process.platform === 'win32' ? 'go.exe' : 'go');
    if (!await exists(go)) {
      const releases = await (await fetch('https://go.dev/dl/?mode=json')).json();
      const os = { win32: 'windows', darwin: 'darwin', linux: 'linux' }[process.platform], arch = { x64: 'amd64', arm64: 'arm64' }[process.arch];
      const release = releases.find(release => release.stable), asset = release?.files.find(file => file.os === os && file.arch === arch && file.kind === 'archive');
      if (!asset || !/^[a-zA-Z0-9._-]+$/.test(asset.filename)) throw new Error('Install a supported Go compiler for this platform and build system/native/media manually.');
      const archive = path.join(tools, asset.filename);
      console.log(`Downloading portable ${release.version} for this computer…`);
      await download(`https://go.dev/dl/${asset.filename}`, archive, asset.sha256); await unpack(archive, tools);
    }
    if (!nativeCapability().ffmpeg && process.platform === 'win32' && process.arch === 'x64') {
      const url = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip';
      const digest = (await (await fetch(url + '.sha256')).text()).trim().split(/\s+/)[0];
      const archive = path.join(tools, 'ffmpeg-download.zip');
      console.log('Downloading the upstream-linked Windows FFmpeg build…');
      await download(url, archive, digest); await unpack(archive, path.join(tools, 'ffmpeg'));
    }
    const environment = { GOMODCACHE: path.join(root, '.local/go-mod'), GOCACHE: path.join(root, '.local/go-cache'), GOTOOLCHAIN: 'local' };
    await run(go, ['build', '-trimpath', '-o', path.join(tools, `webrtc-pad-media${process.platform === 'win32' ? '.exe' : ''}`), '.'], path.join(root, 'system/native/media'), environment);
    if(process.platform==='win32') {
      const compiler=path.join(process.env.WINDIR || 'C:\\Windows','Microsoft.NET/Framework64/v4.0.30319/csc.exe');
      if(!await exists(compiler))throw new Error('Windows native audio needs the built-in .NET Framework 4.x compiler.');
      await run(compiler,['/nologo','/target:exe','/platform:x64','/optimize+',`/out:${path.join(tools,'webrtc-pad-audio.exe')}`,path.join(root,'system/native/windows-audio.cs')]);
      await run(compiler,['/nologo','/target:exe','/platform:x64','/optimize+','/r:System.Drawing.dll',`/out:${path.join(tools,'webrtc-pad-thumbnail.exe')}`,path.join(root,'system/native/windows-thumbnail.cs')]);
      console.log('Windows system and application audio helper built. Audio stays off until enabled in the app.');
    }
    if(process.platform==='linux'){
      const {nativeAudioCapability}=await import('../src/native-audio.js');
      const audio=nativeAudioCapability();
      console.log(audio.available?'Linux playback audio helper is ready; app/system audio stays off until enabled.':audio.error);
      console.log('Window-only input and click-through desktop cursors use Python 3, libX11, libXext and libXtst in an X11 login session. Native audio also works with browser video on Wayland when PulseAudio/pipewire-pulse is available. See system/docs/linux-desktop.md.');
    }
    if(process.platform==='darwin'){
      const {buildMacDesktop}=await import('./build-macos.mjs');await buildMacDesktop();
      console.log('Mac ScreenCaptureKit audio/video, VideoToolbox encoding and desktop helper built. Enable permissions in the Mac setup guide before sharing; desktop control stays off.');
    }
    await fs.writeFile(path.join(tools,'native-build.json'),JSON.stringify({sourceHash:nativeSourceHash()},null,2)+'\n');
    const capability = nativeCapability();
    console.log(capability.available ? 'Native capture is ready. Restart the app and choose Native desktop in host capture settings.' : `Helper built. ${capability.error} Install FFmpeg or configure FFMPEG_BIN as described in system/docs/native-capture.md.`);
    if(capability.ffmpeg) {
      console.log('Checking native video encoders with generated frames…');
      const scan=await createEncoderScanner({ffmpeg:capability.ffmpeg,env:process.env}).scan();
      if(scan.devices.length)console.log(`Graphics found: ${scan.devices.join(' · ')}`);
      console.log(scan.selected?`Selected encoder: ${encoderNames[scan.selected]}`:scan.error);
    }
    console.log('Your screen is captured only when sharing starts. The app reports the actual encoder in use.');
  }
} catch (error) { console.error(`Native setup: ${error.message}`); process.exitCode = 1; }
