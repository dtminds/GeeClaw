import { hostApiFetch } from '@/lib/host-api';
import type { DesktopSessionSummary, ProposalDecisionEntry, SessionTokenInfo } from './model';
import { useGatewayStore } from '../gateway';

const DESKTOP_SESSIONS_API = '/api/desktop-sessions';

type DesktopSessionsListResponse = {
  sessions?: DesktopSessionSummary[];
};

type DesktopSessionResponse = {
  success: boolean;
  session?: DesktopSessionSummary;
  error?: string;
};

function asOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function extractSessionTokenInfo(session: Record<string, unknown>): SessionTokenInfo | null {
  const info: SessionTokenInfo = {
    inputTokens: asOptionalNumber(session.inputTokens),
    outputTokens: asOptionalNumber(session.outputTokens),
    totalTokens: asOptionalNumber(session.totalTokens),
    contextTokens: asOptionalNumber(session.contextTokens),
    totalTokensFresh: typeof session.totalTokensFresh === 'boolean' ? session.totalTokensFresh : undefined,
  };

  return Object.values(info).some((value) => value !== undefined) ? info : null;
}

export async function fetchSessionTokenInfoByKey(): Promise<Record<string, SessionTokenInfo>> {
  const gatewayData = await useGatewayStore.getState().rpc<Record<string, unknown>>('sessions.list', {});
  const rawGatewaySessions = Array.isArray(gatewayData.sessions) ? gatewayData.sessions : [];
  return Object.fromEntries(
    rawGatewaySessions.flatMap((session) => {
      const record = session as Record<string, unknown>;
      const key = typeof record.key === 'string' ? record.key : '';
      const tokenInfo = extractSessionTokenInfo(record);
      return key && tokenInfo ? [[key, tokenInfo]] : [];
    }),
  );
}

export async function fetchDesktopSessions(): Promise<DesktopSessionSummary[]> {
  const response = await hostApiFetch<DesktopSessionsListResponse>(DESKTOP_SESSIONS_API);
  return Array.isArray(response.sessions) ? response.sessions : [];
}

export async function createDesktopSessionRequest(
  title = '',
  gatewaySessionKey?: string,
): Promise<DesktopSessionSummary> {
  const response = await hostApiFetch<DesktopSessionResponse>(DESKTOP_SESSIONS_API, {
    method: 'POST',
    body: JSON.stringify({ title, gatewaySessionKey, lastMessagePreview: '' }),
  });
  if (!response.success || !response.session) {
    throw new Error(response.error || 'Failed to create desktop session');
  }
  return response.session;
}

export async function updateDesktopSessionRequest(
  id: string,
  patch: {
    title?: string;
    updatedAt?: number;
    gatewaySessionKey?: string;
    lastMessagePreview?: string;
    proposalStateEntries?: ProposalDecisionEntry[];
  },
): Promise<DesktopSessionSummary> {
  const response = await hostApiFetch<DesktopSessionResponse>(
    `${DESKTOP_SESSIONS_API}/${encodeURIComponent(id)}`,
    {
      method: 'PUT',
      body: JSON.stringify(patch),
    },
  );
  if (!response.success || !response.session) {
    throw new Error(response.error || `Failed to update desktop session: ${id}`);
  }
  return response.session;
}

export async function deleteDesktopSessionRequest(id: string): Promise<DesktopSessionSummary> {
  const response = await hostApiFetch<DesktopSessionResponse>(
    `${DESKTOP_SESSIONS_API}/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  );
  if (!response.success || !response.session) {
    throw new Error(response.error || `Failed to delete desktop session: ${id}`);
  }
  return response.session;
}
