"""Europe PMC / PubMed REST API client — Biomedical, Clinical, Psychology & Health sciences.

Docs: https://europepmc.org/RestfulWebService
Endpoint: https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=...&format=json
No API key required. High rate limit and full metadata + abstracts for PubMed/MEDLINE,
PMC, WHO/clinical guidelines, psychology, psychiatry, and life sciences.
"""

from __future__ import annotations

import html
import os
import re
import time
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
    normalize_doi,
    title_similarity,
    title_tokens,
)

logger = get_logger(__name__)

MIN_TITLE_SIMILARITY = 0.55
_HTML_TAG_RE = re.compile(r"<[^>]+>")
_LUCENE_STOPWORDS = frozenset({
    "and", "or", "not", "the", "for", "with", "from", "into",
    "via", "over", "under", "using", "between", "about", "through",
})


class EuropePMCClient(BaseScholarClient):
    """Europe PMC REST API client for PubMed, PMC, psychology, and life science papers."""

    BASE_URL = "https://www.ebi.ac.uk/europepmc/webservices/rest/search"
    name = "europepmc"
    _backoff_until: float = 0.0

    def __init__(
        self,
        contact_email: str | None = None,
        timeout: float = 12.0,
        max_retries: int | None = None,
    ) -> None:
        super().__init__(timeout=timeout)
        settings = get_settings()
        self.contact_email = (
            contact_email
            or os.getenv("CONTACT_EMAIL", "")
            or settings.contact_email
            or settings.retrieval.contact_email
        )
        self.max_retries = max_retries or min(settings.retrieval.retry.max_attempts, 3)
        self._backoff = settings.retrieval.retry.backoff
        self._last_status_code: int | None = None
        EuropePMCClient._backoff_until = 0.0
        self._headers = {
            "User-Agent": (
                f"EssayIntegrityChecker/0.2 (mailto:{self.contact_email})"
                if self.contact_email
                else "EssayIntegrityChecker/0.2"
            ),
            "Accept": "application/json",
        }

    async def lookup(self, citation: Citation) -> SourceCandidate:
        """Lookup by exact DOI first; fallback to TITLE search."""
        self._last_status_code = None

        # 1. DOI exact lookup
        if citation.doi:
            doi_norm = normalize_doi(citation.doi)
            if doi_norm:
                by_doi = await self._lookup_by_doi(doi_norm, citation=citation)
                if by_doi and by_doi.found:
                    return by_doi
                if self._last_status_code == 429:
                    return SourceCandidate(
                        source_name=self.name,
                        found=False,
                        error=f"EuropePMC: rate limited (429) for DOI '{doi_norm}'",
                    )

        # 2. Title search
        return await self._lookup_by_title(citation)

    async def _lookup_by_doi(
        self,
        doi: str,
        citation: Citation | None = None,
    ) -> SourceCandidate | None:
        params = {
            "query": f'DOI:"{doi}"',
            "resultType": "core",
            "pageSize": 1,
            "format": "json",
        }
        data = await self._fetch_json_with_retry(params)
        results = self._extract_results(data)
        if not results:
            return None
        cand = self._item_to_candidate(results[0])
        if not cand.title and not cand.doi:
            return None
        if citation and citation.title and cand.title and cand.doi != doi:
            if title_similarity(citation.title, cand.title) < 0.70:
                return None
        cand.found = True
        cand.confidence = 1.0
        cand.score = 1.0
        return cand

    async def _lookup_by_title(self, citation: Citation) -> SourceCandidate:
        if not citation.title:
            return SourceCandidate(
                source_name=self.name,
                found=False,
                error="EuropePMC: no title or DOI for lookup",
            )

        clean_title = re.sub(r'["\'\\():;!?]', " ", citation.title)
        clean_title = re.sub(r"\s+", " ", clean_title).strip()
        if not clean_title:
            return SourceCandidate(
                source_name=self.name,
                found=False,
                error="EuropePMC: empty title after cleaning",
            )

        params = {
            "query": f'TITLE:"{clean_title}"',
            "resultType": "core",
            "pageSize": 5,
            "format": "json",
        }
        data = await self._fetch_json_with_retry(params)
        results = self._extract_results(data)

        # Fallback to unquoted TITLE query if strict phrase returned nothing
        if not results and self._last_status_code not in (429, 500, 502, 503, 504):
            words = [
                w
                for w in re.sub(r"[^\w\s]", " ", clean_title).split()
                if len(w) >= 3 and w.lower() not in _LUCENE_STOPWORDS
            ]
            if words:
                fallback_q = " AND ".join(f"TITLE:{w}" for w in words[:8])
                if citation.authors:
                    surname = author_key(citation.authors[0])
                    if surname and surname.lower() not in _LUCENE_STOPWORDS:
                        fallback_q = f"({fallback_q}) AND AUTH:{surname}"
                data = await self._fetch_json_with_retry(
                    {
                        "query": fallback_q,
                        "resultType": "core",
                        "pageSize": 5,
                        "format": "json",
                    }
                )
                results = self._extract_results(data)

        if not results:
            if self._last_status_code == 429:
                return SourceCandidate(
                    source_name=self.name,
                    found=False,
                    error=f"EuropePMC: rate limited (429) for '{clean_title[:50]}'",
                )
            if self._last_status_code and self._last_status_code >= 500:
                return SourceCandidate(
                    source_name=self.name,
                    found=False,
                    error=f"EuropePMC: service unavailable ({self._last_status_code}) for '{clean_title[:50]}'",
                )
            return SourceCandidate(
                source_name=self.name,
                found=False,
                error=f"EuropePMC: no results for '{clean_title[:60]}'",
            )

        cit_year = str(citation.year)[:4] if citation.year else None
        cit_first_author = author_key(citation.authors[0]) if citation.authors else None
        is_short_title = len(title_tokens(citation.title)) <= 3

        best_cand: SourceCandidate | None = None
        best_sim = -1.0
        best_rank = -1.0

        for item in results:
            cand = self._item_to_candidate(item)
            if not cand.title:
                continue
            sim = title_similarity(citation.title, cand.title)
            rank = sim
            if cit_year and cand.year == cit_year:
                rank += 0.03
            if cit_first_author and cand.authors:
                auth_sc = author_match_score(citation.authors, cand.authors)
                if auth_sc > 0.0:
                    rank += 0.03 * auth_sc
                elif is_short_title:
                    continue
            if rank > best_rank:
                best_rank = rank
                best_sim = sim
                best_cand = cand

        if best_cand is None or best_sim < MIN_TITLE_SIMILARITY:
            return SourceCandidate(
                source_name=self.name,
                found=False,
                error=(
                    f"EuropePMC: no title match above {MIN_TITLE_SIMILARITY:.2f} "
                    f"(best={best_sim:.2f}) for '{citation.title[:60]}'"
                ),
            )

        best_cand.found = True
        best_cand.score = best_sim
        best_cand.confidence = min(0.95, max(0.60, best_sim))
        return best_cand

    @staticmethod
    def _extract_results(data: dict[str, Any] | None) -> list[dict[str, Any]]:
        if not isinstance(data, dict):
            return []
        result_list = data.get("resultList")
        if not isinstance(result_list, dict):
            return []
        items = result_list.get("result")
        if isinstance(items, list):
            return [i for i in items if isinstance(i, dict)]
        return []

    @classmethod
    def _clean_text(cls, raw: str | None) -> str:
        if not raw:
            return ""
        text = html.unescape(str(raw))
        text = _HTML_TAG_RE.sub("", text)
        text = re.sub(r"\s+", " ", text).strip()
        if text.endswith("."):
            text = text[:-1].strip()
        return text

    @classmethod
    def _item_to_candidate(cls, item: dict[str, Any]) -> SourceCandidate:
        title = cls._clean_text(item.get("title")) or None
        doi_raw = item.get("doi")
        doi = normalize_doi(str(doi_raw)) if doi_raw else None

        authors: list[str] = []
        author_list = item.get("authorList")
        if isinstance(author_list, dict) and isinstance(author_list.get("author"), list):
            for a in author_list["author"]:
                if not isinstance(a, dict):
                    continue
                full_name = str(a.get("fullName") or "").strip()
                if not full_name:
                    first = str(a.get("firstName") or "").strip()
                    last = str(a.get("lastName") or "").strip()
                    full_name = f"{first} {last}".strip()
                if full_name:
                    authors.append(full_name)
        elif item.get("authorString"):
            raw_str = str(item.get("authorString") or "").strip().rstrip(".")
            authors = [p.strip() for p in raw_str.split(",") if p.strip()]

        pub_year = item.get("pubYear")
        year = str(pub_year).strip()[:4] if pub_year else None

        venue = None
        journal_info = item.get("journalInfo")
        if isinstance(journal_info, dict) and isinstance(journal_info.get("journal"), dict):
            venue = str(journal_info["journal"].get("title") or "").strip() or None
        if not venue and item.get("journalTitle"):
            venue = str(item.get("journalTitle")).strip() or None
        if not venue and isinstance(item.get("bookOrReportDetails"), dict):
            venue = str(item["bookOrReportDetails"].get("publisher") or "").strip() or None

        abstract = cls._clean_text(item.get("abstractText")) or None

        ext_ids: dict[str, str] = {}
        if doi:
            ext_ids["doi"] = doi
        if item.get("pmid"):
            ext_ids["pmid"] = str(item["pmid"])
        if item.get("pmcid"):
            ext_ids["pmcid"] = str(item["pmcid"])
        if item.get("id"):
            ext_ids["europepmc_id"] = str(item["id"])

        url = None
        if item.get("pmid"):
            url = f"https://europepmc.org/article/MED/{item['pmid']}"
        elif doi:
            url = f"https://doi.org/{doi}"

        return SourceCandidate(
            source_name=cls.name,
            found=False,
            doi=doi,
            title=title,
            authors=authors,
            year=year,
            venue=venue,
            url=url,
            abstract=abstract,
            external_ids=ext_ids,
        )

    async def _fetch_json_with_retry(self, params: dict[str, Any]) -> dict[str, Any] | None:
        import asyncio
        import random

        from integrity_checker.retrieval.http_pool import get_shared_http_client

        if time.monotonic() < EuropePMCClient._backoff_until:
            self._last_status_code = 503
            return None

        seen_429 = 0
        retryer = AsyncRetrying(
            stop=stop_after_attempt(min(self.max_retries, 3)),
            wait=wait_exponential(
                multiplier=self._backoff.multiplier,
                min=min(self._backoff.initial_seconds, 1.5),
                max=min(self._backoff.max_seconds, 10.0),
            ),
            retry=retry_if_exception_type((httpx.RequestError, httpx.HTTPStatusError)),
            reraise=False,
        )
        try:
            async for attempt in retryer:
                with attempt:
                    client = get_shared_http_client(follow_redirects=True)
                    resp = await client.get(
                        self.BASE_URL,
                        params=params,
                        headers=self._headers,
                        timeout=self.timeout,
                    )
                    retry_after = self._record_http_response(resp)
                    if resp.status_code == 404:
                        return None
                    if resp.status_code == 503:
                        EuropePMCClient._backoff_until = time.monotonic() + 30.0
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
                            resp._request = httpx.Request("GET", self.BASE_URL)
                        resp.raise_for_status()
                    if resp.status_code != 200:
                        return None
                    return resp.json()
        except RetryError as exc:
            self._record_transport_error(exc)
            logger.warning(f"EuropePMC retry exhausted: {exc}")
            return None
        except Exception as exc:  # noqa: BLE001
            self._record_transport_error(exc)
            logger.warning(f"EuropePMC error: {exc}")
            return None
        return None
