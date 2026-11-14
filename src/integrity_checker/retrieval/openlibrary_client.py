"""OpenLibrary + Google Books API client — Academic books, textbooks, O'Reilly/monographs.

Docs:
    - OpenLibrary: https://openlibrary.org/dev/docs/api/search
    - Google Books: https://developers.google.com/books/docs/v1/using
No API key required. Resolves ISBNs, multi-edition textbooks (e.g., O'Reilly,
Pearson, Wiley, Springer, Cambridge/MIT/Oxford Press), and edition publication years.
"""

from __future__ import annotations

import asyncio
import os
import re
import weakref
from typing import Any

import httpx
from tenacity import (
    AsyncRetrying,
    RetryError,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from integrity_checker.config import get_settings
from integrity_checker.logging import get_logger
from integrity_checker.models.citation import Citation
from integrity_checker.models.source import SourceCandidate
from integrity_checker.retrieval.base import BaseScholarClient
from integrity_checker.retrieval.normalization import (
    author_key,
    author_match_score,
    title_similarity,
    title_tokens,
)

logger = get_logger(__name__)

MIN_TITLE_SIMILARITY = 0.60

_EDITION_SUFFIX_RE = re.compile(
    r"(?:[,\s—–-]+|\s*\()?(?:\d+(?:st|nd|rd|th)|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|revised|updated|international)\s+(?:ed\.?|edn\.?|edition)(?:\)|\s*,\s*[A-ZÀ-Ỹ][^:]{1,45}:\s*[^.]{2,80})?\.?$",
    re.IGNORECASE,
)
_ISBN_RE = re.compile(
    r"\b(?:ISBN(?:-1[03])?\s*[:\s]?\s*)?(97[89][-\s]?(?:\d[-\s]?){9}\d|(?:\d[-\s]?){9}[\dXx])\b",
    re.IGNORECASE,
)

_OPENLIB_LOOP_SEMS: weakref.WeakKeyDictionary[
    asyncio.AbstractEventLoop, asyncio.Semaphore
] = weakref.WeakKeyDictionary()


def _get_openlib_sem() -> asyncio.Semaphore:
    loop = asyncio.get_running_loop()
    sem = _OPENLIB_LOOP_SEMS.get(loop)
    if sem is None:
        sem = asyncio.Semaphore(3)
        _OPENLIB_LOOP_SEMS[loop] = sem
    return sem


class OpenLibraryClient(BaseScholarClient):
    """OpenLibrary + Google Books fallback client for books and multi-edition textbooks."""

    BASE_URL = "https://openlibrary.org/search.json"
    GOOGLE_BOOKS_URL = "https://www.googleapis.com/books/v1/volumes"
    name = "openlibrary"

    def __init__(
        self,
        contact_email: str | None = None,
        timeout: float = 8.0,
        max_retries: int | None = None,
        enable_google_books_fallback: bool = True,
    ) -> None:
        super().__init__(timeout=timeout)
        settings = get_settings()
        self.contact_email = (
            contact_email
            or os.getenv("CONTACT_EMAIL", "")
            or settings.contact_email
            or settings.retrieval.contact_email
        )
        self.max_retries = max_retries or min(settings.retrieval.retry.max_attempts, 2)
        self._backoff = settings.retrieval.retry.backoff
        self.enable_google_books_fallback = enable_google_books_fallback
        self._google_books_rate_limited_until: float = 0.0
        self._last_status_code: int | None = None
        self._headers = {
            "User-Agent": (
                f"EssayIntegrityChecker/0.2 (mailto:{self.contact_email})"
                if self.contact_email
                else "EssayIntegrityChecker/0.2"
            ),
            "Accept": "application/json",
        }

    @classmethod
    def strip_edition_suffix(cls, title: str) -> str:
        """Strip trailing ', 5th Edition' / '(7th ed.)' from a book title."""
        cleaned = (title or "").strip()
        cleaned = _EDITION_SUFFIX_RE.sub("", cleaned).strip(" ,.;:-–—()")
        return cleaned or (title or "").strip()

    @classmethod
    def extract_isbn(cls, citation: Citation) -> str | None:
        """Extract normalized 10 or 13 digit ISBN from citation raw_text or venue."""
        for text in (citation.raw_text or "", citation.venue or "", citation.url or ""):
            if not text or ("isbn" not in text.lower() and not re.search(r"\b97[89][-\s\d]{10,16}\b", text)):
                continue
            m = _ISBN_RE.search(text)
            if m:
                isbn_clean = re.sub(r"[-\s]", "", m.group(1)).upper()
                if len(isbn_clean) in (10, 13):
                    return isbn_clean
        return None

    @staticmethod
    def _extract_ol_author_query(citation: Citation) -> str:
        """Extract clean first-author surname preserving apostrophes (e.g. O'Dowd, L'Engle)."""
        if not citation.authors:
            return ""
        raw = citation.authors[0]
        if hasattr(raw, "last_name") and getattr(raw, "last_name", ""):
            s = str(getattr(raw, "last_name", ""))
        else:
            s = str(raw)
        s = s.replace("\u2019", "'").replace("\u2018", "'").replace("`", "'").strip()
        if "," in s:
            first_part = s.split(",", 1)[0].strip()
            if first_part.lower().rstrip(".") not in {"iii", "ii", "iv", "jr", "sr"}:
                s = first_part
            else:
                s = s.split(",", 1)[1].strip()
        tokens = [
            t.strip(".,;:")
            for t in s.split()
            if t.strip(".,;:").lower() not in {"iii", "ii", "iv", "jr", "sr", "et", "al"}
            and len(t.strip(".,;:")) > 1
        ]
        return tokens[-1] if tokens else author_key(raw)

    async def lookup(self, citation: Citation) -> SourceCandidate:
        """Search OpenLibrary (and Google Books fallback) for book/monograph citations."""
        self._last_status_code = None

        raw_title = (citation.title or "").strip()
        clean_title = self.strip_edition_suffix(raw_title)
        title_for_ol = re.sub(r"\s*&\s*", " and ", clean_title)
        isbn = self.extract_isbn(citation)

        if not clean_title and not isbn:
            return SourceCandidate(
                source_name=self.name,
                found=False,
                error="OpenLibrary: no title or ISBN for book lookup",
            )

        candidates: list[SourceCandidate] = []
        base_fields = (
            "key,title,subtitle,author_name,first_publish_year,"
            "publish_year,isbn,publisher,first_sentence,subject"
        )
        surname = self._extract_ol_author_query(citation)

        async def _run_ol_query(params: dict[str, Any]) -> list[dict]:
            data = await self._fetch_json_with_retry(self.BASE_URL, params=params)
            if data and isinstance(data.get("docs"), list):
                return [d for d in data["docs"] if isinstance(d, dict)]
            return []

        docs: list[dict] = []
        if isbn:
            docs = await _run_ol_query({"limit": 5, "fields": base_fields, "isbn": isbn})
        else:
            q_clean = re.sub(r"[-–—]+", " ", title_for_ol)
            q_str = f"{q_clean} {surname}".strip() if surname else q_clean
            docs = await _run_ol_query({"limit": 5, "fields": base_fields, "q": q_str})

            # If q missed or didn't match author (e.g. short title like "Proverbs" or colon-split title),
            # try structured title + author search
            temp_cands = [self._doc_to_candidate(d, citation=citation) for d in docs]
            temp_best, temp_sim = self._select_best_candidate(temp_cands, citation)
            temp_auth_ok = (
                not citation.authors
                or (temp_best is not None and author_match_score(citation.authors, temp_best.authors) > 0.0)
            )
            if (temp_sim < MIN_TITLE_SIMILARITY or not temp_auth_ok) and surname and title_for_ol:
                title_queries = [title_for_ol]
                if ":" in title_for_ol:
                    before_colon, after_colon = [p.strip() for p in title_for_ol.split(":", 1)]
                    if (
                        surname
                        and surname.lower() in before_colon.lower()
                        and len(before_colon.split()) <= 4
                    ):
                        if len(after_colon) >= 8:
                            title_queries.insert(0, after_colon)
                    else:
                        if len(before_colon) >= 8:
                            title_queries.append(before_colon)
                        if len(after_colon) >= 8:
                            title_queries.append(after_colon)
                for tq in title_queries:
                    more_docs = await _run_ol_query(
                        {"limit": 5, "fields": base_fields, "title": tq, "author": surname}
                    )
                    if more_docs:
                        docs.extend(more_docs)
                        temp_cands = [self._doc_to_candidate(d, citation=citation) for d in docs]
                        temp_best, temp_sim = self._select_best_candidate(temp_cands, citation)
                        if (
                            temp_sim >= MIN_TITLE_SIMILARITY
                            and temp_best is not None
                            and author_match_score(citation.authors, temp_best.authors) > 0.0
                        ):
                            break

            if not docs and surname and title_for_ol:
                docs = await _run_ol_query({"limit": 5, "fields": base_fields, "q": title_for_ol})

        for doc in docs:
            cand = self._doc_to_candidate(doc, citation=citation)
            if cand.title:
                candidates.append(cand)

        # Check best OpenLibrary similarity before deciding whether to call Google Books
        best_cand, best_sim = self._select_best_candidate(candidates, citation)
        best_auth_ok = (
            not citation.authors
            or (best_cand is not None and author_match_score(citation.authors, best_cand.authors) > 0.0)
        )

        # 2. Google Books fallback when OpenLibrary missed (< MIN_TITLE_SIMILARITY) or author didn't match
        if (
            self.enable_google_books_fallback
            and (best_sim < MIN_TITLE_SIMILARITY or not best_auth_ok)
            and (clean_title or isbn)
        ):
            gb_cands = await self._search_google_books(clean_title, isbn, citation)
            if gb_cands:
                candidates.extend(gb_cands)
                best_cand, best_sim = self._select_best_candidate(candidates, citation)

        if best_cand is None or best_sim < MIN_TITLE_SIMILARITY:
            if self._last_status_code == 429:
                return SourceCandidate(
                    source_name=self.name,
                    found=False,
                    error=f"OpenLibrary: rate limited (429) for '{clean_title[:50]}'",
                )
            return SourceCandidate(
                source_name=self.name,
                found=False,
                error=(
                    f"OpenLibrary: no results above {MIN_TITLE_SIMILARITY:.2f} "
                    f"(best={best_sim:.2f}) for '{clean_title[:60]}'"
                ),
            )

        best_cand.found = True
        best_cand.score = best_sim
        best_cand.confidence = min(0.95, max(0.65, best_sim))
        return best_cand

    @classmethod
    def _select_best_candidate(
        cls,
        candidates: list[SourceCandidate],
        citation: Citation,
    ) -> tuple[SourceCandidate | None, float]:
        if not candidates:
            return None, -1.0

        raw_query_title = re.sub(r"\s*&\s*", " and ", citation.title or "")
        clean_query_title = cls.strip_edition_suffix(raw_query_title)
        cit_year = str(citation.year)[:4] if citation.year else None
        cit_first_author = author_key(citation.authors[0]) if citation.authors else None

        best_cand: SourceCandidate | None = None
        best_sim = -1.0
        best_rank = -1.0

        for cand in candidates:
            if not cand.title:
                continue
            cand_clean_title = re.sub(r"\s*&\s*", " and ", cls.strip_edition_suffix(cand.title))
            sim_raw = title_similarity(raw_query_title, cand.title) if raw_query_title else 0.0
            sim_clean = (
                title_similarity(clean_query_title, cand_clean_title)
                if clean_query_title
                else 0.0
            )
            # Also check base title before/after colon if candidate or query has a subtitle or author prefix
            sim_base = 0.0
            if ":" in cand_clean_title or ":" in clean_query_title:
                cand_base = cand_clean_title.split(":", 1)[0].strip()
                query_parts = [p.strip() for p in clean_query_title.split(":", 1)]
                for idx_qp, qp in enumerate(query_parts):
                    if (
                        idx_qp == 0
                        and len(query_parts) > 1
                        and cit_first_author
                        and cit_first_author in author_key(qp)
                        and len(qp.split()) <= 4
                    ):
                        continue
                    if len(cand_base) >= 8 and len(qp) >= 8:
                        sim_base = max(sim_base, title_similarity(qp, cand_base) * 0.96)

            sim = max(sim_raw, sim_clean, sim_base)
            rank = sim

            if cit_year and cand.year == cit_year:
                rank += 0.04
            if cit_first_author and cand.authors:
                auth_sc = author_match_score(citation.authors, cand.authors)
                if auth_sc > 0.0:
                    rank += 0.08 * auth_sc
                else:
                    if len(title_tokens(clean_query_title)) <= 3:
                        continue
                    rank -= 0.25

            if rank > best_rank:
                best_rank = rank
                best_sim = sim
                best_cand = cand

        return best_cand, best_sim

    @classmethod
    def _doc_to_candidate(
        cls,
        doc: dict[str, Any],
        citation: Citation | None = None,
    ) -> SourceCandidate:
        base_title = str(doc.get("title") or "").strip()
        subtitle = str(doc.get("subtitle") or "").strip()
        full_title = f"{base_title}: {subtitle}" if base_title and subtitle else base_title

        # Choose title representation that best aligns with citation title
        chosen_title = base_title
        if citation and citation.title and full_title != base_title:
            clean_cit = cls.strip_edition_suffix(citation.title)
            if title_similarity(clean_cit, full_title) > title_similarity(clean_cit, base_title):
                chosen_title = full_title

        raw_authors = doc.get("author_name") or []
        authors = [str(a).strip() for a in raw_authors if a and str(a).strip()]

        # Edition-aware year resolution: OpenLibrary provides `publish_year` for all editions!
        cit_year_int: int | None = None
        if citation and citation.year and str(citation.year)[:4].isdigit():
            cit_year_int = int(str(citation.year)[:4])

        pub_years_raw = doc.get("publish_year") or []
        pub_years = sorted(
            {
                int(y)
                for y in pub_years_raw
                if isinstance(y, (int, str)) and str(y).isdigit() and 1800 <= int(y) <= 2030
            }
        )
        first_year = doc.get("first_publish_year")
        if isinstance(first_year, (int, str)) and str(first_year).isdigit():
            fy = int(first_year)
            if fy not in pub_years:
                pub_years.insert(0, fy)

        resolved_year: str | None = None
        if cit_year_int is not None and pub_years:
            # Check exact edition year match first, then ±1 year tolerance
            if cit_year_int in pub_years:
                resolved_year = str(cit_year_int)
            else:
                closest = min(pub_years, key=lambda y: abs(y - cit_year_int))
                if abs(closest - cit_year_int) <= 1:
                    resolved_year = str(closest)

        if resolved_year is None:
            if first_year:
                resolved_year = str(first_year)[:4]
            elif pub_years:
                resolved_year = str(pub_years[-1])

        publishers = doc.get("publisher") or []
        venue = str(publishers[0]).strip() if isinstance(publishers, list) and publishers else None

        key = str(doc.get("key") or "").strip()
        url = f"https://openlibrary.org{key}" if key.startswith("/") else None

        external_ids: dict[str, str] = {}
        if key:
            external_ids["openlibrary"] = key
        isbns = doc.get("isbn") or []
        if isinstance(isbns, list) and isbns:
            external_ids["isbn"] = str(isbns[0])

        # Build concise abstract/description from first_sentence + top subjects when available
        abstract_parts: list[str] = []
        first_sent = doc.get("first_sentence")
        if isinstance(first_sent, list) and first_sent:
            fs_text = str(first_sent[0]).strip()
            if fs_text:
                abstract_parts.append(fs_text)
        elif isinstance(first_sent, str) and first_sent.strip():
            abstract_parts.append(first_sent.strip())

        subjects = doc.get("subject")
        if isinstance(subjects, list) and subjects:
            subj_list = [str(s).strip() for s in subjects[:8] if s and str(s).strip()]
            if subj_list:
                abstract_parts.append(f"Topics and subjects covered: {', '.join(subj_list)}.")

        abstract_str = " ".join(abstract_parts).strip() or None

        return SourceCandidate(
            source_name=cls.name,
            found=False,
            doi=None,
            title=chosen_title or None,
            authors=authors,
            year=resolved_year,
            venue=venue,
            url=url,
            abstract=abstract_str,
            external_ids=external_ids,
        )

    async def _search_google_books(
        self,
        clean_title: str,
        isbn: str | None,
        citation: Citation,
    ) -> list[SourceCandidate]:
        if isbn:
            q = f"isbn:{isbn}"
        else:
            q = f'intitle:"{clean_title}"'
            if citation.authors:
                surname = author_key(citation.authors[0])
                if surname:
                    q += f"+inauthor:{surname}"

        data = await self._fetch_json_with_retry(
            self.GOOGLE_BOOKS_URL,
            params={"q": q, "maxResults": 5},
        )
        items = data.get("items") if isinstance(data, dict) else None
        if not items and not isbn and citation.authors:
            # Retry without strict intitle quotes
            surname = author_key(citation.authors[0]) or ""
            q_fallback = f"{clean_title} {surname}".strip()
            data = await self._fetch_json_with_retry(
                self.GOOGLE_BOOKS_URL,
                params={"q": q_fallback, "maxResults": 5},
            )
            items = data.get("items") if isinstance(data, dict) else None

        if not isinstance(items, list):
            return []

        results: list[SourceCandidate] = []
        for item in items:
            vol = item.get("volumeInfo") if isinstance(item, dict) else None
            if not isinstance(vol, dict):
                continue
            base_title = str(vol.get("title") or "").strip()
            subtitle = str(vol.get("subtitle") or "").strip()
            full_title = f"{base_title}: {subtitle}" if base_title and subtitle else base_title

            chosen_title = base_title
            if citation.title and full_title != base_title:
                clean_cit = self.strip_edition_suffix(citation.title)
                if title_similarity(clean_cit, full_title) > title_similarity(clean_cit, base_title):
                    chosen_title = full_title

            authors = [str(a).strip() for a in (vol.get("authors") or []) if a]
            pub_date = str(vol.get("publishedDate") or "").strip()
            year = pub_date[:4] if len(pub_date) >= 4 and pub_date[:4].isdigit() else None
            publisher = str(vol.get("publisher") or "").strip() or None
            info_link = str(vol.get("infoLink") or "").strip() or None

            ext_ids: dict[str, str] = {}
            if item.get("id"):
                ext_ids["google_books"] = str(item["id"])
            for ident in vol.get("industryIdentifiers") or []:
                if isinstance(ident, dict) and ident.get("identifier"):
                    ext_ids["isbn"] = str(ident["identifier"])
                    break

            desc = str(vol.get("description") or "").strip()
            if not desc:
                cats = vol.get("categories")
                if isinstance(cats, list) and cats:
                    desc = f"Categories: {', '.join(str(c).strip() for c in cats if c)}."

            if chosen_title:
                results.append(
                    SourceCandidate(
                        source_name=self.name,
                        found=False,
                        doi=None,
                        title=chosen_title,
                        authors=authors,
                        year=year,
                        venue=publisher,
                        url=info_link,
                        abstract=desc or None,
                        external_ids=ext_ids,
                    )
                )
        return results

    async def _fetch_json_with_retry(
        self,
        url: str,
        params: dict[str, Any] | None = None,
    ) -> dict[str, Any] | None:
        import random
        import time

        from integrity_checker.retrieval.http_pool import (
            get_shared_http_client,
            parse_retry_after,
        )

        sem = _get_openlib_sem()
        is_google_books = url == self.GOOGLE_BOOKS_URL
        now_mono = time.monotonic()
        if is_google_books and now_mono < self._google_books_rate_limited_until:
            return None

        seen_429 = 0
        retryer = AsyncRetrying(
            stop=stop_after_attempt(1 if is_google_books else min(self.max_retries, 2)),
            wait=wait_exponential(
                multiplier=self._backoff.multiplier,
                min=min(self._backoff.initial_seconds, 1.0),
                max=min(self._backoff.max_seconds, 6.0),
            ),
            retry=retry_if_exception_type((httpx.RequestError, httpx.HTTPStatusError)),
            reraise=False,
        )
        try:
            async for attempt in retryer:
                with attempt:
                    async with sem:
                        client = get_shared_http_client(follow_redirects=True)
                        resp = await client.get(
                            url,
                            params=params,
                            headers=self._headers,
                            timeout=self.timeout,
                        )
                        retry_after = None
                        if not is_google_books:
                            retry_after = self._record_http_response(resp)
                        if resp.status_code == 404:
                            return None
                        if is_google_books and resp.status_code == 429:
                            gb_ra = parse_retry_after(getattr(resp, "headers", None)) or 60.0
                            self._google_books_rate_limited_until = time.monotonic() + gb_ra
                            logger.debug("Google Books fallback rate limited (429); skipping fallback")
                            return None
                        if resp.status_code == 429:
                            seen_429 += 1
                            if seen_429 >= 2 or (retry_after is not None and retry_after > 3.0):
                                return None
                            await asyncio.sleep(
                                (retry_after or random.uniform(0.6, 1.2))
                                + random.uniform(0.05, 0.25)
                            )
                        if resp.status_code == 429 or resp.status_code >= 500:
                            if getattr(resp, "_request", None) is None:
                                resp._request = httpx.Request("GET", url)
                            resp.raise_for_status()
                        if resp.status_code != 200:
                            return None
                        return resp.json()
        except RetryError as exc:
            if not is_google_books:
                self._record_transport_error(exc)
            logger.warning(f"OpenLibrary retry exhausted: {exc}")
            return None
        except Exception as exc:  # noqa: BLE001
            if not is_google_books:
                self._record_transport_error(exc)
            logger.warning(f"OpenLibrary error: {exc}")
            return None
        return None
