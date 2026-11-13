"""CitationExtractor — regex + heuristics, trích xuất Citation[] từ Document."""

from __future__ import annotations

import re
import warnings
from collections.abc import Iterable

from integrity_checker.extraction.base import Document
from integrity_checker.extraction.patterns.base import CompiledPattern

# Suppress deprecation warning for legacy import (regex_patterns.py is deprecated)
with warnings.catch_warnings():
    warnings.filterwarnings("ignore", category=DeprecationWarning)
    from integrity_checker.extraction.regex_patterns import CitationPattern

from integrity_checker.extraction.text_preprocessor import TextPreprocessor
from integrity_checker.models.citation import Citation, CitationStyle, CitationType

# Header / footer keywords để phát hiện reference section
_REFERENCE_HEADERS = re.compile(
    r"^\s*(?:(?:(?:chương|phần|mục|chapter|section|part)\s+)?(?:\d+(?:\.\d+)*|X{0,2}(?:I{1,3}|IV|V|VI{0,3}|IX|X))(?:\s*[\.\):\-–—]+\s*|\s+)|[A-Z][\.\)]\s+)?(references?|reference\s+list|bibliography|works?\s+cited|literature(?:\s+cited)?|cited\s+literature|sources|list\s+of\s+sources|reference\s+sources|sources\s+and\s+literature|literature\s+and\s+sources|notes(?:\s+and\s+references)?|endnotes?"
    r"|danh\s+mục\s+tài\s+liệu(?:\s+[tk]ham\s+khảo(?:\s*(?:,|và)\s*trích\s+dẫn)?)?|(?:các\s+)?(?:tài\s+liệu|bài\s+viết|nguồn|link)\s+[tk]ham\s+khảo(?:\s*(?:,|và)\s*trích\s+dẫn)?|tham\s+khảo|tài\s+liệu\s+trích\s+dẫn|tài\s+liệu)(?:\s*\(\s*\))?\s*[:.]?\s*$",
    re.IGNORECASE | re.MULTILINE,
)

# Essay title / header keywords — these indicate non-citation text
_ESSAY_TITLE_INDICATORS = re.compile(
    r"(?:this\s+essay|comprehensive\s+survey|comprehensive\s+review|"
    r"introduction\s+to\s+|abstract\s+|survey\s*$|:?\s*survey\s+of\s+|"
    r"a\s+(?:brief\s+)?(?:survey|review|introduction)|"
    r"^\s*(?:deep\s+learning|natural\s+language\s+processing))",
    re.IGNORECASE,
)

# Long text without punctuation at start — likely a title or heading, not a citation
_LONG_TEXT_START_RE = re.compile(r"^[A-Za-z]{50,}?\s")

# IEEE reference list marker pattern: [N] followed by space + author name
# This helps identify standalone [N] as reference markers, not in-text citations
_IEEE_REF_MARKER_RE = re.compile(r"^\s*\[\d+\]\s+[A-Z]")

# Test scenario patterns — lines that describe test scenarios, not real citations
# These patterns indicate the [N] is part of a test description, not an in-text citation
_TEST_SCENARIO_PATTERNS = re.compile(
    r"(?:^|\s)Reference:\s*\[\d+\]|"
    r"(?:^|\s)In-text:\s*\(|"
    r"(?:^|\s)Expected(?:Mapping|Label):|"
    r"(?:^|\s)Scenario:|"
    r"(?:^|\s)APA\d+:|"
    r"(?:^|\s)IEEE\d+:",
    re.IGNORECASE,
)

# Month and season names for filtering date-only patterns
_MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]
_MONTH_NAMES_LOWER = [m.lower() for m in _MONTH_NAMES]
_SEASON_NAMES = ["Spring", "Summer", "Fall", "Autumn", "Winter"]
_SEASON_NAMES_LOWER = [s.lower() for s in _SEASON_NAMES]


def _is_reference_list_marker(
    text: str, match_start: int, match_end: int | None = None
) -> bool:
    """Check if the [N] match is a reference list marker (not an in-text citation).

    Reference list entries look like: "[4] Xiao, Y., ..." or "    [4] Xiao, Y., ..."
    In-text citations look like: "According to [4], ..." or wrapped "\n[9], and ..."

    Returns True if this appears to be a reference list marker.
    """
    is_line_start = False
    if match_start == 0:
        is_line_start = True
    else:
        prefix = text[:match_start]
        if prefix.isspace() or re.search(r"\n\s*$", prefix):
            is_line_start = True

    if not is_line_start:
        return False

    # Even if [N] is at the start of a line (due to PDF line wrapping), check what follows:
    # An in-text citation wrapped to the start of a line is followed by punctuation
    # (",", ".", ";", ":", ")") or a lowercase word (e.g. "\n[9], and", "\n[14] show", "\n[23].").
    if match_end is not None and match_end < len(text):
        suffix = text[match_end:]
        if re.match(r"^\s*[,.;:)\]]", suffix) or re.match(r"^\s+[a-z]", suffix):
            return False

    return True


def _is_in_test_scenario_context(text: str, match_start: int) -> bool:
    """Check if [N] match is within a test scenario description context.

    Test scenarios like "Reference: [1]" or "APA-01: MATCHED" indicate
    that [N] is part of test documentation, not a real citation.

    Returns True if [N] appears to be in a test scenario context.
    """
    # Get context around the match (50 chars before and after)
    context_start = max(0, match_start - 50)
    context_end = min(len(text), match_start + 100)
    context = text[context_start:context_end]

    # Check for test scenario patterns
    if _TEST_SCENARIO_PATTERNS.search(context):
        return True

    # Check if [N] follows "Reference:" or "reference:" in the same line
    line_start = text.rfind('\n', 0, match_start) + 1
    line_prefix = text[line_start:match_start]
    if re.search(r'Reference\s*:\s*\[\d+\]', line_prefix, re.IGNORECASE):
        return True

    # Check if the line starts with scenario ID pattern like "APA-01:", "IEEE-02:", etc.
    # Find the start of current line
    line_start_full = max(0, text.rfind('\n', 0, match_start) + 1)
    current_line = text[line_start_full:line_start_full + 200].split('\n')[0]
    if re.match(r'^\s*(APA-\d+|IEEE-\d+):', current_line, re.IGNORECASE):
        return True

    # Check if preceded by "In-text:" or "Reference:" in the same line
    if re.search(r'(?:In-text|Reference)\s*:', line_prefix, re.IGNORECASE):
        return True

    # Check if in a syntax template table (e.g. Table 4.2 showing "Author, A. (2020)" / "A. Author, 'Title'")
    if re.search(r"\bAuthor,\s*A\.|\bA\.\s*Author\b|\bIn-text\s+marker\s+form\b", context):
        return True

    return False


def _is_date_only_citation(extracted_text: str) -> bool:
    """Check if extracted text is a date-only or non-citation parenthetical pattern.

    Filters out patterns like "(May 2012)", "(June 1996)", "(Spring 2013)",
    "(September 23, 1934)", "(Years 1–3)", "(City: Publisher, Year)"
    which are dates, ranges, or Chicago footnote publication blocks.

    Returns True if the text appears to be a date/non-citation only.
    """
    # Extract content inside parentheses or brackets
    inner = extracted_text.strip('()[]').strip()

    # Chicago footnote publication block: "(City: Publisher, YYYY)" or "(City, ST: Publisher, YYYY)"
    if re.match(
        r"^[A-Z][a-zA-Z.]+(?:\s+[A-Z][a-zA-Z.]+){0,2}(?:,\s*[A-Z]{2,3})?:\s+[^():]+,\s*(?:17|18|19|20)\d{2}$",
        inner,
    ):
        return True

    # Journal editorial receipt/acceptance metadata: "(Received: 29/07/2025; Revised: ...)"
    if re.match(
        r"^(?:received|revised|accepted|published|submitted|ngày\s+nhận|ngày\s+duyệt|ngày\s+đăng)\b",
        inner,
        re.IGNORECASE,
    ):
        return True

    # Self-compiled table/figure source notes: "(Nguồn: Tác giả tổng hợp, 2025)",
    # "(Nguồn: Kết quả phân tích dữ liệu nghiên cứu, 2025)"
    if re.match(
        r"^nguồn\s*:\s*(?:tác\s+giả|nhóm\s+tác\s+giả|nhóm\s+nghiên\s+cứu|học\s+viên|sinh\s+viên|nghiên\s+cứu\s+sinh|kết\s+quả\s+(?:phân\s+tích|khảo\s+sát|xử\s+lý|nghiên\s+cứu|tính\s+toán)|số\s+liệu\s+(?:khảo\s+sát|thống\s+kê|thu\s+thập|điều\s+tra)|dữ\s+liệu\s+(?:khảo\s+sát|thu\s+thập)|tổng\s+hợp\s+từ\s+kết\s+quả)",
        inner,
        re.IGNORECASE,
    ):
        return True

    # Statistical coefficient / test statistic parentheticals: "(Cramér's V)", "(Cohen's d)", "(Cronbach's alpha)"
    if re.match(
        r"^[A-ZÀ-Ý][A-Za-zÀ-ỹ]+['’]s\s+(?:[A-Za-z]|[αβγδχ]|alpha|beta|gamma|delta|tau|rho|kappa|lambda|omega)$",
        inner,
        re.IGNORECASE,
    ):
        return True

    # Non-citation range, chemistry/math label, or biblical chapter parenthetical:
    # "(Years 1–3)", "(ages 18-25)", "(Acts 18)", "(Scope 1, 2, 3)", "(Scheme 1)", "(Compound 2)", "(Round 1)"
    if re.match(
        r"^(?:years?|ages?|grades?|phases?|steps?|stages?|rounds?|cycles?|iterations?|passes?|tiers?|splits?|clusters?|topics?|tasks?|items?|itemsets?|optimizations?|sites?|points?|nodes?|edges?|blocks?|heads?|prompts?|queries|query|samples?|users?|comments?|labels?|versions?|drafts?|folds?|epochs?|batches?|layers?|seeds?|scores?|ranks?|rates?|ratios?|indices|index|values?|limits?|codes?|errors?|err|msg|messages?|logic|priority|gpio|irq|states?|modes?|bits?|bytes?|flags?|channels?|timers?|ports?|pins?|leds?|vlans?|vtps?|ospf|rip|nat|acl|dhcp|dns|ssh|http|https|status|llama|qwen|gpt|yolo|bert|resnet|vner|vlsp|xml|javascript|typescript|trang|hình|ảnh|bảng|mục|chương|phần|bước|nhóm|loại|câu|bài|đoạn|dòng|cột|top|stt|mssv|weeks?|months?|days?|chapters?|subchapters?|sections?|scopes?|parts?|clauses?|tables?|figures?|figs?\.?|schemes?|charts?|entries|entry|runs?|compounds?|reactions?|pathways?|models?|equations?|eqs?\.?|experiments?|trials?|cases?|groups?|types?|classes|levels?|rules?|theorems?|lemmas?|propositions?|corollaries|definitions?|examples?|algorithms?|listings?|appendices|appendix|supplements?|notes?|acts|genesis|exodus|psalms?|matthew|mark|luke|john|romans|corinthians)\s+(?:\d|[A-Z]\b)",
        inner,
        re.IGNORECASE,
    ):
        return True

    # Reject non-year 4-digit parentheticals like network ports "DB (3306)" or "(8080)"
    if re.search(r"\(\s*(?!(?:18|19|20)\d{2}\b)\d{4}\s*\)", extracted_text):
        return True

    # Technical/model acronym or version list parenthetical without a 4-digit year:
    # "(VLAN 10)", "(LLaMA 1, 2, 3)", "(HTTP 2)"
    if extracted_text.strip().startswith("(") and not re.search(r"\b(?:18|19|20)\d{2}\b", inner):
        if re.match(r"^[A-Z][A-Z0-9_-]+\s+\d+(?:\s*,\s*\d+)*$", inner):
            return True
        if re.match(r"^[A-Za-z][A-Za-z0-9_-]+\s+\d+(?:\s*,\s*\d+)+$", inner) and any(
            int(n) <= 20 for n in re.findall(r"\d+", inner)
        ):
            return True

    # Split by comma to get first word(s)
    first_part = inner.split(',')[0].strip()

    # Check if first word is a month or season name
    if first_part.lower() in _MONTH_NAMES_LOWER:
        return True
    if first_part.lower() in _SEASON_NAMES_LOWER:
        return True

    # Full calendar date: "(September 23, 1934)" or "(Jan. 5, 2021)"
    first_words = first_part.split()
    if len(first_words) == 2 and re.match(r"^\d{1,2}(?:st|nd|rd|th)?$", first_words[1]):
        m_word = first_words[0].lower().rstrip(".")
        if m_word in _MONTH_NAMES_LOWER or m_word in {"jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec"}:
            return True

    # Additional check: if the entire inner text is just "Month Year" or "Season Year"
    # without any author-like structure (comma or "et al.")
    words = inner.split()
    if len(words) == 2:
        first_word_lower = words[0].lower()
        if first_word_lower in _MONTH_NAMES_LOWER or first_word_lower in _SEASON_NAMES_LOWER:
            # Check if second word looks like a year
            if re.match(r'^\d{4}$', words[1]):
                return True

    return False


def _is_essay_title(text: str) -> bool:
    """Check if text appears to be an essay title, not a citation entry.

    Returns True if the text is likely an essay title/header.
    """
    text_stripped = text.strip()

    # Very long text (>200 chars) starting without punctuation — likely title
    if len(text_stripped) > 200 and _LONG_TEXT_START_RE.match(text_stripped):
        return True

    # Contains essay/survey/review indicators
    if _ESSAY_TITLE_INDICATORS.search(text_stripped):
        return True

    return False


class CitationExtractor:
    """Trích xuất citation từ Document đã parse.

    # TODO(user): tuần 6–7 — thêm:
        - Author NER (spaCy en_core_web_lg) để bắt author list chính xác
        - English-Vietnamese citation handling
        - Author override khi apa_reference_entry đã parse sẵn
    """

    def __init__(
        self,
        patterns: Iterable[CitationPattern | CompiledPattern] | None = None,
        include_utility: bool = False,
        preserve_occurrences: bool = False,
    ) -> None:
        self.preserve_occurrences = preserve_occurrences
        if patterns is None:
            # Use patterns from the new modular registry
            from integrity_checker.extraction.patterns import (
                get_in_text_patterns,
                get_utility_patterns,
            )
            self.patterns = get_in_text_patterns()
            if include_utility:
                self.patterns = self.patterns + get_utility_patterns()
        else:
            # Check if using old CITATION_PATTERNS (for backward compatibility)
            patterns_list = list(patterns)
            if patterns_list and hasattr(patterns_list[0], 'style'):
                # Check if it's the old CITATION_PATTERNS format
                for p in patterns_list:
                    if isinstance(p, CitationPattern):
                        warnings.warn(
                            "Passing CITATION_PATTERNS directly is deprecated. "
                            "Use CitationExtractor() without patterns to use the new registry, "
                            "or pass CompiledPattern objects from the patterns registry.",
                            DeprecationWarning,
                            stacklevel=2,
                        )
                        break
            self.patterns = patterns_list

        # Filter out utility patterns (year, doi, url) for in-text extraction
        # unless include_utility=True
        if not include_utility:
            self.patterns = [
                p for p in self.patterns
                if not hasattr(p, 'pattern_type') or p.pattern_type.value != 'utility'
            ]

        # Handle both CitationPattern (old) and CompiledPattern (new)
        # CitationPattern has .pattern (string), CompiledPattern has .compiled_regex
        self._compiled = []
        for p in self.patterns:
            if hasattr(p, 'compiled_regex'):
                # CompiledPattern - already has compiled regex
                compiled_regex = p.compiled_regex
            elif hasattr(p, 'compiled'):
                # Fallback for any module using .compiled
                compiled_regex = p.compiled
            else:
                # CitationPattern - need to compile
                compiled_regex = re.compile(p.pattern)
            self._compiled.append((p, compiled_regex))
        self.preprocessor = TextPreprocessor()

    # -- public API --

    @staticmethod
    def _find_valid_ref_header_match(raw_text: str) -> re.Match | None:
        """Return first valid bibliography header match on a page, ignoring 'Reference(s)' labels in tables/figures."""
        table_col_re = re.compile(
            r"(?:Entities(?:,\s*n)?|Entity|Attribute|Recall|Precision|F1(?:\s*Score)?|Accuracy|Score|Metric|Support|"
            r"Strengths?|Weaknesses|Limitations?|Advantages|Disadvantages|Sensor\s+Type|Aspect|Comparison|Criterion|Criteria|Carbon\s+source)"
            r"(?:\s+(?:Recall|Precision|F1(?:\s*Score)?))*",
            re.IGNORECASE,
        )
        from integrity_checker.extraction.section_segmenter import SectionSegmenter

        page_is_toc = SectionSegmenter._is_toc_like_page(raw_text or "")
        for m in _REFERENCE_HEADERS.finditer(raw_text or ""):
            matched_word = (m.group(1) or "").strip()
            if matched_word.islower():
                continue
            prev_win = raw_text[max(0, m.start() - 300) : m.start()]
            after_lines = [ln.strip() for ln in raw_text[m.end() :].splitlines()[:12] if ln.strip()]
            before_lines = [ln.strip() for ln in prev_win.splitlines()[-6:] if ln.strip()]
            if sum(1 for ln in (before_lines + after_lines[:8]) if table_col_re.fullmatch(ln)) >= 2:
                continue
            if page_is_toc:
                has_immediate_refs = sum(
                    1
                    for ln in after_lines[:6]
                    if re.search(
                        r"^(?:\[\s*\d+\s*\]|\d{1,3}[\.\)]\s+[A-ZÀ-Ý].*\b(?:18|19|20)\d{2}\b)|https?://|doi:",
                        ln,
                        re.IGNORECASE,
                    )
                    or (
                        len(ln) >= 35
                        and not re.search(r"(?:\.\s*){4,}\d+\s*$", ln)
                        and bool(re.search(r"\b(?:18|19|20)\d{2}\b", ln))
                    )
                )
                if has_immediate_refs == 0:
                    continue
            if re.fullmatch(r"tài\s+liệu", matched_word, re.IGNORECASE):
                has_bracket_one = any(re.match(r"^\[\s*1\s*\]\s+\S", ln) for ln in after_lines[:2])
                has_bib_cue_tl = bool(
                    re.search(
                        r"^\[\s*2\s*\]|\b(?:18|19|20)\d{2}\b|https?://|doi:",
                        "\n".join(after_lines[:6]),
                        re.IGNORECASE | re.MULTILINE,
                    )
                )
                if not (has_bracket_one and has_bib_cue_tl):
                    continue
            m_sub = re.match(r"^\s*(\d+)\.(\d+)\b", m.group(0).strip())
            if m_sub and after_lines:
                if after_lines[0].startswith(f"{m_sub.group(1)}.{int(m_sub.group(2)) + 1}"):
                    continue
            if re.fullmatch(r"references?|literature", matched_word, re.IGNORECASE):
                if re.search(r"\b[A-Z]{2,}_[A-Z]{2,}\b", "\n".join(before_lines + after_lines[:8])) and not re.search(
                    r"\b(?:18|19|20)\d{2}\b|\[\d+\]|https?://|doi:",
                    "\n".join(after_lines[:8]),
                    re.IGNORECASE,
                ):
                    continue
                if re.search(r"\b(?:table|bảng)\s+\d+", prev_win, re.IGNORECASE):
                    if not before_lines or not before_lines[-1].endswith("."):
                        continue
                if re.search(
                    r"self[- ]?evaluation|marking\s+scheme|no\s+reference|grading\s+rubric|bảng\s+tự\s+đánh\s+giá",
                    prev_win + "\n" + "\n".join(after_lines[:8]),
                    re.IGNORECASE,
                ):
                    continue
            if re.fullmatch(r"tham\s+khảo", matched_word, re.IGNORECASE):
                has_ref_items = sum(
                    1
                    for ln in after_lines[:8]
                    if re.search(r"^(?:\[\d+\]|\d{1,2}[\.\)])|https?://|\b(?:19|20)\d{2}\b", ln, re.IGNORECASE)
                )
                if not m.group(0).strip().endswith(":") and has_ref_items < 2:
                    continue
                if has_ref_items < 1:
                    continue
            if re.fullmatch(r"reference", matched_word, re.IGNORECASE):
                if len(after_lines) > 4 and not re.search(
                    r"\b(?:18|19|20)\d{2}\b|\[\d+\]|https?://|doi:",
                    "\n".join(after_lines),
                    re.IGNORECASE,
                ):
                    continue
            if re.fullmatch(r"(?:notes(?:\s+and\s+references)?|endnotes?)", matched_word, re.IGNORECASE):
                has_numbered_note = any(
                    re.match(r"^(?:\[\d+\]|\d{1,2}(?:[\.\)]|\s+[A-ZÀ-Ý“\"‘']))", ln)
                    for ln in after_lines[:6]
                )
                has_bib_cue = bool(
                    re.search(r"\b(?:18|19|20)\d{2}\b|https?://|doi:", "\n".join(after_lines[:10]), re.IGNORECASE)
                )
                if not (has_numbered_note and has_bib_cue):
                    continue
            return m
        return None

    def extract_from_text(
        self, text: str, page_num: int = 1, *, stop_at_bibliography: bool = False
    ) -> list[Citation]:
        """Extract in-text citations directly from a raw string."""
        from integrity_checker.extraction.base import Page

        doc = Document(
            file_path="",
            num_pages=max(1, page_num),
            pages=[Page(page_num=page_num, text=text or "")],
        )
        return self.extract_from_document(doc, stop_at_bibliography=stop_at_bibliography)

    def extract_from_document(
        self, doc: Document, *, stop_at_bibliography: bool = True
    ) -> list[Citation]:
        """Trích xuất mọi *occurrence* citation trong Document.

        Không được dedupe theo ``raw_text``: một nguồn có thể được trích dẫn
        nhiều lần và mỗi lần là một occurrence cần hiển thị/đếm trong báo cáo.
        Việc chống trùng do nhiều regex match cùng một vị trí được thực hiện
        trong ``_extract_from_text``.
        """
        citations: list[Citation] = []
        bib_candidates = (
            [
                p.page_num
                for p in (doc.pages or [])
                if self._find_valid_ref_header_match(p.text or "") is not None
            ]
            if stop_at_bibliography
            else []
        )
        target_bib_page: int | None = None
        if bib_candidates:
            if len(bib_candidates) > 1 and doc.num_pages:
                later = [p for p in bib_candidates if p > doc.num_pages * 0.35]
                if later:
                    target_bib_page = later[-1]
                    while target_bib_page - 1 in later:
                        target_bib_page -= 1
                else:
                    target_bib_page = bib_candidates[-1]
            else:
                target_bib_page = bib_candidates[0]

        in_bib_section = False
        for page in doc.pages:
            if in_bib_section:
                break
            raw_text = page.text  # Keep raw text for whitespace detection
            ref_header_m = (
                self._find_valid_ref_header_match(raw_text)
                if (
                    stop_at_bibliography
                    and (target_bib_page is None or page.page_num == target_bib_page)
                )
                else None
            )
            if ref_header_m:
                raw_text = raw_text[: ref_header_m.start()]
                in_bib_section = True
            if not raw_text.strip():
                continue
            normalized = self.preprocessor.normalize(raw_text)
            page_citations = self._extract_from_text(raw_text, normalized, page.page_num)
            citations.extend(page_citations)

        if not self.preserve_occurrences:
            citations = self._dedupe(citations)
        for c in citations:
            c.confidence = self._estimate_confidence(c)
        return citations

    def find_reference_section(self, doc: Document) -> tuple[int, int] | None:
        """Trả về (start_page, end_page) của reference section. None nếu không thấy."""
        candidates = [
            page.page_num
            for page in doc.pages
            if self._find_valid_ref_header_match(page.text) is not None
        ]
        if candidates:
            if len(candidates) > 1 and doc.num_pages:
                later = [p for p in candidates if p > doc.num_pages * 0.35]
                if later:
                    start = later[-1]
                    while start - 1 in later:
                        start -= 1
                else:
                    start = candidates[-1]
            else:
                start = candidates[0]
            max_page = max(p.page_num for p in doc.pages) if doc.pages else doc.num_pages
            end = min(start + 5, max_page)
            return (start, end)
        return None

    # -- internals --

    def _extract_from_text(self, raw_text: str, normalized_text: str, page_num: int) -> list[Citation]:
        """Extract citations from text.

        Args:
            raw_text: Raw text for whitespace/position detection
            normalized_text: Preprocessed text for regex matching
            page_num: Page number
        """
        results: list[Citation] = []
        # Several registered formats can match the same token at the same
        # character span (e.g. "[1]" is matched by IEEE, ACM, Vancouver, Nature,
        # CSE and Chicago Notes patterns at once).  Deduplicate by SPAN ONLY:
        # the first pattern to claim a span wins.  Keying on citation_type as
        # well let one survivor through per type — a numeric and an in_text
        # variant of the very same "[24]" — which doubled every numeric
        # occurrence in the report ("x4" instead of "x2").
        seen_spans: set[tuple[int, int]] = set()
        accepted_spans: set[tuple[int, int]] = set()
        search_text = self.preprocessor._normalize_unicode(
            self.preprocessor._fix_ligatures(raw_text)
        )
        for pattern_def, compiled in self._compiled:
            # Find positions in NFC/ligature-normalized text while preserving newlines
            for m in compiled.finditer(search_text):
                raw = m.group(0).strip()
                # Clean up: remove newlines and excessive whitespace from raw text
                raw = re.sub(r'\s+', ' ', raw).strip()
                # Skip if raw is too long (likely contains page headers)
                if len(raw) > 150:
                    continue

                # Skip standalone years (e.g., "2026" - not a citation)
                if re.match(r'^\d{4}[a-z]?$', raw):
                    continue

                raw_start = m.start()

                # Extract citation_type and style from pattern
                # Handle both CitationPattern (old) and CompiledPattern (new)
                if isinstance(pattern_def, CitationPattern):
                    citation_type = pattern_def.type
                    style = pattern_def.style
                else:
                    # CompiledPattern provides type and style properties
                    citation_type = pattern_def.type
                    style = pattern_def.style

                span_key = (m.start(), m.end())
                if span_key in seen_spans or any(
                    m.start() < e and m.end() > s for s, e in accepted_spans
                ):
                    continue
                seen_spans.add(span_key)

                # Bug fix 1: Filter out IEEE [N] reference list markers and array/year/interval/ORCID brackets ([0], [0, 1], [2020], [0000-0000-0000-0000])
                # "[4] Xiao, Y., ..." at start of line is a reference list entry, not in-text citation
                if raw.startswith("["):
                    raw = re.sub(r"\s+", " ", raw)
                    if re.fullmatch(r"\[\s*(?:0|(?:18|19|20)\d{2})\s*\]", raw) or re.match(r"^\[\s*0", raw):
                        continue
                    # Reject brackets containing 0 as an element (e.g. [1, 0], [1, 0, 1]) or space-separated matrices ([1 2], [1 2 3])
                    if re.search(r"(?:^\[\s*|[,;\s])0(?:\s*[,;\]\s])", raw) or re.fullmatch(
                        r"\[\s*\d+(?:\s+\d+)+\s*\]", raw
                    ):
                        continue
                    raw_without_page = re.sub(
                        r"\s*[,;:]\s*(?:tr\.?|trang|pp?\.?)\s*\d+(?:\s*[,–\-—]\s*\d+)*(?=\s*\])",
                        "",
                        raw,
                        flags=re.IGNORECASE,
                    )
                    bracket_tokens = re.findall(r"(\d+)([a-z]?)", raw_without_page)
                    bracket_nums = [int(n) for n, _ in bracket_tokens]
                    bracket_pairs = [(int(n), sub) for n, sub in bracket_tokens]
                    if bracket_nums:
                        # Reject duplicate tokens inside the same bracket ([1, 1], [10, 255, 255]), large buffer/pixel sizes (>= 300),
                        # or non-ascending multi-number vectors containing values >= 50 (e.g. token IDs [101, 205, 89]).
                        # Distinct composite sub-labels like [14a, 14c] have distinct (14, 'a') vs (14, 'c') pairs.
                        if (
                            len(bracket_pairs) != len(set(bracket_pairs))
                            or any(n >= 300 for n in bracket_nums)
                            or (
                                len(bracket_nums) >= 2
                                and any(b < a for a, b in zip(bracket_nums, bracket_nums[1:], strict=False))
                                and any(n >= 50 for n in bracket_nums)
                            )
                        ):
                            continue
                    line_start_b = search_text.rfind("\n", 0, raw_start) + 1
                    line_end_b = search_text.find("\n", m.end())
                    if line_end_b == -1:
                        line_end_b = len(search_text)
                    line_prefix_b = search_text[line_start_b:raw_start]
                    line_suffix_b = search_text[m.end() : line_end_b]
                    full_line_b = search_text[line_start_b:line_end_b]
                    context_prefix_b = re.sub(r"\s+", " ", search_text[max(0, raw_start - 60) : raw_start])
                    # Reject code array indexing, XPath predicates (/KetQua[1]/KyNang[1]), Word exported comments (Commented [1]:), and R console vector lines (## [1] 0.84)
                    if (
                        re.search(
                            r"(?:[A-Za-z0-9_](?:\[\s*[^\]]*\s*\])+|[A-Za-z0-9_]\.[A-Za-z_][A-Za-z0-9_]*|[A-Za-z0-9_]+_[A-Za-z0-9_]+|(?:^|[\s\"'=(,\]])/[A-Za-z_][A-Za-z0-9_.-]*|\bCommented\s*|\b(?:byte|int|char|float|double|long|short|uint\d*|int\d*|bool|string)(?:\s+[A-Za-z_][A-Za-z0-9_]*)?\s*|\b(?:buffer|arr|array|vec|vector|matrix|tensor|dp|mat|grid|axs|ax|plt|parts|args|argv|df|coefficients|weights|biases|params|dims?)(?:\[\s*[^\]]*\s*\])*\s*|\[\s*)$",
                            line_prefix_b,
                        )
                        or (
                            re.search(r"[A-Za-z0-9_\]\)]$", line_prefix_b)
                            and re.match(r"^/[A-Za-z_]", line_suffix_b)
                        )
                        or re.match(
                            r"^\s*(?:##\s*|>\s*)\[\s*\d+\s*\]\s+(?:-?\d+\.\d+|TRUE|FALSE|NA|\"[^\"]*\")",
                            full_line_b,
                        )
                        or re.match(
                            r"^\.[A-Za-z_][A-Za-z0-9_]*|^\[|^\s*\](?:\s*,|\s*\])|^\s*(?:=(?!=)|[+\-*/%]=|==|!=|<=|>=)",
                            line_suffix_b,
                        )
                        or re.search(r"\[\s*\[[^\]]+\]\s*,\s*\[[^\]]+\]", full_line_b)
                        or re.search(r"[a-zA-Z_][a-zA-Z0-9_]*\s*\[\s*\d+\s*\]\s*;\s*$", full_line_b)
                        or re.search(
                            r"\b[a-zA-Z_]\w*\[\s*(?:0|[ijknm](?:\s*[-+]\s*1)?)\s*\]|\b(?:const|let|var|await|JSON\.parse)\b",
                            full_line_b,
                        )
                        or (
                            len(bracket_nums) == 1
                            and re.search(
                                r"\b(?:Figure|Fig\.?|Table|Tab\.?|Equation|Eq\.?|Formula|Section|Sec\.?|Chapter|Chap\.?|Step|Algorithm|Alg\.?|Theorem|Lemma|Appendix|Hình|Bảng|Mục|Chương|Bước|Công\s+thức|Phương\s+trình|Định\s+lý|Bổ\s+đề|Thuật\s+toán|Phụ\s+lục)\s*$",
                                context_prefix_b,
                                re.IGNORECASE,
                            )
                        )
                    ):
                        continue
                    # Reject math/code vector assignments, dict hyperparameter grids (straight or curly quotes), function array args, and Vietnamese math intervals/tensor shapes
                    if (
                        (
                            len(bracket_nums) >= 2
                            and re.search(
                                r"(?:=\s*|[\'\"\u2018\u2019\u201c\u201d][\w\-]+[\'\"\u2018\u2019\u201c\u201d]\s*:\s*|\b(?:Input|Output|Ids?|Vector|Array|Shape|Size|Dims?)\s*:\s*|[A-Za-z0-9_]\(\s*)$",
                                line_prefix_b,
                                re.IGNORECASE,
                            )
                        )
                        or re.search(
                            r"\b(?:khoảng|đoạn|miền|kích\s+thước|có\s+dạng|đầu\s+vào\s+là|đầu\s+ra\s+là)\s*$",
                            context_prefix_b,
                            re.IGNORECASE,
                        )
                    ):
                        continue
                    # Reject corpus/lexical frequency counts in brackets right after quoted terms
                    # e.g. 'led by "cố lên" [730], "hãy chia sẻ" [75], "cười chết" [6], "chết cười" [3], "hãy đi khám" [3]'
                    if len(bracket_nums) == 1 and re.search(r"[\'\"\u2018\u2019\u201c\u201d]\s*$", line_prefix_b):
                        quote_freq_win = re.sub(
                            r"\s+",
                            " ",
                            search_text[max(0, raw_start - 250) : min(len(search_text), m.end() + 250)],
                        )
                        quote_freq_nums = [
                            int(n)
                            for n in re.findall(
                                r"[\'\"\u2018\u201c][^\'\"\u2019\u201d]{1,60}[\'\"\u2019\u201d]\s*\[\s*(\d+)\s*\]",
                                quote_freq_win,
                            )
                        ]
                        if len(quote_freq_nums) >= 3 and (
                            any(n >= 300 for n in quote_freq_nums)
                            or len(quote_freq_nums) != len(set(quote_freq_nums))
                            or all(a >= b for a, b in zip(quote_freq_nums, quote_freq_nums[1:], strict=False))
                        ):
                            continue
                if (
                    citation_type == CitationType.NUMERIC
                    or re.match(r"^\[\s*\d+\s*\]$", raw)
                ) and _is_reference_list_marker(search_text, raw_start, m.end()):
                    continue

                # Filter out template placeholder citations like "(Author et al., 2020)", "Author (2020)"
                if re.match(r"^\(?\s*authors?\b", raw, re.IGNORECASE):
                    continue

                # Filter out bullet-point timeline/mandate headings like "● Nhiệm vụ của Jeff Bezos (2002):"
                if citation_type == CitationType.IN_TEXT and not raw.startswith(("(", "[")):
                    line_start_n = search_text.rfind("\n", 0, raw_start) + 1
                    line_end_n = search_text.find("\n", m.end())
                    if line_end_n == -1:
                        line_end_n = len(search_text)
                    line_prefix_n = search_text[line_start_n:raw_start]
                    line_suffix_n = search_text[m.end() : line_end_n]
                    if (
                        re.search(
                            r"(?:^\s*[●•▪◦\-*\u200b]+\s*(?:Nhiệm\s+vụ|Mệnh\s+lệnh|Sự\s+kiện|Giai\s+đoạn|Thời\s+kỳ)\b|\b(?:Nhiệm\s+vụ|Mệnh\s+lệnh|Sự\s+kiện|Giai\s+đoạn|Thời\s+kỳ)\s+của\s*$)",
                            line_prefix_n,
                            re.IGNORECASE,
                        )
                        and re.match(r"^\s*:", line_suffix_n)
                    ):
                        continue

                # Bug fix 2: Filter out essay titles being extracted as citations
                # Titles like "Deep Learning for Natural Language Processing: A Comprehensive Survey..."
                if _is_essay_title(raw):
                    continue

                # Bug fix 3: Filter out [N] in test scenario contexts
                # Test scenarios like "Reference: [1]" or "APA-01: MATCHED" should not extract [1]
                if citation_type == CitationType.NUMERIC or raw.startswith("["):
                    if _is_in_test_scenario_context(search_text, raw_start):
                        continue

                # Bug fix 4: Filter out date-only patterns like "(May 2012)", "(Spring 2013)"
                # and non-author parentheticals like "(42, 123, 2024)" or "(loadComments, 5000)"
                if _is_date_only_citation(raw):
                    continue
                if citation_type == CitationType.IN_TEXT and not raw.startswith(("(", "[")):
                    # Skip journal header self-citation metadata lines ("Trích dẫn: Author (2026)...", "How to cite: ...")
                    line_start_idx = search_text.rfind("\n", 0, raw_start) + 1
                    line_end_idx = search_text.find("\n", m.end())
                    if line_end_idx == -1:
                        line_end_idx = len(search_text)
                    line_prefix_str = search_text[line_start_idx:raw_start]
                    line_suffix_str = search_text[m.end() : line_end_idx]
                    full_line_str = search_text[line_start_idx:line_end_idx]
                    if re.search(
                        r"(?:trích\s+dẫn(?:\s+bài\s+viết)?|cách\s+trích\s+dẫn|how\s+to\s+cite|to\s+cite\s+this|suggested\s+citation|cite\s+this\s+article)\s*:",
                        line_prefix_str,
                        re.IGNORECASE,
                    ):
                        continue
                    # Skip Table-of-Contents / List-of-Figures leader-dot lines ("Hình 2.1 ... (1980) ...... 15")
                    if re.search(r"(?:\.\s*){4,}\d+\s*$", line_suffix_str):
                        continue
                    # Skip figure/table captions naming an artwork/game/product ("Hình 2.1 Gameplay của Rogue (1980)")
                    if (
                        re.match(
                            r"^\s*(?:Hình|Ảnh|Bảng|Sơ\s+đồ|Biểu\s+đồ|Figure|Fig\.?|Table)\s+\d+(?:\.\d+)*\b",
                            full_line_str,
                            re.IGNORECASE,
                        )
                        and not re.search(
                            r"\b(?:et\s+al\.?|và\s+cộng\s+sự|và\s+cs\.?|&|and)\b",
                            raw,
                            re.IGNORECASE,
                        )
                        and not re.search(
                            r"\b(?:adapted\s+from|modified\s+from|reprinted\s+from|source\s*:|nguồn\s*:|theo|trích|summarizes|shows|compares)\b",
                            full_line_str,
                            re.IGNORECASE,
                        )
                        and re.search(
                            r"\b(?:của|game|trò\s+chơi|phần\s+mềm|ứng\s+dụng|phiên\s+bản)\s+$",
                            line_prefix_str,
                            re.IGNORECASE,
                        )
                    ):
                        continue
                    # Strip leading acronym clause before ", Author (Year)" (e.g. "EI and HRV, Vanuk et al. (2019)")
                    # and Vietnamese discourse markers ("Cụ thể, Reimers và Gurevych (2019)")
                    raw = re.sub(r"^(?:[A-Z]{2,5}\s+and\s+[A-Z]{2,5},\s+)", "", raw).strip()
                    raw = re.sub(
                        r"^(?:Cụ\s*thể|Ví\s*dụ|Chẳng\s*hạn|Theo\s*đó|Ngoài\s*ra|Tuy\s*nhiên|Do\s*đó|Như\s*vậy|Mặt\s*khác|Đặc\s*biệt|Trong\s*đó|Tương\s*tự|Ngược\s*lại|Hơn\s*nữa),\s+",
                        "",
                        raw,
                        flags=re.IGNORECASE,
                    ).strip()
                    # Skip common-noun page/year parentheticals, political/movie/hardware mentions, or pre-1900 historical founding years
                    if re.match(
                        r"^(?:Networks?|Papers?|Tables?|Figures?|Chapters?|Sections?|Parts?|Equations?|Models?|Systems?|Đảng)\s*[\(\[]",
                        raw,
                        re.IGNORECASE,
                    ):
                        continue
                    if re.match(
                        r"^(?:[A-Z][a-z]+\s+)?(?:I|II|III|IV|V|VI|VII|VIII|IX|X)\s*[\(\[]\s*(?:19|20)\d{2}\s*[\)\]]$",
                        raw,
                    ):
                        accepted_spans.add(span_key)
                        continue
                    narrative_ctx_prefix = re.sub(
                        r"\s+", " ", search_text[max(0, raw_start - 60) : raw_start]
                    )
                    narrative_head = re.split(r"\s*[\(\[]", raw, maxsplit=1)[0].strip()
                    has_collab_marker = bool(
                        re.search(
                            r"\b(?:et\s+al\.?|và\s+cộng\s+sự|và\s+cs\.?|&)\b",
                            narrative_head,
                            re.IGNORECASE,
                        )
                    )
                    if not has_collab_marker:
                        is_inst_head = bool(
                            re.search(
                                r"\b(?:Bank|Organization|Organisation|Association|Institute|Ministry|Department|Commission|Committee|Council|Reserve|Nations|Union|Agency|Bureau|Board|Foundation|Society|College|University|Academy|Center|Centre|Group|Team|Project|Lancet|Economist|Guardian|Times|Post|Press|Journal|Report|Office|Authority|Federation|Coalition|Consortium|Alliance|Forum|Observatory|Clinic|Clinics|Hospital|Trust)\b",
                                narrative_head,
                                re.IGNORECASE,
                            )
                        )
                        # Reject quoted work titles followed by (Year), e.g. "‘Decline of the Roman Empire’ (2018)"
                        if re.search(r"['\u2019\"\u201d]\s*[\(\[]", raw):
                            accepted_spans.add(span_key)
                            continue
                        # Reject non-institutional phrases starting with article 'The ' (e.g. "The Machiavellian Moment (1975)", "The Second Industrial Revolution (1870)")
                        if (
                            re.match(r"^The\s+", narrative_head)
                            or re.search(r"\bThe\s+$", narrative_ctx_prefix)
                        ) and not is_inst_head:
                            accepted_spans.add(span_key)
                            continue
                        # Reject unconditional work-title / historical-concept nouns before (Year)
                        if re.search(
                            r"\b(?:Revolution|Revolutions|Moment|History|Histories|Historiography|Constitution|Treaty|Manifesto|Edition|Survey|Index|Tradition|Condition|Empire|Empires|Government|Republic|Kingdom|Triumph|Reformation|Enlightenment|Renaissance|Declaration|Convention|Charter|Discontents|Sovereignty)$",
                            narrative_head,
                        ) and not is_inst_head:
                            accepted_spans.add(span_key)
                            continue
                        # Reject multi-word work titles ending in Law/War/Fall/Thought/Era/Age (e.g. "Feudal Law (1957)", "Decline and Fall (2003)")
                        head_words = narrative_head.split()
                        if (
                            len(head_words) >= 2
                            and "," not in narrative_head
                            and not re.match(r"^[A-Z]\.\s+", narrative_head)
                            and re.search(
                                r"\b(?:Law|Laws|War|Wars|Fall|Thought|Age|Era|Period|Movement|Crisis|Depression)$",
                                narrative_head,
                            )
                            and not is_inst_head
                        ):
                            accepted_spans.add(span_key)
                            continue
                    if (
                        not re.search(r"\b(?:et\s+al\.?|và\s+cộng\s+sự|và\s+cs\.?|&|and)\b", raw, re.IGNORECASE)
                        and re.search(
                            r"\b(?:bộ\s+phim|phim|tác\s+phẩm\s+điện\s+ảnh|hệ\s+thống(?:\s+dịch(?:\s+máy)?)?|dòng\s+máy|trường\s+thi|chiến\s+dịch|phong\s+trào|khởi\s+nghĩa|hiệp\s+định|tỉnh|thành\s+phố|(?:treaty|battle|peace|edict|statute|diet|council)\s+of)\s+$",
                            narrative_ctx_prefix,
                            re.IGNORECASE,
                        )
                    ):
                        accepted_spans.add(span_key)
                        continue
                    if re.search(r"[\(\[]\s*(?:1[0-7]\d{2})\s*[\)\]]$", raw):
                        continue
                if citation_type == CitationType.IN_TEXT and raw.startswith(("(", "[")):
                    if style != CitationStyle.MLA and not re.search(
                        r"\b(?:(?:18|19|20)\d{2}[a-z]?|n\.?\s*d\.?(?:-[a-z])?)",
                        raw,
                        re.IGNORECASE,
                    ):
                        continue
                    inner_head = raw[1:].split(",")[0].strip().lstrip("\"\u201c\u201d'\u2018\u2019")
                    inner_head = re.sub(
                        r"^(?:see\s+also|see|cf\.?|e\.g\.?,?|i\.e\.?,?|for\s+example|adapted\s+from|modified\s+from|data\s+from|source\s*:|(?:as\s+)?(?:cited|quoted)\s+in|dẫn\s+(?:lại\s+)?(?:theo|từ)|trích\s+(?:dẫn\s+)?(?:trong|từ|theo))\s+",
                        "",
                        inner_head,
                        flags=re.IGNORECASE,
                    ).strip()
                    has_particle = bool(
                        re.match(
                            r"^(?:da|de|del|della|der|di|do|dos|du|el|la|le|van|von|zu|zur)\s+[A-ZÀ-Ý]",
                            inner_head,
                        )
                    )
                    if not inner_head or not any(ch.isupper() for ch in inner_head) or inner_head[0].isdigit() or (inner_head[0].islower() and not has_particle):
                        continue

                accepted_spans.add(span_key)

                citation = Citation(
                    raw_text=raw,
                    citation_type=citation_type,
                    style=style,
                    page_num=page_num,
                    matched_pattern=pattern_def.name,
                )
                # Parse các field con
                self._populate_fields(citation, raw)
                results.append(citation)
        return results

    def _populate_fields(self, citation: Citation, raw: str) -> None:
        """Best-effort trích DOI / URL / year từ raw text."""
        from integrity_checker.extraction.patterns.utils import (
            extract_doi,
            extract_url,
            extract_year,
        )

        if not citation.doi:
            citation.doi = extract_doi(raw)
        if not citation.url:
            citation.url = extract_url(raw)
        if not citation.year:
            citation.year = extract_year(raw)

    def _estimate_confidence(self, citation: Citation) -> float:
        """Heuristic confidence 0–1 dựa trên field có sẵn."""
        score = 0.0
        if citation.year:
            score += 0.25
        if citation.doi:
            score += 0.40
        if citation.url:
            score += 0.10
        if citation.authors:
            score += 0.15
        if citation.title:
            score += 0.10
        return min(score, 1.0)

    def _dedupe(self, citations: list[Citation]) -> list[Citation]:
        """Bỏ trùng theo (style, normalized raw_text)."""
        seen: set[tuple[str, str]] = set()
        unique: list[Citation] = []
        for c in citations:
            key = (c.style.value, c.raw_text.lower().strip())
            if key in seen:
                continue
            seen.add(key)
            unique.append(c)
        return unique
