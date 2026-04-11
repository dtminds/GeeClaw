import { createHostEventSource } from './host-api';

let eventSourcePromise: Promise<EventSource> | null = null;

const HOST_EVENT_TO_IPC_CHANNEL: Record<string, string> = {
  'gateway:status': 'gateway:status-changed',
  'gateway:error': 'gateway:error',
  'gateway:notification': 'gateway:notification',
  'gateway:chat-message': 'gateway:chat-message',
  'gateway:channel-status': 'gateway:channel-status',
  'gateway:exit': 'gateway:exit',
  'openclaw:sidecar-status': 'openclaw:sidecar-status',
  'oauth:code': 'oauth:code',
  'oauth:success': 'oauth:success',
  'oauth:error': 'oauth:error',
  'channel:whatsapp-qr': 'channel:whatsapp-qr',
  'channel:whatsapp-success': 'channel:whatsapp-success',
  'channel:whatsapp-error': 'channel:whatsapp-error',
  'channel:wecom-qr': 'channel:wecom-qr',
  'channel:wecom-success': 'channel:wecom-success',
  'channel:wecom-error': 'channel:wecom-error',
  'channel:openclaw-weixin-qr': 'channel:openclaw-weixin-qr',
  'channel:openclaw-weixin-success': 'channel:openclaw-weixin-success',
  'channel:openclaw-weixin-error': 'channel:openclaw-weixin-error',
};

function getEventSource(): Promise<EventSource> {
  if (!eventSourcePromise) {
    eventSourcePromise = createHostEventSource();
  }
  return eventSourcePromise;
}

function allowSseFallback(): boolean {
  try {
    return window.localStorage.getItem('geeclaw:allow-sse-fallback') === '1';
  } catch {
    return false;
  }
}

export function subscribeHostEvent<T = unknown>(
  eventName: string,
  handler: (payload: T) => void,
): () => void {
  const ipc = window.electron?.ipcRenderer;
  const ipcChannel = HOST_EVENT_TO_IPC_CHANNEL[eventName];
  if (ipcChannel && ipc?.on && ipc?.off) {
    const listener = (payload: unknown) => {
      handler(payload as T);
    };
    // preload's `on()` may wrap the callback in an internal subscription
    // function and return a cleanup handle for that exact wrapper.  Prefer the
    // returned cleanup when available, but still call `off()` as a no-op-safe
    // fallback for environments/tests that register the original listener.
    const unsubscribe = ipc.on(ipcChannel, listener);
    if (typeof unsubscribe === 'function') {
      return unsubscribe;
    }
    // Fallback for environments where on() doesn't return cleanup
    return () => {
      ipc.off(ipcChannel, listener);
    };
  }

  if (!allowSseFallback()) {
    console.warn(`[host-events] no IPC mapping for event "${eventName}", SSE fallback disabled`);
    return () => {};
  }

  const listener = (event: Event) => {
    const payload = JSON.parse((event as MessageEvent).data) as T;
    handler(payload);
  };
  let unsubscribed = false;
  let sourceRef: EventSource | null = null;
  void getEventSource()
    .then((source) => {
      if (unsubscribed) return;
      sourceRef = source;
      source.addEventListener(eventName, listener);
    })
    .catch((error) => {
      console.warn(`[host-events] failed to initialize SSE fallback for "${eventName}"`, error);
    });
  return () => {
    unsubscribed = true;
    sourceRef?.removeEventListener(eventName, listener);
  };
}
