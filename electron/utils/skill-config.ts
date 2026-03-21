/**
 * Skill Config Utilities
 * Direct read/write access to skill configuration in ~/.openclaw-geeclaw/openclaw.json
 * This bypasses the Gateway RPC for faster and more reliable config updates.
 *
 * All file I/O uses async fs/promises to avoid blocking the main thread.
 */
import { readFile, writeFile, cp, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { getOpenClawDir, getOpenClawConfigDir, getResourcesDir } from './paths';
import { logger } from './logger';
import { getAlwaysEnabledSkillKeys, isAlwaysEnabledSkillKey } from './skills-policy';
import { mutateOpenClawConfigDocument, readOpenClawConfigDocument } from './openclaw-config-coordinator';
import { getExplicitSkillToggles, setExplicitSkillToggle } from './store';

interface SkillEntry {
    enabled?: boolean;
    apiKey?: string;
    env?: Record<string, string>;
}

export interface DiscoveredSkillDescriptor {
    skillKey?: string;
    source?: string;
}

interface OpenClawConfig {
    skills?: {
        entries?: Record<string, SkillEntry>;
        [key: string]: unknown;
    };
    [key: string]: unknown;
}

interface PreinstalledSkillSpec {
    slug: string;
    version?: string;
    autoEnable?: boolean;
}

interface PreinstalledManifest {
    skills?: PreinstalledSkillSpec[];
}

interface PreinstalledLockEntry {
    slug: string;
    version?: string;
}

interface PreinstalledLockFile {
    skills?: PreinstalledLockEntry[];
}

interface PreinstalledMarker {
    source: 'geeclaw-preinstalled';
    slug: string;
    version: string;
    installedAt: string;
}

/**
 * Read the current OpenClaw config
 */
async function readConfig(): Promise<OpenClawConfig> {
    try {
        return await readOpenClawConfigDocument() as OpenClawConfig;
    } catch (err) {
        console.error('Failed to read openclaw config:', err);
        return {};
    }
}

async function setSkillsEnabled(skillKeys: string[], enabled: boolean): Promise<void> {
    if (skillKeys.length === 0) {
        return;
    }

    await mutateOpenClawConfigDocument<void>((config) => {
        const skillConfig = config as OpenClawConfig;
        if (!skillConfig.skills) {
            skillConfig.skills = {};
        }
        if (!skillConfig.skills.entries) {
            skillConfig.skills.entries = {};
        }

        let changed = false;
        for (const skillKey of skillKeys) {
            const entry = skillConfig.skills.entries[skillKey] || {};
            const nextChanged = applySkillEnabledState(skillConfig.skills.entries, skillKey, entry, enabled);
            changed = changed || nextChanged;
        }

        return { changed, result: undefined };
    });
}

function applySkillEnabledState(
    entries: Record<string, SkillEntry>,
    skillKey: string,
    currentEntry: SkillEntry,
    enabled: boolean,
): boolean {
    const nextEntry: SkillEntry = { ...currentEntry };

    if (enabled) {
        if (!('enabled' in nextEntry)) {
            return false;
        }

        delete nextEntry.enabled;
        if (Object.keys(nextEntry).length === 0) {
            delete entries[skillKey];
        } else {
            entries[skillKey] = nextEntry;
        }
        return true;
    }

    if (nextEntry.enabled === false) {
        return false;
    }

    nextEntry.enabled = false;
    entries[skillKey] = nextEntry;
    return true;
}

/**
 * Get skill config
 */
export async function getSkillConfig(skillKey: string): Promise<SkillEntry | undefined> {
    const config = await readConfig();
    return config.skills?.entries?.[skillKey];
}

/**
 * Update skill config (apiKey and env)
 */
export async function updateSkillConfig(
    skillKey: string,
    updates: { apiKey?: string; env?: Record<string, string>; enabled?: boolean }
): Promise<{ success: boolean; error?: string }> {
    try {
        await mutateOpenClawConfigDocument<void>((config) => {
            const skillConfig = config as OpenClawConfig;

            if (!skillConfig.skills) {
                skillConfig.skills = {};
            }
            if (!skillConfig.skills.entries) {
                skillConfig.skills.entries = {};
            }

            const entry = skillConfig.skills.entries[skillKey] || {};

            if (updates.apiKey !== undefined) {
                const trimmed = updates.apiKey.trim();
                if (trimmed) {
                    entry.apiKey = trimmed;
                } else {
                    delete entry.apiKey;
                }
            }

            if (updates.env !== undefined) {
                const newEnv: Record<string, string> = {};

                for (const [key, value] of Object.entries(updates.env)) {
                    const trimmedKey = key.trim();
                    if (!trimmedKey) continue;

                    const trimmedVal = value.trim();
                    if (trimmedVal) {
                        newEnv[trimmedKey] = trimmedVal;
                    }
                }

                if (Object.keys(newEnv).length > 0) {
                    entry.env = newEnv;
                } else {
                    delete entry.env;
                }
            }

            if (updates.enabled !== undefined) {
                applySkillEnabledState(skillConfig.skills.entries, skillKey, entry, updates.enabled);
            } else {
                skillConfig.skills.entries[skillKey] = entry;
            }

            if (skillConfig.skills.entries && Object.keys(skillConfig.skills.entries).length === 0) {
                delete skillConfig.skills.entries;
            }
            if (skillConfig.skills && Object.keys(skillConfig.skills).length === 0) {
                delete skillConfig.skills;
            }
            return { changed: true, result: undefined };
        });
        if (updates.enabled !== undefined) {
            await setExplicitSkillToggle(skillKey, updates.enabled);
        }
        return { success: true };
    } catch (err) {
        console.error('Failed to update skill config:', err);
        return { success: false, error: String(err) };
    }
}

/**
 * Get all skill configs (for syncing to frontend)
 */
export async function getAllSkillConfigs(): Promise<Record<string, SkillEntry>> {
    const config = await readConfig();
    return config.skills?.entries || {};
}

/**
 * Ensure discovered skills are explicitly represented in openclaw.json.
 *
 * Newly discovered keys are persisted with { enabled: false } so unexpected
 * auto-discovered skills from non-user-managed locations do not become
 * implicitly enabled in future sessions.
 */
export async function ensureSkillEntriesDefaultDisabled(
    discoveredSkills: Array<string | DiscoveredSkillDescriptor>,
): Promise<{ success: boolean; added: string[]; normalizedAlwaysEnabled: string[]; error?: string }> {
    try {
        const ignoredSources = new Set(['openclaw-managed', 'openclaw-extra', 'openclaw-workspace']);
        const explicitToggles = await getExplicitSkillToggles();
        const explicitEnabledSkillKeys = new Set(explicitToggles.enabledSkills);
        const normalizedSkills = discoveredSkills
            .map((skill) => {
                if (typeof skill === 'string') {
                    return {
                        skillKey: skill.trim(),
                        source: undefined,
                    };
                }
                if (!skill || typeof skill.skillKey !== 'string') {
                    return null;
                }
                const source = typeof skill.source === 'string' ? skill.source.trim() : undefined;
                return {
                    skillKey: skill.skillKey.trim(),
                    source,
                };
            })
            .filter((skill): skill is { skillKey: string; source?: string } => Boolean(skill?.skillKey));

        if (normalizedSkills.length === 0) {
            return { success: true, added: [], normalizedAlwaysEnabled: [] };
        }

        const result = await mutateOpenClawConfigDocument<{ added: string[]; normalizedAlwaysEnabled: string[] }>((config) => {
            const skillConfig = config as OpenClawConfig;
            if (!skillConfig.skills) {
                skillConfig.skills = {};
            }
            if (!skillConfig.skills.entries) {
                skillConfig.skills.entries = {};
            }

            const nextAdded: string[] = [];
            const nextNormalizedAlwaysEnabled: string[] = [];
            const seenSkillKeys = new Set<string>();
            for (const { skillKey, source } of normalizedSkills) {
                if (seenSkillKeys.has(skillKey)) {
                    continue;
                }
                seenSkillKeys.add(skillKey);

                if (isAlwaysEnabledSkillKey(skillKey)) {
                    continue;
                }

                if (source && ignoredSources.has(source)) {
                    continue;
                }

                if (explicitEnabledSkillKeys.has(skillKey)) {
                    continue;
                }

                if (!skillConfig.skills.entries[skillKey]) {
                    skillConfig.skills.entries[skillKey] = { enabled: false };
                    nextAdded.push(skillKey);
                }
            }

            if (Object.keys(skillConfig.skills.entries).length === 0) {
                delete skillConfig.skills.entries;
            }
            if (Object.keys(skillConfig.skills).length === 0) {
                delete skillConfig.skills;
            }

            return {
                changed: nextAdded.length > 0 || nextNormalizedAlwaysEnabled.length > 0,
                result: {
                    added: nextAdded,
                    normalizedAlwaysEnabled: nextNormalizedAlwaysEnabled,
                },
            };
        });

        return { success: true, added: result.added, normalizedAlwaysEnabled: result.normalizedAlwaysEnabled };
    } catch (err) {
        console.error('Failed to ensure default-disabled skill entries:', err);
        return { success: false, added: [], normalizedAlwaysEnabled: [], error: String(err) };
    }
}

/**
 * Re-apply explicit user skill toggles from the app settings store into
 * openclaw.json before Gateway launch.
 */
export async function syncExplicitSkillTogglesToOpenClaw(): Promise<{
    success: boolean;
    enabled: string[];
    disabled: string[];
    error?: string;
}> {
    try {
        const { enabledSkills, disabledSkills } = await getExplicitSkillToggles();
        if (enabledSkills.length === 0 && disabledSkills.length === 0) {
            return { success: true, enabled: [], disabled: [] };
        }

        const result = await mutateOpenClawConfigDocument<{ enabled: string[]; disabled: string[] }>((config) => {
            const skillConfig = config as OpenClawConfig;
            if (!skillConfig.skills) {
                skillConfig.skills = {};
            }
            if (!skillConfig.skills.entries) {
                skillConfig.skills.entries = {};
            }

            const nextEnabled: string[] = [];
            const nextDisabled: string[] = [];

            for (const skillKey of enabledSkills) {
                const entry = skillConfig.skills.entries[skillKey] || {};
                if (applySkillEnabledState(skillConfig.skills.entries, skillKey, entry, true)) {
                    nextEnabled.push(skillKey);
                }
            }

            for (const skillKey of disabledSkills) {
                const entry = skillConfig.skills.entries[skillKey] || {};
                if (applySkillEnabledState(skillConfig.skills.entries, skillKey, entry, false)) {
                    nextDisabled.push(skillKey);
                }
            }

            if (Object.keys(skillConfig.skills.entries).length === 0) {
                delete skillConfig.skills.entries;
            }
            if (Object.keys(skillConfig.skills).length === 0) {
                delete skillConfig.skills;
            }

            return {
                changed: nextEnabled.length > 0 || nextDisabled.length > 0,
                result: {
                    enabled: nextEnabled,
                    disabled: nextDisabled,
                },
            };
        });

        return { success: true, enabled: result.enabled, disabled: result.disabled };
    } catch (err) {
        console.error('Failed to sync explicit skill toggles:', err);
        return { success: false, enabled: [], disabled: [], error: String(err) };
    }
}

/**
 * Built-in skills bundled with GeeClaw that should be pre-deployed to
 * ~/.openclaw-geeclaw/skills/ on first launch. These come from the openclaw package's
 * extensions directory and are available in both dev and packaged builds.
 */
const BUILTIN_SKILLS = [] as const;

/**
 * Ensure built-in skills are deployed to ~/.openclaw-geeclaw/skills/<slug>/.
 * Skips any skill that already has a SKILL.md present (idempotent).
 * Runs at app startup; all errors are logged and swallowed so they never
 * block the normal startup flow.
 */
export async function ensureBuiltinSkillsInstalled(): Promise<void> {
    const skillsRoot = join(getOpenClawConfigDir(), 'skills');

    for (const { slug, sourceExtension } of BUILTIN_SKILLS) {
        const targetDir = join(skillsRoot, slug);
        const targetManifest = join(targetDir, 'SKILL.md');

        if (existsSync(targetManifest)) {
            continue; // already installed
        }

        const openclawDir = getOpenClawDir();
        const sourceDir = join(openclawDir, 'extensions', sourceExtension, 'skills', slug);

        if (!existsSync(join(sourceDir, 'SKILL.md'))) {
            logger.warn(`Built-in skill source not found, skipping: ${sourceDir}`);
            continue;
        }

        try {
            await mkdir(targetDir, { recursive: true });
            await cp(sourceDir, targetDir, { recursive: true });
            logger.info(`Installed built-in skill: ${slug} -> ${targetDir}`);
        } catch (error) {
            logger.warn(`Failed to install built-in skill ${slug}:`, error);
        }
    }
}

const PREINSTALLED_MANIFEST_NAME = 'preinstalled-manifest.json';
const PREINSTALLED_MARKER_NAME = '.geeclaw-preinstalled.json';

async function readPreinstalledManifest(): Promise<PreinstalledSkillSpec[]> {
    const candidates = [
        join(getResourcesDir(), 'skills', PREINSTALLED_MANIFEST_NAME),
        join(process.cwd(), 'resources', 'skills', PREINSTALLED_MANIFEST_NAME),
    ];

    const manifestPath = candidates.find((p) => existsSync(p));
    if (!manifestPath) {
        return [];
    }

    try {
        const raw = await readFile(manifestPath, 'utf-8');
        const parsed = JSON.parse(raw) as PreinstalledManifest;
        if (!Array.isArray(parsed.skills)) {
            return [];
        }
        return parsed.skills.filter((skill): skill is PreinstalledSkillSpec => Boolean(skill?.slug));
    } catch (error) {
        logger.warn('Failed to read preinstalled-skills manifest:', error);
        return [];
    }
}

function resolvePreinstalledSkillsSourceRoot(): string | null {
    const candidates = [
        join(getResourcesDir(), 'preinstalled-skills'),
        join(process.cwd(), 'build', 'preinstalled-skills'),
        join(__dirname, '../../build/preinstalled-skills'),
    ];

    const root = candidates.find((dir) => existsSync(dir));
    return root || null;
}

async function readPreinstalledLockVersions(sourceRoot: string): Promise<Map<string, string>> {
    const lockPath = join(sourceRoot, '.preinstalled-lock.json');
    if (!existsSync(lockPath)) {
        return new Map();
    }

    try {
        const raw = await readFile(lockPath, 'utf-8');
        const parsed = JSON.parse(raw) as PreinstalledLockFile;
        const versions = new Map<string, string>();

        for (const entry of parsed.skills || []) {
            const slug = entry.slug?.trim();
            const version = entry.version?.trim();
            if (slug && version) {
                versions.set(slug, version);
            }
        }

        return versions;
    } catch (error) {
        logger.warn('Failed to read preinstalled-skills lock file:', error);
        return new Map();
    }
}

async function tryReadMarker(markerPath: string): Promise<PreinstalledMarker | null> {
    if (!existsSync(markerPath)) {
        return null;
    }

    try {
        const raw = await readFile(markerPath, 'utf-8');
        const parsed = JSON.parse(raw) as PreinstalledMarker;
        if (!parsed?.slug || !parsed?.version) {
            return null;
        }
        return parsed;
    } catch {
        return null;
    }
}

export async function ensurePreinstalledSkillsInstalled(): Promise<void> {
    const skills = await readPreinstalledManifest();
    if (skills.length === 0) {
        return;
    }

    const sourceRoot = resolvePreinstalledSkillsSourceRoot();
    if (!sourceRoot) {
        logger.warn('Preinstalled skills source root not found; skipping preinstall.');
        return;
    }

    const lockVersions = await readPreinstalledLockVersions(sourceRoot);
    const targetRoot = join(getOpenClawConfigDir(), 'skills');
    await mkdir(targetRoot, { recursive: true });
    const toEnable: string[] = [];

    for (const spec of skills) {
        const sourceDir = join(sourceRoot, spec.slug);
        const sourceManifest = join(sourceDir, 'SKILL.md');
        if (!existsSync(sourceManifest)) {
            logger.warn(`Preinstalled skill source missing SKILL.md, skipping: ${sourceDir}`);
            continue;
        }

        const targetDir = join(targetRoot, spec.slug);
        const targetManifest = join(targetDir, 'SKILL.md');
        const markerPath = join(targetDir, PREINSTALLED_MARKER_NAME);
        const desiredVersion = lockVersions.get(spec.slug)
            || (spec.version || 'unknown').trim()
            || 'unknown';
        const marker = await tryReadMarker(markerPath);

        if (existsSync(targetManifest)) {
            if (!marker) {
                logger.info(`Skipping user-managed skill: ${spec.slug}`);
                continue;
            }
            if (marker.version === desiredVersion) {
                continue;
            }
            logger.info(
                `Skipping preinstalled skill update for ${spec.slug} (local marker version=${marker.version}, desired=${desiredVersion})`,
            );
            continue;
        }

        try {
            await mkdir(targetDir, { recursive: true });
            await cp(sourceDir, targetDir, { recursive: true, force: true });
            const markerPayload: PreinstalledMarker = {
                source: 'geeclaw-preinstalled',
                slug: spec.slug,
                version: desiredVersion,
                installedAt: new Date().toISOString(),
            };
            await writeFile(markerPath, `${JSON.stringify(markerPayload, null, 2)}\n`, 'utf-8');
            if (spec.autoEnable) {
                toEnable.push(spec.slug);
            }
            logger.info(`Installed preinstalled skill: ${spec.slug} -> ${targetDir}`);
        } catch (error) {
            logger.warn(`Failed to install preinstalled skill ${spec.slug}:`, error);
        }
    }

    if (toEnable.length > 0) {
        try {
            await setSkillsEnabled(toEnable, true);
        } catch (error) {
            logger.warn('Failed to auto-enable preinstalled skills:', error);
        }
    }
}

/**
 * Enforce policy-defined always-enabled skills in openclaw.json.
 */
export async function ensureAlwaysEnabledSkillsConfigured(): Promise<{
    success: boolean;
    updated: string[];
    error?: string;
}> {
    try {
        const policyKeys = getAlwaysEnabledSkillKeys();
        if (policyKeys.length === 0) {
            return { success: true, updated: [] };
        }

        const updated = await mutateOpenClawConfigDocument<string[]>((config) => {
            const skillConfig = config as OpenClawConfig;
            if (!skillConfig.skills) {
                skillConfig.skills = {};
            }
            if (!skillConfig.skills.entries) {
                skillConfig.skills.entries = {};
            }

            const nextUpdated: string[] = [];
            for (const skillKey of policyKeys) {
                const entry = skillConfig.skills.entries[skillKey] || {};
                if ('enabled' in entry) {
                    if (applySkillEnabledState(skillConfig.skills.entries, skillKey, entry, true)) {
                        nextUpdated.push(skillKey);
                    }
                } else if (!skillConfig.skills.entries[skillKey]) {
                    // Keep implicit-enable semantics: no config entry means enabled.
                    continue;
                } else {
                    const storedEntry = skillConfig.skills.entries[skillKey];
                    if (storedEntry && 'enabled' in storedEntry) {
                        nextUpdated.push(skillKey);
                    }
                }
            }

            // Clean up any now-empty skills block.
            if (Object.keys(skillConfig.skills.entries).length === 0) {
                delete skillConfig.skills.entries;
            }
            if (Object.keys(skillConfig.skills).length === 0) {
                delete skillConfig.skills;
            }

            return {
                changed: nextUpdated.length > 0,
                result: nextUpdated,
            };
        });

        return { success: true, updated };
    } catch (err) {
        console.error('Failed to enforce always-enabled skills:', err);
        return { success: false, updated: [], error: String(err) };
    }
}
