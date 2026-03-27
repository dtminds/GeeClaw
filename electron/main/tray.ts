/**
 * System Tray Management
 * Creates and manages the system tray icon and menu
 */
import { Tray, Menu, BrowserWindow, app, nativeImage } from 'electron';
import { join } from 'path';

let tray: Tray | null = null;
let mainWindowRef: BrowserWindow | null = null;

export interface TrayTranslations {
  tooltipRunning: string;
  tooltipStopped: string;
  show: string;
  gatewayStatus: string;
  running: string;
  stopped: string;
  quickActions: string;
  openChat: string;
  openSettings: string;
  checkUpdates: string;
  quit: string;
}

const defaultTranslations: TrayTranslations = {
  tooltipRunning: 'GeeClaw - Gateway Running',
  tooltipStopped: 'GeeClaw - Gateway Stopped',
  show: 'Show GeeClaw',
  gatewayStatus: 'Gateway Status',
  running: 'Running',
  stopped: 'Stopped',
  quickActions: 'Quick Actions',
  openChat: 'Open Chat',
  openSettings: 'Open Settings',
  checkUpdates: 'Check for Updates...',
  quit: 'Quit GeeClaw',
};

let currentTranslations: TrayTranslations = defaultTranslations;

/**
 * Resolve the icons directory path (works in both dev and packaged mode)
 */
function getIconsDir(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'resources', 'icons');
  }
  return join(__dirname, '../../resources/icons');
}

function revealMainWindow(): void {
  if (!mainWindowRef || mainWindowRef.isDestroyed()) return;
  if (mainWindowRef.isMinimized()) {
    mainWindowRef.restore();
  }
  if (!mainWindowRef.isVisible()) {
    mainWindowRef.show();
  }
  mainWindowRef.focus();
}

function buildContextMenu(translations: TrayTranslations, gatewayRunning: boolean): Electron.Menu {
  const showWindow = () => {
    revealMainWindow();
  };

  return Menu.buildFromTemplate([
    {
      label: translations.show,
      click: showWindow,
    },
    {
      type: 'separator',
    },
    {
      label: translations.gatewayStatus,
      enabled: false,
    },
    {
      label: `  ${gatewayRunning ? translations.running : translations.stopped}`,
      type: 'checkbox',
      checked: gatewayRunning,
      enabled: false,
    },
    {
      type: 'separator',
    },
    {
      label: translations.quickActions,
      submenu: [
        {
          label: translations.openChat,
          click: () => {
            revealMainWindow();
            if (!mainWindowRef || mainWindowRef.isDestroyed()) return;
            mainWindowRef.webContents.send('navigate', '/');
          },
        },
        {
          label: translations.openSettings,
          click: () => {
            revealMainWindow();
            if (!mainWindowRef || mainWindowRef.isDestroyed()) return;
            mainWindowRef.webContents.send('navigate', '/settings/appearance');
          },
        },
      ],
    },
    {
      type: 'separator',
    },
    {
      label: translations.checkUpdates,
      click: () => {
        revealMainWindow();
        if (!mainWindowRef || mainWindowRef.isDestroyed()) return;
        mainWindowRef.webContents.send('navigate', '/settings/general');
      },
    },
    {
      type: 'separator',
    },
    {
      label: translations.quit,
      click: () => {
        app.quit();
      },
    },
  ]);
}

/**
 * Create system tray icon and menu
 */
export function createTray(mainWindow: BrowserWindow): Tray {
  mainWindowRef = mainWindow;

  // Use platform-appropriate icon for system tray
  const iconsDir = getIconsDir();
  let iconPath: string;

  if (process.platform === 'win32') {
    // Windows: use .ico for best quality in system tray
    iconPath = join(iconsDir, 'icon.ico');
  } else if (process.platform === 'darwin') {
    // macOS: use Template.png for proper status bar icon
    // The "Template" suffix tells macOS to treat it as a template image
    iconPath = join(iconsDir, 'tray-icon-Template.png');
  } else {
    // Linux: use 32x32 PNG
    iconPath = join(iconsDir, '32x32.png');
  }

  let icon = nativeImage.createFromPath(iconPath);

  // Fallback to icon.png if platform-specific icon not found
  if (icon.isEmpty()) {
    icon = nativeImage.createFromPath(join(iconsDir, 'icon.png'));
    // Still try to set as template for macOS
    if (process.platform === 'darwin') {
      icon.setTemplateImage(true);
    }
  }

  // Note: Using "Template" suffix in filename automatically marks it as template image
  // But we can also explicitly set it for safety
  if (process.platform === 'darwin') {
    icon.setTemplateImage(true);
  }
  
  tray = new Tray(icon);
  
  tray.setToolTip(defaultTranslations.tooltipStopped);
  tray.setContextMenu(buildContextMenu(defaultTranslations, false));
  
  // Tray activation should only bring the app to the foreground.
  tray.on('click', () => {
    revealMainWindow();
  });
  
  // Double-click also foregrounds the window on platforms that emit it.
  tray.on('double-click', () => {
    revealMainWindow();
  });
  
  return tray;
}

/**
 * Update tray menu text and status after renderer language changes.
 */
export function updateTrayMenu(translations: TrayTranslations, gatewayRunning: boolean): void {
  if (!tray) return;

  currentTranslations = translations;
  tray.setToolTip(gatewayRunning ? translations.tooltipRunning : translations.tooltipStopped);
  tray.setContextMenu(buildContextMenu(translations, gatewayRunning));
}

/**
 * Update tray tooltip with Gateway status
 */
export function updateTrayStatus(status: string): void {
  if (!tray) return;

  const isRunning = status === 'running';
  tray.setToolTip(isRunning ? currentTranslations.tooltipRunning : currentTranslations.tooltipStopped);
  tray.setContextMenu(buildContextMenu(currentTranslations, isRunning));
}

/**
 * Destroy tray icon
 */
export function destroyTray(): void {
  if (tray) {
    tray.destroy();
    tray = null;
    mainWindowRef = null;
  }
}
