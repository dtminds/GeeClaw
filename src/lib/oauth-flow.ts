export type OAuthFlowData =
  | {
      mode: 'device';
      verificationUri: string;
      userCode: string;
      expiresIn: number;
    }
  | {
      mode: 'manual';
      authorizationUrl: string;
      message?: string;
    };

export function normalizeOAuthFlowPayload(data: unknown): OAuthFlowData {
  const payload = data as Record<string, unknown>;
  if (payload?.mode === 'manual') {
    return {
      mode: 'manual',
      authorizationUrl: String(payload.authorizationUrl || ''),
      message: typeof payload.message === 'string' ? payload.message : undefined,
    };
  }

  return {
    mode: 'device',
    verificationUri: String(payload?.verificationUri || ''),
    userCode: String(payload?.userCode || ''),
    expiresIn: Number(payload?.expiresIn || 300),
  };
}
