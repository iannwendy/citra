import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { api } from '@/api/client';
import i18n from '@/i18n';
import { renderWithProviders, makeUser } from '@/test-utils';
import { useModalA11y } from './useModalA11y';
import { BibliographyRemediationModal } from '@/components/BibliographyRemediationModal';
import { GoogleOnboardingModal } from '@/components/GoogleOnboardingModal';
import { UpgradeModal } from '@/components/UpgradeModal';
import { Routes, Route } from 'react-router-dom';
import { StripeDemoCheckoutPage } from '@/pages/StripeDemoCheckoutPage';

function Harness({ withInputs = true }: { withInputs?: boolean }) {
  const [open, setOpen] = useState(false);
  const { dialogProps, titleId } = useModalA11y<HTMLDivElement>(open, () => setOpen(false));
  return (
    <div>
      <button onClick={() => setOpen(true)}>open</button>
      {open && (
        <div {...dialogProps} data-testid="dlg">
          <h2 id={titleId}>Dialog title</h2>
          {withInputs && (
            <>
              <button>first</button>
              <input aria-label="middle" />
              <button>last</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

describe('useModalA11y', () => {
  it('exposes dialog semantics wired to the title', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('open'));
    const dlg = screen.getByRole('dialog');
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByRole('dialog', { name: 'Dialog title' })).toBe(dlg);
  });

  it('moves focus into the dialog on open and restores it on close', async () => {
    render(<Harness />);
    const opener = screen.getByText('open');
    opener.focus();
    fireEvent.click(opener);
    expect(document.activeElement).toBe(screen.getByText('first'));
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(opener);
  });

  it('traps Tab and Shift+Tab inside the dialog', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('open'));
    const first = screen.getByText('first');
    const last = screen.getByText('last');
    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('focuses the container itself when it has no focusable children', () => {
    render(<Harness withInputs={false} />);
    fireEvent.click(screen.getByText('open'));
    expect(document.activeElement).toBe(screen.getByTestId('dlg'));
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByTestId('dlg'));
  });
});

describe('custom modals are accessible dialogs', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    sessionStorage.clear();
    await i18n.changeLanguage('en');
  });

  it('BibliographyRemediationModal: role/aria + Escape closes', async () => {
    vi.spyOn(api, 'getRemediatedBibliography').mockResolvedValue({
      essay_id: 1, style: 'apa', total_entries: 0, remediated_count: 0,
      entries: [], combined_text: '', combined_bibtex: '', combined_ris: '',
    });
    const onClose = vi.fn();
    renderWithProviders(
      <BibliographyRemediationModal open essayId={1} filename="a.docx" lang="en" onClose={onClose} />,
    );
    const dlg = await screen.findByRole('dialog', { name: /Bibliography Auto-Remediation/ });
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('GoogleOnboardingModal: labelled dialog, Escape dismisses', async () => {
    renderWithProviders(<GoogleOnboardingModal />, {
      user: makeUser('user', 'basic', { needs_onboarding: true } as never),
      initialRoute: '/dashboard',
    });
    const dlg = await screen.findByRole('dialog', { name: /Complete your CITRA profile/ });
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('UpgradeModal (Radix) is a labelled modal dialog and closes on Escape', async () => {
    const onOpenChange = vi.fn();
    renderWithProviders(
      <UpgradeModal open onOpenChange={onOpenChange} reasonTitle="Unlock exports" />,
    );
    const dlg = await screen.findByRole('dialog', { name: 'Unlock exports' });
    expect(dlg).toBeDefined();
    fireEvent.keyDown(dlg, { key: 'Escape' });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('StripeDemoCheckoutPage wallet sheet: labelled dialog, focus moves in, Escape closes', async () => {
    vi.spyOn(api, 'getCheckoutSessionDetails').mockResolvedValue({
      session_id: 'cs_test_a11y',
      status: 'pending',
      payment_mode: 'stripe_demo',
      merchant_name: 'CITRA (SourceLogic) Inc.',
      customer_email: 's@x.vn',
      customer_name: 'S',
      plan_tier: 'pro',
      plan_name: 'CITRA Pro',
      billing_cycle: 'annual',
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
    } as never);
    renderWithProviders(
      <Routes>
        <Route path="/billing/checkout" element={<StripeDemoCheckoutPage />} />
      </Routes>,
      { user: makeUser('user', 'basic'), initialRoute: '/billing/checkout?session_id=cs_test_a11y' },
    );
    const trigger = await screen.findByTestId('express-apple-pay-btn');
    trigger.focus();
    fireEvent.click(trigger);
    const dlg = await screen.findByRole('dialog', { name: /Apple Pay/ });
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    expect(dlg.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('wallet-payment-modal')).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });
});
