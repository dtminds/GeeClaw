import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('installer.nsh', () => {
  const installer = readFileSync(join(process.cwd(), 'scripts/installer.nsh'), 'utf8');

  it('shows installer and uninstaller details by default', () => {
    expect(installer).toContain('!macro customHeader');
    expect(installer).toContain('ShowInstDetails show');
    expect(installer).toContain('ShowUninstDetails show');
  });

  it('kills lingering processes from the existing install directory before overwrite', () => {
    expect(installer).toContain("Get-CimInstance -ClassName Win32_Process");
    expect(installer).toContain('GetCurrentProcessId()');
    expect(installer).toContain('SetEnvironmentVariable(t "TARGET_INSTDIR", t "$INSTDIR")');
    expect(installer).toContain('$$_.ProcessId -ne $R2');
    expect(installer).toContain("$$env:TARGET_INSTDIR.TrimEnd('\\') + '\\'");
    expect(installer).toContain('Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue');
  });

  it('waits for the auto-update quit flow and cleans up helper processes before install', () => {
    expect(installer).toContain('Waiting for "${PRODUCT_NAME}" to finish shutting down...');
    expect(installer).toContain('Sleep 8000');
    expect(installer).toContain("taskkill /F /T /IM openclaw-gateway.exe");
    expect(installer).toContain("taskkill /F /T /IM \"${APP_EXECUTABLE_FILENAME}\"");
    expect(installer).toContain('Sleep 5000');
  });

  it('does not pre-emptively delete shortcuts before upgrade install', () => {
    expect(installer).not.toContain('Delete "$DESKTOP\\${PRODUCT_NAME}.lnk"');
    expect(installer).not.toContain('Delete "$SMPROGRAMS\\${PRODUCT_NAME}.lnk"');
  });

  it('moves the old install out of the way and skips the legacy uninstaller retry loop', () => {
    expect(installer).toContain('Rename "$INSTDIR" "$INSTDIR._stale_$R8"');
    expect(installer).toContain('DeleteRegValue SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" UninstallString');
    expect(installer).toContain('DeleteRegValue HKCU "${UNINSTALL_REGISTRY_KEY}" UninstallString');
    expect(installer).toContain('SetOutPath $TEMP');
  });

  it('allows installation to continue when an old uninstaller returns non-zero', () => {
    expect(installer).toContain('!macro customUnInstallCheck');
    expect(installer).toContain('Old uninstaller exited with code $R0. Continuing with overwrite install...');
    expect(installer).toContain('ClearErrors');
  });

  it('preserves managed OpenClaw state during uninstall prompts', () => {
    expect(installer).toContain('Your .openclaw-geeclaw folder (managed OpenClaw state) will be preserved.');
    expect(installer).not.toContain('.geeclaw folder (GeeClaw-managed OpenClaw state)');
  });

  it('retries AppData cleanup after stopping lingering app processes during uninstall', () => {
    expect(installer).toContain('${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0');
    expect(installer).toContain('SetEnvironmentVariable(t "TARGET_INSTDIR", t "$INSTDIR")');
    expect(installer).toContain(String.raw`$$env:TARGET_INSTDIR.TrimEnd('\') + '\'`);
    expect(installer).toContain('taskkill /F /T /IM "${APP_EXECUTABLE_FILENAME}"');
    expect(installer).toContain(String.raw`IfFileExists "$LOCALAPPDATA\geeclaw\" 0 _cu_localDone`);
    expect(installer).toContain('cmd.exe /c rd /s /q "$LOCALAPPDATA\\geeclaw"');
    expect(installer).toContain(String.raw`IfFileExists "$APPDATA\geeclaw\" 0 _cu_roamingDone`);
    expect(installer).toContain('cmd.exe /c rd /s /q "$APPDATA\\geeclaw"');
    expect(installer).toContain(String.raw`IfFileExists "$PROFILE\.geeclaw\" 0 _cu_profileDone`);
    expect(installer).toContain('Sleep 3000');
  });

  it('stops lingering processes before asking whether to remove app data', () => {
    const customUninstallStart = installer.indexOf('!macro customUnInstall\n');
    const uninstallBlock = installer.slice(
      customUninstallStart,
      installer.indexOf('!macroend', customUninstallStart),
    );
    const promptIndex = uninstallBlock.indexOf('MessageBox MB_YESNO|MB_ICONQUESTION');
    const appKillIndex = uninstallBlock.indexOf('taskkill /F /T /IM "${APP_EXECUTABLE_FILENAME}"');
    const gatewayKillIndex = uninstallBlock.indexOf('taskkill /F /T /IM openclaw-gateway.exe');

    expect(promptIndex).toBeGreaterThan(-1);
    expect(appKillIndex).toBeGreaterThan(-1);
    expect(gatewayKillIndex).toBeGreaterThan(-1);
    expect(appKillIndex).toBeLessThan(promptIndex);
    expect(gatewayKillIndex).toBeLessThan(promptIndex);
  });
});
