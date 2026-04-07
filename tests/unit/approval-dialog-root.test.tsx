import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const initMock = vi.fn();

vi.mock('@/stores/approval', () => ({
  useApprovalStore: (selector: (state: {
    init: typeof initMock;
    queue: unknown[];
    busy: boolean;
    error: string | null;
    isInitialized: boolean;
    resolveActive: ReturnType<typeof vi.fn>;
    clearError: ReturnType<typeof vi.fn>;
    pruneExpired: ReturnType<typeof vi.fn>;
  }) => unknown) => selector({
    init: initMock,
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
});
