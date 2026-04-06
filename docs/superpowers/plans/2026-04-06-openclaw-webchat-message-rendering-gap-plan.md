# OpenClaw WebChat Message Rendering Gap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** align ClawX chat rendering semantics with the important WebChat behavior already present in OpenClaw, especially for assistant phase filtering, thinking/final segmentation, tool-result visibility, and markdown/image preprocessing.

**Architecture:** keep ClawX’s current store pipeline for attachment hydration and tool status enrichment, but introduce an explicit assistant-display extraction layer between raw message content and `ChatMessage.tsx`. That layer should own phase selection, segment parsing, markdown preprocessing, and fallback rules so both history messages and live-stream text follow the same rendering contract.

**Tech Stack:** React 19, TypeScript, Streamdown, Zustand, existing ClawX chat helpers.

---

## File Map

**Create**
- `src/pages/Chat/assistant-display.ts`
  Purpose: phase-aware assistant text extraction, `<think>/<final>` segmentation, assistant markdown preprocessing hooks, and standalone tool-result display predicates.

- `src/pages/Chat/assistant-display.test.ts`
  Purpose: unit coverage for final-answer selection, commentary suppression, tag parsing, and orphan tool-result visibility decisions.

**Modify**
- `src/stores/chat/model.ts`
  Purpose: add missing message/content metadata types needed for OpenClaw phase parity.

- `src/pages/Chat/message-utils.ts`
  Purpose: stop using naive assistant text concatenation where phase-aware extraction is required.

- `src/pages/Chat/ChatMessage.tsx`
  Purpose: consume the new assistant display model, render parsed segments, and stop dropping every standalone tool-result role unconditionally.

- `src/lib/chat-message-text.ts`
  Purpose: add assistant-side markdown preprocessing parity where shared text cleanup belongs.

- `src/lib/media-output.ts`
  Purpose: reuse or extend media parsing for markdown-image extraction if the new assistant preprocessor needs shared helpers.

- `src/stores/chat/history.ts`
  Purpose: preserve enough metadata to distinguish matched vs unmatched tool-result turns if current enrichment hides that distinction.

- `src/pages/Chat/message-usage.ts`
  Purpose: optional support for re-enabling usage/cost badges once render semantics are stabilized.

**Reference Only**
- `docs/superpowers/specs/2026-04-06-openclaw-webchat-message-rendering-design.md`

---

## Task 1: Add Assistant Phase-Aware Extraction

**Files:**
- Create: `src/pages/Chat/assistant-display.ts`
- Create: `src/pages/Chat/assistant-display.test.ts`
- Modify: `src/stores/chat/model.ts`

- [x] Define message/content metadata types for assistant phase parity.
  Include optional fields compatible with OpenClaw transcript shape:
  - `RawMessage.phase?: 'commentary' | 'final_answer'`
  - `ContentBlock.textSignature?: string`
  - `ContentBlock.thinkingSignature?: string`

- [x] Implement helpers in `src/pages/Chat/assistant-display.ts`:
  - `parseAssistantTextSignature(value)`
  - `resolveAssistantMessagePhase(message)`
  - `extractAssistantVisibleText(message)`
  - `extractAssistantDisplaySegments(message, options)`

- [x] Implement these extraction rules:
  - prefer `final_answer` text
  - drop commentary-only text from visible assistant output
  - keep legacy unphased assistant text working
  - do not mix commentary with final text in the default visible output

- [x] Add tests covering:
  - commentary-only message becomes invisible by default
  - mixed commentary + final message shows only final text
  - legacy assistant message with plain `text` still renders
  - top-level `phase` and per-block `textSignature.phase` both work

---

## Task 2: Add `<think>` / `<final>` Segment Parsing

**Files:**
- Modify: `src/pages/Chat/assistant-display.ts`
- Modify: `src/pages/Chat/assistant-display.test.ts`
- Modify: `src/pages/Chat/ChatMessage.tsx`

- [x] Port the semantic behavior of OpenClaw `AssistantTextParser` into TypeScript.

- [x] Support parsing raw assistant text containing:
  - `<think>...</think>`
  - `<final>...</final>`

- [x] Merge this parser with the existing ClawX explicit `content[].type === 'thinking'` support so both sources feed one display model:
  - visible response segments
  - optional thinking segments

- [x] Update `ChatMessage.tsx` so assistant rendering uses structured segments instead of the current “text/thinking/tool” assembly alone.

- [x] Preserve current `showThinking` behavior:
  - when off, thinking segments are hidden
  - when on, thinking segments render in `ThinkingBlock`

- [x] Add tests covering:
  - `<think>` hidden when `showThinking` is false
  - `<think>` visible when `showThinking` is true
  - `<final>` renders as normal assistant text
  - pure thinking text does not create a visible assistant bubble when trace is off

---

## Task 3: Fix Standalone Tool-Result Visibility

**Files:**
- Modify: `src/stores/chat/history.ts`
- Modify: `src/pages/Chat/assistant-display.ts`
- Modify: `src/pages/Chat/ChatMessage.tsx`
- Modify: `src/pages/Chat/assistant-display.test.ts`

- [x] Audit current store enrichment so we can tell whether a `tool_result` role message was successfully merged into an earlier assistant tool call.

- [x] Introduce a small explicit decision helper:
  - matched/absorbed tool-result role messages stay hidden
  - unmatched/orphan tool-result role messages can render in trace mode if they have displayable text

- [x] Remove the current “fallback to nearest previous assistant tool message” behavior in `findPreviousAssistantToolMessageIndex(...)`.
  Only explicit tool-call matches should be merged.

- [x] Update `ChatMessage.tsx` to stop returning `null` for every `tool_result` role message.

- [x] Reuse the current attachment-forwarding logic, but preserve text visibility for unmatched tool results.

- [x] Add tests covering:
  - matched tool-result role remains hidden
  - unmatched tool-result role appears in trace mode
  - unmatched empty tool-result role stays hidden

---

## Task 4: Add Assistant Markdown Preprocessing Parity

**Files:**
- Modify: `src/lib/chat-message-text.ts`
- Modify: `src/lib/media-output.ts`
- Modify: `src/pages/Chat/assistant-display.ts`
- Modify: `src/pages/Chat/assistant-display.test.ts`
- Modify: `src/pages/Chat/ChatMessage.tsx`

- [x] Add an assistant-side markdown preprocessor with these rules:
  - strip envelope/message-id/inbound-metadata noise if present
  - flatten remote markdown images to fallback text instead of rendering remote images
  - extract `data:image/...` markdown images into a side list for controlled rendering

- [x] Ensure this preprocessing runs before `Streamdown`.

- [x] Feed extracted inline markdown images into the same assistant image area used for content-block images, or a parallel dedicated list with the same preview UX.

- [x] Keep existing content-block image handling unchanged.

- [x] Add tests covering:
  - `![alt](https://...)` becomes text `alt`
  - unlabeled remote images become `image`
  - `![x](data:image/...)` becomes extracted image data plus cleaned text

---

## Task 5: Add Tool Result Formatter Layer

**Files:**
- Modify: `src/pages/Chat/ChatMessage.tsx`
- Modify: `src/pages/Chat/assistant-display.ts`
- Modify: `src/pages/Chat/assistant-display.test.ts`

- [x] Introduce a `formatToolResultText(text, toolName)` helper inspired by OpenClaw’s `ToolResultTextFormatter`.

- [x] Support first-pass formatting for:
  - plain text passthrough
  - structured error JSON to concise `Error: ...`
  - `nodes` tool summaries
  - suppressing obviously unhelpful opaque JSON payloads from collapsed previews

- [x] Keep raw result accessible in the popover/debug surface if needed.

- [x] Update `ToolCard` collapsed preview and/or result display to use formatted text by default.

- [x] Add tests covering:
  - plain text unchanged
  - error JSON condensed
  - nodes JSON summarized
  - unknown JSON suppressed from compact preview

---

## Task 6: Optional Usage/Cost Hover Badges

**Files:**
- Modify: `src/pages/Chat/ChatMessage.tsx`
- Modify: `src/pages/Chat/message-usage.ts`

- [x] Revisit the currently commented-out `AssistantHoverBar` usage badges.

- [x] If re-enabled, only show badges when sanitized numeric values exist.

- [ ] Keep this task optional until the higher-priority rendering parity tasks are complete.

---

## Verification

- [x] Add or run unit tests for the new assistant extraction helpers.
- [x] Run targeted chat UI tests if present.
- [x] Run `pnpm exec vitest` for the new/changed test files.
- [x] Run `pnpm exec tsc --noEmit`.

Recommended verification commands:

```bash
pnpm exec vitest run src/pages/Chat/assistant-display.test.ts
pnpm exec tsc --noEmit
```

If markdown/image preprocessing is extracted into shared helpers, extend the test run with those files’ tests too.

---

## Expected Outcome

After these changes, ClawX should:

- stop leaking commentary-only assistant text into the normal transcript
- correctly prefer final-answer assistant text
- render `<think>` / `<final>`-style assistant text with trace-aware visibility
- keep orphan tool-result messages from disappearing
- align markdown image safety with OpenClaw’s WebChat policy
- present tool results more cleanly without losing debugging value
