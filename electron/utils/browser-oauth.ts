import { EventEmitter } from 'events';
import { BrowserWindow } from 'electron';
import { logger } from './logger';
import { openSafeExternalUrl } from './external-links';
import { loginGeminiCliOAuth, type GeminiCliOAuthCredentials } from './gemini-cli-oauth';
import { loginOpenAICodexOAuth, type OpenAICodexOAuthCredentials } from './openai-codex-oauth';
import { getProviderService } from '../services/providers/provider-service';
import { getSecretStore } from '../services/secrets/secret-store';
import { saveOAuthTokenToOpenClaw } from './openclaw-auth';
import { normalizeProviderModelList } from '@shared/providers/config-models';

export type BrowserOAuthProviderType = 'google' | 'openai';

const GOOGLE_RUNTIME_PROVIDER_ID = 'google-gemini-cli';
const GOOGLE_OAUTH_DEFAULT_MODEL = 'gemini-3-flash-preview';
const OPENAI_RUNTIME_PROVIDER_ID = 'openai-codex';
const OPENAI_OAUTH_DEFAULT_MODEL = 'gpt-5.4';

function normalizeBrowserOAuthModel(
  providerType: BrowserOAuthProviderType,
  value?: string | null,
): string | undefined {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    return undefined;
  }

  if (providerType === 'google') {
    return normalized.includes('/') ? normalized.split('/').pop() || undefined : normalized;
  }

  if (normalized.startsWith('openai/')) {
    return undefined;
  }
  if (normalized.startsWith('openai-codex/')) {
    return normalized.split('/').pop() || undefined;
  }
  return normalized.includes('/') ? normalized.split('/').pop() || undefined : normalized;
}

class BrowserOAuthManager extends EventEmitter {
  private activeProvider: BrowserOAuthProviderType | null = null;
  private activeAccountId: string | null = null;
  private activeLabel: string | null = null;
  private active = false;
  private mainWindow: BrowserWindow | null = null;
  private pendingManualCodeResolve: ((value: string) => void) | null = null;
  private pendingManualCodeReject: ((reason?: unknown) => void) | null = null;

  setWindow(window: BrowserWindow) {
    this.mainWindow = window;
  }

  async startFlow(
    provider: BrowserOAuthProviderType,
    options?: { accountId?: string; label?: string },
  ): Promise<boolean> {
    if (this.active) {
      await this.stopFlow();
    }

    this.active = true;
    this.activeProvider = provider;
    this.activeAccountId = options?.accountId || provider;
    this.activeLabel = options?.label || null;
    this.emit('oauth:start', { provider, accountId: this.activeAccountId });

    void this.executeFlow(provider);
    return true;
  }

  private async executeFlow(provider: BrowserOAuthProviderType): Promise<void> {
    try {
      const token = provider === 'google'
        ? await loginGeminiCliOAuth({
          isRemote: false,
          openUrl: async (url) => {
            await openSafeExternalUrl(url);
          },
          log: (message) => logger.info(`[BrowserOAuth] ${message}`),
          note: async (message, title) => {
            logger.info(`[BrowserOAuth] ${title || 'OAuth note'}: ${message}`);
          },
          prompt: async () => {
            throw new Error('Manual browser OAuth fallback is not implemented in GeeClaw yet.');
          },
          progress: {
            update: (message) => logger.info(`[BrowserOAuth] ${message}`),
            stop: (message) => {
              if (message) {
                logger.info(`[BrowserOAuth] ${message}`);
              }
            },
          },
        })
        : await loginOpenAICodexOAuth({
          openUrl: async (url) => {
            await openSafeExternalUrl(url);
          },
          onProgress: (message) => logger.info(`[BrowserOAuth] ${message}`),
          onManualCodeRequired: ({ authorizationUrl, reason }) => {
            const message = reason === 'port_in_use'
              ? 'OpenAI OAuth callback port 1455 is in use. Complete sign-in, then paste the final callback URL or code.'
              : 'OpenAI OAuth callback timed out. Paste the final callback URL or code to continue.';
            const payload = {
              provider,
              mode: 'manual' as const,
              authorizationUrl,
              message,
            };
            this.emit('oauth:code', payload);
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
              this.mainWindow.webContents.send('oauth:code', payload);
            }
          },
          onManualCodeInput: async () => {
            return await new Promise<string>((resolve, reject) => {
              this.pendingManualCodeResolve = resolve;
              this.pendingManualCodeReject = reject;
            });
          },
        });

      await this.onSuccess(provider, token);
    } catch (error) {
      if (!this.active) {
        return;
      }
      logger.error(`[BrowserOAuth] Flow error for ${provider}:`, error);
      this.emitError(error instanceof Error ? error.message : String(error));
      this.active = false;
      this.activeProvider = null;
      this.activeAccountId = null;
      this.activeLabel = null;
      this.pendingManualCodeResolve = null;
      this.pendingManualCodeReject = null;
    }
  }

  async stopFlow(): Promise<void> {
    this.active = false;
    this.activeProvider = null;
    this.activeAccountId = null;
    this.activeLabel = null;
    if (this.pendingManualCodeReject) {
      this.pendingManualCodeReject(new Error('OAuth flow cancelled'));
    }
    this.pendingManualCodeResolve = null;
    this.pendingManualCodeReject = null;
    logger.info('[BrowserOAuth] Flow explicitly stopped');
  }

  submitManualCode(code: string): boolean {
    const value = code.trim();
    if (!value || !this.pendingManualCodeResolve) {
      return false;
    }
    this.pendingManualCodeResolve(value);
    this.pendingManualCodeResolve = null;
    this.pendingManualCodeReject = null;
    return true;
  }

  private async onSuccess(
    providerType: BrowserOAuthProviderType,
    token: GeminiCliOAuthCredentials | OpenAICodexOAuthCredentials,
  ) {
    const tokenAccountId = 'accountId' in token && typeof token.accountId === 'string'
      ? token.accountId
      : providerType;
    const accountId = this.activeAccountId || tokenAccountId;
    const accountLabel = this.activeLabel;
    this.active = false;
    this.activeProvider = null;
    this.activeAccountId = null;
    this.activeLabel = null;
    this.pendingManualCodeResolve = null;
    this.pendingManualCodeReject = null;
    logger.info(`[BrowserOAuth] Successfully completed OAuth for ${providerType}`);

    const providerService = getProviderService();
    const existing = await providerService.getAccount(accountId);
    const isGoogle = providerType === 'google';
    const runtimeProviderId = isGoogle ? GOOGLE_RUNTIME_PROVIDER_ID : OPENAI_RUNTIME_PROVIDER_ID;
    const defaultModel = isGoogle ? GOOGLE_OAUTH_DEFAULT_MODEL : OPENAI_OAUTH_DEFAULT_MODEL;
    const accountLabelDefault = isGoogle ? 'Google Gemini' : 'OpenAI Codex';
    const oauthTokenEmail = 'email' in token && typeof token.email === 'string' ? token.email : undefined;
    const oauthTokenSubject = 'projectId' in token && typeof token.projectId === 'string'
      ? token.projectId
      : ('accountId' in token && typeof token.accountId === 'string' ? token.accountId : undefined);
    const normalizedExistingModel = normalizeBrowserOAuthModel(providerType, existing?.model);
    const normalizedExistingModels = normalizeProviderModelList(
      (existing?.models ?? []).map((model) => normalizeBrowserOAuthModel(providerType, model)),
    );
    const nextModels = normalizedExistingModels.length > 0
      ? normalizedExistingModels
      : [normalizedExistingModel || defaultModel];
    const nextModel = normalizedExistingModel || nextModels[0] || defaultModel;

    const nextAccount = await providerService.createAccount({
      id: accountId,
      vendorId: providerType,
      label: accountLabel || existing?.label || accountLabelDefault,
      authMode: 'oauth_browser',
      baseUrl: existing?.baseUrl,
      apiProtocol: existing?.apiProtocol,
      models: nextModels,
      model: nextModel,
      fallbackModels: existing?.fallbackModels,
      fallbackAccountIds: existing?.fallbackAccountIds,
      enabled: existing?.enabled ?? true,
      isDefault: existing?.isDefault ?? false,
      metadata: {
        ...existing?.metadata,
        email: oauthTokenEmail,
        resourceUrl: runtimeProviderId,
      },
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await getSecretStore().set({
      type: 'oauth',
      accountId,
      accessToken: token.access,
      refreshToken: token.refresh,
      expiresAt: token.expires,
      email: oauthTokenEmail,
      subject: oauthTokenSubject,
    });

    await saveOAuthTokenToOpenClaw(runtimeProviderId, {
      access: token.access,
      refresh: token.refresh,
      expires: token.expires,
      email: oauthTokenEmail,
      projectId: oauthTokenSubject,
    });

    this.emit('oauth:success', { provider: providerType, accountId: nextAccount.id });
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('oauth:success', {
        provider: providerType,
        accountId: nextAccount.id,
        success: true,
      });
    }
  }

  private emitError(message: string) {
    this.emit('oauth:error', { message });
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('oauth:error', { message });
    }
  }
}

export const browserOAuthManager = new BrowserOAuthManager();
