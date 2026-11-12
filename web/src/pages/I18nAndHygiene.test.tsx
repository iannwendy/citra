import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Routes, Route } from 'react-router-dom';
import { api } from '@/api/client';
import i18n from '@/i18n';
import { renderWithProviders, makeUser, screen, fireEvent, waitFor } from '@/test-utils';
import { makeReport, makeVerdict } from '@/test-fixtures';
import { OrphanDetectionPage } from './OrphanDetectionPage';
import { MyClassesPage } from './MyClassesPage';
import { EssayPage } from './EssayPage';
import { SettingsPage } from './SettingsPage';
import { LiveCitationSandbox } from '@/components/LiveCitationSandbox';
import { SubtleNumber } from '@/components/ui/transitions';

describe('Bilingual Completeness & Runtime Test Hygiene (BUG-10b & BUG-11)', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage('en');
  });

  it('OrphanDetectionPage renders Vietnamese badges and summary labels when language is vi', async () => {
    await i18n.changeLanguage('vi');
    const report = makeReport({
      verdicts: [
        makeVerdict({
          citation_id: 'v1',
          citation_raw: 'Smith et al. (2024)',
          label: 'suspected_hallucination',
          mapping_status: 'missing_reference',
          citation_link: undefined,
          citation_links: [],
        }),
      ],
      references: [
        {
          reference_id: 'ref-1',
          raw_text: 'Vaswani, A. et al. (2017). Attention Is All You Need.',
          cited_in_text: false,
        } as never,
      ],
    });
    vi.spyOn(api, 'getEssay').mockResolvedValue(report);

    const { container } = renderWithProviders(
      <Routes>
        <Route path="/verification/report/:id/consistency" element={<OrphanDetectionPage />} />
      </Routes>,
      {
        user: makeUser('teacher', 'pro'),
        initialRoute: '/verification/report/42/consistency',
      },
    );

    await waitFor(() => expect(screen.getByText('Smith et al. (2024)')).toBeDefined());
    expect(container.textContent).toContain('Nhất quán Trích dẫn ·');
    expect(container.textContent).not.toContain('entries analyzed');
    expect(container.textContent).not.toContain('No Reference');
  });

  it('MyClassesPage localizes ACTIVE COHORTS and cohorts in Vietnamese', async () => {
    await i18n.changeLanguage('vi');
    vi.spyOn(api, 'getTeacherDashboard').mockResolvedValue({
      total_classes: 2,
      total_students: 35,
      total_essays: 18,
      pending_reviews: 3,
      classes: [
        { id: 1, name: 'KLTN K26', join_code: 'CITRA1', student_count: 20, essay_count: 10 },
        { id: 2, name: 'NCKH K27', join_code: 'CITRA2', student_count: 15, essay_count: 8 },
      ] as never,
    });

    const { container } = renderWithProviders(<MyClassesPage />, {
      user: makeUser('teacher', 'pro'),
    });

    await waitFor(() => expect(screen.getByText('KLTN K26')).toBeDefined());
    expect(container.textContent).toContain('2 LỚP ĐANG HOẠT ĐỘNG');
    expect(container.textContent).toContain('2 lớp học');
    expect(container.textContent).not.toContain('ACTIVE COHORTS');
    expect(container.textContent).not.toContain('2 cohorts');
  });

  it('EssayPage localizes filter chips, confidence label, and Metadata Diff table in VI while preserving EN', async () => {
    const report = makeReport({
      verdicts: [
        makeVerdict({
          citation_id: 'v1',
          citation_raw: '[1] Fake Paper (2025)',
          label: 'suspected_hallucination',
          matched_sources: [],
        }),
      ],
    });
    vi.spyOn(api, 'getEssay').mockResolvedValue(report);

    await i18n.changeLanguage('vi');
    const { container, unmount } = renderWithProviders(
      <Routes>
        <Route path="/verification/report/:id" element={<EssayPage />} />
      </Routes>,
      {
        user: makeUser('teacher', 'pro'),
        initialRoute: '/verification/report/42',
      },
    );

    await waitFor(() => expect(screen.getAllByText(/Fake Paper/).length).toBeGreaterThan(0));
    expect(container.textContent).toContain('Tất cả (1)');
    expect(container.textContent).toContain('✕ Bịa đặt (1)');
    expect(container.textContent).toContain('Độ tin cậy:');
    expect(container.textContent).toContain('Trích dẫn trong bài');
    expect(container.textContent).toContain('Bản ghi chuẩn truy xuất');
    expect(container.textContent).toContain('Không tìm thấy bản ghi chuẩn');
    expect(container.textContent).not.toContain('Cited in Manuscript');
    expect(container.textContent).not.toContain('No canonical record found');
    unmount();

    await i18n.changeLanguage('en');
    const { container: enContainer } = renderWithProviders(
      <Routes>
        <Route path="/verification/report/:id" element={<EssayPage />} />
      </Routes>,
      {
        user: makeUser('teacher', 'pro'),
        initialRoute: '/verification/report/42',
      },
    );
    await waitFor(() => expect(screen.getAllByText(/Fake Paper/).length).toBeGreaterThan(0));
    expect(enContainer.textContent).toContain('All (1)');
    expect(enContainer.textContent).toContain('Cited in Manuscript');
    expect(enContainer.textContent).toContain('No canonical record found');
  });

  it('SettingsPage localizes API key usage status and Copy button in VI', async () => {
    await i18n.changeLanguage('vi');
    vi.spyOn(api, 'getMySubscription').mockResolvedValue({
      subscription: null,
      transactions: [],
    } as never);
    vi.spyOn(api, 'listApiKeys').mockResolvedValue([
      {
        id: 1,
        name: 'Lab CI Key',
        key_prefix: 'citra_live_',
        created_at: '2026-11-01T00:00:00Z',
        last_used_at: null,
      } as never,
    ]);

    const { container } = renderWithProviders(<SettingsPage />, {
      user: makeUser('teacher', 'pro'),
    });

    await waitFor(() => expect(screen.getByText('Lab CI Key')).toBeDefined());
    expect(container.textContent).toContain('Chưa từng dùng');
    expect(container.textContent).not.toContain('Never used');
  });

  it('LiveCitationSandbox passes active UI language to api.verifySandboxCitationsInstant', async () => {
    await i18n.changeLanguage('en');
    vi.spyOn(api, 'sampleSandboxAclPapers').mockResolvedValue({
      count: 1,
      style: 'apa',
      database_total_papers: 128000,
      items: [
        {
          index: 0,
          title: 'Attention Is All You Need',
          authors: ['Ashish Vaswani'],
          authors_text: 'Vaswani, A.',
          year: '2017',
          venue: 'NeurIPS',
          doi: '',
          cite_in_text: true,
          include_in_references: true,
          in_text_year_override: '',
          in_text_context: '',
        },
      ],
    });
    const verifySpy = vi.spyOn(api, 'verifySandboxCitationsInstant').mockResolvedValue({
      elapsed_seconds: 0.12,
      total: 1,
      summary: {
        verified: 1,
        metadata_error: 0,
        suspected_hallucination: 0,
        layer1_linking_issues: 0,
      },
      results: [],
    });

    renderWithProviders(<LiveCitationSandbox />, {
      user: makeUser('user', 'pro'),
    });

    fireEvent.click(screen.getByTestId('sandbox-mode-raw-btn'));
    const btn = await screen.findByTestId('sandbox-verify-submit-btn');
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(btn);

    await waitFor(() => expect(verifySpy).toHaveBeenCalledTimes(1));
    expect(verifySpy.mock.calls[0]?.[0]).toMatchObject({ lang: 'en' });
  });

  it('SubtleNumber updates synchronously in test mode without triggering act(...) warnings', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container, rerender } = renderWithProviders(<SubtleNumber value={42} suffix="%" />);
    expect(container.querySelector('.t-subtle-number')?.textContent).toContain('42%');

    rerender(<SubtleNumber value={98.6} suffix="%" />);
    expect(container.querySelector('.t-subtle-number')?.textContent).toContain('98.6%');

    await new Promise((r) => setTimeout(r, 280));
    const actWarnings = errSpy.mock.calls.filter((args) =>
      String(args[0] ?? '').includes('not wrapped in act'),
    );
    expect(actWarnings).toHaveLength(0);
  });
});
