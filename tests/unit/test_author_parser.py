"""Unit tests cho matching/author_parser.py (v1.2 §3.4, §3.7)."""

from __future__ import annotations

from integrity_checker.matching.author_parser import (
    jaccard_similarity,
    normalize_author,
    parse_authors,
)


class TestNormalizeAuthor:
    """Đơn lẻ 1 author."""

    def test_empty(self):
        a = normalize_author("")
        assert a.last_name == ""
        assert a.initials == []

    def test_apa_parenthetical_single(self):
        a = normalize_author("Smith, J.")
        assert a.last_name == "smith"
        assert a.initials == ["j"]
        assert a.normalized == "smith|j"

    def test_apa_two_initials(self):
        a = normalize_author("Smith, J. K.")
        assert a.last_name == "smith"
        assert a.initials == ["j", "k"]
        assert a.normalized == "smith|j.k"

    def test_reverse_initials(self):
        a = normalize_author("J. K. Smith")
        assert a.last_name == "smith"
        assert a.initials == ["j", "k"]

    def test_dutch_multi_word(self):
        a = normalize_author("van der Berg, J.")
        assert a.last_name == "van der berg"
        assert a.initials == ["j"]

    def test_apostrophe_name(self):
        a = normalize_author("O'Brien, M.")
        assert a.last_name == "o'brien"
        assert a.initials == ["m"]

    def test_full_first_name(self):
        a = normalize_author("Smith, John K.")
        assert a.last_name == "smith"
        assert a.initials == ["j", "k"]

    def test_no_comma_last_then_initial(self):
        a = normalize_author("Smith J.")
        assert a.last_name == "smith"
        assert a.initials == ["j"]

    def test_no_comma_last_then_multi_initial(self):
        a = normalize_author("Smith J. K.")
        assert a.last_name == "smith"
        assert a.initials == ["j", "k"]

    def test_vietnamese_full(self):
        a = normalize_author("Nguyễn Văn A")
        assert a.last_name == "nguyễn"
        assert "a" in a.initials

    def test_vietnamese_with_comma(self):
        a = normalize_author("Trần, Gia Thành")
        assert a.last_name == "trần"
        assert a.initials == ["g"]

    def test_lone_last_name(self):
        a = normalize_author("Doe")
        assert a.last_name == "doe"
        assert a.initials == []

    def test_junior_suffix(self):
        a = normalize_author("Smith J. K. Jr.")
        assert a.last_name == "smith"
        # 'Jr.' không được coi là initial (suffix)
        assert "j" in a.initials
        assert a.initials.count("j") >= 1


class TestParseAuthors:
    """Multi-author strings."""

    def test_apa_with_amp(self):
        authors = parse_authors("Smith, J., & Jones, A.")
        assert len(authors) == 2
        assert authors[0].last_name == "smith"
        assert authors[1].last_name == "jones"

    def test_apa_with_and(self):
        authors = parse_authors("Smith, J. and Jones, A.")
        assert len(authors) == 2
        assert authors[0].last_name == "smith"
        assert authors[1].last_name == "jones"

    def test_apa_semicolon(self):
        authors = parse_authors("Smith, J.; Jones, A.")
        assert len(authors) == 2

    def test_three_authors_apa(self):
        authors = parse_authors("LeCun, Y., Bengio, Y., & Hinton, G.")
        assert len(authors) == 3
        last_names = [a.last_name for a in authors]
        assert "lecun" in last_names
        assert "bengio" in last_names
        assert "hinton" in last_names

    def test_dutch_multi_author(self):
        authors = parse_authors("van der Berg, J., & Smith, J.")
        assert len(authors) == 2
        assert authors[0].last_name == "van der berg"
        assert authors[1].last_name == "smith"

    def test_vietnamese_multi(self):
        authors = parse_authors("Nguyễn, V., Trần, T., & Lê, L.")
        assert len(authors) == 3
        assert authors[0].last_name == "nguyễn"
        assert authors[1].last_name == "trần"
        assert authors[2].last_name == "lê"

    def test_empty(self):
        assert parse_authors("") == []

    def test_single_author(self):
        authors = parse_authors("Smith, J.")
        assert len(authors) == 1
        assert authors[0].last_name == "smith"

    def test_vancouver_initials_pattern(self):
        authors = parse_authors("Smith JK, van der Berg AB", format_name="Vancouver")
        assert len(authors) == 2
        assert authors[0].last_name == "smith"
        assert authors[0].initials == ["J", "K"]
        assert authors[1].last_name == "van der berg"
        assert authors[1].initials == ["A", "B"]


class TestJaccardSimilarity:
    def test_identical(self):
        assert jaccard_similarity(["Smith", "Jones"], ["Smith", "Jones"]) == 1.0

    def test_partial_overlap(self):
        sim = jaccard_similarity(["Smith", "Jones"], ["Smith", "Doe"])
        assert 0.3 < sim < 0.4

    def test_disjoint(self):
        assert jaccard_similarity(["Smith"], ["Jones"]) == 0.0

    def test_both_empty(self):
        assert jaccard_similarity([], []) == 1.0

    def test_case_insensitive(self):
        assert jaccard_similarity(["SMITH"], ["smith"]) == 1.0

    def test_van_der_berg(self):
        # Multi-word match phải exact dưới Jaccard
        assert jaccard_similarity(["van der Berg"], ["van der Berg"]) == 1.0
        # So sánh với "Berg" (mất particle) → 0.0
        assert jaccard_similarity(["van der Berg"], ["Berg"]) == 0.0
