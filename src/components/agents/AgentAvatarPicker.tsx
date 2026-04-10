import { AgentAvatar } from '@/components/agents/AgentAvatar';
import {
  AGENT_AVATAR_PRESETS,
  type AgentAvatarPresetId,
} from '@/lib/agent-avatar-presets';
import { cn } from '@/lib/utils';

interface AgentAvatarPickerProps {
  value: AgentAvatarPresetId;
  onChange: (presetId: AgentAvatarPresetId) => void;
  disabled?: boolean;
}

export function AgentAvatarPicker({ value, onChange, disabled = false }: AgentAvatarPickerProps) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5">
        {AGENT_AVATAR_PRESETS.map((preset) => {
          const selected = preset.id === value;
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => onChange(preset.id)}
              disabled={disabled}
              aria-pressed={selected}
              aria-label={preset.label}
              className={cn(
                'bg-black/[0.02] dark:bg-white/[0.04] group flex flex-col items-center gap-2 rounded-2xl px-2 py-3 text-center',
                selected
                  ? 'ring-2 ring-primary/45'
                  : 'surface-hover',
              )}
            >
              <AgentAvatar presetId={preset.id} label={preset.label} size="compact" />
              <span className="text-[11px] font-medium leading-tight text-foreground/80 group-disabled:text-foreground/40">
                {preset.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
