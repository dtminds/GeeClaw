/**
 * Skills Page
 * Browse and manage AI skills
 */
import { useEffect, useState, useCallback } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  AiCloudIcon,
  CodesandboxIcon,
  Download05Icon,
  LaptopCheckIcon,
  Pacman02Icon,
  SoftwareLicenseIcon,
  StarIcon,
} from '@hugeicons/core-free-icons';
import {
  Search,
  Puzzle,
  Lock,
  Loader2,
  ChevronLeft,
  ChevronRight,
  X,
  AlertCircle,
  Plus,
  Key,
  Trash2,
  RefreshCw,
  ExternalLink,
  FolderOpen,
  Copy,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useSkillsStore } from '@/stores/skills';
import { useGatewayStore } from '@/stores/gateway';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { cn } from '@/lib/utils';
import { invokeIpc } from '@/lib/api-client';
import { hostApiFetch } from '@/lib/host-api';
import { validateEnvironmentEntries } from '@/lib/environment-entry-validation';
import { toast } from 'sonner';
import type { MarketplaceSkill, Skill, SkillHubStatus } from '@/types/skill';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';




// Skill detail dialog component
interface SkillDetailDialogProps {
  skill: Skill | null;
  isOpen: boolean;
  onClose: () => void;
  onToggle: (enabled: boolean) => void;
  onUninstall?: (skill: Pick<Skill, 'id' | 'slug' | 'baseDir'>) => Promise<void> | void;
  onOpenFolder?: (skill: Skill) => Promise<void> | void;
}

type InstalledSkillFilter =
  | 'all'
  | 'enabled'
  | 'bundled'
  | 'openclaw-extra'
  | 'openclaw-managed'
  | 'personal';

const MARKETPLACE_PAGE_SIZE = 24;
const MARKETPLACE_ACCENTS = [
  { from: '#2d74f2', to: '#5a5ce6' },
  { from: '#0f9b8e', to: '#22c55e' },
  { from: '#d97706', to: '#f59e0b' },
  { from: '#dc5a72', to: '#f97316' },
  { from: '#7c3aed', to: '#2563eb' },
  { from: '#0f766e', to: '#14b8a6' },
  { from: '#be185d', to: '#ec4899' },
  { from: '#1d4ed8', to: '#06b6d4' },
] as const;

function getInstalledSkillFilter(skill: Skill): InstalledSkillFilter | 'other' {
  if (skill.isBundled) {
    return 'bundled';
  }

  switch (skill.source) {
    case 'openclaw-extra':
      return 'openclaw-extra';
    case 'openclaw-managed':
    case 'agents-skills-project':
    case 'openclaw-workspace':
      return 'openclaw-managed';
    case 'agents-skills-personal':
      return 'personal';
    default:
      return 'other';
  }
}

function resolveSkillSourceLabel(skill: Skill, t: TFunction<'skills'>): string {
  const source = (skill.source || '').trim().toLowerCase();
  if (!source) {
    if (skill.isBundled) return t('source.badge.bundled', { defaultValue: 'Bundled' });
    return t('source.badge.unknown', { defaultValue: 'Unknown source' });
  }
  if (source === 'openclaw-bundled') return t('source.badge.bundled', { defaultValue: 'Bundled' });
  if (source === 'openclaw-managed') return t('source.badge.managed', { defaultValue: 'Managed' });
  if (source === 'openclaw-workspace') return t('source.badge.workspace', { defaultValue: 'Workspace' });
  if (source === 'openclaw-extra') return t('source.badge.extra', { defaultValue: 'Extra dirs' });
  if (source === 'agents-skills-personal') return t('source.badge.agentsPersonal', { defaultValue: 'Personal .agents' });
  if (source === 'agents-skills-project') return t('source.badge.agentsProject', { defaultValue: 'Project .agents' });
  return source;
}

function getMarketplaceSkillUrl(skill: MarketplaceSkill): string {
  return skill.homepage || `https://clawhub.ai/s/${skill.slug}`;
}

function getLeadingGrapheme(value?: string): string {
  const input = value?.trim();
  if (!input) return 'S';

  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const first = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
      .segment(input)[Symbol.iterator]().next().value?.segment;
    if (first) {
      return first;
    }
  }

  return Array.from(input)[0] || 'S';
}

function getMarketplaceMonogram(skill: MarketplaceSkill): string {
  const glyph = getLeadingGrapheme(skill.name || skill.slug);
  return /^[a-z]$/i.test(glyph) ? glyph.toUpperCase() : glyph;
}

function getMarketplaceAccent(skill: MarketplaceSkill): (typeof MARKETPLACE_ACCENTS)[number] {
  const seed = Array.from(`${skill.slug}:${skill.name}`).reduce((sum, char) => sum + (char.codePointAt(0) || 0), 0);
  return MARKETPLACE_ACCENTS[seed % MARKETPLACE_ACCENTS.length];
}

function formatMetric(value?: number): string {
  if (!value) return '0';
  return new Intl.NumberFormat(undefined, {
    notation: value >= 1000 ? 'compact' : 'standard',
    maximumFractionDigits: value >= 1000 ? 1 : 0,
  }).format(value);
}

type SkillIssueLabels = {
  unavailable: string;
  blockedByAllowlist: string;
  missingBin: string;
  missingBins: string;
  missingAnyBins: string;
  missingEnv: string;
  missingConfig: string;
  unsupportedOs: string;
};

function formatSkillIssueList(values?: string[]): string {
  return (values || []).filter(Boolean).join(', ');
}

function getSkillIssueMessages(skill: Skill, labels: SkillIssueLabels): string[] {
  const issues: string[] = [];

  if (skill.blockedByAllowlist) {
    issues.push(labels.blockedByAllowlist);
  }

  const bins = formatSkillIssueList(skill.missing?.bins);
  if (bins) {
    issues.push(
      skill.missing?.bins && skill.missing.bins.length > 1
        ? `${labels.missingBins}: ${bins}`
        : `${labels.missingBin}: ${bins}`,
    );
  }

  const anyBins = formatSkillIssueList(skill.missing?.anyBins);
  if (anyBins) {
    issues.push(`${labels.missingAnyBins}: ${anyBins}`);
  }

  const env = formatSkillIssueList(skill.missing?.env);
  if (env) {
    issues.push(`${labels.missingEnv}: ${env}`);
  }

  const config = formatSkillIssueList(skill.missing?.config);
  if (config) {
    issues.push(`${labels.missingConfig}: ${config}`);
  }

  const os = formatSkillIssueList(skill.missing?.os);
  if (os) {
    issues.push(`${labels.unsupportedOs}: ${os}`);
  }

  if (issues.length === 0 && skill.eligible === false) {
    issues.push(labels.unavailable);
  }

  return issues;
}

export function SkillDetailDialog({ skill, isOpen, onClose, onToggle, onUninstall, onOpenFolder }: SkillDetailDialogProps) {
  const { t } = useTranslation(['skills', 'common']);
  const { fetchSkills } = useSkillsStore();
  const [envVars, setEnvVars] = useState<Array<{ key: string; value: string }>>([]);
  const [apiKey, setApiKey] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isUninstalling, setIsUninstalling] = useState(false);
  const [showUninstallConfirm, setShowUninstallConfirm] = useState(false);
  const [validationMessages, setValidationMessages] = useState<string[]>([]);
  const issueLabels: SkillIssueLabels = {
    unavailable: t('detail.unavailable'),
    blockedByAllowlist: t('detail.blockedByAllowlist'),
    missingBin: t('detail.missingBin'),
    missingBins: t('detail.missingBins'),
    missingAnyBins: t('detail.missingAnyBins'),
    missingEnv: t('detail.missingEnv'),
    missingConfig: t('detail.missingConfig'),
    unsupportedOs: t('detail.unsupportedOs'),
  };
  const issueMessages = skill ? getSkillIssueMessages(skill, issueLabels) : [];
  const isUnavailable = skill?.eligible === false;

  // Initialize config from skill
  useEffect(() => {
    if (!skill) return;
    
    // API Key
    if (skill.config?.apiKey) {
      setApiKey(String(skill.config.apiKey));
    } else {
      setApiKey('');
    }

    // Env Vars
    if (skill.config?.env) {
      const vars = Object.entries(skill.config.env).map(([key, value]) => ({
        key,
        value: String(value),
      }));
      setEnvVars(vars);
    } else {
      setEnvVars([]);
    }
    setValidationMessages([]);
  }, [skill]);

  useEffect(() => {
    if (!isOpen) {
      setShowUninstallConfirm(false);
      setIsUninstalling(false);
      setValidationMessages([]);
    }
  }, [isOpen]);

  const handleOpenClawhub = async () => {
    if (!skill?.slug) return;
    await invokeIpc('shell:openExternal', `https://clawhub.ai/s/${skill.slug}`);
  };

  const handleCopyPath = async () => {
    if (!skill?.baseDir) return;
    try {
      await navigator.clipboard.writeText(skill.baseDir);
      toast.success(t('toast.copiedPath'));
    } catch (err) {
      toast.error(t('toast.failedCopyPath') + ': ' + String(err));
    }
  };

  const handleAddEnv = () => {
    setValidationMessages([]);
    setEnvVars([...envVars, { key: '', value: '' }]);
  };

  const handleUpdateEnv = (index: number, field: 'key' | 'value', value: string) => {
    setValidationMessages([]);
    const newVars = [...envVars];
    newVars[index] = { ...newVars[index], [field]: value };
    setEnvVars(newVars);
  };

  const handleRemoveEnv = (index: number) => {
    setValidationMessages([]);
    const newVars = [...envVars];
    newVars.splice(index, 1);
    setEnvVars(newVars);
  };

  const buildEnvValidationMessages = (): string[] => {
    const { emptyRows, incompleteRows, duplicateKeys } = validateEnvironmentEntries(envVars);

    return [
      ...emptyRows.map((row) => t('detail.validation.empty', { row })),
      ...incompleteRows.map((row) => t('detail.validation.incomplete', { row })),
      ...duplicateKeys.map((key) => t('detail.validation.duplicate', { key })),
    ];
  };

  const handleSaveConfig = async () => {
    if (isSaving || !skill) return;
    const nextValidationMessages = buildEnvValidationMessages();
    if (nextValidationMessages.length > 0) {
      setValidationMessages(nextValidationMessages);
      return;
    }

    setIsSaving(true);
    try {
      // Build env object, filtering out empty keys
      const envObj = envVars.reduce((acc, curr) => {
        const key = curr.key.trim();
        const value = curr.value.trim();
        if (key) {
          acc[key] = value;
        }
        return acc;
      }, {} as Record<string, string>);

      // Use direct file access instead of Gateway RPC for reliability
      const result = await invokeIpc<{ success: boolean; error?: string }>(
        'skill:updateConfig',
        {
          skillKey: skill.id,
          apiKey: apiKey || '', // Empty string will delete the key
          env: envObj // Empty object will clear all env vars
        }
      ) as { success: boolean; error?: string };

      if (!result.success) {
        throw new Error(result.error || 'Unknown error');
      }

      // Refresh skills from gateway to get updated config
      await fetchSkills();

      setValidationMessages([]);
      toast.success(t('detail.configSaved'));
    } catch (err) {
      toast.error(t('toast.failedSave') + ': ' + String(err));
    } finally {
      setIsSaving(false);
    }
  };

  if (!skill) return null;

  return (
    <>
      <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <SheetContent
          className="app-canvas flex w-full flex-col border-l border-black/10 p-0 shadow-xl dark:border-white/10 sm:max-w-[500px]"
          side="right"
        >
        <SheetHeader className="sr-only">
          <SheetTitle>{skill.name}</SheetTitle>
          <SheetDescription>
            {skill.description || t('subtitle') || 'Browse and manage AI capabilities.'}
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-6 py-6">
          <div className="mb-6 flex items-start gap-4 text-left">
            <div className="surface-muted relative flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-black/10 text-2xl dark:border-white/10">
              <span>{skill.icon || '🔧'}</span>
              {skill.isCore && (
                <div className="absolute -bottom-1 -right-1 rounded-full border border-black/10 bg-background p-1 dark:border-white/10">
                  <Lock className="h-3 w-3 text-muted-foreground" />
                </div>
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-3">
                <h2 className="truncate text-[22px] font-semibold tracking-tight text-foreground">
                  {skill.name}
                </h2>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="border-0 bg-black/[0.05] px-2.5 py-0.5 font-mono text-[11px] font-medium text-foreground/70 shadow-none dark:bg-white/[0.08]">
                  {skill.isCore
                    ? t('detail.coreSystem')
                    : resolveSkillSourceLabel(skill, t)}
                  </Badge>
                  {isUnavailable && (
                    <Badge variant="secondary" className="border-0 bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-medium text-amber-700 shadow-none dark:bg-amber-500/20 dark:text-amber-300">
                      {t('detail.unavailable')}
                    </Badge>
                  )}
                  {skill.slug && !skill.isBundled && !skill.isCore && (
                    <button
                      type="button"
                      onClick={handleOpenClawhub}
                      className="inline-flex items-center gap-1.5 rounded-md border-0 bg-black/[0.05] px-2.5 py-0.5 font-mono text-[11px] font-medium text-foreground/70 shadow-none transition-colors hover:bg-black/[0.08] hover:text-foreground dark:bg-white/[0.08] dark:hover:bg-white/[0.12]"
                      title="ClawHub"
                    >
                      <ExternalLink className="h-3 w-3" />
                      <span>ClawHub</span>
                    </button>
                  )}
              </div>
              {skill.description && (
                <p className="mt-3 text-[13px] leading-6 text-muted-foreground">
                  {skill.description}
                </p>
              )}
            </div>
          </div>

          <div className="space-y-4">
            <div className="space-y-3 rounded-xl border border-black/10 bg-background/70 p-4 dark:border-white/10 dark:bg-white/[0.03]">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-[13px] font-semibold text-foreground/80">
                  {t('detail.source')}
                </h3>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  value={skill.baseDir || t('detail.pathUnavailable')}
                  readOnly
                  className="h-10 border-black/10 bg-background font-mono text-[12px] text-foreground/70 dark:border-white/10 dark:bg-background"
                />
                <Button
                  variant="outline"
                  size="icon"
                  className="h-10 w-10 rounded-xl border-black/10 dark:border-white/10"
                  disabled={!skill.baseDir}
                  onClick={handleCopyPath}
                  title={t('detail.copyPath')}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-10 w-10 rounded-xl border-black/10 dark:border-white/10"
                  disabled={!skill.baseDir}
                  onClick={() => onOpenFolder?.(skill)}
                  title={t('detail.openActualFolder')}
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {!skill.isCore && (
              isUnavailable && issueMessages.length > 0 && (
                <div className="space-y-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 dark:border-amber-400/20 dark:bg-amber-400/10">
                  <h3 className="flex items-center gap-2 text-[13px] font-semibold text-amber-800 dark:text-amber-200">
                    <AlertCircle className="h-3.5 w-3.5" />
                    {t('detail.unavailable')}
                  </h3>
                  <div className="space-y-1.5 text-[12px] leading-5 text-amber-700 dark:text-amber-100/90">
                    {issueMessages.map((message) => (
                      <p key={message}>{message}</p>
                    ))}
                  </div>
                </div>
              )
            )}

            {!skill.isCore && (
              <div className="space-y-3 rounded-xl border border-black/10 bg-background/70 p-4 dark:border-white/10 dark:bg-white/[0.03]">
                <h3 className="flex items-center gap-2 text-[13px] font-semibold text-foreground/80">
                  <Key className="h-3.5 w-3.5 text-muted-foreground" />
                  API Key
                </h3>
                <Input
                  placeholder={t('detail.apiKeyPlaceholder', 'Enter API Key (optional)')}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  type="password"
                  className="h-10 border-black/10 bg-background font-mono text-[13px] dark:border-white/10 dark:bg-background"
                />
                <p className="text-[12px] text-muted-foreground">
                  {t('detail.apiKeyDesc', 'The primary API key for this skill. Leave blank if not required or configured elsewhere.')}
                </p>
              </div>
            )}

            {!skill.isCore && (
              <div className="space-y-3 rounded-xl border border-black/10 bg-background/70 p-4 dark:border-white/10 dark:bg-white/[0.03]">
                <div className="flex items-center justify-between w-full">
                  <div className="flex items-center gap-2">
                    <h3 className="text-[13px] font-semibold text-foreground/80">
                      Environment Variables
                      {envVars.length > 0 && (
                        <Badge variant="secondary" className="surface-muted-strong ml-2 h-5 px-1.5 py-0 text-[10px] text-foreground">
                          {envVars.length}
                        </Badge>
                      )}
                    </h3>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="surface-hover h-8 gap-1.5 px-2.5 text-[12px] font-medium text-foreground/80"
                    onClick={handleAddEnv}
                  >
                    <Plus className="h-3 w-3" strokeWidth={3} />
                    {t('detail.addVariable', 'Add Variable')}
                  </Button>
                </div>

                <div className="space-y-2">
                  {envVars.length === 0 && (
                     <div className="flex items-center rounded-xl border border-dashed border-black/10 px-4 py-3 text-[13px] text-muted-foreground dark:border-white/10">
                      {t('detail.noEnvVars', 'No environment variables configured.')}
                    </div>
                  )}

                  {envVars.map((env, index) => (
                    <div className="flex items-center gap-3" key={index}>
                      <Input
                        value={env.key}
                        onChange={(e) => handleUpdateEnv(index, 'key', e.target.value)}
                        className="h-10 flex-1 border-black/10 bg-background font-mono text-[13px] dark:border-white/10 dark:bg-background"
                        placeholder={t('detail.keyPlaceholder', 'Key')}
                      />
                      <Input
                        value={env.value}
                        onChange={(e) => handleUpdateEnv(index, 'value', e.target.value)}
                        className="h-10 flex-1 border-black/10 bg-background font-mono text-[13px] dark:border-white/10 dark:bg-background"
                        placeholder={t('detail.valuePlaceholder', 'Value')}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-10 w-10 text-destructive/70 hover:text-destructive hover:bg-destructive/10 shrink-0 rounded-xl transition-colors"
                        onClick={() => handleRemoveEnv(index)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>

                {validationMessages.length > 0 && (
                  <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-[12px] text-amber-950 dark:text-amber-100">
                    <p className="font-medium">{t('detail.validation.title')}</p>
                    <div className="mt-2 space-y-1">
                      {validationMessages.map((message) => (
                        <p key={message}>{message}</p>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

          </div>
          
          <div className="flex items-center gap-3 pb-2 pt-6">
            {!skill.isCore && (
              <Button 
                onClick={handleSaveConfig} 
                className="h-10 rounded-xl px-4 text-[13px] font-medium"
                disabled={isSaving}
              >
                {isSaving ? t('detail.saving', 'Saving...') : t('detail.saveConfig', 'Save Configuration')}
              </Button>
            )}
            
            {!skill.isCore && (
              <Button
                variant={!skill.isBundled && onUninstall ? 'destructive' : 'outline'}
                className="h-10 rounded-xl px-4 text-[13px] font-medium"
                onClick={() => {
                  if (!skill.isBundled && onUninstall) {
                    setShowUninstallConfirm(true);
                  } else {
                    onToggle(!skill.enabled);
                  }
                }}
                disabled={isUnavailable && (skill.isBundled || skill.isCore)}
              >
                {!skill.isBundled && onUninstall
                  ? t('detail.uninstall', 'Uninstall')
                  : (skill.enabled ? t('detail.disable', 'Disable') : t('detail.enable', 'Enable'))}
              </Button>
            )}
          </div>
        </div>
        </SheetContent>
      </Sheet>

      <Dialog open={showUninstallConfirm} onOpenChange={setShowUninstallConfirm}>
        <DialogContent className="w-[min(420px,calc(100vw-2rem))] max-w-[420px] rounded-[16px] p-0">
          <div className="p-6">
            <DialogHeader>
              <DialogTitle>{t('detail.uninstallConfirmTitle', 'Confirm uninstall')}</DialogTitle>
              <DialogDescription>
                {t('detail.uninstallConfirmMessage', { name: skill.name })}
              </DialogDescription>
            </DialogHeader>
            <div className="mt-6 flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setShowUninstallConfirm(false)}
                disabled={isUninstalling}
              >
                {t('common:cancel', 'Cancel')}
              </Button>
              <Button
                variant="destructive"
                disabled={isUninstalling}
                onClick={async () => {
                  if (!onUninstall || isUninstalling) return;
                  setIsUninstalling(true);
                  try {
                    await onUninstall({
                      id: skill.id,
                      slug: skill.slug,
                      baseDir: skill.baseDir,
                    });
                    setShowUninstallConfirm(false);
                    onClose();
                  } finally {
                    setIsUninstalling(false);
                  }
                }}
              >
                {isUninstalling ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : t('detail.uninstall', 'Uninstall')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

interface MarketplaceDetailDialogProps {
  skill: MarketplaceSkill | null;
  isOpen: boolean;
  isInstalled: boolean;
  isInstalling: boolean;
  onClose: () => void;
  onInstall: (slug: string) => void;
  onUninstall: (slug: string) => void;
}

function MarketplaceDetailDialog({
  skill,
  isOpen,
  isInstalled,
  isInstalling,
  onClose,
  onInstall,
  onUninstall,
}: MarketplaceDetailDialogProps) {
  const { t } = useTranslation('skills');

  if (!skill) return null;

  const statCards = [
    {
      key: 'downloads',
      icon: Download05Icon,
      label: t('marketplace.detail.downloads'),
      value: formatMetric(skill.downloads),
    },
    {
      key: 'stars',
      icon: StarIcon,
      label: t('marketplace.detail.stars'),
      value: formatMetric(skill.stars),
    },
    {
      key: 'installs',
      icon: SoftwareLicenseIcon,
      label: t('marketplace.detail.installs'),
      value: formatMetric(skill.installs),
    },
  ];
  const accent = getMarketplaceAccent(skill);
  const monogram = getMarketplaceMonogram(skill);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="w-[min(880px,calc(100vw-2rem))] max-w-[880px] overflow-hidden rounded-[16px] border border-black/8 bg-background p-0 shadow-[0_32px_110px_-42px_rgba(15,23,42,0.42)] dark:border-white/10"
        closeButtonClassName="right-5 top-5 h-8 w-8 border-0 bg-transparent text-foreground/55 hover:bg-transparent hover:text-foreground dark:bg-transparent dark:hover:bg-transparent"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{skill.name}</DialogTitle>
          <DialogDescription>
            {skill.description || t('marketplace.emptyPrompt')}
          </DialogDescription>
        </DialogHeader>
        <div className="flex max-h-[min(88vh,760px)] flex-col overflow-hidden">
          <div className="px-8 py-7 dark:border-white/10">
            <div className="flex items-start gap-5 pr-12">
              <div
                className="flex h-[76px] w-[76px] shrink-0 items-center justify-center rounded-[22px] border border-black/10 text-[34px] font-semibold text-white shadow-[0_18px_40px_-28px_rgba(45,116,242,0.9)] dark:border-white/10"
                style={{ backgroundImage: `linear-gradient(135deg, ${accent.from}, ${accent.to})` }}
              >
                {monogram}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-3">
                  <h2 className="text-[22px] font-semibold tracking-tight text-foreground">
                    {skill.name}
                  </h2>
                </div>
                <div className="flex flex-wrap items-center gap-3 mt-3">
                  <Badge variant="secondary" className="border-0 bg-black/[0.05] px-2.5 py-0.5 font-mono text-[11px] font-medium text-foreground/70 shadow-none dark:bg-white/[0.08]">
                    /{skill.slug}
                  </Badge>
                  <Badge variant="secondary" className="border-0 bg-black/[0.05] px-2.5 py-0.5 font-mono text-[11px] font-medium text-foreground/70 shadow-none dark:bg-white/[0.08]">
                    <HugeiconsIcon icon={CodesandboxIcon} size={12} strokeWidth={1.8} className="mr-1.5" />
                    v{skill.version}
                  </Badge>
                  {isInstalled && (
                    <Badge variant="secondary" className="border-0 bg-black/[0.05] px-2.5 py-0.5 font-mono text-[11px] font-medium text-foreground/70 shadow-none dark:bg-white/[0.08]">
                      {t('marketplace.detail.installed')}
                    </Badge>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-8 pb-12">
            <p className="text-[15px] leading-8 text-foreground/80">
              {skill.description || t('marketplace.emptyPrompt')}
            </p>

            <div className="mt-8 flex items-center gap-2 text-[12px] text-muted-foreground">
              <span>{t('marketplace.detail.sourceLabel')}</span>
              <button
                type="button"
                className="inline-flex items-center gap-1 text-[12px] font-medium text-[#2563eb] transition-colors hover:text-[#1d4ed8] dark:text-[#93c5fd] dark:hover:text-[#bfdbfe]"
                onClick={() => invokeIpc('shell:openExternal', getMarketplaceSkillUrl(skill))}
              >
                <span>ClawHub</span>
                <ExternalLink className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="mt-10 grid gap-4 md:grid-cols-3">
              {statCards.map((card) => {
                return (
                  <div
                    key={card.key}
                    className="rounded-[24px] border border-black/8 bg-black/[0.02] px-6 py-7 text-left dark:border-white/10 dark:bg-white/[0.03]"
                  >
                    <HugeiconsIcon icon={card.icon} size={20} strokeWidth={1.8} className="text-[#2563eb]" />
                    <div className="mt-6 text-[18px] font-semibold text-foreground">
                      {card.value}
                    </div>
                    <div className="mt-1 text-[13px] text-muted-foreground">
                      {card.label}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-end px-8 py-5 dark:border-white/10">
            {isInstalled ? (
              <Button
                variant="destructive"
                className="h-10 w-[112px] rounded-full px-5 text-[13px] font-medium"
                onClick={() => onUninstall(skill.slug)}
                disabled={isInstalling}
              >
                {isInstalling ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : t('detail.uninstall')}
              </Button>
            ) : (
              <Button
                className="h-10 w-[112px] rounded-full px-5 text-[13px] font-medium"
                onClick={() => onInstall(skill.slug)}
                disabled={isInstalling}
              >
                {isInstalling ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : t('marketplace.install', 'Install')}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function Skills() {
  const {
    skills,
    loading,
    error,
    fetchSkills,
    enableSkill,
    disableSkill,
    marketplaceCatalog,
    marketplaceLoading,
    marketplaceError,
    fetchMarketplaceCatalog,
    fetchCategorySkills,
    categorySkills,
    categorySkillsLoading,
    categorySkillsTotal,
    installSkill,
    uninstallSkill,
    installing
  } = useSkillsStore();
  const { t } = useTranslation('skills');
  const issueLabels: SkillIssueLabels = {
    unavailable: t('detail.unavailable'),
    blockedByAllowlist: t('detail.blockedByAllowlist'),
    missingBin: t('detail.missingBin'),
    missingBins: t('detail.missingBins'),
    missingAnyBins: t('detail.missingAnyBins'),
    missingEnv: t('detail.missingEnv'),
    missingConfig: t('detail.missingConfig'),
    unsupportedOs: t('detail.unsupportedOs'),
  };
  const gatewayStatus = useGatewayStore((state) => state.status);
  const [searchQuery, setSearchQuery] = useState('');
  const [marketplaceQuery, setMarketplaceQuery] = useState('');
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [selectedMarketplaceSkill, setSelectedMarketplaceSkill] = useState<MarketplaceSkill | null>(null);
  const [activeTab, setActiveTab] = useState('all');
  const [selectedSource, setSelectedSource] = useState<InstalledSkillFilter>('enabled');
  const [marketplaceSection, setMarketplaceSection] = useState('featured');
  const [marketplacePage, setMarketplacePage] = useState(1);
  const [skillHubStatus, setSkillHubStatus] = useState<SkillHubStatus | null>(null);
  const [skillHubStatusLoading, setSkillHubStatusLoading] = useState(false);
  const [skillHubInstalling, setSkillHubInstalling] = useState(false);

  const isGatewayRunning = gatewayStatus.state === 'running';
  const [showGatewayWarning, setShowGatewayWarning] = useState(false);

  // Debounce the gateway warning to avoid flickering during brief restarts (like skill toggles)
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (!isGatewayRunning) {
      // Wait 1.5s before showing the warning
      timer = setTimeout(() => {
        setShowGatewayWarning(true);
      }, 1500);
    } else {
      // Use setTimeout to avoid synchronous setState in effect
      timer = setTimeout(() => {
        setShowGatewayWarning(false);
      }, 0);
    }
    return () => clearTimeout(timer);
  }, [isGatewayRunning]);

  // Fetch skills on mount
  useEffect(() => {
    if (isGatewayRunning) {
      fetchSkills();
    }
  }, [fetchSkills, isGatewayRunning]);

  // Filter skills
  const safeSkills = Array.isArray(skills) ? skills : [];
  const visibleSkills = safeSkills.filter((skill) => skill.hidden !== true);
  const filteredSkills = visibleSkills.filter((skill) => {
    const query = searchQuery.toLowerCase().trim();
    const matchesSearch =
      query.length === 0 ||
      skill.name.toLowerCase().includes(query) ||
      skill.description.toLowerCase().includes(query) ||
      skill.id.toLowerCase().includes(query) ||
      (skill.slug || '').toLowerCase().includes(query) ||
      (skill.author || '').toLowerCase().includes(query);

    const matchesSource = selectedSource === 'all'
      ? true
      : selectedSource === 'enabled'
        ? skill.enabled
        : getInstalledSkillFilter(skill) === selectedSource;

    return matchesSearch && matchesSource;
  }).sort((a, b) => {
    const byName = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    if (byName !== 0) return byName;
    return a.id.localeCompare(b.id, undefined, { sensitivity: 'base' });
  });

  const sourceStats = {
    all: visibleSkills.length,
    enabled: visibleSkills.filter((skill) => skill.enabled).length,
    bundled: visibleSkills.filter((skill) => getInstalledSkillFilter(skill) === 'bundled').length,
    openclawExtra: visibleSkills.filter((skill) => getInstalledSkillFilter(skill) === 'openclaw-extra').length,
    openclawManaged: visibleSkills.filter((skill) => getInstalledSkillFilter(skill) === 'openclaw-managed').length,
    personal: visibleSkills.filter((skill) => getInstalledSkillFilter(skill) === 'personal').length,
  };

  const installedFilters: Array<{ key: InstalledSkillFilter; label: string; count: number }> = [
    { key: 'all', label: t('filter.all'), count: sourceStats.all },
    { key: 'enabled', label: t('filter.enabled'), count: sourceStats.enabled },
    { key: 'bundled', label: t('filter.builtIn'), count: sourceStats.bundled },
    { key: 'openclaw-extra', label: t('filter.openclawExtra'), count: sourceStats.openclawExtra },
    { key: 'openclaw-managed', label: t('filter.openclawManaged'), count: sourceStats.openclawManaged },
    { key: 'personal', label: t('filter.personal'), count: sourceStats.personal },
  ];

  // Handle toggle
  const handleToggle = useCallback(async (skillId: string, enable: boolean) => {
    try {
      if (enable) {
        await enableSkill(skillId);
        toast.success(t('toast.enabled'));
      } else {
        await disableSkill(skillId);
        toast.success(t('toast.disabled'));
      }
    } catch (err) {
      toast.error(String(err));
    }
  }, [enableSkill, disableSkill, t]);

  const [skillsDirPath, setSkillsDirPath] = useState('~/.openclaw/skills');

  useEffect(() => {
    invokeIpc<string>('openclaw:getSkillsDir')
      .then((dir) => setSkillsDirPath(dir as string))
      .catch(console.error);
  }, []);


  // Handle install
  const handleInstall = useCallback(async (slug: string) => {
    try {
      await installSkill(slug);
      const installedSkill = useSkillsStore.getState().skills.find((skill) => skill.id === slug || skill.slug === slug);
      if (installedSkill?.eligible === false) {
        toast.success(t('toast.installedUnavailable'));
        return;
      }
      await enableSkill(slug);
      toast.success(t('toast.installed'));
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      if (['installTimeoutError', 'installRateLimitError'].includes(errorMessage)) {
        toast.error(t(`toast.${errorMessage}`, { path: skillsDirPath }), { duration: 10000 });
      } else if (errorMessage === 'Skill requirements are not satisfied') {
        toast.error(t('toast.enableRequirementsMissing'));
      } else {
        toast.error(t('toast.failedInstall') + ': ' + errorMessage);
      }
    }
  }, [installSkill, enableSkill, t, skillsDirPath]);

  useEffect(() => {
    if (activeTab !== 'marketplace' || marketplaceCatalog || marketplaceLoading) {
      return;
    }
    void fetchMarketplaceCatalog();
  }, [activeTab, fetchMarketplaceCatalog, marketplaceCatalog, marketplaceLoading]);

  const loadSkillHubStatus = useCallback(async () => {
    setSkillHubStatusLoading(true);
    try {
      const result = await hostApiFetch<{ success: boolean; result?: SkillHubStatus; error?: string }>('/api/skillhub/status');
      if (!result.success) {
        throw new Error(result.error || 'Failed to load SkillHub status');
      }
      setSkillHubStatus(result.result || null);
    } catch (err) {
      console.error('Failed to load SkillHub status:', err);
      setSkillHubStatus(null);
    } finally {
      setSkillHubStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab !== 'marketplace') {
      return;
    }
    void loadSkillHubStatus();
  }, [activeTab, loadSkillHubStatus]);

  const handleInstallSkillHub = useCallback(async () => {
    setSkillHubInstalling(true);
    try {
      const result = await hostApiFetch<{ success: boolean; result?: SkillHubStatus; error?: string }>('/api/skillhub/install', {
        method: 'POST',
      });
      if (!result.success) {
        throw new Error(result.error || 'SkillHub install failed');
      }
      setSkillHubStatus(result.result || null);
      toast.success(t('toast.skillHubInstalled'));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(t('toast.skillHubInstallFailed') + ': ' + message, { duration: 10000 });
    } finally {
      setSkillHubInstalling(false);
    }
  }, [t]);

  const marketplaceSections = [
    { key: 'featured', label: t('marketplace.featured', '精选') },
    { key: 'all', label: t('marketplace.all', '全部') },
    ...(marketplaceCatalog?.categoryList || []).map((cat) => ({
      key: cat.id,
      label: cat.name,
    })),
  ];
  const effectiveMarketplaceSection = marketplaceSections.some((section) => section.key === marketplaceSection)
    ? marketplaceSection
    : 'featured';

  // Fetch category skills when a non-featured section is selected or when page/query changes
  useEffect(() => {
    if (activeTab !== 'marketplace' || effectiveMarketplaceSection === 'featured') {
      return;
    }
    // For 'all' section, pass empty category; for specific categories, pass the category id
    const categoryId = effectiveMarketplaceSection === 'all' ? '' : effectiveMarketplaceSection;
    void fetchCategorySkills(categoryId, marketplacePage, marketplaceQuery);
  }, [activeTab, effectiveMarketplaceSection, marketplacePage, marketplaceQuery, fetchCategorySkills]);

  // For featured: use the catalog skills; for categories and 'all': use API-fetched categorySkills
  const isFeaturedSection = effectiveMarketplaceSection === 'featured';
  const marketplaceSkillMap = new Map((marketplaceCatalog?.skills || []).map((skill) => [skill.slug, skill]));

  let marketplaceVisibleSkills: MarketplaceSkill[];
  let marketplaceTotalPages: number;
  let safeMarketplacePage: number;
  let marketplacePageStart: number;
  let marketplaceFilteredSkillsCount: number;

  if (isFeaturedSection) {
    // Featured: client-side filtering from catalog.skills
    const featuredSlugs = marketplaceCatalog?.featured || [];
    const featuredBaseSkills = featuredSlugs
      .map((slug) => marketplaceSkillMap.get(slug))
      .filter((skill): skill is MarketplaceSkill => Boolean(skill));
    const normalizedMarketplaceQuery = marketplaceQuery.trim().toLowerCase();
    const filteredSkills = !normalizedMarketplaceQuery
      ? featuredBaseSkills
      : featuredBaseSkills.filter((skill) =>
        skill.slug.toLowerCase().includes(normalizedMarketplaceQuery)
        || skill.name.toLowerCase().includes(normalizedMarketplaceQuery)
        || skill.description.toLowerCase().includes(normalizedMarketplaceQuery)
        || (skill.author || '').toLowerCase().includes(normalizedMarketplaceQuery)
        || (skill.tags || []).some((tag) => tag.toLowerCase().includes(normalizedMarketplaceQuery))
      );
    marketplaceFilteredSkillsCount = filteredSkills.length;
    marketplaceTotalPages = Math.max(1, Math.ceil(filteredSkills.length / MARKETPLACE_PAGE_SIZE));
    safeMarketplacePage = Math.min(marketplacePage, marketplaceTotalPages);
    marketplacePageStart = (safeMarketplacePage - 1) * MARKETPLACE_PAGE_SIZE;
    marketplaceVisibleSkills = filteredSkills.slice(
      marketplacePageStart,
      marketplacePageStart + MARKETPLACE_PAGE_SIZE,
    );
  } else {
    // Category or All: server-side pagination from API
    marketplaceVisibleSkills = categorySkills;
    marketplaceFilteredSkillsCount = categorySkillsTotal;
    marketplaceTotalPages = Math.max(1, Math.ceil(categorySkillsTotal / MARKETPLACE_PAGE_SIZE));
    safeMarketplacePage = Math.min(marketplacePage, marketplaceTotalPages);
    marketplacePageStart = (safeMarketplacePage - 1) * MARKETPLACE_PAGE_SIZE;
  }

  // Handle uninstall
  const handleUninstall = useCallback(async (target: string | Pick<Skill, 'id' | 'slug' | 'baseDir'>) => {
    try {
      if (typeof target === 'string') {
        await uninstallSkill(target);
      } else {
        await uninstallSkill({
          slug: target.slug,
          skillKey: target.id,
          baseDir: target.baseDir,
        });
      }
      toast.success(t('toast.uninstalled'));
    } catch (err) {
      toast.error(t('toast.failedUninstall') + ': ' + String(err));
    }
  }, [uninstallSkill, t]);

  const handleOpenSkillFolder = useCallback(async (skill: Skill) => {
    try {
      const result = await hostApiFetch<{ success: boolean; error?: string }>('/api/clawhub/open-path', {
        method: 'POST',
        body: JSON.stringify({
          skillKey: skill.id,
          slug: skill.slug,
          baseDir: skill.baseDir,
        }),
      });
      if (!result.success) {
        throw new Error(result.error || 'Failed to open folder');
      }
    } catch (err) {
      toast.error(t('toast.failedOpenActualFolder') + ': ' + String(err));
    }
  }, [t]);

  if (loading) {
    return (
      <div data-testid="skills-page" className="flex flex-col dark:bg-background min-h-[calc(100vh-2.5rem)] items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div data-testid="skills-page" className="flex flex-col dark:bg-background h-[calc(100vh)] overflow-hidden">
      <div className="w-full max-w-6xl mx-auto flex flex-col h-full px-10 pt-16">
        
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-start justify-between mb-6 shrink-0 gap-4">
          <div>
            <h1 className="text-3xl text-foreground mb-1 font-bold tracking-tight">
              {t('title') || 'Skills'}
            </h1>
            <p className="text-sm text-foreground/80 font-normal">
              {t('subtitle') || 'Browse and manage AI capabilities.'}
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0 md:mt-2">
            <div className="surface-muted group relative flex items-center rounded-full border border-transparent px-3 py-1.5 transition-colors focus-within:bg-accent/70 focus-within:border-black/10 dark:focus-within:border-white/10">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
              <input
                placeholder={activeTab === 'marketplace' ? t('searchMarketplace') : t('search')}
                value={activeTab === 'marketplace' ? marketplaceQuery : searchQuery}
                onChange={(e) => {
                  if (activeTab === 'marketplace') {
                    setMarketplaceQuery(e.target.value);
                    setMarketplacePage(1);
                    return;
                  }
                  setSearchQuery(e.target.value);
                }}
                className="ml-2 w-24 bg-transparent text-[13px] font-normal text-foreground outline-none transition-all placeholder:text-foreground/50 focus:w-40 md:focus:w-56"
              />
              {((activeTab === 'marketplace' && marketplaceQuery) || (activeTab === 'all' && searchQuery)) && (
                <button
                  type="button"
                  onClick={() => {
                    if (activeTab === 'marketplace') {
                      setMarketplaceQuery('');
                      setMarketplacePage(1);
                      return;
                    }
                    setSearchQuery('');
                  }}
                  className="ml-1 shrink-0 text-foreground/50 hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={() => activeTab === 'marketplace' ? fetchMarketplaceCatalog(true) : fetchSkills()}
              disabled={activeTab === 'all' ? !isGatewayRunning : (marketplaceLoading || categorySkillsLoading)}
              className="surface-hover ml-1 h-8 w-8 rounded-md border-black/10 bg-transparent text-muted-foreground shadow-none dark:border-white/10"
              title="Refresh"
            >
              <RefreshCw className={cn("h-4 w-4", (loading || marketplaceLoading) && "animate-spin")} />
            </Button>
          </div>
        </div>

        {/* Gateway Warning */}
        {showGatewayWarning && (
          <div className="mb-6 p-4 rounded-xl border border-yellow-500/50 bg-yellow-500/10 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
            <span className="text-yellow-700 dark:text-yellow-400 text-sm font-medium">
              {t('gatewayWarning')}
            </span>
          </div>
        )}

        {/* Sub Navigation and Actions */}
        <div className="flex flex-col md:flex-row md:items-center justify-between pb-4 shrink-0 gap-4">
          <div className="flex min-w-0 flex-1 flex-col gap-4 text-[14px]">
            {/* Segment Control: Installed / Marketplace */}
            <div className="inline-flex w-fit items-center rounded-full border border-border/60 bg-muted/40 p-1 gap-0.5">
              <button
                onClick={() => { setActiveTab('all'); setSelectedSource('all'); }}
                className={cn(
                  'flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[13px] font-medium transition-all',
                  activeTab === 'all'
                    ? 'bg-foreground text-background shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <HugeiconsIcon icon={LaptopCheckIcon} className="w-4" />
                {t('filter.allSkills')}
              </button>
              <button
                onClick={() => {
                  setActiveTab('marketplace');
                  setMarketplacePage(1);
                }}
                className={cn(
                  'flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[13px] font-medium transition-all',
                  activeTab === 'marketplace'
                    ? 'bg-foreground text-background shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <HugeiconsIcon icon={AiCloudIcon} className="w-4" /> {t('marketplace.title')}
              </button>
            </div>

            {/* Sub-tabs: underline style */}
            <div className="flex items-center flex-wrap gap-6 border-b border-black/5 dark:border-white/5 px-4">
              {activeTab === 'all' && (
                <>
                  {installedFilters.map((filter) => {
                    const active = selectedSource === filter.key;
                    return (
                      <button
                        key={filter.key}
                        type="button"
                        onClick={() => setSelectedSource(filter.key)}
                        className={cn(
                          'relative pb-2 text-[14px] font-medium transition-colors',
                          active
                            ? 'text-foreground'
                            : 'text-muted-foreground hover:text-foreground',
                        )}
                      >
                        {filter.label}
                        <span className="ml-1 text-[12px] font-normal opacity-60">{filter.count}</span>
                        {active && (
                          <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-foreground" />
                        )}
                      </button>
                    );
                  })}
                </>
              )}
              {activeTab === 'marketplace' && (
                <>
                  {marketplaceSections.map((section) => {
                    const active = effectiveMarketplaceSection === section.key;
                    return (
                      <button
                        key={section.key}
                        type="button"
                        onClick={() => {
                          setMarketplaceSection(section.key);
                          setMarketplacePage(1);
                        }}
                        className={cn(
                          'relative pb-2 text-[14px] font-medium transition-colors',
                          active
                            ? 'text-foreground'
                            : 'text-muted-foreground hover:text-foreground',
                        )}
                      >
                        {section.label}
                        {active && (
                          <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-foreground" />
                        )}
                      </button>
                    );
                  })}
                </>
              )}
            </div>
          </div>

        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto pr-2 pb-10 min-h-0 -mr-2">
          {error && activeTab === 'all' && (
            <div className="mb-4 p-4 rounded-xl border border-destructive/50 bg-destructive/10 text-destructive text-sm font-medium flex items-center gap-2">
              <AlertCircle className="h-5 w-5 shrink-0" />
              <span>
                {['fetchTimeoutError', 'fetchRateLimitError', 'timeoutError', 'rateLimitError'].includes(error)
                  ? t(`toast.${error}`, { path: skillsDirPath })
                  : error}
              </span>
            </div>
          )}

          <div className="flex flex-col gap-1">
          {activeTab === 'all' && (
            filteredSkills.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                <Puzzle className="h-10 w-10 mb-4 opacity-50" />
                <p>{searchQuery ? t('noSkillsSearch') : t('noSkillsAvailable')}</p>
              </div>
            ) : (
              filteredSkills.map((skill) => (
                (() => {
                  const isUnavailable = skill.eligible === false;
                  const issueMessages = getSkillIssueMessages(skill, issueLabels);
                  return (
                    <div
                      key={skill.id}
                      className="surface-hover group flex cursor-pointer flex-row items-center justify-between rounded-xl border-b border-black/5 px-3 py-3.5 transition-colors dark:border-white/5 last:border-0"
                      onClick={() => setSelectedSkill(skill)}
                    >
                      <div className="flex items-start gap-4 flex-1 overflow-hidden pr-4">
                        <div className="surface-muted h-10 w-10 shrink-0 flex items-center justify-center overflow-hidden rounded-xl border border-black/5 text-2xl dark:border-white/10">
                          {skill.icon || '🧩'}
                        </div>
                        <div className="flex flex-col overflow-hidden">
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="text-[15px] font-semibold text-foreground truncate">{skill.name}</h3>
                            {skill.isCore ? (
                              <Lock className="h-3 w-3 text-muted-foreground" />
                            ) : skill.isBundled ? (
                              <Puzzle className="text-info/80 h-3 w-3" />
                            ) : null}
                            {skill.slug && skill.slug !== skill.name ? (
                              <span className="shrink-0 font-mono text-[12px] text-muted-foreground">
                                /{skill.slug}
                              </span>
                            ) : null}
                            {isUnavailable && (
                              <Badge variant="secondary" className="border-0 bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-700 shadow-none dark:bg-amber-500/20 dark:text-amber-300">
                                {t('detail.unavailable')}
                              </Badge>
                            )}
                          </div>
                          <p className="text-[13.5px] text-muted-foreground line-clamp-1 pr-6 leading-relaxed">
                            {skill.description}
                          </p>
                          {isUnavailable && issueMessages[0] && (
                            <p className="mt-1 text-[12px] text-amber-700 line-clamp-1 dark:text-amber-300">
                              {issueMessages[0]}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-6 shrink-0" onClick={e => e.stopPropagation()}>
                        <Switch
                          checked={skill.enabled}
                          onCheckedChange={(checked) => handleToggle(skill.id, checked)}
                          disabled={skill.isCore || isUnavailable}
                        />
                      </div>
                    </div>
                  );
                })()
              ))
            )
          )}

          {activeTab === 'marketplace' && (
             <div className="flex flex-col gap-1 mt-2">
                {!skillHubStatusLoading && skillHubStatus && !skillHubStatus.available && (
                  <div className="mb-4 rounded-2xl border border-sky-500/20 bg-[linear-gradient(135deg,rgba(14,165,233,0.10),rgba(34,197,94,0.08))] px-4 py-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground">
                          {t('marketplace.skillHub.title')}
                        </p>
                        <p className="mt-1 text-sm leading-6 text-muted-foreground">
                          {t('marketplace.skillHub.description')}
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => void handleInstallSkillHub()}
                        disabled={skillHubInstalling}
                        className="h-9 rounded-full px-4 shadow-none"
                      >
                        {skillHubInstalling ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : t('marketplace.skillHub.install')}
                      </Button>
                    </div>
                  </div>
                )}

                {!skillHubStatusLoading && skillHubStatus?.available && skillHubStatus.preferredBackend === 'skillhub' && (
                  <div className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
                    <Puzzle className="h-4 w-4 shrink-0" />
                    <span>
                      {t('marketplace.skillHub.enabled', { version: skillHubStatus.version || 'latest' })}
                    </span>
                  </div>
                )}

                {marketplaceError && (
                  <div className="mb-4 p-4 rounded-xl border border-destructive/50 bg-destructive/10 text-destructive text-sm font-medium flex items-center gap-2">
                    <AlertCircle className="h-5 w-5 shrink-0" />
                    <span>{t('marketplace.loadError', 'Failed to load marketplace catalog.')}</span>
                  </div>
                )}
                
                {(marketplaceLoading && !marketplaceCatalog) || (categorySkillsLoading && !isFeaturedSection) ? (
                  <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                    <LoadingSpinner size="lg" />
                    <p className="mt-4 text-sm">{t('marketplace.loading', 'Loading marketplace...')}</p>
                  </div>
                ) : marketplaceVisibleSkills.length > 0 ? (
                  <>
                  {marketplaceVisibleSkills.map((skill) => {
                    const isInstalled = skills.some(s => s.id === skill.slug || s.name === skill.name);
                    const isInstallLoading = !!installing[skill.slug];
                    const accent = getMarketplaceAccent(skill);
                    const monogram = getMarketplaceMonogram(skill);
                    
                    return (
                      <div
                        key={skill.slug}
                        className="surface-hover group flex cursor-pointer flex-row items-center justify-between rounded-xl border-b border-black/5 px-3 py-3.5 transition-colors dark:border-white/5 last:border-0"
                        onClick={() => setSelectedMarketplaceSkill(skill)}
                      >
                        <div className="flex items-start gap-4 flex-1 overflow-hidden pr-4">
                          <div
                            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] border border-black/10 text-[17px] font-semibold text-white shadow-[0_14px_30px_-24px_rgba(45,116,242,0.85)] dark:border-white/10"
                            style={{ backgroundImage: `linear-gradient(135deg, ${accent.from}, ${accent.to})` }}
                          >
                            {monogram}
                          </div>
                          <div className="flex flex-col overflow-hidden">
                            <div className="flex items-center gap-2 mb-1">
                              <h3 className="text-[15px] font-semibold text-foreground truncate">{skill.name}</h3>
                              <span className="shrink-0 font-mono text-[12px] text-muted-foreground">
                                /{skill.slug}
                              </span>
                            </div>
                            <p className="text-[13.5px] text-muted-foreground line-clamp-1 pr-6 leading-relaxed">
                              {skill.description}
                            </p>
                            <div className="mt-2 flex flex-wrap items-center gap-4 text-[12px] text-muted-foreground">
                              <span className="inline-flex items-center gap-1.5">
                                <HugeiconsIcon icon={Download05Icon} size={14} strokeWidth={1.8} />
                                <span>{formatMetric(skill.downloads)}</span>
                              </span>
                              <span className="inline-flex items-center gap-1.5">
                                <HugeiconsIcon icon={StarIcon} size={14} strokeWidth={1.8} />
                                <span>{formatMetric(skill.stars)}</span>
                              </span>
                              <span className="inline-flex items-center gap-1.5">
                                <HugeiconsIcon icon={CodesandboxIcon} size={14} strokeWidth={1.8} />
                                <span>v{skill.version}</span>
                              </span>
                              {skill.author && (
                                <span className="inline-flex items-center gap-1.5">
                                  <HugeiconsIcon icon={Pacman02Icon} size={14} strokeWidth={1.8} />
                                  <span>{skill.author}</span>
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-4 shrink-0" onClick={e => e.stopPropagation()}>
                           {isInstalled ? (
                             <Button
                               variant="secondary"
                               size="sm"
                               onClick={() => setSelectedMarketplaceSkill(skill)}
                               disabled={isInstallLoading}
                               className="h-8 w-[92px] rounded-full px-4 shadow-none"
                              >
                                {isInstallLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t('marketplace.detail.installed')}
                              </Button>
                            ) : (
                             <Button
                               variant="default"
                               size="sm"
                               onClick={() => handleInstall(skill.slug)}
                               disabled={isInstallLoading}
                               className="h-8 w-[92px] rounded-full px-4 shadow-none font-medium text-xs"
                             >
                               {isInstallLoading ? (
                                 <Loader2 className="h-3.5 w-3.5 animate-spin" />
                               ) : t('marketplace.install', 'Install')}
                             </Button>
                           )}
                        </div>
                      </div>
                    );
                  })}

                  {marketplaceTotalPages > 1 && (
                    <div className="mt-5 flex items-center justify-between px-3">
                      <div className="text-[12px] text-muted-foreground">
                        {t('marketplace.pagination.summary', {
                          from: marketplacePageStart + 1,
                          to: Math.min(marketplacePageStart + MARKETPLACE_PAGE_SIZE, marketplaceFilteredSkillsCount),
                          count: marketplaceFilteredSkillsCount,
                          defaultValue: '{{from}}-{{to}} / {{count}}',
                        })}
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 rounded-full px-3 text-[12px]"
                          disabled={safeMarketplacePage <= 1}
                          onClick={() => setMarketplacePage((page) => Math.max(1, page - 1))}
                        >
                          <ChevronLeft className="mr-1 h-3.5 w-3.5" />
                          {t('marketplace.pagination.previous', 'Previous')}
                        </Button>
                        <span className="min-w-[72px] text-center text-[12px] text-muted-foreground">
                          {safeMarketplacePage} / {marketplaceTotalPages}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 rounded-full px-3 text-[12px]"
                          disabled={safeMarketplacePage >= marketplaceTotalPages}
                          onClick={() => setMarketplacePage((page) => Math.min(marketplaceTotalPages, page + 1))}
                        >
                          {t('marketplace.pagination.next', 'Next')}
                          <ChevronRight className="ml-1 h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  )}
                  </>
                ) : (
                  !marketplaceLoading && !categorySkillsLoading && marketplaceCatalog && (
                    <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                      <HugeiconsIcon icon={CodesandboxIcon} size={40} strokeWidth={1.8} className="mb-4 opacity-50" />
                      <p>{marketplaceQuery ? t('marketplace.noResults') : t('marketplace.emptyPrompt')}</p>
                    </div>
                  )
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Skill Detail Dialog */}
      <SkillDetailDialog
        skill={selectedSkill}
        isOpen={!!selectedSkill}
        onClose={() => setSelectedSkill(null)}
        onToggle={(enabled) => {
          if (!selectedSkill) return;
          handleToggle(selectedSkill.id, enabled);
          setSelectedSkill({ ...selectedSkill, enabled });
        }}
        onUninstall={handleUninstall}
        onOpenFolder={handleOpenSkillFolder}
      />

      <MarketplaceDetailDialog
        skill={selectedMarketplaceSkill}
        isOpen={!!selectedMarketplaceSkill}
        isInstalled={selectedMarketplaceSkill ? skills.some((skill) => skill.id === selectedMarketplaceSkill.slug || skill.name === selectedMarketplaceSkill.name) : false}
        isInstalling={selectedMarketplaceSkill ? !!installing[selectedMarketplaceSkill.slug] : false}
        onClose={() => setSelectedMarketplaceSkill(null)}
        onInstall={handleInstall}
        onUninstall={handleUninstall}
      />
    </div>
  );
}

export default Skills;
