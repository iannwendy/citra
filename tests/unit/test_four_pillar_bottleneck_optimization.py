"""Unit and zero-regression boundary tests for the 4-Pillar Bottleneck Optimization.

Covers:
1. Pillar 1: Rule ordering (`R-DOMAIN-EXCEPTION` above `R-ABSTENTION-BORDER`),
   strong author-consensus corrupted-title routing (`R-AUTHOR-CONSENSUS-TITLE-CORRUPTION`),
   compound partial-author + year discrepancy (`Rule 4a2`), and preserving `U1/U2` grey-zone abstention.
2. Pillar 2A: `SemanticMatcher.calibrate_monolingual_specificity` (Hybrid Bi-Encoder +
   Distinctive Lexical/Entity Specificity Gate) + `Rule 3b` / `R-CONTENT-MISMATCH` routing,
   preserving cross-lingual VI<->EN alignment and genuine paraphrases.
3. Pillar 3: Same-domain spliced chimeric DOI (`R-CHIMERIC-DOI-MISMATCH`) with zero author overlap,
   `R-DEAD-URL` link-rot protection on multi-source real works, and `is_partial_author_grey_zone`
   fabrication guards.
4. Pillar 4: Multidisciplinary & biomedical canonical venue abbreviations (`BMJ`, `JAMA`, `PLOS ONE`,
   `Nucleic Acids Research`, `Cell`, etc.) + `R-VENUE-MISMATCH` when only broad field umbrellas overlap.
"""

from __future__ import annotations

from integrity_checker.logic.neuro_symbolic_checker import NeuroSymbolicChecker
from integrity_checker.logic.rules import SymbolicRules
from integrity_checker.matching.semantic import SemanticMatcher
from integrity_checker.matching.venue_normalizer import VenueNormalizer
from integrity_checker.models.citation import Citation, CitationStyle, CitationType
from integrity_checker.models.source import SourceCandidate, SourceResult
from integrity_checker.models.validation import MatchFeatures, ValidationLabel


class TestPillar1RuleOrderingAndConsensusBorder:
    """Pillar 1: Fix R-DOMAIN-EXCEPTION shadowing & strong author-year consensus border routing."""

    def test_doi_match_in_border_zone_triggers_domain_exception_not_unresolved(self) -> None:
        """Exact DOI match with 0.40 <= title_sim < 0.60 and consensus >= 2 must be METADATA_ERROR, not UNRESOLVED."""
        rules = SymbolicRules()
        cand = SourceCandidate(
            source_name="crossref",
            found=True,
            doi="10.18653/v1/2021.acl-long.120",
            title="Cross-Lingual Transfer for Low-Resource Dependency Parsing",
            authors=["Chen, W.", "Liu, Y."],
            year="2021",
            confidence=0.95,
        )
        source = SourceResult(
            citation_raw="Chen, W., & Liu, Y. (2021). Cross-Lingual Transfer for Neural Graph Decoding. ACL.",
            candidates=[cand],
            sources_queried=["crossref", "openalex"],
            sources_succeeded=["crossref", "openalex"],
            url_status="dead_link",
            url_status_code=404,
        )
        features = MatchFeatures(
            title_sim_fuzzy=0.55,
            title_sim_semantic=0.48,
            author_jaccard=1.0,
            year_distance=0,
            doi_exact_match=True,
            source_consensus=2,
        )
        outcome = rules.apply(
            features,
            source,
            citation_doi="10.18653/v1/2021.acl-long.120",
            citation_authors=["Chen, W.", "Liu, Y."],
            citation_year=2021,
            citation_raw=source.citation_raw,
        )
        assert outcome.label == ValidationLabel.METADATA_ERROR
        assert "R-DOMAIN-EXCEPTION" in outcome.triggered_rules

    def test_strong_multi_author_match_in_border_zone_routes_to_metadata_error(self) -> None:
        """When multi-author list matches strongly (author_jaccard >= 0.75) and year matches,
        corrupted title in [0.42, 0.60) on a live scholarly source is METADATA_ERROR, not UNRESOLVED."""
        rules = SymbolicRules()
        cand = SourceCandidate(
            source_name="openalex",
            found=True,
            title="Hierarchical Attention Networks for Document Classification",
            authors=["Yang, Z.", "Yang, D.", "Dyer, C."],
            year="2016",
            confidence=0.88,
        )
        source = SourceResult(
            citation_raw="Yang, Z., Yang, D., & Dyer, C. (2016). Hierarchical Attention for Neural Sequence Tagging. NAACL.",
            candidates=[cand],
            sources_queried=["crossref", "openalex"],
            sources_succeeded=["openalex", "crossref"],
        )
        features = MatchFeatures(
            title_sim_fuzzy=0.56,
            title_sim_semantic=0.46,
            author_jaccard=1.0,
            year_distance=0,
            doi_exact_match=False,
            source_consensus=2,
        )
        outcome = rules.apply(
            features,
            source,
            citation_authors=["Yang, Z.", "Yang, D.", "Dyer, C."],
            citation_year=2016,
            citation_raw=source.citation_raw,
        )
        assert outcome.label == ValidationLabel.METADATA_ERROR
        assert "R-TITLE-MISMATCH" in outcome.triggered_rules
        assert "title" in outcome.mismatched_fields

    def test_compound_lead_author_and_year_drift_in_rule_4a2_routes_to_metadata_error(self) -> None:
        """Compound M5 discrepancy (0.60 <= title_sim < 0.85, lead author match aj=0.20, year_dist=3)
        must be caught as METADATA_ERROR by Rule 4a2 rather than falling through to R-WEAK-EVIDENCE."""
        rules = SymbolicRules()
        cand = SourceCandidate(
            source_name="crossref",
            found=True,
            title="Contextualized Word Representations for Named Entity Recognition",
            authors=["Peters, M.", "Neumann, M.", "Iyyer, M."],
            year="2018",
            confidence=0.85,
        )
        source = SourceResult(
            citation_raw="Peters, M., Gomez, A., & Patel, R. (2021). Contextualized Word Representations for Entity Linking.",
            candidates=[cand],
            sources_queried=["crossref", "openalex"],
            sources_succeeded=["crossref"],
            url_status="dead_link",
            url_status_code=404,
        )
        features = MatchFeatures(
            title_sim_fuzzy=0.72,
            title_sim_semantic=0.61,
            author_jaccard=0.20,
            year_distance=3,
            doi_exact_match=False,
            source_consensus=1,
        )
        outcome = rules.apply(
            features,
            source,
            citation_authors=["Peters, M.", "Gomez, A.", "Patel, R."],
            citation_year=2021,
            citation_raw=source.citation_raw,
        )
        assert outcome.label == ValidationLabel.METADATA_ERROR
        assert "R-SINGLE-SOURCE-PARTIAL" in outcome.triggered_rules

    def test_partial_author_grey_zone_u1_still_abstains_to_unresolved(self) -> None:
        """Safety invariant: U1 partial-author preprint (author_jaccard=0.33, title_sim=0.46) must stay UNRESOLVED."""
        rules = SymbolicRules()
        cand = SourceCandidate(
            source_name="openalex",
            found=True,
            title="Self-Supervised Contrastive Representation Learning for Speech",
            authors=["Baevski, A.", "Zhou, Y.", "Mohamed, A."],
            year="2020",
            confidence=0.72,
        )
        source = SourceResult(
            citation_raw="Baevski, A., & Collaborator, R. (2020). Self-Guided Contrastive Embeddings: Preliminary Preprint Notes.",
            candidates=[cand],
            sources_queried=["crossref", "openalex"],
            sources_succeeded=["openalex"],
        )
        features = MatchFeatures(
            title_sim_fuzzy=0.45,
            title_sim_semantic=0.48,
            author_jaccard=0.25,
            year_distance=0,
            doi_exact_match=False,
            source_consensus=1,
        )
        outcome = rules.apply(
            features,
            source,
            citation_authors=["Baevski, A.", "Collaborator, R."],
            citation_year=2020,
            citation_raw=source.citation_raw,
        )
        assert outcome.label == ValidationLabel.UNRESOLVED
        assert "R-ABSTENTION-BORDER" in outcome.triggered_rules


class TestPillar2ASpecificityGateAndContentMismatch:
    """Pillar 2A: Hybrid Bi-Encoder + Distinctive Lexical/Entity Specificity Gate."""

    def test_topic_anchored_misattributed_claim_downgraded_by_specificity_gate(self) -> None:
        """When citing sentence echoes title topic but predicates an unrelated paper's specific claim,
        calibrate_monolingual_specificity downgrades borderline cosine (0.50..0.67) to misaligned."""
        cited_ctx = (
            "Regarding Neural Machine Translation, our graph convolutional message-passing "
            "operator achieves 83.5% node classification accuracy on the Cora citation network."
        )
        src_title = "Neural Machine Translation by Jointly Learning to Align and Translate"
        src_abs = (
            "We conjecture that the use of a fixed-length vector is a bottleneck in improving "
            "the performance of this basic encoder-decoder architecture for English-to-French translation."
        )
        adj_sim, conf, aligned = SemanticMatcher.calibrate_monolingual_specificity(
            raw_sim=0.63,
            cited_context=cited_ctx,
            source_title=src_title,
            source_abstract=src_abs,
            is_cross_lingual=False,
        )
        assert aligned is False
        assert adj_sim < 0.50
        assert conf == "medium"

    def test_genuine_same_paper_claim_and_cross_lingual_preserved(self) -> None:
        """Safety invariant: Genuine abstract paraphrase and cross-lingual VI<->EN pairs remain aligned."""
        cited_ctx = (
            "Fixed-length context vectors bottleneck encoder-decoder models on English-to-French "
            "machine translation sentences."
        )
        src_title = "Neural Machine Translation by Jointly Learning to Align and Translate"
        src_abs = (
            "We conjecture that the use of a fixed-length vector is a bottleneck in improving "
            "the performance of this basic encoder-decoder architecture for English-to-French translation."
        )
        adj_sim, conf, aligned = SemanticMatcher.calibrate_monolingual_specificity(
            raw_sim=0.62,
            cited_context=cited_ctx,
            source_title=src_title,
            source_abstract=src_abs,
            is_cross_lingual=False,
        )
        assert aligned is True
        assert adj_sim >= 0.60
        assert conf == "medium"

        # Cross-lingual VI -> EN must never be penalized by monolingual stem gate
        xl_sim, _, xl_aligned = SemanticMatcher.calibrate_monolingual_specificity(
            raw_sim=0.58,
            cited_context="Cơ chế chú ý giúp cải thiện dịch máy thần kinh trên câu dài.",
            source_title=src_title,
            source_abstract=src_abs,
            is_cross_lingual=True,
        )
        assert xl_aligned is True
        assert xl_sim == 0.58

    def test_single_source_high_title_misaligned_context_triggers_content_mismatch(self) -> None:
        """Rule 3b (R-SINGLE-SOURCE-VERIFIED) must not short-circuit past explicit content misalignment,
        and low content_alignment_score (e.g. 0.22) on an exact-title live paper must return METADATA_ERROR."""
        rules = SymbolicRules()
        cand = SourceCandidate(
            source_name="openalex",
            found=True,
            title="Attention Is All You Need",
            authors=["Vaswani, A.", "Shazeer, N."],
            year="2017",
            abstract="We propose the Transformer, based solely on attention mechanisms.",
            confidence=0.95,
        )
        source = SourceResult(
            citation_raw="Vaswani, A., & Shazeer, N. (2017). Attention Is All You Need. NeurIPS.",
            candidates=[cand],
            sources_queried=["openalex"],
            sources_succeeded=["openalex"],
        )
        features = MatchFeatures(
            title_sim_fuzzy=1.0,
            title_sim_semantic=1.0,
            author_jaccard=1.0,
            year_distance=0,
            doi_exact_match=False,
            source_consensus=1,
            content_alignment_score=0.22,
            content_alignment_confidence="low",
            content_is_aligned=False,
        )
        outcome = rules.apply(
            features,
            source,
            citation_authors=["Vaswani, A.", "Shazeer, N."],
            citation_year=2017,
            citation_raw=source.citation_raw,
        )
        assert outcome.label == ValidationLabel.METADATA_ERROR
        assert "R-CONTENT-MISMATCH" in outcome.triggered_rules
        assert "content" in outcome.mismatched_fields


class TestPillar3ChimericDoiAndLinkRotGuards:
    """Pillar 3: Same-domain spliced chimeric DOIs & link-rot protection on real consensus works."""

    def test_same_domain_chimeric_spliced_doi_caught_despite_moderate_semantic_sim(self) -> None:
        """Exact DOI resolving to an unrelated same-domain NLP paper with zero author overlap and
        zero content-word overlap must trigger R-CHIMERIC-DOI-MISMATCH even when semantic_sim is ~0.50."""
        rules = SymbolicRules()
        cand = SourceCandidate(
            source_name="crossref",
            found=True,
            doi="10.18653/v1/2020.emnlp-main.400",
            title="Unsupervised Commonsense Question Answering with Self-Talk",
            authors=["Shwartz, V.", "West, P.", "Le Bras, R.", "Bhagavatula, C.", "Choi, Y."],
            year="2020",
            venue="EMNLP",
            confidence=0.98,
        )
        raw = (
            "Morales, D., & Lindqvist, K. (2020). Bilingual Dependency Parsing for Low-Resource Dialects. "
            "Computational Linguistics, 46(2), 101-125. https://doi.org/10.18653/v1/2020.emnlp-main.400"
        )
        source = SourceResult(
            citation_raw=raw,
            candidates=[cand],
            sources_queried=["crossref", "openalex"],
            sources_succeeded=["crossref"],
        )
        features = MatchFeatures(
            title_sim_fuzzy=0.28,
            title_sim_semantic=0.51,
            author_jaccard=0.0,
            year_distance=0,
            doi_exact_match=True,
            source_consensus=1,
            venue_sim=0.10,
        )
        outcome = rules.apply(
            features,
            source,
            citation_doi="10.18653/v1/2020.emnlp-main.400",
            citation_authors=["Morales, D.", "Lindqvist, K."],
            citation_year=2020,
            citation_venue="Computational Linguistics",
            citation_raw=raw,
        )
        assert outcome.label == ValidationLabel.SUSPECTED_HALLUCINATION
        assert "R-CHIMERIC-DOI-MISMATCH" in outcome.triggered_rules

    def test_dead_url_on_multi_source_matching_author_work_routes_to_metadata_error(self) -> None:
        """Link rot (HTTP 404) on a multi-registry work with matching authors and moderate title
        discrepancy (M5) should be METADATA_ERROR, not SUSPECTED_HALLUCINATION."""
        rules = SymbolicRules()
        cand = SourceCandidate(
            source_name="crossref",
            found=True,
            title="Discriminative Reranking for Natural Language Parsing",
            authors=["Collins, M.", "Koo, T."],
            year="2005",
            confidence=0.90,
        )
        raw = (
            "Collins, M., & Koo, T. (2006). Discriminative Reranking for Syntactic Graph Models. "
            "https://old-university-page.edu/~collins/reranking.pdf"
        )
        source = SourceResult(
            citation_raw=raw,
            candidates=[cand],
            sources_queried=["crossref", "openalex", "dblp"],
            sources_succeeded=["crossref", "openalex"],
            url_status="dead_link",
            url_status_code=404,
        )
        features = MatchFeatures(
            title_sim_fuzzy=0.58,
            title_sim_semantic=0.49,
            author_jaccard=1.0,
            year_distance=1,
            doi_exact_match=False,
            source_consensus=2,
        )
        outcome = rules.apply(
            features,
            source,
            citation_url="https://old-university-page.edu/~collins/reranking.pdf",
            citation_authors=["Collins, M.", "Koo, T."],
            citation_year=2006,
            citation_raw=raw,
        )
        assert outcome.label == ValidationLabel.METADATA_ERROR


class TestPillar4BiomedicalVenueNormalization:
    """Pillar 4: Biomedical & multidisciplinary canonical acronyms (BMJ, JAMA, PLOS ONE, etc.)."""

    def test_venue_normalizer_recognizes_bmj_jama_and_medical_acronyms(self) -> None:
        vn = VenueNormalizer()
        assert vn.similarity("BMJ", "British Medical Journal") == 1.0
        assert vn.similarity("The BMJ", "British Medical Journal") == 1.0
        assert vn.similarity("JAMA", "Journal of the American Medical Association") == 1.0
        assert vn.similarity("NAR", "Nucleic Acids Research") == 1.0
        assert vn.similarity("IEEE Trans. Med. Imaging", "IEEE Transactions on Medical Imaging") >= 0.75

    def test_e2e_031_bmj_swapped_to_ieee_transactions_on_medical_imaging_triggers_venue_mismatch(self) -> None:
        """Swapping BMJ ('British Medical Journal') to 'IEEE Transactions on Medical Imaging' on
        CONSORT 2010 (doi:10.1136/bmj.c332) must trigger R-VENUE-MISMATCH -> METADATA_ERROR."""
        checker = NeuroSymbolicChecker(enable_content_alignment=False, enable_calibration=False)
        raw = (
            'Schulz, Kenneth F., Douglas G. Altman, and David Moher. 2010. '
            '"CONSORT 2010 Statement: Updated Guidelines for Reporting Parallel Group Randomised Trials." '
            "IEEE Transactions on Medical Imaging 340: c332. https://doi.org/10.1136/bmj.c332."
        )
        cit = Citation(
            raw_text=raw,
            authors=["Schulz, Kenneth F.", "Altman, Douglas G.", "Moher, David"],
            year=2010,
            title="CONSORT 2010 Statement: Updated Guidelines for Reporting Parallel Group Randomised Trials",
            venue="IEEE Transactions on Medical Imaging",
            doi="10.1136/bmj.c332",
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.CHICAGO,
        )
        cand = SourceCandidate(
            source_name="crossref",
            found=True,
            doi="10.1136/bmj.c332",
            title="CONSORT 2010 Statement: updated guidelines for reporting parallel group randomised trials",
            authors=["Kenneth F Schulz", "Douglas G Altman", "David Moher"],
            year=2010,
            venue="BMJ",
            confidence=0.99,
            score=0.99,
        )
        src = SourceResult(
            citation_raw=raw,
            candidates=[cand],
            sources_queried=["crossref", "openalex"],
            sources_succeeded=["crossref", "openalex"],
        )
        verdict = checker.check(cit, src)
        assert verdict.label == ValidationLabel.METADATA_ERROR
        assert "R-VENUE-MISMATCH" in verdict.triggered_rules
        assert "venue" in verdict.mismatched_fields
