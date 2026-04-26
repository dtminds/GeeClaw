import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';

const tempDirs: string[] = [];
const originalFetch = global.fetch;
const originalConfigPathEnv = process.env.GEECLAW_PROVIDER_CONFIG_PATH;
const originalConfigUrlEnv = process.env.GEECLAW_PROVIDER_CONFIG_URL;
const electronAppMock = {
  isPackaged: false,
};

vi.mock('electron', () => ({
  app: electronAppMock,
}));

function createTempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(root);
  return root;
}

function writeConfig(root: string, value: unknown): string {
  const configPath = join(root, 'geeclaw-provider-config.json');
  writeFileSync(configPath, JSON.stringify(value, null, 2), 'utf8');
  return configPath;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
  vi.resetModules();
  if (originalFetch) {
    global.fetch = originalFetch;
  } else {
    delete (globalThis as typeof globalThis & { fetch?: typeof fetch }).fetch;
  }
  if (originalConfigUrlEnv === undefined) {
    delete process.env.GEECLAW_PROVIDER_CONFIG_URL;
  } else {
    process.env.GEECLAW_PROVIDER_CONFIG_URL = originalConfigUrlEnv;
  }
  if (originalConfigPathEnv === undefined) {
    delete process.env.GEECLAW_PROVIDER_CONFIG_PATH;
  } else {
    process.env.GEECLAW_PROVIDER_CONFIG_PATH = originalConfigPathEnv;
  }
  electronAppMock.isPackaged = false;
  vi.useRealTimers();
});

describe('GeeClaw provider config loader', () => {
  it('loads and normalizes a local config file', async () => {
    const root = createTempRoot('geeclaw-provider-config-');
    const configPath = writeConfig(root, {
      version: 1,
      upstreamBaseUrl: 'https://proxy.example.com/api/v1/',
      autoModels: [' future-model ', ' qwen3.6-plus ', 'qwen3.6-plus'],
      allowedModels: ['qwen3.6-plus', ' qwen3.6-plus ', 'deepseek-v4-pro'],
    });

    const { loadGeeClawProviderConfig } = await import('@electron/utils/geeclaw-provider-config');

    await expect(loadGeeClawProviderConfig(configPath)).resolves.toEqual({
      version: 1,
      upstreamBaseUrl: 'https://proxy.example.com/api/v1',
      autoModels: ['future-model', 'qwen3.6-plus'],
      allowedModels: ['qwen3.6-plus', 'deepseek-v4-pro'],
    });
  });

  it('loads the default config from the manual CDN URL with a cache-busting timestamp', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1770000000123);
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        version: 1,
        upstreamBaseUrl: 'https://cdn-proxy.example.com/v1',
        autoModels: ['future-model', 'qwen3.6-plus'],
        allowedModels: ['qwen3.6-plus'],
      }),
    })) as typeof fetch;

    const { loadGeeClawProviderConfig } = await import('@electron/utils/geeclaw-provider-config');

    await expect(loadGeeClawProviderConfig()).resolves.toEqual(expect.objectContaining({
      upstreamBaseUrl: 'https://cdn-proxy.example.com/v1',
      autoModels: ['future-model', 'qwen3.6-plus'],
    }));
    expect(global.fetch).toHaveBeenCalledWith(
      'https://b0.dtminds.com/geeclaw/geeclaw-provider-config.json?ts=1770000000123',
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('loads an ignored local development config before the CDN when present', async () => {
    const root = createTempRoot('geeclaw-provider-config-dev-');
    vi.spyOn(process, 'cwd').mockReturnValue(root);
    writeFileSync(
      join(root, 'geeclaw-provider-config.json.local'),
      JSON.stringify({
        version: 1,
        upstreamBaseUrl: 'https://dev-proxy.example.com/v1',
        autoModels: ['qwen3.6-plus'],
        allowedModels: ['qwen3.6-plus'],
      }, null, 2),
      'utf8',
    );
    global.fetch = vi.fn() as typeof fetch;

    const { loadGeeClawProviderConfig } = await import('@electron/utils/geeclaw-provider-config');

    await expect(loadGeeClawProviderConfig()).resolves.toEqual(expect.objectContaining({
      upstreamBaseUrl: 'https://dev-proxy.example.com/v1',
    }));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('prefers an explicit remote override URL', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1770000000456);
    process.env.GEECLAW_PROVIDER_CONFIG_URL = 'https://cdn.example.com/geeclaw-provider-config.json?env=dev';
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        version: 1,
        upstreamBaseUrl: 'https://override.example.com/v1',
        autoModels: ['mimo-v2.5'],
        allowedModels: ['mimo-v2.5'],
      }),
    })) as typeof fetch;

    const { loadGeeClawProviderConfig } = await import('@electron/utils/geeclaw-provider-config');

    await expect(loadGeeClawProviderConfig()).resolves.toEqual(expect.objectContaining({
      upstreamBaseUrl: 'https://override.example.com/v1',
      autoModels: ['mimo-v2.5'],
      allowedModels: ['mimo-v2.5'],
    }));
    expect(global.fetch).toHaveBeenCalledWith(
      'https://cdn.example.com/geeclaw-provider-config.json?env=dev&ts=1770000000456',
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('rejects an empty auto model candidate list', async () => {
    const root = createTempRoot('geeclaw-provider-config-invalid-auto-');
    const configPath = writeConfig(root, {
      version: 1,
      upstreamBaseUrl: 'https://proxy.example.com/v1',
      autoModels: [],
      allowedModels: ['deepseek-v4-pro'],
    });

    const { loadGeeClawProviderConfig } = await import('@electron/utils/geeclaw-provider-config');

    await expect(loadGeeClawProviderConfig(configPath)).rejects.toThrow('autoModels must be a non-empty array');
    await expect(loadGeeClawProviderConfig(configPath)).rejects.toMatchObject({
      code: 'EMPTY_MODEL_LIST',
    });
  });

  it('rejects invalid model entries with a structured error code', async () => {
    const root = createTempRoot('geeclaw-provider-config-invalid-entry-');
    const configPath = writeConfig(root, {
      version: 1,
      upstreamBaseUrl: 'https://proxy.example.com/v1',
      autoModels: ['qwen3.6-plus'],
      allowedModels: ['qwen3.6-plus', ''],
    });

    const { loadGeeClawProviderConfig } = await import('@electron/utils/geeclaw-provider-config');

    await expect(loadGeeClawProviderConfig(configPath)).rejects.toThrow('allowedModels is invalid');
    await expect(loadGeeClawProviderConfig(configPath)).rejects.toMatchObject({
      code: 'INVALID_MODEL_ENTRY',
    });
  });
});
