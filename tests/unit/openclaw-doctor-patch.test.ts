import { describe, expect, it } from 'vitest';
import {
  findOpenClawDoctorPatchRelativePath,
  patchOpenClawDoctorBundledRuntimeDepsSource,
} from '../../shared/openclaw-doctor-patch.js';

describe('openclaw doctor patch helper', () => {
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
    expect(result.source).toContain('const bundledPluginsDisabledRaw = (params.env ?? process.env).OPENCLAW_DISABLE_BUNDLED_PLUGINS?.trim().toLowerCase();');
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
});
