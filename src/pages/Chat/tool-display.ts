type ToolDisplayActionSpec = {
  label?: string;
  detailKeys?: string[];
};

type ToolDisplaySpec = {
  emoji?: string;
  title?: string;
  label?: string;
  detailKeys?: string[];
  actions?: Record<string, ToolDisplayActionSpec>;
};

export type ToolDisplaySummary = {
  name: string;
  emoji: string;
  title: string;
  label: string;
  verb?: string;
  detail?: string;
  detailLine?: string;
  summaryLine: string;
};

const FALLBACK_SPEC: ToolDisplaySpec = {
  emoji: '🧩',
  detailKeys: [
    'command',
    'path',
    'url',
    'targetUrl',
    'targetId',
    'ref',
    'element',
    'node',
    'nodeId',
    'id',
    'requestId',
    'to',
    'channelId',
    'guildId',
    'userId',
    'name',
    'query',
    'pattern',
    'messageId',
  ],
};

const TOOL_DISPLAY_SPECS: Record<string, ToolDisplaySpec> = {
  bash: {
    emoji: '🛠️',
    title: 'Bash',
    detailKeys: ['command'],
  },
  exec: {
    emoji: '🛠️',
    title: 'Exec',
    detailKeys: ['command'],
  },
  read: {
    emoji: '📖',
    title: 'Read',
    detailKeys: ['path'],
  },
  write: {
    emoji: '✍️',
    title: 'Write',
    detailKeys: ['path'],
  },
  edit: {
    emoji: '📝',
    title: 'Edit',
    detailKeys: ['path'],
  },
  attach: {
    emoji: '📎',
    title: 'Attach',
    detailKeys: ['path', 'url', 'fileName'],
  },
  browser: {
    emoji: '🌐',
    title: 'Browser',
    actions: {
      status: { label: 'status' },
      start: { label: 'start' },
      stop: { label: 'stop' },
      tabs: { label: 'tabs' },
      open: { label: 'open', detailKeys: ['targetUrl'] },
      focus: { label: 'focus', detailKeys: ['targetId'] },
      close: { label: 'close', detailKeys: ['targetId'] },
      snapshot: { label: 'snapshot', detailKeys: ['targetUrl', 'targetId', 'ref', 'element', 'format'] },
      screenshot: { label: 'screenshot', detailKeys: ['targetUrl', 'targetId', 'ref', 'element'] },
      navigate: { label: 'navigate', detailKeys: ['targetUrl', 'targetId'] },
      console: { label: 'console', detailKeys: ['level', 'targetId'] },
      pdf: { label: 'pdf', detailKeys: ['targetId'] },
      upload: { label: 'upload', detailKeys: ['paths', 'ref', 'inputRef', 'element', 'targetId'] },
      dialog: { label: 'dialog', detailKeys: ['accept', 'promptText', 'targetId'] },
      act: { label: 'act', detailKeys: ['request.kind', 'request.ref', 'request.selector', 'request.text', 'request.value'] },
    },
  },
  process: {
    title: 'Process',
    actions: {
      poll: { label: '查看进程状态' },
      log: { label: '查看进程日志' },
    },
  },
  sessions_spawn: {
    title: 'Sessions Spawn',
    detailKeys: ['task'],
    actions: {
      spawn: { label: '启动子任务', detailKeys: ['task'] },
    },
  },
  sessions_yield: {
    title: 'Sessions Yield',
    actions: {
      yield: { label: '等待子任务结果' },
    },
  },
};

function titleFromName(name: string): string {
  const cleaned = name.replace(/_/g, ' ').trim();
  if (!cleaned) {
    return 'Tool';
  }

  return cleaned
    .split(/\s+/)
    .map((part) => {
      if (part.length <= 2 && part === part.toUpperCase()) {
        return part;
      }
      return part.slice(0, 1).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join(' ');
}

function normalizeVerb(value: string | undefined): string | undefined {
  const trimmed = value?.trim() || '';
  return trimmed ? trimmed.replace(/_/g, ' ') : undefined;
}

function getValueByKeyPath(input: unknown, path: string): unknown {
  if (!input || typeof input !== 'object') {
    return undefined;
  }

  let current: unknown = input;
  for (const key of path.split('.')) {
    if (!current || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function truncate(text: string, maxLength: number, suffix = '…'): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - suffix.length))}${suffix}`;
}

function renderValue(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const firstLine = trimmed.split(/\r?\n/, 1)[0] || trimmed;
    return truncate(firstLine, 160);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    const items = value.map(renderValue).filter((item): item is string => Boolean(item));
    if (items.length === 0) return undefined;
    const preview = items.slice(0, 3).join(', ');
    return items.length > 3 ? `${preview}…` : preview;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return renderValue(record.name) || renderValue(record.id);
  }
  return undefined;
}

function readDetail(input: unknown): string | undefined {
  const path = getValueByKeyPath(input, 'path');
  if (typeof path !== 'string' || !path.trim()) {
    return undefined;
  }
  const offset = getValueByKeyPath(input, 'offset');
  const limit = getValueByKeyPath(input, 'limit');
  const offsetNumber = typeof offset === 'number' ? offset : Number.NaN;
  const limitNumber = typeof limit === 'number' ? limit : Number.NaN;
  if (Number.isFinite(offsetNumber) && Number.isFinite(limitNumber)) {
    return `${path}:${offsetNumber}-${offsetNumber + limitNumber}`;
  }
  return path;
}

function pathDetail(input: unknown): string | undefined {
  const path = getValueByKeyPath(input, 'path');
  return typeof path === 'string' && path.trim() ? path : undefined;
}

function firstValue(input: unknown, keys: string[]): string | undefined {
  for (const key of keys) {
    const rendered = renderValue(getValueByKeyPath(input, key));
    if (rendered) {
      return rendered;
    }
  }
  return undefined;
}

export function formatToolDisplaySummary(name: string | undefined, input: unknown, meta?: string): ToolDisplaySummary {
  const trimmedName = name?.trim() || 'tool';
  const key = trimmedName.toLowerCase();
  const spec = TOOL_DISPLAY_SPECS[key];
  const emoji = spec?.emoji || FALLBACK_SPEC.emoji || '🧩';
  const title = spec?.title || titleFromName(trimmedName);
  const label = spec?.label || trimmedName;

  const actionRaw = getValueByKeyPath(input, 'action');
  const action = typeof actionRaw === 'string' ? actionRaw.trim() : '';
  const inferredAction = !action && key === 'sessions_spawn'
    ? 'spawn'
    : (!action && key === 'sessions_yield' ? 'yield' : '');
  const effectiveAction = action || inferredAction;
  const actionSpec = effectiveAction ? spec?.actions?.[effectiveAction] : undefined;
  const verb = normalizeVerb(actionSpec?.label || (effectiveAction || undefined));

  let detail: string | undefined;
  if (key === 'read') {
    detail = readDetail(input);
  } else if (key === 'write' || key === 'edit' || key === 'attach') {
    detail = pathDetail(input);
  }

  if (!detail) {
    detail = firstValue(input, actionSpec?.detailKeys || spec?.detailKeys || FALLBACK_SPEC.detailKeys || []);
  }

  if (!detail && meta?.trim()) {
    detail = meta.trim();
  }

  const detailLine = [verb, detail].filter(Boolean).join(' · ') || undefined;

  return {
    name: trimmedName,
    emoji,
    title,
    label,
    verb,
    detail,
    detailLine,
    summaryLine: detailLine ? `${emoji} ${label}: ${detailLine}` : `${emoji} ${label}`,
  };
}
