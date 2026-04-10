import { describe, expect, it, vi } from 'vitest';

describe('bundle-openclaw cleanup helpers', () => {
  it('removes an existing directory with force and retry options before recreating it', async () => {
    const { cleanDirectorySync } = await import('../../scripts/lib/fs-utils.mjs');

    const existsSync = vi.fn(() => true);
    const rmSync = vi.fn();
    const mkdirSync = vi.fn();

    cleanDirectorySync('/tmp/build/openclaw', {
      existsSync,
      rmSync,
      mkdirSync,
    });

    expect(existsSync).toHaveBeenCalledWith('/tmp/build/openclaw');
    expect(rmSync).toHaveBeenCalledWith('/tmp/build/openclaw', {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
    expect(mkdirSync).toHaveBeenCalledWith('/tmp/build/openclaw', { recursive: true });
  });

  it('creates the directory even when there is no previous output to delete', async () => {
    const { cleanDirectorySync } = await import('../../scripts/lib/fs-utils.mjs');

    const existsSync = vi.fn(() => false);
    const rmSync = vi.fn();
    const mkdirSync = vi.fn();

    cleanDirectorySync('/tmp/build/openclaw', {
      existsSync,
      rmSync,
      mkdirSync,
    });

    expect(rmSync).not.toHaveBeenCalled();
    expect(mkdirSync).toHaveBeenCalledWith('/tmp/build/openclaw', { recursive: true });
  });
});
