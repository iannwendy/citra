"""Comprehensive unit tests for Phase 7A: Gnarly, Ambiguous & Hard Academic Edge Cases.

Covers 5 Case Groups (35 tests):
- Case Group A: Ambiguous Same-Author Same-Year, Secondary Citations & Complex IEEE Clusters (`CitationLinker`)
- Case Group B: False-Positive In-Text Citation Noise Filtering (`CitationExtractor`)
- Case Group C: Tricky Author Names, Compound Surnames, Vietnamese Diacritics & Corporate Authors (`AuthorParser`, `AuthorMatcher`, `VenueNormalizer`)
- Case Group D: Neuro-Symbolic Borderline, Preprint-to-Published, Spliced/Chimeric DOI, Retracted & Wayback Cases (`SymbolicRules`, `NeuroSymbolicChecker`)
- Case Group E: Vietnamese Legal Statute Edge Cases (`VNLegalVerifier`, `NeuroSymbolicChecker`)
"""

from __future__ import annotations

from integrity_checker.extraction.base import Document, Page
from integrity_checker.extraction.citation_extractor import CitationExtractor
from integrity_checker.linking.citation_linker import CitationLinker
from integrity_checker.linking.statuses import CitationMappingStatus
from integrity_checker.logic.neuro_symbolic_checker import NeuroSymbolicChecker
from integrity_checker.logic.rules import SymbolicRules
from integrity_checker.logic.vn_legal_verifier import verify_vn_legal_citation
from integrity_checker.matching.author_matcher import author_match_score
from integrity_checker.matching.author_parser import normalize_author, parse_authors
from integrity_checker.matching.venue_normalizer import VenueNormalizer
from integrity_checker.models.citation import Citation, CitationStyle, CitationType
from integrity_checker.models.source import SourceCandidate, SourceResult
from integrity_checker.models.validation import (
    MappingMethod,
    MatchFeatures,
    ValidationLabel,
)


def _extract_text(extractor: CitationExtractor, text: str) -> list[Citation]:
    doc = Document(
        file_path="<test>",
        num_pages=1,
        pages=[Page(page_num=1, text=text, has_text_layer=True)],
        parser_used="test",
    )
    return extractor.extract_from_document(doc)

# =============================================================================
# Case Group A — Ambiguous Same-Author Same-Year & Multi-Citation Clusters
# =============================================================================


class TestCaseGroupAAmbiguousAndMultiCitationLinking:
    """Test CitationLinker on same-author same-year suffixes, 2nd-author disambiguation, secondary citations, and complex IEEE clusters."""

    def test_disambiguate_same_author_year_suffix_explicit(self) -> None:
        """Disambiguate (Nguyen et al., 2023a) vs (Nguyen et al., 2023b) when bib has 2023a / 2023b."""
        linker = CitationLinker()
        in_text = [
            Citation(
                raw_text="(Nguyen et al., 2023a)",
                citation_type=CitationType.IN_TEXT,
                style=CitationStyle.APA,
            ),
            Citation(
                raw_text="(Nguyen et al., 2023b)",
                citation_type=CitationType.IN_TEXT,
                style=CitationStyle.APA,
            ),
        ]
        bibs = [
            Citation(
                raw_text="Nguyen, V. A., Tran, B., & Le, C. (2023a). Deep learning for Vietnamese NLP. Journal of AI.",
                citation_type=CitationType.REFERENCE_LIST,
                style=CitationStyle.APA,
                authors=["Nguyen, V. A.", "Tran, B.", "Le, C."],
                year="2023a",
                title="Deep learning for Vietnamese NLP",
                reference_id="ref-2023a",
            ),
            Citation(
                raw_text="Nguyen, V. A., Pham, D., & Hoang, E. (2023b). Transformer models for citation verification. IEEE Access.",
                citation_type=CitationType.REFERENCE_LIST,
                style=CitationStyle.APA,
                authors=["Nguyen, V. A.", "Pham, D.", "Hoang, E."],
                year="2023",
                year_suffix="b",
                title="Transformer models for citation verification",
                reference_id="ref-2023b",
            ),
        ]
        result = linker.link(in_text, bibs)
        matched = [lnk for lnk in result.links if lnk.status == CitationMappingStatus.MATCHED]
        assert len(matched) == 2
        assert matched[0].reference_id == "ref-2023a"
        assert matched[1].reference_id == "ref-2023b"
        assert not any(lnk.status == CitationMappingStatus.MISSING_REFERENCE for lnk in result.links)
        assert len(result.unmatched_reference_ids) == 0

    def test_disambiguate_same_author_year_suffix_from_raw_text_or_ordinal(self) -> None:
        """Disambiguate (Nguyen et al., 2023a) vs (Nguyen et al., 2023b) when bib entries have no year_suffix field set."""
        linker = CitationLinker()
        in_text = [
            Citation(
                raw_text="(Nguyen et al., 2023a)",
                citation_type=CitationType.IN_TEXT,
                style=CitationStyle.APA,
            ),
            Citation(
                raw_text="(Nguyen et al., 2023b)",
                citation_type=CitationType.IN_TEXT,
                style=CitationStyle.APA,
            ),
        ]
        bibs = [
            Citation(
                raw_text="Nguyen, V. A., & Tran, B. (2023). First study on neural retrieval.",
                citation_type=CitationType.REFERENCE_LIST,
                style=CitationStyle.APA,
                authors=["Nguyen, V. A.", "Tran, B."],
                year="2023",
                title="First study on neural retrieval",
                reference_id="ref-first",
            ),
            Citation(
                raw_text="Nguyen, V. A., & Le, C. (2023). Second study on symbolic rules.",
                citation_type=CitationType.REFERENCE_LIST,
                style=CitationStyle.APA,
                authors=["Nguyen, V. A.", "Le, C."],
                year="2023",
                title="Second study on symbolic rules",
                reference_id="ref-second",
            ),
        ]
        result = linker.link(in_text, bibs)
        matched = [lnk for lnk in result.links if lnk.status == CitationMappingStatus.MATCHED]
        assert len(matched) == 2
        assert matched[0].reference_id == "ref-first"
        assert matched[1].reference_id == "ref-second"
        assert len(result.unmatched_reference_ids) == 0

    def test_disambiguate_same_author_year_by_second_and_third_coauthors(self) -> None:
        """Disambiguate two (Nguyen, 2023) papers when in-text specifies a co-author: (Nguyen, Pham, et al., 2023) vs (Nguyen, Le, et al., 2023)."""
        linker = CitationLinker()
        in_text = [
            Citation(
                raw_text="(Nguyen, Pham, et al., 2023)",
                citation_type=CitationType.IN_TEXT,
                style=CitationStyle.APA,
            ),
            Citation(
                raw_text="(Nguyen, Le, et al., 2023)",
                citation_type=CitationType.IN_TEXT,
                style=CitationStyle.APA,
            ),
        ]
        bibs = [
            Citation(
                raw_text="Nguyen, A., Tran, B., & Le, C. (2023). Graph neural networks for academic graphs.",
                citation_type=CitationType.REFERENCE_LIST,
                style=CitationStyle.APA,
                authors=["Nguyen, A.", "Tran, B.", "Le, C."],
                year="2023",
                title="Graph neural networks for academic graphs",
                reference_id="ref-tran-le",
            ),
            Citation(
                raw_text="Nguyen, A., Pham, D., & Hoang, E. (2023). Pretrained language models for legal text.",
                citation_type=CitationType.REFERENCE_LIST,
                style=CitationStyle.APA,
                authors=["Nguyen, A.", "Pham, D.", "Hoang, E."],
                year="2023",
                title="Pretrained language models for legal text",
                reference_id="ref-pham-hoang",
            ),
        ]
        result = linker.link(in_text, bibs)
        matched = [lnk for lnk in result.links if lnk.status == CitationMappingStatus.MATCHED]
        assert len(matched) == 2
        assert matched[0].reference_id == "ref-pham-hoang"
        assert matched[1].reference_id == "ref-tran-le"
        assert not any(lnk.status == CitationMappingStatus.MISSING_REFERENCE for lnk in result.links)
        assert len(result.unmatched_reference_ids) == 0

    def test_disambiguate_semicolon_multi_citation_cluster_with_coauthors_and_suffixes(self) -> None:
        """Semicolon multi-citation cluster disambiguates both co-author and year-suffix entries."""
        linker = CitationLinker()
        in_text = [
            Citation(
                raw_text="(Nguyen, Tran, & Le, 2023; Nguyen, Pham, & Hoang, 2023)",
                citation_type=CitationType.IN_TEXT,
                style=CitationStyle.APA,
            ),
        ]
        bibs = [
            Citation(
                raw_text="Nguyen, A., Tran, B., & Le, C. (2023). Paper Alpha.",
                citation_type=CitationType.REFERENCE_LIST,
                style=CitationStyle.APA,
                authors=["Nguyen, A.", "Tran, B.", "Le, C."],
                year="2023",
                title="Paper Alpha",
                reference_id="ref-alpha",
            ),
            Citation(
                raw_text="Nguyen, A., Pham, D., & Hoang, E. (2023). Paper Beta.",
                citation_type=CitationType.REFERENCE_LIST,
                style=CitationStyle.APA,
                authors=["Nguyen, A.", "Pham, D.", "Hoang, E."],
                year="2023",
                title="Paper Beta",
                reference_id="ref-beta",
            ),
        ]
        result = linker.link(in_text, bibs)
        matched_ids = [lnk.reference_id for lnk in result.links if lnk.status == CitationMappingStatus.MATCHED]
        assert matched_ids == ["ref-alpha", "ref-beta"]
        assert len(result.unmatched_reference_ids) == 0

    def test_secondary_citation_as_cited_in_english(self) -> None:
        """(Miller, 1995, as cited in Tran, 2021) links to Tran (2021) when Miller (1995) is not in bibliography."""
        linker = CitationLinker()
        in_text = [
            Citation(
                raw_text="(Miller, 1995, as cited in Tran, 2021)",
                citation_type=CitationType.IN_TEXT,
                style=CitationStyle.APA,
            ),
        ]
        bibs = [
            Citation(
                raw_text="Tran, M. H. (2021). Cognitive psychology in modern education. Vietnam Education Publishing.",
                citation_type=CitationType.REFERENCE_LIST,
                style=CitationStyle.APA,
                authors=["Tran, M. H."],
                year="2021",
                title="Cognitive psychology in modern education",
                reference_id="ref-tran-2021",
            ),
        ]
        result = linker.link(in_text, bibs)
        assert not any(lnk.status == CitationMappingStatus.MISSING_REFERENCE for lnk in result.links)
        assert result.links[0].reference_id == "ref-tran-2021"
        assert result.links[0].status == CitationMappingStatus.MATCHED

    def test_secondary_citation_dan_theo_vietnamese(self) -> None:
        """(Miller, 1995, dẫn theo Trần, 2021) links to Trần (2021) in bibliography without false MISSING_REFERENCE."""
        linker = CitationLinker()
        in_text = [
            Citation(
                raw_text="(Miller, 1995, dẫn theo Trần, 2021)",
                citation_type=CitationType.IN_TEXT,
                style=CitationStyle.APA,
            ),
        ]
        bibs = [
            Citation(
                raw_text="Trần, M. H. (2021). Tâm lý học nhận thức hiện đại. NXB Giáo dục.",
                citation_type=CitationType.REFERENCE_LIST,
                style=CitationStyle.APA,
                authors=["Trần, M. H."],
                year="2021",
                title="Tâm lý học nhận thức hiện đại",
                reference_id="ref-tran-vn-2021",
            ),
        ]
        result = linker.link(in_text, bibs)
        assert not any(lnk.status == CitationMappingStatus.MISSING_REFERENCE for lnk in result.links)
        assert result.links[0].reference_id == "ref-tran-vn-2021"

    def test_secondary_citation_quoted_in_extraction_and_linking(self) -> None:
        """(quoted in Smith, 2020) and (Miller, 1995, quoted in Smith, 2020) both extract and link to Smith (2020)."""
        extractor = CitationExtractor()
        body = "The phenomenon was first observed in early trials (quoted in Smith, 2020) and later confirmed (Miller, 1995, quoted in Smith, 2020)."
        extracted = _extract_text(extractor, body)
        raw_texts = [c.raw_text for c in extracted]
        assert "(quoted in Smith, 2020)" in raw_texts
        assert "(Miller, 1995, quoted in Smith, 2020)" in raw_texts

        bib = Citation(
            raw_text="Smith, J. R. (2020). Historical perspectives on empirical methods. Oxford University Press.",
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.APA,
            authors=["Smith, J. R."],
            year="2020",
            title="Historical perspectives on empirical methods",
            reference_id="ref-smith-2020",
        )
        linker = CitationLinker()
        result = linker.link(extracted, [bib])
        assert not any(lnk.status == CitationMappingStatus.MISSING_REFERENCE for lnk in result.links)
        matched = [lnk for lnk in result.links if lnk.status == CitationMappingStatus.MATCHED]
        assert len(matched) == 2
        assert all(lnk.reference_id == "ref-smith-2020" for lnk in matched)

    def test_ieee_numeric_cluster_en_dash_and_em_dash(self) -> None:
        """Complex IEEE numeric clusters [1, 3–5, 8] (en-dash) and [1, 3—5, 8] (em-dash) link all cited indices."""
        linker = CitationLinker()
        bibs = [
            Citation(
                raw_text=f"[{i}] Author {i}, \"Title {i},\" IEEE Trans., 202{i % 5}.",
                citation_type=CitationType.REFERENCE_LIST,
                style=CitationStyle.IEEE,
                numeric_index=i,
                reference_id=f"ref-{i:04d}",
            )
            for i in [1, 3, 4, 5, 8]
        ]
        in_text = Citation(
            raw_text="[1, 3–5, 8]",
            citation_type=CitationType.IN_TEXT,
            style=CitationStyle.IEEE,
        )
        result = linker.link([in_text], bibs)
        matched_refs = [lnk.reference_id for lnk in result.links if lnk.status == CitationMappingStatus.MATCHED]
        assert matched_refs == ["ref-0001", "ref-0003", "ref-0004", "ref-0005", "ref-0008"]
        assert not any(lnk.status == CitationMappingStatus.MISSING_REFERENCE for lnk in result.links)
        assert len(result.unmatched_reference_ids) == 0

    def test_ieee_numeric_cluster_bracket_to_bracket_range(self) -> None:
        """Adjacent bracket range [1]-[3] is extracted as a range and links to [1], [2], and [3]."""
        extractor = CitationExtractor()
        extracted = _extract_text(extractor, "Prior studies [1]-[3] established the baseline.")
        assert any(c.raw_text == "[1]-[3]" for c in extracted)

        linker = CitationLinker()
        bibs = [
            Citation(
                raw_text=f"[{i}] Author {i}, \"Paper {i},\" Conf., 2022.",
                citation_type=CitationType.REFERENCE_LIST,
                style=CitationStyle.IEEE,
                numeric_index=i,
                reference_id=f"ref-{i:04d}",
            )
            for i in [1, 2, 3]
        ]
        result = linker.link(extracted, bibs)
        matched_refs = [lnk.reference_id for lnk in result.links if lnk.status == CitationMappingStatus.MATCHED]
        assert matched_refs == ["ref-0001", "ref-0002", "ref-0003"]
        assert len(result.unmatched_reference_ids) == 0

    def test_ieee_numeric_cluster_irregular_spaces(self) -> None:
        """Complex IEEE cluster [1,2, 4 - 6] with irregular spacing expands to [1, 2, 4, 5, 6]."""
        extractor = CitationExtractor()
        extracted = _extract_text(extractor, "Multiple experiments [1,2, 4 - 6] validate this.")
        assert len(extracted) == 1
        assert extracted[0].raw_text == "[1,2, 4 - 6]"

        linker = CitationLinker()
        bibs = [
            Citation(
                raw_text=f"[{i}] Author {i}, \"Paper {i},\" Conf., 2023.",
                citation_type=CitationType.REFERENCE_LIST,
                style=CitationStyle.IEEE,
                numeric_index=i,
                reference_id=f"ref-{i:04d}",
            )
            for i in [1, 2, 4, 5, 6]
        ]
        result = linker.link(extracted, bibs)
        matched_refs = [lnk.reference_id for lnk in result.links if lnk.status == CitationMappingStatus.MATCHED]
        assert matched_refs == ["ref-0001", "ref-0002", "ref-0004", "ref-0005", "ref-0006"]
        assert not any(lnk.status == CitationMappingStatus.MISSING_REFERENCE for lnk in result.links)


# =============================================================================
# Case Group B — False-Positive In-Text Citation Noise Filtering
# =============================================================================


class TestCaseGroupBFalsePositiveBracketNoiseFiltering:
    """Verify CitationExtractor filters out CS/math/editorial/structural bracket noise."""

    def test_reject_code_array_and_matrix_indexing(self) -> None:
        """Code/math indexing arr[0], matrix[1, 2], dp[1][2], x[1] = 5 must NOT be extracted as IEEE citations."""
        extractor = CitationExtractor()
        text = (
            "We initialize arr[0] = 1, compute matrix[1, 2] and transition state dp[1][2] "
            "along with tensor[1][2][3] and buffer[16] in the dynamic programming loop."
        )
        extracted = _extract_text(extractor, text)
        assert extracted == []

    def test_reject_structural_document_labels_english(self) -> None:
        """Figure [1], Table [2], Eq. [3], Section [4], Step [1] must NOT be extracted as IEEE citations."""
        extractor = CitationExtractor()
        text = (
            "As illustrated in Figure [1] and summarized in Table [2], substituting Eq. [3] "
            "into Equation [4] of Section [4] during Step [1] and Algorithm [2] yields the bound in Theorem [3]."
        )
        extracted = _extract_text(extractor, text)
        assert extracted == []

    def test_reject_structural_document_labels_vietnamese(self) -> None:
        """Vietnamese structural labels Hình [1], Bảng [2], Công thức [3], Mục [4], Bước [1] must NOT be extracted."""
        extractor = CitationExtractor()
        text = (
            "Kết quả tại Hình [1] và Bảng [2] được tính theo Công thức [3] "
            "trình bày ở Mục [4], Chương [2], Bước [1] của Thuật toán [2]."
        )
        extracted = _extract_text(extractor, text)
        assert extracted == []

    def test_reject_standalone_year_and_page_markers_in_brackets(self) -> None:
        """Standalone years [2024], [1998] and page markers [p. 42], [pp. 10-15] must NOT be extracted."""
        extractor = CitationExtractor()
        text = (
            "The dataset released in [2024] (see also [1998]) notes on [p. 42] and [pp. 10-15] "
            "as well as [tr. 12] that the baseline holds."
        )
        extracted = _extract_text(extractor, text)
        assert extracted == []

    def test_reject_editorial_brackets_while_preserving_true_citations(self) -> None:
        """[sic] and [emphasis added] and Figure [1] are ignored while real citations in the same paragraph are extracted."""
        extractor = CitationExtractor()
        text = (
            "The author wrote 'teh [sic] model converges [emphasis added]' in Figure [1] and dp[1][2], "
            "which aligns with prior findings in Figure 1 [2] and [3, 5–7]."
        )
        extracted = _extract_text(extractor, text)
        raw_texts = [c.raw_text for c in extracted]
        assert raw_texts == ["[2]", "[3, 5–7]"]


# =============================================================================
# Case Group C — Tricky Author Names & Diacritics
# =============================================================================


class TestCaseGroupCTrickyAuthorNamesAndDiacritics:
    """Test AuthorParser, AuthorMatcher, and VenueNormalizer on compound surnames, Vietnamese diacritics, and corporate authors."""

    def test_compound_surnames_parsing_and_matching(self) -> None:
        """Van Der Maaten, De La Torre, O'Connor, St. Clair, and Al-Rfou parse and match accurately."""
        cases = [
            ("Van Der Maaten, Laurens", "L. van der Maaten", "van der maaten", ["l"]),
            ("De La Torre, Fernando", "F. De la Torre", "de la torre", ["f"]),
            ("O'Connor, Brendan", "B. O'Connor", "o'connor", ["b"]),
            ("St. Clair, John", "J. St. Clair", "st. clair", ["j"]),
            ("Al-Rfou, Rami", "R. Al-Rfou", "al-rfou", ["r"]),
        ]
        for raw_apa, raw_ieee, expected_last, expected_inits in cases:
            parsed = normalize_author(raw_apa)
            assert parsed.last_name == expected_last
            assert parsed.initials == expected_inits
            parsed_list = parse_authors(raw_apa)
            assert len(parsed_list) == 1
            assert author_match_score([raw_apa], [raw_ieee]) == 1.0

    def test_vietnamese_ocr_diacritic_stripped_matches_and_links(self) -> None:
        """Vietnamese name with diacritics 'Nguyễn Bảo Minh' matches 'Nguyen, B. M.' and links in CitationLinker."""
        assert author_match_score(["Nguyễn Bảo Minh"], ["Nguyen, B. M."]) == 1.0
        assert author_match_score(["Nguyễn Bảo Minh"], ["Minh, Nguyen Bao"]) == 1.0
        assert author_match_score(["Nguyễn, B. M."], ["Nguyen, B. M."]) == 1.0

        linker = CitationLinker()
        in_text = [
            Citation(
                raw_text="(Nguyễn Bảo Minh, 2023)",
                citation_type=CitationType.IN_TEXT,
                style=CitationStyle.APA,
            ),
        ]
        bibs = [
            Citation(
                raw_text="Nguyen, B. M. (2023). Vietnamese natural language processing.",
                citation_type=CitationType.REFERENCE_LIST,
                style=CitationStyle.APA,
                authors=["Nguyen, B. M."],
                year="2023",
                title="Vietnamese natural language processing",
                reference_id="ref-nbm-2023",
            ),
        ]
        res = linker.link(in_text, bibs)
        assert len(res.links) == 1
        assert res.links[0].status == CitationMappingStatus.MATCHED
        assert res.links[0].reference_id == "ref-nbm-2023"
        assert res.links[0].method == MappingMethod.AUTHOR_YEAR

    def test_vietnamese_different_family_names_same_given_name_do_not_match(self) -> None:
        """'Nguyễn Văn An' vs 'Trần Văn An' and 'Đỗ Văn An' vs 'Đào Văn An' must NOT falsely match on given name 'An'."""
        assert author_match_score(["Nguyễn Văn An"], ["Trần Văn An"]) == 0.0
        assert author_match_score(["Đỗ Văn An"], ["Đào Văn An"]) == 0.0
        assert author_match_score(["Lê Minh Hoàng"], ["Phạm Minh Hoàng"]) == 0.0

    def test_vietnamese_conflicting_diacritic_surnames_do_not_match(self) -> None:
        """Conflicting Vietnamese tone/diacritic surnames ('Nguyễn' vs 'Nguyên', 'Đỗ' vs 'Đào'/'Độ') must NOT match."""
        assert author_match_score(["Nguyễn, V. A."], ["Nguyên, V. A."]) == 0.0
        assert author_match_score(["Nguyễn Văn An"], ["Nguyên Văn An"]) == 0.0
        assert author_match_score(["Đỗ, V. A."], ["Đào, V. A."]) == 0.0
        assert author_match_score(["Đỗ, V. A."], ["Độ, V. A."]) == 0.0

    def test_corporate_author_world_health_organization(self) -> None:
        """Corporate author 'World Health Organization (WHO)' matches 'WHO' and 'World Health Organization'."""
        assert author_match_score(["World Health Organization (WHO)"], ["WHO"]) == 1.0
        assert author_match_score(["World Health Organization (WHO)"], ["World Health Organization"]) == 1.0
        parsed = parse_authors("World Health Organization (WHO)")
        assert len(parsed) == 1

    def test_corporate_author_vietnam_ministry_of_education(self) -> None:
        """Corporate author 'Bộ Giáo dục và Đào tạo' matches 'Bộ GD&ĐT' and 'BGDĐT'."""
        assert author_match_score(["Bộ Giáo dục và Đào tạo"], ["Bộ Giáo dục và Đào tạo (BGDĐT)"]) == 1.0
        assert author_match_score(["Bộ Giáo dục và Đào tạo"], ["Bộ GD&ĐT"]) == 1.0
        assert author_match_score(["Bộ Giáo dục và Đào tạo"], ["BGDĐT"]) == 1.0

    def test_corporate_author_general_statistics_office_gso(self) -> None:
        """Corporate author 'General Statistics Office of Vietnam (GSO)' matches 'GSO' and 'General Statistics Office'."""
        assert author_match_score(["General Statistics Office of Vietnam (GSO)"], ["GSO"]) == 1.0
        assert author_match_score(["General Statistics Office of Vietnam (GSO)"], ["General Statistics Office"]) == 1.0

    def test_venue_normalizer_canonical_conferences_and_journals(self) -> None:
        """VenueNormalizer maps NIPS/NeurIPS, ICML, and ACL variations to equivalent canonical forms."""
        normalizer = VenueNormalizer()
        assert normalizer.similarity("Advances in Neural Information Processing Systems", "NeurIPS") >= 0.90
        assert normalizer.similarity("Proceedings of the International Conference on Machine Learning", "ICML") >= 0.90


# =============================================================================
# Case Group D — Neuro-Symbolic Borderline & Chimeric Hallucination Cases
# =============================================================================


class TestCaseGroupDNeuroSymbolicBorderlineAndChimericCases:
    """Test SymbolicRules and NeuroSymbolicChecker on preprint transitions, chimeric DOIs, retractions, and Wayback links."""

    def test_preprint_to_published_year_drift_verified(self) -> None:
        """arXiv 2017 preprint published in 2018 (|year_distance| == 1, title_sim >= 0.95, author_jaccard >= 0.80) -> VERIFIED."""
        rules = SymbolicRules()
        cand = SourceCandidate(
            source_name="openalex",
            found=True,
            title="Attention Is All You Need",
            authors=["Ashish Vaswani", "Noam Shazeer"],
            year="2018",
            doi="10.5555/3295222.3295349",
            score=0.98,
        )
        source = SourceResult(
            citation_raw="Vaswani et al. (2017). Attention Is All You Need. arXiv:1706.03762.",
            candidates=[cand],
            sources_queried=["openalex", "crossref"],
            sources_succeeded=["openalex", "crossref"],
        )
        features = MatchFeatures(
            title_sim_fuzzy=0.98,
            title_sim_semantic=0.98,
            author_jaccard=0.90,
            year_distance=1,
            doi_exact_match=False,
            source_consensus=2,
        )
        outcome = rules.apply(
            features=features,
            source=source,
            citation_authors=["Vaswani, A.", "Shazeer, N."],
            citation_year="2017",
        )
        assert outcome.label == ValidationLabel.VERIFIED
        assert outcome.confidence >= 0.75

    def test_preprint_arxiv_doi_vs_published_doi_no_conflict_verified(self) -> None:
        """Preprint arXiv DOI (10.48550/arXiv.*) vs published venue DOI is not treated as a DOI conflict when title & authors match."""
        rules = SymbolicRules()
        cand = SourceCandidate(
            source_name="dblp",
            found=True,
            title="Deep Residual Learning for Image Recognition",
            authors=["Kaiming He", "Xiangyu Zhang", "Shaoqing Ren", "Jian Sun"],
            year="2016",
            doi="10.1109/CVPR.2016.90",
            score=0.99,
        )
        source = SourceResult(
            citation_raw="He, K., et al. (2015). Deep Residual Learning for Image Recognition. https://doi.org/10.48550/arXiv.1512.03385",
            candidates=[cand],
            sources_queried=["dblp"],
            sources_succeeded=["dblp"],
        )
        features = MatchFeatures(
            title_sim_fuzzy=0.98,
            title_sim_semantic=0.98,
            author_jaccard=1.0,
            year_distance=1,
            doi_exact_match=False,
            source_consensus=1,
        )
        outcome = rules.apply(
            features=features,
            source=source,
            citation_doi="10.48550/arXiv.1512.03385",
            citation_authors=["He, K.", "Zhang, X.", "Ren, S.", "Sun, J."],
            citation_year="2015",
        )
        assert outcome.label == ValidationLabel.VERIFIED
        assert "R-SINGLE-SOURCE-VERIFIED" in outcome.triggered_rules

    def test_spliced_chimeric_doi_hallucination_single_source(self) -> None:
        """Valid DOI belonging to a completely different paper (doi_exact_match=True, title_sim < 0.35, author_jaccard < 0.20) -> SUSPECTED_HALLUCINATION."""
        rules = SymbolicRules()
        cand = SourceCandidate(
            source_name="crossref",
            found=True,
            title="Quantum Chromodynamics on a Lattice at Finite Temperature",
            authors=["Creutz, M.", "Wilson, K."],
            year="2019",
            doi="10.1038/s41586-019-1666-5",
            score=0.95,
        )
        source = SourceResult(
            citation_raw="Nguyen, V. A., & Tran, B. (2023). Transformer Architectures for Vietnamese Sentiment Analysis. https://doi.org/10.1038/s41586-019-1666-5",
            candidates=[cand],
            sources_queried=["crossref", "openalex"],
            sources_succeeded=["crossref"],
        )
        features = MatchFeatures(
            title_sim_fuzzy=0.18,
            title_sim_semantic=0.18,
            author_jaccard=0.0,
            year_distance=4,
            doi_exact_match=True,
            source_consensus=1,
        )
        outcome = rules.apply(
            features=features,
            source=source,
            citation_doi="10.1038/s41586-019-1666-5",
            citation_authors=["Nguyen, V. A.", "Tran, B."],
            citation_year="2023",
        )
        assert outcome.label == ValidationLabel.SUSPECTED_HALLUCINATION
        assert "R-CHIMERIC-DOI-MISMATCH" in outcome.triggered_rules
        assert "doi" in outcome.mismatched_fields
        assert "title" in outcome.mismatched_fields
        assert "author" in outcome.mismatched_fields

    def test_spliced_chimeric_doi_hallucination_multi_source_consensus(self) -> None:
        """Even when 2 registries resolve the stolen DOI (consensus=2), if both title_sim < 0.35 and author_jaccard < 0.20, flag as SUSPECTED_HALLUCINATION."""
        rules = SymbolicRules()
        cand = SourceCandidate(
            source_name="crossref",
            found=True,
            title="A Clinical Trial of Cardiovascular Stents in Elderly Patients",
            authors=["Anderson, R.", "Baker, T."],
            year="2020",
            doi="10.1056/NEJMoa2001234",
            score=0.95,
        )
        source = SourceResult(
            citation_raw="Le, H., & Pham, K. (2023). Zero-Shot Prompting for Autonomous Code Repair. https://doi.org/10.1056/NEJMoa2001234",
            candidates=[cand],
            sources_queried=["crossref", "openalex"],
            sources_succeeded=["crossref", "openalex"],
        )
        features = MatchFeatures(
            title_sim_fuzzy=0.12,
            title_sim_semantic=0.12,
            author_jaccard=0.0,
            year_distance=3,
            doi_exact_match=True,
            source_consensus=2,
        )
        outcome = rules.apply(
            features=features,
            source=source,
            citation_doi="10.1056/NEJMoa2001234",
            citation_authors=["Le, H.", "Pham, K."],
            citation_year="2023",
        )
        assert outcome.label == ValidationLabel.SUSPECTED_HALLUCINATION
        assert "R-CHIMERIC-DOI-MISMATCH" in outcome.triggered_rules

    def test_retracted_paper_never_verified_in_symbolic_rules_and_checker(self) -> None:
        """Retracted paper (is_retracted=True) is NEVER VERIFIED and always triggers R-RETRACTED-PAPER in both SymbolicRules and NeuroSymbolicChecker."""
        citation = Citation(
            raw_text="Wakefield, A. J., et al. (1998). Ileal-lymphoid-nodular hyperplasia, non-specific colitis, and pervasive developmental disorder in children. The Lancet. https://doi.org/10.1016/S0140-6736(97)11096-0",
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.APA,
            authors=["Wakefield, A. J."],
            year="1998",
            title="Ileal-lymphoid-nodular hyperplasia, non-specific colitis, and pervasive developmental disorder in children",
            doi="10.1016/s0140-6736(97)11096-0",
        )
        cand = SourceCandidate(
            source_name="crossref",
            found=True,
            title="Ileal-lymphoid-nodular hyperplasia, non-specific colitis, and pervasive developmental disorder in children",
            authors=["Wakefield, A. J."],
            year="1998",
            doi="10.1016/s0140-6736(97)11096-0",
            score=1.0,
        )
        source = SourceResult(
            citation_raw=citation.raw_text,
            candidates=[cand],
            sources_queried=["crossref", "openalex"],
            sources_succeeded=["crossref", "openalex"],
            is_retracted=True,
        )
        features = MatchFeatures(
            title_sim_fuzzy=1.0,
            title_sim_semantic=1.0,
            author_jaccard=1.0,
            year_distance=0,
            doi_exact_match=True,
            source_consensus=2,
        )
        rules = SymbolicRules()
        outcome = rules.apply(
            features=features,
            source=source,
            citation_doi=citation.doi,
            citation_authors=citation.authors,
            citation_year=citation.year,
        )
        assert outcome.label == ValidationLabel.METADATA_ERROR
        assert "R-RETRACTED-PAPER" in outcome.triggered_rules
        assert "retracted" in outcome.mismatched_fields

        checker = NeuroSymbolicChecker(enable_content_alignment=False, enable_calibration=False)
        verdict = checker.check(citation, source)
        assert verdict.label == ValidationLabel.METADATA_ERROR
        assert verdict.is_retracted is True
        assert "R-RETRACTED-PAPER" in verdict.triggered_rules

    def test_broken_url_rescued_by_wayback_machine_archived_alive(self) -> None:
        """Broken URL rescued by Wayback Machine (url_status='archived_alive') triggers R-WAYBACK-ARCHIVED and is not penalized as dead link hallucination."""
        citation = Citation(
            raw_text="Vietnam National CERT (2021). Báo cáo an toàn thông tin mạng quốc gia. Retrieved from https://vncert.gov.vn/baocao-2021.pdf",
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.APA,
            authors=["Vietnam National CERT"],
            year="2021",
            title="Báo cáo an toàn thông tin mạng quốc gia",
            url="https://vncert.gov.vn/baocao-2021.pdf",
        )
        source = SourceResult(
            citation_raw=citation.raw_text,
            candidates=[],
            sources_queried=["crossref", "openalex"],
            sources_succeeded=[],
            url_status="archived_alive",
            archive_url="https://web.archive.org/web/20220301000000/https://vncert.gov.vn/baocao-2021.pdf",
        )
        checker = NeuroSymbolicChecker(enable_content_alignment=False, enable_calibration=False)
        verdict = checker.check(citation, source)
        assert verdict.label == ValidationLabel.RESOURCE
        assert "R-WAYBACK-ARCHIVED" in verdict.triggered_rules
        assert "R-DEAD-URL" not in verdict.triggered_rules
        assert verdict.archive_url == "https://web.archive.org/web/20220301000000/https://vncert.gov.vn/baocao-2021.pdf"

    def test_cross_lingual_translated_title_flagged_as_metadata_error(self) -> None:
        """Vietnamese-translated title of an English work triggers R-CROSS-LINGUAL-TITLE-MATCH -> METADATA_ERROR."""
        rules = SymbolicRules()
        cand = SourceCandidate(
            source_name="crossref",
            found=True,
            title="Attention Is All You Need",
            authors=["Vaswani, A.", "Shazeer, N."],
            year="2017",
            doi="10.48550/arXiv.1706.03762",
            score=0.90,
        )
        source = SourceResult(
            citation_raw="Vaswani, A., & Shazeer, N. (2017). Sự chú ý là tất cả những gì bạn cần. NeurIPS.",
            candidates=[cand],
            sources_queried=["crossref"],
            sources_succeeded=["crossref"],
        )
        features = MatchFeatures(
            title_sim_fuzzy=0.25,
            title_sim_semantic=0.25,
            author_jaccard=1.0,
            year_distance=0,
            doi_exact_match=False,
            source_consensus=1,
            cross_lingual_title_detected=True,
            cross_lingual_title_sim=0.72,
        )
        outcome = rules.apply(
            features=features,
            source=source,
            citation_authors=["Vaswani, A.", "Shazeer, N."],
            citation_year="2017",
        )
        assert outcome.label == ValidationLabel.METADATA_ERROR
        assert "R-CROSS-LINGUAL-TITLE-MATCH" in outcome.triggered_rules
        assert "title" in outcome.mismatched_fields


# =============================================================================
# Case Group E — Vietnamese Legal Statute Edge Cases
# =============================================================================


class TestCaseGroupEVietnameseLegalStatuteEdgeCases:
    """Test VNLegalVerifier and NeuroSymbolicChecker on Vietnamese codes, laws, decrees, superseded statutes, and fabricated codes."""

    def test_valid_statute_by_code_only_luat_59_2020_qh14(self) -> None:
        """'Luật số 59/2020/QH14' resolves to canonical Luật Doanh nghiệp (59/2020/QH14) by Quốc hội."""
        res = verify_vn_legal_citation("Luật số 59/2020/QH14 của Quốc hội")
        assert res.is_valid is True
        assert res.is_verified_statute is True
        assert res.is_superseded is False
        assert res.canonical_name == "Luật Doanh nghiệp"
        assert res.canonical_code == "59/2020/QH14"
        assert res.canonical_authority == "Quốc hội"
        assert "R-VN-LEGAL-VERIFIED" in res.triggered_rules

    def test_valid_decree_nghi_dinh_13_2023_nd_cp(self) -> None:
        """'Nghị định 13/2023/NĐ-CP' is verified as a valid Chính phủ decree."""
        res = verify_vn_legal_citation("Chính phủ (2023). Nghị định 13/2023/NĐ-CP về bảo vệ dữ liệu cá nhân.")
        assert res.is_valid is True
        assert res.canonical_code == "13/2023/NĐ-CP"
        assert res.canonical_authority == "Chính phủ"
        assert "R-VN-LEGAL-VERIFIED" in res.triggered_rules

    def test_valid_code_bo_luat_dan_su_2015(self) -> None:
        """'Bộ luật Dân sự 2015' is verified against the curated statutory registry (91/2015/QH13)."""
        res = verify_vn_legal_citation("Quốc hội (2015). Bộ luật Dân sự 2015 (Luật số 91/2015/QH13).")
        assert res.is_valid is True
        assert res.is_verified_statute is True
        assert res.is_superseded is False
        assert res.canonical_name == "Bộ luật Dân sự"
        assert res.canonical_code == "91/2015/QH13"
        assert res.canonical_authority == "Quốc hội"

    def test_superseded_statute_luat_doanh_nghiep_2014(self) -> None:
        """'Luật Doanh nghiệp 2014' is valid historically but flagged with R-VN-LEGAL-SUPERSEDED."""
        res = verify_vn_legal_citation("Quốc hội (2014). Luật Doanh nghiệp 2014 (Luật số 68/2014/QH13).")
        assert res.is_valid is True
        assert res.is_verified_statute is True
        assert res.is_superseded is True
        assert "R-VN-LEGAL-SUPERSEDED" in res.triggered_rules
        assert res.superseded_by is not None
        assert "59/2020/QH14" in res.superseded_by

    def test_fabricated_bo_luat_tri_tue_nhan_tao_2024(self) -> None:
        """'Bộ luật Trí tuệ nhân tạo 2024' is caught as a fabricated 'Bộ luật' (not one of Vietnam's 6 official codes)."""
        raw = "Quốc hội (2024). Bộ luật Trí tuệ nhân tạo 2024."
        res = verify_vn_legal_citation(raw)
        assert res.is_valid is False
        assert "R-VN-LEGAL-FABRICATED" in res.triggered_rules

        checker = NeuroSymbolicChecker(enable_content_alignment=False, enable_calibration=False)
        cit = Citation(
            raw_text=raw,
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.APA,
            authors=["Quốc hội"],
            year="2024",
            title="Bộ luật Trí tuệ nhân tạo 2024",
        )
        verdict = checker.check(cit, SourceResult(citation_raw=raw))
        assert verdict.label == ValidationLabel.SUSPECTED_HALLUCINATION
        assert "R-VN-LEGAL-FABRICATED" in verdict.triggered_rules

    def test_wrong_issuing_authority_and_code_mismatch_flagged(self) -> None:
        """Attributing Bộ luật Dân sự to Chính phủ or giving wrong code number to Luật Đầu tư 2020 is flagged as R-VN-LEGAL-MISMATCH."""
        res_auth = verify_vn_legal_citation("Bộ luật Dân sự 2015 của Chính phủ")
        assert res_auth.is_valid is False
        assert "venue" in res_auth.mismatched_fields
        assert "R-VN-LEGAL-MISMATCH" in res_auth.triggered_rules

        res_code = verify_vn_legal_citation("Luật Đầu tư 2020 (Luật số 59/2020/QH14)")
        assert res_code.is_valid is False
        assert "title" in res_code.mismatched_fields
        assert "R-VN-LEGAL-MISMATCH" in res_code.triggered_rules
