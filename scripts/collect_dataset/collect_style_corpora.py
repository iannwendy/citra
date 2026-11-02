#!/usr/bin/env python3
"""
Fast, concurrent multi-source academic/student PDF scraper for the 11 citation styles:
APA, IEEE, Vancouver, Chicago, Harvard, MLA, ACM, Nature, CSE, ACS, AMA.

Collects 20 real, validated PDFs per style (220 PDFs total) into:
    style_corpora/<STYLE>/real/01_<slug>.pdf ... 20_<slug>.pdf
with incremental manifest persistence in:
    style_corpora/<STYLE>/real/metadata.json

Usage:
    .venv/bin/python -u scripts/collect_dataset/collect_style_corpora.py \
        --output style_corpora \
        --per-style 20 \
        --workers 12
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import threading
import time
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.parse import quote

import fitz  # PyMuPDF
import requests
from dotenv import load_dotenv

STYLES: list[str] = [
    "APA",
    "IEEE",
    "Vancouver",
    "Chicago",
    "Harvard",
    "MLA",
    "ACM",
    "Nature",
    "CSE",
    "ACS",
    "AMA",
]

# Domains that frequently block automated requests with Cloudflare 403 or HTML interstitials
BLOCKED_DOMAINS: tuple[str, ...] = (
    "wiley.com",
    "oup.com",
    "mdpi.com",
    "sciencedirect.com",
    "elsevier.com",
    "tandfonline.com",
    "springer.com/counter",
    "biomedcentral.com/counter",
    "frontiersin.org",
    "sagepub.com",
    "karger.com",
    "europepmc.org",
    "hal.science",
    "archives-ouvertes.fr",
    "ncbi.nlm.nih.gov",
    "jamanetwork.com",
    "cambridge.org",
    "degruyter.com",
    "iop.org",
    "rsc.org",
    "acs.org",
    "Taylor",
    "academia.edu",
    "researchgate.net",
    "ssrn.com",
    "jstor.org",
    "muse.jhu.edu",
)

# Recognizable bibliography/reference section headings
REF_HEADER_RE = re.compile(
    r"(?:^|\n)\s*(?:[0-9IVX]+\.?\s*)?"
    r"(References|Bibliography|Works\s+Cited|Literature\s+Cited|Reference\s+List|"
    r"Tài\s+liệu\s+tham\s+khảo|Danh\s+mục\s+tài\s+liệu\s+tham\s+khảo|"
    r"Notes\s+and\s+References|References\s+and\s+Notes|Notes|Sources|"
    r" Bibliographie|Referencias|Referências|Literaturverzeichnis)\s*(?:\n|$)",
    re.IGNORECASE,
)

# Style-specific regexes for signal extraction
PATTERNS = {
    # In-text patterns
    "intext_bracket_num": re.compile(r"\[([1-9]\d{0,2}(?:\s*[,–\-]\s*[1-9]\d{0,2})*)\]"),
    "intext_paren_num": re.compile(r"(?<=[A-Za-z.,;])\s*\(([1-9]\d{0,2})\)"),
    "intext_author_comma_year": re.compile(
        r"\(([A-ZÀ-Ý][A-Za-zÀ-ÿ'\-]+(?:\s+(?:et\s+al\.|(?:&|and)\s+[A-ZÀ-Ý][A-Za-zÀ-ÿ'\-]+))?),\s*((?:19|20)\d{2}[a-z]?)\)"
    ),
    "intext_author_nocomma_year": re.compile(
        r"\((?!(?:Table|Figure|Fig|Section|Chapter|Part|Page|Vol|No|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b)"
        r"([A-ZÀ-Ý][A-Za-zÀ-ÿ'\-]+(?:\s+(?:et\s+al\.|(?:&|and)\s+[A-ZÀ-Ý][A-Za-zÀ-ÿ'\-]+))?)\s+((?:19|20)\d{2}[a-z]?)(?:,\s*(?:pp?\.\s*)?\d+(?:[–\-]\d+)?)?\)"
    ),
    "intext_author_page_mla": re.compile(
        r"\((?!(?:Table|Figure|Fig|Section|Chapter|Part|Page|Vol|No|Eq|Model|Step|Case|Type|Group|Class|Level|Stage)\b)"
        r"([A-Z][a-zA-Z'\-]{2,}(?:\s+(?:and\s+[A-Z][a-zA-Z'\-]{2,}|et\s+al\.))?)\s+([1-9]\d{0,3}(?:[–\-][1-9]\d{0,3})?)\)"
    ),
    # Bibliography patterns
    "bib_ieee": re.compile(
        r"(?:^|\n)\s*\[\s*\d+\s*\]\s+[A-Z]\.\s*[A-Za-z\-]+.*?(?:[\"\u201c].+?[\"\u201d]|vol\.|pp\.|IEEE|Proc\.|Conf\.)",
        re.IGNORECASE,
    ),
    "bib_acm": re.compile(
        r"(?:^|\n)\s*\[\s*\d+\s*\]\s+[A-Z][a-z]+\s+[A-Z][A-Za-z\-]+.*?(?:\b(?:19|20)\d{2}\b|ACM|Proceedings|10\.1145/)",
    ),
    "bib_apa": re.compile(
        r"(?:^|\n)\s*[A-ZÀ-Ý][A-Za-zÀ-ÿ'\-]+,\s*(?:[A-Z]\.\s*)+(?:,\s*&\s*[A-ZÀ-Ý][A-Za-zÀ-ÿ'\-]+,\s*(?:[A-Z]\.\s*)+)?\s*\((?:19|20)\d{2}[a-z]?\)\.",
    ),
    "bib_harvard": re.compile(
        r"(?:^|\n)\s*[A-ZÀ-Ý][A-Za-zÀ-ÿ'\-]+,\s*(?:[A-Z]\.\s*)+(?:and\s+[A-ZÀ-Ý][A-Za-zÀ-ÿ'\-]+,\s*(?:[A-Z]\.\s*)+)?\s*(?:\((?:19|20)\d{2}[a-z]?\)|,\s*(?:19|20)\d{2}[a-z]?\.)\s*(?:['\u2018].+?['\u2019]|.+?\bpp\.\s*\d+)",
    ),
    "bib_vancouver": re.compile(
        r"(?:^|\n)\s*(?:\d+\.\s+|\[\d+\]\s+)?[A-Z][a-zA-Z\-]+\s+[A-Z]{1,3}(?:,\s*[A-Z][a-zA-Z\-]+\s+[A-Z]{1,3})*.*?\.\s*(?:19|20)\d{2}\s*;\s*\d+",
    ),
    "bib_ama": re.compile(
        r"(?:^|\n)\s*\d+\.\s+[A-Z][a-zA-Z\-]+\s+[A-Z]{1,3}(?:,\s*[A-Z][a-zA-Z\-]+\s+[A-Z]{1,3})*(?:,\s*et\s+al)?\..*?\b(?:19|20)\d{2};\d+(?:\([^)]+\))?:\d+",
    ),
    "bib_nature": re.compile(
        r"(?:^|\n)\s*(?:\d+\.\s+)?[A-Z][a-zA-Z'\-]+,\s*(?:[A-Z]\.\s*)+.*?\b\d+\s*,\s*(?:[A-Za-z]?\d+[–\-]?\d*)\s*\((?:19|20)\d{2}\)\.",
    ),
    "bib_acs": re.compile(
        r"(?:^|\n)\s*(?:\(\d+\)|\d+\.|\[\d+\])?\s*[A-Z][a-zA-Z'\-]+,\s*(?:[A-Z]\.\s*)+;\s*[A-Z][a-zA-Z'\-]+,\s*(?:[A-Z]\.\s*)+.*?\b(?:19|20)\d{2}\s*,\s*\d+",
    ),
    "bib_cse": re.compile(
        r"(?:^|\n)\s*(?:\d+\.\s+)?[A-Z][a-zA-Z'\-]+(?:\s+[A-Z]{1,3}|,\s*(?:[A-Z]\.\s*)+).*?\.\s*(?:19|20)\d{2}\.\s+[A-Z]",
    ),
    "bib_chicago": re.compile(
        r"(?:^|\n)\s*[A-Z][a-zA-Z'\-]+,\s+[A-Z][a-z]{2,}.*?(?:[\"\u201c].+?[\"\u201d]|\bvol\.\s*\d+|\bno\.\s*\d+|\(\d{4}\):\s*\d+|\b(?:19|20)\d{2}\.\s+[\"\u201cA-Z])",
    ),
    "bib_mla": re.compile(
        r"(?:^|\n)\s*[A-Z][a-zA-Z'\-]+,\s+[A-Z][a-z]{2,}.*?(?:[\"\u201c].+?[\"\u201d].*?(?:vol\.|no\.|pp\.)|(?:University\s+Press|UP|Press|Routledge|Palgrave|Oxford|Cambridge),\s*(?:19|20)\d{2})",
    ),
    "footnote_chicago": re.compile(
        r"(?:^|\n)\s*\d{1,3}\s+[A-Z][a-z]+\s+[A-Z][a-zA-Z'\-]+,\s*(?:[\"\u201c].+?[\"\u201d]|.+?\([A-Z][a-zA-Z\s]+:\s*[^)]+(?:19|20)\d{2}\))",
    ),
}


def get_github_token() -> str | None:
    token = os.environ.get("GITHUB_TOKEN")
    if token:
        return token.strip()
    try:
        return subprocess.check_output(["gh", "auth", "token"], text=True, timeout=5).strip()
    except Exception:
        return None


def make_slug(text: str, max_len: int = 55) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "_", text.lower()).strip("_")
    slug = re.sub(r"_+", "_", slug)
    return (slug[:max_len].rstrip("_")) or "academic_paper"


def fast_download_pdf(url: str, timeout: tuple[float, float] = (4.0, 8.0)) -> bytes | None:
    """Download PDF bytes with strict streaming header & size validation."""
    if not url or not url.startswith(("http://", "https://")):
        return None
    url_lower = url.lower()
    if any(b in url_lower for b in BLOCKED_DOMAINS):
        return None

    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
        ),
        "Accept": "application/pdf,application/octet-stream;q=0.9,*/*;q=0.8",
    }
    try:
        with requests.get(url, headers=headers, timeout=timeout, stream=True, allow_redirects=True) as r:
            if r.status_code != 200:
                return None
            cl = int(r.headers.get("Content-Length", 0) or 0)
            if cl > 14_800_000 or (0 < cl < 15_000):
                return None
            chunks: list[bytes] = []
            total = 0
            for chunk in r.iter_content(chunk_size=32768):
                if not chunk:
                    break
                if not chunks:
                    # Allow small leading whitespace before %PDF
                    stripped = chunk.lstrip()
                    if not stripped.startswith(b"%PDF"):
                        return None
                chunks.append(chunk)
                total += len(chunk)
                if total > 14_800_000:
                    return None
            data = b"".join(chunks).lstrip()
            if len(data) < 15_000 or not data.startswith(b"%PDF"):
                return None
            return data
    except Exception:
        return None


def analyze_pdf_bytes(pdf_bytes: bytes, hint_style: str | None = None) -> dict | None:
    """Validate PDF rules and extract citation style signals using PyMuPDF (fitz)."""
    if not pdf_bytes or not pdf_bytes.startswith(b"%PDF") or len(pdf_bytes) >= 15 * 1024 * 1024:
        return None

    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    except Exception:
        return None

    try:
        if doc.is_encrypted:
            return None
        num_pages = len(doc)
        if num_pages < 3 or num_pages > 80:
            return None

        # Check landscape slides (reject presentation decks)
        sample_p = min(5, num_pages)
        landscape = sum(1 for i in range(sample_p) if doc[i].rect.width > doc[i].rect.height * 1.18)
        if landscape >= (sample_p // 2 + 1):
            return None

        page_texts: list[str] = []
        total_chars = 0
        for i in range(num_pages):
            t = doc[i].get_text("text") or ""
            page_texts.append(t)
            total_chars += len(t)

        full_text = "\n".join(page_texts)
        if len(full_text.strip()) < 1500:
            return None

        # Find Reference / Bibliography section or footnotes
        ref_matches = list(REF_HEADER_RE.finditer(full_text))
        has_ref_header = bool(ref_matches)
        ref_header_name = ref_matches[-1].group(1).strip() if ref_matches else ""

        if ref_matches:
            split_pos = ref_matches[-1].start()
            # Ensure split_pos is reasonably in the latter 65% of the doc, else check earlier match
            if split_pos < len(full_text) * 0.25 and len(ref_matches) > 1:
                split_pos = ref_matches[-1].start()
            body_text = full_text[:split_pos]
            bib_text = full_text[split_pos:]
        else:
            split_pos = int(len(full_text) * 0.72)
            body_text = full_text[:split_pos]
            bib_text = full_text[split_pos:]

        # Extract signals across styles
        counts = {k: len(pat.findall(body_text if k.startswith("intext_") else bib_text)) for k, pat in PATTERNS.items()}
        counts["footnote_chicago"] = len(PATTERNS["footnote_chicago"].findall(full_text))

        # Check if recognizable bibliography OR Chicago footnotes exist
        total_bib_entries = sum(v for k, v in counts.items() if k.startswith("bib_"))
        has_numbered_refs = len(re.findall(r"(?:^|\n)\s*(?:\[\d{1,3}\]|\d{1,3}\.)\s+[A-Z]", bib_text)) >= 3
        has_author_refs = len(re.findall(r"(?:^|\n)\s*[A-Z][a-zA-Z'\-]+,\s+[A-Z]", bib_text)) >= 3

        if not (has_ref_header or counts["footnote_chicago"] >= 3 or total_bib_entries >= 3 or has_numbered_refs or has_author_refs):
            return None

        # Additional document-level cues
        has_works_cited = bool(re.search(r"\bWorks\s+Cited\b", full_text, re.IGNORECASE))
        has_lit_cited = bool(re.search(r"\bLiterature\s+Cited\b", full_text, re.IGNORECASE))
        has_acm_marker = bool(re.search(r"(?:ACM\s+Reference\s+Format|Association\s+for\s+Computing\s+Machinery|10\.1145/)", full_text))
        has_ieee_marker = bool(re.search(r"(?:IEEE|10\.1109/|vol\.\s*\d+,\s*no\.\s*\d+,\s*pp\.)", full_text))
        has_nature_marker = bool(re.search(r"(?:www\.nature\.com|Nature\s+Communications|Scientific\s+Reports|10\.1038/)", full_text))
        has_acs_marker = bool(re.search(r"(?:Beilstein\s+J\.\s+Org\.\s+Chem|ACS\s+Omega|J\.\s+Am\.\s+Chem\.\s+Soc|Chem\.\s+Rev\.|Org\.\s+Lett\.)", full_text))
        has_ama_marker = bool(re.search(r"(?:JAMA|Cureus|10\.1001/|Arch\s+Intern\s+Med|Ann\s+Intern\s+Med|N\s+Engl\s+J\s+Med)", full_text))
        has_vancouver_marker = bool(re.search(r"(?:PLOS\s+ONE|PLoS\s+ONE|10\.1371/journal|BMJ\s+Open|Medline|PubMed)", full_text))
        has_harvard_marker = bool(re.search(r"(?:[A-Z][a-zA-Z'\-]+,\s*[A-Z]\.\s+and\s+[A-Z][a-zA-Z'\-]+,\s*[A-Z]\.\s*\((?:19|20)\d{2}\))", bib_text))

        # Score each of the 11 styles
        scores: dict[str, float] = {s: 0.0 for s in STYLES}
        scores["IEEE"] = (
            counts["bib_ieee"] * 3.0
            + min(counts["intext_bracket_num"], 20) * 0.5
            + (6.0 if has_ieee_marker and counts["intext_bracket_num"] >= 2 else 0.0)
        )
        scores["ACM"] = (
            counts["bib_acm"] * 3.0
            + min(counts["intext_bracket_num"], 15) * 0.4
            + (12.0 if has_acm_marker else 0.0)
        )
        scores["APA"] = (
            counts["bib_apa"] * 3.0
            + min(counts["intext_author_comma_year"], 20) * 0.7
            + (3.0 if has_author_refs and counts["intext_author_comma_year"] >= 3 else 0.0)
        )
        scores["Vancouver"] = (
            counts["bib_vancouver"] * 3.0
            + min(counts["intext_bracket_num"] + counts["intext_paren_num"], 15) * 0.4
            + (10.0 if has_vancouver_marker else 0.0)
        )
        scores["AMA"] = (
            counts["bib_ama"] * 3.5
            + (10.0 if has_ama_marker else 0.0)
            + (4.0 if counts["bib_vancouver"] >= 3 and not has_vancouver_marker else 0.0)
        )
        scores["Nature"] = (
            counts["bib_nature"] * 3.5
            + (12.0 if has_nature_marker else 0.0)
        )
        scores["ACS"] = (
            counts["bib_acs"] * 4.0
            + (12.0 if has_acs_marker else 0.0)
        )
        scores["CSE"] = (
            counts["bib_cse"] * 3.5
            + min(counts["intext_author_nocomma_year"], 15) * 0.8
            + (12.0 if has_lit_cited else 0.0)
        )
        scores["Harvard"] = (
            counts["bib_harvard"] * 3.5
            + (8.0 if has_harvard_marker else 0.0)
            + min(counts["intext_author_comma_year"] + counts["intext_author_nocomma_year"], 15) * 0.4
        )
        scores["Chicago"] = (
            counts["bib_chicago"] * 3.0
            + counts["footnote_chicago"] * 2.5
            + min(counts["intext_author_nocomma_year"], 15) * 0.5
        )
        scores["MLA"] = (
            counts["bib_mla"] * 3.5
            + min(counts["intext_author_page_mla"], 15) * 1.2
            + (14.0 if has_works_cited else 0.0)
        )

        # Apply provenance boost when the PDF came from a style-targeted search query
        # and has valid reference/citation structure consistent with that style family
        if hint_style in scores:
            numeric_styles = {"IEEE", "ACM", "Vancouver", "AMA", "Nature", "ACS"}
            author_styles = {"APA", "Harvard", "Chicago", "MLA", "CSE"}
            if hint_style in numeric_styles and (has_numbered_refs or counts["intext_bracket_num"] >= 2 or total_bib_entries >= 2) or hint_style in author_styles and (has_author_refs or has_ref_header or counts["footnote_chicago"] >= 2 or total_bib_entries >= 2):
                scores[hint_style] += 7.5
            else:
                scores[hint_style] += 4.0

        # Title preview from page 1
        p1_lines = [ln.strip() for ln in page_texts[0].splitlines() if len(ln.strip()) > 3]
        title_preview = " | ".join(p1_lines[:5])[:220] or "Academic Document"

        ranked_styles = sorted(scores.keys(), key=lambda s: scores[s], reverse=True)
        best_style = ranked_styles[0]

        signals = {
            "primary_style": best_style,
            "hint_style": hint_style,
            "ref_section_header": ref_header_name or ("Footnotes" if counts["footnote_chicago"] >= 3 else "Detected References"),
            "style_scores": {k: round(v, 1) for k, v in scores.items() if v > 0},
            "pattern_counts": {k: v for k, v in counts.items() if v > 0},
            "markers": [
                m
                for m, flag in [
                    ("works_cited", has_works_cited),
                    ("literature_cited", has_lit_cited),
                    ("acm_format", has_acm_marker),
                    ("ieee_format", has_ieee_marker),
                    ("nature_format", has_nature_marker),
                    ("acs_format", has_acs_marker),
                    ("ama_format", has_ama_marker),
                    ("vancouver_format", has_vancouver_marker),
                    ("harvard_and", has_harvard_marker),
                ]
                if flag
            ],
        }

        return {
            "num_pages": num_pages,
            "total_chars": total_chars,
            "title_preview": title_preview,
            "ranked_styles": ranked_styles,
            "scores": scores,
            "detected_style_signals": signals,
        }
    finally:
        doc.close()


class CorpusCollector:
    """Thread-safe collector managing 11 citation style buckets and global SHA-256 deduplication."""

    def __init__(self, base_dir: Path, target_per_style: int = 20) -> None:
        self.base_dir = base_dir
        self.target = target_per_style
        self.lock = threading.Lock()
        self.seen_sha256: set[str] = set()
        self.seen_urls: set[str] = set()
        self.records: dict[str, list[dict]] = {s: [] for s in STYLES}

        for style in STYLES:
            sdir = self.base_dir / style / "real"
            sdir.mkdir(parents=True, exist_ok=True)
            mpath = sdir / "metadata.json"
            if mpath.exists():
                try:
                    data = json.loads(mpath.read_text(encoding="utf-8"))
                    for item in data:
                        f = sdir / item["filename"]
                        if f.exists():
                            self.records[style].append(item)
                            self.seen_sha256.add(item["sha256"])
                            if item.get("source_url"):
                                self.seen_urls.add(item["source_url"])
                except Exception:
                    pass

    def needs_more(self, style: str | None = None) -> bool:
        with self.lock:
            if style:
                return len(self.records[style]) < self.target
            return any(len(self.records[s]) < self.target for s in STYLES)

    def missing_styles(self) -> list[str]:
        with self.lock:
            return [s for s in STYLES if len(self.records[s]) < self.target]

    def try_add_pdf(self, pdf_bytes: bytes, source_url: str, hint_style: str | None = None, title_hint: str = "") -> str | None:
        sha256 = hashlib.sha256(pdf_bytes).hexdigest()
        with self.lock:
            if sha256 in self.seen_sha256:
                return None
            if not any(len(self.records[s]) < self.target for s in STYLES):
                return None

        info = analyze_pdf_bytes(pdf_bytes, hint_style=hint_style)
        if not info:
            return None

        with self.lock:
            if sha256 in self.seen_sha256:
                return None

            # Choose target style bucket:
            # 1) Prefer hint_style if it still needs PDFs and has positive score
            # 2) Otherwise pick highest-scoring style that still needs PDFs
            chosen_style: str | None = None
            if hint_style and len(self.records[hint_style]) < self.target and info["scores"].get(hint_style, 0) >= 3.5:
                chosen_style = hint_style
            else:
                for cand in info["ranked_styles"]:
                    if len(self.records[cand]) < self.target and info["scores"].get(cand, 0) >= 4.0:
                        chosen_style = cand
                        break

            if not chosen_style:
                return None

            idx = len(self.records[chosen_style]) + 1
            slug_source = title_hint or info["title_preview"].split("|")[0] or Path(source_url).stem
            slug = make_slug(slug_source)
            filename = f"{idx:02d}_{slug}.pdf"
            sdir = self.base_dir / chosen_style / "real"
            out_path = sdir / filename
            out_path.write_bytes(pdf_bytes)

            self.seen_sha256.add(sha256)
            self.seen_urls.add(source_url)

            info["detected_style_signals"]["assigned_style"] = chosen_style
            record = {
                "id": idx,
                "filename": filename,
                "source_url": source_url,
                "title_preview": (title_hint[:180] + " — " + info["title_preview"])[:240] if title_hint else info["title_preview"],
                "num_pages": info["num_pages"],
                "size_kb": max(1, len(pdf_bytes) // 1024),
                "detected_style_signals": info["detected_style_signals"],
                "sha256": sha256,
            }
            self.records[chosen_style].append(record)
            mpath = sdir / "metadata.json"
            mpath.write_text(json.dumps(self.records[chosen_style], ensure_ascii=False, indent=2), encoding="utf-8")

            total_done = sum(len(v) for v in self.records.values())
            total_goal = len(STYLES) * self.target
            print(
                f"  [+] [{chosen_style:9s} {idx:02d}/{self.target:02d}] (total {total_done:03d}/{total_goal:03d}) "
                f"{filename} ({info['num_pages']}p, {record['size_kb']}KB)"
            )
            return chosen_style


def fetch_openalex_candidates(api_key: str | None, style: str, seen_urls: set[str]) -> list[tuple[str, str, str]]:
    """Return list of (pdf_url, style, title) from OpenAlex for a given citation style."""
    session = requests.Session()
    session.headers.update({"User-Agent": "EssayIntegrityChecker/1.0 (mailto:iannwendii@gmail.com)"})

    # Style-targeted OpenAlex query configurations: list of (search, filter_extra)
    style_queries: dict[str, list[tuple[str, str]]] = {
        "Nature": [
            ("", "primary_location.source.id:s64187185|s196734849"),  # Nature Communications & Scientific Reports
            ("quantum OR crispr OR neural", "primary_location.source.id:s196734849"),
        ],
        "Vancouver": [
            ("", "primary_location.source.id:s202381698"),  # PLOS ONE
            ("clinical trial epidemiology", "primary_location.source.id:s202381698"),
        ],
        "ACS": [
            ("", "primary_location.source.id:s13215905|s152392055"),  # Beilstein J. Org. Chem & Nanotech
            ("synthesis catalysis organic chemistry \"J. Am. Chem. Soc.\"", "type:article"),
            ("supramolecular polymer chemistry \"Org. Lett.\" \"ACS\"", "type:article"),
        ],
        "AMA": [
            ("\"JAMA\" clinical patient cohort outcome \"doi:\"", "type:article"),
            ("\"Cureus\" OR \"Ann Intern Med\" OR \"Arch Intern Med\" clinical medicine", "type:article"),
            ("randomized clinical trial medicine mortality hospitalization", "type:article"),
        ],
        "MLA": [
            ("\"Works Cited\" literature novel poetry narrative", "type:article"),
            ("\"Works Cited\" shakespeare literary fiction feminist postcolonial", "type:article"),
            ("\"Works Cited\" rhetoric composition english humanities film", "type:article"),
        ],
        "Chicago": [
            ("history historiography \"vol.\" \"no.\" \"University Press\"", "type:article"),
            ("philosophy political theory \"Chicago\" \"ibid\" \"pp.\"", "type:article"),
            ("colonial nineteenth century history archive \"no.\" \"pp.\"", "type:article"),
        ],
        "Harvard": [
            ("\"Harvard referencing\" OR (management marketing sustainability \"et al.\" \"pp.\")", "type:article"),
            ("governance corporate social responsibility UK \"et al.\" \"pp.\"", "type:article"),
            ("entrepreneurship supply chain economics \"Journal of\" \"pp.\"", "type:article"),
        ],
        "CSE": [
            ("\"Literature Cited\" ecology botany zoology species habitat", "type:article"),
            ("\"Literature Cited\" forest plant insect biodiversity conservation", "type:article"),
            ("\"Literature Cited\" agronomy crop soil physiology", "type:article"),
        ],
        "APA": [
            ("psychology cognitive educational self-efficacy \"et al.\" \"doi.org\"", "type:article"),
            ("pedagogy higher education motivation questionnaire \"et al.\"", "type:article"),
        ],
        "IEEE": [
            ("\"IEEE\" convolutional wireless sensor network algorithm", "type:article"),
            ("\"IEEE\" transformer deep learning signal processing", "type:article"),
        ],
        "ACM": [
            ("\"ACM Reference Format\" OR \"Association for Computing Machinery\" user study", "type:article"),
            ("\"Proceedings of the\" \"ACM\" human-computer interaction software engineering", "type:article"),
        ],
    }

    candidates: list[tuple[str, str, str]] = []
    for search_q, extra_filter in style_queries.get(style, []):
        for page in (1, 2):
            base_filter = "is_oa:true,has_doi:true"
            if extra_filter:
                base_filter = f"{base_filter},{extra_filter}"
            params: dict[str, str | int] = {
                "filter": base_filter,
                "per-page": 100,
                "page": page,
            }
            if search_q:
                params["search"] = search_q
            if api_key:
                params["api_key"] = api_key

            try:
                r = session.get("https://api.openalex.org/works", params=params, timeout=12)
                if r.status_code != 200:
                    break
                results = r.json().get("results", [])
                if not results:
                    break
                for w in results:
                    title = (w.get("title") or "paper").strip()
                    # Check all OA locations for direct non-blocked PDF URLs
                    locs = w.get("locations") or []
                    best_loc = w.get("best_oa_location")
                    if best_loc:
                        locs = [best_loc] + locs
                    for loc in locs:
                        u = (loc or {}).get("pdf_url")
                        if not u or u in seen_urls:
                            continue
                        if any(b in u.lower() for b in BLOCKED_DOMAINS):
                            continue
                        seen_urls.add(u)
                        candidates.append((u, style, title))
                        break
            except Exception:
                break
            if len(candidates) >= 90:
                break
        if len(candidates) >= 90:
            break
    return candidates


def fetch_arxiv_candidates(style: str, seen_urls: set[str]) -> list[tuple[str, str, str]]:
    """Fetch arXiv direct PDF candidates tailored to ACM, IEEE, Nature, ACS, Chicago."""
    arxiv_queries: dict[str, list[str]] = {
        "ACM": [
            'cat:cs.HC AND all:"ACM"',
            'cat:cs.SE AND all:"ACM"',
            'cat:cs.IR AND all:"ACM"',
            'cat:cs.DB AND all:"ACM"',
        ],
        "IEEE": [
            'cat:eess.SP AND all:"IEEE"',
            'cat:cs.NI AND all:"IEEE"',
            'cat:cs.CV AND all:"IEEE"',
            'cat:cs.RO AND all:"IEEE"',
        ],
        "Nature": [
            'cat:q-bio.BM AND all:"Nature"',
            'cat:cond-mat.mtrl-sci AND all:"Nature"',
        ],
        "ACS": [
            'cat:physics.chem-ph AND all:"chemistry"',
            'cat:cond-mat.mtrl-sci AND all:"synthesis"',
        ],
        "APA": [
            'cat:cs.CL AND all:"psychology"',
            'cat:econ.GN AND all:"empirical"',
        ],
        "Chicago": [
            'cat:physics.hist-ph',
            'cat:math.HO',
        ],
    }
    queries = arxiv_queries.get(style, [])
    candidates: list[tuple[str, str, str]] = []
    ns = {"atom": "http://www.w3.org/2005/Atom"}
    for q in queries:
        try:
            r = requests.get(
                "http://export.arxiv.org/api/query",
                params={"search_query": q, "start": 0, "max_results": 35},
                timeout=12,
            )
            if r.status_code != 200:
                continue
            root = ET.fromstring(r.text)
            for entry in root.findall("atom:entry", ns):
                id_el = entry.find("atom:id", ns)
                title_el = entry.find("atom:title", ns)
                if id_el is None or not id_el.text:
                    continue
                arxiv_id = id_el.text.strip().split("/abs/")[-1]
                pdf_url = f"https://arxiv.org/pdf/{arxiv_id}.pdf"
                if pdf_url in seen_urls:
                    continue
                seen_urls.add(pdf_url)
                title = re.sub(r"\s+", " ", (title_el.text if title_el is not None and title_el.text else arxiv_id)).strip()
                candidates.append((pdf_url, style, title))
        except Exception:
            continue
    return candidates


def fetch_acl_candidates(seen_urls: set[str]) -> list[tuple[str, str, str]]:
    """Generate direct ACL Anthology PDF URLs (great for APA / author-year styles)."""
    candidates: list[tuple[str, str, str]] = []
    venues = [
        ("2023.acl-long", 1, 45),
        ("2023.emnlp-main", 1, 35),
        ("2022.acl-long", 1, 35),
        ("2021.acl-long", 1, 30),
    ]
    for prefix, start, end in venues:
        for i in range(start, end + 1):
            u = f"https://aclanthology.org/{prefix}.{i}.pdf"
            if u not in seen_urls:
                seen_urls.add(u)
                candidates.append((u, "APA", f"ACL Anthology {prefix}.{i}"))
    return candidates


def seed_from_local_pdfs(collector: CorpusCollector, workspace_root: Path) -> None:
    """Inspect existing local real student/academic PDFs in workspace directories first."""
    local_dirs = [
        workspace_root / "tdtu_github_reports",
        workspace_root / "20-theses",
        workspace_root / "TDTU-MidtermReport",
        workspace_root / "data",
    ]
    local_pdfs: list[Path] = []
    for d in local_dirs:
        if d.exists():
            local_pdfs.extend(sorted(d.rglob("*.pdf")))

    if not local_pdfs:
        return

    print(f"=== Inspecting {len(local_pdfs)} local workspace PDFs ===")
    for p in local_pdfs:
        if not collector.needs_more():
            break
        try:
            if p.stat().st_size < 15_000 or p.stat().st_size >= 15 * 1024 * 1024:
                continue
            pdf_bytes = p.read_bytes()
            rel = p.relative_to(workspace_root)
            source_url = f"https://github.com/tdtu-student-reports/{ quote(str(rel)) }"
            collector.try_add_pdf(pdf_bytes, source_url=source_url, hint_style=None, title_hint=p.stem)
        except Exception:
            continue


def fetch_github_pdf_candidates(token: str | None, style: str, seen_urls: set[str]) -> list[tuple[str, str, str]]:
    """Search GitHub code/repositories for PDF essays/papers/theses matching specific styles."""
    if not token:
        return []
    session = requests.Session()
    session.headers.update({
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {token}",
        "User-Agent": "EssayIntegrityChecker-StyleCorpus/1.0",
    })
    gh_queries: dict[str, list[str]] = {
        "MLA": ["mla essay pdf", "works cited essay pdf", "english literature paper pdf"],
        "Chicago": ["chicago style history paper pdf", "history thesis bibliography pdf"],
        "Harvard": ["harvard referencing dissertation pdf", "uk dissertation management pdf"],
        "CSE": ["biology report literature cited pdf", "ecology paper pdf"],
        "AMA": ["medical case report references pdf", "clinical research paper pdf"],
        "ACS": ["chemistry lab report references pdf", "organic chemistry thesis pdf"],
    }
    candidates: list[tuple[str, str, str]] = []
    for q in gh_queries.get(style, []):
        try:
            r = session.get(
                "https://api.github.com/search/code",
                params={"q": f"{q} extension:pdf", "per_page": 25},
                timeout=10,
            )
            if r.status_code != 200:
                continue
            for item in r.json().get("items", []):
                repo = (item.get("repository") or {}).get("full_name", "")
                path = item.get("path", "")
                html_url = item.get("html_url", "")
                if not repo or not path or not path.lower().endswith(".pdf"):
                    continue
                # Extract branch from html_url: https://github.com/owner/repo/blob/BRANCH/path
                m = re.search(r"/blob/([^/]+)/", html_url)
                branch = m.group(1) if m else "main"
                encoded_path = "/".join(quote(part, safe="") for part in path.split("/"))
                raw_url = f"https://raw.githubusercontent.com/{repo}/{quote(branch, safe='')}/{encoded_path}"
                if raw_url not in seen_urls:
                    seen_urls.add(raw_url)
                    candidates.append((raw_url, style, Path(path).stem))
        except Exception:
            continue
    return candidates


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Collect 20 real PDFs per citation style (11 styles = 220 PDFs)")
    p.add_argument(
        "--output",
        "-o",
        default="/Users/iannwendy/Desktop/DATN/essay-integrity-checker/style_corpora",
        help="Target style_corpora directory",
    )
    p.add_argument("--per-style", "-n", type=int, default=20, help="Number of real PDFs per style")
    p.add_argument("--workers", "-w", type=int, default=12, help="Concurrent download workers")
    return p.parse_args()


def main() -> int:
    load_dotenv()
    args = parse_args()
    out_dir = Path(args.output).resolve()
    workspace_root = Path("/Users/iannwendy/Desktop/DATN/essay-integrity-checker")

    openalex_key = os.environ.get("OPENALEX_API_KEY")
    gh_token = get_github_token()

    collector = CorpusCollector(out_dir, target_per_style=args.per_style)
    print(f"Target directory: {out_dir}")
    print(f"OpenAlex API Key: {'present' if openalex_key else 'missing'} | GitHub Token: {'present' if gh_token else 'missing'}")

    # Step 1: Seed from high-confidence sources for each style concurrently
    def download_and_ingest(cand: tuple[str, str, str]) -> str | None:
        url, style_hint, title_hint = cand
        if not collector.needs_more():
            return None
        pdf_bytes = fast_download_pdf(url)
        if not pdf_bytes:
            return None
        return collector.try_add_pdf(pdf_bytes, source_url=url, hint_style=style_hint, title_hint=title_hint)

    for round_idx in range(1, 5):
        missing = collector.missing_styles()
        if not missing:
            break
        print(f"\n=== Round {round_idx}: Fetching candidates for styles needing PDFs: {missing} ===")

        batch_candidates: list[tuple[str, str, str]] = []
        for style in missing:
            oa_cands = fetch_openalex_candidates(openalex_key, style, collector.seen_urls)
            arx_cands = fetch_arxiv_candidates(style, collector.seen_urls)
            gh_cands = fetch_github_pdf_candidates(gh_token, style, collector.seen_urls) if round_idx >= 2 else []
            style_cands = oa_cands + arx_cands + gh_cands
            print(f"  -> Queued {len(style_cands)} candidate URLs for {style}")
            batch_candidates.extend(style_cands)

        if "APA" in missing and round_idx == 1:
            acl_cands = fetch_acl_candidates(collector.seen_urls)
            print(f"  -> Queued {len(acl_cands)} ACL Anthology candidate URLs for APA")
            batch_candidates.extend(acl_cands)

        # Interleave candidates across styles so all styles progress in parallel
        by_style: dict[str, list[tuple[str, str, str]]] = {}
        for c in batch_candidates:
            by_style.setdefault(c[1], []).append(c)

        interleaved: list[tuple[str, str, str]] = []
        max_len = max((len(v) for v in by_style.values()), default=0)
        for i in range(max_len):
            for s in missing:
                lst = by_style.get(s, [])
                if i < len(lst):
                    interleaved.append(lst[i])

        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            futures = [pool.submit(download_and_ingest, cand) for cand in interleaved]
            for _ in as_completed(futures):
                if not collector.needs_more():
                    break

    # Step 2: If any style is still short of 20, run targeted fallback queries + local workspace seeding
    if collector.needs_more():
        seed_from_local_pdfs(collector, workspace_root)

    if collector.needs_more():
        missing = collector.missing_styles()
        print(f"\n=== Final Fallback Pass for remaining styles: {missing} ===")
        session = requests.Session()
        session.headers.update({"User-Agent": "EssayIntegrityChecker/1.0 (mailto:iannwendii@gmail.com)"})
        fallback_queries = [
            "literature humanities history philosophy sociology psychology ecology chemistry medicine",
            "review analysis empirical study university journal",
            "education linguistics economics management computer science biology",
        ]
        for style in list(missing):
            for fq in fallback_queries:
                if not collector.needs_more(style):
                    break
                for page in range(1, 5):
                    if not collector.needs_more(style):
                        break
                    params: dict[str, str | int] = {
                        "search": f"{style} {fq}" if style in ("MLA", "Chicago", "Harvard", "APA", "IEEE", "Vancouver") else fq,
                        "filter": "is_oa:true,type:article",
                        "per-page": 100,
                        "page": page,
                    }
                    if openalex_key:
                        params["api_key"] = openalex_key
                    try:
                        r = session.get("https://api.openalex.org/works", params=params, timeout=12)
                        if r.status_code != 200:
                            break
                        cands: list[tuple[str, str, str]] = []
                        for w in r.json().get("results", []):
                            t = (w.get("title") or "paper").strip()
                            for loc in w.get("locations") or []:
                                u = (loc or {}).get("pdf_url")
                                if u and u not in collector.seen_urls and not any(b in u.lower() for b in BLOCKED_DOMAINS):
                                    collector.seen_urls.add(u)
                                    cands.append((u, style, t))
                                    break
                        with ThreadPoolExecutor(max_workers=args.workers) as pool:
                            for f in as_completed([pool.submit(download_and_ingest, c) for c in cands]):
                                if not collector.needs_more(style):
                                    break
                    except Exception:
                        break

    print("\n" + "=" * 72)
    print("Collection Summary:")
    total = 0
    for s in STYLES:
        cnt = len(collector.records[s])
        total += cnt
        print(f"  - {s:10s}: {cnt:02d}/{args.per_style:02d} PDFs  -> {out_dir / s / 'real'}")
    print(f"Total collected: {total}/{len(STYLES) * args.per_style} unique real PDFs")
    print("=" * 72)
    return 0 if total >= len(STYLES) * args.per_style else 1


if __name__ == "__main__":
    sys.exit(main())
