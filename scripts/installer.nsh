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

  ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0

  ${if} $R0 == 0
    ${if} ${isUpdated}
      # allow app to exit without explicit kill
      Sleep 1000
      Goto doStopProcess
    ${endIf}
    MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(appRunning)" /SD IDOK IDOK doStopProcess
    Quit

    doStopProcess:
    DetailPrint `Closing running "${PRODUCT_NAME}"...`

    # Silently kill the process using nsProcess instead of taskkill / cmd.exe
    ${nsProcess::KillProcess} "${APP_EXECUTABLE_FILENAME}" $R0

    # to ensure that files are not "in-use"
    Sleep 300

    # Retry counter
    StrCpy $R1 0

    loop:
      IntOp $R1 $R1 + 1

      ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
      ${if} $R0 == 0
        # wait to give a chance to exit gracefully
        Sleep 1000
        ${nsProcess::KillProcess} "${APP_EXECUTABLE_FILENAME}" $R0

        ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
        ${If} $R0 == 0
          DetailPrint `Waiting for "${PRODUCT_NAME}" to close.`
          Sleep 2000
        ${else}
          Goto not_running
        ${endIf}
      ${else}
        Goto not_running
      ${endIf}

      # App likely running with elevated permissions.
      # Ask user to close it manually
      ${if} $R1 > 1
        MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY loop
        Quit
      ${else}
        Goto loop
      ${endIf}
    not_running:
      ${nsProcess::Unload}
  ${endIf}

  ; Even after GeeClaw.exe exits, bundled helper processes can keep files in
  ; $INSTDIR locked until Windows finishes releasing their handles. Kill any
  ; process whose executable lives under the target install directory.
  System::Call 'kernel32::GetCurrentProcessId() i .R2'
  System::Call 'kernel32::SetEnvironmentVariable(t "TARGET_INSTDIR", t "$INSTDIR") i .R3'
  nsExec::ExecToStack `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Get-CimInstance -ClassName Win32_Process | Where-Object { $$_.ProcessId -ne $R2 -and $$_.ExecutablePath -and $$_.ExecutablePath.StartsWith(($$env:TARGET_INSTDIR.TrimEnd('\\') + '\\'), [System.StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"`
  Pop $0
  Pop $1

  ${if} $0 == 0
    Sleep 2000
  ${endIf}
!macroend

!macro customUnInstallCheck
  ${if} $R0 != 0
    DetailPrint `Old GeeClaw uninstaller exited with code $R0. Continuing installation...`
  ${endIf}
  ClearErrors
!macroend

!macro customUnInstallCheckCurrentUser
  ${if} $R0 != 0
    DetailPrint `Old GeeClaw uninstaller (current user) exited with code $R0. Continuing installation...`
  ${endIf}
  ClearErrors
!macroend

!macro customInstall
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
