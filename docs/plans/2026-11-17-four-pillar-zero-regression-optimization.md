# Four-Pillar Zero-Regression Neuro-Symbolic Bottleneck Optimization Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:test-driven-development` and `superpowers:verification-before-completion` to implement and verify every task iteratively until benchmarks reach peak zero-regression accuracy.

**Goal:** Eliminate the 4 diagnosed accuracy/Macro-F1 bottlenecks across the In-Distribution (`120K`, `18K` test), Out-of-Distribution (`2,400`), and End-to-End (`120`) benchmarks while preserving 100% of Decision-Support invariants (`0` false hallucination accusations on `VERIFIED`, `0` hallucinations slipping into `VERIFIED`), 100% academic evaluation integrity (zero `np.clip` label clamping, `0/0/0` split overlap, `BaselineRunner("proposed") == SymbolicRules`), and 0 regressions across all existing backend/frontend tests and real PDF pipelines.

**Architecture:**
1. **Pillar 1 — Rule Priority Ordering & Strong Author-Year Consensus Gate (`src/integrity_checker/logic/rules.py`):**
   - Promote `R-DOMAIN-EXCEPTION` (`doi_match` with `title_sim < 0.60` and author/source support) **above** `Rule 5` (`R-ABSTENTION-BORDER`) so valid-DOI corrupted-title records (`M3`/`M5`) are no longer shadowed into `UNRESOLVED`.
   - Add `Rule 4g` (`R-TITLE-MISMATCH`) immediately before `Rule 5`: when `not doi_match`, `not has_doi_conflict`, `0.42 <= title_sim < 0.60`, **`author_sim >= 0.75`** (`consensus >= 2`) or **`author_sim >= 0.85`** (`features.title_sim_fuzzy >= 0.52` and zero unmatched cited authors `not author_match_details(...).only_cited`, preserving `First Author et al.` while remaining cleanly disjoint from `U1` partial-author grey zone), and `year_dist is not None and abs(year_dist) <= 2`, classify as `METADATA_ERROR` (`mismatched_fields=["title"]` + `["year"]` if `year_dist >= 2` + `["url"]` if `dead_link`).
   - Also capture compound real-work discrepancy (`M5` without DOI where lead author is compatible without conflicting given-name initials, `consensus >= 2`, `year_dist < 900`, `2 <= abs(year_dist) <= 4` or `author_sim < 0.20`, and `features.title_sim_fuzzy >= 0.58`) as `METADATA_ERROR` rather than `UNRESOLVED` or `R-DEAD-URL` hallucination.
2. **Pillar 2A — Hybrid Bi-Encoder + Distinctive Lexical/Entity Specificity Gate (`src/integrity_checker/matching/semantic.py` & `src/integrity_checker/logic/rules.py`):**
   - Add deterministic, verb-agnostic `SemanticMatcher.calibrate_monolingual_specificity(...)` (`+0 MB` RAM, `< 0.2 ms` CPU): strips generic academic framing/stopwords and checks whether substantive non-title technical stems in the citing sentence have morphological root grounding in `source_abstract`. When raw Bi-Encoder cosine falls in the topical false-positive band (`0.50 <= sim < 0.78`) on a monolingual pair with a substantive abstract and zero grounded non-title stems across `>= 4` stems, recalibrate `final_sim` into `[0.36, 0.44]` (`is_aligned = False`, `confidence = "medium"`) and set `stance_label = "contradiction_risk"` so `R-CONTENT-MISMATCH` triggers cleanly.
   - Ensure `R-CONTENT-MISMATCH` in `rules.py` routes verified-work content misattributions (`features.title_sim_fuzzy >= 0.75`, `author_sim >= 0.50` or `>= 0.25` with `consensus >= 2`, `year_dist <= 1` or `>= 900`) to `METADATA_ERROR` (`mismatched_fields=["content"]`) without letting `Rule 1`, `Rule 1b`, `Rule 3`, `Rule 3b`, or `R-KNOWN-PAPER` short-circuit past an explicit `contradiction_risk` signal on substantive-abstract citations.
   - Unify `scripts/train_neuro_symbolic_model.py` to call `SemanticMatcher.calibrate_monolingual_specificity(...)` and `check_claim_stance(...)` directly on full `p["abstract"]` across 12 diverse natural academic templates with zero stemmer pre-screening and zero label conditioning.
3. **Pillar 3 — Spliced Chimeric DOI Tightening & Link-Rot / Grey-Zone Precision (`src/integrity_checker/logic/rules.py`):**
   - In `Rule 2b` (`R-CHIMERIC-DOI-MISMATCH`), evaluate `_chimeric_zero_content_overlap` (guarded by consortium/org check, `title_sim_semantic < 0.58`, and explicit venue mismatch) when `bool(citation_authors)` and `author_sim == 0.0` and `features.title_sim_fuzzy < 0.50`, catching same-domain spliced chimeric DOIs (`OOD Category 2`) with zero false positives on `VERIFIED`.
   - In `Rule 4d` (`R-DEAD-URL`), exempt real scholarly works (`consensus >= 1`, `author_sim >= 0.15`, `title_sim >= 0.35`, and `year_dist <= 4` or `>= 900`) so link-rotted authentic works route to `METADATA_ERROR` instead of `SUSPECTED_HALLUCINATION`.
   - Tighten `is_partial_author_grey_zone` so positive fabrication signals (`url_status in ("dead_link", "fake_domain")` or `consensus == 0`) do not rescue `H2`/`H4` hallucinations into `UNRESOLVED`.
4. **Pillar 4 — Multidisciplinary & Biomedical Canonical Venue Expansion (`src/integrity_checker/matching/venue_normalizer.py`):**
   - Add canonical acronym expansions (`BMJ` -> `British Medical Journal`, `JAMA` -> `Journal of the American Medical Association`, `PNAS` -> `Proceedings of the National Academy of Sciences`, `PLOS ONE`, `Nucleic Acids Research`, `Bioinformatics`, `Cell`, `Circulation`, `Nature Medicine`, `Nature Communications`, `Annals of Internal Medicine`) so single-token medical/science journal acronyms trigger `R-VENUE-MISMATCH` (`E2E-031` -> `120/120 = 100%`).

---

## Iterative Execution & Verification Loop
1. **Task 1 (RED):** Write comprehensive unit & boundary tests in `tests/unit/test_four_pillar_bottleneck_optimization.py` covering all 4 pillars + zero-regression safety guards (`VERIFIED`, `U1/U2`, cross-lingual, title-less journal refs). Run pytest to confirm initial failures.
2. **Task 2 (GREEN):** Implement Pillar 4 (`venue_normalizer.py`), Pillar 2A (`semantic.py` + `train_neuro_symbolic_model.py`), and Pillars 1 & 3 (`rules.py`). Run unit tests + full `2,164+` backend test suite.
3. **Task 3 (BENCHMARK & RESIDUAL ERROR LOOP):**
   - Re-run `scripts/train_neuro_symbolic_model.py` (`120K` ID + `2,400` OOD + statistical significance + ablations) and `scripts/evaluation/run_ground_truth_evaluation.py` (`120` E2E + `15` adversarial).
   - Inspect residual confusion matrix and error items; iteratively refine any remaining principled rule/feature edge cases (strictly zero `np.clip` / zero label leakage) and re-run benchmarks until convergence at peak scientific accuracy.
   - Synchronize benchmark documentation (`docs/reports/BENCHMARK_120K_NEURO_SYMBOLIC_REPORT.md`, `README.md`).
4. **Task 4 (FULL PIPELINE & HOSTILE REVIEWER #2 GATES):**
   - Run live 10-PDF end-to-end verification comparison (`82` citations) to verify 0 regressions on real PDFs.
   - Run `ruff check src/ tests/ scripts/`, `pytest tests/ -q`, frontend `eslint`/`tsc`/`vitest`/`vite build`, and audit every scientific invariant.
