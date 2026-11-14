import { useEffect, useRef, useState } from 'react';

interface UseScrollAnimationOptions {
  threshold?: number;
  rootMargin?: string;
  once?: boolean;
  staggerMs?: number;
  maxTotalStaggerMs?: number;
}

export function useScrollAnimation<T extends HTMLElement = HTMLDivElement>(
  options: UseScrollAnimationOptions = {}
) {
  const { threshold = 0.1, rootMargin = '0px 0px -50px 0px', once = true } = options;
  const ref = useRef<T>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          if (once) {
            observer.unobserve(element);
          }
        } else if (!once) {
          setIsVisible(false);
        }
      },
      { threshold, rootMargin }
    );

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [threshold, rootMargin, once]);

  return { ref, isVisible };
}

/**
 * Staggered list entrance hook aligned with `transitions-polish`:
 * - Default step is 45ms (30–55ms range).
 * - Total stagger sequence is capped at <= 270ms (< 300ms rule) so longer lists never lag.
 * - Cleans up pending timers on unmount.
 */
export function useStaggeredAnimation<T extends HTMLElement = HTMLDivElement>(
  itemCount: number,
  options: UseScrollAnimationOptions = {}
) {
  const {
    threshold = 0.1,
    rootMargin = '0px 0px -50px 0px',
    staggerMs = 45,
    maxTotalStaggerMs = 270,
  } = options;
  const containerRef = useRef<T>(null);
  const [visibleItems, setVisibleItems] = useState<Set<number>>(new Set());

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const timers: ReturnType<typeof setTimeout>[] = [];
    const reduced =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const items = container.querySelectorAll('[data-stagger-item]');
            const total = items.length;
            if (reduced || total === 0) {
              setVisibleItems(new Set(Array.from({ length: total }, (_, i) => i)));
            } else {
              const effectiveStep =
                total > 1
                  ? Math.min(staggerMs, maxTotalStaggerMs / (total - 1))
                  : 0;
              items.forEach((_item, index) => {
                const delay = Math.round(index * effectiveStep);
                const id = setTimeout(() => {
                  setVisibleItems((prev) => new Set([...prev, index]));
                }, delay);
                timers.push(id);
              });
            }
            observer.unobserve(container);
          }
        });
      },
      { threshold, rootMargin }
    );

    observer.observe(container);

    return () => {
      observer.disconnect();
      timers.forEach((id) => clearTimeout(id));
    };
  }, [itemCount, threshold, rootMargin, staggerMs, maxTotalStaggerMs]);

  return { containerRef, visibleItems };
}
