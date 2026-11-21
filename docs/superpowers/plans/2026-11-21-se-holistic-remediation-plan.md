# CITRA (`SourceLogic`) Holistic Software Engineering Audit & Zero-Defect Remediation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Follow strict TDD (`test-driven-development`: write failing regression test -> verify RED -> implement minimal clean fix -> verify GREEN) and the **Multi-Agent Triad Protocol** (`Author` -> `Two-Axis Spec & Standards Reviewer` -> `Adversarial Critic / Agent Phản Biện`) before marking any track complete. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate 100% of the **91 verified Software Engineering defects** (`17 CRITICAL`, `27 HIGH`, `32 MEDIUM`, `15 LOW`), all **42 backend `ResourceWarning`s**, all **mypy static type errors**, and all **frontend test warnings** across Core AI/NLP, Distributed Retrieval, FastAPI/OWASP/Billing/SQLAlchemy, React/TypeScript/WCAG/i18n/SEO, QA/Packaging/Scripts, and Docker/Nginx/CI-CD/Thesis Documentation — reaching verified zero-defect convergence.

**Architecture:** Six **mathematically file-disjoint Author tracks** (`Track 1`–`Track 6`), all running on **Gemini 4 Carbon (High)**, execute TDD concurrently against upfront-pinned cross-track contracts on branch `feat/se-holistic-remediation`. Every track then passes an independent **Two-Axis Reviewer (`Standards` + `Spec`)** AND an **Adversarial Principal SE Critic (`Agent Phản Biện`)** in iterative fix loops until `0` defects remain, followed by a **Holistic Whole-System Convergence Gate**.

**Tech Stack:** Python 3.11–3.14 (`FastAPI`, `SQLAlchemy 2.0`, `PyMuPDF`, `defusedxml`, `httpx`, `Sentence-BERT` / `ONNX Runtime`, `ReportLab`, `python-docx`, `Ruff`, `Mypy`, `Pytest`), React 18 + TypeScript 5 + Vite + Tailwind CSS v3.4 (`TanStack Query`, `Vitest`, `Playwright`, `ESLint`), Docker BuildKit, Nginx 1.27, GitHub Actions, LaTeX (`XeLaTeX`).

**Spec:** `docs/superpowers/specs/2026-11-21-se-holistic-audit-design.md`

---

## Global Constraints

1. **Zero Git Index Collisions Inside Worker Turns:** Workers (`Author`, `Reviewer`, `Critic`) MUST **NEVER** run `git commit`, `git checkout`, `git reset`, `git stash`, `git clean`, or `git rm`. Only the Coordinator commits verified waves.
2. **Strict Mathematical File Disjointness:** Each Author worker may ONLY create or modify files listed in its Track's **Exclusive Owned Files** block. Touching any file outside your block is a hard violation.
3. **Decision-Support & Scientific Benchmark Invariants:**
   - Never deterministically accuse an author of cheating/misconduct in EN or VI copy or rule reasoning.
   - Preserve 100% prediction parity on `BaselineRunner("proposed")` vs `SymbolicRules` (`tests/unit/test_wave3_eval_scripts_and_configs.py`, `tests/unit/test_four_pillar_bottleneck_optimization.py`).
4. **Static Guard-Suite Preservation:**
   - Keep `src/integrity_checker/extraction/regex_patterns.py` importable with its deprecated compatibility surface (`tests/unit/test_lint_clean.py`).
   - Keep `web/src/api/client.ts` free of removed legacy methods (`downloadReport`, `getVerdicts`, `listAllEssays`, `getCacheStats`, `getMe`, `health` per `web/src/deadCode.test.ts`).
   - Keep all Tailwind classes v3.4-compliant and every compiled JS chunk `< 500 kB` (`web/src/__tests__/tailwindV3AndBundleHygiene.test.ts`; note `EssayPage` chunk is currently `251.00 kB`, so put shared URL helpers in `web/src/lib/utils.ts`).
   - Keep both HTTP (`:80`) and HTTPS (`:443`) unbuffered SSE location blocks prior to `location /api/` in `web/nginx.prod.conf` (`tests/unit/test_essay_sse_events.py:646-674`).
   - Keep `Makefile` free of substring `"-m integration"` (`tests/unit/test_wave3_eval_scripts_and_configs.py:652`).
5. **Mandatory Triad Gate Per Track:**
   - **Stage A (`author-*`):** Write failing regression tests -> confirm RED -> implement clean fix + mypy type safety -> confirm targeted tests & linter GREEN (`0` `ResourceWarning`s under `-W default`).
   - **Stage B (`reviewer-*`):** Independent Two-Axis (`Standards` + `Spec`) audit of every hunk in the track's owned files.
   - **Stage C (`critic-*` — *Agent Phản Biện*):** Hostile Principal SE / Security / UX Devil's Advocate attempts to bypass guards, trigger races/ReDoS/XSS/regressions, and verify completeness.
   - **Stage D (Iterative Loop):** Any Critical, Important, or Polish defect loops back to `author-*` -> re-verified by `reviewer-*` + `critic-*` until unanimous `APPROVED (ZERO DEFECTS)`.

---

## Review Focus (Top Cross-Cutting Failure Modes Pinned by Tests)

1. **Adversarial Multi-Author ReDoS & Footnote Zip-Bomb Manuscripts (`CORE-01`, `CORE-02`, `API-06`):** A 30-author IEEE/Nature reference without `(YYYY)` must parse in `< 50 ms` (never hanging workers), and a `< 1 MB` `.docx` with spoofed `info.file_size = 1024` over a `> 60 MB` compressed `word/footnotes.xml` or `word/document.xml` stream must be rejected safely via chunked stream counting before `zf.read()` runs.
2. **Spoofed `X-Forwarded-For` + 4,096-Key Username Spray Against Auth & Sandbox (`OPS-01`, `API-02`):** External attacker sending rotating `X-Forwarded-For: 8.8.8.8` through Nginx to Uvicorn, or spraying 5,000 random usernames from one IP to FIFO-evict `ip:admin`, must still be blocked by trusted `X-Real-IP` + dedicated per-IP `_login_ip_rate_limiter` + equalized dummy-bcrypt timing.
3. **DOI Redirect SSRF & Transient API Outage Cache Poisoning (`RET-01`, `RET-02`):** Citing a registered DOI whose `doi.org/{doi}` `302` target resolves to `127.0.0.1` / `169.254.169.254` must be blocked per redirect hop by `SSRFSafeAsyncNetworkBackend`, and bare-DOI `503`/timeout outages must set `api_exhausted=True` (`UNRESOLVED`) without poisoning SQLite `citation_cache` for 24h.
4. **Stripe Amount/Promo Tampering & Retried VNPay IPN Delivery (`API-01`, `QA-02`):** Mutating `/checkout-session/{id}/promo` after creating a `stripe_live`/`stripe_test` session must fail `400`, `/verify-session` must verify Stripe `amount_total` & `currency`, and a paid VNPay IPN arriving for a retried order (whose first attempt was `canceled`/`failed`) must mint a fresh `vnp_TxnRef` on retry and upgrade the user cleanly.
5. **Cross-Account Session/Toast Leakage & `javascript:` Citation Link XSS (`FE-01`, `FE-02`, `FE-05`):** Clicking a cited `javascript:alert(1)` URL/archive link on `/verify/share/:token` or `/teacher/reviews` must render non-navigable/safe, and logging out (or hitting `401` / `403 Account is deactivated`) must wipe `QueryClient`, active `ToastProvider` toasts, and `sessionStorage['citra_notification_history_v1']`.

---

## Disjoint Track Breakdown

### Track 1 (`author-core-ml`): Core Extraction, Linking, Matching, Neuro-Symbolic Engine, Pipeline & Evaluation
**Covers:** `CORE-01`..`CORE-15`, `QA-08` (8 citation style suites), `QA-09` (mypy clean in Track 1 packages), `QA-14` (`matching/consensus.py` & `citation_extractor.py` deprecation cleanup).

**Exclusive Owned Files:**
- Modify: `src/integrity_checker/extraction/reference_parser.py`
- Modify: `src/integrity_checker/extraction/patterns/nature.py`
- Modify: `src/integrity_checker/extraction/patterns/utils.py`
- Modify (mypy/style fixes if needed): `src/integrity_checker/extraction/patterns/{apa,ieee,vancouver,acm,acs,ama,chicago,cse,harvard,mla,base}.py`
- Modify: `src/integrity_checker/extraction/docx_parser.py`
- Modify: `src/integrity_checker/extraction/grobid_parser.py`
- Modify: `src/integrity_checker/extraction/grobid_service.py`
- Modify: `src/integrity_checker/extraction/citation_extractor.py`
- Modify: `src/integrity_checker/extraction/section_segmenter.py`
- Modify: `src/integrity_checker/extraction/vn_encoding.py`
- Modify: `src/integrity_checker/linking/citation_linker.py`
- Modify: `src/integrity_checker/linking/duplicate_detector.py`
- Modify: `src/integrity_checker/matching/semantic.py`
- Modify: `src/integrity_checker/matching/features.py`
- Modify: `src/integrity_checker/matching/author_parser.py`
- Modify: `src/integrity_checker/matching/vn_en_academic_bridge.py`
- Modify: `src/integrity_checker/matching/__init__.py`
- Delete (if confirmed 0 callers) or clean: `src/integrity_checker/matching/consensus.py`
- Modify: `src/integrity_checker/logic/neuro_symbolic_checker.py`
- Modify: `src/integrity_checker/logic/vn_legal_verifier.py`
- Modify: `src/integrity_checker/logic/completeness.py`
- Modify: `src/integrity_checker/logic/rules.py`
- Modify: `src/integrity_checker/pipeline/integrity_pipeline.py`
- Modify: `src/integrity_checker/models/citation.py`
- Modify: `src/integrity_checker/evaluation/metrics.py`
- Modify: `src/integrity_checker/evaluation/performance_benchmark.py`
- Create Test: `tests/unit/test_se_audit_core_extraction_logic.py`

*(NOTE: Do NOT delete or break `src/integrity_checker/extraction/regex_patterns.py` — `test_lint_clean.py` pins its compatibility surface; do NOT break `_VN_DIACRITIC_RE` or `_VN_EN_ACADEMIC_BRIDGE` re-exports in `matching/semantic.py`.)*

- [x] **Step 1 (RED):** Write failing unit & regression tests in `tests/unit/test_se_audit_core_extraction_logic.py` covering:
  - `CORE-01`: `_INLINE_ENTRY_START_RE.match("Smith, J. K., " * 25 + "!")` and `NatureFormat().parse_reference_entry("1. " + "A. B. " * 25 + "Title!")` complete in `< 100 ms` + `NatureFormat` fallback title extraction works.
  - `CORE-02`: `DocxParser.parse()` rejects/caps a `.docx` with spoofed `info.file_size = 1024` over an oversized compressed `word/footnotes.xml` stream without OOM.
  - `CORE-03` & `CORE-12`: `parse_tei()` preserves preceding bibliography entries when `b1` is `"Smith, J. (2021). References Supporting Climate Action. Nature."` or `"Analyzing Primary Sources Through Digital Archives"`, and `_split_single_merged_raw_reference()` splits glued references after `"London."`, `"Oxford."`, `"Wiley."`, `"Ltd."`.
  - `CORE-04` & `CORE-05`: `NeuroSymbolicChecker.check()` does NOT whitelist `url_status="fake_domain"` web citations as `RESOURCE` (`0.95`), and `IntegrityPipeline` clones `SourceResult` per entry (`model_copy(deep=True)`) so duplicate-DOI chimeric + real entries never cross-contaminate `_selected_best`.
  - `CORE-06` & `CORE-07`: `IntegrityPipeline.run_async` offloads `_discover_implicit_body_context_for_reference` & report-cache file I/O via `asyncio.to_thread`; `GrobidServiceManager` binds `127.0.0.1:8070` (never publishing `:8071` on `0.0.0.0`), closes Docker client handles cleanly (`client.close()` to prevent socket `ResourceWarning`s!), does not mutate global `self.config.url`, and guards `GrobidStats` with `threading.Lock`.
  - `CORE-08`: `MetricsCalculator.compute()` accounts for false negatives/positives across non-4-class predictions (`resource`, `missing_reference`, `style_inconsistent`) instead of reporting `100%` Macro-F1 at `10%` accuracy.
  - `CORE-09`..`CORE-15`: Uppercase/alpha Latin+Vietnamese regex fixes (`"đồng"` is NOT uppercase surname; `"Nguyễn"` preserved in `_ET_AL_NORM_RE`), NFD Vietnamese normalization + French physics non-Vietnamese guard + foreign code (`"Bộ luật Dân sự Pháp 1804"`) exemption & `29/02/2023` calendar check in `vn_legal_verifier.py`, `2020i..z` suffix support + MLA multi-book `AMBIGUOUS_MAPPING` + `bib.mapping_status` priority + `"John Smith"` vs `"Smith, J."` `DuplicateDetector` match, UTC `"Z"` timestamp + `" ".join(raw.split())` + full `AnalysisReport.from_dict` / `_match_features_from_dict` rehydration, `rules.py:3768` & `_intent_emb_cache` cleanup, single-pass regex in `Citation.from_raw`.
  - `QA-08`: Direct unit tests for all 8 remaining citation style modules (`ACMFormat`, `ACSFormat`, `AMAFormat`, `ChicagoFormat`, `CSEFormat`, `HarvardFormat`, `MLAFormat`, `NatureFormat`).
- [x] **Step 2 (Verify RED):** Run `.venv/bin/python -m pytest tests/unit/test_se_audit_core_extraction_logic.py -v` and confirm failures.
- [x] **Step 3 (GREEN + Mypy Clean):** Implement all fixes across Track 1 files and resolve mypy type errors in Track 1 files (`models/citation.py`, `patterns/*.py`, `reference_parser.py`, `vn_encoding.py`, `section_segmenter.py`, `author_parser.py`, `duplicate_detector.py`, `vn_legal_verifier.py`, `evaluation/performance_benchmark.py`).
- [x] **Step 4 (Verify GREEN, Benchmark Parity & Lint):** Run `.venv/bin/python -m ruff check` + `.venv/bin/python -m mypy --python-version 3.14 --no-implicit-optional --check-untyped-defs` on Track 1 files + `.venv/bin/python -m pytest tests/unit/test_se_audit_core_extraction_logic.py tests/unit/test_lint_clean.py tests/unit/test_wave1_linking_and_logic_hardening.py tests/unit/test_four_pillar_bottleneck_optimization.py tests/unit/test_wave3_eval_scripts_and_configs.py -W default -q`.
- [x] **Step 5 (Triad Review & Critic):** Pass `@reviewer-core` and `@critic-core` with `0` open issues.

---

### Track 2 (`author-retrieval`): Distributed Multi-Source Retrieval, SSRF/DoS Defense, Async Lifecycle, Local FTS5 DB & Worker
**Covers:** `RET-01`..`RET-15`, `QA-09` (mypy clean in Track 2 packages), socket/SQLite `ResourceWarning` elimination in retrieval/`local_db`/`worker`.

**Exclusive Owned Files:**
- Modify: `src/integrity_checker/retrieval/http_pool.py`
- Modify: `src/integrity_checker/retrieval/doi_ra_client.py`
- Modify: `src/integrity_checker/retrieval/dblp_client.py`
- Modify: `src/integrity_checker/retrieval/crossref_client.py`
- Modify: `src/integrity_checker/retrieval/openalex_client.py`
- Modify: `src/integrity_checker/retrieval/europepmc_client.py`
- Modify: `src/integrity_checker/retrieval/arxiv_client.py`
- Modify: `src/integrity_checker/retrieval/datacite_client.py`
- Modify: `src/integrity_checker/retrieval/doaj_client.py`
- Modify: `src/integrity_checker/retrieval/ncbi_biorxiv_client.py`
- Modify: `src/integrity_checker/retrieval/huggingface_client.py`
- Modify: `src/integrity_checker/retrieval/tech_standard_client.py`
- Modify: `src/integrity_checker/retrieval/serpapi_client.py`
- Modify: `src/integrity_checker/retrieval/link_validator.py`
- Modify: `src/integrity_checker/retrieval/html_meta_verifier.py`
- Modify: `src/integrity_checker/retrieval/circuit_breaker.py`
- Modify: `src/integrity_checker/retrieval/rate_limiter.py`
- Modify: `src/integrity_checker/retrieval/persistent_cache.py`
- Modify: `src/integrity_checker/retrieval/cache.py`
- Modify: `src/integrity_checker/retrieval/retrieval_orchestrator.py`
- Modify: `src/integrity_checker/database/local_db.py`
- Modify: `src/integrity_checker/worker.py`
- Modify: `src/integrity_checker/api/job_recovery.py`
- Create Test: `tests/unit/test_se_audit_retrieval_and_worker.py`

- [x] **Step 1 (RED):** Write failing regression tests in `tests/unit/test_se_audit_retrieval_and_worker.py` covering:
  - `RET-01`: `DoiRaClient._fetch_csl_json` blocks `302` redirects to private/loopback IPs (`127.0.0.1`, `169.254.169.254`) via manual hop validation + `SSRFSafeAsyncNetworkBackend` and caps streamed CSL body at `262,144` bytes; `DBLPClient._execute_dblp_get` rejects off-origin `Refresh:` URLs; `http_pool.py` sets `trust_env=False`.
  - `RET-02`: Bare-DOI / bare-arXiv `503` or timeout preserves `5xx`/timeout telemetry instead of `"no title for search"`, sets `SourceResult.api_exhausted = True`, and is NOT cached for 24h (`CLEAN_MISS_TTL_SECONDS`) in `PersistentVerificationCache`.
  - `RET-03` & `RET-09`: `worker.py:run_worker_loop` periodically runs `recover_orphaned_essay_jobs` inside `while True:`, wraps sync DB operations in `asyncio.to_thread`, and closes loop HTTP clients on exit; `job_recovery.py` bounds `_drain()` concurrency without freezing a running event loop; `PersistentVerificationCache` guards `hits`/`misses` with a lock and throttles `last_hit_at` writes.
  - `RET-04`: `OpenAlexClient` URL-encodes `#`/`?` in DOIs and normalizes `http(s)://(dx.)doi.org/` + `2020a` years; `RetrievalOrchestrator` ACL enrichment validates `acl_id` strictly and stream-caps `262,144` bytes; `TechStandardClient` & `HuggingFaceClient` reject `.`/`..` repo segments.
  - `RET-05`: `DBLPClient` uses `WeakKeyDictionary` per event loop (zero `RuntimeError` when loop `id()` is reused across threads) and never mutates shared `client.cookies`.
  - `RET-06`: `HuggingFaceClient` never echoes unverified student `citation.title` verbatim; `TechStandardClient` only uses actual release years (never echoing non-release years).
  - `RET-07` & `RET-12`: `LocalDatabase.add_paper` handles mixed-case existing DOIs (`10.48550/arXiv...` vs `10.48550/arxiv...`) without `UNIQUE(arxiv_id)` `IntegrityError`; `add_papers_bulk` avoids nested-connection self-locks; `LocalDatabase.update_paper_abstract()` bumps mutation version and includes `-wal` `st_mtime_ns` in `_cache_key`; `_enrich_missing_abstract` enforces non-conflicting DOIs + author overlap and respects rate limiters.
  - `RET-08`, `RET-10`, `RET-11`, `RET-13`, `RET-14`, `RET-15`: `RateLimiter.report_success()` does not erase active `429` backoff, and titles containing `"429"` do not trip rate limiters; `is_retracted` preserved on `local_db` hits + `DataCite`/`DoiRa`/`bioRxiv`/`Crossref` retraction markers; `CircuitBreaker` `HALF_OPEN` reports positive remaining cooldown & private client breakers align with `reset()`; `Serper` HTTP 400 does not trip global quota + `SerpApi` uses `_select_best_scholar_item` & TTL negative cache + `npm` queries `/latest` when year is absent; `LinkValidator` checks DNS on non-standard ports & closes clients cleanly (`0` `ResourceWarning`s); `local_db` escapes `%`/`_` in `LIKE` & `DiskCache` appends SHA-256 digest.
- [x] **Step 2 (Verify RED):** Run `.venv/bin/python -m pytest tests/unit/test_se_audit_retrieval_and_worker.py -v` and confirm failures.
- [x] **Step 3 (GREEN + Mypy Clean):** Implement all Track 2 fixes cleanly and resolve mypy errors across Track 2 files.
- [x] **Step 4 (Verify GREEN & Lint):** Run `.venv/bin/python -m ruff check` + `.venv/bin/python -m mypy --python-version 3.14 --no-implicit-optional --check-untyped-defs` on Track 2 files + `.venv/bin/python -m pytest tests/unit/test_se_audit_retrieval_and_worker.py tests/unit/test_wave1_core_retrieval_hardening.py tests/unit/test_retrieval_orchestrator.py tests/unit/test_retrieval_clients.py tests/unit/test_nine_free_apis.py -W default -q`.
- [x] **Step 5 (Triad Review & Critic):** Pass `@reviewer-retrieval` and `@critic-retrieval` with `0` open issues.

---

### Track 3 (`author-backend-sec`): FastAPI OWASP Security, Auth, Billing, SQLAlchemy/Migrations, Exporters & Observability
**Covers:** `API-01`..`API-18`, `OPS-06` (`main.py` multi-worker inline warning), `OPS-09` (`/api/health` DB `SELECT 1` probe, `X-Request-ID` middleware, `logging.py` `colorize=not is_prod`), `QA-02` (Stripe direct `httpx` REST checkout + closed-fail in prod), `QA-08` (tests for untested routes & `logging.py`), `QA-09` (Optional `Request | None = None` annotations & mypy clean in Track 3 files).

**Exclusive Owned Files:**
- Modify: `src/integrity_checker/api/main.py`
- Modify: `src/integrity_checker/api/deps.py`
- Modify: `src/integrity_checker/api/progress.py`
- Modify: `src/integrity_checker/api/routes/auth.py`
- Modify: `src/integrity_checker/api/routes/users.py`
- Modify: `src/integrity_checker/api/routes/billing.py`
- Modify: `src/integrity_checker/api/routes/essays.py`
- Modify: `src/integrity_checker/api/routes/report.py`
- Modify: `src/integrity_checker/api/routes/verdicts.py`
- Modify: `src/integrity_checker/api/routes/teacher.py`
- Modify: `src/integrity_checker/api/routes/health.py`
- Modify (if needed for mypy): `src/integrity_checker/api/routes/{audit,system,cache,export}.py`
- Modify: `src/integrity_checker/billing/vnpay.py`
- Modify: `src/integrity_checker/billing/plans.py`
- Modify: `src/integrity_checker/db/models.py`
- Modify: `src/integrity_checker/db/migrations.py`
- Modify: `src/integrity_checker/db/session.py`
- Modify: `src/integrity_checker/db/repository.py`
- Modify: `src/integrity_checker/db/sqlite_tuning.py`
- Modify: `src/integrity_checker/export/docx_exporter.py`
- Modify: `src/integrity_checker/export/bibliography_formatter.py`
- Modify: `src/integrity_checker/config.py`
- Modify: `src/integrity_checker/logging.py`
- Modify: `tests/unit/test_db_migrations.py` (`LATEST_SCHEMA_VERSION == "0013"`)
- Create Test: `tests/unit/test_se_audit_backend_security_and_routes.py`

- [x] **Step 1 (RED):** Write failing regression tests in `tests/unit/test_se_audit_backend_security_and_routes.py` covering:
  - `API-01` & `QA-02`: Stripe direct `httpx` checkout creation (`sk_test_*` / `sk_live_*`), closed-fail `502` when `sk_live_*` fails in `production` (and `403`/`400` if `force_demo=True` in `production` when `sk_live_*` is set, while preserving pending transaction creation for VNPay when `STRIPE_SECRET_KEY` is unset!), `_verify_stripe_session_paid` verifying `amount_total` & `currency`, blocking `/checkout-session/{id}/promo` on `stripe_live`/`stripe_test` sessions, VNPay retry minting fresh `vnp_txn_ref` & resetting `status="pending"`, paid VNPay IPN upgrading previously `canceled`/`failed` retried orders, and skipping `_seed_default_promo_codes` (`VIP100`) in `production`.
  - `API-02`: `LoginRequest` rejecting `>255`/`>256` char payloads (`422`), `_verify_password` returning `False` cleanly on `>72` UTF-8 bytes, per-IP `_login_ip_rate_limiter` blocking 35-username horizontal password spraying & defeating 4,096-key FIFO eviction, and dummy `bcrypt.checkpw` running on unknown usernames.
  - `API-03`: `_get_google_client_config()` returning `("", "")` (`503 GOOGLE_NOT_CONFIGURED`) in `production` when `GOOGLE_CLIENT_ID` is unset or placeholder.
  - `API-04`: `Session.token` `String(512)` + Migration `0013` (`LATEST_SCHEMA_VERSION == "0013"`) + `_downgrade_0012` PostgreSQL constraint-before-index order.
  - `API-05`: Rate-limiting + cooldown on `PATCH /api/users/me` email changes, and `google_login` detaching unverified squatted `email` instead of merging into a local account that already owns essays/memberships.
  - `API-06`, `API-07`, `API-08`, `API-09`, `API-10`: `_docx_xml_is_safe()` stream-counting actual decompressed bytes across all ZIP entries (defeating spoofed `info.file_size` headers); `/sandbox/generate-pdf` rate-limited + input-capped + page/byte-capped + offloaded via `asyncio.to_thread`; `/sandbox/verify`, `/sandbox/public-verify`, `upload_essay`, `reanalyze_essay` offloading sync CPU/DB work; `_generate_pdf_bytes` clamping oversized `cit_display` & stripping XML-illegal control chars (zero ReportLab `LayoutError` on 5,000-char citation!); bounded `_sandbox_verify_rate_buckets` (keyed by `user.id`) & `ProgressTracker` `MAX_TRACKED_STATES` eviction; in-process disk-I/O single retry directly inside `_run_pipeline_task` without stranding SSE clients or burning upload quota.
  - `API-11`..`API-18` & `OPS-06`/`OPS-09`/`QA-08`: Batched class essay counts & pre-filtered `_compute_revision_diff` + `LOWER()` user indexes; `%%`/`__` wildcard escape in `search_students_for_teacher()`; committed expired-session delete + `db.refresh(user)` + expired `Session`/`AuthToken` pruning; sanitized `502`/`503` billing messages + stripped `_progress_snapshot` in exported/shared `style_profile`; `delete_user` cancelling admission waiters + admin username validation + `<= 25` API key cap + aligned `export-healed-docx` gate; FastAPI `lifespan` engine disposal, `Permissions-Policy` & `Cross-Origin-Resource-Policy` headers, `X-Request-ID` response/log header, `/api/health` SQLite `SELECT 1` probe, `logging.py` `enqueue=True` & `colorize=not is_prod`, BibTeX `{`/`}`/`%` sanitization, and route tests for all previously untested endpoints (`/auth/logout`, `/billing/subscription`, `/billing/promo/validate`, `/essays/sandbox/acl-sample`, `/health/grobid*`, `/export-healed-docx`, `/regenerate-code`).
- [x] **Step 2 (Verify RED):** Run `.venv/bin/python -m pytest tests/unit/test_se_audit_backend_security_and_routes.py -v` and confirm failures.
- [x] **Step 3 (GREEN + Mypy Clean):** Implement all Track 3 fixes cleanly (replacing `= None # type: ignore` with proper `| None = None` types and resolving all mypy errors in Track 3 files).
- [x] **Step 4 (Verify GREEN & Lint):** Run `.venv/bin/python -m ruff check` + `.venv/bin/python -m mypy --python-version 3.14 --no-implicit-optional --check-untyped-defs` on Track 3 files + `.venv/bin/python -m pytest tests/unit/test_se_audit_backend_security_and_routes.py tests/unit/test_db_migrations.py tests/unit/test_wave1_auth_billing_db_security.py tests/unit/test_wave1_rbac_classroom_export_fixes.py tests/test_public_guest_sandbox.py -W default -q`.
- [x] **Step 5 (Triad Review & Critic):** Pass `@reviewer-backend` and `@critic-backend` with `0` open issues.

---

### Track 4 (`author-frontend-ux`): Frontend Security, State Isolation, WCAG 2.2 AA, i18n EN/VI, SEO, E2E Hygiene & UX Polish
**Covers:** `FE-01`..`FE-15`, `QA-10` (`playwright.config.ts` `testIgnore`, `tsconfig.e2e.json`, `waitForTimeout` cleanup), `QA-11` (`ErrorBoundary` & component unit tests, `localStorage.clear()` in `test-setup.ts`), React Router v7 future flags & Vitest `act(...)` warning cleanup.

**Exclusive Owned Files:**
- Modify: `web/src/lib/utils.ts` (add `toSafeExternalHref`, `toSafeDoiHref`, `validatePasswordClient`)
- Modify: `web/src/api/client.ts` (fix `UploadResponse.summary`, `reanalyzeEssay`, `403` deactivated handling, add `downloadClassCsvFile` — do NOT add forbidden names in `deadCode.test.ts`!)
- Modify: `web/src/contexts/{AuthContext,ToastContext,ThemeContext,VerificationProgressContext}.tsx`
- Modify: `web/src/hooks/{useEssayReport,useOrphanReport,useEssays,useEssayStream}.ts`
- Modify: `web/src/router.tsx` (`PUBLIC_INDEXABLE_PATHS`, localized `document.title` without double subscription, React Router `future: { v7_startTransition: true, v7_relativeSplatPath: true }`)
- Modify: `web/src/main.tsx`
- Modify: `web/src/pages/{SharedReportPage,PendingReviewsPage,EssayPage,StripeDemoCheckoutPage,ClassDetailPage,MyClassesPage,DocumentInspectorPage,OrphanDetectionPage,HistoryPage,BatchUploadPage,UploadPage,ProcessingPage,IssuesPage,PromoManagementPage,AccountManagementPage,AuditLogPage,ProfilePage,ResetPasswordPage,RegisterPage}.tsx`
- Modify: `web/src/pages/essay/EssayHeader.tsx`
- Modify: `web/src/components/{CreateClassDialog,AddStudentDialog,OverrideControls,HelpModal,AppLayout,ErrorBoundary,ConfirmationModal,UserFormDialog,GoogleOnboardingModal}.tsx`
- Modify: `web/src/components/CitationGraph/EvidenceGraphNode.tsx`
- Modify: `web/src/components/ui/motion-primitives.tsx`
- Modify: `web/src/i18n/locales/{en,vi}.json`
- Modify: `web/index.html`, `web/public/sitemap.xml`, `web/public/manifest.webmanifest`
- Modify: `web/src/test-setup.ts`, `web/src/test-utils.tsx`
- Modify (fix `act(...)` / Router v7 warnings if needed): `web/src/pages/ProcessingPage.test.tsx`, `web/src/pages/BatchUploadPage.test.tsx`
- Modify: `web/playwright.config.ts`, `web/tsconfig.json`, `web/tests/e2e/{ui,responsive,dashboard,dark-mode,background-progress-persistence,error-boundary}.spec.ts`
- Create: `web/tsconfig.e2e.json`
- Create Test: `web/src/__tests__/seHolisticAuditRemediation.test.tsx`

- [x] **Step 1 (RED):** Write failing Vitest tests in `web/src/__tests__/seHolisticAuditRemediation.test.tsx` covering:
  - `FE-01`: `toSafeExternalHref` & `toSafeDoiHref` blocking `javascript:`, `data:`, `vbscript:` schemes across `SharedReportPage`, `PendingReviewsPage`, `EssayPage`, `StripeDemoCheckoutPage`.
  - `FE-02` & `FE-05`: `ToastProvider` wiping floating toasts & `sessionStorage['citra_notification_history_v1']` on `logout()`, account switch, `citra:unauthorized`, and `403 Account is deactivated`; `ClassDetailPage` using `api.downloadClassCsvFile`.
  - `FE-03`: `syncRobotsMeta` allowing indexation on `/`, `/pricing`, `/privacy`, `/terms` and matching `web/public/sitemap.xml`.
  - `FE-04`: `useEssayReport` clearing `terminalErrorRef` on explicit `refetch()` / `essayId` change, and `useDeleteEssay` purging `['essay-report', id]` / `['orphan-report', id]` & invalidating `['dashboard-stats']`.
  - `FE-06`, `FE-07`, `FE-08`: All 7 custom modals trapping focus & closing on `Escape` via `useModalA11y`; `HistoryPage` Delete button not nested inside `<a>`; `EvidenceGraphNode` keyboard `Enter`/`Space` + `aria-expanded`; `aria-label` on all 17 icon-only buttons & `htmlFor`/`id` form wiring.
  - `FE-09`..`FE-14` & `QA-11`: `validatePasswordClient` enforcing `6..128` chars + non-whitespace + `<= 72` UTF-8 bytes; dynamic month-aware `isValidExpiry`; Vietnamese localization on `IssuesPage`, `ErrorBoundary` (including throwing-child render & reset test!), `ConfirmationModal`, and `document.title`; student parser-pill gating on `HistoryPage` & `.PDF, .DOCX, .BIB, .RIS` error copy; `375px` mobile stacked cards on `PromoManagementPage`; Solva `theme-color` & `<MotionConfig reducedMotion="user">`.
- [x] **Step 2 (Verify RED):** Run `cd web && npx vitest run src/__tests__/seHolisticAuditRemediation.test.tsx` and confirm failures.
- [x] **Step 3 (GREEN):** Implement all Track 4 fixes (keeping `en.json` & `vi.json` in 100% key parity, strictly Tailwind v3.4 tokens, and keeping `EssayPage` compiled chunk `< 500 kB`). Also add `web/tsconfig.e2e.json`, configure `testIgnore: ['**/prod-live-verification.spec.ts']` (with optional `prod-smoke` project) in `web/playwright.config.ts`, and replace flaky `waitForTimeout`s in E2E specs with web-first assertions.
- [x] **Step 4 (Verify GREEN, Bundle & E2E Typecheck):** Run `cd web && npm run lint && npx tsc --noEmit && npx tsc -p tsconfig.e2e.json --noEmit && npx vitest run && npm run build`.
- [x] **Step 5 (Triad Review & Critic):** Pass `@reviewer-frontend` and `@critic-frontend` with `0` open issues.

---

### Track 5 (`author-qa-scripts`): Test Determinism, Zero-ResourceWarning Teardown, Packaging Parity, Mypy Config & Scripts
**Covers:** `QA-01`..`QA-07`, `QA-09` (`[tool.mypy]` config), `QA-12`, `QA-13`, and eliminating all remaining pytest `ResourceWarning`s.

**Exclusive Owned Files:**
- Modify: `pyproject.toml`
- Modify: `requirements.txt`
- Modify: `requirements-dev.txt`
- Modify: `web/package-lock.json` (sync root `version` & `packages[""].version` to `3.89.5`)
- Modify: `tests/conftest.py`
- Modify: `tests/unit/test_serpapi_client.py`
- Create: `tests/integration/test_serpapi_live.py`
- Modify: `tests/integration/test_grobid_integration.py`
- Modify: `tests/unit/test_system_health.py`
- Modify: `tests/unit/test_teacher_role.py`
- Modify: `tests/unit/test_sse_stats_consensus_v370.py`
- Modify: `tests/unit/test_url_resource_and_wiring_v369.py`
- Modify: `scripts/collect_dataset/collect_tdtu_idiscovery.py`
- Modify: `scripts/collect_dataset/collect_200_open_theses.py`
- Modify: `scripts/collect_dataset/collect_style_corpora.py`
- Modify: `scripts/test_acl_retrieval_accuracy.py`
- Modify: `scripts/populate_venues.py`
- Modify: `scripts/import_s2orc.py`
- Modify: `scripts/import_openalex.py`
- Modify: `scripts/backfill_citation_confidence.py`
- Modify: `scripts/build_local_db.py`
- Modify: `scripts/sync_from_api.py`
- Modify: `scripts/bump_version.py`
- Create Test: `tests/unit/test_se_audit_qa_scripts_and_packaging.py`

- [x] **Step 1 (RED):** Write failing regression tests in `tests/unit/test_se_audit_qa_scripts_and_packaging.py` covering:
  - `QA-01`: `collect_tdtu_idiscovery.py` and `collect_200_open_theses.py` contain zero `verify=False` and zero `disable_warnings` calls, defaulting to `verify=True` (with optional `--ca-bundle`).
  - `QA-02`: Dependency parity across `pyproject.toml`, `requirements.txt`, and `requirements-dev.txt` (`httpcore`, `torch` declared; dead `aiohttp`/`aiofiles`/`arxiv`/`black`/`isort` removed; `pytest`/`pytest-asyncio`/`pytest-cov` upper bounds aligned; `web/package-lock.json` version matches `web/package.json`).
  - `QA-03` & `QA-04`: Zero `@pytest.mark.integration` tests inside `tests/unit/`, `test_grobid_integration.py` performs zero HTTP calls at import/collection time and asserts `isinstance(report, AnalysisReport)`, and `tests/conftest.py` isolates `DATA_DIR`/`CACHE_DIR` to `tmp_path`, disposes SQLite engines, resets rate limiters/singletons, and strips live API keys (`SERPAPI_API_KEY`, `SERPER_API_KEY`) by default.
  - `QA-05`, `QA-06`, `QA-07`, `QA-12`: `test_acl_retrieval_accuracy.py` honors `use_external_apis=False` (`clients=[]`), increments `false_positives`, separates `partial_matches`, guards `total_cases == 0`, and seeds sampling; `populate_venues.py` uses word-boundary matching (`"Robert"` != `"BERT"`) without blanket source overwrites; `import_s2orc.py` handles `None` lines & `--categories`/`--limit`; `import_openalex.py` caps consecutive `RequestException` retries; `backfill_citation_confidence.py` preserves `orig_doi`/`orig_venue` & closes session; `bump_version.py` updates `web/package-lock.json`, validates ISO `--date`, and refuses to sweep dirty unstaged version files during `--post-commit`; `collect_style_corpora.py`, `build_local_db.py`, and `sync_from_api.py` have zero hardcoded `/Users/iannwendy` paths and non-vacuous CLI behavior.
- [x] **Step 2 (Verify RED):** Run `.venv/bin/python -m pytest tests/unit/test_se_audit_qa_scripts_and_packaging.py -v` and confirm failures.
- [x] **Step 3 (GREEN):** Implement all Track 5 fixes, configure `[tool.mypy]` in `pyproject.toml` (`no_implicit_optional = true`, `check_untyped_defs = true`, `warn_return_any = false`, `ignore_missing_imports = true`, without hardcoded `python_version = "3.11"`), and close leaked SQLite/socket handles in `conftest.py` & the 4 flagged unit test files.
- [x] **Step 4 (Verify GREEN & Zero Warnings):** Run `.venv/bin/python -m ruff check pyproject.toml tests/ scripts/` and `.venv/bin/python -m pytest tests/unit/test_se_audit_qa_scripts_and_packaging.py tests/unit/test_serpapi_client.py tests/unit/test_system_health.py tests/unit/test_teacher_role.py tests/unit/test_sse_stats_consensus_v370.py tests/unit/test_url_resource_and_wiring_v369.py tests/unit/test_wave3_eval_scripts_and_configs.py -W error::ResourceWarning -q`.
- [x] **Step 5 (Triad Review & Critic):** Pass `@reviewer-qa` and `@critic-qa` with `0` open issues.

---

### Track 6 (`author-devops-docs`): Docker/Nginx Hardening, Proxy Rate-Limit Fix, Zero-Downtime CI/CD Rollback, Configs & Docs/Thesis Parity
**Covers:** `OPS-01`, `OPS-02`, `OPS-04`, `OPS-05`, `OPS-06` (Compose/README side), `OPS-07`, `OPS-08`, `OPS-10`..`OPS-14` (`OPS-03` gitlink already committed in `f9ce032`).

**Exclusive Owned Files:**
- Modify: `Dockerfile`
- Modify: `.dockerignore`
- Modify: `web/Dockerfile`
- Modify: `web/.dockerignore`
- Modify: `docker-compose.yml`
- Modify: `docker-compose.prod.yml`
- Modify: `web/nginx.conf`
- Modify: `web/nginx.prod.conf`
- Modify: `.github/workflows/ci-cd.yml`
- Modify: `Makefile`
- Modify: `package.json`
- Modify: `.env.example`
- Modify: `configs/config.yaml`
- Modify: `configs/config.example.yaml`
- Modify: `configs/config.docker.yaml`
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `docs/architecture/{PERFORMANCE_AND_SEO_OPTIMIZATION,PREMIUM_SUBSCRIPTION_PLAN,TEACHER_SYSTEM,format_development_guide,SOURCELOGIC_CONCEPT}.md`
- Modify: `docs/reports/*.md` (convert hardcoded `file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/` URIs to repo-relative links / inline code while preserving all `test_wave3_eval_scripts_and_configs.py` assertions!)
- Modify: `FinalReport_TDTU/PhuLuc.tex`, `FinalReport_TDTU/TaiLieuThamKhao.tex`
- Modify: `FinalReport_TDTU_VN/PhuLuc.tex`, `FinalReport_TDTU_VN/TaiLieuThamKhao.tex`
- Create Test: `tests/unit/test_se_audit_devops_configs_and_docs.py`

*(CRITICAL GUARDRAILS: Keep both HTTP `:80` and HTTPS `:443` `location ~ ^/api/essays/[0-9]+/events$` and `location /api/` blocks in `web/nginx.prod.conf` per `test_essay_sse_events.py:658`; keep `Makefile` free of substring `"-m integration"` per `test_wave3_eval_scripts_and_configs.py:652`; keep all required badges/version/benchmark tokens in `README.md`, `CLAUDE.md`, `BENCHMARK_120K_NEURO_SYMBOLIC_REPORT.md`!)*

- [x] **Step 1 (RED):** Write failing static/integration verification tests in `tests/unit/test_se_audit_devops_configs_and_docs.py` asserting:
  - `OPS-01`: `docker-compose.prod.yml` does NOT contain `--forwarded-allow-ips="*"` (uses `127.0.0.1` or omits wildcard), and `web/nginx.prod.conf` + `web/nginx.conf` set `proxy_set_header X-Forwarded-For $remote_addr;` with zero `$proxy_add_x_forwarded_for` occurrences.
  - `OPS-02` & `OPS-08`: `.github/workflows/ci-cd.yml` has zero `docker rm -f`, captures `PREV_TAG` and rolls back on health failure, runs `docker image prune -f` *after* healthcheck passes, runs `mypy`, runs `tsc -p tsconfig.e2e.json --noEmit`, asserts 5-manifest SemVer parity, and rotates `SERPAPI_API_KEY` symmetrically with `SERPER_API_KEY`.
  - `OPS-04`, `OPS-05`, `OPS-06`, `OPS-07`: `Dockerfile` has no `TRANSFORMERS_CACHE`, merges `fonts-dejavu-core` into single `apt-get`, `chown`s `/app/src` to `appuser:appgroup`; `docker-compose.prod.yml` sets `no-new-privileges:true`, pins `--workers 1` for inline mode, and sets `web.depends_on.api.condition: service_started`; `.dockerignore` excludes `graphify-out/`, `FinalReport_TDTU/`, `FinalReport_TDTU_VN/`, `.superpowers/`, `tests/`, `.agents/`, `.github/`, `.githooks/`, `.playwright-mcp/`; `web/.dockerignore` excludes `tests/`, `*.md`, `playwright.config*.ts`, `vitest.config.ts`; `web/nginx.prod.conf` includes `Content-Security-Policy` on static asset blocks (`always`) and `X-Request-ID` propagation, and `web/nginx.conf` includes CSP + auth `limit_req`.
  - `OPS-10`..`OPS-14`: `.env.example` drops dead `*_BASE_URL` vars and documents active runtime vars; `docker-compose.yml` sets `APP_ENV=${APP_ENV:-development}`; `Makefile` installs `[dev,onnx]` + configures `.githooks` + adds `typecheck` target (without substring `"-m integration"`); root `package.json` sets `"license": "MIT"` & `"private": true` without `"main": "index.js"`; `README.md` fixes `citra.io.vn/docs` & prod demo-account guidance; `docs/architecture/*` & `docs/reports/*` contain **zero** `/Users/iannwendy/` hardcoded URIs; `FinalReport_TDTU/PhuLuc.tex` & `FinalReport_TDTU_VN/PhuLuc.tex` inline `.env.example` without fragile `../.env.example` parent traversal, and `FinalReport_TDTU_VN/TaiLieuThamKhao.tex` localizes English `"Accessed"` strings.
- [x] **Step 2 (Verify RED):** Run `.venv/bin/python -m pytest tests/unit/test_se_audit_devops_configs_and_docs.py -v` and confirm failures.
- [x] **Step 3 (GREEN):** Implement all Track 6 fixes cleanly across containers, Nginx, Compose, CI/CD, configs, docs, and LaTeX appendices.
- [x] **Step 4 (Verify GREEN & Guard Suites):** Run `.venv/bin/python -m ruff check tests/unit/test_se_audit_devops_configs_and_docs.py` and `.venv/bin/python -m pytest tests/unit/test_se_audit_devops_configs_and_docs.py tests/unit/test_essay_sse_events.py tests/unit/test_wave3_eval_scripts_and_configs.py -q` and `cd web && npx vitest run src/__tests__/wave1_2_3_remediation.test.tsx`.
- [x] **Step 5 (Triad Review & Critic):** Pass `@reviewer-devops` and `@critic-devops` with `0` open issues.

---

## Phase 4: Whole-System Integration, Hostile Convergence Audit & Knowledge Graph Sync

- [x] **Step 1 (Global Full-Suite Verification):**
  - `.venv/bin/python -m ruff check src/ tests/ scripts/` -> `0` errors
  - `.venv/bin/python -m mypy src/integrity_checker` -> `0` errors
  - `.venv/bin/python -m pytest tests/ -q -W error::ResourceWarning` -> `100%` passed, `0` `ResourceWarning`s
  - `cd web && npm run lint && npx tsc --noEmit && npx tsc -p tsconfig.e2e.json --noEmit && npx vitest run && npm run build` -> `100%` passed, all chunks `< 500 kB`
- [ ] **Step 2 (Hostile Whole-System Convergence Critic — Wave 2+ Loop):**
  - Dispatch a fresh `Gemini 4 Carbon (High)` Hostile Principal Systems & Security Critic (`critic-convergence`) over `git diff main...HEAD` + live codebase to hunt for any cross-track regression, missed edge case, or residual improvement opportunity.
  - If `critic-convergence` finds >= 1 actionable issue -> execute Wave 2 TDD fix + re-review + re-critique until `critic-convergence` signs off with **`CONVERGED: 0 ACTIONABLE IMPROVEMENTS REMAINING`**.
- [ ] **Step 3 (Knowledge Graph & Metrics Sync):**
  - Run `graphify update .` to refresh `graphify-out/` AST graph.
  - Sync final exact test counts across `CLAUDE.md` and `README.md`, run final verification gate, and merge cleanly.
