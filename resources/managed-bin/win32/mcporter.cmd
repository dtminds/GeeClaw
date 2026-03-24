@echo off
setlocal

if /i "%1"=="update" (
    echo mcporter is managed by GeeClaw ^(bundled version^).
    echo.
    echo To update mcporter, update GeeClaw:
    echo   Open GeeClaw ^> Settings ^> Check for Updates
    echo   Or download the latest version from https://claw-x.com
    exit /b 0
)

for /f "tokens=2 delims=:." %%a in ('chcp') do set /a "_CP=%%a" 2>nul
chcp 65001 >nul 2>&1

set "NODE_EXE=%~dp0..\bin\node.exe"
set "MCPORTER_ENTRY=%~dp0..\mcporter\dist\cli.js"

set "_USE_BUNDLED_NODE=0"
if exist "%NODE_EXE%" (
    "%NODE_EXE%" -e "const [maj,min]=process.versions.node.split('.').map(Number);process.exit((maj>22||maj===22&&min>=16)?0:1)" >nul 2>&1
    if not errorlevel 1 set "_USE_BUNDLED_NODE=1"
)

if "%_USE_BUNDLED_NODE%"=="1" (
    "%NODE_EXE%" "%MCPORTER_ENTRY%" %*
) else (
    set ELECTRON_RUN_AS_NODE=1
    "%~dp0..\..\GeeClaw.exe" "%MCPORTER_ENTRY%" %*
)
set _EXIT=%ERRORLEVEL%

if defined _CP chcp %_CP% >nul 2>&1

endlocal & exit /b %_EXIT%
