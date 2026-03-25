import { logger } from '../../utils/logger';
import { proxyAwareFetch } from '../../utils/proxy-fetch';
import { GEECLAW_AUTH_API_ORIGIN, buildGeeclawAuthHeaders } from './geeclaw-auth-api';

const GEECLAW_INVITE_BIND_PATH = '/geeclaw/api/invite/bind';

type InviteBindApiResponse = {
  data?: boolean;
  success?: boolean;
  error?: number;
  errorMsg?: string;
  error_msg?: string;
  message?: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function resolveInviteBindMessage(payload: InviteBindApiResponse | null, fallback: string): string {
  const message = payload?.errorMsg || payload?.error_msg || payload?.message;
  if (typeof message === 'string' && message.trim()) {
    return message.trim();
  }
  return fallback;
}

async function requestInviteBind(
  inviteCode: string,
  accessToken: string,
  method: 'POST' | 'GET',
): Promise<{ response: Response; payload: InviteBindApiResponse | null; rawText: string }> {
  const url = new URL(GEECLAW_INVITE_BIND_PATH, GEECLAW_AUTH_API_ORIGIN);
  url.searchParams.set('inviteCode', inviteCode);

  const response = await proxyAwareFetch(url.toString(), {
    method,
    headers: buildGeeclawAuthHeaders(accessToken),
  });

  const rawText = await response.text();
  let payload: InviteBindApiResponse | null = null;
  try {
    payload = (asRecord(rawText ? JSON.parse(rawText) : {}) as InviteBindApiResponse | null) ?? null;
  } catch {
    payload = null;
  }

  return { response, payload, rawText };
}

export async function bindInviteCode(inviteCode: string, accessToken: string): Promise<boolean> {
  const trimmedInviteCode = inviteCode.trim();
  if (!trimmedInviteCode) {
    throw new Error('Invite code is required');
  }

  const trimmedAccessToken = accessToken.trim();
  if (!trimmedAccessToken) {
    throw new Error('No active session');
  }

  logger.info('[InviteBind] Binding invite code with GeeClaw auth API');

  let result = await requestInviteBind(trimmedInviteCode, trimmedAccessToken, 'POST');
  if (result.response.status === 405) {
    logger.warn('[InviteBind] POST not allowed for invite bind; retrying with GET');
    result = await requestInviteBind(trimmedInviteCode, trimmedAccessToken, 'GET');
  }

  if (!result.response.ok) {
    if (result.response.status === 401) {
      throw new Error('Invite session expired');
    }

    const message = resolveInviteBindMessage(
      result.payload,
      result.rawText.trim() || `Invite bind request failed (${result.response.status})`,
    );
    throw new Error(message);
  }

  if (result.payload?.success === false) {
    throw new Error(resolveInviteBindMessage(result.payload, 'Invite code binding failed'));
  }

  if (result.payload?.data !== true) {
    throw new Error(resolveInviteBindMessage(result.payload, 'Invalid invite code'));
  }

  return true;
}
