import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';

const tempDirs: string[] = [];
const originalFetch = global.fetch;
const originalCatalogUrlEnv = process.env.GEECLAW_AGENT_MARKETPLACE_CATALOG_URL;
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

function writeCatalog(root: string, entries: unknown[]): string {
  const catalogPath = join(root, 'catalog.json');
  writeFileSync(catalogPath, JSON.stringify(entries, null, 2), 'utf8');
  return catalogPath;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
  vi.resetModules();
  electronAppMock.isPackaged = false;
  if (originalFetch) {
    global.fetch = originalFetch;
  } else {
    delete (globalThis as typeof globalThis & { fetch?: typeof fetch }).fetch;
  }
  if (originalCatalogUrlEnv === undefined) {
    delete process.env.GEECLAW_AGENT_MARKETPLACE_CATALOG_URL;
  } else {
    process.env.GEECLAW_AGENT_MARKETPLACE_CATALOG_URL = originalCatalogUrlEnv;
  }
  vi.useRealTimers();
});

describe('agent marketplace catalog loader', () => {
  it('loads the development catalog from site/res/agent-marketplace-catalog.json', async () => {
    const { loadAgentMarketplaceCatalog } = await import('@electron/utils/agent-marketplace-catalog');

    const catalog = await loadAgentMarketplaceCatalog();

    expect(catalog.length).toBeGreaterThan(0);
    for (const entry of catalog) {
      expect(entry).toEqual(expect.objectContaining({
        agentId: expect.any(String),
        name: expect.any(String),
        description: expect.any(String),
        emoji: expect.any(String),
        category: expect.any(String),
        version: expect.any(String),
        downloadUrl: expect.any(String),
        checksum: expect.any(String),
      }));
      if ('presetSkills' in entry) {
        expect(entry.presetSkills).toEqual(expect.any(Array));
      }
    }
  });

  it('loads the packaged catalog from https://www.geeclaw.cn/res/agent-marketplace-catalog.json', async () => {
    electronAppMock.isPackaged = true;
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify([
        {
          agentId: 'discovery-research',
          name: 'User Research',
          description: 'desc',
          emoji: '🔍',
          category: 'PM',
          version: '1.0.0',
          downloadUrl: 'https://example.com/discovery-research.zip',
          checksum: 'sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        },
      ]),
    })) as typeof fetch;

    const { loadAgentMarketplaceCatalog } = await import('@electron/utils/agent-marketplace-catalog');

    await expect(loadAgentMarketplaceCatalog()).resolves.toEqual([
      expect.objectContaining({
        agentId: 'discovery-research',
      }),
    ]);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://www.geeclaw.cn/res/agent-marketplace-catalog.json',
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('loads the development catalog from an explicit remote override URL when configured', async () => {
    process.env.GEECLAW_AGENT_MARKETPLACE_CATALOG_URL = 'https://cdn.example.com/agent-marketplace.json';
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify([
        {
          agentId: 'growth-optimization',
          name: 'Growth Optimization',
          description: 'desc',
          emoji: '📈',
          category: 'PM',
          version: '1.0.0',
          downloadUrl: 'https://example.com/growth-optimization.zip',
          checksum: 'sha256-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        },
      ]),
    })) as typeof fetch;

    const { loadAgentMarketplaceCatalog } = await import('@electron/utils/agent-marketplace-catalog');

    await expect(loadAgentMarketplaceCatalog()).resolves.toEqual([
      expect.objectContaining({
        agentId: 'growth-optimization',
      }),
    ]);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://cdn.example.com/agent-marketplace.json',
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('times out when the remote catalog does not respond', async () => {
    vi.useFakeTimers();
    process.env.GEECLAW_AGENT_MARKETPLACE_CATALOG_URL = 'https://cdn.example.com/agent-marketplace.json';
    global.fetch = vi.fn((_: string | URL | Request, init?: RequestInit) => new Promise((_, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('The operation was aborted.', 'AbortError'));
      }, { once: true });
    })) as typeof fetch;

    const { loadAgentMarketplaceCatalog } = await import('@electron/utils/agent-marketplace-catalog');
    const request = expect(loadAgentMarketplaceCatalog()).rejects.toThrow(
      'Timed out fetching catalog from https://cdn.example.com/agent-marketplace.json after 15000ms',
    );

    await vi.advanceTimersByTimeAsync(15000);
    await request;
  });

  it('loads optional preset skill metadata from catalog entries', async () => {
    const root = createTempRoot('agent-marketplace-catalog-summary-fields-');
    const catalogPath = writeCatalog(root, [
      {
        agentId: 'discovery-research',
        name: 'User Research',
        description: 'desc',
        emoji: '🔍',
        category: 'PM',
        version: '1.0.0',
        downloadUrl: 'https://example.com/discovery-research.zip',
        checksum: 'sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        presetSkills: ['interview-script', 'user-personas'],
      },
    ]);

    const { loadAgentMarketplaceCatalog } = await import('@electron/utils/agent-marketplace-catalog');

    await expect(loadAgentMarketplaceCatalog(catalogPath)).resolves.toEqual([
      expect.objectContaining({
        agentId: 'discovery-research',
        presetSkills: ['interview-script', 'user-personas'],
      }),
    ]);
  });

  it('rejects duplicate agentIds in a catalog file', async () => {
    const root = createTempRoot('agent-marketplace-catalog-');
    const catalogPath = writeCatalog(root, [
      {
        agentId: 'discovery-research',
        name: 'User Research',
        description: 'desc',
        emoji: '🔍',
        category: 'PM',
        version: '1.0.0',
        downloadUrl: 'https://example.com/discovery-research.zip',
        checksum: 'sha256-1111111111111111111111111111111111111111111111111111111111111111',
      },
      {
        agentId: 'discovery-research',
        name: 'Duplicate User Research',
        description: 'desc',
        emoji: '🔍',
        category: 'PM',
        version: '1.0.1',
        downloadUrl: 'https://example.com/discovery-research-duplicate.zip',
        checksum: 'sha256-2222222222222222222222222222222222222222222222222222222222222222',
      },
    ]);

    const { loadAgentMarketplaceCatalog } = await import('@electron/utils/agent-marketplace-catalog');

    await expect(loadAgentMarketplaceCatalog(catalogPath)).rejects.toThrow(
      'duplicate agentId "discovery-research"',
    );
  });

  it('rejects catalog entries with invalid checksum formats', async () => {
    const root = createTempRoot('agent-marketplace-catalog-checksum-');
    const catalogPath = writeCatalog(root, [
      {
        agentId: 'discovery-research',
        name: 'User Research',
        description: 'desc',
        emoji: '🔍',
        category: 'PM',
        version: '1.0.0',
        downloadUrl: 'https://example.com/discovery-research.zip',
        checksum: 'sha1-bad',
      },
    ]);

    const { loadAgentMarketplaceCatalog } = await import('@electron/utils/agent-marketplace-catalog');

    await expect(loadAgentMarketplaceCatalog(catalogPath)).rejects.toThrow('checksum is invalid');
  });

  it('rejects catalog entries with invalid or duplicate platforms', async () => {
    const invalidRoot = createTempRoot('agent-marketplace-catalog-platforms-invalid-');
    const invalidCatalogPath = writeCatalog(invalidRoot, [
      {
        agentId: 'discovery-research',
        name: 'User Research',
        description: 'desc',
        emoji: '🔍',
        category: 'PM',
        version: '1.0.0',
        downloadUrl: 'https://example.com/discovery-research.zip',
        checksum: 'sha256-3333333333333333333333333333333333333333333333333333333333333333',
        platforms: ['darwin', 'android'],
      },
    ]);

    const duplicateRoot = createTempRoot('agent-marketplace-catalog-platforms-duplicate-');
    const duplicateCatalogPath = writeCatalog(duplicateRoot, [
      {
        agentId: 'discovery-research',
        name: 'User Research',
        description: 'desc',
        emoji: '🔍',
        category: 'PM',
        version: '1.0.0',
        downloadUrl: 'https://example.com/discovery-research.zip',
        checksum: 'sha256-4444444444444444444444444444444444444444444444444444444444444444',
        platforms: ['darwin', 'darwin'],
      },
    ]);

    const { loadAgentMarketplaceCatalog } = await import('@electron/utils/agent-marketplace-catalog');

    await expect(loadAgentMarketplaceCatalog(invalidCatalogPath)).rejects.toThrow('platforms is invalid');
    await expect(loadAgentMarketplaceCatalog(duplicateCatalogPath)).rejects.toThrow(
      'platforms must not contain duplicates',
    );
  });

  it('rejects catalog entries with invalid size values', async () => {
    const root = createTempRoot('agent-marketplace-catalog-size-');
    const catalogPath = writeCatalog(root, [
      {
        agentId: 'discovery-research',
        name: 'User Research',
        description: 'desc',
        emoji: '🔍',
        category: 'PM',
        version: '1.0.0',
        downloadUrl: 'https://example.com/discovery-research.zip',
        checksum: 'sha256-5555555555555555555555555555555555555555555555555555555555555555',
        size: -1,
      },
    ]);

    const { loadAgentMarketplaceCatalog } = await import('@electron/utils/agent-marketplace-catalog');

    await expect(loadAgentMarketplaceCatalog(catalogPath)).rejects.toThrow('size is invalid');
  });

  it('rejects catalog entries with invalid preset skill metadata', async () => {
    const root = createTempRoot('agent-marketplace-catalog-preset-skills-invalid-');
    const catalogPath = writeCatalog(root, [
      {
        agentId: 'discovery-research',
        name: 'User Research',
        description: 'desc',
        emoji: '🔍',
        category: 'PM',
        version: '1.0.0',
        downloadUrl: 'https://example.com/discovery-research.zip',
        checksum: 'sha256-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        presetSkills: ['user-personas', 'user-personas'],
      },
    ]);

    const { loadAgentMarketplaceCatalog } = await import('@electron/utils/agent-marketplace-catalog');

    await expect(loadAgentMarketplaceCatalog(catalogPath)).rejects.toThrow('presetSkills is invalid');
  });

  it('rejects catalog entries with empty preset skill metadata', async () => {
    const root = createTempRoot('agent-marketplace-catalog-preset-skills-empty-');
    const catalogPath = writeCatalog(root, [
      {
        agentId: 'discovery-research',
        name: 'User Research',
        description: 'desc',
        emoji: '🔍',
        category: 'PM',
        version: '1.0.0',
        downloadUrl: 'https://example.com/discovery-research.zip',
        checksum: 'sha256-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        presetSkills: [],
      },
    ]);

    const { loadAgentMarketplaceCatalog } = await import('@electron/utils/agent-marketplace-catalog');

    await expect(loadAgentMarketplaceCatalog(catalogPath)).rejects.toThrow('presetSkills must not be empty');
  });
});
