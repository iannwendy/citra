#!/usr/bin/env python3
"""
Collect student theses, graduation projects, and essays (PDFs) from
Ton Duc Thang University (TDTU) iDiscovery / Primo Library Catalog
(http://idiscovery.tdtu.edu.vn/primo-explore/search?vid=tdtu).

Features:
1. Queries Primo PNX REST API across all faculties/disciplines for online
   student theses (`minorthesis`), graduation projects (`đồ án`), essays (`tiểu luận`),
   and postgraduate theses (`dissertations`).
2. Concurrently resolves each record's Aleph media service link (`catalog.tdtu.edu.vn/F?func=service...`)
   to extract the internal PDF path (`/exlibris/aleph/a23_1/apache_media/<HASH>.pdf`)
   and saves the candidate catalog to `<output>/tdtu_catalog_candidates.json`.
3. Authenticates via TDTU CAS Single Sign-On (`elink.tdtu.edu.vn:8443/cas/login`) and,
   when connected to TDTU Campus Wi-Fi / VPN (which permits access to
   `https://databases.tdtu.edu.vn:8443/ebook/`), automatically downloads and validates
   100 full-text PDFs into `<output>/` (`TDTU_PDF/`).

Usage:
    # Run when on TDTU Campus Wi-Fi / VPN to download 100 PDFs:
    .venv/bin/python scripts/collect_dataset/collect_tdtu_idiscovery.py \
        --output TDTU_PDF \
        --n 100 \
        --username <MSSV> \
        --password <MAT_KHAU>

    # Pre-fetch catalog metadata & Aleph PDF paths off-campus:
    .venv/bin/python scripts/collect_dataset/collect_tdtu_idiscovery.py \
        --output TDTU_PDF \
        --n 100 \
        --prefetch-only
"""

from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import json
import os
import re
import sys
import time
import unicodedata
from pathlib import Path
from urllib.parse import quote

import fitz  # PyMuPDF
import requests
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

PRIMO_BASE = "http://idiscovery.tdtu.edu.vn"
PRIMO_SEARCH_URL = f"{PRIMO_BASE}/primo-explore/search?vid=tdtu"
PRIMO_GUEST_JWT_URL = (
    f"{PRIMO_BASE}/primo_library/libweb/webservices/rest/v1/guestJwt/TDT01"
    "?isGuest=true&lang=en_US&viewId=tdtu"
)
PRIMO_PNX_API = f"{PRIMO_BASE}/primo_library/libweb/webservices/rest/primo-explore/v1/pnxs"
ALEPH_URL_RE = re.compile(r'name=["\']alephUrl["\']\s+value=["\']([^"\']+\.pdf)["\']', re.IGNORECASE)

# Search queries covering all student thesis/project/essay types at TDTU
TDTU_QUERIES = [
    ("khoa_luan", "any,contains,khoá luận", "facet_rtype,exact,minorthesis|,|facet_tlevel,exact,online_resources"),
    ("do_an", "any,contains,đồ án", "facet_rtype,exact,minorthesis|,|facet_tlevel,exact,online_resources"),
    ("tieu_luan", "any,contains,tiểu luận", "facet_rtype,exact,minorthesis|,|facet_tlevel,exact,online_resources"),
    ("luan_van", "any,contains,luận văn", "facet_rtype,exact,dissertations|,|facet_tlevel,exact,online_resources"),
]


def slugify(text: str, max_len: int = 75) -> str:
    text = text.replace("đ", "d").replace("Đ", "D")
    nfkd = unicodedata.normalize("NFKD", text)
    ascii_str = "".join(c for c in nfkd if not unicodedata.combining(c))
    slug = re.sub(r"[^a-zA-Z0-9]+", "_", ascii_str).strip("_")
    return slug[:max_len] or "tdtu_thesis"


def extract_service_url(linktorsrc_list: list[str] | None) -> str | None:
    if not linktorsrc_list:
        return None
    for entry in linktorsrc_list:
        m = re.search(r"\$\$U(https?://[^\s$]+)", entry)
        if m:
            url = m.group(1).strip()
            if "catalog.tdtu.edu.vn" in url and "service_type=MEDIA" in url:
                return url
    return None


def get_cas_pds_handle(username: str, password: str) -> str:
    """Authenticate against TDTU CAS SSO via requests and return the Aleph PDS_HANDLE."""
    s = requests.Session()
    s.headers.update({"User-Agent": "Mozilla/5.0"})
    service_target = (
        "http://catalog.tdtu.edu.vn/cas/pds_main?func=load-login&calling_system=primo"
        "&institute=TDT50&PDS_HANDLE=&url=http://idiscovery.tdtu.edu.vn:80/primo_library"
        "/libweb/pdsLogin?targetURL=http%3A%2F%2Fidiscovery.tdtu.edu.vn%2Fprimo-explore"
        "%2Fsearch%3Fvid%3Dtdtu&from-new-ui=1&authenticationProfile=TDT&filler="
    )
    cas_url = "https://elink.tdtu.edu.vn:8443/cas/login"
    r = s.get(cas_url, params={"service": service_target}, verify=False, timeout=12)
    m_ex = re.search(r'name="execution"\s+value="([^"]+)"', r.text)
    if not m_ex:
        return "GUEST"
    r2 = s.post(
        cas_url,
        params={"service": service_target},
        data={
            "username": username,
            "password": password,
            "execution": m_ex.group(1),
            "_eventId": "submit",
            "geolocation": "",
            "submit": "LOGIN",
        },
        verify=False,
        timeout=12,
    )
    m_pds = re.search(r"pds_handle=(\d+)", r2.text)
    return m_pds.group(1) if m_pds else "GUEST"


def resolve_aleph_pdf_path(service_url: str, pds_handle: str = "GUEST", timeout: int = 12) -> str | None:
    """Fetch catalog.tdtu.edu.vn service page with PDS_HANDLE and extract the internal Aleph PDF path."""
    import html as html_lib

    try:
        s = requests.Session()
        s.headers.update({"User-Agent": "Mozilla/5.0", "Referer": f"{PRIMO_BASE}/"})
        resp = s.get(service_url, timeout=timeout, verify=False)
        if resp.status_code == 200:
            m = ALEPH_URL_RE.search(resp.text)
            if m:
                return m.group(1).strip()
            m_sso = re.search(r"url=(http://catalog\.tdtu\.edu\.vn:80/F/[^\x27\"]+)", resp.text)
            if m_sso:
                direct_u = html_lib.unescape(m_sso.group(1))
                if "pds_handle=" not in direct_u:
                    direct_u += f"&pds_handle={pds_handle}"
                resp2 = s.get(direct_u, timeout=timeout, verify=False)
                m2 = ALEPH_URL_RE.search(resp2.text)
                if m2:
                    return m2.group(1).strip()
    except Exception:
        pass
    return None


def inspect_pdf_bytes(pdf_bytes: bytes, min_pages: int = 5) -> dict | None:
    if not pdf_bytes or not pdf_bytes.startswith(b"%PDF"):
        return None
    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    except Exception:
        return None
    try:
        if doc.is_encrypted or len(doc) < min_pages:
            return None
        num_pages = len(doc)
        p1_text = doc[0].get_text("text")
        p1_lines = [line.strip() for line in p1_text.splitlines() if line.strip()]
        preview = " | ".join(p1_lines[:8])[:250]
        return {
            "num_pages": num_pages,
            "preview": preview,
        }
    finally:
        doc.close()


def prefetch_candidates_via_rest(
    candidates_path: Path,
    username: str,
    password: str,
    desired_count: int = 140,
) -> list[dict]:
    """Fast REST prefetch of TDTU thesis metadata and internal Aleph PDF paths."""
    candidates: list[dict] = []
    seen_ids: set[str] = set()

    if candidates_path.exists():
        try:
            loaded = json.loads(candidates_path.read_text(encoding="utf-8"))
            if loaded and all(c.get("aleph_pdf_path") for c in loaded[:5]):
                candidates = loaded
                for c in candidates:
                    seen_ids.add(c["doc_id"])
                if len(candidates) >= desired_count:
                    print(f"[*] Loaded {len(candidates)} cached TDTU candidates from {candidates_path}", flush=True)
                    return candidates
        except Exception:
            candidates = []

    print("[*] Authenticating against TDTU CAS SSO to obtain Aleph PDS_HANDLE...", flush=True)
    pds_handle = get_cas_pds_handle(username, password)
    print(f"[*] Obtained PDS_HANDLE={pds_handle}. Acquiring Primo REST API token...", flush=True)
    r_jwt = requests.get(PRIMO_GUEST_JWT_URL, timeout=12)
    jwt_token = r_jwt.text.strip('"')
    headers = {"Authorization": f'Bearer "{jwt_token}"', "User-Agent": "Mozilla/5.0"}

    raw_items: list[dict] = []
    for q_label, q_str, q_inc in TDTU_QUERIES:
        if len(raw_items) + len(candidates) >= desired_count:
            break
        for offset in range(0, 125, 25):
            if len(raw_items) + len(candidates) >= desired_count:
                break
            api_url = (
                f"{PRIMO_PNX_API}?blendFacetsSeparately=false&getMore=0&inst=TDT01"
                f"&lang=en_US&limit=25&newspapersActive=false&newspapersSearch=false"
                f"&offset={offset}&pcAvailability=false&q={quote(q_str, safe=',')}"
                f"&qExclude=&qInclude={quote(q_inc)}&refEntryActive=false&rtaLinks=true"
                f"&scope=default_scope&searchInFulltextUserSelection=true&skipDelivery=Y"
                f"&sort=rank&tab=default_tab&vid=tdtu"
            )
            try:
                resp = requests.get(api_url, headers=headers, timeout=15)
                docs = resp.json().get("docs") or []
            except Exception:
                break
            if not docs:
                break
            for d in docs:
                pnx = d.get("pnx") or {}
                doc_id = (pnx.get("control", {}).get("recordid") or [""])[0]
                if not doc_id or doc_id in seen_ids:
                    continue
                links = pnx.get("links", {}).get("linktorsrc")
                service_url = extract_service_url(links)
                if not service_url:
                    continue
                display = pnx.get("display") or {}
                seen_ids.add(doc_id)
                raw_items.append({
                    "doc_id": doc_id,
                    "category": q_label,
                    "resource_type": (display.get("type") or [q_label])[0],
                    "title": (display.get("title") or ["TDTU Thesis"])[0],
                    "author": (display.get("creator") or display.get("lds07") or [""])[0],
                    "year": (display.get("creationdate") or [""])[0],
                    "major_or_publisher": (display.get("publisher") or [""])[0],
                    "subject": (display.get("subject") or [""])[0],
                    "service_url": service_url,
                })
                if len(raw_items) + len(candidates) >= desired_count:
                    break

    if raw_items:
        print(f"[*] Resolving internal Aleph PDF paths for {len(raw_items)} TDTU records in parallel...", flush=True)

        def _resolve(item: dict) -> dict:
            item["aleph_pdf_path"] = resolve_aleph_pdf_path(item["service_url"], pds_handle=pds_handle)
            return item

        with concurrent.futures.ThreadPoolExecutor(max_workers=12) as ex:
            resolved = list(ex.map(_resolve, raw_items))
        candidates.extend(resolved)
        candidates_path.write_text(json.dumps(candidates, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"[*] Saved {len(candidates)} TDTU thesis candidates to {candidates_path}", flush=True)

    return candidates


def run_scraper(
    output_dir: Path,
    target_n: int,
    username: str,
    password: str,
    headless: bool = True,
    prefetch_only: bool = False,
) -> int:
    output_dir.mkdir(parents=True, exist_ok=True)
    candidates_path = output_dir / "tdtu_catalog_candidates.json"
    manifest_path = output_dir / "metadata.json"

    candidates = prefetch_candidates_via_rest(
        candidates_path,
        username=username,
        password=password,
        desired_count=max(target_n + 40, 140),
    )
    if prefetch_only:
        return 0

    collected: list[dict] = []
    seen_sha256: set[str] = set()
    seen_doc_ids: set[str] = set()

    if manifest_path.exists():
        try:
            existing = json.loads(manifest_path.read_text(encoding="utf-8"))
            for item in existing:
                if (output_dir / item.get("filename", "")).exists():
                    collected.append(item)
                    if item.get("sha256"):
                        seen_sha256.add(item["sha256"])
                    if item.get("doc_id"):
                        seen_doc_ids.add(item["doc_id"])
            print(f"[*] Loaded {len(collected)} existing PDFs from {manifest_path}", flush=True)
        except Exception as e:
            print(f"[!] Could not read existing manifest: {e}", flush=True)

    if len(collected) >= target_n:
        print(f"[*] Already reached target of {target_n} PDFs in {output_dir}.", flush=True)
        return 0

    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=headless)
        context = browser.new_context(ignore_https_errors=True, accept_downloads=True)
        page = context.new_page()

        print(f"[*] Navigating to {PRIMO_SEARCH_URL} ...", flush=True)
        page.goto(PRIMO_SEARCH_URL, wait_until="networkidle", timeout=30000)

        print(f"[*] Signing in via CAS SSO as {username} ...", flush=True)
        sign_in_btn = page.get_by_role("button", name=re.compile(r"Sign\s*in", re.I))
        if sign_in_btn.count() > 0:
            sign_in_btn.first.click()
            page.wait_for_selector("#username", timeout=15000)
            page.locator("#username").press_sequentially(username, delay=40)
            page.locator("#password").press_sequentially(password, delay=40)
            page.locator("#password").press("Enter")
            page.wait_for_url(re.compile(r"idiscovery\.tdtu\.edu\.vn"), timeout=25000)
            time.sleep(2.0)

        print("[*] Starting full-text PDF download from TDTU Ebook server...", flush=True)
        dl_page = context.new_page()
        captured_pdfs: list[bytes] = []

        def on_response(resp):
            try:
                ct = (resp.headers.get("content-type") or "").lower()
                if "application/pdf" in ct or resp.url.lower().endswith(".pdf"):
                    body = resp.body()
                    if body and body.startswith(b"%PDF"):
                        captured_pdfs.append(body)
            except Exception:
                pass

        dl_page.on("response", on_response)

        ip_blocked_count = 0
        for cand in candidates:
            if len(collected) >= target_n:
                break
            doc_id = cand["doc_id"]
            if doc_id in seen_doc_ids:
                continue

            captured_pdfs.clear()
            try:
                dl_page.goto(cand["service_url"], wait_until="networkidle", timeout=20000)
                time.sleep(1.0)
            except Exception:
                pass

            if "error.jsp?code=6" in dl_page.url or "not permitted for your IP address" in dl_page.content():
                ip_blocked_count += 1
                if ip_blocked_count >= 3 and len(collected) == 0:
                    print(
                        "\n[!] BLOCKED BY TDTU IP RESTRICTION (error.jsp?code=6):\n"
                        "    'Object is not permitted for your IP address'\n"
                        f"    -> All {len(candidates)} thesis links & Aleph PDF paths have been pre-fetched\n"
                        f"       and saved to: {candidates_path}\n"
                        "    -> Connect to TDTU Campus Wi-Fi or TDTU VPN and re-run this exact command\n"
                        "       to download all 100 PDFs automatically.",
                        flush=True,
                    )
                    browser.close()
                    return 2
                continue

            if not captured_pdfs:
                for fr in dl_page.frames:
                    if ".pdf" in fr.url.lower():
                        try:
                            r = context.request.get(fr.url)
                            b = r.body()
                            if b.startswith(b"%PDF"):
                                captured_pdfs.append(b)
                                break
                        except Exception:
                            pass

            if not captured_pdfs:
                continue

            pdf_bytes = max(captured_pdfs, key=len)
            info = inspect_pdf_bytes(pdf_bytes)
            if not info:
                continue

            sha = hashlib.sha256(pdf_bytes).hexdigest()
            if sha in seen_sha256:
                continue
            seen_sha256.add(sha)
            seen_doc_ids.add(doc_id)

            idx = len(collected) + 1
            slug = slugify(cand.get("title") or doc_id)
            fname = f"{idx:03d}_tdtu_{doc_id}_{slug}.pdf"
            (output_dir / fname).write_bytes(pdf_bytes)

            record = {
                "id": idx,
                "filename": fname,
                "doc_id": doc_id,
                "title": cand.get("title"),
                "author": cand.get("author"),
                "year": cand.get("year"),
                "major_or_publisher": cand.get("major_or_publisher"),
                "service_url": cand.get("service_url"),
                "aleph_pdf_path": cand.get("aleph_pdf_path"),
                "size_kb": len(pdf_bytes) // 1024,
                "num_pages": info["num_pages"],
                "preview": info["preview"],
                "sha256": sha,
            }
            collected.append(record)
            manifest_path.write_text(json.dumps(collected, ensure_ascii=False, indent=2), encoding="utf-8")
            print(f"[{idx:03d}/{target_n:03d}] Saved {fname} ({info['num_pages']}p, {record['size_kb']}KB)", flush=True)

        browser.close()

    print(f"[*] Done! Collected {len(collected)} PDFs in {output_dir}", flush=True)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Collect TDTU theses/projects PDFs from iDiscovery")
    parser.add_argument("--output", "-o", default="TDTU_PDF", help="Output directory (default: TDTU_PDF)")
    parser.add_argument("--n", type=int, default=100, help="Number of PDFs to collect (default: 100)")
    parser.add_argument("--username", "-u", default=os.environ.get("TDTU_USERNAME", ""))
    parser.add_argument("--password", "-p", default=os.environ.get("TDTU_PASSWORD", ""))
    parser.add_argument("--headed", action="store_true", help="Run browser in headed mode")
    parser.add_argument(
        "--prefetch-only",
        action="store_true",
        help="Only fetch & resolve 100+ TDTU catalog candidates and Aleph PDF paths without downloading PDFs",
    )
    args = parser.parse_args()

    return run_scraper(
        output_dir=Path(args.output),
        target_n=args.n,
        username=args.username,
        password=args.password,
        headless=not args.headed,
        prefetch_only=args.prefetch_only,
    )


if __name__ == "__main__":
    sys.exit(main())
