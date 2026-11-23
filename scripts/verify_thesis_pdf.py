#!/usr/bin/env python3
"""Automated typography, layout, and TDTU/FIT compliance verifier for
FinalReport_TDTU/thesis.pdf (English) and FinalReport_TDTU_VN/thesis.pdf (Vietnamese).
"""

from __future__ import annotations

import re
import sys
from collections import defaultdict
from pathlib import Path

import fitz

REPO_ROOT = Path(__file__).resolve().parents[1]

# TeX pt -> PDF bp conversion: 1 TeX pt = 72 / 72.27 bp (~0.996264 bp)
TEX_PT_TO_BP = 72.0 / 72.27

# Expected A4 text-block horizontal center with left=3.5cm (99.21 bp), right=2.0cm (56.69 bp) on 595.28 bp page:
# [99.21, 538.58] -> center = 318.90 bp
EXPECTED_TEXT_CENTER_X = 318.9
CENTER_TOLERANCE_BP = 14.0


def _approx_pt(actual_bp: float, target_tex_pt: float, tol: float = 0.25) -> bool:
    return abs(actual_bp - target_tex_pt * TEX_PT_TO_BP) <= tol


def _is_bold(font_name: str, flags: int) -> bool:
    return "bold" in font_name.lower() or bool(flags & 16)


def _is_italic(font_name: str, flags: int) -> bool:
    return "italic" in font_name.lower() or "oblique" in font_name.lower() or bool(flags & 2)


def verify_edition(folder_name: str, is_vn: bool) -> list[str]:
    errors: list[str] = []
    folder = REPO_ROOT / folder_name
    pdf_path = folder / "thesis.pdf"
    toc_path = folder / "thesis.toc"
    log_path = folder / "thesis.log"
    bib_path = folder / "TaiLieuThamKhao.tex"
    abbr_path = folder / "DanhMucTuVietTat.tex"

    if not pdf_path.exists():
        return [f"[{folder_name}] Missing compiled {pdf_path}"]

    doc = fitz.open(pdf_path)

    # 1. Paper size A4 portrait (595.28 x 841.89 bp)
    p0_rect = doc[0].rect
    if abs(p0_rect.width - 595.28) > 2.0 or abs(p0_rect.height - 841.89) > 2.0:
        errors.append(f"[{folder_name}] Non-A4 page geometry: {p0_rect}")

    # 2. Cover 1 (Mau 1 / 1E) = 24pt title, 22pt project/major, no student IDs; Cover 2 (Mau 2 / 2E) = 22pt title, 20pt project/major, with IDs
    c1_spans = [
        s
        for b in doc[0].get_text("dict")["blocks"]
        if b.get("type") == 0
        for ln in b["lines"]
        for s in ln["spans"]
        if s["text"].strip()
    ]
    c2_spans = [
        s
        for b in doc[1].get_text("dict")["blocks"]
        if b.get("type") == 0
        for ln in b["lines"]
        for s in ln["spans"]
        if s["text"].strip()
    ]
    c1_text = doc[0].get_text("text")
    c2_text = doc[1].get_text("text")
    p2_text = doc[2].get_text("text")

    if "523H0054" in c1_text:
        errors.append(f"[{folder_name}] Cover 1 (Mau 1/1E) should list author names without Student ID")
    if "523H0054" not in c2_text:
        errors.append(f"[{folder_name}] Cover 2 (Mau 2/2E) missing Student ID 523H0054")
    expected_p3 = "LỜI CẢM ƠN" if is_vn else "ACKNOWLEDGMENT"
    if expected_p3 not in p2_text:
        errors.append(
            f"[{folder_name}] Cover pages overflowed 2 pages (Page 3 expected {expected_p3!r}, got {p2_text[:80]!r})"
        )

    if not any(_approx_pt(s["size"], 24.0) and _is_bold(s["font"], s["flags"]) for s in c1_spans):
        errors.append(f"[{folder_name}] Cover 1 missing 24pt Bold thesis title")
    if not any(_approx_pt(s["size"], 22.0) and _is_bold(s["font"], s["flags"]) for s in c1_spans):
        errors.append(f"[{folder_name}] Cover 1 missing 22pt Bold project/major line")
    if not any(_approx_pt(s["size"], 22.0) and _is_bold(s["font"], s["flags"]) for s in c2_spans):
        errors.append(f"[{folder_name}] Cover 2 missing 22pt Bold thesis title")
    if not any(_approx_pt(s["size"], 20.0) and _is_bold(s["font"], s["flags"]) for s in c2_spans):
        errors.append(f"[{folder_name}] Cover 2 missing 20pt Bold project/major line")

    # 3. Abstract / Tom tat headings (Mau 5: 16pt Bold)
    found_tomtat_16 = False
    found_abstract_16 = False
    for pno in range(2, min(12, len(doc))):
        for b in doc[pno].get_text("dict")["blocks"]:
            if b.get("type") != 0:
                continue
            for ln in b["lines"]:
                txt = "".join(s["text"] for s in ln["spans"]).strip()
                if txt == "TÓM TẮT":
                    found_tomtat_16 = all(
                        _approx_pt(s["size"], 16.0) and _is_bold(s["font"], s["flags"])
                        for s in ln["spans"]
                        if s["text"].strip()
                    )
                elif txt == "ABSTRACT":
                    found_abstract_16 = all(
                        _approx_pt(s["size"], 16.0) and _is_bold(s["font"], s["flags"])
                        for s in ln["spans"]
                        if s["text"].strip()
                    )
    if not found_tomtat_16 or not found_abstract_16:
        errors.append(
            f"[{folder_name}] Abstract/Tom tat headings must be 16pt Bold (TomTat={found_tomtat_16}, Abstract={found_abstract_16})"
        )

    # 4. TOC orphan subsection check & LOF/LOT colon format
    toc_txt = toc_path.read_text(encoding="utf-8")
    sec_nums = re.findall(r"\\numberline \{([0-9.]+)\}", toc_txt)
    children: dict[str, list[str]] = defaultdict(list)
    for n in sec_nums:
        if n.count(".") > 3:
            errors.append(f"[{folder_name}] Heading exceeds 3 subsection levels: {n}")
        if "." in n:
            children[n.rsplit(".", 1)[0]].append(n)
    orphans = {p: c for p, c in children.items() if len(c) < 2}
    if orphans:
        errors.append(f"[{folder_name}] Orphan subsection groups (<2 items): {orphans}")

    # Check Abbreviations A-Z order
    abbr_txt = abbr_path.read_text(encoding="utf-8")
    abbr_keys = [m.group(1).strip() for m in re.finditer(r"^([A-Za-z0-9/\-]+)\s*&", abbr_txt, flags=re.M)]
    if abbr_keys != sorted(abbr_keys, key=str.upper):
        errors.append(f"[{folder_name}] DanhMucTuVietTat.tex is not sorted strictly A-Z")

    # 5. Locate Chapter 1 start page (Arabic page "1") & References start page
    ch1_header = "CHƯƠNG 1." if is_vn else "CHAPTER 1."
    ref_header = "TÀI LIỆU THAM KHẢO" if is_vn else "REFERENCES"
    ch1_pno = -1
    ref_pno = len(doc)
    for pno in range(len(doc)):
        ptxt = doc[pno].get_text("text")
        lines_nonempty = [ln.strip() for ln in ptxt.splitlines() if ln.strip()]
        if (
            ch1_pno < 0
            and lines_nonempty
            and lines_nonempty[0] == "1"
            and any(ln.startswith(ch1_header) for ln in lines_nonempty[:4])
        ):
            ch1_pno = pno
        elif (
            ch1_pno >= 0
            and pno > ch1_pno + 20
            and len(lines_nonempty) >= 2
            and lines_nonempty[1] == ref_header
        ):
            ref_pno = pno
            break
    if ch1_pno < 0:
        errors.append(f"[{folder_name}] Could not locate {ch1_header} body page")
        return errors

    # Verify LOF/LOT colon prefix in frontmatter
    front_txt = "\n".join(doc[p].get_text("text") for p in range(2, ch1_pno))
    expected_lof_prefix = "Hình 2.1:" if is_vn else "Figure 2.1:"
    expected_lot_prefix = "Bảng 1.1:" if is_vn else "Table 1.1:"
    if expected_lof_prefix not in front_txt:
        errors.append(f"[{folder_name}] LOF missing {expected_lof_prefix!r} colon format")
    if expected_lot_prefix not in front_txt:
        errors.append(f"[{folder_name}] LOT missing {expected_lot_prefix!r} colon format")

    # 6. Scan body pages (Chapters 1-6) for 12pt italic centered captions, 12pt table text, 13pt body text, and zero '??'
    fig_prefix = "Hình " if is_vn else "Figure "
    tab_prefix = "Bảng " if is_vn else "Table "
    cap_re = re.compile(rf"^(?:{fig_prefix}|{tab_prefix})\d+\.\d+:\s+\S")

    caption_count = 0
    bad_captions: list[str] = []
    table_12pt_spans = 0
    table_bold_12pt_spans = 0
    body_13pt_spans = 0

    for pno in range(len(doc)):
        raw_page_txt = doc[pno].get_text("text")
        if "??" in raw_page_txt:
            errors.append(f"[{folder_name}] Unresolved '??' reference on PDF page {pno + 1}")

    for pno in range(ch1_pno, ref_pno):
        d = doc[pno].get_text("dict")
        for b in d["blocks"]:
            if b.get("type") != 0:
                continue
            for ln in b["lines"]:
                line_txt = "".join(s["text"] for s in ln["spans"]).strip()
                if not line_txt:
                    continue
                if cap_re.match(line_txt):
                    caption_count += 1
                    x0, _, x1, _ = ln["bbox"]
                    line_center = 0.5 * (x0 + x1)
                    # Check Times New Roman spans on the caption line: must be 12pt, italic, NOT bold
                    tnr_spans = [
                        s
                        for s in ln["spans"]
                        if s["text"].strip() and "times" in s["font"].lower()
                    ]
                    for s in tnr_spans:
                        if not _approx_pt(s["size"], 12.0):
                            bad_captions.append(
                                f"p.{pno+1} size={s['size']:.2f}bp ({line_txt[:45]})"
                            )
                        if _is_bold(s["font"], s["flags"]):
                            bad_captions.append(
                                f"p.{pno+1} unexpected BOLD ({line_txt[:45]})"
                            )
                        if not _is_italic(s["font"], s["flags"]):
                            bad_captions.append(
                                f"p.{pno+1} not ITALIC ({line_txt[:45]})"
                            )
                    if abs(line_center - EXPECTED_TEXT_CENTER_X) > CENTER_TOLERANCE_BP:
                        bad_captions.append(
                            f"p.{pno+1} not centered (center={line_center:.1f} vs {EXPECTED_TEXT_CENTER_X}, {line_txt[:45]})"
                        )
                else:
                    for s in ln["spans"]:
                        if not s["text"].strip() or "times" not in s["font"].lower():
                            continue
                        if _approx_pt(s["size"], 12.0):
                            table_12pt_spans += 1
                            if _is_bold(s["font"], s["flags"]):
                                table_bold_12pt_spans += 1
                        elif _approx_pt(s["size"], 13.0):
                            body_13pt_spans += 1

    if caption_count != 52:
        errors.append(
            f"[{folder_name}] Expected 52 captions (32 tables + 20 figures), found {caption_count}"
        )
    if bad_captions:
        errors.append(
            f"[{folder_name}] Caption style/alignment violations ({len(bad_captions)}): {bad_captions[:5]}"
        )
    if table_12pt_spans < 500 or table_bold_12pt_spans < 150:
        errors.append(
            f"[{folder_name}] Too few 12pt table spans ({table_12pt_spans}) or 12pt bold spans ({table_bold_12pt_spans})"
        )
    if body_13pt_spans < 1000:
        errors.append(f"[{folder_name}] Too few 13pt body spans ({body_13pt_spans})")

    # 7. IEEE Reference style preserved
    bib_txt = bib_path.read_text(encoding="utf-8")
    if r"\begin{thebibliography}{99}" not in bib_txt or r"\bibitem{" not in bib_txt:
        errors.append(f"[{folder_name}] TaiLieuThamKhao.tex must preserve IEEE numbered bibliography")
    if is_vn and ("Accessed:" in bib_txt or "[Online]. Available:" in bib_txt):
        errors.append(f"[{folder_name}] Vietnamese bibliography contains unlocalized English 'Accessed:' / '[Online]'")

    # 8. Log file check for undefined citations/references
    if log_path.exists():
        log_txt = log_path.read_text(encoding="utf-8", errors="ignore")
        if "There were undefined references" in log_txt or "Citation `" in log_txt:
            errors.append(f"[{folder_name}] XeLaTeX log reports undefined references or citations")

    print(
        f"[OK] {folder_name}: pages={len(doc)}, captions={caption_count} (all 12pt italic centered), "
        f"table_12pt_spans={table_12pt_spans} (bold={table_bold_12pt_spans}), body_13pt_spans={body_13pt_spans}"
    )
    return errors


def main() -> int:
    all_errors = verify_edition("FinalReport_TDTU", is_vn=False) + verify_edition(
        "FinalReport_TDTU_VN", is_vn=True
    )
    if all_errors:
        for err in all_errors:
            print("ERROR:", err, file=sys.stderr)
        return 1
    print("ALL TDTU/FIT THESIS FORMATTING & IEEE BIBLIOGRAPHY CHECKS PASSED!")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
