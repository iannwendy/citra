<div align="center">

# CITRA — Verify Every Citation. Trace Every Source.

**Explainable Neuro-Symbolic Citation & Source Integrity Verification Platform · GROBID TEI-XML · Federated Scholarly Retrieval · Hybrid ML Calibration**

[![Python](https://img.shields.io/badge/Python-3.11+-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.110+-009688?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![React](https://img.shields.io/badge/React-18.3-61DAFB?style=for-the-badge&logo=react&logoColor=0B0B0A)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://typescriptlang.org)
[![GROBID](https://img.shields.io/badge/GROBID-0.9.1_TEI--XML-E34F26?style=for-the-badge)](https://github.com/grobidOrg/grobid)
[![Sentence-BERT](https://img.shields.io/badge/SBERT-MiniLM--L6--v2_%2B_ONNX_INT8-FF6F00?style=for-the-badge)](https://sbert.net)
[![SQLite FTS5](https://img.shields.io/badge/ACL_Anthology-128K+_Papers_FTS5-003B57?style=for-the-badge&logo=sqlite&logoColor=white)](https://aclanthology.org)
[![Benchmark](https://img.shields.io/badge/Benchmark-120%2C000_Samples_%C2%B7_99.02%25_Neuro--Symbolic_%C2%B7_99.75%25_OOD_%C2%B7_0.0395_ECE-6B21A8?style=for-the-badge)](./data/models/neuro_symbolic_benchmark_report.json)
[![PDF Corpus](https://img.shields.io/badge/PDF_Stress_Corpus-310_PDFs_%C2%B7_12_Styles_%C2%B7_100%25_Hard_Cases-0F766E?style=for-the-badge)](#3-310-pdf-multi-style--vietnamese-legal-corpus-evaluation-real-world--hard-case-stress-tests)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://docker.com)
[![Pytest](https://img.shields.io/badge/Tests-2%2C320_Backend_%C2%B7_487_Frontend_%C2%B7_20_E2E_Suites-0A0A0A?style=for-the-badge&logo=pytest&logoColor=00E676)](./tests)

*An editorial-grade academic citation debugger and thesis integrity verification workspace engineered for researchers, instructors, and university committees — combining structural PDF parsing, smart domain-aware retrieval across 15+ scholarly & technical databases (including DataCite, DOAJ, OpenAIRE/HAL, NCBI/bioRxiv, Hugging Face, IETF RFC, Wayback Machine, and Retraction Watch), and transparent 5-stage Neuro-Symbolic decision traces.*

<br/>

[![Live Production Demo](https://img.shields.io/badge/Live%20Demo-citra.io.vn-00E676?style=for-the-badge&logo=googlechrome&logoColor=black)](https://citra.io.vn)
[![API Documentation](https://img.shields.io/badge/REST%20%26%20SSE%20API-Reference-009688?style=for-the-badge&logo=fastapi&logoColor=white)](#api-reference--automated-testing)

<br/>

[🌐 Live Demo (citra.io.vn)](https://citra.io.vn) · [Visual Demo](#visual-demo--ui-walkthrough) · [Feature Matrix](#complete-feature-matrix) · [Neuro-Symbolic Architecture](#neuro-symbolic-architecture--cis-scoring) · [Quick Start](#quick-start--deployment) · [Demo Credentials](#default-demo-credentials) · [API & Docs](#api-reference--automated-testing)

</div>

---

![CITRA Landing Hero — Light Mode](./docs/screenshots/01-landing-light.png)

---

## Table of Contents

1. [Overview & Brand Philosophy](#overview--brand-philosophy)
2. [Visual Demo & UI Walkthrough](#visual-demo--ui-walkthrough)
3. [Complete Feature Matrix](#complete-feature-matrix)
4. [Neuro-Symbolic Architecture & CIS Scoring](#neuro-symbolic-architecture--cis-scoring)
5. [Real-World Evaluation & Benchmark Metrics](#real-world-evaluation--benchmark-metrics)
6. [Tech Stack](#tech-stack)
7. [Repository Structure](#repository-structure)
8. [Live Production Demo](#live-production-demo)
9. [Quick Start & Deployment](#quick-start--deployment)
10. [Default Demo Credentials](#default-demo-credentials)
11. [Docker Services & Port Matrix](#docker-services--port-matrix)
12. [API Reference & Automated Testing](#api-reference--automated-testing)
13. [Documentation Index & Contributors](#documentation-index--contributors)

---

## Overview & Brand Philosophy

**CITRA** (*Essay Integrity Checker v3.90.0*) is a full-stack academic citation verification and bibliographic debugging platform developed as a Capstone Graduation Thesis (*Đồ án Tốt nghiệp CNTT*) at **Ton Duc Thang University (TDTU)**.

Large Language Models (LLMs) frequently hallucinate plausible-sounding references, conflate author lists, or fabricate publication years (`METADATA_ERROR` / `SUSPECTED_HALLUCINATION`). Meanwhile, traditional similarity checkers (e.g., Turnitin) measure text overlap rather than verifying whether cited references actually exist in canonical scholarly registries or whether in-text citations map cleanly to the bibliography.

### Design Philosophy — *Solva Warm Editorial & SourceLogic Scholarly*
- **Warm Editorial Precision**: Engineered around the **Solva Warm Editorial** design system (`#FAF8F3` warm ivory canvas, `#252523` charcoal ink, `#35624D` botanical forest accents, *Sentient* editorial serif display, *Plus Jakarta Sans* UI, and *JetBrains Mono* telemetry) with painterly botanical frames and live count-up metrics.
- **Two-Layer Separation of Concerns**: Strictly decouples **Layer 1: In-Text Citation Mapping** (`MATCHED`, `MISSING_REFERENCE`, `UNCITED_REFERENCE`, `IN_TEXT_MISMATCH`, `DUPLICATE_REFERENCE`, `AMBIGUOUS_MAPPING`, `STYLE_INCONSISTENT`, `UNRESOLVED`) from **Layer 2: Reference Entry Validation** (`VERIFIED`, `METADATA_ERROR`, `RESOURCE`, `SUSPECTED_HALLUCINATION`, `UNRESOLVED`), eliminating double-counting when a reference is cited multiple times.
- **No Black-Box Verdicts**: Every reference entry exposes a **5-Stage Neuro-Symbolic Logic Trace & Evidence DAG** (`Stage 1: Structural Parse` → `Stage 2: Multi-Source Retrieval` → `Stage 3: 16D Feature Vector` → `Stage 4: 68 Symbolic Rules (16 Groups) & ML Scorer` → `Stage 5: Platt-Calibrated Verdict`), side-by-side canonical vs. cited diffs, **1-Click Bibliography Auto-Remediation** (`APA`, `IEEE`, `TDTU`, `.bib`, `.ris`), and **Auto-Healed `.DOCX` manuscript export**.
- **Three Role-Based Portals + Live Sandbox**:
  1. **Researcher / Student Workspace (`/dashboard`, `/sandbox`, `/verification/report/:id`)**: Test citations in the **Live Citation Sandbox** (sampling real papers from `129,125` local scholarly records / `128,105` unique-title papers or generating synthetic multi-page academic PDFs), upload single or batch PDF/DOCX manuscripts, inspect citation errors in a split-pane IDE, and export auto-repaired bibliographies.
  2. **Teacher Cohort Classroom (`/teacher/classes`, `/teacher/reviews`)**: Manage thesis cohorts via join codes, detect **Cross-Student Shared AI Hallucinations**, and adjudicate flagged verdicts in the **Pending Reviews** queue with human-in-the-loop audit notes.
  3. **Admin Platform Control (`/admin/system`, `/admin/users`, `/admin/audit`)**: Monitor external API latencies, verdict telemetry distributions, IAM user role & subscription tier assignments, and immutable system audit trails.
- **Decision-Support Compliance**: All reports and exports include a mandatory bilingual compliance notice affirming that CITRA is a decision-support tool and final academic evaluation rests with qualified faculty.

---

## Visual Demo & UI Walkthrough

> All 18 screenshots below are captured directly from the live production platform at [**`https://citra.io.vn`**](https://citra.io.vn) (`1440×900 @ 2x Retina`) inspecting real undergraduate theses and research manuscripts.

### 1. Solva Warm Editorial Landing Page — Botanical Hero & 3-Pillar Architecture Bento (`/`)
Editorial academic typography (*Sentient* serif display, *Plus Jakarta Sans* UI, and *JetBrains Mono* telemetry) paired with botanical painterly frames, live animated verification mockups, and interactive count-up telemetry.

| Editorial Hero & Live Verification Mockup (`/`) | 3-Pillar Floral Architecture Bento (`/#architecture`) |
| :---: | :---: |
| ![Landing Hero](./docs/screenshots/01-landing-light.png) | ![Architecture Bento](./docs/screenshots/02-landing-dark.png) |

---

### 2. Verification Workspace Dashboard & Multi-Manuscript Batch Queue (`/dashboard`, `/batch-upload`)
Track workspace-wide Citation Integrity Scores (`CIS`), monthly plan quotas, and recent manuscript audits, or upload multiple PDF/DOCX manuscripts for concurrent batch verification with optional classroom assignment.

| Workspace Dashboard (`/dashboard`) | Batch Verification Queue (`/batch-upload`) |
| :---: | :---: |
| ![Workspace Dashboard](./docs/screenshots/03-dashboard-light.png) | ![Batch Upload Queue](./docs/screenshots/04-batch-upload.png) |

---

### 3. Live Citation Sandbox & Synthetic Academic PDF Generator (`/sandbox`)
Sample `10–20` authentic papers directly from the local **`129,125`-record (`128,105` unique-paper) ACL Anthology & scholarly FTS5 database**, inject controlled Layer-1/Layer-2 defense error suites (year drift, author swap, fabricated hallucination, orphan in-text, uncited reference), and synthesize a complete academic PDF manuscript on the fly.

<div align="center">

![Live Citation Sandbox & Synthetic PDF Generator](./docs/screenshots/13-live-sandbox.png)

</div>

---

### 4. Citation Debugger IDE — Hallucination Detection & Side-by-Side Metadata Diff (`/verification/report/:id`)
The split-pane **Reference Inspector** highlights exact discrepancies between the manuscript's bibliography and canonical scholarly records across 15+ databases (Local ACL FTS5, Crossref, OpenAlex, DataCite, DOAJ, OpenAIRE/HAL, NCBI/bioRxiv, DBLP, arXiv, OpenLibrary, Europe PMC, Hugging Face, IETF RFC, Global DOI RA).

| Hallucinated / Fabricated Reference (`HALLUCINATION`) | Venue / Year / Author Mismatch (`METADATA_ERROR`) |
| :---: | :---: |
| ![Hallucination Inspector](./docs/screenshots/05-verification-report.png) | ![Metadata Diff Inspector](./docs/screenshots/06-reference-inspector.png) |

---

### 5. 1-Click Bibliography Auto-Remediation Studio & Two-Layer Citation Network Explorer
Automatically repair mismatched years, titles, authors, venues, and DOIs into standardized **APA 7th**, **IEEE Numeric**, **Harvard / TDTU**, **BibTeX (`.bib`)**, **RIS (`.ris`)**, or download an **Auto-Healed `.DOCX` manuscript**, and explore the **Two-Layer Citation & Source Network Graph (DAG)**.

| 1-Click Bibliography Auto-Remediation Studio (`Auto-Fix & BibTeX`) | Two-Layer Citation & Source Network Explorer (`Citation Graph`) |
| :---: | :---: |
| ![1-Click Auto-Remediation Studio](./docs/screenshots/17-auto-remediation-bibtex.png) | ![Citation & Evidence Network Explorer](./docs/screenshots/18-citation-evidence-graph.png) |

---

### 6. 5-Stage Neuro-Symbolic Logic Trace & Split-Pane Document Context Stream (`/trace`, `/document`)
Inspect every intermediate signal in the 5-stage pipeline (`Layer 1 GROBID TEI`, `Federated Retrieval`, `Neural Similarity & Link Check`, `68 Symbolic Rules`, and `Platt-Calibrated Verdict`) alongside the exact manuscript paragraph context and citation intent (`methodology`, `result_comparison`, `background`).

| 5-Stage Neuro-Symbolic Logic Trace (`/verification/report/:id/trace`) | Split-Pane Document Context Stream (`/verification/report/:id/document`) |
| :---: | :---: |
| ![Neuro-Symbolic Logic Trace](./docs/screenshots/07-logic-trace.png) | ![Document Context Inspector](./docs/screenshots/09-document-inspector.png) |

---

### 7. Diagnostic Issues Triage Hub & Bidirectional Consistency Matrix (`/issues`, `/consistency`)
Triage all flagged anomalies by severity (`Critical — Suspected Hallucination`, `Warning — Metadata Drift`, `Info`) and verify bipartite graph consistency between in-text markers and bibliography entries (`Correctly Linked`, `Citations Without Reference`, `Uncited References`).

| Actionable Diagnostic Issues Hub (`/verification/report/:id/issues`) | Bidirectional Consistency Matrix (`/verification/report/:id/consistency`) |
| :---: | :---: |
| ![Diagnostic Issues Hub](./docs/screenshots/12-diagnostic-issues.png) | ![Consistency Check](./docs/screenshots/08-consistency-check.png) |

---

### 8. Teacher Cohort Classroom, Shared AI Hallucination Radar & Faculty Adjudication Queue
Manage entire thesis defense cohorts via join codes (`CITRA-1001`), monitor cohort CIS distributions and 5-year citation recency, detect **Shared AI Hallucinations across multiple student submissions**, and adjudicate contested verdicts in the **Pending Reviews** queue.

| Cohort Analytics & Shared Hallucination Radar (`/teacher/classes/1`) | Faculty Adjudication & Pending Reviews Queue (`/teacher/reviews`) |
| :---: | :---: |
| ![Teacher Classroom](./docs/screenshots/10-teacher-classroom.png) | ![Teacher Pending Reviews](./docs/screenshots/14-teacher-pending-reviews.png) |

---

### 9. Academic Subscription Plans, Admin Telemetry & IAM Account Directory (`/pricing`, `/admin/*`)
Flexible academic plans (**Basic Free**, **Pro Scholar**, **Ultra Lab/Faculty**) powered by Stripe checkout, paired with real-time platform telemetry (`/admin/system`) and Role-Based Access Control (`RBAC`) user administration (`/admin/users`).

| Academic Pricing & Subscription Plans (`/pricing`) | IAM Identity Directory & Role Management (`/admin/users`) |
| :---: | :---: |
| ![Pricing & Subscription Plans](./docs/screenshots/15-pricing-subscription.png) | ![Admin Account Management](./docs/screenshots/16-admin-accounts-audit.png) |

<div align="center">

![Admin System Health](./docs/screenshots/11-admin-system-health.png)

</div>

---

## Complete Feature Matrix

| Domain | Capability | Implementation Details |
| :--- | :--- | :--- |
| **Document Parsing** | **Multi-Modal PDF & DOCX Extraction** | **GROBID 0.9.1 TEI-XML** deep structural parsing with automatic **PyMuPDF (`fitz`)** + `python-docx` fallback; 2-column reading-order reconstruction; supports Vietnamese & English section headers (`Tài liệu tham khảo`, `References`, `Bibliography`). |
| **Citation Formats** | **12 Citation Styles + Vietnamese Legal Docs** | Auto-detects **IEEE** (`[1]`, `[1]-[3]`), **APA 7th** (`(Smith et al., 2020)`), **Vancouver**, **Harvard**, **MLA 9th**, **Chicago**, **ACM**, **Nature**, **ACS**, **AMA**, **CSE**, and **Vietnamese Legal Documents** (`Luật số`, `Nghị định`, `Thông tư`, `Bản án` per TDTU standards). |
| **Smart Retrieval** | **15+ Federated Scholarly Indexes, Retraction Watch & Active Link Validation** | Local **ACL Anthology & Scholarly SQLite FTS5** (`129,125` records / `128,105` unique papers with `82,877` full abstracts) + **Crossref**, **OpenAlex**, **DataCite** (Zenodo/Figshare/OSF), **Global DOI RA & CSL-JSON** (JaLC/CNKI/mEDRA/KISTI), **DOAJ**, **OpenAIRE Graph & HAL**, **NCBI Entrez & bioRxiv/medRxiv**, **DBLP**, **arXiv**, **OpenLibrary**, **Europe PMC**, **Hugging Face Hub**, **IETF Datatracker RFC & PyPI**, and **SerpApi Google Scholar** fallback, paired with **Retraction Watch Detection** (`is_retracted`) and active **HTTP + Wayback Machine Link Validation** (`HTTP 200 OK`, `403 Restricted/Paywall`, `Archived Alive`, `404 Dead Link`, `Fake Domain`). |
| **Deep Neural Layer** | **Sentence-Level Evidence, Intent, Stance & Cross-Lingual Bridge** | **Sentence-BERT (`all-MiniLM-L6-v2`)** focal-sentence vs. abstract sentence-level max-pooling (`best_evidence_sentence`), **Citation Intent Classification** (`background`, `methodology`, `result_comparison`), **Claim Stance & Polarity Verification** (`supported`, `partially_supported`, `contradiction_risk`), **Vietnamese ↔ English Semantic Bridging**, **Multi-Occurrence Aggregation**, and **Implicit Body Passage Discovery** for uncited references. |
| **Neuro-Symbolic Verification** | **16D Feature Vector + 68 Symbolic Rules + Platt Calibration** | Combines **Sentence-BERT + Multilingual MiniLM ONNX INT8** neural evidence & title alignment (+ **Monolingual Specificity Gate**), **RapidFuzz**, **AuthorMatcher**, and **VenueNormalizer** with **68 deterministic Symbolic Rules across 16 priority groups** (`R-RETRACTED-PAPER`, `R-WAYBACK-ARCHIVED`, `R-GLOBAL-DOI-RA-VERIFIED`, `R-HF-VERIFIED`, `R-RFC-VERIFIED`, etc.) and a **Multinomial Logistic Regression + Logit-Space Platt Scaling** scorer trained on **120,000 paper- & title-disjoint samples** (`Acc = 99.02%` / `Macro-F1 = 0.9888` Unified Neuro-Symbolic, outperforming Pure ML `B5` on **both** ID (`97.98%` Acc / `0.9802` Macro-F1, `p < 0.001`) and OOD Hard-Guardrail (`99.75%` vs. `49.88%`), `100.00%` (`120/120`) E2E Gold Acc, `ECE = 0.0395`, `Brier = 0.0125`). |
| **Live Sandbox** | **Interactive ACL Sandbox & Synthetic PDF Generator** | Sample `10–20` real papers from the local `129,125`-record (`128,105` unique-paper) ACL Anthology & scholarly database (`/sandbox`), inject controlled Layer-1/Layer-2 anomalies (`Sửa sai Năm`, `Sửa sai Tác giả`, `Bịa nguồn giả`, `Uncited Ref`, `Orphan In-text`), verify instantaneously, or synthesize a complete multi-page academic PDF manuscript. |
| **Auto-Remediation** | **1-Click Bibliography Auto-Fix & Auto-Healed `.DOCX`** | Automatically repairs mismatched publication years, titles, author lists, venues, and DOIs using canonical records, outputting standardized **APA 7th**, **IEEE**, **Harvard/TDTU**, **BibTeX (`.bib`)**, **RIS (`.ris`)**, and one-click **Auto-Healed `.DOCX` manuscripts with change logs**. |
| **Interactive IDE** | **6 Specialized Inspection Views** | **Split-Pane Reference Debugger** (side-by-side diff), **Two-Layer Citation & Source Network Graph (DAG)**, **1-Click Auto-Remediation Studio**, **5-Stage Logic Trace**, **Diagnostic Issues Hub**, **Bipartite Consistency Matrix**, and **Document Context Stream + Inline PDF Page Preview**. |
| **Role-Based Portals & Billing** | **Student, Teacher, Admin & Stripe Tiers** | JWT + Google OAuth authentication, **Batch Upload**, **Teacher Cohort Analytics & Cross-Student Shared Hallucination Radar**, **Faculty Pending Review Overrides**, **Stripe Subscription Plans (`Basic`, `Pro`, `Ultra`)**, and **Admin System Telemetry & Audit Logs**. |
| **Export & Reporting** | **Multi-Format Compliance Exports** | One-click export of full verification reports to **JSON**, **CSV**, **PDF**, **DOCX**, **Auto-Healed `.DOCX`**, and **Class Gradebook `.CSV`/`.ZIP`** (`src/integrity_checker/export/`). |

---

## Neuro-Symbolic Architecture & CIS Scoring

### End-to-End Verification Pipeline

```
Manuscript (PDF / DOCX)
   │
   ├─► 1. Structural Extraction (GROBID TEI-XML + PyMuPDF / DOCX Fallback)
   │      ├── Extract raw_references[] (Deduped & Normalized Bibliography)
   │      ├── Extract raw_citations[] (In-Text Markers + Word-Boundary De-Hyphenated Contexts)
   │      └── Detect Citation Style Profile (IEEE / APA / Vancouver / TDTU Legal)
   │
   ├─► 2. Layer 1 — In-Text Citation ↔ Bibliography Linker (CitationLinker)
   │      ├── Maps every in-text marker [k] or (Author, Year) to ReferenceEntry
   │      ├── Assigns CitationMappingStatus: MATCHED | AMBIGUOUS | MISSING_IN_BIBLIOGRAPHY
   │      └── Computes Multi-Occurrence Context Map & Uncited Reference Set (uncited_references[])
   │
   ├─► 3. Layer 2 — Smart Multi-Source Candidate Retrieval (RetrievalOrchestrator)
   │      ├── Pre-Screening: Web/URL Resource ([Online], GitHub, Docs) & VN Legal Classifier
   │      ├── Tier 0: Exact Identifier & Local FTS5 Lookup (128K+ Papers & Canonical Abstracts)
   │      ├── Tier 1: Domain-Prioritized Primary Search (Crossref + OpenAlex + DataCite + DOAJ + OpenAIRE/HAL + NCBI/bioRxiv + DBLP + OpenLibrary + Europe PMC + Hugging Face + IETF RFC/PyPI)
   │      └── Tier 2: Global DOI RA Content Negotiation (JaLC/CNKI/mEDRA) + Deep Search (arXiv + SerpApi Google Scholar) + Active HTTP & Wayback Machine LinkValidator
   │
   ├─► 4. Deep Neural Semantic & Symbolic Candidate Matching (SemanticMatcher + NeuroSymbolicChecker)
   │      ├── Deep Neural Layer (Sentence-BERT):
   │      │    ├── Focal Sentence Extraction & Cross-Lingual (VI ↔ EN) Academic Terminology Bridging
   │      │    ├── Sentence-Level Abstract Evidence Max-Pooling (best_evidence_sentence, best_evidence_score)
   │      │    ├── Citation Intent Classification (background | methodology | result_comparison)
   │      │    ├── Claim Stance & Polarity Verification (supported | partially_supported | contradiction_risk)
   │      │    └── Multi-Occurrence Aggregation & Implicit Body Passage Discovery for Uncited References
   │      ├── HybridMLScorer: 16D Feature Vector + Multinomial Logistic Regression + Platt Calibration
   │      └── Symbolic Guardrails: 68 Deterministic Rules across 16 Groups (Retraction Watch Veto, Wayback Link-Rot Rescue, DOI/URL Liveness, Year/Author/Venue Veto)
   │
   └─► 5. Validation Verdict & Composite CIS Calculation (CISCalculator)
          ├── Assigns ValidationLabel: VERIFIED | METADATA_ERROR | RESOURCE | SUSPECTED_HALLUCINATION | UNRESOLVED
          └── Generates 5-Component Citation Integrity Score (0–100) + Actionable Recommendations
```

### Deep Neural Semantic & Evidence Layer (5-Pillar Neural Engine)

Unlike traditional bibliographic checkers that only compare title strings—or basic semantic matchers that compare raw context windows against paper titles—CITRA's **Neural Pillar** (`src/integrity_checker/matching/semantic.py`) performs five specialized deep semantic tasks:

| Neural Capability | Technical Mechanism | Exposed Fields in `MatchFeatures` & UI |
| :--- | :--- | :--- |
| **1. Sentence-Level Evidence Extraction** | Cleans PDF line-wrap hyphenations, isolates the exact manuscript sentence containing the citation marker, encodes all sentences of the retrieved source paper's abstract with **Sentence-BERT (`all-MiniLM-L6-v2`)**, and applies **Max+Mean Sentence Pooling** (`max(whole_abs_sim, 0.65 * max_sent_sim + 0.35 * whole_abs_sim)`). | `best_cited_sentence`, `best_evidence_sentence`, `best_evidence_score`, `title_context_sim`, `abstract_context_sim` |
| **2. Citation Intent Classification** | Combines Sentence-BERT prototype centroid similarity with syntactic cue weighting (following the **SciCite / ACL-ARC** taxonomy) to classify *why* the student cited the source. | `citation_intent`: `background`, `methodology`, or `result_comparison` |
| **3. Claim Stance & Polarity Verification** | Verifies whether the student's claim aligns with or inverts the polarity of the matched evidence sentence in the source abstract (e.g., claiming a method is *"surprisingly effective"* when the source abstract concludes it *"fails / is ineffective"*). | `stance_label`: `supported`, `partially_supported`, `neutral`, or `contradiction_risk` |
| **4. Cross-Lingual Semantic Bridging (`VI ↔ EN`)** | Detects Vietnamese thesis prose citing English scholarly literature and projects Vietnamese computer science / AI terminology into the shared English Sentence-BERT embedding space prior to alignment scoring. | `cross_lingual_detected` (`VI ↔ EN Semantic Bridge` badge) |
| **5. Multi-Occurrence & Implicit Body Discovery** | Evaluates semantic alignment across **all** in-text occurrences of a reference (`occurrence_alignments`), and when a bibliography entry lacks an explicit `[k]` marker in the body, scans non-bibliography body pages via keyword pre-filtering + Sentence-BERT ranking to discover where the work was implicitly discussed. | `context_source` (`in_text_citation`, `multi_occurrence`, `implicit_body_discovery`), `occurrence_alignments[]` |

### Why Neuro-Symbolic Verification Instead of Generative RAG?

A common architectural question during thesis evaluation is: ***"Why does CITRA use a Neuro-Symbolic Retrieval + Verification architecture instead of standard Generative RAG (Retrieval-Augmented Generation with an LLM)?"***

1. **Retrieval-Augmented Verification (RAV) vs. Generative RAG**:
   - CITRA **does** implement the **Retrieval** and **Dense Neural Representation** pillars of RAG (federated multi-source retrieval across 15+ scholarly & technical registries + local SQLite FTS5 over `129,125` records / `128,105` unique papers + dense `Sentence-BERT + Multilingual MiniLM ONNX INT8` sentence-level evidence extraction).
   - However, instead of feeding retrieved records into a generative LLM (`Generation`) to produce free-text judgements, CITRA replaces the generative step with **Symbolic Formal Logic (68 deterministic rules across 16 priority groups) + Platt-Calibrated Probabilistic Scoring**.
2. **Eliminating Meta-Hallucination (Zero Hallucination-on-Hallucination)**:
   - Using an LLM generator to audit LLM-generated citations introduces **meta-hallucination** (the LLM judge may hallucinate that a fabricated paper exists, or forgive a `2002` vs. `2008` publication year discrepancy because the title sounds familiar).
   - Symbolic rules (`R-NONEXISTENT-DOI`, `R-DEAD-URL`, `R-YEAR-MISMATCH`, `R-AUTHOR-MISMATCH`) guarantee **100% deterministic reproducibility** on exact bibliographic constraints.
3. **Sub-Second Latency, Zero Token Cost & Full Audit Explainability**:
   - Verifying a 100-page thesis with 35–50 citations runs locally in seconds on CPU/MPS without external LLM API fees or privacy leakage, while outputting an auditable mathematical trace (`MatchFeatures`, `triggered_rules`, and side-by-side `Manuscript Focal Sentence` vs. `Matched Source Abstract Evidence`).

### Two-Layer Output Taxonomy

#### Layer 1: In-Text Citation Mapping (`CitationMappingStatus`)
| Status | Meaning | Impact on CIS |
| :--- | :--- | :--- |
| `MATCHED` | In-text citation marker resolves uniquely to a bibliography entry (`[k]` or `(Author, Year)`). | Full credit in `in_text_bib_consistency` (`25%`). |
| `AMBIGUOUS_MAPPING` | Multiple bibliography entries share identical `(Author, Year)` keys without disambiguating `a/b` suffixes. | Partial penalty (`0.05`) + remediation prompt. |
| `MISSING_REFERENCE` | Dangling in-text citation whose target key does not exist in the reference list. | Penalizes `in_text_bib_consistency` (`0.20`) + alerts reviewer. |
| `UNCITED_REFERENCE` | Bibliography entry never cited explicitly in the manuscript body. | Penalizes `in_text_bib_consistency` (`0.10`) + checks implicit body passages. |
| `IN_TEXT_MISMATCH` | Linked entry has author/year divergence between in-text marker and bibliography. | Penalizes `in_text_bib_consistency` (`0.15`). |
| `DUPLICATE_REFERENCE` | Duplicate bibliographic entries detected in the reference list. | Penalizes `in_text_bib_consistency` (`0.10`). |
| `STYLE_INCONSISTENT` | In-text marker deviates from the manuscript's high-confidence dominant citation style. | Minor format penalty (`0.02`) + style consistency hint. |
| `UNRESOLVED` | Insufficient bibliographic metadata exists to deterministically resolve mapping. | Neutral fallback (no CIS penalty). |

#### Layer 2: Bibliography Reference Validation (`ValidationLabel`)
| Verdict Label | Decision Criteria | Semantic Meaning |
| :--- | :--- | :--- |
| `VERIFIED` | Strong title/author/year/venue agreement across scholarly registries (`title_sim ≥ 0.85`, `author_sim ≥ 0.50`, `year_diff ≤ 1`) or verified preprint/edition match. | Confirmed scholarly publication with accurate bibliographic metadata. |
| `METADATA_ERROR` | Real paper found, but the citation contains wrong publication year, missing/swapped authors, retracted status, or mismatched venue/DOI/context. | Source exists, but bibliographic fields require correction (side-by-side diff provided). |
| `RESOURCE` | Non-article web resource (`[Online]`, GitHub, RFC/PyPI/TCVN standards, documentation) or Vietnamese Legal Statute (`Luật`, `Nghị định`, `Thông tư`). | Valid external/legal resource; evaluated via dedicated statute & link checks. |
| `SUSPECTED_HALLUCINATION` | Non-existent/fabricated DOI or fake domain, zero scholarly record across 15+ databases, or chimeric cross-work splicing. | Decision-support signal indicating a suspected hallucinated reference for faculty verification. |
| `UNRESOLVED` | Partial/ambiguous similarity in the `[0.40, 0.60)` abstention band or registered regional DOI lacking CSL metadata. | Insufficient evidence to verify or refute; abstains cleanly for human review. |

### 5-Component Citation Integrity Score (`CIS`) Formula

$$\text{CIS} = 100 \times \left( 0.35 \cdot S_{\text{verified\_ratio}} + 0.25 \cdot S_{\text{metadata\_accuracy}} + 0.25 \cdot S_{\text{in\_text\_bib\_consistency}} + 0.10 \cdot S_{\text{format\_consistency}} + 0.05 \cdot S_{\text{identifier\_validity}} \right)$$

- **Rubric Stability & Sensitivity Proof (`300 Manuscripts × 20 Simplex Perturbations`)**: Perturbing the canonical weights `(0.35, 0.25, 0.25, 0.10, 0.05)` by $\pm 0.05 / \pm 0.10$ across `20` normalized weight vectors yields **Mean Spearman's $\rho = 0.9987$** ($\min \rho = 0.9964$), **Mean Kendall's $\tau = 0.9765$** ($\min \tau = 0.9596$), and **Mean MAE = `1.7485` CIS points**, proving manuscript quality rankings are invariant to weight choice.

---

## Real-World Evaluation & Benchmark Metrics

### 1. Large-Scale 120,000-Sample Neuro-Symbolic Benchmark, OOD Guardrail Proof & Statistical Significance

> 📄 **Full Thesis-Ready Benchmark Report (Vietnamese & English Tables):** [**`docs/reports/BENCHMARK_120K_NEURO_SYMBOLIC_REPORT.md`**](./docs/reports/BENCHMARK_120K_NEURO_SYMBOLIC_REPORT.md) · Raw JSON Report: [**`data/models/neuro_symbolic_benchmark_report.json`**](./data/models/neuro_symbolic_benchmark_report.json) · Model Weights: [**`data/models/neuro_symbolic_weights.json`**](./data/models/neuro_symbolic_weights.json)

To rigorously evaluate the **Neuro-Symbolic Logic Checker**, **HybridMLScorer**, and **PlattCalibrator** without data leakage or single-feature shortcuts, we constructed a **120,000-sample scholarly benchmark** + **2,400-sample OOD Hard-Guardrail Stress Suite** ([`scripts/train_neuro_symbolic_model.py`](./scripts/train_neuro_symbolic_model.py)):

#### Methodological Alignment with International Scholarly Standards

| Methodological Aspect | Implementation in `train_neuro_symbolic_model.py` (`120,000` ID + `2,400` OOD Samples) | International Reference Standard |
| :--- | :--- | :--- |
| **1. Strict Stratified Paper- & Title-Disjoint Split (`0% Overlap`)** | From `129,125` records in `data/local_papers.db` (`98.43%` ACL Anthology; `128,105` valid unique-title papers: `82,877` full-abstract + `45,228` metadata-only), samples **`120,000` distinct real scholarly papers** (`80,000` full-abstract `>80` chars + `40,000` metadata-complete) and partitions **before** generating perturbations:<br>• **Train (`70%`)**: `84,000` papers (`56,000` full-abstract + `28,000` metadata)<br>• **Validation (`15%`)**: `18,000` papers (`12,000` full-abstract + `6,000` metadata)<br>• **Held-Out Test (`15%`)**: `18,000` papers (`12,000` full-abstract + `6,000` metadata)<br>• Programmatic set-intersection audit (`paper_id` & normalized title): `Train ∩ Val = 0`, `Train ∩ Test = 0`, `Val ∩ Test = 0`. | **SciFact** (*Wadden et al., EMNLP 2020*) & **FEVER** (*Thorne et al., NAACL 2018*) |
| **2. Zero 1-Way Feature Shortcut (`4-Class Context Alignment`)** | Stratifies full-abstract papers (`66.7%`) across **all 4 canonical classes** so authentic multi-sentence `Sentence-BERT` context-vs-abstract alignment (`content_alignment_score > 0`) occurs across every class (`VERIFIED`: `50.0%` [median `0.5840`], `METADATA_ERROR`: `44.9%` [median `0.4616`, incl. aligned contexts & 12-template verb-agnostic `R-CONTENT-MISMATCH`], `SUSPECTED_HALLUCINATION`: `8.8%` / `40%` of candidate-bearing `H2/H4` [median `0.2151`], `UNRESOLVED`: `23.2%` / `35%` of `U1` [median `0.3835`]; $P(\text{VERIFIED} \mid \text{score} > 0) = 54.06\%$). | **Poliak et al.** (*NAACL 2018*) & **Gururangan et al.** (*NAACL 2018*) |
| **3. Plausible Same-Domain Hallucinations & 15 Sub-Taxonomies** | Replaces synthetic templates with sanitized cross-paper spliced academic titles (`p1` lead + `p3` methodological tail), real scholar names (`[donor["authors"][0], donor["authors"][-1]]` disjoint from `p2`), real scholarly venues (`ACL`, `EMNLP`, `COLING`, `TACL`, `LREC`, `NAACL`), and bounded publication years (`1950 <= cited_year <= 2026`) strictly within the same split across `V1–V4` (`43,200`), `H1–H4` (`36,000`), `M1–M5` (`26,400`), and `U1–U2` (`14,400`). | **Walters & Wilder** (*Scientific Reports, 2023*) & **ALCE** (*Gao et al., EMNLP 2023*) |
| **4. Unclamped Feature Extraction & Unified `SymbolicRules`** | Encodes **`419,053` unique texts** (from `600,000` strings) via **`Sentence-BERT (all-MiniLM-L6-v2)`** on GPU (`mps`) with **zero `np.clip` clamping** and **zero stemmer pre-screening**. `BaselineRunner("proposed")` invokes the exact production `SymbolicRules` engine (`99.02%` Acc / `0.9888` Macro-F1 across both tables). | **Sentence-BERT** (*Reimers & Gurevych, EMNLP 2019*) |
| **5. Hyperparameter Tuning & Post-Hoc Platt Calibration** | • Grid-searches L2 regularization $C \in \{0.1, 0.25, 0.5, 1.0, 2.0, 5.0, 10.0\}$ for [`HybridMLScorer`](src/integrity_checker/logic/calibration.py) on **Validation (`18,000`)** $\rightarrow$ **$C = 2.0$** (`Val Macro-F1 = 0.9784`).<br>• Fits [`PlattCalibrator`](src/integrity_checker/logic/calibration.py) strictly on **Validation** $\rightarrow$ **$a = 1.807661, b = 1.115955$**. | **Platt Scaling** (*Platt, 1999*) & **Modern Neural Calibration** (*Guo et al., ICML 2017*) |
| **6. Paired Significance, OOD Stress (`N = 2,400`) & CIS Sensitivity** | Reports **Continuity-Corrected McNemar's $\chi^2$**, **1,000-Resample Paired Bootstrap $p$-values**, **Paired Wilcoxon Brier test**, **6-Category OOD Hard-Guardrail Stress Test**, and **300×20 CIS Sensitivity Analysis**. | **Dror et al.** (*ACL 2018*), **Berg-Kirkpatrick et al.** (*EMNLP 2012*) & **Dietterich** (*1998*) |

#### In-Distribution Ablation Study & Paired Statistical Significance ($N = 18,000$ Held-Out Test Papers)

| Method / Baseline | Description | Accuracy | Macro-P | Macro-R | **Macro-F1** | $\Delta\text{Macro-F1}$ (`Proposed - B`) & Paired Significance |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| **`B0` (`doi_only`)** | Exact DOI match only | `26.34%` | `0.2336` | `0.3496` | `0.1963` | **`+0.7925`** (`McNemar χ² = 13,033.17, p < 1e-16; Boot p < 0.001`) |
| **`B1` (`single_source_crossref`)** | Single-source lookup (`Crossref` only) | `58.11%` | `0.5626` | `0.4794` | `0.4513` | **`+0.5375`** (`McNemar χ² = 7,317.27, p < 1e-16; Boot p < 0.001`) |
| **`B3` (`embedding_only`)** | Pure neural `Sentence-BERT` cosine threshold on title | `66.86%` | `0.4930` | `0.5214` | `0.4585` | **`+0.5302`** (`McNemar χ² = 5,687.73, p < 1e-16; Boot p < 0.001`) |
| **`B4` (`no_calibration`)** | Multi-feature linear combination without abstention band | `80.13%` | `0.6212` | `0.6607` | `0.6269` | **`+0.3619`** (`McNemar χ² = 3,310.37, p < 1e-16; Boot p < 0.001`) |
| **`B2` (`fuzzy_only`)** | Lexical `RapidFuzz` title + `AuthorJaccard` only | `81.93%` | `0.6328` | `0.6811` | `0.6466` | **`+0.3422`** (`McNemar χ² = 2,988.50, p < 1e-16; Boot p < 0.001`) |
| **`B5` (`ml_hybrid`)** *(In-Dist.)* | `HybridMLScorer` (16D Logistic Regression, $C = 2.0$ — *collapses to `49.88%` on OOD below!*) | `97.98%` | `0.9805` | `0.9800` | `0.9802` | **`+0.0085`** (`McNemar χ² = 97.23, p = 6.17e-23; Boot p < 0.001`) |
| **`Proposed` (`Neuro-Symbolic`)** | **Production `SymbolicRules` + Verb-Agnostic Neural Specificity + HTTP Link Check + `PlattCalibrator` + Abstention** | **`99.02%`** | **`0.9894`** | **`0.9883`** | **`0.9888`** | *#1 on Both ID (`17,823 / 18,000`) & OOD (`2,394 / 2,400 = 99.75%`)* |

#### Per-Class Verification Performance, Confusion Matrix & 95% Bootstrap CI ($N = 18,000$ Test Samples)

| Canonical Verdict Class | Test Support ($N$) | Precision | Recall | **F1-Score** | Confusion Row (`VER` / `META` / `HAL` / `UNR`) & Safety Invariant |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **`VERIFIED`** | `6,480` | **`0.9846`** | **`0.9980`** | **`0.9913`** | `6,467 / 11 / 0 / 2` — **`0` legitimate `VERIFIED` papers accused as hallucinated; `0` fabrications marked `VERIFIED`** |
| **`SUSPECTED_HALLUCINATION`** | `5,400` | **`0.9993`** | **`0.9969`** | **`0.9981`** | `0 / 0 / 5,383 / 17` — `99.69%` recall & `99.93%` precision across plausible same-domain spliced hallucinations |
| **`METADATA_ERROR`** | `3,960` | **`0.9915`** | **`0.9684`** | **`0.9798`** | `101 / 3,835 / 4 / 20` — `99.15%` precision & `96.84%` recall across year, co-author, DOI-title, and 12-template `R-CONTENT-MISMATCH` errors |
| **`UNRESOLVED` *(Abstention)*** | `2,160` | **`0.9821`** | **`0.9898`** | **`0.9859`** | `0 / 22 / 0 / 2,138` — `98.98%` recall & `98.21%` precision across `U1` grey-zone (`R-ABSTENTION-BORDER`) & `U2` registry/429 abstentions |
| **Macro-Average / Total** *(1,000-Bootstrap 95% CI)* | **`18,000`** | **`0.9894`** | **`0.9883`** | **`0.9888`** `[0.9871, 0.9905]` | **Overall Accuracy: `99.02%`** (`0.9902`, `95% CI: [0.9887, 0.9916]`, `SE: ±0.0007`) |

#### Confidence Calibration Performance (Logit-Space Platt Scaling on $N = 18,000$ Test Samples)

Fitted Platt parameters on the `18,000`-sample Validation split: $a = 1.807661$, $b = 1.115955$ ([`data/models/neuro_symbolic_weights.json`](./data/models/neuro_symbolic_weights.json)).

| Configuration | Macro-F1 | **ECE** *(Expected Calibration Error)* | **Brier Score** | Acc @ `50%` Cov | Acc @ `70%` Cov | Acc @ `90%` Cov | Acc @ `95%` Cov | Acc @ `100%` Cov |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Neuro-Symbolic (Uncalibrated Raw Confidence)** | `0.9888` | `0.2445` | `0.0915` | `99.27%` | `99.03%` | `99.08%` | `99.11%` | `99.02%` |
| **Neuro-Symbolic (Platt-Calibrated Confidence)** | **`0.9888`** | **`0.0395`** *(↓ **6.19×**, $\Delta = -0.2050$, $p < 0.001$, CI `[0.0380, 0.0410]`)* | **`0.0125`** *(↓ **7.32×**, $\Delta = -0.0790$, Wilcoxon $p < 10^{-16}$, CI `[0.0113, 0.0137]`)* | **`99.18%`** | **`99.23%`** | **`99.31%`** | **`99.32%`** | **`99.02%`** |

#### Out-of-Distribution (OOD) Hard-Guardrail Stress Suite ($N = 2,400$ Samples from `test_papers`) — Empirical Proof Why Neuro-Symbolic Beats Pure ML `B5`

Even though Pure ML `B5` achieves `97.98%` on the 16D continuous in-distribution feature manifold, real-world academic verification requires first-order symbolic guardrails that continuous similarity vectors cannot represent. Evaluated strictly on `test_papers` (`6 categories × 400 = 2,400` samples, zero Train/Val overlap, zero manual field overrides):

| Real-World Symbolic Guardrail Category ($N = 400$ each) | Gold Label | Guardrail Rule | `B4` (`No Calib.`) | **Pure ML `B5`** | **`Neuro-Symbolic`** | **Gain ($\Delta = \text{NS} - \text{B5}$)** |
| :--- | :---: | :--- | :---: | :---: | :---: | :---: |
| **1. Retracted Scholarly Papers (`is_retracted=True`, exact DOI/title/authors)** | `metadata_error` | `R-RETRACTED-PAPER` | `0.00%` | **`0.00%`** *(400 `verified`)* | **`100.00%`** | **`+100.00%`** |
| **2. Chimeric Spliced DOIs (real contemporary DOI pasted onto fabricated paper)** | `suspected_hallucination` | `R-CHIMERIC-DOI-MISMATCH` | `0.00%` | **`64.25%`** *(125 `unresolved`, 18 `meta`)* | **`98.50%`** | **`+34.25%`** |
| **3. Fake / Placeholder RFC 2606 URLs (`example.com`, `.invalid`, `fake-*`)** | `suspected_hallucination` | `R-FAKE-URL` | `0.00%` | **`0.00%`** *(200 `verified`, 196 `meta`)* | **`100.00%`** | **`+100.00%`** |
| **4. Regional DOIs without CSL Metadata (`JaLC`, `KISTI`, `CNKI`, `mEDRA`)** | `unresolved` | `R-DOI-RA-NO-CSL` | `0.00%` | `100.00%`* | **`100.00%`** | `0.00%` |
| **5. Upstream HTTP 429 Rate-Limit Exhaustion (`api_exhausted=True`)** | `unresolved` | `R-RATE-LIMITED-ABSTAIN` | `0.00%` | `100.00%`* | **`100.00%`** | `0.00%` |
| **6. VN Statutory Authority & Code Mismatches (`parse_vn_legal_reference`, 0 overrides)** | `metadata_error` | `VNLegalVerifier` | `20.00%` | **`35.00%`** *(200 `hal`, 140 `meta`, 60 `ver`)* | **`100.00%`** | **`+65.00%`** |
| **Overall OOD Stress Suite ($N = 2,400$)** *(McNemar $\chi^2 = 1,189.04, p = 1.47 \times 10^{-260}$)* | **3 Active Labels** | **Symbolic + VNLegal** | `3.33%` | **`49.88%`** *(F1 `0.5256`)* | **`99.75%`** *(F1 `0.9975`)* | **`+49.88%` Acc / `+0.4719` F1** |

*\*Note: `B5` survives Categories 4 & 5 solely because the symbolic indicator `abstention_zone_indicator` (`vec[15]`) explicitly injects `registered_no_csl` and `api_exhausted` flags; without symbolic rules (`B4`), accuracy collapses to `3.33%` across the 2,400-sample suite.*

---

### 1B. Multi-Domain End-to-End Raw-Reference Gold Benchmark ($N = 120$ Refs, `7` Styles, `6` Domains) & Adversarial Suite ($N = 15$)

To evaluate the **complete raw-string pipeline** (`ReferenceListParser` + `parse_vn_legal_reference` $\rightarrow$ `RetrievalOrchestrator` $\rightarrow$ `NeuroSymbolicChecker`, preserving all **5 canonical labels** including `RESOURCE` with zero label-oracle access, verified in [`tests/unit/test_ground_truth_e2e_evaluation.py`](./tests/unit/test_ground_truth_e2e_evaluation.py)), we benchmarked [`scripts/evaluation/run_ground_truth_evaluation.py`](./scripts/evaluation/run_ground_truth_evaluation.py) on two curated raw-bibliography suites:

1. **Adversarial Field-Case Ground Truth ([`data/essays/adversarial_ground_truth.json`](./data/essays/adversarial_ground_truth.json), $N = 15$ across `essay_06..08`)**:
   - **5-Class End-to-End Accuracy:** **`100.00%` (`15 / 15`)**, Macro-F1 **`1.0000` (`100.00%`)** | **4-Class Scholarly (`N = 14`):** **`100.00%` (`14 / 14`)**, `ECE = 0.0875`, `Brier = 0.0138` (`~2.9s`).
2. **Multi-Domain End-to-End Raw-Reference Gold Benchmark ([`data/essays/end_to_end_gold_benchmark.json`](./data/essays/end_to_end_gold_benchmark.json), $N = 120$)**:
   - **5-Class End-to-End (`N = 120`):** **Accuracy = `100.00%` (`120 / 120`)** · Macro-P = **`100.00%`** · Macro-R = **`100.00%`** · **Macro-F1 = `100.00%`** (`ECE = 0.0902`, `Brier = 0.0220`, `~6.3s` cold CLI runtime).
   - **4-Class Scholarly (`N = 103`, excluding `17` `resource` items):** **Accuracy = `100.00%` (`103 / 103`)** · Macro-P = **`100.00%`** · Macro-R = **`100.00%`** · **Macro-F1 = `100.00%`**.
   - **Per-Label (`N = 120`):** `verified` (`N=31`): `100.00%` P/R/F1 · `metadata_error` (`N=30`): `100.00%` P/R/F1 · `suspected_hallucination` (`N=28`): `100.00%` P/R/F1 · `unresolved` (`N=14`): `100.00%` P/R/F1 · `resource` (`N=17`): `100.00%` P/R/F1.
   - **Per-Style Accuracy (`7` Styles):** `APA 7th` **`100.00%`** (`24/24`) · `TDTU Vietnamese` **`100.00%`** (`21/21`) · `IEEE` **`100.00%`** (`18/18`) · `Vancouver` **`100.00%`** (`15/15`) · `Chicago` **`100.00%`** (`15/15`) · `Harvard` **`100.00%`** (`14/14`) · `MLA 9th` **`100.00%`** (`13/13`).
   - **Per-Domain Accuracy (`6` Domains, `20` each):** `CS & AI/NLP` **`100.00%`** (`20/20`) · `Biomedical & Clinical` **`100.00%`** (`20/20`) · `Economics, Finance & Social Sciences` **`100.00%`** (`20/20`) · `Engineering & Physics` **`100.00%`** (`20/20`) · `Vietnamese Legal Statutes` **`100.00%`** (`20/20`) · `Technical Standards & Software` **`100.00%`** (`20/20`).

#### Threats to Validity & Methodological Transparency

- **Internal Validity (Controlled Semi-Synthetic vs. Organic Student Errors):** The `120,000`-sample benchmark applies controlled perturbations to real papers because no manually labeled $10^5$-scale citation error dataset exists publicly. To prevent shortcut learning, we enforce zero `np.clip`, zero stemmer pre-screening, `0/0/0` title/ID overlap, 4-class multi-sentence `Sentence-BERT` context alignment ($P(\text{VERIFIED} \mid \text{score} > 0) = 54.06\%$), 12 diverse natural academic citation templates (plus verb-free assertions), and same-domain spliced hallucinations with real scholar names, complemented by the `120`-ref raw-string E2E benchmark and `310` real/adversarial PDFs.
- **External Validity (`98.43%` CS/NLP Concentration in `local_papers.db`):** The offline SQLite FTS5 store (`129,125` records) is `98.43%` ACL Anthology (`127,102` CS/NLP papers). Cross-disciplinary generalization (Biomedical, Economics, Engineering, Vietnamese Law, Humanities) relies on CITRA's **15+ live federated APIs** (`Crossref`, `OpenAlex`, `Europe PMC`, `NCBI/bioRxiv`, `DOAJ`, `DataCite`, `OpenAIRE/HAL`, `OpenLibrary`, `Global DOI RA`, `VNLegalVerifier`), validated on the 6-domain `120`-ref E2E suite (`100.00%`) and `310`-PDF multi-style corpus.
- **Construct & Ecological Validity (Paywalled Abstracts & Live API Drift):** Commercial publisher paywalls can omit public abstracts, and third-party APIs experience index drift or `HTTP 429` bursts during thesis deadlines. CITRA mitigates these via 9-source `_enrich_missing_abstract` enrichment, non-penalizing missing-abstract guards, persistent singleflight caching, and `R-RATE-LIMITED-ABSTAIN` (`100.00%` safe abstention under HTTP 429 exhaustion).

---

### 2. Live End-to-End Verification Results Across Real PDF Manuscripts (`reports/*.json`)

All 5 benchmark PDFs in the repository root were verified end-to-end with live multi-source scholarly retrieval (`use_report_cache=False`) and the **Deep Neural Semantic & Evidence Layer**:

| Manuscript | Citation Style | Bibliography Entries | Verified | Metadata Error | Resource / URL | Hallucination | Avg / Max Neural Sim | **CIS Score** |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **`VietDepression_Research_Article.pdf`** | IEEE | 20 | **18** | 0 | 2 (`URL`) | 0 | `0.69` / **`0.86`** | **100.00 / 100** (`EXCELLENT`) |
| **`VietDepression_for_Detecting_Depression...pdf`** | IEEE | 20 | **18** | 0 | 2 (`URL`) | 0 | `0.69` / **`0.86`** | **100.00 / 100** (`EXCELLENT`) |
| **`TranThanhPhuoc_523H0002_523H0054.pdf`** | IEEE | 27 | **24** | 0 | 3 (`URL`) | 0 | `0.69` / **`0.86`** | **99.30 / 100** (`EXCELLENT`) |
| **`thesis.pdf`** *(Full Graduation Thesis)* | IEEE | 32 | **23** | **1** (`[29]`) | **6** (`Web/Docs`) | **2** (`[3],[6]`) | `0.53` / **`0.83`** | **92.80 / 100** (`EXCELLENT`) |
| **`523H0054_NguyenBaoMinh_523H0157_DinhDucMinh.pdf`** | IEEE | 5 | **5** | 0 | 0 | 0 | `0.56` / **`0.61`** | **77.50 / 100** (`GOOD`) |

> **Deep-Dive Neural & Symbolic Case Studies Across the 5 Root PDFs**:
> - **Sentence-Level Abstract Evidence Match (`TranThanhPhuoc_523H0002_523H0054.pdf`)**: All 24 academic citations match specific abstract evidence sentences (e.g., `[16] PhoBERT` achieves **`86%` neural alignment** (`99%` title, `90%` abstract, `92%` best evidence sentence) with `intent = methodology` and `stance = supported`).
> - **Implicit Body Passage Discovery (`523H0054_NguyenBaoMinh_523H0157_DinhDucMinh.pdf` & `TranThanhPhuoc...pdf`)**:
>   - In `523H0054_NguyenBaoMinh...pdf`, all 5 bibliography monographs lack explicit `[N]` markers in the body; the Neural Layer automatically discovers their corresponding body passages (`[1] Flanagan JavaScript` on p. 34 at `0.59`, `[3] Chacon Pro Git` on p. 41 at `0.61`).
>   - In `TranThanhPhuoc...pdf`, uncited reference `[8] Gururangan et al. (2020) — Don't stop pretraining` is automatically linked to the manuscript's discussion of **Domain-Adaptive Pretraining (DAPT)** on **page 89** (`score = 0.60`, `context_source = implicit_body_discovery`).
> - **Multi-Occurrence & Symbolic Veto (`thesis.pdf`)**:
>   - Evaluates up to **6 in-text occurrences per reference** (`multi_occurrence`), verifying whether every citation site in the 100-page thesis aligns with the source abstract.
>   - **`[29] Chawla, N. V. (2008). Data mining for imbalanced datasets...` → `METADATA_ERROR`**: Canonical paper publication year/author discrepancy flagged deterministically alongside `39%` neural alignment (`partially_supported`).
>   - **`[3] Stanley, K. O. (2024)` & `[6] Laird, J. E. (2022)` → `SUSPECTED_HALLUCINATION`**: Fabricated/non-existent combinations flagged by symbolic guardrails.

---

### 3. 310-PDF Multi-Style & Vietnamese Legal Corpus Evaluation (Real-World + Hard-Case Stress Tests)

Beyond synthetic benchmarks and individual root PDFs, CITRA's structural extraction, bibliography segmentation, multi-style reference parser, and bidirectional citation linker were stress-tested and self-improved against a **310-PDF real-world & adversarial evaluation corpus** ([`scripts/evaluate_all_corpora.py`](./scripts/evaluate_all_corpora.py), [`scripts/evaluate_vn_legal_reports.py`](./scripts/evaluate_vn_legal_reports.py)):

1. **30 Real Vietnamese Legal Manuscripts (`vn_legal_reports/`)**: Peer-reviewed articles, student theses, and legal reports from *Tạp chí Tòa án nhân dân*, *Tạp chí Công Thương*, *Tạp chí Khoa học Pháp lý Việt Nam (HCMULAW)*, and *Kinh tế & Dự báo* covering Civil, Criminal, Land, Labor, Intellectual Property, and Enterprise Law.
2. **220 Real Multi-Style Academic PDFs (`style_corpora/<STYLE>/real/`)**: `20` authentic open-access PDFs for **each of the 11 citation styles** (`APA`, `IEEE`, `Vancouver`, `Chicago`, `Harvard`, `MLA`, `ACM`, `Nature`, `CSE`, `ACS`, `AMA`).
3. **60 Adversarial / Hard-Case Diagnostic PDFs (`12 Styles × 5 PDFs`)**: Generated with [`scripts/generate_style_hard_cases.py`](./scripts/generate_style_hard_cases.py) paired with exact ground-truth JSON specifications (`397` references) to test all 5 validation verdicts (`VERIFIED`, `METADATA_ERROR`, `HALLUCINATION`, `UNVERIFIED_EXTERNAL`, `UNRESOLVED`) and all 3 Layer-1 mapping states (`MATCHED`, `AMBIGUOUS`, `MISSING_IN_BIBLIOGRAPHY`).

#### Overall Corpus Summary & Self-Improvement Progression

| Evaluation Corpus | PDFs | Bib Section Detected | Total Extracted Refs | Matched Refs (`Layer 1`) | Matched In-Text Citations (`Layer 1`) |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **VN Legal Real Corpus *(Baseline Before Self-Improvement)*** | `30` | `27 / 30` (`90.0%`) | `164` *(15 Legal)* | `73 / 164` (`44.5%`) | `109 / 235` (`46.4%`) |
| **VN Legal Real Corpus *(After Self-Improvement — MVP)*** | **`30`** | **`30 / 30` (`100.0%`)** | **`258` *(91 Legal — 6.1× ↑)*** | **`197 / 258` (`76.4%`)** | **`403 / 416` (`96.9%`)** |
| **Adversarial Hard-Case Diagnostic Suite (`12 Styles × 5 PDFs`)** | **`60`** | **`60 / 60` (`100.0%`)** | **`397 / 397` (`100.0%` exact)** | **`60 / 60` PDFs (`100.0%`)** | **`60 / 60` PDFs (`100.0%` scenarios)** |
| **Multi-Style Real Academic Corpus (`11 Styles × 20 PDFs`)** | **`220`** | **`215 / 220` (`97.7%`)** | **`8,126` refs** | **`6,768 / 8,126` (`83.3%`)** | **`8,954 / 12,770` (`70.1%`)** |

#### Per-Style Breakdown Across 220 Real Academic PDFs & 60 Hard-Case PDFs

| Citation Style | Real PDFs | Real Bib Section | Real Extracted Refs | Real Matched Refs (`%`) | Real Matched Body (`%`) | Hard-Case Exact Refs & Linking (`5 PDFs/Style`) |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **`VN_LEGAL`** *(Vietnamese Legal & TDTU)* | `30` | **`30 / 30` (`100%`)** | `258` *(91 Legal)* | `197` (**`76.4%`**) | `403 / 416` (**`96.9%`**) | **`5 / 5` (`100%` Exact Refs & Linking)** |
| **`Vancouver`** *(Biomedical Numbered)* | `20` | **`20 / 20` (`100%`)** | `967` | `955` (**`98.8%`**) | `989 / 1,035` (**`95.6%`**) | **`5 / 5` (`100%` Exact Refs & Linking)** |
| **`ACS`** *(Chemistry Superscript / Numbered)* | `20` | **`20 / 20` (`100%`)** | `1,276` | `1,241` (**`97.3%`**) | `1,206 / 2,328` (`51.8%`) | **`5 / 5` (`100%` Exact Refs & Linking)** |
| **`AMA`** *(Medical Superscript Numbered)* | `20` | **`20 / 20` (`100%`)** | `781` | `673` (**`86.2%`**) | `690 / 705` (**`97.9%`**) | **`5 / 5` (`100%` Exact Refs & Linking)** |
| **`APA`** *(7th Ed. Author–Date)* | `20` | **`20 / 20` (`100%`)** | `758` | `631` (**`83.2%`**) | `936 / 1,280` (**`73.1%`**) | **`5 / 5` (`100%` Exact Refs & Linking)** |
| **`CSE`** *(Council of Science Editors)* | `20` | **`20 / 20` (`100%`)** | `377` | `309` (**`82.0%`**) | `690 / 1,790` (`38.5%`) | **`5 / 5` (`100%` Exact Refs & Linking)** |
| **`ACM`** *(Computing `[N]` Bracketed)* | `20` | `19 / 20` (`95%`) | `591` | `480` (**`81.2%`**) | `598 / 732` (**`81.7%`**) | **`5 / 5` (`100%` Exact Refs & Linking)** |
| **`IEEE`** *(Engineering `[N]` Bracketed)* | `20` | **`20 / 20` (`100%`)** | `592` | `474` (**`80.1%`**) | `889 / 970` (**`91.6%`**) | **`5 / 5` (`100%` Exact Refs & Linking)** |
| **`Harvard`** *(Author–Date Parenthetical)* | `20` | **`20 / 20` (`100%`)** | `812` | `642` (**`79.1%`**) | `929 / 1,149` (**`80.9%`**) | **`5 / 5` (`100%` Exact Refs & Linking)** |
| **`MLA`** *(9th Ed. Author–Page)* | `20` | **`20 / 20` (`100%`)** | `609` | `474` (**`77.8%`**) | `876 / 1,275` (**`68.7%`**) | **`5 / 5` (`100%` Exact Refs & Linking)** |
| **`Nature`** *(Superscript Numbered)* | `20` | `19 / 20` (`95%`) | `933` | `700` (**`75.0%`**) | `690 / 698` (**`98.9%`**) | **`5 / 5` (`100%` Exact Refs & Linking)** |
| **`Chicago`** *(Author–Date & Notes)* | `20` | `17 / 20` (`85%`) | `430` | `189` (`44.0%`) | `461 / 808` (`57.1%`) | **`5 / 5` (`100%` Exact Refs & Linking)** |

> **Key Structural & Algorithmic Innovations Driven by the 310-PDF Stress Test**:
> - **2-Column PDF Reading-Order Reconstruction (`mupdf_parser.py`)**: Automatically detects multi-column layouts where PDF producers emit the right column before the left column (common in Vietnamese legal journals) and restores strict `Top-Full-Width → Left-Column → Right-Column → Bottom-Full-Width` reading order.
> - **Mid-Page Bibliography Splitting (`section_segmenter.py`)**: Preserves body text and in-text citations appearing *above* a `TÀI LIỆU THAM KHẢO` or `REFERENCES` heading on the same page (`pre_header_body_text`), preventing loss of concluding body citations.
> - **Agency-First & Multi-Section Vietnamese Legal Parser (`patterns/apa.py`, `reference_parser.py`)**: Supports agency-first citations (`Quốc hội (2020), Luật Doanh nghiệp...`, `Tòa án nhân dân cấp cao tại TP. Hồ Chí Minh (2022), Bản án số...`), legal abbreviations (`BLDS`, `BLHS`, `BLLĐ`, `LDN`, `LĐĐ`), multi-section Roman headers (`I. Văn bản pháp luật` / `II. Tài liệu tham khảo`), and inline footnote-superscript resolution (`...quy định.4` → `[4]`).
> - **Flattened Superscript & Standalone-Dot Reference Recovery (`document_parser.py`, `reference_parser.py`)**: Recovers attached word/punctuation superscripts (`results1–3`, `reported.12,15`) in `Nature`, `AMA`, and `ACS` manuscripts as well as PDF layouts where reference numbers `1.` appear on standalone lines above the reference body.

---

## Tech Stack

| Layer | Technologies |
| :--- | :--- |
| **Frontend (`web/`)** | React 18.3, TypeScript 5.8, Vite 5, Tailwind CSS 3.4, Radix UI Primitives, Lucide Icons, Solva Warm Editorial (`Sentient` 134-glyph VI Serif + `Onest` Sans + `JetBrains Mono`), `<251 kB` Acyclic Code-Split Bundle |
| **Backend API (`src/integrity_checker/api/`)** | Python 3.11+, FastAPI, Uvicorn, Pydantic v2, SQLAlchemy 2.0 (SQLite WAL + PostgreSQL ready), JWT Auth (`PyJWT`, `bcrypt`), Google OAuth2, Server-Sent Events (SSE) |
| **Document Parsing & NLP** | GROBID 0.9.1 (TEI-XML REST Service), PyMuPDF (`fitz`) + TCVN3/VNI decoder + selective OCR, `pdfplumber`, `python-docx`, BibTeX/RIS parsers, `RapidFuzz`, `defusedxml` |
| **Neuro-Symbolic & ML Engine** | `sentence-transformers` (`all-MiniLM-L6-v2` + `paraphrase-multilingual-MiniLM-L12-v2` ONNX INT8), `scikit-learn` & `scipy` (`HybridMLScorer` Multinomial Logistic Regression + `PlattCalibrator`), 16D Feature Engineering, `68` Deterministic Symbolic Rules (16 Groups) |
| **Scholarly Knowledge & APIs** | SQLite FTS5 (`129,125` records / `128,105` unique papers with `82,877` full abstracts), Crossref, OpenAlex, DataCite, Global DOI RA, DOAJ, OpenAIRE/HAL, NCBI/bioRxiv, DBLP, arXiv, OpenLibrary, Europe PMC, Hugging Face, IETF RFC/PyPI, Wikidata/OpenCitations, Serper/SerpApi Scholar, SSRF-safe HTML & Wayback `LinkValidator` |
| **Testing & DevOps** | Pytest (`2,320` passed / `2,330` backend unit & integration tests), Vitest (`487` passed across `63` files), Playwright E2E (`20` spec suites), Ruff, Mypy, Docker Compose & GitHub Actions CI/CD |

---

## Repository Structure

```text
essay-integrity-checker/
├── docker-compose.yml                  # Orchestrates web (:5173), api (:8000), and grobid (:8070)
├── docker-compose.prod.yml             # Production Nginx + TLS + FastAPI + GROBID deployment stack
├── Dockerfile                          # Python 3.11 + FastAPI + Sentence-BERT/ONNX backend image
├── pyproject.toml                      # Python package metadata (v3.90.0), Ruff/Pytest config & `essay-check` CLI
├── CLAUDE.md                           # AI / Developer architectural quick-reference
├── README.md                           # Project documentation (this file)
├── src/
│   └── integrity_checker/
│       ├── api/                        # FastAPI routers (auth, billing, essays, report, verdicts, teacher, users, audit, system, cache, export, health)
│       ├── billing/                    # Plan quotas (Basic/Pro/Ultra), Stripe & VNPay v2.1.0 HMAC-SHA512 verification
│       ├── database/                   # Local ACL Anthology & scholarly SQLite FTS5 store (`local_papers.db`)
│       ├── db/                         # SQLAlchemy 2.0 ORM models, Alembic/SQLite migrations, WAL tuning & Repository
│       ├── evaluation/                 # Metrics, Baselines (B0–B5), EvaluationReport & Chapter-5 Performance/Load Benchmarks
│       ├── export/                     # Multi-format exporters (JSON, CSV, PDF, DOCX, Auto-Healed DOCX, Class CSV/ZIP)
│       ├── extraction/                 # GROBID TEI-XML parser, PyMuPDF, PdfPlumber, DOCX, BibTeX/RIS & 12 style patterns
│       ├── linking/                    # Bidirectional in-text <-> bibliography CitationLinker (8 link statuses)
│       ├── logic/                      # NeuroSymbolicChecker, SymbolicRules (68 R-* rules), VNLegalVerifier, HybridMLScorer, PlattCalibrator, CISCalculator
│       ├── matching/                   # RapidFuzz lexical, Sentence-BERT + Multilingual ONNX INT8, VI<->EN Bridge, AuthorMatcher, VenueNormalizer
│       ├── models/                     # Domain models (Citation, SourceCandidate, SourceResult, CitationVerdict, AnalysisReport)
│       ├── pipeline/                   # IntegrityPipeline end-to-end async orchestrator & SHA-256 report cache
│       ├── retrieval/                  # 15+ federated scholarly/technical clients, singleflight cache & SSRF-safe LinkValidator
│       ├── config.py                   # Centralized Pydantic Settings (YAML + environment overrides)
│       ├── logging.py                  # Structured Loguru logging setup
│       └── worker.py                   # Standalone background verification queue worker
├── web/                                # React 18 + TypeScript + Vite + Tailwind CSS frontend (`CITRA`)
│   ├── src/
│   │   ├── api/                        # Typed REST/SSE API client (`client.ts`)
│   │   ├── components/                 # Shared UI primitives, Sandbox, Auto-Remediation, Modals & Graphs
│   │   ├── contexts/                   # AuthContext, VerificationProgressContext (SSE), Theme & Language contexts
│   │   ├── hooks/                      # RBAC (`useRole`), quota & workspace hooks
│   │   ├── pages/                      # Landing, Dashboard, BatchUpload, EssayPage, Issues, Trace, Orphan, Inspector, Teacher*, Admin*
│   │   └── router.tsx                  # Protected role-gated SPA routing
│   └── package.json
├── scripts/                            # DB builders (`build_local_db.py`, `import_openalex.py`), 120K training (`train_neuro_symbolic_model.py`), NFR benchmarks
├── tests/
│   ├── unit/                           # 2,050+ fast isolated backend unit & regression tests
│   └── integration/                    # 52 end-to-end API, Auth, GROBID & PDF pipeline integration tests
├── docs/                               # Organized documentation hub (see docs/README.md)
│   ├── architecture/                   # System concepts, RBAC, SaaS, performance & format guides
│   ├── reference/                      # TDTU & 12 international citation style specifications
│   ├── reports/                        # 120K benchmark, live audits & thesis progress reports
│   ├── plans/                          # Design specs & phased implementation plans
│   └── screenshots/                    # High-resolution live UI screenshots
└── reports/                            # Verified JSON audit reports for the 5 benchmark PDFs
```

---

## Live Production Demo

The platform is deployed and running on Google Cloud Platform (GCP Compute Engine with Docker Compose, Nginx reverse proxy, and Let's Encrypt SSL):

- 🌐 **Web Application**: [https://citra.io.vn](https://citra.io.vn)
- 📚 **REST & SSE API Reference**: [Key REST & SSE Endpoints](#api-reference--automated-testing) *(interactive Swagger UI `/docs` is enabled in local/dev at `http://localhost:8000/docs` and disabled in `APP_ENV=production`)*
- 🩺 **Production API Health**: [https://citra.io.vn/api/health](https://citra.io.vn/api/health)

On **`https://citra.io.vn`**, evaluators can immediately try the unauthenticated **Live Citation Sandbox**, **Sign in with Google**, or **Register** a new account. *(Note: the [Default Demo Credentials](#default-demo-credentials) below are seeded exclusively in local/development environments and disabled in production.)*

---

## Quick Start & Deployment

### Option 1: Full-Stack Docker Compose (Recommended)

Launch the entire 3-service stack (**React Web UI**, **FastAPI Backend**, and **GROBID 0.9.1 Server**) with a single command:

```bash
# 1. Clone the repository
git clone https://github.com/iannwendy/citra.git
cd citra

# 2. Copy environment configuration
cp .env.example .env

# 3. Build and start all services
docker compose up -d --build
```

Once running:
- **CITRA Web Application**: [http://localhost:5173](http://localhost:5173)
- **FastAPI Interactive Swagger UI**: [http://localhost:8000/docs](http://localhost:8000/docs)
- **GROBID TEI-XML Health Check**: [http://localhost:8070/api/isalive](http://localhost:8070/api/isalive)

---

### Option 2: Local Development (Python `.venv` + Vite Dev Server)

#### 1. Start GROBID (via Docker) & Backend API
```bash
# Start GROBID container on port 8070
docker compose up -d grobid

# Create virtual environment and install package in editable mode (CPU PyTorch + ONNX Runtime)
python3 -m venv .venv
source .venv/bin/activate
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install -e ".[dev,onnx]"

# Launch FastAPI server on port 8000
uvicorn integrity_checker.api.main:app --reload --port 8000
```

#### 2. Start React Frontend (`web/`)
```bash
cd web
npm install
npm run dev
# Open http://localhost:5173
```

---

### Option 3: Command-Line Interface (`essay-check`)

Run verification directly from the terminal on any PDF or DOCX manuscript:

```bash
# Verify a single PDF and export structured JSON report
essay-check thesis.pdf --output reports/thesis_report.json

# Force fresh verification (bypass report cache) with verbose logging
essay-check TranThanhPhuoc_523H0002_523H0054.pdf --no-cache -v
```

---

### Option 4: Building the Local ACL Anthology FTS5 Knowledge Base (Optional)

Build or inspect the local `128K+` paper SQLite FTS5 index (`data/local_papers.db`) for sub-millisecond offline NLP/CS verification:

```bash
python scripts/build_local_db.py --acl-only --db-path data/local_papers.db
python scripts/build_local_db.py --stats
```

---

## Default Demo Credentials

In local/development environments (`APP_ENV=development`), the database automatically seeds three role-based accounts on startup (`src/integrity_checker/db/session.py` — disabled in `APP_ENV=production`) so you can immediately explore every portal locally:

| Role | Email | Password | Portal Access |
| :--- | :--- | :--- | :--- |
| **Administrator** | `admin@example.com` | `admin123` | Full access to **Workspace**, **Teacher Classroom**, and **Admin Control** (`/admin/health`, `/admin/users`, `/admin/audit`, `/admin/promos`) |
| **Teacher / Advisor** | `teacher@example.com` | `teacher123` | **Workspace**, **Batch Upload**, **My Classes** (`/teacher/classes`), and **Pending Reviews** (`/teacher/reviews`) |
| **Student / Researcher** | `user@example.com` | `user123` | Standard **Verification Workspace** (`/dashboard`), **Live Sandbox** (`/sandbox`), **Batch Upload** (*Pro/Ultra*), and **Report History** (`/history`) |

---

## Docker Services & Port Matrix

| Container Name | Service | Image / Build | Host Port | Internal Port | Purpose |
| :--- | :--- | :--- | :---: | :---: | :--- |
| `integrity-web` | `web` | `node:20-alpine` (Vite React TS) | `5173` | `5173` | Interactive CITRA Frontend IDE & Role Portals |
| `integrity-api` | `api` | `Dockerfile` (Python 3.11 + FastAPI) | `8000` | `8000` | Neuro-Symbolic Pipeline, REST/SSE API, SQLite ORM & FTS5 |
| `essay-check-grobid` | `grobid` | `grobid/grobid:0.9.1-crf` | `8070` | `8070` | Deep CRF Structural PDF-to-TEI-XML Parsing (Multi-Arch) |

---

## API Reference & Automated Testing

### Key REST & SSE Endpoints (`/api/*`)

| Method | Endpoint | Description |
| :---: | :--- | :--- |
| `POST` | `/api/auth/login` | Authenticate user credentials and issue JWT Bearer session (`POST /api/auth/google` for OAuth2) |
| `POST` | `/api/essays` | Upload & queue a `.pdf`, `.docx`, `.bib`, or `.ris` manuscript (optional `class_id`) |
| `GET` | `/api/essays/{id}/events` | Real-time **Server-Sent Events (SSE)** 8-step verification progress stream |
| `GET` | `/api/essays` | List verified manuscripts, statuses, and summary metrics for the current user |
| `GET` | `/api/essays/{id}/report` | Retrieve full two-layer verification report or download `?format=pdf\|docx\|csv\|json` |
| `POST` | `/api/essays/{id}/export-healed-docx` | Download auto-remediated `.DOCX` manuscript with standardized bibliography (`APA`, `IEEE`, `TDTU`) |
| `POST` | `/api/essays/{id}/verdicts/{verdict_id}/override` | Instructor / Admin human-in-the-loop verdict override with CIS recalculation & audit log |
| `GET / POST` | `/api/teacher/classes` | Manage thesis cohort classrooms (`PATCH / DELETE /api/teacher/classes/{id}`, `export.csv`, `export.zip`) |
| `GET` | `/api/audit/log` | Query immutable verdict override & administrative audit trail |
| `GET` | `/api/system/health` | Live admin telemetry across GROBID, SQLite WAL/FTS5, circuit breakers, and external APIs (`GET /api/health` public liveness) |

### Running the Automated Test Suite & 120,000-Sample Benchmark

The repository includes **2,320 passing backend unit & integration tests** (across a `2,330`-test suite), **487 frontend Vitest tests across 63 suites**, and **20 Playwright end-to-end browser suites** covering extraction, style detection, federated retrieval, SSRF-safe link validation, 16D feature matching, 68 symbolic rules, Platt calibration, CIS calculation, RBAC/billing security, Tailwind v3.4 + `<500 kB` bundle hygiene, and responsive Light/Dark UI:

```bash
# Lint & static type check backend, tests, and scripts (0 errors)
.venv/bin/python -m ruff check src/ tests/ scripts/
.venv/bin/python -m mypy src/integrity_checker

# Run the complete backend test suite (2,320 passed, 0 failed)
.venv/bin/python -m pytest tests/ -q

# Re-train & evaluate the 120,000-sample paper- & title-disjoint Neuro-Symbolic benchmark
.venv/bin/python scripts/train_neuro_symbolic_model.py

# Run frontend ESLint, TypeScript check, Vitest unit suite (487 passed / 63 files), & production build
cd web && npm run lint && npx tsc --noEmit && npx tsc -p tsconfig.e2e.json --noEmit && npx vitest run && npm run build
```

---

## Documentation Index & Contributors

### Architectural & Engineering Documentation ([`docs/README.md`](./docs/README.md))
- [**`docs/README.md`**](./docs/README.md) — Complete categorized index of architecture guides, citation standards, audit/benchmark reports, and implementation plans.
- [**`docs/reports/BENCHMARK_120K_NEURO_SYMBOLIC_REPORT.md`**](./docs/reports/BENCHMARK_120K_NEURO_SYMBOLIC_REPORT.md) — Complete 120,000-sample Neuro-Symbolic benchmark methodology, international standards alignment, ablation study, confusion matrix, and 95% bootstrap confidence intervals (ready for thesis/publication inclusion).
- [**`docs/reports/BAO_CAO_TIEN_DO_TUAN_25_10_01_11.md`**](./docs/reports/BAO_CAO_TIEN_DO_TUAN_25_10_01_11.md) & [**`docs/reports/BAO_CAO_TIEN_DO_01_11_15_11.md`**](./docs/reports/BAO_CAO_TIEN_DO_01_11_15_11.md) — Engineering & thesis progress reports covering the VI↔EN Cross-Lingual Bridge, 15+ federated scholarly APIs, and 1,064-PDF stress-test audits.
- [**`CLAUDE.md`**](./CLAUDE.md) — Developer & AI Agent quick-reference guide to the CITRA Neuro-Symbolic architecture.
- [**`docs/architecture/SOURCELOGIC_CONCEPT.md`**](./docs/architecture/SOURCELOGIC_CONCEPT.md) — Design system specification for the *SourceLogic Scholarly* UI.
- [**`docs/architecture/TEACHER_SYSTEM.md`**](./docs/architecture/TEACHER_SYSTEM.md) — Role-Based Access Control (`user` / `teacher` / `admin`), classroom cohort management, and pending review workflows.
- [**`docs/architecture/PREMIUM_SUBSCRIPTION_PLAN.md`**](./docs/architecture/PREMIUM_SUBSCRIPTION_PLAN.md) — SaaS tier architecture (`Basic` / `Pro` / `Ultra`), quota gating, and dual-mode Stripe billing specification.
- [**`docs/architecture/PERFORMANCE_AND_SEO_OPTIMIZATION.md`**](./docs/architecture/PERFORMANCE_AND_SEO_OPTIMIZATION.md) — 5-layer production performance optimization (TanStack Query cache sharing, SQLite FTS5 RAM cache, composite B-Tree indexes, N+1 batch loading, and Technical SEO).
- [**`docs/architecture/format_development_guide.md`**](./docs/architecture/format_development_guide.md) — Developer guide for extending modular citation format patterns in `src/integrity_checker/extraction/patterns/`.
- [**`docs/reference/tai_lieu_tham_khao_TDTU.md`**](./docs/reference/tai_lieu_tham_khao_TDTU.md) & [**`docs/reference/citation-styles.md`**](./docs/reference/citation-styles.md) — Ton Duc Thang University (TDTU) official citation guidelines and 12 international citation style specifications.

### Contributors — Capstone Graduation Thesis (ĐATN)
**Faculty of Information Technology — Ton Duc Thang University (TDTU)**

| Full Name | Student ID | Role |
| :--- | :---: | :--- |
| **Nguyễn Bảo Minh** | `523H0054` | Co-Author · Neuro-Symbolic Pipeline, Multi-Source Retrieval & Full-Stack Engineering |
| **Trần Gia Thành** | `523H0096` | Co-Author · Citation Extraction, ML Calibration, Benchmark Evaluation & Frontend IDE |
| **ThS. Võ Thị Kim Anh** | *Advisor (GVHD)* | Thesis Supervisor · Faculty of Information Technology, Ton Duc Thang University |

---

<div align="center">

**CITRA — Academic Source Verification Workspace**  
*Built with precision for scholarly integrity at Ton Duc Thang University (TDTU).*

</div>
