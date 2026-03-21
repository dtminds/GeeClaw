/**
 * useAutoScroll – encapsulates the "follow the bottom" scroll behaviour
 * used by the Chat page during streaming and normal message rendering.
 *
 * Responsibilities:
 * 1. Auto-scroll to the bottom whenever new content is appended (messages,
 *    streaming text, tool output, pending-final transitions).
 * 2. Pause auto-scroll when the user intentionally scrolls upward (wheel,
 *    touch-drag, scrollbar drag).
 * 3. Resume auto-scroll when the user scrolls back to the bottom (manually
 *    or via the "scroll to bottom" button).
 * 4. Continuously follow Streamdown's height animation during active
 *    streaming via a requestAnimationFrame loop so the viewport never
 *    lags behind ResizeObserver callbacks.
 * 5. Snap instantly to the bottom on session switch (before paint) so the
 *    user never sees a top→bottom scroll animation.
 */

import { useEffect, useLayoutEffect, useRef, useState, useCallback, type RefObject } from 'react';

// ── Constants ────────────────────────────────────────────────────

/** How close to the bottom the user must be for us to consider them "at bottom". */
const BOTTOM_FOLLOW_THRESHOLD_PX = 64;

/** Tolerance (px) when comparing scroll positions to detect upward scrolling. */
const SCROLL_UP_TOLERANCE_PX = 1;

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
  /** Event handlers to spread onto the scroll container element. */
  containerEventHandlers: {
    onScroll: () => void;
    onWheel: (e: React.WheelEvent<HTMLDivElement>) => void;
    onPointerDown: () => void;
    onTouchStart: (e: React.TouchEvent<HTMLDivElement>) => void;
    onTouchMove: (e: React.TouchEvent<HTMLDivElement>) => void;
    onTouchEnd: () => void;
    onTouchCancel: () => void;
  };
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

  /** Last known scrollTop, used to detect scroll direction. */
  const lastScrollTopRef = useRef(0);

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

  /** rAF id for the continuous follow loop active during streaming. */
  const activeFollowLoopFrameRef = useRef<number | null>(null);

  /**
   * True while the pointer (mouse button) is held down inside the scroll container.
   * Used to detect scrollbar-drag, which fires `scroll` events that should NOT be
   * treated as programmatic even though `isProgrammaticScrollRef` might be set.
   */
  const pointerScrollActiveRef = useRef(false);

  /** The last Y coordinate during a touch gesture, used to detect swipe direction. */
  const touchYRef = useRef<number | null>(null);

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
    if (activeFollowLoopFrameRef.current !== null) {
      cancelAnimationFrame(activeFollowLoopFrameRef.current);
      activeFollowLoopFrameRef.current = null;
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
    lastScrollTopRef.current = container.scrollTop;

    // Release the programmatic flag one frame later so that the resulting
    // `scroll` event is ignored by handleMessagesScroll.
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

  // ── Event handlers (stable refs via useCallback) ─────────────

  const handleScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const currentScrollTop = container.scrollTop;
    const nextIsNearBottom = isNearBottom(container);
    const previousScrollTop = lastScrollTopRef.current;
    const isScrollingUp = currentScrollTop < previousScrollTop - SCROLL_UP_TOLERANCE_PX;
    lastScrollTopRef.current = currentScrollTop;

    // Ignore scroll events triggered by our own programmatic scrollToBottom,
    // unless the user is actively dragging (pointer down).
    if (isProgrammaticScrollRef.current && !pointerScrollActiveRef.current) return;

    // If the user has scrolled (back) to the bottom, re-enable auto-follow.
    if (nextIsNearBottom) {
      if (!isAutoScrollEnabledRef.current) {
        setFollowEnabled(true);
      }
      return;
    }

    // Only disable follow when the user is scrolling upward.
    if (!isScrollingUp) return;

    setFollowEnabled(false);
  }, [isNearBottom, setFollowEnabled]);

  const handleWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    if (event.deltaY < 0 && isAutoScrollEnabledRef.current) {
      setFollowEnabled(false);
    }
  }, [setFollowEnabled]);

  const handlePointerDown = useCallback(() => {
    pointerScrollActiveRef.current = true;
  }, []);

  const handleTouchStart = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    touchYRef.current = event.touches[0]?.clientY ?? null;
  }, []);

  const handleTouchMove = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    const nextTouchY = event.touches[0]?.clientY;
    const previousTouchY = touchYRef.current;
    touchYRef.current = nextTouchY ?? null;

    if (nextTouchY === undefined || previousTouchY === null) return;
    // Swiping downward (finger moves down) means the user wants to scroll UP → disable follow.
    if (nextTouchY > previousTouchY + SCROLL_UP_TOLERANCE_PX && isAutoScrollEnabledRef.current) {
      setFollowEnabled(false);
    }
  }, [setFollowEnabled]);

  const handleTouchEnd = useCallback(() => {
    touchYRef.current = null;
  }, []);

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

  // Clear the pointer-active flag when the pointer is released anywhere in the window.
  useEffect(() => {
    const clearPointerScroll = () => {
      pointerScrollActiveRef.current = false;
    };

    window.addEventListener('pointerup', clearPointerScroll);
    window.addEventListener('pointercancel', clearPointerScroll);

    return () => {
      window.removeEventListener('pointerup', clearPointerScroll);
      window.removeEventListener('pointercancel', clearPointerScroll);
    };
  }, []);

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
    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

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

  // Continuous rAF follow loop during active streaming – ensures Streamdown's
  // CSS height animation doesn't outrun the scroll position between
  // ResizeObserver callbacks.
  useEffect(() => {
    if (!isAutoScrollEnabled || !sending) {
      if (activeFollowLoopFrameRef.current !== null) {
        cancelAnimationFrame(activeFollowLoopFrameRef.current);
        activeFollowLoopFrameRef.current = null;
      }
      return;
    }

    const follow = () => {
      if (!isAutoScrollEnabledRef.current) {
        activeFollowLoopFrameRef.current = null;
        return;
      }
      scrollToBottom();
      activeFollowLoopFrameRef.current = requestAnimationFrame(follow);
    };

    follow();

    return () => {
      if (activeFollowLoopFrameRef.current !== null) {
        cancelAnimationFrame(activeFollowLoopFrameRef.current);
        activeFollowLoopFrameRef.current = null;
      }
    };
  }, [sending, isAutoScrollEnabled, scrollToBottom]);

  // ── Return ───────────────────────────────────────────────────

  return {
    containerRef,
    innerRef,
    isAutoScrollEnabled,
    scrollToBottomAndFollow,
    containerEventHandlers: {
      onScroll: handleScroll,
      onWheel: handleWheel,
      onPointerDown: handlePointerDown,
      onTouchStart: handleTouchStart,
      onTouchMove: handleTouchMove,
      onTouchEnd: handleTouchEnd,
      onTouchCancel: handleTouchEnd,
    },
  };
}
