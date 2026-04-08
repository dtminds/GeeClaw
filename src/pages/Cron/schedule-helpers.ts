import type { CronSchedule } from '@/types/cron';

export type ScheduleEditorMode = 'every' | 'fixed' | 'cron';
export type FixedScheduleSubtype = 'once' | 'daily' | 'weekly' | 'monthly';

type FixedScheduleBase = {
  mode: 'fixed';
  minute: number;
  hour: number;
};

export type ScheduleEditorState =
  | { mode: 'every'; everyMs: number }
  | ({ mode: 'fixed'; subtype: 'once'; at: string })
  | (FixedScheduleBase & { subtype: 'daily' })
  | (FixedScheduleBase & { subtype: 'weekly'; dayOfWeek: number })
  | (FixedScheduleBase & { subtype: 'monthly'; dayOfMonth: number })
  | { mode: 'cron'; expr: string };

const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

export function createDefaultScheduleEditorState(): ScheduleEditorState {
  return {
    mode: 'fixed',
    subtype: 'daily',
    hour: 9,
    minute: 0,
  };
}

export function buildScheduleFromEditor(state: ScheduleEditorState): CronSchedule {
  if (state.mode === 'every') {
    return { kind: 'every', everyMs: state.everyMs };
  }

  if (state.mode === 'cron') {
    return { kind: 'cron', expr: state.expr };
  }

  if (state.subtype === 'once') {
    return { kind: 'at', at: state.at };
  }

  const expr = `${normalizeCronPart(state.minute)} ${normalizeCronPart(state.hour)}${
    state.subtype === 'monthly' ? ` ${normalizeCronPart(state.dayOfMonth)} * *`
      : state.subtype === 'weekly'
        ? ` * * ${normalizeCronPart(state.dayOfWeek)}`
        : ' * * *'
  }`;

  return { kind: 'cron', expr };
}

export function inferScheduleEditorState(schedule: CronSchedule | string): ScheduleEditorState {
  if (typeof schedule === 'string') {
    return inferFromCronExpr(schedule) ?? { mode: 'cron', expr: schedule };
  }

  if (schedule.kind === 'every') {
    return { mode: 'every', everyMs: schedule.everyMs };
  }

  if (schedule.kind === 'at') {
    return { mode: 'fixed', subtype: 'once', at: schedule.at };
  }

  return inferFromCronExpr(schedule.expr) ?? { mode: 'cron', expr: schedule.expr };
}

export function previewLabelForSchedule(schedule: CronSchedule | string): string | null {
  const inferred = inferScheduleEditorState(schedule);

  if (inferred.mode === 'every') {
    return formatEveryLabel(inferred.everyMs);
  }

  if (inferred.mode === 'fixed') {
    if (inferred.subtype === 'once') {
      return `Once at ${formatDateTimeLabel(inferred.at)}`;
    }

    const timeLabel = formatTimeLabel(inferred.hour, inferred.minute);
    if (inferred.subtype === 'daily') {
      return `Daily at ${timeLabel}`;
    }
    if (inferred.subtype === 'weekly') {
      return `Weekly at ${timeLabel} on ${dayName(inferred.dayOfWeek)}`;
    }
    return `Monthly at ${timeLabel} on day ${inferred.dayOfMonth}`;
  }

  return null;
}

function inferFromCronExpr(expr: string): ScheduleEditorState | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    return null;
  }

  const [minutePart, hourPart, dayOfMonthPart, monthPart, dayOfWeekPart] = parts;

  if (isNumberToken(minutePart) && isNumberToken(hourPart) && monthPart === '*' && dayOfMonthPart === '*' && dayOfWeekPart === '*') {
    return {
      mode: 'fixed',
      subtype: 'daily',
      minute: toNumber(minutePart),
      hour: toNumber(hourPart),
    };
  }

  if (isNumberToken(minutePart) && isNumberToken(hourPart) && dayOfMonthPart === '*' && monthPart === '*' && isNumberToken(dayOfWeekPart)) {
    return {
      mode: 'fixed',
      subtype: 'weekly',
      minute: toNumber(minutePart),
      hour: toNumber(hourPart),
      dayOfWeek: toNumber(dayOfWeekPart),
    };
  }

  if (isNumberToken(minutePart) && isNumberToken(hourPart) && isNumberToken(dayOfMonthPart) && monthPart === '*' && dayOfWeekPart === '*') {
    return {
      mode: 'fixed',
      subtype: 'monthly',
      minute: toNumber(minutePart),
      hour: toNumber(hourPart),
      dayOfMonth: toNumber(dayOfMonthPart),
    };
  }

  return null;
}

function normalizeCronPart(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.trunc(value);
}

function isNumberToken(value: string): boolean {
  return /^\d+$/.test(value);
}

function toNumber(value: string): number {
  return Number.parseInt(value, 10);
}

function formatEveryLabel(everyMs: number): string {
  if (!Number.isFinite(everyMs) || everyMs <= 0) {
    return 'Every interval';
  }

  const units: Array<[number, string, string]> = [
    [86_400_000, 'day', 'days'],
    [3_600_000, 'hour', 'hours'],
    [60_000, 'minute', 'minutes'],
    [1_000, 'second', 'seconds'],
  ];

  for (const [unitMs, singular, plural] of units) {
    if (everyMs >= unitMs) {
      const count = roundToSingleDecimal(everyMs / unitMs);
      return `Every ${formatNumber(count)} ${count === 1 ? singular : plural}`;
    }
  }

  return `Every ${everyMs} ms`;
}

function formatDateTimeLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }

  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function formatTimeLabel(hour: number, minute: number): string {
  const normalizedHour = ((Math.trunc(hour) % 24) + 24) % 24;
  const normalizedMinute = ((Math.trunc(minute) % 60) + 60) % 60;
  return `${String(normalizedHour).padStart(2, '0')}:${String(normalizedMinute).padStart(2, '0')}`;
}

function dayName(dayOfWeek: number): string {
  const normalized = ((Math.trunc(dayOfWeek) % 7) + 7) % 7;
  return DAY_NAMES[normalized];
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, '');
}

function roundToSingleDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}
