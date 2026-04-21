export type EvolutionProposalTab = {
  kind: 'memory' | 'behavior' | 'skill' | 'tool' | 'unknown';
  label: string;
  content: string;
  targetFile?: string;
};

export type EvolutionProposalCardData = {
  proposalId: string;
  signature?: string;
  description: string;
  tabs: EvolutionProposalTab[];
  draftPath?: string;
  deliveryMode: 'card';
  channel?: string;
  followUp?: string;
  message?: string;
};

function normalizeToolName(name: string): string {
  return name.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseJsonLikeValue(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return value;
  }

  const candidates = [
    trimmed,
    trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''),
  ];

  const firstBraceIndex = trimmed.indexOf('{');
  const lastBraceIndex = trimmed.lastIndexOf('}');
  if (firstBraceIndex !== -1 && lastBraceIndex > firstBraceIndex) {
    candidates.push(trimmed.slice(firstBraceIndex, lastBraceIndex + 1));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      continue;
    }
  }

  return value;
}

function getOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

export function isEvolutionProposalToolName(name: string): boolean {
  return normalizeToolName(name) === 'evolution_proposal';
}

function parseEvolutionProposalTabs(value: unknown): EvolutionProposalTab[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!isRecord(entry)) {
      return [];
    }

    const label = getOptionalString(entry.label) || getOptionalString(entry.title);
    const content = getOptionalString(entry.content) || getOptionalString(entry.markdown) || '';
    if (!label || !content) {
      return [];
    }

    const rawKind = getOptionalString(entry.kind)?.toLowerCase();
    const kind: EvolutionProposalTab['kind'] = rawKind === 'memory'
      || rawKind === 'behavior'
      || rawKind === 'skill'
      || rawKind === 'tool'
      ? rawKind
      : 'unknown';

    return [{
      kind,
      label,
      content,
      targetFile: getOptionalString(entry.targetFile) || getOptionalString(entry.target_path),
    }];
  });
}

export function extractEvolutionProposalCardData(
  name: string,
  input: unknown,
  result: unknown,
): EvolutionProposalCardData | null {
  if (!isEvolutionProposalToolName(name)) {
    return null;
  }

  const parsedResult = parseJsonLikeValue(result);
  if (!isRecord(parsedResult) || parsedResult.deliveryMode !== 'card') {
    return null;
  }

  const parsedInput = parseJsonLikeValue(input);
  if (!isRecord(parsedInput)) {
    return null;
  }

  const proposalSource = isRecord(parsedInput.proposal) ? parsedInput.proposal : parsedInput;
  const proposalId = getOptionalString(proposalSource.proposalId)
    || getOptionalString(parsedResult.proposalId);
  const description = getOptionalString(proposalSource.description) || '';
  const tabs = parseEvolutionProposalTabs(proposalSource.tabs);

  if (!proposalId || tabs.length === 0) {
    return null;
  }

  return {
    proposalId,
    signature: getOptionalString(proposalSource.signature),
    description,
    tabs,
    draftPath: getOptionalString(proposalSource.draftPath),
    deliveryMode: 'card',
    channel: getOptionalString(parsedResult.channel),
    followUp: getOptionalString(parsedResult.followUp),
    message: getOptionalString(parsedResult.message),
  };
}
