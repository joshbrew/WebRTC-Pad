# HidHide 1.5 bundles an independent updater. Use its own uninstall command,
# matching Setup/HidHide.aip, rather than altering driver/watchdog services.
function Disable-HidHideUpdater {
    [CmdletBinding()]
    param()
    $updaterName='nefarius_HidHide_Updater'
    $runKeys=@('HKCU:\Software\Microsoft\Windows\CurrentVersion\Run','HKLM:\Software\Microsoft\Windows\CurrentVersion\Run','HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Run')
    function Get-HidHideUpdaterRuns {
        foreach($key in $runKeys){
            if(Test-Path -LiteralPath $key){
                $value=Get-ItemProperty -LiteralPath $key -Name $updaterName -ErrorAction SilentlyContinue
                if($value -and $value.$updaterName){[pscustomobject]@{Key=$key;Command=[string]$value.$updaterName}}
            }
        }
    }
    function Get-HidHideUpdaterTask {
        Get-ScheduledTask -TaskName $updaterName -TaskPath '\' -ErrorAction SilentlyContinue
    }
    $runs=@(Get-HidHideUpdaterRuns)
    $task=Get-HidHideUpdaterTask
    if(-not $runs.Count -and (-not $task -or $task.State -eq 'Disabled')){Write-Host 'HidHide automatic updater is already disabled.';return}
    $candidates=@()
    foreach($base in @($env:ProgramW6432,$env:ProgramFiles,${env:ProgramFiles(x86)})){
        if($base){foreach($relative in @('Nefarius Software Solutions\HidHide\x64\nefarius_HidHide_Updater.exe','Nefarius Software Solutions\HidHide\nefarius_HidHide_Updater.exe')){$candidates+=Join-Path $base $relative}}
    }
    # The registry can describe a custom install location; never execute its
    # command line. Extract only the exact updater filename and verify its signer.
    foreach($run in $runs){if($run.Command -match '^"([^"]+\\nefarius_HidHide_Updater\.exe)"(?:\s|$)'){$candidates+=$Matches[1]}}
    $updater=$candidates | Select-Object -Unique | Where-Object {Test-Path -LiteralPath $_} | Select-Object -First 1
    if(-not $updater){throw 'HidHide updater startup entries exist but its executable is missing. Repair HidHide, then run setup again.'}
    $signature=Get-AuthenticodeSignature -LiteralPath $updater
    if($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch '(?:^|,\s*)O=Nefarius Software Solutions(?: e\.U\.)?(?:,|$)'){throw 'HidHide updater signature could not be verified. Its startup settings were not changed.'}
    Write-Host 'Disabling HidHide automatic updater startup. Windows may ask for administrator access.'
    $process=Start-Process -FilePath $updater -ArgumentList '--uninstall --override-success-code 0' -Verb RunAs -WindowStyle Hidden -PassThru -Wait
    # vicius normally reports success as 200; use the installer's override and
    # also accept that documented default before verifying actual startup state.
    if($process.ExitCode -notin @(0,200)){throw "HidHide updater deregistration failed (code $($process.ExitCode)). Run setup again and allow the administrator prompt."}
    # When UAC uses a different administrator account, remove the invoking
    # user's matching autorun too. Do not touch another executable's entry.
    $userRun=@(Get-HidHideUpdaterRuns) | Where-Object {$_.Key -like 'HKCU:*'}
    foreach($run in $userRun){
        if($run.Command -match '^"([^"]+\\nefarius_HidHide_Updater\.exe)"(?:\s|$)' -and [IO.Path]::GetFullPath($Matches[1]) -eq [IO.Path]::GetFullPath($updater)){
            Remove-ItemProperty -LiteralPath $run.Key -Name $updaterName -ErrorAction Stop
        }
    }
    $task=Get-HidHideUpdaterTask
    if(@(Get-HidHideUpdaterRuns).Count -or ($task -and $task.State -ne 'Disabled')){throw 'HidHide updater startup is still registered. Run guest setup again to finish disabling it.'}
    Write-Host 'HidHide automatic updater startup disabled. Driver and watchdog remain installed.'
}
