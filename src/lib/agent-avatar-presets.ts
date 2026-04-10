export const AGENT_AVATAR_PRESET_IDS = [
  'gradient-sky',
  'gradient-orchid',
  'gradient-sunset',
  'gradient-lagoon',
  'gradient-indigo',
  'gradient-rose',
  'gradient-sage',
  'gradient-clay',
  'gradient-stone',
  'gradient-dune',
] as const;

export type AgentAvatarPresetId = typeof AGENT_AVATAR_PRESET_IDS[number];
export type AgentAvatarSource = 'default' | 'user';

export interface AgentAvatarPreset {
  id: AgentAvatarPresetId;
  label: string;
  palette: {
    background: string;
    accent: string;
    stroke?: string;
  };
}

export const DEFAULT_AGENT_AVATAR_PRESET_ID: AgentAvatarPresetId = 'gradient-sky';

export const AGENT_AVATAR_PRESETS: AgentAvatarPreset[] = [
  {
    id: 'gradient-sky',
    label: 'Sky',
    palette: { background: 'linear-gradient(135deg, rgba(56,189,248,0.65) 0%, rgba(232,121,249,0.65) 100%)', accent: '#ffffff', stroke: '#ffffff' },
  },
  {
    id: 'gradient-orchid',
    label: 'Orchid',
    palette: { background: 'linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%)', accent: '#ffffff', stroke: '#7e22ce' },
  },
  {
    id: 'gradient-sunset',
    label: 'Sunset',
    palette: { background: 'linear-gradient(135deg, #fb7185 0%, #fb923c 100%)', accent: '#ffffff', stroke: '#be123c' },
  },
  {
    id: 'gradient-lagoon',
    label: 'Lagoon',
    palette: { background: 'linear-gradient(135deg, #14b8a6 0%, #38bdf8 100%)', accent: '#ecfeff', stroke: '#0f766e' },
  },
  {
    id: 'gradient-indigo',
    label: 'Indigo',
    palette: { background: 'linear-gradient(135deg, #6366f1 0%, #3b82f6 100%)', accent: '#eef2ff', stroke: '#312e81' },
  },
  {
    id: 'gradient-rose',
    label: 'Rose',
    palette: { background: 'linear-gradient(135deg, #f472b6 0%, #fb7185 100%)', accent: '#fff1f2', stroke: '#9f1239' },
  },
  {
    id: 'gradient-sage',
    label: 'Sage',
    palette: { background: 'linear-gradient(135deg, #a8b7aa 0%, #c8d1c0 100%)', accent: '#f6f5ef', stroke: '#7f8f82' },
  },
  {
    id: 'gradient-clay',
    label: 'Clay',
    palette: { background: 'linear-gradient(135deg, #b88f84 0%, #d2b3a4 100%)', accent: '#fff5ef', stroke: '#9d7569' },
  },
  {
    id: 'gradient-stone',
    label: 'Stone',
    palette: { background: 'linear-gradient(135deg, #8f98a1 0%, #b7bfc6 100%)', accent: '#f5f7f8', stroke: '#6e7781' },
  },
  {
    id: 'gradient-dune',
    label: 'Dune',
    palette: { background: 'linear-gradient(135deg, #b8aa93 0%, #d5c9b4 100%)', accent: '#fffaf1', stroke: '#8e816d' },
  },
];

export const AGENT_AVATAR_PRESET_MAP = Object.fromEntries(
  AGENT_AVATAR_PRESETS.map((preset) => [preset.id, preset]),
) as Record<AgentAvatarPresetId, AgentAvatarPreset>;

const MARKETPLACE_AGENT_AVATAR_MAP: Partial<Record<string, AgentAvatarPresetId>> = {
  stockexpert: 'gradient-sunset',
};

export function normalizeAgentAvatarPresetId(value: unknown): AgentAvatarPresetId {
  return typeof value === 'string' && value in AGENT_AVATAR_PRESET_MAP
    ? value as AgentAvatarPresetId
    : DEFAULT_AGENT_AVATAR_PRESET_ID;
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

export function resolveMarketplaceAvatarPresetId(agentId: string): AgentAvatarPresetId {
  const normalizedAgentId = agentId.trim().toLowerCase();
  return MARKETPLACE_AGENT_AVATAR_MAP[normalizedAgentId] ?? resolveHashedAvatarPresetId(normalizedAgentId);
}

export function shouldReplaceAgentAvatarOnMarketplaceSync(source?: AgentAvatarSource): boolean {
  return source !== 'user';
}
