export function extractGatewayRpcSessionKey(params: unknown): string | undefined {
  if (!params || typeof params !== 'object') {
    return undefined;
  }

  const sessionKey = (params as Record<string, unknown>).sessionKey;
  return typeof sessionKey === 'string' ? sessionKey : undefined;
}
