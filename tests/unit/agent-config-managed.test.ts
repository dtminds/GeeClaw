import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const tempDirs: string[] = [];

afterEach(() => {
  vi.resetModules();
  vi.unmock('electron');
  vi.unmock('os');
  vi.unmock('@electron/services/agents/store-instance');
  vi.unmock('@electron/utils/agent-presets');
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('managed agent config domain', () => {
  it('installs a preset agent, seeds managed files, and writes skills into agents.list', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'managed-agent-install-'));
    tempDirs.push(homeDir);

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
      default: { homedir: () => homeDir },
    }));

    const configDir = join(homeDir, '.openclaw-geeclaw');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'openclaw.json'), JSON.stringify({
      agents: { defaults: { workspace: join(configDir, 'workspace') } },
    }, null, 2), 'utf8');

    const storeState: Record<string, unknown> = {};
    vi.doMock('@electron/services/agents/store-instance', () => ({
      getGeeClawAgentStore: vi.fn(async () => ({
        get: (key: string) => storeState[key],
        set: (key: string, value: unknown) => {
          storeState[key] = JSON.parse(JSON.stringify(value));
        },
        delete: (key: string) => {
          delete storeState[key];
        },
      })),
    }));

    vi.doMock('@electron/utils/agent-presets', () => ({
      getAgentPreset: vi.fn(async () => ({
        meta: {
          presetId: 'stock-expert',
          name: '股票助手',
          description: 'desc',
          iconKey: 'stock',
          category: 'finance',
          managed: true,
          agent: {
            id: 'stockexpert',
            workspace: '~/.openclaw-geeclaw/workspace-stockexpert',
            skillScope: {
              mode: 'specified',
              skills: ['stock-analyzer', 'stock-announcements', 'stock-explorer', 'web-search'],
            },
          },
        },
        files: {
          'AGENTS.md': '# stock expert\n',
          'SOUL.md': '# tone\n',
        },
      })),
      listAgentPresets: vi.fn(async () => []),
    }));

    const { installPresetAgent } = await import('@electron/utils/agent-config');
    const snapshot = await installPresetAgent('stock-expert');

    const config = JSON.parse(readFileSync(join(configDir, 'openclaw.json'), 'utf8')) as {
      agents?: { list?: Array<{ id?: string; skills?: string[] }> };
    };

    expect(snapshot.agents.find((agent) => agent.id === 'stockexpert')).toMatchObject({
      managed: true,
      source: 'preset',
      presetId: 'stock-expert',
      presetSkills: ['stock-analyzer', 'stock-announcements', 'stock-explorer', 'web-search'],
      managedFiles: ['AGENTS.md', 'SOUL.md'],
      canUseDefaultSkillScope: false,
    });
    expect(config.agents?.list?.find((agent) => agent.id === 'stockexpert')?.skills).toEqual([
      'stock-analyzer',
      'stock-announcements',
      'stock-explorer',
      'web-search',
    ]);
    expect(readFileSync(join(configDir, 'workspace-stockexpert', 'AGENTS.md'), 'utf8')).toContain('stock expert');
  });

  it('blocks removing preset skills while the agent remains managed', async () => {
    const { validateManagedSkillScope } = await import('@electron/utils/agent-config');

    expect(() => validateManagedSkillScope(
      ['stock-analyzer', 'stock-announcements'],
      { mode: 'specified', skills: ['stock-analyzer'] },
    )).toThrow('cannot remove preset-defined skills');
  });

  it('allows switching to default only after unmanage clears presetSkills', async () => {
    const { validateManagedSkillScope } = await import('@electron/utils/agent-config');

    expect(() => validateManagedSkillScope(
      ['stock-analyzer'],
      { mode: 'default' },
    )).toThrow('cannot use the default skill scope');

    expect(() => validateManagedSkillScope(
      [],
      { mode: 'default' },
    )).not.toThrow();
  });
});
