import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('installer.nsh', () => {
  const installer = readFileSync(join(process.cwd(), 'scripts/installer.nsh'), 'utf8');

  it('keeps the custom app-running check aligned with electron-builder safeguards', () => {
    expect(installer).toContain('!include "getProcessInfo.nsh"');
    expect(installer).toContain('${GetProcessInfo} 0 $pid $1 $2 $3 $4');
    expect(installer).toContain('${if} $3 != "${APP_EXECUTABLE_FILENAME}"');
    expect(installer).toContain("StartsWith('${INSTALL_DIR}', 'CurrentCultureIgnoreCase')");
  });

  it('adds a compatibility fallback when an old uninstaller exits non-zero', () => {
    expect(installer).toContain('!macro customUnInstallCheck');
    expect(installer).toContain('Old GeeClaw uninstaller exited with code $R0');
    expect(installer).toContain('"$installationDir"');
  });
});
