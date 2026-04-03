import { describe, expect, it } from 'vitest';

import { sortCommandCandidatesForExecution } from '@electron/utils/command-candidates';

describe('sortCommandCandidatesForExecution', () => {
  it('prefers Windows executable wrappers over extensionless shims', () => {
    const candidates = [
      'C:\\Users\\test\\AppData\\Roaming\\GeeClaw\\npm-global\\opencli',
      'C:\\Users\\test\\AppData\\Roaming\\GeeClaw\\npm-global\\opencli.ps1',
      'C:\\Users\\test\\AppData\\Roaming\\GeeClaw\\npm-global\\opencli.cmd',
    ];

    expect(sortCommandCandidatesForExecution(candidates, 'win32')).toEqual([
      'C:\\Users\\test\\AppData\\Roaming\\GeeClaw\\npm-global\\opencli.cmd',
      'C:\\Users\\test\\AppData\\Roaming\\GeeClaw\\npm-global\\opencli.ps1',
      'C:\\Users\\test\\AppData\\Roaming\\GeeClaw\\npm-global\\opencli',
    ]);
  });

  it('leaves non-Windows candidate order unchanged', () => {
    const candidates = [
      '/usr/local/bin/opencli',
      '/opt/homebrew/bin/opencli',
    ];

    expect(sortCommandCandidatesForExecution(candidates, 'darwin')).toEqual(candidates);
  });
});
