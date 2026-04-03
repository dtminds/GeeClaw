# Quick Actions Design

## Summary

GeeClaw supports shortcut-driven quick actions that open a shared floating window near the cursor. Each action can define its own shortcut, default mode, prompt type, and result-delivery preference while still reusing the same compact window.

## Interaction Model

1. The user selects text in any app.
2. A global quick-action shortcut is pressed.
3. GeeClaw resolves input from native selection when available, then optionally falls back to clipboard text.
4. A floating quick-action window opens near the cursor and defaults to the invoked mode.
5. The user can switch to another mode inside the same window without re-triggering a new shortcut.
6. Results can be copied or best-effort pasted back into the active app.

## Built-in Modes

- `translate`
- `reply`
- `lookup`
- `customPrompt`

Each action is settings-backed and may override:

- title
- shortcut
- enabled state
- mode kind
- output mode
- custom prompt template

## Platform Constraints

- macOS direct selection capture requires Accessibility permission.
- Windows direct selection capture depends on UI Automation support in the foreground app.
- GeeClaw falls back to clipboard text when direct selection capture is unavailable and the fallback setting is enabled.
- Current paste handling is an honest clipboard-based best effort and does not promise true simulated typing or replacement yet.

## MVP Scope

- One shortcut per quick action
- Shared floating window near the mouse cursor
- In-window mode switching
- Built-in translate, reply, and lookup actions
- Custom prompt actions from settings
- Clipboard fallback
- Copy result and clipboard-backed paste result flow

## Deferred Work

- Native helper-backed macOS Accessibility extraction
- Native helper-backed Windows UI Automation extraction
- Real paste simulation back into the originating app
- Automatic popup on every selection change
