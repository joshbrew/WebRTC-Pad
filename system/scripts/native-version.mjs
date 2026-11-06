import fs from 'node:fs';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
export function nativeSourceHash(platform=process.platform) {
  const hash=crypto.createHash('sha256');
  const files=['../native/media/main.go','../native/media/fanout.go','../native/media/go.mod','../native/media/go.sum',...(platform==='win32'?['../native/windows-audio.cs']:platform==='linux'?['../native/linux_audio.py','../native/linux_scope.py','../native/linux_overlay.py']:[])];
  if(platform==='darwin')files.push('../native/macos/Desktop.swift','../native/macos/Info.plist','./build-macos.mjs');
  for(const file of files)hash.update(fs.readFileSync(fileURLToPath(new URL(file,import.meta.url))));
  if(platform==='win32')hash.update(fs.readFileSync(fileURLToPath(new URL('../native/windows-thumbnail.cs',import.meta.url))));
  return hash.digest('hex');
}
