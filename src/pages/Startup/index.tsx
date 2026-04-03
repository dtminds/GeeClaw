import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Loader2,
  Sparkles,
} from 'lucide-react';
import { TitleBar } from '@/components/layout/TitleBar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ProviderContent } from '@/pages/Setup';
import { useBootstrapStore, type BootstrapPhase } from '@/stores/bootstrap';
import { useSettingsStore } from '@/stores/settings';
import { useSessionStore } from '@/stores/session';
import { cn } from '@/lib/utils';
import geeclawIcon from '@/assets/logo.svg';

const phaseProgress: Partial<Record<BootstrapPhase, number>> = {
  idle: 10,
  checking_session: 22,
  needs_invite_code: 44,
  preparing: 72,
  needs_provider: 88,
  ready: 100,
};

export function Startup() {
  const { t } = useTranslation('setup');
  const phase = useBootstrapStore((state) => state.phase);
  const error = useBootstrapStore((state) => state.error);
  const loginAndContinue = useBootstrapStore((state) => state.loginAndContinue);
  const submitInviteCodeAndContinue = useBootstrapStore((state) => state.submitInviteCodeAndContinue);
  const skipInviteCodeAndContinue = useBootstrapStore((state) => state.skipInviteCodeAndContinue);
  const continueAfterProvider = useBootstrapStore((state) => state.continueAfterProvider);
  const logoutToLogin = useBootstrapStore((state) => state.logoutToLogin);
  const retry = useBootstrapStore((state) => state.retry);
  // const account = useSessionStore((state) => state.account);
  const setupComplete = useSettingsStore((state) => state.setupComplete);

  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [isSubmittingInviteCode, setIsSubmittingInviteCode] = useState(false);

  const progress = phaseProgress[phase] ?? 12;
  const isLoadingPhase = phase === 'idle' || phase === 'checking_session' || phase === 'preparing';

  useEffect(() => {
    if (phase !== 'needs_invite_code') {
      setInviteCode('');
      setIsSubmittingInviteCode(false);
    }
  }, [phase]);

  const handleProviderConfiguredChange = useCallback((configured: boolean) => {
    if (configured) {
      void continueAfterProvider();
    }
  }, [continueAfterProvider]);

  const handleInviteCodeSubmit = useCallback(async () => {
    const trimmedInviteCode = inviteCode.trim();
    if (!trimmedInviteCode || isSubmittingInviteCode) {
      return;
    }

    setIsSubmittingInviteCode(true);
    try {
      await submitInviteCodeAndContinue(trimmedInviteCode);
    } finally {
      setIsSubmittingInviteCode(false);
    }
  }, [inviteCode, isSubmittingInviteCode, submitInviteCodeAndContinue]);

  const loadingCopy = useMemo(() => {
    if (phase === 'preparing') {
      return {
        title: t('startup.preparing.title'),
        caption: setupComplete
          ? t('startup.preparing.captionReturning')
          : t('startup.preparing.caption'),
      };
    }

    return {
      title: t('startup.checkingSession.title'),
      caption: t('startup.checkingSession.caption'),
    };
  }, [phase, setupComplete, t]);

  const statusMessage = useMemo(() => {
    if (phase === 'needs_provider') {
      return t('startup.status.provider');
    }
    if (phase === 'needs_login') {
      return t('startup.status.login');
    }
    if (phase === 'needs_invite_code') {
      return t('startup.status.invite');
    }
    if (phase === 'error') {
      return t('startup.status.error');
    }
    return t('startup.status.default');
  }, [phase, t]);

  const renderCenterPanel = () => {
    if (isLoadingPhase) {
      return (
        <div className="mx-auto flex w-full max-w-[46rem] flex-col items-center gap-7 text-center">
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 14 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
            className="modal-card-surface relative flex h-40 w-40 items-center justify-center rounded-[2rem] border backdrop-blur-sm"
          >
            <div className="absolute inset-3 rounded-[1.5rem] bg-gradient-to-br from-white/95 via-white/45 to-sky-100/60 dark:from-white/12 dark:via-white/4 dark:to-sky-400/12" />
            <motion.div
              animate={{ y: [0, -6, 0], rotate: [0, -1.5, 0, 1.5, 0] }}
              transition={{ duration: 5.8, repeat: Infinity, ease: 'easeInOut' }}
              className="relative z-10"
            >
              <img src={geeclawIcon} alt="GeeClaw" className="h-24 w-24 drop-shadow-[0_16px_18px_rgba(255,125,90,0.16)]" />
            </motion.div>
            <div className="modal-section-surface absolute -right-3 top-6 flex h-11 w-11 items-center justify-center rounded-full border shadow-[0_10px_30px_-18px_rgba(30,54,93,0.55)]">
              <Sparkles className="h-5 w-5 text-amber-400" />
            </div>
          </motion.div>

          <div className="w-full space-y-5">
            <div>
              <h1 className="text-balance text-[clamp(1.95rem,4vw,2.85rem)] font-semibold tracking-[-0.04em] text-foreground dark:text-white/95">
                {loadingCopy.title}
              </h1>
            </div>

            <div className="mx-auto w-full max-w-[46rem]">
              <div className="h-4 overflow-hidden rounded-full bg-black/6 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] dark:bg-white/10 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
                <motion.div
                  className="h-full rounded-full bg-[linear-gradient(90deg,rgba(16,16,18,0.98),rgba(26,33,45,0.92)_58%,rgba(70,87,116,0.62))] dark:bg-[linear-gradient(90deg,rgba(108,159,255,0.96),rgba(92,139,227,0.92)_58%,rgba(72,203,255,0.62))]"
                  initial={{ width: '8%' }}
                  animate={{ width: `${progress}%` }}
                  transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
                />
              </div>
            </div>

            <div className="flex items-center justify-center gap-3 text-sm text-muted-foreground dark:text-white/70">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>{loadingCopy.caption}</span>
            </div>
          </div>
        </div>
      );
    }

    if (phase === 'needs_login') {
      return (
        <div className="mx-auto flex w-full max-w-[34rem] flex-col items-center gap-7 text-center">
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 14 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
            className="modal-card-surface relative flex h-36 w-36 items-center justify-center rounded-[2rem] border backdrop-blur-sm"
          >
            <div className="absolute inset-3 rounded-[1.5rem] bg-gradient-to-br from-white/95 via-white/55 to-sky-100/52 dark:from-white/12 dark:via-white/4 dark:to-sky-400/12" />
            <img src={geeclawIcon} alt="GeeClaw" className="h-24 w-24 drop-shadow-[0_16px_18px_rgba(255,125,90,0.16)]" />
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="w-full space-y-3"
          >
            <h2 className="text-balance text-[clamp(1.8rem,3.7vw,2.65rem)] font-bold tracking-[-0.04em] text-foreground dark:text-white/95">
              {t('startup.needsLogin.title')}
            </h2>
          </motion.div>
          <Button
            className="h-12 min-w-44 rounded-full bg-slate-950 px-6 text-sm font-medium text-white shadow-[0_20px_35px_-24px_rgba(15,23,42,0.9)] hover:bg-slate-800 dark:bg-white/94 dark:text-slate-950 dark:hover:bg-white"
            onClick={() => void loginAndContinue()}
          >
            {t('startup.needsLogin.action')}
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      );
    }

    if (phase === 'needs_invite_code') {
      return (
        <div className="mx-auto flex w-full max-w-[34rem] flex-col items-center gap-7 text-center">
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 14 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
            className="modal-card-surface relative flex h-36 w-36 items-center justify-center rounded-[2rem] border backdrop-blur-sm"
          >
            <div className="absolute inset-3 rounded-[1.5rem] bg-gradient-to-br from-white/95 via-white/55 to-sky-100/52 dark:from-white/12 dark:via-white/4 dark:to-sky-400/12" />
            <img src={geeclawIcon} alt="GeeClaw" className="h-24 w-24 drop-shadow-[0_16px_18px_rgba(255,125,90,0.16)]" />
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="w-full space-y-5"
          >
            <h2 className="text-balance text-lg font-bold tracking-[-0.04em] text-foreground dark:text-white/95">
              {t('startup.needsInvite.title')}
            </h2>
            <form
              className="mx-auto flex w-full max-w-[24rem] flex-col items-center gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                void handleInviteCodeSubmit();
              }}
            >
              <Input
                value={inviteCode}
                onChange={(event) => setInviteCode(event.target.value)}
                placeholder={t('startup.needsInvite.placeholder')}
                autoFocus
                className="modal-field-surface h-12 rounded-full border px-5 text-center text-base shadow-[0_16px_32px_-24px_rgba(15,23,42,0.32)]"
              />
              <Button
                type="submit"
                disabled={!inviteCode.trim() || isSubmittingInviteCode}
                className="h-12 min-w-44 rounded-full bg-slate-950 px-6 text-sm font-medium text-white shadow-[0_20px_35px_-24px_rgba(15,23,42,0.9)] hover:bg-slate-800 dark:bg-white/94 dark:text-slate-950 dark:hover:bg-white"
              >
                {isSubmittingInviteCode ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                {isSubmittingInviteCode
                  ? t('startup.needsInvite.submitting')
                  : t('startup.needsInvite.action')}
              </Button>
            </form>
            <div className="flex items-center justify-center gap-6">
              <button
                type="button"
                className="text-sm font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline dark:text-white/65 dark:hover:text-white/92"
                onClick={() => void skipInviteCodeAndContinue()}
              >
                {t('startup.needsInvite.skip')}
              </button>
              <button
                type="button"
                className="text-sm font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline dark:text-white/65 dark:hover:text-white/92"
                onClick={() => void logoutToLogin()}
              >
                {t('startup.needsInvite.switchAccount')}
              </button>
            </div>
          </motion.div>
        </div>
      );
    }

    if (phase === 'needs_provider') {
      return (
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="mx-auto flex w-full max-w-[58rem] flex-col gap-5"
        >
          <div className="modal-card-surface rounded-[2rem] border p-7 backdrop-blur-lg">
            <div className="flex items-start gap-4">
              <div className="modal-section-surface flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border shadow-[0_10px_24px_-18px_rgba(31,104,74,0.34)]">
                <CheckCircle2 className="h-7 w-7 text-emerald-600" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium uppercase tracking-[0.18em] text-emerald-600/70">
                  {t('startup.authenticated.eyebrow')}
                </p>
                <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground dark:text-white/65">
                  {statusMessage}
                </p>
              </div>
            </div>
          </div>

          <div className="modal-card-surface rounded-[2rem] border p-7 backdrop-blur-xl">
            <ProviderContent
              providers={[]}
              selectedProvider={selectedProvider}
              onSelectProvider={setSelectedProvider}
              apiKey={apiKey}
              onApiKeyChange={setApiKey}
              onConfiguredChange={handleProviderConfiguredChange}
            />
          </div>
        </motion.div>
      );
    }

    return (
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="modal-card-surface mx-auto w-full max-w-[40rem] rounded-[2rem] border p-8 backdrop-blur-xl"
      >
        <div className="flex items-start gap-4">
          <div className="modal-section-surface flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border shadow-[0_12px_26px_-20px_rgba(173,51,51,0.38)]">
            <AlertCircle className="h-7 w-7 text-red-500" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-3xl font-semibold tracking-[-0.04em] text-foreground dark:text-white/95">
              {t('startup.error.title')}
            </h2>
            <p className="mt-3 text-base leading-7 text-muted-foreground dark:text-white/78">
              {t('startup.error.body')}
            </p>
            <p className="mt-4 text-sm leading-6 text-muted-foreground dark:text-white/65">
              {statusMessage}
            </p>
            {error ? (
              <pre className="mt-5 whitespace-pre-wrap break-words rounded-[1.4rem] bg-slate-950/92 p-4 text-xs leading-6 text-slate-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                {error}
              </pre>
            ) : null}
            <Button
              className="modal-primary-button mt-6 h-12 px-6 text-sm"
              onClick={() => void retry()}
            >
              {t('startup.error.retry')}
            </Button>
          </div>
        </div>
      </motion.div>
    );
  };

  return (
    <div className="startup-shell flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <TitleBar />

      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-[-12%] top-[-16%] h-[28rem] w-[28rem] rounded-full bg-[radial-gradient(circle,rgba(203,232,255,0.9)_0%,rgba(203,232,255,0.22)_42%,rgba(203,232,255,0)_72%)] blur-2xl" />
        <div className="absolute right-[-10%] top-[8%] h-[24rem] w-[24rem] rounded-full bg-[radial-gradient(circle,rgba(193,222,255,0.78)_0%,rgba(193,222,255,0.18)_46%,rgba(193,222,255,0)_72%)] blur-2xl" />
        <div className="absolute bottom-[-14%] left-1/2 h-[22rem] w-[34rem] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(255,229,210,0.28)_0%,rgba(255,229,210,0.1)_42%,rgba(255,229,210,0)_76%)] blur-3xl" />
      </div>

      <div
        data-testid="startup-content-scroll-container"
        className={cn(
          'relative flex min-h-0 flex-1 flex-col px-6 pb-16 pt-10 md:px-10',
          phase === 'needs_provider'
            ? 'items-stretch overflow-y-auto overflow-x-hidden'
            : 'items-center justify-center',
        )}
      >
        {renderCenterPanel()}
      </div>
    </div>
  );
}
