import { describe, expect, it, vi } from 'vitest';

describe('renderer loader', () => {
  it('clears the session cache before loading the dev server URL', async () => {
    const events: string[] = [];
    const clearCache = vi.fn(async () => {
      events.push('clearCache');
    });
    const loadURL = vi.fn(async () => {
      events.push('loadURL');
    });

    const { loadRendererWindow } = await import('@electron/main/renderer-loader');

    await loadRendererWindow(
      {
        loadURL,
        loadFile: vi.fn(),
        webContents: {
          openDevTools: vi.fn(),
          session: { clearCache },
        },
      },
      {
        devServerUrl: 'http://localhost:5173',
        distHtmlPath: '/tmp/dist/index.html',
      },
    );

    expect(clearCache).toHaveBeenCalledTimes(1);
    expect(loadURL).toHaveBeenCalledWith('http://localhost:5173');
    expect(events).toEqual(['clearCache', 'loadURL']);
  });

  it('loads the built renderer file outside dev mode', async () => {
    const loadFile = vi.fn(async () => {});

    const { loadRendererWindow } = await import('@electron/main/renderer-loader');

    await loadRendererWindow(
      {
        loadURL: vi.fn(),
        loadFile,
        webContents: {
          openDevTools: vi.fn(),
          session: { clearCache: vi.fn(async () => {}) },
        },
      },
      {
        devServerUrl: undefined,
        distHtmlPath: '/tmp/dist/index.html',
      },
    );

    expect(loadFile).toHaveBeenCalledWith('/tmp/dist/index.html');
  });
});
