import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chmodSync, mkdtempSync, mkdirSync, writeFileSync as writeRealFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  findOpenClawDoctorPatchRelativePath,
  patchOpenClawDoctorBundledRuntimeDepsSource,
} from '../../shared/openclaw-doctor-patch.js';

const loggerInfoMock = vi.fn();
const loggerWarnMock = vi.fn();

describe('openclaw doctor patch helper', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('patches doctor source with CRLF line endings and space indentation', () => {
    const source = [
      'async function maybeRepairBundledPluginRuntimeDeps(params) {\r',
      '  const packageRoot = params.packageRoot ?? resolveOpenClawPackageRootSync({\r',
      '    argv1: process.argv[1],\r',
      '  });\r',
      '}\r',
    ].join('\n');

    const result = patchOpenClawDoctorBundledRuntimeDepsSource(source);

    expect(result.matched).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.source).toContain('const bundledPluginsDisabledRaw = (params.env ?? process.env).OPENCLAW_DISABLE_BUNDLED_PLUGINS?.trim()?.toLowerCase();');
    expect(result.source).not.toContain('OPENCLAW_DISABLE_BUNDLED_PLUGINS?.trim().toLowerCase()');
    expect(result.source).toContain('if (bundledPluginsDisabledRaw === "1" || bundledPluginsDisabledRaw === "true") return;');
    expect(result.source).toContain('\r\n  const packageRoot = params.packageRoot ?? resolveOpenClawPackageRootSync({');
  });

  it('finds the doctor patch target without depending on a fixed hashed filename', () => {
    const targetSource = [
      'async function maybeRepairBundledPluginRuntimeDeps(params) {',
      '\tconst packageRoot = params.packageRoot ?? resolveOpenClawPackageRootSync({',
      '\t\targv1: process.argv[1],',
      '\t});',
      '}',
    ].join('\n');

    const relativePath = findOpenClawDoctorPatchRelativePath(
      ['entry.js', 'prompt-select-styled-NEW_HASH.js', 'other.js'],
      (name) => name === 'prompt-select-styled-NEW_HASH.js' ? targetSource : 'export {};',
    );

    expect(relativePath).toBe('prompt-select-styled-NEW_HASH.js');
  });

  it('patches doctor source with flexible whitespace around the target snippet', () => {
    const source = [
      'async   function maybeRepairBundledPluginRuntimeDeps ( params ) {',
      '\tconst packageRoot=params.packageRoot??resolveOpenClawPackageRootSync ( {',
      '\t\targv1: process.argv[1],',
      '\t});',
      '}',
    ].join('\n');

    const result = patchOpenClawDoctorBundledRuntimeDepsSource(source);

    expect(result.matched).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.source).toContain('const bundledPluginsDisabledRaw = (params.env ?? process.env).OPENCLAW_DISABLE_BUNDLED_PLUGINS?.trim()?.toLowerCase();');
  });

  it('warns and returns false when writing the runtime patch fails', async () => {
    const openclawDir = mkdtempSync(path.join(tmpdir(), 'openclaw-patch-'));
    const distDir = path.join(openclawDir, 'dist');
    const targetPath = path.join(distDir, 'prompt-select-styled-NEW_HASH.js');
    mkdirSync(distDir, { recursive: true });
    writeRealFileSync(targetPath, [
      'async function maybeRepairBundledPluginRuntimeDeps(params) {',
      '  const packageRoot = params.packageRoot ?? resolveOpenClawPackageRootSync({',
      '    argv1: process.argv[1],',
      '  });',
      '}',
    ].join('\n'));
    chmodSync(targetPath, 0o444);

    vi.doMock('../../electron/utils/logger', () => ({
      logger: {
        info: (...args: unknown[]) => loggerInfoMock(...args),
        warn: (...args: unknown[]) => loggerWarnMock(...args),
      },
    }));

    const { ensureOpenClawDoctorBundledRuntimeDepsPatch } = await import('../../electron/utils/openclaw-doctor-patch');

    expect(ensureOpenClawDoctorBundledRuntimeDepsPatch(openclawDir)).toBe(false);
    expect(loggerWarnMock).toHaveBeenCalledWith(
      expect.stringContaining(`Failed to patch doctor deps in ${targetPath}:`),
      expect.any(Error),
    );
    expect(loggerInfoMock).not.toHaveBeenCalled();
  });
});
