import { useEffect, useMemo, useState } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { AgentAvatarPicker } from '@/components/agents/AgentAvatarPicker';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toUserMessage } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import type { AgentAvatarPresetId } from '@/lib/agent-avatar-presets';
import { useAgentsStore } from '@/stores/agents';

interface AgentGeneralPanelProps {
  agentId: string;
  title: string;
  description?: string;
  onDeleted?: () => void;
}

const inputClasses = 'modal-field-surface field-focus-ring h-[44px] rounded-xl font-mono text-[13px] shadow-sm transition-all text-foreground placeholder:text-foreground/40';
const labelClasses = 'text-[13px] font-semibold text-foreground/70';

export function AgentGeneralPanel({ agentId, title, description, onDeleted }: AgentGeneralPanelProps) {
  const { t } = useTranslation(['chat', 'common']);
  const agent = useAgentsStore((state) => state.agents.find((entry) => entry.id === agentId));
  const updateAgentSettings = useAgentsStore((state) => state.updateAgentSettings);
  const deleteAgent = useAgentsStore((state) => state.deleteAgent);
  const [name, setName] = useState(agent?.name ?? '');
  const [avatarPresetId, setAvatarPresetId] = useState<AgentAvatarPresetId | null>(agent?.avatarPresetId ?? null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setName(agent?.name ?? '');
    setAvatarPresetId(agent?.avatarPresetId ?? null);
  }, [agent?.avatarPresetId, agent?.name, agentId]);

  const modelLabel = useMemo(() => {
    if (!agent) return '';
    const suffix = agent.inheritedModel ? ` ${t('agentSettingsDialog.general.inheritedSuffix')}` : '';
    return `${agent.modelDisplay}${suffix}`;
  }, [agent, t]);

  const canSave = Boolean(
    agent
    && (
      (name.trim() && name.trim() !== agent.name)
      || (avatarPresetId && avatarPresetId !== agent.avatarPresetId)
    ),
  );
  const isDeleteProtected = Boolean(agent && (agent.isDefault || agent.id === 'main'));
  const deleteDisabled = !agent || deleting || isDeleteProtected;

  const handleSave = async () => {
    if (!agent || !canSave || !avatarPresetId) return;
    setSaving(true);
    try {
      const updates: { name?: string; avatarPresetId?: AgentAvatarPresetId } = {};
      if (name.trim() && name.trim() !== agent.name) {
        updates.name = name.trim();
      }
      if (avatarPresetId !== agent.avatarPresetId) {
        updates.avatarPresetId = avatarPresetId;
      }
      await updateAgentSettings(agent.id, updates);
      toast.success(t('agentSettingsDialog.general.toastSaved'));
    } catch (error) {
      toast.error(t('agentSettingsDialog.general.toastSaveFailed', { error: toUserMessage(error) }));
    } finally {
      setSaving(false);
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

  return (
    <section className="flex h-full min-h-0 flex-col px-1 pr-1">
      <header className="space-y-1">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </header>
      <div className="mt-4 flex min-h-0 flex-1 flex-col gap-5">
        <div className="space-y-2.5">
          <Label htmlFor="agent-general-name" className={labelClasses}>
            {t('agentSettingsDialog.general.nameLabel')}
          </Label>
          <div className="flex flex-wrap gap-2">
            <Input
              id="agent-general-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('agentSettingsDialog.general.namePlaceholder')}
              className={cn(inputClasses, 'flex-1')}
              disabled={!agent || saving || deleting}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => void handleSave()}
              disabled={!canSave || saving || deleting}
              className="modal-field-surface surface-hover h-[44px] rounded-xl px-4 text-[13px] font-medium text-foreground/80 shadow-none"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : t('common:actions.save')}
            </Button>
          </div>
        </div>

        {avatarPresetId ? (
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
              value={avatarPresetId}
              onChange={setAvatarPresetId}
              disabled={!agent || saving || deleting}
            />
          </div>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2.5">
            <Label htmlFor="agent-general-id" className={labelClasses}>
              {t('agentSettingsDialog.general.agentIdLabel')}
            </Label>
            <Input
              id="agent-general-id"
              value={agent?.id ?? ''}
              readOnly
              className={inputClasses}
            />
          </div>
          <div className="space-y-2.5">
            <Label htmlFor="agent-general-model" className={labelClasses}>
              {t('agentSettingsDialog.general.modelLabel')}
            </Label>
            <Input
              id="agent-general-model"
              value={modelLabel}
              readOnly
              className={inputClasses}
            />
          </div>
        </div>

        <div className="mt-auto flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-black/6 bg-black/[0.02] p-4 text-sm text-muted-foreground dark:border-white/10 dark:bg-white/[0.04]">
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
    </section>
  );
}
