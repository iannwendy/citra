# CITRA (SourceLogic) Full Audit Bugfix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all 11 bug groups (`BUG-01` through `BUG-11`) discovered during the 2026-11-11 comprehensive Playwright & test-suite audit with 100% test pass rate and zero regressions across backend, frontend, linter, build, and live E2E flows.

**Architecture:** Preserve all existing API contracts, component props, and E2E test selectors while surgical-patching payment verification security (`BillingSuccessPage`), health/parser telemetry (`health.py`, `system.py`, `UploadPage`, `SystemHealthPage`), ESLint v9 flat-config tooling (`web/package.json`, `web/eslint.config.js`), modal accessibility (`PromoManagementPage`), HTML5 landmarks & link targets (`PricingPage`, `ScholarlySourceLogos`, `SolvaMockupWidgets`), DOM word-spacing (`AuthSplitShell`, `SolvaPrimitives`), multi-format badges (`HistoryPage`, `DashboardPage`, `EssayHeader`), VI/EN bilingual parity (`essays.py`, `EssayPage`, `OrphanDetectionPage`, `MyClassesPage`, `SettingsPage`), and browser/test console cleanliness (`index.html`, `router.tsx`, `main.tsx`, `transitions.tsx`).

**Tech Stack:** Python 3.14 / FastAPI / Pytest / Ruff, React 18 / TypeScript / Vite / Vitest / ESLint 9 (`typescript-eslint`) / Playwright.

---

### Task 1: Backend Health Telemetry & Bilingual Sandbox Note (`BUG-02` & `BUG-10a`)

**Files:**
- Modify: `src/integrity_checker/api/routes/health.py`
- Modify: `src/integrity_checker/api/routes/system.py`
- Modify: `src/integrity_checker/api/routes/essays.py`
- Modify: `tests/unit/test_system_health.py`

- [ ] **Step 1: Write failing backend unit tests** in `tests/unit/test_system_health.py` verifying:
  1. When `check_grobid_health()` returns `GROBID_STATUS.UNHEALTHY` and Docker reports `container_running=False`, `/api/health` does NOT claim `"GROBID container running"`, and instead reports `"GROBID container is not running (using built-in regex parser fallback)"`.
  2. When `container_running=True` and `GROBID_STATUS.UNHEALTHY`, `/api/health` reports `"GROBID container running but API not responding"`, and `/api/system/health` exposes `services.grobid == "degraded"`.
  3. When GROBID is offline (`container_running` is `False` or `None`), `/api/system/health` includes `services` (`database: "ok"`, `cache: "ok"`, `parser: "ok"`), `parser_mode: "regex"`, and `grobid_available: False` while keeping overall `status == "ok"` so built-in regex fallback does not trigger false degraded alarms.
  4. `/api/essays/sandbox-verify` with `raw_references_text` respects optional `lang="en"` (or `Accept-Language: en`) by emitting English Layer 1 note `"Direct bibliography verification."` instead of hardcoded Vietnamese, while keeping Vietnamese when `lang="vi"`.
- [ ] **Step 2: Run pytest on `tests/unit/test_system_health.py` to confirm RED.**
- [ ] **Step 3: Implement minimal fixes** in `health.py`, `system.py`, and `essays.py` (plus pass `lang` from `SandboxPage.tsx` / `LandingPage.tsx` if needed or localize in `essays.py` + frontend).
- [ ] **Step 4: Re-run `pytest tests/unit/test_system_health.py` and `ruff check src/ tests/` to confirm GREEN.**

---

### Task 2: Frontend ESLint Flat Config Restoration (`BUG-04`)

**Files:**
- Modify: `web/package.json`
- Create: `web/eslint.config.js`

- [ ] **Step 1: Install ESLint flat-config devDependencies** (`eslint`, `@eslint/js`, `typescript-eslint`, `eslint-plugin-react-hooks`, `globals`) in `web/` and update `"lint": "eslint ."` in `web/package.json`.
- [ ] **Step 2: Author `web/eslint.config.js`** targeting `**/*.{ts,tsx}`, ignoring `dist/`, `node_modules/`, `playwright-report/`, `test-results/`, registering `react-hooks` plugin (honoring existing `// eslint-disable-next-line react-hooks/exhaustive-deps` directives), and configuring practical TypeScript/React rules so real bugs are caught cleanly.
- [ ] **Step 3: Run `cd web && npm run lint` and fix any surfaced lint violations cleanly until exit code is `0`.**

---

### Task 3: Payment Receipt Verification Guard on `/billing/success` (`BUG-01`)

**Files:**
- Modify: `web/src/pages/BillingSuccessPage.tsx`
- Modify: `web/src/pages/PricingAndBilling.test.tsx`

- [ ] **Step 1: Write failing Vitest cases** in `PricingAndBilling.test.tsx`:
  1. Navigating directly to `/billing/success` with NO `session_id` and NO `vnp_*` params renders `data-testid="billing-verification-missing"` (no `"PAYMENT SUCCEEDED"` / `"THANH TOÁN THÀNH CÔNG"` banner).
  2. Navigating to `/billing/success?session_id=invalid_forged_123` when `api.verifyCheckoutSession` rejects (or VNPay returns `is_success: false` / rejects) renders `data-testid="billing-verification-error"` with the error reason instead of swallowing the error and showing a fake receipt.
- [ ] **Step 2: Run Vitest on `PricingAndBilling.test.tsx` to confirm RED.**
- [ ] **Step 3: Update `BillingSuccessPage.tsx`** to track `verificationState: 'verifying' | 'verified' | 'missing_session' | 'failed'` and `errorMessage`, checking `vnpRes.is_success !== false && vnpRes.status === 'succeeded'` and `res.status === 'succeeded'`, and rendering dedicated missing-session / failed-verification UI cards with actions back to `/pricing` and `/settings`.
- [ ] **Step 4: Run `PricingAndBilling.test.tsx` to confirm GREEN (all existing + new billing tests pass).**

---

### Task 4: Modal Accessibility, Landmarks, Links & Pricing Tier Guardrails (`BUG-05`, `BUG-06`, `BUG-07`)

**Files:**
- Modify: `web/src/pages/PromoManagementPage.tsx`
- Modify: `web/src/pages/PricingPage.tsx`
- Modify: `web/src/components/landing/ScholarlySourceLogos.tsx`
- Modify: `web/src/components/landing/SolvaMockupWidgets.tsx`
- Modify: `web/src/pages/PricingAndBilling.test.tsx`

- [ ] **Step 1: Write failing Vitest cases** in `PricingAndBilling.test.tsx` verifying:
  1. `PromoManagementPage` modals (`promo-form-modal` and `promo-delete-modal`) expose `role="dialog"`, `aria-modal="true"`, and close when pressing `Escape`.
  2. Authenticated `PricingPage` inside `AppLayout` has zero nested `main main` elements (`container.querySelectorAll('main main').length === 0`), while public `PricingPage` still renders `<main id="pricing-main-content">`.
  3. Every scholarly source link in `PricingPage` has a non-empty `https://` `href` attribute (including `Retraction Watch`, `Wayback Machine`, `IETF RFC`, `VN Legal`), and the `"Inspect live trace"` / `"Soi chiếu trực tiếp"` link points to `/#interactive-demo` when rendered off `/`.
  4. Non-admin `Ultra` users on `PricingPage` see `select-pro-btn` disabled (`Included in Ultra` / `Đã bao gồm trong Ultra`) instead of an accidental paid downgrade CTA, and `select-ultra-btn` recognizes `planTier === 'ultra'` when `user.billing_cycle` is `null` or matches `cycle`.
- [ ] **Step 2: Run Vitest to confirm RED.**
- [ ] **Step 3: Implement fixes** using `useModalA11y` in `PromoManagementPage.tsx`, conditional `<main>` vs `<div>` in `PricingPage.tsx`, complete registry URLs in `ScholarlySourceLogos.tsx`, route-aware `/#interactive-demo` href in `SolvaMockupWidgets.tsx`, and Ultra tier CTA state in `PricingPage.tsx`.
- [ ] **Step 4: Run Vitest to confirm GREEN.**

---

### Task 5: Word-Spacing DOM Integrity & Multi-Format Telemetry (`BUG-03`, `BUG-08`, `BUG-09`)

**Files:**
- Modify: `web/src/components/AuthSplitShell.tsx`
- Modify: `web/src/components/landing/SolvaPrimitives.tsx`
- Modify: `web/src/pages/UploadPage.tsx`
- Modify: `web/src/pages/SystemHealthPage.tsx`
- Modify: `web/src/pages/HistoryPage.tsx`
- Modify: `web/src/pages/DashboardPage.tsx`
- Modify: `web/src/pages/essay/EssayHeader.tsx`
- Modify: `web/src/pages/LandingVietnameseTypography.test.tsx`
- Modify: `web/src/pages/AdminTeacherFlows.test.tsx`

- [ ] **Step 1: Write failing unit tests** verifying:
  1. `SolvaTwoToneHeading` with both `primary` and `secondary` separates them with a single `' '` space in `textContent` (while `primary`-only keeps exact `textContent` with no trailing space).
  2. `AuthSplitShell` hero heading preserves real spaces between words in `textContent` and displays `APP_VERSION` instead of hardcoded `v2.3`.
  3. `UploadPage` formats sub-1MB files in `KB` instead of `0.00 MB`, labels `.bib`/`.ris`/`.docx`/`.pdf` with their true parser badge, localizes `{planTier} PLAN` in VI, and reflects `/api/health` parser status instead of hardcoding `"GROBID v0.9.1 ONLINE"` when regex fallback is active.
  4. `HistoryPage` and `DashboardPage` label `.bib` (`BIBTEX · .BIB`) and `.ris` (`RIS · BIBLIOGRAPHY`) accurately instead of `GROBID TEI`, and `EssayHeader` hides raw `UNKNOWN` style badge and singularizes `1 page`.
  5. `SystemHealthPage` renders human-readable labels for `cache_stats` keys (`total_hits`, `avg_hit_count`, `local_papers_count`, `local_queries_count`, `local_hit_rate_percent`) and localizes `total records` in VI.
- [ ] **Step 2: Run Vitest on the affected test files to confirm RED.**
- [ ] **Step 3: Implement the clean fixes across those 7 components.** (Remember `deadCode.test.ts`: do NOT add `api.health` on `client.ts`; use lightweight `fetch('/api/health')` with abort controller inside `UploadPage.tsx`.)
- [ ] **Step 4: Run Vitest to confirm GREEN.**

---

### Task 6: Bilingual Completeness & Console / Timer Hygiene (`BUG-10b` & `BUG-11`)

**Files:**
- Modify: `web/src/pages/OrphanDetectionPage.tsx`
- Modify: `web/src/pages/MyClassesPage.tsx`
- Modify: `web/src/pages/EssayPage.tsx`
- Modify: `web/src/pages/SettingsPage.tsx`
- Modify: `web/src/pages/SandboxPage.tsx`
- Modify: `web/index.html`
- Modify: `web/src/router.tsx`
- Modify: `web/src/main.tsx`
- Modify: `web/src/components/ui/transitions.tsx`

- [ ] **Step 1: Write failing Vitest cases** verifying:
  1. `OrphanDetectionPage`, `MyClassesPage`, `EssayPage`, and `SettingsPage` render localized Vietnamese labels when `i18n.language === 'vi'` while keeping exact English strings when `i18n.language === 'en'`.
  2. `SubtleNumber` produces zero `not wrapped in act(...)` stderr warnings during test updates while keeping `.t-subtle-number` DOM structure intact.
- [ ] **Step 2: Run Vitest to confirm RED.**
- [ ] **Step 3: Implement fixes:**
  1. Localize remaining hardcoded strings in `OrphanDetectionPage.tsx`, `MyClassesPage.tsx`, `EssayPage.tsx`, `SettingsPage.tsx`, and pass `lang` in `SandboxPage.tsx` quick-paste verification payload.
  2. Remove global `<link rel="preload" as="image" href="/solva/hero-bg.webp">` from `web/index.html` (LandingPage already loads it immediately via CSS/hero mount without polluting non-landing routes with unused-preload warnings; also remove `/citra-logo.png` preload if unused on routes without `<img>` tag).
  3. Enable React Router v6 future flags (`v7_relativeSplatPath`, `v7_fetcherPersist`, `v7_normalizeFormMethod`, `v7_partialHydration`, `v7_skipActionErrorRevalidation` in `router.tsx` and `v7_startTransition: true` in `main.tsx`).
  4. Guard `SubtleNumber` (and `NumberPopIn` / `SoftTextSwap`) async `requestAnimationFrame`/`setTimeout` transitions when running under JSDOM/Vitest (`import.meta.env.MODE === 'test'`) so state updates are synchronous in unit tests while preserving 100% real browser CSS transitions in Playwright & production.
- [ ] **Step 4: Run full Vitest suite (`cd web && npm test`) and verify 0 failures and 0 `act(...)` warnings.**

---

### Task 7: End-to-End Regression Suite & Live Playwright Audit Verification

**Files:**
- Modify: `web/tests/e2e/` (add dedicated regression assertions covering audited bugs)

- [ ] **Step 1: Restart backend daemon** so FastAPI serves updated `health.py`, `system.py`, and `essays.py`.
- [ ] **Step 2: Run full backend verification:**
  - `.venv/bin/ruff check src/ tests/`
  - `.venv/bin/python -m pytest tests/unit/ tests/integration/test_api.py tests/integration/test_auth.py -q`
- [ ] **Step 3: Run full frontend build & quality verification:**
  - `cd web && npx tsc -b`
  - `cd web && npm run lint`
  - `cd web && npm test`
  - `cd web && npm run build`
- [ ] **Step 4: Run full Playwright E2E suite (`cd web && npx playwright test`)** + live interactive Playwright MCP verification across `/`, `/pricing`, `/login`, `/billing/success`, `/upload`, `/sandbox`, `/history`, `/dashboard`, `/verification/report/:id`, `/verification/report/:id/consistency`, `/teacher/classes`, `/admin/promos`, `/admin/system`, `/settings` in both `VI` & `EN`, `Light` & `Dark`, `Desktop` & `Mobile`, confirming **0 console errors, 0 unused preload warnings, 0 React Router warnings, 0 broken links, and 100% pass rate**.
