@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\system\scripts\run.ps1" -Macro guest-input -Role player %*
set "pad_exit=%errorlevel%"
if "%~1"=="" pause
exit /b %pad_exit%
