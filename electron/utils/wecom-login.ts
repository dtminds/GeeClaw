import { EventEmitter } from 'events';
import { createRequire } from 'module';
import { dirname, join } from 'path';
import { platform } from 'os';
import { getOpenClawResolvedDir } from './paths';
import { proxyAwareFetch } from './proxy-fetch';

const openclawResolvedPath = getOpenClawResolvedDir();
const openclawRequire = createRequire(join(openclawResolvedPath, 'package.json'));

function resolveOpenClawPackageJson(packageName: string): string {
  const specifier = `${packageName}/package.json`;
  return openclawRequire.resolve(specifier);
}

const qrcodeTerminalPath = dirname(resolveOpenClawPackageJson('qrcode-terminal'));
const require = createRequire(import.meta.url);
const QRCodeModule = require(join(qrcodeTerminalPath, 'vendor', 'QRCode', 'index.js'));
const QRErrorCorrectLevelModule = require(join(qrcodeTerminalPath, 'vendor', 'QRCode', 'QRErrorCorrectLevel.js'));

const QRCode = QRCodeModule;
const QRErrorCorrectLevel = QRErrorCorrectLevelModule;

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 180000;

function getPlatCode(): number {
  switch (platform()) {
    case 'darwin':
      return 1;
    case 'win32':
      return 2;
    case 'linux':
      return 3;
    default:
      return 0;
  }
}

function createQrMatrix(input: string) {
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
  const compressed = require('zlib').deflateSync(raw);

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

async function renderQrPngBase64(
  input: string,
  opts: { scale?: number; marginModules?: number } = {},
): Promise<string> {
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
        const pixelY = startY + y;
        for (let x = 0; x < scale; x += 1) {
          const pixelX = startX + x;
          fillPixel(buf, pixelX, pixelY, size, 0, 0, 0, 255);
        }
      }
    }
  }

  const png = encodePngRgba(buf, size, size);
  return png.toString('base64');
}

type WeComGenerateResponse = {
  data?: {
    scode?: string;
    auth_url?: string;
  };
};

type WeComPollResponse = {
  data?: {
    status?: string;
    bot_info?: {
      botid?: string;
      secret?: string;
    };
  };
};

export class WeComLoginManager extends EventEmitter {
  private active = false;

  private sessionId = 0;

  async start(accountId = 'default'): Promise<void> {
    await this.stop();
    this.active = true;
    this.sessionId += 1;
    const localSessionId = this.sessionId;

    try {
      const generateUrl = `https://work.weixin.qq.com/ai/qc/generate?source=wecom-cli&plat=${getPlatCode()}`;
      const generateResp = await proxyAwareFetch(generateUrl, { method: 'GET' });
      if (!generateResp.ok) {
        throw new Error(`Failed to request WeCom QR code: HTTP ${generateResp.status}`);
      }
      const generateJson = await generateResp.json() as WeComGenerateResponse;

      const scode = generateJson?.data?.scode;
      const authUrl = generateJson?.data?.auth_url;
      if (!scode || !authUrl) {
        throw new Error('Failed to generate WeCom QR code');
      }

      if (!this.isSessionActive(localSessionId)) return;

      const qr = await renderQrPngBase64(authUrl);
      if (!this.isSessionActive(localSessionId)) return;

      this.emit('qr', { qr, authUrl, scode });

      await this.pollResult(localSessionId, accountId, scode);
    } catch (error) {
      if (!this.isSessionActive(localSessionId)) return;
      this.active = false;
      this.emit('error', error instanceof Error ? error.message : String(error));
    }
  }

  async stop(): Promise<void> {
    this.active = false;
    this.sessionId += 1;
  }

  private isSessionActive(sessionId: number): boolean {
    return this.active && this.sessionId === sessionId;
  }

  private async pollResult(sessionId: number, accountId: string, scode: string): Promise<void> {
    const startedAt = Date.now();
    const queryUrl = `https://work.weixin.qq.com/ai/qc/query_result?scode=${encodeURIComponent(scode)}`;

    while (this.isSessionActive(sessionId) && Date.now() - startedAt < POLL_TIMEOUT_MS) {
      const pollResp = await proxyAwareFetch(queryUrl, { method: 'GET' });
      if (!pollResp.ok) {
        throw new Error(`Failed to poll WeCom QR status: HTTP ${pollResp.status}`);
      }
      const pollJson = await pollResp.json() as WeComPollResponse;

      if (!this.isSessionActive(sessionId)) return;

      const status = pollJson?.data?.status;
      if (status === 'success') {
        const botId = pollJson?.data?.bot_info?.botid;
        const secret = pollJson?.data?.bot_info?.secret;
        if (!botId || !secret) {
          throw new Error('WeCom scan succeeded but bot credentials were missing');
        }

        this.active = false;
        this.emit('success', { accountId, botId, secret });
        return;
      }

      if (status === 'expired') {
        throw new Error('WeCom QR code expired, please refresh and scan again');
      }

      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }

    if (this.isSessionActive(sessionId)) {
      this.active = false;
      this.emit('error', 'WeCom scan timed out after 3 minutes');
    }
  }
}

export const weComLoginManager = new WeComLoginManager();
