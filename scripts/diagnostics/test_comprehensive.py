#!/usr/bin/env python3
"""Comprehensive test script - Compare Thesis vs Scenario A/B + Track API vs DB usage."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import sys
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Optional

# Keep repository-root execution working after moving this diagnostic script.
REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

# Configure logging to track API vs DB calls
logging.basicConfig(
    level=logging.DEBUG,
    format='%(levelname)s | %(name)s | %(message)s'
)

# Track API and DB calls
api_calls = []
db_calls = []

# Custom handler to capture API/DB calls
class CallTracker(logging.Handler):
    def __init__(self):
        super().__init__()
        self.calls = []

    def emit(self, record):
        msg = record.getMessage()
        # Track API calls
        if 'httpx' in record.name.lower() or 'HTTP Request' in msg:
            self.calls.append({
                'type': 'API',
                'message': msg,
                'source': record.name
            })
        # Track DB hits (known papers)
        elif 'Known paper HIT' in msg:
            self.calls.append({
                'type': 'DB',
                'message': msg,
                'source': 'known_papers'
            })
        # Track local DB misses
        elif 'Local DB MISS' in msg:
            self.calls.append({
                'type': 'DB_MISS',
                'message': msg,
                'source': 'local_db'
            })

tracker = CallTracker()

# Add tracker to logger
for logger_name in ['integrity_checker', 'integrity_checker.retrieval', 'integrity_checker.retrieval.retrieval_orchestrator']:
    logger = logging.getLogger(logger_name)
    logger.addHandler(tracker)
    logger.setLevel(logging.DEBUG)


@dataclass
class TestResult:
    """Result from testing a single citation."""
    citation_id: str
    raw_citation: str
    ground_truth: str
    predicted: str
    confidence: float
    verdict_reason: str
    sources_found: int
    api_used: list[str] = field(default_factory=list)
    db_used: bool = False
    error: str | None = None


async def test_citation(
    citation_text: str,
    ground_truth: str,
    citation_id: str,
    orchestrator,
    checker,
    api_tracker: list,
    db_tracker: list,
) -> TestResult:
    """Test a single citation."""
    from integrity_checker.models.citation import Citation
    from integrity_checker.models.validation import ValidationLabel

    # Clear previous calls
    before_calls = len(api_tracker)

    # Create citation
    citation = Citation(raw_text=citation_text)

    # Parse year
    year_match = re.search(r'\((\d{4})\)', citation_text)
    if year_match:
        citation.year = year_match.group(1)

    # Parse author
    author_match = re.match(r'^([A-Z][a-z]+)', citation_text)
    if author_match:
        citation.authors = [author_match.group(1)]

    try:
        # Run retrieval
        result = await orchestrator.retrieve(citation)

        # Track API calls
        after_calls = len(api_tracker)
        new_calls = api_tracker[before_calls:after_calls]
        api_sources = [c['source'].split('.')[-1] for c in new_calls if c['type'] == 'API']
        db_used = any(c['type'] == 'DB' for c in new_calls)

        # Run checker
        verdict = checker.check(
            citation=citation,
            source=result,
            api_exhausted=result.api_exhausted,
        )

        # Map verdict to string
        label_map = {
            ValidationLabel.VERIFIED: "REAL",
            ValidationLabel.METADATA_ERROR: "METADATA_ERROR",
            ValidationLabel.SUSPECTED_HALLUCINATION: "HALLUCINATED",
            ValidationLabel.UNRESOLVED: "UNRESOLVED",
        }
        predicted = label_map.get(verdict.label, str(verdict.label))

        return TestResult(
            citation_id=citation_id,
            raw_citation=citation_text,
            ground_truth=ground_truth,
            predicted=predicted,
            confidence=verdict.confidence,
            verdict_reason=verdict.reasoning[:100] if verdict.reasoning else "",
            sources_found=len([c for c in result.candidates if c.found]),
            api_used=api_sources,
            db_used=db_used,
        )

    except Exception as e:
        return TestResult(
            citation_id=citation_id,
            raw_citation=citation_text,
            ground_truth=ground_truth,
            predicted="ERROR",
            confidence=0,
            verdict_reason=str(e),
            sources_found=0,
            error=str(e),
        )


async def run_thesis_test():
    """Test trên một PDF mẫu.

    PDF KHÔNG được track trong git — đặt file bất kỳ ở repo root và trỏ
    biến môi trường SAMPLE_PDF tới nó (mặc định: thesis.pdf).
    """
    from integrity_checker.extraction.citation_extractor import CitationExtractor
    from integrity_checker.extraction.document_parser import DocumentParser
    from integrity_checker.logic.neuro_symbolic_checker import NeuroSymbolicChecker
    from integrity_checker.retrieval.arxiv_client import ArxivClient
    from integrity_checker.retrieval.crossref_client import CrossrefClient
    from integrity_checker.retrieval.openalex_client import OpenAlexClient
    from integrity_checker.retrieval.retrieval_orchestrator import RetrievalOrchestrator
    from integrity_checker.retrieval.semantic_scholar_client import SemanticScholarClient

    print("\n" + "="*70)
    print("TEST 1: VietDepression_Research_Article.pdf")
    print("="*70)

    # Initialize
    orchestrator = RetrievalOrchestrator(
        crossref=CrossrefClient(),
        openalex=OpenAlexClient(),
        semantic_scholar=SemanticScholarClient(),
        arxiv=ArxivClient(),
        parallel=False,
    )
    checker = NeuroSymbolicChecker(enable_content_alignment=False)

    # Extract citations from PDF (không track trong git — xem .gitignore)
    pdf_path = Path(os.environ.get("SAMPLE_PDF", "thesis.pdf"))
    if not pdf_path.exists():
        print(f"❌ PDF not found: {pdf_path}")
        print("   Đặt một PDF mẫu ở repo root, hoặc set SAMPLE_PDF=<đường dẫn>.")
        return []

    # Parse PDF using DocumentParser
    doc_parser = DocumentParser()
    parsed_doc = doc_parser.parse(str(pdf_path))

    print(f"\n📄 Parsed PDF: {len(parsed_doc.references)} references")

    # Use references (full bibliography entries) for testing
    citations = parsed_doc.references

    results = []
    api_tracker = []
    db_tracker = []

    for i, cite in enumerate(citations):
        if i >= 30:  # Limit for quick test
            break

        result = await test_citation(
            citation_text=cite.raw_text,
            ground_truth="UNKNOWN",
            citation_id=f"THESIS_{i+1}",
            orchestrator=orchestrator,
            checker=checker,
            api_tracker=api_tracker,
            db_tracker=db_tracker,
        )
        results.append(result)

        await asyncio.sleep(0.3)

        if (i + 1) % 10 == 0:
            print(f"  Progress: {i+1}/{min(30, len(citations))}")

    return results, api_tracker, db_tracker


async def run_scenario_test(scenario_file: str, scenario_name: str):
    """Test on a specific scenario."""
    from integrity_checker.extraction.document_parser import DocumentParser
    from integrity_checker.logic.neuro_symbolic_checker import NeuroSymbolicChecker
    from integrity_checker.retrieval.arxiv_client import ArxivClient
    from integrity_checker.retrieval.crossref_client import CrossrefClient
    from integrity_checker.retrieval.openalex_client import OpenAlexClient
    from integrity_checker.retrieval.retrieval_orchestrator import RetrievalOrchestrator
    from integrity_checker.retrieval.semantic_scholar_client import SemanticScholarClient

    print("\n" + "="*70)
    print(f"TEST: {scenario_name}")
    print("="*70)

    # Initialize
    orchestrator = RetrievalOrchestrator(
        crossref=CrossrefClient(),
        openalex=OpenAlexClient(),
        semantic_scholar=SemanticScholarClient(),
        arxiv=ArxivClient(),
        parallel=False,
    )
    checker = NeuroSymbolicChecker(enable_content_alignment=False)

    # Check if it's a JSON file or PDF
    scenario_path = Path(scenario_file)

    if scenario_path.suffix == '.pdf':
        # Extract from PDF
        doc_parser = DocumentParser()
        parsed_doc = doc_parser.parse(str(scenario_path))
        # Use references (bibliography) for testing
        citations = [(c.raw_text, c.raw_text) for c in parsed_doc.references[:30]]

    elif scenario_path.suffix == '.json':
        # Load from JSON
        with open(scenario_path) as f:
            data = json.load(f)

        citations = []
        for item in data:
            if isinstance(item, dict):
                in_text = item.get('in_text', item.get('citation', ''))
                expected = item.get('expected_label', item.get('ground_truth', 'UNKNOWN'))
                citations.append((in_text, expected))

    else:
        print(f"❌ Unknown file format: {scenario_file}")
        return []

    print(f"\n📄 Testing {len(citations)} citations")

    results = []
    api_tracker = []
    db_tracker = []

    for i, (in_text, expected) in enumerate(citations):
        result = await test_citation(
            citation_text=in_text,
            ground_truth=expected,
            citation_id=f"{scenario_name}_{i+1}",
            orchestrator=orchestrator,
            checker=checker,
            api_tracker=api_tracker,
            db_tracker=db_tracker,
        )
        results.append(result)

        await asyncio.sleep(0.3)

        if (i + 1) % 10 == 0:
            print(f"  Progress: {i+1}/{len(citations)}")

    return results, api_tracker, db_tracker


def analyze_results(results: list, api_calls: list, db_calls: list, name: str):
    """Analyze and print results."""
    print(f"\n{'='*70}")
    print(f"ANALYSIS: {name}")
    print("="*70)

    # Count by verdict
    verdicts = {}
    for r in results:
        verdicts[r.predicted] = verdicts.get(r.predicted, 0) + 1

    print("\n📊 Verdict Distribution:")
    for v, count in sorted(verdicts.items()):
        pct = 100 * count / len(results) if results else 0
        print(f"   {v}: {count} ({pct:.1f}%)")

    # DB vs API usage
    db_hits = sum(1 for c in api_calls if c['type'] == 'DB')
    api_calls_count = sum(1 for c in api_calls if c['type'] == 'API')
    db_misses = sum(1 for c in api_calls if c['type'] == 'DB_MISS')

    print("\n🔍 Database vs API Usage:")
    print(f"   Known Papers (fast lookup): {db_hits}/{len(results)} ({100*db_hits/len(results):.1f}%)")
    print(f"   API calls made: {api_calls_count}")
    print(f"   Local DB misses: {db_misses}")
    print(f"   Total DB checks: {db_hits + db_misses}")

    # Accuracy (if ground truth available)
    with_gt = [r for r in results if r.ground_truth != "UNKNOWN"]
    if with_gt:
        correct = sum(1 for r in with_gt if r.predicted == r.ground_truth)
        acc = 100 * correct / len(with_gt)
        print(f"\n📈 Accuracy: {correct}/{len(with_gt)} ({acc:.1f}%)")

    return {
        'verdicts': verdicts,
        'db_hits': db_hits,
        'db_misses': db_misses,
        'api_calls': api_calls_count,
        'total': len(results),
    }


def compare_scenarios(results_dict: dict):
    """Compare results across scenarios."""
    print("\n" + "="*70)
    print("COMPARISON ACROSS SCENARIOS")
    print("="*70)

    print(f"\n{'Scenario':<30} {'REAL':<8} {'HALLU':<8} {'METAERR':<10} {'UNRES':<8} {'DB HIT':<10}")
    print("-" * 80)

    for name, data in results_dict.items():
        verdicts = data['verdicts']
        print(f"{name:<30} "
              f"{verdicts.get('REAL', 0):<8} "
              f"{verdicts.get('HALLUCINATED', 0):<8} "
              f"{verdicts.get('METADATA_ERROR', 0):<10} "
              f"{verdicts.get('UNRESOLVED', 0):<8} "
              f"{data['db_hits']}/{data['total']:<10}")


async def ensure_scenario_fixtures() -> None:
    """Sinh fixture PDF cho scenario test nếu chưa có.

    Hai file PDF scenario KHÔNG được track trong git (xem .gitignore) —
    chúng là dữ liệu sinh tự động, chỉ nằm trên máy. Hàm này gọi lại
    generator để bảo đảm fixture tồn tại trước khi test.
    """
    scenario_a = Path("data/test_scenarios/test_cite_scenario_a.pdf")
    scenario_b = Path("data/test_scenarios/test_cite_scenario_b.pdf")

    if scenario_a.exists() and scenario_b.exists():
        return

    print("🔧 Scenario PDF fixtures chưa có — đang sinh bằng scripts/fixtures/test_cite_scenarios.py ...")
    try:
        from scripts.fixtures import test_cite_scenarios

        test_cite_scenarios.main()
        print("✅ Đã sinh xong scenario fixtures")
    except Exception as e:
        print(f"⚠️ Không sinh được scenario fixtures: {e}")


async def main():
    """Main test function."""
    print("="*70)
    print("CITATION INTEGRITY CHECKER - COMPREHENSIVE TEST")
    print("="*70)
    print(f"Timestamp: {datetime.now().isoformat()}")

    await ensure_scenario_fixtures()

    results_dict = {}

    # Test 1: Thesis PDF
    try:
        thesis_results, thesis_api, thesis_db = await run_thesis_test()
        results_dict['THESIS'] = analyze_results(thesis_results, thesis_api, thesis_db, 'Thesis PDF')
    except Exception as e:
        print(f"❌ Thesis test failed: {e}")
        import traceback
        traceback.print_exc()

    # Test 2: Scenario A
    try:
        scenario_a_path = Path("data/test_scenarios/test_cite_scenario_a.pdf")
        if scenario_a_path.exists():
            scenario_a_results, scenario_a_api, scenario_a_db = await run_scenario_test(
                str(scenario_a_path), "SCENARIO_A"
            )
            results_dict['SCENARIO_A'] = analyze_results(
                scenario_a_results, scenario_a_api, scenario_a_db, 'Scenario A'
            )
        else:
            print(f"⚠️ Scenario A PDF not found: {scenario_a_path}")
    except Exception as e:
        print(f"❌ Scenario A test failed: {e}")

    # Test 3: Scenario B
    try:
        scenario_b_path = Path("data/test_scenarios/test_cite_scenario_b.pdf")
        if scenario_b_path.exists():
            scenario_b_results, scenario_b_api, scenario_b_db = await run_scenario_test(
                str(scenario_b_path), "SCENARIO_B"
            )
            results_dict['SCENARIO_B'] = analyze_results(
                scenario_b_results, scenario_b_api, scenario_b_db, 'Scenario B'
            )
        else:
            print(f"⚠️ Scenario B PDF not found: {scenario_b_path}")
    except Exception as e:
        print(f"❌ Scenario B test failed: {e}")

    # Compare
    if len(results_dict) > 1:
        compare_scenarios(results_dict)

    # Save results
    output_path = Path("reports/comprehensive_test.json")
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with open(output_path, 'w') as f:
        json.dump(results_dict, f, indent=2, default=str)

    print(f"\n✅ Results saved to: {output_path}")


if __name__ == "__main__":
    asyncio.run(main())
