import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempDirs: string[] = [];

describe('download-bundled-node script', () => {
  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('defines npm-capable runtime layouts for posix and Windows targets', async () => {
    const { TARGETS, PLATFORM_GROUPS, isExecutable } = await import('../../scripts/download-bundled-node.mjs');

    expect(PLATFORM_GROUPS).toMatchObject({
      mac: ['darwin-x64', 'darwin-arm64'],
      linux: ['linux-x64', 'linux-arm64'],
      win: ['win32-x64', 'win32-arm64'],
    });

    expect(TARGETS['darwin-arm64']).toMatchObject({
      binaryRelativePath: 'bin/node',
      extraBinaries: ['bin/npm', 'bin/npx'],
      npmModulesDir: 'lib/node_modules/npm',
    });
    expect(TARGETS['linux-x64']).toMatchObject({
      binaryRelativePath: 'bin/node',
      extraBinaries: ['bin/npm', 'bin/npx'],
      npmModulesDir: 'lib/node_modules/npm',
    });
    expect(TARGETS['win32-x64']).toMatchObject({
      binaryRelativePath: 'node.exe',
      extraBinaries: ['npm', 'npm.cmd', 'npx', 'npx.cmd'],
      npmModulesDir: 'node_modules/npm',
    });

    expect(isExecutable('bin/npm')).toBe(true);
    expect(isExecutable('bin/npx')).toBe(true);
    expect(isExecutable('npm.cmd')).toBe(false);
    expect(isExecutable('node.exe')).toBe(false);
  });

  it('preserves posix npm symlinks after copying npm modules', async () => {
    const { TARGETS, copyExtraBinaries, copyNpmModules } = await import('../../scripts/download-bundled-node.mjs');

    const target = TARGETS['darwin-arm64'];
    const tempDir = mkdtempSync(join(tmpdir(), 'geeclaw-node-runtime-'));
    tempDirs.push(tempDir);

    const extractionRoot = join(tempDir, target.sourceDir);
    const targetDir = join(tempDir, 'output');

    mkdirSync(join(extractionRoot, 'bin'), { recursive: true });
    mkdirSync(join(extractionRoot, 'lib', 'node_modules', 'npm', 'bin'), { recursive: true });
    writeFileSync(join(extractionRoot, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'), 'console.log("npm");\n');
    writeFileSync(join(extractionRoot, 'lib', 'node_modules', 'npm', 'bin', 'npx-cli.js'), 'console.log("npx");\n');
    symlinkSync('../lib/node_modules/npm/bin/npm-cli.js', join(extractionRoot, 'bin', 'npm'));
    symlinkSync('../lib/node_modules/npm/bin/npx-cli.js', join(extractionRoot, 'bin', 'npx'));

    mkdirSync(targetDir, { recursive: true });

    await copyNpmModules(target, tempDir, targetDir);
    await copyExtraBinaries(target, tempDir, targetDir);

    const npmLinkPath = join(targetDir, 'bin', 'npm');
    const npxLinkPath = join(targetDir, 'bin', 'npx');
    expect(existsSync(join(targetDir, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'))).toBe(true);
    expect(lstatSync(npmLinkPath).isSymbolicLink()).toBe(true);
    expect(lstatSync(npxLinkPath).isSymbolicLink()).toBe(true);
    expect(readlinkSync(npmLinkPath)).toBe('../lib/node_modules/npm/bin/npm-cli.js');
    expect(readlinkSync(npxLinkPath)).toBe('../lib/node_modules/npm/bin/npx-cli.js');
  });

  it('treats zx script execution as a main-module invocation', async () => {
    const { shouldRunAsMainModule } = await import('../../scripts/download-bundled-node.mjs');

    expect(shouldRunAsMainModule(
      ['/opt/homebrew/Cellar/node/25.8.1/bin/node', '/opt/homebrew/bin/zx', 'scripts/download-bundled-node.mjs', '--platform=mac'],
      'file:///Users/lsave/.codex/worktrees/8868/ClawX/scripts/download-bundled-node.mjs',
    )).toBe(true);
  });
});
