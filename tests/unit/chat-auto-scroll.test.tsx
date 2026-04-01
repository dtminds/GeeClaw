import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { useAutoScroll } from '@/pages/Chat/useAutoScroll';

type AutoScrollHarnessProps = {
  sessionId?: string;
  sending: boolean;
  pendingFinal: boolean;
  messagesLength: number;
  loading: boolean;
};

type ResizeObserverCallback = ConstructorParameters<typeof ResizeObserver>[0];

class MockResizeObserver {
  static instances: MockResizeObserver[] = [];

  callback: ResizeObserverCallback;
  observe = vi.fn();
  disconnect = vi.fn();

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    MockResizeObserver.instances.push(this);
  }

  trigger() {
    this.callback([], this as unknown as ResizeObserver);
  }
}

function AutoScrollHarness(props: AutoScrollHarnessProps) {
  const { containerRef, innerRef, isAutoScrollEnabled } = useAutoScroll(props);

  return (
    <>
      <div data-testid="follow-state">{isAutoScrollEnabled ? 'enabled' : 'disabled'}</div>
      <div ref={containerRef} data-testid="scroll-container">
        <div ref={innerRef} data-testid="scroll-inner" />
      </div>
    </>
  );
}

function defineScrollMetrics(element: HTMLDivElement, metrics: { scrollHeight: number; clientHeight: number }) {
  Object.defineProperty(element, 'scrollHeight', {
    configurable: true,
    get: () => metrics.scrollHeight,
  });
  Object.defineProperty(element, 'clientHeight', {
    configurable: true,
    get: () => metrics.clientHeight,
  });
}

describe('useAutoScroll', () => {
  const originalResizeObserver = globalThis.ResizeObserver;
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
  let nextAnimationFrameId = 1;
  let frameQueue = new Map<number, FrameRequestCallback>();

  const flushAnimationFrame = () => {
    const queued = Array.from(frameQueue.entries());
    frameQueue = new Map();
    for (const [, callback] of queued) {
      callback(performance.now());
    }
  };

  beforeEach(() => {
    MockResizeObserver.instances = [];
    nextAnimationFrameId = 1;
    frameQueue = new Map();

    vi.stubGlobal('ResizeObserver', MockResizeObserver);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = nextAnimationFrameId++;
      frameQueue.set(id, callback);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      frameQueue.delete(id);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    globalThis.ResizeObserver = originalResizeObserver;
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  it('stops following when the user scrolls upward during streaming growth', () => {
    const metrics = { scrollHeight: 1000, clientHeight: 400 };
    render(
      <AutoScrollHarness
        sessionId="session-1"
        sending
        pendingFinal={false}
        messagesLength={3}
        loading={false}
      />,
    );

    const container = screen.getByTestId('scroll-container') as HTMLDivElement;
    defineScrollMetrics(container, metrics);
    container.scrollTop = metrics.scrollHeight;

    act(() => {
      metrics.scrollHeight = 1200;
      MockResizeObserver.instances[0]?.trigger();
      flushAnimationFrame();
    });

    expect(container.scrollTop).toBe(1200);
    expect(screen.getByTestId('follow-state')).toHaveTextContent('enabled');

    act(() => {
      container.scrollTop = 500;
      fireEvent.scroll(container);
      flushAnimationFrame();
    });

    expect(screen.getByTestId('follow-state')).toHaveTextContent('disabled');

    act(() => {
      metrics.scrollHeight = 1400;
      MockResizeObserver.instances[0]?.trigger();
      flushAnimationFrame();
    });

    expect(container.scrollTop).toBe(500);
    expect(screen.getByTestId('follow-state')).toHaveTextContent('disabled');
  });

  it('resumes following only after the user scrolls back to the bottom', () => {
    const metrics = { scrollHeight: 1000, clientHeight: 400 };
    render(
      <AutoScrollHarness
        sessionId="session-2"
        sending
        pendingFinal={false}
        messagesLength={3}
        loading={false}
      />,
    );

    const container = screen.getByTestId('scroll-container') as HTMLDivElement;
    defineScrollMetrics(container, metrics);
    container.scrollTop = metrics.scrollHeight;

    act(() => {
      container.scrollTop = 500;
      fireEvent.scroll(container);
      flushAnimationFrame();
    });

    expect(screen.getByTestId('follow-state')).toHaveTextContent('disabled');

    act(() => {
      container.scrollTop = 820;
      fireEvent.scroll(container);
      flushAnimationFrame();
    });

    expect(screen.getByTestId('follow-state')).toHaveTextContent('enabled');

    act(() => {
      metrics.scrollHeight = 1400;
      MockResizeObserver.instances[0]?.trigger();
      flushAnimationFrame();
    });

    expect(container.scrollTop).toBe(1400);
    expect(screen.getByTestId('follow-state')).toHaveTextContent('enabled');
  });
});
