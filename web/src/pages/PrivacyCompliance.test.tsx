import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { api } from '@/api/client';
import i18n from '@/i18n';
import {
  renderWithProviders,
  makeUser,
  QUOTA_BY_TIER,
  render,
  screen,
  fireEvent,
  waitFor,
} from '@/test-utils';
import { PrivacyPolicyPage } from './PrivacyPolicyPage';
import { RegisterPage } from './RegisterPage';
import { GoogleOnboardingModal } from '@/components/GoogleOnboardingModal';
import { UploadPage } from './UploadPage';
import { BatchUploadPage } from './BatchUploadPage';
import { StripeDemoCheckoutPage } from './StripeDemoCheckoutPage';
import { SettingsPage } from './SettingsPage';
import { PricingPage } from './PricingPage';

describe('Vietnamese Personal Data Protection Compliance UI (DLCN-01, DLCN-02, DLCN-03)', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage('vi');
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

  it('[DLCN-01] PrivacyPolicyPage renders Solva editorial layout with official v1.0 notice, human-friendly data matrix, collapsible technical schema, statutory SLAs, and zero draft placeholders', async () => {
    render(
      <ThemeProvider defaultTheme="light">
        <MemoryRouter initialEntries={['/privacy']}>
          <Routes>
            <Route path="/privacy" element={<PrivacyPolicyPage />} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>,
    );

    const root = screen.getByTestId('privacy-policy-page');
    expect(root.className).toContain('solva-editorial-root');
    expect(root.getAttribute('lang')).toBe('vi');
    expect(root.getAttribute('data-lang')).toBe('vi');
    expect(root.innerHTML).not.toContain('shadow-2xs');
    const headerNavVi = root.querySelector('header nav[aria-label="Primary Navigation"]');
    expect(headerNavVi?.textContent).toContain('Quy trình hoạt động');
    expect(headerNavVi?.textContent).toContain('Độ tin cậy');
    expect(screen.getByTestId('solva-sticky-card-0')).toBeDefined();
    expect(document.querySelector('.animate-solva-marquee')).not.toBeNull();
    expect(document.querySelector('footer')).not.toBeNull();

    // Official v1.0 badge & zero draft / placeholder / standalone SourceLogic leaks
    expect(
      screen.getByText(/CHÍNH SÁCH BẢO VỆ DỮ LIỆU CÁ NHÂN · PHIÊN BẢN 1\.0/),
    ).toBeDefined();
    expect(screen.queryByText(/BẢN NHÁP/i)).toBeNull();
    expect(screen.queryByText(/LEGAL DRAFT/i)).toBeNull();
    expect(screen.queryByText(/\bDRAFT\b/i)).toBeNull();
    expect(screen.queryByText(/\[KIỂM TRA:/i)).toBeNull();
    expect(screen.queryByText(/\[CHECK:/i)).toBeNull();
    expect(screen.queryByText(/SourceLogic/i)).toBeNull();

    // Statutory disclosures preserved verbatim
    expect(screen.getAllByText(/91\/2025\/QH15/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/356\/2025\/NĐ-CP/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Đại học Tôn Đức Thắng/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/19 Nguyễn Hữu Thọ, phường Tân Hưng, TP\. Hồ Chí Minh/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Nguyễn Bảo Minh/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/privacy@citra\.io\.vn/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/iannwendii@gmail\.com/i)).toBeNull();
    expect(screen.getByTestId('privacy-effective-date').textContent).toContain('05/11/2026');
    expect(screen.getByTestId('privacy-table-scroll-hint')).toBeDefined();
    expect(document.body.textContent).toContain('01 · ĐƠN VỊ');
    expect(document.body.textContent).toContain('02 · ĐỊA CHỈ');
    expect(document.body.textContent).toContain('03 · LIÊN HỆ BẢO VỆ DỮ LIỆU');
    expect(document.body.textContent).toContain('HTTPS/TLS 1.3');
    expect(document.body.textContent).not.toContain('TLS 1.2+');
    expect(document.querySelector('a[href="/batch"]')).toBeNull();
    expect(document.querySelector('a[href="/classes"]')).toBeNull();
    expect(document.body.textContent).not.toContain('(/batch)');
    expect(document.body.textContent).not.toContain('(/classes)');
    expect(document.body.textContent).toContain('/batch-upload');
    expect(document.body.textContent).toContain('/teacher/classes');
    expect(screen.queryByText(/Mã số doanh nghiệp/i)).toBeNull();
    expect(screen.getAllByText(/02 ngày làm việc/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Crossref/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/OpenAlex/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/VNPay/i).length).toBeGreaterThan(0);
    expect(
      screen.getByText(/© 2026 CITRA — Không gian Kiểm chứng Trích dẫn Học thuật/),
    ).toBeDefined();

    // Human-first primary Data Matrix descriptions in default collapsed view
    const dataMatrixSection = document.getElementById('data-collected');
    expect(dataMatrixSection).not.toBeNull();
    expect(dataMatrixSection!.textContent).toMatch(/Ảnh đại diện tải lên/i);
    expect(dataMatrixSection!.textContent).toMatch(/Tệp bản thảo PDF\/Word/i);
    expect(dataMatrixSection!.textContent).toMatch(/4 số cuối thẻ thanh toán/i);

    // Intimidating raw filesystem/SQL/API identifiers absent from default non-tech prose
    expect(screen.queryByText(/data\/essays\/uploads/i)).toBeNull();
    expect(screen.queryByText(/UPLOADS_DIR/i)).toBeNull();
    expect(screen.queryByText(/DELETE \/api\/users\/me/i)).toBeNull();
    expect(screen.queryByText(/class_id/i)).toBeNull();
    expect(screen.queryByText(/i18nextLng/i)).toBeNull();
    expect(screen.queryByText(/avatar_path/i)).toBeNull();
    expect(screen.queryByText(/privacy_consented_at/i)).toBeNull();
    expect(screen.queryByText(/vnp_bank_code/i)).toBeNull();

    // Collapsible Technical Schema disclosure reveals & hides monospace schema pills
    const schemaToggle = screen.getByRole('button', {
      name: /Chi tiết trường kỹ thuật \/ Technical Schema/i,
    });
    expect(schemaToggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(schemaToggle);
    expect(schemaToggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('avatar_path')).toBeDefined();
    expect(screen.getByText('privacy_consented_at')).toBeDefined();
    expect(screen.getByText('vnp_bank_code')).toBeDefined();
    fireEvent.click(schemaToggle);
    expect(schemaToggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('avatar_path')).toBeNull();

    // Interactive Solva data-category filter works cleanly & preserves card_last4 visibility
    fireEvent.click(screen.getByRole('button', { name: /Dữ liệu Nhạy cảm \(1\)/i }));
    expect(screen.getAllByText(/card_last4/i).length).toBeGreaterThan(0);

    // Also renders cleanly in English via the Solva header language toggle
    fireEvent.click(screen.getByRole('button', { name: /VI \/ EN/i }));
    await waitFor(() => {
      expect(
        screen.getByText(/OFFICIAL PERSONAL DATA PROTECTION NOTICE · v1\.0/),
      ).toBeDefined();
      expect(screen.getAllByText(/2 business days/i).length).toBeGreaterThan(0);
      expect(
        screen.getByText(/© 2026 CITRA — Academic Citation Integrity Workspace/),
      ).toBeDefined();
      expect(screen.queryByText(/\bDRAFT\b/i)).toBeNull();
      expect(screen.queryByText(/LEGAL DRAFT/i)).toBeNull();
      expect(screen.queryByText(/\[CHECK:/i)).toBeNull();
      expect(screen.queryByText(/SourceLogic/i)).toBeNull();
    });
  });

  it('[DLCN-01] PrivacyPolicyPage uses a single-row global header, sticky policy section sub-bar, blur-free Section 05 reveals, and demo-gated sandbox notices', async () => {
    vi.stubEnv('VITE_DEMO_MODE', 'false');
    const origGetBCR = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = vi.fn(() => ({
      x: 0,
      y: 1200,
      top: 1200,
      bottom: 1400,
      left: 0,
      right: 1200,
      width: 1200,
      height: 200,
      toJSON: () => ({}),
    })) as unknown as typeof Element.prototype.getBoundingClientRect;

    try {
      const { unmount } = render(
        <ThemeProvider defaultTheme="light">
          <MemoryRouter initialEntries={['/privacy']}>
            <Routes>
              <Route path="/privacy" element={<PrivacyPolicyPage />} />
            </Routes>
          </MemoryRouter>
        </ThemeProvider>,
      );

      const header = document.querySelector('header');
      expect(header).not.toBeNull();
      const desktopHeaderNav = header!.querySelector('nav');
      expect(desktopHeaderNav).not.toBeNull();
      expect(desktopHeaderNav!.className).toContain('flex-nowrap');
      // Policy section jump links are moved out of the desktop global header into the sticky sub-bar
      expect(desktopHeaderNav!.querySelector('a[href="#controller"]')).toBeNull();
      expect(desktopHeaderNav!.querySelector('a[href="#data-collected"]')).toBeNull();
      expect(desktopHeaderNav!.querySelector('a[href="#rights"]')).toBeNull();
      desktopHeaderNav!.querySelectorAll('a').forEach((link) => {
        expect(link.className).toContain('whitespace-nowrap');
      });

      const subnav = screen.getByTestId('privacy-section-subnav');
      expect(subnav.className).toContain('sticky');
      expect(subnav.querySelector('a[href="#controller"]')).not.toBeNull();
      expect(subnav.querySelector('a[href="#data-collected"]')).not.toBeNull();
      expect(subnav.querySelector('a[href="#sensitive-data"]')).not.toBeNull();
      expect(subnav.querySelector('a[href="#third-parties"]')).not.toBeNull();
      expect(subnav.querySelector('a[href="#rights"]')).not.toBeNull();

      // Anchor targets clear both fixed header (76px) + sticky sub-bar (42px)
      for (const anchorId of ['controller', 'data-collected', 'third-parties', 'rights', 'sla']) {
        const sectionEl = document.getElementById(anchorId);
        expect(sectionEl).not.toBeNull();
        const match = sectionEl!.className.match(/scroll-mt-\[(\d+)px\]/);
        expect(match).not.toBeNull();
        expect(Number(match![1])).toBeGreaterThanOrEqual(132);
      }

      // Zero mid-scroll blur(...) filters across main content & Section 05 (#rights)
      const mainContent = document.getElementById('privacy-main-content');
      expect(mainContent).not.toBeNull();
      mainContent!.querySelectorAll('[style]').forEach((el) => {
        expect(el.getAttribute('style') ?? '').not.toMatch(/blur\(/i);
      });

      // Production mode hides internal test-card / sandbox simulation copy
      expect(
        screen.queryByText(/Stripe Demo|VNPay Sandbox|thẻ test|thẻ kiểm thử|test cards/i),
      ).toBeNull();

      unmount();
    } finally {
      Element.prototype.getBoundingClientRect = origGetBCR;
      vi.unstubAllEnvs();
    }

    // In Demo Evaluator Mode, public test-card / simulation safeguard notice is disclosed
    vi.stubEnv('VITE_DEMO_MODE', 'true');
    try {
      render(
        <ThemeProvider defaultTheme="light">
          <MemoryRouter initialEntries={['/privacy']}>
            <Routes>
              <Route path="/privacy" element={<PrivacyPolicyPage />} />
            </Routes>
          </MemoryRouter>
        </ThemeProvider>,
      );
      expect(screen.getAllByText(/Stripe Demo|thẻ kiểm thử/i).length).toBeGreaterThan(0);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('[DLCN-01] PrivacyPolicyPage honors Fix Round 1 UX/visual/non-tech polish: localized schema button, zero ellipsis truncation, sticky stack clearance, localized VI badges, OpenAIRE ticker, and unpublished-thesis confidentiality', async () => {
    render(
      <ThemeProvider defaultTheme="light">
        <MemoryRouter initialEntries={['/privacy']}>
          <Routes>
            <Route path="/privacy" element={<PrivacyPolicyPage />} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>,
    );

    // 1. Mobile-safe Data Matrix filter with aria-pressed + localized visible schema label
    const allFilterBtn = screen.getByRole('button', { name: /Tất cả \(5\)/i });
    const sensitiveFilterBtn = screen.getByRole('button', { name: /Dữ liệu Nhạy cảm \(1\)/i });
    expect(allFilterBtn.getAttribute('aria-pressed')).toBe('true');
    expect(sensitiveFilterBtn.getAttribute('aria-pressed')).toBe('false');

    const schemaToggle = screen.getByRole('button', {
      name: /Chi tiết trường kỹ thuật \/ Technical Schema/i,
    });
    expect(schemaToggle.textContent?.trim()).toBe('Chi tiết trường kỹ thuật');

    // 2. Zero .truncate classes inside Hero Governance Widget or Hero SLA Proof Strip
    const heroSection = document.getElementById('privacy-hero');
    expect(heroSection).not.toBeNull();
    expect(heroSection!.querySelectorAll('.truncate').length).toBe(0);

    // 3. Sticky Stack Card 0 clears sticky sub-nav (baseTopDesktop=132) & #sensitive-data is on static <section>
    const stickyCard0 = screen.getByTestId('solva-sticky-card-0');
    expect(stickyCard0.style.top).toBe('132px');
    const sensitiveAnchor = document.getElementById('sensitive-data');
    expect(sensitiveAnchor).not.toBeNull();
    expect(sensitiveAnchor!.tagName).toBe('SECTION');
    expect(sensitiveAnchor!.className).toContain('scroll-mt-[132px]');
    expect(stickyCard0.contains(sensitiveAnchor)).toBe(false);

    const subnav = screen.getByTestId('privacy-section-subnav');
    const subnavLink = subnav.querySelector('a[href="#controller"]') as HTMLAnchorElement;
    expect(subnavLink.style.color).toBe('');
    expect(subnavLink.className).toContain('text-[var(--solva-muted)]');

    // 4. Ticker replaces self-hosted GROBID TEI with OpenAIRE; VI eliminates residual English/SQL/tech jargon
    expect(screen.queryByText(/GROBID TEI/i)).toBeNull();
    expect(screen.getAllByText(/^OpenAIRE$/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/tệp mồ côi/i)).toBeNull();
    expect(screen.queryByText(/0 Orphaned Files/i)).toBeNull();
    expect(screen.queryByText(/Neuro-Symbolic hai tầng trực giao/i)).toBeNull();
    expect(screen.queryByText(/L1 × L2/i)).toBeNull();
    expect(screen.queryByText(/^ISOLATED$/)).toBeNull();
    expect(screen.queryByText(/^NEVER STORED$/)).toBeNull();
    expect(screen.queryByText(/^0 TRACKERS$/)).toBeNull();
    expect(screen.queryByText(/^CASCADE PURGE$/)).toBeNull();
    expect(screen.getByText('CÁCH LY BẢO MẬT')).toBeDefined();
    expect(screen.getByText('KHÔNG LƯU TRỮ')).toBeDefined();
    expect(screen.getByText('4 số cuối (card_last4)')).toBeDefined();
    expect(document.getElementById('data-collected')!.textContent).toContain(
      'ảnh đại diện tải lên',
    );

    // 5. Unpublished-thesis confidentiality reassurance in VI (no full-text transmit, no shared Turnitin/similarity pool)
    expect(screen.getAllByText(/Turnitin/i).length).toBeGreaterThanOrEqual(2);

    // Switch to English and verify localized schema label, zero PAN/SMTP jargon, and Turnitin reassurance
    fireEvent.click(screen.getByRole('button', { name: /VI \/ EN/i }));
    await waitFor(() => {
      expect(schemaToggle.textContent?.trim()).toBe('Technical Schema');
      expect(screen.getByText('Last 4 digits (card_last4)')).toBeDefined();
      expect(screen.queryByText(/\bPAN\b/)).toBeNull();
      expect(screen.queryByText(/\bSMTP\b/)).toBeNull();
      expect(screen.getAllByText(/Turnitin/i).length).toBeGreaterThanOrEqual(2);
    });
  });

  it('[DLCN-01] PricingPage footer includes a link to /privacy', () => {
    renderWithProviders(<PricingPage />, { user: null, initialRoute: '/pricing' });
    const privacyLinks = document.querySelectorAll('a[href="/privacy"]');
    expect(privacyLinks.length).toBeGreaterThan(0);
  });

  it('[DLCN-02] RegisterPage renders unchecked consent checkbox, blocks submission when unchecked, and sends privacy_consent=true when checked', async () => {
    const registerSpy = vi.spyOn(api, 'register').mockResolvedValue({
      message: 'Created',
      username: 'minh_consent',
      email: 'minh.consent@tdtu.edu.vn',
      requires_activation: true,
      email_sent: true,
    });

    render(
      <ThemeProvider defaultTheme="light">
        <MemoryRouter initialEntries={['/register']}>
          <RegisterPage />
        </MemoryRouter>
      </ThemeProvider>,
    );

    const checkbox = screen.getByTestId('register-privacy-consent-checkbox') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    expect(document.querySelector('a[href="/privacy"]')).not.toBeNull();

    fireEvent.change(screen.getByLabelText(/full name|họ và tên/i), {
      target: { value: 'Nguyen Bao Minh' },
    });
    fireEvent.change(screen.getByLabelText(/username|tên đăng nhập/i), {
      target: { value: 'minh_consent' },
    });
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'minh.consent@tdtu.edu.vn' },
    });
    fireEvent.change(screen.getByLabelText(/^(password|mật khẩu)$/i), {
      target: { value: 'Pass12345!' },
    });
    fireEvent.change(screen.getByLabelText(/confirm password|xác nhận mật khẩu/i), {
      target: { value: 'Pass12345!' },
    });

    // Submit WITHOUT checking privacy consent -> blocked!
    fireEvent.click(
      screen.getByRole('button', { name: /create account|đăng ký tài khoản/i }),
    );
    expect(registerSpy).not.toHaveBeenCalled();

    // Now check the box and submit -> succeeds with privacy_consent: true
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);
    fireEvent.click(
      screen.getByRole('button', { name: /create account|đăng ký tài khoản/i }),
    );

    await waitFor(() => {
      expect(registerSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          username: 'minh_consent',
          email: 'minh.consent@tdtu.edu.vn',
          privacy_consent: true,
          privacy_policy_version: '1.0',
        }),
      );
    });
  });

  it('[DLCN-02] GoogleOnboardingModal requires privacy consent when user has not consented yet', async () => {
    const updateMeSpy = vi.spyOn(api, 'updateMe').mockResolvedValue(
      makeUser('user', 'basic', {
        username: 'google_scholar_vn',
        needs_onboarding: false,
        privacy_consented_at: '2026-11-05T04:00:00Z',
        privacy_policy_version: '1.0',
      }),
    );

    const unconsentedGoogleUser = makeUser('user', 'basic', {
      username: 'scholar_tmp',
      auth_provider: 'google',
      google_linked: true,
      has_password: false,
      can_set_username: true,
      needs_onboarding: true,
      privacy_consented_at: null,
      privacy_policy_version: null,
    });

    renderWithProviders(<GoogleOnboardingModal />, {
      user: unconsentedGoogleUser,
      initialRoute: '/dashboard',
    });

    const checkbox = screen.getByTestId('onboarding-privacy-consent-checkbox') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);

    // Clicking save while unchecked is blocked
    fireEvent.click(screen.getByTestId('onboarding-save-btn'));
    expect(updateMeSpy).not.toHaveBeenCalled();

    // Check box and save -> calls updateMe with privacy_consent: true
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByTestId('onboarding-save-btn'));

    await waitFor(() => {
      expect(updateMeSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          complete_onboarding: true,
          privacy_consent: true,
          privacy_policy_version: '1.0',
        }),
      );
    });
  });

  it('[DLCN-02] UploadPage and BatchUploadPage display cross-border & author-consent notices with /privacy links', async () => {
    vi.spyOn(api, 'listMyClasses').mockResolvedValue([]);
    renderWithProviders(<UploadPage />, {
      user: makeUser('user', 'pro'),
      initialRoute: '/upload',
    });
    const uploadNotice = await screen.findByTestId('upload-privacy-notice');
    expect(uploadNotice.textContent).toMatch(/Crossref|cơ sở dữ liệu học thuật|scholarly/i);
    expect(uploadNotice.querySelector('a[href*="/privacy"]')).not.toBeNull();

    renderWithProviders(<BatchUploadPage />, {
      user: makeUser('teacher', 'pro'),
      initialRoute: '/batch',
    });
    const batchNotice = await screen.findByTestId('batch-upload-privacy-notice');
    expect(batchNotice.textContent).toMatch(/tác giả|sinh viên|author|student/i);
    expect(batchNotice.querySelector('a[href*="/privacy"]')).not.toBeNull();
  });

  it('[DLCN-02] StripeDemoCheckoutPage displays sensitive payment data notice with /privacy link', async () => {
    vi.spyOn(api, 'getCheckoutSessionDetails').mockResolvedValue({
      session_id: 'cs_demo_privacy_test',
      status: 'pending',
      payment_mode: 'stripe_demo',
      merchant_name: 'CITRA (SourceLogic)',
      plan_tier: 'pro',
      plan_name: 'CITRA Pro',
      billing_cycle: 'monthly',
      amount_usd: 20,
      monthly_equivalent_usd: 20,
      annual_savings_usd: 0,
      currency: 'usd',
      customer_email: 'student@tdtu.edu.vn',
      customer_name: 'Student Test',
      features_en: ['50 uploads / month'],
      features_vi: ['50 lượt tải / tháng'],
    });

    renderWithProviders(<StripeDemoCheckoutPage />, {
      user: makeUser('user', 'basic'),
      initialRoute: '/billing/checkout?session_id=cs_demo_privacy_test',
    });

    const sensitiveNotice = await screen.findByTestId('checkout-sensitive-data-notice');
    expect(sensitiveNotice.textContent).toMatch(/nhạy cảm|sensitive/i);
    expect(sensitiveNotice.querySelector('a[href*="/privacy"]')).not.toBeNull();
  });

  it('[DLCN-03] SettingsPage allows local user to delete account with password confirmation and logs out', async () => {
    vi.spyOn(api, 'getMySubscription').mockResolvedValue({
      subscription: {
        plan_tier: 'basic',
        plan_name: 'Basic',
        billing_cycle: null,
        subscription_status: 'active',
        cancel_at_period_end: false,
        current_period_start: null,
        current_period_end: null,
        quota: QUOTA_BY_TIER.basic,
      },
      transactions: [],
    } as never);
    const deleteSpy = vi
      .spyOn(api, 'deleteMyAccount')
      .mockResolvedValue({ message: 'Deleted' });
    const logoutMock = vi.fn().mockResolvedValue(undefined);

    const localUser = makeUser('user', 'basic', {
      username: 'local_student',
      has_password: true,
      auth_provider: 'local',
      privacy_consented_at: '2026-11-05T03:00:00Z',
      privacy_policy_version: '1.0',
    });

    renderWithProviders(<SettingsPage />, {
      user: localUser,
      authOverrides: { logout: logoutMock },
    });

    expect(await screen.findByTestId('settings-privacy-section')).toBeDefined();
    fireEvent.click(screen.getByTestId('settings-delete-account-btn'));

    const modal = await screen.findByTestId('delete-account-modal');
    expect(modal).toBeDefined();

    const pwInput = screen.getByTestId('delete-account-password-input');
    fireEvent.change(pwInput, { target: { value: 'MySecret123!' } });
    fireEvent.click(screen.getByTestId('delete-account-confirm-btn'));

    await waitFor(() => {
      expect(deleteSpy).toHaveBeenCalledWith({ current_password: 'MySecret123!' });
    });
    await waitFor(() => {
      expect(logoutMock).toHaveBeenCalledTimes(1);
    });
  });

  it('[DLCN-03] SettingsPage allows Google-only user to delete account by typing exact username', async () => {
    vi.spyOn(api, 'getMySubscription').mockResolvedValue({
      subscription: {
        plan_tier: 'basic',
        plan_name: 'Basic',
        billing_cycle: null,
        subscription_status: 'active',
        cancel_at_period_end: false,
        current_period_start: null,
        current_period_end: null,
        quota: QUOTA_BY_TIER.basic,
      },
      transactions: [],
    } as never);
    const deleteSpy = vi
      .spyOn(api, 'deleteMyAccount')
      .mockResolvedValue({ message: 'Deleted' });
    const logoutMock = vi.fn().mockResolvedValue(undefined);

    const googleUser = makeUser('user', 'basic', {
      username: 'google_only_user',
      has_password: false,
      auth_provider: 'google',
      google_linked: true,
    });

    renderWithProviders(<SettingsPage />, {
      user: googleUser,
      authOverrides: { logout: logoutMock },
    });

    fireEvent.click(await screen.findByTestId('settings-delete-account-btn'));
    const handleInput = await screen.findByTestId('delete-account-username-input');

    // Wrong username -> button disabled or blocked
    fireEvent.change(handleInput, { target: { value: 'wrong_name' } });
    fireEvent.click(screen.getByTestId('delete-account-confirm-btn'));
    expect(deleteSpy).not.toHaveBeenCalled();

    // Exact username -> calls deleteMyAccount({ confirm_username })
    fireEvent.change(handleInput, { target: { value: 'google_only_user' } });
    fireEvent.click(screen.getByTestId('delete-account-confirm-btn'));

    await waitFor(() => {
      expect(deleteSpy).toHaveBeenCalledWith({ confirm_username: 'google_only_user' });
    });
    await waitFor(() => {
      expect(logoutMock).toHaveBeenCalledTimes(1);
    });
  });
});
