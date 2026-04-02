import { beforeEach, describe, expect, it, vi } from 'vitest';
import { shell } from 'electron';

const loggerWarnMock = vi.fn();

vi.mock('@electron/utils/logger', () => ({
  logger: {
    warn: loggerWarnMock,
  },
}));

describe('external-links', () => {
  beforeEach(() => {
    vi.resetModules();
    loggerWarnMock.mockReset();
    vi.mocked(shell.openExternal).mockClear();
  });

  it('allows http and https URLs', async () => {
    const { isSafeExternalUrl, openSafeExternalUrl } = await import('@electron/utils/external-links');

    expect(isSafeExternalUrl('https://example.com')).toBe(true);
    expect(isSafeExternalUrl('http://127.0.0.1:13210/path')).toBe(true);
    await expect(openSafeExternalUrl('https://example.com')).resolves.toBe(true);
    expect(shell.openExternal).toHaveBeenCalledWith('https://example.com');
  });

  it('blocks disallowed protocols and malformed URLs', async () => {
    const { isSafeExternalUrl, openSafeExternalUrl } = await import('@electron/utils/external-links');

    expect(isSafeExternalUrl('file:///tmp/test.txt')).toBe(false);
    expect(isSafeExternalUrl('not-a-url')).toBe(false);
    await expect(openSafeExternalUrl('javascript:alert(1)')).resolves.toBe(false);
    await expect(openSafeExternalUrl('not-a-url')).resolves.toBe(false);
    expect(shell.openExternal).not.toHaveBeenCalled();
    expect(loggerWarnMock).toHaveBeenCalled();
  });
});
