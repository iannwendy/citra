import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Routes, Route } from 'react-router-dom';
import {
  api,
  type Class,
  type ClassAnalytics,
  type PendingVerdict,
  type Verdict,
} from '@/api/client';
import i18n from '@/i18n';
import {
  renderWithProviders,
  makeUser,
  screen,
  fireEvent,
  waitFor,
} from '@/test-utils';
import { PendingReviewsPage } from './PendingReviewsPage';
import { MyClassesPage } from './MyClassesPage';
import { ClassDetailPage } from './ClassDetailPage';
import { AccountManagementPage } from './AccountManagementPage';
import { PromoManagementPage } from './PromoManagementPage';
import { SystemHealthPage } from './SystemHealthPage';
import { AuditLogPage } from './AuditLogPage';

const makeClassFixture = (over: Partial<Class> = {}): Class => ({
  id: 1,
  name: 'KLTN K26',
  description: 'Khóa luận tốt nghiệp CNTT',
  join_code: 'CITRA1',
  teacher_id: 2,
  teacher_username: 'lecturer1',
  created_at: '2026-10-01T00:00:00Z',
  student_count: 25,
  essay_count: 18,
  ...over,
});

describe('Visual Action Studio Redesign — 6 Teaching & Admin Pages', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage('en');
  });

  describe('Page 1: PendingReviewsPage Adjudication Studio', () => {
    it('strips pending_reviews.queue, R-* codes, Mismatch: the ..., and Crossref chips while rendering DonutChart & submission groups', async () => {
      vi.spyOn(api, 'listMyClasses').mockResolvedValue([makeClassFixture()]);
      const items: PendingVerdict[] = [
        {
          verdict_id: 101,
          essay_id: 40,
          filename: '1810.04805v2.pdf',
          student_username: 'sv_an',
          citation_raw: 'Christopher Clark and Matt Gardner. 2018.',
          label: 'suspected_hallucination',
          confidence: 0.25,
          reasoning: 'The available records do not support this citation.',
          validated_at: '2026-11-19T08:00:00Z',
          triggered_rules: [
            'R-STYLE-INCONSISTENT',
            'R-CONTENT-ALIGNMENT',
            'R-WEAK-EVIDENCE',
            'R-HALLUCINATED-SOURCE',
          ],
          mismatched_fields: ['title', 'authors'],
          matched_sources: [
            {
              source: 'crossref',
              title: 'Simple and Effective Multi-Paragraph Reading Comprehension',
              authors: ['Clark', 'Gardner'],
              year: '2018',
              matched_fields: ['year'],
              checked_at: '2026-11-19T08:00:00Z',
            },
          ],
          url_status: 'unchecked',
        },
        {
          verdict_id: 102,
          essay_id: 40,
          filename: '1810.04805v2.pdf',
          student_username: 'sv_an',
          citation_raw: 'Local Print Monograph 2019.',
          label: 'unresolved',
          confidence: 0.5,
          reasoning: 'Insufficient evidence.',
          validated_at: '2026-11-19T08:01:00Z',
        },
      ];
      vi.spyOn(api, 'listPendingReviews').mockResolvedValue(items);

      const { container } = renderWithProviders(<PendingReviewsPage />, {
        user: makeUser('teacher', 'pro'),
      });

      await waitFor(() => {
        expect(screen.getByTestId('pending-review-row-101')).toBeDefined();
      });

      const text = container.textContent ?? '';
      expect(text).not.toContain('pending_reviews.queue');
      expect(text).not.toContain('FACULTY ADJUDICATION QUEUE');
      expect(text).not.toContain('R-STYLE-INCONSISTENT');
      expect(text).not.toContain('R-CONTENT-ALIGNMENT');
      expect(text).not.toContain('R-WEAK-EVIDENCE');
      expect(text).not.toContain('R-HALLUCINATED-SOURCE');
      expect(text).not.toContain('Mismatch: the title');
      expect(text).not.toContain('Mismatch: the authors');
      expect(text).not.toContain('Crossref');
      expect(text).not.toContain('URL Unchecked');

      // Uppercase human section title + DonutChart rendered
      expect(text).toContain('REVIEW QUEUE');
      expect(container.querySelector('.t-donut')).not.toBeNull();

      // Grouped by submission: filename rendered once in group header rather than duplicated per item
      expect(screen.getAllByText('1810.04805v2.pdf')).toHaveLength(1);
    });

    it('supports 1-click inline Approve & Flag Issue, resets emptied severity filter cleanly, and guards API errors / double clicks (Review Focus #1, #2, #3)', async () => {
      vi.spyOn(api, 'listMyClasses').mockResolvedValue([makeClassFixture()]);
      const items: PendingVerdict[] = [
        {
          verdict_id: 201,
          essay_id: 50,
          filename: 'Thesis_A.pdf',
          student_username: 'sv_binh',
          citation_raw: 'Fake Citation 2025.',
          label: 'suspected_hallucination',
          confidence: 0.2,
          reasoning: '',
          validated_at: '2026-11-19T08:00:00Z',
        },
        {
          verdict_id: 202,
          essay_id: 51,
          filename: 'Thesis_B.pdf',
          student_username: 'sv_chi',
          citation_raw: 'Undecided Book 2015.',
          label: 'unverified',
          confidence: 0.5,
          reasoning: '',
          validated_at: '2026-11-19T08:05:00Z',
        },
      ];
      vi.spyOn(api, 'listPendingReviews').mockResolvedValue(items);

      let resolveFirstOverride!: (val: Verdict) => void;
      const overrideSpy = vi
        .spyOn(api, 'overrideVerdict')
        .mockImplementationOnce(
          () =>
            new Promise<Verdict>((res) => {
              resolveFirstOverride = res;
            }),
        )
        .mockRejectedValueOnce(new Error('Temporary network failure'))
        .mockResolvedValueOnce({ citation_id: 'v202', label: 'metadata_error' } as Verdict);

      renderWithProviders(<PendingReviewsPage />, {
        user: makeUser('teacher', 'pro'),
      });

      await waitFor(() => {
        expect(screen.getByTestId('pending-approve-btn-201')).toBeDefined();
      });

      // Filter to 'critical' severity (only item 201 matches)
      fireEvent.click(screen.getByTestId('pending-kpi-critical'));
      expect(screen.queryByTestId('pending-review-row-202')).toBeNull();

      // Click Approve on 201 -> opens guarded inline confirm bar without firing API prematurely (BUG-23)
      const approveBtn = screen.getByTestId('pending-approve-btn-201');
      fireEvent.click(approveBtn);
      expect(overrideSpy).toHaveBeenCalledTimes(0);
      expect(screen.getByTestId('pending-confirm-bar-201')).toBeDefined();

      // Double-click Confirm on 201 -> only 1 API call while in flight (Review Focus #1)
      const confirmApproveBtn = screen.getByTestId('pending-confirm-submit-201');
      fireEvent.click(confirmApproveBtn);
      fireEvent.click(confirmApproveBtn);
      expect(overrideSpy).toHaveBeenCalledTimes(1);
      expect(overrideSpy).toHaveBeenNthCalledWith(
        1,
        50,
        expect.objectContaining({
          verdict_id: '201',
          new_label: 'verified',
        }),
      );

      resolveFirstOverride({ citation_id: 'v201', label: 'verified' } as Verdict);

      // Item 201 removed -> active 'critical' filter is now empty while item 202 remains -> shows filter reset button (Review Focus #2)
      const resetFilterBtn = await screen.findByTestId('pending-reset-severity-btn');
      fireEvent.click(resetFilterBtn);

      // Item 202 ('unverified') is now visible -> click Flag opens inline confirm bar
      const flagBtn = await screen.findByTestId('pending-confirm-issue-btn-202');
      fireEvent.click(flagBtn);
      expect(screen.getByTestId('pending-confirm-bar-202')).toBeDefined();

      // Next override call rejects -> item 202 stays in the queue (Review Focus #1)
      fireEvent.click(screen.getByTestId('pending-confirm-submit-202'));
      await waitFor(() => {
        expect(overrideSpy).toHaveBeenCalledTimes(2);
      });
      expect(screen.getByTestId('pending-review-row-202')).toBeDefined();

      // Retry -> succeeds with normalized new_label: 'metadata_error' (Review Focus #3)
      fireEvent.click(screen.getByTestId('pending-confirm-submit-202'));
      await waitFor(() => {
        expect(overrideSpy).toHaveBeenNthCalledWith(
          3,
          51,
          expect.objectContaining({
            verdict_id: '202',
            new_label: 'metadata_error',
          }),
        );
        expect(screen.queryByTestId('pending-review-row-202')).toBeNull();
      });
    });
  });

  describe('Page 2: MyClassesPage & ClassDetailPage Visual Classroom Hub', () => {
    it('MyClassesPage removes teacher_classes.registry & FACULTY WORKSPACE IDE, renders CardHoverTilt cohort cards, and copies join code inline without navigating', async () => {
      const cls = makeClassFixture({ id: 7, name: 'AI Research Seminar', join_code: 'JOIN99' });
      vi.spyOn(api, 'getTeacherDashboard').mockResolvedValue({
        total_classes: 1,
        total_students: 25,
        total_essays: 18,
        pending_reviews: 2,
        classes: [cls],
      });
      vi.spyOn(api, 'listEnrolledClasses').mockResolvedValue([]);

      const { container } = renderWithProviders(
        <Routes>
          <Route path="/teacher/classes" element={<MyClassesPage />} />
          <Route
            path="/teacher/classes/:classId"
            element={<div data-testid="navigated-detail">Detail</div>}
          />
        </Routes>,
        {
          user: makeUser('teacher', 'pro'),
          initialRoute: '/teacher/classes',
        },
      );

      await waitFor(() => {
        expect(screen.getByText('AI Research Seminar')).toBeDefined();
      });

      const text = container.textContent ?? '';
      expect(text).not.toContain('teacher_classes.registry');
      expect(text).not.toContain('FACULTY WORKSPACE IDE');
      expect(text).toContain('MY CLASSES');
      expect(container.querySelector('.t-tilt')).not.toBeNull();

      // Clicking 1-click Copy Join Code copies without navigating to ClassDetailPage
      fireEvent.click(screen.getByTestId('copy-class-code-7'));
      await waitFor(() => {
        expect(screen.getByTestId('copy-class-code-7').textContent).toContain('Copied');
      });
      expect(screen.queryByTestId('navigated-detail')).toBeNull();
    });

    it('ClassDetailPage removes cohort_submissions.log, CROSS-STUDENT ANOMALY ENGINE, and raw R-* codes while rendering ScoreRing gauges & DonutChart safely even on 0-verdict cohorts (Review Focus #5)', async () => {
      const cls = makeClassFixture({ id: 7, name: 'AI Research Seminar', join_code: 'JOIN99' });
      const analytics: ClassAnalytics = {
        class_id: 7,
        class_name: 'AI Research Seminar',
        total_students: 2,
        total_essays: 0,
        avg_cis: 0,
        recency_5yr_ratio: 0,
        cis_distribution: { excellent: 0, good: 0, fair: 0, poor: 0 },
        verdict_breakdown: { verified: 0, metadata_error: 0, suspected_hallucination: 0 },
        top_triggered_rules: [
          { rule_id: 'R-TITLE-MISMATCH', count: 5 },
          { rule_id: 'R-YEAR-MISMATCH', count: 3 },
        ],
        shared_hallucinations: [
          {
            citation_raw: 'Fabricated LLM Study (2025)',
            label: 'suspected_hallucination',
            student_count: 2,
            occurrence_count: 2,
            students: ['sv_1', 'sv_2'],
            essay_ids: [81, 82],
            is_shared: true,
          },
        ],
      };

      vi.spyOn(api, 'listMyClasses').mockResolvedValue([cls]);
      vi.spyOn(api, 'listClassStudents').mockResolvedValue([]);
      vi.spyOn(api, 'listClassEssays').mockResolvedValue([]);
      vi.spyOn(api, 'getClassAnalytics').mockResolvedValue(analytics);

      const { container } = renderWithProviders(
        <Routes>
          <Route path="/teacher/classes/:classId" element={<ClassDetailPage />} />
        </Routes>,
        {
          user: makeUser('teacher', 'pro'),
          initialRoute: '/teacher/classes/7',
        },
      );

      await waitFor(() => {
        expect(screen.getByText('AI Research Seminar')).toBeDefined();
      });

      const text = container.textContent ?? '';
      expect(text).not.toContain('cohort_submissions.log');
      expect(text).not.toContain('CROSS-STUDENT ANOMALY ENGINE');
      expect(text).not.toContain('R-TITLE-MISMATCH');
      expect(text).not.toContain('R-YEAR-MISMATCH');
      expect(text).not.toContain('suspected_hallucination');
      expect(container.innerHTML).not.toContain('NaN');

      // Human rule explanation & ScoreRings rendered
      expect(text).toContain('Author and year match a known work');
      expect(screen.getByTestId('cohort-cis-ring')).toBeDefined();
      expect(screen.getByTestId('cohort-recency-ring')).toBeDefined();
    });
  });

  describe('Page 3 & 4: AccountManagementPage & PromoManagementPage Visual Studios', () => {
    it('AccountManagementPage removes iam_directory.users & IAM IDENTITY DIRECTORY, renders role DonutChart + plan bar, and clamps quota bars across undefined/0/over-limit/admin (Review Focus #4)', async () => {
      vi.spyOn(api, 'listUsers').mockResolvedValue([
        makeUser('admin', 'ultra', { id: 1, username: 'admin_root' }),
        makeUser('teacher', 'pro', {
          id: 2,
          username: 'over_quota_prof',
          quota: {
            ...makeUser('teacher', 'pro').quota!,
            monthly_uploads_used: 65,
            monthly_uploads_limit: 50,
          },
        }),
        makeUser('user', 'basic', {
          id: 3,
          username: 'zero_limit_user',
          quota: {
            ...makeUser('user', 'basic').quota!,
            monthly_uploads_used: 0,
            monthly_uploads_limit: 0,
          },
        }),
        {
          ...makeUser('user', 'basic', { id: 4, username: 'no_quota_user' }),
          quota: undefined,
        },
      ]);

      const { container } = renderWithProviders(<AccountManagementPage />, {
        user: makeUser('admin', 'ultra'),
        initialRoute: '/admin/users',
      });

      await waitFor(() => {
        expect(screen.getByText(/over_quota_prof/)).toBeDefined();
      });

      const text = container.textContent ?? '';
      expect(text).not.toContain('iam_directory.users');
      expect(text).not.toContain('IAM IDENTITY DIRECTORY');
      expect(text).not.toContain('RBAC ENFORCED');
      expect(text).toContain('User Accounts');
      expect(container.querySelector('.t-donut')).not.toBeNull();
      expect(container.innerHTML).not.toContain('NaN');

      // Over-quota bar clamps at 100%
      const overBar = screen.getByTestId('user-quota-bar-2');
      expect(overBar.getAttribute('style')).toContain('width: 100%');
    });

    it('PromoManagementPage removes billing_engine.promo_codes & 6-CHAR ISO COUPON STANDARD and renders inline TactileToggle switch', async () => {
      vi.spyOn(api, 'listAdminPromoCodes').mockResolvedValue({
        stats: {
          total_codes: 2,
          active_codes: 1,
          total_redemptions: 24,
          total_discount_usd: 320,
        },
        promos: [
          {
            id: 1,
            code: 'FALL30',
            description: 'Fall Grant 30%',
            discount_type: 'percent',
            discount_value: 30,
            max_discount_usd: 60,
            min_amount_usd: 0,
            applicable_tiers: 'all',
            applicable_cycles: 'all',
            max_uses: 100,
            used_count: 24,
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

      const { container } = renderWithProviders(<PromoManagementPage />, {
        user: makeUser('admin', 'ultra'),
        initialRoute: '/admin/promos',
      });

      await waitFor(() => {
        expect(screen.getByTestId('promo-row-FALL30')).toBeDefined();
      });

      const text = container.textContent ?? '';
      expect(text).not.toContain('billing_engine.promo_codes');
      expect(text).not.toContain('6-CHAR ISO COUPON STANDARD');
      expect(text).not.toContain('REVENUE & PROMO ENGINE');
      expect(text).toContain('PROMO CAMPAIGNS');

      const toggleBtn = screen.getByTestId('promo-toggle-FALL30');
      expect(toggleBtn.getAttribute('role')).toBe('switch');
    });
  });

  describe('Page 5 & 6: SystemHealthPage & AuditLogPage Visual Studios', () => {
    it('SystemHealthPage removes telemetry_*.json filenames, renders 3-stage PipelineStageFlow, humanizes verdict labels, collapses advanced diagnostics by default, and guards 0-call providers (Review Focus #5)', async () => {
      vi.spyOn(api, 'getSystemHealth').mockResolvedValue({
        status: 'ok',
        totals: { users: 12, admins: 1, teachers: 3, students: 8, essays: 45, verdicts: 200 },
        verdict_label_counts: {
          verified: 150,
          metadata_error: 35,
          suspected_hallucination: 15,
        },
        sqlite_wal: {
          app_db: { journal_mode: 'wal', synchronous: 1, busy_timeout_ms: 5000 },
          local_papers_db: { available: true, mode: 'ro_immutable_wal' },
        },
        cache_stats: {
          total: 128100,
          persistent_entries: 100,
          persistent_hits: 320,
          local_papers_count: 128000,
          hit_rate_percent: 86.5,
          session_hit_rate_percent: 79.0,
        },
        upstream_sources: {
          openalex: {
            state: 'closed',
            consecutive_failures: 0,
            total_calls: 80,
            success_count: 79,
            timeout_count: 1,
            http_429_count: 0,
            http_5xx_count: 0,
            ema_latency_ms: 140,
            open_remaining_seconds: 0,
          },
          arxiv: {
            state: 'closed',
            consecutive_failures: 0,
            total_calls: 0,
            success_count: 0,
            timeout_count: 0,
            http_429_count: 0,
            http_5xx_count: 0,
            ema_latency_ms: 0,
            has_latency_sample: false,
            open_remaining_seconds: 0,
          },
        },
      });

      const { container } = renderWithProviders(<SystemHealthPage />, {
        user: makeUser('admin', 'ultra'),
      });

      await waitFor(() => {
        expect(screen.getByTestId('system-pipeline-flow')).toBeDefined();
      });

      const text = container.textContent ?? '';
      expect(text).not.toContain('telemetry_verdict_distribution.json');
      expect(text).not.toContain('telemetry_upstream_circuits.json');
      expect(text).not.toContain('PLATFORM TELEMETRY MONITOR');
      expect(text).not.toContain('suspected_hallucination');
      expect(text).toContain('Source Not Found');
      expect(text).toContain('VERDICT DISTRIBUTION');

      // Advanced diagnostics drawer starts collapsed (data-open="false") and expands on click
      const diagPanel = screen.getByTestId('advanced-diagnostics-panel');
      expect(diagPanel.getAttribute('data-open')).toBe('false');
      fireEvent.click(screen.getByTestId('toggle-advanced-diagnostics-btn'));
      expect(diagPanel.getAttribute('data-open')).toBe('true');

      // 0-call provider guarded with —
      expect(screen.getByTestId('upstream-latency-arxiv').textContent?.trim()).toBe('—');
      expect(screen.getByTestId('upstream-success-arxiv').textContent?.trim()).toBe('—');
    });

    it('AuditLogPage removes immutable_audit_trail.log & IMMUTABLE COMPLIANCE LEDGER and renders visual badge-transition timeline instead of raw snake_case', async () => {
      vi.spyOn(api, 'listAuditLog').mockResolvedValue([
        {
          id: 1,
          verdict_id: 77,
          essay_id: 12,
          original_label: 'metadata_error',
          new_label: 'verified',
          user: 'prof_lan',
          note: 'Minor edition year difference, verified valid.',
          logged_at: '2026-11-19T09:30:00Z',
        },
      ]);
      vi.spyOn(api, 'getAuditStats').mockResolvedValue({
        total_events: 28,
        unique_actors: 4,
      });

      const { container } = renderWithProviders(<AuditLogPage />, {
        user: makeUser('admin', 'ultra'),
      });

      await waitFor(() => {
        expect(screen.getByTestId('audit-verdict-link-1')).toBeDefined();
      });

      const text = container.textContent ?? '';
      expect(text).not.toContain('immutable_audit_trail.log');
      expect(text).not.toContain('IMMUTABLE COMPLIANCE LEDGER');
      expect(text).not.toContain('VERDICT OVERRIDE STREAM');
      expect(text).not.toContain('metadata_error');
      expect(text).toContain('REVIEW ACTIVITY LOG');
      expect(text).toContain('Details Mismatch');
      expect(text).toContain('Verified');
    });
  });

  describe('WCAG Accessibility & Progressive Disclosure Layout Invariants', () => {
    it('eliminates nested-interactive role="button" wrappers on PendingReviewsPage & MyClassesPage and avoids "verdict" jargon in VI empty queue', async () => {
      await i18n.changeLanguage('vi');
      const cls = makeClassFixture({ id: 9, name: 'Lớp KLTN', join_code: 'KLTN99' });
      vi.spyOn(api, 'listMyClasses').mockResolvedValue([cls]);
      vi.spyOn(api, 'listPendingReviews')
        .mockResolvedValueOnce([
          {
            verdict_id: 301,
            essay_id: 60,
            filename: 'baocao.pdf',
            student_username: 'sv_hoa',
            citation_raw: 'Test Ref 2024',
            label: 'metadata_error',
            confidence: 0.7,
            reasoning: '',
            validated_at: '2026-11-19T10:00:00Z',
          },
        ])
        .mockResolvedValueOnce([]);

      const { unmount } = renderWithProviders(<PendingReviewsPage />, {
        user: makeUser('teacher', 'pro'),
      });

      const row = await screen.findByTestId('pending-review-row-301');
      expect(row.getAttribute('role')).toBeNull();
      unmount();

      // Empty queue in Vietnamese contains zero raw "verdict" jargon
      const { container: emptyViContainer, unmount: unmountEmpty } = renderWithProviders(
        <PendingReviewsPage />,
        { user: makeUser('teacher', 'pro') },
      );
      await waitFor(() => {
        expect(emptyViContainer.textContent).toContain('Không có trích dẫn nào');
      });
      expect(emptyViContainer.textContent?.toLowerCase()).not.toContain('verdict');
      unmountEmpty();

      // MyClassesPage card wrapper does not nest buttons inside role="button"
      vi.spyOn(api, 'getTeacherDashboard').mockResolvedValue({
        total_classes: 1,
        total_students: 10,
        total_essays: 5,
        pending_reviews: 0,
        classes: [cls],
      });
      vi.spyOn(api, 'listEnrolledClasses').mockResolvedValue([]);
      const { container: classesContainer } = renderWithProviders(<MyClassesPage />, {
        user: makeUser('teacher', 'pro'),
      });
      await waitFor(() => expect(screen.getByText('Lớp KLTN')).toBeDefined());
      const deleteBtn = screen.getByTestId('delete-class-card-btn-9');
      expect(deleteBtn.closest('[role="button"]')).toBeNull();
      expect(classesContainer.querySelectorAll('[role="button"] button')).toHaveLength(0);
    });

    it('marks collapsed AccordionExpand panels inert and expands SystemHealthPage diagnostics strictly below its toggle trigger', async () => {
      vi.spyOn(api, 'getSystemHealth').mockResolvedValue({
        status: 'ok',
        totals: { users: 4, admins: 1, teachers: 1, students: 2, essays: 10, verdicts: 40 },
        verdict_label_counts: { verified: 40 },
        sqlite_wal: {
          app_db: { journal_mode: 'wal', synchronous: 1, busy_timeout_ms: 5000 },
        },
        cache_stats: {
          total: 128020,
          persistent_entries: 20,
          persistent_hits: 50,
          local_papers_count: 128000,
        },
      });

      renderWithProviders(<SystemHealthPage />, {
        user: makeUser('admin', 'ultra'),
      });

      const toggleBtn = await screen.findByTestId('toggle-advanced-diagnostics-btn');
      const diagPanel = screen.getByTestId('advanced-diagnostics-panel');
      const cacheEntryTile = screen.getByTestId('cache-stat-persistent_entries');

      // cache-stat-* lives inside advanced-diagnostics-panel, which follows toggleBtn in DOM order
      expect(diagPanel.contains(cacheEntryTile)).toBe(true);
      expect(
        Boolean(
          toggleBtn.compareDocumentPosition(diagPanel) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        ),
      ).toBe(true);

      // Collapsed AccordionExpand carries inert attribute; expanding removes inert
      const accEl = diagPanel.querySelector('.t-acc-panel');
      expect(accEl?.hasAttribute('inert')).toBe(true);
      fireEvent.click(toggleBtn);
      expect(accEl?.hasAttribute('inert')).toBe(false);
    });
  });

  describe('Phase 2 Agent F — Admin Control Panel Production Bugfixes', () => {
    it('AccountManagementPage: Plan Tier filter works, Role vs Plan colors do not collide, Institution / Class header used, and self-lockout guard protects editing own admin account', async () => {
      const selfAdmin = makeUser('admin', 'ultra', {
        id: 1,
        username: 'admin_root',
        institution: 'Ton Duc Thang University',
      });
      const proTeacher = makeUser('teacher', 'pro', {
        id: 2,
        username: 'prof_minh',
        institution: 'TDTU',
      });
      const basicStudent = makeUser('user', 'basic', {
        id: 3,
        username: 'sv_an',
        institution: 'TDTU',
      });
      vi.spyOn(api, 'listUsers').mockResolvedValue([selfAdmin, proTeacher, basicStudent]);

      const { container } = renderWithProviders(<AccountManagementPage />, {
        user: selfAdmin,
        initialRoute: '/admin/users',
      });

      await waitFor(() => expect(screen.getByText(/prof_minh/)).toBeDefined());
      expect(container.textContent).toContain('Institution / Class');
      expect(container.textContent).toContain('Role Distribution');
      expect(container.textContent).toContain('Plan Tier Distribution');
      // Ultra bar uses amber-500 instead of violet-500 (reserved for Admin role)
      expect(screen.getByTestId('plan-tier-distribution-bar').innerHTML).toContain(
        'bg-amber-500',
      );

      // Plan Tier filter narrows cleanly to Pro
      fireEvent.change(screen.getByTestId('plan-tier-filter'), {
        target: { value: 'pro' },
      });
      expect(screen.getByText(/prof_minh/)).toBeDefined();
      expect(screen.queryByText(/sv_an/)).toBeNull();

      // Reset plan filter and open Edit modal for own admin account -> self-lockout guard active
      fireEvent.change(screen.getByTestId('plan-tier-filter'), {
        target: { value: 'all' },
      });
      fireEvent.click(screen.getByLabelText('Edit account admin_root'));
      const guardNote = await screen.findByTestId('self-lockout-guard-note');
      expect(guardNote.textContent).toContain(
        'You cannot demote or deactivate your own account',
      );
      expect((document.getElementById('user-form-role') as HTMLSelectElement).disabled).toBe(true);
      expect(
        (document.getElementById('user-form-active-switch') as HTMLButtonElement).disabled,
      ).toBe(true);
      // Username label in edit mode omits misleading '*'
      expect(document.querySelector('label[for="user-form-username"]')?.textContent).toBe(
        'Username',
      );
    });

    it('PromoManagementPage: prevents silent 6-char truncation, clears stale errors on edit, blocks past expiry, shows Reset Filters on filtered empty state, and removes doubled discount symbols', async () => {
      vi.spyOn(api, 'listAdminPromoCodes').mockResolvedValue({
        stats: { total_codes: 1, active_codes: 1, total_redemptions: 2, total_discount_usd: 20 },
        promos: [
          {
            id: 10,
            code: 'SAVE10',
            description: 'Fixed $10 off',
            discount_type: 'fixed',
            discount_value: 10,
            max_discount_usd: null,
            min_amount_usd: 0,
            applicable_tiers: 'all',
            applicable_cycles: 'all',
            max_uses: 50,
            used_count: 2,
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

      const { container } = renderWithProviders(<PromoManagementPage />, {
        user: makeUser('admin', 'ultra'),
        initialRoute: '/admin/promos',
      });

      await waitFor(() => expect(screen.getByTestId('promo-row-SAVE10')).toBeDefined());
      // Single clean discount symbol and clear "No expiry" on mobile cards
      expect(screen.getByTestId('promo-row-SAVE10').textContent).toContain('-$10.00');
      expect(screen.getByTestId('promo-mobile-cards').textContent).toContain('No expiry');

      // Filtering to Paused when 1 active promo exists -> Reset Filters CTA (not Create First Promo Code)
      fireEvent.click(screen.getByRole('button', { name: 'Paused' }));
      expect(screen.getByTestId('promo-reset-filters-btn')).toBeDefined();
      expect(container.textContent).not.toContain('Create First Promo Code');
      fireEvent.click(screen.getByTestId('promo-reset-filters-btn'));
      expect(screen.getByTestId('promo-row-SAVE10')).toBeDefined();

      // Create modal: typing >6 chars shows 10/6 counter & inline error instead of silently truncating
      fireEvent.click(screen.getByTestId('create-promo-btn'));
      const codeInput = screen.getByTestId('promo-code-input') as HTMLInputElement;
      fireEvent.change(codeInput, { target: { value: 'SUMMER2026' } });
      expect(codeInput.value).toBe('SUMMER2026');
      expect(screen.getByTestId('promo-code-counter').textContent).toBe('10/6');
      expect(screen.getByTestId('promo-code-inline-error').textContent).toContain('10 entered');

      // Fixing to valid 6-char code clears inline error immediately
      fireEvent.change(codeInput, { target: { value: 'SUMM26' } });
      expect(screen.queryByTestId('promo-code-inline-error')).toBeNull();

      // Past expiry date is rejected with inline error and input has min attribute
      const expiresInput = screen.getByTestId('promo-expires-input') as HTMLInputElement;
      expect(expiresInput.getAttribute('min')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      fireEvent.change(expiresInput, { target: { value: '2020-01-01' } });
      fireEvent.click(screen.getByTestId('promo-submit-btn'));
      await waitFor(() => {
        expect(screen.getByTestId('promo-form-modal').textContent).toContain(
          'Expiration date cannot be in the past',
        );
      });
    });

    it('SystemHealthPage: sanitizes raw RetryError/Future leaks, formats >=1000ms latency as seconds, shows Refresh + checked_at + Stage 1 GROBID/DB pills, and flags degraded <80% closed providers', async () => {
      const getHealthSpy = vi.spyOn(api, 'getSystemHealth').mockResolvedValue({
        status: 'ok',
        upstream_status: 'degraded',
        degraded_sources: ['crossref'],
        checked_at: '2026-11-27T05:30:00Z',
        grobid_available: true,
        parser_mode: 'grobid',
        services: { database: 'ok', cache: 'ok', parser: 'ok' },
        totals: { users: 10, admins: 1, teachers: 2, students: 7, essays: 50, verdicts: 4656 },
        verdict_label_counts: { verified: 4000, metadata_error: 656 },
        cache_stats: { dynamic_entries: 120, local_papers_count: 127102 },
        upstream_sources: {
          crossref: {
            state: 'closed',
            consecutive_failures: 1,
            total_calls: 10,
            success_count: 5,
            timeout_count: 5,
            http_429_count: 0,
            http_5xx_count: 0,
            ema_latency_ms: 25463.9,
            open_remaining_seconds: 0,
            last_error: "RetryError[<Future at 0x104abc123 state=finished raised ReadTimeout>]",
          },
          openalex: {
            state: 'closed',
            consecutive_failures: 0,
            total_calls: 20,
            success_count: 20,
            timeout_count: 0,
            http_429_count: 0,
            http_5xx_count: 0,
            ema_latency_ms: 180,
            open_remaining_seconds: 0,
          },
        },
      });

      renderWithProviders(<SystemHealthPage />, { user: makeUser('admin', 'ultra') });

      const pill = await screen.findByTestId('health-status-pill');
      expect(pill.getAttribute('data-level')).toBe('degraded');
      expect(pill.textContent).toContain('1 source unstable (1/2 operational)');
      expect(screen.getByTestId('circuit-badge-crossref').textContent).toBe('Unstable');
      expect(screen.getByTestId('upstream-latency-crossref').textContent).toContain('25.5 s');
      const errEl = screen.getByTestId('upstream-last-error-crossref');
      expect(errEl.textContent).not.toContain('RetryError');
      expect(errEl.textContent).not.toContain('0x104abc');
      expect(screen.getByTestId('stage1-grobid-pill').textContent).toContain('Enhanced PDF Parser: Active');
      expect(screen.getByTestId('stage1-db-pill').textContent).toContain('Database: Connected');
      expect(screen.getByTestId('health-checked-at').textContent).toContain('Last checked:');

      fireEvent.click(screen.getByTestId('refresh-health-btn'));
      await waitFor(() => expect(getHealthSpy).toHaveBeenCalledTimes(2));
    });

    it('AuditLogPage: shows essay_filename & student_name, excludes resource from flagged, preserves global KPIs on empty search, filters by verdict, and formats VI timestamps', async () => {
      await i18n.changeLanguage('vi');
      vi.spyOn(api, 'getAuditStats').mockResolvedValue({
        total_events: 42,
        unique_actors: 5,
      });
      vi.spyOn(api, 'listAuditLog').mockImplementation(async ({ user } = {}) => {
        if (user === 'nobody') return [];
        return [
          {
            id: 1,
            verdict_id: 501,
            essay_id: 11,
            essay_filename: 'khoa_luan_2026.pdf',
            student_name: 'Nguyễn Văn A',
            student_username: 'sv_a',
            original_label: 'unresolved',
            new_label: 'resource',
            user: 'gv_lan',
            note: 'Trang web chính thức',
            logged_at: '2026-11-27T05:30:00Z',
          },
          {
            id: 2,
            verdict_id: 502,
            essay_id: 12,
            essay_filename: 'bao_cao_ai.pdf',
            student_name: 'Trần Thị B',
            student_username: 'sv_b',
            original_label: 'metadata_error',
            new_label: 'verified',
            user: 'gv_lan',
            note: 'Đã đối chiếu bản gốc',
            logged_at: '2026-11-27T06:00:00Z',
          },
        ];
      });

      renderWithProviders(<AuditLogPage />, { user: makeUser('admin', 'ultra') });

      await waitFor(() => expect(screen.getByTestId('audit-context-1')).toBeDefined());
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
        'Nhật ký duyệt trích dẫn',
      );
      expect(screen.getByTestId('audit-context-1').textContent).toContain('khoa_luan_2026.pdf');
      expect(screen.getByTestId('audit-context-1').textContent).toContain('Nguyễn Văn A');
      // VI 24h GMT+7 timestamp (2026-11-27T05:30:00Z -> 27/11/2026 · 12:30 (GMT+7))
      expect(screen.getByTestId('audit-time-1').textContent).toContain(
        '27/11/2026 · 12:30 (GMT+7)',
      );
      // resource is NOT counted inside flagged ('0 cần rà soát / cảnh báo', '1 nguồn web / khác')
      const breakdown = screen.getByTestId('audit-outcome-breakdown').textContent ?? '';
      expect(breakdown).toContain('1 đã xác minh');
      expect(breakdown).toContain('0 cần rà soát / cảnh báo');
      expect(breakdown).toContain('1 nguồn web / khác');

      // Verdict filter narrows to 'resource'
      fireEvent.change(screen.getByTestId('audit-verdict-filter'), {
        target: { value: 'resource' },
      });
      expect(screen.getByTestId('audit-entry-1')).toBeDefined();
      expect(screen.queryByTestId('audit-entry-2')).toBeNull();

      // Searching a nonexistent user preserves global KPIs (42, 5) and shows filtered-empty state
      fireEvent.change(screen.getByPlaceholderText(/tên đăng nhập/i), {
        target: { value: 'nobody' },
      });
      await waitFor(() => expect(screen.getByTestId('audit-reset-filters-btn')).toBeDefined());
      expect(screen.getByTestId('audit-total-events').textContent).toBe('42');
      expect(screen.getByTestId('audit-unique-actors').textContent).toBe('5');
    });
  });

  describe('Loop Round 2 — Stage 3 Ring Gauge, Admin Copy Polish & Teacher Class Detail Polish', () => {
    it('SystemHealthPage: renders centered numeric hit rate inside Stage 3 ring (98%) and — when 0 lookups', async () => {
      vi.spyOn(api, 'getSystemHealth').mockResolvedValueOnce({
        status: 'ok',
        totals: { users: 5, admins: 1, teachers: 1, students: 3, essays: 12, verdicts: 100 },
        verdict_label_counts: { verified: 100 },
        cache_stats: {
          local_papers_count: 127102,
          local_queries_count: 112,
          hit_rate_percent: 98.2,
        },
      });

      const { unmount } = renderWithProviders(<SystemHealthPage />, {
        user: makeUser('admin', 'ultra'),
      });

      const ring = await screen.findByTestId('stage3-hit-rate-ring');
      expect(ring.getAttribute('data-score')).toBe('98.2');
      const valueEl = screen.getByTestId('stage3-hit-rate-value');
      expect(ring.contains(valueEl)).toBe(true);
      expect(valueEl.textContent?.trim()).toBe('98%');
      expect(valueEl.className).toContain('text-slate-900');
      expect(valueEl.className).toContain('dark:text-slate-100');
      expect(valueEl.className).toContain('font-bold');
      expect(ring.textContent?.trim()).toBe('98%');
      unmount();

      // 0 lookups -> renders — centered inside the ring
      vi.spyOn(api, 'getSystemHealth').mockResolvedValueOnce({
        status: 'ok',
        totals: { users: 5, admins: 1, teachers: 1, students: 3, essays: 0, verdicts: 0 },
        verdict_label_counts: {},
        cache_stats: {
          local_papers_count: 127102,
          local_queries_count: 0,
          total_hits: 0,
          hit_rate_percent: 0,
        },
      });

      renderWithProviders(<SystemHealthPage />, {
        user: makeUser('admin', 'ultra'),
      });

      const zeroRing = await screen.findByTestId('stage3-hit-rate-ring');
      expect(zeroRing.getAttribute('data-score')).toBe('0.0');
      expect(screen.getByTestId('stage3-hit-rate-value').textContent?.trim()).toBe('—');
    });

    it('PromoManagementPage: uses clean STATUS / ACTIONS (TRẠNG THÁI / THAO TÁC) headers and renders validation error once inline (reserving top alert for API errors)', async () => {
      const promoFixture = {
        stats: { total_codes: 1, active_codes: 1, total_redemptions: 1, total_discount_usd: 10 },
        promos: [
          {
            id: 1,
            code: 'CITRA1',
            description: 'Launch offer',
            discount_type: 'percent' as const,
            discount_value: 20,
            max_discount_usd: null,
            min_amount_usd: 0,
            applicable_tiers: 'all' as const,
            applicable_cycles: 'all' as const,
            max_uses: 100,
            used_count: 1,
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
        ],
      };
      vi.spyOn(api, 'listAdminPromoCodes').mockResolvedValue(promoFixture);
      const createSpy = vi
        .spyOn(api, 'createAdminPromoCode')
        .mockRejectedValueOnce(new Error('API 409: Promo code already exists'));

      const { container, unmount } = renderWithProviders(<PromoManagementPage />, {
        user: makeUser('admin', 'ultra'),
        initialRoute: '/admin/promos',
      });

      await waitFor(() => expect(screen.getByTestId('promo-row-CITRA1')).toBeDefined());
      const enHeaders = Array.from(container.querySelectorAll('thead th')).map((th) =>
        th.textContent?.trim(),
      );
      expect(enHeaders).toContain('Status');
      expect(enHeaders).toContain('Actions');
      expect(enHeaders).not.toContain('Status / Actions');

      // Submitting invalid promo code shows inline error ONCE and keeps top server alert hidden
      fireEvent.click(screen.getByTestId('create-promo-btn'));
      fireEvent.change(screen.getByTestId('promo-code-input'), {
        target: { value: 'BAD' },
      });
      fireEvent.click(screen.getByTestId('promo-submit-btn'));

      const inlineErr = await screen.findByTestId('promo-code-inline-error');
      const expectedMsg =
        'Promo code must be exactly 6 uppercase alphanumeric characters (A-Z, 0-9).';
      expect(inlineErr.textContent).toBe(expectedMsg);
      expect(screen.queryByTestId('promo-form-server-error')).toBeNull();
      const modalText = screen.getByTestId('promo-form-modal').textContent ?? '';
      expect(modalText.split(expectedMsg).length - 1).toBe(1);
      expect(createSpy).not.toHaveBeenCalled();

      // Valid submission that fails server-side renders inside top server alert
      fireEvent.change(screen.getByTestId('promo-code-input'), {
        target: { value: 'VALID6' },
      });
      fireEvent.click(screen.getByTestId('promo-submit-btn'));
      const serverAlert = await screen.findByTestId('promo-form-server-error');
      expect(serverAlert.textContent).toContain('This promo code already exists.');
      unmount();

      // Vietnamese column headers: Trạng thái & Thao tác
      await i18n.changeLanguage('vi');
      vi.spyOn(api, 'listAdminPromoCodes').mockResolvedValue(promoFixture);
      const { container: viContainer } = renderWithProviders(<PromoManagementPage />, {
        user: makeUser('admin', 'ultra'),
        initialRoute: '/admin/promos',
      });
      await waitFor(() => expect(screen.getByTestId('promo-row-CITRA1')).toBeDefined());
      const viHeaders = Array.from(viContainer.querySelectorAll('thead th')).map((th) =>
        th.textContent?.trim(),
      );
      expect(viHeaders).toContain('Trạng thái');
      expect(viHeaders).toContain('Thao tác');
      expect(viHeaders).not.toContain('Kích hoạt / Thao tác');
    });

    it('AccountManagementPage & UserFormDialog: renders clean Vietnamese "Gói dịch vụ" label without mixed "(Plan Tier)" suffix', async () => {
      await i18n.changeLanguage('vi');
      const selfAdmin = makeUser('admin', 'ultra', { id: 1, username: 'admin_root' });
      const studentUser = makeUser('user', 'basic', {
        id: 2,
        username: 'sv_linh',
        full_name: 'Lê Thị Linh',
      });
      vi.spyOn(api, 'listUsers').mockResolvedValue([selfAdmin, studentUser]);

      renderWithProviders(<AccountManagementPage />, {
        user: selfAdmin,
        initialRoute: '/admin/users',
      });

      await waitFor(() => expect(screen.getByText(/sv_linh/)).toBeDefined());
      fireEvent.click(screen.getByLabelText('Chỉnh sửa tài khoản sv_linh'));

      const planLabel = await waitFor(() => {
        const el = document.querySelector('label[for="user-form-plan-tier-select"]');
        expect(el).not.toBeNull();
        return el!;
      });
      expect(planLabel.textContent?.trim()).toBe('Gói dịch vụ');
      expect(planLabel.textContent).not.toContain('(Plan Tier)');
    });

    it('ClassDetailPage: displays clean full names without raw (user) suffix on submission rows & flagged citations and formats CIS strictly as XX.X / 100', async () => {
      const cls = makeClassFixture({ id: 22, name: 'KLTN 2026', join_code: 'CITRA22' });
      vi.spyOn(api, 'listMyClasses').mockResolvedValue([cls]);
      vi.spyOn(api, 'listClassStudents').mockResolvedValue([
        {
          id: 2,
          username: 'user',
          email: 'student@citra.edu',
          full_name: 'Nguyen Van A (user)',
          is_active: true,
        },
      ]);
      vi.spyOn(api, 'listClassEssays').mockResolvedValue([
        {
          id: 301,
          filename: 'Thesis_Final.pdf',
          num_pages: 28,
          user_id: 2,
          username: 'user',
          uploaded_at: '2026-11-24T08:00:00Z',
          job_status: 'completed',
          cis_score: 92.6,
        },
      ]);
      vi.spyOn(api, 'getClassAnalytics').mockResolvedValue({
        class_id: 22,
        class_name: 'KLTN 2026',
        total_students: 1,
        total_essays: 1,
        avg_cis: 92.6,
        recency_5yr_ratio: 75.0,
        cis_distribution: { excellent: 1, good: 0, fair: 0, poor: 0 },
        verdict_breakdown: { verified: 12, metadata_error: 1 },
        top_triggered_rules: [],
        shared_hallucinations: [
          {
            citation_raw: 'Doe, J. (2025). Unverified Reference Paper.',
            label: 'suspected_hallucination',
            student_count: 1,
            occurrence_count: 2,
            students: ['user'],
            essay_ids: [301, 302],
            is_shared: true,
          },
        ],
      });

      const { container } = renderWithProviders(
        <Routes>
          <Route path="/teacher/classes/:classId" element={<ClassDetailPage />} />
        </Routes>,
        {
          user: makeUser('teacher', 'pro'),
          initialRoute: '/teacher/classes/22',
        },
      );

      const row = await screen.findByTestId('class-essay-row-301');
      expect(row.textContent).toContain('Nguyen Van A');
      expect(row.textContent).not.toContain('(user)');
      expect(row.textContent).toContain('Score 92.6 / 100');
      expect(row.textContent).not.toContain('92.6%');

      const avgCis = screen.getByTestId('cohort-avg-cis-value');
      expect(avgCis.textContent?.trim()).toBe('92.6 / 100');
      expect(avgCis.textContent).not.toContain('%');

      // Flagged citations across submissions resolves 'user' -> clean full name 'Nguyen Van A'
      expect(container.textContent).toContain('Shared in 2 papers · Nguyen Van A');
      expect(container.textContent).not.toContain('(user)');
    });
  });
});
