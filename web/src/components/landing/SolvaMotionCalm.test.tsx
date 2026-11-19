import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { CitraMotionProvider } from '@/components/ui/motion-primitives';
import { LandingPage } from '@/pages/LandingPage';
import {
  SolvaScrollReveal,
  SolvaTwoToneHeading,
  SolvaAnimatedMetric,
  SolvaStickyStackCard,
} from './SolvaPrimitives';
import {
  HeroVerificationMockup,
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

  it('supports configurable baseTopDesktop and baseTopMobile on SolvaStickyStackCard while preserving 92/76 defaults', () => {
    const { getByTestId, unmount } = render(
      <div>
        <SolvaStickyStackCard index={0} total={3}>
          <div>Default card 0</div>
        </SolvaStickyStackCard>
      </div>,
    );
    expect(getByTestId('solva-sticky-card-0').style.top).toBe('92px');
    unmount();

    const { getByTestId: getCustomByTestId } = render(
      <div>
        <SolvaStickyStackCard index={0} total={3} baseTopDesktop={132} baseTopMobile={118}>
          <div>Subnav-cleared card 0</div>
        </SolvaStickyStackCard>
        <SolvaStickyStackCard index={1} total={3} baseTopDesktop={132} baseTopMobile={118}>
          <div>Subnav-cleared card 1</div>
        </SolvaStickyStackCard>
      </div>,
    );
    expect(getCustomByTestId('solva-sticky-card-0').style.top).toBe('132px');
    expect(getCustomByTestId('solva-sticky-card-1').style.top).toBe('160px');

    Object.defineProperty(window, 'innerWidth', {
      value: 390,
      configurable: true,
      writable: true,
    });
    act(() => {
      window.dispatchEvent(new Event('resize'));
      vi.advanceTimersByTime(50);
    });
    expect(getCustomByTestId('solva-sticky-card-0').style.top).toBe('118px');
    expect(getCustomByTestId('solva-sticky-card-1').style.top).toBe('136px');
  });
});

describe('Task 1.6: Zero Clipping, Truncation & Orphan-Punctuation Guards (EN & VI)', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  afterEach(async () => {
    await i18n.changeLanguage('en');
    vi.restoreAllMocks();
  });

  function renderLandingApp() {
    return render(
      <CitraMotionProvider>
        <ThemeProvider defaultTheme="light">
          <MemoryRouter initialEntries={['/']}>
            <LandingPage />
          </MemoryRouter>
        </ThemeProvider>
      </CitraMotionProvider>,
    );
  }

  it('HeroVerificationMockup and Hero generation header pill render full source names with zero .truncate or right-edge overhang in EN and VI', async () => {
    for (const lang of ['en', 'vi'] as const) {
      await i18n.changeLanguage(lang);

      // Verify all 3 citation steps in HeroVerificationMockup have zero .truncate and full source names
      for (const step of [0, 1, 2]) {
        const { container, unmount } = render(
          <HeroVerificationMockup lang={lang} activeStep={step} />,
        );
        const text = container.textContent ?? '';

        expect(text).toContain('Crossref');
        expect(text).toContain('OpenAlex');
        expect(text).toContain('Semantic Scholar');
        expect(text).not.toContain('SemanticSch');
        expect(text).not.toContain('Semant..');
        expect(text).not.toContain('...');
        expect(text).not.toContain('…');

        // Zero .truncate classes anywhere inside HeroVerificationMockup
        expect(container.querySelectorAll('.truncate')).toHaveLength(0);

        // Source chips and top/verdict badges use whitespace-nowrap + shrink-0 so they never break mid-chip
        const semanticLink = container.querySelector(
          'a[aria-label="Semantic Scholar official website"]',
        );
        expect(semanticLink).not.toBeNull();
        expect(semanticLink?.className).toContain('whitespace-nowrap');
        expect(semanticLink?.className).toContain('shrink-0');

        unmount();
      }

      // Also verify LandingPage Hero right frame does not push mockup past right edge (no lg:right-[-24px])
      // and generation header pill displays concise non-clipped S-BERT status without .truncate
      const prevMotion = (globalThis as { __CITRA_ENABLE_TEST_MOTION__?: boolean })
        .__CITRA_ENABLE_TEST_MOTION__;
      (globalThis as { __CITRA_ENABLE_TEST_MOTION__?: boolean }).__CITRA_ENABLE_TEST_MOTION__ =
        true;
      const origMatchMedia = window.matchMedia;
      window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));

      let now = 1000;
      vi.spyOn(performance, 'now').mockImplementation(() => now);
      const rafQueue: FrameRequestCallback[] = [];
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
        rafQueue.push(cb);
        return rafQueue.length;
      });
      vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});

      try {
        const landing = renderLandingApp();
        const heroSection = landing.container.querySelector('#hero') as HTMLElement;
        expect(heroSection).not.toBeNull();
        expect(heroSection.innerHTML).not.toContain('right-[-24px]');

        const targetEl = heroSection.querySelector('.t-gen-target') as HTMLElement;
        if (targetEl) {
          Object.defineProperty(targetEl, 'getBoundingClientRect', {
            configurable: true,
            value: () => ({
              left: 20,
              top: 20,
              right: 620,
              bottom: 420,
              width: 600,
              height: 400,
              x: 20,
              y: 20,
              toJSON: () => ({}),
            }),
          });
        }

        // Advance into step 2 (middle of generation -> S-BERT calibration step)
        act(() => {
          const b1 = rafQueue.splice(0, rafQueue.length);
          b1.forEach((cb) => cb(now));
          now += 720;
          const b2 = rafQueue.splice(0, rafQueue.length);
          b2.forEach((cb) => cb(now));
        });

        const genTag = heroSection.querySelector('.t-gen-tag') as HTMLElement | null;
        expect(genTag).not.toBeNull();
        expect(genTag?.className ?? '').not.toContain('truncate');
        expect(genTag?.textContent ?? '').toContain('S-BERT');
        expect(genTag?.textContent ?? '').not.toContain('S-BER...');
        expect((genTag?.textContent ?? '').length).toBeLessThanOrEqual(24);

        landing.unmount();
      } finally {
        window.matchMedia = origMatchMedia;
        if (prevMotion === undefined) {
          delete (globalThis as { __CITRA_ENABLE_TEST_MOTION__?: boolean })
            .__CITRA_ENABLE_TEST_MOTION__;
        } else {
          (globalThis as { __CITRA_ENABLE_TEST_MOTION__?: boolean }).__CITRA_ENABLE_TEST_MOTION__ =
            prevMotion;
        }
        vi.restoreAllMocks();
      }
    }
  });

  it('hero-benchmark-120k-strip contains zero .truncate classes and zero ellipsis across all 4 proof items in EN and VI', async () => {
    for (const lang of ['en', 'vi'] as const) {
      await i18n.changeLanguage(lang);
      const { getByTestId, unmount } = renderLandingApp();

      const strip = getByTestId('hero-benchmark-120k-strip');
      expect(strip.querySelectorAll('.truncate')).toHaveLength(0);

      const stripText = strip.textContent ?? '';
      expect(stripText).not.toContain('...');
      expect(stripText).not.toContain('…');
      expect(stripText).toContain('99.02%');
      expect(stripText).toContain('99.75%');
      expect(stripText).toContain('15+');
      expect(stripText).toContain(lang === 'vi' ? '120.000' : '120,000');

      unmount();
    }
  });

  it('Hero top announcement pill binds its final word + arrow inside .citra-nowrap-tail (whitespace-nowrap) in EN and VI so → never orphans on narrow mobile', async () => {
    Object.defineProperty(window, 'innerWidth', {
      value: 375,
      configurable: true,
      writable: true,
    });

    for (const lang of ['en', 'vi'] as const) {
      await i18n.changeLanguage(lang);
      const { container, unmount } = renderLandingApp();

      const hero = container.querySelector('#hero') as HTMLElement;
      const benchmarkLinks = Array.from(
        hero.querySelectorAll('a[href="#benchmark-120k"]'),
      ) as HTMLAnchorElement[];
      const announcementPill = benchmarkLinks.find(
        (a) => a.getAttribute('data-testid') !== 'hero-benchmark-120k-strip',
      );
      expect(announcementPill).toBeDefined();

      // Must NOT leave a standalone <svg> arrow as a direct flex child of the wrapping <a>
      const directChildSvgs = Array.from(announcementPill!.children).filter(
        (el) => el.tagName.toLowerCase() === 'svg',
      );
      expect(directChildSvgs).toHaveLength(0);

      const nowrapTail = announcementPill!.querySelector('.citra-nowrap-tail');
      expect(nowrapTail).not.toBeNull();
      expect(nowrapTail?.className).toContain('whitespace-nowrap');
      // Must bind at least one word character together with →
      expect((nowrapTail?.textContent ?? '').trim()).toMatch(/\S+\s*→$/);

      unmount();
    }
  });

  it('Architecture Card 3 and all parenthetical/percentage badges in FeatureCardWidget and StickyCardWidget wrap status + (XX%) in .citra-nowrap-tail without .truncate', () => {
    for (const lang of ['en', 'vi'] as const) {
      // Architecture Card 3 (FeatureCardWidget index=2)
      const card3 = render(<FeatureCardWidget index={2} lang={lang} />);
      expect(card3.container.querySelectorAll('.truncate')).toHaveLength(0);

      const expectedBadgePrefix = lang === 'vi' ? 'KHỚP (' : 'ALIGNED (';
      const nowrapBadges = Array.from(
        card3.container.querySelectorAll('.citra-nowrap-tail'),
      );
      const alignedBadge = nowrapBadges.find((el) =>
        (el.textContent ?? '').includes(expectedBadgePrefix),
      );
      expect(alignedBadge).toBeDefined();
      expect(alignedBadge?.className).toContain('whitespace-nowrap');
      expect((alignedBadge?.textContent ?? '').trim()).toBe(
        lang === 'vi' ? 'KHỚP (94%)' : 'ALIGNED (94%)',
      );

      // Also check (0.97) in Card 3 symbolic rule expression is bound inside .citra-nowrap-tail
      expect(
        nowrapBadges.some((el) => (el.textContent ?? '').trim() === '(0.97)'),
      ).toBe(true);
      card3.unmount();

      // FeatureCardWidget index=0 & index=1 and StickyCardWidget index=0, 1, 2
      const others = render(
        <div>
          <div data-testid="feat-0">
            <FeatureCardWidget index={0} lang={lang} />
          </div>
          <div data-testid="feat-1">
            <FeatureCardWidget index={1} lang={lang} />
          </div>
          <div data-testid="sticky-0">
            <StickyCardWidget index={0} lang={lang} />
          </div>
          <div data-testid="sticky-1">
            <StickyCardWidget index={1} lang={lang} />
          </div>
          <div data-testid="sticky-2">
            <StickyCardWidget index={2} lang={lang} />
          </div>
        </div>,
      );

      expect(others.container.querySelectorAll('.truncate')).toHaveLength(0);

      const feat0Tails = Array.from(
        within(others.getByTestId('feat-0'))
          .getAllByText((_c, el) => Boolean(el?.classList.contains('citra-nowrap-tail'))),
      ).map((el) => (el.textContent ?? '').trim());
      expect(feat0Tails.some((t) => t.includes('2020') && t.endsWith('2021)'))).toBe(true);

      const sticky0Tails = Array.from(
        others.getByTestId('sticky-0').querySelectorAll('.citra-nowrap-tail'),
      ).map((el) => (el.textContent ?? '').trim());
      expect(sticky0Tails).toContain('(Author, Yr)');
      expect(sticky0Tails).toContain('(1)');

      const sticky1Tails = Array.from(
        others.getByTestId('sticky-1').querySelectorAll('.citra-nowrap-tail'),
      ).map((el) => (el.textContent ?? '').trim());
      expect(sticky1Tails).toContain(lang === 'vi' ? '(Δ=1 năm)' : '(Δ=1yr)');

      const sticky2Tails = Array.from(
        others.getByTestId('sticky-2').querySelectorAll('.citra-nowrap-tail'),
      ).map((el) => (el.textContent ?? '').trim());
      expect(sticky2Tails).toContain(
        lang === 'vi' ? '(Trước rà soát)' : '(Before Audit)',
      );
      expect(sticky2Tails).toContain(
        lang === 'vi' ? '(Đã chuẩn hóa)' : '(Verified)',
      );

      others.unmount();
    }
  });
});
