# Simplified Startup Flow Design

Date: 2026-03-12
Status: Draft
Owner: GeeClaw desktop

## Context

GeeClaw currently treats first run as a multi-step setup wizard:

- welcome
- runtime check
- provider setup
- installing
- complete

That flow is too technical for a beginner product. It exposes internal implementation details such as Gateway, OpenClaw runtime checks, and Python setup. It also does not match the real startup behavior well:

- the main process already auto-starts Gateway on app launch
- managed workspace setup already happens automatically before Gateway launch
- Python readiness can already be repaired in the background
- `setupComplete` is only a renderer-persisted flag, not a true backend bootstrap state

The product goal is to replace the current wizard with a much simpler, user-facing startup flow that feels natural to a beginner.

## Product Decision

Adopt a single unified startup flow for both cold and warm launch.

The startup sequence should always begin with a lightweight session check. The future login system only determines provider token access. It does not partition workspace, local chat history, or local runtime state by user.

Because of that scope, GeeClaw should:

- check session state before starting the full user-facing Gateway flow
- allow lightweight local preflight before login if useful
- avoid showing technical setup steps to the user
- only ask the user to do two things:
  - sign in if required
  - connect or confirm an AI provider if still missing

## Cold vs Warm Launch

For product design, cold and warm launch are mostly the same flow with different dwell time.

Cold launch must do extra machine preparation:

- initialize `~/.openclaw-geeclaw`
- ensure managed workspace exists
- run managed `openclaw --profile geeclaw setup` when needed
- ensure Python 3.12 is available for managed runtime needs
- start and attach Gateway

Warm launch usually skips most of that work because local state already exists.

User-visible difference:

- warm launch should feel like a short loading state
- cold launch may stay on the preparing state longer

User-visible flow should still be the same in both cases.

## Goals

- remove the technical multi-step setup wizard from the default entry flow
- add a startup gate that checks session state first
- keep Gateway startup behind resolved session state
- support a mock session implementation now so the flow can be built before real auth exists
- preserve future expansion for real login and cloud-issued provider tokens
- keep cold and warm startup behavior understandable to beginners

## Non-Goals

- redesigning workspace or chat history to be per-user
- introducing a full cloud account system in this change
- replacing provider configuration storage yet
- changing the bundled runtime strategy

## Recommended User Flow

Use one entry surface with dynamic states instead of a wizard.

### State 1: `checking_session`

Shown on every launch.

User copy:

- title: `Checking your account...`
- body: `Just a moment while GeeClaw gets ready.`

Behavior:

- resolve session state from a new session service
- do not start full Gateway yet
- lightweight local preflight is allowed in the background

### State 2: `needs_login`

Shown when no session is present.

User copy:

- title: `Sign in to continue`
- body: `Sign in to connect your AI access and finish setup.`

Behavior:

- primary action: `Sign in`
- secondary action can be omitted for now to keep the flow simple
- once login succeeds, continue automatically

### State 3: `preparing`

Shown after session is resolved.

User copy:

- title: `Preparing GeeClaw`
- body: `This may take a little longer the first time.`

Behavior:

- run managed profile setup if needed
- ensure Python readiness
- resolve provider token availability
- start Gateway only after the session check is complete

This is the main state for both cold and warm launch.

### State 4: `needs_provider`

Shown when login is complete but GeeClaw still cannot use an AI provider.

User copy:

- title: `Connect your AI service`
- body: `Choose an AI provider to start chatting.`

Behavior:

- show provider selection and credential entry
- on success, continue automatically into preparing or ready
- no separate “complete” page

### State 5: `ready`

Not a visible page. Transition directly into the app home screen.

Optional:

- show a small success toast on first successful entry

### State 6: `error`

Shown when startup cannot recover automatically.

User copy:

- title: `GeeClaw needs attention`
- body: `We couldn't finish preparing the app. Try again, or open details if you need help.`

Behavior:

- primary action: `Try again`
- secondary action: `View details`
- technical logs stay hidden by default

## Gateway Timing

### Recommendation

Do not start the full Gateway before session state is known.

Rationale:

- future session will influence provider token resolution
- this avoids preparing the user-facing runtime with incomplete auth context
- it simplifies mental model: account first, app preparation second

### Allowed before login

Only lightweight local preflight should happen before session resolution:

- read local settings
- load language and theme
- probe whether managed workspace exists
- optionally probe Python readiness

These actions must not assume a user token and must not show technical details in the UI.

### Gateway after login

After session becomes `authenticated`:

1. resolve provider token state
2. if provider/token is missing, go to `needs_provider`
3. once provider is satisfied, start Gateway and continue bootstrap

This avoids a provider-triggered restart during first-run entry and produces a cleaner beginner flow.

## Mock Session Design

Implement the startup flow against a mock session service now.

The mock service should live in the main process, not only in renderer state, so that later replacement with real auth does not force a UI rewrite.

Recommended session model:

```ts
type SessionStatus = 'checking' | 'authenticated' | 'unauthenticated';

interface SessionState {
  status: SessionStatus;
  account: null | {
    id: string;
    email?: string;
    displayName?: string;
  };
}
```

Recommended mock routes:

- `GET /api/session`
- `POST /api/session/mock-login`
- `POST /api/session/mock-logout`

Recommended initial behavior:

- first install defaults to `unauthenticated`
- mock login writes a fake account into main-process store
- mock logout clears the fake account

This gives us a stable entry contract now while keeping the auth backend replaceable later.

## Provider Resolution Rules

Since login only exists to determine provider token access, provider resolution should be explicit in the startup state machine.

Recommended rules:

- if session is `unauthenticated`, do not start Gateway
- if session is `authenticated` and cloud provider token is available, proceed to preparing
- if session is `authenticated` but provider token is missing, show `needs_provider`
- if local manual provider config already exists, that counts as satisfied for now

This keeps the future path flexible:

- later we can prefer cloud-issued token
- but current local provider account storage can still satisfy startup

## UI Structure

Replace the current wizard with a single startup shell.

Suggested structure:

- app logo
- one clear headline
- one short explanation line
- one primary panel whose content changes by state
- optional subtle progress indicator during preparing
- no numbered steps
- no final success screen

Do not show these terms in primary UI:

- Gateway
- OpenClaw
- Python
- runtime check
- installing components

These can remain available in an advanced details affordance only.

## Recommended Code Changes

### 1. Replace `setupComplete` gate with startup state gate

Files to review:

- `src/App.tsx`
- `src/stores/settings.ts`
- `src/pages/Setup/index.tsx`

Expected changes:

- remove startup routing that depends on renderer-only `setupComplete`
- introduce a new startup entry route or shell component
- derive entry behavior from session/bootstrap state instead of wizard progress

### 2. Add session store and Host API routes

Files to add or update:

- `src/stores/session.ts`
- `electron/api/routes/session.ts`
- `electron/utils/store.ts`
- `electron/main/ipc-handlers.ts` only if IPC helpers are needed

Expected changes:

- persist mock session in main-process store
- expose `GET /api/session`
- expose `POST /api/session/mock-login`
- expose `POST /api/session/mock-logout`

### 3. Move Gateway startup behind bootstrap orchestration

Files to review:

- `electron/main/index.ts`
- `electron/gateway/manager.ts`
- `src/stores/gateway.ts`

Expected changes:

- stop unconditional Gateway auto-start at app-ready time
- create an explicit bootstrap start action after session resolution
- keep attach/reconnect behavior once bootstrap has started

### 4. Split bootstrap into product-facing phases

Files to add or update:

- `src/stores/bootstrap.ts`
- `src/pages/Setup/index.tsx` or a renamed entry page such as `src/pages/Entry/index.tsx`

Recommended bootstrap phases:

```ts
type BootstrapPhase =
  | 'idle'
  | 'checking_session'
  | 'needs_login'
  | 'preparing'
  | 'needs_provider'
  | 'ready'
  | 'error';
```

The bootstrap store should own the transition logic instead of spreading it across the page.

### 5. Keep technical diagnostics, but hide them

Files to review:

- `src/pages/Setup/index.tsx`
- `electron/api/routes/logs.ts`

Expected changes:

- keep logs accessible from error state
- remove technical checklist UI from the main path

## Recommended Transition Rules

```text
app launch
  -> checking_session
  -> unauthenticated => needs_login
  -> authenticated => preparing

needs_login
  -> mock login success => preparing

preparing
  -> provider missing => needs_provider
  -> bootstrap success => ready
  -> unrecoverable failure => error

needs_provider
  -> provider saved => preparing

error
  -> retry => checking_session or preparing
```

## Suggested Implementation Order

1. Add main-process mock session storage and `/api/session` routes.
2. Add `session` store in renderer.
3. Add `bootstrap` store with the recommended startup phases.
4. Replace the current setup wizard UI with a single dynamic startup shell.
5. Move Gateway auto-start out of `app.whenReady()` flow and behind bootstrap orchestration.
6. Reuse current provider setup UI inside `needs_provider`.
7. Keep logs/error details as an expandable advanced path.
8. Update onboarding copy and README references after behavior changes land.

## Testing Plan

Add or update tests for:

- unauthenticated launch goes to `needs_login`
- mock login transitions into bootstrap
- authenticated launch without provider goes to `needs_provider`
- authenticated launch with provider goes to `preparing` then `ready`
- cold launch runs managed profile setup when workspace is missing
- warm launch skips managed profile setup when workspace already exists
- Gateway is not auto-started before session resolution
- technical errors surface through `error` state, not a broken wizard step

Manual verification:

- clean machine, no session, no provider
- clean machine, authenticated mock session, no provider
- clean machine, authenticated mock session, provider configured
- existing machine, authenticated mock session, Gateway reconnects quickly

## Risks

- moving Gateway startup out of app-ready may affect existing assumptions in stores that expect early status events
- provider sync logic currently assumes Gateway may already exist; bootstrap ordering must be checked carefully
- leaving old `setupComplete` persistence in place can create mixed entry behavior if not removed cleanly
- docs and screenshots may drift if startup UI changes but onboarding copy is not updated

## Acceptance Criteria

- the default launch flow no longer shows a numbered technical setup wizard
- GeeClaw always checks session state before starting full user-facing bootstrap
- GeeClaw does not start the full Gateway before session state is resolved
- a mock login path exists in main process and can drive the startup flow end-to-end
- cold and warm launch use the same visible flow, differing mainly in load time
- beginners can reach chat with at most two intentional actions:
  - sign in
  - connect a provider if still required
