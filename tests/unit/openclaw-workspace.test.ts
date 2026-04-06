import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdtempSync } from 'fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('openclaw workspace context repair', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('ignores orphaned workspace directories under the OpenClaw config dir', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'openclaw-workspace-'));
    const homeDir = join(rootDir, 'home');
    const configDir = join(rootDir, '.openclaw-geeclaw');
    const managedWorkspaceDir = join(homeDir, 'geeclaw', 'workspace');
    const orphanWorkspaceDir = join(configDir, 'workspace-orphan');
    const orphanBootstrapPath = join(orphanWorkspaceDir, 'AGENTS.md');

    mkdirSync(homeDir, { recursive: true });
    mkdirSync(configDir, { recursive: true });
    mkdirSync(managedWorkspaceDir, { recursive: true });
    mkdirSync(orphanWorkspaceDir, { recursive: true });

    writeFileSync(join(configDir, 'openclaw.json'), JSON.stringify({
      agents: {
        defaults: {
          workspace: managedWorkspaceDir,
        },
        list: [],
      },
    }, null, 2), 'utf8');
    writeFileSync(orphanBootstrapPath, '<!-- geeclaw:begin -->\nseeded elsewhere\n<!-- geeclaw:end -->\n', 'utf8');

    vi.doMock('os', () => ({
      homedir: () => homeDir,
      default: {
        homedir: () => homeDir,
      },
    }));

    vi.doMock('@electron/utils/paths', () => ({
      getOpenClawConfigDir: () => configDir,
      getResourcesDir: () => join(rootDir, 'resources'),
      expandPath: (value: string) => value,
    }));

    const { repairGeeClawOnlyBootstrapFiles } = await import('@electron/utils/openclaw-workspace');
    await repairGeeClawOnlyBootstrapFiles();

    expect(existsSync(orphanBootstrapPath)).toBe(true);
  });

  it('does not recreate a missing configured workspace while merging GeeClaw context', async () => {
    vi.stubGlobal('setTimeout', ((callback: (...args: unknown[]) => void) => {
      callback();
      return 0;
    }) as typeof setTimeout);

    const rootDir = mkdtempSync(join(tmpdir(), 'openclaw-workspace-'));
    const homeDir = join(rootDir, 'home');
    const configDir = join(rootDir, '.openclaw-geeclaw');
    const resourcesDir = join(rootDir, 'resources');
    const contextDir = join(resourcesDir, 'context');
    const deletedWorkspaceDir = join(homeDir, 'geeclaw', 'workspace-helper');

    mkdirSync(homeDir, { recursive: true });
    mkdirSync(configDir, { recursive: true });
    mkdirSync(contextDir, { recursive: true });

    writeFileSync(join(configDir, 'openclaw.json'), JSON.stringify({
      agents: {
        defaults: {
          workspace: deletedWorkspaceDir,
        },
        list: [],
      },
    }, null, 2), 'utf8');
    writeFileSync(join(contextDir, 'AGENTS.geeclaw.md'), 'helper context\n', 'utf8');

    vi.doMock('os', () => ({
      homedir: () => homeDir,
      default: {
        homedir: () => homeDir,
      },
    }));

    vi.doMock('@electron/utils/paths', () => ({
      getOpenClawConfigDir: () => configDir,
      getResourcesDir: () => resourcesDir,
      expandPath: (value: string) => value,
    }));

    const { ensureGeeClawContext } = await import('@electron/utils/openclaw-workspace');
    await ensureGeeClawContext();

    expect(existsSync(deletedWorkspaceDir)).toBe(false);
  });
});
