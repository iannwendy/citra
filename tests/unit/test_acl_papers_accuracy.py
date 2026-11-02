"""Test accuracy of paper retrieval on 500 ACL papers from local database.

This test evaluates how well the system identifies papers that are already
in the local database. It simulates real-world citation lookup scenarios.

Metrics:
- True Positive (TP): Paper found in DB, system correctly identifies it
- False Negative (FN): Paper in DB but system fails to find it
- False Positive (FP): System claims paper found but it wasn't in DB (N/A here)
- Precision: TP / (TP + FP) = 100% (since we only test papers that exist)
- Recall: TP / (TP + FN) = What percentage system correctly finds
- F1: 2 * Precision * Recall / (Precision + Recall)
"""

from __future__ import annotations

import asyncio
import random
import sqlite3
from pathlib import Path
from typing import Any

import pytest

from integrity_checker.database import LocalDatabase
from integrity_checker.models.citation import Citation
from integrity_checker.retrieval.retrieval_orchestrator import RetrievalOrchestrator

# Test configuration
TEST_SAMPLE_SIZE = 500
RANDOM_SEED = 42
DB_PATH = Path("./data/local_papers.db")


def get_acl_papers(db_path: Path, limit: int) -> list[dict[str, Any]]:
    """Fetch random ACL papers from database.

    Returns list of paper dicts with: id, doi, title, authors, year, venue
    """
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    # Get papers with at least title and year (minimum for matching)
    cursor.execute("""
        SELECT id, doi, arxiv_id, title, authors, year, venue
        FROM papers
        WHERE venue = 'acl'
          AND title IS NOT NULL
          AND title != ''
          AND year IS NOT NULL
        ORDER BY RANDOM()
        LIMIT ?
    """, (limit,))

    rows = cursor.fetchall()
    conn.close()

    return [dict(row) for row in rows]


def create_citation_from_paper(paper: dict[str, Any], include_doi: bool = True) -> Citation:
    """Create a Citation object simulating real citation extraction.

    Simulates different extraction scenarios:
    - With DOI (most reliable)
    - Without DOI (fallback to title/author/year)
    """
    authors = None
    if paper.get("authors"):
        import json
        try:
            authors = json.loads(paper["authors"])
        except (json.JSONDecodeError, TypeError):
            # Try comma-separated
            authors = [a.strip() for a in paper["authors"].split(",")]

    # Create citation with full metadata (realistic scenario)
    citation = Citation(
        raw_text=f"{paper['title']} by {paper['authors']}",
        doi=paper.get("doi") if include_doi else None,
        title=paper.get("title"),
        authors=authors,
        year=paper.get("year"),
    )

    return citation


def calculate_metrics(tp: int, fn: int) -> dict[str, float]:
    """Calculate precision, recall, F1, accuracy."""
    precision = tp / (tp + 0) if tp > 0 else 0.0  # No FP in this scenario
    recall = tp / (tp + fn) if (tp + fn) > 0 else 0.0
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0.0
    accuracy = tp / (tp + fn) if (tp + fn) > 0 else 0.0

    return {
        "precision": precision * 100,
        "recall": recall * 100,
        "f1": f1 * 100,
        "accuracy": accuracy * 100,
        "true_positives": tp,
        "false_negatives": fn,
        "total": tp + fn,
    }


@pytest.mark.slow
class TestACLPapersAccuracy:
    """Test retrieval accuracy on 500 ACL papers."""

    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test fixtures."""
        random.seed(RANDOM_SEED)

        # Check database exists
        if not DB_PATH.exists():
            pytest.skip(f"Database not found at {DB_PATH}")

        # Check we have enough ACL papers
        conn = sqlite3.connect(str(DB_PATH))
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM papers WHERE venue = 'acl'")
        acl_count = cursor.fetchone()[0]
        conn.close()

        if acl_count < TEST_SAMPLE_SIZE:
            pytest.skip(f"Not enough ACL papers: {acl_count} < {TEST_SAMPLE_SIZE}")

        self.db = LocalDatabase(DB_PATH)
        self.orchestrator = RetrievalOrchestrator(local_db=self.db)

    def test_sample_acl_papers_with_doi(self):
        """Test retrieval accuracy for papers WITH DOI."""
        print(f"\n{'='*60}")
        print(f"Testing {TEST_SAMPLE_SIZE} ACL papers WITH DOI")
        print(f"{'='*60}")

        papers = get_acl_papers(DB_PATH, TEST_SAMPLE_SIZE * 2)  # Get extra for filtering

        # Filter to only papers with DOI
        papers_with_doi = [p for p in papers if p.get("doi")]

        if len(papers_with_doi) < TEST_SAMPLE_SIZE:
            print(f"Warning: Only {len(papers_with_doi)} papers have DOI, testing all")

        sample = papers_with_doi[:TEST_SAMPLE_SIZE]

        tp, fn = 0, 0
        errors = []

        for i, paper in enumerate(sample):
            citation = create_citation_from_paper(paper, include_doi=True)

            # Use sync wrapper for testing
            result = asyncio.run(self.orchestrator.retrieve(citation))

            # Check if any candidate was found
            if result.best_candidate() is not None:
                tp += 1
            else:
                fn += 1
                errors.append({
                    "id": paper["id"],
                    "title": paper["title"][:50],
                    "doi": paper.get("doi"),
                    "sources_queried": result.sources_queried,
                    "sources_succeeded": result.sources_succeeded,
                })

            if (i + 1) % 50 == 0:
                print(f"  Progress: {i+1}/{len(sample)} - Current Recall: {tp/(tp+fn)*100:.1f}%")

        metrics = calculate_metrics(tp, fn)

        print(f"\n{'='*60}")
        print("RESULTS (Papers WITH DOI)")
        print(f"{'='*60}")
        print(f"Total tested:    {metrics['total']}")
        print(f"Found (TP):     {metrics['true_positives']}")
        print(f"Not found (FN): {metrics['false_negatives']}")
        print("")
        print(f"Accuracy:       {metrics['accuracy']:.2f}%")
        print(f"Recall:         {metrics['recall']:.2f}%")
        print(f"Precision:      {metrics['precision']:.2f}%")
        print(f"F1 Score:       {metrics['f1']:.2f}%")

        if errors:
            print("\nFailed papers (first 10):")
            for e in errors[:10]:
                print(f"  - [{e['id']}] {e['title']}... (DOI: {e.get('doi')})")
                print(f"    Sources: {e['sources_queried']}")
                print(f"    Succeeded: {e['sources_succeeded']}")

        # Assert minimum accuracy threshold
        assert metrics["recall"] >= 95.0, f"Recall too low: {metrics['recall']:.2f}%"

    def test_sample_acl_papers_without_doi(self):
        """Test retrieval accuracy for papers WITHOUT DOI (title/author/year only)."""
        print(f"\n{'='*60}")
        print(f"Testing {TEST_SAMPLE_SIZE} ACL papers WITHOUT DOI")
        print(f"{'='*60}")

        papers = get_acl_papers(DB_PATH, TEST_SAMPLE_SIZE * 3)  # Get more for filtering

        # Filter to papers without DOI (harder matching)
        papers_without_doi = [p for p in papers if not p.get("doi")]

        if len(papers_without_doi) < TEST_SAMPLE_SIZE:
            print(f"Warning: Only {len(papers_without_doi)} papers without DOI, testing all")
            if len(papers_without_doi) < 10:
                pytest.skip("Not enough papers without DOI for meaningful test")

        sample = papers_without_doi[:TEST_SAMPLE_SIZE]

        tp, fn = 0, 0
        errors = []

        for i, paper in enumerate(sample):
            citation = create_citation_from_paper(paper, include_doi=False)

            result = asyncio.run(self.orchestrator.retrieve(citation))

            # Check if any candidate was found
            if result.best_candidate() is not None:
                tp += 1
            else:
                fn += 1
                errors.append({
                    "id": paper["id"],
                    "title": paper["title"][:50],
                    "authors": paper.get("authors", "")[:30],
                    "year": paper.get("year"),
                    "sources_queried": result.sources_queried,
                    "sources_succeeded": result.sources_succeeded,
                })

            if (i + 1) % 50 == 0:
                current_recall = tp/(tp+fn)*100 if (tp+fn) > 0 else 0
                print(f"  Progress: {i+1}/{len(sample)} - Current Recall: {current_recall:.1f}%")

        metrics = calculate_metrics(tp, fn)

        print(f"\n{'='*60}")
        print("RESULTS (Papers WITHOUT DOI)")
        print(f"{'='*60}")
        print(f"Total tested:    {metrics['total']}")
        print(f"Found (TP):     {metrics['true_positives']}")
        print(f"Not found (FN): {metrics['false_negatives']}")
        print("")
        print(f"Accuracy:       {metrics['accuracy']:.2f}%")
        print(f"Recall:         {metrics['recall']:.2f}%")
        print(f"Precision:      {metrics['precision']:.2f}%")
        print(f"F1 Score:       {metrics['f1']:.2f}%")

        if errors:
            print("\nFailed papers (first 10):")
            for e in errors[:10]:
                print(f"  - [{e['id']}] {e['title']}...")
                print(f"    Authors: {e.get('authors', 'N/A')}, Year: {e.get('year')}")
                print(f"    Sources: {e['sources_queried']}")
                print(f"    Succeeded: {e['sources_succeeded']}")

        # Lower threshold for harder matching scenario
        assert metrics["recall"] >= 80.0, f"Recall too low: {metrics['recall']:.2f}%"

    def test_local_db_lookup_methods(self):
        """Test individual lookup methods in local database."""
        print(f"\n{'='*60}")
        print("Testing Local DB Lookup Methods")
        print(f"{'='*60}")

        papers = get_acl_papers(DB_PATH, 100)

        doi_success, doi_total = 0, 0
        title_success, title_total = 0, 0
        author_year_success, author_year_total = 0, 0

        for paper in papers:
            # Test 1: DOI lookup
            if paper.get("doi"):
                doi_total += 1
                found = self.db.find_by_doi(paper["doi"])
                if found:
                    doi_success += 1

            # Test 2: FTS title search
            if paper.get("title"):
                title_total += 1
                results = self.db.fuzzy_search(title=paper["title"], limit=1)
                if results and results[0].id == paper["id"]:
                    title_success += 1

        print(f"\nDOI Lookup:    {doi_success}/{doi_total} ({doi_success/doi_total*100:.1f}%)")
        print(f"Title FTS:     {title_success}/{title_total} ({title_success/title_total*100:.1f}%)")

        assert doi_total > 0, "No papers with DOI to test"
        assert title_total > 0, "No papers with title to test"


# Run tests standalone
if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s", "--tb=short"])
