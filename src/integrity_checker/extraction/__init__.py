"""Extraction module — PDF → Citation.

Bao gồm:
- BasePDFParser (abstract) + MuPdfParser + PdfPlumberParser
- TextPreprocessor (Unicode, ligature, line-break normalization)
- RegexPatterns (APA/MLA/Chicago/IEEE/DOI/URL)
- CitationExtractor (regex + heuristics)
- ReferenceListParser (parse "References" section cuối bài)
- SectionSegmenter (phân vùng body / bibliography / appendix) — MỚI v1.2
- GROBID adapter (TEI XML → GrobidOutput) — MỚI v1.2
- DocumentParser (orchestrator fuse 3 nguồn) — MỚI v1.2 tuần 8
- StyleDetector (document-level citation style profile) — MỚI v1.2
"""

from integrity_checker.extraction.base import BasePDFParser, Document
from integrity_checker.extraction.citation_extractor import CitationExtractor
from integrity_checker.extraction.document_parser import DocumentParser, ParsedDocument
from integrity_checker.extraction.docx_parser import DocxParser
from integrity_checker.extraction.grobid_adapter import (
    MergeResult,
    ProvenanceInfo,
    build_grobid_id_map,
    grobid_to_in_text_citations,
    grobid_to_references,
    merge_extraction_results,
    normalize_grobid_id,
    resolve_tei_links,
)
from integrity_checker.extraction.grobid_parser import (
    GrobidAuthor,
    GrobidBibEntry,
    GrobidCitation,
    GrobidOutput,
    GrobidSection,
    call_grobid_fulltext,
    parse_tei,
)
from integrity_checker.extraction.grobid_service import (
    GROBID_STATUS,
    GrobidServiceManager,
    GrobidStats,
    get_grobid_manager,
    reset_grobid_manager,
)
from integrity_checker.extraction.mupdf_parser import MuPdfParser
from integrity_checker.extraction.pdfplumber_parser import PdfPlumberParser
from integrity_checker.extraction.reference_parser import ReferenceListParser
from integrity_checker.extraction.regex_patterns import CitationPattern, get_all_patterns
from integrity_checker.extraction.section_segmenter import (
    DocumentSection,
    SectionSegmenter,
    SectionType,
)
from integrity_checker.extraction.style_detector import (
    StyleDetector,
    StyleFeatures,
    StyleProfile,
)
from integrity_checker.extraction.text_preprocessor import TextPreprocessor
from integrity_checker.extraction.vn_encoding import VietnameseLegacyTranscoder

__all__ = [
    "BasePDFParser",
    "Document",
    "DocxParser",
    "MuPdfParser",
    "PdfPlumberParser",
    "TextPreprocessor",
    "VietnameseLegacyTranscoder",
    "CitationPattern",
    "get_all_patterns",
    "CitationExtractor",
    "ReferenceListParser",
    "DocumentSection",
    "SectionSegmenter",
    "SectionType",
    "DocumentParser",
    "ParsedDocument",
    "GrobidAuthor",
    "GrobidBibEntry",
    "GrobidCitation",
    "GrobidOutput",
    "GrobidSection",
    "call_grobid_fulltext",
    "parse_tei",
    # GROBID service lifecycle (re-exported for pipeline/health routes)
    "GROBID_STATUS",
    "GrobidServiceManager",
    "GrobidStats",
    "get_grobid_manager",
    "reset_grobid_manager",
    "StyleDetector",
    "StyleFeatures",
    "StyleProfile",
    # GROBID Adapter (v1.10)
    "ProvenanceInfo",
    "MergeResult",
    "grobid_to_references",
    "grobid_to_in_text_citations",
    "build_grobid_id_map",
    "merge_extraction_results",
    "resolve_tei_links",
    "normalize_grobid_id",
]
