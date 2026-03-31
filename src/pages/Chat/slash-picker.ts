import type { TFunction } from 'i18next';
import type { Skill, SkillMissingRequirements } from '@/types/skill';

export interface SlashSkillQuery {
  query: string;
  from: number;
  to: number;
  allowCommands: boolean;
}

export interface SlashCommandOption {
  id: string;
  value: string;
  nameKey: string;
  descriptionKey: string;
  type: 'command';
}

export type SlashPickerItem = Skill | SlashCommandOption;

type GatewaySkillStatus = {
  skillKey?: string;
  slug?: string;
  source?: string;
  baseDir?: string;
  filePath?: string;
  name?: string;
  description?: string;
  eligible?: boolean;
  disabled?: boolean;
  blockedByAllowlist?: boolean;
  emoji?: string;
  version?: string;
  author?: string;
  config?: Record<string, unknown>;
  bundled?: boolean;
  always?: boolean;
  missing?: SkillMissingRequirements;
};

type GatewaySkillsStatusResult = {
  skills?: GatewaySkillStatus[];
};

const PRESET_AGENT_SKILLS_TTL_MS = 60 * 60 * 1000;
const presetAgentSkillsCache = new Map<string, { expiresAt: number; skills: Skill[] }>();
const presetAgentSkillsInflight = new Map<string, Promise<Skill[]>>();

function normalizeSkillSearch(value: string): string {
  return value
    .normalize('NFKD')
    .trim()
    .toLowerCase();
}

function cloneSkill(skill: Skill): Skill {
  return {
    ...skill,
    config: skill.config ? { ...skill.config } : skill.config,
    missing: skill.missing ? { ...skill.missing } : skill.missing,
  };
}

function cacheKeyForSkill(skill: Pick<Skill, 'id' | 'slug'>): string {
  return normalizeSkillSearch(skill.slug || skill.id);
}

function hasMissingRequirements(missing?: SkillMissingRequirements): boolean {
  if (!missing) return false;
  return Boolean(
    (missing.bins && missing.bins.length > 0)
    || (missing.anyBins && missing.anyBins.length > 0)
    || (missing.env && missing.env.length > 0)
    || (missing.config && missing.config.length > 0)
    || (missing.os && missing.os.length > 0)
  );
}

function mapGatewaySkillToPresetAgentSkill(skill: GatewaySkillStatus): Skill | null {
  if (skill.source !== 'openclaw-workspace') {
    return null;
  }

  const skillKey = typeof skill.skillKey === 'string' && skill.skillKey.trim()
    ? skill.skillKey.trim()
    : typeof skill.slug === 'string' && skill.slug.trim()
      ? skill.slug.trim()
      : '';

  if (!skillKey) {
    return null;
  }

  const blockedByAllowlist = skill.blockedByAllowlist === true;
  const missing = skill.missing;
  const unavailableForEnable = hasMissingRequirements(missing)
    || blockedByAllowlist
    || (skill.eligible === false && !skill.disabled);
  const eligible = !unavailableForEnable;

  return {
    id: skillKey,
    slug: skill.slug || skillKey,
    name: skill.name?.trim() || skill.slug?.trim() || skillKey,
    description: skill.description?.trim() || '',
    enabled: !skill.disabled && eligible,
    configuredEnabled: !skill.disabled,
    eligible,
    blockedByAllowlist,
    icon: skill.emoji || '📦',
    version: skill.version,
    author: skill.author,
    config: skill.config || {},
    isCore: Boolean(skill.bundled && skill.always),
    isBundled: skill.bundled,
    hidden: false,
    source: 'preset-agent-workspace',
    baseDir: skill.baseDir,
    filePath: skill.filePath,
    missing,
  };
}

export function invalidatePresetAgentSkillsCache(agentId?: string): void {
  if (agentId) {
    presetAgentSkillsCache.delete(agentId);
    presetAgentSkillsInflight.delete(agentId);
    return;
  }

  presetAgentSkillsCache.clear();
  presetAgentSkillsInflight.clear();
}

export async function fetchPresetAgentSkills(
  agentId: string,
  rpc: (method: string, params?: unknown, timeoutMs?: number) => Promise<GatewaySkillsStatusResult>,
  now = Date.now,
): Promise<Skill[]> {
  const cached = presetAgentSkillsCache.get(agentId);
  const nowMs = now();
  if (cached && cached.expiresAt > nowMs) {
    return cached.skills.map(cloneSkill);
  }

  const existingInflight = presetAgentSkillsInflight.get(agentId);
  if (existingInflight) {
    const resolved = await existingInflight;
    return resolved.map(cloneSkill);
  }

  const request = (async () => {
    const result = await rpc('skills.status', { agentId });
    const skills = Array.isArray(result.skills)
      ? result.skills
        .map(mapGatewaySkillToPresetAgentSkill)
        .filter((skill): skill is Skill => Boolean(skill))
      : [];

    presetAgentSkillsCache.set(agentId, {
      expiresAt: nowMs + PRESET_AGENT_SKILLS_TTL_MS,
      skills: skills.map(cloneSkill),
    });

    return skills;
  })();

  presetAgentSkillsInflight.set(agentId, request);

  try {
    const skills = await request;
    return skills.map(cloneSkill);
  } finally {
    presetAgentSkillsInflight.delete(agentId);
  }
}

export function isSlashCommandItem(item: SlashPickerItem): item is SlashCommandOption {
  return (item as SlashCommandOption).type === 'command';
}

export function getSlashCommandName(item: SlashCommandOption, tChat: TFunction<'chat'>): string {
  return tChat(item.nameKey);
}

export function getSlashCommandDescription(item: SlashCommandOption, tChat: TFunction<'chat'>): string {
  return tChat(item.descriptionKey);
}

function getSlashPickerItemName(item: SlashPickerItem, tChat: TFunction<'chat'>): string {
  return isSlashCommandItem(item) ? getSlashCommandName(item, tChat) : item.name;
}

function getSlashPickerItemSearchValues(item: SlashPickerItem, tChat: TFunction<'chat'>): string[] {
  if (isSlashCommandItem(item)) {
    const commandValue = item.value.startsWith('/') ? item.value.slice(1) : item.value;
    return [getSlashCommandName(item, tChat), item.value, commandValue, getSlashCommandDescription(item, tChat)];
  }

  return [item.name, item.slug || item.id, item.id, item.description || ''];
}

function getSlashPickerItemPriority(item: SlashPickerItem): number {
  if (isSlashCommandItem(item)) {
    return 0;
  }
  if (item.source === 'preset-agent-workspace') {
    return 1;
  }
  return 2;
}

function rankSlashPickerItemsForQuery(items: SlashPickerItem[], query: string, tChat: TFunction<'chat'>): SlashPickerItem[] {
  const normalizedQuery = normalizeSkillSearch(query);

  if (!normalizedQuery) {
    return [...items].sort((a, b) => {
      const priorityDelta = getSlashPickerItemPriority(a) - getSlashPickerItemPriority(b);
      if (priorityDelta !== 0) {
        return priorityDelta;
      }
      return getSlashPickerItemName(a, tChat).localeCompare(getSlashPickerItemName(b, tChat));
    });
  }

  return items
    .map((item) => {
      const [primary, secondary, tertiary, quaternary] = getSlashPickerItemSearchValues(item, tChat)
        .map((value) => normalizeSkillSearch(value));
      const normalizedName = primary || '';
      const normalizedSlug = secondary || '';
      const normalizedAlias = tertiary || '';
      const normalizedDescription = quaternary || '';
      const exact = normalizedName === normalizedQuery || normalizedSlug === normalizedQuery;
      const startsWith = normalizedName.startsWith(normalizedQuery)
        || normalizedSlug.startsWith(normalizedQuery)
        || normalizedAlias.startsWith(normalizedQuery);
      const includes = normalizedName.includes(normalizedQuery)
        || normalizedSlug.includes(normalizedQuery)
        || normalizedAlias.includes(normalizedQuery)
        || normalizedDescription.includes(normalizedQuery);

      if (!exact && !startsWith && !includes) {
        return null;
      }

      return {
        item,
        rank: exact ? 0 : startsWith ? 1 : 2,
      };
    })
    .filter((entry): entry is { item: SlashPickerItem; rank: number } => Boolean(entry))
    .sort((a, b) => {
      const priorityDelta = getSlashPickerItemPriority(a.item) - getSlashPickerItemPriority(b.item);
      if (priorityDelta !== 0) {
        return priorityDelta;
      }
      if (a.rank !== b.rank) {
        return a.rank - b.rank;
      }
      return getSlashPickerItemName(a.item, tChat).localeCompare(getSlashPickerItemName(b.item, tChat));
    })
    .map((entry) => entry.item);
}

export function getVisibleSlashItems(
  items: SlashPickerItem[],
  slashQuery: SlashSkillQuery | null,
  tChat: TFunction<'chat'>,
): SlashPickerItem[] {
  const scopedItems = slashQuery?.allowCommands
    ? items
    : items.filter((item) => !isSlashCommandItem(item));

  return rankSlashPickerItemsForQuery(scopedItems, slashQuery?.query ?? '', tChat);
}

export function buildSlashPickerItems(input: {
  presetAgentSkills: Skill[];
  commands: SlashCommandOption[];
  globalSkills: Skill[];
}): SlashPickerItem[] {
  const presetAgentSkills = input.presetAgentSkills.map(cloneSkill);
  const globalSkills = input.globalSkills.map(cloneSkill);
  const presetKeys = new Set(presetAgentSkills.map(cacheKeyForSkill));
  const dedupedGlobalSkills = globalSkills.filter((skill) => !presetKeys.has(cacheKeyForSkill(skill)));

  return [...presetAgentSkills, ...input.commands, ...dedupedGlobalSkills];
}
