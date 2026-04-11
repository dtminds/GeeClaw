import { describe, expect, it, vi } from 'vitest';

describe('resolveOpenClawBundleSource', () => {
  it('prefers the repo-local openclaw-runtime install when present', async () => {
    const existsSync = vi.fn((value: string) => (
      value === '/repo/openclaw-runtime/node_modules/openclaw/package.json'
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

  it('returns null when the isolated runtime is absent', async () => {
    const { resolveOpenClawBundleSource } = await import('../../scripts/lib/openclaw-bundle-source.mjs');
    const result = resolveOpenClawBundleSource('/repo', {
      existsSync: vi.fn(() => false),
    } as Pick<typeof import('node:fs'), 'existsSync'>);

    expect(result).toBeNull();
  });

  it('returns null when neither source is available', async () => {
    const { resolveOpenClawBundleSource } = await import('../../scripts/lib/openclaw-bundle-source.mjs');
    const result = resolveOpenClawBundleSource('/repo', {
      existsSync: vi.fn(() => false),
    } as Pick<typeof import('node:fs'), 'existsSync'>);

    expect(result).toBeNull();
  });
});
