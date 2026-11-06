import {macDesktopCapability} from './macos-desktop.js';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const portalChecks=new Map();
export function waylandPortalAvailable(env=process.env,platform=process.platform){
  if(platform!=='linux' || desktopSession(env,platform)!=='wayland' || !env.DBUS_SESSION_BUS_ADDRESS)return false;
  const key=JSON.stringify([env.PYTHON,env.DBUS_SESSION_BUS_ADDRESS,env.WAYLAND_DISPLAY]);if(portalChecks.has(key))return portalChecks.get(key);
  const result=spawnSync(env.PYTHON || 'python3',['-B',fileURLToPath(new URL('../native/wayland_portal.py',import.meta.url)),'--check'],{env:{...process.env,...env},windowsHide:true,stdio:'ignore',timeout:2500});const available=result.status===0;portalChecks.set(key,available);return available;
}
export function desktopSession(env=process.env,platform=process.platform){
  if(platform!=='linux')return platform;
  if(env.XDG_SESSION_TYPE==='wayland' || env.WAYLAND_DISPLAY && env.XDG_SESSION_TYPE!=='x11')return 'wayland';
  return env.DISPLAY?'x11':'headless';
}
export function desktopCapabilities(env=process.env,platform=process.platform){
  const session=desktopSession(env,platform),windowMouse=platform==='win32' || session==='x11' || platform==='darwin' && macDesktopCapability(env).available;
  return {session,windowMouse,cursorOverlay:windowMouse};
}
