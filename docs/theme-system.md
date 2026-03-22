# Theme System Specification

This document defines how GeeClaw themes are structured, which variables a theme must provide, and how UI code is allowed to consume them.

## Goals

- Make themes predictable and easy to extend.
- Stop theme data from being duplicated across CSS, settings UI, and application logic.
- Keep component styling semantic so a theme can change mood without rewriting component code.
- Separate theme definition from app-level presentation decisions.

## Layering

The theme system is split into three layers.

### 1. Theme Tokens

Each theme defines semantic color roles for both `light` and `dark` modes.

These are the only values a theme is responsible for.

- `background`
- `foreground`
- `card`
- `card-foreground`
- `popover`
- `popover-foreground`
- `primary`
- `primary-foreground`
- `secondary`
- `secondary-foreground`
- `muted`
- `muted-foreground`
- `accent`
- `accent-foreground`
- `border`
- `input`
- `ring`
- `destructive`
- `destructive-foreground`
- `success`
- `success-foreground`
- `warning`
- `warning-foreground`
- `info`
- `info-foreground`
- `chart-1`
- `chart-2`
- `chart-3`
- `chart-4`
- `chart-5`

### 2. Derived App Tokens

App-level surfaces are derived from the semantic tokens and must not be theme-authored one by one.

Examples:

- `--app-shell`
- `--app-sidebar`
- `--app-sidebar-strong`
- `--app-canvas`
- `--app-line`

These tokens exist to give the application shell a coherent feel while still following the active theme palette.

### 3. Component Rules

Components consume semantic tokens and derived app tokens. They do not own theme palettes.

Examples:

- Buttons use `primary`, `accent`, `foreground`, `border`.
- Inputs use `input`, `foreground`, `muted-foreground`, `ring`.
- Cards and dialogs use `card`, `popover`, `border`.
- App shell layout uses `app-*` derived tokens.

## Theme Authoring Rules

Every theme must follow these rules.

- Define both `light` and `dark` palettes.
- Keep `secondary`, `muted`, and `accent` distinct in purpose even if they are close in hue.
- Preserve readable contrast for `*-foreground` tokens.
- Use semantic roles, not component names.
- Prefer calm surfaces and reserve the strongest color for `primary`.
- Keep status colors semantic and stable across the app.

### Role Definitions

- `background`: the page or workspace base.
- `card`: elevated but persistent panels.
- `popover`: floating overlays, menus, and transient layers.
- `primary`: the main call-to-action and selected brand emphasis.
- `secondary`: restrained alternate actions or containers.
- `muted`: weak surfaces and supporting fills.
- `accent`: hover, selected, or highlighted surfaces that should be more interactive than `muted`.
- `border`: default edge color.
- `input`: default input container color.
- `ring`: focus outline color.
- `destructive`: dangerous actions and errors.
- `success`, `warning`, `info`: semantic state feedback only, never as substitute brand colors.

## Usage Rules

These rules apply to all renderer code.

- Use semantic tokens instead of raw color literals.
- Do not branch on theme IDs in component code.
- Do not hard-code theme-specific gradients, panel fills, or CTA colors in pages and components.
- Use `background` for page base, `card` for stable surfaces, and `popover` for overlays.
- Use `accent` for hover and selected states before reaching for custom translucent overlays.
- Use `muted` only for weak emphasis, not for active selection.
- Use `ring` only for focus affordances.
- Status banners and validation states use `success`, `warning`, `info`, or `destructive`.

## Allowed Exceptions

Direct color literals are allowed only for content that is not part of the app theme system.

- Brand logos and third-party assets
- Illustrations and decorative artwork
- Data visualization palettes that intentionally differ from the UI palette
- One-off marketing or onboarding art direction

If a direct color appears in reusable UI, it should be converted into a semantic token or a component-level derived token.

## Source of Truth

Theme definitions must live in the shared color theme registry in `src/theme/color-themes.ts`.

The registry is used by:

- theme application at runtime
- settings theme picker metadata
- future theme validation and previews

CSS should keep only:

- default fallback tokens
- derived app tokens
- component recipes that consume semantic tokens

## Migration Guidance

When cleaning up old UI code:

- Replace hard-coded CTA blues with `primary` and `primary-foreground`.
- Replace custom beige or dark panel fills with `card`, `popover`, `muted`, or shared surface classes.
- Replace custom success and warning fills with semantic state tokens.
- Prefer shared utility classes like modal surfaces over ad hoc panel color recipes.

## Review Checklist

Before shipping a new theme or themed component, verify:

- No component logic depends on a specific theme ID.
- No reusable UI hard-codes a palette color.
- Both light and dark modes remain legible.
- Primary, accent, and muted surfaces remain visually distinct.
- Focus, destructive, and success states are still obvious.
