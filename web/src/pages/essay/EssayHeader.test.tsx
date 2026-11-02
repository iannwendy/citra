import { describe, it, expect, vi, beforeEach } from 'vitest';
import { api } from '@/api/client';
import i18n from '@/i18n';
import { renderWithProviders, makeUser, screen, fireEvent, waitFor } from '@/test-utils';
import { EssayHeader } from './EssayHeader';
import { BibliographyRemediationModal } from '@/components/BibliographyRemediationModal';

function renderHeader(user = makeUser('user', 'basic'), filename = 'thesis.pdf') {
  return renderWithProviders(
    <EssayHeader essayId={42} filename={filename} numPages={8} numCitations={12} styleName="APA" />,
    { user },
  );
}

describe('EssayHeader export controls (plan-based, not role-based)', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage('en');
  });

  it('Pro student sees all four export formats unlocked', () => {
    renderHeader(makeUser('user', 'pro'));
    for (const fmt of ['json', 'csv', 'pdf', 'docx']) {
      const btn = screen.getByTestId(`export-${fmt}-btn`);
      expect(btn.getAttribute('data-locked')).toBe('false');
    }
  });

  it('Ultra student downloads CSV directly via the API (no upgrade modal)', async () => {
    const spy = vi.spyOn(api, 'downloadReportFile').mockResolvedValue(undefined);
    renderHeader(makeUser('user', 'ultra'));
    fireEvent.click(screen.getByTestId('export-csv-btn'));
    await waitFor(() => expect(spy).toHaveBeenCalledWith(42, 'csv', 'thesis.pdf'));
    expect(screen.queryByTestId('upgrade-modal')).toBeNull();
  });

  it('Basic student can export JSON but CSV/PDF/DOCX are locked and open the UpgradeModal', async () => {
    const spy = vi.spyOn(api, 'downloadReportFile').mockResolvedValue(undefined);
    renderHeader(makeUser('user', 'basic'));
    expect(screen.getByTestId('export-json-btn').getAttribute('data-locked')).toBe('false');
    for (const fmt of ['csv', 'pdf', 'docx']) {
      expect(screen.getByTestId(`export-${fmt}-btn`).getAttribute('data-locked')).toBe('true');
    }
    fireEvent.click(screen.getByTestId('export-csv-btn'));
    await waitFor(() => expect(screen.getByTestId('upgrade-modal')).toBeDefined());
    expect(spy).not.toHaveBeenCalled();
  });

  it('shows an error toast and clears the loading state when a download fails', async () => {
    let reject: (e: Error) => void = () => {};
    vi.spyOn(api, 'downloadReportFile').mockImplementation(
      () => new Promise<void>((_, rej) => (reject = rej)),
    );
    renderHeader(makeUser('teacher'));
    const btn = screen.getByTestId('export-pdf-btn');
    fireEvent.click(btn);
    await waitFor(() => expect(btn.getAttribute('aria-busy')).toBe('true'));
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    reject(new Error('API 500: boom'));
    await waitFor(() => expect(screen.getByText('Export failed')).toBeDefined());
    await waitFor(() => expect(btn.getAttribute('aria-busy')).toBe('false'));
  });

  it('disables Auto-Healed .DOCX for PDF uploads with an explanatory tooltip', () => {
    const spy = vi.spyOn(api, 'downloadAutoHealedDocx').mockResolvedValue(undefined);
    renderHeader(makeUser('user', 'pro'), 'paper.pdf');
    const btn = screen.getByTestId('export-healed-docx-btn') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('title')).toMatch(/only available for essays uploaded as \.docx/i);
    expect(screen.getByRole('tooltip').textContent).toMatch(/\.docx/);
    fireEvent.click(btn);
    expect(spy).not.toHaveBeenCalled();
  });

  it('enables Auto-Healed .DOCX for .docx uploads and picks the IEEE style when relevant', async () => {
    const spy = vi.spyOn(api, 'downloadAutoHealedDocx').mockResolvedValue(undefined);
    renderWithProviders(
      <EssayHeader essayId={7} filename="Essay.DOCX" numPages={3} numCitations={4} styleName="IEEE" />,
      { user: makeUser('user', 'pro') },
    );
    const btn = screen.getByTestId('export-healed-docx-btn') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    await waitFor(() => expect(spy).toHaveBeenCalledWith(7, 'ieee', 'Essay.DOCX'));
  });

  it('Basic student clicking Auto-Healed on a .docx upload sees the UpgradeModal', async () => {
    const spy = vi.spyOn(api, 'downloadAutoHealedDocx').mockResolvedValue(undefined);
    renderHeader(makeUser('user', 'basic'), 'essay.docx');
    fireEvent.click(screen.getByTestId('export-healed-docx-btn'));
    await waitFor(() => expect(screen.getByTestId('upgrade-modal')).toBeDefined());
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('BibliographyRemediationModal Auto-Healed .DOCX', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(api, 'getRemediatedBibliography').mockResolvedValue({
      essay_id: 1,
      style: 'apa',
      entries: [],
      combined_text: '',
      combined_bibtex: '',
      combined_ris: '',
    } as never);
  });

  it('disables the healed export with a hint for PDF essays', async () => {
    const spy = vi.spyOn(api, 'downloadAutoHealedDocx').mockResolvedValue(undefined);
    renderWithProviders(
      <BibliographyRemediationModal open essayId={1} filename="a.pdf" lang="en" onClose={() => {}} />,
    );
    const btn = (await screen.findByTestId('download-auto-healed-docx-btn')) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(screen.getByTestId('auto-healed-docx-hint').textContent).toMatch(/\.docx/);
    fireEvent.click(btn);
    expect(spy).not.toHaveBeenCalled();
  });

  it('shows an inline error when the healed export fails for a .docx essay', async () => {
    vi.spyOn(api, 'downloadAutoHealedDocx').mockRejectedValue(new Error('API 400: nope'));
    renderWithProviders(
      <BibliographyRemediationModal open essayId={1} filename="a.docx" lang="en" onClose={() => {}} />,
    );
    const btn = (await screen.findByTestId('download-auto-healed-docx-btn')) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    await waitFor(() =>
      expect(screen.getByTestId('auto-healed-docx-error').textContent).toMatch(/API 400/),
    );
  });
});
