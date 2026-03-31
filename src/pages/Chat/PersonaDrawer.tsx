import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  FileText,
  Info,
  Loader2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  PERSONA_FILE_ORDER,
  SOUL_TEMPLATES,
  useAgentPersona,
} from '@/pages/Chat/agent-settings/useAgentPersona';
import type { PersonaFileKey } from '@/pages/Chat/agent-settings/useAgentPersona';

type SectionTone = {
  shellClassName: string;
  headerClassName: string;
  dividerClassName: string;
  bodyClassName: string;
  noteClassName: string;
  badgeClassName: string;
};

interface PersonaDrawerProps {
  open: boolean;
  agentId: string;
  onOpenChange: (open: boolean) => void;
}

export function PersonaDrawer({
  open,
  agentId,
  onOpenChange,
}: PersonaDrawerProps) {
  const { t } = useTranslation('chat');
  const [activeTab, setActiveTab] = useState<PersonaFileKey>('identity');
  const {
    snapshot,
    loading,
    saving,
    error,
    drafts,
    soulTemplateId,
    lockedFileSet,
    hasChanges,
    selectSoulTemplate,
    updateDraft,
    load,
    savePersona,
  } = useAgentPersona(agentId, open);

  const sectionTones = useMemo<Record<PersonaFileKey, SectionTone>>(() => ({
    identity: {
      shellClassName: 'border-[#cdd8ff] bg-[#eef2ff]/65 shadow-[0_14px_36px_-30px_rgba(99,102,241,0.42)] dark:border-[#37457a] dark:bg-[#172038]',
      headerClassName: 'bg-[#e7ecff]/90 text-[#4957cf] dark:bg-[#1d2747] dark:text-[#b7c5ff]',
      dividerClassName: 'border-[#cfd8ff] dark:border-[#31406d]',
      bodyClassName: 'bg-[#f8f9ff]/82 dark:bg-[#131a2f]',
      noteClassName: 'text-[#6d78e8] dark:text-[#93a6ff]',
      badgeClassName: 'bg-[#dfe5ff] text-[#5866df] dark:bg-[#27355f] dark:text-[#b1c0ff]',
    },
    master: {
      shellClassName: 'border-[#bfead7] bg-[#eaf9f2]/78 shadow-[0_14px_36px_-30px_rgba(22,163,74,0.32)] dark:border-[#2d5b4d] dark:bg-[#112720]',
      headerClassName: 'bg-[#def5ea]/92 text-[#117c5c] dark:bg-[#153428] dark:text-[#9ee7cb]',
      dividerClassName: 'border-[#c5ecd8] dark:border-[#295240]',
      bodyClassName: 'bg-[#f7fcf9]/84 dark:bg-[#0f211b]',
      noteClassName: 'text-[#27a37f] dark:text-[#7cd8b6]',
      badgeClassName: 'bg-[#d7f5e7] text-[#1c8a69] dark:bg-[#204438] dark:text-[#9de5ca]',
    },
    soul: {
      shellClassName: 'border-[#d8d0ff] bg-[#f4f1ff]/78 shadow-[0_16px_36px_-30px_rgba(109,40,217,0.35)] dark:border-[#4a3d7c] dark:bg-[#19142b]',
      headerClassName: 'bg-[#ece8ff]/92 text-[#6448ea] dark:bg-[#241b40] dark:text-[#c0afff]',
      dividerClassName: 'border-[#ddd5ff] dark:border-[#463871]',
      bodyClassName: 'bg-[#fbf9ff]/86 dark:bg-[#151124]',
      noteClassName: 'text-[#876dff] dark:text-[#a998f8]',
      badgeClassName: 'bg-[#e7ddff] text-[#6d52f0] dark:bg-[#33295a] dark:text-[#c8b8ff]',
    },
    memory: {
      shellClassName: 'border-[#f4dc96] bg-[#fff6d9]/76 shadow-[0_14px_36px_-30px_rgba(217,119,6,0.28)] dark:border-[#66502e] dark:bg-[#261d10]',
      headerClassName: 'bg-[#fff2cb]/94 text-[#b25a14] dark:bg-[#352713] dark:text-[#f2c587]',
      dividerClassName: 'border-[#f4dd98] dark:border-[#5f4827]',
      bodyClassName: 'bg-[#fffdf4]/82 dark:bg-[#1f180d]',
      noteClassName: 'text-[#ec8b2f] dark:text-[#efb064]',
      badgeClassName: 'bg-[#fff0bf] text-[#d97a18] dark:bg-[#4e3919] dark:text-[#f4c17e]',
    },
  }), []);

  const tabMeta = useMemo(() => ({
    identity: {
      label: t('toolbar.persona.tabs.identity'),
    },
    master: {
      label: t('toolbar.persona.tabs.master'),
    },
    soul: {
      label: t('toolbar.persona.tabs.soul'),
    },
    memory: {
      label: t('toolbar.persona.tabs.memory'),
    },
  }), [t]);
  const soulLocked = lockedFileSet.has('soul');
  const activeTabLockedMessage = useMemo(() => {
    if (!lockedFileSet.has(activeTab)) {
      return null;
    }

    if (activeTab === 'identity') {
      return t('toolbar.persona.lockedManaged.identity');
    }

    return t('toolbar.persona.lockedManaged.default');
  }, [activeTab, lockedFileSet, t]);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting the tab when the drawer opens is intentional.
    setActiveTab('identity');
  }, [open, agentId]);

  const handleReload = async () => {
    if (!agentId) return;
    await load();
  };

  const handleSave = async () => {
    if (!snapshot || !snapshot.editable) return;

    const result = await savePersona();
    if (!result) return;

    if ('response' in result) {
      toast.success(t('toolbar.persona.toast.saved'));
    } else {
      toast.error(`${t('toolbar.persona.toast.failed')}: ${result.error}`);
    }
  };

  const renderFilePanel = ({
    fileKey,
    fileLabel,
    helperText,
    value,
    onChange,
    fillHeight = false,
    readOnly = false,
  }: {
    fileKey: PersonaFileKey;
    fileLabel: string;
    helperText: string;
    value: string;
    onChange: (value: string) => void;
    fillHeight?: boolean;
    readOnly?: boolean;
  }) => {
    const tone = sectionTones[fileKey];
    const exists = snapshot?.files[fileKey].exists ?? false;

    return (
      <div className={cn(
        'overflow-hidden rounded-[22px] border',
        tone.shellClassName,
        fillHeight && 'flex h-full min-h-0 flex-col',
      )}>
        <div className={cn('flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between', tone.headerClassName)}>
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-white/70">
              <FileText className="h-3 w-3" />
            </div>
            <span className="text-sm font-semibold">{fileLabel}</span>
          </div>
          <div className={cn('flex items-center gap-1.5 text-[11px] font-medium leading-4', tone.noteClassName)}>
            <Info className="h-3 w-3 shrink-0" />
            <span>{helperText}</span>
          </div>
        </div>

        <div className={cn(
          'space-y-2 border-t px-4 py-3',
          tone.dividerClassName,
          tone.bodyClassName,
          fillHeight && 'flex min-h-0 flex-1 flex-col',
        )}>
          {!exists && (
            <div className={cn('inline-flex rounded-full px-2.5 py-0.5 text-[10px] font-semibold', tone.badgeClassName)}>
              {t('toolbar.persona.createOnSave')}
            </div>
          )}
          <Textarea
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={t(`toolbar.persona.placeholders.${fileKey}`)}
            disabled={readOnly}
            className={cn(
              'min-h-[96px] resize-none border-0 bg-transparent px-0 py-0 text-sm leading-5 text-foreground shadow-none outline-none ring-0 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0',
              fillHeight && 'h-full min-h-0 flex-1',
            )}
          />
        </div>
      </div>
    );
  };

  const renderReadOnlyPanel = ({
    fileKey,
    fileLabel,
    helperText,
    value,
  }: {
    fileKey: PersonaFileKey;
    fileLabel: string;
    helperText: string;
    value: string;
  }) => {
    const tone = sectionTones[fileKey];
    return (
      <div className={cn('flex h-full min-h-0 flex-col overflow-hidden rounded-[22px] border', tone.shellClassName)}>
        <div className={cn('flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between', tone.headerClassName)}>
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-white/70">
              <FileText className="h-3 w-3" />
            </div>
            <span className="text-sm font-semibold">{fileLabel}</span>
          </div>
          <div className={cn('flex items-center gap-1.5 text-[11px] font-medium leading-4', tone.noteClassName)}>
            <Info className="h-3 w-3 shrink-0" />
            <span>{helperText}</span>
          </div>
        </div>
        <div className={cn('min-h-0 flex-1 overflow-y-auto border-t px-4 py-3', tone.dividerClassName, tone.bodyClassName)}>
          <div className="min-h-[96px] whitespace-pre-wrap text-sm leading-5 text-foreground">
            {value}
          </div>
        </div>
      </div>
    );
  };

  return (
    <Sheet modal={false} open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        className="app-canvas flex w-full flex-col border-l border-black/10 bg-[#fcfbf8] p-0 shadow-[0_28px_80px_-44px_rgba(21,42,51,0.35)] will-change-transform [contain:layout_paint_style] data-[state=closed]:duration-200 data-[state=open]:duration-200 dark:border-white/10 dark:bg-background sm:max-w-[780px]"
      >
        <div className="px-4 pb-0 pt-3">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-foreground">{t('toolbar.persona.title')}</h2>
            </div>

            <Button
              variant="ghost"
              size="icon"
              className="modal-close-button -mr-2 -mt-2"
              onClick={() => onOpenChange(false)}
              aria-label={t('common:actions.close')}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="mt-2 flex items-end gap-6 border-b border-black/8 dark:border-white/10">
            {PERSONA_FILE_ORDER.map((tabKey) => {
              const selected = activeTab === tabKey;
              return (
                <button
                  key={tabKey}
                  type="button"
                  onClick={() => setActiveTab(tabKey)}
                  className={cn(
                    'border-b-2 border-transparent pb-2 text-sm font-semibold transition-colors',
                    selected
                      ? 'border-primary text-primary'
                      : 'text-foreground/42 hover:text-foreground/68 dark:text-foreground/48 dark:hover:text-foreground/72',
                  )}
                >
                  {tabMeta[tabKey].label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col px-4 py-3">
          {loading ? (
            <div className="flex min-h-[420px] items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          ) : error ? (
            <div className="modal-section-surface flex min-h-[320px] flex-col items-start justify-center gap-3 rounded-[24px] p-5">
                <div className="space-y-2">
                <h3 className="text-sm font-semibold text-foreground">
                    {t('toolbar.persona.loadFailed')}
                  </h3>
                  <p className="text-sm leading-5 text-muted-foreground">
                    {error}
                  </p>
                </div>
              <Button variant="outline" onClick={() => void handleReload()} className="h-8 rounded-full px-3 text-[12px] font-medium">
                {t('common:actions.refresh')}
              </Button>
            </div>
          ) : snapshot ? (
            <div className="flex min-h-0 flex-1 flex-col">
              {activeTabLockedMessage && (
                <div className="modal-section-surface mb-2 rounded-[20px] px-4 py-3 text-sm text-muted-foreground">
                  {activeTabLockedMessage}
                </div>
              )}
              <section className="flex min-h-0 flex-1 flex-col gap-2">
                {activeTab === 'identity' && renderFilePanel({
                  fileKey: 'identity',
                  fileLabel: 'IDENTITY.md',
                  helperText: t('toolbar.persona.notes.identity'),
                  value: drafts.identity,
                  onChange: (value) => updateDraft('identity', value),
                  fillHeight: true,
                  readOnly: lockedFileSet.has('identity'),
                })}

                {activeTab === 'master' && renderFilePanel({
                  fileKey: 'master',
                  fileLabel: 'USER.md',
                  helperText: t('toolbar.persona.notes.master'),
                  value: drafts.master,
                  onChange: (value) => updateDraft('master', value),
                  fillHeight: true,
                  readOnly: lockedFileSet.has('master'),
                })}

                {activeTab === 'memory' && renderFilePanel({
                  fileKey: 'memory',
                  fileLabel: 'MEMORY.md',
                  helperText: t('toolbar.persona.notes.memory'),
                  value: drafts.memory,
                  onChange: (value) => updateDraft('memory', value),
                  fillHeight: true,
                  readOnly: lockedFileSet.has('memory'),
                })}

                {activeTab === 'soul' && (
                  <div className="flex min-h-0 flex-1 flex-col gap-2">
                    <div className="grid grid-cols-4 gap-2.5">
                      {SOUL_TEMPLATES.map((template) => {
                        const selected = soulTemplateId === template.id;
                        return (
                          <button
                            key={template.id}
                            type="button"
                            onClick={() => selectSoulTemplate(template.id)}
                            disabled={soulLocked}
                            className={cn(
                              'relative min-h-[86px] rounded-[16px] border bg-white px-3 py-2.5 text-left transition-all duration-200 hover:-translate-y-[1px] dark:bg-[#18141f]',
                              selected
                                ? 'border-[#a68cff] bg-[#f6f2ff] shadow-[0_18px_42px_-34px_rgba(109,40,217,0.35)] dark:border-[#6e57d8] dark:bg-[#221a35]'
                                : 'border-black/10 hover:border-[#d8d0ff] hover:bg-[#fcfbff] dark:border-white/10 dark:hover:border-[#52428a] dark:hover:bg-[#20192f]',
                            )}
                          >
                            <div className="text-[16px] leading-none">{template.emoji}</div>
                            <div className="mt-2.5 space-y-0.5">
                              <p className={cn(
                                'text-sm font-semibold',
                                selected ? 'text-[#5d35ea] dark:text-[#c7b9ff]' : 'text-foreground dark:text-foreground/90',
                              )}>
                                {template.name}
                              </p>
                              <p className={cn(
                                'text-[11px] leading-4',
                                selected ? 'text-[#7b62eb] dark:text-[#ac98ff]' : 'text-foreground/62 dark:text-foreground/58',
                              )}>
                                {template.description}
                              </p>
                            </div>
                            {selected && (
                              <div className="absolute right-2.5 top-2.5 flex h-5.5 w-5.5 items-center justify-center rounded-full bg-[#e8ddff] text-[#6b46ef] dark:bg-[#3a2f61] dark:text-[#d0c2ff]">
                                <Check className="h-3 w-3" />
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>

                    <div className="min-h-0 flex-1">
                      {soulTemplateId === 'custom'
                        ? renderFilePanel({
                          fileKey: 'soul',
                          fileLabel: 'SOUL.md',
                          helperText: t('toolbar.persona.notes.soul'),
                          value: drafts.soul,
                          onChange: (value) => updateDraft('soul', value),
                          fillHeight: true,
                          readOnly: soulLocked,
                        })
                        : renderReadOnlyPanel({
                          fileKey: 'soul',
                          fileLabel: 'SOUL.md',
                          helperText: t('toolbar.persona.notes.soul'),
                          value: SOUL_TEMPLATES.find((template) => template.id === soulTemplateId)?.content
                            || '',
                        })}
                    </div>
                  </div>
                )}
              </section>
            </div>
          ) : null}
        </div>

        <div className="modal-footer border-t border-black/6 px-4 py-2.5 dark:border-white/10">
          <div className="mr-auto text-[12px] text-muted-foreground">
            {hasChanges ? t('toolbar.persona.unsaved') : t('toolbar.persona.savedState')}
          </div>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="h-8 rounded-full px-3 text-[12px] font-medium"
          >
            {t('common:actions.cancel')}
          </Button>
          <Button
            onClick={() => void handleSave()}
            disabled={!snapshot || loading || saving || !hasChanges || !snapshot.editable}
            className="h-8 rounded-full px-3.5 text-[12px] font-medium"
          >
            {saving ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                {t('toolbar.persona.saving')}
              </>
            ) : (
              t('common:actions.save')
            )}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
