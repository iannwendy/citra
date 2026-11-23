# TDTU Graduation Thesis Formatting & Authoring Specification (English Edition — `FinalReport_TDTU`)

Authoritative specification for writing, editing, formatting, and compiling the English graduation project report (`FinalReport_TDTU/thesis.pdf` and `thesis.docx`), synthesized from **Ton Duc Thang University's Official Thesis Presentation Guidelines** (*Quyết định hướng dẫn trình bày Khóa luận, Đồ án tốt nghiệp — Mục 1–4 & Mẫu 1E–10E*) and the **Faculty of Information Technology (FIT) Table & Caption Typography Rules**, with the project's explicit **IEEE Reference Style Override**.

Keep `FinalReport_TDTU/` (English) and `../FinalReport_TDTU_VN/` (Vietnamese) in **1-to-1 structural, quantitative, and version parity** on every edit.

---

## 1. Page Setup & Body Typography (Section 2.1)

| Element | Specification | LaTeX Implementation (`format.tex`) |
| :--- | :--- | :--- |
| **Paper & Orientation** | White A4 (`210 x 297 mm`), single-sided portrait | `\documentclass[12pt,a4paper]{report}` |
| **Margins** | Top **3.5 cm**, Bottom **3.0 cm**, Left **3.5 cm**, Right **2.0 cm** | `\usepackage[left=3.5cm, right=2cm, top=3.5cm, bottom=3cm]{geometry}` |
| **Body Font & Size** | **Times New Roman** (Unicode), **13 pt**, normal character spacing (never condense or expand tracking) | `\setmainfont{Times New Roman}` + `\changefontsizes{13pt}` |
| **Line Spacing** | **1.5 lines** (`\parskip = 0pt`) | `\linespread{1.5}` / `\setstretch{1.5}` |
| **Paragraph Indentation** | First line of every body paragraph indented **1 Word tab (`1.27 cm` / `0.5 in`)** | `\usepackage{indentfirst}` + `\setlength{\parindent}{1.27cm}` |
| **Page Numbering** | **Centered at the top header** of every numbered page (including chapter-opening `plain` pages) | `\fancyhead[C]{\thepage}` in both `fancy` and `plain` styles |
| **Landscape Pages** | Avoid whenever possible; if unavoidable, align the top of the wide table/figure to the **left binding margin** | Keep portrait tables within `\textwidth` using proportional `L`/`C`/`R` columns |

---

## 2. Tables, Captions, Figures & Equations (Section 2.3 + FIT 12 pt Table/Caption Spec)

### 2.1 Typography & Alignment Matrix (Mandatory FIT Spec)

| Element | Font Size | Style & Emphasis | Alignment & Placement |
| :--- | :---: | :--- | :--- |
| **Data Table Content (`Nội dung bảng`)** | **12 pt** | **Normal** (`\mdseries\upshape`) by default; **Bold (`\textbf{...}`)** for column headers, group banners, primary row keys/IDs, the **CITRA / Proposed** row, pass statuses, SLA targets, and winning metrics | **Vertically centered in cells (`Giữa ô`)** via `m{...}` (`L{w}`, `C{w}`, `R{w}`); short IDs/metrics horizontally & vertically centered (`C{w}`) |
| **Table Caption (`Tên bảng`)** | **12 pt** | **Regular weight, sentence case, italic (`Chữ thường, nghiêng`)** — both `Table X.Y:` label and title are `12 pt` non-bold italic | **Centered, above the table (`Giữa, trên bảng`)** (`position=above, justification=centering`); `longtable` continuation headers also `12 pt` centered italic |
| **Figure Caption (`Tên hình`)** | **12 pt** | **Regular weight, sentence case, italic (`Chữ thường, nghiêng`)** — both `Figure X.Y:` label and title are `12 pt` non-bold italic | **Centered, below the figure (`Giữa, dưới hình`)** (`position=below, justification=centering`) |
| **Code Listing Caption** | **12 pt** | **Regular weight, sentence case, italic** | **Centered, above the listing** (`captionpos=t`) |

> **Scope rule:** `\tdtudatatabletrue` (enabled in `NoiDungChinh.tex`) applies `12 pt` automatically to all `longtable` and `table` environments across Chapters 1–6. Borderless frontmatter layout tables (signature blocks in `LoiCamOn.tex`, `LoiCamDoan.tex`, `CamKet.tex` and the 2-column `P{0.22}P{0.78}` glossary in `DanhMucTuVietTat.tex`) stay at **13 pt** top-aligned body size.

### 2.2 Numbering, Self-Containment & Placement Rules
- **Chapter-prefixed numbering:** Number tables, figures, and equations sequentially within each chapter: `Table 3.1`, `Figure 4.2`, `Equation (2.1)`.
- **Self-contained captions:** Write concise, clear captions that stand on their own **without cross-referencing other chapters** (write *"mapped against project research objectives"*, never *"mapped against Chapter 1 objectives"*). Define every symbol, unit, or non-obvious abbreviation.
- **Immediate placement & explicit callouts:** Reference every table and figure by exact number in the prose **before** its float appears (`as shown in Table 4.1`, `see Figure 3.4` — never write unnumbered *"the table below"*). Place short tables/charts immediately after their first mention.
- **Figure quality & copyright:** Preserve aspect ratio (`keepaspectratio`), render crisp Q1 scientific diagrams/charts (`crafting-q1-scientific-figures`), and cite external sources beneath the caption when reproducing third-party material.
- **Equations (`Phương trình`):** Keep single-line or multi-line display style consistent throughout the thesis, align parenthesized equation numbers `(2.1)` to the **right margin** (`\begin{equation}`), and explain every newly introduced symbol and unit immediately after the equation.

---

## 3. Chapter & Subsection Hierarchy (Section 2.2 & Mẫu 6E)

- **Chapter Headings:** **16 pt Bold ALL CAPS**, left-aligned (`CHAPTER 1. INTRODUCTION`). Unnumbered front/back headings (`\chapter*`): **16 pt Bold ALL CAPS, Centered**.
- **Maximum Depth:** At most **3 subsection levels** beneath a chapter (`4.1` bold, `4.1.1` bold, `4.1.1.1` italic), numbered with the chapter number first.
- **Minimum-2 Sibling Rule (Zero Orphans):** Every subdivided heading group **must contain at least 02 sibling items** — never write `4.1.1` without `4.1.2`, or `4.1.1.1` without `4.1.1.2`.

---

## 4. Abbreviations (`Viết tắt`, Section 2.4 & Mẫu 9E)

- Abbreviate only terms, organizations, or technical concepts used **multiple times** across the report; avoid abbreviating long clauses or one-off phrases.
- Spell out the full term on its first occurrence followed by the abbreviation in parentheses, e.g., `Citation Integrity Score (CIS)`.
- Maintain `DanhMucTuVietTat.tex` (`ABBREVIATIONS`, **16 pt Bold Centered** heading) sorted **strictly A–Z**.

---

## 5. Complete Document Order & Official Templates (Sections 1 & 3, Mẫu 1E–9E)

Assemble `thesis.tex` in this exact sequence:

1. **Main Cover Page (`coverpage.tex` page 1 — Mẫu 1E):** Unnumbered (`titlepage`).
   - `VIETNAM GENERAL CONFEDERATION OF LABOUR` (**14 pt** Regular)
   - `TON DUC THANG UNIVERSITY` / `FACULTY OF INFORMATION TECHNOLOGY` (**14 pt Bold**)
   - Official TDTU logo (`picture/logo`)
   - Author full names (**14 pt Bold**, without student IDs on Mẫu 1E)
   - Thesis title (**24 pt Bold**, ALL CAPS)
   - `GRADUATION PROJECT` / `MAJOR: SOFTWARE ENGINEERING` (**22 pt Bold**, ALL CAPS)
   - `HO CHI MINH CITY, 2026` (**14 pt Bold**)
2. **Sub-Cover Page (`coverpage.tex` page 2 — Mẫu 2E):** Unnumbered (`titlepage`).
   - Same top university/faculty header (**14 pt** Regular / **14 pt Bold**) + TDTU logo
   - Author full names `--` Student IDs (**14 pt Bold**)
   - Thesis title (**22 pt Bold**, ALL CAPS)
   - `GRADUATION PROJECT` / `MAJOR: SOFTWARE ENGINEERING` (**20 pt Bold**, ALL CAPS)
   - `Advised by` (**14 pt** Regular) + Advisor title & full name (**14 pt Bold**)
   - `HO CHI MINH CITY, 2026` (**14 pt Bold**)
3. **Acknowledgment (`LoiCamOn.tex` — Mẫu 3E):** `ACKNOWLEDGMENT` (**16 pt Bold Centered**), concise gratitude, right-aligned italic city/date and author signature block. Unnumbered.
4. **Committee Confirmation & Declaration (`LoiCamDoan.tex` Mẫu 4-1E + `CamKet.tex` Mẫu 4-2E):**
   - `LoiCamDoan.tex`: Advisor line, Examination Committee date, `CHAIRMAN` & `DEAN OF FACULTY` signature blocks. Unnumbered.
   - `CamKet.tex`: `DECLARATION OF AUTHORSHIP` (**16 pt Bold Centered**), official originality & citation pledge with bold fraud-responsibility sentence (`\textbf{We will take full responsibility for any fraud detected in our thesis.}`), author signature block. Unnumbered.
5. *(Task Assignment Sheet / Phiếu giao nhiệm vụ — inserted physically when required by Faculty at binding time.)*
6. **Bilingual Abstracts (`TomTatVN.tex` + `TomTat.tex` — Mẫu 5):**
   - Project title + `TÓM TẮT` / `ABSTRACT` (**16 pt Bold Centered**), **13 pt** body text (1–2 pages summarizing problem, approach, methodology, quantitative results, and `Keywords` / `Từ khóa`). Unnumbered.
7. **Table of Contents (`MucLuc.tex` — Mẫu 6E):** `CONTENTS` (**16 pt Bold Centered**), unnumbered pages, listing `LIST OF FIGURES`, `LIST OF TABLES`, `ABBREVIATIONS`, `CHAPTER 1. ...` through `CHAPTER 6. ...`, `REFERENCES`, and `APPENDICES`.
8. **List of Figures (`MucLuc.tex` — Mẫu 7E):** `LIST OF FIGURES` (**16 pt Bold Centered**), Roman page numbers (`i, ii, ...`), entries formatted `Figure 1.1: Title ... page`.
9. **List of Tables (`MucLuc.tex` — Mẫu 8E):** `LIST OF TABLES` (**16 pt Bold Centered**), Roman page numbers, entries formatted `Table 1.1: Title ... page`.
10. **Abbreviations (`DanhMucTuVietTat.tex` — Mẫu 9E):** `ABBREVIATIONS` (**16 pt Bold Centered**), Roman page numbers, A–Z glossary.
11. **Main Body Chapters (`NoiDungChinh.tex` — Chapters 1–6):** Arabic page numbers starting at `1` (`chapter1_rewritten.tex`..`chapter6_rewritten.tex`):
    - Ch. 1 Introduction (motivation, problem, objectives, scope, contributions, outline)
    - Ch. 2 Background & Related Work (literature gap analysis, registries, theoretical foundations)
    - Ch. 3 System Analysis & Design (IEEE 29148 FRs, ISO/IEC 25010 NFRs, RBAC/UML, data model, API/security)
    - Ch. 4 System Architecture & Implementation (8-layer implementation, 68 symbolic rules, 16D ML + Platt, CIS, React UI)
    - Ch. 5 System Verification & Experimental Results (RTM, test suites, 120K ID, 2.4K OOD, 310 PDFs, latency/load, threats to validity)
    - Ch. 6 Conclusion & Future Work (concise synthesis of achieved results without redundant commentary per Section 1(5), limitations, future directions)
12. **References (`TaiLieuThamKhao.tex`) — EXPLICIT IEEE STYLE OVERRIDE:**
    - **Keep IEEE numbered style (`[1]`, `[2]`, ...)** via `\begin{thebibliography}{99}` and inline `\cite{...}` markers across all chapters (explicitly overriding the generic APA section of the university-wide guideline).
    - Cite every external paper, dataset, standard, software library, or statutory document used; never leave uncited bibliography entries or unresolved `\cite{...}` keys; avoid citing trivial common knowledge.
    - Format online technical resources with publication year and `Accessed: Mon. D, YYYY. [Online]. Available: \url{...}`.
    - For verbatim quotations exceeding 2–3 lines (rare in SE theses), indent `+2 cm` from the left margin in italics without quotation marks (Section 2.5).
13. **Appendices (`PhuLuc.tex` — Section 2.7):** `APPENDICES` (**16 pt Bold Centered**). Supporting configurations, verdict taxonomy, module map, and contribution log. Total appendix pages **must strictly remain fewer than main body pages**.
14. **Binding & Digital Submission Package (Section 4 & Mẫu 10E):** Hard-bound green simili cover with gold-foil lettering after committee sign-off; digital submission folder `MSSV_FullName/` containing `Readme`, `Word/` (`.docx`), `Pdf/` (`.pdf`), `Resource/`, and `Source/`.

---

## 6. Build & Verification Checklist (Mandatory Before Completion)

Run all three steps whenever modifying `.tex` or formatting files:

```bash
# 1. Three-pass XeLaTeX build so TOC, LOF, LOT, and longtable widths converge
cd FinalReport_TDTU && xelatex -interaction=nonstopmode thesis.tex && xelatex -interaction=nonstopmode thesis.tex && xelatex -interaction=nonstopmode thesis.tex

# 2. Optional Word (.docx) regeneration when requested
cd FinalReport_TDTU && pandoc thesis_docx.tex -f latex -t docx -o thesis.raw.docx && python3 format_docx.py thesis.raw.docx thesis.docx && rm -f thesis.raw.docx

# 3. Run automated PDF typography & bilingual parity verification from repo root
.venv/bin/python scripts/verify_thesis_pdf.py
.venv/bin/python -m pytest tests/unit/test_se_audit_devops_configs_and_docs.py tests/unit/test_final_report_thesis_eng_vie_regressions.py -q
```

Completion requires **zero** undefined references/citations (`??`), **zero** orphan subsections, exact **12 pt** data tables & centered italic captions, exact **13 pt** body text, 1-page Cover 1 (`24 pt / 22 pt`) & 1-page Cover 2 (`22 pt / 20 pt`), and full EN↔VN metric/SemVer parity.
