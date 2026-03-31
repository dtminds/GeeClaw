# Plaza Dashboard Restructure Design

## Goal

Rename Dashboard to "Plaza" in the product surface and restructure the page so it contains:

- a top "running status" section
- a tabbed plaza area below it with:
  - preset agent plaza
  - inspiration plaza

The preset agent marketplace should move out of agent management and adopt the same category, card, and modal style language as the inspiration plaza.

## Current State

- `src/pages/Dashboard/index.tsx` renders `DashboardSettingsSection` and `InspirationPlazaSection`.
- `src/pages/Agents/index.tsx` mixes two concerns:
  - agent management
  - preset marketplace
- preset agent details use `MarketplacePresetDetailDialog`, which has its own visual treatment separate from inspiration plaza.
- preset metadata already contains a `category` field in `AgentPresetSummary`, so frontend-only category filtering is possible.

## Target Structure

### Plaza Page

`src/pages/Dashboard/index.tsx` remains the `/dashboard` route entry, but the page should read as "Plaza" instead of "Dashboard".

Composition:

1. `DashboardSettingsSection` stays at the top as the running status section.
2. A new tab container sits below it.
3. Default active tab is preset agent plaza.
4. Secondary tab is inspiration plaza.

### Preset Agent Plaza

Create a dedicated dashboard-facing plaza section for presets instead of rendering preset marketplace inside `src/pages/Agents/index.tsx`.

Responsibilities:

- read preset catalog from `useAgentsStore`
- fetch presets on mount if needed
- derive installed state from existing agents
- provide category filtering using preset `category`
- show cards in the same grid/card rhythm as inspiration plaza
- open a detail dialog that matches inspiration plaza modal structure
- preserve existing install behavior and progress feedback

### Agents Page

`src/pages/Agents/index.tsx` becomes a pure management page:

- remove marketplace tab and preset marketplace grid
- keep fetch logic for agents/channels/presets only if still needed by settings flows; otherwise trim to agents/channels
- keep add/delete/settings flows unchanged

## Visual Rules

### Tabs

- Plaza page tabs should reuse the same rounded-pill style already used in inspiration plaza category chips.
- Default selection should be the preset agent plaza tab.

### Preset Categories

- Preset category pills should visually match inspiration category chips.
- Use an `all` option plus discovered preset categories from the catalog.
- Category labels should come from dashboard locale strings, with fallback to raw category text when unknown.

### Preset Cards

- Preset cards should match inspiration card structure:
  - rounded surface
  - icon/emoji area on top
  - strong title
  - compact muted description
- Keep preset-specific metadata compact, for example platform badges or install state.
- Primary interaction is clicking the whole card to open details.

### Preset Detail Dialog

- Switch to the same modal shell conventions already used by the inspiration detail dialog:
  - `modal-card-surface`
  - centered header
  - grouped content sections
  - footer CTA
- Preserve preset-specific content:
  - description
  - platform support
  - preset skills
  - agent id summary
  - install button / progress

## Data Flow

- `useAgentsStore.fetchAgents()` supplies installed preset ownership state.
- `useAgentsStore.fetchPresets()` supplies catalog entries.
- installed preset ids are derived from `agents` where `source === 'preset'`.
- install action continues to call `installPreset(presetId)` from the store.
- install progress remains store-driven via `installingPresetId`, `installStage`, and `installProgress`.

## Testing

Add regression coverage for:

- plaza page defaulting to preset agent tab
- switching between preset plaza and inspiration plaza
- preset category filtering
- preset detail dialog content and install state
- agent management page no longer rendering marketplace tabs/content

## Risks

- moving marketplace UI out of `Agents` can break tests that rely on old tab text or old fetch patterns
- preset category strings may be mixed-language or raw ids, so UI must tolerate unknown categories
- dialog style convergence must not drop install progress visibility
