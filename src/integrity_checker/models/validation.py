"""Validation models -- output của logic module (Neuro-Symbolic checker).

Bao gồm cả các model cho **bidirectional linking** (v1.2 §3.5):
    - ``CitationLink`` -- quan hệ 1 occurrence ↔ 1 reference entry.
    - ``MappingMethod`` -- cách quyết định mapping (author_year / numeric / DOI / fuzzy).

Reference:
    v1.2 §3.2.2 (mapping statuses -- tách khỏi ValidationLabel)
    v1.2 §3.5 (bidirectional linking + 7 trạng thái)
    v1.2 §5.2 (CitationLinker scaffold -- tuần 8)
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum

from integrity_checker.models.citation import Citation
from integrity_checker.models.source import SourceResult


class ValidationLabel(str, Enum):
    """Taxonomy 5 nhãn -- đề cương §5.2.

    BẮT BUỘC dùng đúng các giá trị này (lowercase) để serialize/UI.
    """

    VERIFIED = "verified"
    METADATA_ERROR = "metadata_error"
    SUSPECTED_HALLUCINATION = "suspected_hallucination"
    UNRESOLVED = "unresolved"
    RESOURCE = "resource"  # URL/Reference links, không phải academic citations

    @property
    def color(self) -> str:
        """Màu badge trên UI (hex)."""
        return {
            ValidationLabel.VERIFIED: "#16a34a",               # xanh
            ValidationLabel.METADATA_ERROR: "#ca8a04",         # vàng
            ValidationLabel.SUSPECTED_HALLUCINATION: "#dc2626",  # đỏ
            ValidationLabel.UNRESOLVED: "#6b7280",             # xám
            ValidationLabel.RESOURCE: "#8b5cf6",              # tím - URLs/Resources
        }[self]


@dataclass
class MatchFeatures:
    """Vector features so khớp giữa citation và candidate tốt nhất.

    Mọi score đều 0.0–1.0 (trừ `year_distance` là int).

    v1.3: Bổ sung semantic_content_alignment cho Neural layer.
    """

    title_sim_fuzzy: float = 0.0       # RapidFuzz token_set_ratio / 100
    title_sim_semantic: float = 0.0    # cosine similarity sentence-transformers (title only)
    author_jaccard: float = 0.0        # |A ∩ B| / |A ∪ B| trên last-name
    year_distance: int = 999           # |cited.year - candidate.year|
    doi_exact_match: bool = False      # True nếu DOI khớp 100%
    source_consensus: int = 0          # số nguồn đồng thuận (≥1)
    venue_sim: float = 0.0             # venue similarity (0.0–1.0)

    # NEW v1.3: Neural layer - content-context alignment
    content_alignment_score: float = 0.0  # Semantic similarity giữa cited context và source
    content_alignment_confidence: str = ""  # 'high', 'medium', 'low'
    content_is_aligned: bool = False   # True nếu content có semantic alignment

    # NEW v2.1: Deep Neural Semantic & Evidence Telemetry
    title_context_sim: float = 0.0          # Neural cosine similarity: cited context ↔ source title
    abstract_context_sim: float = 0.0       # Neural cosine similarity: cited context ↔ source abstract
    best_evidence_sentence: str = ""        # Top-matching sentence extracted from source abstract
    best_evidence_score: float = 0.0        # Neural similarity of best_evidence_sentence (0.0–1.0)
    best_cited_sentence: str = ""           # De-hyphenated focal sentence from student manuscript
    citation_intent: str = ""               # 'background' | 'methodology' | 'result_comparison'
    stance_label: str = ""                  # 'supported' | 'partially_supported' | 'neutral' | 'contradiction_risk'
    cross_lingual_detected: bool = False    # True when Vietnamese-to-English semantic bridging applied
    bridged_concepts: list[str] = field(default_factory=list)  # VI <-> EN academic concepts bridged
    cross_lingual_title_detected: bool = False  # True when a foreign source title was translated into Vietnamese
    cross_lingual_title_sim: float = 0.0    # Cross-lingual semantic similarity for translated titles (0.0–1.0)
    context_source: str = ""                # 'in_text_citation' | 'multi_occurrence' | 'implicit_body_discovery'
    occurrence_alignments: list[dict] = field(default_factory=list)  # Per-occurrence neural scores

    @property
    def title_sim_max(self) -> float:
        """Lấy max(fuzzy, semantic) -- dùng cho rules."""
        return max(self.title_sim_fuzzy, self.title_sim_semantic)

    @property
    def neural_content_score(self) -> float:
        """Neural layer score cho content alignment (0.0-1.0)."""
        if self.content_is_aligned:
            # Nếu aligned, dùng score thực
            return self.content_alignment_score
        # Nếu không aligned, trả về 0 (sẽ được xử lý bởi rules)
        return 0.0


@dataclass
class CitationVerdict:
    """Quyết định cuối cùng cho 1 citation -- output chính của pipeline.

    v1.2 §3.2.2 -- Tách 2 lớp:
        - ``label`` (ValidationLabel) -- nhãn nguồn (REAL / SUSPECTED_HALLUCINATION / ...).
        - ``mapping_status`` (CitationMappingStatus) -- trạng thái in-text ↔ reference
          mapping (MATCHED / MISSING_REFERENCE / UNCITED_REFERENCE / ...).

    Hai lớp này orthogonal: 1 citation có thể vừa MATCHED (link OK) vừa
    METADATA_ERROR (sai năm) -- đây là 2 chiều phân tích khác nhau.

    Attributes:
        citation: Citation gốc từ PDF.
        label: ValidationLabel (source verification -- REAL / SUSPECTED_HALLUCINATION /
            GENERATED / UNCERTAIN / UNRESOLVED).
        mapping_status: CitationMappingStatus (in-text ↔ reference integrity).
        mapping_confidence: 0.0–1.0, do CitationLinker đặt.
        citation_link: CitationLink từ CitationLinker (None nếu chưa link).
        confidence: 0.0–1.0, do NeuroSymbolicChecker đặt (source layer).
        matched_source: SourceResult từ retrieval.
        features: MatchFeatures từ FeatureCalculator.
        reasoning: giải thích cho giảng viên.
        triggered_rules: list rule IDs triggered.
        mismatched_fields: list fields không khớp (nếu METADATA_ERROR).
        is_overridden: True nếu GVHD override.
        overridden_label: label mới sau override.
        overridden_by: user id / lecturer email.
        override_note: ghi chú override.
    """

    citation: Citation
    label: ValidationLabel
    confidence: float                  # 0.0–1.0, source layer

    # NEW v1.2 §3.2.2 -- integrity layer (tách khỏi label)
    mapping_status: object = None      # CitationMappingStatus -- tránh circular import
    mapping_confidence: float = 0.0    # 0.0–1.0, integrity layer
    citation_link: object = None       # CitationLink -- tránh circular import

    # NEW v1.9 — MỌI edge của occurrence này (một occurrence có thể cite nhiều
    # reference: "[9, 10]"). ``citation_link`` chỉ là ``citation_links[0]``,
    # giữ lại để không phá consumer cũ.
    citation_links: list = field(default_factory=list)   # list[CitationLink]

    # Bằng chứng
    matched_source: SourceResult | None = None
    features: MatchFeatures = field(default_factory=MatchFeatures)

    # Giải thích cho giảng viên
    reasoning: str = ""
    triggered_rules: list[str] = field(default_factory=list)
    mismatched_fields: list[str] = field(default_factory=list)  # nếu METADATA_ERROR

    # Audit (override của giảng viên)
    is_overridden: bool = False
    overridden_label: ValidationLabel | None = None
    overridden_by: str | None = None  # user id / lecturer email
    override_note: str | None = None

    # NEW v1.3: Provenance tracking
    sources_succeeded: list[str] = field(default_factory=list)  # e.g. ["crossref", "openalex"]
    sources_failed: dict[str, str] = field(default_factory=dict)  # e.g. {"semantic_scholar": "429 Too Many Requests"}
    api_exhausted: bool = False  # True if all external APIs failed
    used_local_db: bool = False  # True if result came from local database
    style_penalty: float = 0.0
    domain_exception: bool = False
    archive_url: str | None = None
    is_retracted: bool = False


@dataclass
class CISComponents:
    """5 thành phần của Citation Integrity Score (đề cương §5.7)."""

    verified_ratio: float = 0.0          # 0–1
    metadata_accuracy: float = 0.0       # 0–1
    in_text_bib_consistency: float = 0.0  # 0–1
    format_consistency: float = 0.0       # 0–1
    identifier_validity: float = 0.0      # 0–1

    def to_dict(self) -> dict[str, float]:
        return {
            "verified_ratio": self.verified_ratio,
            "metadata_accuracy": self.metadata_accuracy,
            "in_text_bib_consistency": self.in_text_bib_consistency,
            "format_consistency": self.format_consistency,
            "identifier_validity": self.identifier_validity,
        }


@dataclass
class CitationIntegrityScore:
    """CIS = trọng số-weighted tổng của 5 components, scale 0–100.

    Lưu ý: CIS chỉ đo trích dẫn, KHÔNG phải điểm tiểu luận.
    """

    score: float  # 0–100
    components: CISComponents
    weights_used: dict[str, float]
    num_citations: int
    num_unresolved: int  # số verdict = UNRESOLVED (để minh bạch)


# --- Bidirectional linking models (v1.2 §3.5) ---


class MappingMethod(str, Enum):
    """Cách CitationLinker quyết định ánh xạ occurrence ↔ reference.

    BẮT BUỘC dùng đúng giá trị này (lowercase) -- dùng cho evidence, audit log,
    và chấm điểm confidence (mỗi method có confidence mặc định khác nhau).
    """

    # NEW v1.10: GROBID adapter — authoritative TEI link
    TEI_LINK = "tei_link"               # GROBID xml:id link (highest confidence)
    AUTHOR_YEAR = "author_year"           # APA-like (Smith, 2020)
    NUMERIC_INDEX = "numeric_index"       # IEEE-like [12]
    DOI_EXACT = "doi_exact"               # exact DOI match
    ARXIV_EXACT = "arxiv_exact"           # exact arXiv ID match
    FUZZY = "fuzzy"                       # normalized title fuzzy fallback
    NO_KEYS = "no_keys"                   # AMBIGUOUS_MAPPING
    MANUAL_REVIEW = "manual_review"       # giảng viên override

    @property
    def default_confidence(self) -> float:
        """Confidence mặc định cho mỗi method (0.0–1.0)."""
        return {
            MappingMethod.TEI_LINK: 0.98,  # GROBID authoritative link
            MappingMethod.DOI_EXACT: 0.95,
            MappingMethod.ARXIV_EXACT: 0.95,
            MappingMethod.AUTHOR_YEAR: 0.90,
            MappingMethod.NUMERIC_INDEX: 0.90,
            MappingMethod.FUZZY: 0.65,
            MappingMethod.MANUAL_REVIEW: 1.0,
            MappingMethod.NO_KEYS: 0.30,
        }[self]


@dataclass
class CitationLink:
    """Một quan hệ in-text occurrence ↔ reference entry (v1.2 §3.5).

    Mỗi ``CitationLink`` ứng với 1 mapping quyết định bởi ``CitationLinker``.
    Một in-text occurrence có thể gộp nhiều citation (e.g. (Smith, 2020; Doe, 2021))
    được tách thành nhiều CitationLink -- mỗi link ứng với 1 reference entry.

    Attributes:
        occurrence_id: id ổn định cho in-text occurrence (vd: 'occ-0001').
        reference_id: id ổn định cho reference entry (vd: 'ref-0007').
            ``None`` nếu MISSING_REFERENCE.
        status: ``CitationMappingStatus`` (xem ``linking.statuses``).
        confidence: 0.0–1.0. Dùng cho rule ordering + CIS penalty.
        method: ``MappingMethod`` mô tả cách quyết định.
        evidence: dict bằng chứng giải thích (vd: ``{'author': 'Smith',
            'year': '2020', 'page': 5, 'context': '...'}``).
        page: trang PDF nơi xuất hiện in-text (1-indexed).
        section: section name (vd: 'body', 'introduction').

    Backward compatibility:
        Cùng API với ``linking.statuses.CitationLink`` (re-export). Đặt ở đây
        để đề cương v1.2 §3.5 (linker/wrapper) và §5.2 (linking package) đều
        reference đến 1 dataclass duy nhất.
    """

    occurrence_id: str
    reference_id: str | None
    status: object  # CitationMappingStatus -- tránh circular import
    confidence: float
    method: str | MappingMethod = MappingMethod.NO_KEYS  # str for backward compat
    evidence: dict = field(default_factory=dict)
    page: int = 0
    section: str = ""
