import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Routes, Route } from 'react-router-dom';
import { api, type SharedEssayReport, type PendingVerdict } from '@/api/client';
import i18n from '@/i18n';
import { APP_VERSION } from '@/version';
import { renderWithProviders, makeUser, screen, fireEvent, waitFor } from '@/test-utils';
import { makeVerdict } from '@/test-fixtures';
import {
  formatCisScore,
  formatLocalizedDate,
  formatLocalizedDateTime,
  formatUserError,
  getVerdictDisplay,
  normalizeVerdictKey,
} from '@/lib/academicTaxonomy';
import { filterTopCitationIssueRules } from '@/lib/teacherGuidance';
import { VerdictBadge } from '@/components/VerdictBadge';
import { DecisionSupportBanner } from '@/components/DecisionSupportBanner';
import { AuthSplitShell } from '@/components/AuthSplitShell';
import { OverrideControls } from '@/components/OverrideControls';
import {
  BibliographyRemediationModal,
  deduplicateRepeatedVenue,
} from '@/components/BibliographyRemediationModal';
import { LoginPage } from '@/pages/LoginPage';
import { RegisterPage } from '@/pages/RegisterPage';
import { SharedReportPage } from '@/pages/SharedReportPage';
import { LandingPage } from '@/pages/LandingPage';
import { MyClassesPage } from '@/pages/MyClassesPage';
import { PendingReviewsPage } from '@/pages/PendingReviewsPage';
import { useToast } from '@/contexts/ToastContext';

const SRC_ROOT = path.resolve(__dirname, '..');

function makeSharedReportFixture(
  overrides: Partial<SharedEssayReport> = {},
): SharedEssayReport {
  return {
    essay_id: 404,
    filename: 'Capstone_Thesis_2026.pdf',
    created_at: '2026-11-27T06:00:00Z',
    num_pages: 18,
    num_citations: 12,
    cis: {
      score: 91.5,
      components: {
        verified_ratio: 0.9,
        metadata_accuracy: 0.95,
        in_text_bib_consistency: 0.92,
        format_consistency: 0.9,
        identifier_validity: 0.9,
      },
      weights_used: {},
      num_citations: 12,
      num_unresolved: 0,
      disclaimer: 'Decision support notice.',
    },
    style_profile: {
      style: 'APA_LIKE',
      confidence: 0.96,
      apa_count: 12,
      ieee_count: 0,
      mixed_count: 0,
      features: {},
      ratios: {},
      explanation: 'Consistent APA formatting',
    },
    receipt_id: 'CITRA-2026-AB12',
    share_token: 'valid-token-123',
    signature_prefix: 'a1b2c3d4',
    verified_at: '2026-11-27T06:30:00Z',
    disclaimer:
      'Academic review notice: CITRA supports human verification and does not conclude misconduct.',
    verdict_counts: {
      verified: 10,
      metadata_error: 1,
      suspected_hallucination: 1,
      unresolved: 0,
      resource: 0,
    },
    verdicts: [
      {
        reference_id: 'ref-1',
        numeric_index: 1,
        raw_text: 'Vaswani, A. et al. (2017). Attention Is All You Need.',
        citation_raw: 'Vaswani, A. et al. (2017). Attention Is All You Need.',
        label: 'verified',
        confidence: 0.98,
        mapping_status: 'matched',
        explanation: 'Matched with canonical record in Crossref.',
        triggered_rules: ['R-DOI-TITLE-AUTHOR'],
        mismatched_fields: [],
        matched_sources: [
          {
            source: 'crossref',
            matched_fields: ['title', 'authors', 'year'],
            checked_at: '2026-11-27T06:30:00Z',
            title: 'Attention Is All You Need',
            authors: ['Ashish Vaswani'],
            year: '2017',
            confidence: 0.98,
          },
        ],
      },
    ],
    ...overrides,
  };
}

function ToastTriggerHarness() {
  const toast = useToast();
  return (
    <button
      type="button"
      data-testid="fire-vi-success-toast"
      onClick={() => toast.success('Đã lưu thay đổi', 'Thông tin đã được cập nhật.')}
    >
      Trigger
    </button>
  );
}

describe('Production Audit Regression Suite (59-bug holistic verification)', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage('en');
  });

  it('1. enforces Unified Academic Taxonomy with zero "Bịa đặt" or raw enum strings across academicTaxonomy & VerdictBadge', async () => {
    const inputs = [
      'VERIFIED',
      'LIKELY_VERIFIED',
      'METADATA_ERROR',
      'SOURCE_MISMATCH',
      'SUSPECTED_HALLUCINATION',
      'HALLUCINATED',
      'UNRESOLVED',
      'UNVERIFIABLE',
      'RESOURCE',
    ];

    for (const lang of ['vi', 'en'] as const) {
      for (const raw of inputs) {
        const display = getVerdictDisplay(raw, lang);
        expect(display.label).not.toMatch(/Bịa đặt|HALLUCINATION|METADATA_ERROR|UNRESOLVED/i);
        expect(display.shortLabel).not.toMatch(/Bịa đặt|HALLUCINATION|METADATA_ERROR/i);
        expect(display.label).not.toContain('_');
      }
    }

    expect(normalizeVerdictKey('HALLUCINATED')).toBe('suspected_hallucination');
    expect(getVerdictDisplay('suspected_hallucination', 'vi').label).toBe('Không tìm thấy nguồn');
    expect(getVerdictDisplay('suspected_hallucination', 'en').label).toBe('Source Not Found');
    expect(getVerdictDisplay('metadata_error', 'vi').label).toBe('Sai lệch thông tin');
    expect(getVerdictDisplay('metadata_error', 'en').label).toBe('Details Mismatch');

    await i18n.changeLanguage('vi');
    const { container: viBox, unmount } = renderWithProviders(
      <div>
        <VerdictBadge verdict="VERIFIED" />
        <VerdictBadge verdict="METADATA_ERROR" />
        <VerdictBadge verdict="SUSPECTED_HALLUCINATION" />
        <VerdictBadge verdict="UNRESOLVED" />
        <VerdictBadge verdict="RESOURCE" />
      </div>,
    );
    expect(viBox.textContent).toContain('Không tìm thấy nguồn');
    expect(viBox.textContent).toContain('Sai lệch thông tin');
    expect(viBox.textContent).not.toContain('Bịa đặt');
    expect(viBox.textContent).not.toContain('HALLUCINATION');
    expect(viBox.textContent).not.toContain('METADATA_ERROR');
    unmount();

    await i18n.changeLanguage('en');
    const { container: enBox } = renderWithProviders(
      <div>
        <VerdictBadge verdict="METADATA_ERROR" />
        <VerdictBadge verdict="SUSPECTED_HALLUCINATION" />
      </div>,
    );
    expect(enBox.textContent).toContain('Details Mismatch');
    expect(enBox.textContent).toContain('Source Not Found');
    expect(enBox.textContent).not.toContain('HALLUCINATION');
    expect(enBox.textContent).not.toContain('METADATA_ERROR');
  });

  it('2. formatUserError strips API 4xx/JSON envelopes and translates common backend errors in VI & EN', () => {
    const cases: Array<{ raw: unknown; expectVi: RegExp; expectEn: RegExp }> = [
      {
        raw: new Error('API 404: {"detail":"Essay not found"}'),
        expectVi: /Không tìm thấy báo cáo này/i,
        expectEn: /Report not found/i,
      },
      {
        raw: new Error('API 401: {"detail":"Invalid username or password"}'),
        expectVi: /Tên đăng nhập\/email hoặc mật khẩu chưa đúng/i,
        expectEn: /Incorrect username\/email or password/i,
      },
      {
        raw: 'API 400: {"detail":"Invalid class join code"}',
        expectVi: /Mã tham gia lớp không đúng/i,
        expectEn: /Invalid class join code/i,
      },
      {
        raw: new Error('API 404: {"detail":"Promo code \'VIP99\' was not found"}'),
        expectVi: /Mã giảm giá không tồn tại hoặc đã hết hạn/i,
        expectEn: /Promo code not found or expired/i,
      },
      {
        raw: new TypeError('Failed to fetch'),
        expectVi: /Không thể kết nối máy chủ/i,
        expectEn: /Unable to reach the server/i,
      },
    ];

    for (const c of cases) {
      const viMsg = formatUserError(c.raw, 'vi');
      const enMsg = formatUserError(c.raw, 'en');
      expect(viMsg).toMatch(c.expectVi);
      expect(enMsg).toMatch(c.expectEn);
      expect(viMsg).not.toMatch(/API \d{3}|\{"detail"/);
      expect(enMsg).not.toMatch(/API \d{3}|\{"detail"/);
    }
  });

  it('3. formatCisScore always formats "XX.X / 100" or "—" (never %) and formatLocalizedDate formats VI DD/MM/YYYY', () => {
    expect(formatCisScore(91.46)).toBe('91.5 / 100');
    expect(formatCisScore(0)).toBe('0.0 / 100');
    expect(formatCisScore(105)).toBe('100.0 / 100');
    expect(formatCisScore(91.46)).not.toContain('%');
    expect(formatCisScore(null)).toBe('—');
    expect(formatCisScore(undefined)).toBe('—');
    expect(formatCisScore(Number.NaN)).toBe('—');
    expect(formatCisScore(88, { isUnscannable: true })).toBe('—');

    expect(formatLocalizedDate('2026-11-27', 'vi')).toBe('27/11/2026');
    expect(formatLocalizedDate('2026-11-27', 'en')).toBe('Nov 27, 2026');
    expect(formatLocalizedDate(null, 'vi')).toBe('—');

    expect(formatLocalizedDateTime('2026-11-27T06:30:00Z', 'vi')).toBe(
      '27/11/2026 · 13:30 (GMT+7)',
    );
  });

  it('4. DecisionSupportBanner renders clean academic review notice in VI & EN without markdown backticks', async () => {
    const { container: enCompact, unmount: u1 } = renderWithProviders(
      <DecisionSupportBanner variant="compact" lang="en" />,
    );
    expect(screen.getByTestId('decision-support-banner').getAttribute('role')).toBe('note');
    expect(enCompact.textContent).toContain('Academic Decision-Support Notice');
    expect(enCompact.textContent).not.toContain('`');
    u1();

    const { container: viCard } = renderWithProviders(
      <DecisionSupportBanner variant="card" lang="vi" />,
    );
    expect(screen.getByTestId('decision-support-banner').getAttribute('role')).toBe('note');
    expect(viCard.textContent).toContain('Công cụ hỗ trợ rà soát học thuật');
    expect(viCard.textContent).toContain('Không tìm thấy nguồn');
    expect(viCard.textContent).not.toContain('`');
  });

  it('5. AuthSplitShell shows CITRA brand + APP_VERSION and zero SourceLogic / symbolic_verifier.py / R01_DOI_MATCH', async () => {
    for (const lng of ['vi', 'en'] as const) {
      await i18n.changeLanguage(lng);
      const { container, unmount } = renderWithProviders(
        <AuthSplitShell>
          <div>Auth Form Slot</div>
        </AuthSplitShell>,
      );
      const text = container.textContent ?? '';
      expect(text).toContain('CITRA');
      expect(text).toContain(`CITRA · v${APP_VERSION}`);
      expect(text).not.toContain('SourceLogic');
      expect(text).not.toContain('symbolic_verifier.py');
      expect(text).not.toContain('R01_DOI_MATCH');
      expect(text).not.toContain('0% np.clip');
      unmount();
    }
  });

  it('6. LoginPage left input icons have z-10 and login preserves safe ?redirect= target', async () => {
    const loginMock = vi.fn().mockResolvedValue(undefined);
    const { container } = renderWithProviders(
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/pricing" element={<div data-testid="redirected-pricing">Pricing Dest</div>} />
      </Routes>,
      {
        user: null,
        initialRoute: '/login?redirect=%2Fpricing',
        authOverrides: { login: loginMock },
      },
    );

    // Redirect notice is shown for ?redirect=/pricing
    expect(screen.getByTestId('login-redirect-banner')).toBeDefined();

    // Left icons inside username and password wrappers carry z-10
    const usernameWrapper = container.querySelector('#username')?.parentElement;
    const passwordWrapper = container.querySelector('#password')?.parentElement;
    const usernameLeftIcon = usernameWrapper?.querySelector('div.pointer-events-none');
    const passwordLeftIcon = passwordWrapper?.querySelector('div.pointer-events-none');
    expect(usernameLeftIcon?.className).toContain('z-10');
    expect(passwordLeftIcon?.className).toContain('z-10');

    // Submitting navigates to preserved ?redirect=/pricing
    fireEvent.change(container.querySelector('#username')!, {
      target: { value: 'student1' },
    });
    fireEvent.change(container.querySelector('#password')!, {
      target: { value: 'Scholar123!' },
    });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(loginMock).toHaveBeenCalledWith('student1', 'Scholar123!');
      expect(screen.getByTestId('redirected-pricing')).toBeDefined();
    });
  });

  it('7. RegisterPage password strength reaches Strong without confirm match and provides confirm password eye toggle', async () => {
    await i18n.changeLanguage('en');
    const { container } = renderWithProviders(<RegisterPage />, {
      user: null,
      initialRoute: '/register',
    });

    const pwInput = container.querySelector('#password') as HTMLInputElement;
    const confirmInput = container.querySelector('#confirm_password') as HTMLInputElement;

    // Strong password with EMPTY confirm_password still scores Strong
    fireEvent.change(pwInput, { target: { value: 'Scholar#2026!Pass' } });
    expect(confirmInput.value).toBe('');
    expect(screen.getByText('Strong')).toBeDefined();

    // Confirm password input starts masked and has its own visibility toggle button
    expect(confirmInput.type).toBe('password');
    const confirmToggle = screen.getByRole('button', { name: /show confirm password/i });
    fireEvent.click(confirmToggle);
    expect(confirmInput.type).toBe('text');
    fireEvent.click(screen.getByRole('button', { name: /hide confirm password/i }));
    expect(confirmInput.type).toBe('password');
  });

  it('8. filterTopCitationIssueRules filters out R-LOCAL_DB_VERIFIED and positive/verified reasons while keeping real issues', () => {
    const rawRules = [
      { rule_id: 'R-LOCAL_DB_VERIFIED', count: 42 },
      { rule_id: 'R-DOI-TITLE-AUTHOR', count: 31 },
      { rule_id: 'R-CONSENSUS-FULL', count: 19 },
      { rule_id: 'R-WELL-LINKED', count: 14 },
      { rule_id: 'R-VN-STANDARD-VERIFIED', count: 7 },
      { rule_id: 'Exact match in Crossref', count: 11 },
      { rule_id: 'Đã xác minh từ bản gốc', count: 9 },
      { rule_id: 'R-YEAR-MISMATCH', count: 8 },
      { rule_id: 'R-HALLUCINATED-SOURCE', count: 3 },
      { rule_id: 'R-INCOMPLETE-METADATA', count: 5 },
      { rule_id: 'R-CHIMERIC-DOI-MISMATCH', count: 2 },
    ];

    const filteredVi = filterTopCitationIssueRules(rawRules, 'vi');
    const filteredEn = filterTopCitationIssueRules(rawRules, 'en');

    expect(filteredVi.map((r) => r.rule_id)).toEqual([
      'R-YEAR-MISMATCH',
      'R-HALLUCINATED-SOURCE',
      'R-INCOMPLETE-METADATA',
      'R-CHIMERIC-DOI-MISMATCH',
    ]);
    expect(filteredEn.map((r) => r.rule_id)).toEqual([
      'R-YEAR-MISMATCH',
      'R-HALLUCINATED-SOURCE',
      'R-INCOMPLETE-METADATA',
      'R-CHIMERIC-DOI-MISMATCH',
    ]);
    for (const item of filteredVi) {
      expect(item.label).not.toMatch(/R-LOCAL_DB_VERIFIED|Bịa đặt|chimeric/i);
    }
    for (const item of filteredEn) {
      expect(item.label).not.toMatch(/chimeric/i);
    }
  });

  it('9. SharedReportPage renders clean non-backtick disclaimer, Print button, Theme toggle, and branded invalid-token screen', async () => {
    await i18n.changeLanguage('en');
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});
    vi.spyOn(api, 'getSharedEssayReport').mockResolvedValueOnce(makeSharedReportFixture());

    const { unmount } = renderWithProviders(
      <Routes>
        <Route path="/verify/share/:token" element={<SharedReportPage />} />
      </Routes>,
      { user: null, initialRoute: '/verify/share/valid-token-123' },
    );

    await waitFor(() => expect(screen.getByTestId('shared-report-page')).toBeDefined());
    expect(screen.getByTestId('decision-support-banner')).toBeDefined();
    const disclaimerText = screen.getByTestId('shared-report-disclaimer').textContent ?? '';
    expect(disclaimerText).not.toContain('`');

    // Print button triggers window.print()
    const printBtn = screen.getByTestId('shared-print-btn');
    fireEvent.click(printBtn);
    expect(printSpy).toHaveBeenCalledTimes(1);

    // Theme toggle switches html theme class
    const themeBtn = screen.getByTestId('shared-theme-toggle');
    const hadDarkBefore = document.documentElement.classList.contains('dark');
    fireEvent.click(themeBtn);
    expect(document.documentElement.classList.contains('dark')).toBe(!hadDarkBefore);
    unmount();

    // Invalid token screen renders branded CITRA error view without raw API 404 JSON
    vi.spyOn(api, 'getSharedEssayReport').mockRejectedValueOnce(
      new Error('API 404: {"detail":"Invalid share token format"}'),
    );
    const { container: errContainer } = renderWithProviders(
      <Routes>
        <Route path="/verify/share/:token" element={<SharedReportPage />} />
      </Routes>,
      { user: null, initialRoute: '/verify/share/bad-token-xyz' },
    );

    await waitFor(() => expect(screen.getByTestId('shared-report-error')).toBeDefined());
    expect(errContainer.textContent).toContain('CITRA');
    expect(errContainer.textContent).not.toContain('API 404');
    expect(errContainer.textContent).not.toContain('{"detail"');
  });

  it('10. ToastContext renders contextual VI headers ("Thành công" / "Vừa xong", NOT "CITRA · VERIFIED" / "NOW") and stacks at z-[100]', async () => {
    await i18n.changeLanguage('vi');
    renderWithProviders(<ToastTriggerHarness />);

    fireEvent.click(screen.getByTestId('fire-vi-success-toast'));

    await waitFor(() => expect(screen.getByText('Đã lưu thay đổi')).toBeDefined());
    const toastRegion = document.body.querySelector('.z-\\[100\\]');
    expect(toastRegion).not.toBeNull();
    expect(toastRegion?.textContent).toContain('Thành công');
    expect(toastRegion?.textContent).toContain('Vừa xong');
    expect(toastRegion?.textContent).not.toContain('CITRA · VERIFIED');
    expect(toastRegion?.textContent).not.toMatch(/\bNOW\b/);
  });

  it('11. OverrideControls includes DecisionSupportBanner and uses Unified Academic Taxonomy in VI', async () => {
    await i18n.changeLanguage('vi');
    const verdict = makeVerdict({
      citation_id: 'v-ov-1',
      label: 'suspected_hallucination',
      mapping_status: 'matched',
    });

    renderWithProviders(
      <OverrideControls verdict={verdict} onOverride={vi.fn().mockResolvedValue(undefined)} />,
      { user: makeUser('teacher', 'pro') },
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cập nhật kết quả kiểm tra' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('Công cụ hỗ trợ rà soát học thuật');
    expect(dialog.textContent).toContain('Sai lệch thông tin');
    expect(dialog.textContent).toContain('Không tìm thấy nguồn');
    expect(dialog.textContent).not.toContain('Bịa đặt');
    expect(dialog.textContent).not.toContain('Sai lệch Metadata');
  });

  it('12. BibliographyRemediationModal deduplicates repeated venues (CVPR - CVPR) and avoids accusatory VI phrasing', async () => {
    expect(deduplicateRepeatedVenue('Proceedings of CVPR - CVPR, 2024')).toBe(
      'Proceedings of CVPR, 2024',
    );
    expect(deduplicateRepeatedVenue('NeurIPS – NeurIPS')).toBe('NeurIPS');

    await i18n.changeLanguage('vi');
    vi.spyOn(api, 'getRemediatedBibliography').mockResolvedValue({
      essay_id: 55,
      style: 'apa',
      total_entries: 1,
      remediated_count: 0,
      hallucination_count: 1,
      entries: [
        {
          index: 1,
          verdict_id: 'c-1',
          label: 'suspected_hallucination',
          remediation_status: 'hallucination',
          is_hallucination: true,
          is_error: true,
          source_used: null,
          original_raw: 'Ghost, A. (2025). Nonexistent paper.',
          remediated_text: 'Ghost, A. (2025). Nonexistent paper.',
          apa: 'Ghost, A. (2025). Nonexistent paper.',
          ieee: '[1] A. Ghost, 2025.',
          tdtu: 'Ghost, A. (2025).',
          bibtex: '',
          ris: '',
          diff_fields: [],
          was_modified: false,
          canonical_metadata: {
            title: '',
            authors: [],
            year: '',
            venue: '',
            doi: '',
            url: '',
          },
        },
      ],
      combined_text: '',
      combined_bibtex: '',
      combined_ris: '',
    });

    renderWithProviders(
      <BibliographyRemediationModal
        open={true}
        essayId={55}
        filename="thesis.docx"
        lang="vi"
        onClose={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(screen.getByText(/Không tìm thấy nguồn — Cần kiểm tra lại bản gốc/)).toBeDefined(),
    );
    const modal = screen.getByTestId('bibliography-remediation-modal');
    expect(modal.textContent).not.toContain('BỊA ĐẶT');
    expect(modal.textContent).not.toContain('ẢO GIÁC');
  });

  it('13. MyClassesPage hides classes owned by the current teacher from Enrolled Classes (BUG-22)', async () => {
    const teacher = makeUser('teacher', 'pro', { id: 2 });
    vi.spyOn(api, 'getTeacherDashboard').mockResolvedValue({
      total_classes: 1,
      total_students: 20,
      total_essays: 12,
      pending_reviews: 0,
      classes: [
        {
          id: 10,
          name: 'Own Seminar Class',
          description: null,
          join_code: 'OWN10',
          teacher_id: 2,
          teacher_username: 'lecturer1',
          created_at: '2026-11-01T00:00:00Z',
          student_count: 20,
          essay_count: 12,
        },
      ],
    });
    vi.spyOn(api, 'listEnrolledClasses').mockResolvedValue([
      {
        id: 10,
        name: 'Own Seminar Class',
        description: null,
        teacher_id: 2,
        teacher_username: 'lecturer1',
        created_at: '2026-11-01T00:00:00Z',
        student_count: 20,
        essay_count: 12,
      },
      {
        id: 88,
        name: 'Peer Research Group',
        description: null,
        teacher_id: 99,
        teacher_username: 'prof_other',
        created_at: '2026-11-02T00:00:00Z',
        student_count: 8,
        essay_count: 4,
      },
    ]);

    renderWithProviders(<MyClassesPage />, { user: teacher });

    const enrolledSection = await screen.findByTestId('enrolled-classes-section');
    expect(enrolledSection.textContent).toContain('Peer Research Group');
    expect(enrolledSection.textContent).not.toContain('Own Seminar Class');
    expect(screen.queryByTestId('leave-class-btn-10')).toBeNull();
    expect(screen.getByTestId('leave-class-btn-88')).toBeDefined();
  });

  it('14. PendingReviewsPage uses guarded inline confirmation bar with explicit target status options (BUG-23)', async () => {
    vi.spyOn(api, 'listMyClasses').mockResolvedValue([
      {
        id: 1,
        name: 'KLTN 2026',
        description: null,
        join_code: 'KLTN26',
        teacher_id: 2,
        teacher_username: 'lecturer1',
        created_at: '2026-11-01T00:00:00Z',
        student_count: 15,
        essay_count: 5,
      },
    ]);
    const item: PendingVerdict = {
      verdict_id: 701,
      essay_id: 33,
      filename: 'Student_Paper.pdf',
      student_username: 'sv_an',
      citation_raw: 'Unknown Author (2025). Sample paper.',
      label: 'suspected_hallucination',
      confidence: 0.25,
      reasoning: '',
      validated_at: '2026-11-26T08:00:00Z',
    };
    vi.spyOn(api, 'listPendingReviews').mockResolvedValue([item]);
    const overrideSpy = vi.spyOn(api, 'overrideVerdict').mockResolvedValue(
      makeVerdict({ citation_id: '701', label: 'resource' }),
    );

    renderWithProviders(<PendingReviewsPage />, { user: makeUser('teacher', 'pro') });

    const approveBtn = await screen.findByTestId('pending-approve-btn-701');
    fireEvent.click(approveBtn);
    expect(overrideSpy).not.toHaveBeenCalled();

    // Confirm bar lets instructor choose Verified or Web/Legal Source before committing
    expect(screen.getByTestId('pending-confirm-bar-701')).toBeDefined();
    fireEvent.click(screen.getByTestId('pending-target-option-701-resource'));
    fireEvent.click(screen.getByTestId('pending-confirm-submit-701'));

    await waitFor(() => {
      expect(overrideSpy).toHaveBeenCalledWith(
        33,
        expect.objectContaining({
          verdict_id: '701',
          new_label: 'resource',
        }),
      );
    });
  });

  it('15. LandingPage links "See how it works" to #how-it-works and eliminates legacy jargon / accusatory copy', async () => {
    await i18n.changeLanguage('en');
    const { container: enContainer, unmount } = renderWithProviders(<LandingPage />, {
      user: null,
      initialRoute: '/',
    });
    expect(enContainer.querySelector('#how-it-works')).not.toBeNull();
    const howItWorksLinks = Array.from(
      enContainer.querySelectorAll<HTMLAnchorElement>('a[href="#how-it-works"]'),
    );
    expect(howItWorksLinks.length).toBeGreaterThan(0);
    expect(enContainer.textContent).not.toContain('SourceLogic');
    expect(enContainer.textContent).not.toContain('0% np.clip');
    expect(enContainer.textContent).not.toContain('symbolic_verifier.py');
    unmount();

    await i18n.changeLanguage('vi');
    const { container: viContainer } = renderWithProviders(<LandingPage />, {
      user: null,
      initialRoute: '/',
    });
    expect(viContainer.textContent).not.toContain('ngay trước mặt thầy cô');
    expect(viContainer.textContent).not.toContain('SourceLogic');
    expect(viContainer.textContent).not.toContain('0% np.clip');
  });

  it('16. EssayPage mobile citation detail sheet uses valid Tailwind v3.4 backdrop-blur-sm (no backdrop-blur-xs)', () => {
    const essayPageSrc = fs.readFileSync(path.join(SRC_ROOT, 'pages', 'EssayPage.tsx'), 'utf8');
    expect(essayPageSrc).not.toContain('backdrop-blur-xs');
    expect(essayPageSrc).toContain('backdrop-blur-sm');
  });

  it('17. Round 4 P2/P3 invariants: ambiguous deep sources never show green matched, VI legal summary translates prefix, no (venue) leak', () => {
    const essayPageSrc = fs.readFileSync(path.join(SRC_ROOT, 'pages', 'EssayPage.tsx'), 'utf8');
    // P2-R3-1: unresolved & ambiguous verdicts downgrade deep source cards to candidate_insufficient
    expect(essayPageSrc).toContain("verdict.label === 'unresolved'");
    expect(essayPageSrc).toContain("String(verdict.label).toLowerCase() === 'ambiguous'");
    expect(essayPageSrc).not.toContain('Trường khớp:');
    // P3-R3-1: VI legal summary strips English backend prefix
    expect(essayPageSrc).toContain('Nhận diện văn bản quy phạm pháp luật Việt Nam hợp lệ:');
    // P3-R3-4: VI verdictExplanation eliminates raw "(venue)" token
    const expSrc = fs.readFileSync(path.join(SRC_ROOT, 'lib', 'verdictExplanation.ts'), 'utf8');
    expect(expSrc).not.toContain('nơi công bố (venue)');
    // P3-R3-2: Network center hub renders non-double-ellipsis title + fixed year sibling
    const flowSrc = fs.readFileSync(
      path.join(SRC_ROOT, 'components', 'CitationGraph', 'InteractiveDecisionFlowBoard.tsx'),
      'utf8',
    );
    expect(flowSrc).toContain("identity.authorOnly.replace(/…+$/, '')");
  });
});
