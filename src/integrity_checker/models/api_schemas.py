"""Pydantic schemas cho API request/response."""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


class CitationSchema(BaseModel):
    """Citation sau khi extract — trả về cho client."""

    id: int | None = None
    raw_text: str
    citation_type: str
    style: str
    authors: list[str] = Field(default_factory=list)
    year: str | None = None
    title: str | None = None
    venue: str | None = None
    doi: str | None = None
    url: str | None = None
    page_num: int = 0
    confidence: float = 0.0


class VerdictSchema(BaseModel):
    """Verdict cho 1 citation — đầu ra chính của API."""

    citation_id: str | None = None
    citation_raw: str
    citation_type: str = "unknown"
    label: str                                  # ValidationLabel value
    confidence: float
    reasoning: str
    triggered_rules: list[str] = Field(default_factory=list)
    mismatched_fields: list[str] = Field(default_factory=list)
    matched_sources: list[dict] = Field(default_factory=list)
    features: dict | None = None
    url_status: str | None = None
    url_status_code: int | None = None
    archive_url: str | None = None
    is_retracted: bool = False
    citation_link: dict | None = None
    mapping_status: str = "matched"
    mapping_confidence: float = 0.0
    style_penalty: float | None = None
    domain_exception: bool = False
    is_overridden: bool = False


class CISSchema(BaseModel):
    """Citation Integrity Score — KHÔNG phải điểm tiểu luận."""

    score: float                               # 0–100
    components: dict[str, float]
    weights_used: dict[str, float]
    num_citations: int
    num_unresolved: int
    disclaimer: str


class AnalysisReportSchema(BaseModel):
    """Toàn bộ report cho 1 essay."""

    essay_id: int
    filename: str
    num_pages: int
    num_citations: int
    verdicts: list[VerdictSchema]
    references: list[CitationSchema] = Field(default_factory=list)
    cis: CISSchema
    disclaimer: str


class EssayUploadResponse(BaseModel):
    """Response khi upload PDF essay."""

    essay_id: int
    filename: str
    num_pages: int
    num_citations: int
    citations: list[CitationSchema]
    summary: dict


class HealthResponse(BaseModel):
    status: str = "ok"
    version: str
    disclaimer: str
    grobid: GrobidHealthStatus | None = None


class GrobidHealthStatus(BaseModel):
    """GROBID service health status."""

    available: bool
    status: str  # available, unavailable, starting, unknown
    container_running: bool
    container_id: str | None = None
    parser_mode: str  # grobid, regex, hybrid
    cache_enabled: bool = True
    stats: dict | None = None
    message: str | None = None
