"""Hugging Face Hub API Client — Models, Datasets & Daily Papers Verification.

Verifies citations referencing:
- Hugging Face Hub Models (`https://huggingface.co/{org}/{model}` or repo IDs like `vinai/phobert-base`)
- Hugging Face Datasets (`https://huggingface.co/datasets/{org}/{dataset}`)
- Hugging Face Papers (`https://huggingface.co/papers/{arxiv_id}` / `/api/papers/{arxiv_id}`)

Rate limit: 5 req/s (free public REST API, no API key required).
Docs: https://huggingface.co/docs/hub/api
"""

from __future__ import annotations

import html
import os
import re
from typing import Any
from urllib.parse import quote

from integrity_checker.config import get_settings
from integrity_checker.logging import get_logger
from integrity_checker.models.citation import Citation
from integrity_checker.models.source import SourceCandidate
from integrity_checker.retrieval.arxiv_client import ArxivClient
from integrity_checker.retrieval.base import BaseScholarClient
from integrity_checker.retrieval.http_pool import get_shared_http_client
from integrity_checker.retrieval.normalization import (
    title_similarity,
    title_tokens,
)

logger = get_logger(__name__)

_HF_URL_RE = re.compile(
    r"https?://(?:www\.)?huggingface\.co/(?:(?P<kind>datasets|spaces|papers)/)?(?P<repo>[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)?)",
    re.IGNORECASE,
)

_HF_REPO_ID_RE = re.compile(
    r"\b([A-Za-z0-9][\w.-]{1,35}/[A-Za-z0-9][\w.-]{2,60})\b"
)

_RESERVED_PATH_PREFIXES = frozenset({
    "docs",
    "blog",
    "tasks",
    "models",
    "datasets",
    "spaces",
    "papers",
    "pricing",
    "join",
    "login",
    "settings",
})


class HuggingFaceClient(BaseScholarClient):
    """Hugging Face Hub API client for AI/NLP models, datasets, and papers."""

    BASE_URL = "https://huggingface.co/api"
    name = "huggingface"

    def __init__(
        self,
        contact_email: str | None = None,
        timeout: float = 8.0,
    ) -> None:
        super().__init__(timeout=timeout)
        settings = get_settings()
        self.contact_email = (
            contact_email
            or os.getenv("CONTACT_EMAIL", "")
            or settings.contact_email
            or settings.retrieval.contact_email
        )
        self._headers = {
            "User-Agent": (
                f"EssayIntegrityChecker/1.0 (mailto:{self.contact_email})"
                if self.contact_email
                else "EssayIntegrityChecker/1.0"
            ),
            "Accept": "application/json",
        }

    @classmethod
    def extract_hf_target(cls, citation: Citation) -> tuple[str | None, str | None]:
        """Extract (kind, identifier) from a citation if it references Hugging Face.

        Returns:
            (kind, target) where kind is 'models', 'datasets', 'papers', or None.
        """
        combined = " ".join(
            part
            for part in (
                citation.url or "",
                citation.raw_text or "",
                citation.title or "",
                citation.venue or "",
            )
            if part
        )
        url_m = _HF_URL_RE.search(combined)
        if url_m:
            kind_raw = (url_m.group("kind") or "").lower()
            repo = url_m.group("repo").strip().rstrip(".,;:)\"'/")
            first_seg = repo.split("/", 1)[0].lower()
            if first_seg not in _RESERVED_PATH_PREFIXES:
                if kind_raw == "datasets":
                    return "datasets", repo
                if kind_raw == "papers":
                    return "papers", repo
                return "models", repo

        # Check if citation explicitly mentions Hugging Face and contains an org/repo identifier
        if re.search(r"\bhugging\s*face\b", combined, re.IGNORECASE):
            for m in _HF_REPO_ID_RE.finditer(combined):
                candidate = m.group(1).strip().rstrip(".,;:)\"'")
                org, name = candidate.split("/", 1)
                if (
                    org.lower() not in _RESERVED_PATH_PREFIXES
                    and not org.isdigit()
                    and not name.isdigit()
                    and org.lower() not in ("10.48550", "10.18653", "10.1145", "10.1109", "http", "https")
                ):
                    return "models", candidate

        return None, None

    async def lookup(self, citation: Citation) -> SourceCandidate:
        """Lookup Hugging Face Paper, Model, or Dataset."""
        self._reset_http_telemetry()
        # 1. Direct arXiv ID paper lookup on Hugging Face Papers API
        arxiv_id = ArxivClient.extract_arxiv_id(citation)
        kind, target = self.extract_hf_target(citation)

        if kind == "papers" and target:
            arxiv_id = target

        if arxiv_id:
            paper_cand = await self._lookup_paper(arxiv_id, citation=citation)
            if paper_cand and paper_cand.found:
                return paper_cand
            if self._last_status_code == 429:
                return self._build_miss_or_error_candidate("HuggingFace", arxiv_id)

        # 2. Direct Model or Dataset repo lookup
        if kind in ("models", "datasets") and target:
            repo_cand = await self._lookup_repo(kind, target, citation=citation)
            if repo_cand and repo_cand.found:
                return repo_cand
            if self._last_status_code == 429:
                return self._build_miss_or_error_candidate("HuggingFace", target)
            # Try the other kind (e.g. dataset referenced without /datasets/ prefix)
            alt_kind = "datasets" if kind == "models" else "models"
            alt_cand = await self._lookup_repo(alt_kind, target, citation=citation)
            if alt_cand and alt_cand.found:
                return alt_cand
            if self._last_status_code == 429:
                return self._build_miss_or_error_candidate("HuggingFace", target)

        # 3. Search Hugging Face Daily Papers / Models by title
        raw_title = (citation.title or "").strip()
        if not raw_title and citation.raw_text:
            raw_title = " ".join(title_tokens(citation.raw_text)[:12])
        if raw_title and len(raw_title) >= 4 and self._last_status_code != 429:
            search_cand = await self._search_papers_or_models(raw_title, citation=citation)
            if search_cand and search_cand.found:
                return search_cand

        preview = (target or raw_title or citation.raw_text or "")[:60]
        return self._build_miss_or_error_candidate("HuggingFace", preview)

    async def _lookup_paper(
        self,
        arxiv_id: str,
        citation: Citation | None = None,
    ) -> SourceCandidate | None:
        clean_id = re.sub(r"v\d+$", "", arxiv_id.strip(), flags=re.IGNORECASE)
        data = await self._fetch_json(f"/papers/{quote(clean_id, safe='')}")
        if not isinstance(data, dict) or not data.get("title"):
            return None

        title = self._clean_text(data.get("title"))
        if (
            citation
            and citation.title
            and len(title_tokens(citation.title)) >= 3
            and title
            and title_similarity(citation.title, title) < 0.65
        ):
            return None

        authors: list[str] = []
        for a in data.get("authors") or []:
            if isinstance(a, dict) and a.get("name"):
                authors.append(str(a["name"]).strip())

        pub_at = str(data.get("publishedAt") or "")
        year = pub_at[:4] if len(pub_at) >= 4 and pub_at[:4].isdigit() else (f"20{clean_id[:2]}" if clean_id[:2].isdigit() else None)
        abstract = self._clean_text(data.get("summary"))
        doi = f"10.48550/arxiv.{clean_id.lower()}"

        return SourceCandidate(
            source_name=self.name,
            found=True,
            doi=doi,
            title=title,
            authors=authors,
            year=year,
            venue="Hugging Face Papers / arXiv",
            url=f"https://huggingface.co/papers/{clean_id}",
            abstract=abstract,
            external_ids={"arxiv_id": clean_id, "doi": doi, "hf_paper_id": clean_id},
            confidence=0.96,
        )

    async def _lookup_repo(
        self,
        kind: str,
        repo_id: str,
        citation: Citation | None = None,
    ) -> SourceCandidate | None:
        endpoint = f"/{kind}/{quote(repo_id, safe='/')}"
        data = await self._fetch_json(endpoint)
        if not isinstance(data, dict) or not (data.get("id") or data.get("modelId")):
            return None

        canonical_id = str(data.get("id") or data.get("modelId") or repo_id)
        author = str(data.get("author") or canonical_id.split("/", 1)[0]).strip()
        created = str(data.get("createdAt") or data.get("lastModified") or "")
        year = created[:4] if len(created) >= 4 and created[:4].isdigit() else None

        card = data.get("cardData") or {}
        description = None
        if isinstance(card, dict):
            description = self._clean_text(
                card.get("description") or card.get("summary") or card.get("pretty_name")
            )
        if not description and data.get("description"):
            description = self._clean_text(data.get("description"))

        tags = [str(t) for t in (data.get("tags") or []) if t]
        arxiv_tag = next(
            (t.split(":", 1)[1] for t in tags if t.lower().startswith("arxiv:")),
            None,
        )
        doi = str(data.get("doi") or (f"10.48550/arxiv.{arxiv_tag}" if arxiv_tag else "")) or None

        authors_list = [author] if author else ["Hugging Face"]
        title_val = canonical_id
        repo_short = canonical_id.split("/", 1)[-1].lower()

        # If the model/dataset links an arXiv paper tag, fetch paper metadata to enrich authors/year/title
        if arxiv_tag:
            paper_cand = await self._lookup_paper(arxiv_tag)
            if paper_cand and paper_cand.found:
                if paper_cand.authors:
                    authors_list = list(paper_cand.authors) + ([author] if author and author not in paper_cand.authors else [])
                if not description and paper_cand.abstract:
                    description = paper_cand.abstract
                if citation and citation.year and paper_cand.year and str(citation.year)[:4] == str(paper_cand.year)[:4] or not year and paper_cand.year:
                    year = paper_cand.year
                if paper_cand.title:
                    if citation and citation.title and canonical_id.lower() in citation.title.lower():
                        title_val = citation.title.strip()
                    else:
                        title_val = f"{canonical_id}: {paper_cand.title}"

        # If citation explicitly names the repo ID or short model name in its title, align title
        if citation and citation.title:
            cit_t_low = citation.title.lower()
            if canonical_id.lower() in cit_t_low or (len(repo_short) >= 4 and repo_short in cit_t_low):
                title_val = citation.title.strip()

        ext_ids: dict[str, str] = {
            "hf_repo_id": canonical_id,
            "hf_kind": kind,
        }
        if arxiv_tag:
            ext_ids["arxiv_id"] = arxiv_tag
        if doi:
            ext_ids["doi"] = doi.lower()

        url_prefix = "https://huggingface.co/datasets/" if kind == "datasets" else "https://huggingface.co/"
        return SourceCandidate(
            source_name=self.name,
            found=True,
            doi=doi.lower() if doi else None,
            title=title_val,
            authors=authors_list,
            year=year,
            venue="Hugging Face Hub",
            url=f"{url_prefix}{canonical_id}",
            abstract=description,
            external_ids=ext_ids,
            confidence=0.95,
        )

    async def _search_papers_or_models(
        self,
        query: str,
        citation: Citation,
    ) -> SourceCandidate | None:
        # Search daily papers endpoint
        papers = await self._fetch_json("/daily_papers", params={"search": query, "limit": 5})
        if isinstance(papers, list) and papers:
            for item in papers:
                if not isinstance(item, dict):
                    continue
                paper_obj = item.get("paper") if isinstance(item.get("paper"), dict) else item
                title = self._clean_text(paper_obj.get("title") or item.get("title"))
                if not title:
                    continue
                sim = title_similarity(query, title)
                if sim >= 0.70:
                    paper_id = str(paper_obj.get("id") or "")
                    authors = [
                        str(a.get("name")).strip()
                        for a in (paper_obj.get("authors") or [])
                        if isinstance(a, dict) and a.get("name")
                    ]
                    pub_at = str(paper_obj.get("publishedAt") or item.get("publishedAt") or "")
                    year = pub_at[:4] if len(pub_at) >= 4 and pub_at[:4].isdigit() else None
                    summary = self._clean_text(paper_obj.get("summary") or item.get("summary"))
                    doi = f"10.48550/arxiv.{paper_id.lower()}" if paper_id else None
                    return SourceCandidate(
                        source_name=self.name,
                        found=True,
                        doi=doi,
                        title=title,
                        authors=authors,
                        year=year,
                        venue="Hugging Face Papers",
                        url=f"https://huggingface.co/papers/{paper_id}" if paper_id else None,
                        abstract=summary,
                        external_ids={"hf_paper_id": paper_id} if paper_id else {},
                        confidence=round(min(0.95, sim), 4),
                    )
        return None

    @staticmethod
    def _clean_text(text: Any) -> str | None:
        if not text:
            return None
        cleaned = html.unescape(str(text))
        cleaned = re.sub(r"<[^>]+>", " ", cleaned)
        cleaned = re.sub(r"\s+", " ", cleaned).strip()
        return cleaned or None

    async def _fetch_json(
        self,
        path: str,
        params: dict[str, Any] | None = None,
    ) -> Any:
        url = f"{self.BASE_URL}{path}"
        try:
            client = get_shared_http_client(follow_redirects=True)
            resp = await client.get(
                url,
                params=params,
                headers=self._headers,
                timeout=self.timeout,
            )
            self._record_http_response(resp)
            if resp.status_code != 200:
                return None
            return resp.json()
        except Exception as exc:  # noqa: BLE001
            self._record_transport_error(exc)
            logger.debug(f"HuggingFace request failed for {url}: {exc}")
            return None
