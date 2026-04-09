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
export type AgentAvatarKind = 'chibi' | 'gradient';
export type AgentAvatarSource = 'default' | 'user';

export interface AgentAvatarPreset {
  id: AgentAvatarPresetId;
  label: string;
  kind: AgentAvatarKind;
  palette: {
    background: string;
    accent: string;
    hair?: string;
    skin?: string;
    stroke?: string;
  };
  accessory?: 'glasses' | 'headset' | 'visor' | 'spark' | 'badge' | 'antenna';
}

export const DEFAULT_AGENT_AVATAR_PRESET_ID: AgentAvatarPresetId = 'chibi-researcher';

export const AGENT_AVATAR_PRESETS: AgentAvatarPreset[] = [
  {
    id: 'chibi-researcher',
    label: 'Researcher',
    kind: 'chibi',
    palette: { background: 'linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%)', accent: '#2563eb', hair: '#4338ca', skin: '#f4c7a1', stroke: '#1e3a8a' },
    accessory: 'glasses',
  },
  {
    id: 'chibi-coder',
    label: 'Coder',
    kind: 'chibi',
    palette: { background: 'linear-gradient(135deg, #cffafe 0%, #a5f3fc 100%)', accent: '#0891b2', hair: '#0f172a', skin: '#f0c4a4', stroke: '#164e63' },
    accessory: 'headset',
  },
  {
    id: 'chibi-operator',
    label: 'Operator',
    kind: 'chibi',
    palette: { background: 'linear-gradient(135deg, #dcfce7 0%, #bbf7d0 100%)', accent: '#16a34a', hair: '#14532d', skin: '#efc19c', stroke: '#166534' },
    accessory: 'badge',
  },
  {
    id: 'chibi-designer',
    label: 'Designer',
    kind: 'chibi',
    palette: { background: 'linear-gradient(135deg, #fae8ff 0%, #f5d0fe 100%)', accent: '#c026d3', hair: '#7c3aed', skin: '#f3c9a7', stroke: '#86198f' },
    accessory: 'spark',
  },
  {
    id: 'chibi-analyst',
    label: 'Analyst',
    kind: 'chibi',
    palette: { background: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)', accent: '#d97706', hair: '#78350f', skin: '#eebc93', stroke: '#92400e' },
    accessory: 'visor',
  },
  {
    id: 'chibi-robot',
    label: 'Robot',
    kind: 'chibi',
    palette: { background: 'linear-gradient(135deg, #e2e8f0 0%, #cbd5e1 100%)', accent: '#475569', hair: '#94a3b8', skin: '#e2e8f0', stroke: '#334155' },
    accessory: 'antenna',
  },
  {
    id: 'gradient-sky',
    label: 'Sky',
    kind: 'gradient',
    palette: { background: 'linear-gradient(135deg, #60a5fa 0%, #22d3ee 100%)', accent: '#0f172a', stroke: '#0c4a6e' },
  },
  {
    id: 'gradient-orchid',
    label: 'Orchid',
    kind: 'gradient',
    palette: { background: 'linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%)', accent: '#ffffff', stroke: '#7e22ce' },
  },
  {
    id: 'gradient-sunset',
    label: 'Sunset',
    kind: 'gradient',
    palette: { background: 'linear-gradient(135deg, #fb7185 0%, #fb923c 100%)', accent: '#ffffff', stroke: '#be123c' },
  },
  {
    id: 'gradient-lagoon',
    label: 'Lagoon',
    kind: 'gradient',
    palette: { background: 'linear-gradient(135deg, #14b8a6 0%, #38bdf8 100%)', accent: '#ecfeff', stroke: '#0f766e' },
  },
  {
    id: 'gradient-indigo',
    label: 'Indigo',
    kind: 'gradient',
    palette: { background: 'linear-gradient(135deg, #6366f1 0%, #3b82f6 100%)', accent: '#eef2ff', stroke: '#312e81' },
  },
  {
    id: 'gradient-rose',
    label: 'Rose',
    kind: 'gradient',
    palette: { background: 'linear-gradient(135deg, #f472b6 0%, #fb7185 100%)', accent: '#fff1f2', stroke: '#9f1239' },
  },
];

export const AGENT_AVATAR_PRESET_MAP = Object.fromEntries(
  AGENT_AVATAR_PRESETS.map((preset) => [preset.id, preset]),
) as Record<AgentAvatarPresetId, AgentAvatarPreset>;

const MARKETPLACE_AGENT_AVATAR_MAP: Partial<Record<string, AgentAvatarPresetId>> = {
  stockexpert: 'chibi-analyst',
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
