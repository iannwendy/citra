"""IntegrityPipeline — end-to-end PDF → AnalysisReport.

Flow v1.2 (tuần 8, task #25):
    PDF → DocumentParser (PyMuPDF + GROBID + SectionSegmenter)
        → ParsedDocument (body_citations + references + appendix_citations)
        → RetrievalOrchestrator (per citation)
        → NeuroSymbolicChecker
        → CISCalculator
        → AnalysisReport

Backward compatible:
    Nếu DocumentParser disabled, fallback to legacy flow:
        PDF → BasePDFParser → CitationExtractor + ReferenceListParser
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import inspect
import json
import re
import threading
from collections import deque
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from integrity_checker.config import get_settings
from integrity_checker.extraction import (
    CitationExtractor,
    DocumentParser,
    MuPdfParser,
    PdfPlumberParser,
    ReferenceListParser,
)
from integrity_checker.extraction.base import BasePDFParser, Page, chain_parsers
from integrity_checker.linking.citation_linker import CitationLinker
from integrity_checker.linking.statuses import (
    CitationLink,
    CitationMappingStatus,
    LinkingResult,
    StyleProfile,
)
from integrity_checker.logging import configure_logging, get_logger
from integrity_checker.logic.cis import CISCalculator
from integrity_checker.logic.explanation import ExplanationGenerator
from integrity_checker.logic.neuro_symbolic_checker import NeuroSymbolicChecker
from integrity_checker.models.citation import Citation, CitationStyle, CitationType
from integrity_checker.models.source import SourceCandidate, SourceResult
from integrity_checker.models.validation import (
    CISComponents,
    CitationIntegrityScore,
    CitationVerdict,
    MatchFeatures,
    ValidationLabel,
)
from integrity_checker.retrieval import RetrievalOrchestrator
from integrity_checker.retrieval.normalization import citation_key


class _CrossLoopAsyncSemaphore:
    """Async-native FIFO semaphore shared safely across multiple worker event loops."""

    def __init__(self, limit: int) -> None:
        self._limit = max(1, int(limit))
        self._lock = threading.Lock()
        self._active = 0
        self._waiters: deque[tuple[asyncio.AbstractEventLoop, asyncio.Event]] = deque()

    @property
    def limit(self) -> int:
        return self._limit

    @property
    def active_count(self) -> int:
        with self._lock:
            return self._active

    @asynccontextmanager
    async def acquire(self) -> AsyncIterator[None]:
        loop = asyncio.get_running_loop()
        wait_ev: asyncio.Event | None = None
        with self._lock:
            if self._active < self._limit and not self._waiters:
                self._active += 1
            else:
                wait_ev = asyncio.Event()
                self._waiters.append((loop, wait_ev))

        if wait_ev is not None:
            try:
                await wait_ev.wait()
            except BaseException:
                with self._lock:
                    try:
                        self._waiters.remove((loop, wait_ev))
                        already_granted = False
                    except ValueError:
                        already_granted = True
                if already_granted:
                    self._release()
                raise

        try:
            yield
        finally:
            self._release()

    def _release(self) -> None:
        next_waiter: tuple[asyncio.AbstractEventLoop, asyncio.Event] | None = None
        with self._lock:
            while self._waiters:
                cand_loop, cand_ev = self._waiters.popleft()
                if not cand_loop.is_closed():
                    next_waiter = (cand_loop, cand_ev)
                    break
            if next_waiter is None:
                self._active = max(0, self._active - 1)
        if next_waiter is not None:
            try:
                next_waiter[0].call_soon_threadsafe(next_waiter[1].set)
            except RuntimeError:
                self._release()


_GLOBAL_RETRIEVAL_SEM_LOCK = threading.Lock()
_GLOBAL_RETRIEVAL_SEM: _CrossLoopAsyncSemaphore | None = None
_GLOBAL_RETRIEVAL_SEM_LIMIT: int = 0


def _get_global_retrieval_semaphore() -> _CrossLoopAsyncSemaphore:
    """Return process-wide cross-loop semaphore capping concurrent citation retrievals."""
    global _GLOBAL_RETRIEVAL_SEM, _GLOBAL_RETRIEVAL_SEM_LIMIT
    try:
        desired = max(1, int(get_settings().retrieval.max_global_retrievals))
    except Exception:
        desired = 12
    with _GLOBAL_RETRIEVAL_SEM_LOCK:
        if _GLOBAL_RETRIEVAL_SEM is None or desired != _GLOBAL_RETRIEVAL_SEM_LIMIT:
            _GLOBAL_RETRIEVAL_SEM = _CrossLoopAsyncSemaphore(desired)
            _GLOBAL_RETRIEVAL_SEM_LIMIT = desired
        return _GLOBAL_RETRIEVAL_SEM

logger = get_logger(__name__)

# Bump whenever extraction/linking output shape changes so previously cached
# (and possibly wrong) reports are recomputed instead of served from disk.
_REPORT_CACHE_VERSION = "report-v16"

# NEW v1.7: Only retrieve + verify REFERENCE_LIST citations (and DOI/URL inline
# with enough metadata). In-text citations are verified via linking only.
_RETREIVABLE_TYPES = frozenset({CitationType.REFERENCE_LIST, CitationType.DOI, CitationType.URL})


def _is_verifiable(citation: Citation) -> bool:
    """Citation này cần source verification (retrieve + checker).

    Chỉ reference list entries (và DOI/URL inline có metadata đầy đủ) mới
    cần verify qua API/local DB. In-text citations chỉ cần linking —
    mapping_status từ CitationLinker là đủ.
    """
    if citation.citation_type not in _RETREIVABLE_TYPES:
        return False
    # Bare DOI/URL inline cần có title hoặc DOI/URL thì mới verify được
    if citation.citation_type in {CitationType.DOI, CitationType.URL}:
        return bool(citation.title or citation.doi or citation.url)
    return True


# Regex for normalizing "et al." citation formats for link lookup
# Matches: "(Vaswani et al., 2017)", "(Vaswani et al. (2017))", "Vaswani et al. (2017)"
_ET_AL_NORM_RE = re.compile(
    r"\(?([A-Za-zÀ-ÿ'.\s-]+?)(?:\s+et\s+al\.?)?[,\s]+\(?\s*((?:19|20)\d{2})",
    re.IGNORECASE,
)


@dataclass
class AnalysisReport:
    """Đầu ra cuối cùng của pipeline.

    v1.2 §3.2.2 — output schema TÁCH 2 lớp:
        - ``verdicts[].label`` (ValidationLabel) — source verification.
        - ``verdicts[].mapping_status`` (CitationMappingStatus) — in-text ↔ reference
          integrity.
        - ``linking_summary`` — counts per CitationMappingStatus (cho Web UI dashboard).
    """

    essay_id: int = 0
    filename: str = ""
    num_pages: int = 0
    num_citations: int = 0
    # Every extracted occurrence/entry, retained separately from the deduped
    # verification verdicts.  Repeated citations must remain countable.
    extracted_citations: list[Citation] = field(default_factory=list)
    verdicts: list[CitationVerdict] = field(default_factory=list)
    cis: CitationIntegrityScore | None = None
    linking_summary: dict[str, int] = field(default_factory=dict)  # NEW v1.2 — mapping counts
    style_profile: dict[str, Any] | None = None  # NEW v1.2 — style profile summary
    disclaimer: str = ""
    generated_at: str = ""
    cache_hit: bool = False

    def to_dict(self) -> dict[str, Any]:
        """Serialize sang JSON-friendly dict."""
        return {
            "essay_id": self.essay_id,
            "filename": self.filename,
            "num_pages": self.num_pages,
            "num_citations": self.num_citations,
            "extracted_citations": [_serialize_citation(c) for c in self.extracted_citations],
            "verdicts": [
                {
                    # Lớp 1: source verification (nhãn 4 chiều)
                    "citation_raw": v.citation.raw_text,
                    "citation": _serialize_citation(v.citation),
                    "label": v.label.value,
                    "confidence": v.confidence,
                    # Lớp 2: integrity mapping (7 trạng thái v1.2 §3.2.2)
                    "mapping_status": (
                        v.mapping_status.value
                        if v.mapping_status is not None
                        else None
                    ),
                    "mapping_confidence": v.mapping_confidence,
                    "citation_link": (
                        _serialize_citation_link(v.citation_link)
                        if v.citation_link is not None
                        else None
                    ),
                    # v1.9 — lossless list ("[9, 10]" keeps both refs).
                    "citation_links": _serialize_citation_link_list(
                        getattr(v, "citation_links", None)
                        or getattr(v, "citation_link", None)
                    ),
                    # Bằng chứng
                    "reasoning": v.reasoning,
                    "triggered_rules": v.triggered_rules,
                    "mismatched_fields": v.mismatched_fields,
                    "features": {
                        "title_sim_fuzzy": v.features.title_sim_fuzzy if v.features else None,
                        "title_sim_semantic": v.features.title_sim_semantic if v.features else None,
                        "author_jaccard": v.features.author_jaccard if v.features else None,
                        "year_distance": v.features.year_distance if v.features else None,
                        "doi_exact_match": v.features.doi_exact_match if v.features else None,
                        "source_consensus": v.features.source_consensus if v.features else None,
                        "venue_sim": v.features.venue_sim if v.features else None,
                        "content_alignment_score": v.features.content_alignment_score if v.features else None,
                        "content_alignment_confidence": v.features.content_alignment_confidence if v.features else None,
                        "content_is_aligned": v.features.content_is_aligned if v.features else None,
                        "title_context_sim": getattr(v.features, "title_context_sim", 0.0) if v.features else None,
                        "abstract_context_sim": getattr(v.features, "abstract_context_sim", None) if v.features else None,
                        "best_evidence_sentence": getattr(v.features, "best_evidence_sentence", None) if v.features else None,
                        "best_evidence_score": getattr(v.features, "best_evidence_score", None) if v.features else None,
                        "best_cited_sentence": getattr(v.features, "best_cited_sentence", None) if v.features else None,
                        "citation_intent": getattr(v.features, "citation_intent", "") if v.features else None,
                        "stance_label": getattr(v.features, "stance_label", "") if v.features else None,
                        "cross_lingual_detected": getattr(v.features, "cross_lingual_detected", False) if v.features else False,
                        "bridged_concepts": list(getattr(v.features, "bridged_concepts", []) or []) if v.features else [],
                        "cross_lingual_title_detected": getattr(v.features, "cross_lingual_title_detected", False) if v.features else False,
                        "cross_lingual_title_sim": getattr(v.features, "cross_lingual_title_sim", 0.0) if v.features else 0.0,
                        "context_source": getattr(v.features, "context_source", "") if v.features else None,
                        "occurrence_alignments": getattr(v.features, "occurrence_alignments", []) if v.features else [],
                        "url_status": getattr(v.matched_source, "url_status", None) if v.matched_source else None,
                        "url_status_code": getattr(v.matched_source, "url_status_code", None) if v.matched_source else None,
                        "archive_url": getattr(v.matched_source, "archive_url", None) if v.matched_source else None,
                        "is_retracted": bool(
                            getattr(v.matched_source, "is_retracted", False)
                            or ("R-RETRACTED-PAPER" in (v.triggered_rules or []))
                        ),
                        "checked_url": getattr(v.citation, "url", None) if v.citation else None,
                    },
                    "url_status": getattr(v.matched_source, "url_status", None) if v.matched_source else None,
                    "url_status_code": getattr(v.matched_source, "url_status_code", None) if v.matched_source else None,
                    "archive_url": getattr(v.matched_source, "archive_url", None) if v.matched_source else None,
                    "is_retracted": bool(
                        getattr(v.matched_source, "is_retracted", False)
                        or ("R-RETRACTED-PAPER" in (v.triggered_rules or []))
                    ),
                    "domain_exception": getattr(v, "domain_exception", False),
                    # NEW v1.3: Provenance tracking
                    "provenance": {
                        "sources_succeeded": v.sources_succeeded,
                        "sources_failed": dict(v.sources_failed),
                        "api_exhausted": v.api_exhausted,
                        "used_local_db": v.used_local_db,
                    },
                    "matched_sources": _serialize_matched_sources(v.matched_source),
                    "warnings": _get_verdict_warnings_from_verdict(v),
                    "suggestions": ExplanationGenerator.suggestions(v),
                }
                for v in self.verdicts
            ],
            "linking_summary": self.linking_summary,
            "style_profile": self.style_profile,
            "cis": (
                {
                    "score": self.cis.score,
                    "components": self.cis.components.to_dict(),
                    "weights_used": self.cis.weights_used,
                    "num_citations": self.cis.num_citations,
                    "num_unresolved": self.cis.num_unresolved,
                }
                if self.cis
                else None
            ),
            "disclaimer": self.disclaimer,
            "generated_at": self.generated_at,
            "cache_hit": self.cache_hit,
        }

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> AnalysisReport:
        """Rehydrate a report from the persistent JSON report cache."""
        verdicts: list[CitationVerdict] = []
        for raw_verdict in payload.get("verdicts", []):
            citation_data = raw_verdict.get("citation") or {
                "raw_text": raw_verdict.get("citation_raw", ""),
            }
            citation = _deserialize_citation(citation_data)
            feature_data = raw_verdict.get("features") or {}
            features = _match_features_from_dict(feature_data)

            mapping_status = raw_verdict.get("mapping_status")
            if mapping_status:
                mapping_status = CitationMappingStatus(mapping_status)
            citation_link = _deserialize_citation_link(raw_verdict.get("citation_link"))
            url_status = raw_verdict.get("url_status") or feature_data.get("url_status")
            url_status_code = raw_verdict.get("url_status_code") or feature_data.get("url_status_code")
            archive_url = raw_verdict.get("archive_url") or feature_data.get("archive_url")
            is_retracted = bool(raw_verdict.get("is_retracted") or feature_data.get("is_retracted", False))

            verdict = CitationVerdict(
                citation=citation,
                label=ValidationLabel(raw_verdict.get("label", "unresolved")),
                confidence=float(raw_verdict.get("confidence", 0.0)),
                mapping_status=mapping_status,
                mapping_confidence=float(raw_verdict.get("mapping_confidence", 0.0)),
                citation_link=citation_link,
                citation_links=_deserialize_citation_link_list(
                    raw_verdict.get("citation_links")
                    if raw_verdict.get("citation_links") is not None
                    else raw_verdict.get("citation_link")
                ),
                features=features,
                reasoning=raw_verdict.get("reasoning", ""),
                triggered_rules=list(raw_verdict.get("triggered_rules", [])),
                mismatched_fields=list(raw_verdict.get("mismatched_fields", [])),
                domain_exception=bool(raw_verdict.get("domain_exception", False)),
                is_overridden=bool(raw_verdict.get("is_overridden", False)),
                sources_succeeded=list(
                    (raw_verdict.get("provenance") or {}).get("sources_succeeded", [])
                ),
                sources_failed=dict(
                    (raw_verdict.get("provenance") or {}).get("sources_failed", {})
                ),
                api_exhausted=bool(
                    (raw_verdict.get("provenance") or {}).get("api_exhausted", False)
                ),
                used_local_db=bool(
                    (raw_verdict.get("provenance") or {}).get("used_local_db", False)
                ),
                # Rehydrate SourceResult so to_dict keeps emitting matched_sources & url_status
                matched_source=_deserialize_matched_sources(
                    raw_verdict.get("matched_sources"),
                    url_status=url_status,
                    url_status_code=url_status_code,
                    archive_url=archive_url,
                    is_retracted=is_retracted,
                ),
            )
            verdicts.append(verdict)

        cis_payload = payload.get("cis")
        cis = None
        if cis_payload:
            components = cis_payload.get("components") or {}
            cis = CitationIntegrityScore(
                score=float(cis_payload.get("score", 0.0)),
                components=CISComponents(
                    verified_ratio=float(components.get("verified_ratio", 0.0)),
                    metadata_accuracy=float(components.get("metadata_accuracy", 0.0)),
                    in_text_bib_consistency=float(
                        components.get("in_text_bib_consistency", 0.0)
                    ),
                    format_consistency=float(components.get("format_consistency", 0.0)),
                    identifier_validity=float(components.get("identifier_validity", 0.0)),
                ),
                weights_used=dict(cis_payload.get("weights_used") or {}),
                num_citations=int(cis_payload.get("num_citations", 0)),
                num_unresolved=int(cis_payload.get("num_unresolved", 0)),
            )

        return cls(
            essay_id=int(payload.get("essay_id", 0)),
            filename=payload.get("filename", ""),
            num_pages=int(payload.get("num_pages", 0)),
            num_citations=int(payload.get("num_citations", len(verdicts))),
            extracted_citations=[
                _deserialize_citation(c) for c in (payload.get("extracted_citations") or [])
            ],
            verdicts=verdicts,
            cis=cis,
            linking_summary=dict(payload.get("linking_summary") or {}),
            style_profile=payload.get("style_profile"),
            disclaimer=payload.get("disclaimer", ""),
            generated_at=payload.get("generated_at", ""),
            cache_hit=True,
        )


def _resolution_key(
    citation: Citation,
    ref_by_link: dict[str, Citation],
    link_by_raw_text: dict[str, CitationLink],
) -> str:
    """Return a canonical retrieval key for a citation.

    A linked in-text occurrence describes the same source as its bibliography
    entry, so it resolves to that entry's key.  This keeps retrieval work at
    one query per source while the report still lists every occurrence.
    Unlinked occurrences fall back to the regular ``citation_key``.
    """
    if citation.citation_type != CitationType.REFERENCE_LIST:
        link = link_by_raw_text.get(citation.reference_id)
        if link is None:
            raw = " ".join(citation.raw_text.split())
            link = link_by_raw_text.get(raw.lower())
        if link is None:
            link = link_by_raw_text.get(
                IntegrityPipeline._normalize_identifier(citation.raw_text)
            )
        if link is not None and link.reference_id:
            matched_ref = ref_by_link.get(link.reference_id)
            if matched_ref is not None:
                return citation_key(matched_ref)
    return citation_key(citation)


class IntegrityPipeline:
    """End-to-end pipeline: PDF → AnalysisReport.

    v1.2 (tuần 8) — sử dụng DocumentParser làm entry point chính (PyMuPDF +
    GROBID + SectionSegmenter). Fallback về legacy flow nếu DocumentParser
    disabled qua config.

    # TODO(user): tuần 9 — thêm:
        - Batch processing nhiều PDF cùng lúc
        - Persistent cache của verdicts (key = SHA256 của citation + PDF content)
    """

    def __init__(
        self,
        parser: BasePDFParser | None = None,
        extractor: CitationExtractor | None = None,
        ref_parser: ReferenceListParser | None = None,
        orchestrator: RetrievalOrchestrator | None = None,
        checker: NeuroSymbolicChecker | None = None,
        cis_calc: CISCalculator | None = None,
        document_parser: DocumentParser | None = None,
        use_document_parser: bool | None = None,
        linker: CitationLinker | None = None,
        use_report_cache: bool | None = None,
    ) -> None:
        # Legacy components (fallback path)
        self.parser = parser or self._build_default_parser()
        self.extractor = extractor or CitationExtractor()
        self.ref_parser = ref_parser or ReferenceListParser(self.extractor)
        # Modern path — DocumentParser (PyMuPDF + GROBID + SectionSegmenter)
        self.document_parser = document_parser or DocumentParser()
        # Use DocumentParser by default in v1.2+ (fix 2026-09-20)
        self._use_document_parser: bool = (
            use_document_parser
            if use_document_parser is not None
            else True
        )
        self._document_parser_explicit = use_document_parser is not None
        self.orchestrator = orchestrator or RetrievalOrchestrator()
        self.checker = checker or NeuroSymbolicChecker()
        self.cis_calc = cis_calc or CISCalculator()
        # NEW v1.2 §3.2.2 — CitationLinker cho in-text ↔ reference integrity
        self.linker = linker or CitationLinker()
        settings = get_settings()
        # Cache disabled by default - set use_report_cache=True only when needed
        self._use_report_cache = (
            use_report_cache
            if use_report_cache is not None
            else False  # Disabled by default
        )
        self._report_cache_dir = settings.paths.cache_dir / "reports"

    def _build_default_parser(self) -> BasePDFParser:
        """Theo config: mupdf | pdfplumber | hybrid (mupdf → pdfplumber fallback)."""
        mode = get_settings().extraction.parser
        if mode == "mupdf":
            return MuPdfParser()
        if mode == "pdfplumber":
            return PdfPlumberParser()
        return chain_parsers([MuPdfParser(), PdfPlumberParser()])

    @staticmethod
    def _pdf_sha256(pdf_path: str) -> str | None:
        """Compute a stable content hash without loading the whole PDF."""
        path = Path(pdf_path)
        if not path.is_file():
            return None
        digest = hashlib.sha256()
        try:
            with path.open("rb") as handle:
                for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                    digest.update(chunk)
        except OSError:
            return None
        return digest.hexdigest()

    def _report_cache_key(self, pdf_path: str) -> str | None:
        digest = self._pdf_sha256(pdf_path)
        return f"{_REPORT_CACHE_VERSION}-{digest}" if digest else None

    def _report_cache_path(self, cache_key: str) -> Path:
        return self._report_cache_dir / f"{cache_key}.json"

    def _load_report_cache(self, cache_key: str) -> AnalysisReport | None:
        path = self._report_cache_path(cache_key)
        if not path.is_file():
            return None
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            return AnalysisReport.from_dict(payload)
        except (OSError, json.JSONDecodeError, TypeError, ValueError, KeyError) as exc:
            logger.warning(f"Invalid report cache {path}: {exc}; recomputing")
            return None

    def _save_report_cache(self, cache_key: str, report: AnalysisReport) -> None:
        path = self._report_cache_path(cache_key)
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            temp_path = path.with_suffix(".tmp")
            temp_path.write_text(
                json.dumps(report.to_dict(), ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            temp_path.replace(path)
        except OSError as exc:
            logger.warning(f"Could not write report cache {path}: {exc}")

    # -- sync entry (CLI / tests) --

    def run(
        self,
        pdf_path: str,
        essay_id: int = 0,
        max_citations: int | None = None,
        allow_serpapi: bool | None = None,
    ) -> AnalysisReport:
        """Sync wrapper quanh async run_async."""
        return asyncio.run(
            self.run_async(
                pdf_path,
                essay_id=essay_id,
                max_citations=max_citations,
                allow_serpapi=allow_serpapi,
            )
        )

    # -- async entry (FastAPI) --

    async def run_async(
        self,
        pdf_path: str,
        essay_id: int = 0,
        progress_callback: Any | None = None,
        max_citations: int | None = None,
        allow_serpapi: bool | None = None,
    ) -> AnalysisReport:
        """Full pipeline async.

        Flow v1.2:
            1. DocumentParser.parse(pdf_path) → ParsedDocument
               (PyMuPDF + GROBID + SectionSegmenter fused)
            2. body_citations + references + appendix_citations
            3. _merge_citations(...) — ưu tiên references (có title + DOI)
            4. Per-citation: RetrievalOrchestrator.retrieve() → SourceResult
            5. NeuroSymbolicChecker.check() → CitationVerdict
            6. CISCalculator.compute(verdicts) → CitationIntegrityScore
            7. AnalysisReport

        ``progress_callback(step_key, step_index, partial_stats)`` is invoked at
        each of the 8 step boundaries to drive the ProcessingScreen UI in real
        time. ``partial_stats`` is an arbitrary dict the caller can use to update
        counters and per-source states.
        """
        logger.info(f"Pipeline start: {pdf_path}")

        def _emit(step_key: str, step_index: int, **stats: Any) -> None:
            if progress_callback is None:
                return
            try:
                progress_callback(step_key, step_index, stats)
            except Exception as cb_err:  # pragma: no cover — never break pipeline
                logger.debug(f"progress_callback ignored: {cb_err}")

        if (
            not Path(pdf_path).is_file()  # noqa: ASYNC240 - cheap stat before heavy parse
            and self._use_document_parser
            and not self._document_parser_explicit
        ):
            # Preserve the legacy sync API contract for callers that did not
            # explicitly opt into DocumentParser's graceful empty-report mode.
            raise FileNotFoundError(pdf_path)

        cache_key = self._report_cache_key(pdf_path)
        if cache_key and self._use_report_cache:
            cached_report = self._load_report_cache(cache_key)
            if cached_report is not None:
                cached_report.essay_id = essay_id
                cached_report.filename = Path(pdf_path).name
                logger.info(
                    f"Report cache HIT: {Path(pdf_path).name} "
                    f"(sha256={cache_key.removeprefix(_REPORT_CACHE_VERSION + '-')[:12]}...)"
                )
                _emit("done", 7, message="Loaded from cache")
                return cached_report

        # 1. Parse PDF / DOCX
        _doc_label = "DOCX" if str(pdf_path).lower().endswith(".docx") else "PDF"
        _emit("parsing", 0, message=f"Parsing {_doc_label} structure...")
        num_pages = 0
        in_text_citations: list[Citation] = []
        ref_citations: list[Citation] = []
        parser_warnings: list[str] = []
        style_profile_dict: dict[str, Any] | None = None
        document_pages: list[Page] = []  # Store pages for context extraction

        if self._use_document_parser:
            # Modern path: DocumentParser (PyMuPDF + GROBID + SectionSegmenter)
            parsed = await asyncio.to_thread(self.document_parser.parse, pdf_path)
            num_pages = parsed.document.num_pages  # FIX: lấy num_pages từ document gốc
            raw_doc_meta = getattr(parsed.document, "metadata", None)
            doc_metadata = dict(raw_doc_meta) if isinstance(raw_doc_meta, dict) else {}
            in_text_citations = list(parsed.body_citations) + [
                c
                for c in (parsed.appendix_citations or [])
                if c not in parsed.body_citations
            ]
            ref_citations = parsed.references
            parser_warnings = parsed.parser_warnings
            document_pages = parsed.document.pages  # Store for context extraction
            logger.info(
                f"DocumentParser: {len(parsed.body_citations)} body + "
                f"{len(parsed.references)} ref + "
                f"{len(parsed.appendix_citations)} appendix citations"
                + (f" (warnings: {parser_warnings})" if parser_warnings else "")
            )
        else:
            # Legacy fallback path
            doc = await asyncio.to_thread(self.parser.parse, pdf_path)
            num_pages = doc.num_pages
            raw_doc_meta = getattr(doc, "metadata", None)
            doc_metadata = dict(raw_doc_meta) if isinstance(raw_doc_meta, dict) else {}
            in_text_citations = self.extractor.extract_from_document(doc)
            ref_citations = self.ref_parser.parse_reference_section(doc)
            document_pages = doc.pages  # Store for context extraction
            logger.info(
                f"Legacy parse: {doc.num_pages} pages via {doc.parser_used}, "
                f"{len(in_text_citations)} in-text + {len(ref_citations)} ref-list"
            )

        # 1b. Style profile detection (v1.2 — dùng cho linker + CIS format_consistency)
        _emit(
            "style_detection",
            1,
            message="Detecting citation style...",
        )
        # Web links are resources, not academic citations, so they must not
        # influence the document style profile used by CIS.
        # Exclude URL references from style detection but keep numeric
        # reference list entries (e.g. IEEE ``[N]`` markers) so the detector
        # does not fall back to APA for numeric documents.
        academic_in_text = [
            citation for citation in in_text_citations
            if citation.citation_type not in {CitationType.URL, CitationType.REFERENCE_LIST}
        ]
        academic_references = [
            citation for citation in ref_citations
            if citation.citation_type != CitationType.URL
        ]
        style_profile = self._detect_style(academic_in_text, academic_references)
        style_profile_dict = self._serialize_style_profile(style_profile)
        total_extractable_chars = int(
            doc_metadata.get("total_extractable_chars")
            if doc_metadata.get("total_extractable_chars") is not None
            else sum(len((p.text or "").strip()) for p in (document_pages or []))
        )
        scanned_pages_count = int(
            doc_metadata.get("scanned_pages_count")
            if doc_metadata.get("scanned_pages_count") is not None
            else sum(1 for p in (document_pages or []) if len((p.text or "").strip()) < 40)
        )
        avg_chars_per_page = float(
            doc_metadata.get("avg_chars_per_page")
            if doc_metadata.get("avg_chars_per_page") is not None
            else round(total_extractable_chars / max(1, len(document_pages or [])), 1)
        )
        is_scanned_pdf = bool(
            doc_metadata.get("is_scanned_pdf")
            or (
                num_pages > 0
                and not str(pdf_path).lower().endswith(".docx")
                and avg_chars_per_page < 55.0
                and len(in_text_citations) == 0
                and len(ref_citations) == 0
            )
        )
        style_profile_dict["document_diagnostics"] = {
            "is_scanned_pdf": is_scanned_pdf,
            "scanned_pages_count": scanned_pages_count,
            "total_extractable_chars": total_extractable_chars,
            "avg_chars_per_page": avg_chars_per_page,
            "warning_code": "SCANNED_PDF_DETECTED" if is_scanned_pdf else None,
            "warning_message": (
                doc_metadata.get("warning_message")
                or (
                    "Phát hiện tài liệu PDF dạng ảnh quét (Scanned/Image-only PDF) thiếu lớp văn bản số hóa (Text Layer). "
                    "Vui lòng chuyển đổi qua OCR hoặc tải lên bản gốc .docx / PDF xuất trực tiếp từ Word/LaTeX để đạt độ chính xác kiểm chứng trích dẫn tối đa."
                    if is_scanned_pdf
                    else None
                )
            ),
            "parser_warnings": list(parser_warnings or []),
        }

        # 1c. Citation linking (in-text ↔ reference) — v1.2 §3.5
        _emit(
            "extracting",
            2,
            citations_found=len(in_text_citations),
            references_found=len(ref_citations),
            message=f"Found {len(in_text_citations)} in-text + {len(ref_citations)} references",
        )
        linking_result = self._run_linking(in_text_citations, ref_citations, style_profile)
        link_by_raw_text = self._build_link_lookup(linking_result.links)
        # v1.9 — lossless view: one occurrence may cite several references
        # ("[9, 10]"), and the single-slot map above keeps only the last.
        links_by_key_multi = self._build_link_lookup_multi(linking_result.links)

        # 1d. Populate metadata for in-text citations from matched references
        # FIX: For numeric citations like "[1]" that have no title/author/year,
        # copy metadata from the matched reference entry
        self._populate_citation_metadata(in_text_citations, ref_citations, link_by_raw_text)

        # 1d-bis. Extract the surrounding sentence for every in-text
        # occurrence. This runs BEFORE the verdict loop so a reference-list
        # verdict can borrow the context of the occurrence that cites it —
        # a bibliography entry has no sentence of its own.
        occurrence_by_reference_id = self._extract_occurrence_contexts(
            in_text_citations,
            document_pages,
            links_by_key_multi,
        )
        occurrences_by_reference_id = self._extract_all_occurrence_contexts(
            in_text_citations,
            links_by_key_multi,
        )
        body_pages_for_discovery = self._filter_body_pages_for_discovery(
            document_pages, ref_citations
        )

        # 1e. Merge citations theo priority (cho retrieval/checker).
        # Appendix chỉ dùng cho linking thống kê, không retrieval.
        all_citations = self._merge_citations(
            in_text_citations, ref_citations, []
        )

        # Linking summary derived from already-resolved link objects — surface
        # the matched reference count to the UI before retrieval starts (matching
        # linking_summary.get("matched", 0) at the end of the pipeline).
        _matched_ref_ids = {
            link.reference_id
            for link in linking_result.links
            if link.reference_id
            and getattr(link, "status", None) is not None
            and getattr(link.status, "value", link.status) == "matched"
        }
        _initial_linked = (
            len(_matched_ref_ids)
            if _matched_ref_ids
            else sum(
                1 for link in linking_result.links
                if getattr(link, "status", None) is not None
                and getattr(link.status, "value", link.status) == "matched"
            )
        )
        _emit(
            "linking",
            3,
            linked=_initial_linked,
            citations_found=len(in_text_citations),
            references_found=len(ref_citations),
            message=f"Linked {_initial_linked} of {len(ref_citations) or len(all_citations)} references",
        )

        # 2. Retrieve + check từng citation (PARALLEL cho tốc độ).  Keep one
        # verdict per unique citation, but retrieve one canonical paper
        # only once when a bibliography entry and in-text occurrence refer to
        # the same paper.
        unique_citations: dict[str, Citation] = {}
        for citation in all_citations:
            # A reference list entry and its in-text occurrence describe the
            # same source; resolve to the linked entry's key so retrieval only
            # queries that paper once.
            key = citation_key(citation)
            unique_citations.setdefault(key, citation)

        # FIX v1.7: Only keep verifiable citations for retrieval + verdicts.
        # Reference list entries (và DOI/URL inline với đủ metadata) → verify qua API.
        # In-text citations → verified qua linking, KHÔNG gọi API.
        # Track verifiable keys separately (Citation objects can't be dict keys).
        verifiable_keys: list[str] = []
        for key in unique_citations:
            cit = unique_citations[key]
            if _is_verifiable(cit):
                verifiable_keys.append(key)
        citations_truncated_by_plan = False
        original_verifiable_count = len(verifiable_keys)
        if max_citations is not None and max_citations > 0 and len(verifiable_keys) > max_citations:
            verifiable_keys = verifiable_keys[:max_citations]
            citations_truncated_by_plan = True
        unique_list = [unique_citations[key] for key in verifiable_keys]
        if style_profile_dict is not None:
            style_profile_dict["citations_truncated_by_plan"] = citations_truncated_by_plan
            if isinstance(style_profile_dict.get("document_diagnostics"), dict):
                style_profile_dict["document_diagnostics"]["citations_truncated_by_plan"] = (
                    citations_truncated_by_plan
                )
                if citations_truncated_by_plan:
                    style_profile_dict["document_diagnostics"]["max_citations_limit"] = max_citations
                    style_profile_dict["document_diagnostics"]["total_verifiable_citations"] = (
                        original_verifiable_count
                    )

        _emit(
            "retrieving",
            4,
            citations_found=len(in_text_citations) or len(all_citations),
            references_found=len(ref_citations) or len(unique_list),
            message=f"Querying academic databases for {len(unique_list)} unique papers...",
        )
        # FIX v1.7: Only retrieve for verifiable citations (references, not in-text).
        # Limit concurrent paper retrievals both per-essay and globally across worker loops
        # to eliminate HTTP 429 bursts on scholarly APIs during deadline upload spikes.
        per_essay_limit = max(
            1, int(getattr(get_settings().retrieval, "per_essay_retrievals", 6))
        )
        retrieval_sem = asyncio.Semaphore(per_essay_limit)
        global_retrieval_sem = _get_global_retrieval_semaphore()
        from integrity_checker.retrieval.retrieval_orchestrator import _ALLOW_SERPAPI_OVERRIDE

        retrieve_params = inspect.signature(self.orchestrator.retrieve).parameters
        supports_allow_serpapi_kwarg = (
            "allow_serpapi" in retrieve_params
            or any(p.kind == inspect.Parameter.VAR_KEYWORD for p in retrieve_params.values())
        )

        async def _bounded_retrieve(cit: Citation) -> SourceResult:
            async with retrieval_sem, global_retrieval_sem.acquire():
                token = _ALLOW_SERPAPI_OVERRIDE.set(allow_serpapi)
                try:
                    if supports_allow_serpapi_kwarg and allow_serpapi is not None:
                        return await self.orchestrator.retrieve(cit, allow_serpapi=allow_serpapi)
                    return await self.orchestrator.retrieve(cit)
                finally:
                    _ALLOW_SERPAPI_OVERRIDE.reset(token)

        unique_sources = await asyncio.gather(
            *(_bounded_retrieve(c) for c in unique_list),
            return_exceptions=False,
        )
        if len(unique_list) < len(unique_citations):
            logger.info(
                f"Retrieval: {len(all_citations)} citations -> "
                f"{len(unique_list)} verifiable (references only)"
            )

        # Duplicate bibliography entries (same DOI/arXiv/title key) collapse
        # into one retrieval above; they still need their own verdict so the
        # report can surface DUPLICATE_REFERENCE. Reuse the canonical source.
        verdict_pairs: list[tuple[Citation, SourceResult]] = list(
            zip(unique_list, unique_sources, strict=True)
        )
        duplicate_ref_ids = set(getattr(linking_result, "duplicate_reference_ids", None) or [])
        if duplicate_ref_ids:
            source_by_key = dict(zip(verifiable_keys, unique_sources, strict=True))
            in_verdicts = {id(c) for c in unique_list}
            for ref in ref_citations:
                if max_citations is not None and max_citations > 0 and len(verdict_pairs) >= max_citations:
                    break
                if id(ref) in in_verdicts or ref.reference_id not in duplicate_ref_ids:
                    continue
                shared_source = source_by_key.get(citation_key(ref))
                if shared_source is None:
                    shared_source = await _bounded_retrieve(ref)
                verdict_pairs.append((ref, shared_source))
                in_verdicts.add(id(ref))

        # Surface per-data-source outcomes to the UI. Sources_queried is built
        # from the union of all retrieved SourceResults — a source is "ok" if
        # at least one citation got a hit, "failed" if every call failed,
        # otherwise "pending".
        _src_status: dict[str, str] = {}
        _src_hits: dict[str, int] = {}
        _src_fails: dict[str, int] = {}
        _src_misses: dict[str, int] = {}
        for src in unique_sources:
            for name in getattr(src, "sources_succeeded", []):
                _src_hits[name] = _src_hits.get(name, 0) + 1
            for name, err in getattr(src, "sources_failed", {}).items():
                err_l = (err or "").lower()
                if any(
                    m in err_l
                    for m in (
                        "no results",
                        "no title match",
                        "does not exist",
                        "not found",
                        "no matching",
                        "empty title query",
                        "empty search query",
                        "skipped (rate-limit backoff active)",
                    )
                ):
                    _src_misses[name] = _src_misses.get(name, 0) + 1
                else:
                    _src_fails[name] = _src_fails.get(name, 0) + 1
        for name in set(list(_src_hits.keys()) + list(_src_fails.keys()) + list(_src_misses.keys())):
            if _src_hits.get(name, 0) > 0 and _src_fails.get(name, 0) == 0:
                _src_status[name] = "ok"
            elif _src_hits.get(name, 0) > 0 and _src_fails.get(name, 0) > 0:
                _src_status[name] = "partial"
            elif _src_fails.get(name, 0) > 0:
                _src_status[name] = f"failed:{_src_fails[name]}"
            elif _src_misses.get(name, 0) > 0:
                _src_status[name] = f"queried:{_src_misses[name]}"
            else:
                _src_status[name] = "pending"
        _source_display_names = {
            "local_db": "ACL FTS5",
            "known_papers": "Seminal",
            "vn_legal": "VN Legal",
            "crossref": "Crossref",
            "openalex": "OpenAlex",
            "datacite": "DataCite",
            "doaj": "DOAJ",
            "openaire_hal": "OpenAIRE/HAL",
            "ncbi_biorxiv": "NCBI/bioRxiv",
            "dblp": "DBLP",
            "arxiv": "arXiv",
            "openlibrary": "OpenLibrary",
            "europepmc": "Europe PMC",
            "huggingface": "Hugging Face",
            "tech_standard": "RFC/PyPI/NPM/GitHub",
            "wikidata_opencitations": "Wikidata/OpenCitations",
            "doi_ra": "DOI RA",
            "serpapi": "Google Scholar",
        }
        _total_hits = sum(_src_hits.values())
        _hit_parts = [
            f"{_source_display_names.get(k, k)}: {v}"
            for k, v in sorted(_src_hits.items(), key=lambda kv: (-kv[1], kv[0]))
            if v > 0
        ]
        _joined_hits = " · ".join(_hit_parts)
        _hit_breakdown = f" ({_joined_hits})" if _joined_hits else ""
        _emit(
            "comparing",
            5,
            sources_queried=_src_status,
            message=f"Compared {_total_hits} source hits across {len(_src_status)} databases{_hit_breakdown}",
        )

        verdicts: list[CitationVerdict] = []
        # FIX v1.7: Only iterate over verifiable (reference) citations for verdicts.
        # In-text citations are verified via linking only (mapping_status attached below).
        for citation, source in verdict_pairs:
            # NEW v1.2 §3.2.2 (task #33) — compute mapping_status TRƯỚC rules
            # để SymbolicRules có input cho AMBIGUOUS_MAPPING rule.
            if citation.citation_type.value == "reference_list":
                # First honour the bidirectional CitationLinker mapping if this
                # reference entry was linked (or flagged uncited) against in-text
                # occurrences. Fall back to DOI check only when no in-text
                # citations were present in the document.
                ref_links = [
                    lnk
                    for lnk in linking_result.links
                    if citation.reference_id
                    and lnk.reference_id == citation.reference_id
                    and getattr(lnk.status, "value", lnk.status)
                    in ("matched", "in_text_mismatch", "ambiguous_mapping")
                ]
                if citation.reference_id and citation.reference_id in duplicate_ref_ids:
                    # Non-canonical member of a duplicate group (DuplicateDetector).
                    mapping_status = CitationMappingStatus.DUPLICATE_REFERENCE
                    mapping_confidence = float(citation.mapping_confidence or 1.0)
                    citation_link = ref_links[0] if ref_links else None
                    citation_links_verdict: list = list(ref_links)
                elif ref_links:
                    mapping_status = CitationMappingStatus.MATCHED
                    mapping_confidence = max(lnk.confidence for lnk in ref_links)
                    citation_link = ref_links[0]
                    citation_links_verdict = list(ref_links)
                elif (
                    not in_text_citations
                    and source.best_candidate()
                    and source.best_candidate().doi
                    and citation.doi
                    and source.best_candidate().doi.lower() == citation.doi.lower()
                ):
                    mapping_status = CitationMappingStatus.MATCHED
                    mapping_confidence = 0.95
                    citation_link = None
                    citation_links_verdict = []
                elif (
                    citation.reference_id
                    and citation.reference_id in (linking_result.unmatched_reference_ids or [])
                ):
                    mapping_status = CitationMappingStatus.UNCITED_REFERENCE
                    mapping_confidence = 1.0
                    citation_link = None
                    citation_links_verdict = []
                else:
                    mapping_status = CitationMappingStatus.UNRESOLVED
                    mapping_confidence = 0.5
                    citation_link = None
                    citation_links_verdict = []
                citation.mapping_status = mapping_status.value
                citation.mapping_confidence = mapping_confidence
                citation.citation_link = citation_link
                citation.citation_links = list(citation_links_verdict)
            else:
                citation_links_verdict = []
                # Normalize the raw_text to handle newlines/whitespace variations
                normalized_text = citation.raw_text.replace("\n", " ").replace("  ", " ")
                # Try lookup with normalized text
                normalized_key = IntegrityPipeline._normalize_identifier(normalized_text)
                link = link_by_raw_text.get(normalized_key)
                if link is None:
                    link = link_by_raw_text.get(normalized_text.lower().strip())
                # Special case: author-year style without parens vs with parens
                # e.g., "Vaswani et al. (2017)" vs "(Vaswani et al., 2017)"
                if link is None and "et al." in normalized_text:
                    # Try adding parens if missing
                    if not normalized_text.strip().startswith("("):
                        with_parens = f"({normalized_text.strip().rstrip('.')})"
                        link = link_by_raw_text.get(with_parens.lower())
                        if link is None:
                            link = link_by_raw_text.get(
                                IntegrityPipeline._normalize_identifier(with_parens)
                            )
                # Final fallback: try extracting (author, year) from any APA-like format
                if link is None:
                    # Normalize both sides: extract first author name and year
                    # Patterns: "(Vaswani et al., 2017)", "(Vaswani et al. (2017))", "Vaswani et al. (2017)"
                    def normalize_et_al(text):
                        # Extract first author and year
                        m = _ET_AL_NORM_RE.search(text)
                        if m:
                            first = m.group(1).strip().split()[0].lower()
                            year = m.group(2)
                            return f"({first} et al., {year})"
                        return None

                    norm = normalize_et_al(normalized_text)
                    if norm:
                        link = link_by_raw_text.get(norm)
                if link is not None:
                    mapping_status = link.status
                    mapping_confidence = link.confidence
                    citation_link = link
                    # v1.9 — every edge of this occurrence ("[9, 10]" → 2).
                    citation_links_verdict = list(
                        links_by_key_multi.get(normalized_key)
                        or links_by_key_multi.get(normalized_text.lower().strip())
                        or [link]
                    )
                else:
                    # Không tìm thấy link — mặc định MISSING_REFERENCE nếu ref_list rỗng,
                    # nếu không thì AMBIGUOUS_MAPPING.
                    if not ref_citations:
                        mapping_status = CitationMappingStatus.MISSING_REFERENCE
                        mapping_confidence = 0.0
                        citation_link = None
                    else:
                        mapping_status = CitationMappingStatus.AMBIGUOUS_MAPPING
                        mapping_confidence = 0.0
                        citation_link = None
            # Extract citation context from page text (v1.3 - Neural content alignment)
            #
            # A reference-list entry has no sentence of its own — the useful
            # context is where the paper is cited in the body. Fall back to
            # implicit body discovery (or own page for inline citations) when no
            # linked occurrence provides one.
            citation_context = IntegrityPipeline._extract_reference_context(
                citation,
                document_pages,
                occurrence_by_reference_id,
            )
            if citation_context:
                all_occs = (
                    occurrences_by_reference_id.get(citation.reference_id, [])
                    if citation.reference_id
                    else []
                )
                citation._occurrence_contexts = [  # type: ignore[attr-defined]
                    {
                        "page": occ.page_num,
                        "context": occ.context,
                        "raw": occ.raw_text,
                    }
                    for occ in all_occs
                    if occ.context
                ]
                citation._context_source = (  # type: ignore[attr-defined]
                    "multi_occurrence"
                    if len(citation._occurrence_contexts) > 1
                    else "in_text_citation"
                )
            else:
                if citation.citation_type == CitationType.REFERENCE_LIST and body_pages_for_discovery:
                    discovered = self._discover_implicit_body_context_for_reference(
                        citation, source, body_pages_for_discovery
                    )
                    if isinstance(discovered, tuple) and len(discovered) == 3:
                        disc_page, disc_ctx, _disc_score = discovered
                        citation_context = disc_ctx
                        citation._context_source = "implicit_body_discovery"  # type: ignore[attr-defined]
                        citation._occurrence_contexts = [  # type: ignore[attr-defined]
                            {
                                "page": disc_page,
                                "context": disc_ctx,
                                "raw": f"[Implicit Body Match p.{disc_page}]",
                            }
                        ]
                if not citation_context and (
                    citation.citation_type != CitationType.REFERENCE_LIST
                    or len(document_pages) <= 2
                ):
                    page = IntegrityPipeline._find_context_page(citation, document_pages)
                    if page is not None:
                        citation_context = IntegrityPipeline._extract_citation_context(
                            citation.raw_text,
                            page.text,
                            window_chars=200,
                            fallback_needle=citation.title,
                        )
                        if citation_context:
                            citation._context_source = "in_text_citation"  # type: ignore[attr-defined]

            # NEW v1.5: Persist context onto Citation object so it serializes to
            # the report JSON and reaches the frontend Document View.
            # (Previously the local variable was only used inside the checker call.)
            citation.context = citation_context

            # NEW v1.3: Provenance tracking - compute before calling checker
            has_clean_empty_search = any(
                "no results for" in (err or "").lower()
                or "no title match" in (err or "").lower()
                for err in (source.sources_failed or {}).values()
            )
            api_exhausted = (
                len(source.sources_succeeded) == 0
                and len(source.sources_failed) > 0
                and not has_clean_empty_search
            )
            used_local_db = source.sources_succeeded == ["local_db"] if source.sources_succeeded else False

            # Pass mapping_status + style_profile + citation_context + provenance vào checker
            check_kwargs = {
                "mapping_status": mapping_status,
                "style_profile": style_profile,
                "citation_context": citation_context,
                "api_exhausted": api_exhausted,
                "used_local_db": used_local_db,
            }
            # Older injected checkers (used by downstream integrations and
            # legacy tests) do not accept the v1.3 provenance parameters.
            accepted = inspect.signature(self.checker.check).parameters
            check_kwargs = {
                key: value
                for key, value in check_kwargs.items()
                if key in accepted
            }
            verdict = await asyncio.to_thread(
                self.checker.check, citation, source, **check_kwargs
            )
            verdict.mapping_status = mapping_status
            verdict.mapping_confidence = mapping_confidence
            verdict.citation_link = citation_link
            verdict.citation_links = citation_links_verdict

            # NEW v1.3: Provenance tracking on verdict
            verdict.sources_succeeded = source.sources_succeeded
            verdict.sources_failed = source.sources_failed
            verdict.api_exhausted = api_exhausted
            verdict.used_local_db = used_local_db

            verdicts.append(verdict)
            logger.debug(
                f"  [{verdict.label.value}] conf={verdict.confidence:.2f} "
                f"mapping={verdict.mapping_status.value if verdict.mapping_status else 'NONE'} "
                f"raw={citation.raw_text[:80]}"
            )

        # FIX v1.7: Attach mapping_status (from linker) to in-text citations
        # so the UI Citations tab can display correct Linked/Missing Reference status.
        # In-text citations are NOT in verdicts[] (they don't get source verification),
        # but their mapping status IS stored on the Citation object for serialization.
        for cit in in_text_citations:
            # Try multiple lookup keys since link_by_raw_text is indexed by:
            # 1. occurrence_id (most reliable for numeric [1])
            # 2. normalized identifier
            # 3. raw text lowercased
            links = links_by_key_multi.get(cit.reference_id)  # occurrence_id
            if not links:
                # Try normalized raw text
                normalized = IntegrityPipeline._normalize_identifier(
                    cit.raw_text.replace("\n", " ").replace("  ", " ")
                )
                links = links_by_key_multi.get(normalized)
            if not links:
                links = links_by_key_multi.get(cit.raw_text.lower().strip())
            if links:
                status_priority = {
                    "missing_reference": 5,
                    "in_text_mismatch": 4,
                    "ambiguous_mapping": 3,
                    "style_inconsistent": 2,
                    "unresolved": 1,
                    "matched": 0,
                }
                priority_link = max(
                    links,
                    key=lambda lnk: status_priority.get(
                        lnk.status.value if hasattr(lnk.status, "value") else str(lnk.status),
                        0,
                    ),
                )
                cit.mapping_status = (
                    priority_link.status.value
                    if hasattr(priority_link.status, "value")
                    else str(priority_link.status)
                )
                cit.mapping_confidence = priority_link.confidence
                # Keep BOTH: the list is the source of truth ("[9, 10]" → two
                # refs), the scalar stays as links[0] for legacy consumers.
                cit.citation_links = list(links)
                cit.citation_link = links[0]

        _emit(
            "checking",
            6,
            citations_found=len(in_text_citations) or len(verdicts),
            references_found=len(ref_citations) or len(verdicts),
            message=f"Applied verification rules to {len(verdicts)} citations",
        )

        # 3. Linking summary (counts per CitationMappingStatus) — cho Web UI dashboard
        # FIX v1.7: Count from BOTH verdicts (reference status) AND linking_result.links
        # (in-text status) to get complete picture.
        linking_summary = self._build_linking_summary(verdicts, linking_result)

        # 4. CIS
        cis = self.cis_calc.compute(
            verdicts,
            linking_result=linking_result,
            style_profile=style_profile,
        )

        _emit(
            "scoring",
            7,
            citations_found=len(in_text_citations) or len(all_citations),
            references_found=len(ref_citations) or len(verdicts),
            linked=linking_summary.get("matched", 0),
            message=f"CIS calculated: {cis.score:.1f}/100",
        )

        # 5. Build report
        # FIX: num_citations should reflect unique citations count
        report = AnalysisReport(
            essay_id=essay_id,
            filename=Path(pdf_path).name,
            num_pages=num_pages,
            # ``num_citations`` remains the verification-set size (deduped
            # citations + references) for CIS/library compatibility.  The
            # occurrence-level citation counts exposed by API/UI come from
            # ``extracted_citations``.
            num_citations=len(unique_list),
            extracted_citations=[*in_text_citations, *ref_citations],
            verdicts=verdicts,
            cis=cis,
            linking_summary=linking_summary,
            style_profile=style_profile_dict,
            disclaimer=get_settings().disclaimer.long,
            generated_at=datetime.now().isoformat() + "Z",  # fixed: utcnow deprecated
        )
        logger.info(
            f"Pipeline done: {report.num_citations} citations, CIS={cis.score:.1f}/100"
        )
        if cache_key and self._use_report_cache:
            try:
                self._save_report_cache(cache_key, report)
            except Exception as cache_err:  # noqa: BLE001
                # Cache is best-effort — a serialization bug here must never
                # break the pipeline. Log and move on.
                logger.debug(f"Report cache save skipped: {cache_err}")
        return report

    @staticmethod
    def _normalize_identifier(raw_text: str) -> str:
        """Normalize citation raw_text để so sánh dedup: bỏ doi.org prefix, lowercase.

        "https://doi.org/10.48550/arXiv.1706.03762" → "doi:10.48550/arXiv.1706.03762"
        "10.48550/arXiv.1706.03762" → "doi:10.48550/arXiv.1706.03762"
        "10.18653/v1/N19-1423" → "doi:10.18653/v1/N19-1423"
        "https://doi.org/10.18653/v1/N19-1423" → "doi:10.18653/v1/N19-1423"
        """
        text = raw_text.strip()
        # Bỏ trailing punctuation
        text = text.rstrip(".,;:")
        # Bỏ https://doi.org/ prefix
        doi_prefixes = [
            "https://doi.org/",
            "http://doi.org/",
            "https://doi.org",
            "http://doi.org",
            "doi.org/",
            "doi.org",
        ]
        for prefix in doi_prefixes:
            if text.lower().startswith(prefix.lower()):
                text = text[len(prefix):]
                break
        # Chuẩn hóa: lowercase + strip
        return text.strip().lower()

    @staticmethod
    def _extract_citation_context(
        citation_raw: str,
        page_text: str,
        window_chars: int = 150,
        fallback_needle: str | None = None,
    ) -> str | None:
        """Extract context around a citation from page text.

        Args:
            citation_raw: The citation text (e.g., "(Vaswani et al., 2017)")
            page_text: Full text of the page containing the citation
            window_chars: Number of characters before/after to include
            fallback_needle: Alternative text to search for when the raw text
                does not appear verbatim (e.g. the title of a reference-list
                entry the parser reordered).

        Returns:
            String containing citation with surrounding context, or None if not found
        """
        if not page_text:
            return None

        # Find citation in page text.
        #
        # The raw text of a citation rarely matches the PDF text verbatim: PDF
        # extraction breaks it across lines and wraps long entries, so the
        # citation and the page text differ in whitespace. Matching with a
        # ``\s+`` pattern bridges those breaks while still returning the
        # original text — the context is shown to a human, so its casing and
        # punctuation have to survive intact.
        needles = []
        for candidate in (citation_raw, fallback_needle):
            cleaned = " ".join(candidate.split()) if candidate else ""
            if cleaned:
                needles.append(cleaned)
        if not needles:
            return None

        match = IntegrityPipeline._find_text_span(page_text, needles)
        if match is None:
            return None
        pos, length = match

        start = max(0, pos - window_chars)
        end = min(len(page_text), pos + length + window_chars)

        # Expand slightly to avoid chopping boundary words in half (e.g. "ormalising")
        expand_left = 0
        while (
            start > 0
            and expand_left < 20
            and page_text[start - 1].isalnum()
            and page_text[start].isalnum()
        ):
            start -= 1
            expand_left += 1

        expand_right = 0
        while (
            end < len(page_text)
            and expand_right < 20
            and page_text[end - 1].isalnum()
            and page_text[end].isalnum()
        ):
            end += 1
            expand_right += 1

        context = page_text[start:end].strip()

        # Clean up: repair PDF line-wrap hyphenations and normalize whitespace
        context = re.sub(r"([a-z]{2,})-\s*\n\s*([a-z]{2,})", r"\1\2", context)
        context = " ".join(context.split())  # Normalize whitespace

        return context if len(context) > 20 else None

    @staticmethod
    def _find_text_span(
        page_text: str,
        needles: list[str],
    ) -> tuple[int, int] | None:
        """Locate the first of ``needles`` in ``page_text``.

        Whitespace in the needle matches any run of whitespace in the page, so
        a citation broken across lines is still found. The match is
        case-insensitive, but the returned span points into the ORIGINAL text,
        preserving its casing for display.
        """
        for needle in needles:
            pattern = re.compile(r"\s+".join(re.escape(part) for part in needle.split()))
            match = pattern.search(page_text)
            if match:
                return match.start(), match.end() - match.start()
        return None

    @staticmethod
    def _find_context_page(
        citation: Citation,
        document_pages: list[Page],
    ) -> Page | None:
        """Locate the page a citation really sits on.

        ``page_num`` is authoritative when the parser recorded one: every
        ``[1]`` in the document has its own page, and searching every page in
        order would hand them all the first page's context. Only when the
        page number is missing (reference-list entries, which are not
        positionally tracked) do we fall back to scanning.
        """
        if citation.page_num and 1 <= citation.page_num <= len(document_pages):
            page = document_pages[citation.page_num - 1]
            if page and page.text:
                return page
        for page in document_pages:
            if not page.text:
                continue
            if IntegrityPipeline._find_text_span(page.text, [citation.raw_text]):
                return page
        # Last resort: a bibliography entry whose raw text never appears
        # verbatim (the parser reorders it, e.g. "Settles, B, Learning, Active"
        # for "[10] B. Settles, Active Learning") still has a title that does
        # appear on the page. Match on the title so the entry is not left
        # without any context. Very short titles are too generic to be a
        # reliable signal, so they are not used.
        title = " ".join((citation.title or "").split())
        if len(title) < 12:
            return None
        for page in document_pages:
            if not page.text:
                continue
            if IntegrityPipeline._find_text_span(page.text, [title]):
                return page
        return None

    @staticmethod
    def _extract_reference_context(
        citation: Citation,
        document_pages: list[Page],
        occurrence_by_reference_id: dict[str, Citation],
    ) -> str | None:
        """Find context for a bibliography entry.

        A reference-list entry has no sentence of its own — the useful
        context is the sentence in the body where the paper is actually
        cited. We look for the in-text occurrence linked to this reference
        and take its context.
        """
        if not citation.reference_id:
            return None
        occurrence = occurrence_by_reference_id.get(citation.reference_id)
        if occurrence is None:
            return None
        if occurrence.context:
            return occurrence.context
        page = IntegrityPipeline._find_context_page(occurrence, document_pages)
        if page is None:
            return None
        return IntegrityPipeline._extract_citation_context(
            occurrence.raw_text,
            page.text,
            window_chars=200,
            fallback_needle=occurrence.title,
        )

    @staticmethod
    def _merge_citations(
        body: list[Citation],
        references: list[Citation],
        appendix: list[Citation],
    ) -> list[Citation]:
        """Gộp + dedupe theo (style, normalized identifier). Reference list ưu tiên (có title).

        Flow v1.2:
            1. References trước (chứa title + DOI — đầy đủ nhất)
            2. body_citations (in-text — thiếu title)
            3. appendix_citations last (out-of-scope nhưng vẫn kiểm tra)

        Deduplication: normalize DOI/URL để "10.48550/arXiv.1706.03762" và
        "https://doi.org/10.48550/arXiv.1706.03762" được nhận diện là cùng 1 ref.
        """
        seen: set[tuple[str, str]] = set()
        merged: list[Citation] = []
        for source_list in (references, body, appendix):
            for c in source_list:
                # Dùng normalized identifier thay vì raw_text để dedupe
                normalized = IntegrityPipeline._normalize_identifier(c.raw_text)
                key = (c.style.value, normalized)
                if key not in seen:
                    seen.add(key)
                    merged.append(c)
        return merged

    @staticmethod
    def _merge_citations_legacy(
        in_text: list[Citation], ref_list: list[Citation]
    ) -> list[Citation]:
        """Legacy merge (backward compat cho fallback path) with DOI/URL normalization."""
        seen: set[tuple[str, str]] = set()
        merged: list[Citation] = []
        for c in ref_list:
            normalized = IntegrityPipeline._normalize_identifier(c.raw_text)
            key = (c.style.value, normalized)
            if key not in seen:
                seen.add(key)
                merged.append(c)
        for c in in_text:
            normalized = IntegrityPipeline._normalize_identifier(c.raw_text)
            key = (c.style.value, normalized)
            if key not in seen:
                seen.add(key)
                merged.append(c)
        return merged

    # --- v1.2 §3.5 helpers (linking + style) ---

    def _detect_style(
        self,
        in_text: list[Citation],
        references: list[Citation],
    ) -> StyleProfile:
        """Detect document-level style từ in-text + reference citations.

        Convert từ extraction.StyleProfile → linking.StyleProfile.
        extraction schema: ``label`` ('APA-like' / 'IEEE-like' / 'MIXED' / 'UNKNOWN')
        + ``ratios`` dict + ``features`` StyleFeatures.
        linking schema: ``style`` + ``apa_count`` + ``numeric_count`` + ``evidence``.

        Nếu StyleDetector raise → fallback APA-LIKE.
        """
        try:
            from integrity_checker.extraction.style_detector import StyleDetector

            detector = StyleDetector()
            ext_profile = detector.detect(in_text, references)
            # Map label (e.g. 'APA-like') → linking style 'APA-LIKE'
            style_value = (ext_profile.label or "UNKNOWN").upper()
            ratios = ext_profile.ratios or {}
            apa_count = (
                ext_profile.apa_count
                if getattr(ext_profile, "apa_count", 0)
                else int(ratios.get("apa_count", 0) + ratios.get("APA_count", 0))
            )
            numeric_count = (
                ext_profile.numeric_count
                if getattr(ext_profile, "numeric_count", 0)
                else int(ratios.get("ieee_count", 0) + ratios.get("IEEE_count", 0))
            )
            return StyleProfile(
                style=style_value,
                confidence=ext_profile.confidence,
                apa_count=apa_count,
                numeric_count=numeric_count,
                evidence={"ratios": dict(ratios), "explanation": ext_profile.explanation},
            )
        except Exception as e:  # noqa: BLE001
            logger.warning(f"Style detection failed: {e}; fallback APA-LIKE")
            return StyleProfile(
                style="APA-LIKE",
                confidence=0.0,
                apa_count=0,
                numeric_count=0,
                evidence={"error": str(e)},
            )

    @staticmethod
    def _serialize_style_profile(profile: StyleProfile) -> dict[str, Any]:
        """linking.StyleProfile → JSON-friendly dict."""
        return {
            "style": profile.style,
            "confidence": profile.confidence,
            "apa_count": profile.apa_count,
            "numeric_count": profile.numeric_count,
            "evidence": dict(profile.evidence) if profile.evidence else {},
        }

    @staticmethod
    def _populate_citation_metadata(
        in_text: list[Citation],
        references: list[Citation],
        link_lookup: dict[str, CitationLink],
    ) -> None:
        """Populate citation metadata from matched reference entries.

        For numeric citations like "[1]" that have no title/author/year,
        copy metadata from the matched reference entry.

        This ensures that verification can use the full reference metadata
        even when the in-text citation is just a number.
        """
        # Build reference lookup by reference_id
        ref_by_id: dict[str, Citation] = {}
        for ref in references:
            if ref.reference_id:
                ref_by_id[ref.reference_id] = ref

        for citation in in_text:
            # Only populate if citation lacks essential metadata
            if citation.title and citation.authors and citation.year:
                continue

            # Find matching reference via link lookup by occurrence_id
            # (in-text citations have occurrence_id as their reference_id)
            link = link_lookup.get(citation.reference_id)

            if link and link.reference_id:
                ref = ref_by_id.get(link.reference_id)
                if ref:
                    # Copy metadata from reference if citation lacks it
                    if not citation.title and ref.title:
                        citation.title = ref.title
                    if not citation.authors and ref.authors:
                        citation.authors = ref.authors
                    if not citation.year and ref.year:
                        citation.year = ref.year
                    if not citation.doi and ref.doi:
                        citation.doi = ref.doi

    @staticmethod
    def _extract_occurrence_contexts(
        in_text: list[Citation],
        document_pages: list[Page],
        links_by_key_multi: dict[str, list[CitationLink]],
    ) -> dict[str, Citation]:
        """Give every in-text occurrence its surrounding PDF text.

        Returns a map from ``reference_id`` to the first occurrence that cites
        it, so a bibliography entry can borrow the sentence where the paper is
        actually used. Occurrences are keyed by the reference they point at,
        not by their own id.
        """
        occurrence_by_reference_id: dict[str, Citation] = {}
        for citation in in_text:
            page = IntegrityPipeline._find_context_page(citation, document_pages)
            if page is not None:
                citation.context = IntegrityPipeline._extract_citation_context(
                    citation.raw_text,
                    page.text,
                    window_chars=200,
                )
            if not citation.context:
                continue

            # Record the occurrence under every reference it cites — "[9, 10]"
            # points at two bibliography entries and both may want this text.
            for link in IntegrityPipeline._links_for_occurrence(
                citation, links_by_key_multi
            ):
                reference_id = getattr(link, "reference_id", None)
                if reference_id and reference_id not in occurrence_by_reference_id:
                    occurrence_by_reference_id[reference_id] = citation
        return occurrence_by_reference_id

    @staticmethod
    def _extract_all_occurrence_contexts(
        in_text: list[Citation],
        links_by_key_multi: dict[str, list[CitationLink]],
    ) -> dict[str, list[Citation]]:
        """Return a map from ``reference_id`` to ALL in-text occurrences citing it."""
        occurrences_by_ref: dict[str, list[Citation]] = {}
        for citation in in_text:
            if not citation.context:
                continue
            for link in IntegrityPipeline._links_for_occurrence(
                citation, links_by_key_multi
            ):
                reference_id = getattr(link, "reference_id", None)
                if reference_id:
                    occurrences_by_ref.setdefault(reference_id, []).append(citation)
        return occurrences_by_ref

    @staticmethod
    def _filter_body_pages_for_discovery(
        document_pages: list[Page],
        ref_citations: list[Citation],
    ) -> list[Page]:
        """Return body pages (excluding the bibliography/references pages at the end)."""
        if not document_pages:
            return []
        ref_page_nums = {
            c.page_num
            for c in ref_citations
            if c.page_num and 1 <= c.page_num <= len(document_pages)
        }
        ref_heading_re = re.compile(
            r"^\s*(?:\d+\.?\s*)?(?:references|bibliography|tài\s+liệu\s+tham\s+khảo)\s*$",
            re.IGNORECASE | re.MULTILINE,
        )
        bib_entry_re = re.compile(r"^\s*\[\d+\]\s+[A-Z]", re.MULTILINE)
        body_pages: list[Page] = []
        in_references_section = False
        for p in document_pages:
            if not p or not p.text:
                continue
            if p.page_num in ref_page_nums:
                in_references_section = True
                continue
            if p.page_num >= max(2, len(document_pages) // 2) and ref_heading_re.search(p.text[:600]):
                in_references_section = True
                continue
            if in_references_section:
                continue
            if len(bib_entry_re.findall(p.text)) >= 3:
                continue
            body_pages.append(p)
        return body_pages

    def _discover_implicit_body_context_for_reference(
        self,
        citation: Citation,
        source: SourceResult | None,
        body_pages: list[Page],
    ) -> tuple[int, str, float] | None:
        """Discover the most semantically aligned body passage for an uncited bibliography entry."""
        try:
            fc = getattr(self.checker, "feature_calculator", None)
            sem = getattr(fc, "semantic", None) if fc is not None else None
            if sem is None or not hasattr(sem, "discover_implicit_body_context"):
                return None
            best = source.best_candidate() if source is not None else None
            title = (best.title if best and best.title else citation.title) or ""
            abstract = best.abstract if best and best.abstract else None
            if not abstract and source is not None and source.candidates:
                for cand in source.candidates:
                    if cand.found and cand.abstract and cand.abstract.strip():
                        abstract = cand.abstract
                        break
            authors = citation.authors or (best.authors if best else None)
            author_strs = [str(a) for a in (authors or [])]
            page_tuples = [(p.page_num, p.text) for p in body_pages if p and p.text]
            return sem.discover_implicit_body_context(
                body_pages=page_tuples,
                source_title=title,
                source_abstract=abstract,
                source_authors=author_strs,
            )
        except Exception as exc:  # noqa: BLE001
            logger.debug(f"Implicit body context discovery skipped: {exc}")
            return None

    @staticmethod
    def _links_for_occurrence(
        citation: Citation,
        links_by_key_multi: dict[str, list[CitationLink]],
    ) -> list[CitationLink]:
        """Every link whose occurrence is this citation.

        The lookup map is keyed by occurrence id, normalised identifier and
        raw text, so the same occurrence can be reached several ways; the
        first key that resolves wins.
        """
        keys = [citation.reference_id] if citation.reference_id else []
        raw = " ".join(citation.raw_text.split())
        if raw:
            keys.append(raw.lower())
            keys.append(IntegrityPipeline._normalize_identifier(raw))
        for key in keys:
            if not key:
                continue
            links = links_by_key_multi.get(key)
            if links:
                return links
        return []

    def _run_linking(
        self,
        in_text: list[Citation],
        references: list[Citation],
        style_profile: StyleProfile,
    ) -> LinkingResult:
        """Chạy CitationLinker.link() với Citation[].

        Wraps in-text citations và references để populate occurrence_id/reference_id,
        sau đó gọi CitationLinker.link(body_citations, bib_citations).

        Returns:
            LinkingResult với links, unmatched_reference_ids, status_counts.
        """
        # Populate occurrence_id/reference_id trên citations
        body_with_ids: list[Citation] = []
        for idx, c in enumerate(in_text):
            c.reference_id = f"occ-{idx + 1:04d}"
            body_with_ids.append(c)

        bib_with_ids: list[Citation] = []
        for idx, c in enumerate(references):
            c.reference_id = f"ref-{idx + 1:04d}"
            bib_with_ids.append(c)

        return self.linker.link(body_with_ids, bib_with_ids)

    @staticmethod
    def _build_link_lookup(
        links: list[CitationLink],
    ) -> dict[str, CitationLink]:
        """Map normalized identifier → CitationLink cho O(1) lookup từ verdict.

        Indexes by (in priority order):
          1. occurrence_id (in-text citation's stable ID)
          2. normalized identifier (DOI/URL forms)
          3. raw text lowercased (for non-DOI citations)
        """
        lookup: dict[str, CitationLink] = {}
        for link in links:
            # Index by occurrence_id FIRST (most reliable for numeric citations)
            if link.occurrence_id:
                lookup[link.occurrence_id] = link

            evidence = link.evidence or {}
            raw = evidence.get("raw", "") or evidence.get("raw_text", "")
            if raw:
                # Normalize newlines and extra spaces first (for consistent matching)
                raw_normalized = raw.replace("\n", " ").replace("  ", " ").strip()
                # Normalize: both DOI and URL form map to same key
                normalized = IntegrityPipeline._normalize_identifier(raw_normalized)
                lookup[normalized] = link
                # Also index by raw as fallback (for non-DOI citations)
                lookup[raw_normalized.lower()] = link
        return lookup

    @staticmethod
    def _build_link_lookup_multi(
        links: list[CitationLink],
    ) -> dict[str, list[CitationLink]]:
        """Map normalized identifier → EVERY CitationLink sharing that key.

        The single-slot :meth:`_build_link_lookup` cannot represent an
        occurrence that cites several references at once: ``"[9, 10]"`` yields
        two links with the SAME ``occurrence_id``, so the dict assignment kept
        only the last one and ``ref-0009`` silently disappeared from the report.

        This variant APPENDS instead, so all links of an occurrence survive.
        Keys are the same three the single-slot version uses (occurrence_id,
        normalized identifier, lowercased raw text), and the lists keep the
        linker's emission order.

        Callers that only need "the" link can keep using
        :meth:`_build_link_lookup`; this one is for persistence/serialization
        where every edge must be preserved.
        """
        lookup: dict[str, list[CitationLink]] = {}

        def _add(key: str, link: CitationLink) -> None:
            if not key:
                return
            bucket = lookup.setdefault(key, [])
            # Guard against re-adding the identical edge (the three key forms
            # can collide, e.g. a raw text that normalizes to itself).
            if link not in bucket:
                bucket.append(link)

        for link in links:
            # Index by occurrence_id FIRST (most reliable for numeric citations)
            _add(link.occurrence_id, link)

            evidence = link.evidence or {}
            raw = evidence.get("raw", "") or evidence.get("raw_text", "")
            if raw:
                raw_normalized = raw.replace("\n", " ").replace("  ", " ").strip()
                _add(IntegrityPipeline._normalize_identifier(raw_normalized), link)
                _add(raw_normalized.lower(), link)
        return lookup

    @staticmethod
    def _build_linking_summary(
        verdicts: list[CitationVerdict],
        linking_result: LinkingResult | None = None,
    ) -> dict[str, int]:
        """Build linking summary for Web UI dashboard.

        FIX v1.7: Separate counts for references vs in-text to avoid double-counting.
        - Reference statuses (from verdicts): MATCHED, UNCUTED_REFERENCE, DUPLICATE_REFERENCE, etc.
        - In-text statuses (from links): matched/missing_reference/ambiguous for in-text citations.

        Returns a flat dict[str, int] for backward compat. Reference counts are
        prefixed with 'ref_' to distinguish from in-text 'matched'/'missing_reference'.
        """
        counts: dict[str, int] = {s.value: 0 for s in CitationMappingStatus}

        # Reference statuses from verdicts (only REFERENCE_LIST have verdicts)
        for v in verdicts:
            if v.mapping_status is not None:
                status_value = (
                    v.mapping_status.value
                    if hasattr(v.mapping_status, "value")
                    else str(v.mapping_status)
                )
                counts[status_value] = counts.get(status_value, 0) + 1

        # In-text mapping from linking_result.links
        # (only for non-reference links, to avoid double-counting)
        if linking_result is not None and linking_result.links:
            for link in linking_result.links:
                status_value = (
                    link.status.value
                    if hasattr(link.status, "value")
                    else str(link.status)
                )
                # Only count non-MATCHED in-text links separately to avoid double-counting
                # MATCHED is already counted from verdicts for references
                if status_value != "matched":
                    counts[status_value] = counts.get(status_value, 0) + 1

        return counts


# ============================================================
# CLI entry-point
# ============================================================


def _serialize_author(author: Any) -> str:
    """Serialize parser Author objects and plain strings uniformly."""
    if isinstance(author, str):
        return author
    if hasattr(author, "last_name"):
        parts = [getattr(author, "last_name", "")]
        for attr in ("first_name", "middle_name"):
            value = getattr(author, attr, None)
            if value:
                parts.append(value)
        return " ".join(part for part in parts if part)
    return str(author)


def _serialize_citation(citation: Citation) -> dict[str, Any]:
    """Serialize all citation metadata needed by report-cache rehydration."""
    return {
        "raw_text": citation.raw_text,
        "citation_type": citation.citation_type.value,
        "style": citation.style.value,
        "authors": [_serialize_author(author) for author in (citation.authors or [])],
        "year": citation.year,
        "title": citation.title,
        "venue": citation.venue,
        "doi": citation.doi,
        "url": citation.url,
        "volume": citation.volume,
        "issue": citation.issue,
        "pages": citation.pages,
        "title_normalized": citation.title_normalized,
        "year_suffix": citation.year_suffix,
        "order_index": citation.order_index,
        "numeric_index": citation.numeric_index,
        "page_num": citation.page_num,
        "paragraph_num": citation.paragraph_num,
        "matched_pattern": citation.matched_pattern,
        "raw_in_text_citation": citation.raw_in_text_citation,
        "confidence": citation.confidence,
        "reference_id": citation.reference_id,
        "context": citation.context,
        # NEW v1.7: linking layer (for in-text citations in UI Citations tab)
        "mapping_status": getattr(citation, "mapping_status", None),
        "mapping_confidence": getattr(citation, "mapping_confidence", 0.0),
        "citation_link": _serialize_citation_link(getattr(citation, "citation_link", None)),
        # NEW v1.9: every edge of the occurrence, not only the first. The
        # single-link field above is kept so existing report consumers keep
        # working; this is the lossless one.
        "citation_links": _serialize_citation_link_list(
            getattr(citation, "citation_links", None)
            or getattr(citation, "citation_link", None)
        ),
        # NEW v1.10: GROBID adapter provenance tracking
        "source": getattr(citation, "source", "regex"),
        "source_confidence": getattr(citation, "source_confidence", None),
        "grobid_ref_id": getattr(citation, "grobid_ref_id", None),
        "is_grobid_linked": getattr(citation, "is_grobid_linked", False),
        "conflict_fields": getattr(citation, "conflict_fields", []),
    }


def _deserialize_citation(data: dict[str, Any]) -> Citation:
    """Deserialize a cached citation without rerunning PDF extraction."""
    try:
        citation_type = CitationType(data.get("citation_type", CitationType.UNKNOWN.value))
    except ValueError:
        citation_type = CitationType.UNKNOWN
    try:
        style = CitationStyle(data.get("style", CitationStyle.UNKNOWN.value))
    except ValueError:
        style = CitationStyle.UNKNOWN
    return Citation(
        raw_text=data.get("raw_text", ""),
        citation_type=citation_type,
        style=style,
        authors=list(data.get("authors") or []),
        year=data.get("year"),
        title=data.get("title"),
        venue=data.get("venue"),
        doi=data.get("doi"),
        url=data.get("url"),
        volume=data.get("volume"),
        issue=data.get("issue"),
        pages=data.get("pages"),
        title_normalized=data.get("title_normalized"),
        year_suffix=data.get("year_suffix"),
        order_index=int(data.get("order_index", 0)),
        numeric_index=data.get("numeric_index"),
        page_num=int(data.get("page_num", 0)),
        paragraph_num=int(data.get("paragraph_num", 0)),
        matched_pattern=data.get("matched_pattern"),
        raw_in_text_citation=data.get("raw_in_text_citation"),
        confidence=float(data.get("confidence", 0.0)),
        reference_id=data.get("reference_id"),
        context=data.get("context"),
        # NEW v1.7: linking layer
        mapping_status=data.get("mapping_status"),
        mapping_confidence=float(data.get("mapping_confidence", 0.0)),
        citation_link=_deserialize_citation_link(data.get("citation_link")),
        citation_links=_deserialize_citation_link_list(
            data.get("citation_links") if data.get("citation_links") is not None
            else data.get("citation_link")
        ),
        # NEW v1.10: GROBID adapter provenance
        source=data.get("source", "regex"),
        source_confidence=data.get("source_confidence"),
        grobid_ref_id=data.get("grobid_ref_id"),
        is_grobid_linked=data.get("is_grobid_linked", False),
        conflict_fields=list(data.get("conflict_fields") or []),
    )


def _match_features_from_dict(data: dict[str, Any]) -> MatchFeatures:
    """Build ``MatchFeatures`` while tolerating older cache schemas."""
    return MatchFeatures(
        title_sim_fuzzy=float(data.get("title_sim_fuzzy") or 0.0),
        title_sim_semantic=float(data.get("title_sim_semantic") or 0.0),
        author_jaccard=float(data.get("author_jaccard") or 0.0),
        year_distance=int(data.get("year_distance") if data.get("year_distance") is not None else 999),
        doi_exact_match=bool(data.get("doi_exact_match") or False),
        source_consensus=int(data.get("source_consensus") or 0),
        venue_sim=float(data.get("venue_sim") or 0.0),
        content_alignment_score=float(data.get("content_alignment_score") or 0.0),
        content_alignment_confidence=data.get("content_alignment_confidence") or "",
        content_is_aligned=bool(data.get("content_is_aligned") or False),
        title_context_sim=float(data.get("title_context_sim") or 0.0),
        abstract_context_sim=(
            float(data["abstract_context_sim"])
            if data.get("abstract_context_sim") is not None
            else None
        ),
        best_evidence_sentence=data.get("best_evidence_sentence"),
        best_evidence_score=(
            float(data["best_evidence_score"])
            if data.get("best_evidence_score") is not None
            else None
        ),
        best_cited_sentence=data.get("best_cited_sentence"),
        citation_intent=data.get("citation_intent") or "",
        stance_label=data.get("stance_label") or "",
        cross_lingual_detected=bool(data.get("cross_lingual_detected") or False),
        bridged_concepts=list(data.get("bridged_concepts") or []),
        cross_lingual_title_detected=bool(data.get("cross_lingual_title_detected") or False),
        cross_lingual_title_sim=float(data.get("cross_lingual_title_sim") or 0.0),
        context_source=data.get("context_source") or "",
        occurrence_alignments=list(data.get("occurrence_alignments") or []),
    )


def _deserialize_citation_link(data: Any) -> CitationLink | None:
    """Deserialize an optional linker edge from a cached report."""
    if not data:
        return None
    try:
        status = CitationMappingStatus(data.get("status", CitationMappingStatus.UNRESOLVED.value))
    except ValueError:
        status = CitationMappingStatus.UNRESOLVED
    try:
        from integrity_checker.models.validation import MappingMethod

        method = MappingMethod(data.get("method", MappingMethod.NO_KEYS.value))
    except ValueError:
        method = "no_keys"
    return CitationLink(
        occurrence_id=data.get("occurrence_id", ""),
        reference_id=data.get("reference_id"),
        status=status,
        confidence=float(data.get("confidence", 0.0)),
        method=method,
        evidence=dict(data.get("evidence") or {}),
        page=int(data.get("page", 0)),
        section=data.get("section", ""),
    )


def _serialize_verdict_for_json(v: CitationVerdict) -> dict[str, Any]:
    """CitationVerdict không JSON-serializable do Citation dataclass nested."""
    archive_url = getattr(v, "archive_url", None) or (
        getattr(v.matched_source, "archive_url", None) if v.matched_source else None
    )
    is_retracted = bool(
        getattr(v, "is_retracted", False)
        or (getattr(v.matched_source, "is_retracted", False) if v.matched_source else False)
    )
    matched_sources: list[dict[str, Any]] = []
    if v.matched_source and getattr(v.matched_source, "candidates", None):
        for cand in v.matched_source.candidates:
            if not getattr(cand, "found", True):
                continue
            matched_sources.append(
                {
                    "source_name": cand.source_name,
                    "title": cand.title,
                    "authors": list(cand.authors or []),
                    "year": cand.year,
                    "doi": cand.doi,
                    "venue": cand.venue,
                    "url": cand.url,
                    "confidence": cand.confidence,
                }
            )
    return {
        "citation_raw": v.citation.raw_text,
        "label": v.label.value,
        "confidence": v.confidence,
        "reasoning": v.reasoning,
        "triggered_rules": v.triggered_rules,
        "mismatched_fields": v.mismatched_fields,
        "features": {
            "title_sim_fuzzy": v.features.title_sim_fuzzy if v.features else 0.0,
            "title_sim_semantic": v.features.title_sim_semantic if v.features else 0.0,
            "author_jaccard": v.features.author_jaccard if v.features else 0.0,
            "year_distance": v.features.year_distance if v.features else 999,
            "doi_exact_match": v.features.doi_exact_match if v.features else False,
            "source_consensus": v.features.source_consensus if v.features else 0,
            "venue_sim": v.features.venue_sim if v.features else 0.0,
            "content_alignment_score": v.features.content_alignment_score if v.features else 0.0,
            "content_alignment_confidence": v.features.content_alignment_confidence if v.features else "",
            "content_is_aligned": v.features.content_is_aligned if v.features else False,
            "title_context_sim": getattr(v.features, "title_context_sim", 0.0) if v.features else 0.0,
            "abstract_context_sim": getattr(v.features, "abstract_context_sim", None) if v.features else None,
            "best_evidence_sentence": getattr(v.features, "best_evidence_sentence", None) if v.features else None,
            "best_evidence_score": getattr(v.features, "best_evidence_score", None) if v.features else None,
            "best_cited_sentence": getattr(v.features, "best_cited_sentence", None) if v.features else None,
            "citation_intent": getattr(v.features, "citation_intent", "") if v.features else "",
            "stance_label": getattr(v.features, "stance_label", "") if v.features else "",
            "cross_lingual_detected": getattr(v.features, "cross_lingual_detected", False) if v.features else False,
            "bridged_concepts": list(getattr(v.features, "bridged_concepts", []) or []) if v.features else [],
            "cross_lingual_title_detected": getattr(v.features, "cross_lingual_title_detected", False) if v.features else False,
            "cross_lingual_title_sim": getattr(v.features, "cross_lingual_title_sim", 0.0) if v.features else 0.0,
            "context_source": getattr(v.features, "context_source", "") if v.features else "",
            "occurrence_alignments": getattr(v.features, "occurrence_alignments", []) if v.features else [],
            "url_status": getattr(v.matched_source, "url_status", None) if v.matched_source else None,
            "url_status_code": getattr(v.matched_source, "url_status_code", None) if v.matched_source else None,
            "checked_url": getattr(v.citation, "url", None) if v.citation else None,
            "archive_url": archive_url,
            "is_retracted": is_retracted,
        },
        "url_status": getattr(v.matched_source, "url_status", None) if v.matched_source else None,
        "url_status_code": getattr(v.matched_source, "url_status_code", None) if v.matched_source else None,
        "archive_url": archive_url,
        "is_retracted": is_retracted,
        "matched_sources": matched_sources,
        "domain_exception": getattr(v, "domain_exception", False),
        # NEW v1.3: Provenance tracking
        "provenance": {
            "sources_succeeded": v.sources_succeeded,
            "sources_failed": v.sources_failed,
            "api_exhausted": v.api_exhausted,
            "used_local_db": v.used_local_db,
        },
        "warnings": _get_verdict_warnings(v),
    }


def _get_verdict_warnings(v: CitationVerdict) -> list[str]:
    """Generate warning flags based on provenance (for CLI)."""
    return _get_verdict_warnings_from_verdict(v)


def _get_verdict_warnings_from_verdict(v: CitationVerdict) -> list[str]:
    """Generate warning flags based on provenance (for JSON serialization)."""
    warnings = []

    if v.api_exhausted:
        warnings.append("API_EXHAUSTED: All external APIs failed - verification based on limited data")

    if v.used_local_db and not v.api_exhausted:
        warnings.append("LOCAL_DB: Result from local database")

    if v.api_exhausted and v.label.value == "verified":
        warnings.append("CAUTION: Verified despite API failures - confidence reduced")

    if len(v.sources_succeeded) == 1 and v.sources_succeeded[0] == "local_db":
        warnings.append("LOCAL_DB_ONLY: Verification from local database only")

    return warnings


def _serialize_citation_link(link: Any) -> dict[str, Any]:
    """CitationLink → JSON-friendly dict.

    Handles enum values, dict evidence, optional fields.
    """
    if link is None:
        return {}
    status = link.status
    method = link.method
    return {
        "occurrence_id": link.occurrence_id,
        "reference_id": link.reference_id,
        "status": status.value if hasattr(status, "value") else str(status),
        "confidence": link.confidence,
        "method": method.value if hasattr(method, "value") else str(method),
        "evidence": dict(link.evidence) if link.evidence else {},
        "page": link.page,
        "section": link.section,
    }


def _serialize_citation_link_list(links: Any) -> list[dict[str, Any]]:
    """[CitationLink] → list of JSON-friendly dicts.

    An occurrence may cite several references at once ("[9, 10]"), so the
    report must carry EVERY edge, not just the first. Tolerates a bare single
    link (legacy callers that still hold ``citation_link``) by wrapping it.
    """
    if links is None:
        return []
    if not isinstance(links, (list, tuple)):
        links = [links]
    return [_serialize_citation_link(link) for link in links if link is not None]


def _deserialize_citation_link_list(data: Any) -> list[CitationLink]:
    """list[dict] → [CitationLink], tolerating the legacy single-dict shape.

    Reports cached before v1.9 stored ``citation_link`` as ONE object; reading
    them must still work, so a dict is treated as a one-element list.
    """
    if not data:
        return []
    if isinstance(data, dict):
        data = [data]
    if not isinstance(data, (list, tuple)):
        return []
    out: list[CitationLink] = []
    for item in data:
        if isinstance(item, dict):
            link = _deserialize_citation_link(item)
            if link is not None:
                out.append(link)
    return out


def _serialize_matched_sources(source: Any) -> list[dict[str, Any]]:
    """SourceResult → list of MatchedSource-shaped dicts for the API.

    Each dict carries the data the frontend EvidenceGraph needs:
    source name, which fields were matched, the URL/DOI, and the
    candidate's confidence.

    Only successful (found=True) candidates are returned, plus a fallback
    entry per source we queried so the UI can show the database even when
    it returned no hits.
    """
    out: list[dict[str, Any]] = []
    if source is None:
        return out
    candidates = getattr(source, "candidates", None) or []
    for c in candidates:
        if not getattr(c, "found", False):
            continue
        matched_fields: list[str] = []
        if getattr(c, "doi", None):
            matched_fields.append("doi")
        if getattr(c, "title", None):
            matched_fields.append("title")
        if getattr(c, "authors", None):
            matched_fields.append("authors")
        if getattr(c, "year", None):
            matched_fields.append("year")
        if getattr(c, "venue", None):
            matched_fields.append("venue")
        raw_authors = getattr(c, "authors", None) or []
        serialized_authors: list[str] = []
        for a in raw_authors:
            if isinstance(a, str):
                serialized_authors.append(a)
            elif hasattr(a, "last_name"):
                parts = [getattr(a, "last_name", ""), getattr(a, "first_name", "")]
                serialized_authors.append(" ".join(p for p in parts if p))
            else:
                serialized_authors.append(str(a))
        out.append({
            "source": getattr(c, "source_name", "unknown"),
            "matched_fields": matched_fields,
            "checked_at": datetime.now(UTC).isoformat(),
            "url": getattr(c, "url", None),
            "doi": getattr(c, "doi", None),
            "title": getattr(c, "title", None),
            "authors": serialized_authors,
            "year": str(getattr(c, "year", "")) if getattr(c, "year", None) else None,
            "venue": getattr(c, "venue", None),
            "confidence": float(getattr(c, "confidence", 0.0) or 0.0),
        })
    return out


def _deserialize_matched_sources(
    payload: Any,
    url_status: str | None = None,
    url_status_code: int | None = None,
    archive_url: str | None = None,
    is_retracted: bool = False,
) -> SourceResult | None:
    """Rebuild a minimal SourceResult from a list of MatchedSource dicts.

    Used when rehydrating cached reports so the API keeps returning
    ``matched_sources`` instead of silently dropping them.
    """
    candidates: list[SourceCandidate] = []
    succeeded: list[str] = []
    for item in payload or []:
        if not isinstance(item, dict):
            continue
        name = (item.get("source") or "unknown").lower()
        candidates.append(
            SourceCandidate(
                source_name=name,
                found=True,
                doi=item.get("doi"),
                title=item.get("title"),
                authors=item.get("authors") or [],
                year=item.get("year"),
                venue=item.get("venue"),
                url=item.get("url"),
                confidence=float(item.get("confidence", 0.0) or 0.0),
            )
        )
        if name not in succeeded:
            succeeded.append(name)
    if not candidates and url_status is None and archive_url is None and not is_retracted:
        return None
    return SourceResult(
        citation_raw="",
        candidates=candidates,
        sources_queried=list(succeeded),
        sources_succeeded=list(succeeded),
        url_status=url_status,
        url_status_code=url_status_code,
        archive_url=archive_url,
        is_retracted=is_retracted,
    )


def main() -> None:
    """CLI: python -m integrity_checker.pipeline.integrity_pipeline FILE [--output FILE]"""
    configure_logging()
    # Ensure DB schema + migrations are up to date before any session is opened.
    from integrity_checker.db.session import init_db
    init_db()

    parser = argparse.ArgumentParser(
        description="Essay Integrity Checker — run pipeline trên 1 PDF tiểu luận"
    )
    parser.add_argument("pdf", help="Đường dẫn tới PDF essay")
    parser.add_argument(
        "--output", "-o",
        default=None,
        help="Đường dẫn output JSON (mặc định: reports/<pdf-stem>.json)",
    )
    parser.add_argument(
        "--stdout",
        action="store_true",
        help="Chỉ in summary ra stdout, không ghi file JSON",
    )
    parser.add_argument("--essay-id", type=int, default=0)
    parser.add_argument(
        "--no-document-parser",
        action="store_true",
        help="Dùng legacy flow (PyMuPDF + regex) thay vì DocumentParser",
    )
    parser.add_argument(
        "--grobid-status",
        action="store_true",
        help="Hiển thị GROBID status trước khi xử lý",
    )
    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Hiển thị chi tiết log (bao gồm parser warnings)",
    )
    args = parser.parse_args()

    pdf_path = Path(args.pdf)
    if not pdf_path.exists():
        logger.error(f"File không tồn tại: {pdf_path}")
        raise SystemExit(1)

    # Show GROBID status if requested
    if args.grobid_status:
        try:
            from integrity_checker.extraction import get_grobid_manager

            manager = get_grobid_manager()
            status = manager.check_health()
            print("\n" + "=" * 50)
            print(" GROBID Status:")
            print(f"  Container: {manager._container_name}")
            print(f"  Status: {status.value}")
            print(f"  URL: {manager.url}")
            if manager.is_container_running():
                print(f"  Container ID: {manager.stats.container_id or 'N/A'}")
            print(f"  Parser mode: {'grobid' if manager.is_available else 'regex'}")
            print(f"  Cache: {'enabled' if manager.config.cache_by_file_sha256 else 'disabled'}")
            print("=" * 50 + "\n")
        except Exception as exc:
            print(f"\n⚠ GROBID status check failed: {exc}\n")

    # Show verbose log level if requested
    if args.verbose:
        import logging as _logging
        _logging.getLogger().setLevel(_logging.DEBUG)

    pipeline = IntegrityPipeline(
        use_document_parser=not args.no_document_parser
    )
    report = pipeline.run(str(pdf_path), essay_id=args.essay_id)

    # In summary
    print("\n" + "=" * 70)
    print(f" ESSAY: {report.filename}")
    print(f" Pages: {report.num_pages}  |  Citations: {report.num_citations}")
    if report.cis:
        print(
            f" CIS (Citation Integrity Score): {report.cis.score:.1f}/100  "
            f"(unresolved: {report.cis.num_unresolved})"
        )
    print("=" * 70)
    print("\n Verdicts:")
    for v in report.verdicts:
        marker = {
            "verified": "✓",
            "metadata_error": "△",
            "suspected_hallucination": "✗",
            "unresolved": "?",
            "resource": "🔗",
        }[v.label.value]

        # Build provenance string
        prov_parts = []
        if v.sources_succeeded:
            prov_parts.append(f"sources={','.join(v.sources_succeeded)}")
        if v.api_exhausted:
            prov_parts.append("API_EXHAUSTED")

        prov_str = f" ({', '.join(prov_parts)})" if prov_parts else ""

        # Add warnings indicator
        warn_indicator = " ⚠" if v.api_exhausted or v.used_local_db else ""

        # FIX v1.11: Show citation index if available
        cit = v.citation
        index_str = f"[{cit.numeric_index}] " if cit.numeric_index is not None else ""
        raw_display = v.citation.raw_text[:80 - len(index_str)]

        print(
            f"  {marker} [{v.label.value:25s}] conf={v.confidence:.0%}{prov_str}{warn_indicator}  "
            f"{index_str}raw={raw_display}"
        )

    # Show parser info if verbose
    if args.verbose:
        print("\n Parser Info:")
        print(f"  Parser used: {getattr(report, 'parser_used', 'unknown')}")
        print(f"  GROBID status: {getattr(report, 'grobid_status', 'unknown')}")
        if hasattr(report, 'parser_warnings') and report.parser_warnings:
            print("  Parser warnings:")
            for w in report.parser_warnings:
                print(f"    ⚠ {w}")

    print("\n ⚠ " + report.disclaimer)
    print()

    # Ghi file JSON: --stdout bỏ qua, mặc định ghi vào reports/, --output ghi đúng path chỉ định
    if args.stdout:
        return

    if args.output:
        out_path = Path(args.output)
    else:
        # Default: reports/<pdf-stem>.json (relative to CWD)
        out_path = Path("reports") / f"{pdf_path.stem}.json"

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as f:
        json.dump(report.to_dict(), f, ensure_ascii=False, indent=2)
    print(f" 📄 Report saved → {out_path}")
    logger.info(f"Wrote report → {out_path}")


if __name__ == "__main__":
    main()
