export type AgentPresetPlatform = 'darwin' | 'win32' | 'linux';

const PRESET_PLATFORM_LABELS: Record<AgentPresetPlatform, string> = {
  darwin: 'macOS',
  win32: 'Windows',
  linux: 'Linux',
};

function requireNonEmptyPresetPlatforms(platforms: AgentPresetPlatform[]): AgentPresetPlatform[] {
  if (platforms.length === 0) {
    throw new Error('Preset platforms must contain at least 1 platform');
  }
  return platforms;
}

export function normalizePresetPlatforms(
  presetId: string,
  platforms: unknown,
): AgentPresetPlatform[] | undefined {
  if (platforms == null) {
    return undefined;
  }
  if (!Array.isArray(platforms)) {
    throw new Error(`Preset "${presetId}" platforms is invalid`);
  }
  if (platforms.length === 0) {
    throw new Error(`Preset "${presetId}" platforms must contain at least 1 platform`);
  }

  const normalized = platforms.map((value) => {
    if (value !== 'darwin' && value !== 'win32' && value !== 'linux') {
      throw new Error(`Preset "${presetId}" has unsupported platform "${String(value)}"`);
    }
    return value;
  });

  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`Preset "${presetId}" platforms must not contain duplicates`);
  }

  return normalized;
}

export function isPresetSupportedOnPlatform(
  platforms: AgentPresetPlatform[] | undefined,
  platform: NodeJS.Platform,
): boolean {
  if (!platforms) {
    return true;
  }
  return requireNonEmptyPresetPlatforms(platforms).includes(platform as AgentPresetPlatform);
}

export function formatPresetPlatforms(platforms: AgentPresetPlatform[]): string {
  const labels = requireNonEmptyPresetPlatforms(platforms).map(
    (platform) => PRESET_PLATFORM_LABELS[platform],
  );
  if (labels.length === 1) {
    return labels[0];
  }
  if (labels.length === 2) {
    return `${labels[0]} and ${labels[1]}`;
  }
  return `${labels.slice(0, -1).join(', ')}, and ${labels.at(-1)}`;
}
