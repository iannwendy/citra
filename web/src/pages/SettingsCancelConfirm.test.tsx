import { describe, it, expect, vi, beforeEach } from 'vitest';
import { api } from '@/api/client';
import i18n from '@/i18n';
import { renderWithProviders, makeUser, QUOTA_BY_TIER, screen, fireEvent, waitFor } from '@/test-utils';
import { SettingsPage } from './SettingsPage';
import { ProfilePage } from './ProfilePage';

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

  it('portals Delete Account modal to document.body with !mt-0, disables confirm until password entered, and preserves accessible switch & input sizing', async () => {
    renderWithProviders(<SettingsPage />, { user: proUser() });

    // Accessible notification switch and mobile-safe non-crushed API key input
    const notifSwitch = await screen.findByRole('switch');
    expect(notifSwitch.getAttribute('aria-label')).toBeTruthy();

    const apiKeyInput = screen.getByTestId('api-key-name-input');
    expect(apiKeyInput.getAttribute('aria-label')).toBeTruthy();
    expect(apiKeyInput.className).toContain('min-h-[44px]');

    // Open Delete Account modal
    fireEvent.click(screen.getByTestId('settings-delete-account-btn'));
    const modal = await screen.findByTestId('delete-account-modal');
    expect(modal.parentElement).toBe(document.body);
    expect(modal.className).toContain('!mt-0');

    const confirmBtn = screen.getByTestId('delete-account-confirm-btn') as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(true);

    fireEvent.change(screen.getByTestId('delete-account-password-input'), {
      target: { value: 'Secret123!' },
    });
    expect(confirmBtn.disabled).toBe(false);

    // Explicit role="dialog" & aria-modal="true" on Delete Account modal panel + font-solva-serif H1
    const panel = screen.getByTestId('delete-account-dialog-panel');
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.getAttribute('aria-modal')).toBe('true');
    const settingsH1 = screen.getByRole('heading', { level: 1 });
    expect(settingsH1.className).toContain('font-solva-serif');
    expect(settingsH1.className).toContain('font-normal');
    expect(settingsH1.className).not.toContain('font-bold');
  });

  it('Loop Round 2: ConfirmationModal sets aria-modal="true" and ProfilePage shows "Sinh viên" in VI with font-solva-serif H1', async () => {
    const { unmount } = renderWithProviders(<SettingsPage />, { user: proUser() });
    fireEvent.click(await screen.findByTestId('settings-cancel-sub-btn'));
    const cancelDialog = await screen.findByRole('dialog');
    expect(cancelDialog.getAttribute('aria-modal')).toBe('true');
    unmount();

    await i18n.changeLanguage('vi');
    vi.spyOn(api, 'listEnrolledClasses').mockResolvedValue([]);
    renderWithProviders(<ProfilePage />, { user: makeUser('user', 'ultra') });

    const profileH1 = screen.getByRole('heading', { level: 1 });
    expect(profileH1.className).toContain('font-solva-serif');
    expect(profileH1.className).toContain('font-normal');
    expect(profileH1.className).not.toContain('font-bold');

    const roleValue = screen.getByTestId('profile-role-value');
    expect(roleValue.textContent).toBe('Sinh viên');
    expect(roleValue.className).not.toContain('capitalize');
  });
});
