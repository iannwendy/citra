#!/usr/bin/env python3
"""
Collect 30 real Vietnamese student essays, reports, theses, and legal research articles (PDFs)
that cite Vietnamese legal documents (Hiến pháp, Bộ luật, Luật, Nghị định, Thông tư, Quyết định, Nghị quyết)
and have an explicit bibliography/reference section header (TÀI LIỆU THAM KHẢO / DANH MỤC TÀI LIỆU THAM KHẢO / REFERENCES).

Usage:
    .venv/bin/python -u scripts/collect_dataset/collect_vn_legal_reports.py \
        --output vn_legal_reports \
        --n 30
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
import unicodedata
from pathlib import Path
from urllib.parse import quote

import fitz  # PyMuPDF
import requests
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

GITHUB_API = "https://api.github.com"
RAW_GITHUB = "https://raw.githubusercontent.com"
OPENALEX_API = "https://api.openalex.org/works"

EXCLUDE_TITLE_OR_PATH_RE = re.compile(
    r"(trac[_-]?nghiem|trắc\s+nghiệm|quiz|cau[_-]?hoi|câu\s+hỏi|dap[_-]?an|đáp\s+án|"
    r"on[_-]?tap|ôn\s+tập|de[_-]?cuong|đề\s+cương|slide|bai[_-]?giang|bài\s+giảng|giao[_-]?trinh)",
    re.IGNORECASE,
)

VN_LEGAL_SIGNAL_RE = re.compile(
    r"("
    r"Hiến\s+pháp\s+(?:năm\s+)?(?:1992|2013)"
    r"|Bộ\s+luật\s+(?:Dân\s+sự|Hình\s+sự|Lao\s+động|Tố\s+tụng\s+dân\s+sự|Tố\s+tụng\s+hình\s+sự|Hàng\s+hải)"
    r"|Luật\s+số\s*:?\s*\d+/\d{4}/QH\d+"
    r"|\b\d+/\d{4}/QH\d+\b"
    r"|Nghị\s+định\s+(?:số\s*)?\d+/\d{4}/NĐ-CP"
    r"|Thông\s+tư\s+(?:liên\s+tịch\s+)?(?:số\s*)?\d+/\d{4}/TT(?:LT)?-[A-ZĐ]+"
    r"|Quyết\s+định\s+(?:số\s*)?\d+/(?:\d{4}/)?QĐ-[A-ZĐa-z]+"
    r"|Nghị\s+quyết\s+(?:số\s*)?\d+/(?:\d{4}/)?NQ-[A-ZĐa-z]+"
    r"|Luật\s+(?:Doanh\s+nghiệp|Đất\s+đai|Đầu\s+tư|Thương\s+mại|Sở\s+hữu\s+trí\s+tuệ"
    r"|Bảo\s+vệ\s+quyền\s+lợi\s+người\s+tiêu\s+dùng|Cạnh\s+tranh|Phá\s+sản|Trọng\s+tài\s+thương\s+mại"
    r"|Bảo\s+vệ\s+môi\s+trường|An\s+ninh\s+mạng|Giao\s+dịch\s+điện\s+tử|Các\s+tổ\s+chức\s+tín\s+dụng"
    r"|Chứng\s+khoán|Kinh\s+doanh\s+bất\s+động\s+sản|Nhà\s+ở|Hôn\s+nhân\s+và\s+gia\s+đình"
    r"|Kế\s+toán|Kiểm\s+toán|Quản\s+lý\s+thuế|Thuế\s+thu\s+nhập\s+doanh\s+nghiệp)\s*(?:năm\s+)?(?:19|20)?\d{0,2}"
    r")",
    re.IGNORECASE,
)

VN_ARTICLE_CLAUSE_RE = re.compile(
    r"\b(?:Điều|Khoản)\s+\d+\s+(?:Bộ\s+luật|Luật|Nghị\s+định|Thông\s+tư)",
    re.IGNORECASE,
)

# Standalone Bibliography / References section header line
REF_HEADER_LINE_RE = re.compile(
    r"^\s*(?:(?:\d+|I{1,3}|IV|V|VI{0,3})[\.\)]\s*)?("
    r"tài\s+liệu\s+tham\s+khảo|danh\s+mục\s+tài\s+liệu(?:\s+tham\s+khảo)?"
    r"|danh\s+mục\s+tham\s+khảo|tài\s+liệu\s+trích\s+dẫn|references|bibliography"
    r")\s*[:.]?\s*$",
    re.IGNORECASE | re.MULTILINE,
)

VN_DIACRITIC_RE = re.compile(
    r"[àáảãạăắằẳẵặâấầẩẫậđèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵ]",
    re.IGNORECASE,
)

OPENALEX_QUERIES = [
    "pháp luật Việt Nam Luật Doanh nghiệp",
    "Bộ luật Dân sự pháp luật Việt Nam",
    "Bộ luật Lao động pháp luật Việt Nam",
    "Luật Đất đai pháp luật Việt Nam",
    "Luật Sở hữu trí tuệ pháp luật Việt Nam",
    "Luật Thương mại hợp đồng pháp luật Việt Nam",
    "Luật Đầu tư pháp luật Việt Nam",
    "Luật Bảo vệ quyền lợi người tiêu dùng Việt Nam",
    "Luật Cạnh tranh pháp luật Việt Nam",
    "Luật Phá sản doanh nghiệp Việt Nam",
    "Nghị định Thông tư pháp luật Việt Nam",
    "bảo vệ dữ liệu cá nhân pháp luật Việt Nam",
    "Bộ luật Hình sự pháp luật Việt Nam",
    "Bộ luật Tố tụng dân sự pháp luật Việt Nam",
    "Luật Trọng tài thương mại Việt Nam",
    "Luật Bảo vệ môi trường pháp luật Việt Nam",
    "Luật An ninh mạng pháp luật Việt Nam",
    "Luật Giao dịch điện tử hợp đồng điện tử Việt Nam",
    "Luật Các tổ chức tín dụng ngân hàng Việt Nam",
    "Luật Chứng khoán trái phiếu doanh nghiệp Việt Nam",
    "Luật Kinh doanh bất động sản Nhà ở Việt Nam",
    "Luật Hôn nhân và gia đình pháp luật Việt Nam",
    "văn bản quy phạm pháp luật Việt Nam",
    "trách nhiệm bồi thường thiệt hại pháp luật Việt Nam",
    "xử phạt vi phạm hành chính pháp luật Việt Nam",
    "hợp đồng lao động pháp luật Việt Nam",
    "quyền sử dụng đất pháp luật Việt Nam",
    "quản trị công ty cổ phần Luật Doanh nghiệp",
    "pháp luật về thương mại điện tử Việt Nam",
    "pháp luật về bảo hiểm xã hội Việt Nam",
    "pháp luật về đấu thầu đầu tư công Việt Nam",
    "pháp luật về giải quyết tranh chấp thương mại",
]


def inspect_vn_legal_pdf(pdf_bytes: bytes, title_hint: str = "", min_pages: int = 4, max_pages: int = 120) -> dict | None:
    """Verify PDF is a real Vietnamese legal paper/essay/report with legal citations and a real reference section."""
    if not pdf_bytes or not pdf_bytes.startswith(b"%PDF"):
        return None
    if EXCLUDE_TITLE_OR_PATH_RE.search(title_hint or ""):
        return None
    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    except Exception:
        return None

    try:
        if doc.is_encrypted or len(doc) < min_pages or len(doc) > max_pages:
            return None

        num_pages = len(doc)
        landscape = sum(
            1 for i in range(min(5, num_pages))
            if doc[i].rect.width > doc[i].rect.height * 1.15
        )
        if landscape >= 3:
            return None

        full_text = "\n".join(doc[i].get_text("text") for i in range(num_pages))
        if len(full_text.strip()) < 2500:
            return None

        p1_text = doc[0].get_text("text")
        if EXCLUDE_TITLE_OR_PATH_RE.search(p1_text[:600]):
            return None

        if len(VN_DIACRITIC_RE.findall(full_text[:4000])) < 30:
            return None

        legal_matches = VN_LEGAL_SIGNAL_RE.findall(full_text)
        article_matches = VN_ARTICLE_CLAUSE_RE.findall(full_text)
        unique_legal = sorted(set(re.sub(r"\s+", " ", m.strip()) for m in legal_matches))

        if len(legal_matches) + len(article_matches) < 3:
            return None

        # Must have a real standalone bibliography header in the second half of the document
        second_half_text = "\n".join(
            doc[i].get_text("text") for i in range(max(0, num_pages // 2 - 1), num_pages)
        )
        has_references = bool(REF_HEADER_LINE_RE.search(second_half_text))
        if not has_references:
            return None

        p1_lines = [line.strip() for line in p1_text.splitlines() if line.strip()]
        preview = " | ".join(p1_lines[:8])[:250]

        return {
            "num_pages": num_pages,
            "legal_mention_count": len(legal_matches) + len(article_matches),
            "unique_legal_signals": unique_legal[:15],
            "has_references": has_references,
            "preview": preview,
        }
    finally:
        doc.close()


def download_pdf_url(url: str, timeout: int = 18) -> bytes | None:
    if not url:
        return None
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
        ),
        "Accept": "application/pdf,application/octet-stream,*/*",
    }
    for verify_ssl in (True, False):
        try:
            resp = requests.get(
                url,
                headers=headers,
                timeout=timeout,
                allow_redirects=True,
                verify=verify_ssl,
            )
            if resp.status_code == 200 and resp.content.startswith(b"%PDF"):
                return resp.content
            if resp.status_code == 200 and b"/article/download/" in resp.content:
                m = re.search(rb'https?://[^\s"\'<>]+/article/download/\d+/\d+', resp.content)
                if m:
                    dl_url = m.group(0).decode("utf-8", errors="ignore")
                    resp2 = requests.get(dl_url, headers=headers, timeout=timeout, verify=verify_ssl)
                    if resp2.status_code == 200 and resp2.content.startswith(b"%PDF"):
                        return resp2.content
        except requests.exceptions.SSLError:
            continue
        except Exception:
            break
    return None


def slugify(text: str, max_len: int = 75) -> str:
    text = text.replace("đ", "d").replace("Đ", "D")
    nfkd = unicodedata.normalize("NFKD", text)
    ascii_str = "".join(c for c in nfkd if not unicodedata.combining(c))
    slug = re.sub(r"[^a-zA-Z0-9]+", "_", ascii_str).strip("_")
    return slug[:max_len] or "vn_legal_doc"


def fetch_openalex_query(q: str) -> list[dict]:
    out: list[dict] = []
    try:
        resp = requests.get(
            OPENALEX_API,
            params={"search": q, "filter": "is_oa:true", "per-page": 40},
            headers={"User-Agent": "EssayIntegrityChecker/2.1"},
            timeout=15,
        )
        if resp.status_code != 200:
            return out
        for w in resp.json().get("results", []):
            urls_to_try = []
            best_oa = w.get("best_oa_location") or {}
            if best_oa.get("pdf_url"):
                urls_to_try.append(best_oa["pdf_url"])
            oa = w.get("open_access") or {}
            if oa.get("oa_url"):
                urls_to_try.append(oa["oa_url"])
            for loc in w.get("locations") or []:
                if loc.get("pdf_url"):
                    urls_to_try.append(loc["pdf_url"])
            if best_oa.get("landing_page_url"):
                urls_to_try.append(best_oa["landing_page_url"])

            for u in urls_to_try:
                if not u or "doaj.org/article/" in u:
                    continue
                out.append({
                    "source_type": "openalex_vn_journal",
                    "title": w.get("title") or "vn_legal_paper",
                    "url": u,
                    "openalex_id": w.get("id"),
                    "year": w.get("publication_year"),
                })
                break
    except Exception:
        pass
    return out


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--output", "-o", default="vn_legal_reports")
    p.add_argument("--n", type=int, default=30)
    args = p.parse_args()

    out_dir = Path(args.output)
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = out_dir / "metadata.json"

    # Re-validate existing PDFs and remove any quiz/multiple-choice files
    collected: list[dict] = []
    seen_sha256: set[str] = set()
    seen_urls: set[str] = set()

    if manifest_path.exists():
        try:
            existing = json.loads(manifest_path.read_text(encoding="utf-8"))
            valid_items = []
            for item in existing:
                fpath = out_dir / item["filename"]
                if not fpath.exists():
                    continue
                pdf_bytes = fpath.read_bytes()
                info = inspect_vn_legal_pdf(pdf_bytes, title_hint=item.get("title", "") + " " + item["filename"])
                if not info:
                    print(f"Removing non-essay/quiz file: {item['filename']}", flush=True)
                    fpath.unlink(missing_ok=True)
                    continue
                valid_items.append((item, pdf_bytes, info))

            # Renumber valid items sequentially 001..N
            for item, _b, _i in valid_items:
                (out_dir / item["filename"]).unlink(missing_ok=True)

            for idx, (item, pdf_bytes, info) in enumerate(valid_items, start=1):
                slug = slugify(item.get("title") or "vn_legal")
                fname = f"{idx:03d}_vn_legal_{slug}.pdf"
                (out_dir / fname).write_bytes(pdf_bytes)
                item["id"] = idx
                item["filename"] = fname
                item["legal_mention_count"] = info["legal_mention_count"]
                item["unique_legal_signals"] = info["unique_legal_signals"]
                collected.append(item)
                seen_sha256.add(item["sha256"])
                if item.get("source_url"):
                    seen_urls.add(item["source_url"])

            manifest_path.write_text(json.dumps(collected, ensure_ascii=False, indent=2), encoding="utf-8")
            print(f"Retained {len(collected)} verified Vietnamese legal essays/papers in {out_dir}", flush=True)
        except Exception as e:
            print(f"Error checking existing manifest: {e}", flush=True)

    if len(collected) >= args.n:
        print(f"Already have {len(collected)} PDFs (target={args.n}).", flush=True)
        return 0

    print("Fetching candidate URLs in parallel from OpenAlex...", flush=True)
    all_candidates: list[dict] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as ex:
        oa_lists = list(ex.map(fetch_openalex_query, OPENALEX_QUERIES))
    for lst in oa_lists:
        for c in lst:
            if c["url"] not in seen_urls:
                seen_urls.add(c["url"])
                all_candidates.append(c)

    print(f"Total unique candidate PDFs to inspect: {len(all_candidates)}", flush=True)

    def check_candidate(cand: dict) -> tuple[dict, bytes, dict] | None:
        pdf_bytes = download_pdf_url(cand["url"])
        if not pdf_bytes:
            return None
        info = inspect_vn_legal_pdf(pdf_bytes, title_hint=cand.get("title", ""))
        if not info:
            return None
        return (cand, pdf_bytes, info)

    batch_size = 20
    for start in range(0, len(all_candidates), batch_size):
        if len(collected) >= args.n:
            break
        batch = all_candidates[start : start + batch_size]
        with concurrent.futures.ThreadPoolExecutor(max_workers=10) as ex:
            futures = [ex.submit(check_candidate, c) for c in batch]
            for fut in concurrent.futures.as_completed(futures):
                if len(collected) >= args.n:
                    break
                res = fut.result()
                if not res:
                    continue
                cand, pdf_bytes, info = res
                sha = hashlib.sha256(pdf_bytes).hexdigest()
                if sha in seen_sha256:
                    continue
                seen_sha256.add(sha)

                idx = len(collected) + 1
                slug = slugify(cand.get("title") or "vn_legal")
                fname = f"{idx:03d}_vn_legal_{slug}.pdf"
                (out_dir / fname).write_bytes(pdf_bytes)

                record = {
                    "id": idx,
                    "filename": fname,
                    "source_type": cand["source_type"],
                    "title": cand.get("title"),
                    "source_url": cand["url"],
                    "year": cand.get("year"),
                    "size_kb": len(pdf_bytes) // 1024,
                    "num_pages": info["num_pages"],
                    "legal_mention_count": info["legal_mention_count"],
                    "unique_legal_signals": info["unique_legal_signals"],
                    "has_references": info["has_references"],
                    "preview": info["preview"],
                    "sha256": sha,
                }
                collected.append(record)
                print(
                    f"[{len(collected):02d}/{args.n:02d}] {fname} "
                    f"({info['num_pages']}p, {record['size_kb']}KB, "
                    f"legal_refs={info['legal_mention_count']}, signals={info['unique_legal_signals'][:3]})",
                    flush=True,
                )
                manifest_path.write_text(
                    json.dumps(collected, ensure_ascii=False, indent=2),
                    encoding="utf-8",
                )

    print(f"\nDone! Collected {len(collected)} real Vietnamese legal PDFs in {out_dir}/", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
