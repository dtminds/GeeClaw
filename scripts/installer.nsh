; GeeClaw Custom NSIS Installer/Uninstaller Script
;
; Install: enables long paths.
; Uninstall: optionally deletes GeeClaw app data while preserving managed OpenClaw state.

!ifndef nsProcess::FindProcess
  !include "nsProcess.nsh"
!endif

!macro customHeader
  ; Show install details by default so users can see what stage is running.
  ShowInstDetails show
  ShowUninstDetails show
!macroend

!macro customCheckAppRunning
  ; Make stage logs visible on assisted installers (defaults to hidden).
  SetDetailsPrint both
  DetailPrint "Preparing installation..."
  DetailPrint "Extracting ${PRODUCT_NAME} runtime files. This can take a few minutes on slower disks or while antivirus scanning is active."

  ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0

  ${if} $R0 == 0
    ${if} ${isUpdated}
      ; Auto-update: GeeClaw is already quitting via quitAndInstall(). Give the
      ; before-quit cleanup path time to stop Gateway before forcing anything.
      DetailPrint `Waiting for "${PRODUCT_NAME}" to finish shutting down...`
      Sleep 8000
      ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
      ${if} $R0 != 0
        nsExec::ExecToStack 'taskkill /F /T /IM openclaw-gateway.exe'
        Pop $0
        Pop $1
        Goto done_killing
      ${endIf}
    ${endIf}

    ${if} ${isUpdated}
    ${else}
      MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(appRunning)" /SD IDOK IDOK doStopProcess
      Quit
    ${endIf}

    doStopProcess:
    DetailPrint `Closing running "${PRODUCT_NAME}"...`

    ; Kill any process whose executable lives inside $INSTDIR. This covers the
    ; main GeeClaw process plus helper children that can keep files locked.
    System::Call 'kernel32::GetCurrentProcessId() i .R2'
    System::Call 'kernel32::SetEnvironmentVariable(t "TARGET_INSTDIR", t "$INSTDIR") i .R3'
    nsExec::ExecToStack `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Get-CimInstance -ClassName Win32_Process | Where-Object { $$_.ProcessId -ne $R2 -and $$_.ExecutablePath -and $$_.ExecutablePath.StartsWith(($$env:TARGET_INSTDIR.TrimEnd('\') + '\'), [System.StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"`
    Pop $0
    Pop $1

    ${if} $0 != 0
      ; PowerShell failed (policy restriction, etc.) — fall back to name-based kill.
      nsExec::ExecToStack 'taskkill /F /T /IM "${APP_EXECUTABLE_FILENAME}"'
      Pop $0
      Pop $1
    ${endIf}

    ; Also kill the bundled Gateway in case it detached from the main process.
    nsExec::ExecToStack 'taskkill /F /T /IM openclaw-gateway.exe'
    Pop $0
    Pop $1

    ; Give Windows / antivirus time to release handles.
    Sleep 5000
    DetailPrint "Processes terminated. Continuing installation..."

    done_killing:
      ${nsProcess::Unload}
  ${endIf}

  ; Even if GeeClaw.exe was not detected as running, orphan helper processes
  ; from a previous crash or unfinished update can still hold file locks.
  System::Call 'kernel32::GetCurrentProcessId() i .R2'
  System::Call 'kernel32::SetEnvironmentVariable(t "TARGET_INSTDIR", t "$INSTDIR") i .R3'
  nsExec::ExecToStack `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Get-CimInstance -ClassName Win32_Process | Where-Object { $$_.ProcessId -ne $R2 -and $$_.ExecutablePath -and $$_.ExecutablePath.StartsWith(($$env:TARGET_INSTDIR.TrimEnd('\') + '\'), [System.StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"`
  Pop $0
  Pop $1

  ; Belt-and-suspenders cleanup for the main app and Gateway process names.
  nsExec::ExecToStack 'taskkill /F /T /IM "${APP_EXECUTABLE_FILENAME}"'
  Pop $0
  Pop $1
  nsExec::ExecToStack 'taskkill /F /T /IM openclaw-gateway.exe'
  Pop $0
  Pop $1

  ; Brief wait for handle release.
  Sleep 2000

  ; Release NSIS's CWD on $INSTDIR before trying to move the old install tree.
  SetOutPath $TEMP

  ; Move the existing install out of the way so the new payload can be copied
  ; in even if the old tree still has read-only handles from AV / indexing.
  IfFileExists "$INSTDIR\" 0 _instdir_clean
    StrCpy $R8 0
  _find_free_stale:
    IfFileExists "$INSTDIR._stale_$R8\" 0 _found_free_stale
    IntOp $R8 $R8 + 1
    Goto _find_free_stale

  _found_free_stale:
    ClearErrors
    Rename "$INSTDIR" "$INSTDIR._stale_$R8"
    IfErrors 0 _stale_moved
      nsExec::ExecToStack 'cmd.exe /c rd /s /q "$INSTDIR"'
      Pop $0
      Pop $1
      Sleep 2000
      CreateDirectory "$INSTDIR"
      Goto _instdir_clean
  _stale_moved:
    CreateDirectory "$INSTDIR"
  _instdir_clean:

  ; Skip electron-builder's old-uninstaller retry loop. Once the blocking
  ; processes are gone, the new installer can overwrite the existing tree.
  DeleteRegValue SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" UninstallString
  DeleteRegValue SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" QuietUninstallString
  DeleteRegValue HKCU "${UNINSTALL_REGISTRY_KEY}" UninstallString
  DeleteRegValue HKCU "${UNINSTALL_REGISTRY_KEY}" QuietUninstallString
  !ifdef UNINSTALL_REGISTRY_KEY_2
    DeleteRegValue SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY_2}" UninstallString
    DeleteRegValue SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY_2}" QuietUninstallString
    DeleteRegValue HKCU "${UNINSTALL_REGISTRY_KEY_2}" UninstallString
    DeleteRegValue HKCU "${UNINSTALL_REGISTRY_KEY_2}" QuietUninstallString
  !endif
!macroend

!macro customUnInstallCheck
  ${if} $R0 != 0
    DetailPrint "Old uninstaller exited with code $R0. Continuing with overwrite install..."
  ${endIf}
  ClearErrors
!macroend

!macro customUnInstallCheckCurrentUser
  ${if} $R0 != 0
    DetailPrint "Old uninstaller (current user) exited with code $R0. Continuing..."
  ${endIf}
  ClearErrors
!macroend

!macro customInstall
  ; Async cleanup of stale directories left by the rename loop above.
  IfFileExists "$INSTDIR._stale_0\" 0 _ci_stale_cleaned
    ExecShell "" "cmd.exe" `/c ping -n 61 127.0.0.1 >nul & cd /d "$INSTDIR\.." & for /d %D in ("$INSTDIR._stale_*") do rd /s /q "%D"` SW_HIDE
  _ci_stale_cleaned:

  ; Enable Windows long path support (Windows 10 1607+ / Windows 11).
  ; pnpm virtual store paths can exceed the default MAX_PATH limit of 260 chars.
  ; Writing to HKLM requires admin privileges; on per-user installs without
  ; elevation this call silently fails — no crash, just no key written.
  WriteRegDWORD HKLM "SYSTEM\CurrentControlSet\Control\FileSystem" "LongPathsEnabled" 1

!macroend

!macro customUnInstall
  ; Kill lingering GeeClaw processes so uninstalling app files does not depend
  ; on the user's choice about preserving data directories.
  ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
  ${if} $R0 == 0
    nsExec::ExecToStack 'taskkill /F /T /IM "${APP_EXECUTABLE_FILENAME}"'
    Pop $0
    Pop $1
  ${endIf}
  ${nsProcess::Unload}

  ; Also kill the bundled Gateway if it detached from the Electron process tree.
  nsExec::ExecToStack 'taskkill /F /T /IM openclaw-gateway.exe'
  Pop $0
  Pop $1

  ; Give Windows a moment to release file handles after process shutdown.
  Sleep 2000

  ; Ask user if they want to remove GeeClaw app data while preserving the
  ; managed OpenClaw state directory (~/.openclaw-geeclaw).
  MessageBox MB_YESNO|MB_ICONQUESTION \
    "Do you want to remove GeeClaw application data?$\r$\n$\r$\nThis will delete:$\r$\n  • .geeclaw folder (GeeClaw settings, logs, and installed terminal shims)$\r$\n  • AppData\Local\geeclaw (local app data)$\r$\n  • AppData\Roaming\geeclaw (roaming app data)$\r$\n$\r$\nYour .openclaw-geeclaw folder (managed OpenClaw state) will be preserved.$\r$\nSelect 'No' to keep all data for future reinstallation." \
    /SD IDNO IDYES _cu_removeData IDNO _cu_skipRemove

  _cu_removeData:
    ; --- Always remove current user's app data first ---
    RMDir /r "$PROFILE\.geeclaw"
    RMDir /r "$LOCALAPPDATA\geeclaw"
    RMDir /r "$APPDATA\geeclaw"

    ; Retry AppData cleanup if files were still in use on the first attempt.
    IfFileExists "$LOCALAPPDATA\geeclaw\" 0 _cu_localDone
      Sleep 3000
      RMDir /r "$LOCALAPPDATA\geeclaw"
      IfFileExists "$LOCALAPPDATA\geeclaw\" 0 _cu_localDone
        nsExec::ExecToStack 'cmd.exe /c rd /s /q "$LOCALAPPDATA\geeclaw"'
        Pop $0
        Pop $1
    _cu_localDone:

    IfFileExists "$APPDATA\geeclaw\" 0 _cu_roamingDone
      Sleep 3000
      RMDir /r "$APPDATA\geeclaw"
      IfFileExists "$APPDATA\geeclaw\" 0 _cu_roamingDone
        nsExec::ExecToStack 'cmd.exe /c rd /s /q "$APPDATA\geeclaw"'
        Pop $0
        Pop $1
    _cu_roamingDone:

    IfFileExists "$PROFILE\.geeclaw\" 0 _cu_profileDone
      Sleep 2000
      RMDir /r "$PROFILE\.geeclaw"
      IfFileExists "$PROFILE\.geeclaw\" 0 _cu_profileDone
        nsExec::ExecToStack 'cmd.exe /c rd /s /q "$PROFILE\.geeclaw"'
        Pop $0
        Pop $1
    _cu_profileDone:

    ; --- For per-machine (all users) installs, enumerate all user profiles ---
    StrCpy $R0 0

  _cu_enumLoop:
    EnumRegKey $R1 HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList" $R0
    StrCmp $R1 "" _cu_enumDone

    ReadRegStr $R2 HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\$R1" "ProfileImagePath"
    StrCmp $R2 "" _cu_enumNext

    ExpandEnvStrings $R3 $R2
    StrCmp $R3 $PROFILE _cu_enumNext

    RMDir /r "$R3\.geeclaw"
    RMDir /r "$R3\AppData\Local\geeclaw"
    RMDir /r "$R3\AppData\Roaming\geeclaw"

  _cu_enumNext:
    IntOp $R0 $R0 + 1
    Goto _cu_enumLoop

  _cu_enumDone:
  _cu_skipRemove:
!macroend
