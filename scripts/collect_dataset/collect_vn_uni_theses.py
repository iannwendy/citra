#!/usr/bin/env python3
"""
Collect 100 real student theses / graduation projects / essays (Khóa luận, Đồ án,
Tiểu luận, Luận văn, Luận án) in PDF format across Vietnamese universities into TDTU_PDF/.

Sources combined:
1. Open DSpace Digital Library of University of Economics - University of Da Nang (DUE):
   http://thuvien.due.udn.vn:8080/dspace (across Finance-Banking, Accounting, Auditing,
   Business Administration, Marketing, E-Commerce, Economic Law, Statistics, Doctoral Dissertations).
2. Public Vietnamese University Student Thesis/Project Repositories on GitHub
   (UIT, HCMUT, HCMUS, HUST, PTIT, HCMUTE, UEH, FTU, NEU, FPTU, TDTU, CTU, HUIT, VNU, etc.).

Usage:
    .venv/bin/python -u scripts/collect_dataset/collect_vn_uni_theses.py \
        --output TDTU_PDF \
        --n 100
"""

from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import unicodedata
from pathlib import Path
from urllib.parse import quote, unquote

import fitz  # PyMuPDF
import requests
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

GITHUB_API = "https://api.github.com"
RAW_GITHUB = "https://raw.githubusercontent.com"
DUE_BASE = "http://thuvien.due.udn.vn:8080"

# DUE DSpace collections across disciplines (Finance, Accounting, Business Admin, Marketing, Law, E-Commerce, Doctoral)
DUE_COLLECTIONS = [
    ("/dspace/handle/TVDHKT/32", "Luận án Tiến sĩ Kinh tế"),
    ("/dspace/handle/TVDHKT/29", "Khóa luận / Luận văn Kế toán - Kiểm toán"),
    ("/dspace/handle/TVDHKT/30", "Khóa luận / Luận văn Quản trị Kinh doanh"),
    ("/dspace/handle/TVDHKT/31", "Khóa luận / Luận văn Tài chính - Ngân hàng"),
    ("/dspace/handle/TVDHKT/34", "Khóa luận / Luận văn Marketing & Thương mại"),
    ("/dspace/handle/TVDHKT/18539", "Luận văn Quản lý Kinh tế & Luật"),
    ("/dspace/handle/TVDHKT/49287", "Luận văn / Khóa luận Kinh tế 2023"),
    ("/dspace/handle/TVDHKT/49246", "Luận văn / Khóa luận Kinh doanh 2023"),
    ("/dspace/handle/TVDHKT/50052", "Luận văn / Khóa luận Tài chính - Ngân hàng 2024"),
    ("/dspace/handle/TVDHKT/50053", "Luận văn / Khóa luận Kế toán - Kiểm toán 2024"),
    ("/dspace/handle/TVDHKT/50054", "Luận văn / Khóa luận Quản trị Kinh doanh 2024"),
    ("/dspace/handle/TVDHKT/50055", "Luận văn / Khóa luận Kinh tế & Quản lý công 2024"),
]

# Multi-university GitHub search queries covering Vietnamese universities & thesis/project types
GITHUB_THESIS_QUERIES = [
    "KhoaLuanTotNghiep",
    "DoAnTotNghiep",
    "KLTN UIT",
    "DATN HUST",
    "DATN BK",
    "KLTN HCMUS",
    "DoAnChuyenNganh",
    "BaoCaoDoAn",
    "LuanVanTotNghiep",
    "TieuLuan",
    "DoAnMonHoc",
    "NT106 UIT",
    "SE104 UIT",
    "IE104 UIT",
    "CS114 UIT",
    "DS102 UIT",
    "IS207 UIT",
    "IE105 UIT",
    "SE100 UIT",
    "CS116 UIT",
    "CO3001 HCMUT",
    "CO2001 HCMUT",
    "HCMUTE DoAn",
    "PTIT DoAn",
    "HUST DoAn",
    "HCMUS DoAn",
    "UEH TieuLuan",
    "FPT Capstone Report",
    "TDTU Khoaluan",
    "TDTU Tieuluan",
    "TDTU DoAn",
    "BaoCaoCuoiKy",
    "BaoCaoBTL",
    "DoAnCoSo",
    "DoAn1",
    "DoAn2",
    "Project Report UIT",
    "Final Report HCMUT",
    "Final Report HUST",
    "Final Report HCMUS",
]

EXCLUDE_REPO_OR_PATH_RE = re.compile(
    r"("
    r"node_modules|vendor|assets/|third[_-]?party|packages/|site-packages|"
    r"textmesh|shader|polyspace|misra|turnitin|rulebook|manual|datasheet|"
    r"resume|cv[_.-]|certificate|bangdiem|bang_diem|score|transcript|"
    r"slide|presentation|poster|pitch|banner|brochure|"
    r"syllabus|de_bai|debai|de-bai|huong_dan|huongdan|guideline|rubric|"
    r"template|skeleton|boilerplate|sample|example|empty|thesis[_-]?kit|latex[_-]?template|"
    r"quy[_-]?dinh|quydinh|bieu[_-]?mau|bieumau|uitm|arctic|norway|tromso|"
    r"lab\s*0?\d|exercise|baitap|bai_tap|tutorial|cheat[_-]?sheet|checklist|"
    r"trac_nghiem|tracnghiem|cau_hoi|dap_an"
    r")",
    re.IGNORECASE,
)

INCLUDE_PATH_RE = re.compile(
    r"("
    r"report|baocao|bao_cao|bao-cao|báo\s*cáo|"
    r"tieuluan|tieu_luan|tieu-luan|tiểu\s*luận|"
    r"khoaluan|khoa_luan|khóa\s*luận|luanvan|luận\s*văn|luanan|luận\s*án|"
    r"doan|do_an|do-an|đồ\s*án|datn|kltn|lvtn|dacn|damh|dacs|btl|"
    r"midterm|final|giuaky|giua_ky|cuoiky|cuoi_ky|capstone|"
    r"essay|thesis|dissertation|graduation|doc/|docs/|nop_bai"
    r")",
    re.IGNORECASE,
)

VN_DIACRITIC_RE = re.compile(
    r"[àáảãạăắằẳẵặâấầẩẫậđèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵ]",
    re.IGNORECASE,
)

VN_ENGLISH_UNI_RE = re.compile(
    r"("
    r"vietnam\s+national\s+university|ho\s+chi\s+minh\s+city|hanoi\s+university|"
    r"ton\s+duc\s+thang\s+university|can\s+tho\s+university|da\s+nang|"
    r"fpt\s+university|posts\s+and\s+telecommunications"
    r")",
    re.IGNORECASE,
)

# Detect Vietnamese university name from first 3 pages of PDF
UNI_PATTERNS = [
    ("TDTU", re.compile(r"(tôn\s+đức\s+thắng|ton\s+duc\s+thang|\btdtu\b|tổng\s+liên\s+đoàn\s+lao\s+động)", re.I)),
    ("DUE_UDN", re.compile(r"(đại\s+học\s+đà\s+nẵng.*đại\s+học\s+kinh\s+tế|trường\s+đại\s+học\s+kinh\s+tế.*đà\s+nẵng)", re.I | re.S)),
    ("UIT_VNUHCM", re.compile(r"(đại\s+học\s+công\s+nghệ\s+thông\s+tin|university\s+of\s+information\s+technology|\buit\b)", re.I)),
    ("HCMUT_VNUHCM", re.compile(r"(đại\s+học\s+bách\s+khoa.*hồ\s+chí\s+minh|ho\s+chi\s+minh\s+city\s+university\s+of\s+technology|\bhcmut\b)", re.I | re.S)),
    ("HCMUS_VNUHCM", re.compile(r"(đại\s+học\s+khoa\s+học\s+tự\s+nhiên|university\s+of\s+science|\bhcmus\b)", re.I)),
    ("HUST", re.compile(r"(đại\s+học\s+bách\s+khoa\s+hà\s+nội|hanoi\s+university\s+of\s+science\s+and\s+technology|\bhust\b)", re.I)),
    ("PTIT", re.compile(r"(bưu\s+chính\s+viễn\s+thông|posts\s+and\s+telecommunications|\bptit\b)", re.I)),
    ("HCMUTE", re.compile(r"(sư\s+phạm\s+kỹ\s+thuật|technology\s+and\s+education|\bhcmute\b)", re.I)),
    ("UEH", re.compile(r"(đại\s+học\s+kinh\s+tế\s+tp|university\s+of\s+economics\s+ho\s+chi\s+minh|\bueh\b)", re.I)),
    ("FPTU", re.compile(r"(đại\s+học\s+fpt|fpt\s+university)", re.I)),
    ("UET_VNUHN", re.compile(r"(đại\s+học\s+công\s+nghệ.*đại\s+học\s+quốc\s+gia\s+hà\s+nội|vnu\s+university\s+of\s+engineering)", re.I | re.S)),
    ("NEU", re.compile(r"(kinh\s+tế\s+quốc\s+dân|national\s+economics\s+university)", re.I)),
    ("FTU", re.compile(r"(đại\s+học\s+ngoại\s+thương|foreign\s+trade\s+university)", re.I)),
    ("HUIT", re.compile(r"(công\s+thương\s+tp|công\s+nghiệp\s+thực\s+phẩm|\bhuit\b|\bhufi\b)", re.I)),
    ("CTU", re.compile(r"(đại\s+học\s+cần\s+thơ|can\s+tho\s+university)", re.I)),
    ("DUT_UDN", re.compile(r"(đại\s+học\s+bách\s+khoa.*đà\s+nẵng)", re.I | re.S)),
    ("SGU", re.compile(r"(đại\s+học\s+sài\s+gòn|sai\s+gon\s+university)", re.I)),
    ("IUH", re.compile(r"(đại\s+học\s+công\s+nghiệp\s+tp|industrial\s+university\s+of\s+ho\s+chi\s+minh)", re.I)),
    ("VNU", re.compile(r"(đại\s+học\s+quốc\s+gia|vietnam\s+national\s+university)", re.I)),
]

UNIVERSITY_HEADER_RE = re.compile(
    r"("
    r"bộ\s+giáo\s+dục\s+và\s+đào\s+tạo|đại\s+học\s+quốc\s+gia|đại\s+học\s+đà\s+nẵng|"
    r"trường\s+đại\s+học|học\s+viện\s+công\s+nghệ|tổng\s+liên\s+đoàn\s+lao\s+động|"
    r"đại\s+học\s+bách\s+khoa|vietnam\s+national\s+university|"
    r"ton\s+duc\s+thang\s+university|fpt\s+university|hanoi\s+university|"
    r"ho\s+chi\s+minh\s+city\s+university|can\s+tho\s+university"
    r")",
    re.IGNORECASE,
)

THESIS_KEYWORD_RE = re.compile(
    r"("
    r"khóa\s+luận|khoá\s+luận|đồ\s+án|tiểu\s+luận|luận\s+văn|luận\s+án|"
    r"báo\s+cáo|bài\s+tập\s+lớn|chuyên\s+đề|nghiên\s+cứu\s+khoa\s+học|"
    r"thesis|dissertation|capstone|graduation\s+project|final\s+report|project\s+report|"
    r"giảng\s+viên\s+hướng\s+dẫn|gvhd|người\s+hướng\s+dẫn|sinh\s+viên\s+thực\s+hiện|học\s+viên"
    r")",
    re.IGNORECASE,
)

TEMPLATE_TEXT_RE = re.compile(
    r"("
    r"lorem\s+ipsum|tên\s+đề\s+tài\s+khóa\s+luận|nhập\s+tên\s+đề\s+tài|"
    r"hướng\s+dẫn\s+sử\s+dụng\s+template|mẫu\s+báo\s+cáo\s+khóa\s+luận|"
    r"universiti\s+teknologi\s+mara|uit\s+the\s+arctic\s+university"
    r")",
    re.IGNORECASE,
)

REF_SECTION_RE = re.compile(
    r"(tài\s+liệu\s+tham\s+khảo|danh\s+mục\s+tham\s+khảo|\breferences\b|\bbibliography\b)",
    re.IGNORECASE,
)


def slugify(text: str, max_len: int = 70) -> str:
    text = text.replace("đ", "d").replace("Đ", "D")
    nfkd = unicodedata.normalize("NFKD", text)
    ascii_str = "".join(c for c in nfkd if not unicodedata.combining(c))
    slug = re.sub(r"[^a-zA-Z0-9]+", "_", ascii_str).strip("_")
    return slug[:max_len] or "thesis"


def detect_university(text: str, fallback: str = "VN_UNI") -> str:
    for code, pat in UNI_PATTERNS:
        if pat.search(text):
            return code
    return fallback


def inspect_pdf_bytes(
    pdf_bytes: bytes,
    title_or_path_hint: str = "",
    min_pages: int = 6,
    max_pages: int = 260,
    require_uni_header: bool = True,
    fallback_uni: str = "VN_UNI",
) -> dict | None:
    if not pdf_bytes or not pdf_bytes.startswith(b"%PDF"):
        return None
    if EXCLUDE_REPO_OR_PATH_RE.search(title_or_path_hint or ""):
        return None
    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    except Exception:
        return None

    try:
        if doc.is_encrypted or len(doc) < min_pages or len(doc) > max_pages:
            return None

        num_pages = len(doc)
        # Reject presentation slides (landscape pages)
        sample_check = min(5, num_pages)
        landscape = sum(1 for i in range(sample_check) if doc[i].rect.width > doc[i].rect.height * 1.15)
        if landscape >= (sample_check // 2 + 1):
            return None

        first_pages_text = "\n".join(doc[i].get_text("text") for i in range(min(4, num_pages)))
        last_pages_text = "\n".join(doc[i].get_text("text") for i in range(max(0, num_pages - 6), num_pages))
        combined = first_pages_text + "\n" + last_pages_text

        if len(combined.strip()) < 1200:
            return None

        if TEMPLATE_TEXT_RE.search(first_pages_text):
            return None

        # Must be a Vietnamese university document (either Vietnamese diacritics or explicit VN English university name)
        vn_diacritics = len(VN_DIACRITIC_RE.findall(first_pages_text))
        if vn_diacritics < 20 and not VN_ENGLISH_UNI_RE.search(first_pages_text):
            return None

        if require_uni_header:
            if not UNIVERSITY_HEADER_RE.search(first_pages_text):
                return None
            if not THESIS_KEYWORD_RE.search(first_pages_text):
                return None

        uni_code = detect_university(first_pages_text, fallback=fallback_uni)
        has_references = bool(REF_SECTION_RE.search(last_pages_text) or REF_SECTION_RE.search(first_pages_text))

        p1_lines = [line.strip() for line in first_pages_text.splitlines() if line.strip()]
        preview = " | ".join(p1_lines[:9])[:260]

        return {
            "num_pages": num_pages,
            "university": uni_code,
            "has_references": has_references,
            "preview": preview,
        }
    finally:
        doc.close()


def collect_due_dspace_candidates(max_items: int = 45) -> list[dict]:
    """Discover open PDF bitstreams from University of Economics - University of Da Nang (DUE DSpace)."""
    session = requests.Session()
    session.headers.update({"User-Agent": "Mozilla/5.0 (EssayIntegrityChecker/1.0)"})
    candidates: list[dict] = []
    seen_handles: set[str] = set()

    for col_path, col_label in DUE_COLLECTIONS:
        if len(candidates) >= max_items * 2:
            break
        try:
            resp = session.get(f"{DUE_BASE}{col_path}", timeout=8)
            if resp.status_code != 200:
                continue
            handles = sorted(set(re.findall(r"/dspace/handle/TVDHKT/\d+", resp.text)), reverse=True)
            for h in handles:
                hid = int(h.split("/")[-1])
                if hid < 100 or h in seen_handles:
                    continue
                seen_handles.add(h)
                candidates.append({"handle": h, "collection_label": col_label})
        except Exception:
            continue

    try:
        resp = session.get(
            f"{DUE_BASE}/dspace/browse?type=dateissued&sort_by=2&order=DESC&rpp=60",
            timeout=10,
        )
        if resp.status_code == 200:
            handles = sorted(set(re.findall(r"/dspace/handle/TVDHKT/\d+", resp.text)), reverse=True)
            for h in handles:
                hid = int(h.split("/")[-1])
                if hid > 1000 and h not in seen_handles:
                    seen_handles.add(h)
                    candidates.append({"handle": h, "collection_label": "Luận án / Luận văn / Khóa luận DUE"})
    except Exception:
        pass

    return candidates


def download_due_item(cand: dict) -> tuple[dict, bytes, dict] | None:
    session = requests.Session()
    session.headers.update({"User-Agent": "Mozilla/5.0 (EssayIntegrityChecker/1.0)"})
    handle = cand["handle"]
    try:
        r = session.get(f"{DUE_BASE}{handle}", timeout=10)
        if r.status_code != 200:
            return None

        title_m = re.search(r'<meta name="DC\.title" content="([^"]+)"', r.text)
        title = title_m.group(1).strip() if title_m else handle.split("/")[-1]
        author_m = re.search(r'<meta name="DC\.creator" content="([^"]+)"', r.text)
        author = author_m.group(1).strip() if author_m else ""

        bitstreams = re.findall(r'href=["\'](/dspace/bitstream/TVDHKT/[^"\']+\.pdf)["\']', r.text, re.I)
        filtered_bs = []
        for b in bitstreams:
            bl = unquote(b).lower()
            if any(x in bl for x in ("toanvan", "bia", "nhanxet", "trang_thong_tin", "quyetdinh")):
                continue
            filtered_bs.append(b)

        for b in filtered_bs:
            burl = f"{DUE_BASE}{b}"
            r2 = session.get(burl, timeout=20)
            if r2.status_code == 200 and r2.content.startswith(b"%PDF"):
                info = inspect_pdf_bytes(
                    r2.content,
                    title_or_path_hint=title,
                    min_pages=6,
                    max_pages=260,
                    require_uni_header=False,
                    fallback_uni="DUE_UDN",
                )
                if info:
                    meta = {
                        "source_type": "dspace_due_udn",
                        "university": "DUE_UDN",
                        "title": title,
                        "author": author,
                        "category": cand["collection_label"],
                        "source_url": burl,
                        "handle_url": f"{DUE_BASE}{handle}",
                    }
                    return (meta, r2.content, info)
    except Exception:
        pass
    return None


def get_github_token() -> str | None:
    token = os.environ.get("GITHUB_TOKEN")
    if token:
        return token.strip()
    try:
        return subprocess.check_output(["gh", "auth", "token"], text=True).strip()
    except Exception:
        return None


def api_get(session: requests.Session, url: str, params: dict | None = None) -> dict | list | None:
    for attempt in range(1, 5):
        try:
            resp = session.get(url, params=params, timeout=20)
            if resp.status_code == 200:
                return resp.json()
            if resp.status_code in (403, 429):
                reset = int(resp.headers.get("X-RateLimit-Reset", 0))
                wait = max(reset - int(time.time()) + 2, 8 * attempt) if reset else 12 * attempt
                wait = min(wait, 45)
                print(f"  [rate-limit] Waiting {wait}s...", flush=True)
                time.sleep(wait)
                continue
            return None
        except Exception:
            time.sleep(2 * attempt)
    return None


def download_github_raw(session: requests.Session, full_name: str, branch: str, path: str) -> bytes | None:
    encoded_path = "/".join(quote(part, safe="") for part in path.split("/"))
    url = f"{RAW_GITHUB}/{full_name}/{quote(branch, safe='')}/{encoded_path}"
    for attempt in range(1, 3):
        try:
            resp = session.get(url, timeout=30)
            if resp.status_code == 200 and resp.content.startswith(b"%PDF"):
                return resp.content
            return None
        except Exception:
            time.sleep(1.5 * attempt)
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description="Collect 100 student theses/projects/essays PDFs into TDTU_PDF")
    parser.add_argument("--output", "-o", default="TDTU_PDF", help="Output directory")
    parser.add_argument("--n", type=int, default=100, help="Target PDF count")
    parser.add_argument("--max-due", type=int, default=40, help="Max PDFs from DUE DSpace for university diversity")
    args = parser.parse_args()

    out_dir = Path(args.output)
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = out_dir / "metadata.json"

    collected: list[dict] = []
    seen_sha256: set[str] = set()
    seen_urls: set[str] = set()
    seen_blob_shas: set[str] = set()
    seen_repos: set[str] = set()

    # Exclude hashes already in tdtu_github_reports so all 100 PDFs in TDTU_PDF are unique
    other_manifest = Path("tdtu_github_reports/metadata.json")
    if other_manifest.exists():
        try:
            for item in json.loads(other_manifest.read_text(encoding="utf-8")):
                if item.get("sha256"):
                    seen_sha256.add(item["sha256"])
                if item.get("blob_sha"):
                    seen_blob_shas.add(item["blob_sha"])
            print(f"Loaded {len(seen_sha256)} existing hashes from tdtu_github_reports to avoid duplicates.", flush=True)
        except Exception:
            pass

    # Audit existing manifest & purge any template/foreign/duplicate-repo items
    if manifest_path.exists():
        try:
            existing = json.loads(manifest_path.read_text(encoding="utf-8"))
            valid_items = []
            for item in existing:
                fpath = out_dir / item["filename"]
                if not fpath.exists():
                    continue
                pdf_bytes = fpath.read_bytes()
                is_due = item.get("source_type") == "dspace_due_udn"
                hint = f"{item.get('title', '')} {item.get('source_url', '')} {item.get('filename', '')}"

                # Enforce 1 thesis per GitHub repo so we never keep v1/v2/v3 of the same thesis
                repo_key = ""
                if not is_due and item.get("source_url", "").startswith(RAW_GITHUB):
                    parts = item["source_url"].replace(RAW_GITHUB + "/", "").split("/")
                    if len(parts) >= 2:
                        repo_key = f"{parts[0]}/{parts[1]}"
                        if repo_key in seen_repos:
                            print(f"Removing duplicate-repo file: {item['filename']}", flush=True)
                            fpath.unlink(missing_ok=True)
                            continue

                info = inspect_pdf_bytes(
                    pdf_bytes,
                    title_or_path_hint=hint,
                    min_pages=6,
                    max_pages=260,
                    require_uni_header=not is_due,
                    fallback_uni="DUE_UDN" if is_due else "VN_UNI",
                )
                if not info:
                    print(f"Removing template/non-VN file: {item['filename']}", flush=True)
                    fpath.unlink(missing_ok=True)
                    continue

                if repo_key:
                    seen_repos.add(repo_key)
                valid_items.append((item, pdf_bytes, info))

            # Cleanly renumber retained files 001..K
            for item, _b, _i in valid_items:
                (out_dir / item["filename"]).unlink(missing_ok=True)

            for idx, (item, pdf_bytes, info) in enumerate(valid_items, start=1):
                uni = info["university"].lower()
                slug = slugify(item.get("title") or "thesis")
                fname = f"{idx:03d}_{uni}_{slug}.pdf"
                (out_dir / fname).write_bytes(pdf_bytes)
                item["id"] = idx
                item["filename"] = fname
                item["university"] = info["university"]
                item["has_references"] = info["has_references"]
                item["preview"] = info["preview"]
                collected.append(item)
                seen_sha256.add(item["sha256"])
                if item.get("source_url"):
                    seen_urls.add(item["source_url"])
                if item.get("blob_sha"):
                    seen_blob_shas.add(item["blob_sha"])

            manifest_path.write_text(json.dumps(collected, ensure_ascii=False, indent=2), encoding="utf-8")
            print(f"Retained {len(collected)} verified student theses/projects in {out_dir}", flush=True)
        except Exception as e:
            print(f"Warning auditing existing manifest: {e}", flush=True)

    def save_record(meta: dict, pdf_bytes: bytes, info: dict, blob_sha: str = "") -> bool:
        sha = hashlib.sha256(pdf_bytes).hexdigest()
        if sha in seen_sha256:
            return False
        seen_sha256.add(sha)
        if blob_sha:
            seen_blob_shas.add(blob_sha)
        if meta.get("source_url"):
            seen_urls.add(meta["source_url"])

        idx = len(collected) + 1
        uni = info["university"].lower()
        slug = slugify(meta.get("title") or "thesis")
        fname = f"{idx:03d}_{uni}_{slug}.pdf"
        (out_dir / fname).write_bytes(pdf_bytes)

        rec = {
            "id": idx,
            "filename": fname,
            "university": info["university"],
            "source_type": meta["source_type"],
            "title": meta.get("title", ""),
            "author": meta.get("author", ""),
            "category": meta.get("category", ""),
            "source_url": meta.get("source_url", ""),
            "size_kb": len(pdf_bytes) // 1024,
            "num_pages": info["num_pages"],
            "has_references": info["has_references"],
            "preview": info["preview"],
            "sha256": sha,
        }
        if blob_sha:
            rec["blob_sha"] = blob_sha
        collected.append(rec)

        ref_tag = "+Refs" if info["has_references"] else "     "
        print(
            f"[{len(collected):03d}/{args.n:03d}] [{info['university']:12s}] [{ref_tag}] "
            f"{fname} ({info['num_pages']}p, {rec['size_kb']}KB)",
            flush=True,
        )
        manifest_path.write_text(json.dumps(collected, ensure_ascii=False, indent=2), encoding="utf-8")
        return True

    # Phase 1: Collect from DUE DSpace (University of Economics - University of Da Nang)
    due_count = sum(1 for r in collected if r.get("source_type") == "dspace_due_udn")
    if len(collected) < args.n and due_count < args.max_due:
        print("\n=== Phase 1: Harvesting from DUE DSpace (thuvien.due.udn.vn:8080/dspace) ===", flush=True)
        due_cands = collect_due_dspace_candidates(max_items=args.max_due * 2)
        print(f"Found {len(due_cands)} candidate thesis handles on DUE DSpace.", flush=True)

        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex:
            futures = [ex.submit(download_due_item, c) for c in due_cands]
            for fut in concurrent.futures.as_completed(futures):
                if len(collected) >= args.n or due_count >= args.max_due:
                    break
                res = fut.result()
                if not res:
                    continue
                meta, pdf_bytes, info = res
                if save_record(meta, pdf_bytes, info):
                    due_count += 1

    # Phase 2: Collect from Vietnamese Universities on GitHub (UIT, HCMUT, HCMUS, HUST, PTIT, HCMUTE, UEH, FPTU, TDTU...)
    if len(collected) < args.n:
        print("\n=== Phase 2: Harvesting Student Theses/Projects across VN Universities (GitHub) ===", flush=True)
        token = get_github_token()
        gh_session = requests.Session()
        gh_session.headers.update({
            "Accept": "application/vnd.github+json",
            "User-Agent": "EssayIntegrityChecker-DatasetCollector/2.0",
        })
        if token:
            gh_session.headers["Authorization"] = f"Bearer {token}"
            print("✓ Authenticated with GitHub API token", flush=True)

        def process_repo(repo_obj: dict) -> None:
            if len(collected) >= args.n:
                return
            full_name = repo_obj.get("full_name")
            if not full_name or full_name in seen_repos or repo_obj.get("fork"):
                return
            if EXCLUDE_REPO_OR_PATH_RE.search(full_name):
                return
            seen_repos.add(full_name)

            branch = repo_obj.get("default_branch") or "main"
            tree_data = api_get(
                gh_session,
                f"{GITHUB_API}/repos/{full_name}/git/trees/{quote(branch, safe='')}?recursive=1",
            )
            if not isinstance(tree_data, dict):
                return
            tree = tree_data.get("tree", [])
            if not isinstance(tree, list):
                return

            # Strictly 1 thesis/report per repository to maximize student & topic diversity
            for node in tree:
                if len(collected) >= args.n:
                    break
                if node.get("type") != "blob":
                    continue
                path = node.get("path", "")
                size = node.get("size", 0) or 0
                blob_sha = node.get("sha", "")

                if not path.lower().endswith(".pdf"):
                    continue
                if size < 120_000 or size > 28_000_000:
                    continue
                if blob_sha and blob_sha in seen_blob_shas:
                    continue
                if EXCLUDE_REPO_OR_PATH_RE.search(path):
                    continue
                if not (INCLUDE_PATH_RE.search(path) or INCLUDE_PATH_RE.search(full_name)):
                    continue

                pdf_bytes = download_github_raw(gh_session, full_name, branch, path)
                if not pdf_bytes:
                    continue

                info = inspect_pdf_bytes(
                    pdf_bytes,
                    title_or_path_hint=f"{full_name}/{path}",
                    min_pages=6,
                    max_pages=260,
                    require_uni_header=True,
                )
                if not info:
                    if blob_sha:
                        seen_blob_shas.add(blob_sha)
                    continue

                meta = {
                    "source_type": "github_vn_uni_thesis",
                    "title": f"{full_name.split('/')[-1]}_{Path(path).stem}",
                    "author": full_name.split("/")[0],
                    "category": "Khóa luận / Đồ án / Tiểu luận ĐH Việt Nam",
                    "source_url": f"{RAW_GITHUB}/{full_name}/{branch}/{path}",
                }
                if save_record(meta, pdf_bytes, info, blob_sha=blob_sha):
                    break  # Move to next repo after saving 1 verified thesis

        for query in GITHUB_THESIS_QUERIES:
            if len(collected) >= args.n:
                break
            print(f"\n--- Querying GitHub: '{query}' ---", flush=True)
            for page in (1, 2):
                if len(collected) >= args.n:
                    break
                data = api_get(
                    gh_session,
                    f"{GITHUB_API}/search/repositories",
                    params={"q": query, "per_page": 50, "page": page},
                )
                if not isinstance(data, dict):
                    break
                items = data.get("items", [])
                if not items:
                    break
                for repo_obj in items:
                    if len(collected) >= args.n:
                        break
                    process_repo(repo_obj)
                if len(items) < 50:
                    break

    # Summary statistics by university
    uni_counts: dict[str, int] = {}
    for r in collected:
        u = r.get("university", "VN_UNI")
        uni_counts[u] = uni_counts.get(u, 0) + 1

    print("\n" + "=" * 70, flush=True)
    print(f"Done! Collected {len(collected)} PDFs into {out_dir}/", flush=True)
    print("Breakdown by University:", flush=True)
    for u, c in sorted(uni_counts.items(), key=lambda x: -x[1]):
        print(f"  - {u:15s}: {c} PDFs", flush=True)
    print(f"Manifest saved to: {manifest_path}", flush=True)
    print("=" * 70, flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
