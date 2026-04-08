import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Cron } from '@/pages/Cron';
import type { CronJob } from '@/types/cron';

const createJobMock = vi.fn();
const updateJobMock = vi.fn();
const fetchJobsMock = vi.fn();
const toggleJobMock = vi.fn();
const deleteJobMock = vi.fn();
const triggerJobMock = vi.fn();
const fetchChannelsMock = vi.fn();
const fetchAgentsMock = vi.fn();
const hostApiFetchMock = vi.fn();
const channelsStoreState = {
  channels: [] as Array<{
    type: string;
    name?: string;
    accounts?: Array<{
      accountId: string;
      enabled: boolean;
      isDefault?: boolean;
      name?: string;
    }>;
  }>,
};
const agentsStoreState = {
  agents: [] as Array<{ id: string; name?: string }>,
  defaultAgentId: '',
};
const cronStoreState = {
  jobs: [] as CronJob[],
  loading: false,
  error: null as string | null,
  fetchJobs: fetchJobsMock,
  createJob: createJobMock,
  updateJob: updateJobMock,
  toggleJob: toggleJobMock,
  deleteJob: deleteJobMock,
  triggerJob: triggerJobMock,
};

const translations: Record<string, string> = {
  title: 'Scheduled Tasks',
  subtitle: 'Automate AI workflows with scheduled tasks',
  newTask: 'New Task',
  refresh: 'Refresh',
  'card.edit': 'Edit',
  'empty.title': 'No scheduled tasks',
  'empty.description': 'Create scheduled tasks to automate AI workflows.',
  'empty.create': 'Create Your First Task',
  'dialog.createTitle': 'Create Task',
  'dialog.description': 'Schedule an automated AI task',
  'dialog.taskName': 'Task Name',
  'dialog.taskNamePlaceholder': 'e.g., Morning briefing',
  'dialog.agent': 'Agent',
  'dialog.agentDefault': 'Default agent',
  'dialog.message': 'Message / Prompt',
  'dialog.messagePlaceholder': 'What should the AI do?',
  'dialog.schedule': 'Schedule',
  'dialog.enableImmediately': 'Enable immediately',
  'dialog.enableImmediatelyDesc': 'Start running this task after creation',
  'dialog.deliveryMode': 'Result Delivery',
  'dialog.deliveryMode_none': 'No delivery',
  'dialog.deliveryMode_announce': 'Send to channel',
  'dialog.deliveryChannelPlaceholder': 'Select a channel',
  'dialog.deliveryTo': 'Recipient / Chat ID',
  'dialog.deliveryToPlaceholder': 'e.g., user ID, group ID (optional)',
  'dialog.scheduleModeEvery': 'Every',
  'dialog.scheduleModeFixed': 'Fixed Time',
  'dialog.scheduleModeCron': 'Cron',
  'dialog.scheduleModeLabel': 'Schedule mode',
  'dialog.scheduleFixedOnce': 'Once',
  'dialog.scheduleFixedDaily': 'Daily',
  'dialog.scheduleFixedWeekly': 'Weekly',
  'dialog.scheduleFixedMonthly': 'Monthly',
  'dialog.scheduleWeekday': 'Weekday',
  'dialog.scheduleMonthDay': 'Day of month',
  'dialog.scheduleMonthDayHint': 'Months without this date are skipped.',
  'dialog.scheduleTime': 'Time',
  'dialog.scheduleEveryValue': 'Interval',
  'dialog.scheduleEveryUnit': 'Unit',
  'dialog.scheduleEveryUnitMinutes': 'Minutes',
  'dialog.scheduleEveryUnitHours': 'Hours',
  'dialog.scheduleEveryUnitDays': 'Days',
  'dialog.schedulePreviewUnavailable': 'Preview unavailable',
  'dialog.saveChanges': 'Save Changes',
  'card.next': 'Next',
  'dialog.scheduleWeekday0': 'Sunday',
  'dialog.scheduleWeekday1': 'Monday',
  'dialog.scheduleWeekday2': 'Tuesday',
  'dialog.scheduleWeekday3': 'Wednesday',
  'dialog.scheduleWeekday4': 'Thursday',
  'dialog.scheduleWeekday5': 'Friday',
  'dialog.scheduleWeekday6': 'Saturday',
  'schedule.everySeconds': 'Every {{count}} seconds',
  'schedule.everyMinutes': 'Every {{count}} minutes',
  'schedule.everyHours': 'Every {{count}} hours',
  'schedule.everyDays': 'Every {{count}} days',
  'schedule.onceAt': 'Once at {{time}}',
  'schedule.weeklyAt': 'Weekly on {{day}} at {{time}}',
  'schedule.monthlyAtDay': 'Monthly on day {{day}} at {{time}}',
  'schedule.dailyAt': 'Daily at {{time}}',
  'schedule.unknown': 'Unknown',
  'toast.created': 'Task created',
  'common:actions.cancel': 'Cancel',
  'common:status.saving': 'Saving...',
};

function translate(key: string, options?: Record<string, unknown> | string): string {
  const template = translations[key] ?? (typeof options === 'string' ? options : key);
  if (typeof options !== 'object' || options === null) {
    return template;
  }

  return template.replace(/\{\{(\w+)\}\}/g, (_, token: string) => String(options[token] ?? ''));
}

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, options?: Record<string, unknown> | string) => translate(key, options),
    }),
  };
});

vi.mock('@/stores/cron', () => ({
  useCronStore: () => cronStoreState,
}));

vi.mock('@/stores/gateway', () => ({
  useGatewayStore: (selector: (state: { status: { state: string } }) => unknown) => selector({
    status: { state: 'running' },
  }),
}));

vi.mock('@/stores/channels', () => ({
  useChannelsStore: () => ({
    channels: channelsStoreState.channels,
    fetchChannels: fetchChannelsMock,
  }),
}));

vi.mock('@/stores/agents', () => ({
  useAgentsStore: () => ({
    agents: agentsStoreState.agents,
    defaultAgentId: agentsStoreState.defaultAgentId,
    fetchAgents: fetchAgentsMock,
  }),
}));

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => hostApiFetchMock(...args),
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => vi.fn(),
  };
});

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('Cron schedule editor integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cronStoreState.jobs = [];
    cronStoreState.loading = false;
    cronStoreState.error = null;
    createJobMock.mockResolvedValue(undefined);
    updateJobMock.mockResolvedValue(undefined);
    fetchJobsMock.mockResolvedValue(undefined);
    fetchChannelsMock.mockResolvedValue(undefined);
    fetchAgentsMock.mockResolvedValue(undefined);
    toggleJobMock.mockResolvedValue(undefined);
    deleteJobMock.mockResolvedValue(undefined);
    triggerJobMock.mockResolvedValue(undefined);
    channelsStoreState.channels = [];
    agentsStoreState.agents = [];
    agentsStoreState.defaultAgentId = '';
    hostApiFetchMock.mockResolvedValue({ success: true, sessions: [] });
  });

  it('creates an interval schedule from the structured editor', async () => {
    render(<Cron />);

    fireEvent.click(screen.getByRole('button', { name: 'New Task' }));

    const scheduleModeGroup = screen.getByRole('group', { name: 'Schedule mode' });
    expect(scheduleModeGroup).toBeInTheDocument();
    expect(scheduleModeGroup.parentElement?.className).not.toContain('modal-section-surface');
    expect(scheduleModeGroup.parentElement?.className).not.toContain('border');

    fireEvent.change(screen.getByLabelText('Task Name'), {
      target: { value: 'Hourly digest' },
    });
    fireEvent.change(screen.getByLabelText('Message / Prompt'), {
      target: { value: 'Summarize the backlog' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Every' }));
    fireEvent.change(screen.getByLabelText('Interval'), {
      target: { value: '2' },
    });
    fireEvent.change(screen.getByLabelText('Unit'), {
      target: { value: 'hours' },
    });

    expect(screen.getByText(/^Next:/)).toBeInTheDocument();
    expect(screen.queryByText('Next: Preview unavailable')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Create Task' }));

    await waitFor(() => {
      expect(createJobMock).toHaveBeenCalledWith({
        name: 'Hourly digest',
        message: 'Summarize the backlog',
        schedule: {
          kind: 'every',
          everyMs: 2 * 60 * 60 * 1000,
        },
        enabled: true,
        delivery: { mode: 'none' },
        agentId: undefined,
      });
    });
  });

  it('keeps weekly and monthly fixed controls on a single row', () => {
    render(<Cron />);

    fireEvent.click(screen.getByRole('button', { name: 'New Task' }));

    fireEvent.click(screen.getByRole('button', { name: 'Weekly' }));

    const weeklyRow = screen.getByTestId('cron-schedule-fixed-row');
    expect(weeklyRow.className).toContain('grid-cols-2');
    const weeklySelect = within(weeklyRow).getByLabelText('Weekday');
    expect(weeklySelect).toBeInTheDocument();
    expect(weeklySelect.className).toContain('appearance-none');
    expect(weeklySelect.className).toContain('pr-10');
    expect(within(weeklyRow).getByLabelText('Time')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Monthly' }));

    const monthlyRow = screen.getByTestId('cron-schedule-fixed-row');
    expect(monthlyRow.className).toContain('grid-cols-2');
    expect(within(monthlyRow).getByLabelText('Day of month')).toBeInTheDocument();
    expect(within(monthlyRow).getByLabelText('Time')).toBeInTheDocument();
  });

  it('moves the monthly skip hint into the next-run line', () => {
    render(<Cron />);

    fireEvent.click(screen.getByRole('button', { name: 'New Task' }));
    fireEvent.click(screen.getByRole('button', { name: 'Monthly' }));

    expect(screen.getByText((content, node) => (
      node?.tagName === 'P'
      && content.includes('Next:')
      && content.includes('Months without this date are skipped.')
    ))).toBeInTheDocument();
  });

  it('constrains recipient suggestion content so long values do not break the row layout', async () => {
    channelsStoreState.channels = [{
      id: 'channel-openclaw-weixin',
      type: 'openclaw-weixin',
      name: 'Weixin',
      accounts: [{
        accountId: 'bot-default',
        enabled: true,
        isDefault: true,
        name: 'bot-default (Default)',
      }],
    }];
    agentsStoreState.defaultAgentId = 'agent-1';
    agentsStoreState.agents = [{ id: 'agent-1', name: 'Default agent' }];
    hostApiFetchMock.mockResolvedValue({
      success: true,
      sessions: [{
        sessionKey: 'session-1',
        channel: 'openclaw-weixin',
        accountId: 'bot-default',
        to: 'o9cq808lz_P1rLNz-7IWpij7Buxk@im.wechat',
        label: 'Very long auxiliary recipient label for layout pressure',
      }],
    });

    render(<Cron />);

    fireEvent.click(screen.getByRole('button', { name: 'New Task' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send to channel' }));

    await waitFor(() => {
      expect(hostApiFetchMock).toHaveBeenCalled();
    });

    fireEvent.change(screen.getByDisplayValue('Select a channel'), {
      target: { value: 'openclaw-weixin' },
    });

    const deliveryToInput = screen.getByPlaceholderText('e.g., user ID, group ID (optional)');
    fireEvent.focus(deliveryToInput);

    const suggestionLabel = await screen.findByText('Very long auxiliary recipient label for layout pressure');
    const suggestionRow = suggestionLabel.closest('button');
    expect(suggestionRow).toBeTruthy();

    const spans = suggestionRow?.querySelectorAll('span') ?? [];
    expect(spans).toHaveLength(3);
    expect(spans[1]?.className).toContain('min-w-0');
    expect(spans[1]?.className).toContain('flex-1');
    expect(spans[1]?.className).toContain('truncate');
    expect(spans[2]?.className).toContain('shrink-0');
    expect(spans[2]?.className).toContain('truncate');
  });

  it('renders structured schedules with human-readable labels in task cards', async () => {
    cronStoreState.jobs = [
      {
        id: 'job-every',
        name: 'Every job',
        message: 'Run frequently',
        schedule: { kind: 'every', everyMs: 2 * 60_000 },
        enabled: true,
        createdAt: '2026-04-08T00:00:00.000Z',
        updatedAt: '2026-04-08T00:00:00.000Z',
      },
      {
        id: 'job-every-fractional',
        name: 'Fractional job',
        message: 'Run every one and a half hours',
        schedule: { kind: 'every', everyMs: 90 * 60_000 },
        enabled: true,
        createdAt: '2026-04-08T00:00:00.000Z',
        updatedAt: '2026-04-08T00:00:00.000Z',
      },
      {
        id: 'job-once',
        name: 'Once job',
        message: 'Run once',
        schedule: { kind: 'at', at: '2026-04-08T10:11:12.000Z' },
        enabled: true,
        createdAt: '2026-04-08T00:00:00.000Z',
        updatedAt: '2026-04-08T00:00:00.000Z',
      },
      {
        id: 'job-daily',
        name: 'Daily job',
        message: 'Run daily',
        schedule: { kind: 'cron', expr: '30 7 * * *' },
        enabled: true,
        createdAt: '2026-04-08T00:00:00.000Z',
        updatedAt: '2026-04-08T00:00:00.000Z',
      },
      {
        id: 'job-weekly',
        name: 'Weekly job',
        message: 'Run weekly',
        schedule: { kind: 'cron', expr: '30 7 * * 1' },
        enabled: true,
        createdAt: '2026-04-08T00:00:00.000Z',
        updatedAt: '2026-04-08T00:00:00.000Z',
      },
      {
        id: 'job-monthly',
        name: 'Monthly job',
        message: 'Run monthly',
        schedule: { kind: 'cron', expr: '30 7 12 * *' },
        enabled: true,
        createdAt: '2026-04-08T00:00:00.000Z',
        updatedAt: '2026-04-08T00:00:00.000Z',
      },
    ];

    render(<Cron />);

    expect(screen.getByText('Every 2 minutes')).toBeInTheDocument();
    expect(screen.getByText('Every 1.5 hours')).toBeInTheDocument();
    expect(screen.getByText((content) => content.startsWith('Once at '))).toBeInTheDocument();
    expect(screen.getByText('Daily at 7:30')).toBeInTheDocument();
    expect(screen.getByText('Weekly on Monday at 7:30')).toBeInTheDocument();
    expect(screen.getByText('Monthly on day 12 at 7:30')).toBeInTheDocument();
  });

  it('backfills supported cron expressions into the fixed-time editor when editing', async () => {
    cronStoreState.jobs = [{
      id: 'job-1',
      name: 'Weekly digest',
      message: 'Summarize weekly changes',
      schedule: { kind: 'cron', expr: '30 7 * * 2' },
      enabled: true,
      createdAt: '2026-04-08T00:00:00.000Z',
      updatedAt: '2026-04-08T00:00:00.000Z',
    }];

    render(<Cron />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

    expect(screen.getByRole('button', { name: 'Weekly' })).toBeInTheDocument();
    expect(screen.getByLabelText('Weekday')).toHaveValue('2');
    expect(screen.getByLabelText('Time')).toHaveValue('07:30');

    fireEvent.change(screen.getByLabelText('Weekday'), {
      target: { value: '5' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => {
      expect(updateJobMock).toHaveBeenCalledWith('job-1', {
        name: 'Weekly digest',
        message: 'Summarize weekly changes',
        schedule: {
          kind: 'cron',
          expr: '30 7 * * 5',
        },
        enabled: true,
        delivery: { mode: 'none' },
        agentId: undefined,
      });
    });
  });

  it('normalizes weekly Sunday cron expressions to the editor Sunday option', async () => {
    cronStoreState.jobs = [{
      id: 'job-sun',
      name: 'Sunday digest',
      message: 'Summarize Sunday changes',
      schedule: { kind: 'cron', expr: '30 7 * * 7' },
      enabled: true,
      createdAt: '2026-04-08T00:00:00.000Z',
      updatedAt: '2026-04-08T00:00:00.000Z',
    }];

    render(<Cron />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

    expect(screen.getByLabelText('Weekday')).toHaveValue('0');
    expect(screen.getByLabelText('Time')).toHaveValue('07:30');

    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => {
      expect(updateJobMock).toHaveBeenCalledWith('job-sun', {
        name: 'Sunday digest',
        message: 'Summarize Sunday changes',
        schedule: {
          kind: 'cron',
          expr: '30 7 * * 0',
        },
        enabled: true,
        delivery: { mode: 'none' },
        agentId: undefined,
      });
    });
  });

  it('preserves timezone when editing a raw cron expression', async () => {
    cronStoreState.jobs = [{
      id: 'job-cron-tz',
      name: 'TZ cron',
      message: 'Keep timezone',
      schedule: { kind: 'cron', expr: '*/10 * * * *', tz: 'Asia/Shanghai' },
      enabled: true,
      createdAt: '2026-04-08T00:00:00.000Z',
      updatedAt: '2026-04-08T00:00:00.000Z',
    }];

    render(<Cron />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByDisplayValue('*/10 * * * *'), {
      target: { value: '*/15 * * * *' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => {
      expect(updateJobMock).toHaveBeenCalledWith('job-cron-tz', {
        name: 'TZ cron',
        message: 'Keep timezone',
        schedule: {
          kind: 'cron',
          expr: '*/15 * * * *',
          tz: 'Asia/Shanghai',
        },
        enabled: true,
        delivery: { mode: 'none' },
        agentId: undefined,
      });
    });
  });

  it('preserves the equivalent cron expression and timezone when switching from fixed schedule to cron mode', async () => {
    cronStoreState.jobs = [{
      id: 'job-fixed-to-cron',
      name: 'Daily digest',
      message: 'Inspect cron mode',
      schedule: { kind: 'cron', expr: '15 8 * * *', tz: 'Asia/Shanghai' },
      enabled: true,
      createdAt: '2026-04-08T00:00:00.000Z',
      updatedAt: '2026-04-08T00:00:00.000Z',
    }];

    render(<Cron />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cron' }));

    expect(screen.getByDisplayValue('15 8 * * *')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => {
      expect(updateJobMock).toHaveBeenCalledWith('job-fixed-to-cron', {
        name: 'Daily digest',
        message: 'Inspect cron mode',
        schedule: {
          kind: 'cron',
          expr: '15 8 * * *',
          tz: 'Asia/Shanghai',
        },
        enabled: true,
        delivery: { mode: 'none' },
        agentId: undefined,
      });
    });
  });

  it('prefers the current edited cron when switching back to fixed mode', async () => {
    cronStoreState.jobs = [{
      id: 'job-cron-backfill-current',
      name: 'Backfill current cron',
      message: 'Prefer edited cron over stale fixed draft',
      schedule: { kind: 'cron', expr: '15 8 * * *', tz: 'Asia/Shanghai' },
      enabled: true,
      createdAt: '2026-04-08T00:00:00.000Z',
      updatedAt: '2026-04-08T00:00:00.000Z',
    }];

    render(<Cron />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cron' }));
    fireEvent.change(screen.getByDisplayValue('15 8 * * *'), {
      target: { value: '45 6 * * 2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Fixed Time' }));

    expect(screen.getByRole('button', { name: 'Weekly' })).toBeInTheDocument();
    expect(screen.getByLabelText('Weekday')).toHaveValue('2');
    expect(screen.getByLabelText('Time')).toHaveValue('06:45');

    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => {
      expect(updateJobMock).toHaveBeenCalledWith('job-cron-backfill-current', {
        name: 'Backfill current cron',
        message: 'Prefer edited cron over stale fixed draft',
        schedule: {
          kind: 'cron',
          expr: '45 6 * * 2',
          tz: 'Asia/Shanghai',
        },
        enabled: true,
        delivery: { mode: 'none' },
        agentId: undefined,
      });
    });
  });

  it('does not rewrite existing everyMs intervals unless the user edits them', async () => {
    cronStoreState.jobs = [{
      id: 'job-every-exact',
      name: 'Exact interval',
      message: 'Keep precise interval',
      schedule: { kind: 'every', everyMs: 90_000, anchorMs: 12_345 },
      enabled: true,
      createdAt: '2026-04-08T00:00:00.000Z',
      updatedAt: '2026-04-08T00:00:00.000Z',
    }];

    render(<Cron />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

    expect(screen.getByLabelText('Interval')).toHaveValue(1.5);
    expect(screen.getByLabelText('Unit')).toHaveValue('minutes');

    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => {
      expect(updateJobMock).toHaveBeenCalledWith('job-every-exact', {
        name: 'Exact interval',
        message: 'Keep precise interval',
        schedule: {
          kind: 'every',
          everyMs: 90_000,
          anchorMs: 12_345,
        },
        enabled: true,
        delivery: { mode: 'none' },
        agentId: undefined,
      });
    });
  });

  it('falls back to raw cron mode for unsupported expressions when editing', () => {
    cronStoreState.jobs = [{
      id: 'job-2',
      name: 'Fast poll',
      message: 'Check every five minutes',
      schedule: '*/5 * * * *',
      enabled: true,
      createdAt: '2026-04-08T00:00:00.000Z',
      updatedAt: '2026-04-08T00:00:00.000Z',
    }];

    render(<Cron />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

    expect(screen.getByDisplayValue('*/5 * * * *')).toBeInTheDocument();
  });
});
