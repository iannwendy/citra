# Database Schema Migration Standardization — Design Specification

- **Date:** 2026-11-10
- **Status:** Approved (User requested optimal approach + detailed plan immediately)
- **Target Component:** `src/integrity_checker/db/` (`session.py`, `models.py`, `migrations.py`, `__init__.py`)

---

## 1. Intent & Why

Currently, `src/integrity_checker/db/session.py` (lines 84–360) executes `_run_inline_migrations(engine)` on startup, inspecting table columns and firing dozens of ad-hoc `ALTER TABLE`, `UPDATE`, `DELETE`, and `CREATE INDEX` statements without version tracking, checksum verification, or rollback (`downgrade`) capability.

For a Software Engineering Capstone Defense (Hội đồng ĐATN KTPM) and production operations on `https://citra.io.vn`, the database layer needs:
1. **Explicit Version Tracking (`schema_migrations` table):** Record every applied migration version, human-readable name, SHA-256 checksum, execution latency (`execution_ms`), and UTC timestamp (`applied_at`).
2. **Alembic Operations Integration (`alembic.migration.MigrationContext` + `alembic.operations.Operations`):** Use Alembic's `batch_alter_table` and DDL operations under the hood so both `upgrade` and `downgrade` work reliably on SQLite (which requires table copy-and-swap for dropping columns with indexes or foreign keys) as well as PostgreSQL/MySQL.
3. **Safe Production Rollback & Online Backup:** Provide deterministic `downgrade(engine, target_version)` with automatic online SQLite backup (`sqlite3.Connection.backup` with `0o600` permissions) before destructive schema changes.
4. **100% Backward Compatibility:** Keep `_run_inline_migrations(engine)` in `session.py` as a thin facade delegating to `run_migrations(engine)` so all 1,683+ existing unit and integration tests pass without modification.

---

## 2. Goals, Non-Goals, and Anti-Goals

### Goals
- Replace the monolithic 275-line `_run_inline_migrations` body in `src/integrity_checker/db/session.py` with a modular, versioned migration engine in `src/integrity_checker/db/migrations.py`.
- Model `SchemaMigrationRecord` (`__tablename__ = "schema_migrations"`) in `src/integrity_checker/db/models.py`.
- Decompose all historical schema evolutions into 9 ordered, self-contained `MigrationStep` revisions (`0001` through `0009`), each with `upgrade(conn, op)` and `downgrade(conn, op)`.
- Verify SHA-256 checksums of applied migrations on startup to detect schema history tampering or drift (`MigrationIntegrityError`).
- Provide a CLI interface (`python -m integrity_checker.db.migrations status|upgrade|downgrade|verify|history`) for DevOps and thesis defense demonstration.
- Enforce strict security controls: parameterized SQL (`sqlalchemy.text`), identifier allowlist validation, path-traversal prevention on backup files, and `0o600` backup file permissions.

### Non-Goals
- Changing any application domain table schemas (`users`, `essays`, `citations`, `verdicts`, `classes`, `billing_transactions`, `promo_codes`, etc.).
- Requiring an external `alembic.ini` file outside `src/` that could be missed by Docker builds.

### Anti-Goals
- Breaking existing callers or tests that import `_run_inline_migrations` from `integrity_checker.db.session`.
- Silently swallowing migration failures or allowing unverified SQL string interpolation.

---

## 3. Approaches Considered

| Approach | Description | Trade-offs | Decision |
| :--- | :--- | :--- | :--- |
| **A. Hybrid `schema_migrations` Ledger + Programmatic Alembic `Operations` (`batch_alter_table`)** | Embeds `SchemaMigrationRecord` in SQLAlchemy models and uses Alembic's `MigrationContext` & `Operations` (`batch_alter_table`) inside `src/integrity_checker/db/migrations.py` with SHA-256 checksums, online SQLite backups, and CLI support. | Zero external config files (`alembic.ini`) needed in Docker; full `upgrade`/`downgrade` support on SQLite via Alembic batch mode; fast O(1) version check on startup; 100% compatible with in-memory SQLite tests. | **Selected (Optimal)** |
| **B. Traditional External `alembic/` Folder + `alembic.ini`** | Uses standard `alembic init` directory at repo root and shells out or calls `alembic.command.upgrade`. | Requires updating `Dockerfile`, `docker-compose.yml`, and test fixtures for `:memory:` connections; slower per-test initialization across 1,683 unit tests. | Rejected |
| **C. Raw SQL `schema_migrations` Table Only (No Alembic)** | Tracks version strings in a custom table using raw `ALTER TABLE` SQL. | Cannot safely `downgrade` columns that have indexes or foreign keys (`classes.join_code`, `users.email`, `users.google_id`, `essays.class_id`) on SQLite without Alembic's `batch_alter_table`. | Rejected |

---

## 4. Revision Ledger (`0001` – `0009`)

1. **`0001` (`v1_8_citations_linking_columns`)**: `citations` columns `mapping_status`, `mapping_confidence`, `citation_link_json`.
2. **`0002` (`v1_10_users_account_management`)**: `users` columns `email` (+ `idx_users_email`), `full_name`, `avatar_path`, `is_active`, `last_login_at`.
3. **`0003` (`v1_15_teacher_and_class_assignment`)**: `users` columns `institution`, `can_override_verdicts`; `essays` column `class_id`.
4. **`0004` (`v1_16_citation_and_verdict_context`)**: `citations.context` and `verdicts.context`.
5. **`0005` (`v1_17_users_email_verified`)**: `users.email_verified`.
6. **`0006` (`v2_2_users_subscription_and_quota`)**: `users` subscription/Stripe/quota columns (`plan_tier`, `billing_cycle`, `subscription_status`, `stripe_customer_id`, `stripe_subscription_id`, `current_period_start`, `current_period_end`, `cancel_at_period_end`, `monthly_uploads_used`, `quota_reset_at`) + role-based tier backfill.
7. **`0007` (`v2_3_google_oauth_and_class_join_code`)**: `classes.join_code` (+ `idx_classes_join_code` + `CITRA-xxxx` backfill) and `users` Google OAuth columns (`google_id`, `idx_users_google_id`, `auth_provider`, `username_customized`, `google_onboarded`).
8. **`0008` (`v2_4_privacy_consent_and_billing_vnpay`)**: `users` privacy consent columns (`privacy_consented_at`, `privacy_policy_version`) and `billing_transactions` multi-payment/VNPay/promo columns (`subtotal_usd`, `discount_usd`, `promo_code`, `payment_method`, `billing_country`, `billing_zip`, `amount_vnd`, `vnp_txn_ref`, `idx_billing_transactions_vnp_txn_ref`, `vnp_transaction_no`, `vnp_bank_code`, `vnp_card_type`, `vnp_response_code`).
9. **`0009` (`v2_4_orphan_cleanup_and_composite_indexes`)**: Historical orphan cleanup on `citations`/`verdicts` and creation of the 11 strategic composite B-Tree indexes (`idx_users_role_username`, `idx_essays_user_uploaded`, `idx_essays_class_uploaded`, `idx_essays_user_filename`, `idx_essays_uploaded_at`, `idx_citations_essay_type`, `idx_verdicts_essay_override_label`, `idx_verdicts_label`, `idx_audit_logs_user_logged`, `idx_audit_logs_logged_at`, `idx_promo_redemptions_promo_user`).
