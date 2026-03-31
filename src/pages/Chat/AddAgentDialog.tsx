import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useAgentsStore } from '@/stores/agents';

const inputClasses = 'modal-field-surface field-focus-ring h-[44px] rounded-xl font-mono text-[13px] shadow-sm transition-all text-foreground placeholder:text-foreground/40';
const labelClasses = 'text-[14px] text-foreground/80 font-bold';
const agentIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

interface AddAgentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddAgentDialog({ open, onOpenChange }: AddAgentDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? <AddAgentDialogBody onOpenChange={onOpenChange} /> : null}
    </Dialog>
  );
}

function AddAgentDialogBody({ onOpenChange }: Pick<AddAgentDialogProps, 'onOpenChange'>) {
  const { t } = useTranslation('agents');
  const agents = useAgentsStore((state) => state.agents);
  const createAgent = useAgentsStore((state) => state.createAgent);
  const [name, setName] = useState('');
  const [agentId, setAgentId] = useState('');
  const [saving, setSaving] = useState(false);

  const normalizedAgentId = agentId.trim().toLowerCase();
  const isIdFormatValid = agentIdPattern.test(normalizedAgentId);
  const isIdDuplicate = agents.some((agent) => agent.id === normalizedAgentId);
  const idError = !normalizedAgentId
    ? null
    : (!isIdFormatValid
      ? t('createDialog.idFormatError')
      : (isIdDuplicate ? t('createDialog.idDuplicateError') : null));
  const canSubmit = Boolean(name.trim() && normalizedAgentId && isIdFormatValid && !isIdDuplicate && !saving);

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    try {
      await createAgent(name.trim(), normalizedAgentId);
      toast.success(t('toast.agentCreated'));
      onOpenChange(false);
    } catch (error) {
      toast.error(t('toast.agentCreateFailed', { error: String(error) }));
      setSaving(false);
    }
  };
  return (
    <DialogContent
      hideCloseButton
      className="modal-card-surface w-full max-w-md overflow-hidden rounded-3xl border p-0"
    >
      <DialogHeader className="px-6 pb-2 pt-6">
        <DialogTitle className="modal-title">
          {t('createDialog.title')}
        </DialogTitle>
        <DialogDescription className="modal-description">
          {t('createDialog.description')}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-6 p-6 pt-4">
        <div className="space-y-2.5">
          <Label htmlFor="agent-name" className={labelClasses}>{t('createDialog.nameLabel')}</Label>
          <Input
            id="agent-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('createDialog.namePlaceholder')}
            className={inputClasses}
          />
        </div>
        <div className="space-y-2.5">
          <Label htmlFor="agent-id" className={labelClasses}>{t('createDialog.idLabel')}</Label>
          <Input
            id="agent-id"
            value={agentId}
            onChange={(event) => setAgentId(event.target.value)}
            placeholder={t('createDialog.idPlaceholder')}
            className={cn(inputClasses, idError && 'border-destructive focus-visible:ring-destructive/30 focus-visible:border-destructive')}
          />
          <p className={cn('text-[12px]', idError ? 'text-destructive' : 'text-muted-foreground')}>
            {idError || t('createDialog.idHint')}
          </p>
        </div>
        <div className="modal-footer">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="modal-secondary-button"
          >
            {t('common:actions.cancel')}
          </Button>
          <Button
            onClick={() => void handleSubmit()}
            disabled={!canSubmit}
            className="modal-primary-button"
          >
            {saving ? (
              <>
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                {t('creating')}
              </>
            ) : (
              t('common:actions.save')
            )}
          </Button>
        </div>
      </div>
    </DialogContent>
  );
}
