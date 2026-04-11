import { describe, expect, it, vi } from 'vitest';

describe('resolveOpenClawBundleSource', () => {
  it('prefers the repo-local openclaw-runtime install when present', async () => {
    const existsSync = vi.fn((value: string) => (
      value === '/repo/openclaw-runtime/node_modules/openclaw/package.json'
        || value === '/repo/node_modules/openclaw'
    ));

    const { resolveOpenClawBundleSource } = await import('../../scripts/lib/openclaw-bundle-source.mjs');
    const result = resolveOpenClawBundleSource('/repo', { existsSync } as Pick<typeof import('node:fs'), 'existsSync'>);

    expect(result).toEqual({
      mode: 'runtime-install',
      label: 'repo-local openclaw-runtime install',
      openclawDir: '/repo/openclaw-runtime/node_modules/openclaw',
      nodeModulesDir: '/repo/openclaw-runtime/node_modules',
      runtimeRoot: '/repo/openclaw-runtime',
    });
  });

  it('falls back to workspace node_modules when the isolated runtime is absent', async () => {
    const existsSync = vi.fn((value: string) => value === '/repo/node_modules/openclaw');

    const { resolveOpenClawBundleSource } = await import('../../scripts/lib/openclaw-bundle-source.mjs');
    const result = resolveOpenClawBundleSource('/repo', { existsSync } as Pick<typeof import('node:fs'), 'existsSync'>);

    expect(result).toEqual({
      mode: 'workspace-node_modules',
      label: 'workspace node_modules/openclaw',
      openclawDir: '/repo/node_modules/openclaw',
      nodeModulesDir: '/repo/node_modules',
      runtimeRoot: null,
    });
  });

  it('returns null when neither source is available', async () => {
    const { resolveOpenClawBundleSource } = await import('../../scripts/lib/openclaw-bundle-source.mjs');
    const result = resolveOpenClawBundleSource('/repo', {
      existsSync: vi.fn(() => false),
    } as Pick<typeof import('node:fs'), 'existsSync'>);

    expect(result).toBeNull();
  });
});
