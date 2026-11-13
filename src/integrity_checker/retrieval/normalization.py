"""Canonicalization helpers shared by retrieval and local-database lookup.

The extractor intentionally preserves PDF punctuation in ``Citation.title`` and
author fields for auditability.  Retrieval keys must be more forgiving: a final
period, Unicode dash, initials, or ``et al.`` should not turn the same paper
into a cache miss.
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Iterable
from difflib import SequenceMatcher

from integrity_checker.models.citation import Citation

_DOI_PREFIX_RE = re.compile(r"^(?:https?://)?(?:dx\.)?doi\.org/", re.IGNORECASE)
_ARXIV_PREFIX_RE = re.compile(
    r"^(?:https?://)?(?:www\.)?arxiv\.org/(?:abs|pdf)/|^arxiv:",
    re.IGNORECASE,
)
_YEAR_RE = re.compile(r"(?:19|20)\d{2}")
_ET_AL_RE = re.compile(r"\bet\s+al\.?\b", re.IGNORECASE)
_DASH_TRANSLATION = str.maketrans({
    "\u2010": "-",
    "\u2011": "-",
    "\u2012": "-",
    "\u2013": "-",
    "\u2014": "-",
    "\u2212": "-",
})


def normalize_doi(value: str | None) -> str | None:
    """Return a stable DOI key, or ``None`` for an empty value."""
    if not value:
        return None
    value = unicodedata.normalize("NFKC", str(value)).strip()
    value = _DOI_PREFIX_RE.sub("", value)
    value = value.rstrip(" \t\r\n.,;:)]}>")
    return value.casefold() or None


def normalize_arxiv_id(value: str | None) -> str | None:
    """Return a stable arXiv identifier without version suffix."""
    if not value:
        return None
    value = unicodedata.normalize("NFKC", str(value)).strip()
    value = _ARXIV_PREFIX_RE.sub("", value)
    value = value.split("?", 1)[0].split("#", 1)[0]
    value = value.rstrip(" \t\r\n.,;:)]}>")
    value = re.sub(r"v\d+$", "", value, flags=re.IGNORECASE)
    return value.casefold() or None


def normalize_text(value: str | None) -> str:
    """Normalize human text for matching while preserving word boundaries."""
    if not value:
        return ""
    text = unicodedata.normalize("NFKC", str(value)).translate(_DASH_TRANSLATION)
    text = _ET_AL_RE.sub(" ", text)
    text = text.casefold()
    # Keep Unicode letters/numbers, turn punctuation and symbols into spaces.
    text = "".join(ch if (ch.isalnum() or ch.isspace()) else " " for ch in text)
    return " ".join(text.split())


def title_tokens(value: str | None) -> list[str]:
    """Tokenize a normalized title, dropping one-character initials."""
    return [token for token in normalize_text(value).split() if len(token) > 1]


_CAMEL_AUTHOR_RE = re.compile(r"^([A-ZÀ-ÖØ-Þ][a-zà-ÿ]{2,})([A-ZÀ-ÖØ-Þ][a-zà-ÿ]+)$")
_SURNAME_PREFIXES = {
    "mac", "van", "von", "fitz", "del", "dal", "das", "dos",
    "las", "los", "san", "bin", "abu", "ben",
}


_GENERATIONAL_SUFFIXES = {"jr", "sr", "ii", "iii", "iv", "v"}


def author_key(value: object) -> str:
    """Extract a normalized first-author/last-name key from an author value."""
    if value is None:
        return ""
    if hasattr(value, "last_name"):
        value = getattr(value, "last_name", "")
    text = _ET_AL_RE.sub(" ", str(value)).strip()
    text = text.replace("\u2019", "'").replace("\u2018", "'").replace("`", "'")
    # Preserve compound apostrophe surnames like O'Connor -> OConnor, L'Engle -> LEngle
    text = re.sub(r"\b([A-Za-z])'([A-Za-z])", r"\1\2", text)
    if " " not in text and "," not in text:
        m = _CAMEL_AUTHOR_RE.match(text)
        if m and m.group(1).lower() not in _SURNAME_PREFIXES:
            text = f"{m.group(1)}, {m.group(2)}"
    # APA ``Lastname, F.``: the token before the comma is the last name.
    if "," in text:
        first_part = text.split(",", 1)[0].strip()
        if first_part.lower().rstrip(".") not in _GENERATIONAL_SUFFIXES:
            text = first_part
        else:
            text = text.split(",", 1)[1].strip()
    tokens = [t for t in title_tokens(text) if t not in _GENERATIONAL_SUFFIXES]
    if not tokens:
        tokens = title_tokens(text)
    if not tokens:
        return ""
    last_tok = tokens[-1]
    folded = unicodedata.normalize("NFKD", last_tok).encode("ascii", "ignore").decode("ascii")
    return folded or last_tok


def author_keys(authors: Iterable[object] | object | None) -> set[str]:
    """Normalize an author list; accept a single string for compatibility."""
    if authors is None:
        return set()
    if isinstance(authors, str):
        values: list[object] = [authors]
    else:
        try:
            values = list(authors)  # type: ignore[arg-type]
        except TypeError:
            values = [authors]
    return {key for key in (author_key(value) for value in values) if key}


def author_match_score(
    query_authors: Iterable[object] | object | None,
    candidate_authors: Iterable[object] | object | None,
) -> float:
    """Return author overlap score in [0.0, 1.0] based on normalized author surnames."""
    q_keys = author_keys(query_authors)
    c_keys = author_keys(candidate_authors)
    if not q_keys or not c_keys:
        return 0.0
    overlap = len(q_keys & c_keys)
    if overlap > 0:
        return overlap / min(len(q_keys), len(c_keys))
    # Substring fallback for compound surnames (e.g. "l'engle" / "lengle", "o'connor" / "oconnor")
    for qk in q_keys:
        for ck in c_keys:
            if len(qk) >= 4 and len(ck) >= 4 and (qk in ck or ck in qk):
                return 0.8
    # Swapped East Asian / 2-token fallback (via author_matcher)
    try:
        from integrity_checker.matching.author_matcher import (
            author_match_score as _full_author_score,
        )

        q_list = [query_authors] if isinstance(query_authors, str) else list(query_authors)  # type: ignore[arg-type]
        c_list = [candidate_authors] if isinstance(candidate_authors, str) else list(candidate_authors)  # type: ignore[arg-type]
        return _full_author_score(q_list, c_list)
    except Exception:  # noqa: BLE001
        return 0.0


_BOOK_REVIEW_TITLE_RE = re.compile(
    r"\b(?:book\s+review|reviewed\s+work)\b|\(\s*reviews?\s*\)|^\s*reviews?\s*[:\-]",
    re.IGNORECASE,
)


def is_book_review_mismatch(
    citation_title: str | None,
    citation_authors: Iterable[object] | object | None,
    candidate_title: str | None,
    candidate_authors: Iterable[object] | object | None,
    *,
    citation_venue: str | None = None,
    citation_raw: str | None = None,
    candidate_venue: str | None = None,
) -> bool:
    """Return True if candidate is a book review while the citation is citing the book itself."""
    c_title = (citation_title or "").strip()
    cand_title = (candidate_title or "").strip()
    if not cand_title:
        return False
    if "review" in c_title.lower():
        return False
    if _BOOK_REVIEW_TITLE_RE.search(cand_title):
        return True
    if citation_authors and candidate_authors:
        if author_match_score(citation_authors, candidate_authors) == 0.0:
            q_keys = author_keys(citation_authors)
            c_title_norm = normalize_text(c_title)
            cand_title_norm = normalize_text(cand_title)
            for qk in q_keys:
                if (
                    len(qk) >= 4
                    and re.search(rf"\b{re.escape(qk)}\b", cand_title_norm)
                    and not re.search(rf"\b{re.escape(qk)}\b", c_title_norm)
                ):
                    return True

        # Detect journal book reviews where Crossref lists [Reviewer, BookAuthor1, BookAuthor2]
        # in a periodical journal while the citation cites a multi-edition textbook/monograph.
        cand_list = (
            list(candidate_authors)
            if isinstance(candidate_authors, Iterable)
            and not isinstance(candidate_authors, (str, bytes))
            else [candidate_authors]
        )
        first_cand_key = author_key(cand_list[0]) if cand_list else ""
        q_keys = author_keys(citation_authors)
        cit_context_str = " ".join(
            p for p in (c_title, citation_venue or "", citation_raw or "") if p
        )
        has_book_signal = bool(
            re.search(
                r"\b(?:\d+(?:st|nd|rd|th)|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|revised)\s+ed(?:ition|\.)?\b"
                r"|\b(?:mcgraw-hill|wiley|john\s+wiley|pearson|addison-wesley|prentice\s+hall|o['\u2019]reilly|"
                r"mit\s+press|university\s+press|cengage|crc\s+press|morgan\s+kaufmann|routledge)\b",
                cit_context_str,
                re.IGNORECASE,
            )
            and not re.search(
                r"\b(?:journal\s+of|transactions\s+on|proceedings\s+of|technometrics|biometrics)\b",
                citation_venue or "",
                re.IGNORECASE,
            )
        )
        cand_is_periodical_journal = bool(
            candidate_venue
            and re.search(
                r"\b(?:journal|review|reviews|technometrics|biometrics|biometrika|"
                r"american\s+statistician|annals|quarterly|bulletin|magazine|interfaces|gazette|transactions)\b",
                candidate_venue,
                re.IGNORECASE,
            )
        )
        if (
            has_book_signal
            and cand_is_periodical_journal
            and first_cand_key
            and q_keys
            and first_cand_key not in q_keys
        ):
            return True
    return False


def year_key(value: str | int | None) -> int | None:
    """Parse a four-digit publication year, ignoring APA suffixes."""
    if value is None:
        return None
    match = _YEAR_RE.search(str(value))
    return int(match.group(0)) if match else None


def title_similarity(query: str | None, candidate: str | None) -> float:
    """Token-aware title similarity in ``[0, 1]``.

    A shorter extracted title that is fully contained in a longer database
    title is considered a strong match (e.g. ``BERT: Pre-training``).
    """
    query_tokens = set(title_tokens(query))
    candidate_tokens = set(title_tokens(candidate))
    if not query_tokens or not candidate_tokens:
        return 0.0
    if query_tokens < candidate_tokens and len(query_tokens) >= 3:
        norm_q = normalize_text(query)
        norm_c = normalize_text(candidate)
        if (
            len(query_tokens) / len(candidate_tokens) >= 0.60
            or norm_c.startswith(norm_q)
        ):
            return 0.95
    intersection = len(query_tokens & candidate_tokens)
    union = len(query_tokens | candidate_tokens)
    jaccard = intersection / union if union else 0.0
    sequence = SequenceMatcher(
        None,
        " ".join(sorted(query_tokens)),
        " ".join(sorted(candidate_tokens)),
    ).ratio()
    # Also check de-hyphenated similarity (e.g. "Scikitlearn" vs "Scikit-learn")
    q_dehyph = re.sub(r"(?<=\w)-(?=\w)", "", str(query or "")).casefold()
    c_dehyph = re.sub(r"(?<=\w)-(?=\w)", "", str(candidate or "")).casefold()
    dehyph_seq = SequenceMatcher(
        None,
        " ".join(title_tokens(q_dehyph)),
        " ".join(title_tokens(c_dehyph)),
    ).ratio()
    return max(jaccard, sequence, dehyph_seq)


def citation_key(citation: Citation) -> str:
    """Canonical key used to deduplicate retrieval work across citation forms."""
    doi = normalize_doi(citation.doi)
    if doi:
        return f"doi:{doi}"
    arxiv_id = normalize_arxiv_id(citation.url or citation.raw_text)
    if arxiv_id and re.fullmatch(r"\d{4}\.\d{4,5}", arxiv_id):
        return f"arxiv:{arxiv_id}"
    title = normalize_text(citation.title)
    authors = sorted(author_keys(citation.authors))
    year = year_key(citation.year)
    sfx = (getattr(citation, "year_suffix", None) or "").strip().lower()
    if not sfx and citation.year:
        m_sfx = re.search(r"(?:18|19|20)\d{2}([a-zA-Z])$", str(citation.year).strip())
        if m_sfx:
            sfx = m_sfx.group(1).lower()
    year_with_sfx = f"{year or ''}{sfx}"
    url_norm = (citation.url or "").strip().rstrip("/.,;").lower()
    if title:
        key = f"title:{title}|author:{','.join(authors[:3])}|year:{year_with_sfx}"
        if url_norm and (sfx or len(title.split()) <= 2):
            key = f"{key}|url:{url_norm}"
        return key
    if url_norm:
        return f"url:{url_norm}|year:{year_with_sfx}"
    return f"raw:{normalize_text(citation.raw_text)}"
