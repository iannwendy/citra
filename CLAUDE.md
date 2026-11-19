# CLAUDE.md — CITRA (`SourceLogic`) · Essay Integrity Checker

## Purpose

Engineering reference and architectural guide for AI coding assistants and contributors working on **CITRA (`SourceLogic` — Essay Integrity Checker)**.

## Project Overview

**CITRA (`SourceLogic`)** is an explainable **Neuro-Symbolic Citation & Source Integrity Verification Platform** for academic manuscripts, theses, and research papers.

- **Version:** v3.89.2 (15+ Scholarly & Technical APIs, Multilingual ONNX INT8, 120K Zero-Shortcut Benchmark, 2.4K OOD Guardrail Proof, Paired Significance & 120-Ref E2E Gold Suite — 2026-11-17)
- **Unit & Integration Tests:** `2,100+ backend passed · 340+ frontend Vitest passed, 0 failed`
- **Role-Based Web Workspace:** Student / Researcher (`Workspace`), Teacher (`Classroom`), Administrator (`Control`)
- **Decision-Support Principle:** All outputs are strictly decision-support signals for academic reviewers; the system never automatically concludes academic misconduct.

## Repository Architecture

```text
essay-integrity-checker/
├── src/integrity_checker/
│   ├── api/                  # FastAPI backend routes (auth, billing, essays, report, verdicts, teacher, users, audit, system, cache, export, health)
│   ├── billing/              # Plan quotas (Basic/Pro/Ultra), Stripe & VNPay HMAC-SHA512 payment verification
│   ├── config.py             # Centralized Pydantic settings (YAML + environment variables)
│   ├── database/             # Local SQLite + FTS5 paper knowledge base (128K+ ACL & scholarly papers)
│   ├── db/                   # Application database (SQLAlchemy 2.0 + SQLite WAL / PostgreSQL: Users, Classes, Essays, Citations, Verdicts, AuditLogs)
│   ├── evaluation/           # Metrics, Baselines (B0–B5), EvaluationReport & Chapter-5 Performance/Load Benchmarks
│   ├── export/               # Multi-format report exporters (JSON, CSV, PDF, DOCX, Auto-Healed DOCX, Class CSV/ZIP)
│   ├── extraction/           # Hybrid parsing (GROBID 0.9.1 TEI XML + PyMuPDF + TCVN3/VNI + DOCX/BibTeX/RIS + 12 styles)
│   ├── linking/              # Bidirectional in-text <-> bibliography CitationLinker (7 link statuses)
│   ├── logging.py            # Structured application logging configuration
│   ├── logic/                # NeuroSymbolicChecker, SymbolicRules (R01–R30+), VNLegalVerifier, HybridMLScorer, PlattCalibrator, CISCalculator
│   ├── matching/             # RapidFuzz lexical, Sentence-BERT + Multilingual MiniLM ONNX INT8, VI<->EN Bridge, AuthorMatcher, VenueNormalizer
│   ├── models/               # Pydantic & dataclass domain models
│   ├── pipeline/             # IntegrityPipeline end-to-end async orchestrator & report cache
│   ├── retrieval/            # Domain-routed 15+ scholarly/technical APIs + SSRF-safe HTML/Wayback LinkValidator
│   └── worker.py             # Standalone background verification worker process
├── web/                      # React 18 + TypeScript + Vite + Tailwind CSS frontend (340+ Vitest tests)
├── scripts/                  # Corpus ingestion, 120K Neuro-Symbolic training, NFR benchmarks & maintenance utilities
├── configs/                  # YAML configurations (config.yaml, config.example.yaml, config.docker.yaml)
├── docs/                     # Categorized docs (architecture/, reference/, reports/, plans/, screenshots/) — see docs/README.md
└── tests/                    # 2,100+ unit & integration tests
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
# Lint backend, tests, and scripts (0 errors required)
.venv/bin/python -m ruff check src/ tests/ scripts/

# Run full backend unit & integration test suite (2,100+ tests)
.venv/bin/python -m pytest tests/ -q

# Run frontend ESLint, TypeScript check, Vitest suite (340+ tests), and production build
cd web && npm run lint && npx tsc --noEmit && npx vitest run && npm run build

# Run pipeline on a manuscript (.pdf / .docx / .bib / .ris)
.venv/bin/python -m integrity_checker.pipeline.integrity_pipeline thesis.pdf --output reports/thesis.json

# Launch full Docker stack (GROBID :8070 + FastAPI :8000 + React Web :5173)
docker compose up -d --build
```
