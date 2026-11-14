import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from '@/i18n';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { ToastProvider } from '@/contexts/ToastContext';
import { AuthContext } from '@/contexts/AuthContext';
import { CitraMotionProvider } from '@/components/ui/motion-primitives';
import { LandingPage } from '@/pages/LandingPage';
import { PricingPage } from '@/pages/PricingPage';

type IOListener = (entries: IntersectionObserverEntry[]) => void;

describe('Task 6 — Landing Page & Pricing Interactive Choreography', () => {
  let ioCallbacks: Array<{ target: Element; cb: IOListener }> = [];

  beforeEach(async () => {
    vi.useFakeTimers();
    await i18n.changeLanguage('en');
    (globalThis as { __CITRA_ENABLE_TEST_MOTION__?: boolean }).__CITRA_ENABLE_TEST_MOTION__ =
      true;

    ioCallbacks = [];
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    class MockIntersectionObserver {
      private cb: IOListener;
      constructor(cb: IOListener) {
        this.cb = cb;
      }
      observe(target: Element) {
        ioCallbacks.push({ target, cb: this.cb });
      }
      unobserve() {}
      disconnect() {}
    }

    Object.defineProperty(window, 'IntersectionObserver', {
      writable: true,
      value: MockIntersectionObserver,
    });
  });

  afterEach(() => {
    delete (globalThis as { __CITRA_ENABLE_TEST_MOTION__?: boolean })
      .__CITRA_ENABLE_TEST_MOTION__;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function intersectAll() {
    act(() => {
      ioCallbacks.forEach(({ target, cb }) => {
        cb([
          {
            isIntersecting: true,
            intersectionRatio: 1,
            target,
          } as IntersectionObserverEntry,
        ]);
      });
    });
  }

  function renderLanding() {
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

  function renderPricing() {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    return render(
      <CitraMotionProvider>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider defaultTheme="light">
            <ToastProvider>
              <AuthContext.Provider
                value={{
                  user: null,
                  token: null,
                  isLoading: false,
                  isAdmin: false,
                  login: vi.fn(),
                  logout: vi.fn(),
                  refreshUser: vi.fn().mockResolvedValue(undefined),
                }}
              >
                <MemoryRouter initialEntries={['/pricing']}>
                  <PricingPage />
                </MemoryRouter>
              </AuthContext.Provider>
            </ToastProvider>
          </ThemeProvider>
        </QueryClientProvider>
      </CitraMotionProvider>,
    );
  }

  it('Interactive Debugger renders Auto-Tour progress bar, pauses on hover, and switches via NumberPopIn + SoftTextSwap without resetting active tab', () => {
    const { container } = renderLanding();
    intersectAll();

    const demoSection = container.querySelector('#interactive-demo') as HTMLElement;
    expect(demoSection).not.toBeNull();

    const progress = within(demoSection).getByTestId('debugger-autotour-progress');
    expect(progress.getAttribute('data-paused')).toBe('false');

    const options = within(demoSection).getAllByRole('option');
    expect(options[1].getAttribute('aria-selected')).toBe('true');

    // Hovering over debugger bezel pauses auto-tour
    const debuggerBezel = within(demoSection).getByTestId('debugger-bezel');
    fireEvent.mouseEnter(debuggerBezel);
    expect(
      within(demoSection).getByTestId('debugger-autotour-progress').getAttribute('data-paused'),
    ).toBe('true');

    // Advancing past 4200ms while hovered MUST NOT advance selected citation
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(options[1].getAttribute('aria-selected')).toBe('true');

    // Leaving resumes auto-tour and advances after ~4200ms
    fireEvent.mouseLeave(debuggerBezel);
    expect(
      within(demoSection).getByTestId('debugger-autotour-progress').getAttribute('data-paused'),
    ).toBe('false');
    act(() => {
      vi.advanceTimersByTime(4300);
    });
    expect(options[2].getAttribute('aria-selected')).toBe('true');

    // Manual click stops auto-tour, renders per-digit NumberPopIn confidence & SoftTextSwap cells
    fireEvent.click(options[0]);
    expect(within(demoSection).queryByTestId('debugger-autotour-progress')).toBeNull();

    const activeConf = within(demoSection).getByTestId('debugger-active-confidence');
    expect(activeConf.classList.contains('t-digit-group')).toBe(true);
    expect(activeConf.textContent).toBe('99%');
    expect(demoSection.querySelectorAll('.t-text-soft').length).toBeGreaterThan(0);
  });

  it('4-Stage Pipeline (#how-it-works) renders sliding .t-tabs-pill across role="tab" buttons and wraps stage visual in causal DirectionalStageSlide', () => {
    const { container } = renderLanding();
    intersectAll();

    const pipelineSection = container.querySelector('#how-it-works') as HTMLElement;
    expect(pipelineSection).not.toBeNull();

    const pill = within(pipelineSection).getByTestId('pipeline-tabs-pill');
    expect(pill.classList.contains('t-tabs-pill')).toBe(true);

    const tabs = within(pipelineSection).getAllByRole('tab');
    expect(tabs).toHaveLength(4);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(within(pipelineSection).getByTestId('pipeline-autotour-progress')).toBeDefined();

    const slideViewport = within(pipelineSection).getByTestId('pipeline-stage-slide');
    expect(slideViewport.classList.contains('t-stage-slide-viewport')).toBe(true);

    // Click Stage 3 (index 2) -> causal forward direction (+1), stops auto-cycle
    fireEvent.click(tabs[2]);
    expect(tabs[2].getAttribute('aria-selected')).toBe('true');
    expect(slideViewport.getAttribute('data-direction')).toBe('1');
    expect(within(pipelineSection).queryByTestId('pipeline-autotour-progress')).toBeNull();

    // Click Stage 1 (index 0) -> causal backward direction (-1)
    fireEvent.click(tabs[0]);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(slideViewport.getAttribute('data-direction')).toBe('-1');
  });

  it('LandingPage (#taxonomy) uses TactileToggle and both LandingPage & PricingPage use per-digit NumberPopIn with pure synchronous textContent', () => {
    const { unmount } = renderLanding();
    intersectAll();

    const toggle = screen.getByTestId('landing-billing-toggle');
    expect(toggle.getAttribute('role')).toBe('switch');
    expect(toggle.classList.contains('t-toggle')).toBe(true);

    const landingPro = screen.getByTestId('landing-price-pro');
    const landingUltra = screen.getByTestId('landing-price-ultra');
    expect(landingPro.classList.contains('t-digit-group')).toBe(true);
    expect(landingPro.textContent).toBe('$20');
    expect(landingUltra.textContent).toBe('$200');

    // Toggle to annual -> $16 and $160 immediately with stationary '$' prefix
    fireEvent.click(toggle);
    expect(landingPro.textContent).toBe('$16');
    expect(landingUltra.textContent).toBe('$160');

    unmount();

    renderPricing();
    intersectAll();

    const proDisplay = screen.getByTestId('pro-price-display');
    const ultraDisplay = screen.getByTestId('ultra-price-display');
    expect(proDisplay.querySelector('.t-digit-group')).not.toBeNull();
    expect(ultraDisplay.querySelector('.t-digit-group')).not.toBeNull();
    expect(proDisplay.textContent).toBe('$16');
    expect(ultraDisplay.textContent).toBe('$160');

    fireEvent.click(screen.getByTestId('billing-toggle-monthly'));
    expect(proDisplay.textContent).toBe('$20');
    expect(ultraDisplay.textContent).toBe('$200');
  });

  it('FAQ accordions on LandingPage (#faq) and PricingPage (#pricing-faq) calibrate asymmetric 300ms open / 190ms close durations', () => {
    const { container, unmount } = renderLanding();

    const faqSection = container.querySelector('#faq') as HTMLElement;
    const secondFaqBtn = within(faqSection).getAllByRole('button')[1];
    const panel = secondFaqBtn.nextElementSibling as HTMLElement;

    expect(panel.getAttribute('data-open')).toBe('false');
    expect(panel.style.transition).toContain('190ms');

    fireEvent.click(secondFaqBtn);
    expect(panel.getAttribute('data-open')).toBe('true');
    expect(panel.style.transition).toContain('300ms');

    fireEvent.click(secondFaqBtn);
    expect(panel.getAttribute('data-open')).toBe('false');
    expect(panel.style.transition).toContain('190ms');

    unmount();

    const pricingView = renderPricing();
    const pricingFaqSection = pricingView.container.querySelector('#pricing-faq') as HTMLElement;
    const secondPricingFaqBtn = within(pricingFaqSection).getAllByRole('button')[1];
    const pricingPanel = secondPricingFaqBtn.nextElementSibling as HTMLElement;

    expect(pricingPanel.getAttribute('data-open')).toBe('false');
    expect(pricingPanel.style.transition).toContain('190ms');

    fireEvent.click(secondPricingFaqBtn);
    expect(pricingPanel.getAttribute('data-open')).toBe('true');
    expect(pricingPanel.style.transition).toContain('300ms');
  });
});
