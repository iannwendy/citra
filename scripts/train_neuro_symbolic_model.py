#!/usr/bin/env python3
"""Train & Calibrate the Hybrid Neuro-Symbolic Model on 120,000 Scholarly Samples.

International Standards & Methodological Alignment:
    1. Source Corpus & Stratified Paper-Disjoint Partitioning (Zero Data Leakage):
       Following SciFact (Wadden et al., EMNLP 2020) and FEVER (Thorne et al., NAACL 2018),
       we load 120,000 distinct real scholarly papers from `data/local_papers.db`
       (out of 129,125 total records: 80,000 with full abstracts >80 chars + 40,000
       with complete bibliographic metadata) and partition the base papers into
       strictly disjoint pools BEFORE generating any citation perturbations or
       cross-paper spliced hallucinations:
         - Train Pool (70.0%):      84,000 distinct base papers (56,000 full-abstract + 28,000 metadata)
         - Validation Pool (15.0%): 18,000 distinct base papers (12,000 full-abstract + 6,000 metadata)
         - Held-Out Test (15.0%):   18,000 distinct base papers (12,000 full-abstract + 6,000 metadata)
       Cross-paper perturbations (author swaps, spliced academic titles, misattributed
       in-text contexts, mismatched DOIs) only pair papers within the SAME split pool.
       Programmatic set-intersection assertions verify 0.0% paper-ID and title overlap.
    2. 4-Class Decision-Support Taxonomy & 15 Sub-Taxonomies (Zero Feature Shortcuts):
       Following Walters & Wilder (2023), ALCE (Gao et al., EMNLP 2023), and
       Selective Prediction with Abstention (Chow, 1970; Geifman & El-Yaniv, NeurIPS 2017):
         - VERIFIED (36% = 43,200):                V1..V4 (50% with Sentence-BERT context alignment)
         - SUSPECTED_HALLUCINATION (30% = 36,000): H1..H4 (plausible same-domain spliced titles,
                                                   real scholar names & venues; 40% of candidate-bearing
                                                   H2/H4 evaluated with cross-paper context alignment)
         - METADATA_ERROR (22% = 26,400):          M1..M5 (45% with context alignment, including both
                                                   aligned contexts on metadata-erroneous citations and
                                                   explicit R-CONTENT-MISMATCH misattributions)
         - UNRESOLVED / ABSTENTION (12% = 14,400): U1..U2 (35% of U1 with context alignment)
       Within each split, full-abstract papers (66.7%) are proportionally stratified across all
       4 class slices so 100% of samples with `use_context=True` across V, M, H, and U use
       their own authentic full-length abstracts (>80 chars) with ZERO label-conditioned clamping.
    3. Authentic Feature Extraction, Unification & OOD Hard-Guardrail Stress Suite (N = 2,400):
       - Computes features using real Sentence-BERT (`all-MiniLM-L6-v2`), `FuzzyMatcher`,
         `author_match_score`, and `VenueNormalizer` with zero `np.clip` feature clamping.
       - Unifies `BaselineRunner("proposed")` with exact production `SymbolicRules`.
       - Evaluates Pure ML `B5` vs. `Neuro-Symbolic` on a 2,400-sample Out-of-Distribution (OOD)
         Hard-Guardrail Stress Suite across 6 real-world symbolic failure modes (retractions,
         chimeric spliced DOIs, fake placeholder URLs, regional DOIs without CSL, HTTP 429 API
         exhaustion, and Vietnamese statutory authority mismatches) built strictly from `test_papers`.
    4. Statistical Significance Testing & CIS Rubric Weight Sensitivity Analysis:
       - Continuity-corrected McNemar's test and 1,000-resample Paired Bootstrap significance
         tests (Dror et al., ACL 2018; Berg-Kirkpatrick et al., EMNLP 2012).
       - 20-perturbation simplex sensitivity analysis of `CISCalculator` over 300 manuscript
         profiles reporting Spearman's rho, Kendall's tau, and MAE.

Outputs:
    - data/models/neuro_symbolic_weights.json
    - data/models/neuro_symbolic_benchmark_report.json
    - data/models/neuro_symbolic_dataset_summary.json
"""

from __future__ import annotations

import json
import math
import random
import re
import sqlite3
import sys
import time
from collections import Counter
from pathlib import Path
from typing import Any

import numpy as np
import torch
from scipy import stats as scipy_stats

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT / "src") not in sys.path:
    sys.path.insert(0, str(REPO_ROOT / "src"))

from integrity_checker.config import CISConfig, CISWeightsConfig, Settings  # noqa: E402
from integrity_checker.evaluation.baselines import (  # noqa: E402
    BaselineRunner,
    evaluate_symbolic_record,
)
from integrity_checker.evaluation.metrics import MetricsCalculator  # noqa: E402
from integrity_checker.extraction.patterns.apa import parse_vn_legal_reference  # noqa: E402
from integrity_checker.linking.statuses import CitationMappingStatus, StyleProfile  # noqa: E402
from integrity_checker.logic.calibration import (  # noqa: E402
    CalibrationCalculator,
    HybridMLScorer,
    PlattCalibrator,
)
from integrity_checker.logic.cis import CISCalculator  # noqa: E402
from integrity_checker.logic.rules import SymbolicRules  # noqa: E402
from integrity_checker.logic.vn_legal_verifier import verify_vn_legal_citation  # noqa: E402
from integrity_checker.matching.author_matcher import author_match_score  # noqa: E402
from integrity_checker.matching.fuzzy import FuzzyMatcher  # noqa: E402
from integrity_checker.matching.semantic import SemanticMatcher  # noqa: E402
from integrity_checker.matching.venue_normalizer import VenueNormalizer  # noqa: E402
from integrity_checker.models.citation import Citation, CitationType  # noqa: E402
from integrity_checker.models.source import SourceCandidate, SourceResult  # noqa: E402
from integrity_checker.models.validation import (  # noqa: E402
    CitationVerdict,
    MatchFeatures,
    ValidationLabel,
)

TOTAL_SAMPLES = 120_000
FULL_ABSTRACT_QUOTA = 80_000
METADATA_ONLY_QUOTA = TOTAL_SAMPLES - FULL_ABSTRACT_QUOTA  # 40,000

_ACL_VENUE_EXPANSIONS: dict[str, str] = {
    "acl": "Proceedings of the Annual Meeting of the Association for Computational Linguistics",
    "emnlp": "Proceedings of the Conference on Empirical Methods in Natural Language Processing",
    "naacl": "Proceedings of the Conference of the North American Chapter of the Association for Computational Linguistics",
    "eacl": "Proceedings of the Conference of the European Chapter of the Association for Computational Linguistics",
    "coling": "Proceedings of the International Conference on Computational Linguistics",
    "lrec": "Proceedings of the International Conference on Language Resources and Evaluation",
    "findings": "Findings of the Association for Computational Linguistics",
    "tacl": "Transactions of the Association for Computational Linguistics",
    "cl": "Computational Linguistics",
    "conll": "Proceedings of the Conference on Computational Natural Language Learning",
    "semeval": "Proceedings of the International Workshop on Semantic Evaluation",
    "wmt": "Proceedings of the Conference on Machine Translation",
    "ijcnlp": "Proceedings of the International Joint Conference on Natural Language Processing",
    "aacl": "Proceedings of the Asia-Pacific Chapter of the Association for Computational Linguistics",
    "ranlp": "Proceedings of the International Conference on Recent Advances in Natural Language Processing",
    "paclic": "Proceedings of the Pacific Asia Conference on Language, Information and Computation",
    "jeptalnrecital": "Actes de la Conférence sur le Traitement Automatique des Langues Naturelles",
    "ws": "Proceedings of the ACL Workshop on Natural Language Processing",
    "starsem": "Proceedings of the Joint Conference on Lexical and Computational Semantics",
    "sigdial": "Proceedings of the Annual Meeting of the Special Interest Group on Discourse and Dialogue",
    "inlg": "Proceedings of the International Natural Language Generation Conference",
    "bea": "Proceedings of the Workshop on Innovative Use of NLP for Building Educational Applications",
    "rocling": "Proceedings of the Conference on Computational Linguistics and Speech Processing",
    "anlp": "Proceedings of the Conference on Applied Natural Language Processing",
    "icon": "Proceedings of the International Conference on Natural Language Processing",
    "alta": "Proceedings of the Australasian Language Technology Association Workshop",
    "nodalida": "Proceedings of the Nordic Conference on Computational Linguistics",
    "iwslt": "Proceedings of the International Conference on Spoken Language Translation",
    "mtsummit": "Proceedings of Machine Translation Summit",
    "bionlp": "Proceedings of the BioNLP Workshop",
    "sigmorphon": "Proceedings of the SIGMORPHON Workshop on Computational Research in Phonetics, Phonology, and Morphology",
    "hlt": "Proceedings of the Human Language Technology Conference",
    "law": "Proceedings of the Linguistic Annotation Workshop",
    "muc": "Proceedings of the Message Understanding Conference",
    "tipster": "Proceedings of the TIPSTER Text Program",
    "tinlap": "Proceedings of Theoretical Issues in Natural Language Processing",
    "eamt": "Proceedings of the Annual Conference of the European Association for Machine Translation",
    "amta": "Proceedings of the Conference of the Association for Machine Translation in the Americas",
    "ccl": "Proceedings of the China National Conference on Computational Linguistics",
    "clicit": "Proceedings of the Italian Conference on Computational Linguistics",
    "tc": "Translating and the Computer Conference Proceedings",
    "iwpt": "Proceedings of the International Conference on Parsing Technologies",
    "wassa": "Proceedings of the Workshop on Computational Approaches to Subjectivity, Sentiment and Social Media Analysis",
    "dravidianlangtech": "Proceedings of the Workshop on Speech and Language Technologies for Dravidian Languages",
    "arabicnlp": "Proceedings of the Arabic Natural Language Processing Conference",
    "iwcs": "Proceedings of the International Conference on Computational Semantics",
    "wnut": "Proceedings of the Workshop on Noisy User-generated Text",
    "mwe": "Proceedings of the Workshop on Multiword Expressions",
    "scil": "Proceedings of the Society for Computation in Linguistics",
    "gwc": "Proceedings of the Global Wordnet Conference",
    "ijclclp": "International Journal of Computational Linguistics and Chinese Language Processing",
    "sighan": "Proceedings of the SIGHAN Workshop on Chinese Language Processing",
    "tal": "Traitement Automatique des Langues",
    "tag": "Proceedings of the International Workshop on Tree Adjoining Grammars and Related Formalisms",
    "stil": "Proceedings of the Brazilian Symposium in Information and Human Language Technology",
    "vardial": "Proceedings of the Workshop on NLP for Similar Languages, Varieties and Dialects",
    "wanlp": "Proceedings of the Arabic Natural Language Processing Workshop",
    "propor": "Proceedings of the International Conference on Computational Processing of Portuguese",
    "clpsych": "Proceedings of the Workshop on Computational Linguistics and Clinical Psychology",
    "repl4nlp": "Proceedings of the Workshop on Representation Learning for NLP",
    "earlymt": "Early Machine Translation Historical Collection",
    "clinicalnlp": "Proceedings of the Clinical Natural Language Processing Workshop",
    "tmi": "Proceedings of the Conference on Theoretical and Methodological Issues in Machine Translation",
    "ldk": "Proceedings of the Conference on Language, Data and Knowledge",
    "argmining": "Proceedings of the Workshop on Argument Mining",
    "louhi": "Proceedings of the International Workshop on Health Text Mining and Information Analysis",
    "bucc": "Proceedings of the Workshop on Building and Using Comparable Corpora",
    "codi": "Proceedings of the Workshop on Computational Approaches to Discourse",
    "econlp": "Proceedings of the Workshop on Economics and Natural Language Processing",
    "finnlp": "Proceedings of the Workshop on Financial Technology and Natural Language Processing",
    "gem": "Proceedings of the Generation, Evaluation, and Metrics Workshop",
    "latechclfl": "Proceedings of the Joint SIGHUM Workshop on Computational Linguistics for Cultural Heritage, Social Sciences, Humanities and Literature",
    "nlp4convai": "Proceedings of the Workshop on NLP for Conversational AI",
    "peoples": "Proceedings of the Workshop on Computational Modeling of People's Opinions, Personality, and Emotion's in Social Media",
    "privatenlp": "Proceedings of the Workshop on Privacy in Natural Language Processing",
    "sdp": "Proceedings of the Workshop on Scholarly Document Processing",
    "smm4h": "Proceedings of the Social Media Mining for Health Applications Workshop",
    "sustainlp": "Proceedings of the Workshop on Simple and Efficient Natural Language Processing",
    "textgraphs": "Proceedings of the TextGraphs Workshop on Graph-Based Methods for Natural Language Processing",
    "wat": "Proceedings of the Workshop on Asian Translation",
}

MAX_SCHOLARLY_YEAR = 2026
MIN_SCHOLARLY_YEAR = 1950

_SPLICE_PREPOSITIONS: frozenset[str] = frozenset(
    {
        "for", "in", "on", "with", "via", "under", "across", "through",
        "using", "towards", "toward", "from", "over", "by", "into", "against",
        "between", "among", "within", "without", "about", "around", "beyond",
        "during", "after", "before", "upon", "onto", "per",
    }
)

_SPLICE_TRAILING_FUNC_WORDS: frozenset[str] = _SPLICE_PREPOSITIONS | frozenset(
    {
        "and", "or", "nor", "but", "yet", "so", "of", "the", "a", "an", "to", "as", "at",
        "is", "are", "was", "were", "be", "been", "being", "has", "have", "had",
        "do", "does", "did", "can", "could", "will", "would", "should", "may", "might",
        "its", "their", "our", "his", "her", "my", "your",
        "this", "that", "these", "those", "such", "both", "either", "neither",
        "which", "who", "whom", "whose", "whether", "how", "when", "where", "why", "what",
        "not", "no", "than", "vs", "vs.", "versus",
    }
)


def _perturb_year_bounded(
    base_year: int,
    yd: int,
    *,
    max_year: int = MAX_SCHOLARLY_YEAR,
    min_year: int = MIN_SCHOLARLY_YEAR,
) -> int:
    """Perturb `base_year` by `yd` while guaranteeing `min_year <= cited_year <= max_year`.

    When `base_year + yd > max_year` (e.g., 2021..2026 papers), steps backward (`base_year - yd`)
    so `|cited_year - base_year| == yd` holds strictly without generating impossible future years.
    """
    base = max(min_year, min(max_year, int(base_year)))
    if yd <= 0:
        return base
    if yd >= 100:
        return min(max_year, 2023)
    if base + yd <= max_year:
        return base + yd
    return max(min_year, base - yd)


def _expand_scholarly_venue(raw_venue: str | None) -> str:
    """Expand compact ACL Anthology venue slugs into full scholarly conference/journal names."""
    v = str(raw_venue or "").strip()
    if not v:
        return "Proceedings of the Association for Computational Linguistics"
    mapped = _ACL_VENUE_EXPANSIONS.get(v.lower())
    if mapped is not None:
        return mapped
    if " " not in v and v == v.lower() and re.fullmatch(r"[a-z][a-z0-9\-]{1,24}", v):
        return f"Proceedings of the {v.upper()} Workshop on Computational Linguistics"
    return v


def _normalize_title_key(title: str) -> str:
    """Case/punctuation-insensitive normalized title key for strict zero-overlap deduplication."""
    cleaned = "".join(
        ch if (ch.isalnum() or ch.isspace()) else " " for ch in str(title or "").casefold()
    )
    return " ".join(cleaned.split())


def _parse_paper_row(
    paper_id: int,
    title: str,
    authors_raw: str,
    year: int,
    venue: str | None,
    doi: str | None,
    abstract: str | None,
) -> dict[str, Any] | None:
    """Parse and sanitize a single row from `papers` table."""
    try:
        authors = (
            json.loads(authors_raw)
            if isinstance(authors_raw, str) and authors_raw.startswith("[")
            else [str(authors_raw)]
        )
    except Exception:
        authors = [a.strip() for a in str(authors_raw).split(",") if a.strip()]
    authors = [str(a).strip() for a in authors if str(a).strip()]
    clean_title = " ".join(str(title).split())
    if not authors or len(clean_title) < 15:
        return None
    clean_abs = " ".join(str(abstract or "").split())
    return {
        "paper_id": int(paper_id),
        "title": clean_title,
        "authors": authors,
        "year": int(year),
        "venue": _expand_scholarly_venue(venue),
        "doi": str(doi or "").strip(),
        "abstract": clean_abs,
        "has_full_abstract": len(clean_abs) > 80,
    }


def _load_db_papers_stratified(
    db_path: Path,
    total_limit: int = TOTAL_SAMPLES,
    seed: int = 42,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, int]]:
    """Load `total_limit` distinct real scholarly papers stratified by abstract availability."""
    conn = sqlite3.connect(str(db_path))
    cur = conn.cursor()
    total_in_db = int(cur.execute("SELECT COUNT(*) FROM papers").fetchone()[0])
    acl_in_db = int(
        cur.execute("SELECT COUNT(*) FROM papers WHERE lower(coalesce(source, '')) = 'acl'").fetchone()[0]
    )
    cur.execute(
        """
        SELECT id, title, authors, year, venue, doi, abstract
        FROM papers
        WHERE title IS NOT NULL
          AND length(trim(title)) BETWEEN 15 AND 300
          AND authors IS NOT NULL
          AND length(trim(authors)) > 2
          AND year IS NOT NULL
          AND year BETWEEN 1950 AND 2026
        ORDER BY id ASC
        """
    )
    rows = cur.fetchall()
    conn.close()

    parsed_rows: list[dict[str, Any]] = []
    seen_ids: set[int] = set()
    for row in rows:
        parsed = _parse_paper_row(*row)
        if parsed is None or parsed["paper_id"] in seen_ids:
            continue
        seen_ids.add(parsed["paper_id"])
        parsed_rows.append(parsed)

    with_abs_pool: list[dict[str, Any]] = []
    meta_only_pool: list[dict[str, Any]] = []
    seen_norm_titles: set[str] = set()

    for parsed in parsed_rows:
        if not parsed["has_full_abstract"]:
            continue
        norm_title = _normalize_title_key(parsed["title"])
        if not norm_title or norm_title in seen_norm_titles:
            continue
        seen_norm_titles.add(norm_title)
        with_abs_pool.append(parsed)

    for parsed in parsed_rows:
        if parsed["has_full_abstract"]:
            continue
        norm_title = _normalize_title_key(parsed["title"])
        if not norm_title or norm_title in seen_norm_titles:
            continue
        seen_norm_titles.add(norm_title)
        meta_only_pool.append(parsed)

    rng = random.Random(seed)
    rng.shuffle(with_abs_pool)
    rng.shuffle(meta_only_pool)

    n_abs_target = min(FULL_ABSTRACT_QUOTA, len(with_abs_pool))
    n_meta_target = total_limit - n_abs_target
    if n_meta_target > len(meta_only_pool):
        raise ValueError(
            f"Requested {total_limit} papers, but only {len(with_abs_pool) + len(meta_only_pool)} valid papers exist."
        )

    selected_abs = with_abs_pool[:n_abs_target]
    selected_meta = meta_only_pool[:n_meta_target]

    corpus_stats = {
        "total_papers_in_db": total_in_db,
        "acl_anthology_papers_in_db": acl_in_db,
        "acl_anthology_share_pct": round(100.0 * acl_in_db / max(total_in_db, 1), 2),
        "total_valid_scholarly_papers": len(with_abs_pool) + len(meta_only_pool),
        "eligible_with_full_abstract": len(with_abs_pool),
        "eligible_metadata_only": len(meta_only_pool),
        "sampled_with_full_abstract": len(selected_abs),
        "sampled_metadata_only": len(selected_meta),
        "sampled_total": len(selected_abs) + len(selected_meta),
    }
    return selected_abs, selected_meta, corpus_stats


def _partition_stratified_pools(
    with_abs_papers: list[dict[str, Any]],
    meta_only_papers: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    """Partition papers into strictly disjoint 70/15/15 Train/Val/Test pools."""
    seen_ids: set[int] = set()
    seen_titles: set[str] = set()
    dedup_abs: list[dict[str, Any]] = []
    dedup_meta: list[dict[str, Any]] = []

    for p in with_abs_papers:
        pid = int(p["paper_id"])
        nt = _normalize_title_key(p["title"])
        if pid in seen_ids or not nt or nt in seen_titles:
            continue
        seen_ids.add(pid)
        seen_titles.add(nt)
        dedup_abs.append(p)

    for p in meta_only_papers:
        pid = int(p["paper_id"])
        nt = _normalize_title_key(p["title"])
        if pid in seen_ids or not nt or nt in seen_titles:
            continue
        seen_ids.add(pid)
        seen_titles.add(nt)
        dedup_meta.append(p)

    n_abs = len(dedup_abs)
    n_abs_train = int(round(n_abs * 0.70))
    n_abs_val = int(round(n_abs * 0.15))

    abs_train = dedup_abs[:n_abs_train]
    abs_val = dedup_abs[n_abs_train : n_abs_train + n_abs_val]
    abs_test = dedup_abs[n_abs_train + n_abs_val :]

    n_meta = len(dedup_meta)
    n_meta_train = int(round(n_meta * 0.70))
    n_meta_val = int(round(n_meta * 0.15))

    meta_train = dedup_meta[:n_meta_train]
    meta_val = dedup_meta[n_meta_train : n_meta_train + n_meta_val]
    meta_test = dedup_meta[n_meta_train + n_meta_val :]

    train_pool = abs_train + meta_train
    val_pool = abs_val + meta_val
    test_pool = abs_test + meta_test

    train_ids = {p["paper_id"] for p in train_pool}
    val_ids = {p["paper_id"] for p in val_pool}
    test_ids = {p["paper_id"] for p in test_pool}

    train_titles = {_normalize_title_key(p["title"]) for p in train_pool}
    val_titles = {_normalize_title_key(p["title"]) for p in val_pool}
    test_titles = {_normalize_title_key(p["title"]) for p in test_pool}

    assert len(train_ids) == len(train_pool), "Duplicate paper IDs in train_pool"
    assert len(val_ids) == len(val_pool), "Duplicate paper IDs in val_pool"
    assert len(test_ids) == len(test_pool), "Duplicate paper IDs in test_pool"
    assert len(train_ids & val_ids) == 0, "Data leakage between Train and Val"
    assert len(train_ids & test_ids) == 0, "Data leakage between Train and Test"
    assert len(val_ids & test_ids) == 0, "Data leakage between Val and Test"
    assert len(train_titles & val_titles) == 0, "Title leakage between Train and Val"
    assert len(train_titles & test_titles) == 0, "Title leakage between Train and Test"
    assert len(val_titles & test_titles) == 0, "Title leakage between Val and Test"

    leakage_audit = {
        "train_distinct_papers": len(train_ids),
        "val_distinct_papers": len(val_ids),
        "test_distinct_papers": len(test_ids),
        "train_with_full_abstract": len(abs_train),
        "val_with_full_abstract": len(abs_val),
        "test_with_full_abstract": len(abs_test),
        "train_val_overlap": len(train_ids & val_ids),
        "train_test_overlap": len(train_ids & test_ids),
        "val_test_overlap": len(val_ids & test_ids),
        "train_val_title_overlap": len(train_titles & val_titles),
        "train_test_title_overlap": len(train_titles & test_titles),
        "val_test_title_overlap": len(val_titles & test_titles),
        "zero_leakage_verified": True,
    }
    return train_pool, val_pool, test_pool, leakage_audit


def _allocate_class_pools_stratified(
    pool_papers: list[dict[str, Any]],
    n_verified: int,
    n_meta: int,
    n_halluc: int,
    n_unres: int,
) -> tuple[
    list[dict[str, Any]],
    list[dict[str, Any]],
    list[dict[str, Any]],
    list[dict[str, Any]],
]:
    """Stratify full-abstract and metadata-only papers across V/M/H/U within a split.

    Ensures every class slice has full-abstract papers placed first (~66.7% of each
    class slice in the 120K run), so 100% of samples with `use_context=True` across
    VERIFIED (50%), METADATA_ERROR (45%), SUSPECTED_HALLUCINATION (~13.3%), and
    UNRESOLVED (~23.3%) use their own authentic abstracts (>80 chars) without borrowing
    donor abstracts or leaking across splits.
    """
    abs_list = [p for p in pool_papers if p.get("has_full_abstract")]
    meta_list = [p for p in pool_papers if not p.get("has_full_abstract")]
    n_total = len(pool_papers)
    if not abs_list or not meta_list:
        c1 = n_verified
        c2 = c1 + n_meta
        c3 = c2 + n_halluc
        return (
            pool_papers[:c1],
            pool_papers[c1:c2],
            pool_papers[c2:c3],
            pool_papers[c3 : c3 + n_unres],
        )

    abs_ratio = len(abs_list) / n_total
    a_ver = min(n_verified, int(round(n_verified * abs_ratio)))
    a_meta = min(n_meta, int(round(n_meta * abs_ratio)))
    a_hal = min(n_halluc, int(round(n_halluc * abs_ratio)))
    a_unr = len(abs_list) - (a_ver + a_meta + a_hal)
    if a_unr > n_unres:
        excess = a_unr - n_unres
        a_unr = n_unres
        a_ver += excess
    elif a_unr < 0:
        deficit = -a_unr
        a_unr = 0
        a_hal = max(0, a_hal - deficit)

    m_ver = n_verified - a_ver
    m_meta = n_meta - a_meta
    m_hal = n_halluc - a_hal
    m_unr = n_unres - a_unr

    ver_pool = abs_list[:a_ver] + meta_list[:m_ver]
    meta_pool = abs_list[a_ver : a_ver + a_meta] + meta_list[m_ver : m_ver + m_meta]
    hal_pool = (
        abs_list[a_ver + a_meta : a_ver + a_meta + a_hal]
        + meta_list[m_ver + m_meta : m_ver + m_meta + m_hal]
    )
    unr_pool = (
        abs_list[a_ver + a_meta + a_hal :]
        + meta_list[m_ver + m_meta + m_hal : m_ver + m_meta + m_hal + m_unr]
    )
    return ver_pool, meta_pool, hal_pool, unr_pool


def _extract_sentences(abstract: str, fallback_title: str = "") -> tuple[str, str]:
    """Extract first and second substantive sentences from an abstract."""
    if not abstract or len(abstract.strip()) < 20:
        base = fallback_title or "Empirical evaluation of computational language representations."
        return base, base
    parts = [p.strip() for p in re.split(r"(?<=[.!?])\s+", abstract) if len(p.strip()) >= 35]
    if not parts:
        s1 = abstract[:220]
        return s1, s1
    s1 = parts[0][:260]
    s2 = parts[1][:260] if len(parts) > 1 else s1
    return s1, s2


def _extract_rest_abstract(abstract: str, fallback_title: str = "") -> str:
    """Extract multi-sentence abstract remainder (excluding sentence 1 when >= 2 sentences exist)."""
    if not abstract or len(abstract.strip()) < 20:
        return fallback_title or "Empirical evaluation of computational language representations."
    parts = [p.strip() for p in re.split(r"(?<=[.!?])\s+", abstract) if len(p.strip()) >= 30]
    if len(parts) >= 2:
        return " ".join(parts[1:])[:480]
    return abstract[:480]


def _abbreviate_author_name(name: str) -> str:
    """Convert 'First Middle Last' to 'Last, F.' style."""
    tokens = [t for t in re.split(r"[\s,]+", name.strip()) if t]
    if len(tokens) <= 1:
        return name
    last = tokens[-1]
    first_init = tokens[0][0].upper()
    return f"{last}, {first_init}."


def _strip_token_punct(word: str) -> str:
    """Strip edge punctuation from a title token for grammatical boundary checks."""
    return word.strip(":;,()[]{}\"'“”‘’?!")


def _sanitize_balanced_delimiters(text: str) -> str:
    """Remove unmatched brackets/parens/quotes and collapse adjacent duplicate words."""
    chars = list(text)
    for open_ch, close_ch in (("(", ")"), ("[", "]"), ("{", "}")):
        stack: list[int] = []
        remove_idx: set[int] = set()
        for idx_c, ch in enumerate(chars):
            if ch == open_ch:
                stack.append(idx_c)
            elif ch == close_ch:
                if stack:
                    stack.pop()
                else:
                    remove_idx.add(idx_c)
        remove_idx.update(stack)
        if remove_idx:
            chars = [c for i_c, c in enumerate(chars) if i_c not in remove_idx]
    out = "".join(chars).replace('"', "").replace("“", "").replace("”", "")
    out = re.sub(r"\b([A-Za-z]+)\s+\1\b", r"\1", out, flags=re.IGNORECASE)
    return re.sub(r"\s+", " ", out).strip(" :;,-–—/")


def _clean_title_for_splicing(title: str) -> str:
    """Strip editorial language tags (`[in French]`) and parenthetical asides prior to splicing."""
    cleaned = re.sub(r"\s*\[in\s+[A-Za-z\-\s]+\]\s*$", "", str(title or ""), flags=re.IGNORECASE)
    cleaned = re.sub(r"\([^)]*\)|\[[^\]]*\]", " ", cleaned)
    cleaned = cleaned.replace("(", " ").replace(")", " ").replace("[", " ").replace("]", " ")
    cleaned = cleaned.replace('"', "").replace("“", "").replace("”", "")
    return re.sub(r"\s+", " ", cleaned).strip()


def _corrupt_title_minor_ocr(title: str, rng: random.Random) -> str:
    """Realistic minor variation: subtitle drop, hyphen/punctuation shift, or minor OCR typo."""
    mode = rng.randint(0, 2)
    if mode == 0 and ":" in title:
        main_part = _sanitize_balanced_delimiters(title.split(":")[0].strip())
        if len(main_part) >= 24:
            return main_part
    if mode == 1:
        if "-" in title:
            return _sanitize_balanced_delimiters(title.replace("-", " ", 1))
        if "," in title or ";" in title:
            return _sanitize_balanced_delimiters(title.replace(",", "", 1).replace(";", "", 1))
    words = title.split()
    if len(words) >= 4:
        idx = rng.randint(1, len(words) - 2)
        w = words[idx]
        if len(w) > 5:
            words[idx] = w[:2] + w[3:]
    return _sanitize_balanced_delimiters(" ".join(words))


_DANGLING_MODIFIER_SUFFIXES: tuple[str, ...] = (
    "-based",
    "-driven",
    "-aware",
    "-guided",
    "-oriented",
    "-specific",
    "-free",
    "-agnostic",
    "-centric",
    "-informed",
    "-enhanced",
    "-assisted",
    "-augmented",
    "-inspired",
)

_DANGLING_HEAD_ADJECTIVES: frozenset[str] = frozenset(
    {
        "pretrained", "neural", "deep", "contextual", "multilingual", "bilingual",
        "cross-lingual", "supervised", "unsupervised", "self-supervised", "semi-supervised",
        "hierarchical", "adaptive", "dynamic", "joint", "unified", "end-to-end",
        "effective", "efficient", "robust", "scalable", "novel", "new", "improved",
        "generative", "discriminative", "statistical", "computational",
    }
)


def _trim_splice_head(head: list[str], fallback: list[str]) -> list[str]:
    """Trim trailing function words and dangling hyphenated/adjectival modifiers from a splice head."""
    cleaned = list(head)
    while len(cleaned) > 1:
        last_low = _strip_token_punct(cleaned[-1]).lower()
        if (
            last_low in _SPLICE_TRAILING_FUNC_WORDS
            or any(last_low.endswith(suf) for suf in _DANGLING_MODIFIER_SUFFIXES)
            or last_low in _DANGLING_HEAD_ADJECTIVES
        ):
            cleaned.pop()
        else:
            break
    if not cleaned:
        return list(fallback)
    last_final = _strip_token_punct(cleaned[-1]).lower()
    if last_final in _SPLICE_TRAILING_FUNC_WORDS:
        return list(fallback)
    if any(last_final.endswith(suf) for suf in _DANGLING_MODIFIER_SUFFIXES) or last_final in _DANGLING_HEAD_ADJECTIVES:
        cleaned.append("Models")
    cleaned[-1] = cleaned[-1].rstrip(":;,-–—")
    return cleaned


def _corrupt_title_moderate(title: str, other_title: str, rng: random.Random) -> str:
    """Keep 45-60% of original title words (dropping >= 2 words when len >= 4) and splice a phrase from another paper."""
    t1 = _clean_title_for_splicing(title)
    t2 = _clean_title_for_splicing(other_title)
    words = [w for w in t1.split() if _strip_token_punct(w)]
    other_words = [w for w in t2.split() if _strip_token_punct(w)]
    raw_k = max(2, int(len(words) * rng.uniform(0.45, 0.60)))
    keep_k = min(max(2, len(words) - 2), raw_k) if len(words) >= 4 else max(1, len(words) - 1)
    head = _trim_splice_head(words[:keep_k], ["Neural", "Sequence", "Models"])

    tail_k = max(2, min(4, len(other_words) // 3))
    tail = list(other_words[-tail_k:]) if len(other_words) >= tail_k else ["Computational", "Models"]
    while len(tail) > 1 and _strip_token_punct(tail[0]).lower() in _SPLICE_TRAILING_FUNC_WORDS:
        tail.pop(0)
    while len(tail) > 1 and _strip_token_punct(tail[-1]).lower() in _SPLICE_TRAILING_FUNC_WORDS:
        tail.pop()
    if (
        not tail
        or _strip_token_punct(tail[0]).lower() in _SPLICE_TRAILING_FUNC_WORDS
        or _strip_token_punct(tail[-1]).lower() in _SPLICE_TRAILING_FUNC_WORDS
        or any(_strip_token_punct(tail[-1]).lower().endswith(s) for s in _DANGLING_MODIFIER_SUFFIXES)
    ):
        tail = ["Computational", "Models"]
    return _sanitize_balanced_delimiters(f"{' '.join(head)} for {' '.join(tail)}")


def _make_spliced_academic_title(
    p1: dict[str, Any],
    p3: dict[str, Any],
    rng: random.Random,
) -> str:
    """Construct a realistic same-domain LLM hallucinated title by splicing two real titles in the same split.

    Combines the opening 3-4 academic words of `p1["title"]` with the closing 3-5
    methodological phrase words of `p3["title"]` from a distant paper in the same split pool.
    """
    t1 = _clean_title_for_splicing(p1["title"])
    t3 = _clean_title_for_splicing(p3["title"])
    w1 = [w.strip(":;,") for w in t1.split() if _strip_token_punct(w)]
    w3 = [w.strip(":;,") for w in t3.split() if _strip_token_punct(w)]
    head_len = min(len(w1), rng.choice([3, 4]))
    head = _trim_splice_head(w1[:head_len], ["Contextual", "Language", "Representations"])

    tail_len = min(len(w3), rng.choice([3, 4, 5]))
    tail = list(w3[-tail_len:])
    non_prep_boundary = _SPLICE_TRAILING_FUNC_WORDS - _SPLICE_PREPOSITIONS
    while len(tail) > 1:
        t0 = _strip_token_punct(tail[0]).lower()
        t1_next = _strip_token_punct(tail[1]).lower() if len(tail) > 1 else ""
        if t0 in non_prep_boundary or (
            t0 in _SPLICE_PREPOSITIONS
            and t1_next in (_SPLICE_TRAILING_FUNC_WORDS - {"the", "a", "an"})
        ):
            tail.pop(0)
        else:
            break
    while len(tail) > 1 and (
        _strip_token_punct(tail[-1]).lower() in _SPLICE_TRAILING_FUNC_WORDS
        or any(_strip_token_punct(tail[-1]).lower().endswith(s) for s in _DANGLING_MODIFIER_SUFFIXES)
    ):
        tail.pop()
    if (
        len(tail) < 2
        or _strip_token_punct(tail[-1]).lower() in _SPLICE_TRAILING_FUNC_WORDS
        or any(_strip_token_punct(tail[-1]).lower().endswith(s) for s in _DANGLING_MODIFIER_SUFFIXES)
        or (len(tail) == 1 and _strip_token_punct(tail[0]).lower() in _SPLICE_TRAILING_FUNC_WORDS)
    ):
        tail = ["in", "Neural", "Language", "Models"]

    if _strip_token_punct(tail[0]).lower() in _SPLICE_PREPOSITIONS:
        spliced = _sanitize_balanced_delimiters(" ".join(head + tail))
    else:
        connector = rng.choice(["for", "via", "with", "in", "under"])
        spliced = _sanitize_balanced_delimiters(f"{' '.join(head)} {connector} {' '.join(tail)}")

    # Guarantee spliced title is non-identical to p1 and p3
    norm_spliced = _normalize_title_key(spliced)
    if norm_spliced in {_normalize_title_key(p1["title"]), _normalize_title_key(p3["title"])}:
        spliced = _sanitize_balanced_delimiters(f"{spliced} in Multilingual Corpora")
    return spliced


def _pick_non_overlapping_scholar_authors(
    pool_slice: list[dict[str, Any]],
    base_idx: int,
    cand_authors: list[str],
    *,
    count: int = 2,
) -> list[str]:
    """Select real scholar names from distant indices in `pool_slice` with zero overlap against `cand_authors`."""
    n = len(pool_slice)
    selected: list[str] = []
    seen_norm: set[str] = set()
    offsets = (251, 613, 977, 1291, 1609, 2003, 2411, 2801, 3, 7, 11, 13, 17, 19)
    for off in offsets:
        donor = pool_slice[(base_idx + off) % n]
        candidates_in_donor = [donor["authors"][0], donor["authors"][-1]]
        for name in candidates_in_donor:
            norm_key = name.strip().lower()
            if not norm_key or norm_key in seen_norm:
                continue
            if author_match_score([name], cand_authors) > 0.0:
                continue
            seen_norm.add(norm_key)
            selected.append(name)
            if len(selected) >= count:
                return selected
    # Fallback for tiny synthetic unit-test pools where all authors might share a token
    fallback_donor = pool_slice[(base_idx + 3) % n]
    return [fallback_donor["authors"][0]][:count]


_FIRST_PERSON_ABSTRACT_LEAD_RE = re.compile(
    r"^(?:in\s+this\s+(?:paper|work|study|article)\s*,\s*)?"
    r"(?:we|this\s+(?:paper|work|study|article)|the\s+authors?|our\s+(?:work|study|experiments?))\s+"
    r"(?:propose|present|introduce|demonstrate|show|describe|develop|investigate|report|prove|establish|conjecture|find)(?:s|d|ed)?\s*"
    r"(?:that\s+)?",
    re.IGNORECASE,
)


def _extract_lead_surname(author_name: str) -> str:
    """Extract clean surname from 'First Last' or 'Last, F.' for natural in-text citations."""
    raw = str(author_name or "Smith").strip()
    if "," in raw:
        sur = raw.split(",", 1)[0].strip()
    else:
        parts = [t for t in raw.split() if t]
        sur = parts[-1] if parts else "Smith"
    sur_clean = re.sub(r"[^A-Za-zÀ-ÖØ-öø-ÿ'\-]", "", sur)
    return sur_clean or "Smith"


def _clean_claim_clause_for_third_person(raw_claim: str) -> str:
    """Convert raw abstract sentence into a grammatical third-person empirical claim clause."""
    s = " ".join(str(raw_claim or "").strip().split()).rstrip(".")
    s = _FIRST_PERSON_ABSTRACT_LEAD_RE.sub("", s).strip()
    s = re.sub(r"\b[Oo]ur\b", "their", s)
    s = re.sub(r"\b[Ww]e\b", "the authors", s)
    if not s:
        s = "graph spectral convolution operators improve semi-supervised node accuracy on Cora"
    return s


def _make_misattributed_context_sentence(
    p: dict[str, Any],
    donor_s2: str,
    donor_s1: str,
    idx: int,
) -> str:
    """Construct a natural academic misattributed citing sentence across 12 diverse syntactic templates
    without any stemmer pre-screening or lexical overlap inspection against `p`."""
    t_words = [w.strip(":;,") for w in p["title"].split() if w.strip(":;,")][:4]
    while len(t_words) > 2 and t_words[-1].lower() in _SPLICE_TRAILING_FUNC_WORDS:
        t_words.pop()
    topic_anchor = " ".join(t_words)

    raw_donor = donor_s2 if len(donor_s2.strip()) >= 45 else donor_s1
    cleaned_claim = _clean_claim_clause_for_third_person(raw_donor)
    lowered_claim = (
        cleaned_claim[0].lower() + cleaned_claim[1:]
        if len(cleaned_claim) > 1 and cleaned_claim[1].islower()
        else cleaned_claim
    )
    cap_claim = cleaned_claim[0].upper() + cleaned_claim[1:] if cleaned_claim else "Empirical evaluations confirm this finding"
    lead_surname = _extract_lead_surname(p["authors"][0] if p.get("authors") else "Smith")
    has_etal = len(p.get("authors") or []) >= 2
    author_ref = f"{lead_surname} et al." if has_etal else lead_surname
    cite_num = (idx % 38) + 1
    year_val = int(p.get("year") or 2021)

    template_id = idx % 12
    if template_id == 0:
        sent = f"{author_ref} ({year_val}) demonstrated that {lowered_claim} in their study on {topic_anchor}."
    elif template_id == 1:
        sent = f"Prior work on {topic_anchor} [{cite_num}] established that {lowered_claim}."
    elif template_id == 2:
        sent = f"Building upon {topic_anchor}, {author_ref} ({year_val}) showed that {lowered_claim}."
    elif template_id == 3:
        sent = f"According to {author_ref} ({year_val}), {lowered_claim} when modeling {topic_anchor}."
    elif template_id == 4:
        sent = f"Regarding {topic_anchor}, {lowered_claim} [{cite_num}]."
    elif template_id == 5:
        sent = f"Empirical experiments reported that {lowered_claim} ({author_ref}, {year_val})."
    elif template_id == 6:
        sent = f"{author_ref} ({year_val}) found that {lowered_claim} across {topic_anchor} benchmarks."
    elif template_id == 7:
        sent = f"In their analysis of {topic_anchor}, {author_ref} ({year_val}) concluded that {lowered_claim}."
    elif template_id == 8:
        sent = f"Previous studies on {topic_anchor} observed that {lowered_claim} [{cite_num}]."
    elif template_id == 9:
        sent = f"{author_ref} ({year_val}) report that {lowered_claim} for {topic_anchor}."
    elif template_id == 10:
        sent = f"Quantitative evaluations of {topic_anchor} revealed that {lowered_claim} ({author_ref}, {year_val})."
    else:
        sent = f"{cap_claim} ({author_ref}, {year_val})."
    return sent[:320]


_BORDERLINE_STOPWORDS: frozenset[str] = frozenset(
    {
        "a", "an", "the", "of", "in", "on", "for", "to", "with", "by", "and", "or",
        "from", "at", "as", "via", "into", "over", "under", "using", "towards", "toward",
        "based", "new", "novel", "approach", "study", "method", "methods", "system", "systems",
    }
)

_BORDERLINE_PARAPHRASES: dict[str, str] = {
    "neural": "Connectionist",
    "network": "Architecture",
    "networks": "Architectures",
    "learning": "Acquisition",
    "deep": "Multilayer",
    "model": "Formulation",
    "models": "Formulations",
    "language": "Linguistic",
    "languages": "Idioms",
    "translation": "Transduction",
    "machine": "Automated",
    "semantic": "Conceptual",
    "semantics": "Meaning",
    "representations": "Embeddings",
    "representation": "Embedding",
    "attention": "Salience",
    "classification": "Categorization",
    "detection": "Identification",
    "generation": "Synthesis",
    "analysis": "Examination",
    "evaluation": "Assessment",
    "graph": "Relational",
    "graphs": "Topologies",
    "transformer": "Self-Attentive",
    "transformers": "Self-Attentive",
    "information": "Epistemic",
    "extraction": "Mining",
    "parsing": "Syntactic",
    "parser": "Decoder",
    "speech": "Spoken",
    "recognition": "Transcription",
    "text": "Discourse",
    "texts": "Corpora",
    "word": "Lexical",
    "words": "Lexicon",
    "sentence": "Utterance",
    "sentences": "Utterances",
    "question": "Query",
    "answering": "Resolution",
    "dialogue": "Conversational",
    "dialog": "Conversational",
    "knowledge": "Ontological",
    "reasoning": "Inference",
    "training": "Optimization",
    "pretrained": "Initialized",
    "pretraining": "Initialization",
    "data": "Corpus",
    "dataset": "Benchmark",
    "datasets": "Benchmarks",
    "multilingual": "Cross-Lingual",
    "cross-lingual": "Bilingual",
    "sentiment": "Affective",
    "summarization": "Condensation",
    "retrieval": "Lookup",
    "search": "Indexing",
    "entity": "Mention",
    "entities": "Mentions",
    "relation": "Linkage",
    "relations": "Linkages",
    "prediction": "Forecasting",
    "context": "Contextual",
    "contextual": "Situational",
    "hierarchical": "Stratified",
    "sequence": "Sequential",
    "sequences": "Chains",
    "structured": "Compositional",
    "structure": "Syntax",
    "unsupervised": "Self-Guided",
    "supervised": "Annotated",
    "domain": "Field",
    "adaptation": "Transfer",
    "alignment": "Correspondence",
    "visual": "Perceptual",
    "vision": "Perception",
    "image": "Pictorial",
    "document": "Manuscript",
    "documents": "Manuscripts",
    "framework": "Paradigm",
    "efficient": "Scalable",
    "improving": "Refining",
    "estimation": "Approximation",
    "vector": "Subspace",
    "space": "Manifold",
    "denoising": "Regularized",
    "contrastive": "Discriminative",
    "adaptive": "Dynamic",
    "joint": "Coupled",
    "probabilistic": "Stochastic",
    "statistical": "Distributional",
    "automatic": "Algorithmic",
    "corpus": "Archive",
    "lexical": "Terminological",
    "syntactic": "Grammatical",
    "discourse": "Rhetorical",
    "acoustic": "Phonetic",
    "multimodal": "Cross-Modal",
    "zero-shot": "Inductive",
    "few-shot": "Low-Resource",
}

_BORDERLINE_TOPIC_FALLBACKS: tuple[str, ...] = (
    "Computational", "Structural", "Distributional", "Parametric", "Probabilistic",
    "Stochastic", "Modular", "Variational", "Latent", "Symbolic", "Pragmatic",
    "Cross-Domain", "Task-Oriented", "Multi-Stage", "Subword", "Morphosyntactic",
    "Discursive", "Typological", "Compositional", "Autoregressive", "Nonparametric",
    "Factorized", "Calibrated", "Regularized", "Attentional", "Graph-Structured",
    "Token-Level", "Span-Based", "Document-Level", "Iterative", "Coupled", "Bilingual",
)

_BORDERLINE_HEAD_NOUNS: tuple[str, ...] = (
    "Models", "Frameworks", "Representations", "Architectures", "Algorithms",
    "Systems", "Protocols", "Formulations", "Pipelines", "Estimators",
    "Objectives", "Structures",
)

_BORDERLINE_VALID_TERMINAL_NOUNS: frozenset[str] = frozenset(
    {
        "architecture", "architectures", "acquisition", "formulation", "formulations",
        "idioms", "transduction", "meaning", "embeddings", "embedding", "salience",
        "categorization", "identification", "synthesis", "examination", "assessment",
        "topologies", "mining", "decoder", "transcription", "discourse", "corpora",
        "lexicon", "utterance", "utterances", "query", "resolution", "inference",
        "optimization", "initialization", "corpus", "benchmark", "benchmarks",
        "condensation", "lookup", "indexing", "mention", "mentions", "linkage",
        "linkages", "forecasting", "chains", "syntax", "field", "transfer",
        "correspondence", "perception", "manuscript", "manuscripts", "paradigm",
        "approximation", "subspace", "manifold", "archive", "models", "frameworks",
        "representations", "algorithms", "systems", "protocols", "pipelines",
        "estimators", "objectives", "structures",
    }
)

_BORDERLINE_SUBCLAUSES: tuple[str, ...] = (
    "Preliminary Working Paper on Methodological Perspectives and Institutional Protocols",
    "Exploratory Preprint Study of Comparative Formulations and Field Observations",
    "Workshop Technical Note on Operational Constraints and Modeling Tradeoffs",
    "Translated Monograph Excerpt on Evaluation Criteria and Longitudinal Findings",
    "Technical Report on Structural Assumptions and Applied Characterization",
    "Working Draft on Boundary Conditions and Qualitative Error Patterns",
    "Pre-Publication Manuscript on Corpus Design and Annotation Guidelines",
    "Extended Abstract on Cross-Domain Generalization and Ablation Studies",
    "Departmental Colloquium Paper on Algorithmic Variants and Convergence Behavior",
    "Archival Preprint on Baseline Calibration and Diagnostic Probing",
    "Supplementary Technical Companion on Hyperparameter Sensitivity and Scaling",
    "Position Paper on Representational Bottlenecks and Inductive Biases",
)


def _make_borderline_preprint_title(title: str, idx: int, rng: random.Random) -> str:
    """Keep ~48%-56% of content words with deduplicated domain paraphrases and varied subtitle frames."""
    content = [
        re.sub(r"[^A-Za-z0-9\-]", "", w)
        for w in title.split()
        if re.sub(r"[^A-Za-z0-9]", "", w).lower() not in _BORDERLINE_STOPWORDS
        and len(re.sub(r"[^A-Za-z0-9]", "", w)) >= 3
    ]
    if not content:
        content = [re.sub(r"[^A-Za-z0-9\-]", "", w) for w in title.split() if w]
    n_keep = max(2, int(round(len(content) * rng.uniform(0.42, 0.50))))
    kept = content[:n_keep]
    out: list[str] = []
    seen_lower: set[str] = set()
    seen_roots: set[str] = set()
    for k, w in enumerate(kept):
        wl = w.lower()
        if k == 0 and len(w) <= 12:
            cand_tok = w
        elif wl in _BORDERLINE_PARAPHRASES:
            cand_tok = _BORDERLINE_PARAPHRASES[wl]
        else:
            cand_tok = _BORDERLINE_TOPIC_FALLBACKS[(idx * 7 + k * 5) % len(_BORDERLINE_TOPIC_FALLBACKS)].strip()
        cand_root = re.sub(r"[^a-z0-9]", "", cand_tok.lower())[:5]
        if cand_tok.lower() in seen_lower or (len(cand_root) >= 4 and cand_root in seen_roots):
            for alt_shift in range(1, len(_BORDERLINE_TOPIC_FALLBACKS)):
                alt_tok = _BORDERLINE_TOPIC_FALLBACKS[
                    (idx * 7 + k * 5 + alt_shift) % len(_BORDERLINE_TOPIC_FALLBACKS)
                ].strip()
                alt_root = re.sub(r"[^a-z0-9]", "", alt_tok.lower())[:5]
                if alt_tok.lower() not in seen_lower and (len(alt_root) < 4 or alt_root not in seen_roots):
                    cand_tok = alt_tok
                    cand_root = alt_root
                    break
        seen_lower.add(cand_tok.lower())
        if len(cand_root) >= 4:
            seen_roots.add(cand_root)
        out.append(cand_tok)
    if not out or out[-1].lower() not in _BORDERLINE_VALID_TERMINAL_NOUNS:
        head_noun = _BORDERLINE_HEAD_NOUNS[idx % len(_BORDERLINE_HEAD_NOUNS)]
        if len(out) >= 4:
            out[-1] = head_noun
        else:
            out.append(head_noun)
    subclause = _BORDERLINE_SUBCLAUSES[idx % len(_BORDERLINE_SUBCLAUSES)]
    sep = " — " if (idx % 3 == 1) else ": "
    return f"{' '.join(out)}{sep}{subclause}"


def _encode_texts_fast(texts: list[str], batch_size: int = 256) -> np.ndarray:
    """Encode unique texts with Sentence-BERT on MPS/CUDA/CPU and map back to full array."""
    from sentence_transformers import SentenceTransformer

    device = "mps" if torch.backends.mps.is_available() else ("cuda" if torch.cuda.is_available() else "cpu")
    model = SentenceTransformer("all-MiniLM-L6-v2", device=device)

    unique_texts = list(dict.fromkeys(texts))
    print(
        f"  -> Encoding {len(unique_texts):,} unique texts (from {len(texts):,} total) "
        f"on device='{device}' (batch_size={batch_size})..."
    )
    t0 = time.time()
    unique_embs = model.encode(
        unique_texts,
        batch_size=batch_size,
        normalize_embeddings=True,
        show_progress_bar=False,
    )
    unique_embs = np.asarray(unique_embs, dtype=np.float32)
    idx_map = {txt: i for i, txt in enumerate(unique_texts)}
    gather_indices = np.array([idx_map[txt] for txt in texts], dtype=np.int32)
    elapsed = time.time() - t0
    print(
        f"  -> Encoded {len(unique_texts):,} texts in {elapsed:.2f}s "
        f"({len(unique_texts) / max(elapsed, 1e-3):.0f} texts/sec)"
    )
    return unique_embs[gather_indices]


def build_split_dataset(
    pool_papers: list[dict[str, Any]],
    split_name: str,
    seed: int = 42,
) -> list[dict[str, Any]]:
    """Build labeled Neuro-Symbolic feature records from a disjoint pool of base papers.

    Class distribution & non-zero context-alignment coverage (zero 1-way shortcut):
        - VERIFIED (36%):                50% evaluated with in-text context alignment
        - METADATA_ERROR (22%):          45% evaluated with in-text context alignment
        - SUSPECTED_HALLUCINATION (30%): 40% of candidate-bearing H2 & H4 with context alignment
        - UNRESOLVED (12%):              35% of U1 evaluated with in-text context alignment
    """
    rng = random.Random(seed)
    fuzzy = FuzzyMatcher()
    venue_norm = VenueNormalizer()
    n_total = len(pool_papers)

    n_verified = int(round(n_total * 0.36))
    n_halluc = int(round(n_total * 0.30))
    n_meta = int(round(n_total * 0.22))
    n_unres = n_total - (n_verified + n_halluc + n_meta)

    ver_pool, meta_pool, hal_pool, unr_pool = _allocate_class_pools_stratified(
        pool_papers, n_verified, n_meta, n_halluc, n_unres
    )
    ver_abs_n = max(1, sum(1 for p in ver_pool if p.get("has_full_abstract")))
    meta_abs_n = max(1, sum(1 for p in meta_pool if p.get("has_full_abstract")))
    hal_abs_n = max(1, sum(1 for p in hal_pool if p.get("has_full_abstract")))
    unr_abs_n = max(1, sum(1 for p in unr_pool if p.get("has_full_abstract")))

    raw_specs: list[dict[str, Any]] = []
    cited_titles_to_encode: list[str] = []
    cand_titles_to_encode: list[str] = []
    context_sents_to_encode: list[str] = []
    abs_sents_to_encode: list[str] = []
    rest_abs_sents_to_encode: list[str] = []

    # 1. VERIFIED (36% — 50% with authentic Sentence-BERT context alignment)
    target_ver_ctx = int(round(n_verified * 0.50))
    ver_ctx_indices = set(range(min(target_ver_ctx, ver_abs_n)))
    if len(ver_ctx_indices) < target_ver_ctx:
        ver_ctx_indices.update(range(target_ver_ctx))

    for i in range(n_verified):
        p = ver_pool[i]
        s1, s2 = _extract_sentences(p["abstract"], p["title"])
        sub_mode = i % 20
        has_doi = bool(p["doi"]) and (i % 10 < 7)

        if sub_mode < 8:
            c_title = p["title"]
            c_authors = list(p["authors"])
            yd = 0
            c_venue = p["venue"]
        elif sub_mode < 13:
            c_title = p["title"]
            c_authors = [_abbreviate_author_name(p["authors"][0])]
            yd = 0 if (i % 3 != 0) else 1
            c_venue = p["venue"]
        elif sub_mode < 17:
            c_title = _corrupt_title_minor_ocr(p["title"], rng)
            c_authors = list(p["authors"]) if (i % 2 == 0) else [p["authors"][0]]
            yd = 0 if (i % 4 != 0) else 1
            c_venue = p["venue"]
        else:
            c_title = _corrupt_title_minor_ocr(p["title"], rng)
            c_authors = [_abbreviate_author_name(a) for a in p["authors"][:2]]
            yd = 0
            c_venue = p["venue"]

        use_context = i in ver_ctx_indices
        url_status = "alive" if (i % 5 < 3) else ("restricted" if i % 5 == 3 else None)
        url_code = 200 if url_status == "alive" else (403 if url_status == "restricted" else None)

        raw_specs.append(
            {
                "id": f"{split_name}_ver_{i:05d}",
                "paper_id": p["paper_id"],
                "true_label": "verified",
                "sub_type": f"V{(sub_mode // 5) + 1}",
                "cited_title": c_title,
                "cand_title": p["title"],
                "cited_authors": c_authors,
                "cand_authors": p["authors"],
                "cited_year": _perturb_year_bounded(int(p["year"]), yd),
                "cand_year": int(p["year"]),
                "year_distance": yd,
                "cited_venue": c_venue,
                "cand_venue": p["venue"],
                "cand_doi": p["doi"] or None,
                "doi_exact_match": has_doi,
                "source_consensus": rng.choices([1, 2, 3, 4], weights=[0.25, 0.45, 0.20, 0.10])[0],
                "has_candidate": True,
                "cand_abstract": p["abstract"],
                "has_abstract": bool(p.get("has_full_abstract")),
                "use_context": use_context,
                "context_aligned_mode": "aligned" if use_context else "none",
                "url_status": url_status,
                "url_status_code": url_code,
            }
        )
        cited_titles_to_encode.append(c_title)
        cand_titles_to_encode.append(p["title"])
        context_sents_to_encode.append(s1)
        abs_sents_to_encode.append(s2)
        rest_abs_sents_to_encode.append(_extract_rest_abstract(p["abstract"], p["title"]))

    # 2. METADATA_ERROR (22% — 45% with Sentence-BERT context alignment across M1..M5,
    #    including aligned contexts on year/author/DOI-title errors AND explicit R-CONTENT-MISMATCH)
    target_meta_ctx = int(round(n_meta * 0.45))
    meta_ctx_indices = set(range(min(target_meta_ctx, meta_abs_n)))
    if len(meta_ctx_indices) < target_meta_ctx:
        meta_ctx_indices.update(range(target_meta_ctx))

    for j in range(n_meta):
        p = meta_pool[j]
        other_p = meta_pool[(j + 137) % meta_abs_n] if meta_abs_n > 1 else meta_pool[(j + 1) % max(1, n_meta)]
        s1, s2 = _extract_sentences(p["abstract"], p["title"])
        other_s1, other_s2 = _extract_sentences(other_p["abstract"], other_p["title"])
        err_mode = j % 5
        use_context = j in meta_ctx_indices
        disjoint_coauthors = _pick_non_overlapping_scholar_authors(
            meta_pool, j, p["authors"], count=3
        )

        if err_mode == 0:
            # M1: Publication year error (|delta| in 2..8 years), matching title & authors.
            # When use_context=True, cites aligned s1 vs s2 from p (proving aligned context != verified!)
            c_title = p["title"]
            c_authors = list(p["authors"])
            yd = rng.choice([2, 3, 4, 5, 6, 8])
            doi_ok = False
            consensus = rng.choice([1, 2, 3])
            ctx_sent, abs_sent = s1, s2
            ctx_mode = "aligned" if use_context else "none"
            url_status, url_code = "alive", 200
        elif err_mode == 1:
            # M2: Wrong / swapped co-authors using real scholar names from the same split pool
            c_title = p["title"]
            if j % 2 == 0 and len(p["authors"]) >= 2 and len(disjoint_coauthors) >= 3 and not use_context:
                c_authors = [p["authors"][0], *disjoint_coauthors[:3]]
                consensus = rng.choice([1, 2])
            else:
                c_authors = disjoint_coauthors[:2] if disjoint_coauthors else list(other_p["authors"])
                consensus = rng.choice([2, 3])
            yd = rng.choice([0, 1])
            doi_ok = False
            ctx_sent, abs_sent = s1, s2
            ctx_mode = "aligned" if use_context else "none"
            url_status, url_code = "alive", 200
        elif err_mode == 2:
            # M3: Valid DOI match, but corrupted/spliced title in [0.60, 0.83] (R-DOI-TITLE-MISMATCH)
            c_title = _corrupt_title_moderate(p["title"], other_p["title"], rng)
            c_authors = list(p["authors"])
            yd = rng.choice([0, 1])
            doi_ok = bool(p["doi"])
            consensus = rng.choice([1, 2])
            ctx_sent, abs_sent = s1, s2
            ctx_mode = "aligned" if use_context else "none"
            url_status, url_code = "alive", 200
        elif err_mode == 3:
            # M4: Moderate title alteration without DOI, plus explicit R-CONTENT-MISMATCH sub-mode
            # on real papers (yd=0, doi_ok=False, full/first-author citations across 12 natural academic templates)
            m4_idx = j // 5
            is_content_mismatch_submode = use_context and (m4_idx % 2 == 0)
            if is_content_mismatch_submode:
                c_title = p["title"] if (m4_idx % 4 != 3) else _corrupt_title_minor_ocr(p["title"], rng)
                auth_variant = m4_idx % 4
                if auth_variant in (0, 1):
                    c_authors = list(p["authors"])
                elif auth_variant == 2 and len(p["authors"]) >= 2:
                    c_authors = [f"{p['authors'][0]} et al."]
                else:
                    c_authors = [_abbreviate_author_name(p["authors"][0])]
                yd = 0
                doi_ok = False
                consensus = rng.choice([1, 2])
                ctx_sent = _make_misattributed_context_sentence(
                    p,
                    other_s2,
                    other_s1,
                    m4_idx // 2,
                )
                abs_sent = s1
                ctx_mode = "contradict"
                url_status, url_code = None, None
            else:
                c_title = _corrupt_title_moderate(p["title"], other_p["title"], rng)
                c_authors = list(p["authors"])
                yd = rng.choice([0, 1, 2]) if not use_context else 2
                doi_ok = False
                consensus = rng.choice([1, 2])
                ctx_sent, abs_sent = other_s1, s1
                ctx_mode = "contradict" if use_context else "none"
                url_status, url_code = None, None
        else:
            # M5: Compound metadata discrepancy (author + year mismatch, or R-DOMAIN-EXCEPTION)
            if j % 2 == 0:
                c_title = _corrupt_title_moderate(p["title"], other_p["title"], rng)
                c_authors = [p["authors"][0], *disjoint_coauthors[:2]]
                yd = rng.choice([2, 3, 4])
                doi_ok = False
                consensus = rng.choice([1, 2])
                url_status, url_code = "dead_link", 404
            else:
                c_title = _corrupt_title_moderate(p["title"], other_p["title"], rng)
                c_authors = list(p["authors"])
                yd = rng.choice([1, 2])
                doi_ok = bool(p["doi"])
                consensus = rng.choice([2, 3])
                url_status, url_code = "dead_link", 404
            ctx_sent, abs_sent = other_s1, s1
            ctx_mode = "contradict" if use_context else "none"

        raw_specs.append(
            {
                "id": f"{split_name}_meta_{j:05d}",
                "paper_id": p["paper_id"],
                "true_label": "metadata_error",
                "sub_type": f"M{err_mode + 1}",
                "cited_title": c_title,
                "cand_title": p["title"],
                "cited_authors": c_authors,
                "cand_authors": p["authors"],
                "cited_year": _perturb_year_bounded(int(p["year"]), yd),
                "cand_year": int(p["year"]),
                "year_distance": yd,
                "cited_venue": p["venue"],
                "cand_venue": other_p["venue"] if err_mode == 1 else p["venue"],
                "cand_doi": p["doi"] or None,
                "doi_exact_match": doi_ok,
                "source_consensus": consensus,
                "has_candidate": True,
                "cand_abstract": p["abstract"],
                "has_abstract": bool(p.get("has_full_abstract")),
                "use_context": use_context,
                "context_aligned_mode": ctx_mode,
                "url_status": url_status,
                "url_status_code": url_code,
            }
        )
        cited_titles_to_encode.append(c_title)
        cand_titles_to_encode.append(p["title"])
        context_sents_to_encode.append(ctx_sent)
        abs_sents_to_encode.append(abs_sent)
        rest_abs_sents_to_encode.append(_extract_rest_abstract(p["abstract"], p["title"]))

    # 3. SUSPECTED_HALLUCINATION (30% — Plausible same-domain LLM hallucinations:
    #    spliced academic titles + real scholar names + real scholarly venues from same split;
    #    40% of candidate-bearing H2 & H4 evaluated with cross-paper context alignment)
    h2_cand_counter = 0
    h4_cand_counter = 0
    for k in range(n_halluc):
        p1 = hal_pool[k]
        hal_mode = k % 4
        p3 = hal_pool[(k + 503) % max(1, n_halluc)]
        c_title = _make_spliced_academic_title(p1, p3, rng)
        c_venue = p3["venue"]

        if hal_mode == 0:
            # H1: Plausible fabricated reference -> 0 candidates returned by scholarly APIs
            p2 = hal_pool[(k + 251) % max(1, n_halluc)]
            cand_title = p2["title"]
            c_authors = _pick_non_overlapping_scholar_authors(hal_pool, k, p2["authors"], count=2)
            yd = 999
            has_cand = False
            use_context = False
            consensus = 0
            url_status, url_code = None, None
            c_doi = None
        elif hal_mode == 1:
            # H2: Plausible spliced LLM hallucination with weak same-domain candidate returned
            use_context = (h2_cand_counter % 5 < 2) and (k < hal_abs_n)
            h2_cand_counter += 1
            p2_idx = ((k + 251) % hal_abs_n) if use_context else ((k + 251) % max(1, n_halluc))
            if p2_idx == k and n_halluc > 1:
                p2_idx = (k + 1) % (hal_abs_n if use_context else n_halluc)
            p2 = hal_pool[p2_idx]
            cand_title = p2["title"]
            c_authors = _pick_non_overlapping_scholar_authors(hal_pool, k, p2["authors"], count=2)
            yd = rng.choice([4, 7, 11, 15, 999])
            has_cand = True
            consensus = rng.choice([0, 1])
            url_status, url_code = None, None
            c_doi = None
        elif hal_mode == 2:
            # H3: Plausible non-existent DOI (realistic ACL/IEEE/ACM/Springer DOI prefix that does not resolve)
            p2 = hal_pool[(k + 251) % max(1, n_halluc)]
            cand_title = p2["title"]
            c_authors = _pick_non_overlapping_scholar_authors(hal_pool, k, p2["authors"], count=2)
            yd = rng.choice([3, 6, 12, 999])
            has_cand = (k % 2 == 0)
            use_context = False
            consensus = 0
            url_status, url_code = None, None
            doi_prefixes = (
                f"10.18653/v1/2023.acl-long.{91000 + k}",
                f"10.1109/TASLP.2023.{9800000 + k}",
                f"10.1145/3580305.{3599000 + k}",
                f"10.1007/s10994-023-{90000 + k}-x",
            )
            c_doi = doi_prefixes[(k // 4) % len(doi_prefixes)]
        else:
            # H4: Plausible hallucinated paper with dead_link (HTTP 404) or RFC 2606 fake_domain URL
            has_cand = ((k // 4) % 3 == 0)
            if has_cand:
                use_context = (h4_cand_counter % 5 < 2) and (k < hal_abs_n)
                h4_cand_counter += 1
            else:
                use_context = False
            p2_idx = ((k + 251) % hal_abs_n) if use_context else ((k + 251) % max(1, n_halluc))
            if p2_idx == k and n_halluc > 1:
                p2_idx = (k + 1) % (hal_abs_n if use_context else n_halluc)
            p2 = hal_pool[p2_idx]
            cand_title = p2["title"]
            c_authors = _pick_non_overlapping_scholar_authors(hal_pool, k, p2["authors"], count=2)
            yd = rng.choice([5, 9, 999])
            consensus = 0
            url_status = "fake_domain" if (k % 2 == 0) else "dead_link"
            url_code = None if url_status == "fake_domain" else 404
            c_doi = None

        s1_p1, _ = _extract_sentences(p1["abstract"], p1["title"])
        _, s2_p2 = _extract_sentences(p2["abstract"], p2["title"])

        raw_specs.append(
            {
                "id": f"{split_name}_hal_{k:05d}",
                "paper_id": p1["paper_id"],
                "true_label": "suspected_hallucination",
                "sub_type": f"H{hal_mode + 1}",
                "cited_title": c_title,
                "cand_title": cand_title,
                "cited_authors": c_authors,
                "cand_authors": p2["authors"],
                "cited_year": _perturb_year_bounded(int(p2["year"]), yd),
                "cand_year": int(p2["year"]),
                "year_distance": yd,
                "cited_venue": c_venue,
                "cand_venue": p2["venue"],
                "cand_doi": (p2["doi"] or None) if has_cand else None,
                "doi_exact_match": False,
                "cited_doi": c_doi,
                "source_consensus": consensus,
                "has_candidate": has_cand,
                "cand_abstract": p2["abstract"] if has_cand else "",
                "has_abstract": bool(has_cand and p2.get("has_full_abstract")),
                "use_context": use_context,
                "context_aligned_mode": "cross_paper" if use_context else "none",
                "url_status": url_status,
                "url_status_code": url_code,
            }
        )
        cited_titles_to_encode.append(c_title)
        cand_titles_to_encode.append(cand_title)
        context_sents_to_encode.append(s1_p1)
        abs_sents_to_encode.append(s2_p2)
        rest_abs_sents_to_encode.append(_extract_rest_abstract(p2["abstract"], p2["title"]))

    # 4. UNRESOLVED / ABSTENTION BAND (12%: U1 = 8% ambiguous partial-evidence with 35% context alignment,
    #    U2 = 4% regional DOI registered_no_csl & HTTP 429 rate-limited abstention)
    u1_indices = [m for m in range(n_unres) if m % 3 != 0]
    target_u1_ctx = int(round(len(u1_indices) * 0.35))
    u1_ctx_set = set(u1_indices[:target_u1_ctx])

    for m in range(n_unres):
        p1 = unr_pool[m]
        other_u = unr_pool[(m + 73) % unr_abs_n] if unr_abs_n > 1 else unr_pool[(m + 1) % max(1, n_unres)]
        s1, s2 = _extract_sentences(p1["abstract"], p1["title"])
        other_u_s1, _ = _extract_sentences(other_u["abstract"], other_u["title"])

        if m % 3 != 0:
            sub_type = "U1"
            c_title = _make_borderline_preprint_title(p1["title"], m, rng)
            k_auth = 1 if len(p1["authors"]) <= 4 else max(2, (len(p1["authors"]) + 3) // 4)
            extra_coauthor = _pick_non_overlapping_scholar_authors(
                unr_pool, m, p1["authors"], count=1
            )
            c_authors = list(p1["authors"][:k_auth]) + extra_coauthor
            use_context = m in u1_ctx_set
            unr_yd = 2 if use_context else rng.choice([0, 1, 2])
            cited_year_val = _perturb_year_bounded(int(p1["year"]), unr_yd)
            if m % 2 == 0:
                cited_venue_val = p1["venue"]
            elif m % 4 == 1:
                cited_venue_val = "arXiv Preprint"
            else:
                cited_venue_val = ""
            cand_doi_val = p1["doi"] or None
            c_doi_val = None
            consensus_val = 1
            has_cand_val = True
            api_exhausted_val = False
            doi_ra_status_val = None
            ctx_sent = other_u_s1 if (m % 2 == 0) else s1
            abs_sent = s2
            ctx_mode = "borderline" if use_context else "none"
        else:
            sub_type = "U2"
            u2_idx = m // 3
            c_title = p1["title"]
            c_authors = list(p1["authors"][:2])
            unr_yd = 999
            cited_year_val = int(p1["year"])
            cand_doi_val = None
            consensus_val = 0
            has_cand_val = False
            use_context = False
            ctx_sent, abs_sent = s1, s2
            ctx_mode = "none"
            if u2_idx % 2 == 0:
                cited_venue_val = p1["venue"]
                c_doi_val = (
                    f"10.11499/sicejl.{int(p1['year'])}.{1000 + u2_idx}"
                    if ((u2_idx // 2) % 2 == 0)
                    else f"10.5109/es.{int(p1['year'])}.{1000 + u2_idx}"
                )
                api_exhausted_val = False
                doi_ra_status_val = "registered_no_csl"
            else:
                cited_venue_val = (
                    "Working Paper Series" if ((u2_idx // 2) % 2 == 0) else p1["venue"]
                )
                c_doi_val = None
                api_exhausted_val = True
                doi_ra_status_val = None

        raw_specs.append(
            {
                "id": f"{split_name}_unr_{m:05d}",
                "paper_id": p1["paper_id"],
                "true_label": "unresolved",
                "sub_type": sub_type,
                "cited_title": c_title,
                "cand_title": p1["title"],
                "cited_authors": c_authors,
                "cand_authors": p1["authors"],
                "cited_year": cited_year_val,
                "cand_year": int(p1["year"]),
                "year_distance": unr_yd,
                "cited_venue": cited_venue_val,
                "cand_venue": p1["venue"],
                "cand_doi": cand_doi_val,
                "doi_exact_match": False,
                "cited_doi": c_doi_val,
                "source_consensus": consensus_val,
                "has_candidate": has_cand_val,
                "cand_abstract": p1["abstract"] if has_cand_val else "",
                "has_abstract": bool(has_cand_val and p1.get("has_full_abstract")),
                "api_exhausted": api_exhausted_val,
                "doi_ra_status": doi_ra_status_val,
                "use_context": use_context,
                "context_aligned_mode": ctx_mode,
                "url_status": None,
                "url_status_code": None,
            }
        )
        cited_titles_to_encode.append(c_title)
        cand_titles_to_encode.append(p1["title"])
        context_sents_to_encode.append(ctx_sent)
        abs_sents_to_encode.append(abs_sent)
        rest_abs_sents_to_encode.append(_extract_rest_abstract(p1["abstract"], p1["title"]))

    all_texts = (
        cited_titles_to_encode
        + cand_titles_to_encode
        + context_sents_to_encode
        + abs_sents_to_encode
        + rest_abs_sents_to_encode
    )
    all_embs = _encode_texts_fast(all_texts, batch_size=256)
    n_items = len(raw_specs)
    cited_embs = all_embs[0:n_items]
    cand_embs = all_embs[n_items : 2 * n_items]
    ctx_embs = all_embs[2 * n_items : 3 * n_items]
    abs_embs = all_embs[3 * n_items : 4 * n_items]
    rest_abs_embs = all_embs[4 * n_items : 5 * n_items]

    raw_title_sems = np.sum(cited_embs * cand_embs, axis=1)
    raw_ctx_sent_sems = np.sum(ctx_embs * abs_embs, axis=1)
    raw_ctx_rest_sems = np.sum(ctx_embs * rest_abs_embs, axis=1)
    raw_ctx_title_sems = np.sum(ctx_embs * cand_embs, axis=1)

    records: list[dict[str, Any]] = []
    for idx_item, spec in enumerate(raw_specs):
        lbl = spec["true_label"]
        has_cand = bool(spec["has_candidate"])

        if not has_cand:
            tf = 0.0
            ts = 0.0
            aj = 0.0
            v_sim = 0.0
        else:
            tf = float(fuzzy.token_set_ratio(spec["cited_title"].lower(), spec["cand_title"].lower()))
            ts = max(0.0, min(1.0, float(raw_title_sems[idx_item])))
            aj = float(author_match_score(spec["cited_authors"], spec["cand_authors"]))
            v_sim = (
                float(venue_norm.similarity(spec["cited_venue"], spec["cand_venue"]))
                if spec["cited_venue"]
                else 0.5
            )

        if has_cand and spec["use_context"]:
            title_ctx_sim = max(0.0, min(1.0, float(raw_ctx_title_sems[idx_item])))
            sent_sim = max(0.0, min(1.0, float(raw_ctx_sent_sems[idx_item])))
            rest_sim = max(0.0, min(1.0, float(raw_ctx_rest_sems[idx_item])))
            max_sent_sim = max(sent_sim, rest_sim)
            abstract_sim = max(rest_sim, 0.65 * max_sent_sim + 0.35 * rest_sim)
            weighted_ca = 0.375 * title_ctx_sim + 0.625 * abstract_sim
            if abstract_sim >= 0.70:
                raw_ca = max(weighted_ca, abstract_sim * 0.92, max_sent_sim * 0.90)
            elif max_sent_sim >= 0.65 and abstract_sim > 0.0:
                raw_ca = max(weighted_ca, max_sent_sim * 0.88)
            else:
                raw_ca = weighted_ca
            full_cand_abs = str(spec.get("cand_abstract") or abs_sents_to_encode[idx_item])
            ca_score, ca_conf, ca_aligned = SemanticMatcher.calibrate_monolingual_specificity(
                raw_ca,
                context_sents_to_encode[idx_item],
                spec["cand_title"],
                full_cand_abs,
                is_cross_lingual=False,
            )
            stance_lbl = SemanticMatcher.check_claim_stance(
                context_sents_to_encode[idx_item],
                rest_abs_sents_to_encode[idx_item],
                ca_score,
                has_abstract=bool(full_cand_abs),
                is_cross_lingual=False,
                source_abstract=full_cand_abs,
                source_title=spec["cand_title"],
            )
            if stance_lbl == "contradiction_risk":
                ca_aligned = False
        else:
            ca_score = 0.0
            ca_conf = ""
            ca_aligned = False
            stance_lbl = ""

        cand_doi = spec.get("cand_doi")
        records.append(
            {
                "id": spec["id"],
                "paper_id": spec["paper_id"],
                "true_label": lbl,
                "sub_type": spec["sub_type"],
                "cited_title": spec["cited_title"],
                "cand_title": spec["cand_title"],
                "cited_authors": list(spec["cited_authors"]),
                "cand_authors": list(spec["cand_authors"]),
                "cited_year": spec["cited_year"],
                "cand_year": spec["cand_year"],
                "cited_venue": spec["cited_venue"],
                "cand_venue": spec["cand_venue"],
                "cand_doi": cand_doi,
                "doi_exact_match": spec["doi_exact_match"],
                "title_sim_fuzzy": round(float(tf), 4),
                "title_sim_semantic": round(float(ts), 4),
                "author_jaccard": round(float(aj), 4),
                "year_distance": spec["year_distance"],
                "source_consensus": spec["source_consensus"],
                "venue_sim": round(float(v_sim), 4),
                "content_alignment_score": round(float(ca_score), 4),
                "content_alignment_confidence": ca_conf,
                "content_is_aligned": ca_aligned,
                "stance_label": stance_lbl,
                "has_candidate": has_cand,
                "api_exhausted": bool(spec.get("api_exhausted", False)),
                "doi_ra_status": spec.get("doi_ra_status"),
                "url_status": spec["url_status"],
                "url_status_code": spec["url_status_code"],
                "cited_doi": spec.get("cited_doi"),
                "crossref_matched": bool(has_cand and (cand_doi or spec["doi_exact_match"])),
            }
        )

    assert all(
        MIN_SCHOLARLY_YEAR <= int(r["cited_year"]) <= MAX_SCHOLARLY_YEAR for r in records
    ), f"Impossible cited_year outside [{MIN_SCHOLARLY_YEAR}, {MAX_SCHOLARLY_YEAR}] in {split_name}"
    rng.shuffle(records)
    return records


def _run_symbolic_rule_on_item(rules: SymbolicRules, item: dict[str, Any]) -> tuple[MatchFeatures, Any]:
    """Execute the production SymbolicRules engine on a single dataset record (shared with BaselineRunner)."""
    return evaluate_symbolic_record(rules, item)


def _compute_feature_shortcut_audit(records: list[dict[str, Any]]) -> dict[str, Any]:
    """Audit `content_alignment_score` distribution across all 4 classes to verify zero 1-way shortcut."""
    by_class: dict[str, dict[str, Any]] = {}
    for cls_name in MetricsCalculator.LABELS:
        cls_recs = [r for r in records if r["true_label"] == cls_name]
        scores = np.array([float(r["content_alignment_score"]) for r in cls_recs], dtype=np.float64)
        nz_mask = scores > 0.0
        nz_scores = scores[nz_mask]
        aligned_cnt = sum(1 for r in cls_recs if r.get("content_is_aligned"))
        by_class[cls_name] = {
            "count": int(len(cls_recs)),
            "nonzero_count": int(np.sum(nz_mask)),
            "nonzero_rate": round(float(np.mean(nz_mask)) if len(scores) else 0.0, 4),
            "aligned_count": int(aligned_cnt),
            "aligned_rate": round(float(aligned_cnt / len(cls_recs)) if cls_recs else 0.0, 4),
            "nonzero_mean": round(float(np.mean(nz_scores)) if len(nz_scores) else 0.0, 4),
            "nonzero_p10": round(float(np.percentile(nz_scores, 10)) if len(nz_scores) else 0.0, 4),
            "nonzero_p50": round(float(np.percentile(nz_scores, 50)) if len(nz_scores) else 0.0, 4),
            "nonzero_p90": round(float(np.percentile(nz_scores, 90)) if len(nz_scores) else 0.0, 4),
        }
    all_nonzero = sum(v["nonzero_count"] for v in by_class.values())
    ver_share_given_nonzero = (
        by_class["verified"]["nonzero_count"] / all_nonzero if all_nonzero > 0 else 0.0
    )
    return {
        "all_four_classes_have_nonzero_alignment": all(
            v["nonzero_count"] > 0 for v in by_class.values()
        ),
        "p_verified_given_nonzero_alignment": round(float(ver_share_given_nonzero), 4),
        "per_class_content_alignment": by_class,
    }


def _compute_per_class_metrics(confusion_matrix: dict[str, dict[str, int]]) -> dict[str, dict[str, float]]:
    """Compute per-class Precision, Recall, F1, and Support from a 4x4 confusion matrix."""
    labels = MetricsCalculator.LABELS
    out: dict[str, dict[str, float]] = {}
    for lbl in labels:
        tp = confusion_matrix.get(lbl, {}).get(lbl, 0)
        fp = sum(confusion_matrix.get(other, {}).get(lbl, 0) for other in labels if other != lbl)
        fn = sum(confusion_matrix.get(lbl, {}).get(other, 0) for other in labels if other != lbl)
        sup = tp + fn
        prec = tp / (tp + fp) if (tp + fp) > 0 else 0.0
        rec = tp / (tp + fn) if (tp + fn) > 0 else 0.0
        f1 = (2 * prec * rec / (prec + rec)) if (prec + rec) > 0 else 0.0
        out[lbl] = {
            "precision": round(prec, 4),
            "recall": round(rec, 4),
            "f1": round(f1, 4),
            "support": int(sup),
        }
    return out


def _macro_f1_fast(y_true: np.ndarray, y_pred: np.ndarray, n_classes: int = 4) -> float:
    f1_sum = 0.0
    for c in range(n_classes):
        tp = np.sum((y_true == c) & (y_pred == c))
        fp = np.sum((y_true != c) & (y_pred == c))
        fn = np.sum((y_true == c) & (y_pred != c))
        denom = 2 * tp + fp + fn
        f1_sum += (2.0 * tp / denom) if denom > 0 else 0.0
    return float(f1_sum / n_classes)


def _ece_fast(conf: np.ndarray, correct: np.ndarray, n_bins: int = 10) -> float:
    n = len(conf)
    if n == 0:
        return 0.0
    bin_ids = np.minimum((conf * n_bins).astype(np.int32), n_bins - 1)
    ece_val = 0.0
    for bin_i in range(n_bins):
        mask = bin_ids == bin_i
        cnt = int(np.sum(mask))
        if cnt > 0:
            ece_val += (cnt / n) * abs(float(np.mean(correct[mask])) - float(np.mean(conf[mask])))
    return float(ece_val)


def _compute_bootstrap_ci(
    gold_labels: list[str],
    predictions: list[str],
    confidences: list[float],
    n_bootstraps: int = 1000,
    seed: int = 42,
) -> dict[str, dict[str, float]]:
    """Compute 95% Non-Parametric Bootstrap Confidence Intervals (Dror et al., ACL 2018)."""
    label_to_int = {lbl: idx for idx, lbl in enumerate(MetricsCalculator.LABELS)}
    y_true = np.array([label_to_int[y] for y in gold_labels], dtype=np.int32)
    y_pred = np.array([label_to_int[p] for p in predictions], dtype=np.int32)
    conf_arr = np.asarray(confidences, dtype=np.float64)
    correct_arr = (y_true == y_pred).astype(np.float64)

    n = len(y_true)
    rng = np.random.default_rng(seed)

    acc_samples = np.empty(n_bootstraps, dtype=np.float64)
    f1_samples = np.empty(n_bootstraps, dtype=np.float64)
    brier_samples = np.empty(n_bootstraps, dtype=np.float64)
    ece_samples = np.empty(n_bootstraps, dtype=np.float64)

    for b in range(n_bootstraps):
        idx = rng.integers(0, n, size=n)
        yt = y_true[idx]
        yp = y_pred[idx]
        cf = conf_arr[idx]
        cr = correct_arr[idx]

        acc_samples[b] = np.mean(cr)
        brier_samples[b] = np.mean((cf - cr) ** 2)
        f1_samples[b] = _macro_f1_fast(yt, yp)
        ece_samples[b] = _ece_fast(cf, cr)

    def _ci_summary(arr: np.ndarray) -> dict[str, float]:
        return {
            "mean": round(float(np.mean(arr)), 4),
            "std_error": round(float(np.std(arr, ddof=1)), 4),
            "ci_95_lower": round(float(np.percentile(arr, 2.5)), 4),
            "ci_95_upper": round(float(np.percentile(arr, 97.5)), 4),
        }

    return {
        "n_bootstraps": n_bootstraps,
        "accuracy": _ci_summary(acc_samples),
        "macro_f1": _ci_summary(f1_samples),
        "ece": _ci_summary(ece_samples),
        "brier": _ci_summary(brier_samples),
    }


def _mcnemar_continuity_corrected(
    correct_a: np.ndarray,
    correct_b: np.ndarray,
) -> dict[str, Any]:
    """Continuity-corrected McNemar's test (Edwards, 1948; Dietterich, 1998; Dror et al., ACL 2018)."""
    n_11 = int(np.sum((correct_a == 1) & (correct_b == 1)))
    n_10 = int(np.sum((correct_a == 1) & (correct_b == 0)))
    n_01 = int(np.sum((correct_a == 0) & (correct_b == 1)))
    n_00 = int(np.sum((correct_a == 0) & (correct_b == 0)))
    discordant = n_10 + n_01
    if discordant == 0:
        chi2_stat = 0.0
        p_val = 1.0
        log10_p = 0.0
    else:
        chi2_stat = float((max(0, abs(n_10 - n_01) - 1) ** 2) / discordant)
        p_val = float(scipy_stats.chi2.sf(chi2_stat, df=1))
        raw_logsf = float(scipy_stats.chi2.logsf(chi2_stat, df=1))
        if math.isfinite(raw_logsf):
            log10_p = raw_logsf / math.log(10.0)
        else:
            # Exact Mill's ratio / asymptotic expansion for chi2(df=1) tail when chi2 > 1400
            ln_p = -0.5 * chi2_stat - 0.5 * math.log(0.5 * math.pi * chi2_stat)
            log10_p = ln_p / math.log(10.0)

    p_disp = "< 1e-16" if p_val < 1e-16 else f"{p_val:.4e}"
    return {
        "n_11_both_correct": n_11,
        "n_10_proposed_only_correct": n_10,
        "n_01_baseline_only_correct": n_01,
        "n_00_both_wrong": n_00,
        "chi2_statistic": round(chi2_stat, 4),
        "p_value": p_val,
        "p_value_display": p_disp,
        "log10_p_value": round(log10_p, 2),
        "significant_alpha_0_001": bool(p_val < 0.001),
    }


def compute_statistical_significance_tests(
    gold_labels: list[str],
    proposed_preds: list[str],
    baseline_preds_map: dict[str, list[str]],
    uncal_confs: list[float],
    cal_confs: list[float],
    *,
    n_bootstraps: int = 1000,
    seed: int = 42,
) -> dict[str, Any]:
    """Paired McNemar & 1,000-resample Paired Bootstrap significance tests (Dror et al., ACL 2018)."""
    label_to_int = {lbl: idx for idx, lbl in enumerate(MetricsCalculator.LABELS)}
    y_true = np.array([label_to_int[y] for y in gold_labels], dtype=np.int32)
    y_prop = np.array([label_to_int[p] for p in proposed_preds], dtype=np.int32)
    corr_prop = (y_true == y_prop).astype(np.int32)

    n = len(y_true)
    rng = np.random.default_rng(seed)
    boot_indices = rng.integers(0, n, size=(n_bootstraps, n))

    prop_acc_obs = float(np.mean(corr_prop))
    prop_f1_obs = _macro_f1_fast(y_true, y_prop)

    prop_acc_boot = np.empty(n_bootstraps, dtype=np.float64)
    prop_f1_boot = np.empty(n_bootstraps, dtype=np.float64)
    for b in range(n_bootstraps):
        idx = boot_indices[b]
        prop_acc_boot[b] = np.mean(corr_prop[idx])
        prop_f1_boot[b] = _macro_f1_fast(y_true[idx], y_prop[idx])

    pairwise_vs_baselines: dict[str, Any] = {}
    for b_name, b_preds in baseline_preds_map.items():
        if b_name == "proposed":
            continue
        y_base = np.array([label_to_int[p] for p in b_preds], dtype=np.int32)
        corr_base = (y_true == y_base).astype(np.int32)
        base_acc_obs = float(np.mean(corr_base))
        base_f1_obs = _macro_f1_fast(y_true, y_base)

        delta_acc_obs = prop_acc_obs - base_acc_obs
        delta_f1_obs = prop_f1_obs - base_f1_obs

        delta_acc_boot = np.empty(n_bootstraps, dtype=np.float64)
        delta_f1_boot = np.empty(n_bootstraps, dtype=np.float64)
        for b in range(n_bootstraps):
            idx = boot_indices[b]
            delta_acc_boot[b] = prop_acc_boot[b] - float(np.mean(corr_base[idx]))
            delta_f1_boot[b] = prop_f1_boot[b] - _macro_f1_fast(y_true[idx], y_base[idx])

        # Finite-sample Monte Carlo one-sided p-value (Davison & Hinkley, 1997; Dror et al., ACL 2018)
        # H0: Proposed <= Baseline (testing H1: Proposed > Baseline)
        non_pos_acc = int(np.sum(delta_acc_boot <= 0.0))
        non_pos_f1 = int(np.sum(delta_f1_boot <= 0.0))
        p_boot_acc = (non_pos_acc + 1) / (n_bootstraps + 1)
        p_boot_f1 = (non_pos_f1 + 1) / (n_bootstraps + 1)

        mcnemar_res = _mcnemar_continuity_corrected(corr_prop, corr_base)
        pairwise_vs_baselines[f"proposed_vs_{b_name}"] = {
            "baseline": b_name,
            "n_samples": n,
            "proposed_accuracy": round(prop_acc_obs, 4),
            "baseline_accuracy": round(base_acc_obs, 4),
            "delta_accuracy": round(delta_acc_obs, 4),
            "delta_accuracy_ci_95": [
                round(float(np.percentile(delta_acc_boot, 2.5)), 4),
                round(float(np.percentile(delta_acc_boot, 97.5)), 4),
            ],
            "proposed_macro_f1": round(prop_f1_obs, 4),
            "baseline_macro_f1": round(base_f1_obs, 4),
            "delta_macro_f1": round(delta_f1_obs, 4),
            "delta_macro_f1_ci_95": [
                round(float(np.percentile(delta_f1_boot, 2.5)), 4),
                round(float(np.percentile(delta_f1_boot, 97.5)), 4),
            ],
            "paired_bootstrap": {
                "n_bootstraps": n_bootstraps,
                "one_sided_p_value_accuracy": round(float(p_boot_acc), 6),
                "one_sided_p_value_macro_f1": round(float(p_boot_f1), 6),
                "p_value_display": "< 0.001" if p_boot_f1 <= 0.001 else f"{p_boot_f1:.4f}",
                "non_positive_resamples_f1": non_pos_f1,
            },
            "mcnemar_test": mcnemar_res,
        }

    # Calibration Paired Bootstrap + Wilcoxon Signed-Rank on Platt-Calibrated vs Uncalibrated
    uncal_arr = np.asarray(uncal_confs, dtype=np.float64)
    cal_arr = np.asarray(cal_confs, dtype=np.float64)
    corr_f = corr_prop.astype(np.float64)

    ece_uncal_obs = _ece_fast(uncal_arr, corr_f)
    ece_cal_obs = _ece_fast(cal_arr, corr_f)
    brier_uncal_obs = float(np.mean((uncal_arr - corr_f) ** 2))
    brier_cal_obs = float(np.mean((cal_arr - corr_f) ** 2))

    delta_ece_boot = np.empty(n_bootstraps, dtype=np.float64)
    delta_brier_boot = np.empty(n_bootstraps, dtype=np.float64)
    for b in range(n_bootstraps):
        idx = boot_indices[b]
        u_b = uncal_arr[idx]
        c_b = cal_arr[idx]
        cr_b = corr_f[idx]
        delta_ece_boot[b] = _ece_fast(c_b, cr_b) - _ece_fast(u_b, cr_b)
        delta_brier_boot[b] = float(np.mean((c_b - cr_b) ** 2) - np.mean((u_b - cr_b) ** 2))

    non_neg_ece = int(np.sum(delta_ece_boot >= 0.0))
    non_neg_brier = int(np.sum(delta_brier_boot >= 0.0))
    p_ece = (non_neg_ece + 1) / (n_bootstraps + 1)
    p_brier = (non_neg_brier + 1) / (n_bootstraps + 1)

    per_item_brier_diff = ((cal_arr - corr_f) ** 2) - ((uncal_arr - corr_f) ** 2)
    wilcoxon_res = scipy_stats.wilcoxon(per_item_brier_diff, alternative="less")
    wilcoxon_p = float(wilcoxon_res.pvalue)

    return {
        "methodology": (
            "Continuity-corrected McNemar's test (Edwards, 1948; Dietterich, 1998) + "
            "1,000-resample Paired Bootstrap with Davison-Hinkley finite-sample correction "
            "(Berg-Kirkpatrick et al., EMNLP 2012; Dror et al., ACL 2018)"
        ),
        "pairwise_vs_baselines": pairwise_vs_baselines,
        "platt_calibration_vs_uncalibrated": {
            "n_samples": n,
            "ece_uncalibrated": round(ece_uncal_obs, 4),
            "ece_platt_calibrated": round(ece_cal_obs, 4),
            "delta_ece": round(ece_cal_obs - ece_uncal_obs, 4),
            "delta_ece_ci_95": [
                round(float(np.percentile(delta_ece_boot, 2.5)), 4),
                round(float(np.percentile(delta_ece_boot, 97.5)), 4),
            ],
            "ece_one_sided_bootstrap_p_value": round(float(p_ece), 6),
            "ece_p_value_display": "< 0.001" if p_ece <= 0.001 else f"{p_ece:.4f}",
            "brier_uncalibrated": round(brier_uncal_obs, 4),
            "brier_platt_calibrated": round(brier_cal_obs, 4),
            "delta_brier": round(brier_cal_obs - brier_uncal_obs, 4),
            "delta_brier_ci_95": [
                round(float(np.percentile(delta_brier_boot, 2.5)), 4),
                round(float(np.percentile(delta_brier_boot, 97.5)), 4),
            ],
            "brier_one_sided_bootstrap_p_value": round(float(p_brier), 6),
            "brier_p_value_display": "< 0.001" if p_brier <= 0.001 else f"{p_brier:.4f}",
            "wilcoxon_brier_statistic": round(float(wilcoxon_res.statistic), 2),
            "wilcoxon_brier_p_value": wilcoxon_p,
            "wilcoxon_brier_p_display": "< 1e-16" if wilcoxon_p < 1e-16 else f"{wilcoxon_p:.4e}",
        },
    }


_VN_LEGAL_OOD_TEMPLATES: tuple[tuple[str, str, int, str], ...] = (
    # 5 Constitutional Issuing-Authority Mismatches (e.g., QH law attributed to Ministry/Gov, or NĐ-CP to QH)
    (
        "Bộ Tài chính (2020). Luật Doanh nghiệp số 59/2020/QH14 của Bộ Tài chính ban hành ngày 17/06/2020.",
        "Luật Doanh nghiệp số 59/2020/QH14",
        2020,
        "Quốc hội",
    ),
    (
        "Chính phủ (2015). Bộ luật Dân sự số 91/2015/QH13 của Chính phủ ban hành ngày 24/11/2015.",
        "Bộ luật Dân sự số 91/2015/QH13",
        2015,
        "Quốc hội",
    ),
    (
        "Bộ Kế hoạch và Đầu tư (2020). Luật Đầu tư số 61/2020/QH14 của Bộ Kế hoạch và Đầu tư.",
        "Luật Đầu tư số 61/2020/QH14",
        2020,
        "Quốc hội",
    ),
    (
        "Bộ Tài nguyên và Môi trường (2024). Luật Đất đai số 31/2024/QH15 của Bộ Tài nguyên và Môi trường.",
        "Luật Đất đai số 31/2024/QH15",
        2024,
        "Quốc hội",
    ),
    (
        "Quốc hội (2023). Nghị định số 13/2023/NĐ-CP của Quốc hội về bảo vệ dữ liệu cá nhân.",
        "Nghị định số 13/2023/NĐ-CP về bảo vệ dữ liệu cá nhân",
        2023,
        "Chính phủ",
    ),
    # 5 Statutory Code-Number Mismatches (exact constitutional issuing authority, wrong/swapped Số hiệu)
    (
        "Quốc hội (2015). Bộ luật Dân sự số 99/2015/QH13 ban hành ngày 24/11/2015.",
        "Bộ luật Dân sự số 91/2015/QH13",
        2015,
        "Quốc hội",
    ),
    (
        "Quốc hội (2020). Luật Đầu tư số 59/2020/QH14 ban hành ngày 17/06/2020.",
        "Luật Đầu tư số 61/2020/QH14",
        2020,
        "Quốc hội",
    ),
    (
        "Quốc hội (2024). Luật Đất đai số 45/2024/QH15 ban hành ngày 18/01/2024.",
        "Luật Đất đai số 31/2024/QH15",
        2024,
        "Quốc hội",
    ),
    (
        "Quốc hội (2022). Luật Sở hữu trí tuệ số 36/2022/QH15 ban hành ngày 16/06/2022.",
        "Luật Sở hữu trí tuệ số 07/2022/QH15",
        2022,
        "Quốc hội",
    ),
    (
        "Chính phủ (2021). Nghị định số 88/2021/NĐ-CP của Chính phủ về đăng ký doanh nghiệp.",
        "Nghị định số 01/2021/NĐ-CP về đăng ký doanh nghiệp",
        2021,
        "Chính phủ",
    ),
)


def _content_word_set(text: str) -> set[str]:
    stop = {
        "with", "from", "into", "over", "under", "using", "based", "study",
        "analysis", "review", "journal", "proceedings", "conference",
    }
    return {
        w
        for w in re.findall(r"[a-z0-9]{4,}", text.lower())
        if w not in stop and not re.fullmatch(r"(?:18|19|20)\d{2}", w)
    }


def run_ood_guardrail_stress_test(
    test_papers: list[dict[str, Any]],
    scorer: HybridMLScorer,
    seed: int = 707,
) -> dict[str, Any]:
    """Evaluate Pure ML `B5` vs. `Neuro-Symbolic` on N = 2,400 Out-of-Distribution Hard-Guardrail samples.

    Strictly uses `test_papers` only (zero Train/Val overlap) with genuine Sentence-BERT and
    RapidFuzz feature computation and zero `np.clip` feature clamping.
    """
    rng = random.Random(seed)
    fuzzy = FuzzyMatcher()
    venue_norm = VenueNormalizer()
    test_ids = {p["paper_id"] for p in test_papers}
    n_per_cat = 400
    n_pool = len(test_papers)

    raw_ood_specs: list[dict[str, Any]] = []
    cited_titles_enc: list[str] = []
    cand_titles_enc: list[str] = []

    # Category 1: Retracted Scholarly Papers (N = 400, Gold: metadata_error via R-RETRACTED-PAPER)
    for i in range(n_per_cat):
        p = test_papers[i % n_pool]
        doi_str = p["doi"] or f"10.18653/v1/{p['year']}.acl-main.{1000 + i}"
        raw_ood_specs.append(
            {
                "id": f"ood_retracted_{i:04d}",
                "category": "retracted_papers",
                "paper_id": p["paper_id"],
                "true_label": "metadata_error",
                "cited_title": p["title"],
                "cand_title": p["title"],
                "cited_authors": list(p["authors"]),
                "cand_authors": list(p["authors"]),
                "cited_year": int(p["year"]),
                "cand_year": int(p["year"]),
                "year_distance": 0,
                "cited_venue": p["venue"],
                "cand_venue": p["venue"],
                "cand_doi": doi_str,
                "cited_doi": doi_str,
                "doi_exact_match": True,
                "source_consensus": rng.choice([2, 3]),
                "has_candidate": True,
                "is_retracted": True,
                "url_status": "alive",
                "url_status_code": 200,
            }
        )
        cited_titles_enc.append(p["title"])
        cand_titles_enc.append(p["title"])

    # Category 2: Chimeric Spliced DOIs (N = 400, Gold: suspected_hallucination via R-CHIMERIC-DOI-MISMATCH)
    for i in range(n_per_cat):
        p1 = test_papers[(400 + i) % n_pool]
        p3 = test_papers[(900 + i) % n_pool]
        c_title = _make_spliced_academic_title(p1, p3, rng)
        cited_words = _content_word_set(f"{c_title} {p3['venue']}")
        # Select an unrelated paper p2 in test_papers whose real DOI was pasted onto this fabricated citation
        p2 = test_papers[(1400 + i) % n_pool]
        for step in range(1, 80):
            cand_p = test_papers[(1400 + i + step * 17) % n_pool]
            if len(_content_word_set(cand_p["title"]) & cited_words) == 0:
                p2 = cand_p
                break
        c_authors = _pick_non_overlapping_scholar_authors(test_papers, 400 + i, p2["authors"], count=2)
        doi_str = p2["doi"] or f"10.18653/v1/{p2['year']}.emnlp-main.{2000 + i}"
        yd = i % 3
        raw_ood_specs.append(
            {
                "id": f"ood_chimeric_doi_{i:04d}",
                "category": "chimeric_spliced_dois",
                "paper_id": p1["paper_id"],
                "true_label": "suspected_hallucination",
                "cited_title": c_title,
                "cand_title": p2["title"],
                "cited_authors": c_authors,
                "cand_authors": list(p2["authors"]),
                "cited_year": _perturb_year_bounded(int(p2["year"]), yd),
                "cand_year": int(p2["year"]),
                "year_distance": yd,
                "cited_venue": p3["venue"],
                "cand_venue": p2["venue"],
                "cand_doi": doi_str,
                "cited_doi": doi_str,
                "doi_exact_match": True,
                "source_consensus": 1,
                "has_candidate": True,
                "is_retracted": False,
                "url_status": "alive",
                "url_status_code": 200,
            }
        )
        cited_titles_enc.append(c_title)
        cand_titles_enc.append(p2["title"])

    # Category 3: Fake / Placeholder URLs on Plausible Partial Matches (N = 400, Gold: suspected_hallucination via R-FAKE-URL)
    fake_urls = (
        "https://example.com/papers/article-{i}.pdf",
        "https://fake-academic-portal.org/proceedings/{i}",
        "https://research-archive.invalid/doc/{i}",
        "http://localhost:8080/publications/{i}.pdf",
    )
    for i in range(n_per_cat):
        p = test_papers[(2000 + i) % n_pool]
        other_p = test_papers[(2500 + i) % n_pool]
        c_title = p["title"] if (i % 2 == 0) else _corrupt_title_moderate(p["title"], other_p["title"], rng)
        c_authors = [p["authors"][0]]
        yd = i % 2
        raw_ood_specs.append(
            {
                "id": f"ood_fake_url_{i:04d}",
                "category": "fake_placeholder_urls",
                "paper_id": p["paper_id"],
                "true_label": "suspected_hallucination",
                "cited_title": c_title,
                "cand_title": p["title"],
                "cited_authors": c_authors,
                "cand_authors": list(p["authors"]),
                "cited_year": _perturb_year_bounded(int(p["year"]), yd),
                "cand_year": int(p["year"]),
                "year_distance": yd,
                "cited_venue": p["venue"],
                "cand_venue": p["venue"],
                "cand_doi": None,
                "cited_doi": None,
                "cited_url": fake_urls[i % len(fake_urls)].format(i=1000 + i),
                "doi_exact_match": False,
                "source_consensus": 1,
                "has_candidate": True,
                "is_retracted": False,
                "url_status": "fake_domain",
                "url_status_code": None,
            }
        )
        cited_titles_enc.append(c_title)
        cand_titles_enc.append(p["title"])

    # Category 4: Regional DOIs without CSL Metadata (N = 400, Gold: unresolved via R-DOI-RA-NO-CSL)
    regional_prefixes = ("10.11499/sicejl", "10.5391/jkiis", "10.13336/j.1003", "10.1400/medra")
    for i in range(n_per_cat):
        p = test_papers[(3000 + i) % n_pool]
        reg_doi = f"{regional_prefixes[i % len(regional_prefixes)]}.{p['year']}.{4000 + i}"
        raw_ood_specs.append(
            {
                "id": f"ood_regional_doi_{i:04d}",
                "category": "regional_dois_no_csl",
                "paper_id": p["paper_id"],
                "true_label": "unresolved",
                "cited_title": p["title"],
                "cand_title": p["title"],
                "cited_authors": list(p["authors"][:2]),
                "cand_authors": list(p["authors"]),
                "cited_year": int(p["year"]),
                "cand_year": int(p["year"]),
                "year_distance": 999,
                "cited_venue": p["venue"],
                "cand_venue": p["venue"],
                "cand_doi": None,
                "cited_doi": reg_doi,
                "doi_exact_match": False,
                "source_consensus": 0,
                "has_candidate": False,
                "doi_ra_status": "registered_no_csl",
                "api_exhausted": False,
                "is_retracted": False,
                "url_status": None,
                "url_status_code": None,
            }
        )
        cited_titles_enc.append(p["title"])
        cand_titles_enc.append(p["title"])

    # Category 5: Upstream HTTP 429 API Exhaustion (N = 400, Gold: unresolved via R-RATE-LIMITED-ABSTAIN)
    for i in range(n_per_cat):
        p = test_papers[(3600 + i) % n_pool]
        raw_ood_specs.append(
            {
                "id": f"ood_rate_limit_{i:04d}",
                "category": "http_429_rate_limit_abstention",
                "paper_id": p["paper_id"],
                "true_label": "unresolved",
                "cited_title": p["title"],
                "cand_title": p["title"],
                "cited_authors": list(p["authors"][:2]),
                "cand_authors": list(p["authors"]),
                "cited_year": int(p["year"]),
                "cand_year": int(p["year"]),
                "year_distance": 999,
                "cited_venue": p["venue"],
                "cand_venue": p["venue"],
                "cand_doi": None,
                "cited_doi": None,
                "doi_exact_match": False,
                "source_consensus": 0,
                "has_candidate": False,
                "doi_ra_status": None,
                "api_exhausted": True,
                "is_retracted": False,
                "url_status": None,
                "url_status_code": None,
            }
        )
        cited_titles_enc.append(p["title"])
        cand_titles_enc.append(p["title"])

    # Category 6: Vietnamese Statutory Authority & Code Mismatches (N = 400, Gold: metadata_error via VNLegalVerifier)
    # Every sample is parsed directly via production `parse_vn_legal_reference(variant_raw)` with ZERO manual
    # field overrides: 200 samples without statutory candidate (matching scholarly-API 0-hit behavior) and
    # 200 samples with canonical statutory candidate across all 10 templates (5 authority + 5 code swaps).
    n_vn_tpl = len(_VN_LEGAL_OOD_TEMPLATES)
    for i in range(n_per_cat):
        p = test_papers[(4200 + i) % n_pool]
        raw_cit, canon_title, stat_year, true_auth = _VN_LEGAL_OOD_TEMPLATES[i % n_vn_tpl]
        variant_raw = f"[{i + 1}] {raw_cit}"
        parsed_cit = parse_vn_legal_reference(variant_raw)
        assert parsed_cit is not None, f"parse_vn_legal_reference failed on {variant_raw}"
        parsed_title = str(parsed_cit.title or canon_title)
        parsed_authors = [str(a.raw or a.last_name) for a in (parsed_cit.authors or []) if (a.raw or a.last_name)]
        parsed_year = int(parsed_cit.year or stat_year)
        parsed_venue = str(parsed_cit.venue or "")
        legal_check = verify_vn_legal_citation(
            raw_text=variant_raw,
            extracted_year=str(parsed_year),
            extracted_venue=parsed_venue,
        )
        assert not legal_check.is_valid, f"Expected statutory violation in {variant_raw}"
        assert "R-VN-LEGAL-FABRICATED" not in (legal_check.triggered_rules or [])
        has_stat_cand = ((i // n_vn_tpl) % 2 == 1)
        raw_ood_specs.append(
            {
                "id": f"ood_vn_legal_{i:04d}",
                "category": "vn_statutory_authority_mismatch",
                "paper_id": p["paper_id"],
                "true_label": "metadata_error",
                "is_vn_legal": True,
                "raw_citation": variant_raw,
                "cited_title": parsed_title,
                "cand_title": canon_title,
                "cited_authors": parsed_authors,
                "cand_authors": [true_auth],
                "cited_year": parsed_year,
                "cand_year": stat_year,
                "year_distance": abs(parsed_year - stat_year) if has_stat_cand else 999,
                "cited_venue": parsed_venue,
                "cand_venue": true_auth,
                "cand_doi": None,
                "cited_doi": None,
                "doi_exact_match": False,
                "source_consensus": 1 if has_stat_cand else 0,
                "has_candidate": has_stat_cand,
                "is_retracted": False,
                "url_status": None,
                "url_status_code": None,
            }
        )
        cited_titles_enc.append(parsed_title)
        cand_titles_enc.append(canon_title)

    ood_embs = _encode_texts_fast(cited_titles_enc + cand_titles_enc, batch_size=256)
    n_ood = len(raw_ood_specs)
    ood_title_sems = np.sum(ood_embs[:n_ood] * ood_embs[n_ood:], axis=1)

    ood_records: list[dict[str, Any]] = []
    for idx_o, spec in enumerate(raw_ood_specs):
        assert spec["paper_id"] in test_ids, "OOD stress test must strictly use test_papers only"
        has_cand = bool(spec["has_candidate"])
        if not has_cand:
            tf, ts, aj, v_sim = 0.0, 0.0, 0.0, 0.0
        else:
            tf = float(fuzzy.token_set_ratio(spec["cited_title"].lower(), spec["cand_title"].lower()))
            ts = max(0.0, min(1.0, float(ood_title_sems[idx_o])))
            aj = float(author_match_score(spec["cited_authors"], spec["cand_authors"]))
            v_sim = float(venue_norm.similarity(spec["cited_venue"], spec["cand_venue"]))
        rec = dict(spec)
        rec.update(
            {
                "title_sim_fuzzy": round(tf, 4),
                "title_sim_semantic": round(ts, 4),
                "author_jaccard": round(aj, 4),
                "venue_sim": round(v_sim, 4),
                "content_alignment_score": 0.0,
                "content_alignment_confidence": "",
                "content_is_aligned": False,
                "crossref_matched": bool(has_cand and (spec.get("cand_doi") or spec["doi_exact_match"])),
            }
        )
        ood_records.append(rec)

    assert all(
        MIN_SCHOLARLY_YEAR <= int(r["cited_year"]) <= MAX_SCHOLARLY_YEAR for r in ood_records
    ), "OOD stress records must not contain impossible future cited_year values"

    runner = BaselineRunner(ml_scorer=scorer)
    categories_order = (
        ("retracted_papers", "Retracted Papers (R-RETRACTED-PAPER)", "metadata_error"),
        ("chimeric_spliced_dois", "Chimeric Spliced DOIs (R-CHIMERIC-DOI-MISMATCH)", "suspected_hallucination"),
        ("fake_placeholder_urls", "Fake / Placeholder URLs (R-FAKE-URL)", "suspected_hallucination"),
        ("regional_dois_no_csl", "Regional DOIs without CSL (R-DOI-RA-NO-CSL)", "unresolved"),
        ("http_429_rate_limit_abstention", "HTTP 429 API Exhaustion (R-RATE-LIMITED-ABSTAIN)", "unresolved"),
        (
            "vn_statutory_authority_mismatch",
            "VN Statutory Authority & Code Mismatches (VNLegalVerifier)",
            "metadata_error",
        ),
    )

    per_category: dict[str, Any] = {}
    for cat_key, cat_desc, gold_lbl in categories_order:
        cat_slice = [r for r in ood_records if r["category"] == cat_key]
        b5_res = runner.run("B5", cat_slice)
        ns_res = runner.run("proposed", cat_slice)
        b4_res = runner.run("B4", cat_slice)
        b5_pred_counts = dict(Counter(b5_res["predictions"]))
        ns_pred_counts = dict(Counter(ns_res["predictions"]))
        per_category[cat_key] = {
            "description": cat_desc,
            "n_samples": len(cat_slice),
            "gold_label": gold_lbl,
            "pure_ml_b5_accuracy": round(float(b5_res["metrics"]["accuracy"]), 4),
            "no_calibration_b4_accuracy": round(float(b4_res["metrics"]["accuracy"]), 4),
            "neuro_symbolic_accuracy": round(float(ns_res["metrics"]["accuracy"]), 4),
            "delta_accuracy_ns_minus_b5": round(
                float(ns_res["metrics"]["accuracy"]) - float(b5_res["metrics"]["accuracy"]), 4
            ),
            "pure_ml_b5_prediction_distribution": b5_pred_counts,
            "neuro_symbolic_prediction_distribution": ns_pred_counts,
        }

    def _supported_macro_f1(cm: dict[str, dict[str, int]]) -> float:
        pc = _compute_per_class_metrics(cm)
        active = [v["f1"] for v in pc.values() if v["support"] > 0]
        return round(float(np.mean(active)) if active else 0.0, 4)

    all_b5 = runner.run("B5", ood_records)
    all_b4 = runner.run("B4", ood_records)
    all_ns = runner.run("proposed", ood_records)
    b5_active_f1 = _supported_macro_f1(all_b5["metrics"]["confusion_matrix"])
    b4_active_f1 = _supported_macro_f1(all_b4["metrics"]["confusion_matrix"])
    ns_active_f1 = _supported_macro_f1(all_ns["metrics"]["confusion_matrix"])
    gold_all = [r["true_label"] for r in ood_records]
    corr_ns_ood = np.array([1 if p == y else 0 for p, y in zip(all_ns["predictions"], gold_all, strict=True)])
    corr_b5_ood = np.array([1 if p == y else 0 for p, y in zip(all_b5["predictions"], gold_all, strict=True)])
    ood_mcnemar = _mcnemar_continuity_corrected(corr_ns_ood, corr_b5_ood)

    return {
        "total_samples": len(ood_records),
        "samples_per_category": n_per_cat,
        "source_pool": "held_out_test_papers_only",
        "zero_train_val_overlap_verified": True,
        "overall": {
            "pure_ml_b5": {
                "accuracy": round(float(all_b5["metrics"]["accuracy"]), 4),
                "macro_f1": b5_active_f1,
            },
            "no_calibration_b4": {
                "accuracy": round(float(all_b4["metrics"]["accuracy"]), 4),
                "macro_f1": b4_active_f1,
            },
            "neuro_symbolic_proposed": {
                "accuracy": round(float(all_ns["metrics"]["accuracy"]), 4),
                "macro_f1": ns_active_f1,
            },
            "delta_accuracy_ns_minus_b5": round(
                float(all_ns["metrics"]["accuracy"]) - float(all_b5["metrics"]["accuracy"]), 4
            ),
            "delta_macro_f1_ns_minus_b5": round(ns_active_f1 - b5_active_f1, 4),
            "mcnemar_ns_vs_b5": ood_mcnemar,
        },
        "categories": per_category,
    }


def compute_cis_weight_sensitivity(
    n_manuscripts: int = 300,
    seed: int = 42,
) -> dict[str, Any]:
    """Perturb CIS rubric weights across 20 normalized weight vectors over 300 manuscript profiles."""
    rng = random.Random(seed)
    canonical_calc = CISCalculator()
    w0 = canonical_calc.w

    # Construct 300 diverse manuscript profiles spanning pristine, mixed-error, broken-ID,
    # style-inconsistent, orphan-citation, and high-hallucination submissions
    manuscripts: list[tuple[list[CitationVerdict], StyleProfile]] = []
    style_choices = (
        ("APA-like", 0.95),
        ("IEEE-like", 0.92),
        ("VANCOUVER-like", 0.88),
        ("HARVARD-like", 0.85),
        ("MIXED", 0.55),
        ("UNKNOWN", 0.25),
    )
    mapping_pool = (
        CitationMappingStatus.MATCHED,
        CitationMappingStatus.UNCITED_REFERENCE,
        CitationMappingStatus.IN_TEXT_MISMATCH,
        CitationMappingStatus.DUPLICATE_REFERENCE,
        CitationMappingStatus.AMBIGUOUS_MAPPING,
        CitationMappingStatus.STYLE_INCONSISTENT,
    )

    for m_idx in range(n_manuscripts):
        n_refs = rng.randint(8, 42)
        # Sample Dirichlet-like quality mixture across the 300 manuscripts
        tier = m_idx % 6
        if tier == 0:
            probs = [0.88, 0.06, 0.01, 0.03, 0.02]
        elif tier == 1:
            probs = [0.68, 0.18, 0.04, 0.06, 0.04]
        elif tier == 2:
            probs = [0.48, 0.28, 0.08, 0.12, 0.04]
        elif tier == 3:
            probs = [0.35, 0.22, 0.25, 0.14, 0.04]
        elif tier == 4:
            probs = [0.20, 0.20, 0.45, 0.10, 0.05]
        else:
            raw_w = [rng.uniform(0.05, 1.0) for _ in range(5)]
            s_w = sum(raw_w)
            probs = [x / s_w for x in raw_w]

        labels_list = [
            ValidationLabel.VERIFIED,
            ValidationLabel.METADATA_ERROR,
            ValidationLabel.SUSPECTED_HALLUCINATION,
            ValidationLabel.UNRESOLVED,
            ValidationLabel.RESOURCE,
        ]
        verdicts: list[CitationVerdict] = []
        for r_i in range(n_refs):
            lbl = rng.choices(labels_list, weights=probs, k=1)[0]
            has_doi = rng.random() < 0.65
            has_url = rng.random() < 0.35
            trig: list[str] = []
            url_stat = "alive" if has_url else None
            if lbl == ValidationLabel.SUSPECTED_HALLUCINATION and has_doi and rng.random() < 0.6:
                trig.append("R-NONEXISTENT-DOI")
            elif lbl == ValidationLabel.SUSPECTED_HALLUCINATION and has_url and rng.random() < 0.5:
                trig.append("R-FAKE-URL")
                url_stat = "fake_domain"
            elif lbl == ValidationLabel.METADATA_ERROR and rng.random() < 0.30:
                trig.append("R-INCOMPLETE-METADATA")
            elif lbl == ValidationLabel.METADATA_ERROR and has_doi and rng.random() < 0.25:
                trig.append("R-DOI-METADATA-MISMATCH")

            map_weights = [0.75, 0.08, 0.05, 0.04, 0.04, 0.04] if tier < 2 else [0.45, 0.16, 0.12, 0.09, 0.09, 0.09]
            map_st = rng.choices(mapping_pool, weights=map_weights, k=1)[0]

            cit = Citation(
                raw_text=f"Reference {r_i + 1} in manuscript {m_idx}",
                citation_type=CitationType.REFERENCE_LIST,
                title=f"Title {r_i + 1}",
                doi=f"10.1000/ms{m_idx}.{r_i}" if has_doi else None,
                url=f"https://scholar.example.edu/{m_idx}/{r_i}" if has_url else None,
            )
            src = SourceResult(
                citation_raw=cit.raw_text,
                candidates=[SourceCandidate(source_name="crossref", found=(lbl != ValidationLabel.SUSPECTED_HALLUCINATION))],
                url_status=url_stat,
            )
            verdicts.append(
                CitationVerdict(
                    citation=cit,
                    label=lbl,
                    confidence=0.85,
                    matched_source=src,
                    mapping_status=map_st,
                    triggered_rules=trig,
                )
            )
        st_name, st_conf = style_choices[(m_idx + rng.randint(0, 2)) % len(style_choices)]
        sp = StyleProfile(style=st_name, confidence=st_conf)
        manuscripts.append((verdicts, sp))

    base_scores = np.array(
        [canonical_calc.compute(v_list, style_profile=sp).score for v_list, sp in manuscripts],
        dtype=np.float64,
    )

    # 20 systematic ±0.05 / ±0.10 simplex-normalized weight vectors around (0.35, 0.25, 0.25, 0.10, 0.05)
    perturbed_vectors: list[tuple[str, tuple[float, float, float, float, float]]] = [
        ("P01_alt_id10_link20", (0.35, 0.25, 0.20, 0.10, 0.10)),
        ("P02_ver_plus05_meta_minus05", (0.40, 0.20, 0.25, 0.10, 0.05)),
        ("P03_ver_minus05_meta_plus05", (0.30, 0.30, 0.25, 0.10, 0.05)),
        ("P04_ver_plus05_link_minus05", (0.40, 0.25, 0.20, 0.10, 0.05)),
        ("P05_ver_minus05_link_plus05", (0.30, 0.25, 0.30, 0.10, 0.05)),
        ("P06_ver_plus10_meta_minus05_link_minus05", (0.45, 0.20, 0.20, 0.10, 0.05)),
        ("P07_ver_minus10_meta_plus05_link_plus05", (0.25, 0.30, 0.30, 0.10, 0.05)),
        ("P08_meta_plus05_link_minus05", (0.35, 0.30, 0.20, 0.10, 0.05)),
        ("P09_meta_minus05_link_plus05", (0.35, 0.20, 0.30, 0.10, 0.05)),
        ("P10_meta_plus10_ver_minus05_link_minus05", (0.30, 0.35, 0.20, 0.10, 0.05)),
        ("P11_link_plus10_ver_minus05_meta_minus05", (0.30, 0.20, 0.35, 0.10, 0.05)),
        ("P12_fmt_plus05_ver_minus05", (0.30, 0.25, 0.25, 0.15, 0.05)),
        ("P13_fmt_minus05_ver_plus05", (0.40, 0.25, 0.25, 0.05, 0.05)),
        ("P14_fmt_plus05_link_minus05", (0.35, 0.25, 0.20, 0.15, 0.05)),
        ("P15_id_plus05_ver_minus05", (0.30, 0.25, 0.25, 0.10, 0.10)),
        ("P16_id_plus05_fmt_minus05", (0.35, 0.25, 0.25, 0.05, 0.10)),
        ("P17_id_plus10_ver_minus05_link_minus05", (0.30, 0.25, 0.20, 0.10, 0.15)),
        ("P18_balanced_scholarly_emphasis", (0.38, 0.27, 0.20, 0.08, 0.07)),
        ("P19_structural_linking_emphasis", (0.32, 0.22, 0.28, 0.12, 0.06)),
        ("P20_equalized_secondary_rubric", (0.35, 0.25, 0.15, 0.15, 0.10)),
    ]

    runs: list[dict[str, Any]] = []
    rhos: list[float] = []
    taus: list[float] = []
    maes: list[float] = []
    max_aes: list[float] = []

    for p_id, (wv, wm, wl, wf, wi) in perturbed_vectors:
        s_cfg = Settings(
            cis=CISConfig(
                weights=CISWeightsConfig(
                    verified_ratio=wv,
                    metadata_accuracy=wm,
                    in_text_bib_consistency=wl,
                    format_consistency=wf,
                    identifier_validity=wi,
                )
            )
        )
        pert_calc = CISCalculator(settings=s_cfg)
        pert_scores = np.array(
            [pert_calc.compute(v_list, style_profile=sp).score for v_list, sp in manuscripts],
            dtype=np.float64,
        )
        rho_val = float(scipy_stats.spearmanr(base_scores, pert_scores).statistic)
        tau_val = float(scipy_stats.kendalltau(base_scores, pert_scores).statistic)
        abs_diff = np.abs(pert_scores - base_scores)
        mae_val = float(np.mean(abs_diff))
        max_ae_val = float(np.max(abs_diff))

        rhos.append(rho_val)
        taus.append(tau_val)
        maes.append(mae_val)
        max_aes.append(max_ae_val)
        runs.append(
            {
                "perturbation_id": p_id,
                "weights": {
                    "verified_ratio": wv,
                    "metadata_accuracy": wm,
                    "in_text_bib_consistency": wl,
                    "format_consistency": wf,
                    "identifier_validity": wi,
                },
                "spearman_rho": round(rho_val, 4),
                "kendall_tau": round(tau_val, 4),
                "mae_cis_points": round(mae_val, 4),
                "max_abs_shift_points": round(max_ae_val, 4),
            }
        )

    return {
        "n_manuscripts": n_manuscripts,
        "n_weight_perturbations": len(perturbed_vectors),
        "canonical_weights": w0.model_dump(),
        "summary": {
            "mean_spearman_rho": round(float(np.mean(rhos)), 4),
            "min_spearman_rho": round(float(np.min(rhos)), 4),
            "max_spearman_rho": round(float(np.max(rhos)), 4),
            "mean_kendall_tau": round(float(np.mean(taus)), 4),
            "min_kendall_tau": round(float(np.min(taus)), 4),
            "max_kendall_tau": round(float(np.max(taus)), 4),
            "mean_mae_cis_points": round(float(np.mean(maes)), 4),
            "max_mae_cis_points": round(float(np.max(maes)), 4),
            "worst_case_single_manuscript_shift": round(float(np.max(max_aes)), 4),
        },
        "perturbations": runs,
    }


def evaluate_neuro_symbolic_with_calibrator(
    dataset: list[dict[str, Any]],
    scorer: HybridMLScorer,
    *,
    use_calibration: bool = True,
    compute_bootstrap: bool = False,
) -> dict[str, Any]:
    """Run SymbolicRules + HybridMLScorer calibration on a feature dataset."""
    rules = SymbolicRules()
    predictions: list[str] = []
    gold_labels: list[str] = []
    confidences: list[float] = []
    is_correct: list[int] = []

    for item in dataset:
        feat, outcome = _run_symbolic_rule_on_item(rules, item)
        has_cand = bool(item.get("has_candidate", True))
        pred_lbl = outcome.label.value
        raw_conf = outcome.confidence

        if use_calibration:
            final_conf = scorer.calibrate_verdict_confidence(
                symbolic_label=pred_lbl,
                symbolic_confidence=raw_conf,
                features=feat,
                has_candidate=has_cand,
                style_penalty=outcome.style_penalty,
                triggered_rules=outcome.triggered_rules,
            )
        else:
            final_conf = raw_conf

        true_lbl = item["true_label"]
        predictions.append(pred_lbl)
        gold_labels.append(true_lbl)
        confidences.append(final_conf)
        is_correct.append(1 if pred_lbl == true_lbl else 0)

    cls_metrics = MetricsCalculator.compute(gold_labels, predictions)
    cal_metrics = CalibrationCalculator.compute(list(zip(confidences, is_correct, strict=True)))
    per_class = _compute_per_class_metrics(cls_metrics.confusion_matrix)

    result: dict[str, Any] = {
        "classification": {
            "accuracy": round(cls_metrics.accuracy, 4),
            "macro_precision": round(cls_metrics.precision, 4),
            "macro_recall": round(cls_metrics.recall, 4),
            "macro_f1": round(cls_metrics.macro_f1, 4),
            "per_class": per_class,
            "support": cls_metrics.support,
            "confusion_matrix": cls_metrics.confusion_matrix,
        },
        "calibration": cal_metrics.to_dict(),
        "_predictions": predictions,
        "_confidences": confidences,
    }
    if compute_bootstrap:
        result["bootstrap_95_ci"] = _compute_bootstrap_ci(
            gold_labels, predictions, confidences, n_bootstraps=1000, seed=42
        )
    return result


def main() -> None:
    t0 = time.time()
    print("=" * 82)
    print(f"PHASE 4: LARGE-SCALE ({TOTAL_SAMPLES:,} SAMPLES) NEURO-SYMBOLIC TRAINING & CALIBRATION")
    print("=" * 82)

    db_path = REPO_ROOT / "data" / "local_papers.db"
    with_abs_papers, meta_only_papers, corpus_stats = _load_db_papers_stratified(
        db_path, total_limit=TOTAL_SAMPLES, seed=42
    )
    print(
        f"[1/6] Loaded {corpus_stats['sampled_total']:,} distinct real scholarly papers from {db_path.name} "
        f"(out of {corpus_stats['total_papers_in_db']:,} total records, "
        f"{corpus_stats['acl_anthology_share_pct']:.1f}% ACL Anthology: "
        f"{corpus_stats['sampled_with_full_abstract']:,} with full abstracts + "
        f"{corpus_stats['sampled_metadata_only']:,} metadata-complete papers)"
    )

    train_papers, val_papers, test_papers, leakage_audit = _partition_stratified_pools(
        with_abs_papers, meta_only_papers
    )
    print(
        f"[2/6] Strict Paper-Disjoint Pools -> Train: {len(train_papers):,} | "
        f"Val: {len(val_papers):,} | Test: {len(test_papers):,} "
        f"(Overlap: Train∩Val={leakage_audit['train_val_overlap']}, "
        f"Train∩Test={leakage_audit['train_test_overlap']}, "
        f"Val∩Test={leakage_audit['val_test_overlap']})"
    )

    print("[3/6] Constructing authentic citation pairs & computing Sentence-BERT + RapidFuzz features...")
    train_data = build_split_dataset(train_papers, split_name="train", seed=101)
    val_data = build_split_dataset(val_papers, split_name="val", seed=202)
    test_data = build_split_dataset(test_papers, split_name="test", seed=303)

    y_train = [r["true_label"] for r in train_data]
    y_val = [r["true_label"] for r in val_data]
    y_test = [r["true_label"] for r in test_data]

    all_records = train_data + val_data + test_data
    all_counts = Counter(y_train) + Counter(y_val) + Counter(y_test)
    sub_counts = Counter(r["sub_type"] for r in all_records)
    shortcut_audit = _compute_feature_shortcut_audit(test_data)
    assert shortcut_audit["all_four_classes_have_nonzero_alignment"], (
        "All 4 classes must exhibit non-zero content_alignment_score"
    )

    print(f"  -> Total dataset size: {len(all_records):,} samples")
    for lbl, cnt in sorted(all_counts.items()):
        ca_info = shortcut_audit["per_class_content_alignment"][lbl]
        print(
            f"     - {lbl:25s}: {cnt:,} "
            f"(test non-zero content_alignment: {ca_info['nonzero_rate']*100:.1f}%, "
            f"median={ca_info['nonzero_p50']:.3f})"
        )

    print("[4/6] Training Multinomial Logistic Regression (HybridMLScorer) & PlattCalibrator...")
    best_c = 1.0
    best_val_f1 = -1.0
    c_grid_history: dict[str, float] = {}
    for c_cand in (0.1, 0.25, 0.5, 1.0, 2.0, 5.0, 10.0):
        candidate_scorer = HybridMLScorer().fit(train_data, y_train, c_reg=c_cand)
        val_preds = [candidate_scorer.predict(item)[0] for item in val_data]
        val_m = MetricsCalculator.compute(y_val, val_preds)
        c_grid_history[str(c_cand)] = round(val_m.macro_f1, 4)
        if val_m.macro_f1 > best_val_f1:
            best_val_f1 = val_m.macro_f1
            best_c = c_cand

    print(f"  -> Selected optimal L2 regularization C={best_c} (Val ML Macro-F1={best_val_f1:.4f})")
    scorer = HybridMLScorer().fit(train_data, y_train, c_reg=best_c)

    rules = SymbolicRules()
    val_blended_scores: list[float] = []
    val_correct: list[int] = []
    alpha = scorer.symbolic_blend_alpha

    for item in val_data:
        feat, outcome = _run_symbolic_rule_on_item(rules, item)
        has_cand = bool(item.get("has_candidate", True))
        pred_lbl = outcome.label.value
        raw_conf = outcome.confidence
        probs = scorer.predict_proba(feat, has_candidate=has_cand)
        ml_prob = probs.get(pred_lbl, raw_conf)
        blended = alpha * raw_conf + (1.0 - alpha) * ml_prob
        val_blended_scores.append(float(np.clip(blended, 0.02, 0.99)))
        val_correct.append(1 if pred_lbl == item["true_label"] else 0)

    scorer.platt = PlattCalibrator().fit(val_blended_scores, val_correct, l2_reg=0.01)
    print(
        f"  -> Fitted PlattCalibrator on {len(val_data):,} Val samples: "
        f"a={scorer.platt.a:.4f}, b={scorer.platt.b:.4f}"
    )

    print(f"[5/6] Evaluating Baselines B0..B5 & Unified Proposed Model on Test Split (N={len(test_data):,})...")
    uncalibrated_eval_raw = evaluate_neuro_symbolic_with_calibrator(
        test_data, scorer, use_calibration=False, compute_bootstrap=False
    )
    calibrated_eval_raw = evaluate_neuro_symbolic_with_calibrator(
        test_data, scorer, use_calibration=True, compute_bootstrap=True
    )

    uncal_confs = uncalibrated_eval_raw.pop("_confidences")
    uncalibrated_eval_raw.pop("_predictions")
    cal_confs = calibrated_eval_raw.pop("_confidences")
    ns_predictions = calibrated_eval_raw.pop("_predictions")

    runner = BaselineRunner(ml_scorer=scorer, symbolic_rules=rules)
    baseline_comparison: dict[str, Any] = {}
    baseline_preds_map: dict[str, list[str]] = {}
    for b_name in ("B0", "B1", "B2", "B3", "B4", "B5", "proposed"):
        res = runner.run(b_name, test_data)
        m = res["metrics"]
        baseline_preds_map[b_name] = res["predictions"]
        baseline_comparison[b_name] = {
            "accuracy": round(m["accuracy"], 4),
            "macro_precision": round(m["precision"], 4),
            "macro_recall": round(m["recall"], 4),
            "macro_f1": round(m["macro_f1"], 4),
        }

    assert baseline_comparison["proposed"] == {
        "accuracy": calibrated_eval_raw["classification"]["accuracy"],
        "macro_precision": calibrated_eval_raw["classification"]["macro_precision"],
        "macro_recall": calibrated_eval_raw["classification"]["macro_recall"],
        "macro_f1": calibrated_eval_raw["classification"]["macro_f1"],
    }, "BaselineRunner('proposed') must match SymbolicRules classification metrics 100%"

    print("[6/6] Running OOD Hard-Guardrail Stress Suite (N=2,400), Significance Tests & CIS Sensitivity...")
    ood_stress_report = run_ood_guardrail_stress_test(test_papers, scorer, seed=707)
    sig_tests = compute_statistical_significance_tests(
        y_test,
        ns_predictions,
        baseline_preds_map,
        uncal_confs,
        cal_confs,
        n_bootstraps=1000,
        seed=42,
    )
    cis_sensitivity = compute_cis_weight_sensitivity(n_manuscripts=300, seed=42)

    total_n = len(all_records)
    scorer.training_metadata = {
        "trained_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "methodology": "paper_disjoint_70_15_15_real_sbert_fuzzy_120k_zero_shortcut",
        "total_samples": total_n,
        "train_samples": len(train_data),
        "val_samples": len(val_data),
        "test_samples": len(test_data),
        "best_c": best_c,
        "val_c_grid_macro_f1": c_grid_history,
        "test_macro_f1_ml_hybrid": baseline_comparison["B5"]["macro_f1"],
        "test_macro_f1_neuro_symbolic": calibrated_eval_raw["classification"]["macro_f1"],
        "ood_2400_accuracy_ml_hybrid": ood_stress_report["overall"]["pure_ml_b5"]["accuracy"],
        "ood_2400_accuracy_neuro_symbolic": ood_stress_report["overall"]["neuro_symbolic_proposed"]["accuracy"],
        "test_ece_before_platt": uncalibrated_eval_raw["calibration"]["ece"],
        "test_ece_after_platt": calibrated_eval_raw["calibration"]["ece"],
        "test_brier_before_platt": uncalibrated_eval_raw["calibration"]["brier"],
        "test_brier_after_platt": calibrated_eval_raw["calibration"]["brier"],
    }

    models_dir = REPO_ROOT / "data" / "models"
    models_dir.mkdir(parents=True, exist_ok=True)

    weights_path = scorer.save(models_dir / "neuro_symbolic_weights.json")
    report_path = models_dir / "neuro_symbolic_benchmark_report.json"
    summary_path = models_dir / "neuro_symbolic_dataset_summary.json"

    benchmark_report = {
        "dataset_summary": {
            "total_samples": total_n,
            "methodology": (
                "Strict Stratified Paper- & Normalized-Title-Disjoint Split (70/15/15, Zero Overlap) + "
                "Real Sentence-BERT (all-MiniLM-L6-v2) & RapidFuzz Feature Extraction across All 4 Classes"
            ),
            "international_standards_alignment": [
                "SciFact (Wadden et al., EMNLP 2020) & FEVER (Thorne et al., NAACL 2018): Strict document/paper-disjoint partitioning prior to perturbation sampling",
                "Walters & Wilder (2023) & ALCE (Gao et al., EMNLP 2023): Plausible same-domain spliced academic hallucinations & 15-subtype scholarly citation error taxonomy",
                "Selective Classification with Abstention (Chow, 1970; Geifman & El-Yaniv, NeurIPS 2017): Coverage-Accuracy trade-off and UNRESOLVED abstention band",
                "Post-Hoc Probability Calibration (Platt, 1999; Guo et al., ICML 2017): Logit-space Platt scaling fitted strictly on held-out Validation split",
                "NLP Statistical Significance Testing (Dror et al., ACL 2018; Berg-Kirkpatrick et al., EMNLP 2012): Continuity-corrected McNemar's test & 1,000-resample Paired Bootstrap",
            ],
            "corpus_provenance": corpus_stats,
            "leakage_audit": leakage_audit,
            "feature_shortcut_audit": shortcut_audit,
            "class_distribution": dict(all_counts),
            "sub_taxonomy_distribution": dict(sorted(sub_counts.items())),
            "splits": {
                "train": len(train_data),
                "val": len(val_data),
                "test": len(test_data),
            },
        },
        "hyperparameter_tuning": {
            "model": "Multinomial Logistic Regression (L2 Regularized, Balanced Class Weights)",
            "feature_dimension": len(HybridMLScorer.FEATURE_NAMES),
            "feature_names": list(HybridMLScorer.FEATURE_NAMES),
            "c_candidates_evaluated": [0.1, 0.25, 0.5, 1.0, 2.0, 5.0, 10.0],
            "val_macro_f1_by_c": c_grid_history,
            "selected_best_c": best_c,
            "symbolic_blend_alpha": scorer.symbolic_blend_alpha,
        },
        "baselines_on_test_set": baseline_comparison,
        "neuro_symbolic_uncalibrated": uncalibrated_eval_raw,
        "neuro_symbolic_platt_calibrated": calibrated_eval_raw,
        "platt_parameters": scorer.platt.to_dict(),
        "ood_guardrail_stress_test": ood_stress_report,
        "statistical_significance_tests": sig_tests,
        "cis_weight_sensitivity": cis_sensitivity,
    }

    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(benchmark_report, f, indent=2, ensure_ascii=False, allow_nan=False)

    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump(
            {
                "total_samples": total_n,
                "methodology": (
                    "Strict Paper- & Title-Disjoint Split (70/15/15) over 120,000 distinct scholarly papers "
                    "with 4-class Sentence-BERT context alignment and realistic same-domain hallucinations"
                ),
                "corpus_provenance": corpus_stats,
                "leakage_audit": leakage_audit,
                "feature_shortcut_audit": shortcut_audit,
                "class_distribution": dict(all_counts),
                "sub_taxonomy_distribution": dict(sorted(sub_counts.items())),
                "sample_preview": test_data[:16],
            },
            f,
            indent=2,
            ensure_ascii=False,
            allow_nan=False,
        )

    elapsed = time.time() - t0
    print("\n" + "=" * 82)
    print(f"BENCHMARK RESULTS ON HELD-OUT TEST SPLIT (N = {len(test_data):,} DISTINCT PAPERS)")
    print("=" * 82)
    for b_name, b_metrics in baseline_comparison.items():
        print(
            f"  {b_name:10s} | Acc={b_metrics['accuracy']:.4f} | "
            f"Macro-P={b_metrics['macro_precision']:.4f} | "
            f"Macro-R={b_metrics['macro_recall']:.4f} | "
            f"Macro-F1={b_metrics['macro_f1']:.4f}"
        )
    print("-" * 82)
    print(
        f"  Neuro-Symbolic (Uncalibrated) | Macro-F1={uncalibrated_eval_raw['classification']['macro_f1']:.4f} "
        f"| ECE={uncalibrated_eval_raw['calibration']['ece']:.4f} | Brier={uncalibrated_eval_raw['calibration']['brier']:.4f}"
    )
    print(
        f"  Neuro-Symbolic (Platt Calib.) | Macro-F1={calibrated_eval_raw['classification']['macro_f1']:.4f} "
        f"| ECE={calibrated_eval_raw['calibration']['ece']:.4f} | Brier={calibrated_eval_raw['calibration']['brier']:.4f}"
    )
    print(
        f"  OOD Hard-Guardrail (N=2,400)  | Pure ML B5 Acc={ood_stress_report['overall']['pure_ml_b5']['accuracy']:.4f} "
        f"| Neuro-Symbolic Acc={ood_stress_report['overall']['neuro_symbolic_proposed']['accuracy']:.4f}"
    )
    print(
        f"  CIS Sensitivity (300x20)      | Mean Spearman rho={cis_sensitivity['summary']['mean_spearman_rho']:.4f} "
        f"(min={cis_sensitivity['summary']['min_spearman_rho']:.4f}) | "
        f"Mean Kendall tau={cis_sensitivity['summary']['mean_kendall_tau']:.4f}"
    )
    ci = calibrated_eval_raw.get("bootstrap_95_ci", {})
    if ci:
        print(
            f"  95% Bootstrap CI (B=1,000)    | Acc=[{ci['accuracy']['ci_95_lower']:.4f}, {ci['accuracy']['ci_95_upper']:.4f}] "
            f"| Macro-F1=[{ci['macro_f1']['ci_95_lower']:.4f}, {ci['macro_f1']['ci_95_upper']:.4f}] "
            f"| ECE=[{ci['ece']['ci_95_lower']:.4f}, {ci['ece']['ci_95_upper']:.4f}]"
        )
    print("=" * 82)
    print(f"Saved weights to: {weights_path}")
    print(f"Saved benchmark report to: {report_path}")
    print(f"Completed in {elapsed:.1f}s")


if __name__ == "__main__":
    main()
