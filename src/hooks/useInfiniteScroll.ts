import { useEffect, useRef } from "react";

export function useInfiniteScroll(
  loadMore: () => void,
  hasMore: boolean,
  rootMargin = "300px",
) {
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore();
      },
      { rootMargin },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore, loadMore, rootMargin]);

  return sentinelRef;
}
