import { describe, it, expect, vi, beforeEach } from 'vitest';
import { api } from '@/api/client';
import i18n from '@/i18n';
import { renderWithProviders, makeUser, QUOTA_BY_TIER, screen, fireEvent, waitFor } from '@/test-utils';
import { PricingPage } from './PricingPage';
import { SettingsPage } from './SettingsPage';
import { AppLayout } from '@/components/AppLayout';

/** Contract C3: admins render "Unlimited" and Ultra is their current plan. */

const adminWithSentinels = () =>
  makeUser('admin', 'ultra', {
    plan_tier: 'ultra',
    billing_cycle: null,
    quota: {
      ...QUOTA_BY_TIER.ultra,
      monthly_uploads_used: 0,
      monthly_uploads_limit: 999999,
      monthly_uploads_remaining: 999999,
      max_pages_per_pdf: 9999,
    },
  });

describe('Admin unlimited quota & plan display', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage('en');
    vi.spyOn(api, 'getMySubscription').mockResolvedValue({
      subscription: {
        plan_tier: 'ultra',
        plan_name: 'Ultra',
        billing_cycle: null,
        subscription_status: 'active',
        cancel_at_period_end: false,
        current_period_start: null,
        current_period_end: null,
        quota: adminWithSentinels().quota!,
      },
      transactions: [],
    } as never);
  });

  it('PricingPage: admin banner shows Unlimited, no 999999', () => {
    renderWithProviders(<PricingPage />, { user: adminWithSentinels() });
    const banner = screen.getByTestId('current-plan-banner');
    expect(banner.textContent).toContain('ULTRA');
    expect(banner.textContent).toContain('Unlimited');
    expect(banner.textContent).not.toMatch(/9999/);
  });

  it('PricingPage: all plan CTAs are disabled for admin, Ultra marked current, with a note', () => {
    const spy = vi.spyOn(api, 'createCheckoutSession');
    renderWithProviders(<PricingPage />, { user: adminWithSentinels() });
    for (const id of ['select-basic-btn', 'select-pro-btn', 'select-ultra-btn']) {
      const btn = screen.getByTestId(id) as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
      fireEvent.click(btn);
    }
    expect(spy).not.toHaveBeenCalled();
    expect(screen.getByTestId('select-ultra-btn').textContent).toMatch(/Current Plan/);
    expect(screen.getByTestId('admin-plan-note').textContent).toMatch(/Administrator/);
  });

  it('PricingPage: Vietnamese admin sees "Không giới hạn"', async () => {
    await i18n.changeLanguage('vi');
    renderWithProviders(<PricingPage />, { user: adminWithSentinels() });
    expect(screen.getByTestId('current-plan-banner').textContent).toContain('Không giới hạn');
  });

  it('PricingPage: non-admin Pro user still has an enabled Ultra upgrade', () => {
    renderWithProviders(<PricingPage />, { user: makeUser('user', 'pro', { billing_cycle: 'annual' }) });
    expect((screen.getByTestId('select-ultra-btn') as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByTestId('admin-plan-note')).toBeNull();
  });

  it('SettingsPage: admin quota line is Unlimited and no upgrade CTA', async () => {
    renderWithProviders(<SettingsPage />, { user: adminWithSentinels() });
    const line = await screen.findByTestId('settings-quota-line');
    expect(line.textContent).toContain('Unlimited');
    expect(line.textContent).not.toMatch(/9999/);
    expect(screen.queryByTestId('settings-upgrade-plan-btn')).toBeNull();
    expect(screen.getByTestId('settings-admin-plan-note')).toBeDefined();
  });

  it('SettingsPage: Basic user still sees numeric quota and upgrade CTA', async () => {
    renderWithProviders(<SettingsPage />, { user: makeUser('user', 'basic') });
    const line = await screen.findByTestId('settings-quota-line');
    expect(line.textContent).toContain('1/3');
    expect(screen.getByTestId('settings-upgrade-plan-btn')).toBeDefined();
  });

  it('AppLayout sidebar quota meter shows Unlimited for admin', async () => {
    renderWithProviders(
      <AppLayout>
        <div />
      </AppLayout>,
      { user: adminWithSentinels() },
    );
    await waitFor(() =>
      expect(screen.getByTestId('sidebar-quota-text').textContent).toBe('Unlimited'),
    );
  });
});
