@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0system\scripts\run.ps1" -Macro start %*
set "pad_exit=%errorlevel%"
if not "%pad_exit%"=="0" if "%~1"=="" pause
exit /b %pad_exit%
