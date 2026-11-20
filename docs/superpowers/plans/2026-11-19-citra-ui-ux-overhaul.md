# CITRA World-Class UI/UX & Non-Tech Experience Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (with the **3-Agent Implementer -> Spec/Code Reviewer -> Adversarial UI/UX & Non-Tech Critic Loop** defined below) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking; tick checkboxes and create an atomic git commit immediately after each task passes all gates.

**Goal:** Transform `citra.io.vn` (`essay-integrity-checker`) into an award-caliber, zero-defect academic product whose primary UX is effortlessly clear to non-technical students and lecturers in both Vietnamese and English, while preserving full explainable Neuro-Symbolic depth via Progressive Disclosure.

**Architecture:** Four sequential phases (12 bite-sized tasks) refactor design tokens, commercial trust hygiene, WCAG AAA surface contrast, desktop/mobile responsive layouts, human-first bilingual microcopy with collapsible technical traces, streamlined email-first auth flows, and an IP-rate-limited Homepage Guest Instant Citation Checker (`POST /api/essays/sandbox/public-verify`). Every task executes inside an iterative Triad Agent Loop (`Implementer` -> `Spec/Code Reviewer` -> `Adversarial Principal UI/UX & Non-Tech Critic` + live responsive verification) that repeats until zero visual, copy, or functional defects remain before ticking checkboxes and committing.

**Tech Stack:** React 18, TypeScript 5.4, Vite 5, Tailwind CSS 3.4, `react-i18next`, `motion` + custom CSS motion tokens (`transitions-dev.css`), Vitest + Testing Library, Playwright E2E, FastAPI + Pytest (for Task 3.1 public guest endpoint).

**Spec:** `docs/superpowers/specs/2026-11-19-citra-ui-ux-overhaul-design.md`

> **Post-Release Evolution Note (`v3.89.4` – `v3.89.5`, `2026-11-20`):**
> - All 13 tasks (`Task 0.1` → `Task 3.3`) were completed, reviewed (`10/10` sign-off), merged (`b41f53a`, `v3.89.3`), and deployed to `https://citra.io.vn`.
> - In `v3.89.4` (`65e98cd`), per owner UX/aesthetic direction, the frontend `<GuestInstantChecker />` (`#try-instant`) introduced in Task 3.1 was removed from `LandingPage.tsx` to preserve clean Solva editorial flow (`SolvaHeroSection` → `SolvaFilmSection`; secondary CTAs point to `#interactive-demo`), while keeping the rate-limited backend endpoint `POST /api/essays/sandbox/public-verify` (`tests/test_public_guest_sandbox.py`) intact.
> - In `v3.89.5` (`ccaeedf`), authenticated workspace Tailwind v3.4 token hygiene (`232` fixes + static guard `web/src/__tests__/tailwindV3AndBundleHygiene.test.ts`), shell-matched skeletons, and acyclic `<251 kB` Rollup bundle splitting (`index-*.js`: `788.24 kB` → `228.42 kB`) were completed (`472` Vitest tests across `62` files, `20` Playwright E2E suites).

---

## Global Constraints

1. **Preserve Warm Academic Editorial Identity:** Keep the `#FAF9F6` / `#141310` Solva editorial palette, local `Sentient` Serif + `Onest` Sans fonts (`web/src/index.css` — never reference `cdn.fontshare.com`), and impressionist botanical artwork; never introduce generic neon/purple AI-SaaS styling.
2. **Zero-Regression DOM Order Invariant on Auth Pages:** `AuthSplitShell.tsx` left panel and `LoginPage.tsx` form elements prior to `#password` MUST contain **ZERO `<button>` elements wrapping `<svg>`** so the `#password` Eye visibility toggle remains the first SVG button in DOM order for E2E compatibility.
3. **Vietnamese Typography & NFC Invariant (`LandingVietnameseTypography.test.tsx`):** All `.font-solva-serif` headings MUST normalize text via `.normalize('NFC')`, retain `leading-[1.15] tracking-[-0.03em]` for Vietnamese and `leading-[1.06] tracking-[-0.05em]` for English, preserve `LandingPage` matching `/Kiểm chứng/i` in `vi`, and retain `SourceLogic v${APP_VERSION}` in `AuthSplitShell` colophon/version badge.
4. **Interactive Choreography & Pricing Test-ID Invariants (`LandingInteractiveMotion.test.tsx` & `PricingAndBilling.test.tsx`):** Preserve `#interactive-demo`, `debugger-autotour-progress`, `debugger-bezel`, `debugger-active-confidence`, `#how-it-works`, `pipeline-autotour-progress`, `pipeline-tabs-pill`, `pipeline-stage-slide`, `landing-billing-toggle`, `landing-price-pro` (exact textContent `'$20'` monthly / `'$16'` annual), `landing-price-ultra` (`'$200'` / `'$160'`), `plan-card-basic`, `plan-card-pro`, `plan-card-ultra`, `pro-price-display` (`'$16'` / `'$20'`), `ultra-price-display` (`'$160'` / `'$200'`), `billing-toggle-monthly`, `billing-toggle-annual`, `select-pro-btn`, and FAQ accordion `300ms` open / `190ms` close transition timings. Render VND equivalents in separate sibling elements (`data-testid="pro-vnd-equivalent"`) outside price `NumberPopIn` nodes.
5. **Vietnamese Personal Data Protection Law Invariants (`PrivacyCompliance.test.tsx` — Law `91/2025/QH15` & Decree `356/2025/NĐ-CP`):** Preserve `privacy-policy-page` (`solva-editorial-root`), `solva-sticky-card-0`, `.animate-solva-marquee`, statutory citations (`91/2025/QH15`, `356/2025/NĐ-CP`), controller details (`Đại học Tôn Đức Thắng`, `19 Nguyễn Hữu Thọ, phường Tân Hưng, TP. Hồ Chí Minh`, `Nguyễn Bảo Minh`, `iannwendii@gmail.com`), `02 ngày làm việc` / `2 business days`, `Crossref`, `OpenAlex`, `VNPay`, `Dữ liệu Nhạy cảm (1)` -> `card_last4`, `VI / EN` toggle, and `register-privacy-consent-checkbox` (unchecked by default, blocks submit when unchecked, sends `privacy_consent: true, privacy_policy_version: '1.0'`).
6. **Dead-Code Guard (`web/src/deadCode.test.ts`):** Never recreate `/src/App.tsx`, `/src/pages/essay/EssayTabNav.tsx`, `/src/pages/essay/EssayStatsGrid.tsx`, or `/src/components/CitationGraphView.tsx`, and keep `web/src/pages/essay/index.ts` exporting only `['EssayActionBar', 'EssayHeader']`.
7. **Zero-Truncation & Responsive Floor:** Zero `scrollWidth > innerWidth` horizontal overflow across `375×812`, `390×844`, `768×1024`, `1024×768`, and `1440×900`; zero `text-overflow: ellipsis` on marketing feature descriptions; zero orphan `)` or `→` punctuation; WCAG AA/AAA (`>= 7:1`) body text contrast in both Light and Dark themes.
8. **Mandatory Verification Gate Before Marking Any Task Done:**
   - Frontend: `cd web && npm run lint && npx tsc --noEmit && npx vitest run && npm run build` (0 errors, 0 failed tests).
   - Backend (when `src/` or `tests/` touched): `.venv/bin/python -m ruff check src/ tests/ && .venv/bin/python -m pytest tests/ -q`.
   - Responsive & Visual Gate: Playwright responsive assertions + live `browser` subagent check across Desktop (`1440×900`) & Mobile (`390×844`), Light & Dark, EN & VI.

---

## Mandatory Per-Task Multi-Agent Triad Protocol (Repeat Until Perfect)

Every single task (`Task 0.1` through `Task 3.3`) MUST execute this closed-loop workflow before its checkboxes are ticked and committed:

1. **Stage A — Implementer Subagent (`implementer`):**
   - Writes failing Vitest / Playwright / Pytest tests first (TDD), implements the code changes, and runs `lint` + `tsc --noEmit` + `vitest run` + `vite build` (plus `pytest` if backend touched).
2. **Stage B — Independent Spec & Code Reviewer Subagent (`spec-code-reviewer`):**
   - Inspects the exact git diff (`BASE..HEAD`), checking spec compliance, TypeScript strictness, accessibility (`aria-*`, keyboard navigation, contrast), dark/light theme parity, and test coverage.
3. **Stage C — Adversarial Principal UI/UX & Non-Tech User Critic Subagent (`ux-nontech-critic` + `browser` inspection):**
   - Acts as a harsh Devil's Advocate (*Agent Phản Biện*) from two perspectives simultaneously:
     - **20-Year Principal UI/UX Designer:** Scrutinizes spacing rhythm, optical alignment, line breaks, orphan symbols, Pro-card contrast, Light/Dark polish, and live Desktop (`1440×900`) + Mobile (`390×844`) rendering.
     - **Non-Tech User (Student / Lecturer):** Rejects any unexplained ML/code jargon on primary surfaces, mixed English-in-Vietnamese badges, confusing button labels/routes, or intimidating form friction.
4. **Stage D — Iterative Refinement Loop:**
   - If **either** `spec-code-reviewer` **or** `ux-nontech-critic` reports **any** Critical, Important, or UX/Visual Polish defect -> dispatch fixes to `implementer` -> re-run full test suite & responsive checks -> re-run `spec-code-reviewer` and `ux-nontech-critic` (up to 5 rounds max before architectural escalation) until **BOTH** agents return `APPROVED (ZERO DEFECTS)`.
5. **Stage E — Checkbox Tick & Atomic Commit:**
   - Update `- [ ]` to `- [x]` in this plan and the session task checklist, then create one clean atomic git commit (`git commit -m "..."`).

---

## Review Focus

1. **Long Vietnamese Diacritic Strings in Narrow Pills/Cards (`390px` Mobile & `1440px` Split-Pane):** Switching `EN -> VI` expands character width by ~25–35%; badges, header nav links, and `RegisterPage` placeholders must wrap cleanly or stay single-line without mid-word breaks (`CHÍNH / XÁC`), clipped text (`Enter your usernam`), or 2-line header overflow (pinned in Tasks 1.2, 1.4, 1.6, 2.2).
2. **Dark-Mode vs. Light-Mode Contrast Over Botanical Artwork:** Text on the `Pro` pricing card (`/` and `/pricing`) must remain effortlessly readable (`>= 7:1` contrast) over both dark green foliage in Light mode and white flower petals in Dark mode (pinned in Task 1.3).
3. **Hash-Anchor Navigation Under Sticky Header:** Navigating to `/#interactive-demo`, `/#pricing-plans`, `/#workspaces`, `/pricing#compare-matrix`, or `/privacy#data-collected` must not leave the section's `H2` covered by the fixed `72px` navbar (pinned in Task 0.1 & Task 1.5).
4. **Email vs. Auto-Derived Username Edge Cases on `/register` & `/login`:** Emails containing `+` tags or short prefixes (`a@b.vn`, `minh.nguyen+kltn@tdtu.edu.vn`) must sanitize into valid `3–50` char usernames matching `/^[a-zA-Z0-9._-]{3,50}$/` without leading/trailing punctuation or `..` (pinned in Task 2.2).
5. **Abuse, Offline & Empty-Input Resilience on Guest Instant Checker:** Pasting empty whitespace, 50 lines of garbage text, or hitting rate limits (`HTTP 429`) on `POST /api/essays/sandbox/public-verify` must show friendly plain-language guidance in EN/VI without crashing or exposing stack traces (pinned in Task 3.1).

---

## Phase 0: Design Tokens, Scroll Geometry & Human-Label Foundation

### Task 0.1: Global Scroll Offset, High-Contrast Floral Surface Tokens & Plain-Language Verdict Helpers

**Files:**
- Modify: `web/src/index.css`
- Modify: `web/src/lib/verdictExplanation.ts`
- Modify: `web/src/lib/verdictExplanation.test.ts`

**Interfaces:**
- Produces:
  - CSS classes in `web/src/index.css`: `html { scroll-padding-top: 88px; }`, `.solva-pro-card-surface` (guaranteed high-opacity surface scrim in Light & Dark modes), `.solva-floral-banner-mask` (top gallery header mask), `.citra-nowrap-tail` (prevents orphan `)` / `→`).
  - TypeScript helpers in `web/src/lib/verdictExplanation.ts`:
    - `getPlainVerdictLabel(verdict: string, lang: 'en' | 'vi'): { label: string; actionHint: string; technicalCode: string }`
    - `getPlainMappingLabel(status: string, lang: 'en' | 'vi'): { label: string; technicalCode: string }`

- [x] **Step 1: Write failing unit tests in `web/src/lib/verdictExplanation.test.ts`**
  Assert `getPlainVerdictLabel('SUSPECTED_HALLUCINATION', 'vi')` returns human-friendly Vietnamese (`label: 'Không tìm thấy nguồn gốc'`, `technicalCode: 'SUSPECTED_HALLUCINATION'`, non-empty `actionHint`), `getPlainVerdictLabel('METADATA_ERROR', 'en')` returns `label: 'Citation Details Mismatch'`, `getPlainMappingLabel('MISSING_REFERENCE', 'vi')` returns `'Thiếu ở danh mục tham khảo'`, and verify `web/src/index.css` defines `scroll-padding-top: 88px` and `.solva-pro-card-surface`.
- [x] **Step 2: Run Vitest to confirm failure**
  Run: `cd web && npx vitest run src/lib/verdictExplanation.test.ts`
  Expected: FAIL (`getPlainVerdictLabel is not a function`).
- [x] **Step 3: Implement tokens in `web/src/index.css` and plain-language mappers in `web/src/lib/verdictExplanation.ts`**
  Map all 5 Layer-2 labels (`VERIFIED`, `METADATA_ERROR`, `SUSPECTED_HALLUCINATION`, `UNRESOLVED`/`UNVERIFIABLE`, `RESOURCE`) and all 7 Layer-1 statuses (`MATCHED`, `MISSING_REFERENCE`, `UNCITED_REFERENCE`, `IN_TEXT_MISMATCH`, `DUPLICATE_REFERENCE`, `AMBIGUOUS_MAPPING`, `STYLE_INCONSISTENT`) to crystal-clear EN & VI student/lecturer labels + 1-sentence action hints.
- [x] **Step 4: Run full frontend verification gate**
  Run: `cd web && npm run lint && npx tsc --noEmit && npx vitest run && npm run build`
  Expected: PASS (0 lint/TS errors, all Vitest suites green).
- [x] **Step 5: Run Triad Review & Critic Loop (`spec-code-reviewer` + `ux-nontech-critic`)**
  Verify plain-language copy reads naturally to non-tech Vietnamese & English readers and CSS tokens maintain editorial warmth in Light & Dark modes; iterate until both agents return `APPROVED`.
- [x] **Step 6: Tick checkboxes & commit**
  ```bash
  git add web/src/index.css web/src/lib/verdictExplanation.ts web/src/lib/verdictExplanation.test.ts
  git commit -m "feat(ux): add scroll-padding tokens, pro-card contrast surface, and plain-language verdict mappers"
  ```

---

## Phase 1 (Chặng P0): Commercial Trust Hygiene, Contrast Rescue, IA Fixes & Zero-Truncation Layout

### Task 1.1: Unify `CITRA` Brand Presentation & Gate Evaluator Test-Card Copy on `/pricing`

**Files:**
- Modify: `web/src/lib/productFacts.ts`
- Modify: `web/src/lib/productFacts.test.ts`
- Modify: `web/src/pages/PricingPage.tsx`
- Modify: `web/src/pages/LandingPage.tsx`
- Modify: `web/src/components/AuthSplitShell.tsx`
- Modify: `web/src/pages/PricingAndBilling.test.tsx`

**Interfaces:**
- Produces: `IS_DEMO_EVALUATOR_MODE: boolean` in `web/src/lib/productFacts.ts` (`import.meta.env.VITE_DEMO_MODE === 'true'`).

- [x] **Step 1: Write failing tests in `web/src/lib/productFacts.test.ts` and `web/src/pages/PricingAndBilling.test.tsx`**
  Assert that when `VITE_DEMO_MODE` is unset/false on `PricingPage`, rendered FAQ and trust cards do NOT expose `"4242"`, `"4444"`, or `"test card autofill"`, and instead display production-grade encrypted Stripe & VNPay billing copy in both `en` and `vi`; assert `LandingPage` and `PricingPage` footers lead with `© 2026 CITRA` without confusing standalone `SourceLogic` product naming (while keeping `SourceLogic v${APP_VERSION}` subtle engine tag in `AuthSplitShell` per Global Constraint 3).
- [x] **Step 2: Run targeted Vitest suites to confirm failure**
  Run: `cd web && npx vitest run src/lib/productFacts.test.ts src/pages/PricingAndBilling.test.tsx`
  Expected: FAIL (`PricingPage` currently renders `"4242"` unconditionally).
- [x] **Step 3: Implement `IS_DEMO_EVALUATOR_MODE` gating & brand unification**
  Update `PricingPage.tsx` FAQ & Trust Strip copy so test-card instructions only appear when `IS_DEMO_EVALUATOR_MODE` is true; standardize footer copyright & brand colophons across `LandingPage.tsx` and `PricingPage.tsx` (`StripeDemoCheckoutPage.tsx` remains untouched so checkout sandbox tests stay green).
- [x] **Step 4: Run full frontend verification gate**
  Run: `cd web && npm run lint && npx tsc --noEmit && npx vitest run && npm run build`
  Expected: PASS.
- [x] **Step 5: Run Triad Review & Critic Loop + Browser Visual Check on `/` and `/pricing`**
  Confirm zero leaked evaluator/test-card strings and cohesive `CITRA` branding in EN & VI; loop until `APPROVED`.
- [x] **Step 6: Tick checkboxes & commit**
  ```bash
  git add web/src/lib/productFacts.ts web/src/lib/productFacts.test.ts web/src/pages/PricingPage.tsx web/src/pages/LandingPage.tsx web/src/components/AuthSplitShell.tsx web/src/pages/PricingAndBilling.test.tsx
  git commit -m "fix(trust): unify CITRA brand presentation and gate evaluator test-card copy behind demo mode"
  ```

---

### Task 1.2: Finalize Production Privacy Policy (`/privacy`), Fix Subpage Navbar Wrapping & Eliminate Mid-Scroll Blur

**Files:**
- Modify: `web/src/pages/PrivacyPolicyPage.tsx`
- Modify: `web/src/pages/PrivacyCompliance.test.tsx`

**Interfaces:**
- Consumes: `scroll-padding-top: 88px` from Task 0.1; Global Constraint 5 statutory disclosures.

- [x] **Step 1: Update & extend `web/src/pages/PrivacyCompliance.test.tsx`**
  Update `[DLCN-01]` to assert that `PrivacyPolicyPage` renders an official `"CHÍNH SÁCH BẢO VỆ DỮ LIỆU CÁ NHÂN · PHIÊN BẢN 1.0"` / `"OFFICIAL PERSONAL DATA PROTECTION NOTICE · v1.0"` badge with **zero** `LEGAL DRAFT`, `BẢN NHÁP PHÁP LÝ`, `[CHECK:`, or `[KIỂM TRA:` substrings; assert primary Data Inventory rows present human-friendly field descriptions while preserving a collapsible `"Chi tiết trường kỹ thuật / Technical Schema"` disclosure (retaining `card_last4` visibility under `Dữ liệu Nhạy cảm (1)` and all `91/2025/QH15` / `356/2025/NĐ-CP` statutory strings); assert header nav items fit on a single row without 2-line wrapping.
- [x] **Step 2: Run `PrivacyCompliance.test.tsx` to confirm failure**
  Run: `cd web && npx vitest run src/pages/PrivacyCompliance.test.tsx`
  Expected: FAIL (`LEGAL DRAFT` and `[KIỂM TRA:` currently present).
- [x] **Step 3: Refactor `web/src/pages/PrivacyPolicyPage.tsx`**
  1. Replace the `LEGAL DRAFT` warning banner and all `[CHECK: ...]` / `[KIỂM TRA: ...]` placeholders with finalized, accurate CITRA academic deployment statements.
  2. Rewrite primary Data Matrix descriptions in clear, reassuring non-tech prose (`Ảnh đại diện tải lên`, `Tệp bản thảo PDF/Word`, `4 số cuối thẻ thanh toán`), placing internal schema identifiers (`avatar_path`, `privacy_consented_at`, `vnp_bank_code`, `card_last4`) in clean monospace pills/expandable schema details.
  3. Simplify the top `PrivacyPolicyPage` navbar to match the global single-line header (moving the 5 policy section jump links into a sleek sticky sub-navigation bar below the hero so `1440px` never wraps onto 2 lines).
  4. Remove lingering mid-scroll `blur(...)` state on Section 05 so text renders razor-sharp immediately upon reveal.
- [x] **Step 4: Run full frontend verification gate**
  Run: `cd web && npm run lint && npx tsc --noEmit && npx vitest run && npm run build`
  Expected: PASS.
- [x] **Step 5: Run Triad Review & Critic Loop + Browser Check (`/privacy` at `1440×900` & `390×844`, Light & Dark, EN & VI)**
  Verify zero draft banners, crisp typography without scroll blur, single-line header, and 100% Vietnamese PDPL legal clarity; loop until `APPROVED`.
- [x] **Step 6: Tick checkboxes & commit**
  ```bash
  git add web/src/pages/PrivacyPolicyPage.tsx web/src/pages/PrivacyCompliance.test.tsx
  git commit -m "fix(privacy): finalize production PDPL policy copy, remove draft placeholders, and fix header wrapping"
  ```

---

### Task 1.3: Rescue `Pro` Plan Card Contrast (Light & Dark) & Align Pricing Tier Cards (`LandingPage` & `PricingPage`)

**Files:**
- Modify: `web/src/pages/LandingPage.tsx`
- Modify: `web/src/pages/PricingPage.tsx`
- Modify: `web/src/pages/PricingAndBilling.test.tsx`

**Interfaces:**
- Consumes: `.solva-pro-card-surface` and `.solva-floral-banner-mask` from Task 0.1; Global Constraint 4 test-IDs.

- [x] **Step 1: Write failing tests in `web/src/pages/PricingAndBilling.test.tsx`**
  Assert:
  1. Both `LandingPage` Pro card and `PricingPage` `plan-card-pro` separate the floral painting header/frame from a high-contrast `.solva-pro-card-surface` content body so body/checklist items never sit directly on un-scrimmed floral imagery.
  2. `Save $480/yr` / `Tiết kiệm $480/năm` badge on Ultra uses `whitespace-nowrap` so it never splits onto 2 lines.
  3. `LandingPage` Pro CTA no longer falsely promises `"Start Pro trial"` when no trial exists, aligning with `/pricing`.
  4. When language is `vi`, `data-testid="pro-vnd-equivalent"` renders a clear VND reference while `landing-price-pro` and `pro-price-display` keep exact `'$16'` / `'$20'` `textContent`.
- [x] **Step 2: Run `PricingAndBilling.test.tsx` & `LandingInteractiveMotion.test.tsx` to confirm failure**
  Run: `cd web && npx vitest run src/pages/PricingAndBilling.test.tsx src/pages/LandingInteractiveMotion.test.tsx`
  Expected: FAIL.
- [x] **Step 3: Implement Framed Gallery Header + High-Contrast Surface on `Pro` Card & Subgrid Alignment**
  Update `SolvaTaxonomyPricingSection` in `LandingPage.tsx` and the 3-card grid in `PricingPage.tsx` so:
  - `Pro` showcases `/solva/pricing-floral.webp` in a rich `104px` top gallery banner (hosting the `MOST POPULAR` frosted pill + `Save $48/yr` `whitespace-nowrap` badge), transitioning into `.solva-pro-card-surface` (`#FFFFFF`/`#FAF9F5` in Light mode, `#181713` in Dark mode) for >= 12:1 AAA contrast on price, description, and checklist items.
  - All 3 cards (`Basic`, `Pro`, `Ultra`) align top edges, price baselines, dividers, and bottom CTA buttons cleanly on `lg:grid-cols-3`.
  - Basic tier checklist replaces harsh triple *"No PDF..."* lines with constructive framing (*"Báo cáo trực tuyến đầy đủ · Mở khóa xuất Word/PDF ở gói Pro"*).
- [x] **Step 4: Run full frontend verification gate**
  Run: `cd web && npm run lint && npx tsc --noEmit && npx vitest run && npm run build`
  Expected: PASS.
- [x] **Step 5: Run Triad Review & Critic Loop + Browser Visual Inspection (Light & Dark modes on `/` and `/pricing`)**
  Inspect `Pro` card legibility in both Light and Dark themes and verify horizontal alignment across all 3 cards; loop until `APPROVED`.
- [x] **Step 6: Tick checkboxes & commit**
  ```bash
  git add web/src/pages/LandingPage.tsx web/src/pages/PricingPage.tsx web/src/pages/PricingAndBilling.test.tsx
  git commit -m "fix(pricing): rescue Pro card Light/Dark WCAG contrast, align tier cards, and add VI currency context"
  ```

---

### Task 1.4: Mobile `/pricing` Segmented Comparison Switcher, Single-Line Pricing Header & Mobile Menu `Pricing` Link

**Files:**
- Modify: `web/src/pages/PricingPage.tsx`
- Modify: `web/src/pages/LandingPage.tsx`
- Modify: `web/src/pages/PricingAndBilling.test.tsx`
- Modify: `web/tests/e2e/responsive.spec.ts`

**Interfaces:**
- Produces: `data-testid="mobile-compare-tier-tabs"` (`md:hidden`) alongside desktop comparison table (`hidden md:block`) inside `#compare-matrix`; `data-testid="mobile-menu-pricing-link"` inside `LandingPage` mobile drawer.

- [x] **Step 1: Write failing tests in `web/src/pages/PricingAndBilling.test.tsx`**
  Assert:
  1. `LandingPage` mobile menu renders an accessible link to `/pricing` (`Pricing` / `Bảng giá`).
  2. `PricingPage` `#compare-matrix` renders `data-testid="mobile-compare-tier-tabs"` switching cleanly between `Basic`, `Pro`, and `Ultra` feature cards without horizontal clipping on mobile viewports, while preserving the full 4-column comparison table for `md:` and up.
  3. `PricingSolvaHeader` desktop nav fits cleanly on 1 line at `1440px` without wrapping.
- [x] **Step 2: Run targeted Vitest suite to confirm failure**
  Run: `cd web && npx vitest run src/pages/PricingAndBilling.test.tsx`
  Expected: FAIL (`mobile-compare-tier-tabs` and `mobile-menu-pricing-link` missing).
- [x] **Step 3: Implement Mobile Segmented Comparison Switcher, Header Diet & Mobile `Pricing` Nav Item**
  1. In `LandingPage.tsx` mobile drawer, add `/pricing` (`Bảng giá` / `Pricing`) with clear visual prominence.
  2. In `PricingPage.tsx` `PricingSolvaHeader`, streamline center nav links so `1440px` stays strictly single-line.
  3. In `PricingPage.tsx` `#compare-matrix`, add a sticky `md:hidden` segmented control (`[Basic ($0)] [Pro ★] [Ultra]`) using `useSlidingPill` / crisp active state that renders 100%-width feature cards for the selected plan with zero clipped characters.
- [x] **Step 4: Run full frontend verification gate + responsive E2E check**
  Run: `cd web && npm run lint && npx tsc --noEmit && npx vitest run && npm run build`
  Expected: PASS.
- [x] **Step 5: Run Triad Review & Critic Loop + Browser Mobile Check (`390×844` & `375×812` on `/` and `/pricing`)**
  Verify `scrollWidth <= innerWidth`, zero clipped text in `#compare-matrix` on `390×844`, and working `Pricing` link in mobile menu; loop until `APPROVED`.
- [x] **Step 6: Tick checkboxes & commit**
  ```bash
  git add web/src/pages/PricingPage.tsx web/src/pages/LandingPage.tsx web/src/pages/PricingAndBilling.test.tsx web/tests/e2e/responsive.spec.ts
  git commit -m "fix(responsive): add mobile segmented comparison matrix on /pricing and Pricing link in mobile menu"
  ```

---

### Task 1.5: Fix Misleading Navigation Anchors (`#pricing-plans`, Interactive 3-Role `#workspaces`), Add `/terms` & Editorial `404` Page

**Files:**
- Create: `web/src/pages/TermsOfServicePage.tsx`
- Create: `web/src/pages/NotFoundPage.tsx`
- Modify: `web/src/router.tsx`
- Modify: `web/src/pages/LandingPage.tsx`
- Modify: `web/src/pages/PricingPage.tsx`
- Create: `web/src/pages/PublicRoutesAndIA.test.tsx`

**Interfaces:**
- Produces:
  - Route `/terms` -> `TermsOfServicePage` (bilingual EN/VI Solva editorial Terms of Academic Service).
  - Catch-all `*` route -> `NotFoundPage` (helpful bilingual 404 page with quick links to Home, Instant Checker, Pricing, and Sign In — replacing silent catch-all redirect to `/`).
  - Interactive 3-Role Showcase (`Student & Author`, `Lecturer & Thesis Advisor`, `Department Admin`) inside `#workspaces` on `LandingPage` (with URL/click tab selection so Footer links `Student Workspace`, `Teacher Classroom`, and `Admin Control` open the corresponding role tab!).

- [x] **Step 1: Write failing tests in `web/src/pages/PublicRoutesAndIA.test.tsx`**
  Assert:
  1. `LandingPage` top navbar no longer renders duplicate `"Gói dịch vụ"` + `"Bảng giá"` in `vi`; pricing section responds cleanly without conflating Verdict Taxonomy with Pricing.
  2. `#workspaces` renders interactive role tabs (`student`, `teacher`, `admin`) with concrete non-tech workflows before testimonials, and clicking Footer `Teacher Classroom` activates/focuses the Teacher view.
  3. Navigating to `/terms` renders `TermsOfServicePage` (`data-testid="terms-page"`) in EN & VI, linked from Footers and `RegisterPage`.
  4. Navigating to an unknown route `/nonexistent-xyz` renders `NotFoundPage` (`data-testid="not-found-page"`) with a clear `"Back to Home"` CTA instead of silently redirecting.
- [x] **Step 2: Run `PublicRoutesAndIA.test.tsx` to confirm failure**
  Run: `cd web && npx vitest run src/pages/PublicRoutesAndIA.test.tsx`
  Expected: FAIL.
- [x] **Step 3: Implement IA anchor cleanup, 3-Role Workspace Showcase, `TermsOfServicePage.tsx`, and `NotFoundPage.tsx`**
  Wire `/terms` (and `PAGE_TITLE_ROUTES` entry `'Terms of Service'`) plus `*` -> `NotFoundPage` in `web/src/router.tsx` (checking all existing tests for any expectation on unknown routes). Keep `id="taxonomy"` aliased or anchored cleanly if any test queries `#taxonomy` (`LandingInteractiveMotion.test.tsx` tests `landing-billing-toggle` by testid, let's verify all `#taxonomy` references across `web/src/` and `web/tests/` so nothing breaks!).
- [x] **Step 4: Run full frontend verification gate**
  Run: `cd web && npm run lint && npx tsc --noEmit && npx vitest run && npm run build`
  Expected: PASS.
- [x] **Step 5: Run Triad Review & Critic Loop + Browser Navigation Check**
  Click every header, dropdown, and footer link on `/`, `/pricing`, `/privacy`, `/terms`, and `/unknown-404` across Desktop & Mobile; verify smooth `scroll-padding-top` alignment and zero dead/misleading destinations; loop until `APPROVED`.
- [x] **Step 6: Tick checkboxes & commit**
  ```bash
  git add web/src/pages/TermsOfServicePage.tsx web/src/pages/NotFoundPage.tsx web/src/router.tsx web/src/pages/LandingPage.tsx web/src/pages/PricingPage.tsx web/src/pages/PublicRoutesAndIA.test.tsx
  git commit -m "feat(ia): add interactive 3-role workspaces showcase, /terms page, editorial 404 page, and clean nav anchors"
  ```

---

### Task 1.6: Eliminate All Clipping, Truncation & Orphan-Punctuation Bugs on `LandingPage` Mockups (`1440×900` & `390×844`)

**Files:**
- Modify: `web/src/components/landing/SolvaMockupWidgets.tsx`
- Modify: `web/src/components/landing/SolvaPrimitives.tsx`
- Modify: `web/src/pages/LandingPage.tsx`
- Modify: `web/src/components/landing/SolvaMotionCalm.test.tsx`

**Interfaces:**
- Consumes: `.citra-nowrap-tail` from Task 0.1.

- [x] **Step 1: Write failing tests in `web/src/components/landing/SolvaMotionCalm.test.tsx`**
  Assert:
  1. `HeroVerificationMockup` renders full non-truncated source labels and human-friendly status chips without clipped `"Semant.."` or right-edge overflow, and the generation header pill fits comfortably without clipping `"S-BER"`.
  2. `hero-benchmark-120k-strip` renders 4 concise, non-truncated proof labels (zero `"..."` ellipsis).
  3. Hero top announcement pill wraps its last word + `→` arrow inside `whitespace-nowrap` so `→` never orphans on Mobile.
  4. Architecture Card 3 wraps `ALIGNED (94%)` (and its VI equivalent) in `whitespace-nowrap` so `)` never drops onto a new line alone.
- [x] **Step 2: Run `SolvaMotionCalm.test.tsx` to confirm failure**
  Run: `cd web && npx vitest run src/components/landing/SolvaMotionCalm.test.tsx`
  Expected: FAIL.
- [x] **Step 3: Fix layout geometry & nowrap bindings in `SolvaMockupWidgets.tsx`, `SolvaPrimitives.tsx`, and `LandingPage.tsx`**
  Adjust internal padding, flex-shrink, responsive font sizing, and `whitespace-nowrap` spans across `HeroVerificationMockup`, `FeatureCardWidget`, `StickyCardWidget`, and `LandingPage` Hero benchmark strip so zero text clips at `1440×900` or `390×844`.
- [x] **Step 4: Run full frontend verification gate**
  Run: `cd web && npm run lint && npx tsc --noEmit && npx vitest run && npm run build`
  Expected: PASS.
- [x] **Step 5: Run Triad Review & Critic Loop + Browser Pixel Check (`1440×900` & `390×844`, EN & VI)**
  Inspect Hero right frame, Hero left proof box, Hero eyebrow arrow, and Architecture cards at both viewports in EN & VI; loop until `APPROVED`.
- [x] **Step 6: Tick checkboxes & commit**
  ```bash
  git add web/src/components/landing/SolvaMockupWidgets.tsx web/src/components/landing/SolvaPrimitives.tsx web/src/pages/LandingPage.tsx web/src/components/landing/SolvaMotionCalm.test.tsx
  git commit -m "fix(landing-ui): eliminate hero mockup clipping, benchmark truncation, and orphan arrow/parenthesis wraps"
  ```

---

## Phase 2 (Chặng P1): Non-Tech Human Copywriting, Progressive Disclosure & Frictionless Auth UX

### Task 2.1: Human-First Copywriting & Collapsible Progressive Disclosure Across `LandingPage` (EN & VI)

**Files:**
- Modify: `web/src/pages/LandingPage.tsx`
- Modify: `web/src/components/landing/SolvaMockupWidgets.tsx`
- Create: `web/src/pages/LandingNonTechClarity.test.tsx`

**Interfaces:**
- Consumes: `getPlainVerdictLabel` and `getPlainMappingLabel` from Task 0.1; Global Constraints 3 & 4.
- Produces: Expandable `data-testid="debugger-technical-trace-toggle"` drawer inside `#interactive-demo` and human-first Feature Card 1 visual (tucking raw `<biblStruct>` XML, `ONNX INT8`, `Platt ECE`, and `R01–R30` boolean expressions behind explicit `"Xem bằng chứng kỹ thuật / View Technical Trace"` toggles).

- [x] **Step 1: Write failing tests in `web/src/pages/LandingNonTechClarity.test.tsx`**
  Assert:
  1. Primary Navbar items use approachable labels (`How It Works` / `Cách hoạt động`, `Live Check` / `Kiểm tra thử`, `For Whom` / `Dành cho ai`, `Accuracy` / `Độ tin cậy`, `Pricing` / `Bảng giá`) instead of bare `Inspector`, `Pipeline`, `Taxonomy`.
  2. Hero H1 & Subtitle speak directly to submitting papers/theses with verified references in both EN & VI (retaining `/Kiểm chứng/i` in VI for `LandingVietnameseTypography.test.tsx`).
  3. In `#interactive-demo`, primary verdict and mapping badges render plain-language labels in `vi` (zero raw `SUSPECTED_HALLUCINATION`, `METADATA_ERROR`, `MISSING_REFERENCE`, or `MATCHED` strings in default collapsed state), while clicking `debugger-technical-trace-toggle` expands the full `R01–R30` rule codes and condition expressions.
  4. Feature Card 1 default surface shows a human-readable extracted citation preview rather than raw `<biblStruct>` angle-bracket XML.
  5. Vietnamese numbers use consistent dot thousand separators (`120.000`) across `LandingPage`.
- [x] **Step 2: Run `LandingNonTechClarity.test.tsx` to confirm failure**
  Run: `cd web && npx vitest run src/pages/LandingNonTechClarity.test.tsx`
  Expected: FAIL.
- [x] **Step 3: Implement Human-First Copy & Progressive Disclosure in `LandingPage.tsx` and `SolvaMockupWidgets.tsx`**
  Rewrite default surface copy for instant 5-second comprehension by students and lecturers while keeping every technical benchmark (`Platt ECE`, `OOD Guardrail`, `R01–R30`, `ONNX INT8`) accessible inside clean `"Xem chi tiết kỹ thuật / Technical Details"` accordions/toggles. Preserve all `LandingInteractiveMotion.test.tsx` and `LandingVietnameseTypography.test.tsx` contracts.
- [x] **Step 4: Run full frontend verification gate**
  Run: `cd web && npm run lint && npx tsc --noEmit && npx vitest run && npm run build`
  Expected: PASS.
- [x] **Step 5: Run Triad Review & Critic Loop + Browser Non-Tech Comprehension Walkthrough (EN & VI)**
  Have `ux-nontech-critic` read the entire `LandingPage` top-to-bottom as a non-tech Humanities lecturer and undergraduate student; reject any surviving unexplained acronym or English leak in VI mode; loop until `APPROVED`.
- [x] **Step 6: Tick checkboxes & commit**
  ```bash
  git add web/src/pages/LandingPage.tsx web/src/components/landing/SolvaMockupWidgets.tsx web/src/pages/LandingNonTechClarity.test.tsx
  git commit -m "feat(landing-ux): humanize EN/VI copy for non-tech users and organize ML internals via progressive disclosure"
  ```

---

### Task 2.2: Frictionless Email-First Auth, Above-the-Fold `RegisterPage` (`1440×900`) & Non-Truncated `AuthSplitShell`

**Files:**
- Modify: `web/src/components/AuthSplitShell.tsx`
- Modify: `web/src/pages/LoginPage.tsx`
- Modify: `web/src/pages/RegisterPage.tsx`
- Modify: `web/src/pages/ForgotPasswordPage.tsx`
- Modify: `web/src/i18n/locales/en.json`
- Modify: `web/src/i18n/locales/vi.json`
- Modify: `web/src/pages/LoginPage.test.tsx`
- Modify: `web/src/pages/AuthPages.test.tsx`

**Interfaces:**
- Consumes: Global Constraint 2 (ZERO `<button><svg>` before `#password` Eye button!) & Global Constraint 5 (`register-privacy-consent-checkbox`).
- Produces:
  - `deriveUsernameFromEmailOrName(input: string): string` helper in `RegisterPage.tsx` (auto-suggests valid `3–50` char username from email/name until manually edited by user, keeping the `#username` input synced and editable).
  - Custom inline validation messages (`noValidate` on `<form>`) on `LoginPage`, `RegisterPage`, and `ForgotPasswordPage`.

- [x] **Step 1: Write failing tests in `web/src/pages/LoginPage.test.tsx` and `web/src/pages/AuthPages.test.tsx`**
  Assert:
  1. `LoginPage` labels the identifier input `"Email or Username"` (EN) / `"Email hoặc Tên đăng nhập"` (VI) (still matching `/username|tên đăng nhập/i`), shows inline error messages when submitted empty (without relying solely on native browser tooltips), and replaces raw `SSO · RBAC` with localized trust copy in `vi`.
  2. `RegisterPage` auto-populates a sanitized valid `#username` when the user types an email (e.g. `minh.nguyen+kltn@tdtu.edu.vn` -> `minh.nguyen_kltn`) unless the user explicitly edits `#username`; manual edits to `#username` still work identically for existing tests.
  3. `RegisterPage` placeholders fit cleanly without clipping, and compact vertical spacing + concise 2-line consent copy (`91/2025/QH15` + `/privacy` + `/terms`) keeps the entire card comfortably inside a `900px` desktop viewport.
  4. `AuthSplitShell` left panel renders localized verdict labels in `vi`, removes `truncate` / `line-clamp` ellipsis cuts on feature cards and source chips (`Semantic Scholar`), prevents `99,02% CHÍNH XÁC` from breaking mid-phrase, and preserves zero `<button>` elements in the left panel.
  5. Unauthenticated `"Try CITRA Free"` CTAs on `LandingPage` route to `#try-instant` / `/register` rather than dumping new visitors onto `/login` (`"Sign in"` still routes to `/login`).
- [x] **Step 2: Run `LoginPage.test.tsx`, `AuthPages.test.tsx`, and `PrivacyCompliance.test.tsx` to confirm failure**
  Run: `cd web && npx vitest run src/pages/LoginPage.test.tsx src/pages/AuthPages.test.tsx src/pages/PrivacyCompliance.test.tsx`
  Expected: FAIL.
- [x] **Step 3: Implement Auth UX overhaul across `AuthSplitShell.tsx`, `LoginPage.tsx`, `RegisterPage.tsx`, `ForgotPasswordPage.tsx`, `en.json`, `vi.json`, and `LandingPage.tsx` CTAs**
  Carefully verify DOM button order (`document.querySelectorAll('button svg')[0]` on `LoginPage` MUST remain the `#password` Eye icon!).
- [x] **Step 4: Run full frontend verification gate**
  Run: `cd web && npm run lint && npx tsc --noEmit && npx vitest run && npm run build`
  Expected: PASS.
- [x] **Step 5: Run Triad Review & Critic Loop + Browser Check (`/login`, `/register`, `/forgot-password` at `1440×900` & `390×844`, EN & VI, Light & Dark)**
  Verify that on `1440×900`, the `RegisterPage` `"Create Account →"` button is 100% visible above the bottom viewport edge without scrolling, placeholders never clip, and zero `...` truncations appear on the left showcase; loop until `APPROVED`.
- [x] **Step 6: Tick checkboxes & commit**
  ```bash
  git add web/src/components/AuthSplitShell.tsx web/src/pages/LoginPage.tsx web/src/pages/RegisterPage.tsx web/src/pages/ForgotPasswordPage.tsx web/src/i18n/locales/en.json web/src/i18n/locales/vi.json web/src/pages/LoginPage.test.tsx web/src/pages/AuthPages.test.tsx web/src/pages/LandingPage.tsx
  git commit -m "feat(auth-ux): enable email-first sign-in, auto-suggest username, fit register form in 900px viewport, and fix left-panel truncation"
  ```

---

### Task 2.3: Non-Tech Verdict Clarity & Actionable Guidance Across Workspace Badges (`VerdictBadge`, `MappingStatusBadge`, `UpgradeModal`)

**Files:**
- Modify: `web/src/components/VerdictBadge.tsx`
- Modify: `web/src/components/MappingStatusBadge.tsx`
- Modify: `web/src/components/UpgradeModal.tsx`
- Modify: `web/src/i18n/locales/en.json`
- Modify: `web/src/i18n/locales/vi.json`
- Modify: `web/src/components/ComponentsI18n.test.tsx`

**Interfaces:**
- Consumes: `getPlainVerdictLabel` and `getPlainMappingLabel` from Task 0.1.

- [x] **Step 1: Write failing tests in `web/src/components/ComponentsI18n.test.tsx`**
  Assert `VerdictBadge` and `MappingStatusBadge` render clear localized labels and accessible `title` / tooltip action hints in both `en` and `vi` (with zero raw uppercase underscore strings like `SUSPECTED_HALLUCINATION` or `IN_TEXT_MISMATCH`), while keeping all existing `I18nAndHygiene.test.tsx` & `ReportRedesignUX.test.tsx` expectations intact; assert `UpgradeModal` renders friendly, benefit-focused Vietnamese & English copy.
- [x] **Step 2: Run `ComponentsI18n.test.tsx` & `I18nAndHygiene.test.tsx` to confirm failure**
  Run: `cd web && npx vitest run src/components/ComponentsI18n.test.tsx src/pages/I18nAndHygiene.test.tsx`
  Expected: FAIL.
- [x] **Step 3: Enhance `VerdictBadge.tsx`, `MappingStatusBadge.tsx`, `UpgradeModal.tsx`, `en.json`, and `vi.json`**
  Wire human-friendly descriptions and `whitespace-nowrap` badge styling so badges never wrap mid-label on narrow table/card layouts.
- [x] **Step 4: Run full frontend verification gate**
  Run: `cd web && npm run lint && npx tsc --noEmit && npx vitest run && npm run build`
  Expected: PASS.
- [x] **Step 5: Run Triad Review & Critic Loop**
  Verify badge clarity, contrast, and zero regressions across report/workspace tests; loop until `APPROVED`.
- [x] **Step 6: Tick checkboxes & commit**
  ```bash
  git add web/src/components/VerdictBadge.tsx web/src/components/MappingStatusBadge.tsx web/src/components/UpgradeModal.tsx web/src/i18n/locales/en.json web/src/i18n/locales/vi.json web/src/components/ComponentsI18n.test.tsx
  git commit -m "feat(workspace-ux): add plain-language tooltips and bilingual clarity to verdict, mapping, and upgrade components"
  ```

---

## Phase 3 (Chặng P2): Award-Winning Frontend — Instant Guest Checker, Motion Polish & Master E2E Verification

### Task 3.1: Public Rate-Limited Instant Guest Citation Checker (`POST /api/essays/sandbox/public-verify` + Homepage `GuestInstantChecker`)

**Files:**
- Modify: `src/integrity_checker/api/routes/essays.py`
- Create: `tests/test_public_guest_sandbox.py`
- Modify: `web/src/api/client.ts`
- Create: `web/src/components/landing/GuestInstantChecker.tsx`
- Create: `web/src/components/landing/GuestInstantChecker.test.tsx`
- Modify: `web/src/pages/LandingPage.tsx`

**Interfaces:**
- Produces:
  - Backend endpoint: `POST /api/essays/sandbox/public-verify` accepting `{ references_text: string, lang?: 'vi' | 'en' }` (unauthenticated, sliding-window IP rate limit `6 req / 60s`, max `3` references / `1500` chars, `allow_serpapi_flag = False`), returning `SandboxInstantVerifyResponse`.
  - Frontend API method: `api.verifyPublicGuestCitations(payload: { references_text: string; lang?: 'vi' | 'en' }): Promise<SandboxInstantVerifyResponse>` in `web/src/api/client.ts` (note: ensure `deadCode.test.ts` stays green because `GuestInstantChecker.tsx` actively calls `api.verifyPublicGuestCitations`!).
  - Component: `<GuestInstantChecker lang={lang} />` mounted at `#try-instant` right below the Hero fold on `LandingPage.tsx`, featuring 3 one-click academic presets (*Luận văn Kinh tế / Economics Thesis*, *Bài báo Y khoa / Biomedical Paper*, *Nguồn AI tự bịa / AI-Invented Citation*), live textarea input (up to 3 references), Split-View Manuscript Diff results with plain-language verdicts + collapsible technical trace, graceful instant client fallback on network/429, and a 1-click `"Kiểm tra toàn bộ file PDF/Word miễn phí →"` CTA to `/register`.

- [x] **Step 1: Write failing backend test `tests/test_public_guest_sandbox.py` and frontend test `web/src/components/landing/GuestInstantChecker.test.tsx`**
  - Backend test: Assert unauthenticated `POST /api/essays/sandbox/public-verify` rejects empty input (`400`), caps/rejects `> 3` references or `> 1500` chars with clear message, verifies valid/hallucinated references without auth token, and enforces `429` rate limit on the 7th rapid call from the same IP.
  - Frontend test: Assert `GuestInstantChecker` renders 3 preset pills in EN & VI, populates and verifies citations on click, handles empty input & `429` rate-limit gracefully with friendly guidance, toggles `"Technical Trace"`, and links full-document upload CTA to `/register`.
- [x] **Step 2: Run backend pytest and frontend Vitest to confirm failure**
  Run: `.venv/bin/python -m pytest tests/test_public_guest_sandbox.py -v && cd web && npx vitest run src/components/landing/GuestInstantChecker.test.tsx`
  Expected: FAIL (`404` on `/api/essays/sandbox/public-verify` and missing `GuestInstantChecker`).
- [x] **Step 3: Implement backend `public-verify` route, `api.verifyPublicGuestCitations`, `GuestInstantChecker.tsx`, and mount on `LandingPage.tsx`**
  Wire Hero `"Try CITRA Free"` / `"Kiểm tra thử ngay"` primary experience so visitors can test CITRA live in 3 seconds with zero login wall!
- [x] **Step 4: Run full backend + frontend verification gates**
  Run: `.venv/bin/python -m ruff check src/ tests/ && .venv/bin/python -m pytest tests/test_public_guest_sandbox.py -q && cd web && npm run lint && npx tsc --noEmit && npx vitest run && npm run build`
  Expected: PASS.
- [x] **Step 5: Run Triad Review & Critic Loop + Live Browser Interactive Test**
  Test clicking all 3 presets and pasting custom citations in the live browser on Desktop & Mobile, Light & Dark, EN & VI; loop until `APPROVED`.
- [x] **Step 6: Tick checkboxes & commit**
  ```bash
  git add src/integrity_checker/api/routes/essays.py tests/test_public_guest_sandbox.py web/src/api/client.ts web/src/components/landing/GuestInstantChecker.tsx web/src/components/landing/GuestInstantChecker.test.tsx web/src/pages/LandingPage.tsx
  git commit -m "feat(plg): add rate-limited public guest citation checker and interactive homepage try-it studio"
  ```

---

### Task 3.2: Motion Token Polish, Dropdown Outside-Click Dismissal & Reduced-Motion Accessibility

**Files:**
- Modify: `web/src/styles/transitions-dev.css`
- Modify: `web/src/pages/LandingPage.tsx`
- Modify: `web/src/pages/PricingPage.tsx`
- Modify: `web/src/components/landing/SolvaPrimitives.tsx`
- Modify: `web/src/pages/LandingInteractiveMotion.test.tsx`

**Interfaces:**
- Consumes: Global Constraint 4 (`300ms` open / `190ms` close FAQ accordion timing invariant).

- [x] **Step 1: Write failing tests in `web/src/pages/LandingInteractiveMotion.test.tsx`**
  Assert:
  1. Clicking the header dropdown (`Platform` / `Dành cho ai`) opens the menu, and pressing `Escape` or clicking outside (`document.body`) dismisses it cleanly.
  2. `SolvaScrollReveal` immediately shows content without blank white gaps when anchor-jumped or when `prefers-reduced-motion: reduce` is active.
- [x] **Step 2: Run `LandingInteractiveMotion.test.tsx` to confirm failure**
  Run: `cd web && npx vitest run src/pages/LandingInteractiveMotion.test.tsx`
  Expected: FAIL.
- [x] **Step 3: Implement outside-click + `Escape` dismissal, asymmetric open/close polish, and instant anchor-scroll reveal**
  Refine hover/press/drawer transitions across `LandingPage`, `PricingPage`, and `GuestInstantChecker` using `cubic-bezier(0.16, 1, 0.3, 1)` enter (`180–240ms`) and fast exit (`130–160ms`), keeping FAQ `300ms`/`190ms` intact.
- [x] **Step 4: Run full frontend verification gate**
  Run: `cd web && npm run lint && npx tsc --noEmit && npx vitest run && npm run build`
  Expected: PASS.
- [x] **Step 5: Run Triad Review & Critic Loop + Browser Motion Check**
  Verify silky 60/120fps interactions, snappy dropdown dismissal, and zero blank scroll gaps; loop until `APPROVED`.
- [x] **Step 6: Tick checkboxes & commit**
  ```bash
  git add web/src/styles/transitions-dev.css web/src/pages/LandingPage.tsx web/src/pages/PricingPage.tsx web/src/components/landing/SolvaPrimitives.tsx web/src/pages/LandingInteractiveMotion.test.tsx
  git commit -m "polish(motion): add dropdown outside-click/Escape dismissal, anchor-reveal safety, and asymmetric motion curves"
  ```

---

### Task 3.3: Full-Suite End-to-End Multi-Viewport Audit & Final Principal UI/UX Sign-Off

**Files:**
- Create: `web/tests/e2e/citra-ux-overhaul.spec.ts`
- Modify: `docs/superpowers/plans/2026-11-19-citra-ui-ux-overhaul.md`

**Interfaces:**
- Verifies all tasks `0.1`–`3.2` end-to-end across viewports `375×812`, `390×844`, `768×1024`, `1024×768`, and `1440×900` in Light & Dark modes and EN & VI locales.

- [x] **Step 1: Write comprehensive Playwright E2E suite `web/tests/e2e/citra-ux-overhaul.spec.ts`**
  Cover:
  1. Zero horizontal overflow (`scrollWidth <= innerWidth`) across all 5 viewports on `/`, `/pricing`, `/login`, `/register`, `/forgot-password`, `/privacy`, `/terms`, and `/missing-route-404`.
  2. `RegisterPage` submit button bounding box completely within `1440×900` viewport height (`bottom <= 900`).
  3. Zero `LEGAL DRAFT`, `[CHECK:`, `[KIỂM TRA:`, or `4242` strings on `/`, `/pricing`, and `/privacy`.
  4. `GuestInstantChecker` 1-click preset & custom input check on `/` without login.
  5. Mobile menu `Pricing` navigation and Mobile `/pricing` segmented comparison switcher (`390×844`).
  6. Light & Dark theme toggle + `EN <-> VI` toggle with zero raw uppercase enum leaks (`SUSPECTED_HALLUCINATION`, `METADATA_ERROR`) on default marketing surfaces.
- [x] **Step 2: Execute full Playwright E2E suite, full Vitest suite, full Backend Pytest suite, and Production Build**
  Run:
  ```bash
  .venv/bin/python -m ruff check src/ tests/ scripts/
  .venv/bin/python -m pytest tests/ -q
  cd web && npm run lint && npx tsc --noEmit && npx vitest run && npm run build
  cd web && npx playwright test tests/e2e/citra-ux-overhaul.spec.ts tests/e2e/responsive.spec.ts tests/e2e/landing-vietnamese-typography.spec.ts
  ```
  Expected: 100% PASS across every suite.
- [x] **Step 3: Final Whole-Branch Triad Audit (`spec-code-reviewer` + `ux-nontech-critic` + live `browser` tour)**
  Perform a complete top-to-bottom live browser tour across all public & auth surfaces in Desktop & Mobile, Light & Dark, EN & VI. Fix any micro-imperfection caught until the Principal UI/UX & Non-Tech Critic awards **10/10 Sign-Off**.
- [x] **Step 4: Tick final checkboxes & commit**
  ```bash
  git add web/tests/e2e/citra-ux-overhaul.spec.ts docs/superpowers/plans/2026-11-19-citra-ui-ux-overhaul.md
  git commit -m "test(e2e): add comprehensive multi-viewport UI/UX overhaul verification suite"
  ```
