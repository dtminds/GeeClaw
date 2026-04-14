import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const tempDirs: string[] = [];

afterEach(() => {
  vi.resetModules();
  vi.unmock('electron');
  vi.unmock('os');
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('agent runtime sync default model cleanup', () => {
  it('removes deleted default model slots from openclaw.json during agent runtime sync', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'agent-runtime-sync-'));
    tempDirs.push(homeDir);
    vi.resetModules();

    vi.doMock('electron', () => ({
      app: {
        isPackaged: false,
        getPath: () => homeDir,
        getAppPath: () => '/tmp/geeclaw-test-app',
        getName: () => 'GeeClaw',
        getVersion: () => '0.0.1-test',
      },
    }));

    vi.doMock('os', () => ({
      homedir: () => homeDir,
      default: {
        homedir: () => homeDir,
      },
    }));

    const agentStoreState: Record<string, unknown> = {};
    const agentStore = {
      get: (key: string) => agentStoreState[key],
      set: (key: string, value: unknown) => {
        agentStoreState[key] = JSON.parse(JSON.stringify(value));
      },
      delete: (key: string) => {
        delete agentStoreState[key];
      },
    };

    vi.doMock('../../electron/services/agents/store-instance', () => ({
      getGeeClawAgentStore: vi.fn(async () => agentStore),
    }));

    const configDir = join(homeDir, '.openclaw-geeclaw');
    const configPath = join(configDir, 'openclaw.json');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(configPath, JSON.stringify({
      agents: {
        defaults: {
          workspace: '/managed/workspace',
          model: {
            primary: 'openai/gpt-5.4',
            fallbacks: [],
          },
          models: {
            'openai/gpt-5.4': {
              alias: 'gpt',
            },
          },
          imageGenerationModel: {
            primary: 'openai/gpt-image-1',
            fallbacks: [],
          },
        },
      },
    }, null, 2), 'utf8');

    agentStore.set('agents', {
      defaults: {
        workspace: '/managed/workspace',
        model: {
          primary: 'openai/gpt-5.4',
          fallbacks: [],
        },
      },
      list: [
        {
          id: 'main',
          name: 'Main',
          agentDir: '~/.openclaw-geeclaw/agents/main/agent',
        },
      ],
    });

    const { syncAllAgentConfigToOpenClaw } = await import('@electron/services/agents/agent-runtime-sync');
    await syncAllAgentConfigToOpenClaw();

    const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
      agents?: {
        defaults?: {
          workspace?: string;
          model?: { primary?: string; fallbacks?: string[] };
          models?: Record<string, { alias?: string }>;
          imageGenerationModel?: { primary?: string; fallbacks?: string[] };
        };
      };
    };

    expect(config.agents?.defaults?.workspace).toBe('/managed/workspace');
    expect(config.agents?.defaults?.model).toEqual({
      primary: 'openai/gpt-5.4',
      fallbacks: [],
    });
    expect(config.agents?.defaults?.models).toBeUndefined();
    expect(config.agents?.defaults?.imageGenerationModel).toBeUndefined();
  });
});
