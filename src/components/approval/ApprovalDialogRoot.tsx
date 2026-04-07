import { useEffect } from 'react';
import { ApprovalDialog } from '@/components/approval/ApprovalDialog';
import { useApprovalStore } from '@/stores/approval';

export function ApprovalDialogRoot() {
  const init = useApprovalStore((state) => state.init);

  useEffect(() => {
    void init();
  }, [init]);

  return <ApprovalDialog />;
}
