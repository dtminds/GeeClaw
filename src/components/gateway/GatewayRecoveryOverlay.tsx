import { useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import geeclawIcon from '@/assets/logo.svg';
import { Button } from '@/components/ui/button';
import { useGatewayStore } from '@/stores/gateway';
import {
  DEFAULT_GATEWAY_RECOVERY_UI_STATE,
  getNextGatewayRecoveryUiState,
} from './recovery-state';

export function GatewayRecoveryOverlay() {
  const { t } = useTranslation('setup');
  const restartGateway = useGatewayStore((state) => state.restart);
  const [uiState, setUiState] = useState(() => (
    getNextGatewayRecoveryUiState(
      DEFAULT_GATEWAY_RECOVERY_UI_STATE,
      useGatewayStore.getState().status,
    )
  ));

  useEffect(() => {
    return useGatewayStore.subscribe((state) => {
      setUiState((current) => getNextGatewayRecoveryUiState(current, state.status));
    });
  }, []);

  if (uiState.phase === 'idle') {
    return null;
  }

  const handleRetry = async () => {
    await restartGateway();
  };

  if (uiState.phase === 'recovering') {
    return (
      <div className="pointer-events-auto fixed inset-0 z-[80] flex items-center justify-center bg-background/92 px-6 backdrop-blur-sm">
        <div
          role="dialog"
          aria-modal="true"
          aria-live="polite"
          className="flex w-full max-w-2xl flex-col items-center justify-center text-center"
        >
          <img src={geeclawIcon} alt="GeeClaw" className="h-20 w-20" />
          <h2 className="mt-6 text-balance text-[clamp(2rem,4.8vw,3.6rem)] font-semibold tracking-[-0.05em] text-foreground dark:text-white/95">
            {t('startup.gatewayRecovery.recovering.title')}
          </h2>
          <p className="mt-4 text-base leading-7 text-muted-foreground dark:text-white/72">
            {t('startup.gatewayRecovery.recovering.caption')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="startup-shell fixed inset-0 z-[85] overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-[-12%] top-[-16%] h-[28rem] w-[28rem] rounded-full bg-[radial-gradient(circle,rgba(203,232,255,0.9)_0%,rgba(203,232,255,0.22)_42%,rgba(203,232,255,0)_72%)] blur-2xl" />
        <div className="absolute right-[-10%] top-[8%] h-[24rem] w-[24rem] rounded-full bg-[radial-gradient(circle,rgba(193,222,255,0.78)_0%,rgba(193,222,255,0.18)_46%,rgba(193,222,255,0)_72%)] blur-2xl" />
        <div className="absolute bottom-[-14%] left-1/2 h-[22rem] w-[34rem] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(255,229,210,0.28)_0%,rgba(255,229,210,0.1)_42%,rgba(255,229,210,0)_76%)] blur-3xl" />
      </div>

      <div className="relative flex h-full items-center justify-center px-6 py-10 md:px-10">
        <div
          role="alertdialog"
          aria-modal="true"
          className="modal-card-surface mx-auto w-full max-w-[40rem] rounded-[2rem] border p-8 backdrop-blur-xl"
        >
          <div className="flex items-start gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center">
              <AlertCircle className="h-8 w-8 text-red-500" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-3xl font-semibold tracking-[-0.04em] text-foreground dark:text-white/95">
                {t('startup.gatewayRecovery.error.title')}
              </h2>
              <p className="mt-3 text-base leading-7 text-muted-foreground dark:text-white/78">
                {t('startup.gatewayRecovery.error.body')}
              </p>
              {uiState.error ? (
                <pre className="mt-5 whitespace-pre-wrap break-words rounded-lg bg-slate-950/92 p-4 text-xs leading-6 text-slate-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                  {uiState.error}
                </pre>
              ) : null}
              <Button
                type="button"
                className="modal-primary-button mt-6 h-12 px-6 text-sm"
                onClick={() => void handleRetry()}
              >
                {t('startup.gatewayRecovery.error.retry')}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
