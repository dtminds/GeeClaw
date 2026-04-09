import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempDirs: string[] = [];

describe('after-pack bundled runtime sync', () => {
  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('copies bundled runtime node_modules and symlinked launchers into packaged resources', async () => {
    const { copyBundledBinRuntimeResources } = await import('../../scripts/after-pack.cjs');

    const projectRoot = mkdtempSync(join(tmpdir(), 'geeclaw-after-pack-project-'));
    const resourcesDir = mkdtempSync(join(tmpdir(), 'geeclaw-after-pack-resources-'));
    tempDirs.push(projectRoot, resourcesDir);

    const sourceRoot = join(projectRoot, 'resources', 'bin', 'darwin-arm64');
    mkdirSync(join(sourceRoot, 'bin'), { recursive: true });
    mkdirSync(join(sourceRoot, 'lib', 'node_modules', 'npm', 'bin'), { recursive: true });
    writeFileSync(join(sourceRoot, 'bin', 'node'), '#!/bin/sh\n');
    writeFileSync(join(sourceRoot, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'), 'console.log("npm");\n');
    symlinkSync('../lib/node_modules/npm/bin/npm-cli.js', join(sourceRoot, 'bin', 'npm'));

    expect(copyBundledBinRuntimeResources(projectRoot, resourcesDir, 'darwin', 'arm64')).toBe(true);

    const packagedNodePath = join(resourcesDir, 'bin', 'bin', 'node');
    const packagedNpmLink = join(resourcesDir, 'bin', 'bin', 'npm');
    const packagedNpmCli = join(resourcesDir, 'bin', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');

    expect(existsSync(packagedNodePath)).toBe(true);
    expect(existsSync(packagedNpmCli)).toBe(true);
    expect(lstatSync(packagedNpmLink).isSymbolicLink()).toBe(true);
    expect(readlinkSync(packagedNpmLink)).toBe('../lib/node_modules/npm/bin/npm-cli.js');
  });

  it('copies deep directory trees while preserving symlinks', async () => {
    const { copyPathPreservingLinks } = await import('../../scripts/after-pack.cjs');

    const sourceRoot = mkdtempSync(join(tmpdir(), 'geeclaw-after-pack-copy-src-'));
    const destRoot = mkdtempSync(join(tmpdir(), 'geeclaw-after-pack-copy-dest-'));
    tempDirs.push(sourceRoot, destRoot);

    mkdirSync(join(sourceRoot, 'node_modules', 'shiki', 'dist', 'langs'), { recursive: true });
    writeFileSync(
      join(sourceRoot, 'node_modules', 'shiki', 'dist', 'langs', 'json5.d.mts'),
      'export type Json5Grammar = string;\n',
    );

    mkdirSync(join(sourceRoot, 'node_modules', '.bin'), { recursive: true });
    symlinkSync('../shiki/dist/langs/json5.d.mts', join(sourceRoot, 'node_modules', '.bin', 'shiki-json5'));

    copyPathPreservingLinks(join(sourceRoot, 'node_modules'), join(destRoot, 'node_modules'));

    const copiedTypeDef = join(destRoot, 'node_modules', 'shiki', 'dist', 'langs', 'json5.d.mts');
    const copiedLink = join(destRoot, 'node_modules', '.bin', 'shiki-json5');

    expect(existsSync(copiedTypeDef)).toBe(true);
    expect(lstatSync(copiedLink).isSymbolicLink()).toBe(true);
    expect(readlinkSync(copiedLink)).toBe('../shiki/dist/langs/json5.d.mts');
  });
});
