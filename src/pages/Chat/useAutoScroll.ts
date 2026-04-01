/**
 * useAutoScroll – encapsulates the "follow the bottom" scroll behaviour
 * used by the Chat page during streaming and normal message rendering.
 *
 * Responsibilities:
 * 1. Auto-scroll to the bottom whenever new content is appended (messages,
 *    streaming text, tool output, pending-final transitions).
 * 2. Pause auto-scroll once the user leaves the bottom area.
 * 3. Resume auto-scroll when the user scrolls back to the bottom (manually
 *    or via the "scroll to bottom" button).
 * 4. Snap instantly to the bottom on session switch (before paint) so the
 *    user never sees a top→bottom scroll animation.
 */

import { useEffect, useLayoutEffect, useRef, useState, useCallback, type RefObject } from 'react';

// ── Constants ────────────────────────────────────────────────────

/** How close to the bottom the user must be for us to consider them "at bottom". */
const BOTTOM_FOLLOW_THRESHOLD_PX = 64;

// ── Types ────────────────────────────────────────────────────────

export interface UseAutoScrollOptions {
  /** Current desktop session id – resets follow state on change. */
  sessionId: string | undefined;
  /** Whether a message is currently being sent / streamed. */
  sending: boolean;
  /** Whether the store is waiting for a final assistant message after tool use. */
  pendingFinal: boolean;
  /** Total number of committed (non-streaming) messages. */
  messagesLength: number;
  /** Whether the initial history load is in progress. */
  loading: boolean;
}

export interface UseAutoScrollReturn {
  /** Ref to attach to the scrollable outer container. */
  containerRef: RefObject<HTMLDivElement | null>;
  /** Ref to attach to the inner content wrapper (observed for resize). */
  innerRef: RefObject<HTMLDivElement | null>;
  /** Whether auto-follow is currently enabled (drives "scroll to bottom" button visibility). */
  isAutoScrollEnabled: boolean;
  /** Scroll to the bottom and re-enable auto-follow. */
  scrollToBottomAndFollow: () => void;
}

// ── Hook ─────────────────────────────────────────────────────────

export function useAutoScroll(options: UseAutoScrollOptions): UseAutoScrollReturn {
  const { sessionId, sending, pendingFinal, messagesLength, loading } = options;

  // ── Refs ──────────────────────────────────────────────────────

  /** The scrollable outer container. */
  const containerRef = useRef<HTMLDivElement | null>(null);

  /** The inner content wrapper; ResizeObserver watches this for height changes. */
  const innerRef = useRef<HTMLDivElement | null>(null);

  /** True when a session switch is pending and we need to snap to bottom before paint. */
  const pendingSessionScrollRef = useRef(true);

  /**
   * True while a programmatic `scrollToBottom()` is in progress.
   * Prevents the scroll event handler from interpreting the resulting
   * scroll-position change as a user action.
   */
  const isProgrammaticScrollRef = useRef(false);

  /** rAF id for releasing `isProgrammaticScrollRef` one frame after scrollToBottom. */
  const scrollReleaseFrameRef = useRef<number | null>(null);

  /** rAF id for the queued single-shot follow scheduled by ResizeObserver / structural changes. */
  const scheduledFollowFrameRef = useRef<number | null>(null);

  /** Synchronous mirror of `isAutoScrollEnabled` state, readable from event handlers. */
  const isAutoScrollEnabledRef = useRef(true);

  // ── State ────────────────────────────────────────────────────

  /**
   * Compound state that tracks auto-scroll enablement per session.
   * When `sessionId` changes, the derived `isAutoScrollEnabled` automatically
   * resets to `true` because the stored sessionId no longer matches — no
   * setState-in-effect or ref-during-render needed.
   */
  const [autoScrollState, setAutoScrollState] = useState(() => ({
    sessionId,
    enabled: true,
  }));

  const isAutoScrollEnabled = autoScrollState.sessionId === sessionId
    ? autoScrollState.enabled
    : true;

  // Keep the synchronous ref in sync with the derived value.
  useEffect(() => {
    isAutoScrollEnabledRef.current = isAutoScrollEnabled;
  }, [isAutoScrollEnabled]);

  // ── Private helpers ──────────────────────────────────────────

  const isNearBottom = useCallback((container: HTMLDivElement): boolean => {
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    return distanceFromBottom <= BOTTOM_FOLLOW_THRESHOLD_PX;
  }, []);

  /** Cancel all queued rAF callbacks. */
  const cancelQueuedFollow = useCallback(() => {
    if (scrollReleaseFrameRef.current !== null) {
      cancelAnimationFrame(scrollReleaseFrameRef.current);
      scrollReleaseFrameRef.current = null;
    }
    if (scheduledFollowFrameRef.current !== null) {
      cancelAnimationFrame(scheduledFollowFrameRef.current);
      scheduledFollowFrameRef.current = null;
    }
  }, []);

  /** Enable or disable auto-follow, updating both the ref (sync) and state (async). */
  const setFollowEnabled = useCallback((enabled: boolean) => {
    isAutoScrollEnabledRef.current = enabled;
    setAutoScrollState((prev) => (
      prev.sessionId === sessionId && prev.enabled === enabled
        ? prev
        : { sessionId, enabled }
    ));

    if (!enabled) {
      isProgrammaticScrollRef.current = false;
      cancelQueuedFollow();
    }
  }, [cancelQueuedFollow, sessionId]);

  /** Programmatically scroll to the absolute bottom of the container. */
  const scrollToBottom = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    isProgrammaticScrollRef.current = true;
    container.scrollTop = container.scrollHeight;

    // Release the programmatic flag one frame later so that the resulting
    // `scroll` event is ignored by the user-scroll handler.
    if (scrollReleaseFrameRef.current !== null) {
      cancelAnimationFrame(scrollReleaseFrameRef.current);
    }
    scrollReleaseFrameRef.current = requestAnimationFrame(() => {
      isProgrammaticScrollRef.current = false;
      scrollReleaseFrameRef.current = null;
    });
  }, []);

  /** Public: scroll to bottom and re-enable auto-follow. */
  const scrollToBottomAndFollow = useCallback(() => {
    setFollowEnabled(true);
    scrollToBottom();
  }, [setFollowEnabled, scrollToBottom]);

  const handleScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const nextIsNearBottom = isNearBottom(container);
    if (isProgrammaticScrollRef.current && nextIsNearBottom) return;

    if (nextIsNearBottom) {
      if (!isAutoScrollEnabledRef.current) {
        setFollowEnabled(true);
      }
      return;
    }

    if (isAutoScrollEnabledRef.current) {
      setFollowEnabled(false);
    }
  }, [isNearBottom, setFollowEnabled]);

  // ── Effects ──────────────────────────────────────────────────

  // When the session changes, mark that we need to snap to the bottom.
  // Auto-scroll is implicitly re-enabled via the compound state derivation
  // (mismatched sessionId → isAutoScrollEnabled defaults to true).
  useEffect(() => {
    pendingSessionScrollRef.current = true;
  }, [sessionId]);

  // Cleanup all queued rAFs on unmount.
  useEffect(() => () => {
    cancelQueuedFollow();
  }, [cancelQueuedFollow]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      container.removeEventListener('scroll', handleScroll);
    };
  }, [handleScroll]);

  // On session switch or initial load, snap to the bottom *before paint* so
  // the user never sees a top→bottom scroll animation.
  useLayoutEffect(() => {
    if (!pendingSessionScrollRef.current || loading) return;
    scrollToBottom();
    pendingSessionScrollRef.current = false;
  }, [loading, messagesLength, sessionId, scrollToBottom]);

  // Observe the inner content wrapper for size changes (streaming text,
  // image loading, code block expansion, etc.) and follow to bottom.
  useEffect(() => {
    if (!innerRef.current) return;

    const queueFollowToBottom = () => {
      if (scheduledFollowFrameRef.current !== null) return;
      scheduledFollowFrameRef.current = requestAnimationFrame(() => {
        scheduledFollowFrameRef.current = null;
        if (!isAutoScrollEnabledRef.current) return;
        scrollToBottom();
      });
    };

    const observer = new ResizeObserver(() => {
      queueFollowToBottom();
    });

    observer.observe(innerRef.current);

    return () => {
      observer.disconnect();
      if (scheduledFollowFrameRef.current !== null) {
        cancelAnimationFrame(scheduledFollowFrameRef.current);
        scheduledFollowFrameRef.current = null;
      }
    };
  }, [sessionId, scrollToBottom]);

  // Follow on structural state changes (new messages, sending toggle, pending-final).
  useEffect(() => {
    if (!isAutoScrollEnabled) return;

    if (scheduledFollowFrameRef.current !== null) return;
    scheduledFollowFrameRef.current = requestAnimationFrame(() => {
      scheduledFollowFrameRef.current = null;
      if (!isAutoScrollEnabledRef.current) return;
      scrollToBottom();
    });
  }, [messagesLength, sending, pendingFinal, isAutoScrollEnabled, scrollToBottom]);

  // ── Return ───────────────────────────────────────────────────

  return {
    containerRef,
    innerRef,
    isAutoScrollEnabled,
    scrollToBottomAndFollow,
  };
}
