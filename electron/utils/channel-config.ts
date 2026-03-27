/**
 * Channel Configuration Utilities
 * Manages channel configuration in OpenClaw config files.
 *
 * All file I/O uses async fs/promises to avoid blocking the main thread.
 */
import { access, mkdir, readFile, writeFile, readdir, stat, rm } from 'fs/promises';
import { constants } from 'fs';
import { join } from 'path';
import { getGeeClawAgentStore } from "../services/agents/store-instance";

import { getGeeClawChannelStore } from "../services/channels/store-instance";
import { isDeepStrictEqual } from 'node:util';
import { getOpenClawResolvedDir, getOpenClawConfigDir } from './paths';
import { buildManagedOpenClawArgs } from './openclaw-managed-profile';
import { reconcileBundledPluginLoadPaths } from './plugin-install';
import * as logger from './logger';
import { proxyAwareFetch } from './proxy-fetch';
import {
    clearAllWeixinState,
    deleteWeixinAccountState,
    listWeixinAccountIds,
    WEIXIN_CHANNEL_ID,
} from './weixin-state';

const OPENCLAW_DIR = getOpenClawConfigDir();
const CONFIG_FILE = join(OPENCLAW_DIR, 'openclaw.json');
const DINGTALK_PLUGIN_ID = 'dingtalk';
const WECOM_PLUGIN_ID = 'wecom-openclaw-plugin';
const WEIXIN_PLUGIN_ID = WEIXIN_CHANNEL_ID;
const FEISHU_PLUGIN_ID = 'openclaw-lark';
const QQ_PLUGIN_ID = 'openclaw-qqbot';
const DEFAULT_ACCOUNT_ID = 'default';
const CHANNEL_TOP_LEVEL_KEYS_TO_KEEP = new Set(['enabled', 'defaultAccount', 'accounts']);
const MANAGED_PLUGIN_ENTRY_IDS = [DINGTALK_PLUGIN_ID, WECOM_PLUGIN_ID, WEIXIN_PLUGIN_ID, FEISHU_PLUGIN_ID, QQ_PLUGIN_ID];

// Channels that are managed as plugins (config goes under plugins.entries, not channels)
const PLUGIN_CHANNELS: string[] = [];
const LEGACY_BUILTIN_CHANNEL_PLUGIN_IDS = new Set(['whatsapp']);
const BUILTIN_CHANNEL_IDS = new Set([
    'discord',
    'telegram',
    'whatsapp',
    'slack',
    'signal',
    'imessage',
    'matrix',
    'line',
    'msteams',
    'googlechat',
    'mattermost',
]);

const CHANNEL_PLUGIN_INSTALLS: Record<string, { pluginId: string; installDir: string }> = {
    dingtalk: { pluginId: DINGTALK_PLUGIN_ID, installDir: 'dingtalk' },
    wecom: { pluginId: WECOM_PLUGIN_ID, installDir: WECOM_PLUGIN_ID },
    [WEIXIN_CHANNEL_ID]: { pluginId: WEIXIN_PLUGIN_ID, installDir: WEIXIN_PLUGIN_ID },
    feishu: { pluginId: FEISHU_PLUGIN_ID, installDir: FEISHU_PLUGIN_ID },
    qqbot: { pluginId: QQ_PLUGIN_ID, installDir: QQ_PLUGIN_ID },
};

// ── Helpers ──────────────────────────────────────────────────────

async function fileExists(p: string): Promise<boolean> {
    try { await access(p, constants.F_OK); return true; } catch { return false; }
}

function removePluginRegistration(currentConfig: OpenClawConfig, pluginId: string): boolean {
    if (!currentConfig.plugins) {
        return false;
    }

    let modified = false;

    if (Array.isArray(currentConfig.plugins.allow)) {
        const nextAllow = currentConfig.plugins.allow.filter((entry) => entry !== pluginId);
        if (nextAllow.length !== currentConfig.plugins.allow.length) {
            currentConfig.plugins.allow = nextAllow;
            modified = true;
        }
        if (nextAllow.length === 0) {
            delete currentConfig.plugins.allow;
        }
    }

    if (currentConfig.plugins.entries?.[pluginId]) {
        delete currentConfig.plugins.entries[pluginId];
        modified = true;
        if (Object.keys(currentConfig.plugins.entries).length === 0) {
            delete currentConfig.plugins.entries;
        }
    }

    if (
        currentConfig.plugins.enabled !== undefined
        && !currentConfig.plugins.allow?.length
        && !currentConfig.plugins.entries
    ) {
        delete currentConfig.plugins.enabled;
        modified = true;
    }

    if (Object.keys(currentConfig.plugins).length === 0) {
        delete currentConfig.plugins;
        modified = true;
    }

    return modified;
}

function channelHasConfiguredAccounts(channelSection: ChannelConfigData | undefined): boolean {
    if (!channelSection || typeof channelSection !== 'object') {
        return false;
    }

    const accounts = channelSection.accounts as Record<string, ChannelConfigData> | undefined;
    if (accounts && typeof accounts === 'object') {
        return Object.keys(accounts).length > 0;
    }

    return Object.keys(channelSection).some((key) => !CHANNEL_TOP_LEVEL_KEYS_TO_KEEP.has(key));
}

function ensurePluginRegistration(currentConfig: OpenClawConfig, pluginId: string): void {
    if (!currentConfig.plugins) {
        currentConfig.plugins = {
            allow: [pluginId],
            enabled: true,
            entries: {
                [pluginId]: { enabled: true },
            },
        };
        return;
    }

    currentConfig.plugins.enabled = true;
    const allow = Array.isArray(currentConfig.plugins.allow)
        ? currentConfig.plugins.allow as string[]
        : [];
    if (!allow.includes(pluginId)) {
        currentConfig.plugins.allow = [...allow, pluginId];
    }

    if (!currentConfig.plugins.entries) {
        currentConfig.plugins.entries = {};
    }
    if (!currentConfig.plugins.entries[pluginId]) {
        currentConfig.plugins.entries[pluginId] = {};
    }
    currentConfig.plugins.entries[pluginId].enabled = true;
}

function cleanupLegacyBuiltInChannelPluginRegistration(
    currentConfig: OpenClawConfig,
    channelType: string,
): boolean {
    if (!LEGACY_BUILTIN_CHANNEL_PLUGIN_IDS.has(channelType)) {
        return false;
    }

    return removePluginRegistration(currentConfig, channelType);
}

function isBuiltinChannelId(channelId: string): boolean {
    return BUILTIN_CHANNEL_IDS.has(channelId);
}

function listConfiguredBuiltinChannels(
    currentConfig: OpenClawConfig,
    additionalChannelIds: string[] = [],
): string[] {
    const configured = new Set<string>();
    const channels = currentConfig.channels ?? {};

    for (const [channelId, section] of Object.entries(channels)) {
        if (!isBuiltinChannelId(channelId)) continue;
        if (!section || section.enabled === false) continue;
        if (channelHasConfiguredAccounts(section) || Object.keys(section).length > 0) {
            configured.add(channelId);
        }
    }

    for (const channelId of additionalChannelIds) {
        if (isBuiltinChannelId(channelId)) {
            configured.add(channelId);
        }
    }

    return Array.from(configured);
}

function syncBuiltinChannelsWithPluginAllowlist(
    currentConfig: OpenClawConfig,
    additionalBuiltinChannelIds: string[] = [],
): void {
    const plugins = currentConfig.plugins;
    if (!plugins || !Array.isArray(plugins.allow)) {
        return;
    }

    const configuredBuiltins = new Set(listConfiguredBuiltinChannels(currentConfig, additionalBuiltinChannelIds));
    const existingAllow = plugins.allow as string[];
    const externalPluginIds = existingAllow.filter((pluginId) => !isBuiltinChannelId(pluginId));

    let nextAllow = [...externalPluginIds];
    if (externalPluginIds.length > 0) {
        nextAllow = [
            ...nextAllow,
            ...Array.from(configuredBuiltins).filter((channelId) => !nextAllow.includes(channelId)),
        ];
    }

    if (nextAllow.length > 0) {
        plugins.allow = nextAllow;
    } else {
        delete plugins.allow;
    }
}

// ── Types ────────────────────────────────────────────────────────

export interface ChannelConfigData {
    enabled?: boolean;
    [key: string]: unknown;
}

export interface ConfiguredChannelAccountSummary {
    accountId: string;
    enabled: boolean;
    isDefault: boolean;
}

export interface ConfiguredChannelSummary {
    defaultAccount: string;
    accounts: ConfiguredChannelAccountSummary[];
}

export interface PluginsConfig {
    entries?: Record<string, ChannelConfigData>;
    allow?: string[];
    installs?: Record<string, PluginInstallRecord>;
    enabled?: boolean;
    [key: string]: unknown;
}

export interface PluginInstallRecord {
    source: 'npm' | 'archive' | 'path';
    spec?: string;
    sourcePath?: string;
    installPath?: string;
    version?: string;
    resolvedName?: string;
    resolvedVersion?: string;
    resolvedSpec?: string;
    integrity?: string;
    shasum?: string;
    resolvedAt?: string;
    installedAt?: string;
}

export interface OpenClawConfig {
    channels?: Record<string, ChannelConfigData>;
    plugins?: PluginsConfig;
    commands?: Record<string, unknown>;
    session?: Record<string, unknown>;
    [key: string]: unknown;
}

export interface WriteOpenClawConfigOptions {
    syncStores?: boolean | {
        channels?: boolean;
        agents?: boolean;
    };
}

// ── Config I/O ───────────────────────────────────────────────────

async function ensureConfigDir(): Promise<void> {
    if (!(await fileExists(OPENCLAW_DIR))) {
        await mkdir(OPENCLAW_DIR, { recursive: true });
    }
}

export async function readOpenClawConfig(): Promise<OpenClawConfig> {
    await ensureConfigDir();

    if (!(await fileExists(CONFIG_FILE))) {
        return {};
    }

    try {
        const content = await readFile(CONFIG_FILE, 'utf-8');
        return JSON.parse(content) as OpenClawConfig;
    } catch (error) {
        logger.error('Failed to read OpenClaw config', error);
        console.error('Failed to read OpenClaw config:', error);
        return {};
    }
}


function resolveStoreSyncTargets(options?: WriteOpenClawConfigOptions): {
    channels: boolean;
    agents: boolean;
} {
    const syncStores = options?.syncStores ?? true;

    if (typeof syncStores === 'boolean') {
        return {
            channels: syncStores,
            agents: syncStores,
        };
    }

    return {
        channels: Boolean(syncStores.channels),
        agents: Boolean(syncStores.agents),
    };
}

export async function writeOpenClawConfig(
    config: OpenClawConfig,
    options?: WriteOpenClawConfigOptions,
): Promise<void> {
    await ensureConfigDir();

    try {
        reconcileManagedChannelPluginConfig(config);
        const bundledPluginReconcile = reconcileBundledPluginLoadPaths(config);
        for (const warning of bundledPluginReconcile.warnings) {
            logger.warn(`[plugin] ${warning}`);
        }

        // Enable graceful in-process reload authorization for SIGUSR1 flows.
        const commands =
            config.commands && typeof config.commands === 'object'
                ? { ...(config.commands as Record<string, unknown>) }
                : {};
        commands.restart = true;
        config.commands = commands;

        const syncTargets = resolveStoreSyncTargets(options);

        if (syncTargets.channels) {
            // Save channel config to persistent store as source of truth
            const channelStore = await getGeeClawChannelStore();
            if (config.channels) {
                channelStore.set('channels', JSON.parse(JSON.stringify(config.channels)));
            } else {
                channelStore.delete('channels');
            }

            const pluginsToSave: Record<string, unknown> = {};
            if (config.plugins?.entries) {
                for (const pluginId of MANAGED_PLUGIN_ENTRY_IDS) {
                    if (config.plugins.entries[pluginId]) {
                        pluginsToSave[pluginId] = config.plugins.entries[pluginId];
                    }
                }
            }

            if (Object.keys(pluginsToSave).length > 0) {
                channelStore.set('plugins', JSON.parse(JSON.stringify(pluginsToSave)));
            } else {
                channelStore.delete('plugins');
            }
        }

        if (syncTargets.agents) {
            // Save agent config to persistent store as source of truth
            const agentStore = await getGeeClawAgentStore();
            if (config.agents) {
                agentStore.set('agents', JSON.parse(JSON.stringify(config.agents)));
            } else {
                agentStore.delete('agents');
            }

            if (config.bindings && Array.isArray(config.bindings)) {
                agentStore.set('bindings', JSON.parse(JSON.stringify(config.bindings)));
            } else {
                agentStore.delete('bindings');
            }
        }

        await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
    } catch (error) {
        logger.error('Failed to write OpenClaw config', error);
        console.error('Failed to write OpenClaw config:', error);
        throw error;
    }
}

// ── Channel operations ───────────────────────────────────────────

export function ensurePluginAllowlist(currentConfig: OpenClawConfig, channelType: string): void {
    if (PLUGIN_CHANNELS.includes(channelType)) {
        ensurePluginRegistration(currentConfig, channelType);
        return;
    }

    const ensurePlugins = (): PluginsConfig => {
        if (!currentConfig.plugins) {
            currentConfig.plugins = {};
        }
        currentConfig.plugins.enabled = true;
        return currentConfig.plugins;
    };

    if (channelType === 'dingtalk') {
        const plugins = ensurePlugins();
        const allow = Array.isArray(plugins.allow) ? plugins.allow : [];
        if (!allow.includes(DINGTALK_PLUGIN_ID)) {
            plugins.allow = [...allow, DINGTALK_PLUGIN_ID];
        }
        setManagedChannelPluginEntryEnabled(currentConfig, channelType, true);
        return;
    }

    if (channelType === 'wecom') {
        const plugins = ensurePlugins();
        const allow = Array.isArray(plugins.allow) ? plugins.allow : [];
        const normalizedAllow = allow.filter((pluginId) => pluginId !== 'wecom');
        if (!normalizedAllow.includes(WECOM_PLUGIN_ID)) {
            plugins.allow = [...normalizedAllow, WECOM_PLUGIN_ID];
        } else if (normalizedAllow.length !== allow.length) {
            plugins.allow = normalizedAllow;
        }
        setManagedChannelPluginEntryEnabled(currentConfig, channelType, true);
        return;
    }

    if (channelType === WEIXIN_CHANNEL_ID) {
        const plugins = ensurePlugins();
        const allow = Array.isArray(plugins.allow) ? plugins.allow : [];
        if (!allow.includes(WEIXIN_PLUGIN_ID)) {
            plugins.allow = [...allow, WEIXIN_PLUGIN_ID];
        }
        setManagedChannelPluginEntryEnabled(currentConfig, channelType, true);
        return;
    }

    if (channelType === 'feishu') {
        const plugins = ensurePlugins();
        const allow = Array.isArray(plugins.allow) ? plugins.allow : [];
        const normalizedAllow = allow.filter((pluginId) => pluginId !== 'feishu');
        if (!normalizedAllow.includes(FEISHU_PLUGIN_ID)) {
            plugins.allow = [...normalizedAllow, FEISHU_PLUGIN_ID];
        } else if (normalizedAllow.length !== allow.length) {
            plugins.allow = normalizedAllow;
        }
        if (!plugins.entries) {
            plugins.entries = {};
        }
        plugins.entries.feishu = {
            ...(plugins.entries.feishu && typeof plugins.entries.feishu === 'object'
                ? plugins.entries.feishu
                : {}),
            enabled: false,
        };
        plugins.entries[FEISHU_PLUGIN_ID] = {
            ...plugins.entries[FEISHU_PLUGIN_ID],
            enabled: true,
        };
        return;
    }

    if (channelType === 'qqbot') {
        const plugins = ensurePlugins();
        const allow = Array.isArray(plugins.allow) ? plugins.allow : [];
        if (!allow.includes(QQ_PLUGIN_ID)) {
            plugins.allow = [...allow, QQ_PLUGIN_ID];
        }
        setManagedChannelPluginEntryEnabled(currentConfig, channelType, true);
    }
}

function setManagedChannelPluginEntryEnabled(
    currentConfig: OpenClawConfig,
    channelType: string,
    enabled: boolean,
): void {
    const pluginInstall = CHANNEL_PLUGIN_INSTALLS[channelType];
    if (!pluginInstall) {
        return;
    }

    if (!currentConfig.plugins) {
        currentConfig.plugins = {};
    }
    if (!currentConfig.plugins.entries) {
        currentConfig.plugins.entries = {};
    }

    currentConfig.plugins.entries[pluginInstall.pluginId] = {
        ...(currentConfig.plugins.entries[pluginInstall.pluginId]
            && typeof currentConfig.plugins.entries[pluginInstall.pluginId] === 'object'
            ? currentConfig.plugins.entries[pluginInstall.pluginId]
            : {}),
        enabled,
    };

    if (channelType === 'feishu') {
        currentConfig.plugins.entries.feishu = {
            ...(currentConfig.plugins.entries.feishu && typeof currentConfig.plugins.entries.feishu === 'object'
                ? currentConfig.plugins.entries.feishu
                : {}),
            enabled: false,
        };
    }
}

function hasLegacyManagedPluginEntryEnabled(currentConfig: OpenClawConfig, channelType: string): boolean {
    const pluginEntries = currentConfig.plugins?.entries;
    if (!pluginEntries || typeof pluginEntries !== 'object') {
        return false;
    }

    const pluginInstall = CHANNEL_PLUGIN_INSTALLS[channelType];
    if (!pluginInstall) {
        return false;
    }

    const candidateEntryIds = [pluginInstall.pluginId];
    if (channelType === 'wecom') {
        candidateEntryIds.push('wecom');
    }
    if (channelType === 'feishu') {
        candidateEntryIds.push('feishu');
    }

    return candidateEntryIds.some((entryId) => {
        const entry = pluginEntries[entryId];
        return Boolean(entry && typeof entry === 'object' && (entry as ChannelConfigData).enabled !== false);
    });
}

function isChannelEnabledForPluginAllowlist(currentConfig: OpenClawConfig, channelType: string): boolean {
    const channelSection = currentConfig.channels?.[channelType];
    if (!channelSection || typeof channelSection !== 'object') {
        return hasLegacyManagedPluginEntryEnabled(currentConfig, channelType);
    }

    if (channelSection.enabled === false) {
        return false;
    }

    const accounts = channelSection.accounts as Record<string, ChannelConfigData> | undefined;
    if (accounts && typeof accounts === 'object' && Object.keys(accounts).length > 0) {
        return Object.values(accounts).some((account) => account?.enabled !== false);
    }

    return true;
}

export function reconcileManagedChannelPluginConfig(currentConfig: OpenClawConfig): void {
    const managedChannelTypes = Object.keys(CHANNEL_PLUGIN_INSTALLS);
    const desiredPluginIds: string[] = [];

    for (const channelType of managedChannelTypes) {
        if (!isChannelEnabledForPluginAllowlist(currentConfig, channelType)) {
            setManagedChannelPluginEntryEnabled(currentConfig, channelType, false);
            continue;
        }

        ensurePluginAllowlist(currentConfig, channelType);
        desiredPluginIds.push(CHANNEL_PLUGIN_INSTALLS[channelType].pluginId);
    }

    const existingAllow = Array.isArray(currentConfig.plugins?.allow)
        ? currentConfig.plugins.allow.filter((pluginId): pluginId is string => typeof pluginId === 'string')
        : [];

    const managedPluginIds = new Set<string>();
    for (const channelType of managedChannelTypes) {
        managedPluginIds.add(CHANNEL_PLUGIN_INSTALLS[channelType].pluginId);
    }

    const nextAllow = existingAllow.filter((pluginId) => !managedPluginIds.has(pluginId));
    for (const pluginId of desiredPluginIds) {
        if (!nextAllow.includes(pluginId)) {
            nextAllow.push(pluginId);
        }
    }

    if (nextAllow.length > 0) {
        if (!currentConfig.plugins) {
            currentConfig.plugins = {};
        }
        currentConfig.plugins.enabled = true;
        currentConfig.plugins.allow = nextAllow;
    } else if (currentConfig.plugins?.allow) {
        delete currentConfig.plugins.allow;
    }

    syncBuiltinChannelsWithPluginAllowlist(currentConfig);
}

function transformChannelConfig(
    channelType: string,
    config: ChannelConfigData,
    existingConfig: ChannelConfigData = {},
): ChannelConfigData {
    let transformedConfig: ChannelConfigData = { ...config };

    // Special handling for Discord: convert guildId/channelId to complete structure
    if (channelType === 'discord') {
        const { guildId, channelId, ...restConfig } = config;
        transformedConfig = { ...restConfig };

        transformedConfig.groupPolicy = 'allowlist';
        transformedConfig.dm = { enabled: false };
        transformedConfig.retry = {
            attempts: 3,
            minDelayMs: 500,
            maxDelayMs: 30000,
            jitter: 0.1,
        };

        if (guildId && typeof guildId === 'string' && guildId.trim()) {
            const guildConfig: Record<string, unknown> = {
                users: ['*'],
                requireMention: true,
            };

            if (channelId && typeof channelId === 'string' && channelId.trim()) {
                guildConfig.channels = {
                    [channelId.trim()]: { allow: true, requireMention: true },
                };
            } else {
                guildConfig.channels = {
                    '*': { allow: true, requireMention: true },
                };
            }

            transformedConfig.guilds = {
                [guildId.trim()]: guildConfig,
            };
        }
    }

    // Special handling for Telegram: convert allowedUsers string to allowlist array
    if (channelType === 'telegram') {
        const { allowedUsers, ...restConfig } = config;
        transformedConfig = { ...restConfig };

        if (allowedUsers && typeof allowedUsers === 'string') {
            const users = allowedUsers
                .split(',')
                .map((user) => user.trim())
                .filter((user) => user.length > 0);

            if (users.length > 0) {
                transformedConfig.allowFrom = users;
            }
        }
    }

    // Special handling for Feishu / WeCom: default to open DM policy with wildcard allowlist
    if (channelType === 'feishu' || channelType === 'wecom') {
        const existingDmPolicy = existingConfig.dmPolicy === 'pairing' ? 'open' : existingConfig.dmPolicy;
        transformedConfig.dmPolicy = transformedConfig.dmPolicy ?? existingDmPolicy ?? 'open';

        let allowFrom = (transformedConfig.allowFrom ?? existingConfig.allowFrom ?? ['*']) as string[];
        if (!Array.isArray(allowFrom)) {
            allowFrom = [allowFrom] as string[];
        }

        if (transformedConfig.dmPolicy === 'open' && !allowFrom.includes('*')) {
            allowFrom = [...allowFrom, '*'];
        }

        transformedConfig.allowFrom = allowFrom;
    }

    return transformedConfig;
}

function resolveAccountConfig(
    channelSection: ChannelConfigData | undefined,
    accountId: string,
): ChannelConfigData {
    if (!channelSection) return {};
    const accounts = channelSection.accounts as Record<string, ChannelConfigData> | undefined;
    return accounts?.[accountId] ?? {};
}

function getLegacyChannelPayload(channelSection: ChannelConfigData): ChannelConfigData {
    const payload: ChannelConfigData = {};
    for (const [key, value] of Object.entries(channelSection)) {
        if (CHANNEL_TOP_LEVEL_KEYS_TO_KEEP.has(key)) continue;
        payload[key] = value;
    }
    return payload;
}

function getComparableAccountPayload(accountConfig: ChannelConfigData): ChannelConfigData {
    const comparablePayload: ChannelConfigData = {};
    for (const [key, value] of Object.entries(accountConfig)) {
        if (key === 'enabled') continue;
        comparablePayload[key] = value;
    }
    return comparablePayload;
}

function findMirroredAccountId(
    legacyPayload: ChannelConfigData,
    accounts: Record<string, ChannelConfigData>,
    configuredDefault?: string,
): string | undefined {
    const orderedAccountIds = [
        ...(configuredDefault && accounts[configuredDefault] ? [configuredDefault] : []),
        ...Object.keys(accounts).filter((accountId) => accountId !== configuredDefault),
    ];

    return orderedAccountIds.find((accountId) => (
        isDeepStrictEqual(getComparableAccountPayload(accounts[accountId] ?? {}), legacyPayload)
    ));
}

function syncTopLevelFromDefaultAccount(
    channelSection: ChannelConfigData,
    defaultAccountId: string,
): void {
    for (const key of Object.keys(channelSection)) {
        if (CHANNEL_TOP_LEVEL_KEYS_TO_KEEP.has(key)) continue;
        delete channelSection[key];
    }

    const accounts = channelSection.accounts as Record<string, ChannelConfigData> | undefined;
    const defaultAccount = accounts?.[defaultAccountId];
    if (!defaultAccount || typeof defaultAccount !== 'object') {
        return;
    }

    for (const [key, value] of Object.entries(defaultAccount)) {
        channelSection[key] = value;
    }
}

function getResolvedDefaultAccountId(channelSection: ChannelConfigData): string {
    migrateLegacyChannelConfigToAccounts(channelSection, DEFAULT_ACCOUNT_ID);
    const accounts = channelSection.accounts as Record<string, ChannelConfigData> | undefined;
    const configuredDefault =
        typeof channelSection.defaultAccount === 'string' && channelSection.defaultAccount.trim()
            ? channelSection.defaultAccount.trim()
            : undefined;

    if (configuredDefault && accounts?.[configuredDefault]) {
        return configuredDefault;
    }

    if (accounts?.[DEFAULT_ACCOUNT_ID]) {
        channelSection.defaultAccount = DEFAULT_ACCOUNT_ID;
        return DEFAULT_ACCOUNT_ID;
    }

    const firstAccountId = accounts ? Object.keys(accounts).find(Boolean) : undefined;
    if (firstAccountId) {
        channelSection.defaultAccount = firstAccountId;
        return firstAccountId;
    }

    channelSection.defaultAccount = DEFAULT_ACCOUNT_ID;
    return DEFAULT_ACCOUNT_ID;
}

function migrateLegacyChannelConfigToAccounts(
    channelSection: ChannelConfigData,
    defaultAccountId: string = DEFAULT_ACCOUNT_ID,
): void {
    const legacyPayload = getLegacyChannelPayload(channelSection);
    const legacyKeys = Object.keys(legacyPayload);
    const hasAccounts =
        Boolean(channelSection.accounts) &&
        typeof channelSection.accounts === 'object' &&
        Object.keys(channelSection.accounts as Record<string, ChannelConfigData>).length > 0;

    if (legacyKeys.length === 0) {
        if (hasAccounts && typeof channelSection.defaultAccount !== 'string') {
            channelSection.defaultAccount = defaultAccountId;
        }
        return;
    }

    if (!channelSection.accounts || typeof channelSection.accounts !== 'object') {
        channelSection.accounts = {};
    }
    const accounts = channelSection.accounts as Record<string, ChannelConfigData>;
    const configuredDefault =
        typeof channelSection.defaultAccount === 'string' && channelSection.defaultAccount.trim()
            ? channelSection.defaultAccount.trim()
            : undefined;
    const mirroredAccountId = hasAccounts
        ? findMirroredAccountId(legacyPayload, accounts, configuredDefault)
        : undefined;
    const targetAccountId =
        (configuredDefault && accounts[configuredDefault] ? configuredDefault : undefined)
        ?? mirroredAccountId
        ?? (Object.keys(accounts).length === 1 ? Object.keys(accounts)[0] : undefined);

    if (targetAccountId) {
        accounts[targetAccountId] = {
            ...(channelSection.enabled !== undefined ? { enabled: channelSection.enabled } : {}),
            ...legacyPayload,
            ...accounts[targetAccountId],
        };

        channelSection.defaultAccount = configuredDefault ?? targetAccountId;

        for (const key of legacyKeys) {
            delete channelSection[key];
        }
        return;
    }

    const existingDefaultAccount = accounts[defaultAccountId] ?? {};

    accounts[defaultAccountId] = {
        ...(channelSection.enabled !== undefined ? { enabled: channelSection.enabled } : {}),
        ...legacyPayload,
        ...existingDefaultAccount,
    };

    channelSection.defaultAccount =
        typeof channelSection.defaultAccount === 'string' && channelSection.defaultAccount.trim()
            ? channelSection.defaultAccount
            : defaultAccountId;

    for (const key of legacyKeys) {
        delete channelSection[key];
    }
}

export async function saveChannelConfig(
    channelType: string,
    config: ChannelConfigData,
    accountId?: string,
): Promise<void> {
    const currentConfig = await readOpenClawConfig();
    const resolvedAccountId = accountId || DEFAULT_ACCOUNT_ID;
    cleanupLegacyBuiltInChannelPluginRegistration(currentConfig, channelType);

    // Plugin-based channels (e.g. WhatsApp) go under plugins.entries, not channels
    if (PLUGIN_CHANNELS.includes(channelType)) {
        ensurePluginRegistration(currentConfig, channelType);
        currentConfig.plugins!.entries![channelType] = {
            ...currentConfig.plugins!.entries![channelType],
            enabled: config.enabled ?? true,
        };
        await writeOpenClawConfig(currentConfig);
        logger.info('Plugin channel config saved', {
            channelType,
            configFile: CONFIG_FILE,
            path: `plugins.entries.${channelType}`,
        });
        console.log(`Saved plugin channel config for ${channelType}`);
        return;
    }

    if (!currentConfig.channels) {
        currentConfig.channels = {};
    }
    if (!currentConfig.channels[channelType]) {
        currentConfig.channels[channelType] = {};
    }

    const channelSection = currentConfig.channels[channelType];
    migrateLegacyChannelConfigToAccounts(channelSection, DEFAULT_ACCOUNT_ID);
    const existingAccountConfig = resolveAccountConfig(channelSection, resolvedAccountId);
    const transformedConfig = transformChannelConfig(channelType, config, existingAccountConfig);

    if (!channelSection.accounts || typeof channelSection.accounts !== 'object') {
        channelSection.accounts = {};
    }
    const accounts = channelSection.accounts as Record<string, ChannelConfigData>;
    const previousAccountIds = Object.keys(accounts);
    channelSection.defaultAccount = getResolvedDefaultAccountId(channelSection);
    accounts[resolvedAccountId] = {
        ...accounts[resolvedAccountId],
        ...transformedConfig,
        enabled: transformedConfig.enabled ?? true,
    };

    if (previousAccountIds.length === 0 || !accounts[channelSection.defaultAccount]) {
        channelSection.defaultAccount = resolvedAccountId;
    }

    // Mirror the effective default-account credentials back to top-level so
    // upstream channel plugins can discover them without reading accounts.*.
    syncTopLevelFromDefaultAccount(channelSection, channelSection.defaultAccount);

    await writeOpenClawConfig(currentConfig);
    logger.info('Channel config saved', {
        channelType,
        accountId: resolvedAccountId,
        configFile: CONFIG_FILE,
        rawKeys: Object.keys(config),
        transformedKeys: Object.keys(transformedConfig),
    });
    console.log(`Saved channel config for ${channelType} account ${resolvedAccountId}`);
}

export async function getChannelConfig(channelType: string, accountId?: string): Promise<ChannelConfigData | undefined> {
    const config = await readOpenClawConfig();
    const channelSection = config.channels?.[channelType];
    if (!channelSection) return undefined;

    const resolvedAccountId = accountId || getResolvedDefaultAccountId(channelSection);
    const accounts = channelSection.accounts as Record<string, ChannelConfigData> | undefined;
    if (accounts?.[resolvedAccountId]) {
        return accounts[resolvedAccountId];
    }

    if (!accounts || Object.keys(accounts).length === 0) {
        return channelSection;
    }

    return undefined;
}

function extractFormValues(channelType: string, saved: ChannelConfigData): Record<string, string> {
    const values: Record<string, string> = {};

    if (channelType === 'discord') {
        if (saved.token && typeof saved.token === 'string') {
            values.token = saved.token;
        }
        const guilds = saved.guilds as Record<string, Record<string, unknown>> | undefined;
        if (guilds) {
            const guildIds = Object.keys(guilds);
            if (guildIds.length > 0) {
                values.guildId = guildIds[0];
                const guildConfig = guilds[guildIds[0]];
                const channels = guildConfig?.channels as Record<string, unknown> | undefined;
                if (channels) {
                    const channelIds = Object.keys(channels).filter((id) => id !== '*');
                    if (channelIds.length > 0) {
                        values.channelId = channelIds[0];
                    }
                }
            }
        }
    } else if (channelType === 'telegram') {
        if (Array.isArray(saved.allowFrom)) {
            values.allowedUsers = saved.allowFrom.join(', ');
        }
        for (const [key, value] of Object.entries(saved)) {
            if (typeof value === 'string' && key !== 'enabled') {
                values[key] = value;
            }
        }
    } else {
        for (const [key, value] of Object.entries(saved)) {
            if (typeof value === 'string' && key !== 'enabled') {
                values[key] = value;
            }
        }
    }

    return values;
}

export async function getChannelFormValues(channelType: string, accountId?: string): Promise<Record<string, string> | undefined> {
    const saved = await getChannelConfig(channelType, accountId);
    if (!saved) return undefined;

    const values = extractFormValues(channelType, saved);
    return Object.keys(values).length > 0 ? values : undefined;
}

export async function deleteChannelAccountConfig(channelType: string, accountId: string): Promise<void> {
    const currentConfig = await readOpenClawConfig();
    const channelSection = currentConfig.channels?.[channelType];
    if (!channelSection) {
        if (channelType === WEIXIN_CHANNEL_ID) {
            await deleteWeixinAccountState(accountId);
        }
        return;
    }

    migrateLegacyChannelConfigToAccounts(channelSection, DEFAULT_ACCOUNT_ID);
    const defaultAccountId = getResolvedDefaultAccountId(channelSection);
    if (accountId === defaultAccountId) {
        throw new Error(`Cannot delete default account "${accountId}" from ${channelType}`);
    }

    const accounts = channelSection.accounts as Record<string, ChannelConfigData> | undefined;
    if (!accounts?.[accountId]) return;

    delete accounts[accountId];

    if (Object.keys(accounts).length === 0) {
        delete currentConfig.channels![channelType];
    } else {
        syncTopLevelFromDefaultAccount(channelSection, getResolvedDefaultAccountId(channelSection));
    }

    if (channelType === WEIXIN_CHANNEL_ID) {
        await deleteWeixinAccountState(accountId);
    }

    await writeOpenClawConfig(currentConfig);
    logger.info('Deleted channel account config', { channelType, accountId });
    console.log(`Deleted channel account config for ${channelType}/${accountId}`);
}

export async function setDefaultChannelAccount(channelType: string, accountId: string): Promise<void> {
    const currentConfig = await readOpenClawConfig();
    const channelSection = currentConfig.channels?.[channelType];
    if (!channelSection) {
        throw new Error(`Channel "${channelType}" is not configured`);
    }

    migrateLegacyChannelConfigToAccounts(channelSection, DEFAULT_ACCOUNT_ID);
    const accounts = channelSection.accounts as Record<string, ChannelConfigData> | undefined;
    if (!accounts?.[accountId]) {
        throw new Error(`Account "${accountId}" is not configured for ${channelType}`);
    }

    channelSection.defaultAccount = accountId;
    syncTopLevelFromDefaultAccount(channelSection, accountId);

    await writeOpenClawConfig(currentConfig);
    logger.info('Updated default channel account', { channelType, accountId });
}

export async function deleteChannelConfig(channelType: string): Promise<void> {
    const currentConfig = await readOpenClawConfig();
    const cleanedLegacyBuiltinPlugin = cleanupLegacyBuiltInChannelPluginRegistration(currentConfig, channelType);
    let modified = cleanedLegacyBuiltinPlugin;

    if (currentConfig.channels?.[channelType]) {
        delete currentConfig.channels[channelType];
        modified = true;
    } else if (PLUGIN_CHANNELS.includes(channelType)) {
        if (currentConfig.plugins?.entries?.[channelType]) {
            delete currentConfig.plugins.entries[channelType];
            if (Object.keys(currentConfig.plugins.entries).length === 0) {
                delete currentConfig.plugins.entries;
            }
            if (currentConfig.plugins && Object.keys(currentConfig.plugins).length === 0) {
                delete currentConfig.plugins;
            }
            modified = true;
        }
    }

    if (modified) {
        await writeOpenClawConfig(currentConfig);
        console.log(`Deleted channel config for ${channelType}`);
    }

    // Special handling for WhatsApp credentials
    if (channelType === 'whatsapp') {
        try {
            const whatsappDir = join(getOpenClawConfigDir(), 'credentials', 'whatsapp');
            if (await fileExists(whatsappDir)) {
                await rm(whatsappDir, { recursive: true, force: true });
                console.log('Deleted WhatsApp credentials directory');
            }
        } catch (error) {
            console.error('Failed to delete WhatsApp credentials:', error);
        }
    }

    if (channelType === WEIXIN_CHANNEL_ID) {
        await clearAllWeixinState();
    }
}

export async function listConfiguredChannels(): Promise<string[]> {
    const config = await readOpenClawConfig();
    const channels: string[] = [];

    if (config.channels) {
        for (const channelType of Object.keys(config.channels)) {
            const section = config.channels[channelType];
            if (section.enabled === false) continue;

            const accounts = section.accounts as Record<string, ChannelConfigData> | undefined;
            const hasEnabledAccount =
                accounts && typeof accounts === 'object'
                    ? Object.values(accounts).some((account) => account.enabled !== false)
                    : false;
            if (hasEnabledAccount || Object.keys(section).length > 0) {
                channels.push(channelType);
            }
        }
    }

    // Check for WhatsApp credentials directory
    try {
        const whatsappDir = join(getOpenClawConfigDir(), 'credentials', 'whatsapp');
        if (await fileExists(whatsappDir)) {
            const entries = await readdir(whatsappDir);
            const hasSession = await (async () => {
                for (const entry of entries) {
                    try {
                        const s = await stat(join(whatsappDir, entry));
                        if (s.isDirectory()) return true;
                    } catch { /* ignore */ }
                }
                return false;
            })();

            if (hasSession && !channels.includes('whatsapp')) {
                channels.push('whatsapp');
            }
        }
    } catch {
        // Ignore errors checking whatsapp dir
    }

    try {
        const weixinAccountIds = await listWeixinAccountIds();
        if (weixinAccountIds.length > 0 && !channels.includes(WEIXIN_CHANNEL_ID)) {
            channels.push(WEIXIN_CHANNEL_ID);
        }
    } catch {
        // Ignore errors checking weixin state dir
    }

    return channels;
}

export async function listConfiguredChannelAccounts(): Promise<Record<string, ConfiguredChannelSummary>> {
    const config = await readOpenClawConfig();
    const summaries: Record<string, ConfiguredChannelSummary> = {};

    for (const [channelType, section] of Object.entries(config.channels ?? {})) {
        if (!section || typeof section !== 'object') {
            continue;
        }

        migrateLegacyChannelConfigToAccounts(section, DEFAULT_ACCOUNT_ID);
        const defaultAccount = getResolvedDefaultAccountId(section);
        const accounts = (section.accounts as Record<string, ChannelConfigData> | undefined) ?? {};
        const accountEntries = Object.keys(accounts)
            .filter(Boolean)
            .sort((left, right) => {
                if (left === defaultAccount) return -1;
                if (right === defaultAccount) return 1;
                return left.localeCompare(right);
            })
            .map((accountId) => ({
                accountId,
                enabled: accounts[accountId]?.enabled !== false,
                isDefault: accountId === defaultAccount,
            }));

        if (accountEntries.length === 0) {
            continue;
        }

        summaries[channelType] = {
            defaultAccount,
            accounts: accountEntries,
        };
    }

    const weixinAccountIds = await listWeixinAccountIds();
    if (weixinAccountIds.length > 0) {
        const channelSection = config.channels?.[WEIXIN_CHANNEL_ID];
        const requestedDefault =
            channelSection && typeof channelSection.defaultAccount === 'string' && channelSection.defaultAccount.trim()
                ? channelSection.defaultAccount.trim()
                : weixinAccountIds[0];
        const configuredDefault = weixinAccountIds.includes(requestedDefault)
            ? requestedDefault
            : weixinAccountIds[0];
        const accountConfigMap = ((channelSection?.accounts as Record<string, ChannelConfigData> | undefined) ?? {});
        const accountEntries = [...new Set(weixinAccountIds)]
            .sort((left, right) => {
                if (left === configuredDefault) return -1;
                if (right === configuredDefault) return 1;
                return left.localeCompare(right);
            })
            .map((accountId) => ({
                accountId,
                enabled: accountConfigMap[accountId]?.enabled !== false,
                isDefault: accountId === configuredDefault,
            }));

        summaries[WEIXIN_CHANNEL_ID] = {
            defaultAccount: configuredDefault,
            accounts: accountEntries,
        };
    }

    return summaries;
}

export async function deleteAgentChannelAccounts(agentId: string): Promise<void> {
    const currentConfig = await readOpenClawConfig();
    if (!currentConfig.channels) return;

    const accountId = agentId === 'main' ? DEFAULT_ACCOUNT_ID : agentId;
    let modified = false;

    for (const channelType of Object.keys(currentConfig.channels)) {
        const section = currentConfig.channels[channelType];
        migrateLegacyChannelConfigToAccounts(section, DEFAULT_ACCOUNT_ID);
        const accounts = section.accounts as Record<string, ChannelConfigData> | undefined;
        if (!accounts?.[accountId]) continue;

        delete accounts[accountId];
        if (Object.keys(accounts).length === 0) {
            delete currentConfig.channels[channelType];
        } else {
            const defaultAccountId = getResolvedDefaultAccountId(section);
            if (defaultAccountId === accountId) {
                section.defaultAccount = Object.keys(accounts)[0] || DEFAULT_ACCOUNT_ID;
            }
            syncTopLevelFromDefaultAccount(section, getResolvedDefaultAccountId(section));
        }
        modified = true;
    }

    if (modified) {
        await writeOpenClawConfig(currentConfig);
        logger.info('Deleted all channel accounts for agent', { agentId, accountId });
    }
}

export async function setChannelEnabled(channelType: string, enabled: boolean): Promise<void> {
    const currentConfig = await readOpenClawConfig();
    cleanupLegacyBuiltInChannelPluginRegistration(currentConfig, channelType);

    if (PLUGIN_CHANNELS.includes(channelType)) {
        if (enabled) {
            ensurePluginRegistration(currentConfig, channelType);
        } else {
            if (!currentConfig.plugins) currentConfig.plugins = {};
            if (!currentConfig.plugins.entries) currentConfig.plugins.entries = {};
            if (!currentConfig.plugins.entries[channelType]) currentConfig.plugins.entries[channelType] = {};
        }
        currentConfig.plugins.entries[channelType].enabled = enabled;
        await writeOpenClawConfig(currentConfig);
        console.log(`Set plugin channel ${channelType} enabled: ${enabled}`);
        return;
    }

    if (!currentConfig.channels) currentConfig.channels = {};
    if (!currentConfig.channels[channelType]) currentConfig.channels[channelType] = {};
    currentConfig.channels[channelType].enabled = enabled;
    await writeOpenClawConfig(currentConfig);
    console.log(`Set channel ${channelType} enabled: ${enabled}`);
}

// ── Validation ───────────────────────────────────────────────────

export interface ValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
}

export interface CredentialValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
    details?: Record<string, string>;
}

export async function validateChannelCredentials(
    channelType: string,
    config: Record<string, string>
): Promise<CredentialValidationResult> {
    switch (channelType) {
        case 'discord':
            return validateDiscordCredentials(config);
        case 'telegram':
            return validateTelegramCredentials(config);
        default:
            return { valid: true, errors: [], warnings: ['No online validation available for this channel type.'] };
    }
}

async function validateDiscordCredentials(
    config: Record<string, string>
): Promise<CredentialValidationResult> {
    const result: CredentialValidationResult = { valid: true, errors: [], warnings: [], details: {} };
    const token = config.token?.trim();

    if (!token) {
        return { valid: false, errors: ['Bot token is required'], warnings: [] };
    }

    try {
        const meResponse = await fetch('https://discord.com/api/v10/users/@me', {
            headers: { Authorization: `Bot ${token}` },
        });
        if (!meResponse.ok) {
            if (meResponse.status === 401) {
                return { valid: false, errors: ['Invalid bot token. Please check and try again.'], warnings: [] };
            }
            const errorData = await meResponse.json().catch(() => ({}));
            const msg = (errorData as { message?: string }).message || `Discord API error: ${meResponse.status}`;
            return { valid: false, errors: [msg], warnings: [] };
        }
        const meData = (await meResponse.json()) as { username?: string; id?: string; bot?: boolean };
        if (!meData.bot) {
            return { valid: false, errors: ['The provided token belongs to a user account, not a bot. Please use a bot token.'], warnings: [] };
        }
        result.details!.botUsername = meData.username || 'Unknown';
        result.details!.botId = meData.id || '';
    } catch (error) {
        return { valid: false, errors: [`Connection error when validating bot token: ${error instanceof Error ? error.message : String(error)}`], warnings: [] };
    }

    const guildId = config.guildId?.trim();
    if (guildId) {
        try {
            const guildResponse = await fetch(`https://discord.com/api/v10/guilds/${guildId}`, {
                headers: { Authorization: `Bot ${token}` },
            });
            if (!guildResponse.ok) {
                if (guildResponse.status === 403 || guildResponse.status === 404) {
                    result.errors.push(`Cannot access guild (server) with ID "${guildId}". Make sure the bot has been invited to this server.`);
                    result.valid = false;
                } else {
                    result.errors.push(`Failed to verify guild ID: Discord API returned ${guildResponse.status}`);
                    result.valid = false;
                }
            } else {
                const guildData = (await guildResponse.json()) as { name?: string };
                result.details!.guildName = guildData.name || 'Unknown';
            }
        } catch (error) {
            result.warnings.push(`Could not verify guild ID: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    const channelId = config.channelId?.trim();
    if (channelId) {
        try {
            const channelResponse = await fetch(`https://discord.com/api/v10/channels/${channelId}`, {
                headers: { Authorization: `Bot ${token}` },
            });
            if (!channelResponse.ok) {
                if (channelResponse.status === 403 || channelResponse.status === 404) {
                    result.errors.push(`Cannot access channel with ID "${channelId}". Make sure the bot has permission to view this channel.`);
                    result.valid = false;
                } else {
                    result.errors.push(`Failed to verify channel ID: Discord API returned ${channelResponse.status}`);
                    result.valid = false;
                }
            } else {
                const channelData = (await channelResponse.json()) as { name?: string; guild_id?: string };
                result.details!.channelName = channelData.name || 'Unknown';
                if (guildId && channelData.guild_id && channelData.guild_id !== guildId) {
                    result.errors.push(`Channel "${channelData.name}" does not belong to the specified guild. It belongs to a different server.`);
                    result.valid = false;
                }
            }
        } catch (error) {
            result.warnings.push(`Could not verify channel ID: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    return result;
}

async function validateTelegramCredentials(
    config: Record<string, string>
): Promise<CredentialValidationResult> {
    const botToken = config.botToken?.trim();
    const allowedUsers = config.allowedUsers?.trim();

    if (!botToken) return { valid: false, errors: ['Bot token is required'], warnings: [] };
    if (!allowedUsers) return { valid: false, errors: ['At least one allowed user ID is required'], warnings: [] };

    try {
        const response = await proxyAwareFetch(`https://api.telegram.org/bot${botToken}/getMe`);
        const data = (await response.json()) as { ok?: boolean; description?: string; result?: { username?: string } };
        if (data.ok) {
            return { valid: true, errors: [], warnings: [], details: { botUsername: data.result?.username || 'Unknown' } };
        }
        return { valid: false, errors: [data.description || 'Invalid bot token'], warnings: [] };
    } catch (error) {
        return { valid: false, errors: [`Connection error: ${error instanceof Error ? error.message : String(error)}`], warnings: [] };
    }
}

export async function validateChannelConfig(channelType: string): Promise<ValidationResult> {
    const { exec } = await import('child_process');

    const result: ValidationResult = { valid: true, errors: [], warnings: [] };

    try {
        const openclawPath = getOpenClawResolvedDir();
        const doctorArgs = buildManagedOpenClawArgs('doctor', ['--json']).join(' ');

        // Run openclaw doctor command to validate config (async to avoid
        // blocking the main thread).
        const output = await new Promise<string>((resolve, reject) => {
            exec(
                `node openclaw.mjs ${doctorArgs} 2>&1`,
                {
                    cwd: openclawPath,
                    encoding: 'utf-8',
                    env: {
                        ...process.env,
                        OPENCLAW_STATE_DIR: OPENCLAW_DIR,
                        OPENCLAW_CONFIG_PATH: CONFIG_FILE,
                        OPENCLAW_NO_RESPAWN: '1',
                    },
                    timeout: 30000,
                    windowsHide: true,
                },
                (err, stdout) => {
                    if (err) reject(err);
                    else resolve(stdout);
                },
            );
        });

        const lines = output.split('\n');
        for (const line of lines) {
            const lowerLine = line.toLowerCase();
            if (lowerLine.includes(channelType) && lowerLine.includes('error')) {
                result.errors.push(line.trim());
                result.valid = false;
            } else if (lowerLine.includes(channelType) && lowerLine.includes('warning')) {
                result.warnings.push(line.trim());
            } else if (lowerLine.includes('unrecognized key') && lowerLine.includes(channelType)) {
                result.errors.push(line.trim());
                result.valid = false;
            }
        }

        const config = await readOpenClawConfig();
        const savedChannelConfig = await getChannelConfig(channelType);
        if (!config.channels?.[channelType] || !savedChannelConfig) {
            result.errors.push(`Channel ${channelType} is not configured`);
            result.valid = false;
        } else if (config.channels[channelType].enabled === false) {
            result.warnings.push(`Channel ${channelType} is disabled`);
        }

        if (channelType === 'discord') {
            const discordConfig = savedChannelConfig;
            if (!discordConfig?.token) {
                result.errors.push('Discord: Bot token is required');
                result.valid = false;
            }
        } else if (channelType === 'telegram') {
            const telegramConfig = savedChannelConfig;
            if (!telegramConfig?.botToken) {
                result.errors.push('Telegram: Bot token is required');
                result.valid = false;
            }
            const allowedUsers = telegramConfig?.allowFrom as string[] | undefined;
            if (!allowedUsers || allowedUsers.length === 0) {
                result.errors.push('Telegram: Allowed User IDs are required');
                result.valid = false;
            }
        }

        if (result.errors.length === 0 && result.warnings.length === 0) {
            result.valid = true;
        }

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        if (errorMessage.includes('Unrecognized key') || errorMessage.includes('invalid config')) {
            result.errors.push(errorMessage);
            result.valid = false;
        } else if (errorMessage.includes('ENOENT')) {
            result.errors.push('OpenClaw not found. Please ensure OpenClaw is installed.');
            result.valid = false;
        } else {
            console.warn('Doctor command failed:', errorMessage);
            const config = await readOpenClawConfig();
            if (config.channels?.[channelType]) {
                result.valid = true;
            } else {
                result.errors.push(`Channel ${channelType} is not configured`);
                result.valid = false;
            }
        }
    }

    return result;
}
