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

      // Double-click Approve on 201 -> only 1 API call while in flight (Review Focus #1)
      const approveBtn = screen.getByTestId('pending-approve-btn-201');
      fireEvent.click(approveBtn);
      fireEvent.click(approveBtn);
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

      // Item 202 ('unverified') is now visible
      const flagBtn = await screen.findByTestId('pending-confirm-issue-btn-202');

      // Next override call rejects -> item 202 stays in the queue (Review Focus #1)
      fireEvent.click(flagBtn);
      await waitFor(() => {
        expect(overrideSpy).toHaveBeenCalledTimes(2);
      });
      expect(screen.getByTestId('pending-review-row-202')).toBeDefined();

      // Retry -> succeeds with normalized new_label: 'metadata_error' (Review Focus #3)
      fireEvent.click(screen.getByTestId('pending-confirm-issue-btn-202'));
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
      expect(text).toContain('MEMBER DIRECTORY');
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
      expect(text).toContain('Suspected Fabrication');
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
      expect(text).toContain('Metadata Discrepancy');
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
});
