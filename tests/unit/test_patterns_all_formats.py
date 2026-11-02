"""Comprehensive unit and integration tests for all 11 citation & reference formats.

Covers:
    - APA, IEEE, ACM, Harvard, Vancouver, Nature, CSE, ACS, AMA, Chicago, MLA
    - Reference entry parsing (articles, books, chapters, conferences, DOIs)
    - Author parsing with format_name across all 11 formats
    - In-text extraction & false-positive prevention (math exponents, dates, tables/figures)
    - Bidirectional in-text <-> bibliography linking across all 11 formats
    - StyleDetector classification across all 11 formats
"""

from __future__ import annotations

import pytest

from integrity_checker.extraction.citation_extractor import CitationExtractor
from integrity_checker.extraction.patterns import (
    ACMFormat,
    ACSFormat,
    AMAFormat,
    APAFormat,
    ChicagoFormat,
    CSEFormat,
    HarvardFormat,
    IEEEFormat,
    MLAFormat,
    NatureFormat,
    VancouverFormat,
    get_format,
)
from integrity_checker.extraction.reference_parser import ReferenceListParser
from integrity_checker.extraction.style_detector import StyleDetector
from integrity_checker.linking.citation_linker import CitationLinker
from integrity_checker.linking.statuses import CitationMappingStatus
from integrity_checker.matching.author_parser import parse_authors
from integrity_checker.models.citation import CitationStyle, CitationType


class TestAllFormatsRegistered:
    """Verify all 11 citation formats are registered and properly mapped."""

    @pytest.mark.parametrize(
        ("format_name", "expected_style", "expected_cls"),
        [
            ("APA", CitationStyle.APA, APAFormat),
            ("IEEE", CitationStyle.IEEE, IEEEFormat),
            ("ACM", CitationStyle.ACM, ACMFormat),
            ("Harvard", CitationStyle.HARVARD, HarvardFormat),
            ("Vancouver", CitationStyle.VANCOUVER, VancouverFormat),
            ("Nature", CitationStyle.NATURE, NatureFormat),
            ("CSE", CitationStyle.CSE, CSEFormat),
            ("ACS", CitationStyle.ACS, ACSFormat),
            ("AMA", CitationStyle.AMA, AMAFormat),
            ("Chicago", CitationStyle.CHICAGO, ChicagoFormat),
            ("MLA", CitationStyle.MLA, MLAFormat),
        ],
    )
    def test_format_registered_and_patterns_mapped(
        self, format_name: str, expected_style: CitationStyle, expected_cls: type
    ) -> None:
        fmt = get_format(format_name)
        assert fmt is not None
        assert isinstance(fmt, expected_cls)
        assert len(fmt.in_text_patterns) >= 1
        assert len(fmt.reference_patterns) >= 1

        for pat in fmt.in_text_patterns:
            assert pat.style == expected_style
            assert pat.type in (CitationType.IN_TEXT, CitationType.NUMERIC)

        for pat in fmt.reference_patterns:
            assert pat.style == expected_style
            assert pat.type == CitationType.REFERENCE_LIST


class TestReferenceParsingAllFormats:
    """Verify ReferenceListParser parses canonical entries for all 11 formats."""

    @pytest.fixture
    def parser(self) -> ReferenceListParser:
        return ReferenceListParser()

    @pytest.mark.parametrize(
        ("label", "raw", "expected_style", "expected_year", "expected_title_substr", "expected_authors", "expected_index"),
        [
            (
                "APA_journal",
                "Smith, J. A., & Doe, B. (2020). Deep learning for natural language processing. Journal of Artificial Intelligence, 15(2), 123-135. https://doi.org/10.1000/jai.2020.123",
                CitationStyle.APA,
                "2020",
                "Deep learning for natural language processing",
                ["smith", "doe"],
                None,
            ),
            (
                "APA_book",
                "Goodfellow, I., Bengio, Y., & Courville, A. (2016). Deep learning. MIT Press.",
                CitationStyle.APA,
                "2016",
                "Deep learning",
                ["goodfellow", "bengio", "courville"],
                None,
            ),
            (
                "IEEE_journal",
                '[1] J. A. Smith and B. Doe, "Deep learning for natural language processing," IEEE Trans. Neural Netw., vol. 15, no. 2, pp. 123-135, 2020.',
                CitationStyle.IEEE,
                "2020",
                "Deep learning for natural language processing",
                ["smith", "doe"],
                1,
            ),
            (
                "IEEE_conf",
                '[2] K. He, X. Zhang, S. Ren, and J. Sun, "Deep residual learning for image recognition," in Proc. IEEE Conf. Comput. Vis. Pattern Recognit. (CVPR), 2016, pp. 770-778.',
                CitationStyle.IEEE,
                "2016",
                "Deep residual learning for image recognition",
                ["he", "zhang", "sun"],
                2,
            ),
            (
                "ACM_year_first",
                "[1] John A. Smith and Jane B. Doe. 2020. Deep learning for natural language processing. Commun. ACM 63, 4 (April 2020), 123-135. https://doi.org/10.1145/1234567",
                CitationStyle.ACM,
                "2020",
                "Deep learning for natural language processing",
                ["smith", "doe"],
                1,
            ),
            (
                "ACM_journal",
                "[2] Smith, J. A. and Doe, B. Deep learning for natural language processing. J. ACM, 15, 2 (2020), 123-135.",
                CitationStyle.ACM,
                "2020",
                "Deep learning for natural language processing",
                ["smith", "doe"],
                2,
            ),
            (
                "ACM_book",
                "[3] Donald E. Knuth. The Art of Computer Programming, 3rd ed. Addison-Wesley, Reading, MA, 1997.",
                CitationStyle.ACM,
                "1997",
                "The Art of Computer Programming",
                ["knuth"],
                3,
            ),
            (
                "Harvard_quoted",
                "Smith, J.A. and Doe, B. (2020) 'Deep learning for natural language processing', Journal of Artificial Intelligence, 15(2), pp. 123-135.",
                CitationStyle.HARVARD,
                "2020",
                "Deep learning for natural language processing",
                ["smith", "doe"],
                None,
            ),
            (
                "Harvard_book",
                "Smith, J.A., 2020. Deep learning in practice. 2nd ed. London: Penguin Books.",
                CitationStyle.HARVARD,
                "2020",
                "Deep learning in practice",
                ["smith"],
                None,
            ),
            (
                "Harvard_chapter",
                "Smith, J.A. (2020) 'Neural architectures', in Doe, B. (ed.) Handbook of AI. Oxford: Oxford University Press, pp. 45-67.",
                CitationStyle.HARVARD,
                "2020",
                "Neural architectures",
                ["smith"],
                None,
            ),
            (
                "Vancouver_num",
                "1. Smith JA, Doe B. Deep learning for natural language processing. J Artif Intell. 2020;15(2):123-135.",
                CitationStyle.VANCOUVER,
                "2020",
                "Deep learning for natural language processing",
                ["smith", "doe"],
                1,
            ),
            (
                "Vancouver_bracket",
                "[1] Smith JA, Doe B. Clinical applications of deep learning. Lancet Digit Health. 2021;3(4):200-210.",
                CitationStyle.VANCOUVER,
                "2021",
                "Clinical applications of deep learning",
                ["smith", "doe"],
                1,
            ),
            (
                "Nature_numbered",
                "1. LeCun, Y., Bengio, Y. & Hinton, G. Deep learning. Nature 521, 436-444 (2015).",
                CitationStyle.NATURE,
                "2015",
                "Deep learning",
                ["lecun", "bengio", "hinton"],
                1,
            ),
            (
                "Nature_bracket",
                "[1] Silver, D. et al. Mastering the game of Go with deep neural networks and tree search. Nature 529, 484-489 (2016).",
                CitationStyle.NATURE,
                "2016",
                "Mastering the game of Go with deep neural networks and tree search",
                ["silver"],
                1,
            ),
            (
                "CSE_nameyear",
                "Smith JA, Doe B. 2020. Deep learning for biology. J Comput Biol. 15(2):123-135.",
                CitationStyle.CSE,
                "2020",
                "Deep learning for biology",
                ["smith", "doe"],
                None,
            ),
            (
                "ACS_numbered",
                "1. Smith, J. A.; Doe, B. Deep Learning in Chemistry. J. Am. Chem. Soc. 2020, 142 (10), 1234-1245.",
                CitationStyle.ACS,
                "2020",
                "Deep Learning in Chemistry",
                ["smith", "doe"],
                1,
            ),
            (
                "ACS_paren_notitle",
                "(1) Smith, J. A.; Doe, B. J. Am. Chem. Soc. 2020, 142, 1234-1245.",
                CitationStyle.ACS,
                "2020",
                "J. Am. Chem. Soc",
                ["smith", "doe"],
                1,
            ),
            (
                "AMA_article",
                "1. Smith JA, Doe B. Deep learning in medicine. JAMA. 2020;323(10):123-135. doi:10.1001/jama.2020.1234",
                CitationStyle.AMA,
                "2020",
                "Deep learning in medicine",
                ["smith", "doe"],
                1,
            ),
            (
                "AMA_book",
                "2. Smith JA. Medical Artificial Intelligence. New York, NY: Oxford University Press; 2020.",
                CitationStyle.AMA,
                "2020",
                "Medical Artificial Intelligence",
                ["smith"],
                2,
            ),
            (
                "Chicago_AD_article",
                'Smith, John A., and Jane Doe. 2020. "Deep Learning for Natural Language Processing." Journal of Artificial Intelligence 15 (2): 123-135.',
                CitationStyle.CHICAGO,
                "2020",
                "Deep Learning for Natural Language Processing",
                ["smith", "doe"],
                None,
            ),
            (
                "Chicago_AD_book",
                "Smith, John A. 2020. Deep Learning in Practice. Chicago: University of Chicago Press.",
                CitationStyle.CHICAGO,
                "2020",
                "Deep Learning in Practice",
                ["smith"],
                None,
            ),
            (
                "Chicago_NB_article",
                'Smith, John A. "Deep Learning for Natural Language Processing." Journal of Artificial Intelligence 15, no. 2 (2020): 123-135.',
                CitationStyle.CHICAGO,
                "2020",
                "Deep Learning for Natural Language Processing",
                ["smith"],
                None,
            ),
            (
                "Chicago_NB_book",
                "Smith, John A. Deep Learning in Practice. Chicago: University of Chicago Press, 2020.",
                CitationStyle.CHICAGO,
                "2020",
                "Deep Learning in Practice",
                ["smith"],
                None,
            ),
            (
                "MLA_article",
                'Smith, John A., and Jane Doe. "Deep Learning for Natural Language Processing." Journal of Artificial Intelligence, vol. 15, no. 2, 2020, pp. 123-135.',
                CitationStyle.MLA,
                "2020",
                "Deep Learning for Natural Language Processing",
                ["smith", "doe"],
                None,
            ),
            (
                "MLA_book",
                "Smith, John A. Deep Learning in Practice. Penguin Books, 2020.",
                CitationStyle.MLA,
                "2020",
                "Deep Learning in Practice",
                ["smith"],
                None,
            ),
            (
                "MLA_chapter",
                'Smith, John A. "Neural Architectures." Handbook of AI, edited by Jane Doe, Oxford UP, 2020, pp. 45-67.',
                CitationStyle.MLA,
                "2020",
                "Neural Architectures",
                ["smith"],
                None,
            ),
        ],
    )
    def test_reference_entry_parsing(
        self,
        parser: ReferenceListParser,
        label: str,
        raw: str,
        expected_style: CitationStyle,
        expected_year: str,
        expected_title_substr: str,
        expected_authors: list[str],
        expected_index: int | None,
    ) -> None:
        cit = parser._parse_entry(raw, order_index=1, page_num=1)
        assert cit is not None, f"{label} returned None"
        assert cit.style == expected_style, f"{label}: {cit.style} != {expected_style}"
        assert cit.year == expected_year, f"{label}: {cit.year} != {expected_year}"
        assert expected_title_substr.lower() in (cit.title or "").lower(), (
            f"{label}: {cit.title!r} missing {expected_title_substr!r}"
        )
        assert [a.last_name for a in cit.authors] == expected_authors, (
            f"{label}: {[a.last_name for a in cit.authors]} != {expected_authors}"
        )
        assert cit.numeric_index == expected_index, (
            f"{label}: numeric_index={cit.numeric_index} != {expected_index}"
        )


class TestAuthorParserAllFormats:
    """Verify parse_authors(raw, format_name=...) supports all 11 format names."""

    @pytest.mark.parametrize(
        ("format_name", "raw", "expected_last_names"),
        [
            ("APA", "Smith, J. A., & Doe, B.", ["smith", "doe"]),
            ("IEEE", "J. A. Smith and B. Doe", ["smith", "doe"]),
            ("ACM", "John A. Smith and Jane B. Doe", ["smith", "doe"]),
            ("HARVARD", "Smith, J.A. and Doe, B.", ["smith", "doe"]),
            ("VANCOUVER", "Smith JA, Doe B", ["smith", "doe"]),
            ("NATURE", "LeCun, Y., Bengio, Y. & Hinton, G.", ["lecun", "bengio", "hinton"]),
            ("CSE", "Smith JA, Doe B", ["smith", "doe"]),
            ("ACS", "Smith, J. A.; Doe, B.", ["smith", "doe"]),
            ("AMA", "Smith JA, Doe B", ["smith", "doe"]),
            ("CHICAGO", "Smith, John A., and Jane Doe", ["smith", "doe"]),
            ("MLA", "Smith, John A., and Jane Doe", ["smith", "doe"]),
        ],
    )
    def test_parse_authors_by_format_name(
        self, format_name: str, raw: str, expected_last_names: list[str]
    ) -> None:
        authors = parse_authors(raw, format_name=format_name)
        assert [a.last_name for a in authors] == expected_last_names


class TestInTextExtractionAndLinkingAllFormats:
    """Verify in-text extraction, false-positive prevention, and linking across all 11 formats."""

    @pytest.fixture
    def extractor(self) -> CitationExtractor:
        return CitationExtractor()

    @pytest.fixture
    def parser(self) -> ReferenceListParser:
        return ReferenceListParser()

    @pytest.fixture
    def linker(self) -> CitationLinker:
        return CitationLinker()

    def test_false_positive_rejection(self, extractor: CitationExtractor) -> None:
        """Math exponents, bare numbers, tables/figures, and dates must NOT be extracted."""
        body = (
            "The model has 10^5 parameters and 2^10 hidden units with x^2 loss. "
            "As shown in (Table 1) and (Figure 2), the dataset has 100,000 samples "
            "collected in (May 2012) and (Spring 2013) under condition (1) and (2)."
        )
        cits = extractor._extract_from_text(body, body, page_num=1)
        assert cits == [], f"Unexpected false-positive citations: {[c.raw_text for c in cits]}"

    @pytest.mark.parametrize(
        ("style_name", "body_text", "bib_lines", "expected_matched"),
        [
            (
                "APA",
                "Prior work (Smith & Doe, 2020) and Goodfellow et al. (2016) showed strong performance.",
                [
                    "Smith, J. A., & Doe, B. (2020). Deep learning for NLP. Journal of AI, 15(2), 123-135.",
                    "Goodfellow, I., Bengio, Y., & Courville, A. (2016). Deep learning. MIT Press.",
                ],
                2,
            ),
            (
                "IEEE",
                "Prior work [1] and [2] showed strong performance.",
                [
                    '[1] J. A. Smith and B. Doe, "Deep learning for NLP," IEEE Trans., vol. 15, no. 2, pp. 123-135, 2020.',
                    '[2] K. He et al., "Deep residual learning," in Proc. CVPR, 2016, pp. 770-778.',
                ],
                2,
            ),
            (
                "ACM",
                "Prior work [1, 2] and [3] showed strong performance.",
                [
                    "[1] John A. Smith and Jane B. Doe. 2020. Deep learning for NLP. Commun. ACM 63, 4 (April 2020), 123-135.",
                    "[2] Smith, J. A. and Doe, B. Neural models. J. ACM, 15, 2 (2020), 123-135.",
                    "[3] Donald E. Knuth. The Art of Computer Programming, 3rd ed. Addison-Wesley, 1997.",
                ],
                3,
            ),
            (
                "Harvard",
                "Prior work (Smith and Doe 2020) and (Smith 2020, p. 45) showed strong performance.",
                [
                    "Smith, J.A. and Doe, B. (2020) 'Deep learning for NLP', Journal of AI, 15(2), pp. 123-135.",
                ],
                2,
            ),
            (
                "Vancouver",
                "Prior work [1] showed strong performance.",
                [
                    "1. Smith JA, Doe B. Deep learning for NLP. J Artif Intell. 2020;15(2):123-135.",
                ],
                1,
            ),
            (
                "Nature",
                "Prior work^1 and follow-up studies^2 showed strong performance.",
                [
                    "1. LeCun, Y., Bengio, Y. & Hinton, G. Deep learning. Nature 521, 436-444 (2015).",
                    "2. Silver, D. et al. Mastering the game of Go. Nature 529, 484-489 (2016).",
                ],
                2,
            ),
            (
                "CSE_NameYear",
                "Prior work (Smith and Doe 2020) showed strong performance.",
                [
                    "Smith JA, Doe B. 2020. Deep learning for biology. J Comput Biol. 15(2):123-135.",
                ],
                1,
            ),
            (
                "ACS",
                "Prior work^1 showed strong performance.",
                [
                    "1. Smith, J. A.; Doe, B. Deep Learning in Chemistry. J. Am. Chem. Soc. 2020, 142 (10), 1234-1245.",
                ],
                1,
            ),
            (
                "AMA",
                "Prior work^1-2 showed strong performance.",
                [
                    "1. Smith JA, Doe B. Deep learning in medicine. JAMA. 2020;323(10):123-135. doi:10.1001/jama.2020.1234",
                    "2. Smith JA. Medical Artificial Intelligence. New York, NY: Oxford University Press; 2020.",
                ],
                2,
            ),
            (
                "Chicago",
                "Prior work (Smith and Doe 2020, 125) showed strong performance.",
                [
                    'Smith, John A., and Jane Doe. 2020. "Deep Learning for NLP." Journal of AI 15 (2): 123-135.',
                ],
                1,
            ),
            (
                "MLA",
                "Prior work (Smith and Doe 125) and Smith (p. 45) showed strong performance.",
                [
                    'Smith, John A., and Jane Doe. "Deep Learning for NLP." Journal of AI, vol. 15, no. 2, 2020, pp. 123-135.',
                ],
                2,
            ),
        ],
    )
    def test_end_to_end_extract_and_link(
        self,
        extractor: CitationExtractor,
        parser: ReferenceListParser,
        linker: CitationLinker,
        style_name: str,
        body_text: str,
        bib_lines: list[str],
        expected_matched: int,
    ) -> None:
        in_texts = extractor._extract_from_text(body_text, body_text, page_num=1)
        bibs = [
            parser._parse_entry(line, order_index=i + 1, page_num=2)
            for i, line in enumerate(bib_lines)
        ]
        assert all(b is not None for b in bibs), f"{style_name}: failed to parse bib"
        res = linker.link(in_texts, bibs)  # type: ignore[arg-type]
        matched = [l for l in res.links if l.status == CitationMappingStatus.MATCHED]
        assert len(matched) == expected_matched, (
            f"{style_name}: expected {expected_matched} matched links, got {len(matched)} ({res.links})"
        )
        assert res.unmatched_reference_ids == [], (
            f"{style_name}: unexpected uncited references {res.unmatched_reference_ids}"
        )


class TestStyleDetectorAllFormats:
    """Verify StyleDetector classifies author-year and numeric styles across all 11 formats."""

    @pytest.mark.parametrize(
        ("style", "expected_label"),
        [
            (CitationStyle.APA, "APA-like"),
            (CitationStyle.HARVARD, "APA-like"),
            (CitationStyle.CHICAGO, "APA-like"),
            (CitationStyle.MLA, "APA-like"),
            (CitationStyle.IEEE, "IEEE-like"),
            (CitationStyle.ACM, "IEEE-like"),
            (CitationStyle.VANCOUVER, "IEEE-like"),
            (CitationStyle.NATURE, "IEEE-like"),
            (CitationStyle.ACS, "IEEE-like"),
            (CitationStyle.AMA, "IEEE-like"),
        ],
    )
    def test_bib_style_detection(self, style: CitationStyle, expected_label: str) -> None:
        from integrity_checker.models.citation import Citation

        bibs = [
            Citation(raw_text=f"entry {i}", citation_type=CitationType.REFERENCE_LIST, style=style)
            for i in range(6)
        ]
        profile = StyleDetector().detect([], bibs)
        assert profile.label == expected_label
