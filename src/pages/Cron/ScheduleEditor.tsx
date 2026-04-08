import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import {
  buildScheduleFromEditor,
  createDefaultScheduleEditorState,
  inferScheduleEditorState,
  type FixedScheduleSubtype,
  type ScheduleEditorMode,
  type ScheduleEditorState,
} from './schedule-helpers';

interface ScheduleEditorProps {
  value: ScheduleEditorState;
  onChange: (value: ScheduleEditorState) => void;
}

type EveryUnit = 'minutes' | 'hours' | 'days';
type RememberedScheduleStates = {
  every?: Extract<ScheduleEditorState, { mode: 'every' }>;
  fixed?: Extract<ScheduleEditorState, { mode: 'fixed' }>;
  cron?: Extract<ScheduleEditorState, { mode: 'cron' }>;
};

const everyUnits: EveryUnit[] = ['minutes', 'hours', 'days'];
const weekdays = [0, 1, 2, 3, 4, 5, 6] as const;
const fixedSubtypes: FixedScheduleSubtype[] = ['once', 'daily', 'weekly', 'monthly'];

export function ScheduleEditor({ value, onChange }: ScheduleEditorProps) {
  const { t } = useTranslation('cron');
  const rememberedStatesRef = useRef<RememberedScheduleStates>({});
  const everyValue = getEveryValue(value);
  const everyUnit = getEveryUnit(value);

  useEffect(() => {
    if (value.mode === 'every') {
      rememberedStatesRef.current.every = value;
      return;
    }
    if (value.mode === 'fixed') {
      rememberedStatesRef.current.fixed = value;
      return;
    }
    rememberedStatesRef.current.cron = value;
  }, [value]);

  return (
    <div className="modal-section-surface space-y-4 rounded-2xl border p-4 shadow-sm">
      <div className="grid grid-cols-3 gap-2">
        {(['every', 'fixed', 'cron'] as ScheduleEditorMode[]).map((mode) => (
          <Button
            key={mode}
            type="button"
            variant={value.mode === mode ? 'default' : 'outline'}
            size="sm"
            onClick={() => onChange(switchMode(value, mode, rememberedStatesRef.current))}
            className={cn(
              'justify-start h-10 rounded-xl font-medium text-[13px] transition-all',
              value.mode === mode
                ? 'border-transparent bg-primary text-primary-foreground shadow-sm hover:bg-primary/90'
                : 'modal-field-surface surface-hover text-foreground/80',
            )}
          >
            {t(`dialog.scheduleMode${capitalize(mode)}`)}
          </Button>
        ))}
      </div>

      {value.mode === 'every' && (
        <div className="grid grid-cols-[minmax(0,1fr)_180px] gap-3">
          <div className="space-y-2">
            <Label htmlFor="cron-schedule-every-value" className="text-[13px] text-foreground/70">
              {t('dialog.scheduleEveryValue')}
            </Label>
            <Input
              id="cron-schedule-every-value"
              type="number"
              min="0.000001"
              step="any"
              value={everyValue}
              onChange={(event) => {
                const nextValue = clampPositiveNumber(event.target.value);
                onChange({
                  mode: 'every',
                  everyMs: toEveryMs(nextValue, everyUnit),
                  anchorMs: value.anchorMs,
                });
              }}
              className="modal-field-surface field-focus-ring h-[44px] rounded-xl text-[13px] shadow-sm transition-all"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cron-schedule-every-unit" className="text-[13px] text-foreground/70">
              {t('dialog.scheduleEveryUnit')}
            </Label>
            <select
              id="cron-schedule-every-unit"
              value={everyUnit}
              onChange={(event) => {
                const nextUnit = event.target.value as EveryUnit;
                onChange({
                  mode: 'every',
                  everyMs: toEveryMs(everyValue, nextUnit),
                  anchorMs: value.anchorMs,
                });
              }}
              className="modal-field-surface field-focus-ring w-full h-[44px] rounded-xl border border-input bg-transparent px-3 text-[13px] text-foreground shadow-sm transition-all focus:outline-none"
            >
              {everyUnits.map((unit) => (
                <option key={unit} value={unit}>
                  {t(`dialog.scheduleEveryUnit${capitalize(unit)}`)}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {value.mode === 'fixed' && (
        <div className="space-y-4">
          <div className="grid grid-cols-4 gap-2">
            {fixedSubtypes.map((subtype) => (
              <Button
                key={subtype}
                type="button"
                variant={value.subtype === subtype ? 'default' : 'outline'}
                size="sm"
                onClick={() => onChange(switchFixedSubtype(value, subtype))}
                className={cn(
                  'justify-start h-10 rounded-xl font-medium text-[13px] transition-all',
                  value.subtype === subtype
                    ? 'border-transparent bg-primary text-primary-foreground shadow-sm hover:bg-primary/90'
                    : 'modal-field-surface surface-hover text-foreground/80',
                )}
              >
                {t(`dialog.scheduleFixed${capitalize(subtype)}`)}
              </Button>
            ))}
          </div>

          {value.subtype === 'once' ? (
            <div className="space-y-2">
              <Label htmlFor="cron-schedule-once-at" className="text-[13px] text-foreground/70">
                {t('dialog.scheduleDateTime')}
              </Label>
              <Input
                id="cron-schedule-once-at"
                type="datetime-local"
                value={toDateTimeLocal(value.at)}
                onChange={(event) => {
                  onChange({
                    mode: 'fixed',
                    subtype: 'once',
                    at: fromDateTimeLocal(event.target.value),
                  });
                }}
                className="modal-field-surface field-focus-ring h-[44px] rounded-xl text-[13px] shadow-sm transition-all"
              />
            </div>
          ) : (
            <>
              {value.subtype === 'weekly' && (
                <div className="space-y-2">
                  <Label htmlFor="cron-schedule-weekday" className="text-[13px] text-foreground/70">
                    {t('dialog.scheduleWeekday')}
                  </Label>
                  <select
                    id="cron-schedule-weekday"
                    value={value.dayOfWeek}
                    onChange={(event) => {
                      onChange({
                        ...value,
                        dayOfWeek: Number(event.target.value),
                      });
                    }}
                    className="modal-field-surface field-focus-ring w-full h-[44px] rounded-xl border border-input bg-transparent px-3 text-[13px] text-foreground shadow-sm transition-all focus:outline-none"
                  >
                    {weekdays.map((weekday) => (
                      <option key={weekday} value={weekday}>
                        {t(`dialog.scheduleWeekday${weekday}`)}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {value.subtype === 'monthly' && (
                <div className="space-y-2">
                  <Label htmlFor="cron-schedule-day-of-month" className="text-[13px] text-foreground/70">
                    {t('dialog.scheduleMonthDay')}
                  </Label>
                  <Input
                    id="cron-schedule-day-of-month"
                    type="number"
                    min={1}
                    max={31}
                    step={1}
                    value={value.dayOfMonth}
                    onChange={(event) => {
                      onChange({
                        ...value,
                        dayOfMonth: clampDayOfMonth(event.target.value),
                      });
                    }}
                    className="modal-field-surface field-focus-ring h-[44px] rounded-xl text-[13px] shadow-sm transition-all"
                  />
                  <p className="text-[12px] text-muted-foreground">{t('dialog.scheduleMonthDayHint')}</p>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="cron-schedule-time" className="text-[13px] text-foreground/70">
                  {t('dialog.scheduleTime')}
                </Label>
                <Input
                  id="cron-schedule-time"
                  type="time"
                  value={formatTimeValue(value.hour, value.minute)}
                  onChange={(event) => {
                    const nextTime = parseTimeValue(event.target.value);
                    onChange({
                      ...value,
                      hour: nextTime.hour,
                      minute: nextTime.minute,
                    });
                  }}
                  className="modal-field-surface field-focus-ring h-[44px] rounded-xl text-[13px] shadow-sm transition-all"
                />
              </div>
            </>
          )}
        </div>
      )}

      {value.mode === 'cron' && (
        <div className="space-y-2">
          <Label htmlFor="cron-schedule-expr" className="text-[13px] text-foreground/70">
            {t('dialog.scheduleModeCron')}
          </Label>
          <Input
            id="cron-schedule-expr"
            placeholder={t('dialog.cronPlaceholder')}
            value={value.expr}
            onChange={(event) => onChange({
              mode: 'cron',
              expr: event.target.value,
              tz: value.tz,
            })}
            className="modal-field-surface field-focus-ring h-[44px] rounded-xl font-mono text-[13px] shadow-sm transition-all text-foreground placeholder:text-foreground/40"
          />
        </div>
      )}
    </div>
  );
}

function switchMode(
  current: ScheduleEditorState,
  mode: ScheduleEditorMode,
  rememberedStates: RememberedScheduleStates,
): ScheduleEditorState {
  if (current.mode === mode) {
    return current;
  }

  if (mode === 'every') {
    const remembered = rememberedStates.every;
    if (remembered) {
      return remembered;
    }
    return { mode: 'every', everyMs: 60 * 60 * 1000 };
  }

  if (mode === 'cron') {
    const remembered = rememberedStates.cron;
    if (remembered) {
      return remembered;
    }
    if (current.mode === 'fixed' && current.subtype !== 'once') {
      const nextSchedule = buildScheduleFromEditor(current);
      if (nextSchedule.kind === 'cron') {
        return nextSchedule.tz === undefined
          ? { mode: 'cron', expr: nextSchedule.expr }
          : { mode: 'cron', expr: nextSchedule.expr, tz: nextSchedule.tz };
      }
    }
    return { mode: 'cron', expr: '' };
  }

  if (current.mode === 'cron') {
    const inferred = inferScheduleEditorState(
      current.tz === undefined ? current.expr : { kind: 'cron', expr: current.expr, tz: current.tz },
    );
    if (inferred.mode === 'fixed') {
      return inferred;
    }
  }

  const remembered = rememberedStates.fixed;
  if (remembered) {
    return remembered;
  }

  return createDefaultScheduleEditorState();
}

function switchFixedSubtype(current: Extract<ScheduleEditorState, { mode: 'fixed' }>, subtype: FixedScheduleSubtype): ScheduleEditorState {
  if (current.subtype === subtype) {
    return current;
  }

  const recurringTz = current.subtype === 'once' ? undefined : current.tz;

  if (subtype === 'once') {
    if (current.subtype === 'once') {
      return current;
    }

    return {
      mode: 'fixed',
      subtype: 'once',
      at: defaultOnceAt(current.hour, current.minute),
    };
  }

  const base = current.subtype === 'once'
    ? extractFixedBaseFromOnce(current.at)
    : { hour: current.hour, minute: current.minute };

  if (subtype === 'daily') {
    return {
      mode: 'fixed',
      subtype: 'daily',
      hour: base.hour,
      minute: base.minute,
      tz: recurringTz,
    };
  }

  if (subtype === 'weekly') {
    return {
      mode: 'fixed',
      subtype: 'weekly',
      hour: base.hour,
      minute: base.minute,
      dayOfWeek: 1,
      tz: recurringTz,
    };
  }

  return {
    mode: 'fixed',
    subtype: 'monthly',
    hour: base.hour,
    minute: base.minute,
    dayOfMonth: 1,
    tz: recurringTz,
  };
}

function getEveryValue(value: ScheduleEditorState): number {
  if (value.mode !== 'every') {
    return 1;
  }

  if (value.everyMs % (24 * 60 * 60 * 1000) === 0) {
    return normalizeDecimal(value.everyMs / (24 * 60 * 60 * 1000));
  }

  if (value.everyMs % (60 * 60 * 1000) === 0) {
    return normalizeDecimal(value.everyMs / (60 * 60 * 1000));
  }

  return normalizeDecimal(value.everyMs / (60 * 1000));
}

function getEveryUnit(value: ScheduleEditorState): EveryUnit {
  if (value.mode !== 'every') {
    return 'hours';
  }

  if (value.everyMs % (24 * 60 * 60 * 1000) === 0) {
    return 'days';
  }

  if (value.everyMs % (60 * 60 * 1000) === 0) {
    return 'hours';
  }

  return 'minutes';
}

function toEveryMs(value: number, unit: EveryUnit): number {
  if (unit === 'days') {
    return Math.round(value * 24 * 60 * 60 * 1000);
  }

  if (unit === 'hours') {
    return Math.round(value * 60 * 60 * 1000);
  }

  return Math.round(value * 60 * 1000);
}

function clampPositiveNumber(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function clampDayOfMonth(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return 1;
  }
  return Math.min(31, Math.max(1, parsed));
}

function formatTimeValue(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function parseTimeValue(value: string): { hour: number; minute: number } {
  const [hourText = '0', minuteText = '0'] = value.split(':');
  return {
    hour: clampBetween(Number.parseInt(hourText, 10), 0, 23),
    minute: clampBetween(Number.parseInt(minuteText, 10), 0, 59),
  };
}

function defaultOnceAt(hour: number, minute: number): string {
  const now = new Date();
  now.setSeconds(0, 0);
  now.setHours(hour, minute, 0, 0);
  if (now.getTime() <= Date.now()) {
    now.setDate(now.getDate() + 1);
  }
  return now.toISOString();
}

function extractFixedBaseFromOnce(value: string): { hour: number; minute: number } {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    const fallback = createDefaultScheduleEditorState();
    if (fallback.mode !== 'fixed' || fallback.subtype === 'once') {
      return { hour: 9, minute: 0 };
    }
    return { hour: fallback.hour, minute: fallback.minute };
  }

  return { hour: parsed.getHours(), minute: parsed.getMinutes() };
}

function toDateTimeLocal(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }

  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  const hours = String(parsed.getHours()).padStart(2, '0');
  const minutes = String(parsed.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function fromDateTimeLocal(value: string): string {
  if (!value) {
    return '';
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

function clampBetween(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

function normalizeDecimal(value: number): number {
  return Number.parseFloat(value.toFixed(6));
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
