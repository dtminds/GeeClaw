import { EventEmitter } from 'events';
import { createRequire } from 'module';
import { dirname, join } from 'path';
import { createHash } from 'crypto';
import { deflateSync } from 'zlib';
import { proxyAwareFetch } from './proxy-fetch';
import * as logger from './logger';
import { resolveRuntimePackageJson } from './runtime-package-resolver';
import {
  normalizeWeixinAccountId,
  readWeixinRouteTag,
  saveWeixinAccountState,
  WEIXIN_DEFAULT_BASE_URL,
  WEIXIN_DEFAULT_BOT_TYPE,
} from './weixin-state';

const require = createRequire(import.meta.url);

type QrDependencies = {
  QRCode: new (typeNumber: number, errorCorrectionLevel: unknown) => {
    addData: (input: string) => void;
    make: () => void;
    getModuleCount: () => number;
    isDark: (row: number, col: number) => boolean;
  };
  QRErrorCorrectLevel: {
    L: unknown;
  };
};

let qrDependencies: QrDependencies | null = null;

function getQrDependencies(): QrDependencies {
  if (qrDependencies) {
    return qrDependencies;
  }

  const qrcodeTerminalPath = dirname(resolveRuntimePackageJson('qrcode-terminal'));
  qrDependencies = {
    QRCode: require(join(qrcodeTerminalPath, 'vendor', 'QRCode', 'index.js')) as QrDependencies['QRCode'],
    QRErrorCorrectLevel: require(join(
      qrcodeTerminalPath,
      'vendor',
      'QRCode',
      'QRErrorCorrectLevel.js',
    )) as QrDependencies['QRErrorCorrectLevel'],
  };

  return qrDependencies;
}

const QR_LONG_POLL_TIMEOUT_MS = 35_000;
const LOGIN_TIMEOUT_MS = 8 * 60_000;
const LOGIN_TTL_MS = 5 * 60_000;
const MAX_QR_REFRESH_COUNT = 3;

type WeixinQrCodeResponse = {
  qrcode?: string;
  qrcode_img_content?: string;
};

type WeixinQrStatusResponse = {
  status?: 'wait' | 'scaned' | 'confirmed' | 'expired';
  bot_token?: string;
  ilink_bot_id?: string;
  baseurl?: string;
  ilink_user_id?: string;
};

type ActiveLogin = {
  sessionKey: string;
  accountId?: string;
  apiBaseUrl: string;
  botType: string;
  qrcode: string;
  qrcodeUrl: string;
  startedAt: number;
};

function createQrMatrix(input: string) {
  const { QRCode, QRErrorCorrectLevel } = getQrDependencies();
  const qr = new QRCode(-1, QRErrorCorrectLevel.L);
  qr.addData(input);
  qr.make();
  return qr;
}

function fillPixel(
  buf: Buffer,
  x: number,
  y: number,
  width: number,
  r: number,
  g: number,
  b: number,
  a = 255,
): void {
  const idx = (y * width + x) * 4;
  buf[idx] = r;
  buf[idx + 1] = g;
  buf[idx + 2] = b;
  buf[idx + 3] = a;
}

function crcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
}

const CRC_TABLE = crcTable();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = crc32(Buffer.concat([typeBuf, data]));
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc, 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePngRgba(buffer: Buffer, width: number, height: number): Buffer {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let row = 0; row < height; row += 1) {
    const rawOffset = row * (stride + 1);
    raw[rawOffset] = 0;
    buffer.copy(raw, rawOffset + 1, row * stride, row * stride + stride);
  }
  const compressed = deflateSync(raw);

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

async function renderQrPngBase64(input: string, opts: { scale?: number; marginModules?: number } = {}): Promise<string> {
  const { scale = 6, marginModules = 4 } = opts;
  const qr = createQrMatrix(input);
  const modules = qr.getModuleCount();
  const size = (modules + marginModules * 2) * scale;
  const buf = Buffer.alloc(size * size * 4, 255);

  for (let row = 0; row < modules; row += 1) {
    for (let col = 0; col < modules; col += 1) {
      if (!qr.isDark(row, col)) continue;
      const startX = (col + marginModules) * scale;
      const startY = (row + marginModules) * scale;
      for (let y = 0; y < scale; y += 1) {
        for (let x = 0; x < scale; x += 1) {
          fillPixel(buf, startX + x, startY + y, size, 0, 0, 0, 255);
        }
      }
    }
  }

  return encodePngRgba(buf, size, size).toString('base64');
}

function isLoginFresh(login: ActiveLogin): boolean {
  return Date.now() - login.startedAt < LOGIN_TTL_MS;
}

function createSessionKey(accountId?: string): string {
  if (accountId?.trim()) {
    return normalizeWeixinAccountId(accountId);
  }
  return createHash('sha1').update(`${Date.now()}:${Math.random()}`).digest('hex').slice(0, 16);
}

async function fetchQrCode(apiBaseUrl: string, botType: string, accountId?: string): Promise<WeixinQrCodeResponse> {
  const base = apiBaseUrl.endsWith('/') ? apiBaseUrl : `${apiBaseUrl}/`;
  const url = new URL(`ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(botType)}`, base);
  const routeTag = await readWeixinRouteTag(accountId);
  const headers: Record<string, string> = {};
  if (routeTag) {
    headers.SKRouteTag = routeTag;
  }

  const response = await proxyAwareFetch(url.toString(), { headers });
  if (!response.ok) {
    const body = await response.text().catch(() => '(unreadable)');
    throw new Error(`Failed to fetch Weixin QR code: HTTP ${response.status} ${body}`);
  }

  return await response.json() as WeixinQrCodeResponse;
}

async function pollQrStatus(apiBaseUrl: string, qrcode: string, accountId?: string): Promise<WeixinQrStatusResponse> {
  const base = apiBaseUrl.endsWith('/') ? apiBaseUrl : `${apiBaseUrl}/`;
  const url = new URL(`ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`, base);
  const routeTag = await readWeixinRouteTag(accountId);
  const headers: Record<string, string> = {
    'iLink-App-ClientVersion': '1',
  };
  if (routeTag) {
    headers.SKRouteTag = routeTag;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), QR_LONG_POLL_TIMEOUT_MS);
  try {
    const response = await proxyAwareFetch(url.toString(), { headers, signal: controller.signal });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Failed to poll Weixin QR status: HTTP ${response.status} ${text}`);
    }
    return JSON.parse(text) as WeixinQrStatusResponse;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { status: 'wait' };
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export class WeixinLoginManager extends EventEmitter {
  private active = false;

  private sessionId = 0;

  private activeLogin: ActiveLogin | null = null;

  async start(accountId?: string): Promise<void> {
    await this.stop();
    this.active = true;
    this.sessionId += 1;
    const localSessionId = this.sessionId;
    const sessionKey = createSessionKey(accountId);
    const normalizedAccountId = accountId?.trim() ? normalizeWeixinAccountId(accountId) : undefined;
    const botType = WEIXIN_DEFAULT_BOT_TYPE;
    const apiBaseUrl = WEIXIN_DEFAULT_BASE_URL;

    try {
      const qrResponse = await fetchQrCode(apiBaseUrl, botType, normalizedAccountId);
      const qrcode = qrResponse.qrcode?.trim();
      const qrcodeUrl = qrResponse.qrcode_img_content?.trim();
      if (!qrcode || !qrcodeUrl) {
        throw new Error('Failed to generate Weixin QR code');
      }

      if (!this.isSessionActive(localSessionId)) return;

      this.activeLogin = {
        sessionKey,
        accountId: normalizedAccountId,
        apiBaseUrl,
        botType,
        qrcode,
        qrcodeUrl,
        startedAt: Date.now(),
      };

      const qr = await renderQrPngBase64(qrcodeUrl);
      if (!this.isSessionActive(localSessionId) || !this.activeLogin) return;

      logger.info('weixin:qr-generated', {
        accountId: normalizedAccountId,
        sessionKey,
      });
      this.emit('qr', { qr, qrcodeUrl, sessionKey });

      await this.waitForLogin(localSessionId);
    } catch (error) {
      if (!this.isSessionActive(localSessionId)) return;
      this.active = false;
      this.activeLogin = null;
      const message = error instanceof Error ? error.message : String(error);
      logger.error('weixin:login-error', message);
      this.emit('error', message);
    }
  }

  async stop(): Promise<void> {
    this.active = false;
    this.sessionId += 1;
    this.activeLogin = null;
  }

  private isSessionActive(sessionId: number): boolean {
    return this.active && this.sessionId === sessionId;
  }

  private async refreshQr(localSessionId: number): Promise<void> {
    const activeLogin = this.activeLogin;
    if (!activeLogin) {
      throw new Error('Weixin login session is missing');
    }

    const qrResponse = await fetchQrCode(activeLogin.apiBaseUrl, activeLogin.botType, activeLogin.accountId);
    const qrcode = qrResponse.qrcode?.trim();
    const qrcodeUrl = qrResponse.qrcode_img_content?.trim();
    if (!qrcode || !qrcodeUrl) {
      throw new Error('Failed to refresh Weixin QR code');
    }

    activeLogin.qrcode = qrcode;
    activeLogin.qrcodeUrl = qrcodeUrl;
    activeLogin.startedAt = Date.now();

    if (!this.isSessionActive(localSessionId)) return;

    const qr = await renderQrPngBase64(qrcodeUrl);
    if (!this.isSessionActive(localSessionId)) return;

    this.emit('qr', { qr, qrcodeUrl, sessionKey: activeLogin.sessionKey, refreshed: true });
  }

  private async waitForLogin(localSessionId: number): Promise<void> {
    const deadline = Date.now() + LOGIN_TIMEOUT_MS;
    let qrRefreshCount = 1;
    let scanAnnounced = false;

    while (this.isSessionActive(localSessionId) && Date.now() < deadline) {
      const activeLogin = this.activeLogin;
      if (!activeLogin || !isLoginFresh(activeLogin)) {
        throw new Error('Weixin QR code expired, please restart the login flow');
      }

      const statusResponse = await pollQrStatus(activeLogin.apiBaseUrl, activeLogin.qrcode, activeLogin.accountId);
      if (!this.isSessionActive(localSessionId)) return;

      switch (statusResponse.status) {
        case 'wait':
          break;
        case 'scaned':
          if (!scanAnnounced) {
            scanAnnounced = true;
            this.emit('status', { status: 'scanned' });
          }
          break;
        case 'expired':
          qrRefreshCount += 1;
          if (qrRefreshCount > MAX_QR_REFRESH_COUNT) {
            throw new Error('Weixin QR code expired too many times, please try again');
          }
          await this.refreshQr(localSessionId);
          scanAnnounced = false;
          break;
        case 'confirmed': {
          const rawAccountId = statusResponse.ilink_bot_id?.trim();
          const botToken = statusResponse.bot_token?.trim();
          if (!rawAccountId || !botToken) {
            throw new Error('Weixin login succeeded but credentials were missing');
          }

          const normalizedAccountId = await saveWeixinAccountState(rawAccountId, {
            token: botToken,
            baseUrl: statusResponse.baseurl?.trim() || activeLogin.apiBaseUrl,
            userId: statusResponse.ilink_user_id?.trim(),
          });

          this.active = false;
          this.activeLogin = null;
          logger.info('weixin:login-success', { accountId: normalizedAccountId });
          this.emit('success', {
            accountId: normalizedAccountId,
            rawAccountId,
            botToken,
            baseUrl: statusResponse.baseurl?.trim() || activeLogin.apiBaseUrl,
            userId: statusResponse.ilink_user_id?.trim(),
          });
          return;
        }
        default:
          break;
      }
    }

    if (this.isSessionActive(localSessionId)) {
      this.active = false;
      this.activeLogin = null;
      this.emit('error', 'Weixin scan timed out, please try again');
    }
  }
}

export const weixinLoginManager = new WeixinLoginManager();
