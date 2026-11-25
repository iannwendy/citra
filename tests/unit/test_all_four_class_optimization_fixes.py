"""Real-world and adversarial unit tests for the 4-Class Confusion Matrix Optimization (Tier 1 + Tier 2A).

Covers all critic-refined fixes across author matching, title normalization, symbolic rules,
and proportional semantic claim grounding, including explicit negative/adversarial guards:
1. Standalone surname particle preservation ('Du', 'Das', 'El', 'Van', 'De', 'Di') while
   keeping multi-token all-particle fragments ('van der') empty and East-Asian swaps intact.
2. South Asian / Hungarian single-letter patronymic surnames ('B, P.' <-> 'Premjith B',
   'V, V.' <-> 'Venktesh V', 'T., I.' <-> 'István Nagy T.') with reconciled author_match_details().
3. Title internal typographic quotes, '[in <language>]' bracket stripping, and non-alphanumeric
   acronym boundaries ('ACL2022', 'S2ORC' no longer self-contradict).
4. Zero-candidate removal of legacy hardcoded is_known_author blanket immunity, incomplete-entry
   preservation, Crossref+OpenAlex outage abstention, and truthful R-FAIL-ALL diagnostics.
5. Monotonic Rule 4a2 lexical floor vs. Rule 4g, plus consistent unmatched-coauthor guards across
   Rule 4b, Rule 5, and R-KNOWN-AUTHOR-WEAK-EVIDENCE.
6. Rule 4g multi-author complete-roster + selective-venue corroboration (strictly rejecting solo
   authors, initial conflicts, and preprint wrappers) and Rule 4d lead-author anti-dilution
   (while blocking single-hit dead-URL LLM decoys).
7. Tier 2A proportional lexical grounding deficit on substantive abstracts (preserving 3-stem
   synonym paraphrases, short abstracts, and higher-cosine human paraphrases).
"""

from __future__ import annotations

import pytest

from integrity_checker.logic.rules import SymbolicRules, _has_contradictory_title_tokens
from integrity_checker.matching.author_matcher import (
    _canonicalize_last_name,
    author_match_details,
    author_match_score,
)
from integrity_checker.matching.author_parser import Author
from integrity_checker.matching.features import FeatureCalculator
from integrity_checker.matching.semantic import _has_ungrounded_novel_claim
from integrity_checker.models.source import SourceCandidate, SourceResult
from integrity_checker.models.validation import MatchFeatures, ValidationLabel


class TestStandaloneParticleAndPatronymicAuthors:
    """Items 1 & 2: Global surname fairness + reconciled author_match_details()."""

    @pytest.mark.parametrize(
        ("cited", "candidate", "expected_canon"),
        [
            (["Du, Y."], ["Yucheng Du"], "du"),
            (["Du, W."], ["Weihong Du", "Jia Liu"], "du"),
            (["Das, S."], ["Sayan Das", "Soham Chaudhuri"], "das"),
            (["Das, M."], ["Mithun Das", "Animesh Mukherjee"], "das"),
            (["El, B."], ["Batu El", "Mert Yuksekgonul", "James Zou"], "el"),
            (["Van, H."], ["Hoang Van"], "van"),
            (["De, S."], ["Soumya De"], "de"),
            (["Di, W."], ["Wei Di"], "di"),
            (["Du Y."], ["Yucheng Du"], "du"),
        ],
    )
    def test_standalone_particle_surnames_preserved(
        self, cited: list[str], candidate: list[str], expected_canon: str
    ) -> None:
        assert _canonicalize_last_name(cited[0]) == expected_canon
        assert author_match_score(cited, candidate) == 1.0
        det = author_match_details(cited, candidate)
        assert det.score == 1.0
        assert expected_canon in det.matched
        assert det.only_cited == []

    def test_compound_particles_and_east_asian_swaps_with_particles(self) -> None:
        # Multi-token all-particle fragment remains empty (regression contract)
        assert _canonicalize_last_name("van der") == ""
        assert _canonicalize_last_name("van der, J.") == ""
        # Genuine nobiliary prefixes still strip to head surname
        assert _canonicalize_last_name("van der Berg, J.") == "berg"
        assert _canonicalize_last_name("de la Cruz, M.") == "cruz"
        assert _canonicalize_last_name("St. Clair, R.") == "clair"
        assert _canonicalize_last_name("J. van der Berg") == "berg"
        # East-Asian Family-First swapped names with particle surname still match
        assert author_match_score(["Du, Y."], ["Du Yu"]) == 1.0
        assert author_match_score(["Das, S."], ["Das Sayan"]) == 1.0
        assert author_match_score(["Du, Y."], ["John Smith"]) == 0.0

    @pytest.mark.parametrize(
        ("cited", "candidate"),
        [
            (["B, P."], ["Premjith B", "Bharathi Raja Chakravarthi"]),
            (["V, V."], ["Venktesh V", "Mandeep Rathee", "Avishek Anand"]),
            (["V, V."], ["Venkata Subramanian V"]),
            (["N, P."], ["Prasanth S N", "R Aswin Raj"]),
            (["N, D."], ["Diviya K N", "Mrinalini K"]),
            (["K, N."], ["Nithish Ariyha K", "Eshwanth Karti T R"]),
            (["R, P."], ["Ponsubash Raj R", "Paruvatha Priya B"]),
            (["L, S."], ["Sobha L"]),
            (["C, J."], ["Jesus Alvarez C", "Daua Karajeanes"]),
            (["K, S.", "S, S."], ["Sulaksha B K", "Shruti Krishnaveni S", "Ivana Steeve"]),
            (["Vincze, V.", "T., I."], ["Veronika Vincze", "István Nagy T.", "Gábor Berend"]),
            (["Kolavi, A.", "P, S."], ["Adithya Kolavi", "Samarth P", "Vyoman Jain"]),
        ],
    )
    def test_single_letter_patronymic_surnames_match_and_reconcile_details(
        self, cited: list[str], candidate: list[str]
    ) -> None:
        assert author_match_score(cited, candidate) == 1.0
        det = author_match_details(cited, candidate)
        assert det.score == 1.0
        assert det.only_cited == []
        assert len(det.matched) == len(cited)
        # Reconciled candidate remainder excludes consumed patronymic given-name tokens
        assert len(det.only_candidate) == max(0, len(candidate) - len(cited))

    def test_single_letter_patronymic_author_dataclass_and_negative_guards(self) -> None:
        # Synthetic Author objects without .raw still reconcile cleanly
        a_cited = Author(last_name="B", initials=["P"], raw="")
        a_cand = Author(last_name="Premjith", initials=["B"], raw="")
        assert author_match_score([a_cited], [a_cand]) == 1.0

        # Negative guards: never match full surnames or mismatched initials or bare letters
        assert author_match_score(["B, P."], ["Paul Brown"]) == 0.0
        assert author_match_score(["B, P."], ["Sayan B"]) == 0.0
        assert author_match_score(["B"], ["Premjith B"]) == 0.0
        assert author_match_score(["Smith, J."], ["Jones, S."]) == 0.0

        # Reviewer catch #2: Author(raw="") with full_first_names must NOT false-match as patronymic
        a_pat = Author(last_name="P", initials=["B"], raw="")
        a_brown = Author(last_name="Brown", full_first_names=["Paul"], initials=["P"], raw="")
        assert author_match_score([a_pat], [a_brown]) == 0.0

    def test_one_to_one_candidate_claiming_and_shared_surname_reconciliation(self) -> None:
        # Reviewer catch #1a: Two distinct cited authors must NOT collapse onto 1 candidate author
        det_du = author_match_details(["Du, Y.", "Yu, D."], ["Du Yu"])
        assert det_du.score < 1.0
        assert det_du.only_cited == ["du"]

        det_pat = author_match_details(["B, P.", "Premjith, B."], ["Premjith B"])
        assert det_pat.score < 1.0
        assert det_pat.only_cited == ["b"]

        det_wei = author_match_details(["Wei, G.", "Guodong, W."], ["Wei Guodong"])
        assert det_wei.score < 1.0
        assert det_wei.only_cited == ["wei"]

        # Reviewer catch #1b: Shared patronymic surname across 2 authors reconciles BOTH candidates
        det_shared = author_match_details(["B, P.", "B, S."], ["Premjith B", "Suresh B"])
        assert det_shared.score == 1.0
        assert det_shared.only_cited == []
        assert det_shared.only_candidate == []


class TestTitleQuotesLanguageTagsAndAcronymBounds:
    """Item 3: Internal typographic quotes, language brackets, and acronym boundary fix."""

    def test_internal_typographic_quotes_before_subtitle_colon(self) -> None:
        sim = FeatureCalculator.compute_title_similarity(
            "The Phonetic Variants of Taiwanese Voiced Stops",
            "The Phonetic Variants of Taiwanese “Voiced” Stops: an Airflow Study",
        )
        assert sim == pytest.approx(0.95)
        # Adjacent quotes without whitespace must not glue separate words
        assert FeatureCalculator.compute_title_similarity("foo bar", 'foo"bar') == pytest.approx(1.0)
        # Genuine subtitle fabrication still rejected
        assert FeatureCalculator.compute_title_similarity(
            "Attention Is All You Need: Quantum Neural Cryptography Across Blockchains",
            "Attention Is All You Need",
        ) < 0.85

    def test_language_bracket_stripped_without_breaking_bilingual_alt_titles(self) -> None:
        main_fr, alts_fr = FeatureCalculator._strip_medium_tags_and_extract_alt_titles(
            "A Tool for the Automatic Insertion of Diacritics in French [in French]"
        )
        assert main_fr == "A Tool for the Automatic Insertion of Diacritics in French"
        assert alts_fr == []

        main_no, alts_no = FeatureCalculator._strip_medium_tags_and_extract_alt_titles(
            "Determinisme og syntaktisk flertydighet [In Norwegian]"
        )
        assert main_no == "Determinisme og syntaktisk flertydighet"
        assert alts_no == []

        # Genuine translated bracketed title is still extracted as alt title
        main_bi, alts_bi = FeatureCalculator._strip_medium_tags_and_extract_alt_titles(
            "Nghiên cứu chuyển đổi số [A study on digital transformation]"
        )
        assert main_bi == "Nghiên cứu chuyển đổi số"
        assert alts_bi == ["A study on digital transformation"]

    def test_alphanumeric_acronyms_never_self_contradict(self) -> None:
        title_acl = (
            "CEN-Tamil@DravidianLangTech-ACL2022: Abusive Comment detection in Tamil "
            "using TF-IDF and Random Kitchen Sink Algorithm"
        )
        assert _has_contradictory_title_tokens(title_acl, None, title_acl) is False
        title_s2 = "S2ORC: The Semantic Scholar Open Research Corpus with GPT3 Benchmarks"
        assert _has_contradictory_title_tokens(title_s2, None, title_s2) is False
        # Genuine alien acronym still flagged
        assert _has_contradictory_title_tokens(
            "Applying CNN to Sentiment Analysis",
            None,
            "Applying BERT to Sentiment Analysis",
        ) is True


class TestZeroCandidateKnownAuthorAndFailAll:
    """Item 4: No blanket immunity for famous authors when >=2 registries cleanly return 0 hits."""

    def test_fabricated_paper_by_famous_author_zero_hits_is_hallucination_not_fail_all(self) -> None:
        rules = SymbolicRules()
        raw = "Kennard, N. N., & Manning, C. D. (2023). Evaluating Evaluation Metrics on Multiword Recognition. MWE Workshop."
        source = SourceResult(
            citation_raw=raw,
            candidates=[],
            sources_queried=["crossref", "openalex", "dblp"],
            sources_succeeded=[],
            sources_failed={
                "crossref": "Crossref: no results for query",
                "openalex": "OpenAlex: no results for query",
            },
        )
        out = rules.apply(
            MatchFeatures(),
            source,
            citation_authors=["Neha Nayak Kennard", "Christopher D. Manning"],
            citation_year="2023",
            citation_venue="Proceedings of the Workshop on Multiword Expressions",
            citation_raw=raw,
        )
        assert out.label == ValidationLabel.SUSPECTED_HALLUCINATION
        assert "R-NO-SCHOLARLY-RECORD" in out.triggered_rules
        assert "R-FAIL-ALL" not in out.triggered_rules

    def test_fabricated_dead_url_by_famous_author_zero_hits_is_hallucination(self) -> None:
        rules = SymbolicRules()
        raw = "Xiong, C., & Socher, R. (2023). Machine Translation in Subjective Expressions. CoNLL. https://aclanthology.org/2023.conll-1.9999.pdf"
        source = SourceResult(
            citation_raw=raw,
            candidates=[],
            sources_queried=["crossref", "openalex"],
            sources_succeeded=[],
            sources_failed={
                "crossref": "Crossref: no results for query",
                "openalex": "OpenAlex: no results for query",
            },
            url_status="dead_link",
            url_status_code=404,
        )
        out = rules.apply(
            MatchFeatures(),
            source,
            citation_authors=["Caiming Xiong", "Richard Socher"],
            citation_year="2023",
            citation_url="https://aclanthology.org/2023.conll-1.9999.pdf",
            citation_raw=raw,
        )
        assert out.label == ValidationLabel.SUSPECTED_HALLUCINATION
        assert "R-DEAD-URL" in out.triggered_rules
        assert "R-FAIL-ALL" not in out.triggered_rules

    def test_incomplete_reference_by_famous_author_still_metadata_error_not_hallucination(self) -> None:
        rules = SymbolicRules()
        raw = "Hinton et al."
        source = SourceResult(
            citation_raw=raw,
            candidates=[],
            sources_queried=["crossref", "openalex"],
            sources_succeeded=[],
            sources_failed={
                "crossref": "Crossref: no results for query",
                "openalex": "OpenAlex: no results for query",
            },
        )
        out = rules.apply(
            MatchFeatures(),
            source,
            citation_authors=["Hinton, G."],
            citation_year=None,
            citation_venue=None,
            citation_raw=raw,
        )
        assert out.label == ValidationLabel.METADATA_ERROR
        assert "R-INCOMPLETE-METADATA" in out.triggered_rules

    def test_primary_graph_timeout_outage_abstains_even_when_narrow_dbs_return_empty(self) -> None:
        rules = SymbolicRules()
        raw = "Gomez, R. (2021). Clinical Outcomes of Laparoscopic Nephrectomy. Journal of Urology, 205(3), 810-817."
        source = SourceResult(
            citation_raw=raw,
            candidates=[],
            sources_queried=["crossref", "openalex", "dblp", "arxiv"],
            sources_succeeded=[],
            sources_failed={
                "crossref": "Crossref: request timeout",
                "openalex": "OpenAlex: HTTP 503 service unavailable",
                "dblp": "DBLP: no results for query",
                "arxiv": "arXiv: no results for query",
            },
        )
        out = rules.apply(
            MatchFeatures(),
            source,
            citation_authors=["Gomez, R."],
            citation_year="2021",
            citation_venue="Journal of Urology",
            citation_raw=raw,
        )
        assert out.label == ValidationLabel.UNRESOLVED
        assert "R-FAIL-ALL" not in out.triggered_rules


class TestMonotonicRule4a2Rule4bRule4gAndRule4d:
    """Items 5 & 6: Single-source semantic abstention, monotonic 4a2/4g, multi-author roster, dead-URL anti-dilution."""

    def test_single_source_semantic_only_u1_abstains_to_unresolved(self) -> None:
        rules = SymbolicRules()
        cand = SourceCandidate(
            source_name="openalex",
            found=True,
            title="Spoken Language Systems",
            authors=["John Makhoul"],
            year="1994",
            venue="Proceedings of ARPA",
            confidence=0.75,
        )
        source = SourceResult(
            citation_raw="Makhoul, J., & Rosenthal, S. (1995). Spoken Linguistic Systems: Working Draft on Boundary Conditions. arXiv Preprint.",
            candidates=[cand],
            sources_queried=["crossref", "openalex"],
            sources_succeeded=["openalex"],
        )
        feat = MatchFeatures(
            title_sim_fuzzy=0.435,
            title_sim_semantic=0.649,
            author_jaccard=1.0,
            year_distance=1,
            doi_exact_match=False,
            source_consensus=1,
            venue_sim=0.0,
        )
        out = rules.apply(
            feat,
            source,
            citation_title="Spoken Linguistic Systems: Working Draft on Boundary Conditions",
            citation_authors=["John Makhoul", "Sara Rosenthal"],
            citation_year="1995",
            citation_venue="arXiv Preprint",
            citation_raw=source.citation_raw,
        )
        assert out.label == ValidationLabel.UNRESOLVED
        assert "R-ABSTENTION-BORDER" in out.triggered_rules

    def test_monotonicity_across_title_sim_0_60_boundary_between_4g_and_4a2(self) -> None:
        rules = SymbolicRules()
        cand = SourceCandidate(
            source_name="openalex",
            found=True,
            title="Detecting Errors in Discontinuous Structural Annotation",
            authors=["Markus Dickinson", "W. Detmar Meurers"],
            year="2005",
            venue="Proceedings of ACL",
            confidence=0.85,
        )
        source = SourceResult(
            citation_raw="Dickinson, M., & Meurers, W. D. (2005). Detecting Errors for Preference Learning. Proceedings of ACL.",
            candidates=[cand],
            sources_queried=["crossref", "openalex"],
            sources_succeeded=["openalex"],
        )
        for ts_val in (0.59, 0.61):
            feat = MatchFeatures(
                title_sim_fuzzy=0.53,
                title_sim_semantic=ts_val,
                author_jaccard=1.0,
                year_distance=0,
                doi_exact_match=False,
                source_consensus=1,
                venue_sim=1.0,
            )
            out = rules.apply(
                feat,
                source,
                citation_title="Detecting Errors for Preference Learning",
                citation_authors=["Markus Dickinson", "W. Detmar Meurers"],
                citation_year="2005",
                citation_venue="Proceedings of ACL",
                citation_raw=source.citation_raw,
            )
            assert out.label == ValidationLabel.METADATA_ERROR

    def test_known_author_with_unmatched_coauthor_does_not_bypass_to_metadata_error(self) -> None:
        rules = SymbolicRules()
        cand = SourceCandidate(
            source_name="openalex",
            found=True,
            title="Combining Multi-Engine Machine Translation and Online Learning through Dynamic Phrase Tables",
            authors=["Rico Sennrich"],
            year="2012",
            venue="ACL",
            confidence=0.80,
        )
        source = SourceResult(
            citation_raw="Sennrich, R., & Jäppinen, H. (2014). Combining Document-Level Automated Transduction Frameworks. ACL.",
            candidates=[cand],
            sources_queried=["crossref", "openalex"],
            sources_succeeded=["openalex"],
        )
        for tf_val, ts_val in ((0.487, 0.356), (0.34, 0.31)):
            feat = MatchFeatures(
                title_sim_fuzzy=tf_val,
                title_sim_semantic=ts_val,
                author_jaccard=1.0,
                year_distance=2,
                doi_exact_match=False,
                source_consensus=1,
                venue_sim=1.0,
            )
            out = rules.apply(
                feat,
                source,
                citation_title="Combining Document-Level Automated Transduction Frameworks",
                citation_authors=["Rico Sennrich", "Harri Jäppinen"],
                citation_year="2014",
                citation_venue="ACL",
                citation_raw=source.citation_raw,
            )
            assert out.label == ValidationLabel.UNRESOLVED

    def test_rule_4g_exact_multi_author_and_selective_venue_vs_negative_guards(self) -> None:
        rules = SymbolicRules()
        # Positive: exact 2-author roster + exact selective venue + yd=2 + tf=0.46 -> METADATA_ERROR
        cand = SourceCandidate(
            source_name="openalex",
            found=True,
            title="Fine-Grained Entity Typing with High-Multiplicity Assignments",
            authors=["Maxim Rabinovich", "Dan Klein"],
            year="2017",
            venue="Proceedings of the Annual Meeting of the Association for Computational Linguistics",
            confidence=0.85,
        )
        src = SourceResult(
            citation_raw="Rabinovich, M., & Klein, D. (2019). Fine-Grained Entity for Argumentation Strategies. ACL.",
            candidates=[cand],
            sources_queried=["crossref", "openalex"],
            sources_succeeded=["openalex"],
        )
        feat = MatchFeatures(
            title_sim_fuzzy=0.46,
            title_sim_semantic=0.43,
            author_jaccard=1.0,
            year_distance=2,
            source_consensus=1,
            venue_sim=1.0,
        )
        out_pos = rules.apply(
            feat,
            src,
            citation_title="Fine-Grained Entity for Argumentation Strategies",
            citation_authors=["Maxim Rabinovich", "Dan Klein"],
            citation_year="2019",
            citation_venue="Proceedings of the Annual Meeting of the Association for Computational Linguistics",
            citation_raw=src.citation_raw,
        )
        assert out_pos.label == ValidationLabel.METADATA_ERROR
        assert "R-TITLE-MISMATCH" in out_pos.triggered_rules

        # Negative 1: solo author (len == 1) stays UNRESOLVED even with venue_sim=1.0 & yd=0
        cand_solo = SourceCandidate(
            source_name="openalex",
            found=True,
            title="Backwards Phonology",
            authors=["Xiao Wang"],
            year="2022",
            venue="Proceedings of COLING",
            confidence=0.80,
        )
        src_solo = SourceResult(
            citation_raw="Wang, Y. (2022). Backwards for Sequence Modeling. Proceedings of COLING.",
            candidates=[cand_solo],
            sources_queried=["crossref", "openalex"],
            sources_succeeded=["openalex"],
        )
        out_solo = rules.apply(
            MatchFeatures(
                title_sim_fuzzy=0.48,
                title_sim_semantic=0.30,
                author_jaccard=1.0,
                year_distance=0,
                source_consensus=1,
                venue_sim=1.0,
            ),
            src_solo,
            citation_title="Backwards for Sequence Modeling",
            citation_authors=["Wang, Y."],
            citation_year="2022",
            citation_venue="Proceedings of COLING",
            citation_raw=src_solo.citation_raw,
        )
        assert out_solo.label == ValidationLabel.UNRESOLVED

        # Negative 2: conflicting given-name initials on 2-author roster stays UNRESOLVED
        cand_init = SourceCandidate(
            source_name="openalex",
            found=True,
            title="Neural Parsing under Low Resources",
            authors=["Xiao Wang", "Bo Li"],
            year="2022",
            venue="Proceedings of EMNLP",
            confidence=0.80,
        )
        src_init = SourceResult(
            citation_raw="Wang, Y., & Li, A. (2022). Neural Parsing for Vision. EMNLP.",
            candidates=[cand_init],
            sources_queried=["crossref", "openalex"],
            sources_succeeded=["openalex"],
        )
        out_init = rules.apply(
            MatchFeatures(
                title_sim_fuzzy=0.46,
                title_sim_semantic=0.40,
                author_jaccard=1.0,
                year_distance=0,
                source_consensus=1,
                venue_sim=1.0,
            ),
            src_init,
            citation_title="Neural Parsing for Vision",
            citation_authors=["Wang, Y.", "Li, A."],
            citation_year="2022",
            citation_venue="Proceedings of EMNLP",
            citation_raw=src_init.citation_raw,
        )
        assert out_init.label == ValidationLabel.UNRESOLVED

        # Negative 3: generic preprint wrapper ('arXiv') must NOT count as selective venue
        cand_arxiv = SourceCandidate(
            source_name="openalex",
            found=True,
            title="Fine-Grained Entity Typing with High-Multiplicity Assignments",
            authors=["Maxim Rabinovich", "Dan Klein"],
            year="2017",
            venue="arXiv Preprint",
            confidence=0.80,
        )
        src_arxiv = SourceResult(
            citation_raw="Rabinovich, M., & Klein, D. (2019). Fine-Grained Entity for Argumentation Strategies. arXiv Preprint.",
            candidates=[cand_arxiv],
            sources_queried=["crossref", "openalex"],
            sources_succeeded=["openalex"],
        )
        out_arxiv = rules.apply(
            feat,
            src_arxiv,
            citation_title="Fine-Grained Entity for Argumentation Strategies",
            citation_authors=["Maxim Rabinovich", "Dan Klein"],
            citation_year="2019",
            citation_venue="arXiv Preprint",
            citation_raw=src_arxiv.citation_raw,
        )
        assert out_arxiv.label == ValidationLabel.UNRESOLVED

    def test_rule_4d_many_author_lead_anti_dilution_vs_dead_url_decoy(self) -> None:
        rules = SymbolicRules()
        # Positive: real 9-author paper with link rot (aj=0.10 < 0.15) but lead author + cons=2 + tf=0.56
        cand_real = SourceCandidate(
            source_name="crossref",
            found=True,
            title="CoDesc: A Large Code-Description Parallel Dataset",
            authors=[
                "Masum Hasan", "Tanveer Muttaqueen", "Abdullah Al Ishtiaq",
                "Kazi Sajeed Mehrab", "Md. Mahim Anjum Haque", "Tahmid Hasan",
                "Wasi Ahmad", "Anindya Iqbal", "Rifat Shahriyar",
            ],
            year="2021",
            venue="Findings of the Association for Computational Linguistics",
            confidence=0.90,
        )
        src_real = SourceResult(
            citation_raw="Hasan, M., Yaneva, V., & Labeau, M. (2025). CoDesc: A Large for Knowledge-grounded Conversational Systems.",
            candidates=[cand_real, cand_real],
            sources_queried=["crossref", "openalex"],
            sources_succeeded=["crossref", "openalex"],
            url_status="dead_link",
            url_status_code=404,
        )
        out_real = rules.apply(
            MatchFeatures(
                title_sim_fuzzy=0.56,
                title_sim_semantic=0.34,
                author_jaccard=0.10,
                year_distance=4,
                source_consensus=2,
                venue_sim=1.0,
            ),
            src_real,
            citation_title="CoDesc: A Large for Knowledge-grounded Conversational Systems",
            citation_authors=["Masum Hasan", "Victoria Yaneva", "Matthieu Labeau"],
            citation_year="2025",
            citation_venue="Findings of the Association for Computational Linguistics",
            citation_raw=src_real.citation_raw,
        )
        assert out_real.label == ValidationLabel.METADATA_ERROR
        assert "R-DOMAIN-EXCEPTION" in out_real.triggered_rules

        # Negative (Critic decoy): single-hit 4-year dead-URL fabrication with wrong venue stays HALLUCINATION
        cand_decoy = SourceCandidate(
            source_name="openalex",
            found=True,
            title="Deep Residual Learning for Image Recognition",
            authors=["Kaiming He", "Xiangyu Zhang", "Shaoqing Ren", "Jian Sun"],
            year="2016",
            venue="CVPR",
            confidence=0.70,
        )
        src_decoy = SourceResult(
            citation_raw="He, K., Fake1, A., Fake2, B., Fake3, C. (2020). Deep Residual Networks for Underwater Sonar. https://dead.org/p.pdf",
            candidates=[cand_decoy],
            sources_queried=["crossref", "openalex"],
            sources_succeeded=["openalex"],
            url_status="dead_link",
            url_status_code=404,
        )
        out_decoy = rules.apply(
            MatchFeatures(
                title_sim_fuzzy=0.46,
                title_sim_semantic=0.42,
                author_jaccard=0.09,
                year_distance=4,
                source_consensus=1,
                venue_sim=0.0,
            ),
            src_decoy,
            citation_title="Deep Residual Networks for Underwater Sonar",
            citation_authors=["Kaiming He", "A. Fake1", "B. Fake2", "C. Fake3"],
            citation_year="2020",
            citation_venue="Journal of Marine Acoustics",
            citation_url="https://dead.org/p.pdf",
            citation_raw=src_decoy.citation_raw,
        )
        assert out_decoy.label == ValidationLabel.SUSPECTED_HALLUCINATION
        assert "R-DEAD-URL" in out_decoy.triggered_rules

    def test_rule_4e_does_not_preempt_semantic_border_on_scholarly_url_and_lead_author_swaps(self) -> None:
        from integrity_checker.logic.rules import _lead_author_compatible

        # Reviewer catch #4: _lead_author_compatible supports patronymic & East-Asian swapped lead authors
        assert _lead_author_compatible(["B, P.", "V, V."], ["Premjith B", "Venktesh V"]) is True
        assert _lead_author_compatible(["Du, Y.", "Li, X."], ["Du Yu", "Li Xia"]) is True

        # Reviewer catch #3: live scholarly paper URL on single-source semantic border stays UNRESOLVED
        rules = SymbolicRules()
        cand = SourceCandidate(
            source_name="openalex",
            found=True,
            title="Spoken Language Systems",
            authors=["John Makhoul"],
            year="1994",
            venue="Proceedings of ARPA",
            confidence=0.75,
        )
        src = SourceResult(
            citation_raw="Makhoul, J., & Rosenthal, S. (1995). Spoken Linguistic Systems. https://aclanthology.org/P95-1001",
            candidates=[cand],
            sources_queried=["crossref", "openalex"],
            sources_succeeded=["openalex"],
            url_status="alive",
            url_status_code=200,
        )
        out = rules.apply(
            MatchFeatures(
                title_sim_fuzzy=0.435,
                title_sim_semantic=0.649,
                author_jaccard=1.0,
                year_distance=1,
                doi_exact_match=False,
                source_consensus=1,
                venue_sim=0.0,
            ),
            src,
            citation_title="Spoken Linguistic Systems",
            citation_authors=["John Makhoul", "Sara Rosenthal"],
            citation_year="1995",
            citation_url="https://aclanthology.org/P95-1001",
            citation_raw=src.citation_raw,
        )
        assert out.label == ValidationLabel.UNRESOLVED
        assert "R-ABSTENTION-BORDER" in out.triggered_rules


class TestTier2AProportionalLexicalGrounding:
    """Item 7: Conservative proportional grounding deficit preserving genuine human paraphrases."""

    SUBSTANTIVE_ABS = (
        "Abstractive summarization of long clinical discharge notes requires faithful preservation "
        "of medication dosages, laboratory biomarkers, diagnostic codes, and longitudinal treatment "
        "timelines. We introduce a hierarchical encoder-decoder transformer augmented with entity-graph "
        "attention and factual consistency reranking across multi-visit hospital records, reducing "
        "hallucinated contraindications and improving physician preference ratings on MIMIC-III."
    )

    def test_detailed_misattributed_claim_with_single_accidental_overlap_caught(self) -> None:
        # 10+ unrelated technical stems from computer vision / reinforcement learning sharing only
        # 1 incidental stem ('hierarch') at low cosine (0.37) -> caught!
        misattributed = (
            "Smith et al. (2023) showed that hierarchical quadruped locomotion policies trained via "
            "proximal policy optimization generalize across icy gravel terrains using proprioceptive "
            "torque actuators and sim-to-real domain randomization."
        )
        assert _has_ungrounded_novel_claim(
            misattributed,
            "Clinical Discharge Summarization",
            self.SUBSTANTIVE_ABS,
            raw_sim=0.37,
        ) is True

    def test_three_stem_synonym_paraphrase_and_higher_cosine_paraphrase_preserved(self) -> None:
        # Critic counterexample 1: 3-stem synonym paraphrase at sim=0.41 MUST NOT trigger
        bert_abs = (
            "We introduce a new language representation model called BERT, which stands for "
            "Bidirectional Encoder Representations from Transformers. Unlike recent language "
            "representation models, BERT is designed to pre-train deep bidirectional representations "
            "from unlabeled text by jointly conditioning on both left and right context in all layers "
            "using masked language models and next sentence prediction."
        )
        short_synonym_paraphrase = (
            "Devlin et al. (2019) trained a cloze denoising objective on unannotated corpora."
        )
        assert _has_ungrounded_novel_claim(
            short_synonym_paraphrase,
            "BERT: Pre-training of Deep Bidirectional Transformers",
            bert_abs,
            raw_sim=0.41,
        ) is False

        # Critic counterexample 2: genuine paraphrase with 1 shared stem at higher cosine (0.55) preserved
        higher_cos_paraphrase = (
            "The hierarchical method compresses electronic health histories into concise summaries "
            "for bedside doctors while safeguarding patient safety during hospital handoffs."
        )
        assert _has_ungrounded_novel_claim(
            higher_cos_paraphrase,
            "Clinical Discharge Summarization",
            self.SUBSTANTIVE_ABS,
            raw_sim=0.55,
        ) is False

        # Critic counterexample 3: short 25-word abstract (< 12 stems) MUST NOT trigger proportional branch
        short_abs = (
            "This paper studies hierarchical neural networks for summarizing clinical patient documents "
            "across hospitals and reports encouraging empirical improvements over standard baselines."
        )
        assert _has_ungrounded_novel_claim(
            higher_cos_paraphrase,
            "Clinical Discharge Summarization",
            short_abs,
            raw_sim=0.39,
        ) is False

    def test_proportional_grounding_exact_thresholds(self) -> None:
        # Exactly 7 non-title stems (1 grounded: 'hierarch') against >=12-stem abstract -> fires at 0.41, not 0.42
        claim_7 = (
            "Smith et al. (2023) showed hierarchical quadruped locomotion policies traverse slippery terrains."
        )
        assert _has_ungrounded_novel_claim(
            claim_7, "Clinical Discharge Summarization", self.SUBSTANTIVE_ABS, raw_sim=0.41
        ) is True
        assert _has_ungrounded_novel_claim(
            claim_7, "Clinical Discharge Summarization", self.SUBSTANTIVE_ABS, raw_sim=0.42
        ) is False

        # Exactly 8 non-title stems (1 grounded: 'hierarch') against >=15-stem abstract -> fires at 0.44, not 0.45
        claim_8 = (
            "Smith et al. (2023) showed hierarchical quadruped locomotion policies traverse slippery gravel terrains."
        )
        assert _has_ungrounded_novel_claim(
            claim_8, "Clinical Discharge Summarization", self.SUBSTANTIVE_ABS, raw_sim=0.44
        ) is True
        assert _has_ungrounded_novel_claim(
            claim_8, "Clinical Discharge Summarization", self.SUBSTANTIVE_ABS, raw_sim=0.45
        ) is False
