"""Hard-case scenarios, known ground-truth tests, and real PDF before/after benchmark
for the 9 free scholarly & technical API integrations.
"""

from __future__ import annotations

from pathlib import Path

import fitz  # PyMuPDF

from integrity_checker.extraction.document_parser import DocumentParser
from integrity_checker.linking.citation_linker import CitationLinker
from integrity_checker.linking.statuses import CitationMappingStatus
from integrity_checker.logic.cis import CISCalculator
from integrity_checker.logic.neuro_symbolic_checker import NeuroSymbolicChecker
from integrity_checker.models.citation import Citation, CitationStyle, CitationType
from integrity_checker.models.source import SourceCandidate, SourceResult
from integrity_checker.models.validation import ValidationLabel


def _make_citation(
    cid: int,
    raw_ref: str,
    title: str,
    authors: list[str],
    year: int,
    doi: str | None = None,
    url: str | None = None,
    venue: str | None = None,
) -> Citation:
    return Citation(
        raw_text=raw_ref,
        citation_type=CitationType.REFERENCE_LIST,
        style=CitationStyle.IEEE,
        authors=authors,
        year=str(year),
        title=title,
        venue=venue,
        doi=doi,
        url=url,
        order_index=cid,
        numeric_index=cid,
        raw_in_text_citation=f"[{cid}]",
    )


class TestKnownGroundTruthHardCases:
    """Tests 11 challenging citations where expected verdicts are strictly known in advance."""

    def setup_method(self) -> None:
        self.checker = NeuroSymbolicChecker(
            enable_content_alignment=False,
            enable_calibration=False,
        )

    def test_case_1_zenodo_dataset_doi_verified_via_datacite(self) -> None:
        """Hard Case 1: Zenodo software/dataset DOI (10.5281/zenodo.*) resolved via DataCite."""
        citation = _make_citation(
            cid=1,
            raw_ref="[1] Nguyen, A., & Tran, B. (2024). Vietnamese Academic Integrity Benchmark Dataset. Zenodo. https://doi.org/10.5281/zenodo.7654321",
            title="Vietnamese Academic Integrity Benchmark Dataset",
            authors=["Nguyen, A.", "Tran, B."],
            year=2024,
            doi="10.5281/zenodo.7654321",
            venue="Zenodo",
        )
        source = SourceResult(
            citation_raw=citation.raw_text,
            candidates=[
                SourceCandidate(
                    source_name="datacite",
                    found=True,
                    title="Vietnamese Academic Integrity Benchmark Dataset",
                    authors=["Nguyen, A.", "Tran, B."],
                    year="2024",
                    doi="10.5281/zenodo.7654321",
                    venue="Zenodo",
                    abstract="Curated benchmark dataset for evaluating citation verification systems.",
                    confidence=0.95,
                )
            ],
            sources_queried=["crossref", "openalex", "datacite"],
            sources_succeeded=["datacite"],
        )

        verdict = self.checker.check(citation, source, mapping_status=CitationMappingStatus.MATCHED)
        assert verdict.label == ValidationLabel.VERIFIED
        assert "R-DOI-TITLE-AUTHOR" in verdict.triggered_rules
        assert verdict.confidence >= 0.85

    def test_case_2_retracted_lancet_paper_trap_downgraded_to_metadata_error(self) -> None:
        """Hard Case 2: Infamous retracted paper with exact DOI/title/authors MUST NOT be VERIFIED."""
        citation = _make_citation(
            cid=2,
            raw_ref="[2] Mehra, M. R., Desai, S. S., Ruschitzka, F., & Patel, A. N. (2020). Hydroxychloroquine or chloroquine with or without a macrolide for treatment of COVID-19: a multinational registry analysis. The Lancet. https://doi.org/10.1016/S0140-6736(20)31180-6",
            title="Hydroxychloroquine or chloroquine with or without a macrolide for treatment of COVID-19: a multinational registry analysis",
            authors=["Mandeep R Mehra", "Sapan S Desai", "Frank Ruschitzka", "Amit N Patel"],
            year=2020,
            doi="10.1016/s0140-6736(20)31180-6",
            venue="The Lancet",
        )
        source = SourceResult(
            citation_raw=citation.raw_text,
            candidates=[
                SourceCandidate(
                    source_name="openalex",
                    found=True,
                    title="Hydroxychloroquine or chloroquine with or without a macrolide for treatment of COVID-19: a multinational registry analysis",
                    authors=["Mandeep R Mehra", "Sapan S Desai", "Frank Ruschitzka", "Amit N Patel"],
                    year="2020",
                    doi="10.1016/s0140-6736(20)31180-6",
                    venue="The Lancet",
                    external_ids={"is_retracted": "true"},
                    confidence=0.95,
                )
            ],
            sources_queried=["crossref", "openalex"],
            sources_succeeded=["openalex"],
            is_retracted=True,
        )

        verdict = self.checker.check(citation, source, mapping_status=CitationMappingStatus.MATCHED)
        assert verdict.label == ValidationLabel.METADATA_ERROR
        assert verdict.is_retracted is True
        assert "R-RETRACTED-PAPER" in verdict.triggered_rules
        assert "retracted_paper" in verdict.mismatched_fields
        assert "RETRACTED" in verdict.reasoning.upper()

    def test_case_3_biorxiv_preprint_verified_with_ncbi_abstract(self) -> None:
        """Hard Case 3: Cold Spring Harbor 10.1101/* bioRxiv preprint verified via NcbiBiorxivClient."""
        citation = _make_citation(
            cid=3,
            raw_ref="[3] Jumper, J., Evans, R., & Hassabis, D. (2023). Accurate structure prediction of biomolecular interactions. bioRxiv. https://doi.org/10.1101/2023.05.15.540821",
            title="Accurate structure prediction of biomolecular interactions",
            authors=["John Jumper", "Richard Evans", "Demis Hassabis"],
            year=2023,
            doi="10.1101/2023.05.15.540821",
            venue="bioRxiv",
        )
        source = SourceResult(
            citation_raw=citation.raw_text,
            candidates=[
                SourceCandidate(
                    source_name="ncbi_biorxiv",
                    found=True,
                    title="Accurate structure prediction of biomolecular interactions",
                    authors=["John Jumper", "Richard Evans", "Demis Hassabis"],
                    year="2023",
                    doi="10.1101/2023.05.15.540821",
                    venue="bioRxiv",
                    abstract="We present an updated diffusion architecture for biomolecular interactions.",
                    confidence=0.95,
                )
            ],
            sources_queried=["ncbi_biorxiv"],
            sources_succeeded=["ncbi_biorxiv"],
        )

        verdict = self.checker.check(citation, source, mapping_status=CitationMappingStatus.MATCHED)
        assert verdict.label == ValidationLabel.VERIFIED
        assert verdict.confidence >= 0.85

    def test_case_4_regional_vietnamese_oa_journal_verified_via_doaj(self) -> None:
        """Hard Case 4: Vietnamese/Regional Open Access journal without Crossref metadata verified via DOAJ."""
        citation = _make_citation(
            cid=4,
            raw_ref="[4] Le, H. P., & Pham, M. T. (2023). Applying PhoBERT for Vietnamese Legal Document Classification. Journal of Computer Science and Cybernetics.",
            title="Applying PhoBERT for Vietnamese Legal Document Classification",
            authors=["Le, H. P.", "Pham, M. T."],
            year=2023,
            venue="Journal of Computer Science and Cybernetics",
        )
        source = SourceResult(
            citation_raw=citation.raw_text,
            candidates=[
                SourceCandidate(
                    source_name="doaj",
                    found=True,
                    title="Applying PhoBERT for Vietnamese Legal Document Classification",
                    authors=["Le, H. P.", "Pham, M. T."],
                    year="2023",
                    venue="Journal of Computer Science and Cybernetics",
                    confidence=0.90,
                )
            ],
            sources_queried=["crossref", "openalex", "doaj"],
            sources_succeeded=["doaj"],
        )

        verdict = self.checker.check(citation, source, mapping_status=CitationMappingStatus.MATCHED)
        assert verdict.label == ValidationLabel.VERIFIED

    def test_case_5_doctoral_dissertation_verified_via_openaire_hal(self) -> None:
        """Hard Case 5: Doctoral Thesis / Dissertation verified via OpenAIRE & HAL Open Science."""
        citation = _make_citation(
            cid=5,
            raw_ref="[5] Moreau, C. (2023). Neuro-Symbolic Verification of Scientific Claims in Doctoral Theses. PhD Thesis, Universite Paris-Saclay.",
            title="Neuro-Symbolic Verification of Scientific Claims in Doctoral Theses",
            authors=["Claire Moreau"],
            year=2023,
            venue="Universite Paris-Saclay",
        )
        source = SourceResult(
            citation_raw=citation.raw_text,
            candidates=[
                SourceCandidate(
                    source_name="openaire_hal",
                    found=True,
                    title="Neuro-Symbolic Verification of Scientific Claims in Doctoral Theses",
                    authors=["Claire Moreau"],
                    year="2023",
                    venue="Universite Paris-Saclay",
                    external_ids={"hal_id": "tel-04123456"},
                    confidence=0.90,
                )
            ],
            sources_queried=["openaire_hal"],
            sources_succeeded=["openaire_hal"],
        )

        verdict = self.checker.check(citation, source, mapping_status=CitationMappingStatus.MATCHED)
        assert verdict.label == ValidationLabel.VERIFIED

    def test_case_6_huggingface_model_verified_with_r_hf_verified(self) -> None:
        """Hard Case 6: Hugging Face Hub AI model repository verified with R-HF-VERIFIED."""
        citation = _make_citation(
            cid=6,
            raw_ref="[6] Nguyen, D. Q., & Nguyen, A. T. (2020). vinai/phobert-base: Pre-trained language models for Vietnamese. Hugging Face Hub. https://huggingface.co/vinai/phobert-base",
            title="vinai/phobert-base: Pre-trained language models for Vietnamese",
            authors=["Dat Quoc Nguyen", "Anh Tuan Nguyen"],
            year=2020,
            url="https://huggingface.co/vinai/phobert-base",
            venue="Hugging Face Hub",
        )
        source = SourceResult(
            citation_raw=citation.raw_text,
            candidates=[
                SourceCandidate(
                    source_name="huggingface",
                    found=True,
                    title="vinai/phobert-base: Pre-trained language models for Vietnamese",
                    authors=["Dat Quoc Nguyen", "Anh Tuan Nguyen"],
                    year="2020",
                    venue="Hugging Face Hub (Model)",
                    external_ids={"hf_id": "vinai/phobert-base"},
                    confidence=0.92,
                )
            ],
            sources_queried=["huggingface"],
            sources_succeeded=["huggingface"],
        )

        verdict = self.checker.check(citation, source, mapping_status=CitationMappingStatus.MATCHED)
        assert verdict.label == ValidationLabel.VERIFIED
        assert "R-HF-VERIFIED" in verdict.triggered_rules

    def test_case_7_ietf_rfc_9110_verified_with_r_rfc_verified(self) -> None:
        """Hard Case 7: IETF RFC 9110 technical standard verified with R-RFC-VERIFIED."""
        citation = _make_citation(
            cid=7,
            raw_ref="[7] Fielding, R., Nottingham, M., & Reschke, J. (2022). RFC 9110: HTTP Semantics. IETF.",
            title="RFC 9110: HTTP Semantics",
            authors=["Roy T. Fielding", "Mark Nottingham", "Julian Reschke"],
            year=2022,
            doi="10.17487/RFC9110",
            venue="IETF RFC 9110",
        )
        source = SourceResult(
            citation_raw=citation.raw_text,
            candidates=[
                SourceCandidate(
                    source_name="tech_standard",
                    found=True,
                    title="RFC 9110: HTTP Semantics",
                    authors=["R. Fielding", "M. Nottingham", "J. Reschke"],
                    year="2022",
                    doi="10.17487/rfc9110",
                    venue="IETF RFC 9110",
                    external_ids={"rfc": "RFC9110"},
                    confidence=0.95,
                )
            ],
            sources_queried=["tech_standard"],
            sources_succeeded=["tech_standard"],
        )

        verdict = self.checker.check(citation, source, mapping_status=CitationMappingStatus.MATCHED)
        assert verdict.label == ValidationLabel.VERIFIED

    def test_case_8_ietf_rfc_9110_wrong_year_flagged_as_metadata_error(self) -> None:
        """Hard Case 8: IETF RFC 9110 cited with wrong year (2018 vs official 2022) -> METADATA_ERROR."""
        citation = _make_citation(
            cid=8,
            raw_ref="[8] Fielding, R., Nottingham, M., & Reschke, J. (2018). RFC 9110: HTTP Semantics. IETF.",
            title="RFC 9110: HTTP Semantics",
            authors=["Roy T. Fielding", "Mark Nottingham", "Julian Reschke"],
            year=2018,  # Wrong year! RFC 9110 was published in June 2022
            venue="IETF RFC 9110",
        )
        source = SourceResult(
            citation_raw=citation.raw_text,
            candidates=[
                SourceCandidate(
                    source_name="tech_standard",
                    found=True,
                    title="RFC 9110: HTTP Semantics",
                    authors=["R. Fielding", "M. Nottingham", "J. Reschke"],
                    year="2022",
                    doi="10.17487/rfc9110",
                    venue="IETF RFC 9110",
                    external_ids={"rfc": "RFC9110"},
                    confidence=0.95,
                )
            ],
            sources_queried=["tech_standard"],
            sources_succeeded=["tech_standard"],
        )

        verdict = self.checker.check(citation, source, mapping_status=CitationMappingStatus.MATCHED)
        assert verdict.label == ValidationLabel.METADATA_ERROR
        assert "year" in verdict.mismatched_fields
        assert "R-RFC-VERIFIED" in verdict.triggered_rules

    def test_case_9a_link_rot_rescued_by_wayback_machine(self) -> None:
        """Hard Case 9a: Dead live URL (404) rescued by Wayback Machine snapshot -> VERIFIED + archive_url."""
        archive_snapshot = "https://web.archive.org/web/20211015120000/https://old-lab.edu/papers/graph-neural-verify.pdf"
        citation = _make_citation(
            cid=9,
            raw_ref="[9] Tran, V. K., & Le, T. H. (2021). Graph Neural Verification for Citation Networks. https://old-lab.edu/papers/graph-neural-verify.pdf",
            title="Graph Neural Verification for Citation Networks",
            authors=["Tran, V. K.", "Le, T. H."],
            year=2021,
            url="https://old-lab.edu/papers/graph-neural-verify.pdf",
        )
        source = SourceResult(
            citation_raw=citation.raw_text,
            candidates=[
                SourceCandidate(
                    source_name="openalex",
                    found=True,
                    title="Graph Neural Verification for Citation Networks",
                    authors=["Tran, V. K.", "Le, T. H."],
                    year="2021",
                    venue="IEEE Access",
                    confidence=0.90,
                )
            ],
            sources_queried=["openalex"],
            sources_succeeded=["openalex"],
            url_status="archived_alive",
            url_status_code=200,
            archive_url=archive_snapshot,
        )

        verdict = self.checker.check(citation, source, mapping_status=CitationMappingStatus.MATCHED)
        assert verdict.label == ValidationLabel.VERIFIED
        assert "R-WAYBACK-ARCHIVED" in verdict.triggered_rules
        assert verdict.archive_url == archive_snapshot

    def test_case_9b_fabricated_dead_url_without_wayback_snapshot_is_hallucination(self) -> None:
        """Hard Case 9b: Dead URL (404) with zero Wayback snapshots and no scholarly record -> SUSPECTED_HALLUCINATION."""
        citation = _make_citation(
            cid=10,
            raw_ref="[10] Kowalski, M. (2024). Quantum Hyper-Transformer for Autonomous Essay Grading. https://nonexistent-ai-journal.org/paper/99999",
            title="Quantum Hyper-Transformer for Autonomous Essay Grading",
            authors=["Kowalski, M."],
            year=2024,
            url="https://nonexistent-ai-journal.org/paper/99999",
        )
        source = SourceResult(
            citation_raw=citation.raw_text,
            candidates=[],
            sources_queried=["crossref", "openalex", "dblp", "arxiv", "doaj"],
            sources_succeeded=["crossref", "openalex", "dblp", "arxiv", "doaj"],
            url_status="dead_link",
            url_status_code=404,
            archive_url=None,
        )

        verdict = self.checker.check(citation, source, mapping_status=CitationMappingStatus.MATCHED)
        assert verdict.label == ValidationLabel.SUSPECTED_HALLUCINATION
        assert "R-DEAD-URL" in verdict.triggered_rules

    def test_case_10_regional_jalc_doi_verified_via_global_doi_ra(self) -> None:
        """Hard Case 10: Japanese JaLC DOI not in Crossref/OpenAlex, verified via Global DOI RA CSL-JSON."""
        citation = _make_citation(
            cid=11,
            raw_ref="[11] Tanaka, K., & Sato, M. (2022). Distributed Control of Autonomous Robotics in Smart Factories. SICE Journal. https://doi.org/10.11499/sicejl.61.210",
            title="Distributed Control of Autonomous Robotics in Smart Factories",
            authors=["Kenji Tanaka", "Masahiro Sato"],
            year=2022,
            doi="10.11499/sicejl.61.210",
            venue="SICE Journal",
        )
        source = SourceResult(
            citation_raw=citation.raw_text,
            candidates=[
                SourceCandidate(
                    source_name="doi_ra",
                    found=True,
                    title="Distributed Control of Autonomous Robotics in Smart Factories",
                    authors=["Kenji Tanaka", "Masahiro Sato"],
                    year="2022",
                    doi="10.11499/sicejl.61.210",
                    venue="SICE Journal",
                    external_ids={"doi_ra": "JaLC"},
                    confidence=0.92,
                )
            ],
            sources_queried=["crossref", "openalex", "doi_ra"],
            sources_succeeded=["doi_ra"],
        )

        verdict = self.checker.check(citation, source, mapping_status=CitationMappingStatus.MATCHED)
        assert verdict.label == ValidationLabel.VERIFIED
        assert "R-GLOBAL-DOI-RA-VERIFIED" in verdict.triggered_rules

    def test_case_11_github_repo_with_citation_cff_verified(self) -> None:
        """Hard Case 11: Public GitHub repository verified via GitHub API + CITATION.cff -> VERIFIED."""
        citation = _make_citation(
            cid=12,
            raw_ref="[12] Vu, A. (2023). underthesea: Vietnamese NLP Toolkit. GitHub. https://github.com/undertheseanlp/underthesea",
            title="underthesea: Vietnamese NLP Toolkit",
            authors=["Anh Vu"],
            year=2023,
            url="https://github.com/undertheseanlp/underthesea",
            venue="GitHub",
        )
        source = SourceResult(
            citation_raw=citation.raw_text,
            candidates=[
                SourceCandidate(
                    source_name="tech_standard",
                    found=True,
                    title="underthesea: Vietnamese NLP Toolkit",
                    authors=["Anh Vu"],
                    year="2023",
                    venue="GitHub Repository (undertheseanlp/underthesea)",
                    url="https://github.com/undertheseanlp/underthesea",
                    external_ids={"github_repo": "undertheseanlp/underthesea"},
                    confidence=0.95,
                )
            ],
            sources_queried=["tech_standard"],
            sources_succeeded=["tech_standard"],
        )

        verdict = self.checker.check(citation, source, mapping_status=CitationMappingStatus.MATCHED)
        assert verdict.label == ValidationLabel.VERIFIED
        assert "R-GITHUB-VERIFIED" in verdict.triggered_rules

    def test_case_12_nonexistent_404_github_repo_flagged_as_hallucination(self) -> None:
        """Hard Case 12: AI-hallucinated GitHub repository URL returning 404 -> SUSPECTED_HALLUCINATION."""
        citation = _make_citation(
            cid=13,
            raw_ref="[13] Chen, L. (2024). QuantumGPT-V9: Autonomous Hallucination Engine. GitHub. https://github.com/chen-lab-9999/quantumgpt-v9",
            title="QuantumGPT-V9: Autonomous Hallucination Engine",
            authors=["Chen, L."],
            year=2024,
            url="https://github.com/chen-lab-9999/quantumgpt-v9",
            venue="GitHub",
        )
        source = SourceResult(
            citation_raw=citation.raw_text,
            candidates=[],
            sources_queried=["tech_standard"],
            sources_succeeded=[],
            sources_failed={"tech_standard": "TechStandard: GitHub repository 'chen-lab-9999/quantumgpt-v9' not found (404)"},
            url_status="dead_link",
            url_status_code=404,
        )

        verdict = self.checker.check(citation, source, mapping_status=CitationMappingStatus.MATCHED)
        assert verdict.label == ValidationLabel.SUSPECTED_HALLUCINATION
        assert "R-DEAD-URL" in verdict.triggered_rules

    def test_case_13_scoped_npm_package_verified_and_wrong_year_detected(self) -> None:
        """Hard Case 13: Scoped NPM package (@tanstack/react-query) verified with R-PACKAGE-VERIFIED, and wrong year -> METADATA_ERROR."""
        citation_ok = _make_citation(
            cid=14,
            raw_ref="[14] Linsley, T. (2023). @tanstack/react-query: Powerful asynchronous state management for TS/JS. NPM. https://www.npmjs.com/package/@tanstack/react-query",
            title="@tanstack/react-query: Powerful asynchronous state management for TS/JS",
            authors=["Tanner Linsley"],
            year=2023,
            url="https://www.npmjs.com/package/@tanstack/react-query",
            venue="NPM Package Registry",
        )
        source = SourceResult(
            citation_raw=citation_ok.raw_text,
            candidates=[
                SourceCandidate(
                    source_name="tech_standard",
                    found=True,
                    title="@tanstack/react-query: Powerful asynchronous state management for TS/JS",
                    authors=["Tanner Linsley"],
                    year="2023",
                    venue="NPM Package Registry",
                    url="https://www.npmjs.com/package/@tanstack/react-query",
                    external_ids={"npm_package": "@tanstack/react-query"},
                    confidence=0.95,
                )
            ],
            sources_queried=["tech_standard"],
            sources_succeeded=["tech_standard"],
        )

        verdict_ok = self.checker.check(citation_ok, source, mapping_status=CitationMappingStatus.MATCHED)
        assert verdict_ok.label == ValidationLabel.VERIFIED
        assert "R-PACKAGE-VERIFIED" in verdict_ok.triggered_rules

        citation_bad_year = _make_citation(
            cid=15,
            raw_ref="[15] Linsley, T. (2015). @tanstack/react-query: Powerful asynchronous state management for TS/JS. NPM. https://www.npmjs.com/package/@tanstack/react-query",
            title="@tanstack/react-query: Powerful asynchronous state management for TS/JS",
            authors=["Tanner Linsley"],
            year=2015,
            url="https://www.npmjs.com/package/@tanstack/react-query",
            venue="NPM Package Registry",
        )
        verdict_bad = self.checker.check(citation_bad_year, source, mapping_status=CitationMappingStatus.MATCHED)
        assert verdict_bad.label == ValidationLabel.METADATA_ERROR
        assert "year" in verdict_bad.mismatched_fields
        assert "R-PACKAGE-VERIFIED" in verdict_bad.triggered_rules

    def test_case_14_iso_standard_and_dsm5_verified_via_wikidata_opencitations(self) -> None:
        """Hard Case 14: ISO/IEC 27001 standard and DSM-5 manual verified via Wikidata Knowledge Graph -> VERIFIED."""
        citation_iso = _make_citation(
            cid=16,
            raw_ref="[16] ISO/IEC (2022). ISO/IEC 27001:2022 Information security, cybersecurity and privacy protection — Information security management systems. ISO.",
            title="ISO/IEC 27001:2022 Information security, cybersecurity and privacy protection — Information security management systems",
            authors=["ISO/IEC"],
            year=2022,
            venue="ISO/IEC Standard",
        )
        source_iso = SourceResult(
            citation_raw=citation_iso.raw_text,
            candidates=[
                SourceCandidate(
                    source_name="wikidata_opencitations",
                    found=True,
                    title="ISO/IEC 27001:2022 Information security, cybersecurity and privacy protection — Information security management systems",
                    authors=["ISO/IEC"],
                    year="2022",
                    venue="Wikidata Knowledge Graph (Q1334491)",
                    external_ids={"wikidata_qid": "Q1334491", "standard_code": "ISO/IEC 27001"},
                    confidence=0.92,
                )
            ],
            sources_queried=["wikidata_opencitations"],
            sources_succeeded=["wikidata_opencitations"],
        )

        verdict_iso = self.checker.check(citation_iso, source_iso, mapping_status=CitationMappingStatus.MATCHED)
        assert verdict_iso.label == ValidationLabel.VERIFIED
        assert "R-WIKIDATA-VERIFIED" in verdict_iso.triggered_rules



class TestRealPdfEndToEndAndBeforeAfterBenchmark:
    """Generates a real multi-page PDF document with PyMuPDF and runs the full parsing,
    segmentation, reference extraction, linking, neuro-symbolic validation, and CIS calculation
    to compare Legacy 7-Source Baseline vs. New 16-Source Engine.
    """

    @staticmethod
    def _write_real_benchmark_pdf(pdf_path: Path) -> None:
        doc = fitz.open()

        # Page 1: Title, Abstract, Introduction, Methodology with in-text citations [1]-[10]
        page1 = doc.new_page(width=595, height=842)
        body_text = (
            "Multi-Source Neuro-Symbolic Citation Verification in Academic Writing\n\n"
            "Abstract\n"
            "Automated citation verification requires broad bibliographic coverage across global, regional, "
            "and technical registries. In this study, we evaluate ten representative citations spanning "
            "datasets, biomedical preprints, regional open-access journals, doctoral theses, AI models, "
            "technical RFC standards, archived web links, retracted literature, and fabricated references.\n\n"
            "1. Introduction\n"
            "Open research datasets hosted on Zenodo are increasingly cited via DataCite DOIs [1]. "
            "Meanwhile, clinical claims must be screened against retracted publications such as the "
            "retracted hydroxychloroquine registry analysis [2]. In computational biology, breakthrough "
            "models frequently appear first on bioRxiv under Cold Spring Harbor DOIs [3].\n\n"
            "2. Regional, Institutional, and Technical Sources\n"
            "Regional open-access studies indexed in DOAJ provide critical domain benchmarks for "
            "low-resource languages [4], while doctoral dissertations archived in HAL Open Science "
            "establish foundational theoretical proofs [5]. Modern natural language processing pipelines "
            "also directly cite pre-trained model weights hosted on the Hugging Face Hub [6] alongside "
            "core Internet Engineering Task Force standards such as HTTP Semantics RFC 9110 [7]. "
            "Furthermore, regional Asian engineering journals registered via JaLC DOIs [8] and older "
            "technical reports rescued from link rot by the Internet Archive Wayback Machine [9] "
            "must be distinguished from completely fabricated AI-hallucinated papers [10].\n"
        )
        page1.insert_textbox(fitz.Rect(50, 50, 545, 790), body_text, fontsize=10.5)

        # Page 2: Conclusion & References section
        page2 = doc.new_page(width=595, height=842)
        refs_text = (
            "3. Conclusion\n"
            "Combining sixteen scholarly and technical registries with deterministic symbolic rules "
            "eliminates false positives while intercepting retracted and hallucinated citations.\n\n"
            "References\n"
            "[1] Nguyen, A., & Tran, B. (2024). Vietnamese Academic Integrity Benchmark Dataset. Zenodo. https://doi.org/10.5281/zenodo.7654321\n\n"
            "[2] Mehra, M. R., Desai, S. S., Ruschitzka, F., & Patel, A. N. (2020). Hydroxychloroquine or chloroquine with or without a macrolide for treatment of COVID-19: a multinational registry analysis. The Lancet. https://doi.org/10.1016/S0140-6736(20)31180-6\n\n"
            "[3] Jumper, J., Evans, R., & Hassabis, D. (2023). Accurate structure prediction of biomolecular interactions. bioRxiv. https://doi.org/10.1101/2023.05.15.540821\n\n"
            "[4] Le, H. P., & Pham, M. T. (2023). Applying PhoBERT for Vietnamese Legal Document Classification. Journal of Computer Science and Cybernetics.\n\n"
            "[5] Moreau, C. (2023). Neuro-Symbolic Verification of Scientific Claims in Doctoral Theses. PhD Thesis, Universite Paris-Saclay.\n\n"
            "[6] Nguyen, D. Q., & Nguyen, A. T. (2020). vinai/phobert-base: Pre-trained language models for Vietnamese. Hugging Face Hub. https://huggingface.co/vinai/phobert-base\n\n"
            "[7] Fielding, R., Nottingham, M., & Reschke, J. (2022). RFC 9110: HTTP Semantics. IETF. https://doi.org/10.17487/RFC9110\n\n"
            "[8] Tanaka, K., & Sato, M. (2022). Distributed Control of Autonomous Robotics in Smart Factories. SICE Journal. https://doi.org/10.11499/sicejl.61.210\n\n"
            "[9] Tran, V. K., & Le, T. H. (2021). Graph Neural Verification for Citation Networks. https://old-lab.edu/papers/graph-neural-verify.pdf\n\n"
            "[10] Kowalski, M. (2024). Quantum Hyper-Transformer for Autonomous Essay Grading. Journal of Imaginary AI. https://doi.org/10.9999/fake.hallucinated.2024\n"
        )
        page2.insert_textbox(fitz.Rect(50, 50, 545, 790), refs_text, fontsize=9.5)

        doc.save(str(pdf_path))
        doc.close()

    def test_real_pdf_end_to_end_before_vs_after_benchmark(self, tmp_path: Path) -> None:
        """Parses a real 2-page PDF and benchmarks Legacy (7 sources) vs. Upgraded (16 sources)."""
        pdf_path = tmp_path / "benchmark_16_sources.pdf"
        self._write_real_benchmark_pdf(pdf_path)

        # Step 1: Parse real PDF via DocumentParser (PyMuPDF + SectionSegmenter + ReferenceListParser)
        doc_parser = DocumentParser()
        parsed_doc = doc_parser.parse(str(pdf_path), use_service_manager=False)
        assert len(parsed_doc.document.pages) == 2
        assert len(parsed_doc.references) == 10
        assert len(parsed_doc.body_citations) >= 10

        # Step 2: Link in-text occurrences [1]..[10] to bibliography references
        linker = CitationLinker()
        linking_result = linker.link(parsed_doc.body_citations, parsed_doc.references)
        assert len(parsed_doc.references) == 10

        by_idx: dict[int, Citation] = {}
        for idx, ref_cit in enumerate(parsed_doc.references, start=1):
            key = ref_cit.numeric_index or idx
            by_idx[key] = ref_cit
        assert set(by_idx.keys()) == set(range(1, 11))

        # Ground-truth expected labels for [1]..[10]:
        ground_truth: dict[int, ValidationLabel] = {
            1: ValidationLabel.VERIFIED,                 # Zenodo DOI via DataCite
            2: ValidationLabel.METADATA_ERROR,           # Retracted Lancet paper (must NOT be VERIFIED)
            3: ValidationLabel.VERIFIED,                 # bioRxiv 10.1101 via NCBI/bioRxiv
            4: ValidationLabel.VERIFIED,                 # Vietnamese OA via DOAJ
            5: ValidationLabel.VERIFIED,                 # Doctoral thesis via OpenAIRE/HAL
            6: ValidationLabel.VERIFIED,                 # Hugging Face model via HF Hub API
            7: ValidationLabel.VERIFIED,                 # IETF RFC 9110 via TechStandardClient
            8: ValidationLabel.VERIFIED,                 # Japanese JaLC DOI via Global DOI RA
            9: ValidationLabel.RESOURCE,                 # Unindexed web report rescued from link rot via Wayback Machine
            10: ValidationLabel.SUSPECTED_HALLUCINATION, # Fabricated DOI 10.9999/fake...
        }

        checker = NeuroSymbolicChecker(
            enable_content_alignment=False,
            enable_calibration=False,
        )
        cis_calc = CISCalculator()

        # --- BEFORE (Legacy 7-source simulation, no retraction flag, no Wayback fallback) ---
        legacy_sources: dict[int, SourceResult] = {
            1: SourceResult(citation_raw=by_idx[1].raw_text, candidates=[], sources_queried=["crossref", "openalex"], sources_succeeded=["crossref", "openalex"]),
            2: SourceResult(
                citation_raw=by_idx[2].raw_text,
                candidates=[
                    SourceCandidate(
                        source_name="openalex",
                        found=True,
                        title="Hydroxychloroquine or chloroquine with or without a macrolide for treatment of COVID-19: a multinational registry analysis",
                        authors=["Mehra, M. R.", "Desai, S. S.", "Ruschitzka, F.", "Patel, A. N."],
                        year="2020",
                        doi="10.1016/s0140-6736(20)31180-6",
                        venue="The Lancet",
                        confidence=0.95,
                    )
                ],
                sources_queried=["crossref", "openalex"],
                sources_succeeded=["openalex"],
                is_retracted=False,  # Legacy did not extract retraction status
            ),
            3: SourceResult(citation_raw=by_idx[3].raw_text, candidates=[], sources_queried=["crossref"], sources_succeeded=["crossref"]),
            4: SourceResult(citation_raw=by_idx[4].raw_text, candidates=[], sources_queried=["crossref", "openalex", "dblp"], sources_succeeded=["crossref", "openalex", "dblp"]),
            5: SourceResult(citation_raw=by_idx[5].raw_text, candidates=[], sources_queried=["crossref", "openalex"], sources_succeeded=["crossref", "openalex"]),
            6: SourceResult(citation_raw=by_idx[6].raw_text, candidates=[], sources_queried=["crossref", "openalex"], sources_succeeded=["crossref", "openalex"]),
            7: SourceResult(citation_raw=by_idx[7].raw_text, candidates=[], sources_queried=["crossref", "openalex"], sources_succeeded=["crossref", "openalex"]),
            8: SourceResult(citation_raw=by_idx[8].raw_text, candidates=[], sources_queried=["crossref", "openalex"], sources_succeeded=["crossref", "openalex"]),
            9: SourceResult(
                citation_raw=by_idx[9].raw_text,
                candidates=[],
                sources_queried=["crossref", "openalex"],
                sources_succeeded=["crossref", "openalex"],
                url_status="dead_link",  # Legacy had no Wayback Machine fallback -> falsely flags SUSPECTED_HALLUCINATION!
                url_status_code=404,
            ),
            10: SourceResult(citation_raw=by_idx[10].raw_text, candidates=[], sources_queried=["crossref", "openalex", "dblp"], sources_succeeded=["crossref", "openalex", "dblp"]),
        }

        legacy_verdicts = [
            checker.check(by_idx[i], legacy_sources[i], mapping_status=CitationMappingStatus.MATCHED)
            for i in range(1, 11)
        ]
        legacy_correct = sum(
            1 for i, v in enumerate(legacy_verdicts, start=1) if v.label == ground_truth[i]
        )

        # --- AFTER (Upgraded 16-source engine with all 9 new free APIs) ---
        upgraded_sources: dict[int, SourceResult] = {
            1: SourceResult(
                citation_raw=by_idx[1].raw_text,
                candidates=[
                    SourceCandidate(
                        source_name="datacite",
                        found=True,
                        title="Vietnamese Academic Integrity Benchmark Dataset",
                        authors=["Nguyen, A.", "Tran, B."],
                        year="2024",
                        doi="10.5281/zenodo.7654321",
                        venue="Zenodo",
                        confidence=0.95,
                    )
                ],
                sources_queried=["crossref", "openalex", "datacite"],
                sources_succeeded=["datacite"],
            ),
            2: SourceResult(
                citation_raw=by_idx[2].raw_text,
                candidates=[
                    SourceCandidate(
                        source_name="openalex",
                        found=True,
                        title="Hydroxychloroquine or chloroquine with or without a macrolide for treatment of COVID-19: a multinational registry analysis",
                        authors=["Mehra, M. R.", "Desai, S. S.", "Ruschitzka, F.", "Patel, A. N."],
                        year="2020",
                        doi="10.1016/s0140-6736(20)31180-6",
                        venue="The Lancet",
                        external_ids={"is_retracted": "true"},
                        confidence=0.95,
                    )
                ],
                sources_queried=["crossref", "openalex"],
                sources_succeeded=["openalex"],
                is_retracted=True,
            ),
            3: SourceResult(
                citation_raw=by_idx[3].raw_text,
                candidates=[
                    SourceCandidate(
                        source_name="ncbi_biorxiv",
                        found=True,
                        title="Accurate structure prediction of biomolecular interactions",
                        authors=["Jumper, J.", "Evans, R.", "Hassabis, D."],
                        year="2023",
                        doi="10.1101/2023.05.15.540821",
                        venue="bioRxiv",
                        confidence=0.95,
                    )
                ],
                sources_queried=["ncbi_biorxiv"],
                sources_succeeded=["ncbi_biorxiv"],
            ),
            4: SourceResult(
                citation_raw=by_idx[4].raw_text,
                candidates=[
                    SourceCandidate(
                        source_name="doaj",
                        found=True,
                        title="Applying PhoBERT for Vietnamese Legal Document Classification",
                        authors=["Le, H. P.", "Pham, M. T."],
                        year="2023",
                        venue="Journal of Computer Science and Cybernetics",
                        confidence=0.90,
                    )
                ],
                sources_queried=["crossref", "openalex", "doaj"],
                sources_succeeded=["doaj"],
            ),
            5: SourceResult(
                citation_raw=by_idx[5].raw_text,
                candidates=[
                    SourceCandidate(
                        source_name="openaire_hal",
                        found=True,
                        title="Neuro-Symbolic Verification of Scientific Claims in Doctoral Theses",
                        authors=["Moreau, C."],
                        year="2023",
                        venue="Universite Paris-Saclay",
                        confidence=0.90,
                    )
                ],
                sources_queried=["openaire_hal"],
                sources_succeeded=["openaire_hal"],
            ),
            6: SourceResult(
                citation_raw=by_idx[6].raw_text,
                candidates=[
                    SourceCandidate(
                        source_name="huggingface",
                        found=True,
                        title="vinai/phobert-base: Pre-trained language models for Vietnamese",
                        authors=["Nguyen, D. Q.", "Anh Tuan Nguyen"],
                        year="2020",
                        venue="Hugging Face Hub",
                        confidence=0.92,
                    )
                ],
                sources_queried=["huggingface"],
                sources_succeeded=["huggingface"],
            ),
            7: SourceResult(
                citation_raw=by_idx[7].raw_text,
                candidates=[
                    SourceCandidate(
                        source_name="tech_standard",
                        found=True,
                        title="RFC 9110: HTTP Semantics",
                        authors=["Fielding, R.", "Nottingham, M.", "Reschke, J."],
                        year="2022",
                        doi="10.17487/rfc9110",
                        venue="IETF RFC 9110",
                        confidence=0.95,
                    )
                ],
                sources_queried=["tech_standard"],
                sources_succeeded=["tech_standard"],
            ),
            8: SourceResult(
                citation_raw=by_idx[8].raw_text,
                candidates=[
                    SourceCandidate(
                        source_name="doi_ra",
                        found=True,
                        title="Distributed Control of Autonomous Robotics in Smart Factories",
                        authors=["Tanaka, K.", "Sato, M."],
                        year="2022",
                        doi="10.11499/sicejl.61.210",
                        venue="SICE Journal",
                        external_ids={"doi_ra": "JaLC"},
                        confidence=0.92,
                    )
                ],
                sources_queried=["crossref", "openalex", "doi_ra"],
                sources_succeeded=["doi_ra"],
            ),
            9: SourceResult(
                citation_raw=by_idx[9].raw_text,
                candidates=[],
                sources_queried=["crossref", "openalex"],
                sources_succeeded=["crossref", "openalex"],
                url_status="archived_alive",
                url_status_code=200,
                archive_url="https://web.archive.org/web/20211015120000/https://old-lab.edu/papers/graph-neural-verify.pdf",
            ),
            10: SourceResult(
                citation_raw=by_idx[10].raw_text,
                candidates=[],
                sources_queried=["crossref", "openalex", "dblp", "doi_ra"],
                sources_succeeded=["crossref", "openalex", "dblp", "doi_ra"],
            ),
        }

        upgraded_verdicts = [
            checker.check(by_idx[i], upgraded_sources[i], mapping_status=CitationMappingStatus.MATCHED)
            for i in range(1, 11)
        ]
        upgraded_correct = sum(
            1 for i, v in enumerate(upgraded_verdicts, start=1) if v.label == ground_truth[i]
        )

        legacy_cis = cis_calc.compute(legacy_verdicts, linking_result=linking_result)
        upgraded_cis = cis_calc.compute(upgraded_verdicts, linking_result=linking_result)

        # Verify strict improvement from 1/10 (10%) to 10/10 (100%)
        assert legacy_correct == 1
        mismatches = [
            (i, v.label.value, ground_truth[i].value, v.triggered_rules, by_idx[i].title, by_idx[i].doi)
            for i, v in enumerate(upgraded_verdicts, start=1)
            if v.label != ground_truth[i]
        ]
        assert upgraded_correct == 10, f"Mismatches: {mismatches}"
        assert upgraded_cis.score > legacy_cis.score
        assert upgraded_verdicts[1].is_retracted is True
        assert "R-RETRACTED-PAPER" in upgraded_verdicts[1].triggered_rules
        assert upgraded_verdicts[8].archive_url is not None
        assert "R-WAYBACK-ARCHIVED" in upgraded_verdicts[8].triggered_rules
