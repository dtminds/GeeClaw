import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createRequireMock,
  getOpenClawDirMock,
  getOpenClawResolvedDirMock,
  getOpenClawConfigDirMock,
} = vi.hoisted(() => ({
  createRequireMock: vi.fn(),
  getOpenClawDirMock: vi.fn(() => '/virtual/openclaw'),
  getOpenClawResolvedDirMock: vi.fn(() => '/virtual/openclaw-real'),
  getOpenClawConfigDirMock: vi.fn(() => '/virtual/.openclaw-geeclaw'),
}));

function makeRequireStub(): NodeJS.Require {
  const requireStub = vi.fn((specifier: string) => {
    if (specifier.includes('@whiskeysockets/baileys')) {
      return {
        default: vi.fn(),
        useMultiFileAuthState: vi.fn(),
        DisconnectReason: { loggedOut: 401 },
        fetchLatestBaileysVersion: vi.fn(),
      };
    }

    if (specifier.includes('QRErrorCorrectLevel')) {
      return { L: 'L' };
    }

    if (specifier === 'pino') {
      return vi.fn(() => ({
        trace: vi.fn(),
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
        child: vi.fn(),
      }));
    }

    return function MockQRCode() {
      return {
        addData: vi.fn(),
        make: vi.fn(),
        getModuleCount: vi.fn(() => 1),
        isDark: vi.fn(() => false),
      };
    };
  }) as unknown as NodeJS.Require;

  requireStub.resolve = vi.fn((specifier: string) => `/virtual/${specifier.replaceAll('/', '__')}`);
  requireStub.cache = {};
  requireStub.extensions = {};
  requireStub.main = undefined;

  return requireStub;
}

createRequireMock.mockImplementation(() => makeRequireStub());

vi.mock('module', async (importOriginal) => {
  const actual = await importOriginal<typeof import('module')>();
  return {
    ...actual,
    createRequire: createRequireMock,
    default: {
      ...actual,
      createRequire: createRequireMock,
    },
  };
});

vi.mock('@electron/utils/paths', () => ({
  getOpenClawDir: getOpenClawDirMock,
  getOpenClawResolvedDir: getOpenClawResolvedDirMock,
  getOpenClawConfigDir: getOpenClawConfigDirMock,
}));

describe('login modules', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    createRequireMock.mockImplementation(() => makeRequireStub());
    getOpenClawDirMock.mockReturnValue('/virtual/openclaw');
    getOpenClawResolvedDirMock.mockReturnValue('/virtual/openclaw-real');
    getOpenClawConfigDirMock.mockReturnValue('/virtual/.openclaw-geeclaw');
  });

  it.each([
    '@electron/utils/whatsapp-login',
    '@electron/utils/wecom-login',
    '@electron/utils/weixin-login',
  ])('does not resolve OpenClaw runtime during import: %s', async (moduleId) => {
    await import(moduleId);

    expect(getOpenClawDirMock).not.toHaveBeenCalled();
    expect(getOpenClawResolvedDirMock).not.toHaveBeenCalled();
  });
});
