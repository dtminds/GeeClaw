import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

describe('bundle-openclaw cleanup helpers', () => {
  it('removes an existing directory with force and retry options before recreating it', async () => {
    const { cleanDirectorySync } = await import('../../scripts/lib/fs-utils.mjs');

    const existsSync = vi.fn(() => true);
    const rmSync = vi.fn();
    const mkdirSync = vi.fn();

    cleanDirectorySync('/tmp/build/openclaw', {
      existsSync,
      rmSync,
      mkdirSync,
    });

    expect(existsSync).toHaveBeenCalledWith('/tmp/build/openclaw');
    expect(rmSync).toHaveBeenCalledWith('/tmp/build/openclaw', {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
    expect(mkdirSync).toHaveBeenCalledWith('/tmp/build/openclaw', { recursive: true });
  });

  it('creates the directory even when there is no previous output to delete', async () => {
    const { cleanDirectorySync } = await import('../../scripts/lib/fs-utils.mjs');

    const existsSync = vi.fn(() => false);
    const rmSync = vi.fn();
    const mkdirSync = vi.fn();

    cleanDirectorySync('/tmp/build/openclaw', {
      existsSync,
      rmSync,
      mkdirSync,
    });

    expect(rmSync).not.toHaveBeenCalled();
    expect(mkdirSync).toHaveBeenCalledWith('/tmp/build/openclaw', { recursive: true });
  });

  it('skips filtered packages when copying installed runtime node_modules', async () => {
    const { copyInstalledNodeModules } = await import('../../scripts/lib/openclaw-bundle-filters.mjs');

    const sourceRoot = mkdtempSync(path.join(tmpdir(), 'bundle-openclaw-src-'));
    const destRoot = mkdtempSync(path.join(tmpdir(), 'bundle-openclaw-dest-'));
    const sourceNodeModules = path.join(sourceRoot, 'node_modules');
    const destNodeModules = path.join(destRoot, 'node_modules');

    const createPackage = (packageName: string) => {
      const packageDir = path.join(sourceNodeModules, ...packageName.split('/'));
      mkdirSync(packageDir, { recursive: true });
      writeFileSync(
        path.join(packageDir, 'package.json'),
        JSON.stringify({ name: packageName, version: '1.0.0' }),
        'utf8',
      );
    };

    createPackage('openclaw');
    createPackage('typescript');
    createPackage('@discordjs/opus');
    createPackage('@types/node');
    createPackage('chalk');

    const result = copyInstalledNodeModules(sourceNodeModules, destNodeModules);

    expect(result).toEqual({
      copiedCount: 1,
      skippedCount: 3,
      discoveredCount: 4,
    });
    expect(existsSync(path.join(destNodeModules, 'chalk', 'package.json'))).toBe(true);
    expect(existsSync(path.join(destNodeModules, 'typescript'))).toBe(false);
    expect(existsSync(path.join(destNodeModules, '@discordjs', 'opus'))).toBe(false);
    expect(existsSync(path.join(destNodeModules, '@types', 'node'))).toBe(false);
  });
});
