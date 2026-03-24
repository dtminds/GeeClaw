import type { ContentBlock, RawMessage, ToolStatus } from './model';

export function isToolOnlyMessage(message: RawMessage | undefined): boolean {
  if (!message) return false;
  if (isToolResultRole(message.role)) return true;

  const msg = message as unknown as Record<string, unknown>;
  const content = message.content;

  // Check OpenAI-format tool_calls field (real-time streaming from OpenAI-compatible models)
  const toolCalls = msg.tool_calls ?? msg.toolCalls;
  const hasOpenAITools = Array.isArray(toolCalls) && toolCalls.length > 0;

  if (!Array.isArray(content)) {
    // Content is not an array — check if there's OpenAI-format tool_calls
    if (hasOpenAITools) {
      // Has tool calls but content might be empty/string — treat as tool-only
      // if there's no meaningful text content
      const textContent = typeof content === 'string' ? content.trim() : '';
      return textContent.length === 0;
    }
    return false;
  }

  let hasTool = hasOpenAITools;
  let hasText = false;
  let hasNonToolContent = false;

  for (const block of content as ContentBlock[]) {
    if (block.type === 'tool_use' || block.type === 'tool_result' || block.type === 'toolCall' || block.type === 'toolResult') {
      hasTool = true;
      continue;
    }
    if (block.type === 'text' && block.text && block.text.trim()) {
      hasText = true;
      continue;
    }
    // Only actual image output disqualifies a tool-only message.
    // Thinking blocks are internal reasoning that can accompany tool_use — they
    // should NOT prevent the message from being treated as an intermediate tool step.
    if (block.type === 'image') {
      hasNonToolContent = true;
    }
  }

  return hasTool && !hasText && !hasNonToolContent;
}

export function isToolResultRole(role: unknown): boolean {
  if (!role) return false;
  const normalized = String(role).toLowerCase();
  return normalized === 'toolresult' || normalized === 'tool_result';
}

export function isErroredToolResult(message: RawMessage | undefined): boolean {
  if (!message || !isToolResultRole(message.role)) return false;

  if (message.isError) return true;

  const msg = message as unknown as Record<string, unknown>;
  const details = (msg.details && typeof msg.details === 'object') ? msg.details as Record<string, unknown> : undefined;
  const status = typeof (msg.status ?? details?.status) === 'string'
    ? String(msg.status ?? details?.status).toLowerCase()
    : '';
  if (status === 'error' || status === 'failed') return true;

  return typeof (msg.error ?? details?.error) === 'string' && String(msg.error ?? details?.error).trim().length > 0;
}

function extractTextFromContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content as ContentBlock[]) {
    if (block.type === 'text' && block.text) {
      parts.push(block.text);
    }
  }
  return parts.join('\n');
}

function assistantMessageHasAnyTool(message: RawMessage): boolean {
  const msg = message as unknown as Record<string, unknown>;
  const content = msg.content;

  if (Array.isArray(content)) {
    for (const block of content as ContentBlock[]) {
      if (block.type === 'tool_use' || block.type === 'toolCall') {
        return true;
      }
    }
  }

  const toolCalls = msg.tool_calls ?? msg.toolCalls;
  return Array.isArray(toolCalls) && toolCalls.length > 0;
}

function assistantMessageHasMatchingTool(message: RawMessage, update: ToolStatus): boolean {
  const msg = message as unknown as Record<string, unknown>;
  const content = msg.content;

  if (Array.isArray(content)) {
    for (const block of content as ContentBlock[]) {
      if ((block.type !== 'tool_use' && block.type !== 'toolCall') || !block.name) continue;
      if (update.toolCallId && block.id === update.toolCallId) return true;
      if (update.id && block.id === update.id) return true;
      if (block.name === update.name) return true;
    }
  }

  const toolCalls = msg.tool_calls ?? msg.toolCalls;
  if (Array.isArray(toolCalls)) {
    for (const toolCall of toolCalls as Array<Record<string, unknown>>) {
      const fn = (toolCall.function ?? toolCall) as Record<string, unknown>;
      const name = typeof fn.name === 'string' ? fn.name : '';
      const id = typeof toolCall.id === 'string' ? toolCall.id : '';
      if (update.toolCallId && id === update.toolCallId) return true;
      if (update.id && id === update.id) return true;
      if (name && name === update.name) return true;
    }
  }

  for (const status of message._toolStatuses || []) {
    if (update.toolCallId && status.toolCallId === update.toolCallId) return true;
    if (update.id && status.id === update.id) return true;
    if (status.name === update.name) return true;
  }

  return false;
}

export function findPreviousAssistantToolMessageIndex(
  messages: RawMessage[],
  beforeIndex: number,
  update: ToolStatus,
): number {
  let fallbackIndex = -1;

  for (let index = beforeIndex - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== 'assistant') continue;
    if (assistantMessageHasMatchingTool(message, update)) return index;
    if (fallbackIndex === -1 && assistantMessageHasAnyTool(message)) {
      fallbackIndex = index;
    }
  }

  return fallbackIndex;
}

function normalizeToolStatus(rawStatus: unknown, fallback: 'running' | 'completed'): ToolStatus['status'] {
  const status = typeof rawStatus === 'string' ? rawStatus.toLowerCase() : '';
  if (status === 'error' || status === 'failed') return 'error';
  if (status === 'completed' || status === 'success' || status === 'done') return 'completed';
  return fallback;
}

export function looksLikeToolErrorText(text: string | undefined): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (!trimmed) return false;
  return /^(error|failed?|exception|traceback|invalid|denied|unauthorized|forbidden|not found|错误|失败|异常|未找到|无权限|拒绝访问)\b/i.test(trimmed);
}

function getToolResultBlockStatus(block: ContentBlock, eventState: string): ToolStatus['status'] {
  if (block.isError || block.is_error) return 'error';
  if (typeof block.error === 'string' && block.error.trim()) return 'error';
  const outputText = extractTextFromContent(block.content ?? block.text ?? '');
  if (looksLikeToolErrorText(outputText)) return 'error';
  return normalizeToolStatus(block.status, eventState === 'delta' ? 'running' : 'completed');
}

export function parseDurationMs(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function extractToolUseUpdates(message: unknown): ToolStatus[] {
  if (!message || typeof message !== 'object') return [];
  const msg = message as Record<string, unknown>;
  const updates: ToolStatus[] = [];

  const content = msg.content;
  if (Array.isArray(content)) {
    for (const block of content as ContentBlock[]) {
      if ((block.type !== 'tool_use' && block.type !== 'toolCall') || !block.name) continue;
      updates.push({
        id: block.id || block.name,
        toolCallId: block.id,
        name: block.name,
        status: 'running',
        updatedAt: Date.now(),
        input: block.input ?? block.arguments,
      });
    }
  }

  if (updates.length === 0) {
    const toolCalls = msg.tool_calls ?? msg.toolCalls;
    if (Array.isArray(toolCalls)) {
      for (const toolCall of toolCalls as Array<Record<string, unknown>>) {
        const fn = (toolCall.function ?? toolCall) as Record<string, unknown>;
        const name = typeof fn.name === 'string' ? fn.name : '';
        if (!name) continue;
        const id = typeof toolCall.id === 'string' ? toolCall.id : name;
        updates.push({
          id,
          toolCallId: typeof toolCall.id === 'string' ? toolCall.id : undefined,
          name,
          status: 'running',
          updatedAt: Date.now(),
          input: fn.arguments ?? fn.input,
        });
      }
    }
  }

  return updates;
}

function extractToolResultBlocks(message: unknown, eventState: string): ToolStatus[] {
  if (!message || typeof message !== 'object') return [];
  const msg = message as Record<string, unknown>;
  const content = msg.content;
  if (!Array.isArray(content)) return [];

  const updates: ToolStatus[] = [];
  for (const block of content as ContentBlock[]) {
    if (block.type !== 'tool_result' && block.type !== 'toolResult') continue;
    const outputText = extractTextFromContent(block.content ?? block.text ?? '');
    updates.push({
      id: block.id || block.name || 'tool',
      toolCallId: block.id,
      name: block.name || block.id || 'tool',
      status: getToolResultBlockStatus(block, eventState),
      result: outputText.trim() || block.error?.trim() || undefined,
      updatedAt: Date.now(),
    });
  }

  return updates;
}

function extractToolResultUpdate(message: unknown, eventState: string): ToolStatus | null {
  if (!message || typeof message !== 'object') return null;
  const msg = message as Record<string, unknown>;
  const role = typeof msg.role === 'string' ? msg.role.toLowerCase() : '';
  if (!isToolResultRole(role)) return null;

  const toolName = typeof msg.toolName === 'string' ? msg.toolName : (typeof msg.name === 'string' ? msg.name : '');
  const toolCallId = typeof msg.toolCallId === 'string' ? msg.toolCallId : undefined;
  const details = (msg.details && typeof msg.details === 'object') ? msg.details as Record<string, unknown> : undefined;
  const rawStatus = msg.status ?? details?.status;
  const fallback = eventState === 'delta' ? 'running' : 'completed';
  const status = normalizeToolStatus(rawStatus, fallback);
  const durationMs = parseDurationMs(details?.durationMs ?? details?.duration ?? (msg as Record<string, unknown>).durationMs);

  const outputText = (details && typeof details.aggregated === 'string')
    ? details.aggregated
    : extractTextFromContent(msg.content);
  const result = outputText.trim() || String(details?.error ?? msg.error ?? '').trim() || undefined;
  const inferredStatus = looksLikeToolErrorText(result) ? 'error' : undefined;

  const name = toolName || toolCallId || 'tool';
  const id = toolCallId || name;

  return {
    id,
    toolCallId,
    name,
    status: inferredStatus ?? status,
    durationMs,
    result,
    updatedAt: Date.now(),
  };
}

export function mergeToolStatus(existing: ToolStatus['status'], incoming: ToolStatus['status']): ToolStatus['status'] {
  const order: Record<ToolStatus['status'], number> = { running: 0, completed: 1, error: 2 };
  return order[incoming] >= order[existing] ? incoming : existing;
}

export function upsertToolStatuses(current: ToolStatus[], updates: ToolStatus[]): ToolStatus[] {
  if (updates.length === 0) return current;
  const next = [...current];
  for (const update of updates) {
    const key = update.toolCallId || update.id || update.name;
    if (!key) continue;
    const index = next.findIndex((tool) => (tool.toolCallId || tool.id || tool.name) === key);
    if (index === -1) {
      next.push(update);
      continue;
    }
    const existing = next[index];
    next[index] = {
      ...existing,
      ...update,
      name: update.name || existing.name,
      status: mergeToolStatus(existing.status, update.status),
      durationMs: update.durationMs ?? existing.durationMs,
      result: update.result ?? existing.result,
      updatedAt: update.updatedAt || existing.updatedAt,
      input: update.input ?? existing.input,
    };
  }
  return next;
}

export function collectToolUpdates(message: unknown, eventState: string): ToolStatus[] {
  const updates: ToolStatus[] = [];
  const toolResultUpdate = extractToolResultUpdate(message, eventState);
  if (toolResultUpdate) updates.push(toolResultUpdate);
  updates.push(...extractToolResultBlocks(message, eventState));
  updates.push(...extractToolUseUpdates(message));
  return updates;
}

export function hasNonToolAssistantContent(message: RawMessage | undefined): boolean {
  if (!message) return false;
  if (typeof message.content === 'string' && message.content.trim()) return true;

  const content = message.content;
  if (Array.isArray(content)) {
    for (const block of content as ContentBlock[]) {
      if (block.type === 'text' && block.text && block.text.trim()) return true;
      if (block.type === 'image') return true;
    }
  }

  const msg = message as unknown as Record<string, unknown>;
  if (typeof msg.text === 'string' && msg.text.trim()) return true;

  return false;
}
