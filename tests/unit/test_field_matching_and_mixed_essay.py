"""Regression tests for field-level matching accuracy and mixed essay edge cases.

Covers:
1. `_serialize_matched_sources` / `_build_matched_fields` comparing candidate metadata
   against the cited manuscript instead of blindly marking every non-empty candidate field
   as matched (which previously caused mismatched Venue & DOI to report 100% Match).
2. `SymbolicRules` flagging fabricated `10.9999/*` DOIs (`10.9999/jiar.2024.9999`) as
   `SUSPECTED_HALLUCINATION` (`R-FABRICATED-DOI`).
3. `SymbolicRules` flagging non-existent / conflicting DOIs with zero author overlap as
   `SUSPECTED_HALLUCINATION` (`R-NONEXISTENT-DOI`) even when topical buzzwords inflate
   semantic title similarity into the `[0.60, 0.85)` or `>= 0.85` band.
4. Guard: real paper with strong title + author match on a single live source where the
   cited DOI has a typo (`has_doi_conflict=True`) must be `METADATA_ERROR` (`['doi']`),
   never `SUSPECTED_HALLUCINATION` or `UNRESOLVED`.
5. Placeholder/bogus cited venue (e.g. `"Unknown Conference Proceedings"`) on a DOI-matched
   paper downgraded from `VERIFIED` to `METADATA_ERROR` (`R-VENUE-MISMATCH`).
"""

from __future__ import annotations

from integrity_checker.logic.rules import SymbolicRules
from integrity_checker.models.citation import Citation, CitationStyle, CitationType
from integrity_checker.models.source import SourceCandidate, SourceResult
from integrity_checker.models.validation import MatchFeatures, ValidationLabel
from integrity_checker.pipeline.integrity_pipeline import _serialize_matched_sources


def test_serialize_matched_sources_with_citation_excludes_mismatched_doi_venue_authors() -> None:
    """When `citation` is passed, `matched_fields` must only contain fields that match the citation."""
    cit = Citation(
        raw_text=(
            "Smith, J. Q., & Doe, R. K. (2024). A novel framework for hallucination "
            "detection in large language models. Journal of Imaginary AI Research, "
            "99(12), 1-25. https://doi.org/10.9999/jiar.2024.9999"
        ),
        citation_type=CitationType.REFERENCE_LIST,
        style=CitationStyle.APA,
        authors=["Smith, J. Q.", "Doe, R. K."],
        year=2024,
        title="A novel framework for hallucination detection in large language models",
        venue="Journal of Imaginary AI Research",
        doi="10.9999/jiar.2024.9999",
    )
    cand = SourceCandidate(
        source_name="openalex",
        found=True,
        doi="10.48550/arxiv.2401.06855",
        title="Fine-grained Hallucination Detection and Editing for Language Models",
        authors=[
            "Abhika Mishra",
            "Akari Asai",
            "Vidhisha Balachandran",
            "Yizhong Wang",
            "Graham Neubig",
            "Yulia Tsvetkov",
            "Hannaneh Hajishirzi",
        ],
        year="2024",
        venue="arXiv (Cornell University)",
        url="https://openalex.org/W4391013695",
        confidence=0.84,
    )
    sr = SourceResult(
        citation_raw=cit.raw_text,
        candidates=[cand],
        sources_queried=["openalex", "crossref", "doi_ra"],
        sources_succeeded=["openalex"],
    )

    serialized = _serialize_matched_sources(sr, citation=cit)
    assert len(serialized) == 1
    matched = serialized[0]["matched_fields"]
    assert "year" in matched
    assert "doi" not in matched
    assert "venue" not in matched
    assert "authors" not in matched


def test_serialize_matched_sources_with_authentic_matching_citation_marks_all_matched_fields() -> None:
    """Authentic paper matching DOI, title, authors, year, and venue includes all 5 fields."""
    cit = Citation(
        raw_text=(
            "He, K., Zhang, X., Ren, S., & Sun, J. (2016). Deep residual learning for image recognition. "
            "Proceedings of the IEEE Conference on Computer Vision and Pattern Recognition, 770-778. "
            "https://doi.org/10.1109/CVPR.2016.90"
        ),
        citation_type=CitationType.REFERENCE_LIST,
        style=CitationStyle.APA,
        authors=["He, K.", "Zhang, X.", "Ren, S.", "Sun, J."],
        year=2016,
        title="Deep residual learning for image recognition",
        venue="Proceedings of the IEEE Conference on Computer Vision and Pattern Recognition",
        doi="10.1109/CVPR.2016.90",
    )
    cand = SourceCandidate(
        source_name="crossref",
        found=True,
        doi="10.1109/cvpr.2016.90",
        title="Deep Residual Learning for Image Recognition",
        authors=["Kaiming He", "Xiangyu Zhang", "Shaoqing Ren", "Jian Sun"],
        year="2016",
        venue="2016 IEEE Conference on Computer Vision and Pattern Recognition (CVPR)",
        url="https://doi.org/10.1109/cvpr.2016.90",
        confidence=0.99,
    )
    sr = SourceResult(
        citation_raw=cit.raw_text,
        candidates=[cand],
        sources_queried=["crossref"],
        sources_succeeded=["crossref"],
    )

    serialized = _serialize_matched_sources(sr, citation=cit)
    assert set(serialized[0]["matched_fields"]) == {"doi", "title", "authors", "year", "venue"}


def test_fabricated_doi_10_9999_jiar_returns_suspected_hallucination() -> None:
    """`10.9999/jiar.2024.9999` (from `essay_02_mixed.pdf`) must trigger `R-FABRICATED-DOI`."""
    rules = SymbolicRules()
    sr = SourceResult(
        citation_raw="Smith, J. Q., & Doe, R. K. (2024). https://doi.org/10.9999/jiar.2024.9999",
        candidates=[],
        sources_queried=["crossref", "openalex", "doi_ra"],
        sources_succeeded=[],
        sources_failed={"doi_ra": "DOI RA: no results for DOI '10.9999/jiar.2024.9999' (DOI does not exist)"},
    )
    outcome = rules.apply(
        MatchFeatures(),
        sr,
        citation_doi="10.9999/jiar.2024.9999",
        citation_authors=["Smith, J. Q.", "Doe, R. K."],
        citation_year=2024,
    )
    assert outcome.label == ValidationLabel.SUSPECTED_HALLUCINATION
    assert "R-FABRICATED-DOI" in outcome.triggered_rules
    assert "doi" in outcome.mismatched_fields


def test_nonexistent_doi_with_buzzword_neighbor_and_zero_author_overlap_returns_suspected_hallucination() -> None:
    """Plausible-prefix nonexistent DOI + topical SBERT neighbor (~0.84) + 0 author overlap -> SUSPECTED_HALLUCINATION."""
    rules = SymbolicRules()
    raw = (
        "Smith, J. Q., & Doe, R. K. (2024). A novel framework for hallucination "
        "detection in large language models. Artificial Intelligence, 99(12), 1-25. "
        "https://doi.org/10.1016/j.artint.2024.999999"
    )
    cand = SourceCandidate(
        source_name="openalex",
        found=True,
        doi="10.48550/arxiv.2401.06855",
        title="Fine-grained Hallucination Detection and Editing for Language Models",
        authors=["Abhika Mishra", "Akari Asai", "Graham Neubig"],
        year="2024",
        venue="arXiv (Cornell University)",
        confidence=0.84,
    )
    sr = SourceResult(
        citation_raw=raw,
        candidates=[cand],
        sources_queried=["crossref", "openalex", "s2", "doi_ra"],
        sources_succeeded=["openalex"],
        sources_failed={
            "crossref": "Crossref: no results for DOI '10.1016/j.artint.2024.999999'",
            "doi_ra": "DOI RA: no results for DOI '10.1016/j.artint.2024.999999' (DOI does not exist)",
        },
    )
    feat = MatchFeatures(
        title_sim_fuzzy=0.783,
        title_sim_semantic=0.839,
        author_jaccard=0.0,
        year_distance=0,
        doi_exact_match=False,
        source_consensus=1,
        venue_sim=0.0,
    )
    feat.has_doi_conflict = True  # type: ignore[attr-defined]

    outcome = rules.apply(
        feat,
        sr,
        citation_doi="10.1016/j.artint.2024.999999",
        citation_authors=["Smith, J. Q.", "Doe, R. K."],
        citation_year=2024,
        citation_raw=raw,
        citation_venue="Artificial Intelligence",
        citation_title="A novel framework for hallucination detection in large language models",
    )
    assert outcome.label == ValidationLabel.SUSPECTED_HALLUCINATION
    assert "R-NONEXISTENT-DOI" in outcome.triggered_rules
    assert "doi" in outcome.mismatched_fields
    assert "author" in outcome.mismatched_fields


def test_single_source_real_paper_with_doi_typo_returns_metadata_error() -> None:
    """Real paper with matching title & authors on 1 live source + wrong DOI -> METADATA_ERROR (not UNRESOLVED/HALLUCINATION)."""
    rules = SymbolicRules()
    cand = SourceCandidate(
        source_name="crossref",
        found=True,
        doi="10.1038/nature14539",
        title="Deep learning",
        authors=["Yann LeCun", "Yoshua Bengio", "Geoffrey Hinton"],
        year="2015",
        venue="Nature",
        confidence=0.95,
    )
    sr = SourceResult(
        citation_raw="LeCun, Y., Bengio, Y., & Hinton, G. (2015). Deep learning. Nature. https://doi.org/10.1038/nature99999",
        candidates=[cand],
        sources_queried=["crossref", "openalex"],
        sources_succeeded=["crossref"],
    )
    feat = MatchFeatures(
        title_sim_fuzzy=0.98,
        title_sim_semantic=0.98,
        author_jaccard=1.0,
        year_distance=0,
        doi_exact_match=False,
        source_consensus=1,
        venue_sim=1.0,
    )
    feat.has_doi_conflict = True  # type: ignore[attr-defined]

    outcome = rules.apply(
        feat,
        sr,
        citation_doi="10.1038/nature99999",
        citation_authors=["LeCun, Y.", "Bengio, Y.", "Hinton, G."],
        citation_year=2015,
        citation_venue="Nature",
        citation_title="Deep learning",
    )
    assert outcome.label == ValidationLabel.METADATA_ERROR
    assert "doi" in outcome.mismatched_fields
    assert "R-DOI-CONFLICT" in outcome.triggered_rules


def test_placeholder_bogus_venue_on_doi_match_downgraded_to_metadata_error() -> None:
    """`Devlin et al. (2018)` with `'Unknown Conference Proceedings'` + `10.18653/v1/N19-1423` -> METADATA_ERROR."""
    rules = SymbolicRules()
    raw = (
        "Devlin, J., Chang, M.-W., Lee, K., & Toutanova, K. (2018). "
        "BERT: Pre-training of deep bidirectional transformers for language understanding. "
        "Unknown Conference Proceedings, 4171-4186. https://doi.org/10.18653/v1/N19-1423"
    )
    cand = SourceCandidate(
        source_name="openalex",
        found=True,
        doi="10.18653/v1/n19-1423",
        title="BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding",
        authors=["Jacob Devlin", "Ming-Wei Chang", "Kenton Lee", "Kristina Toutanova"],
        year="2019",
        venue="Conference of the North American Chapter of the Association for Computational Linguistics: Human Language Technologies",
        confidence=0.99,
    )
    sr = SourceResult(
        citation_raw=raw,
        candidates=[cand],
        sources_queried=["openalex", "crossref"],
        sources_succeeded=["openalex", "crossref"],
    )
    feat = MatchFeatures(
        title_sim_fuzzy=1.0,
        title_sim_semantic=1.0,
        author_jaccard=1.0,
        year_distance=1,
        doi_exact_match=True,
        source_consensus=2,
        venue_sim=0.0833,
    )

    outcome = rules.apply(
        feat,
        sr,
        citation_doi="10.18653/v1/N19-1423",
        citation_authors=["Devlin, J.", "Chang, M.-W.", "Lee, K.", "Toutanova, K."],
        citation_year=2018,
        citation_raw=raw,
        citation_venue="Unknown Conference Proceedings",
        citation_title="BERT: Pre-training of deep bidirectional transformers for language understanding",
    )
    assert outcome.label == ValidationLabel.METADATA_ERROR
    assert "R-VENUE-MISMATCH" in outcome.triggered_rules
    assert "venue" in outcome.mismatched_fields
    assert "year" in outcome.mismatched_fields


def test_serialize_matched_sources_excludes_verdict_mismatched_fields_and_web_html_mismatch() -> None:
    """`matched_fields` must never overlap `mismatched_fields`, and `web_html_meta` must compare against `citation`."""
    from types import SimpleNamespace

    cit = Citation(
        raw_text=(
            "Kowalski, M., & Vandenberg, L. (2017). Hyperbolic quantum graph topology "
            "for autonomous underwater swarm navigation. Journal of Subsea Robotics, 14(2), "
            "112-124. https://doi.org/10.1109/CVPR.2016.90"
        ),
        citation_type=CitationType.REFERENCE_LIST,
        style=CitationStyle.APA,
        authors=["Kowalski, M.", "Vandenberg, L."],
        year=2017,
        title="Hyperbolic quantum graph topology for autonomous underwater swarm navigation",
        venue="Journal of Subsea Robotics",
        doi="10.1109/CVPR.2016.90",
    )
    cand = SourceCandidate(
        source_name="crossref",
        found=True,
        doi="10.1109/cvpr.2016.90",
        title="Deep Residual Learning for Image Recognition",
        authors=["Kaiming He", "Xiangyu Zhang", "Shaoqing Ren", "Jian Sun"],
        year="2016",
        venue="2016 IEEE Conference on Computer Vision and Pattern Recognition (CVPR)",
        confidence=0.95,
    )
    sr = SourceResult(
        citation_raw=cit.raw_text,
        candidates=[cand],
        sources_queried=["crossref"],
        sources_succeeded=["crossref"],
    )
    serialized = _serialize_matched_sources(
        sr,
        citation=cit,
        mismatched_fields=["doi", "title", "author"],
    )
    assert "doi" not in serialized[0]["matched_fields"]
    assert "title" not in serialized[0]["matched_fields"]
    assert "authors" not in serialized[0]["matched_fields"]

    # Web HTML metadata fallback with mismatched page title/site_name
    web_cit = Citation(
        raw_text="Claimed AI Safety Paper (2025). Journal of AI Safety. https://example.org/wrong",
        citation_type=CitationType.REFERENCE_LIST,
        style=CitationStyle.APA,
        title="Claimed AI Safety Paper",
        venue="Journal of AI Safety",
        year=2025,
        url="https://example.org/wrong",
    )
    web_sr = SourceResult(
        citation_raw=web_cit.raw_text,
        candidates=[],
        url_status="alive",
        html_meta=SimpleNamespace(
            page_title="Cooking Pasta Blog Landing Page",
            citation_title=None,
            citation_authors=[],
            published_year=None,
            site_name="Foodie World",
            citation_doi=None,
            canonical_url="https://example.org/wrong",
            is_soft_404=False,
        ),
    )
    web_serialized = _serialize_matched_sources(
        web_sr,
        citation=web_cit,
        mismatched_fields=["url", "title"],
    )
    assert len(web_serialized) == 1
    assert "title" not in web_serialized[0]["matched_fields"]
    assert "venue" not in web_serialized[0]["matched_fields"]


def test_known_paper_with_conflicting_doi_returns_metadata_error_not_verified() -> None:
    """1-digit DOI typo on a known seminal paper (`nature14538` vs `nature14539`) must NOT be `VERIFIED`."""
    from integrity_checker.logic.neuro_symbolic_checker import NeuroSymbolicChecker

    checker = NeuroSymbolicChecker(enable_content_alignment=False)
    cit = Citation(
        raw_text=(
            "LeCun, Y., Bengio, Y., & Hinton, G. (2015). Deep learning. "
            "Nature, 521(7553), 436-444. https://doi.org/10.1038/nature14538"
        ),
        citation_type=CitationType.REFERENCE_LIST,
        style=CitationStyle.APA,
        authors=["LeCun, Y.", "Bengio, Y.", "Hinton, G."],
        year=2015,
        title="Deep learning",
        venue="Nature",
        doi="10.1038/nature14538",
    )
    sr = SourceResult(
        citation_raw=cit.raw_text,
        candidates=[],
        sources_queried=["crossref", "openalex"],
        sources_succeeded=[],
    )
    verdict = checker.check(cit, sr)
    assert verdict.label == ValidationLabel.METADATA_ERROR
    assert "doi" in verdict.mismatched_fields
    assert "R-DOI-CONFLICT" in verdict.triggered_rules


def test_known_paper_and_rules_with_unrelated_non_preprint_venue_returns_metadata_error() -> None:
    """Citing BERT (`NAACL`) in `'International Journal of Quantum Chemistry'` must return `METADATA_ERROR`."""
    from integrity_checker.logic.neuro_symbolic_checker import NeuroSymbolicChecker

    checker = NeuroSymbolicChecker(enable_content_alignment=False)
    cit = Citation(
        raw_text=(
            "Devlin, J., Chang, M. W., Lee, K., & Toutanova, K. (2019). "
            "BERT: Pre-training of deep bidirectional transformers for language understanding. "
            "International Journal of Quantum Chemistry, 119(4), 4171-4186. "
            "https://doi.org/10.18653/v1/N19-1423"
        ),
        citation_type=CitationType.REFERENCE_LIST,
        style=CitationStyle.APA,
        authors=["Devlin, J.", "Chang, M. W.", "Lee, K.", "Toutanova, K."],
        year=2019,
        title="BERT: Pre-training of deep bidirectional transformers for language understanding",
        venue="International Journal of Quantum Chemistry",
        doi="10.18653/v1/N19-1423",
    )
    cand = SourceCandidate(
        source_name="openalex",
        found=True,
        doi="10.18653/v1/n19-1423",
        title="BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding",
        authors=["Jacob Devlin", "Ming-Wei Chang", "Kenton Lee", "Kristina Toutanova"],
        year="2019",
        venue="Conference of the North American Chapter of the Association for Computational Linguistics: Human Language Technologies (NAACL-HLT)",
        confidence=0.99,
    )
    sr = SourceResult(
        citation_raw=cit.raw_text,
        candidates=[cand],
        sources_queried=["openalex", "crossref"],
        sources_succeeded=["openalex", "crossref"],
    )
    verdict = checker.check(cit, sr)
    assert verdict.label == ValidationLabel.METADATA_ERROR
    assert "venue" in verdict.mismatched_fields
    assert "R-VENUE-MISMATCH" in verdict.triggered_rules


def test_buzzword_hallucination_with_subset_token_set_sim_conflicting_doi_zero_author_zero_venue_is_hallucination() -> None:
    """High token_set_ratio (~0.93) from subset buzzwords + conflicting DOI + 0% authors + 0% venue -> SUSPECTED_HALLUCINATION."""
    rules = SymbolicRules()
    raw = (
        "Patel, S. K., & O'Connor, D. J. (2024). Fine-grained factual consistency "
        "evaluation in abstractive summarization with large language models. "
        "Artificial Intelligence, 335, 109999. https://doi.org/10.1016/j.artint.2024.999999"
    )
    cand = SourceCandidate(
        source_name="openalex",
        found=True,
        doi="10.1016/j.eswa.2024.124456",
        title="Factual consistency evaluation of summarization in the Era of large language models",
        authors=["Wei Zhang", "Lin Chen"],
        year="2024",
        venue="Expert Systems with Applications",
        confidence=0.88,
    )
    sr = SourceResult(
        citation_raw=raw,
        candidates=[cand],
        sources_queried=["crossref", "openalex", "s2", "doi_ra"],
        sources_succeeded=["openalex", "s2"],
        sources_failed={
            "doi_ra": "DOI RA: no results for DOI '10.1016/j.artint.2024.999999' (DOI does not exist)"
        },
    )
    feat = MatchFeatures(
        title_sim_fuzzy=0.93,
        title_sim_semantic=0.89,
        author_jaccard=0.0,
        year_distance=0,
        doi_exact_match=False,
        source_consensus=2,
        venue_sim=0.0,
    )
    feat.has_doi_conflict = True  # type: ignore[attr-defined]

    outcome = rules.apply(
        feat,
        sr,
        citation_doi="10.1016/j.artint.2024.999999",
        citation_authors=["Patel, S. K.", "O'Connor, D. J."],
        citation_year=2024,
        citation_raw=raw,
        citation_venue="Artificial Intelligence",
        citation_title="Fine-grained factual consistency evaluation in abstractive summarization with large language models",
    )
    assert outcome.label == ValidationLabel.SUSPECTED_HALLUCINATION
    assert "doi" in outcome.mismatched_fields
    assert "author" in outcome.mismatched_fields


def test_nature_book_with_publisher_in_citation_venue_classified_as_unresolved_not_hallucination() -> None:
    """Nature-style book where publisher (`Oxford University Press`) is in `citation_venue` -> `UNRESOLVED`."""
    rules = SymbolicRules()
    sr = SourceResult(
        citation_raw="Lindqvist, K, Sorensen, S (2021) Regional monograph on computational linguistics and Baltic syntax",
        candidates=[],
        sources_queried=["crossref", "openalex", "s2", "openlibrary"],
        sources_succeeded=[],
    )
    outcome = rules.apply(
        MatchFeatures(),
        sr,
        citation_authors=["Lindqvist, K", "Sorensen, S"],
        citation_year=2021,
        citation_raw=sr.citation_raw,
        citation_venue="Oxford University Press",
        citation_title="Regional monograph on computational linguistics and Baltic syntax",
    )
    assert outcome.label == ValidationLabel.UNRESOLVED
    assert "R-UNINDEXED-BOOK-OR-SOURCE" in outcome.triggered_rules


def test_reference_parser_preserves_repeated_wrapped_venue_and_page_range_lines() -> None:
    """Repeated wrapped conference/page lines across 2 references on the same page must not be stripped as running headers."""
    from integrity_checker.extraction.reference_parser import ReferenceListParser

    bib_text = (
        "References\n"
        "Sutskever, I., Vinyals, O., & Le, Q. V. (2016). Deep residual learning for image recognition. Proceedings of the\n"
        "IEEE Conference on Computer Vision and Pattern Recognition, 770-778.\n"
        "https://doi.org/10.1109/CVPR.2016.90\n"
        "He, K., Zhang, X., Ren, S., & Sun, J. (2020). Deep residual learning for image recognition. Proceedings of the\n"
        "IEEE Conference on Computer Vision and Pattern Recognition, 770-778.\n"
        "https://doi.org/10.1109/CVPR.2016.90\n"
    )
    refs = ReferenceListParser().parse_reference_section(bib_text, page_num=2)
    assert len(refs) == 2
    for r in refs:
        assert "Computer Vision and Pattern Recognition" in (r.venue or "")
        assert "Computer Vision and Pattern Recognition" in r.raw_text


def test_document_parser_repairs_grobid_acs_semicolon_coauthor_title_bleed() -> None:
    """When GROBID misparses an ACS semicolon co-author (`; Sorensen, S`) as `title` and shifts the book title into `venue`, `_merge_reference_lists` must restore regex `title` and publisher `venue`."""
    from integrity_checker.extraction.document_parser import DocumentParser
    from integrity_checker.extraction.reference_parser import ReferenceListParser

    dp = DocumentParser()
    raw_acs = (
        "(5) Lindqvist, K.; Sorensen, S. Regional monograph on computational linguistics "
        "and Baltic syntax; Oxford University Press: Oxford, 2021."
    )
    regex_refs = ReferenceListParser().parse_reference_section("References\n" + raw_acs, page_num=2)
    assert len(regex_refs) == 1

    grobid_corrupted = Citation(
        raw_text="Lindqvist, K, Sorensen, S (2021) ; Sorensen, S Regional monograph on computational linguistics and Baltic syntax",
        citation_type=CitationType.REFERENCE_LIST,
        authors=["Lindqvist, K", "Sorensen, S"],
        year=2021,
        title="; Sorensen, S",
        venue="Regional monograph on computational linguistics and Baltic syntax",
        numeric_index=5,
        source="grobid",
    )
    merged = dp._merge_reference_lists([grobid_corrupted], regex_refs)
    assert len(merged) == 1
    assert merged[0].title == "Regional monograph on computational linguistics and Baltic syntax"
    assert "Oxford University Press" in (merged[0].venue or "")


