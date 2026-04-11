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

  it('removes nested node_modules .bin directories that can preserve invalid absolute symlinks', async () => {
    const { cleanupUnnecessaryFiles } = await import('../../scripts/after-pack.cjs');

    const packageRoot = mkdtempSync(join(tmpdir(), 'geeclaw-after-pack-cleanup-bin-'));
    tempDirs.push(packageRoot);

    mkdirSync(join(packageRoot, 'node_modules', 'pkg', 'node_modules', '.bin'), { recursive: true });
    mkdirSync(join(packageRoot, 'node_modules', 'pkg', 'node_modules', 'helper', 'bin'), { recursive: true });
    writeFileSync(
      join(packageRoot, 'node_modules', 'pkg', 'node_modules', 'helper', 'bin', 'helper.js'),
      'console.log("helper");\n',
      'utf8',
    );
    symlinkSync(
      '/tmp/outside-bundle/helper.js',
      join(packageRoot, 'node_modules', 'pkg', 'node_modules', '.bin', 'helper'),
    );

    cleanupUnnecessaryFiles(packageRoot);

    expect(existsSync(join(packageRoot, 'node_modules', 'pkg', 'node_modules', '.bin'))).toBe(false);
    expect(existsSync(join(packageRoot, 'node_modules', 'pkg', 'node_modules', 'helper', 'bin', 'helper.js'))).toBe(true);
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

    // expect(getExtraBundledPluginPackages('@martian-engineering/lossless-claw')).toEqual([
    //   '@mariozechner/pi-coding-agent',
    // ]);
    expect(getExtraBundledPluginPackages('@soimy/dingtalk')).toEqual([]);
  });

  it('removes packages whose package.json os/cpu constraints do not match the target bundle', async () => {
    const { cleanupNativePlatformPackages } = await import('../../scripts/after-pack.cjs');

    const nodeModulesRoot = mkdtempSync(join(tmpdir(), 'geeclaw-after-pack-native-'));
    tempDirs.push(nodeModulesRoot);

    mkdirSync(join(nodeModulesRoot, '@tloncorp', 'tlon-skill-darwin-arm64'), { recursive: true });
    writeFileSync(
      join(nodeModulesRoot, '@tloncorp', 'tlon-skill-darwin-arm64', 'package.json'),
      '{"name":"@tloncorp/tlon-skill-darwin-arm64","version":"0.3.5"}\n',
      'utf8',
    );

    mkdirSync(join(nodeModulesRoot, '@tloncorp', 'tlon-skill'), { recursive: true });
    writeFileSync(
      join(nodeModulesRoot, '@tloncorp', 'tlon-skill', 'package.json'),
      '{"name":"@tloncorp/tlon-skill","version":"0.3.5"}\n',
      'utf8',
    );

    mkdirSync(join(nodeModulesRoot, 'future-native-helper'), { recursive: true });
    writeFileSync(
      join(nodeModulesRoot, 'future-native-helper', 'package.json'),
      '{"name":"future-native-helper","version":"1.0.0","os":["darwin"],"cpu":["arm64"]}\n',
      'utf8',
    );

    mkdirSync(join(nodeModulesRoot, 'portable-helper'), { recursive: true });
    writeFileSync(
      join(nodeModulesRoot, 'portable-helper', 'package.json'),
      '{"name":"portable-helper","version":"1.0.0","os":["darwin","linux"],"cpu":["x64","arm64"]}\n',
      'utf8',
    );

    expect(cleanupNativePlatformPackages(nodeModulesRoot, 'darwin', 'x64')).toBe(2);
    expect(existsSync(join(nodeModulesRoot, '@tloncorp', 'tlon-skill-darwin-arm64'))).toBe(false);
    expect(existsSync(join(nodeModulesRoot, '@tloncorp', 'tlon-skill'))).toBe(true);
    expect(existsSync(join(nodeModulesRoot, 'future-native-helper'))).toBe(false);
    expect(existsSync(join(nodeModulesRoot, 'portable-helper'))).toBe(true);
  });

  it('removes non-target native packages from built-in extension node_modules too', async () => {
    const { cleanupExtensionNativePlatformPackages } = await import('../../scripts/after-pack.cjs');

    const openclawRoot = mkdtempSync(join(tmpdir(), 'geeclaw-after-pack-extension-native-'));
    tempDirs.push(openclawRoot);

    const extNodeModules = join(openclawRoot, 'dist', 'extensions', 'discord', 'node_modules');
    mkdirSync(join(extNodeModules, '@snazzah', 'davey-linux-x64-gnu'), { recursive: true });
    writeFileSync(
      join(extNodeModules, '@snazzah', 'davey-linux-x64-gnu', 'package.json'),
      '{"name":"@snazzah/davey-linux-x64-gnu","version":"0.0.0","os":["linux"],"cpu":["x64"]}\n',
      'utf8',
    );

    mkdirSync(join(extNodeModules, '@snazzah', 'davey-darwin-x64-msvc'), { recursive: true });
    writeFileSync(
      join(extNodeModules, '@snazzah', 'davey-darwin-x64-msvc', 'package.json'),
      '{"name":"@snazzah/davey-darwin-x64-msvc","version":"0.0.0","os":["darwin"],"cpu":["x64"]}\n',
      'utf8',
    );

    expect(cleanupExtensionNativePlatformPackages(openclawRoot, 'darwin', 'x64')).toBe(1);
    expect(existsSync(join(extNodeModules, '@snazzah', 'davey-linux-x64-gnu'))).toBe(false);
    expect(existsSync(join(extNodeModules, '@snazzah', 'davey-darwin-x64-msvc'))).toBe(true);
  });

  it('prunes non-target prebuild directories before archiving the sidecar payload', async () => {
    const { cleanupNativePrebuilds } = await import('../../scripts/after-pack.cjs');

    const openclawRoot = mkdtempSync(join(tmpdir(), 'geeclaw-after-pack-prebuilds-'));
    tempDirs.push(openclawRoot);

    const prebuildsDir = join(openclawRoot, 'node_modules', 'bare-fs', 'prebuilds');
    mkdirSync(join(prebuildsDir, 'darwin-x64'), { recursive: true });
    mkdirSync(join(prebuildsDir, 'darwin-arm64'), { recursive: true });
    mkdirSync(join(prebuildsDir, 'darwin-universal'), { recursive: true });
    mkdirSync(join(prebuildsDir, 'ios-x64-simulator'), { recursive: true });
    mkdirSync(join(prebuildsDir, 'linux-x64'), { recursive: true });
    writeFileSync(join(prebuildsDir, 'darwin-x64', 'bare-fs.bare'), 'x64\n', 'utf8');
    writeFileSync(join(prebuildsDir, 'darwin-arm64', 'bare-fs.bare'), 'arm64\n', 'utf8');
    writeFileSync(join(prebuildsDir, 'darwin-universal', 'bare-fs.bare'), 'universal\n', 'utf8');
    writeFileSync(join(prebuildsDir, 'ios-x64-simulator', 'bare-fs.bare'), 'ios\n', 'utf8');
    writeFileSync(join(prebuildsDir, 'linux-x64', 'bare-fs.bare'), 'linux\n', 'utf8');

    expect(cleanupNativePrebuilds(openclawRoot, 'darwin', 'x64')).toBe(3);
    expect(existsSync(join(prebuildsDir, 'darwin-x64'))).toBe(true);
    expect(existsSync(join(prebuildsDir, 'darwin-universal'))).toBe(true);
    expect(existsSync(join(prebuildsDir, 'darwin-arm64'))).toBe(false);
    expect(existsSync(join(prebuildsDir, 'ios-x64-simulator'))).toBe(false);
    expect(existsSync(join(prebuildsDir, 'linux-x64'))).toBe(false);
  });

  it('archives the packaged OpenClaw runtime into a sidecar payload and removes the raw bundle', async () => {
    const { createOpenClawSidecarArchive } = await import('../../scripts/after-pack.cjs');

    const resourcesDir = mkdtempSync(join(tmpdir(), 'geeclaw-after-pack-resources-'));
    const openclawRoot = join(resourcesDir, 'openclaw');
    tempDirs.push(resourcesDir);

    const entryPath = join(openclawRoot, 'openclaw.mjs');

    mkdirSync(openclawRoot, { recursive: true });
    writeFileSync(join(openclawRoot, 'package.json'), '{"name":"openclaw","version":"2026.4.10"}\n', 'utf8');
    writeFileSync(entryPath, 'export {};\n', 'utf8');

    const archiveInfo = createOpenClawSidecarArchive(resourcesDir, openclawRoot);

    expect(archiveInfo).toMatchObject({
      sidecarRoot: join(resourcesDir, 'runtime', 'openclaw'),
      payloadPath: join(resourcesDir, 'runtime', 'openclaw', 'payload.tar.gz'),
      version: '2026.4.10',
    });
    expect(existsSync(join(resourcesDir, 'runtime', 'openclaw', 'archive.json'))).toBe(true);
    expect(existsSync(join(resourcesDir, 'runtime', 'openclaw', 'payload.tar.gz'))).toBe(true);
    expect(existsSync(openclawRoot)).toBe(false);
  });
});
