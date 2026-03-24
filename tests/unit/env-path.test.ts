import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const originalPlatform = process.platform;

function setPlatform(platform: string) {
  Object.defineProperty(process, 'platform', { value: platform, writable: true });
}

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform, writable: true });
});

describe('env-path', () => {
  let getPathEnvKey: (env: Record<string, string | undefined>) => string;
  let getPathEnvValue: (env: Record<string, string | undefined>) => string;
  let setPathEnvValue: (
    env: Record<string, string | undefined>,
    nextPath: string,
  ) => Record<string, string | undefined>;
  let prependPathEntry: (
    env: Record<string, string | undefined>,
    entry: string,
  ) => { env: Record<string, string | undefined>; path: string };
  let prependPathEntries: (
    env: Record<string, string | undefined>,
    entries: string[],
  ) => { env: Record<string, string | undefined>; path: string };

  beforeEach(async () => {
    const mod = await import('@electron/utils/env-path');
    getPathEnvKey = mod.getPathEnvKey;
    getPathEnvValue = mod.getPathEnvValue;
    setPathEnvValue = mod.setPathEnvValue;
    prependPathEntry = mod.prependPathEntry;
    prependPathEntries = mod.prependPathEntries;
  });

  it('prefers Path key on Windows', () => {
    setPlatform('win32');
    expect(getPathEnvKey({ Path: 'C:\\Windows', PATH: 'C:\\Temp' })).toBe('Path');
  });

  it('reads path value from Path key on Windows', () => {
    setPlatform('win32');
    expect(getPathEnvValue({ Path: 'C:\\Windows;C:\\Tools' })).toBe('C:\\Windows;C:\\Tools');
  });

  it('uses PATH key on non-Windows', () => {
    setPlatform('linux');
    expect(getPathEnvKey({ PATH: '/usr/bin', Path: '/tmp/bin' })).toBe('PATH');
  });

  it('removes duplicate path keys when setting a new value', () => {
    setPlatform('win32');
    const next = setPathEnvValue(
      { Path: 'C:\\A', PATH: 'C:\\B', PaTh: 'C:\\C', HOME: 'C:\\Users\\me' },
      'C:\\A;C:\\B',
    );
    expect(next.Path).toBe('C:\\A;C:\\B');
    expect(next.PATH).toBeUndefined();
    expect(next.PaTh).toBeUndefined();
    expect(next.HOME).toBe('C:\\Users\\me');
  });

  it('prepends entry with Windows delimiter', () => {
    setPlatform('win32');
    const next = prependPathEntry({ Path: 'C:\\Windows\\System32' }, 'D:\\geeclaw\\resources\\bin');
    expect(next.path).toBe('D:\\geeclaw\\resources\\bin;C:\\Windows\\System32');
    expect(next.env.Path).toBe('D:\\geeclaw\\resources\\bin;C:\\Windows\\System32');
  });

  it('prepends entry with POSIX delimiter', () => {
    setPlatform('linux');
    const next = prependPathEntry({ PATH: '/usr/bin:/bin' }, '/opt/geeclaw/bin');
    expect(next.path).toBe('/opt/geeclaw/bin:/usr/bin:/bin');
    expect(next.env.PATH).toBe('/opt/geeclaw/bin:/usr/bin:/bin');
  });

  it('prepends multiple entries while preserving caller priority', () => {
    setPlatform('linux');
    const next = prependPathEntries(
      { PATH: '/usr/bin:/bin' },
      ['/opt/geeclaw/managed-bin', '/opt/geeclaw/bin'],
    );
    expect(next.path).toBe('/opt/geeclaw/managed-bin:/opt/geeclaw/bin:/usr/bin:/bin');
    expect(next.env.PATH).toBe('/opt/geeclaw/managed-bin:/opt/geeclaw/bin:/usr/bin:/bin');
  });
});
