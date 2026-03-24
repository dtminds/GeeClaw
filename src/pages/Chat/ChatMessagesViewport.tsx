import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { ChatMessage } from './ChatMessage';
import type { ChatRenderItem } from './build-chat-items';
import type { ContentBlock, RawMessage } from '@/stores/chat';

const ROW_GAP_PX = 8;
const OVERSCAN_PX = 1200;
const VIRTUALIZATION_THRESHOLD = 40;
const MIN_ITEM_HEIGHT_PX = 96;

type ChatMessagesViewportProps = {
  items: ChatRenderItem[];
  containerRef: RefObject<HTMLDivElement | null>;
  innerRef: RefObject<HTMLDivElement | null>;
  showThinking: boolean;
  showToolCalls: boolean;
  footer?: ReactNode;
};

type ViewportState = {
  scrollTop: number;
  viewportHeight: number;
};

type MetricRow = {
  item: ChatRenderItem;
  top: number;
  height: number;
};

function estimateTextLength(content: RawMessage['content']): number {
  if (typeof content === 'string') {
    return content.length;
  }

  if (!Array.isArray(content)) {
    return 0;
  }

  let length = 0;
  for (const block of content as ContentBlock[]) {
    if (typeof block.text === 'string') {
      length += block.text.length;
    }
    if (typeof block.thinking === 'string') {
      length += block.thinking.length;
    }
  }
  return length;
}

function estimateItemHeight(item: ChatRenderItem): number {
  const { message } = item;
  const content = Array.isArray(message.content) ? message.content as ContentBlock[] : [];
  const images = content.filter((block) => block.type === 'image').length;
  const toolBlocks = content.filter((block) => block.type === 'tool_use' || block.type === 'toolCall').length;
  const thinkingBlocks = content.filter((block) => block.type === 'thinking').length;
  const attachments = message._attachedFiles?.length ?? 0;
  const textLength = estimateTextLength(message.content);
  const lineEstimate = Math.ceil(textLength / 180);

  let estimatedHeight = message.role === 'user' ? 88 : 132;
  estimatedHeight += Math.min(720, lineEstimate * 26);
  estimatedHeight += images * 144;
  estimatedHeight += attachments * 92;
  estimatedHeight += toolBlocks * 44;
  estimatedHeight += thinkingBlocks * 36;

  if (item.isStreaming) {
    estimatedHeight += 32;
  }

  return Math.max(MIN_ITEM_HEIGHT_PX, estimatedHeight + ROW_GAP_PX);
}

function buildMetrics(
  items: ChatRenderItem[],
  itemHeights: Record<string, number>,
  estimatedHeights: number[],
): {
  rows: MetricRow[];
  totalHeight: number;
} {
  const rows = new Array<MetricRow>(items.length);
  let totalHeight = 0;

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!;
    const height = itemHeights[item.key] ?? estimatedHeights[index] ?? MIN_ITEM_HEIGHT_PX;
    rows[index] = {
      item,
      top: totalHeight,
      height,
    };
    totalHeight += height;
  }

  return { rows, totalHeight };
}

function findVisibleRows(
  rows: MetricRow[],
  scrollTop: number,
  viewportHeight: number,
): { startIndex: number; endIndex: number } {
  const startBoundary = Math.max(0, scrollTop - OVERSCAN_PX);
  const endBoundary = scrollTop + viewportHeight + OVERSCAN_PX;

  let startIndex = 0;
  while (startIndex < rows.length && rows[startIndex]!.top + rows[startIndex]!.height < startBoundary) {
    startIndex += 1;
  }

  let endIndex = startIndex;
  while (endIndex < rows.length && rows[endIndex]!.top < endBoundary) {
    endIndex += 1;
  }

  return {
    startIndex,
    endIndex: Math.min(rows.length - 1, Math.max(startIndex, endIndex - 1)),
  };
}

function VirtualizedRow({
  itemKey,
  onHeightChange,
  children,
}: {
  itemKey: string;
  onHeightChange: (itemKey: string, height: number) => void;
  children: ReactNode;
}) {
  const rowRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const node = rowRef.current;
    if (!node) return;

    const measure = () => {
      onHeightChange(itemKey, Math.ceil(node.getBoundingClientRect().height) + ROW_GAP_PX);
    };

    measure();

    const observer = new ResizeObserver(() => {
      measure();
    });
    observer.observe(node);

    return () => {
      observer.disconnect();
    };
  }, [itemKey, onHeightChange]);

  return (
    <div ref={rowRef} className="pb-2">
      {children}
    </div>
  );
}

export function ChatMessagesViewport({
  items,
  containerRef,
  innerRef,
  showThinking,
  showToolCalls,
  footer,
}: ChatMessagesViewportProps) {
  const shouldVirtualize = items.length >= VIRTUALIZATION_THRESHOLD;
  const [itemHeights, setItemHeights] = useState<Record<string, number>>({});
  const [viewport, setViewport] = useState<ViewportState>({ scrollTop: 0, viewportHeight: 0 });

  const estimatedHeights = useMemo(() => items.map((item) => estimateItemHeight(item)), [items]);

  const updateViewport = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const nextState = {
      scrollTop: container.scrollTop,
      viewportHeight: container.clientHeight,
    };

    setViewport((current) => (
      current.scrollTop === nextState.scrollTop && current.viewportHeight === nextState.viewportHeight
        ? current
        : nextState
    ));
  }, [containerRef]);

  useLayoutEffect(() => {
    updateViewport();
  }, [updateViewport]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let frameId: number | null = null;
    const queueViewportUpdate = () => {
      if (frameId !== null) return;
      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        updateViewport();
      });
    };

    const resizeObserver = new ResizeObserver(() => {
      queueViewportUpdate();
    });

    resizeObserver.observe(container);
    container.addEventListener('scroll', queueViewportUpdate, { passive: true });

    return () => {
      resizeObserver.disconnect();
      container.removeEventListener('scroll', queueViewportUpdate);
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
      }
    };
  }, [containerRef, updateViewport]);

  const handleHeightChange = useCallback((itemKey: string, height: number) => {
    setItemHeights((current) => (
      current[itemKey] === height
        ? current
        : { ...current, [itemKey]: height }
    ));
  }, []);

  const metrics = useMemo(() => {
    return buildMetrics(items, itemHeights, estimatedHeights);
  }, [estimatedHeights, itemHeights, items]);

  const visibleRows = useMemo(() => {
    if (!shouldVirtualize) {
      return {
        startIndex: 0,
        endIndex: metrics.rows.length - 1,
      };
    }

    return findVisibleRows(metrics.rows, viewport.scrollTop, viewport.viewportHeight);
  }, [metrics.rows, shouldVirtualize, viewport.scrollTop, viewport.viewportHeight]);

  const topSpacerHeight = shouldVirtualize
    ? (metrics.rows[visibleRows.startIndex]?.top ?? 0)
    : 0;
  const lastVisibleRow = metrics.rows[visibleRows.endIndex];
  const bottomSpacerHeight = shouldVirtualize && lastVisibleRow
    ? Math.max(0, metrics.totalHeight - lastVisibleRow.top - lastVisibleRow.height)
    : 0;
  const rowsToRender = shouldVirtualize
    ? metrics.rows.slice(visibleRows.startIndex, visibleRows.endIndex + 1)
    : metrics.rows;

  if (!shouldVirtualize) {
    return (
      <div ref={innerRef} className="max-w-4xl mx-auto w-full space-y-2 px-4">
        {items.map((item) => (
          <ChatMessage
            key={item.key}
            message={item.message}
            showThinking={showThinking}
            showToolCalls={showToolCalls}
            isStreaming={item.isStreaming}
          />
        ))}
        {footer}
      </div>
    );
  }

  return (
    <div ref={innerRef} className="max-w-4xl mx-auto w-full px-4">
      {topSpacerHeight > 0 && <div aria-hidden="true" style={{ height: topSpacerHeight }} />}

      {rowsToRender.map(({ item }) => (
        <VirtualizedRow key={item.key} itemKey={item.key} onHeightChange={handleHeightChange}>
          <ChatMessage
            message={item.message}
            showThinking={showThinking}
            showToolCalls={showToolCalls}
            isStreaming={item.isStreaming}
          />
        </VirtualizedRow>
      ))}

      {bottomSpacerHeight > 0 && <div aria-hidden="true" style={{ height: bottomSpacerHeight }} />}
      {footer}
    </div>
  );
}
