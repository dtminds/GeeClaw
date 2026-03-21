import { describe, expect, it, vi } from 'vitest';
import { join } from 'path';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: (name: string) => {
      if (name === 'userData') return '/tmp/geeclaw-test-userdata';
      return '/tmp/geeclaw-test';
    },
    getAppPath: () => '/tmp/geeclaw-test-app',
    getName: () => 'GeeClaw',
  },
}));

describe('OpenClaw config isolation', () => {
  it('uses ~/.openclaw-geeclaw instead of ~/.openclaw', async () => {
    const { getGeeClawConfigDir, getOpenClawConfigDir } = await import('@electron/utils/paths');
    const os = await import('os');

    expect(getGeeClawConfigDir()).toBe(join(os.homedir(), '.geeclaw'));
    expect(getOpenClawConfigDir()).toBe(join(os.homedir(), '.openclaw-geeclaw'));
    expect(getOpenClawConfigDir()).not.toBe(join(os.homedir(), '.openclaw'));
    expect(getOpenClawConfigDir()).not.toBe(join(getGeeClawConfigDir(), 'openclaw'));
  });

  it('keeps skills under the isolated config root', async () => {
    const { getOpenClawConfigDir, getOpenClawSkillsDir } = await import('@electron/utils/paths');

    expect(getOpenClawSkillsDir()).toBe(join(getOpenClawConfigDir(), 'skills'));
  });

  it('updates APP_PATHS.OPENCLAW_CONFIG to the isolated path', async () => {
    const { APP_PATHS } = await import('@electron/utils/config');

    expect(APP_PATHS.OPENCLAW_CONFIG).toBe('~/.openclaw-geeclaw');
    expect(APP_PATHS.OPENCLAW_CONFIG).not.toBe('~/.openclaw');
    expect(APP_PATHS.GEECLAW_CONFIG).toBe('~/.geeclaw');
  });
});
