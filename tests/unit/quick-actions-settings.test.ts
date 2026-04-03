import { describe, expect, it, vi } from 'vitest';

class MockStore<T extends Record<string, unknown>> {
  store: T;

  constructor(options: { defaults: T }) {
    this.store = structuredClone(options.defaults);
  }

  get<K extends keyof T>(key: K): T[K] {
    return this.store[key];
  }

  set<K extends keyof T>(key: K, value: T[K]): void {
    this.store[key] = structuredClone(value);
  }

  clear(): void {
    this.store = {} as T;
  }
}

vi.mock('electron-store', () => ({
  default: MockStore,
}));

describe('quick action settings defaults', () => {
  it('includes built-in quick actions in the electron settings defaults', async () => {
    const { getAllSettings } = await import('@electron/utils/store');
    const settings = await getAllSettings();

    expect(settings.quickActions.actions.map((action) => action.id)).toEqual([
      'translate',
      'reply',
      'lookup',
    ]);
    expect(settings.quickActions.actions.every((action) => action.enabled === true)).toBe(true);
    expect(settings.quickActions.actions.every((action) => action.outputMode === 'copy')).toBe(true);
    expect(settings.quickActions.closeOnCopy).toBe(true);
    expect(settings.quickActions.preferClipboardFallback).toBe(true);
  });
});
