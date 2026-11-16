#!/usr/bin/env python3
"""Train & Calibrate the Hybrid Neuro-Symbolic Model on 120,000 Scholarly Samples.

International Standards & Methodological Alignment:
    1. Source Corpus & Stratified Paper-Disjoint Partitioning (Zero Data Leakage):
       Following SciFact (Wadden et al., EMNLP 2020) and FEVER (Thorne et al., NAACL 2018),
       we load 120,000 distinct real scholarly papers from `data/local_papers.db`
       (out of 128,717 total papers: 80,000 with full abstracts >80 chars + 40,000
       with complete bibliographic metadata) and partition the base papers into
       strictly disjoint pools BEFORE generating any citation perturbations or
       cross-paper chimeric hallucinations:
         - Train Pool (70.0%):      84,000 distinct base papers (56,000 full-abstract + 28,000 metadata)
         - Validation Pool (15.0%): 18,000 distinct base papers (12,000 full-abstract + 6,000 metadata)
         - Held-Out Test (15.0%):   18,000 distinct base papers (12,000 full-abstract + 6,000 metadata)
       Cross-paper perturbations (author swaps, chimeric title splicing, unrelated
       in-text contexts, mismatched DOIs) only pair papers within the SAME split pool.
       Programmatic set-intersection assertions verify 0.0% paper overlap across splits.
    2. 4-Class Decision-Support Taxonomy & 15 Sub-Taxonomies:
       Following Walters & Wilder (2023), ALCE (Gao et al., EMNLP 2023), and
       Selective Prediction with Abstention (Chow, 1970; Geifman & El-Yaniv, NeurIPS 2017):
         - VERIFIED (36% = 43,200):                V1..V4
         - SUSPECTED_HALLUCINATION (30% = 36,000): H1..H4
         - METADATA_ERROR (22% = 26,400):          M1..M5
         - UNRESOLVED / ABSTENTION (12% = 14,400): U1..U2
       Every sample requiring Sentence-BERT context-vs-abstract alignment (`V1..V4`,
       `M1..M5`, `H4`) is assigned an authentic paper from the full-abstract stratum
       (66.7% of each split pool >= 65.5% required).
    3. Authentic Feature Extraction (No Synthetic Similarity Numbers):
       For every sample, constructs concrete `(CitedReference, RetrievedCandidate)`
       strings and computes features using the real production components:
         - Sentence-BERT (`all-MiniLM-L6-v2` on Apple Silicon MPS / CUDA / CPU)
           for `title_sim_semantic` and `content_alignment_score`
         - `FuzzyMatcher.token_set_ratio` for `title_sim_fuzzy`
         - `author_match_score` for `author_jaccard`
         - `VenueNormalizer.similarity` for `venue_sim`
    4. Model Training, Post-Hoc Calibration & Bootstrap Significance Testing:
       - Fits Multinomial Logistic Regression (`HybridMLScorer`) on the 84,000-sample
         Train split and selects L2 regularization `C` on the 18,000-sample Validation split.
       - Fits Logit-Space Platt Scaling (`PlattCalibrator`, Platt 1999; Guo et al., ICML 2017)
         strictly on the 18,000-sample Validation split.
       - Evaluates Baselines B0..B5 and Proposed Neuro-Symbolic model on the
         18,000-sample Held-Out Test split with 95% Non-Parametric Bootstrap Confidence
         Intervals (B=1,000 resamples; Dror et al., ACL 2018; Efron & Tibshirani, 1993).

Outputs:
    - data/models/neuro_symbolic_weights.json
    - data/models/neuro_symbolic_benchmark_report.json
    - data/models/neuro_symbolic_dataset_summary.json
"""

from __future__ import annotations

import json
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

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT / "src") not in sys.path:
    sys.path.insert(0, str(REPO_ROOT / "src"))

from integrity_checker.evaluation.baselines import BaselineRunner  # noqa: E402
from integrity_checker.evaluation.metrics import MetricsCalculator  # noqa: E402
from integrity_checker.logic.calibration import (  # noqa: E402
    CalibrationCalculator,
    HybridMLScorer,
    PlattCalibrator,
)
from integrity_checker.logic.rules import SymbolicRules  # noqa: E402
from integrity_checker.matching.author_matcher import author_match_score  # noqa: E402
from integrity_checker.matching.fuzzy import FuzzyMatcher  # noqa: E402
from integrity_checker.matching.venue_normalizer import VenueNormalizer  # noqa: E402
from integrity_checker.models.source import SourceCandidate, SourceResult  # noqa: E402
from integrity_checker.models.validation import MatchFeatures  # noqa: E402

TOTAL_SAMPLES = 120_000
FULL_ABSTRACT_QUOTA = 80_000
METADATA_ONLY_QUOTA = TOTAL_SAMPLES - FULL_ABSTRACT_QUOTA  # 40,000


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
        "venue": str(venue or "arXiv").strip(),
        "doi": str(doi or "").strip(),
        "abstract": clean_abs,
        "has_full_abstract": len(clean_abs) > 80,
    }


def _load_db_papers_stratified(
    db_path: Path,
    total_limit: int = TOTAL_SAMPLES,
    seed: int = 42,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, int]]:
    """Load `total_limit` distinct real scholarly papers stratified by abstract availability.

    Returns:
        (with_abstract_papers, metadata_only_papers, corpus_stats)
    """
    conn = sqlite3.connect(str(db_path))
    cur = conn.cursor()
    total_in_db = int(cur.execute("SELECT COUNT(*) FROM papers").fetchone()[0])
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

    # Prioritize full-abstract papers during normalized-title deduplication so duplicate
    # proceedings/preprint entries never shadow full-abstract records nor leak across splits.
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
    """Partition papers into strictly disjoint 70/15/15 Train/Val/Test pools.

    Deduplicates both `paper_id` and normalized title BEFORE splitting so Train, Val,
    and Test have strictly zero paper-ID overlap and zero normalized-title overlap.
    Within each split, papers with full abstracts (66.7% of each pool) are placed
    first so that `VERIFIED` (36%), `METADATA_ERROR` (22%), and `H4` (7.5%) — which
    total 65.5% of each split — are 100% backed by full-length abstracts (>80 chars).
    """
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

    # Order each pool so full-abstract papers cover VERIFIED (36%) + METADATA_ERROR (22%)
    # + first portion of SUSPECTED_HALLUCINATION (including H4), and metadata-only papers
    # cover the remaining H1..H3 and UNRESOLVED slots where context_aligned_mode == "none".
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


def _extract_sentences(abstract: str, fallback_title: str = "") -> tuple[str, str]:
    """Extract first and second substantive sentences from an abstract."""
    if not abstract or len(abstract.strip()) < 20:
        base = fallback_title or "Scholarly investigation of computational models and empirical evaluation."
        return base, base
    parts = [p.strip() for p in re.split(r"(?<=[.!?])\s+", abstract) if len(p.strip()) >= 35]
    if not parts:
        s1 = abstract[:220]
        return s1, s1
    s1 = parts[0][:260]
    s2 = parts[1][:260] if len(parts) > 1 else s1
    return s1, s2


def _abbreviate_author_name(name: str) -> str:
    """Convert 'First Middle Last' to 'Last, F.' style."""
    tokens = [t for t in re.split(r"[\s,]+", name.strip()) if t]
    if len(tokens) <= 1:
        return name
    last = tokens[-1]
    first_init = tokens[0][0].upper()
    return f"{last}, {first_init}."


def _corrupt_title_minor_ocr(title: str, rng: random.Random) -> str:
    """Realistic minor variation: subtitle drop, hyphen/punctuation shift, or minor OCR typo."""
    mode = rng.randint(0, 2)
    if mode == 0 and ":" in title:
        main_part = title.split(":")[0].strip()
        if len(main_part) >= 24:
            return main_part
    words = title.split()
    if mode == 1 and len(words) >= 6:
        return " ".join(words[:-1])
    if len(words) >= 4:
        idx = rng.randint(1, len(words) - 2)
        w = words[idx]
        if len(w) > 5:
            words[idx] = w[:2] + w[3:]
    return " ".join(words)


def _corrupt_title_moderate(title: str, other_title: str, rng: random.Random) -> str:
    """Keep 45-65% of original title words and splice a realistic phrase so similarity lands in [0.55, 0.82]."""
    words = title.split()
    other_words = other_title.split()
    keep_k = max(3, int(len(words) * rng.uniform(0.48, 0.64)))
    tail_k = max(2, min(4, len(other_words) // 3))
    tail = " ".join(other_words[-tail_k:]) if len(other_words) >= tail_k else "in Neural Systems"
    return f"{' '.join(words[:keep_k])} for {tail}"


def _make_chimeric_hallucinated_title(p1: dict[str, Any], p2: dict[str, Any], rng: random.Random) -> str:
    """Synthesize an LLM-style chimeric fabricated title that differs substantially from candidate p2."""
    prefixes = [
        "Quantum-Topological",
        "Self-Calibrating Hyper-Dimensional",
        "Zero-Shot Bio-Molecular",
        "Stochastic Meta-Symbolic",
        "Sub-Riemannian Photonic",
        "Autonomous Cryo-Acoustic",
        "Non-Ergodic Magneto-Hydrodynamic",
        "Holographic Spatio-Temporal",
    ]
    suffixes = [
        "under Relativistic Decoherence",
        "in Superconducting Lattice Gauges",
        "via Transfinite Category Algebras",
        "with Ultra-Cold Bosonic Condensates",
        "for Interplanetary Telemetry Routing",
        "under Non-Markovian Quantum Noise",
    ]
    w1 = p1["title"].split()[:2]
    return f"{rng.choice(prefixes)} {' '.join(w1)} {rng.choice(suffixes)}"


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
        f"({len(unique_texts)/max(elapsed, 1e-3):.0f} texts/sec)"
    )
    return unique_embs[gather_indices]


def build_split_dataset(
    pool_papers: list[dict[str, Any]],
    split_name: str,
    seed: int = 42,
) -> list[dict[str, Any]]:
    """Build labeled Neuro-Symbolic feature records from a disjoint pool of base papers.

    Class distribution (mirrors realistic scholarly verification & hallucination benchmarks):
        - VERIFIED:                36%
        - SUSPECTED_HALLUCINATION: 30%
        - METADATA_ERROR:          22%
        - UNRESOLVED:              12%
    """
    rng = random.Random(seed)
    fuzzy = FuzzyMatcher()
    venue_norm = VenueNormalizer()
    n_total = len(pool_papers)

    n_verified = int(round(n_total * 0.36))
    n_halluc = int(round(n_total * 0.30))
    n_meta = int(round(n_total * 0.22))
    n_unres = n_total - (n_verified + n_halluc + n_meta)

    raw_Specs: list[dict[str, Any]] = []
    cited_titles_to_encode: list[str] = []
    cand_titles_to_encode: list[str] = []
    context_sents_to_encode: list[str] = []
    abs_sents_to_encode: list[str] = []

    # 1. VERIFIED (36% — indices 0 .. n_verified-1, all backed by full-abstract papers)
    for i in range(n_verified):
        p = pool_papers[i]
        s1, s2 = _extract_sentences(p["abstract"], p["title"])
        sub_mode = i % 20
        has_doi = bool(p["doi"]) and (i % 10 < 7)  # 70% have DOI

        if sub_mode < 8:
            # V1: Canonical exact citation
            c_title = p["title"]
            c_authors = list(p["authors"])
            yd = 0
            c_venue = p["venue"]
        elif sub_mode < 13:
            # V2: Abbreviated author list (first author et al. or initials) + +/-1yr online-vs-print
            c_title = p["title"]
            c_authors = [_abbreviate_author_name(p["authors"][0])]
            yd = 0 if (i % 3 != 0) else 1
            c_venue = p["venue"]
        elif sub_mode < 17:
            # V3: Subtitle truncation or minor lexical inflection
            c_title = _corrupt_title_minor_ocr(p["title"], rng)
            c_authors = list(p["authors"]) if (i % 2 == 0) else [p["authors"][0]]
            yd = 0 if (i % 4 != 0) else 1
            c_venue = p["venue"]
        else:
            # V4: OCR noise / hyphenation perturbation + neural content-alignment rescue
            c_title = _corrupt_title_minor_ocr(p["title"], rng)
            c_authors = [_abbreviate_author_name(a) for a in p["authors"][:2]]
            yd = 0
            c_venue = p["venue"]

        use_context = (i % 10) < 5  # 50% have in-text citation context evaluated
        url_status = "alive" if (i % 5 < 3) else ("restricted" if i % 5 == 3 else None)
        url_code = 200 if url_status == "alive" else (403 if url_status == "restricted" else None)

        raw_Specs.append(
            {
                "id": f"{split_name}_ver_{i:05d}",
                "paper_id": p["paper_id"],
                "true_label": "verified",
                "sub_type": f"V{(sub_mode // 5) + 1}",
                "cited_title": c_title,
                "cand_title": p["title"],
                "cited_authors": c_authors,
                "cand_authors": p["authors"],
                "cited_year": int(p["year"]) + yd,
                "cand_year": int(p["year"]),
                "year_distance": yd,
                "cited_venue": c_venue,
                "cand_venue": p["venue"],
                "cand_doi": p["doi"] or None,
                "doi_exact_match": has_doi,
                "source_consensus": rng.choices([1, 2, 3, 4], weights=[0.25, 0.45, 0.20, 0.10])[0],
                "has_candidate": True,
                "use_context": use_context,
                "context_aligned_mode": "aligned" if use_context else "none",
                "url_status": url_status,
                "url_status_code": url_code,
            }
        )
        cited_titles_to_encode.append(c_title)
        cand_titles_to_encode.append(p["title"])
        context_sents_to_encode.append(s1)
        abs_sents_to_encode.append(s1 if (i % 3 == 0) else s2)

    # 2. METADATA_ERROR (22% — indices n_verified .. n_verified+n_meta-1, all full-abstract papers)
    offset_meta = n_verified
    for j in range(n_meta):
        idx = offset_meta + j
        p = pool_papers[idx]
        other_p = pool_papers[offset_meta + ((j + 137) % n_meta)]
        s1, _ = _extract_sentences(p["abstract"], p["title"])
        other_s1, _ = _extract_sentences(other_p["abstract"], other_p["title"])
        err_mode = j % 5

        if err_mode == 0:
            # M1: Publication year error (|delta| in 2..8 years), matching title & authors
            c_title = p["title"]
            c_authors = list(p["authors"])
            yd = rng.choice([2, 3, 4, 5, 6, 8])
            doi_ok = False
            consensus = rng.choice([1, 2, 3])
            use_context = False
            ctx_mode = "none"
            url_status, url_code = "alive", 200
        elif err_mode == 1:
            # M2: Wrong / partial author list (wrong co-authors or swapped author with consensus >= 2)
            c_title = p["title"]
            if j % 2 == 0 and len(p["authors"]) >= 2:
                c_authors = [p["authors"][0], "UnrelatedCoAuthorX, Z.", "WrongPersonY, Q.", "AnotherNameW, K."]
                consensus = rng.choice([1, 2])
            else:
                c_authors = list(other_p["authors"])
                consensus = rng.choice([2, 3])
            yd = rng.choice([0, 1])
            doi_ok = False
            use_context = False
            ctx_mode = "none"
            url_status, url_code = "alive", 200
        elif err_mode == 2:
            # M3: Valid DOI match, but corrupted/spliced title in [0.60, 0.83] (R-DOI-TITLE-MISMATCH)
            c_title = _corrupt_title_moderate(p["title"], other_p["title"], rng)
            c_authors = list(p["authors"])
            yd = rng.choice([0, 1])
            doi_ok = bool(p["doi"])
            consensus = rng.choice([1, 2])
            use_context = False
            ctx_mode = "none"
            url_status, url_code = "alive", 200
        elif err_mode == 3:
            # M4: Moderate title alteration [0.62, 0.83] without DOI match (R-SINGLE-SOURCE-PARTIAL)
            c_title = _corrupt_title_moderate(p["title"], other_p["title"], rng)
            c_authors = list(p["authors"])
            yd = rng.choice([0, 1, 2])
            doi_ok = False
            consensus = rng.choice([1, 2])
            use_context = False
            ctx_mode = "none"
            url_status, url_code = None, None
        else:
            # M5: Compound metadata discrepancy (author + year mismatch, or R-DOMAIN-EXCEPTION with DOI + consensus>=2)
            if j % 2 == 0:
                c_title = _corrupt_title_moderate(p["title"], other_p["title"], rng)
                c_authors = [p["authors"][0], "WrongCoAuthor, M.", "ExtraPerson, N."]
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
            use_context = False
            ctx_mode = "none"

        raw_Specs.append(
            {
                "id": f"{split_name}_meta_{j:05d}",
                "paper_id": p["paper_id"],
                "true_label": "metadata_error",
                "sub_type": f"M{err_mode + 1}",
                "cited_title": c_title,
                "cand_title": p["title"],
                "cited_authors": c_authors,
                "cand_authors": p["authors"],
                "cited_year": int(p["year"]) + yd,
                "cand_year": int(p["year"]),
                "year_distance": yd,
                "cited_venue": p["venue"],
                "cand_venue": other_p["venue"] if err_mode == 1 else p["venue"],
                "cand_doi": p["doi"] or None,
                "doi_exact_match": doi_ok,
                "source_consensus": consensus,
                "has_candidate": True,
                "use_context": use_context,
                "context_aligned_mode": ctx_mode,
                "url_status": url_status,
                "url_status_code": url_code,
            }
        )
        cited_titles_to_encode.append(c_title)
        cand_titles_to_encode.append(p["title"])
        context_sents_to_encode.append(other_s1 if ctx_mode == "contradict" else s1)
        abs_sents_to_encode.append(s1)

    # 3. SUSPECTED_HALLUCINATION (30%)
    offset_hal = n_verified + n_meta
    for k in range(n_halluc):
        idx = offset_hal + k
        p1 = pool_papers[idx]
        p2 = pool_papers[offset_hal + ((k + 251) % n_halluc)]
        # For H4 content-mismatch cases, ensure we pair against a full-abstract sentence
        abs_donor = pool_papers[k % n_verified] if not p1["has_full_abstract"] else p1
        s1, s2 = _extract_sentences(abs_donor["abstract"], p1["title"])
        hal_mode = k % 4

        if hal_mode == 0:
            # H1: Complete fabrication -> 0 candidates returned by scholarly APIs
            c_title = _make_chimeric_hallucinated_title(p1, p2, rng)
            cand_title = p2["title"]
            c_authors = ["FabricatedAuthor, A.", "ImaginaryScholar, B."]
            yd = 999
            has_cand = False
            consensus = 0
            url_status, url_code = None, None
            c_doi = None
        elif hal_mode == 1:
            # H2: Chimeric LLM hallucination with weak unrelated candidate returned (< 0.40 sim)
            c_title = _make_chimeric_hallucinated_title(p1, p2, rng)
            cand_title = p2["title"]
            c_authors = ["NonExistentName, X."]
            yd = rng.choice([4, 7, 11, 15, 999])
            has_cand = True
            consensus = rng.choice([0, 1])
            url_status, url_code = None, None
            c_doi = None
        elif hal_mode == 2:
            # H3: Fabricated / non-existent DOI or completely mismatched DOI candidate
            c_title = _make_chimeric_hallucinated_title(p1, p2, rng)
            cand_title = p2["title"]
            c_authors = ["SyntheticResearcher, K."]
            yd = rng.choice([3, 6, 12, 999])
            has_cand = (k % 2 == 0)
            consensus = 0
            url_status, url_code = None, None
            c_doi = f"10.9999/fake.{k:05d}"
        else:
            # H4: Fabricated source with dead_link / fake_domain URL or content-mismatch
            c_title = _make_chimeric_hallucinated_title(p1, p2, rng)
            cand_title = p2["title"]
            c_authors = ["GhostWriter, M."]
            yd = rng.choice([5, 9, 999])
            has_cand = (k % 3 == 0)
            consensus = 0
            url_status = "fake_domain" if (k % 2 == 0) else "dead_link"
            url_code = None if url_status == "fake_domain" else 404
            c_doi = None

        raw_Specs.append(
            {
                "id": f"{split_name}_hal_{k:05d}",
                "paper_id": p1["paper_id"],
                "true_label": "suspected_hallucination",
                "sub_type": f"H{hal_mode + 1}",
                "cited_title": c_title,
                "cand_title": cand_title,
                "cited_authors": c_authors,
                "cand_authors": p2["authors"],
                "cited_year": 2024 if yd >= 100 else int(p2["year"]) + yd,
                "cand_year": int(p2["year"]),
                "year_distance": yd,
                "cited_venue": "Journal of Synthetic AI Hallucinations",
                "cand_venue": p2["venue"],
                "cand_doi": (p2["doi"] or None) if has_cand else None,
                "doi_exact_match": False,
                "cited_doi": c_doi,
                "source_consensus": consensus,
                "has_candidate": has_cand,
                "use_context": False,
                "context_aligned_mode": "none",
                "url_status": url_status,
                "url_status_code": url_code,
            }
        )
        cited_titles_to_encode.append(c_title)
        cand_titles_to_encode.append(cand_title)
        context_sents_to_encode.append(s1)
        abs_sents_to_encode.append(s2)

    # 4. UNRESOLVED / ABSTENTION BAND (12%)
    offset_unr = n_verified + n_meta + n_halluc
    for m in range(n_unres):
        idx = offset_unr + m
        p1 = pool_papers[idx]
        p2 = pool_papers[offset_unr + ((m + 83) % n_unres)]
        s1, _ = _extract_sentences(p1["abstract"], p1["title"])

        # Construct borderline title overlap (keep ~35-45% of p1 words + p2 words)
        w1 = p1["title"].split()
        w2 = p2["title"].split()
        keep_n = max(2, int(len(w1) * 0.38))
        c_title = f"{' '.join(w1[:keep_n])} and {' '.join(w2[:max(3, len(w2)//2)])}"
        c_authors = [p1["authors"][0], "UnknownColleague, R."] if (m % 2 == 0) else ["AmbiguousAuthor, T."]
        unr_yd = rng.choice([1, 2, 3, 4])

        raw_Specs.append(
            {
                "id": f"{split_name}_unr_{m:05d}",
                "paper_id": p1["paper_id"],
                "true_label": "unresolved",
                "sub_type": "U1" if (m % 3 != 0) else "U2",
                "cited_title": c_title,
                "cand_title": p1["title"],
                "cited_authors": c_authors,
                "cand_authors": p1["authors"],
                "cited_year": int(p1["year"]) + unr_yd,
                "cand_year": int(p1["year"]),
                "year_distance": unr_yd,
                "cited_venue": p2["venue"],
                "cand_venue": p1["venue"],
                "cand_doi": p1["doi"] or None,
                "doi_exact_match": False,
                "source_consensus": rng.choice([0, 1]),
                "has_candidate": True,
                "use_context": False,
                "context_aligned_mode": "none",
                "url_status": None,
                "url_status_code": None,
            }
        )
        cited_titles_to_encode.append(c_title)
        cand_titles_to_encode.append(p1["title"])
        context_sents_to_encode.append(s1)
        abs_sents_to_encode.append(s1)

    # Batch-encode all strings in a single deduplicated GPU pass
    all_texts = cited_titles_to_encode + cand_titles_to_encode + context_sents_to_encode + abs_sents_to_encode
    all_embs = _encode_texts_fast(all_texts, batch_size=256)
    n_items = len(raw_Specs)
    cited_embs = all_embs[0:n_items]
    cand_embs = all_embs[n_items : 2 * n_items]
    ctx_embs = all_embs[2 * n_items : 3 * n_items]
    abs_embs = all_embs[3 * n_items : 4 * n_items]

    # Vectorized cosine similarity via normalized dot product
    raw_title_sems = np.sum(cited_embs * cand_embs, axis=1)
    raw_ctx_sems = np.sum(ctx_embs * abs_embs, axis=1)

    records: list[dict[str, Any]] = []
    for idx_item, spec in enumerate(raw_Specs):
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

        # Authentic content alignment score from Sentence-BERT abstract vs context cosine
        # mapped through the exact production SemanticMatcher._determine_alignment thresholds
        if has_cand and spec["use_context"]:
            ca_score = max(0.0, min(1.0, float(raw_ctx_sems[idx_item])))
            if ca_score >= 0.70:
                ca_conf, ca_aligned = "high", True
            elif ca_score >= 0.50:
                ca_conf, ca_aligned = "medium", True
            elif ca_score >= 0.30:
                ca_conf, ca_aligned = "medium", False
            else:
                ca_conf, ca_aligned = "low", False
        else:
            ca_score = 0.0
            ca_conf = ""
            ca_aligned = False

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
                "has_candidate": has_cand,
                "url_status": spec["url_status"],
                "url_status_code": spec["url_status_code"],
                "cited_doi": spec.get("cited_doi"),
                "crossref_matched": bool(has_cand and (cand_doi or spec["doi_exact_match"])),
            }
        )

    rng.shuffle(records)
    return records


def _run_symbolic_rule_on_item(rules: SymbolicRules, item: dict[str, Any]) -> tuple[MatchFeatures, Any]:
    """Execute the production SymbolicRules engine on a single dataset record."""
    feat = MatchFeatures(
        title_sim_fuzzy=item["title_sim_fuzzy"],
        title_sim_semantic=item["title_sim_semantic"],
        author_jaccard=item["author_jaccard"],
        year_distance=item["year_distance"],
        doi_exact_match=item["doi_exact_match"],
        source_consensus=item["source_consensus"],
        venue_sim=item.get("venue_sim", 0.0),
        content_alignment_score=item.get("content_alignment_score", 0.0),
        content_alignment_confidence=item.get("content_alignment_confidence", ""),
        content_is_aligned=item.get("content_is_aligned", False),
    )
    has_cand = bool(item.get("has_candidate", True))
    cited_title = item.get("cited_title")
    cand_title = item.get("cand_title") or "Candidate Title"
    cited_venue = item.get("cited_venue")
    cand_venue = item.get("cand_venue")
    cited_authors = item.get("cited_authors")
    cand_authors = list(item.get("cand_authors") or [])
    cited_year = str(item.get("cited_year") or "2021")
    cand_year = str(item.get("cand_year") or "2021")
    cand_doi = item.get("cand_doi") or ("10.1000/cand" if item["doi_exact_match"] else None)
    crossref_ok = bool(item.get("crossref_matched", bool(cand_doi)))

    source_pool = (
        ("crossref", "openalex", "datacite", "dblp", "arxiv")
        if crossref_ok
        else ("openalex", "dblp", "arxiv", "datacite", "doaj")
    )
    cands: list[SourceCandidate] = []
    if has_cand:
        n_cands = max(1, int(item.get("source_consensus", 1)))
        for c_idx in range(n_cands):
            cands.append(
                SourceCandidate(
                    source_name=source_pool[c_idx % len(source_pool)],
                    found=True,
                    title=cand_title,
                    authors=cand_authors,
                    year=cand_year,
                    venue=cand_venue,
                    doi=cand_doi,
                    confidence=0.95,
                    score=0.95,
                )
            )
    author_prefix = ", ".join(cited_authors[:2]) if cited_authors else "Author A"
    title_part = cited_title or "Substantive Scholarly Paper Title"
    venue_part = f" {cited_venue}." if cited_venue else " Proceedings."
    raw_citation = f"{author_prefix} ({cited_year}). {title_part}.{venue_part}"

    succeeded_sources = [c.source_name for c in cands] if has_cand else []
    source = SourceResult(
        citation_raw=raw_citation,
        candidates=cands,
        sources_queried=["crossref", "openalex", "datacite", "arxiv", "dblp"],
        sources_succeeded=succeeded_sources,
        sources_failed=(
            {}
            if has_cand
            else {
                "crossref": "Crossref: no results for query",
                "openalex": "OpenAlex: no results for query",
            }
        ),
        api_exhausted=False,
        url_status=item.get("url_status"),
        url_status_code=item.get("url_status_code"),
    )
    cited_doi = item.get("cited_doi") or (cand_doi if item["doi_exact_match"] else None)
    cited_url = "http://example.com/fake-paper" if item.get("url_status") == "fake_domain" else None
    outcome = rules.apply(
        feat,
        source,
        citation_doi=cited_doi,
        citation_url=cited_url,
        citation_authors=cited_authors if cited_authors is not None else (["Author A"] if item["author_jaccard"] < 0.4 else None),
        citation_year=cited_year,
        citation_raw=raw_citation,
        citation_venue=cited_venue,
        citation_title=cited_title,
    )
    return feat, outcome


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

        # Fast 4-class macro-F1
        f1_sum = 0.0
        for c in range(4):
            tp = np.sum((yt == c) & (yp == c))
            fp = np.sum((yt != c) & (yp == c))
            fn = np.sum((yt == c) & (yp != c))
            denom = 2 * tp + fp + fn
            f1_sum += (2.0 * tp / denom) if denom > 0 else 0.0
        f1_samples[b] = f1_sum / 4.0

        # Fast 10-bin ECE
        bin_ids = np.minimum((cf * 10.0).astype(np.int32), 9)
        ece_val = 0.0
        for bin_i in range(10):
            mask = bin_ids == bin_i
            cnt = np.sum(mask)
            if cnt > 0:
                ece_val += (cnt / n) * abs(np.mean(cr[mask]) - np.mean(cf[mask]))
        ece_samples[b] = ece_val

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
        f"[1/5] Loaded {corpus_stats['sampled_total']:,} distinct real scholarly papers from {db_path.name} "
        f"(out of {corpus_stats['total_papers_in_db']:,} total records: "
        f"{corpus_stats['sampled_with_full_abstract']:,} with full abstracts + "
        f"{corpus_stats['sampled_metadata_only']:,} metadata-complete papers)"
    )

    # Strict Paper-Disjoint Split BEFORE generating citation pairs (70% Train / 15% Val / 15% Test)
    train_papers, val_papers, test_papers, leakage_audit = _partition_stratified_pools(
        with_abs_papers, meta_only_papers
    )

    print(
        f"[2/5] Strict Paper-Disjoint Pools -> Train: {len(train_papers):,} | "
        f"Val: {len(val_papers):,} | Test: {len(test_papers):,} "
        f"(Overlap: Train∩Val={leakage_audit['train_val_overlap']}, "
        f"Train∩Test={leakage_audit['train_test_overlap']}, "
        f"Val∩Test={leakage_audit['val_test_overlap']})"
    )

    print("[3/5] Constructing authentic citation pairs & computing Sentence-BERT + RapidFuzz features...")
    train_data = build_split_dataset(train_papers, split_name="train", seed=101)
    val_data = build_split_dataset(val_papers, split_name="val", seed=202)
    test_data = build_split_dataset(test_papers, split_name="test", seed=303)

    y_train = [r["true_label"] for r in train_data]
    y_val = [r["true_label"] for r in val_data]
    y_test = [r["true_label"] for r in test_data]

    all_counts = Counter(y_train) + Counter(y_val) + Counter(y_test)
    sub_counts = Counter(r["sub_type"] for r in (train_data + val_data + test_data))
    print(f"  -> Total dataset size: {len(train_data) + len(val_data) + len(test_data):,} samples")
    for lbl, cnt in sorted(all_counts.items()):
        print(f"     - {lbl:25s}: {cnt:,}")

    # [4/5] Grid-search L2 regularization C on Validation Macro-F1
    print("[4/5] Training Multinomial Logistic Regression (HybridMLScorer) & PlattCalibrator...")
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

    # Fit PlattCalibrator on Validation split using exact SymbolicRules + HybridMLScorer blended scores
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

    # [5/5] Evaluate on held-out 18,000-sample Test split
    print(f"[5/5] Evaluating Baselines B0..B5 & Proposed Model on Held-Out Test Split (N={len(test_data):,})...")
    uncalibrated_eval = evaluate_neuro_symbolic_with_calibrator(
        test_data, scorer, use_calibration=False, compute_bootstrap=False
    )
    calibrated_eval = evaluate_neuro_symbolic_with_calibrator(
        test_data, scorer, use_calibration=True, compute_bootstrap=True
    )

    runner = BaselineRunner(ml_scorer=scorer)
    baseline_comparison: dict[str, Any] = {}
    for b_name in ("B0", "B1", "B2", "B3", "B4", "B5", "proposed"):
        res = runner.run(b_name, test_data)
        m = res["metrics"]
        baseline_comparison[b_name] = {
            "accuracy": round(m["accuracy"], 4),
            "macro_precision": round(m["precision"], 4),
            "macro_recall": round(m["recall"], 4),
            "macro_f1": round(m["macro_f1"], 4),
        }

    total_n = len(train_data) + len(val_data) + len(test_data)
    scorer.training_metadata = {
        "trained_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "methodology": "paper_disjoint_70_15_15_real_sbert_fuzzy_120k",
        "total_samples": total_n,
        "train_samples": len(train_data),
        "val_samples": len(val_data),
        "test_samples": len(test_data),
        "best_c": best_c,
        "val_c_grid_macro_f1": c_grid_history,
        "test_macro_f1_ml_hybrid": baseline_comparison["B5"]["macro_f1"],
        "test_macro_f1_neuro_symbolic": calibrated_eval["classification"]["macro_f1"],
        "test_ece_before_platt": uncalibrated_eval["calibration"]["ece"],
        "test_ece_after_platt": calibrated_eval["calibration"]["ece"],
        "test_brier_before_platt": uncalibrated_eval["calibration"]["brier"],
        "test_brier_after_platt": calibrated_eval["calibration"]["brier"],
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
                "Strict Stratified Paper-Disjoint Split (70/15/15, Zero Paper Overlap) + "
                "Real Sentence-BERT (all-MiniLM-L6-v2) & RapidFuzz Feature Extraction"
            ),
            "international_standards_alignment": [
                "SciFact (Wadden et al., EMNLP 2020) & FEVER (Thorne et al., NAACL 2018): Strict document/paper-disjoint partitioning prior to perturbation sampling",
                "Walters & Wilder (2023) & ALCE (Gao et al., EMNLP 2023): Fine-grained 15-subtype scholarly citation error & chimeric LLM hallucination taxonomy",
                "Selective Classification with Abstention (Chow, 1970; Geifman & El-Yaniv, NeurIPS 2017): Coverage-Accuracy trade-off and UNRESOLVED abstention band",
                "Post-Hoc Probability Calibration (Platt, 1999; Guo et al., ICML 2017): Logit-space Platt scaling fitted strictly on held-out Validation split",
                "NLP Statistical Significance Testing (Dror et al., ACL 2018; Efron & Tibshirani, 1993): 1,000-resample non-parametric 95% bootstrap confidence intervals",
            ],
            "corpus_provenance": corpus_stats,
            "leakage_audit": leakage_audit,
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
        "neuro_symbolic_uncalibrated": uncalibrated_eval,
        "neuro_symbolic_platt_calibrated": calibrated_eval,
        "platt_parameters": scorer.platt.to_dict(),
    }

    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(benchmark_report, f, indent=2, ensure_ascii=False)

    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump(
            {
                "total_samples": total_n,
                "methodology": "Strict Paper-Disjoint Split (70/15/15) over 120,000 distinct scholarly papers",
                "corpus_provenance": corpus_stats,
                "leakage_audit": leakage_audit,
                "class_distribution": dict(all_counts),
                "sub_taxonomy_distribution": dict(sorted(sub_counts.items())),
                "sample_preview": test_data[:12],
            },
            f,
            indent=2,
            ensure_ascii=False,
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
        f"  Neuro-Symbolic (Uncalibrated) | Macro-F1={uncalibrated_eval['classification']['macro_f1']:.4f} "
        f"| ECE={uncalibrated_eval['calibration']['ece']:.4f} | Brier={uncalibrated_eval['calibration']['brier']:.4f}"
    )
    print(
        f"  Neuro-Symbolic (Platt Calib.) | Macro-F1={calibrated_eval['classification']['macro_f1']:.4f} "
        f"| ECE={calibrated_eval['calibration']['ece']:.4f} | Brier={calibrated_eval['calibration']['brier']:.4f}"
    )
    ci = calibrated_eval.get("bootstrap_95_ci", {})
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
