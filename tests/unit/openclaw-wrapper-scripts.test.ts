import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('managed openclaw wrapper scripts', () => {
  it('pins the GeeClaw managed profile on posix', () => {
    const script = readFileSync('resources/managed-bin/posix/openclaw', 'utf8');

    expect(script).toContain('OPENCLAW_STATE_DIR="$STATE_DIR"');
    expect(script).toContain('OPENCLAW_CONFIG_PATH="$CONFIG_PATH"');
    expect(script).toContain('--profile "$PROFILE_NAME"');
  });

  it('pins the GeeClaw managed profile on Windows cmd', () => {
    const script = readFileSync('resources/managed-bin/win32/openclaw.cmd', 'utf8');

    expect(script).toContain('set "OPENCLAW_STATE_DIR=%STATE_DIR%"');
    expect(script).toContain('set "OPENCLAW_CONFIG_PATH=%CONFIG_PATH%"');
    expect(script).toContain('--profile "%PROFILE_NAME%"');
  });

  it('pins the GeeClaw managed profile on Windows sh', () => {
    const script = readFileSync('resources/managed-bin/win32/openclaw', 'utf8');

    expect(script).toContain('export OPENCLAW_STATE_DIR=');
    expect(script).toContain('export OPENCLAW_CONFIG_PATH=');
    expect(script).toContain('--profile "$PROFILE_NAME"');
  });
});
