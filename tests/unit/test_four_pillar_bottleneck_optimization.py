"""Unit and zero-regression boundary tests for the 4-Pillar Bottleneck Optimization.

Covers:
1. Pillar 1: Rule ordering (`R-DOMAIN-EXCEPTION` above `R-ABSTENTION-BORDER`),
   strong author-consensus corrupted-title routing (`R-TITLE-MISMATCH`),
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

from integrity_checker.evaluation.baselines import BaselineRunner
from integrity_checker.linking.statuses import CitationMappingStatus
from integrity_checker.logic.calibration import HybridMLScorer
from integrity_checker.logic.neuro_symbolic_checker import NeuroSymbolicChecker
from integrity_checker.logic.rules import SymbolicRules
from integrity_checker.matching.features import FeatureCalculator
from integrity_checker.matching.semantic import SemanticMatcher
from integrity_checker.matching.venue_normalizer import VenueNormalizer
from integrity_checker.models.citation import Citation, CitationStyle, CitationType
from integrity_checker.models.source import SourceCandidate, SourceResult
from integrity_checker.models.validation import CitationVerdict, MatchFeatures, ValidationLabel


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


class TestHostileReviewerAndProductionParityRegressions:
    """Comprehensive regression tests for all Scientific & Production Audit findings."""

    def test_natural_academic_misattributed_templates_caught_across_checker_and_known_papers(self) -> None:
        """All natural academic misattribution templates (not just 'Regarding...') must be caught
        even on curated seminal papers (`known_papers`) with full authors and `mapping_status=MATCHED`."""
        src_title = "Attention Is All You Need"
        src_abs = (
            "The dominant sequence transduction models are based on complex recurrent or "
            "convolutional neural networks that include an encoder and a decoder. We propose "
            "a new simple network architecture, the Transformer, based solely on attention "
            "mechanisms, dispensing with recurrence and convolutions entirely. Experiments on "
            "two machine translation tasks show these models to be superior in quality while "
            "being more parallelizable and requiring significantly less time to train."
        )
        misattributed_templates = [
            (
                "Vaswani et al. (2017) demonstrated that spectral graph Laplacian message-passing "
                "achieves 83.5% semi-supervised node classification accuracy on the Cora citation "
                "benchmark in their study on Attention Is All You Need."
            ),
            (
                "Prior work on Attention Is All You Need [1] established that spectral graph "
                "Laplacian message-passing achieves 83.5% semi-supervised node classification "
                "accuracy on the Cora citation benchmark."
            ),
            (
                "Building upon Attention Is All You Need, Vaswani (2017) showed that spectral "
                "graph Laplacian message-passing achieves 83.5% semi-supervised node classification "
                "accuracy on the Cora citation benchmark."
            ),
            (
                "Spectral graph Laplacian message-passing achieves 83.5% semi-supervised node "
                "classification accuracy on the Cora citation benchmark [1]."
            ),
        ]
        for ctx in misattributed_templates:
            adj_sim, _, aligned = SemanticMatcher.calibrate_monolingual_specificity(
                raw_sim=0.61,
                cited_context=ctx,
                source_title=src_title,
                source_abstract=src_abs,
                is_cross_lingual=False,
            )
            stance = SemanticMatcher.check_claim_stance(
                ctx,
                src_abs,
                adj_sim,
                has_abstract=True,
                is_cross_lingual=False,
                source_abstract=src_abs,
                source_title=src_title,
            )
            assert aligned is False, f"Failed specificity gate for template: {ctx}"
            assert stance == "contradiction_risk", f"Expected contradiction_risk for: {ctx}"

        # Verify full NeuroSymbolicChecker.check parity on seminal known_papers + MATCHED status
        checker = NeuroSymbolicChecker(enable_content_alignment=True, enable_calibration=False)
        cit = Citation(
            raw_text="Vaswani, A., & Shazeer, N. (2017). Attention Is All You Need. Advances in Neural Information Processing Systems.",
            authors=["Vaswani, A.", "Shazeer, N."],
            year=2017,
            title=src_title,
            venue="Advances in Neural Information Processing Systems",
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.APA,
        )
        cand = SourceCandidate(
            source_name="openalex",
            found=True,
            title=src_title,
            authors=["Ashish Vaswani", "Noam Shazeer"],
            year=2017,
            venue="Advances in Neural Information Processing Systems",
            abstract=src_abs,
            confidence=0.98,
        )
        src = SourceResult(
            citation_raw=cit.raw_text,
            candidates=[cand],
            sources_queried=["openalex", "crossref"],
            sources_succeeded=["openalex", "crossref"],
        )
        verdict = checker.check(
            cit,
            src,
            mapping_status=CitationMappingStatus.MATCHED,
            citation_context=misattributed_templates[1],
        )
        assert verdict.label == ValidationLabel.METADATA_ERROR
        assert "R-CONTENT-MISMATCH" in verdict.triggered_rules
        assert "R-CONTENT-ALIGNMENT" not in verdict.triggered_rules
        assert "content" in verdict.mismatched_fields

    def test_known_papers_umbrella_venue_conflict_parity(self) -> None:
        """NeuroSymbolicChecker.check on a curated seminal paper must catch umbrella-only venue conflicts."""
        checker = NeuroSymbolicChecker(enable_content_alignment=False, enable_calibration=False)
        cit = Citation(
            raw_text="Vaswani, A., et al. (2017). Attention Is All You Need. Journal of Information Robotics.",
            authors=["Vaswani, A."],
            year=2017,
            title="Attention Is All You Need",
            venue="Journal of Information Robotics",
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.APA,
        )
        cand = SourceCandidate(
            source_name="openalex",
            found=True,
            title="Attention Is All You Need",
            authors=["Ashish Vaswani", "Noam Shazeer"],
            year=2017,
            venue="Advances in Neural Information Processing Systems",
            confidence=0.98,
        )
        src = SourceResult(
            citation_raw=cit.raw_text,
            candidates=[cand],
            sources_queried=["openalex"],
            sources_succeeded=["openalex"],
        )
        verdict = checker.check(cit, src)
        assert verdict.label == ValidationLabel.METADATA_ERROR
        assert "R-VENUE-MISMATCH" in verdict.triggered_rules
        assert "venue" in verdict.mismatched_fields

    def test_first_author_et_al_preserved_in_rule_4g_while_extra_coauthor_abstains(self) -> None:
        """First Author et al. (len 1 vs 3, only_cited=[]) must trigger R-TITLE-MISMATCH, whereas
        fabricated extra coauthor on single-author candidate (only_cited=['collaborator']) stays UNRESOLVED."""
        rules = SymbolicRules()
        cand = SourceCandidate(
            source_name="openalex",
            found=True,
            title="Hierarchical Attention Networks for Document Classification",
            authors=["Yang, Z.", "Yang, D.", "Dyer, C."],
            year="2016",
            confidence=0.88,
        )
        src = SourceResult(
            citation_raw="Yang, Z., et al. (2016). Hierarchical Attention for Neural Sequence Tagging. NAACL.",
            candidates=[cand],
            sources_queried=["crossref", "openalex"],
            sources_succeeded=["openalex"],
        )
        feat = MatchFeatures(
            title_sim_fuzzy=0.56,
            title_sim_semantic=0.46,
            author_jaccard=1.0,
            year_distance=0,
            doi_exact_match=False,
            source_consensus=1,
        )
        out_etal = rules.apply(
            feat,
            src,
            mapping_status=CitationMappingStatus.MATCHED,
            citation_authors=["Yang, Z."],
            citation_year=2016,
            citation_title="Hierarchical Attention for Neural Sequence Tagging",
            citation_raw=src.citation_raw,
            citation_type=CitationType.REFERENCE_LIST,
        )
        assert out_etal.label == ValidationLabel.METADATA_ERROR
        assert "R-TITLE-MISMATCH" in out_etal.triggered_rules

        # Extra fabricated co-author on a single-author candidate must still abstain (U1 invariant)
        cand_single = SourceCandidate(
            source_name="openalex",
            found=True,
            title="Self-Supervised Contrastive Representation Learning for Speech",
            authors=["Baevski, A."],
            year="2020",
            confidence=0.72,
        )
        src_u1 = SourceResult(
            citation_raw="Baevski, A., & Collaborator, R. (2020). Self-Supervised Contrastive Notes on Audio.",
            candidates=[cand_single],
            sources_queried=["openalex"],
            sources_succeeded=["openalex"],
        )
        feat_u1 = MatchFeatures(
            title_sim_fuzzy=0.55,
            title_sim_semantic=0.48,
            author_jaccard=1.0,
            year_distance=0,
            doi_exact_match=False,
            source_consensus=1,
        )
        out_u1 = rules.apply(
            feat_u1,
            src_u1,
            citation_authors=["Baevski, A.", "Collaborator, R."],
            citation_year=2020,
            citation_raw=src_u1.citation_raw,
        )
        assert out_u1.label == ValidationLabel.UNRESOLVED

    def test_missing_abstract_dblp_and_implicit_body_discovery_never_false_flag_content_mismatch(self) -> None:
        """Live DBLP/Crossref records with abstract=None and UNCITED_REFERENCE implicit_body_discovery
        must never trigger false R-CONTENT-MISMATCH."""
        rules = SymbolicRules()
        cand_dblp = SourceCandidate(
            source_name="dblp",
            found=True,
            title="On the Convergence of Adam and Beyond",
            authors=["Reddi, S. J.", "Kale, S.", "Kumar, S."],
            year="2018",
            abstract=None,
            confidence=0.95,
        )
        src_dblp = SourceResult(
            citation_raw="Reddi, S. J., Kale, S., & Kumar, S. (2018). On the Convergence of Adam and Beyond. ICLR.",
            candidates=[cand_dblp],
            sources_queried=["dblp", "crossref"],
            sources_succeeded=["dblp"],
        )
        feat_no_abs = MatchFeatures(
            title_sim_fuzzy=1.0,
            title_sim_semantic=1.0,
            author_jaccard=1.0,
            year_distance=0,
            source_consensus=1,
            content_alignment_score=0.19,
            content_alignment_confidence="low",
            content_is_aligned=False,
        )
        out_dblp = rules.apply(
            feat_no_abs,
            src_dblp,
            mapping_status=CitationMappingStatus.MATCHED,
            citation_authors=["Reddi, S. J.", "Kale, S.", "Kumar, S."],
            citation_year=2018,
            citation_raw=src_dblp.citation_raw,
        )
        assert out_dblp.label == ValidationLabel.VERIFIED
        assert "R-CONTENT-MISMATCH" not in out_dblp.triggered_rules

        # Explicit abstract present, but context came from heuristic implicit_body_discovery (UNCITED_REFERENCE)
        cand_with_abs = SourceCandidate(
            source_name="openalex",
            found=True,
            title="On the Convergence of Adam and Beyond",
            authors=["Reddi, S. J.", "Kale, S.", "Kumar, S."],
            year="2018",
            abstract="We study the convergence properties of adaptive gradient methods including Adam and AMSGrad.",
            confidence=0.95,
        )
        src_uncited = SourceResult(
            citation_raw=src_dblp.citation_raw,
            candidates=[cand_with_abs],
            sources_queried=["openalex"],
            sources_succeeded=["openalex"],
        )
        feat_implicit = MatchFeatures(
            title_sim_fuzzy=1.0,
            title_sim_semantic=1.0,
            author_jaccard=1.0,
            year_distance=0,
            source_consensus=1,
            content_alignment_score=0.18,
            content_alignment_confidence="low",
            content_is_aligned=False,
            context_source="implicit_body_discovery",
        )
        out_uncited = rules.apply(
            feat_implicit,
            src_uncited,
            mapping_status=CitationMappingStatus.UNCITED_REFERENCE,
            citation_authors=["Reddi, S. J.", "Kale, S.", "Kumar, S."],
            citation_year=2018,
            citation_raw=src_uncited.citation_raw,
        )
        assert out_uncited.label == ValidationLabel.VERIFIED
        assert "R-CONTENT-MISMATCH" not in out_uncited.triggered_rules

    def test_consortium_doi_with_matched_status_routes_to_metadata_error_not_hallucination(self) -> None:
        """IPCC (2021) consortium DOI with mapping_status=MATCHED, author_sim=0.0, best.venue=None,
        and high semantic title similarity must never be flagged as R-CHIMERIC-DOI-MISMATCH."""
        rules = SymbolicRules()
        cand = SourceCandidate(
            source_name="crossref",
            found=True,
            doi="10.1017/9781009157896",
            title="Climate Change 2021: The Physical Science Basis. Contribution of Working Group I to the Sixth Assessment Report of the Intergovernmental Panel on Climate Change",
            authors=["Masson-Delmotte, V.", "Zhai, P.", "Pirani, A."],
            year="2021",
            venue=None,
            confidence=0.99,
        )
        raw = "IPCC (2021). Climate Change 2021 — Sixth Assessment Report. https://doi.org/10.1017/9781009157896"
        src = SourceResult(
            citation_raw=raw,
            candidates=[cand],
            sources_queried=["crossref", "openalex"],
            sources_succeeded=["crossref"],
        )
        feat = MatchFeatures(
            title_sim_fuzzy=0.42,
            title_sim_semantic=0.82,
            author_jaccard=0.0,
            year_distance=0,
            doi_exact_match=True,
            source_consensus=1,
            venue_sim=0.0,
        )
        out = rules.apply(
            feat,
            src,
            mapping_status=CitationMappingStatus.MATCHED,
            citation_doi="10.1017/9781009157896",
            citation_authors=["IPCC"],
            citation_year=2021,
            citation_title="Climate Change 2021 — Sixth Assessment Report",
            citation_raw=raw,
            citation_type=CitationType.REFERENCE_LIST,
        )
        assert out.label == ValidationLabel.METADATA_ERROR
        assert "R-CHIMERIC-DOI-MISMATCH" not in out.triggered_rules

    def test_methodological_adoption_foreign_scripts_math_and_morphology_not_penalized(self) -> None:
        """First-person methodological adoption ('Building on...', 'For...'), German/CJK/math sentences,
        and morphological inflections ('translating', 'optimizing') must never trigger false contradiction."""
        src_title = "Attention Is All You Need"
        src_abs = (
            "We propose a new network architecture, the Transformer, based solely on self-attention "
            "mechanisms for English-to-German machine translation and sequence optimization."
        )
        # 1. First-person methodological adoption onto student's own biomedical domain
        for adopt_ctx in [
            "Building on the Transformer architecture [1], we classify cardiac arrhythmia from wearable ECG signals.",
            "For Transformer self-attention encoding, our pipeline projects clinical biomedical records (Vaswani et al., 2017).",
        ]:
            sim_out, _, aligned_out = SemanticMatcher.calibrate_monolingual_specificity(
                0.62, adopt_ctx, src_title, src_abs, is_cross_lingual=False
            )
            stance_out = SemanticMatcher.check_claim_stance(
                adopt_ctx, src_abs, sim_out, has_abstract=True, source_abstract=src_abs, source_title=src_title
            )
            assert aligned_out is True
            assert stance_out != "contradiction_risk"

        # 2. German, CJK, and equation-heavy English contexts
        de_ctx = "Wir verwenden Aufmerksamkeitsmechanismen zur Verbesserung der maschinellen Übersetzung langer Sätze [1]."
        _, _, de_aligned = SemanticMatcher.calibrate_monolingual_specificity(
            0.58, de_ctx, src_title, src_abs, is_cross_lingual=False
        )
        assert de_aligned is True
        for low_sim_ctx in [
            "本研究采用注意力机制 [1] 进行序列建模。",
            "Following [7], we set λ = 10⁻⁴ and p = 0.5 in Eq. (4).",
        ]:
            st = SemanticMatcher.check_claim_stance(
                low_sim_ctx, src_abs, 0.18, has_abstract=True, source_abstract=src_abs, source_title=src_title
            )
            assert st != "contradiction_risk"

        # 3. Morphological inflection equivalence ('translating', 'optimizing')
        morph_ctx = "Self-attentive architectures accelerate translating long German clauses while optimizing sequence convergence."
        _, _, morph_aligned = SemanticMatcher.calibrate_monolingual_specificity(
            0.59, morph_ctx, src_title, src_abs, is_cross_lingual=False
        )
        assert morph_aligned is True

        # 4. Multi-citation sentences & qualitative background mentions in real PDFs must never false-flag
        for real_pdf_ctx in [
            "UIT-VSMEC contains emotion-annotated social-media sentences [5], whereas UIT-VSFC concerns student feedback [9].",
            "The implementation uses a CUDA-capable NVIDIA GPU with PyTorch and Hugging Face Transformers [17], together with scikit-learn [18].",
            "In recent years, deep learning has revolutionized many fields (Vaswani et al., 2017).",
        ]:
            _, _, pdf_aligned = SemanticMatcher.calibrate_monolingual_specificity(
                0.56, real_pdf_ctx, src_title, src_abs, is_cross_lingual=False
            )
            pdf_stance = SemanticMatcher.check_claim_stance(
                real_pdf_ctx, src_abs, 0.41, has_abstract=True, source_abstract=src_abs, source_title=src_title
            )
            assert pdf_aligned is True
            assert pdf_stance != "contradiction_risk"

    def test_question_mark_subtitle_prefix_and_content_alignment_not_blocked_by_len20(self) -> None:
        """Short main title before '?' ('Why Should I Trust You?') must get high fuzzy prefix match
        and must not be blocked from R-CONTENT-ALIGNMENT by candidate title length >= 20."""
        calc = FeatureCalculator(enable_content_alignment=False)
        fuzzy_q = calc._compute_single_title_similarity(
            "Why Should I Trust You?",
            "Why Should I Trust You? Explaining the Predictions of Any Classifier",
        )
        assert fuzzy_q >= 0.90

        rules = SymbolicRules()
        cand = SourceCandidate(
            source_name="openalex",
            found=True,
            title="beta-VAE: Learning Basic Visual Concepts with a Constrained Variational Framework",
            authors=["Higgins, I.", "Matthey, L."],
            year="2017",
            abstract="We introduce beta-VAE, a framework for automated discovery of factorised latent representations.",
            confidence=0.92,
        )
        src = SourceResult(
            citation_raw="Higgins, I., & Matthey, L. (2017). β-VAE: Learning Basic Visual Concepts.",
            candidates=[cand],
            sources_queried=["openalex"],
            sources_succeeded=["openalex"],
        )
        feat = MatchFeatures(
            title_sim_fuzzy=0.72,
            title_sim_semantic=0.84,
            author_jaccard=1.0,
            year_distance=0,
            source_consensus=1,
            content_alignment_score=0.86,
            content_alignment_confidence="high",
            content_is_aligned=True,
        )
        out = rules.apply(
            feat,
            src,
            citation_authors=["Higgins, I.", "Matthey, L."],
            citation_year=2017,
            citation_title="β-VAE: Learning Basic Visual Concepts",
            citation_raw=src.citation_raw,
        )
        assert out.label == ValidationLabel.VERIFIED
        assert "R-CONTENT-ALIGNMENT" in out.triggered_rules

    def test_rule_6_alive_url_emits_doi_title_mismatch_without_broken_url_flag(self) -> None:
        """Exact DOI with consensus >= 2 and url_status='alive' (or None on live source) must NOT claim broken URL."""
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
        src = SourceResult(
            citation_raw="Chen, W., & Liu, Y. (2021). Cross-Lingual Transfer for Graph Decoding. ACL.",
            candidates=[cand],
            sources_queried=["crossref", "openalex"],
            sources_succeeded=["crossref", "openalex"],
            url_status="alive",
            url_status_code=200,
        )
        feat = MatchFeatures(
            title_sim_fuzzy=0.52,
            title_sim_semantic=0.48,
            author_jaccard=1.0,
            year_distance=0,
            doi_exact_match=True,
            source_consensus=2,
        )
        out = rules.apply(
            feat,
            src,
            citation_doi="10.18653/v1/2021.acl-long.120",
            citation_authors=["Chen, W.", "Liu, Y."],
            citation_year=2021,
            citation_raw=src.citation_raw,
        )
        assert out.label == ValidationLabel.METADATA_ERROR
        assert "R-DOI-TITLE-MISMATCH" in out.triggered_rules
        assert "url" not in out.mismatched_fields
        assert out.domain_exception is False

    def test_venue_normalizer_trailing_years_findings_aacl_and_nature_sister_journals(self) -> None:
        """Trailing conference years, Findings of EMNLP/NAACL/EACL YYYY, AACL-IJCNLP, Nat. Genet.,
        and JMLR Workshop and Conference Proceedings must never trigger false venue conflicts."""
        vn = VenueNormalizer()
        assert vn.similarity(
            "Proceedings of NeurIPS 2023",
            "Advances in Neural Information Processing Systems",
        ) == 1.0
        assert vn.similarity(
            "EMNLP",
            "Findings of the Association for Computational Linguistics: EMNLP 2023",
        ) == 1.0
        assert vn.similarity(
            "Proceedings of AACL-IJCNLP 2022",
            "Proceedings of the 2nd Conference of the Asia-Pacific Chapter of the Association for Computational Linguistics",
        ) == 1.0
        assert vn.normalize("Nat. Genet.") == "Nature Genetics"

        rules = SymbolicRules()
        assert (
            rules.check_explicit_venue_conflict(
                "ICML",
                "JMLR Workshop and Conference Proceedings",
                doi_exact_match=True,
            )
            is False
        )
        assert (
            rules.check_explicit_venue_conflict(
                "OSF Preprints",
                "Psychological Science",
                doi_exact_match=True,
            )
            is False
        )

    def test_common_surname_initial_mismatch_and_year_999_sentinel_in_rule_4a2(self) -> None:
        """Common surname collision ('Wang, Y.' vs 'Xiao Wang') with semantic-only title match must not
        be flagged as METADATA_ERROR, and year_distance=999 must never append 'year' to mismatched_fields."""
        rules = SymbolicRules()
        cand_wang = SourceCandidate(
            source_name="openalex",
            found=True,
            title="Graph Neural Networks for Molecular Property Prediction",
            authors=["Xiao Wang", "Jie Tang"],
            year="2020",
            confidence=0.75,
        )
        src_wang = SourceResult(
            citation_raw="Wang, Y., & Liu, H. (2024). Deep Graph Representations for Drug Discovery.",
            candidates=[cand_wang],
            sources_queried=["openalex", "crossref"],
            sources_succeeded=["openalex"],
        )
        feat_wang = MatchFeatures(
            title_sim_fuzzy=0.42,
            title_sim_semantic=0.65,
            author_jaccard=0.25,
            year_distance=4,
            source_consensus=1,
        )
        out_wang = rules.apply(
            feat_wang,
            src_wang,
            citation_authors=["Wang, Y.", "Liu, H."],
            citation_year=2024,
            citation_raw=src_wang.citation_raw,
        )
        assert out_wang.label != ValidationLabel.METADATA_ERROR

        # Undated candidate (year_distance=999) with author mismatch must not flag 'year'
        cand_undated = SourceCandidate(
            source_name="openalex",
            found=True,
            title="Contextualized Word Representations for Named Entity Recognition",
            authors=["Peters, M.", "Neumann, M."],
            year=None,
            confidence=0.88,
        )
        src_undated = SourceResult(
            citation_raw="Peters, M., & Wrong, Z. (2018). Contextualized Word Representations for Named Entity Recognition.",
            candidates=[cand_undated],
            sources_queried=["openalex"],
            sources_succeeded=["openalex"],
        )
        feat_undated = MatchFeatures(
            title_sim_fuzzy=1.0,
            title_sim_semantic=1.0,
            author_jaccard=0.33,
            year_distance=999,
            source_consensus=1,
        )
        out_undated = rules.apply(
            feat_undated,
            src_undated,
            citation_authors=["Peters, M.", "Wrong, Z."],
            citation_year=2018,
            citation_raw=src_undated.citation_raw,
        )
        assert out_undated.label == ValidationLabel.METADATA_ERROR
        assert "year" not in out_undated.mismatched_fields

    def test_baseline_runner_citation_verdict_and_calibration_signal_parity(self) -> None:
        """BaselineRunner('proposed') on CitationVerdict objects and HybridMLScorer feature extraction
        must stay synchronized with Pillars 1-4."""
        cit = Citation(
            raw_text="Yang, Z., Yang, D., & Dyer, C. (2016). Hierarchical Attention for Neural Sequence Tagging. NAACL.",
            authors=["Yang, Z.", "Yang, D.", "Dyer, C."],
            year=2016,
            title="Hierarchical Attention for Neural Sequence Tagging",
            venue="NAACL",
            citation_type=CitationType.REFERENCE_LIST,
        )
        cand = SourceCandidate(
            source_name="openalex",
            found=True,
            title="Hierarchical Attention Networks for Document Classification",
            authors=["Yang, Z.", "Yang, D.", "Dyer, C."],
            year=2016,
            venue="NAACL",
            confidence=0.88,
        )
        src = SourceResult(
            citation_raw=cit.raw_text,
            candidates=[cand],
            sources_queried=["crossref", "openalex"],
            sources_succeeded=["crossref", "openalex"],
        )
        feat = MatchFeatures(
            title_sim_fuzzy=0.56,
            title_sim_semantic=0.46,
            author_jaccard=1.0,
            year_distance=0,
            source_consensus=2,
        )
        verdict = CitationVerdict(
            citation=cit,
            label=ValidationLabel.METADATA_ERROR,
            confidence=0.65,
            matched_source=src,
            features=feat,
            reasoning="test",
            triggered_rules=["R-TITLE-MISMATCH"],
            mismatched_fields=["title"],
        )
        runner = BaselineRunner()
        res = runner.run("proposed", [verdict])
        assert res["predictions"] == ["metadata_error"]

        # HybridMLScorer negative content_alignment_signal must activate on unaligned / contradiction_risk claims
        vec = HybridMLScorer.extract_feature_vector(
            {
                "title_sim_fuzzy": 1.0,
                "title_sim_semantic": 1.0,
                "author_jaccard": 1.0,
                "year_distance": 0,
                "source_consensus": 1,
                "content_alignment_score": 0.38,
                "content_alignment_confidence": "medium",
                "content_is_aligned": False,
                "stance_label": "contradiction_risk",
            }
        )
        assert vec[8] < 0.0

    def test_multi_occurrence_alignment_state_sync_prevents_contradictory_flags(self) -> None:
        """When a paper has a strongly supported primary occurrence (0.78) and a non-negated secondary
        co-citation window, stance_label must remain 'supported'; when explicit refutation occurs,
        content_is_aligned must sync to False and R-CONTENT-ALIGNMENT must not override it."""
        from unittest.mock import MagicMock

        mock_sem = MagicMock()
        mock_sem.similarity.return_value = 1.0
        mock_sem.check_content_alignment.return_value = MagicMock(
            similarity=0.78,
            confidence="high",
            is_aligned=True,
            best_cited_sentence="Transformer self-attention accelerates English-to-German translation [1].",
            best_evidence_sentence="We propose the Transformer, based solely on attention mechanisms.",
            citation_intent="methodology",
            stance_label="supported",
            cross_lingual_detected=False,
            bridged_concepts=[],
        )
        mock_sem.check_multi_context_alignment.return_value = [
            {
                "score": 0.78,
                "confidence": "high",
                "is_aligned": True,
                "focal_sentence": "Transformer self-attention accelerates English-to-German translation [1].",
                "best_evidence_sentence": "We propose the Transformer, based solely on attention mechanisms.",
                "intent": "methodology",
                "stance": "supported",
            },
            {
                "score": 0.34,
                "confidence": "medium",
                "is_aligned": False,
                "focal_sentence": "Graph benchmarks such as Cora and CiteSeer evaluate node operators [1, 2].",
                "best_evidence_sentence": "We propose the Transformer.",
                "intent": "background",
                "stance": "contradiction_risk",
            },
        ]
        calc = FeatureCalculator(semantic=mock_sem, enable_content_alignment=True)
        cit = Citation(
            raw_text="Vaswani, A., & Shazeer, N. (2017). Attention Is All You Need.",
            authors=["Vaswani, A.", "Shazeer, N."],
            year=2017,
            title="Attention Is All You Need",
            citation_type=CitationType.REFERENCE_LIST,
        )
        cit._occurrence_contexts = [  # type: ignore[attr-defined]
            "Transformer self-attention accelerates English-to-German translation [1].",
            "Graph benchmarks such as Cora and CiteSeer evaluate node operators [1, 2].",
        ]
        cand = SourceCandidate(
            source_name="openalex",
            found=True,
            title="Attention Is All You Need",
            authors=["Vaswani, A.", "Shazeer, N."],
            year="2017",
            abstract="We propose the Transformer, based solely on attention mechanisms for machine translation.",
            confidence=0.98,
        )
        src = SourceResult(
            citation_raw=cit.raw_text,
            candidates=[cand],
            sources_queried=["openalex"],
            sources_succeeded=["openalex"],
        )
        feat = calc.compute(cit, src, citation_context=cit._occurrence_contexts[0])  # type: ignore[attr-defined]
        assert feat.stance_label == "supported"
        assert feat.content_is_aligned is True

    def test_verb_agnostic_claim_invariance_across_unseen_verbs_and_verbless_assertions(self) -> None:
        """Unseen reporting verbs ('found', 'concluded', 'observed', 'revealed', 'confirmed',
        'argued', present-tense 'report') and plain verb-free '(Author, Year).' assertions
        without '%' or 'achieves' must all trigger R-CONTENT-MISMATCH identically."""
        checker = NeuroSymbolicChecker(enable_content_alignment=True)
        src_title = "Attention Is All You Need"
        src_abs = (
            "The dominant sequence transduction models are based on complex recurrent or "
            "convolutional neural networks that include an encoder and a decoder. We propose "
            "a new simple network architecture, the Transformer, based solely on attention mechanisms."
        )
        cit = Citation(
            raw_text="Vaswani, A., et al. (2017). Attention Is All You Need. NeurIPS.",
            authors=["Vaswani, A."],
            year=2017,
            title=src_title,
            venue="NeurIPS",
            citation_type=CitationType.REFERENCE_LIST,
        )
        cand = SourceCandidate(
            source_name="openalex",
            found=True,
            title=src_title,
            authors=["Vaswani, A.", "Shazeer, N.", "Parmar, N."],
            year="2017",
            venue="Advances in Neural Information Processing Systems",
            abstract=src_abs,
            confidence=0.98,
        )
        src = SourceResult(
            citation_raw=cit.raw_text,
            candidates=[cand],
            sources_queried=["openalex", "crossref"],
            sources_succeeded=["openalex", "crossref"],
        )
        claim = "byte-pair subword regularization lowers morphological out-of-vocabulary error rates on agglutinative corpora"
        unseen_templates = [
            f"Vaswani et al. (2017) found that {claim}.",
            f"Vaswani et al. (2017) concluded that {claim}.",
            f"Vaswani et al. (2017) observed that {claim}.",
            f"Vaswani et al. (2017) revealed that {claim}.",
            f"Vaswani et al. (2017) confirmed that {claim}.",
            f"Vaswani et al. (2017) argued that {claim}.",
            f"Vaswani et al. (2017) report that {claim}.",
            "Byte-pair subword regularization lowers morphological out-of-vocabulary error rates on agglutinative corpora (Vaswani et al., 2017).",
        ]
        for ctx_sent in unseen_templates:
            sim_out, _, aligned_out = SemanticMatcher.calibrate_monolingual_specificity(
                0.58, ctx_sent, src_title, src_abs, is_cross_lingual=False
            )
            stance_out = SemanticMatcher.check_claim_stance(
                ctx_sent, src_abs, sim_out, has_abstract=True, source_abstract=src_abs, source_title=src_title
            )
            assert aligned_out is False, f"Failed specificity calibration on: {ctx_sent}"
            assert stance_out == "contradiction_risk", f"Failed stance detection on: {ctx_sent}"
            verdict = checker.check(
                cit,
                src,
                citation_context=ctx_sent,
                mapping_status=CitationMappingStatus.MATCHED,
            )
            assert verdict.label == ValidationLabel.METADATA_ERROR, f"Failed verdict on: {ctx_sent}"
            assert "R-CONTENT-MISMATCH" in verdict.triggered_rules

    def test_known_papers_detects_grafted_coauthors_while_preserving_full_and_etal_lists(self) -> None:
        """NeuroSymbolicChecker known_papers branch must flag grafted/swapped co-authors ('author')
        both online and offline while keeping full canonical author lists and 'et al.' VERIFIED."""
        checker = NeuroSymbolicChecker(enable_content_alignment=False)
        grafted_cit = Citation(
            raw_text="Vaswani, A., Sutskever, I., Goodfellow, I., & LeCun, Y. (2017). Attention Is All You Need. Advances in Neural Information Processing Systems.",
            authors=["Vaswani, A.", "Sutskever, I.", "Goodfellow, I.", "LeCun, Y."],
            year=2017,
            title="Attention Is All You Need",
            venue="Advances in Neural Information Processing Systems",
            citation_type=CitationType.REFERENCE_LIST,
        )
        # 1. Offline (empty SourceResult -> relies on KNOWN_PAPERS truncated prefix)
        empty_src = SourceResult(
            citation_raw=grafted_cit.raw_text,
            candidates=[],
            sources_queried=["local_db"],
            sources_succeeded=[],
        )
        v_offline = checker.check(grafted_cit, empty_src, mapping_status=CitationMappingStatus.MATCHED)
        assert v_offline.label == ValidationLabel.METADATA_ERROR
        assert "author" in v_offline.mismatched_fields

        # 2. Online with full canonical authors
        full_authors = [
            "Ashish Vaswani", "Noam Shazeer", "Niki Parmar", "Jakob Uszkoreit",
            "Llion Jones", "Aidan N. Gomez", "Lukasz Kaiser", "Illia Polosukhin",
        ]
        online_src = SourceResult(
            citation_raw=grafted_cit.raw_text,
            candidates=[
                SourceCandidate(
                    source_name="openalex",
                    found=True,
                    title="Attention Is All You Need",
                    authors=full_authors,
                    year="2017",
                    venue="Advances in Neural Information Processing Systems",
                    confidence=0.99,
                )
            ],
            sources_queried=["openalex"],
            sources_succeeded=["openalex"],
        )
        v_online = checker.check(grafted_cit, online_src, mapping_status=CitationMappingStatus.MATCHED)
        assert v_online.label == ValidationLabel.METADATA_ERROR
        assert "author" in v_online.mismatched_fields

        # 3. Legitimate full 8-author citation offline & online must remain VERIFIED
        valid_full_cit = Citation(
            raw_text="Vaswani, A., Shazeer, N., Parmar, N., Uszkoreit, J., Jones, L., Gomez, A. N., Kaiser, L., & Polosukhin, I. (2017). Attention Is All You Need. NeurIPS.",
            authors=full_authors,
            year=2017,
            title="Attention Is All You Need",
            venue="NeurIPS",
            citation_type=CitationType.REFERENCE_LIST,
        )
        assert checker.check(valid_full_cit, empty_src, mapping_status=CitationMappingStatus.MATCHED).label == ValidationLabel.VERIFIED
        assert checker.check(valid_full_cit, online_src, mapping_status=CitationMappingStatus.MATCHED).label == ValidationLabel.VERIFIED

    def test_ordinary_negation_weak_learners_and_capitalized_verbatim_abstract_never_false_veto(self) -> None:
        """Capitalized verbatim abstract sentences, ordinary 'not required' / 'weak decision trees',
        APA semicolon multi-citations, and foreign source abstracts must never false-trigger contradiction_risk."""
        # 1. Capitalized verbatim sentence from abstract containing negation
        cap_abs = (
            "Standard recurrent neural models fail to capture long-range dependencies. "
            "Our attention architecture significantly outperforms existing systems."
        )
        cap_focal = "Standard recurrent neural models fail to capture long-range dependencies."
        assert (
            SemanticMatcher.check_claim_stance(
                cap_focal,
                "Our attention architecture significantly outperforms existing systems.",
                0.72,
                has_abstract=True,
                source_abstract=cap_abs,
                source_title="Attention Networks",
            )
            == "supported"
        )

        # 2. Ordinary negation ('not required') & 'weak' learners against positive abstract evidence
        vas_ev = "Experiments on two machine translation tasks show these models to be superior in quality."
        for benign_focal in [
            "Vaswani et al. (2017) show that recurrent layers are not required for sequence transduction.",
            "Gradient boosting combines weak decision trees to achieve high accuracy (Chen & Guestrin, 2016).",
            "Unlike traditional recurrent networks that fail to parallelize, Vaswani et al. (2017) use self-attention.",
        ]:
            assert (
                SemanticMatcher.check_claim_stance(
                    benign_focal,
                    vas_ev,
                    0.68,
                    has_abstract=True,
                    source_abstract=vas_ev,
                    source_title="Attention Is All You Need",
                )
                == "supported"
            )

        # 3. APA semicolon multi-citation & foreign-language source abstract must be exempted
        apa_multi = (
            "Neural sequence encoders and spectral graph Laplacian message-passing operators "
            "improve benchmark accuracy on Cora (Vaswani et al., 2017; Kipf & Welling, 2017)."
        )
        _, _, apa_aligned = SemanticMatcher.calibrate_monolingual_specificity(
            0.57,
            apa_multi,
            "Attention Is All You Need",
            "We propose the Transformer based solely on attention mechanisms for machine translation.",
            is_cross_lingual=False,
        )
        assert apa_aligned is True

        fr_abs = (
            "Nous proposons une architecture neuronale pour la traduction automatique des phrases "
            "longues dans les corpus multilingues."
        )
        en_ctx = "This work investigates morphological segmentation of low-resource clinical narratives [4]."
        _, _, fr_aligned = SemanticMatcher.calibrate_monolingual_specificity(
            0.55, en_ctx, "Architecture Neuronale", fr_abs, is_cross_lingual=False
        )
        assert fr_aligned is True
        assert (
            SemanticMatcher.check_claim_stance(
                en_ctx, fr_abs, 0.18, has_abstract=True, source_abstract=fr_abs, source_title="Architecture Neuronale"
            )
            != "contradiction_risk"
        )

    def test_rule_3_contradiction_mismatched_content_and_uncited_implicit_discovery_guard(self) -> None:
        """Rule 3 with consensus >= 2 and contradiction_risk must populate mismatched_fields=['content'],
        while UNCITED_REFERENCE implicit_body_discovery from another paper's sentence stays VERIFIED."""
        rules = SymbolicRules()
        cand = SourceCandidate(
            source_name="crossref",
            found=True,
            doi="10.18653/v1/2020.acl-main.10",
            title="Contextualized Representations for Biomedical Entity Linking",
            authors=["Lee, J.", "Yoon, W."],
            year="2020",
            abstract="We pretrain biomedical language representations on PubMed abstracts to improve entity linking.",
            confidence=0.98,
        )
        src = SourceResult(
            citation_raw="Lee, J., & Yoon, W. (2020). Contextualized Representations for Biomedical Entity Linking.",
            candidates=[cand, SourceCandidate(source_name="openalex", found=True, title=cand.title, authors=cand.authors, year="2020", doi=cand.doi, abstract=cand.abstract, confidence=0.97)],
            sources_queried=["crossref", "openalex"],
            sources_succeeded=["crossref", "openalex"],
        )
        feat_contradict = MatchFeatures(
            title_sim_fuzzy=1.0,
            title_sim_semantic=1.0,
            author_jaccard=1.0,
            year_distance=0,
            doi_exact_match=False,
            source_consensus=2,
            content_alignment_score=0.38,
            content_alignment_confidence="medium",
            content_is_aligned=False,
            stance_label="contradiction_risk",
            context_source="in_text_citation",
            best_cited_sentence="Lee & Yoon (2020) showed that reinforcement learning optimizes robotic quadruped locomotion.",
        )
        out_r3 = rules.apply(
            feat_contradict,
            src,
            citation_authors=["Lee, J.", "Yoon, W."],
            citation_year=2020,
            citation_title=cand.title,
            citation_raw=src.citation_raw,
        )
        assert out_r3.label == ValidationLabel.METADATA_ERROR
        assert "content" in out_r3.mismatched_fields
        assert "R-CONTENT-MISMATCH" in out_r3.triggered_rules
        assert "fields: ." not in out_r3.reasoning

        # Uncited bibliography entry whose implicit_body_discovery window cites a DIFFERENT author must stay VERIFIED
        feat_uncited_other = MatchFeatures(
            title_sim_fuzzy=1.0,
            title_sim_semantic=1.0,
            author_jaccard=1.0,
            year_distance=0,
            source_consensus=2,
            content_alignment_score=0.38,
            content_alignment_confidence="medium",
            content_is_aligned=False,
            stance_label="contradiction_risk",
            context_source="implicit_body_discovery",
            best_cited_sentence="Kipf & Welling (2017) demonstrated that spectral graph Laplacian operators improve Cora node classification.",
        )
        out_uncited = rules.apply(
            feat_uncited_other,
            src,
            mapping_status=CitationMappingStatus.UNCITED_REFERENCE,
            citation_authors=["Lee, J.", "Yoon, W."],
            citation_year=2020,
            citation_title=cand.title,
            citation_raw=src.citation_raw,
        )
        assert out_uncited.label == ValidationLabel.VERIFIED
        assert "R-CONTENT-MISMATCH" not in out_uncited.triggered_rules

    def test_author_dataclass_vancouver_initials_undated_rule3b_and_dehyphenated_online_titles(self) -> None:
        """Author dataclass instances, Vancouver 'Wang YX' initials, undated year_distance=999 on exact-author
        Rule 3/3b, and '[Online]' / 'zeroshot' title tokens must all be handled cleanly."""
        from integrity_checker.logic.rules import (
            _has_contradictory_title_tokens,
            _lead_author_compatible,
        )
        from integrity_checker.matching.author_parser import Author

        peters_obj = Author(last_name="peters", initials=["M"], raw="Peters, M.")
        assert _lead_author_compatible([peters_obj], ["Matthew E. Peters", "Mark Neumann"]) is True  # type: ignore[list-item]
        assert _lead_author_compatible(["Wang YX"], ["Xiao Wang", "Jie Tang"]) is False
        assert _lead_author_compatible(["Wang YX"], ["Yuxuan Wang", "Jie Tang"]) is True

        assert (
            _has_contradictory_title_tokens(
                "Large Language Models are ZeroShot Reasoners [Online]",
                None,
                "Large Language Models are Zero-Shot Reasoners",
            )
            is False
        )

        # Undated candidate (year_distance=999) with exact title & exact author must verify in Rule 3b (not false 'year' error)
        rules = SymbolicRules()
        cand_undated_exact = SourceCandidate(
            source_name="openalex",
            found=True,
            title="Large Language Models are Zero-Shot Reasoners",
            authors=["Kojima, T.", "Gu, S. S."],
            year=None,
            confidence=0.94,
        )
        src_undated_exact = SourceResult(
            citation_raw="Kojima, T., & Gu, S. S. (2022). Large Language Models are Zero-Shot Reasoners.",
            candidates=[cand_undated_exact],
            sources_queried=["openalex"],
            sources_succeeded=["openalex"],
        )
        feat_undated_exact = MatchFeatures(
            title_sim_fuzzy=1.0,
            title_sim_semantic=1.0,
            author_jaccard=1.0,
            year_distance=999,
            source_consensus=1,
        )
        out_undated_exact = rules.apply(
            feat_undated_exact,
            src_undated_exact,
            citation_authors=["Kojima, T.", "Gu, S. S."],
            citation_year=2022,
            citation_title=cand_undated_exact.title,
            citation_raw=src_undated_exact.citation_raw,
        )
        assert out_undated_exact.label == ValidationLabel.VERIFIED
        assert "year" not in out_undated_exact.mismatched_fields

    def test_known_papers_offline_full_20_author_wolf_and_corrected_9_seminal_entries_verify(self) -> None:
        """Offline known_papers checks must verify full 20-author Wolf et al. (2020) and all 9 corrected
        seminal co-author lists without false METADATA_ERROR (['author'])."""
        checker = NeuroSymbolicChecker(enable_content_alignment=False)
        empty_src = SourceResult(
            citation_raw="",
            candidates=[],
            sources_queried=["local_db"],
            sources_succeeded=[],
        )
        wolf_cit = Citation(
            raw_text="Wolf, T., Debut, L., Sanh, V., Chaumond, J., Delangue, C., Moi, A., Cistac, P., Rault, T., Louf, R., Funtowicz, M., Davison, J., Shleifer, S., von Platen, P., Ma, C., Jernite, Y., Plu, J., Xu, C., Le Scao, T., Gugger, S., & Rush, A. M. (2020). Transformers: State-of-the-Art Natural Language Processing. EMNLP.",
            authors=[
                "Wolf, T.", "Debut, L.", "Sanh, V.", "Chaumond, J.", "Delangue, C.",
                "Moi, A.", "Cistac, P.", "Rault, T.", "Louf, R.", "Funtowicz, M.",
                "Davison, J.", "Shleifer, S.", "von Platen, P.", "Ma, C.", "Jernite, Y.",
                "Plu, J.", "Xu, C.", "Le Scao, T.", "Gugger, S.", "Rush, A. M.",
            ],
            year=2020,
            title="Transformers: State-of-the-Art Natural Language Processing",
            citation_type=CitationType.REFERENCE_LIST,
        )
        assert checker.check(wolf_cit, empty_src, mapping_status=CitationMappingStatus.MATCHED).label == ValidationLabel.VERIFIED

        for title_s, year_i, authors_l in [
            ("High-Resolution Image Synthesis with Latent Diffusion Models", 2022, ["Rombach, R.", "Blattmann, A.", "Lorenz, D.", "Esser, P.", "Ommer, B."]),
            ("Modeling Relational Data with Graph Convolutional Networks", 2018, ["Schlichtkrull, M.", "Kipf, T. N.", "Bloem, P.", "van den Berg, R.", "Titov, I.", "Welling, M."]),
            ("Universal Sentence Encoder", 2018, ["Cer, D.", "Yang, Y.", "Kong, S.", "Hua, N."]),
            ("One Billion Word Benchmark for Measuring Progress in Language Modeling", 2013, ["Chelba, C.", "Mikolov, T.", "Schuster, M.", "Ge, Q.", "Brants, T."]),
            ("Google's Neural Machine Translation System: Bridging the Gap between Human and Machine Translation", 2016, ["Wu, Y.", "Schuster, M.", "Chen, Z.", "Le, Q. V.", "Norouzi, M."]),
            ("Learning Phrase Representations using RNN Encoder-Decoder for Statistical Machine Translation", 2014, ["Cho, K.", "van Merrienboer, B.", "Gulcehre, C.", "Bahdanau, D."]),
        ]:
            cit_s = Citation(
                raw_text=f"{', '.join(authors_l)} ({year_i}). {title_s}.",
                authors=authors_l,
                year=year_i,
                title=title_s,
                citation_type=CitationType.REFERENCE_LIST,
            )
            res_s = checker.check(cit_s, empty_src, mapping_status=CitationMappingStatus.MATCHED)
            assert res_s.label == ValidationLabel.VERIFIED, f"Unexpected {res_s.label} ({res_s.mismatched_fields}) on {title_s}"

    def test_problem_motivation_fail_to_hyphen_compounds_exact_doi_body_and_wmt_year(self) -> None:
        """Problem-motivation 'fail to' clauses, hyphenated 'pre-train' vs 'pretrains' compounds,
        exact-DOI body-section citations, and 'WMT 2014' dataset years must work without false positives/negatives."""
        vas_ev = "Experiments on two machine translation tasks show these models to be superior in quality."
        for motiv_sent in [
            "Traditional bag-of-words representations fail to capture contextual polysemy (Peters et al., 2018).",
            "Recurrent neural networks fail to parallelize across long token sequences (Vaswani et al., 2017).",
        ]:
            assert (
                SemanticMatcher.check_claim_stance(
                    motiv_sent,
                    vas_ev,
                    0.68,
                    has_abstract=True,
                    source_abstract=vas_ev,
                    source_title="Attention Is All You Need",
                )
                == "supported"
            )

        # Hyphen compound symmetry: 'pretrains' / 'subword' vs 'pre-training' / 'sub-word'
        bert_abs = (
            "We introduce a new language representation model called BERT, designed to pre-train "
            "deep bidirectional representations from unlabeled text over sub-word vocabularies."
        )
        bert_ctx = "BERT pretrains masked token objectives using subword vocabulary embeddings (Devlin et al., 2019)."
        _, _, bert_aligned = SemanticMatcher.calibrate_monolingual_specificity(
            0.61, bert_ctx, "BERT: Pre-training of Deep Bidirectional Transformers", bert_abs, is_cross_lingual=False
        )
        assert bert_aligned is True

        # Exact-DOI ResNet (2016) citing Section 3 body mechanism without polarity refutation stays VERIFIED
        checker = NeuroSymbolicChecker(enable_content_alignment=True)
        he_cit = Citation(
            raw_text="He, K., Zhang, X., Ren, S., & Sun, J. (2016). Deep Residual Learning for Image Recognition. CVPR. doi:10.1109/CVPR.2016.90",
            authors=["He, K.", "Zhang, X.", "Ren, S.", "Sun, J."],
            year=2016,
            title="Deep Residual Learning for Image Recognition",
            doi="10.1109/CVPR.2016.90",
            venue="CVPR",
            citation_type=CitationType.REFERENCE_LIST,
        )
        he_src = SourceResult(
            citation_raw=he_cit.raw_text,
            candidates=[
                SourceCandidate(
                    source_name="crossref",
                    found=True,
                    doi="10.1109/CVPR.2016.90",
                    title="Deep Residual Learning for Image Recognition",
                    authors=["Kaiming He", "Xiangyu Zhang", "Shaoqing Ren", "Jian Sun"],
                    year="2016",
                    venue="CVPR",
                    abstract="Deeper neural networks are more difficult to train. We present a residual learning framework to ease the training of networks that are substantially deeper than those used previously.",
                    confidence=0.99,
                )
            ],
            sources_queried=["crossref", "openalex"],
            sources_succeeded=["crossref", "openalex"],
        )
        he_v = checker.check(
            he_cit,
            he_src,
            citation_context="Skip connections mitigate vanishing gradients during backpropagation through identity shortcut mappings (He et al., 2016).",
            mapping_status=CitationMappingStatus.MATCHED,
        )
        assert he_v.label == ValidationLabel.VERIFIED

        # Benchmark year 'WMT 2014' in numeric [1] refutation must NOT be suppressed as a conflicting callout year
        from unittest.mock import MagicMock

        mock_sem = MagicMock()
        mock_sem.similarity.return_value = 1.0
        mock_sem.check_content_alignment.return_value = MagicMock(
            similarity=0.72,
            confidence="high",
            is_aligned=True,
            best_cited_sentence="We evaluate Transformer self-attention on machine translation [1].",
            best_evidence_sentence="We propose the Transformer.",
            citation_intent="methodology",
            stance_label="supported",
            cross_lingual_detected=False,
            bridged_concepts=[],
        )
        mock_sem.check_multi_context_alignment.return_value = [
            {
                "score": 0.72,
                "confidence": "high",
                "is_aligned": True,
                "focal_sentence": "We evaluate Transformer self-attention on machine translation [1].",
                "best_evidence_sentence": "We propose the Transformer.",
                "intent": "methodology",
                "stance": "supported",
            },
            {
                "score": 0.54,
                "confidence": "medium",
                "is_aligned": False,
                "focal_sentence": "However, on the WMT 2014 benchmark, [1] completely fails to improve translation quality and degrades performance.",
                "best_evidence_sentence": "We propose the Transformer.",
                "intent": "result_comparison",
                "stance": "contradiction_risk",
            },
        ]
        calc = FeatureCalculator(semantic=mock_sem, enable_content_alignment=True)
        vas_cit = Citation(
            raw_text="[1] Vaswani, A., et al. (2017). Attention Is All You Need.",
            authors=["Vaswani, A."],
            year=2017,
            title="Attention Is All You Need",
            numeric_index=1,
            citation_type=CitationType.REFERENCE_LIST,
        )
        vas_cit._occurrence_contexts = [  # type: ignore[attr-defined]
            "We evaluate Transformer self-attention on machine translation [1].",
            "However, on the WMT 2014 benchmark, [1] completely fails to improve translation quality and degrades performance.",
        ]
        vas_src = SourceResult(
            citation_raw=vas_cit.raw_text,
            candidates=[
                SourceCandidate(
                    source_name="openalex",
                    found=True,
                    title="Attention Is All You Need",
                    authors=["Vaswani, A."],
                    year="2017",
                    abstract="We propose the Transformer based solely on attention mechanisms for machine translation.",
                    confidence=0.98,
                )
            ],
            sources_queried=["openalex"],
            sources_succeeded=["openalex"],
        )
        vas_feat = calc.compute(vas_cit, vas_src, citation_context=vas_cit._occurrence_contexts[0])  # type: ignore[attr-defined]
        assert vas_feat.stance_label == "contradiction_risk"
        assert vas_feat.content_is_aligned is False

    def test_local_db_known_papers_seed_stubs_and_affirmative_exact_doi_polarity(
        self, tmp_path
    ) -> None:
        """Stale `source='known_papers'` rows in `local_papers.db` must NOT overwrite corrected
        `_KNOWN_PAPERS` co-authors or set `inherited_full_authors=True` on 12-to-14-author papers;
        and affirmative `_STRONG_POSITIVE_CLAIM_RE` phrases must NOT trip exact-DOI polarity conflict."""
        from integrity_checker.database.local_db import LocalDatabase
        from integrity_checker.database.models import Paper
        from integrity_checker.retrieval.retrieval_orchestrator import RetrievalOrchestrator

        stale_db = LocalDatabase(db_path=tmp_path / "stale_known_papers.db")
        stale_db.add_paper(
            Paper(
                doi="10.48550/arxiv.1803.11175",
                title="Universal Sentence Encoder",
                authors=["Cer", "Yang", "Luong", "Manning"],
                year=2018,
                venue="NeurIPS",
                source="known_papers",
            )
        )
        stale_db.add_paper(
            Paper(
                doi="10.48550/arxiv.2302.13971",
                title="LLaMA: Open and Efficient Foundation Language Models",
                authors=["Touvron", "Lavril", "Izacard", "Martinet"],
                year=2023,
                venue="ICLR",
                source="known_papers",
            )
        )
        stale_db.add_paper(
            Paper(
                doi="10.48550/arxiv.2103.00020",
                title="Learning Transferable Visual Models From Natural Language Supervision",
                authors=["Radford", "Kim", "Hallacy", "Ramesh"],
                year=2021,
                venue="NeurIPS",
                source="known_papers",
            )
        )

        checker = NeuroSymbolicChecker(enable_content_alignment=True)
        orch = RetrievalOrchestrator(local_db=stale_db, use_local_db=True)

        # 1. Cer et al. (2018) Universal Sentence Encoder via real LocalDatabase arXiv lookup
        cer_real = Citation(
            raw_text="Cer, D., Yang, Y., Kong, S., & Hua, N. (2018). Universal Sentence Encoder. arXiv:1803.11175",
            authors=["Cer, D.", "Yang, Y.", "Kong, S.", "Hua, N."],
            year=2018,
            title="Universal Sentence Encoder",
            doi="10.48550/arXiv.1803.11175",
            citation_type=CitationType.REFERENCE_LIST,
        )
        cer_src = orch._lookup_local_db(cer_real)
        assert cer_src is not None and cer_src.candidates
        assert cer_src.candidates[0].authors == ["Cer", "Yang", "Kong", "Hua"]
        assert checker.check(cer_real, cer_src, mapping_status=CitationMappingStatus.MATCHED).label == ValidationLabel.VERIFIED

        cer_fake = Citation(
            raw_text="Cer, D., Yang, Y., Luong, M.-T., & Manning, C. D. (2018). Universal Sentence Encoder. arXiv:1803.11175",
            authors=["Cer, D.", "Yang, Y.", "Luong, M.-T.", "Manning, C. D."],
            year=2018,
            title="Universal Sentence Encoder",
            doi="10.48550/arXiv.1803.11175",
            citation_type=CitationType.REFERENCE_LIST,
        )
        cer_fake_v = checker.check(cer_fake, cer_src, mapping_status=CitationMappingStatus.MATCHED)
        assert cer_fake_v.label == ValidationLabel.METADATA_ERROR
        assert "author" in cer_fake_v.mismatched_fields

        # 2. Full 14-author LLaMA (Touvron et al., 2023) & 12-author CLIP (Radford et al., 2021) via real LocalDatabase
        llama_cit = Citation(
            raw_text="Touvron, H., Lavril, T., Izacard, G., Martinet, X., Lachaux, M.-A., Lacroix, T., Roziere, B., Goyal, N., Hambro, E., Azhar, F., Rodriguez, A., Joulin, A., Grave, E., & Lample, G. (2023). LLaMA: Open and Efficient Foundation Language Models. arXiv:2302.13971",
            authors=[
                "Touvron, H.", "Lavril, T.", "Izacard, G.", "Martinet, X.", "Lachaux, M.-A.",
                "Lacroix, T.", "Roziere, B.", "Goyal, N.", "Hambro, E.", "Azhar, F.",
                "Rodriguez, A.", "Joulin, A.", "Grave, E.", "Lample, G.",
            ],
            year=2023,
            title="LLaMA: Open and Efficient Foundation Language Models",
            doi="10.48550/arXiv.2302.13971",
            citation_type=CitationType.REFERENCE_LIST,
        )
        llama_src = orch._lookup_local_db(llama_cit)
        assert llama_src is not None and llama_src.candidates
        assert checker.check(llama_cit, llama_src, mapping_status=CitationMappingStatus.MATCHED).label == ValidationLabel.VERIFIED

        clip_cit = Citation(
            raw_text="Radford, A., Kim, J. W., Hallacy, C., Ramesh, A., Goh, G., Agarwal, S., Sastry, G., Askell, A., Mishkin, P., Clark, J., Krueger, G., & Sutskever, I. (2021). Learning Transferable Visual Models From Natural Language Supervision. arXiv:2103.00020",
            authors=[
                "Radford, A.", "Kim, J. W.", "Hallacy, C.", "Ramesh, A.", "Goh, G.", "Agarwal, S.",
                "Sastry, G.", "Askell, A.", "Mishkin, P.", "Clark, J.", "Krueger, G.", "Sutskever, I.",
            ],
            year=2021,
            title="Learning Transferable Visual Models From Natural Language Supervision",
            doi="10.48550/arXiv.2103.00020",
            citation_type=CitationType.REFERENCE_LIST,
        )
        clip_src = orch._lookup_local_db(clip_cit)
        assert clip_src is not None and clip_src.candidates
        assert checker.check(clip_cit, clip_src, mapping_status=CitationMappingStatus.MATCHED).label == ValidationLabel.VERIFIED

        # 3. Exact-DOI affirmative '_STRONG_POSITIVE_CLAIM_RE' body claim & contrastive baseline lead stay VERIFIED
        he_cit = Citation(
            raw_text="He, K., Zhang, X., Ren, S., & Sun, J. (2016). Deep Residual Learning for Image Recognition. CVPR. doi:10.1109/CVPR.2016.90",
            authors=["He, K.", "Zhang, X.", "Ren, S.", "Sun, J."],
            year=2016,
            title="Deep Residual Learning for Image Recognition",
            doi="10.1109/CVPR.2016.90",
            venue="CVPR",
            citation_type=CitationType.REFERENCE_LIST,
        )
        he_src = SourceResult(
            citation_raw=he_cit.raw_text,
            candidates=[
                SourceCandidate(
                    source_name="crossref",
                    found=True,
                    doi="10.1109/CVPR.2016.90",
                    title="Deep Residual Learning for Image Recognition",
                    authors=["Kaiming He", "Xiangyu Zhang", "Shaoqing Ren", "Jian Sun"],
                    year="2016",
                    venue="CVPR",
                    abstract="Deeper neural networks are more difficult to train. We present a residual learning framework to ease the training of networks that are substantially deeper than those used previously.",
                    confidence=0.99,
                )
            ],
            sources_queried=["crossref", "openalex"],
            sources_succeeded=["crossref", "openalex"],
        )
        he_pos_v = checker.check(
            he_cit,
            he_src,
            citation_context="Identity shortcut mappings in 152-layer skip-connected architectures significantly outperform shallow baselines on PASCAL VOC segmentation (He et al., 2016).",
            mapping_status=CitationMappingStatus.MATCHED,
        )
        assert he_pos_v.label == ValidationLabel.VERIFIED

        peters_cit = Citation(
            raw_text="Peters, M. E., Neumann, M., Iyyer, M., Gardner, M., & Clark, C. (2018). Deep Contextualized Word Representations. NAACL. doi:10.18653/v1/N18-1202",
            authors=["Peters, M. E.", "Neumann, M.", "Iyyer, M.", "Gardner, M.", "Clark, C."],
            year=2018,
            title="Deep Contextualized Word Representations",
            doi="10.18653/v1/N18-1202",
            venue="NAACL",
            citation_type=CitationType.REFERENCE_LIST,
        )
        peters_src = SourceResult(
            citation_raw=peters_cit.raw_text,
            candidates=[
                SourceCandidate(
                    source_name="crossref",
                    found=True,
                    doi="10.18653/v1/N18-1202",
                    title="Deep Contextualized Word Representations",
                    authors=["Matthew E. Peters", "Mark Neumann", "Mohit Iyyer", "Matt Gardner", "Christopher Clark"],
                    year="2018",
                    venue="NAACL",
                    abstract="We introduce a new type of deep contextualized word representation that models both complex characteristics of word use and how these uses vary across linguistic contexts.",
                    confidence=0.99,
                )
            ],
            sources_queried=["crossref"],
            sources_succeeded=["crossref"],
        )
        peters_v = checker.check(
            peters_cit,
            peters_src,
            citation_context="Traditional bag-of-words models fail to work on polysemous clinical acronyms (Peters et al., 2018).",
            mapping_status=CitationMappingStatus.MATCHED,
        )
        assert peters_v.label == ValidationLabel.VERIFIED





