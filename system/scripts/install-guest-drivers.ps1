param(
    [ValidateSet('Controllers','Interception','All')][string]$Devices='All',
    [switch]$PlanOnly,
    [switch]$EnableHidHide,
    [switch]$EnableInterception,
    [ValidateSet('Ask','Install','Skip')][string]$InstallChoice='Ask',
    [string]$BootId
)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
# Controller setup must not depend on the keyboard/mouse installer.
if($PlanOnly){
    $plannedDrivers=@();if($Devices -ne 'Interception'){$plannedDrivers+='HidHide'};if($Devices -ne 'Controllers'){$plannedDrivers+='Interception'}
    [pscustomobject]@{drivers=$plannedDrivers;automaticRestart=$false;automaticUpdater=$false} | ConvertTo-Json -Compress
    exit 0
}
. (Join-Path $PSScriptRoot 'input-driver-status.ps1') -FunctionsOnly
$failures=@()
$choiceFile=Join-Path $root '.local/input-driver-choice.json'
$driverApprovals=@{hidHide=$null;interception=$null}
if($InstallChoice -eq 'Ask' -and -not $EnableHidHide -and -not $EnableInterception -and (Test-Path -LiteralPath $choiceFile)){
    try{
        $saved=Get-Content -LiteralPath $choiceFile -Raw | ConvertFrom-Json
        if($saved.hidHide -is [bool] -and $saved.interception -is [bool]){$driverApprovals.hidHide=$saved.hidHide;$driverApprovals.interception=$saved.interception}
        elseif($saved.choice -eq 'install'){$InstallChoice='Install'}elseif($saved.choice -eq 'skip'){$InstallChoice='Skip'}
    }catch{}
}
function Confirm-InputDriverInstallation([string]$kind) {
    if($script:InstallChoice -eq 'Ask' -and $null -eq $script:driverApprovals[$kind]){
        $label=if($kind -eq 'hidHide'){'HidHide for controller blocking'}else{'Interception for keyboard/mouse blocking'}
        Write-Host "Optional: $label."
        if($kind -eq 'interception'){Write-Warning 'Interception has a known unplug/replug bug: keyboards or mice may stop responding until Windows restarts, even with this app closed. Choose No to use focused browser input without this driver.'}
        Write-Host 'Regular input sharing, video and voice work without these drivers. Installation needs administrator approval and a Windows restart.'
        Write-Host 'You can install later with windows/shortcuts/09-Guest-Exclusive-Setup.cmd.'
        $answer=Read-Host "Install $label`? [y/N]"
        $script:driverApprovals[$kind]=[bool]($answer -match '^(y|yes)$')
        New-Item -ItemType Directory -Path (Join-Path $root '.local') -Force | Out-Null
        @{hidHide=[bool]$script:driverApprovals.hidHide;interception=[bool]$script:driverApprovals.interception} | ConvertTo-Json -Compress | Set-Content -LiteralPath $choiceFile
    }
    if($script:InstallChoice -eq 'Skip' -or ($script:InstallChoice -eq 'Ask' -and -not $script:driverApprovals[$kind])){Write-Host 'Optional driver installation skipped. Use 09-Guest-Exclusive-Setup to install later.';return $false}
    return $true
}
function Set-InputDriverRestartNotice([string]$driverName) {
    $noticeBoot=$BootId
    if(-not $noticeBoot){
        $currentBoot=(Get-ItemProperty -LiteralPath 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Memory Management\PrefetchParameters' -Name BootId -ErrorAction SilentlyContinue).BootId
        if($null -ne $currentBoot){$noticeBoot="$($env:COMPUTERNAME):$currentBoot"}
    }
    New-Item -ItemType Directory -Path (Join-Path $root '.local') -Force | Out-Null
    $noticeFile=Join-Path $root '.local/input-drivers-restart.json'
    $drivers=@($driverName)
    try{if(Test-Path -LiteralPath $noticeFile){$previous=Get-Content -LiteralPath $noticeFile -Raw | ConvertFrom-Json;if($previous.bootId -eq $noticeBoot){$drivers+=@($previous.drivers) | Where-Object {$_ -in @('HidHide','Interception')}}}}catch{}
    @{bootId=$noticeBoot;drivers=@($drivers | Select-Object -Unique);installedAt=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json -Compress | Set-Content -LiteralPath $noticeFile
    Write-Host '*** RESTART YOUR COMPUTER to finish input-blocking driver setup. Save your work first. Setup will not restart Windows automatically. ***' -ForegroundColor Yellow
}
$optOut=Join-Path $root '.local/hidhide-disabled'
if($Devices -ne 'Interception'){
if((Test-Path -LiteralPath $optOut) -and -not $EnableHidHide){
    Write-Host 'HidHide automatic installation is off. Run 09-Guest-Exclusive-Setup to enable controller blocking again.'
}else {
try {
    $driver=Get-CimInstance Win32_SystemDriver -Filter "Name='HidHide'" -ErrorAction Stop
    if(-not $driver -and (Test-PadInputDriver 'HidHide')){$driver=[pscustomobject]@{Name='HidHide';State='Registered'}}
    if($driver){Write-Host 'Controller input blocking is installed (HidHide).'}
    elseif(Confirm-InputDriverInstallation 'hidHide') {
        Write-Host 'Installing controller input blocking (HidHide). Windows may ask for administrator access.'
        # Pinned official installer/checksum from the winget manifest. No
        # dependency on winget/App Installer or a configured package source.
        $folder=Join-Path $root '.local/tools/guest-input'
        New-Item -ItemType Directory -Force -Path $folder | Out-Null
        $setup=Join-Path $folder 'HidHide_1.5.230_x64.exe'
        $sha='F4BBBCB82E6258641B887C74BC81C4C5F66E4AA811808DFC304347687B7605F6'
        if(-not(Test-Path -LiteralPath $setup) -or (Get-FileHash -LiteralPath $setup -Algorithm SHA256).Hash -ne $sha){
            [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
            Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/nefarius/HidHide/releases/download/v1.5.230.0/HidHide_1.5.230_x64.exe' -OutFile $setup
        }
        if((Get-FileHash -LiteralPath $setup -Algorithm SHA256).Hash -ne $sha){throw 'HidHide download verification failed. Run setup again.'}
        $process=Start-Process -FilePath $setup -ArgumentList '/exenoui /qn /norestart' -Verb RunAs -WindowStyle Hidden -PassThru -Wait
        if($process.ExitCode -notin @(0,3010)){throw "HidHide installation failed (code $($process.ExitCode)). Run setup again and allow the Windows administrator prompt."}
        Set-InputDriverRestartNotice 'HidHide'
        $driver=Get-CimInstance Win32_SystemDriver -Filter "Name='HidHide'" -ErrorAction Stop
        if(-not $driver -and (Test-PadInputDriver 'HidHide')){$driver=[pscustomobject]@{Name='HidHide';State='Registered'}}
        if(-not $driver){throw 'HidHide setup returned but the driver is not registered. Restart Windows and run setup again.'}
        Write-Host 'HidHide installed. Restart Windows, then refresh devices in the app.'
    }
    if($driver -and ($InstallChoice -eq 'Install' -or $driverApprovals.hidHide -eq $true)){
        . (Join-Path $PSScriptRoot 'hidhide-updater.ps1')
        Disable-HidHideUpdater
        if($EnableHidHide -and (Test-Path -LiteralPath $optOut)){Remove-Item -LiteralPath $optOut -Force -ErrorAction Stop}
    }
} catch {$failures+= $_.Exception.Message;Write-Warning $_.Exception.Message}
}
}
if($Devices -ne 'Controllers' -and (Test-Path -LiteralPath (Join-Path $root '.local/interception-disabled')) -and -not $EnableInterception){
    Write-Host 'Interception automatic installation is off. Run 09-Guest-Exclusive-Setup to enable keyboard/mouse blocking again.'
}elseif($Devices -ne 'Controllers'){
    try {
        function Test-InterceptionDriver([string]$name,[string]$classId) {
            # New legacy filter services may not appear in Win32_SystemDriver
            # until reboot. Check persisted registration, file and class filter
            # rather than repeatedly reinstalling a pending-reboot driver.
            $service=Get-ItemProperty -LiteralPath ('HKLM:\SYSTEM\CurrentControlSet\Services\'+$name) -ErrorAction SilentlyContinue
            $filter=Get-ItemProperty -LiteralPath ('HKLM:\SYSTEM\CurrentControlSet\Control\Class\'+$classId) -Name UpperFilters -ErrorAction SilentlyContinue
            return [bool]($service -and $service.Type -eq 1 -and $service.Start -ne 4 -and @($filter.UpperFilters) -contains $name -and (Test-Path -LiteralPath (Join-Path $env:WINDIR ('System32/drivers/'+$name+'.sys'))))
        }
        $keyboard=Test-InterceptionDriver 'keyboard' '{4D36E96B-E325-11CE-BFC1-08002BE10318}'
        $mouse=Test-InterceptionDriver 'mouse' '{4D36E96F-E325-11CE-BFC1-08002BE10318}'
        if($keyboard -and $mouse){Write-Host 'Keyboard/mouse input blocking is installed (Interception).'}
        elseif(Confirm-InputDriverInstallation 'interception') {
            $installer=Join-Path $root '.local/tools/guest-input/interception-upstream/Interception/command line installer/install-interception.exe'
            if(-not(Test-Path -LiteralPath $installer)){throw 'Keyboard/mouse setup files are missing. Run 09-Guest-Exclusive-Setup again.'}
            Write-Host 'Installing keyboard/mouse input blocking (Interception). Windows may ask for administrator access.'
            $process=Start-Process -FilePath $installer -ArgumentList '/install' -Verb RunAs -WindowStyle Hidden -PassThru -Wait
            if($process.ExitCode -notin @(0,3010)){throw "Interception installation failed (code $($process.ExitCode))."}
            Set-InputDriverRestartNotice 'Interception'
            $keyboard=Test-InterceptionDriver 'keyboard' '{4D36E96B-E325-11CE-BFC1-08002BE10318}'
            $mouse=Test-InterceptionDriver 'mouse' '{4D36E96F-E325-11CE-BFC1-08002BE10318}'
            if(-not $keyboard -or -not $mouse){throw 'Interception setup returned but both drivers are not registered. Restart Windows and run setup again.'}
            Write-Host 'Interception installed. Restart Windows before blocking keyboard/mouse input.'
        }
        if($EnableInterception -and ($InstallChoice -eq 'Install' -or $driverApprovals.interception -eq $true) -and $keyboard -and $mouse -and (Test-Path -LiteralPath (Join-Path $root '.local/interception-disabled'))){Remove-Item -LiteralPath (Join-Path $root '.local/interception-disabled') -Force -ErrorAction Stop}
    } catch {$failures+= $_.Exception.Message;Write-Warning $_.Exception.Message}
}
if($failures.Count){throw ($failures -join ' ')}
Write-Host 'Setup complete. Windows will not restart automatically. Keyboard/mouse blocking requires device selection and confirmation in the app.'
