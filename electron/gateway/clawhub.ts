/**
 * ClawHub Service
 * Manages interactions with the ClawHub CLI for skills management
 */
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { app, shell } from 'electron';
import { getOpenClawConfigDir, getResourcesDir, ensureDir, getClawHubCliBinPath, getClawHubCliEntryPath, quoteForCmd } from '../utils/paths';

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
    slug: string;
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

export class ClawHubService {
    private workDir: string;
    private cliPath: string;
    private cliEntryPath: string;
    private useNodeRunner: boolean;
    private ansiRegex: RegExp;
    private marketplaceCatalogCache: ClawHubCatalogResult | null = null;

    constructor() {
        // Use the user's OpenClaw config directory (~/.openclaw) for skill management
        // This avoids installing skills into the project's openclaw submodule
        this.workDir = getOpenClawConfigDir();
        ensureDir(this.workDir);

        const binPath = getClawHubCliBinPath();
        const entryPath = getClawHubCliEntryPath();

        this.cliEntryPath = entryPath;
        if (!app.isPackaged && fs.existsSync(binPath)) {
            this.cliPath = binPath;
            this.useNodeRunner = false;
        } else {
            this.cliPath = process.execPath;
            this.useNodeRunner = true;
        }
        const esc = String.fromCharCode(27);
        const csi = String.fromCharCode(155);
        const pattern = `(?:${esc}|${csi})[[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]`;
        this.ansiRegex = new RegExp(pattern, 'g');
    }

    private stripAnsi(line: string): string {
        return line.replace(this.ansiRegex, '').trim();
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

    async getMarketplaceCatalog(): Promise<ClawHubCatalogResult> {
        if (this.marketplaceCatalogCache) {
            return this.marketplaceCatalogCache;
        }

        const candidatePaths = [
            path.join(app.getAppPath(), 'src', 'assets', 'skills', 'skills.json'),
            path.join(process.resourcesPath, 'skills', 'skills.json'),
            path.join(getResourcesDir(), 'skills', 'skills.json'),
            path.join(getResourcesDir(), 'skills', 'bundles.json'),
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

                // Backward-compatible fallback for older bundles-only files.
                if (Array.isArray(parsed.bundles)) {
                    const uniqueSlugs = new Set<string>();
                    const orderedSlugs: string[] = [];

                    for (const bundle of parsed.bundles) {
                        if (!Array.isArray(bundle.skills)) continue;
                        for (const slug of bundle.skills) {
                            if (uniqueSlugs.has(slug)) continue;
                            uniqueSlugs.add(slug);
                            orderedSlugs.push(slug);
                            if (orderedSlugs.length >= 50) break;
                        }
                        if (orderedSlugs.length >= 50) break;
                    }

                    const allSkills = orderedSlugs.map((slug) => ({
                        slug,
                        name: slug,
                        version: 'latest',
                        description: '',
                        tags: [],
                    }));

                    this.marketplaceCatalogCache = {
                        total: allSkills.length,
                        skills: allSkills,
                        featured: orderedSlugs,
                        categories: {},
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
    private async runCommand(args: string[]): Promise<string> {
        return new Promise((resolve, reject) => {
            if (this.useNodeRunner && !fs.existsSync(this.cliEntryPath)) {
                reject(new Error(`ClawHub CLI entry not found at: ${this.cliEntryPath}`));
                return;
            }

            if (!this.useNodeRunner && !fs.existsSync(this.cliPath)) {
                reject(new Error(`ClawHub CLI not found at: ${this.cliPath}`));
                return;
            }

            const commandArgs = this.useNodeRunner ? [this.cliEntryPath, ...args] : args;
            const displayCommand = [this.cliPath, ...commandArgs].join(' ');
            console.log(`Running ClawHub command: ${displayCommand}`);

            const isWin = process.platform === 'win32';
            const useShell = isWin && !this.useNodeRunner;
            const { NODE_OPTIONS: _nodeOptions, ...baseEnv } = process.env;
            const env = {
                ...baseEnv,
                CI: 'true',
                FORCE_COLOR: '0',
            };
            if (this.useNodeRunner) {
                env.ELECTRON_RUN_AS_NODE = '1';
            }
            const spawnCmd = useShell ? quoteForCmd(this.cliPath) : this.cliPath;
            const spawnArgs = useShell ? commandArgs.map(a => quoteForCmd(a)) : commandArgs;
            const child = spawn(spawnCmd, spawnArgs, {
                cwd: this.workDir,
                shell: useShell,
                env: {
                    ...env,
                    CLAWHUB_WORKDIR: this.workDir,
                },
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
                console.error('ClawHub process error:', error);
                reject(error);
            });

            child.on('close', (code) => {
                if (code !== 0 && code !== null) {
                    console.error(`ClawHub command failed with code ${code}`);
                    console.error('Stderr:', stderr);
                    reject(new Error(`Command failed: ${stderr || stdout}`));
                } else {
                    resolve(stdout.trim());
                }
            });
        });
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
     * Install a skill
     */
    async install(params: ClawHubInstallParams): Promise<void> {
        const args = ['install', params.slug];

        if (params.version) {
            args.push('--version', params.version);
        }

        if (params.force) {
            args.push('--force');
        }

        await this.runCommand(args);
    }

    /**
     * Uninstall a skill
     */
    async uninstall(params: ClawHubUninstallParams): Promise<void> {
        const fsPromises = fs.promises;

        // 1. Delete the skill directory
        const skillDir = path.join(this.workDir, 'skills', params.slug);
        if (fs.existsSync(skillDir)) {
            console.log(`Deleting skill directory: ${skillDir}`);
            await fsPromises.rm(skillDir, { recursive: true, force: true });
        }

        // 2. Remove from lock.json
        const lockFile = path.join(this.workDir, '.clawhub', 'lock.json');
        if (fs.existsSync(lockFile)) {
            try {
                const lockData = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
                if (lockData.skills && lockData.skills[params.slug]) {
                    console.log(`Removing ${params.slug} from lock.json`);
                    delete lockData.skills[params.slug];
                    await fsPromises.writeFile(lockFile, JSON.stringify(lockData, null, 2));
                }
            } catch (err) {
                console.error('Failed to update ClawHub lock file:', err);
            }
        }
    }

    /**
     * List installed skills
     */
    async listInstalled(): Promise<ClawHubInstalledSkillResult[]> {
        try {
            const output = await this.runCommand(['list']);
            if (!output || output.includes('No installed skills')) {
                return [];
            }

            const lines = output.split('\n').filter(l => l.trim());
            return lines.map(line => {
                const cleanLine = this.stripAnsi(line);
                const match = cleanLine.match(/^(\S+)\s+v?(\d+\.\S+)/);
                if (match) {
                    const slug = match[1];
                    return {
                        slug,
                        version: match[2],
                        source: 'openclaw-managed',
                        baseDir: path.join(this.workDir, 'skills', slug),
                    };
                }
                return null;
            }).filter((s): s is ClawHubInstalledSkillResult => s !== null);
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
}
