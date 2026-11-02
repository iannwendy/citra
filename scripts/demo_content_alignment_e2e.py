#!/usr/bin/env python
"""E2E demo for Neuro-Symbolic content alignment (v1.3).

This script demonstrates the Neural layer integration:
1. Semantic content alignment using Sentence-BERT
2. Decision making combining Neural + Symbolic layers
"""

import asyncio

from integrity_checker.logic.rules import SymbolicRules
from integrity_checker.matching.semantic import SemanticAlignmentResult, SemanticMatcher
from integrity_checker.models.source import SourceCandidate, SourceResult
from integrity_checker.models.validation import MatchFeatures


def demo_semantic_content_alignment():
    """Demo 1: Semantic content alignment check."""
    print("=" * 70)
    print("DEMO 1: Semantic Content Alignment (Neural Layer)")
    print("=" * 70)

    matcher = SemanticMatcher.get_instance()

    # Test case 1: Content aligned with paper
    print("\n[Test 1] Cited context aligns with paper:")
    cited = "Attention mechanisms have revolutionized natural language processing."
    source_title = "Attention Is All You Need"
    source_abstract = (
        "The dominant sequence transduction models are based on complex recurrent or "
        "convolutional neural networks that include an encoder and a decoder. The "
        "attention mechanism has become an integral part of sequence modeling."
    )

    result = matcher.check_content_alignment(
        cited_context=cited,
        source_title=source_title,
        source_abstract=source_abstract,
    )

    print(f"  Cited: \"{cited}\"")
    print(f"  Source: \"{source_title}\"")
    print(f"  Score: {result.similarity:.4f}")
    print(f"  Confidence: {result.confidence}")
    print(f"  Aligned: {result.is_aligned}")

    # Test case 2: Content NOT aligned
    print("\n[Test 2] Cited context does NOT align with paper:")
    cited = "The best recipes for Italian pasta dishes."
    result = matcher.check_content_alignment(
        cited_context=cited,
        source_title=source_title,
    )

    print(f"  Cited: \"{cited}\"")
    print(f"  Source: \"{source_title}\"")
    print(f"  Score: {result.similarity:.4f}")
    print(f"  Confidence: {result.confidence}")
    print(f"  Aligned: {result.is_aligned}")


def demo_neuro_symbolic_rules():
    """Demo 2: Neuro-Symbolic decision rules."""
    print("\n" + "=" * 70)
    print("DEMO 2: Neuro-Symbolic Rules (Neural + Symbolic)")
    print("=" * 70)

    rules = SymbolicRules()

    # Create mock source
    candidate = SourceCandidate(
        source_name="crossref",
        found=True,
        title="Attention Is All You Need",
        authors=["Vaswani, A.", "Shazeer, N."],
        year="2017",
        confidence=0.95,
        score=0.95,
    )
    source = SourceResult(
        citation_raw="(Vaswani et al., 2017)",
        candidates=[candidate],
        sources_queried=["crossref", "openalex"],
        sources_succeeded=["crossref"],
        sources_failed=[],
    )

    # Test case 1: Title matches but content NOT aligned
    print("\n[Test 1] Title matches BUT content NOT aligned:")
    features1 = MatchFeatures(
        title_sim_fuzzy=0.85,
        title_sim_semantic=0.82,
        author_jaccard=0.5,
        year_distance=0,
        doi_exact_match=False,
        source_consensus=1,
        content_alignment_score=0.35,  # Low content alignment
        content_is_aligned=False,
    )

    outcome1 = rules.apply(features1, source)
    print(f"  Title sim: {features1.title_sim_fuzzy:.2f}")
    print(f"  Content alignment: {features1.content_alignment_score:.2f}")
    print(f"  Label: {outcome1.label.value}")
    print(f"  Confidence: {outcome1.confidence:.2f}")
    print(f"  Reasoning: {outcome1.reasoning[:100]}...")

    # Test case 2: High content alignment = VERIFIED
    print("\n[Test 2] High content alignment despite moderate title:")
    features2 = MatchFeatures(
        title_sim_fuzzy=0.55,  # Moderate title
        title_sim_semantic=0.58,
        author_jaccard=0.5,
        year_distance=0,
        doi_exact_match=False,
        source_consensus=1,
        content_alignment_score=0.80,  # High content alignment
        content_is_aligned=True,
    )

    outcome2 = rules.apply(features2, source)
    print(f"  Title sim: {features2.title_sim_fuzzy:.2f}")
    print(f"  Content alignment: {features2.content_alignment_score:.2f}")
    print(f"  Label: {outcome2.label.value}")
    print(f"  Confidence: {outcome2.confidence:.2f}")
    print(f"  Reasoning: {outcome2.reasoning[:100]}...")

    # Test case 3: No content alignment signal
    print("\n[Test 3] No content alignment (backward compatibility):")
    features3 = MatchFeatures(
        title_sim_fuzzy=0.85,
        title_sim_semantic=0.82,
        author_jaccard=0.5,
        year_distance=0,
        doi_exact_match=False,
        source_consensus=1,
        content_alignment_score=0.0,  # No signal
        content_is_aligned=False,
    )

    outcome3 = rules.apply(features3, source)
    print(f"  Title sim: {features3.title_sim_fuzzy:.2f}")
    print(f"  Content alignment: {features3.content_alignment_score:.2f}")
    print(f"  Label: {outcome3.label.value}")
    print(f"  Confidence: {outcome3.confidence:.2f}")


def demo_summary():
    """Print summary of changes."""
    print("\n" + "=" * 70)
    print("SUMMARY: v1.3 Neural Layer Implementation")
    print("=" * 70)
    print("""
Changes made:
1. SemanticMatcher (matching/semantic.py):
   - Added SemanticAlignmentResult dataclass
   - Added check_content_alignment() method
   - Added _compute_similarity_with_long_text() for body text
   - Added batch_similarity() for bulk operations

2. MatchFeatures (models/validation.py):
   - Added content_alignment_score field
   - Added content_alignment_confidence field
   - Added content_is_aligned field
   - Added neural_content_score property

3. FeatureCalculator (matching/features.py):
   - Added enable_content_alignment flag
   - Added citation_context parameter to compute()
   - Integrates content alignment into MatchFeatures

4. SymbolicRules (logic/rules.py):
   - Added R-CONTENT-ALIGNMENT rule
   - Added R-CONTENT-MISMATCH rule
   - Content alignment rules execute BEFORE abstention

5. NeuroSymbolicChecker (logic/neuro_symbolic_checker.py):
   - Added citation_context parameter to check()
   - Enhanced reasoning with Neural layer feedback

6. New test files:
   - test_semantic_content_alignment.py (14 tests)
   - test_content_alignment_rules.py (7 tests)
""")


if __name__ == "__main__":
    print("\n" + "=" * 70)
    print("NEURO-SYMBOLIC CONTENT ALIGNMENT E2E DEMO")
    print("v1.3 - Neural Layer Integration")
    print("=" * 70)

    try:
        demo_semantic_content_alignment()
    except Exception as e:
        print(f"\nDemo 1 skipped (model not available): {e}")

    try:
        demo_neuro_symbolic_rules()
    except Exception as e:
        print(f"\nDemo 2 error: {e}")

    demo_summary()

    print("\n" + "=" * 70)
    print("E2E DEMO COMPLETE")
    print("=" * 70)
