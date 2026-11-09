#!/usr/bin/env python3
"""
Collect 200 real English university theses (Senior Honors Theses, Bachelor's Theses,
Master's Theses) from open-access repositories that do NOT use Cloudflare/CAPTCHA:
  1. Helda — University of Helsinki Open Repository (DSpace 7 REST API)
  2. Osuva — University of Vaasa Open Repository (DSpace 7 REST API)
  3. Zenodo — Open-Access Thesis Collection (REST API `resource_type.id:publication-thesis`)
  4. OpenAlex — Open-Access Dissertations/Theses (`type:dissertation,is_oa:true,language:en`)
  5. GitHub — Public University Bachelor's/Honors/Master's Theses in PDF format

Saves:
  - `20-theses/21.pdf` ... `20-theses/220.pdf` (continuing directly from `1.pdf`..`20.pdf`)
  - `20-theses/metadata_200_theses.json`
  - Hard-linked descriptive copies in `200-theses/001_<slug>.pdf` ... `200_<slug>.pdf`
    and `200-theses/metadata.json` (zero extra disk usage).
"""

from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import json
import os
import re
import sys
import threading
import time
from pathlib import Path

import fitz  # PyMuPDF
import requests
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# Domains known to use Cloudflare challenges, paywalls, or anti-bot gates
BLOCKED_DOMAINS: tuple[str, ...] = (
    "digitalcommons.",
    "viewcontent.cgi",
    "bepress.com",
    "liberty.edu",
    "proquest.com",
    "ebscohost.com",
    "academia.edu",
    "researchgate.net",
    "ssrn.com",
    "jstor.org",
    "wiley.com",
    "sciencedirect.com",
    "elsevier.com",
    "springer.com",
    "tandfonline.com",
    "sagepub.com",
    "mdpi.com",
    "frontiersin.org",
    "oup.com",
    "cambridge.org",
    "ieee.org",
    "acm.org",
    "utwente.nl",
    "diva-portal.org",
    "jyx.jyu.fi",
    "trepo.tuni.fi",
)

REF_HEADER_RE = re.compile(
    r"(?:^|\n)\s*(?:[0-9IVX]+(?:\.\d+)*\.?\s*)?"
    r"(References|Bibliography|Works\s+Cited|Literature\s+Cited|Reference\s+List|"
    r"List\s+of\s+References|Sources\s+and\s+Literature|Sources)\s*(?:\n|$)",
    re.IGNORECASE,
)

THESIS_FRONT_RE = re.compile(
    r"("
    r"\bthesis\b|\bdissertation\b|bachelor|master|honors|honours|undergraduate|"
    r"partial\s+fulfillment|degree\s+of|faculty\s+of|department\s+of|school\s+of|"
    r"university|supervisor|advisor|examiner|graduation"
    r")",
    re.IGNORECASE,
)

INTEXT_APA_RE = re.compile(
    r"\(([A-ZÀ-Ý][A-Za-zÀ-ÿ'\-]+(?:\s+(?:et\s+al\.|(?:&|and)\s+[A-ZÀ-Ý][A-Za-zÀ-ÿ'\-]+))?),?\s*((?:19|20)\d{2}[a-z]?)"
)
INTEXT_NUM_RE = re.compile(r"\[([1-9]\d{0,2}(?:\s*[,–\-]\s*[1-9]\d{0,2})*)\]")
YEAR_RE = re.compile(r"\b(?:19\d{2}|20[0-2]\d)\b")
ENGLISH_STOPWORDS_RE = re.compile(
    r"\b(the|and|of|to|in|that|is|for|with|as|on|this|by|from|are|be|or|an|which|study|research|data|analysis|results)\b",
    re.IGNORECASE,
)


def make_slug(text: str, max_len: int = 55) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "_", (text or "").lower()).strip("_")
    slug = re.sub(r"_+", "_", slug)
    return (slug[:max_len].rstrip("_")) or "university_thesis"


def is_blocked_url(url: str) -> bool:
    if not url or not url.startswith(("http://", "https://")):
        return True
    u_low = url.lower()
    return any(b in u_low for b in BLOCKED_DOMAINS)


def download_pdf_bytes(url: str, timeout: tuple[float, float] = (5.0, 12.0)) -> bytes | None:
    if is_blocked_url(url):
        return None
    headers = {
        "Accept": "application/pdf,application/octet-stream;q=0.9,*/*;q=0.8",
    }
    try:
        with requests.get(
            url, headers=headers, timeout=timeout, stream=True, allow_redirects=True, verify=False
        ) as r:
            if r.status_code != 200:
                return None
            # Reject if redirected to a blocked domain
            if r.url and is_blocked_url(r.url):
                return None
            cl = int(r.headers.get("Content-Length", 0) or 0)
            if cl > 12_500_000 or (0 < cl < 70_000):
                return None
            chunks: list[bytes] = []
            total = 0
            for chunk in r.iter_content(chunk_size=32768):
                if not chunk:
                    break
                if not chunks:
                    stripped = chunk.lstrip()
                    if not stripped.startswith(b"%PDF"):
                        return None
                chunks.append(chunk)
                total += len(chunk)
                if total > 12_500_000:
                    return None
            data = b"".join(chunks).lstrip()
            if len(data) < 70_000 or not data.startswith(b"%PDF"):
                return None
            return data
    except Exception:
        return None


def validate_thesis_pdf(pdf_bytes: bytes) -> dict | None:
    """
    Validate that the PDF is a real English university thesis similar to `20-theses/`:
    - 18 to 85 pages (typical Senior Honors / Bachelor's / Master's thesis length)
    - Portrait orientation (not presentation slides)
    - English language academic prose
    - Contains thesis/university front-matter indicators
    - Contains explicit References/Bibliography section + in-text citations
    """
    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    except Exception:
        return None

    try:
        if doc.is_encrypted:
            return None
        num_pages = len(doc)
        if num_pages < 18 or num_pages > 85:
            return None

        # Reject presentation slide decks (landscape pages)
        sample_p = min(6, num_pages)
        landscape = sum(1 for i in range(sample_p) if doc[i].rect.width > doc[i].rect.height * 1.15)
        if landscape >= 2:
            return None

        page_texts: list[str] = []
        for i in range(num_pages):
            page_texts.append(doc[i].get_text("text") or "")

        full_text = "\n".join(page_texts)
        if len(full_text.strip()) < 15_000:
            return None

        # Check English language density on both front pages and body pages (pages 5..18)
        sample_text = "\n".join(page_texts[:10])
        words = re.findall(r"[A-Za-z]{2,}", sample_text)
        if len(words) < 500:
            return None
        eng_hits = len(ENGLISH_STOPWORDS_RE.findall(sample_text))
        if eng_hits / max(1, len(words)) < 0.11:
            return None

        body_sample_text = "\n".join(page_texts[4 : min(18, num_pages)])
        body_words = re.findall(r"[A-Za-z]{2,}", body_sample_text)
        if len(body_words) < 500:
            return None
        body_eng_hits = len(ENGLISH_STOPWORDS_RE.findall(body_sample_text))
        if body_eng_hits / max(1, len(body_words)) < 0.12:
            return None

        # Check front matter (first 5 pages) for university / thesis keywords
        front_text = "\n".join(page_texts[:5])
        if len(THESIS_FRONT_RE.findall(front_text)) < 2:
            return None

        # Check for References / Bibliography section in the last 45% of pages
        tail_start_page = max(5, int(num_pages * 0.50))
        tail_text = "\n".join(page_texts[tail_start_page:])
        ref_matches = list(REF_HEADER_RE.finditer(tail_text))
        if not ref_matches:
            # Fallback check across full text after page 10
            ref_matches = list(REF_HEADER_RE.finditer("\n".join(page_texts[10:])))
            if not ref_matches:
                return None

        ref_section_text = tail_text[ref_matches[-1].start() :]
        ref_years = len(YEAR_RE.findall(ref_section_text))
        if ref_years < 8:
            return None

        # Count in-text citations in body
        body_text = "\n".join(page_texts[2:tail_start_page])
        apa_cits = len(INTEXT_APA_RE.findall(body_text))
        num_cits = len(INTEXT_NUM_RE.findall(body_text))
        if apa_cits + num_cits < 6:
            return None

        dominant_style = "APA/Author-Year" if apa_cits >= num_cits else "Numeric/IEEE"

        # Extract a clean title preview from first 2 pages
        first_lines = [
            ln.strip()
            for ln in "\n".join(page_texts[:2]).splitlines()
            if 10 <= len(ln.strip()) <= 140
        ]
        title_preview = " | ".join(first_lines[:3])[:200] if first_lines else "University Thesis"

        return {
            "num_pages": num_pages,
            "char_count": len(full_text),
            "apa_in_text_count": apa_cits,
            "numeric_in_text_count": num_cits,
            "ref_year_mentions": ref_years,
            "citation_style": dominant_style,
            "title_preview": title_preview,
        }
    finally:
        doc.close()


def fetch_dspace7_candidates(
    repo_name: str,
    api_base: str,
    queries: list[str],
    max_pages: int = 4,
    page_size: int = 40,
) -> list[dict]:
    """Discover bitstream PDF URLs from a DSpace 7 REST API repository."""
    session = requests.Session()
    session.headers.update({"User-Agent": "EssayIntegrityChecker/1.0"})
    seen_uuids: set[str] = set()
    items_to_resolve: list[tuple[str, str, str, str]] = []

    for q in queries:
        for page in range(max_pages):
            try:
                r = session.get(
                    f"{api_base}/discover/search/objects",
                    params={
                        "query": q,
                        "dsoType": "ITEM",
                        "size": page_size,
                        "page": page,
                    },
                    timeout=10,
                )
                if r.status_code != 200:
                    break
                objs = (
                    r.json()
                    .get("_embedded", {})
                    .get("searchResult", {})
                    .get("_embedded", {})
                    .get("objects", [])
                )
                if not objs:
                    break
                for o in objs:
                    item = o.get("_embedded", {}).get("indexableObject", {})
                    uuid = item.get("uuid")
                    if not uuid or uuid in seen_uuids:
                        continue
                    metadata = item.get("metadata", {})
                    lang_vals = [
                        m.get("value", "")
                        for m in metadata.get("dc.language.iso", []) + metadata.get("dc.language", [])
                    ]
                    if lang_vals and not any(l.lower().startswith("en") for l in lang_vals):
                        continue
                    title = (item.get("name") or "Thesis").strip()
                    authors = [
                        m.get("value", "")
                        for m in metadata.get("dc.contributor.author", [])
                        + metadata.get("dc.creator", [])
                    ]
                    author_str = "; ".join(a for a in authors if a)[:120] or "Student Author"
                    handle = item.get("handle") or uuid
                    seen_uuids.add(uuid)
                    items_to_resolve.append((uuid, title, author_str, str(handle)))
            except Exception:
                break

    print(f"[{repo_name}] Found {len(items_to_resolve)} English thesis items; resolving bitstreams...", flush=True)

    candidates: list[dict] = []

    def resolve_one(entry: tuple[str, str, str, str]) -> dict | None:
        uuid, title, author_str, handle = entry
        try:
            rb = requests.get(f"{api_base}/core/items/{uuid}/bundles", timeout=8)
            if rb.status_code != 200:
                return None
            bundles = rb.json().get("_embedded", {}).get("bundles", [])
            for b in bundles:
                if b.get("name") == "ORIGINAL":
                    href = b.get("_links", {}).get("bitstreams", {}).get("href")
                    if not href:
                        continue
                    rbs = requests.get(href, timeout=8)
                    if rbs.status_code != 200:
                        continue
                    for bs in rbs.json().get("_embedded", {}).get("bitstreams", []):
                        bs_name = (bs.get("name") or "").lower()
                        size_b = int(bs.get("sizeBytes") or 0)
                        content_url = bs.get("_links", {}).get("content", {}).get("href")
                        if (
                            content_url
                            and (bs_name.endswith(".pdf") or not bs_name)
                            and 75_000 <= size_b <= 12_000_000
                        ):
                            return {
                                "source_repo": repo_name,
                                "title": title,
                                "author": author_str,
                                "landing_url": f"{api_base.split('/server/api')[0]}/handle/{handle}",
                                "pdf_url": content_url,
                            }
        except Exception:
            return None
        return None

    with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
        for res in pool.map(resolve_one, items_to_resolve):
            if res:
                candidates.append(res)

    print(f"[{repo_name}] Resolved {len(candidates)} direct PDF bitstream URLs.", flush=True)
    return candidates


def fetch_zenodo_thesis_candidates(max_pages: int = 6) -> list[dict]:
    """Fetch open-access English theses from Zenodo REST API."""
    candidates: list[dict] = []
    seen_urls: set[str] = set()
    queries = [
        'metadata.resource_type.id:publication-thesis AND ("Bachelor thesis" OR "Master thesis" OR "Honors thesis" OR "Senior thesis")',
        'metadata.resource_type.id:publication-thesis AND ("submitted in partial fulfillment" OR "degree of Bachelor" OR "degree of Master")',
        'metadata.resource_type.id:publication-thesis AND (university AND references AND abstract)',
    ]
    for q in queries:
        for page in range(1, max_pages + 1):
            try:
                r = requests.get(
                    "https://zenodo.org/api/records",
                    params={"q": q, "size": 25, "page": page, "sort": "mostrecent"},
                    timeout=12,
                )
                if r.status_code != 200:
                    break
                hits = r.json().get("hits", {}).get("hits", [])
                if not hits:
                    break
                for h in hits:
                    meta = h.get("metadata", {})
                    lang = (meta.get("language") or "eng").lower()
                    if lang not in ("eng", "en", "english", ""):
                        continue
                    title = (meta.get("title") or "Zenodo Thesis").strip()
                    creators = meta.get("creators") or []
                    author = "; ".join(c.get("name", "") for c in creators if c.get("name"))[:120] or "Author"
                    landing = h.get("links", {}).get("self_html") or f"https://zenodo.org/records/{h.get('id')}"
                    for f in h.get("files", []):
                        key = (f.get("key") or "").lower()
                        size_b = int(f.get("size") or 0)
                        pdf_url = f.get("links", {}).get("self")
                        if (
                            key.endswith(".pdf")
                            and pdf_url
                            and pdf_url not in seen_urls
                            and 75_000 <= size_b <= 12_000_000
                        ):
                            seen_urls.add(pdf_url)
                            candidates.append(
                                {
                                    "source_repo": "Zenodo_Open_Theses",
                                    "title": title,
                                    "author": author,
                                    "landing_url": landing,
                                    "pdf_url": pdf_url,
                                }
                            )
                            break
            except Exception:
                break
    print(f"[Zenodo_Open_Theses] Found {len(candidates)} candidate thesis PDFs.", flush=True)
    return candidates


def fetch_openalex_thesis_candidates() -> list[dict]:
    """Fetch open-access English theses/dissertations from OpenAlex (excluding Cloudflare domains)."""
    candidates: list[dict] = []
    seen_urls: set[str] = set()
    search_queries = [
        "Senior Honors Thesis",
        "Honors Thesis",
        "Bachelor Thesis",
        "Master Thesis",
        "Undergraduate Thesis",
        "Capstone Thesis",
        " thesis psychology education media communication",
        " thesis computer science machine learning cybersecurity",
        " thesis economics finance marketing business strategy",
        " thesis biology medicine health nutrition clinical",
        " thesis political science law history philosophy",
    ]
    for q in search_queries:
        for page in (1, 2, 3):
            try:
                r = requests.get(
                    "https://api.openalex.org/works",
                    params={
                        "search": q,
                        "filter": "type:dissertation,is_oa:true,language:en,from_publication_date:2018-01-01",
                        "per-page": 100,
                        "page": page,
                    },
                    timeout=12,
                )
                if r.status_code != 200:
                    break
                results = r.json().get("results", [])
                if not results:
                    break
                for w in results:
                    title = (w.get("title") or "University Thesis").strip()
                    authorships = w.get("authorships") or []
                    authors = [
                        (a.get("author") or {}).get("display_name", "")
                        for a in authorships
                        if (a.get("author") or {}).get("display_name")
                    ]
                    author_str = "; ".join(authors)[:120] or "Author"
                    landing = w.get("id") or ""
                    locs = w.get("locations") or []
                    best_loc = w.get("best_oa_location")
                    if best_loc:
                        locs = [best_loc] + locs
                    for loc in locs:
                        pdf_url = (loc or {}).get("pdf_url")
                        if not pdf_url or pdf_url in seen_urls or is_blocked_url(pdf_url):
                            continue
                        seen_urls.add(pdf_url)
                        src_name = ((loc or {}).get("source") or {}).get("display_name") or "OpenAlex_OA_Repository"
                        candidates.append(
                            {
                                "source_repo": f"OpenAlex ({src_name[:40]})",
                                "title": title,
                                "author": author_str,
                                "landing_url": (loc or {}).get("landing_page_url") or landing,
                                "pdf_url": pdf_url,
                            }
                        )
                        break
            except Exception:
                break
    print(f"[OpenAlex] Found {len(candidates)} non-Cloudflare OA thesis candidates.", flush=True)
    return candidates


def main() -> int:
    parser = argparse.ArgumentParser(description="Collect 200 open-access English theses.")
    parser.add_argument("--target", type=int, default=200, help="Number of new theses to download")
    parser.add_argument("--workers", type=int, default=16, help="Concurrent download workers")
    args = parser.parse_args()

    workspace = Path(__file__).resolve().parents[2]
    dir_20 = workspace / "20-theses"
    dir_200 = workspace / "200-theses"
    dir_20.mkdir(parents=True, exist_ok=True)
    dir_200.mkdir(parents=True, exist_ok=True)

    # Seed seen SHA-256 hashes from existing 1.pdf..20.pdf and any already-downloaded files
    seen_sha256: set[str] = set()
    seen_urls: set[str] = set()
    for p in sorted(dir_20.glob("*.pdf")):
        try:
            num = int(p.stem)
            if 1 <= num <= 20:
                seen_sha256.add(hashlib.sha256(p.read_bytes()).hexdigest())
        except ValueError:
            pass

    meta_path_200 = dir_200 / "metadata.json"
    meta_path_20 = dir_20 / "metadata_200_theses.json"
    collected: list[dict] = []
    if meta_path_200.exists():
        try:
            existing = json.loads(meta_path_200.read_text(encoding="utf-8"))
            valid_existing: list[tuple[dict, bytes]] = []
            for rec in existing:
                f_20 = dir_20 / rec["filename_in_20_theses"]
                f_200 = dir_200 / rec["filename_in_200_theses"]
                seen_urls.add(rec["pdf_url"])
                if f_20.exists():
                    b = f_20.read_bytes()
                    if validate_thesis_pdf(b) is not None:
                        valid_existing.append((rec, b))
                    else:
                        f_20.unlink(missing_ok=True)
                        f_200.unlink(missing_ok=True)
                else:
                    f_200.unlink(missing_ok=True)

            # Clean and renumber valid existing files 1..K (21.pdf .. 20+K.pdf)
            for p in dir_200.glob("*.pdf"):
                p.unlink(missing_ok=True)
            for p in dir_20.glob("*.pdf"):
                try:
                    if int(p.stem) > 20:
                        p.unlink(missing_ok=True)
                except ValueError:
                    pass

            for idx_200, (rec, b) in enumerate(valid_existing, 1):
                idx_20 = 20 + idx_200
                fname_20 = f"{idx_20}.pdf"
                slug = make_slug(rec.get("title") or "thesis")
                fname_200 = f"{idx_200:03d}_{slug}.pdf"
                p20 = dir_20 / fname_20
                p200 = dir_200 / fname_200
                p20.write_bytes(b)
                try:
                    os.link(p20, p200)
                except OSError:
                    p200.write_bytes(b)
                rec["index"] = idx_200
                rec["thesis_number"] = idx_20
                rec["filename_in_20_theses"] = fname_20
                rec["filename_in_200_theses"] = fname_200
                collected.append(rec)
                seen_sha256.add(rec["sha256"])

            meta_json = json.dumps(collected, ensure_ascii=False, indent=2)
            meta_path_200.write_text(meta_json, encoding="utf-8")
            meta_path_20.write_text(meta_json, encoding="utf-8")
        except Exception:
            collected = []

    print(
        f"Starting collection: {len(collected)}/{args.target} already collected "
        f"({len(seen_sha256)} existing SHA-256 hashes seeded).",
        flush=True,
    )
    if len(collected) >= args.target:
        print("Target already reached!", flush=True)
        return 0

    # Gather candidate URLs across open repositories
    all_candidates: list[dict] = []

    # 1. Osuva (University of Vaasa — Business, Finance, Management, CS, Communication)
    all_candidates.extend(
        fetch_dspace7_candidates(
            "Osuva_Univ_of_Vaasa",
            "https://osuva.uwasa.fi/server/api",
            queries=[
                "Bachelor thesis OR Master thesis",
                "thesis marketing management finance",
                "thesis artificial intelligence digitalization sustainability",
                "thesis leadership strategy accounting",
                "thesis energy engineering automation",
            ],
            max_pages=4,
            page_size=45,
        )
    )

    # 2. Helda (University of Helsinki — Multidisciplinary Humanities, Science, Law, Social Sciences, CS)
    all_candidates.extend(
        fetch_dspace7_candidates(
            "Helda_Univ_of_Helsinki",
            "https://helda.helsinki.fi/server/api",
            queries=[
                "Master's thesis",
                "Bachelor's thesis",
                "thesis psychology cognitive education",
                "thesis media communication journalism politics",
                "thesis machine learning data science computer science",
                "thesis economics law philosophy history",
                "thesis biology ecology environment nutrition",
            ],
            max_pages=4,
            page_size=45,
        )
    )

    # 3. Zenodo Open Theses
    all_candidates.extend(fetch_zenodo_thesis_candidates(max_pages=6))

    # 4. OpenAlex Open-Access Dissertations/Theses
    all_candidates.extend(fetch_openalex_thesis_candidates())

    # Interleave candidates across sources for maximum institutional & disciplinary diversity
    by_repo: dict[str, list[dict]] = {}
    for c in all_candidates:
        key = c["source_repo"].split(" ")[0]
        by_repo.setdefault(key, []).append(c)

    interleaved: list[dict] = []
    max_len = max((len(v) for v in by_repo.values()), default=0)
    for i in range(max_len):
        for k in list(by_repo.keys()):
            if i < len(by_repo[k]):
                interleaved.append(by_repo[k][i])

    print(f"Total interleaved candidate URLs queued: {len(interleaved)}", flush=True)

    lock = threading.Lock()
    stop_event = threading.Event()

    def process_candidate(cand: dict) -> bool:
        if stop_event.is_set():
            return False
        pdf_url = cand["pdf_url"]
        with lock:
            if len(collected) >= args.target or pdf_url in seen_urls:
                return False
            seen_urls.add(pdf_url)

        pdf_bytes = download_pdf_bytes(pdf_url)
        if not pdf_bytes or stop_event.is_set():
            return False

        sha256 = hashlib.sha256(pdf_bytes).hexdigest()
        with lock:
            if sha256 in seen_sha256:
                return False

        info = validate_thesis_pdf(pdf_bytes)
        if not info:
            return False

        with lock:
            if len(collected) >= args.target or sha256 in seen_sha256:
                if len(collected) >= args.target:
                    stop_event.set()
                return False

            seen_sha256.add(sha256)
            idx_200 = len(collected) + 1
            idx_20 = 20 + idx_200  # 21.pdf .. 220.pdf

            fname_20 = f"{idx_20}.pdf"
            slug = make_slug(cand.get("title") or info["title_preview"])
            fname_200 = f"{idx_200:03d}_{slug}.pdf"

            path_20 = dir_20 / fname_20
            path_200 = dir_200 / fname_200

            path_20.write_bytes(pdf_bytes)
            if path_200.exists():
                path_200.unlink()
            try:
                os.link(path_20, path_200)
            except OSError:
                path_200.write_bytes(pdf_bytes)

            rec = {
                "index": idx_200,
                "thesis_number": idx_20,
                "filename_in_20_theses": fname_20,
                "filename_in_200_theses": fname_200,
                "title": cand.get("title") or info["title_preview"],
                "author": cand.get("author") or "Student Author",
                "source_repo": cand["source_repo"],
                "landing_url": cand.get("landing_url") or pdf_url,
                "pdf_url": pdf_url,
                "num_pages": info["num_pages"],
                "size_kb": max(1, len(pdf_bytes) // 1024),
                "citation_style": info["citation_style"],
                "apa_in_text_count": info["apa_in_text_count"],
                "numeric_in_text_count": info["numeric_in_text_count"],
                "ref_year_mentions": info["ref_year_mentions"],
                "sha256": sha256,
            }
            collected.append(rec)

            # Persist manifest incrementally
            meta_json = json.dumps(collected, ensure_ascii=False, indent=2)
            meta_path_200.write_text(meta_json, encoding="utf-8")
            meta_path_20.write_text(meta_json, encoding="utf-8")

            print(
                f"  [+] [{idx_200:03d}/{args.target:03d}] {fname_20} / {fname_200[:40]:40s} | "
                f"{info['num_pages']:2d}p | {rec['size_kb']:4d}KB | {info['citation_style']:15s} | "
                f"{cand['source_repo'][:25]}",
                flush=True,
            )

            if len(collected) >= args.target:
                stop_event.set()
            return True

    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = [pool.submit(process_candidate, c) for c in interleaved]
        for fut in concurrent.futures.as_completed(futures):
            if stop_event.is_set():
                break

    print("\n" + "=" * 95, flush=True)
    print(
        f"COMPLETED: Collected {len(collected)}/{args.target} verified English theses!",
        flush=True,
    )
    print(f"  - Numbered files in 20-theses/ : 21.pdf .. {20 + len(collected)}.pdf", flush=True)
    print(f"  - Named files in 200-theses/   : 001_<slug>.pdf .. {len(collected):03d}_<slug>.pdf", flush=True)
    print(f"  - Manifests saved to           : {meta_path_20} & {meta_path_200}", flush=True)

    by_src: dict[str, int] = {}
    for r in collected:
        s = r["source_repo"].split(" ")[0]
        by_src[s] = by_src.get(s, 0) + 1
    print("\nBreakdown by Repository Source:", flush=True)
    for s, cnt in sorted(by_src.items(), key=lambda x: -x[1]):
        print(f"  - {s:30s}: {cnt:3d} PDFs", flush=True)
    print("=" * 95, flush=True)

    return 0 if len(collected) >= args.target else 1


if __name__ == "__main__":
    sys.exit(main())
