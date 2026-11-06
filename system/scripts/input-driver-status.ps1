# Read-only detection, including registrations that do not appear in CIM before
# their first reboot. Never load a driver, alter filters, install or elevate.
param([switch]$FunctionsOnly)
$ErrorActionPreference='Stop'
function Test-PadInputDriver([string]$name,[string]$classId='') {
    $service=Get-ItemProperty -LiteralPath ('HKLM:\SYSTEM\CurrentControlSet\Services\'+$name) -ErrorAction SilentlyContinue
    if(-not $service -or $service.Type -ne 1 -or $service.Start -eq 4){return $false}
    if(-not(Test-Path -LiteralPath (Join-Path $env:WINDIR ('System32/drivers/'+$name+'.sys')))){return $false}
    if($classId){
        $filter=Get-ItemProperty -LiteralPath ('HKLM:\SYSTEM\CurrentControlSet\Control\Class\'+$classId) -Name UpperFilters -ErrorAction SilentlyContinue
        if(@($filter.UpperFilters) -notcontains $name){return $false}
    }
    return $true
}
if(-not $FunctionsOnly){
    $hide=Test-PadInputDriver 'HidHide'
    $keyboard=Test-PadInputDriver 'keyboard' '{4D36E96B-E325-11CE-BFC1-08002BE10318}'
    $mouse=Test-PadInputDriver 'mouse' '{4D36E96F-E325-11CE-BFC1-08002BE10318}'
    @{hidHide=[bool]$hide;interception=[bool]($keyboard -and $mouse)} | ConvertTo-Json -Compress
}
