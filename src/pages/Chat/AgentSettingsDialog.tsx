import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
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
import { AgentMarkdownPanel } from '@/pages/Chat/agent-settings/AgentMarkdownPanel';
import { useAgentPersona, type PersonaFileKey } from '@/pages/Chat/agent-settings/useAgentPersona';

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
  const { t } = useTranslation('chat');
  const [activeSection, setActiveSection] = useState<AgentSettingsSection>(SECTION_DEFINITIONS[0].id);
  const { drafts, loading, error } = useAgentPersona(agentId, open);

  useEffect(() => {
    if (!open) return;
    setActiveSection(SECTION_DEFINITIONS[0].id);
  }, [agentId, open]);

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

    if (!activeMeta.personaKey) {
      return (
        <AgentMarkdownPanel
          title={activeMeta.title}
          description={activeMeta.description}
          placeholder={activeMeta.placeholder}
        />
      );
    }

    const personaValue = drafts[activeMeta.personaKey];

    return (
      <AgentMarkdownPanel
        title={activeMeta.title}
        description={activeMeta.description}
        placeholder={activeMeta.placeholder}
        loading={loading}
        loadingLabel={t('agentSettingsDialog.panels.loading')}
        error={error}
        errorLabel={t('agentSettingsDialog.panels.error')}
        value={personaValue}
      />
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        hideCloseButton
        className="modal-card-surface w-[min(980px,calc(100vw-2rem))] max-w-[980px] max-h-[min(88vh,860px)] overflow-hidden rounded-[28px] border p-0"
      >
        <div className="flex h-full flex-col">
          <div className="flex items-start justify-between gap-6 border-b border-black/6 px-6 py-5 dark:border-white/10 sm:px-7">
            <DialogHeader className="pr-8">
              <DialogTitle className="modal-title">
                {t('agentSettingsDialog.title')}
              </DialogTitle>
              <DialogDescription className="modal-description mt-2">
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

          <div className="flex min-h-0 flex-1 flex-col sm:grid sm:grid-cols-[220px_minmax(0,1fr)]">
            <aside className="border-b border-black/6 px-4 py-3 dark:border-white/10 sm:border-b-0 sm:border-r sm:px-5 sm:py-5">
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
                        'inline-flex items-center justify-between gap-2 rounded-2xl px-3 py-2 text-sm font-semibold transition-colors sm:w-full',
                        selected
                          ? 'modal-field-surface text-foreground shadow-sm'
                          : 'text-foreground/52 hover:text-foreground/80 surface-hover',
                      )}
                    >
                      <span className="truncate">{section.label}</span>
                    </button>
                  );
                })}
              </div>
            </aside>

            <div
              className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6"
              data-testid="agent-settings-content"
            >
              <div
                role="tabpanel"
                id={getPanelId(activeSection)}
                aria-labelledby={getTabId(activeSection)}
                tabIndex={0}
                className="min-h-0 flex-1"
              >
                {renderPanel()}
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
