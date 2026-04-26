/**
 * Skill policy definitions shared by main-process startup enforcement
 * and renderer-facing host API responses.
 */

/**
 * Skills that must always remain enabled.
 *
 * Update this list when product policy changes.
 */
export const ALWAYS_ENABLED_SKILL_KEYS = [
  'weather',
  'mcporter',
  'skill-creator',
  'geeclaw-cron',
  'geeclaw-env',
  'geeclaw-openclaw',
] as const;

const ALWAYS_ENABLED_SKILL_SET = new Set<string>(ALWAYS_ENABLED_SKILL_KEYS);

export function isAlwaysEnabledSkillKey(skillKey: string): boolean {
  return ALWAYS_ENABLED_SKILL_SET.has(skillKey);
}

export function getAlwaysEnabledSkillKeys(): string[] {
  return [...ALWAYS_ENABLED_SKILL_KEYS];
}

