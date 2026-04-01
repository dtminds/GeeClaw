import { useCallback, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { AgentGeneralPanel } from '@/pages/Chat/agent-settings/AgentGeneralPanel';
import { AgentSkillsPanel } from '@/pages/Chat/agent-settings/AgentSkillsPanel';
import { AgentMarkdownPanel } from '@/pages/Chat/agent-settings/AgentMarkdownPanel';
import { AgentSoulPanel } from '@/pages/Chat/agent-settings/AgentSoulPanel';
import {
  SOUL_TEMPLATES,
  useAgentPersona,
  type PersonaFileKey,
} from '@/pages/Chat/agent-settings/useAgentPersona';

const SECTION_DEFINITIONS = [
  { id: 'general' },
  { id: 'skills' },
  { id: 'identity', personaKey: 'identity' },
  { id: 'soul', personaKey: 'soul' },
  { id: 'memory', personaKey: 'memory' },
  { id: 'ownerProfile', personaKey: 'master' },
] as const satisfies ReadonlyArray<{
  id: string;
  personaKey?: PersonaFileKey;
}>;

type AgentSettingsSection = typeof SECTION_DEFINITIONS[number]['id'];

interface AgentSettingsDialogProps {
  open: boolean;
  agentId: string;
  onOpenChange: (open: boolean) => void;
}

export function AgentSettingsDialog({ open, agentId, onOpenChange }: AgentSettingsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? <AgentSettingsDialogBody agentId={agentId} onOpenChange={onOpenChange} /> : null}
    </Dialog>
  );
}

function AgentSettingsDialogBody({ agentId, onOpenChange }: Omit<AgentSettingsDialogProps, 'open'>) {
  const { t } = useTranslation('chat');
  const [activeSection, setActiveSection] = useState<AgentSettingsSection>(SECTION_DEFINITIONS[0].id);
  const {
    snapshot,
    drafts,
    loading,
    saving,
    error,
    updateDraft,
    soulTemplateId,
    lockedFileSet,
    hasSectionChanges,
    selectSoulTemplate,
    saveSection,
  } = useAgentPersona(agentId, true);

  const sections = useMemo(() => SECTION_DEFINITIONS.map((section) => ({
    ...section,
    label: t(`agentSettingsDialog.sections.${section.id}.label`),
    title: t(`agentSettingsDialog.sections.${section.id}.title`),
    description: t(`agentSettingsDialog.sections.${section.id}.description`),
    placeholder: t(`agentSettingsDialog.sections.${section.id}.placeholder`),
  })), [t]);

  const activeMeta = sections.find((section) => section.id === activeSection) ?? sections[0];
  const getTabId = (sectionId: AgentSettingsSection) => `agent-settings-tab-${sectionId}`;
  const getPanelId = (sectionId: AgentSettingsSection) => `agent-settings-panel-${sectionId}`;
  const fileLabels: Record<PersonaFileKey, string> = {
    identity: 'IDENTITY.md',
    master: 'USER.md',
    soul: 'SOUL.md',
    memory: 'MEMORY.md',
  };
  const personaError = snapshot ? null : error;
  const personaLoading = loading && !snapshot;
  const isPersonaEditable = snapshot?.editable ?? false;

  const getLockedMessage = useCallback((fileKey: PersonaFileKey) => {
    if (!lockedFileSet.has(fileKey)) {
      return null;
    }

    if (fileKey === 'identity') {
      return t('toolbar.persona.lockedManaged.identity');
    }

    return t('toolbar.persona.lockedManaged.default');
  }, [lockedFileSet, t]);

  const handleSaveSection = useCallback(async (fileKey: PersonaFileKey) => {
    if (!snapshot || !snapshot.editable) return;
    const result = await saveSection(fileKey);
    if (!result) return;
    if ('response' in result) {
      toast.success(t('toolbar.persona.toast.saved'));
    } else {
      toast.error(`${t('toolbar.persona.toast.failed')}: ${result.error}`);
    }
  }, [saveSection, snapshot, t]);

  const renderPanel = () => {
    if (activeMeta.id === 'general') {
      return (
        <AgentGeneralPanel
          agentId={agentId}
          title={activeMeta.title}
          description={activeMeta.description}
          onDeleted={() => onOpenChange(false)}
        />
      );
    }

    if (activeMeta.id === 'skills') {
      return (
        <AgentSkillsPanel
          agentId={agentId}
          title={activeMeta.title}
          description={activeMeta.description}
        />
      );
    }

    if (!activeMeta.personaKey) {
      return null;
    }

    const personaKey = activeMeta.personaKey;
    const personaValue = drafts[personaKey];
    const fileLabel = fileLabels[personaKey];
    const fileExists = snapshot?.files[personaKey].exists ?? false;
    const lockedMessage = getLockedMessage(personaKey);
    const canSave = Boolean(isPersonaEditable && hasSectionChanges(personaKey));
    const readOnly = !isPersonaEditable || lockedFileSet.has(personaKey);

    if (personaKey === 'soul') {
      return (
        <AgentSoulPanel
          title={activeMeta.title}
          templates={SOUL_TEMPLATES}
          templateId={soulTemplateId}
          value={personaValue}
          placeholder={t('toolbar.persona.placeholders.soul')}
          helperText={t('toolbar.persona.notes.soul')}
          exists={fileExists}
          lockedMessage={lockedMessage}
          loading={personaLoading}
          loadingLabel={t('agentSettingsDialog.panels.loading')}
          error={personaError}
          errorLabel={t('agentSettingsDialog.panels.error')}
          saving={saving}
          canSave={canSave}
          isEditable={isPersonaEditable}
          isLocked={lockedFileSet.has('soul')}
          onTemplateChange={selectSoulTemplate}
          onChange={(value) => updateDraft('soul', value)}
          onSave={() => void handleSaveSection('soul')}
          fieldId="agent-settings-soul"
        />
      );
    }

    return (
      <AgentMarkdownPanel
        title={activeMeta.title}
        fileLabel={fileLabel}
        helperText={t(`toolbar.persona.notes.${personaKey}`)}
        value={personaValue}
        placeholder={t(`toolbar.persona.placeholders.${personaKey}`)}
        loading={personaLoading}
        loadingLabel={t('agentSettingsDialog.panels.loading')}
        error={personaError}
        errorLabel={t('agentSettingsDialog.panels.error')}
        exists={fileExists}
        lockedMessage={lockedMessage}
        readOnly={readOnly}
        saving={saving}
        canSave={canSave}
        onChange={(value) => updateDraft(personaKey, value)}
        onSave={() => void handleSaveSection(personaKey)}
        fieldId={`agent-settings-${personaKey}`}
      />
    );
  };

  return (
    <DialogContent
      hideCloseButton
      onInteractOutside={(event) => {
        event.preventDefault();
      }}
      className="modal-card-surface h-[min(88vh,860px)] min-h-[620px] w-[min(980px,calc(100vw-2rem))] max-w-[980px] overflow-hidden rounded-[28px] border p-0"
    >
      <div className="flex h-full flex-col">
        <div className="flex items-start justify-between gap-6 border-b border-black/6 px-6 py-4 dark:border-white/10 sm:px-7">
          <DialogHeader className="pr-8">
            <DialogTitle className="modal-title">
              {t('agentSettingsDialog.title')}
            </DialogTitle>
            <DialogDescription className="modal-description mt-0">
              {t('agentSettingsDialog.description')}
            </DialogDescription>
          </DialogHeader>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onOpenChange(false)}
            className="modal-close-button -mr-2 -mt-2"
            aria-label={t('common:actions.close')}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden sm:grid sm:grid-cols-[220px_minmax(0,1fr)]">
            <aside className="min-h-0 bg-sidebar border-b border-black/6 px-3 py-4 dark:border-white/10 sm:border-b-0 sm:border-r">
              <div
                role="tablist"
                aria-label={t('agentSettingsDialog.navigation')}
                className="flex gap-2 overflow-x-auto pb-1 sm:flex-col sm:gap-1 sm:overflow-visible"
              >
                {sections.map((section) => {
                  const selected = activeSection === section.id;
                  const tabId = getTabId(section.id);
                  const panelId = getPanelId(section.id);
                  return (
                    <button
                      key={section.id}
                      id={tabId}
                      role="tab"
                      type="button"
                      onClick={() => setActiveSection(section.id)}
                      aria-selected={selected}
                      aria-controls={panelId}
                      tabIndex={selected ? 0 : -1}
                      className={cn(
                        'inline-flex items-center justify-between gap-2 rounded-2xl px-4 py-2 text-sm font-semibold transition-colors sm:w-full',
                        selected
                          ? 'sidebar-item-active text-foreground'
                          : 'text-muted-foreground hover:bg-white/60 hover:text-foreground dark:hover:bg-white/6 dark:hover:text-foreground',
                      )}
                    >
                      <span className="truncate">{section.label}</span>
                    </button>
                  );
                })}
              </div>
            </aside>

            <div
              className="flex min-h-0 flex-1 flex-col overflow-hidden px-5 py-5 sm:px-6"
              data-testid="agent-settings-content"
            >
              <div
                role="tabpanel"
                id={getPanelId(activeSection)}
                aria-labelledby={getTabId(activeSection)}
                tabIndex={0}
                className="flex min-h-0 flex-1 flex-col overflow-y-auto"
              >
                {renderPanel()}
              </div>
            </div>
          </div>
      </div>
    </DialogContent>
  );
}
