---
id: backend-communication-boundary
title: Backend Communication Boundary
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
requiredProfiles:
  - boundary
---

Renderer backend calls must go through `src/lib/host-api.ts` and `src/lib/api-client.ts`.

Pages and components must not add direct `window.electron.ipcRenderer.invoke(...)` calls.

Renderer code must not call Gateway HTTP endpoints directly, including `127.0.0.1:28788` and `localhost:28788`.

Gateway transport policy remains owned by Electron Main. Renderer code must not implement protocol switching outside the API client boundary.

New backend interfaces must be exposed through Electron Main or the host API layer before renderer code consumes them.
