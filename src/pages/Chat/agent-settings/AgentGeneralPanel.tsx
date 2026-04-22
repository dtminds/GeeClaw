import { useEffect, useState } from 'react';
import { Loader2, Pencil, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { AgentAvatar } from '@/components/agents/AgentAvatar';
import { AgentAvatarPicker } from '@/components/agents/AgentAvatarPicker';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { toUserMessage } from '@/lib/api-client';
import { hostApiFetch } from '@/lib/host-api';
import { DEFAULT_AGENT_AVATAR_PRESET_ID, type AgentAvatarPresetId } from '@/lib/agent-avatar-presets';
import { useAgentsStore } from '@/stores/agents';

interface AgentGeneralPanelProps {
  agentId: string;
  title: string;
  description?: string;
  onDeleted?: () => void;
}

type AgentMemorySettingsSnapshot = {
  activeMemory: {
    enabled: boolean;
    agents: string[];
  };
};

const inputClasses = 'modal-field-surface field-focus-ring h-[44px] rounded-xl font-mono text-[13px] shadow-sm transition-all text-foreground placeholder:text-foreground/40';
const labelClasses = 'text-[13px] font-semibold text-foreground/70';

export function AgentGeneralPanel({ agentId, title, description, onDeleted }: AgentGeneralPanelProps) {
  const { t } = useTranslation(['chat', 'common']);
  const agent = useAgentsStore((state) => state.agents.find((entry) => entry.id === agentId));
  const updateAgentSettings = useAgentsStore((state) => state.updateAgentSettings);
  const deleteAgent = useAgentsStore((state) => state.deleteAgent);
  const [identityDialogOpen, setIdentityDialogOpen] = useState(false);
  const [draftName, setDraftName] = useState(agent?.name ?? '');
  const [draftAvatarPresetId, setDraftAvatarPresetId] = useState<AgentAvatarPresetId>(
    agent?.avatarPresetId ?? DEFAULT_AGENT_AVATAR_PRESET_ID,
  );
  const [savingIdentity, setSavingIdentity] = useState(false);
  const [loadingActiveMemory, setLoadingActiveMemory] = useState(true);
  const [activeMemoryGloballyEnabled, setActiveMemoryGloballyEnabled] = useState(false);
  const [activeMemoryEnabledForAgent, setActiveMemoryEnabledForAgent] = useState(false);
  const [savingActiveMemory, setSavingActiveMemory] = useState(false);
  const [savingActiveEvolution, setSavingActiveEvolution] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (identityDialogOpen) {
      return;
    }

    setDraftName(agent?.name ?? '');
    setDraftAvatarPresetId(agent?.avatarPresetId ?? DEFAULT_AGENT_AVATAR_PRESET_ID);
  }, [agent?.avatarPresetId, agent?.name, agentId, identityDialogOpen]);

  useEffect(() => {
    let cancelled = false;

    setLoadingActiveMemory(true);
    (async () => {
      try {
        const snapshot = await hostApiFetch<AgentMemorySettingsSnapshot>('/api/settings/memory');
        if (cancelled) {
          return;
        }
        setActiveMemoryGloballyEnabled(snapshot.activeMemory.enabled);
        setActiveMemoryEnabledForAgent(snapshot.activeMemory.agents.includes(agentId));
      } catch {
        if (!cancelled) {
          setActiveMemoryGloballyEnabled(false);
          setActiveMemoryEnabledForAgent(false);
        }
      } finally {
        if (!cancelled) {
          setLoadingActiveMemory(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [agentId]);

  const canSaveIdentity = Boolean(agent
    && draftName.trim()
    && (draftName.trim() !== agent.name || draftAvatarPresetId !== agent.avatarPresetId));
  const isDeleteProtected = Boolean(agent && (agent.isDefault || agent.id === 'main'));
  const deleteDisabled = !agent || deleting || isDeleteProtected;
  const activeMemoryToggleDisabled = !agent
    || deleting
    || loadingActiveMemory
    || savingActiveMemory
    || !activeMemoryGloballyEnabled;
  const activeEvolutionEnabledForAgent = agent?.activeEvolutionEnabled ?? true;
  const activeEvolutionToggleDisabled = !agent || deleting || savingActiveEvolution;
  const activeEvolutionDescription = t('agentSettingsDialog.general.activeEvolutionDescription');

  const handleOpenIdentityDialog = () => {
    if (!agent || deleting) {
      return;
    }

    setDraftName(agent.name);
    setDraftAvatarPresetId(agent.avatarPresetId ?? DEFAULT_AGENT_AVATAR_PRESET_ID);
    setIdentityDialogOpen(true);
  };

  const handleSaveIdentity = async () => {
    if (!agent || !canSaveIdentity) return;
    setSavingIdentity(true);
    try {
      await updateAgentSettings(agent.id, {
        name: draftName.trim(),
        avatarPresetId: draftAvatarPresetId,
      });
      toast.success(t('agentSettingsDialog.general.toastSaved'));
      setIdentityDialogOpen(false);
    } catch (error) {
      toast.error(t('agentSettingsDialog.general.toastSaveFailed', { error: toUserMessage(error) }));
    } finally {
      setSavingIdentity(false);
    }
  };

  const handleDelete = async () => {
    if (!agent) return;
    setDeleting(true);
    try {
      await deleteAgent(agent.id);
      toast.success(t('agentSettingsDialog.general.toastDeleted'));
      onDeleted?.();
      setConfirmDelete(false);
    } catch (error) {
      toast.error(t('agentSettingsDialog.general.toastDeleteFailed', { error: toUserMessage(error) }));
    } finally {
      setDeleting(false);
    }
  };

  const handleActiveMemoryToggle = async (nextEnabled: boolean) => {
    if (!agent || activeMemoryToggleDisabled) {
      return;
    }

    const previousValue = activeMemoryEnabledForAgent;
    setActiveMemoryEnabledForAgent(nextEnabled);
    setSavingActiveMemory(true);
    try {
      await updateAgentSettings(agent.id, { activeMemoryEnabled: nextEnabled });
    } catch (error) {
      setActiveMemoryEnabledForAgent(previousValue);
      toast.error(t('agentSettingsDialog.general.toastSaveFailed', { error: toUserMessage(error) }));
    } finally {
      setSavingActiveMemory(false);
    }
  };

  const handleActiveEvolutionToggle = async (nextEnabled: boolean) => {
    if (!agent || activeEvolutionToggleDisabled) {
      return;
    }

    setSavingActiveEvolution(true);
    try {
      await updateAgentSettings(agent.id, {
        activeEvolutionEnabled: nextEnabled,
      });
    } catch (error) {
      toast.error(t('agentSettingsDialog.general.toastSaveFailed', { error: toUserMessage(error) }));
    } finally {
      setSavingActiveEvolution(false);
    }
  };

  return (
    <section className="flex min-h-full flex-col px-1 pr-1">
      <header className="space-y-1">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </header>
      <div className="mt-4 flex flex-col gap-5 pb-1">
        <div className="modal-section-surface flex min-w-0 items-center justify-between gap-3 rounded-2xl p-4">
          <div className="flex min-w-0 items-center gap-3">
            <AgentAvatar
              presetId={agent?.avatarPresetId}
              label={agent?.name}
              size="picker"
              className="h-12 w-12 shrink-0"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-foreground">
                {agent?.name || t('agentSettingsDialog.general.namePlaceholder')}
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={handleOpenIdentityDialog}
            disabled={!agent || deleting}
            className="modal-secondary-button h-9 shrink-0 px-3"
          >
            <Pencil className="mr-2 h-4 w-4" />
            {t('common:actions.edit')}
          </Button>
        </div>

        <div className="rounded-2xl border border-black/6 bg-black/[0.02] p-4 dark:border-white/10 dark:bg-white/[0.04]">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor="agent-general-active-memory" className={labelClasses}>
                {t('agentSettingsDialog.general.activeMemoryLabel')}
              </Label>
              <p className="text-xs text-muted-foreground">
                {activeMemoryGloballyEnabled
                  ? t('agentSettingsDialog.general.activeMemoryDescription')
                  : t('agentSettingsDialog.general.activeMemoryDisabledHint')}
              </p>
            </div>
            <Switch
              id="agent-general-active-memory"
              aria-label={t('agentSettingsDialog.general.activeMemoryLabel')}
              checked={activeMemoryEnabledForAgent}
              disabled={activeMemoryToggleDisabled}
              onCheckedChange={(checked) => { void handleActiveMemoryToggle(checked); }}
            />
          </div>
        </div>

        <div className="rounded-2xl border border-black/6 bg-black/[0.02] p-4 dark:border-white/10 dark:bg-white/[0.04]">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor="agent-general-active-evolution" className={labelClasses}>
                {t('agentSettingsDialog.general.activeEvolutionLabel')}
              </Label>
              <p className="text-xs text-muted-foreground">
                {activeEvolutionDescription}
              </p>
            </div>
            <Switch
              id="agent-general-active-evolution"
              aria-label={t('agentSettingsDialog.general.activeEvolutionLabel')}
              checked={activeEvolutionEnabledForAgent}
              disabled={activeEvolutionToggleDisabled}
              onCheckedChange={(checked) => { void handleActiveEvolutionToggle(checked); }}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-black/6 bg-black/[0.02] p-4 text-sm text-muted-foreground dark:border-white/10 dark:bg-white/[0.04]">
          <div className="space-y-1">
            <p className="text-sm font-semibold text-foreground/80">
              {t('agentSettingsDialog.general.deleteLabel')}
            </p>
            <p className="text-xs text-muted-foreground">
              {isDeleteProtected
                ? t('agentSettingsDialog.general.deleteDisabledHint')
                : t('agentSettingsDialog.general.deleteMessage')}
            </p>
          </div>
          <Button
            type="button"
            variant="destructive"
            onClick={() => setConfirmDelete(true)}
            disabled={deleteDisabled}
            className="h-9 rounded-full px-4 text-[13px] font-semibold"
          >
            <Trash2 className="mr-2 h-4 w-4" />
            {t('agentSettingsDialog.general.deleteLabel')}
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title={t('agentSettingsDialog.general.deleteTitle')}
        message={t('agentSettingsDialog.general.deleteMessage')}
        confirmLabel={t('agentSettingsDialog.general.deleteConfirm')}
        cancelLabel={t('agentSettingsDialog.general.deleteCancel')}
        variant="destructive"
        loading={deleting}
        onConfirm={() => void handleDelete()}
        onCancel={() => {
          if (deleting) return;
          setConfirmDelete(false);
        }}
      />

      <Dialog open={identityDialogOpen} onOpenChange={(open) => {
        if (savingIdentity) return;
        setIdentityDialogOpen(open);
      }}>
        <DialogContent
          hideCloseButton
          className="modal-card-surface w-[min(520px,calc(100vw-2rem))] max-w-[520px] overflow-hidden rounded-3xl border p-0"
        >
          <DialogHeader className="px-6 pb-0 pt-6">
            <DialogTitle className="modal-title">
              {t('agentSettingsDialog.general.identityDialogTitle')}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-5 p-6 pt-5">
            <div className="space-y-2.5">
              <Label htmlFor="agent-identity-name" className={labelClasses}>
                {t('agentSettingsDialog.general.nameLabel')}
              </Label>
              <Input
                id="agent-identity-name"
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                placeholder={t('agentSettingsDialog.general.namePlaceholder')}
                className={inputClasses}
                disabled={!agent || savingIdentity}
              />
            </div>

            <div className="space-y-2.5">
              <div className="space-y-1">
                <Label className={labelClasses}>
                  {t('agentSettingsDialog.general.avatarLabel', 'Avatar')}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t('agentSettingsDialog.general.avatarDescription', 'Choose a preset avatar')}
                </p>
              </div>
              <AgentAvatarPicker
                value={draftAvatarPresetId}
                onChange={setDraftAvatarPresetId}
                disabled={!agent || savingIdentity}
              />
            </div>

            <div className="modal-footer">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIdentityDialogOpen(false)}
                disabled={savingIdentity}
                className="modal-secondary-button"
              >
                {t('common:actions.cancel')}
              </Button>
              <Button
                type="button"
                onClick={() => void handleSaveIdentity()}
                disabled={!canSaveIdentity || savingIdentity}
                className="modal-primary-button"
              >
                {savingIdentity ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t('common:status.saving')}
                  </>
                ) : (
                  t('common:actions.save')
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
