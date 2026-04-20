import { readFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';

const scriptPath = path.resolve(process.cwd(), 'site/app.js');
const scriptSource = readFileSync(scriptPath, 'utf8');

function createDom() {
  return new JSDOM(
    `<!doctype html>
    <html>
      <body>
        <a data-download-target="mac-apple-silicon" href="#"></a>
        <a data-download-target="mac-intel" href="#"></a>
        <a data-download-target="windows" href="#"></a>
      </body>
    </html>`,
    {
      runScripts: 'outside-only',
      url: 'https://example.com/',
    },
  );
}

async function runLandingScript(fetchImpl: typeof fetch, now: number) {
  const dom = createDom();
  const fetchMock = vi.fn(fetchImpl);
  const consoleWarn = vi.fn();

  Object.defineProperty(dom.window, 'fetch', {
    value: fetchMock,
    configurable: true,
  });
  Object.defineProperty(dom.window, 'console', {
    value: { ...console, warn: consoleWarn },
    configurable: true,
  });
  Object.defineProperty(dom.window.Date, 'now', {
    value: () => now,
    configurable: true,
  });

  dom.window.eval(scriptSource);
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));

  await Promise.resolve();
  await Promise.resolve();

  return { dom, fetchMock, consoleWarn };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('site landing downloads', () => {
  it('loads latest OSS release-info with a timestamp and updates download links', async () => {
    const { dom, fetchMock, consoleWarn } = await runLandingScript(
      async () => ({
        ok: true,
        json: async () => ({
          downloads: {
            mac: {
              arm64: 'https://geeclaw.dtminds.com/latest/GeeClaw-1.2.3-mac-arm64.dmg',
              x64: 'https://geeclaw.dtminds.com/latest/GeeClaw-1.2.3-mac-x64.dmg',
            },
            win: {
              x64: 'https://geeclaw.dtminds.com/latest/GeeClaw-1.2.3-win-x64.exe',
            },
          },
        }),
      }) as Response,
      1713571200000,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'https://geeclaw.dtminds.com/latest/release-info.json?ts=1713571200000',
      { cache: 'no-store' },
    );
    await vi.waitFor(() => {
      expect(dom.window.document.querySelector('[data-download-target="mac-apple-silicon"]')?.getAttribute('href')).toBe(
        'https://geeclaw.dtminds.com/latest/GeeClaw-1.2.3-mac-arm64.dmg',
      );
    });
    expect(dom.window.document.querySelector('[data-download-target="mac-intel"]')?.getAttribute('href')).toBe(
      'https://geeclaw.dtminds.com/latest/GeeClaw-1.2.3-mac-x64.dmg',
    );
    expect(dom.window.document.querySelector('[data-download-target="windows"]')?.getAttribute('href')).toBe(
      'https://geeclaw.dtminds.com/latest/GeeClaw-1.2.3-win-x64.exe',
    );
    expect(consoleWarn).not.toHaveBeenCalled();
  });

  it('falls back to the GitHub releases page when OSS metadata cannot be loaded', async () => {
    const { dom, consoleWarn } = await runLandingScript(
      async () => {
        throw new Error('network failed');
      },
      1713571200000,
    );

    expect(dom.window.document.querySelector('[data-download-target="mac-apple-silicon"]')?.getAttribute('href')).toBe(
      'https://github.com/dtminds/GeeClaw/releases',
    );
    expect(dom.window.document.querySelector('[data-download-target="mac-intel"]')?.getAttribute('href')).toBe(
      'https://github.com/dtminds/GeeClaw/releases',
    );
    expect(dom.window.document.querySelector('[data-download-target="windows"]')?.getAttribute('href')).toBe(
      'https://github.com/dtminds/GeeClaw/releases',
    );
    expect(consoleWarn).toHaveBeenCalledOnce();
  });
});
