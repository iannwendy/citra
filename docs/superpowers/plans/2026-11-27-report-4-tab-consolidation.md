# Report Workspace 4-Tab Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate the verification report top navigation from 6 tabs down to 4 task-oriented tabs (`Citations`, `In Document`, `Link Check`, `Network`) inside `EssayPage` with 120fps sliding transitions on a single canonical `/verification/report/:id` URL, folding `Issues` into a 1-click queue filter and folding `Verification` (`NeuralAlignmentPanel` + 5-step trace) into `Citations`'s Tier 3 Verification Details drawer.

**Architecture:** Extract `NeuralAlignmentPanel`, `hasNeuralAlignmentData`, and `VerificationTraceTimeline` as reusable exports from `LogicTracePage.tsx`, then streamline `ReportSummaryAndNavBar`, left queue filtering, and the Tier 3 drawer inside `EssayPage.tsx`. In `router.tsx`, convert legacy `/issues`, `/trace`, `/document`, and `/consistency` sub-routes into capability-gated `<Navigate replace />` redirects onto `/verification/report/:id` query parameters (`?filter=issues`, `?drawer=trace`, `?view=document`, `?view=consistency`) so `EssayPage` never unmounts during tab switching while keeping standalone `IssuesPage` / `LogicTracePage` exports intact for existing regression tests.

**Tech Stack:** React 18, TypeScript, React Router v6, Tailwind CSS v3.4, Vitest, Testing Library.

**Spec:** [2026-11-27-report-4-tab-consolidation-design.md](../specs/2026-11-27-report-4-tab-consolidation-design.md)

## Global Constraints

- Top report tab bar renders exactly 4 task tabs (`Citations`, `In Document`, `Link Check`, `Network`) inside one persistent `ReportSummaryAndNavBar`; `mode-issues-btn` and `mode-trace-btn` are removed from top navigation.
- All 4 tabs transition in-place inside `EssayPage` via `useSlidingPill` and `DirectionalStageSlide` with zero unmount or re-fetch.
- Single badge discipline: Tab 1 (`Citations`) shows at most one badge (`counts.actionableIssues`; red when critical issue exists, amber otherwise); Tab 3 (`Link Check`) shows an emerald dot when `linkingIssueCount === 0` or a compact amber count badge when `> 0`.
- All UI strings must be natural bilingual Vietnamese (`vi`) and English (`en`), with zero raw technical enum/rule ID leaks.
- Pro capability gating (`view_logic_trace`, `view_document_inspector`, `view_orphan_detection`) must remain intact for Basic users across tabs, Tier 3 drawer, and direct URL visits.
- Standalone exports of `IssuesPage`, `LogicTracePage`, `DocumentInspectorPage`, and `OrphanDetectionPage` must remain intact so existing unit test suites pass without regressions.
- Git commit discipline: atomic, explicit-path commits only (never `git add -A` or `git add .`, because unrelated modified files exist in the working tree).

## Review Focus

1. **Zero actionable issues via `/issues` or `?filter=issues`:** Visiting a clean report with `filter=issues` must render a clear bilingual empty state with a 1-click reset button (`Show all citations` / `Xem tất cả trích dẫn`), never a blank queue or undefined active item crash.
2. **Actionable issue parity on verified/web citations:** A `verified` or `resource` citation with a broken URL (`dead_link` / `fake_domain` / `R-URL-CONTENT-MISMATCH`) or abnormal `mapping_status` (`!== 'matched'`) must be included in Tab 1's single badge and in the `Issues` (`Cần xử lý`) filter without double-counting.
3. **Zero unmount & clean history on tab switches:** Switching across all 4 tabs updates `?view=` using `replace: true` while keeping `report-health-summary` and `report-view-tablist` as the exact same DOM node references and preserving `?citation=` if present.
4. **Missing semantic/abstract alignment in Tier 3 `Content Match` tab:** Selecting a URL resource or unmatched citation with no abstract/cross-lingual data and opening `2. Content Match` must show a calm bilingual fallback message rather than an empty blank panel (`null`).
5. **Basic-plan capability enforcement:** Basic users see zero `mode-issues-btn`/`mode-trace-btn`, see locked tabs opening `UpgradeModal`, see the Pro upgrade card inside Tier 3 (never `NeuralAlignmentPanel` or `VerificationTraceTimeline`), and are still blocked by `ProtectedRoute` when navigating directly to `/verification/report/:id/trace`.

---

## File Structure

- **Modify:** `web/src/pages/LogicTracePage.tsx` — Export `hasNeuralAlignmentData`, `NeuralAlignmentPanel`, and `VerificationTraceTimeline` for reuse inside `EssayPage.tsx` without altering `LogicTracePage`'s standalone behavior.
- **Modify:** `web/src/pages/EssayPage.tsx` — Streamline `ReportSummaryAndNavBar` to 4 tabs + single badge discipline; add `issues` queue filter + zero-count chip hiding + empty state; upgrade Tier 3 drawer to 4 inner tabs (`Sources`, `Content Match`, `Steps & Checks`, `Decision Flow`) and remove `/trace` jump link; sync `?view=` via `replace: true` and read `?filter=issues` / `?drawer=trace`.
- **Modify:** `web/src/pages/essay/EssayActionBar.tsx` — Keep 4-tab bar clean; remove dead contextual `/issues` and `/trace` link pills.
- **Modify:** `web/src/router.tsx` — Route legacy `/verification/report/:id/{issues,trace,document,consistency}` via `LegacyReportSubrouteRedirect` onto `/verification/report/:id` query params while preserving `ProtectedRoute` capability checks and `PAGE_TITLE_ROUTES`.
- **Create:** `web/src/pages/Report4TabConsolidation.test.tsx` — Focused Vitest suite verifying all 4 tasks and all 5 Review Focus failure modes.

---

### Task 1: Export Reusable `NeuralAlignmentPanel` & `VerificationTraceTimeline` from `LogicTracePage.tsx`

**Files:**
- Modify: `web/src/pages/LogicTracePage.tsx:466-800`
- Test: `web/src/pages/Report4TabConsolidation.test.tsx`

**Interfaces:**
- Produces in `web/src/pages/LogicTracePage.tsx`:
  - `export function hasNeuralAlignmentData(verdict: Verdict): boolean`
  - `export function NeuralAlignmentPanel({ verdict, lang }: { verdict: Verdict; lang: 'vi' | 'en' }): JSX.Element | null`
  - `export function VerificationTraceTimeline({ verdict, lang }: { verdict: Verdict; lang: 'vi' | 'en' }): JSX.Element`

- [ ] **Step 1: Write the failing test**

Create `web/src/pages/Report4TabConsolidation.test.tsx` testing the new exports from `LogicTracePage`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { makeVerdict } from '@/test-fixtures';
import {
  NeuralAlignmentPanel,
  VerificationTraceTimeline,
  hasNeuralAlignmentData,
} from './LogicTracePage';

describe('Task 1: Reusable Verification Trace & Neural Alignment exports', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('hasNeuralAlignmentData returns true when alignment/cross-lingual data exists and false for plain web resources or empty features', () => {
    const rich = makeVerdict({
      label: 'verified',
      features: {
        content_alignment_score: 0.82,
        best_evidence_sentence: 'Transformers rely solely on attention mechanisms.',
        citation_intent: 'methodology',
        stance_label: 'supported',
      },
    });
    const plainResource = makeVerdict({
      label: 'resource',
      features: { content_alignment_score: 0.5 },
    });
    const empty = makeVerdict({ label: 'suspected_hallucination', features: undefined });

    expect(hasNeuralAlignmentData(rich)).toBe(true);
    expect(hasNeuralAlignmentData(plainResource)).toBe(false);
    expect(hasNeuralAlignmentData(empty)).toBe(false);
  });

  it('renders NeuralAlignmentPanel and VerificationTraceTimeline in VI and EN', () => {
    const v = makeVerdict({
      label: 'verified',
      confidence: 0.94,
      triggered_rules: ['R-WELL-LINKED'],
      features: {
        title_sim_fuzzy: 0.96,
        content_alignment_score: 0.84,
        best_evidence_score: 0.88,
        best_cited_sentence: 'We follow Vaswani et al. for self-attention.',
        best_evidence_sentence: 'We propose a new simple network architecture, the Transformer.',
        citation_intent: 'methodology',
        stance_label: 'supported',
      },
    });

    const { unmount } = render(<NeuralAlignmentPanel verdict={v} lang="en" />);
    expect(screen.getByTestId('neural-alignment-panel')).toBeDefined();
    expect(screen.getByText(/Transformer/)).toBeDefined();
    unmount();

    render(<VerificationTraceTimeline verdict={v} lang="vi" />);
    const timeline = screen.getByTestId('verification-trace-timeline');
    expect(timeline.textContent).toContain('1. Đọc & ghép trích dẫn');
    expect(timeline.textContent).toContain('5. Kết quả kiểm tra');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/pages/Report4TabConsolidation.test.tsx`
Expected: FAIL because `hasNeuralAlignmentData`, `NeuralAlignmentPanel`, and `VerificationTraceTimeline` are not exported from `LogicTracePage.tsx`.

- [ ] **Step 3: Export `hasNeuralAlignmentData`, `NeuralAlignmentPanel`, and `VerificationTraceTimeline` in `web/src/pages/LogicTracePage.tsx`**

- Extract the early-return guard at `LogicTracePage.tsx:473-516` into `export function hasNeuralAlignmentData(verdict: Verdict): boolean` and call it inside `export function NeuralAlignmentPanel(...)`.
- Add `export function VerificationTraceTimeline({ verdict, lang }: { verdict: Verdict; lang: 'vi' | 'en' })` that wraps `buildTraceSteps(verdict, lang)` and maps `<TraceStepCard />` inside `<div data-testid="verification-trace-timeline">`.
- Reuse `<VerificationTraceTimeline verdict={verdict} lang={lang} />` inside `VerdictTrace` (lines 951–960) so there is zero duplication.

- [ ] **Step 4: Run tests to verify pass**

Run: `cd web && npx vitest run src/pages/Report4TabConsolidation.test.tsx src/pages/UrlResourceAndVerdictWiring.test.tsx src/pages/GraphAndCrossLingualV370.test.tsx`
Expected: PASS across all tests.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/LogicTracePage.tsx web/src/pages/Report4TabConsolidation.test.tsx
git commit -m "refactor(report): export reusable NeuralAlignmentPanel and VerificationTraceTimeline"
```

---

### Task 2: Streamline `ReportSummaryAndNavBar` to 4 Tabs & Single Badge Discipline

**Files:**
- Modify: `web/src/pages/EssayPage.tsx:223-638`
- Modify: `web/src/pages/essay/EssayActionBar.tsx:330-352`
- Test: `web/src/pages/Report4TabConsolidation.test.tsx`

**Interfaces:**
- Consumes: `computeReportBucketCounts`, `isActionableIssueVerdict` in `web/src/pages/EssayPage.tsx`.
- Produces in `web/src/pages/EssayPage.tsx`:
  - `ReportSummaryAndNavBar` renders exactly 4 tabs (`mode-citations-btn`, `mode-document-btn` / `locked-document-inspector-btn`, `mode-consistency-btn` / `locked-consistency-btn`, `mode-graph-btn` / `locked-graph-btn`).
  - `data-testid="citations-issue-badge"` on Tab 1 when `counts.actionableIssues > 0` (`data-severity="critical" | "warning"`).
  - `data-testid="consistency-matched-dot"` when `linkingIssueCount === 0`, or `data-testid="consistency-issue-badge"` when `linkingIssueCount > 0`.

- [ ] **Step 1: Write the failing tests**

Append `describe('Task 2: 4-Tab ReportSummaryAndNavBar & Single Badge Discipline', ...)` to `web/src/pages/Report4TabConsolidation.test.tsx`:

- Test 2.1: Renders exactly 4 `[role="tab"]` buttons (`mode-citations-btn`, `mode-document-btn`, `mode-consistency-btn`, `mode-graph-btn`) and asserts `screen.queryByTestId('mode-issues-btn')` and `screen.queryByTestId('mode-trace-btn')` are `null`.
- Test 2.2 (Review Focus #2): Report with 1 `verified` citation having `url_status: 'dead_link'` and 1 `verified` citation having `mapping_status: 'uncited_reference'` displays `citations-issue-badge` with text `"2"` and `data-severity="critical"`, AND displays `consistency-issue-badge` with text `"1"` (no `consistency-matched-dot`).
- Test 2.3: Report with only 1 `metadata_error` (all `mapping_status: 'matched'`) displays `citations-issue-badge` with text `"1"` and `data-severity="warning"`, AND displays `consistency-matched-dot`.
- Test 2.4 (Review Focus #5): Basic-plan user sees `mode-citations-btn`, `locked-document-inspector-btn`, `locked-consistency-btn`, `locked-graph-btn`, and zero `mode-issues-btn`/`mode-trace-btn`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/pages/Report4TabConsolidation.test.tsx`
Expected: FAIL because `ReportSummaryAndNavBar` still renders 6 tabs (`mode-issues-btn`, `mode-trace-btn`) and lacks `citations-issue-badge` / `consistency-issue-badge`.

- [ ] **Step 3: Implement 4-tab `ReportSummaryAndNavBar` in `web/src/pages/EssayPage.tsx` and clean up `EssayActionBar.tsx`**

In `web/src/pages/EssayPage.tsx`:
- Normalize `const effectiveLayer: ReportWorkspaceMode = activeLayer === 'issues' || activeLayer === 'trace' ? 'debugger' : activeLayer;` and pass `effectiveLayer` to `useSlidingPill` and active tab comparisons.
- Compute `hasCriticalIssue` (true if `counts.suspected_hallucination > 0` or any verdict has `dead_link` / `fake_domain` / `R-DEAD-URL` / `R-BROKEN-LINK` / `R-FAKE-URL`) and `linkingIssueCount` (sum of `report.linking_summary` abnormal buckets, falling back to counting `v.mapping_status && v.mapping_status !== 'matched'`).
- On Tab 1 (`Citations`), render `citations-issue-badge` when `counts.actionableIssues > 0` (`bg-red-100 text-red-700 ...` when `hasCriticalIssue`, else `bg-amber-100 text-amber-800 ...`).
- Remove Tab 2 (`Issues` / `mode-issues-btn`) and Tab 6 (`Check Details` / `mode-trace-btn`) completely.
- On Tab 3 (`Link Check`), render `consistency-matched-dot` when `linkingIssueCount === 0`, or `consistency-issue-badge` (`bg-amber-100 text-amber-800 ...`) when `linkingIssueCount > 0`.
- In `web/src/pages/essay/EssayActionBar.tsx`, remove the dead `isIssues` / `isTrace` contextual `<Link>` blocks (lines 330–351).

- [ ] **Step 4: Run tests to verify pass**

Run: `cd web && npx vitest run src/pages/Report4TabConsolidation.test.tsx src/pages/ReportRedesignUX.test.tsx src/pages/CapabilityGating.test.tsx`
Expected: PASS across all tests.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/EssayPage.tsx web/src/pages/essay/EssayActionBar.tsx web/src/pages/Report4TabConsolidation.test.tsx
git commit -m "feat(report): streamline ReportSummaryAndNavBar to 4 task tabs with single badge discipline"
```

---

### Task 3: Fold `Issues` Filter & `Verification` (Content Match + 5-Step Trace) into `EssayPage`

**Files:**
- Modify: `web/src/pages/EssayPage.tsx:14-20,3320-3490,4480-4710,5278-5645`
- Test: `web/src/pages/Report4TabConsolidation.test.tsx`

**Interfaces:**
- Consumes from Task 1: `NeuralAlignmentPanel`, `VerificationTraceTimeline`, `hasNeuralAlignmentData` from `./LogicTracePage`.
- Produces in `web/src/pages/EssayPage.tsx`:
  - Queue filter value `'issues'` rendered via `data-testid="queue-filter-issues"` (using `isActionableIssueVerdict(item.verdict)`).
  - Empty issues recovery card `data-testid="queue-empty-issues"` with reset button `data-testid="queue-reset-filter-btn"`.
  - Tier 3 drawer controlled tab state `deepTab: 'sources' | 'content' | 'steps' | 'graph'` with triggers `inspector-tab-sources`, `inspector-tab-content`, `inspector-tab-steps`, `inspector-tab-graph` and fallback `data-testid="content-match-empty"`.

- [ ] **Step 1: Write the failing tests**

Append `describe('Task 3: Unified Issues Filter & In-Context Verification Details Drawer', ...)` to `web/src/pages/Report4TabConsolidation.test.tsx`:

- Test 3.1 (Review Focus #2): Clicking `queue-filter-issues` filters the left queue to include `suspected_hallucination`, `metadata_error`, AND a `verified` citation with `mapping_status: 'uncited_reference'` or `url_status: 'dead_link'`, while excluding clean `verified` and clean `resource` citations. Zero-count status filter chips (e.g., `unresolved` when 0) are hidden.
- Test 3.2 (Review Focus #1): Opening `EssayPage` on a clean report (0 actionable issues) with `?filter=issues` renders `queue-empty-issues`; clicking `queue-reset-filter-btn` restores all citations in the queue.
- Test 3.3: For a Pro user, opening `deep-verification-drawer-toggle` shows all 4 inner tabs (`inspector-tab-sources`, `inspector-tab-content`, `inspector-tab-steps`, `inspector-tab-graph`) and NO link to `/trace` (`a[href$="/trace"]` is `null`).
  - Clicking `inspector-tab-content` on a citation with alignment features renders `neural-alignment-panel` (abstract evidence + bars).
  - Clicking `inspector-tab-steps` renders `verification-trace-timeline` (5-step breakdown) AND the plain-language verification check cards.
- Test 3.4 (Review Focus #4): Selecting a plain web `resource` citation (no alignment data) and clicking `inspector-tab-content` renders `content-match-empty` with bilingual fallback text instead of an empty panel.
- Test 3.5 (Review Focus #5): For a Basic user, opening `deep-verification-drawer-toggle` renders `deep-drawer-basic-upgrade` and NEVER renders `inspector-tab-content`, `neural-alignment-panel`, or `verification-trace-timeline`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/pages/Report4TabConsolidation.test.tsx`
Expected: FAIL because `queue-filter-issues`, `inspector-tab-content`, and `inspector-tab-steps` do not exist yet.

- [ ] **Step 3: Implement unified `Issues` filter and 4-tab Tier 3 drawer in `web/src/pages/EssayPage.tsx`**

- Import `{ NeuralAlignmentPanel, VerificationTraceTimeline, hasNeuralAlignmentData }` from `./LogicTracePage`.
- Update `filterLabel` filtering in `filteredItems`:
  - When `filterLabel === 'issues'`, keep items where `isActionableIssueVerdict(item.verdict)` is true.
  - When `filterLabel !== 'all'`, keep items where `getEffectiveVerdictKey(item.verdict) === filterLabel`.
- Update queue filter chips:
  - Always show `all`; show `issues` (`data-testid="queue-filter-issues"`, label `⚠ Cần xử lý (${counts.actionableIssues})` / `⚠ Issues (${counts.actionableIssues})`) whenever `counts.actionableIssues > 0`; show `suspected_hallucination`, `metadata_error`, `unresolved`, `verified`, `resource` only when their respective count `> 0`.
- When `filteredItems.length === 0` and `filterLabel === 'issues'`, render `data-testid="queue-empty-issues"` with a friendly green check state and `data-testid="queue-reset-filter-btn"` that calls `setFilterLabel('all')`.
- Add `const [deepTab, setDeepTab] = useState<'sources' | 'content' | 'steps' | 'graph'>('sources');` (resetting to `'sources'` on `essayId` change unless arriving via `/trace` / `?drawer=trace`).
- In Tier 3 drawer (`deep-verification-drawer`):
  - Remove the `<Link to={`/verification/report/${report.essay_id}/trace`}>` element.
  - Replace uncontrolled `<Tabs defaultValue="sources">` with `<Tabs value={deepTab} onValueChange={(v) => setDeepTab(v as 'sources' | 'content' | 'steps' | 'graph')}>` and `grid-cols-2 sm:grid-cols-4` `TabsList`:
    1. `sources` (`data-testid="inspector-tab-sources"`) — `1. Nguồn đối chiếu` / `1. Checked Sources`
    2. `content` (`data-testid="inspector-tab-content"`) — `2. Đối chiếu nội dung` / `2. Content Match` → renders `<NeuralAlignmentPanel verdict={activeItem.verdict} lang={lang} />` when `hasNeuralAlignmentData(activeItem.verdict)` else `<div data-testid="content-match-empty">` with bilingual notice.
    3. `steps` (`data-testid="inspector-tab-steps"`) — `3. Các bước & Tiêu chí` / `3. Steps & Checks` → renders `<VerificationTraceTimeline verdict={activeItem.verdict} lang={lang} />` followed by the plain-language `activeItem.rules` list.
    4. `graph` (`data-testid="inspector-tab-graph"`) — `4. Sơ đồ kiểm tra` / `4. Decision Flow` → renders `<EvidenceGraph verdict={activeItem.verdict} />`.

- [ ] **Step 4: Run tests to verify pass**

Run: `cd web && npx vitest run src/pages/Report4TabConsolidation.test.tsx src/pages/ReportRedesignUX.test.tsx src/pages/CapabilityGating.test.tsx`
Expected: PASS across all tests.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/EssayPage.tsx web/src/pages/Report4TabConsolidation.test.tsx
git commit -m "feat(report): fold Issues filter and Verification content-match/5-step trace into Citations"
```

---

### Task 4: Unify Canonical Report URL (`/verification/report/:id`) & Legacy Sub-Route Compatibility

**Files:**
- Modify: `web/src/pages/EssayPage.tsx:3307-3355,4290-4300`
- Modify: `web/src/router.tsx:55-92,375-407`
- Test: `web/src/pages/Report4TabConsolidation.test.tsx`

**Interfaces:**
- Consumes from Task 2 & Task 3: `ReportWorkspaceMode`, `filterLabel === 'issues'`, `deepDrawerOpen`, `deepTab`.
- Produces in `web/src/router.tsx`:
  - `LegacyReportSubrouteRedirect({ target }: { target: 'issues' | 'trace' | 'document' | 'consistency' })` redirecting with `replace` to `/verification/report/${id}?...` while preserving existing query params (such as `citation`).
- Produces in `web/src/pages/EssayPage.tsx`:
  - `handleChangeWorkspaceMode(nextMode: ReportWorkspaceMode)` updates `workspaceMode` in-place AND syncs `?view=` via `setSearchParams(..., { replace: true })` (removing `view` for `'debugger'`, keeping `citation` intact).
  - Initializers read both `searchParams` (`view`, `filter=issues`, `drawer=trace`) and legacy `location.pathname.endsWith(...)`.

- [ ] **Step 1: Write the failing tests**

Append `describe('Task 4: Canonical URL Sync & Legacy Sub-Route Redirects', ...)` to `web/src/pages/Report4TabConsolidation.test.tsx`:

- Test 4.1 (Review Focus #3): Render `EssayPage` on `/verification/report/119` with a location spy component. Switch across `In Document` → `Link Check` → `Network` → `Citations`:
  - Verify `report-health-summary` and `report-view-tablist` keep the exact same DOM node references across all 4 switches (zero unmount).
  - Verify URL pathname stays `/verification/report/119` while search updates cleanly: `?view=document` → `?view=consistency` → `?view=graph` → `""` (empty search).
- Test 4.2: Using the real `appRoutes` router entries (or route helper) for `/verification/report/119/issues`, `/trace`, `/document`, `/consistency`:
  - `/verification/report/119/issues` redirects (`replace`) to `/verification/report/119?filter=issues` and activates the `Issues` queue filter.
  - `/verification/report/119/trace` (Pro user) redirects (`replace`) to `/verification/report/119?drawer=trace`, opens `deep-verification-drawer` (`data-open="true"`), and activates `inspector-tab-steps`.
  - `/verification/report/119/document` (Pro user) redirects (`replace`) to `/verification/report/119?view=document` and selects `mode-document-btn`.
  - `/verification/report/119/consistency` (Pro user) redirects (`replace`) to `/verification/report/119?view=consistency` and selects `mode-consistency-btn`.
- Test 4.3 (Review Focus #5): Visiting `/verification/report/119/trace` as a Basic user is still blocked by `ProtectedRoute` (does not mount `EssayPage` trace drawer).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/pages/Report4TabConsolidation.test.tsx`
Expected: FAIL because `handleChangeWorkspaceMode` does not sync `?view=`, `?drawer=trace` does not auto-open the drawer, and `router.tsx` still mounts `IssuesPage`/`LogicTracePage`.

- [ ] **Step 3: Wire URL query sync in `web/src/pages/EssayPage.tsx` and legacy redirects in `web/src/router.tsx`**

In `web/src/pages/EssayPage.tsx`:
- Read `const [searchParams, setSearchParams] = useSearchParams();`.
- Initialize `filterLabel` from `location.pathname.endsWith('/issues') || searchParams.get('filter') === 'issues' ? 'issues' : 'all'`.
- Initialize `deepDrawerOpen` to `Boolean(canViewDeepTrace && (location.pathname.endsWith('/trace') || searchParams.get('drawer') === 'trace'))` and `deepTab` to `'steps'` when arriving via trace, else `'sources'`.
- Add `handleChangeWorkspaceMode(nextMode: ReportWorkspaceMode)`:
  - Calls `setWorkspaceMode(nextMode)`.
  - Calls `setSearchParams((prev) => { const next = new URLSearchParams(prev); if (nextMode === 'debugger') next.delete('view'); else next.set('view', nextMode); return next; }, { replace: true });`.
- Pass `onChangeWorkspaceMode={handleChangeWorkspaceMode}` to `ReportSummaryAndNavBar`.
- Preserve `deepDrawerOpen` / `filterLabel` properly on `essayId` change (reset only when `essayId` actually changes after mount, not overriding initial URL params).

In `web/src/router.tsx`:
- Remove unused lazy imports for `IssuesPage` and `LogicTracePage` (lines 73–74).
- Add `LegacyReportSubrouteRedirect` using `useParams()` + `useLocation()` to build `/verification/report/${id}` with merged `URLSearchParams` (`issues` → `filter=issues`, `trace` → `drawer=trace`, `document` → `view=document`, `consistency` → `view=consistency`) and return `<Navigate to={...} replace />`.
- Update routes `/verification/report/:id/issues`, `/trace`, `/document`, `/consistency` to render `<LegacyReportSubrouteRedirect target="..." />` (keeping existing `<ProtectedRoute requiredCapabilities={...}>` wrappers on `/trace`, `/document`, and `/consistency`).
- Keep `PAGE_TITLE_ROUTES` entries unchanged so `getDocumentTitle` tests keep passing.

- [ ] **Step 4: Run full frontend test suite + production TypeScript/Vite build**

Run: `cd web && npm test && npm run build`
Expected: All Vitest test files PASS (0 failures) and `tsc -b && vite build` succeeds cleanly with 0 errors.

- [ ] **Step 5: Refresh knowledge graph & commit**

Run: `graphify update .`
```bash
git add web/src/pages/EssayPage.tsx web/src/router.tsx web/src/pages/Report4TabConsolidation.test.tsx
git commit -m "feat(report): unify report routes onto canonical /verification/report/:id with smooth tab sync"
```
