import type { TFunction } from 'i18next';
import type { AgentPresetMissingRequirements, AgentPresetPlatform } from '@/types/agent';

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

export function getPresetRequirementMessages(
  t: TFunction<'agents'>,
  locale: string | undefined,
  missingRequirements?: AgentPresetMissingRequirements,
): string[] {
  if (!missingRequirements) {
    return [];
  }

  const formatList = (items: string[]) => (
    typeof Intl !== 'undefined' && 'ListFormat' in Intl
      ? new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(items)
      : items.join(', ')
  );

  const messages: string[] = [];
  if (missingRequirements.bins?.length) {
    const items = formatList(missingRequirements.bins);
    messages.push(
      t(
        missingRequirements.bins.length > 1
          ? 'marketplace.requirements.missingBins'
          : 'marketplace.requirements.missingBin',
        { items },
      ),
    );
  }
  if (missingRequirements.anyBins?.length) {
    messages.push(
      t('marketplace.requirements.missingAnyBins', {
        items: formatList(missingRequirements.anyBins),
      }),
    );
  }
  if (missingRequirements.env?.length) {
    messages.push(
      t('marketplace.requirements.missingEnv', {
        items: formatList(missingRequirements.env),
      }),
    );
  }

  return messages;
}
