import type { Location } from 'react-router-dom';

export type SettingsModalSection = 'appearance' | 'models' | 'safety' | 'gateway' | 'opencli' | 'mcp' | 'general';

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
  return `/settings/${section}`;
}

export function resolveSettingsSection(pathname: string): SettingsModalSection {
  if (pathname.startsWith('/settings/appearance')) return 'appearance';
  if (pathname.startsWith('/settings/safety')) return 'safety';
  if (pathname.startsWith('/settings/gateway')) return 'gateway';
  if (pathname.startsWith('/settings/opencli')) return 'opencli';
  if (pathname.startsWith('/settings/mcp')) return 'mcp';
  if (pathname.startsWith('/settings/general')) return 'general';
  if (pathname.startsWith('/settings/app')) return 'appearance';
  if (pathname.startsWith('/settings/models')) return 'models';
  return 'appearance';
}
