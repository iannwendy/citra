"""Tests cho author_matcher (task #29 — Sprint 1)."""

from __future__ import annotations

import pytest

from integrity_checker.matching.author_matcher import (
    AuthorMatchResult,
    _canonicalize_last_name,
    author_match_details,
    author_match_score,
)
from integrity_checker.matching.author_parser import Author


class TestCanonicalizeLastName:
    """Canonicalization tests — KNOWN_ISSUES §1.1 cases."""

    def test_lowercase(self) -> None:
        assert _canonicalize_last_name("SMITH") == "smith"

    def test_strip_punctuation(self) -> None:
        # Apostrophe preserved within words (O'Brien, D'Angelo)
        assert _canonicalize_last_name("O'Brien") == "o'brien"
        assert _canonicalize_last_name("D'Angelo") == "d'angelo"
        # Other punctuation stripped
        assert _canonicalize_last_name("Smith.") == "smith"
        assert _canonicalize_last_name("Smith;") == "smith"

    def test_fold_diacritics(self) -> None:
        assert _canonicalize_last_name("Nguyễn") == "nguyen"
        assert _canonicalize_last_name("Müller") == "muller"
        assert _canonicalize_last_name("García") == "garcia"

    def test_van_der_compound(self) -> None:
        # §1.1 — "van der Berg, J." → last-name = "van der Berg"
        # canonical version: strip leading particles → "berg"
        assert _canonicalize_last_name("van der Berg") == "berg"
        assert _canonicalize_last_name("von Neumann") == "neumann"

    def test_empty(self) -> None:
        assert _canonicalize_last_name("") == ""
        assert _canonicalize_last_name(None) == ""  # type: ignore[arg-type]

    def test_whitespace(self) -> None:
        assert _canonicalize_last_name("  Smith  ") == "smith"

    def test_particles_only(self) -> None:
        # Edge case: all particles → empty
        assert _canonicalize_last_name("van der") == ""

    def test_two_letter_surnames_preserved(self) -> None:
        assert _canonicalize_last_name("Ziwei Ji") == "ji"
        assert _canonicalize_last_name("Tiezheng Yu") == "yu"
        assert _canonicalize_last_name("Dan Su") == "su"
        assert _canonicalize_last_name("Yan Xu") == "xu"
        assert _canonicalize_last_name("Kyle Lo") == "lo"
        assert _canonicalize_last_name("Smith JK") == "smith"
        assert _canonicalize_last_name("Smith J.K.") == "smith"

    def test_vietnamese_surnames_le_phan_dang_preserved(self) -> None:
        assert _canonicalize_last_name("Lê, L.") == "le"
        assert _canonicalize_last_name("Phan, T.") == "phan"
        assert _canonicalize_last_name("Đặng, H.") == "dang"
        assert author_match_score(["Lê, L.", "Phan, T.", "Đặng, H."], ["Le, L.", "Phan, T.", "Dang, H."]) == 1.0

    def test_hyphenated_surname_comma_and_no_comma_consistent(self) -> None:
        assert _canonicalize_last_name("Pouget-Abadie, J.") == "abadie"
        assert _canonicalize_last_name("Jean Pouget-Abadie") == "abadie"
        assert author_match_score(["Pouget-Abadie, J."], ["Jean Pouget-Abadie"]) == 1.0



class TestAuthorMatchScore:
    """Score calculation tests."""

    def test_perfect_match_apa(self) -> None:
        cited = ["Smith, J.", "Doe, A."]
        candidate = ["John Smith", "Alice Doe"]
        assert author_match_score(cited, candidate) == 1.0

    def test_perfect_match_ieee(self) -> None:
        cited = ["Smith J. K."]
        candidate = ["J. K. Smith"]
        # "smith" = "smith" → 1.0
        assert author_match_score(cited, candidate) == 1.0

    def test_vietnamese_diacritics(self) -> None:
        # "Nguyễn Bảo Minh" vs "Minh, Nguyen Bao"
        cited = ["Nguyễn Bảo Minh"]
        candidate = ["Minh, Nguyen Bao"]
        # Canonical: "minh" vs "bao" → no match?
        # Actually cited → tokens [minh], candidate → "bao" (strip "minh" particle)
        # Let me trace: cited = "nguyen bao minh" → particles stripped → "bao minh"
        #              candidate = "minh nguyen bao" → particles stripped → "nguyen bao"
        # Sets: {"bao", "minh"} vs {"nguyen", "bao"} → intersect {"bao"} → 1/3
        score = author_match_score(cited, candidate)
        assert 0.0 < score <= 1.0
        assert score >= 0.3  # At least partial overlap

    def test_no_overlap(self) -> None:
        cited = ["Smith"]
        candidate = ["Johnson"]
        assert author_match_score(cited, candidate) == 0.0

    def test_partial_overlap(self) -> None:
        cited = ["Smith", "Johnson", "Lee"]
        candidate = ["Smith", "Lee"]
        # intersect {"smith", "lee"} = 2; union {"smith", "johnson", "lee"} = 3
        # 2/3 ≈ 0.67
        assert author_match_score(cited, candidate) == pytest.approx(0.667, abs=0.01)

    def test_empty_cited(self) -> None:
        assert author_match_score([], ["Smith"]) == 0.0

    def test_empty_candidate(self) -> None:
        assert author_match_score(["Smith"], []) == 0.0

    def test_author_object_input(self) -> None:
        cited = [Author(last_name="Smith")]
        candidate = ["Smith, J."]
        assert author_match_score(cited, candidate) == 1.0

    def test_van_der_berg_vs_smith(self) -> None:
        cited = ["van der Berg"]
        candidate = ["Smith"]
        # "berg" vs "smith" → no match
        assert author_match_score(cited, candidate) == 0.0

    def test_two_letter_surnames_ji_et_al(self) -> None:
        cited = [
            "Ji, Z.", "Lee, N.", "Frieske, R.", "Yu, T.",
            "Su, D.", "Xu, Y.", "Fung, P.",
        ]
        candidate = [
            "Ziwei Ji", "Nayeon Lee", "Rita Frieske", "Tiezheng Yu",
            "Dan Su", "Yan Xu", "Pascale Fung",
        ]
        assert author_match_score(cited, candidate) == 1.0



class TestAuthorMatchDetails:
    """Detail-returning variant."""

    def test_returns_result_dataclass(self) -> None:
        cited = ["Smith", "Lee"]
        candidate = ["Smith", "Johnson"]
        result = author_match_details(cited, candidate)
        assert isinstance(result, AuthorMatchResult)
        assert "smith" in result.matched
        assert "lee" in result.only_cited
        assert "johnson" in result.only_candidate
        assert result.score == pytest.approx(1.0 / 3.0, abs=0.01)

    def test_summary(self) -> None:
        result = author_match_details(["Smith"], ["Smith"])
        s = result.summary()
        assert "score=1.00" in s
        assert "matched=['smith']" in s

    def test_zero_score(self) -> None:
        result = author_match_details(["Smith"], [])
        assert result.score == 0.0
        assert result.matched == []
