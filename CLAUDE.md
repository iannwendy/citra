# CLAUDE.md — CITRA (`SourceLogic`) · Essay Integrity Checker

## Purpose

Engineering reference and architectural guide for AI coding assistants and contributors working on **CITRA (`SourceLogic` — Essay Integrity Checker)**.

## Project Overview

**CITRA (`SourceLogic`)** is an explainable **Neuro-Symbolic Citation & Source Integrity Verification Platform** for academic manuscripts, theses, and research papers.

- **Version:** v2.3 (9 Free Scholarly & Technical APIs + Retraction Watch + Wayback Machine Complete — 2026-10-28)
- **Unit & Integration Tests:** `1,350+ backend passed · 58 frontend passed, 0 failed`
- **Role-Based Web Workspace:** Student / Researcher (`Workspace`), Teacher (`Classroom`), Administrator (`Control`)
- **Decision-Support Principle:** All outputs are strictly decision-support signals for academic reviewers; the system never automatically concludes academic misconduct.

## Repository Architecture

```text
essay-integrity-checker/
├── src/integrity_checker/
│   ├── api/                  # FastAPI backend routes (auth, essays, report, verdicts, classes, admin)
│   ├── config.py             # Centralized Pydantic settings (YAML + environment variables)
│   ├── database/             # Local SQLite + FTS5 paper knowledge base (127K+ ACL & scholarly papers)
│   ├── db/                   # Application database (SQLAlchemy: Users, Classes, Essays, Citations, Verdicts, AuditLogs)
│   ├── evaluation/           # Metrics, Baselines (B0–B5), 120,000-sample Paper-Disjoint Benchmark & Ablation Runner
│   ├── export/               # Multi-format report exporters (JSON, CSV, PDF, DOCX, Class CSV/ZIP)
│   ├── extraction/           # Hybrid PDF parsing (PyMuPDF + GROBID TEI XML + 11 modular regex styles)
│   ├── linking/              # Bidirectional in-text <-> bibliography CitationLinker (7 link statuses)
│   ├── logic/                # NeuroSymbolicChecker, SymbolicRules, HybridMLScorer, PlattCalibration, CISCalculator
│   ├── matching/             # RapidFuzz lexical, Sentence-BERT semantic, AuthorMatcher, VenueNormalizer
│   ├── models/               # Pydantic & dataclass domain models
│   ├── pipeline/             # IntegrityPipeline end-to-end orchestrator
│   └── retrieval/            # Domain-routed multi-source retrieval + Active HTTP/DOI LinkValidator
├── web/                      # React 18 + TypeScript + Vite + Tailwind CSS + shadcn/ui frontend
├── configs/                  # YAML configurations (default, Docker, production)
├── docs/                     # Architectural specs, test plans, research reports & UI screenshots
└── tests/                    # 1,251 unit, integration & E2E tests
```

## Two-Layer Orthogonal Output Model

### Layer 1: Citation <-> Reference Linking (`CitationMappingStatus`)
- `MATCHED` — In-text citation linked to a bibliography entry
- `MISSING_REFERENCE` — In-text citation has no matching bibliography entry
- `UNCITED_REFERENCE` — Bibliography entry is never cited in the body text
- `IN_TEXT_MISMATCH` — Linked but author/year metadata diverges between body and bibliography
- `DUPLICATE_REFERENCE` — Duplicate entries in the reference list
- `AMBIGUOUS_MAPPING` — Multiple candidate references match the same in-text citation
- `STYLE_INCONSISTENT` — Citation formatting deviates from the document's dominant style

### Layer 2: Scholarly Source Verification (`ValidationLabel`)
| Label | Badge Color | Meaning |
| :--- | :--- | :--- |
| `VERIFIED` | Emerald (`#10B981`) | Confirmed across scholarly databases with matching metadata |
| `METADATA_ERROR` | Amber (`#F59E0B`) | Work exists, but cited year, author, venue, or title has discrepancies |
| `SUSPECTED_HALLUCINATION` | Red (`#EF4444`) | Fabricated DOI/URL, non-existent work across all scholarly indices, or severe content mismatch |
| `UNRESOLVED` | Slate (`#64748B`) | Insufficient evidence to verify or refute (abstention zone) |
| `RESOURCE` | Violet (`#8B5CF6`) | Non-article web/API documentation, software repositories, or legal statutes |

## Smart Multi-Source Retrieval Tiering (15+ Scholarly & Technical APIs)

`RetrievalOrchestrator` routes citations by domain signals and identifier availability:
1. **Tier 0 (Instant Local):** Known Seminal Papers Whitelist + SQLite FTS5 Local Database (`data/local_papers.db`) + Built-in Vietnamese Legal Statute Registry (`VNLegalVerifier`)
2. **Tier 1 (Primary & Domain-Prioritized Scholarly APIs):**
   - **Crossref REST API** — Exact DOI resolution, bibliographic search & Retraction Watch (`update-to` / `is-retracted-by`) detection
   - **OpenAlex REST API** — Broad scholarly graph, inverted-index abstract reconstruction & `is_retracted` flag detection
   - **DataCite REST API (`DataCiteClient`)** — Zenodo (`10.5281/zenodo.*`), Figshare (`10.6084/*`), Dryad (`10.5061/*`), OSF (`10.17605/*`), arXiv DOIs (`10.48550/*`), datasets, theses, software & abstract enrichment
   - **DOAJ API (`DOAJClient`)** — Directory of Open Access Journals for regional, Asian, Vietnamese, Social Sciences & Humanities Open Access articles
   - **OpenAIRE Graph + HAL Open Science API (`OpenAIREHalClient`)** — European & global theses, dissertations (`Luận văn`, `Luận án`), working papers & institutional repositories
   - **NCBI Entrez E-Utilities + bioRxiv/medRxiv API (`NcbiBiorxivClient`)** — `10.1101/*` biomedical preprints & PubMed PMID/abstract resolution
   - **DBLP Search API** — Computer Science, AI, ML, NLP venues & CoRR
   - **arXiv Atom API** — Direct arXiv ID & preprint verification
   - **OpenLibrary + Google Books API** — Textbooks, monographs & multi-edition books
   - **Europe PMC REST API** — PubMed/MEDLINE, biomedical, clinical, psychology & life sciences
   - **Hugging Face Hub API (`HuggingFaceClient`)** — AI/NLP models, datasets (e.g., `vinai/phobert-base`) & Daily Papers
   - **IETF Datatracker RFC & PyPI JSON API (`TechStandardClient`)** — Technical RFC standards (`RFC 2616`, `RFC 9110`) & Python software packages
3. **Tier 2 / Tier 3 (Global DOI RA, Knowledge Graph & Google Scholar Fallback Router):**
   - **Global DOI Registration Agency & Content Negotiation (`DoiRaClient`)** — Verifies regional DOIs across JaLC (Japan), CNKI/istic (China), mEDRA (EU), KISTI (Korea), Airiti (Taiwan) via `doi.org/doiRA/{doi}` and `application/vnd.citationstyles.csl+json`, or confirms non-existent DOIs (`NOT_EXIST`)
   - **Wikidata Knowledge Graph & OpenCitations (`WikidataOpenCitationsClient`)** — Free fallback for international standards (ISO/NIST/IEEE/OWASP/WCAG), clinical manuals (DSM-5/ICD-11), and open citations
   - **Google Scholar Fallback Router (`GoogleScholarFallbackClient` / `SerpApiClient`)** — Async `httpx.AsyncClient` primary lookup via **Serper.dev (`/scholar`)** (`SERPER_API_KEY`, 2,500 free queries) with automatic circuit-breaker failover to **SerpApi (`google_scholar`)** (`SERPAPI_API_KEY`) when primary tiers return no match (`source_name="serpapi"`)
4. **Cross-Source Abstract Enrichment (`_enrich_missing_abstract`):** Automatically enriches missing abstracts across `OpenAlex` (DOI + title-mirror fallback), `DataCite`, `Europe PMC`, `NCBI Entrez / bioRxiv`, `DOAJ`, `OpenAIRE/HAL`, `Hugging Face`, `arXiv`, and `OpenLibrary/Google Books`, persisting enriched abstracts back to `data/local_papers.db`.
5. **Active Link, DOI & Wayback Machine Validator (`LinkValidator`):** Asynchronous `HEAD`/`GET` reachability checks for URLs and DOIs (`R-DEAD-LINK`, `R-URL-UNREACHABLE`), paired with **Internet Archive Wayback Machine Availability API (`archive.org/wayback/available`)** fallback to distinguish Link Rot (`LinkStatus.ARCHIVED_ALIVE` + `R-WAYBACK-ARCHIVED` + `archive_url`) from AI-fabricated dead URLs (`LinkStatus.DEAD_LINK`).
6. **Retraction Watch Guardrail (`R-RETRACTED-PAPER`):** Automatically flags retracted papers (`is_retracted=True`) as `METADATA_ERROR` with `retracted_paper` mismatch warning, preventing retracted studies from being marked `VERIFIED`.

## Deep Neural Semantic & Evidence Layer (`SemanticMatcher` & `MatchFeatures`)

1. **Sentence-Level Evidence Extraction:** De-hyphenates PDF context, isolates the focal cited sentence (`best_cited_sentence`), encodes each sentence of `source_abstract` with `Sentence-BERT (all-MiniLM-L6-v2)`, and applies max+mean pooling (`best_evidence_sentence`, `best_evidence_score`, `title_context_sim`, `abstract_context_sim`).
2. **Citation Intent Classification:** Classifies citation context into `background`, `methodology`, or `result_comparison` (SciCite / ACL-ARC taxonomy).
3. **Claim Stance & Polarity Verification:** Detects `supported`, `partially_supported`, `neutral`, or `contradiction_risk` between manuscript claims and source abstract evidence.
4. **Cross-Lingual Semantic Bridging (`VI ↔ EN`):** Detects Vietnamese academic contexts citing English literature (`cross_lingual_detected`) and bridges domain terminology.
5. **Multi-Occurrence & Implicit Body Passage Discovery:** Aggregates alignment across all in-text occurrences (`occurrence_alignments`) and discovers implicit body passages for uncited bibliography entries (`context_source = "implicit_body_discovery"`).

## Common Commands

```bash
# Run full unit test suite (1,251 tests)
.venv/bin/python -m pytest tests/unit/ -q

# Run pipeline on a PDF and output JSON report to reports/<stem>.json
.venv/bin/python -m integrity_checker.pipeline.integrity_pipeline thesis.pdf

# Launch full Docker stack (GROBID :8070 + FastAPI :8000 + React Web :5173)
docker compose up -d --build
```
