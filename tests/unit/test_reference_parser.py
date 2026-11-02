"""Unit tests cho extraction/reference_parser.py v1.2 — APA / IEEE / Vancouver."""

from __future__ import annotations

import pytest

from integrity_checker.extraction.base import Document, Page
from integrity_checker.extraction.reference_parser import (
    ReferenceListParser,
    _normalize_title,
)
from integrity_checker.extraction.text_preprocessor import TextPreprocessor
from integrity_checker.models.citation import CitationStyle, CitationType


def _doc_with_section(text: str) -> Document:
    pp = TextPreprocessor()
    return Document(
        file_path="x.pdf",
        num_pages=1,
        parser_used="test",
        pages=[Page(page_num=1, text=pp.normalize(f"References\n{text}"))],
    )


class TestNormalizeTitle:
    def test_lowercase(self):
        assert _normalize_title("Hello World") == "hello world"

    def test_strip_punctuation(self):
        assert _normalize_title("A study: of X!") == "a study of x"

    def test_collapse_spaces(self):
        assert _normalize_title("A   study   of   X") == "a study of x"

    def test_empty(self):
        assert _normalize_title("") == ""


class TestParseAPALike:
    def test_basic_apa(self):
        doc = _doc_with_section(
            "Smith, J. (2020). A study of X. Journal A, 10(2), 1-10. "
            "DOI: 10.1234/abc.001"
        )
        cits = ReferenceListParser().parse_reference_section(doc)
        assert len(cits) == 1
        c = cits[0]
        assert c.style == CitationStyle.APA
        assert c.year == "2020"
        assert c.year_suffix is None
        assert c.title == "A study of X"
        assert c.title_normalized == "a study of x"
        assert c.doi == "10.1234/abc.001"
        assert [a.last_name for a in c.authors] == ["smith"]
        assert c.order_index == 1

    def test_apa_three_authors(self):
        doc = _doc_with_section(
            "LeCun, Y., Bengio, Y., & Hinton, G. (2015). Deep learning. "
            "Nature, 521, 436-444. DOI: 10.1038/nature14539"
        )
        cits = ReferenceListParser().parse_reference_section(doc)
        c = cits[0]
        assert [a.last_name for a in c.authors] == ["lecun", "bengio", "hinton"]
        assert c.year == "2015"

    def test_apa_year_with_suffix(self):
        doc = _doc_with_section(
            "Smith, J. (2024a). Recent advances. Journal A, 1, 1-5."
        )
        cits = ReferenceListParser().parse_reference_section(doc)
        c = cits[0]
        assert c.year == "2024"
        assert c.year_suffix == "a"

    def test_apa_dutch_multi_word(self):
        doc = _doc_with_section(
            "van der Berg, J. (2020). A study. Journal A, 1, 1-10."
        )
        cits = ReferenceListParser().parse_reference_section(doc)
        c = cits[0]
        assert [a.last_name for a in c.authors] == ["van der berg"]

    # -- Edge cases: Dutch / particle multi-word last names --

    def test_apa_dutch_van_der(self):
        """Van der Berg — most common Dutch compound last name."""
        doc = _doc_with_section(
            "van der Berg, J. (2020). A study of X. Journal A, 10, 1-10."
        )
        cits = ReferenceListParser().parse_reference_section(doc)
        assert len(cits) == 1
        assert cits[0].title == "A study of X"

    def test_apa_dutch_de_la(self):
        """Spanish/French particle: de la Cruz."""
        doc = _doc_with_section(
            "de la Cruz, M. (2019). Latin American poetry. Journal B, 5, 20-30."
        )
        cits = ReferenceListParser().parse_reference_section(doc)
        assert len(cits) == 1
        # last_name chứa "de la cruz"
        assert "de la cruz" in cits[0].authors[0].last_name

    def test_apa_german_von(self):
        """German particle: von Neumann."""
        doc = _doc_with_section(
            "von Neumann, J. (1958). The computer and the brain. Yale UP."
        )
        cits = ReferenceListParser().parse_reference_section(doc)
        assert len(cits) == 1
        assert "von neumann" in cits[0].authors[0].last_name

    def test_apa_2_entries_dutch_mixed(self):
        """Reference list có entry Dutch + entry thường → tách đúng cả 2."""
        doc = _doc_with_section(
            "van der Berg, J. (2020). Dutch study. Journal A, 1, 1-10.\n"
            "Smith, K. (2021). Regular study. Journal B, 2, 20-30."
        )
        cits = ReferenceListParser().parse_reference_section(doc)
        assert len(cits) == 2
        assert "van der berg" in cits[0].authors[0].last_name
        assert cits[0].title == "Dutch study"
        assert cits[1].title == "Regular study"

    def test_apa_with_month_name(self):
        """Regression: APA entries with a month after the year used to fail."""
        doc = _doc_with_section(
            "Likhil, G. (2025, August). Fitness app market size. "
            "Polaris Market Research. https://www.polarismarketresearch.com/x"
        )
        cits = ReferenceListParser().parse_reference_section(doc)
        assert len(cits) == 1
        assert cits[0].year == "2025"
        assert cits[0].year_suffix is None
        assert [a.last_name for a in cits[0].authors] == ["likhil"]

    def test_apa_with_month_and_day(self):
        """Regression: '(2022, March 28)' must still parse the year 2022."""
        doc = _doc_with_section(
            "Adigozel, O., & Wilson, K. (2022, March 28). Delivering on the "
            "promise. BCG Global. https://www.bcg.com/x"
        )
        cits = ReferenceListParser().parse_reference_section(doc)
        assert len(cits) == 1
        assert cits[0].year == "2022"
        assert [a.last_name for a in cits[0].authors] == ["adigozel", "wilson"]


class TestSplitWebReferences:
    """Regression: web APA entries end with a URL, not a doi.org link."""

    def test_url_boundary_splits_entries(self):
        doc = _doc_with_section(
            "Likhil, G. (2025, August). Fitness market. Polaris. "
            "https://www.polarismarketresearch.com/x "
            "Looyestyn, J., & Maher, C. (2017). Does gamification work? "
            "PLOS ONE. https://doi.org/10.1371/journal.pone.0173403"
        )
        cits = ReferenceListParser().parse_reference_section(doc)
        assert len(cits) == 2
        assert cits[0].year == "2025"
        assert cits[1].year == "2017"

    def test_running_headers_and_page_numbers_are_dropped(self):
        doc = _doc_with_section(
            "AI WELLNESS PLATFORM\n43\n"
            "Likhil, G. (2025, August). Fitness market. Polaris. "
            "https://www.polarismarketresearch.com/x\n"
            "AI WELLNESS PLATFORM\n44\n"
            "Wang, R., & Gillinov, M. (2017). Accuracy of monitors. "
            "JAMA Cardiology. https://doi.org/10.1001/jamacardio.2016.3340"
        )
        cits = ReferenceListParser().parse_reference_section(doc)
        assert len(cits) == 2
        assert [a.last_name for a in cits[0].authors] == ["likhil"]
        assert cits[0].year == "2025"
        assert [a.last_name for a in cits[1].authors] == ["wang", "gillinov"]


class TestParseIEEELike:
    def test_basic_ieee(self):
        doc = _doc_with_section(
            '[1] Smith, J., "A study of X," Journal A, vol. 10, no. 2, '
            'pp. 1-10, 2020.'
        )
        cits = ReferenceListParser().parse_reference_section(doc)
        assert len(cits) == 1
        c = cits[0]
        assert c.style == CitationStyle.IEEE
        assert c.numeric_index == 1
        assert c.year == "2020"
        assert c.title == "A study of X"
        assert [a.last_name for a in c.authors] == ["smith"]

    def test_ieee_three_authors(self):
        doc = _doc_with_section(
            '[2] LeCun, Y., Bengio, Y., & Hinton, G., "Deep learning," '
            'Nature, vol. 521, pp. 436-444, 2015.'
        )
        cits = ReferenceListParser().parse_reference_section(doc)
        c = cits[0]
        assert c.numeric_index == 2
        assert [a.last_name for a in c.authors] == ["lecun", "bengio", "hinton"]
        assert c.title == "Deep learning"


class TestParseVancouver:
    def test_basic_vancouver(self):
        doc = _doc_with_section("Smith J. A study of X. Journal A. 2020;10(2):1-10.")
        cits = ReferenceListParser().parse_reference_section(doc)
        c = cits[0]
        assert c.style == CitationStyle.VANCOUVER
        assert c.year == "2020"
        assert [a.last_name for a in c.authors] == ["smith"]


class TestCitationTypeAndMetadata:
    @pytest.mark.parametrize("text,style", [
        ("Smith, J. (2020). Title. Journal A, 1, 1-10.", CitationStyle.APA),
        ('[1] Smith, J., "Title," Journal A, vol. 1, 2020.', CitationStyle.IEEE),
        ("Smith J. Title. Journal A. 2020;1:1-10.", CitationStyle.VANCOUVER),
    ])
    def test_all_returned_reference_list(self, text, style):
        doc = _doc_with_section(text)
        cits = ReferenceListParser().parse_reference_section(doc)
        assert cits[0].citation_type == CitationType.REFERENCE_LIST
        assert cits[0].style == style

    def test_no_section_no_citations(self):
        # Document không có "References" header → trả []
        doc = Document(
            file_path="x.pdf",
            num_pages=1,
            parser_used="t",
            pages=[Page(page_num=1, text="Body without refs section.")],
        )
        assert ReferenceListParser().parse_reference_section(doc) == []


class TestMultipleEntriesSplit:
    def test_ieee_separates_on_open_bracket(self):
        doc = _doc_with_section(
            '[1] Smith, J., "Title A," Journal A, vol. 1, 2020.\n'
            '[2] Doe, A., "Title B," Journal B, vol. 2, 2021.'
        )
        cits = ReferenceListParser().parse_reference_section(doc)
        assert len(cits) == 2
        assert cits[0].numeric_index == 1
        assert cits[1].numeric_index == 2

    def test_apa_separates_lines(self):
        doc = _doc_with_section(
            "Smith, J. (2020). Title A. Journal A, 1, 1-10.\n"
            "Doe, A. (2021). Title B. Journal B, 2, 20-30."
        )
        cits = ReferenceListParser().parse_reference_section(doc)
        assert len(cits) == 2
        assert cits[0].title == "Title A"
        assert cits[1].title == "Title B"
        assert cits[0].order_index == 1
        assert cits[1].order_index == 2


class TestUnquotedBookEntry:
    """Regression: unquoted book entries must not be eaten by ``nature_book``.

    A full-title book entry with one author and no quoted title used to match
    ``nature_book`` (title="B", year lost) and split the author list into
    ``["Settles", "Learning", "Active"]``.
    """

    ENTRY = (
        "Settles, B, Learning, Active (2012) Synthesis Lectures on "
        "Artificial Intelligence and Machine Learning"
    )

    def test_parses_full_title_and_year(self):
        c = ReferenceListParser()._parse_entry(self.ENTRY, order_index=1, page_num=1)
        assert c is not None
        assert c.title == "Active Learning"
        assert c.year == "2012"

    def test_single_author_keeps_initials(self):
        c = ReferenceListParser()._parse_entry(self.ENTRY, order_index=1, page_num=1)
        assert c is not None
        assert [a.last_name for a in c.authors] == ["settles"]
        assert c.authors[0].initials and c.authors[0].initials[0].upper().startswith("B")

    def test_ieee_unquoted_book_still_works(self):
        c = ReferenceListParser()._parse_entry(
            "[10] B. Settles, Active Learning. Synthesis Lectures on Artificial "
            "Intelligence and Machine Learning, vol. 6, no. 1, pp. 1-114, 2012.",
            order_index=1,
            page_num=1,
        )
        assert c is not None
        assert c.title == "Active Learning"
        assert c.year == "2012"

    def test_springer_lncs_with_trailing_accessed_date_preserves_publication_year(self):
        entry = (
            "25. Platt, J.C.: Probabilistic outputs for support vector machines and "
            "comparisons to regularized likelihood methods. In: Smola, A.J., Bartlett, P., "
            "Schölkopf, B., Schuurmans, D. (eds.) Advances in Large Margin Classifiers, "
            "pp. 61–74. MIT Press, Cambridge, MA (1999). "
            "https://mitpress.mit.edu/9780262194488/advances-in-large-margin-classifiers/ "
            "(Accessed: Oct. 31, 2026)"
        )
        c = ReferenceListParser()._parse_entry(entry, order_index=25, page_num=19)
        assert c is not None
        assert c.year == "1999"
        assert c.numeric_index == 25
        assert c.title == (
            "Probabilistic outputs for support vector machines and "
            "comparisons to regularized likelihood methods"
        )
        assert c.url == "https://mitpress.mit.edu/9780262194488/advances-in-large-margin-classifiers/"
        assert "1999" not in (c.venue or "")
        assert "https://" not in (c.venue or "")
