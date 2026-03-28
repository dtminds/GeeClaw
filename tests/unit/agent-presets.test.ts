import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';

const tempDirs: string[] = [];

afterEach(() => {
  vi.resetModules();
  vi.unmock('@electron/utils/paths');
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('agent preset loader', () => {
  it('loads preset packages and managed files from resources/agent-presets', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agent-presets-'));
    tempDirs.push(root);

    const presetDir = join(root, 'agent-presets', 'stock-expert');
    mkdirSync(join(presetDir, 'files'), { recursive: true });
    writeFileSync(
      join(presetDir, 'meta.json'),
      JSON.stringify(
        {
          presetId: 'stock-expert',
          name: 'Stock Expert',
          description: 'Analyze listed companies with preset skills.',
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
          managedPolicy: {
            lockedFields: ['id', 'workspace', 'persona'],
            canUnmanage: true,
          },
        },
        null,
        2,
      ),
      'utf8',
    );
    writeFileSync(join(presetDir, 'files', 'AGENTS.md'), '# Stock Expert\n', 'utf8');
    writeFileSync(join(presetDir, 'files', 'SOUL.md'), '# Tone\n', 'utf8');

    vi.doMock('@electron/utils/paths', async () => {
      const actual = await vi.importActual<typeof import('@electron/utils/paths')>('@electron/utils/paths');
      return {
        ...actual,
        getAgentPresetsDir: () => join(root, 'agent-presets'),
      };
    });

    const { listAgentPresets } = await import('@electron/utils/agent-presets');
    const presets = await listAgentPresets();

    expect(presets).toHaveLength(1);
    expect(presets[0].meta.agent.id).toBe('stockexpert');
    expect(presets[0].meta.agent.skillScope).toEqual({
      mode: 'specified',
      skills: ['stock-analyzer', 'stock-announcements', 'stock-explorer', 'web-search'],
    });
    expect(presets[0].files).toEqual({
      'AGENTS.md': '# Stock Expert\n',
      'SOUL.md': '# Tone\n',
    });
  });

  it('rejects presets whose specified skill scope exceeds 6 entries', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agent-presets-invalid-'));
    tempDirs.push(root);

    const presetDir = join(root, 'agent-presets', 'too-many-skills');
    mkdirSync(presetDir, { recursive: true });
    writeFileSync(
      join(presetDir, 'meta.json'),
      JSON.stringify(
        {
          presetId: 'too-many-skills',
          name: 'Too Many Skills',
          description: 'Invalid preset',
          iconKey: 'stock',
          category: 'finance',
          managed: true,
          agent: {
            id: 'too-many-skills',
            workspace: '~/.openclaw-geeclaw/workspace-too-many-skills',
            skillScope: {
              mode: 'specified',
              skills: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
            },
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    vi.doMock('@electron/utils/paths', async () => {
      const actual = await vi.importActual<typeof import('@electron/utils/paths')>('@electron/utils/paths');
      return {
        ...actual,
        getAgentPresetsDir: () => join(root, 'agent-presets'),
      };
    });

    const { listAgentPresets } = await import('@electron/utils/agent-presets');
    await expect(listAgentPresets()).rejects.toThrow('must not contain more than 6 skills');
  });

  it('rejects presets whose specified skill scope contains duplicate entries', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agent-presets-duplicate-'));
    tempDirs.push(root);

    const presetDir = join(root, 'agent-presets', 'duplicate-skills');
    mkdirSync(presetDir, { recursive: true });
    writeFileSync(
      join(presetDir, 'meta.json'),
      JSON.stringify(
        {
          presetId: 'duplicate-skills',
          name: 'Duplicate Skills',
          description: 'Invalid preset',
          iconKey: 'stock',
          category: 'finance',
          managed: true,
          agent: {
            id: 'duplicate-skills',
            workspace: '~/.openclaw-geeclaw/workspace-duplicate-skills',
            skillScope: {
              mode: 'specified',
              skills: ['stock-analyzer', 'web-search', 'stock-analyzer'],
            },
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    vi.doMock('@electron/utils/paths', async () => {
      const actual = await vi.importActual<typeof import('@electron/utils/paths')>('@electron/utils/paths');
      return {
        ...actual,
        getAgentPresetsDir: () => join(root, 'agent-presets'),
      };
    });

    const { listAgentPresets } = await import('@electron/utils/agent-presets');
    await expect(listAgentPresets()).rejects.toThrow('must not contain duplicate skills');
  });
});
