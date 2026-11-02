"""Tests for DOCX export functionality."""

import pytest

from integrity_checker.export.docx_exporter import export_report_to_docx


class TestDocxExporter:
    """Test suite for DOCX export."""

    def test_export_basic_report(self):
        """Test basic DOCX export."""
        result = export_report_to_docx(
            filename='test_essay.pdf',
            cis_score=92.5,
            num_citations=50,
            num_verified=45,
            num_metadata_error=2,
            num_suspected=1,
            num_unresolved=1,
            num_resource=1,
            verdicts=[],
        )
        assert isinstance(result, bytes)
        assert len(result) > 0
        # DOCX files start with PK (ZIP format)
        assert result[:2] == b'PK'

    def test_export_with_verdicts(self):
        """Test DOCX export with verdict data."""
        verdicts = [
            {
                'citation_raw': 'Vaswani et al. (2017)',
                'citation_type': 'in_text',
                'label': 'verified',
                'confidence': 0.95,
                'reasoning': 'Found in Crossref',
                'matched_sources': [{'source': 'crossref'}],
            },
            {
                'citation_raw': 'Smith et al. (2020)',
                'citation_type': 'reference_list',
                'label': 'suspected_hallucination',
                'confidence': 0.3,
                'reasoning': 'Not found in any database',
                'matched_sources': [],
            },
        ]
        result = export_report_to_docx(
            filename='paper.pdf',
            cis_score=85.0,
            num_citations=10,
            num_verified=8,
            num_metadata_error=1,
            num_suspected=1,
            num_unresolved=0,
            num_resource=0,
            verdicts=verdicts,
            generated_at='2024-01-15 10:00:00 UTC',
        )
        assert isinstance(result, bytes)
        assert len(result) > 1000  # Should have substantial content

    def test_export_empty_verdicts(self):
        """Test DOCX export with empty verdicts list."""
        result = export_report_to_docx(
            filename='empty.pdf',
            cis_score=0.0,
            num_citations=0,
            num_verified=0,
            num_metadata_error=0,
            num_suspected=0,
            num_unresolved=0,
            num_resource=0,
            verdicts=[],
        )
        assert isinstance(result, bytes)
        assert result[:2] == b'PK'

    def test_export_high_score_color(self):
        """Test that high scores (>90) generate properly."""
        result = export_report_to_docx(
            filename='high_score.pdf',
            cis_score=95.0,
            num_citations=100,
            num_verified=95,
            num_metadata_error=3,
            num_suspected=1,
            num_unresolved=1,
            num_resource=0,
            verdicts=[],
        )
        assert isinstance(result, bytes)

    def test_export_low_score_color(self):
        """Test that low scores (<70) generate properly."""
        result = export_report_to_docx(
            filename='low_score.pdf',
            cis_score=55.0,
            num_citations=100,
            num_verified=40,
            num_metadata_error=20,
            num_suspected=20,
            num_unresolved=10,
            num_resource=10,
            verdicts=[],
        )
        assert isinstance(result, bytes)

    def test_export_medium_score_color(self):
        """Test that medium scores (70-90) generate properly."""
        result = export_report_to_docx(
            filename='medium_score.pdf',
            cis_score=75.0,
            num_citations=100,
            num_verified=65,
            num_metadata_error=15,
            num_suspected=10,
            num_unresolved=5,
            num_resource=5,
            verdicts=[],
        )
        assert isinstance(result, bytes)

    def test_export_long_citation_truncation(self):
        """Test that long citations are truncated properly."""
        long_citation = 'A very long citation ' * 20  # 340 chars
        verdicts = [
            {
                'citation_raw': long_citation,
                'citation_type': 'in_text',
                'label': 'verified',
                'confidence': 0.9,
                'reasoning': 'Found',
                'matched_sources': [],
            },
        ]
        result = export_report_to_docx(
            filename='long_cite.pdf',
            cis_score=100.0,
            num_citations=1,
            num_verified=1,
            num_metadata_error=0,
            num_suspected=0,
            num_unresolved=0,
            num_resource=0,
            verdicts=verdicts,
        )
        assert isinstance(result, bytes)
