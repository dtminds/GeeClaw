import type { TFunction } from 'i18next';
import type { AgentPresetPlatform } from '@/types/agent';

const PLATFORM_KEYS: Record<AgentPresetPlatform, 'marketplace.platforms.darwin' | 'marketplace.platforms.win32' | 'marketplace.platforms.linux'> = {
  darwin: 'marketplace.platforms.darwin',
  win32: 'marketplace.platforms.win32',
  linux: 'marketplace.platforms.linux',
};

export function getPresetPlatformLabels(
  t: TFunction<'agents'>,
  platforms?: AgentPresetPlatform[],
): string[] {
  if (!platforms || platforms.length === 0) {
    return [t('marketplace.platforms.all')];
  }

  return platforms.map((platform) => t(PLATFORM_KEYS[platform]));
}

export function getPresetAvailabilityCopy(
  t: TFunction<'agents'>,
  locale: string | undefined,
  platforms?: AgentPresetPlatform[],
): string | null {
  if (!platforms || platforms.length === 0) {
    return null;
  }

  const labels = getPresetPlatformLabels(t, platforms);
  const joined = typeof Intl !== 'undefined' && 'ListFormat' in Intl
    ? new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(labels)
    : labels.join(', ');

  return t('marketplace.availableOn', { platforms: joined });
}
