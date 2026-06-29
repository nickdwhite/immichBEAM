import { useCallback, useEffect, useRef, useState } from "react";

const GAP = 8;
const ROW_BUFFER = 4;

function colsForWidth(w: number): number {
  if (w >= 700) return 6;
  if (w >= 550) return 5;
  if (w >= 400) return 4;
  return 3;
}

export function VirtualGrid<T>({
  items,
  renderItem,
  getKey,
}: {
  items: T[];
  renderItem: (item: T) => React.ReactNode;
  getKey: (item: T) => string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState(4);
  const [containerWidth, setContainerWidth] = useState(600);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(800);
  const scrollerRef = useRef<Element | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width;
      setContainerWidth(w);
      setCols(colsForWidth(w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onScroll = useCallback(() => {
    const container = containerRef.current;
    const scroller = scrollerRef.current;
    if (!container || !scroller) return;
    const containerTop = container.getBoundingClientRect().top;
    const scrollerTop = scroller.getBoundingClientRect().top;
    setScrollTop(Math.max(0, scrollerTop - containerTop));
    setViewportHeight(scroller.clientHeight);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const scroller = el.closest(".overflow-auto") ?? el.closest("[style*='overflow']");
    if (!scroller) return;
    scrollerRef.current = scroller;
    setViewportHeight(scroller.clientHeight);
    scroller.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => scroller.removeEventListener("scroll", onScroll);
  }, [onScroll]);

  const tileSize = (containerWidth - (cols - 1) * GAP) / cols;
  const rowHeight = tileSize + GAP;
  const totalRows = Math.ceil(items.length / cols);
  const totalHeight = totalRows > 0 ? totalRows * rowHeight - GAP : 0;

  const startRow = Math.max(0, Math.floor(scrollTop / rowHeight) - ROW_BUFFER);
  const endRow = Math.min(
    totalRows,
    Math.ceil((scrollTop + viewportHeight) / rowHeight) + ROW_BUFFER,
  );
  const startIndex = startRow * cols;
  const endIndex = Math.min(items.length, endRow * cols);

  return (
    <div ref={containerRef} style={{ position: "relative", height: totalHeight }}>
      {items.slice(startIndex, endIndex).map((item, i) => {
        const idx = startIndex + i;
        const row = Math.floor(idx / cols);
        const col = idx % cols;
        return (
          <div
            key={getKey(item)}
            style={{
              position: "absolute",
              top: row * rowHeight,
              left: col * (tileSize + GAP),
              width: tileSize,
              height: tileSize,
            }}
          >
            {renderItem(item)}
          </div>
        );
      })}
    </div>
  );
}
