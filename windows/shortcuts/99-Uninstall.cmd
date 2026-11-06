@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\system\scripts\uninstall.ps1" %*
set "pad_exit=%errorlevel%"
if "%~1"=="" pause
exit /b %pad_exit%
