"""Global DOI Registration Agency (RA) & CSL-JSON Content Negotiation Client.

Verifies any DOI globally via https://doi.org/doiRA/{doi} and fetches canonical
CSL-JSON metadata via https://doi.org/{doi} (Accept: application/vnd.citationstyles.csl+json).

Covers regional & specialized DOI registration agencies outside Crossref:
- DataCite (Datasets, Zenodo, Figshare, arXiv)
- JaLC (Japan Link Center)
- mEDRA (Multilingual European DOI Registration Agency)
- CNKI / ISTIC (China Academic Journals)
- KISTI (Korea Institute of Science and Technology Information)
- Airiti (Taiwan Academic Literature)
- OP (Publications Office of the European Union)

Rate limit: 10 req/s (free public Handle/DOI proxy, no API key required).
"""

from __future__ import annotations

import asyncio
import html
import json
import os
import re
import socket
from collections.abc import Callable
from typing import Any
from urllib.parse import quote, urljoin

import httpx

from integrity_checker.config import get_settings
from integrity_checker.logging import get_logger
from integrity_checker.models.citation import Citation
from integrity_checker.models.source import SourceCandidate
from integrity_checker.retrieval.base import BaseScholarClient
from integrity_checker.retrieval.html_meta_verifier import (
    SSRFBlockedError,
    build_ssrf_safe_transport,
    validate_public_target_ips,
    validate_url_syntax_and_literal_ip,
)
from integrity_checker.retrieval.http_pool import (
    get_shared_http_client,
    get_shared_ssrf_http_client,
)
from integrity_checker.retrieval.normalization import (
    detect_and_strip_retraction_title,
    normalize_doi,
    title_similarity,
    title_tokens,
)

logger = get_logger(__name__)

_MAX_CSL_JSON_BYTES = 262_144
_MAX_CSL_REDIRECTS = 4
_REDIRECT_STATUS_CODES = frozenset({301, 302, 303, 307, 308})
_ORIG_ASYNC_GET = httpx.AsyncClient.get
_ORIG_ASYNC_STREAM = httpx.AsyncClient.stream
_ORIG_SOCKET_GETADDRINFO = socket.getaddrinfo


class DoiRaClient(BaseScholarClient):
    """Global DOI Registration Agency & CSL-JSON resolver."""

    BASE_URL = "https://doi.org"
    name = "doi_ra"

    def __init__(
        self,
        contact_email: str | None = None,
        timeout: float = 8.0,
        *,
        resolver: Callable[..., Any] | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        super().__init__(timeout=timeout)
        settings = get_settings()
        self._resolver = resolver
        self._transport = transport
        self.contact_email = (
            contact_email
            or os.getenv("CONTACT_EMAIL", "")
            or settings.contact_email
            or settings.retrieval.contact_email
        )
        self._user_agent = (
            f"EssayIntegrityChecker/1.0 (mailto:{self.contact_email})"
            if self.contact_email
            else "EssayIntegrityChecker/1.0"
        )

    async def lookup(self, citation: Citation) -> SourceCandidate:
        """Verify DOI registration agency and fetch CSL-JSON metadata."""
        self._reset_http_telemetry()
        if not citation.doi:
            return SourceCandidate(
                source_name=self.name,
                found=False,
                error="DOI RA: citation has no DOI",
            )

        doi_norm = normalize_doi(citation.doi)
        if not doi_norm or any(seg in {".", ".."} for seg in doi_norm.split("/")):
            return SourceCandidate(
                source_name=self.name,
                found=False,
                error="DOI RA: invalid DOI format",
            )

        ra_info = await self.check_registration_agency(doi_norm)
        if ra_info is None:
            if self._last_status_code == 429 or (
                self._last_status_code is not None and self._last_status_code >= 500
            ):
                return self._build_miss_or_error_candidate("DOI RA", doi_norm)
            return SourceCandidate(
                source_name=self.name,
                found=False,
                error=f"DOI RA: network error checking DOI '{doi_norm}'",
            )

        ra_name = ra_info.get("RA")
        status_msg = ra_info.get("status", "")
        if not ra_name:
            return SourceCandidate(
                source_name=self.name,
                found=False,
                error=f"DOI RA: no results for DOI '{doi_norm}' ({status_msg or 'DOI does not exist'})",
                external_ids={"doi_ra_status": "nonexistent"},
            )

        # Fetch canonical bibliographic metadata via CSL-JSON content negotiation
        csl_cand = await self._fetch_csl_json(doi_norm, ra_name=ra_name)
        if csl_cand and csl_cand.title:
            # Guard against mismatched work if citation has a substantive title
            if (
                citation.title
                and len(title_tokens(citation.title)) >= 3
                and csl_cand.title
                and csl_cand.doi
                and csl_cand.doi.lower() != doi_norm.lower()
            ):
                if title_similarity(citation.title, csl_cand.title) < 0.70:
                    return SourceCandidate(
                        source_name=self.name,
                        found=False,
                        error=f"DOI RA: CSL title mismatch for '{doi_norm}'",
                    )
            csl_cand.found = True
            if not csl_cand.authors:
                csl_cand.authors = [ra_name]
            csl_cand.confidence = 0.96
            return csl_cand

        # When a recognized non-Crossref RA confirms DOI registration via doi.org/doiRA,
        # but CSL-JSON metadata is unavailable, NEVER echo student-supplied metadata:
        # return found=False with doi_ra_status="registered_no_csl" so SymbolicRules abstains (UNRESOLVED).
        if ra_name not in ("Crossref",):
            return SourceCandidate(
                source_name=self.name,
                found=False,
                doi=doi_norm,
                url=f"https://doi.org/{doi_norm}",
                external_ids={
                    "doi": doi_norm,
                    "doi_ra": ra_name,
                    "doi_ra_status": "registered_no_csl",
                },
                error=f"DOI RA: CSL metadata unavailable for '{doi_norm}' (RA={ra_name})",
            )

        if (
            self._last_status_code == 429
            or (self._last_status_code is not None and self._last_status_code >= 500)
            or self._last_transport_error
        ):
            cand = self._build_miss_or_error_candidate("DOI RA", doi_norm)
            cand.external_ids = {"doi_ra": ra_name}
            return cand

        return SourceCandidate(
            source_name=self.name,
            found=False,
            error=f"DOI RA: CSL metadata unavailable for '{doi_norm}' (RA={ra_name})",
            external_ids={"doi_ra": ra_name},
        )

    async def check_registration_agency(self, doi: str) -> dict[str, str] | None:
        """GET https://doi.org/doiRA/{doi} -> returns {'DOI': ..., 'RA': ...} or {'status': ...}."""
        url = f"{self.BASE_URL}/doiRA/{quote(doi, safe='/')}"
        headers = {
            "User-Agent": self._user_agent,
            "Accept": "application/json",
        }
        try:
            if self._transport is not None:
                async with httpx.AsyncClient(
                    transport=self._transport,
                    follow_redirects=False,
                    trust_env=False,
                    timeout=self.timeout,
                ) as client:
                    resp = await client.get(url, headers=headers, timeout=self.timeout)
            else:
                client = get_shared_http_client(follow_redirects=False)
                resp = await client.get(url, headers=headers, timeout=self.timeout)
            self._record_http_response(resp)
            if resp.status_code == 404:
                return {"DOI": doi, "status": "DOI does not exist"}
            if resp.status_code != 200:
                return None
            data = resp.json()
            if isinstance(data, list) and data and isinstance(data[0], dict):
                return {str(k): str(v) for k, v in data[0].items() if v is not None}
        except Exception as exc:  # noqa: BLE001
            self._record_transport_error(exc)
            logger.debug(f"DOI RA lookup failed for '{doi}': {exc}")
            return None
        return None

    async def _validate_csl_hop(
        self,
        target_url: str,
        *,
        uses_pinned_backend: bool,
    ) -> bool:
        """Validate URL syntax, literal IP, dotless hostnames, and DNS public-IP invariants."""
        syntax_ok, state_or_reason, hostname, _ = validate_url_syntax_and_literal_ip(target_url)
        if not syntax_ok:
            logger.warning(f"DOI RA blocked unsafe CSL redirect '{target_url}': {state_or_reason}")
            return False
        if state_or_reason == "public_ip_literal":
            return True
        if "." not in hostname:
            logger.warning(f"DOI RA blocked dotless CSL hostname '{target_url}'")
            return False

        getaddrinfo_patched = socket.getaddrinfo is not _ORIG_SOCKET_GETADDRINFO
        if not uses_pinned_backend or self._resolver is not None or getaddrinfo_patched:
            if self._resolver is not None or getaddrinfo_patched:
                ok, reason = validate_public_target_ips(target_url, resolver=self._resolver)
            else:
                ok, reason = await asyncio.to_thread(validate_public_target_ips, target_url, None)
            if not ok:
                # Permit synthetic RFC-2606 NXDOMAIN only when HTTP transport/get is mocked
                # without a custom resolver; all private/loopback DNS results remain blocked.
                if (
                    not uses_pinned_backend
                    and self._resolver is None
                    and not getaddrinfo_patched
                    and reason.startswith("DNS resolution failed")
                ):
                    return True
                logger.warning(f"DOI RA blocked non-public CSL DNS target '{target_url}': {reason}")
                return False
        return True

    async def _fetch_csl_json_with_client(
        self,
        client: httpx.AsyncClient,
        doi: str,
        ra_name: str,
        *,
        use_patched_get: bool,
        uses_pinned_backend: bool,
    ) -> SourceCandidate | None:
        current_url = f"{self.BASE_URL}/{quote(doi, safe='/')}"
        headers = {
            "User-Agent": self._user_agent,
            "Accept": "application/vnd.citationstyles.csl+json, application/json",
        }
        for hop in range(_MAX_CSL_REDIRECTS + 1):
            if not await self._validate_csl_hop(
                current_url,
                uses_pinned_backend=uses_pinned_backend,
            ):
                return None
            if use_patched_get:
                resp = await client.get(current_url, headers=headers, timeout=self.timeout)
                self._record_http_response(resp)
                if resp.status_code in _REDIRECT_STATUS_CODES:
                    loc = (resp.headers.get("location") or "").strip()
                    if not loc or hop >= _MAX_CSL_REDIRECTS:
                        return None
                    current_url = urljoin(current_url, loc)
                    continue
                if resp.status_code != 200:
                    return None
                raw_bytes = resp.content
                if len(raw_bytes) > _MAX_CSL_JSON_BYTES:
                    logger.warning(f"DOI RA CSL-JSON exceeded {_MAX_CSL_JSON_BYTES}B for '{doi}'")
                    return None
                try:
                    data = json.loads(raw_bytes.decode("utf-8", errors="replace"))
                except (json.JSONDecodeError, ValueError):
                    return None
            else:
                async with client.stream(
                    "GET",
                    current_url,
                    headers=headers,
                    timeout=self.timeout,
                ) as resp:
                    self._record_http_response(resp)
                    if resp.status_code in _REDIRECT_STATUS_CODES:
                        loc = (resp.headers.get("location") or "").strip()
                        if not loc or hop >= _MAX_CSL_REDIRECTS:
                            return None
                        current_url = urljoin(current_url, loc)
                        continue
                    if resp.status_code != 200:
                        return None
                    cl_raw = (resp.headers.get("content-length") or "").strip()
                    if cl_raw.isdigit() and int(cl_raw) > _MAX_CSL_JSON_BYTES:
                        logger.warning(
                            f"DOI RA CSL-JSON Content-Length {cl_raw} > {_MAX_CSL_JSON_BYTES}B for '{doi}'"
                        )
                        return None
                    chunks: list[bytes] = []
                    total = 0
                    async for chunk in resp.aiter_bytes():
                        total += len(chunk)
                        if total > _MAX_CSL_JSON_BYTES:
                            logger.warning(
                                f"DOI RA CSL-JSON stream exceeded {_MAX_CSL_JSON_BYTES}B for '{doi}'"
                            )
                            return None
                        chunks.append(chunk)
                    raw_bytes = b"".join(chunks)
                try:
                    data = json.loads(raw_bytes.decode("utf-8", errors="replace"))
                except (json.JSONDecodeError, ValueError):
                    return None

            if not isinstance(data, dict):
                return None
            return self._csl_to_candidate(data, default_doi=doi, ra_name=ra_name)
        return None

    async def _fetch_csl_json(self, doi: str, ra_name: str) -> SourceCandidate | None:
        """Fetch CSL-JSON metadata via https://doi.org/{doi} with per-hop SSRF & 256 KiB stream cap."""
        use_patched_get = (
            self._transport is None
            and httpx.AsyncClient.get is not _ORIG_ASYNC_GET
            and httpx.AsyncClient.stream is _ORIG_ASYNC_STREAM
        )
        stream_is_patched = httpx.AsyncClient.stream is not _ORIG_ASYNC_STREAM
        try:
            if self._transport is not None:
                async with httpx.AsyncClient(
                    transport=self._transport,
                    follow_redirects=False,
                    trust_env=False,
                    timeout=self.timeout,
                ) as owned_client:
                    return await self._fetch_csl_json_with_client(
                        owned_client,
                        doi,
                        ra_name,
                        use_patched_get=False,
                        uses_pinned_backend=False,
                    )
            if use_patched_get or stream_is_patched:
                client = get_shared_http_client(follow_redirects=False)
                return await self._fetch_csl_json_with_client(
                    client,
                    doi,
                    ra_name,
                    use_patched_get=use_patched_get,
                    uses_pinned_backend=False,
                )
            if self._resolver is not None or socket.getaddrinfo is not _ORIG_SOCKET_GETADDRINFO:
                async with httpx.AsyncClient(
                    transport=build_ssrf_safe_transport(resolver=self._resolver),
                    follow_redirects=False,
                    trust_env=False,
                    timeout=self.timeout,
                ) as resolver_client:
                    return await self._fetch_csl_json_with_client(
                        resolver_client,
                        doi,
                        ra_name,
                        use_patched_get=False,
                        uses_pinned_backend=True,
                    )
            return await self._fetch_csl_json_with_client(
                get_shared_ssrf_http_client(),
                doi,
                ra_name,
                use_patched_get=False,
                uses_pinned_backend=True,
            )
        except SSRFBlockedError as exc:
            logger.warning(f"DOI RA SSRF guard blocked CSL-JSON redirect for '{doi}': {exc}")
            return None
        except Exception as exc:  # noqa: BLE001
            self._record_transport_error(exc)
            logger.debug(f"CSL-JSON lookup failed for '{doi}': {exc}")
            return None

    @staticmethod
    def _clean_text(text: Any) -> str | None:
        if not text:
            return None
        if isinstance(text, list):
            text = text[0] if text else ""
        cleaned = html.unescape(str(text))
        cleaned = re.sub(r"<[^>]+>", " ", cleaned)
        cleaned = re.sub(r"\s+", " ", cleaned).strip()
        return cleaned or None

    def _csl_to_candidate(
        self,
        data: dict[str, Any],
        default_doi: str,
        ra_name: str,
    ) -> SourceCandidate:
        doi = normalize_doi(str(data.get("DOI") or default_doi))
        raw_title = self._clean_text(data.get("title"))
        title, is_retracted = detect_and_strip_retraction_title(raw_title)

        authors: list[str] = []
        raw_authors = data.get("author") or []
        if isinstance(raw_authors, list):
            for a in raw_authors:
                if not isinstance(a, dict):
                    continue
                given = (a.get("given") or "").strip()
                family = (a.get("family") or "").strip()
                literal = (a.get("literal") or a.get("name") or "").strip()
                if given and family:
                    authors.append(f"{given} {family}")
                elif family:
                    authors.append(family)
                elif literal:
                    authors.append(literal)

        year: str | None = None
        for date_field in ("issued", "published", "published-print", "published-online", "created"):
            date_obj = data.get(date_field)
            if isinstance(date_obj, dict):
                parts = date_obj.get("date-parts")
                if isinstance(parts, list) and parts and isinstance(parts[0], list) and parts[0]:
                    yr = str(parts[0][0])[:4]
                    if yr.isdigit():
                        year = yr
                        break

        venue = self._clean_text(
            data.get("container-title") or data.get("publisher")
        )
        abstract = self._clean_text(data.get("abstract"))
        url = str(data.get("URL") or (f"https://doi.org/{doi}" if doi else "")) or None

        ext_ids: dict[str, str] = {"doi_ra": ra_name}
        if doi:
            ext_ids["doi"] = doi
        if str(data.get("is-retracted") or "").strip().lower() in {"true", "1", "yes"}:
            is_retracted = True
        relation = data.get("relation")
        if isinstance(relation, dict) and (
            relation.get("is-retracted-by") or relation.get("retracted-by")
        ):
            is_retracted = True
        for upd_key in ("update-to", "updated-by"):
            upd_list = data.get(upd_key)
            if isinstance(upd_list, list) and any(
                isinstance(u, dict)
                and str(u.get("type") or "").strip().lower()
                in {"retraction", "retracted", "withdrawal", "removal"}
                for u in upd_list
            ):
                is_retracted = True
        if is_retracted:
            ext_ids["is_retracted"] = "true"

        return SourceCandidate(
            source_name=self.name,
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
