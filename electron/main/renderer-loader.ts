import { pathToFileURL } from 'node:url';

type WindowLike = {
  loadURL: (url: string) => Promise<unknown>;
  webContents: {
    openDevTools: () => void;
    session: {
      clearCache: () => Promise<void>;
    };
  };
};

type LoadRendererWindowOptions = {
  devServerUrl?: string;
  distHtmlPath: string;
};

function buildRendererUrl(baseUrl: string): string {
  const url = new URL(baseUrl);

  if (process.env.GEECLAW_E2E === '1') {
    url.searchParams.set('e2e', '1');
    url.searchParams.set('skipSetup', '1');
    url.searchParams.set('skipLogin', '1');
    url.searchParams.set('skipProvider', '1');
  }

  return url.toString();
}

export async function loadRendererWindow(
  win: WindowLike,
  options: LoadRendererWindowOptions,
): Promise<void> {
  if (options.devServerUrl) {
    await win.webContents.session.clearCache();
    await win.loadURL(buildRendererUrl(options.devServerUrl));
    win.webContents.openDevTools();
    return;
  }

  await win.loadURL(buildRendererUrl(pathToFileURL(options.distHtmlPath).toString()));
}
