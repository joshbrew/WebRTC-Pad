param([ValidateSet('host','player')][string]$Role = 'player', [switch]$NoStart, [switch]$SkipNodeInstall, [switch]$SkipDriverInstall)
& "$PSScriptRoot/run.ps1" -Macro install -Role $Role -SkipNodeInstall:$SkipNodeInstall -SkipDriverInstall:$SkipDriverInstall
exit $LASTEXITCODE
