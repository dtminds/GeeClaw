import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  'dialog.scheduleFixedDaily': 'Daily',
  'dialog.scheduleFixedWeekly': 'Weekly',
  'dialog.scheduleWeekday': 'Weekday',
  'dialog.scheduleWeekday0': 'Sunday',
  'dialog.scheduleWeekday2': 'Tuesday',
  'dialog.scheduleWeekday5': 'Friday',
  'dialog.scheduleTime': 'Time',
  'dialog.scheduleEveryValue': 'Interval',
  'dialog.scheduleEveryUnit': 'Unit',
  'dialog.scheduleEveryUnitMinutes': 'Minutes',
  'dialog.scheduleEveryUnitHours': 'Hours',
  'dialog.scheduleEveryUnitDays': 'Days',
  'dialog.schedulePreviewUnavailable': 'Preview unavailable',
  'dialog.saveChanges': 'Save Changes',
  'card.next': 'Next',
  'schedule.everyMinutes': 'Every {{count}} minutes',
  'schedule.everyHours': 'Every {{count}} hours',
  'schedule.everyDays': 'Every {{count}} days',
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
    channels: [],
    fetchChannels: fetchChannelsMock,
  }),
}));

vi.mock('@/stores/agents', () => ({
  useAgentsStore: () => ({
    agents: [],
    defaultAgentId: '',
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
    hostApiFetchMock.mockResolvedValue({ success: true, sessions: [] });
  });

  it('creates an interval schedule from the structured editor', async () => {
    render(<Cron />);

    fireEvent.click(screen.getByRole('button', { name: 'New Task' }));

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
