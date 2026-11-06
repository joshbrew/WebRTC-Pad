param(
    [ValidateSet('App','Full','None')][string]$Cleanup,
    [switch]$RemoveHidHide,
    [switch]$RemoveInterception,
    [switch]$Yes,
    [switch]$PlanOnly
)
$ErrorActionPreference='Stop'
try {
    $root=[IO.Path]::GetFullPath((Split-Path -Parent (Split-Path -Parent $PSScriptRoot)))
    $local=Join-Path $root '.local'
    $optOut=Join-Path $local 'hidhide-disabled'
    $interceptionOptOut=Join-Path $local 'interception-disabled'
    $restartNotice=Join-Path $local 'input-drivers-restart.json'
    function Assert-LocalPath([string]$target) {
        $absolute=[IO.Path]::GetFullPath($target)
        if(-not $absolute.StartsWith($root+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Cleanup target is outside this app folder.'}
        # Refuse junctions/symlinks in targets and their ancestors; never follow
        # a link into another installation or someone else's data.
        $cursor=$absolute
        while($cursor){
            if(Test-Path -LiteralPath $cursor){
                if((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){throw "Cleanup stopped at a linked folder/file: $cursor"}
            }
            if($cursor -eq $root){break}
            $cursor=Split-Path -Parent $cursor
        }
    }
    if(-not $Cleanup){
        if($Yes -or $PlanOnly){$Cleanup='App'}
        else {
            Write-Host 'WebRTC Pad uninstall' -ForegroundColor Green
            Write-Host '1. Remove app dependencies and downloaded tools; keep settings and drivers [default]'
            Write-Host '2. Also erase saved app settings, relay configuration and local data'
            Write-Host '3. Remove both blocking drivers: HidHide (controllers) + Interception (keyboard/mouse); keep the app'
            Write-Host '4. Remove only HidHide controller blocking; keep Interception and the app'
            Write-Host '5. Remove only Interception keyboard/mouse blocking; keep HidHide and the app'
            Write-Host 'All options keep ViGEmBus (host virtual controllers), Node.js and Python.'
            Write-Host '0. Cancel'
            $choice=Read-Host 'Choose [1]'
            switch($choice){'0'{exit 0};'2'{$Cleanup='Full'};'3'{$Cleanup='None';$RemoveHidHide=$true;$RemoveInterception=$true};'4'{$Cleanup='None';$RemoveHidHide=$true};'5'{$Cleanup='None';$RemoveInterception=$true};'1'{$Cleanup='App'};''{$Cleanup='App'};default{throw 'Choose 0, 1, 2, 3, 4 or 5.'}}
            if($Cleanup -ne 'None' -and -not $RemoveHidHide -and -not $RemoveInterception){
                if((Read-Host 'Also remove HidHide (controller blocking) AND Interception (keyboard/mouse blocking)? Other apps may use them [y/N]') -eq 'y'){$RemoveHidHide=$true;$RemoveInterception=$true}
            }
        }
    }
    $targets=@()
    if($Cleanup -ne 'None'){$targets+=Join-Path $root 'node_modules'}
    if($Cleanup -eq 'App'){$targets+=Join-Path $local 'tools';$targets+=Join-Path $local 'install.json'}
    if($Cleanup -eq 'Full'){
        Assert-LocalPath $local
        if(Test-Path -LiteralPath $local){$targets+=Get-ChildItem -LiteralPath $local -Force | Where-Object {$_.Name -notin @('hidhide-disabled','interception-disabled') -and -not (($_.Name -eq 'input-drivers-restart.json') -and ($RemoveHidHide -or $RemoveInterception))} | ForEach-Object {$_.FullName}}
        $targets+=Join-Path $root '.env'
    }
    # Validate the entire tree before deleting anything. Recursive enumeration
    # does not follow directory reparse points, which are explicitly rejected.
    foreach($target in $targets){
        Assert-LocalPath $target
        if(Test-Path -LiteralPath $target){
            $item=Get-Item -LiteralPath $target -Force
            if($item.PSIsContainer){Get-ChildItem -LiteralPath $target -Recurse -Force | ForEach-Object {Assert-LocalPath $_.FullName}}
        }
    }
    if($RemoveHidHide){Assert-LocalPath $optOut}
    if($RemoveInterception){Assert-LocalPath $interceptionOptOut}
    if($RemoveHidHide -or $RemoveInterception){Assert-LocalPath $restartNotice}
    $products=@()
    if($RemoveHidHide){
        $products=@(Get-ItemProperty -Path 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue | Where-Object {$_.DisplayName -eq 'HidHide'})
        foreach($product in $products){
            if($product.Publisher -notmatch '^Nefarius Software Solutions(?: e\.U\.)?$' -or $product.PSChildName -notmatch '^\{[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}\}$'){throw 'HidHide has an unsupported uninstall registration. Remove it through Windows Installed apps.'}
        }
    }
    Write-Host "Cleanup: $Cleanup."
    Write-Host $(if($RemoveHidHide){'REMOVE: HidHide - local controller input blocking.'}else{'KEEP: HidHide - local controller input blocking.'})
    Write-Host $(if($RemoveInterception){'REMOVE: Interception - local keyboard/mouse input blocking filters.'}else{'KEEP: Interception - local keyboard/mouse input blocking filters.'})
    Write-Host 'KEEP: ViGEmBus (host virtual controllers), standard Windows input drivers, Node.js, Python and app source.'
    if($Cleanup -eq 'Full'){Write-Host 'This erases .env and local data, including relay credentials and backups.'}
    foreach($target in $targets){Write-Host "Remove: $target"}
    if($PlanOnly){Write-Host 'Preview only. Nothing changed.';exit 0}
    if($Cleanup -eq 'None' -and -not $RemoveHidHide -and -not $RemoveInterception){Write-Host 'Nothing selected.';exit 0}
    # Never kill unrelated Node processes or delete tools while any copy of
    # this installation still owns devices. Relative launches are conservative.
    $running=@(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object {
        $_.ProcessId -ne $PID -and (
            ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase)) -or
            ($_.Name -match '^(node|python|python3|pythonw)\.exe$' -and $_.CommandLine -and (
                $_.CommandLine.IndexOf($root,[StringComparison]::OrdinalIgnoreCase) -ge 0 -or
                $_.CommandLine -match 'system[/\\](?:scripts[/\\](?:launch|run|demo-local|session-server)\.mjs|src[/\\]server\.js)'
            ))
        )
    })
    if($running.Count){throw 'Close the app console and any running WebRTC Pad helpers, then run uninstall again. No processes were killed.'}
    if(-not $Yes -and (Read-Host 'Continue with the cleanup shown above? [y/N]') -ne 'y'){Write-Host 'Cancelled.';exit 0}
    $journal=Join-Path $local 'tools/guest-input/guest-hide-recovery.json'
    if(Test-Path -LiteralPath $journal){
        $reader=Join-Path $local 'tools/guest-input/webrtc-pad-guest.exe'
        Assert-LocalPath $journal;Assert-LocalPath $reader
        if(-not(Test-Path -LiteralPath $reader)){throw 'Controller recovery is pending but the reader is missing. Restore guest setup and release devices before uninstalling. Recovery data was kept.'}
        Write-Host 'Restoring this app''s controller blocking rules.'
        $recovery=Start-Process -FilePath $reader -ArgumentList '--recover' -WindowStyle Hidden -Wait -PassThru
        if($recovery.ExitCode -ne 0 -or (Test-Path -LiteralPath $journal)){throw 'Controller recovery did not finish. Close HidHide Configuration Client and retry. Recovery data was kept.'}
    }
    if($RemoveHidHide -or $RemoveInterception){
        # Persist the user's choice even if UAC is cancelled or Windows needs
        # a restart; normal launch must not silently reinstall the driver.
        New-Item -ItemType Directory -Path $local -Force | Out-Null
        if($RemoveHidHide){Set-Content -LiteralPath $optOut -Value 'HidHide automatic installation disabled by uninstall.'}
        if($RemoveInterception){Set-Content -LiteralPath $interceptionOptOut -Value 'Interception automatic installation disabled by uninstall.'}
        $setupCache=Join-Path $local 'tools/guest-input/setup-check.json'
        Assert-LocalPath $setupCache
        if(Test-Path -LiteralPath $setupCache){Remove-Item -LiteralPath $setupCache -Force}
    }
    $restartNeeded=$false
    function Save-RemovalRestartNotice {
        $boot=(Get-ItemProperty -LiteralPath 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Memory Management\PrefetchParameters' -Name BootId -ErrorAction SilentlyContinue).BootId
        $bootId=if($null -ne $boot){"$($env:COMPUTERNAME):$boot"}else{$null}
        @{bootId=$bootId;action='remove'} | ConvertTo-Json -Compress | Set-Content -LiteralPath $restartNotice
        Write-Host '*** RESTART YOUR COMPUTER to finish removing the selected input-blocking drivers. Save your work first. ***' -ForegroundColor Yellow
    }
    if($RemoveInterception){
        . (Join-Path $PSScriptRoot 'interception-uninstall.ps1')
        $restartNeeded=Remove-InterceptionDrivers $root
        if($restartNeeded){Save-RemovalRestartNotice}
    }
    if($RemoveHidHide){
        . (Join-Path $PSScriptRoot 'hidhide-updater.ps1')
        Disable-HidHideUpdater
        foreach($product in $products){
            Write-Host 'Uninstalling HidHide. Windows may ask for administrator access.'
            $process=Start-Process -FilePath (Join-Path $env:WINDIR 'System32/msiexec.exe') -ArgumentList "/x $($product.PSChildName) /passive /norestart REBOOT=ReallySuppress" -Verb RunAs -WindowStyle Hidden -Wait -PassThru
            if($process.ExitCode -notin @(0,1605,3010)){throw "HidHide uninstall failed (code $($process.ExitCode)). App files were kept. Retry or use Windows Installed apps."}
        }
        if(-not $products.Count){
            if(Get-CimInstance Win32_SystemDriver -Filter "Name='HidHide'" -ErrorAction Stop){throw 'HidHide is present without a registered uninstaller. Use Windows Installed apps or repair HidHide before removing it. App files were kept.'}
            Write-Host 'HidHide is already uninstalled.'
        }else{$restartNeeded=$true;Write-Host 'HidHide removal finished. Restart Windows to unload its filter; no automatic restart.';Save-RemovalRestartNotice}
        Write-Host 'HidHide will stay off on future starts. Run 09-Guest-Exclusive-Setup to install it again.'
    }
    foreach($target in $targets){
        # Recheck immediately before a destructive operation.
        Assert-LocalPath $target
        if(Test-Path -LiteralPath $target){Remove-Item -LiteralPath $target -Force -Recurse -ErrorAction Stop}
    }
    Write-Host 'Cleanup complete. You can delete the app folder if you no longer want its source files.' -ForegroundColor Green
    if($Cleanup -eq 'App'){Write-Host 'Settings and other local data were kept. Start will download missing app dependencies again.'}
    Write-Host 'Browser preferences/site data, router forwarding rules and separately running relay containers are not removed.'
} catch {Write-Host "Uninstall: $($_.Exception.Message)" -ForegroundColor Red;exit 1}
