"""Unit tests verifying principled fixes for the METADATA_ERROR -> VERIFIED bottleneck.

Covers:
- Asymmetric subtitle omission vs. fabricated subtitle detection and symmetric multiset
  containment fidelity in ``FeatureCalculator.compute_title_similarity`` (including CJK,
  bilingual parenthesized ACL titles, typographic quotes, and trailing acronym parens).
- Hardened ``_has_contradictory_title_tokens`` and unified ``has_lexical_title_corruption``
  guards across SymbolicRules Rules 1, 1b, 2, 3, 3b, 4, and 4a2 (verifying zero UNRESOLVED
  fallthroughs and preservation of legitimate shortened/reworded citations).
- Stemmed universal discourse stopwords (preserving domain terms), title-only plural-acronym
  symmetry, Unicode/particle/Vietnamese callout stripping, case-aware foreign-language
  detection, and third-person reporting vs. first-person methodological adoption guards.
"""

from __future__ import annotations

import pytest

from integrity_checker.evaluation.baselines import BaselineRunner
from integrity_checker.linking.statuses import CitationMappingStatus
from integrity_checker.logic.rules import SymbolicRules, _has_contradictory_title_tokens
from integrity_checker.matching.features import FeatureCalculator
from integrity_checker.matching.semantic import (
    _CITATION_CALLOUT_STRIP_RE,
    SemanticMatcher,
    _extract_distinctive_stems,
    _has_ungrounded_novel_claim,
    _is_non_english_or_foreign_text,
)
from integrity_checker.models.source import SourceCandidate, SourceResult
from integrity_checker.models.validation import MatchFeatures, ValidationLabel


class TestSymmetricTitleSimilarity:
    """Real-world title similarity invariants (asymmetry, CJK, quotes, multiset fidelity)."""

    def test_asymmetric_subtitle_omission_vs_fabricated_subtitle(self) -> None:
        # Legitimate citation omitting canonical subtitle -> 0.95
        legit = FeatureCalculator.compute_title_similarity(
            "Why Should I Trust You?",
            "Why Should I Trust You? Explaining the Predictions of Any Classifier",
        )
        assert legit == pytest.approx(0.95)

        # Fabricated subtitle appended onto shorter canonical title MUST NOT get >= 0.85
        fabricated = FeatureCalculator.compute_title_similarity(
            "Attention Is All You Need: Quantum Neural Cryptography Across Blockchains",
            "Attention Is All You Need",
        )
        assert fabricated < 0.85

    def test_bilingual_parenthesized_and_book_series_titles_preserved(self) -> None:
        cjk_bilingual = FeatureCalculator.compute_title_similarity(
            "机器翻译和大语言模型研究进展",
            "机器翻译和大语言模型研究进展 (Research Development of Machine translation)",
        )
        assert cjk_bilingual == pytest.approx(0.95)

        book_series = FeatureCalculator.compute_title_similarity(
            "Pattern Recognition and Machine Learning",
            "Pattern Recognition and Machine Learning (Information Science and Statistics)",
        )
        assert book_series == pytest.approx(0.95)

    def test_typographic_quotes_and_trailing_acronym_parens_before_colon(self) -> None:
        quoted = FeatureCalculator.compute_title_similarity(
            "A Buster Keaton of Linguistics",
            "“A Buster Keaton of Linguistics”: First Automated Approaches for Extraction",
        )
        assert quoted == pytest.approx(0.95)

        trailing_paren = FeatureCalculator.compute_title_similarity(
            "Inference-Time Policy Adapters (IPA)",
            "Inference-Time Policy Adapters (IPA): Tailoring Extreme-Scale LMs without Fine-tuning",
        )
        assert trailing_paren == pytest.approx(0.95)

    def test_non_delimiter_truncation_leading_drops_and_subtitle_only_rejected(self) -> None:
        # Mid-phrase trailing truncation (no subtitle delimiter) must NOT inflate to 0.95
        trunc_bert = FeatureCalculator.compute_title_similarity(
            "BERT: Pre-training of Deep Bidirectional Transformers",
            "BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding",
        )
        assert trunc_bert < 0.85

        bare_acronym = FeatureCalculator.compute_title_similarity(
            "BERT",
            "BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding",
        )
        assert bare_acronym < 0.60

        # Leading negation/qualifier drop and subtitle-only citation must NOT inflate
        neg_drop = FeatureCalculator.compute_title_similarity(
            "Reasoning in Large Language Models",
            "Failures of Reasoning in Large Language Models",
        )
        assert neg_drop < 0.90
        assert _has_contradictory_title_tokens(
            "Reasoning in Large Language Models",
            None,
            "Failures of Reasoning in Large Language Models",
        )

        head_noun_drop = FeatureCalculator.compute_title_similarity(
            "A Survey of Large Language",
            "A Survey of Large Language Models",
        )
        assert head_noun_drop < 0.92
        assert _has_contradictory_title_tokens(
            "A Survey of Large Language",
            None,
            "A Survey of Large Language Models",
        )

        subtitle_only = FeatureCalculator.compute_title_similarity(
            "An Empirical Evaluation on Scientific Corpora",
            "Wrong Main Title: An Empirical Evaluation on Scientific Corpora",
        )
        assert subtitle_only < 0.85

        # Genuine leading-article drop ("The") and series prefix ("Lecture Notes...") still stay high
        article_drop = FeatureCalculator.compute_title_similarity(
            "Elements of Statistical Learning",
            "The Elements of Statistical Learning",
        )
        assert article_drop >= 0.95
        assert not _has_contradictory_title_tokens(
            "Elements of Statistical Learning",
            None,
            "The Elements of Statistical Learning",
        )
        series_drop = FeatureCalculator.compute_title_similarity(
            "Deep Learning for Natural Language Processing",
            "Lecture Notes in Computer Science: Deep Learning for Natural Language Processing",
        )
        assert series_drop == pytest.approx(0.95)

    def test_cjk_alien_english_suffix_penalized_while_authentic_cjk_latin_preserved(self) -> None:
        alien_cjk = FeatureCalculator.compute_title_similarity(
            "面向复杂推理任务的大语言模型增强方法研究 for RL",
            "面向复杂推理任务的大语言模型增强方法研究",
        )
        assert alien_cjk < 0.85

        authentic_cjk = FeatureCalculator.compute_title_similarity(
            "基于BERT的中文文本分类方法研究",
            "基于BERT的中文文本分类方法研究",
        )
        assert authentic_cjk == pytest.approx(1.0)

    def test_truncated_spliced_and_duplicated_titles_no_longer_inflate_to_one(self) -> None:
        truncated_spliced = FeatureCalculator.compute_title_similarity(
            "Learning Structured Representations for RL",
            "Learning Structured Representations in Dynamic Graphs for Molecular Property Prediction",
        )
        assert truncated_spliced < 0.85

        duplicated = FeatureCalculator.compute_title_similarity(
            "GLA: Grounding Large Language Models for Language Models",
            "GLA: Grounding Large Language Models in Molecular Hierarchy for Chemical Understanding",
        )
        assert duplicated < 0.85

    def test_raw_text_fallback_retains_canonical_substring_matching(self) -> None:
        raw_ref = (
            "Vaswani, A., Shazeer, N., Parmar, N., et al. (2017). "
            "Attention Is All You Need. Advances in Neural Information Processing Systems."
        )
        sim = FeatureCalculator.compute_title_similarity(
            raw_ref,
            "Attention Is All You Need",
            is_raw_fallback=True,
        )
        assert sim >= 0.90


class TestContradictoryTokensAndRuleGuards:
    """Hardened _has_contradictory_title_tokens and unified rule pathways (Rules 1..4a2)."""

    def test_split_hyphen_and_split_compound_not_flagged(self) -> None:
        assert not _has_contradictory_title_tokens(
            "End to-End Neural Machine Translation",
            None,
            "End-to-End Neural Machine Translation",
        )
        assert not _has_contradictory_title_tokens(
            "Sub word Regularization for NMT",
            None,
            "Subword Regularization for NMT",
        )

    def test_allcaps_initialisms_and_trailing_venue_tags_not_flagged(self) -> None:
        assert not _has_contradictory_title_tokens(
            "AN APPROACH TO MACHINE TRANSLATION IN PRACTICE",
            None,
            "An Approach to Machine Translation in Practice",
        )
        assert not _has_contradictory_title_tokens(
            "Transformers for NLP Tasks",
            None,
            "Transformers for Natural Language Processing Tasks",
        )
        assert not _has_contradictory_title_tokens(
            "Deep Residual Learning for Image Recognition (CVPR)",
            None,
            "Deep Residual Learning for Image Recognition",
        )

    def test_alien_acronyms_both_sided_years_cjk_and_stutters_flagged(self) -> None:
        assert _has_contradictory_title_tokens(
            "Transformers for RL",
            None,
            "Transformers for Machine Translation",
        )
        assert _has_contradictory_title_tokens(
            "Global Critical Minerals Outlook 2025",
            None,
            "Global Critical Minerals Outlook 2026",
        )
        # Presence vs. absence of a year must NOT false-trigger
        assert not _has_contradictory_title_tokens(
            "Global Critical Minerals Outlook 2026",
            None,
            "Global Critical Minerals Outlook",
        )
        assert _has_contradictory_title_tokens(
            "面向复杂推理任务的大语言模型增强方法研究 for RL",
            None,
            "面向复杂推理任务的大语言模型增强方法研究",
        )
        assert _has_contradictory_title_tokens(
            "Multimodal Fusion for Hate Speech Detection for Hate Speech Detection",
            None,
            "Multimodal Fusion for Hate Speech Detection - A Transformer Based Approach",
        )
        # Legitimate repetition already in canonical title must NOT trigger
        assert not _has_contradictory_title_tokens(
            "Step by Step Reasoning: Step by Step Guide",
            None,
            "Step by Step Reasoning: Step by Step Guide",
        )

    def test_rule1_and_rule3_lexical_corruption_routes_to_metadata_error_never_unresolved(self) -> None:
        rules = SymbolicRules()
        cand = SourceCandidate(
            source_name="crossref",
            found=True,
            title="Learning Structured Representations in Dynamic Graphs for Molecular Prediction",
            authors=["Alice Smith", "Bob Jones"],
            year="2023",
            doi="10.1234/example.2023",
            confidence=0.95,
        )
        # Case A: DOI exact match + high semantic (0.95) but lexically corrupted fuzzy (0.78)
        src_doi = SourceResult(
            citation_raw="Smith, A., & Jones, B. (2023). Learning Structured Representations for RL.",
            candidates=[cand],
            sources_queried=["crossref"],
            sources_succeeded=["crossref"],
        )
        feat_doi = MatchFeatures(
            title_sim_fuzzy=0.78,
            title_sim_semantic=0.95,
            author_jaccard=1.0,
            year_distance=0,
            doi_exact_match=True,
            source_consensus=1,
        )
        out_doi = rules.apply(
            feat_doi,
            src_doi,
            citation_doi="10.1234/example.2023",
            citation_authors=["Alice Smith", "Bob Jones"],
            citation_year=2023,
            citation_title="Learning Structured Representations for RL",
            citation_raw=src_doi.citation_raw,
        )
        assert out_doi.label == ValidationLabel.METADATA_ERROR
        assert "title" in out_doi.mismatched_fields

        # Case B: DOI exact match with minor non-contradictory rewording (fuzzy=0.83) still verifies
        feat_doi_minor = MatchFeatures(
            title_sim_fuzzy=0.83,
            title_sim_semantic=0.93,
            author_jaccard=1.0,
            year_distance=0,
            doi_exact_match=True,
            source_consensus=1,
        )
        out_doi_minor = rules.apply(
            feat_doi_minor,
            src_doi,
            citation_doi="10.1234/example.2023",
            citation_authors=["Alice Smith", "Bob Jones"],
            citation_year=2023,
            citation_title="Learning Structured Representations of Dynamic Graphs for Molecular Prediction",
            citation_raw=src_doi.citation_raw,
        )
        assert out_doi_minor.label == ValidationLabel.VERIFIED

        # Case C: Multi-source consensus (Rule 3) + high semantic (0.95) but corrupted fuzzy (0.83)
        # must route cleanly to Rule 4a2 METADATA_ERROR (NEVER UNRESOLVED!)
        src_cons = SourceResult(
            citation_raw="Smith, A., & Jones, B. (2023). Learning Structured Representations for RL.",
            candidates=[cand, SourceCandidate(source_name="openalex", found=True, title=cand.title, authors=cand.authors, year="2023", confidence=0.92)],
            sources_queried=["crossref", "openalex"],
            sources_succeeded=["crossref", "openalex"],
        )
        feat_cons = MatchFeatures(
            title_sim_fuzzy=0.83,
            title_sim_semantic=0.95,
            author_jaccard=1.0,
            year_distance=0,
            doi_exact_match=False,
            source_consensus=2,
        )
        out_cons = rules.apply(
            feat_cons,
            src_cons,
            citation_authors=["Alice Smith", "Bob Jones"],
            citation_year=2023,
            citation_title="Learning Structured Representations for RL",
            citation_raw=src_cons.citation_raw,
        )
        assert out_cons.label == ValidationLabel.METADATA_ERROR
        assert "title" in out_cons.mismatched_fields

    def test_rule1b_rule3b_and_rule4_block_contradictory_titles_even_when_semantic_high(self) -> None:
        rules = SymbolicRules()
        cand = SourceCandidate(
            source_name="openalex",
            found=True,
            title="Multimodal Fusion for Hate Speech Detection - A Transformer Based Approach",
            authors=["A. Kumar", "B. Rao"],
            year="2025",
            abstract="We investigate multimodal fusion of image and text encoders for hate speech detection in Dravidian languages.",
            confidence=0.92,
        )
        cited_stutter = "Multimodal Fusion for Hate Speech Detection for Hate Speech Detection"
        src = SourceResult(
            citation_raw=f"Kumar, A., & Rao, B. (2025). {cited_stutter}.",
            candidates=[cand],
            sources_queried=["openalex"],
            sources_succeeded=["openalex"],
        )
        # Rule 3b + Rule 1b: fuzzy=0.91 (< 0.92) with contradictory duplicated phrase -> METADATA_ERROR
        feat_3b = MatchFeatures(
            title_sim_fuzzy=0.91,
            title_sim_semantic=0.93,
            author_jaccard=1.0,
            year_distance=0,
            source_consensus=1,
        )
        out_1b = rules.apply(
            feat_3b,
            src,
            mapping_status=CitationMappingStatus.MATCHED,
            citation_authors=["A. Kumar", "B. Rao"],
            citation_year=2025,
            citation_title=cited_stutter,
            citation_raw=src.citation_raw,
        )
        assert out_1b.label == ValidationLabel.METADATA_ERROR
        assert "title" in out_1b.mismatched_fields

        out_3b = rules.apply(
            feat_3b,
            src,
            citation_authors=["A. Kumar", "B. Rao"],
            citation_year=2025,
            citation_title=cited_stutter,
            citation_raw=src.citation_raw,
        )
        assert out_3b.label == ValidationLabel.METADATA_ERROR
        assert "title" in out_3b.mismatched_fields

        # Rule 4 (R-CONTENT-ALIGNMENT): aligned context + high semantic (0.93) MUST NOT override
        # contradictory title (fuzzy=0.80 < 0.92)
        feat_r4 = MatchFeatures(
            title_sim_fuzzy=0.80,
            title_sim_semantic=0.93,
            author_jaccard=1.0,
            year_distance=0,
            source_consensus=2,
            content_alignment_score=0.78,
            content_alignment_confidence="high",
            content_is_aligned=True,
            stance_label="supported",
        )
        out_r4 = rules.apply(
            feat_r4,
            src,
            citation_authors=["A. Kumar", "B. Rao"],
            citation_year=2025,
            citation_title=cited_stutter,
            citation_raw=src.citation_raw,
        )
        assert out_r4.label == ValidationLabel.METADATA_ERROR
        assert "R-CONTENT-ALIGNMENT" not in out_r4.triggered_rules

    def test_baseline_runner_fallback_mirrors_lexical_title_floor(self) -> None:
        runner = BaselineRunner()
        pred = runner._predict_single(
            "proposed",
            {
                "title_sim_fuzzy": 0.78,
                "title_sim_semantic": 0.95,
                "author_jaccard": 1.0,
                "year_distance": 0,
                "doi_exact_match": False,
                "source_consensus": 2,
                "crossref_matched": True,
                "has_candidate": True,
            },
        )
        assert pred == "metadata_error"


class TestSemanticSpecificityAndMultilingualHygiene:
    """Stemmed discourse stopwords, Unicode callouts, foreign detection, and reporting frames."""

    def test_stemmed_discourse_stopwords_preserve_domain_vocabulary(self) -> None:
        # Inflected generic boilerplate is stripped
        boilerplate_stems = _extract_distinctive_stems(
            "Evaluations concluded that challenging observations revealed analyses requiring reliance."
        )
        assert boilerplate_stems == set()

        # CS/NLP/HCI domain words MUST remain distinctive (zero domain over-stripping)
        domain_stems = _extract_distinctive_stems(
            _CITATION_CALLOUT_STRIP_RE.sub(
                " ",
                "Vaswani et al. (2017) classify user documents to generate distinct complex cases.",
            )
        )
        assert len(domain_stems) >= 5
        assert {"classif", "user", "docu", "generat", "complex"}.issubset(domain_stems)

    def test_title_only_plural_acronym_symmetry_avoids_abstract_collision(self) -> None:
        # When title mentions "LLMs", echoed "LLM" in claim is excluded as title echo
        flagged_title_echo = _has_ungrounded_novel_claim(
            "Smith et al. (2024) report that an LLM achieves strong glacier meltwater hydrology forecasting across Alpine basins.",
            "Benchmarking LLMs on Symbolic Algebra",
            (
                "We present an algebraic theorem-proving benchmark for evaluating symbolic manipulation, "
                "polynomial factorization, and formal proof synthesis in automated reasoning systems."
            ),
            raw_sim=0.52,
        )
        assert flagged_title_echo is True

        # When title does NOT contain LLM, "LLMs" in claim must NOT accidentally ground on "LLM" in abstract
        flagged_no_collision = _has_ungrounded_novel_claim(
            "Smith et al. (2024) show that LLMs predict retinal vessel tortuosity on clinical fundus photographs.",
            "Parliamentary Speech Tagging",
            (
                "We evaluate an LLM on parliamentary roll-call voting transcripts and legislative "
                "committee debates collected across European national assemblies over two decades "
                "to study syntactic divergence and ideological polarization."
            ),
            raw_sim=0.52,
        )
        assert flagged_no_collision is True

    def test_unicode_particles_vietnamese_callouts_and_foreign_language_detection(self) -> None:
        # English prose with accented European callouts, particles, acronyms, and eponyms -> False (English)
        assert not _is_non_english_or_foreign_text(
            "Röttger et al. (2022) report that MIT and CoN architectures improve hate speech robustness."
        )
        assert not _is_non_english_or_foreign_text(
            "van der Berg (2020) and De La Cruz (2019) evaluate naïve Bayes classifiers alongside Das (2021)."
        )
        assert not _is_non_english_or_foreign_text(
            "Schrödinger, Müller, and Gödel equations govern quantum systems."
        )
        stripped_vn = _CITATION_CALLOUT_STRIP_RE.sub(
            " ", "Nguyễn và cộng sự (2023) cho thấy hiệu quả rõ rệt."
        )
        assert "Nguyễn" not in stripped_vn

        # Authentic English STEM titles with eponym particles / technical homographs must NOT be flagged foreign
        for stem_en in (
            "Silicon die thermal resistance modeling",
            "Para-aminobenzoic acid synthesis pathway",
            "Von Mises stress distribution model",
            "Van der Waals heterostructure transport",
        ):
            assert _is_non_english_or_foreign_text(stem_en) is False, stem_en

        # Curly apostrophes and 3-author Oxford-comma callouts strip cleanly
        stripped_curly = _CITATION_CALLOUT_STRIP_RE.sub(
            "", "O\u2019Brien (2020) demonstrates robust convergence in sparse graphs."
        ).strip()
        assert stripped_curly.startswith("demonstrates")
        stripped_three = _CITATION_CALLOUT_STRIP_RE.sub(
            "", "Smith, Jones, and Brown (2020) propose a new parser for Tamil."
        ).strip()
        assert stripped_three.startswith("propose")

        # Authentic short foreign academic phrases MUST be detected as non-English (True)
        for foreign_sent in (
            "Das Modell verwendet Aufmerksamkeitsmechanismen.",
            "Zur Übersetzung langer Sätze.",
            "Un modèle de langage neuronal.",
            "Análisis de sentimientos en redes sociales.",
            "Model pembelajaran mesin untuk klasifikasi teks.",
            "Sieć neuronowa do przetwarzania języka.",
        ):
            assert _is_non_english_or_foreign_text(foreign_sent) is True, foreign_sent

    def test_third_person_report_frame_vs_first_person_method_usage(self) -> None:
        abstract = (
            "We present a bilingual corpus of parliamentary debates aligned across sentence boundaries "
            "for studying syntactic divergence, pronoun coreference, and discourse connective translation "
            "in European Union legislative transcripts."
        )
        # Third-person attributed claim containing "in this paper, the authors train..." MUST be checked
        assert (
            _has_ungrounded_novel_claim(
                "In this paper [1], the authors train a retinal fundus glaucoma classifier on clinical radiographs.",
                "Parliamentary Debates Corpus",
                abstract,
                raw_sim=0.52,
            )
            is True
        )
        assert (
            _has_ungrounded_novel_claim(
                "Recent work by Müller et al. (2022) introduced a quantum gravity simulator for dark matter detection.",
                "Parliamentary Debates Corpus",
                abstract,
                raw_sim=0.52,
            )
            is True
        )
        # Genuine first-person adoption ("According to ..., we use ...") stays exempted
        assert (
            _has_ungrounded_novel_claim(
                "According to Vaswani et al. (2017), we use multi-head attention for retinal fundus glaucoma screening.",
                "Parliamentary Debates Corpus",
                abstract,
                raw_sim=0.52,
            )
            is False
        )
        assert (
            _has_ungrounded_novel_claim(
                "Using [1], this paper implements a retinal fundus glaucoma classifier on clinical radiographs.",
                "Parliamentary Debates Corpus",
                abstract,
                raw_sim=0.52,
            )
            is False
        )

    def test_critic_regressions_c1_c2_c4_and_m4_acronyms(self) -> None:
        from integrity_checker.logic.neuro_symbolic_checker import NeuroSymbolicChecker
        from integrity_checker.models.citation import Citation

        rules = SymbolicRules()

        # C1: R-CONTENT-ALIGNMENT must NOT bypass corrupted CJK title when local_db + openalex both succeed
        c_cjk, b_cjk = "基于GPT的中文语义理解方法", "基于BERT的中文语义理解方法"
        sim_cjk = FeatureCalculator.compute_title_similarity(c_cjk, b_cjk)
        assert _has_contradictory_title_tokens(c_cjk, None, b_cjk) is True
        cand_c1 = SourceCandidate(
            source_name="openalex",
            found=True,
            title=b_cjk,
            authors=["Li Wei"],
            year="2024",
            doi="10.1000/c1",
        )
        src_c1 = SourceResult(
            citation_raw=c_cjk,
            candidates=[cand_c1],
            sources_queried=["local_db", "openalex"],
            sources_succeeded=["local_db", "openalex"],
        )
        feat_c1 = MatchFeatures(
            title_sim_fuzzy=sim_cjk,
            title_sim_semantic=0.92,
            author_jaccard=1.0,
            year_distance=0,
            doi_exact_match=True,
            source_consensus=2,
            content_alignment_score=0.75,
            content_is_aligned=True,
        )
        out_c1 = rules.apply(
            feat_c1,
            src_c1,
            citation_title=c_cjk,
            citation_doi="10.1000/c1",
            citation_authors=["Li Wei"],
        )
        assert out_c1.label == ValidationLabel.METADATA_ERROR

        # C2: Explicit year-in-title substitution (2025 vs 2026) flags METADATA_ERROR even at sim=0.973
        c_yr, b_yr = "Global Critical Minerals Outlook 2025", "Global Critical Minerals Outlook 2026"
        sim_yr = FeatureCalculator.compute_title_similarity(c_yr, b_yr)
        assert sim_yr > 0.95
        cand_c2 = SourceCandidate(
            source_name="local_db",
            found=True,
            title=b_yr,
            authors=["A. Smith"],
            year="2025",
        )
        src_c2 = SourceResult(
            citation_raw=c_yr,
            candidates=[cand_c2],
            sources_queried=["local_db"],
            sources_succeeded=["local_db"],
        )
        feat_c2 = MatchFeatures(
            title_sim_fuzzy=sim_yr,
            title_sim_semantic=0.98,
            author_jaccard=1.0,
            year_distance=0,
            doi_exact_match=False,
            source_consensus=1,
        )
        out_c2 = rules.apply(feat_c2, src_c2, citation_title=c_yr, citation_authors=["A. Smith"])
        assert out_c2.label == ValidationLabel.METADATA_ERROR

        # C4: KNOWN_PAPERS must flag corrupted titles instead of accepting >= 0.50 as VERIFIED
        checker = NeuroSymbolicChecker(enable_content_alignment=False)
        for bad_t in ("BERT Is All You Need", "Attention Is All You Need for Speech Recognition", "Attention All Need"):
            cit = Citation(
                raw_text=f"Vaswani, A., Shazeer, N., Parmar, N. (2017). {bad_t}. NeurIPS.",
                title=bad_t,
                authors=["Ashish Vaswani", "Noam Shazeer", "Niki Parmar"],
                year="2017",
                venue="NeurIPS",
            )
            verdict = checker.check(
                cit, SourceResult(citation_raw=cit.raw_text, candidates=[], sources_queried=["crossref"], sources_succeeded=[])
            )
            assert verdict.label == ValidationLabel.METADATA_ERROR, bad_t

        # M3 + M4: Translated language bracket & single-word scientific acronym expansion must NOT false-trigger
        assert not _has_contradictory_title_tokens("Le rouge et le noir [in French]", None, "Le rouge et le noir")
        assert not _has_contradictory_title_tokens(
            "EEG Signal Classification Using CNN",
            None,
            "Electroencephalography Signal Classification Using CNN",
        )

    def test_catastrophic_survey_mention_below_025_not_exempted(self) -> None:
        abstract = (
            "We construct a dataset of molecular crystal lattices and compute phonon dispersion spectra "
            "using density functional theory for superconducting alloy discovery."
        )
        # Catastrophically off-topic survey mention (raw_sim < 0.25) is caught
        assert (
            _has_ungrounded_novel_claim(
                "In recent years, graph networks have revolutionized statutory courtroom litigation briefs.",
                "Molecular Crystal Phonons",
                abstract,
                raw_sim=0.14,
            )
            is True
        )
        # Moderate topical survey mention (raw_sim >= 0.25) remains exempted
        adj_sim, _, aligned = SemanticMatcher.calibrate_monolingual_specificity(
            0.54,
            "In recent years, crystal phonon methods have revolutionized alloy spectroscopy workflows.",
            "Molecular Crystal Phonons",
            abstract,
        )
        assert aligned is True
        assert adj_sim == pytest.approx(0.54)
