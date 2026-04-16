import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises';

let openclawConfigDir = '/tmp/openclaw-ssrf-policy-settings-test';

async function readJson(filePath: string): Promise<Record<string, unknown>> {
  const content = await readFile(filePath, 'utf8');
  return JSON.parse(content) as Record<string, unknown>;
}

vi.mock('@electron/utils/paths', () => ({
  getOpenClawConfigDir: vi.fn(() => openclawConfigDir),
}));

vi.mock('@electron/utils/openclaw-config-coordinator', () => ({
  mutateOpenClawConfigDocument: vi.fn(async (
    mutator: (
      config: Record<string, unknown>,
    ) => Promise<{ changed: boolean; result: unknown }> | { changed: boolean; result: unknown },
  ) => {
    const configPath = join(openclawConfigDir, 'openclaw.json');
    let config: Record<string, unknown>;

    try {
      config = await readJson(configPath);
    } catch {
      config = {};
    }

    const outcome = await mutator(config);
    if (outcome.changed) {
      await mkdir(openclawConfigDir, { recursive: true });
      await writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
    }

    return outcome.result;
  }),
}));

async function writeOpenClawJson(data: unknown): Promise<void> {
  await mkdir(openclawConfigDir, { recursive: true });
  await writeFile(join(openclawConfigDir, 'openclaw.json'), JSON.stringify(data, null, 2), 'utf8');
}

async function readOpenClawJson(): Promise<Record<string, unknown>> {
  return await readJson(join(openclawConfigDir, 'openclaw.json'));
}

describe('syncOpenClawSsrfPolicySettings', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    openclawConfigDir = await mkdtemp(join(tmpdir(), 'geeclaw-ssrf-policy-settings-'));
  });

  afterEach(async () => {
    await rm(openclawConfigDir, { recursive: true, force: true });
  });

  it('initializes managed SSRF policy nodes when openclaw.json is empty', async () => {
    const { syncOpenClawSsrfPolicySettings } = await import('@electron/utils/openclaw-ssrf-policy-settings');

    await syncOpenClawSsrfPolicySettings();

    expect(await readOpenClawJson()).toEqual({
      tools: {
        web: {
          fetch: {
            ssrfPolicy: {
              allowRfc2544BenchmarkRange: true,
            },
          },
        },
      },
      browser: {
        ssrfPolicy: {
          dangerouslyAllowPrivateNetwork: true,
        },
      },
    });
  });

  it('preserves sibling fetch and browser config while forcing managed flags to true', async () => {
    await writeOpenClawJson({
      tools: {
        web: {
          fetch: {
            timeoutSeconds: 30,
            ssrfPolicy: {
              allowRfc2544BenchmarkRange: false,
              keep: 'fetch-sibling',
            },
          },
        },
      },
      browser: {
        enabled: true,
        ssrfPolicy: {
          dangerouslyAllowPrivateNetwork: 'yes',
          keep: 'browser-sibling',
        },
      },
    });

    const { syncOpenClawSsrfPolicySettings } = await import('@electron/utils/openclaw-ssrf-policy-settings');

    await syncOpenClawSsrfPolicySettings();

    const config = await readOpenClawJson();
    expect((config.tools as Record<string, any>).web.fetch).toEqual({
      timeoutSeconds: 30,
      ssrfPolicy: {
        allowRfc2544BenchmarkRange: true,
        keep: 'fetch-sibling',
      },
    });
    expect(config.browser).toEqual({
      enabled: true,
      ssrfPolicy: {
        dangerouslyAllowPrivateNetwork: true,
        keep: 'browser-sibling',
      },
    });
  });

  it('replaces invalid intermediate nodes with managed object shapes', async () => {
    await writeOpenClawJson({
      tools: {
        web: 'invalid',
      },
      browser: {
        ssrfPolicy: false,
      },
    });

    const { syncOpenClawSsrfPolicySettings } = await import('@electron/utils/openclaw-ssrf-policy-settings');

    await syncOpenClawSsrfPolicySettings();

    expect(await readOpenClawJson()).toEqual({
      tools: {
        web: {
          fetch: {
            ssrfPolicy: {
              allowRfc2544BenchmarkRange: true,
            },
          },
        },
      },
      browser: {
        ssrfPolicy: {
          dangerouslyAllowPrivateNetwork: true,
        },
      },
    });
  });
});
