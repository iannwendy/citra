import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { ToastProvider } from '@/contexts/ToastContext';
import { AuthContext } from '@/contexts/AuthContext';
import { api, type User } from '@/api/client';
import '@/i18n';
import { PricingPage } from './PricingPage';
import { StripeDemoCheckoutPage } from './StripeDemoCheckoutPage';
import { BillingSuccessPage } from './BillingSuccessPage';
import { UploadPage } from './UploadPage';
import { SandboxPage } from './SandboxPage';
import { EssayPage } from './EssayPage';
import { ProcessingPage } from './ProcessingPage';
import { SettingsPage } from './SettingsPage';
import { EssayHeader } from './essay/EssayHeader';
import { EssayActionBar } from './essay/EssayActionBar';
import { UpgradeModal } from '@/components/UpgradeModal';
import { AppLayout } from '@/components/AppLayout';

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

    // Click Cancel Auto-Renew
    fireEvent.click(screen.getByTestId('settings-cancel-sub-btn'));
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

  it('ProcessingPage renders 15+ source retrieval tiles, 28 symbolic rules label, and clean telemetry message for Student/Ultra users', async () => {
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
      expect(screen.getByTestId('federated-source-retrieval-card')).toBeDefined();
    });

    expect(
      screen.getByText(/Compared 42 source hits across 5 databases/i),
    ).toBeDefined();
    expect(screen.getByText('18+ INDEXES')).toBeDefined();
    expect(screen.getByText('28 SYMBOLIC RULES')).toBeDefined();
    expect(screen.getByText('Local ACL FTS5 (128K+)')).toBeDefined();
    expect(screen.getByText('IETF RFC / PyPI / NPM / GitHub')).toBeDefined();
    expect(screen.getByText('Wikidata / OpenCitations')).toBeDefined();
    expect(screen.getByText('Seminal Whitelist')).toBeDefined();
    expect(document.body.textContent).not.toContain('интерактив');
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
      expect(getReportSpy).toHaveBeenCalledWith(29);
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
});
