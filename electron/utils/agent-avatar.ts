export const AGENT_AVATAR_PRESET_IDS = [
  'chibi-researcher',
  'chibi-coder',
  'chibi-operator',
  'chibi-designer',
  'chibi-analyst',
  'chibi-robot',
  'gradient-sky',
  'gradient-orchid',
  'gradient-sunset',
  'gradient-lagoon',
  'gradient-indigo',
  'gradient-rose',
] as const;

export type AgentAvatarPresetId = typeof AGENT_AVATAR_PRESET_IDS[number];
export type AgentAvatarSource = 'default' | 'user';

export const DEFAULT_AGENT_AVATAR_PRESET_ID: AgentAvatarPresetId = 'chibi-researcher';

const PRESET_ID_SET = new Set<string>(AGENT_AVATAR_PRESET_IDS);
const MARKETPLACE_AGENT_AVATAR_MAP: Partial<Record<string, AgentAvatarPresetId>> = {
  stockexpert: 'chibi-analyst',
};

export function normalizeAgentAvatarPresetId(value: unknown): AgentAvatarPresetId {
  return typeof value === 'string' && PRESET_ID_SET.has(value)
    ? value as AgentAvatarPresetId
    : DEFAULT_AGENT_AVATAR_PRESET_ID;
}

export function normalizeAgentAvatarSource(value: unknown): AgentAvatarSource | undefined {
  return value === 'user' || value === 'default'
    ? value
    : undefined;
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

function resolveHashedAvatarPresetId(seed: string): AgentAvatarPresetId {
  const index = hashString(seed) % AGENT_AVATAR_PRESET_IDS.length;
  return AGENT_AVATAR_PRESET_IDS[index] ?? DEFAULT_AGENT_AVATAR_PRESET_ID;
}

export function resolveDefaultAgentAvatarPresetId(agentId?: string): AgentAvatarPresetId {
  const normalizedAgentId = typeof agentId === 'string' ? agentId.trim().toLowerCase() : '';
  if (!normalizedAgentId) {
    return DEFAULT_AGENT_AVATAR_PRESET_ID;
  }
  return resolveHashedAvatarPresetId(normalizedAgentId);
}

export function resolveMarketplaceAvatarPresetId(agentId: string): AgentAvatarPresetId {
  const normalizedAgentId = agentId.trim().toLowerCase();
  return MARKETPLACE_AGENT_AVATAR_MAP[normalizedAgentId] ?? resolveHashedAvatarPresetId(normalizedAgentId);
}

export function shouldReplaceAgentAvatarOnMarketplaceSync(source?: AgentAvatarSource): boolean {
  return source !== 'user';
}
