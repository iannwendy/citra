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
from integrity_checker.logic.calibration import HybridMLScorer


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

    def __init__(self, ml_scorer: HybridMLScorer | None = None) -> None:
        self.ml_scorer = ml_scorer or HybridMLScorer.load_default()
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
            return {
                "id": item.get("id") or item.get("citation_id"),
                "true_label": item.get("true_label") or item.get("gold_label") or item.get("label"),
                "doi_exact_match": bool(features.get("doi_exact_match", item.get("doi_exact_match", False))),
                "title_sim_fuzzy": float(features.get("title_sim_fuzzy", item.get("title_sim_fuzzy", 0.0)) or 0.0),
                "title_sim_semantic": float(features.get("title_sim_semantic", item.get("title_sim_semantic", 0.0)) or 0.0),
                "author_jaccard": float(features.get("author_jaccard", item.get("author_jaccard", 0.0)) or 0.0),
                "year_distance": int(features.get("year_distance", item.get("year_distance", 0)) if features.get("year_distance", item.get("year_distance", 0)) is not None else 0),
                "source_consensus": int(features.get("source_consensus", item.get("source_consensus", 0)) or 0),
                "venue_sim": float(features.get("venue_sim", item.get("venue_sim", 0.0)) or 0.0),
                "content_alignment_score": float(features.get("content_alignment_score", item.get("content_alignment_score", 0.0)) or 0.0),
                "content_alignment_confidence": str(features.get("content_alignment_confidence", item.get("content_alignment_confidence", "")) or ""),
                "content_is_aligned": bool(features.get("content_is_aligned", item.get("content_is_aligned", False))),
                "has_candidate": features.get("has_candidate", item.get("has_candidate")),
                "url_status": features.get("url_status", item.get("url_status")),
                "cited_doi": features.get("cited_doi", item.get("cited_doi")),
                "crossref_matched": bool(
                    features.get("crossref_matched", item.get("crossref_matched", False))
                    or any(
                        (s.get("source") if isinstance(s, dict) else getattr(s, "source", "")) == "crossref"
                        for s in (features.get("matched_sources") or item.get("matched_sources") or [])
                    )
                ),
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
        raw_yd = getattr(feat_obj, "year_distance", 0)

        return {
            "id": getattr(item, "citation_id", None) or getattr(citation_obj, "id", None),
            "true_label": getattr(item, "true_label", None) or label_val,
            "doi_exact_match": bool(getattr(feat_obj, "doi_exact_match", False)),
            "title_sim_fuzzy": float(getattr(feat_obj, "title_sim_fuzzy", 0.0) or 0.0),
            "title_sim_semantic": float(getattr(feat_obj, "title_sim_semantic", 0.0) or 0.0),
            "author_jaccard": float(getattr(feat_obj, "author_jaccard", 0.0) or 0.0),
            "year_distance": int(raw_yd if raw_yd is not None else 0),
            "source_consensus": int(getattr(feat_obj, "source_consensus", 0) or 0),
            "venue_sim": float(getattr(feat_obj, "venue_sim", 0.0) or 0.0),
            "content_alignment_score": float(getattr(feat_obj, "content_alignment_score", 0.0) or 0.0),
            "content_alignment_confidence": str(getattr(feat_obj, "content_alignment_confidence", "") or ""),
            "content_is_aligned": bool(getattr(feat_obj, "content_is_aligned", False)),
            "has_candidate": has_candidate,
            "url_status": url_status,
            "cited_doi": cited_doi,
            "crossref_matched": crossref_matched,
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

        # proposed: Neuro-symbolic + multi-source consensus + content alignment + link check + abstention calibration
        title_best = max(tf, ts)
        ca_score = feat.get("content_alignment_score", 0.0)
        ca_conf = feat.get("content_alignment_confidence", "")
        ca_aligned = feat.get("content_is_aligned", False)
        url_status = feat.get("url_status")
        cited_doi = feat.get("cited_doi")

        # Pre-flight & hard symbolic guardrails (fake URL, dead URL with low title, non-existent DOI)
        if url_status == "fake_domain":
            return "suspected_hallucination"
        if cited_doi and not doi_ok and title_best < 0.60:
            return "suspected_hallucination"
        if url_status == "dead_link" and not doi_ok and title_best < 0.60:
            return "suspected_hallucination"

        # Content alignment contradiction check (R-CONTENT-MISMATCH)
        # Decision-support guardrail: strongly matched real papers (title >= 0.85, author >= 0.50, yd <= 1)
        # route to metadata_error rather than suspected_hallucination.
        if not ca_aligned and ca_score >= 0.30 and tf >= 0.75 and aj >= 0.50 and not doi_ok and consensus <= 1:
            if title_best >= 0.85 and yd <= 1:
                return "metadata_error"
            return "suspected_hallucination"
        if ca_conf == "high" and not ca_aligned and 0.0 < ca_score < 0.25 and title_best >= 0.85:
            return "metadata_error"

        # Content alignment rescue check (R-CONTENT-ALIGNMENT)
        if ca_aligned and ca_score >= 0.60 and tf >= 0.60 and aj >= 0.50 and yd <= 1 and consensus >= 2:
            return "verified"

        if doi_ok and title_best >= 0.85 and yd <= 1:
            return "verified"
        if title_best >= 0.85 and aj >= 0.50 and yd <= 1 and consensus >= 1:
            return "verified"
        if doi_ok and title_best < 0.85:
            return "metadata_error"
        if title_best >= 0.60 and (aj < 0.50 or yd > 1 or title_best < 0.85):
            return "metadata_error"
        if 0.40 <= title_best < 0.60:
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
