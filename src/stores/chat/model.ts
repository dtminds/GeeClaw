/** Metadata for locally-attached files (not from Gateway) */
export interface AttachedFileMeta {
  fileName: string;
  mimeType: string;
  fileSize: number;
  preview: string | null;
  filePath?: string;
  url?: string;
  exists?: boolean;
}

/** Raw message from OpenClaw chat.history */
export interface RawMessage {
  role: 'user' | 'assistant' | 'system' | 'toolresult';
  content: unknown; // string | ContentBlock[]
  timestamp?: number;
  id?: string;
  senderLabel?: string;
  toolCallId?: string;
  toolName?: string;
  details?: unknown;
  isError?: boolean;
  api?: string;
  provider?: string;
  model?: string;
  stopReason?: string;
  stop_reason?: string;
  usage?: {
    input?: number;
    output?: number;
    total?: number;
    totalTokens?: number;
    cacheRead?: number;
    cacheWrite?: number;
    promptTokens?: number;
    completionTokens?: number;
    cost?: {
      total?: number;
    };
  };
  /** Local-only: file metadata for user-uploaded attachments (not sent to/from Gateway) */
  _attachedFiles?: AttachedFileMeta[];
  /** Local-only: number of attachments omitted from display due to per-message cap */
  _hiddenAttachmentCount?: number;
  /** Local-only: merged tool execution states for assistant tool-use turns */
  _toolStatuses?: ToolStatus[];
}

/** Content block inside a message */
export interface ContentBlock {
  type: 'text' | 'image' | 'thinking' | 'tool_use' | 'tool_result' | 'toolCall' | 'toolResult';
  text?: string;
  thinking?: string;
  source?: { type: string; media_type?: string; data?: string; url?: string };
  /** Flat image format from Gateway tool results (no source wrapper) */
  data?: string;
  mimeType?: string;
  id?: string;
  name?: string;
  input?: unknown;
  arguments?: unknown;
  content?: unknown;
  status?: string;
  error?: string;
  isError?: boolean;
  is_error?: boolean;
}

export interface DesktopSessionSummary {
  id: string;
  gatewaySessionKey: string;
  title: string;
  lastMessagePreview: string;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
}

/** Session from sessions.list, used by the raw Gateway viewer. */
export interface GatewaySessionSummary {
  key: string;
  label?: string;
  displayName?: string;
  thinkingLevel?: string;
  model?: string;
}

export interface SessionTokenInfo {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  contextTokens?: number;
  totalTokensFresh?: boolean;
}

export interface ToolStatus {
  id?: string;
  toolCallId?: string;
  name: string;
  status: 'running' | 'completed' | 'error';
  durationMs?: number;
  result?: string;
  summary?: string;
  updatedAt: number;
  input?: unknown;
}

export interface ToolStreamEntry {
  toolCallId: string;
  runId: string;
  sessionKey?: string;
  name: string;
  args?: unknown;
  output?: string;
  status: ToolStatus['status'];
  durationMs?: number;
  startedAt: number;
  updatedAt: number;
  message: RawMessage;
}
