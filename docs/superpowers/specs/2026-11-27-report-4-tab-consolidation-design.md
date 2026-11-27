# Report Workspace 4-Tab Consolidation & Unified Smooth Navigation — Short Design

**Date:** 2026-11-27  
**Status:** Proposed (pending user approval)  
**Scope Size:** Small-to-medium focused frontend UI/UX & routing refactor (~5 source files + tests)

---

## 1. Intent & Why

The verification report header currently renders 6 top-level tabs (`Citations`, `Issues`, `In Document`, `Consistency / Link Check`, `Network`, `Verification / Check Details`) in [EssayPage.tsx](../../../web/src/pages/EssayPage.tsx). Two of those tabs (`Issues` and `Verification / Check Details`) are separate `<Link>` routes (`IssuesPage`, `LogicTracePage`) rather than in-page workspace modes:

1. **Broken motion & URL drift:** Clicking `Issues` or `Verification` unmounts `EssayPage`, destroying the `useSlidingPill` and `DirectionalStageSlide` transitions, re-triggering polling spinners, and jumping across `/issues`, `/trace`, and `/document`.
2. **Visual clutter & cognitive friction:** Six tabs share one card with the CIS Score Ring. Duplicate error badges (`Citations [1]` + `Issues [1]`) sit side-by-side, and developer layer terminology (`L1–L5`, `Verification` inside a verification report) leaks into top-level navigation.
3. **Redundant views with lost context:** `IssuesPage` duplicates ~90% of `Citations` without allowing inline diff inspection or copy-fix actions; `LogicTracePage` duplicates sources/rules/DAG already inside `Citations`'s Tier 3 drawer, while burying its unique `NeuralAlignmentPanel` and 5-step trace behind a route jump that resets the user's selected citation.

---

## 2. Goals, Non-Goals & Anti-Goals

### Goals
- **4 task-oriented tabs** pinned in one persistent `ReportSummaryAndNavBar` inside `EssayPage`, with 100% smooth `useSlidingPill` + `DirectionalStageSlide` transitions and zero unmount flicker:
  1. `Citations` / `Trích dẫn` (with a single unified actionable-issue badge when `> 0`)
  2. `In Document` / `Trong bài`
  3. `Link Check` / `Khớp trích dẫn` (emerald dot when all matched, compact amber issue count when linking issues exist)
  4. `Network` / `Sơ đồ`
- **Fold `Issues` into `Citations`:** Add a 1-click `Issues (N)` / `Cần xử lý (N)` filter pill at the front of the `Citations` queue using the canonical `isActionableIssueVerdict()` predicate (covering hallucinations, metadata errors, unresolved items, dead/mismatched URLs, and abnormal in-text mappings). Hide zero-count secondary status filter chips to keep the filter bar uncluttered.
- **Fold `Verification` (`LogicTrace`) into `Citations` Right Inspector (Tier 3 Drawer):** Bring the unique `NeuralAlignmentPanel` (semantic manuscript-to-abstract match, citation role, support stance, VI↔EN cross-lingual bridge, multi-occurrence alignment) and `5-Step Verification Trace` directly into the selected citation's expandable `Verification Details` drawer alongside `Checked Sources`, `Verification Checks`, and `Decision Flow (EvidenceGraph)`. Remove the context-breaking "Open Full Check Details" external route link.
- **Single canonical URL with legacy deep-link compatibility:** Standardize active report navigation on `/verification/report/:id` (syncing non-default tabs via `?view=document|consistency|graph` using history replace so refresh/share preserves the tab without remounting). Keep `/issues`, `/trace`, `/document`, and `/consistency` routes functional in `router.tsx` by mounting `EssayPage` with matching initial state (`issues` filter pre-selected for `/issues`; Tier 3 drawer pre-expanded on `Steps & Checks` / `Content Match` for `/trace`).

### Non-Goals
- Changing backend API endpoints, verification scoring, or CIS calculation.
- Deleting standalone `IssuesPage` or `LogicTracePage` component exports used by legacy unit tests (following the existing pattern of `DocumentInspectorPage` and `OrphanDetectionPage`).

### Anti-Goals
- Losing any Neuro-Symbolic explainability feature (`NeuralAlignmentPanel`, 5-step breakdown, cross-lingual VI↔EN bridge, `EvidenceGraph`, or Pro capability gating).
- Re-introducing duplicate error count badges or multi-page mount flicker on tab switches.

---

## 3. Approaches Considered

| Approach | Summary | Tradeoffs | Outcome |
|---|---|---|---|
| **Approach A (Selected)** | Consolidate to **4 tabs** (`Citations`, `In Document`, `Link Check`, `Network`) inside `EssayPage`; fold `Issues` into a 1-click queue filter and fold `Verification`'s unique `NeuralAlignmentPanel` + 5-step trace into `Citations`'s Tier 3 drawer. | Cleanest UX; eliminates duplicate badges & route flicker while preserving 100% of Neuro-Symbolic features in-context. Only drops the long multi-citation accordion page for reading 50 traces simultaneously. | **Picked by user** |
| **Approach B** | Ultra-minimal **3 tabs** (`Citations`, `In Document`, `Link Check`), hiding `Network` inside a modal or sub-tab. | Slightly shorter tab bar, but hides the interactive `Network` visualization that is a strong differentiator for demos and lecturers. | Rejected |
| **Approach C** | Keep all **6 tabs**, only converting `Issues` and `Verification` into `EssayPage` workspace modes. | Fixes animation and URL drift quickly, but leaves the cluttered 6-tab bar, duplicate badges, and overlapping views unsolved. | Rejected |

---

## 4. Proposed UX & Implementation Calls (Confirm or Override)

1. **Canonical URL (Agent Call):** Standardize on `/verification/report/:id` (with `?view=document|consistency|graph` synced via `replace: true` on tab switches) rather than forcing `/verification/report/:id/document`, because `Dashboard`, `History`, `Upload`, `Processing`, `PendingReviews`, and `AuditLog` all navigate to `/verification/report/:id`. Legacy `/document`, `/consistency`, `/issues`, and `/trace` URLs all render `EssayPage` directly with matching initial tab/filter/drawer state.
2. **Tier 3 Drawer Structure in `Citations` (Agent Call):** Keep the Tier 3 `Verification Details` drawer collapsed by default (preserving calm Tier 1 + Tier 2 readability; auto-expanded only when arriving via `/trace`) with 4 inner tabs:
   - `1. Checked Sources` / `1. Nguồn đối chiếu`
   - `2. Content Match` / `2. Đối chiếu nội dung` (`NeuralAlignmentPanel` — semantic bars, VI↔EN bridge, manuscript vs. source quotes, multi-occurrence list)
   - `3. Steps & Checks` / `3. Các bước & Tiêu chí` (5-step trace timeline + plain-language rules)
   - `4. Decision Flow` / `4. Sơ đồ kiểm tra` (`EvidenceGraph`)
3. **Single Badge Discipline (Agent Call):** Tab 1 (`Citations`) displays one badge for `counts.actionableIssues` (red when any `suspected_hallucination` or dead/fake URL is present; amber otherwise). Tab 3 (`Link Check`) shows an emerald dot when all references are cleanly matched, or a compact amber count badge when orphan/uncited/ambiguous linking issues exist.
4. **Left to Builder:** Extract reusable `NeuralAlignmentPanel` and `VerificationTraceSteps` exports from `LogicTracePage.tsx`, wire initial route/searchParam state and URL sync in `EssayPage.tsx` and `router.tsx`, update `ReportSummaryAndNavBar`, and add Vitest regression coverage verifying 4-tab sliding continuity, `Issues` filter accuracy, Tier 3 semantic alignment/5-step rendering, and legacy route deep-links without breaking existing tests.
