export const LEGACY_BUILTIN_CHANNEL_PLUGIN_IDS: Record<string, string[]> = {
  qqbot: ['openclaw-qqbot'],
};

export const LEGACY_BUILTIN_PLUGIN_ID_SET = new Set(
  Object.values(LEGACY_BUILTIN_CHANNEL_PLUGIN_IDS).flat(),
);
