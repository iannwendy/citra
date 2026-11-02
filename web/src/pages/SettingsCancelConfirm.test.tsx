import { describe, it, expect, vi, beforeEach } from 'vitest';
import { api } from '@/api/client';
import i18n from '@/i18n';
import { renderWithProviders, makeUser, QUOTA_BY_TIER, screen, fireEvent, waitFor } from '@/test-utils';
import { SettingsPage } from './SettingsPage';

const proUser = () =>
  makeUser('user', 'pro', { billing_cycle: 'annual', current_period_end: '2027-10-26T00:00:00Z' });

function mockSubscription() {
  vi.spyOn(api, 'getMySubscription').mockResolvedValue({
    subscription: {
      plan_tier: 'pro',
      plan_name: 'Pro',
      billing_cycle: 'annual',
      subscription_status: 'active',
      cancel_at_period_end: false,
      current_period_start: '2026-10-26T00:00:00Z',
      current_period_end: '2027-10-26T00:00:00Z',
      quota: QUOTA_BY_TIER.pro,
    },
    transactions: [],
  } as never);
}

describe('SettingsPage cancel auto-renew confirmation', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage('en');
    mockSubscription();
  });

  it('does not cancel immediately — opens a confirmation dialog first', async () => {
    const cancelSpy = vi.spyOn(api, 'cancelSubscription');
    renderWithProviders(<SettingsPage />, { user: proUser() });
    fireEvent.click(await screen.findByTestId('settings-cancel-sub-btn'));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toMatch(/Turn off auto-renewal\?/);
    expect(dialog.textContent).toMatch(/PRO plan will not renew/);
    expect(cancelSpy).not.toHaveBeenCalled();
  });

  it('"Keep my plan" closes the dialog without calling the API', async () => {
    const cancelSpy = vi.spyOn(api, 'cancelSubscription');
    renderWithProviders(<SettingsPage />, { user: proUser() });
    fireEvent.click(await screen.findByTestId('settings-cancel-sub-btn'));
    fireEvent.click(await screen.findByTestId('confirmation-cancel-btn'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(cancelSpy).not.toHaveBeenCalled();
  });

  it('confirming calls cancelSubscription(false) once', async () => {
    const cancelSpy = vi.spyOn(api, 'cancelSubscription').mockResolvedValue({
      message: 'ok',
      subscription: { cancel_at_period_end: true, plan_tier: 'pro', quota: QUOTA_BY_TIER.pro },
    } as never);
    renderWithProviders(<SettingsPage />, { user: proUser() });
    fireEvent.click(await screen.findByTestId('settings-cancel-sub-btn'));
    fireEvent.click(await screen.findByTestId('confirmation-confirm-btn'));
    await waitFor(() => expect(cancelSpy).toHaveBeenCalledTimes(1));
    expect(cancelSpy).toHaveBeenCalledWith(false);
  });

  it('dialog is localized in Vietnamese', async () => {
    await i18n.changeLanguage('vi');
    renderWithProviders(<SettingsPage />, { user: proUser() });
    fireEvent.click(await screen.findByTestId('settings-cancel-sub-btn'));
    expect((await screen.findByRole('dialog')).textContent).toMatch(/Tắt tự động gia hạn\?/);
  });

  it('allows Pro user to create, view, and revoke personal API keys (X-API-Key)', async () => {
    vi.spyOn(api, 'listApiKeys').mockResolvedValue([]);
    const createSpy = vi.spyOn(api, 'createApiKey').mockResolvedValue({
      id: 7,
      name: 'Zotero Automation',
      key_prefix: 'citra_live_abc12',
      raw_key: 'citra_live_abc1234567890secret',
      created_at: '2026-11-02T10:00:00Z',
      last_used_at: null,
      is_active: true,
    });
    const revokeSpy = vi.spyOn(api, 'revokeApiKey').mockResolvedValue({
      message: 'API key revoked',
      id: 7,
    });

    renderWithProviders(<SettingsPage />, { user: proUser() });
    const input = await screen.findByTestId('api-key-name-input');
    fireEvent.change(input, { target: { value: 'Zotero Automation' } });
    fireEvent.click(screen.getByTestId('create-api-key-btn'));

    await waitFor(() => expect(createSpy).toHaveBeenCalledWith('Zotero Automation'));
    const secretEl = await screen.findByTestId('created-api-key-secret');
    expect(secretEl.textContent).toBe('citra_live_abc1234567890secret');

    const revokeBtn = await screen.findByTestId('revoke-api-key-btn-7');
    fireEvent.click(revokeBtn);
    await waitFor(() => expect(revokeSpy).toHaveBeenCalledWith(7));
  });
});
