import { BrowserWindow } from 'electron';
import { logger } from '../../utils/logger';

export interface WechatAuthConfig {
  loginPageUrl: string;
  callbackUrlPrefix: string;
  loginApiUrl: string;
  extraDataHeader: string;
  requestOriginHeader: string;
  timeoutMs: number;
}

export interface WechatLoginResult {
  code: string;
  rawResponse: unknown;
  token: string;
  userInfo: Record<string, unknown>;
}

function maskValue(value: string | null | undefined, keepHead = 4, keepTail = 4): string {
  if (!value) return '(empty)';
  if (value.length <= keepHead + keepTail) return `${value.slice(0, 2)}***`;
  return `${value.slice(0, keepHead)}***${value.slice(-keepTail)}`;
}

function sanitizeAuthResponseForLog(value: unknown, parentKey?: string): unknown {
  const sensitiveKeys = new Set([
    'token',
    'accessToken',
    'refreshToken',
    'openid',
    'unionid',
    'sessionKey',
  ]);

  if (typeof value === 'string') {
    if (parentKey && sensitiveKeys.has(parentKey)) {
      return maskValue(value);
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeAuthResponseForLog(item, parentKey));
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const next: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(record)) {
      next[key] = sanitizeAuthResponseForLog(child, key);
    }
    return next;
  }

  return value;
}

function stringifyForLog(value: unknown, maxLength = 3000): string {
  try {
    const text = JSON.stringify(value);
    if (text.length <= maxLength) {
      return text;
    }
    return `${text.slice(0, maxLength)}...(truncated)`;
  } catch {
    return String(value);
  }
}

const DEFAULT_TIMEOUT_MS = 3 * 60 * 1000;
const WECHAT_APP_ID = 'wxeb0be7ca66db3ea9';
const WECHAT_REDIRECT_URI = 'https://auth.geeclaw.cn/callback';
const WECHAT_SCOPE = 'snsapi_login';
const WECHAT_STATE = 'geeclaw_login';
const AUTH_LOGIN_API_URL = 'https://api.geeclaw.cn/geeclaw/api/auth/login';
const AUTH_XY_EXTRA_DATA = 'appid=wx0573c66bdfab18bc;version=1.9.990;envVersion=release;senceId=1089';
const AUTH_REQUEST_ORIGIN = 'Knife4j';
const WECHAT_LOGIN_TIMEOUT_MS = DEFAULT_TIMEOUT_MS;

function buildWechatLoginPageUrl(): string {
  const params = new URLSearchParams({
    appid: WECHAT_APP_ID,
    redirect_uri: WECHAT_REDIRECT_URI,
    response_type: 'code',
    scope: WECHAT_SCOPE,
    state: WECHAT_STATE,
  });
  return `https://open.weixin.qq.com/connect/qrconnect?${params.toString()}#wechat_redirect`;
}

function normalizeUrlPrefix(value: string): string {
  const trimmed = value.trim();
  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
}

function getWechatAuthConfig(): WechatAuthConfig {
  return {
    loginPageUrl: buildWechatLoginPageUrl(),
    callbackUrlPrefix: WECHAT_REDIRECT_URI.trim(),
    loginApiUrl: AUTH_LOGIN_API_URL.trim(),
    extraDataHeader: AUTH_XY_EXTRA_DATA.trim(),
    requestOriginHeader: AUTH_REQUEST_ORIGIN.trim(),
    timeoutMs: WECHAT_LOGIN_TIMEOUT_MS,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function pickByPath(source: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((cursor, key) => {
    const record = asRecord(cursor);
    return record ? record[key] : undefined;
  }, source);
}

function pickStringValue(source: Record<string, unknown>, paths: string[]): string | null {
  for (const path of paths) {
    const value = pickByPath(source, path);
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function resolveToken(payload: Record<string, unknown>): string | null {
  return pickStringValue(payload, [
    'accessToken',
    'data.accessToken',
    'result.accessToken',
    'token',
    'data.token',
    'result.token',
  ]);
}

function resolveUserInfo(payload: Record<string, unknown>): Record<string, unknown> {
  const candidates = [
    pickByPath(payload, 'data'),
    pickByPath(payload, 'userInfo'),
    pickByPath(payload, 'data.userInfo'),
    pickByPath(payload, 'result.userInfo'),
    pickByPath(payload, 'user'),
    pickByPath(payload, 'data.user'),
    pickByPath(payload, 'result.user'),
    pickByPath(payload, 'account'),
    pickByPath(payload, 'data.account'),
  ];
  for (const candidate of candidates) {
    const record = asRecord(candidate);
    if (record) {
      return record;
    }
  }
  return {};
}

function readCodeFromUrl(urlString: string, callbackUrlPrefix: string): string | null {
  const normalizedPrefix = normalizeUrlPrefix(callbackUrlPrefix);
  const normalizedUrl = normalizeUrlPrefix(urlString);
  if (!normalizedUrl.startsWith(normalizedPrefix)) {
    return null;
  }
  try {
    const url = new URL(urlString);
    const code = url.searchParams.get('code');
    if (code) {
      logger.info(`[WechatAuth] Detected redirect code in callback URL: ${maskValue(code)}`);
    }
    return code?.trim() || null;
  } catch {
    return null;
  }
}

function isCancelSignalUrl(urlString: string, callbackUrlPrefix: string): boolean {
  const normalizedPrefix = normalizeUrlPrefix(callbackUrlPrefix);
  const normalizedUrl = normalizeUrlPrefix(urlString);
  if (!normalizedUrl.startsWith(normalizedPrefix)) {
    return false;
  }
  try {
    const url = new URL(urlString);
    return url.searchParams.get('geeclaw_cancel') === '1';
  } catch {
    return false;
  }
}

async function waitForWechatCode(
  loginPageUrl: string,
  callbackUrlPrefix: string,
  mainWindow: BrowserWindow | null,
  timeoutMs: number,
): Promise<string> {
  if (!loginPageUrl) {
    throw new Error('Missing WeChat login page URL constant');
  }
  if (!callbackUrlPrefix) {
    throw new Error('Missing WeChat callback URL prefix constant');
  }
  
  const hasParentWindow = Boolean(mainWindow && !mainWindow.isDestroyed());
  const popup = new BrowserWindow({
    width: 640,
    height: 520,
    parent: hasParentWindow ? mainWindow! : undefined,
    modal: hasParentWindow,
    frame: true,
    titleBarStyle: 'default',
    show: false,
    autoHideMenuBar: true,
    closable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    resizable: false,
    title: '微信扫码登录',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  logger.info(`[WechatAuth] Opening WeChat login URL: ${loginPageUrl}`);
  logger.info(`[WechatAuth] Waiting for callback prefix: ${callbackUrlPrefix}`);

  return await new Promise<string>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      cleanup();
      settled = true;
      if (!popup.isDestroyed()) popup.close();
      logger.error('[WechatAuth] Login timed out while waiting for callback redirect');
      reject(new Error('WeChat login timed out while waiting for redirect code'));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timeout);
      popup.webContents.removeListener('will-redirect', handleNavigation);
      popup.webContents.removeListener('will-navigate', handleNavigation);
      popup.webContents.removeListener('did-navigate', handleDidNavigate);
      popup.webContents.removeListener('before-input-event', handleInputEvent);
      popup.webContents.removeListener('did-finish-load', injectCloseButton);
      popup.removeListener('closed', handleClosed);
    };

    const finishSuccess = (code: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (!popup.isDestroyed()) popup.close();
      logger.info(`[WechatAuth] WeChat code captured successfully: ${maskValue(code)}`);
      resolve(code);
    };

    const finishError = (message: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (!popup.isDestroyed()) popup.close();
      logger.error(`[WechatAuth] Login flow failed: ${message}`);
      reject(new Error(message));
    };

    const tryExtractCode = (targetUrl: string): string | null => readCodeFromUrl(targetUrl, callbackUrlPrefix);

    const handleNavigation = (event: Electron.Event, targetUrl: string) => {
      if (isCancelSignalUrl(targetUrl, callbackUrlPrefix)) {
        event.preventDefault();
        logger.info(`[WechatAuth] Received cancel signal URL: ${targetUrl}`);
        finishError('Login window was closed before completing WeChat authentication');
        return;
      }
      const code = tryExtractCode(targetUrl);
      if (!code) return;
      logger.info(`[WechatAuth] will-redirect matched callback URL: ${targetUrl}`);
      event.preventDefault();
      finishSuccess(code);
    };

    const handleDidNavigate = (_event: Electron.Event, targetUrl: string) => {
      if (isCancelSignalUrl(targetUrl, callbackUrlPrefix)) {
        logger.info(`[WechatAuth] did-navigate received cancel signal URL: ${targetUrl}`);
        finishError('Login window was closed before completing WeChat authentication');
        return;
      }
      const code = tryExtractCode(targetUrl);
      if (!code) return;
      logger.info(`[WechatAuth] did-navigate matched callback URL: ${targetUrl}`);
      finishSuccess(code);
    };

    const handleInputEvent = (_event: Electron.Event, input: Electron.Input) => {
      if (input.type === 'keyDown' && input.key === 'Escape' && !popup.isDestroyed()) {
        popup.close();
      }
    };

    const injectCloseButton = () => {
      if (popup.isDestroyed()) return;
      void popup.webContents.executeJavaScript(`
        (() => {
          if (document.getElementById('__geeclaw_wechat_close_btn')) return;
          const btn = document.createElement('button');
          btn.id = '__geeclaw_wechat_close_btn';
          btn.textContent = '✕';
          btn.setAttribute('aria-label', '关闭登录窗口');
          btn.style.position = 'fixed';
          btn.style.top = '14px';
          btn.style.right = '14px';
          btn.style.zIndex = '2147483647';
          btn.style.width = '28px';
          btn.style.height = '28px';
          btn.style.padding = '0';
          btn.style.borderRadius = '14px';
          btn.style.border = 'none';
          btn.style.background = 'transparent';
          btn.style.color = '#111827';
          btn.style.fontSize = '18px';
          btn.style.fontWeight = '400';
          btn.style.lineHeight = '28px';
          btn.style.textAlign = 'center';
          btn.style.cursor = 'pointer';
          btn.style.opacity = '0.72';
          btn.addEventListener('mouseenter', () => { btn.style.opacity = '1'; });
          btn.addEventListener('mouseleave', () => { btn.style.opacity = '0.72'; });
          btn.addEventListener('click', () => {
            const base = '${callbackUrlPrefix}';
            const sep = base.includes('?') ? '&' : '?';
            window.location.href = base + sep + 'geeclaw_cancel=1';
          });
          (document.body || document.documentElement).appendChild(btn);
        })();
      `).catch(() => {});
    };

    const handleClosed = () => {
      if (settled) return;
      finishError('Login window was closed before completing WeChat authentication');
    };

    popup.webContents.on('will-redirect', handleNavigation);
    popup.webContents.on('will-navigate', handleNavigation);
    popup.webContents.on('did-navigate', handleDidNavigate);
    popup.webContents.on('before-input-event', handleInputEvent);
    popup.webContents.on('did-finish-load', injectCloseButton);
    popup.on('closed', handleClosed);

    popup.once('ready-to-show', () => popup.show());
    void popup.loadURL(loginPageUrl).catch((error) => {
      finishError(`Failed to load WeChat login page: ${String(error)}`);
    });
  });
}

export async function exchangeWechatCode(
  code: string,
  deviceId: string,
): Promise<Omit<WechatLoginResult, 'code'>> {
  const config = getWechatAuthConfig();
  logger.info(
    `[WechatAuth] Exchanging code with auth API. api=${config.loginApiUrl}, code=${maskValue(code)}, deviceId=${maskValue(deviceId, 6, 4)}`,
  );
  const response = await fetch(config.loginApiUrl, {
    method: 'POST',
    headers: {
      Accept: '*/*',
      'xy-extra-data': config.extraDataHeader,
      'Request-Origion': config.requestOriginHeader,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ code, deviceId }),
  });

  const text = await response.text();
  let raw: unknown = text;
  try {
    raw = text ? JSON.parse(text) : {};
  } catch {
    // Keep raw response as text fallback.
  }
  logger.info(
    `[WechatAuth] Auth login API raw response (sanitized): ${stringifyForLog(sanitizeAuthResponseForLog(raw))}`,
  );

  if (!response.ok) {
    logger.error(`[WechatAuth] Auth login API returned non-OK status: ${response.status}`);
    throw new Error(`Auth login API failed (${response.status}): ${typeof raw === 'string' ? raw : JSON.stringify(raw)}`);
  }

  const payload = asRecord(raw) ?? {};
  logger.info(`[WechatAuth] Auth login API responded OK. payloadKeys=${Object.keys(payload).join(',')}`);
  const token = resolveToken(payload);
  if (!token) {
    logger.error('[WechatAuth] Failed to resolve token/accessToken from auth response payload');
    throw new Error('Auth login API response missing token/accessToken');
  }

  const userInfo = resolveUserInfo(payload);
  logger.info(
    `[WechatAuth] Parsed auth response. token=${maskValue(token)}, userInfoKeys=${Object.keys(userInfo).join(',') || '(none)'}`,
  );

  return {
    rawResponse: raw,
    token,
    userInfo,
  };
}

export async function runWechatLoginFlow(
  mainWindow: BrowserWindow | null,
  deviceId: string,
): Promise<WechatLoginResult> {
  const config = getWechatAuthConfig();
  logger.info('[WechatAuth] Starting WeChat login flow');
  const code = await waitForWechatCode(
    config.loginPageUrl,
    config.callbackUrlPrefix,
    mainWindow,
    config.timeoutMs > 0 ? config.timeoutMs : DEFAULT_TIMEOUT_MS,
  );
  logger.info(`[WechatAuth] Callback stage completed. code=${maskValue(code)}`);
  const result = await exchangeWechatCode(code, deviceId);
  logger.info('[WechatAuth] Code exchange completed successfully');
  return {
    code,
    ...result,
  };
}
