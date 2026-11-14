import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { measureTarget } from './uiGenerationEngine';
import { UIGenerationReveal } from '@/components/ui/transitions';
import { HeroVerificationMockup } from '@/components/landing/SolvaMockupWidgets';

function mockRect(
  el: Element,
  rect: { left: number; top: number; width: number; height: number },
) {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      left: rect.left,
      top: rect.top,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      width: rect.width,
      height: rect.height,
      x: rect.left,
      y: rect.top,
      toJSON: () => ({}),
    }),
  });
}

describe('Task 3: Real transitions-ui-generation Engine & UIGenerationReveal', () => {
  const originalCreateRange = document.createRange;

  beforeEach(() => {
    (globalThis as { __CITRA_ENABLE_TEST_MOTION__?: boolean }).__CITRA_ENABLE_TEST_MOTION__ = true;
  });

  afterEach(() => {
    delete (globalThis as { __CITRA_ENABLE_TEST_MOTION__?: boolean }).__CITRA_ENABLE_TEST_MOTION__;
    document.createRange = originalCreateRange;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('measureTarget extracts real boxes, key interactive controls, text line rects, and skips [data-t-generate-skip]', () => {
    const { container } = render(
      <div
        data-testid="card"
        style={{ backgroundColor: 'rgb(255, 255, 255)', borderRadius: '16px' }}
      >
        <div
          data-testid="header-box"
          style={{
            backgroundColor: 'rgb(244, 242, 236)',
            borderTopWidth: '1px',
            borderRadius: '10px',
          }}
        >
          Citation Verification Engine
        </div>
        <button
          type="button"
          data-testid="verify-btn"
          style={{
            backgroundColor: 'rgb(28, 26, 21)',
            borderRadius: '999px',
          }}
        >
          Inspect Source
        </button>
        <div
          data-testid="skipped-box"
          data-t-generate-skip=""
          style={{ backgroundColor: 'rgb(239, 68, 68)' }}
        >
          Skip Me
        </div>
      </div>,
    );

    const card = container.querySelector('[data-testid="card"]') as HTMLElement;
    const headerBox = container.querySelector('[data-testid="header-box"]') as HTMLElement;
    const verifyBtn = container.querySelector('[data-testid="verify-btn"]') as HTMLElement;
    const skippedBox = container.querySelector('[data-testid="skipped-box"]') as HTMLElement;

    mockRect(card, { left: 20, top: 40, width: 420, height: 260 });
    mockRect(headerBox, { left: 36, top: 56, width: 388, height: 48 });
    mockRect(verifyBtn, { left: 36, top: 130, width: 140, height: 36 });
    mockRect(skippedBox, { left: 36, top: 190, width: 120, height: 32 });

    document.createRange = () =>
      ({
        selectNodeContents: () => {},
        getClientRects: () => [
          {
            left: 44,
            top: 68,
            right: 240,
            bottom: 84,
            width: 196,
            height: 16,
          },
        ],
      }) as unknown as Range;

    const measured = measureTarget(card, { maxParts: 40, keys: 4 });
    expect(measured.w).toBe(420);
    expect(measured.h).toBe(260);

    const boxParts = measured.parts.filter((p) => p.kind === 'box');
    const textParts = measured.parts.filter((p) => p.kind === 'text');

    expect(boxParts.length).toBe(2);
    expect(boxParts.some((b) => b.name === 'button' && b.interactive && b.key)).toBe(true);
    expect(textParts.length).toBeGreaterThanOrEqual(1);
    // Skipped element at y = 190 - 40 = 150 must not appear
    expect(boxParts.some((b) => Math.abs(b.y - 150) < 1)).toBe(false);
  });

  it('builds real SVG dot-matrix + wireframe + scanline during active generation and settles to data-phase="done" with cleared SVG nodes', () => {
    vi.useFakeTimers();
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);

    const rafQueue: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      rafQueue.push(cb);
      return rafQueue.length;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});

    const flushRaf = (advanceMs: number) => {
      now += advanceMs;
      const batch = rafQueue.splice(0, rafQueue.length);
      batch.forEach((cb) => cb(now));
    };

    const { container, unmount } = render(
      <UIGenerationReveal
        durationMs={1000}
        steps={['STEP 1', 'STEP 2', 'READY']}
      >
        <div
          data-testid="mockup-card"
          style={{ backgroundColor: 'rgb(255, 255, 255)', borderRadius: '14px' }}
        >
          <button
            type="button"
            data-testid="inner-btn"
            style={{ backgroundColor: 'rgb(16, 185, 129)', borderRadius: '8px' }}
          >
            Run Audit
          </button>
        </div>
      </UIGenerationReveal>,
    );

    const targetWrap = container.querySelector('.t-gen-target') as HTMLElement;
    const mockupCard = container.querySelector('[data-testid="mockup-card"]') as HTMLElement;
    const innerBtn = container.querySelector('[data-testid="inner-btn"]') as HTMLElement;
    expect(targetWrap).not.toBeNull();

    mockRect(targetWrap, { left: 10, top: 20, width: 360, height: 220 });
    mockRect(mockupCard, { left: 10, top: 20, width: 360, height: 220 });
    mockRect(innerBtn, { left: 26, top: 44, width: 120, height: 34 });

    const genOverlay = container.querySelector('.t-gen') as HTMLElement;
    expect(genOverlay.getAttribute('data-phase')).toBe('active');

    // First RAF builds overlay and draws initial frame; second RAF advances into parts & reveal
    act(() => {
      flushRaf(16);
      flushRaf(420);
    });

    const svgEl = genOverlay.querySelector('.t-gen-svg') as SVGSVGElement;
    expect(svgEl).not.toBeNull();
    expect(svgEl.querySelectorAll('.t-gen-dot').length).toBeGreaterThan(10);
    expect(svgEl.querySelectorAll('.t-gen-wire').length).toBeGreaterThanOrEqual(2);
    expect(svgEl.querySelector('.t-gen-reticle')).not.toBeNull();

    // Advance past END (durationMs * 1.09 = 1090ms)
    act(() => {
      flushRaf(750);
    });

    expect(genOverlay.getAttribute('data-phase')).toBe('done');
    // Transient SVG child nodes are cleared after completion while .t-gen[data-phase="done"] remains mounted
    expect(svgEl.children.length).toBe(0);

    unmount();
  });

  it('fast-paths immediately to data-phase="done" under prefers-reduced-motion: reduce', () => {
    const origMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    try {
      const { container } = render(
        <UIGenerationReveal>
          <div>Static Hero Surface</div>
        </UIGenerationReveal>,
      );
      const genOverlay = container.querySelector('.t-gen') as HTMLElement;
      expect(genOverlay.getAttribute('data-phase')).toBe('done');
    } finally {
      window.matchMedia = origMatchMedia;
    }
  });

  it('HeroVerificationMockup mounts at full opacity without 0.001 stagger cloak and measureTarget captures descendants even during low-opacity transitions', () => {
    const { container } = render(
      <div>
        <div
          data-testid="fading-card"
          style={{ backgroundColor: 'rgb(255, 255, 255)', borderRadius: '12px' }}
        >
          <div
            data-testid="fading-child"
            style={{
              opacity: 0.001,
              backgroundColor: 'rgb(244, 242, 236)',
              borderTopWidth: '1px',
              borderRadius: '8px',
            }}
          >
            Queue Item
          </div>
        </div>
        <HeroVerificationMockup lang="en" activeStep={0} />
      </div>,
    );

    const fadingCard = container.querySelector('[data-testid="fading-card"]') as HTMLElement;
    const fadingChild = container.querySelector('[data-testid="fading-child"]') as HTMLElement;
    mockRect(fadingCard, { left: 0, top: 0, width: 400, height: 200 });
    mockRect(fadingChild, { left: 16, top: 20, width: 368, height: 48 });

    const measured = measureTarget(fadingCard, { maxParts: 20, keys: 3 });
    expect(measured.parts.filter((p) => p.kind === 'box').length).toBeGreaterThanOrEqual(1);

    const heroRoot = container.querySelector('.solva-glass-ring') as HTMLElement;
    expect(heroRoot).not.toBeNull();
    expect(heroRoot.style.opacity).not.toBe('0.001');
  });
});
