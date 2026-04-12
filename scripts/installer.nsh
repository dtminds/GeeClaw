; GeeClaw Custom NSIS Installer/Uninstaller Script
;
; Install: enables long paths.
; Uninstall: optionally deletes GeeClaw-managed user data.

!ifndef nsProcess::FindProcess
  !include "nsProcess.nsh"
!endif

!macro customCheckAppRunning
  ; Pre-emptively remove old shortcuts to prevent the Windows "Missing Shortcut"
  ; dialog during upgrades.  The built-in NSIS uninstaller deletes GeeClaw.exe
  ; *before* removing shortcuts; Windows Shell link tracking can detect the
  ; broken target in that brief window and pop a resolver dialog.
  ; Delete is a silent no-op when the file doesn't exist (safe for fresh installs).
  Delete "$DESKTOP\${PRODUCT_NAME}.lnk"
  Delete "$SMPROGRAMS\${PRODUCT_NAME}.lnk"

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
        nsExec::ExecToStack 'taskkill /F /IM openclaw-gateway.exe'
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
    nsExec::ExecToStack 'taskkill /F /IM openclaw-gateway.exe'
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
  nsExec::ExecToStack 'taskkill /F /IM openclaw-gateway.exe'
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
  ; Ask user if they want to completely remove all user data
  MessageBox MB_YESNO|MB_ICONQUESTION \
    "Do you want to completely remove all GeeClaw user data?$\r$\n$\r$\nThis will delete:$\r$\n  • .geeclaw folder (GeeClaw-managed OpenClaw state)$\r$\n  • AppData\Local\geeclaw (local app data)$\r$\n  • AppData\Roaming\geeclaw (roaming app data)$\r$\n$\r$\nSelect 'No' to keep your data for future reinstallation." \
    /SD IDNO IDYES _cu_removeData IDNO _cu_skipRemove

  _cu_removeData:
    ; --- Always remove current user's data first ---
    RMDir /r "$PROFILE\.geeclaw"
    RMDir /r "$LOCALAPPDATA\geeclaw"
    RMDir /r "$APPDATA\geeclaw"

    ; --- For per-machine (all users) installs, enumerate all user profiles ---
    StrCpy $R0 0

  _cu_enumLoop:
    EnumRegKey $R1 HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList" $R0
    StrCmp $R1 "" _cu_enumDone

    ReadRegStr $R2 HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\$R1" "ProfileImagePath"
    StrCmp $R2 "" _cu_enumNext

    ExpandEnvStrings $R2 $R2
    StrCmp $R2 $PROFILE _cu_enumNext

    RMDir /r "$R2\.geeclaw"
    RMDir /r "$R2\AppData\Local\geeclaw"
    RMDir /r "$R2\AppData\Roaming\geeclaw"

  _cu_enumNext:
    IntOp $R0 $R0 + 1
    Goto _cu_enumLoop

  _cu_enumDone:
  _cu_skipRemove:
!macroend
