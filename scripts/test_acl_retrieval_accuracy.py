#!/usr/bin/env python3
"""
Test retrieval accuracy on 100 ACL papers from local database.

This script:
1. Extracts 100 ACL papers from local_papers.db
2. Simulates citations (varying quality: full metadata, partial, title-only)
3. Runs RetrievalOrchestrator to find them
4. Calculates metrics: Precision, Recall, F1, MRR
5. Reports detailed breakdown by metadata completeness

Usage:
    python scripts/test_acl_retrieval_accuracy.py

Output:
    - Console: Summary metrics + per-case details
    - JSON: Full results saved to data/test_results/acl_retrieval_results.json
"""

from __future__ import annotations

import asyncio
import json
import random
import sqlite3
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Optional

# Add src to path
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from integrity_checker.database import LocalDatabase
from integrity_checker.models.citation import Citation
from integrity_checker.retrieval.retrieval_orchestrator import RetrievalOrchestrator


@dataclass
class TestCase:
    """Một test case cho một paper trong database."""
    paper_id: int
    doi: str | None
    title: str
    authors: str  # JSON string
    year: int | None
    venue: str | None

    # Citation simulation params
    citation_type: str = "full"  # "full", "partial", "title_only", "no_year"
    has_doi: bool = True
    has_year: bool = True
    has_venue: bool = True

    # Ground truth
    ground_truth_found: bool = False
    retrieval_result: dict | None = None
    retrieval_time_ms: float = 0
    match_score: float = 0.0
    matched_paper_id: int | None = None
    false_positive: bool = False
    false_negative: bool = False


@dataclass
class EvaluationMetrics:
    """Metrics for retrieval evaluation."""
    total_cases: int = 0
    true_positives: int = 0
    false_positives: int = 0
    false_negatives: int = 0

    # Match quality
    exact_matches: int = 0  # Found with exact DOI match
    title_matches: int = 0   # Found with title similarity >= 0.7
    partial_matches: int = 0 # Found with lower similarity

    # Timing
    total_time_ms: float = 0
    avg_time_ms: float = 0

    # Breakdown by citation type
    by_type: dict = field(default_factory=dict)

    @property
    def precision(self) -> float:
        if self.true_positives + self.false_positives == 0:
            return 0.0
        return self.true_positives / (self.true_positives + self.false_positives)

    @property
    def recall(self) -> float:
        if self.true_positives + self.false_negatives == 0:
            return 0.0
        return self.true_positives / (self.true_positives + self.false_negatives)

    @property
    def f1(self) -> float:
        if self.precision + self.recall == 0:
            return 0.0
        return 2 * (self.precision * self.recall) / (self.precision + self.recall)

    @property
    def accuracy(self) -> float:
        if self.total_cases == 0:
            return 0.0
        return self.true_positives / self.total_cases


def parse_authors(authors_str: str) -> list[str]:
    """Parse authors from JSON string to list of strings."""
    try:
        authors_list = json.loads(authors_str)
        return [str(name) for name in authors_list] if authors_list else []
    except:
        return ["Unknown"]


def create_citation_from_paper(paper: TestCase) -> Citation:
    """Create a Citation object from a paper, simulating various citation styles."""
    authors = parse_authors(paper.authors)

    # Create raw text based on citation type
    if paper.citation_type == "full":
        raw_text = f"{', '.join(authors)}. ({paper.year}). {paper.title}."
    elif paper.citation_type == "partial":
        raw_text = f"{authors[0].split()[-1] if authors else 'Unknown'} et al. ({paper.year}). {paper.title}."
    elif paper.citation_type == "title_only":
        raw_text = f"{paper.title}"
    else:  # no_year
        raw_text = f"{authors[0].split()[-1] if authors else 'Unknown'} et al. {paper.title}."

    citation = Citation(
        raw_text=raw_text,
        authors=authors,
        title=paper.title,
        year=str(paper.year) if paper.year and paper.has_year else None,
        venue=paper.venue if paper.has_venue else None,
        doi=paper.doi if paper.has_doi else None,
    )

    return citation


async def run_retrieval_test(
    papers: list[TestCase],
    db_path: str = "./data/local_papers.db",
    use_external_apis: bool = False,
) -> tuple[list[TestCase], EvaluationMetrics]:
    """Run retrieval test on a list of papers."""

    # Initialize orchestrator with local database
    # Note: RetrievalOrchestrator enables all APIs by default
    # For this test, we want to primarily test local DB lookup
    local_db = LocalDatabase(db_path)
    orchestrator = RetrievalOrchestrator(
        local_db=local_db,
        use_local_db=True,
    )

    metrics = EvaluationMetrics(total_cases=len(papers))
    results: list[TestCase] = []

    for paper in papers:
        citation = create_citation_from_paper(paper)

        start_time = time.time()
        try:
            result = await orchestrator.retrieve(citation)
            retrieval_time = (time.time() - start_time) * 1000
        except Exception as e:
            print(f"Error retrieving: {paper.title[:50]}... - {e}")
            retrieval_time = (time.time() - start_time) * 1000
            paper.retrieval_result = {"error": str(e)}
            results.append(paper)
            metrics.false_negatives += 1
            continue

        paper.retrieval_time_ms = retrieval_time
        metrics.total_time_ms += retrieval_time

        # Check if we found the correct paper
        found = False
        match_type = None

        for candidate in result.candidates:
            # Check if this is the correct paper
            is_correct = False

            # Exact DOI match
            if paper.doi and candidate.doi:
                if paper.doi.lower().replace("https://doi.org/", "").replace("http://doi.org/", "") == \
                   candidate.doi.lower().replace("https://doi.org/", "").replace("http://doi.org/", ""):
                    is_correct = True
                    match_type = "exact_doi"

            # Title similarity check
            if not is_correct and candidate.title:
                from integrity_checker.retrieval.normalization import title_similarity
                sim = title_similarity(paper.title, candidate.title)
                paper.match_score = max(paper.match_score, sim)
                if sim >= 0.85:
                    is_correct = True
                    match_type = "high_title_sim" if sim >= 0.95 else "title_sim"
                    paper.matched_paper_id = candidate.paper_id

            # Check if it was found in local DB
            if candidate.source_name == "local_db" and is_correct:
                found = True

        paper.ground_truth_found = found

        if found:
            paper.retrieval_result = {
                "found": True,
                "match_type": match_type,
                "num_candidates": len(result.candidates),
                "top_candidate": {
                    "title": result.candidates[0].title[:80] if result.candidates else None,
                    "source": result.candidates[0].source_name if result.candidates else None,
                    "confidence": result.candidates[0].confidence if result.candidates else None,
                }
            }
            metrics.true_positives += 1
            if match_type == "exact_doi":
                metrics.exact_matches += 1
            elif match_type in ("high_title_sim", "title_sim"):
                metrics.title_matches += 1
            else:
                metrics.partial_matches += 1
        else:
            paper.retrieval_result = {
                "found": False,
                "num_candidates": len(result.candidates),
                "candidates": [
                    {"title": (c.title[:60] if c.title else "No title"), "source": c.source_name, "confidence": c.confidence}
                    for c in result.candidates[:3]
                ] if result.candidates else []
            }
            metrics.false_negatives += 1

        # Track by citation type
        if paper.citation_type not in metrics.by_type:
            metrics.by_type[paper.citation_type] = {
                "total": 0, "found": 0, "not_found": 0
            }
        metrics.by_type[paper.citation_type]["total"] += 1
        if found:
            metrics.by_type[paper.citation_type]["found"] += 1
        else:
            metrics.by_type[paper.citation_type]["not_found"] += 1

        results.append(paper)

    metrics.avg_time_ms = metrics.total_time_ms / len(papers) if papers else 0

    return results, metrics


def load_acl_papers(db_path: str, limit: int = 100) -> list[TestCase]:
    """Load ACL papers from local database."""
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    # Get papers with good metadata from ACL venues
    cursor.execute("""
        SELECT id, doi, title, authors, year, venue
        FROM papers
        WHERE (venue LIKE '%ACL%' OR venue LIKE '%NAACL%' OR venue LIKE '%EMNLP%'
               OR venue LIKE '%COLING%' OR venue LIKE '%TACL%')
          AND title IS NOT NULL
          AND authors IS NOT NULL
          AND year IS NOT NULL
          AND year > 2000
        ORDER BY RANDOM()
        LIMIT ?
    """, (limit,))

    rows = cursor.fetchall()
    conn.close()

    papers = []
    for r in rows:
        papers.append(TestCase(
            paper_id=r[0],
            doi=r[1],
            title=r[2],
            authors=r[3],
            year=r[4],
            venue=r[5],
        ))

    return papers


def print_report(metrics: EvaluationMetrics, results: list[TestCase], elapsed_time: float):
    """Print evaluation report."""
    print("\n" + "=" * 70)
    print("📊 RETRIEVAL ACCURACY EVALUATION REPORT")
    print("=" * 70)

    print(f"\n⏱️  Total Time: {elapsed_time:.2f}s")
    print(f"📁 Papers Tested: {metrics.total_cases}")

    print("\n" + "-" * 50)
    print("📈 OVERALL METRICS")
    print("-" * 50)
    print(f"  Precision:     {metrics.precision:.2%}")
    print(f"  Recall:        {metrics.recall:.2%}")
    print(f"  F1 Score:      {metrics.f1:.2%}")
    print(f"  Accuracy:      {metrics.accuracy:.2%}")

    print("\n" + "-" * 50)
    print("🔍 MATCH BREAKDOWN")
    print("-" * 50)
    print(f"  Exact DOI Match:     {metrics.exact_matches:4d} ({metrics.exact_matches/metrics.total_cases:.1%})")
    print(f"  High Title Sim (≥95%): {metrics.title_matches - metrics.partial_matches:4d}")
    print(f"  Title Sim (85-95%):   {metrics.partial_matches:4d}")
    print(f"  Not Found:             {metrics.false_negatives:4d}")

    print("\n" + "-" * 50)
    print("📋 BREAKDOWN BY CITATION TYPE")
    print("-" * 50)
    for ctype, stats in metrics.by_type.items():
        pct = stats["found"] / stats["total"] * 100 if stats["total"] > 0 else 0
        print(f"  {ctype:15s}: {stats['found']:3d}/{stats['total']:3d} found ({pct:.0f}%)")

    print("\n" + "-" * 50)
    print("⏱️  PERFORMANCE")
    print("-" * 50)
    print(f"  Total Time:   {metrics.total_time_ms:.0f}ms")
    print(f"  Avg per Query: {metrics.avg_time_ms:.1f}ms")

    # Show some failure cases
    failures = [r for r in results if not r.ground_truth_found][:5]
    if failures:
        print("\n" + "-" * 50)
        print("❌ SAMPLE FAILURES (first 5)")
        print("-" * 50)
        for f in failures:
            print(f"  • {f.title[:60]}...")
            print(f"    Type: {f.citation_type} | DOI: {f.doi[:30] if f.doi else 'None'}...")

    # Show success cases
    successes = [r for r in results if r.ground_truth_found][:5]
    if successes:
        print("\n" + "-" * 50)
        print("✅ SAMPLE SUCCESSES (first 5)")
        print("-" * 50)
        for s in successes:
            print(f"  ✓ {s.title[:60]}...")
            print(f"    Match Score: {s.match_score:.2f}")

    print("\n" + "=" * 70)


def save_results(results: list[TestCase], metrics: EvaluationMetrics, output_path: str):
    """Save results to JSON file."""
    output = {
        "timestamp": datetime.now().isoformat(),
        "metrics": {
            "total_cases": metrics.total_cases,
            "precision": metrics.precision,
            "recall": metrics.recall,
            "f1": metrics.f1,
            "accuracy": metrics.accuracy,
            "true_positives": metrics.true_positives,
            "false_positives": metrics.false_positives,
            "false_negatives": metrics.false_negatives,
            "exact_matches": metrics.exact_matches,
            "title_matches": metrics.title_matches,
            "partial_matches": metrics.partial_matches,
            "total_time_ms": metrics.total_time_ms,
            "avg_time_ms": metrics.avg_time_ms,
            "by_type": metrics.by_type,
        },
        "cases": [
            {
                "paper_id": r.paper_id,
                "title": r.title,
                "authors": r.authors,
                "year": r.year,
                "doi": r.doi,
                "citation_type": r.citation_type,
                "found": r.ground_truth_found,
                "match_score": r.match_score,
                "matched_paper_id": r.matched_paper_id,
                "retrieval_time_ms": r.retrieval_time_ms,
                "result": r.retrieval_result,
            }
            for r in results
        ]
    }

    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, 'w') as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"\n💾 Results saved to: {output_path}")


async def main():
    """Main test runner."""
    import argparse

    parser = argparse.ArgumentParser(description="Test ACL retrieval accuracy")
    parser.add_argument("--limit", type=int, default=100, help="Number of papers to test")
    parser.add_argument("--db-path", type=str, default="./data/local_papers.db", help="Database path")
    parser.add_argument("--output", type=str, default="./data/test_results/acl_retrieval_results.json")
    parser.add_argument("--mixed-types", action="store_true", help="Mix citation types")
    args = parser.parse_args()

    print("🔍 Loading ACL papers from database...")
    papers = load_acl_papers(args.db_path, args.limit)
    print(f"   Loaded {len(papers)} papers")

    # Optionally mix citation types
    if args.mixed_types:
        print("\n📝 Creating mixed citation types...")
        for paper in papers:
            paper.citation_type = random.choice(["full", "partial", "title_only", "no_year"])
            paper.has_doi = random.random() > 0.3  # 70% have DOI
            paper.has_year = random.random() > 0.2  # 80% have year
            paper.has_venue = random.random() > 0.5  # 50% have venue
    else:
        print("\n📝 Creating full-metadata citations...")
        for paper in papers:
            paper.citation_type = "full"

    print("\n🚀 Running retrieval tests...")
    start_time = time.time()
    results, metrics = await run_retrieval_test(papers, args.db_path)
    elapsed = time.time() - start_time

    # Print report
    print_report(metrics, results, elapsed)

    # Save results
    save_results(results, metrics, args.output)

    return metrics


if __name__ == "__main__":
    asyncio.run(main())
