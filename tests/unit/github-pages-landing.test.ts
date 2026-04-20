import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { vi } from 'vitest';

function loadLandingPage() {
  const htmlPath = resolve(process.cwd(), 'site/index.html');
  const scriptPath = resolve(process.cwd(), 'site/app.js');
  const html = readFileSync(htmlPath, 'utf8');
  const script = readFileSync(scriptPath, 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    url: 'https://example.com/',
  });

  Object.defineProperty(dom.window, 'fetch', {
    value: vi.fn(async () => {
      throw new Error('network disabled in test');
    }),
    configurable: true,
  });
  Object.defineProperty(dom.window, 'console', {
    value: { ...console, warn: vi.fn() },
    configurable: true,
  });

  dom.window.eval(script);
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded', { bubbles: true }));

  return dom.window.document;
}

describe('GitHub Pages landing page', () => {
  test('ships the approved GeeClaw page structure', () => {
    const document = loadLandingPage();

    expect(document.querySelector('[data-brand="geeclaw"]')).not.toBeNull();
    expect(document.querySelectorAll('[data-download-target]').length).toBe(3);
    expect(document.querySelectorAll('.flow-card').length).toBe(9);
    expect(document.querySelector('[data-hero-image]')).not.toBeNull();
  });

  test('hydrates download, legal, and borrowed image URLs from config', () => {
    const document = loadLandingPage();

    const macLink = document.querySelector('[data-download-target="mac-apple-silicon"]');
    const intelLink = document.querySelector('[data-download-target="mac-intel"]');
    const winLink = document.querySelector('[data-download-target="windows"]');
    const heroImage = document.querySelector<HTMLImageElement>('[data-hero-image]');

    expect(macLink?.getAttribute('href')).toBe('https://github.com/dtminds/GeeClaw/releases');
    expect(intelLink?.getAttribute('href')).toBe('https://github.com/dtminds/GeeClaw/releases');
    expect(winLink?.getAttribute('href')).toBe('https://github.com/dtminds/GeeClaw/releases');
    expect(heroImage?.getAttribute('src')).toBe('./res/main.png');
  });
});
