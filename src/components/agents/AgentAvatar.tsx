import { AGENT_AVATAR_PRESET_MAP, normalizeAgentAvatarPresetId, type AgentAvatarPresetId } from '@/lib/agent-avatar-presets';
import { cn } from '@/lib/utils';

type AgentAvatarSize = 'compact' | 'full' | 'picker';

interface AgentAvatarProps {
  presetId?: AgentAvatarPresetId | string;
  label?: string;
  size?: AgentAvatarSize;
  className?: string;
  testId?: string;
}

const sizeClassMap: Record<AgentAvatarSize, string> = {
  compact: 'h-7 w-7',
  full: 'h-8 w-8',
  picker: 'h-14 w-14',
};

const textClassMap: Record<AgentAvatarSize, string> = {
  compact: 'text-[11px]',
  full: 'text-[12px]',
  picker: 'text-[20px]',
};

export function AgentAvatar({
  presetId,
  label,
  size = 'full',
  className,
  testId = 'agent-avatar',
}: AgentAvatarProps) {
  const normalizedPresetId = normalizeAgentAvatarPresetId(presetId);
  const preset = AGENT_AVATAR_PRESET_MAP[normalizedPresetId];
  const initial = (label ?? '').trim().slice(0, 1).toUpperCase();

  return (
    <div
      data-testid={testId}
      data-avatar-size={size}
      data-avatar-preset={preset.id}
      data-avatar-kind="gradient"
      className={cn(
        'relative overflow-hidden rounded-full border border-black/8 shadow-[0_8px_18px_-14px_rgba(15,23,42,0.5)] dark:border-white/10',
        sizeClassMap[size],
        className,
      )}
      style={{ background: preset.palette.background }}
    >
      {initial ? (
        <span
          className={cn(
            'absolute inset-0 flex items-center justify-center font-semibold text-white',
            textClassMap[size],
          )}
        >
          {initial}
        </span>
      ) : null}
    </div>
  );
}
