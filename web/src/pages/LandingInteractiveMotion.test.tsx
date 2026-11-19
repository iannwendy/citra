import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Link } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from '@/i18n';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { ToastProvider } from '@/contexts/ToastContext';
import { AuthContext } from '@/contexts/AuthContext';
import { CitraMotionProvider } from '@/components/ui/motion-primitives';
import {
  clearAnchorHashJump,
  SolvaScrollReveal,
  SolvaTwoToneHeading,
  SolvaAnimatedMetric,
} from '@/components/landing/SolvaPrimitives';
import { LandingPage } from '@/pages/LandingPage';
import { PricingPage } from '@/pages/PricingPage';
import { PrivacyPolicyPage } from '@/pages/PrivacyPolicyPage';
import { TermsOfServicePage } from '@/pages/TermsOfServicePage';

type IOListener = (entries: IntersectionObserverEntry[]) => void;

describe('Task 6 — Landing Page & Pricing Interactive Choreography', () => {
  let ioCallbacks: Array<{ target: Element; cb: IOListener }> = [];

  beforeEach(async () => {
    vi.useFakeTimers();
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
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
    window.history.replaceState(null, '', '/');
    clearAnchorHashJump();
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

  it('Interactive Debugger renders Auto-Tour progress bar paused while off-screen, starts on intersection, pauses on hover, and switches via NumberPopIn + SoftTextSwap without resetting active tab', () => {
    const { container } = renderLanding();

    const demoSection = container.querySelector('#interactive-demo') as HTMLElement;
    expect(demoSection).not.toBeNull();

    // Off-screen below the fold: CSS progress bar MUST stay paused at scaleX(0) in lockstep with JS timer
    expect(
      within(demoSection).getByTestId('debugger-autotour-progress').getAttribute('data-paused'),
    ).toBe('true');

    intersectAll();

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

  it('4-Stage Pipeline (#how-it-works) renders sliding .t-tabs-pill across role="tab" buttons, pauses progress bar off-screen, and wraps stage visual in causal DirectionalStageSlide without opacity:0.001 blink', () => {
    const { container } = renderLanding();

    const pipelineSection = container.querySelector('#how-it-works') as HTMLElement;
    expect(pipelineSection).not.toBeNull();
    expect(
      within(pipelineSection)
        .getByTestId('pipeline-autotour-progress')
        .getAttribute('data-paused'),
    ).toBe('true');

    intersectAll();

    const pill = within(pipelineSection).getByTestId('pipeline-tabs-pill');
    expect(pill.classList.contains('t-tabs-pill')).toBe(true);

    const tabs = within(pipelineSection).getAllByRole('tab');
    expect(tabs).toHaveLength(4);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(
      within(pipelineSection)
        .getByTestId('pipeline-autotour-progress')
        .getAttribute('data-paused'),
    ).toBe('false');

    const slideViewport = within(pipelineSection).getByTestId('pipeline-stage-slide');
    expect(slideViewport.classList.contains('t-stage-slide-viewport')).toBe(true);

    // Click Stage 3 (index 2) -> causal forward direction (+1), stops auto-cycle, and PipelineStageVisual does NOT mount cloaked at opacity 0.001
    fireEvent.click(tabs[2]);
    expect(tabs[2].getAttribute('aria-selected')).toBe('true');
    expect(slideViewport.getAttribute('data-direction')).toBe('1');
    expect(within(pipelineSection).queryByTestId('pipeline-autotour-progress')).toBeNull();
    const stageVisualCard = slideViewport.querySelector('.solva-glass-ring') as HTMLElement;
    expect(stageVisualCard).not.toBeNull();
    expect(stageVisualCard.style.opacity).not.toBe('0.001');

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

  it('SolvaHeader & PricingSolvaHeader dismiss Platform dropdown on outside-click and Escape (restoring trigger focus), and dismiss mobile drawers on Escape', () => {
    const { container, unmount } = renderLanding();

    const desktopNav = container.querySelector(
      'header nav[aria-label="Primary Navigation"]',
    ) as HTMLElement;
    const platformBtn = within(desktopNav).getByRole('button', {
      name: /Platform/i,
    });

    // 1. LandingPage Platform dropdown: open -> Escape dismisses & restores focus to trigger
    expect(platformBtn.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(platformBtn);
    expect(platformBtn.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('.t-dropdown.is-open')).not.toBeNull();

    // Move focus away from trigger, then press Escape -> restores focus to platformBtn
    document.body.focus();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(platformBtn.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(platformBtn);

    // 2. LandingPage Platform dropdown: open -> outside pointerDown/mouseDown on document.body dismisses cleanly
    fireEvent.click(platformBtn);
    expect(platformBtn.getAttribute('aria-expanded')).toBe('true');
    fireEvent.pointerDown(document.body);
    fireEvent.mouseDown(document.body);
    expect(platformBtn.getAttribute('aria-expanded')).toBe('false');

    // 3. LandingPage mobile navigation drawer: open -> Escape dismisses & restores focus to mobile toggle
    const mobileToggle = screen.getByRole('button', {
      name: /Toggle navigation menu/i,
    });
    expect(mobileToggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(mobileToggle);
    expect(mobileToggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(mobileToggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(mobileToggle);

    unmount();

    // 4. PricingPage Platform dropdown: open -> Escape dismisses & restores focus; outside click dismisses
    const pricingView = renderPricing();
    const pricingNav = pricingView.container.querySelector(
      'header nav[aria-label="Pricing Navigation"]',
    ) as HTMLElement;
    const pricingPlatformBtn = within(pricingNav).getByRole('button', {
      name: /Platform/i,
    });

    expect(pricingPlatformBtn.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(pricingPlatformBtn);
    expect(pricingPlatformBtn.getAttribute('aria-expanded')).toBe('true');

    document.body.focus();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(pricingPlatformBtn.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(pricingPlatformBtn);

    fireEvent.click(pricingPlatformBtn);
    expect(pricingPlatformBtn.getAttribute('aria-expanded')).toBe('true');
    fireEvent.pointerDown(document.body);
    fireEvent.mouseDown(document.body);
    expect(pricingPlatformBtn.getAttribute('aria-expanded')).toBe('false');

    // 5. PricingPage mobile navigation drawer: open -> Escape dismisses & restores focus
    const pricingMobileToggle = screen.getByRole('button', {
      name: /Toggle navigation menu/i,
    });
    fireEvent.click(pricingMobileToggle);
    expect(pricingMobileToggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(pricingMobileToggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(pricingMobileToggle);

    pricingView.unmount();

    // 6. PrivacyPolicyPage & TermsOfServicePage mobile navigation drawers: IconSwap, .t-mobile-drawer exit presence, Escape dismiss & focus restoration
    const privacyView = render(
      <CitraMotionProvider>
        <ThemeProvider defaultTheme="light">
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
            <MemoryRouter initialEntries={['/privacy']}>
              <PrivacyPolicyPage />
            </MemoryRouter>
          </AuthContext.Provider>
        </ThemeProvider>
      </CitraMotionProvider>,
    );

    const privacyMobileToggle = screen.getByRole('button', {
      name: /Toggle navigation menu/i,
    });
    expect(
      privacyMobileToggle.querySelector('.t-icon-swap')?.getAttribute('data-state'),
    ).toBe('a');
    fireEvent.click(privacyMobileToggle);
    expect(privacyMobileToggle.getAttribute('aria-expanded')).toBe('true');
    expect(
      privacyMobileToggle.querySelector('.t-icon-swap')?.getAttribute('data-state'),
    ).toBe('b');
    expect(privacyView.container.querySelector('.t-mobile-drawer.is-open')).not.toBeNull();
    document.body.focus();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(privacyMobileToggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(privacyMobileToggle);

    privacyView.unmount();

    const termsView = render(
      <CitraMotionProvider>
        <ThemeProvider defaultTheme="light">
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
            <MemoryRouter initialEntries={['/terms']}>
              <TermsOfServicePage />
            </MemoryRouter>
          </AuthContext.Provider>
        </ThemeProvider>
      </CitraMotionProvider>,
    );

    const termsMobileToggle = screen.getByRole('button', {
      name: /Toggle navigation menu/i,
    });
    expect(
      termsMobileToggle.querySelector('.t-icon-swap')?.getAttribute('data-state'),
    ).toBe('a');
    fireEvent.click(termsMobileToggle);
    expect(termsMobileToggle.getAttribute('aria-expanded')).toBe('true');
    expect(
      termsMobileToggle.querySelector('.t-icon-swap')?.getAttribute('data-state'),
    ).toBe('b');
    expect(termsView.container.querySelector('.t-mobile-drawer.is-open')).not.toBeNull();
    document.body.focus();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(termsMobileToggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(termsMobileToggle);
    expect(termsView.container.querySelector('.t-mobile-drawer.is-closing')).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(160);
    });
    expect(termsView.container.querySelector('.t-mobile-drawer')).toBeNull();
  });

  it('SolvaScrollReveal, SolvaTwoToneHeading, and SolvaAnimatedMetric snap on frame 0 (transitionProperty: none, 0ms delay) on #hash & replaceState anchor jumps and prefers-reduced-motion: reduce', () => {
    window.history.replaceState(null, '', '/');

    // Mock element off-screen below fold (rect.top = 2400 > vh = 900) so scroll reveal starts hidden
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue({
        top: 2400,
        bottom: 2600,
        left: 0,
        right: 800,
        width: 800,
        height: 200,
        x: 0,
        y: 2400,
        toJSON: () => ({}),
      } as DOMRect);

    const { container, unmount } = render(
      <section id="benchmark-120k">
        <SolvaScrollReveal delayMs={240}>
          <div data-testid="anchor-reveal-payload">120,000 Papers Verified</div>
        </SolvaScrollReveal>
        <SolvaTwoToneHeading
          primary="Empirical scale"
          secondary="across scholarly APIs"
          delayMs={180}
        />
        <SolvaAnimatedMetric targetValue={120000} suffix="+" label="Papers" />
      </section>,
    );

    const revealWrapper = container.querySelector('#benchmark-120k > div') as HTMLElement;
    const headingWord = container.querySelector('#benchmark-120k h2 span span') as HTMLElement;
    const metricWrapper = container.querySelectorAll('#benchmark-120k > div')[1] as HTMLElement;
    expect(revealWrapper).not.toBeNull();
    expect(headingWord).not.toBeNull();
    expect(metricWrapper).not.toBeNull();
    // Before anchor jump while off-screen below the fold, primitives start cloaked
    expect(Number.parseFloat(revealWrapper.style.opacity)).toBeLessThan(0.05);
    expect(Number.parseFloat(headingWord.style.opacity)).toBeLessThan(0.05);
    expect(Number.parseFloat(metricWrapper.style.opacity)).toBeLessThan(0.05);

    // Simulate anchor jump to #benchmark-120k -> frame-0 instant reveal (transitionProperty: 'none', 0ms delay, zero 700ms fade lag!)
    act(() => {
      window.history.replaceState(null, '', '#benchmark-120k');
      window.dispatchEvent(new Event('hashchange'));
    });

    expect(revealWrapper.style.opacity).toBe('1');
    expect(revealWrapper.style.filter).toBe('none');
    expect(revealWrapper.style.transform).toBe('none');
    expect(revealWrapper.style.transitionProperty).toBe('none');
    expect(revealWrapper.style.transitionDuration).toBe('0ms');
    expect(revealWrapper.style.transitionDelay).toBe('0ms');

    expect(headingWord.style.opacity).toBe('1');
    expect(headingWord.style.filter).toBe('none');
    expect(headingWord.style.transform).toBe('none');
    expect(headingWord.style.transitionProperty).toBe('none');
    expect(headingWord.style.transitionDuration).toBe('0ms');
    expect(headingWord.style.transitionDelay).toBe('0ms');

    expect(metricWrapper.style.opacity).toBe('1');
    expect(metricWrapper.style.filter).toBe('none');
    expect(metricWrapper.style.transform).toBe('none');
    expect(metricWrapper.style.transition).toBe('none');

    unmount();
    // Native browser hashchange clearing location.hash to '' syncs activeAnchorHash = '' automatically
    act(() => {
      window.history.replaceState(null, '', '/');
      window.dispatchEvent(new Event('hashchange'));
    });
    const standaloneAfterHashClear = render(
      <section id="benchmark-120k">
        <SolvaScrollReveal>
          <div>Fresh Reveal After Native Hash Clear</div>
        </SolvaScrollReveal>
      </section>,
    );
    const standaloneWrapper = standaloneAfterHashClear.container.querySelector(
      '#benchmark-120k > div',
    ) as HTMLElement;
    expect(Number.parseFloat(standaloneWrapper.style.opacity)).toBeLessThan(0.05);
    standaloneAfterHashClear.unmount();

    // Verify clicking SolvaFooter role link (#workspaces-teacher) dispatches hashchange despite replaceState and snaps #workspaces open on frame 0
    Element.prototype.scrollIntoView = vi.fn();
    const landingView = renderLanding();
    const workspacesSection = landingView.container.querySelector('#workspaces') as HTMLElement;
    const workspacesHeadingWord = workspacesSection.querySelector('h2 span span') as HTMLElement;
    expect(Number.parseFloat(workspacesHeadingWord.style.opacity)).toBeLessThan(0.05);

    const footer = landingView.container.querySelector('footer') as HTMLElement;
    const teacherRoleLink = within(footer).getByRole('link', { name: /Teacher Classroom/i });
    fireEvent.click(teacherRoleLink);

    expect(window.location.hash).toBe('#workspaces-teacher');
    expect(workspacesHeadingWord.style.opacity).toBe('1');
    expect(workspacesHeadingWord.style.transitionProperty).toBe('none');
    expect(workspacesHeadingWord.style.transitionDelay).toBe('0ms');

    landingView.unmount();
    window.history.replaceState(null, '', '/');

    // Verify SPA React Router <Link to="/#benchmark-120k"> snaps target open on frame 0,
    // AND navigating away to /pricing -> returning to / (location.hash === '') automatically
    // clears activeAnchorHash without any manual reset, AND PricingSolvaHeader /#... links
    // preserve full SPA routing continuity!
    const spaQueryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const spaView = render(
      <CitraMotionProvider>
        <QueryClientProvider client={spaQueryClient}>
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
                <MemoryRouter initialEntries={['/privacy']}>
                  <Routes>
                    <Route
                      path="/privacy"
                      element={
                        <Link to="/#benchmark-120k" data-testid="spa-bench-link">
                          120K Benchmark
                        </Link>
                      }
                    />
                    <Route path="/pricing" element={<PricingPage />} />
                    <Route path="/" element={<LandingPage />} />
                  </Routes>
                </MemoryRouter>
              </AuthContext.Provider>
            </ToastProvider>
          </ThemeProvider>
        </QueryClientProvider>
      </CitraMotionProvider>,
    );

    // 1. /privacy -> <Link to="/#benchmark-120k"> reveals #benchmark-120k on frame 0
    fireEvent.click(spaView.getByTestId('spa-bench-link'));
    const spaBenchSection = spaView.container.querySelector('#benchmark-120k') as HTMLElement;
    const spaBenchHeadingWord = spaBenchSection.querySelector('h2 span span') as HTMLElement;
    expect(spaBenchHeadingWord.style.opacity).toBe('1');
    expect(spaBenchHeadingWord.style.transitionProperty).toBe('none');
    expect(spaBenchHeadingWord.style.transitionDelay).toBe('0ms');

    // 2. Navigate from /#benchmark-120k -> /pricing -> / (location.hash === '') WITHOUT manual reset
    const landingNav = within(spaView.container).getByRole('navigation', {
      name: /Primary Navigation/i,
    });
    fireEvent.click(within(landingNav).getByRole('link', { name: /^Pricing$/i }));
    const pricingNav = within(spaView.container).getByRole('navigation', {
      name: /Pricing Navigation/i,
    });
    fireEvent.click(within(pricingNav).getByRole('link', { name: /^Home$/i }));

    const freshBenchSection = spaView.container.querySelector('#benchmark-120k') as HTMLElement;
    const freshBenchHeadingWord = freshBenchSection.querySelector('h2 span span') as HTMLElement;
    // Off-screen below-the-fold heading MUST mount cloaked for scroll-reveal entrance (zero activeAnchorHash leak!)
    expect(Number.parseFloat(freshBenchHeadingWord.style.opacity)).toBeLessThan(0.05);

    // 3. Navigate back to /pricing and verify PricingSolvaHeader's /#benchmark-120k + Platform dropdown /#architecture links transition via SPA Router and snap open on frame 0
    const freshLandingNav = within(spaView.container).getByRole('navigation', {
      name: /Primary Navigation/i,
    });
    fireEvent.click(within(freshLandingNav).getByRole('link', { name: /^Pricing$/i }));
    const pricingNavAgain = within(spaView.container).getByRole('navigation', {
      name: /Pricing Navigation/i,
    });
    fireEvent.click(within(pricingNavAgain).getByRole('link', { name: /120K Benchmark/i }));

    const pricingToBenchSection = spaView.container.querySelector('#benchmark-120k') as HTMLElement;
    expect(pricingToBenchSection).not.toBeNull();
    const pricingToBenchHeadingWord = pricingToBenchSection.querySelector(
      'h2 span span',
    ) as HTMLElement;
    expect(pricingToBenchHeadingWord.style.opacity).toBe('1');
    expect(pricingToBenchHeadingWord.style.transitionProperty).toBe('none');
    expect(pricingToBenchHeadingWord.style.transitionDelay).toBe('0ms');

    // 4. Same-component transition (/ #benchmark-120k -> <Link to="/">) + PricingSolvaHeader Platform dropdown (/pricing -> /#architecture)
    const brandHomeLink = spaView.container.querySelector('header a[href="/"]') as HTMLElement;
    fireEvent.click(brandHomeLink);

    // Prove activeAnchorHash was cleared directly by LandingPage's effect (standalone SolvaScrollReveal mounts cloaked)
    const standalonePostSpaClear = render(
      <section id="benchmark-120k">
        <SolvaScrollReveal>
          <div>Standalone Check After Same-Component Home Link</div>
        </SolvaScrollReveal>
      </section>,
    );
    const standalonePostSpaWrapper = standalonePostSpaClear.container.querySelector(
      '#benchmark-120k > div',
    ) as HTMLElement;
    expect(Number.parseFloat(standalonePostSpaWrapper.style.opacity)).toBeLessThan(0.05);
    standalonePostSpaClear.unmount();

    const thirdLandingNav = within(spaView.container).getByRole('navigation', {
      name: /Primary Navigation/i,
    });
    fireEvent.click(within(thirdLandingNav).getByRole('link', { name: /^Pricing$/i }));
    const pricingNavDropdown = within(spaView.container).getByRole('navigation', {
      name: /Pricing Navigation/i,
    });
    fireEvent.click(within(pricingNavDropdown).getByRole('button', { name: /^Platform$/i }));
    fireEvent.click(within(pricingNavDropdown).getByRole('link', { name: /2-Layer Architecture/i }));

    const pricingToArchSection = spaView.container.querySelector('#architecture') as HTMLElement;
    expect(pricingToArchSection).not.toBeNull();
    const pricingToArchWord = pricingToArchSection.querySelector('h2 span span') as HTMLElement;
    expect(pricingToArchWord.style.opacity).toBe('1');
    expect(pricingToArchWord.style.transitionProperty).toBe('none');
    expect(pricingToArchWord.style.transitionDelay).toBe('0ms');

    spaView.unmount();

    // Verify prefers-reduced-motion: reduce mounts immediately visible with no opacity/transform cloaking
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query.includes('prefers-reduced-motion'),
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    const reducedView = render(
      <section id="reduced-section">
        <SolvaScrollReveal>
          <div>Reduced Motion Safe Content</div>
        </SolvaScrollReveal>
      </section>,
    );

    const reducedWrapper = reducedView.container.querySelector(
      '#reduced-section > div',
    ) as HTMLElement;
    expect(reducedWrapper.style.opacity).toBe('1');
    expect(reducedWrapper.style.transform).toBe('none');
    expect(reducedWrapper.style.transitionProperty).toBe('none');

    rectSpy.mockRestore();
  });

  it('keeps progressive-disclosure aria-controls non-dangling when collapsed and preserves Cmd/Ctrl+click on SolvaFooter role links', () => {
    const { container } = renderLanding();

    // 1. Both progressive-disclosure toggles always reference an existing DOM id even when collapsed
    const benchToggle = screen.getByTestId('benchmark-technical-details-toggle');
    expect(benchToggle.getAttribute('aria-expanded')).toBe('false');
    const benchTarget = container.querySelector('#benchmark-technical-details-panel');
    expect(benchTarget).not.toBeNull();
    expect(benchTarget?.hasAttribute('hidden')).toBe(true);

    const traceToggle = screen.getByTestId('debugger-technical-trace-toggle');
    expect(traceToggle.getAttribute('aria-expanded')).toBe('false');
    const traceTarget = container.querySelector('#debugger-technical-trace-panel');
    expect(traceTarget).not.toBeNull();
    expect(traceTarget?.hasAttribute('hidden')).toBe(true);

    // 2. Footer role link allows Cmd/Ctrl+click (does NOT preventDefault) while normal left-click smooth-scrolls & prevents default
    const footer = container.querySelector('footer') as HTMLElement;
    const teacherLink = within(footer).getByRole('link', {
      name: /Teacher Classroom/i,
    });

    const cmdClickEvent = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      button: 0,
      metaKey: true,
    });
    const cmdNotCancelled = teacherLink.dispatchEvent(cmdClickEvent);
    expect(cmdNotCancelled).toBe(true);

    const plainClickEvent = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      button: 0,
    });
    let plainNotCancelled = true;
    act(() => {
      plainNotCancelled = teacherLink.dispatchEvent(plainClickEvent);
    });
    expect(plainNotCancelled).toBe(false);
  });
});
