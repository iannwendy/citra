# CITRA (`SourceLogic`) Full 3-Wave Remediation & Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Follow strict TDD (`test-driven-development`: write failing regression test -> verify RED -> implement minimal clean fix -> verify GREEN) and peer Cross-Review (`author <-> verifier`) before marking any track complete. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve 100% of security vulnerabilities, RBAC/IDOR leaks, core Neuro-Symbolic & concurrency bugs, billing/quota/SQLite/PostgreSQL defects, frontend/Nginx/API contract mismatches, and 120K benchmark/CI/documentation discrepancies identified across Waves 1, 2, and 3 of the `v3.76.0` system audit.

**Architecture:** The work is partitioned into **6 strictly file-disjoint parallel Author tracks** (`A1`–`A6`) paired with **3 independent Cross-Review Verifiers** (`verifier-core`, `verifier-backend`, `verifier-fullstack`) plus a final **Full-Suite Gate**. Every cross-track API/function contract is pinned upfront in this plan so authors work concurrently in the live workspace with zero file collisions and zero git-index races.

**Tech Stack:** Python 3.11+ (`FastAPI`, `SQLAlchemy 2.0`, `PyMuPDF`, `httpx`, `Sentence-BERT` / `ONNX Runtime`, `Ruff`, `Pytest`), React 18 + TypeScript + Vite + Tailwind CSS (`Vitest`, `ESLint`), Nginx, Docker Compose, GitHub Actions.

**Spec:** `/Users/iannwendy/.gemini/antigravity-cli/brain/01d3799a-bf78-4efc-b09a-cfcfebf5e029/audit_overview_report.md`

---

## Global Constraints

1. **Zero Git Index Collisions & Working-Tree Preservation:** Do **NOT** run `git commit`, `git reset`, `git checkout`, `git clean`, or `git stash` inside worker turns. The repository currently holds intentional uncommitted `docs/` reorganizations and asset cleanups that must remain untouched.
2. **Strict Exclusive File Ownership:** Each Author worker may ONLY create or edit files explicitly listed in its Track's **Owned Files** block. Never edit another track's files; if an interface issue arises, post on the swarm board.
3. **Decision-Support Principle (Mandatory):** No rule reasoning, preview annotation, or UI string in English or Vietnamese may deterministically accuse a student of cheating/fabrication/misconduct. Always frame outputs as evidence-based decision-support signals (e.g., `"suspected hallucinated reference"`, `"NGHI VẤN NGUỒN BỊA ĐẶT / ẢO GIÁC AI — CẦN KIỂM TRA"`).
4. **Backward Compatibility with Existing Green Suites:** All existing `2,085` backend tests and `340` frontend Vitest tests must remain 100% green alongside the new regression suites; `ruff check src/ tests/ scripts/`, `npm run lint`, `npx tsc --noEmit`, and `npm run build` must exit `0` with zero errors.
5. **TDD & Cross-Review Gate:** Every bug fix requires a dedicated unit/integration regression test proven to fail before the fix (or directly pinning the exact failure condition) and verified by an independent Verifier agent that did **not** write the code.

---

## Pinned Cross-Track Interfaces

1. **`DoiRaClient` <-> `SymbolicRules` (Track 1 <-> Track 2):**
   - When `DoiRaClient.lookup(citation)` confirms a recognized non-Crossref Registration Agency (`ra_name`) via `doi.org/doiRA`, **and** `_fetch_csl_json()` returns `None` (no metadata), `DoiRaClient` returns `SourceCandidate(source_name="doi_ra", found=False, doi=doi_norm, url=f"https://doi.org/{doi_norm}", external_ids={"doi": doi_norm, "doi_ra": ra_name, "doi_ra_status": "registered_no_csl"}, error=f"DOI RA: CSL metadata unavailable for '{doi_norm}' (RA={ra_name})")` — **never** copying `citation.title`, `citation.authors`, or `citation.year`.
   - `SymbolicRules` treats `doi_ra_status == "registered_no_csl"` as proof the DOI string itself is registered (suppressing `R-NONEXISTENT-DOI`), while abstaining (`ValidationLabel.UNRESOLVED`) when no other source confirms bibliographic metadata.
2. **`IntegrityPipeline.run_async` Cache Isolation & Bypass (Track 2 <-> Track 4):**
   - `IntegrityPipeline._report_cache_key(self, pdf_path: str, *, max_citations: int | None = None, allow_serpapi: bool = True) -> str | None` incorporates `max_citations` and `allow_serpapi` so truncated Basic reports never poison Pro/Ultra/Teacher/Admin runs.
   - `IntegrityPipeline.run_async(..., bypass_report_cache: bool = False)` (and `run(..., bypass_report_cache: bool = False)`) skips `_load_report_cache` when `bypass_report_cache=True`, while still writing the fresh result back to cache. Track 4 passes `bypass_report_cache=True` from `POST /api/essays/{essay_id}/reanalyze`.
3. **Classroom CRUD & Class ZIP Export Contract (Track 3 <-> Track 4 <-> Track 5):**
   - `Class` uniqueness is scoped per teacher `(teacher_id, name)` (`UniqueConstraint("teacher_id", "name", name="uq_classes_teacher_name")` in `db/models.py` + migration `0012` in `db/migrations.py`). Same teacher duplicate name still returns `HTTP 400` (`"already exists"`), while two different teachers can use the same class name.
   - `PATCH /api/teacher/classes/{class_id}` — Body: `{ "name"?: str, "description"?: str }` -> `200 ClassResponse` (400 if blank or duplicate name for same teacher; 403 if not owner/admin).
   - `DELETE /api/teacher/classes/{class_id}` -> `200 { "status": "deleted", "id": class_id }` (detaches `EssayRecord.class_id = None` for essays referencing `class_id`, deletes `ClassMembership` rows and the `Class` row, freeing teacher class quota).
   - `DELETE /api/teacher/classes/{class_id}/leave` (student endpoint using `get_current_user`) -> `200 { "status": "left", "class_id": class_id }` (404 if not enrolled).
   - `GET /api/teacher/classes/{class_id}/export.zip` -> `200 application/zip` (`Content-Disposition: attachment; filename="class_{class_id}_export.zip"`) containing UTF-8-BOM `gradebook_summary.csv` (per-student aggregated CIS & verdict counts), UTF-8-BOM `verdicts_detail.csv` (with `cis_score` column), and `essays/{essay_id}_summary.json` per class essay.
4. **Billing Checkout Mode Union (Track 3 <-> Track 5):**
   - `POST /api/billing/create-checkout-session` returns `mode: "stripe_live" | "stripe_test" | "stripe_demo" | "promo_waiver"`. When a valid promo code waives 100% of the price (`amount_usd == 0.0`, e.g., `VIP100`), even in `production`, backend creates a verified zero-amount transaction (`mode="promo_waiver"`) that upgrades the user cleanly upon `/verify-session` without triggering the `stripe_demo` production 403 block.
5. **Global `401` Session Expiry Event (Track 5 internal):**
   - `web/src/api/client.ts` emits `window.dispatchEvent(new CustomEvent('citra:unauthorized'))` on `401` responses from non-auth endpoints (`/auth/login`, `/auth/google`, `/auth/register` excluded), and `AuthContext.tsx` subscribes to clear local state cleanly.

---

## Review Focus (Top Cross-Cutting Edge Cases Covered by Tasks)

1. **Chimeric DOI on Regional Agency:** Student cites fabricated paper title `"Quantum Mind Reading in LLMs"` with real JaLC DOI `10.11499/sicejl.58.123` while CSL-JSON returns HTTP 406/timeout -> must yield `UNRESOLVED` (not `VERIFIED` and not `R-NONEXISTENT-DOI`).Pinned in Track 1 & Track 2 tests.
2. **Pre-Hijacked Unverified Local Account + Google Sign-In:** Attacker registers `victim@uni.edu.vn` with password `EvilPassword1!` (unverified) -> real victim logs in via Google OAuth -> attacker attempts `POST /api/auth/login` with `EvilPassword1!` -> must fail `401` and any prior sessions/API keys must be revoked. Pinned in Track 3 tests.
3. **Overriding a Citation to `suspected_hallucination` & Override on Legal-Only Essay:** Instructor overrides an `unresolved` citation to `suspected_hallucination` -> `num_verified` in `/api/essays` and `verdict_breakdown["verified"]` in `/api/teacher/classes/{id}` must NOT increment, while `suspected_hallucination` MUST increment; overriding a verdict on an essay with only `resource` legal citations must NOT crash CIS to `0.0%`. Pinned in Track 4 tests.
4. **Paid Student Accessing `/teacher/classes` vs `/batch-upload`:** Pro/Ultra user with `role="user"` can access `/batch-upload` (`canBatchUpload === true`), while navigating to `/teacher/classes` is blocked by `ProtectedRoute` before firing teacher API calls. Pinned in Track 5 tests.
5. **Event-Loop Turnover Under Thread-Pool Execution:** Running `LinkValidator` and `ArxivClient` across multiple sequential and concurrent `asyncio.run()` threads must never raise `RuntimeError: ... bound to a different event loop` or leak dead loop keys. Pinned in Track 1 tests.

---

## Track Breakdown (Waves 1, 2 & 3 Combined per Disjoint Domain)

### Track 1 (`author-core-retrieval` -> `verifier-core`): Retrieval, Concurrency, SSRF/DoS & Extraction Hardening

**Owned Files (Exclusive):**
- Modify: `src/integrity_checker/models/source.py`
- Modify: `src/integrity_checker/retrieval/doi_ra_client.py`
- Modify: `src/integrity_checker/retrieval/retrieval_orchestrator.py`
- Modify: `src/integrity_checker/retrieval/link_validator.py`
- Modify: `src/integrity_checker/retrieval/arxiv_client.py`
- Modify: `src/integrity_checker/retrieval/serpapi_client.py`
- Modify: `src/integrity_checker/retrieval/europepmc_client.py`
- Modify: `src/integrity_checker/retrieval/tech_standard_client.py`
- Modify: `src/integrity_checker/retrieval/cache.py`
- Modify: `src/integrity_checker/extraction/docx_parser.py`
- Modify: `src/integrity_checker/extraction/grobid_parser.py`
- Modify: `src/integrity_checker/extraction/grobid_service.py`
- Modify: `src/integrity_checker/extraction/style_detector.py`
- Create Test: `tests/unit/test_wave1_core_retrieval_hardening.py`

- [ ] **Step 1 (RED):** Write failing regression tests in `tests/unit/test_wave1_core_retrieval_hardening.py` covering:
  - `DoiRaClient` non-Crossref RA (`JaLC`/`DataCite`) with failing CSL-JSON returning `found=False` + `doi_ra_status="registered_no_csl"` (never echoing `citation.title`/`authors`).
  - `RetrievalOrchestrator._enrich_missing_abstract` on ACL Anthology DOI `10.18653/v1/N19-1423` succeeding without `get_shared_http_client` `TypeError`.
  - `_CrossLoopSingleflight` leader cancellation NOT raising `CancelledError` in concurrent follower thread.
  - `LinkValidator` & `ArxivClient` loop-primitive `WeakKeyDictionary` cleanup across repeated `asyncio.run()` loops + Wayback cache thread safety.
  - `SourceResult.consensus_count()` & `has_retracted_candidate()` scoped strictly to candidates matching `best_candidate()`.
  - `DocxParser.parse()` rejecting a crafted ZIP bomb (`uncompressed > 100 MB`) before `docx.Document()` loads XML into RAM.
  - `GrobidParser` `consolidate_header` config mapping (`list` -> `"1"`, `"0"`/`False` -> `"0"`).
- [ ] **Step 2 (Verify RED):** Run `.venv/bin/python -m pytest tests/unit/test_wave1_core_retrieval_hardening.py -v` and confirm failures.
- [ ] **Step 3 (GREEN):** Implement the minimal, thread-safe fixes across Track 1's owned files (including `64 KB` cap on `CITATION.cff` in `tech_standard_client.py`, `"retracted publication"` detection + `_backoff_until` lock in `europepmc_client.py`, `_negative_query_cache` lock + bounded quota cooldown in `serpapi_client.py`, UUID `.tmp` atomic writes in `retrieval/cache.py` & `grobid_service.py`, `get_grobid_manager()` lock, and `style_detector.py` math fix).
- [ ] **Step 4 (Verify GREEN & Lint):** Run `.venv/bin/python -m pytest tests/unit/test_wave1_core_retrieval_hardening.py tests/unit/test_nine_free_apis.py tests/unit/test_retrieval_orchestrator.py tests/unit/test_retrieval_clients.py tests/unit/test_docx_parser.py -q` and `.venv/bin/python -m ruff check` on all Track 1 files.
- [ ] **Step 5 (Cross-Review):** Hand off to `@verifier-core` and iterate until `@verifier-core` approves with zero Critical/Important issues.

---

### Track 2 (`author-linking-logic` -> `verifier-core`): Layer-1 CitationLinker, SymbolicRules, VNLegalVerifier, Calibration & Pipeline

**Owned Files (Exclusive):**
- Modify: `src/integrity_checker/linking/statuses.py`
- Modify: `src/integrity_checker/linking/citation_linker.py`
- Modify: `src/integrity_checker/logic/vn_legal_verifier.py`
- Modify: `src/integrity_checker/logic/rules.py`
- Modify: `src/integrity_checker/logic/neuro_symbolic_checker.py`
- Modify: `src/integrity_checker/logic/calibration.py`
- Modify: `src/integrity_checker/logic/explanation.py`
- Modify: `src/integrity_checker/matching/semantic.py`
- Modify: `src/integrity_checker/pipeline/integrity_pipeline.py`
- Create Test: `tests/unit/test_wave1_linking_and_logic_hardening.py`

- [ ] **Step 1 (RED):** Write failing regression tests in `tests/unit/test_wave1_linking_and_logic_hardening.py` covering:
  - `CitationLinker` emitting `STYLE_INCONSISTENT` when stray author-year callouts appear in a high-confidence numeric IEEE document (and vice-versa when `dominant_style` is passed).
  - `CitationLinker` emitting `AMBIGUOUS_MAPPING` when `(Smith, 2020)` matches two distinct `Smith 2020a`/`2020b` bibliography entries that cannot be disambiguated, AND emitting `MISSING_REFERENCE` for `99` in `[1, 99]`.
  - `IntegrityPipeline` preserving `AMBIGUOUS_MAPPING` / `IN_TEXT_MISMATCH` on `CitationVerdict.mapping_status` when no clean `MATCHED` link exists, plus `_report_cache_key` isolating `(max_citations, allow_serpapi)` and honoring `bypass_report_cache=True`.
  - `VNLegalVerifier` NOT emitting `R-VN-LEGAL-VERIFIED` (`is_verified_statute=False`) for unknown/fabricated statutes outside `_STATUTE_REGISTRY` while keeping all registered statutes (including bare code `"Luật số 59/2020/QH14"` and `168/2025/NĐ-CP`) verified, AND `NeuroSymbolicChecker` flagging `R-FAKE-URL` on VN legal citations with `https://example.com/fake.pdf`.
  - `SymbolicRules`: `doi_ra_status="registered_no_csl"` -> `UNRESOLVED`; `R-CONTENT-MISMATCH` on strongly matched real paper (`title_sim >= 0.85`, `author_sim >= 0.50`, `year_dist <= 1`) -> `METADATA_ERROR` instead of `SUSPECTED_HALLUCINATION`; `R-FUTURE-YEAR` allowing `current_year + 1` cover date without `"fabricated citation"` accusation; `HybridMLScorer` capping pure `R-NO-SCHOLARLY-RECORD` absence-of-evidence confidence `<= 0.88`.
- [ ] **Step 2 (Verify RED):** Run `.venv/bin/python -m pytest tests/unit/test_wave1_linking_and_logic_hardening.py -v` and confirm failures.
- [ ] **Step 3 (GREEN):** Implement fixes across Track 2's owned files (including UUID `.tmp` report cache writes, `StyleDetector(get_settings().style_detection)` wiring, `statuses.py`/`explanation.py` `AMBIGUOUS_MAPPING` definition fix, and thread locks on `NeuroSymbolicChecker` / `SemanticMatcher._intent_emb_cache`).
- [ ] **Step 4 (Verify GREEN & Lint):** Run `.venv/bin/python -m pytest tests/unit/test_wave1_linking_and_logic_hardening.py tests/unit/test_citation_linker.py tests/unit/test_sprint3_differentiators.py tests/unit/test_ambiguous_and_hard_cases.py tests/unit/test_rules.py tests/unit/test_calibration.py -q` and `.venv/bin/python -m ruff check` on all Track 2 files.
- [ ] **Step 5 (Cross-Review):** Hand off to `@verifier-core` and iterate until approved.

---

### Track 3 (`author-auth-billing-db` -> `verifier-backend`): Auth Security, Billing/VNPay/Quota, SQLite FK/PostgreSQL & Worker Startup

**Owned Files (Exclusive):**
- Modify: `src/integrity_checker/api/__init__.py`
- Modify: `src/integrity_checker/api/main.py`
- Modify: `src/integrity_checker/api/job_recovery.py`
- Modify: `src/integrity_checker/api/routes/auth.py`
- Modify: `src/integrity_checker/api/routes/users.py`
- Modify: `src/integrity_checker/api/routes/billing.py`
- Modify: `src/integrity_checker/billing/vnpay.py`
- Modify: `src/integrity_checker/billing/plans.py`
- Modify: `src/integrity_checker/db/sqlite_tuning.py`
- Modify: `src/integrity_checker/db/models.py`
- Modify: `src/integrity_checker/db/migrations.py`
- Modify: `src/integrity_checker/db/session.py`
- Modify: `src/integrity_checker/worker.py`
- Modify: `src/integrity_checker/config.py`
- Modify: `tests/unit/test_db_migrations.py` (only if adding migration `0012` updates `LATEST_SCHEMA_VERSION`)
- Create Test: `tests/unit/test_wave1_auth_billing_db_security.py`

- [ ] **Step 1 (RED):** Write failing regression tests in `tests/unit/test_wave1_auth_billing_db_security.py` covering:
  - Google OAuth login against a pre-registered unverified local email clearing `password_hash`, setting `auth_provider="google"`, and revoking prior sessions/API keys so the attacker's password fails (`401`).
  - Spoofed `X-Forwarded-For` NOT bypassing `_login_rate_limiter` when `X-Real-IP` / client host is fixed, plus rate limiting on `/register` & `/resend-activation`.
  - Production VNPay verification/IPN/create-payment rejecting missing or default `VNPAY_DEFAULT_HASH_SECRET` regardless of `VNPAY_EXTERNAL_REDIRECT`, and rejecting external untrusted `return_url` domains.
  - `ensure_user_quota_current` downgrading expired paid plans at `now >= current_period_end` even when `cancel_at_period_end == 0`.
  - `VIP100` (`100%` promo waiver) succeeding in production (`mode="promo_waiver"`) without `stripe_demo` `403`, and atomic per-user promo limit check.
  - `PRAGMA foreign_keys=ON` enabled on SQLite connections so deleting an `EssayRecord` cascades child `CitationRecord` and `VerdictRecord` rows cleanly (`0` orphans!).
  - Scoped `(teacher_id, name)` class uniqueness via migration `0012` (`uq_classes_teacher_name`).
  - Importing `integrity_checker.api.deps` or running `worker.py` with `CITRA_WORKER_MODE=worker_only` NOT spawning `main.py`'s inline `_startup_background_maintenance` thread at import time.
- [ ] **Step 2 (Verify RED):** Run `.venv/bin/python -m pytest tests/unit/test_wave1_auth_billing_db_security.py -v` and confirm failures.
- [ ] **Step 3 (GREEN):** Implement all fixes across Track 3's owned files (including PostgreSQL `int(bool(...))` safety & `pool_pre_ping=True`, `GOOGLE_CLIENT_ID="disabled"` support, `config.py` env var support for `DATA_DIR`/`CACHE_DIR`/`CONFIG_FILE`/thresholds, and periodic `job_heartbeat_at` helper).
- [ ] **Step 4 (Verify GREEN & Lint):** Run `.venv/bin/python -m pytest tests/unit/test_wave1_auth_billing_db_security.py tests/unit/test_auth_flows.py tests/unit/test_billing_subscription.py tests/unit/test_db_migrations.py tests/unit/test_user_management.py tests/integration/test_auth.py -q` and `.venv/bin/python -m ruff check` on all Track 3 files.
- [ ] **Step 5 (Cross-Review):** Hand off to `@verifier-backend` and iterate until approved.

---

### Track 4 (`author-essays-classroom-export` -> `verifier-backend`): Essays, RBAC/IDOR, Sandbox, Verdicts/CIS, Classroom CRUD & Exporters

**Owned Files (Exclusive):**
- Modify: `src/integrity_checker/db/repository.py`
- Modify: `src/integrity_checker/api/routes/essays.py`
- Modify: `src/integrity_checker/api/routes/verdicts.py`
- Modify: `src/integrity_checker/api/routes/report.py`
- Modify: `src/integrity_checker/api/routes/teacher.py`
- Modify: `src/integrity_checker/api/routes/export.py`
- Modify: `src/integrity_checker/export/docx_exporter.py`
- Create Test: `tests/unit/test_wave1_rbac_classroom_export_fixes.py`

- [ ] **Step 1 (RED):** Write failing regression tests in `tests/unit/test_wave1_rbac_classroom_export_fixes.py` covering:
  - Cross-user PDF preview `rglob` disclosure blocked + `/sandbox/generate-pdf` `custom_filename` sanitized + Unicode Vietnamese glyphs rendered in sandbox PDF.
  - `/sandbox/verify` enforcing per-user rate limit, passing `allow_serpapi=policy.allow_serpapi_fallback`, and gating full remediation behind paid plans.
  - Deleting a `queued` essay refunding `monthly_uploads_used`; `.docx` upload enforcing `_docx_xml_is_safe` & estimated page cap; `reanalyze` passing `bypass_report_cache=True` and charging/refunding `essay.user_id` consistently.
  - Teacher RBAC: Essay submitted to `class_id=C1` CANNOT be accessed or overridden by Teacher B (`C2`), CAN still be overridden by Teacher A (`C1`) even after student leaves `C1`, and `_compute_revision_diff` checks `can_user_access_essay` (never leaking all essays when `user_id is None`).
  - Overriding a verdict to `suspected_hallucination` NOT inflating `num_verified` in `/api/essays` or `"verified"` in `/api/teacher/classes/{id}`, AND overriding on a `resource`-only legal essay preserving non-zero CIS score!
  - Classroom CRUD & Exports: Two different teachers creating `"Graduation Thesis"`, `PATCH /api/teacher/classes/{id}`, `DELETE /api/teacher/classes/{id}` freeing teacher class quota, `DELETE /api/teacher/classes/{id}/leave`, `GET /api/teacher/classes/{id}/export.zip` returning valid ZIP with `gradebook_summary.csv` + `verdicts_detail.csv` (including `cis_score` & UTF-8 BOM) + per-essay JSON, CSV leading-space formula injection sanitized, `docx_exporter.py` stripping `\x0c` control chars without crashing, and `/api/export/report` using SQL aggregation + including `"teachers"` count.
- [ ] **Step 2 (Verify RED):** Run `.venv/bin/python -m pytest tests/unit/test_wave1_rbac_classroom_export_fixes.py -v` and confirm failures.
- [ ] **Step 3 (GREEN):** Implement all fixes across Track 4's owned files (including refreshing `job_heartbeat_at` inside `_run_pipeline_task` progress callback, backward-compatible `override_record` keys, and mapping-status logging in `AuditLog`).
- [ ] **Step 4 (Verify GREEN & Lint):** Run `.venv/bin/python -m pytest tests/unit/test_wave1_rbac_classroom_export_fixes.py tests/unit/test_teacher_role.py tests/unit/test_teacher_override_auth.py tests/unit/test_class_export.py tests/unit/test_docx_export.py tests/unit/test_pending_reviews.py -q` and `.venv/bin/python -m ruff check` on all Track 4 files.
- [ ] **Step 5 (Cross-Review):** Hand off to `@verifier-backend` and iterate until approved.

---

### Track 5 (`author-frontend-nginx` -> `verifier-fullstack`): Frontend Web (`web/src/*`), API Contracts, UX & Nginx Configs

**Owned Files (Exclusive):**
- Modify: `web/nginx.conf`
- Modify: `web/nginx.prod.conf`
- Modify: `web/src/hooks/useRole.ts`
- Modify: `web/src/router.tsx`
- Modify: `web/src/contexts/AuthContext.tsx`
- Modify: `web/src/api/client.ts`
- Modify: `web/src/components/UserFormDialog.tsx`
- Modify: `web/src/components/UpgradeModal.tsx`
- Modify: `web/src/components/CreateClassDialog.tsx`
- Modify: `web/src/components/LiveCitationSandbox.tsx`
- Modify: `web/src/components/BibliographyRemediationModal.tsx`
- Modify: `web/src/components/OverrideControls.tsx`
- Modify: `web/src/components/landing/CitraFilm.tsx`
- Modify: `web/src/pages/LandingPage.tsx` (preserve existing `.webp` edit on line 3583!)
- Modify: `web/src/pages/PricingPage.tsx`
- Modify: `web/src/pages/MyClassesPage.tsx`
- Modify: `web/src/pages/ClassDetailPage.tsx`
- Modify: `web/src/pages/PendingReviewsPage.tsx`
- Modify: `web/src/pages/ProfilePage.tsx`
- Modify: `web/src/pages/RegisterPage.tsx`
- Modify: `web/src/components/GoogleOnboardingModal.tsx`
- Modify: `web/src/pages/AuditLogPage.tsx`
- Modify: `web/src/pages/EssayPage.tsx`
- Modify: `web/src/pages/IssuesPage.tsx`
- Modify: `web/src/pages/DocumentInspectorPage.tsx`
- Modify: `web/src/pages/OrphanDetectionPage.tsx`
- Modify: `web/src/pages/LogicTracePage.tsx`
- Modify: `web/src/pages/essay/EssayActionBar.tsx`
- Modify: `web/src/pages/StripeDemoCheckoutPage.tsx`
- Modify: `web/src/pages/SystemHealthPage.tsx`
- Modify: `web/src/pages/PromoManagementPage.tsx`
- Create Test: `web/src/__tests__/wave1_2_3_remediation.test.tsx`

- [ ] **Step 1 (RED):** Write failing Vitest tests in `web/src/__tests__/wave1_2_3_remediation.test.tsx` covering:
  - `useRole` NOT granting `'view_class_history'` to Pro/Ultra `role="user"` while keeping `canBatchUpload === true`, and `/teacher/classes` rejecting `user` role.
  - `AuthContext` memoizing `refreshUser` so re-renders / user refreshes keep function identity stable (preventing SSE abort).
  - `UserFormDialog` exposing `plan_tier` selector and optional password reset in edit mode (`isEdit`).
  - `UpgradeModal` highlighting Ultra (not Pro) when current user is already on Pro.
  - `PendingReviewsPage` defaulting to `"All Classes"` (`null`) so pending items in Class #2 are visible immediately.
  - `client.ts` dispatching `citra:unauthorized` and clearing token on `401` from protected endpoints.
- [ ] **Step 2 (Verify RED):** Run `cd web && npx vitest run src/__tests__/wave1_2_3_remediation.test.tsx` and confirm failures.
- [ ] **Step 3 (GREEN):** Implement all fixes across Track 5's owned files:
  - `web/nginx.conf` & `web/nginx.prod.conf`: Add `/api/essays/[0-9]+/events` unbuffered SSE block to `nginx.conf`, raise `client_max_body_size` to `105M` in both configs, add `reset-password|activate` to `citra_auth_limit`, and preserve security headers in static & port-80 blocks.
  - Wire Class Rename/Delete, Class ZIP Export button (`api.downloadClassZipExport`), and Student Leave Class UI; open `UpgradeModal` on class limit in `CreateClassDialog.tsx`.
  - Fix `CitraFilm.tsx` fast-click variant race, `LiveCitationSandbox` progress registration, `<EssayActionBar filename={report.filename} />` prop across all 5 report tabs, `EssayPage` modal-safe `Escape` listener, `IssuesPage` candidate badge, `StripeDemoCheckoutPage` real ISO QR via `encodeQrMatrix`, `ProfilePage` Google-linked readOnly email + 72-byte password / username validation, and `LandingPage` / `PricingPage` / `BibliographyRemediationModal` accurate model & decision-support copy (`Sentence-BERT + Multilingual ONNX INT8`, `R01–R30`, `.PDF/.DOCX/.BIB/.RIS` on Basic, `'NGHI VẤN NGUỒN BỊA ĐẶT...'`).
- [ ] **Step 4 (Verify GREEN, Lint, Typecheck & Build):** Run `cd web && npm run lint && npx tsc --noEmit && npx vitest run && npm run build`.
- [ ] **Step 5 (Cross-Review):** Hand off to `@verifier-fullstack` and iterate until approved.

---

### Track 6 (`author-eval-ci-docs` -> `verifier-fullstack`): 120K Benchmark Integrity, Scripts Cleanup, CI/CD, Makefile & Docs Sync

**Owned Files (Exclusive):**
- Modify: `scripts/train_neuro_symbolic_model.py`
- Modify: `scripts/` (all remaining Python/shell scripts under `scripts/`)
- Modify: `src/integrity_checker/evaluation/baselines.py`
- Modify: `src/integrity_checker/evaluation/report.py`
- Modify: `src/integrity_checker/evaluation/performance_benchmark.py`
- Modify: `.github/workflows/ci-cd.yml`
- Modify: `Makefile`
- Modify: `pyproject.toml`
- Modify: `requirements.txt`
- Modify: `configs/config.yaml`
- Modify: `configs/config.example.yaml`
- Modify: `.env.example`
- Modify: `README.md` (preserve uncommitted `docs/` path updates!)
- Modify: `CLAUDE.md` (preserve uncommitted `docs/` path updates!)
- Modify: `docs/reports/BENCHMARK_120K_NEURO_SYMBOLIC_REPORT.md`
- Modify: `docs/reports/BAO_CAO_TIEN_DO_01_11_15_11.md`
- Modify: `web/tests/e2e/responsive.spec.ts`
- Create Test: `tests/unit/test_wave3_eval_scripts_and_configs.py`

- [ ] **Step 1 (RED):** Write failing regression tests in `tests/unit/test_wave3_eval_scripts_and_configs.py` covering:
  - `train_neuro_symbolic_model`: zero label-conditioned `np.clip` clamping in `build_split_dataset` (perturbed low-similarity `verified` or high-similarity `hallucination` items retain their genuine computed scores), normalized-title deduplication across `Train`/`Val`/`Test` (`0` overlap), and `_run_symbolic_rule_on_item` passing real `cited_title`/`cand_title`/`cited_venue`.
  - `EvaluationReport` unit coverage (`src/integrity_checker/evaluation/report.py`).
  - `scripts/sync_from_api.py` working with `SourceCandidate.external_ids.get("arxiv")` without `AttributeError`.
  - Config parity between `configs/config.yaml`, `configs/config.example.yaml`, and `RetrievalSourcesConfig`.
  - `ruff check scripts/` returning `0` errors.
- [ ] **Step 2 (Verify RED):** Run `.venv/bin/python -m pytest tests/unit/test_wave3_eval_scripts_and_configs.py -v` and confirm failures.
- [ ] **Step 3 (GREEN):** Implement all fixes across Track 6's owned files:
  - Remove oracle `np.clip` target leakage in `scripts/train_neuro_symbolic_model.py`, deduplicate normalized titles pre-split, pass real strings to `SymbolicRules`, and fix `crossref_matched` synthesis.
  - Fix all `66` `ruff` errors across `scripts/`, fix `import_openalex.py` (`page`/cursor + inverted-index abstract + FTS sync), `sys.path` (`REPO_ROOT / "src"`), `demo_content_alignment_e2e.py`, `docker-start.sh` (`docker compose` + `/api/health`), `grobid_docker_setup.sh`, and `run_ground_truth_evaluation.py`.
  - Clarify queue/SQLite-WAL burst vs full neural pipeline throughput in `performance_benchmark.py` and `docs/reports/BAO_CAO_TIEN_DO_01_11_15_11.md`.
  - Update `.github/workflows/ci-cd.yml` (`npm run lint`, `ruff check src/ tests/ scripts/`, `pytest tests/ -q`, PR API `Dockerfile` build), `Makefile` (`ruff` instead of uninstalled `black`/`isort`, fix `test-integration`), `pyproject.toml` & `requirements.txt` (explicit `numpy`, `scipy`, `scikit-learn`, `[project.optional-dependencies] dev`), `.env.example` & `configs/*.yaml`, `web/tests/e2e/responsive.spec.ts` API paths, and synchronize `README.md` & `CLAUDE.md` to `v3.76.0`.
- [ ] **Step 4 (Verify GREEN & Lint):** Run `.venv/bin/python -m ruff check src/ tests/ scripts/` and `.venv/bin/python -m pytest tests/unit/test_wave3_eval_scripts_and_configs.py tests/unit/test_baselines.py tests/unit/test_pipeline_performance_benchmark.py -q`.
- [ ] **Step 5 (Cross-Review):** Hand off to `@verifier-fullstack` and iterate until approved.

---

## Final Whole-Project Integration & Cross-Verification Gate

Once all 6 Author tracks receive `[approved]` from their paired Cross-Review Verifiers (`verifier-core`, `verifier-backend`, `verifier-fullstack`):
- [ ] Run full Backend Ruff check across the entire repository: `.venv/bin/python -m ruff check src/ tests/ scripts/` -> `0` errors.
- [ ] Run full Backend Pytest suite: `.venv/bin/python -m pytest tests/ -q` -> `100% PASS, 0 failed`.
- [ ] Run full Frontend ESLint + TypeScript + Vitest + Production Build: `cd web && npm run lint && npx tsc --noEmit && npx vitest run && npm run build` -> `100% PASS, 0 errors`.
