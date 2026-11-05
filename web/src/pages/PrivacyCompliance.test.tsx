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

  it('[DLCN-01] PrivacyPolicyPage renders Solva editorial layout with Vietnamese policy, draft banner, statutory SLAs, interactive filter, sticky stack, and cross-border APIs', async () => {
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
    expect(screen.getByTestId('solva-sticky-card-0')).toBeDefined();
    expect(document.querySelector('.animate-solva-marquee')).not.toBeNull();
    expect(document.querySelector('footer')).not.toBeNull();

    expect(screen.getAllByText(/BẢN NHÁP/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/91\/2025\/QH15/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/356\/2025\/NĐ-CP/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Đại học Tôn Đức Thắng/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/19 Nguyễn Hữu Thọ, phường Tân Hưng, TP\. Hồ Chí Minh/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Nguyễn Bảo Minh/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/iannwendii@gmail\.com/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Mã số doanh nghiệp/i)).toBeNull();
    expect(screen.getAllByText(/02 ngày làm việc/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Crossref/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/OpenAlex/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/VNPay/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/\[KIỂM TRA:/i).length).toBeGreaterThan(0);

    // Interactive Solva data-category filter works cleanly
    fireEvent.click(screen.getByRole('button', { name: /Dữ liệu Nhạy cảm \(1\)/i }));
    expect(screen.getAllByText(/card_last4/i).length).toBeGreaterThan(0);

    // Also renders cleanly in English via the Solva header language toggle
    fireEvent.click(screen.getByRole('button', { name: /VI \/ EN/i }));
    await waitFor(() => {
      expect(screen.getAllByText(/DRAFT/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/2 business days/i).length).toBeGreaterThan(0);
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
