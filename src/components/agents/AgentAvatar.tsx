import { AGENT_AVATAR_PRESET_MAP, normalizeAgentAvatarPresetId, type AgentAvatarPresetId } from '@/lib/agent-avatar-presets';
import { cn } from '@/lib/utils';

type AgentAvatarSize = 'compact' | 'full' | 'picker';

interface AgentAvatarProps {
  presetId?: AgentAvatarPresetId | string;
  size?: AgentAvatarSize;
  className?: string;
  testId?: string;
}

const sizeClassMap: Record<AgentAvatarSize, string> = {
  compact: 'h-7 w-7',
  full: 'h-8 w-8',
  picker: 'h-14 w-14',
};

export function AgentAvatar({
  presetId,
  size = 'full',
  className,
  testId = 'agent-avatar',
}: AgentAvatarProps) {
  const normalizedPresetId = normalizeAgentAvatarPresetId(presetId);
  const preset = AGENT_AVATAR_PRESET_MAP[normalizedPresetId];

  return (
    <div
      data-testid={testId}
      data-avatar-size={size}
      data-avatar-preset={preset.id}
      data-avatar-kind={preset.kind}
      className={cn(
        'relative overflow-hidden rounded-full border border-black/8 shadow-[0_8px_18px_-14px_rgba(15,23,42,0.5)] dark:border-white/10',
        sizeClassMap[size],
        className,
      )}
      style={{ background: preset.palette.background }}
      aria-hidden="true"
    >
      {preset.kind === 'gradient' ? (
        <>
          <div className="absolute inset-[18%] rounded-full bg-white/18" />
          <div
            className="absolute inset-[30%] rounded-full border"
            style={{ borderColor: preset.palette.accent }}
          />
          <div
            className="absolute bottom-[18%] left-[18%] h-[24%] w-[58%] rounded-full blur-[1px]"
            style={{ backgroundColor: `${preset.palette.accent}55` }}
          />
        </>
      ) : preset.id === 'chibi-robot' ? (
        <>
          <div className="absolute left-1/2 top-[10%] h-[16%] w-[8%] -translate-x-1/2 rounded-full" style={{ backgroundColor: preset.palette.stroke }} />
          <div className="absolute left-1/2 top-[4%] h-[14%] w-[14%] -translate-x-1/2 rounded-full" style={{ backgroundColor: preset.palette.accent }} />
          <div className="absolute left-[22%] top-[25%] h-[48%] w-[56%] rounded-[35%]" style={{ backgroundColor: preset.palette.skin }} />
          <div className="absolute left-[30%] top-[38%] h-[8%] w-[8%] rounded-full bg-slate-700" />
          <div className="absolute right-[30%] top-[38%] h-[8%] w-[8%] rounded-full bg-slate-700" />
          <div className="absolute left-[30%] top-[54%] h-[6%] w-[40%] rounded-full bg-slate-500/70" />
          <div className="absolute bottom-[8%] left-[28%] h-[26%] w-[44%] rounded-t-[45%]" style={{ backgroundColor: `${preset.palette.accent}99` }} />
        </>
      ) : (
        <>
          <div className="absolute left-[27%] top-[18%] h-[50%] w-[46%] rounded-[45%]" style={{ backgroundColor: preset.palette.skin }} />
          <div className="absolute left-[24%] top-[12%] h-[28%] w-[52%] rounded-t-[60%] rounded-b-[35%]" style={{ backgroundColor: preset.palette.hair }} />
          <div className="absolute left-[35%] top-[39%] h-[7%] w-[7%] rounded-full bg-slate-800/80" />
          <div className="absolute right-[35%] top-[39%] h-[7%] w-[7%] rounded-full bg-slate-800/80" />
          <div className="absolute left-[41%] top-[49%] h-[4%] w-[18%] rounded-full bg-rose-400/70" />
          <div className="absolute bottom-[8%] left-[24%] h-[28%] w-[52%] rounded-t-[48%]" style={{ backgroundColor: `${preset.palette.accent}cc` }} />
          {preset.accessory === 'glasses' ? (
            <>
              <div className="absolute left-[29%] top-[35%] h-[13%] w-[18%] rounded-full border border-slate-700/70" />
              <div className="absolute right-[29%] top-[35%] h-[13%] w-[18%] rounded-full border border-slate-700/70" />
              <div className="absolute left-[47%] top-[40%] h-[2%] w-[6%] bg-slate-700/70" />
            </>
          ) : null}
          {preset.accessory === 'headset' ? (
            <>
              <div className="absolute left-[25%] top-[18%] h-[22%] w-[50%] rounded-t-full border-[2px] border-b-0 border-slate-700/65" />
              <div className="absolute left-[19%] top-[34%] h-[16%] w-[8%] rounded-full bg-slate-700/75" />
              <div className="absolute right-[19%] top-[34%] h-[16%] w-[8%] rounded-full bg-slate-700/75" />
            </>
          ) : null}
          {preset.accessory === 'visor' ? (
            <div className="absolute left-[28%] top-[34%] h-[14%] w-[44%] rounded-full bg-white/38 ring-1 ring-black/10" />
          ) : null}
          {preset.accessory === 'badge' ? (
            <div className="absolute bottom-[16%] right-[18%] h-[12%] w-[12%] rounded-full bg-white/80 ring-1 ring-emerald-700/20" />
          ) : null}
          {preset.accessory === 'spark' ? (
            <>
              <div className="absolute right-[16%] top-[18%] h-[12%] w-[4%] rounded-full bg-white/90" />
              <div className="absolute right-[12%] top-[22%] h-[4%] w-[12%] rounded-full bg-white/90" />
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
