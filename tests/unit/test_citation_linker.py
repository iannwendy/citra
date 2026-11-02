"""Unit tests cho linking/citation_linker.py — CitationLinker (v1.2 §3.5)."""

from __future__ import annotations

from integrity_checker.linking import CitationLinker
from integrity_checker.linking.statuses import CitationMappingStatus
from integrity_checker.models.citation import Citation, CitationType
from integrity_checker.models.validation import MappingMethod


def cit(
    raw,
    ctype=CitationType.IN_TEXT,
    authors=None,
    year=None,
    title_norm=None,
    num_idx=None,
    doi=None,
    ref_id=None,
    grobid_ref_id=None,
):
    c = Citation(
        raw_text=raw,
        citation_type=ctype,
        authors=authors or [],
        year=year,
        title_normalized=title_norm,
        numeric_index=num_idx,
        doi=doi,
        reference_id=ref_id,
    )
    # Set grobid_ref_id for TEI link tests (v1.10 GROBID adapter)
    if grobid_ref_id is not None:
        c.grobid_ref_id = grobid_ref_id
    return c


class TestMatchedAuthorYear:
    def test_simple_author_year(self):
        bibs = [
            cit(
                "Smith, J. (2020). Deep learning. Nature.",
                CitationType.REFERENCE_LIST,
                authors=["Smith, J."],
                year="2020",
                ref_id="ref-0",
            )
        ]
        body = [cit("(Smith, 2020)")]
        result = CitationLinker().link(body, bibs)
        assert len(result.links) == 1
        assert result.links[0].status == CitationMappingStatus.MATCHED
        assert result.links[0].method.value == "author_year"

    def test_author_year_case_insensitive(self):
        bibs = [
            cit(
                "smith, j. (2020). Title.",
                CitationType.REFERENCE_LIST,
                authors=["smith, j."],
                year="2020",
                ref_id="ref-0",
            )
        ]
        body = [cit("(SMITH, 2020)")]
        result = CitationLinker().link(body, bibs)
        assert result.links[0].status == CitationMappingStatus.MATCHED

    def test_year_suffix_2020a_2020b(self):
        bibs = [
            cit(
                "Smith, J. (2020a). Paper A.",
                CitationType.REFERENCE_LIST,
                authors=["Smith, J."],
                year="2020",
                ref_id="ref-a",
            ),
            cit(
                "Smith, J. (2020b). Paper B.",
                CitationType.REFERENCE_LIST,
                authors=["Smith, J."],
                year="2020",
                ref_id="ref-b",
            ),
        ]
        body = [cit("(Smith, 2020a)")]
        result = CitationLinker().link(body, bibs)
        assert result.links[0].status == CitationMappingStatus.MATCHED
        assert result.links[0].reference_id == "ref-a"

    def test_year_suffix_2020e(self):
        """(Smith, 2020e) properly strips 'e' suffix and matches year 2020."""
        bibs = [
            cit(
                "Smith, J. (2020). Paper E.",
                CitationType.REFERENCE_LIST,
                authors=["Smith, J."],
                year="2020",
                ref_id="ref-e",
            ),
        ]
        body = [cit("(Smith, 2020e)")]
        result = CitationLinker().link(body, bibs)
        assert result.links[0].status == CitationMappingStatus.MATCHED
        assert result.links[0].reference_id == "ref-e"

    def test_semicolon_multi_citation_partial_missing(self):
        """(Smith, 2020; FakeAuthor, 2024) emits both MATCHED and MISSING_REFERENCE links."""
        bibs = [
            cit(
                "Smith, J. (2020). Paper A.",
                CitationType.REFERENCE_LIST,
                authors=["Smith, J."],
                year="2020",
                ref_id="ref-0",
            ),
        ]
        body = [cit("(Smith, 2020; FakeAuthor, 2024)")]
        result = CitationLinker().link(body, bibs)
        statuses = [l.status for l in result.links]
        assert CitationMappingStatus.MATCHED in statuses
        assert CitationMappingStatus.MISSING_REFERENCE in statuses

    def test_multiple_body_citations_matched(self):
        bibs = [
            cit("Smith, J. (2020). Title A.", CitationType.REFERENCE_LIST,
                authors=["Smith, J."], year="2020", ref_id="ref-0"),
            cit("Doe, A. (2021). Title B.", CitationType.REFERENCE_LIST,
                authors=["Doe, A."], year="2021", ref_id="ref-1"),
        ]
        body = [cit("(Smith, 2020)"), cit("(Doe, 2021)"), cit("(Smith, 2020)")]
        result = CitationLinker().link(body, bibs)
        assert all(l.status == CitationMappingStatus.MATCHED for l in result.links)

    def test_et_al_suffix(self):
        """(Smith et al., 2020) → match bib with Smith as first author."""
        bibs = [
            cit(
                "Smith, J., Doe, A., & Lee, B. (2020). Title.",
                CitationType.REFERENCE_LIST,
                authors=["Smith, J.", "Doe, A.", "Lee, B."],
                year="2020",
                ref_id="ref-0",
            )
        ]
        body = [cit("(Smith et al., 2020)")]
        result = CitationLinker().link(body, bibs)
        assert result.links[0].status == CitationMappingStatus.MATCHED

    def test_author_with_comma(self):
        """Author form: 'Smith, J.' → extract last_name = 'Smith'."""
        bibs = [
            cit("Smith, J. (2020). Title.", CitationType.REFERENCE_LIST,
                authors=["Smith, J."], year="2020", ref_id="ref-0"),
        ]
        body = [cit("(Smith, 2020)")]
        result = CitationLinker().link(body, bibs)
        assert result.links[0].status == CitationMappingStatus.MATCHED


class TestMatchedNumericIndex:
    def test_simple_numeric(self):
        bibs = [cit("[1] LeCun. Deep learning.", CitationType.REFERENCE_LIST,
                      num_idx=1, ref_id="ref-0")]
        body = [cit("[1]", CitationType.NUMERIC)]
        result = CitationLinker().link(body, bibs)
        assert result.links[0].status == CitationMappingStatus.MATCHED
        assert result.links[0].method.value == "numeric_index"

    def test_numeric_multi_comma(self):
        """[1, 2] → match bib[1] (first found)."""
        bibs = [
            cit("[1] Smith.", CitationType.REFERENCE_LIST, num_idx=1, ref_id="ref-0"),
            cit("[2] Doe.", CitationType.REFERENCE_LIST, num_idx=2, ref_id="ref-1"),
        ]
        body = [cit("[1, 2]", CitationType.NUMERIC)]
        result = CitationLinker().link(body, bibs)
        assert result.links[0].status == CitationMappingStatus.MATCHED

    def test_numeric_range(self):
        """[1-3] → match bib[1]."""
        bibs = [cit("[1] Smith.", CitationType.REFERENCE_LIST, num_idx=1, ref_id="ref-0")]
        body = [cit("[1-3]", CitationType.NUMERIC)]
        result = CitationLinker().link(body, bibs)
        assert result.links[0].status == CitationMappingStatus.MATCHED


class TestMatchedDOI:
    def test_doi_in_in_text(self):
        bibs = [
            cit(
                "Smith. Nature. DOI: 10.1038/nature14539",
                CitationType.REFERENCE_LIST,
                doi="10.1038/nature14539",
                ref_id="ref-0",
            )
        ]
        body = [cit("(Smith, 2020) DOI: 10.1038/nature14539")]
        result = CitationLinker().link(body, bibs)
        assert result.links[0].status == CitationMappingStatus.MATCHED
        assert result.links[0].method.value == "doi_exact"

    def test_doi_case_insensitive(self):
        bibs = [
            cit("Smith. DOI: 10.1234/ABC", CitationType.REFERENCE_LIST,
                doi="10.1234/ABC", ref_id="ref-0"),
        ]
        body = [cit("(Smith, 2020) doi: 10.1234/abc")]
        result = CitationLinker().link(body, bibs)
        assert result.links[0].status == CitationMappingStatus.MATCHED


class TestMissingReference:
    def test_body_citation_no_match(self):
        bibs = [
            cit("Smith, J. (2020). Title.", CitationType.REFERENCE_LIST,
                authors=["Smith, J."], year="2020", ref_id="ref-0"),
        ]
        body = [cit("(Unknown, 2099)")]
        result = CitationLinker().link(body, bibs)
        assert result.links[0].status == CitationMappingStatus.MISSING_REFERENCE
        assert result.links[0].reference_id is None

    def test_multiple_missing(self):
        bibs = [
            cit("Smith (2020). Title.", CitationType.REFERENCE_LIST,
                authors=["Smith"], year="2020", ref_id="ref-0"),
        ]
        body = [cit("(Unknown1, 2020)"), cit("(Unknown2, 2021)")]
        result = CitationLinker().link(body, bibs)
        assert all(l.status == CitationMappingStatus.MISSING_REFERENCE for l in result.links)

    def test_missing_confidence_zero(self):
        bibs = [cit("Smith (2020).", CitationType.REFERENCE_LIST,
                     authors=["Smith"], year="2020", ref_id="ref-0")]
        body = [cit("(Unknown, 2020)")]
        result = CitationLinker().link(body, bibs)
        assert result.links[0].confidence == 0.0


class TestUncitedReference:
    def test_empty_body(self):
        bibs = [
            cit("Smith (2020). Title.", CitationType.REFERENCE_LIST,
                authors=["Smith"], year="2020", ref_id="ref-0"),
            cit("Doe (2021). Title.", CitationType.REFERENCE_LIST,
                authors=["Doe"], year="2021", ref_id="ref-1"),
        ]
        result = CitationLinker().link([], bibs)
        assert set(result.unmatched_reference_ids) == {"ref-0", "ref-1"}

    def test_partial_match(self):
        bibs = [
            cit("Smith (2020). Title A.", CitationType.REFERENCE_LIST,
                authors=["Smith"], year="2020", ref_id="ref-0"),
            cit("Doe (2021). Title B.", CitationType.REFERENCE_LIST,
                authors=["Doe"], year="2021", ref_id="ref-1"),
        ]
        body = [cit("(Smith, 2020)")]
        result = CitationLinker().link(body, bibs)
        assert result.unmatched_reference_ids == ["ref-1"]

    def test_all_cited_none_uncited(self):
        bibs = [
            cit("Smith (2020). Title.", CitationType.REFERENCE_LIST,
                authors=["Smith"], year="2020", ref_id="ref-0"),
        ]
        body = [cit("(Smith, 2020)")]
        result = CitationLinker().link(body, bibs)
        assert result.unmatched_reference_ids == []


class TestAmbiguousAndDuplicate:
    def test_ref_used_twice_both_matched(self):
        """Same source cited twice → both MATCHED (valid use of same reference)."""
        bibs = [
            cit("Smith (2020). Title.", CitationType.REFERENCE_LIST,
                authors=["Smith"], year="2020", ref_id="ref-0"),
        ]
        body = [cit("(Smith, 2020)"), cit("(Smith, 2020)")]
        result = CitationLinker().link(body, bibs)
        statuses = {l.status for l in result.links}
        # Both should be MATCHED — same source cited multiple times is VALID
        assert statuses == {CitationMappingStatus.MATCHED}
        assert result.matched_count == 2

    def test_three_refs_two_used(self):
        bibs = [
            cit("Smith (2020). Title A.", CitationType.REFERENCE_LIST,
                authors=["Smith"], year="2020", ref_id="ref-0"),
            cit("Doe (2021). Title B.", CitationType.REFERENCE_LIST,
                authors=["Doe"], year="2021", ref_id="ref-1"),
            cit("Lee (2022). Title C.", CitationType.REFERENCE_LIST,
                authors=["Lee"], year="2022", ref_id="ref-2"),
        ]
        body = [cit("(Smith, 2020)"), cit("(Doe, 2021)")]
        result = CitationLinker().link(body, bibs)
        assert result.unmatched_reference_ids == ["ref-2"]
        assert result.matched_count == 2


class TestConfidenceValues:
    def test_doi_highest_confidence(self):
        bibs = [cit("Smith. DOI: 10.1234/abc", CitationType.REFERENCE_LIST,
                     doi="10.1234/abc", ref_id="ref-0")]
        body = [cit("(Smith, 2020) DOI: 10.1234/abc")]
        result = CitationLinker().link(body, bibs)
        assert result.links[0].confidence == 0.95

    def test_author_year_confidence(self):
        bibs = [cit("Smith (2020). Title.", CitationType.REFERENCE_LIST,
                     authors=["Smith"], year="2020", ref_id="ref-0")]
        body = [cit("(Smith, 2020)")]
        result = CitationLinker().link(body, bibs)
        assert result.links[0].confidence == 0.90

    def test_numeric_confidence(self):
        bibs = [cit("[1] Smith.", CitationType.REFERENCE_LIST,
                     num_idx=1, ref_id="ref-0")]
        body = [cit("[1]", CitationType.NUMERIC)]
        result = CitationLinker().link(body, bibs)
        assert result.links[0].confidence == 0.90


class TestEdgeCases:
    def test_empty_both(self):
        result = CitationLinker().link([], [])
        assert result.total_citations == 0
        assert result.total_references == 0
        assert result.match_rate == 0.0

    def test_no_bib_entries(self):
        body = [cit("(Smith, 2020)")]
        result = CitationLinker().link(body, [])
        assert len(result.links) == 1
        assert result.links[0].status == CitationMappingStatus.MISSING_REFERENCE

    def test_gang_citation_no_year(self):
        """(Smith; Doe, 2020) — không parse được year → MISSING."""
        bibs = [
            cit("Smith (2020). Title A.", CitationType.REFERENCE_LIST,
                authors=["Smith"], year="2020", ref_id="ref-0"),
        ]
        body = [cit("(Smith; Doe, 2020)")]
        result = CitationLinker().link(body, bibs)
        assert result.links[0].status == CitationMappingStatus.MISSING_REFERENCE


class TestOrganizationAuthor:
    """Web references cite a publisher as author; the name lives in title/venue."""

    def test_org_name_in_title_matches(self):
        bibs = [
            cit("State of subscription apps 2025. (2025). RevenueCat. "
                "https://www.revenuecat.com/state-of-subscription-apps-2025/",
                CitationType.REFERENCE_LIST, year="2025", ref_id="ref-0"),
        ]
        body = [cit("(Revenuecat, 2025)")]
        result = CitationLinker().link(body, bibs)
        assert result.links[0].status == CitationMappingStatus.MATCHED

    def test_concatenated_org_name_matches(self):
        bibs = [
            cit("Top 7 user behavior metrics for fitness apps. (2025). "
                "Sport Fitness Apps. https://www.sportfitnessapps.com/x",
                CitationType.REFERENCE_LIST, year="2025", ref_id="ref-0"),
        ]
        body = [cit("(Sportsfitnessapps, 2025)")]
        result = CitationLinker().link(body, bibs)
        assert result.links[0].status == CitationMappingStatus.MATCHED

    def test_year_must_agree(self):
        bibs = [
            cit("State of subscription apps. (2024). RevenueCat. "
                "https://www.revenuecat.com/x",
                CitationType.REFERENCE_LIST, year="2024", ref_id="ref-0"),
        ]
        body = [cit("(Revenuecat, 2025)")]
        result = CitationLinker().link(body, bibs)
        assert result.links[0].status == CitationMappingStatus.MISSING_REFERENCE


class TestLinkingResultFields:
    def test_status_counts(self):
        bibs = [
            cit("Smith (2020). Title A.", CitationType.REFERENCE_LIST,
                authors=["Smith"], year="2020", ref_id="ref-0"),
            cit("Doe (2021). Title B.", CitationType.REFERENCE_LIST,
                authors=["Doe"], year="2021", ref_id="ref-1"),
        ]
        body = [cit("(Smith, 2020)"), cit("(Unknown, 2099)")]
        result = CitationLinker().link(body, bibs)
        assert result.status_counts[CitationMappingStatus.MATCHED] == 1
        assert result.status_counts[CitationMappingStatus.MISSING_REFERENCE] == 1

    def test_match_rate(self):
        bibs = [cit("Smith (2020).", CitationType.REFERENCE_LIST,
                     authors=["Smith"], year="2020", ref_id="ref-0")]
        body = [cit("(Smith, 2020)"), cit("(Doe, 2021)")]
        result = CitationLinker().link(body, bibs)
        assert result.match_rate == 0.5  # 1/2

    def test_to_dict_serializable(self):
        bibs = [cit("Smith (2020).", CitationType.REFERENCE_LIST,
                     authors=["Smith"], year="2020", ref_id="ref-0")]
        body = [cit("(Smith, 2020)")]
        result = CitationLinker().link(body, bibs)
        d = result.to_dict()
        assert isinstance(d["links"], list)
        assert isinstance(d["status_counts"], dict)
        for k in d["status_counts"]:
            assert isinstance(k, str)


# ---------- NEW v1.10: TEI Link Tests (GROBID Adapter) ----------

class TestTeiLink:
    """GROBID adapter TEI link integration tests."""

    def test_tei_link_direct_match(self):
        """TEI link b0 → b0 matches with high confidence."""
        bibs = [
            cit(
                "Smith (2020). Deep Learning. Nature.",
                CitationType.REFERENCE_LIST,
                authors=["Smith"],
                year="2020",
                ref_id="ref-0",
                grobid_ref_id="b0",
            ),
        ]
        body = [
            cit("(Smith, 2020)", grobid_ref_id="b0"),
        ]
        result = CitationLinker().link(body, bibs)

        assert result.links[0].status == CitationMappingStatus.MATCHED
        assert result.links[0].method == MappingMethod.TEI_LINK
        assert result.links[0].confidence == 0.98

    def test_tei_link_ref_id(self):
        """Bib has grobid_ref_id set correctly."""
        bibs = [
            cit(
                "Smith (2020). Deep Learning.",
                CitationType.REFERENCE_LIST,
                authors=["Smith"],
                year="2020",
                ref_id="ref-0",
                grobid_ref_id="b0",
            ),
        ]
        body = [
            cit("(Smith, 2020)", grobid_ref_id="b0"),
        ]
        result = CitationLinker().link(body, bibs)

        assert result.links[0].reference_id == "ref-0"

    def test_tei_link_no_match_different_id(self):
        """Different grobid_ref_id → falls back to author_year."""
        bibs = [
            cit(
                "Smith (2020). Deep Learning.",
                CitationType.REFERENCE_LIST,
                authors=["Smith"],
                year="2020",
                ref_id="ref-0",
                grobid_ref_id="b0",
            ),
        ]
        body = [
            cit("(Smith, 2020)", grobid_ref_id="b99"),  # Different ref_id
        ]
        result = CitationLinker().link(body, bibs)

        # TEI link fails → falls back to author_year
        assert result.links[0].status == CitationMappingStatus.MATCHED
        assert result.links[0].method == MappingMethod.AUTHOR_YEAR

    def test_tei_link_missing_bib_ref_id(self):
        """Bib without grobid_ref_id → falls back to author_year."""
        bibs = [
            cit(
                "Smith (2020). Deep Learning.",
                CitationType.REFERENCE_LIST,
                authors=["Smith"],
                year="2020",
                ref_id="ref-0",
                grobid_ref_id=None,  # No GROBID ref ID
            ),
        ]
        body = [
            cit("(Smith, 2020)", grobid_ref_id="b0"),
        ]
        result = CitationLinker().link(body, bibs)

        # No TEI match → falls back to author_year
        assert result.links[0].status == CitationMappingStatus.MATCHED
        assert result.links[0].method == MappingMethod.AUTHOR_YEAR

    def test_tei_link_highest_priority(self):
        """TEI_LINK has higher priority than DOI."""
        bibs = [
            cit(
                "Smith (2020). Deep Learning. DOI: 10.1234/test",
                CitationType.REFERENCE_LIST,
                authors=["Smith"],
                year="2020",
                ref_id="ref-0",
                doi="10.1234/test",
                grobid_ref_id="b0",
            ),
        ]
        body = [
            cit("(Smith, 2020) DOI: 10.1234/test", grobid_ref_id="b0"),
        ]
        result = CitationLinker().link(body, bibs)

        # TEI_LINK should win (higher priority than DOI)
        assert result.links[0].status == CitationMappingStatus.MATCHED
        assert result.links[0].method == MappingMethod.TEI_LINK

    def test_multiple_tei_links(self):
        """Multiple citations with TEI links all match."""
        bibs = [
            cit("Smith (2020). Paper A.", CitationType.REFERENCE_LIST,
                authors=["Smith"], year="2020", ref_id="ref-0", grobid_ref_id="b0"),
            cit("Doe (2021). Paper B.", CitationType.REFERENCE_LIST,
                authors=["Doe"], year="2021", ref_id="ref-1", grobid_ref_id="b1"),
        ]
        body = [
            cit("(Smith, 2020)", grobid_ref_id="b0"),
            cit("(Doe, 2021)", grobid_ref_id="b1"),
        ]
        result = CitationLinker().link(body, bibs)

        assert len(result.links) == 2
        assert all(l.status == CitationMappingStatus.MATCHED for l in result.links)
        assert all(l.method == MappingMethod.TEI_LINK for l in result.links)

    def test_bib_citations_populate_mapping_status(self):
        """Matched and uncited bibliography entries get mapping_status populated."""
        bibs = [
            cit("[1] Vaswani et al. (2017).", CitationType.REFERENCE_LIST, num_idx=1, ref_id="ref-0001"),
            cit("[2] Devlin et al. (2019).", CitationType.REFERENCE_LIST, num_idx=2, ref_id="ref-0002"),
        ]
        body = [cit("[1]", CitationType.NUMERIC, ref_id="occ-0001")]
        result = CitationLinker().link(body, bibs)

        assert bibs[0].mapping_status == "matched"
        assert bibs[0].mapping_confidence == 0.90
        assert len(bibs[0].citation_links) == 1
        assert bibs[1].mapping_status == "uncited_reference"
        assert result.unmatched_reference_ids == ["ref-0002"]


