/**
 * Skill Type Definitions
 * Types for skills/plugins
 */

/**
 * Skill data structure
 */
export interface SkillMissingRequirements {
  bins?: string[];
  anyBins?: string[];
  env?: string[];
  config?: string[];
  os?: string[];
}

export interface Skill {
  id: string;
  slug?: string;
  source?: string;
  baseDir?: string;
  filePath?: string;
  name: string;
  description: string;
  enabled: boolean;
  configuredEnabled?: boolean;
  eligible?: boolean;
  blockedByAllowlist?: boolean;
  icon?: string;
  version?: string;
  author?: string;
  configurable?: boolean;
  config?: Record<string, unknown>;
  isCore?: boolean;
  isBundled?: boolean;
  hidden?: boolean;
  dependencies?: string[];
  missing?: SkillMissingRequirements;
}

/**
 * Skill bundle (preset skill collection)
 */
export interface SkillBundle {
  id: string;
  name: string;
  nameZh: string;
  description: string;
  descriptionZh: string;
  icon: string;
  skills: string[];
  recommended?: boolean;
}


/**
 * Marketplace skill data
 */
export interface MarketplaceSkill {
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

export interface CategoryInfo {
  id: string;
  name: string;
}

export interface MarketplaceCatalog {
  total?: number;
  generatedAt?: string;
  skills: MarketplaceSkill[];
  featured: string[];
  categories: Record<string, string[]>;
  categoryList: CategoryInfo[];
}

export interface SkillHubStatus {
  available: boolean;
  path?: string;
  version?: string;
  autoInstallSupported: boolean;
  uvAvailable: boolean;
  pythonReady: boolean;
  preferredBackend: 'skillhub' | 'clawhub' | 'none';
}

/**
 * Skill configuration schema
 */
export interface SkillConfigSchema {
  type: 'object';
  properties: Record<string, {
    type: 'string' | 'number' | 'boolean' | 'array';
    title?: string;
    description?: string;
    default?: unknown;
    enum?: unknown[];
  }>;
  required?: string[];
}
