import { BrowserWindow, screen } from 'electron';
import { join } from 'node:path';
import type { QuickActionContext } from '@shared/quick-actions';

const QUICK_ACTION_WINDOW_WIDTH = 420;
const QUICK_ACTION_WINDOW_HEIGHT = 320;
const QUICK_ACTION_WINDOW_OFFSET = 12;
const QUICK_ACTION_ROUTE = '/quick-action';

export function createQuickActionWindow(): BrowserWindow {
  return new BrowserWindow({
    width: QUICK_ACTION_WINDOW_WIDTH,
    height: QUICK_ACTION_WINDOW_HEIGHT,
    show: false,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false,
    },
  });
}

function clampWindowPosition(bounds: Electron.Rectangle, width: number, height: number, cursor: Electron.Point) {
  const minX = bounds.x;
  const minY = bounds.y;
  const maxX = bounds.x + bounds.width - width;
  const maxY = bounds.y + bounds.height - height;

  return {
    x: Math.min(Math.max(cursor.x + QUICK_ACTION_WINDOW_OFFSET, minX), maxX),
    y: Math.min(Math.max(cursor.y + QUICK_ACTION_WINDOW_OFFSET, minY), maxY),
  };
}

export function createQuickActionWindowController() {
  let quickActionWindow: BrowserWindow | null = null;
  let windowReady: Promise<void> | null = null;

  const ensureWindow = async (): Promise<BrowserWindow> => {
    if (quickActionWindow && !quickActionWindow.isDestroyed()) {
      return quickActionWindow;
    }

    quickActionWindow = createQuickActionWindow();
    if (process.env.VITE_DEV_SERVER_URL) {
      const quickActionUrl = new URL(process.env.VITE_DEV_SERVER_URL);
      quickActionUrl.hash = QUICK_ACTION_ROUTE;
      windowReady = quickActionWindow.loadURL(quickActionUrl.toString()).then(() => undefined);
    } else {
      windowReady = quickActionWindow
        .loadFile(join(__dirname, '../../dist/index.html'), { hash: QUICK_ACTION_ROUTE })
        .then(() => undefined);
    }

    quickActionWindow.on('closed', () => {
      quickActionWindow = null;
      windowReady = null;
    });
    quickActionWindow.on('blur', () => {
      quickActionWindow?.hide();
    });

    return quickActionWindow;
  };

  return {
    async show(payload: QuickActionContext): Promise<void> {
      const win = await ensureWindow();
      if (windowReady) {
        await windowReady;
      }

      const cursor = screen.getCursorScreenPoint();
      const display = screen.getDisplayNearestPoint(cursor);
      const position = clampWindowPosition(
        display.workArea,
        QUICK_ACTION_WINDOW_WIDTH,
        QUICK_ACTION_WINDOW_HEIGHT,
        cursor,
      );

      win.setPosition(position.x, position.y);
      win.webContents.send('quickAction:invoked', payload);
      win.show();
      win.focus();
    },
    getWindow(): BrowserWindow | null {
      return quickActionWindow && !quickActionWindow.isDestroyed() ? quickActionWindow : null;
    },
  };
}
