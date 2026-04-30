# Chat Tool Group Collapsing Design

## Context

The current chat rendering pipeline treats assistant streaming, final assistant messages, and history reload as three different display paths:

- live assistant text is rendered from `streamSegments`
- live tool calls are rendered from `toolMessages`
- finalized assistant turns are rendered from normalized `message.content`

This causes three user-facing problems:

1. The structure visibly shifts when a turn transitions from live to final
2. Reloaded history does not always match the just-finished turn
3. Tool-heavy turns can become much taller than the actual final assistant answer

We want the UI to behave more like Codex Desktop:

- active tail tool activity remains observable while it is still the latest work in the turn
- once a tool run is followed by later assistant text, that earlier tool run is collapsed into a compact summary
- once the turn ends, all tool runs in that turn are collapsed
- reloading history produces the same collapsed structure as the finished turn

## Goals

- Unify live, final, and history rendering around a single assistant-turn display model
- Collapse completed tool runs into compact summaries without losing access to the full per-tool detail
- Preserve stable ordering for text, tool groups, images, files, and thinking content
- Remove the structural jump that currently happens at finalization time
- Keep the first version frontend-only without requiring runtime protocol changes

## Non-Goals

- Changing the underlying store protocol for streamed tool events
- Adding backend-generated tool summaries
- Redesigning `ToolCard` visuals beyond wrapping them in a grouped container
- Reworking unrelated assistant content sanitization logic

## User Experience Rules

### Grouping

Within one assistant turn, consecutive tool calls and tool results are grouped into a `tool_group`.

The assistant turn may therefore contain a sequence such as:

- text
- tool_group
- text
- tool_group
- text

### Expansion and Collapse

A `tool_group` is expanded only when it is the active tail of the turn and no later assistant text has appeared after it.

A `tool_group` is collapsed when either of the following is true:

- later assistant text has appeared after the group, even if the turn is still streaming
- the assistant turn is no longer streaming

This means a streaming turn can contain both:

- older collapsed tool groups
- one currently active expanded tail tool group

### History Consistency

Finished turns and reloaded history must render the same structure. History must not re-expand tool groups that were already collapsed at the end of streaming.

### Summary Text

Collapsed tool groups use a semantic summary rather than only showing a count.

First-version categories:

- read files
- edit files
- execute commands
- web access or search

Examples:

- `已编辑 3 个文件，执行 2 条命令`
- `读取 8 个文件，搜索 3 次`
- `访问 2 个网页，执行 1 条命令`

If a group spans more categories than we want to show inline, the summary keeps the top categories and appends a generic tail such as `等 4 类操作`.

## Proposed Architecture

### 1. Introduce a Turn-Level Display Model

Add a normalized assistant-turn render model that is shared by live, final, and history rendering.

Suggested shape:

```ts
type AssistantTurnPart =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_group'; items: ToolDisplayItem[]; summary: ToolGroupSummary; collapsed: boolean }
  | { type: 'image'; image: AssistantImageItem }
  | { type: 'file'; file: AttachedFileMeta };

type AssistantTurnDisplayModel = {
  parts: AssistantTurnPart[];
  visibleText: string;
};
```

This model is a UI-layer normalization only. The store still owns raw messages, live text segments, and live tool messages.

### 2. Normalize Turn Content Before Rendering

Create one normalization entrypoint that merges:

- finalized assistant `message.content`
- live `streamSegments`
- live `toolMessages`
- finalized or attached media and file data

The result is a single ordered `AssistantTurnDisplayModel`.

The normalization must preserve relative ordering and should not flatten text and media in ways that reorder content.

### 3. Replace Flat Live Message Injection

`build-chat-items.ts` currently appends `streamSegments` and `toolMessages` as separate chat items. That is the main source of live/final/history divergence.

Replace that with a turn-aware strategy:

- historical messages remain top-level chat items
- the current live assistant turn is emitted as one assistant chat item
- its inner structure comes from the shared assistant-turn normalization

This keeps the chat list stable while allowing the turn internals to evolve without appearing as separate list rows.

### 4. Render Tool Groups in ChatMessage

`ChatMessage.tsx` should render assistant-turn parts rather than independently rebuilding tool parts from ad hoc sources.

Add a `ToolGroupCard` that:

- receives grouped tool items plus summary data
- renders a collapsed summary row by default when `collapsed === true`
- renders the underlying `ToolCard` list when expanded
- can support user toggling in finished turns

`ToolCard` remains the leaf renderer for individual tool events.

## Tool Group Detection

During normalization, scan the ordered assistant turn content and coalesce consecutive tool items into a single `tool_group`.

The grouping unit is based on rendered order, not store-origin path. A tool group may come from:

- finalized `toolCall` and `toolResult` blocks inside `message.content`
- reconstructed live tool messages
- a mixed finalized/live turn during handoff

Tool group boundaries occur when the sequence switches between tool and non-tool parts.

## Collapse State Resolution

For each `tool_group`, compute collapse state from both turn state and neighboring content.

Suggested rule:

```ts
collapsed =
  !isStreaming
  || hasLaterAssistantTextPart
```

Where `hasLaterAssistantTextPart` means a later `text` part exists in the same normalized turn.

Thinking-only content should not count as later assistant text for this rule unless we explicitly decide to surface it as user-visible answer text.

## Semantic Summary Heuristics

### Categorization

Categorize each tool item using `tool name + selected arguments`.

Initial mapping:

- file read:
  - `read`
  - `view`
  - `glob`
  - `grep`
- file edit:
  - `edit`
  - `write`
  - `apply_patch`
- command execution:
  - `bash`
  - `exec`
  - `run_command`
- web access or search:
  - `fetch`
  - `web_search`
  - browser-oriented fetch tools

Unknown tools fall back to a generic tool count bucket.

### Counting

Use the most meaningful count available per category:

- edited files: unique file paths when resolvable, otherwise call count
- read files: unique file paths when resolvable, otherwise call count
- commands: command call count
- web access/search: request count

### Summary Formatting

Generate a compact ordered summary:

- prioritize edit files
- then execute commands
- then read files
- then web access/search
- then generic tools

Keep the first one to three summary segments inline.

## Implementation Plan

### Phase 1: Shared Types and Normalization

- Add assistant turn display model types
- Add a normalization helper in the chat UI layer
- Convert current finalized assistant message parsing into normalized turn parts
- Preserve current text, image, file, and thinking extraction behavior

### Phase 2: Live Turn Unification

- Stop emitting live `streamSegments` and `toolMessages` as separate top-level chat items
- Emit one live assistant item backed by the shared normalized turn model
- Ensure live order matches existing stream order semantics

### Phase 3: Tool Group UI

- Add `ToolGroupCard`
- Render grouped tool items collapsed or expanded according to the shared rules
- Reuse `ToolCard` for expanded rows
- Add user expand/collapse interaction for finished groups

### Phase 4: Summary Heuristics

- Add tool categorization helper
- Add summary aggregation and formatting
- Tune wording and category priority against real transcripts

## Testing Strategy

Add unit coverage for:

- streaming turn where `assistant A -> tools -> assistant B` collapses the earlier tool group immediately
- streaming turn with an active tail tool group that remains expanded
- finished turn where all tool groups collapse
- history reload matching the finished-turn structure exactly
- semantic summary generation for mixed tool categories
- stable ordering for `text -> tool_group -> image -> text`
- fallback behavior for unknown tool names

Add rendering coverage for:

- collapsed `ToolGroupCard`
- expanded active tail `ToolGroupCard`
- toggle interaction in finished turns

## Risks and Mitigations

### Risk: Live and final data shapes still diverge in edge cases

Mitigation:

- make normalization accept both live and finalized sources explicitly
- drive all assistant rendering through the same normalized model

### Risk: Tool categorization is imperfect

Mitigation:

- keep categorization heuristic and isolated
- provide a generic fallback summary
- avoid baking category assumptions into the store

### Risk: Large refactor inside `ChatMessage.tsx`

Mitigation:

- preserve `ToolCard` and most existing leaf rendering
- move grouping logic into a small normalization helper instead of bloating the component

## Open Decisions Resolved In This Spec

- Tool grouping applies to live, final, and history views
- Collapse is based on both turn completion and whether later assistant text has appeared
- Finished turns always show collapsed groups by default
- First version uses frontend semantic summaries with four explicit categories

## Acceptance Criteria

- The current turn no longer jumps to a visibly different structure when final assistant content arrives
- Reloaded history matches the finished-turn structure
- Older tool runs in a still-streaming turn collapse once later assistant text appears
- Finished turns collapse all tool groups
- Collapsed groups show semantic summaries such as file edits and command execution counts
- Users can still inspect per-tool detail by expanding a collapsed group
