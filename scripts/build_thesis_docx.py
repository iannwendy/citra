#!/usr/bin/env python3
"""Bulletproof LaTeX -> Word (.docx) builder for FinalReport_TDTU (EN) & FinalReport_TDTU_VN (VN).

Solves all four Pandoc LaTeX-reader failure modes on the TDTU thesis sources:
  1. Custom tabular/longtable column types L{w}/C{w}/R{w}/P{w}, \\dimexpr multicolumn
     footnotes, and longtable head/foot blocks that caused Pandoc to drop all 34 data tables.
  2. \\fbox{\\includegraphics...} frames that caused Pandoc to drop all 10 UI screenshots.
  3. \\begin{vietnamese}...\\end{vietnamese} wrappers and thebibliography entries that
     dropped references and omitted [1]..[60] IEEE numbering.
  4. Unresolved \\ref/\\eqref/\\cite, \\appsection counters (A..E), citraalgo blocks,
     and lstlisting code blocks.

After building each DOCX via Pandoc + format_docx.py + clean OOXML table borders,
runs a strict programmatic quality gate asserting tables, embedded media, references,
appendices, and zero raw LaTeX leaks.
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

REPO_ROOT = Path(__file__).resolve().parent.parent
W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"


def _read_braced(text: str, pos: int) -> tuple[str, int]:
    """Read a balanced {...} group starting at pos (where text[pos] == '{')."""
    if pos >= len(text) or text[pos] != "{":
        raise ValueError(f"Expected '{{' at pos {pos}")
    depth = 0
    i = pos
    while i < len(text):
        ch = text[i]
        if ch == "\\" and i + 1 < len(text):
            i += 2
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return text[pos + 1 : i], i + 1
        i += 1
    raise ValueError(f"Unclosed '{{' starting at pos {pos}")


def _read_optional_bracket(text: str, pos: int) -> tuple[str | None, int]:
    """Read an optional [...] group starting at pos after whitespace."""
    j = pos
    while j < len(text) and text[j] in " \t\n\r":
        j += 1
    if j >= len(text) or text[j] != "[":
        return None, pos
    depth = 0
    i = j
    while i < len(text):
        ch = text[i]
        if ch == "\\" and i + 1 < len(text):
            i += 2
            continue
        if ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1
            if depth == 0:
                return text[j + 1 : i], i + 1
        i += 1
    return None, pos


def parse_aux_file(aux_path: Path) -> tuple[dict[str, str], dict[str, str]]:
    """Parse thesis.aux to extract \\bibcite{key}{N} and \\newlabel{key}{{num}{page}...}."""
    aux = aux_path.read_text(encoding="utf-8", errors="replace")
    bib_map: dict[str, str] = {}
    for m in re.finditer(r"\\bibcite\{([^}]+)\}\{([^}]+)\}", aux):
        bib_map[m.group(1).strip()] = m.group(2).strip()

    label_map: dict[str, str] = {}
    idx = 0
    needle = "\\newlabel{"
    while True:
        pos = aux.find(needle, idx)
        if pos == -1:
            break
        key_start = pos + len(needle) - 1
        try:
            key, after_key = _read_braced(aux, key_start)
            outer, after_outer = _read_braced(aux, after_key)
            if outer.startswith("{"):
                num, _ = _read_braced(outer, 0)
            else:
                num = outer.split("}", 1)[0]
            label_map[key.strip()] = num.strip()
            idx = after_outer
        except ValueError:
            idx = pos + len(needle)
    return bib_map, label_map


def _strip_comments(tex: str) -> str:
    """Strip unescaped LaTeX % line comments."""
    out_lines: list[str] = []
    for line in tex.splitlines():
        i = 0
        cut = len(line)
        while i < len(line):
            if line[i] == "\\" and i + 1 < len(line):
                i += 2
                continue
            if line[i] == "%":
                cut = i
                break
            i += 1
        out_lines.append(line[:cut])
    return "\n".join(out_lines)


def _flatten_inputs(edition_dir: Path, tex_path: Path, seen: set[Path] | None = None) -> str:
    """Recursively inline \\input{...} relative to edition_dir."""
    if seen is None:
        seen = set()
    resolved = tex_path.resolve()
    if resolved in seen:
        return ""
    seen.add(resolved)
    raw = resolved.read_text(encoding="utf-8")

    # Preserve lstlisting blocks untouched during comment stripping
    listings: list[str] = []

    def _stash_lst(m: re.Match[str]) -> str:
        listings.append(m.group(0))
        return f"@@LSTBLOCK{len(listings) - 1}@@"

    raw = re.sub(
        r"\\begin\{lstlisting\}.*?\\end\{lstlisting\}",
        _stash_lst,
        raw,
        flags=re.DOTALL,
    )
    raw = _strip_comments(raw)
    for idx, blk in enumerate(listings):
        raw = raw.replace(f"@@LSTBLOCK{idx}@@", blk)

    def _repl_input(m: re.Match[str]) -> str:
        name = m.group(1).strip()
        if name in {"MucLuc", "MucLuc.tex"}:
            return "% SKIPPED_MUCLUC"
        cand = edition_dir / (name if name.endswith(".tex") else f"{name}.tex")
        if not cand.exists():
            return ""
        return "\n" + _flatten_inputs(edition_dir, cand, seen) + "\n"

    return re.sub(r"\\input\{([^}]+)\}", _repl_input, raw)


def _replace_macro_1arg(tex: str, macro: str, transform) -> str:
    """Replace all occurrences of \\macro{arg} with transform(arg), brace-balanced."""
    token = f"\\{macro}"
    out: list[str] = []
    i = 0
    n = len(tex)
    while i < n:
        pos = tex.find(token, i)
        if pos == -1:
            out.append(tex[i:])
            break
        after = pos + len(token)
        # Ensure exact command boundary (not prefix of longer macro)
        if after < n and tex[after].isalpha():
            out.append(tex[i:after])
            i = after
            continue
        # Skip optional whitespace before '{'
        j = after
        while j < n and tex[j] in " \t":
            j += 1
        if j < n and tex[j] == "{":
            try:
                arg, end_pos = _read_braced(tex, j)
                out.append(tex[i:pos])
                out.append(transform(arg))
                i = end_pos
                continue
            except ValueError:
                pass
        out.append(tex[i:after])
        i = after
    return "".join(out)


def _replace_macro_2arg(tex: str, macro: str, transform) -> str:
    """Replace all occurrences of \\macro{a}{b} with transform(a, b), brace-balanced."""
    token = f"\\{macro}"
    out: list[str] = []
    i = 0
    n = len(tex)
    while i < n:
        pos = tex.find(token, i)
        if pos == -1:
            out.append(tex[i:])
            break
        after = pos + len(token)
        if after < n and tex[after].isalpha():
            out.append(tex[i:after])
            i = after
            continue
        j = after
        while j < n and tex[j] in " \t\n":
            j += 1
        if j < n and tex[j] == "{":
            try:
                a1, p1 = _read_braced(tex, j)
                while p1 < n and tex[p1] in " \t\n":
                    p1 += 1
                a2, p2 = _read_braced(tex, p1)
                out.append(tex[i:pos])
                out.append(transform(a1, a2))
                i = p2
                continue
            except ValueError:
                pass
        out.append(tex[i:after])
        i = after
    return "".join(out)


def _expand_colspec(spec: str) -> str:
    """Convert custom TDTU L{w}/C{w}/R{w}/P{w} column specs to Pandoc-safe p{w\\textwidth}."""
    # Remove @{...} expressions
    spec = re.sub(r"@\{[^}]*\}", "", spec)
    # Replace L{0.25}, C{0.11}, R{0.15}, P{0.22} -> p{0.25\textwidth}
    spec = re.sub(r"[LCRP]\{([0-9.]+)\}", r"p{\1\\textwidth}", spec)
    # Replace p{2.5cm} / p{0.48\textwidth} cleanly
    spec = re.sub(r"p\{([0-9.]+)cm\}", lambda m: f"p{{{min(0.85, float(m.group(1))/15.5):.2f}\\textwidth}}", spec)
    return spec


def _transform_tables(tex: str, label_map: dict[str, str], is_vn: bool) -> str:
    """Normalize longtable & table/tabular environments so Pandoc converts 100% into Word tables."""
    tbl_prefix = "Bảng" if is_vn else "Table"

    # 1. Convert \begin{longtable}{spec} ... \end{longtable}
    def _convert_longtable(m: re.Match[str]) -> str:
        body = m.group(1)
        # Read colspec right at start of body
        body_s = body.lstrip()
        if not body_s.startswith("{"):
            return m.group(0)
        colspec, after_spec = _read_braced(body_s, 0)
        rest = body_s[after_spec:]
        colspec_clean = _expand_colspec(colspec)

        # Extract caption & label (may appear before \endfirsthead)
        caption_txt = ""
        label_key = ""
        cap_idx = rest.find("\\caption")
        if cap_idx != -1:
            opt, after_opt = _read_optional_bracket(rest, cap_idx + len("\\caption"))
            if after_opt < len(rest) and rest[after_opt] == "{":
                cap_body, after_cap = _read_braced(rest, after_opt)
                caption_txt = cap_body.strip()
                # Look for \label{...} right after caption
                lbl_m = re.match(r"\s*\\label\{([^}]+)\}", rest[after_cap:])
                if lbl_m:
                    label_key = lbl_m.group(1).strip()
                    after_cap += lbl_m.end()
                # Strip trailing \\ after caption/label
                trail_m = re.match(r"\s*\\\\\*?", rest[after_cap:])
                if trail_m:
                    after_cap += trail_m.end()
                rest = rest[:cap_idx] + rest[after_cap:]

        if not label_key:
            lbl_m = re.search(r"\\label\{([^}]+)\}", rest)
            if lbl_m:
                label_key = lbl_m.group(1).strip()
                rest = rest[: lbl_m.start()] + rest[lbl_m.end() :]

        # Strip repeated header/footer chunks between \endfirsthead and \endlastfoot
        if "\\endfirsthead" in rest and "\\endlastfoot" in rest:
            pre_head, after_first = rest.split("\\endfirsthead", 1)
            _, post_foot = after_first.split("\\endlastfoot", 1)
            rest = pre_head + "\n" + post_foot
        else:
            rest = re.sub(r"\\end(?:firsthead|head|foot|lastfoot)", "", rest)

        rest = _clean_table_body(rest)

        # Extract any trailing \multicolumn footnote row into clean paragraph below table
        rest, footnote = _extract_table_footnote(rest)

        if caption_txt:
            num = label_map.get(label_key, "")
            full_cap = f"{tbl_prefix}~{num}: {caption_txt}" if num else caption_txt
            out = (
                "\\begin{table}\n"
                f"\\caption{{{full_cap}}}\n"
                f"\\begin{{tabular}}{{{colspec_clean}}}\n"
                f"{rest}\n"
                "\\end{tabular}\n"
                "\\end{table}\n"
            )
        else:
            # Borderless abbreviation/glossary longtable
            out = (
                f"\\begin{{tabular}}{{{colspec_clean}}}\n"
                f"{rest}\n"
                "\\end{tabular}\n"
            )
        if footnote:
            out += f"\n\\noindent\\textit{{{footnote}}}\\par\n"
        return out

    tex = re.sub(
        r"\\begin\{longtable\}(.*?)\\end\{longtable\}",
        _convert_longtable,
        tex,
        flags=re.DOTALL,
    )

    # 2. Convert \begin{table}[...] ... \end{table}
    def _convert_table(m: re.Match[str]) -> str:
        inner = m.group(1)
        # Drop placement option like [!htbp]
        inner = re.sub(r"^\s*\[[^\]]*\]", "", inner)
        inner = inner.replace("\\centering", "")

        label_key = ""
        lbl_m = re.search(r"\\label\{([^}]+)\}", inner)
        if lbl_m:
            label_key = lbl_m.group(1).strip()
            inner = inner[: lbl_m.start()] + inner[lbl_m.end() :]

        cap_idx = inner.find("\\caption")
        if cap_idx != -1:
            _, after_opt = _read_optional_bracket(inner, cap_idx + len("\\caption"))
            if after_opt < len(inner) and inner[after_opt] == "{":
                cap_body, after_cap = _read_braced(inner, after_opt)
                num = label_map.get(label_key, "")
                full_cap = f"{tbl_prefix}~{num}: {cap_body.strip()}" if num else cap_body.strip()
                inner = inner[:cap_idx] + f"\\caption{{{full_cap}}}" + inner[after_cap:]

        # Expand \begin{tabular}{spec} ... \end{tabular}
        footnote_all: list[str] = []

        def _fix_tabular(tm: re.Match[str]) -> str:
            tbody = tm.group(1)
            tbody_s = tbody.lstrip()
            if not tbody_s.startswith("{"):
                return tm.group(0)
            colspec, after_spec = _read_braced(tbody_s, 0)
            colspec_clean = _expand_colspec(colspec)
            trest = _clean_table_body(tbody_s[after_spec:])
            trest, fn = _extract_table_footnote(trest)
            if fn:
                footnote_all.append(fn)
            return f"\\begin{{tabular}}{{{colspec_clean}}}\n{trest}\n\\end{{tabular}}"

        inner = re.sub(
            r"\\begin\{tabular\}(.*?)\\end\{tabular\}",
            _fix_tabular,
            inner,
            flags=re.DOTALL,
        )
        out = f"\\begin{{table}}\n{inner}\n\\end{{table}}\n"
        for fn in footnote_all:
            out += f"\n\\noindent\\textit{{{fn}}}\\par\n"
        return out

    tex = re.sub(
        r"\\begin\{table\}(.*?)\\end\{table\}",
        _convert_table,
        tex,
        flags=re.DOTALL,
    )

    # 3. Also expand any standalone \begin{tabular}{...} (e.g., frontmatter signature blocks)
    def _fix_standalone_tabular(tm: re.Match[str]) -> str:
        tbody = tm.group(1)
        tbody_s = tbody.lstrip()
        if not tbody_s.startswith("{"):
            return tm.group(0)
        colspec, after_spec = _read_braced(tbody_s, 0)
        colspec_clean = _expand_colspec(colspec)
        trest = _clean_table_body(tbody_s[after_spec:])
        return f"\\begin{{tabular}}{{{colspec_clean}}}\n{trest}\n\\end{{tabular}}"

    tex = re.sub(
        r"\\begin\{tabular\}(.*?)\\end\{tabular\}",
        _fix_standalone_tabular,
        tex,
        flags=re.DOTALL,
    )

    return tex


def _clean_table_body(body: str) -> str:
    """Clean table body macros that interfere with Pandoc's tabular parser."""
    # Replace \\* with \\
    body = body.replace("\\\\*", "\\\\")
    # Convert \multicolumn{N}{|l|}{banner} -> single-cell banner across columns (Pandoc handles |l|)
    body = re.sub(r"\\multicolumn\{(\d+)\}\{\|?l\|?\}", r"\\multicolumn{\1}{l}", body)
    # Remove \dimexpr column specs in multicolumn
    body = re.sub(r"\\multicolumn\{(\d+)\}\{p\{\\dimexpr[^}]*\\relax\}\}", r"\\multicolumn{\1}{l}", body)
    # Replace \newline inside cells cleanly (space after HTTP + Wayback, semicolon elsewhere)
    body = re.sub(r"\\textbf\{HTTP \+ Wayback\}~\\cite\{wayback-cdx\}\\newline\s*", r"\\textbf{HTTP + Wayback}~\\cite{wayback-cdx} ", body)
    body = body.replace("\\newline", "; ")
    # Remove \arraybackslash / \centering inside cells
    body = body.replace("\\arraybackslash", "")
    return body.strip()


def _extract_table_footnote(body: str) -> tuple[str, str]:
    """Pull trailing \\multicolumn{N}{l}{\\scriptsize ...} footnote out of tabular body."""
    m = re.search(r"\\multicolumn\{\d+\}\{l\}\{", body)
    if not m:
        return body, ""
    # Only extract if it contains \scriptsize (actual footnote, not subsystem banner!)
    start = m.start()
    brace_pos = m.end() - 1
    try:
        content, end_pos = _read_braced(body, brace_pos)
    except ValueError:
        return body, ""
    if "\\scriptsize" not in content:
        return body, ""
    clean_fn = content.replace("\\scriptsize", "").strip()
    new_body = (body[:start] + body[end_pos:]).strip()
    return new_body, clean_fn


def _transform_figures(tex: str, label_map: dict[str, str], is_vn: bool) -> str:
    """Unwrap \\fbox around images, number figure captions, and preserve dual-panel figures."""
    fig_prefix = "Hình" if is_vn else "Figure"

    # Strip \fboxsep=... \fboxrule=...
    tex = re.sub(r"\\fboxsep\s*=\s*[^\s\\]+", "", tex)
    tex = re.sub(r"\\fboxrule\s*=\s*[^\s\\]+", "", tex)
    # Unwrap \fbox{...} cleanly (brace-balanced)
    tex = _replace_macro_1arg(tex, "fbox", lambda arg: arg)

    def _convert_figure(m: re.Match[str]) -> str:
        inner = m.group(1)
        inner = re.sub(r"^\s*\[[^\]]*\]", "", inner)
        inner = inner.replace("\\centering", "")

        label_key = ""
        lbl_m = re.search(r"\\label\{([^}]+)\}", inner)
        if lbl_m:
            label_key = lbl_m.group(1).strip()
            inner = inner[: lbl_m.start()] + inner[lbl_m.end() :]

        cap_text = ""
        cap_idx = inner.find("\\caption")
        if cap_idx != -1:
            _, after_opt = _read_optional_bracket(inner, cap_idx + len("\\caption"))
            if after_opt < len(inner) and inner[after_opt] == "{":
                cap_body, after_cap = _read_braced(inner, after_opt)
                num = label_map.get(label_key, "")
                cap_text = f"{fig_prefix}~{num}: {cap_body.strip()}" if num else cap_body.strip()
                inner = inner[:cap_idx] + inner[after_cap:]

        # Find all \includegraphics[opts]{path} inside this figure
        imgs = re.findall(r"\\includegraphics(?:\[[^\]]*\])?\{([^}]+)\}", inner)
        if not imgs:
            return m.group(0)

        # Normalize paths (add .png if missing extension)
        norm_imgs = [p if "." in Path(p).name else f"{p}.png" for p in imgs]
        if len(norm_imgs) == 1:
            return (
                "\\begin{figure}\n"
                f"\\includegraphics[width=0.95\\textwidth]{{{norm_imgs[0]}}}\n"
                f"\\caption{{{cap_text}}}\n"
                "\\end{figure}\n"
            )
        # Dual stacked screenshot figure: emit first image as standalone paragraph,
        # second image inside figure with the shared numbered caption so BOTH embed cleanly!
        parts = []
        for img_p in norm_imgs[:-1]:
            parts.append(f"\\begin{{center}}\n\\includegraphics[width=0.94\\textwidth]{{{img_p}}}\n\\end{{center}}\n")
        parts.append(
            "\\begin{figure}\n"
            f"\\includegraphics[width=0.94\\textwidth]{{{norm_imgs[-1]}}}\n"
            f"\\caption{{{cap_text}}}\n"
            "\\end{figure}\n"
        )
        return "\n".join(parts)

    tex = re.sub(
        r"\\begin\{figure\}(.*?)\\end\{figure\}",
        _convert_figure,
        tex,
        flags=re.DOTALL,
    )

    # Also ensure coverpage logo resolves to the actual logo.jpg asset
    tex = re.sub(
        r"\\includegraphics(\[[^\]]*\])?\{picture/logo\}",
        r"\\includegraphics\1{picture/logo.jpg}",
        tex,
    )
    return tex


def _transform_algorithms(tex: str, is_vn: bool) -> str:
    """Convert citraalgo environments into clean Pandoc-friendly blocks."""
    algo_word = "Thuật toán" if is_vn else "Algorithm"

    def _conv(m: re.Match[str]) -> str:
        rest = m.group(1)
        num, p1 = _read_braced(rest, 0)
        title, p2 = _read_braced(rest, p1)
        _, p3 = _read_braced(rest, p2)
        body = rest[p3:].strip()
        # Clean inner {\setlength{\leftmargini}... \begin{enumerate}...\end{enumerate}}
        body = re.sub(r"\\setlength\{\\leftmargini\}\{[^}]+\}", "", body)
        body = re.sub(r"\\setlength\{\\itemsep\}\{[^}]+\}", "", body)
        body = re.sub(r"\\setlength\{\\parskip\}\{[^}]+\}", "", body)
        return (
            f"\n\\par\\noindent\\textbf{{{algo_word}~{num}:}} {title}\\par\n"
            f"{body}\n\\par\n"
        )

    return re.sub(
        r"\\begin\{citraalgo\}(.*?)\\end\{citraalgo\}",
        _conv,
        tex,
        flags=re.DOTALL,
    )


def _transform_bibliography(tex: str, bib_map: dict[str, str], is_vn: bool) -> str:
    """Convert thebibliography into an explicit numbered [1]..[60] chapter."""
    heading = "TÀI LIỆU THAM KHẢO" if is_vn else "REFERENCES"

    def _conv_bib(m: re.Match[str]) -> str:
        body = m.group(1)
        items = re.split(r"\\bibitem\{([^}]+)\}", body)
        # items = [preamble, key1, text1, key2, text2, ...]
        lines = [f"\\chapter*{{{heading}}}\n"]
        idx_fallback = 1
        for k in range(1, len(items), 2):
            key = items[k].strip()
            entry = items[k + 1].strip() if k + 1 < len(items) else ""
            # Flatten multiline entry whitespace
            entry = re.sub(r"\s+", " ", entry)
            num = bib_map.get(key, str(idx_fallback))
            idx_fallback += 1
            lines.append(f"\\noindent\\textbf{{[{num}]}} {entry}\\par\n")
        return "\n".join(lines)

    tex = re.sub(r"\\renewcommand\\bibname\{[^}]+\}", "", tex)
    return re.sub(
        r"\\begin\{thebibliography\}\{[^}]*\}(.*?)\\end\{thebibliography\}",
        _conv_bib,
        tex,
        flags=re.DOTALL,
    )


def _transform_listings(tex: str, label_map: dict[str, str], is_vn: bool) -> tuple[str, list[str]]:
    """Stash lstlisting blocks as placeholders and format as caption + verbatim."""
    lst_word = "Đoạn mã" if is_vn else "Listing"
    stashed: list[str] = []

    def _conv_lst(m: re.Match[str]) -> str:
        opts = m.group(1) or ""
        code = m.group(2).strip("\n")

        # Extract caption={...} and label={...}
        cap = ""
        cap_pos = opts.find("caption=")
        if cap_pos != -1:
            brace_pos = opts.find("{", cap_pos)
            if brace_pos != -1:
                cap, _ = _read_braced(opts, brace_pos)

        lbl = ""
        lbl_m = re.search(r"label=\{([^}]+)\}", opts)
        if lbl_m:
            lbl = lbl_m.group(1).strip()

        num = label_map.get(lbl, "")
        cap_line = ""
        if cap:
            cap_line = f"\\noindent\\textit{{{lst_word}~{num}: {cap}}}\\par\n" if num else f"\\noindent\\textit{{{cap}}}\\par\n"

        block = f"\n{cap_line}\\begin{{verbatim}}\n{code}\n\\end{{verbatim}}\n"
        stashed.append(block)
        return f"@@VERBATIMSTASH{len(stashed) - 1}@@"

    tex = re.sub(
        r"\\begin\{lstlisting\}(?:\[([^\]]*)\])?(.*?)\\end\{lstlisting\}",
        _conv_lst,
        tex,
        flags=re.DOTALL,
    )
    return tex, stashed


def _unwrap_scoped_groups(tex: str) -> str:
    """Unwrap {...} groups that exist solely to scope \\setlength, \\renewcommand, \\centering, \\fontsize, etc."""
    # Iteratively unwrap { \setlength... body } or { \renewcommand... body } or { \centering body }
    scope_prefix = re.compile(
        r"\{\s*(?:\\(?:setlength|renewcommand|centering|linespread|fontsize|selectfont|mdseries|bfseries|itshape|setstretch)\b)"
    )
    changed = True
    while changed:
        changed = False
        m = scope_prefix.search(tex)
        if not m:
            break
        start = m.start()
        try:
            inner, end = _read_braced(tex, start)
        except ValueError:
            break
        # Only unwrap if it wraps an environment or multi-line block (keeps inline {\bfseries text} safe!)
        if (
            "\\begin{" in inner
            or "\\par" in inner
            or "\\setlength" in inner[:80]
            or "\\renewcommand" in inner[:80]
            or "\\centering" in inner[:60]
            or "\\fontsize" in inner[:80]
        ):
            # If it's a pure inline \fontsize{...}{...}\selectfont\bfseries HEADER\par block, strip style commands inside
            tex = tex[:start] + inner + tex[end:]
            changed = True
        else:
            break
    return tex


def _strip_macro_def(tex: str, cmd: str) -> str:
    """Remove \\providecommand{\\name}[N]{...} or \\newcommand{\\name}[N]{...} brace-balanced."""
    pat = re.compile(rf"\\(?:provide|re|new)command\{{\\{re.escape(cmd)}\}}(?:\[\d+\])?\s*\{{")
    while True:
        m = pat.search(tex)
        if not m:
            break
        brace_pos = m.end() - 1
        try:
            _, end_pos = _read_braced(tex, brace_pos)
            tex = tex[: m.start()] + tex[end_pos:]
        except ValueError:
            break
    return tex


def _preprocess_latex(edition_dir: Path, is_vn: bool) -> str:
    """Build a single Pandoc-ready LaTeX document from edition_dir."""
    bib_map, label_map = parse_aux_file(edition_dir / "thesis.aux")
    tex = _flatten_inputs(edition_dir, edition_dir / "thesis_docx.tex")

    # Split preamble and document body
    marker = "\\begin{document}"
    _, body = tex.split(marker, 1)
    body = body.rsplit("\\end{document}", 1)[0]

    # 1. Stash lstlisting code blocks BEFORE any macro substitution
    body, stashed_listings = _transform_listings(body, label_map, is_vn)

    # 1b. Strip macro redefinitions cleanly (brace-balanced!) BEFORE macro expansion
    body = _strip_macro_def(body, "rqanswer")
    body = _strip_macro_def(body, "thelstlisting")
    body = _strip_macro_def(body, "arraystretch")

    # 2. Strip polyglossia language wrapper environments & unwrap scoping braces
    body = re.sub(r"\\(?:begin|end)\{(?:vietnamese|english)\}", "", body)
    body = _unwrap_scoped_groups(body)

    # 3. Expand \appsection{Title}{label} with exact A..E from thesis.aux
    app_word = "Phụ lục" if is_vn else "Appendix"
    body = _replace_macro_2arg(
        body,
        "appsection",
        lambda title, lbl: f"\\section*{{{app_word}~{label_map.get(lbl.strip(), '')}: {title.strip()}}}",
    )

    # 4. Expand \rqanswer{RQn}{text}
    ans_word = "Trả lời" if is_vn else "Answer to"
    body = _replace_macro_2arg(
        body,
        "rqanswer",
        lambda rq, txt: f"\n\\par\\noindent\\textbf{{{ans_word} {rq.strip()}:}} {txt.strip()}\\par\n",
    )

    # 5. Transform algorithms, bibliography, figures, and tables
    body = _transform_algorithms(body, is_vn)
    body = _transform_bibliography(body, bib_map, is_vn)
    body = _transform_figures(body, label_map, is_vn)
    body = _transform_tables(body, label_map, is_vn)

    # 6. Number chapters explicitly ("CHAPTER 1. INTRODUCTION" / "CHƯƠNG 1. GIỚI THIỆU")
    chap_word = "CHƯƠNG" if is_vn else "CHAPTER"
    chap_counter = [0]

    def _num_chapter(title: str) -> str:
        chap_counter[0] += 1
        return f"\\chapter{{{chap_word} {chap_counter[0]}. {title.strip().upper()}}}"

    body = _replace_macro_1arg(body, "chapter", _num_chapter)

    # 7. Resolve \cite{...}, \eqref{...}, \ref{...}
    def _resolve_cite(keys_str: str) -> str:
        nums = [bib_map.get(k.strip(), "?") for k in keys_str.split(",") if k.strip()]
        return "[" + ", ".join(nums) + "]"

    body = _replace_macro_1arg(body, "cite", _resolve_cite)
    body = _replace_macro_1arg(body, "eqref", lambda k: f"({label_map.get(k.strip(), '?')})")
    body = _replace_macro_1arg(body, "ref", lambda k: label_map.get(k.strip(), "?"))

    # 8. Clean typography & layout macros Pandoc leaves behind or misrenders
    body = re.sub(r"\\allowbreak\{\}", "", body)
    body = re.sub(r"\\allowbreak\b\s*", "", body)
    body = _replace_macro_1arg(body, "nolinkurl", lambda u: f"\\texttt{{{u}}}")
    body = _replace_macro_1arg(body, "mbox", lambda x: x)
    body = _replace_macro_1arg(body, "textsc", lambda x: x.upper())
    body = re.sub(r"\\urlstyle\{[^}]+\}", "", body)
    body = re.sub(r"\\FloatBarrier\b", "", body)
    body = re.sub(r"\\needspace\{[^}]+\}", "", body)
    body = re.sub(r"\\phantomsection\b", "", body)
    body = re.sub(r"\\tdtudatatable(?:true|false)\b", "", body)
    body = re.sub(r"\\thispagestyle\{[^}]+\}", "", body)
    body = re.sub(r"\\pagestyle\{[^}]+\}", "", body)
    body = re.sub(r"\\pagenumbering\{[^}]+\}", "", body)
    body = re.sub(r"\\numberwithin\{[^}]+\}\{[^}]+\}", "", body)
    body = re.sub(r"\\setcounter\{[^}]+\}\{[^}]+\}", "", body)
    body = re.sub(r"\\setlength\{\\(?:tabcolsep|itemsep|parskip|parindent)\}\{[^}]+\}", "", body)
    body = re.sub(r"\\addcontentsline\{[^}]+\}\{[^}]+\}\{[^}]+\}", "", body)
    body = re.sub(r"\\hspace\*?\{\\parindent\}", "", body)
    body = re.sub(r"\\setstretch\{[^}]+\}", "", body)
    body = re.sub(r"\\linespread\{[^}]+\}(?:\\selectfont)?", "", body)
    body = re.sub(r"\\fontsize\{[^}]+\}\{[^}]+\}\\selectfont", "", body)
    body = re.sub(r"\\(?:mdseries|bfseries|selectfont)\b", "", body)
    body = re.sub(r"\\label\{[^}]+\}", "", body)
    body = body.replace("\\begin{titlepage}", "\\begin{center}").replace("\\end{titlepage}", "\\end{center}\\newpage")
    body = body.replace("\\vfill", "\n\n")
    body = body.replace("\\,", " ")
    # Fix \string^ used in TypeScript semver & render \setminus cleanly as Unicode U+2216 in Word OMML
    body = body.replace("\\string^", "\\textasciicircum{}")
    body = body.replace("\\setminus", "\\mathbin{\\text{\u2216}}")

    # 9. Re-inject stashed verbatim listings
    for idx, blk in enumerate(stashed_listings):
        body = body.replace(f"@@VERBATIMSTASH{idx}@@", blk)

    # Clean minimal Pandoc-safe preamble
    preamble = (
        "\\documentclass[13pt,a4paper]{report}\n"
        "\\usepackage{graphicx}\n"
        "\\usepackage{amssymb,amsmath}\n"
        "\\usepackage{hyperref}\n"
        "\\begin{document}\n"
    )
    return preamble + body + "\n\\end{document}\n"


def _add_word_table_borders(docx_path: Path) -> None:
    """Apply subtle, uniform 0.5pt grid borders to all data tables in word/document.xml."""
    with zipfile.ZipFile(docx_path, "r") as zin:
        entries = {name: zin.read(name) for name in zin.namelist()}

    root = ET.fromstring(entries["word/document.xml"])
    q = lambda tag: f"{{{W_NS}}}{tag}"

    for tbl in root.findall(f".//{q('tbl')}"):
        # Check if this is a data table (has >= 3 rows or bold header) vs 2-col signature block
        rows = tbl.findall(q("tr"))
        if len(rows) <= 2:
            continue
        # Skip 2-column abbreviations table (>50 rows, 2 cols)
        first_cells = rows[0].findall(q("tc"))
        if len(rows) > 50 and len(first_cells) == 2:
            continue

        tbl_pr = tbl.find(q("tblPr"))
        if tbl_pr is None:
            tbl_pr = ET.Element(q("tblPr"))
            tbl.insert(0, tbl_pr)
        old_b = tbl_pr.find(q("tblBorders"))
        if old_b is not None:
            tbl_pr.remove(old_b)
        borders = ET.SubElement(tbl_pr, q("tblBorders"))
        for side in ("top", "left", "bottom", "right", "insideH", "insideV"):
            ET.SubElement(
                borders,
                q(side),
                {
                    q("val"): "single",
                    q("sz"): "4",
                    q("space"): "0",
                    q("color"): "BFBFBF",
                },
            )

    entries["word/document.xml"] = ET.tostring(root, encoding="UTF-8", xml_declaration=True)
    with zipfile.ZipFile(docx_path, "w", compression=zipfile.ZIP_DEFLATED) as zout:
        for name, data in entries.items():
            zout.writestr(name, data)


def verify_docx(docx_path: Path, is_vn: bool) -> dict[str, object]:
    """Run strict programmatic quality gate on the generated DOCX."""
    with zipfile.ZipFile(docx_path, "r") as zf:
        names = zf.namelist()
        media = [n for n in names if n.startswith("word/media/")]
        doc_xml = zf.read("word/document.xml")

    root = ET.fromstring(doc_xml)
    q = lambda tag: f"{{{W_NS}}}{tag}"
    tables = root.findall(f".//{q('tbl')}")
    all_text = "\n".join(
        "".join(t.text or "" for t in p.findall(f".//{q('t')}"))
        for p in root.findall(f".//{q('p')}")
    )

    # Check bibliography [1]..[60]
    missing_refs = [n for n in range(1, 61) if f"[{n}]" not in all_text]

    # Check Appendices A..E
    app_word = "Phụ lục" if is_vn else "Appendix"
    missing_apps = [
        letter
        for letter in ("A", "B", "C", "D", "E")
        if f"{app_word} {letter}:" not in all_text and f"{app_word}\u00a0{letter}:" not in all_text
    ]

    # Check zero raw LaTeX leaks
    leak_patterns = [
        r"\[tab:[a-z0-9_-]+\]",
        r"\[fig:[a-z0-9_-]+\]",
        r"\[app:[a-z0-9_-]+\]",
        r"\[chap:[a-z0-9_-]+\]",
        r"\[sec:[a-z0-9_-]+\]",
        r"\\begin\{",
        r"\\end\{",
        r"\\allowbreak",
        r"\\cite\{",
        r"\\ref\{",
        r"\\eqref\{",
        r"3\.5ex",
        r"@@VERBATIMSTASH",
        r"@@LSTBLOCK",
        r"\[\?\]",
    ]
    leaks: list[str] = []
    for pat in leak_patterns:
        hits = re.findall(pat, all_text)
        if hits:
            leaks.extend(hits[:3])

    stats = {
        "path": str(docx_path),
        "tables": len(tables),
        "media": len(media),
        "missing_refs": missing_refs,
        "missing_apps": missing_apps,
        "leaks": leaks,
    }

    errors: list[str] = []
    if len(tables) < 35:
        errors.append(f"Expected >= 35 Word tables, got {len(tables)}")
    if len(media) < 25:
        errors.append(f"Expected >= 25 embedded images, got {len(media)}")
    if missing_refs:
        errors.append(f"Missing bibliography items: {missing_refs[:10]}")
    if missing_apps:
        errors.append(f"Missing appendices: {missing_apps}")
    if leaks:
        errors.append(f"Raw LaTeX leaks detected: {leaks[:10]}")

    if errors:
        raise AssertionError(f"DOCX verification FAILED for {docx_path.name}: " + "; ".join(errors))
    return stats


def build_edition(edition_dir: Path, is_vn: bool) -> dict[str, object]:
    """Preprocess, convert via Pandoc, apply format_docx.py + table borders, and verify."""
    pre_tex = _preprocess_latex(edition_dir, is_vn)

    with tempfile.TemporaryDirectory() as tmp:
        tmp_dir = Path(tmp)
        flat_tex = tmp_dir / "thesis_pandoc_flat.tex"
        raw_docx = tmp_dir / "thesis.raw.docx"
        out_docx = edition_dir / "thesis.docx"

        flat_tex.write_text(pre_tex, encoding="utf-8")

        pandoc_cmd = [
            "pandoc",
            str(flat_tex),
            "--from=latex",
            "--to=docx",
            f"--resource-path={edition_dir}",
            "-o",
            str(raw_docx),
        ]
        res = subprocess.run(pandoc_cmd, capture_output=True, text=True, check=False)
        if res.returncode != 0:
            raise RuntimeError(f"Pandoc failed for {edition_dir.name}:\n{res.stderr}")

        fmt_script = edition_dir / "format_docx.py"
        fmt_res = subprocess.run(
            [sys.executable, str(fmt_script), str(raw_docx), str(out_docx)],
            capture_output=True,
            text=True,
            check=False,
        )
        if fmt_res.returncode != 0:
            raise RuntimeError(f"format_docx.py failed for {edition_dir.name}:\n{fmt_res.stderr}")

        _add_word_table_borders(out_docx)

    return verify_docx(out_docx, is_vn)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--edition",
        choices=("en", "vn", "both"),
        default="both",
        help="Which edition(s) to build and verify.",
    )
    args = parser.parse_args()

    targets: list[tuple[Path, bool]] = []
    if args.edition in ("en", "both"):
        targets.append((REPO_ROOT / "FinalReport_TDTU", False))
    if args.edition in ("vn", "both"):
        targets.append((REPO_ROOT / "FinalReport_TDTU_VN", True))

    for edition_dir, is_vn in targets:
        stats = build_edition(edition_dir, is_vn)
        print(
            f"[PASS] {edition_dir.name}/thesis.docx — "
            f"tables={stats['tables']}, media={stats['media']}, "
            f"refs=60/60, appendices=A..E, leaks=0"
        )


if __name__ == "__main__":
    main()
