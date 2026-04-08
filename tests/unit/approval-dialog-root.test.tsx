import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const initMock = vi.fn();
const showDebugApprovalMock = vi.fn();
const clearDebugApprovalsMock = vi.fn();

vi.mock('@/stores/approval', () => ({
  useApprovalStore: (selector: (state: {
    init: typeof initMock;
    showDebugApproval: typeof showDebugApprovalMock;
    clearDebugApprovals: typeof clearDebugApprovalsMock;
    queue: unknown[];
    busy: boolean;
    error: string | null;
    isInitialized: boolean;
    resolveActive: ReturnType<typeof vi.fn>;
    clearError: ReturnType<typeof vi.fn>;
    pruneExpired: ReturnType<typeof vi.fn>;
  }) => unknown) => selector({
    init: initMock,
    showDebugApproval: showDebugApprovalMock,
    clearDebugApprovals: clearDebugApprovalsMock,
    queue: [],
    busy: false,
    error: null,
    isInitialized: false,
    resolveActive: vi.fn(),
    clearError: vi.fn(),
    pruneExpired: vi.fn(),
  }),
}));

vi.mock('@/components/approval/ApprovalDialog', () => ({
  ApprovalDialog: () => <div data-testid="approval-dialog" />,
}));

describe('ApprovalDialogRoot', () => {
  beforeEach(() => {
    initMock.mockReset();
    initMock.mockResolvedValue(undefined);
    showDebugApprovalMock.mockReset();
    clearDebugApprovalsMock.mockReset();
    delete (window as typeof window & { __debugApproval?: unknown }).__debugApproval;
  });

  it('initializes the approval store when mounted', async () => {
    const { ApprovalDialogRoot } = await import('@/components/approval/ApprovalDialogRoot');

    render(<ApprovalDialogRoot />);

    expect(initMock).toHaveBeenCalledTimes(1);
  });

  it('renders the approval dialog host', async () => {
    const { ApprovalDialogRoot } = await import('@/components/approval/ApprovalDialogRoot');
    const { getByTestId } = render(<ApprovalDialogRoot />);

    expect(getByTestId('approval-dialog')).toBeInTheDocument();
  });

  it('registers a dev console hook for showing and hiding debug approvals', async () => {
    const { ApprovalDialogRoot } = await import('@/components/approval/ApprovalDialogRoot');
    const { unmount } = render(<ApprovalDialogRoot />);

    const debugApi = (window as typeof window & {
      __debugApproval?: {
        show: (kind?: 'exec' | 'plugin') => void;
        hide: () => void;
      };
    }).__debugApproval;

    expect(debugApi).toBeDefined();

    debugApi?.show('plugin');
    debugApi?.hide();

    expect(showDebugApprovalMock).toHaveBeenCalledWith('plugin');
    expect(clearDebugApprovalsMock).toHaveBeenCalledTimes(1);

    unmount();

    expect((window as typeof window & { __debugApproval?: unknown }).__debugApproval).toBeUndefined();
  });
});
