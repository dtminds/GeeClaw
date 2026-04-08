import { describe, expect, it } from 'vitest';
import {
  buildScheduleFromEditor,
  createDefaultScheduleEditorState,
  inferScheduleEditorState,
  previewLabelForSchedule,
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
    const everyState: ScheduleEditorState = { mode: 'every', everyMs: 15 * 60_000 };
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

    expect(buildScheduleFromEditor(everyState)).toEqual({
      kind: 'every',
      everyMs: 15 * 60_000,
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
  });

  it('infers supported editor state shapes conservatively', () => {
    expect(inferScheduleEditorState({ kind: 'every', everyMs: 30_000 })).toEqual({
      mode: 'every',
      everyMs: 30_000,
    });
    expect(inferScheduleEditorState({ kind: 'at', at: '2026-04-08T10:11:12.000Z' })).toEqual({
      mode: 'fixed',
      subtype: 'once',
      at: '2026-04-08T10:11:12.000Z',
    });
    expect(inferScheduleEditorState({ kind: 'cron', expr: '15 8 * * *' })).toEqual({
      mode: 'fixed',
      subtype: 'daily',
      minute: 15,
      hour: 8,
    });
    expect(inferScheduleEditorState({ kind: 'cron', expr: '45 6 * * 1' })).toEqual({
      mode: 'fixed',
      subtype: 'weekly',
      minute: 45,
      hour: 6,
      dayOfWeek: 1,
    });
    expect(inferScheduleEditorState({ kind: 'cron', expr: '30 7 12 * *' })).toEqual({
      mode: 'fixed',
      subtype: 'monthly',
      minute: 30,
      hour: 7,
      dayOfMonth: 12,
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

  it('returns preview labels for supported schedules', () => {
    expect(previewLabelForSchedule({ kind: 'every', everyMs: 90_000 })).toBe('Every 1.5 minutes');
    expect(previewLabelForSchedule({ kind: 'at', at: '2026-04-08T10:11:12.000Z' })).toMatch(/^Once at /);
    expect(previewLabelForSchedule({ kind: 'cron', expr: '15 8 * * *' })).toBe('Daily at 08:15');
    expect(previewLabelForSchedule({ kind: 'cron', expr: '45 6 * * 1' })).toBe('Weekly at 06:45 on Monday');
    expect(previewLabelForSchedule({ kind: 'cron', expr: '30 7 12 * *' })).toBe('Monthly at 07:30 on day 12');
    expect(previewLabelForSchedule('99 99 * * *')).toBe('99 99 * * *');
  });
});
