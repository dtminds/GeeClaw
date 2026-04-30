# Chat Tool Group Collapsing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify live, final, and history assistant-turn rendering so tool-heavy turns collapse older or finished tool runs into semantic summary groups without changing structure at finalization time

**Architecture:** Introduce a shared assistant-turn display model in the chat UI layer, normalize live and finalized assistant content into that model, and render grouped tool runs through a dedicated `ToolGroupCard`. Replace flat live `streamSegments` and `toolMessages` injection with one normalized live assistant turn so live, final, and history all share the same rendering path.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, Zustand chat store

---

## File Map

- Modify: `src/pages/Chat/build-chat-items.ts`
  Purpose: stop flattening live stream segments and tool messages into independent chat rows; emit a single live assistant row that can carry normalized turn display data
- Modify: `src/pages/Chat/ChatMessage.tsx`
  Purpose: render normalized assistant turn parts, add grouped tool summary UI, and keep `ToolCard` as the expanded leaf renderer
- Modify: `src/pages/Chat/assistant-display.ts`
  Purpose: own the shared assistant-turn normalization, tool grouping, collapse-state resolution, and summary heuristics
- Modify: `src/pages/Chat/index.tsx`
  Purpose: pass any new normalized/live metadata through `buildChatItems` unchanged and keep list behavior stable
- Modify: `tests/unit/chat-build-chat-items.test.ts`
  Purpose: verify top-level chat item shaping changes from multiple live rows to one live assistant row
- Modify: `tests/unit/chat-live-rendering.test.tsx`
  Purpose: verify streaming behavior and rendered grouping transitions in the UI layer
- Modify: `tests/unit/chat-tool-result-history-fallback.test.ts`
  Purpose: verify final/history ordering remains stable and collapsed after turn completion
- Create if needed: `tests/unit/assistant-display-tool-groups.test.ts`
  Purpose: isolate normalization, collapse rules, and semantic summary logic from the larger chat store tests

### Shared Types To Introduce

Add or extend types in `src/pages/Chat/assistant-display.ts`:

```ts
export type AssistantToolGroupItem = {
  id: string;
  name: string;
  input: unknown;
  status: 'running' | 'completed' | 'error';
  durationMs?: number;
  result?: string;
  timestamp?: number;
};

export type AssistantToolGroupSummaryPart = {
  category: 'read_files' | 'edit_files' | 'execute_commands' | 'web_access' | 'generic_tools';
  count: number;
  label: string;
};

export type AssistantDisplayPart =
  | { type: 'text'; text: string }
  | { type: 'thinking'; content: string }
  | { type: 'tool_group'; items: AssistantToolGroupItem[]; summary: string; summaryParts: AssistantToolGroupSummaryPart[]; collapsed: boolean };

export type AssistantDisplayModel = {
  parts: AssistantDisplayPart[];
  visibleText: string;
  markdownImages: AssistantMarkdownImage[];
};
```

Keep image extraction and file attachment handling where they are today unless a task below explicitly moves them.

### Test Commands Used In This Plan

- `pnpm test tests/unit/assistant-display-tool-groups.test.ts`
- `pnpm test tests/unit/chat-build-chat-items.test.ts`
- `pnpm test tests/unit/chat-live-rendering.test.tsx`
- `pnpm test tests/unit/chat-tool-result-history-fallback.test.ts`
- `pnpm run typecheck`

### Commit Cadence

Use frequent commits after each finished task:

- `test: add assistant tool group normalization coverage`
- `refactor: normalize assistant turn display model`
- `refactor: unify live chat turn rendering`
- `feat: collapse completed tool groups in chat messages`

### Task 1: Lock Down Normalization Expectations

**Files:**
- Create: `tests/unit/assistant-display-tool-groups.test.ts`
- Modify: `src/pages/Chat/assistant-display.ts`

- [ ] **Step 1: Write failing normalization tests for collapse rules and summary text**

```ts
import { describe, expect, it } from 'vitest';
import { buildAssistantDisplayModel } from '@/pages/Chat/assistant-display';
import type { RawMessage } from '@/stores/chat';

describe('buildAssistantDisplayModel', () => {
  it('collapses a tool group once later assistant text appears during streaming', () => {
    const message = {
      role: 'assistant',
      content: [
        { type: 'text', text: '好的，接下来我先查天气' },
        { type: 'toolCall', id: 'tool-1', name: 'read', arguments: { filePath: 'a.ts' } },
        { type: 'toolResult', id: 'tool-1', name: 'read', text: '...' },
        { type: 'text', text: '我再继续看实时结果' },
      ],
    } as RawMessage;

    const display = buildAssistantDisplayModel(message, {
      showThinking: false,
      showToolCalls: true,
      isStreaming: true,
      liveToolStatuses: [],
      liveToolMessages: [],
      liveStreamSegments: [],
    });

    expect(display.parts).toEqual([
      { type: 'text', text: '好的，接下来我先查天气' },
      expect.objectContaining({ type: 'tool_group', collapsed: true, summary: '读取 1 个文件' }),
      { type: 'text', text: '我再继续看实时结果' },
    ]);
  });

  it('keeps the tail tool group expanded while it is still active', () => {
    const display = buildAssistantDisplayModel(null, {
      showThinking: false,
      showToolCalls: true,
      isStreaming: true,
      liveToolStatuses: [],
      liveToolMessages: [
        {
          role: 'assistant',
          id: 'tool-1',
          toolCallId: 'tool-1',
          content: [{ type: 'toolCall', id: 'tool-1', name: 'exec', arguments: { command: 'pwd' } }],
          timestamp: 1,
        } as RawMessage,
      ],
      liveStreamSegments: [{ text: '我先执行命令', ts: 0 }],
    });

    expect(display.parts.at(-1)).toEqual(expect.objectContaining({
      type: 'tool_group',
      collapsed: false,
      summary: '执行 1 条命令',
    }));
  });

  it('collapses all tool groups when the turn is no longer streaming', () => {
    const display = buildAssistantDisplayModel(null, {
      showThinking: false,
      showToolCalls: true,
      isStreaming: false,
      liveToolStatuses: [],
      liveToolMessages: [
        {
          role: 'assistant',
          id: 'tool-1',
          toolCallId: 'tool-1',
          content: [{ type: 'toolCall', id: 'tool-1', name: 'exec', arguments: { command: 'pwd' } }],
          timestamp: 1,
        } as RawMessage,
      ],
      liveStreamSegments: [{ text: '我先执行命令', ts: 0 }],
    });

    expect(display.parts).toEqual([
      { type: 'text', text: '我先执行命令' },
      expect.objectContaining({
        type: 'tool_group',
        collapsed: true,
        summary: '执行 1 条命令',
      }),
    ]);
  });
});
```

- [ ] **Step 2: Run the new test file and confirm it fails for missing API and behavior**

Run: `pnpm test tests/unit/assistant-display-tool-groups.test.ts`
Expected: FAIL with missing `buildAssistantDisplayModel` export or mismatched `parts` shape

- [ ] **Step 3: Add the shared display model builder and minimal grouping helpers**

```ts
type BuildAssistantDisplayModelOptions = {
  showThinking: boolean;
  showToolCalls: boolean;
  isStreaming: boolean;
  liveToolStatuses: ToolDisplayStatus[];
  liveToolMessages: RawMessage[];
  liveStreamSegments: Array<{ text: string; ts: number }>;
};

export function buildAssistantDisplayModel(
  message: RawMessage | null,
  options: BuildAssistantDisplayModelOptions,
): AssistantDisplayModel {
  const orderedParts = buildOrderedAssistantDisplayParts(message, options);
  const groupedParts = groupConsecutiveToolParts(orderedParts);
  const collapsedParts = resolveToolGroupCollapseState(groupedParts, options.isStreaming);
  return {
    parts: collapsedParts,
    visibleText: collapsedParts
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('\n\n')
      .trim(),
    markdownImages: extractAssistantDisplaySegments(message ?? { role: 'assistant', content: '' } as RawMessage, {
      showThinking: options.showThinking,
    }).markdownImages,
  };
}

function buildOrderedAssistantDisplayParts(
  message: RawMessage | null,
  options: BuildAssistantDisplayModelOptions,
): Array<AssistantDisplayPart | AssistantToolGroupItem> {
  const finalizedParts = extractFinalizedAssistantDisplayParts(message, options.showThinking, options.showToolCalls);
  const runtimeParts = buildRuntimeAssistantDisplayParts(options.liveStreamSegments, options.liveToolMessages);
  return [...finalizedParts, ...runtimeParts].sort(compareAssistantDisplayPartOrder);
}

function extractFinalizedAssistantDisplayParts(
  message: RawMessage | null,
  showThinking: boolean,
  showToolCalls: boolean,
): Array<AssistantDisplayPart | AssistantToolGroupItem> {
  const display = message
    ? extractAssistantDisplaySegments(message, { showThinking })
    : { parts: [], visibleText: '', markdownImages: [] };
  const toolStatuses = message?._toolStatuses || [];
  return buildAssistantPartsFromMessageContent(message, display.parts, toolStatuses, showToolCalls);
}

function buildRuntimeAssistantDisplayParts(
  liveStreamSegments: Array<{ text: string; ts: number }>,
  liveToolMessages: RawMessage[],
): Array<AssistantDisplayPart | AssistantToolGroupItem> {
  return [
    ...liveStreamSegments
      .filter((segment) => segment.text.trim().length > 0)
      .map((segment) => ({ type: 'text', text: segment.text, _sortTs: segment.ts }) as AssistantDisplayPart & { _sortTs: number }),
    ...liveToolMessages
      .map((message) => toAssistantToolGroupItem(message))
      .filter(Boolean) as AssistantToolGroupItem[],
  ];
}

function buildAssistantPartsFromMessageContent(
  message: RawMessage | null,
  assistantTextParts: Array<{ type: 'text' | 'thinking'; text: string; blockIndex: number }>,
  toolStatuses: ToolDisplayStatus[],
  showToolCalls: boolean,
): Array<AssistantDisplayPart | AssistantToolGroupItem> {
  const parts: Array<AssistantDisplayPart | AssistantToolGroupItem> = [];
  const content = Array.isArray(message?.content) ? message.content : [];
  const textPartsByBlock = assistantTextParts.reduce<Map<number, Array<{ type: 'text' | 'thinking'; text: string }>>>((map, part) => {
    const group = map.get(part.blockIndex) || [];
    group.push({ type: part.type, text: part.text });
    map.set(part.blockIndex, group);
    return map;
  }, new Map());

  for (let blockIndex = 0; blockIndex < content.length; blockIndex += 1) {
    for (const part of textPartsByBlock.get(blockIndex) || []) {
      parts.push(part.type === 'thinking'
        ? { type: 'thinking', content: part.text }
        : { type: 'text', text: part.text });
    }

    const block = content[blockIndex];
    if ((block.type === 'tool_use' || block.type === 'toolCall') && block.name && showToolCalls) {
      const toolStatus = toolStatuses.find((status) => status.toolCallId === block.id || status.name === block.name);
      parts.push({
        id: block.id || block.name,
        name: block.name,
        input: block.input ?? block.arguments,
        status: toolStatus?.status || 'running',
        durationMs: toolStatus?.durationMs,
        result: toolStatus?.result,
      });
    }
  }

  return parts;
}

function toAssistantToolGroupItem(message: RawMessage): AssistantToolGroupItem | null {
  const tool = extractToolUse(message)[0];
  if (!tool || shouldHideToolTrace(tool.name)) {
    return null;
  }
  const status = message._toolStatuses?.[0];
  return {
    id: tool.id || message.toolCallId || tool.name,
    name: tool.name,
    input: tool.input,
    status: status?.status || 'running',
    durationMs: status?.durationMs,
    result: status?.result,
    timestamp: typeof message.timestamp === 'number' ? message.timestamp : undefined,
  };
}

function compareAssistantDisplayPartOrder(
  left: AssistantDisplayPart | AssistantToolGroupItem,
  right: AssistantDisplayPart | AssistantToolGroupItem,
): number {
  return getAssistantDisplayPartTimestamp(left) - getAssistantDisplayPartTimestamp(right);
}

function getAssistantDisplayPartTimestamp(
  part: AssistantDisplayPart | AssistantToolGroupItem,
): number {
  if ('timestamp' in part && typeof part.timestamp === 'number') {
    return part.timestamp;
  }
  if ('_sortTs' in part && typeof part._sortTs === 'number') {
    return part._sortTs;
  }
  return Number.POSITIVE_INFINITY;
}

function isAssistantToolGroupItem(
  part: AssistantDisplayPart | AssistantToolGroupItem,
): part is AssistantToolGroupItem {
  return 'name' in part && 'status' in part && !('summary' in part);
}

function groupConsecutiveToolParts(
  parts: Array<AssistantDisplayPart | AssistantToolGroupItem>,
): AssistantDisplayPart[] {
  const grouped: AssistantDisplayPart[] = [];
  let toolBuffer: AssistantToolGroupItem[] = [];

  const flushToolBuffer = () => {
    if (toolBuffer.length === 0) return;
    const summary = summarizeToolGroup(toolBuffer);
    grouped.push({
      type: 'tool_group',
      items: toolBuffer,
      summary: summary.summary,
      summaryParts: summary.summaryParts,
      collapsed: false,
    });
    toolBuffer = [];
  };

  for (const part of parts) {
    if (isAssistantToolGroupItem(part)) {
      toolBuffer.push(part);
      continue;
    }
    flushToolBuffer();
    grouped.push(part);
  }

  flushToolBuffer();
  return grouped;
}

function resolveToolGroupCollapseState(
  parts: AssistantDisplayPart[],
  isStreaming: boolean,
): AssistantDisplayPart[] {
  return parts.map((part, index) => {
    if (part.type !== 'tool_group') {
      return part;
    }
    const hasLaterAssistantTextPart = parts.slice(index + 1).some(
      (candidate) => candidate.type === 'text' && candidate.text.trim().length > 0,
    );
    return {
      ...part,
      collapsed: !isStreaming || hasLaterAssistantTextPart,
    };
  });
}
```

- [ ] **Step 4: Add semantic summary heuristics with the four agreed categories**

```ts
function summarizeToolGroup(items: AssistantToolGroupItem[]): {
  summary: string;
  summaryParts: AssistantToolGroupSummaryPart[];
} {
  const buckets = [
    summarizeEditFiles(items),
    summarizeExecuteCommands(items),
    summarizeReadFiles(items),
    summarizeWebAccess(items),
    summarizeGenericTools(items),
  ].filter(Boolean) as AssistantToolGroupSummaryPart[];

  const visible = buckets.slice(0, 3);
  const tail = buckets.length > 3 ? `，等 ${buckets.length} 类操作` : '';
  return {
    summaryParts: buckets,
    summary: `${visible.map((part) => part.label).join('，')}${tail}`,
  };
}
```

- [ ] **Step 5: Re-run the focused normalization tests**

Run: `pnpm test tests/unit/assistant-display-tool-groups.test.ts`
Expected: PASS

- [ ] **Step 6: Commit Task 1**

```bash
git add tests/unit/assistant-display-tool-groups.test.ts src/pages/Chat/assistant-display.ts
git commit -m "test: add assistant tool group normalization coverage"
```

### Task 2: Replace Flat Live Row Injection With One Live Assistant Turn

**Files:**
- Modify: `src/pages/Chat/build-chat-items.ts`
- Modify: `tests/unit/chat-build-chat-items.test.ts`
- Read for context: `src/pages/Chat/index.tsx`

- [ ] **Step 1: Rewrite build-chat-items tests to assert one live assistant item instead of many**

```ts
it('emits a single live assistant row for interleaved stream segments and tool messages', () => {
  const items = buildChatItems({
    messages: [assistantMessage('history-1', 'history', 1)],
    toolMessages: [
      {
        role: 'assistant',
        id: 'tool-1',
        toolCallId: 'tool-1',
        content: [{ type: 'toolCall', id: 'tool-1', name: 'bash', arguments: { command: 'pwd' } }],
        timestamp: 3,
      } as RawMessage,
    ],
    streamSegments: [{ text: '现在我为你查询', ts: 2 }],
    streamingText: 'final-live',
    streamingTextStartedAt: 6,
    sessionKey: 'agent:main:main',
  });

  expect(items).toHaveLength(2);
  expect(items[0]?.message.id).toBe('history-1');
  expect(items[1]?.isStreaming).toBe(true);
  expect(items[1]?.message.id).toBe('stream:agent:main:main:6');
  expect(items[1]?.message.role).toBe('assistant');
});
```

- [ ] **Step 2: Run the focused build-chat-items tests and confirm the old flattening logic fails**

Run: `pnpm test tests/unit/chat-build-chat-items.test.ts`
Expected: FAIL because current output still contains separate `stream-seg:*` and tool rows

- [ ] **Step 3: Simplify build-chat-items so live content is one assistant item**

```ts
export function buildChatItems({
  messages,
  toolMessages,
  streamSegments,
  streamingText,
  streamingTextStartedAt,
  sessionKey,
}: BuildChatItemsOptions): ChatRenderItem[] {
  const items = buildHistoryItems(messages);

  const hasLiveRuntimeContent =
    toolMessages.length > 0
    || streamSegments.some((segment) => segment.text.trim())
    || streamingText.trim().length > 0;

  if (hasLiveRuntimeContent) {
    const timestamp = streamingTextStartedAt ?? latestRuntimeTimestamp(toolMessages, streamSegments) ?? Date.now() / 1000;
    items.push({
      key: `stream:${sessionKey}:${timestamp}`,
      isStreaming: true,
      message: {
        role: 'assistant',
        id: `stream:${sessionKey}:${timestamp}`,
        content: streamingText,
        timestamp,
      },
    });
  }

  return items;
}
```

- [ ] **Step 4: Re-run build-chat-items coverage**

Run: `pnpm test tests/unit/chat-build-chat-items.test.ts`
Expected: PASS

- [ ] **Step 5: Commit Task 2**

```bash
git add src/pages/Chat/build-chat-items.ts tests/unit/chat-build-chat-items.test.ts
git commit -m "refactor: unify live chat turn rendering"
```

### Task 3: Make ChatMessage Render Normalized Tool Groups

**Files:**
- Modify: `src/pages/Chat/ChatMessage.tsx`
- Modify: `tests/unit/chat-live-rendering.test.tsx`
- Read for context: `src/pages/Chat/assistant-display.ts`

- [ ] **Step 1: Add rendering tests for collapsed and expanded tool groups**

```tsx
  it('renders a collapsed tool summary when the group is closed', () => {
  render(
    <ChatMessage
      message={{
        role: 'assistant',
        id: 'assistant-1',
        content: 'ignored',
        _assistantDisplayOverride: {
          parts: [
            { type: 'text', text: '先查天气' },
            {
              type: 'tool_group',
              collapsed: true,
              summary: '已编辑 3 个文件，执行 2 条命令',
              summaryParts: [],
              items: [],
            },
          ],
          visibleText: '先查天气',
          markdownImages: [],
        },
      } as RawMessage}
      showThinking={false}
      showToolCalls
      isStreaming={false}
    />,
  );

  expect(screen.getByText('已编辑 3 个文件，执行 2 条命令')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the chat live rendering tests and confirm failure**

Run: `pnpm test tests/unit/chat-live-rendering.test.tsx`
Expected: FAIL because `tool_group` parts are not rendered yet

- [ ] **Step 3: Replace the assistant part builder usage with the shared display model**

```ts
const assistantDisplay = useMemo(
  () => (!isUser
    ? buildAssistantDisplayModel(message, {
      showThinking,
      showToolCalls,
      isStreaming,
      liveToolStatuses: effectiveToolStatuses,
      liveToolMessages: [],
      liveStreamSegments: [],
    })
    : null),
  [effectiveToolStatuses, isStreaming, isUser, message, showThinking, showToolCalls],
);

const assistantRenderableParts = assistantDisplay?.parts ?? EMPTY_ASSISTANT_CONTENT_PARTS;
```

- [ ] **Step 4: Add `ToolGroupCard` and keep `ToolCard` as the expanded row renderer**

```tsx
function ToolGroupCard({
  summary,
  collapsed,
  items,
  timestamp,
}: {
  summary: string;
  collapsed: boolean;
  items: AssistantToolGroupItem[];
  timestamp?: number;
}) {
  const [open, setOpen] = useState(!collapsed);

  useEffect(() => {
    setOpen(!collapsed);
  }, [collapsed]);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="w-full rounded-2xl border px-4 py-3 text-left">
        {summary}
      </button>
    );
  }

  return (
    <div className="space-y-2">
      {collapsed && (
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-muted-foreground">
          {summary}
        </button>
      )}
      {items.map((item) => (
        <ToolCard
          key={item.id}
          name={item.name}
          input={item.input}
          status={item.status}
          durationMs={item.durationMs}
          result={item.result}
          timestamp={timestamp}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Update assistant-part rendering switch to include `tool_group`**

```tsx
if (part.type === 'tool_group') {
  return (
    <ToolGroupCard
      key={`tool-group-${index}`}
      summary={part.summary}
      collapsed={part.collapsed}
      items={part.items}
      timestamp={message.timestamp}
    />
  );
}
```

- [ ] **Step 6: Re-run UI rendering coverage**

Run: `pnpm test tests/unit/chat-live-rendering.test.tsx`
Expected: PASS

- [ ] **Step 7: Commit Task 3**

```bash
git add src/pages/Chat/ChatMessage.tsx tests/unit/chat-live-rendering.test.tsx src/pages/Chat/assistant-display.ts
git commit -m "feat: collapse completed tool groups in chat messages"
```

### Task 4: Wire Live Runtime Data Into The Shared Display Model

**Files:**
- Modify: `src/pages/Chat/ChatMessage.tsx`
- Modify: `src/pages/Chat/index.tsx`
- Modify: `src/pages/Chat/assistant-display.ts`
- Modify: `tests/unit/chat-live-rendering.test.tsx`

- [ ] **Step 1: Add a live runtime assistant-message contract for the shared builder**

```ts
type LiveAssistantMessage = RawMessage & {
  _liveStreamSegments?: Array<{ text: string; ts: number }>;
  _liveToolMessages?: RawMessage[];
};
```

- [ ] **Step 2: Populate the live message created in build-chat-items with runtime payload**

```ts
message: {
  role: 'assistant',
  id: `stream:${sessionKey}:${timestamp}`,
  content: streamingText,
  timestamp,
  _liveStreamSegments: streamSegments,
  _liveToolMessages: toolMessages,
}
```

- [ ] **Step 3: Feed `_live*` payload through the shared display builder in ChatMessage**

```ts
const assistantDisplay = useMemo(
  () => (!isUser
    ? buildAssistantDisplayModel(message, {
      showThinking,
      showToolCalls,
      isStreaming,
      liveToolStatuses: effectiveToolStatuses,
      liveToolMessages: message._liveToolMessages || [],
      liveStreamSegments: message._liveStreamSegments || [],
    })
    : null),
  [effectiveToolStatuses, isStreaming, isUser, message, showThinking, showToolCalls],
);
```

- [ ] **Step 4: Add integration tests for "earlier group collapsed, tail group expanded"**

```tsx
it('collapses an older tool group after later assistant text appears while keeping the active tail group open', () => {
  render(
    <ChatMessage
      message={{
        role: 'assistant',
        id: 'stream:agent:main:main:9',
        content: '尾部还在继续',
        timestamp: 9,
        _liveStreamSegments: [
          { text: '先查天气', ts: 1 },
          { text: '接着看实时数据', ts: 4 },
        ],
        _liveToolMessages: [
          {
            role: 'assistant',
            id: 'tool-1',
            toolCallId: 'tool-1',
            content: [{ type: 'toolCall', id: 'tool-1', name: 'read', arguments: { filePath: '/tmp/a.ts' } }],
            timestamp: 2,
          },
          {
            role: 'assistant',
            id: 'tool-2',
            toolCallId: 'tool-2',
            content: [{ type: 'toolCall', id: 'tool-2', name: 'exec', arguments: { command: 'pwd' } }],
            timestamp: 8,
          },
        ],
      } as RawMessage}
      showThinking={false}
      showToolCalls
      isStreaming
    />,
  );

  expect(screen.getByText('读取 1 个文件')).toBeInTheDocument();
  expect(screen.getByText('exec')).toBeInTheDocument();
});
```

- [ ] **Step 5: Run live rendering coverage again**

Run: `pnpm test tests/unit/chat-live-rendering.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit Task 4**

```bash
git add src/pages/Chat/build-chat-items.ts src/pages/Chat/ChatMessage.tsx src/pages/Chat/assistant-display.ts tests/unit/chat-live-rendering.test.tsx
git commit -m "refactor: normalize live assistant tool grouping"
```

### Task 5: Lock Final And History Consistency

**Files:**
- Modify: `tests/unit/chat-tool-result-history-fallback.test.ts`
- Modify: `src/pages/Chat/assistant-display.ts`
- Modify: `src/pages/Chat/ChatMessage.tsx`

- [ ] **Step 1: Add a regression test that finished and reloaded turns render the same collapsed structure**

```ts
it('renders the same collapsed tool summary after finalization and after history reload', () => {
  const finalMessage = {
    role: 'assistant',
    id: 'assistant-final',
    content: [
      { type: 'text', text: '我先检查文件' },
      { type: 'toolCall', id: 'tool-1', name: 'read', arguments: { filePath: '/tmp/a.ts' } },
      { type: 'toolResult', id: 'tool-1', name: 'read', text: '...' },
      { type: 'text', text: '已经找到问题了' },
    ],
  } as RawMessage;

  const finalDisplay = buildAssistantDisplayModel(finalMessage, {
    showThinking: false,
    showToolCalls: true,
    isStreaming: false,
    liveToolStatuses: [],
    liveToolMessages: [],
    liveStreamSegments: [],
  });

  const reloadedDisplay = buildAssistantDisplayModel({ ...finalMessage }, {
    showThinking: false,
    showToolCalls: true,
    isStreaming: false,
    liveToolStatuses: [],
    liveToolMessages: [],
    liveStreamSegments: [],
  });

  expect(finalDisplay.parts).toEqual(reloadedDisplay.parts);
  expect(finalDisplay.parts).toContainEqual(expect.objectContaining({
    type: 'tool_group',
    collapsed: true,
    summary: '读取 1 个文件',
  }));
});
```

- [ ] **Step 2: Add a regression test for semantic summary aggregation**

```ts
it('summarizes mixed tool groups as edits plus commands before generic tools', () => {
  const display = buildAssistantDisplayModel(finalMessage, {
    showThinking: false,
    showToolCalls: true,
    isStreaming: false,
    liveToolStatuses: [],
    liveToolMessages: [],
    liveStreamSegments: [],
  });

  expect(display.parts).toContainEqual(expect.objectContaining({
    type: 'tool_group',
    collapsed: true,
    summary: '已编辑 3 个文件，执行 2 条命令',
  }));
});
```

- [ ] **Step 3: Run the final/history regression suite**

Run: `pnpm test tests/unit/chat-tool-result-history-fallback.test.ts`
Expected: PASS

- [ ] **Step 4: Run the full targeted verification set**

Run: `pnpm test tests/unit/assistant-display-tool-groups.test.ts tests/unit/chat-build-chat-items.test.ts tests/unit/chat-live-rendering.test.tsx tests/unit/chat-tool-result-history-fallback.test.ts`
Expected: PASS

Run: `pnpm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit Task 5**

```bash
git add tests/unit/assistant-display-tool-groups.test.ts tests/unit/chat-build-chat-items.test.ts tests/unit/chat-live-rendering.test.tsx tests/unit/chat-tool-result-history-fallback.test.ts src/pages/Chat/assistant-display.ts src/pages/Chat/build-chat-items.ts src/pages/Chat/ChatMessage.tsx src/pages/Chat/index.tsx
git commit -m "feat: align chat tool grouping across live and history"
```

## Self-Review

### Spec Coverage

- Unified live/final/history model: Tasks 1, 2, 4, 5
- Collapse after later assistant text appears: Tasks 1 and 4
- Finished turns always collapse: Tasks 1 and 5
- Semantic summaries for grouped tools: Tasks 1 and 5
- Stable final/history rendering: Tasks 2 and 5

No spec gaps remain.

### Placeholder Scan

- No `TODO` or `TBD` markers remain
- Every task names exact files and exact verification commands
- Code-changing steps include concrete code snippets or target shapes

### Type Consistency

- Shared UI model uses `AssistantDisplayPart` and `AssistantToolGroupItem`
- `tool_group` is referenced consistently across Tasks 1 through 5
- Live payload contract uses `_liveStreamSegments` and `_liveToolMessages` consistently
