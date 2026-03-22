/**
 * ClawHub Service
 * Manages interactions with skill marketplace CLIs for skills management.
 */
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { app, shell } from 'electron';
import { getOpenClawConfigDir, getResourcesDir, ensureDir, quoteForCmd } from '../utils/paths';
import {
    getSkillHubInstallLocations,
    installSkillHubCli,
    isSkillHubInstalledAtKnownLocation,
    readInstalledSkillHubVersion,
} from '../utils/skillhub-installer';
import { checkUvInstalled, isPythonReady } from '../utils/uv-setup';

export interface ClawHubSearchParams {
    query: string;
    limit?: number;
}

export interface ClawHubInstallParams {
    slug: string;
    version?: string;
    force?: boolean;
}

export interface ClawHubUninstallParams {
    slug?: string;
    skillKey?: string;
    baseDir?: string;
}

export interface ClawHubSkillResult {
    slug: string;
    name: string;
    description: string;
    version: string;
    homepage?: string;
    author?: string;
    downloads?: number;
    stars?: number;
    installs?: number;
    tags?: string[];
    featured?: boolean;
    category?: string;
    description_zh?: string;
    ownerName?: string;
    score?: number;
    updated_at?: number;
}

export interface ClawHubCategoryInfo {
    id: string;
    name: string;
}

export interface ClawHubCategorySkillsParams {
    page?: number;
    pageSize?: number;
    sortBy?: string;
    order?: string;
    category: string;
    keyword?: string;
}

export interface ClawHubCategorySkillsResult {
    skills: ClawHubSkillResult[];
    total: number;
}

export interface ClawHubInstalledSkillResult {
    slug: string;
    version: string;
    source?: string;
    baseDir?: string;
}

interface SkillBundleIndexEntry {
    slug: string;
    name?: string;
    homepage?: string;
    version?: string;
    description?: string;
    description_zh?: string;
    author?: string;
    downloads?: number;
    stars?: number;
    installs?: number;
    tags?: string[];
    updated_at?: number;
    score?: number;
}

interface SkillBundlesIndex {
    total?: number;
    generated_at?: string;
    featured?: string[];
    categories?: Record<string, string[]>;
    skills?: SkillBundleIndexEntry[];
    bundles?: Array<{
        skills?: string[];
        recommended?: boolean;
    }>;
}

interface ClawHubCatalogResult {
    total?: number;
    generatedAt?: string;
    skills: ClawHubSkillResult[];
    featured: string[];
    categories: Record<string, string[]>;
}

export interface SkillHubStatusResult {
    available: boolean;
    path?: string;
    version?: string;
    autoInstallSupported: boolean;
    uvAvailable: boolean;
    pythonReady: boolean;
    preferredBackend: SkillMarketplaceCliName | 'none';
}

type SkillMarketplaceCliName = 'clawhub' | 'skillhub';

interface SkillMarketplaceCliCandidate {
    name: SkillMarketplaceCliName;
    binName: string;
    cliPath: string;
    cliEntryPath?: string;
    useNodeRunner: boolean;
}

interface SkillLockfile {
    version?: number;
    skills?: Record<string, {
        version?: string;
        installedAt?: number;
    }>;
}

export class ClawHubService {
    private workDir: string;
    private cliCandidates: SkillMarketplaceCliCandidate[];
    private marketplaceCatalogCache: ClawHubCatalogResult | null = null;

    constructor() {
        // Use the user's OpenClaw config directory (~/.openclaw) for skill management
        // This avoids installing skills into the project's openclaw submodule
        this.workDir = getOpenClawConfigDir();
        ensureDir(this.workDir);

        this.cliCandidates = this.resolveCliCandidates();
    }

    private extractFrontmatterName(skillManifestPath: string): string | null {
        try {
            const raw = fs.readFileSync(skillManifestPath, 'utf8');
            const frontmatterMatch = raw.match(/^---\s*\n([\s\S]*?)\n---/);
            if (!frontmatterMatch) return null;
            const body = frontmatterMatch[1];
            const nameMatch = body.match(/^\s*name\s*:\s*["']?([^"'\n]+)["']?\s*$/m);
            if (!nameMatch) return null;
            const name = nameMatch[1].trim();
            return name || null;
        } catch {
            return null;
        }
    }

    private resolveSkillDirByManifestName(candidates: string[]): string | null {
        const skillsRoot = path.join(this.workDir, 'skills');
        if (!fs.existsSync(skillsRoot)) return null;

        const wanted = new Set(
            candidates
                .map((value) => value.trim().toLowerCase())
                .filter((value) => value.length > 0),
        );
        if (wanted.size === 0) return null;

        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(skillsRoot, { withFileTypes: true });
        } catch {
            return null;
        }

        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const skillDir = path.join(skillsRoot, entry.name);
            const skillManifestPath = path.join(skillDir, 'SKILL.md');
            if (!fs.existsSync(skillManifestPath)) continue;

            const frontmatterName = this.extractFrontmatterName(skillManifestPath);
            if (!frontmatterName) continue;
            if (wanted.has(frontmatterName.toLowerCase())) {
                return skillDir;
            }
        }

        return null;
    }

    private normalizeMarketplaceSkill(skill: SkillBundleIndexEntry): ClawHubSkillResult {
        return {
            slug: skill.slug,
            name: skill.name || skill.slug,
            version: skill.version || 'latest',
            description: skill.description_zh || skill.description || '',
            homepage: skill.homepage,
            author: skill.author,
            downloads: skill.downloads,
            stars: skill.stars,
            installs: skill.installs,
            tags: Array.isArray(skill.tags) ? skill.tags : [],
        };
    }

    private buildCategoryIndex(
        allSkills: ClawHubSkillResult[],
        categories: Record<string, string[]> = {},
    ): Record<string, string[]> {
        const tagMap = new Map<string, string[]>();

        for (const skill of allSkills) {
            for (const tag of skill.tags || []) {
                const normalizedTag = tag.trim().toLowerCase();
                if (!normalizedTag) continue;
                const existing = tagMap.get(normalizedTag);
                if (existing) {
                    existing.push(skill.slug);
                } else {
                    tagMap.set(normalizedTag, [skill.slug]);
                }
            }
        }

        const mergedCategories: Record<string, string[]> = {};

        for (const [categoryName, tags] of Object.entries(categories)) {
            const seen = new Set<string>();
            const slugs: string[] = [];

            for (const tag of tags) {
                const matches = tagMap.get(tag.trim().toLowerCase()) || [];
                for (const slug of matches) {
                    if (seen.has(slug)) continue;
                    seen.add(slug);
                    slugs.push(slug);
                }
            }

            mergedCategories[categoryName] = slugs;
        }

        return mergedCategories;
    }

    private resolveCliCandidates(): SkillMarketplaceCliCandidate[] {
        const orderedNames: SkillMarketplaceCliName[] = ['skillhub', 'clawhub'];
        return orderedNames
            .map((name) => this.resolveCliCandidate(name))
            .filter((candidate): candidate is SkillMarketplaceCliCandidate => candidate !== null);
    }

    private resolveCliCandidate(name: SkillMarketplaceCliName): SkillMarketplaceCliCandidate | null {
        const systemCandidate = this.resolveSystemCliCandidate(name);
        if (systemCandidate) {
            return systemCandidate;
        }

        const appPath = app.getAppPath();
        const packageDir = path.join(appPath, 'node_modules', name);
        const packageJsonPath = path.join(packageDir, 'package.json');

        if (!fs.existsSync(packageJsonPath)) {
            return null;
        }

        try {
            const raw = fs.readFileSync(packageJsonPath, 'utf8');
            const parsed = JSON.parse(raw) as { bin?: string | Record<string, string> };
            const binField = parsed.bin;

            let binEntry: string | null = null;
            if (typeof binField === 'string') {
                binEntry = binField;
            } else if (binField && typeof binField === 'object') {
                const namedEntry = binField[name];
                if (typeof namedEntry === 'string' && namedEntry.trim()) {
                    binEntry = namedEntry;
                } else {
                    const firstEntry = Object.values(binField).find((value) => typeof value === 'string' && value.trim());
                    if (typeof firstEntry === 'string') {
                        binEntry = firstEntry;
                    }
                }
            }

            if (!binEntry) {
                return null;
            }

            const cliEntryPath = path.join(packageDir, binEntry);
            const binFileName = process.platform === 'win32' ? `${name}.cmd` : name;
            const binPath = path.join(appPath, 'node_modules', '.bin', binFileName);
            const useNodeRunner = app.isPackaged || !fs.existsSync(binPath);
            const cliPath = useNodeRunner ? process.execPath : binPath;

            if (useNodeRunner && !fs.existsSync(cliEntryPath)) {
                return null;
            }

            return {
                name,
                binName: name,
                cliPath,
                cliEntryPath,
                useNodeRunner,
            };
        } catch (error) {
            console.warn(`Failed to resolve ${name} CLI candidate:`, error);
            return null;
        }
    }

    private resolveSystemCliCandidate(name: SkillMarketplaceCliName): SkillMarketplaceCliCandidate | null {
        const knownInstallLocations = getSkillHubInstallLocations();
        const pathEntries = (process.env.PATH || '')
            .split(path.delimiter)
            .map((entry) => entry.trim())
            .filter(Boolean);
        const homeDirs = [
            process.env.HOME?.trim(),
            process.platform === 'win32' ? process.env.USERPROFILE?.trim() : undefined,
            knownInstallLocations.homeDir.trim(),
        ].filter((value): value is string => Boolean(value));
        const preferredEntries = [
            ...(name === 'skillhub' ? [knownInstallLocations.binDir] : []),
            ...homeDirs.flatMap((homeDir) => [
                path.join(homeDir, '.local', 'bin'),
                path.join(homeDir, '.skillhub', 'bin'),
            ]),
            ...pathEntries,
        ];
        const seenPaths = new Set<string>();
        const executableNames = process.platform === 'win32'
            ? [`${name}.cmd`, `${name}.exe`, `${name}.bat`, name]
            : [name];

        for (const entry of preferredEntries) {
            for (const executableName of executableNames) {
                const candidatePath = path.join(entry, executableName);
                if (seenPaths.has(candidatePath)) {
                    continue;
                }
                seenPaths.add(candidatePath);

                if (!fs.existsSync(candidatePath)) {
                    continue;
                }

                return {
                    name,
                    binName: executableName,
                    cliPath: candidatePath,
                    useNodeRunner: false,
                };
            }
        }

        return null;
    }

    private getOrderedCliCandidates(preferredOrder?: SkillMarketplaceCliName[]): SkillMarketplaceCliCandidate[] {
        const order: SkillMarketplaceCliName[] = preferredOrder && preferredOrder.length > 0
            ? preferredOrder
            : ['skillhub', 'clawhub'];
        const byName = new Map(this.cliCandidates.map((candidate) => [candidate.name, candidate]));
        const ordered: SkillMarketplaceCliCandidate[] = [];

        for (const name of order) {
            const candidate = byName.get(name);
            if (candidate) {
                ordered.push(candidate);
            }
        }

        for (const candidate of this.cliCandidates) {
            if (!ordered.some((entry) => entry.name === candidate.name)) {
                ordered.push(candidate);
            }
        }

        return ordered;
    }

    private isRateLimitError(error: unknown): boolean {
        const message = String(error).toLowerCase();
        return message.includes('rate limit') || message.includes('429');
    }

    private getManagedLockfilePaths(): string[] {
        return [
            path.join(this.workDir, '.clawhub', 'lock.json'),
            path.join(this.workDir, '.clawdhub', 'lock.json'),
        ];
    }

    private readManagedLockfile(): SkillLockfile {
        const mergedLock: SkillLockfile = { version: 1, skills: {} };
        let hasParsedLockfile = false;

        for (const candidatePath of this.getManagedLockfilePaths()) {
            if (!fs.existsSync(candidatePath)) {
                continue;
            }

            try {
                const raw = fs.readFileSync(candidatePath, 'utf8');
                const parsed = JSON.parse(raw) as SkillLockfile;
                if (parsed && typeof parsed === 'object') {
                    hasParsedLockfile = true;
                    if (typeof parsed.version === 'number') {
                        mergedLock.version = parsed.version;
                    }
                    if (parsed.skills && typeof parsed.skills === 'object') {
                        mergedLock.skills = {
                            ...(mergedLock.skills || {}),
                            ...parsed.skills,
                        };
                    }
                }
            } catch (error) {
                console.warn(`Failed to read skill lockfile at ${candidatePath}:`, error);
            }
        }

        return hasParsedLockfile ? mergedLock : { version: 1, skills: {} };
    }

    private resolveUninstallTargets(params: ClawHubUninstallParams): {
        skillDir: string | null;
        lockKeys: string[];
    } {
        const lockKeys = new Set<string>();
        const normalizedSlug = params.slug?.trim();
        const normalizedSkillKey = params.skillKey?.trim();

        if (normalizedSlug) {
            lockKeys.add(normalizedSlug);
        }
        if (normalizedSkillKey) {
            lockKeys.add(normalizedSkillKey);
        }

        const skillDir = this.resolveSkillDir(
            normalizedSkillKey || normalizedSlug || '',
            normalizedSlug,
            params.baseDir,
        );

        if (skillDir) {
            lockKeys.add(path.basename(skillDir));
            const manifestName = this.extractFrontmatterName(path.join(skillDir, 'SKILL.md'));
            if (manifestName) {
                lockKeys.add(manifestName);
            }
        }

        return {
            skillDir,
            lockKeys: [...lockKeys],
        };
    }

    private isSkillInstalledLocally(slug: string): boolean {
        const normalizedSlug = slug.trim();
        if (!normalizedSlug) {
            return false;
        }

        const skillDir = path.join(this.workDir, 'skills', normalizedSlug);
        if (fs.existsSync(skillDir)) {
            return true;
        }

        const lock = this.readManagedLockfile();
        return Boolean(lock.skills?.[normalizedSlug]);
    }

    async getMarketplaceCatalog(): Promise<ClawHubCatalogResult> {
        if (this.marketplaceCatalogCache) {
            return this.marketplaceCatalogCache;
        }

        const candidatePaths = [
            path.join(getResourcesDir(), 'skills', 'skills.json'),
        ];

        let lastError: unknown = null;

        for (const candidatePath of candidatePaths) {
            if (!fs.existsSync(candidatePath)) {
                continue;
            }

            try {
                const raw = await fs.promises.readFile(candidatePath, 'utf-8');
                const parsed = JSON.parse(raw) as SkillBundlesIndex;

                if (Array.isArray(parsed.featured) && Array.isArray(parsed.skills)) {
                    const allSkills = parsed.skills.map((skill) => this.normalizeMarketplaceSkill(skill));
                    const skillsBySlug = new Map(allSkills.map((skill) => [skill.slug, skill]));
                    const featured = parsed.featured
                        .slice(0, 50)
                        .filter((slug) => skillsBySlug.has(slug));

                    this.marketplaceCatalogCache = {
                        total: parsed.total || allSkills.length,
                        generatedAt: parsed.generated_at,
                        skills: allSkills,
                        featured,
                        categories: this.buildCategoryIndex(allSkills, parsed.categories),
                    };

                    return this.marketplaceCatalogCache;
                }
            } catch (error) {
                lastError = error;
            }
        }

        throw new Error(
            `Failed to load local skills catalog. Checked: ${candidatePaths.join(' | ')}${lastError ? `; last error: ${String(lastError)}` : ''}`,
        );
    }

    /**
     * Run a ClawHub CLI command
     */
    private async runCommand(
        args: string[],
        options: {
            preferredOrder?: SkillMarketplaceCliName[];
            retryOnRateLimit?: boolean;
        } = {},
    ): Promise<string> {
        const candidates = this.getOrderedCliCandidates(options.preferredOrder);

        if (candidates.length === 0) {
            throw new Error('No skill marketplace CLI found. Expected one of: clawhub, skillhub');
        }

        let lastError: unknown = null;

        for (let index = 0; index < candidates.length; index += 1) {
            const candidate = candidates[index];

            try {
                return await this.runCommandWithCandidate(candidate, args);
            } catch (error) {
                lastError = error;
                const hasNextCandidate = index < candidates.length - 1;
                const shouldRetryWithFallback = hasNextCandidate
                    && options.retryOnRateLimit
                    && this.isRateLimitError(error);

                if (!shouldRetryWithFallback) {
                    throw error;
                }

                console.warn(
                    `${candidate.name} install hit rate limit, retrying with ${candidates[index + 1].name}: ${String(error)}`,
                );
            }
        }

        throw lastError instanceof Error ? lastError : new Error(String(lastError));
    }

    private async runCommandWithCandidate(candidate: SkillMarketplaceCliCandidate, args: string[]): Promise<string> {
        return new Promise((resolve, reject) => {
            if (candidate.useNodeRunner && (!candidate.cliEntryPath || !fs.existsSync(candidate.cliEntryPath))) {
                reject(new Error(`${candidate.name} CLI entry not found at: ${candidate.cliEntryPath}`));
                return;
            }

            if (!candidate.useNodeRunner && !fs.existsSync(candidate.cliPath)) {
                reject(new Error(`${candidate.name} CLI not found at: ${candidate.cliPath}`));
                return;
            }

            const normalizedArgs = this.normalizeArgsForCandidate(candidate, args);
            const commandArgs = candidate.useNodeRunner && candidate.cliEntryPath
                ? [candidate.cliEntryPath, ...normalizedArgs]
                : normalizedArgs;
            const displayCommand = [candidate.cliPath, ...commandArgs].join(' ');
            console.log(`Running ${candidate.name} command: ${displayCommand}`);

            const isWin = process.platform === 'win32';
            const useShell = isWin && !candidate.useNodeRunner;
            const { NODE_OPTIONS: _nodeOptions, ...baseEnv } = process.env;
            const env = {
                ...baseEnv,
                CI: 'true',
                FORCE_COLOR: '0',
                CLAWHUB_WORKDIR: this.workDir,
            } as NodeJS.ProcessEnv;

            if (candidate.useNodeRunner) {
                env.ELECTRON_RUN_AS_NODE = '1';
            }

            const spawnCmd = useShell ? quoteForCmd(candidate.cliPath) : candidate.cliPath;
            const spawnArgs = useShell ? commandArgs.map((arg) => quoteForCmd(arg)) : commandArgs;
            const child = spawn(spawnCmd, spawnArgs, {
                cwd: this.workDir,
                shell: useShell,
                env,
                windowsHide: true,
            });

            let stdout = '';
            let stderr = '';

            child.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            child.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            child.on('error', (error) => {
                console.error(`${candidate.name} process error:`, error);
                reject(error);
            });

            child.on('close', (code) => {
                if (code !== 0 && code !== null) {
                    console.error(`${candidate.name} command failed with code ${code}`);
                    console.error('Stderr:', stderr);
                    reject(new Error(`Command failed: ${stderr || stdout}`));
                } else {
                    resolve(stdout.trim());
                }
            });
        });
    }

    private normalizeArgsForCandidate(candidate: SkillMarketplaceCliCandidate, args: string[]): string[] {
        if (candidate.name !== 'skillhub' || args[0] !== 'install') {
            return [...args];
        }

        const normalized: string[] = [];
        for (let index = 0; index < args.length; index += 1) {
            const value = args[index];
            if (value === '--version') {
                const requestedVersion = args[index + 1];
                console.warn(
                    `skillhub does not support version-pinned install requests; ignoring requested version "${requestedVersion || ''}"`,
                );
                index += 1;
                continue;
            }
            normalized.push(value);
        }

        return normalized;
    }

    /**
     * Search for skills
     */
    async search(params: ClawHubSearchParams): Promise<ClawHubSkillResult[]> {
        try {
            const catalog = await this.getMarketplaceCatalog();
            const query = params.query?.trim().toLowerCase() || '';
            const filtered = !query
                ? catalog.skills
                : catalog.skills.filter((skill) =>
                    skill.slug.toLowerCase().includes(query)
                    || skill.name.toLowerCase().includes(query)
                    || skill.description.toLowerCase().includes(query)
                    || (skill.tags || []).some((tag) => tag.toLowerCase().includes(query))
                );

            if (params.limit && params.limit > 0) {
                return filtered.slice(0, params.limit);
            }

            return filtered;
        } catch (error) {
            console.error('ClawHub search error:', error);
            throw error;
        }
    }

    /**
     * Explore trending skills
     */
    async explore(params: { limit?: number } = {}): Promise<ClawHubSkillResult[]> {
        try {
            const catalog = await this.getMarketplaceCatalog();
            const skillsBySlug = new Map(catalog.skills.map((skill) => [skill.slug, skill]));
            const featuredSkills = catalog.featured
                .map((slug) => skillsBySlug.get(slug))
                .filter((skill): skill is ClawHubSkillResult => Boolean(skill));
            if (params.limit && params.limit > 0) {
                return featuredSkills.slice(0, params.limit);
            }
            return featuredSkills;
        } catch (error) {
            console.error('ClawHub explore error:', error);
            throw error;
        }
    }

    async getCatalog(): Promise<ClawHubCatalogResult> {
        return this.getMarketplaceCatalog();
    }

    /**
     * Get featured skills from top.json
     */
    async getFeaturedSkills(): Promise<ClawHubSkillResult[]> {
        const topJsonPath = path.join(getResourcesDir(), 'skills', 'top.json');
        if (!fs.existsSync(topJsonPath)) {
            console.warn('top.json not found at:', topJsonPath);
            return [];
        }
        try {
            const raw = await fs.promises.readFile(topJsonPath, 'utf-8');
            const parsed = JSON.parse(raw) as Array<{
                slug: string;
                name?: string;
                description?: string;
                description_zh?: string;
                version?: string;
                homepage?: string;
                ownerName?: string;
                downloads?: number;
                stars?: number;
                installs?: number;
                score?: number;
                tags?: string[];
                category?: string;
                updated_at?: number;
            }>;
            if (!Array.isArray(parsed)) {
                return [];
            }
            return parsed.map((skill) => ({
                slug: skill.slug,
                name: skill.name || skill.slug,
                description: skill.description_zh || skill.description || '',
                version: skill.version || 'latest',
                homepage: skill.homepage,
                author: skill.ownerName,
                downloads: skill.downloads,
                stars: skill.stars,
                installs: skill.installs,
                tags: Array.isArray(skill.tags) ? skill.tags : [],
                category: skill.category,
                description_zh: skill.description_zh,
                ownerName: skill.ownerName,
                score: skill.score,
                updated_at: skill.updated_at,
            }));
        } catch (error) {
            console.error('Failed to read top.json:', error);
            return [];
        }
    }

    /**
     * Get category list from category.json
     */
    async getCategoryList(): Promise<ClawHubCategoryInfo[]> {
        const categoryJsonPath = path.join(getResourcesDir(), 'skills', 'category.json');
        if (!fs.existsSync(categoryJsonPath)) {
            console.warn('category.json not found at:', categoryJsonPath);
            return [];
        }
        try {
            const raw = await fs.promises.readFile(categoryJsonPath, 'utf-8');
            const parsed = JSON.parse(raw) as Array<{ id: string; name: string }>;
            if (!Array.isArray(parsed)) {
                return [];
            }
            return parsed.map((cat) => ({ id: cat.id, name: cat.name }));
        } catch (error) {
            console.error('Failed to read category.json:', error);
            return [];
        }
    }

    /**
     * Fetch skills for a category from the remote API
     */
    async fetchCategorySkills(params: ClawHubCategorySkillsParams): Promise<ClawHubCategorySkillsResult> {
        const {
            page = 1,
            pageSize = 24,
            sortBy = 'score',
            order = 'desc',
            category,
            keyword = '',
        } = params;

        const url = new URL('https://lightmake.site/api/skills');
        url.searchParams.set('page', String(page));
        url.searchParams.set('pageSize', String(pageSize));
        url.searchParams.set('sortBy', sortBy);
        url.searchParams.set('order', order);
        url.searchParams.set('category', category);
        url.searchParams.set('keyword', keyword);

        const response = await fetch(url.toString(), {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch category skills: HTTP ${response.status}`);
        }

        const json = (await response.json()) as {
            code: number;
            message: string;
            data: {
                skills: Array<{
                    slug: string;
                    name?: string;
                    description?: string;
                    description_zh?: string;
                    version?: string;
                    homepage?: string;
                    ownerName?: string;
                    downloads?: number;
                    stars?: number;
                    installs?: number;
                    score?: number;
                    tags?: string[] | null;
                    category?: string;
                    updated_at?: number;
                }>;
                total: number;
            };
        };

        if (json.code !== 0) {
            throw new Error(`API error: ${json.message}`);
        }

        const skills: ClawHubSkillResult[] = (json.data.skills || []).map((skill) => ({
            slug: skill.slug,
            name: skill.name || skill.slug,
            description: skill.description_zh || skill.description || '',
            version: skill.version || 'latest',
            homepage: skill.homepage,
            author: skill.ownerName,
            downloads: skill.downloads,
            stars: skill.stars,
            installs: skill.installs,
            tags: Array.isArray(skill.tags) ? skill.tags : [],
            category: skill.category,
            description_zh: skill.description_zh,
            ownerName: skill.ownerName,
            score: skill.score,
            updated_at: skill.updated_at,
        }));

        return { skills, total: json.data.total || 0 };
    }

    async getSkillHubStatus(): Promise<SkillHubStatusResult> {
        const skillhubCandidate = this.cliCandidates.find((candidate) => candidate.name === 'skillhub');
        const fallbackCandidate = this.cliCandidates.find((candidate) => candidate.name === 'clawhub');
        const knownLocations = getSkillHubInstallLocations();
        const wrapperExists = fs.existsSync(knownLocations.wrapperPath);
        const cliExists = fs.existsSync(knownLocations.cliPath);
        const pathHint = skillhubCandidate?.cliPath
            || (wrapperExists ? knownLocations.wrapperPath : cliExists ? knownLocations.cliPath : undefined);
        const version = skillhubCandidate
            ? await this.readCliVersion(skillhubCandidate).catch(() => readInstalledSkillHubVersion())
            : await readInstalledSkillHubVersion();
        const uvAvailable = await checkUvInstalled().catch(() => false);
        const pythonReady = await isPythonReady().catch(() => false);

        return {
            available: Boolean(skillhubCandidate || wrapperExists || cliExists || isSkillHubInstalledAtKnownLocation()),
            path: pathHint,
            version: version || undefined,
            autoInstallSupported: true,
            uvAvailable,
            pythonReady,
            preferredBackend: skillhubCandidate
                ? 'skillhub'
                : fallbackCandidate
                    ? 'clawhub'
                    : 'none',
        };
    }

    async installSkillHub(): Promise<SkillHubStatusResult> {
        const existing = await this.getSkillHubStatus();
        if (!existing.available || existing.preferredBackend !== 'skillhub') {
            const result = await installSkillHubCli();
            console.log(`SkillHub CLI installed at ${result.wrapperPath}`);
            this.cliCandidates = this.resolveCliCandidates();
        }

        return await this.getSkillHubStatus();
    }

    /**
     * Install a skill
     */
    async install(params: ClawHubInstallParams): Promise<void> {
        if (!params.force && this.isSkillInstalledLocally(params.slug)) {
            console.log(`Skipping install for already-installed skill: ${params.slug}`);
            return;
        }

        const args = ['install', params.slug];

        if (params.version) {
            args.push('--version', params.version);
        }

        if (params.force) {
            args.push('--force');
        }

        await this.runCommand(args, {
            preferredOrder: ['skillhub', 'clawhub'],
            retryOnRateLimit: true,
        });
    }

    /**
     * Uninstall a skill
     */
    async uninstall(params: ClawHubUninstallParams): Promise<void> {
        const fsPromises = fs.promises;
        const { skillDir, lockKeys } = this.resolveUninstallTargets(params);

        // 1. Delete the skill directory
        if (skillDir && fs.existsSync(skillDir)) {
            console.log(`Deleting skill directory: ${skillDir}`);
            await fsPromises.rm(skillDir, { recursive: true, force: true });
        }

        // 2. Remove from all managed lockfiles
        for (const lockFile of this.getManagedLockfilePaths()) {
            if (!fs.existsSync(lockFile)) {
                continue;
            }

            try {
                const lockData = JSON.parse(fs.readFileSync(lockFile, 'utf8')) as SkillLockfile;
                if (!lockData.skills || typeof lockData.skills !== 'object') {
                    continue;
                }

                let didUpdate = false;
                for (const key of lockKeys) {
                    if (!key || !lockData.skills[key]) {
                        continue;
                    }
                    console.log(`Removing ${key} from ${lockFile}`);
                    delete lockData.skills[key];
                    didUpdate = true;
                }

                if (didUpdate) {
                    await fsPromises.writeFile(lockFile, JSON.stringify(lockData, null, 2));
                }
            } catch (err) {
                console.error(`Failed to update skill lock file at ${lockFile}:`, err);
            }
        }
    }

    /**
     * List installed skills
     */
    async listInstalled(): Promise<ClawHubInstalledSkillResult[]> {
        try {
            const lock = this.readManagedLockfile();
            const entries = Object.entries(lock.skills || {});

            return entries.map(([slug, entry]) => ({
                slug,
                version: entry.version || 'latest',
                source: 'openclaw-managed',
                baseDir: path.join(this.workDir, 'skills', slug),
            }));
        } catch (error) {
            console.error('ClawHub list error:', error);
            return [];
        }
    }

    private resolveSkillDir(skillKeyOrSlug: string, fallbackSlug?: string, preferredBaseDir?: string): string | null {
        const candidates = [skillKeyOrSlug, fallbackSlug]
            .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
            .map((value) => value.trim());
        const uniqueCandidates = [...new Set(candidates)];
        if (preferredBaseDir && preferredBaseDir.trim() && fs.existsSync(preferredBaseDir.trim())) {
            return preferredBaseDir.trim();
        }
        const directSkillDir = uniqueCandidates
            .map((id) => path.join(this.workDir, 'skills', id))
            .find((dir) => fs.existsSync(dir));
        return directSkillDir || this.resolveSkillDirByManifestName(uniqueCandidates);
    }

    /**
     * Open skill README/manual in default editor
     */
    async openSkillReadme(skillKeyOrSlug: string, fallbackSlug?: string, preferredBaseDir?: string): Promise<boolean> {
        const skillDir = this.resolveSkillDir(skillKeyOrSlug, fallbackSlug, preferredBaseDir);

        // Try to find documentation file
        const possibleFiles = ['SKILL.md', 'README.md', 'skill.md', 'readme.md'];
        let targetFile = '';

        if (skillDir) {
            for (const file of possibleFiles) {
                const filePath = path.join(skillDir, file);
                if (fs.existsSync(filePath)) {
                    targetFile = filePath;
                    break;
                }
            }
        }

        if (!targetFile) {
            // If no md file, just open the directory
            if (skillDir) {
                targetFile = skillDir;
            } else {
                throw new Error('Skill directory not found');
            }
        }

        try {
            // Open file with default application
            await shell.openPath(targetFile);
            return true;
        } catch (error) {
            console.error('Failed to open skill readme:', error);
            throw error;
        }
    }

    async openSkillPath(skillKeyOrSlug: string, fallbackSlug?: string, preferredBaseDir?: string): Promise<boolean> {
        const skillDir = this.resolveSkillDir(skillKeyOrSlug, fallbackSlug, preferredBaseDir);
        if (!skillDir) {
            throw new Error('Skill directory not found');
        }

        const openResult = await shell.openPath(skillDir);
        if (openResult) {
            throw new Error(openResult);
        }

        return true;
    }

    private async readCliVersion(candidate: SkillMarketplaceCliCandidate): Promise<string | undefined> {
        try {
            const output = await this.runCommandWithCandidate(candidate, ['--version']);
            const normalized = output.trim();
            if (!normalized) {
                return undefined;
            }

            const match = normalized.match(/(\d+(?:\.\d+)+(?:[-a-zA-Z0-9.]*)?)/);
            return match?.[1] || normalized;
        } catch (error) {
            console.warn(`Failed to read ${candidate.name} version:`, error);
            return undefined;
        }
    }
}
