import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import {
  SolvaScrollReveal,
  SolvaTwoToneHeading,
  SolvaAnimatedMetric,
} from './SolvaPrimitives';
import {
  StickyCardWidget,
  FeatureCardWidget,
  CohortBatchAuditWidget,
} from './SolvaMockupWidgets';

describe('Task 5: Editorial Calm, Scroll Latch & Honest Scholarly Telemetry', () => {
  type IOCallback = IntersectionObserverCallback;
  let ioCallbacks: Array<{ cb: IOCallback; elements: Set<Element> }> = [];
  const origIO = globalThis.IntersectionObserver;

  beforeEach(() => {
    vi.useFakeTimers();
    (globalThis as Record<string, unknown>).__CITRA_ENABLE_TEST_MOTION__ = true;
    Object.defineProperty(window, 'innerHeight', {
      value: 900,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(window, 'innerWidth', {
      value: 1440,
      configurable: true,
      writable: true,
    });

    ioCallbacks = [];
    class MockIntersectionObserver implements IntersectionObserver {
      readonly root: Element | Document | null = null;
      readonly rootMargin = '0px';
      readonly thresholds = [0];
      private record: { cb: IOCallback; elements: Set<Element> };

      constructor(cb: IOCallback) {
        this.record = { cb, elements: new Set() };
        ioCallbacks.push(this.record);
      }
      observe(el: Element) {
        this.record.elements.add(el);
      }
      unobserve(el: Element) {
        this.record.elements.delete(el);
      }
      disconnect() {
        this.record.elements.clear();
      }
      takeRecords(): IntersectionObserverEntry[] {
        return [];
      }
    }
    globalThis.IntersectionObserver =
      MockIntersectionObserver as unknown as typeof IntersectionObserver;
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__CITRA_ENABLE_TEST_MOTION__;
    globalThis.IntersectionObserver = origIO;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const triggerAllIntersections = (isIntersecting: boolean) => {
    for (const rec of ioCallbacks) {
      const entries = Array.from(rec.elements).map(
        (target) =>
          ({
            isIntersecting,
            target,
            intersectionRatio: isIntersecting ? 1 : 0,
          }) as unknown as IntersectionObserverEntry
      );
      if (entries.length > 0) {
        rec.cb(entries, {} as IntersectionObserver);
      }
    }
  };

  it('latches SolvaScrollReveal and SolvaTwoToneHeading permanently once revealed instead of re-blurring on scroll-up', () => {
    let mockTop = 220;
    let mockBottom = 300;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      () =>
        ({
          top: mockTop,
          bottom: mockBottom,
          left: 0,
          right: 600,
          width: 600,
          height: mockBottom - mockTop,
          x: 0,
          y: mockTop,
          toJSON: () => ({}),
        }) as DOMRect
    );

    const { container } = render(
      <div>
        <SolvaScrollReveal className="test-reveal">
          <p>Editorial paragraph</p>
        </SolvaScrollReveal>
        <SolvaTwoToneHeading
          as="h2"
          primary="Explainable citation logic."
          secondary="Built for academic rigor."
        />
      </div>
    );

    // Flush initial scroll subscription RAF + settle timers
    act(() => {
      triggerAllIntersections(true);
      window.dispatchEvent(new Event('scroll'));
      vi.advanceTimersByTime(1200);
    });

    const revealEl = container.querySelector('.test-reveal') as HTMLElement;
    const headingWord = container.querySelector('h2 span.inline-block') as HTMLElement;
    expect(revealEl.style.opacity).toBe('1');
    expect(revealEl.style.filter).toBe('none');
    expect(headingWord.style.opacity).toBe('1');
    expect(headingWord.style.filter).toBe('none');

    // Now simulate user scrolling back up so elements move below 91% viewport threshold
    mockTop = 860;
    mockBottom = 940;
    act(() => {
      window.dispatchEvent(new Event('scroll'));
      vi.advanceTimersByTime(500);
    });

    expect(revealEl.style.opacity).toBe('1');
    expect(revealEl.style.filter).toBe('none');
    expect(headingWord.style.opacity).toBe('1');
    expect(headingWord.style.filter).toBe('none');

    // Also simulate scrolling past top edge (rect.bottom < 44)
    mockTop = -120;
    mockBottom = 12;
    act(() => {
      window.dispatchEvent(new Event('scroll'));
      vi.advanceTimersByTime(500);
    });

    expect(revealEl.style.opacity).toBe('1');
    expect(headingWord.style.opacity).toBe('1');
  });

  it('counts SolvaAnimatedMetric up once on first viewport entry and never resets to 0 every 5.2s or on scroll-up', () => {
    let mockTop = 300;
    let mockBottom = 380;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      () =>
        ({
          top: mockTop,
          bottom: mockBottom,
          left: 0,
          right: 200,
          width: 200,
          height: 80,
          x: 0,
          y: mockTop,
          toJSON: () => ({}),
        }) as DOMRect
    );

    const { container } = render(
      <SolvaAnimatedMetric
        targetValue={96.4}
        decimals={1}
        suffix="%"
        label="Citation precision"
      />
    );

    // Complete initial 1500ms count-up
    act(() => {
      triggerAllIntersections(true);
      window.dispatchEvent(new Event('scroll'));
      vi.advanceTimersByTime(1800);
    });

    const metricValueEl = container.querySelector('.font-solva-serif') as HTMLElement;
    expect(metricValueEl.textContent).toBe('96.4%');

    // Advance right into the middle of the old 5200ms periodic reset window (5200ms + 100ms)
    act(() => {
      vi.advanceTimersByTime(5200);
      vi.advanceTimersByTime(80);
    });

    // Must remain pinned at 96.4%, NOT reset near 0%
    expect(metricValueEl.textContent).toBe('96.4%');

    // Scroll back up past bottom threshold — must remain 96.4% and visible
    mockTop = 880;
    mockBottom = 960;
    act(() => {
      window.dispatchEvent(new Event('scroll'));
      vi.advanceTimersByTime(200);
    });

    expect(metricValueEl.textContent).toBe('96.4%');
    expect((metricValueEl.parentElement as HTMLElement).style.opacity).toBe('1');
  });

  it('keeps scholarly DOIs, rule codes, citation standards, and record IDs crisp static text while using SubtleNumber for live micro-telemetry', () => {
    const { container } = render(
      <div>
        <StickyCardWidget index={0} lang="en" />
        <StickyCardWidget index={1} lang="en" />
        <FeatureCardWidget index={1} lang="en" />
        <CohortBatchAuditWidget lang="en" />
      </div>
    );

    // Trigger first intersection + 1 single RAF frame (16ms) where SolvaLiveNumber would otherwise show 0 / 2000
    act(() => {
      triggerAllIntersections(true);
      vi.advanceTimersByTime(16);
    });

    const text = container.textContent ?? '';
    // Immutable scholarly identifiers must NEVER transiently show 0 / 2000 / #000
    expect(text).toContain('10.1109/CVPR.2016.90');
    expect(text).toContain('IEEE [1]–[N]');
    expect(text).toContain('APA 7th (Author, Yr)');
    expect(text).toContain('Vancouver (1)');
    expect(text).toContain('R01_DOI_EXACT');
    expect(text).toContain('R05_YEAR_DRIFT');
    expect(text).toContain('Cited 2018 · Published 2019 (Δ=1yr)');
    expect(text).toContain('#018');
    expect(text).toContain('#047');
    expect(text).toContain('#104');

    // Live micro-telemetry (e.g. API latencies, NLI stance) uses transitions.dev #36 SubtleNumber (.t-subtle-number)
    expect(container.querySelectorAll('.t-subtle-number').length).toBeGreaterThan(0);

    // Finish initial one-shot count-up for Cohort summary totals (120 theses, 4,380 refs)
    act(() => {
      vi.advanceTimersByTime(1800);
    });
    expect(container.textContent).toContain('120 Graduation Theses (4,380 refs)');

    // Advance past the old 4800ms–5200ms replayIntervalMs + 16ms frame: totals must NOT reset to 0!
    act(() => {
      vi.advanceTimersByTime(5200);
      vi.advanceTimersByTime(16);
    });
    expect(container.textContent).toContain('120 Graduation Theses (4,380 refs)');
  });
});
