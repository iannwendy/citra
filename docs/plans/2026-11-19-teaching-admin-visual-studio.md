# Teaching & Admin "Visual Action Studio" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign all 6 Teaching & Admin Console pages (`MyClassesPage` + `ClassDetailPage`, `PendingReviewsPage`, `AccountManagementPage`, `PromoManagementPage`, `SystemHealthPage`, `AuditLogPage`) into a low-text, visually engaging, non-tech-friendly "Visual Action Studio" with inline teacher adjudication, SVG charts/diagrams, progressive disclosure, and 120Hz motion primitives.

**Architecture:** Extract a pure bilingual guidance & label-humanizer module (`web/src/lib/teacherGuidance.ts`) plus lightweight, zero-dependency visual studio primitives (`web/src/components/ui/studio-visuals.tsx`) built atop CITRA's existing `transitions.tsx` (`DonutChart`, `ScoreRing`, `NumberPopIn`, `useSlidingPill`, `AccordionExpand`, `TactileToggle`, `CardHoverTilt`, `TextMorph`, `IconSwap`, `SuccessCheck`) and `motion-primitives.tsx` (`m`, `AnimatePresence`). Each page replaces fake code filenames (`*.queue`, `*.json`, `*.log`), `<Terminal />` icons, numbered `01–06` corner tags, and raw `R-*` / snake_case strings with `DashboardPage`-consistent 3-dot + UPPERCASE section headers, above-the-fold visual charts, and direct 1-click actions while preserving existing `data-testid` and accessibility contracts.

**Tech Stack:** React 18, TypeScript 5, Tailwind CSS 3.4, `motion/react` (`LazyMotion` + `domMax`), `react-i18next`, `lucide-react`, Vitest + React Testing Library.

**Spec:** `docs/plans/2026-11-19-teaching-admin-visual-studio-design.md`

## Global Constraints

- Zero third-party charting libraries added to `web/package.json`; all visualizations use SVG + CSS transitions and primitives in `web/src/components/ui/transitions.tsx` and `web/src/components/ui/studio-visuals.tsx`.
- Preserve the 3 colored window dots (`bg-red-400/80`, `bg-amber-400/80`, `bg-emerald-400/80`) + vertical `<Separator orientation="vertical" className="h-4" />` on section headers while removing `<Terminal />` icons and replacing all fake filenames (`pending_reviews.queue`, `teacher_classes.registry`, `iam_directory.users`, `billing_engine.promo_codes`, `telemetry_verdict_distribution.json`, `telemetry_upstream_circuits.json`, `immutable_audit_trail.log`) with UPPERCASE human section titles matching `DashboardPage.tsx`.
- Zero raw symbolic rule codes (`R-*`), zero `Mismatch: the ...` fragments, and zero raw provider tags (`Crossref`, `OpenAlex`) rendered on `PendingReviewsPage` or `ClassDetailPage` surfaces.
- Full bilingual parity (`vi` and `en`), dark/light theme contrast, `prefers-reduced-motion: reduce` compliance, zero horizontal overflow at `<= 430px` viewport width, and zero edits to `web/src/pages/essay/index.ts` (`deadCode.test.ts` invariant).
- All existing Vitest suites (`340+` tests), `npm run lint`, `npx tsc --noEmit`, and `npm run build` must pass with 0 errors.

## Review Focus

1. **Concurrent click or API error during inline adjudication (`PendingReviewsPage`):** Clicking `✓ Approve` or `⚑ Confirm Issue` disables actions for that `verdict_id` while in flight; if `api.overrideVerdict` rejects, the item remains in the queue and displays an error toast.
2. **Filtered category emptied while other queue items remain (`PendingReviewsPage`):** Clearing the last citation in an active severity filter when other categories still have items shows a filter-reset empty state (*"Xem tất cả mục còn lại"* / *"Show all remaining items"*) rather than the global "queue empty" state.
3. **Undecided `'unresolved'` or legacy `'unverified'` inline confirmation (`PendingReviewsPage`):** Clicking the issue-flag button on `'unresolved'` or `'unverified'` sends `new_label: 'metadata_error'` (never raw `'unverified'`, which HTTP 422s on the backend, and never `'unresolved'`, which leaves reviewed items stuck as undecided).
4. **Undefined, zero-limit, Unlimited, or over-100% user quotas (`AccountManagementPage`):** Visual quota progress bars clamp strictly to `[0, 100]%` and never render `NaN%` when `quota` is `undefined`, `monthly_uploads_limit <= 0`, or admin Unlimited.
5. **Idle 0-call upstream providers & zero-verdict cohorts (`SystemHealthPage` & `ClassDetailPage`):** Providers with `total_calls === 0` or `has_latency_sample === false` render `'—'` with no misleading `0 ms` / `100%` bar fill, and `0`-total charts render neutral empty rings without `NaN` SVG path values.

---

### Task 1: Shared Bilingual Teacher Guidance & Visual Studio Primitives

**Files:**
- Create: `web/src/lib/teacherGuidance.ts`
- Create: `web/src/components/ui/studio-visuals.tsx`
- Test: `web/src/lib/teacherGuidance.test.ts`

**Interfaces:**
- Consumes: `PendingVerdict`, `ValidationLabel` from `@/api/client`; `extractObservedWebMeta` from `@/lib/verdictExplanation`; `Separator` from `@/components/ui/separator`; `useSlidingPill` from `@/components/ui/transitions`.
- Produces:
  - `web/src/lib/teacherGuidance.ts`:
    - `export type ReviewSeverityKey = 'critical' | 'warning' | 'incomplete' | 'uncertain'`
    - `export interface TeacherReviewGuidance { severity: ReviewSeverityKey; headline: string; actionHint: string; confirmButtonLabel: string; confirmNewLabel: ValidationLabel }`
    - `export function getTeacherReviewGuidance(r: PendingVerdict, lang: 'en' | 'vi'): TeacherReviewGuidance`
    - `export function getHumanVerdictMeta(rawLabel: string, lang: 'en' | 'vi'): { label: string; colorHex: string; barClass: string; badgeClass: string }`
  - `web/src/components/ui/studio-visuals.tsx`:
    - `export function StudioWindowHeader(props: { title: string; badge?: React.ReactNode; rightSlot?: React.ReactNode; className?: string }): JSX.Element`
    - `export function SlidingFilterPills<K extends string>(props: { options: Array<{ key: K; label: React.ReactNode; testId?: string }>; value: K; onChange: (next: K) => void; ariaLabel: string; className?: string }): JSX.Element`
    - `export function ProportionalBarRow(props: { label: React.ReactNode; count: number | string; value: number; max: number; barClass?: string; sublabel?: React.ReactNode; testId?: string }): JSX.Element`
    - `export interface PipelineStageNode { id: string; stepLabel: string; title: string; metric: React.ReactNode; statusText: string; level: 'healthy' | 'degraded' | 'down'; icon: React.ReactNode }`
    - `export function PipelineStageFlow(props: { stages: PipelineStageNode[]; 'data-testid'?: string }): JSX.Element`

- [ ] **Step 1: Write failing unit tests in `web/src/lib/teacherGuidance.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { getTeacherReviewGuidance, getHumanVerdictMeta } from './teacherGuidance';
import type { PendingVerdict } from '@/api/client';

const base = (over: Partial<PendingVerdict> = {}): PendingVerdict => ({
  verdict_id: 1,
  essay_id: 10,
  filename: 'paper.pdf',
  student_username: 'sv_an',
  citation_raw: 'Clark & Gardner (2018)',
  label: 'suspected_hallucination',
  confidence: 0.35,
  reasoning: '',
  validated_at: '2026-11-19T00:00:00Z',
  ...over,
});

describe('getTeacherReviewGuidance', () => {
  it('maps suspected_hallucination to critical plain-language guidance without raw R-* codes', () => {
    const g = getTeacherReviewGuidance(
      base({ triggered_rules: ['R-HALLUCINATED-SOURCE', 'R-WEAK-EVIDENCE'], mismatched_fields: ['title', 'authors'] }),
      'vi',
    );
    expect(g.severity).toBe('critical');
    expect(g.headline).not.toMatch(/R-[A-Z]/);
    expect(g.headline).not.toContain('Mismatch:');
    expect(g.confirmNewLabel).toBe('suspected_hallucination');
    expect(g.confirmButtonLabel).toBe('Giữ cảnh báo');
  });

  it('maps R-INCOMPLETE-METADATA to incomplete severity and preserves VI academic identifier phrase', () => {
    const g = getTeacherReviewGuidance(
      base({ label: 'metadata_error', triggered_rules: ['R-INCOMPLETE-METADATA'] }),
      'vi',
    );
    expect(g.severity).toBe('incomplete');
    expect(`${g.headline} ${g.actionHint}`).toMatch(/chưa đủ thông tin định danh học thuật/i);
    expect(g.confirmNewLabel).toBe('metadata_error');
  });

  it('normalizes unresolved and legacy unverified to confirmNewLabel="metadata_error" (Review Focus #3)', () => {
    const u1 = getTeacherReviewGuidance(base({ label: 'unresolved' }), 'vi');
    const u2 = getTeacherReviewGuidance(base({ label: 'unverified' }), 'en');
    expect(u1.severity).toBe('uncertain');
    expect(u1.confirmNewLabel).toBe('metadata_error');
    expect(u1.confirmButtonLabel).toBe('Đánh dấu lỗi');
    expect(u2.confirmNewLabel).toBe('metadata_error');
    expect(u2.confirmButtonLabel).toBe('Flag Issue');
  });

  it('humanizes raw snake_case verdict labels in VI and EN', () => {
    expect(getHumanVerdictMeta('suspected_hallucination', 'vi').label).toBe('Nghi vấn ngụy tạo');
    expect(getHumanVerdictMeta('metadata_error', 'en').label).toBe('Metadata Discrepancy');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/lib/teacherGuidance.test.ts`
Expected: FAIL with `Cannot find module './teacherGuidance'`

- [ ] **Step 3: Implement `web/src/lib/teacherGuidance.ts` and `web/src/components/ui/studio-visuals.tsx`**

Implement `getTeacherReviewGuidance` covering retracted (`is_retracted` / `R-RETRACTED-PAPER`), URL mismatch (`R-URL-CONTENT-MISMATCH`), incomplete reference (`R-INCOMPLETE-METADATA`, including `"Trích dẫn chưa đủ thông tin định danh học thuật"` in VI), suspected hallucination, metadata field discrepancies (natural Vietnamese/English field list: `tên bài`, `tác giả`, `năm xuất bản`, `nơi công bố`, `mã DOI` — never `"the title"`), and `unresolved` / `'unverified'` (`confirmNewLabel: 'metadata_error'`). Implement `StudioWindowHeader`, `SlidingFilterPills`, `ProportionalBarRow`, and `PipelineStageFlow` in `studio-visuals.tsx`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/lib/teacherGuidance.test.ts`
Expected: PASS

---

### Task 2: `PendingReviewsPage.tsx` — Submission-Grouped Adjudication Studio

**Files:**
- Modify: `web/src/pages/PendingReviewsPage.tsx`
- Create: `web/src/pages/TeachingAdminVisualStudio.test.tsx`

**Interfaces:**
- Consumes: `getTeacherReviewGuidance`, `ReviewSeverityKey` from `@/lib/teacherGuidance`; `StudioWindowHeader`, `SlidingFilterPills` from `@/components/ui/studio-visuals`; `DonutChart`, `NumberPopIn`, `AccordionExpand`, `SymmetricChevron`, `SuccessCheck` from `@/components/ui/transitions`; `m`, `AnimatePresence` from `@/components/ui/motion-primitives`; `api.overrideVerdict` from `@/api/client`.
- Produces: Redesigned `PendingReviewsPage` preserving `pending-filter-all-classes`, `pending-kpi-incomplete`, `pending-kpi-unresolved`, `pending-review-row-${id}`, `pending-marker-${id}`, `pending-retracted-${id}`, `pending-url-status-${id}`, `pending-observed-meta-${id}`, plus new `pending-approve-btn-${id}` and `pending-confirm-issue-btn-${id}`.

- [ ] **Step 1: Write failing tests for `PendingReviewsPage` in `web/src/pages/TeachingAdminVisualStudio.test.tsx`**

```tsx
it('PendingReviewsPage hides pending_reviews.queue, R-* codes, Mismatch chips, and Crossref tags, groups by submission, and adjudicates inline with double-click + error guards', async () => {
  // Mock listMyClasses + listPendingReviews with 2 items in 1810.04805v2.pdf (1 suspected_hallucination with R-STYLE-INCONSISTENT/R-HALLUCINATED-SOURCE/Crossref, 1 unresolved)
  // Assert container.textContent does NOT contain 'pending_reviews.queue', 'R-STYLE-INCONSISTENT', 'R-HALLUCINATED-SOURCE', 'Mismatch:', or 'Crossref'
  // Assert DonutChart (.t-donut) is rendered
  // Filter to 'critical' -> approve item #1 -> assert filter-empty reset prompt appears while item #2 still exists (Review Focus #2)
  // Click reset filter -> click Confirm Issue on unresolved item #2 -> assert api.overrideVerdict called with new_label: 'metadata_error' (Review Focus #3)
  // Test rejected api.overrideVerdict -> assert item stays in DOM and error toast fires (Review Focus #1)
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/pages/TeachingAdminVisualStudio.test.tsx`
Expected: FAIL (`pending_reviews.queue` and `R-STYLE-INCONSISTENT` still present; `pending-approve-btn-*` missing)

- [ ] **Step 3: Implement `PendingReviewsPage.tsx` Visual Action Studio**

Replace IDE header/queue chrome with:
1. Clean page header + above-the-fold **Visual Triage Banner**: `DonutChart` (`size={84}`, `thickness={11}`) + interactive severity filter cards (`all`, `critical`, `warning`, `incomplete` [`data-testid="pending-kpi-incomplete"`], `uncertain` [`data-testid="pending-kpi-unresolved"`]) with `<NumberPopIn />`.
2. `StudioWindowHeader` (`DANH SÁCH CẦN DUYỆT` / `REVIEW QUEUE`) containing class filter chips (`pending-filter-all-classes` + class pills) and view switcher (`Gom theo bài` / `Từng trích dẫn`).
3. Submission-grouped collapsible cards (`AccordionExpand` open by default) where each citation card (`pending-review-row-${r.verdict_id}`) renders marker/verdict/retracted/actionable-URL pills (suppressing `unchecked`), observed web title box (`pending-observed-meta-${r.verdict_id}`), plain-language **Vấn đề + Việc nên làm** box from `getTeacherReviewGuidance`, 2-line serif citation quote, and inline action bar (`pending-approve-btn-${r.verdict_id}`, `pending-confirm-issue-btn-${r.verdict_id}`, `Xem bài ↗`) with `e.stopPropagation()`, `adjudicatingIds` in-flight guard, `SuccessCheck` flash (`180ms`), and `AnimatePresence` smooth exit.

- [ ] **Step 4: Run new and existing `PendingReviewsPage` tests**

Run: `cd web && npx vitest run src/pages/TeachingAdminVisualStudio.test.tsx src/pages/AdminTeacherFlows.test.tsx src/pages/ClassroomSandboxAndModalsV370.test.tsx src/__tests__/wave1_2_3_remediation.test.tsx`
Expected: PASS

---

### Task 3: `MyClassesPage.tsx` & `ClassDetailPage.tsx` — Visual Classroom Hub

**Files:**
- Modify: `web/src/pages/MyClassesPage.tsx`
- Modify: `web/src/pages/ClassDetailPage.tsx`
- Modify: `web/src/pages/TeachingAdminVisualStudio.test.tsx`

**Interfaces:**
- Consumes: `StudioWindowHeader`, `ProportionalBarRow` from `@/components/ui/studio-visuals`; `getHumanVerdictMeta` from `@/lib/teacherGuidance`; `CardHoverTilt`, `DonutChart`, `ScoreRing`, `NumberPopIn`, `TextMorph` from `@/components/ui/transitions`.
- Produces: Redesigned `MyClassesPage` and `ClassDetailPage` preserving all class CRUD, CSV/ZIP export, join-code copy/regenerate, student add/remove, and `cohort-analytics-panel` contracts.

- [ ] **Step 1: Append failing Classroom tests in `web/src/pages/TeachingAdminVisualStudio.test.tsx`**

Assert `MyClassesPage` removes `teacher_classes.registry` and `FACULTY WORKSPACE IDE`, renders `<CardHoverTilt>` (`.t-tilt`) cohort cards with 1-click join-code copy (`e.stopPropagation()` does not navigate), and `ClassDetailPage` removes `CROSS-STUDENT ANOMALY ENGINE` and raw `R-*` IDs in Most Common Citation Issues while rendering `<ScoreRing>` gauges and `<DonutChart>` safely even when `total_essays === 0` (Review Focus #5).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/pages/TeachingAdminVisualStudio.test.tsx`
Expected: FAIL (`teacher_classes.registry` and `CROSS-STUDENT ANOMALY ENGINE` still present)

- [ ] **Step 3: Implement `MyClassesPage.tsx` & `ClassDetailPage.tsx` redesign**

- In `MyClassesPage.tsx`: Clean header (preserving localized `'${n} LỚP ĐANG HOẠT ĐỘNG'` / `'${n} lớp học'` strings), 4 visual stat cards without `01–04` tags (`<NumberPopIn />` + highlighted `needs-review-kpi-link`), `StudioWindowHeader` (`DANH SÁCH LỚP HỌC` / `MY CLASSES`), 2-column `<CardHoverTilt maxTilt={3.5} />` class cards with 1-click Copy Join Code button (`<TextMorph />`), and clean enrolled classes card (`enrolled-classes-section`).
- In `ClassDetailPage.tsx`: Clean cohort header with interactive ticket pill (`class-join-code-badge`), `<ScoreRing>` cards for `avg_cis` and `recency_5yr_ratio`, `StudioWindowHeader` (`TỔNG QUAN CHẤT LƯỢNG TRÍCH DẪN` / `CLASS CITATION HEALTH`) inside `cohort-analytics-panel` pairing `<DonutChart>` with `cohort-verdict-breakdown`, animated 4-grade bar histogram (`A / B / C / D`), `<ProportionalBarRow>` ranking of top class issues using `getRuleDisplayName` (no raw `R-*` codes), human-labeled shared flagged citation cards, and `<ScoreRing size={30} />` on completed student submissions.

- [ ] **Step 4: Run Classroom test suites**

Run: `cd web && npx vitest run src/pages/TeachingAdminVisualStudio.test.tsx src/components/ClassDialogs.test.tsx src/pages/I18nAndHygiene.test.tsx src/pages/ClassroomSandboxAndModalsV370.test.tsx src/__tests__/wave1_2_3_remediation.test.tsx`
Expected: PASS

---

### Task 4: `AccountManagementPage.tsx` & `PromoManagementPage.tsx` — Visual Member & Campaign Studios

**Files:**
- Modify: `web/src/pages/AccountManagementPage.tsx`
- Modify: `web/src/pages/PromoManagementPage.tsx`
- Modify: `web/src/pages/TeachingAdminVisualStudio.test.tsx`

**Interfaces:**
- Consumes: `StudioWindowHeader`, `SlidingFilterPills` from `@/components/ui/studio-visuals`; `DonutChart`, `NumberPopIn`, `TactileToggle`, `IconSwap` from `@/components/ui/transitions`.
- Produces: Redesigned `AccountManagementPage` (preserving `user-plan-quota-${id}`) and `PromoManagementPage` (preserving `create-promo-btn`, `promo-search-input`, `kpi-*`, `promo-row-${code}`, `promo-toggle-${code}`, `promo-delete-${code}`, and accessible modals).

- [ ] **Step 1: Append failing Accounts & Promo tests in `web/src/pages/TeachingAdminVisualStudio.test.tsx`**

Assert `AccountManagementPage` removes `iam_directory.users` & `IAM IDENTITY DIRECTORY`, renders role `DonutChart` + plan distribution bar + clamped `[0, 100]%` quota mini-bar without `NaN` across `undefined`, `0`-limit, over-limit (`60/50`), and admin `Unlimited` quotas (Review Focus #4); assert `PromoManagementPage` removes `billing_engine.promo_codes` & `6-CHAR ISO COUPON STANDARD` and renders `<TactileToggle>` (`role="switch"`) on `promo-toggle-${code}`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/pages/TeachingAdminVisualStudio.test.tsx`
Expected: FAIL (`iam_directory.users` and `billing_engine.promo_codes` still rendered)

- [ ] **Step 3: Implement `AccountManagementPage.tsx` & `PromoManagementPage.tsx` redesign**

- In `AccountManagementPage.tsx`: Clean header + **Ecosystem Overview Bar** pairing a Role `<DonutChart>` (*Sinh viên*, *Giảng viên*, *Quản trị*) with `<NumberPopIn />` counters and a Plan Tier stacked bar (*Basic / Pro / Ultra*). Replace native `<Select>` filters with `<SlidingFilterPills>` for Role and Status inside `StudioWindowHeader` (`DANH BẠ TÀI KHOẢN` / `MEMBER DIRECTORY`). Enhance `user-plan-quota-${u.id}` with a clamped proportional quota bar beneath the tier + `usage` label (`Unlimited` / `12/50` / `—`) and avatar initials fallback.
- In `PromoManagementPage.tsx`: Concise 1-line subtitle, 4 `<NumberPopIn />` KPI cards + active vs paused campaign ratio bar, `StudioWindowHeader` (`CHIẾN DỊCH MÃ GIẢM GIÁ` / `PROMO CAMPAIGNS`), `<SlidingFilterPills>` for Discount Type & Status, perforated ticket-style coupon pills with `<IconSwap>` copy check, color-adaptive redemption progress bars, and `<TactileToggle data-testid="promo-toggle-${promo.code}" />` inline switch.

- [ ] **Step 4: Run Accounts & Promo test suites**

Run: `cd web && npx vitest run src/pages/TeachingAdminVisualStudio.test.tsx src/pages/OperationalTelemetryAndLifecycle.test.tsx src/pages/PricingAndBilling.test.tsx`
Expected: PASS

---

### Task 5: `SystemHealthPage.tsx` & `AuditLogPage.tsx` — Visual System Pulse & Review Timeline

**Files:**
- Modify: `web/src/pages/SystemHealthPage.tsx`
- Modify: `web/src/pages/AuditLogPage.tsx`
- Modify: `web/src/pages/TeachingAdminVisualStudio.test.tsx`

**Interfaces:**
- Consumes: `StudioWindowHeader`, `ProportionalBarRow`, `PipelineStageFlow` from `@/components/ui/studio-visuals`; `getHumanVerdictMeta` from `@/lib/teacherGuidance`; `DonutChart`, `ScoreRing`, `NumberPopIn`, `AccordionExpand`, `SymmetricChevron` from `@/components/ui/transitions`.
- Produces: Redesigned `SystemHealthPage` (preserving `summarizeHealth` and all telemetry `data-testid`s, with low-level engine internals inside a collapsible `AccordionExpand` drawer) and `AuditLogPage` (preserving `AUDIT_PAGE_SIZE` and all audit `data-testid`s, replacing the raw table with a visual badge-transition timeline).

- [ ] **Step 1: Append failing System Health & Audit Log tests in `web/src/pages/TeachingAdminVisualStudio.test.tsx`**

Assert `SystemHealthPage` removes `telemetry_verdict_distribution.json` and `telemetry_upstream_circuits.json`, renders the 3-stage `PipelineStageFlow` diagram (`data-testid="system-pipeline-flow"`), humanizes verdict labels (no raw `suspected_hallucination`), collapses advanced diagnostics (`data-open="false"` by default, toggles to `"true"` on button click), and guards 0-call providers with `'—'` (Review Focus #5); assert `AuditLogPage` removes `immutable_audit_trail.log` and `IMMUTABLE COMPLIANCE LEDGER` and renders human transition badges instead of raw `metadata_error → verified`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/pages/TeachingAdminVisualStudio.test.tsx`
Expected: FAIL (`telemetry_verdict_distribution.json` and `immutable_audit_trail.log` still rendered)

- [ ] **Step 3: Implement `SystemHealthPage.tsx` & `AuditLogPage.tsx` redesign**

- In `SystemHealthPage.tsx`:
  1. Clean status header (`health-status-pill`, `clear-cache-btn`) + **3-Stage `<PipelineStageFlow data-testid="system-pipeline-flow" />`** (`Đọc & Lưu trữ Tài liệu` ➔ `15+ Nguồn Học thuật` ➔ `Bộ nhớ Tăng tốc`).
  2. Compact platform metrics strip (`<NumberPopIn />`, zero `01–06` tags) + 2-column visual chart row: Left = `StudioWindowHeader` (`PHÂN BỔ KẾT QUẢ KIỂM CHỨNG` / `VERDICT DISTRIBUTION`) with `<DonutChart>` + `getHumanVerdictMeta` `<ProportionalBarRow>` list; Right = `StudioWindowHeader` (`HIỆU SUẤT BỘ NHỚ TĂNG TỐC` / `CACHE & CORPUS`) wrapping `cache-stats` (`<ScoreRing>` hit rate + `dynamic-citation-cache-card`, `static-local-corpus-card`, `cache-by-source-section`, `local-corpus-by-source-section`).
  3. `StudioWindowHeader` (`KẾT NỐI NGUỒN HỌC THUẬT` / `SCHOLARLY DATA SOURCES`) inside `upstream-sources-panel` adding visual latency & success bars alongside existing `upstream-circuit-table` cells (strictly guarding `totalCalls === 0` / `!hasLatencySample` with `'—'`).
  4. Progressive-disclosure button + `<AccordionExpand open={diagnosticsOpen}>` housing `sqlite-wal-telemetry`, `b1-session-cache-panel`, and granular `cache-stat-*` tiles.
- In `AuditLogPage.tsx`:
  1. Clean header + 3-card summary pairing `<NumberPopIn />` (`audit-total-events`, `audit-unique-actors`) with a **Visual Outcome Ratio Bar** (*Duyệt hợp lệ* vs *Giữ cảnh báo*).
  2. `StudioWindowHeader` (`LỊCH SỬ DUYỆT TRÍCH DẪN` / `REVIEW ACTIVITY LOG`) + debounced search input + **Visual Activity Timeline** rendering avatar initials, formatted timestamp, `[Old Human Verdict Pill] ➔ [New Human Verdict Pill]` diagram, reviewer note bubble, and `#verdict_id` deep-link pill (`audit-verdict-link-${e.id}`). Place compact `<span data-testid="audit-page-size">` cleanly in the pagination footer (`audit-pagination`).

- [ ] **Step 4: Run System Health & Audit Log test suites**

Run: `cd web && npx vitest run src/pages/TeachingAdminVisualStudio.test.tsx src/pages/AdminTeacherFlows.test.tsx src/pages/BatchSseAndAdminV370.test.tsx src/pages/OperationalTelemetryAndLifecycle.test.tsx`
Expected: PASS

---

### Task 6: Full Regression Verification, Lint, Production Build & Documentation Sync

**Files:**
- Modify: `docs/README.md`

**Interfaces:**
- Consumes: All deliverables from Tasks 1–5.
- Produces: Zero-warning ESLint, TypeScript, Vitest (`340+` tests), production Vite bundle, and updated `docs/README.md` index.

- [ ] **Step 1: Update `docs/README.md` Section 4 (`plans/`) with links to the new Design Spec & Implementation Plan**

Add entry under `## 4. Đặc tả Thiết kế & Kế hoạch Triển khai (plans/)` referencing `2026-11-19-teaching-admin-visual-studio-design.md` and `2026-11-19-teaching-admin-visual-studio.md`.

- [ ] **Step 2: Run full frontend lint, TypeScript check, Vitest suite, and production build**

Run: `cd web && npm run lint && npx tsc --noEmit && npx vitest run && npm run build`
Expected: `0` ESLint errors, `0` TypeScript errors, all Vitest suites (`deadCode.test.ts` included) PASS, Vite build succeeds.
