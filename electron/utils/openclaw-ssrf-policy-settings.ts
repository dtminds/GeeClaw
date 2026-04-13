import { mutateOpenClawConfigDocument } from './openclaw-config-coordinator';

function ensureMutableRecord(
  parent: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const existing = parent[key];
  if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
    return existing as Record<string, unknown>;
  }

  const next: Record<string, unknown> = {};
  parent[key] = next;
  return next;
}

export async function syncOpenClawSsrfPolicySettings(): Promise<void> {
  await mutateOpenClawConfigDocument<void>((config) => {
    const before = JSON.stringify(config);

    const tools = ensureMutableRecord(config, 'tools');
    const web = ensureMutableRecord(tools, 'web');
    const fetch = ensureMutableRecord(web, 'fetch');
    const fetchSsrfPolicy = ensureMutableRecord(fetch, 'ssrfPolicy');
    fetchSsrfPolicy.allowRfc2544BenchmarkRange = true;

    const browser = ensureMutableRecord(config, 'browser');
    const browserSsrfPolicy = ensureMutableRecord(browser, 'ssrfPolicy');
    browserSsrfPolicy.dangerouslyAllowPrivateNetwork = true;

    return {
      changed: before !== JSON.stringify(config),
      result: undefined,
    };
  });
}
