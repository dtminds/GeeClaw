import { isUserStatus, type UserStatus } from '../../../shared/auth/user-status';
import { logger } from '../../utils/logger';
import { proxyAwareFetch } from '../../utils/proxy-fetch';
import { GEECLAW_AUTH_API_ORIGIN, buildGeeclawAuthHeaders } from './geeclaw-auth-api';

const GEECLAW_USER_INFO_PATH = '/geeclaw/api/user/info';

type GeeclawUserInfoApiResponse = {
  data?: {
    avatar?: string;
    nickName?: string;
    status?: number | string;
    inviteCode?: string;
    shopId?: number;
    apiKey?: string;
  };
  success?: boolean;
  error?: number;
  errorMsg?: string;
  error_msg?: string;
  message?: string;
};

export interface GeeclawUserInfo {
  avatar?: string;
  nickName?: string;
  status: UserStatus;
  apiKey?: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function resolveErrorMessage(payload: GeeclawUserInfoApiResponse | null, fallback: string): string {
  const message = payload?.errorMsg || payload?.error_msg || payload?.message;
  if (typeof message === 'string' && message.trim()) {
    return message.trim();
  }
  return fallback;
}

function toFiniteStatus(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

export async function fetchGeeclawUserInfo(accessToken: string): Promise<GeeclawUserInfo> {
  const trimmedAccessToken = accessToken.trim();
  if (!trimmedAccessToken) {
    throw new Error('No active session');
  }

  logger.info('[GeeclawUserInfo] Fetching GeeClaw user info');

  const url = new URL(GEECLAW_USER_INFO_PATH, GEECLAW_AUTH_API_ORIGIN);
  const response = await proxyAwareFetch(url.toString(), {
    method: 'GET',
    headers: buildGeeclawAuthHeaders(trimmedAccessToken),
  });

  const rawText = await response.text();
  const payload: GeeclawUserInfoApiResponse | null = (() => {
    try {
      return (asRecord(rawText ? JSON.parse(rawText) : {}) as GeeclawUserInfoApiResponse | null) ?? null;
    } catch {
      return null;
    }
  })();

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('User info session expired');
    }
    throw new Error(resolveErrorMessage(payload, rawText.trim() || `User info request failed (${response.status})`));
  }

  if (payload?.success === false) {
    throw new Error(resolveErrorMessage(payload, 'User info request failed'));
  }

  const status = toFiniteStatus(payload?.data?.status);
  if (status === null) {
    throw new Error('User info response missing status');
  }
  if (!isUserStatus(status)) {
    throw new Error(`User info response returned unsupported status: ${status}`);
  }

  return {
    avatar: payload?.data?.avatar?.trim() || undefined,
    nickName: payload?.data?.nickName?.trim() || undefined,
    status,
    apiKey: payload?.data?.apiKey?.trim() || undefined,
  };
}
