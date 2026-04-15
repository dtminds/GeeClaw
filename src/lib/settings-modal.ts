import type { Location } from 'react-router-dom';

export type SettingsModalSection =
  | 'appearance'
  | 'memory'
  | 'modelProviders'
  | 'modelConfig'
  | 'webSearch'
  | 'safety'
  | 'gateway'
  | 'cliMarketplace'
  | 'opencli'
  | 'mcp'
  | 'environment'
  | 'general';

const SETTINGS_SECTION_SEGMENTS: Record<SettingsModalSection, string> = {
  appearance: 'appearance',
  memory: 'memory',
  modelProviders: 'model-providers',
  modelConfig: 'model-config',
  webSearch: 'web-search',
  safety: 'safety',
  gateway: 'gateway',
  cliMarketplace: 'cli-marketplace',
  opencli: 'opencli',
  mcp: 'mcp',
  environment: 'environment',
  general: 'general',
};

type SettingsLocationState = {
  backgroundLocation?: Location;
};

export function isSettingsModalPath(pathname: string): boolean {
  return pathname === '/settings' || pathname.startsWith('/settings/');
}

export function getSettingsModalState(location: Location): SettingsLocationState {
  const state = location.state as SettingsLocationState | null;
  return {
    backgroundLocation: state?.backgroundLocation ?? location,
  };
}

export function getSettingsModalPath(section: SettingsModalSection): string {
  return `/settings/${SETTINGS_SECTION_SEGMENTS[section]}`;
}

export function resolveSettingsSection(pathname: string): SettingsModalSection {
  if (pathname.startsWith('/settings/appearance')) return 'appearance';
  if (pathname.startsWith('/settings/memory')) return 'memory';
  if (pathname.startsWith('/settings/web-search')) return 'webSearch';
  if (pathname.startsWith('/settings/safety')) return 'safety';
  if (pathname.startsWith('/settings/gateway')) return 'gateway';
  if (pathname.startsWith('/settings/cli-marketplace')) return 'cliMarketplace';
  if (pathname.startsWith('/settings/opencli')) return 'opencli';
  if (pathname.startsWith('/settings/mcp')) return 'mcp';
  if (pathname.startsWith('/settings/environment')) return 'environment';
  if (pathname.startsWith('/settings/general')) return 'general';
  if (pathname.startsWith('/settings/app')) return 'appearance';
  if (pathname.startsWith('/settings/model-providers')) return 'modelProviders';
  if (pathname.startsWith('/settings/model-config')) return 'modelConfig';
  if (pathname.startsWith('/settings/models')) return 'modelProviders';
  return 'appearance';
}
