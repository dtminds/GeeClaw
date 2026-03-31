import { useAgentPersona } from '@/pages/Chat/agent-settings/useAgentPersona';

interface AgentSettingsDialogProps {
  open: boolean;
  agentId: string;
  onOpenChange: (open: boolean) => void;
}

export function AgentSettingsDialog({ open, agentId, onOpenChange }: AgentSettingsDialogProps) {
  const { drafts, loading, error } = useAgentPersona(agentId, open);

  if (!open) {
    return null;
  }

  return (
    <div role="dialog" aria-label="Agent Settings">
      {loading ? (
        <p>Loading agent persona…</p>
      ) : (
        <textarea
          aria-label="identity"
          value={drafts.identity}
          readOnly
        />
      )}
      {error && (
        <p>{error}</p>
      )}
      <button type="button" onClick={() => onOpenChange(false)}>
        Close
      </button>
    </div>
  );
}
