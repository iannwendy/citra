"""ExplanationGenerator — sinh giải thích natural-language cho giảng viên.

Vietnamese explanations với structured format cho cả 2 lớp:
    - Citation Integrity (mapping status)
    - Source Verification (validation label)
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from integrity_checker.models.validation import CitationVerdict, ValidationLabel

if TYPE_CHECKING:
    pass


class ExplanationGenerator:
    """Tạo câu giải thích ngắn cho mỗi verdict, phù hợp UI + report.

    Output format: "Nhãn: [X]. Lý do: [Y]. Bằng chứng: [Z]."
    """

    # --- ValidationLabel translations ---
    LABEL_VI = {
        ValidationLabel.VERIFIED: "xác minh được",
        ValidationLabel.METADATA_ERROR: "có lỗi metadata",
        ValidationLabel.SUSPECTED_HALLUCINATION: "nghi ngờ ảo giác",
        ValidationLabel.UNRESOLVED: "chưa đủ bằng chứng",
        ValidationLabel.RESOURCE: "tài nguyên tham khảo",
    }

    LABEL_VI_LONG = {
        ValidationLabel.VERIFIED: "Nguồn được xác minh",
        ValidationLabel.METADATA_ERROR: "Nguồn có lỗi metadata",
        ValidationLabel.SUSPECTED_HALLUCINATION: "Nghi ngờ ảo giác nguồn",
        ValidationLabel.UNRESOLVED: "Chưa đủ bằng chứng",
        ValidationLabel.RESOURCE: "Tài nguyên web/pháp lý",
    }

    # --- MappingStatus translations ---
    MAPPING_VI = {
        "matched": "khớp",
        "missing_reference": "thiếu reference",
        "uncited_reference": "reference không được trích",
        "in_text_mismatch": "in-text không khớp",
        "duplicate_reference": "reference trùng lặp",
        "ambiguous_mapping": "ánh xạ mơ hồ",
        "style_inconsistent": "style không nhất quán",
        "unresolved": "chưa xác định",
    }

    MAPPING_VI_LONG = {
        "matched": "In-text và reference entry khớp nhau",
        "missing_reference": "In-text không có reference entry tương ứng trong danh mục",
        "uncited_reference": "Reference entry không được in-text nào trích dẫn",
        "in_text_mismatch": "In-text và reference entry không khớp (author/year đúng nhưng title khác)",
        "duplicate_reference": "Nhiều reference entry trỏ cùng một nguồn",
        "ambiguous_mapping": "Nhiều in-text trỏ cùng một reference entry",
        "style_inconsistent": "Style trích dẫn không nhất quán trong tài liệu",
        "unresolved": "Chưa đủ thông tin để xác định",
    }

    # --- Evidence templates ---
    @classmethod
    def _format_evidence(cls, verdict: CitationVerdict) -> str:
        """Format evidence details từ verdict."""
        parts = []

        # Confidence
        parts.append(f"confidence={verdict.confidence:.0%}")

        # Features
        if verdict.features:
            f = verdict.features
            if f.title_sim_fuzzy > 0:
                parts.append(f"title_sim={f.title_sim_fuzzy:.2f}")
            if f.author_jaccard > 0:
                parts.append(f"author_match={f.author_jaccard:.2f}")
            if f.doi_exact_match:
                parts.append("DOI_exact_match=true")
            if f.source_consensus > 0:
                parts.append(f"consensus={f.source_consensus}")

        # Triggered rules
        if verdict.triggered_rules:
            parts.append(f"rules=[{', '.join(verdict.triggered_rules)}]")

        # Mismatched fields
        if verdict.mismatched_fields:
            parts.append(f"fields_lệch=[{', '.join(verdict.mismatched_fields)}]")

        return ", ".join(parts)

    @classmethod
    def _get_matched_source_info(cls, verdict: CitationVerdict) -> str:
        """Get formatted matched source info."""
        if not verdict.matched_source:
            return "Không có candidate"

        best = verdict.matched_source.best_candidate()
        if not best:
            return "Không tìm thấy candidate nào"

        parts = [f"Nguồn: {best.source_name}"]
        if best.title:
            parts.append(f"title='{best.title[:60]}{'...' if len(best.title) > 60 else ''}'")
        if best.year:
            parts.append(f"year={best.year}")
        if best.venue:
            parts.append(f"venue={best.venue}")
        if best.cached:
            parts.append("(từ local DB)")

        return ", ".join(parts)

    # --- Source Verification Suggestions ---
    SOURCE_SUGGESTIONS = {
        ValidationLabel.VERIFIED: [
            "Nguồn đã được xác minh — không cần hành động thêm.",
        ],
        ValidationLabel.METADATA_ERROR: [
            "Kiểm tra lại các trường bị lệch trong reference list.",
            "Đề nghị sinh viên cung cấp bản PDF nguồn gốc.",
        ],
        ValidationLabel.SUSPECTED_HALLUCINATION: [
            "Không tìm thấy nguồn trên Crossref, OpenAlex, DBLP, arXiv, OpenLibrary, Europe PMC.",
            "Cần giảng viên kiểm tra thủ công.",
            "Đề nghị sinh viên cung cấp URL/DOI bản gốc.",
        ],
        ValidationLabel.UNRESOLVED: [
            "Hệ thống chưa đủ bằng chứng để kết luận.",
            "Có thể thử lại sau khi nguồn được cập nhật hoặc cung cấp thêm DOI.",
        ],
        ValidationLabel.RESOURCE: [
            "Đây là URL/Reference link — không phải academic citation.",
            "Không cần xác minh trên scholarly databases.",
        ],
    }

    # --- Mapping Suggestions ---
    MAPPING_SUGGESTIONS = {
        "matched": [
            "Liên kết đã khớp — không cần hành động thêm.",
        ],
        "missing_reference": [
            "Yêu cầu sinh viên bổ sung reference entry cho trích dẫn này.",
            "Hoặc kiểm tra lại xem có lỗi đánh máy trong in-text không.",
        ],
        "uncited_reference": [
            "Kiểm tra xem reference này có thực sự được sử dụng không.",
            "Có thể cần xóa reference entry nếu không liên quan.",
        ],
        "in_text_mismatch": [
            "So sánh nội dung in-text với reference entry để xác định nguồn đúng.",
            "Có thể sinh viên trích dẫn nhầm sang nguồn khác.",
        ],
        "duplicate_reference": [
            "Gộp các reference trùng lặp thành một entry.",
            "Đảm bảo tất cả in-text trỏ đến cùng một entry sau khi gộp.",
        ],
        "ambiguous_mapping": [
            "Cần giảng viên xác định in-text nào trỏ đến reference nào.",
            "Có thể cần hỏi sinh viên để làm rõ.",
        ],
        "style_inconsistent": [
            "Kiểm tra xem tài liệu có copy từ nhiều nguồn với style khác nhau không.",
            "Có thể cần chuẩn hóa lại toàn bộ citation style.",
        ],
        "unresolved": [
            "Hệ thống chưa đủ thông tin để liên kết.",
            "Có thể thử lại sau khi có thêm thông tin từ sinh viên.",
        ],
    }

    # --- Combined Short Message ---
    @classmethod
    def short(cls, verdict: CitationVerdict) -> str:
        """One-liner tiếng Việt cho UI.

        Format: "Nhãn: [X] (confidence=Y%)."
        """
        vi_label = cls.LABEL_VI_LONG.get(verdict.label, str(verdict.label))
        mapping = cls._get_mapping_short(verdict)
        if mapping:
            return f"{vi_label} | {mapping} (confidence={verdict.confidence:.0%})"
        return f"{vi_label} (confidence={verdict.confidence:.0%})"

    @classmethod
    def _get_mapping_short(cls, verdict: CitationVerdict) -> str:
        """Get short mapping status string."""
        if verdict.mapping_status is None:
            return ""
        status = verdict.mapping_status
        if hasattr(status, "value"):
            status = status.value
        return cls.MAPPING_VI.get(str(status), str(status))

    # --- Combined Detailed Explanation ---
    @classmethod
    def detailed(cls, verdict: CitationVerdict) -> str:
        """Multi-line explanation cho report.

        Format:
        Nhãn: [X]. Lý do: [Y]. Bằng chứng: [Z].
        Mapping: [mapping_status]. Evidence: [details].
        Nguồn: [source_info].
        """
        lines = []

        # Header: Nhãn + confidence
        vi_label = cls.LABEL_VI_LONG.get(verdict.label, str(verdict.label))
        lines.append(f"Nhãn: {vi_label} (confidence={verdict.confidence:.0%}).")

        # Lý do
        reasoning = verdict.reasoning or cls._default_reasoning(verdict)
        lines.append(f"Lý do: {reasoning}")

        # Bằng chứng
        evidence = cls._format_evidence(verdict)
        lines.append(f"Bằng chứng: {evidence}.")

        # Mapping status
        mapping_line = cls._format_mapping(verdict)
        if mapping_line:
            lines.append(mapping_line)

        # Nguồn info
        source_info = cls._get_matched_source_info(verdict)
        lines.append(f"Nguồn: {source_info}.")

        return "\n".join(lines)

    @classmethod
    def _default_reasoning(cls, verdict: CitationVerdict) -> str:
        """Generate default reasoning dựa trên verdict."""
        label = verdict.label

        if label == ValidationLabel.VERIFIED:
            return "Nguồn tồn tại trên các cơ sở dữ liệu học thuật và metadata khớp."

        if label == ValidationLabel.METADATA_ERROR:
            mismatched = verdict.mismatched_fields or []
            if mismatched:
                return f"Các trường {', '.join(mismatched)} không khớp với nguồn tìm được."
            return "Nguồn tìm được nhưng metadata không hoàn toàn khớp."

        if label == ValidationLabel.SUSPECTED_HALLUCINATION:
            if verdict.matched_source:
                sources_tried = verdict.matched_source.sources_queried
                return (
                    f"Không tìm thấy nguồn sau khi thử {len(sources_tried)} chiến lược "
                    f"trên {', '.join(sources_tried) if sources_tried else 'các nguồn'}."
                )
            return "Không tìm thấy nguồn trên Crossref, OpenAlex, DBLP, arXiv, OpenLibrary, Europe PMC."

        if label == ValidationLabel.UNRESOLVED:
            if verdict.matched_source:
                failed = verdict.matched_source.sources_failed
                if failed:
                    sources_failed = list(failed.keys())
                    return (
                        f"Các nguồn {', '.join(sources_failed)} không phản hồi hoặc lỗi. "
                        f"Chưa đủ bằng chứng để kết luận."
                    )
            return "Chưa đủ bằng chứng để đưa ra kết luận."

        return verdict.reasoning or "Không có thông tin bổ sung."

    @classmethod
    def _format_mapping(cls, verdict: CitationVerdict) -> str:
        """Format mapping status details."""
        if verdict.mapping_status is None:
            return ""

        status = verdict.mapping_status
        if hasattr(status, "value"):
            status_str = status.value
            status_label = status.label if hasattr(status, "label") else cls.MAPPING_VI_LONG.get(status_str, status_str)
        else:
            status_str = str(status)
            status_label = cls.MAPPING_VI_LONG.get(status_str, status_str)

        parts = [f"Mapping: {status_label}"]

        # Add confidence if available
        if verdict.mapping_confidence > 0:
            parts.append(f"(confidence={verdict.mapping_confidence:.0%})")

        # Add citation link info if available
        if verdict.citation_link and hasattr(verdict.citation_link, "method"):
            method = verdict.citation_link.method
            if hasattr(method, "value"):
                parts.append(f"method={method.value}")

        # Add page/section if available
        if verdict.citation_link:
            link = verdict.citation_link
            if link.page > 0:
                parts.append(f"trang={link.page}")
            if link.section:
                parts.append(f"section={link.section}")

        return " ".join(parts) + "."

    # --- Suggestions ---
    @classmethod
    def suggestions(cls, verdict: CitationVerdict) -> list[str]:
        """Gợi ý hành động cho giảng viên (cả 2 lớp)."""
        suggestions = []

        # Source verification suggestions
        source_suggestions = cls.SOURCE_SUGGESTIONS.get(verdict.label, [])
        suggestions.extend(source_suggestions)

        # Mapping status suggestions
        if verdict.mapping_status is not None:
            status = verdict.mapping_status
            if hasattr(status, "value"):
                status_str = status.value
            else:
                status_str = str(status)
            mapping_suggestions = cls.MAPPING_SUGGESTIONS.get(status_str, [])
            suggestions.extend(mapping_suggestions)

        return suggestions

    # --- Structured Output for UI ---
    @classmethod
    def structured(cls, verdict: CitationVerdict) -> dict:
        """Return structured dict cho UI components.

        Returns:
            {
                "label": str,
                "label_vi": str,
                "label_color": str,
                "mapping_status": str,
                "mapping_status_vi": str,
                "mapping_color": str,
                "confidence": float,
                "mapping_confidence": float,
                "reasoning": str,
                "evidence": dict,
                "source_info": str,
                "suggestions": list[str],
                "formatted": {
                    "short": str,
                    "detailed": str,
                }
            }
        """

        # Get label color
        label_color = verdict.label.color if hasattr(verdict.label, "color") else "#6b7280"

        # Get mapping status and color
        mapping_status = None
        mapping_status_vi = ""
        mapping_color = "#6b7280"

        if verdict.mapping_status is not None:
            status = verdict.mapping_status
            if hasattr(status, "value"):
                mapping_status = status.value
            else:
                mapping_status = str(status)
            mapping_status_vi = cls.MAPPING_VI_LONG.get(mapping_status, mapping_status)

            # Mapping colors
            MAPPING_COLORS = {
                "matched": "#16a34a",  # green
                "missing_reference": "#dc2626",  # red
                "uncited_reference": "#f97316",  # orange
                "in_text_mismatch": "#ca8a04",  # yellow
                "duplicate_reference": "#a855f7",  # purple
                "ambiguous_mapping": "#eab308",  # yellow
                "style_inconsistent": "#64748b",  # slate
                "unresolved": "#6b7280",  # gray
            }
            mapping_color = MAPPING_COLORS.get(mapping_status, "#6b7280")

        # Evidence dict
        evidence = {}
        if verdict.features:
            f = verdict.features
            evidence = {
                "title_sim_fuzzy": f.title_sim_fuzzy,
                "title_sim_semantic": f.title_sim_semantic,
                "author_jaccard": f.author_jaccard,
                "year_distance": f.year_distance,
                "doi_exact_match": f.doi_exact_match,
                "source_consensus": f.source_consensus,
            }
        if verdict.triggered_rules:
            evidence["triggered_rules"] = verdict.triggered_rules
        if verdict.mismatched_fields:
            evidence["mismatched_fields"] = verdict.mismatched_fields

        return {
            "label": verdict.label.value if hasattr(verdict.label, "value") else str(verdict.label),
            "label_vi": cls.LABEL_VI_LONG.get(verdict.label, str(verdict.label)),
            "label_color": label_color,
            "mapping_status": mapping_status,
            "mapping_status_vi": mapping_status_vi,
            "mapping_color": mapping_color,
            "confidence": verdict.confidence,
            "mapping_confidence": verdict.mapping_confidence,
            "reasoning": verdict.reasoning or cls._default_reasoning(verdict),
            "evidence": evidence,
            "source_info": cls._get_matched_source_info(verdict),
            "suggestions": cls.suggestions(verdict),
            "formatted": {
                "short": cls.short(verdict),
                "detailed": cls.detailed(verdict),
            }
        }
