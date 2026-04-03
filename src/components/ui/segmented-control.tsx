import { cn } from '@/lib/utils';

type SegmentedControlOption<T extends string> = {
  value: T;
  label: string;
  disabled?: boolean;
};

interface SegmentedControlProps<T extends string> {
  value: T;
  onValueChange: (value: T) => void;
  options: Array<SegmentedControlOption<T>>;
  ariaLabel: string;
  className?: string;
  fullWidth?: boolean;
}

export function SegmentedControl<T extends string>({
  value,
  onValueChange,
  options,
  ariaLabel,
  className,
  fullWidth = false,
}: SegmentedControlProps<T>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        'inline-flex items-center rounded-full border border-border/60 bg-muted/40 p-1 gap-0.5',
        fullWidth ? 'w-full' : 'w-fit',
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value;

        return (
          <button
            key={option.value}
            type="button"
            disabled={option.disabled}
            aria-pressed={active}
            data-state={active ? 'active' : 'inactive'}
            onClick={() => onValueChange(option.value)}
            className={cn(
              'rounded-full px-4 py-1.5 text-[13px] font-medium transition-all',
              fullWidth && 'flex-1',
              active
                ? 'bg-foreground text-background shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
              option.disabled && 'cursor-not-allowed opacity-50',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
