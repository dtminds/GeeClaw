import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { FolderOpen } from 'lucide-react';
import { HugeiconsIcon } from '@hugeicons/react';
import { AiBrain01Icon } from '@hugeicons/core-free-icons';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { useChatStore } from '@/stores/chat';
import type { EvolutionProposalCardData, EvolutionProposalTab } from './evolution-proposal';

function getEvolutionProposalTabValue(tab: EvolutionProposalTab, index: number): string {
  return `${tab.kind}:${tab.label}:${index}`;
}

function getEvolutionProposalTabMeta(kind: EvolutionProposalTab['kind'], preferZh: boolean): {
  label: string;
  badgeClassName: string;
} {
  switch (kind) {
    case 'memory':
      return {
        label: preferZh ? '记忆' : 'Memory',
        badgeClassName: 'border-emerald-200/80 bg-emerald-50 text-emerald-700',
      };
    case 'behavior':
      return {
        label: preferZh ? '行为' : 'Behavior',
        badgeClassName: 'border-sky-200/80 bg-sky-50 text-sky-700',
      };
    case 'skill':
      return {
        label: preferZh ? '技能' : 'Skill',
        badgeClassName: 'border-violet-200/80 bg-violet-50 text-violet-700',
      };
    case 'tool':
      return {
        label: preferZh ? '工具调用' : 'Tool call',
        badgeClassName: 'border-orange-200/80 bg-orange-50 text-orange-700',
      };
    default:
      return {
        label: preferZh ? '提案模块' : 'Proposal',
        badgeClassName: 'border-slate-200/80 bg-slate-50 text-slate-700',
      };
  }
}

function getEvolutionDecisionCommand(decision: 'approve' | 'reject', preferZh: boolean): string {
  if (decision === 'approve') {
    return preferZh ? '批准' : 'approve';
  }

  return preferZh ? '拒绝' : 'reject';
}

export function EvolutionProposalCard({
  proposal,
  status,
  preferZh,
  renderMarkdown,
  onOpenDraftPath,
}: {
  proposal: EvolutionProposalCardData;
  status: 'running' | 'completed' | 'error';
  preferZh: boolean;
  renderMarkdown: (content: string) => ReactNode;
  onOpenDraftPath: (path: string) => Promise<void>;
}) {
  const sending = useChatStore((state) => state.sending);
  const sendMessage = useChatStore((state) => state.sendMessage);
  const [pendingAction, setPendingAction] = useState<'approve' | 'reject' | null>(null);
  const [activeTab, setActiveTab] = useState(() => getEvolutionProposalTabValue(proposal.tabs[0], 0));
  const isActionDisabled = status === 'running' || status === 'error' || sending || pendingAction !== null;

  useEffect(() => {
    const availableValues = proposal.tabs.map((tab, index) => getEvolutionProposalTabValue(tab, index));
    if (!availableValues.includes(activeTab)) {
      setActiveTab(availableValues[0] || '');
    }
  }, [activeTab, proposal.tabs]);

  const title = preferZh ? 'Hermes 进化请求' : 'Hermes Evolution Request';
  const approveLabel = preferZh ? '确认进化' : 'Approve evolution';
  const rejectLabel = preferZh ? '拒绝' : 'Reject';
  const openDraftLabel = preferZh ? '打开草稿' : 'Open draft';
  const proposalLabel = preferZh ? '提案 ID' : 'Proposal ID';
  const targetFileLabel = preferZh ? '目标文件' : 'Target file';
  const draftPathLabel = preferZh ? '草稿路径' : 'Draft path';

  const handleDecision = useCallback(async (decision: 'approve' | 'reject') => {
    if (!proposal.proposalId || isActionDisabled) {
      return;
    }

    setPendingAction(decision);
    try {
      const command = getEvolutionDecisionCommand(decision, preferZh);
      await sendMessage(`${command} ${proposal.proposalId}`);
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
  }, [isActionDisabled, preferZh, proposal.proposalId, sendMessage]);

  const handleOpenDraft = useCallback(async () => {
    if (!proposal.draftPath) {
      return;
    }
    await onOpenDraftPath(proposal.draftPath);
  }, [onOpenDraftPath, proposal.draftPath]);

  return (
    <div className="relative w-full max-w-[52rem] overflow-hidden rounded-[20px] border border-[#ecd9cf] bg-[linear-gradient(180deg,#fff1ea_0%,#fff5ef_34%,#fff6f0_100%)] px-5 py-4 text-[#3f3834] shadow-[0_1px_0_rgba(255,255,255,0.7)_inset]">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-[radial-gradient(90%_85%_at_18%_0%,rgba(255,255,255,0.9)_0%,rgba(255,255,255,0.52)_34%,rgba(255,255,255,0.08)_66%,transparent_100%),radial-gradient(72%_64%_at_62%_6%,rgba(255,210,188,0.46)_0%,rgba(255,226,214,0.2)_42%,transparent_76%)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-8 top-2 h-20 w-56 rounded-full bg-[rgba(255,255,255,0.58)] blur-2xl"
      />

      <div className="relative">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-[#f1ddd2] bg-white/86 px-3 py-1 text-sm font-semibold text-[#bc6952]">
            <HugeiconsIcon icon={AiBrain01Icon} className="h-4 w-4" />
            <span>{title}</span>
          </div>
          {proposal.description ? (
            <p className="mt-4 max-w-[46rem] text-[16px] font-medium leading-8 text-[#3d3734]">
              {proposal.description}
            </p>
          ) : null}
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="relative mt-5">
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
          const tabMeta = getEvolutionProposalTabMeta(tab.kind, preferZh);
          return (
            <TabsContent key={tabValue} value={tabValue} className="mt-3">
              <div className="rounded-[22px] border border-[#f2e5de] bg-[linear-gradient(180deg,rgba(255,255,255,0.96)_0%,rgba(255,255,255,0.92)_100%)] px-5 py-5 shadow-[0_1px_0_rgba(255,255,255,0.9)_inset]">
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  <span className={cn('inline-flex items-center rounded-[10px] border px-2.5 py-1 text-[12px] font-semibold', tabMeta.badgeClassName)}>
                    {tabMeta.label}
                  </span>
                  {proposal.tabs.length > 1 ? (
                    <span className="min-w-0 truncate text-[13px] font-medium text-[#7a6a64]">{tab.label}</span>
                  ) : null}
                </div>

                <div className="space-y-3">
                  {renderMarkdown(tab.content)}

                  {(tab.targetFile || proposal.draftPath || proposal.proposalId) ? (
                    <div className="grid gap-3 border-t border-[#f0e4dd] pt-3.5 sm:grid-cols-3">
                      <div className="px-1">
                        <div className="text-[11px] font-medium text-[#9a8b84]">
                          {proposalLabel}
                        </div>
                        <div className="mt-0.5 break-all text-xs text-[#6a5f5a]">{proposal.proposalId}</div>
                      </div>
                      {tab.targetFile ? (
                        <div className="px-1">
                          <div className="text-[11px] font-medium text-[#9a8b84]">
                            {targetFileLabel}
                          </div>
                          <div className="mt-0.5 break-all text-xs text-[#6a5f5a]">{tab.targetFile}</div>
                        </div>
                      ) : null}
                      {proposal.draftPath ? (
                        <button
                          type="button"
                          className="px-1 text-left transition-colors hover:text-[#b76551]"
                          onClick={handleOpenDraft}
                        >
                          <div className="text-[11px] font-medium text-[#9a8b84]">
                            {draftPathLabel}
                          </div>
                          <div className="mt-0.5 break-all text-xs text-[#6a5f5a]">{proposal.draftPath}</div>
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            </TabsContent>
          );
        })}
      </Tabs>

      <div className="relative mt-4 flex flex-wrap items-center justify-end gap-1.5">
        {proposal.draftPath ? (
          <button
            type="button"
            className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium text-[#8f6d63] transition-colors hover:bg-white/72 hover:text-[#6c5048]"
            onClick={handleOpenDraft}
          >
            <FolderOpen className="h-4 w-4" />
            <span>{openDraftLabel}</span>
          </button>
        ) : null}
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
  );
}
