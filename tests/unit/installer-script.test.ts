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
    expect(installer).toContain("$$env:TARGET_INSTDIR.TrimEnd('\\\\') + '\\\\'");
    expect(installer).toContain('Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue');
  });

  it('allows installation to continue when an old uninstaller returns non-zero', () => {
    expect(installer).toContain('!macro customUnInstallCheck');
    expect(installer).toContain('Old GeeClaw uninstaller exited with code $R0. Continuing installation...');
    expect(installer).toContain('ClearErrors');
  });
});
