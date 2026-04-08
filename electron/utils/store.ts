/**
 * Persistent Storage
 * Electron-store wrapper for application settings
 */

import { randomBytes } from 'crypto';

// Lazy-load electron-store (ESM module)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let settingsStoreInstance: any = null;

/**
 * Generate a random token for gateway authentication
 */
function generateToken(): string {
  return `geeclaw-${randomBytes(16).toString('hex')}`;
}

/**
 * Application settings schema
 */
export interface AppSettings {
  // General
  theme: 'light' | 'dark' | 'system';
  colorTheme: string;
  language: string;
  startMinimized: boolean;
  launchAtStartup: boolean;

  // Safety
  toolPermission: 'default' | 'strict' | 'full';
  approvalPolicy: 'allowlist' | 'full';
  
  // Gateway
  gatewayAutoStart: boolean;
  gatewayPort: number;
  gatewayToken: string;
  proxyEnabled: boolean;
  proxyServer: string;
  proxyHttpServer: string;
  proxyHttpsServer: string;
  proxyAllServer: string;
  proxyBypassRules: string;
  
  // Update
  updateChannel: 'stable' | 'beta' | 'dev';
  autoCheckUpdate: boolean;
  autoDownloadUpdate: boolean;
  skippedVersions: string[];
  
  // UI State
  sidebarCollapsed: boolean;
  devModeUnlocked: boolean;
  
  // Presets
  selectedBundles: string[];
  enabledSkills: string[];
  disabledSkills: string[];
}

/**
 * Default settings
 */
const defaults: AppSettings = {
  // General
  theme: 'system',
  colorTheme: 'standard',
  language: 'zh',
  startMinimized: false,
  launchAtStartup: false,

  // Safety
  toolPermission: 'default',
  approvalPolicy: 'full',
  
  // Gateway
  gatewayAutoStart: true,
  gatewayPort: 28788,
  gatewayToken: generateToken(),
  proxyEnabled: false,
  proxyServer: '',
  proxyHttpServer: '',
  proxyHttpsServer: '',
  proxyAllServer: '',
  proxyBypassRules: '<local>;localhost;127.0.0.1;::1',
  
  // Update
  updateChannel: 'stable',
  autoCheckUpdate: true,
  autoDownloadUpdate: false,
  skippedVersions: [],
  
  // UI State
  sidebarCollapsed: false,
  devModeUnlocked: false,
  
  // Presets
  selectedBundles: ['productivity', 'developer'],
  enabledSkills: [],
  disabledSkills: [],
};

/**
 * Get the settings store instance (lazy initialization)
 */
async function getSettingsStore() {
  if (!settingsStoreInstance) {
    const Store = (await import('electron-store')).default;
    settingsStoreInstance = new Store<AppSettings>({
      name: 'settings',
      defaults,
    });
    settingsStoreInstance.delete?.('openclawRuntimeSource');
  }
  return settingsStoreInstance;
}

/**
 * Get a setting value
 */
export async function getSetting<K extends keyof AppSettings>(key: K): Promise<AppSettings[K]> {
  const store = await getSettingsStore();
  return store.get(key);
}

/**
 * Set a setting value
 */
export async function setSetting<K extends keyof AppSettings>(
  key: K,
  value: AppSettings[K]
): Promise<void> {
  const store = await getSettingsStore();
  store.set(key, value);
}

function normalizeSkillKeyList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(new Set(
    value
      .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
      .filter(Boolean),
  ));
}

export async function getExplicitSkillToggles(): Promise<{
  enabledSkills: string[];
  disabledSkills: string[];
}> {
  const store = await getSettingsStore();
  return {
    enabledSkills: normalizeSkillKeyList(store.get('enabledSkills')),
    disabledSkills: normalizeSkillKeyList(store.get('disabledSkills')),
  };
}

export async function setExplicitSkillToggle(skillKey: string, enabled: boolean): Promise<void> {
  const normalizedSkillKey = skillKey.trim();
  if (!normalizedSkillKey) {
    return;
  }

  const store = await getSettingsStore();
  const currentEnabled = new Set(normalizeSkillKeyList(store.get('enabledSkills')));
  const currentDisabled = new Set(normalizeSkillKeyList(store.get('disabledSkills')));

  if (enabled) {
    currentEnabled.add(normalizedSkillKey);
    currentDisabled.delete(normalizedSkillKey);
  } else {
    currentDisabled.add(normalizedSkillKey);
    currentEnabled.delete(normalizedSkillKey);
  }

  store.set('enabledSkills', Array.from(currentEnabled));
  store.set('disabledSkills', Array.from(currentDisabled));
}

/**
 * Get all settings
 */
export async function getAllSettings(): Promise<AppSettings> {
  const store = await getSettingsStore();
  return store.store;
}

/**
 * Reset settings to defaults
 */
export async function resetSettings(): Promise<void> {
  const store = await getSettingsStore();
  store.clear();
}

/**
 * Export settings to JSON
 */
export async function exportSettings(): Promise<string> {
  const store = await getSettingsStore();
  return JSON.stringify(store.store, null, 2);
}

/**
 * Import settings from JSON
 */
export async function importSettings(json: string): Promise<void> {
  try {
    const settings = JSON.parse(json);
    const store = await getSettingsStore();
    store.set(settings);
  } catch {
    throw new Error('Invalid settings JSON');
  }
}
