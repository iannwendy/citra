#!/usr/bin/env python3
"""
Test retrieval accuracy on ACL papers from the local database.

This script:
1. Deterministically samples ACL papers from local_papers.db (seeded by --seed)
2. Simulates citations (varying quality: full metadata, partial, title-only, no_year)
3. Runs RetrievalOrchestrator offline by default (or with --use-external-apis)
4. Calculates metrics: Precision (including false positives), Recall, F1, Accuracy
5. Reports detailed breakdown by match quality and metadata completeness
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

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT / "src") not in sys.path:
    sys.path.insert(0, str(REPO_ROOT / "src"))

from integrity_checker.database import LocalDatabase  # noqa: E402
from integrity_checker.models.citation import Citation  # noqa: E402
from integrity_checker.models.source import SourceCandidate  # noqa: E402
from integrity_checker.retrieval.normalization import title_similarity  # noqa: E402
from integrity_checker.retrieval.retrieval_orchestrator import RetrievalOrchestrator  # noqa: E402

_EXTERNAL_CLIENT_ATTRS: tuple[str, ...] = (
    "crossref",
    "openalex",
    "dblp",
    "arxiv",
    "openlibrary",
    "europepmc",
    "datacite",
    "doi_ra",
    "doaj",
    "openaire_hal",
    "ncbi_biorxiv",
    "huggingface",
    "tech_standard",
    "wikidata_opencitations",
    "serpapi",
)


@dataclass
class TestCase:
    """Single retrieval benchmark test case for a ground-truth paper."""

    paper_id: int
    doi: str | None
    title: str
    authors: str  # JSON string
    year: int | None
    venue: str | None

    citation_type: str = "full"  # "full", "partial", "title_only", "no_year"
    has_doi: bool = True
    has_year: bool = True
    has_venue: bool = True

    ground_truth_found: bool = False
    retrieval_result: dict | None = None
    retrieval_time_ms: float = 0.0
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

    exact_matches: int = 0   # Exact DOI match
    title_matches: int = 0   # High title similarity (>= 0.95)
    partial_matches: int = 0  # Moderate title similarity (0.85 <= sim < 0.95)

    total_time_ms: float = 0.0
    avg_time_ms: float = 0.0

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
    except Exception:
        return ["Unknown"]


def create_citation_from_paper(paper: TestCase) -> Citation:
    """Create a Citation object from a paper, simulating various citation styles."""
    authors = parse_authors(paper.authors)
    lead_tokens = authors[0].split() if authors and authors[0].strip() else []
    lead_surname = lead_tokens[-1] if lead_tokens else "Unknown"

    if paper.citation_type == "full":
        raw_text = f"{', '.join(authors)}. ({paper.year}). {paper.title}."
    elif paper.citation_type == "partial":
        raw_text = f"{lead_surname} et al. ({paper.year}). {paper.title}."
    elif paper.citation_type == "title_only":
        raw_text = f"{paper.title}"
    else:
        raw_text = f"{lead_surname} et al. {paper.title}."

    return Citation(
        raw_text=raw_text,
        authors=authors,
        title=paper.title,
        year=str(paper.year) if paper.year and paper.has_year else None,
        venue=paper.venue if paper.has_venue else None,
        doi=paper.doi if paper.has_doi else None,
    )


def _normalize_doi_str(raw_doi: str | None) -> str:
    if not raw_doi:
        return ""
    return (
        raw_doi.strip()
        .lower()
        .removeprefix("https://doi.org/")
        .removeprefix("http://doi.org/")
        .removeprefix("https://dx.doi.org/")
        .removeprefix("http://dx.doi.org/")
    )


def _evaluate_candidate(
    paper: TestCase,
    candidate: SourceCandidate,
    *,
    require_local_source: bool,
) -> tuple[bool, str | None, float]:
    """Evaluate whether a candidate matches ground truth and return (is_match, match_type, sim)."""
    if require_local_source and candidate.source_name != "local_db":
        return False, None, 0.0

    paper_doi = _normalize_doi_str(paper.doi)
    cand_doi = _normalize_doi_str(candidate.doi)
    if paper_doi and cand_doi and paper_doi == cand_doi:
        return True, "exact_doi", 1.0

    if candidate.title:
        sim = title_similarity(paper.title, candidate.title)
        if sim >= 0.95:
            return True, "high_title_sim", sim
        if sim >= 0.85:
            return True, "title_sim", sim
        return False, None, sim

    return False, None, 0.0


async def run_retrieval_test(
    papers: list[TestCase],
    db_path: str = "./data/local_papers.db",
    use_external_apis: bool = False,
) -> tuple[list[TestCase], EvaluationMetrics]:
    """Run retrieval test on a list of papers."""
    local_db = LocalDatabase(db_path)
    orchestrator = RetrievalOrchestrator(
        local_db=local_db,
        use_local_db=True,
        enable_link_validation=bool(use_external_apis),
        use_persistent_cache=False,
    )
    if not use_external_apis:
        for attr in _EXTERNAL_CLIENT_ATTRS:
            if hasattr(orchestrator, attr):
                setattr(orchestrator, attr, None)

    metrics = EvaluationMetrics(total_cases=len(papers))
    results: list[TestCase] = []

    for paper in papers:
        citation = create_citation_from_paper(paper)

        start_time = time.time()
        try:
            try:
                result = await orchestrator.retrieve(
                    citation, allow_serpapi=bool(use_external_apis)
                )
            except TypeError:
                result = await orchestrator.retrieve(citation)
            retrieval_time = (time.time() - start_time) * 1000
        except Exception as e:
            print(f"Error retrieving: {paper.title[:50]}... - {e}")
            retrieval_time = (time.time() - start_time) * 1000
            paper.retrieval_result = {"error": str(e)}
            paper.false_negative = True
            results.append(paper)
            metrics.false_negatives += 1
            continue

        paper.retrieval_time_ms = retrieval_time
        metrics.total_time_ms += retrieval_time
        paper.false_positive = False
        paper.false_negative = False
        paper.ground_truth_found = False
        paper.match_score = 0.0
        paper.matched_paper_id = None

        found = False
        require_local = not use_external_apis

        if result.candidates:
            top_cand = result.candidates[0]
            top_ok, top_match_type, top_sim = _evaluate_candidate(
                paper,
                top_cand,
                require_local_source=require_local,
            )
            paper.match_score = top_sim
            if top_ok:
                found = True
                paper.ground_truth_found = True
                paper.matched_paper_id = top_cand.paper_id
                metrics.true_positives += 1
                if top_match_type == "exact_doi":
                    metrics.exact_matches += 1
                elif top_match_type == "high_title_sim":
                    metrics.title_matches += 1
                else:
                    metrics.partial_matches += 1
                paper.retrieval_result = {
                    "found": True,
                    "match_type": top_match_type,
                    "num_candidates": len(result.candidates),
                    "top_candidate": {
                        "title": top_cand.title[:80] if top_cand.title else None,
                        "source": top_cand.source_name,
                        "confidence": top_cand.confidence,
                    },
                }
            else:
                paper.false_positive = True
                paper.false_negative = True
                metrics.false_positives += 1
                metrics.false_negatives += 1
                paper.retrieval_result = {
                    "found": False,
                    "num_candidates": len(result.candidates),
                    "candidates": [
                        {
                            "title": (c.title[:60] if c.title else "No title"),
                            "source": c.source_name,
                            "confidence": c.confidence,
                        }
                        for c in result.candidates[:3]
                    ],
                }
        else:
            paper.false_negative = True
            metrics.false_negatives += 1
            paper.retrieval_result = {
                "found": False,
                "num_candidates": 0,
                "candidates": [],
            }

        if paper.citation_type not in metrics.by_type:
            metrics.by_type[paper.citation_type] = {"total": 0, "found": 0, "not_found": 0}
        metrics.by_type[paper.citation_type]["total"] += 1
        if found:
            metrics.by_type[paper.citation_type]["found"] += 1
        else:
            metrics.by_type[paper.citation_type]["not_found"] += 1

        results.append(paper)

    metrics.avg_time_ms = metrics.total_time_ms / len(papers) if papers else 0.0
    return results, metrics


def load_acl_papers(
    db_path: str,
    limit: int = 100,
    seed: int | None = 42,
) -> list[TestCase]:
    """Load a deterministic sample of ACL papers from the local database."""
    conn = sqlite3.connect(db_path)
    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT id, doi, title, authors, year, venue
            FROM papers
            WHERE (venue LIKE '%ACL%' OR venue LIKE '%NAACL%' OR venue LIKE '%EMNLP%'
                   OR venue LIKE '%COLING%' OR venue LIKE '%TACL%')
              AND title IS NOT NULL
              AND authors IS NOT NULL
              AND year IS NOT NULL
              AND year > 2000
            ORDER BY id ASC
            """
        )
        rows = cursor.fetchall()
    finally:
        conn.close()

    if limit >= 0 and len(rows) > limit:
        rng = random.Random(seed)
        rows = rng.sample(rows, k=limit)
    elif limit >= 0:
        rows = rows[:limit]

    return [
        TestCase(
            paper_id=r[0],
            doi=r[1],
            title=r[2],
            authors=r[3],
            year=r[4],
            venue=r[5],
        )
        for r in rows
    ]


def print_report(
    metrics: EvaluationMetrics,
    results: list[TestCase],
    elapsed_time: float,
) -> None:
    """Print evaluation report safely even when total_cases == 0."""
    print("\n" + "=" * 70)
    print("RETRIEVAL ACCURACY EVALUATION REPORT")
    print("=" * 70)

    print(f"\nTotal Time: {elapsed_time:.2f}s")
    print(f"Papers Tested: {metrics.total_cases}")

    print("\n" + "-" * 50)
    print("OVERALL METRICS")
    print("-" * 50)
    print(f"  Precision:     {metrics.precision:.2%}")
    print(f"  Recall:        {metrics.recall:.2%}")
    print(f"  F1 Score:      {metrics.f1:.2%}")
    print(f"  Accuracy:      {metrics.accuracy:.2%}")

    exact_pct = (metrics.exact_matches / metrics.total_cases) if metrics.total_cases else 0.0
    print("\n" + "-" * 50)
    print("MATCH BREAKDOWN")
    print("-" * 50)
    print(f"  Exact DOI Match:       {metrics.exact_matches:4d} ({exact_pct:.1%})")
    print(f"  High Title Sim (>=95%): {metrics.title_matches:4d}")
    print(f"  Title Sim (85-95%):    {metrics.partial_matches:4d}")
    print(f"  False Positives:       {metrics.false_positives:4d}")
    print(f"  Not Found:             {metrics.false_negatives:4d}")

    print("\n" + "-" * 50)
    print("BREAKDOWN BY CITATION TYPE")
    print("-" * 50)
    for ctype, stats in metrics.by_type.items():
        pct = stats["found"] / stats["total"] * 100 if stats["total"] > 0 else 0.0
        print(f"  {ctype:15s}: {stats['found']:3d}/{stats['total']:3d} found ({pct:.0f}%)")

    print("\n" + "-" * 50)
    print("PERFORMANCE")
    print("-" * 50)
    print(f"  Total Time:    {metrics.total_time_ms:.0f}ms")
    print(f"  Avg per Query: {metrics.avg_time_ms:.1f}ms")

    failures = [r for r in results if not r.ground_truth_found][:5]
    if failures:
        print("\n" + "-" * 50)
        print("SAMPLE FAILURES (first 5)")
        print("-" * 50)
        for f in failures:
            print(f"  - {f.title[:60]}...")
            print(f"    Type: {f.citation_type} | DOI: {f.doi[:30] if f.doi else 'None'}...")

    successes = [r for r in results if r.ground_truth_found][:5]
    if successes:
        print("\n" + "-" * 50)
        print("SAMPLE SUCCESSES (first 5)")
        print("-" * 50)
        for s in successes:
            print(f"  + {s.title[:60]}...")
            print(f"    Match Score: {s.match_score:.2f}")

    print("\n" + "=" * 70)


def save_results(results: list[TestCase], metrics: EvaluationMetrics, output_path: str) -> None:
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
                "false_positive": r.false_positive,
                "false_negative": r.false_negative,
                "match_score": r.match_score,
                "matched_paper_id": r.matched_paper_id,
                "retrieval_time_ms": r.retrieval_time_ms,
                "result": r.retrieval_result,
            }
            for r in results
        ],
    }

    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"\nResults saved to: {output_path}")


async def main() -> EvaluationMetrics:
    """Main test runner."""
    import argparse

    parser = argparse.ArgumentParser(description="Test ACL retrieval accuracy")
    parser.add_argument("--limit", type=int, default=100, help="Number of papers to test")
    parser.add_argument("--db-path", type=str, default="./data/local_papers.db", help="Database path")
    parser.add_argument(
        "--output",
        type=str,
        default="./data/test_results/acl_retrieval_results.json",
    )
    parser.add_argument("--mixed-types", action="store_true", help="Mix citation types")
    parser.add_argument("--seed", type=int, default=42, help="Deterministic RNG seed (default: 42)")
    parser.add_argument(
        "--use-external-apis",
        action="store_true",
        help="Allow external scholarly API fallback on local DB misses",
    )
    args = parser.parse_args()

    print("Loading ACL papers from database...")
    papers = load_acl_papers(args.db_path, args.limit, seed=args.seed)
    print(f"   Loaded {len(papers)} papers (seed={args.seed})")

    rng = random.Random(args.seed)
    if args.mixed_types:
        print("\nCreating mixed citation types...")
        for paper in papers:
            paper.citation_type = rng.choice(["full", "partial", "title_only", "no_year"])
            paper.has_doi = rng.random() > 0.3
            paper.has_year = rng.random() > 0.2
            paper.has_venue = rng.random() > 0.5
    else:
        print("\nCreating full-metadata citations...")
        for paper in papers:
            paper.citation_type = "full"

    print("\nRunning retrieval tests...")
    start_time = time.time()
    results, metrics = await run_retrieval_test(
        papers,
        args.db_path,
        use_external_apis=args.use_external_apis,
    )
    elapsed = time.time() - start_time

    print_report(metrics, results, elapsed)
    save_results(results, metrics, args.output)
    return metrics


if __name__ == "__main__":
    asyncio.run(main())
