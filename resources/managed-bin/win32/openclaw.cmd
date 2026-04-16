@echo off
setlocal
set "STATE_DIR=%USERPROFILE%\.openclaw-geeclaw"
set "CONFIG_PATH=%STATE_DIR%\openclaw.json"
set "PROFILE_NAME=geeclaw"
set "PROFILE_VALUE="

if /i "%1"=="update" (
    echo openclaw is managed by GeeClaw ^(bundled version^).
    echo.
    echo To update openclaw, update GeeClaw:
    echo   Open GeeClaw ^> Settings ^> Check for Updates
    echo   Or download the latest version from https://www.geeclaw.cn
    exit /b 0
)

rem Switch console to UTF-8 so Unicode box-drawing and CJK text render correctly
rem on non-English Windows (e.g. Chinese CP936). Save the previous codepage to restore later.
for /f "tokens=2 delims=:." %%a in ('chcp') do set /a "_CP=%%a" 2>nul
chcp 65001 >nul 2>&1

call :inspect_profile %*
if defined PROFILE_VALUE if /i not "%PROFILE_VALUE%"=="%PROFILE_NAME%" (
    echo Error: GeeClaw wrapper only supports --profile %PROFILE_NAME% ^(got: %PROFILE_VALUE%^)
    set "_EXIT=1"
    goto finish
)

set OPENCLAW_EMBEDDED_IN=GeeClaw
set "OPENCLAW_STATE_DIR=%STATE_DIR%"
set "OPENCLAW_CONFIG_PATH=%CONFIG_PATH%"
set "NODE_EXE=%~dp0..\bin\node.exe"
set "LEGACY_ENTRY=%~dp0..\openclaw\openclaw.mjs"

if defined GEECLAW_USER_DATA_DIR (
    set "USER_DATA_DIR=%GEECLAW_USER_DATA_DIR%"
) else if defined APPDATA (
    set "USER_DATA_DIR=%APPDATA%\GeeClaw"
) else (
    set "USER_DATA_DIR=%USERPROFILE%\AppData\Roaming\GeeClaw"
)

set "SIDECAR_ENTRY=%USER_DATA_DIR%\runtime\openclaw-sidecar\openclaw.mjs"
if exist "%SIDECAR_ENTRY%" (
    set "OPENCLAW_ENTRY=%SIDECAR_ENTRY%"
) else (
    set "OPENCLAW_ENTRY=%LEGACY_ENTRY%"
)

if not exist "%OPENCLAW_ENTRY%" (
    echo Error: bundled openclaw entry not found at %OPENCLAW_ENTRY%
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

if defined PROFILE_VALUE (
    "%NODE_EXE%" "%OPENCLAW_ENTRY%" %*
) else (
    "%NODE_EXE%" "%OPENCLAW_ENTRY%" --profile "%PROFILE_NAME%" %*
)
set _EXIT=%ERRORLEVEL%

goto finish

:inspect_profile
if "%~1"=="" goto :eof
if /i "%~1"=="--profile" (
    set "PROFILE_VALUE=%~2"
    goto :eof
)
set "ARG=%~1"
setlocal enabledelayedexpansion
if /i "!ARG:~0,10!"=="--profile=" (
    endlocal & set "PROFILE_VALUE=%ARG:~10%" & goto :eof
)
endlocal
shift
goto inspect_profile

:finish
if defined _CP chcp %_CP% >nul 2>&1

endlocal & exit /b %_EXIT%
