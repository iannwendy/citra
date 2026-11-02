"""Tests for populate_venues.py script."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from scripts.populate_venues import _infer_venue


class TestInferVenue:
    """Test venue inference from title."""

    def test_known_papers_bert(self):
        """BERT paper should be NAACL."""
        result = _infer_venue(
            "BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding",
            "known_papers"
        )
        assert result == "NAACL"

    def test_known_papers_attention(self):
        """Attention Is All You Need should be NeurIPS."""
        result = _infer_venue("Attention Is All You Need", "known_papers")
        assert result == "NeurIPS"

    def test_known_papers_gpt3(self):
        """GPT-3 should be NeurIPS."""
        result = _infer_venue(
            "Language Models are Few-Shot Learners",
            "known_papers"
        )
        assert result == "NeurIPS"

    def test_known_papers_unknown_defaults(self):
        """Unknown known_papers should default to NeurIPS."""
        result = _infer_venue("Some Random Unknown Paper", "known_papers")
        assert result == "NeurIPS"

    def test_crossref_glove(self):
        """GloVe paper should be EMNLP."""
        result = _infer_venue(
            "Glove: Global Vectors for Word Representation",
            "crossref"
        )
        assert result == "EMNLP"

    def test_crossref_dropout(self):
        """Dropout paper should be JMLR."""
        result = _infer_venue(
            "Dropout: a simple way to prevent neural networks from overfitting",
            "crossref"
        )
        assert result == "JMLR"

    def test_crossref_applicative(self):
        """Applicative papers should be ICFP."""
        result = _infer_venue("Applicative 2015 on - Applicative 2015", "crossref")
        assert result == "ICFP"

        result = _infer_venue("Applicative 2016 on - Applicative 2016", "crossref")
        assert result == "ICFP"

    def test_crossref_miracle_yearbook(self):
        """Miracle Yearbook papers should be AAAI."""
        result = _infer_venue("2005 Miracle Yearbook", "crossref")
        assert result == "AAAI"

    def test_crossref_arxiv_in_title(self):
        """Papers with arxiv in title should be arXiv."""
        result = _infer_venue("arXiv Update Februar 2016", "crossref")
        assert result == "arXiv"

    def test_crossref_luke(self):
        """LUKE paper should be EMNLP."""
        result = _infer_venue(
            "LUKE: Deep Contextualized Entity Representations with Entity-aware Self-attention",
            "crossref"
        )
        assert result == "EMNLP"

    def test_crossref_fallback(self):
        """Unknown crossref papers should default to arXiv."""
        result = _infer_venue("Some Random Crossref Paper", "crossref")
        assert result == "arXiv"

    def test_openalex_default(self):
        """OpenAlex papers should default to EMNLP."""
        result = _infer_venue("Some OpenAlex Paper", "openalex")
        assert result == "EMNLP"

    def test_serpapi_default(self):
        """SERPAPI papers should default to arXiv."""
        result = _infer_venue("Some serpapi Paper", "serpapi")
        assert result == "arXiv"

    def test_none_title(self):
        """None title should return None."""
        result = _infer_venue(None, "crossref")
        assert result is None

    def test_empty_title(self):
        """Empty title should return None."""
        result = _infer_venue("", "crossref")
        assert result is None

    def test_crossref_penn_treebank(self):
        """Penn Treebank should be Computational Linguistics."""
        result = _infer_venue(
            "Building a Large Annotated Corpus of English: The Penn Treebank",
            "crossref"
        )
        assert result == "CL"

    def test_crossref_context2vec(self):
        """context2vec should be NAACL."""
        result = _infer_venue(
            "context2vec: Learning Generic Context Embedding with Bidirectional LSTM",
            "crossref"
        )
        assert result == "NAACL"
