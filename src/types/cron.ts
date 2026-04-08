/**
 * Cron Job Type Definitions
 * Types for scheduled tasks
 */

import { ChannelType } from './channel';

/**
 * Cron job target (where to send the result)
 */
export interface CronJobTarget {
  channelType: ChannelType;
  channelId: string;
  channelName: string;
}

/**
 * Cron job last run info
 */
export interface CronJobLastRun {
  time: string;
  success: boolean;
  error?: string;
  duration?: number;
}

export interface CronRunSummary {
  id: string;
  sessionId?: string;
  sessionKey?: string;
  status: 'ok' | 'error' | 'running' | 'unknown';
  summary?: string;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  model?: string;
  provider?: string;
}

export interface CronAgentRunSummary extends CronRunSummary {
  jobId: string;
  jobName: string;
  agentId?: string;
}

/**
 * Gateway CronSchedule object format
 */
export type CronSchedule =
  | { kind: 'at'; at: string }
  | { kind: 'every'; everyMs: number; anchorMs?: number }
  | { kind: 'cron'; expr: string; tz?: string };

/**
 * Cron job data structure
 * schedule can be a plain cron string or a Gateway CronSchedule object
 */
export interface CronJob {
  id: string;
  name: string;
  message: string;
  schedule: string | CronSchedule;
  agentId?: string;
  target?: CronJobTarget;
  delivery?: CronDeliveryConfig;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastRun?: CronJobLastRun;
  nextRun?: string;
}

/**
 * Delivery configuration for cron jobs
 */
export type CronDeliveryMode = 'none' | 'announce';

export interface CronDeliveryConfig {
  mode: CronDeliveryMode;
  channel?: string;
  to?: string;
  accountId?: string;
}

/**
 * Input for creating a cron job from the UI.
 */
export interface CronJobCreateInput {
  name: string;
  message: string;
  schedule: string;
  enabled?: boolean;
  delivery?: CronDeliveryConfig;
  agentId?: string;
}

/**
 * Input for updating a cron job
 */
export interface CronJobUpdateInput {
  name?: string;
  message?: string;
  schedule?: string;
  enabled?: boolean;
  delivery?: CronDeliveryConfig;
  agentId?: string;
}

/**
 * Schedule type for UI picker
 */
export type ScheduleType = 'daily' | 'weekly' | 'monthly' | 'interval' | 'custom';
