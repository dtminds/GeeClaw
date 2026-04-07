# OpenClaw WebChat Message Rendering Gap Spec

> Scope: analyze `/Users/lsave/workspace/AI/openclaw/` WebChat-related message rendering, compare it with ClawX `ChatMessage.tsx`, and define the rendering logic ClawX should add or align.

**Goal:** make ClawX chat rendering behavior match the important user-visible semantics of OpenClaw WebChat, especially around assistant message filtering, phased/final text selection, tool result handling, and markdown/image safety.

**Primary OpenClaw source paths**
- `/Users/lsave/workspace/AI/openclaw/apps/shared/OpenClawKit/Sources/OpenClawChatUI/ChatView.swift`
- `/Users/lsave/workspace/AI/openclaw/apps/shared/OpenClawKit/Sources/OpenClawChatUI/ChatMessageViews.swift`
- `/Users/lsave/workspace/AI/openclaw/apps/shared/OpenClawKit/Sources/OpenClawChatUI/AssistantTextParser.swift`
- `/Users/lsave/workspace/AI/openclaw/apps/shared/OpenClawKit/Sources/OpenClawChatUI/ChatMarkdownPreprocessor.swift`
- `/Users/lsave/workspace/AI/openclaw/apps/shared/OpenClawKit/Sources/OpenClawChatUI/ToolResultTextFormatter.swift`
- `/Users/lsave/workspace/AI/openclaw/src/gateway/server-methods/chat.ts`
- `/Users/lsave/workspace/AI/openclaw/src/shared/chat-message-content.ts`

**Primary ClawX source paths**
- `/Users/lsave/workspace/AI/ClawX/src/pages/Chat/ChatMessage.tsx`
- `/Users/lsave/workspace/AI/ClawX/src/pages/Chat/message-utils.ts`
- `/Users/lsave/workspace/AI/ClawX/src/lib/chat-message-text.ts`
- `/Users/lsave/workspace/AI/ClawX/src/lib/media-output.ts`
- `/Users/lsave/workspace/AI/ClawX/src/stores/chat/history.ts`
- `/Users/lsave/workspace/AI/ClawX/src/stores/chat/utils.ts`

---

## 1. What OpenClaw WebChat Actually Filters

### 1.1 Gateway / history-level filtering already in the OpenClaw WebChat path

OpenClaw `chat.history` does all of the following before the SwiftUI WebChat renders:

- Drops assistant messages whose visible text is exactly `NO_REPLY`.
- Keeps user messages containing `NO_REPLY`.
- Keeps mixed assistant messages when `entry.text` has real content and `entry.content` still contains stale `NO_REPLY`.
- Drops commentary-only assistant entries by extracting assistant-visible text via `extractAssistantVisibleText()` and refusing commentary-only payloads.
- Strips inline delivery directive tags from displayed text:
  - `[[reply_to_current]]`
  - `[[reply_to:<id>]]`
  - `[[audio_as_voice]]`
- Truncates long `text`, `thinking`, `arguments`, and `partialJson` fields.
- Removes `details`.
- Preserves sanitized assistant `usage` and `cost`.
- Removes `usage` / `cost` from non-assistant messages.
- Removes inline image base64 payloads from `content[].data` and replaces them with `omitted` metadata in history responses.

### 1.2 OpenClaw live-stream filtering already in the WebChat path

OpenClaw live chat event handling also:

- Suppresses delta events whose text is exact `NO_REPLY`.
- Suppresses lead fragments like `NO`, `NO_`, `NO_RE`, `NO_REPLY` when they are transient streamed prefixes of a silent reply.
- Strips inline directive tags from streamed assistant text before broadcasting to WebChat.
- Shows pending tool calls in a dedicated “Running tools…” bubble.
- Shows streaming assistant text only when `AssistantTextParser.hasVisibleContent(...)` says there is visible content.

### 1.3 Important note: helper logic present in the repo but not obviously wired into WebChat history

OpenClaw also contains `/src/shared/text/assistant-visible-text.ts`, which strips:

- reasoning tags like `<thinking>...</thinking>`
- `<relevant-memories>` blocks
- plain-text tool-call XML scaffolding such as `<tool_call>...</tool_call>`
- model special tokens such as `<|assistant|>` and DeepSeek full-width token variants

This helper is well tested, but in the current source walk it is not directly wired into the `chat.history` WebChat rendering path. It should therefore be treated as available logic, not guaranteed current WebChat behavior.

That distinction matters for ClawX planning:

- `phase` / `textSignature` handling is definitely wired today.
- inline directive stripping and `NO_REPLY` filtering are definitely wired today.
- assistant XML/special-token stripping is definitely implemented in OpenClaw, but may currently happen outside the exact WebChat history path or be partially upstream of persistence.

---

## 2. How OpenClaw WebChat Renders Messages

### 2.1 Visibility rules

OpenClaw decides message visibility in `ChatView.shouldDisplayMessage(...)`:

- Any message with inline attachments is visible.
- User messages are visible when primary text is non-empty.
- Assistant messages are visible only if their primary text has visible content after `AssistantTextParser`.
- If assistant trace is off, tool-only / tool-result-only messages are hidden.
- If assistant trace is on:
  - standalone tool result messages render only if they still have primary text
  - tool-call-only messages render
  - inline tool results render

### 2.2 Assistant primary text semantics

OpenClaw does not simply concatenate all `text` blocks.

It uses `AssistantTextParser` and `extractAssistantVisibleText` semantics:

- Prefer `final_answer` text over `commentary` text.
- Drop commentary-only assistant messages from visible history.
- Support top-level `phase`.
- Support per-text-block `textSignature.phase`.
- Parse `<think>...</think>` and `<final>...</final>` tags inside raw assistant text.
- Hide `<think>` segments unless trace is enabled.
- Do not treat `<thinking>` as a special tag in this parser.

### 2.3 Tool rendering semantics

OpenClaw splits assistant rendering into:

- primary text
- attachments
- tool calls
- inline tool results
- standalone `tool_result` role messages

Special handling:

- If a standalone `tool_result` message has `toolCallId` matching the previous assistant message’s tool call, OpenClaw merges that tool result into the previous assistant message as an inline `tool_result` content block.
- If it does not match, the `tool_result` message remains standalone and can still render in trace mode.
- Tool calls render as concise summary cards using `ToolDisplayRegistry`.
- Tool results render through `ToolResultTextFormatter`, which:
  - leaves plain text untouched
  - summarizes some JSON payloads, especially `nodes`
  - condenses structured errors to short readable strings
  - suppresses unknown structured JSON by returning empty text

### 2.4 Markdown / image rendering semantics

OpenClaw preprocesses markdown before rendering:

- strips inbound untrusted metadata blocks
- strips envelope headers and `[message_id: ...]`
- strips prefixed timestamps
- extracts `![alt](data:image/...)` images into a separate inline image list
- flattens remote markdown images to plain alt text instead of rendering remote images
- preserves normal markdown text rendering for the remaining content

This is a meaningful safety/UX policy: data images are allowed, remote markdown images are not rendered.

---

## 3. What ClawX Already Does

ClawX already matches OpenClaw in some important areas:

- Hides `system` messages and assistant ack messages `HEARTBEAT_OK` / `NO_REPLY` via `isInternalMessage(...)`.
- Strips user inbound envelope / message-id / metadata blocks for display.
- Strips `[[audio_as_voice]]` and `MEDIA:` output markers from assistant text via `splitMediaFromOutput(...)`.
- Extracts content-block images and attachment previews.
- Carries files/images produced by `tool_result` turns onto the next assistant message in store preprocessing.
- Merges tool execution state from inline tool blocks and separate `tool_result` messages into `_toolStatuses`.
- Hides `tool_result` role messages in the final React render.
- Renders assistant thinking blocks from `content[].type === "thinking"`.
- Renders assistant tool calls as separate cards.

These are real alignments, not gaps.

---

## 4. Confirmed Gaps in ClawX

### 4.1 Missing assistant phase-aware filtering

ClawX currently has no equivalent of OpenClaw’s `extractAssistantVisibleText()`:

- no `phase` support on `RawMessage`
- no `textSignature` support on content blocks
- no “prefer `final_answer` over `commentary`” logic
- no “drop commentary-only assistant message” logic

Current consequence:

- if OpenClaw-style phased assistant history reaches ClawX, `extractText()` will concatenate all `text` blocks and render commentary text that OpenClaw hides.

### 4.2 Missing `<think>` / `<final>` parsing in plain assistant text

OpenClaw parses raw assistant text into thinking vs response segments.
ClawX only understands explicit `content[].type === "thinking"` blocks.

Current consequence:

- assistant text containing `<think>` / `<final>` sections will render as a single markdown blob in ClawX instead of following trace visibility semantics.

### 4.3 Tool-result role handling is more lossy than OpenClaw

ClawX always returns `null` for `role === toolresult/tool_result` in `ChatMessage.tsx`.

OpenClaw does not do that blindly:

- it merges matched tool results into the previous assistant turn
- but keeps unmatched standalone tool-result messages renderable in trace mode

Current consequence:

- orphaned or unmatched tool results can disappear entirely in ClawX.

There is a second mismatch in ClawX store logic:

- `findPreviousAssistantToolMessageIndex(...)` falls back to the nearest previous assistant message that had any tool call, even when there is no real match.
- OpenClaw only merges a standalone `tool_result` into the immediately previous assistant message when the `toolCallId` actually matches that message’s tool-call ids.

Current consequence:

- ClawX can both hide unmatched tool results and incorrectly attribute them to the wrong prior assistant tool turn.

### 4.4 Missing markdown preprocessor parity for assistant text

OpenClaw markdown rendering applies `ChatMarkdownPreprocessor`.
ClawX assistant text goes straight into `Streamdown`.

Current ClawX gaps:

- no flattening of remote markdown images to alt text
- no extraction of `data:image/...` markdown images into controlled preview UI
- no assistant-side stripping of envelope / message-id / inbound context blocks before markdown render

Important verified detail:

- ClawX `Streamdown` bundle allows broad image/link prefixes and `allowDataImages: true`.
- This means assistant markdown images are much more permissive than OpenClaw’s WebChat policy.

### 4.5 Missing OpenClaw-style tool result text formatting

ClawX `ToolCard` displays raw `result` text in a popover.
OpenClaw formats tool result text before rendering:

- summarize useful JSON structures
- compress common error payloads
- suppress unknown noisy structured payloads

Current consequence:

- ClawX tool result rendering is functionally richer for debugging, but noisier and less user-friendly.

### 4.6 Usage/cost metadata is preserved but not surfaced in message UI

ClawX already parses usage metadata and even has `/src/pages/Chat/message-usage.ts`, but `ChatMessage.tsx` has the hover-bar usage badges commented out.

OpenClaw explicitly preserves usage/cost for chat UI consumption.

This is a lower-priority parity gap, but it is a real one.

---

## 5. Recommended ClawX Target Behavior

ClawX should align to the following message-rendering contract:

### 5.1 Assistant text selection contract

- Define assistant visible text using phased semantics first:
  - prefer `final_answer`
  - suppress commentary-only assistant entries from normal rendering
  - optionally expose commentary only through trace / thinking UI
- Support both:
  - OpenClaw message-level `phase`
  - OpenClaw block-level `textSignature.phase`
- Keep backward compatibility for legacy unphased messages.

### 5.2 Assistant text segmentation contract

- Parse raw assistant text for `<think>` / `<final>` segments.
- Reuse `showThinking` to decide whether `<think>` text is visible.
- Do not regress existing support for explicit `content[].thinking` blocks.
- Treat explicit thinking blocks and parsed `<think>` segments as the same conceptual layer.

### 5.3 Tool-result contract

- Keep current store-side enrichment of attachments and tool statuses.
- Stop unconditionally dropping standalone `tool_result` role messages in the React layer.
- Instead:
  - hide matched tool results already merged into prior assistant tool state
  - render unmatched tool-result messages in trace mode when they have displayable text
- Remove fallback cross-message tool-result reassignment when there is no explicit tool-call match.

### 5.4 Markdown/image safety contract

- Add an assistant-side markdown preprocessor equivalent to OpenClaw’s:
  - flatten remote markdown images to text
  - extract `data:image/...` markdown images into a dedicated preview list
  - strip residual envelope/message-id/inbound-metadata noise before markdown render
- Preserve current attachment/content-block image rendering.

### 5.5 Tool result presentation contract

- Add a formatter layer before showing tool result text.
- Preserve access to raw payload for debugging, but default collapsed rendering should be concise and human-readable.

---

## 6. Recommended Scope Order

Priority order for ClawX:

1. Assistant phase-aware filtering and final-answer selection.
2. `<think>` / `<final>` segmentation and trace integration.
3. Preserve orphan tool-result visibility in trace mode.
4. Assistant markdown preprocessing parity, especially remote-image flattening.
5. Tool result formatter parity.
6. Optional usage/cost badges.

---

## 7. Non-Goals for the First Alignment Pass

- Rebuilding OpenClaw SwiftUI visuals.
- Matching exact bubble styling or card layout.
- Porting every OpenClaw tool-display string or emoji mapping one-to-one.
- Rewriting the entire ClawX store pipeline; most gaps are in display semantics and text selection, not transport.
