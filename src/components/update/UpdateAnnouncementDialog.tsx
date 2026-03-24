import { useMemo } from 'react';
import { Clock3, Download, Loader2, Rocket, SkipForward } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatRelativeTime } from '@/lib/utils';
import { type ReleaseNoteInfo, useUpdateStore } from '@/stores/update';

function stringifyReleaseNotes(releaseNotes: string | ReleaseNoteInfo[] | null | undefined): string {
  if (!releaseNotes) return '';
  if (typeof releaseNotes === 'string') return releaseNotes;

  return releaseNotes
    .map((entry) => {
      const note = entry.note?.trim();
      if (!note) return '';
      return entry.version ? `### ${entry.version}\n\n${note}` : note;
    })
    .filter(Boolean)
    .join('\n\n');
}

function shouldShowAnnouncement(status: string): boolean {
  return status === 'available' || status === 'downloading' || status === 'downloaded';
}

export function UpdateAnnouncementDialog() {
  const { t, i18n } = useTranslation('settings');
  const {
    status,
    updateInfo,
    progress,
    autoInstallCountdown,
    skippedVersions,
    dismissedAnnouncementVersion,
    downloadUpdate,
    installUpdate,
    cancelAutoInstall,
    dismissAnnouncement,
    skipVersion,
  } = useUpdateStore();

  const version = updateInfo?.version ?? null;
  const releaseNotes = useMemo(() => stringifyReleaseNotes(updateInfo?.releaseNotes), [updateInfo?.releaseNotes]);
  const isSkipped = version ? skippedVersions.includes(version) : false;
  const open = Boolean(version && shouldShowAnnouncement(status) && !isSkipped && dismissedAnnouncementVersion !== version);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && open) {
      dismissAnnouncement(version);
    }
  };

  const handleSkipVersion = async () => {
    await skipVersion(version);
  };

  const publishedLabel = updateInfo?.releaseDate
    ? formatRelativeTime(updateInfo.releaseDate, {
        locale: i18n.resolvedLanguage || i18n.language,
        absoluteAfterMs: 1000 * 60 * 60 * 24 * 14,
        absoluteFormatter: (date, locale) => date.toLocaleDateString(locale),
      })
    : null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="modal-card-surface w-[min(680px,calc(100vw-2rem))] max-w-[680px] overflow-hidden rounded-[28px] border p-0">
        <div className="border-b border-black/6 px-6 py-6 dark:border-white/10 sm:px-7">
          <DialogHeader className="pr-12">
            <div className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-black/6 bg-background/90 text-primary shadow-sm dark:border-white/10">
              {status === 'downloaded' ? <Rocket className="h-5 w-5" /> : <Download className="h-5 w-5" />}
            </div>
            <DialogTitle className="modal-title">
              {t('updates.dialog.title', { version })}
            </DialogTitle>
            <DialogDescription className="modal-description mt-2">
              {t('updates.dialog.description')}
            </DialogDescription>
          </DialogHeader>

          <div className="mt-5 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-2 rounded-full border border-black/6 bg-black/[0.03] px-3 py-1.5 dark:border-white/10 dark:bg-white/[0.04]">
              <Rocket className="h-3.5 w-3.5" />
              {updateInfo?.releaseName || `GeeClaw ${version}`}
            </span>
            {publishedLabel && (
              <span className="inline-flex items-center gap-2 rounded-full border border-black/6 bg-black/[0.03] px-3 py-1.5 dark:border-white/10 dark:bg-white/[0.04]">
                <Clock3 className="h-3.5 w-3.5" />
                {t('updates.dialog.published', { value: publishedLabel })}
              </span>
            )}
          </div>
        </div>

        <div className="px-6 py-5 sm:px-7">
          <div className="modal-section-surface rounded-[24px] border p-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-foreground">
                {t('updates.whatsNew')}
              </p>
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                {t(`updates.status.${status === 'downloaded' ? 'downloaded' : status === 'downloading' ? 'downloading' : 'available'}`, { version })}
              </p>
            </div>

            {releaseNotes ? (
              <div className="prose prose-sm max-w-none text-sm text-foreground/78">
                <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>
                  {releaseNotes}
                </ReactMarkdown>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t('updates.dialog.empty')}
              </p>
            )}

            {status === 'downloading' && progress && (
              <div className="mt-4 rounded-2xl border border-black/6 bg-background/70 px-4 py-3 text-sm text-muted-foreground dark:border-white/10">
                {t('updates.dialog.progress', {
                  percent: Math.round(progress.percent),
                })}
              </div>
            )}

            {status === 'downloaded' && autoInstallCountdown != null && autoInstallCountdown >= 0 && (
              <div className="mt-4 rounded-2xl border border-black/6 bg-background/70 px-4 py-3 text-sm text-muted-foreground dark:border-white/10">
                {t('updates.status.autoInstalling', { seconds: autoInstallCountdown })}
              </div>
            )}
          </div>
        </div>

        <div className="modal-footer border-t border-black/6 px-6 py-5 dark:border-white/10 sm:px-7">
          {status === 'available' && (
            <Button type="button" variant="outline" className="modal-secondary-button" onClick={handleSkipVersion}>
              <SkipForward className="mr-2 h-4 w-4" />
              {t('updates.dialog.skipVersion')}
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            className="modal-secondary-button"
            onClick={() => handleOpenChange(false)}
          >
            {t('updates.dialog.later')}
          </Button>

          {status === 'available' && (
            <Button type="button" className="modal-primary-button" onClick={downloadUpdate}>
              <Download className="mr-2 h-4 w-4" />
              {t('updates.action.download')}
            </Button>
          )}

          {status === 'downloading' && (
            <Button type="button" className="modal-primary-button" disabled>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t('updates.action.downloading')}
            </Button>
          )}

          {status === 'downloaded' && autoInstallCountdown != null && autoInstallCountdown >= 0 && (
            <Button type="button" variant="outline" className="modal-secondary-button" onClick={cancelAutoInstall}>
              {t('updates.action.cancelAutoInstall')}
            </Button>
          )}

          {status === 'downloaded' && (
            <Button type="button" className="modal-primary-button" onClick={installUpdate}>
              <Rocket className="mr-2 h-4 w-4" />
              {t('updates.action.install')}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default UpdateAnnouncementDialog;
