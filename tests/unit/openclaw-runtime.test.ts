import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getAppPath: () => '/Applications/GeeClaw.app',
    isPackaged: true,
  },
}));

vi.mock('@electron/utils/paths', () => ({
  getOpenClawDir: () => '/opt/geeclaw/resources/openclaw',
  getOpenClawEntryPath: () => '/opt/geeclaw/resources/openclaw/openclaw.mjs',
  getOpenClawResolvedDir: () => '/opt/geeclaw/resources/openclaw',
  isOpenClawBuilt: () => true,
  isOpenClawPresent: () => true,
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    default: actual,
    existsSync: (value: string) => value === '/opt/geeclaw/resources/openclaw/package.json',
    readFileSync: () => JSON.stringify({ version: '1.2.3' }),
    realpathSync: (value: string) => value,
  };
});

describe('bundled-only OpenClaw runtime', () => {
  it('always resolves the configured runtime source to bundled', async () => {
    const { getConfiguredOpenClawRuntimeSource } = await import('@electron/utils/openclaw-runtime');

    await expect(getConfiguredOpenClawRuntimeSource()).resolves.toBe('bundled');
  });

  it('resolves runtime details from the bundled OpenClaw package', async () => {
    const { getConfiguredOpenClawRuntime } = await import('@electron/utils/openclaw-runtime');

    await expect(getConfiguredOpenClawRuntime()).resolves.toMatchObject({
      source: 'bundled',
      packageExists: true,
      isBuilt: true,
      dir: '/opt/geeclaw/resources/openclaw',
      entryPath: '/opt/geeclaw/resources/openclaw/openclaw.mjs',
      displayName: 'Bundled OpenClaw',
    });
  });
});
