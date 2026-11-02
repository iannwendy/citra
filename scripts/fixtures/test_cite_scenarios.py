"""
Test Scenario Generator v2 - Fixed PDF Generation for Citation Integrity Checker

Tạo 2 PDF test sạch với các cite/ref scenarios rõ ràng.

PDF 1: test_cite_scenario_a.pdf - 10 cite/ref scenarios (APA style)
PDF 2: test_cite_scenario_b.pdf - 10 cite/ref scenarios (IEEE style + mixed)

FIX v2: Sửa format để không chứa [N] markers trong body text gây confusion.
"""

import json
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

# ==============================================================================
# PDF 1: APA Style Scenarios
# ==============================================================================

APA_SCENARIOS = [
    {
        "id": "APA-01",
        "category": "MATCHED",
        "in_text": "Deep learning has achieved remarkable success (Vaswani et al., 2017).",
        "reference": "[1] A. Vaswani, N. Shazeer, N. Parmar, et al. \"Attention Is All You Need.\" Advances in Neural Information Processing Systems, 2017.",
        "expected_mapping": "MATCHED",
        "expected_label": "verified",
        "description": "Classic paper - in-text (Vaswani et al., 2017) matches reference"
    },
    {
        "id": "APA-02",
        "category": "MATCHED",
        "in_text": "BERT revolutionized NLP tasks (Devlin et al., 2019).",
        "reference": "[2] J. Devlin, M.-W. Chang, K. Lee, and K. Toutanova. \"BERT: Pre-training of Deep Bidirectional Transformers.\" Association for Computational Linguistics, 2019.",
        "expected_mapping": "MATCHED",
        "expected_label": "verified",
        "description": "BERT paper - author-year format matches reference"
    },
    {
        "id": "APA-03",
        "category": "MATCHED",
        "in_text": "Neural machine translation improved significantly (Sennrich et al., 2016).",
        "reference": "[3] R. Sennrich, B. Haddow, and A. Birch. \"Neural Machine Translation of Rare Words with Subword Units.\" Association for Computational Linguistics, 2016.",
        "expected_mapping": "MATCHED",
        "expected_label": "verified",
        "description": "Subword NMT paper - MATCHED via author-year"
    },
    {
        "id": "APA-04",
        "category": "MISSING_REFERENCE",
        "in_text": "This breakthrough changed the field (MysteryPaper, 2020).",
        "reference": "<<MISSING>>",
        "expected_mapping": "MISSING_REFERENCE",
        "expected_label": "suspected_hallucination",
        "description": "MISSING_REFERENCE: In-text exists but no matching reference entry"
    },
    {
        "id": "APA-05",
        "category": "UNCITED_REFERENCE",
        "in_text": "Traditional methods remain useful in some contexts (Smith, 2015).",
        "reference": "[4] J. Smith. \"Introduction to Classical Methods.\" Journal of Classical Studies, 2015.",
        "expected_mapping": "UNCITED_REFERENCE",
        "expected_label": "unresolved",
        "description": "Note: Reference exists but is NOT cited in body"
    },
    {
        "id": "APA-06",
        "category": "IN_TEXT_MISMATCH",
        "in_text": "Transformers use self-attention (Vaswani et al., 2017).",
        "reference": "[5] A. Vaswani, N. Shazeer, N. Parmar, et al. \"Graph Neural Networks: A Survey.\" Different venue, 2017.",
        "expected_mapping": "IN_TEXT_MISMATCH",
        "expected_label": "metadata_error",
        "description": "IN_TEXT_MISMATCH: Author/year match but title differs from [5]"
    },
    {
        "id": "APA-07",
        "category": "DUPLICATE_REFERENCE",
        "in_text": "Attention mechanisms are powerful (Vaswani et al., 2017). See also (Vaswani et al., 2017b).",
        "reference": "[6-7] A. Vaswani, et al. \"Attention Is All You Need.\" NeurIPS, 2017. (DUPLICATE ENTRIES)",
        "expected_mapping": "DUPLICATE_REFERENCE",
        "expected_label": "metadata_error",
        "description": "DUPLICATE_REFERENCE: Same paper appears twice in references"
    },
    {
        "id": "APA-08",
        "category": "MATCHED",
        "in_text": "Word embeddings capture semantic relationships (Mikolov et al., 2013).",
        "reference": "[8] T. Mikolov, K. Chen, G. Corrado, and J. Dean. \"Efficient Estimation of Word Representations.\" arXiv, 2013.",
        "expected_mapping": "MATCHED",
        "expected_label": "verified",
        "description": "Word2Vec paper - MATCHED via DOI/author-year"
    },
    {
        "id": "APA-09",
        "category": "AMBIGUOUS_MAPPING",
        "in_text": "Transfer learning proved effective (Pan et al., 2020).",
        "reference": "[9] S. J. Pan and Q. Yang. \"A Survey on Transfer Learning.\" IEEE Transactions, 2010.\n[10] F. Pan et al. \"Transfer Learning in 2020.\" New Journal, 2020.",
        "expected_mapping": "AMBIGUOUS_MAPPING",
        "expected_label": "unresolved",
        "description": "AMBIGUOUS_MAPPING: Multiple candidates match (Pan et al., 2020)"
    },
    {
        "id": "APA-10",
        "category": "MATCHED",
        "in_text": "Large language models show emergent abilities (Brown et al., 2020).",
        "reference": "[11] T. B. Brown et al. \"Language Models are Few-Shot Learners.\" NeurIPS, 2020.",
        "expected_mapping": "MATCHED",
        "expected_label": "verified",
        "description": "GPT-3 paper - MATCHED via DOI/author-year"
    },
]

# ==============================================================================
# PDF 2: IEEE + Mixed Style Scenarios
# ==============================================================================

IEEE_SCENARIOS = [
    {
        "id": "IEEE-01",
        "category": "MATCHED",
        "in_text": "Self-attention mechanisms have transformed deep learning (Vaswani et al., 2017).",
        "reference": "[1] A. Vaswani et al., \"Attention Is All You Need,\" NeurIPS, 2017.",
        "expected_mapping": "MATCHED",
        "expected_label": "verified",
        "description": "IEEE numeric citation matches reference"
    },
    {
        "id": "IEEE-02",
        "category": "MATCHED",
        "in_text": "BERT introduced bidirectional pre-training (Devlin et al., 2019).",
        "reference": "[2] J. Devlin et al., \"BERT: Pre-training,\" ACL, 2019.",
        "expected_mapping": "MATCHED",
        "expected_label": "verified",
        "description": "BERT - matches reference [2]"
    },
    {
        "id": "IEEE-03",
        "category": "MATCHED",
        "in_text": "Recent advances demonstrate the power of scale (Brown et al., 2020).",
        "reference": "[3] T. B. Brown et al., \"GPT-3,\" NeurIPS, 2020.",
        "expected_mapping": "MATCHED",
        "expected_label": "verified",
        "description": "GPT-3 - matches reference [3]"
    },
    {
        "id": "IEEE-04",
        "category": "MISSING_REFERENCE",
        "in_text": "This novel approach shows promise (NovelPaper, 2021).",
        "reference": "<<MISSING>>",
        "expected_mapping": "MISSING_REFERENCE",
        "expected_label": "suspected_hallucination",
        "description": "MISSING_REFERENCE: cited but no reference entry exists"
    },
    {
        "id": "IEEE-05",
        "category": "UNCITED_REFERENCE",
        "in_text": "Baseline methods remain relevant (TraditionalMethod, 2018).",
        "reference": "[4] J. Smith, \"Classical Methods,\" 2018. (Not cited in body)",
        "expected_mapping": "UNCITED_REFERENCE",
        "expected_label": "unresolved",
        "description": "UNCITED_REFERENCE: Reference exists but not cited"
    },
    {
        "id": "IEEE-06",
        "category": "MATCHED",
        "in_text": "Multiple papers demonstrate versatility (AuthorA, 2018) and (AuthorB, 2019).",
        "reference": "[5] A. Author, \"Paper A,\" 2018.\n[6] B. Author, \"Paper B,\" 2019.",
        "expected_mapping": "MATCHED",
        "expected_label": "verified",
        "description": "Multiple APA-style citations match references"
    },
    {
        "id": "IEEE-07",
        "category": "STYLE_INCONSISTENT",
        "in_text": "Traditional (Johnson, 2018) and modern (ModernPaper, 2019) approaches coexist.",
        "reference": "[7] R. Johnson, \"Modern Methods,\" IEEE, 2018.",
        "expected_mapping": "STYLE_INCONSISTENT",
        "expected_label": "unresolved",
        "description": "STYLE_INCONSISTENT: Mix of APA and another style in same doc"
    },
    {
        "id": "IEEE-08",
        "category": "MATCHED",
        "in_text": "GANs revolutionized generative modeling (Goodfellow et al., 2014).",
        "reference": "[8] I. Goodfellow et al., \"Generative Adversarial Networks,\" NeurIPS, 2014.",
        "expected_mapping": "MATCHED",
        "expected_label": "verified",
        "description": "GAN paper - MATCHED"
    },
    {
        "id": "IEEE-09",
        "category": "MATCHED",
        "in_text": "ResNet enabled deeper networks (He et al., 2016).",
        "reference": "[9] K. He et al., \"Deep Residual Learning,\" CVPR, 2016.",
        "expected_mapping": "MATCHED",
        "expected_label": "verified",
        "description": "ResNet paper - MATCHED"
    },
    {
        "id": "IEEE-10",
        "category": "MATCHED",
        "in_text": "Transformer variants continue to evolve (SurveyAuthors, 2023).",
        "reference": "[10] Various Authors, \"Survey of Transformers,\" ACM Computing Surveys, 2023.",
        "expected_mapping": "MATCHED",
        "expected_label": "verified",
        "description": "Survey paper - MATCHED"
    },
]


def create_pdf_apa_style(output_path: str):
    """Tạo PDF test với APA style citations - Clean format."""
    doc = SimpleDocTemplate(
        output_path,
        pagesize=letter,
        rightMargin=72,
        leftMargin=72,
        topMargin=72,
        bottomMargin=72
    )

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        'CustomTitle',
        parent=styles['Heading1'],
        fontSize=16,
        alignment=TA_CENTER,
        spaceAfter=30
    )
    heading_style = ParagraphStyle(
        'CustomHeading',
        parent=styles['Heading2'],
        fontSize=14,
        spaceAfter=12
    )
    body_style = ParagraphStyle(
        'CustomBody',
        parent=styles['Normal'],
        fontSize=11,
        alignment=TA_JUSTIFY,
        spaceAfter=12,
        leading=16
    )
    scenario_style = ParagraphStyle(
        'Scenario',
        parent=styles['Normal'],
        fontSize=10,
        spaceAfter=6,
        leading=14,
        leftIndent=20
    )

    story = []

    # Title
    story.append(Paragraph("Test Document: APA Citation Scenarios", title_style))
    story.append(Spacer(1, 20))

    # Introduction
    story.append(Paragraph("1. Introduction", heading_style))
    intro_text = """This document tests the citation integrity checker with various scenarios.
    Each section demonstrates a specific citation integrity scenario."""
    story.append(Paragraph(intro_text.strip(), body_style))
    story.append(Spacer(1, 20))

    # Body with citations
    story.append(Paragraph("2. Citation Scenarios", heading_style))

    for scenario in APA_SCENARIOS:
        # Scenario heading
        story.append(Paragraph(
            f"<b>{scenario['id']}: {scenario['category']}</b>",
            styles['Heading3']
        ))
        story.append(Paragraph(f"<i>{scenario['description']}</i>", scenario_style))

        # In-text citation (ONLY this should be extracted as in-text citation)
        story.append(Paragraph(
            f"<b>In-text:</b> {scenario['in_text']}",
            scenario_style
        ))

        # Reference
        ref_text = scenario['reference']
        if ref_text == "<<MISSING>>":
            story.append(Paragraph(
                "<b>Reference:</b> <font color='red'><<NO REFERENCE ENTRY>></font>",
                scenario_style
            ))
        else:
            story.append(Paragraph(
                f"<b>Reference:</b> {ref_text}",
                scenario_style
            ))

        story.append(Spacer(1, 10))

    # References section
    story.append(PageBreak())
    story.append(Paragraph("3. References", heading_style))
    story.append(Paragraph("Only properly formatted references below:", body_style))
    story.append(Spacer(1, 10))

    # Only include actual references (not MISSING ones)
    for scenario in APA_SCENARIOS:
        ref_text = scenario['reference']
        if ref_text != "<<MISSING>>" and not ref_text.startswith("<<"):
            story.append(Paragraph(ref_text, body_style))
            story.append(Spacer(1, 8))

    doc.build(story)
    print(f"Created: {output_path}")


def create_pdf_ieee_style(output_path: str):
    """Tạo PDF test với IEEE style citations - Clean format."""
    doc = SimpleDocTemplate(
        output_path,
        pagesize=letter,
        rightMargin=72,
        leftMargin=72,
        topMargin=72,
        bottomMargin=72
    )

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        'CustomTitle',
        parent=styles['Heading1'],
        fontSize=16,
        alignment=TA_CENTER,
        spaceAfter=30
    )
    heading_style = ParagraphStyle(
        'CustomHeading',
        parent=styles['Heading2'],
        fontSize=14,
        spaceAfter=12
    )
    body_style = ParagraphStyle(
        'CustomBody',
        parent=styles['Normal'],
        fontSize=11,
        alignment=TA_JUSTIFY,
        spaceAfter=12,
        leading=16
    )
    scenario_style = ParagraphStyle(
        'Scenario',
        parent=styles['Normal'],
        fontSize=10,
        spaceAfter=6,
        leading=14,
        leftIndent=20
    )

    story = []

    # Title
    story.append(Paragraph("Test Document: IEEE Citation Scenarios", title_style))
    story.append(Spacer(1, 20))

    # Introduction
    story.append(Paragraph("1. Introduction", heading_style))
    intro_text = """This document tests the citation integrity checker with IEEE numeric citations.
    Each section demonstrates a specific citation integrity scenario."""
    story.append(Paragraph(intro_text.strip(), body_style))
    story.append(Spacer(1, 20))

    # Body with citations
    story.append(Paragraph("2. Citation Scenarios", heading_style))

    for scenario in IEEE_SCENARIOS:
        # Scenario heading
        story.append(Paragraph(
            f"<b>{scenario['id']}: {scenario['category']}</b>",
            styles['Heading3']
        ))
        story.append(Paragraph(f"<i>{scenario['description']}</i>", scenario_style))

        # In-text citation
        story.append(Paragraph(
            f"<b>In-text:</b> {scenario['in_text']}",
            scenario_style
        ))

        # Reference
        ref_text = scenario['reference']
        if ref_text == "<<MISSING>>":
            story.append(Paragraph(
                "<b>Reference:</b> <font color='red'><<NO REFERENCE ENTRY>></font>",
                scenario_style
            ))
        else:
            story.append(Paragraph(
                f"<b>Reference:</b> {ref_text}",
                scenario_style
            ))

        story.append(Spacer(1, 10))

    # References section
    story.append(PageBreak())
    story.append(Paragraph("3. References", heading_style))
    story.append(Paragraph("Only properly formatted references below:", body_style))
    story.append(Spacer(1, 10))

    # Only include actual references
    for scenario in IEEE_SCENARIOS:
        ref_text = scenario['reference']
        if ref_text != "<<MISSING>>" and not ref_text.startswith("<<"):
            story.append(Paragraph(ref_text, body_style))
            story.append(Spacer(1, 8))

    doc.build(story)
    print(f"Created: {output_path}")


def generate_scenario_markdown():
    """Tạo file markdown mô tả chi tiết các scenarios."""
    md_content = """# Test Scenario Documentation
# Citation Integrity Checker - Scenario Test Suite v2

## Overview

This document describes the test scenarios used to validate the Citation Integrity Checker.
Each scenario includes:
- **In-text citation** in the document body
- **Reference entry** in the bibliography
- **Expected mapping status** (MATCHED, MISSING_REFERENCE, etc.)
- **Expected validation label** (verified, suspected_hallucination, etc.)

---

## PDF 1: APA Style Scenarios (`test_cite_scenario_a.pdf`)

### Scenario APA-01: MATCHED
**Category:** MATCHED
**Description:** Classic paper - in-text (Vaswani et al., 2017) matches reference [1]

| Element | Value |
|---------|-------|
| In-text | Deep learning has achieved remarkable success (Vaswani et al., 2017). |
| Reference | [1] A. Vaswani, N. Shazeer, N. Parmar, et al. "Attention Is All You Need." Advances in Neural Information Processing Systems, 2017. |
| Expected Mapping | `MATCHED` |
| Expected Label | `verified` |
| Matching Logic | Author-year (Vaswani, 2017) matches reference entry [1] |

**Verification:**
- [ ] In-text citation "(Vaswani et al., 2017)" extracted correctly
- [ ] Reference entry [1] parsed correctly with author="Vaswani", year="2017"
- [ ] Mapping status = MATCHED
- [ ] Validation label = verified

---

### Scenario APA-02: MATCHED
**Category:** MATCHED
**Description:** BERT paper - author-year format matches reference [2]

| Element | Value |
|---------|-------|
| In-text | BERT revolutionized NLP tasks (Devlin et al., 2019). |
| Reference | [2] J. Devlin, M.-W. Chang, K. Lee, and K. Toutanova. "BERT: Pre-training of Deep Bidirectional Transformers." Association for Computational Linguistics, 2019. |
| Expected Mapping | `MATCHED` |
| Expected Label | `verified` |
| Matching Logic | Author-year (Devlin, 2019) matches reference entry [2] |

**Verification:**
- [ ] In-text citation "(Devlin et al., 2019)" extracted correctly
- [ ] Reference entry [2] parsed correctly
- [ ] Mapping status = MATCHED
- [ ] Validation label = verified

---

### Scenario APA-03: MATCHED
**Category:** MATCHED
**Description:** Subword NMT paper - MATCHED via author-year

| Element | Value |
|---------|-------|
| In-text | Neural machine translation improved significantly (Sennrich et al., 2016). |
| Reference | [3] R. Sennrich, B. Haddow, and A. Birch. "Neural Machine Translation of Rare Words with Subword Units." Association for Computational Linguistics, 2016. |
| Expected Mapping | `MATCHED` |
| Expected Label | `verified` |
| Matching Logic | Author-year (Sennrich, 2016) matches reference entry [3] |

**Verification:**
- [ ] In-text citation "(Sennrich et al., 2016)" extracted correctly
- [ ] Reference entry [3] parsed correctly
- [ ] Mapping status = MATCHED
- [ ] Validation label = verified

---

### Scenario APA-04: MISSING_REFERENCE
**Category:** MISSING_REFERENCE
**Description:** MISSING_REFERENCE: In-text exists but no matching reference entry

| Element | Value |
|---------|-------|
| In-text | This breakthrough changed the field (MysteryPaper, 2020). |
| Reference | **<<NO REFERENCE ENTRY>>** |
| Expected Mapping | `MISSING_REFERENCE` |
| Expected Label | `suspected_hallucination` |
| Matching Logic | In-text citation has no corresponding reference in bibliography |

**Verification:**
- [ ] In-text citation "(MysteryPaper, 2020)" extracted correctly
- [ ] No reference entry found for this citation
- [ ] Mapping status = MISSING_REFERENCE
- [ ] Validation label = suspected_hallucination

**Why this matters:** This could indicate a hallucinated citation or forgotten reference.

---

### Scenario APA-05: UNCITED_REFERENCE
**Category:** UNCITED_REFERENCE
**Description:** UNCITED_REFERENCE: Reference exists but no in-text cites it

| Element | Value |
|---------|-------|
| In-text | Traditional methods remain useful in some contexts (Smith, 2015). |
| Reference | [4] J. Smith. "Introduction to Classical Methods." Journal of Classical Studies, 2015. |
| Expected Mapping | `UNCITED_REFERENCE` (for reference [4]) |
| Expected Label | `unresolved` |
| Matching Logic | Reference entry [4] exists but no in-text citation references it |

**Verification:**
- [ ] Reference entry [4] parsed correctly
- [ ] Reference [4] has author="Smith", year="2015"
- [ ] No in-text citation matches [4]
- [ ] Mapping status = UNCITED_REFERENCE
- [ ] Validation label = unresolved

**Note:** The in-text "(Smith, 2015)" is separate - it should be UNCITED if no matching ref.

**Why this matters:** Uncited references suggest either draft leftovers or incorrect citations.

---

### Scenario APA-06: IN_TEXT_MISMATCH
**Category:** IN_TEXT_MISMATCH
**Description:** IN_TEXT_MISMATCH: Author/year match but title differs

| Element | Value |
|---------|-------|
| In-text | Transformers use self-attention (Vaswani et al., 2017). |
| Reference | [5] A. Vaswani, N. Shazeer, N. Parmar, et al. "Graph Neural Networks: A Survey." Different venue, 2017. |
| Expected Mapping | `IN_TEXT_MISMATCH` |
| Expected Label | `metadata_error` |
| Matching Logic | Author (Vaswani) and year (2017) match reference [5], but title is different |

**Verification:**
- [ ] In-text "(Vaswani et al., 2017)" extracts author="Vaswani", year="2017"
- [ ] Reference [5] has author="Vaswani", year="2017" but title="Graph Neural Networks..."
- [ ] Mapping status = IN_TEXT_MISMATCH (or AMBIGUOUS)
- [ ] Validation label = metadata_error or unresolved

**Why this matters:** This indicates a potential citation error - the author might have cited the wrong paper.

---

### Scenario APA-07: DUPLICATE_REFERENCE
**Category:** DUPLICATE_REFERENCE
**Description:** DUPLICATE_REFERENCE: Same paper appears twice in references

| Element | Value |
|---------|-------|
| In-text | Attention mechanisms are powerful (Vaswani et al., 2017). See also (Vaswani et al., 2017b). |
| Reference | [6-7] A. Vaswani, et al. "Attention Is All You Need." NeurIPS, 2017. (DUPLICATE) |
| Expected Mapping | `DUPLICATE_REFERENCE` |
| Expected Label | `metadata_error` |
| Matching Logic | References [6] and [7] are identical or very similar |

**Verification:**
- [ ] In-text "(Vaswani et al., 2017)" and "(Vaswani et al., 2017b)" match refs [6]/[7]
- [ ] Both reference [6] and [7] have same/similar content
- [ ] Mapping status = DUPLICATE_REFERENCE
- [ ] Validation label = metadata_error

**Why this matters:** Duplicate references waste space and may confuse readers.

---

### Scenario APA-08: MATCHED
**Category:** MATCHED
**Description:** Word2Vec paper - MATCHED via DOI/author-year

| Element | Value |
|---------|-------|
| In-text | Word embeddings capture semantic relationships (Mikolov et al., 2013). |
| Reference | [8] T. Mikolov, K. Chen, G. Corrado, and J. Dean. "Efficient Estimation of Word Representations." arXiv, 2013. |
| Expected Mapping | `MATCHED` |
| Expected Label | `verified` |
| Matching Logic | Author-year (Mikolov, 2013) matches reference entry [8] |

**Verification:**
- [ ] In-text citation "(Mikolov et al., 2013)" extracted correctly
- [ ] Reference entry [8] parsed correctly
- [ ] Mapping status = MATCHED
- [ ] Validation label = verified

---

### Scenario APA-09: AMBIGUOUS_MAPPING
**Category:** AMBIGUOUS_MAPPING
**Description:** AMBIGUOUS_MAPPING: Multiple candidates match author+year

| Element | Value |
|---------|-------|
| In-text | Transfer learning proved effective (Pan et al., 2020). |
| Reference | [9] S. J. Pan and Q. Yang. "A Survey on Transfer Learning." IEEE Transactions, 2010.\n[10] F. Pan et al. "Transfer Learning in 2020." New Journal, 2020. |
| Expected Mapping | `AMBIGUOUS_MAPPING` |
| Expected Label | `unresolved` |
| Matching Logic | (Pan et al., 2020) could match reference [9] or [10] - ambiguous |

**Verification:**
- [ ] In-text "(Pan et al., 2020)" matches multiple references
- [ ] Both [9] and [10] are valid candidates
- [ ] Mapping status = AMBIGUOUS_MAPPING
- [ ] Validation label = unresolved

**Why this matters:** Ambiguous mappings need human review to determine correct match.

---

### Scenario APA-10: MATCHED
**Category:** MATCHED
**Description:** GPT-3 paper - MATCHED via DOI/author-year

| Element | Value |
|---------|-------|
| In-text | Large language models show emergent abilities (Brown et al., 2020). |
| Reference | [11] T. B. Brown et al. "Language Models are Few-Shot Learners." NeurIPS, 2020. |
| Expected Mapping | `MATCHED` |
| Expected Label | `verified` |
| Matching Logic | Author-year (Brown, 2020) matches reference entry [11] |

**Verification:**
- [ ] In-text citation "(Brown et al., 2020)" extracted correctly
- [ ] Reference entry [11] parsed correctly
- [ ] Mapping status = MATCHED
- [ ] Validation label = verified

---

## PDF 2: IEEE Style Scenarios (`test_cite_scenario_b.pdf`)

### Scenario IEEE-01: MATCHED
**Category:** MATCHED
**Description:** APA-style citation matches reference [1]

| Element | Value |
|---------|-------|
| In-text | Self-attention mechanisms have transformed deep learning (Vaswani et al., 2017). |
| Reference | [1] A. Vaswani et al., "Attention Is All You Need," NeurIPS, 2017. |
| Expected Mapping | `MATCHED` |
| Expected Label | `verified` |
| Matching Logic | Author-year (Vaswani, 2017) matches reference entry [1] |

**Verification:**
- [ ] In-text citation "(Vaswani et al., 2017)" extracted correctly
- [ ] Reference [1] parsed with author="Vaswani", year="2017"
- [ ] Mapping status = MATCHED
- [ ] Validation label = verified

---

### Scenario IEEE-02: MATCHED
**Category:** MATCHED
**Description:** BERT - matches reference [2]

| Element | Value |
|---------|-------|
| In-text | BERT introduced bidirectional pre-training (Devlin et al., 2019). |
| Reference | [2] J. Devlin et al., "BERT: Pre-training," ACL, 2019. |
| Expected Mapping | `MATCHED` |
| Expected Label | `verified` |
| Matching Logic | Author-year (Devlin, 2019) matches reference entry [2] |

**Verification:**
- [ ] In-text "(Devlin et al., 2019)" extracted correctly
- [ ] Reference [2] parsed correctly
- [ ] Mapping status = MATCHED
- [ ] Validation label = verified

---

### Scenario IEEE-03: MATCHED
**Category:** MATCHED
**Description:** GPT-3 - matches reference [3]

| Element | Value |
|---------|-------|
| In-text | Recent advances demonstrate the power of scale (Brown et al., 2020). |
| Reference | [3] T. B. Brown et al., "GPT-3," NeurIPS, 2020. |
| Expected Mapping | `MATCHED` |
| Expected Label | `verified` |
| Matching Logic | Author-year (Brown, 2020) matches reference entry [3] |

**Verification:**
- [ ] In-text "(Brown et al., 2020)" extracted correctly
- [ ] Reference [3] parsed correctly
- [ ] Mapping status = MATCHED
- [ ] Validation label = verified

---

### Scenario IEEE-04: MISSING_REFERENCE
**Category:** MISSING_REFERENCE
**Description:** MISSING_REFERENCE: cited but no reference entry exists

| Element | Value |
|---------|-------|
| In-text | This novel approach shows promise (NovelPaper, 2021). |
| Reference | **<<NO REFERENCE ENTRY>>** |
| Expected Mapping | `MISSING_REFERENCE` |
| Expected Label | `suspected_hallucination` |
| Matching Logic | Citation (NovelPaper, 2021) has no corresponding reference |

**Verification:**
- [ ] In-text "(NovelPaper, 2021)" extracted correctly
- [ ] No reference entry found
- [ ] Mapping status = MISSING_REFERENCE
- [ ] Validation label = suspected_hallucination

---

### Scenario IEEE-05: UNCITED_REFERENCE
**Category:** UNCITED_REFERENCE
**Description:** UNCITED_REFERENCE: Reference exists but not cited

| Element | Value |
|---------|-------|
| In-text | Baseline methods remain relevant (TraditionalMethod, 2018). |
| Reference | [4] J. Smith, "Classical Methods," 2018. (Not cited in body) |
| Expected Mapping | `UNCITED_REFERENCE` (for reference [4]) |
| Expected Label | `unresolved` |
| Matching Logic | Reference [4] not cited by any in-text |

**Verification:**
- [ ] Reference [4] parsed correctly
- [ ] Reference [4] not cited by any in-text
- [ ] Mapping status = UNCITED_REFERENCE
- [ ] Validation label = unresolved

---

### Scenario IEEE-06: MATCHED
**Category:** MATCHED
**Description:** Multiple APA-style citations match references [5] and [6]

| Element | Value |
|---------|-------|
| In-text | Multiple papers demonstrate versatility (AuthorA, 2018) and (AuthorB, 2019). |
| Reference | [5] A. Author, "Paper A," 2018.\n[6] B. Author, "Paper B," 2019. |
| Expected Mapping | `MATCHED` (for both [5] and [6]) |
| Expected Label | `verified` |
| Matching Logic | Each author-year matches its reference entry |

**Verification:**
- [ ] Citation "(AuthorA, 2018)" → Reference [5]: MATCHED
- [ ] Citation "(AuthorB, 2019)" → Reference [6]: MATCHED
- [ ] Both validation labels = verified

---

### Scenario IEEE-07: STYLE_INCONSISTENT
**Category:** STYLE_INCONSISTENT
**Description:** STYLE_INCONSISTENT: Mix of styles in same doc

| Element | Value |
|---------|-------|
| In-text | Traditional (Johnson, 2018) and modern (ModernPaper, 2019) approaches coexist. |
| Reference | [7] R. Johnson, "Modern Methods," IEEE, 2018. |
| Expected Mapping | `STYLE_INCONSISTENT` |
| Expected Label | `unresolved` |
| Matching Logic | Document uses mixed citation styles |

**Verification:**
- [ ] Mixed APA-style citations detected
- [ ] Reference [7] parsed with IEEE style
- [ ] Mapping status = STYLE_INCONSISTENT
- [ ] Validation label = unresolved

---

### Scenario IEEE-08: MATCHED
**Category:** MATCHED
**Description:** GAN paper - MATCHED

| Element | Value |
|---------|-------|
| In-text | GANs revolutionized generative modeling (Goodfellow et al., 2014). |
| Reference | [8] I. Goodfellow et al., "Generative Adversarial Networks," NeurIPS, 2014. |
| Expected Mapping | `MATCHED` |
| Expected Label | `verified` |
| Matching Logic | Author-year (Goodfellow, 2014) matches reference entry [8] |

**Verification:**
- [ ] In-text "(Goodfellow et al., 2014)" extracted correctly
- [ ] Reference [8] parsed correctly
- [ ] Mapping status = MATCHED
- [ ] Validation label = verified

---

### Scenario IEEE-09: MATCHED
**Category:** MATCHED
**Description:** ResNet paper - MATCHED

| Element | Value |
|---------|-------|
| In-text | ResNet enabled deeper networks (He et al., 2016). |
| Reference | [9] K. He et al., "Deep Residual Learning," CVPR, 2016. |
| Expected Mapping | `MATCHED` |
| Expected Label | `verified` |
| Matching Logic | Author-year (He, 2016) matches reference entry [9] |

**Verification:**
- [ ] In-text "(He et al., 2016)" extracted correctly
- [ ] Reference [9] parsed correctly
- [ ] Mapping status = MATCHED
- [ ] Validation label = verified

---

### Scenario IEEE-10: MATCHED
**Category:** MATCHED
**Description:** Survey paper - MATCHED

| Element | Value |
|---------|-------|
| In-text | Transformer variants continue to evolve (SurveyAuthors, 2023). |
| Reference | [10] Various Authors, "Survey of Transformers," ACM Computing Surveys, 2023. |
| Expected Mapping | `MATCHED` |
| Expected Label | `verified` |
| Matching Logic | Author-year (SurveyAuthors, 2023) matches reference entry [10] |

**Verification:**
- [ ] In-text "(SurveyAuthors, 2023)" extracted correctly
- [ ] Reference [10] parsed correctly
- [ ] Mapping status = MATCHED
- [ ] Validation label = verified

---

## Summary Table

### PDF 1 (APA Style) - 10 Scenarios
| ID | Category | Expected Mapping | Expected Label | Key Details |
|----|----------|------------------|----------------|-------------|
| APA-01 | MATCHED | MATCHED | verified | Vaswani 2017 → [1] |
| APA-02 | MATCHED | MATCHED | verified | Devlin 2019 → [2] |
| APA-03 | MATCHED | MATCHED | verified | Sennrich 2016 → [3] |
| APA-04 | MISSING_REFERENCE | MISSING_REFERENCE | suspected_hallucination | MysteryPaper 2020 - NO REF |
| APA-05 | UNCITED_REFERENCE | UNCITED_REFERENCE | unresolved | Smith 2015 - [4] exists but uncited |
| APA-06 | IN_TEXT_MISMATCH | IN_TEXT_MISMATCH | metadata_error | Vaswani 2017 → [5] but title differs |
| APA-07 | DUPLICATE_REFERENCE | DUPLICATE_REFERENCE | metadata_error | [6-7] are duplicates |
| APA-08 | MATCHED | MATCHED | verified | Mikolov 2013 → [8] |
| APA-09 | AMBIGUOUS_MAPPING | AMBIGUOUS_MAPPING | unresolved | Pan 2020 → [9] or [10] |
| APA-10 | MATCHED | MATCHED | verified | Brown 2020 → [11] |

### PDF 2 (IEEE Style) - 10 Scenarios
| ID | Category | Expected Mapping | Expected Label | Key Details |
|----|----------|------------------|----------------|-------------|
| IEEE-01 | MATCHED | MATCHED | verified | Vaswani 2017 → [1] |
| IEEE-02 | MATCHED | MATCHED | verified | Devlin 2019 → [2] |
| IEEE-03 | MATCHED | MATCHED | verified | Brown 2020 → [3] |
| IEEE-04 | MISSING_REFERENCE | MISSING_REFERENCE | suspected_hallucination | NovelPaper 2021 - NO REF |
| IEEE-05 | UNCITED_REFERENCE | UNCITED_REFERENCE | unresolved | [4] exists but uncited |
| IEEE-06 | MATCHED | MATCHED | verified | AuthorA/B → [5]/[6] |
| IEEE-07 | STYLE_INCONSISTENT | STYLE_INCONSISTENT | unresolved | Mixed styles |
| IEEE-08 | MATCHED | MATCHED | verified | Goodfellow 2014 → [8] |
| IEEE-09 | MATCHED | MATCHED | verified | He 2016 → [9] |
| IEEE-10 | MATCHED | MATCHED | verified | SurveyAuthors 2023 → [10] |

---

## Citation Mapping Status Definitions

| Status | Description | Penalty |
|--------|-------------|---------|
| MATCHED | In-text ↔ Reference khớp | 0.0 |
| MISSING_REFERENCE | In-text không có reference | 1.0 |
| UNCITED_REFERENCE | Reference không được cite | 0.5 |
| IN_TEXT_MISMATCH | Author/year khớp nhưng title khác | 0.8 |
| DUPLICATE_REFERENCE | ≥2 references trỏ cùng source | 0.6 |
| AMBIGUOUS_MAPPING | ≥2 candidates phù hợp | 0.4 |
| STYLE_INCONSISTENT | Citation style không nhất quán | 0.2 |
| UNRESOLVED | Chưa đủ thông tin | 0.0 |

## Validation Label Definitions

| Label | Description |
|-------|-------------|
| verified | Nguồn được xác minh thành công |
| metadata_error | Metadata không khớp |
| suspected_hallucination | Nghi ngờ bịa đặt |
| unresolved | Không đủ bằng chứng |

---

*Generated for Citation Integrity Checker v1.2*
"""

    return md_content


def main():
    """Main entry point."""
    output_dir = Path(__file__).parent / "data" / "test_scenarios"
    output_dir.mkdir(parents=True, exist_ok=True)

    # Generate PDFs
    pdf_a_path = output_dir / "test_cite_scenario_a.pdf"
    pdf_b_path = output_dir / "test_cite_scenario_b.pdf"

    print("Generating test PDFs (v2 - Clean format)...")
    create_pdf_apa_style(str(pdf_a_path))
    create_pdf_ieee_style(str(pdf_b_path))

    # Generate markdown documentation
    md_path = output_dir / "test_scenario_documentation.md"
    md_content = generate_scenario_markdown()

    with open(md_path, 'w', encoding='utf-8') as f:
        f.write(md_content)

    print(f"Generated documentation: {md_path}")
    print("\nTest files created:")
    print(f"  1. {pdf_a_path} - APA Style Scenarios (Clean format)")
    print(f"  2. {pdf_b_path} - IEEE Style Scenarios (Clean format)")
    print(f"  3. {md_path} - Scenario Documentation")

    return str(pdf_a_path), str(pdf_b_path), str(md_path)


if __name__ == "__main__":
    main()
