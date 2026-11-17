import { describe, it, expect, vi, beforeEach } from 'vitest';
import { api, type EssaySummary } from '@/api/client';
import i18n from '@/i18n';
import { renderWithProviders, makeUser, screen, fireEvent, waitFor } from '@/test-utils';
import { DashboardPage } from './DashboardPage';
import { HistoryPage } from './HistoryPage';

const SORT_FIXTURE_ESSAYS: EssaySummary[] = [
  {
    id: 117,
    filename: 'essay_02_mixed.pdf',
    num_pages: 2,
    uploaded_at: '2026-11-15T12:00:00Z',
    user_id: 1,
    cis_score: 72,
    num_citations: 18,
    num_verdicts: 18,
    num_verified: 13,
    job_status: 'completed',
  },
  {
    id: 119,
    filename: 'VietDepression_PLOS_ONE.pdf',
    num_pages: 20,
    uploaded_at: '2026-11-16T09:30:00Z',
    user_id: 1,
    cis_score: 99,
    num_citations: 45,
    num_verdicts: 45,
    num_verified: 44,
    job_status: 'completed',
  },
  {
    id: 114,
    filename: '096_uit_vnuhcm_Capstone.pdf',
    num_pages: 8,
    uploaded_at: '2026-11-14T15:00:00Z',
    user_id: 1,
    cis_score: 0,
    num_citations: 12,
    num_verdicts: 12,
    num_verified: 0,
    job_status: 'completed',
  },
  {
    id: 113,
    filename: 'TranThanhPhuoc_523H0002.pdf',
    num_pages: 98,
    uploaded_at: '2026-11-12T08:00:00Z',
    user_id: 1,
    cis_score: 85,
    num_citations: 64,
    num_verdicts: 64,
    num_verified: 54,
    job_status: 'completed',
  },
  {
    id: 120,
    filename: 'Broken_Scan_Upload.pdf',
    num_pages: 50,
    uploaded_at: '2026-11-13T10:00:00Z',
    user_id: 1,
    cis_score: null,
    num_citations: 0,
    num_verdicts: 0,
    num_verified: 0,
    job_status: 'failed',
    quota_charged: false,
  },
];

function getDashboardRowFilenames(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll<HTMLAnchorElement>('[data-testid^="dashboard-essay-link-"]'),
  ).map((el) => el.textContent?.trim() ?? '');
}

function getHistoryCardFilenames(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-testid="essay-item"]')).map(
    (card) => card.querySelector('p[title]')?.getAttribute('title') ?? '',
  );
}

describe('DashboardPage & HistoryPage document sorting', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage('en');
    vi.spyOn(api, 'listEssays').mockResolvedValue(SORT_FIXTURE_ESSAYS);
    vi.spyOn(api, 'getEssayStats').mockResolvedValue({
      total_essays: 5,
      total_citations: 139,
      verified: 111,
      metadata_error: 18,
      suspected_hallucination: 6,
      unresolved: 4,
      resource: 0,
    });
  });

  it('sorts DashboardPage rows via dropdown across date, alphabet, CIS, and pages while combining with search', async () => {
    const { container } = renderWithProviders(<DashboardPage />, {
      user: makeUser('admin'),
    });

    await waitFor(() =>
      expect(getDashboardRowFilenames(container)).toEqual([
        'VietDepression_PLOS_ONE.pdf',
        'essay_02_mixed.pdf',
        '096_uit_vnuhcm_Capstone.pdf',
        'Broken_Scan_Upload.pdf',
        'TranThanhPhuoc_523H0002.pdf',
      ]),
    );

    const sortSelect = screen.getByTestId('essay-sort-select') as HTMLSelectElement;
    expect(sortSelect.value).toBe('date_desc');

    // Alphabet A -> Z
    fireEvent.change(sortSelect, { target: { value: 'name_asc' } });
    expect(getDashboardRowFilenames(container)).toEqual([
      '096_uit_vnuhcm_Capstone.pdf',
      'Broken_Scan_Upload.pdf',
      'essay_02_mixed.pdf',
      'TranThanhPhuoc_523H0002.pdf',
      'VietDepression_PLOS_ONE.pdf',
    ]);

    // Alphabet Z -> A
    fireEvent.change(sortSelect, { target: { value: 'name_desc' } });
    expect(getDashboardRowFilenames(container)).toEqual([
      'VietDepression_PLOS_ONE.pdf',
      'TranThanhPhuoc_523H0002.pdf',
      'essay_02_mixed.pdf',
      'Broken_Scan_Upload.pdf',
      '096_uit_vnuhcm_Capstone.pdf',
    ]);

    // CIS High -> Low (99, 85, 72, 0, then failed null last)
    fireEvent.change(sortSelect, { target: { value: 'cis_desc' } });
    expect(getDashboardRowFilenames(container)).toEqual([
      'VietDepression_PLOS_ONE.pdf',
      'TranThanhPhuoc_523H0002.pdf',
      'essay_02_mixed.pdf',
      '096_uit_vnuhcm_Capstone.pdf',
      'Broken_Scan_Upload.pdf',
    ]);

    // CIS Low -> High (0/100 first, 72, 85, 99, and failed null STILL last)
    fireEvent.change(sortSelect, { target: { value: 'cis_asc' } });
    expect(getDashboardRowFilenames(container)).toEqual([
      '096_uit_vnuhcm_Capstone.pdf',
      'essay_02_mixed.pdf',
      'TranThanhPhuoc_523H0002.pdf',
      'VietDepression_PLOS_ONE.pdf',
      'Broken_Scan_Upload.pdf',
    ]);

    // Date Oldest -> Newest
    fireEvent.change(sortSelect, { target: { value: 'date_asc' } });
    expect(getDashboardRowFilenames(container)).toEqual([
      'TranThanhPhuoc_523H0002.pdf',
      'Broken_Scan_Upload.pdf',
      '096_uit_vnuhcm_Capstone.pdf',
      'essay_02_mixed.pdf',
      'VietDepression_PLOS_ONE.pdf',
    ]);

    // Pages Most -> Fewest (98, 50, 20, 8, 2)
    fireEvent.change(sortSelect, { target: { value: 'pages_desc' } });
    expect(getDashboardRowFilenames(container)).toEqual([
      'TranThanhPhuoc_523H0002.pdf',
      'Broken_Scan_Upload.pdf',
      'VietDepression_PLOS_ONE.pdf',
      '096_uit_vnuhcm_Capstone.pdf',
      'essay_02_mixed.pdf',
    ]);

    // Combine active sort (pages_desc) with search filter ("o" matches Broken, VietDepression, Capstone, TranThanhPhuoc)
    const searchInput = screen.getByLabelText('Search documents');
    fireEvent.change(searchInput, { target: { value: 'one' } });
    expect(getDashboardRowFilenames(container)).toEqual([
      'VietDepression_PLOS_ONE.pdf',
      '096_uit_vnuhcm_Capstone.pdf',
    ]);
  });

  it('toggles DashboardPage column header buttons, updates aria-sort, and syncs with sort dropdown', async () => {
    const { container } = renderWithProviders(<DashboardPage />, {
      user: makeUser('admin'),
    });

    await waitFor(() => expect(getDashboardRowFilenames(container)).toHaveLength(5));

    const sortSelect = screen.getByTestId('essay-sort-select') as HTMLSelectElement;
    const nameColBtn = screen.getByTestId('dashboard-sort-col-name');
    const cisColBtn = screen.getByTestId('dashboard-sort-col-cis');
    const dateColBtn = screen.getByTestId('dashboard-sort-col-date');
    const pagesColBtn = screen.getByTestId('dashboard-sort-col-pages');

    expect(dateColBtn.closest('th')?.getAttribute('aria-sort')).toBe('descending');
    expect(nameColBtn.closest('th')?.getAttribute('aria-sort')).toBe('none');

    // Click DOCUMENT header -> name_asc, click again -> name_desc
    fireEvent.click(nameColBtn);
    expect(sortSelect.value).toBe('name_asc');
    expect(nameColBtn.closest('th')?.getAttribute('aria-sort')).toBe('ascending');
    expect(getDashboardRowFilenames(container)[0]).toBe('096_uit_vnuhcm_Capstone.pdf');

    fireEvent.click(nameColBtn);
    expect(sortSelect.value).toBe('name_desc');
    expect(nameColBtn.closest('th')?.getAttribute('aria-sort')).toBe('descending');
    expect(getDashboardRowFilenames(container)[0]).toBe('VietDepression_PLOS_ONE.pdf');

    // Click CIS header -> cis_desc, click again -> cis_asc
    fireEvent.click(cisColBtn);
    expect(sortSelect.value).toBe('cis_desc');
    expect(cisColBtn.closest('th')?.getAttribute('aria-sort')).toBe('descending');
    expect(getDashboardRowFilenames(container).slice(0, 2)).toEqual([
      'VietDepression_PLOS_ONE.pdf',
      'TranThanhPhuoc_523H0002.pdf',
    ]);

    fireEvent.click(cisColBtn);
    expect(sortSelect.value).toBe('cis_asc');
    expect(cisColBtn.closest('th')?.getAttribute('aria-sort')).toBe('ascending');
    expect(getDashboardRowFilenames(container)[0]).toBe('096_uit_vnuhcm_Capstone.pdf');

    // Click PAGES header -> pages_desc
    fireEvent.click(pagesColBtn);
    expect(sortSelect.value).toBe('pages_desc');
    expect(pagesColBtn.closest('th')?.getAttribute('aria-sort')).toBe('descending');
    expect(getDashboardRowFilenames(container)[0]).toBe('TranThanhPhuoc_523H0002.pdf');
  });

  it('sorts HistoryPage archive cards across all criteria, updates sequential #1..#N badges, and localizes in Vietnamese', async () => {
    await i18n.changeLanguage('vi');
    const { container } = renderWithProviders(<HistoryPage />, {
      user: makeUser('teacher', 'pro'),
    });

    await waitFor(() =>
      expect(getHistoryCardFilenames(container)).toEqual([
        'VietDepression_PLOS_ONE.pdf',
        'essay_02_mixed.pdf',
        '096_uit_vnuhcm_Capstone.pdf',
        'Broken_Scan_Upload.pdf',
        'TranThanhPhuoc_523H0002.pdf',
      ]),
    );

    const sortSelect = screen.getByTestId('essay-sort-select') as HTMLSelectElement;
    expect(sortSelect.textContent).toContain('Mới nhất');
    expect(sortSelect.textContent).toContain('Điểm CIS');
    expect(sortSelect.textContent).not.toContain('dashboard.sort');

    // Sort by CIS Low -> High on HistoryPage
    fireEvent.change(sortSelect, { target: { value: 'cis_asc' } });
    expect(getHistoryCardFilenames(container)).toEqual([
      '096_uit_vnuhcm_Capstone.pdf',
      'essay_02_mixed.pdf',
      'TranThanhPhuoc_523H0002.pdf',
      'VietDepression_PLOS_ONE.pdf',
      'Broken_Scan_Upload.pdf',
    ]);

    const firstCard = container.querySelector('[data-testid="essay-item"]');
    expect(firstCard?.textContent).toContain('#1');
    expect(firstCard?.textContent).toContain('096_uit_vnuhcm_Capstone.pdf');

    // Sort by Alphabet A -> Z on HistoryPage
    fireEvent.change(sortSelect, { target: { value: 'name_asc' } });
    expect(getHistoryCardFilenames(container)).toEqual([
      '096_uit_vnuhcm_Capstone.pdf',
      'Broken_Scan_Upload.pdf',
      'essay_02_mixed.pdf',
      'TranThanhPhuoc_523H0002.pdf',
      'VietDepression_PLOS_ONE.pdf',
    ]);
  });
});
