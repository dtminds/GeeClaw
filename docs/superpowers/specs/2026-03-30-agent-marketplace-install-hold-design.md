# Agent Marketplace Install Hold Design

## Summary

For the current test package, GeeClaw should keep the built-in agent marketplace visible and explorable, but the active `Add` action must not install any preset yet.

This increment temporarily changes the marketplace install UX:

- supported presets still show their normal `Add`/`Install` label,
- those actions are disabled in both the marketplace card and preset detail dialog,
- hovering the disabled action shows a short tooltip: `暂未开放`,
- already-installed and platform-unavailable states keep their existing labels and disabled behavior.

## Goals

1. Prevent test users from installing marketplace presets from any current UI entry point.
2. Preserve the existing marketplace browsing flow and preset detail inspection.
3. Make the disabled state explicit with a short hover explanation.
4. Keep the implementation localized to the renderer so it can be easily reverted later.

## Non-Goals

1. Removing the marketplace tab or hiding presets.
2. Changing backend install routes or preset metadata.
3. Renaming installed or unsupported states.
4. Adding a larger announcement banner or modal for this temporary hold.

## Product Decision

The temporary hold applies only to installable presets that would normally render an enabled `Add` action.

- Marketplace card action: disabled with hover tooltip.
- Preset detail dialog footer action: disabled with hover tooltip.
- Installed preset action: unchanged disabled `Installed`.
- Unsupported preset action: unchanged disabled `Unavailable`.

This keeps the marketplace honest: users can inspect presets, but every live installation path is visibly paused.

## Testing Strategy

Add a renderer regression test that verifies:

1. supported marketplace presets render disabled install buttons,
2. hovering a disabled install trigger shows `暂未开放`,
3. the same disabled state is present in the preset detail dialog.
