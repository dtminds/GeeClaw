/**
 * Zustand Stores Tests
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DEFAULT_QUICK_ACTIONS } from '@shared/quick-actions';

const hostApiFetchMock = vi.fn();

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => hostApiFetchMock(...args),
}));

import { useSettingsStore } from '@/stores/settings';
import { useGatewayStore } from '@/stores/gateway';

describe('Settings Store', () => {
  beforeEach(() => {
    hostApiFetchMock.mockReset();
    hostApiFetchMock.mockResolvedValue(undefined);

    // Reset store to default state
    useSettingsStore.setState({
      theme: 'system',
      colorTheme: 'standard',
      language: 'en',
      sidebarCollapsed: false,
      sidebarWidth: 224,
      devModeUnlocked: false,
      quickActions: structuredClone(DEFAULT_QUICK_ACTIONS),
      gatewayAutoStart: true,
      gatewayPort: 28788,
      autoCheckUpdate: true,
      autoDownloadUpdate: false,
      startMinimized: false,
      launchAtStartup: false,
      updateChannel: 'stable',
    });
  });
  
  it('should have default values', () => {
    const state = useSettingsStore.getState();
    expect(state.theme).toBe('system');
    expect(state.colorTheme).toBe('standard');
    expect(state.sidebarCollapsed).toBe(false);
    expect(state.sidebarWidth).toBe(224);
    expect(state.gatewayAutoStart).toBe(true);
  });
  
  it('should update theme', () => {
    const { setTheme } = useSettingsStore.getState();
    setTheme('dark');
    expect(useSettingsStore.getState().theme).toBe('dark');
    expect(hostApiFetchMock).toHaveBeenCalledWith('/api/settings/theme', {
      method: 'PUT',
      body: JSON.stringify({ value: 'dark' }),
    });
  });

  it('should update color theme', () => {
    const { setColorTheme } = useSettingsStore.getState();
    setColorTheme('ocean');
    expect(useSettingsStore.getState().colorTheme).toBe('ocean');
    expect(hostApiFetchMock).toHaveBeenCalledWith('/api/settings/colorTheme', {
      method: 'PUT',
      body: JSON.stringify({ value: 'ocean' }),
    });
  });

  it('should backfill persisted appearance settings from renderer state during init', async () => {
    hostApiFetchMock.mockResolvedValue(undefined);
    hostApiFetchMock.mockResolvedValueOnce({
      theme: 'system',
      colorTheme: 'standard',
      language: 'en',
    });

    useSettingsStore.setState({
      theme: 'dark',
      colorTheme: 'ocean',
      language: 'en',
      sidebarCollapsed: false,
      sidebarWidth: 280,
      devModeUnlocked: false,
      quickActions: structuredClone(DEFAULT_QUICK_ACTIONS),
      gatewayAutoStart: true,
      gatewayPort: 28788,
      autoCheckUpdate: true,
      autoDownloadUpdate: false,
      startMinimized: false,
      launchAtStartup: false,
      updateChannel: 'stable',
    });

    await useSettingsStore.getState().init();

    expect(useSettingsStore.getState().theme).toBe('dark');
    expect(useSettingsStore.getState().colorTheme).toBe('ocean');
    expect(useSettingsStore.getState().sidebarWidth).toBe(280);
    expect(hostApiFetchMock).toHaveBeenNthCalledWith(1, '/api/settings');
    expect(hostApiFetchMock).toHaveBeenCalledWith('/api/settings/theme', {
      method: 'PUT',
      body: JSON.stringify({ value: 'dark' }),
    });
    expect(hostApiFetchMock).toHaveBeenCalledWith('/api/settings/colorTheme', {
      method: 'PUT',
      body: JSON.stringify({ value: 'ocean' }),
    });
  });
  
  it('should toggle sidebar collapsed state', () => {
    const { setSidebarCollapsed } = useSettingsStore.getState();
    setSidebarCollapsed(true);
    expect(useSettingsStore.getState().sidebarCollapsed).toBe(true);
  });

  it('should update sidebar width', () => {
    const { setSidebarWidth } = useSettingsStore.getState();
    setSidebarWidth(320);
    expect(useSettingsStore.getState().sidebarWidth).toBe(320);
  });
  
  it('should unlock dev mode', () => {
    const { setDevModeUnlocked } = useSettingsStore.getState();
    setDevModeUnlocked(true);
    expect(useSettingsStore.getState().devModeUnlocked).toBe(true);
  });

  it('should update and persist quick actions', () => {
    const { setQuickActions } = useSettingsStore.getState();
    const nextQuickActions = {
      ...structuredClone(DEFAULT_QUICK_ACTIONS),
      closeOnCopy: false,
    };

    setQuickActions(nextQuickActions);

    expect(useSettingsStore.getState().quickActions).toEqual(nextQuickActions);
    expect(hostApiFetchMock).toHaveBeenCalledWith('/api/settings/quickActions', {
      method: 'PUT',
      body: JSON.stringify({ value: nextQuickActions }),
    });
  });
});

describe('Gateway Store', () => {
  beforeEach(() => {
    // Reset store
    useGatewayStore.setState({
      status: { state: 'stopped', port: 28788 },
      isInitialized: false,
    });
  });
  
  it('should have default status', () => {
    const state = useGatewayStore.getState();
    expect(state.status.state).toBe('stopped');
    expect(state.status.port).toBe(28788);
  });
  
  it('should update status', () => {
    const { setStatus } = useGatewayStore.getState();
    setStatus({ state: 'running', port: 28788, pid: 12345 });
    
    const state = useGatewayStore.getState();
    expect(state.status.state).toBe('running');
    expect(state.status.pid).toBe(12345);
  });

  it('should proxy gateway rpc through ipc', async () => {
    const invoke = vi.mocked(window.electron.ipcRenderer.invoke);
    invoke.mockResolvedValueOnce({ success: true, result: { ok: true } });

    const result = await useGatewayStore.getState().rpc<{ ok: boolean }>('chat.history', { limit: 10 }, 5000);

    expect(result.ok).toBe(true);
    expect(invoke).toHaveBeenCalledWith('gateway:rpc', 'chat.history', { limit: 10 }, 5000);
  });
});
