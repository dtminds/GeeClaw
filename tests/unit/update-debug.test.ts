import { afterEach, describe, expect, it } from 'vitest';
import {
  DEV_UPDATE_DEBUG_STORAGE_KEY,
  getDevDebugUpdateScenario,
} from '@/lib/update-debug';

const originalUrl = window.location.href;

describe('update debug helpers', () => {
  afterEach(() => {
    window.localStorage.removeItem(DEV_UPDATE_DEBUG_STORAGE_KEY);
    window.history.replaceState({}, '', originalUrl);
  });

  it('reads a preset from localStorage in dev mode', () => {
    window.localStorage.setItem(DEV_UPDATE_DEBUG_STORAGE_KEY, 'downloading');

    const scenario = getDevDebugUpdateScenario();

    expect(scenario?.status).toBe('downloading');
    expect(scenario?.progress?.percent).toBe(42);
    expect(scenario?.updateInfo.version).toBe('9.9.9-dev.1');
  });

  it('lets the query string override localStorage', () => {
    window.localStorage.setItem(DEV_UPDATE_DEBUG_STORAGE_KEY, 'available');
    window.history.replaceState({}, '', `${window.location.pathname}?debugUpdate=downloaded`);

    const scenario = getDevDebugUpdateScenario();

    expect(scenario?.status).toBe('downloaded');
    expect(scenario?.autoInstallCountdown).toBe(5);
  });

  it('accepts a JSON payload for custom dialog content', () => {
    window.localStorage.setItem(
      DEV_UPDATE_DEBUG_STORAGE_KEY,
      JSON.stringify({
        status: 'available',
        version: '1.2.3-test',
        releaseName: 'GeeClaw Canary',
        releaseNotes: '## Preview\n\n- Custom content',
      }),
    );

    const scenario = getDevDebugUpdateScenario();

    expect(scenario?.status).toBe('available');
    expect(scenario?.updateInfo.version).toBe('1.2.3-test');
    expect(scenario?.updateInfo.releaseName).toBe('GeeClaw Canary');
    expect(scenario?.updateInfo.releaseNotes).toBe('## Preview\n\n- Custom content');
  });
});
