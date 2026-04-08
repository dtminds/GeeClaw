import { describe, expect, it } from 'vitest';
import {
  addApproval,
  getApprovalResolveMethod,
  parseApprovalNotification,
  pruneApprovals,
  removeApproval,
  type ApprovalRequest,
} from '@/lib/openclaw-approval';

const DEFAULT_ALLOWED_DECISIONS = ['allow-once', 'allow-always', 'deny'] as const;

function makeExecEntry(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    id: 'entry-1',
    kind: 'exec',
    createdAtMs: 10,
    expiresAtMs: 500,
    request: {
      command: 'echo hello',
      cwd: '/tmp',
    },
    allowedDecisions: [...DEFAULT_ALLOWED_DECISIONS],
    ...overrides,
  };
}

describe('openclaw approval parser', () => {
  it('parses exec.approval.requested and preserves allowedDecisions when valid', () => {
    const parsed = parseApprovalNotification({
      method: 'exec.approval.requested',
      params: {
        id: 'exec-1',
        createdAtMs: 1_710_000_000_000,
        expiresAtMs: 1_710_000_060_000,
        request: {
          command: 'mcporter --version',
          cwd: '/tmp/demo',
          host: 'gateway',
          security: 'allowlist',
          ask: 'on-miss',
          agentId: 'main',
          resolvedPath: '/opt/homebrew/bin/mcporter',
          sessionKey: 'agent:main:thread-1',
          allowedDecisions: ['allow-once', 'deny'],
        },
      },
    });

    expect(parsed).toEqual({
      type: 'requested',
      entry: {
        id: 'exec-1',
        kind: 'exec',
        createdAtMs: 1_710_000_000_000,
        expiresAtMs: 1_710_000_060_000,
        request: {
          command: 'mcporter --version',
          cwd: '/tmp/demo',
          host: 'gateway',
          security: 'allowlist',
          ask: 'on-miss',
          agentId: 'main',
          resolvedPath: '/opt/homebrew/bin/mcporter',
          sessionKey: 'agent:main:thread-1',
        },
        allowedDecisions: ['allow-once', 'deny'],
      },
    });
  });

  it('defaults allowedDecisions when payload is missing or invalid', () => {
    const missing = parseApprovalNotification({
      method: 'exec.approval.requested',
      params: {
        id: 'exec-missing',
        createdAtMs: 10,
        expiresAtMs: 20,
        request: {
          command: 'echo missing',
        },
      },
    });
    const invalid = parseApprovalNotification({
      method: 'exec.approval.requested',
      params: {
        id: 'exec-invalid',
        createdAtMs: 11,
        expiresAtMs: 21,
        request: {
          command: 'echo invalid',
          allowedDecisions: ['allow-once', 'unsupported'],
        },
      },
    });

    expect(missing).toEqual(expect.objectContaining({
      type: 'requested',
      entry: expect.objectContaining({
        allowedDecisions: [...DEFAULT_ALLOWED_DECISIONS],
      }),
    }));
    expect(invalid).toEqual(expect.objectContaining({
      type: 'requested',
      entry: expect.objectContaining({
        allowedDecisions: [...DEFAULT_ALLOWED_DECISIONS],
      }),
    }));
  });

  it('parses plugin.approval.requested and reads plugin metadata from payload.request', () => {
    const parsed = parseApprovalNotification({
      method: 'plugin.approval.requested',
      params: {
        id: 'plugin:123',
        createdAtMs: 100,
        expiresAtMs: 300,
        title: 'wrong-top-level-title',
        pluginId: 'wrong-top-level-id',
        request: {
          title: 'Plugin approval needed',
          description: 'Needs install permission',
          severity: 'high',
          pluginId: 'market/foo',
          agentId: 'main',
          sessionKey: 'agent:main:thread-1',
          allowedDecisions: ['deny'],
        },
      },
    });

    expect(parsed).toEqual({
      type: 'requested',
      entry: {
        id: 'plugin:123',
        kind: 'plugin',
        createdAtMs: 100,
        expiresAtMs: 300,
        request: {
          command: 'Plugin approval needed',
          agentId: 'main',
          sessionKey: 'agent:main:thread-1',
        },
        pluginTitle: 'Plugin approval needed',
        pluginDescription: 'Needs install permission',
        pluginSeverity: 'high',
        pluginId: 'market/foo',
        allowedDecisions: ['deny'],
      },
    });
  });

  it.each(['exec.approval.resolved', 'plugin.approval.resolved'] as const)(
    'parses %s',
    (method) => {
      expect(parseApprovalNotification({
        method,
        params: {
          id: 'resolved-1',
          decision: 'allow-once',
          resolvedBy: 'agent/main',
          ts: 12345,
        },
      })).toEqual({
        type: 'resolved',
        resolved: {
          id: 'resolved-1',
          decision: 'allow-once',
          resolvedBy: 'agent/main',
          ts: 12345,
        },
      });
    },
  );

  it('returns null for unsupported or malformed notifications', () => {
    expect(parseApprovalNotification({ method: 'agent', params: {} })).toBeNull();
    expect(parseApprovalNotification({ method: 'exec.approval.requested', params: null })).toBeNull();
    expect(parseApprovalNotification(undefined)).toBeNull();
  });
});

describe('openclaw approval queue helpers', () => {
  it('keeps queue ordered by createdAtMs ascending and deduplicates by id', () => {
    const newer = makeExecEntry({
      id: 'newer',
      createdAtMs: 20,
      request: { command: 'echo newer' },
    });
    const older = makeExecEntry({
      id: 'older',
      createdAtMs: 10,
      request: { command: 'echo older' },
    });

    let queue = addApproval([], newer, 0);
    queue = addApproval(queue, older, 0);

    expect(queue.map((entry) => entry.id)).toEqual(['older', 'newer']);
    expect(queue[0]?.id).toBe('older');

    queue = addApproval(queue, {
      ...newer,
      createdAtMs: 30,
      request: { command: 'echo newer updated' },
    }, 0);

    expect(queue.map((entry) => entry.id)).toEqual(['older', 'newer']);
    expect(queue.find((entry) => entry.id === 'newer')?.request.command).toBe('echo newer updated');
  });

  it('prunes expired approvals and removes the requested id', () => {
    const nowMs = 100;
    const queue = [
      makeExecEntry({ id: 'expired', createdAtMs: 1, expiresAtMs: 50 }),
      makeExecEntry({ id: 'active', createdAtMs: 2, expiresAtMs: 200 }),
    ];

    expect(pruneApprovals(queue, nowMs).map((entry) => entry.id)).toEqual(['active']);
    expect(removeApproval(queue, 'active', nowMs)).toEqual([]);
  });
});

describe('openclaw approval helpers', () => {
  it('returns the proper resolve rpc method by approval kind', () => {
    expect(getApprovalResolveMethod('exec')).toBe('exec.approval.resolve');
    expect(getApprovalResolveMethod('plugin')).toBe('plugin.approval.resolve');
  });
});
