import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises';

let openclawConfigDir = '/tmp/openclaw-safety-settings-test';
let systemOpenclawConfigDir = '/tmp/openclaw-system-config-test';

async function readJson(filePath: string): Promise<Record<string, unknown>> {
  const content = await readFile(filePath, 'utf8');
  return JSON.parse(content) as Record<string, unknown>;
}

vi.mock('@electron/utils/paths', () => ({
  getOpenClawConfigDir: vi.fn(() => openclawConfigDir),
  getSystemOpenClawConfigDir: vi.fn(() => systemOpenclawConfigDir),
  getOpenClawExecApprovalsPath: vi.fn(() => join(systemOpenclawConfigDir, 'exec-approvals.json')),
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

async function writeExecApprovalsJson(data: unknown): Promise<void> {
  await mkdir(systemOpenclawConfigDir, { recursive: true });
  await writeFile(join(systemOpenclawConfigDir, 'exec-approvals.json'), JSON.stringify(data, null, 2), 'utf8');
}

async function readExecApprovalsJson(): Promise<Record<string, unknown>> {
  return await readJson(join(systemOpenclawConfigDir, 'exec-approvals.json'));
}

describe('syncOpenClawSafetySettings', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    openclawConfigDir = await mkdtemp(join(tmpdir(), 'geeclaw-safety-settings-'));
    systemOpenclawConfigDir = await mkdtemp(join(tmpdir(), 'openclaw-system-config-'));
  });

  afterEach(async () => {
    await rm(openclawConfigDir, { recursive: true, force: true });
    await rm(systemOpenclawConfigDir, { recursive: true, force: true });
  });

  it('maps tool permission and approval policy without overwriting sibling tool config', async () => {
    await writeOpenClawJson({
      tools: {
        web: {
          search: {
            enabled: true,
            provider: 'firecrawl',
          },
        },
        exec: {
          timeoutMs: 90000,
          security: 'deny',
          ask: 'always',
        },
      },
    });

    const { syncOpenClawSafetySettings } = await import('@electron/utils/openclaw-safety-settings');

    await syncOpenClawSafetySettings({
      toolPermission: 'strict',
      approvalPolicy: 'allowlist',
    });

    const config = await readOpenClawJson();

    expect(config.tools).toEqual({
      profile: 'full',
      web: {
        search: {
          enabled: true,
          provider: 'firecrawl',
        },
      },
      exec: {
        timeoutMs: 90000,
        security: 'allowlist',
        ask: 'on-miss',
      },
      elevated: {
        enabled: false,
      },
      deny: ['group:automation', 'group:runtime', 'group:fs', 'sessions_spawn', 'sessions_send'],
    });

    expect(await readExecApprovalsJson()).toEqual({
      version: 1,
      defaults: {
        security: 'allowlist',
        ask: 'on-miss',
        askFallback: 'allowlist',
        autoAllowSkills: true,
      },
    });
  });

  it('updates only defaults in exec approvals while preserving existing version and sibling fields', async () => {
    await writeExecApprovalsJson({
      version: 9,
      defaults: {
        security: 'full',
        ask: 'off',
        askFallback: 'full',
        autoAllowSkills: false,
      },
      customField: {
        keep: true,
      },
    });

    const { syncOpenClawSafetySettings } = await import('@electron/utils/openclaw-safety-settings');

    await syncOpenClawSafetySettings({
      toolPermission: 'default',
      approvalPolicy: 'full',
    });

    expect(await readExecApprovalsJson()).toEqual({
      version: 9,
      defaults: {
        security: 'full',
        ask: 'off',
        askFallback: 'full',
        autoAllowSkills: true,
      },
      customField: {
        keep: true,
      },
    });
  });

  it('removes the deny list when tool permission is full', async () => {
    await writeOpenClawJson({
      tools: {
        deny: ['group:automation'],
        exec: {
          security: 'allowlist',
          ask: 'on-miss',
        },
      },
    });

    const { syncOpenClawSafetySettings } = await import('@electron/utils/openclaw-safety-settings');

    await syncOpenClawSafetySettings({
      toolPermission: 'full',
      approvalPolicy: 'full',
    });

    const config = await readOpenClawJson();

    expect(config.tools).toEqual({
      profile: 'full',
      exec: {
        security: 'full',
        ask: 'off',
      },
      elevated: {
        enabled: false,
      },
    });
  });

  it('initializes version when exec approvals exists but parses to a non-object value', async () => {
    await mkdir(systemOpenclawConfigDir, { recursive: true });
    await writeFile(join(systemOpenclawConfigDir, 'exec-approvals.json'), 'null', 'utf8');

    const { syncOpenClawSafetySettings } = await import('@electron/utils/openclaw-safety-settings');

    await syncOpenClawSafetySettings({
      toolPermission: 'default',
      approvalPolicy: 'full',
    });

    expect(await readExecApprovalsJson()).toEqual({
      version: 1,
      defaults: {
        security: 'full',
        ask: 'off',
        askFallback: 'full',
        autoAllowSkills: true,
      },
    });
  });
});
