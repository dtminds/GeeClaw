/**
 * Vitest Test Setup
 * Global test configuration and mocks
 */
import { vi } from 'vitest';
import '@testing-library/jest-dom';

function createStorage() {
  let store = new Map<string, string>();

  return {
    get length() {
      return store.size;
    },
    clear() {
      store = new Map<string, string>();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(String(key), String(value));
    },
  };
}

vi.mock('electron', () => {
  const browserWindowInstance = {
    loadURL: vi.fn(),
    loadFile: vi.fn(),
    show: vi.fn(),
    hide: vi.fn(),
    close: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
    webContents: {
      send: vi.fn(),
      openDevTools: vi.fn(),
      on: vi.fn(),
      once: vi.fn(),
    },
  };

  return {
    app: {
      isPackaged: false,
      getAppPath: vi.fn(() => '/Users/lsave/workspace/AI/ClawX'),
      getPath: vi.fn((name: string) => `/tmp/geeclaw-${name}`),
      getVersion: vi.fn(() => '0.0.0-test'),
      whenReady: vi.fn(async () => {}),
      on: vi.fn(),
      once: vi.fn(),
      quit: vi.fn(),
      relaunch: vi.fn(),
    },
    BrowserWindow: vi.fn(() => browserWindowInstance),
    Menu: {
      buildFromTemplate: vi.fn(() => ({})),
      setApplicationMenu: vi.fn(),
    },
    Tray: vi.fn(() => ({
      setToolTip: vi.fn(),
      setContextMenu: vi.fn(),
      on: vi.fn(),
      destroy: vi.fn(),
    })),
    dialog: {
      showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })),
      showSaveDialog: vi.fn(async () => ({ canceled: true, filePath: undefined })),
      showMessageBox: vi.fn(async () => ({ response: 0 })),
    },
    nativeImage: {
      createFromPath: vi.fn(() => ({ isEmpty: () => false })),
      createFromDataURL: vi.fn(() => ({ isEmpty: () => false })),
      createEmpty: vi.fn(() => ({ isEmpty: () => true })),
    },
    safeStorage: {
      isEncryptionAvailable: vi.fn(() => false),
      encryptString: vi.fn((value: string) => Buffer.from(value, 'utf8')),
      decryptString: vi.fn((value: Buffer) => value.toString('utf8')),
    },
    screen: {
      getPrimaryDisplay: vi.fn(() => ({ workAreaSize: { width: 1440, height: 900 } })),
    },
    session: {
      defaultSession: {
        setProxy: vi.fn(async () => {}),
        resolveProxy: vi.fn(async () => 'DIRECT'),
      },
    },
    shell: {
      openExternal: vi.fn(async () => {}),
    },
    ipcMain: {
      handle: vi.fn(),
      on: vi.fn(),
      once: vi.fn(),
      removeHandler: vi.fn(),
      removeAllListeners: vi.fn(),
    },
    ipcRenderer: {
      invoke: vi.fn(),
      on: vi.fn(),
      once: vi.fn(),
      off: vi.fn(),
      send: vi.fn(),
    },
    contextBridge: {
      exposeInMainWorld: vi.fn(),
    },
    utilityProcess: {
      fork: vi.fn(),
    },
  };
});

// Mock window.electron API
const mockElectron = {
  ipcRenderer: {
    invoke: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
    off: vi.fn(),
  },
  openExternal: vi.fn(),
  platform: 'darwin',
  isDev: true,
};

Object.defineProperty(window, 'electron', {
  value: mockElectron,
  writable: true,
});

const localStorageMock = createStorage();
const sessionStorageMock = createStorage();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
  writable: true,
  configurable: true,
});

Object.defineProperty(window, 'sessionStorage', {
  value: sessionStorageMock,
  writable: true,
  configurable: true,
});

Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  writable: true,
  configurable: true,
});

Object.defineProperty(globalThis, 'sessionStorage', {
  value: sessionStorageMock,
  writable: true,
  configurable: true,
});

// Mock matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Reset mocks after each test
afterEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
});
