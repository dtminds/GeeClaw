import { describe, expect, it } from 'vitest';
import {
  buildScheduleFromEditor,
  createDefaultScheduleEditorState,
  inferScheduleEditorState,
  previewLabelForSchedule,
  type SchedulePreviewFormatters,
  type ScheduleEditorState,
} from '@/pages/Cron/schedule-helpers';

describe('cron schedule helpers', () => {
  it('creates the default editor state', () => {
    expect(createDefaultScheduleEditorState()).toEqual({
      mode: 'fixed',
      subtype: 'daily',
      hour: 9,
      minute: 0,
    });
  });

  it('builds Gateway cron schedules from editor state', () => {
    const everyState: ScheduleEditorState = { mode: 'every', everyMs: 15 * 60_000, anchorMs: 123_456 };
    const onceState: ScheduleEditorState = {
      mode: 'fixed',
      subtype: 'once',
      at: '2026-04-08T10:11:12.000Z',
    };
    const dailyState: ScheduleEditorState = {
      mode: 'fixed',
      subtype: 'daily',
      hour: 8,
      minute: 15,
    };
    const weeklyState: ScheduleEditorState = {
      mode: 'fixed',
      subtype: 'weekly',
      hour: 6,
      minute: 45,
      dayOfWeek: 1,
    };
    const monthlyState: ScheduleEditorState = {
      mode: 'fixed',
      subtype: 'monthly',
      hour: 7,
      minute: 30,
      dayOfMonth: 12,
    };
    const cronState: ScheduleEditorState = {
      mode: 'cron',
      expr: '15 8 * * *',
      tz: 'Asia/Shanghai',
    };

    expect(buildScheduleFromEditor(everyState)).toEqual({
      kind: 'every',
      everyMs: 15 * 60_000,
      anchorMs: 123_456,
    });
    expect(buildScheduleFromEditor(onceState)).toEqual({
      kind: 'at',
      at: '2026-04-08T10:11:12.000Z',
    });
    expect(buildScheduleFromEditor(dailyState)).toEqual({
      kind: 'cron',
      expr: '15 8 * * *',
    });
    expect(buildScheduleFromEditor(weeklyState)).toEqual({
      kind: 'cron',
      expr: '45 6 * * 1',
    });
    expect(buildScheduleFromEditor(monthlyState)).toEqual({
      kind: 'cron',
      expr: '30 7 12 * *',
    });
    expect(buildScheduleFromEditor(cronState)).toEqual({
      kind: 'cron',
      expr: '15 8 * * *',
      tz: 'Asia/Shanghai',
    });
  });

  it('infers supported editor state shapes conservatively', () => {
    expect(inferScheduleEditorState({ kind: 'every', everyMs: 30_000, anchorMs: 99_000 })).toEqual({
      mode: 'every',
      everyMs: 30_000,
      anchorMs: 99_000,
    });
    expect(inferScheduleEditorState({ kind: 'at', at: '2026-04-08T10:11:12.000Z' })).toEqual({
      mode: 'fixed',
      subtype: 'once',
      at: '2026-04-08T10:11:12.000Z',
    });
    expect(inferScheduleEditorState({ kind: 'cron', expr: '15 8 * * *', tz: 'Europe/Berlin' })).toEqual({
      mode: 'fixed',
      subtype: 'daily',
      minute: 15,
      hour: 8,
      tz: 'Europe/Berlin',
    });
    expect(inferScheduleEditorState({ kind: 'cron', expr: '45 6 * * 1', tz: 'Europe/Berlin' })).toEqual({
      mode: 'fixed',
      subtype: 'weekly',
      minute: 45,
      hour: 6,
      dayOfWeek: 1,
      tz: 'Europe/Berlin',
    });
    expect(inferScheduleEditorState({ kind: 'cron', expr: '30 7 12 * *', tz: 'Europe/Berlin' })).toEqual({
      mode: 'fixed',
      subtype: 'monthly',
      minute: 30,
      hour: 7,
      dayOfMonth: 12,
      tz: 'Europe/Berlin',
    });
    expect(inferScheduleEditorState('*/5 * * * *')).toEqual({
      mode: 'cron',
      expr: '*/5 * * * *',
    });
    expect(inferScheduleEditorState('99 99 * * *')).toEqual({
      mode: 'cron',
      expr: '99 99 * * *',
    });
    expect(inferScheduleEditorState('15 8 * * 9')).toEqual({
      mode: 'cron',
      expr: '15 8 * * 9',
    });
    expect(inferScheduleEditorState('15 8 99 * *')).toEqual({
      mode: 'cron',
      expr: '15 8 99 * *',
    });
  });

  it('uses injected formatters for preview labels and preserves metadata', () => {
    const formatters: SchedulePreviewFormatters = {
      every: (state) => `every:${state.everyMs}:${state.anchorMs ?? 'none'}`,
      fixed: (state) => state.subtype === 'once'
        ? `once:${state.at}`
        : state.subtype === 'daily'
          ? `daily:${state.hour}:${state.minute}`
          : state.subtype === 'weekly'
            ? `weekly:${state.hour}:${state.minute}:${state.dayOfWeek}`
            : `monthly:${state.hour}:${state.minute}:${state.dayOfMonth}`,
      cron: (state) => `cron:${state.expr}:${state.tz ?? 'none'}`,
    };

    expect(previewLabelForSchedule({ kind: 'every', everyMs: 90_000, anchorMs: 12_345 }, formatters)).toBe('every:90000:12345');
    expect(previewLabelForSchedule({ kind: 'at', at: '2026-04-08T10:11:12.000Z' }, formatters)).toBe('once:2026-04-08T10:11:12.000Z');
    expect(previewLabelForSchedule({ kind: 'cron', expr: '15 8 * * *', tz: 'Asia/Shanghai' }, formatters)).toBe('daily:8:15');
    expect(previewLabelForSchedule({ kind: 'cron', expr: '45 6 * * 1', tz: 'Europe/Berlin' }, formatters)).toBe('weekly:6:45:1');
    expect(previewLabelForSchedule({ kind: 'cron', expr: '30 7 12 * *', tz: 'UTC' }, formatters)).toBe('monthly:7:30:12');
    expect(previewLabelForSchedule('99 99 * * *', formatters)).toBe('cron:99 99 * * *:none');
  });
});
