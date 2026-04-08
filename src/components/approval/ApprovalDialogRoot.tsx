import { useEffect } from 'react';
import { ApprovalDialog } from '@/components/approval/ApprovalDialog';
import { useApprovalStore } from '@/stores/approval';

declare global {
  interface Window {
    __debugApproval?: {
      show: (kind?: 'exec' | 'plugin') => void;
      hide: () => void;
    };
  }
}

export function ApprovalDialogRoot() {
  const init = useApprovalStore((state) => state.init);
  const showDebugApproval = useApprovalStore((state) => state.showDebugApproval);
  const clearDebugApprovals = useApprovalStore((state) => state.clearDebugApprovals);

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    if (!import.meta.env.DEV || typeof window === 'undefined') {
      return undefined;
    }

    const debugApprovalApi = {
      show: (kind: 'exec' | 'plugin' = 'exec') => {
        showDebugApproval(kind);
      },
      hide: () => {
        clearDebugApprovals();
      },
    };

    window.__debugApproval = debugApprovalApi;

    return () => {
      if (window.__debugApproval === debugApprovalApi) {
        delete window.__debugApproval;
      }
    };
  }, [showDebugApproval, clearDebugApprovals]);

  return <ApprovalDialog />;
}
