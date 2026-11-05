"""Unit tests cho SymbolicRules."""

from __future__ import annotations

from integrity_checker.logic.rules import SymbolicRules
from integrity_checker.models.source import SourceCandidate, SourceResult
from integrity_checker.models.validation import MatchFeatures, ValidationLabel


def test_no_candidate_no_api_success_returns_unresolved() -> None:
    """Không có candidate, API OK → UNRESOLVED (not enough evidence)."""
    rules = SymbolicRules()
    source = SourceResult(
        citation_raw="test",
        candidates=[],
        sources_queried=["crossref", "openalex", "dblp", "datacite"],
        sources_succeeded=[],
        sources_failed={},
    )
    outcome = rules.apply(MatchFeatures(), source)
    assert outcome.label == ValidationLabel.UNRESOLVED
    assert "R-NO-CANDIDATE" in outcome.triggered_rules


def test_no_candidate_all_api_failed_returns_unresolved() -> None:
    """Không có candidate, tất cả API fail → UNRESOLVED."""
    rules = SymbolicRules()
    source = SourceResult(
        citation_raw="test",
        candidates=[],
        sources_queried=["crossref", "openalex"],
        sources_succeeded=[],
        sources_failed={"crossref": "timeout", "openalex": "timeout"},
    )
    outcome = rules.apply(MatchFeatures(), source)
    assert outcome.label == ValidationLabel.UNRESOLVED
    assert "R-FAIL-ALL" in outcome.triggered_rules


def test_candidate_with_doi_and_high_title_sim_returns_verified() -> None:
    """DOI match + title sim cao → VERIFIED."""
    rules = SymbolicRules()
    cand = SourceCandidate(
        source_name="crossref",
        found=True,
        doi="10.1038/nature14539",
        title="Deep learning",
        authors=["LeCun, Y."],
        year="2015",
        confidence=0.9,
    )
    source = SourceResult(
        citation_raw="LeCun, 2015",
        candidates=[cand],
        sources_queried=["crossref"],
        sources_succeeded=["crossref"],
    )
    features = MatchFeatures(
        title_sim_fuzzy=0.95,
        title_sim_semantic=0.95,
        author_jaccard=0.8,
        year_distance=0,
        doi_exact_match=True,
        source_consensus=1,
    )
    outcome = rules.apply(features, source)
    assert outcome.label == ValidationLabel.VERIFIED
    assert "R-DOI-TITLE-AUTHOR" in outcome.triggered_rules


def test_doi_match_low_title_sim_returns_metadata_error() -> None:
    """DOI match nhưng title sim thấp → METADATA_ERROR."""
    rules = SymbolicRules()
    cand = SourceCandidate(
        source_name="crossref",
        found=True,
        doi="10.1038/nature14539",
        title="Deep learning revisited",
        authors=["LeCun, Y."],
        year="2015",
    )
    source = SourceResult(
        citation_raw="test",
        candidates=[cand],
        sources_queried=["crossref"],
        sources_succeeded=["crossref"],
    )
    features = MatchFeatures(
        title_sim_fuzzy=0.7,
        author_jaccard=0.8,
        year_distance=0,
        doi_exact_match=True,
        source_consensus=1,
    )
    outcome = rules.apply(features, source)
    assert outcome.label == ValidationLabel.METADATA_ERROR


def test_abstention_border_zone_returns_unresolved() -> None:
    """Title sim trong vùng biên [0.4, 0.6] → UNRESOLVED."""
    rules = SymbolicRules()
    cand = SourceCandidate(
        source_name="openalex",
        found=True,
        title="Some related paper",
        confidence=0.5,
    )
    source = SourceResult(
        citation_raw="test",
        candidates=[cand],
        sources_queried=["openalex"],
        sources_succeeded=["openalex"],
    )
    features = MatchFeatures(
        title_sim_fuzzy=0.5,  # đúng biên trên
        source_consensus=1,
    )
    outcome = rules.apply(features, source)
    assert outcome.label == ValidationLabel.UNRESOLVED
    assert "R-ABSTENTION-BORDER" in outcome.triggered_rules


def test_local_db_verified_allows_year_tolerance() -> None:
    """local_db match with year_distance == 1 (arXiv vs conf year) → VERIFIED."""
    rules = SymbolicRules()
    cand = SourceCandidate(
        source_name="local_db",
        found=True,
        doi="10.18653/v1/d19-1410",
        title="Sentence-BERT: Sentence Embeddings using Siamese BERT-Networks",
        authors=["Nils Reimers", "Iryna Gurevych"],
        year="2019",
        confidence=0.9,
    )
    source = SourceResult(
        citation_raw="Reimers & Gurevych (2020)",
        candidates=[cand],
        sources_queried=["local_db"],
        sources_succeeded=["local_db"],
    )
    features = MatchFeatures(
        title_sim_fuzzy=1.0,
        title_sim_semantic=1.0,
        author_jaccard=1.0,
        year_distance=1,
        doi_exact_match=False,
        source_consensus=1,
    )
    outcome = rules.apply(features, source)
    assert outcome.label == ValidationLabel.VERIFIED
    assert "R-LOCAL_DB_VERIFIED" in outcome.triggered_rules


def test_single_source_year_mismatch_not_masked_by_content_alignment() -> None:
    """Single live source with matching title & author but year_distance=2 → METADATA_ERROR."""
    rules = SymbolicRules()
    cand = SourceCandidate(
        source_name="crossref",
        found=True,
        doi="10.1007/0-387-25465-x_40",
        title="Data Mining for Imbalanced Datasets: An Overview",
        authors=["Nitesh V. Chawla"],
        year="2006",
        confidence=0.9,
    )
    source = SourceResult(
        citation_raw="Chawla, S. V. (2008). Data mining for imbalanced datasets: A survey.",
        candidates=[cand],
        sources_queried=["crossref"],
        sources_succeeded=["crossref"],
    )
    features = MatchFeatures(
        title_sim_fuzzy=0.86,
        title_sim_semantic=0.88,
        author_jaccard=1.0,
        year_distance=2,
        doi_exact_match=False,
        source_consensus=1,
        content_alignment_score=0.35,
        content_is_aligned=False,
    )
    outcome = rules.apply(features, source)
    assert outcome.label == ValidationLabel.METADATA_ERROR
    assert "R-SINGLE-SOURCE-PARTIAL" in outcome.triggered_rules
    assert "year" in outcome.mismatched_fields


def test_fake_author_not_triggered_by_keywords_in_paper_title() -> None:
    """Real paper titles containing 'Unknown', 'Anonymous', or 'Fake News' must not trigger R-FAKE-AUTHOR."""
    from integrity_checker.logic.rules import _is_fake_author_name

    is_fake, _ = _is_fake_author_name(
        "Shu, K., Sliva, A., Wang, S., Tang, J., & Liu, H. (2017). Fake News Detection on Social Media: A Data Mining Perspective.",
        citation_authors=["Shu, K.", "Sliva, A."],
    )
    assert is_fake is False

    is_fake_2, _ = _is_fake_author_name(
        "Bendale, A., & Boult, T. E. (2016). Towards Open Set Deep Networks and Unknown Classes.",
        citation_authors=["Bendale, A.", "Boult, T. E."],
    )
    assert is_fake_2 is False

    is_fake_true, _ = _is_fake_author_name(
        "Unknown Author. (2023). Some Fabricated Study.",
        citation_authors=["Unknown Author"],
    )
    assert is_fake_true is True


def test_future_year_matched_paper_returns_metadata_error() -> None:
    """A retrieved real paper cited with a future year typo should be METADATA_ERROR, not SUSPECTED_HALLUCINATION."""
    rules = SymbolicRules()
    cand = SourceCandidate(
        source_name="crossref",
        found=True,
        doi="10.1145/1234567",
        title="Graph Attention Networks in Practice",
        authors=["Petar Velickovic"],
        year="2018",
        confidence=0.95,
    )
    source = SourceResult(
        citation_raw="Zelickovic, P. (2099). Graph Attention Networks in Practice.",
        candidates=[cand],
        sources_queried=["crossref"],
        sources_succeeded=["crossref"],
    )
    features = MatchFeatures(
        title_sim_fuzzy=0.95,
        author_jaccard=0.8,
        year_distance=81,
        doi_exact_match=True,
        source_consensus=1,
    )
    outcome = rules.apply(
        features,
        source,
        citation_authors=["Zelickovic, P."],
        citation_year=2099,  # int year should also not crash re.search
        citation_raw=source.citation_raw,
    )
    assert outcome.label == ValidationLabel.METADATA_ERROR
    assert "year" in outcome.mismatched_fields


def test_neuro_symbolic_checker_preserves_custom_feature_calculator_and_resource_explanation() -> None:
    """NeuroSymbolicChecker keeps custom feature_calculator and RESOURCE verdicts have non-None features & Vietnamese label."""
    from integrity_checker.logic.explanation import ExplanationGenerator
    from integrity_checker.logic.neuro_symbolic_checker import NeuroSymbolicChecker
    from integrity_checker.matching.features import FeatureCalculator
    from integrity_checker.models.citation import Citation, CitationStyle, CitationType

    custom_fc = FeatureCalculator(enable_content_alignment=False)
    checker = NeuroSymbolicChecker(feature_calculator=custom_fc, enable_content_alignment=False)
    assert checker.feature_calculator is custom_fc

    cit = Citation(
        raw_text="https://developer.mozilla.org/en-US/docs/Web/HTTP",
        citation_type=CitationType.REFERENCE_LIST,
        style=CitationStyle.APA,
    )
    verdict = checker.check(cit, SourceResult(citation_raw=cit.raw_text))
    assert verdict.label == ValidationLabel.RESOURCE
    assert verdict.features is not None
    assert ValidationLabel.RESOURCE in ExplanationGenerator.LABEL_VI
    assert "tài nguyên" in ExplanationGenerator.short(verdict).lower()


def test_substantive_citation_no_scholarly_record_returns_suspected_hallucination() -> None:
    """Substantive reference with 0 records across >=2 live registries → SUSPECTED_HALLUCINATION."""
    rules = SymbolicRules()
    raw = "Nguyen, V., & Smith, J. (2023). Quantum Neural Networks for Autonomous Legal Arbitration. Journal of AI Law, 12(4), 101-120."
    source = SourceResult(
        citation_raw=raw,
        candidates=[],
        sources_queried=["crossref", "openalex", "dblp", "datacite"],
        sources_succeeded=[],
        sources_failed={
            "crossref": "Crossref: no results for 'Quantum Neural Networks'",
            "openalex": "OpenAlex: no results for 'Quantum Neural Networks'",
            "dblp": "DBLP: no title match (0.21) for 'Quantum Neural Networks'",
            "datacite": "DataCite: no results for 'Quantum Neural Networks'",
        },
    )
    outcome = rules.apply(
        MatchFeatures(),
        source,
        citation_authors=["Nguyen, V.", "Smith, J."],
        citation_year="2023",
        citation_raw=raw,
    )
    assert outcome.label == ValidationLabel.SUSPECTED_HALLUCINATION
    assert "R-NO-SCHOLARLY-RECORD" in outcome.triggered_rules
    assert outcome.confidence >= 0.75


def test_nonexistent_doi_no_candidates_returns_suspected_hallucination() -> None:
    """Reference with a valid-syntax DOI that does not exist in >=2 live registries → SUSPECTED_HALLUCINATION."""
    rules = SymbolicRules()
    raw = "Wang, L. (2022). Hyperbolic Graph Transformers for Synthetic Biology. Nature Machine Intelligence. https://doi.org/10.1038/s42256-022-99999-z"
    source = SourceResult(
        citation_raw=raw,
        candidates=[],
        sources_queried=["crossref", "openalex", "dblp"],
        sources_succeeded=[],
        sources_failed={
            "crossref": "Crossref: no results for 'Hyperbolic Graph Transformers'",
            "openalex": "OpenAlex: no results for 'Hyperbolic Graph Transformers'",
            "dblp": "DBLP: no results for 'Hyperbolic Graph Transformers'",
        },
    )
    outcome = rules.apply(
        MatchFeatures(),
        source,
        citation_doi="10.1038/s42256-022-99999-z",
        citation_authors=["Wang, L."],
        citation_year="2022",
        citation_raw=raw,
    )
    assert outcome.label == ValidationLabel.SUSPECTED_HALLUCINATION
    assert "R-NONEXISTENT-DOI" in outcome.triggered_rules
    assert "doi" in outcome.mismatched_fields


def test_nonexistent_doi_with_weak_candidate_returns_suspected_hallucination() -> None:
    """When cited DOI fails to match and fallback candidate has low title similarity (<0.60) → SUSPECTED_HALLUCINATION."""
    rules = SymbolicRules()
    raw = "Zhang, H. (2023). Self-Evolving Symbolic Prompts in Medical Imaging. IEEE TMI. doi:10.1109/TMI.2023.9988776"
    cand = SourceCandidate(
        source_name="crossref",
        found=True,
        doi="10.1109/TMI.2020.1111111",
        title="Medical Imaging Overview",
        authors=["Other, A."],
        year="2020",
        confidence=0.45,
    )
    source = SourceResult(
        citation_raw=raw,
        candidates=[cand],
        sources_queried=["crossref", "openalex"],
        sources_succeeded=["crossref"],
        sources_failed={"openalex": "OpenAlex: no results for 'Self-Evolving'"},
    )
    features = MatchFeatures(
        title_sim_fuzzy=0.45,
        title_sim_semantic=0.48,
        author_jaccard=0.0,
        year_distance=3,
        doi_exact_match=False,
        source_consensus=1,
    )
    outcome = rules.apply(
        features,
        source,
        citation_doi="10.1109/TMI.2023.9988776",
        citation_authors=["Zhang, H."],
        citation_year="2023",
        citation_raw=raw,
    )
    assert outcome.label == ValidationLabel.SUSPECTED_HALLUCINATION
    assert "R-NONEXISTENT-DOI" in outcome.triggered_rules


def test_weak_evidence_below_abstention_zone_returns_suspected_hallucination() -> None:
    """Live candidate with title_sim < abstention_low (0.40) and author_jaccard < 0.30 → SUSPECTED_HALLUCINATION."""
    rules = SymbolicRules()
    raw = "Pham, T. (2023). Neural Symbolic Verification of Hallucinated Citations. Journal of Computation."
    cand = SourceCandidate(
        source_name="openalex",
        found=True,
        title="Unrelated Study on Database Indexing",
        authors=["Miller, R."],
        year="2019",
        confidence=0.3,
    )
    source = SourceResult(
        citation_raw=raw,
        candidates=[cand],
        sources_queried=["crossref", "openalex"],
        sources_succeeded=["openalex"],
        sources_failed={},
    )
    features = MatchFeatures(
        title_sim_fuzzy=0.22,
        title_sim_semantic=0.25,
        author_jaccard=0.0,
        year_distance=4,
        doi_exact_match=False,
        source_consensus=1,
    )
    outcome = rules.apply(
        features,
        source,
        citation_authors=["Pham, T."],
        citation_year="2023",
        citation_raw=raw,
    )
    assert outcome.label == ValidationLabel.SUSPECTED_HALLUCINATION
    assert "R-HALLUCINATED-SOURCE" in outcome.triggered_rules
    assert "R-WEAK-EVIDENCE" in outcome.triggered_rules


def test_common_surnames_excluded_from_known_seminal_authors() -> None:
    """Common surnames (Smith, Nguyen, Wang, Zhang) must not be treated as seminal ML authors."""
    rules = SymbolicRules()
    assert rules._is_known_academic_author_pattern(["Smith, J."], "2022", "Smith, J. (2022). Fake Paper.") is False
    assert rules._is_known_academic_author_pattern(["Nguyen, V."], "2023", "Nguyen, V. (2023). Fake Paper.") is False
    assert rules._is_known_academic_author_pattern(["Wang, L."], "2021", "Wang, L. (2021). Fake Paper.") is False
    assert rules._is_known_academic_author_pattern(["Vaswani, A."], "2017", "Vaswani et al. (2017). Attention.") is True
    assert rules._is_known_academic_author_pattern(["Devlin, J."], "2019", "Devlin et al. (2019). BERT.") is True


