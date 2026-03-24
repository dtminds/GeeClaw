import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalPlatform = process.platform;
const originalRealpathSync = fs.realpathSync;

function setPlatform(platform: string) {
  Object.defineProperty(process, 'platform', { value: platform, writable: true });
}

function restoreRealpathSync() {
  (fs as typeof fs & { realpathSync: typeof fs.realpathSync }).realpathSync = originalRealpathSync;
}

describe('windows path helpers', () => {
  let normWinFsPath: (targetPath: string) => string;
  let realpathCompat: (targetPath: string) => string;

  beforeEach(async () => {
    const mod = await import('../../scripts/lib/windows-paths.cjs');
    const exports = 'default' in mod ? mod.default : mod;
    normWinFsPath = exports.normWinFsPath;
    realpathCompat = exports.realpathCompat;
  });

  afterEach(() => {
    setPlatform(originalPlatform);
    restoreRealpathSync();
    vi.restoreAllMocks();
  });

  it('adds a namespaced prefix for Windows drive paths', () => {
    setPlatform('win32');

    expect(normWinFsPath('D:/a/GeeClaw/GeeClaw/node_modules/openclaw')).toBe(
      path.win32.toNamespacedPath('D:\\a\\GeeClaw\\GeeClaw\\node_modules\\openclaw'),
    );
  });

  it('converts UNC paths to namespaced UNC paths on Windows', () => {
    setPlatform('win32');

    expect(normWinFsPath('\\\\server\\share\\GeeClaw\\node_modules\\openclaw')).toBe(
      path.win32.toNamespacedPath('\\\\server\\share\\GeeClaw\\node_modules\\openclaw'),
    );
  });

  it('leaves paths untouched outside Windows', () => {
    setPlatform('linux');

    expect(normWinFsPath('/tmp/openclaw')).toBe('/tmp/openclaw');
  });

  it('uses native realpath for Windows namespaced paths', () => {
    setPlatform('win32');

    const nativeRealpath = vi.fn((targetPath: string) => `native:${targetPath}`);
    const fallbackRealpath = vi.fn((targetPath: string) => `fallback:${targetPath}`) as
      typeof fs.realpathSync & { native: typeof fs.realpathSync.native };
    fallbackRealpath.native = nativeRealpath as typeof fs.realpathSync.native;
    (fs as typeof fs & { realpathSync: typeof fs.realpathSync }).realpathSync =
      fallbackRealpath as typeof fs.realpathSync;

    const input = 'D:/a/GeeClaw/GeeClaw/node_modules/openclaw';
    const expected = path.win32.toNamespacedPath('D:\\a\\GeeClaw\\GeeClaw\\node_modules\\openclaw');

    expect(realpathCompat(input)).toBe(`native:${expected}`);
    expect(nativeRealpath).toHaveBeenCalledWith(expected);
    expect(fallbackRealpath).not.toHaveBeenCalled();
  });

  it('uses standard realpath outside Windows', () => {
    setPlatform('linux');

    const nativeRealpath = vi.fn((targetPath: string) => `native:${targetPath}`);
    const fallbackRealpath = vi.fn((targetPath: string) => `fallback:${targetPath}`) as
      typeof fs.realpathSync & { native: typeof fs.realpathSync.native };
    fallbackRealpath.native = nativeRealpath as typeof fs.realpathSync.native;
    (fs as typeof fs & { realpathSync: typeof fs.realpathSync }).realpathSync =
      fallbackRealpath as typeof fs.realpathSync;

    expect(realpathCompat('/tmp/openclaw')).toBe('fallback:/tmp/openclaw');
    expect(fallbackRealpath).toHaveBeenCalledWith('/tmp/openclaw');
    expect(nativeRealpath).not.toHaveBeenCalled();
  });
});
