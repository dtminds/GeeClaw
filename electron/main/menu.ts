/**
 * Application Menu Configuration
 * Creates the native application menu for macOS/Windows/Linux
 */
import { Menu, app, shell, BrowserWindow } from 'electron';
import { getSetting } from '../utils/store';

type MenuTranslationKey =
  | 'preferences'
  | 'file'
  | 'newChat'
  | 'view'
  | 'navigate'
  | 'dashboard'
  | 'channels'
  | 'skills'
  | 'cronTasks'
  | 'settings'
  | 'window'
  | 'documentation'
  | 'reportIssue'
  | 'openClawDocumentation';

const menuTranslations: Record<'en' | 'zh', Record<MenuTranslationKey, string>> = {
  en: {
    preferences: 'Preferences...',
    file: 'File',
    newChat: 'New Chat',
    view: 'View',
    navigate: 'Navigate',
    dashboard: 'Dashboard',
    channels: 'Channels',
    skills: 'Skills',
    cronTasks: 'Cron Tasks',
    settings: 'Settings',
    window: 'Window',
    documentation: 'Documentation',
    reportIssue: 'Report Issue',
    openClawDocumentation: 'OpenClaw Documentation',
  },
  zh: {
    preferences: '偏好设置...',
    file: '文件',
    newChat: '新对话',
    view: '视图',
    navigate: '导航',
    dashboard: '广场',
    channels: '聊天频道',
    skills: '技能',
    cronTasks: '自动化',
    settings: '设置',
    window: '窗口',
    documentation: '文档',
    reportIssue: '反馈问题',
    openClawDocumentation: 'OpenClaw 文档',
  },
};

function getMenuTranslations(language: string): Record<MenuTranslationKey, string> {
  return language.toLowerCase().startsWith('zh') ? menuTranslations.zh : menuTranslations.en;
}

/**
 * Create application menu
 */
export async function createMenu(): Promise<void> {
  const isMac = process.platform === 'darwin';
  const translations = getMenuTranslations(await getSetting('language'));
  
  const template: Electron.MenuItemConstructorOptions[] = [
    // App menu (macOS only)
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              {
                label: translations.preferences,
                accelerator: 'Cmd+,',
                click: () => {
                  const win = BrowserWindow.getFocusedWindow();
                  win?.webContents.send('navigate', '/settings/appearance');
                },
              },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const },
            ],
          },
        ]
      : []),
    
    // File menu
    {
      label: translations.file,
      submenu: [
        {
          label: translations.newChat,
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            win?.webContents.send('navigate', '/chat');
          },
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    
    // Edit menu
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        ...(isMac
          ? [
              { role: 'pasteAndMatchStyle' as const },
              { role: 'delete' as const },
              { role: 'selectAll' as const },
            ]
          : [
              { role: 'delete' as const },
              { type: 'separator' as const },
              { role: 'selectAll' as const },
            ]),
      ],
    },
    
    // View menu
    {
      label: translations.view,
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    
    // Navigate menu
    {
      label: translations.navigate,
      submenu: [
        {
          label: translations.dashboard,
          accelerator: 'CmdOrCtrl+1',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            win?.webContents.send('navigate', '/dashboard');
          },
        },
        {
          label: translations.channels,
          accelerator: 'CmdOrCtrl+3',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            win?.webContents.send('navigate', '/channels');
          },
        },
        {
          label: translations.skills,
          accelerator: 'CmdOrCtrl+4',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            win?.webContents.send('navigate', '/skills');
          },
        },
        {
          label: translations.cronTasks,
          accelerator: 'CmdOrCtrl+5',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            win?.webContents.send('navigate', '/cron');
          },
        },
        {
          label: translations.settings,
          accelerator: isMac ? 'Cmd+,' : 'Ctrl+,',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            win?.webContents.send('navigate', '/settings/appearance');
          },
        },
      ],
    },
    
    // Window menu
    {
      label: translations.window,
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac
          ? [
              { type: 'separator' as const },
              { role: 'front' as const },
              { type: 'separator' as const },
              { role: 'window' as const },
            ]
          : [{ role: 'close' as const }]),
      ],
    },
    
    // Help menu
    {
      role: 'help',
      submenu: [
        {
          label: translations.documentation,
          click: async () => {
            await shell.openExternal('https://www.iyouke.com');
          },
        },
        {
          label: translations.reportIssue,
          click: async () => {
            await shell.openExternal('https://github.com/dtminds/GeeClaw/issues');
          },
        },
        { type: 'separator' },
        {
          label: translations.openClawDocumentation,
          click: async () => {
            await shell.openExternal('https://docs.openclaw.ai');
          },
        },
      ],
    },
  ];
  
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}
