/**
 * Skills State Store
 * Manages skill/plugin state
 */
import { create } from 'zustand';
import { hostApiFetch } from '@/lib/host-api';
import { AppError, normalizeAppError } from '@/lib/error-model';
import { invalidatePresetAgentSkillsCache } from '@/pages/Chat/slash-picker';
import { useGatewayStore } from './gateway';
import type { CategoryInfo, MarketplaceCatalog, MarketplaceSkill, Skill, SkillMissingRequirements } from '../types/skill';

type GatewaySkillStatus = {
  skillKey: string;
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

type ClawHubListResult = {
  slug: string;
  version?: string;
  source?: string;
  baseDir?: string;
};

type SkillUninstallTarget = string | {
  slug?: string;
  skillKey?: string;
  baseDir?: string;
};

type SkillPolicyResult = {
  alwaysEnabledSkillKeys?: string[];
  hiddenSkillKeys?: string[];
};

function isHiddenSkill(skillKeys: Array<string | undefined>, hiddenSkillSet: Set<string>): boolean {
  return skillKeys.some((value) => {
    const normalized = value?.trim();
    return Boolean(normalized && hiddenSkillSet.has(normalized));
  });
}

function hasMissingRequirements(missing?: SkillMissingRequirements): boolean {
  if (!missing) return false;
  return Boolean(
    (missing.bins && missing.bins.length > 0)
    || (missing.anyBins && missing.anyBins.length > 0)
    || (missing.env && missing.env.length > 0)
    || (missing.config && missing.config.length > 0)
    || (missing.os && missing.os.length > 0),
  );
}

function mapErrorCodeToSkillErrorKey(
  code: AppError['code'],
  operation: 'fetch' | 'search' | 'install',
): string {
  if (code === 'TIMEOUT') {
    return operation === 'search'
      ? 'searchTimeoutError'
      : operation === 'install'
        ? 'installTimeoutError'
        : 'fetchTimeoutError';
  }
  if (code === 'RATE_LIMIT') {
    return operation === 'search'
      ? 'searchRateLimitError'
      : operation === 'install'
        ? 'installRateLimitError'
        : 'fetchRateLimitError';
  }
  return 'rateLimitError';
}

interface SkillsState {
  skills: Skill[];
  loading: boolean;
  marketplaceCatalog: MarketplaceCatalog | null;
  marketplaceLoading: boolean;
  marketplaceError: string | null;
  installing: Record<string, boolean>; // slug -> boolean
  error: string | null;
  categorySkills: MarketplaceSkill[];
  categorySkillsTotal: number;
  categorySkillsLoading: boolean;

  // Actions
  fetchSkills: (agentId?: string) => Promise<void>;
  fetchMarketplaceCatalog: (force?: boolean) => Promise<void>;
  fetchCategorySkills: (categoryId: string, page: number, keyword: string) => Promise<void>;
  installSkill: (slug: string, version?: string, agentId?: string) => Promise<void>;
  uninstallSkill: (target: SkillUninstallTarget, agentId?: string) => Promise<void>;
  enableSkill: (skillId: string) => Promise<void>;
  disableSkill: (skillId: string) => Promise<void>;
  setSkills: (skills: Skill[]) => void;
  updateSkill: (skillId: string, updates: Partial<Skill>) => void;
}

export const useSkillsStore = create<SkillsState>((set, get) => ({
  skills: [],
  loading: false,
  marketplaceCatalog: null,
  marketplaceLoading: false,
  marketplaceError: null,
  installing: {},
  error: null,
  categorySkills: [],
  categorySkillsTotal: 0,
  categorySkillsLoading: false,

  fetchSkills: async (agentId = 'main') => {
    // Only show loading state if we have no skills yet (initial load)
    if (get().skills.length === 0) {
      set({ loading: true, error: null });
    }
    try {
      const scopedAgentId = typeof agentId === 'string' && agentId.trim() ? agentId.trim() : 'main';

      // 1. Fetch from Gateway (running skills)
      const gatewayData = await useGatewayStore.getState().rpc<GatewaySkillsStatusResult>('skills.status', { agentId: scopedAgentId });

      // Persist newly discovered skills as explicitly disabled in openclaw.json.
      // Explicit user toggles are persisted separately in the app settings
      // store, so a manually enabled skill will not be reclassified as new.
      const discoveredSkills = (gatewayData.skills || [])
        .filter((skill): skill is GatewaySkillStatus & { skillKey: string } => typeof skill.skillKey === 'string' && skill.skillKey.trim().length > 0)
        .map((skill) => ({
          skillKey: skill.skillKey,
          source: skill.source,
        }));
      if (discoveredSkills.length > 0) {
        await hostApiFetch<{ success: boolean; added: string[]; error?: string }>('/api/skills/ensure-entries', {
          method: 'POST',
          body: JSON.stringify({ agentId: scopedAgentId, skills: discoveredSkills }),
        });
      }

      // 2. Fetch from ClawHub (installed on disk)
      const clawhubResult = await hostApiFetch<{ success: boolean; results?: ClawHubListResult[]; error?: string }>(
        `/api/clawhub/list?agentId=${encodeURIComponent(scopedAgentId)}`,
      );

      // 3. Fetch configurations directly from Electron (since Gateway doesn't return them)
      const configResult = await hostApiFetch<Record<string, { apiKey?: string; env?: Record<string, string> }>>(
        `/api/skills/configs?agentId=${encodeURIComponent(scopedAgentId)}`,
      );
      const policyResult = await hostApiFetch<SkillPolicyResult>(`/api/skills/policy?agentId=${encodeURIComponent(scopedAgentId)}`);
      const alwaysEnabledSkillSet = new Set((policyResult.alwaysEnabledSkillKeys || []).filter(Boolean));
      const hiddenSkillSet = new Set((policyResult.hiddenSkillKeys || []).filter(Boolean));

      let combinedSkills: Skill[] = [];
      const currentSkills = get().skills;

      // Map gateway skills info
      if (gatewayData.skills) {
        combinedSkills = gatewayData.skills.map((s: GatewaySkillStatus) => {
          // Merge with direct config if available
          const directConfig = configResult[s.skillKey] || {};
          const blockedByAllowlist = s.blockedByAllowlist === true;
          const missing = s.missing;
          const unavailableForEnable = hasMissingRequirements(missing)
            || blockedByAllowlist
            || (s.eligible === false && !s.disabled);
          const eligible = !unavailableForEnable;
          const isCore = (s.bundled && s.always) || alwaysEnabledSkillSet.has(s.skillKey);
          const hidden = isHiddenSkill([s.skillKey, s.slug], hiddenSkillSet);

          return {
            id: s.skillKey,
            slug: s.slug || s.skillKey,
            name: s.name || s.skillKey,
            description: s.description || '',
            enabled: !s.disabled && eligible,
            configuredEnabled: !s.disabled,
            eligible,
            blockedByAllowlist,
            icon: s.emoji || '📦',
            version: s.version,
            author: s.author,
            config: {
              ...(s.config || {}),
              ...directConfig,
            },
            isCore,
            isBundled: s.bundled,
            hidden,
            source: s.source,
            baseDir: s.baseDir,
            filePath: s.filePath,
            missing,
          };
        });
      } else if (currentSkills.length > 0) {
        // ... if gateway down ...
        combinedSkills = [...currentSkills];
      }

      // Merge with ClawHub results
      if (clawhubResult.success && clawhubResult.results) {
        clawhubResult.results.forEach((cs: ClawHubListResult) => {
          const existing = combinedSkills.find((skill) => skill.id === cs.slug || skill.slug === cs.slug);
          if (existing) {
            if (!existing.baseDir && cs.baseDir) {
              existing.baseDir = cs.baseDir;
            }
            if (!existing.source && cs.source) {
              existing.source = cs.source;
            }
            if (!existing.version && cs.version) {
              existing.version = cs.version;
            }
            return;
          }
          const directConfig = configResult[cs.slug] || {};
          const isCore = alwaysEnabledSkillSet.has(cs.slug);
          const hidden = isHiddenSkill([cs.slug], hiddenSkillSet);
          combinedSkills.push({
            id: cs.slug,
            slug: cs.slug,
            name: cs.slug,
            description: 'Recently installed, initializing...',
            enabled: false,
            configuredEnabled: false,
            eligible: isCore,
            blockedByAllowlist: false,
            icon: '⌛',
            version: cs.version || 'unknown',
            author: undefined,
            config: directConfig,
            isCore,
            isBundled: false,
            hidden,
            source: cs.source || 'openclaw-managed',
            baseDir: cs.baseDir,
            missing: undefined,
          });
        });
      }

      set({ skills: combinedSkills, loading: false });
    } catch (error) {
      console.error('Failed to fetch skills:', error);
      const appError = normalizeAppError(error, { module: 'skills', operation: 'fetch' });
      set({ loading: false, error: mapErrorCodeToSkillErrorKey(appError.code, 'fetch') });
    }
  },

  fetchMarketplaceCatalog: async (force = false) => {
    if (get().marketplaceCatalog && !force) {
      return;
    }

    set({ marketplaceLoading: true, marketplaceError: null });
    try {
      // Load featured skills from top.json
      const featuredResult = await hostApiFetch<{ success: boolean; result?: MarketplaceSkill[]; error?: string }>('/api/marketplace/featured');
      // Load category list from category.json
      const categoriesResult = await hostApiFetch<{ success: boolean; result?: CategoryInfo[]; error?: string }>('/api/marketplace/categories');

      if (!featuredResult.success) {
        throw normalizeAppError(new Error(featuredResult.error || 'Featured skills load failed'), {
          module: 'skills',
          operation: 'fetch',
        });
      }

      const featuredSkills = featuredResult.result || [];
      const categoryList = categoriesResult.result || [];

      // Build catalog: featured slugs, featured skills as the base skills array
      const catalog: MarketplaceCatalog = {
        skills: featuredSkills,
        featured: featuredSkills.map((s) => s.slug),
        categories: {},
        categoryList,
      };

      set({ marketplaceCatalog: catalog });
    } catch (error) {
      console.error('Marketplace catalog load error:', error);
      set({ marketplaceError: String(error) });
    } finally {
      set({ marketplaceLoading: false });
    }
  },

  fetchCategorySkills: async (categoryId: string, page: number, keyword: string) => {
    set({ categorySkillsLoading: true });
    try {
      const params = new URLSearchParams({
        category: categoryId,
        page: String(page),
        pageSize: '24',
        sortBy: 'score',
        order: 'desc',
        keyword: keyword || '',
      });
      const result = await hostApiFetch<{
        success: boolean;
        result?: { skills: MarketplaceSkill[]; total: number };
        error?: string;
      }>(`/api/marketplace/category-skills?${params.toString()}`);

      if (result.success && result.result) {
        set({
          categorySkills: result.result.skills,
          categorySkillsTotal: result.result.total,
        });
      } else {
        console.error('Failed to fetch category skills:', result.error);
        set({ categorySkills: [], categorySkillsTotal: 0 });
      }
    } catch (error) {
      console.error('Category skills fetch error:', error);
      set({ categorySkills: [], categorySkillsTotal: 0 });
    } finally {
      set({ categorySkillsLoading: false });
    }
  },

  installSkill: async (slug: string, version?: string, agentId?: string) => {
    set((state) => ({ installing: { ...state.installing, [slug]: true } }));
    try {
      const result = await hostApiFetch<{ success: boolean; error?: string }>('/api/clawhub/install', {
        method: 'POST',
        body: JSON.stringify({ slug, version }),
      });
      if (!result.success) {
        const appError = normalizeAppError(new Error(result.error || 'Install failed'), {
          module: 'skills',
          operation: 'install',
        });
        throw new Error(mapErrorCodeToSkillErrorKey(appError.code, 'install'));
      }
      // Refresh skills after install
      await get().fetchSkills(agentId);
      invalidatePresetAgentSkillsCache();
    } catch (error) {
      console.error('Install error:', error);
      throw error;
    } finally {
      set((state) => {
        const newInstalling = { ...state.installing };
        delete newInstalling[slug];
        return { installing: newInstalling };
      });
    }
  },

  uninstallSkill: async (target: SkillUninstallTarget, agentId?: string) => {
    const requestBody = typeof target === 'string'
      ? { slug: target }
      : target;
    const installKey = requestBody.slug || requestBody.skillKey || requestBody.baseDir || 'unknown';

    set((state) => ({ installing: { ...state.installing, [installKey]: true } }));
    try {
      const result = await hostApiFetch<{ success: boolean; error?: string }>('/api/clawhub/uninstall', {
        method: 'POST',
        body: JSON.stringify(requestBody),
      });
      if (!result.success) {
        throw new Error(result.error || 'Uninstall failed');
      }
      // Refresh skills after uninstall
      await get().fetchSkills(agentId);
      invalidatePresetAgentSkillsCache();
    } catch (error) {
      console.error('Uninstall error:', error);
      throw error;
    } finally {
      set((state) => {
        const newInstalling = { ...state.installing };
        delete newInstalling[installKey];
        return { installing: newInstalling };
      });
    }
  },

  enableSkill: async (skillId) => {
    const { updateSkill, skills } = get();
    const skill = skills.find((entry) => entry.id === skillId);

    if (skill && (skill.blockedByAllowlist || hasMissingRequirements(skill.missing))) {
      throw new Error('Skill requirements are not satisfied');
    }

    try {
      await useGatewayStore.getState().rpc('skills.update', { skillKey: skillId, enabled: true });
      await hostApiFetch<{ success: boolean; error?: string }>('/api/skills/config', {
        method: 'PUT',
        body: JSON.stringify({ skillKey: skillId, enabled: true }),
      });
      updateSkill(skillId, { enabled: true, configuredEnabled: true });
      invalidatePresetAgentSkillsCache();
    } catch (error) {
      console.error('Failed to enable skill:', error);
      throw error;
    }
  },

  disableSkill: async (skillId) => {
    const { updateSkill, skills } = get();

    const skill = skills.find((s) => s.id === skillId);
    if (skill?.isCore) {
      throw new Error('Cannot disable core skill');
    }

    try {
      await useGatewayStore.getState().rpc('skills.update', { skillKey: skillId, enabled: false });
      await hostApiFetch<{ success: boolean; error?: string }>('/api/skills/config', {
        method: 'PUT',
        body: JSON.stringify({ skillKey: skillId, enabled: false }),
      });
      updateSkill(skillId, { enabled: false, configuredEnabled: false });
      invalidatePresetAgentSkillsCache();
    } catch (error) {
      console.error('Failed to disable skill:', error);
      throw error;
    }
  },

  setSkills: (skills) => set({ skills }),

  updateSkill: (skillId, updates) => {
    set((state) => ({
      skills: state.skills.map((skill) =>
        skill.id === skillId ? { ...skill, ...updates } : skill
      ),
    }));
  },
}));
