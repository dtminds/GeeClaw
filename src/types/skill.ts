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
}

export interface MarketplaceCatalog {
  total?: number;
  generatedAt?: string;
  skills: MarketplaceSkill[];
  featured: string[];
  categories: Record<string, string[]>;
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
