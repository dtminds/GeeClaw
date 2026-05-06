---
id: gateway-backend-communication
title: Gateway Backend Communication
type: runtime-bridge
ownedPaths:
  - src/lib/api-client.ts
  - src/lib/host-api.ts
  - src/lib/host-events.ts
  - src/stores/gateway.ts
  - src/stores/chat.ts
  - src/stores/chat/**
  - electron/api/**
  - electron/main/ipc/**
  - electron/main/ipc-handlers.ts
  - electron/gateway/**
  - electron/preload/**
  - electron/utils/**
requiredProfiles:
  - fast
  - boundary
conditionalProfiles:
  e2e:
    when:
      - user-visible gateway status changes
      - user-visible chat send/receive behavior changes
      - channels/agents/settings UI depends on new backend response shape
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - host-api-fallback-policy
  - host-events-fallback-policy
  - gateway-readiness-policy
  - docs-sync
forbiddenPatterns:
  - window.electron.ipcRenderer.invoke in src/pages/**
  - window.electron.ipcRenderer.invoke in src/components/**
  - fetch('http://127.0.0.1:28788 in src/**
  - fetch("http://127.0.0.1:28788 in src/**
  - fetch('http://localhost:28788 in src/**
  - fetch("http://localhost:28788 in src/**
  - geeclaw:allow-sse-fallback outside src/lib/host-events.ts and tests
  - geeclaw:gateway-ws-diagnostic outside src/lib/api-client.ts and tests
---

Gateway backend communication covers all GeeClaw paths that move data between the visual desktop UI and OpenClaw runtime/backend services.

Allowed flow:
Renderer page/component -> `src/lib/host-api.ts` or `src/lib/api-client.ts` -> Electron Main host route or IPC handler -> gateway proxy / OpenClaw Gateway -> runtime result -> store/UI.

Renderer code must not own direct IPC channels, direct Gateway HTTP calls, retry policy, or protocol fallback outside the shared boundary modules.

Harness frontmatter is parsed as YAML. Keep task specs simple and explicit so validation failures remain easy to read.
