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

  it('removes declaration-only mts and cts files during packaged cleanup', async () => {
    const { cleanupUnnecessaryFiles } = await import('../../scripts/after-pack.cjs');

    const packageRoot = mkdtempSync(join(tmpdir(), 'geeclaw-after-pack-cleanup-'));
    tempDirs.push(packageRoot);

    mkdirSync(join(packageRoot, 'node_modules', 'shiki', 'dist', 'langs'), { recursive: true });
    mkdirSync(join(packageRoot, 'node_modules', 'pkg'), { recursive: true });
    writeFileSync(join(packageRoot, 'node_modules', 'shiki', 'dist', 'langs', 'plsql.mjs'), 'export default {};\n');
    writeFileSync(join(packageRoot, 'node_modules', 'shiki', 'dist', 'langs', 'plsql.d.mts'), 'export interface Lang {}\n');
    writeFileSync(join(packageRoot, 'node_modules', 'pkg', 'index.cjs'), 'module.exports = {};\n');
    writeFileSync(join(packageRoot, 'node_modules', 'pkg', 'index.d.cts'), 'export = {};\n');

    cleanupUnnecessaryFiles(packageRoot);

    expect(existsSync(join(packageRoot, 'node_modules', 'shiki', 'dist', 'langs', 'plsql.mjs'))).toBe(true);
    expect(existsSync(join(packageRoot, 'node_modules', 'shiki', 'dist', 'langs', 'plsql.d.mts'))).toBe(false);
    expect(existsSync(join(packageRoot, 'node_modules', 'pkg', 'index.cjs'))).toBe(true);
    expect(existsSync(join(packageRoot, 'node_modules', 'pkg', 'index.d.cts'))).toBe(false);
  });

  it('prunes built-in extension node_modules when all package identities match top-level packages', async () => {
    const { canPruneExtensionNodeModulesAgainstTopLevel, pruneExtensionNodeModulesAgainstTopLevel } = await import('../../scripts/after-pack.cjs');

    const openclawRoot = mkdtempSync(join(tmpdir(), 'geeclaw-after-pack-openclaw-'));
    tempDirs.push(openclawRoot);

    mkdirSync(join(openclawRoot, 'node_modules', 'discord-api-types'), { recursive: true });
    writeFileSync(
      join(openclawRoot, 'node_modules', 'discord-api-types', 'package.json'),
      '{"name":"discord-api-types","version":"0.39.0"}\n',
      'utf8',
    );

    const extNodeModules = join(openclawRoot, 'dist', 'extensions', 'discord', 'node_modules');
    mkdirSync(join(extNodeModules, 'discord-api-types'), { recursive: true });
    writeFileSync(
      join(extNodeModules, 'discord-api-types', 'package.json'),
      '{"name":"discord-api-types","version":"0.39.0"}\n',
      'utf8',
    );

    expect(canPruneExtensionNodeModulesAgainstTopLevel(extNodeModules, join(openclawRoot, 'node_modules'))).toBe(true);
    expect(pruneExtensionNodeModulesAgainstTopLevel(openclawRoot)).toEqual({
      removedExtensions: 1,
      removedPackages: 0,
    });
    expect(existsSync(extNodeModules)).toBe(false);
  });

  it('keeps extension-local node_modules as directories when matching package names have different versions', async () => {
    const { canPruneExtensionNodeModulesAgainstTopLevel, canPrunePackageDirAgainstTopLevel, pruneExtensionNodeModulesAgainstTopLevel } = await import('../../scripts/after-pack.cjs');

    const openclawRoot = mkdtempSync(join(tmpdir(), 'geeclaw-after-pack-openclaw-'));
    tempDirs.push(openclawRoot);

    mkdirSync(join(openclawRoot, 'node_modules', 'discord-api-types'), { recursive: true });
    writeFileSync(
      join(openclawRoot, 'node_modules', 'discord-api-types', 'package.json'),
      '{"name":"discord-api-types","version":"0.38.0"}\n',
      'utf8',
    );

    const extNodeModules = join(openclawRoot, 'dist', 'extensions', 'discord', 'node_modules');
    mkdirSync(join(extNodeModules, 'discord-api-types'), { recursive: true });
    writeFileSync(
      join(extNodeModules, 'discord-api-types', 'package.json'),
      '{"name":"discord-api-types","version":"0.39.0"}\n',
      'utf8',
    );

    expect(canPruneExtensionNodeModulesAgainstTopLevel(extNodeModules, join(openclawRoot, 'node_modules'))).toBe(false);
    expect(
      canPrunePackageDirAgainstTopLevel(
        join(extNodeModules, 'discord-api-types'),
        join(openclawRoot, 'node_modules', 'discord-api-types'),
      ),
    ).toBe(false);
    expect(pruneExtensionNodeModulesAgainstTopLevel(openclawRoot)).toEqual({
      removedExtensions: 0,
      removedPackages: 0,
    });
    expect(lstatSync(extNodeModules).isDirectory()).toBe(true);
    expect(lstatSync(join(extNodeModules, 'discord-api-types')).isDirectory()).toBe(true);
  });

  it('prunes only the matching extension packages when an extension has mixed versions', async () => {
    const { canPruneExtensionNodeModulesAgainstTopLevel, canPrunePackageDirAgainstTopLevel, pruneExtensionNodeModulesAgainstTopLevel } = await import('../../scripts/after-pack.cjs');

    const openclawRoot = mkdtempSync(join(tmpdir(), 'geeclaw-after-pack-openclaw-'));
    tempDirs.push(openclawRoot);

    mkdirSync(join(openclawRoot, 'node_modules', 'discord-api-types'), { recursive: true });
    writeFileSync(
      join(openclawRoot, 'node_modules', 'discord-api-types', 'package.json'),
      '{"name":"discord-api-types","version":"0.39.0"}\n',
      'utf8',
    );
    mkdirSync(join(openclawRoot, 'node_modules', 'magic-bytes.js'), { recursive: true });
    writeFileSync(
      join(openclawRoot, 'node_modules', 'magic-bytes.js', 'package.json'),
      '{"name":"magic-bytes.js","version":"1.12.1"}\n',
      'utf8',
    );

    const extNodeModules = join(openclawRoot, 'dist', 'extensions', 'telegram', 'node_modules');
    mkdirSync(join(extNodeModules, 'discord-api-types'), { recursive: true });
    writeFileSync(
      join(extNodeModules, 'discord-api-types', 'package.json'),
      '{"name":"discord-api-types","version":"0.39.0"}\n',
      'utf8',
    );
    mkdirSync(join(extNodeModules, 'magic-bytes.js'), { recursive: true });
    writeFileSync(
      join(extNodeModules, 'magic-bytes.js', 'package.json'),
      '{"name":"magic-bytes.js","version":"1.13.0"}\n',
      'utf8',
    );

    expect(canPruneExtensionNodeModulesAgainstTopLevel(extNodeModules, join(openclawRoot, 'node_modules'))).toBe(false);
    expect(
      canPrunePackageDirAgainstTopLevel(
        join(extNodeModules, 'discord-api-types'),
        join(openclawRoot, 'node_modules', 'discord-api-types'),
      ),
    ).toBe(true);
    expect(
      canPrunePackageDirAgainstTopLevel(
        join(extNodeModules, 'magic-bytes.js'),
        join(openclawRoot, 'node_modules', 'magic-bytes.js'),
      ),
    ).toBe(false);

    expect(pruneExtensionNodeModulesAgainstTopLevel(openclawRoot)).toEqual({
      removedExtensions: 0,
      removedPackages: 1,
    });

    expect(lstatSync(extNodeModules).isDirectory()).toBe(true);
    expect(existsSync(join(extNodeModules, 'discord-api-types'))).toBe(false);
    expect(lstatSync(join(extNodeModules, 'magic-bytes.js')).isDirectory()).toBe(true);
  });

  it('bundles compatibility runtime deps for plugins with undeclared workspace imports', async () => {
    const { getExtraBundledPluginPackages } = await import('../../scripts/after-pack.cjs');

    expect(getExtraBundledPluginPackages('@martian-engineering/lossless-claw')).toEqual([
      '@mariozechner/pi-coding-agent',
    ]);
    expect(getExtraBundledPluginPackages('@soimy/dingtalk')).toEqual([]);
  });
});
