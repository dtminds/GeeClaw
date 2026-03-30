import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('managed openclaw wrapper scripts', () => {
  it('pins the GeeClaw managed profile on posix', () => {
    const script = readFileSync('resources/managed-bin/posix/openclaw', 'utf8');

    expect(script).toContain('OPENCLAW_STATE_DIR="$STATE_DIR"');
    expect(script).toContain('OPENCLAW_CONFIG_PATH="$CONFIG_PATH"');
    expect(script).toContain('--profile "$PROFILE_NAME"');
    expect(script).toContain('NODE_SHIM="$SCRIPT_DIR/node"');
    expect(script).toContain('Resources/bin"');
    expect(script).toContain('Resources/bin/bin');
    expect(script).not.toContain('ELECTRON_RUN_AS_NODE=1 exec');
  });

  it('pins the GeeClaw managed profile on Windows cmd', () => {
    const script = readFileSync('resources/managed-bin/win32/openclaw.cmd', 'utf8');

    expect(script).toContain('set "OPENCLAW_STATE_DIR=%STATE_DIR%"');
    expect(script).toContain('set "OPENCLAW_CONFIG_PATH=%CONFIG_PATH%"');
    expect(script).toContain('--profile "%PROFILE_NAME%"');
    expect(script).toContain('"%NODE_EXE%" "%OPENCLAW_ENTRY%"');
    expect(script).toContain(':finish');
    expect(script).not.toContain('GeeClaw.exe');
  });

  it('pins the GeeClaw managed profile on Windows sh', () => {
    const script = readFileSync('resources/managed-bin/win32/openclaw', 'utf8');

    expect(script).toContain('export OPENCLAW_STATE_DIR=');
    expect(script).toContain('export OPENCLAW_CONFIG_PATH=');
    expect(script).toContain('--profile "$PROFILE_NAME"');
    expect(script).toContain('exec "$NODE_EXE" "$OPENCLAW_ENTRY"');
    expect(script).not.toContain('ELECTRON_RUN_AS_NODE=1 exec');
  });

  it('prefers the bundled node runtime in the shared posix node shim', () => {
    const script = readFileSync('resources/managed-bin/posix/node', 'utf8');

    expect(script).toContain('find_bundled_node()');
    expect(script).toContain('resources/bin/$(uname | tr \'[:upper:]\' \'[:lower:]\')-$(bin_arch)/bin/node');
    expect(script).toContain('Resources/bin/bin/node');
    expect(script).toContain('BUNDLED_NODE="$(find_bundled_node)"');
    expect(script).toContain('exec "$BUNDLED_NODE" "$@"');
    expect(script).not.toContain('ELECTRON_RUN_AS_NODE=1 exec');
  });

});
