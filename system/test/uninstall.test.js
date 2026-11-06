import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const source=fileURLToPath(new URL('../scripts/uninstall.ps1',import.meta.url));
const quote=value=>"'"+value.replaceAll("'","''")+"'";
const options={skip:process.platform!=='win32'};
function fixture(t,{running=false,msiExit=0,registered=true,recoverExit=0,stuckRecovery=false,interception=true,interceptionExit=0,stickyInterception=false,missingInstaller=false,tampered=false}={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pad-uninstall-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(path.join(root,'system/scripts'),{recursive:true});
  fs.copyFileSync(source,path.join(root,'system/scripts/uninstall.ps1'));
  fs.copyFileSync(fileURLToPath(new URL('../scripts/interception-uninstall.ps1',import.meta.url)),path.join(root,'system/scripts/interception-uninstall.ps1'));
  fs.writeFileSync(path.join(root,'system/scripts/hidhide-updater.ps1'),"function Disable-HidHideUpdater {Write-Host 'UPDATER-ONLY'}");
  const write=(name,value='fixture')=>{const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,value);};
  write('node_modules/test/package.json');write('.local/tools/reader.txt');write('.local/install.json');write('.local/coturn/turnserver.conf');write('.env','PRIVATE_TEST_VALUE');write('README.md','source stays');
  const installer='.local/tools/guest-input/interception-upstream/Interception/command line installer/install-interception.exe';
  if(!missingInstaller)write(installer);
  write('.archive/Interception/command line installer/install-interception.exe');
  const wrapper=path.join(root,'invoke.ps1');
  fs.writeFileSync(wrapper,`
param([string]$Cleanup='App',[switch]$RemoveHidHide,[switch]$RemoveInterception,[switch]$PlanOnly)
$ErrorActionPreference='Stop'
$global:padFixtureInterception=$${interception?'true':'false'}
function Get-CimInstance { [CmdletBinding()]param($ClassName,$Filter)
  if($ClassName -eq 'Win32_Process'){${running?`[pscustomobject]@{Name='node.exe';ProcessId=1234;ExecutablePath='C:\\Program Files\\nodejs\\node.exe';CommandLine='node system/scripts/launch.mjs'}`:''}}
}
function Get-ItemProperty { [CmdletBinding()]param($Path,$LiteralPath,$Name)
  if($Path){${registered?`[pscustomobject]@{DisplayName='HidHide';Publisher='Nefarius Software Solutions e.U.';PSChildName='{01E0AB21-D1CC-42B4-9DFF-84FFE4F26DAF}'}`:''}}
  elseif($LiteralPath -like '*PrefetchParameters'){[pscustomobject]@{BootId=154}}
  elseif($global:padFixtureInterception){if($LiteralPath -like '*Services*'){[pscustomobject]@{Type=1}}else{[pscustomobject]@{UpperFilters=@('keyboard','mouse')}}}
}
function Test-Path { [CmdletBinding()]param($LiteralPath)
  if($LiteralPath -match 'System32[/\\\\]drivers[/\\\\](keyboard|mouse)\\.sys$'){return $global:padFixtureInterception}
  return Microsoft.PowerShell.Management\\Test-Path -LiteralPath $LiteralPath
}
function Get-FileHash { [CmdletBinding()]param($LiteralPath,$Algorithm)
  if($LiteralPath -like '*.zip'){[pscustomobject]@{Hash='AD038963D6413055765128B0B931F6E765147C9916DBA79E65D872B261F9AF10'}}else{[pscustomobject]@{Hash='${tampered?'BAD':'E137863A79DA797F08E7A137280FF2A123809044A888FD75CE9C973198915ABE'}'}}
}
function Invoke-WebRequest { [CmdletBinding()]param([switch]$UseBasicParsing,$Uri,$OutFile)
  Write-Host 'DOWNLOAD:PINNED-INTERCEPTION'
  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip=[IO.Compression.ZipFile]::Open($OutFile,[IO.Compression.ZipArchiveMode]::Create)
  try{[IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip,${quote(path.join(root,'.archive/Interception/command line installer/install-interception.exe'))},'Interception/command line installer/install-interception.exe') | Out-Null}finally{$zip.Dispose()}
}
function Start-Process { [CmdletBinding()]param($FilePath,$ArgumentList,$Verb,$WindowStyle,[switch]$Wait,[switch]$PassThru)
  if($FilePath -like '*webrtc-pad-guest.exe'){
    if($ArgumentList -ne '--recover'){throw 'Unexpected reader command'}
    Write-Host 'RECOVER'
    ${recoverExit===0 && !stuckRecovery?`Remove-Item -LiteralPath ${quote(path.join(root,'.local/tools/guest-input/guest-hide-recovery.json'))}`:''}
    return [pscustomobject]@{ExitCode=${recoverExit}}
  }
  if($FilePath -like '*install-interception.exe'){
    if($ArgumentList -ne '/uninstall'){throw 'Unexpected Interception command'}
    Write-Host "INTERCEPTION:$ArgumentList"
    ${!stickyInterception && interceptionExit===0?'$global:padFixtureInterception=$false;':''}
    return [pscustomobject]@{ExitCode=${interceptionExit}}
  }
  if($FilePath -notlike '*msiexec.exe'){throw 'Unexpected process launch'}
  Write-Host "MSI:$ArgumentList"
  [pscustomobject]@{ExitCode=${msiExit}}
}
& ${quote(path.join(root,'system/scripts/uninstall.ps1'))} -Cleanup $Cleanup -RemoveHidHide:$RemoveHidHide -RemoveInterception:$RemoveInterception -PlanOnly:$PlanOnly -Yes
exit $LASTEXITCODE
`);
  const run=(args=[])=>spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',wrapper,...args],{encoding:'utf8',timeout:15000});
  return {root,write,run,exists:name=>fs.existsSync(path.join(root,name))};
}
test('basic uninstall removes only app dependencies/tools and preserves configuration, source and shared drivers',options,t=>{
  const f=fixture(t),r=f.run();assert.equal(r.status,0,r.stdout+r.stderr);
  assert.equal(f.exists('node_modules'),false);assert.equal(f.exists('.local/tools'),false);assert.equal(f.exists('.local/install.json'),false);
  for(const file of ['.env','.local/coturn/turnserver.conf','README.md'])assert.equal(f.exists(file),true);
  assert.doesNotMatch(r.stdout,/MSI:|UPDATER-ONLY|PRIVATE_TEST_VALUE/);
});
test('full cleanup erases local settings but keeps source and the HidHide opt-out',options,t=>{
  const f=fixture(t);f.write('.local/hidhide-disabled');f.write('.local/interception-disabled');const r=f.run(['-Cleanup','Full']);assert.equal(r.status,0,r.stdout+r.stderr);
  for(const file of ['.env','.local/coturn','node_modules'])assert.equal(f.exists(file),false);
  assert.equal(f.exists('README.md'),true);assert.equal(f.exists('.local/hidhide-disabled'),true);assert.equal(f.exists('.local/interception-disabled'),true);
});

test('Interception-only removal keeps HidHide, describes filters, disables auto-install and records restart',options,t=>{
  const f=fixture(t),r=f.run(['-Cleanup','None','-RemoveInterception']);assert.equal(r.status,0,r.stdout+r.stderr);
  assert.match(r.stdout,/REMOVE: Interception.*keyboard\/mouse/);assert.match(r.stdout,/KEEP: HidHide/);assert.match(r.stdout,/KEEP: ViGEmBus/);assert.match(r.stdout,/INTERCEPTION:\/uninstall/);assert.doesNotMatch(r.stdout,/MSI:|UPDATER-ONLY/);
  assert.equal(f.exists('.local/interception-disabled'),true);assert.equal(f.exists('.local/hidhide-disabled'),false);assert.equal(f.exists('node_modules'),true);assert.equal(JSON.parse(fs.readFileSync(path.join(f.root,'.local/input-drivers-restart.json'))).action,'remove');
});
test('both-driver removal and full cleanup preserve opt-outs and the restart reminder',options,t=>{
  const f=fixture(t),r=f.run(['-Cleanup','Full','-RemoveHidHide','-RemoveInterception']);assert.equal(r.status,0,r.stdout+r.stderr);
  assert.match(r.stdout,/INTERCEPTION:\/uninstall/);assert.match(r.stdout,/MSI:/);assert.equal(f.exists('.env'),false);assert.equal(f.exists('.local/tools'),false);
  for(const file of ['.local/hidhide-disabled','.local/interception-disabled','.local/input-drivers-restart.json'])assert.equal(f.exists(file),true);
});
test('Interception failures, leftover filters and tampered installer preserve app files',options,t=>{
  for(const settings of [{interceptionExit:5},{stickyInterception:true},{tampered:true}]){
    const f=fixture(t,settings),r=f.run(['-Cleanup','Full','-RemoveInterception']);assert.equal(r.status,1,r.stdout+r.stderr);assert.equal(f.exists('.local/tools/reader.txt'),true);assert.equal(f.exists('.env'),true);assert.equal(f.exists('.local/interception-disabled'),true);
    if(settings.tampered)assert.doesNotMatch(r.stdout,/INTERCEPTION:/);
  }
});
test('missing Interception uninstaller is restored from a verified archive; absent drivers do not launch anything',options,t=>{
  const f=fixture(t,{missingInstaller:true}),r=f.run(['-Cleanup','None','-RemoveInterception']);assert.equal(r.status,0,r.stdout+r.stderr);assert.match(r.stdout,/DOWNLOAD:PINNED-INTERCEPTION/);assert.match(r.stdout,/INTERCEPTION:\/uninstall/);
  const absent=fixture(t,{interception:false}),skip=absent.run(['-Cleanup','None','-RemoveInterception']);assert.equal(skip.status,0,skip.stdout+skip.stderr);assert.match(skip.stdout,/already uninstalled/);assert.doesNotMatch(skip.stdout,/INTERCEPTION:|DOWNLOAD:|MSI:/);
});
test('preview is read-only and a running app prevents any cleanup',options,t=>{
  const f=fixture(t,{running:true});let r=f.run(['-PlanOnly','-RemoveHidHide']);assert.equal(r.status,0,r.stdout+r.stderr);assert.doesNotMatch(r.stdout,/MSI:|UPDATER-ONLY/);
  r=f.run(['-RemoveHidHide']);assert.equal(r.status,1);assert.match(r.stdout,/Close the app console/);
  for(const file of ['node_modules/test/package.json','.local/tools/reader.txt','.env'])assert.equal(f.exists(file),true);
});
test('unrecoverable controller journal prevents driver uninstall and tool deletion',options,t=>{
  const f=fixture(t);f.write('.local/tools/guest-input/guest-hide-recovery.json','{}');const r=f.run(['-RemoveHidHide']);
  assert.equal(r.status,1);assert.match(r.stdout,/recovery is pending/);assert.doesNotMatch(r.stdout,/MSI:|UPDATER-ONLY/);assert.equal(f.exists('.local/tools/guest-input/guest-hide-recovery.json'),true);assert.equal(f.exists('node_modules'),true);
});
test('controller recovery must succeed and clear the journal before tools or HidHide are removed',options,t=>{
  for(const settings of [{recoverExit:0},{recoverExit:1},{stuckRecovery:true}]){
    const f=fixture(t,settings);f.write('.local/tools/guest-input/guest-hide-recovery.json','{}');f.write('.local/tools/guest-input/webrtc-pad-guest.exe');
    const r=f.run(['-RemoveHidHide']);
    if(settings.recoverExit===0){
      assert.equal(r.status,0,r.stdout+r.stderr);assert.ok(r.stdout.indexOf('RECOVER')<r.stdout.indexOf('MSI:'));assert.equal(f.exists('.local/tools'),false);
    }else{
      assert.equal(r.status,1);assert.match(r.stdout,/recovery did not finish/);assert.doesNotMatch(r.stdout,/MSI:|UPDATER-ONLY/);assert.equal(f.exists('.local/tools/guest-input/guest-hide-recovery.json'),true);assert.equal(f.exists('node_modules'),true);
    }
  }
});
test('HidHide-only removal uses the registered MSI, suppresses reboot and future auto-install, and keeps app files',options,t=>{
  const f=fixture(t,{msiExit:3010}),r=f.run(['-Cleanup','None','-RemoveHidHide']);assert.equal(r.status,0,r.stdout+r.stderr);
  assert.match(r.stdout,/MSI:\/x \{01E0AB21-D1CC-42B4-9DFF-84FFE4F26DAF\} \/passive \/norestart REBOOT=ReallySuppress/);
  assert.match(r.stdout,/UPDATER-ONLY/);assert.match(r.stdout,/Restart Windows/);assert.equal(f.exists('.local/hidhide-disabled'),true);assert.equal(f.exists('node_modules/test/package.json'),true);
});
test('failed driver removal preserves app files and prevents auto-reinstallation',options,t=>{
  const f=fixture(t,{msiExit:1603}),r=f.run(['-Cleanup','Full','-RemoveHidHide']);assert.equal(r.status,1);assert.match(r.stdout,/uninstall failed/);assert.equal(f.exists('.local/hidhide-disabled'),true);assert.equal(f.exists('.local/tools/reader.txt'),true);assert.equal(f.exists('.env'),true);
});
test('cleanup rejects linked folders and preserves the outside target',options,t=>{
  const f=fixture(t),outside=fs.mkdtempSync(path.join(os.tmpdir(),'pad-uninstall-outside-'));t.after(()=>fs.rmSync(outside,{recursive:true,force:true}));
  fs.writeFileSync(path.join(outside,'keep.txt'),'keep');fs.symlinkSync(outside,path.join(f.root,'.local/tools/outside'),'junction');
  const r=f.run();assert.equal(r.status,1);assert.match(r.stdout,/linked folder/);assert.equal(fs.readFileSync(path.join(outside,'keep.txt'),'utf8'),'keep');assert.equal(f.exists('node_modules'),true);
});
