export function toOpenClawChannelType(channel: string): string {
  const normalized = channel.trim();
  return normalized === 'wechat' ? 'openclaw-weixin' : normalized;
}

export function toUiChannelType(channel: string): string {
  const normalized = channel.trim();
  return normalized === 'wechat' ? 'openclaw-weixin' : normalized;
}
