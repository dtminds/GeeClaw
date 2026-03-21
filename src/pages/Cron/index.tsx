/**
 * Cron Page
 * Manage scheduled tasks
 */
import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Plus,
  Clock,
  Play,
  Pencil,
  Trash2,
  RefreshCw,
  X,
  Calendar,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Loader2,
  Timer,
  History,
} from 'lucide-react';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import {
  Alert02Icon,
  PauseCircleIcon,
  PlayCircleIcon,
  Task01Icon,
} from '@hugeicons/core-free-icons';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useCronStore } from '@/stores/cron';
import { useGatewayStore } from '@/stores/gateway';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { formatRelativeTime, cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { CronJob, CronJobCreateInput, CronDeliveryMode, ScheduleType } from '@/types/cron';
import { CHANNEL_ICONS, CHANNEL_NAMES, type ChannelType } from '@/types/channel';
import { useChannelsStore } from '@/stores/channels';
import { useAgentsStore } from '@/stores/agents';
import { hostApiFetch } from '@/lib/host-api';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useNavigate } from 'react-router-dom';

// Common cron schedule presets
const schedulePresets: { key: string; value: string; type: ScheduleType }[] = [
  { key: 'everyMinute', value: '* * * * *', type: 'interval' },
  { key: 'every5Min', value: '*/5 * * * *', type: 'interval' },
  { key: 'every15Min', value: '*/15 * * * *', type: 'interval' },
  { key: 'everyHour', value: '0 * * * *', type: 'interval' },
  { key: 'daily9am', value: '0 9 * * *', type: 'daily' },
  { key: 'daily6pm', value: '0 18 * * *', type: 'daily' },
  { key: 'weeklyMon', value: '0 9 * * 1', type: 'weekly' },
  { key: 'monthly1st', value: '0 9 1 * *', type: 'monthly' },
];

// Parse cron schedule to human-readable format
// Handles both plain cron strings and Gateway CronSchedule objects:
//   { kind: "cron", expr: "...", tz?: "..." }
//   { kind: "every", everyMs: number }
//   { kind: "at", at: "..." }
function parseCronSchedule(schedule: unknown, t: TFunction<'cron'>): string {
  // Handle Gateway CronSchedule object format
  if (schedule && typeof schedule === 'object') {
    const s = schedule as { kind?: string; expr?: string; tz?: string; everyMs?: number; at?: string };
    if (s.kind === 'cron' && typeof s.expr === 'string') {
      return parseCronExpr(s.expr, t);
    }
    if (s.kind === 'every' && typeof s.everyMs === 'number') {
      const ms = s.everyMs;
      if (ms < 60_000) return t('schedule.everySeconds', { count: Math.round(ms / 1000) });
      if (ms < 3_600_000) return t('schedule.everyMinutes', { count: Math.round(ms / 60_000) });
      if (ms < 86_400_000) return t('schedule.everyHours', { count: Math.round(ms / 3_600_000) });
      return t('schedule.everyDays', { count: Math.round(ms / 86_400_000) });
    }
    if (s.kind === 'at' && typeof s.at === 'string') {
      try {
        return t('schedule.onceAt', { time: new Date(s.at).toLocaleString() });
      } catch {
        return t('schedule.onceAt', { time: s.at });
      }
    }
    return String(schedule);
  }

  // Handle plain cron string
  if (typeof schedule === 'string') {
    return parseCronExpr(schedule, t);
  }

  return String(schedule ?? t('schedule.unknown'));
}

// Parse a plain cron expression string to human-readable text
function parseCronExpr(cron: string, t: TFunction<'cron'>): string {
  const preset = schedulePresets.find((p) => p.value === cron);
  if (preset) return t(`presets.${preset.key}` as const);

  const parts = cron.split(' ');
  if (parts.length !== 5) return cron;

  const [minute, hour, dayOfMonth, , dayOfWeek] = parts;

  if (minute === '*' && hour === '*') return t('presets.everyMinute');
  if (minute.startsWith('*/')) return t('schedule.everyMinutes', { count: Number(minute.slice(2)) });
  if (hour === '*' && minute === '0') return t('presets.everyHour');
  if (dayOfWeek !== '*' && dayOfMonth === '*') {
    return t('schedule.weeklyAt', { day: dayOfWeek, time: `${hour}:${minute.padStart(2, '0')}` });
  }
  if (dayOfMonth !== '*') {
    return t('schedule.monthlyAtDay', { day: dayOfMonth, time: `${hour}:${minute.padStart(2, '0')}` });
  }
  if (hour !== '*') {
    return t('schedule.dailyAt', { time: `${hour}:${minute.padStart(2, '0')}` });
  }

  return cron;
}

function estimateNextRun(scheduleExpr: string): string | null {
  const now = new Date();
  const next = new Date(now.getTime());

  if (scheduleExpr === '* * * * *') {
    next.setSeconds(0, 0);
    next.setMinutes(next.getMinutes() + 1);
    return next.toLocaleString();
  }

  if (scheduleExpr === '*/5 * * * *') {
    const delta = 5 - (next.getMinutes() % 5 || 5);
    next.setSeconds(0, 0);
    next.setMinutes(next.getMinutes() + delta);
    return next.toLocaleString();
  }

  if (scheduleExpr === '*/15 * * * *') {
    const delta = 15 - (next.getMinutes() % 15 || 15);
    next.setSeconds(0, 0);
    next.setMinutes(next.getMinutes() + delta);
    return next.toLocaleString();
  }

  if (scheduleExpr === '0 * * * *') {
    next.setMinutes(0, 0, 0);
    next.setHours(next.getHours() + 1);
    return next.toLocaleString();
  }

  if (scheduleExpr === '0 9 * * *' || scheduleExpr === '0 18 * * *') {
    const targetHour = scheduleExpr === '0 9 * * *' ? 9 : 18;
    next.setSeconds(0, 0);
    next.setHours(targetHour, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    return next.toLocaleString();
  }

  if (scheduleExpr === '0 9 * * 1') {
    next.setSeconds(0, 0);
    next.setHours(9, 0, 0, 0);
    const day = next.getDay();
    const daysUntilMonday = day === 1 ? 7 : (8 - day) % 7;
    next.setDate(next.getDate() + daysUntilMonday);
    return next.toLocaleString();
  }

  if (scheduleExpr === '0 9 1 * *') {
    next.setSeconds(0, 0);
    next.setDate(1);
    next.setHours(9, 0, 0, 0);
    if (next <= now) next.setMonth(next.getMonth() + 1);
    return next.toLocaleString();
  }

  return null;
}

// Create/Edit Task Dialog
interface TaskDialogProps {
  job?: CronJob;
  onClose: () => void;
  onSave: (input: CronJobCreateInput) => Promise<void>;
}

function TaskDialog({ job, onClose, onSave }: TaskDialogProps) {
  const { t } = useTranslation('cron');
  const [saving, setSaving] = useState(false);
  const { channels, fetchChannels } = useChannelsStore();
  const { agents, defaultAgentId, fetchAgents } = useAgentsStore();

  type SessionCandidate = { sessionKey: string; label: string; channel: string; to: string; accountId: string; chatType?: string };
  const [sessions, setSessions] = useState<SessionCandidate[]>([]);

  const [name, setName] = useState(job?.name || '');
  const [message, setMessage] = useState(job?.message || '');
  const [agentId, setAgentId] = useState(job?.agentId ?? defaultAgentId);
  const initialSchedule = (() => {
    const s = job?.schedule;
    if (!s) return '0 9 * * *';
    if (typeof s === 'string') return s;
    if (typeof s === 'object' && 'expr' in s && typeof (s as { expr: string }).expr === 'string') {
      return (s as { expr: string }).expr;
    }
    return '0 9 * * *';
  })();
  const [schedule, setSchedule] = useState(initialSchedule);
  const [customSchedule, setCustomSchedule] = useState('');
  const [useCustom, setUseCustom] = useState(false);
  const [enabled, setEnabled] = useState(job?.enabled ?? true);
  const [deliveryMode, setDeliveryMode] = useState<CronDeliveryMode>(job?.delivery?.mode ?? 'none');
  const [deliveryChannel, setDeliveryChannel] = useState(job?.delivery?.channel ?? '');
  const [deliveryTo, setDeliveryTo] = useState(job?.delivery?.to ?? '');
  const [showToSuggestions, setShowToSuggestions] = useState(false);
  const toContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (toContainerRef.current && !toContainerRef.current.contains(e.target as Node)) {
        setShowToSuggestions(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);
  const schedulePreview = estimateNextRun(useCustom ? customSchedule : schedule);

  useEffect(() => { fetchChannels(); }, [fetchChannels]);
  useEffect(() => { fetchAgents(); }, [fetchAgents]);

  useEffect(() => {
    if (!agentId || deliveryMode !== 'announce') { setSessions([]); return; }
    hostApiFetch<{ success: boolean; sessions: SessionCandidate[] }>(`/api/agents/${encodeURIComponent(agentId)}/sessions`)
      .then((res) => setSessions(res.sessions ?? []))
      .catch(() => setSessions([]));
  }, [agentId, deliveryMode]);

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast.error(t('toast.nameRequired'));
      return;
    }
    if (!message.trim()) {
      toast.error(t('toast.messageRequired'));
      return;
    }

    const finalSchedule = useCustom ? customSchedule : schedule;
    if (!finalSchedule.trim()) {
      toast.error(t('toast.scheduleRequired'));
      return;
    }

    if (deliveryMode === 'announce' && !deliveryChannel) {
      toast.error(t('toast.channelRequired'));
      return;
    }

    const delivery = deliveryMode === 'announce'
      ? { mode: 'announce' as const, channel: deliveryChannel, to: deliveryTo || undefined }
      : { mode: 'none' as const };

    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        message: message.trim(),
        schedule: finalSchedule,
        enabled,
        delivery,
        agentId: agentId || undefined,
      });
      onClose();
      toast.success(job ? t('toast.updated') : t('toast.created'));
    } catch (err) {
      toast.error(String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <Card className="modal-card-surface w-full max-w-5xl max-h-[90vh] flex flex-col rounded-3xl overflow-hidden border shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <CardHeader className="flex flex-row items-start justify-between pb-2 shrink-0 px-6 pt-5">
          <div>
            <CardTitle className="modal-title">{job ? t('dialog.editTitle') : t('dialog.createTitle')}</CardTitle>
            <CardDescription className="modal-description">{t('dialog.description')}</CardDescription>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="modal-close-button -mr-2 -mt-2">
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="overflow-y-auto flex-1 px-6 pb-6 pt-2">
          <div className="grid grid-cols-2 gap-6">
            {/* Left column */}
            <div className="space-y-5">
              {/* Name */}
              <div className="space-y-2">
                <Label htmlFor="name" className="text-[14px] text-foreground/80 font-bold">{t('dialog.taskName')}</Label>
                <Input
                  id="name"
                  placeholder={t('dialog.taskNamePlaceholder')}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="modal-field-surface h-[44px] rounded-xl font-mono text-[13px] focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:border-blue-500 shadow-sm transition-all text-foreground placeholder:text-foreground/40"
                />
              </div>

              {/* Agent */}
              <div className="space-y-2">
                <Label className="text-[14px] text-foreground/80 font-bold">{t('dialog.agent')}</Label>
                <select
                  value={agentId}
                  onChange={(e) => setAgentId(e.target.value)}
                  className="modal-field-surface w-full h-[44px] rounded-xl text-[13px] px-3 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 shadow-sm transition-all text-foreground bg-transparent border border-input"
                >
                  <option value="">{t('dialog.agentDefault')}</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>{a.name || a.id}</option>
                  ))}
                </select>
              </div>

              {/* Message */}
              <div className="space-y-2 flex flex-col flex-1">
                <Label htmlFor="message" className="text-[14px] text-foreground/80 font-bold">{t('dialog.message')}</Label>
                <Textarea
                  id="message"
                  placeholder={t('dialog.messagePlaceholder')}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={10}
                  className="modal-field-surface rounded-xl font-mono text-[13px] focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:border-blue-500 shadow-sm transition-all text-foreground placeholder:text-foreground/40 resize-none"
                />
              </div>

              {/* Enabled */}
              <div className="modal-section-surface flex items-center justify-between p-4 rounded-2xl shadow-sm border">
                <div>
                  <Label className="text-[14px] text-foreground/80 font-bold">{t('dialog.enableImmediately')}</Label>
                  <p className="text-[13px] text-muted-foreground mt-0.5">{t('dialog.enableImmediatelyDesc')}</p>
                </div>
                <Switch checked={enabled} onCheckedChange={setEnabled} />
              </div>
            </div>

            {/* Right column */}
            <div className="space-y-5">
              {/* Schedule */}
              <div className="space-y-2">
                <Label className="text-[14px] text-foreground/80 font-bold">{t('dialog.schedule')}</Label>
                {!useCustom ? (
                  <div className="grid grid-cols-2 gap-2">
                    {schedulePresets.map((preset) => (
                      <Button
                        key={preset.value}
                        type="button"
                        variant={schedule === preset.value ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setSchedule(preset.value)}
                        className={cn(
                          "justify-start h-10 rounded-xl font-medium text-[13px] transition-all",
                          schedule === preset.value
                            ? "bg-[#0a84ff] hover:bg-[#007aff] text-white shadow-sm border-transparent"
                            : "modal-field-surface hover:bg-black/5 dark:hover:bg-white/5 text-foreground/80 hover:text-foreground"
                        )}
                      >
                        <Timer className="h-4 w-4 mr-2 opacity-70" />
                        {t(`presets.${preset.key}` as const)}
                      </Button>
                    ))}
                  </div>
                ) : (
                  <Input
                    placeholder={t('dialog.cronPlaceholder')}
                    value={customSchedule}
                    onChange={(e) => setCustomSchedule(e.target.value)}
                    className="modal-field-surface h-[44px] rounded-xl font-mono text-[13px] focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:border-blue-500 shadow-sm transition-all text-foreground placeholder:text-foreground/40"
                  />
                )}
                <div className="flex items-center justify-between">
                  <p className="text-[12px] text-muted-foreground/80 font-medium">
                    {schedulePreview ? `${t('card.next')}: ${schedulePreview}` : t('dialog.cronPlaceholder')}
                  </p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setUseCustom(!useCustom)}
                    className="text-[12px] h-7 px-2 text-foreground/60 hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 rounded-lg"
                  >
                    {useCustom ? t('dialog.usePresets') : t('dialog.useCustomCron')}
                  </Button>
                </div>
              </div>

              {/* Delivery */}
              <div className="space-y-2">
                <Label className="text-[14px] text-foreground/80 font-bold">{t('dialog.deliveryMode')}</Label>
                <div className="grid grid-cols-2 gap-2">
                  {(['none', 'announce'] as CronDeliveryMode[]).map((mode) => (
                    <Button
                      key={mode}
                      type="button"
                      variant={deliveryMode === mode ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setDeliveryMode(mode)}
                      className={cn(
                        "justify-start h-10 rounded-xl font-medium text-[13px] transition-all",
                        deliveryMode === mode
                          ? "bg-[#0a84ff] hover:bg-[#007aff] text-white shadow-sm border-transparent"
                          : "modal-field-surface hover:bg-black/5 dark:hover:bg-white/5 text-foreground/80 hover:text-foreground"
                      )}
                    >
                      {t(`dialog.deliveryMode_${mode}`)}
                    </Button>
                  ))}
                </div>
                {deliveryMode === 'announce' && (
                  <div className="space-y-3 pt-1">
                    <div className="space-y-2">
                      <Label className="text-[13px] text-foreground/70">{t('dialog.deliveryChannel')}</Label>
                      <select
                        value={deliveryChannel}
                        onChange={(e) => { setDeliveryChannel(e.target.value); setDeliveryTo(''); }}
                        className="modal-field-surface w-full h-[44px] rounded-xl text-[13px] px-3 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 shadow-sm transition-all text-foreground bg-transparent border border-input"
                      >
                        <option value="">{t('dialog.deliveryChannelPlaceholder')}</option>
                        {channels.map((ch) => (
                          <option key={ch.id} value={ch.type}>
                            {CHANNEL_ICONS[ch.type as ChannelType]} {CHANNEL_NAMES[ch.type as ChannelType] || ch.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-[13px] text-foreground/70">{t('dialog.deliveryTo')}</Label>
                      <div className="relative" ref={toContainerRef}>
                        <input
                          placeholder={t('dialog.deliveryToPlaceholder')}
                          value={deliveryTo}
                          onChange={(e) => setDeliveryTo(e.target.value)}
                          onFocus={() => setShowToSuggestions(true)}
                          className="modal-field-surface w-full h-[44px] rounded-xl font-mono text-[13px] px-3 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 shadow-sm transition-all text-foreground placeholder:text-foreground/40 border border-input"
                        />
                        {showToSuggestions && (() => {
                          const filtered = sessions.filter((s) =>
                            (!deliveryChannel || s.channel === deliveryChannel) &&
                            (!deliveryTo || s.to.includes(deliveryTo) || s.label.includes(deliveryTo))
                          );
                          return filtered.length > 0 ? (
                            <div className="absolute z-20 w-full mt-1 bg-popover border border-input rounded-xl shadow-lg overflow-hidden max-h-48 overflow-y-auto">
                              {filtered.map((s) => (
                                <button
                                  key={s.sessionKey}
                                  type="button"
                                  onMouseDown={(e) => {
                                    e.preventDefault();
                                    setDeliveryTo(s.to);
                                    setShowToSuggestions(false);
                                  }}
                                  className="w-full text-left px-3 py-2.5 text-[13px] hover:bg-accent flex items-center gap-2 transition-colors"
                                >
                                  <span>{CHANNEL_ICONS[s.channel as ChannelType] || ''}</span>
                                  <span className="font-mono text-foreground">{s.to}</span>
                                  <span className="text-muted-foreground text-[12px] ml-auto">{s.label}</span>
                                </button>
                              ))}
                            </div>
                          ) : null;
                        })()}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="modal-footer mt-6">
            <Button variant="outline" onClick={onClose} className="modal-secondary-button">
              {t('common:actions.cancel', 'Cancel')}
            </Button>
            <Button onClick={handleSubmit} disabled={saving} className="modal-primary-button">
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {t('common:status.saving', 'Saving...')}
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  {job ? t('dialog.saveChanges') : t('dialog.createTitle')}
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// Job Card Component
interface CronJobCardProps {
  job: CronJob;
  onToggle: (enabled: boolean) => void;
  onEdit: () => void;
  onViewRuns: () => void;
  onDelete: () => void;
  onTrigger: () => Promise<void>;
}

function CronJobCard({ job, onToggle, onEdit, onViewRuns, onDelete, onTrigger }: CronJobCardProps) {
  const { t } = useTranslation('cron');
  const [triggering, setTriggering] = useState(false);
  const actionButtonClass = 'h-8 rounded-full border border-black/[0.06] bg-transparent px-3 text-[13px] font-medium text-foreground/72 opacity-100 transition-colors md:opacity-70 md:group-hover:opacity-100 hover:bg-black/[0.04] hover:text-foreground dark:border-white/[0.08] dark:hover:bg-white/[0.06]';

  const handleTrigger = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setTriggering(true);
    try {
      await onTrigger();
      toast.success(t('toast.triggered'));
    } catch (error) {
      console.error('Failed to trigger cron job:', error);
      toast.error(t('toast.failedTrigger', { error: error instanceof Error ? error.message : String(error) }));
    } finally {
      setTriggering(false);
    }
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete();
  };

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    onEdit();
  };

  const handleViewRuns = (e: React.MouseEvent) => {
    e.stopPropagation();
    onViewRuns();
  };

  return (
    <div
      className="group rounded-2xl border border-black/[0.06] dark:border-white/[0.08] bg-black/[0.015] dark:bg-white/[0.02] px-4 py-4 hover:bg-black/[0.025] dark:hover:bg-white/[0.035] transition-colors cursor-pointer"
      onClick={onViewRuns}
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pr-2">
              <h3 className="truncate text-[15px] font-semibold text-foreground">{job.name}</h3>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <Timer className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{parseCronSchedule(job.schedule, t)}</span>
              </span>
              {job.nextRun && job.enabled && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-black/[0.035] px-2.5 py-1 text-[12px] text-muted-foreground/85 dark:bg-white/[0.05]">
                  <Calendar className="h-3.5 w-3.5" />
                  {t('card.next')}: {new Date(job.nextRun).toLocaleString()}
                </span>
              )}
            </div>
          </div>

          <div
            className="flex flex-wrap items-center gap-2 md:justify-end md:self-start"
            onClick={(e) => e.stopPropagation()}
          >
            <Button
              variant="ghost"
              size="sm"
              onClick={handleViewRuns}
              className={actionButtonClass}
            >
              <History className="h-3.5 w-3.5 mr-1.5" />
              {t('card.record')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleEdit}
              className={actionButtonClass}
            >
              <Pencil className="h-3.5 w-3.5 mr-1.5" />
              {t('card.edit')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleTrigger}
              disabled={triggering}
              className={actionButtonClass}
            >
              {triggering ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
              ) : (
                <Play className="h-3.5 w-3.5 mr-1.5" />
              )}
              {t('card.testRun')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDelete}
              className="h-8 rounded-full border border-black/[0.06] px-3 text-[13px] font-medium text-destructive/70 opacity-100 transition-colors md:opacity-70 md:group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive dark:border-white/[0.08]"
            >
              <Trash2 className="h-3.5 w-3.5 mr-1.5" />
              {t('common:actions.delete', 'Delete')}
            </Button>
            <Switch
              checked={job.enabled}
              onCheckedChange={(enabled) => onToggle(enabled)}
            />
          </div>
        </div>

        <div className="min-w-0">
          <p className="max-w-3xl text-[13px] leading-6 text-foreground/72 dark:text-foreground/68 line-clamp-2">
            {job.message}
          </p>

          <div className="mt-3 flex flex-wrap items-start justify-start gap-2 text-[12px] text-muted-foreground/85">
            {job.target && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-black/[0.035] dark:bg-white/[0.05] px-2.5 py-1">
                {CHANNEL_ICONS[job.target.channelType as ChannelType]}
                {job.target.channelName}
              </span>
            )}

            {job.lastRun && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-black/[0.035] dark:bg-white/[0.05] px-2.5 py-1">
                <History className="h-3.5 w-3.5" />
                {t('card.last')}: {formatRelativeTime(job.lastRun.time)}
                {job.lastRun.success ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                ) : (
                  <XCircle className="h-3.5 w-3.5 text-red-500" />
                )}
              </span>
            )}

          </div>
        </div>
      </div>

      {job.lastRun && !job.lastRun.success && job.lastRun.error && (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-destructive/15 bg-destructive/[0.06] px-3 py-2.5 text-[13px] text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="line-clamp-2">{job.lastRun.error}</span>
        </div>
      )}
    </div>
  );
}

export function Cron() {
  const { t } = useTranslation('cron');
  const navigate = useNavigate();
  const { jobs, loading, error, fetchJobs, createJob, updateJob, toggleJob, deleteJob, triggerJob } = useCronStore();
  const gatewayStatus = useGatewayStore((state) => state.status);
  const [showDialog, setShowDialog] = useState(false);
  const [editingJob, setEditingJob] = useState<CronJob | undefined>();
  const [jobToDelete, setJobToDelete] = useState<{ id: string } | null>(null);

  const isGatewayRunning = gatewayStatus.state === 'running';

  // Fetch jobs on mount
  useEffect(() => {
    if (isGatewayRunning) {
      fetchJobs();
    }
  }, [fetchJobs, isGatewayRunning]);

  // Statistics
  const activeJobs = jobs.filter((j) => j.enabled);
  const pausedJobs = jobs.filter((j) => !j.enabled);
  const failedJobs = jobs.filter((j) => j.lastRun && !j.lastRun.success);
  const statCards: Array<{ key: 'total' | 'active' | 'paused' | 'failed'; value: number; icon: IconSvgElement }> = [
    { key: 'total', value: jobs.length, icon: Task01Icon },
    { key: 'active', value: activeJobs.length, icon: PlayCircleIcon },
    { key: 'paused', value: pausedJobs.length, icon: PauseCircleIcon },
    { key: 'failed', value: failedJobs.length, icon: Alert02Icon },
  ];

  const handleSave = useCallback(async (input: CronJobCreateInput) => {
    if (editingJob) {
      await updateJob(editingJob.id, input);
    } else {
      await createJob(input);
    }
  }, [editingJob, createJob, updateJob]);

  const handleToggle = useCallback(async (id: string, enabled: boolean) => {
    try {
      await toggleJob(id, enabled);
      toast.success(enabled ? t('toast.enabled') : t('toast.paused'));
    } catch {
      toast.error(t('toast.failedUpdate'));
    }
  }, [toggleJob, t]);



  if (loading) {
    return (
      <div className="flex flex-col dark:bg-background min-h-[calc(100vh-2.5rem)] items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="flex flex-col dark:bg-background ">
      <div className="w-full max-w-6xl mx-auto flex flex-col h-full px-10 pt-16">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-start justify-between mb-6 shrink-0 gap-4">
          <div>
            <h1 className="text-3xl text-foreground mb-1 font-bold tracking-tight">
              {t('title')}
            </h1>
            <p className="text-sm text-foreground/80 font-normal">
              {t('subtitle')}
            </p>
          </div>
          <div className="flex items-center gap-3 md:mt-2">
            <Button
              variant="outline"
              onClick={fetchJobs}
              disabled={!isGatewayRunning}
              className="h-9 text-[13px] font-medium rounded-full px-4 border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5 shadow-none text-foreground/80 hover:text-foreground transition-colors"
            >
              <RefreshCw className="h-3.5 w-3.5 mr-2" />
              {t('refresh')}
            </Button>
            <Button
              onClick={() => {
                setEditingJob(undefined);
                setShowDialog(true);
              }}
              disabled={!isGatewayRunning}
              className="h-9 text-[13px] font-medium rounded-full px-4 shadow-none"
            >
              <Plus className="h-3.5 w-3.5 mr-2" />
              {t('newTask')}
            </Button>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto pr-2 pb-10 min-h-0 -mr-2">
          {/* Gateway Warning */}
          {!isGatewayRunning && (
            <div className="mb-8 p-4 rounded-xl border border-yellow-500/50 bg-yellow-500/10 flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
              <span className="text-yellow-700 dark:text-yellow-400 text-sm font-medium">
                {t('gatewayWarning')}
              </span>
            </div>
          )}

          {/* Error Display */}
          {error && (
            <div className="mb-8 p-4 rounded-xl border border-destructive/50 bg-destructive/10 flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-destructive" />
              <span className="text-destructive text-sm font-medium">
                {error}
              </span>
            </div>
          )}

          {/* Statistics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            {statCards.map((stat) => (
              <div
                key={stat.key}
                className="rounded-2xl border border-black/[0.06] dark:border-white/[0.08] bg-black/[0.015] dark:bg-white/[0.02] px-4 py-3.5 hover:bg-black/[0.025] dark:hover:bg-white/[0.035] transition-colors"
              >
                <div className="flex items-center gap-2 text-muted-foreground">
                  <HugeiconsIcon icon={stat.icon} size={16} strokeWidth={1.9} className="shrink-0" />
                  <p className="text-[13px] font-medium leading-none">{t(`stats.${stat.key}`)}</p>
                </div>
                <p className="mt-3 text-[30px] leading-none font-semibold tracking-[-0.03em] text-foreground">
                  {stat.value}
                </p>
              </div>
            ))}
          </div>

          {/* Jobs List */}
          {jobs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground bg-black/5 dark:bg-white/5 rounded-3xl border border-transparent border-dashed">
              <Clock className="h-10 w-10 mb-4 opacity-50" />
              <h3 className="text-lg font-medium mb-2 text-foreground">{t('empty.title')}</h3>
              <p className="text-[14px] text-center mb-6 max-w-md">
                {t('empty.description')}
              </p>
              <Button
                onClick={() => {
                  setEditingJob(undefined);
                  setShowDialog(true);
                }}
                disabled={!isGatewayRunning}
                className="rounded-full px-6 h-10"
              >
                <Plus className="h-4 w-4 mr-2" />
                {t('empty.create')}
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {jobs.map((job) => (
                <CronJobCard
                  key={job.id}
                  job={job}
                  onToggle={(enabled) => handleToggle(job.id, enabled)}
                  onEdit={() => {
                    setEditingJob(job);
                    setShowDialog(true);
                  }}
                  onViewRuns={() => navigate(`/cron/${encodeURIComponent(job.id)}/runs`)}
                  onDelete={() => setJobToDelete({ id: job.id })}
                  onTrigger={() => triggerJob(job.id)}
                />
              ))}
            </div>
          )}

        </div>
      </div>

      {/* Create/Edit Dialog */}
      {showDialog && (
        <TaskDialog
          job={editingJob}
          onClose={() => {
            setShowDialog(false);
            setEditingJob(undefined);
          }}
          onSave={handleSave}
        />
      )}

      <ConfirmDialog
        open={!!jobToDelete}
        title={t('common:actions.confirm', 'Confirm')}
        message={t('card.deleteConfirm')}
        confirmLabel={t('common:actions.delete', 'Delete')}
        cancelLabel={t('common:actions.cancel', 'Cancel')}
        variant="destructive"
        onConfirm={async () => {
          if (jobToDelete) {
            await deleteJob(jobToDelete.id);
            setJobToDelete(null);
            toast.success(t('toast.deleted'));
          }
        }}
        onCancel={() => setJobToDelete(null)}
      />
    </div>
  );
}

export default Cron;
