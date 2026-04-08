import type { ChannelGroup, ChannelType } from '@/types/channel';

export type CronDeliveryChannelOption = {
  id: string;
  type: ChannelType;
  name: string;
  disabled: boolean;
};

export function getCronDeliveryChannelOptions(
  channels: Pick<ChannelGroup, 'id' | 'type' | 'name' | 'accounts'>[],
): CronDeliveryChannelOption[] {
  return channels
    .filter((channel) => channel.accounts.some((account) => account.enabled))
    .map((channel) => ({
      id: channel.id,
      type: channel.type,
      name: channel.name,
      disabled: false,
    }));
}
