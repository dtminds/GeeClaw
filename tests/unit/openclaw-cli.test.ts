import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    getName: () => 'GeeClaw',
  },
}));

vi.mock('@electron/utils/paths', () => ({
  getOpenClawDir: () => '/opt/geeclaw/resources/openclaw',
  getOpenClawEntryPath: () => '/opt/geeclaw/resources/openclaw/openclaw.mjs',
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    default: actual,
    appendFileSync: vi.fn(),
    chmodSync: vi.fn(),
    existsSync: vi.fn((value: string) => value === '/opt/geeclaw/resources/openclaw/openclaw.mjs'),
    mkdirSync: vi.fn(),
    readFileSync: vi.fn(),
    symlinkSync: vi.fn(),
    unlinkSync: vi.fn(),
  };
});

describe('OpenClaw CLI command resolution', () => {
  beforeAll(() => {
    Object.defineProperty(process, 'resourcesPath', {
      value: '/opt/geeclaw/resources',
      configurable: true,
    });
  });

  it('does not fall back to a system openclaw command', async () => {
    const { getOpenClawCliCommand } = await import('@electron/utils/openclaw-cli');

    const command = await getOpenClawCliCommand();

    expect(command).toContain(process.execPath);
    expect(command).toContain('/opt/geeclaw/resources/openclaw/openclaw.mjs');
    expect(command).not.toContain('/usr/local/bin/openclaw');
  });
});
