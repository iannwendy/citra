"""Baselines — so sánh với phương pháp đơn giản (đề cương §7.1).

    B0 (doi_only):               Chỉ kiểm tra DOI exact match
    B1 (single_source_crossref): Chỉ dựa trên top-1 từ Crossref
    B2 (fuzzy_only):             Chỉ dùng title + author fuzzy score (không semantic / consensus)
    B3 (embedding_only):         Chỉ dùng cosine similarity trên title
    B4 (no_calibration):         Tắt cơ chế abstention band (ép phân loại cứng)
    proposed:                    Multi-source + neural + symbolic + abstention
"""

from __future__ import annotations

from dataclasses import asdict
from typing import Any

from integrity_checker.evaluation.metrics import MetricsCalculator
from integrity_checker.extraction.patterns.apa import is_vn_legal_reference
from integrity_checker.logic.calibration import HybridMLScorer
from integrity_checker.logic.rules import RuleOutcome, SymbolicRules
from integrity_checker.logic.vn_legal_verifier import verify_vn_legal_citation
from integrity_checker.models.source import SourceCandidate, SourceResult
from integrity_checker.models.validation import MatchFeatures, ValidationLabel


def evaluate_symbolic_record(
    rules: SymbolicRules,
    item: dict[str, Any],
) -> tuple[MatchFeatures, RuleOutcome]:
    """Execute production SymbolicRules (+ VNLegalVerifier for statutory refs) on a full record dict."""
    api_exhausted = bool(item.get("api_exhausted", False))
    doi_ra_status = str(item.get("doi_ra_status") or "")
    is_retracted = bool(item.get("is_retracted", False))
    feat = MatchFeatures(
        title_sim_fuzzy=float(item.get("title_sim_fuzzy", 0.0) or 0.0),
        title_sim_semantic=float(item.get("title_sim_semantic", 0.0) or 0.0),
        author_jaccard=float(item.get("author_jaccard", 0.0) or 0.0),
        year_distance=int(item.get("year_distance", 999) if item.get("year_distance") is not None else 999),
        doi_exact_match=bool(item.get("doi_exact_match", False)),
        source_consensus=int(item.get("source_consensus", 0) or 0),
        venue_sim=float(item.get("venue_sim", 0.0) or 0.0),
        content_alignment_score=float(item.get("content_alignment_score", 0.0) or 0.0),
        content_alignment_confidence=str(item.get("content_alignment_confidence", "") or ""),
        content_is_aligned=bool(item.get("content_is_aligned", False)),
        stance_label=str(item.get("stance_label", "") or ""),
        context_source=str(item.get("context_source", "") or ""),
        api_exhausted=api_exhausted,
        doi_ra_status=doi_ra_status,
    )

    cited_title = item.get("cited_title")
    cand_title = item.get("cand_title") or "Candidate Title"
    cited_venue = item.get("cited_venue")
    cand_venue = item.get("cand_venue")
    cited_authors = item.get("cited_authors")
    cand_authors = list(item.get("cand_authors") or [])
    cited_year = str(item.get("cited_year") or "2021")
    cand_year = str(item.get("cand_year") or "2021")

    author_prefix = ", ".join(cited_authors[:2]) if cited_authors else "Author A"
    title_part = cited_title or "Substantive Scholarly Paper Title"
    venue_part = f" {cited_venue}." if cited_venue else " Proceedings."
    raw_citation = str(item.get("raw_citation") or f"{author_prefix} ({cited_year}). {title_part}.{venue_part}")

    if item.get("is_vn_legal") or is_vn_legal_reference(raw_citation):
        legal_res = verify_vn_legal_citation(
            raw_text=raw_citation,
            extracted_year=cited_year,
            extracted_venue=cited_venue,
        )
        if "R-VN-LEGAL-FABRICATED" in (legal_res.triggered_rules or []):
            return feat, RuleOutcome(
                label=ValidationLabel.SUSPECTED_HALLUCINATION,
                confidence=0.90,
                reasoning=legal_res.reasoning,
                triggered_rules=list(legal_res.triggered_rules),
                mismatched_fields=list(legal_res.mismatched_fields),
            )
        if not legal_res.is_valid:
            return feat, RuleOutcome(
                label=ValidationLabel.METADATA_ERROR,
                confidence=0.85,
                reasoning=legal_res.reasoning,
                triggered_rules=list(legal_res.triggered_rules),
                mismatched_fields=list(legal_res.mismatched_fields),
            )
        return feat, RuleOutcome(
            label=ValidationLabel.RESOURCE,
            confidence=0.95,
            reasoning=legal_res.reasoning,
            triggered_rules=list(legal_res.triggered_rules),
            mismatched_fields=[],
        )

    has_cand = bool(item.get("has_candidate", True))
    doi_ok = bool(item.get("doi_exact_match", False))
    cand_doi = item.get("cand_doi") or ("10.1000/cand" if doi_ok else None)
    cited_doi = item.get("cited_doi") or (cand_doi if doi_ok else None)
    crossref_ok = bool(item.get("crossref_matched", bool(cand_doi)))

    source_pool = (
        ("crossref", "openalex", "datacite", "dblp", "arxiv")
        if crossref_ok
        else ("openalex", "dblp", "arxiv", "datacite", "doaj")
    )
    cands: list[SourceCandidate] = []
    queried_sources = ["crossref", "openalex", "datacite", "arxiv", "dblp"]
    failed_sources: dict[str, str] = {}
    ext_ids = {"is_retracted": "true"} if is_retracted else {}

    cand_abstract = item.get("cand_abstract")
    if not cand_abstract and item.get("has_abstract", True) and (
        feat.content_alignment_score > 0.0 or feat.stance_label == "contradiction_risk"
    ):
        cand_abstract = (
            "Substantive scholarly abstract text provided for semantic alignment evaluation "
            "and claim grounding verification."
        )

    if has_cand:
        n_cands = max(1, int(item.get("source_consensus", 1)))
        for c_idx in range(n_cands):
            cands.append(
                SourceCandidate(
                    source_name=source_pool[c_idx % len(source_pool)],
                    found=True,
                    title=cand_title,
                    authors=cand_authors,
                    year=cand_year,
                    venue=cand_venue,
                    doi=cand_doi,
                    abstract=cand_abstract,
                    external_ids=dict(ext_ids),
                    confidence=0.95,
                    score=0.95,
                )
            )
        if doi_ra_status == "registered_no_csl" and cited_doi:
            ra_err = f"DOI RA: CSL metadata unavailable for '{cited_doi}' (RA=JaLC)"
            queried_sources = ["crossref", "openalex", "doi_ra", "dblp"]
            failed_sources["doi_ra"] = ra_err
    elif doi_ra_status == "registered_no_csl" and cited_doi:
        ra_err = f"DOI RA: CSL metadata unavailable for '{cited_doi}' (RA=JaLC)"
        cands.append(
            SourceCandidate(
                source_name="doi_ra",
                found=False,
                doi=cited_doi,
                url=f"https://doi.org/{cited_doi}",
                external_ids={
                    "doi": cited_doi,
                    "doi_ra": "JaLC",
                    "doi_ra_status": "registered_no_csl",
                },
                error=ra_err,
            )
        )
        queried_sources = ["crossref", "openalex", "doi_ra"]
        failed_sources = {
            "crossref": "Crossref: no results for query",
            "openalex": "OpenAlex: no results for query",
            "doi_ra": ra_err,
        }
    elif api_exhausted:
        queried_sources = ["crossref", "openalex", "dblp"]
        failed_sources = {
            "crossref": "Crossref: HTTP 429 rate limit backoff",
            "openalex": "OpenAlex: HTTP 429 rate limit exceeded",
            "dblp": "DBLP: no results for query",
        }
    else:
        failed_sources = {
            "crossref": "Crossref: no results for query",
            "openalex": "OpenAlex: no results for query",
        }

    succeeded_sources = [c.source_name for c in cands if c.found] if has_cand else []
    source = SourceResult(
        citation_raw=raw_citation,
        candidates=cands,
        sources_queried=queried_sources,
        sources_succeeded=succeeded_sources,
        sources_failed=failed_sources,
        api_exhausted=api_exhausted,
        url_status=item.get("url_status"),
        url_status_code=item.get("url_status_code"),
        is_retracted=is_retracted,
    )
    cited_url = item.get("cited_url") or (
        "http://example.com/fake-paper" if item.get("url_status") == "fake_domain" else None
    )
    outcome = rules.apply(
        feat,
        source,
        api_exhausted=api_exhausted,
        citation_doi=cited_doi,
        citation_url=cited_url,
        citation_authors=(
            cited_authors
            if cited_authors is not None
            else (["Author A"] if feat.author_jaccard < 0.4 else None)
        ),
        citation_year=cited_year,
        citation_raw=raw_citation,
        citation_venue=cited_venue,
        citation_title=cited_title,
    )
    return feat, outcome


class BaselineRunner:
    """Thực thi và đánh giá các baseline đối chứng trên tập mẫu trích dẫn."""

    ALIASES: dict[str, str] = {
        "B0": "B0",
        "doi_only": "B0",
        "B1": "B1",
        "single_source_crossref": "B1",
        "B2": "B2",
        "fuzzy_only": "B2",
        "B3": "B3",
        "embedding_only": "B3",
        "B4": "B4",
        "no_calibration": "B4",
        "B5": "B5",
        "ml_hybrid": "B5",
        "proposed": "proposed",
    }

    def __init__(
        self,
        ml_scorer: HybridMLScorer | None = None,
        symbolic_rules: SymbolicRules | None = None,
    ) -> None:
        self.ml_scorer = ml_scorer or HybridMLScorer.load_default()
        self.symbolic_rules = symbolic_rules or SymbolicRules()
        self.available_baselines = [
            "B0",
            "B1",
            "B2",
            "B3",
            "B4",
            "B5",
            "proposed",
            "doi_only",
            "single_source_crossref",
            "fuzzy_only",
            "embedding_only",
            "no_calibration",
            "ml_hybrid",
        ]

    @staticmethod
    def _extract_features(item: Any) -> dict[str, Any]:
        """Chuẩn hóa mẫu đầu vào (dict hoặc CitationVerdict) về dict đặc trưng."""
        if isinstance(item, dict):
            features = item.get("features") or item
            has_full_record = any(
                k in item for k in ("cited_title", "cand_title", "raw_citation", "is_vn_legal")
            )
            raw_yd_dict = features.get("year_distance", item.get("year_distance", 999))
            return {
                "id": item.get("id") or item.get("citation_id"),
                "true_label": item.get("true_label") or item.get("gold_label") or item.get("label"),
                "doi_exact_match": bool(features.get("doi_exact_match", item.get("doi_exact_match", False))),
                "title_sim_fuzzy": float(features.get("title_sim_fuzzy", item.get("title_sim_fuzzy", 0.0)) or 0.0),
                "title_sim_semantic": float(features.get("title_sim_semantic", item.get("title_sim_semantic", 0.0)) or 0.0),
                "author_jaccard": float(features.get("author_jaccard", item.get("author_jaccard", 0.0)) or 0.0),
                "year_distance": int(raw_yd_dict if raw_yd_dict is not None else 999),
                "source_consensus": int(features.get("source_consensus", item.get("source_consensus", 0)) or 0),
                "venue_sim": float(features.get("venue_sim", item.get("venue_sim", 0.0)) or 0.0),
                "content_alignment_score": float(features.get("content_alignment_score", item.get("content_alignment_score", 0.0)) or 0.0),
                "content_alignment_confidence": str(features.get("content_alignment_confidence", item.get("content_alignment_confidence", "")) or ""),
                "content_is_aligned": bool(features.get("content_is_aligned", item.get("content_is_aligned", False))),
                "stance_label": str(features.get("stance_label", item.get("stance_label", "")) or ""),
                "has_candidate": features.get("has_candidate", item.get("has_candidate")),
                "url_status": features.get("url_status", item.get("url_status")),
                "cited_doi": features.get("cited_doi", item.get("cited_doi")),
                "api_exhausted": bool(features.get("api_exhausted", item.get("api_exhausted", False))),
                "doi_ra_status": features.get("doi_ra_status", item.get("doi_ra_status")),
                "is_retracted": bool(features.get("is_retracted", item.get("is_retracted", False))),
                "crossref_matched": bool(
                    features.get("crossref_matched", item.get("crossref_matched", False))
                    or any(
                        (s.get("source") if isinstance(s, dict) else getattr(s, "source", "")) == "crossref"
                        for s in (features.get("matched_sources") or item.get("matched_sources") or [])
                    )
                ),
                "_raw_record": item if has_full_record else None,
            }

        feat_obj = getattr(item, "features", None)
        matched_source_raw = getattr(item, "matched_source", None)
        has_candidate: bool | None = None
        url_status: str | None = getattr(item, "url_status", None)
        crossref_matched = False

        if matched_source_raw is not None:
            if hasattr(matched_source_raw, "sources_succeeded") or hasattr(
                matched_source_raw, "candidates"
            ):
                cands = getattr(matched_source_raw, "candidates", None) or []
                succeeded = getattr(matched_source_raw, "sources_succeeded", None) or []
                has_candidate = any(getattr(c, "found", False) for c in cands)
                url_status = url_status or getattr(matched_source_raw, "url_status", None)
                crossref_matched = ("crossref" in succeeded) or any(
                    getattr(c, "found", False) and getattr(c, "source_name", "") == "crossref"
                    for c in cands
                )
            else:
                matched_list = (
                    matched_source_raw
                    if isinstance(matched_source_raw, list)
                    else [matched_source_raw]
                )
                has_candidate = len(matched_list) > 0
                crossref_matched = any(
                    (s.get("source") if isinstance(s, dict) else getattr(s, "source", ""))
                    == "crossref"
                    for s in matched_list
                )

        if not crossref_matched:
            extra_sources = getattr(item, "matched_sources", None) or []
            crossref_matched = any(
                (s.get("source") if isinstance(s, dict) else getattr(s, "source", "")) == "crossref"
                for s in extra_sources
            )

        label_val = getattr(item, "label", None)
        if hasattr(label_val, "value"):
            label_val = label_val.value

        citation_obj = getattr(item, "citation", None)
        cited_doi = getattr(item, "cited_doi", None) or getattr(citation_obj, "doi", None)
        raw_yd = getattr(feat_obj, "year_distance", 999)
        api_exhausted = bool(
            getattr(item, "api_exhausted", False)
            or getattr(feat_obj, "api_exhausted", False)
            or getattr(matched_source_raw, "api_exhausted", False)
        )
        is_retracted_obj = bool(
            getattr(item, "is_retracted", False)
            or getattr(matched_source_raw, "is_retracted", False)
            or (
                hasattr(matched_source_raw, "has_retracted_candidate")
                and matched_source_raw.has_retracted_candidate()
            )
        )
        doi_ra_status = getattr(feat_obj, "doi_ra_status", None) or None
        if not doi_ra_status and matched_source_raw is not None and hasattr(matched_source_raw, "candidates"):
            from integrity_checker.logic.rules import _extract_registered_no_csl_ra

            if _extract_registered_no_csl_ra(matched_source_raw):
                doi_ra_status = "registered_no_csl"

        synthesized_raw_rec: dict[str, Any] | None = None
        if citation_obj is not None and hasattr(matched_source_raw, "candidates"):
            best_c = (
                matched_source_raw.best_candidate()
                if hasattr(matched_source_raw, "best_candidate")
                else None
            )
            synthesized_raw_rec = {
                "title_sim_fuzzy": float(getattr(feat_obj, "title_sim_fuzzy", 0.0) or 0.0),
                "title_sim_semantic": float(getattr(feat_obj, "title_sim_semantic", 0.0) or 0.0),
                "author_jaccard": float(getattr(feat_obj, "author_jaccard", 0.0) or 0.0),
                "year_distance": int(raw_yd if raw_yd is not None else 999),
                "doi_exact_match": bool(getattr(feat_obj, "doi_exact_match", False)),
                "source_consensus": int(getattr(feat_obj, "source_consensus", 0) or 0),
                "venue_sim": float(getattr(feat_obj, "venue_sim", 0.0) or 0.0),
                "content_alignment_score": float(getattr(feat_obj, "content_alignment_score", 0.0) or 0.0),
                "content_alignment_confidence": str(getattr(feat_obj, "content_alignment_confidence", "") or ""),
                "content_is_aligned": bool(getattr(feat_obj, "content_is_aligned", False)),
                "stance_label": str(getattr(feat_obj, "stance_label", "") or ""),
                "context_source": str(getattr(feat_obj, "context_source", "") or ""),
                "api_exhausted": api_exhausted,
                "doi_ra_status": doi_ra_status,
                "is_retracted": is_retracted_obj,
                "has_candidate": bool(has_candidate),
                "crossref_matched": crossref_matched,
                "url_status": url_status,
                "url_status_code": getattr(matched_source_raw, "url_status_code", None),
                "raw_citation": getattr(citation_obj, "raw_text", None) or getattr(matched_source_raw, "citation_raw", None),
                "cited_title": getattr(citation_obj, "title", None),
                "cited_authors": getattr(citation_obj, "authors", None),
                "cited_year": getattr(citation_obj, "year", None),
                "cited_venue": getattr(citation_obj, "venue", None),
                "cited_doi": cited_doi,
                "cited_url": getattr(citation_obj, "url", None),
                "cand_title": getattr(best_c, "title", None) if best_c else None,
                "cand_authors": getattr(best_c, "authors", None) if best_c else None,
                "cand_year": getattr(best_c, "year", None) if best_c else None,
                "cand_venue": getattr(best_c, "venue", None) if best_c else None,
                "cand_doi": getattr(best_c, "doi", None) if best_c else None,
                "cand_abstract": getattr(best_c, "abstract", None) if best_c else None,
                "has_abstract": bool(getattr(best_c, "abstract", None)) if best_c else False,
            }

        return {
            "id": getattr(item, "citation_id", None) or getattr(citation_obj, "id", None),
            "true_label": getattr(item, "true_label", None) or label_val,
            "doi_exact_match": bool(getattr(feat_obj, "doi_exact_match", False)),
            "title_sim_fuzzy": float(getattr(feat_obj, "title_sim_fuzzy", 0.0) or 0.0),
            "title_sim_semantic": float(getattr(feat_obj, "title_sim_semantic", 0.0) or 0.0),
            "author_jaccard": float(getattr(feat_obj, "author_jaccard", 0.0) or 0.0),
            "year_distance": int(raw_yd if raw_yd is not None else 999),
            "source_consensus": int(getattr(feat_obj, "source_consensus", 0) or 0),
            "venue_sim": float(getattr(feat_obj, "venue_sim", 0.0) or 0.0),
            "content_alignment_score": float(getattr(feat_obj, "content_alignment_score", 0.0) or 0.0),
            "content_alignment_confidence": str(getattr(feat_obj, "content_alignment_confidence", "") or ""),
            "content_is_aligned": bool(getattr(feat_obj, "content_is_aligned", False)),
            "stance_label": str(getattr(feat_obj, "stance_label", "") or ""),
            "has_candidate": has_candidate,
            "url_status": url_status,
            "cited_doi": cited_doi,
            "api_exhausted": api_exhausted,
            "doi_ra_status": doi_ra_status,
            "is_retracted": is_retracted_obj,
            "crossref_matched": crossref_matched,
            "_raw_record": synthesized_raw_rec,
        }

    def _predict_single(self, canonical: str, feat: dict[str, Any]) -> str:
        """Dự đoán nhãn cho một trích dẫn theo chiến lược baseline."""
        doi_ok = feat["doi_exact_match"]
        tf = feat["title_sim_fuzzy"]
        ts = feat["title_sim_semantic"]
        aj = feat["author_jaccard"]
        yd = abs(feat["year_distance"])
        consensus = feat["source_consensus"]
        has_crossref = feat["crossref_matched"]

        if canonical == "B0":
            # B0 (doi_only): chỉ tin cậy khi DOI khớp chính xác
            return "verified" if doi_ok else "unresolved"

        if canonical == "B1":
            # B1 (single_source_crossref): chỉ kiểm tra Crossref
            if not has_crossref and not doi_ok:
                return "suspected_hallucination"
            if doi_ok or (tf >= 0.88 and aj >= 0.5 and yd <= 1):
                return "verified"
            if tf >= 0.60:
                return "metadata_error"
            return "suspected_hallucination"

        if canonical == "B2":
            # B2 (fuzzy_only): chỉ dùng lexical fuzzy title + author Jaccard
            score = 0.7 * tf + 0.3 * aj
            if score >= 0.80 and yd <= 1:
                return "verified"
            if score >= 0.55:
                return "metadata_error"
            return "suspected_hallucination"

        if canonical == "B3":
            # B3 (embedding_only): chỉ dựa trên cosine similarity ngữ nghĩa
            if ts >= 0.88:
                return "verified"
            if ts >= 0.65:
                return "metadata_error"
            return "suspected_hallucination"

        if canonical == "B4":
            # B4 (no_calibration): kết hợp đa đặc trưng nhưng tắt vùng abstention (unresolved)
            combined = max(tf, ts) * 0.65 + aj * 0.35
            if doi_ok or (combined >= 0.80 and yd <= 1):
                return "verified"
            if combined >= 0.50:
                return "metadata_error"
            return "suspected_hallucination"

        if canonical == "B5":
            # B5 (ml_hybrid): Multinomial Logistic Regression + Platt Calibration
            pred_label, _, _ = self.ml_scorer.predict(feat)
            return pred_label

        # proposed: Full production SymbolicRules (+ VNLegalVerifier) when full record metadata is present,
        # falling back to feature-level rule projection for bare feature-vector unit tests.
        raw_rec = feat.get("_raw_record")
        if isinstance(raw_rec, dict):
            _, outcome = evaluate_symbolic_record(self.symbolic_rules, raw_rec)
            return outcome.label.value

        title_best = max(tf, ts)
        ca_score = feat.get("content_alignment_score", 0.0)
        ca_aligned = feat.get("content_is_aligned", False)
        stance_lbl = feat.get("stance_label", "")
        venue_sim = float(feat.get("venue_sim", 0.0) or 0.0)
        url_status = feat.get("url_status")
        cited_doi = feat.get("cited_doi")
        has_cand = feat.get("has_candidate")
        api_exhausted = bool(feat.get("api_exhausted", False))
        doi_ra_status = feat.get("doi_ra_status")
        is_retracted = bool(feat.get("is_retracted", False))

        # Pre-flight & hard symbolic guardrails (retraction, fake URL, dead URL, non-existent DOI)
        if url_status == "fake_domain":
            return "suspected_hallucination"
        if is_retracted and (doi_ok or title_best >= 0.60):
            return "metadata_error"
        if doi_ra_status == "registered_no_csl" and cited_doi and not doi_ok and title_best < 0.60:
            return "unresolved"
        if cited_doi and not doi_ok and title_best < 0.60:
            return "suspected_hallucination"
        if url_status == "dead_link" and not doi_ok and title_best < 0.60:
            if title_best >= 0.35 and consensus >= 1 and aj >= 0.15 and yd <= 4:
                return "metadata_error"
            return "suspected_hallucination"
        if has_cand is False and api_exhausted:
            return "unresolved"
        if doi_ok and (
            (title_best < 0.35 and aj < 0.20)
            or (tf < 0.25 and ts < 0.45)
            or (aj == 0.0 and tf < 0.45 and ts < 0.58 and venue_sim < 0.25)
        ):
            return "suspected_hallucination"

        # Content alignment contradiction check (R-CONTENT-MISMATCH; preserves Rule 3b [0.25, 0.50) guard)
        if (not ca_aligned or stance_lbl == "contradiction_risk") and (
            stance_lbl == "contradiction_risk" or (0.0 < ca_score < 0.25 and tf >= 0.85)
        ) and tf >= 0.75 and aj >= 0.25 and (yd <= 1 or yd >= 900):
            if title_best >= 0.85 or consensus >= 2 or aj >= 0.75:
                return "metadata_error"
            return "suspected_hallucination"

        # Content alignment rescue check (R-CONTENT-ALIGNMENT)
        if (
            ca_aligned
            and stance_lbl != "contradiction_risk"
            and ca_score >= 0.60
            and tf >= 0.60
            and aj >= 0.50
            and (yd <= 1 or yd >= 900)
            and consensus >= 2
        ):
            return "verified"

        if doi_ok and title_best >= 0.90 and aj >= 0.50 and (yd <= 1 or yd >= 900):
            return "verified"
        if title_best >= 0.90 and aj >= 0.50 and (yd <= 1 or yd >= 900) and consensus >= 2:
            return "verified"
        if tf >= 0.90 and aj >= 0.80 and (yd <= 1 or yd >= 900) and consensus >= 1:
            return "verified"
        if doi_ok and title_best < 0.90:
            return "metadata_error"
        if title_best >= 0.60 and (aj < 0.50 or (1 < yd < 900) or title_best < 0.90):
            return "metadata_error"
        if 0.42 <= title_best < 0.60 and yd <= 2 and (
            (consensus >= 2 and aj >= 0.75) or (aj >= 0.85 and yd <= 1 and tf >= 0.52)
        ):
            return "metadata_error"
        if (
            0.42 <= title_best < 0.60
            and consensus >= 2
            and aj > 0.0
            and yd < 900
            and ((2 <= yd <= 4 and tf >= 0.58) or (yd <= 4 and aj < 0.20 and tf >= 0.58))
        ):
            return "metadata_error"
        is_sem_noise = tf < 0.65 and aj == 0.0 and not doi_ok and consensus <= 1
        if 0.40 <= title_best < 0.60 and not is_sem_noise:
            return "unresolved"
        if has_cand is not False and not doi_ok and aj >= 0.18 and yd <= 3 and 0.25 <= title_best < 0.60:
            return "unresolved"
        return "suspected_hallucination"

    def run(self, baseline: str, dataset: list[Any]) -> dict[str, Any]:
        """Trả dict kết quả dự đoán và metrics cho baseline được chọn."""
        if baseline not in self.ALIASES:
            raise ValueError(
                f"Unknown baseline '{baseline}'. Available: {self.available_baselines}"
            )

        canonical = self.ALIASES[baseline]
        predictions: list[str] = []
        gold_labels: list[str] = []
        items_out: list[dict[str, Any]] = []

        for idx, raw_item in enumerate(dataset):
            feat = self._extract_features(raw_item)
            pred = self._predict_single(canonical, feat)
            predictions.append(pred)
            if feat["true_label"] in MetricsCalculator.LABELS:
                gold_labels.append(feat["true_label"])
            items_out.append(
                {
                    "id": feat["id"] if feat["id"] is not None else idx,
                    "predicted_label": pred,
                    "true_label": feat["true_label"],
                }
            )

        metrics_dict: dict[str, Any] | None = None
        if len(gold_labels) == len(predictions) and len(predictions) > 0:
            metrics_dict = asdict(MetricsCalculator.compute(gold_labels, predictions))

        return {
            "baseline": baseline,
            "canonical_baseline": canonical,
            "num_samples": len(predictions),
            "predictions": predictions,
            "items": items_out,
            "metrics": metrics_dict,
        }
