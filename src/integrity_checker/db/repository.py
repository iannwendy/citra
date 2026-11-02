"""Repository — CRUD helpers cho ORM models."""

from __future__ import annotations

import hashlib
import json
import re
import secrets
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session as OrmSession

from integrity_checker.billing.plans import default_plan_for_role
from integrity_checker.db.models import (
    AuditLog,
    AuthToken,
    BillingTransaction,
    CitationCache,
    CitationRecord,
    Class,
    ClassMembership,
    EssayRecord,
    PromoCode,
    PromoRedemption,
    Session,
    User,
    VerdictRecord,
)
from integrity_checker.models.citation import Citation
from integrity_checker.models.validation import CitationVerdict
from integrity_checker.pipeline.integrity_pipeline import _serialize_matched_sources


class Repository:
    """Thin wrapper quanh Session — methods domain-specific."""

    def __init__(self, session: OrmSession) -> None:
        self.session = session

    # -- Essays --

    def create_essay(self, filename: str, num_pages: int) -> EssayRecord:
        essay = EssayRecord(filename=filename, num_pages=num_pages)
        self.session.add(essay)
        self.session.flush()
        # Defensive cleanup in case SQLite reused a deleted essay's ID
        self.session.query(CitationRecord).filter(
            CitationRecord.essay_id == essay.id
        ).delete(synchronize_session=False)
        self.session.query(VerdictRecord).filter(
            VerdictRecord.essay_id == essay.id
        ).delete(synchronize_session=False)
        return essay

    def get_essay(self, essay_id: int) -> EssayRecord | None:
        return self.session.get(EssayRecord, essay_id)

    def get_essays_by_ids(self, essay_ids: list[int] | set[int]) -> dict[int, EssayRecord]:
        """Batch fetch essays by IDs in a single query to avoid N+1 lookups."""
        ids = [eid for eid in essay_ids if eid is not None]
        if not ids:
            return {}
        return {
            e.id: e
            for e in self.session.query(EssayRecord)
            .filter(EssayRecord.id.in_(ids))
            .all()
        }

    # -- Citations --

    def add_citations(self, essay_id: int, citations: list[Citation]) -> list[CitationRecord]:
        def _serialize_authors(authors):
            """Convert Author objects (or other non-JSON types) to plain strings."""
            if not authors:
                return "[]"
            out = []
            for a in authors:
                if isinstance(a, str):
                    out.append(a)
                elif hasattr(a, "last_name"):
                    # Author object - extract name parts and normalize display casing
                    raw_ln = str(getattr(a, "last_name", "") or "").strip()
                    if raw_ln and raw_ln == raw_ln.lower():
                        raw_ln = " ".join(w.capitalize() for w in raw_ln.split())
                    parts = [raw_ln]
                    if getattr(a, "first_name", None):
                        fn = re.sub(r"\.{2,}", ".", str(a.first_name).strip())
                        parts.append(fn)
                    if getattr(a, "middle_name", None):
                        mn = re.sub(r"\.{2,}", ".", str(a.middle_name).strip())
                        parts.append(mn)
                    out.append(" ".join(p for p in parts if p))
                else:
                    out.append(str(a))
            return json.dumps(out, ensure_ascii=False)

        def _one_link_dict(link):
            """CitationLink → JSON-friendly dict (enums flattened to .value)."""
            status = getattr(link, "status", None)
            method = getattr(link, "method", None)
            status_value = (
                status.value if hasattr(status, "value") else (status or None)
            )
            method_value = (
                method.value if hasattr(method, "value") else (method or None)
            )
            return {
                "occurrence_id": getattr(link, "occurrence_id", ""),
                "reference_id": getattr(link, "reference_id", None),
                "status": status_value,
                "confidence": float(getattr(link, "confidence", 0.0) or 0.0),
                "method": method_value,
            }

        def _citation_links_to_json(links, fallback=None):
            """Serialize EVERY edge of a citation as a JSON list (v1.9).

            An occurrence may cite several references at once ("[9, 10]"), and
            storing a single object silently dropped every reference but the
            last. Returns ``None`` when there is no edge at all, so the column
            stays NULL for reference-list rows.

            Tolerates a bare single link for callers that still hold
            ``citation_link``.
            """
            if links is None:
                links = fallback
            if links is None:
                return None
            if not isinstance(links, (list, tuple)):
                links = [links]
            payload = [_one_link_dict(link) for link in links if link is not None]
            if not payload:
                return None
            return json.dumps(payload, ensure_ascii=False)

        # Replace any existing citation rows for this essay_id so re-analysis
        # or id reuse can never accumulate duplicate rows.
        self.session.query(CitationRecord).filter(
            CitationRecord.essay_id == essay_id
        ).delete(synchronize_session=False)

        records = [
            CitationRecord(
                essay_id=essay_id,
                raw_text=c.raw_text,
                citation_type=c.citation_type.value if hasattr(c.citation_type, "value") else str(c.citation_type),
                style=c.style.value if hasattr(c.style, "value") else str(c.style),
                authors=_serialize_authors(c.authors),
                year=c.year,
                title=c.title,
                venue=c.venue,
                doi=c.doi,
                url=c.url,
                page_num=c.page_num,
                confidence=c.confidence,
                # NEW v1.8 — persist in-text linking layer so the UI Citations
                # tab can render the real verdict after the report is reloaded.
                mapping_status=getattr(c, "mapping_status", None),
                mapping_confidence=float(getattr(c, "mapping_confidence", 0.0) or 0.0),
                citation_link_json=_citation_links_to_json(
                    getattr(c, "citation_links", None),
                    fallback=getattr(c, "citation_link", None),
                ),
                # NEW v1.16 — surrounding PDF text, so the Document Inspector
                # can show the sentence the citation sits in after a reload.
                context=getattr(c, "context", None),
            )
            for c in citations
        ]
        self.session.add_all(records)
        self.session.flush()
        return records

    # -- Verdicts --

    def add_verdicts(self, essay_id: int, verdicts: list[CitationVerdict]) -> None:
        # Replace any existing verdict rows for this essay_id for idempotency.
        self.session.query(VerdictRecord).filter(
            VerdictRecord.essay_id == essay_id
        ).delete(synchronize_session=False)

        records = [
            VerdictRecord(
                essay_id=essay_id,
                citation_raw=v.citation.raw_text,
                label=v.label.value if hasattr(v.label, "value") else str(v.label),
                confidence=v.confidence,
                reasoning=v.reasoning,
                triggered_rules=json.dumps(v.triggered_rules, ensure_ascii=False),
                mismatched_fields=json.dumps(v.mismatched_fields, ensure_ascii=False),
                features=json.dumps(
                    {
                        "title_sim_fuzzy": getattr(v.features, "title_sim_fuzzy", 0.0) if v.features else 0.0,
                        "title_sim_semantic": getattr(v.features, "title_sim_semantic", 0.0) if v.features else 0.0,
                        "author_jaccard": getattr(v.features, "author_jaccard", 0.0) if v.features else 0.0,
                        "year_distance": getattr(v.features, "year_distance", 0) if v.features else 0,
                        "doi_exact_match": getattr(v.features, "doi_exact_match", False) if v.features else False,
                        "source_consensus": getattr(v.features, "source_consensus", 0) if v.features else 0,
                        "venue_sim": getattr(v.features, "venue_sim", 0.0) if v.features else 0.0,
                        "content_alignment_score": getattr(v.features, "content_alignment_score", 0.0) if v.features else 0.0,
                        "content_alignment_confidence": getattr(v.features, "content_alignment_confidence", "") if v.features else "",
                        "content_is_aligned": getattr(v.features, "content_is_aligned", False) if v.features else False,
                        "title_context_sim": getattr(v.features, "title_context_sim", 0.0) if v.features else 0.0,
                        "abstract_context_sim": getattr(v.features, "abstract_context_sim", None) if v.features else None,
                        "best_evidence_sentence": getattr(v.features, "best_evidence_sentence", None) if v.features else None,
                        "best_evidence_score": getattr(v.features, "best_evidence_score", None) if v.features else None,
                        "best_cited_sentence": getattr(v.features, "best_cited_sentence", None) if v.features else None,
                        "citation_intent": getattr(v.features, "citation_intent", "") if v.features else "",
                        "stance_label": getattr(v.features, "stance_label", "") if v.features else "",
                        "cross_lingual_detected": getattr(v.features, "cross_lingual_detected", False) if v.features else False,
                        "bridged_concepts": getattr(v.features, "bridged_concepts", []) if v.features else [],
                        "cross_lingual_title_detected": getattr(v.features, "cross_lingual_title_detected", False) if v.features else False,
                        "cross_lingual_title_sim": getattr(v.features, "cross_lingual_title_sim", 0.0) if v.features else 0.0,
                        "context_source": getattr(v.features, "context_source", "") if v.features else "",
                        "occurrence_alignments": getattr(v.features, "occurrence_alignments", []) if v.features else [],
                        "url_status": getattr(v.matched_source, "url_status", None) if getattr(v, "matched_source", None) else None,
                        "url_status_code": getattr(v.matched_source, "url_status_code", None) if getattr(v, "matched_source", None) else None,
                        "archive_url": getattr(v.matched_source, "archive_url", None) if getattr(v, "matched_source", None) else None,
                        "is_retracted": bool(
                            (getattr(v.matched_source, "is_retracted", False) if getattr(v, "matched_source", None) else False)
                            or ("R-RETRACTED-PAPER" in (getattr(v, "triggered_rules", None) or []))
                        ),
                        "checked_url": getattr(v.citation, "url", None) if getattr(v, "citation", None) else None,
                        "matched_sources": _serialize_matched_sources(getattr(v, "matched_source", None)),
                        "citation_link": (
                            {
                                "occurrence_id": v.citation_link.occurrence_id,
                                "reference_id": v.citation_link.reference_id,
                                "status": getattr(
                                    v.citation_link.status,
                                    "value",
                                    v.citation_link.status,
                                ),
                                "confidence": v.citation_link.confidence,
                                "method": getattr(
                                    v.citation_link.method,
                                    "value",
                                    v.citation_link.method,
                                ),
                            }
                            if getattr(v, "citation_link", None) is not None
                            else None
                        ),
                    },
                    ensure_ascii=False,
                ),
                # v1.2 fields
                mapping_status=v.mapping_status.value if hasattr(v.mapping_status, "value") else (v.mapping_status or "matched"),
                mapping_confidence=v.mapping_confidence,
                style_penalty=getattr(v, "style_penalty", None),
                domain_exception=getattr(v, "domain_exception", False),
                is_overridden=v.is_overridden,
                # NEW v1.16 — surrounding PDF text of the citation, carried
                # over from the Citation object the verdict was built from.
                context=getattr(v.citation, "context", None),
            )
            for v in verdicts
        ]
        self.session.add_all(records)
        self.session.flush()

    def get_verdicts(self, essay_id: int) -> list[VerdictRecord]:
        return list(
            self.session.query(VerdictRecord)
            .filter(VerdictRecord.essay_id == essay_id)
            .all()
        )

    def get_verdicts_by_essay_ids(
        self, essay_ids: list[int] | set[int]
    ) -> dict[int, list[VerdictRecord]]:
        """Batch fetch verdicts for multiple essays in a single query."""
        ids = [eid for eid in essay_ids if eid is not None]
        if not ids:
            return {}
        out: dict[int, list[VerdictRecord]] = {eid: [] for eid in ids}
        for v in (
            self.session.query(VerdictRecord)
            .filter(VerdictRecord.essay_id.in_(ids))
            .all()
        ):
            out.setdefault(v.essay_id, []).append(v)
        return out

    def update_verdict(
        self,
        verdict_id: int,
        new_label: str,
        is_overridden: bool = True,
        override_note: str | None = None,
        new_mapping_status: str | None = None,
        overridden_by: str | None = None,
        essay_id: int | None = None,
    ) -> VerdictRecord | None:
        """Update verdict (override by user), optionally enforcing essay_id ownership."""
        verdict = self.session.get(VerdictRecord, verdict_id)
        if not verdict:
            return None
        if essay_id is not None and verdict.essay_id != essay_id:
            return None
        verdict.label = new_label
        verdict.is_overridden = 1 if is_overridden else 0
        if override_note is not None:
            verdict.override_note = override_note
        if new_mapping_status is not None:
            verdict.mapping_status = new_mapping_status
        if overridden_by is not None:
            verdict.overridden_by = overridden_by
        self.session.flush()
        return verdict

    def recalculate_essay_cis(self, essay_id: int) -> dict | None:
        """Recalculate and persist essay.cis_json after verdict overrides."""
        from integrity_checker.config import get_settings
        from integrity_checker.logic.cis import rubric_penalties

        essay = self.session.get(EssayRecord, essay_id)
        if not essay:
            return None

        verdicts = self.get_verdicts(essay_id)
        academic_verdicts = [v for v in verdicts if v.label != "resource"]
        n_academic = len(academic_verdicts)

        existing_cis: dict = {}
        if essay.cis_json:
            try:
                existing_cis = json.loads(essay.cis_json) or {}
            except (json.JSONDecodeError, TypeError):
                existing_cis = {}

        existing_comps = existing_cis.get("components") or {}
        w = get_settings().cis.weights
        penalty_table = rubric_penalties(get_settings())

        if n_academic == 0:
            cis_dict = {
                "score": 0.0,
                "components": {
                    "verified_ratio": 0.0,
                    "metadata_accuracy": 0.0,
                    "in_text_bib_consistency": 0.0,
                    "format_consistency": 0.0,
                    "identifier_validity": 0.0,
                },
                "weights_used": w.model_dump(),
                "num_citations": 0,
                "num_unresolved": 0,
                "disclaimer": existing_cis.get("disclaimer", ""),
            }
        else:
            verified = sum(1 for v in academic_verdicts if v.label == "verified")
            meta_err = sum(1 for v in academic_verdicts if v.label == "metadata_error")
            halluc = sum(1 for v in academic_verdicts if v.label == "suspected_hallucination")
            num_unresolved = sum(1 for v in academic_verdicts if v.label == "unresolved")

            verified_ratio = verified / n_academic
            metadata_accuracy = max(0.0, 1.0 - (meta_err + halluc) / n_academic)

            # Include both in-text CitationRecords and reference VerdictRecords for link consistency
            all_citations = (
                self.session.query(CitationRecord)
                .filter(CitationRecord.essay_id == essay_id)
                .all()
            )
            in_text_citations = [
                c for c in all_citations if c.citation_type != "reference_list"
            ]
            if in_text_citations:
                in_text_penalty = sum(
                    penalty_table.get(c.mapping_status or "matched", 0.0)
                    for c in in_text_citations
                )
                ref_non_matched = [
                    v
                    for v in academic_verdicts
                    if (v.mapping_status or "matched") != "matched"
                ]
                ref_penalty = sum(
                    penalty_table.get(v.mapping_status or "matched", 0.0)
                    for v in ref_non_matched
                )
                total_links = len(in_text_citations) + len(ref_non_matched)
                in_text_bib_consistency = (
                    max(0.0, 1.0 - (in_text_penalty + ref_penalty) / total_links)
                    if total_links > 0
                    else 1.0
                )
            else:
                total_penalty = sum(
                    penalty_table.get(v.mapping_status or "matched", 0.0)
                    for v in academic_verdicts
                )
                in_text_bib_consistency = max(0.0, 1.0 - total_penalty / n_academic)

            format_consistency = float(existing_comps.get("format_consistency", 1.0))

            # Recalculate identifier_validity from verdicts that have DOIs
            import re as _re
            doi_by_raw = {c.raw_text: c.doi for c in all_citations if c.doi}

            def _verdict_has_doi(v: VerdictRecord) -> bool:
                if doi_by_raw.get(v.citation_raw):
                    return True
                return bool(_re.search(r"\b10\.\d{4,9}/\S+", v.citation_raw or ""))

            verdicts_with_doi = [v for v in academic_verdicts if _verdict_has_doi(v)]
            if verdicts_with_doi:
                valid_doi_count = sum(
                    1
                    for v in verdicts_with_doi
                    if v.label in ("verified", "metadata_error")
                )
                identifier_validity = valid_doi_count / len(verdicts_with_doi)
            else:
                identifier_validity = float(existing_comps.get("identifier_validity", 1.0))

            score = round(
                (
                    verified_ratio * w.verified_ratio
                    + metadata_accuracy * w.metadata_accuracy
                    + in_text_bib_consistency * w.in_text_bib_consistency
                    + format_consistency * w.format_consistency
                    + identifier_validity * w.identifier_validity
                )
                * 100.0,
                2,
            )
            cis_dict = {
                "score": score,
                "components": {
                    "verified_ratio": round(verified_ratio, 4),
                    "metadata_accuracy": round(metadata_accuracy, 4),
                    "in_text_bib_consistency": round(in_text_bib_consistency, 4),
                    "format_consistency": round(format_consistency, 4),
                    "identifier_validity": round(identifier_validity, 4),
                },
                "weights_used": existing_cis.get("weights_used") or w.model_dump(),
                "num_citations": n_academic,
                "num_unresolved": num_unresolved,
                "disclaimer": existing_cis.get("disclaimer", ""),
            }

        essay.cis_json = json.dumps(cis_dict, ensure_ascii=False)
        self.session.flush()
        return cis_dict

    def log_audit(
        self,
        verdict_id: int,
        original_label: str,
        new_label: str,
        user: str,
        note: str | None = None,
    ) -> AuditLog:
        """Append-only audit row. Never update or delete via repository."""
        row = AuditLog(
            verdict_id=verdict_id,
            original_label=original_label,
            new_label=new_label,
            user=user,
            note=note,
        )
        self.session.add(row)
        return row

    def list_audit_log(
        self,
        limit: int = 50,
        offset: int = 0,
        user_filter: str | None = None,
    ) -> list[AuditLog]:
        """Return audit rows newest-first, optionally filtered by user."""
        q = self.session.query(AuditLog)
        if user_filter:
            q = q.filter(AuditLog.user == user_filter)
        return q.order_by(AuditLog.logged_at.desc()).limit(limit).offset(offset).all()

    def get_citations(self, essay_id: int) -> list[CitationRecord]:
        """Return extracted citations in insertion order."""
        return list(
            self.session.query(CitationRecord)
            .filter(CitationRecord.essay_id == essay_id)
            .order_by(CitationRecord.id)
            .all()
        )

    # -- commit --

    def commit(self) -> None:
        self.session.commit()

    def rollback(self) -> None:
        self.session.rollback()

    # -- Users --

    def get_user_by_username(self, username: str) -> User | None:
        normalized = username.strip().lower()
        if not normalized:
            return None
        return (
            self.session.query(User)
            .filter(func.lower(User.username) == normalized)
            .first()
        )

    def get_user_by_email(self, email: str) -> User | None:
        normalized = email.strip().lower()
        return (
            self.session.query(User)
            .filter(func.lower(User.email) == normalized)
            .first()
        )

    def get_user_by_google_id(self, google_id: str) -> User | None:
        normalized = google_id.strip()
        if not normalized:
            return None
        return (
            self.session.query(User)
            .filter(User.google_id == normalized)
            .first()
        )

    def get_user_by_id(self, user_id: int) -> User | None:
        return self.session.get(User, user_id)

    def get_users_by_ids(self, user_ids: list[int] | set[int]) -> dict[int, User]:
        """Batch fetch users by IDs in a single query to avoid N+1 lookups."""
        ids = [uid for uid in user_ids if uid is not None]
        if not ids:
            return {}
        return {
            u.id: u
            for u in self.session.query(User)
            .filter(User.id.in_(ids))
            .all()
        }

    def create_user(
        self,
        username: str,
        password_hash: str,
        role: str,
        email: str | None = None,
        full_name: str | None = None,
        is_active: bool = True,
        institution: str | None = None,
        can_override_verdicts: bool | None = None,
        email_verified: bool = True,
        plan_tier: str | None = None,
        google_id: str | None = None,
        auth_provider: str = "local",
        avatar_path: str | None = None,
        username_customized: bool | None = None,
    ) -> User:
        if can_override_verdicts is None:
            can_override_verdicts = role in ("admin", "teacher")
        if username_customized is None:
            username_customized = auth_provider != "google"
        resolved_tier = plan_tier or default_plan_for_role(role)
        user = User(
            username=username,
            password_hash=password_hash,
            role=role,
            email=email,
            full_name=full_name,
            avatar_path=avatar_path,
            is_active=1 if is_active else 0,
            institution=institution,
            can_override_verdicts=1 if can_override_verdicts else 0,
            email_verified=1 if email_verified else 0,
            plan_tier=resolved_tier,
            google_id=google_id,
            auth_provider=auth_provider,
            username_customized=1 if username_customized else 0,
            google_onboarded=1 if username_customized else 0,
        )
        self.session.add(user)
        self.session.flush()
        return user

    def update_user(self, user_id: int, **kwargs) -> User | None:
        user = self.session.get(User, user_id)
        if not user:
            return None
        nullable_fields = {
            "avatar_path",
            "billing_cycle",
            "current_period_start",
            "current_period_end",
            "stripe_subscription_id",
            "google_id",
        }
        for key, value in kwargs.items():
            if value is None and key not in nullable_fields:
                # Skip None values to keep partial-update semantics
                continue
            if (
                key in (
                    "is_active",
                    "can_override_verdicts",
                    "email_verified",
                    "cancel_at_period_end",
                    "username_customized",
                    "google_onboarded",
                )
                and isinstance(value, bool)
            ):
                value = 1 if value else 0
            if hasattr(user, key):
                setattr(user, key, value)
        self.session.flush()
        return user

    # -- Billing Transactions --

    def create_billing_transaction(
        self,
        user_id: int,
        stripe_session_id: str,
        plan_tier: str,
        billing_cycle: str,
        amount_usd: float,
        subtotal_usd: float | None = None,
        discount_usd: float = 0.0,
        promo_code: str | None = None,
        amount_vnd: int | None = None,
        currency: str = "usd",
        status: str = "pending",
        payment_mode: str = "stripe_demo",
        payment_method: str = "card",
        card_brand: str | None = "visa",
        card_last4: str | None = "4242",
        billing_country: str | None = "VN",
        billing_zip: str | None = None,
    ) -> BillingTransaction:
        resolved_subtotal = float(subtotal_usd if subtotal_usd is not None else amount_usd)
        tx = BillingTransaction(
            user_id=user_id,
            stripe_session_id=stripe_session_id,
            plan_tier=plan_tier,
            billing_cycle=billing_cycle,
            subtotal_usd=resolved_subtotal,
            discount_usd=float(discount_usd or 0.0),
            promo_code=promo_code,
            amount_usd=float(amount_usd),
            amount_vnd=int(amount_vnd) if amount_vnd is not None else None,
            currency=currency,
            status=status,
            payment_mode=payment_mode,
            payment_method=payment_method,
            card_brand=card_brand,
            card_last4=card_last4,
            billing_country=billing_country,
            billing_zip=billing_zip,
        )
        self.session.add(tx)
        self.session.flush()
        return tx

    def get_billing_transaction_by_session(
        self, stripe_session_id: str
    ) -> BillingTransaction | None:
        return (
            self.session.query(BillingTransaction)
            .filter(BillingTransaction.stripe_session_id == stripe_session_id)
            .first()
        )

    def get_billing_transaction_by_vnp_txn_ref(
        self, vnp_txn_ref: str
    ) -> BillingTransaction | None:
        normalized = (vnp_txn_ref or "").strip()
        if not normalized:
            return None
        tx = (
            self.session.query(BillingTransaction)
            .filter(BillingTransaction.vnp_txn_ref == normalized)
            .first()
        )
        if tx is not None:
            return tx
        # Fallback: check if vnp_TxnRef matches stripe_session_id directly
        return self.get_billing_transaction_by_session(normalized)

    def list_billing_transactions_for_user(
        self, user_id: int, limit: int = 50
    ) -> list[BillingTransaction]:
        return list(
            self.session.query(BillingTransaction)
            .filter(BillingTransaction.user_id == user_id)
            .order_by(BillingTransaction.created_at.desc())
            .limit(limit)
            .all()
        )

    # -- Promo Codes (6-char discount codes) --

    def generate_unique_promo_code(self) -> str:
        """Generate a unique 6-character uppercase alphanumeric promo code."""
        alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
        for _ in range(50):
            candidate = "".join(secrets.choice(alphabet) for _ in range(6))
            if not self.get_promo_code_by_code(candidate):
                return candidate
        return secrets.token_hex(3).upper()

    def get_promo_code_by_code(self, code: str) -> PromoCode | None:
        normalized = (code or "").strip().upper()
        if not normalized:
            return None
        return (
            self.session.query(PromoCode)
            .filter(func.upper(PromoCode.code) == normalized)
            .first()
        )

    def get_promo_code_by_id(self, promo_id: int) -> PromoCode | None:
        return self.session.get(PromoCode, promo_id)

    def list_promo_codes(self) -> list[PromoCode]:
        return list(
            self.session.query(PromoCode)
            .order_by(PromoCode.created_at.desc(), PromoCode.id.desc())
            .all()
        )

    def create_promo_code(
        self,
        code: str,
        discount_type: str,
        discount_value: float,
        description: str | None = None,
        max_discount_usd: float | None = None,
        min_amount_usd: float = 0.0,
        applicable_tiers: str = "all",
        applicable_cycles: str = "all",
        max_uses: int | None = None,
        max_uses_per_user: int = 1,
        is_active: bool = True,
        expires_at: datetime | None = None,
        created_by: int | None = None,
    ) -> PromoCode:
        promo = PromoCode(
            code=code.strip().upper(),
            description=description,
            discount_type=discount_type,
            discount_value=float(discount_value),
            max_discount_usd=float(max_discount_usd) if max_discount_usd is not None else None,
            min_amount_usd=float(min_amount_usd or 0.0),
            applicable_tiers=applicable_tiers,
            applicable_cycles=applicable_cycles,
            max_uses=int(max_uses) if max_uses is not None else None,
            max_uses_per_user=max(1, int(max_uses_per_user or 1)),
            used_count=0,
            is_active=1 if is_active else 0,
            expires_at=expires_at,
            created_by=created_by,
        )
        self.session.add(promo)
        self.session.flush()
        return promo

    def update_promo_code(self, promo_id: int, **kwargs: Any) -> PromoCode | None:
        promo = self.get_promo_code_by_id(promo_id)
        if not promo:
            return None
        nullable_fields = {"description", "max_discount_usd", "max_uses", "expires_at"}
        for key, value in kwargs.items():
            if value is None and key not in nullable_fields:
                continue
            if key == "is_active" and isinstance(value, bool):
                value = 1 if value else 0
            if key == "code" and isinstance(value, str):
                value = value.strip().upper()
            if hasattr(promo, key):
                setattr(promo, key, value)
        self.session.flush()
        return promo

    def delete_promo_code(self, promo_id: int) -> bool:
        promo = self.get_promo_code_by_id(promo_id)
        if not promo:
            return False
        self.session.delete(promo)
        self.session.flush()
        return True

    def count_user_promo_redemptions(self, promo_code_id: int, user_id: int) -> int:
        return (
            self.session.query(PromoRedemption)
            .filter(
                PromoRedemption.promo_code_id == promo_code_id,
                PromoRedemption.user_id == user_id,
            )
            .count()
        )

    def get_promo_redemption_by_tx(
        self, promo_code_id: int, transaction_id: int
    ) -> PromoRedemption | None:
        return (
            self.session.query(PromoRedemption)
            .filter(
                PromoRedemption.promo_code_id == promo_code_id,
                PromoRedemption.transaction_id == transaction_id,
            )
            .first()
        )

    def record_promo_redemption(
        self,
        promo: PromoCode,
        user_id: int,
        transaction_id: int,
        discount_usd: float,
    ) -> PromoRedemption:
        existing = self.get_promo_redemption_by_tx(promo.id, transaction_id)
        if existing:
            return existing
        promo.used_count = int(promo.used_count or 0) + 1
        redemption = PromoRedemption(
            promo_code_id=promo.id,
            user_id=user_id,
            transaction_id=transaction_id,
            code=promo.code,
            discount_usd=round(float(discount_usd), 2),
        )
        self.session.add(redemption)
        self.session.flush()
        return redemption

    def get_promo_summary_stats(self) -> dict[str, Any]:
        total_codes = self.session.query(func.count(PromoCode.id)).scalar() or 0
        active_codes = (
            self.session.query(func.count(PromoCode.id))
            .filter(PromoCode.is_active == 1)
            .scalar()
            or 0
        )
        total_redemptions = int(
            self.session.query(func.coalesce(func.sum(PromoCode.used_count), 0)).scalar()
            or 0
        )
        total_discount_usd = float(
            self.session.query(func.coalesce(func.sum(PromoRedemption.discount_usd), 0.0)).scalar()
            or 0.0
        )
        return {
            "total_codes": int(total_codes),
            "active_codes": int(active_codes),
            "total_redemptions": total_redemptions,
            "total_discount_usd": round(total_discount_usd, 2),
        }

    def update_last_login(self, user_id: int) -> None:
        from datetime import datetime
        user = self.session.get(User, user_id)
        if user:
            user.last_login_at = datetime.now(UTC)
            self.session.flush()

    def delete_user(self, user_id: int) -> bool:
        user = self.session.get(User, user_id)
        if not user:
            return False
        # Clean up classes taught by this user and detach essay references
        for cls in self.list_classes_for_teacher(user_id):
            self.session.query(EssayRecord).filter(EssayRecord.class_id == cls.id).update(
                {EssayRecord.class_id: None}, synchronize_session=False
            )
            self.session.delete(cls)
        self.session.query(EssayRecord).filter(EssayRecord.user_id == user_id).update(
            {EssayRecord.user_id: None}, synchronize_session=False
        )
        self.session.delete(user)
        self.session.flush()
        return True

    def get_all_users(self) -> list[User]:
        return list(self.session.query(User).all())

    # -- Sessions --

    def create_session(self, user_id: int, token: str, expires_at: datetime) -> Session:
        session = Session(user_id=user_id, token=token, expires_at=expires_at)
        self.session.add(session)
        self.session.flush()
        return session

    def get_session_by_token(self, token: str) -> Session | None:
        return self.session.query(Session).filter(Session.token == token).first()

    def delete_session(self, token: str) -> bool:
        session = self.get_session_by_token(token)
        if not session:
            return False
        self.session.delete(session)
        self.session.flush()
        return True

    def delete_user_sessions(self, user_id: int) -> int:
        """Revoke all active JWT sessions for a user (e.g. after password reset)."""
        deleted = (
            self.session.query(Session)
            .filter(Session.user_id == user_id)
            .delete(synchronize_session=False)
        )
        self.session.flush()
        return deleted

    # -- Auth Tokens (Account Activation & Password Reset) --

    @staticmethod
    def hash_token(raw_token: str) -> str:
        """Compute deterministic SHA-256 hex digest of a raw URL-safe token."""
        return hashlib.sha256(raw_token.strip().encode("utf-8")).hexdigest()

    def create_auth_token(
        self,
        user_id: int,
        token_type: str,
        expires_at: datetime,
    ) -> tuple[str, AuthToken]:
        """Issue a new one-time token and invalidate prior unused tokens of the same type."""
        now = datetime.now(UTC)
        prior_unused = (
            self.session.query(AuthToken)
            .filter(
                AuthToken.user_id == user_id,
                AuthToken.token_type == token_type,
                AuthToken.used_at.is_(None),
            )
            .all()
        )
        for old_tok in prior_unused:
            old_tok.used_at = now

        raw_token = secrets.token_urlsafe(32)
        token_row = AuthToken(
            user_id=user_id,
            token_hash=self.hash_token(raw_token),
            token_type=token_type,
            expires_at=expires_at,
        )
        self.session.add(token_row)
        self.session.flush()
        return raw_token, token_row

    def get_auth_token(self, raw_token: str, token_type: str) -> AuthToken | None:
        """Look up an AuthToken by its raw token string and expected type."""
        if not raw_token or not raw_token.strip():
            return None
        token_hash = self.hash_token(raw_token)
        return (
            self.session.query(AuthToken)
            .filter(
                AuthToken.token_hash == token_hash,
                AuthToken.token_type == token_type,
            )
            .first()
        )

    def get_latest_auth_token_for_user(
        self, user_id: int, token_type: str
    ) -> AuthToken | None:
        """Return the most recently created token of ``token_type`` for ``user_id``."""
        return (
            self.session.query(AuthToken)
            .filter(
                AuthToken.user_id == user_id,
                AuthToken.token_type == token_type,
            )
            .order_by(AuthToken.created_at.desc(), AuthToken.id.desc())
            .first()
        )

    def mark_auth_token_used(self, token_row: AuthToken) -> None:
        """Mark a token as consumed."""
        token_row.used_at = datetime.now(UTC)
        self.session.flush()

    # -- Essays with user_id --

    def create_essay_with_user(
        self,
        filename: str,
        num_pages: int,
        user_id: int | None,
        class_id: int | None = None,
    ) -> EssayRecord:
        essay = EssayRecord(
            filename=filename,
            num_pages=num_pages,
            user_id=user_id,
            class_id=class_id,
        )
        self.session.add(essay)
        self.session.flush()
        # Defensive cleanup in case SQLite reused a deleted essay's ID
        self.session.query(CitationRecord).filter(
            CitationRecord.essay_id == essay.id
        ).delete(synchronize_session=False)
        self.session.query(VerdictRecord).filter(
            VerdictRecord.essay_id == essay.id
        ).delete(synchronize_session=False)
        return essay

    def update_essay_pipeline_output(
        self, essay_id: int, style_profile: dict | None = None, cis: dict | None = None
    ) -> None:
        """Persist full pipeline output (style_profile + cis) into essay row."""
        essay = self.session.get(EssayRecord, essay_id)
        if not essay:
            return
        if style_profile is not None:
            essay.style_profile_json = json.dumps(style_profile, ensure_ascii=False, default=str)
        if cis is not None:
            essay.cis_json = json.dumps(cis, ensure_ascii=False, default=str)
        self.session.flush()

    def get_user_essays(self, user_id: int) -> list[EssayRecord]:
        return list(
            self.session.query(EssayRecord)
            .filter(EssayRecord.user_id == user_id)
            .order_by(EssayRecord.uploaded_at.desc())
            .all()
        )

    def get_all_essays(self) -> list[EssayRecord]:
        return list(
            self.session.query(EssayRecord)
            .order_by(EssayRecord.uploaded_at.desc())
            .all()
        )

    # -- Essay dedupe --

    @staticmethod
    def _essay_quality(essay: EssayRecord, citation_counts: dict[int, int]) -> tuple[int, int, str, int]:
        """Rank key for keeping the best copy of a duplicated upload.

        Prefers essays that actually produced results (verdicts/citations),
        then the most recent upload, then a stable id tie-breaker.
        """
        uploaded = essay.uploaded_at.isoformat() if essay.uploaded_at else ""
        has_results = 1 if (citation_counts.get(essay.id, 0) > 0 or bool(essay.cis_json)) else 0
        return (has_results, 1 if uploaded else 0, uploaded, essay.id or 0)

    def get_all_essays_deduped(
        self,
        user_id: int | None = None,
        user_ids: list[int] | None = None,
    ) -> list[tuple[EssayRecord, list[int]]]:
        """Group essays by filename (scoped per user), keeping the best copy.

        Re-uploading the same PDF currently creates a new ``essays`` row every
        time, which inflates statistics (e.g. ``TranThanhPhuoc_...pdf`` ×4).
        This returns one entry per filename with the duplicate ids so callers
        can hide/delete them.

        Returns:
            list of ``(canonical_essay, duplicate_ids)`` ordered by the
            canonical essay's ``uploaded_at`` descending.
        """
        query = self.session.query(EssayRecord)
        if user_ids is not None:
            if not user_ids:
                return []
            query = query.filter(EssayRecord.user_id.in_(user_ids))
        elif user_id is not None:
            query = query.filter(EssayRecord.user_id == user_id)
        essays = list(query.order_by(EssayRecord.uploaded_at.desc()).all())
        if not essays:
            return []

        from sqlalchemy import func

        counts = {
            row[0]: row[1]
            for row in self.session.query(
                CitationRecord.essay_id, func.count(CitationRecord.id)
            ).group_by(CitationRecord.essay_id).all()
        }

        groups: dict[tuple[int | None, str], list[EssayRecord]] = {}
        for essay in essays:
            groups.setdefault((essay.user_id, essay.filename), []).append(essay)

        result: list[tuple[EssayRecord, list[int]]] = []
        for copies in groups.values():
            best = max(copies, key=lambda e: self._essay_quality(e, counts))
            duplicates = [e.id for e in copies if e.id != best.id]
            result.append((best, duplicates))

        result.sort(
            key=lambda item: item[0].uploaded_at or datetime.min.replace(tzinfo=UTC),
            reverse=True,
        )
        return result

    def can_user_access_essay(self, user: User, essay: EssayRecord) -> bool:
        """Return True if ``user`` owns ``essay``, is admin, or teaches the owner/class."""
        if user.role == "admin" or essay.user_id == user.id:
            return True
        if user.role == "teacher":
            teacher_class_ids = {c.id for c in self.list_classes_for_teacher(user.id)}
            if not teacher_class_ids:
                return False
            if essay.class_id is not None and essay.class_id in teacher_class_ids:
                return True
            if essay.user_id is not None:
                student_class_ids = {
                    m.class_id
                    for m in self.session.query(ClassMembership)
                    .filter(ClassMembership.student_id == essay.user_id)
                    .all()
                }
                return bool(teacher_class_ids & student_class_ids)
        return False

    # -- Citation Cache --

    def get_cache_entry(self, cache_key: str, source: str) -> CitationCache | None:
        return self.session.query(CitationCache).filter(
            CitationCache.cache_key == cache_key,
            CitationCache.source == source
        ).first()

    def save_cache_entry(
        self, cache_key: str, source: str, raw_response: str, matched_fields: str | None = None
    ) -> CitationCache:
        existing = (
            self.session.query(CitationCache)
            .filter(CitationCache.cache_key == cache_key)
            .first()
        )
        if existing is not None:
            existing.source = source
            existing.raw_response = raw_response
            existing.matched_fields = matched_fields
            self.session.flush()
            return existing
        entry = CitationCache(
            cache_key=cache_key,
            source=source,
            raw_response=raw_response,
            matched_fields=matched_fields,
        )
        self.session.add(entry)
        self.session.flush()
        return entry

    def update_cache_hit(self, cache_key: str) -> None:
        entry = self.session.query(CitationCache).filter(CitationCache.cache_key == cache_key).first()
        if entry:
            entry.last_hit_at = datetime.now(UTC)
            entry.hit_count = (entry.hit_count or 0) + 1
            self.session.flush()

    def get_cache_stats(self) -> dict:
        total = self.session.query(func.count(CitationCache.id)).scalar() or 0
        by_source: dict[str, int] = {
            src: 0
            for src in [
                "crossref",
                "openalex",
                "dblp",
                "arxiv",
                "openlibrary",
                "europepmc",
                "datacite",
                "doi_ra",
                "doaj",
                "openaire_hal",
                "ncbi_biorxiv",
                "huggingface",
                "tech_standard",
                "wikidata_opencitations",
                "serpapi",
            ]
        }
        for src, cnt in (
            self.session.query(CitationCache.source, func.count(CitationCache.id))
            .group_by(CitationCache.source)
            .all()
        ):
            if src:
                by_source[str(src)] = int(cnt or 0)
        total_hits = int(
            self.session.query(func.coalesce(func.sum(CitationCache.hit_count), 0)).scalar()
            or 0
        )

        local_papers_count = 0
        local_queries_count = 0
        local_hit_rate_percent = 0.0
        try:
            from integrity_checker.database import LocalDatabase

            local_stats = LocalDatabase().get_stats()
            local_papers_count = int(local_stats.get("total_papers", 0) or 0)
            local_queries_count = int(local_stats.get("total_queries", 0) or 0)
            local_hit_rate_percent = float(local_stats.get("hit_rate_percent", 0.0) or 0.0)
            for src, count in (local_stats.get("source_counts") or {}).items():
                key = str(src or "unknown")
                by_source[key] = by_source.get(key, 0) + int(count or 0)
        except Exception:
            pass

        combined_total = total + local_papers_count
        combined_hits = total_hits + local_queries_count
        return {
            "total": combined_total,
            "by_source": by_source,
            "total_hits": combined_hits,
            "avg_hit_count": round(combined_hits / combined_total, 2) if combined_total > 0 else 0.0,
            "local_papers_count": local_papers_count,
            "local_queries_count": local_queries_count,
            "local_hit_rate_percent": local_hit_rate_percent,
        }

    def clear_cache(self) -> int:
        count = self.session.query(CitationCache).delete()
        self.session.flush()
        return count

    # -- Classes (v1.15 — Phase 3 + v2.3 join_code) --

    def _generate_join_code(self) -> str:
        """Generate a unique human-friendly join code like CITRA-4F8K."""
        import secrets

        alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
        for _ in range(30):
            suffix = "".join(secrets.choice(alphabet) for _ in range(4))
            candidate = f"CITRA-{suffix}"
            if not self.get_class_by_join_code(candidate):
                return candidate
        return f"CITRA-{secrets.token_hex(3).upper()}"

    def create_class(
        self,
        name: str,
        teacher_id: int,
        description: str | None = None,
        join_code: str | None = None,
    ) -> Class:
        code = (join_code or "").strip().upper() or self._generate_join_code()
        cls = Class(
            name=name,
            teacher_id=teacher_id,
            description=description,
            join_code=code,
        )
        self.session.add(cls)
        self.session.flush()
        return cls

    def get_class(self, class_id: int) -> Class | None:
        return self.session.get(Class, class_id)

    def get_class_by_name(self, name: str) -> Class | None:
        return self.session.query(Class).filter(Class.name == name).first()

    def get_class_by_join_code(self, join_code: str) -> Class | None:
        normalized = (join_code or "").strip().upper()
        if not normalized:
            return None
        return (
            self.session.query(Class)
            .filter(func.upper(Class.join_code) == normalized)
            .first()
        )

    def regenerate_class_join_code(self, class_id: int) -> Class | None:
        cls = self.get_class(class_id)
        if not cls:
            return None
        cls.join_code = self._generate_join_code()
        self.session.flush()
        return cls

    def list_all_classes(self) -> list[Class]:
        return list(self.session.query(Class).order_by(Class.created_at.desc()).all())

    def list_classes_for_teacher(self, teacher_id: int) -> list[Class]:
        return list(
            self.session.query(Class)
            .filter(Class.teacher_id == teacher_id)
            .order_by(Class.created_at.desc())
            .all()
        )

    def list_classes_for_student(self, student_id: int) -> list[Class]:
        """Classes mà student là thành viên (qua ClassMembership)."""
        return list(
            self.session.query(Class)
            .join(ClassMembership, ClassMembership.class_id == Class.id)
            .filter(ClassMembership.student_id == student_id)
            .order_by(Class.created_at.desc())
            .all()
        )

    def add_student_to_class(self, class_id: int, student_id: int) -> ClassMembership:
        """Idempotent — if membership already exists, return existing row."""
        existing = (
            self.session.query(ClassMembership)
            .filter(
                ClassMembership.class_id == class_id,
                ClassMembership.student_id == student_id,
            )
            .first()
        )
        if existing:
            return existing
        membership = ClassMembership(class_id=class_id, student_id=student_id)
        self.session.add(membership)
        self.session.flush()
        return membership

    def remove_student_from_class(self, class_id: int, student_id: int) -> bool:
        membership = (
            self.session.query(ClassMembership)
            .filter(
                ClassMembership.class_id == class_id,
                ClassMembership.student_id == student_id,
            )
            .first()
        )
        if not membership:
            return False
        self.session.delete(membership)
        self.session.flush()
        return True

    def list_students_in_class(self, class_id: int) -> list[User]:
        return list(
            self.session.query(User)
            .join(ClassMembership, ClassMembership.student_id == User.id)
            .filter(ClassMembership.class_id == class_id)
            .order_by(User.username.asc())
            .all()
        )

    def list_all_students(self) -> list[User]:
        """List all users with role='user' (students), ordered by username."""
        return list(
            self.session.query(User)
            .filter(User.role == "user")
            .order_by(User.username.asc())
            .all()
        )

    def count_students_in_class(self, class_id: int) -> int:
        return (
            self.session.query(ClassMembership)
            .filter(ClassMembership.class_id == class_id)
            .count()
        )

    def count_students_by_class_ids(
        self, class_ids: list[int] | set[int]
    ) -> dict[int, int]:
        """Batch count students per class in a single GROUP BY query."""
        ids = [cid for cid in class_ids if cid is not None]
        if not ids:
            return {}
        out: dict[int, int] = {cid: 0 for cid in ids}
        for cid, cnt in (
            self.session.query(
                ClassMembership.class_id, func.count(ClassMembership.id)
            )
            .filter(ClassMembership.class_id.in_(ids))
            .group_by(ClassMembership.class_id)
            .all()
        ):
            out[int(cid)] = int(cnt or 0)
        return out

    def count_pending_reviews_by_essay_ids(
        self, essay_ids: list[int] | set[int]
    ) -> int:
        """Count non-overridden flagged verdicts across a pre-computed set of essay IDs."""
        ids = [eid for eid in essay_ids if eid is not None]
        if not ids:
            return 0
        return (
            self.session.query(VerdictRecord)
            .filter(
                VerdictRecord.essay_id.in_(ids),
                VerdictRecord.is_overridden == 0,
                VerdictRecord.label.in_(["metadata_error", "suspected_hallucination"]),
            )
            .count()
        )

    def get_class_essays(self, class_id: int) -> list[EssayRecord]:
        """Essays gán trực tiếp vào class_id hoặc của students trong class (khi chưa gán class_id)."""
        from sqlalchemy import and_, or_

        student_ids = [
            row[0]
            for row in self.session.query(ClassMembership.student_id)
            .filter(ClassMembership.class_id == class_id)
            .all()
        ]
        conditions = [EssayRecord.class_id == class_id]
        if student_ids:
            conditions.append(
                and_(
                    EssayRecord.class_id.is_(None),
                    EssayRecord.user_id.in_(student_ids),
                )
            )
        return list(
            self.session.query(EssayRecord)
            .filter(or_(*conditions))
            .order_by(EssayRecord.uploaded_at.desc())
            .all()
        )

    def count_pending_reviews_for_teacher(self, teacher_id: int) -> int:
        """Essays trong các class teacher phụ trách mà có verdicts chưa được override."""
        classes = self.list_classes_for_teacher(teacher_id)
        if not classes:
            return 0
        essay_ids = {e.id for c in classes for e in self.get_class_essays(c.id)}
        if not essay_ids:
            return 0
        return (
            self.session.query(VerdictRecord)
            .filter(
                VerdictRecord.essay_id.in_(essay_ids),
                VerdictRecord.is_overridden == 0,
                VerdictRecord.label.in_(["metadata_error", "suspected_hallucination"]),
            )
            .count()
        )

    def count_all_pending_reviews(self) -> int:
        """Tổng số verdicts cần review trên toàn bộ các lớp (dành cho admin trên teacher dashboard)."""
        classes = self.list_all_classes()
        if not classes:
            return 0
        essay_ids = {e.id for c in classes for e in self.get_class_essays(c.id)}
        if not essay_ids:
            return 0
        return (
            self.session.query(VerdictRecord)
            .filter(
                VerdictRecord.essay_id.in_(essay_ids),
                VerdictRecord.is_overridden == 0,
                VerdictRecord.label.in_(["metadata_error", "suspected_hallucination"]),
            )
            .count()
        )

    def list_pending_reviews_for_class(self, class_id: int) -> list[VerdictRecord]:
        """Verdicts trong essays thuộc class này cần review và chưa được override."""
        essay_ids = [e.id for e in self.get_class_essays(class_id)]
        if not essay_ids:
            return []
        return list(
            self.session.query(VerdictRecord)
            .filter(
                VerdictRecord.essay_id.in_(essay_ids),
                VerdictRecord.label.in_(["metadata_error", "suspected_hallucination"]),
                VerdictRecord.is_overridden == 0,
            )
            .order_by(VerdictRecord.validated_at.desc())
            .all()
        )
