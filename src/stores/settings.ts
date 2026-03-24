/**
 * Settings State Store
 * Manages application settings
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import i18n from '@/i18n';
import { hostApiFetch } from '@/lib/host-api';
import { DEFAULT_COLOR_THEME_ID, type ColorTheme } from '@/theme/color-themes';

type Theme = 'light' | 'dark' | 'system';
type UpdateChannel = 'stable' | 'beta' | 'dev';
export type SecurityPolicy = 'moderate' | 'strict' | 'fullAccess';
export type { ColorTheme } from '@/theme/color-themes';

interface SettingsState {
  // General
  theme: Theme;
  colorTheme: ColorTheme;
  language: string;
  startMinimized: boolean;
  launchAtStartup: boolean;

  // Safety
  workspaceOnly: boolean;
  securityPolicy: SecurityPolicy;

  // Gateway
  gatewayAutoStart: boolean;
  gatewayPort: number;
  proxyEnabled: boolean;
  proxyServer: string;
  proxyHttpServer: string;
  proxyHttpsServer: string;
  proxyAllServer: string;
  proxyBypassRules: string;

  // Update
  updateChannel: UpdateChannel;
  autoCheckUpdate: boolean;
  autoDownloadUpdate: boolean;

  // UI State
  sidebarCollapsed: boolean;
  chatSessionsPanelCollapsed: boolean;
  devModeUnlocked: boolean;

  // Setup
  setupComplete: boolean;

  // Actions
  init: () => Promise<void>;
  setTheme: (theme: Theme) => void;
  setColorTheme: (colorTheme: ColorTheme) => void;
  setLanguage: (language: string) => void;
  setStartMinimized: (value: boolean) => void;
  setLaunchAtStartup: (value: boolean) => void;
  setWorkspaceOnly: (value: boolean) => void;
  setSecurityPolicy: (value: SecurityPolicy) => void;
  setGatewayAutoStart: (value: boolean) => void;
  setGatewayPort: (port: number) => void;
  setProxyEnabled: (value: boolean) => void;
  setProxyServer: (value: string) => void;
  setProxyHttpServer: (value: string) => void;
  setProxyHttpsServer: (value: string) => void;
  setProxyAllServer: (value: string) => void;
  setProxyBypassRules: (value: string) => void;
  setUpdateChannel: (channel: UpdateChannel) => void;
  setAutoCheckUpdate: (value: boolean) => void;
  setAutoDownloadUpdate: (value: boolean) => void;
  setSidebarCollapsed: (value: boolean) => void;
  setChatSessionsPanelCollapsed: (value: boolean) => void;
  setDevModeUnlocked: (value: boolean) => void;
  markSetupComplete: () => void;
  resetSettings: () => void;
}

const defaultSettings = {
  theme: 'system' as Theme,
  colorTheme: DEFAULT_COLOR_THEME_ID,
  language: 'zh',
  startMinimized: false,
  launchAtStartup: false,
  workspaceOnly: false,
  securityPolicy: 'moderate' as SecurityPolicy,
  gatewayAutoStart: true,
  gatewayPort: 28788,
  proxyEnabled: false,
  proxyServer: '',
  proxyHttpServer: '',
  proxyHttpsServer: '',
  proxyAllServer: '',
  proxyBypassRules: '<local>;localhost;127.0.0.1;::1',
  updateChannel: 'stable' as UpdateChannel,
  autoCheckUpdate: true,
  autoDownloadUpdate: false,
  sidebarCollapsed: false,
  chatSessionsPanelCollapsed: false,
  devModeUnlocked: false,
  setupComplete: false,
};

function persistSettingValue(key: string, value: unknown): void {
  void hostApiFetch(`/api/settings/${key}`, {
    method: 'PUT',
    body: JSON.stringify({ value }),
  }).catch(() => {});
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...defaultSettings,

      init: async () => {
        try {
          const settings = await hostApiFetch<Partial<typeof defaultSettings>>('/api/settings');
          let themeToBackfill: Theme | null = null;
          let colorThemeToBackfill: ColorTheme | null = null;

          set((state) => {
            const remoteTheme = settings.theme;
            const remoteColorTheme = settings.colorTheme as ColorTheme | undefined;

            const shouldBackfillTheme =
              state.theme !== defaultSettings.theme
              && (!remoteTheme || remoteTheme === defaultSettings.theme);
            const shouldBackfillColorTheme =
              state.colorTheme !== defaultSettings.colorTheme
              && (!remoteColorTheme || remoteColorTheme === defaultSettings.colorTheme);

            const nextTheme = shouldBackfillTheme
              ? state.theme
              : (remoteTheme ?? state.theme);
            const nextColorTheme = shouldBackfillColorTheme
              ? state.colorTheme
              : (remoteColorTheme ?? state.colorTheme);

            if (shouldBackfillTheme) {
              themeToBackfill = nextTheme;
            }
            if (shouldBackfillColorTheme) {
              colorThemeToBackfill = nextColorTheme;
            }

            return {
              ...state,
              ...settings,
              theme: nextTheme,
              colorTheme: nextColorTheme,
            };
          });

          if (settings.language) {
            i18n.changeLanguage(settings.language);
          }
          if (themeToBackfill) {
            persistSettingValue('theme', themeToBackfill);
          }
          if (colorThemeToBackfill) {
            persistSettingValue('colorTheme', colorThemeToBackfill);
          }
        } catch {
          // Keep renderer-persisted settings as a fallback when the main
          // process store is not reachable.
        }
      },

      setTheme: (theme) => {
        set({ theme });
        persistSettingValue('theme', theme);
      },
      setColorTheme: (colorTheme) => {
        set({ colorTheme });
        persistSettingValue('colorTheme', colorTheme);
      },
      setLanguage: (language) => {
        i18n.changeLanguage(language);
        set({ language });
        void hostApiFetch('/api/settings/language', {
          method: 'PUT',
          body: JSON.stringify({ value: language }),
        }).catch(() => {});
      },
      setStartMinimized: (startMinimized) => set({ startMinimized }),
      setLaunchAtStartup: (launchAtStartup) => set({ launchAtStartup }),
      setWorkspaceOnly: (_workspaceOnly) => set({ workspaceOnly: false }),
      setSecurityPolicy: (securityPolicy) => set({ securityPolicy }),
      setGatewayAutoStart: (gatewayAutoStart) => {
        set({ gatewayAutoStart });
        void hostApiFetch('/api/settings/gatewayAutoStart', {
          method: 'PUT',
          body: JSON.stringify({ value: gatewayAutoStart }),
        }).catch(() => {});
      },
      setGatewayPort: (gatewayPort) => {
        set({ gatewayPort });
        void hostApiFetch('/api/settings/gatewayPort', {
          method: 'PUT',
          body: JSON.stringify({ value: gatewayPort }),
        }).catch(() => {});
      },
      setProxyEnabled: (proxyEnabled) => set({ proxyEnabled }),
      setProxyServer: (proxyServer) => set({ proxyServer }),
      setProxyHttpServer: (proxyHttpServer) => set({ proxyHttpServer }),
      setProxyHttpsServer: (proxyHttpsServer) => set({ proxyHttpsServer }),
      setProxyAllServer: (proxyAllServer) => set({ proxyAllServer }),
      setProxyBypassRules: (proxyBypassRules) => set({ proxyBypassRules }),
      setUpdateChannel: (updateChannel) => set({ updateChannel }),
      setAutoCheckUpdate: (autoCheckUpdate) => set({ autoCheckUpdate }),
      setAutoDownloadUpdate: (autoDownloadUpdate) => set({ autoDownloadUpdate }),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      setChatSessionsPanelCollapsed: (chatSessionsPanelCollapsed) => set({ chatSessionsPanelCollapsed }),
      setDevModeUnlocked: (devModeUnlocked) => set({ devModeUnlocked }),
      markSetupComplete: () => set({ setupComplete: true }),
      resetSettings: () => set(defaultSettings),
    }),
    {
      name: 'geeclaw-settings',
      version: 6,
      migrate: (persistedState, version) => {
        if (!persistedState || typeof persistedState !== 'object') {
          return persistedState;
        }
        const nextState = { ...(persistedState as Record<string, unknown>) };
        if (version < 3) {
          delete nextState.openclawRuntimeSource;
        }
        if (version < 4) {
          nextState.colorTheme = DEFAULT_COLOR_THEME_ID;
        }
        if (version < 5) {
          nextState.workspaceOnly = false;
          nextState.securityPolicy = 'moderate';
        }
        if (version < 6) {
          nextState.chatSessionsPanelCollapsed = false;
        }
        if (nextState.workspaceOnly !== false) {
          nextState.workspaceOnly = false;
        }
        return nextState;
      },
    }
  )
);
