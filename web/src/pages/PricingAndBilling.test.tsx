import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { ToastProvider } from '@/contexts/ToastContext';
import { AuthContext } from '@/contexts/AuthContext';
import { api, type User } from '@/api/client';
import i18n from '@/i18n';
import { APP_VERSION } from '@/version';
import { AuthSplitShell } from '@/components/AuthSplitShell';
import { PricingPage } from './PricingPage';
import { LandingPage } from './LandingPage';
import { StripeDemoCheckoutPage } from './StripeDemoCheckoutPage';
import { BillingSuccessPage } from './BillingSuccessPage';
import { PromoManagementPage } from './PromoManagementPage';
import { UploadPage } from './UploadPage';
import { SandboxPage } from './SandboxPage';
import { EssayPage } from './EssayPage';
import { ProcessingPage } from './ProcessingPage';
import { SettingsPage } from './SettingsPage';
import { EssayHeader } from './essay/EssayHeader';
import { EssayActionBar } from './essay/EssayActionBar';
import { UpgradeModal } from '@/components/UpgradeModal';
import { AppLayout } from '@/components/AppLayout';
import { SolvaScrollReveal } from '@/components/landing/SolvaPrimitives';

function createMockUser(overrides: Partial<User> = {}): User {
  return {
    id: 10,
    username: 'student_free',
    email: 'student@tdtu.edu.vn',
    full_name: 'Student Free',
    role: 'user',
    is_active: true,
    avatar_url: null,
    last_login_at: null,
    created_at: null,
    institution: 'TDTU',
    can_override_verdicts: false,
    plan_tier: 'basic',
    billing_cycle: null,
    subscription_status: 'active',
    cancel_at_period_end: false,
    current_period_end: null,
    quota: {
      monthly_uploads_used: 2,
      monthly_uploads_limit: 3,
      monthly_uploads_remaining: 1,
      max_file_size_mb: 5,
      max_pages_per_pdf: 15,
      max_citations_per_essay: 30,
      max_batch_files: 1,
      allowed_export_formats: ['json'],
      allow_batch_upload: false,
      allow_deep_inspector: false,
      allow_serpapi_fallback: false,
      quota_reset_at: '2026-11-25T00:00:00Z',
    },
    ...overrides,
  };
}

function renderWithAuth(
  ui: React.ReactElement,
  {
    user = createMockUser(),
    initialEntries = ['/'],
    refreshUser = vi.fn().mockResolvedValue(undefined),
  }: {
    user?: User | null;
    initialEntries?: string[];
    refreshUser?: () => Promise<void>;
  } = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="light">
        <ToastProvider>
          <AuthContext.Provider
            value={{
              user,
              token: user ? 'mock-jwt-token' : null,
              isLoading: false,
              isAdmin: user?.role === 'admin',
              login: vi.fn(),
              logout: vi.fn(),
              refreshUser,
            }}
          >
            <MemoryRouter initialEntries={initialEntries}>{ui}</MemoryRouter>
          </AuthContext.Provider>
        </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('Premium Subscription, Pricing, Stripe Checkout & Paywall UI/UX Flows', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
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

  it('PricingPage renders 3 tiers (Basic $0, Pro $16/$20, Ultra $160/$200) and toggles Monthly/Annual pricing', () => {
    renderWithAuth(<PricingPage />, { user: createMockUser(), initialEntries: ['/pricing'] });

    // Default is Annual (-20%): Pro = $16/mo, Ultra = $160/mo
    expect(screen.getByTestId('plan-card-basic')).toBeDefined();
    expect(screen.getByTestId('plan-card-pro')).toBeDefined();
    expect(screen.getByTestId('plan-card-ultra')).toBeDefined();
    expect(screen.getByTestId('pro-price-display').textContent).toBe('$16');
    expect(screen.getByTestId('ultra-price-display').textContent).toBe('$160');

    // User clicks Monthly Billing toggle -> Pro = $20/mo, Ultra = $200/mo
    fireEvent.click(screen.getByTestId('billing-toggle-monthly'));
    expect(screen.getByTestId('pro-price-display').textContent).toBe('$20');
    expect(screen.getByTestId('ultra-price-display').textContent).toBe('$200');

    // User switches back to Annual Billing -> Pro = $16/mo, Ultra = $160/mo
    fireEvent.click(screen.getByTestId('billing-toggle-annual'));
    expect(screen.getByTestId('pro-price-display').textContent).toBe('$16');
    expect(screen.getByTestId('ultra-price-display').textContent).toBe('$160');
  });

  it('PricingPage initiates Stripe Demo Checkout when Basic user clicks Upgrade to Pro or Ultra', async () => {
    const createSessionSpy = vi.spyOn(api, 'createCheckoutSession').mockResolvedValue({
      session_id: 'cs_test_demo_pro123',
      checkout_url: '/billing/checkout?session_id=cs_test_demo_pro123',
      mode: 'stripe_demo',
      plan_tier: 'pro',
      plan_name: 'Pro',
      billing_cycle: 'annual',
      amount_usd: 192,
      transaction_id: 1,
    });

    renderWithAuth(
      <Routes>
        <Route path="/pricing" element={<PricingPage />} />
        <Route path="/billing/checkout" element={<div data-testid="checkout-dest">Stripe Checkout Route</div>} />
      </Routes>,
      { user: createMockUser(), initialEntries: ['/pricing'] },
    );

    fireEvent.click(screen.getByTestId('select-pro-btn'));

    await waitFor(() => {
      expect(createSessionSpy).toHaveBeenCalledWith({
        plan_tier: 'pro',
        billing_cycle: 'annual',
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('checkout-dest')).toBeDefined();
    });
  });

  it('StripeDemoCheckoutPage loads session summary, autofills test cards (4242 / 4444), and submits payment', async () => {
    vi.spyOn(api, 'getCheckoutSessionDetails').mockResolvedValue({
      session_id: 'cs_test_demo_pro123',
      status: 'pending',
      payment_mode: 'stripe_demo',
      merchant_name: 'CITRA (SourceLogic) Inc.',
      customer_email: 'student@tdtu.edu.vn',
      customer_name: 'Nguyen Bao Minh',
      plan_tier: 'pro',
      plan_name: 'CITRA Pro',
      billing_cycle: 'annual',
      amount_usd: 192,
      monthly_equivalent_usd: 16,
      annual_savings_usd: 48,
      currency: 'usd',
      features_en: ['50 PDF checks / month', 'Export PDF & DOCX'],
      features_vi: ['50 lượt tải PDF / tháng', 'Xuất báo cáo PDF & DOCX'],
    });

    const verifySpy = vi.spyOn(api, 'verifyCheckoutSession').mockResolvedValue({
      status: 'succeeded',
      message: 'Upgraded!',
      transaction: {
        id: 1,
        user_id: 10,
        stripe_session_id: 'cs_test_demo_pro123',
        stripe_payment_intent_id: 'pi_demo_123',
        plan_tier: 'pro',
        plan_name: 'Pro',
        billing_cycle: 'annual',
        amount_usd: 192,
        currency: 'usd',
        status: 'succeeded',
        payment_mode: 'stripe_demo',
        card_brand: 'mastercard',
        card_last4: '4444',
        created_at: '2026-10-26T00:00:00Z',
        paid_at: '2026-10-26T00:01:00Z',
      },
      subscription: {
        plan_tier: 'pro',
        plan_name: 'Pro',
        billing_cycle: 'annual',
        subscription_status: 'active',
        cancel_at_period_end: false,
        current_period_start: '2026-10-26T00:00:00Z',
        current_period_end: '2027-10-26T00:00:00Z',
        quota: createMockUser().quota!,
      },
      user: createMockUser({ plan_tier: 'pro', billing_cycle: 'annual' }),
    });

    const refreshUserMock = vi.fn().mockResolvedValue(undefined);

    renderWithAuth(
      <Routes>
        <Route path="/billing/checkout" element={<StripeDemoCheckoutPage />} />
        <Route path="/billing/success" element={<div data-testid="success-dest">Success Page</div>} />
      </Routes>,
      {
        user: createMockUser(),
        initialEntries: ['/billing/checkout?session_id=cs_test_demo_pro123'],
        refreshUser: refreshUserMock,
      },
    );

    await waitFor(() => {
      expect(screen.getByTestId('stripe-demo-checkout-page')).toBeDefined();
    });
    expect(screen.getByTestId('checkout-amount-display').textContent).toBe('$192.00');

    // User clicks 1-click Mastercard autofill button -> fills 5555 5555 5555 4444
    fireEvent.click(screen.getByTestId('autofill-mastercard-btn'));
    const cardInput = screen.getByTestId('stripe-card-number-input') as HTMLInputElement;
    expect(cardInput.value).toBe('5555 5555 5555 4444');

    // User clicks Pay & Activate button
    fireEvent.click(screen.getByTestId('stripe-pay-submit-btn'));

    await waitFor(() => {
      expect(verifySpy).toHaveBeenCalledWith({
        session_id: 'cs_test_demo_pro123',
        payment_method: 'card',
        card_last4: '4444',
        card_brand: 'mastercard',
        billing_country: 'VN',
        billing_zip: '700000',
      });
    });
    expect(refreshUserMock).toHaveBeenCalled();

    await waitFor(() => {
      expect(screen.getByTestId('success-dest')).toBeDefined();
    });
  });

  it('StripeDemoCheckoutPage supports applying and removing 6-character promo codes and paying via Apple Pay & Google Pay', async () => {
    const baseDetails = {
      session_id: 'cs_test_demo_pro123',
      status: 'pending',
      payment_mode: 'stripe_demo',
      merchant_name: 'CITRA (SourceLogic) Inc.',
      customer_email: 'student@tdtu.edu.vn',
      customer_name: 'Nguyen Bao Minh',
      plan_tier: 'pro' as const,
      plan_name: 'CITRA Pro',
      billing_cycle: 'annual' as const,
      subtotal_usd: 192,
      discount_usd: 0,
      promo_code: null,
      promo_details: null,
      amount_usd: 192,
      monthly_equivalent_usd: 16,
      annual_savings_usd: 48,
      currency: 'usd',
      features_en: ['50 PDF checks / month'],
      features_vi: ['50 lượt tải PDF / tháng'],
    };

    vi.spyOn(api, 'getCheckoutSessionDetails').mockResolvedValue(baseDetails);

    const applyPromoSpy = vi
      .spyOn(api, 'applyCheckoutSessionPromo')
      .mockImplementation(async (_sid, code) => {
        if (code) {
          return {
            ...baseDetails,
            promo_code: code,
            discount_usd: 38.4,
            amount_usd: 153.6,
            promo_details: {
              code,
              description: 'Welcome Academic Discount (20% Off)',
              discount_type: 'percent',
              discount_value: 20,
              max_discount_usd: 100,
              discount_usd: 38.4,
            },
          };
        }
        return baseDetails;
      });

    const verifySpy = vi.spyOn(api, 'verifyCheckoutSession').mockResolvedValue({
      status: 'succeeded',
      message: 'Upgraded via Apple Pay!',
      transaction: {
        id: 2,
        user_id: 10,
        stripe_session_id: 'cs_test_demo_pro123',
        stripe_payment_intent_id: 'pi_demo_apay',
        plan_tier: 'pro',
        plan_name: 'Pro',
        billing_cycle: 'annual',
        subtotal_usd: 192,
        discount_usd: 38.4,
        promo_code: 'CITRA2',
        amount_usd: 153.6,
        currency: 'usd',
        status: 'succeeded',
        payment_mode: 'stripe_demo',
        payment_method: 'apple_pay',
        card_brand: 'visa',
        card_last4: '4242',
        created_at: '2026-10-26T00:00:00Z',
        paid_at: '2026-10-26T00:01:00Z',
      },
      subscription: {
        plan_tier: 'pro',
        plan_name: 'Pro',
        billing_cycle: 'annual',
        subscription_status: 'active',
        cancel_at_period_end: false,
        current_period_start: '2026-10-26T00:00:00Z',
        current_period_end: '2027-10-26T00:00:00Z',
        quota: createMockUser().quota!,
      },
      user: createMockUser({ plan_tier: 'pro', billing_cycle: 'annual' }),
    });

    renderWithAuth(
      <Routes>
        <Route path="/billing/checkout" element={<StripeDemoCheckoutPage />} />
        <Route path="/billing/success" element={<div data-testid="apay-success">Apple Pay Confirmed</div>} />
      </Routes>,
      {
        user: createMockUser(),
        initialEntries: ['/billing/checkout?session_id=cs_test_demo_pro123'],
      },
    );

    await waitFor(() => {
      expect(screen.getByTestId('stripe-demo-checkout-page')).toBeDefined();
    });

    // Apply 6-char promo code CITRA2
    const promoInput = screen.getByTestId('checkout-promo-input') as HTMLInputElement;
    fireEvent.change(promoInput, { target: { value: 'citra2' } });
    fireEvent.click(screen.getByTestId('checkout-promo-apply-btn'));

    await waitFor(() => {
      expect(applyPromoSpy).toHaveBeenCalledWith('cs_test_demo_pro123', 'CITRA2');
      expect(screen.getByTestId('checkout-amount-display').textContent).toBe('$153.60');
      expect(screen.getByTestId('checkout-applied-promo-badge')).toBeDefined();
    });

    // Click Express Apple Pay button -> opens Apple Pay Wallet Modal
    fireEvent.click(screen.getByTestId('express-apple-pay-btn'));
    expect(screen.getByTestId('wallet-payment-modal')).toBeDefined();

    // Confirm biometric Apple Pay payment
    fireEvent.click(screen.getByTestId('wallet-confirm-pay-btn'));

    await waitFor(() => {
      expect(verifySpy).toHaveBeenCalledWith({
        session_id: 'cs_test_demo_pro123',
        payment_method: 'apple_pay',
        card_last4: '4242',
        card_brand: 'visa',
        billing_country: 'VN',
        billing_zip: '700000',
      });
      expect(screen.getByTestId('apay-success')).toBeDefined();
    });
  });

  it('BillingSuccessPage displays Stripe payment receipt and unlocked Pro quotas', async () => {
    vi.spyOn(api, 'verifyCheckoutSession').mockResolvedValue({
      status: 'succeeded',
      message: 'Upgraded',
      transaction: {
        id: 7,
        user_id: 10,
        stripe_session_id: 'cs_test_demo_pro123',
        stripe_payment_intent_id: 'pi_demo_777',
        plan_tier: 'pro',
        plan_name: 'Pro',
        billing_cycle: 'annual',
        amount_usd: 192,
        currency: 'usd',
        status: 'succeeded',
        payment_mode: 'stripe_demo',
        card_brand: 'visa',
        card_last4: '4242',
        created_at: '2026-10-26T00:00:00Z',
        paid_at: '2026-10-26T00:01:00Z',
      },
      subscription: {
        plan_tier: 'pro',
        plan_name: 'Pro',
        billing_cycle: 'annual',
        subscription_status: 'active',
        cancel_at_period_end: false,
        current_period_start: '2026-10-26T00:00:00Z',
        current_period_end: '2027-10-26T00:00:00Z',
        quota: {
          ...createMockUser().quota!,
          monthly_uploads_limit: 50,
          max_file_size_mb: 25,
          max_pages_per_pdf: 100,
        },
      },
      user: createMockUser({ plan_tier: 'pro' }),
    });

    renderWithAuth(
      <Routes>
        <Route path="/billing/success" element={<BillingSuccessPage />} />
      </Routes>,
      {
        user: createMockUser({ plan_tier: 'pro' }),
        initialEntries: ['/billing/success?session_id=cs_test_demo_pro123'],
      },
    );

    await waitFor(() => {
      expect(screen.getByTestId('billing-success-page')).toBeDefined();
    });
    expect(screen.getByTestId('billing-receipt-box').textContent).toContain('$192.00 USD');
    expect(screen.getByTestId('billing-receipt-box').textContent).toContain('4242');
    expect(screen.getByTestId('success-go-upload-btn')).toBeDefined();
  });

  it('UploadPage blocks files > 5MB for Basic users and automatically pops up UpgradeModal', async () => {
    const uploadSpy = vi.spyOn(api, 'uploadEssay');
    const { container } = renderWithAuth(<UploadPage />, {
      user: createMockUser({ plan_tier: 'basic' }),
      initialEntries: ['/upload'],
    });

    expect(screen.getByTestId('upload-quota-banner').textContent).toContain('2/3');

    // Simulate user selecting a 7 MB PDF file (exceeds Basic 5 MB limit)
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const oversizedFile = new File([new ArrayBuffer(7 * 1024 * 1024)], 'large_thesis.pdf', {
      type: 'application/pdf',
    });
    fireEvent.change(fileInput, { target: { files: [oversizedFile] } });

    // Click Start Verification button
    const uploadBtn = screen.getByRole('button', {
      name: /start verification|bắt đầu kiểm tra|kiểm chứng/i,
    });
    fireEvent.click(uploadBtn);

    // Should NOT call backend API; instead opens UpgradeModal
    expect(uploadSpy).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByTestId('upgrade-modal')).toBeDefined();
    });
  });

  it('EssayHeader intercepts PDF and DOCX export clicks for Basic users and opens UpgradeModal', async () => {
    const downloadSpy = vi.spyOn(api, 'downloadReportFile');
    renderWithAuth(
      <EssayHeader
        essayId={42}
        filename="student_draft.pdf"
        numPages={8}
        numCitations={12}
        styleName="APA"
      />,
      { user: createMockUser({ plan_tier: 'basic' }) },
    );

    fireEvent.click(screen.getByTestId('export-pdf-btn'));

    expect(downloadSpy).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByTestId('upgrade-modal')).toBeDefined();
    });
  });

  it('EssayActionBar shows PRO lock badges on deep tabs for Basic users and unlocks them for Pro users', async () => {
    const { unmount } = renderWithAuth(<EssayActionBar essayId="42" />, {
      user: createMockUser({ plan_tier: 'basic' }),
      initialEntries: ['/verification/report/42'],
    });

    // Basic user sees locked buttons
    const lockedDocBtn = screen.getByTestId('locked-document-inspector-btn');
    expect(lockedDocBtn).toBeDefined();
    fireEvent.click(lockedDocBtn);
    await waitFor(() => {
      expect(screen.getByTestId('upgrade-modal')).toBeDefined();
    });
    unmount();

    // Pro user sees unlocked links without lock buttons
    renderWithAuth(<EssayActionBar essayId="42" />, {
      user: createMockUser({ plan_tier: 'pro' }),
      initialEntries: ['/verification/report/42'],
    });
    expect(screen.queryByTestId('locked-document-inspector-btn')).toBeNull();
    expect(screen.queryByTestId('locked-logic-trace-btn')).toBeNull();
  });

  it('SettingsPage displays active subscription, transaction history, and supports Cancel / Reactivate auto-renewal', async () => {
    vi.spyOn(api, 'getMySubscription').mockResolvedValue({
      subscription: {
        plan_tier: 'pro',
        plan_name: 'Pro',
        billing_cycle: 'annual',
        subscription_status: 'active',
        cancel_at_period_end: false,
        current_period_start: '2026-10-26T00:00:00Z',
        current_period_end: '2027-10-26T00:00:00Z',
        quota: {
          ...createMockUser().quota!,
          monthly_uploads_limit: 50,
          max_file_size_mb: 25,
          max_pages_per_pdf: 100,
        },
      },
      transactions: [
        {
          id: 99,
          user_id: 10,
          stripe_session_id: 'cs_test_demo_99',
          stripe_payment_intent_id: 'pi_demo_99',
          plan_tier: 'pro',
          plan_name: 'Pro',
          billing_cycle: 'annual',
          amount_usd: 192,
          currency: 'usd',
          status: 'succeeded',
          payment_mode: 'stripe_demo',
          card_brand: 'visa',
          card_last4: '4242',
          created_at: '2026-10-26T00:00:00Z',
          paid_at: '2026-10-26T00:01:00Z',
        },
      ],
    });

    const cancelSpy = vi.spyOn(api, 'cancelSubscription').mockResolvedValue({
      message: 'Auto-renewal canceled.',
      subscription: {
        plan_tier: 'pro',
        plan_name: 'Pro',
        billing_cycle: 'annual',
        subscription_status: 'active',
        cancel_at_period_end: true,
        current_period_start: '2026-10-26T00:00:00Z',
        current_period_end: '2027-10-26T00:00:00Z',
        quota: createMockUser().quota!,
      },
      user: createMockUser({ plan_tier: 'pro', cancel_at_period_end: true }),
    });

    renderWithAuth(<SettingsPage />, {
      user: createMockUser({ plan_tier: 'pro', billing_cycle: 'annual' }),
      initialEntries: ['/settings'],
    });

    await waitFor(() => {
      expect(screen.getByTestId('settings-transactions-list')).toBeDefined();
    });
    expect(screen.getByTestId('settings-active-tier-badge').textContent).toContain('CITRA PRO');

    // Click Cancel Auto-Renew, then confirm in the confirmation dialog
    fireEvent.click(screen.getByTestId('settings-cancel-sub-btn'));
    fireEvent.click(await screen.findByTestId('confirmation-confirm-btn'));
    await waitFor(() => {
      expect(cancelSpy).toHaveBeenCalledWith(false);
    });
    await waitFor(() => {
      expect(screen.getByTestId('settings-reactivate-sub-btn')).toBeDefined();
    });
  });

  it('UploadPage blocks upload when monthly quota (3/3) is exhausted and opens UpgradeModal; allows valid <5MB PDF upload when quota is available', async () => {
    const uploadSpy = vi.spyOn(api, 'uploadEssay').mockResolvedValue({
      essay_id: 77,
      filename: 'short_paper.pdf',
      num_pages: 4,
      num_citations: 5,
      citations: [],
      summary: { cis_score: null, num_unresolved: 0 },
    });

    // 1. User with exhausted quota (3 used / 3 limit, 0 remaining)
    const exhaustedUser = createMockUser({
      plan_tier: 'basic',
      quota: {
        ...createMockUser().quota!,
        monthly_uploads_used: 3,
        monthly_uploads_limit: 3,
        monthly_uploads_remaining: 0,
      },
    });
    const { container, unmount } = renderWithAuth(<UploadPage />, {
      user: exhaustedUser,
      initialEntries: ['/upload'],
    });

    expect(screen.getByTestId('upload-quota-banner').textContent).toContain('3/3');

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const validSmallPdf = new File([new ArrayBuffer(512 * 1024)], 'short_paper.pdf', {
      type: 'application/pdf',
    });
    fireEvent.change(fileInput, { target: { files: [validSmallPdf] } });

    const uploadBtn = screen.getByRole('button', {
      name: /start verification|bắt đầu kiểm tra|kiểm chứng/i,
    });
    fireEvent.click(uploadBtn);

    expect(uploadSpy).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByTestId('upgrade-modal')).toBeDefined();
    });
    unmount();

    // 2. User with available quota (1 used / 3 limit) uploading valid <5MB PDF succeeds
    const activeUser = createMockUser({
      plan_tier: 'basic',
      quota: {
        ...createMockUser().quota!,
        monthly_uploads_used: 1,
        monthly_uploads_limit: 3,
        monthly_uploads_remaining: 2,
      },
    });
    const { container: container2 } = renderWithAuth(<UploadPage />, {
      user: activeUser,
      initialEntries: ['/upload'],
    });
    const fileInput2 = container2.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput2, { target: { files: [validSmallPdf] } });
    fireEvent.click(
      screen.getByRole('button', {
        name: /start verification|bắt đầu kiểm tra|kiểm chứng/i,
      }),
    );

    await waitFor(() => {
      expect(uploadSpy).toHaveBeenCalledTimes(1);
    });
  });

  it('UpgradeModal supports toggling Monthly ($20 / $200) vs Annual ($16 / $160) pricing and initiating Stripe checkout directly from the modal', async () => {
    const createSessionSpy = vi.spyOn(api, 'createCheckoutSession').mockResolvedValue({
      session_id: 'cs_test_demo_ultra_mo',
      checkout_url: '/billing/checkout?session_id=cs_test_demo_ultra_mo',
      mode: 'stripe_demo',
      plan_tier: 'ultra',
      plan_name: 'Ultra',
      billing_cycle: 'monthly',
      amount_usd: 200,
      transaction_id: 2,
    });

    renderWithAuth(
      <Routes>
        <Route
          path="/"
          element={
            <UpgradeModal
              open={true}
              onOpenChange={vi.fn()}
              featureName="Document Inspector"
              reasonTitle="Unlock Document Inspector"
            />
          }
        />
        <Route path="/billing/checkout" element={<div data-testid="modal-checkout-dest">Checkout</div>} />
      </Routes>,
      { user: createMockUser(), initialEntries: ['/'] },
    );

    expect(screen.getByTestId('upgrade-modal')).toBeDefined();
    expect(screen.getByTestId('modal-upgrade-pro-btn').textContent).toContain('192');

    // Switch to Monthly cycle inside modal -> Pro button shows $20, Ultra button shows $200
    fireEvent.click(screen.getByTestId('modal-cycle-monthly'));
    expect(screen.getByTestId('modal-upgrade-pro-btn').textContent).toContain('20');
    expect(screen.getByTestId('modal-upgrade-ultra-btn').textContent).toContain('200');

    // Click Upgrade to Ultra inside modal
    fireEvent.click(screen.getByTestId('modal-upgrade-ultra-btn'));

    await waitFor(() => {
      expect(createSessionSpy).toHaveBeenCalledWith({
        plan_tier: 'ultra',
        billing_cycle: 'monthly',
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('modal-checkout-dest')).toBeDefined();
    });
  });

  it('UpgradeModal overrides DialogContent grid/padding defaults so the body scrolls cleanly without clipping CTA buttons and closes via Close button', () => {
    const onOpenChange = vi.fn();
    renderWithAuth(
      <UpgradeModal
        open={true}
        onOpenChange={onOpenChange}
        featureName="Elevated Upload Quota & Page Limit"
        reasonTitle="Plan Quota or Limit Reached"
        reasonDescription="PDF page limit exceeded (20 pages uploaded; maximum allowed on the Basic plan is 15 pages). Please upgrade to Pro or Ultra."
      />,
      { user: createMockUser({ plan_tier: 'basic' }), initialEntries: ['/upload'] },
    );

    const dialog = screen.getByTestId('upgrade-modal');
    const tokens = dialog.className.split(/\s+/);

    // tailwind-merge output on DialogContent must NOT retain grid, sm:p-6, or gap-4,
    // which otherwise cause the body to overflow max-h-[90dvh] and get clipped by overflow-hidden
    expect(tokens).toContain('flex');
    expect(tokens).toContain('flex-col');
    expect(tokens).not.toContain('grid');
    expect(tokens).not.toContain('sm:p-6');
    expect(tokens).not.toContain('gap-4');

    const scrollableBody = screen.getByTestId('upgrade-modal-body');
    const bodyTokens = scrollableBody.className.split(/\s+/);
    expect(bodyTokens).toContain('flex-1');
    expect(bodyTokens).toContain('min-h-0');
    expect(bodyTokens).toContain('overflow-y-auto');
    expect(bodyTokens).not.toContain('max-h-[80vh]');

    const closeBtn = screen.getByRole('button', { name: /close/i });
    fireEvent.click(closeBtn);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('SolvaScrollReveal reveals elements when a non-bubbling scroll event fires on an inner overflow container like AppLayout#main-content', async () => {
    const origInnerHeight = window.innerHeight;
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      writable: true,
      value: 800,
    });

    let simulatedTop = 760; // > 800 * 0.91 (728), so initially 'below' (opacity 0.001)

    try {
      render(
        <div data-testid="scroll-shell" style={{ overflowY: 'auto' }}>
          <SolvaScrollReveal triggerRatio={0.91}>
            <div data-testid="reveal-target">Plan Card</div>
          </SolvaScrollReveal>
        </div>,
      );

      const target = screen.getByTestId('reveal-target');
      const wrapper = target.parentElement as HTMLElement;
      vi.spyOn(wrapper, 'getBoundingClientRect').mockImplementation(
        () =>
          ({
            top: simulatedTop,
            bottom: simulatedTop + 420,
            left: 0,
            right: 360,
            width: 360,
            height: 420,
            x: 0,
            y: simulatedTop,
            toJSON: () => ({}),
          }) as DOMRect,
      );

      // Flush initial RAF check while simulatedTop = 760 (> 728)
      await new Promise((r) => setTimeout(r, 40));
      expect(wrapper.style.opacity).toBe('0.001');

      // User scrolls halfway down inside AppLayout's overflow-y-auto <main>:
      // element scroll events do NOT bubble in browsers (bubbles: false)!
      simulatedTop = 380;
      const scrollShell = screen.getByTestId('scroll-shell');
      scrollShell.dispatchEvent(new Event('scroll', { bubbles: false }));

      await waitFor(() => {
        expect(wrapper.style.opacity).toBe('1');
      });
    } finally {
      Object.defineProperty(window, 'innerHeight', {
        configurable: true,
        writable: true,
        value: origInnerHeight,
      });
    }
  });

  it('AppLayout renders Sidebar Quota Meter (used/limit), Plan Badge (BASIC / PRO), and Upgrade CTA link to /pricing', async () => {
    const { unmount } = renderWithAuth(
      <AppLayout>
        <div>Dashboard Content</div>
      </AppLayout>,
      { user: createMockUser({ plan_tier: 'basic' }), initialEntries: ['/dashboard'] },
    );

    expect(screen.getByTestId('sidebar-quota-card')).toBeDefined();
    expect(screen.getByTestId('sidebar-plan-badge').textContent).toBe('BASIC');
    expect(screen.getByTestId('sidebar-quota-text').textContent).toBe('2 / 3');
    expect(screen.getByTestId('sidebar-upgrade-link')).toBeDefined();
    unmount();

    // Render as Pro user -> badge is PRO, quota is 2 / 50
    const proUser = createMockUser({
      plan_tier: 'pro',
      quota: {
        ...createMockUser().quota!,
        monthly_uploads_used: 2,
        monthly_uploads_limit: 50,
        monthly_uploads_remaining: 48,
      },
    });
    renderWithAuth(
      <AppLayout>
        <div>Dashboard Content</div>
      </AppLayout>,
      { user: proUser, initialEntries: ['/dashboard'] },
    );

    expect(screen.getByTestId('sidebar-plan-badge').textContent).toBe('PRO');
    expect(screen.getByTestId('sidebar-quota-text').textContent).toBe('2 / 50');
  });

  it('ProcessingPage renders clean step telemetry and omits federated source retrieval tiles', async () => {
    vi.spyOn(api, 'getEssayStatus').mockResolvedValue({
      status: 'processing',
      step: 'comparing',
      step_index: 5,
      total_steps: 8,
      message: 'Compared 42 source hits across 5 databases (ACL FTS5: 35 · OpenAlex: 3 · Seminal: 2 · arXiv: 1 · DBLP: 1)',
      citations_found: 85,
      references_found: 40,
      linked: 85,
      sources_queried: {
        local_db: 'ok',
        openalex: 'ok',
        known_papers: 'ok',
        arxiv: 'ok',
        dblp: 'ok',
      },
      elapsed_seconds: 12.4,
      finished_at: null,
      error: null,
    });

    renderWithAuth(
      <Routes>
        <Route path="/verification/processing/:id" element={<ProcessingPage />} />
      </Routes>,
      {
        user: createMockUser({ plan_tier: 'ultra', role: 'user' }),
        initialEntries: ['/verification/processing/25'],
      },
    );

    await waitFor(() => {
      expect(
        screen.getByText(/Compared 42 source hits across 5 databases/i),
      ).toBeDefined();
    });

    expect(screen.getByText('15+ Libraries')).toBeDefined();
    expect(screen.getByText('30 Checks')).toBeDefined();
    expect(screen.queryByTestId('federated-source-retrieval-card')).toBeNull();
    expect(screen.queryByText('Local ACL FTS5 (128K+)')).toBeNull();
    expect(screen.queryByText('Seminal Whitelist')).toBeNull();
    expect(document.body.textContent).not.toContain('интерактив');
  });

  it('UploadPage omits internal pipeline summary text and 3-step architecture cards for all roles', async () => {
    vi.spyOn(api, 'listEnrolledClasses').mockResolvedValue([]);

    renderWithAuth(<UploadPage />, {
      user: createMockUser({ plan_tier: 'pro', role: 'teacher' }),
    });

    expect(screen.queryByText(/Pipeline:\s*(PDF\/DOCX|Bóc tách PDF\/DOCX)/i)).toBeNull();
    expect(screen.queryByText(/STEP 01/i)).toBeNull();
    expect(screen.queryByText(/STEP 02/i)).toBeNull();
    expect(screen.queryByText(/STEP 03/i)).toBeNull();
  });

  it('SandboxPage LiveCitationSandbox samples random ACL papers, injects defense suite, edits metadata, and generates full PDF manuscript', async () => {
    vi.spyOn(api, 'listEnrolledClasses').mockResolvedValue([]);
    const sampleSpy = vi.spyOn(api, 'sampleSandboxAclPapers').mockResolvedValue({
      count: 2,
      style: 'apa',
      database_total_papers: 128626,
      items: [
        {
          index: 1,
          paper_id: 101,
          title: 'Attention Is All You Need',
          authors: ['Ashish Vaswani', 'Noam Shazeer'],
          authors_text: 'Ashish Vaswani; Noam Shazeer',
          year: '2017',
          venue: 'NeurIPS',
          doi: '10.48550/arXiv.1706.03762',
          cite_in_text: true,
          include_in_references: true,
          in_text_year_override: '',
          in_text_context: 'Transformer architectures dispense with recurrence',
          mutation_preset: 'clean',
          original: {
            title: 'Attention Is All You Need',
            authors_text: 'Ashish Vaswani; Noam Shazeer',
            year: '2017',
            venue: 'NeurIPS',
            doi: '10.48550/arXiv.1706.03762',
          },
        },
        {
          index: 2,
          paper_id: 102,
          title: 'BERT Pre-training of Deep Bidirectional Transformers',
          authors: ['Jacob Devlin', 'Ming-Wei Chang'],
          authors_text: 'Jacob Devlin; Ming-Wei Chang',
          year: '2019',
          venue: 'NAACL',
          doi: '10.18653/v1/N19-1423',
          cite_in_text: true,
          include_in_references: true,
          in_text_year_override: '',
          in_text_context: 'Bidirectional pretraining improves language understanding',
          mutation_preset: 'clean',
          original: {
            title: 'BERT Pre-training of Deep Bidirectional Transformers',
            authors_text: 'Jacob Devlin; Ming-Wei Chang',
            year: '2019',
            venue: 'NAACL',
            doi: '10.18653/v1/N19-1423',
          },
        },
      ],
    });
    const genPdfSpy = vi.spyOn(api, 'generateSandboxPdfManuscript').mockResolvedValue({
      essay_id: 77,
      filename: 'CITRA_ACL_Sandbox_APA_2refs.pdf',
      num_pages: 2,
      in_text_count: 2,
      references_count: 2,
      in_text_markers_preview: ['(Vaswani & Shazeer, 2017)', '(Devlin & Chang, 2022)'],
      references_preview: [],
      pdf_base64: 'JVBERi0xLjQK',
      status: 'processing',
    });

    renderWithAuth(
      <Routes>
        <Route path="/upload" element={<UploadPage />} />
        <Route path="/sandbox" element={<SandboxPage />} />
        <Route path="/verification/processing/:id" element={<div>Processing #77</div>} />
      </Routes>,
      {
        user: createMockUser({ plan_tier: 'ultra', role: 'user' }),
        initialEntries: ['/upload'],
      },
    );

    // Navigate from UploadPage to dedicated SandboxPage
    const openSandboxLink = screen.getByTestId('upload-open-sandbox-link');
    fireEvent.click(openSandboxLink);

    expect(screen.getByTestId('sandbox-page')).toBeDefined();
    const sampleBtn = screen.getByTestId('sandbox-random-acl-btn');
    fireEvent.click(sampleBtn);

    await waitFor(() => {
      expect(sampleSpy).toHaveBeenCalled();
      expect(screen.getByTestId('sandbox-item-title-0')).toBeDefined();
    });

    // Click auto-inject defense suite
    fireEvent.click(screen.getByTestId('sandbox-auto-inject-suite-btn'));
    expect((screen.getByTestId('sandbox-item-year-1') as HTMLInputElement).value).toBe('2022');

    // Generate full PDF and verify
    fireEvent.click(screen.getByTestId('sandbox-generate-verify-pdf-btn'));
    await waitFor(() => {
      expect(genPdfSpy).toHaveBeenCalled();
      expect(screen.getByText('Processing #77')).toBeDefined();
    });
  });

  it('EssayPage suppresses Revision Progress Tracker for CITRA_ACL_Sandbox reports and unrelated manuscripts, and shows it only for same-family revisions', async () => {
    const baseReport = {
      essay_id: 29,
      filename: 'CITRA_ACL_Sandbox_APA_10refs.pdf',
      num_pages: 2,
      num_citations: 10,
      num_references: 10,
      extracted_citations: [],
      essay: {
        id: 29,
        filename: 'CITRA_ACL_Sandbox_APA_10refs.pdf',
        num_pages: 2,
        uploaded_at: '2026-10-30T03:00:00Z',
      },
      style_profile: { style: 'apa-like', confidence: 0.95 },
      linking_summary: { total_in_text: 10, matched: 10, unmatched_in_text: 0, uncited_references: 0 },
      verdicts: [],
      references: [],
      cis: { score: 87.5, grade: 'B', total_academic: 10, verified: 8 },
      revision_diff: {
        has_previous_revision: true,
        is_same_manuscript_family: false,
        previous_essay_id: 28,
        previous_filename: 'VietDepression_Springer_KAIS.pdf',
        current_essay_id: 29,
        current_filename: 'CITRA_ACL_Sandbox_APA_10refs.pdf',
        cis_before: 100.0,
        cis_after: 87.5,
        cis_delta: -12.5,
      },
      disclaimer: '',
      generated_at: '2026-10-30T03:00:00Z',
    };

    const getReportSpy = vi.spyOn(api, 'getEssay').mockResolvedValue(baseReport as never);

    const { unmount } = renderWithAuth(
      <Routes>
        <Route path="/verification/report/:id" element={<EssayPage />} />
      </Routes>,
      {
        user: createMockUser({ plan_tier: 'ultra', role: 'user' }),
        initialEntries: ['/verification/report/29'],
      },
    );

    await waitFor(() => {
      expect(getReportSpy).toHaveBeenCalledWith(29, expect.anything());
      expect(screen.getAllByText('CITRA_ACL_Sandbox_APA_10refs.pdf').length).toBeGreaterThan(0);
    });

    // Must NOT show revision diff banner comparing Sandbox against #28 VietDepression_Springer_KAIS.pdf
    expect(screen.queryByTestId('revision-diff-banner')).toBeNull();
    expect(document.body.textContent).not.toContain('VietDepression_Springer_KAIS.pdf');
    unmount();

    // Now render a true v2 revision of the same manuscript family -> banner SHOULD appear
    getReportSpy.mockResolvedValueOnce({
      ...baseReport,
      essay_id: 31,
      filename: 'VietDepression_Springer_KAIS_v2_fixed.pdf',
      essay: {
        id: 31,
        filename: 'VietDepression_Springer_KAIS_v2_fixed.pdf',
        num_pages: 12,
        uploaded_at: '2026-10-30T03:10:00Z',
      },
      revision_diff: {
        has_previous_revision: true,
        is_same_manuscript_family: true,
        previous_essay_id: 28,
        previous_filename: 'VietDepression_Springer_KAIS.pdf',
        current_essay_id: 31,
        current_filename: 'VietDepression_Springer_KAIS_v2_fixed.pdf',
        cis_before: 85.0,
        cis_after: 100.0,
        cis_delta: 15.0,
        resolved_issues_count: 2,
      },
    } as never);

    renderWithAuth(
      <Routes>
        <Route path="/verification/report/:id" element={<EssayPage />} />
      </Routes>,
      {
        user: createMockUser({ plan_tier: 'ultra', role: 'user' }),
        initialEntries: ['/verification/report/31'],
      },
    );

    await waitFor(() => {
      expect(screen.getByTestId('revision-diff-banner')).toBeDefined();
    });
    expect(screen.getByTestId('revision-diff-banner').textContent).toContain(
      '#28 — VietDepression_Springer_KAIS.pdf',
    );
  });

  it('PromoManagementPage lists 6-char promo codes, generates/creates a new 6-char code, toggles status, and deletes', async () => {
    const initialPromos = [
      {
        id: 1,
        code: 'CITRA2',
        description: 'CITRA Launch Offer — 20% off',
        discount_type: 'percent' as const,
        discount_value: 20,
        max_discount_usd: 100,
        min_amount_usd: 0,
        applicable_tiers: 'all' as const,
        applicable_cycles: 'all' as const,
        max_uses: 500,
        used_count: 14,
        max_uses_per_user: 1,
        expires_at: null,
        is_active: true,
        is_expired: false,
        is_exhausted: false,
        effective_status: 'active' as const,
        created_by: 1,
        created_at: '2026-11-01T00:00:00Z',
        updated_at: '2026-11-01T00:00:00Z',
      },
    ];

    vi.spyOn(api, 'listAdminPromoCodes').mockResolvedValue({
      stats: {
        total_codes: 1,
        active_codes: 1,
        total_redemptions: 14,
        total_discount_usd: 268.8,
      },
      promos: initialPromos,
    });
    const genSpy = vi.spyOn(api, 'generateAdminPromoCode').mockResolvedValue({
      code: 'BIGT50',
    });
    const createSpy = vi.spyOn(api, 'createAdminPromoCode').mockResolvedValue({
      id: 2,
      code: 'BIGT50',
      description: 'BigTech 50% Promo',
      discount_type: 'percent',
      discount_value: 50,
      max_discount_usd: 120,
      min_amount_usd: 15,
      applicable_tiers: 'all',
      applicable_cycles: 'all',
      max_uses: 100,
      used_count: 0,
      max_uses_per_user: 1,
      expires_at: null,
      is_active: true,
      is_expired: false,
      is_exhausted: false,
      effective_status: 'active',
      created_by: 1,
      created_at: '2026-11-01T01:00:00Z',
      updated_at: '2026-11-01T01:00:00Z',
    });
    const toggleSpy = vi.spyOn(api, 'updateAdminPromoCode').mockResolvedValue({
      ...initialPromos[0],
      is_active: false,
      effective_status: 'inactive',
    });
    const deleteSpy = vi.spyOn(api, 'deleteAdminPromoCode').mockResolvedValue({
      message: "Promo code 'CITRA2' deleted.",
      deleted_id: 1,
      code: 'CITRA2',
    });

    renderWithAuth(<PromoManagementPage />, {
      user: createMockUser({ role: 'admin', plan_tier: 'ultra' }),
      initialEntries: ['/admin/promos'],
    });

    await waitFor(() => {
      expect(screen.getByTestId('promo-row-CITRA2')).toBeDefined();
    });

    // Open Create Promo Modal
    fireEvent.click(screen.getByTestId('create-promo-btn'));
    expect(screen.getByTestId('promo-form-modal')).toBeDefined();

    // Auto-generate 6-char code
    fireEvent.click(screen.getByTestId('promo-generate-btn'));
    await waitFor(() => {
      expect(genSpy).toHaveBeenCalled();
      expect((screen.getByTestId('promo-code-input') as HTMLInputElement).value).toBe('BIGT50');
    });

    fireEvent.change(screen.getByTestId('promo-description-input'), {
      target: { value: 'BigTech 50% Promo' },
    });
    fireEvent.change(screen.getByTestId('promo-discount-value-input'), {
      target: { value: '50' },
    });
    fireEvent.click(screen.getByTestId('promo-submit-btn'));

    await waitFor(() => {
      expect(createSpy).toHaveBeenCalled();
      expect(screen.getByTestId('promo-row-BIGT50')).toBeDefined();
    });

    // Toggle active status on CITRA2
    fireEvent.click(screen.getByTestId('promo-toggle-CITRA2'));
    await waitFor(() => {
      expect(toggleSpy).toHaveBeenCalledWith(1, { is_active: false });
    });

    // Delete CITRA2
    fireEvent.click(screen.getByTestId('promo-delete-CITRA2'));
    expect(screen.getByTestId('promo-delete-modal')).toBeDefined();
    fireEvent.click(screen.getByTestId('promo-confirm-delete-btn'));

    await waitFor(() => {
      expect(deleteSpy).toHaveBeenCalledWith(1);
      expect(screen.queryByTestId('promo-row-CITRA2')).toBeNull();
    });
  });

  it('StripeDemoCheckoutPage supports VNPay v2.1.0 Payment Gateway (NCB ATM test cards 51/00, VNPAY-QR, and signed URL inspector)', async () => {
    vi.spyOn(api, 'getCheckoutSessionDetails').mockResolvedValue({
      session_id: 'cs_test_demo_vnpay99',
      status: 'pending',
      payment_mode: 'stripe_demo',
      merchant_name: 'CITRA (SourceLogic) Inc.',
      customer_email: 'student@tdtu.edu.vn',
      customer_name: 'Nguyen Van A',
      plan_tier: 'pro',
      plan_name: 'CITRA Pro',
      billing_cycle: 'monthly',
      amount_usd: 20,
      amount_vnd: 500000,
      usd_to_vnd_rate: 25000,
      monthly_equivalent_usd: 20,
      annual_savings_usd: 0,
      currency: 'usd',
      features_en: ['50 PDF checks / month'],
      features_vi: ['50 lượt tải PDF / tháng'],
    });

    const createUrlSpy = vi.spyOn(api, 'createVNPayPaymentUrl').mockResolvedValue({
      session_id: 'cs_test_demo_vnpay99',
      payment_url:
        'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html?vnp_Amount=50000000&vnp_BankCode=NCB&vnp_TxnRef=CITRA99VNP&vnp_SecureHash=' +
        'a'.repeat(128),
      vnp_txn_ref: 'CITRA99VNP',
      vnp_amount: 50000000,
      amount_vnd: 500000,
      amount_usd: 20,
      usd_to_vnd_rate: 25000,
      bank_code: 'NCB',
      tmn_code: 'CITRAVNP',
      create_date: '20261102073000',
      expire_date: '20261102074500',
      order_info: 'Thanh toan goi CITRA Pro monthly Ref CITRA99VNP',
      external_redirect: false,
      vnp_params: {
        vnp_Amount: '50000000',
        vnp_BankCode: 'NCB',
        vnp_TxnRef: 'CITRA99VNP',
        vnp_SecureHash: 'a'.repeat(128),
      },
      supported_banks: [],
      sandbox_test_cards: [],
    });

    const authorizeSpy = vi
      .spyOn(api, 'authorizeVNPaySandbox')
      .mockImplementation(async (payload) => {
        if (payload.card_number === '9704195798621412') {
          return {
            status: 'failed',
            is_verified: true,
            is_success: false,
            vnp_response_code: '51',
            message_vi: 'Tài khoản của quý khách không đủ số dư để thực hiện giao dịch.',
            message_en: 'Insufficient account balance to complete the transaction.',
            vnp_txn_ref: 'CITRA99VNP',
            vnp_transaction_no: '14999999',
            vnp_bank_code: 'NCB',
            vnp_card_type: 'ATM',
            amount_vnd: 500000,
            vnp_params: {} as Record<string, string>,
            return_url: '/billing/checkout?session_id=cs_test_demo_vnpay99',
            transaction: {
              id: 99,
              user_id: 10,
              stripe_session_id: 'cs_test_demo_vnpay99',
              stripe_payment_intent_id: null,
              plan_tier: 'pro',
              plan_name: 'Pro',
              billing_cycle: 'monthly',
              amount_usd: 20,
              amount_vnd: 500000,
              currency: 'usd',
              status: 'pending',
              payment_mode: 'stripe_demo',
              card_brand: 'ncb',
              card_last4: '1412',
              created_at: null,
              paid_at: null,
            },
          };
        }
        return {
          status: 'succeeded',
          is_verified: true,
          is_success: true,
          vnp_response_code: '00',
          message_vi: 'Giao dịch thành công',
          message_en: 'Transaction successful',
          vnp_txn_ref: 'CITRA99VNP',
          vnp_transaction_no: '14888888',
          vnp_bank_code: 'NCB',
          vnp_card_type: 'ATM',
          amount_vnd: 500000,
          vnp_params: {
            vnp_Amount: '50000000',
            vnp_BankCode: 'NCB',
            vnp_ResponseCode: '00',
            vnp_TransactionNo: '14888888',
            vnp_TxnRef: 'CITRA99VNP',
            vnp_SecureHash: 'b'.repeat(128),
          },
          return_url: '/billing/success?session_id=cs_test_demo_vnpay99&vnp_ResponseCode=00',
          transaction: {
            id: 99,
            user_id: 10,
            stripe_session_id: 'cs_test_demo_vnpay99',
            stripe_payment_intent_id: 'vnp_14888888',
            plan_tier: 'pro',
            plan_name: 'Pro',
            billing_cycle: 'monthly',
            amount_usd: 20,
            amount_vnd: 500000,
            currency: 'usd',
            status: 'succeeded',
            payment_mode: 'vnpay_sandbox',
            payment_method: 'vnpay',
            card_brand: 'ncb',
            card_last4: '2198',
            vnp_txn_ref: 'CITRA99VNP',
            vnp_transaction_no: '14888888',
            vnp_bank_code: 'NCB',
            vnp_card_type: 'ATM',
            vnp_response_code: '00',
            created_at: null,
            paid_at: '2026-11-02T07:31:00Z',
          },
        };
      });

    renderWithAuth(
      <Routes>
        <Route path="/billing/checkout" element={<StripeDemoCheckoutPage />} />
        <Route path="/billing/success" element={<div data-testid="vnpay-success-dest">VNPay Success</div>} />
      </Routes>,
      {
        user: createMockUser(),
        initialEntries: ['/billing/checkout?session_id=cs_test_demo_vnpay99'],
      },
    );

    await waitFor(() => {
      expect(screen.getByTestId('stripe-demo-checkout-page')).toBeDefined();
    });
    expect(screen.getByTestId('checkout-vnd-amount-display').textContent).toContain('500.000 ₫');

    // Switch to VNPay tab
    fireEvent.click(screen.getByTestId('method-tab-vnpay'));
    expect(screen.getByTestId('vnpay-tab-panel')).toBeDefined();
    expect(screen.getByTestId('vnpay-panel-amount-vnd').textContent).toContain('500.000 ₫');

    // Launch VNPay Gateway Modal
    fireEvent.click(screen.getByTestId('vnpay-launch-gateway-btn'));
    await waitFor(() => {
      expect(createUrlSpy).toHaveBeenCalled();
      expect(screen.getByTestId('vnpay-gateway-modal')).toBeDefined();
    });
    expect(screen.getByTestId('vnpay-modal-txn-ref').textContent).toBe('CITRA99VNP');

    // Inspect signed URL
    fireEvent.click(screen.getByTestId('vnpay-toggle-signed-url-btn'));
    expect(screen.getByTestId('vnpay-signed-url-box').textContent).toContain(
      'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html',
    );

    // 1. Test NCB Insufficient Funds scenario (code 51) -> displays error inside modal
    fireEvent.click(screen.getByTestId('vnpay-testcard-51'));
    fireEvent.click(screen.getByTestId('vnpay-confirm-pay-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('vnpay-modal-error').textContent).toContain('51');
    });

    // 2. Switch back to Official NCB Success card (9704198526191432198 + OTP 123456) -> succeeds
    fireEvent.click(screen.getByTestId('vnpay-testcard-00'));
    fireEvent.click(screen.getByTestId('vnpay-confirm-pay-btn'));
    await waitFor(() => {
      expect(authorizeSpy).toHaveBeenCalledTimes(2);
      expect(screen.getByTestId('vnpay-success-dest')).toBeDefined();
    });
  });

  it('BillingSuccessPage verifies signed VNPay ReturnURL parameters and displays VND receipt details', async () => {
    const verifyVnpSpy = vi.spyOn(api, 'verifyVNPayReturn').mockResolvedValue({
      status: 'succeeded',
      is_verified: true,
      is_success: true,
      vnp_response_code: '00',
      message: 'Upgraded via VNPay!',
      message_vi: 'Giao dịch thành công',
      message_en: 'Transaction successful',
      transaction: {
        id: 100,
        user_id: 10,
        stripe_session_id: 'cs_test_demo_vnpay100',
        stripe_payment_intent_id: 'vnp_14777777',
        plan_tier: 'pro',
        plan_name: 'Pro',
        billing_cycle: 'annual',
        amount_usd: 192,
        amount_vnd: 4800000,
        usd_to_vnd_rate: 25000,
        currency: 'usd',
        status: 'succeeded',
        payment_mode: 'vnpay_sandbox',
        payment_method: 'vnpay',
        card_brand: 'ncb',
        card_last4: '2198',
        vnp_txn_ref: 'CITRA100VNP',
        vnp_transaction_no: '14777777',
        vnp_bank_code: 'NCB',
        vnp_card_type: 'ATM',
        vnp_response_code: '00',
        created_at: '2026-11-02T07:30:00Z',
        paid_at: '2026-11-02T07:31:00Z',
      },
      subscription: {
        plan_tier: 'pro',
        plan_name: 'Pro',
        billing_cycle: 'annual',
        subscription_status: 'active',
        cancel_at_period_end: false,
        current_period_start: '2026-11-02T00:00:00Z',
        current_period_end: '2027-11-02T00:00:00Z',
        quota: {
          ...createMockUser().quota!,
          monthly_uploads_limit: 50,
          max_file_size_mb: 25,
          max_pages_per_pdf: 100,
        },
      },
      user: createMockUser({ plan_tier: 'pro', billing_cycle: 'annual' }),
    });

    renderWithAuth(
      <Routes>
        <Route path="/billing/success" element={<BillingSuccessPage />} />
      </Routes>,
      {
        user: createMockUser({ plan_tier: 'pro' }),
        initialEntries: [
          `/billing/success?session_id=cs_test_demo_vnpay100&vnp_Amount=480000000&vnp_BankCode=NCB&vnp_ResponseCode=00&vnp_TxnRef=CITRA100VNP&vnp_SecureHash=${'c'.repeat(128)}`,
        ],
      },
    );

    await waitFor(() => {
      expect(verifyVnpSpy).toHaveBeenCalled();
      expect(screen.getByTestId('billing-success-page')).toBeDefined();
    });
    expect(screen.getByTestId('receipt-amount-paid').textContent).toContain('4.800.000 ₫ VND');
    expect(screen.getByTestId('receipt-payment-method').textContent).toContain('VNPAY · NCB •••• 2198');
    expect(screen.getByTestId('receipt-vnp-txn-ref').textContent).toContain('CITRA100VNP');
  });

  it('LandingPage featured Pro card uses high-contrast ink color and medium/semibold weights over floral backdrop like PricingPage', () => {
    const { container } = renderWithAuth(<LandingPage />, {
      user: null,
      initialEntries: ['/'],
    });

    const taxonomySection = container.querySelector('#taxonomy');
    expect(taxonomySection).not.toBeNull();

    const proDesc = screen.getByText(
      /Full 15\+ scholarly API federation, Sentence-BERT semantic matching/i,
    );
    expect(proDesc.getAttribute('style')).toContain('var(--solva-ink)');
    expect(proDesc.className).toContain('font-medium');

    const proIncludes = screen.getByText('Everything in Basic, plus:');
    expect(proIncludes.getAttribute('style')).toContain('var(--solva-ink)');
    expect(proIncludes.className).toContain('font-semibold');

    const proFeatureItem = screen.getByText(
      '50 manuscripts / month (up to 100 pages, 25 MB)',
    );
    expect(proFeatureItem.getAttribute('style')).toContain('var(--solva-ink)');
    expect(proFeatureItem.className).toContain('font-medium');

    const proFeatureCheckIcon = proFeatureItem.parentElement?.querySelector('svg');
    expect(proFeatureCheckIcon?.getAttribute('style')).toContain('var(--solva-ink)');

    // Non-featured Basic card retains muted editorial body styling
    const basicFeatureItem = screen.getByText(
      '3 manuscripts / month (up to 15 pages, 5 MB)',
    );
    expect(basicFeatureItem.getAttribute('style')).toContain('var(--solva-muted)');
  });

  it('BillingSuccessPage blocks unverified access when session_id / vnp_SecureHash are missing (BUG-01)', async () => {
    const getSubSpy = vi.spyOn(api, 'getMySubscription');
    renderWithAuth(
      <Routes>
        <Route path="/billing/success" element={<BillingSuccessPage />} />
      </Routes>,
      {
        user: createMockUser({ plan_tier: 'basic' }),
        initialEntries: ['/billing/success'],
      },
    );

    await waitFor(() => {
      expect(screen.getByTestId('billing-verification-missing')).toBeDefined();
    });
    expect(screen.queryByTestId('billing-success-page')).toBeNull();
    expect(getSubSpy).not.toHaveBeenCalled();
  });

  it('BillingSuccessPage surfaces payment verification errors instead of silently rendering success (BUG-01)', async () => {
    vi.spyOn(api, 'verifyCheckoutSession').mockRejectedValue(
      new Error('Invalid or expired checkout session'),
    );
    renderWithAuth(
      <Routes>
        <Route path="/billing/success" element={<BillingSuccessPage />} />
      </Routes>,
      {
        user: createMockUser({ plan_tier: 'basic' }),
        initialEntries: ['/billing/success?session_id=cs_forged_999'],
      },
    );

    await waitFor(() => {
      expect(screen.getByTestId('billing-verification-error')).toBeDefined();
    });
    expect(screen.getByTestId('billing-verification-error').textContent).toContain(
      'Invalid or expired checkout session',
    );
    expect(screen.queryByTestId('billing-success-page')).toBeNull();
  });

  it('PromoManagementPage form and delete modals expose role="dialog", aria-modal="true", and close on Escape (BUG-05)', async () => {
    vi.spyOn(api, 'listAdminPromoCodes').mockResolvedValue({
      stats: { total_codes: 1, active_codes: 1, total_redemptions: 0, total_discount_usd: 0 },
      promos: [
        {
          id: 1,
          code: 'CITRA2',
          description: 'Launch 20% off',
          discount_type: 'percent',
          discount_value: 20,
          max_discount_usd: 100,
          min_amount_usd: 0,
          applicable_tiers: 'all',
          applicable_cycles: 'all',
          max_uses: 100,
          used_count: 0,
          max_uses_per_user: 1,
          expires_at: null,
          is_active: true,
          is_expired: false,
          is_exhausted: false,
          effective_status: 'active',
          created_by: 1,
          created_at: '2026-11-01T00:00:00Z',
          updated_at: '2026-11-01T00:00:00Z',
        },
      ],
    });

    renderWithAuth(<PromoManagementPage />, {
      user: createMockUser({ role: 'admin', plan_tier: 'ultra' }),
      initialEntries: ['/admin/promos'],
    });

    await waitFor(() => expect(screen.getByTestId('promo-row-CITRA2')).toBeDefined());

    fireEvent.click(screen.getByTestId('create-promo-btn'));
    const formModal = screen.getByTestId('promo-form-modal');
    expect(formModal.querySelector('[role="dialog"][aria-modal="true"]')).not.toBeNull();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('promo-form-modal')).toBeNull());

    fireEvent.click(screen.getByTestId('promo-delete-CITRA2'));
    const deleteModal = screen.getByTestId('promo-delete-modal');
    expect(deleteModal.querySelector('[role="dialog"][aria-modal="true"]')).not.toBeNull();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('promo-delete-modal')).toBeNull());
  });

  it('PricingPage avoids nested <main><main> inside AppLayout and keeps <main> when public (BUG-06)', () => {
    const { container: authContainer, unmount } = renderWithAuth(
      <AppLayout>
        <PricingPage />
      </AppLayout>,
      { user: createMockUser({ plan_tier: 'basic' }), initialEntries: ['/pricing'] },
    );
    expect(authContainer.querySelectorAll('main main').length).toBe(0);
    expect(authContainer.querySelectorAll('main').length).toBe(1);
    unmount();

    const { container: pubContainer } = renderWithAuth(<PricingPage />, {
      user: null,
      initialEntries: ['/pricing'],
    });
    expect(pubContainer.querySelector('main#pricing-main-content')).not.toBeNull();
  });

  it('PricingPage ensures every scholarly link has valid href, live trace links to /#interactive-demo, and Ultra users cannot accidentally downgrade to Pro (BUG-07)', () => {
    const { container } = renderWithAuth(<PricingPage />, {
      user: createMockUser({ plan_tier: 'ultra', billing_cycle: null }),
      initialEntries: ['/pricing'],
    });

    const anchorsWithoutHref = Array.from(container.querySelectorAll('a')).filter(
      (a) => !a.getAttribute('href'),
    );
    expect(anchorsWithoutHref.length).toBe(0);

    const brokenLocalDemoAnchors = Array.from(container.querySelectorAll('a')).filter(
      (a) => a.getAttribute('href') === '#interactive-demo',
    );
    expect(brokenLocalDemoAnchors.length).toBe(0);

    const proBtn = screen.getByTestId('select-pro-btn') as HTMLButtonElement;
    const ultraBtn = screen.getByTestId('select-ultra-btn') as HTMLButtonElement;
    expect(proBtn.disabled).toBe(true);
    expect(proBtn.textContent).toMatch(/Included in Ultra|Đã bao gồm trong gói Ultra/i);
    expect(ultraBtn.disabled).toBe(true);
    expect(ultraBtn.textContent).toMatch(/Current Active Ultra Plan|Đang sử dụng gói Ultra/i);
  });

  it('PricingPage hides evaluator test-card copy (4242, 4444, Stripe Demo) when VITE_DEMO_MODE is unset and renders encrypted Stripe & VNPay copy in EN and VI', async () => {
    try {
      vi.stubEnv('VITE_DEMO_MODE', '');
      await i18n.changeLanguage('en');
      const { container: enContainer, unmount: unmountEn } = renderWithAuth(<PricingPage />, {
        user: null,
        initialEntries: ['/pricing'],
      });
      const enText = enContainer.textContent ?? '';
      expect(enText).not.toContain('4242');
      expect(enText).not.toContain('4444');
      expect(enText.toLowerCase()).not.toContain('test card');
      expect(enText.toLowerCase()).not.toContain('stripe demo');
      expect(enText).toMatch(/PCI-DSS/i);
      expect(enText).toMatch(/TLS 1\.3/i);
      expect(enText).toMatch(/Stripe/i);
      expect(enText).toMatch(/VNPay/i);
      unmountEn();

      await i18n.changeLanguage('vi');
      const { container: viContainer, unmount: unmountVi } = renderWithAuth(<PricingPage />, {
        user: null,
        initialEntries: ['/pricing'],
      });
      const viText = viContainer.textContent ?? '';
      expect(viText).not.toContain('4242');
      expect(viText).not.toContain('4444');
      expect(viText.toLowerCase()).not.toContain('thẻ kiểm thử');
      expect(viText.toLowerCase()).not.toContain('thẻ thử nghiệm');
      expect(viText.toLowerCase()).not.toContain('stripe demo');
      expect(viText).not.toContain('Settings ->');
      expect(viText).toContain('(Cài đặt → Quản lý Gói cước)');
      expect(viText).toMatch(/PCI-DSS/i);
      expect(viText).toMatch(/TLS 1\.3/i);
      expect(viText).toMatch(/Stripe/i);
      expect(viText).toMatch(/VNPay/i);
      unmountVi();
    } finally {
      vi.unstubAllEnvs();
      await i18n.changeLanguage('en');
    }
  });

  it('PricingPage exposes evaluator test-card autofill guidance (4242 / 4444) only when VITE_DEMO_MODE is "true"', async () => {
    try {
      vi.stubEnv('VITE_DEMO_MODE', 'true');

      await i18n.changeLanguage('en');
      const { container: enContainer, unmount: unmountEn } = renderWithAuth(<PricingPage />, {
        user: null,
        initialEntries: ['/pricing'],
      });
      const enText = enContainer.textContent ?? '';
      expect(enText).toContain('4242');
      expect(enText).toContain('4444');
      expect(enText.toLowerCase()).toContain('test card');
      unmountEn();

      await i18n.changeLanguage('vi');
      const { container: viContainer, unmount: unmountVi } = renderWithAuth(<PricingPage />, {
        user: null,
        initialEntries: ['/pricing'],
      });
      const viText = viContainer.textContent ?? '';
      expect(viText).toContain('4242');
      expect(viText).toContain('4444');
      expect(viText.toLowerCase()).toContain('thẻ kiểm thử');
      unmountVi();
    } finally {
      vi.unstubAllEnvs();
      await i18n.changeLanguage('en');
    }
  });

  it('LandingPage and PricingPage footers present unified CITRA brand identity without standalone SourceLogic, while AuthSplitShell frames SourceLogic v{APP_VERSION} as engine version with zero left-panel buttons', async () => {
    try {
      await i18n.changeLanguage('en');
      const { container: landingEn, unmount: unmountLandingEn } = renderWithAuth(<LandingPage />, {
        user: null,
        initialEntries: ['/'],
      });
      const landingFooterEn = landingEn.querySelector('footer')?.textContent ?? '';
      expect(landingFooterEn).toContain('© 2026 CITRA — Academic Citation Integrity Workspace');
      expect(landingFooterEn).not.toContain('SourceLogic');
      expect(landingEn.textContent ?? '').not.toContain('SourceLogic');
      unmountLandingEn();

      const { container: pricingEn, unmount: unmountPricingEn } = renderWithAuth(<PricingPage />, {
        user: null,
        initialEntries: ['/pricing'],
      });
      const pricingFooterEn = pricingEn.querySelector('footer')?.textContent ?? '';
      expect(pricingFooterEn).toContain('© 2026 CITRA — Academic Citation Integrity Workspace');
      expect(pricingFooterEn).not.toContain('SourceLogic');
      expect(pricingEn.textContent ?? '').not.toContain('SourceLogic');
      unmountPricingEn();

      await i18n.changeLanguage('vi');
      const { container: landingVi, unmount: unmountLandingVi } = renderWithAuth(<LandingPage />, {
        user: null,
        initialEntries: ['/'],
      });
      const landingFooterVi = landingVi.querySelector('footer')?.textContent ?? '';
      expect(landingFooterVi).toContain('© 2026 CITRA — Không gian Kiểm chứng Trích dẫn Học thuật');
      expect(landingFooterVi).not.toContain('SourceLogic');
      unmountLandingVi();

      const { container: pricingVi, unmount: unmountPricingVi } = renderWithAuth(<PricingPage />, {
        user: null,
        initialEntries: ['/pricing'],
      });
      const pricingFooterVi = pricingVi.querySelector('footer')?.textContent ?? '';
      expect(pricingFooterVi).toContain('© 2026 CITRA — Không gian Kiểm chứng Trích dẫn Học thuật');
      expect(pricingFooterVi).not.toContain('SourceLogic');
      unmountPricingVi();

      const { container: authContainer, unmount: unmountAuth } = renderWithAuth(
        <AuthSplitShell>
          <div data-testid="auth-form-slot">Form</div>
        </AuthSplitShell>,
        { user: null, initialEntries: ['/login'] },
      );
      expect(authContainer.textContent ?? '').toContain(`CITRA · v${APP_VERSION}`);
      expect(authContainer.textContent ?? '').not.toContain('Engine: SourceLogic');
      expect(authContainer.textContent ?? '').not.toContain('SourceLogic');
      const leftPanel = authContainer.firstElementChild?.firstElementChild as HTMLElement | null;
      expect(leftPanel).not.toBeNull();
      expect(leftPanel?.querySelectorAll('button').length).toBe(0);
      unmountAuth();
    } finally {
      await i18n.changeLanguage('en');
    }
  });

  it('Task 1.3 — separates floral header banner (.solva-floral-banner-mask) from high-contrast .solva-pro-card-surface body on both LandingPage and PricingPage and aligns tier rows via subgrid', async () => {
    await i18n.changeLanguage('en');

    // 1. LandingPage (#taxonomy) Pro card
    const { container: landingContainer, unmount: unmountLanding } = renderWithAuth(
      <LandingPage />,
      { user: null, initialEntries: ['/'] },
    );
    const taxonomySection = landingContainer.querySelector('#taxonomy') as HTMLElement;
    expect(taxonomySection).not.toBeNull();

    const landingFloralBanner = taxonomySection.querySelector('.solva-floral-banner-mask');
    expect(landingFloralBanner).not.toBeNull();
    expect(landingFloralBanner?.querySelector('img[src="/solva/pricing-floral.webp"]')).not.toBeNull();
    expect(taxonomySection.querySelector('.solva-pricing-floral-mask')).toBeNull();

    const landingProSurface = taxonomySection.querySelector('.solva-pro-card-surface') as HTMLElement;
    expect(landingProSurface).not.toBeNull();
    expect(landingProSurface.contains(screen.getByTestId('landing-price-pro'))).toBe(true);
    expect(
      landingProSurface.textContent,
    ).toMatch(/Full 15\+ scholarly API federation, Sentence-BERT semantic matching/i);
    expect(landingProSurface.textContent).toContain('50 manuscripts / month (up to 100 pages, 25 MB)');
    expect(landingFloralBanner?.contains(landingProSurface)).toBe(false);

    // Subgrid alignment on Desktop 3-column grid
    expect(taxonomySection.querySelectorAll('[class*="lg:grid-rows-subgrid"]').length).toBeGreaterThanOrEqual(3);
    unmountLanding();

    // 2. PricingPage plan-card-pro (authenticated -> xl: subgrid; public -> lg: subgrid)
    const { unmount: unmountAuthPricing } = renderWithAuth(<PricingPage />, {
      user: createMockUser(),
      initialEntries: ['/pricing'],
    });
    const proCard = screen.getByTestId('plan-card-pro');
    const pricingFloralBanner = proCard.querySelector('.solva-floral-banner-mask');
    expect(pricingFloralBanner).not.toBeNull();
    expect(pricingFloralBanner?.querySelector('img[src="/solva/pricing-floral.webp"]')).not.toBeNull();
    expect(proCard.querySelector('.solva-pricing-floral-mask')).toBeNull();

    const pricingProSurface = proCard.querySelector('.solva-pro-card-surface') as HTMLElement;
    expect(pricingProSurface).not.toBeNull();
    expect(pricingProSurface.contains(screen.getByTestId('pro-price-display'))).toBe(true);
    expect(pricingProSurface.contains(screen.getByTestId('select-pro-btn'))).toBe(true);
    expect(pricingProSurface.textContent).toMatch(
      /Comprehensive citation verification across 15\+ scholarly indexes/i,
    );
    expect(pricingFloralBanner?.contains(pricingProSurface)).toBe(false);

    for (const cardId of ['plan-card-basic', 'plan-card-pro', 'plan-card-ultra']) {
      expect(screen.getByTestId(cardId).className).toContain('xl:grid-rows-subgrid');
      expect(screen.getByTestId(cardId).className).not.toContain('lg:grid-rows-subgrid');
    }
    unmountAuthPricing();

    const { unmount: unmountPublicPricing } = renderWithAuth(<PricingPage />, {
      user: null,
      initialEntries: ['/pricing'],
    });
    for (const cardId of ['plan-card-basic', 'plan-card-pro', 'plan-card-ultra']) {
      expect(screen.getByTestId(cardId).className).toContain('lg:grid-rows-subgrid');
    }
    unmountPublicPricing();
  });

  it('Task 1.3 — enforces whitespace-nowrap shrink-0 on Save $48/yr and Save $480/yr badges in EN and VI so pills never split onto 2 lines', async () => {
    try {
      await i18n.changeLanguage('en');
      const { unmount: unmountEn } = renderWithAuth(<PricingPage />, {
        user: null,
        initialEntries: ['/pricing'],
      });

      const save48En = screen.getByText('Save $48/yr');
      const save480En = screen.getByText('Save $480/yr');
      expect(save48En.className).toContain('whitespace-nowrap');
      expect(save48En.className).toContain('shrink-0');
      expect(save480En.className).toContain('whitespace-nowrap');
      expect(save480En.className).toContain('shrink-0');
      unmountEn();

      await i18n.changeLanguage('vi');
      const { unmount: unmountVi } = renderWithAuth(<PricingPage />, {
        user: null,
        initialEntries: ['/pricing'],
      });

      const save48Vi = screen.getByText('Tiết kiệm $48/năm');
      const save480Vi = screen.getByText('Tiết kiệm $480/năm');
      expect(save48Vi.className).toContain('whitespace-nowrap');
      expect(save48Vi.className).toContain('shrink-0');
      expect(save480Vi.className).toContain('whitespace-nowrap');
      expect(save480Vi.className).toContain('shrink-0');
      unmountVi();
    } finally {
      await i18n.changeLanguage('en');
    }
  });

  it('Task 1.3 — removes misleading "Start Pro trial" CTA on LandingPage and replaces punitive "No PDF..." Basic lines with constructive framing', async () => {
    try {
      await i18n.changeLanguage('en');
      const { container: landingEn, unmount: unmountLandingEn } = renderWithAuth(<LandingPage />, {
        user: null,
        initialEntries: ['/'],
      });
      const taxonomyEn = landingEn.querySelector('#taxonomy') as HTMLElement;
      expect(taxonomyEn.textContent).not.toMatch(/Start Pro trial/i);
      expect(taxonomyEn.textContent).toContain('Upgrade to Pro');
      unmountLandingEn();

      const { unmount: unmountPricingEn } = renderWithAuth(<PricingPage />, {
        user: null,
        initialEntries: ['/pricing'],
      });
      const basicEnText = screen.getByTestId('plan-card-basic').textContent ?? '';
      expect(basicEnText).not.toContain('No PDF, DOCX');
      expect(basicEnText).not.toContain('No Document Inspector');
      expect(basicEnText).not.toContain('No multi-file Batch Upload');
      expect(basicEnText).toMatch(/Word\/PDF export on Pro/i);
      unmountPricingEn();

      await i18n.changeLanguage('vi');
      const { unmount: unmountPricingVi } = renderWithAuth(<PricingPage />, {
        user: null,
        initialEntries: ['/pricing'],
      });
      const basicViText = screen.getByTestId('plan-card-basic').textContent ?? '';
      expect(basicViText).not.toContain('Không hỗ trợ xuất báo cáo PDF');
      expect(basicViText).not.toContain('Không hỗ trợ tải lên hàng loạt');
      expect(basicViText).toMatch(/xuất Word\/PDF ở gói Pro/i);
      unmountPricingVi();
    } finally {
      await i18n.changeLanguage('en');
    }
  });

  it('Task 1.3 — renders data-testid="pro-vnd-equivalent" when language is vi while preserving exact "$16" / "$20" textContent on landing-price-pro and pro-price-display', async () => {
    try {
      // English: no VND equivalent node
      await i18n.changeLanguage('en');
      const { unmount: unmountEn } = renderWithAuth(<PricingPage />, {
        user: null,
        initialEntries: ['/pricing'],
      });
      expect(screen.queryByTestId('pro-vnd-equivalent')).toBeNull();
      expect(screen.getByTestId('pro-price-display').textContent).toBe('$16');
      unmountEn();

      // Vietnamese on LandingPage: monthly default ($20 / ~500.000 ₫), toggle to annual ($16 / ~400.000 ₫)
      await i18n.changeLanguage('vi');
      const { unmount: unmountLandingVi } = renderWithAuth(<LandingPage />, {
        user: null,
        initialEntries: ['/'],
      });
      const landingPricePro = screen.getByTestId('landing-price-pro');
      const landingVnd = screen.getByTestId('pro-vnd-equivalent');
      expect(landingPricePro.textContent).toBe('$20');
      expect(landingPricePro.contains(landingVnd)).toBe(false);
      expect(landingVnd.textContent).toContain('500.000 ₫');

      fireEvent.click(screen.getByTestId('landing-billing-toggle'));
      expect(screen.getByTestId('landing-price-pro').textContent).toBe('$16');
      expect(screen.getByTestId('pro-vnd-equivalent').textContent).toContain('400.000 ₫');
      unmountLandingVi();

      // Vietnamese on PricingPage: annual default ($16 / ~400.000 ₫), toggle to monthly ($20 / ~500.000 ₫)
      const { unmount: unmountPricingVi } = renderWithAuth(<PricingPage />, {
        user: null,
        initialEntries: ['/pricing'],
      });
      const proDisplay = screen.getByTestId('pro-price-display');
      const pricingVnd = screen.getByTestId('pro-vnd-equivalent');
      expect(proDisplay.textContent).toBe('$16');
      expect(proDisplay.contains(pricingVnd)).toBe(false);
      expect(pricingVnd.textContent).toContain('400.000 ₫');

      fireEvent.click(screen.getByTestId('billing-toggle-monthly'));
      expect(screen.getByTestId('pro-price-display').textContent).toBe('$20');
      expect(screen.getByTestId('pro-vnd-equivalent').textContent).toContain('500.000 ₫');
      unmountPricingVi();
    } finally {
      await i18n.changeLanguage('en');
    }
  });

  it('Task 1.3 Round 1 — switches authenticated PricingPage grid/subgrid to xl: to prevent 1024px AppLayout sidebar crush and keeps narrow-column & adminLocked CTAs concise', async () => {
    try {
      await i18n.changeLanguage('en');
      const { unmount: unmountPublic } = renderWithAuth(<PricingPage />, {
        user: null,
        initialEntries: ['/pricing'],
      });
      const publicBasicCard = screen.getByTestId('plan-card-basic');
      const publicGrid = publicBasicCard.parentElement?.parentElement as HTMLElement;
      expect(publicGrid.className).toContain('lg:grid-cols-3');
      expect(publicGrid.className).not.toContain('xl:grid-cols-3');

      // Upgrade CTAs wrap price suffix inside hidden 2xl:inline while preserving .textContent
      const pubProBtn = screen.getByTestId('select-pro-btn');
      const pubUltraBtn = screen.getByTestId('select-ultra-btn');
      expect(pubProBtn.textContent).toContain('Upgrade to Pro · $192/yr');
      expect(pubUltraBtn.textContent).toContain('Upgrade to Ultra · $1,920/yr');
      expect(pubProBtn.querySelector('span.hidden.2xl\\:inline')).not.toBeNull();
      expect(pubUltraBtn.querySelector('span.hidden.2xl\\:inline')).not.toBeNull();
      unmountPublic();

      // Authenticated user inside AppLayout -> xl:grid-cols-3 + xl:grid-rows-subgrid
      const { unmount: unmountAuth } = renderWithAuth(
        <AppLayout>
          <PricingPage />
        </AppLayout>,
        { user: createMockUser({ plan_tier: 'basic' }), initialEntries: ['/pricing'] },
      );
      const authBasicCard = screen.getByTestId('plan-card-basic');
      const authGrid = authBasicCard.parentElement?.parentElement as HTMLElement;
      expect(authGrid.className).toContain('xl:grid-cols-3');
      expect(authGrid.className).not.toContain('lg:grid-cols-3');
      const authProSurface = screen
        .getByTestId('plan-card-pro')
        .querySelector('.solva-pro-card-surface') as HTMLElement;
      expect(authProSurface.className).toContain('xl:row-span-4');
      expect(authProSurface.className).not.toContain('lg:row-span-4');
      unmountAuth();

      // Admin user EN & VI concise adminLocked CTA copy
      const adminUser = createMockUser({ role: 'admin', plan_tier: 'ultra' });
      const { unmount: unmountAdminEn } = renderWithAuth(<PricingPage />, {
        user: adminUser,
        initialEntries: ['/pricing'],
      });
      expect(screen.getByTestId('select-basic-btn').textContent).toContain('Included with Admin');
      expect(screen.getByTestId('select-pro-btn').textContent).toContain('Included with Admin');
      expect(screen.getByTestId('select-ultra-btn').textContent).toContain('Current Plan · Ultra (Admin)');
      expect(
        screen.getByTestId('select-ultra-btn').querySelector('span.hidden.2xl\\:inline')?.textContent,
      ).toBe(' Plan');
      unmountAdminEn();

      await i18n.changeLanguage('vi');
      const { unmount: unmountAdminVi } = renderWithAuth(<PricingPage />, {
        user: adminUser,
        initialEntries: ['/pricing'],
      });
      expect(screen.getByTestId('select-basic-btn').textContent).toContain('Mở sẵn cho Quản trị');
      expect(screen.getByTestId('select-pro-btn').textContent).toContain('Mở sẵn cho Quản trị');
      expect(screen.getByTestId('select-ultra-btn').textContent).toContain('Gói Quản trị · Ultra');
      unmountAdminVi();

      // Public VI Ultra CTA uses Vietnamese dot thousands separator ($1.920/năm) inside hidden 2xl:inline
      const { unmount: unmountPubVi } = renderWithAuth(<PricingPage />, {
        user: null,
        initialEntries: ['/pricing'],
      });
      const viUltraBtn = screen.getByTestId('select-ultra-btn');
      expect(viUltraBtn.textContent).toContain('Nâng cấp lên Ultra · $1.920/năm');
      expect(viUltraBtn.querySelector('span.hidden.2xl\\:inline')).not.toBeNull();
      unmountPubVi();
    } finally {
      await i18n.changeLanguage('en');
    }
  });

  it('Task 1.3 Round 1 — enforces var(--solva-muted) WCAG AA contrast on $20/$200 strikethroughs, aria-pressed on billing toggles, whitespace-nowrap VND spans, and clean VI annual billing copy', async () => {
    try {
      await i18n.changeLanguage('en');
      const { container: enContainer, unmount: unmountEn } = renderWithAuth(<PricingPage />, {
        user: null,
        initialEntries: ['/pricing'],
      });

      // aria-pressed on billing cycle toggle buttons
      const monthlyBtn = screen.getByTestId('billing-toggle-monthly');
      const annualBtn = screen.getByTestId('billing-toggle-annual');
      expect(annualBtn.getAttribute('aria-pressed')).toBe('true');
      expect(monthlyBtn.getAttribute('aria-pressed')).toBe('false');

      // Strikethrough $20 & $200 use var(--solva-muted), never var(--solva-subtle)
      const strikethroughs = Array.from(enContainer.querySelectorAll('.line-through'));
      expect(strikethroughs.map((el) => el.textContent)).toEqual(['$20', '$200']);
      for (const el of strikethroughs) {
        expect(el.getAttribute('style')).toContain('var(--solva-muted)');
        expect(el.getAttribute('style')).not.toContain('var(--solva-subtle)');
      }

      fireEvent.click(monthlyBtn);
      expect(monthlyBtn.getAttribute('aria-pressed')).toBe('true');
      expect(annualBtn.getAttribute('aria-pressed')).toBe('false');
      unmountEn();

      // Vietnamese VND clauses wrapped in whitespace-nowrap + clean annual helper copy
      await i18n.changeLanguage('vi');
      const { unmount: unmountLandingVi } = renderWithAuth(<LandingPage />, {
        user: null,
        initialEntries: ['/'],
      });
      fireEvent.click(screen.getByTestId('landing-billing-toggle'));
      const landingProVnd = screen.getByTestId('pro-vnd-equivalent');
      expect(landingProVnd.getAttribute('style')).toContain('var(--solva-ink)');
      expect(landingProVnd.className).toContain('font-medium');
      expect(landingProVnd.querySelectorAll('span.whitespace-nowrap').length).toBeGreaterThanOrEqual(3);
      expect(landingProVnd.textContent).toContain('400.000 ₫');
      expect(landingProVnd.textContent).toContain('4.800.000 ₫/năm');
      unmountLandingVi();

      const { unmount: unmountPricingVi } = renderWithAuth(<PricingPage />, {
        user: null,
        initialEntries: ['/pricing'],
      });
      const pricingProVnd = screen.getByTestId('pro-vnd-equivalent');
      const pricingUltraVnd = screen.getByTestId('ultra-vnd-equivalent');
      expect(pricingProVnd.querySelectorAll('span.whitespace-nowrap').length).toBeGreaterThanOrEqual(3);
      expect(pricingUltraVnd.querySelectorAll('span.whitespace-nowrap').length).toBeGreaterThanOrEqual(3);

      const proCardViText = screen.getByTestId('plan-card-pro').textContent ?? '';
      const ultraCardViText = screen.getByTestId('plan-card-ultra').textContent ?? '';
      expect(proCardViText).toContain('Thanh toán $192/năm (Tiết kiệm $48/năm — Giảm 20%)');
      expect(proCardViText).not.toContain('>2 tháng');
      expect(ultraCardViText).toContain('$1.920/năm');
      expect(ultraCardViText).not.toContain('$1,920');
      unmountPricingVi();
    } finally {
      await i18n.changeLanguage('en');
    }
  });

  it('Task 1.3 Round 1 — eliminates ML/SQL/XML/vendor jargon and Vietlish inside all 3 pricing cards on LandingPage and PricingPage and numbers badges 01 -> 02 -> 03', async () => {
    const forbiddenJargon = [
      /GROBID/i,
      /TEI-XML/i,
      /FTS5/i,
      /128K\+/i,
      /trực giao/i,
      /Orthogonal/i,
      /8 L1 × 5 L2/i,
      /<->/,
      /MiniLM/i,
      /ONNX/i,
      /INT8/i,
      /Neuro-Symbolic/i,
      /HF,\s*RFC/i,
      /SerpAPI/i,
      /Admin Control Plane/i,
      /Batch Upload 10 files/i,
      /Link[- ]Rot/i,
      /Fair-use/i,
    ];
    const forbiddenVietlish = [
      /Document Inspector/i,
      /Logic Trace/i,
      /Class ZIP/i,
      /Batch Upload/i,
      /Classrooms/i,
      /Override/i,
    ];

    try {
      for (const locale of ['en', 'vi'] as const) {
        await i18n.changeLanguage(locale);

        const { container: landingContainer, unmount: unmountLanding } = renderWithAuth(
          <LandingPage />,
          { user: null, initialEntries: ['/'] },
        );
        const taxonomy = landingContainer.querySelector('#taxonomy') as HTMLElement;
        const landingCardsText = taxonomy.textContent ?? '';
        for (const pattern of forbiddenJargon) {
          expect(landingCardsText).not.toMatch(pattern);
        }
        if (locale === 'vi') {
          for (const pattern of forbiddenVietlish) {
            expect(landingCardsText).not.toMatch(pattern);
          }
          expect(landingCardsText).toContain('02 · PHỔ BIẾN NHẤT');
          expect(landingCardsText).not.toContain('02 · KHUYÊN DÙNG');
        } else {
          expect(landingCardsText).toContain('02 · MOST POPULAR');
          expect(landingCardsText).not.toContain('02 · RECOMMENDED');
        }
        expect(taxonomy.querySelectorAll('[class*="gap-y-2"]').length).toBeGreaterThanOrEqual(3);
        unmountLanding();

        const { unmount: unmountPricing } = renderWithAuth(<PricingPage />, {
          user: null,
          initialEntries: ['/pricing'],
        });
        const pricingCardsText = [
          screen.getByTestId('plan-card-basic').textContent ?? '',
          screen.getByTestId('plan-card-pro').textContent ?? '',
          screen.getByTestId('plan-card-ultra').textContent ?? '',
        ].join(' ');

        for (const pattern of forbiddenJargon) {
          expect(pricingCardsText).not.toMatch(pattern);
        }
        if (locale === 'vi') {
          for (const pattern of forbiddenVietlish) {
            expect(pricingCardsText).not.toMatch(pattern);
          }
          expect(screen.getByTestId('plan-card-pro').textContent).toContain('02 · PHỔ BIẾN NHẤT');
        } else {
          expect(screen.getByTestId('plan-card-pro').textContent).toContain('02 · MOST POPULAR');
        }
        for (const cardId of ['plan-card-basic', 'plan-card-pro', 'plan-card-ultra']) {
          expect(
            screen.getByTestId(cardId).querySelector('[class*="gap-y-2"]'),
          ).not.toBeNull();
        }
        unmountPricing();
      }
    } finally {
      await i18n.changeLanguage('en');
    }
  });

  it('Task 1.4 — LandingPage mobile drawer renders accessible Pricing / Bảng giá link (data-testid="mobile-menu-pricing-link") with >=44px tap target and closes menu on click', async () => {
    try {
      await i18n.changeLanguage('en');
      const { unmount: unmountEn } = renderWithAuth(
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/pricing" element={<div data-testid="mobile-pricing-dest">Pricing Route</div>} />
        </Routes>,
        { user: null, initialEntries: ['/'] },
      );

      expect(screen.queryByTestId('mobile-menu-pricing-link')).toBeNull();
      const menuBtn = screen.getByRole('button', { name: /toggle navigation menu/i });
      fireEvent.click(menuBtn);
      expect(menuBtn.getAttribute('aria-expanded')).toBe('true');

      const pricingLinkEn = screen.getByTestId('mobile-menu-pricing-link');
      expect(pricingLinkEn.getAttribute('href')).toBe('/pricing');
      expect(pricingLinkEn.textContent?.trim()).toBe('Pricing');
      expect(pricingLinkEn.className).toContain('min-h-[44px]');

      fireEvent.click(pricingLinkEn);
      expect(screen.getByTestId('mobile-pricing-dest')).toBeDefined();
      unmountEn();

      // Verify Vietnamese label and drawer close state
      await i18n.changeLanguage('vi');
      const { unmount: unmountVi } = renderWithAuth(<LandingPage />, {
        user: null,
        initialEntries: ['/'],
      });
      const menuBtnVi = screen.getByRole('button', { name: /toggle navigation menu/i });
      fireEvent.click(menuBtnVi);
      const pricingLinkVi = screen.getByTestId('mobile-menu-pricing-link');
      expect(pricingLinkVi.getAttribute('href')).toBe('/pricing');
      expect(pricingLinkVi.textContent?.trim()).toBe('Bảng giá');
      expect(pricingLinkVi.className).toContain('min-h-[44px]');

      fireEvent.click(pricingLinkVi);
      expect(menuBtnVi.getAttribute('aria-expanded')).toBe('false');
      unmountVi();
    } finally {
      await i18n.changeLanguage('en');
    }
  });

  it('Task 1.4 — PricingSolvaHeader desktop nav enforces single-line discipline (flex-nowrap, whitespace-nowrap shrink-0) in EN and VI while preserving Platform dropdown', async () => {
    try {
      for (const locale of ['en', 'vi'] as const) {
        await i18n.changeLanguage(locale);
        const { container, unmount } = renderWithAuth(<PricingPage />, {
          user: null,
          initialEntries: ['/pricing'],
        });

        // Root uses overflow-x-clip instead of overflow-x-hidden so position:sticky works cleanly
        const root = screen.getByTestId('pricing-page');
        expect(root.className).toContain('overflow-x-clip');
        expect(root.className).not.toContain('overflow-x-hidden');

        const header = container.querySelector('header') as HTMLElement;
        expect(header).not.toBeNull();
        const headerBar = header.firstElementChild as HTMLElement;
        expect(headerBar.className).toContain('flex-nowrap');

        const nav = container.querySelector('nav[aria-label="Pricing Navigation"]') as HTMLElement;
        expect(nav).not.toBeNull();
        expect(nav.className).toContain('flex-nowrap');
        expect(nav.className).toContain('min-w-0');

        // Every direct interactive link/button in center nav must enforce whitespace-nowrap + shrink-0
        const navControls = [
          ...Array.from(nav.querySelectorAll(':scope > a')),
          ...Array.from(nav.querySelectorAll(':scope > div > button')),
        ];
        expect(navControls.length).toBeGreaterThanOrEqual(4);
        for (const ctrl of navControls) {
          expect(ctrl.className).toContain('whitespace-nowrap');
          expect(ctrl.className).toContain('shrink-0');
        }

        if (locale === 'vi') {
          expect(nav.textContent).not.toContain('Câu hỏi thường gặp');
          expect(nav.textContent).not.toContain('Benchmark 120K');
          expect(nav.textContent).toContain('Thực nghiệm 120K');
        }

        unmount();
      }
    } finally {
      await i18n.changeLanguage('en');
    }
  });

  it('Task 1.4 — PricingPage #compare-matrix renders mobile-compare-tier-tabs switching cleanly between Basic, Pro, and Ultra feature cards + CTA while preserving semantic 4-column desktop table', async () => {
    const createSessionSpy = vi.spyOn(api, 'createCheckoutSession').mockResolvedValue({
      session_id: 'cs_test_mobile_matrix',
      checkout_url: '/billing/checkout?session_id=cs_test_mobile_matrix',
      mode: 'stripe_demo',
      plan_tier: 'pro',
      plan_name: 'Pro',
      billing_cycle: 'annual',
      amount_usd: 192,
      transaction_id: 9,
    });

    await i18n.changeLanguage('en');

    // 1. Public view (!user) -> md:hidden mobile switcher + hidden md:block desktop table
    const { container: pubContainer, unmount: unmountPublic } = renderWithAuth(<PricingPage />, {
      user: null,
      initialEntries: ['/pricing'],
    });

    const compareSection = pubContainer.querySelector('#compare-matrix') as HTMLElement;
    expect(compareSection).not.toBeNull();

    const tierTabs = within(compareSection).getByTestId('mobile-compare-tier-tabs');
    expect(tierTabs.getAttribute('role')).toBe('tablist');
    expect(tierTabs.className).toContain('md:hidden');

    const tabs = within(tierTabs).getAllByRole('tab');
    expect(tabs).toHaveLength(3);
    for (const tab of tabs) {
      expect(tab.className).toContain('min-h-[44px]');
    }

    const [basicTab, proTab, ultraTab] = tabs;
    expect(basicTab.textContent).toMatch(/Basic/i);
    expect(proTab.textContent).toMatch(/Pro/i);
    expect(ultraTab.textContent).toMatch(/Ultra/i);

    // Switch to Basic -> Basic quotas + Not included badges + Basic CTA
    fireEvent.click(basicTab);
    expect(basicTab.getAttribute('aria-selected')).toBe('true');
    expect(proTab.getAttribute('aria-selected')).toBe('false');
    expect(ultraTab.getAttribute('aria-selected')).toBe('false');
    const panelBasic = within(compareSection).getByTestId('mobile-compare-tier-panel');
    expect(panelBasic.textContent).toContain('3 manuscripts / mo');
    expect(panelBasic.textContent).toContain('5 MB');
    expect(panelBasic.textContent).toContain('15 pages');
    expect(panelBasic.textContent).toContain('Not included');

    // Switch to Pro -> Pro quotas + Included badges + Pro CTA
    fireEvent.click(proTab);
    expect(proTab.getAttribute('aria-selected')).toBe('true');
    expect(panelBasic.textContent).toContain('50 manuscripts / mo');
    expect(panelBasic.textContent).toContain('25 MB');
    expect(panelBasic.textContent).toContain('100 pages');
    expect(panelBasic.textContent).toContain('Included');

    // Switch to Ultra -> Ultra quotas + Ultra CTA
    fireEvent.click(ultraTab);
    expect(ultraTab.getAttribute('aria-selected')).toBe('true');
    expect(panelBasic.textContent).toContain('Up to 1,000 / mo');
    expect(panelBasic.textContent).toContain('100 MB');
    expect(panelBasic.textContent).toContain('500 pages');
    expect(panelBasic.textContent).toContain('Lifetime Retention');

    // Desktop 4-column semantic table preserved inside hidden md:block + overflow-x-auto
    const desktopTable = compareSection.querySelector('table') as HTMLTableElement;
    expect(desktopTable).not.toBeNull();
    expect(desktopTable.querySelectorAll('thead th')).toHaveLength(4);
    expect(desktopTable.querySelectorAll('tbody tr')).toHaveLength(13);
    const desktopTableWrap = desktopTable.closest('[data-testid="desktop-compare-table-wrap"]') as HTMLElement;
    expect(desktopTableWrap).not.toBeNull();
    expect(desktopTableWrap.className).toContain('hidden');
    expect(desktopTableWrap.className).toContain('md:block');
    unmountPublic();

    // 2. Authenticated view (Boolean(user) inside AppLayout) -> lg:hidden mobile switcher + hidden lg:block desktop table + bottom CTA checkout
    const { container: authContainer, unmount: unmountAuth } = renderWithAuth(
      <Routes>
        <Route
          path="/pricing"
          element={
            <AppLayout>
              <PricingPage />
            </AppLayout>
          }
        />
        <Route path="/billing/checkout" element={<div data-testid="matrix-checkout-dest">Checkout</div>} />
      </Routes>,
      { user: createMockUser({ plan_tier: 'basic' }), initialEntries: ['/pricing'] },
    );

    const authCompare = authContainer.querySelector('#compare-matrix') as HTMLElement;
    const authTabs = within(authCompare).getByTestId('mobile-compare-tier-tabs');
    expect(authTabs.className).toContain('lg:hidden');

    const authDesktopWrap = within(authCompare).getByTestId('desktop-compare-table-wrap');
    expect(authDesktopWrap.className).toContain('hidden');
    expect(authDesktopWrap.className).toContain('lg:block');

    fireEvent.click(within(authTabs).getAllByRole('tab')[1]); // Select Pro tab
    fireEvent.click(within(authCompare).getByTestId('mobile-compare-tier-cta'));

    await waitFor(() => {
      expect(createSessionSpy).toHaveBeenCalledWith({
        plan_tier: 'pro',
        billing_cycle: 'annual',
      });
    });
    unmountAuth();
  });

  it('Task 1.4 — eliminates engineering/vendor jargon and Vietlish in COMPARISON_MATRIX and PricingPage hero subtitle across EN and VI', async () => {
    const forbiddenJargon = [
      /Local 128K\+/i,
      /HF,\s*RFC/i,
      /Hugging Face/i,
      /IETF RFC/i,
      /OpenAIRE\/HAL/i,
      /Sentence-BERT/i,
      /Evidence DAG/i,
      /Bounding-Box/i,
      /SerpAPI/i,
    ];
    const forbiddenMatrixVietlish = [
      /Batch Check/i,
      /Batch Upload/i,
      /Document Inspector/i,
      /Override/i,
      /Auto-Fix Studio/i,
      /Class ZIP/i,
      /Web View/i,
      /docs \/ mo/i,
      /15 pages/i,
      /Unlimited Lifetime/i,
    ];

    try {
      for (const locale of ['en', 'vi'] as const) {
        await i18n.changeLanguage(locale);
        const { container, unmount } = renderWithAuth(<PricingPage />, {
          user: null,
          initialEntries: ['/pricing'],
        });

        const heroHeading = container.querySelector('h1');
        const heroBlock = heroHeading?.closest('div.max-w-\\[760px\\]') ?? heroHeading?.parentElement?.parentElement;
        const heroSubtitleText = heroBlock?.querySelector('p')?.textContent ?? '';
        expect(heroSubtitleText.length).toBeGreaterThan(40);

        const compareSection = container.querySelector('#compare-matrix') as HTMLElement;
        const compareText = compareSection.textContent ?? '';

        for (const pattern of forbiddenJargon) {
          expect(heroSubtitleText).not.toMatch(pattern);
          expect(compareText).not.toMatch(pattern);
        }

        if (locale === 'vi') {
          for (const pattern of forbiddenMatrixVietlish) {
            expect(compareText).not.toMatch(pattern);
          }
        }

        unmount();
      }
    } finally {
      await i18n.changeLanguage('en');
    }
  });

  it('Task 3.3 Round 1 — PricingPage harmonizes non-tech copy across Platform dropdown, Section 3 quote/metrics, FAQ, and Footer, sets lang + data-lang, and removes dead Tailwind v4 tokens', async () => {
    const forbiddenPricingPageJargon = [
      /GROBID/i,
      /TEI-XML/i,
      /Sentence-BERT/i,
      /MiniLM/i,
      /ONNX/i,
      /INT8/i,
      /SerpAPI/i,
      /Orthogonal Mapping/i,
      /Citation Debugger/i,
      /0[.,]0395 ECE/i,
      /99[.,]75% OOD/i,
      /mã DOI ảo giác/i,
      /Class ZIP/i,
      /L1 × L2/i,
      /Neuro-Symbolic/i,
    ];

    try {
      for (const locale of ['en', 'vi'] as const) {
        await i18n.changeLanguage(locale);
        const { container, unmount } = renderWithAuth(<PricingPage />, {
          user: null,
          initialEntries: ['/pricing'],
        });

        const root = screen.getByTestId('pricing-page');
        expect(root.getAttribute('lang')).toBe(locale);
        expect(root.getAttribute('data-lang')).toBe(locale);
        expect(root.innerHTML).not.toContain('shadow-2xs');
        expect(root.innerHTML).not.toContain('duration-250');

        // Open Platform / Nền tảng dropdown so its items are included in DOM text audit
        const nav = container.querySelector('nav[aria-label="Pricing Navigation"]') as HTMLElement;
        const dropdownBtn = within(nav).getByRole('button', {
          name: locale === 'vi' ? /Nền tảng/i : /Platform/i,
        });
        fireEvent.click(dropdownBtn);

        // Expand all FAQ items in #pricing-faq
        const faqButtons = Array.from(
          container.querySelectorAll('#pricing-faq button[aria-expanded]'),
        ) as HTMLButtonElement[];
        expect(faqButtons.length).toBe(6);
        for (const btn of faqButtons) {
          if (btn.getAttribute('aria-expanded') === 'false') {
            fireEvent.click(btn);
          }
        }

        const fullPageText = container.textContent ?? '';
        for (const pattern of forbiddenPricingPageJargon) {
          expect(fullPageText).not.toMatch(pattern);
        }

        if (locale === 'vi') {
          expect(nav.textContent).toContain('Thực nghiệm 120K');
          expect(fullPageText).toContain('mã DOI không tồn tại');
          expect(fullPageText).toContain('Thư viện & kho dữ liệu học thuật uy tín');
          expect(fullPageText).toContain('Độ chính xác kiểm chứng trích dẫn');
          expect(fullPageText).toContain('Độ chuẩn xác đối chiếu');
          expect(fullPageText).not.toContain('0 kết luận oan');
          expect(fullPageText).not.toContain('CITRA Lab');
          expect(fullPageText).toContain('99,67%');
          expect(fullPageText).toContain('99,93%');
        } else {
          expect(nav.textContent).toContain('120K Benchmark');
          expect(fullPageText).toContain('Trusted academic libraries & indexes');
          expect(fullPageText).toContain('Overall citation verification accuracy');
          expect(fullPageText).toContain('Verification precision');
          expect(fullPageText).not.toContain('zero false accusations');
          expect(fullPageText).not.toContain('CITRA Lab');
        }

        unmount();
      }
    } finally {
      await i18n.changeLanguage('en');
    }
  });

  it('BUG-16 / BUG-17 / BUG-27 / BUG-39 / BUG-40 / BUG-51 / BUG-55 — preserves ?redirect= on unauth pricing CTA, fixes active Ultra CTAs & dynamic FAQ price, cleans checkout jargon & promo length, and handles VNPay cancelled callback', async () => {
    await i18n.changeLanguage('en');

    // 1. Active annual Ultra user on /pricing: Basic shows "Included in your plan" (single text node, no duplicate roll span),
    //    Monthly view shows "Switch to Monthly" instead of "Upgrade to Ultra", FAQ #2 reflects billing cycle, and table header is sticky.
    const { container: ultraPricing, unmount: unmountUltra } = renderWithAuth(
      <PricingPage />,
      {
        user: createMockUser({ plan_tier: 'ultra', billing_cycle: 'annual' }),
        initialEntries: ['/pricing'],
      },
    );

    const basicCta = screen.getByTestId('select-basic-btn');
    expect(basicCta.textContent?.trim()).toBe('Included in your plan');
    expect((basicCta as HTMLButtonElement).disabled).toBe(true);

    // Sticky comparison table header
    const comparisonThead = ultraPricing.querySelector('table thead');
    expect(comparisonThead?.className).toContain('sticky');

    // FAQ #2 dynamically reflects annual ($16/mo billed annually) vs monthly ($20/mo billed monthly)
    const faqBtns = Array.from(
      ultraPricing.querySelectorAll('#pricing-faq button[aria-expanded]'),
    ) as HTMLButtonElement[];
    fireEvent.click(faqBtns[1]);
    expect(ultraPricing.querySelector('#pricing-faq')?.textContent).toContain('$16/mo billed annually');

    // Switch to monthly cycle: Ultra CTA offers "Switch to Monthly" (with aria-hidden="true" on roll-animation clone)
    fireEvent.click(screen.getByTestId('billing-toggle-monthly'));
    const ultraBtn = screen.getByTestId('select-ultra-btn');
    expect(ultraBtn.textContent).toContain('Switch to Monthly');
    expect(ultraBtn.querySelector('[aria-hidden="true"]')?.textContent?.trim()).toBe('Switch to Monthly');
    expect(ultraPricing.querySelector('#pricing-faq')?.textContent).toContain('$20/mo billed monthly');
    unmountUltra();

    // 2. Checkout page: promo code maxLength >= 32, VNPay tab hides raw vnp_Amount=/VNBANK/VNPAYQR/INTCARD/HMAC-SHA512 & Luhn badge
    vi.spyOn(api, 'getCheckoutSessionDetails').mockResolvedValue({
      session_id: 'cs_test_clean_ui_001',
      status: 'pending',
      payment_mode: 'stripe_demo',
      merchant_name: 'CITRA (SourceLogic) Inc.',
      customer_email: 'minh@tdtu.edu.vn',
      customer_name: 'Nguyen Bao Minh',
      plan_tier: 'ultra',
      plan_name: 'Ultra Institutional',
      billing_cycle: 'monthly',
      amount_usd: 200,
      amount_vnd: 5000000,
      usd_to_vnd_rate: 25000,
      currency: 'usd',
      monthly_equivalent_usd: 200,
      annual_savings_usd: 0,
      features_en: [
        'Unlimited manuscript verification',
        'SerpAPI Google Scholar Fallback',
      ],
      features_vi: [
        'Kiểm tra bản thảo không giới hạn',
        'SerpAPI Google Scholar Fallback',
      ],
    });

    const { container: checkoutContainer, unmount: unmountCheckout } = renderWithAuth(
      <Routes>
        <Route path="/billing/checkout" element={<StripeDemoCheckoutPage />} />
      </Routes>,
      {
        user: createMockUser({ plan_tier: 'basic' }),
        initialEntries: ['/billing/checkout?session_id=cs_test_clean_ui_001'],
      },
    );

    await waitFor(() => {
      expect(screen.getByTestId('checkout-promo-input')).toBeDefined();
    });

    const promoInput = screen.getByTestId('checkout-promo-input') as HTMLInputElement;
    expect(promoInput.maxLength).toBeGreaterThanOrEqual(32);
    expect(checkoutContainer.textContent).not.toContain('SourceLogic');
    expect(checkoutContainer.textContent).not.toContain('SerpAPI');
    expect(checkoutContainer.textContent).not.toContain('Luhn Verified');

    // Switch to VNPay tab and verify zero raw vnp_Amount= / VNBANK / VNPAYQR / INTCARD / HMAC-SHA512 leaks
    fireEvent.click(screen.getByTestId('method-tab-vnpay'));
    await waitFor(() => {
      expect(screen.getByTestId('vnpay-tab-panel')).toBeDefined();
    });
    const vnpayText = screen.getByTestId('vnpay-tab-panel').textContent ?? '';
    expect(vnpayText).not.toContain('vnp_Amount');
    expect(vnpayText).not.toContain('VNBANK');
    expect(vnpayText).not.toContain('VNPAYQR');
    expect(vnpayText).not.toContain('INTCARD');
    expect(vnpayText).not.toContain('HMAC-SHA512');
    unmountCheckout();

    // 3. BillingSuccessPage: VNPay vnp_ResponseCode=24 renders friendly cancelled state (BUG-51)
    await i18n.changeLanguage('vi');
    const { unmount: unmountCancel } = renderWithAuth(
      <Routes>
        <Route path="/billing/success" element={<BillingSuccessPage />} />
      </Routes>,
      {
        user: createMockUser({ plan_tier: 'basic' }),
        initialEntries: ['/billing/success?session_id=cs_cancelled_24&vnp_ResponseCode=24'],
      },
    );

    await waitFor(() => {
      expect(screen.getByTestId('billing-verification-cancelled')).toBeDefined();
    });
    expect(
      screen.getByTestId('billing-verification-cancelled').textContent,
    ).toContain('Giao dịch đã được hủy');
    unmountCancel();

    // 4. BillingSuccessPage: fake session 404 error is translated to Vietnamese via formatUserError (BUG-16)
    vi.spyOn(api, 'verifyCheckoutSession').mockRejectedValue(
      new Error('API 404: Checkout session not found'),
    );
    const { unmount: unmountErr } = renderWithAuth(
      <Routes>
        <Route path="/billing/success" element={<BillingSuccessPage />} />
      </Routes>,
      {
        user: createMockUser({ plan_tier: 'basic' }),
        initialEntries: ['/billing/success?session_id=fake-session-id'],
      },
    );

    await waitFor(() => {
      expect(screen.getByTestId('billing-verification-error')).toBeDefined();
    });
    const errText = screen.getByTestId('billing-verification-error').textContent ?? '';
    expect(errText).not.toContain('API 404:');
    expect(errText).not.toContain('Checkout session not found');
    unmountErr();

    await i18n.changeLanguage('en');
  });
});
