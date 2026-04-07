export type ApprovalDecision = 'allow-once' | 'allow-always' | 'deny';

export type ApprovalRequest = {
  id: string;
  kind: 'exec' | 'plugin';
  createdAtMs: number;
  expiresAtMs: number;
  request: {
    command: string;
    cwd?: string | null;
    host?: string | null;
    security?: string | null;
    ask?: string | null;
    agentId?: string | null;
    resolvedPath?: string | null;
    sessionKey?: string | null;
  };
  pluginTitle?: string;
  pluginDescription?: string | null;
  pluginSeverity?: string | null;
  pluginId?: string | null;
  allowedDecisions: ApprovalDecision[];
};

export type ApprovalResolved = {
  id: string;
  decision?: ApprovalDecision | null;
  resolvedBy?: string | null;
  ts?: number | null;
};

type ParsedApprovalNotification =
  | { type: 'requested'; entry: ApprovalRequest }
  | { type: 'resolved'; resolved: ApprovalResolved };

const DEFAULT_ALLOWED_DECISIONS: ApprovalDecision[] = ['allow-once', 'allow-always', 'deny'];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isApprovalDecision(value: unknown): value is ApprovalDecision {
  return value === 'allow-once' || value === 'allow-always' || value === 'deny';
}

function readRequiredString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readRequiredNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readOptionalNullableString(value: unknown): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || typeof value === 'string') {
    return value;
  }
  return undefined;
}

function readOptionalNullableNumber(value: unknown): number | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return undefined;
}

function normalizeAllowedDecisions(value: unknown): ApprovalDecision[] {
  if (!Array.isArray(value) || value.length === 0) {
    return [...DEFAULT_ALLOWED_DECISIONS];
  }

  const parsed: ApprovalDecision[] = [];
  for (const item of value) {
    if (!isApprovalDecision(item)) {
      return [...DEFAULT_ALLOWED_DECISIONS];
    }
    if (!parsed.includes(item)) {
      parsed.push(item);
    }
  }

  if (parsed.length === 0) {
    return [...DEFAULT_ALLOWED_DECISIONS];
  }
  return parsed;
}

function parseExecApprovalRequested(params: unknown): ParsedApprovalNotification | null {
  if (!isObject(params)) {
    return null;
  }
  const requestPayload = isObject(params.request) ? params.request : null;
  if (!requestPayload) {
    return null;
  }

  const id = readRequiredString(params.id);
  const createdAtMs = readRequiredNumber(params.createdAtMs);
  const expiresAtMs = readRequiredNumber(params.expiresAtMs);
  const command = readRequiredString(requestPayload.command);
  if (!id || createdAtMs === null || expiresAtMs === null || !command) {
    return null;
  }

  const request: ApprovalRequest['request'] = { command };
  const cwd = readOptionalNullableString(requestPayload.cwd);
  if (cwd !== undefined) request.cwd = cwd;
  const host = readOptionalNullableString(requestPayload.host);
  if (host !== undefined) request.host = host;
  const security = readOptionalNullableString(requestPayload.security);
  if (security !== undefined) request.security = security;
  const ask = readOptionalNullableString(requestPayload.ask);
  if (ask !== undefined) request.ask = ask;
  const agentId = readOptionalNullableString(requestPayload.agentId);
  if (agentId !== undefined) request.agentId = agentId;
  const resolvedPath = readOptionalNullableString(requestPayload.resolvedPath);
  if (resolvedPath !== undefined) request.resolvedPath = resolvedPath;
  const sessionKey = readOptionalNullableString(requestPayload.sessionKey);
  if (sessionKey !== undefined) request.sessionKey = sessionKey;

  const allowedDecisions = normalizeAllowedDecisions(requestPayload.allowedDecisions ?? params.allowedDecisions);

  return {
    type: 'requested',
    entry: {
      id,
      kind: 'exec',
      createdAtMs,
      expiresAtMs,
      request,
      allowedDecisions,
    },
  };
}

function parsePluginApprovalRequested(params: unknown): ParsedApprovalNotification | null {
  if (!isObject(params)) {
    return null;
  }
  const requestPayload = isObject(params.request) ? params.request : null;
  if (!requestPayload) {
    return null;
  }

  const id = readRequiredString(params.id);
  const createdAtMs = readRequiredNumber(params.createdAtMs);
  const expiresAtMs = readRequiredNumber(params.expiresAtMs);
  if (!id || createdAtMs === null || expiresAtMs === null) {
    return null;
  }

  const title = readOptionalNullableString(requestPayload.title);
  const request: ApprovalRequest['request'] = {
    command: typeof title === 'string' ? title : '',
  };
  const agentId = readOptionalNullableString(requestPayload.agentId);
  if (agentId !== undefined) request.agentId = agentId;
  const sessionKey = readOptionalNullableString(requestPayload.sessionKey);
  if (sessionKey !== undefined) request.sessionKey = sessionKey;

  const entry: ApprovalRequest = {
    id,
    kind: 'plugin',
    createdAtMs,
    expiresAtMs,
    request,
    allowedDecisions: normalizeAllowedDecisions(requestPayload.allowedDecisions ?? params.allowedDecisions),
  };

  if (typeof title === 'string') entry.pluginTitle = title;
  const description = readOptionalNullableString(requestPayload.description);
  if (description !== undefined) entry.pluginDescription = description;
  const severity = readOptionalNullableString(requestPayload.severity);
  if (severity !== undefined) entry.pluginSeverity = severity;
  const pluginId = readOptionalNullableString(requestPayload.pluginId);
  if (pluginId !== undefined) entry.pluginId = pluginId;

  return {
    type: 'requested',
    entry,
  };
}

function parseApprovalResolved(params: unknown): ParsedApprovalNotification | null {
  if (!isObject(params)) {
    return null;
  }
  const id = readRequiredString(params.id);
  if (!id) {
    return null;
  }

  const resolved: ApprovalResolved = { id };
  if (params.decision === null) {
    resolved.decision = null;
  } else if (isApprovalDecision(params.decision)) {
    resolved.decision = params.decision;
  }

  const resolvedBy = readOptionalNullableString(params.resolvedBy);
  if (resolvedBy !== undefined) resolved.resolvedBy = resolvedBy;
  const ts = readOptionalNullableNumber(params.ts);
  if (ts !== undefined) resolved.ts = ts;

  return {
    type: 'resolved',
    resolved,
  };
}

export function parseApprovalNotification(
  notification: { method?: string; params?: unknown } | null | undefined,
): ParsedApprovalNotification | null {
  switch (notification?.method) {
    case 'exec.approval.requested':
      return parseExecApprovalRequested(notification.params);
    case 'plugin.approval.requested':
      return parsePluginApprovalRequested(notification.params);
    case 'exec.approval.resolved':
    case 'plugin.approval.resolved':
      return parseApprovalResolved(notification.params);
    default:
      return null;
  }
}

export function pruneApprovals(queue: ApprovalRequest[], nowMs = Date.now()): ApprovalRequest[] {
  return queue.filter((entry) => entry.expiresAtMs > nowMs);
}

export function addApproval(queue: ApprovalRequest[], entry: ApprovalRequest, nowMs = Date.now()): ApprovalRequest[] {
  const next = pruneApprovals(queue, nowMs).filter((item) => item.id !== entry.id);
  if (entry.expiresAtMs <= nowMs) {
    return next;
  }
  next.push(entry);
  next.sort((left, right) => left.createdAtMs - right.createdAtMs);
  return next;
}

export function removeApproval(queue: ApprovalRequest[], id: string, nowMs = Date.now()): ApprovalRequest[] {
  return pruneApprovals(queue, nowMs).filter((entry) => entry.id !== id);
}

export function getApprovalResolveMethod(
  kind: ApprovalRequest['kind'],
): 'exec.approval.resolve' | 'plugin.approval.resolve' {
  return kind === 'exec' ? 'exec.approval.resolve' : 'plugin.approval.resolve';
}
