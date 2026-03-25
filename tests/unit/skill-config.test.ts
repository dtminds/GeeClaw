import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const tempDirs: string[] = [];

afterEach(() => {
  vi.resetModules();
  vi.unmock('electron');
  vi.unmock('os');
  vi.unmock('@electron/utils/skills-policy');
  vi.unmock('@electron/utils/paths');
  vi.unmock('@electron/utils/store');
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('skill config sync', () => {
  it('patches skills entries without overwriting unrelated openclaw config sections', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'skill-config-'));
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

    vi.doMock('@electron/utils/paths', async () => {
      const actual = await vi.importActual<typeof import('@electron/utils/paths')>('@electron/utils/paths');
      return {
        ...actual,
        getOpenClawConfigDir: () => join(homeDir, '.openclaw-geeclaw'),
      };
    });

    vi.doMock('@electron/utils/skills-policy', () => ({
      getAlwaysEnabledSkillKeys: () => ['policy-skill'],
      isAlwaysEnabledSkillKey: (skillKey: string) => skillKey === 'policy-skill',
    }));

    vi.doMock('@electron/utils/store', () => ({
      getExplicitSkillToggles: async () => ({
        enabledSkills: ['enabled-personal-skill'],
        disabledSkills: [],
      }),
      setExplicitSkillToggle: vi.fn(),
    }));

    const configDir = join(homeDir, '.openclaw-geeclaw');
    const configPath = join(configDir, 'openclaw.json');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(configPath, JSON.stringify({
      agents: {
        defaults: {
          workspace: '/managed/workspace',
        },
        list: [
          { id: 'main', name: 'Main', default: true },
          { id: 'helper', name: 'Helper' },
        ],
      },
      gateway: {
        auth: {
          token: 'existing-token',
        },
      },
      skills: {
        entries: {
          existing: { enabled: true },
          'policy-skill': { enabled: false },
        },
      },
    }, null, 2), 'utf8');

    const {
      ensureAlwaysEnabledSkillsConfigured,
      ensureSkillEntriesDefaultDisabled,
    } = await import('@electron/utils/skill-config');

    const prelaunchResult = await ensureAlwaysEnabledSkillsConfigured();
    const result = await ensureSkillEntriesDefaultDisabled([
      'new-skill',
      'policy-skill',
      { skillKey: 'managed-skill', source: 'openclaw-managed' },
      { skillKey: 'extra-skill', source: 'openclaw-extra' },
      { skillKey: 'untoggled-personal-skill', source: 'agents-skills-personal' },
      { skillKey: 'enabled-personal-skill', source: 'agents-skills-personal' },
      { skillKey: 'personal-skill', source: 'agents-skills-personal' },
      { skillKey: 'project-skill', source: 'agents-skills-project' },
    ]);

    const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
      agents?: {
        defaults?: { workspace?: string };
        list?: Array<{ id: string }>;
      };
      gateway?: {
        auth?: { token?: string };
      };
      skills?: {
        entries?: Record<string, { enabled?: boolean }>;
      };
      commands?: {
        restart?: boolean;
      };
    };

    expect(prelaunchResult).toEqual({
      success: true,
      updated: ['policy-skill'],
    });
    expect(result).toEqual({
      success: true,
      added: ['new-skill', 'extra-skill', 'untoggled-personal-skill', 'personal-skill', 'project-skill'],
      normalizedAlwaysEnabled: [],
    });
    expect(config.agents?.defaults?.workspace).toBe('/managed/workspace');
    expect(config.agents?.list?.map((entry) => entry.id)).toEqual(['main', 'helper']);
    expect(config.gateway?.auth?.token).toBe('existing-token');
    expect(config.skills?.entries?.existing?.enabled).toBe(true);
    expect(config.skills?.entries?.['new-skill']?.enabled).toBe(false);
    expect(config.skills?.entries?.['untoggled-personal-skill']?.enabled).toBe(false);
    expect(config.skills?.entries?.['enabled-personal-skill']).toBeUndefined();
    expect(config.skills?.entries?.['policy-skill']).toBeUndefined();
    expect(config.skills?.entries?.['managed-skill']).toBeUndefined();
    expect(config.skills?.entries?.['extra-skill']?.enabled).toBe(false);
    expect(config.skills?.entries?.['personal-skill']?.enabled).toBe(false);
    expect(config.skills?.entries?.['project-skill']?.enabled).toBe(false);
    expect(config.commands?.restart).toBe(true);
  });

  it('stores only disabled state for individual skill toggles', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'skill-config-'));
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

    vi.doMock('@electron/utils/paths', async () => {
      const actual = await vi.importActual<typeof import('@electron/utils/paths')>('@electron/utils/paths');
      return {
        ...actual,
        getOpenClawConfigDir: () => join(homeDir, '.openclaw-geeclaw'),
      };
    });

    const setExplicitSkillToggle = vi.fn();
    vi.doMock('@electron/utils/store', () => ({
      getExplicitSkillToggles: async () => ({
        enabledSkills: [],
        disabledSkills: [],
      }),
      setExplicitSkillToggle,
    }));

    const configDir = join(homeDir, '.openclaw-geeclaw');
    const configPath = join(configDir, 'openclaw.json');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(configPath, JSON.stringify({
      skills: {
        entries: {
          'toggle-skill': { enabled: true },
          'configured-skill': { enabled: true, apiKey: 'abc' },
        },
      },
    }, null, 2), 'utf8');

    const { updateSkillConfig } = await import('@electron/utils/skill-config');

    await updateSkillConfig('toggle-skill', { enabled: true });
    await updateSkillConfig('configured-skill', { enabled: true });
    await updateSkillConfig('toggle-skill', { enabled: false });

    const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
      skills?: {
        entries?: Record<string, { enabled?: boolean; apiKey?: string }>;
      };
    };

    expect(config.skills?.entries?.['toggle-skill']?.enabled).toBe(false);
    expect(config.skills?.entries?.['configured-skill']).toEqual({ apiKey: 'abc' });
    expect(setExplicitSkillToggle).toHaveBeenNthCalledWith(1, 'toggle-skill', true);
    expect(setExplicitSkillToggle).toHaveBeenNthCalledWith(2, 'configured-skill', true);
    expect(setExplicitSkillToggle).toHaveBeenNthCalledWith(3, 'toggle-skill', false);
  });

  it('replays explicit skill toggles from settings into openclaw.json on startup', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'skill-config-'));
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

    vi.doMock('@electron/utils/paths', async () => {
      const actual = await vi.importActual<typeof import('@electron/utils/paths')>('@electron/utils/paths');
      return {
        ...actual,
        getOpenClawConfigDir: () => join(homeDir, '.openclaw-geeclaw'),
      };
    });

    vi.doMock('@electron/utils/store', () => ({
      getExplicitSkillToggles: async () => ({
        enabledSkills: ['enabled-skill', 'configured-enabled-skill'],
        disabledSkills: ['disabled-skill'],
      }),
      setExplicitSkillToggle: vi.fn(),
    }));

    const configDir = join(homeDir, '.openclaw-geeclaw');
    const configPath = join(configDir, 'openclaw.json');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(configPath, JSON.stringify({
      skills: {
        entries: {
          'enabled-skill': { enabled: false },
          'configured-enabled-skill': { enabled: false, apiKey: 'abc' },
        },
      },
    }, null, 2), 'utf8');

    const { syncExplicitSkillTogglesToOpenClaw } = await import('@electron/utils/skill-config');
    const result = await syncExplicitSkillTogglesToOpenClaw();
    const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
      skills?: {
        entries?: Record<string, { enabled?: boolean; apiKey?: string }>;
      };
    };

    expect(result).toEqual({
      success: true,
      enabled: ['enabled-skill', 'configured-enabled-skill'],
      disabled: ['disabled-skill'],
    });
    expect(config.skills?.entries?.['enabled-skill']).toBeUndefined();
    expect(config.skills?.entries?.['configured-enabled-skill']).toEqual({ apiKey: 'abc' });
    expect(config.skills?.entries?.['disabled-skill']).toEqual({ enabled: false });
  });

  it('syncs bundled preinstalled skill roots into skills.load.extraDirs', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'skill-config-'));
    tempDirs.push(homeDir);
    vi.resetModules();

    const resourcesDir = join(homeDir, 'resources');
    const preinstalledRoot = join(resourcesDir, '..', 'skills');
    const staleBundledRoot = '/Applications/Old/GeeClaw.app/Contents/Resources/resources/preinstalled-skills';

    mkdirSync(join(preinstalledRoot, 'pdf'), { recursive: true });
    mkdirSync(join(resourcesDir, 'skills'), { recursive: true });
    writeFileSync(join(resourcesDir, 'skills', 'preinstalled-manifest.json'), JSON.stringify({
      skills: [{ slug: 'pdf', autoEnable: true }],
    }, null, 2), 'utf8');
    writeFileSync(join(preinstalledRoot, '.preinstalled-lock.json'), JSON.stringify({
      skills: [{ slug: 'pdf', version: 'test-version' }],
    }, null, 2), 'utf8');
    writeFileSync(join(preinstalledRoot, 'pdf', 'SKILL.md'), '# PDF\n', 'utf8');

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

    vi.doMock('@electron/utils/paths', async () => {
      const actual = await vi.importActual<typeof import('@electron/utils/paths')>('@electron/utils/paths');
      return {
        ...actual,
        getOpenClawConfigDir: () => join(homeDir, '.openclaw-geeclaw'),
        getResourcesDir: () => resourcesDir,
      };
    });

    vi.doMock('@electron/utils/store', () => ({
      getExplicitSkillToggles: async () => ({
        enabledSkills: [],
        disabledSkills: [],
      }),
      setExplicitSkillToggle: vi.fn(),
    }));

    const configDir = join(homeDir, '.openclaw-geeclaw');
    const configPath = join(configDir, 'openclaw.json');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(configPath, JSON.stringify({
      skills: {
        load: {
          extraDirs: [
            '/custom/shared-skills',
            staleBundledRoot,
          ],
          watch: true,
        },
      },
    }, null, 2), 'utf8');

    const { syncPreinstalledSkillLoadPathsToOpenClaw } = await import('@electron/utils/skill-config');
    await syncPreinstalledSkillLoadPathsToOpenClaw();

    const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
      skills?: {
        load?: {
          extraDirs?: string[];
          watch?: boolean;
        };
      };
    };

    expect(config.skills?.load?.extraDirs).toEqual([
      '/custom/shared-skills',
      preinstalledRoot,
    ]);
    expect(config.skills?.load?.watch).toBe(true);
  });

  it('migrates legacy managed preinstalled skill copies to bundled app sources', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'skill-config-'));
    tempDirs.push(homeDir);
    vi.resetModules();

    const resourcesDir = join(homeDir, 'resources');
    const preinstalledRoot = join(resourcesDir, '..', 'skills');

    mkdirSync(join(resourcesDir, 'skills'), { recursive: true });
    mkdirSync(join(preinstalledRoot, 'pdf'), { recursive: true });
    writeFileSync(join(resourcesDir, 'skills', 'preinstalled-manifest.json'), JSON.stringify({
      skills: [{ slug: 'pdf', autoEnable: true }],
    }, null, 2), 'utf8');
    writeFileSync(join(preinstalledRoot, '.preinstalled-lock.json'), JSON.stringify({
      skills: [{ slug: 'pdf', version: 'test-version' }],
    }, null, 2), 'utf8');
    writeFileSync(join(preinstalledRoot, 'pdf', 'SKILL.md'), '# PDF\n', 'utf8');

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

    vi.doMock('@electron/utils/paths', async () => {
      const actual = await vi.importActual<typeof import('@electron/utils/paths')>('@electron/utils/paths');
      return {
        ...actual,
        getOpenClawConfigDir: () => join(homeDir, '.openclaw-geeclaw'),
        getResourcesDir: () => resourcesDir,
      };
    });

    vi.doMock('@electron/utils/store', () => ({
      getExplicitSkillToggles: async () => ({
        enabledSkills: [],
        disabledSkills: [],
      }),
      setExplicitSkillToggle: vi.fn(),
    }));

    const managedSkillsDir = join(homeDir, '.openclaw-geeclaw', 'skills');
    const migratedSkillDir = join(managedSkillsDir, 'pdf');
    const userSkillDir = join(managedSkillsDir, 'custom-skill');

    mkdirSync(migratedSkillDir, { recursive: true });
    mkdirSync(userSkillDir, { recursive: true });
    writeFileSync(join(migratedSkillDir, 'SKILL.md'), '# Old PDF\n', 'utf8');
    writeFileSync(join(migratedSkillDir, '.geeclaw-preinstalled.json'), JSON.stringify({
      source: 'geeclaw-preinstalled',
      slug: 'pdf',
      version: 'old-version',
      installedAt: '2026-03-24T00:00:00.000Z',
    }, null, 2), 'utf8');
    writeFileSync(join(userSkillDir, 'SKILL.md'), '# Custom Skill\n', 'utf8');

    const { migrateManagedPreinstalledSkillsToBundledSource } = await import('@electron/utils/skill-config');
    await migrateManagedPreinstalledSkillsToBundledSource();

    expect(existsSync(migratedSkillDir)).toBe(false);
    expect(existsSync(userSkillDir)).toBe(true);
  });
});
