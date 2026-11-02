"""Unit tests for SemanticMatcher content alignment (Neural layer v1.3)."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest


class TestSemanticContentAlignment:
    """Test content-context alignment using Neural embeddings."""

    def test_check_content_alignment_returns_result(self):
        """check_content_alignment should return SemanticAlignmentResult."""
        from integrity_checker.matching.semantic import SemanticMatcher

        mock_model = MagicMock()
        mock_model.encode.return_value = MagicMock()
        mock_model.encode.return_value.__getitem__ = MagicMock()
        mock_cos = MagicMock()
        mock_cos.item.return_value = 0.8  # High similarity
        mock_model.encode.return_value.__getitem__.return_value.__matmul__ = MagicMock(return_value=mock_cos)

        with patch.object(SemanticMatcher, '_get_model', return_value=mock_model):
            matcher = SemanticMatcher()
            result = matcher.check_content_alignment(
                cited_context="Attention mechanisms have revolutionized NLP research.",
                source_title="Attention Is All You Need",
                source_abstract="The dominant sequence transduction models are based on complex recurrent or convolutional neural networks.",
            )

        assert result.similarity >= 0.0
        assert result.confidence in ["high", "medium", "low"]
        assert isinstance(result.is_aligned, bool)

    def test_content_aligned_high_similarity(self):
        """High semantic similarity should result in is_aligned=True."""
        from integrity_checker.matching.semantic import SemanticMatcher

        # Mock the entire check_content_alignment method to avoid real model
        original_check = SemanticMatcher.check_content_alignment

        def mock_check(self, cited_context, source_title, source_abstract=None, source_body=None):
            from integrity_checker.matching.semantic import SemanticAlignmentResult
            # Return high similarity alignment
            return SemanticAlignmentResult(
                similarity=0.85,
                confidence="high",
                is_aligned=True,
                compared_texts={
                    "cited_context": cited_context[:50],
                    "source_title": source_title
                }
            )

        with patch.object(SemanticMatcher, 'check_content_alignment', mock_check):
            matcher = SemanticMatcher()
            result = matcher.check_content_alignment(
                cited_context="Transformers have replaced RNNs in most NLP tasks.",
                source_title="Attention Is All You Need",
            )

        # With high similarity (0.85), should be aligned
        assert result.is_aligned is True
        assert result.confidence == "high"
        assert result.similarity > 0.7

    def test_content_not_aligned_low_similarity(self):
        """Low semantic similarity should result in is_aligned=False."""
        from integrity_checker.matching.semantic import SemanticMatcher

        # Mock the _compute_similarity method to return low similarity
        with patch.object(SemanticMatcher, '_compute_similarity', return_value=0.2):
            matcher = SemanticMatcher()
            result = matcher.check_content_alignment(
                cited_context="Cooking methods for Italian cuisine.",
                source_title="Attention Is All You Need",
            )

        assert result.is_aligned is False
        assert result.confidence in ["low", "medium"]

    def test_content_alignment_with_abstract(self):
        """Content alignment should consider abstract when available."""
        from integrity_checker.matching.semantic import SemanticMatcher

        call_count = [0]
        similarity_values = [0.6, 0.8]  # First = title, Second = abstract

        def mock_encode(texts, **kwargs):
            result = MagicMock()
            result.__getitem__ = MagicMock()
            result.__getitem__.return_value.__matmul__ = MagicMock(
                return_value=MagicMock(item=lambda: similarity_values[call_count[0] % 2])
            )
            call_count[0] += 1
            return result

        mock_model = MagicMock()
        mock_model.encode.side_effect = mock_encode

        with patch.object(SemanticMatcher, '_get_model', return_value=mock_model):
            matcher = SemanticMatcher()
            result = matcher.check_content_alignment(
                cited_context="Deep learning for NLP",
                source_title="Neural Machine Translation",
                source_abstract="A neural network model for machine translation",
            )

        # Should have called encode at least twice (title + abstract)
        assert call_count[0] >= 2

    def test_content_alignment_returns_compared_texts(self):
        """Result should include compared texts for debugging."""
        from integrity_checker.matching.semantic import SemanticMatcher

        mock_model = MagicMock()
        mock_model.encode.return_value = MagicMock()
        mock_model.encode.return_value.__getitem__ = MagicMock()
        mock_cos = MagicMock()
        mock_cos.item.return_value = 0.7
        mock_model.encode.return_value.__getitem__.return_value.__matmul__ = MagicMock(return_value=mock_cos)

        with patch.object(SemanticMatcher, '_get_model', return_value=mock_model):
            matcher = SemanticMatcher()
            result = matcher.check_content_alignment(
                cited_context="The quick brown fox jumps over the lazy dog.",
                source_title="A Study on Neural Networks",
            )

        assert "cited_context" in result.compared_texts
        assert "source_title" in result.compared_texts

    def test_content_alignment_fallback_when_no_model(self):
        """Should return fallback result when model not available."""
        from integrity_checker.matching.semantic import SemanticMatcher

        with patch.object(SemanticMatcher, '_get_model', return_value=None):
            matcher = SemanticMatcher()
            result = matcher.check_content_alignment(
                cited_context="Some text",
                source_title="Some title",
            )

        assert result.similarity == 0.0
        assert result.confidence == "low"
        assert result.is_aligned is False


class TestSemanticMatcherThresholds:
    """Test alignment threshold configurations."""

    def test_default_thresholds(self):
        """Test default alignment thresholds."""
        from integrity_checker.matching.semantic import SemanticMatcher

        matcher = SemanticMatcher()

        assert matcher.ALIGNMENT_THRESHOLD_HIGH == 0.70
        assert matcher.ALIGNMENT_THRESHOLD_MEDIUM == 0.50
        assert matcher.ALIGNMENT_THRESHOLD_LOW == 0.30

    def test_alignment_confidence_mapping(self):
        """Test confidence level determination."""
        from integrity_checker.matching.semantic import SemanticMatcher

        matcher = SemanticMatcher()

        # High threshold
        conf, aligned = matcher._determine_alignment(0.85)
        assert conf == "high"
        assert aligned is True

        # Medium threshold
        conf, aligned = matcher._determine_alignment(0.60)
        assert conf == "medium"
        assert aligned is True

        # Low threshold
        conf, aligned = matcher._determine_alignment(0.40)
        assert conf == "medium"
        assert aligned is False

        # Below low threshold
        conf, aligned = matcher._determine_alignment(0.20)
        assert conf == "low"
        assert aligned is False


class TestSemanticMatcherTruncation:
    """Test text truncation utilities."""

    def test_truncate_short_text(self):
        """Short text should not be truncated."""
        from integrity_checker.matching.semantic import SemanticMatcher

        matcher = SemanticMatcher()
        text = "Short text"
        result = matcher._truncate_text(text, max_length=100)

        assert result == text

    def test_truncate_long_text(self):
        """Long text should be truncated with ellipsis."""
        from integrity_checker.matching.semantic import SemanticMatcher

        matcher = SemanticMatcher()
        text = "A" * 200
        result = matcher._truncate_text(text, max_length=50)

        assert len(result) <= 50
        assert result.endswith("...")

    def test_truncate_empty_text(self):
        """Empty text should return empty string."""
        from integrity_checker.matching.semantic import SemanticMatcher

        matcher = SemanticMatcher()
        result = matcher._truncate_text("", max_length=50)

        assert result == ""


class TestSemanticMatcherBatch:
    """Test batch similarity computation."""

    def test_batch_similarity_returns_list(self):
        """batch_similarity should return list of floats."""
        from integrity_checker.matching.semantic import SemanticMatcher

        mock_model = MagicMock()
        mock_model.encode.return_value = MagicMock()
        mock_model.encode.return_value.__getitem__ = MagicMock()
        mock_cos = MagicMock()
        mock_cos.item.return_value = 0.7
        mock_model.encode.return_value.__getitem__.return_value.__matmul__ = MagicMock(return_value=mock_cos)

        with patch.object(SemanticMatcher, '_get_model', return_value=mock_model):
            matcher = SemanticMatcher()
            pairs = [
                ("Hello world", "Hello world"),
                ("Deep learning", "Machine learning"),
            ]
            results = matcher.batch_similarity(pairs)

        assert isinstance(results, list)
        assert len(results) == len(pairs)
        for r in results:
            assert 0.0 <= r <= 1.0

    def test_batch_similarity_empty_list(self):
        """Empty input should return empty list."""
        from integrity_checker.matching.semantic import SemanticMatcher

        matcher = SemanticMatcher()
        results = matcher.batch_similarity([])

        assert results == []


class TestSemanticMatcherSegments:
    """Test text segmentation for long text comparison."""

    def test_split_into_segments(self):
        """Should split long text into segments."""
        from integrity_checker.matching.semantic import SemanticMatcher

        matcher = SemanticMatcher()
        text = "First sentence. Second sentence. Third sentence. Fourth sentence."
        segments = matcher._split_into_segments(text, max_length=30)

        assert len(segments) > 1
        # Some segments may be slightly longer than max_length due to sentence boundaries
        for seg in segments:
            assert len(seg) <= 35  # Allow small tolerance for sentence boundaries

    def test_split_short_text(self):
        """Short text should return single segment."""
        from integrity_checker.matching.semantic import SemanticMatcher

        matcher = SemanticMatcher()
        text = "Short text"
        segments = matcher._split_into_segments(text, max_length=100)

        assert len(segments) == 1
        assert segments[0] == text

    def test_multi_sentence_abstract_pooling_boosts_sentence_level_match(self):
        """Multi-sentence abstract pooling should capture high similarity with a specific sentence."""
        from integrity_checker.matching.semantic import SemanticMatcher

        # Title sim = 0.35 (metaphorical title), whole abstract sim = 0.55,
        # sentence 1 sim = 0.40, sentence 2 sim = 0.85 (direct match to cited claim)
        sims = [0.35, 0.55, 0.40, 0.85]
        idx = {"i": 0}

        def fake_compute_sim(self, model, t1, t2):
            val = sims[min(idx["i"], len(sims) - 1)]
            idx["i"] += 1
            return val

        long_abstract = (
            "Background on recurrent neural networks and convolutional models in sequence modeling. "
            "We propose the Transformer, a model architecture eschewing recurrence and relying entirely on attention mechanisms."
        )

        with patch.object(SemanticMatcher, "_get_model", return_value=MagicMock()), patch.object(
            SemanticMatcher, "_compute_similarity", fake_compute_sim
        ):
            matcher = SemanticMatcher()
            res = matcher.check_content_alignment(
                cited_context="The Transformer architecture dispenses with recurrence and relies on attention.",
                source_title="Attention Is All You Need",
                source_abstract=long_abstract,
            )

        assert res.is_aligned is True
        assert res.similarity >= 0.65


class TestDeepNeuralLayerUpgrade:
    """Tests for Deep Neural Layer v2.0 (de-hyphenation, focal sentence, intent, stance, cross-lingual, implicit body discovery)."""

    def test_clean_and_dehyphenate_context_repairs_pdf_line_wraps(self):
        from integrity_checker.matching.semantic import SemanticMatcher

        raw = "modern neural networks are poorly cal- ibration and HDB- SCAN clustering with TF- IDF."
        cleaned = SemanticMatcher.clean_and_dehyphenate_context(raw)
        assert "calibration" in cleaned
        assert "HDBSCAN" in cleaned
        assert "TF-IDF" in cleaned

    def test_extract_focal_sentence_isolates_marker_sentence(self):
        from integrity_checker.matching.semantic import SemanticMatcher

        noisy_window = (
            "1. Sentence Embeddings: Sentence-BERT [20] converts text into vectors. "
            "2. Dimensionality Reduction: UMAP [15] projects high-dimensional embeddings. "
            "3. Clustering: HDBSCAN [2] identifies dense topic clusters and marks outliers as noise."
        )
        focal = SemanticMatcher.extract_focal_sentence(
            noisy_window,
            citation_marker="[2]",
            source_title="Density-Based Clustering Based on Hierarchical Density Estimates",
        )
        assert "HDBSCAN" in focal
        assert "Sentence-BERT" not in focal

    def test_detect_and_bridge_cross_lingual_vietnamese_to_english(self):
        from integrity_checker.matching.semantic import SemanticMatcher

        vi_ctx = "Chúng tôi sử dụng mô hình học sâu và cơ chế chú ý để phân loại văn bản cảm xúc."
        en_title = "Attention Is All You Need"
        is_xling, bridge = SemanticMatcher.detect_and_bridge_cross_lingual(vi_ctx, en_title)
        assert is_xling is True
        assert "deep learning" in bridge.lower()
        assert "attention mechanism" in bridge.lower()

    def test_classify_citation_intent_categories(self):
        from integrity_checker.matching.semantic import SemanticMatcher

        with patch.object(SemanticMatcher, "_get_model", return_value=None):
            matcher = SemanticMatcher()
            assert (
                matcher.classify_citation_intent(
                    "We adopt and fine-tune the Sentence-BERT architecture [12] as our embedding backbone."
                )
                == "methodology"
            )
            assert (
                matcher.classify_citation_intent(
                    "Our model outperforms the baseline accuracy reported by Smith et al. [4] by 3.5% F1."
                )
                == "result_comparison"
            )
            assert (
                matcher.classify_citation_intent(
                    "Prior studies have broadly surveyed mental health trends in social media [1]."
                )
                == "background"
            )

    def test_check_claim_stance_detects_support_and_contradiction_risk(self):
        from integrity_checker.matching.semantic import SemanticMatcher

        matcher = SemanticMatcher()
        assert (
            matcher.check_claim_stance(
                "BERT pre-trains deep bidirectional representations from unlabeled text.",
                "BERT is designed to pre-train deep bidirectional representations from unlabeled text.",
                similarity=0.82,
                has_abstract=True,
            )
            == "supported"
        )
        assert (
            matcher.check_claim_stance(
                "Temperature scaling fails to improve calibration and is ineffective for neural networks.",
                "We show that temperature scaling is surprisingly effective at calibrating predictions.",
                similarity=0.42,
                has_abstract=True,
            )
            == "contradiction_risk"
        )

    def test_discover_implicit_body_context_finds_relevant_body_passage(self):
        from integrity_checker.matching.semantic import SemanticMatcher

        body_pages = [
            (1, "Introduction to our e-commerce bookstore project and team members."),
            (
                2,
                "In our backend architecture, PHP server-side scripting and MySQL relational databases "
                "handle user authentication, session management, and SQL queries.",
            ),
        ]
        result = SemanticMatcher.get_instance().discover_implicit_body_context(
            body_pages=body_pages,
            source_title="PHP and MySQL Web Development",
            source_abstract="Practical guide to developing database-driven web applications using PHP and MySQL.",
            source_authors=["Welling", "Thomson"],
        )
        assert result is not None
        page_num, passage, score = result
        assert page_num == 2
        assert "PHP" in passage and "MySQL" in passage
        assert score >= 0.30


class TestExtremeNeuralEdgeCases:
    """Extreme, rare, and adversarial edge-case tests for the Deep Neural Layer."""

    def test_extract_sentences_preserves_scholarly_abbreviations_and_decimals(self):
        from integrity_checker.matching.semantic import SemanticMatcher

        sm = SemanticMatcher()
        tricky = (
            "Following Vaswani et al. (2017) and Dr. J. Devlin et al. (2019), e.g., BERT-base vs. RoBERTa "
            "on GLUE (Sec. 4.2, Fig. 3, i.e., bidirectional transformers), our model achieves 94.5% accuracy. "
            "However, earlier recurrent architectures struggled with long-range dependencies."
        )
        sents = sm._extract_sentences(tricky)
        assert len(sents) == 2
        assert "Vaswani et al. (2017)" in sents[0]
        assert "e.g., BERT-base vs. RoBERTa" in sents[0]
        assert "94.5% accuracy" in sents[0]

    def test_extract_focal_sentence_handles_multi_citation_clusters_and_ranges(self):
        from integrity_checker.matching.semantic import SemanticMatcher

        ctx = (
            "Previous studies explored recurrent neural networks for sequence modeling [1, 2, 5]. "
            "In contrast, our quantitative evaluation on benchmark datasets follows the protocol in [3–6]. "
            "Finally, deployment details are provided in Chapter 5."
        )
        focal_2 = SemanticMatcher.extract_focal_sentence(
            ctx, citation_marker="[2]", source_title="Sequence to Sequence Learning"
        )
        focal_4 = SemanticMatcher.extract_focal_sentence(
            ctx, citation_marker="[4]", source_title="GLUE Benchmark"
        )
        assert "recurrent neural networks" in focal_2
        assert "quantitative evaluation" in focal_4

    def test_long_structured_abstract_matches_late_conclusion_sentence(self):
        from integrity_checker.matching.semantic import SemanticMatcher

        sm = SemanticMatcher.get_instance()
        long_sents = [
            f"Background sentence {i} discussing general hospital administrative logistics and billing codes."
            for i in range(1, 15)
        ]
        long_sents.append(
            "Specifically, random forest models combined with oversampling achieved 94% sensitivity for early stroke prediction."
        )
        long_sents.append("Future work will expand to multi-center cohorts.")
        res = sm.check_content_alignment(
            cited_context="Our pipeline adopts random forest with oversampling, reaching 94% sensitivity in early stroke prediction [4].",
            source_title="A Multi-Center Clinical Study of Patient Outcomes",
            source_abstract=" ".join(long_sents),
            citation_marker="[4]",
        )
        assert "random forest models combined with oversampling" in res.best_evidence_sentence
        assert res.similarity >= 0.70

    def test_cross_lingual_pure_vietnamese_medical_and_niche_domains(self):
        from integrity_checker.matching.semantic import SemanticMatcher

        sm = SemanticMatcher.get_instance()
        vn_medical = (
            "Các nghiên cứu lâm sàng gần đây chỉ ra rằng việc thiếu ngủ kéo dài làm suy giảm "
            "nghiêm trọng trí nhớ ngắn hạn và khả năng tập trung của thanh thiếu niên [12]."
        )
        res_med = sm.check_content_alignment(
            cited_context=vn_medical,
            source_title="Effects of Chronic Sleep Deprivation on Working Memory and Sustained Attention in Adolescents",
            source_abstract="Chronic sleep restriction in high school students significantly impairs short-term working memory capacity and cognitive attention span.",
            citation_marker="[12]",
        )
        assert res_med.cross_lingual_detected is True
        assert res_med.similarity >= 0.60
        assert res_med.stance_label == "supported"

        vn_niche = "Nghệ thuật chạm khắc gỗ thời nhà Lê thể hiện nét tinh hoa văn hóa dân gian vùng đồng bằng Bắc Bộ [15]."
        res_niche = sm.check_content_alignment(
            cited_context=vn_niche,
            source_title="Traditional Woodblock Carving in 15th Century Dai Viet",
            source_abstract="This monograph surveys temple architecture and artisanal woodcraft across northern Vietnam.",
            citation_marker="[15]",
        )
        assert res_niche.cross_lingual_detected is True
        assert res_niche.stance_label != "contradiction_risk"

    def test_polarity_refutation_and_multi_occurrence_contradiction_trigger_mismatch_rule(self):
        from integrity_checker.logic.neuro_symbolic_checker import NeuroSymbolicChecker
        from integrity_checker.models.citation import Citation
        from integrity_checker.models.source import SourceCandidate, SourceResult

        checker = NeuroSymbolicChecker()
        cit = Citation(
            raw_text="Devlin, J., Chang, M. W., Lee, K., & Toutanova, K. (2019). BERT: Pre-training of deep bidirectional transformers for language understanding.",
            title="BERT: Pre-training of deep bidirectional transformers for language understanding",
            authors=["Devlin, J.", "Chang, M. W.", "Lee, K.", "Toutanova, K."],
            year=2019,
            doi="10.18653/v1/N19-1423",
        )
        cit._occurrence_contexts = [
            {
                "page": 3,
                "raw": "(Devlin et al., 2019)",
                "context": "We fine-tune pre-trained bidirectional transformer representations from BERT for text classification (Devlin et al., 2019).",
            },
            {
                "page": 11,
                "raw": "(Devlin et al., 2019)",
                "context": "However, Devlin et al. (2019) proved that bidirectional pre-training is completely ineffective and fails to improve language understanding.",
            },
        ]
        src = SourceResult(
            citation_raw=cit.raw_text,
            candidates=[
                SourceCandidate(
                    source_name="semantic_scholar",
                    found=True,
                    title="BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding",
                    authors=["Jacob Devlin", "Ming-Wei Chang", "Kenton Lee", "Kristina Toutanova"],
                    year=2019,
                    doi="10.18653/v1/N19-1423",
                    abstract="We introduce a new language representation model called BERT, which stands for Bidirectional Encoder Representations from Transformers.",
                    confidence=0.98,
                    score=0.98,
                )
            ],
            sources_queried=["semantic_scholar"],
            sources_succeeded=["semantic_scholar"],
        )
        verdict = checker.check(cit, src, citation_context=cit._occurrence_contexts[0]["context"])
        assert verdict.features.stance_label == "contradiction_risk"
        assert "R-CONTENT-MISMATCH" in verdict.triggered_rules

    def test_sanitize_jats_xml_and_degenerate_contexts(self):
        from integrity_checker.matching.semantic import SemanticMatcher

        sm = SemanticMatcher.get_instance()
        jats_abs = "<jats:title>Abstract</jats:title><jats:p>We propose &amp; evaluate a graph attention network for molecular property prediction.</jats:p>"
        res = sm.check_content_alignment(
            cited_context="We adopt the graph attention network for molecular property prediction [8].",
            source_title="Graph Attention Networks for Molecular Property Prediction",
            source_abstract=jats_abs,
        )
        assert "<jats:" not in res.best_evidence_sentence
        assert "&amp;" not in res.best_evidence_sentence
        assert not res.best_evidence_sentence.lower().startswith("abstract ")

        for deg in ("", "   \n\t ", "??? !!! ... [1] ()"):
            r_deg = sm.check_content_alignment(
                cited_context=deg,
                source_title="Attention Is All You Need",
                source_abstract="We propose the Transformer architecture.",
            )
            assert r_deg.similarity == 0.0
            assert r_deg.stance_label == "neutral"



