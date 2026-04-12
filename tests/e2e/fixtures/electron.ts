import electronBinaryPath from 'electron';
import { _electron as electron, expect, test as base, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

type ElectronFixtures = {
  electronApp: ElectronApplication;
  page: Page;
  homeDir: string;
  userDataDir: string;
};

const repoRoot = resolve(process.cwd());
const electronEntry = join(repoRoot, 'dist-electron/main/index.js');

async function getStableWindow(app: ElectronApplication): Promise<Page> {
  const deadline = Date.now() + 30_000;
  let page = await app.firstWindow();

  while (Date.now() < deadline) {
    const openWindows = app.windows().filter((candidate) => !candidate.isClosed());
    const currentWindow = openWindows.at(-1) ?? page;

    if (currentWindow && !currentWindow.isClosed()) {
      try {
        await currentWindow.waitForLoadState('domcontentloaded', { timeout: 2_000 });
        return currentWindow;
      } catch (error) {
        if (!String(error).includes('has been closed')) {
          throw error;
        }
      }
    }

    try {
      page = await app.waitForEvent('window', { timeout: 2_000 });
    } catch {
      // Keep polling until a stable window is available or the deadline expires.
    }
  }

  throw new Error('No stable Electron window became available');
}

async function closeElectronApp(app: ElectronApplication, timeoutMs = 5_000): Promise<void> {
  let closed = false;

  await Promise.race([
    (async () => {
      const [closeResult] = await Promise.allSettled([
        app.waitForEvent('close', { timeout: timeoutMs }),
        app.evaluate(({ app: electronApp }) => {
          electronApp.quit();
        }),
      ]);

      if (closeResult.status === 'fulfilled') {
        closed = true;
      }
    })(),
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ]);

  if (closed) {
    return;
  }

  try {
    await app.close();
    return;
  } catch {
    // Fall through to process kill if Playwright cannot close the app cleanly.
  }

  try {
    app.process().kill('SIGKILL');
  } catch {
    // Ignore process kill failures during e2e teardown.
  }
}

export const test = base.extend<ElectronFixtures>({
  homeDir: async ({ browserName: _browserName }, provideHomeDir) => {
    const homeDir = await mkdtemp(join(tmpdir(), 'geeclaw-e2e-home-'));
    await mkdir(join(homeDir, '.config'), { recursive: true });
    await mkdir(join(homeDir, 'AppData', 'Local'), { recursive: true });
    await mkdir(join(homeDir, 'AppData', 'Roaming'), { recursive: true });
    try {
      await provideHomeDir(homeDir);
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  },

  userDataDir: async ({ browserName: _browserName }, provideUserDataDir) => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'geeclaw-e2e-user-data-'));
    try {
      await provideUserDataDir(userDataDir);
    } finally {
      await rm(userDataDir, { recursive: true, force: true });
    }
  },

  electronApp: async ({ homeDir, userDataDir }, provideElectronApp) => {
    const electronEnv = process.platform === 'linux'
      ? { ELECTRON_DISABLE_SANDBOX: '1' }
      : {};

    const app = await electron.launch({
      executablePath: electronBinaryPath,
      args: [electronEntry],
      env: {
        ...process.env,
        ...electronEnv,
        GEECLAW_E2E: '1',
        GEECLAW_USE_PREBUILT_OPENCLAW_SIDECAR: '1',
        GEECLAW_USER_DATA_DIR: userDataDir,
        HOME: homeDir,
        USERPROFILE: homeDir,
        APPDATA: join(homeDir, 'AppData', 'Roaming'),
        LOCALAPPDATA: join(homeDir, 'AppData', 'Local'),
        XDG_CONFIG_HOME: join(homeDir, '.config'),
      },
      timeout: 120_000,
    });

    let appClosed = false;
    app.once('close', () => {
      appClosed = true;
    });

    try {
      await provideElectronApp(app);
    } finally {
      if (!appClosed) {
        await closeElectronApp(app);
      }
    }
  },

  page: async ({ electronApp }, providePage) => {
    const page = await getStableWindow(electronApp);
    await providePage(page);
  },
});

export { expect };
