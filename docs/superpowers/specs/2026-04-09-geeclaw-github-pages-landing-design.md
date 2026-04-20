# GeeClaw GitHub Pages Landing Spec

> Scope: create a GitHub Pages landing page that closely recreates `https://autoglm.zhipuai.cn/autoclaw/` as a single static site, rebranded for GeeClaw, with placeholder download links and source images temporarily reused from the upstream page.

**Goal:** add a self-contained static landing page under `site/` that can be published through GitHub Pages now and later bound to `www.geeclaw.cn` without code changes. The page should preserve the target page's visual hierarchy and overall section order, while removing the invoice/community extras the user does not want.

**Primary source paths**
- `/Users/lsave/workspace/AI/ClawX/site/index.html`
- `/Users/lsave/workspace/AI/ClawX/site/styles.css`
- `/Users/lsave/workspace/AI/ClawX/site/app.js`
- `/Users/lsave/workspace/AI/ClawX/README.md`
- `/Users/lsave/workspace/AI/ClawX/README.zh-CN.md`

**Reference source**
- `https://autoglm.zhipuai.cn/autoclaw/`

---

## 1. Product Decision

The deliverable should be a plain static site rooted at `site/`, not a new Vite app and not a renderer route inside the Electron product.

Reasoning:

- GitHub Pages can publish `site/` directly with minimal setup.
- A static page keeps the marketing site isolated from the Electron app runtime and release flow.
- The user plans to bind a custom domain later, so the page should avoid repo-name-coupled absolute paths.

The page should be a single-screen landing page with anchored navigation, not a multi-page site.

## 2. Scope

### 2.1 In scope

- top navigation with GeeClaw branding
- hero section with headline, supporting copy, and download CTAs
- hero product image using the current upstream asset
- three-step flow section using the current upstream assets
- footer with privacy policy and terms links
- placeholder download URLs wired for all CTA buttons
- simple client-side config for easy future link replacement

### 2.2 Out of scope

- invoice application link
- community/QR popover
- pricing chooser section and related dialog
- app store logic, platform detection, or analytics
- local asset pipeline for the borrowed images

## 3. Page Structure

The page should keep the same high-level narrative order as the source site:

1. top bar
2. hero section
3. execution-flow explainer
4. footer

### 3.1 Top bar

The top bar should include:

- GeeClaw wordmark/brand block
- one secondary anchor link that jumps to the download area or hero CTA region

The top bar should not include invoice or community actions.

### 3.2 Hero

The hero should remain a two-column composition on desktop:

- left: headline, description, stacked CTA buttons
- right: product screenshot

On mobile, the layout should collapse to a single column with the screenshot below the copy.

The headline and supporting copy should be adapted to GeeClaw branding while preserving the same product positioning style as the reference page. The copy does not need to be verbatim; matching intent and hierarchy is the requirement.

### 3.3 Flow section

The flow section should mirror the original three-card rhythm:

- task initiation
- agent execution
- result/context return loop

Each card should keep:

- an image preview area
- a short title
- one compact explanatory paragraph

### 3.4 Footer

The footer should expose two links:

- privacy policy
- terms of service

These can initially point to placeholders or existing GeeClaw-owned URLs if available, but they must be isolated in config so the user can swap them later without touching layout markup.

## 4. Visual Direction

The implementation goal is "faithful recreation with clean rebranding," not reinterpretation.

Required qualities:

- preserve the original page's airy light theme, rounded surfaces, and dark CTA buttons
- keep the same section spacing rhythm and centered shell composition
- reproduce the soft glow/background atmosphere behind the hero
- keep button hierarchy and CTA density close to the reference
- use a font stack that visually approximates the reference and works reliably on GitHub Pages

Acceptable deviations:

- GeeClaw naming replaces AutoClaw naming in visible branding and main copy
- minor CSS simplifications are acceptable if the rendered result remains recognizably close
- buttons may use placeholder destinations

## 5. Assets And Links

### 5.1 Image strategy

For the first version, the page may reference the upstream hosted assets directly:

- hero screenshot
- three flow SVGs

This keeps implementation fast and makes later replacement easy. The code should group these URLs in one config block so the user can replace them without searching through the whole file.

### 5.2 Download links

Expose three separate download targets:

- macOS Apple Silicon
- macOS Intel
- Windows

Each CTA should read from a central config object in `app.js`. Initial values should be safe placeholders such as `"#"` or a dedicated placeholder URL string.

### 5.3 Footer links

Privacy and terms links should also read from config for later replacement.

## 6. File Layout

The landing page should use this minimal structure:

- `/Users/lsave/workspace/AI/ClawX/site/index.html`
- `/Users/lsave/workspace/AI/ClawX/site/styles.css`
- `/Users/lsave/workspace/AI/ClawX/site/app.js`

Implementation rules:

- `index.html` contains semantic markup and minimal bootstrapping only
- `styles.css` contains all layout, theme, responsive, and motion rules
- `app.js` owns config injection for downloads, footer links, and optional small behavior such as smooth anchor scrolling

No bundler-specific code should be required for the page to work.

## 7. GitHub Pages Compatibility

The page must be deployable from GitHub Pages `site/` without rewriting paths.

Requirements:

- local CSS/JS references must be relative, not root-absolute
- local images, if added later, should also be referenced relatively
- no code should assume a repo subpath like `/ClawX/`
- the same output should work under both GitHub Pages project URLs and a custom domain like `www.geeclaw.cn`

## 8. Behavior

The page only needs lightweight behavior:

- bind CTA href values from config
- optionally keep the topbar CTA anchored to the hero download region
- no modal, no runtime dialog, no popover

If a placeholder URL is `"#"`, clicking should remain harmless and not throw errors.

## 9. Content Rules

Content should reflect GeeClaw branding.

Specific expectations:

- brand label should say `GeeClaw`
- top-level positioning copy should describe an agent/product experience similar to the reference page
- flow titles and descriptions can stay close to the reference narrative, but should not mention removed features

The design should avoid leaving visible `AutoClaw` references in headings, navigation, CTA text, alt text, or footer copy.

## 10. Verification

Minimum verification for implementation:

- open `site/index.html` locally and confirm the page renders without a build step
- verify desktop layout keeps the two-column hero and three-card flow layout
- verify mobile layout stacks correctly and buttons remain usable
- verify all configurable links are populated from one JS config object
- verify no removed features remain visible

## 11. Docs Review Rule

This work adds a publishable landing page under `site/`, so `README.md` and `README.zh-CN.md` must be reviewed during implementation. Update them only if they should mention GitHub Pages hosting, custom-domain usage, or the new landing-page entry point.
