import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArtificialIntelligence03Icon } from '@hugeicons/core-free-icons';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { useChatStore } from '@/stores/chat';
import type { EvolutionProposalCardData, EvolutionProposalTab } from './evolution-proposal';

function getEvolutionProposalTabValue(tab: EvolutionProposalTab, index: number): string {
  return `${tab.kind}:${tab.label}:${index}`;
}

function getEvolutionDecisionCommand(decision: 'approve' | 'reject', preferZh: boolean): string {
  if (decision === 'approve') {
    return preferZh ? '批准' : 'approve';
  }

  return preferZh ? '拒绝' : 'reject';
}

function formatExpirationDate(expiresAtMs: number): string {
  const date = new Date(expiresAtMs);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function EvolutionProposalCard({
  proposal,
  status,
  preferZh,
  renderMarkdown,
  persistedDecision,
  onPersistDecision,
  expiresAtMs,
}: {
  proposal: EvolutionProposalCardData;
  status: 'running' | 'completed' | 'error';
  preferZh: boolean;
  renderMarkdown: (content: string) => ReactNode;
  persistedDecision?: 'approve' | 'reject';
  onPersistDecision?: (proposalId: string, decision: 'approve' | 'reject') => Promise<void>;
  expiresAtMs?: number;
}) {
  const sending = useChatStore((state) => state.sending);
  const sendMessage = useChatStore((state) => state.sendMessage);
  const [pendingAction, setPendingAction] = useState<'approve' | 'reject' | null>(null);
  const [resolvedAction, setResolvedAction] = useState<'approve' | 'reject' | null>(persistedDecision ?? null);
  const [activeTab, setActiveTab] = useState(() => getEvolutionProposalTabValue(proposal.tabs[0], 0));
  const isResolved = resolvedAction !== null;
  const isActionDisabled = status === 'running' || status === 'error' || sending || pendingAction !== null || isResolved;

  useEffect(() => {
    const availableValues = proposal.tabs.map((tab, index) => getEvolutionProposalTabValue(tab, index));
    if (!availableValues.includes(activeTab)) {
      setActiveTab(availableValues[0] || '');
    }
  }, [activeTab, proposal.tabs]);

  useEffect(() => {
    setResolvedAction(persistedDecision ?? null);
  }, [persistedDecision]);

  const title = preferZh ? 'Agent 请求自我进化' : 'Agent Self-Evolution Request';
  const approveLabel = preferZh ? '确认进化' : 'Approve evolution';
  const rejectLabel = preferZh ? '拒绝' : 'Reject';
  const targetFileLabel = preferZh ? '目标文件' : 'Target file';
  const resolvedLabel = resolvedAction === 'approve'
    ? (preferZh ? '已进化' : 'Evolved')
    : resolvedAction === 'reject'
      ? (preferZh ? '已拒绝' : 'Rejected')
      : null;
  const expirationLabel = typeof expiresAtMs === 'number'
    ? (preferZh
      ? `提案将在 ${formatExpirationDate(expiresAtMs)} 失效`
      : `Proposal expires at ${formatExpirationDate(expiresAtMs)}`)
    : null;

  const handleDecision = useCallback(async (decision: 'approve' | 'reject') => {
    if (!proposal.proposalId || isActionDisabled) {
      return;
    }

    setPendingAction(decision);
    try {
      const command = getEvolutionDecisionCommand(decision, preferZh);
      await sendMessage(`${command} ${proposal.proposalId}`);
      await onPersistDecision?.(proposal.proposalId, decision);
      setResolvedAction(decision);
      toast.success(decision === 'approve'
        ? (preferZh ? '已发送进化确认' : 'Evolution approval sent')
        : (preferZh ? '已发送拒绝' : 'Evolution rejection sent'));
    } catch (error) {
      console.error('Failed to send evolution decision', error);
      toast.error(decision === 'approve'
        ? (preferZh ? '发送进化确认失败' : 'Failed to send evolution approval')
        : (preferZh ? '发送拒绝失败' : 'Failed to send evolution rejection'));
    } finally {
      setPendingAction(null);
    }
  }, [isActionDisabled, onPersistDecision, preferZh, proposal.proposalId, sendMessage]);

  return (
    <div
      className={cn(
        'relative mb-2 w-full max-w-[52rem] overflow-hidden rounded-[20px] px-3 py-3 shadow-[0_1px_0_rgba(255,255,255,0.7)_inset]',
        isResolved
          ? 'border border-[#e5e7eb] bg-[linear-gradient(180deg,#f3f4f6_0%,#f5f5f5_100%)] text-[#343434]'
          : 'border border-[#ecd9cf] bg-[linear-gradient(180deg,#fff1ea_0%,#fff5ef_34%,#fff6f0_100%)] text-[#3f3834]',
      )}
    >
      {!isResolved ? (
        <>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-[radial-gradient(90%_85%_at_18%_0%,rgba(255,255,255,0.9)_0%,rgba(255,255,255,0.52)_34%,rgba(255,255,255,0.08)_66%,transparent_100%),radial-gradient(72%_64%_at_62%_6%,rgba(255,210,188,0.46)_0%,rgba(255,226,214,0.2)_42%,transparent_76%)]"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute left-8 top-2 h-20 w-56 rounded-full bg-[rgba(255,255,255,0.58)] blur-2xl"
          />
        </>
      ) : null}

      <div className="relative">
        <div className="min-w-0">
          <div className="flex items-center justify-between gap-3 px-1">
            <div
              className={cn(
                'inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold',
                isResolved
                  ? 'border border-[#e6e6e6] bg-white text-[#fb6a33]'
                  : 'border border-[#f1ddd2] bg-white/86 text-[#bc6952]',
              )}
            >
              <HugeiconsIcon icon={ArtificialIntelligence03Icon} className="h-4 w-4 shrink-0" />
              <span>{title}</span>
              {resolvedLabel ? (
                <span className={cn('shrink-0', resolvedAction === 'reject' ? 'text-[#7a7a7a]' : 'text-[#fb6a33]')}>
                  {' · '}
                  {resolvedLabel}
                </span>
              ) : null}
            </div>
            {proposal.proposalId ? (
              <div className="min-w-0 truncate text-right font-mono text-[11px] text-[#a38a81]">
                ID: {proposal.proposalId}
              </div>
            ) : null}
          </div>
          {proposal.description ? (
            <p className="mt-3 max-w-[46rem] px-2 text-[16px] font-medium text-[#3d3734]">
              {proposal.description}
            </p>
          ) : null}
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="relative mt-2">
        {proposal.tabs.length > 1 ? (
          <TabsList className="h-auto flex-wrap justify-start gap-1.5 rounded-none bg-transparent p-0">
            {proposal.tabs.map((tab, index) => {
              const tabValue = getEvolutionProposalTabValue(tab, index);
              return (
                <TabsTrigger
                  key={tabValue}
                  value={tabValue}
                  className="min-w-0 rounded-full border border-transparent bg-transparent px-3 py-1.5 text-left text-[13px] text-[#8f6d63] shadow-none data-[state=active]:border-[#ecdcd4] data-[state=active]:bg-white/88 data-[state=active]:text-[#3f3834] data-[state=active]:shadow-none"
                >
                  <span className="block truncate">{tab.label}</span>
                </TabsTrigger>
              );
            })}
          </TabsList>
        ) : null}

        {proposal.tabs.map((tab, index) => {
          const tabValue = getEvolutionProposalTabValue(tab, index);
          return (
            <TabsContent key={tabValue} value={tabValue} className="mt-4">
              <div
                className={cn(
                  'rounded-[22px] px-5 py-5 shadow-[0_1px_0_rgba(255,255,255,0.9)_inset]',
                  isResolved
                    ? 'border border-[#e4e4e7] bg-[linear-gradient(180deg,rgba(255,255,255,0.98)_0%,rgba(255,255,255,0.95)_100%)]'
                    : 'border border-[#f2e5de] bg-[linear-gradient(180deg,rgba(255,255,255,0.96)_0%,rgba(255,255,255,0.92)_100%)]',
                )}
              >
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  {proposal.tabs.length === 1 ? (
                    <span className="min-w-0 truncate text-[13px] font-medium text-[#7a6a64]">{tab.label}</span>
                  ) : null}
                </div>

                <div className="space-y-3">
                  {renderMarkdown(tab.content)}

                  {tab.targetFile ? (
                    <div className="grid gap-3 border-t border-[#f0e4dd] pt-3.5 sm:grid-cols-3">
                      <div className="px-1">
                        <div className="text-[11px] font-medium text-[#9a8b84]">
                          {targetFileLabel}
                        </div>
                        <div className="mt-0.5 break-all text-xs text-[#6a5f5a]">{tab.targetFile}</div>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </TabsContent>
          );
        })}
      </Tabs>

      {!isResolved ? (
        <div className="relative mt-4 flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0 text-[12px] pl-2 text-[#9a8177]">
            {expirationLabel}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <button
              type="button"
              className="inline-flex h-8 items-center rounded-full border border-[#decec6] bg-white/62 px-4 text-xs font-semibold text-[#725c55] transition-colors hover:bg-white disabled:pointer-events-none disabled:opacity-50"
              onClick={() => void handleDecision('reject')}
              disabled={isActionDisabled}
            >
              {rejectLabel}
            </button>
            <button
              type="button"
              className="inline-flex h-8 items-center rounded-full bg-[#bb6a54] px-4 text-xs font-semibold text-white shadow-[0_8px_18px_-14px_rgba(187,106,84,0.72)] transition-colors hover:bg-[#ac5f4b] disabled:pointer-events-none disabled:opacity-50"
              onClick={() => void handleDecision('approve')}
              disabled={isActionDisabled}
            >
              {approveLabel}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
