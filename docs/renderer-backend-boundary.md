# Renderer Backend Boundary

GeeClaw renderer code must keep backend communication behind the shared boundary modules:

- `src/lib/api-client.ts`
- `src/lib/host-api.ts`
- `src/lib/host-events.ts`

Allowed flow:

```text
Renderer UI/store -> api-client/host-api/host-events -> Electron Main IPC/proxy -> OpenClaw Gateway/runtime
```

## Rules

- Do not add direct `window.electron.ipcRenderer.invoke(...)` calls in renderer source outside the approved boundary modules.
- Do not call Gateway HTTP endpoints directly from renderer source, including `http://127.0.0.1:28788` and `http://localhost:28788`.
- Route Gateway HTTP access through Main-owned proxy channels such as `gateway:httpProxy`.
- Route Host API requests through `hostapi:fetch`; browser fallback belongs only inside `src/lib/host-api.ts`.
- Keep transport fallback policy in `src/lib/api-client.ts`; renderer UI, stores, hooks, and utilities should not implement their own Gateway protocol switching.
- When backend communication behavior changes, update focused tests near the boundary module that owns the behavior.

## Guardrail

`tests/unit/repo-hygiene.test.ts` scans tracked renderer source files for the two highest-risk bypasses:

- direct IPC invocation outside `src/lib/api-client.ts` and `src/lib/host-api.ts`
- hard-coded renderer Gateway localhost URLs on port `28788`

This guardrail is intentionally lightweight. It is not a replacement for code review, boundary-module tests, or feature-specific tests.
