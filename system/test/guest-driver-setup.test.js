import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const script=fileURLToPath(new URL('../scripts/install-guest-drivers.ps1',import.meta.url));
const psQuote=value=>"'"+value.replaceAll("'","''")+"'";
function simulate(t,{devices='Controllers',installed=false,pendingHidHide=false,hideExit=0,interceptionExit=0,missingRegistration=false,updater=false,updaterExit=0,validSigner=true,stickyUpdater=false,optOut=false,enableHidHide=false,interceptionOptOut=false,enableInterception=false,installChoice='Install',savedChoice=null,answer='n',answers}={}){
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'pad-driver-test-'));t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
  const wrapper=path.join(folder,'test.ps1');
  // Every filesystem mutation, download, driver query and elevated launch is
  // replaced. These tests never install a driver or touch an input device.
  fs.writeFileSync(wrapper,`
$ErrorActionPreference='Stop'
$global:padFixtureUpdaterRegistered=$${updater?'true':'false'}
$global:padFixtureHideInstalled=$${installed?'true':'false'}
$global:padFixtureHideRegistered=$${installed || pendingHidHide?'true':'false'}
$global:padFixtureInterceptionInstalled=$${installed?'true':'false'}
$global:padFixtureAnswers=@(${(answers || [answer,answer]).map(psQuote).join(',')})
function Get-CimInstance { [CmdletBinding()]param($ClassName,$Filter) Write-Host "QUERY:$Filter"; if(($Filter -eq "Name='HidHide'" -and $global:padFixtureHideInstalled) -or ($Filter -ne "Name='HidHide'" -and $global:padFixtureInterceptionInstalled)){[pscustomobject]@{Name=$Filter}} }
function Get-ItemProperty { [CmdletBinding()]param($LiteralPath,$Name)
  if($LiteralPath -like '*CurrentControlSet*'){
    Write-Host "REGISTRY:$LiteralPath"
    if($LiteralPath -like '*Services\\HidHide' -and $global:padFixtureHideRegistered){return [pscustomobject]@{Type=1;Start=3}}
    if($global:padFixtureInterceptionInstalled){if($LiteralPath -like '*Services*'){[pscustomobject]@{Type=1;Start=3}}else{[pscustomobject]@{UpperFilters=@('keyboard','mouse')}}}
  }elseif($global:padFixtureUpdaterRegistered -and $LiteralPath -like 'HKCU:*'){[pscustomobject]@{nefarius_HidHide_Updater='"C:\\Program Files\\Nefarius Software Solutions\\HidHide\\x64\\nefarius_HidHide_Updater.exe" --autostart'}}
}
function Get-ScheduledTask { [CmdletBinding()]param($TaskName,$TaskPath) if($global:padFixtureUpdaterRegistered){[pscustomobject]@{State='Ready'}} }
function Get-AuthenticodeSignature { [CmdletBinding()]param($LiteralPath) [pscustomobject]@{Status='${validSigner?'Valid':'NotSigned'}';SignerCertificate=[pscustomobject]@{Subject='CN=Nefarius Software Solutions e.U., O=Nefarius Software Solutions e.U., C=AT'}} }
function Remove-ItemProperty { [CmdletBinding()]param($LiteralPath,$Name) Write-Host "AUTORUN:$Name" }
function New-Item { [CmdletBinding()]param($ItemType,[switch]$Force,$Path) }
function Test-Path { [CmdletBinding()]param($LiteralPath) if($LiteralPath -like '*hidhide-disabled'){return $${optOut?'true':'false'}};if($LiteralPath -like '*interception-disabled'){return $${interceptionOptOut?'true':'false'}};if($LiteralPath -like '*input-driver-choice.json'){return $${savedChoice?'true':'false'}};return $true }
function Get-Content { [CmdletBinding()]param($LiteralPath,[switch]$Raw) return '${JSON.stringify(typeof savedChoice==='object' && savedChoice?savedChoice:{choice:savedChoice})}' }
function Set-Content { [CmdletBinding()]param($LiteralPath,[Parameter(ValueFromPipeline=$true)]$Value) process {Write-Host "WRITE:$LiteralPath VALUE:$Value"} }
function Read-Host { param($Prompt) Write-Host "PROMPT:$Prompt";$value=$global:padFixtureAnswers[0];$global:padFixtureAnswers=@($global:padFixtureAnswers | Select-Object -Skip 1);return $value }
function Remove-Item { [CmdletBinding()]param($LiteralPath,[switch]$Force) Write-Host 'OPT-OUT-CLEARED' }
function Get-FileHash { [CmdletBinding()]param($LiteralPath,$Algorithm) return [pscustomobject]@{Hash='F4BBBCB82E6258641B887C74BC81C4C5F66E4AA811808DFC304347687B7605F6'} }
function Invoke-WebRequest { [CmdletBinding()]param([switch]$UseBasicParsing,$Uri,$OutFile) throw 'Unexpected download in fixture' }
function Start-Process { [CmdletBinding()]param($FilePath,$ArgumentList,$Verb,$WindowStyle,[switch]$PassThru,[switch]$Wait)
  if($FilePath -like '*nefarius_HidHide_Updater.exe'){Write-Host "UPDATER:$FilePath ARGS:$ArgumentList";${!stickyUpdater && [0,200].includes(updaterExit)?'$global:padFixtureUpdaterRegistered=$false;':''}return [pscustomobject]@{ExitCode=${updaterExit}}}
  Write-Host "LAUNCH:$FilePath ARGS:$ArgumentList"
  if($FilePath -like '*HidHide*') {${[0,3010].includes(hideExit) && !missingRegistration?'$global:padFixtureHideInstalled=$true;':''}return [pscustomobject]@{ExitCode=${hideExit}}}
  ${[0,3010].includes(interceptionExit) && !missingRegistration?'$global:padFixtureInterceptionInstalled=$true;':''}return [pscustomobject]@{ExitCode=${interceptionExit}}
}
try { & ${psQuote(script)} ${devices?`-Devices ${devices}`:''} -InstallChoice ${installChoice} -BootId 'FIXTURE:154' ${enableHidHide?'-EnableHidHide':''} ${enableInterception?'-EnableInterception':''};exit 0 } catch { Write-Host "ERROR:$($_.Exception.Message)";exit 1 }
`);
  return spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',wrapper],{encoding:'utf8',timeout:20000});
}
const options={skip:process.platform!=='win32'};
test('controller blocking setup is independent of Interception and accepts a required reboot without restarting',options,t=>{
  const result=simulate(t,{hideExit:3010});assert.equal(result.status,0,result.stdout+result.stderr);
  assert.match(result.stdout,/LAUNCH:.*HidHide/);assert.match(result.stdout,/\/norestart/);assert.doesNotMatch(result.stdout,/QUERY:.*keyboard|LAUNCH:.*interception/i);assert.match(result.stdout,/Restart Windows/);
});
test('repeated full guest driver setup skips installed drivers',options,t=>{
  const result=simulate(t,{devices:'All',installed:true});assert.equal(result.status,0,result.stdout+result.stderr);
  assert.match(result.stdout,/QUERY:Name='HidHide'/);assert.match(result.stdout,/REGISTRY:.*Services\\keyboard/);assert.match(result.stdout,/REGISTRY:.*Services\\mouse/);assert.doesNotMatch(result.stdout,/LAUNCH:/);
});
test('registered HidHide awaiting reboot is reused even when CIM does not list it yet',options,t=>{
  const result=simulate(t,{pendingHidHide:true,installChoice:'Ask'});assert.equal(result.status,0,result.stdout+result.stderr);
  assert.match(result.stdout,/Controller input blocking is installed/);assert.doesNotMatch(result.stdout,/PROMPT:|LAUNCH:|RESTART YOUR COMPUTER/);
});
test('HidHide failure is reported while a separately requested keyboard/mouse setup is still attempted',options,t=>{
  const result=simulate(t,{devices:'All',hideExit:1603});assert.equal(result.status,1,result.stdout+result.stderr);
  assert.match(result.stdout,/HidHide installation failed/);assert.match(result.stdout,/LAUNCH:.*install-interception.exe/);assert.match(result.stdout,/Interception installed/);
});

test('setup disables only the signed HidHide updater even when the driver is already installed',options,t=>{
  for(const updaterExit of [0,200]){
  const result=simulate(t,{installed:true,updater:true,updaterExit});assert.equal(result.status,0,result.stdout+result.stderr);
  assert.match(result.stdout,/UPDATER:.*nefarius_HidHide_Updater\.exe ARGS:--uninstall --override-success-code 0/);assert.match(result.stdout,/automatic updater startup disabled/);
  assert.doesNotMatch(result.stdout,/LAUNCH:|Stop-Service|UninstallDriver|RemoveClass/);
  }
});

test('updater signature failures and incomplete deregistration are reported instead of claiming success',options,t=>{
  const unsigned=simulate(t,{installed:true,updater:true,validSigner:false});assert.equal(unsigned.status,1);assert.match(unsigned.stdout,/signature could not be verified/);assert.doesNotMatch(unsigned.stdout,/UPDATER:/);
  const sticky=simulate(t,{installed:true,updater:true,stickyUpdater:true});assert.equal(sticky.status,1);assert.match(sticky.stdout,/startup is still registered/);
  const failed=simulate(t,{installed:true,updater:true,updaterExit:5});assert.equal(failed.status,1);assert.match(failed.stdout,/deregistration failed \(code 5\)/);
});

test('uninstall opt-out prevents automatic HidHide reinstall; explicit repair can re-enable it',options,t=>{
  const skipped=simulate(t,{optOut:true});assert.equal(skipped.status,0,skipped.stdout+skipped.stderr);assert.match(skipped.stdout,/automatic installation is off/);assert.doesNotMatch(skipped.stdout,/QUERY:Name='HidHide'|LAUNCH:|UPDATER:/);
  const enabled=simulate(t,{optOut:true,enableHidHide:true});assert.equal(enabled.status,0,enabled.stdout+enabled.stderr);assert.match(enabled.stdout,/LAUNCH:.*HidHide/);assert.match(enabled.stdout,/OPT-OUT-CLEARED/);
  const failed=simulate(t,{optOut:true,enableHidHide:true,hideExit:1603});assert.equal(failed.status,1);assert.doesNotMatch(failed.stdout,/OPT-OUT-CLEARED/);
});

test('default Windows driver setup installs both input drivers and verifies registration without restarting',options,t=>{
  const result=simulate(t,{devices:null,interceptionExit:3010});assert.equal(result.status,0,result.stdout+result.stderr);
  assert.match(result.stdout,/LAUNCH:.*HidHide/);assert.match(result.stdout,/LAUNCH:.*install-interception.exe ARGS:\/install/);assert.match(result.stdout,/Restart Windows before blocking keyboard\/mouse/);
  const failed=simulate(t,{devices:null,interceptionExit:5});assert.equal(failed.status,1);assert.match(failed.stdout,/Interception installation failed \(code 5\)/);
  const missing=simulate(t,{devices:null,missingRegistration:true});assert.equal(missing.status,1);assert.match(missing.stdout,/not registered/);assert.doesNotMatch(missing.stdout,/Setup complete/);
});

test('optional drivers ask separately and remember each answer without automatic restart',options,t=>{
  const skipped=simulate(t,{devices:null,installChoice:'Ask',answer:'n'});assert.equal(skipped.status,0,skipped.stdout+skipped.stderr);assert.doesNotMatch(skipped.stdout,/LAUNCH:|UPDATER:|RESTART YOUR COMPUTER/);assert.match(skipped.stdout,/WRITE:.*input-driver-choice.json VALUE:.*false/);assert.equal(skipped.stdout.match(/PROMPT:/g)?.length,2);
  const remembered=simulate(t,{devices:null,installChoice:'Ask',savedChoice:'skip'});assert.equal(remembered.status,0);assert.doesNotMatch(remembered.stdout,/PROMPT:|LAUNCH:/);
  const accepted=simulate(t,{devices:null,installChoice:'Ask',answer:'yes'});assert.equal(accepted.status,0,accepted.stdout+accepted.stderr);assert.equal(accepted.stdout.match(/PROMPT:/g)?.length,2);assert.match(accepted.stdout,/LAUNCH:.*HidHide/);assert.match(accepted.stdout,/LAUNCH:.*interception/);assert.match(accepted.stdout,/RESTART YOUR COMPUTER/);assert.match(accepted.stdout,/WRITE:.*input-drivers-restart.json VALUE:.*FIXTURE:154/);
  const existing=simulate(t,{devices:null,installed:true,installChoice:'Ask'});assert.equal(existing.status,0);assert.doesNotMatch(existing.stdout,/PROMPT:|LAUNCH:|RESTART YOUR COMPUTER/);
});

test('mixed answers and keyboard/mouse-only setup install only the approved driver',options,t=>{
  const controller=simulate(t,{devices:'All',installChoice:'Ask',answers:['y','n']});assert.equal(controller.status,0,controller.stdout+controller.stderr);assert.match(controller.stdout,/LAUNCH:.*HidHide/);assert.doesNotMatch(controller.stdout,/LAUNCH:.*interception/);
  const keyboard=simulate(t,{devices:'All',installChoice:'Ask',answers:['n','y']});assert.equal(keyboard.status,0,keyboard.stdout+keyboard.stderr);assert.doesNotMatch(keyboard.stdout,/LAUNCH:.*HidHide/);assert.match(keyboard.stdout,/LAUNCH:.*interception/);
  const only=simulate(t,{devices:'Interception'});assert.equal(only.status,0,only.stdout+only.stderr);assert.doesNotMatch(only.stdout,/QUERY:Name='HidHide'|LAUNCH:.*HidHide/);assert.match(only.stdout,/LAUNCH:.*interception/);
});

test('Interception uninstall opt-out preserves controller setup and only explicit repair re-enables it',options,t=>{
  const skipped=simulate(t,{devices:'All',interceptionOptOut:true});assert.equal(skipped.status,0,skipped.stdout+skipped.stderr);assert.match(skipped.stdout,/LAUNCH:.*HidHide/);assert.match(skipped.stdout,/Interception automatic installation is off/);assert.doesNotMatch(skipped.stdout,/LAUNCH:.*interception/);
  const enabled=simulate(t,{devices:'All',interceptionOptOut:true,enableInterception:true});assert.equal(enabled.status,0,enabled.stdout+enabled.stderr);assert.match(enabled.stdout,/LAUNCH:.*interception/);assert.match(enabled.stdout,/OPT-OUT-CLEARED/);
  const failed=simulate(t,{devices:'All',interceptionOptOut:true,enableInterception:true,interceptionExit:5});assert.equal(failed.status,1);assert.doesNotMatch(failed.stdout,/OPT-OUT-CLEARED/);
});

