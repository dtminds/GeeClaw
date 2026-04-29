/**
 * geesearch — GeeClaw web_search provider
 *
 * 按 GeeClaw /web_search API 发起正式搜索请求。
 */
export class GeeSearchError extends Error {
    code;
    cause;
    constructor(code, message, options) {
        super(message);
        this.name = 'GeeSearchError';
        this.code = code;
        this.cause = options?.cause;
    }
}
const DEFAULT_GEESEARCH_CONFIG = {
    enabled: true,
    baseUrl: 'https://geekai.co/api/v1',
    apiKey: undefined,
    authType: 'api-key',
    model: 'glm-search-std',
    intent: false,
    contentSize: 'medium',
    timeoutSeconds: 10,
};
const GEECLAW_API_KEY_ENV_VARS = ['GEECLAW_API_KEY'];
const GEECLAW_WEB_SEARCH_PATH = '/web_search';
const DEFAULT_GEESEARCH_COUNT = 5;
const GEECLAW_MAX_RESULTS = 50;
const GEESEARCH_PARAMS_SCHEMA = {
    type: 'object',
    properties: {
        query: {
            type: 'string',
            description: 'Search query string.',
        },
        count: {
            type: 'number',
            description: 'Number of results to return.',
            minimum: 1,
            maximum: GEECLAW_MAX_RESULTS,
        },
        freshness: {
            type: 'string',
            description: 'Optional freshness filter such as day, week, month, or year.',
        },
        sites: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional site/domain filters.',
        },
    },
    required: ['query'],
    additionalProperties: false,
};
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function readString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
function readPositiveInteger(value, fallback) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return fallback;
    }
    return Math.max(1, Math.floor(value));
}
function readOptionalPositiveInteger(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return undefined;
    }
    return Math.max(1, Math.floor(value));
}
function clampInteger(value, fallback, max) {
    return Math.min(max, readPositiveInteger(value, fallback));
}
function resolveSearchCountBounds(searchConfig) {
    const configuredMaxResults = readOptionalPositiveInteger(searchConfig?.maxResults);
    if (configuredMaxResults === undefined) {
        return {
            defaultCount: DEFAULT_GEESEARCH_COUNT,
            maxCount: GEECLAW_MAX_RESULTS,
        };
    }
    const maxCount = Math.min(configuredMaxResults, GEECLAW_MAX_RESULTS);
    return {
        defaultCount: maxCount,
        maxCount,
    };
}
function normalizeBaseUrl(value) {
    const raw = readString(value) ?? DEFAULT_GEESEARCH_CONFIG.baseUrl;
    return raw.replace(/\/+$/, '');
}
function resolveGeeClawWebSearchUrl(baseUrl) {
    let url;
    try {
        url = new URL(baseUrl);
    }
    catch (err) {
        throw new GeeSearchError('invalid_base_url', `GeeSearch baseUrl must be a valid absolute URL: ${baseUrl}`, { cause: err });
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        throw new GeeSearchError('invalid_base_url', `GeeSearch baseUrl must use http or https: ${baseUrl}`);
    }
    url.pathname = `${url.pathname.replace(/\/+$/, '')}${GEECLAW_WEB_SEARCH_PATH}`;
    url.search = '';
    url.hash = '';
    return url.toString();
}
function normalizeAuthType(value) {
    return value === 'bearer' ? 'bearer' : 'api-key';
}
function normalizeContentSize(value) {
    return value === 'high' ? 'high' : 'medium';
}
function resolveSiteName(url) {
    try {
        return new URL(url).hostname;
    }
    catch {
        return undefined;
    }
}
function escapeExternalContent(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
function wrapWebContent(text) {
    return `<external_content source="web_search">${escapeExternalContent(text)}</external_content>`;
}
export function parseGeeSearchConfig(raw) {
    const config = isRecord(raw) ? raw : {};
    return {
        enabled: config.enabled === false ? false : true,
        baseUrl: normalizeBaseUrl(config.baseUrl),
        apiKey: readString(config.apiKey),
        authType: normalizeAuthType(config.authType),
        model: readString(config.model) ?? DEFAULT_GEESEARCH_CONFIG.model,
        intent: config.intent === true,
        contentSize: normalizeContentSize(config.contentSize),
        timeoutSeconds: readPositiveInteger(config.timeoutSeconds, DEFAULT_GEESEARCH_CONFIG.timeoutSeconds),
    };
}
function readQuery(args) {
    const query = readString(args.query);
    if (!query) {
        throw new Error('geesearch requires a non-empty query.');
    }
    return query;
}
async function runRemoteGeeSearch(_params) {
    const apiKey = resolveGeeClawApiKey(_params.apiKey);
    if (!apiKey) {
        throw new GeeSearchError('missing_api_key', 'GeeSearch requires a GeeClaw API key. Set geesearch.apiKey or GEECLAW_API_KEY.');
    }
    const response = await postGeeClawWebSearch({
        url: resolveGeeClawWebSearchUrl(_params.baseUrl),
        apiKey,
        authType: _params.authType,
        timeoutSeconds: _params.timeoutSeconds,
        body: buildGeeClawWebSearchBody(_params),
    });
    return normalizeGeeClawWebSearchResponse(response);
}
function normalizeRecencyFilter(value) {
    switch (value) {
        case 'oneDay':
        case 'oneWeek':
        case 'oneMonth':
        case 'oneYear':
        case 'noLimit':
            return value;
        case 'day':
        case 'pd':
            return 'oneDay';
        case 'week':
        case 'pw':
            return 'oneWeek';
        case 'month':
        case 'pm':
            return 'oneMonth';
        case 'year':
        case 'py':
            return 'oneYear';
        default:
            return 'noLimit';
    }
}
function resolveGeeClawApiKey(configured) {
    if (configured) {
        return configured;
    }
    for (const envVar of GEECLAW_API_KEY_ENV_VARS) {
        const value = readString(process.env[envVar]);
        if (value) {
            return value;
        }
    }
    return undefined;
}
function buildGeeClawWebSearchBody(params) {
    const body = {
        model: params.model,
        prompt: params.query,
        intent: params.intent,
        count: params.count,
        recency_filter: normalizeRecencyFilter(params.freshness),
        content_size: params.contentSize,
    };
    if (params.sites && params.sites.length > 0) {
        body.domain_filter = params.sites.join(',');
    }
    return body;
}
function createGeeClawHeaders(params) {
    const headers = {
        Accept: 'application/json',
        'Content-Type': 'application/json',
    };
    if (params.authType === 'bearer') {
        headers.Authorization = `Bearer ${params.apiKey}`;
    }
    else {
        headers['GeekAI-API-Key'] = params.apiKey;
    }
    return headers;
}
function formatErrorMessage(err) {
    if (err instanceof Error && err.message) {
        return err.message;
    }
    return String(err);
}
async function postGeeClawWebSearch(params) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), params.timeoutSeconds * 1000);
    try {
        const response = await fetch(params.url, {
            method: 'POST',
            headers: createGeeClawHeaders(params),
            body: JSON.stringify(params.body),
            signal: controller.signal,
        });
        const text = await response.text();
        const payload = parseJsonPayload(text);
        if (!response.ok) {
            throw new GeeSearchError('api_error', `GeeSearch API error (${response.status}): ${readErrorMessage(payload) ?? response.statusText}`);
        }
        return payload;
    }
    catch (err) {
        if (err instanceof GeeSearchError) {
            throw err;
        }
        if (err instanceof Error && err.name === 'AbortError') {
            throw new GeeSearchError('timeout', `GeeSearch API request timed out after ${params.timeoutSeconds}s.`, { cause: err });
        }
        throw new GeeSearchError('network_error', `GeeSearch network error while calling ${params.url}: ${formatErrorMessage(err)}`, { cause: err });
    }
    finally {
        clearTimeout(timeout);
    }
}
function parseJsonPayload(text) {
    if (!text.trim()) {
        return {};
    }
    try {
        return JSON.parse(text);
    }
    catch {
        return { message: text };
    }
}
function readErrorMessage(value) {
    if (!isRecord(value)) {
        return undefined;
    }
    if (typeof value.message === 'string') {
        return value.message;
    }
    if (isRecord(value.error) && typeof value.error.message === 'string') {
        return value.error.message;
    }
    if (typeof value.code === 'string') {
        return value.code;
    }
    return undefined;
}
function normalizeGeeClawWebSearchResponse(value) {
    const response = isRecord(value) ? value : {};
    const rawResults = Array.isArray(response.results) ? response.results : [];
    const results = rawResults
        .map(normalizeGeeClawWebSearchResult)
        .filter((result) => Boolean(result));
    return {
        requestId: readString(response.id),
        created: typeof response.created === 'number' ? response.created : undefined,
        results,
    };
}
function normalizeGeeClawWebSearchResult(value) {
    if (!isRecord(value)) {
        return undefined;
    }
    const url = readString(value.link);
    const title = readString(value.title);
    const snippet = readString(value.content);
    if (!url || !title || !snippet) {
        return undefined;
    }
    return {
        title,
        url,
        snippet,
        siteName: readString(value.media) ?? resolveSiteName(url),
        icon: readString(value.icon),
    };
}
function readStringArray(value) {
    if (!Array.isArray(value)) {
        return undefined;
    }
    const entries = value.map(readString).filter((entry) => Boolean(entry));
    return entries.length > 0 ? entries : undefined;
}
export function createGeeSearchProvider(config) {
    return {
        id: 'geesearch',
        label: 'GeeSearch',
        hint: 'GeeClaw web_search provider',
        requiresCredential: true,
        envVars: GEECLAW_API_KEY_ENV_VARS,
        placeholder: 'GeeClaw API key',
        signupUrl: 'https://geekai.co',
        docsUrl: 'https://docs.geekai.co/cn/api/web_search',
        autoDetectOrder: 5,
        credentialPath: 'plugins.entries.geeclaw-plugin.config.geesearch.apiKey',
        inactiveSecretPaths: [],
        getCredentialValue: () => resolveGeeClawApiKey(config.apiKey),
        setCredentialValue: (_searchConfigTarget, value) => {
            config.apiKey = readString(value);
        },
        createTool: (ctx) => {
            if (!config.enabled) {
                return null;
            }
            const countBounds = resolveSearchCountBounds(ctx.searchConfig);
            return {
                description: 'Search the web using GeeSearch. Returns titles, URLs, snippets, site names, and icons from GeeClaw /web_search.',
                parameters: GEESEARCH_PARAMS_SCHEMA,
                execute: async (args) => {
                    const startedAt = performance.now();
                    const query = readQuery(args);
                    const count = clampInteger(args.count, countBounds.defaultCount, countBounds.maxCount);
                    const freshness = readString(args.freshness);
                    const sites = readStringArray(args.sites);
                    const remote = await runRemoteGeeSearch({
                        query,
                        count,
                        baseUrl: config.baseUrl,
                        apiKey: config.apiKey,
                        authType: config.authType,
                        model: config.model,
                        intent: config.intent,
                        contentSize: config.contentSize,
                        timeoutSeconds: config.timeoutSeconds,
                        freshness,
                        sites,
                    });
                    return {
                        query,
                        provider: 'geesearch',
                        requestId: remote.requestId,
                        created: remote.created,
                        count: remote.results.length,
                        tookMs: Math.round(performance.now() - startedAt),
                        externalContent: {
                            untrusted: true,
                            source: 'web_search',
                            provider: 'geesearch',
                            wrapped: true,
                        },
                        results: remote.results.map((result) => ({
                            title: wrapWebContent(result.title),
                            url: result.url,
                            snippet: wrapWebContent(result.snippet),
                            siteName: result.siteName,
                            icon: result.icon,
                        })),
                    };
                },
            };
        },
    };
}
const geesearchPkg = {
    id: 'geesearch',
    name: 'GeeSearch',
    description: 'GeeClaw managed web_search provider',
    configSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
            enabled: { type: 'boolean', default: true },
            baseUrl: { type: 'string', default: DEFAULT_GEESEARCH_CONFIG.baseUrl },
            apiKey: { type: 'string' },
            authType: {
                type: 'string',
                enum: ['api-key', 'bearer'],
                default: DEFAULT_GEESEARCH_CONFIG.authType,
            },
            model: { type: 'string', default: DEFAULT_GEESEARCH_CONFIG.model },
            intent: { type: 'boolean', default: DEFAULT_GEESEARCH_CONFIG.intent },
            contentSize: {
                type: 'string',
                enum: ['medium', 'high'],
                default: DEFAULT_GEESEARCH_CONFIG.contentSize,
            },
            timeoutSeconds: {
                type: 'number',
                minimum: 1,
                default: DEFAULT_GEESEARCH_CONFIG.timeoutSeconds,
            },
        },
    },
    parseConfig: parseGeeSearchConfig,
    setup(ctx) {
        const config = parseGeeSearchConfig(ctx.getConfig());
        ctx.registerWebSearchProvider(createGeeSearchProvider(config));
        ctx.logger.info('GeeSearch provider registered');
    },
};
export default geesearchPkg;
