# Remove only Interception's own keyboard/mouse filters using its upstream
# installer. Never edit Windows input class filters or delete drivers by hand.
function Get-InterceptionRemovalState {
    $registered=$false;$attached=$false;$files=$false
    foreach($entry in @(@('keyboard','{4D36E96B-E325-11CE-BFC1-08002BE10318}'),@('mouse','{4D36E96F-E325-11CE-BFC1-08002BE10318}'))){
        $service=Get-ItemProperty -LiteralPath ('HKLM:\SYSTEM\CurrentControlSet\Services\'+$entry[0]) -ErrorAction SilentlyContinue
        $filter=Get-ItemProperty -LiteralPath ('HKLM:\SYSTEM\CurrentControlSet\Control\Class\'+$entry[1]) -Name UpperFilters -ErrorAction SilentlyContinue
        if($service -and $service.Type -eq 1){$registered=$true}
        if(@($filter.UpperFilters) -contains $entry[0]){$attached=$true}
        if(Test-Path -LiteralPath (Join-Path $env:WINDIR ('System32/drivers/'+$entry[0]+'.sys'))){$files=$true}
    }
    return [pscustomobject]@{Present=($registered -or $attached -or $files);Attached=$attached}
}

function Remove-InterceptionDrivers([string]$root) {
    if(-not (Get-InterceptionRemovalState).Present){Write-Host 'Interception is already uninstalled.';return $false}
    $folder=Join-Path $root '.local/tools/guest-input'
    $installer=Join-Path $folder 'interception-upstream/Interception/command line installer/install-interception.exe'
    $binaryHash='E137863A79DA797F08E7A137280FF2A123809044A888FD75CE9C973198915ABE'
    Assert-LocalPath $installer
    if(Test-Path -LiteralPath $installer){
        if((Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash -ne $binaryHash){throw 'Interception uninstaller verification failed. App files were kept. Restore the official setup files before retrying.'}
    }else{
        Write-Host 'Preparing the official Interception uninstaller (the original setup files are missing).'
        $archive=Join-Path $folder 'Interception.zip'
        Assert-LocalPath $archive
        New-Item -ItemType Directory -Path $folder -Force | Out-Null
        $archiveHash='AD038963D6413055765128B0B931F6E765147C9916DBA79E65D872B261F9AF10'
        if(-not(Test-Path -LiteralPath $archive) -or (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $archiveHash){
            [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
            Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/oblitum/Interception/releases/download/v1.0.1/Interception.zip' -OutFile $archive
        }
        if((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $archiveHash){throw 'Interception download verification failed. App files were kept.'}
        # Extract just this known entry, avoiding arbitrary archive paths.
        Add-Type -AssemblyName System.IO.Compression
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $zip=[IO.Compression.ZipFile]::OpenRead($archive)
        try{
            $entry=$zip.GetEntry('Interception/command line installer/install-interception.exe')
            if(-not $entry){throw 'The pinned Interception archive is missing its uninstaller.'}
            Assert-LocalPath $installer
            New-Item -ItemType Directory -Path (Split-Path -Parent $installer) -Force | Out-Null
            [IO.Compression.ZipFileExtensions]::ExtractToFile($entry,$installer,$true)
        }finally{$zip.Dispose()}
        if((Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash -ne $binaryHash){throw 'Interception uninstaller verification failed. App files were kept.'}
    }
    Write-Host 'Removing Interception keyboard/mouse blocking filters. Windows may ask for administrator access.'
    $process=Start-Process -FilePath $installer -ArgumentList '/uninstall' -Verb RunAs -WindowStyle Hidden -Wait -PassThru
    if($process.ExitCode -notin @(0,3010)){throw "Interception uninstall failed (code $($process.ExitCode)). Restart Windows and retry. App files were kept."}
    if((Get-InterceptionRemovalState).Attached){throw 'Interception filters are still registered. Restart Windows and run uninstall again. App files and the uninstaller were kept.'}
    Write-Host 'Interception removal requested. Restart Windows to unload its keyboard/mouse filters; no automatic restart.'
    return $true
}
