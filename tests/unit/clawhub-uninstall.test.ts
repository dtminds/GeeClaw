import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import { tmpdir } from 'os';

const originalPlatform = process.platform;

const hoisted = vi.hoisted(() => ({
  workDir: '',
}));

function setPlatform(platform: string) {
  Object.defineProperty(process, 'platform', { value: platform, writable: true });
}

vi.mock('electron', () => ({
  app: {
    getAppPath: () => '/tmp/app',
    isPackaged: false,
  },
  shell: {
    openPath: vi.fn(),
  },
}));

vi.mock('@electron/utils/paths', () => ({
  ensureDir: (dir: string) => mkdirSync(dir, { recursive: true }),
  getOpenClawConfigDir: () => hoisted.workDir,
  getResourcesDir: () => '/tmp/resources',
  quoteForCmd: (value: string) => value,
}));

vi.mock('@electron/utils/skillhub-installer', () => ({
  getSkillHubInstallLocations: () => ({
    homeDir: '/tmp',
    installBase: '/tmp/.skillhub',
    binDir: '/tmp/.skillhub/bin',
    wrapperPath: '/tmp/.skillhub/bin/skillhub',
    cliPath: '/tmp/.skillhub/skills_store_cli.py',
  }),
  installSkillHubCli: vi.fn(),
  isSkillHubInstalledAtKnownLocation: () => false,
  readInstalledSkillHubVersion: vi.fn(async () => undefined),
}));

vi.mock('@electron/utils/uv-setup', () => ({
  checkUvInstalled: vi.fn(async () => false),
  isPythonReady: vi.fn(async () => false),
}));

describe('ClawHubService uninstall', () => {
  beforeEach(() => {
    vi.resetModules();
    setPlatform('linux');
    hoisted.workDir = mkdtempSync(path.join(tmpdir(), 'clawhub-uninstall-'));
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, writable: true });
    if (hoisted.workDir && fs.existsSync(hoisted.workDir)) {
      rmSync(hoisted.workDir, { recursive: true, force: true });
    }
  });

  it('removes matching entries from .clawhub and .clawdhub using the installed baseDir', async () => {
    const skillDir = path.join(hoisted.workDir, 'skills', 'friendly-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(path.join(skillDir, 'SKILL.md'), [
      '---',
      'name: Friendly Skill',
      '---',
      '',
      '# Friendly Skill',
      '',
    ].join('\n'));

    const clawhubDir = path.join(hoisted.workDir, '.clawhub');
    const clawdhubDir = path.join(hoisted.workDir, '.clawdhub');
    mkdirSync(clawhubDir, { recursive: true });
    mkdirSync(clawdhubDir, { recursive: true });

    writeFileSync(path.join(clawhubDir, 'lock.json'), JSON.stringify({
      version: 1,
      skills: {
        'friendly-skill': { version: '1.0.0' },
        'other-skill': { version: '2.0.0' },
      },
    }, null, 2));
    writeFileSync(path.join(clawdhubDir, 'lock.json'), JSON.stringify({
      version: 1,
      skills: {
        'Friendly Skill': { version: '1.0.0' },
        'friendly-skill': { version: '1.0.0' },
        'other-skill': { version: '2.0.0' },
      },
    }, null, 2));

    const { ClawHubService } = await import('@electron/gateway/clawhub');
    const service = new ClawHubService();

    await service.uninstall({
      slug: 'Friendly Skill',
      skillKey: 'Friendly Skill',
      baseDir: skillDir,
    });

    expect(fs.existsSync(skillDir)).toBe(false);

    const clawhubLock = JSON.parse(readFileSync(path.join(clawhubDir, 'lock.json'), 'utf8')) as {
      skills?: Record<string, unknown>;
    };
    const clawdhubLock = JSON.parse(readFileSync(path.join(clawdhubDir, 'lock.json'), 'utf8')) as {
      skills?: Record<string, unknown>;
    };

    expect(clawhubLock.skills?.['friendly-skill']).toBeUndefined();
    expect(clawdhubLock.skills?.['friendly-skill']).toBeUndefined();
    expect(clawdhubLock.skills?.['Friendly Skill']).toBeUndefined();
    expect(clawhubLock.skills?.['other-skill']).toBeDefined();
    expect(clawdhubLock.skills?.['other-skill']).toBeDefined();
  });
});
