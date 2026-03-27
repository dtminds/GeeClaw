/**
 * Device OAuth Manager
 *
 * Manages Device Code OAuth flows for MiniMax and Qwen providers.
 *
 * The OAuth protocol implementations are fully self-contained in:
 *   - ./minimax-oauth.ts
 *   - ./qwen-oauth.ts
 *
 * This approach:
 * - Avoids depending on OpenClaw's private extension file layout
 * - Survives OpenClaw package upgrades without breakage
 * - Works identically on macOS, Windows, and Linux
 *
 * We provide our own callbacks (openUrl/note/progress) that hook into
 * the Electron IPC system to display UI in the GeeClaw frontend.
 */
import { EventEmitter } from 'events';
import { BrowserWindow, shell } from 'electron';
import { logger } from './logger';
import { getProviderDefaultModel } from './provider-registry';
import { getProviderService } from '../services/providers/provider-service';
import type { ProviderAccount } from '../shared/providers/types';
import {
    loginMiniMaxPortalOAuth,
    type MiniMaxOAuthToken,
    type MiniMaxRegion,
} from './minimax-oauth';
import {
    loginQwenPortalOAuth,
    type QwenOAuthToken,
} from './qwen-oauth';
import { saveOAuthTokenToOpenClaw } from './openclaw-auth';
import { setOpenClawDefaultModelWithOverride } from './openclaw-provider-config';

export type OAuthProviderType = 'minimax-portal' | 'minimax-portal-cn' | 'qwen-portal';
export type { MiniMaxRegion, MiniMaxOAuthToken, QwenOAuthToken };

// ─────────────────────────────────────────────────────────────
// DeviceOAuthManager
// ─────────────────────────────────────────────────────────────

class DeviceOAuthManager extends EventEmitter {
    private activeProvider: OAuthProviderType | null = null;
    private activeAccountId: string | null = null;
    private activeLabel: string | null = null;
    private active: boolean = false;
    private mainWindow: BrowserWindow | null = null;

    setWindow(window: BrowserWindow) {
        this.mainWindow = window;
    }

    async startFlow(
        provider: OAuthProviderType,
        region: MiniMaxRegion = 'global',
        options?: { accountId?: string; label?: string },
    ): Promise<boolean> {
        if (this.active) {
            await this.stopFlow();
        }

        this.active = true;
        this.emit('oauth:start', { provider, accountId: options?.accountId || provider });
        this.activeProvider = provider;
        this.activeAccountId = options?.accountId || provider;
        this.activeLabel = options?.label || null;

        try {
            if (provider === 'minimax-portal' || provider === 'minimax-portal-cn') {
                const actualRegion = provider === 'minimax-portal-cn' ? 'cn' : (region || 'global');
                await this.runMiniMaxFlow(actualRegion, provider);
            } else if (provider === 'qwen-portal') {
                await this.runQwenFlow();
            } else {
                throw new Error(`Unsupported OAuth provider type: ${provider}`);
            }
            return true;
        } catch (error) {
            if (!this.active) {
                // Flow was cancelled — not an error
                return false;
            }
            logger.error(`[DeviceOAuth] Flow error for ${provider}:`, error);
            this.emitError(error instanceof Error ? error.message : String(error));
            this.active = false;
            this.activeProvider = null;
            this.activeAccountId = null;
            this.activeLabel = null;
            return false;
        }
    }

    async stopFlow(): Promise<void> {
        this.active = false;
        this.activeProvider = null;
        this.activeAccountId = null;
        this.activeLabel = null;
        logger.info('[DeviceOAuth] Flow explicitly stopped');
    }

    // ─────────────────────────────────────────────────────────
    // MiniMax flow
    // ─────────────────────────────────────────────────────────

    private async runMiniMaxFlow(region?: MiniMaxRegion, providerType: OAuthProviderType = 'minimax-portal'): Promise<void> {
        const provider = this.activeProvider!;

        const token: MiniMaxOAuthToken = await loginMiniMaxPortalOAuth({
            region,
            openUrl: async (url: string) => {
                logger.info(`[DeviceOAuth] MiniMax opening browser: ${url}`);
                // Open the authorization URL in the system browser
                shell.openExternal(url).catch((err: unknown) =>
                    logger.warn(`[DeviceOAuth] Failed to open browser:`, err)
                );
            },
            note: async (message: string, _title?: string) => {
                if (!this.active) return;
                // The OAuth helper note contains the user_code and verification_uri.
                const { verificationUri, userCode } = this.parseNote(message);
                if (verificationUri && userCode) {
                    this.emitCode({ provider, verificationUri, userCode, expiresIn: 300 });
                } else {
                    logger.info(`[DeviceOAuth] MiniMax note: ${message}`);
                }
            },
            progress: {
                update: (msg: string) => logger.info(`[DeviceOAuth] MiniMax progress: ${msg}`),
                stop: (msg?: string) => logger.info(`[DeviceOAuth] MiniMax progress done: ${msg ?? ''}`),
            },
        });

        if (!this.active) return;

        await this.onSuccess(providerType, {
            access: token.access,
            refresh: token.refresh,
            expires: token.expires,
            // MiniMax returns a per-account resourceUrl as the API base URL
            resourceUrl: token.resourceUrl,
            // Revert back to anthropic-messages
            api: 'anthropic-messages',
            region,
        });
    }

    // ─────────────────────────────────────────────────────────
    // Qwen flow
    // ─────────────────────────────────────────────────────────

    private async runQwenFlow(): Promise<void> {
        const provider = this.activeProvider!;

        const token: QwenOAuthToken = await loginQwenPortalOAuth({
            openUrl: async (url: string) => {
                logger.info(`[DeviceOAuth] Qwen opening browser: ${url}`);
                shell.openExternal(url).catch((err: unknown) =>
                    logger.warn(`[DeviceOAuth] Failed to open browser:`, err)
                );
            },
            note: async (message: string, _title?: string) => {
                if (!this.active) return;
                const { verificationUri, userCode } = this.parseNote(message);
                if (verificationUri && userCode) {
                    this.emitCode({ provider, verificationUri, userCode, expiresIn: 300 });
                } else {
                    logger.info(`[DeviceOAuth] Qwen note: ${message}`);
                }
            },
            progress: {
                update: (msg: string) => logger.info(`[DeviceOAuth] Qwen progress: ${msg}`),
                stop: (msg?: string) => logger.info(`[DeviceOAuth] Qwen progress done: ${msg ?? ''}`),
            },
        });

        if (!this.active) return;

        await this.onSuccess('qwen-portal', {
            access: token.access,
            refresh: token.refresh,
            expires: token.expires,
            // Qwen returns a per-account resourceUrl as the API base URL
            resourceUrl: token.resourceUrl,
            // Qwen uses OpenAI Completions API format
            api: 'openai-completions',
        });
    }

    // ─────────────────────────────────────────────────────────
    // Success handler
    // ─────────────────────────────────────────────────────────

    private async onSuccess(providerType: OAuthProviderType, token: {
        access: string;
        refresh: string;
        expires: number;
        resourceUrl?: string;
        api: 'anthropic-messages' | 'openai-completions';
        region?: MiniMaxRegion;
    }) {
        const accountId = this.activeAccountId || providerType;
        const accountLabel = this.activeLabel;
        this.active = false;
        this.activeProvider = null;
        this.activeAccountId = null;
        this.activeLabel = null;
        logger.info(`[DeviceOAuth] Successfully completed OAuth for ${providerType}`);

        // 1. Write OAuth token to OpenClaw's auth-profiles.json in native OAuth format.
        //    (matches what `openclaw models auth login` → upsertAuthProfile writes).
        //    We save both MiniMax providers to the generic "minimax-portal" profile
        //    so OpenClaw's gateway auto-refresher knows how to find it.
        try {
            const tokenProviderId = providerType.startsWith('minimax-portal') ? 'minimax-portal' : providerType;
            await saveOAuthTokenToOpenClaw(tokenProviderId, {
                access: token.access,
                refresh: token.refresh,
                expires: token.expires,
            });
        } catch (err) {
            logger.warn(`[DeviceOAuth] Failed to save OAuth token to OpenClaw:`, err);
        }

        // 2. Write openclaw.json: set default model + provider config (baseUrl/api/models)
        //    This mirrors what the OpenClaw plugin's configPatch does after CLI login.
        //    The baseUrl comes from token.resourceUrl (per-account URL from the OAuth server)
        //    or falls back to the provider's default public endpoint.
        const defaultBaseUrl = providerType === 'minimax-portal'
            ? 'https://api.minimax.io/anthropic'
            : (providerType === 'minimax-portal-cn' ? 'https://api.minimaxi.com/anthropic' : 'https://portal.qwen.ai/v1');

        let baseUrl = token.resourceUrl || defaultBaseUrl;

        // Ensure baseUrl has a protocol prefix
        if (baseUrl && !baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
            baseUrl = 'https://' + baseUrl;
        }

        // Ensure the base URL ends with /anthropic
        if (providerType.startsWith('minimax-portal') && baseUrl) {
            baseUrl = baseUrl.replace(/\/v1$/, '').replace(/\/anthropic$/, '').replace(/\/$/, '') + '/anthropic';
        } else if (providerType === 'qwen-portal' && baseUrl) {
            // Ensure Qwen API gets /v1 at the end
            if (!baseUrl.endsWith('/v1')) {
                baseUrl = baseUrl.replace(/\/$/, '') + '/v1';
            }
        }

        try {
            const tokenProviderId = providerType.startsWith('minimax-portal') ? 'minimax-portal' : providerType;
            await setOpenClawDefaultModelWithOverride(tokenProviderId, undefined, {
                baseUrl,
                api: token.api,
                // Tells OpenClaw's anthropic adapter to use `Authorization: Bearer` instead of `x-api-key`
                authHeader: providerType.startsWith('minimax-portal') ? true : undefined,
                // OAuth placeholder — tells Gateway to resolve credentials
                // from auth-profiles.json (type: 'oauth') instead of a static API key.
                apiKeyEnv: tokenProviderId === 'minimax-portal' ? 'minimax-oauth' : 'qwen-oauth',
            });
        } catch (err) {
            logger.warn(`[DeviceOAuth] Failed to configure openclaw models:`, err);
        }

        // 3. Save provider account in GeeClaw's own store so both the
        //    provider account registry and the legacy provider config stay aligned.
        const providerService = getProviderService();
        const existing = await providerService.getAccount(accountId);
        const nameMap: Record<OAuthProviderType, string> = {
            'minimax-portal': 'MiniMax (Global)',
            'minimax-portal-cn': 'MiniMax (CN)',
            'qwen-portal': 'Qwen',
        };
        const nextAccount: ProviderAccount = {
            id: accountId,
            vendorId: providerType,
            label: accountLabel || existing?.label || nameMap[providerType as OAuthProviderType] || providerType,
            authMode: 'oauth_device',
            enabled: existing?.enabled ?? true,
            isDefault: existing?.isDefault ?? false,
            baseUrl, // Save the dynamically resolved URL (Global vs CN)
            apiProtocol: existing?.apiProtocol,
            models: existing?.models ?? (existing?.model || getProviderDefaultModel(providerType)
                ? [existing?.model || getProviderDefaultModel(providerType)!]
                : []),
            model: existing?.model || getProviderDefaultModel(providerType),
            fallbackModels: existing?.fallbackModels,
            fallbackAccountIds: existing?.fallbackAccountIds,
            metadata: {
                ...existing?.metadata,
                region: providerType === 'minimax-portal-cn'
                    ? 'cn'
                    : (providerType === 'minimax-portal' ? 'global' : existing?.metadata?.region),
            },
            createdAt: existing?.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        await providerService.createAccount(nextAccount);

        // 4. Emit success internally so the main process can restart the Gateway
        this.emit('oauth:success', { provider: providerType, accountId });

        // 5. Emit success to frontend
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('oauth:success', { provider: providerType, accountId, success: true });
        }
    }


    // ─────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────

    /**
     * Parse user_code and verification_uri from the OAuth helper note.
     *
     * user_code format: mixed-case alphanumeric with underscore, e.g. "dyMj_wOhpK"
     */
    private parseNote(message: string): { verificationUri?: string; userCode?: string } {
        // Primary: extract URL (everything between "Open " and " to")
        const urlMatch = message.match(/Open\s+(https?:\/\/\S+?)\s+to/i);
        const verificationUri = urlMatch?.[1];

        let userCode: string | undefined;

        // Method 1: extract user_code from URL query param (most reliable)
        if (verificationUri) {
            try {
                const parsed = new URL(verificationUri);
                const qp = parsed.searchParams.get('user_code');
                if (qp) userCode = qp;
            } catch {
                // fall through to text-based extraction
            }
        }

        // Method 2: text-based extraction — matches mixed-case alnum + underscore/hyphen codes
        if (!userCode) {
            const codeMatch = message.match(/enter.*?code\s+([A-Za-z0-9][A-Za-z0-9_-]{3,})/i);
            if (codeMatch?.[1]) userCode = codeMatch[1].replace(/\.$/, ''); // strip trailing period
        }

        return { verificationUri, userCode };
    }

    private emitCode(data: {
        provider: string;
        verificationUri: string;
        userCode: string;
        expiresIn: number;
    }) {
        this.emit('oauth:code', data);
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('oauth:code', data);
        }
    }

    private emitError(message: string) {
        this.emit('oauth:error', { message });
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('oauth:error', { message });
        }
    }
}

export const deviceOAuthManager = new DeviceOAuthManager();
