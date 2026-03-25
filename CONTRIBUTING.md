# Contributing to GeeClaw

Thanks for helping improve GeeClaw. Small fixes, larger features, documentation updates, and translation improvements are all welcome.

## Development Setup

1. Install Node.js 22+.
2. Enable the pinned pnpm version with `corepack enable && corepack prepare`.
3. Install dependencies and download the managed `uv` runtime with `pnpm run init`.
4. Start the app with `pnpm dev`.

## Quality Checks

- Use `pnpm lint` when you want ESLint to apply safe auto-fixes.
- Use `pnpm run lint:check` for a non-mutating lint pass.
- Run `pnpm run typecheck` before opening a PR.
- Run `pnpm test` for unit coverage.
- Run `pnpm run verify` to execute the standard pre-PR validation sequence.

## Project Guardrails

- Keep renderer-to-backend calls inside `src/lib/host-api.ts` and `src/lib/api-client.ts`.
- Do not add direct `window.electron.ipcRenderer.invoke(...)` calls in renderer components or pages.
- Do not fetch local Gateway endpoints directly from the renderer. Route through the Main-process proxies.
- After functional or architecture changes, update both `README.md` and `README.zh-CN.md` in the same PR.
- Prefer focused pull requests with tests or documentation updates when behavior changes.

## Pull Requests

When opening a PR, please include:

- a short summary of the user-facing or architectural change
- the validation you ran locally
- screenshots or recordings for UI changes when helpful

If you are unsure where a change belongs, start with a draft PR or issue. That is completely fine and often the fastest way for us to help.
