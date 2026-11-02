"""Tests for bug fixes in citation patterns (2026-09-29).

These tests verify that overly permissive patterns do not match
false positive citations.

Bug: TranThanhPhuoc_523H0002_523H0054.pdf returned 485 citations
instead of ~80 because:
  - mla/acs/ama patterns matched data and non-citation text
  - These formats were REMOVED from auto-registration in __init__.py

After fix: MLA, ACS, AMA removed from default registry.
Remaining formats: APA, IEEE, Numeric, Vancouver, Harvard, ACM, Nature, CSE, Chicago
"""

from __future__ import annotations

from integrity_checker.extraction.patterns import (
    get_format,
    get_in_text_patterns,
)


class TestRemovedFormatsNotRegistered:
    """Tests verifying MLA, ACS, AMA are registered with safe patterns only."""

    def test_mla_registered_without_permissive_parenthetical(self):
        """MLA format should be registered without bare (Author) pattern."""
        mla = get_format("MLA")
        assert mla is not None
        pattern_names = [p.name for p in mla.in_text_patterns]
        assert "mla_intext_parenthetical_page" in pattern_names
        assert "mla_intext_parenthetical" not in pattern_names

    def test_acs_registered_without_parenthesized(self):
        """ACS format should be registered without bare (1) or comma-separated number patterns."""
        acs = get_format("ACS")
        assert acs is not None
        pattern_names = [p.name for p in acs.in_text_patterns]
        assert "acs_superscript" in pattern_names
        assert "acs_parenthesized" not in pattern_names
        assert "acs_comma_separated" not in pattern_names

    def test_ama_registered_without_parenthesized(self):
        """AMA format should be registered without bare (1) or comma-separated number patterns."""
        ama = get_format("AMA")
        assert ama is not None
        pattern_names = [p.name for p in ama.in_text_patterns]
        assert "ama_superscript" in pattern_names
        assert "ama_parenthesized" not in pattern_names
        assert "ama_comma_separated" not in pattern_names


class TestRemainingFormatsWork:
    """Tests verifying remaining formats still work correctly."""

    def test_ieee_still_registered(self):
        """IEEE format should still be registered."""
        ieee = get_format("IEEE")
        assert ieee is not None
        pattern_names = [p.name for p in ieee.in_text_patterns]
        assert "ieee_numeric" in pattern_names

    def test_apa_still_registered(self):
        """APA format should still be registered."""
        apa = get_format("APA")
        assert apa is not None
        pattern_names = [p.name for p in apa.in_text_patterns]
        assert "apa_intext_parenthetical" in pattern_names
        assert "apa_intext_narrative" in pattern_names

    def test_vancouver_still_registered(self):
        """Vancouver format should still be registered."""
        vanc = get_format("Vancouver")
        assert vanc is not None
        pattern_names = [p.name for p in vanc.in_text_patterns]
        assert "vancouver_numeric" in pattern_names

    def test_harvard_still_registered(self):
        """Harvard format should still be registered."""
        harv = get_format("Harvard")
        assert harv is not None
        pattern_names = [p.name for p in harv.in_text_patterns]
        assert "harvard_parenthetical_comma" in pattern_names

    def test_nature_still_registered(self):
        """Nature format should still be registered."""
        nature = get_format("Nature")
        assert nature is not None
        pattern_names = [p.name for p in nature.in_text_patterns]
        assert "nature_bracketed" in pattern_names

    def test_cse_still_registered(self):
        """CSE format should still be registered."""
        cse = get_format("CSE")
        assert cse is not None
        pattern_names = [p.name for p in cse.in_text_patterns]
        assert "cse_superscript" in pattern_names
        assert "cse_bracketed" in pattern_names
        # cse_parenthesized should be removed from in_text_patterns
        assert "cse_parenthesized" not in pattern_names

    def test_chicago_still_registered(self):
        """Chicago format should still be registered."""
        chi = get_format("Chicago")
        assert chi is not None

    def test_acm_still_registered(self):
        """ACM format should still be registered."""
        acm = get_format("ACM")
        assert acm is not None


class TestCSERemovedParensFromInText:
    """Tests verifying CSE parenthesized pattern was removed from in_text."""

    def test_cse_no_parenthesized_in_intext(self):
        """CSE in_text_patterns should NOT include parenthesized."""
        cse = get_format("CSE")
        pattern_names = [p.name for p in cse.in_text_patterns]
        assert "cse_parenthesized" not in pattern_names, (
            "cse_parenthesized should be removed from in_text_patterns"
        )

    def test_cse_still_has_superscript_and_bracketed(self):
        """CSE should still have legitimate in-text patterns."""
        cse = get_format("CSE")
        pattern_names = [p.name for p in cse.in_text_patterns]
        assert "cse_superscript" in pattern_names
        assert "cse_bracketed" in pattern_names
        assert "cse_nameyear_parenthetical" in pattern_names
        assert "cse_nameyear_parenthetical_nocomma" in pattern_names

    def test_cse_nameyear_still_works(self):
        """CSE Name-Year patterns should still function."""
        cse = get_format("CSE")
        patterns = cse.in_text_patterns
        nameyear = next(p for p in patterns if p.name == "cse_nameyear_parenthetical")

        # Should match legitimate CSE Name-Year citations
        assert nameyear.search("(Smith, 2020)") is not None
        assert nameyear.search("(Smith et al., 2019)") is not None
        assert nameyear.search("(Vaswani, 2017)") is not None


class TestPatternCountReduction:
    """Verify false-positive patterns remain excluded while all 11 formats are registered."""

    def test_in_text_pattern_count(self):
        """Total in_text_patterns should be 30 across all 11 registered formats."""
        patterns = get_in_text_patterns()
        assert len(patterns) == 30, f"Expected 30 patterns, got {len(patterns)}"

    def test_no_permissive_patterns_in_registry(self):
        """No overly permissive parenthesized/comma-number patterns should appear in registry."""
        patterns = get_in_text_patterns()
        pattern_names = [p.name for p in patterns]

        forbidden_patterns = [
            "mla_intext_parenthetical",
            "acs_comma_separated",
            "acs_parenthesized",
            "ama_comma_separated",
            "ama_parenthesized",
            "cse_parenthesized",  # removed from in_text
        ]
        for name in forbidden_patterns:
            assert name not in pattern_names, f"{name} should not be in in_text_patterns"

    def test_registered_format_count(self):
        """Should have all 11 citation formats registered."""
        from integrity_checker.extraction.patterns import get_all_formats

        formats = get_all_formats()
        format_names = [f.name for f in formats]
        assert len(formats) == 11, f"Expected 11 formats, got {len(formats)}: {format_names}"
        expected = {
            "APA", "IEEE", "Vancouver", "Chicago", "Harvard",
            "ACM", "Nature", "CSE", "MLA", "ACS", "AMA",
        }
        assert set(format_names) == expected


class TestIEEEBracketsStillWork:
    """Verify IEEE/Nature bracketed citations still work correctly."""

    def test_ieee_numeric_single(self):
        """IEEE numeric [N] should still work."""
        patterns = get_in_text_patterns()
        ieee = next(p for p in patterns if p.name == "ieee_numeric")
        assert ieee.search("[1]") is not None
        assert ieee.search("[24]") is not None
        assert ieee.search("[1,2]") is not None
        assert ieee.search("[1, 2, 3]") is not None
        assert ieee.search("[1-5]") is not None

    def test_nature_bracketed_single(self):
        """Nature bracketed [N] should still work."""
        patterns = get_in_text_patterns()
        nat = next(p for p in patterns if p.name == "nature_bracketed")
        assert nat.search("[1]") is not None
        assert nat.search("[24]") is not None


class TestLongAuthorAccentedAPARegression:
    """Regression tests for multi-author APA entries with accented initials and parenthetical editions."""

    def test_pedregosa_16_authors_with_accented_initial_not_hijacked_by_vn_traditional(self):
        """16-author APA entry with 'Duchesnay, É.' must parse as APA with title & 16 authors."""
        from integrity_checker.extraction.reference_parser import ReferenceListParser
        from integrity_checker.models.citation import CitationStyle

        parser = ReferenceListParser()
        raw = (
            "[18] Pedregosa, F., Varoquaux, G., Gramfort, A., Michel, V., Thirion, B., Grisel,\n"
            "O., Blondel, M., Prettenhofer, P., Weiss, R., Dubourg, V., Vanderplas, J., Passos,\n"
            "A., Cournapeau, D., Brucher, M., Perrot, M., & Duchesnay, É. (2011). Scikit-\n"
            "learn: Machine learning in Python. Journal of Machine Learning Research, 12,\n"
            "2825–2830."
        )
        entries = parser._split_entries(f"References\n{raw}")
        assert len(entries) == 1
        cit = parser._parse_entry(entries[0], order_index=18, page_num=93)
        assert cit is not None
        assert cit.style == CitationStyle.APA
        assert cit.matched_pattern == "apa_reference_entry"
        assert cit.numeric_index == 18
        assert cit.year == "2011"
        assert cit.title == "Scikit-learn: Machine learning in Python"
        assert cit.venue == "Journal of Machine Learning Research"
        assert len(cit.authors) == 16
        assert cit.authors[0].last_name == "pedregosa"
        assert cit.authors[-1].last_name == "duchesnay"

    def test_apa_parenthetical_edition_and_title_ending_with_digits(self):
        """Parenthetical '(5th ed., text rev.)' stays in title and 'LIWC2015' does not glue publisher."""
        from integrity_checker.extraction.reference_parser import ReferenceListParser

        parser = ReferenceListParser()
        dsm = (
            "[1] American Psychiatric Association. (2022). Diagnostic and statistical manual "
            "of mental disorders (5th ed., text rev.). American Psychiatric Association Publishing. "
            "https://doi.org/10.1176/appi.books.9780890425787"
        )
        cit1 = parser._parse_entry(dsm, order_index=1, page_num=92)
        assert cit1 is not None
        assert cit1.title == "Diagnostic and statistical manual of mental disorders (5th ed., text rev.)"
        assert cit1.venue == "American Psychiatric Association Publishing"
        assert cit1.doi == "10.1176/appi.books.9780890425787"

        liwc = (
            "[19] Pennebaker, J. W., Boyd, R. L., Jordan, K., & Blackburn, K. (2015). "
            "The development and psychometric properties of LIWC2015. The University of Texas at Austin. "
            "https://doi.org/10.15781/T29G6Z"
        )
        cit19 = parser._parse_entry(liwc, order_index=19, page_num=93)
        assert cit19 is not None
        assert cit19.title == "The development and psychometric properties of LIWC2015"
        assert cit19.venue == "The University of Texas at Austin"
        assert cit19.doi == "10.15781/T29G6Z"

    def test_arxiv_20_papers_regressions(self) -> None:
        """Regression tests for bugs found across 20 top ML/AI/CS papers."""
        from integrity_checker.extraction.reference_parser import ReferenceListParser

        parser = ReferenceListParser()

        # 1. LaTeX alpha style [ADG+16] (GPT-3 2005.14165.pdf)
        alpha_entry = (
            "[ADG+16] Marcin Andrychowicz, Misha Denil, Sergio Gómez Colmenarejo, "
            "Matthew W. Hoffman, David Pfau, Tom Schaul, Brendan Shillingford, and Nando de Freitas. "
            "Learning to learn by gradient descent by gradient descent. "
            "In Advances in Neural Information Processing Systems, pages 3981–3989, 2016."
        )
        c_alpha = parser._parse_entry(alpha_entry, order_index=1, page_num=40)
        assert c_alpha is not None
        assert c_alpha.year == "2016"
        assert c_alpha.title == "Learning to learn by gradient descent by gradient descent"
        assert len(c_alpha.authors) >= 2

        # 2. plainnat 2-segment with middle initial + colon subtitle (Kingma & Ba 2017)
        kingma = (
            "Diederik P. Kingma and Jimmy Ba. Adam: A method for stochastic optimization, 2017. "
            "URL https://arxiv.org/abs/1412.6980."
        )
        c_kingma = parser._parse_entry(kingma, order_index=2, page_num=10)
        assert c_kingma is not None
        assert c_kingma.year == "2017"
        assert c_kingma.title == "Adam: A method for stochastic optimization"
        assert len(c_kingma.authors) == 2
        assert c_kingma.url == "https://arxiv.org/abs/1412.6980"

        # 3. Short dataset title with URL (AIMO. Amc, 2024b)
        aimo = "AIMO. Amc, 2024b. URL https://huggingface.co/datasets/AI-MO/aimo-validation-amc."
        c_aimo = parser._parse_entry(aimo, order_index=3, page_num=11)
        assert c_aimo is not None
        assert c_aimo.year == "2024"
        assert c_aimo.year_suffix == "b"
        assert c_aimo.title == "Amc"
        assert len(c_aimo.authors) == 1

        # 4. ACM numbered with dot in title (Taskmatrix.ai) and month before year (March 2023)
        taskmatrix = (
            "[27] Yaobo Liang, Chenfei Wu, Ting Song, Wenshan Wu, Yan Xia, Yu Liu, Yang Ou, "
            "Shuai Lu, Lei Ji, Shaoguang Mao, Yun Wang, Linjun Shou, Ming Gong, and Nan Duan. "
            "Taskmatrix.ai: Completing tasks by connecting foundation models with millions of apis, 2023."
        )
        c_tm = parser._parse_entry(taskmatrix, order_index=27, page_num=12)
        assert c_tm is not None
        assert c_tm.numeric_index == 27
        assert c_tm.year == "2023"
        assert "Taskmatrix.ai" in (c_tm.title or "")

        vicuna = (
            "[36] Wei-Lin Chiang, Zhuohan Li, Zi Lin, Ying Sheng, Zhanghao Wu, Hao Zhang, "
            "Lianmin Zheng, Siyuan Zhuang, Yonghao Zhuang, Joseph E. Gonzalez, Ion Stoica, "
            "and Eric P. Xing. Vicuna: An open-source chatbot impressing gpt-4 with 90%* chatgpt quality, March 2023."
        )
        c_vic = parser._parse_entry(vicuna, order_index=36, page_num=12)
        assert c_vic is not None
        assert c_vic.numeric_index == 36
        assert c_vic.year == "2023"
        assert "Vicuna" in (c_vic.title or "")

        # 5. Nature comma-separated numbered entry with (Publisher, Year).
        nat_acl = (
            "23. C. Ziems, W. Held, O. Shaikh, J. Chen, Z. Zhang, D. Yang, "
            "Can large language models transform computational social science?, "
            "Comput. Linguist. 50, 237–291 (Association for Computational Linguistics, 2024)."
        )
        c_nat = parser._parse_entry(nat_acl, order_index=23, page_num=15)
        assert c_nat is not None
        assert c_nat.numeric_index == 23
        assert c_nat.year == "2024"
        assert "Can large language models transform computational social science?" in (c_nat.title or "")
        assert len(c_nat.authors) >= 5

    def test_arxiv_35_more_papers_regressions(self) -> None:
        """Regression tests for bugs found across the additional 35 ML/AI/CS papers."""
        from integrity_checker.extraction.patterns.apa import APAFormat
        from integrity_checker.extraction.reference_parser import ReferenceListParser
        from integrity_checker.linking.citation_linker import CitationLinker

        parser = ReferenceListParser()
        linker = CitationLinker()

        # 1. ACM numbered entry with "Title, Year. URL https://..." (2608.13966v1.pdf)
        acm_url_entry = (
            "[8] Karl Cobbe, Vineet Kosaraju, Mohammad Bavarian, Mark Chen, "
            "and John Schulman. Training verifiers to solve math word problems, 2021. "
            "URL https://arxiv.org/abs/2110.14168."
        )
        c_acm_url = parser._parse_entry(acm_url_entry, order_index=8, page_num=30)
        assert c_acm_url is not None
        assert c_acm_url.numeric_index == 8
        assert c_acm_url.year == "2021"
        assert c_acm_url.title == "Training verifiers to solve math word problems"
        assert c_acm_url.url == "https://arxiv.org/abs/2110.14168"

        # 2. ACM book/article with title starting with "Word and ..." and 1950 year (2608.14509v1.pdf)
        good_1950 = "[15] I. J. Good. Probability and the Weighing of Evidence. Charles Griffin, 1950."
        c_good = parser._parse_entry(good_1950, order_index=15, page_num=20)
        assert c_good is not None
        assert c_good.numeric_index == 15
        assert c_good.year == "1950"
        assert c_good.title == "Probability and the Weighing of Evidence"
        assert len(c_good.authors) == 1

        # 3. Springer LNCS colon-separated format with running header (2608.14286v1.pdf)
        lncs_entry = (
            "15. Li, Y., Du, Y., Zhou, K., Wang, J., Zhao, W.X., Wen, J.R.: "
            "Evaluating object hallucination in large vision-language models. "
            "In: EMNLP. pp. 292–305 (2023) Ide et al."
        )
        c_lncs = parser._parse_entry(lncs_entry, order_index=15, page_num=14)
        assert c_lncs is not None
        assert c_lncs.numeric_index == 15
        assert c_lncs.year == "2023"
        assert c_lncs.title == "Evaluating object hallucination in large vision-language models"
        assert len(c_lncs.authors) >= 5

        # 4. AAAI/Vancouver year-first with semicolon-separated authors (2608.14089v1.pdf)
        semi_yf = (
            "Corbière, C.; Thome, N.; Bar-Hen, A.; Cord, M.; and Pérez, P. 2019. "
            "Addressing failure prediction by learning model confidence. "
            "In Advances in Neural Information Processing Systems, 2902–2913."
        )
        c_semi = parser._parse_entry(semi_yf, order_index=5, page_num=15)
        assert c_semi is not None
        assert c_semi.year == "2019"
        assert c_semi.title == "Addressing failure prediction by learning model confidence"
        assert len(c_semi.authors) == 5

        # 5. Corporate authors "Meta AI. 2024." and "S. LLC. 2025." (2608.14361v1.pdf, 2608.14377v1.pdf)
        meta_entry = "Meta AI. 2024. The Llama 3 Herd of Models. arXiv:2407.21783."
        c_meta = parser._parse_entry(meta_entry, order_index=10, page_num=11)
        assert c_meta is not None
        assert c_meta.year == "2024"
        assert c_meta.title == "The Llama 3 Herd of Models"
        assert len(c_meta.authors) == 1

        # 6. Nature period-separated corporate technical report (2608.14055v1.pdf)
        nat_corp = "6. OpenAI. GPT-4 Technical Report. arXiv:2303.08774 (2023)."
        c_nat_corp = parser._parse_entry(nat_corp, order_index=6, page_num=18)
        assert c_nat_corp is not None
        assert c_nat_corp.numeric_index == 6
        assert c_nat_corp.year == "2023"
        assert c_nat_corp.title == "GPT-4 Technical Report"
        assert len(c_nat_corp.authors) == 1

        # 7. Square-bracket Author-Year citations & possessive narrative (2608.14397v1.pdf)
        apa_fmt = APAFormat()
        in_text_pats = apa_fmt.in_text_patterns
        sample_body = "As shown by Peirce [1877], [Grice, 1975], and Landauer’s (1961) principle."
        matches = []
        for pat in in_text_pats:
            for m in pat.compiled_regex.finditer(sample_body):
                matches.append(m.group(0))
        assert any("Peirce [1877]" in m for m in matches)
        assert any("[Grice, 1975]" in m for m in matches)
        assert any("Landauer’s (1961)" in m for m in matches)
        assert linker._extract_author_year("Peirce [1877]") == ("Peirce", "1877", None)
        assert linker._extract_author_year("Landauer’s (1961)") == ("Landauer", "1961", None)



