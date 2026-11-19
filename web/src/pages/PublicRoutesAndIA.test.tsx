import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMemoryRouter, RouterProvider, Routes, Route } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import i18n from '@/i18n';
import { appRoutes, getDocumentTitle } from '@/router';
import { AuthContext } from '@/contexts/AuthContext';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { ToastProvider } from '@/contexts/ToastContext';
import { CitraMotionProvider } from '@/components/ui/motion-primitives';
import {
  createTestQueryClient,
  makeUser,
  renderWithProviders,
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from '@/test-utils';
import { GoogleOnboardingModal } from '@/components/GoogleOnboardingModal';
import { LandingPage } from './LandingPage';
import { NotFoundPage } from './NotFoundPage';
import { PricingPage } from './PricingPage';
import { PrivacyPolicyPage } from './PrivacyPolicyPage';
import { RegisterPage } from './RegisterPage';
import { TermsOfServicePage } from './TermsOfServicePage';

function renderRealRouter(initialPath: string, theme: 'light' | 'dark' = 'light') {
  const testRouter = createMemoryRouter(appRoutes, {
    initialEntries: [initialPath],
    future: {
      v7_relativeSplatPath: true,
      v7_fetcherPersist: true,
      v7_normalizeFormMethod: true,
      v7_partialHydration: true,
      v7_skipActionErrorRevalidation: true,
    },
  });
  const qc = createTestQueryClient();
  const view = render(
    <QueryClientProvider client={qc}>
      <ThemeProvider defaultTheme={theme}>
        <CitraMotionProvider>
          <ToastProvider>
            <AuthContext.Provider
              value={{
                user: null,
                token: null,
                isAdmin: false,
                isLoading: false,
                login: async () => {},
                loginWithGoogle: async () => {},
                logout: async () => {},
                refreshUser: async () => {},
              }}
            >
              <RouterProvider router={testRouter} future={{ v7_startTransition: true }} />
            </AuthContext.Provider>
          </ToastProvider>
        </CitraMotionProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return { ...view, testRouter };
}

describe('Task 1.5 — Public Routes, Clean IA Anchors, 3-Role Workspaces, /terms & Editorial 404', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
    await i18n.changeLanguage('en');
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
  });

  it('1. LandingPage top navbar eliminates duplicate "Gói dịch vụ" + "Bảng giá" (Taxonomy + Pricing), links "Workspaces" / "Vai trò" to #workspaces, and anchors pricing at #pricing-plans while keeping backward-compatible #taxonomy', async () => {
    await i18n.changeLanguage('vi');
    const { container, unmount } = renderWithProviders(<LandingPage />, {
      user: null,
      initialRoute: '/',
    });

    const desktopNavVi = container.querySelector(
      'header nav[aria-label="Primary Navigation"]',
    ) as HTMLElement;
    expect(desktopNavVi).not.toBeNull();
    expect(desktopNavVi.className).toContain('flex-nowrap');

    // Top-level desktop bar links (excluding dropdown menu items)
    const topLevelItemsVi = Array.from(
      desktopNavVi.querySelectorAll(':scope > a, :scope > div > button'),
    ).map((el) => el.textContent?.trim());

    expect(topLevelItemsVi).toContain('Bảng giá');
    expect(topLevelItemsVi).toContain('Dành cho ai');
    expect(topLevelItemsVi).not.toContain('Gói dịch vụ');

    const workspacesNavLinkVi = desktopNavVi.querySelector(
      ':scope > a[href="#workspaces"]',
    );
    expect(workspacesNavLinkVi).not.toBeNull();
    expect(workspacesNavLinkVi?.textContent?.trim()).toBe('Dành cho ai');

    // Pricing section carries canonical id="pricing-plans" AND backward-compatible #taxonomy wrapper
    const pricingPlansSection = container.querySelector('#pricing-plans');
    expect(pricingPlansSection).not.toBeNull();
    expect(container.querySelector('#taxonomy')).not.toBeNull();

    // Footer pricing overview points to #pricing-plans rather than #taxonomy
    const footer = container.querySelector('footer') as HTMLElement;
    expect(footer.querySelector('a[href="#pricing-plans"]')).not.toBeNull();
    expect(footer.querySelector('a[href="#taxonomy"]')).toBeNull();

    unmount();

    // Verify English navbar and mobile drawer copy do not conflate Verdict Taxonomy with Pricing
    await i18n.changeLanguage('en');
    const { container: enContainer } = renderWithProviders(<LandingPage />, {
      user: null,
      initialRoute: '/',
    });
    const desktopNavEn = enContainer.querySelector(
      'header nav[aria-label="Primary Navigation"]',
    ) as HTMLElement;
    const topLevelItemsEn = Array.from(
      desktopNavEn.querySelectorAll(':scope > a, :scope > div > button'),
    ).map((el) => el.textContent?.trim());

    expect(topLevelItemsEn).toContain('Pricing');
    expect(topLevelItemsEn).toContain('For Whom');
    expect(topLevelItemsEn).not.toContain('Taxonomy');

    fireEvent.click(screen.getByRole('button', { name: /toggle navigation menu/i }));
    const mobileNav = screen.getByRole('navigation', { name: /mobile navigation/i });
    expect(mobileNav.textContent).not.toContain('Verdict Taxonomy');
    expect(mobileNav.querySelector('a[href="#pricing-plans"]')).not.toBeNull();
  });

  it('2. #workspaces renders interactive 3-role showcase (student, teacher, admin) before testimonials, and Footer / URL role links activate the corresponding role tab in EN and VI', async () => {
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;

    await i18n.changeLanguage('en');
    const { container, unmount } = renderWithProviders(
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/pricing" element={<PricingPage />} />
      </Routes>,
      { user: null, initialRoute: '/' },
    );

    const workspacesSection = container.querySelector('#workspaces') as HTMLElement;
    expect(workspacesSection).not.toBeNull();

    const showcase = within(workspacesSection).getByTestId('role-workspaces-showcase');
    expect(showcase.querySelectorAll('.truncate').length).toBe(0);

    // Showcase appears in DOM order BEFORE the testimonials grid
    const marcusQuote = within(workspacesSection).getByText(/Marcus Chen/);
    expect(
      showcase.compareDocumentPosition(marcusQuote) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    const tablist = within(showcase).getByRole('tablist');
    const tabs = within(tablist).getAllByRole('tab');
    expect(tabs).toHaveLength(3);
    tabs.forEach((tab) => {
      expect(tab.className).toContain('min-h-[44px]');
    });

    const studentTab = within(tablist).getByRole('tab', { name: /Students & Authors/i });
    const teacherTab = within(tablist).getByRole('tab', { name: /Lecturers & Advisors/i });
    const adminTab = within(tablist).getByRole('tab', { name: /Department Admin/i });

    // Default active tab is student with jargon-free workflow
    expect(studentTab.getAttribute('aria-selected')).toBe('true');
    expect(teacherTab.getAttribute('aria-selected')).toBe('false');
    expect(adminTab.getAttribute('aria-selected')).toBe('false');
    expect(showcase.textContent).toMatch(/Citation Integrity Score/i);
    expect(showcase.textContent).not.toMatch(/SQLite FTS5|ONNX INT8|GROBID container/i);

    // Clicking Footer "Teacher Classroom" activates & focuses the Teacher view
    const footer = container.querySelector('footer') as HTMLElement;
    const teacherFooterLink = within(footer).getByRole('link', {
      name: /Teacher Classroom/i,
    });
    fireEvent.click(teacherFooterLink);

    await waitFor(() => {
      expect(teacherTab.getAttribute('aria-selected')).toBe('true');
      expect(studentTab.getAttribute('aria-selected')).toBe('false');
    });
    expect(showcase.textContent).toMatch(/50 student submissions|cohort/i);

    // Clicking Department Admin tab switches cleanly to Admin view
    fireEvent.click(adminTab);
    expect(adminTab.getAttribute('aria-selected')).toBe('true');
    expect(showcase.textContent).toMatch(/quotas|tamper-evident|external/i);
    expect(showcase.textContent).not.toMatch(/SQLite FTS5|ONNX INT8|GROBID container/i);

    unmount();

    // Verify cross-page URL hash/query selection (/#workspaces-admin & Vietnamese labels)
    await i18n.changeLanguage('vi');
    renderWithProviders(<LandingPage />, {
      user: null,
      initialRoute: '/?role=teacher#workspaces',
    });

    const showcaseVi = screen.getByTestId('role-workspaces-showcase');
    const teacherTabVi = within(showcaseVi).getByRole('tab', {
      name: /Giảng viên & Hội đồng/i,
    });
    const studentTabVi = within(showcaseVi).getByRole('tab', {
      name: /Sinh viên & Tác giả/i,
    });
    const adminTabVi = within(showcaseVi).getByRole('tab', {
      name: /Quản trị Khoa & Trường/i,
    });
    expect(teacherTabVi.getAttribute('aria-selected')).toBe('true');
    expect(studentTabVi.getAttribute('aria-selected')).toBe('false');
    expect(adminTabVi.getAttribute('aria-selected')).toBe('false');
  });

  it('3. Navigating to /terms renders bilingual editorial TermsOfServicePage (data-testid="terms-page") and /terms is linked from Footers and RegisterPage', async () => {
    expect(getDocumentTitle('/terms')).toBe('CITRA - Terms of Service');

    await i18n.changeLanguage('en');
    const { unmount } = renderRealRouter('/terms', 'light');

    const termsPage = await screen.findByTestId('terms-page');
    expect(termsPage.className).toContain('solva-editorial-root');
    expect(termsPage.querySelectorAll('.truncate').length).toBe(0);

    // Single-row desktop header discipline
    const desktopNav = termsPage.querySelector(
      'header nav[aria-label="Primary Navigation"]',
    ) as HTMLElement;
    expect(desktopNav).not.toBeNull();
    expect(desktopNav.className).toContain('flex-nowrap');

    // Zero draft / placeholder / standalone SourceLogic strings
    expect(termsPage.textContent).not.toMatch(/\bDRAFT\b|BẢN NHÁP|\[CHECK:|\[KIỂM TRA:|SourceLogic/i);

    // Covers all 5 plain-language academic governance pillars
    expect(termsPage.textContent).toMatch(/Decision-Support/i);
    expect(termsPage.textContent).toMatch(/Turnitin/i);
    expect(termsPage.textContent).toMatch(/Acceptable Academic Use/i);
    expect(termsPage.textContent).toMatch(/Stripe/i);
    expect(termsPage.textContent).toMatch(/VNPay/i);
    expect(termsPage.textContent).toMatch(/91\/2025\/QH15/i);
    expect(termsPage.textContent).toMatch(/iannwendii@gmail\.com/i);
    expect(termsPage.textContent).toMatch(/Ton Duc Thang University/i);
    expect(termsPage.querySelector('a[href="/privacy"]')).not.toBeNull();

    // Switch to Vietnamese via header toggle and verify localized editorial copy
    fireEvent.click(within(termsPage).getByRole('button', { name: /VI \/ EN/i }));
    await waitFor(() => {
      expect(termsPage.textContent).toMatch(/ĐIỀU KHOẢN DỊCH VỤ HỌC THUẬT/i);
      expect(termsPage.textContent).toMatch(/Đại học Tôn Đức Thắng/i);
      expect(termsPage.textContent).toMatch(/Hỗ trợ Ra Quyết định/i);
      expect(termsPage.textContent).not.toMatch(/\bDRAFT\b|BẢN NHÁP|\[CHECK:|\[KIỂM TRA:/i);
    });

    // Terms footer includes /terms, /privacy, and cross-page role links
    const termsFooter = termsPage.querySelector('footer') as HTMLElement;
    expect(termsFooter.querySelector('a[href="/terms"]')).not.toBeNull();
    expect(termsFooter.querySelector('a[href="/privacy"]')).not.toBeNull();
    expect(
      termsFooter.querySelector('a[href*="workspaces-teacher"], a[href*="role=teacher"]'),
    ).not.toBeNull();

    unmount();

    // Verify /terms link presence in LandingPage, PricingPage, PrivacyPolicyPage footers & RegisterPage consent
    const { container: landingC, unmount: u1 } = renderWithProviders(<LandingPage />, {
      user: null,
      initialRoute: '/',
    });
    expect(landingC.querySelector('footer a[href="/terms"]')).not.toBeNull();
    u1();

    const { container: pricingC, unmount: u2 } = renderWithProviders(<PricingPage />, {
      user: null,
      initialRoute: '/pricing',
    });
    expect(pricingC.querySelector('footer a[href="/terms"]')).not.toBeNull();
    expect(
      pricingC.querySelector('footer a[href*="workspaces-teacher"], footer a[href*="role=teacher"]'),
    ).not.toBeNull();
    u2();

    const { container: privacyC, unmount: u3 } = renderWithProviders(
      <PrivacyPolicyPage />,
      { user: null, initialRoute: '/privacy' },
    );
    expect(privacyC.querySelector('footer a[href="/terms"]')).not.toBeNull();
    u3();

    const { container: registerC, unmount: u4 } = renderWithProviders(<RegisterPage />, {
      user: null,
      initialRoute: '/register',
    });
    expect(screen.getByTestId('register-privacy-consent-checkbox')).toBeDefined();
    expect(registerC.querySelector('a[href="/privacy"]')).not.toBeNull();
    expect(registerC.querySelector('a[href="/terms"]')).not.toBeNull();
    u4();
  });

  it('4. Navigating to unknown route /nonexistent-xyz renders bilingual editorial NotFoundPage (data-testid="not-found-page") with "Back to Home" CTA and quick links instead of redirecting', async () => {
    expect(getDocumentTitle('/nonexistent-xyz')).toBe('CITRA - Page Not Found');

    await i18n.changeLanguage('en');
    const { unmount, testRouter } = renderRealRouter('/nonexistent-xyz', 'dark');

    const notFound = await screen.findByTestId('not-found-page');
    expect(testRouter.state.location.pathname).toBe('/nonexistent-xyz');
    expect(notFound.className).toContain('solva-editorial-root');
    expect(notFound.querySelectorAll('.truncate').length).toBe(0);
    expect(notFound.textContent).toContain('/nonexistent-xyz');

    const backHomeCta = within(notFound).getByRole('link', { name: /Back to Home/i });
    expect(backHomeCta.getAttribute('href')).toBe('/');

    // Helpful recovery quick links (Card 1 routes directly to /#try-instant GuestInstantChecker)
    expect(notFound.querySelector('a[href="/#try-instant"]')).not.toBeNull();
    expect(notFound.querySelector('a[href="/#interactive-demo"]')).toBeNull();
    expect(notFound.querySelector('a[href="/pricing"]')).not.toBeNull();
    expect(notFound.querySelector('a[href="/privacy"]')).not.toBeNull();
    expect(notFound.querySelector('a[href="/terms"]')).not.toBeNull();
    expect(notFound.querySelector('a[href="/login"]')).not.toBeNull();

    // Toggle to Vietnamese and verify localized "Về trang chủ" CTA
    fireEvent.click(within(notFound).getByRole('button', { name: /VI \/ EN/i }));
    await waitFor(() => {
      const backHomeVi = within(notFound).getByRole('link', { name: /Về trang chủ/i });
      expect(backHomeVi.getAttribute('href')).toBe('/');
    });

    unmount();
  });

  it('5. Cross-page SPA links from /pricing and /terms open the matching #workspaces role tab on LandingPage, and keyboard arrow navigation cycles tabs cleanly', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    await i18n.changeLanguage('en');

    // Start at /terms, click Footer "Admin Control" -> lands on /#workspaces-admin with Admin tab active
    const { unmount } = renderWithProviders(
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/pricing" element={<PricingPage />} />
        <Route path="/terms" element={<TermsOfServicePage />} />
      </Routes>,
      { user: null, initialRoute: '/terms' },
    );
    const termsPage = screen.getByTestId('terms-page');
    const adminFooterLink = within(termsPage.querySelector('footer') as HTMLElement).getByRole(
      'link',
      { name: /Admin Control/i },
    );
    fireEvent.click(adminFooterLink);

    const showcase = await screen.findByTestId('role-workspaces-showcase');
    const adminTab = within(showcase).getByRole('tab', { name: /Department Admin/i });
    const studentTab = within(showcase).getByRole('tab', { name: /Students & Authors/i });
    const teacherTab = within(showcase).getByRole('tab', { name: /Lecturers & Advisors/i });
    expect(adminTab.getAttribute('aria-selected')).toBe('true');

    // Keyboard ArrowRight wraps from admin -> student; End jumps -> admin; ArrowLeft -> teacher
    fireEvent.keyDown(adminTab, { key: 'ArrowRight' });
    expect(studentTab.getAttribute('aria-selected')).toBe('true');

    fireEvent.keyDown(studentTab, { key: 'End' });
    expect(adminTab.getAttribute('aria-selected')).toBe('true');

    fireEvent.keyDown(adminTab, { key: 'ArrowLeft' });
    expect(teacherTab.getAttribute('aria-selected')).toBe('true');

    unmount();
  });

  it('6. /terms mobile navigation drawer renders auth CTAs (unauthenticated + authenticated), closes on Escape, includes Section 05 in footer TOC, and prevents 640px contact button shrink', async () => {
    await i18n.changeLanguage('en');
    const { unmount } = renderWithProviders(<TermsOfServicePage />, {
      user: null,
      initialRoute: '/terms',
    });

    const menuToggle = screen.getByRole('button', { name: /toggle navigation menu/i });
    fireEvent.click(menuToggle);

    const mobileNav = screen.getByRole('navigation', { name: /mobile terms navigation/i });
    const signInLink = within(mobileNav).getByRole('link', { name: /Sign in/i });
    const createAccountLink = within(mobileNav).getByRole('link', { name: /Create Account/i });
    expect(signInLink.getAttribute('href')).toBe('/login');
    expect(createAccountLink.getAttribute('href')).toBe('/register');

    // Escape closes mobile drawer
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('navigation', { name: /mobile terms navigation/i })).toBeNull();

    // Footer TOC includes all 5 sections including #governing-law
    const footer = document.querySelector('footer') as HTMLElement;
    expect(footer.querySelector('a[href="#governing-law"]')).not.toBeNull();

    // Section 05 contact card button has shrink-0 and MapPin wrapper uses items-start
    const governingSection = document.getElementById('governing-law') as HTMLElement;
    const privacyBtn = within(governingSection).getByRole('link', {
      name: /Read Privacy Policy/i,
    });
    expect(privacyBtn.className).toContain('shrink-0');

    unmount();

    // Authenticated mobile drawer on /terms in Vietnamese renders Workspace + New Check & zero "(Override)"
    await i18n.changeLanguage('vi');
    const { unmount: unmountAuth } = renderWithProviders(<TermsOfServicePage />, {
      user: makeUser('user', 'pro'),
      initialRoute: '/terms',
    });

    const termsVi = screen.getByTestId('terms-page');
    expect(termsVi.textContent).not.toContain('(Override)');

    fireEvent.click(screen.getByRole('button', { name: /toggle navigation menu/i }));
    const mobileNavVi = screen.getByRole('navigation', { name: /mobile terms navigation/i });
    expect(
      within(mobileNavVi).getByRole('link', { name: /Không gian làm việc/i }).getAttribute('href'),
    ).toBe('/dashboard');
    expect(
      within(mobileNavVi).getByRole('link', { name: /Kiểm tra bài mới/i }).getAttribute('href'),
    ).toBe('/upload');

    unmountAuth();
  });

  it('7. GoogleOnboardingModal consent label includes localized /terms link alongside /privacy with underline-offset-4', async () => {
    const unconsentedGoogleUser = makeUser('user', 'basic', {
      username: 'scholar_onboarding',
      auth_provider: 'google',
      google_linked: true,
      has_password: false,
      can_set_username: true,
      needs_onboarding: true,
      privacy_consented_at: null,
      privacy_policy_version: null,
    });

    await i18n.changeLanguage('en');
    const { unmount } = renderWithProviders(<GoogleOnboardingModal />, {
      user: unconsentedGoogleUser,
      initialRoute: '/dashboard',
    });

    const modalEn = screen.getByTestId('google-onboarding-modal');
    expect(modalEn.className).not.toContain('backdrop-blur-xs');
    const privacyLinkEn = within(modalEn).getByRole('link', {
      name: /Personal Data Protection Policy/i,
    });
    const termsLinkEn = within(modalEn).getByRole('link', { name: /Terms of Service/i });
    expect(privacyLinkEn.getAttribute('href')).toBe('/privacy');
    expect(termsLinkEn.getAttribute('href')).toBe('/terms');
    expect(privacyLinkEn.className).toContain('underline-offset-4');
    expect(termsLinkEn.className).toContain('underline-offset-4');

    unmount();

    await i18n.changeLanguage('vi');
    const { unmount: unmountVi } = renderWithProviders(<GoogleOnboardingModal />, {
      user: unconsentedGoogleUser,
      initialRoute: '/dashboard',
    });

    const modalVi = screen.getByTestId('google-onboarding-modal');
    const termsLinkVi = within(modalVi).getByRole('link', { name: /Điều khoản Dịch vụ/i });
    expect(termsLinkVi.getAttribute('href')).toBe('/terms');
    expect(termsLinkVi.className).toContain('underline-offset-4');

    unmountVi();
  });

  it('8. #workspaces status badges, /terms subnav, RegisterPage, and NotFoundPage use valid Tailwind v3 utilities, natural VI copy, and auth-aware 404 cards', async () => {
    const replaceStateSpy = vi.spyOn(window.history, 'replaceState');
    Element.prototype.scrollIntoView = vi.fn();

    await i18n.changeLanguage('vi');
    const { container, unmount } = renderWithProviders(<LandingPage />, {
      user: null,
      initialRoute: '/?role=teacher#workspaces',
    });

    const showcase = screen.getByTestId('role-workspaces-showcase');
    // Zero untranslated "(Override)" and tightened VI CTA label
    expect(showcase.textContent).not.toContain('(Override)');
    expect(
      within(showcase).getByRole('link', { name: 'Xem gói Giảng viên & Lớp học' }),
    ).toBeDefined();

    // Teacher preview rows contain ok (emerald), info (sky), and warn (amber) tones using Tailwind v3 /[0.12]
    expect(showcase.querySelector('.bg-emerald-500\\/\\[0\\.12\\]')).not.toBeNull();
    expect(showcase.querySelector('.bg-amber-500\\/\\[0\\.12\\]')).not.toBeNull();
    expect(showcase.querySelector('.bg-sky-500\\/\\[0\\.12\\]')).not.toBeNull();
    expect(showcase.innerHTML).not.toMatch(/bg-(emerald|amber|sky)-500\/12\b/);
    expect(showcase.innerHTML).not.toMatch(/\bshadow-2?xs\b/);

    // Footer role link calls history.replaceState cleanly without competing native hash jump
    const footer = container.querySelector('footer') as HTMLElement;
    const adminRoleLink = within(footer).getByRole('link', { name: /Trung tâm Quản trị/i });
    const clickEvt = new MouseEvent('click', { bubbles: true, cancelable: true });
    fireEvent(adminRoleLink, clickEvt);
    expect(clickEvt.defaultPrevented).toBe(true);
    expect(replaceStateSpy).toHaveBeenCalledWith(null, '', '#workspaces-admin');

    unmount();

    // Verify /terms subnav uses backdrop-blur-md + color-mix translucent surface
    const { unmount: uTerms } = renderWithProviders(<TermsOfServicePage />, {
      user: null,
      initialRoute: '/terms',
    });
    const subnav = screen.getByTestId('terms-section-subnav');
    expect(subnav.className).toContain('backdrop-blur-md');
    expect(subnav.className).not.toContain('backdrop-blur-xs');
    expect(subnav.getAttribute('style') ?? '').toContain('color-mix');
    uTerms();

    // Verify NotFoundPage auth-aware quick destination card + brand focus-visible ring
    await i18n.changeLanguage('en');
    const { unmount: u404 } = renderWithProviders(<NotFoundPage />, {
      user: makeUser('user', 'pro'),
      initialRoute: '/missing-route',
    });
    const notFound = screen.getByTestId('not-found-page');
    expect(notFound.querySelector('a[href="/login"]')).toBeNull();
    expect(notFound.querySelectorAll('a[href="/dashboard"]').length).toBeGreaterThanOrEqual(2);
    const brandHomeLink = notFound.querySelector('header a[href="/"]') as HTMLElement;
    expect(brandHomeLink.className).toContain('focus-visible:ring-[var(--solva-accent)]');
    expect(notFound.innerHTML).not.toMatch(/\bshadow-2?xs\b/);
    u404();

    // Verify RegisterPage uses underline-offset-4
    const { container: regC, unmount: uReg } = renderWithProviders(<RegisterPage />, {
      user: null,
      initialRoute: '/register',
    });
    expect(regC.innerHTML).not.toContain('underline-offset-3');
    expect(regC.querySelector('a[href="/terms"]')?.className).toContain('underline-offset-4');
    uReg();
  });
});
