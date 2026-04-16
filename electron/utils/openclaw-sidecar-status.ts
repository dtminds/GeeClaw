import { EventEmitter } from 'node:events';

export type OpenClawSidecarStage = 'idle' | 'extracting' | 'ready' | 'error';

export interface OpenClawSidecarStatus {
  stage: OpenClawSidecarStage;
  version?: string;
  previousVersion?: string;
  error?: string;
}

const emitter = new EventEmitter();
let currentStatus: OpenClawSidecarStatus = { stage: 'idle' };

export function getOpenClawSidecarStatus(): OpenClawSidecarStatus {
  return currentStatus;
}

export function setOpenClawSidecarStatus(status: OpenClawSidecarStatus): void {
  currentStatus = status;
  emitter.emit('change', status);
}

export function subscribeOpenClawSidecarStatus(
  listener: (status: OpenClawSidecarStatus) => void,
): () => void {
  emitter.on('change', listener);
  return () => {
    emitter.off('change', listener);
  };
}
