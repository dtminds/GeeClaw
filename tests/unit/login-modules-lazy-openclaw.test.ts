import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createRequireMock,
  getOpenClawDirMock,
  getOpenClawResolvedDirMock,
  getOpenClawConfigDirMock,
  proxyAwareFetchMock,
} = vi.hoisted(() => ({
  createRequireMock: vi.fn(),
  getOpenClawDirMock: vi.fn(() => '/virtual/openclaw'),
  getOpenClawResolvedDirMock: vi.fn(() => '/virtual/openclaw-real'),
  getOpenClawConfigDirMock: vi.fn(() => '/virtual/.openclaw-geeclaw'),
  proxyAwareFetchMock: vi.fn(),
}));

function makeRequireStub(resolveImpl?: (specifier: string) => string): NodeJS.Require {
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

  requireStub.resolve = vi.fn(resolveImpl ?? ((specifier: string) => `/virtual/${specifier.replaceAll('/', '__')}`));
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

vi.mock('electron', () => ({
  app: {
    getAppPath: () => '/virtual/app',
  },
}));

vi.mock('@electron/utils/proxy-fetch', () => ({
  proxyAwareFetch: (...args: unknown[]) => proxyAwareFetchMock(...args),
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

  function configureQrcodeFallbackRequireMock(): void {
    createRequireMock.mockImplementation((from: string | URL) => {
      const requireFrom = String(from);
      if (requireFrom === '/virtual/openclaw-real/package.json' || requireFrom === '/virtual/openclaw/package.json') {
        return makeRequireStub((specifier) => {
          if (specifier === 'qrcode-terminal/package.json') {
            throw new Error(
              `Cannot find module 'qrcode-terminal/package.json' Require stack: - ${requireFrom}`,
            );
          }
          return `/virtual/openclaw/node_modules/${specifier}`;
        });
      }

      if (requireFrom === '/virtual/app/package.json') {
        return makeRequireStub((specifier) => {
          if (specifier === 'qrcode-terminal/package.json') {
            return '/virtual/app/node_modules/qrcode-terminal/package.json';
          }
          return `/virtual/app/node_modules/${specifier}`;
        });
      }

      return makeRequireStub();
    });
  }

  it('renders a WeCom QR code from the app dependency graph when the sidecar lacks qrcode-terminal', async () => {
    configureQrcodeFallbackRequireMock();
    proxyAwareFetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            scode: 'scode-test',
            auth_url: 'https://work.weixin.qq.com/ai/qc/auth?scode=scode-test',
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: { status: 'expired' } }),
      });

    const { weComLoginManager } = await import('@electron/utils/wecom-login');
    const qrEvents: Array<{ qr: string }> = [];
    weComLoginManager.on('qr', (event) => qrEvents.push(event as { qr: string }));
    weComLoginManager.on('error', () => {});

    try {
      await weComLoginManager.start('default');
    } finally {
      weComLoginManager.removeAllListeners();
      await weComLoginManager.stop();
    }

    expect(Buffer.from(qrEvents[0]?.qr ?? '', 'base64').subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    expect(createRequireMock).toHaveBeenCalledWith('/virtual/app/package.json');
  });

  it('renders a Weixin QR code from the app dependency graph when the sidecar lacks qrcode-terminal', async () => {
    configureQrcodeFallbackRequireMock();
    proxyAwareFetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        qrcode: 'qrcode-token',
        qrcode_img_content: 'https://wx.example.test/qrcode-token',
      }),
    });

    const { weixinLoginManager } = await import('@electron/utils/weixin-login');
    const qrEvents: Array<{ qr: string }> = [];
    weixinLoginManager.on('qr', (event) => {
      qrEvents.push(event as { qr: string });
      void weixinLoginManager.stop();
    });
    weixinLoginManager.on('error', () => {});

    try {
      await weixinLoginManager.start('default');
    } finally {
      weixinLoginManager.removeAllListeners();
      await weixinLoginManager.stop();
    }

    expect(Buffer.from(qrEvents[0]?.qr ?? '', 'base64').subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    expect(createRequireMock).toHaveBeenCalledWith('/virtual/app/package.json');
  });
});
