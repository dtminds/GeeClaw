import { toOpenClawChannelType, toUiChannelType } from './channel-alias';

type JsonRecord = Record<string, unknown>;

export interface GatewayCronDelivery {
  mode: string;
  channel?: string;
  to?: string;
  accountId?: string;
  bestEffort?: boolean;
}

export function normalizeCronDelivery(
  rawDelivery: unknown,
  fallbackMode: GatewayCronDelivery['mode'] = 'none',
): GatewayCronDelivery {
  if (!rawDelivery || typeof rawDelivery !== 'object') {
    return { mode: fallbackMode };
  }

  const delivery = rawDelivery as JsonRecord;
  const mode = typeof delivery.mode === 'string' && delivery.mode.trim()
    ? delivery.mode.trim()
    : fallbackMode;
  const channel = typeof delivery.channel === 'string' && delivery.channel.trim()
    ? toOpenClawChannelType(delivery.channel.trim())
    : undefined;
  const to = typeof delivery.to === 'string' && delivery.to.trim()
    ? delivery.to.trim()
    : undefined;
  const accountId = typeof delivery.accountId === 'string' && delivery.accountId.trim()
    ? delivery.accountId.trim()
    : undefined;
  const bestEffort = typeof delivery.bestEffort === 'boolean'
    ? delivery.bestEffort
    : undefined;

  if (mode === 'announce' && !channel) {
    return { mode: 'none' };
  }

  return {
    mode,
    ...(channel ? { channel } : {}),
    ...(to ? { to } : {}),
    ...(accountId ? { accountId } : {}),
    ...(typeof bestEffort === 'boolean' ? { bestEffort } : {}),
  };
}

export function normalizeCronDeliveryPatch(rawDelivery: unknown): Record<string, unknown> {
  if (!rawDelivery || typeof rawDelivery !== 'object') {
    return {};
  }

  const delivery = rawDelivery as JsonRecord;
  const patch: Record<string, unknown> = {};
  if ('mode' in delivery) {
    patch.mode = typeof delivery.mode === 'string' && delivery.mode.trim()
      ? delivery.mode.trim()
      : 'none';
  }
  if ('channel' in delivery) {
    patch.channel = typeof delivery.channel === 'string' && delivery.channel.trim()
      ? toOpenClawChannelType(delivery.channel.trim())
      : '';
  }
  if ('to' in delivery) {
    patch.to = typeof delivery.to === 'string' ? delivery.to.trim() : '';
  }
  if ('accountId' in delivery) {
    patch.accountId = typeof delivery.accountId === 'string' ? delivery.accountId.trim() : '';
  }
  if ('bestEffort' in delivery) {
    patch.bestEffort = typeof delivery.bestEffort === 'boolean' ? delivery.bestEffort : false;
  }
  return patch;
}

export function buildCronUpdatePatch(input: Record<string, unknown>): Record<string, unknown> {
  const patch = { ...input };

  const schedule = patch.schedule;
  if (typeof schedule === 'string') {
    patch.schedule = { kind: 'cron', expr: schedule };
  }

  if (typeof patch.message === 'string') {
    patch.payload = { kind: 'agentTurn', message: patch.message };
    delete patch.message;
  }

  if ('delivery' in patch) {
    patch.delivery = normalizeCronDeliveryPatch(patch.delivery);
  }

  return patch;
}

export function toUiCronDelivery(delivery: GatewayCronDelivery | undefined): GatewayCronDelivery | undefined {
  if (!delivery) return undefined;

  const normalized = normalizeCronDelivery(delivery);
  if (!normalized.channel) return normalized;

  return {
    ...normalized,
    channel: toUiChannelType(normalized.channel),
  };
}
