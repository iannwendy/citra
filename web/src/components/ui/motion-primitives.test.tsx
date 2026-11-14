import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { useState } from 'react';
import fs from 'node:fs';
import path from 'node:path';
import {
  CitraMotionProvider,
  m,
  AnimatePresence,
  SPRING_PILL,
  SPRING_LAYOUT,
  TRANSITION_ENTER,
  TRANSITION_EXIT,
} from './motion-primitives';
import { useStaggeredAnimation } from '@/hooks/useScrollAnimation';

function PresenceHarness() {
  const [open, setOpen] = useState(true);
  return (
    <CitraMotionProvider>
      <button type="button" onClick={() => setOpen((v) => !v)}>
        toggle
      </button>
      <AnimatePresence>
        {open && (
          <m.div
            key="box"
            data-testid="motion-box"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: TRANSITION_ENTER }}
            exit={{ opacity: 0, transition: TRANSITION_EXIT }}
          >
            Active Motion Surface
          </m.div>
        )}
      </AnimatePresence>
    </CitraMotionProvider>
  );
}

function StaggerHarness() {
  const { containerRef, visibleItems } = useStaggeredAnimation(8);
  return (
    <div ref={containerRef} data-testid="stagger-root">
      {Array.from({ length: 8 }, (_, idx) => (
        <div
          key={idx}
          data-stagger-item
          data-visible={visibleItems.has(idx) ? 'true' : 'false'}
        >
          Item {idx}
        </div>
      ))}
    </div>
  );
}

describe('Task 1: Hybrid Motion Foundation & CSS Transition Hygiene', () => {
  it('renders m.* components inside CitraMotionProvider and unmounts cleanly via AnimatePresence', async () => {
    render(<PresenceHarness />);
    expect(screen.getByTestId('motion-box').textContent).toBe('Active Motion Surface');

    fireEvent.click(screen.getByText('toggle'));
    await waitFor(() => {
      expect(screen.queryByTestId('motion-box')).toBeNull();
    });
  });

  it('exports calibrated spring and asymmetric enter/exit presets', () => {
    expect(SPRING_PILL.type).toBe('spring');
    expect(SPRING_LAYOUT.type).toBe('spring');
    expect(TRANSITION_EXIT.duration).toBeLessThan(TRANSITION_ENTER.duration);
  });

  it('caps useStaggeredAnimation total sequence delay at <= 270ms (45ms default step)', () => {
    vi.useFakeTimers();
    let observerCb: IntersectionObserverCallback | null = null;
    const OriginalIO = globalThis.IntersectionObserver;

    class MockIO {
      constructor(cb: IntersectionObserverCallback) {
        observerCb = cb;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    globalThis.IntersectionObserver = MockIO as unknown as typeof IntersectionObserver;

    try {
      const { getAllByText } = render(<StaggerHarness />);
      expect(observerCb).not.toBeNull();
      act(() => {
        observerCb!(
          [{ isIntersecting: true } as IntersectionObserverEntry],
          {} as IntersectionObserver,
        );
      });

      // Within 275ms, ALL 8 items must be visible (capped sequence <= 270ms, never 700ms!)
      act(() => {
        vi.advanceTimersByTime(275);
      });
      const items = getAllByText(/Item \d/);
      items.forEach((el) => {
        expect(el.getAttribute('data-visible')).toBe('true');
      });
    } finally {
      globalThis.IntersectionObserver = OriginalIO;
      vi.useRealTimers();
    }
  });

  it('replaces broad transition-all anti-patterns in index.css component classes with explicit properties', () => {
    const cssPath = path.resolve(__dirname, '../../index.css');
    const css = fs.readFileSync(cssPath, 'utf-8');
    expect(css).not.toMatch(/@apply[^;]*\btransition-all\b/);
  });
});
