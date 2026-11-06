param(
    [ValidateSet('host', 'player')][string]$Role,
    [ValidateSet('start','host','join','native','configure','relay','recovery','install','guest-input','session-server')][string]$Macro = 'start',
    [switch]$NoBrowser,
    [switch]$SkipNodeInstall,
    [switch]$SkipDriverInstall
)
$ErrorActionPreference = 'Stop'
$explicitRole = $PSBoundParameters.ContainsKey('Role')
try {
    $projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
    Set-Location -LiteralPath $projectRoot
    Write-Host 'WebRTC Pad setup' -ForegroundColor Green
    if (-not $Role) {
        if ($Macro -in @('host','native')) { $Role = 'host' }
        elseif ($Macro -in @('join','guest-input','session-server')) { $Role = 'player' }
        elseif (Test-Path -LiteralPath '.local/install.json') { $Role = (Get-Content -LiteralPath '.local/install.json' -Raw | ConvertFrom-Json).role }
        elseif ($Macro -eq 'start') { $Role = 'player' }
        elseif ([Console]::IsInputRedirected -or $Macro -in @('configure','relay','recovery')) { $Role = 'player' }
        else { $selection = Read-Host '1. Join a friend  2. Host a game [1]'; if ($selection -eq '2') { $Role = 'host' } else { $Role = 'player' } }
    }
    $Role = $Role.ToLowerInvariant()
    function Find-Node {
        $command = Get-Command node.exe -ErrorAction SilentlyContinue
        if ($command) { return $command.Source }
        $standardNode = Join-Path $env:ProgramFiles 'nodejs\node.exe'
        if (Test-Path -LiteralPath $standardNode) { return $standardNode }
        return $null
    }
    $nodePath = Find-Node
    $runtimeReady = $false
    if ($nodePath) {
        $versionText = & $nodePath --version
        if ($LASTEXITCODE -eq 0) { $runtimeReady = ([version]($versionText.TrimStart('v')) -ge [version]'22.9.0') }
    }
    $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
    if (-not $runtimeReady) {
        if ($SkipNodeInstall -or -not $winget) { throw 'Install Node.js 22.9 or newer from https://nodejs.org/en/download, then run the Host or Join shortcut again.' }
        Write-Host 'Installing Node.js LTS through Windows Package Manager. Windows may request administrator access.'
        & $winget.Source install --exact --id OpenJS.NodeJS.LTS --source winget --accept-source-agreements --accept-package-agreements
        if ($LASTEXITCODE -ne 0) { throw 'Node installation did not complete. Install it from https://nodejs.org/en/download and run setup again.' }
        $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User') + ';' + $env:Path
        $nodePath = Find-Node
        if (-not $nodePath -or -not (& $nodePath -e "const [a,b]=process.versions.node.split('.').map(Number);console.log(a>22||(a===22&&b>=9)?'ready':'')")) { throw 'Node was installed. Close this window and run the Host or Join shortcut again to refresh your PATH.' }
    }
    $env:Path = (Split-Path -Parent $nodePath) + ';' + $env:Path
    # Guest drivers are checked by run.mjs after preparing their installer
    # files. Reusing a running app never installs drivers under that session.
    $startupJson = & $nodePath --env-file-if-exists=.env system/scripts/run.mjs --status
    if ($LASTEXITCODE -ne 0) { throw 'Could not check app dependencies. See the message above.' }
    $startupStatus = $startupJson | ConvertFrom-Json
    $prepareHost = $Role -eq 'host' -or $Macro -eq 'start'
    if (-not $startupStatus.busy -and $startupStatus.hostControllers -and -not $startupStatus.hostDriverReady -and $prepareHost -and $Macro -in @('start','host','native','install') -and -not $SkipDriverInstall) {
        if ($winget) {
            Write-Host 'Installing the pinned ViGEmBus 1.22.0 host driver. Windows may request administrator access; a restart may be required.'
            & $winget.Source install --exact --id ViGEm.ViGEmBus --version 1.22.0 --force --source winget --accept-source-agreements --accept-package-agreements
            if ($LASTEXITCODE -ne 0) { Write-Warning 'Driver installation needs attention. The app will still install; see system/docs/install.md.' }
        } else { Write-Warning 'Install ViGEmBus from https://github.com/nefarius/ViGEmBus/releases/tag/v1.22.0 for host controller support.' }
    }
    $runArgs = @('--env-file-if-exists=.env', 'system/scripts/run.mjs', $Macro)
    if ($Macro -ne 'start' -or $explicitRole) { $runArgs += "--$Role" }
    if ($NoBrowser) { $runArgs += '--no-browser' }
    if ($SkipDriverInstall) { $runArgs += '--skip-guest-input' }
    & $nodePath @runArgs
    exit $LASTEXITCODE
} catch { Write-Host "Setup: $($_.Exception.Message)" -ForegroundColor Red; exit 1 }
