import { EventEmitter } from 'node:events';

export type ManagedPluginStage =
  | 'idle'
  | 'checking'
  | 'installing'
  | 'installed'
  | 'failed';

export type ManagedPluginStatus = {
  pluginId: string;
  displayName: string;
  stage: ManagedPluginStage;
  message: string;
  targetVersion: string;
  installedVersion?: string | null;
  error?: string;
};

const emitter = new EventEmitter();
let currentStatus: ManagedPluginStatus | null = null;

export function getManagedPluginStatus(): ManagedPluginStatus | null {
  return currentStatus;
}

export function setManagedPluginStatus(status: ManagedPluginStatus | null): void {
  currentStatus = status;
  emitter.emit('change', status);
}

export function subscribeManagedPluginStatus(
  listener: (status: ManagedPluginStatus | null) => void,
): () => void {
  emitter.on('change', listener);
  return () => {
    emitter.off('change', listener);
  };
}
