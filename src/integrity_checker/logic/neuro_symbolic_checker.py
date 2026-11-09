"""NeuroSymbolicChecker -- orchestrate neural features + symbolic rules.

v1.3: Bổ sung content alignment check (Neural layer) để kiểm tra semantic
alignment giữa đoạn văn được trích dẫn và paper nguồn.

Đây là component chính thể hiện tính "Neuro-Symbolic":
    - Neural: Sentence-BERT embeddings cho content-context alignment
    - Symbolic: Bộ quy tắc regex, logic validation cho decision making
"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING

from integrity_checker.extraction.patterns.apa import is_vn_legal_reference
from integrity_checker.logging import get_logger
from integrity_checker.logic.calibration import HybridMLScorer
from integrity_checker.logic.rules import SymbolicRules, _is_fake_url
from integrity_checker.logic.vn_legal_verifier import verify_vn_legal_citation
from integrity_checker.matching.author_matcher import author_match_score
from integrity_checker.matching.features import FeatureCalculator
from integrity_checker.models.citation import Citation
from integrity_checker.models.source import SourceCandidate, SourceResult
from integrity_checker.models.validation import CitationVerdict, MatchFeatures, ValidationLabel
from integrity_checker.retrieval.normalization import title_similarity
from integrity_checker.retrieval.retrieval_orchestrator import RetrievalOrchestrator

if TYPE_CHECKING:
    from integrity_checker.linking.statuses import CitationMappingStatus, StyleProfile

logger = get_logger(__name__)

# Precompiled module-level web/non-scholarly resource patterns (avoid re-compiling per citation)
_WEB_RESOURCE_PATTERNS: tuple[re.Pattern[str], ...] = (
    # Company, "Product/Service Name," Company
    re.compile(
        r'^(Google|Microsoft|Amazon|Apple|Facebook|Meta|Twitter|GitHub|IBM|Intel|'
        r'Nvidia|Adobe|Atlassian|Oracle|Salesforce|'
        r'OpenAI|Anthropic|Hugging\s*Face|Replicate|Cohere),?\s*["“]',
        re.IGNORECASE,
    ),
    # "Product/Service Name," Organization (title-first pattern)
    re.compile(
        r'^["“](YouTube\s*Data\s*API|Google\s*API|AWS\s*SDK|'
        r'Rest\s*API|GraphQL|Webhook|Twilio|Stripe|OpenAI|Anthropic)\b',
        re.IGNORECASE,
    ),
    # Developer/Documentation keyword sau citation
    re.compile(
        r'(Google\s+for\s+Developers|Developer\s+Documentation|'
        r'API\s+Reference|API\s+Documentation|REST\s+API\s+Documentation|'
        r'Academic\s+Graph\s+API|Getting\s+Started|REST\s+API|'
        r'The\s+DOI\s+Handbook)\s*[.,]',
        re.IGNORECASE,
    ),
    # Web portal / online documentation / archive with explicit URL and no DOI
    re.compile(
        r'\b(ACL\s+Anthology|Crossref\s+REST\s+API|Semantic\s+Scholar\s+(?:Academic\s+Graph\s+API|Open\s+Research\s+Corpus)|'
        r'OpenAlex\s*:\s*An\s+open\s+catalogue|Handbook\s+of\s+the\s+DOI\s+Resolution\s+System|'
        r'The\s+DOI\s+Handbook)\b.*?(?:\bRe-?\s*trieved\s+from\s+)?https?://',
        re.IGNORECASE,
    ),
    re.compile(
        r'https?://(?:www\.)?who\.int/(?:news-room|fact-sheets)/',
        re.IGNORECASE,
    ),
    # Company name + API/SDK/Tool keyword (short form từ GROBID)
    re.compile(
        r'^(Google|Amazon|Microsoft|GitHub|IBM|Intel|Nvidia)\s+'
        r'(YouTube|Maps|AWS|Vertex|TensorFlow|BERT|Cloud|Compute|S3|'
        r'Data\s*API|API|SDK|Tool)\b',
        re.IGNORECASE,
    ),
    # Common API/SDK patterns: "X API v3" hoặc "X Data API"
    re.compile(
        r'^(Google\s+YouTube\s+Data\s*API|YouTube\s+Data\s*API|'
        r'Google\s+API|Vertex\s+AI|Google\s+Cloud)',
        re.IGNORECASE,
    ),
    # Product/API documentation anywhere in citation
    re.compile(
        r'\b(YouTube\s+Data\s*API\s+v\d+|Google\s+for\s+Developers)\b',
        re.IGNORECASE,
    ),
    # Computer software / GitHub repository without academic venue
    re.compile(
        r'(\[Computer\s+software\]|\bGitHub\.\s*Retrieved\b)',
        re.IGNORECASE,
    ),
    # Classical / scriptural / public-domain / dictionary reference works
    re.compile(
        r'\b(The\s+Bible|ESV\s+ed\.|Project\s+Gutenberg|gutenberg\.org|'
        r'Dictionary\.com|Merriam-Webster|Encyclop(?:ae|e)dia\s+Britannica)\b',
        re.IGNORECASE,
    ),
    # Non-scholarly consumer / book-review / blog / magazine / media web domains & paths
    re.compile(
        r'(?:goodreads\.com|barnesandnoble\.com|blogspot\.com|wordpress\.com|substack\.com|'
        r'pbs\.org|popsugar\.com|publishersweekly\.com|eviemagazine\.com|swooon\.com|'
        r'fightthenewdrug\.org|publicsquaremag\.org|wheatley\.byu\.edu|'
        r'clarendonhousebooks\.com|shamelessbookdeals\.com|sexandpsychology\.com|'
        r'libbylife\.com|beforewegoblog\.com|thebooknookchronicles\.com|'
        r'peanutblossombookclub\.com|prettylittlememoirs\.com|beachreadsandbubbly\.com|'
        r'bookishgoblin\.com|estapinto\.com|amysuto\.com|penguinrandomhouse\.com/the-read-down|'
        r'/book-blog/|/book-review|spicy-chapters|#BookTok)',
        re.IGNORECASE,
    ),
    # Vietnamese web portals, access dates, microcontroller vendor notes, and developer tutorial sites
    re.compile(
        r'(?:\((?:[a-z0-9-]+\.)+(?:gov\.vn|org\.vn|edu\.vn|vn)\)\s*\.?\s*$|'
        r'\bTruy\s+cập\s+ngày\s+\d{1,2}\s*(?:[/-]|tháng)\s*\d{1,2}\s*(?:[/-]|năm)\s*(?:19|20)\d{2}\b|'
        r'\bCổng\s+thông\s+tin\s+điện\s+tử|'
        r'\bSTMicroelectronics\b.*\b(?:STM32|CMSIS)\b|'
        r'^\s*(?:\[\s*\d+\s*\]\s*|\d{1,3}[\.\)]\s*)?(?:Baeldung|DataCamp|GeeksforGeeks|W3Schools|TutorialsPoint|Viblo|TopDev)\s*,)',
        re.IGNORECASE,
    ),
)


class NeuroSymbolicChecker:
    """Kết hợp:
        - Neural: feature vector từ FeatureCalculator (bao gồm semantic content alignment)
        - Symbolic: SymbolicRules decision table

    v1.3: Bổ sung citation context để compute content alignment.
    Citation context = đoạn văn xung quanh citation trong essay,
    dùng để kiểm tra semantic alignment với paper nguồn.

    v1.2 §3.2.2 (task #33): check() giờ nhận thêm ``mapping_status`` +
    ``style_profile`` để SymbolicRules có đủ input cho rules mở rộng.

    2026-09-15: Uses SemanticMatcher singleton for ~5s performance improvement
    by avoiding model reload on each instantiation.

    FIX Bug 5: Now checks for known seminal papers and returns VERIFIED
    with high confidence even when APIs fail.

    # TODO(user): tuần 12–13 -- bổ sung:
        - Thêm classifier ML (LogisticRegression / XGBoost) như baseline B4
        - Calibration layer (Platt scaling) cho confidence
    """

    _feature_calculator: FeatureCalculator | None = None
    _hybrid_scorer: HybridMLScorer | None = None

    def __init__(
        self,
        feature_calculator: FeatureCalculator | None = None,
        rules: SymbolicRules | None = None,
        enable_content_alignment: bool = True,
        hybrid_scorer: HybridMLScorer | None = None,
        enable_calibration: bool = True,
    ) -> None:
        # Reuse shared FeatureCalculator instance to benefit from SemanticMatcher singleton
        if feature_calculator is not None:
            self.feature_calculator = feature_calculator
        elif enable_content_alignment:
            if NeuroSymbolicChecker._feature_calculator is None:
                NeuroSymbolicChecker._feature_calculator = FeatureCalculator(
                    enable_content_alignment=True
                )
            self.feature_calculator = NeuroSymbolicChecker._feature_calculator
        else:
            self.feature_calculator = FeatureCalculator(
                enable_content_alignment=False
            )
        self.rules = rules or SymbolicRules()
        self.enable_content_alignment = enable_content_alignment
        self.enable_calibration = enable_calibration
        if hybrid_scorer is not None:
            self.hybrid_scorer = hybrid_scorer
        else:
            if NeuroSymbolicChecker._hybrid_scorer is None:
                NeuroSymbolicChecker._hybrid_scorer = HybridMLScorer.load_default()
            self.hybrid_scorer = NeuroSymbolicChecker._hybrid_scorer

    def check(
        self,
        citation: Citation,
        source: SourceResult,
        mapping_status: CitationMappingStatus | None = None,
        style_profile: StyleProfile | None = None,
        citation_context: str | None = None,
        # NEW v1.3: Provenance tracking
        api_exhausted: bool = False,
        used_local_db: bool = False,
    ) -> CitationVerdict:
        """Trả CitationVerdict đầy đủ (label + confidence + reasoning + features).

        Args:
            citation: Citation từ PDF extraction
            source: SourceResult từ retrieval (API calls)
            mapping_status: CitationMappingStatus từ CitationLinker
            style_profile: StyleProfile từ StyleDetector
            citation_context: Đoạn văn xung quanh citation (cho Neural content alignment)

        FIX Bug 5: If citation matches a known seminal paper, return VERIFIED
        with high confidence even when all APIs fail.
        """
        # FIX v1.4 + v1.5: Check for URL/resource citations - classify as RESOURCE.
        # Robust against trailing punctuation (e.g. URL at end of sentence
        # like "see https://github.com/foo/bar.") by stripping trailing
        # `.,;:)]"'` before matching the URL prefix.
        import re
        raw_text = citation.raw_text or ""
        stripped_text = raw_text.strip()
        stripped_no_idx = re.sub(
            r"^\s*(?:\[\s*\d+\s*\]|\(\s*\d+\s*\)|\d{1,3}[\.\)])\s*",
            "",
            stripped_text,
        )
        stripped_no_access = re.sub(
            r"\s*(?:\[\s*(?:accessed|truy\s+cập|retrieved)[^\]]*\]|\(\s*(?:accessed|truy\s+cập|retrieved)[^)]*\))\.?\s*$",
            "",
            stripped_no_idx,
            flags=re.IGNORECASE,
        )
        # Strip trailing punctuation that commonly follows a URL in running text.
        url_candidate = stripped_no_access.rstrip(".,;:)\"']>")
        compact_url_candidate = re.sub(r"\s+", "", url_candidate)

        # Evaluate fake / dead / Wayback status BEFORE Check 1 & Check 2 so broken or fake URLs
        # never get whitelisted as RESOURCE (BUG-03).
        inline_url_m = re.search(r"https?://\S+", raw_text, re.IGNORECASE)
        effective_url_check = (
            (citation.url or "").strip()
            or (inline_url_m.group(0).rstrip(".,;:)\"']>") if inline_url_m else "")
        )
        has_fake_url_early, _ = _is_fake_url(effective_url_check)
        if not has_fake_url_early and url_candidate.lower().startswith(("http://", "https://", "www.")):
            has_fake_url_early, _ = _is_fake_url(compact_url_candidate)
        url_stat_early = getattr(source, "url_status", None)
        is_dead_url_early = url_stat_early in ("dead_link", "fake_domain")
        archive_url_early = getattr(source, "archive_url", None)

        scholarly_paper_url_re = (
            r"(?:doi\.org/10\.|(?:^|[./])arxiv\.org/(?:abs|pdf|html)/|"
            r"aclanthology\.org/[A-Za-z0-9.\-]+/?$|"
            r"ieeexplore\.ieee\.org/document/|dl\.acm\.org/doi/|"
            r"link\.springer\.com/(?:article|chapter)/|"
            r"sciencedirect\.com/science/article/|"
            r"nature\.com/articles/|onlinelibrary\.wiley\.com/doi/|"
            r"ncbi\.nlm\.nih\.gov/pmc/articles/|pubmed\.ncbi\.nlm\.nih\.gov/\d)"
        )
        is_scholarly_paper_url = bool(
            citation.doi
            or re.search(scholarly_paper_url_re, compact_url_candidate, re.IGNORECASE)
        )

        # Match if the candidate starts with a URL scheme (including PDF-wrapped fragment URLs).
        prefix_match = re.match(r"^(https?://|www\.)", url_candidate, re.IGNORECASE)
        url_body_match = re.match(
            r"^(?:https?://|www\.)(\S{10,})$", url_candidate, re.IGNORECASE
        ) or (
            prefix_match is not None
            and len(compact_url_candidate) >= 18
            and (
                "#:~:text=" in url_candidate
                or re.search(r"%[0-9A-Fa-f]{0,2}\s+[0-9A-Fa-f]", url_candidate)
                or (not citation.authors and not citation.title)
            )
        )
        if (
            prefix_match
            and url_body_match
            and not is_scholarly_paper_url
            and not has_fake_url_early
            and not is_dead_url_early
            and not url_candidate[len(prefix_match.group(0)) :].startswith((" ", "\n", "\t"))
        ):
            logger.debug(
                f"URL/RESOURCE detected: raw='{raw_text[:80]}' "
                f"-> url_candidate='{url_candidate[:80]}'"
            )
            if url_stat_early == "archived_alive":
                res_rules = ["R-WAYBACK-ARCHIVED", "R-URL-RESOURCE"]
                conf = 0.90
                note = f" (Wayback Machine snapshot: {archive_url_early or 'archive.org'})"
            else:
                res_rules = ["R-URL-RESOURCE"]
                conf = 0.95
                note = ""
            return CitationVerdict(
                citation=citation,
                label=ValidationLabel.RESOURCE,
                confidence=conf,
                matched_source=source,
                features=MatchFeatures(),
                reasoning=f"URL/Reference link detected{note}: {raw_text[:60]}... (not an academic citation)",
                triggered_rules=res_rules,
                mismatched_fields=[],
                archive_url=archive_url_early,
            )

        # --- Check 2: Web resource/API citations (không bắt đầu bằng URL) ---
        check_resource_str = " ".join(
            part
            for part in (raw_text, citation.title or "", citation.url or "", citation.venue or "")
            if part
        )
        if not has_fake_url_early and not is_dead_url_early:
            for pattern in _WEB_RESOURCE_PATTERNS:
                if not citation.doi and pattern.search(check_resource_str):
                    logger.debug(
                        f"Web resource/API detected: raw='{raw_text[:80]}' "
                        f"matched pattern: {pattern.pattern[:50]}"
                    )
                    if url_stat_early == "archived_alive":
                        res_rules = ["R-WAYBACK-ARCHIVED", "R-WEB-RESOURCE"]
                        conf = 0.90
                        note = f" (Wayback Machine snapshot: {archive_url_early or 'archive.org'})"
                    else:
                        res_rules = ["R-WEB-RESOURCE"]
                        conf = 0.95
                        note = ""
                    return CitationVerdict(
                        citation=citation,
                        label=ValidationLabel.RESOURCE,
                        confidence=conf,
                        matched_source=source,
                        features=MatchFeatures(),
                        reasoning=f"Web resource/API citation detected{note}: {raw_text[:60]}... (not an academic paper)",
                        triggered_rules=res_rules,
                        mismatched_fields=[],
                        archive_url=archive_url_early,
                    )

        # --- Check 3: Vietnamese legal documents (TDTU §2.6.1 & Sprint 3.2 Legal Verifier) ---
        if citation.matched_pattern == "vn_legal_document" or is_vn_legal_reference(raw_text):
            logger.debug(f"Vietnamese legal document detected: raw='{raw_text[:80]}'")
            legal_res = verify_vn_legal_citation(
                raw_text=raw_text,
                extracted_year=str(citation.year) if citation.year else None,
                extracted_venue=citation.venue,
            )
            is_fabricated_legal = "R-VN-LEGAL-FABRICATED" in (legal_res.triggered_rules or [])
            if (legal_res.canonical_name or legal_res.canonical_code) and not is_fabricated_legal:
                canon_year = None
                if legal_res.canonical_code:
                    ym = re.search(r"\b(19\d{2}|20\d{2})\b", legal_res.canonical_code)
                    if ym:
                        canon_year = ym.group(1)
                if not canon_year and legal_res.is_valid and citation.year:
                    canon_year = str(citation.year)
                canon_title = (
                    f"{legal_res.canonical_name} ({legal_res.canonical_code})"
                    if legal_res.canonical_name
                    and legal_res.canonical_code
                    and legal_res.canonical_code not in legal_res.canonical_name
                    else (legal_res.canonical_name or citation.title or raw_text)
                )
                legal_cand = SourceCandidate(
                    source_name="vn_legal_registry",
                    found=True,
                    title=canon_title,
                    authors=(
                        [legal_res.canonical_authority]
                        if legal_res.canonical_authority
                        else (citation.authors or [])
                    ),
                    year=canon_year,
                    venue="Hệ thống Pháp luật Việt Nam (VBQPPL)",
                    score=0.95,
                    confidence=0.95,
                    cached=True,
                )
                source.candidates.insert(0, legal_cand)
                if "vn_legal_registry" not in source.sources_queried:
                    source.sources_queried.insert(0, "vn_legal_registry")
                if "vn_legal_registry" not in source.sources_succeeded:
                    source.sources_succeeded.insert(0, "vn_legal_registry")
            legal_features = MatchFeatures(
                title_sim_fuzzy=0.10 if is_fabricated_legal else (0.95 if "title" not in legal_res.mismatched_fields else 0.50),
                author_jaccard=0.95 if "authors" not in legal_res.mismatched_fields else 0.40,
                year_distance=0 if "year" not in legal_res.mismatched_fields else 1,
                source_consensus=0 if is_fabricated_legal else (1 if (legal_res.canonical_name or legal_res.canonical_code) else 0),
            )
            if not legal_res.is_valid:
                return CitationVerdict(
                    citation=citation,
                    label=(
                        ValidationLabel.SUSPECTED_HALLUCINATION
                        if is_fabricated_legal
                        else ValidationLabel.METADATA_ERROR
                    ),
                    confidence=0.92 if is_fabricated_legal else 0.90,
                    matched_source=source,
                    features=legal_features,
                    reasoning=legal_res.reasoning,
                    triggered_rules=legal_res.triggered_rules,
                    mismatched_fields=legal_res.mismatched_fields,
                )
            return CitationVerdict(
                citation=citation,
                label=ValidationLabel.RESOURCE,
                confidence=0.95,
                matched_source=source,
                features=legal_features,
                reasoning=legal_res.reasoning,
                triggered_rules=legal_res.triggered_rules,
                mismatched_fields=[],
            )

        # --- Check 4: Unified RetrievalOrchestrator web/documentation resource check ---
        has_fake_url_early, _ = _is_fake_url(citation.url)
        is_dead_url_early = getattr(source, "url_status", None) == "dead_link"
        has_specialist_candidate = any(
            getattr(c, "found", False)
            and getattr(c, "source_name", "") in {"huggingface", "tech_standard"}
            for c in (source.candidates or [])
        )
        specialist_explicitly_not_found = (
            any(
                s in {"huggingface", "tech_standard"}
                for s in (getattr(source, "sources_queried", None) or [])
            )
            and not any(getattr(c, "found", False) for c in (source.candidates or []))
        )
        if (
            not has_fake_url_early
            and not is_dead_url_early
            and not has_specialist_candidate
            and not specialist_explicitly_not_found
            and RetrievalOrchestrator.is_web_or_legal_resource(citation)
        ):
            url_stat = getattr(source, "url_status", None)
            archive_url = getattr(source, "archive_url", None)
            if url_stat == "archived_alive":
                http_note = f" (Wayback Machine snapshot: {archive_url or 'archive.org'})"
                res_rules = ["R-WAYBACK-ARCHIVED", "R-WEB-RESOURCE"]
            elif url_stat in ("alive", "restricted_alive"):
                http_note = f" (HTTP {getattr(source, 'url_status_code', None) or 200} OK)"
                res_rules = ["R-WEB-RESOURCE"]
            else:
                http_note = ""
                res_rules = ["R-WEB-RESOURCE"]
            return CitationVerdict(
                citation=citation,
                label=ValidationLabel.RESOURCE,
                confidence=0.95 if url_stat != "archived_alive" else 0.90,
                matched_source=source,
                features=MatchFeatures(),
                reasoning=f"Web/documentation resource detected{http_note}: {raw_text[:70]}... (non-scholarly URL resource)",
                triggered_rules=res_rules,
                mismatched_fields=[],
                archive_url=archive_url,
            )

        # Debug aid: if raw_text starts with URL scheme but didn't match, log it.
        if re.match(r'^(https?://|www\.)', stripped_text, re.IGNORECASE):
            logger.debug(
                f"URL-like raw_text but no RESOURCE match: raw='{raw_text[:80]}' "
                f"url_candidate='{url_candidate[:80]}'"
            )

        # FIX Bug 5: Check for known seminal papers first (skip if fake URL or fabricated DOI)
        # FIX v1.5: Now checks title similarity to detect METADATA_ERROR
        has_fake_url, _ = _is_fake_url(citation.url)
        has_fabricated_doi = self.rules._is_fabricated_doi(citation.doi)
        is_known, paper_info = RetrievalOrchestrator.is_known_paper(citation)
        if is_known and paper_info and not has_fake_url and not has_fabricated_doi:
            known_year = paper_info.get("year") or (
                str(citation.year)[:4] if citation.year else None
            )
            # Create a synthetic SourceCandidate from known paper info (preserving abstract)
            known_authors = paper_info.get("authors", [])
            known_doi = paper_info.get("doi")
            existing_abs = paper_info.get("abstract") or next(
                (
                    c.abstract
                    for c in source.candidates
                    if getattr(c, "abstract", None)
                    and (
                        c.source_name == "known_papers"
                        or (known_doi and c.doi and str(c.doi).lower() == str(known_doi).lower())
                        or (known_authors and author_match_score(known_authors, list(c.authors or [])) >= 0.50)
                    )
                ),
                None,
            )
            known_candidate = SourceCandidate(
                source_name="known_papers",
                found=True,
                title=paper_info.get("title"),
                doi=paper_info.get("doi"),
                authors=known_authors,
                year=known_year,
                venue=paper_info.get("venue"),
                abstract=existing_abs,
                confidence=0.95,
                score=1.0,
            )

            # Avoid duplicating known_papers if RetrievalOrchestrator already injected it
            other_cands = [
                c for c in source.candidates if c.source_name != "known_papers"
            ]
            other_queried = [
                s for s in source.sources_queried if s != "known_papers"
            ]
            other_succeeded = [
                s for s in source.sources_succeeded if s != "known_papers"
            ]

            # FIX v1.5: Check title similarity to detect METADATA_ERROR
            # If citation has a title and it doesn't match the known paper's title:
            # First check if a live/local_db source already found a real paper matching citation.title
            # (e.g., another paper by the same first author in the same year, like Kaiser & Bengio 2016).
            citation_title = citation.title
            known_title = paper_info.get("title", "")

            if citation_title and known_title:
                # Calculate title similarity using FuzzyMatcher
                title_sim = self.rules.fuzzy.token_set_ratio(
                    citation_title.lower(), known_title.lower()
                )
                title_sim_threshold = 0.5  # Below this = likely wrong title

                known_t_low = known_title.lower().strip()
                is_chapter_in_known_book = len(known_t_low) >= 6 and (
                    known_t_low in (citation.venue or "").lower()
                    or bool(
                        re.search(
                            rf"\bin\s+{re.escape(known_t_low)}\b",
                            (citation.raw_text or "").lower(),
                        )
                    )
                )

                if title_sim < title_sim_threshold and not is_chapter_in_known_book:
                    # Check if a live/local_db source already found a real paper matching citation.title
                    # (e.g., another paper by the same first author in the same year, like Kaiser & Bengio 2016)
                    has_real_matching_candidate = any(
                        cand.found
                        and cand.title
                        and self.rules.fuzzy.token_set_ratio(
                            citation_title.lower(), cand.title.lower()
                        )
                        >= 0.70
                        and (
                            not citation.authors
                            or author_match_score(citation.authors, list(cand.authors or [])) >= 0.50
                        )
                        for cand in other_cands
                    )
                    if not has_real_matching_candidate:
                        # Title doesn't match and no other real paper matched → check whether
                        # this is a spliced/chimeric DOI hallucination before returning METADATA_ERROR.
                        agreeing_other_cands = [
                            c
                            for c in other_cands
                            if (known_doi and c.doi and str(c.doi).lower() == str(known_doi).lower())
                            or (known_authors and author_match_score(known_authors, list(c.authors or [])) >= 0.50)
                        ]
                        enhanced_source = SourceResult(
                            citation_raw=source.citation_raw,
                            candidates=[known_candidate] + agreeing_other_cands,
                            sources_queried=["known_papers"] + other_queried,
                            sources_succeeded=["known_papers"] + other_succeeded,
                            sources_failed=source.sources_failed,
                            api_exhausted=source.api_exhausted,
                            url_status=source.url_status,
                            url_status_code=source.url_status_code,
                            archive_url=getattr(source, "archive_url", None),
                            is_retracted=getattr(source, "is_retracted", False),
                        )
                        features = self.feature_calculator.compute(citation, enhanced_source, citation_context)
                        is_cross_lingual_kp = (
                            bool(getattr(features, "cross_lingual_title_detected", False))
                            and float(getattr(features, "cross_lingual_title_sim", 0.0) or 0.0) >= 0.58
                        )
                        has_doi_matched_other_cand = bool(
                            citation.doi
                            and any(
                                c.found and c.doi and FeatureCalculator._doi_matches(citation.doi, c.doi)
                                for c in other_cands
                            )
                        )
                        has_known_doi_conflict = bool(
                            citation.doi
                            and known_doi
                            and not FeatureCalculator._doi_matches(citation.doi, known_doi)
                            and "10.48550/arxiv" not in str(citation.doi).lower()
                            and "10.48550/arxiv" not in str(known_doi).lower()
                        )
                        norm_kp_title_sim = title_similarity(citation_title, known_title)
                        is_chimeric_known_bypass = bool(
                            not is_cross_lingual_kp
                            and citation.doi
                            and norm_kp_title_sim < 0.30
                            and (has_doi_matched_other_cand or has_known_doi_conflict)
                        )
                        if not is_chimeric_known_bypass:
                            kp_rules = ["R-KNOWN-PAPER", "R-TITLE-MISMATCH"]
                            kp_reason = (
                                f"Known author '{citation.authors[0] if citation.authors else 'unknown'}' found, "
                                f"but title '{citation_title}' does not match known paper '{known_title}' "
                                f"(similarity: {title_sim:.2f}). This appears to be a wrong title attribution."
                            )
                            if is_cross_lingual_kp:
                                kp_rules.append("R-CROSS-LINGUAL-TITLE-MATCH")
                                xl_sim = float(getattr(features, "cross_lingual_title_sim", 0.0) or 0.0)
                                kp_reason = (
                                    f"Cross-lingual translated title detected (VI ↔ EN semantic alignment={xl_sim:.2f}). "
                                    f"Matched known publication, but foreign-language titles must be preserved in their "
                                    f"original language without translation."
                                )

                            return self._apply_dead_link_exception(
                                CitationVerdict(
                                    citation=citation,
                                    label=ValidationLabel.METADATA_ERROR,
                                    confidence=0.75,
                                    matched_source=enhanced_source,
                                    features=features,
                                    reasoning=kp_reason,
                                    triggered_rules=kp_rules,
                                    mismatched_fields=["title"],
                                ),
                                enhanced_source,
                            )
                    # Otherwise fall through to normal verification of the real matching / chimeric candidate
                else:
                    # Title matches known paper → VERIFIED
                    enhanced_source = SourceResult(
                        citation_raw=source.citation_raw,
                        candidates=[known_candidate] + other_cands,
                        sources_queried=["known_papers"] + other_queried,
                        sources_succeeded=["known_papers"] + other_succeeded,
                        sources_failed=source.sources_failed,
                        api_exhausted=source.api_exhausted,
                        url_status=source.url_status,
                        url_status_code=source.url_status_code,
                        archive_url=getattr(source, "archive_url", None),
                        is_retracted=getattr(source, "is_retracted", False),
                    )
                    features = self.feature_calculator.compute(citation, enhanced_source, citation_context)
                    known_rules = ["R-KNOWN-PAPER"]
                    if (
                        self.enable_content_alignment
                        and citation_context
                        and getattr(features, "stance_label", "") == "contradiction_risk"
                    ):
                        known_rules.append("R-CONTENT-MISMATCH")
                    if (
                        self.enable_content_alignment
                        and citation_context
                        and getattr(features, "cross_lingual_detected", False)
                        and getattr(features, "content_is_aligned", False)
                    ):
                        known_rules.append("R-CROSS-LINGUAL-ALIGNMENT")
                    known_note = (
                        "APIs failed but paper is well-documented."
                        if (source.sources_failed or source.api_exhausted)
                        else "Verified against curated canonical scholarly registry."
                    )
                    base_reason = (
                        f"Known seminal paper verified via known papers database: '{paper_info.get('title')}'. "
                        f"{known_note}"
                    )

                    return self._apply_dead_link_exception(
                        CitationVerdict(
                            citation=citation,
                            label=ValidationLabel.VERIFIED,
                            confidence=0.90,
                            matched_source=enhanced_source,
                            features=features,
                            reasoning=self._enhance_reasoning_with_neural(
                                base_reason, features, known_rules
                            ),
                            triggered_rules=known_rules,
                            mismatched_fields=[],
                        ),
                        enhanced_source,
                    )
            else:
                # Citation has no title (in-text citation) → VERIFIED via known paper
                enhanced_source = SourceResult(
                    citation_raw=source.citation_raw,
                    candidates=[known_candidate] + other_cands,
                    sources_queried=["known_papers"] + other_queried,
                    sources_succeeded=["known_papers"] + other_succeeded,
                    sources_failed=source.sources_failed,
                    api_exhausted=source.api_exhausted,
                    url_status=source.url_status,
                    url_status_code=source.url_status_code,
                    archive_url=getattr(source, "archive_url", None),
                    is_retracted=getattr(source, "is_retracted", False),
                )
                features = self.feature_calculator.compute(citation, enhanced_source, citation_context)
                known_rules = ["R-KNOWN-PAPER"]
                if (
                    self.enable_content_alignment
                    and citation_context
                    and getattr(features, "stance_label", "") == "contradiction_risk"
                ):
                    known_rules.append("R-CONTENT-MISMATCH")
                if (
                    self.enable_content_alignment
                    and citation_context
                    and getattr(features, "cross_lingual_detected", False)
                    and getattr(features, "content_is_aligned", False)
                ):
                    known_rules.append("R-CROSS-LINGUAL-ALIGNMENT")
                known_note = (
                    "APIs failed but paper is well-documented."
                    if (source.sources_failed or source.api_exhausted)
                    else "Verified against curated canonical scholarly registry."
                )
                base_reason = (
                    f"Known seminal paper verified via known papers database: '{paper_info.get('title')}'. "
                    f"{known_note}"
                )

                return self._apply_dead_link_exception(
                    CitationVerdict(
                        citation=citation,
                        label=ValidationLabel.VERIFIED,
                        confidence=0.90,
                        matched_source=enhanced_source,
                        features=features,
                        reasoning=self._enhance_reasoning_with_neural(
                            base_reason, features, known_rules
                        ),
                        triggered_rules=known_rules,
                        mismatched_fields=[],
                    ),
                    enhanced_source,
                )

        # Compute features với context (nếu có) cho Neural content alignment
        features = self.feature_calculator.compute(citation, source, citation_context)

        # Apply symbolic rules với content alignment features
        outcome = self.rules.apply(
            features,
            source,
            mapping_status=mapping_status,
            style_profile=style_profile,
            citation_doi=citation.doi,
            citation_url=citation.url,
            # NEW v1.3: Provenance tracking
            api_exhausted=api_exhausted,
            used_local_db=used_local_db,
            # NEW v1.3: Citation info for METADATA_ERROR detection
            citation_authors=citation.authors,
            citation_year=citation.year,
            citation_raw=citation.raw_text,
            citation_venue=citation.venue,
        )

        final_rules = list(outcome.triggered_rules)
        if (
            self.enable_content_alignment
            and citation_context
            and getattr(features, "stance_label", "") == "contradiction_risk"
            and "R-CONTENT-MISMATCH" not in final_rules
        ):
            final_rules.append("R-CONTENT-MISMATCH")
        if (
            self.enable_content_alignment
            and citation_context
            and getattr(features, "cross_lingual_detected", False)
            and getattr(features, "content_is_aligned", False)
            and "R-CROSS-LINGUAL-ALIGNMENT" not in final_rules
        ):
            final_rules.append("R-CROSS-LINGUAL-ALIGNMENT")

        # Enhance reasoning với content alignment info (Neural layer feedback)
        enhanced_reasoning = self._enhance_reasoning_with_neural(
            outcome.reasoning, features, final_rules
        )

        final_confidence = outcome.confidence
        if self.enable_calibration and self.hybrid_scorer is not None and outcome.confidence > 0.0:
            has_cand = any(getattr(c, "found", True) for c in (source.candidates or []))
            final_confidence = self.hybrid_scorer.calibrate_verdict_confidence(
                symbolic_label=outcome.label.value,
                symbolic_confidence=outcome.confidence,
                features=features,
                has_candidate=has_cand,
                style_penalty=outcome.style_penalty,
            )
            if "R-AMBIGUOUS-MAPPING" in final_rules:
                final_confidence = min(final_confidence, self.rules.ambiguous_confidence_cap)

        return self._apply_dead_link_exception(
            CitationVerdict(
                citation=citation,
                label=outcome.label,
                confidence=final_confidence,
                matched_source=source,
                features=features,
                reasoning=enhanced_reasoning,
                triggered_rules=final_rules,
                mismatched_fields=list(outcome.mismatched_fields),
                style_penalty=outcome.style_penalty,
                domain_exception=outcome.domain_exception,
            ),
            source,
        )

    @staticmethod
    def _apply_dead_link_exception(
        verdict: CitationVerdict,
        source: SourceResult,
    ) -> CitationVerdict:
        """Post-process verdict for dead-link domain exceptions, Wayback archives, and retractions."""
        if (
            getattr(source, "url_status", None) == "dead_link"
            and verdict.label in (ValidationLabel.VERIFIED, ValidationLabel.METADATA_ERROR)
        ):
            verdict.domain_exception = True
            if "R-DOMAIN-EXCEPTION" not in verdict.triggered_rules:
                verdict.triggered_rules.append("R-DOMAIN-EXCEPTION")
            if "R-BROKEN-LINK" not in verdict.triggered_rules:
                verdict.triggered_rules.append("R-BROKEN-LINK")
            if "url" not in verdict.mismatched_fields:
                verdict.mismatched_fields.append("url")
            verdict.reasoning += (
                " [Link check: Cited URL is dead/unreachable, but scholarly record exists in academic registries.]"
            )

        if getattr(source, "url_status", None) == "archived_alive":
            if "R-WAYBACK-ARCHIVED" not in verdict.triggered_rules:
                verdict.triggered_rules.append("R-WAYBACK-ARCHIVED")
            archive_url = getattr(source, "archive_url", None)
            if archive_url:
                verdict.archive_url = archive_url
            if archive_url and "[Web Archive:" not in verdict.reasoning and "Wayback Machine" not in verdict.reasoning:
                verdict.reasoning += (
                    f" [Web Archive: Original URL experienced link rot, verified via Wayback Machine snapshot: {archive_url}]"
                )

        is_retracted = bool(
            getattr(source, "is_retracted", False)
            or (hasattr(source, "has_retracted_candidate") and source.has_retracted_candidate())
        )
        if is_retracted:
            if hasattr(source, "is_retracted"):
                source.is_retracted = True
            verdict.is_retracted = True
            if verdict.label in (ValidationLabel.VERIFIED, ValidationLabel.UNRESOLVED):
                verdict.label = ValidationLabel.METADATA_ERROR
            if "R-RETRACTED-PAPER" not in verdict.triggered_rules:
                verdict.triggered_rules.append("R-RETRACTED-PAPER")
            if "retracted" not in verdict.mismatched_fields:
                verdict.mismatched_fields.append("retracted")
            if "retracted_paper" not in verdict.mismatched_fields:
                verdict.mismatched_fields.append("retracted_paper")
            if "[RETRACTION WARNING:" not in verdict.reasoning:
                verdict.reasoning += (
                    " [RETRACTION WARNING: This publication has been officially RETRACTED in scholarly registries "
                    "(Retraction Watch / OpenAlex / Crossref).]"
                )
        return verdict

    def _enhance_reasoning_with_neural(
        self,
        symbolic_reasoning: str,
        features: MatchFeatures,
        triggered_rules: list[str],
    ) -> str:
        """Enhance symbolic reasoning với Neural content alignment & evidence info."""
        if not self.enable_content_alignment:
            return symbolic_reasoning

        stance = getattr(features, "stance_label", "")
        if features.content_alignment_score > 0 or stance == "contradiction_risk":
            alignment_info = (
                f" [Neural: content alignment score={features.content_alignment_score:.2f} "
                f"({features.content_alignment_confidence})"
            )
            intent = getattr(features, "citation_intent", "")
            ev_score = getattr(features, "best_evidence_score", 0.0)
            if intent:
                alignment_info += f", intent={intent}"
            if stance:
                alignment_info += f", stance={stance}"
            if ev_score and ev_score > 0:
                alignment_info += f", evidence_sim={ev_score:.2f}"
            if getattr(features, "cross_lingual_detected", False):
                bridged = getattr(features, "bridged_concepts", None) or []
                if bridged:
                    alignment_info += f", cross_lingual=VI->EN ({'; '.join(bridged[:3])})"
                else:
                    alignment_info += ", cross_lingual=VI->EN"

            if stance == "contradiction_risk":
                alignment_info += " - WARNING: citation claim may contradict or be off-topic from source"
            elif features.content_is_aligned and "VERIFIED" not in triggered_rules:
                alignment_info += " - content semantically aligned with source"
            elif not features.content_is_aligned and features.content_alignment_score > 0.3:
                alignment_info += " - WARNING: content may not align with source"

            alignment_info += "]"
            return symbolic_reasoning + alignment_info

        return symbolic_reasoning
