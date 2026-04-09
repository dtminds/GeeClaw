import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  BookOpen,
  Check,
  CheckCircle,
  ExternalLink,
  Eye,
  EyeOff,
  Loader2,
  QrCode,
  ShieldCheck,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { hostApiFetch } from '@/lib/host-api';
import { subscribeHostEvent } from '@/lib/host-events';
import {
  CHANNEL_ICONS,
  CHANNEL_META,
  CHANNEL_NAMES,
  getPrimaryChannels,
  type ChannelConfigField,
  type ChannelMeta,
  type ChannelType,
} from '@/types/channel';
import telegramIcon from '@/assets/channels/telegram.svg';
import discordIcon from '@/assets/channels/discord.svg';
import whatsappIcon from '@/assets/channels/whatsapp.svg';
import dingtalkIcon from '@/assets/channels/dingtalk.svg';
import feishuIcon from '@/assets/channels/feishu.svg';
import wecomIcon from '@/assets/channels/wecom.svg';
import weixinIcon from '@/assets/channels/weixin.svg';
import qqIcon from '@/assets/channels/qq.svg';
import { cn } from '@/lib/utils';
import {
  isCanonicalChannelAccountId,
  normalizeOptionalChannelAccountId,
  resolveChannelAccountId,
} from '@/lib/channel-account-id';

interface ChannelConfigModalProps {
  configuredTypes?: string[];
  allowExistingConfig?: boolean;
  fixedType?: ChannelType | null;
  accountId?: string;
  onClose: () => void;
  onChannelSaved: (channelType: ChannelType, accountId: string) => Promise<void> | void;
}

function ChannelLogo({ type }: { type: ChannelType }) {
  switch (type) {
    case 'telegram':
      return <img src={telegramIcon} alt="Telegram" className="h-[22px] w-[22px] dark:invert" />;
    case 'discord':
      return <img src={discordIcon} alt="Discord" className="h-[22px] w-[22px] dark:invert" />;
    case 'whatsapp':
      return <img src={whatsappIcon} alt="WhatsApp" className="h-[22px] w-[22px] dark:invert" />;
    case 'dingtalk':
      return <img src={dingtalkIcon} alt="DingTalk" className="h-[22px] w-[22px] dark:invert" />;
    case 'feishu':
      return <img src={feishuIcon} alt="Feishu" className="h-[22px] w-[22px] dark:invert" />;
    case 'wecom':
      return <img src={wecomIcon} alt="WeCom" className="h-[22px] w-[22px] dark:invert" />;
    case 'openclaw-weixin':
      return <img src={weixinIcon} alt="Weixin" className="h-[22px] w-[22px]" />;
    case 'qqbot':
      return <img src={qqIcon} alt="QQ" className="h-[22px] w-[22px] dark:invert" />;
    default:
      return <span className="text-[22px]">{CHANNEL_ICONS[type] || '💬'}</span>;
  }
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function ChannelConfigModal({
  configuredTypes = [],
  allowExistingConfig = false,
  fixedType = null,
  accountId,
  onClose,
  onChannelSaved,
}: ChannelConfigModalProps) {
  const { t } = useTranslation('channels');
  const [selectedType, setSelectedType] = useState<ChannelType | null>(fixedType);
  const [configValues, setConfigValues] = useState<Record<string, string>>({});
  const [editableAccountId, setEditableAccountId] = useState(accountId || '');
  const [accountIdError, setAccountIdError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [isExistingConfig, setIsExistingConfig] = useState(false);
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);
  const resolvedAccountId = resolveChannelAccountId(accountId ?? editableAccountId, 'default');
  const meta: ChannelMeta | null = selectedType ? CHANNEL_META[selectedType] : null;
  const selectableTypes = useMemo(
    () => getPrimaryChannels().filter((type) => !configuredTypes.includes(type)),
    [configuredTypes],
  );

  useEffect(() => {
    setSelectedType(fixedType);
  }, [fixedType]);

  useEffect(() => {
    if (accountId) {
      setEditableAccountId(accountId);
    }
    setAccountIdError(null);
  }, [accountId]);

  useEffect(() => {
    if (!selectedType) {
      setConfigValues({});
      setEditableAccountId(accountId || '');
      setIsExistingConfig(false);
      setQrCode(null);
      setValidationResult(null);
      setAccountIdError(null);
      void hostApiFetch('/api/channels/whatsapp/cancel', { method: 'POST' }).catch(() => {});
      void hostApiFetch('/api/channels/wecom/cancel', { method: 'POST' }).catch(() => {});
      void hostApiFetch('/api/channels/openclaw-weixin/cancel', { method: 'POST' }).catch(() => {});
      return;
    }

    let cancelled = false;
    setLoadingConfig(true);
    setValidationResult(null);
    setQrCode(null);

    if (!accountId) {
      setConfigValues({});
      setIsExistingConfig(false);
      setLoadingConfig(false);
      return () => {
        cancelled = true;
      };
    }

    void (async () => {
      try {
        const search = `?accountId=${encodeURIComponent(accountId)}`;
        const result = await hostApiFetch<{ success: boolean; values?: Record<string, string> }>(
          `/api/channels/config/${encodeURIComponent(selectedType)}${search}`
        );
        if (cancelled) return;

        if (result.success && result.values && Object.keys(result.values).length > 0) {
          setConfigValues(result.values);
          setIsExistingConfig(true);
        } else {
          setConfigValues({});
          setIsExistingConfig(false);
        }
      } catch {
        if (!cancelled) {
          setConfigValues({});
          setIsExistingConfig(false);
        }
      } finally {
        if (!cancelled) setLoadingConfig(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [accountId, selectedType]);

  useEffect(() => {
    if (!selectedType || loadingConfig || !firstInputRef.current) return;
    firstInputRef.current.focus();
  }, [loadingConfig, selectedType]);

  useEffect(() => {
    if (selectedType !== 'whatsapp') return;

    const handleQr = (...args: unknown[]) => {
      const data = args[0] as { qr?: string };
      if (data?.qr) {
        setQrCode(`data:image/png;base64,${data.qr}`);
      }
    };

    const handleSuccess = (...args: unknown[]) => {
      const data = args[0] as { accountId?: string } | undefined;
      const nextAccountId = data?.accountId || resolvedAccountId;
      void (async () => {
        try {
          const saveResult = await hostApiFetch<{ success?: boolean; error?: string }>('/api/channels/config', {
            method: 'POST',
            body: JSON.stringify({
              channelType: 'whatsapp',
              config: { enabled: true },
              accountId: nextAccountId,
            }),
          });
          if (!saveResult?.success) {
            throw new Error(saveResult?.error || 'Failed to save WhatsApp config');
          }

          await onChannelSaved('whatsapp', nextAccountId);
          onClose();
        } catch (error) {
          toast.error(t('toast.configFailed', { error: String(error) }));
        } finally {
          setConnecting(false);
        }
      })();
    };

    const handleError = (...args: unknown[]) => {
      const error = String(args[0] || 'Unknown error');
      toast.error(t('toast.whatsappFailed', { error }));
      setQrCode(null);
      setConnecting(false);
    };

    const removeQrListener = subscribeHostEvent('channel:whatsapp-qr', handleQr);
    const removeSuccessListener = subscribeHostEvent('channel:whatsapp-success', handleSuccess);
    const removeErrorListener = subscribeHostEvent('channel:whatsapp-error', handleError);

    return () => {
      if (typeof removeQrListener === 'function') removeQrListener();
      if (typeof removeSuccessListener === 'function') removeSuccessListener();
      if (typeof removeErrorListener === 'function') removeErrorListener();
      void hostApiFetch('/api/channels/whatsapp/cancel', { method: 'POST' }).catch(() => {});
    };
  }, [accountId, onChannelSaved, onClose, resolvedAccountId, selectedType, t]);

  useEffect(() => {
    if (selectedType !== 'wecom') return;

    const handleQr = (...args: unknown[]) => {
      const data = args[0] as { qr?: string };
      if (data?.qr) {
        setQrCode(`data:image/png;base64,${data.qr}`);
      }
    };

    const handleSuccess = (...args: unknown[]) => {
      const data = args[0] as { accountId?: string; botId?: string; secret?: string } | undefined;
      const nextAccountId = data?.accountId || resolvedAccountId;
      const botId = data?.botId?.trim();
      const secret = data?.secret?.trim();
      void (async () => {
        try {
          if (!botId || !secret) {
            throw new Error('WeCom scan result is missing bot credentials');
          }

          const saveResult = await hostApiFetch<{ success?: boolean; error?: string }>('/api/channels/config', {
            method: 'POST',
            body: JSON.stringify({
              channelType: 'wecom',
              config: { botId, secret, enabled: true },
              accountId: nextAccountId,
            }),
          });
          if (!saveResult?.success) {
            throw new Error(saveResult?.error || 'Failed to save WeCom config');
          }

          setConfigValues((prev) => ({ ...prev, botId, secret }));
          toast.success(t('toast.wecomConnected'));
          await onChannelSaved('wecom', nextAccountId);
          onClose();
        } catch (error) {
          toast.error(t('toast.configFailed', { error: String(error) }));
        } finally {
          setConnecting(false);
        }
      })();
    };

    const handleError = (...args: unknown[]) => {
      const error = String(args[0] || 'Unknown error');
      toast.error(t('toast.wecomScanFailed', { error }));
      setQrCode(null);
      setConnecting(false);
    };

    const removeQrListener = subscribeHostEvent('channel:wecom-qr', handleQr);
    const removeSuccessListener = subscribeHostEvent('channel:wecom-success', handleSuccess);
    const removeErrorListener = subscribeHostEvent('channel:wecom-error', handleError);

    return () => {
      if (typeof removeQrListener === 'function') removeQrListener();
      if (typeof removeSuccessListener === 'function') removeSuccessListener();
      if (typeof removeErrorListener === 'function') removeErrorListener();
      void hostApiFetch('/api/channels/wecom/cancel', { method: 'POST' }).catch(() => {});
    };
  }, [onChannelSaved, onClose, resolvedAccountId, selectedType, t]);

  useEffect(() => {
    if (selectedType !== 'openclaw-weixin') return;

    const handleQr = (...args: unknown[]) => {
      const data = args[0] as { qr?: string };
      if (data?.qr) {
        setQrCode(`data:image/png;base64,${data.qr}`);
      }
    };

    const handleSuccess = (...args: unknown[]) => {
      const data = args[0] as { accountId?: string } | undefined;
      const nextAccountId = data?.accountId?.trim();
      void (async () => {
        try {
          if (!nextAccountId) {
            throw new Error('Weixin scan result is missing account ID');
          }

          const saveResult = await hostApiFetch<{ success?: boolean; error?: string }>('/api/channels/config', {
            method: 'POST',
            body: JSON.stringify({
              channelType: 'openclaw-weixin',
              config: { enabled: true },
              accountId: nextAccountId,
            }),
          });
          if (!saveResult?.success) {
            throw new Error(saveResult?.error || 'Failed to save Weixin config');
          }

          toast.success(t('toast.weixinConnected'));
          await onChannelSaved('openclaw-weixin', nextAccountId);
          onClose();
        } catch (error) {
          toast.error(t('toast.configFailed', { error: String(error) }));
        } finally {
          setConnecting(false);
        }
      })();
    };

    const handleError = (...args: unknown[]) => {
      const error = String(args[0] || 'Unknown error');
      toast.error(t('toast.weixinScanFailed', { error }));
      setQrCode(null);
      setConnecting(false);
    };

    const removeQrListener = subscribeHostEvent('channel:openclaw-weixin-qr', handleQr);
    const removeSuccessListener = subscribeHostEvent('channel:openclaw-weixin-success', handleSuccess);
    const removeErrorListener = subscribeHostEvent('channel:openclaw-weixin-error', handleError);

    return () => {
      if (typeof removeQrListener === 'function') removeQrListener();
      if (typeof removeSuccessListener === 'function') removeSuccessListener();
      if (typeof removeErrorListener === 'function') removeErrorListener();
      void hostApiFetch('/api/channels/openclaw-weixin/cancel', { method: 'POST' }).catch(() => {});
    };
  }, [onChannelSaved, onClose, selectedType, t]);

  const isFormValid = useCallback(() => {
    if (!meta) return false;
    return meta.configFields
      .filter((field) => field.required)
      .every((field) => configValues[field.key]?.trim());
  }, [configValues, meta]);

  const updateConfigValue = useCallback((key: string, value: string) => {
    setConfigValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  const toggleSecretVisibility = useCallback((key: string) => {
    setShowSecrets((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const openDocs = useCallback(() => {
    if (!meta?.docsUrl) return;
    const url = t(meta.docsUrl.replace('channels:', ''));
    if (window.electron?.openExternal) {
      window.electron.openExternal(url);
      return;
    }
    window.open(url, '_blank');
  }, [meta, t]);

  const validateAccountId = useCallback((value: string | null | undefined, options?: { allowEmpty?: boolean }): boolean => {
    const normalized = normalizeOptionalChannelAccountId(value);
    if (!normalized && options?.allowEmpty) {
      setAccountIdError(null);
      return true;
    }

    const candidate = normalized ?? resolveChannelAccountId(value, 'default');
    if (!isCanonicalChannelAccountId(candidate)) {
      const message = t('dialog.accountIdInvalid');
      setAccountIdError(message);
      toast.error(message);
      return false;
    }

    setAccountIdError(null);
    return true;
  }, [t]);

  const handleValidate = useCallback(async () => {
    if (!selectedType) return;

    setValidating(true);
    setValidationResult(null);

    try {
      const result = await hostApiFetch<{
        success: boolean;
        valid?: boolean;
        errors?: string[];
        warnings?: string[];
        details?: Record<string, string>;
      }>('/api/channels/credentials/validate', {
        method: 'POST',
        body: JSON.stringify({ channelType: selectedType, config: configValues }),
      });

      const warnings = [...(result.warnings || [])];
      if (result.valid && result.details) {
        const details = result.details;
        if (details.botUsername) warnings.push(`Bot: @${details.botUsername}`);
        if (details.guildName) warnings.push(`Server: ${details.guildName}`);
        if (details.channelName) warnings.push(`Channel: #${details.channelName}`);
      }

      setValidationResult({
        valid: result.valid || false,
        errors: result.errors || [],
        warnings,
      });
    } catch (error) {
      setValidationResult({
        valid: false,
        errors: [String(error)],
        warnings: [],
      });
    } finally {
      setValidating(false);
    }
  }, [configValues, selectedType]);

  const handleConnect = useCallback(async () => {
    if (!selectedType || !meta) return;

    const shouldAllowEmptyAccountId = selectedType === 'openclaw-weixin' && !accountId;
    if (!validateAccountId(accountId ?? editableAccountId, { allowEmpty: shouldAllowEmptyAccountId })) {
      return;
    }

    setConnecting(true);
    setValidationResult(null);

    try {
      if (meta.connectionType === 'qr') {
        if (selectedType === 'openclaw-weixin') {
          await hostApiFetch('/api/channels/openclaw-weixin/start', {
            method: 'POST',
            body: JSON.stringify(accountId ? { accountId } : {}),
          });
          return;
        }

        await hostApiFetch('/api/channels/whatsapp/start', {
          method: 'POST',
          body: JSON.stringify({ accountId: resolvedAccountId }),
        });
        return;
      }

      if (meta.connectionType === 'token') {
        const validationResponse = await hostApiFetch<{
          success: boolean;
          valid?: boolean;
          errors?: string[];
          warnings?: string[];
          details?: Record<string, string>;
        }>('/api/channels/credentials/validate', {
          method: 'POST',
          body: JSON.stringify({ channelType: selectedType, config: configValues }),
        });

        if (!validationResponse.valid) {
          setValidationResult({
            valid: false,
            errors: validationResponse.errors || ['Validation failed'],
            warnings: validationResponse.warnings || [],
          });
          setConnecting(false);
          return;
        }

        const warnings = [...(validationResponse.warnings || [])];
        if (validationResponse.details) {
          const details = validationResponse.details;
          if (details.botUsername) warnings.push(`Bot: @${details.botUsername}`);
          if (details.guildName) warnings.push(`Server: ${details.guildName}`);
          if (details.channelName) warnings.push(`Channel: #${details.channelName}`);
        }

        setValidationResult({
          valid: true,
          errors: [],
          warnings,
        });
      }

      const config: Record<string, unknown> = { ...configValues };
      const saveResult = await hostApiFetch<{
        success?: boolean;
        error?: string;
        warning?: string;
      }>('/api/channels/config', {
        method: 'POST',
        body: JSON.stringify({
          channelType: selectedType,
          config,
          accountId: resolvedAccountId,
        }),
      });
      if (!saveResult?.success) {
        throw new Error(saveResult?.error || 'Failed to save channel config');
      }
      if (typeof saveResult.warning === 'string' && saveResult.warning) {
        toast.warning(saveResult.warning);
      }

      await onChannelSaved(selectedType, resolvedAccountId);
      onClose();
    } catch (error) {
      toast.error(t('toast.configFailed', { error: String(error) }));
      setConnecting(false);
      return;
    }

    setConnecting(false);
  }, [accountId, configValues, editableAccountId, meta, onChannelSaved, onClose, resolvedAccountId, selectedType, t, validateAccountId]);

  const handleStartWeComScan = useCallback(async () => {
    if (!validateAccountId(resolvedAccountId)) {
      return;
    }

    setConnecting(true);
    setValidationResult(null);
    setQrCode(null);

    try {
      await hostApiFetch('/api/channels/wecom/start', {
        method: 'POST',
        body: JSON.stringify({ accountId: resolvedAccountId }),
      });
    } catch (error) {
      toast.error(t('toast.wecomScanFailed', { error: String(error) }));
      setConnecting(false);
    }
  }, [resolvedAccountId, t, validateAccountId]);

  const handleRefreshCode = useCallback(async () => {
    setQrCode(null);
    if (selectedType === 'wecom') {
      await handleStartWeComScan();
      return;
    }
    if (selectedType === 'openclaw-weixin') {
      setConnecting(true);
      try {
        await hostApiFetch('/api/channels/openclaw-weixin/start', {
          method: 'POST',
          body: JSON.stringify(accountId ? { accountId } : {}),
        });
      } catch (error) {
        toast.error(t('toast.weixinScanFailed', { error: String(error) }));
        setConnecting(false);
      }
      return;
    }
    await handleConnect();
  }, [accountId, handleConnect, handleStartWeComScan, selectedType, t]);

  return createPortal(
    <div className="overlay-backdrop fixed inset-0 z-[140] flex items-center justify-center p-6">
      <Card className="modal-card-surface flex max-h-[90vh] w-full max-w-[660px] flex-col overflow-hidden rounded-3xl border shadow-2xl">
        <CardHeader className="flex shrink-0 flex-row items-start justify-between pb-2">
          <div>
            <CardTitle className="modal-title">
              {selectedType
                ? isExistingConfig
                  ? t('dialog.updateTitle', { name: CHANNEL_NAMES[selectedType] })
                  : t('dialog.configureTitle', { name: CHANNEL_NAMES[selectedType] })
                : t('dialog.addTitle')}
            </CardTitle>
            <CardDescription className="modal-description">
              {selectedType && isExistingConfig
                ? t('dialog.existingDesc')
                : meta ? t(meta.description.replace('channels:', '')) : t('dialog.selectDesc')}
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="modal-close-button -mr-2 -mt-2"
          >
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="flex-1 space-y-6 overflow-y-auto p-6 pt-4">
          {!selectedType ? (
            <div className="grid grid-cols-2 gap-4">
              {selectableTypes.map((type) => {
                const channelMeta = CHANNEL_META[type];
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setSelectedType(type)}
                    className="surface-hover group rounded-2xl border border-black/5 p-4 text-left transition-all dark:border-white/5"
                  >
                    <div className="surface-muted mb-3 flex h-[46px] w-[46px] items-center justify-center rounded-full border border-black/5 text-foreground shadow-sm transition-transform group-hover:scale-105 dark:border-white/10">
                      <ChannelLogo type={type} />
                    </div>
                    <p className="text-[15px] font-semibold">{channelMeta.name}</p>
                    <p className="mt-0.5 text-[13px] text-muted-foreground">
                      {channelMeta.connectionType === 'qr' ? t('dialog.qrCode') : t('dialog.token')}
                    </p>
                  </button>
                );
              })}
            </div>
          ) : qrCode ? (
            <div className="space-y-5 py-4 text-center">
              <div className="inline-block rounded-3xl border border-black/5 bg-white p-5 shadow-sm">
                {qrCode.startsWith('data:image') ? (
                  <img src={qrCode} alt="Scan QR Code" className="h-64 w-64 object-contain" />
                ) : (
                  <div className="flex h-64 w-64 items-center justify-center rounded-2xl bg-gray-50">
                    <QrCode className="h-24 w-24 text-gray-300" />
                  </div>
                )}
              </div>
              <p className="text-[14px] font-medium text-muted-foreground">
                {t('dialog.scanQR', { name: meta?.name })}
              </p>
              <div className="flex justify-center gap-2 pt-2">
                <Button
                  variant="outline"
                  onClick={() => void handleRefreshCode()}
                  className="modal-secondary-button"
                >
                  {t('dialog.refreshCode')}
                </Button>
              </div>
            </div>
          ) : loadingConfig ? (
            <div className="flex flex-col items-center justify-center space-y-4 py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground/50" />
              <span className="text-[14px] font-medium text-muted-foreground">{t('dialog.loadingConfig')}</span>
            </div>
          ) : (
            <div className="space-y-4">
              {isExistingConfig && allowExistingConfig && (
                <div className="modal-section-surface flex items-center gap-2.5 rounded-2xl border p-4 text-[13.5px] font-medium text-foreground/80 shadow-sm">
                  <CheckCircle className="text-info h-4 w-4 shrink-0" />
                  <span>{t('dialog.existingHint')}</span>
                </div>
              )}

              <div className="modal-section-surface space-y-3 rounded-2xl border p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <p className="text-[14px] font-semibold text-foreground/80">{t('dialog.howToConnect')}</p>
                  <Button
                    variant="link"
                    className="h-auto p-0 text-[13px] text-muted-foreground hover:text-foreground"
                    onClick={openDocs}
                  >
                    <BookOpen className="mr-1.5 h-3.5 w-3.5" />
                    {t('dialog.viewDocs')}
                    <ExternalLink className="ml-1 h-3 w-3" />
                  </Button>
                </div>
                <ol className="list-decimal list-inside space-y-1.5 text-[13.5px] leading-relaxed text-muted-foreground">
                  {meta?.instructions.map((instruction, index) => (
                    <li key={index}>{t(instruction.replace('channels:', ''))}</li>
                  ))}
                </ol>
              </div>

              {!accountId && selectedType !== 'openclaw-weixin' && (
                <div className="space-y-2.5">
                  <Label htmlFor="account-id" className="text-[14px] font-bold text-foreground/80">
                    {t('dialog.accountId', 'Account ID')}
                  </Label>
                  <Input
                    ref={firstInputRef}
                    id="account-id"
                    placeholder={t('dialog.accountIdPlaceholder', 'default')}
                    value={editableAccountId}
                    onChange={(event) => {
                      setEditableAccountId(event.target.value);
                      if (accountIdError) {
                        setAccountIdError(null);
                      }
                    }}
                    className={cn(
                      'modal-field-surface field-focus-ring h-[44px] rounded-xl font-mono text-[13px] text-foreground shadow-sm transition-all placeholder:text-foreground/40',
                      accountIdError && 'border-destructive/60 focus-visible:ring-destructive/30',
                    )}
                  />
                  <p className={cn('text-[12px]', accountIdError ? 'text-destructive' : 'text-muted-foreground')}>
                    {accountIdError || t('dialog.accountIdHint')}
                  </p>
                </div>
              )}

              {meta?.configFields.map((field) => (
                <ConfigField
                  key={field.key}
                  field={field}
                  value={configValues[field.key] || ''}
                  onChange={(value) => updateConfigValue(field.key, value)}
                  showSecret={showSecrets[field.key] || false}
                  onToggleSecret={() => toggleSecretVisibility(field.key)}
                  inputRef={accountId ? firstInputRef : undefined}
                />
              ))}

              {validationResult && (
                <div
                  className={`rounded-2xl border border-black/5 p-4 text-[13.5px] shadow-sm dark:border-white/5 ${
                    validationResult.valid ? 'modal-section-surface text-foreground/80' : 'bg-destructive/10 text-destructive'
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    {validationResult.valid ? (
                      <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
                    ) : (
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <h4 className="mb-1 font-bold">
                        {validationResult.valid ? t('dialog.credentialsVerified') : t('dialog.validationFailed')}
                      </h4>
                      {validationResult.errors.length > 0 && (
                        <ul className="list-disc list-inside space-y-0.5 font-medium">
                          {validationResult.errors.map((error, index) => (
                            <li key={index}>{error}</li>
                          ))}
                        </ul>
                      )}
                      {validationResult.valid && validationResult.warnings.length > 0 && (
                        <div className="mt-1 space-y-0.5 font-medium text-green-600 dark:text-green-500">
                          {validationResult.warnings.map((info, index) => (
                            <p key={index} className="text-[13px]">{info}</p>
                          ))}
                        </div>
                      )}
                      {!validationResult.valid && validationResult.warnings.length > 0 && (
                        <div className="mt-2 font-medium text-yellow-600 dark:text-yellow-500">
                          <p className="mb-1 text-[12px] font-bold uppercase">{t('dialog.warnings')}</p>
                          <ul className="list-disc list-inside space-y-0.5">
                            {validationResult.warnings.map((warning, index) => (
                              <li key={index}>{warning}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              <div className="modal-footer">
                <div className="flex gap-3">
                  {selectedType === 'wecom' && (
                    <Button
                      variant="secondary"
                      onClick={() => void handleStartWeComScan()}
                      disabled={connecting}
                      className="modal-secondary-button"
                    >
                      {connecting && !qrCode ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          {t('dialog.preparingWecomScan')}
                        </>
                      ) : (
                        <>
                          <QrCode className="mr-2 h-4 w-4" />
                          {t('dialog.scanWecomQuickBind')}
                        </>
                      )}
                    </Button>
                  )}
                  {meta?.connectionType === 'token' && (
                    <Button
                      variant="secondary"
                      onClick={() => void handleValidate()}
                      disabled={validating}
                      className="modal-secondary-button"
                    >
                      {validating ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          {t('dialog.validating')}
                        </>
                      ) : (
                        <>
                          <ShieldCheck className="mr-2 h-4 w-4" />
                          {t('dialog.validateConfig')}
                        </>
                      )}
                    </Button>
                  )}
                  <Button
                    onClick={() => void handleConnect()}
                    disabled={connecting || !isFormValid()}
                    className="modal-primary-button"
                  >
                    {connecting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        {meta?.connectionType === 'qr' ? t('dialog.generatingQR') : t('dialog.validatingAndSaving')}
                      </>
                    ) : meta?.connectionType === 'qr' ? (
                      t('dialog.generateQRCode')
                    ) : (
                      <>
                        <Check className="mr-2 h-4 w-4" />
                        {isExistingConfig ? t('dialog.updateAndReconnect') : t('dialog.saveAndConnect')}
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>,
    document.body,
  );
}

interface ConfigFieldProps {
  field: ChannelConfigField;
  value: string;
  onChange: (value: string) => void;
  showSecret: boolean;
  onToggleSecret: () => void;
  inputRef?: React.Ref<HTMLInputElement>;
}

function ConfigField({
  field,
  value,
  onChange,
  showSecret,
  onToggleSecret,
  inputRef,
}: ConfigFieldProps) {
  const { t } = useTranslation('channels');
  const isPassword = field.type === 'password';

  return (
    <div className="space-y-2.5">
      <Label htmlFor={field.key} className="text-[14px] font-bold text-foreground/80">
        {t(field.label.replace('channels:', ''))}
        {field.required && <span className="ml-1 text-destructive">*</span>}
      </Label>
      <div className="flex gap-2">
        <Input
          ref={inputRef}
          id={field.key}
          type={isPassword && !showSecret ? 'password' : 'text'}
          placeholder={field.placeholder ? t(field.placeholder.replace('channels:', '')) : undefined}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="modal-field-surface field-focus-ring h-[44px] rounded-xl font-mono text-[13px] text-foreground shadow-sm transition-all placeholder:text-foreground/40"
        />
        {isPassword && (
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={onToggleSecret}
            className="modal-field-surface h-[44px] w-[44px] shrink-0 rounded-xl text-muted-foreground shadow-sm hover:text-foreground"
          >
            {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </Button>
        )}
      </div>
      {field.description && (
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          {t(field.description.replace('channels:', ''))}
        </p>
      )}
      {field.envVar && (
        <p className="font-mono text-[12px] text-muted-foreground/70">
          {t('dialog.envVar', { var: field.envVar })}
        </p>
      )}
    </div>
  );
}

export default ChannelConfigModal;
