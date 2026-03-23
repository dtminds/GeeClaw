# Chat Store Single-Source Refactor Plan

Date: 2026-03-23
Status: Draft
Owner: GeeClaw desktop

## Context

As of this cleanup, `src/stores/chat.ts` is the only runtime source of truth for chat state.

The previously introduced `src/stores/chat/` split implementation was not wired into `@/stores/chat`, but parts of it were still referenced by tests. That created a dual-track situation where code could be edited and tested without affecting the real app.

This plan defines the next safe step: refactor the large single-file store into modules while keeping one authoritative entrypoint at all times.

## Goals

- Keep `@/stores/chat` as the single runtime entrypoint during the entire refactor.
- Reduce `src/stores/chat.ts` into a small composition file.
- Extract cohesive logic into modules without duplicating behavior.
- Preserve current product behavior for:
  - desktop session management
  - chat history hydration
  - streaming text and tool events
  - cron run viewing
  - composer seeding
  - attachment/file-card enrichment

## Non-Goals

- Do not redesign chat product behavior during the structural refactor.
- Do not change transport policy, gateway contracts, or message schema unless required by a bug fix.
- Do not reintroduce a second store implementation under a parallel path.

## Refactor Rule

Every extraction must follow this rule:

1. Move logic out of `src/stores/chat.ts`.
2. Keep `src/stores/chat.ts` calling the extracted module.
3. Do not copy logic into a second implementation.
4. Do not let tests target a non-runtime fork.

## Target Shape

Keep one public entrypoint:

- `src/stores/chat.ts`

Use private implementation modules behind it, for example:

- `src/stores/chat-state.ts`
- `src/stores/chat-history.ts`
- `src/stores/chat-runtime.ts`
- `src/stores/chat-sessions.ts`
- `src/stores/chat-attachments.ts`
- `src/stores/chat-selectors.ts`

The exact filenames can change, but the architecture principle should stay the same:

- one public module
- many private helpers
- no duplicate store

## Recommended Extraction Order

### Phase 1: Pure utilities

Extract the lowest-risk pure helpers first:

- timestamp normalization
- message text extraction
- attachment filename filtering
- raw file path extraction
- stream text dedupe helpers
- skill-marker-safe history text normalization

Success criteria:

- extracted modules have no Zustand dependency
- existing tests still pass
- `chat.ts` behavior is unchanged

### Phase 2: Attachment and history hydration

Extract history preparation into a dedicated module:

- tool result attachment enrichment
- cached attachment restoration
- preview loading
- `prepareHistoryMessagesForDisplay`
- `hydrateHistoryMessagesForDisplay`

Success criteria:

- history loading code in `chat.ts` becomes orchestration only
- attachment/file-card bugs remain covered by tests

### Phase 3: Runtime stream state transitions

Extract event transition logic for:

- `chat` event state handling
- `agent` tool stream handling
- pending tool attachment merge
- history polling timers and error recovery timers

Success criteria:

- runtime state transitions are testable as pure or near-pure functions
- `useChatStore` keeps owning side effects, but delegates logic

### Phase 4: Session and desktop-session flows

Extract session lifecycle logic:

- desktop session loading
- main session opening
- temporary session creation
- session deletion and cleanup
- cron run opening
- toolbar/session preview derivation

Success criteria:

- desktop-session behavior stays unchanged
- session-specific code is no longer interleaved with runtime stream logic

### Phase 5: Final store composition cleanup

Reduce `src/stores/chat.ts` to:

- exported types
- exported public helpers used outside the store
- `useChatStore` assembly
- imports from extracted modules

Success criteria:

- `chat.ts` is primarily composition, not implementation detail
- no second implementation path exists anywhere in `src/stores`

## Testing Strategy

- Keep behavior tests aimed at `@/stores/chat` or public exports from `src/stores/chat.ts`.
- Prefer testing public preparation helpers over private module internals.
- When extracting runtime transitions, test state reducers directly, but only if they are used by the main store.
- Do not create tests that only validate a disconnected implementation.

## Safety Checks For Each Phase

- Run focused chat tests after each extraction.
- Grep for any accidental `@/stores/chat/...` imports before merging.
- Keep file moves small enough that behavioral diffs are easy to review.
- If a phase requires broad signature changes, land it separately from behavior changes.

## Completion Definition

This refactor is complete when:

- `src/stores/chat.ts` remains the only public chat store entrypoint
- the large implementation is split into private modules
- no duplicate chat store exists in the repo
- tests cover the live codepath only
