import crypto from 'node:crypto';

export interface DesktopSessionSummary {
  id: string;
  gatewaySessionKey: string;
  title: string;
  lastMessagePreview: string;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
}

type DesktopSessionsStoreShape = {
  schemaVersion: number;
  sessions: DesktopSessionSummary[];
};

const DESKTOP_SESSIONS_STORE_NAME = 'desktop-sessions';
const DESKTOP_SESSIONS_SCHEMA_VERSION = 2;
const GEECLAW_SESSION_PREFIX = 'agent:main:geeclaw-';
const GEECLAW_MAIN_SESSION_KEY = 'geeclaw_main';

function buildDefaultGatewaySessionKey(id: string): string {
  return `${GEECLAW_SESSION_PREFIX}${id}`;
}

function isMainGatewaySessionKey(sessionKey: string): boolean {
  if (!sessionKey.startsWith('agent:')) {
    return false;
  }

  const parts = sessionKey.split(':');
  return parts.length === 3 && Boolean(parts[1]) && parts[2] === GEECLAW_MAIN_SESSION_KEY;
}

function getAgentIdFromGatewaySessionKey(sessionKey: string): string | null {
  if (!sessionKey.startsWith('agent:')) {
    return null;
  }

  const parts = sessionKey.split(':');
  return parts[1] || null;
}

function shouldReplaceSession(current: DesktopSessionSummary, candidate: DesktopSessionSummary): boolean {
  return candidate.updatedAt > current.updatedAt
    || (candidate.updatedAt === current.updatedAt && candidate.createdAt > current.createdAt);
}

function normalizeSessions(sessions: DesktopSessionSummary[]): DesktopSessionSummary[] {
  const dedupedMainSessions = new Map<string, DesktopSessionSummary>();
  const otherSessions: DesktopSessionSummary[] = [];

  for (const session of sessions) {
    if (session.deletedAt) {
      continue;
    }

    const normalizedSession: DesktopSessionSummary = {
      ...session,
      lastMessagePreview: typeof session.lastMessagePreview === 'string' ? session.lastMessagePreview : '',
    };

    if (!isMainGatewaySessionKey(normalizedSession.gatewaySessionKey)) {
      otherSessions.push(normalizedSession);
      continue;
    }

    const existing = dedupedMainSessions.get(normalizedSession.gatewaySessionKey);
    if (!existing || shouldReplaceSession(existing, normalizedSession)) {
      dedupedMainSessions.set(normalizedSession.gatewaySessionKey, normalizedSession);
    }
  }

  return [...dedupedMainSessions.values(), ...otherSessions];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let desktopSessionsStore: any = null;

async function getDesktopSessionsStore() {
  if (!desktopSessionsStore) {
    const Store = (await import('electron-store')).default;
    desktopSessionsStore = new Store<DesktopSessionsStoreShape>({
      name: DESKTOP_SESSIONS_STORE_NAME,
      defaults: {
        schemaVersion: DESKTOP_SESSIONS_SCHEMA_VERSION,
        sessions: [],
      },
    });
  }

  return desktopSessionsStore;
}

async function readSessions(): Promise<DesktopSessionSummary[]> {
  const store = await getDesktopSessionsStore();
  const sessions = store.get('sessions') as DesktopSessionSummary[] | undefined;
  if (!Array.isArray(sessions)) {
    return [];
  }

  const normalizedSessions = normalizeSessions(sessions);
  const needsRewrite = normalizedSessions.length !== sessions.length
    || normalizedSessions.some((session, index) => (
      !sessions[index]
      || sessions[index].id !== session.id
      || sessions[index].lastMessagePreview !== session.lastMessagePreview
    ));

  if (needsRewrite) {
    await writeSessions(sortSessions(normalizedSessions));
  }

  return normalizedSessions;
}

async function writeSessions(sessions: DesktopSessionSummary[]): Promise<void> {
  const store = await getDesktopSessionsStore();
  store.set('schemaVersion', DESKTOP_SESSIONS_SCHEMA_VERSION);
  store.set('sessions', sessions);
}

function sortSessions(sessions: DesktopSessionSummary[]): DesktopSessionSummary[] {
  return [...sessions].sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt);
}

export async function listDesktopSessions(): Promise<DesktopSessionSummary[]> {
  return sortSessions(await readSessions());
}

export async function getDesktopSession(id: string): Promise<DesktopSessionSummary | null> {
  const sessions = await readSessions();
  return sessions.find((session) => session.id === id) ?? null;
}

export async function createDesktopSession(input?: { title?: string; gatewaySessionKey?: string; lastMessagePreview?: string }): Promise<DesktopSessionSummary> {
  const now = Date.now();
  const id = crypto.randomUUID();
  const gatewaySessionKey = input?.gatewaySessionKey?.trim() || buildDefaultGatewaySessionKey(id);
  const sessions = await readSessions();

  if (isMainGatewaySessionKey(gatewaySessionKey)) {
    const existing = sessions.find((session) => session.gatewaySessionKey === gatewaySessionKey);
    if (existing) {
      return existing;
    }
  }
  const session: DesktopSessionSummary = {
    id,
    gatewaySessionKey,
    title: input?.title?.trim() ?? '',
    lastMessagePreview: input?.lastMessagePreview?.trim() ?? '',
    createdAt: now,
    updatedAt: now,
  };
  await writeSessions(sortSessions([session, ...sessions]));
  return session;
}

export async function updateDesktopSession(
  id: string,
  patch: Partial<Pick<DesktopSessionSummary, 'title' | 'updatedAt' | 'deletedAt' | 'gatewaySessionKey' | 'lastMessagePreview'>>,
): Promise<DesktopSessionSummary | null> {
  const sessions = await readSessions();
  const index = sessions.findIndex((session) => session.id === id);
  if (index === -1) {
    return null;
  }

  const existing = sessions[index];
  const next: DesktopSessionSummary = {
    ...existing,
    ...patch,
    title: patch.title !== undefined ? patch.title.trim() : existing.title,
    gatewaySessionKey: patch.gatewaySessionKey?.trim() || existing.gatewaySessionKey,
    lastMessagePreview: patch.lastMessagePreview !== undefined ? patch.lastMessagePreview.trim() : existing.lastMessagePreview,
    updatedAt: patch.updatedAt ?? existing.updatedAt,
  };

  const nextSessions = [...sessions];
  nextSessions[index] = next;
  const normalizedNextSessions = isMainGatewaySessionKey(next.gatewaySessionKey)
    ? nextSessions.filter((session, sessionIndex) => (
      sessionIndex === index || session.gatewaySessionKey !== next.gatewaySessionKey
    ))
    : nextSessions;
  await writeSessions(sortSessions(normalizedNextSessions));
  return next;
}

export async function deleteDesktopSession(id: string): Promise<DesktopSessionSummary | null> {
  const sessions = await readSessions();
  const session = sessions.find((entry) => entry.id === id) ?? null;
  if (!session) {
    return null;
  }

  await writeSessions(sessions.filter((entry) => entry.id !== id));
  return session;
}

export async function deleteDesktopSessionsForAgent(agentId: string): Promise<DesktopSessionSummary[]> {
  const sessions = await readSessions();
  const deleted = sessions.filter((session) => getAgentIdFromGatewaySessionKey(session.gatewaySessionKey) === agentId);

  if (deleted.length === 0) {
    return [];
  }

  await writeSessions(sessions.filter((session) => getAgentIdFromGatewaySessionKey(session.gatewaySessionKey) !== agentId));
  return deleted;
}
