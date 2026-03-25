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

if not exist "%MCPORTER_ENTRY%" (
    echo Error: bundled mcporter entry not found at %MCPORTER_ENTRY%
    set "_EXIT=1"
    goto finish
)

if not exist "%NODE_EXE%" (
    echo Error: bundled Node.js runtime not found at %NODE_EXE%
    set "_EXIT=1"
    goto finish
)

"%NODE_EXE%" -e "const [maj,min]=process.versions.node.split('.').map(Number);process.exit((maj>22||maj===22&&min>=16)?0:1)" >nul 2>&1
if errorlevel 1 (
    echo Error: bundled Node.js runtime at %NODE_EXE% is too old or failed to start
    set "_EXIT=1"
    goto finish
)

"%NODE_EXE%" "%MCPORTER_ENTRY%" %*
set _EXIT=%ERRORLEVEL%

:finish
if defined _CP chcp %_CP% >nul 2>&1

endlocal & exit /b %_EXIT%
