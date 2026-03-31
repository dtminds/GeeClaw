export type AgentSkillScope =
  | { mode: 'default'; skills?: never }
  | { mode: 'specified'; skills: string[] };

export const MAX_SPECIFIED_AGENT_SKILLS = 20;

type NormalizeSpecifiedSkillListOptions = {
  invalidEntryError?: string;
  duplicateError: string;
  emptyError: string;
  tooManyError: string;
};

export function normalizeSpecifiedSkillList(
  skills: unknown,
  options: NormalizeSpecifiedSkillListOptions,
): string[] {
  const list = Array.isArray(skills) ? skills : [];
  if (
    options.invalidEntryError
    && list.some((value) => typeof value !== 'string' || !value.trim())
  ) {
    throw new Error(options.invalidEntryError);
  }

  const normalized = list
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean);

  if (new Set(normalized).size !== normalized.length) {
    throw new Error(options.duplicateError);
  }
  if (normalized.length === 0) {
    throw new Error(options.emptyError);
  }
  if (normalized.length > MAX_SPECIFIED_AGENT_SKILLS) {
    throw new Error(options.tooManyError);
  }

  return normalized;
}
