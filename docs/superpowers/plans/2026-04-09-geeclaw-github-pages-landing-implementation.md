# GeeClaw GitHub Pages Landing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a static GitHub Pages landing page under `site/` that closely recreates the AutoClaw reference page, rebrands it for GeeClaw, and keeps images, legal links, and download URLs easy to swap later.

**Architecture:** Keep the landing page isolated from the Electron app by using three plain files: semantic HTML in `site/index.html`, page styling in `site/styles.css`, and centralized asset/link configuration plus small DOM wiring in `site/app.js`. Lock the main behaviors with a Vitest + JSDOM regression test that reads the shipped `site/` files directly.

**Tech Stack:** Static HTML, CSS, vanilla JavaScript, Vitest, JSDOM, Node `fs`

---

## File Map

**Create**
- `site/index.html`
- `site/styles.css`
- `site/app.js`
- `tests/unit/github-pages-landing.test.ts`

**Modify**
- `README.md`
- `README.zh-CN.md`

## Task 1: Red test the landing-page contract

**Files:**
- Create: `tests/unit/github-pages-landing.test.ts`
- Test: `tests/unit/github-pages-landing.test.ts`

- [ ] **Step 1: Write a failing test for the expected markup shell**

```ts
expect(document.querySelector('[data-brand="geeclaw"]')).not.toBeNull();
expect(document.querySelectorAll('[data-download-target]').length).toBe(3);
expect(document.querySelectorAll('.flow-card').length).toBe(3);
```

- [ ] **Step 2: Run the landing-page test to verify it fails**

Run: `pnpm exec vitest run tests/unit/github-pages-landing.test.ts`
Expected: FAIL because `site/index.html` does not exist yet.

- [ ] **Step 3: Extend the test to cover config-driven link and asset hydration**

```ts
expect(macLink?.getAttribute('href')).toBe('#download-mac-apple-silicon');
expect(heroImage?.getAttribute('src')).toContain('AutoClaw_workspace_preview_img');
expect(privacyLink?.getAttribute('href')).toBe('#privacy-policy');
```

- [ ] **Step 4: Re-run the landing-page test to keep it red**

Run: `pnpm exec vitest run tests/unit/github-pages-landing.test.ts`
Expected: FAIL because the page and config script still do not exist.

## Task 2: Implement the static page files

**Files:**
- Create: `site/index.html`
- Create: `site/styles.css`
- Create: `site/app.js`
- Test: `tests/unit/github-pages-landing.test.ts`

- [ ] **Step 1: Add semantic HTML matching the approved page structure**

```html
<header class="topbar">
  <a class="brand" data-brand="geeclaw" href="#page-top">...</a>
  <a class="topbar-link" href="#downloads">下载体验</a>
</header>
<main class="hero" id="page-top">...</main>
<section class="flow-section">...</section>
<footer>...</footer>
```

- [ ] **Step 2: Add centralized config-driven DOM wiring**

```js
const landingConfig = {
  downloads: {
    macAppleSilicon: '#download-mac-apple-silicon',
    macIntel: '#download-mac-intel',
    windows: '#download-windows',
  },
  assets: {
    hero: 'https://autoglm.zhipuai.cn/autoclaw/assets/AutoClaw_workspace_preview_img-C24yx-a3.png',
  },
};
```

- [ ] **Step 3: Add the page styling for hero, glow, cards, and responsive layout**

```css
.page-shell { width: min(calc(100% - 48px), 1296px); margin: 0 auto; }
.hero { padding-top: 146px; }
.flow-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); }
@media (max-width: 740px) { .flow-grid { grid-template-columns: 1fr; } }
```

- [ ] **Step 4: Run the landing-page test to verify it passes**

Run: `pnpm exec vitest run tests/unit/github-pages-landing.test.ts`
Expected: PASS

## Task 3: Review docs and publishability details

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`

- [ ] **Step 1: Add a short section describing the `site/` landing page**

```md
### GitHub Pages Landing Page

The repository includes a static landing page under `site/`.
```

- [ ] **Step 2: Mention the GitHub Pages publishing source and custom-domain compatibility**

```md
Publish the `site/` directory with GitHub Pages. The page uses relative local paths so it works under both a project URL and a custom domain.
```

- [ ] **Step 3: Run the landing-page test again after doc edits**

Run: `pnpm exec vitest run tests/unit/github-pages-landing.test.ts`
Expected: PASS

## Task 4: Final verification

**Files:**
- Verify: `site/index.html`
- Verify: `site/styles.css`
- Verify: `site/app.js`
- Verify: `tests/unit/github-pages-landing.test.ts`
- Verify: `README.md`
- Verify: `README.zh-CN.md`

- [ ] **Step 1: Run the focused landing-page regression test**

Run: `pnpm exec vitest run tests/unit/github-pages-landing.test.ts`
Expected: PASS

- [ ] **Step 2: Run a local static build smoke check**

Run: `pnpm run build:vite`
Expected: PASS, confirming the repo still builds after adding `site/` assets.

- [ ] **Step 3: Review changed files for scope**

Run: `git diff -- site/index.html site/styles.css site/app.js tests/unit/github-pages-landing.test.ts README.md README.zh-CN.md`
Expected: only the landing page, test, and README changes appear.
