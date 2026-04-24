import { readFile } from 'node:fs/promises';
import { app } from 'electron';
import { loadAgentPresetPackageFromDir, type AgentPresetPackage } from './agent-presets';
import { getAgentMarketplaceCatalogPath, getAgentMarketplaceCatalogUrl } from './paths';

const AGENT_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CHECKSUM_PATTERN = /^sha256-[a-f0-9]{64}$/i;
const RECOGNIZED_CATALOG_ENTRY_KEYS = new Set([
  'agentId',
  'name',
  'description',
  'emoji',
  'category',
  'version',
  'downloadUrl',
  'checksum',
  'size',
  'minAppVersion',
  'platforms',
  'presetSkills',
]);
const RECOGNIZED_PLATFORM_VALUES = new Set(['darwin', 'win32', 'linux']);

export interface AgentMarketplaceCatalogEntry {
  agentId: string;
  name: string;
  description: string;
  emoji: string;
  category: string;
  version: string;
  downloadUrl: string;
  checksum: string;
  size?: number;
  minAppVersion?: string;
  platforms?: Array<'darwin' | 'win32' | 'linux'>;
  presetSkills?: string[];
}

export type AgentMarketplaceCatalog = AgentMarketplaceCatalogEntry[];

function requirePlainObject(value: unknown, field: string, index?: number): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    if (index === undefined) {
      throw new Error(`[agent-marketplace] ${field} is invalid`);
    }
    throw new Error(`[agent-marketplace] Entry at index ${index} ${field} is invalid`);
  }

  return value as Record<string, unknown>;
}

function requireNonEmptyString(value: unknown, field: string, index?: number): string {
  if (typeof value !== 'string' || !value.trim()) {
    if (index === undefined) {
      throw new Error(`[agent-marketplace] ${field} is required`);
    }
    throw new Error(`[agent-marketplace] Entry at index ${index} ${field} is required`);
  }

  return value.trim();
}

function assertSupportedKeys(
  record: Record<string, unknown>,
  field: string,
  index: number,
): void {
  const unsupportedKeys = Object.keys(record).filter((key) => !RECOGNIZED_CATALOG_ENTRY_KEYS.has(key));
  if (unsupportedKeys.length === 0) {
    return;
  }

  throw new Error(
    `[agent-marketplace] Entry at index ${index} ${field} has unsupported keys: ${unsupportedKeys.join(', ')}`,
  );
}

function validateCatalogAgentId(agentId: string, index: number): string {
  if (!AGENT_ID_PATTERN.test(agentId)) {
    throw new Error(`[agent-marketplace] Entry at index ${index} agentId is invalid`);
  }
  if (agentId === 'main') {
    throw new Error(`[agent-marketplace] Entry at index ${index} agentId "main" is reserved`);
  }
  return agentId;
}

function validateChecksum(checksum: string, index: number): string {
  if (!CHECKSUM_PATTERN.test(checksum)) {
    throw new Error(`[agent-marketplace] Entry at index ${index} checksum is invalid`);
  }
  return checksum;
}

function normalizeCatalogPlatforms(
  value: unknown,
  index: number,
): Array<'darwin' | 'win32' | 'linux'> | undefined {
  if (value == null) {
    return undefined;
  }

  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`[agent-marketplace] Entry at index ${index} platforms is invalid`);
  }

  const platforms = value.map((platform) => {
    if (typeof platform !== 'string' || !RECOGNIZED_PLATFORM_VALUES.has(platform as typeof platform)) {
      throw new Error(`[agent-marketplace] Entry at index ${index} platforms is invalid`);
    }
    return platform as 'darwin' | 'win32' | 'linux';
  });

  if (new Set(platforms).size !== platforms.length) {
    throw new Error(`[agent-marketplace] Entry at index ${index} platforms must not contain duplicates`);
  }

  return platforms;
}

function normalizeOptionalStringList(
  value: unknown,
  field: 'presetSkills',
  index: number,
): string[] | undefined {
  if (value == null) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new Error(`[agent-marketplace] Entry at index ${index} ${field} is invalid`);
  }

  if (value.length === 0) {
    throw new Error(`[agent-marketplace] Entry at index ${index} ${field} must not be empty`);
  }

  const normalized = value.map((entry) => {
    if (typeof entry !== 'string' || !entry.trim()) {
      throw new Error(`[agent-marketplace] Entry at index ${index} ${field} is invalid`);
    }
    return entry.trim();
  });

  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`[agent-marketplace] Entry at index ${index} ${field} is invalid`);
  }

  return normalized;
}

function validateCatalogEntry(entry: unknown, index: number): AgentMarketplaceCatalogEntry {
  const record = requirePlainObject(entry, 'catalog entry', index);
  assertSupportedKeys(record, 'catalog entry', index);

  const agentId = validateCatalogAgentId(requireNonEmptyString(record.agentId, 'agentId', index), index);
  const downloadUrl = requireNonEmptyString(record.downloadUrl, 'downloadUrl', index);

  try {
    void new URL(downloadUrl);
  } catch {
    throw new Error(`[agent-marketplace] Entry at index ${index} downloadUrl is invalid`);
  }

  const validated: AgentMarketplaceCatalogEntry = {
    agentId,
    name: requireNonEmptyString(record.name, 'name', index),
    description: requireNonEmptyString(record.description, 'description', index),
    emoji: requireNonEmptyString(record.emoji, 'emoji', index),
    category: requireNonEmptyString(record.category, 'category', index),
    version: requireNonEmptyString(record.version, 'version', index),
    downloadUrl,
    checksum: validateChecksum(requireNonEmptyString(record.checksum, 'checksum', index), index),
  };

  if (record.size !== undefined) {
    if (
      typeof record.size !== 'number'
      || !Number.isInteger(record.size)
      || record.size < 0
    ) {
      throw new Error(`[agent-marketplace] Entry at index ${index} size is invalid`);
    }
    validated.size = record.size;
  }

  if (record.minAppVersion !== undefined) {
    validated.minAppVersion = requireNonEmptyString(record.minAppVersion, 'minAppVersion', index);
  }

  const platforms = normalizeCatalogPlatforms(record.platforms, index);
  if (platforms) {
    validated.platforms = platforms;
  }

  const presetSkills = normalizeOptionalStringList(record.presetSkills, 'presetSkills', index);
  if (presetSkills) {
    validated.presetSkills = presetSkills;
  }

  return validated;
}

function parseAgentMarketplaceCatalog(content: string): AgentMarketplaceCatalog {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch (error) {
    throw new Error('[agent-marketplace] Catalog file is invalid', { cause: error });
  }

  if (!Array.isArray(parsed)) {
    throw new Error('[agent-marketplace] Catalog file must contain an array');
  }

  const catalog = parsed.map((entry, index) => validateCatalogEntry(entry, index));
  const seenAgentIds = new Set<string>();

  for (const entry of catalog) {
    if (seenAgentIds.has(entry.agentId)) {
      throw new Error(`[agent-marketplace] duplicate agentId "${entry.agentId}"`);
    }
    seenAgentIds.add(entry.agentId);
  }

  return catalog;
}

async function loadAgentMarketplaceCatalogFromRemote(catalogUrl: string): Promise<AgentMarketplaceCatalog> {
  const response = await fetch(catalogUrl);
  if (!response.ok) {
    throw new Error(`[agent-marketplace] Failed to fetch catalog: HTTP ${response.status}`);
  }

  return parseAgentMarketplaceCatalog(await response.text());
}

function resolveAgentMarketplaceCatalogRemoteUrl(): string | null {
  const overrideUrl = process.env.GEECLAW_AGENT_MARKETPLACE_CATALOG_URL?.trim();
  if (overrideUrl) {
    return overrideUrl;
  }

  if (app.isPackaged) {
    return getAgentMarketplaceCatalogUrl();
  }

  return null;
}

export async function loadAgentMarketplaceCatalog(
  catalogPath?: string,
): Promise<AgentMarketplaceCatalog> {
  if (catalogPath) {
    return parseAgentMarketplaceCatalog(await readFile(catalogPath, 'utf8'));
  }

  const remoteUrl = resolveAgentMarketplaceCatalogRemoteUrl();
  if (remoteUrl) {
    return await loadAgentMarketplaceCatalogFromRemote(remoteUrl);
  }

  return parseAgentMarketplaceCatalog(await readFile(getAgentMarketplaceCatalogPath(), 'utf8'));
}

export async function loadAgentMarketplacePackageFromDir(
  packageDir: string,
  catalogEntry: AgentMarketplaceCatalogEntry,
): Promise<AgentPresetPackage> {
  const preset = await loadAgentPresetPackageFromDir(packageDir, {
    packageLabel: `catalog agentId ${catalogEntry.agentId} at "${packageDir}"`,
    strictTopLevelEntries: true,
  });

  if (preset.meta.agent.id !== catalogEntry.agentId) {
    throw new Error(
      `[agent-marketplace] Package meta.agent.id "${preset.meta.agent.id}" does not match catalog agentId "${catalogEntry.agentId}"`,
    );
  }

  if (preset.meta.packageVersion !== catalogEntry.version) {
    throw new Error(
      `[agent-marketplace] Package meta.packageVersion "${preset.meta.packageVersion ?? '<missing>'}" does not match catalog version "${catalogEntry.version}"`,
    );
  }

  return preset;
}
