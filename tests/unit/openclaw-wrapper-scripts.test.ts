import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('managed openclaw wrapper scripts', () => {
  it('pins the GeeClaw managed profile on posix', () => {
    const script = readFileSync('resources/managed-bin/posix/openclaw', 'utf8');

    expect(script).toContain('OPENCLAW_STATE_DIR="$STATE_DIR"');
    expect(script).toContain('OPENCLAW_CONFIG_PATH="$CONFIG_PATH"');
    expect(script).toContain('--profile "$PROFILE_NAME"');
    expect(script).toContain('NODE_SHIM="$SCRIPT_DIR/node"');
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

  it('routes bundled posix opencli and mcporter through the shared node shim', () => {
    const opencliScript = readFileSync('resources/managed-bin/posix/opencli', 'utf8');
    const mcporterScript = readFileSync('resources/managed-bin/posix/mcporter', 'utf8');

    expect(opencliScript).toContain('NODE_SHIM="$SCRIPT_DIR/node"');
    expect(opencliScript).toContain('exec "$NODE_SHIM" "$CLI" "$@"');
    expect(opencliScript).not.toContain('ELECTRON_RUN_AS_NODE=1 exec');

    expect(mcporterScript).toContain('NODE_SHIM="$SCRIPT_DIR/node"');
    expect(mcporterScript).toContain('exec "$NODE_SHIM" "$CLI" "$@"');
    expect(mcporterScript).not.toContain('ELECTRON_RUN_AS_NODE=1 exec');
  });

  it('prefers the bundled node runtime in the shared posix node shim', () => {
    const script = readFileSync('resources/managed-bin/posix/node', 'utf8');

    expect(script).toContain('find_bundled_node()');
    expect(script).toContain('BUNDLED_NODE="$(find_bundled_node)"');
    expect(script).toContain('exec "$BUNDLED_NODE" "$@"');
    expect(script).not.toContain('ELECTRON_RUN_AS_NODE=1 exec');
  });

  it('routes Windows opencli and mcporter wrappers through bundled node only', () => {
    const opencliSh = readFileSync('resources/managed-bin/win32/opencli', 'utf8');
    const opencliCmd = readFileSync('resources/managed-bin/win32/opencli.cmd', 'utf8');
    const mcporterSh = readFileSync('resources/managed-bin/win32/mcporter', 'utf8');
    const mcporterCmd = readFileSync('resources/managed-bin/win32/mcporter.cmd', 'utf8');

    expect(opencliSh).toContain('exec "$NODE_EXE" "$OPENCLI_ENTRY" "$@"');
    expect(opencliSh).not.toContain('GeeClaw.exe');
    expect(opencliCmd).toContain('"%NODE_EXE%" "%OPENCLI_ENTRY%" %*');
    expect(opencliCmd).toContain(':finish');
    expect(opencliCmd).not.toContain('GeeClaw.exe');

    expect(mcporterSh).toContain('exec "$NODE_EXE" "$MCPORTER_ENTRY" "$@"');
    expect(mcporterSh).not.toContain('GeeClaw.exe');
    expect(mcporterCmd).toContain('"%NODE_EXE%" "%MCPORTER_ENTRY%" %*');
    expect(mcporterCmd).toContain(':finish');
    expect(mcporterCmd).not.toContain('GeeClaw.exe');
  });
});
