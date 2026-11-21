# CITRA (`SourceLogic`) Holistic Software Engineering Audit & Zero-Defect Architecture Spec

**Date:** 2026-11-21
**Baseline Version:** `v3.89.5` (`ddad5c4`)
**Branch:** `feat/se-holistic-remediation`
**Orchestration Model:** Coordinator + Specialized Swarm Agents (`100%` pinned on `Gemini 4 Carbon (High)`)

---

## 1. Intent & Why

Although CITRA (`essay-integrity-checker` `v3.89.5`) already passes `2,198` backend Pytest tests, `472` frontend Vitest tests, and `20` Playwright E2E suites with `99.02%` ID / `99.75%` OOD / `100.00%` E2E Neuro-Symbolic benchmark accuracy, a graduation-grade and production-grade Software Engineering system must withstand hostile scrutiny across **every SE dimension simultaneously**:

1. **Algorithmic & Parser Safety** (zero $O(2^N)$ ReDoS hangs, zero zip-bomb header-spoof bypasses, zero silent bibliography wipes, zero shared mutable state races).
2. **Distributed Network & Async Resilience** (SSRF-pinned redirects on DOI/challenge resolution, bounded response streaming, `WeakKeyDictionary` event-loop safety, outage-aware abstention without 24h negative-cache poisoning, periodic worker orphan recovery).
3. **OWASP API Security, Billing Integrity & Database Engineering** (real-IP rate-limiting immunity against spoofed `X-Forwarded-For` and 4,096-key FIFO thrashing, timing-safe login, Stripe/VNPay/promo atomicity & zero-dependency REST integration, PostgreSQL `VARCHAR(512)` JWT compatibility, N+1 elimination, ReportLab/OOXML exporter hardening).
4. **Frontend Security, State Isolation, WCAG 2.2 AA Accessibility, i18n & SEO** (`javascript:`/`data:` URL XSS neutralization, cross-account Toast/QueryClient isolation, 7-modal focus trapping & `Escape` handling, 17 icon-button `aria-label`s, 100% Vietnamese copy parity, indexable `/pricing`/`/privacy`/`/terms` SEO).
5. **QA Determinism, Static Type Safety & Scientific Reproducibility** (`0` live paid WAN calls in `tests/unit/`, `0` `ResourceWarning` unclosed SQLite/socket handles, `mypy` clean execution, synchronized `pyproject.toml`/`requirements*.txt`/`package-lock.json`, TLS-verified dataset collectors, bug-free evaluation/maintenance scripts).
6. **DevOps, Container/Proxy Hardening, Zero-Downtime CI/CD & Thesis Parity** (trimmed `<10 MB` Docker build context, non-spoofable Nginx `X-Forwarded-For`, zero-downtime Compose deploy with automatic `PREV_TAG` rollback, de-submoduled `FinalReport_TDTU` LaTeX sources, portable relative documentation links).

---

## 2. Goals, Non-Goals & Anti-Goals

### Goals
- Resolve all **91 verified Software Engineering findings** (`17 CRITICAL`, `27 HIGH`, `32 MEDIUM`, `15 LOW`) plus all **42 baseline `ResourceWarning`s** and frontend `React Router v7` / `act(...)` test warnings.
- Preserve **100% backward compatibility** with every existing scientific benchmark (`99.02%` ID, `99.75%` OOD, `100%` E2E, `BaselineRunner("proposed") == SymbolicRules`), UI/UX aesthetic (`Solva Warm Editorial`), Vietnamese PDPL (`91/2025/QH15` & `356/2025/NĐ-CP`), and existing automated test suite.
- Enforce **Multi-Agent Triad Verification** on every track: `Author (TDD)` → `Two-Axis Reviewer (Standards + Spec)` → `Adversarial Critic (Agent Phản Biện)` → **Holistic Convergence Re-Audit** until `0` actionable defects remain.

### Non-Goals & Anti-Goals
- **Anti-Goal 1 (Scientific Regressions):** Never alter calibrated thresholds or rule ordering in `SymbolicRules` in a way that changes `120K`/`OOD`/`E2E` predictions or `sample_preview` parity in `test_wave3_eval_scripts_and_configs.py`.
- **Anti-Goal 2 (Decision-Support Violation):** Never introduce copy or rule reasoning in EN or VI that deterministically accuses an author of academic misconduct.
- **Anti-Goal 3 (Speculative Over-Engineering / YAGNI):** Do not rewrite working SQLAlchemy ORM architecture wholesale or add external infrastructure dependencies (Redis/Celery); fix root causes cleanly within CITRA's existing architecture.
- **Anti-Goal 4 (Bundle or Guardrail Regressions):** Never push any compiled frontend JS chunk `>= 500 kB` (keep `EssayPage` chunk lean), never reintroduce Tailwind v4-only tokens, and never break `test_lint_clean.py`, `deadCode.test.ts`, `tailwindV3AndBundleHygiene.test.ts`, or `test_essay_sse_events.py`.

---

## 3. Architectural Approaches Considered

1. **Sequential Single-Agent File-by-File Patching (Rejected):** Slow, accumulates massive context pollution across 90+ fixes, and lacks independent adversarial review.
2. **Parallel Uncoordinated Multi-Agent Editing on Shared Files (Rejected):** Causes race conditions on shared files (`essays.py`, `router.tsx`, `pyproject.toml`, `.git/index` via `.githooks/post-commit`).
3. **6 Strictly File-Disjoint Domain Tracks + Upfront Pinned Contracts + Independent Reviewer/Critic Triad + Whole-System Convergence Wave (Selected):**
   - Coordinator handles branch creation and `.git` submodule/index cleanup (`OPS-03`) once upfront.
   - Six `Gemini 4 Carbon (High)` Author agents execute TDD (`RED → GREEN`) concurrently across **mathematically disjoint file sets** (with zero `git commit` inside worker turns).
   - Independent `Gemini 4 Carbon (High)` **Spec/Standards Reviewers** and **Adversarial Critics (*Agent Phản Biện*)** audit every track's diff and attempt to break edge cases; Authors iterate until unanimous `APPROVED (0 DEFECTS)`.
   - Coordinator commits verified tracks atomically, runs full-system gates + `graphify update .`, and dispatches a final **Hostile Whole-System Convergence Critic** (executing Wave 2+ if even one residual defect surfaces).

---

## 4. Pinned Cross-Track Contracts

1. **`LocalDatabase.update_paper_abstract` (Track 2 internal, compatible with `RetrievalOrchestrator`):**
   - `LocalDatabase.update_paper_abstract(self, *, doi: str | None = None, title: str | None = None, abstract: str) -> bool`: updates `papers.abstract` when empty/null and calls `_bump_mutation_version()` so `_QUERY_CACHE` invalidates immediately under SQLite WAL.
2. **Database Schema Migration `0013` (Track 3 -> `test_db_migrations.py`):**
   - `LATEST_SCHEMA_VERSION = "0013"` in `src/integrity_checker/db/migrations.py`.
   - Upgrades `sessions.token` column type to `String(512)` on PostgreSQL/non-SQLite dialects (`models.py:Session.token = Column(String(512), unique=True, nullable=False, index=True)`), adds functional indexes `idx_users_lower_username` (`LOWER(username)`) and `idx_users_lower_email` (`LOWER(email)`), and drops duplicate single-column indexes (`idx_cache_key`, `idx_users_email`, `idx_users_google_id`, `idx_classes_join_code`, `idx_billing_vnp_txn_ref`) where `ix_*`/unique indexes already exist. Also fixes `_downgrade_0012` on PostgreSQL to drop constraint before dropping index.
3. **Proxy Real-IP Contract (`OPS-01`: Track 6 Nginx/Compose <-> Track 3 `auth.py`):**
   - `docker-compose.prod.yml` removes `--forwarded-allow-ips="*"` (restricting `--forwarded-allow-ips="127.0.0.1"`) so Docker bridge requests arrive with private bridge peer IP (`172.16.0.0/12`) in `request.client.host`, activating `_is_trusted_proxy_peer()` in `auth.py:_extract_client_ip()` to read Nginx's trusted `X-Real-IP`.
   - Both `web/nginx.prod.conf` and `web/nginx.conf` set `proxy_set_header X-Forwarded-For $remote_addr;` across all proxy blocks (keeping both `:80` and `:443` SSE + `/api/` blocks intact per `test_essay_sse_events.py:658`).
4. **Stripe Direct REST Checkout Contract (`API-01` & `QA-02`: Track 3 `billing.py` <-> Track 5 `pyproject.toml`/`requirements.txt`):**
   - `billing.py:create_checkout_session` calls Stripe's REST endpoint `POST https://api.stripe.com/v1/checkout/sessions` directly via `httpx` (matching `_verify_stripe_session_paid`), eliminating undeclared `import stripe` runtime crashes while failing closed (`HTTP 502`) if `sk_live_*` fails in production (and preserving `stripe_demo` pending transaction creation when `STRIPE_SECRET_KEY` is unset so VNPay checkout continues working).
5. **Frontend Safe External URL & Session-Clear Event Contracts (Track 4 internal):**
   - `toSafeExternalHref(raw?: string | null): string | null` and `toSafeDoiHref(doi?: string | null): string | null` in `web/src/lib/utils.ts` allow strictly `http:` / `https:`.
   - `AuthContext` dispatches `window.dispatchEvent(new CustomEvent('citra:session-cleared'))` whenever session state clears or switches users; `ToastContext` subscribes to purge active toasts and `sessionStorage['citra_notification_history_v1']`.
6. **Guard-Suite Preservation Contract (All Tracks):**
   - Keep `src/integrity_checker/extraction/regex_patterns.py` public compat surface (`test_lint_clean.py`), keep `web/src/api/client.ts` free of removed method names (`downloadReport`, `getVerdicts`, `listAllEssays`, `getCacheStats`, `getMe`, `health` per `deadCode.test.ts`; name the new class CSV blob helper `downloadClassCsvFile`), keep `Makefile` free of substring `"-m integration"` (`test_wave3_eval_scripts_and_configs.py:652`), and keep all compiled JS chunks `< 500 kB` (`tailwindV3AndBundleHygiene.test.ts`).
