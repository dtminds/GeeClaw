import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('installer.nsh', () => {
  const installer = readFileSync(join(process.cwd(), 'scripts/installer.nsh'), 'utf8');

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
    expect(installer).toContain("taskkill /F /IM openclaw-gateway.exe");
    expect(installer).toContain("taskkill /F /T /IM \"${APP_EXECUTABLE_FILENAME}\"");
    expect(installer).toContain('Sleep 5000');
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
});
