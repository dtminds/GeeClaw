import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type ApprovalDecision = 'allow-once' | 'allow-always' | 'deny';

type ApprovalEntry = {
  id: string;
  kind: 'exec' | 'plugin';
  createdAtMs: number;
  expiresAtMs: number;
  request: Record<string, unknown> & { command?: string };
  allowedDecisions?: ApprovalDecision[];
  pluginTitle?: string | null;
  pluginDescription?: string | null;
  pluginSeverity?: string | null;
  pluginId?: string | null;
};

const translations: Record<string, string> = {
  'approvalDialog.titles.exec': 'Exec approval needed',
  'approvalDialog.titles.pluginFallback': 'Plugin approval needed',
  'approvalDialog.description': 'A request is waiting for your decision.',
  'approvalDialog.expiresIn': 'expires in {{time}}',
  'approvalDialog.expired': 'expired',
  'approvalDialog.queueCount': '{{count}} pending',
  'approvalDialog.execLabel': 'Command',
  'approvalDialog.pluginDescriptionLabel': 'Plugin description',
  'approvalDialog.errorTitle': 'Failed to send decision',
  'approvalDialog.clearError': 'Dismiss',
  'approvalDialog.metadata.cwd': 'Working directory',
  'approvalDialog.metadata.agentId': 'Agent',
  'approvalDialog.metadata.sessionKey': 'Session',
  'approvalDialog.metadata.host': 'Host',
  'approvalDialog.metadata.security': 'Security',
  'approvalDialog.metadata.ask': 'Ask mode',
  'approvalDialog.metadata.resolvedPath': 'Resolved path',
  'approvalDialog.metadata.pluginId': 'Plugin ID',
  'approvalDialog.metadata.pluginSeverity': 'Plugin severity',
  'approvalDialog.decisions.allowOnce': 'Allow once',
  'approvalDialog.decisions.allowAlways': 'Always allow',
  'approvalDialog.decisions.deny': 'Deny',
};

const resolveActiveMock = vi.hoisted(() => vi.fn(async () => undefined));
const clearErrorMock = vi.hoisted(() => vi.fn());
const approvalState = vi.hoisted(() => ({
  queue: [] as ApprovalEntry[],
  busy: false,
  error: null as string | null,
}));

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: () => undefined,
  },
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const template = translations[key] ?? key;
      if (!options) return template;
      return template.replace(/\{\{(\w+)\}\}/g, (_, token: string) => String(options[token] ?? ''));
    },
    i18n: {
      resolvedLanguage: 'en',
    },
  }),
}));

vi.mock('@/stores/approval', () => ({
  useApprovalStore: (selector?: (state: unknown) => unknown) => {
    const snapshot = {
      ...approvalState,
      resolveActive: resolveActiveMock,
      clearError: clearErrorMock,
    };
    return selector ? selector(snapshot) : snapshot;
  },
}), { virtual: true });

function setApprovalState(next: Partial<typeof approvalState>) {
  if (next.queue) approvalState.queue = next.queue;
  if (typeof next.busy === 'boolean') approvalState.busy = next.busy;
  if (next.error !== undefined) approvalState.error = next.error;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('DialogContent class overrides', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-07T12:00:00.000Z'));
  });

  it('applies overlay and viewport class overrides without dropping defaults', async () => {
    const { Dialog, DialogContent, DialogDescription, DialogTitle } = await import('@/components/ui/dialog');

    render(
      <Dialog open>
        <DialogContent overlayClassName="approval-overlay" viewportClassName="approval-viewport">
          <DialogTitle>approval dialog</DialogTitle>
          <DialogDescription>approval dialog description</DialogDescription>
          body
        </DialogContent>
      </Dialog>,
    );

    const overlay = document.querySelector('.approval-overlay');
    const viewport = document.querySelector('.approval-viewport');

    expect(overlay).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(overlay?.className).toContain('z-[120]');
    expect(viewport?.className).toContain('z-[121]');
  });
});

describe('ApprovalDialog', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-07T12:00:00.000Z'));
    resolveActiveMock.mockClear();
    clearErrorMock.mockClear();
    setApprovalState({
      queue: [],
      busy: false,
      error: null,
    });
  });

  it('renders a blocking exec approval dialog with default decision buttons and top z-index', async () => {
    const { ApprovalDialog } = await import('@/components/approval/ApprovalDialog');
    setApprovalState({
      queue: [{
        id: 'exec-1',
        kind: 'exec',
        createdAtMs: 1,
        expiresAtMs: Date.now() + 29 * 60 * 1000,
        request: {
          command: 'mcporter --version',
          cwd: '/tmp/workspace',
          agentId: 'main',
          sessionKey: 'agent:main:thread-1',
          host: 'gateway',
          security: 'allowlist',
          ask: 'on-miss',
          resolvedPath: '/opt/homebrew/bin/mcporter',
        },
      }],
    });

    render(<ApprovalDialog />);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Exec approval needed')).toBeInTheDocument();
    expect(screen.getByText('expires in 29m')).toBeInTheDocument();
    expect(screen.getByText('mcporter --version')).toBeInTheDocument();
    expect(screen.getByText('Working directory')).toBeInTheDocument();
    expect(screen.getByText('/tmp/workspace')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Allow once' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Always allow' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /close/i })).not.toBeInTheDocument();

    const overlay = document.querySelector('.z-\\[100100\\]');
    const viewport = document.querySelector('.z-\\[100101\\]');
    expect(overlay).not.toBeNull();
    expect(viewport).not.toBeNull();

    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.pointerDown(overlay as Element);
    fireEvent.click(overlay as Element);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('renders plugin approval content and filters buttons by allowedDecisions', async () => {
    const { ApprovalDialog } = await import('@/components/approval/ApprovalDialog');
    setApprovalState({
      queue: [
        {
          id: 'plugin-1',
          kind: 'plugin',
          createdAtMs: 1,
          expiresAtMs: Date.now() + 10 * 60 * 1000,
          request: {
            command: 'Install plugin capability',
            pluginId: '',
          },
          pluginTitle: 'Plugin approval needed',
          pluginDescription: 'Needs install permission',
          pluginSeverity: 'high',
          pluginId: 'market/foo',
          allowedDecisions: ['deny'],
        },
        {
          id: 'plugin-2',
          kind: 'plugin',
          createdAtMs: 2,
          expiresAtMs: Date.now() + 12 * 60 * 1000,
          request: {
            command: 'Later plugin approval',
          },
          pluginTitle: 'Later plugin approval',
          allowedDecisions: ['allow-once'],
        },
      ],
    });

    render(<ApprovalDialog />);

    expect(screen.getByRole('heading', { name: 'Plugin approval needed' })).toBeInTheDocument();
    expect(screen.getByText('2 pending')).toBeInTheDocument();
    expect(screen.getByText('Plugin description')).toBeInTheDocument();
    expect(screen.getByText('Needs install permission')).toBeInTheDocument();
    expect(screen.getByText('Plugin ID')).toBeInTheDocument();
    expect(screen.getByText('market/foo')).toBeInTheDocument();
    expect(screen.getByText('Plugin severity')).toBeInTheDocument();
    expect(screen.getByText('high')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Allow once' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Always allow' })).not.toBeInTheDocument();
  });

  it('calls resolveActive for the selected decision and supports busy/error state', async () => {
    const { ApprovalDialog } = await import('@/components/approval/ApprovalDialog');
    setApprovalState({
      queue: [{
        id: 'exec-2',
        kind: 'exec',
        createdAtMs: 1,
        expiresAtMs: Date.now() + 10 * 60 * 1000,
        request: {
          command: 'npm test',
        },
      }],
      busy: true,
      error: 'gateway offline',
    });

    const view = render(<ApprovalDialog />);

    const allowOnceButton = screen.getByRole('button', { name: 'Allow once' });
    const denyButton = screen.getByRole('button', { name: 'Deny' });

    expect(allowOnceButton).toBeDisabled();
    expect(denyButton).toBeDisabled();
    expect(screen.getByText('Failed to send decision')).toBeInTheDocument();
    expect(screen.getByText('gateway offline')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(clearErrorMock).toHaveBeenCalledOnce();

    setApprovalState({ busy: false });
    view.rerender(<ApprovalDialog />);
    fireEvent.click(screen.getByRole('button', { name: 'Allow once' }));
    expect(resolveActiveMock).toHaveBeenCalledWith('allow-once');
  });
});
