/**
 * Root Application Component
 * Handles routing and global providers
 */
import { Routes, Route, Navigate, useNavigate, useLocation, type Location } from 'react-router-dom';
import { Component, useEffect, useState } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { Toaster } from 'sonner';
import i18n from './i18n';
import { MainLayout } from './components/layout/MainLayout';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Chat } from './pages/Chat';
import { Dashboard } from './pages/Dashboard';
import { Channels } from './pages/Channels';
import { Skills } from './pages/Skills';
import { Cron } from './pages/Cron';
import { CronRunHistoryPage } from './pages/Cron/RunHistoryPage';
import { Settings } from './pages/Settings';
import { Setup } from './pages/Setup';
import { Startup } from './pages/Startup';
import { GatewaySessions } from './pages/GatewaySessions';
import { GatewayRecoveryOverlay } from '@/components/gateway/GatewayRecoveryOverlay';
import { ApprovalDialogRoot } from '@/components/approval/ApprovalDialogRoot';
import { useSettingsStore } from './stores/settings';
import { useUpdateStore } from './stores/update';
import { useBootstrapStore } from './stores/bootstrap';
import { applyGatewayTransportPreference } from './lib/api-client';
import { isSettingsModalPath } from './lib/settings-modal';
import { applyColorTheme } from '@/theme/color-themes';
import { UpdateAnnouncementDialog } from '@/components/update/UpdateAnnouncementDialog';
import { getDevDebugUpdateScenario } from '@/lib/update-debug';


/**
 * Error Boundary to catch and display React rendering errors
 */
class ErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('React Error Boundary caught error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: '40px',
          color: '#f87171',
          background: '#0f172a',
          minHeight: '100vh',
          fontFamily: 'monospace'
        }}>
          <h1 style={{ fontSize: '24px', marginBottom: '16px' }}>Something went wrong</h1>
          <pre style={{
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            background: '#1e293b',
            padding: '16px',
            borderRadius: '8px',
            fontSize: '14px'
          }}>
            {this.state.error?.message}
            {'\n\n'}
            {this.state.error?.stack}
          </pre>
          <button
            onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}
            style={{
              marginTop: '16px',
              padding: '8px 16px',
              background: '#3b82f6',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer'
            }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const routeState = location.state as { backgroundLocation?: Location } | null;
  const backgroundLocation = routeState?.backgroundLocation;
  const showSettingsOverlay = !!backgroundLocation && isSettingsModalPath(location.pathname);
  const initSettings = useSettingsStore((state) => state.init);
  const initUpdate = useUpdateStore((state) => state.init);
  const theme = useSettingsStore((state) => state.theme);
  const colorTheme = useSettingsStore((state) => state.colorTheme);
  const language = useSettingsStore((state) => state.language);
  const bootstrapPhase = useBootstrapStore((state) => state.phase);
  const initBootstrap = useBootstrapStore((state) => state.init);
  const [systemTheme, setSystemTheme] = useState<'light' | 'dark'>(() => (
    window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  ));
  const effectiveTheme = theme === 'system' ? systemTheme : theme;

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      await initSettings();
      if (!cancelled) {
        await initUpdate();
      }
      if (!cancelled) {
        const debugScenario = getDevDebugUpdateScenario();
        if (debugScenario) {
          useUpdateStore.setState((state) => ({
            ...state,
            status: debugScenario.status,
            updateInfo: debugScenario.updateInfo,
            progress: debugScenario.progress,
            error: null,
            autoInstallCountdown: debugScenario.autoInstallCountdown,
            skippedVersions: debugScenario.skippedVersions ?? state.skippedVersions,
            dismissedAnnouncementVersion: debugScenario.dismissedAnnouncementVersion ?? null,
          }));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [initSettings, initUpdate]);

  // Sync i18n language with persisted settings on mount
  useEffect(() => {
    if (language && language !== i18n.language) {
      i18n.changeLanguage(language);
    }
  }, [language]);

  // Initialize bootstrap flow on mount
  useEffect(() => {
    void initBootstrap();
  }, [initBootstrap]);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const updateSystemTheme = (event?: MediaQueryListEvent) => {
      const prefersDark = event ? event.matches : mediaQuery.matches;
      setSystemTheme(prefersDark ? 'dark' : 'light');
    };

    updateSystemTheme();

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', updateSystemTheme);
      return () => mediaQuery.removeEventListener('change', updateSystemTheme);
    }

    mediaQuery.addListener(updateSystemTheme);
    return () => mediaQuery.removeListener(updateSystemTheme);
  }, []);

  // Listen for navigation events from main process
  useEffect(() => {
    const handleNavigate = (...args: unknown[]) => {
      const path = args[0];
      if (typeof path === 'string') {
        navigate(path);
      }
    };

    const unsubscribe = window.electron.ipcRenderer.on('navigate', handleNavigate);

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [navigate]);

  // Apply theme (appearance mode + color theme)
  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(effectiveTheme);
    applyColorTheme(root, colorTheme, effectiveTheme);
  }, [colorTheme, effectiveTheme]);

  useEffect(() => {
    applyGatewayTransportPreference();
  }, []);

  if (bootstrapPhase !== 'ready') {
    return (
      <ErrorBoundary>
        <TooltipProvider delayDuration={300}>
          <Startup />
          <ApprovalDialogRoot />
          <Toaster
            position="bottom-right"
            richColors
            closeButton
            style={{ zIndex: 99999 }}
          />
        </TooltipProvider>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <TooltipProvider delayDuration={300}>
        <Routes location={backgroundLocation || location}>
          {/* Setup wizard (shown on first launch) */}
          <Route path="/setup/*" element={<Setup />} />

          {/* Main application routes */}
          <Route element={<MainLayout />}>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/chat" element={<Chat />} />
            <Route path="/models" element={<Navigate to="/settings/model-providers" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/channels" element={<Channels />} />
            <Route path="/agents" element={<Navigate to="/dashboard" replace />} />
            <Route path="/skills" element={<Skills />} />
            <Route path="/cron" element={<Cron />} />
            <Route path="/cron/:jobId/runs" element={<CronRunHistoryPage />} />
            <Route path="/gateway-sessions" element={<GatewaySessions />} />
            <Route path="/settings" element={<Navigate to="/settings/appearance" replace />} />
            <Route path="/settings/dashboard" element={<Navigate to="/dashboard" replace />} />
            <Route path="/settings/app" element={<Navigate to="/settings/appearance" replace />} />
            <Route path="/settings/channels" element={<Navigate to="/channels" replace />} />
            <Route path="/settings/*" element={<Settings />} />
          </Route>
        </Routes>

        {showSettingsOverlay && <Settings />}
        <GatewayRecoveryOverlay />
        <ApprovalDialogRoot />

        {/* Global toast notifications */}
        <Toaster
          position="bottom-right"
          richColors
          closeButton
          style={{ zIndex: 99999 }}
        />
        <UpdateAnnouncementDialog />
      </TooltipProvider>
    </ErrorBoundary>
  );
}

export default App;
