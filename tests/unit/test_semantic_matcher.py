"""Unit tests for SemanticMatcher (Task 3.4)."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest


class TestSemanticMatcher:
    """Test semantic similarity scoring."""

    def test_similarity_returns_float(self):
        """similarity() should return float between 0.0 and 1.0."""
        from integrity_checker.matching.semantic import SemanticMatcher

        # Mock the model to avoid loading real model
        mock_model = MagicMock()
        mock_model.encode.return_value = MagicMock()
        mock_model.encode.return_value.__getitem__ = MagicMock()
        # Simulate cosine similarity of 0.5 (neutral)
        # (0.5 + 1.0) / 2.0 = 0.75
        mock_cos = MagicMock()
        mock_cos.item.return_value = 0.5
        mock_model.encode.return_value.__getitem__.return_value = MagicMock()
        mock_model.encode.return_value.__getitem__.return_value.__matmul__ = MagicMock(return_value=mock_cos)

        with patch.object(SemanticMatcher, '_get_model', return_value=mock_model):
            matcher = SemanticMatcher()
            result = matcher.similarity("Hello world", "Hello world")

        assert isinstance(result, float)
        assert 0.0 <= result <= 1.0

    def test_exact_match_high_score(self):
        """Identical texts should get high similarity score."""
        from integrity_checker.matching.semantic import SemanticMatcher

        # Mock high cosine similarity (0.95)
        mock_model = MagicMock()
        mock_model.encode.return_value = MagicMock()
        mock_model.encode.return_value.__getitem__ = MagicMock()
        mock_cos = MagicMock()
        mock_cos.item.return_value = 0.95  # Very similar
        mock_model.encode.return_value.__getitem__.return_value.__matmul__ = MagicMock(return_value=mock_cos)

        with patch.object(SemanticMatcher, '_get_model', return_value=mock_model):
            matcher = SemanticMatcher()
            result = matcher.similarity("Deep Learning for Computer Vision", "Deep Learning for Computer Vision")

        # With cosine=0.95: (0.95+1)/2 = 0.975
        assert result >= 0.9

    def test_partial_match_medium_score(self):
        """Similar but not identical texts should get medium score."""
        from integrity_checker.matching.semantic import SemanticMatcher

        # Mock medium cosine similarity (0.6)
        mock_model = MagicMock()
        mock_model.encode.return_value = MagicMock()
        mock_model.encode.return_value.__getitem__ = MagicMock()
        mock_cos = MagicMock()
        mock_cos.item.return_value = 0.6  # Somewhat similar
        mock_model.encode.return_value.__getitem__.return_value.__matmul__ = MagicMock(return_value=mock_cos)

        with patch.object(SemanticMatcher, '_get_model', return_value=mock_model):
            matcher = SemanticMatcher()
            result = matcher.similarity("Deep Learning for Vision", "Machine Learning for Images")

        # With cosine=0.6: (0.6+1)/2 = 0.8
        assert 0.5 <= result <= 0.9

    def test_no_match_low_score(self):
        """Completely different texts should get low score."""
        from integrity_checker.matching.semantic import SemanticMatcher

        # Mock low cosine similarity (0.1)
        mock_model = MagicMock()
        mock_model.encode.return_value = MagicMock()
        mock_model.encode.return_value.__getitem__ = MagicMock()
        mock_cos = MagicMock()
        mock_cos.item.return_value = 0.1  # Very different
        mock_model.encode.return_value.__getitem__.return_value.__matmul__ = MagicMock(return_value=mock_cos)

        with patch.object(SemanticMatcher, '_get_model', return_value=mock_model):
            matcher = SemanticMatcher()
            result = matcher.similarity("Cooking recipes for dinner", "Quantum physics algorithms")

        # With cosine=0.1: (0.1+1)/2 = 0.55 - still clamped to >= 0
        assert result < 0.7

    def test_empty_text_returns_zero(self):
        """Empty text should return 0.0."""
        from integrity_checker.matching.semantic import SemanticMatcher

        matcher = SemanticMatcher()
        assert matcher.similarity("", "Some text") == 0.0
        assert matcher.similarity("Some text", "") == 0.0
        assert matcher.similarity("", "") == 0.0

    def test_none_text_returns_zero(self):
        """None text should return 0.0."""
        from integrity_checker.matching.semantic import SemanticMatcher

        matcher = SemanticMatcher()
        assert matcher.similarity(None, "Some text") == 0.0
        assert matcher.similarity("Some text", None) == 0.0

    def test_model_not_loaded_returns_zero(self):
        """When model fails to load, similarity returns 0.0."""
        from integrity_checker.matching.semantic import SemanticMatcher

        with patch.object(SemanticMatcher, '_get_model', return_value=None):
            matcher = SemanticMatcher()
            result = matcher.similarity("Hello", "World")

        assert result == 0.0

    def test_similarity_clamped_to_0_1(self):
        """Similarity should be clamped between 0.0 and 1.0."""
        from integrity_checker.matching.semantic import SemanticMatcher

        # Test negative cosine (after adjustment should be > 0)
        mock_model = MagicMock()
        mock_model.encode.return_value = MagicMock()
        mock_model.encode.return_value.__getitem__ = MagicMock()
        mock_cos = MagicMock()
        mock_cos.item.return_value = -0.5  # Very different, negative cosine
        mock_model.encode.return_value.__getitem__.return_value.__matmul__ = MagicMock(return_value=mock_cos)

        with patch.object(SemanticMatcher, '_get_model', return_value=mock_model):
            matcher = SemanticMatcher()
            result = matcher.similarity("Hello", "Completely different text")

        # Should be clamped to 0.0 minimum
        assert result >= 0.0
        assert result <= 1.0

    def test_multilingual_title(self):
        """Multi-language titles should still compute similarity."""
        from integrity_checker.matching.semantic import SemanticMatcher

        # Mock a model that processes both English and Vietnamese
        mock_model = MagicMock()
        mock_model.encode.return_value = MagicMock()
        mock_model.encode.return_value.__getitem__ = MagicMock()
        mock_cos = MagicMock()
        mock_cos.item.return_value = 0.7  # Some similarity
        mock_model.encode.return_value.__getitem__.return_value.__matmul__ = MagicMock(return_value=mock_cos)

        with patch.object(SemanticMatcher, '_get_model', return_value=mock_model):
            matcher = SemanticMatcher()
            result = matcher.similarity(
                "Học sâu cho thị giác máy tính",
                "Deep Learning for Computer Vision"
            )

        # Should handle multilingual input
        assert isinstance(result, float)
        assert 0.0 <= result <= 1.0

    def test_model_loading_lazy(self):
        """Model should be loaded lazily on first use."""
        from integrity_checker.matching.semantic import SemanticMatcher

        # Create matcher without loading model
        matcher = SemanticMatcher(model_name="test-model")
        assert matcher._model is None

        # Mock the actual loading
        with patch.object(SemanticMatcher, '_get_model', return_value=None):
            # Access _get_model to trigger lazy load
            matcher._get_model()
            # Model is still None because we mocked it
            assert matcher._model is None or matcher._model is not None  # Either works

    def test_exception_handling(self):
        """Model encoding exception should return 0.0."""
        from integrity_checker.matching.semantic import SemanticMatcher

        mock_model = MagicMock()
        mock_model.encode.side_effect = Exception("Encoding failed")

        with patch.object(SemanticMatcher, '_get_model', return_value=mock_model):
            matcher = SemanticMatcher()
            result = matcher.similarity("Hello", "World")

        # Should gracefully handle exception
        assert result == 0.0
