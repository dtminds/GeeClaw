type WindowLike = {
  loadURL: (url: string) => Promise<unknown>;
  loadFile: (filePath: string) => Promise<unknown>;
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

export async function loadRendererWindow(
  win: WindowLike,
  options: LoadRendererWindowOptions,
): Promise<void> {
  if (options.devServerUrl) {
    await win.webContents.session.clearCache();
    await win.loadURL(options.devServerUrl);
    win.webContents.openDevTools();
    return;
  }

  await win.loadFile(options.distHtmlPath);
}
