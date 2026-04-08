import type { CronSchedule } from '@/types/cron';

export type ScheduleEditorMode = 'every' | 'fixed' | 'cron';
export type FixedScheduleSubtype = 'once' | 'daily' | 'weekly' | 'monthly';

type FixedScheduleBase = {
  mode: 'fixed';
  minute: number;
  hour: number;
  tz?: string;
};

export type ScheduleEditorState =
  | { mode: 'every'; everyMs: number; anchorMs?: number }
  | ({ mode: 'fixed'; subtype: 'once'; at: string })
  | (FixedScheduleBase & { subtype: 'daily' })
  | (FixedScheduleBase & { subtype: 'weekly'; dayOfWeek: number })
  | (FixedScheduleBase & { subtype: 'monthly'; dayOfMonth: number })
  | { mode: 'cron'; expr: string; tz?: string };

export interface SchedulePreviewFormatters {
  every: (state: Extract<ScheduleEditorState, { mode: 'every' }>) => string | null;
  fixed: (state: Extract<ScheduleEditorState, { mode: 'fixed' }>) => string | null;
  cron: (state: Extract<ScheduleEditorState, { mode: 'cron' }>) => string | null;
}

type RecognizedCronFixedEditorState =
  | (FixedScheduleBase & { subtype: 'daily' })
  | (FixedScheduleBase & { subtype: 'weekly'; dayOfWeek: number })
  | (FixedScheduleBase & { subtype: 'monthly'; dayOfMonth: number });

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
    return state.anchorMs === undefined
      ? { kind: 'every', everyMs: state.everyMs }
      : { kind: 'every', everyMs: state.everyMs, anchorMs: state.anchorMs };
  }

  if (state.mode === 'cron') {
    return state.tz === undefined
      ? { kind: 'cron', expr: state.expr }
      : { kind: 'cron', expr: state.expr, tz: state.tz };
  }

  if (state.subtype === 'once') {
    return { kind: 'at', at: state.at };
  }

  const expr = `${state.minute} ${state.hour}${
    state.subtype === 'monthly' ? ` ${state.dayOfMonth} * *`
      : state.subtype === 'weekly'
        ? ` * * ${state.dayOfWeek}`
        : ' * * *'
  }`;

  return state.tz === undefined
    ? { kind: 'cron', expr }
    : { kind: 'cron', expr, tz: state.tz };
}

export function inferScheduleEditorState(schedule: CronSchedule | string): ScheduleEditorState {
  if (typeof schedule === 'string') {
    return inferFromCronExpr(schedule) ?? { mode: 'cron', expr: schedule };
  }

  if (schedule.kind === 'every') {
    return schedule.anchorMs === undefined
      ? { mode: 'every', everyMs: schedule.everyMs }
      : { mode: 'every', everyMs: schedule.everyMs, anchorMs: schedule.anchorMs };
  }

  if (schedule.kind === 'at') {
    return { mode: 'fixed', subtype: 'once', at: schedule.at };
  }

  const inferred = inferFromCronExpr(schedule.expr);
  if (inferred) {
    if (inferred.mode === 'fixed' && schedule.tz !== undefined) {
      return { ...inferred, tz: schedule.tz };
    }
    return inferred;
  }

  return schedule.tz === undefined
    ? { mode: 'cron', expr: schedule.expr }
    : { mode: 'cron', expr: schedule.expr, tz: schedule.tz };
}

export function previewLabelForSchedule(
  schedule: CronSchedule | string,
  formatters: SchedulePreviewFormatters,
): string | null {
  const inferred = inferScheduleEditorState(schedule);

  if (inferred.mode === 'every') {
    return formatters.every(inferred);
  }

  if (inferred.mode === 'fixed') {
    return formatters.fixed(inferred);
  }

  return formatters.cron(inferred);
}

function inferFromCronExpr(expr: string): RecognizedCronFixedEditorState | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    return null;
  }

  const [minutePart, hourPart, dayOfMonthPart, monthPart, dayOfWeekPart] = parts;

  if (
    isValidMinute(minutePart)
    && isValidHour(hourPart)
    && monthPart === '*'
    && dayOfMonthPart === '*'
    && dayOfWeekPart === '*'
  ) {
    return {
      mode: 'fixed',
      subtype: 'daily',
      minute: toNumber(minutePart),
      hour: toNumber(hourPart),
    };
  }

  if (
    isValidMinute(minutePart)
    && isValidHour(hourPart)
    && dayOfMonthPart === '*'
    && monthPart === '*'
    && isValidDayOfWeek(dayOfWeekPart)
  ) {
    return {
      mode: 'fixed',
      subtype: 'weekly',
      minute: toNumber(minutePart),
      hour: toNumber(hourPart),
      dayOfWeek: toNumber(dayOfWeekPart),
    };
  }

  if (
    isValidMinute(minutePart)
    && isValidHour(hourPart)
    && isValidDayOfMonth(dayOfMonthPart)
    && monthPart === '*'
    && dayOfWeekPart === '*'
  ) {
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

function isNumberToken(value: string): boolean {
  return /^\d+$/.test(value);
}

function isValidMinute(value: string): boolean {
  return isNumberToken(value) && inRange(toNumber(value), 0, 59);
}

function isValidHour(value: string): boolean {
  return isNumberToken(value) && inRange(toNumber(value), 0, 23);
}

function isValidDayOfWeek(value: string): boolean {
  return isNumberToken(value) && inRange(toNumber(value), 0, 7);
}

function isValidDayOfMonth(value: string): boolean {
  return isNumberToken(value) && inRange(toNumber(value), 1, 31);
}

function toNumber(value: string): number {
  return Number.parseInt(value, 10);
}

function inRange(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}
