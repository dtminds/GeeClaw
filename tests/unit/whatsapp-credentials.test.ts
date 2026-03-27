import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tempDirs: string[] = [];

function createHomeDir(): string {
  const homeDir = join(tmpdir(), `whatsapp-creds-${Math.random().toString(36).slice(2)}`);
  tempDirs.push(homeDir);
  return homeDir;
}

function mockStores(): void {
  vi.doMock('../../electron/services/channels/store-instance', () => ({
    getGeeClawChannelStore: vi.fn(async () => ({
      get: vi.fn(),
      set: vi.fn(),
      delete: vi.fn(),
    })),
  }));

  vi.doMock('../../electron/services/agents/store-instance', () => ({
    getGeeClawAgentStore: vi.fn(async () => ({
      get: vi.fn(),
      set: vi.fn(),
      delete: vi.fn(),
    })),
  }));
}

function mockRuntime(homeDir: string): void {
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
  mockStores();
}

afterEach(() => {
  vi.resetModules();
  vi.unmock('electron');
  vi.unmock('os');
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('WhatsApp credentials helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('treats empty WhatsApp account dirs as unconfigured', async () => {
    const homeDir = createHomeDir();
    mockRuntime(homeDir);

    const { getWhatsAppAccountCredentialsDir, hasConfiguredWhatsAppSession } = await import('@electron/utils/whatsapp-credentials');
    const { listConfiguredChannels } = await import('@electron/utils/channel-config');

    mkdirSync(getWhatsAppAccountCredentialsDir('default'), { recursive: true });

    expect(await hasConfiguredWhatsAppSession()).toBe(false);
    await expect(listConfiguredChannels()).resolves.not.toContain('whatsapp');
  });

  it('treats creds.json as the signal for a configured WhatsApp session', async () => {
    const homeDir = createHomeDir();
    mockRuntime(homeDir);

    const { getWhatsAppAccountCredentialsDir, hasConfiguredWhatsAppSession } = await import('@electron/utils/whatsapp-credentials');
    const { listConfiguredChannels } = await import('@electron/utils/channel-config');

    const accountDir = getWhatsAppAccountCredentialsDir('default');
    mkdirSync(accountDir, { recursive: true });
    writeFileSync(join(accountDir, 'creds.json'), '{}', 'utf8');

    expect(await hasConfiguredWhatsAppSession()).toBe(true);
    await expect(listConfiguredChannels()).resolves.toContain('whatsapp');
  });

  it('cleans up cancelled login dirs without touching existing persisted sessions', async () => {
    const homeDir = createHomeDir();
    mockRuntime(homeDir);

    const {
      cleanupCancelledWhatsAppLogin,
      getWhatsAppAccountCredentialsDir,
      getWhatsAppCredentialsDir,
    } = await import('@electron/utils/whatsapp-credentials');
    const { listConfiguredChannels } = await import('@electron/utils/channel-config');

    const existingAccountDir = getWhatsAppAccountCredentialsDir('existing');
    mkdirSync(existingAccountDir, { recursive: true });
    writeFileSync(join(existingAccountDir, 'creds.json'), '{"session":true}', 'utf8');

    const cancelledAccountDir = getWhatsAppAccountCredentialsDir('cancelled');
    mkdirSync(cancelledAccountDir, { recursive: true });

    expect(cleanupCancelledWhatsAppLogin('cancelled')).toBe(true);
    expect(cleanupCancelledWhatsAppLogin('existing')).toBe(false);

    expect(existsSync(cancelledAccountDir)).toBe(false);
    expect(existsSync(existingAccountDir)).toBe(true);
    expect(existsSync(getWhatsAppCredentialsDir())).toBe(true);
    await expect(listConfiguredChannels()).resolves.toContain('whatsapp');
  });
});
