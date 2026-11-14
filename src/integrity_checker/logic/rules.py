"""SymbolicRules — decision table cho 4 nhãn (đề cương §5.6).

Mỗi rule là 1 hàm check điều kiện → trả ValidationLabel + reasoning + triggered_rules.

v1.2 §3.2.2 (task #33) — Mở rộng:
    - ``AMBIGUOUS_MAPPING`` rule: khi linker không quyết định được (2+ refs match
      cùng key) → force abstention (UNCERTAIN thay vì VERIFIED).
    - ``STYLE_INCONSISTENT`` rule: in-text citation không khớp style của paper →
      giảm confidence + thêm vào reasoning.
    - ``DOMAIN-EXCEPTION`` rule: URL/DOI trong citation broken nhưng scholarly
      record tồn tại (consensus ≥ 2 + best candidate found) → giữ
      ValidationLabel + cộng thêm vào evidence.

v1.2 §3.2.2 — Rules KHÔNG tự ý thay đổi ``mapping_status`` (CitationLinker là
chủ nhân duy nhất). Rules chỉ điều chỉnh ``label`` + ``confidence`` + ``reasoning``.

# TODO(user): tuần 12 — tinh chỉnh thresholds từ validation set.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from integrity_checker.config import get_settings
from integrity_checker.logging import get_logger
from integrity_checker.logic.completeness import assess_bibliographic_completeness
from integrity_checker.matching.fuzzy import FuzzyMatcher
from integrity_checker.matching.venue_normalizer import VenueNormalizer
from integrity_checker.models.source import SourceResult
from integrity_checker.models.validation import MatchFeatures, ValidationLabel

if TYPE_CHECKING:
    from integrity_checker.linking.statuses import CitationMappingStatus, StyleProfile

logger = get_logger(__name__)


# Known fake/non-academic URL domains — these should be flagged as SUSPECTED_HALLUCINATION
# even if they have valid-looking structure.
_KNOWN_FAKE_DOMAINS: set[str] = {
    "example.com",
    "example.org",
    "example.net",
    "example.edu",
    "test.com",
    "fake.com",
    "localhost",
}

# IETF RFC 2606 / RFC 6761 reserved top-level domains that never resolve on the public internet
_RESERVED_FAKE_TLDS: tuple[str, ...] = (
    ".invalid",
    ".test",
    ".example",
    ".localhost",
    ".fake",
)

_VENUE_STOP_TOKENS: frozenset[str] = frozenset(
    {
        "of", "the", "and", "in", "for", "on", "to", "a", "an",
        "de", "la", "le", "du", "des", "et", "fur", "für", "und", "der", "&",
    }
)

_REPO_DOI_VENUE_PREFIXES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("10.5281/zenodo", ("zenodo",)),
    ("10.48550/arxiv", ("arxiv",)),
    ("10.6084/", ("figshare",)),
    ("10.17632/", ("mendeley",)),
    ("10.5061/dryad", ("dryad",)),
    ("10.7910/dvn", ("dataverse",)),
    ("10.13140/rg", ("researchgate",)),
)

_ISO4_PURE_STEM_RE = re.compile(
    r"^(?:"
    r"(?:agro|bio|cosmo|cyto|electro|geo|histo|immuno|mechano|micro|mikro|neuro|petro|photo|phyto|radio|son|sono|stereo|thermo)?ch[ei]m|"
    r"(?:astro|bio|geo|metallo|neuro|photo|psychro|thermo)?phys|"
    r"(?:agro|astro|bio|geo|micro|mol|neuro|photo|phyto|radio|socio)?biol|"
    r"(?:bio|geo|nano)?eng|"
    r"(?:bio|nano)?technol|"
    r"(?:bio|nano|tele|vet)?med|"
    r"manage?|convers|resour|biorefin|sustain|env(?:iron)?|clim|conserv|biodivers|pollut|bioenerg|hydroelectr|"
    r"transduct|deliv|transl|ther(?:ap)?|chemother|immunother|diag|progn|prev|clin|surg|anesthesiol|emerg|"
    r"pharm(?:acol|aceut|acokinet)?|toxicol|ecotoxicol|mutagen|carcinog|"
    r"pathol|oncol|canc|neurol|neurosci|neurosurg|cardiol|vasc|hematol|pulm|respir|thorac|gastroenterol|hepatol|"
    r"endocrinol|diabet|metab|nutr|nephrol|urol|obstet|gynecol|reprod|perinat|neonatol|pediatr|geriatr|gerontol|"
    r"psychiatr|psychol|behav|cogn|rheumatol|orthop|rehabil|biomech|dermatol|ophthalmol|otolaryngol|stomatol|"
    r"radiol|ultrason|forens|epidemiol|hyg|occup|ergon|trop|virol|bacteriol|mycol|parasitol|immunol|allergol|vaccin|transpl|"
    r"genet|genom|proteom|metabolom|bioinform|biostat|biocatal|biosens|biomater|biomacromol|"
    r"evol|systemat|morphol|anatom|histol|cytol|embryol|physiol|zool|ornithol|entomol|phytopathol|agron|agric|hortic|silvic|aquac|pedol|irrig|"
    r"mater|catal|synth|polym|plast|elast|cellul|compos|nanocompos|nanomater|nanosci|nanophoton|"
    r"(?:bio|macro|supra)?mol|(?:bio|electro|immuno|micro|radio|thermo)?anal|"
    r"(?:bio|in|metallo)?org|organomet|anorg|allg|"
    r"quant|kinet|thermodyn|calorim|heterocycl|aliphat|aromat|fluor|pept|carbohydr|glycosci|nucleos|nucleot|"
    r"microelectron|optoelectron|semicond|supercond|dielectr|ferroelectr|piezoelectr|spintron|"
    r"luminesc|fluoresc|spectrosc|spectrom|chromatogr|electrophor|microsc|tomogr|crystallogr|"
    r"metall|ceram|corros|tribol|lubr|adhes|concr|rheol|"
    r"metrol|instrum|meas|sens|actuat|mechatron|aerosp|automat|veh|hydraul|therm|propuls|nucl|radiat|isot|"
    r"ecol|geol|geotech|paleontol|stratigr|sedimentol|seismol|hydrol|limnol|oceanogr|meteorol|climatol|atmos|astron|"
    r"sci|lett|rev|res|dev|innov|exp|theor|comput|simulat|optim|imag|recognit|intell|mach|"
    r"appl|ind|manuf|constr|archit|transp|logist|struct|syst|autom|acoust|vib|fract|fatig|aerodyn|hydrodyn|turbul|transf|refrig|cryog|"
    r"alg|geom|topol|calc|equat|probab|stoch|combinat|numer|approxim|cybernet|cryptol|softw|parall|distrib|multimed|"
    r"sociol|anthropol|archaeol|demogr|geogr|econ|econometr|financ|admin|strateg|entrep|polit|publ|diplom|jurisp|legis|criminol|educ|pedagog|curric|hist|philos|libr|"
    r"interf|sep|purif|dis|discov|funct|healthc|annu|acc|coord|memb|antioxid|cryst|des|simul|cognit|"
    r"theranost|regener|transfus|palliat|marit|aviat|auton|decis|reliab|"
    r"soc|assoc|acad|inst|found|univ|dept|sect|ser|suppl|ed|pt|"
    r"trans|commun|comm|proc|ann|acta|zeit|monogr|symp|conf|cong|worksh|acct|"
    r"natl|int|eur|am|amer|jpn|aust|russ|brit|br|ger|fr|ital|kor|helv|scand|gazz|roy|inf"
    r")$",
    flags=re.IGNORECASE,
)

_ISO4_ORTHO_SUFFIX_RE = re.compile(
    r"(?:nsduct|deliv|transl|convers|resour|biorefin|sustain|environ|"
    r"biomol|bioorg|organomet|comput|agric|pharmacol|toxicol|spectrosc|"
    r"chromatogr|crystallogr|optoelectron|microelectron|semicond|supercond|"
    r"ferroelectr|piezoelectr|dielectr|luminesc|fluoresc|electrophor|"
    r"paleontol|sedimentol|oceanogr|meteorol|climatol|astrophys|biodivers|"
    r"ecotoxicol|pharmacokinet|gastroenterol|endocrinol|neonatol|gerontol|"
    r"neuropharmacol|psychopharmacol|otolaryngol|ophthalmol|epidemiol|"
    r"bacteriol|parasitol|biotechnol|nanotechnol|macromol|supramol|"
    r"thermodyn|mechanochem|electrochem|photochem|radiochem|sonochem|"
    r"biochem|geochem|neurochem|phytochem|agrochem|histochem|immunochem|cytochem)$",
    flags=re.IGNORECASE,
)


def _is_iso4_abbreviated_stem(stem: str, right_clean: str | None = None) -> bool:
    """Return True if ``stem`` is an LTWA/CASSI abbreviated stem in a Title-Case clause."""
    s = (stem or "").strip().rstrip(".")
    if not s:
        return False
    if right_clean is not None and " " not in right_clean and not right_clean.endswith("."):
        return False
    if _ISO4_PURE_STEM_RE.fullmatch(s):
        return True
    if len(s) >= 4 and _ISO4_ORTHO_SUFFIX_RE.search(s):
        return True
    return False


def _is_unquoted_title_clause_before_dot(left_full: str, right: str | None = None) -> bool:
    """ISO 4:1997 §4.1/§4.2 detector distinguishing unquoted article titles from journal names."""
    right_clean: str | None = None
    if right is not None:
        right_clean = right.strip().rstrip(",").strip()
        if not right_clean or not re.match(r"^[A-Z]", right_clean):
            return False
        if re.match(
            r"^(?:Int\.\s*Ed\.(?:\s*Engl\.)?|U\.\s*S\.\s*A\.|U\.S\.A\.|S\.\s*A\.|"
            r"(?:Part|Ser\.|Series|Sect\.|Section|Suppl\.)\s+[A-Z0-9]+\.?)$",
            right_clean,
            flags=re.IGNORECASE,
        ):
            return False
        if " " not in right_clean:
            if right_clean.endswith("."):
                return False
            if re.fullmatch(r"[IVX]+|[A-Z]", right_clean):
                return False

    parts = re.split(r"(?<=\.)\s+(?=[A-Z0-9\"\u201c'\u2018(])", (left_full or "").strip())
    clause = parts[-1].strip() if parts else ""
    tokens = [
        t.strip(",:()\"'\u201c\u201d\u2018\u2019[]")
        for t in clause.split()
        if t.strip(",:()\"'\u201c\u201d\u2018\u2019[]")
    ]
    if len(tokens) < 2:
        return False
    if re.match(
        r"^(?:Journal|Proceedings|Transactions|Bulletin|Annals|Annales|Zeitschrift)\s+(?:of|f[uü]r|de|des)\b",
        clause,
        flags=re.IGNORECASE,
    ):
        return False

    foreign_journal_links = {"für", "fur", "de", "du", "des", "der", "la", "le"}
    if any(
        t[0].isalpha() and t[0].islower() and t.rstrip(".").lower() not in foreign_journal_links
        for t in tokens
    ):
        return True

    if (
        right_clean is not None
        and re.search(r"\bEarth\s+Planet\.?$", clause, flags=re.IGNORECASE)
        and re.match(r"^Sci\b", right_clean, flags=re.IGNORECASE)
    ):
        return False

    last_bare = tokens[-1].rstrip(".")
    if not last_bare:
        return False
    if len(last_bare) == 1 and last_bare not in {"I", "V"}:
        return False
    if _is_iso4_abbreviated_stem(last_bare, right_clean):
        return False

    if (
        parts[:-1]
        and all(
            all(
                w.endswith(".")
                or bool(re.fullmatch(r"[A-Z0-9]{1,8}", w))
                or w.lower() in _VENUE_STOP_TOKENS
                for w in p.split()
            )
            for p in parts[:-1]
        )
        and len(tokens) == 2
    ):
        return False

    prior_tokens = [t for t in tokens[:-1] if t.rstrip(".").lower() not in _VENUE_STOP_TOKENS]
    unabbrev_prior = [t for t in prior_tokens if not t.endswith(".")]
    return len(unabbrev_prior) >= 1


def _has_sentence_period_in_venue(
    venue: str | None, citation_raw: str | None = None
) -> bool:
    """Return True if ``venue`` structurally contains an unquoted sentence/title before ``. ``."""
    v = (venue or "").strip()
    if not v or ". " not in v:
        return False
    if not v.endswith(".") and citation_raw and f"{v}." in citation_raw:
        v = f"{v}."
    for m_dot in re.finditer(r"\.\s+(?=[A-Z])", v):
        left_with_dot = v[: m_dot.start() + 1].strip()
        right = v[m_dot.end() :].strip()
        if _is_unquoted_title_clause_before_dot(left_with_dot, right):
            return True
    return False


def _raw_has_unparsed_title_before_venue(
    citation_raw: str | None,
    citation_venue: str | None,
) -> bool:
    """Return True if ``citation_raw`` has an unparsed ``. ``-delimited title right before ``venue``."""
    raw = (citation_raw or "").strip()
    ven = (citation_venue or "").strip().rstrip(".,;")
    if not raw or not ven:
        return False
    idx = raw.lower().find(ven.lower())
    if idx <= 0:
        return False
    prefix = raw[:idx].strip()
    if not prefix.endswith("."):
        return False
    tail = re.split(r"(?:[,;]|\b[A-ZÀ-Ý]\.)\s+", prefix)[-1].strip()
    return _is_unquoted_title_clause_before_dot(tail, citation_venue)


def _iso4_token_matches_word(abbr_tok: str, full_word: str) -> bool:
    if abbr_tok == full_word:
        return True
    if len(abbr_tok) == 1:
        return bool(
            (abbr_tok == "j" and full_word.startswith("journal"))
            or (abbr_tok == "z" and full_word.startswith("zeitschrift"))
            or (abbr_tok == "c" and full_word.startswith(("comptes", "chemical", "chemistry")))
            or (abbr_tok == "r" and full_word.startswith(("rendus", "review", "royal")))
            or (abbr_tok == "b" and full_word.startswith(("bulletin", "part")))
        )
    if full_word.startswith(abbr_tok):
        return True
    return bool(
        (abbr_tok == "natl" and full_word.startswith("national"))
        or (abbr_tok == "intl" and full_word.startswith("international"))
        or (abbr_tok == "angew" and full_word.startswith("angewandte"))
        or (abbr_tok == "accts" and full_word.startswith("accounts"))
        or (abbr_tok == "trans" and full_word.startswith("transactions"))
    )


def _iso4_tokens_align(abbr_toks: list[str], full_toks: list[str]) -> bool:
    if not abbr_toks or not full_toks or not any(len(t) >= 3 for t in abbr_toks):
        return False
    pos = 0
    matched = 0
    unmatched_abbr: list[str] = []
    for tok in abbr_toks:
        scan = pos
        while scan < len(full_toks) and not _iso4_token_matches_word(tok, full_toks[scan]):
            scan += 1
        if scan < len(full_toks):
            matched += 1
            pos = scan + 1
        else:
            unmatched_abbr.append(tok)
    if (
        matched == len(full_toks)
        and len(full_toks) >= 2
        and unmatched_abbr
        and all(t in {"u", "s", "usa", "uk", "int", "intl", "ed", "engl"} for t in unmatched_abbr)
    ):
        return True
    if len(abbr_toks) >= 2 and matched == len(abbr_toks):
        return True
    min_req = len(abbr_toks) - 1 if len(abbr_toks) >= 4 else len(abbr_toks)
    if matched < max(1, min_req):
        return False
    return (matched / max(len(abbr_toks), len(full_toks))) >= 0.50


def _venues_compatible_for_titleless_ref(
    citation_venue: str | None,
    cand_venue: str | None,
    venue_sim: float = 0.0,
    doi: str | None = None,
) -> bool:
    """Return True when ``citation_venue`` and ``cand_venue`` match or ISO-4 align."""
    if not citation_venue or not citation_venue.strip():
        return False
    if _has_sentence_period_in_venue(citation_venue):
        return False
    doi_norm = (doi or "").strip().lower()
    cit_ven_lower = citation_venue.strip().lower()
    if doi_norm:
        for prefix, allowed_hosts in _REPO_DOI_VENUE_PREFIXES:
            if doi_norm.startswith(prefix) and not any(h in cit_ven_lower for h in allowed_hosts):
                return False
    if not cand_venue or not cand_venue.strip():
        return False
    if venue_sim >= 0.45 or VenueNormalizer().similarity(citation_venue, cand_venue) >= 0.45:
        return True

    def _toks(s: str) -> list[str]:
        out: list[str] = []
        for raw_t in re.split(r"[\s/&–—\-(),:;]+", s.lower()):
            t = raw_t.strip(".")
            if t and t not in _VENUE_STOP_TOKENS:
                out.append(t)
        return out

    toks_c = _toks(citation_venue)
    toks_b = _toks(cand_venue)
    return _iso4_tokens_align(toks_c, toks_b) or _iso4_tokens_align(toks_b, toks_c)


def _is_fake_url(url: str | None) -> tuple[bool, str]:
    """Check if URL domain is clearly fake/non-academic.

    Returns:
        (is_fake, matched_domain) — matched domain name if fake, empty string otherwise.
    """
    if not url:
        return False, ""
    url_lower = url.lower()
    # Check for localhost / IP address patterns
    if "localhost" in url_lower or "127.0.0.1" in url_lower:
        return True, "localhost/127.0.0.1"
    # Parse domain from URL
    from urllib.parse import urlparse
    try:
        parsed = urlparse(url)
        domain = parsed.netloc.lower()
        # Remove port if present
        if ":" in domain:
            domain = domain.split(":")[0]
        # Check against known fake domains
        for fake in _KNOWN_FAKE_DOMAINS:
            if domain == fake or domain.endswith("." + fake):
                return True, fake
        # Check obvious placeholder domain prefixes like fake-academic-portal.*
        host_bare = domain[4:] if domain.startswith("www.") else domain
        if host_bare.startswith(("fake-", "placeholder-")):
            return True, domain
    except Exception:
        # Fallback: check if domain appears directly in URL string
        for fake in _KNOWN_FAKE_DOMAINS:
            if fake in url_lower and ("://" + fake in url_lower or url_lower.startswith(fake)):
                return True, fake
    return False, ""


# Known fabricated DOI patterns — these DOIs look suspicious and should be flagged
# as suspected_hallucination when no real academic source confirms them.
# Merged from module-level and class-level duplicates (2026-09-15).
_FABRICATED_DOI_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"10\.1234/(?:ncr|fake|fab|hallucination)", re.IGNORECASE),
    re.compile(r"10\.9999?/(?:jmle|fake|fab|pseudonym)", re.IGNORECASE),
    re.compile(r"10\.\d{4,}/(?:nonexistent|imaginary|temp)", re.IGNORECASE),
    re.compile(r"10\.0000/", re.IGNORECASE),
    re.compile(r"10\.\d{4,}/(?:paper-\d+|fake-\w+)", re.IGNORECASE),
]


# Known fake author patterns — these author names are clearly fabricated
# Added v1.4 for better fake author detection
_KNOWN_FAKE_AUTHORS: list[re.Pattern[str]] = [
    re.compile(r"\b(fictional|fabricated|fake|counterfeit|phantom|hypothetical|mystery|synthetic)\b.*\b(scholar|author|researcher|scientist|writer|investigator)\b", re.IGNORECASE),
    re.compile(r"^\s*(?:fictional|fabricated|fake|counterfeit|phantom|hypothetical|mystery|synthetic)\s+(?:paper|research|study)\s*$", re.IGNORECASE),
    re.compile(r"\b(artificial|mock|pseudo|fraudulent)\b.*\b(author|scholar|researcher|scientist|writer)\b", re.IGNORECASE),
    re.compile(r"\b(?:placeholder|anonymous|unknown|unnamed)\s+(?:author|scholar|researcher|scientist|writer|name|person|investigator)s?\b", re.IGNORECASE),
    re.compile(r"\b(?:john|jane)\s+(?:doe|roe)\b", re.IGNORECASE),
    re.compile(r"^\s*(?:unknown|unnamed|anonymous)(?:\s*,\s*[A-Z]\.?|\s+et\s+al\.?)?\s*$", re.IGNORECASE),
    re.compile(r"\b(example|sample|test)\b.*\b(author|scholar|researcher)\b", re.IGNORECASE),
    # CamelCase suspicious names like "MysteryPaper", "FakeAuthor", "HypotheticalResearch"
    # Note: case-sensitive so plain words like "Artificial" or "Synthetic" do NOT match without a second Uppercase hump
    re.compile(r"\b(?:[Ff]ictional|[Ff]abricated|[Ff]ake|[Cc]ounterfeit|[Pp]hantom|[Hh]ypothetical|[Mm]ystery|[Ss]ynthetic|[Aa]rtificial|[Uu]nknown|[Pp]seudo)[a-z]*[A-Z]\w*\b"),
]


# Source names that represent locally-cached metadata rather than a live API
# round-trip.  A result backed only by these must not be treated as if it were
# independently corroborated by an external registry.
_NON_LIVE_SOURCES: frozenset[str] = frozenset({"local_db", "known_papers"})


def _is_clean_no_result_message(err: str | None) -> bool:
    """Return True when a scholarly client responded cleanly (HTTP 200) with no match."""
    if not err:
        return False
    lower = err.lower()
    return "no results for" in lower or "no title match" in lower


def _has_substantive_citation_metadata(
    citation_raw: str | None,
    source_citation_raw: str | None,
    citation_authors: list | None,
    citation_year: str | None,
) -> bool:
    """Return True if the citation has real bibliographic metadata (not a bare unit-test stub)."""
    raw_str = (citation_raw or source_citation_raw or "").strip()
    has_year_in_raw = bool(re.search(r"\b(?:19|20)\d{2}\b", raw_str))
    return bool(
        citation_authors
        or citation_year
        or (len(raw_str) >= 25 and has_year_in_raw)
    )


_PERIODICAL_JOURNAL_SIGNAL_RE = re.compile(
    r"\b(?:"
    r"journal\s+of|international\s+journal|proceedings\s+of|transactions\s+on|"
    r"conference\s+on|symposium\s+on|workshop\s+on|annals\s+of|bulletin\s+of|"
    r"archives\s+of|quarterly\s+journal|european\s+journal|american\s+journal|"
    r"british\s+journal|asian\s+journal|australian\s+journal|canadian\s+journal|"
    r"ieee\s+(?:transactions|journal|access|letters|software|network|communications|spectrum)|"
    r"acm\s+(?:transactions|computing\s+surveys)|"
    r"nature\s+[a-z]+|lancet|jama|bmj|plos\s+one|frontiers\s+in|sensors|energies|sustainability|"
    r"vol\.\s*\d+|no\.\s*\d+|pp\.\s*\d+\s*[-–—]\s*\d+"
    r")\b"
    r"|,\s*\d{1,4}\s*\(\s*\d{1,3}\s*\)\s*,\s*(?:e?\d+|\d+\s*[-–—]\s*\d+)\b",
    re.IGNORECASE,
)

_CLASSICAL_OR_BIBLE_SIGNAL_RE = re.compile(
    r"\b(?:"
    r"holy\s+bible|the\s+bible|\besv\b|\bniv\b|\bkjv\b|\bnrsv\b|\bnasb\b|\bnkjv\b|"
    r"english\s+standard\s+version|new\s+international\s+version|king\s+james\s+version|"
    r"shakespeare|plato|aristotle|aquinas|augustine|homer|sophocles|euripides|aeschylus|"
    r"cicero|virgil|ovid|seneca|marcus\s+aurelius|epictetus|plutarch|herodotus|thucydides|"
    r"dante|chaucer|milton|cervantes|machiavelli|hobbes|locke|rousseau|kant|hegel|nietzsche|"
    r"kierkegaard|dostoevsky|tolstoy|dickens|austen|bront[eë]|melville|hawthorne|twain|"
    r"project\s+gutenberg|gutenberg\.org|oxford\s+world['’]?s\s+classics|penguin\s+classics|"
    r"loeb\s+classical\s+library|translated\s+by|trans\.\s+[A-Z]"
    r")\b",
    re.IGNORECASE,
)

_THESIS_OR_REPORT_SIGNAL_RE = re.compile(
    r"\b(?:"
    r"master['’]?s\s+thesis|doctoral\s+dissertation|phd\s+thesis|honours\s+thesis|honors\s+thesis|"
    r"senior\s+thesis|bachelor['’]?s\s+thesis|unpublished\s+(?:master|doctoral|thesis|dissertation|manuscript)|"
    r"proquest\s+dissertations|digitalcommons|scholarscentre|scholars\s+crossing|liberty\s+university|"
    r"technical\s+report|working\s+paper|white\s+paper|policy\s+brief|fact\s+sheet|"
    r"u\.?s\.?\s+department\s+of|ministry\s+of|world\s+health\s+organization|united\s+nations|"
    r"national\s+institute\s+of|centers\s+for\s+disease\s+control|bureau\s+of\s+labor\s+statistics|"
    r"substance\s+abuse\s+and\s+mental\s+health|security\s+risk\s+advisors|crowdstrike|mandiant|"
    r"khóa\s+luận(?:\s+tốt\s+nghiệp)?|khoá\s+luận(?:\s+tốt\s+nghiệp)?|"
    r"luận\s+văn(?:\s+thạc\s+sĩ|\s+tốt\s+nghiệp)?|luận\s+án(?:\s+tiến\s+sĩ)?|"
    r"đồ\s+án\s+tốt\s+nghiệp|tiểu\s+luận|masterarbeit|bachelorarbeit|"
    r"báo\s+cáo\s+(?:thường\s+niên|tài\s+chính|phân\s+tích|thị\s+trường|tổng\s+kết|nghiên\s+cứu)|"
    r"annual\s+report|financial\s+report|sổ\s+tay\s+vận\s+hành"
    r")\b",
    re.IGNORECASE,
)

_LEGAL_OR_STANDARD_SIGNAL_RE = re.compile(
    r"\b(?:"
    r"quốc\s+hội|chính\s+phủ|thủ\s+tướng|bộ\s+[a-zà-ỹ]+|"
    r"nghị\s+định(?:\s+số|\s+\d+|\s+của|\s+về|\s+quy\s+định)|"
    r"thông\s+tư(?:\s+liên\s+tịch|\s+số|\s+\d+|\s+của|\s+hướng\s+dẫn|\s+quy\s+định)|"
    r"(?<!cây\s)(?<!ra\s)quyết\s+định(?:\s+số|\s+\d+|\s+của|\s+về|\s+ban\s+hành|\s+phê\s+duyệt)|"
    r"luật\s+số|bộ\s+luật|hiến\s+pháp|u\.?s\.?c\.?\s*§|c\.?f\.?r\.?\s*§|pub\.\s*l\.\s*no\.|"
    r"iso/iec\s*\d+|nist\s+special\s+publication|nist\s+sp\s*\d+|rfc\s*\d+|"
    r"tcvn\s+(?:iso(?:/iec)?\s+)?\d+|qcvn\s+[a-zđ0-9]+"
    r")\b",
    re.IGNORECASE,
)

_BOOK_PUBLISHER_SIGNAL_RE = re.compile(
    r"\b(?:"
    r"isbn(?:-1[03])?|(?:1st|2nd|3rd|\d+th|first|second|third|fourth|fifth|revised|expanded)\s+(?:ed\.?|edition)|"
    r"university\s+press|oxford\s+university\s+press|cambridge\s+university\s+press|"
    r"harvard\s+university\s+press|mit\s+press|princeton\s+university\s+press|yale\s+university\s+press|"
    r"stanford\s+university\s+press|uchicago\s+press|university\s+of\s+chicago\s+press|"
    r"routledge|sage\s+publications|palgrave\s+macmillan|bloomsbury|penguin|random\s+house|"
    r"harper\s*collins|harper\s*one|simon\s*&\s*schuster|farrar,\s*straus|knopf|doubleday|"
    r"norton|w\.\s*w\.\s*norton|little,\s*brown|hachette|macmillan|scholastic|"
    r"wiley|john\s+wiley|pearson|mcgraw-hill|prentice\s+hall|addison-wesley|o['’]reilly|"
    r"springer\s+nature|academic\s+press|crc\s+press|elsevier\s+books|de\s+gruyter|brill|"
    r"zondervan|crossway|baker\s+academic|baker\s+books|baker\s+publishing|eerdmans|"
    r"intervarsity\s+press|ivp\s+academic|ivp\s+books|brazos\s+press|thomas\s+nelson|"
    r"b&h\s+publishing|b&h\s+academic|holman|tyndale|moody\s+publishers|waterbrook|"
    r"westminster\s+john\s+knox|fortress\s+press|abingdon\s+press|ignatius\s+press|"
    r"cody-cassidy\s+press|morgan\s+kaufmann|free\s+press|manning\s+publications|no\s+starch\s+press|apress|packt|"
    r"phi\s+learning|library\s+of\s+congress\s+cataloging|"
    r"giáo\s+trình|bài\s+giảng|tập\s+bài\s+giảng|đề\s+cương\s+bài\s+giảng|tài\s+liệu\s+học\s+tập|"
    r"tài\s+liệu\s+hướng\s+dẫn|cẩm\s+nang|sách\s+chuyên\s+khảo|chủ\s+biên|"
    r"lưu\s+hành\s+nội\s+bộ|trường\s+đại\s+học|đại\s+học\s+(?:quốc\s+gia|bách\s+khoa|cần\s+thơ|dân\s+lập|kinh\s+tế|sư\s+phạm|thái\s+nguyên)|"
    r"đh\s+kinh\s+tế|học\s+viện|văn\s+hóa\s+thông\s+tin|thư\s+viện\s+quốc\s+gia\s+việt\s+nam|"
    r"nhà\s+xuất\s+bản|\bnxb\b"
    r")\b",
    re.IGNORECASE,
)


def _is_non_journal_or_unindexed_source(
    citation_raw: str | None,
    citation_url: str | None = None,
    citation_doi: str | None = None,
    citation_authors: list | None = None,
) -> tuple[bool, str]:
    """Identify legitimate non-journal / non-indexed sources (BUG-22) so they are not
    falsely flagged as SUSPECTED_HALLUCINATION when academic paper APIs return 0 matches.

    Returns:
        (is_non_journal, category) where category is one of:
        'web_resource', 'legal_or_standard', 'classical_or_scriptural',
        'thesis_or_report', 'book_or_monograph', or ''.
    """
    if citation_doi and str(citation_doi).strip():
        return False, ""

    raw = (citation_raw or "").strip()
    url = (citation_url or "").strip()
    combined = f"{raw} {url}".strip()
    if not combined:
        return False, ""

    # If it explicitly looks like a journal/conference periodical article, it SHOULD be
    # indexed in scholarly databases — do not exempt it from hallucination rules.
    if _PERIODICAL_JOURNAL_SIGNAL_RE.search(raw):
        return False, ""

    # 1. Legal / regulatory / technical standard documents
    if _LEGAL_OR_STANDARD_SIGNAL_RE.search(combined):
        return True, "legal_or_standard"

    # 2. Web / audiovisual / online media / documentation URLs (without DOI/arXiv)
    if url and re.match(r"^https?://", url, re.IGNORECASE):
        if not re.search(r"(?:doi\.org|arxiv\.org|aclanthology\.org|ieee\.org|acm\.org|springer\.com|sciencedirect\.com|nature\.com|wiley\.com)", url, re.IGNORECASE):
            return True, "web_resource"
    if re.search(
        r"(?:\b(?:youtube\.com|youtu\.be|Retrieved\s+[A-Z][a-z]+\s+\d{1,2},\s+\d{4},\s+from\s+https?://)\b|(?:^|[\s.,;])\[(?:Video|Online)\](?!\w)|\bTruy\s+cập\s+ngày\s+\d{1,2}\s*(?:[/-]|tháng)\s*\d{1,2}\s*(?:[/-]|năm)\s*(?:19|20)\d{2}\b)",
        combined,
        re.IGNORECASE,
    ):
        return True, "web_resource"

    # 3. Classical literature, philosophy, plays, or Bible editions
    if _CLASSICAL_OR_BIBLE_SIGNAL_RE.search(combined):
        return True, "classical_or_scriptural"

    # 4. Theses, dissertations, working papers, or government/institutional reports
    if _THESIS_OR_REPORT_SIGNAL_RE.search(combined):
        if not re.search(
            r"\b(?:imaginaire|imaginary|fictional|fabricated|nonexistent|hal-0999|tel-0999)\b",
            combined,
            re.IGNORECASE,
        ):
            return True, "thesis_or_report"

    # 5. Books / monographs with explicit book publishers, editions, or ISBNs
    if _BOOK_PUBLISHER_SIGNAL_RE.search(combined):
        return True, "book_or_monograph"

    # 6. Domestic Vietnamese periodicals / proceedings without international DOI (BUG-09)
    if (
        not (citation_doi and str(citation_doi).strip())
        and re.search(
            r"[ăâđêôơưáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]",
            combined,
            re.IGNORECASE,
        )
        and re.search(
            r"\b(?:tạp\s+chí|kỷ\s+yếu(?:\s+hội\s+(?:thảo|nghị))?|hội\s+(?:thảo|nghị)\s+khoa\s+học|thông\s+báo\s+khoa\s+học|chuyên\s+san|nhà\s+xuất\s+bản|nxb\.?)\b",
            combined,
            re.IGNORECASE,
        )
        and not re.search(
            r"\b(?:imaginaire|imaginary|fictional|fabricated|nonexistent|giả\s+lập|hư\s+cấu)\b",
            combined,
            re.IGNORECASE,
        )
    ):
        return True, "domestic_unindexed_periodical"

    return False, ""


_INCOMPLETE_EXEMPT_NON_JOURNAL_KINDS: frozenset[str] = frozenset(
    {"web_resource", "legal_or_standard", "classical_or_scriptural"}
)


def _is_exempt_from_incomplete_metadata(
    citation_raw: str | None,
    citation_url: str | None = None,
    citation_doi: str | None = None,
    citation_authors: list | None = None,
) -> bool:
    """Return True only when a bibliography entry belongs to a genuine non-academic /
    statutory / scriptural / web category that naturally omits author/year/venue.
    """
    is_nj, nj_kind = _is_non_journal_or_unindexed_source(
        citation_raw,
        citation_url=citation_url,
        citation_doi=citation_doi,
        citation_authors=citation_authors,
    )
    return bool(is_nj and nj_kind in _INCOMPLETE_EXEMPT_NON_JOURNAL_KINDS)


def _has_live_source(
    source: SourceResult,
    verified_sources: list[str],
) -> bool:
    """True when at least one *live* (non-cache) source backed this result.

    Most callers populate ``sources_succeeded``.  Some legacy callers only
    provide candidates, in which case the candidate's ``source_name`` is used
    as the effective provenance instead of rejecting an otherwise valid match.
    """
    if verified_sources:
        return True
    if source.sources_succeeded:
        # All succeeded sources were cache-backed → no live confirmation.
        return False
    return any(
        cand.found and cand.source_name not in _NON_LIVE_SOURCES
        for cand in source.candidates
    )


def _is_fake_author_name(
    raw_text: str | None,
    citation_authors: list | None = None,
) -> tuple[bool, str]:
    """Check if citation author name is clearly fake/fabricated.

    Only inspects genuine author slots (parsed authors that are not sliced first-words
    of year-less bare titles, or the author prefix preceding `(Year)` / `Author. Title`)
    so real or incomplete student titles containing words like 'Artificial', 'Synthetic',
    'Unknown', 'Anonymous', or 'Fake News' are never falsely flagged.

    Returns:
        (is_fake, matched_pattern) — True if author looks fake, empty string otherwise.
    """
    if not raw_text and not citation_authors:
        return False, ""

    raw_stripped = re.sub(
        r"^\s*(?:\[\s*\d+[a-z]?\s*\]|\(\s*\d+[a-z]?\s*\)|\d+[a-z]?[.)])\s*",
        "",
        (raw_text or "").strip(),
    )
    year_match = (
        re.search(
            r"\(\s*(?:18|19|20)\d{2}[a-z]?\s*\)|\b(?:18|19|20)\d{2}[a-z]?\b",
            raw_stripped,
        )
        if raw_stripped
        else None
    )

    author_parts: list[str] = []
    if citation_authors:
        for a in citation_authors:
            if hasattr(a, "raw") and getattr(a, "raw", ""):
                a_str = str(a.raw).strip()
            elif hasattr(a, "last_name") and getattr(a, "last_name", ""):
                first_val = getattr(a, "first_name", "") or ""
                a_str = f"{first_val} {a.last_name}".strip()
            else:
                a_str = str(a).strip()

            if not a_str:
                continue

            # Guard against GROBID/regex slicing the first word of a year-less bare title
            # (e.g. "[2] Artificial intelligence in healthcare" -> authors=["Artificial"],
            # "[2] Unknown input observer design" -> authors=["Unknown"]).
            a_words = re.findall(r"[A-Za-zÀ-ỹ'\u2019\-]+", a_str)
            if (
                len(a_words) == 1
                and "," not in a_str
                and "." not in a_str
                and raw_stripped
                and not year_match
            ):
                m_lead = re.match(rf"^{re.escape(a_words[0])}(.*)$", raw_stripped, re.IGNORECASE)
                if m_lead:
                    rest = m_lead.group(1)
                    has_author_delim = bool(
                        re.match(
                            r"^(?:\s*[,.;:]|\s+[A-ZÀ-Ỹ]\.|\s+et\s+al\b|\s*(?:&|and)\s+[A-ZÀ-Ỹ])",
                            rest,
                        )
                    )
                    has_fake_role_noun = bool(
                        re.match(
                            r"^\s+(?:author|scholar|researcher|scientist|writer|name)\b",
                            rest,
                            re.IGNORECASE,
                        )
                    )
                    if not has_author_delim and not has_fake_role_noun:
                        continue

            author_parts.append(a_str)

    if raw_stripped:
        if year_match:
            prefix = raw_stripped[: year_match.start()].strip().rstrip(".,;:")
        else:
            # Year-less reference: only take a clear `Author. CapitalizedTitle` prefix
            # (never scan a year-less bare title or multi-word lowercase sentence as an author).
            m_author_sent = re.match(r"^([^.]{2,60})\.\s+[A-ZÀ-Ỹ]", raw_stripped)
            cand_prefix = m_author_sent.group(1).strip() if m_author_sent else ""
            if cand_prefix and re.search(r"\b[a-zà-ỹ]{3,}\s+[a-zà-ỹ]{3,}\b", cand_prefix):
                cand_prefix = ""
            prefix = cand_prefix
        if prefix:
            author_parts.append(prefix)

    for part in author_parts:
        part_clean = part.strip().rstrip(".,;:")
        for pattern in _KNOWN_FAKE_AUTHORS:
            match = pattern.search(part_clean)
            if match:
                return True, match.group(0)

    # Check for explicit fake author persona at the start of raw_stripped
    suspicious_author_patterns = [
        r"^[\(\s]*(?:fictional|fabricated|fake|counterfeit|phantom|hypothetical|mystery|synthetic|artificial|mock|pseudo|placeholder|anonymous|unknown|unnamed)\s+(?:scholar|author|researcher|scientist|writer|name)\b",
        r"^[\(\s]*(?:john|jane)\s+(?:doe|roe)\b",
        r"^[\(\s]*example\s+(?:scholar|author|researcher)\b",
        r"^[\(\s]*test\s+(?:author|scholar|researcher)\b",
    ]

    raw_lower = raw_stripped.lower()
    for pattern in suspicious_author_patterns:
        m_susp = re.search(pattern, raw_lower, re.IGNORECASE)
        if m_susp:
            return True, m_susp.group(0).strip()

    return False, ""


@dataclass
class RuleOutcome:
    label: ValidationLabel
    confidence: float            # 0.0–1.0
    reasoning: str
    triggered_rules: list[str]
    mismatched_fields: list[str]  # chỉ dùng cho METADATA_ERROR
    style_penalty: float = 0.0    # NEW v1.2 — penalty applied nếu STYLE_INCONSISTENT
    domain_exception: bool = False  # NEW v1.2 — DOMAIN-EXCEPTION triggered


class SymbolicRules:
    """Apply symbolic rules trên (MatchFeatures, SourceResult) → RuleOutcome.

    v1.2 §3.2.2 (task #33): apply() giờ nhận thêm:
        - ``mapping_status``: CitationMappingStatus từ CitationLinker.
        - ``style_profile``: StyleProfile từ StyleDetector.
    """

    def __init__(self) -> None:
        s = get_settings()
        self.title_sim_verified = s.matching.title_sim_verified
        self.title_sim_metadata_error = s.matching.title_sim_metadata_error
        self.author_jaccard_verified = s.matching.author_jaccard_verified
        self.year_tolerance = s.matching.year_tolerance
        self.abstention_low = s.logic.abstention_low
        self.abstention_high = s.logic.abstention_high
        self.consensus_verified = s.logic.require_consensus_for_verified
        self.consensus_metadata_error = s.logic.require_consensus_for_metadata_error
        # NEW v1.2 — STYLE_INCONSISTENT confidence penalty (0–1)
        self.style_inconsistent_penalty = 0.15
        self.ambiguous_confidence_cap = 0.5   # cap confidence nếu AMBIGUOUS_MAPPING
        # FIX v1.4: FuzzyMatcher for title similarity checks
        self.fuzzy = FuzzyMatcher()

    def _rule_local_db_verified(
        self,
        source: SourceResult,
        features: MatchFeatures,
        style_penalty: float = 0.0,
        citation_doi: str | None = None,
        citation_authors: list[str] | None = None,
    ) -> RuleOutcome | None:
        """Rule: LOCAL_DB only with perfect match → VERIFIED.

        When local_db (optionally with known_papers) is the only source that found
        a match with:
        - title_sim_fuzzy >= 0.90 and title_sim >= 0.95
        - author_sim >= 0.8 (or authorless entry with exact DOI/arXiv + title_sim_fuzzy >= 0.95)
        - year_distance == 0

        This is a trusted match because local_db/known_papers are curated knowledge bases.
        """
        # Chỉ apply nếu best candidate đến từ local source (local_db hoặc known_papers)
        if not source.sources_succeeded:
            return None
        best = source.best_candidate()
        if not best:
            return None
        if best.source_name not in _NON_LIVE_SOURCES and any(
            s not in _NON_LIVE_SOURCES for s in source.sources_succeeded
        ):
            return None

        # Check thresholds (require fuzzy title match to prevent semantic inflation)
        title_sim = max(features.title_sim_fuzzy, features.title_sim_semantic)
        author_sim = features.author_jaccard
        year_dist = features.year_distance

        is_arxiv_vs_pub_doi = bool(
            citation_doi
            and best.doi
            and (
                "10.48550/arxiv" in citation_doi.lower()
                or "10.48550/arxiv" in best.doi.lower()
            )
            and features.title_sim_fuzzy >= 0.90
        )
        has_real_doi_conflict = bool(
            citation_doi
            and best.doi
            and not features.doi_exact_match
            and not is_arxiv_vs_pub_doi
        )
        if has_real_doi_conflict:
            return None

        # Perfect match: fuzzy title >= 0.90, title >= 0.95 AND author >= 0.8 AND year match
        is_authorless_doi_match = (
            not citation_authors
            and author_sim == 0.0
            and bool(citation_doi)
            and features.doi_exact_match
            and features.title_sim_fuzzy >= 0.95
        )
        if (
            features.title_sim_fuzzy >= 0.90
            and title_sim >= 0.95
            and (author_sim >= 0.8 or is_authorless_doi_match)
            and (year_dist <= self.year_tolerance or year_dist >= 900)
        ):
            # Calculate confidence
            if features.doi_exact_match:
                confidence = 0.90
            else:
                confidence = 0.80

            confidence = max(0.0, confidence - style_penalty)

            doi_note = ""
            if not features.doi_exact_match and not citation_doi:
                doi_note = " DOI not present in citation."

            return RuleOutcome(
                label=ValidationLabel.VERIFIED,
                confidence=confidence,
                reasoning=(
                    f"Verified via local knowledge base: "
                    f"title={title_sim:.2f}, author={author_sim:.2f}, year match."
                    + doi_note
                ),
                triggered_rules=["R-LOCAL_DB_VERIFIED"],
                mismatched_fields=[],
                style_penalty=style_penalty,
            )

        return None

    def _rule_local_db_good_match(
        self,
        source: SourceResult,
        features: MatchFeatures,
        style_penalty: float = 0.0,
        citation_doi: str | None = None,
    ) -> RuleOutcome | None:
        """Rule: LOCAL_DB only with good match → VERIFIED.

        When local_db (optionally with known_papers) is the only source that found
        a match with:
        - title_sim_fuzzy >= 0.90 and title_sim >= 0.95
        - author_sim >= 0.5
        - year_distance == 0

        Lower confidence because author_sim is lower.
        """
        # Chỉ apply nếu best candidate đến từ local source
        if not source.sources_succeeded:
            return None
        best = source.best_candidate()
        if not best:
            return None
        if best.source_name not in _NON_LIVE_SOURCES and any(
            s not in _NON_LIVE_SOURCES for s in source.sources_succeeded
        ):
            return None

        title_sim = max(features.title_sim_fuzzy, features.title_sim_semantic)
        author_sim = features.author_jaccard
        year_dist = features.year_distance

        is_arxiv_vs_pub_doi = bool(
            citation_doi
            and best.doi
            and (
                "10.48550/arxiv" in citation_doi.lower()
                or "10.48550/arxiv" in best.doi.lower()
            )
            and features.title_sim_fuzzy >= 0.90
        )

        has_real_doi_conflict = bool(
            citation_doi
            and best.doi
            and not features.doi_exact_match
            and not is_arxiv_vs_pub_doi
        )

        # Good match: fuzzy title >= 0.90, title >= 0.95 AND (author >= 0.5 or exact DOI/arXiv + author >= 0.35) AND year match
        if (
            not has_real_doi_conflict
            and features.title_sim_fuzzy >= 0.90
            and title_sim >= 0.95
            and (
                author_sim >= 0.5
                or ((features.doi_exact_match or is_arxiv_vs_pub_doi) and author_sim >= 0.35)
                or (features.title_sim_fuzzy >= 0.98 and author_sim >= 0.35)
            )
            and year_dist <= self.year_tolerance
        ):
            confidence = max(0.0, 0.75 - style_penalty)

            return RuleOutcome(
                label=ValidationLabel.VERIFIED,
                confidence=confidence,
                reasoning=(
                    f"Verified via local knowledge base (partial author match): "
                    f"title={title_sim:.2f}, author={author_sim:.2f}."
                ),
                triggered_rules=["R-LOCAL_DB_GOOD_MATCH"],
                mismatched_fields=[],
                style_penalty=style_penalty,
            )

        return None

    def _rule_local_db_metadata_error(
        self,
        source: SourceResult,
        features: MatchFeatures,
        style_penalty: float = 0.0,
        citation_doi: str | None = None,
        citation_authors: list[str] | None = None,
    ) -> RuleOutcome | None:
        """Rule: LOCAL_DB / curated knowledge base match with metadata discrepancy → METADATA_ERROR.

        Applies when the best candidate comes from the local ACL / scholarly SQLite
        knowledge base (or known_papers) and has a strong identity anchor (exact DOI
        or fuzzy title >= 0.90 or author >= 0.80 with matching year), but differs in
        publication year, author attribution, or title wording.
        """
        if not source.sources_succeeded:
            return None
        best = source.best_candidate()
        if not best:
            return None
        if best.source_name not in _NON_LIVE_SOURCES and any(
            s not in _NON_LIVE_SOURCES for s in source.sources_succeeded
        ):
            return None

        title_sim_fuzzy = features.title_sim_fuzzy
        author_sim = features.author_jaccard
        year_dist = features.year_distance
        doi_match = features.doi_exact_match

        has_strong_identity = (
            (title_sim_fuzzy >= 0.90 and (doi_match or author_sim >= 0.35 or year_dist <= self.year_tolerance))
            or (doi_match and title_sim_fuzzy >= 0.35)
            or (author_sim >= 0.80 and year_dist <= self.year_tolerance and 0.55 <= title_sim_fuzzy < 0.90)
        )
        if not has_strong_identity:
            return None

        mismatched: list[str] = []
        if title_sim_fuzzy < 0.90:
            mismatched.append("title")
        is_authorless_doi_match = (
            not citation_authors
            and author_sim == 0.0
            and bool(citation_doi)
            and doi_match
            and title_sim_fuzzy >= 0.95
        )
        if author_sim < 0.50 and not is_authorless_doi_match:
            mismatched.append("author")
        if year_dist > self.year_tolerance and year_dist < 900:
            mismatched.append("year")
        if citation_doi and best.doi and not doi_match:
            mismatched.append("doi")

        if not mismatched:
            return None

        return RuleOutcome(
            label=ValidationLabel.METADATA_ERROR,
            confidence=max(0.0, 0.78 - style_penalty),
            reasoning=(
                f"Matched canonical record in local ACL / scholarly database ('{best.title}', {best.year}) "
                f"(title_sim={title_sim_fuzzy:.2f}, author_sim={author_sim:.2f}, DOI match={doi_match}) "
                f"with metadata discrepancy in: {', '.join(mismatched)}."
            ),
            triggered_rules=["R-LOCAL_DB_METADATA_ERROR", "R-SINGLE-SOURCE-PARTIAL"],
            mismatched_fields=mismatched,
            style_penalty=style_penalty,
        )

    def _is_fabricated_doi(self, citation_doi: str | None) -> bool:
        """Check if DOI matches known fabricated patterns.

        These DOIs are fake/invalid and should be flagged as suspected_hallucination
        when no real academic source confirms them.
        """
        if not citation_doi:
            return False
        doi_lower = citation_doi.lower()
        return any(pattern.search(doi_lower) for pattern in _FABRICATED_DOI_PATTERNS)

    def _is_known_academic_author_pattern(
        self,
        citation_authors: list[str] | None,
        citation_year: str | None = None,
        citation_raw: str | None = None,
    ) -> bool:
        """Check if citation has specific seminal academic author patterns.

        Returns True if the citation references a specific well-known ML/NLP scholar
        from the curated seminal-paper registry (suggesting METADATA_ERROR rather
        than HALLUCINATION when title/year is slightly wrong).

        Generic common surnames (e.g., Smith, Jones, Wang, Zhang, Nguyen, Tran)
        are intentionally excluded so fabricated citations using common surnames
        are not misclassified as METADATA_ERROR.
        """
        # Specific seminal ML/NLP scholar surnames (curated, excluding generic surnames)
        known_authors = {
            "vaswani", "shazeer", "parmar", "uszkoreit", "gomez", "kaiser", "polosukhin",
            "devlin", "toutanova",
            "goodfellow", "pouget-abadie", "mirza", "warde-farley",
            "lecun", "bottou", "bengio", "hinton",
            "hochreiter", "schmidhuber",
            "bahdanau",
            "sutskever", "vinyals",
            "mikolov", "corrado",
            "radford", "narasimhan",
            "raffel",
            "dosovitskiy", "kolesnikov",
            "kingma",
            "loshchilov", "hutter",
            "sennrich", "haddow", "birch",
            "manning",
            "karpukhin",
            "kojima",
            "finn",
            "snell",
            "velickovic",
            "socher",
            "mnih", "kavukcuoglu",
            "bojanowski", "joulin",
            "bowman",
        }

        raw_lower = (citation_raw or "").lower()
        author_prefix = re.split(r"\b(?:19|20)\d{2}\b", raw_lower, maxsplit=1)[0]

        for pattern in known_authors:
            if re.search(r"\b" + re.escape(pattern) + r"\b", author_prefix):
                return True

        # Check individual authors
        if citation_authors:
            for author in citation_authors:
                if hasattr(author, "last_name"):
                    parts = [author.last_name]
                    if getattr(author, "first_name", None):
                        parts.append(author.first_name)
                    if getattr(author, "middle_name", None):
                        parts.append(author.middle_name)
                    author_str = " ".join(p for p in parts if p)
                else:
                    author_str = str(author)
                author_lower = author_str.lower()
                last_name = author_lower.split()[-1] if author_lower else ""
                if last_name in known_authors:
                    return True

        return False

    @staticmethod
    def _extract_cited_title_for_url_check(
        citation_title: str | None,
        citation_raw: str | None,
    ) -> str | None:
        if citation_title and citation_title.strip():
            return citation_title.strip()
        if not citation_raw or not citation_raw.strip():
            return None
        cleaned = re.sub(r"https?://\S+", " ", citation_raw.strip())
        cleaned = re.sub(
            r"\b(?:Truy\s+cập|Retrieved|Available\s+at|Có\s+tại)\b.*$",
            "",
            cleaned,
            flags=re.IGNORECASE,
        )
        cleaned = re.sub(r"^\s*(?:\[\s*\d+\s*\]|\d{1,3}[\.\)])\s*", "", cleaned)
        m = re.search(r"\(\s*(?:19|20)\d{2}[a-z]?\s*\)\s*[.,:]?\s*(.+)", cleaned)
        candidate = m.group(1).strip() if m else cleaned.strip()
        first_seg = candidate.split(".")[0].strip(" \"'“”.,;:")
        return first_seg if len(first_seg) >= 20 else None

    @classmethod
    def check_url_content_mismatch(
        cls,
        *,
        citation_title: str | None,
        citation_raw: str | None,
        citation_url: str | None,
        source: SourceResult,
        semantic_sim: float = 0.0,
    ) -> tuple[bool, float, str]:
        """Return ``(is_mismatch, meta_sim, observed_page_title)`` when live HTML ``<head>``
        contradicts a substantive cited title (``meta_sim < 0.20``)."""
        if not citation_url:
            return False, 1.0, ""
        url_status = getattr(source, "url_status", None)
        if url_status not in ("alive", "restricted_alive"):
            return False, 1.0, ""
        html_meta = getattr(source, "html_meta", None)
        if html_meta is None or getattr(html_meta, "is_soft_404", False):
            return False, 1.0, ""

        from integrity_checker.retrieval.html_meta_verifier import (
            compute_url_title_match_score,
        )

        eff_title = cls._extract_cited_title_for_url_check(
            citation_title,
            citation_raw or getattr(source, "citation_raw", None),
        )
        raw_score = compute_url_title_match_score(eff_title, html_meta)
        if raw_score is None:
            return False, 1.0, ""

        meta_sim = max(raw_score, float(semantic_sim or 0.0))
        observed_title = str(html_meta.citation_title or html_meta.page_title or "").strip()
        return meta_sim < 0.20, meta_sim, observed_title

    def apply(
        self,
        features: MatchFeatures,
        source: SourceResult,
        mapping_status: CitationMappingStatus | None = None,
        style_profile: StyleProfile | None = None,
        citation_doi: str | None = None,
        citation_url: str | None = None,
        # NEW v1.3: Provenance tracking
        api_exhausted: bool = False,
        used_local_db: bool = False,
        # NEW v1.3: Citation info for METADATA_ERROR detection
        citation_authors: list[Any] | None = None,
        citation_year: str | int | None = None,
        citation_raw: str | None = None,
        citation_venue: str | None = None,
        citation_title: str | None = None,
        citation_type: Any = None,
    ) -> RuleOutcome:
        """Apply symbolic rules and enforce retraction / clear venue conflict post-conditions."""
        outcome = self._apply_core(
            features=features,
            source=source,
            mapping_status=mapping_status,
            style_profile=style_profile,
            citation_doi=citation_doi,
            citation_url=citation_url,
            api_exhausted=api_exhausted,
            used_local_db=used_local_db,
            citation_authors=citation_authors,
            citation_year=citation_year,
            citation_raw=citation_raw,
            citation_venue=citation_venue,
            citation_title=citation_title,
            citation_type=citation_type,
        )
        best_cand = source.best_candidate() if source and source.candidates else None
        if (
            citation_venue
            and best_cand
            and best_cand.venue
            and "R-INCOMPLETE-METADATA" not in outcome.triggered_rules
        ):
            _non_venue_pat = re.compile(
                r"\b(?:arxiv|corr|preprint|biorxiv|medrxiv|ssrn|hal|zenodo|openreview|"
                r"researchgate|sciencedirect|springer|elsevier|wiley|taylor|francis|"
                r"ieee\s+xplore|acm\s+digital|lecture\s+notes|lncs|pubmed)\b",
                re.IGNORECASE,
            )
            cv_clean = citation_venue.strip()
            bv_clean = best_cand.venue.strip()
            if (
                len(cv_clean) >= 3
                and len(bv_clean) >= 3
                and cv_clean.lower() not in {"ieee", "acm"}
                and bv_clean.lower() not in {"ieee", "acm"}
                and not _non_venue_pat.search(cv_clean)
                and not _non_venue_pat.search(bv_clean)
                and not (citation_doi and "10.48550/arxiv" in str(citation_doi).lower())
                and "vn_standard_code" not in (best_cand.external_ids or {})
            ):
                from integrity_checker.matching.venue_normalizer import VenueNormalizer

                v_sim = VenueNormalizer().similarity(cv_clean, bv_clean)
                if v_sim < 0.15 and outcome.label == ValidationLabel.METADATA_ERROR:
                    if "venue" not in outcome.mismatched_fields:
                        outcome.mismatched_fields.append("venue")
                    if "R-VENUE-MISMATCH" not in outcome.triggered_rules:
                        outcome.triggered_rules.append("R-VENUE-MISMATCH")
                elif (
                    v_sim < 0.10
                    and outcome.label == ValidationLabel.VERIFIED
                    and features.doi_exact_match
                ):
                    c_is_j = bool(re.search(r"\b(?:journal|transactions)\b", cv_clean, re.I))
                    b_is_j = bool(re.search(r"\b(?:journal|transactions)\b", bv_clean, re.I))
                    c_is_c = bool(re.search(r"\b(?:proceedings|conference|symposium|workshop)\b", cv_clean, re.I))
                    b_is_c = bool(re.search(r"\b(?:proceedings|conference|symposium|workshop)\b", bv_clean, re.I))
                    if (c_is_j and b_is_c and not c_is_c) or (c_is_c and b_is_j and not c_is_j):
                        outcome.label = ValidationLabel.METADATA_ERROR
                        outcome.confidence = min(outcome.confidence, 0.72)
                        outcome.mismatched_fields = ["venue"]
                        outcome.triggered_rules.append("R-VENUE-MISMATCH")
                        outcome.reasoning += (
                            f" Venue conflict detected: cited '{cv_clean}' vs canonical '{bv_clean}'."
                        )
        is_retracted = bool(
            getattr(source, "is_retracted", False)
            or (hasattr(source, "has_retracted_candidate") and source.has_retracted_candidate())
        )
        if is_retracted:
            if outcome.label in (ValidationLabel.VERIFIED, ValidationLabel.UNRESOLVED):
                outcome.label = ValidationLabel.METADATA_ERROR
            if "R-RETRACTED-PAPER" not in outcome.triggered_rules:
                outcome.triggered_rules.append("R-RETRACTED-PAPER")
            if "retracted" not in outcome.mismatched_fields:
                outcome.mismatched_fields.append("retracted")
            if "retracted_paper" not in outcome.mismatched_fields:
                outcome.mismatched_fields.append("retracted_paper")
            if "[RETRACTION WARNING:" not in outcome.reasoning:
                outcome.reasoning += (
                    " [RETRACTION WARNING: This publication has been officially RETRACTED in scholarly registries "
                    "(Retraction Watch / OpenAlex / Crossref).]"
                )
        return outcome

    evaluate = apply

    def _apply_core(
        self,
        features: MatchFeatures,
        source: SourceResult,
        mapping_status: CitationMappingStatus | None = None,
        style_profile: StyleProfile | None = None,
        citation_doi: str | None = None,
        citation_url: str | None = None,
        # NEW v1.3: Provenance tracking
        api_exhausted: bool = False,
        used_local_db: bool = False,
        # NEW v1.3: Citation info for METADATA_ERROR detection
        citation_authors: list[Any] | None = None,
        citation_year: str | int | None = None,
        citation_raw: str | None = None,
        citation_venue: str | None = None,
        citation_title: str | None = None,
        citation_type: Any = None,
    ) -> RuleOutcome:
        """Apply rules theo thứ tự ưu tiên:
            0. FAKE-URL → SUSPECTED_HALLUCINATION (high priority, pre-flight)
            1. FABRICATED_DOI → SUSPECTED_HALLUCINATION (high priority)
            2. DOI resolve + title tốt → VERIFIED
            3. DOI resolve + title trung bình → METADATA_ERROR
            4. ≥2 nguồn đồng thuận (title + author + year) → VERIFIED
            5. AMBIGUOUS_MAPPING → cap confidence, force abstention band
            6. Không có candidate, API 200 OK → SUSPECTED_HALLUCINATION
            7. Vùng biên / API lỗi → UNRESOLVED
            8. DOMAIN-EXCEPTION (URL broken + record exists) → keep label + flag

        NEW v1.3: Provenance penalty for local_db-only results:
            - api_exhausted=True: -0.1 penalty (less trust in verification)
            - used_local_db=True (from local DB): -0.05 penalty
        """
        # --- Provenance penalty (NEW v1.3) ---
        provenance_penalty = 0.0
        provenance_warnings: list[str] = []

        # Source names that represent *locally cached* metadata rather than a
        # live API round-trip.  ``local_db`` is the paper knowledge base;
        # ``known_papers`` is the curated seminal-paper list bundled with the
        # code.  Neither is a network source, so a result backed only by these
        # must not be scored as if it were corroborated by external providers.
        if source.sources_succeeded:
            verified_sources = [
                name
                for name in source.sources_succeeded
                if name not in _NON_LIVE_SOURCES
            ]
            local_db_only = not verified_sources
        else:
            verified_sources = []
            local_db_only = False

        if api_exhausted:
            provenance_penalty = 0.1
            provenance_warnings.append("API_EXHAUSTED")
        elif used_local_db:
            provenance_penalty = 0.05
            provenance_warnings.append("LOCAL_DB")

        # Check if only local/cached sources were used
        if local_db_only:
            provenance_penalty += 0.15
            provenance_warnings.append("LOCAL_DB_ONLY")

        # --- Pre-flight: STYLE_INCONSISTENT penalty ---
        style_penalty = 0.0
        style_triggered = False
        if style_profile is not None and hasattr(style_profile, "style"):
            style_value = (style_profile.style or "").upper()
            confidence_val = getattr(style_profile, "confidence", 0.0)
            if "MIXED" in style_value:
                # Strong signal: MIXED → penalty + flag
                style_penalty = self.style_inconsistent_penalty
                style_triggered = True
            elif style_value.startswith("UNKNOWN") and confidence_val < 0.3:
                # Weak signal: UNKNOWN with low confidence
                style_penalty = self.style_inconsistent_penalty * 0.5
                style_triggered = True

        # --- Pre-flight: FAKE-URL check (NEW 2026-09-15) ---
        is_fake, fake_pattern = _is_fake_url(citation_url)
        if is_fake:
            triggered_rules = ["R-FAKE-URL"]
            return RuleOutcome(
                label=ValidationLabel.SUSPECTED_HALLUCINATION,
                confidence=0.95,
                reasoning=(
                    f"URL domain '{fake_pattern}' is a placeholder/fake domain (example.com, "
                    f"test.com, localhost, etc.) and does not belong to a scholarly registry."
                ),
                triggered_rules=triggered_rules,
                mismatched_fields=["url"],
                style_penalty=style_penalty,
            )

        # --- Pre-flight: FABRICATED_DOI check (NEW 2026-09-15) ---
        # Check BEFORE Rule 5 so fabricated DOIs are caught even when all APIs fail
        if self._is_fabricated_doi(citation_doi):
            triggered_rules = ["R-FABRICATED-DOI"]
            return RuleOutcome(
                label=ValidationLabel.SUSPECTED_HALLUCINATION,
                confidence=0.9,
                reasoning=(
                    f"DOI {citation_doi} matches known fabricated DOI pattern "
                    f"(invalid/fake publisher prefix like 10.1234, 10.9999)."
                ),
                triggered_rules=triggered_rules,
                mismatched_fields=["doi"],
                style_penalty=style_penalty,
            )

        url_status = getattr(source, "url_status", None)
        url_status_code = getattr(source, "url_status_code", None)
        if not citation_url:
            raw_for_url = citation_raw or getattr(source, "citation_raw", "") or ""
            if raw_for_url and re.search(r"https?:", raw_for_url, re.IGNORECASE):
                from integrity_checker.retrieval.link_validator import clean_extracted_url

                extracted_u = clean_extracted_url(raw_for_url)
                if extracted_u.lower().startswith(("http://", "https://")) and "doi.org/" not in extracted_u.lower():
                    citation_url = extracted_u

        completeness = assess_bibliographic_completeness(
            citation_raw=citation_raw or getattr(source, "citation_raw", None),
            citation_authors=citation_authors,
            citation_year=citation_year,
            citation_venue=citation_venue,
            citation_doi=citation_doi,
            citation_url=citation_url,
            url_status=url_status,
            citation_type=citation_type,
            citation_title=citation_title,
        )

        # --- Pre-flight: FAKE AUTHOR check (NEW v1.4) ---
        # Check if author name is clearly fake/fabricated (skip if DOI + title strongly verified)
        if not (features.doi_exact_match and features.title_sim_fuzzy >= 0.85):
            is_fake_author, fake_author_pattern = _is_fake_author_name(
                citation_raw, citation_authors=citation_authors
            )
            if is_fake_author:
                triggered_rules = ["R-FAKE-AUTHOR"]
                return RuleOutcome(
                    label=ValidationLabel.SUSPECTED_HALLUCINATION,
                    confidence=0.95,
                    reasoning=(
                        f"Author name matches fake/fabricated pattern: '{fake_author_pattern}'. "
                        f"This appears to be a fabricated citation."
                    ),
                    triggered_rules=triggered_rules,
                    mismatched_fields=["author"],
                    style_penalty=style_penalty,
                )

        # Compute known author pattern early for use across pre-flight and fallback rules
        is_known_author = self._is_known_academic_author_pattern(
            citation_authors=citation_authors,
            citation_year=str(citation_year) if citation_year is not None else None,
            citation_raw=citation_raw,
        )

        # --- Pre-flight: FUTURE YEAR detection (NEW v1.4) ---
        # Check if citation year is in the future (beyond current year)
        # IMPORTANT: Distinguish between real paper with wrong year vs. fabricated paper
        # FIX: Use dynamic year instead of hardcoded value
        from datetime import datetime as _dt
        current_year = _dt.now().year

        if citation_year is not None and str(citation_year).strip():
            try:
                year_match = re.search(r'\d{4}', str(citation_year))
                if not year_match:
                    # No 4-digit year found in citation_year
                    pass
                else:
                    cited_year = int(year_match.group())
                    if cited_year > current_year:
                        has_matched_paper = bool(
                            source.best_candidate()
                            and (features.doi_exact_match or features.title_sim_fuzzy >= 0.85)
                        )

                        if is_known_author or has_matched_paper:
                            # Known author or matched paper + future year → likely METADATA_ERROR (wrong year)
                            # Example: "Velickovic et al. (2027)" → real paper but wrong year
                            triggered_rules = ["R-FUTURE-YEAR-KNOWN-AUTHOR"]
                            return RuleOutcome(
                                label=ValidationLabel.METADATA_ERROR,
                                confidence=0.65,
                                reasoning=(
                                    f"Known academic author '{citation_authors[0] if citation_authors else 'unknown'}' "
                                    f"with year {cited_year} (future). This appears to be a real paper "
                                    f"with wrong year (METADATA_ERROR), not a fabrication."
                                ),
                                triggered_rules=triggered_rules,
                                mismatched_fields=["year"],
                                style_penalty=style_penalty,
                            )
                        else:
                            # Unknown author + future year → SUSPECTED_HALLUCINATION
                            triggered_rules = ["R-FUTURE-YEAR"]
                            return RuleOutcome(
                                label=ValidationLabel.SUSPECTED_HALLUCINATION,
                                confidence=0.95,
                                reasoning=(
                                    f"Citation year {cited_year} is in the future (current year: {current_year}). "
                                    f"Unknown author with impossible year → fabricated citation."
                                ),
                                triggered_rules=triggered_rules,
                                mismatched_fields=["year"],
                                style_penalty=style_penalty,
                            )
            except (ValueError, AttributeError, TypeError) as exc:
                # FIX: Log exceptions instead of silent pass
                logger.debug(f"Error parsing year from '{citation_year}': {exc}")

        # --- Rule 5: No candidates returned ---
        if not source.candidates or not source.best_candidate():
            if url_status == "dead_link" and not is_known_author:
                status_detail = f"HTTP {url_status_code}" if url_status_code else "unreachable/DNS error"
                return RuleOutcome(
                    label=ValidationLabel.SUSPECTED_HALLUCINATION,
                    confidence=max(0.0, 0.85 - style_penalty),
                    reasoning=(
                        f"Citation URL '{citation_url}' is dead ({status_detail}) and no matching "
                        f"scholarly record was found. Suspected hallucinated link/reference."
                    ),
                    triggered_rules=["R-DEAD-URL", "R-NO-CANDIDATE"],
                    mismatched_fields=["url"],
                    style_penalty=style_penalty,
                )

            is_scholarly_paper_url = bool(
                citation_url
                and re.search(
                    r"(?:doi\.org|arxiv\.org|aclanthology\.org|ieeexplore\.ieee\.org|dl\.acm\.org|link\.springer\.com|sciencedirect\.com)",
                    citation_url,
                    re.IGNORECASE,
                )
            )
            if (
                citation_url
                and not (citation_doi and str(citation_doi).strip())
                and not is_scholarly_paper_url
                and url_status == "archived_alive"
            ):
                archive_url = getattr(source, "archive_url", None) or "https://web.archive.org"
                return RuleOutcome(
                    label=ValidationLabel.RESOURCE,
                    confidence=0.90,
                    reasoning=(
                        f"Citation URL '{citation_url}' is no longer live (link rot), but a historical "
                        f"snapshot was verified via Internet Archive Wayback Machine ({archive_url})."
                    ),
                    triggered_rules=["R-WAYBACK-ARCHIVED", "R-URL-RESOURCE"],
                    mismatched_fields=[],
                    style_penalty=0.0,
                )

            is_url_mismatch, url_meta_sim, observed_html_title = self.check_url_content_mismatch(
                citation_title=citation_title,
                citation_raw=citation_raw,
                citation_url=citation_url,
                source=source,
                semantic_sim=float(getattr(features, "title_sim_semantic", 0.0) or 0.0),
            )
            if is_url_mismatch:
                return RuleOutcome(
                    label=ValidationLabel.METADATA_ERROR,
                    confidence=max(0.0, 0.85 - style_penalty),
                    reasoning=(
                        f"Citation URL '{citation_url}' is live, but its HTML page title "
                        f"('{observed_html_title}') contradicts the cited title "
                        f"(similarity={url_meta_sim:.2f} < 0.20). Suspected decoy or mismatched link."
                    ),
                    triggered_rules=["R-URL-CONTENT-MISMATCH"],
                    mismatched_fields=["url", "title"],
                    style_penalty=style_penalty,
                )

            if (
                citation_url
                and not (citation_doi and str(citation_doi).strip())
                and not is_scholarly_paper_url
                and url_status in ("alive", "restricted_alive")
            ):
                status_code_str = f"HTTP {url_status_code}" if url_status_code else "HTTP 200 OK"
                return RuleOutcome(
                    label=ValidationLabel.RESOURCE,
                    confidence=0.95,
                    reasoning=(
                        f"Citation URL '{citation_url}' is reachable ({status_code_str}) and is an online "
                        f"documentation/web resource rather than an indexed academic paper."
                    ),
                    triggered_rules=["R-URL-RESOURCE"],
                    mismatched_fields=[],
                    style_penalty=0.0,
                )

            if source.sources_failed:
                clean_empty_sources = [
                    s for s, err in source.sources_failed.items()
                    if _is_clean_no_result_message(err)
                ]
            else:
                clean_empty_sources = [
                    s for s in source.sources_queried
                    if s not in _NON_LIVE_SOURCES
                ]

            rate_limited_sources = [
                s
                for s, err in (source.sources_failed or {}).items()
                if any(
                    marker in (err or "").lower()
                    for marker in ("429", "rate limit", "backoff")
                )
            ]

            if (
                completeness.is_incomplete
                and (len(clean_empty_sources) >= 1 or len(verified_sources) >= 1)
                and not rate_limited_sources
                and not (citation_doi and str(citation_doi).strip())
                and not is_known_author
            ):
                if not _is_exempt_from_incomplete_metadata(
                    citation_raw or source.citation_raw,
                    citation_url=citation_url,
                    citation_doi=citation_doi,
                    citation_authors=citation_authors,
                ):
                    missing_f = list(completeness.missing_fields or ["authors", "year", "venue"])
                    return RuleOutcome(
                        label=ValidationLabel.METADATA_ERROR,
                        confidence=max(0.0, 0.80 - style_penalty),
                        reasoning=(
                            f"Incomplete bibliographic reference missing {', '.join(missing_f)} "
                            f"and lacking any resolvable identifier (DOI/URL/ISBN/arXiv). "
                            f"Classified as formatting/completeness error rather than AI hallucination."
                        ),
                        triggered_rules=["R-INCOMPLETE-METADATA"],
                        mismatched_fields=missing_f,
                        style_penalty=style_penalty,
                    )

            has_substantive_meta = _has_substantive_citation_metadata(
                citation_raw,
                source.citation_raw,
                citation_authors,
                citation_year,
            )

            # When >= 2 live scholarly registries responded cleanly (HTTP 200) and found
            # zero matching records for a substantive citation, flag as SUSPECTED_HALLUCINATION
            # UNLESS the reference is a non-journal source (book, classical/Bible text, web URL,
            # thesis, or legal/gov report — BUG-22).
            if has_substantive_meta and len(clean_empty_sources) >= 2 and not is_known_author:
                if citation_doi and str(citation_doi).strip():
                    return RuleOutcome(
                        label=ValidationLabel.SUSPECTED_HALLUCINATION,
                        confidence=max(0.0, 0.85 - style_penalty),
                        reasoning=(
                            f"Cited DOI '{citation_doi}' and title could not be found across "
                            f"{len(clean_empty_sources)} scholarly registries ({', '.join(clean_empty_sources)}). "
                            f"Suspected fabricated or non-existent source."
                        ),
                        triggered_rules=["R-NONEXISTENT-DOI", "R-NO-CANDIDATE"],
                        mismatched_fields=["doi", "title"],
                        style_penalty=style_penalty,
                    )
                is_non_journal, non_journal_kind = _is_non_journal_or_unindexed_source(
                    citation_raw or source.citation_raw,
                    citation_url=citation_url,
                    citation_doi=citation_doi,
                    citation_authors=citation_authors,
                )
                if is_non_journal:
                    if non_journal_kind in ("web_resource", "legal_or_standard"):
                        return RuleOutcome(
                            label=ValidationLabel.RESOURCE,
                            confidence=0.85,
                            reasoning=(
                                f"Reference is a non-scholarly {non_journal_kind.replace('_', ' ')} "
                                f"not indexed in academic paper registries ({', '.join(clean_empty_sources)})."
                            ),
                            triggered_rules=["R-NON-SCHOLARLY-RESOURCE"],
                            mismatched_fields=[],
                            style_penalty=0.0,
                        )
                    return RuleOutcome(
                        label=ValidationLabel.UNRESOLVED,
                        confidence=max(0.0, 0.55 - style_penalty),
                        reasoning=(
                            f"Non-periodical source ({non_journal_kind.replace('_', ' ')}) is not indexed "
                            f"in academic paper databases ({', '.join(clean_empty_sources)}) — abstaining "
                            f"from hallucination verdict."
                        ),
                        triggered_rules=["R-UNINDEXED-BOOK-OR-SOURCE"],
                        mismatched_fields=[],
                        style_penalty=style_penalty,
                    )
                return RuleOutcome(
                    label=ValidationLabel.SUSPECTED_HALLUCINATION,
                    confidence=max(0.0, 0.80 - style_penalty),
                    reasoning=(
                        f"No matching scholarly record found across {len(clean_empty_sources)} "
                        f"academic databases ({', '.join(clean_empty_sources)}). "
                        f"Suspected AI-hallucinated or non-existent reference."
                    ),
                    triggered_rules=["R-NO-CANDIDATE", "R-NO-SCHOLARLY-RECORD"],
                    mismatched_fields=["title"],
                    style_penalty=style_penalty,
                )

            if source.sources_failed and not source.sources_succeeded:
                rules_out = ["R-FAIL-ALL"]
                reasoning_msg = (
                    "All external scholarly APIs failed or timed out — insufficient evidence to conclude."
                )
                if rate_limited_sources:
                    rules_out.append("R-RATE-LIMITED-ABSTAIN")
                    reasoning_msg = (
                        f"External scholarly APIs experienced HTTP 429 rate limiting / backoff "
                        f"({', '.join(rate_limited_sources)}) — abstaining from hallucination verdict."
                    )
                return RuleOutcome(
                    label=ValidationLabel.UNRESOLVED,
                    confidence=0.3,
                    reasoning=reasoning_msg,
                    triggered_rules=rules_out,
                    mismatched_fields=[],
                    style_penalty=style_penalty,
                )

            fallback_rules = ["R-NO-CANDIDATE"]
            fallback_reasoning = (
                "No matching candidates found across queried scholarly databases "
                "(Crossref/OpenAlex/DBLP/arXiv/OpenLibrary/Europe PMC) — insufficient evidence to conclude."
            )
            if rate_limited_sources:
                fallback_rules.append("R-RATE-LIMITED-ABSTAIN")
                fallback_reasoning = (
                    f"Insufficient clean scholarly responses because {', '.join(rate_limited_sources)} "
                    f"hit HTTP 429 rate limits — abstaining from hallucination verdict."
                )
            return RuleOutcome(
                label=ValidationLabel.UNRESOLVED,
                confidence=0.5,
                reasoning=fallback_reasoning,
                triggered_rules=fallback_rules,
                mismatched_fields=[],
                style_penalty=style_penalty,
            )

        # Extract features for remaining rules
        best = source.best_candidate()
        title_sim = features.title_sim_max
        consensus = features.source_consensus
        doi_match = features.doi_exact_match
        author_sim = features.author_jaccard
        year_dist = features.year_distance
        sources_found = len(source.candidates) if source.candidates else 0

        mismatched: list[str] = []
        triggered_rules: list[str] = []
        if url_status == "archived_alive":
            triggered_rules.append("R-WAYBACK-ARCHIVED")
        # FIX v1.2: Check well-linked citations FIRST before other rules
        # This ensures that properly matched citations (via author-year linking)
        # are verified even when author_jaccard is 0 (e.g., "et al." citations)
        mapping_is_matched = (
            mapping_status is not None
            and hasattr(mapping_status, "value")
            and mapping_status.value == "matched"
        )

        if style_triggered:
            triggered_rules.append("R-STYLE-INCONSISTENT")

        # Surface provenance as a triggered rule so audit trails and the UI
        # show *why* confidence was reduced (cache-only evidence).
        for warning in provenance_warnings:
            triggered_rules.append(f"R-{warning}")

        # Apply provenance penalty to base confidence
        provenance_note = ""
        if provenance_penalty > 0:
            provenance_note = f" [provenance penalty: -{provenance_penalty:.0%}]"

        _eff_raw = citation_raw or source.citation_raw
        _norm_cit_title = (citation_title or "").strip().rstrip(".,;").lower()
        _norm_cit_venue = (citation_venue or "").strip().rstrip(".,;").lower()
        is_titleless_journal_ref = (
            bool(_norm_cit_venue)
            and not _has_sentence_period_in_venue(citation_venue, _eff_raw)
            and not _raw_has_unparsed_title_before_venue(_eff_raw, citation_venue)
            and (not _norm_cit_title or _norm_cit_title == _norm_cit_venue)
        )
        titleless_venue_ok = _venues_compatible_for_titleless_ref(
            citation_venue,
            best.venue if best else None,
            float(getattr(features, "venue_sim", 0.0) or 0.0),
            doi=(best.doi if best and best.doi else citation_doi),
        )

        # --- Rule 1: DOI + title + author strong match → VERIFIED ---
        # Guard against a self-confirming match: when the citation's DOI comes
        # from the local DB / known-paper cache, ``doi_exact_match`` only proves
        # the cache was keyed on the same DOI, not that an independent registry
        # resolved it.  Require at least one live source before awarding the
        # strongest VERIFIED verdict.
        if (
            doi_match
            and (
                (
                    title_sim >= self.title_sim_verified
                    and (
                        author_sim >= self.author_jaccard_verified
                        or (
                            not citation_authors
                            and author_sim == 0.0
                            and bool(citation_doi)
                            and title_sim >= 0.95
                        )
                    )
                )
                or (
                    is_titleless_journal_ref
                    and bool(citation_authors)
                    and author_sim >= max(self.author_jaccard_verified, 0.50)
                    and titleless_venue_ok
                    and year_dist is not None
                    and year_dist <= max(self.year_tolerance, 1)
                )
            )
            and (year_dist <= max(self.year_tolerance, 1) or year_dist >= 900)
            and _has_live_source(source, verified_sources)
        ):
            triggered_rules.append("R-DOI-TITLE-AUTHOR")
            if "doi_ra" in source.sources_succeeded or (best and best.source_name == "doi_ra"):
                triggered_rules.append("R-GLOBAL-DOI-RA-VERIFIED")
            eff_title_sim = max(title_sim, 0.85) if is_titleless_journal_ref else title_sim
            return RuleOutcome(
                label=ValidationLabel.VERIFIED,
                confidence=max(
                    0.0,
                    min(0.95, 0.7 + eff_title_sim * 0.2 + author_sim * 0.1)
                    - style_penalty
                    - provenance_penalty,
                ),
                reasoning=(
                    f"Exact DOI match confirmed, title similarity={title_sim:.2f}, "
                    f"author overlap={author_sim:.2f}.{provenance_note}"
                ),
                triggered_rules=triggered_rules,
                mismatched_fields=[],
                style_penalty=style_penalty,
            )

        # --- Rule 1a-ext: Technical standard (IETF RFC / PyPI / NPM / GitHub / Curated VN Standard & Textbook) ---
        best_ext_ids = (best.external_ids or {}) if best else {}
        if best and best.source_name == "tech_standard" and "vn_standard_code" in best_ext_ids:
            from integrity_checker.retrieval.tech_standard_client import (
                compute_vn_standard_core_subject_similarity,
                extract_vn_standard_core_subject,
            )

            official_std_code = str(best_ext_ids.get("vn_standard_code") or "").strip()
            cited_std_code = str(best_ext_ids.get("cited_vn_standard_code") or "").strip()
            cited_core_subj = extract_vn_standard_core_subject(
                citation_title,
                venue=citation_venue,
                raw_text=citation_raw or source.citation_raw,
                authors=citation_authors,
            )
            raw_official_subjs = str(best_ext_ids.get("vn_standard_subjects") or "").strip()
            official_core_subjs = [
                s.strip() for s in raw_official_subjs.split(" || ") if s and s.strip()
            ]
            fallback_cand_subj = extract_vn_standard_core_subject(best.title)
            if fallback_cand_subj and fallback_cand_subj not in official_core_subjs:
                official_core_subjs.append(fallback_cand_subj)
            core_subj_sim = compute_vn_standard_core_subject_similarity(
                cited_core_subj,
                official_core_subjs,
            )
            if cited_core_subj:
                has_std_title_mismatch = core_subj_sim < 0.70
            else:
                has_std_title_mismatch = bool(citation_title) and features.title_sim_fuzzy < 0.75
            has_std_year_mismatch = bool(
                (cited_std_code and official_std_code and cited_std_code != official_std_code)
                or (year_dist > self.year_tolerance and year_dist < 900)
            )
            if has_std_title_mismatch or has_std_year_mismatch:
                if has_std_title_mismatch:
                    mismatched.append("title")
                if has_std_year_mismatch:
                    mismatched.append("year")
                triggered_rules.append("R-SINGLE-SOURCE-PARTIAL")
                return RuleOutcome(
                    label=ValidationLabel.METADATA_ERROR,
                    confidence=max(0.0, 0.78 - style_penalty),
                    reasoning=(
                        f"Vietnamese national standard '{official_std_code}' matched in curated registry "
                        f"('{best.title}'), but cited metadata conflicts on {', '.join(mismatched)}."
                    ),
                    triggered_rules=triggered_rules,
                    mismatched_fields=mismatched,
                    style_penalty=style_penalty,
                )
            triggered_rules.append("R-VN-STANDARD-VERIFIED")
            return RuleOutcome(
                label=ValidationLabel.VERIFIED,
                confidence=max(0.0, 0.92 - style_penalty - provenance_penalty),
                reasoning=(
                    f"Verified curated Vietnamese national standard via {best.venue or 'TCVN/QCVN'} "
                    f"(title similarity={features.title_sim_fuzzy:.2f}).{provenance_note}"
                ),
                triggered_rules=triggered_rules,
                mismatched_fields=[],
                style_penalty=style_penalty,
            )

        if best and best.source_name == "tech_standard" and "vn_textbook_id" in best_ext_ids:
            raw_for_tb = re.sub(
                r"^\s*(?:\[\s*\d+\s*\]\.?|\d{1,3}\s*[\.\)])\s*",
                "",
                (citation_raw or source.citation_raw or "").strip(),
            )
            best_title_prefix = (best.title or "").strip().lower()[:15]
            tb_is_title_first = bool(
                best_title_prefix
                and len(best_title_prefix) >= 6
                and raw_for_tb.lower().startswith(best_title_prefix)
            )
            has_raw_author_prefix = bool(
                not tb_is_title_first
                and re.match(r"^[^\(\n]{3,90}?\s*\(\s*(?:19|20)\d{2}[a-z]?\s*\)", raw_for_tb)
            )
            has_tb_title_mismatch = features.title_sim_fuzzy < 0.80
            has_tb_author_mismatch = (
                bool(citation_authors) or has_raw_author_prefix
            ) and author_sim < self.author_jaccard_verified
            has_tb_year_mismatch = year_dist > self.year_tolerance and year_dist < 900
            if completeness.is_incomplete:
                missing_f = list(completeness.missing_fields or ["authors", "year", "venue"])
                return RuleOutcome(
                    label=ValidationLabel.METADATA_ERROR,
                    confidence=max(0.0, 0.80 - style_penalty),
                    reasoning=(
                        f"Incomplete textbook reference matching title '{best.title}' "
                        f"but missing required metadata ({', '.join(missing_f)})."
                    ),
                    triggered_rules=triggered_rules + ["R-INCOMPLETE-METADATA"],
                    mismatched_fields=missing_f,
                    style_penalty=style_penalty,
                )
            if has_tb_title_mismatch or has_tb_author_mismatch or has_tb_year_mismatch:
                if has_tb_title_mismatch:
                    mismatched.append("title")
                if has_tb_author_mismatch:
                    mismatched.append("authors")
                if has_tb_year_mismatch:
                    mismatched.append("year")
                triggered_rules.append("R-SINGLE-SOURCE-PARTIAL")
                return RuleOutcome(
                    label=ValidationLabel.METADATA_ERROR,
                    confidence=max(0.0, 0.78 - style_penalty),
                    reasoning=(
                        f"Vietnamese university textbook '{best.title}' matched in curated registry, "
                        f"but cited metadata conflicts on {', '.join(mismatched)}."
                    ),
                    triggered_rules=triggered_rules,
                    mismatched_fields=mismatched,
                    style_penalty=style_penalty,
                )
            triggered_rules.append("R-VN-TEXTBOOK-VERIFIED")
            return RuleOutcome(
                label=ValidationLabel.VERIFIED,
                confidence=max(0.0, 0.92 - style_penalty - provenance_penalty),
                reasoning=(
                    f"Verified curated Vietnamese university textbook via {best.venue or 'NXB Đại học'} "
                    f"(title similarity={features.title_sim_fuzzy:.2f}, author overlap={author_sim:.2f}).{provenance_note}"
                ),
                triggered_rules=triggered_rules,
                mismatched_fields=[],
                style_penalty=style_penalty,
            )

        tech_dehyph_match = False
        if best and best.source_name == "tech_standard" and best.title:
            raw_no_url = re.sub(r"https?://\S+", " ", citation_raw or source.citation_raw or "")
            raw_dehyph = re.sub(r"[-_/–—]+", " ", raw_no_url).lower()
            best_toks = [
                t
                for t in re.findall(r"[a-z0-9]+", re.sub(r"[-_/]+", " ", best.title.lower()))
                if len(t) >= 2
            ]
            if (
                len(best_toks) >= 2
                and all(re.search(rf"\b{re.escape(t)}\b", raw_dehyph) for t in best_toks)
                and (not citation_authors or author_sim >= 0.50)
            ):
                tech_dehyph_match = True
        if best and best.source_name == "tech_standard" and (features.title_sim_fuzzy >= 0.80 or tech_dehyph_match):
            ext_ids = best.external_ids or {}
            triggered_rules.append("R-RFC-VERIFIED")
            if "github_repo" in ext_ids:
                triggered_rules.append("R-GITHUB-VERIFIED")
            elif "npm_package" in ext_ids or "pypi_package" in ext_ids:
                triggered_rules.append("R-PACKAGE-VERIFIED")
            if year_dist <= self.year_tolerance or year_dist >= 900:
                return RuleOutcome(
                    label=ValidationLabel.VERIFIED,
                    confidence=max(0.0, 0.92 - style_penalty - provenance_penalty),
                    reasoning=(
                        f"Verified technical standard / software package via {best.venue or 'IETF RFC / PyPI / NPM / GitHub'} "
                        f"(title similarity={features.title_sim_fuzzy:.2f}).{provenance_note}"
                    ),
                    triggered_rules=triggered_rules,
                    mismatched_fields=[],
                    style_penalty=style_penalty,
                )
            else:
                mismatched.append("year")
                triggered_rules.append("R-SINGLE-SOURCE-PARTIAL")
                return RuleOutcome(
                    label=ValidationLabel.METADATA_ERROR,
                    confidence=max(0.0, 0.75 - style_penalty),
                    reasoning=(
                        f"Technical standard / software package '{best.title}' found in {best.venue or 'IETF / PyPI / NPM / GitHub'}, "
                        f"but cited publication year differs from official release year ({best.year})."
                    ),
                    triggered_rules=triggered_rules,
                    mismatched_fields=mismatched,
                    style_penalty=style_penalty,
                )

        if best and best.source_name == "wikidata_opencitations" and features.title_sim_fuzzy >= 0.80:
            triggered_rules.append("R-WIKIDATA-VERIFIED")
            if year_dist <= self.year_tolerance or year_dist >= 900:
                return RuleOutcome(
                    label=ValidationLabel.VERIFIED,
                    confidence=max(0.0, 0.90 - style_penalty - provenance_penalty),
                    reasoning=(
                        f"Verified via {best.venue or 'Wikidata Knowledge Graph / OpenCitations'} "
                        f"(title similarity={features.title_sim_fuzzy:.2f}).{provenance_note}"
                    ),
                    triggered_rules=triggered_rules,
                    mismatched_fields=[],
                    style_penalty=style_penalty,
                )
            else:
                mismatched.append("year")
                triggered_rules.append("R-SINGLE-SOURCE-PARTIAL")
                return RuleOutcome(
                    label=ValidationLabel.METADATA_ERROR,
                    confidence=max(0.0, 0.75 - style_penalty),
                    reasoning=(
                        f"Work or standard '{best.title}' found in {best.venue or 'Wikidata / OpenCitations'}, "
                        f"but cited publication year differs from official publication year ({best.year})."
                    ),
                    triggered_rules=triggered_rules,
                    mismatched_fields=mismatched,
                    style_penalty=style_penalty,
                )

        if best and best.source_name == "huggingface" and features.title_sim_fuzzy >= 0.85:
            if year_dist <= self.year_tolerance or year_dist >= 900:
                triggered_rules.append("R-HF-VERIFIED")
                return RuleOutcome(
                    label=ValidationLabel.VERIFIED,
                    confidence=max(0.0, 0.90 - style_penalty - provenance_penalty),
                    reasoning=(
                        f"Verified AI model/dataset/paper via Hugging Face Hub "
                        f"(title similarity={features.title_sim_fuzzy:.2f}).{provenance_note}"
                    ),
                    triggered_rules=triggered_rules,
                    mismatched_fields=[],
                    style_penalty=style_penalty,
                )

        if (
            best
            and best.source_name == "doi_ra"
            and doi_match
            and features.title_sim_fuzzy >= 0.85
            and (year_dist <= self.year_tolerance or year_dist >= 900)
        ):
            triggered_rules.append("R-GLOBAL-DOI-RA-VERIFIED")
            ra_agency = (best.external_ids or {}).get("doi_ra", "Global DOI RA")
            return RuleOutcome(
                label=ValidationLabel.VERIFIED,
                confidence=max(0.0, 0.88 - style_penalty - provenance_penalty),
                reasoning=(
                    f"Exact DOI verified via Global DOI Registration Agency ({ra_agency}) CSL-JSON "
                    f"(title similarity={features.title_sim_fuzzy:.2f}).{provenance_note}"
                ),
                triggered_rules=triggered_rules,
                mismatched_fields=[],
                style_penalty=style_penalty,
            )

        # === FIX v1.7: LOCAL_DB Perfect Match → VERIFIED ===
        # Checked BEFORE R-WELL-LINKED so local_db exact matches get accurate
        # provenance reasoning instead of a generic 'et al.' author-mismatch message.
        local_verified = self._rule_local_db_verified(
            source,
            features,
            style_penalty,
            citation_doi=citation_doi,
            citation_authors=citation_authors,
        )
        if local_verified:
            return local_verified

        # === FIX v1.7: LOCAL_DB Good Match → VERIFIED ===
        local_good = self._rule_local_db_good_match(
            source, features, style_penalty, citation_doi=citation_doi
        )
        if local_good:
            return local_good

        # --- Rule 1b (NEW): Well-linked citation with high title similarity → VERIFIED ---
        # Requires fuzzy title match, non-zero author overlap, compatible year, and no DOI conflict.
        # FIX Phase 3 (BUG-21): Preprint arXiv DOI (10.48550/arXiv.*) vs published conference/journal DOI
        # is not a DOI conflict when title & author match.
        is_arxiv_vs_pub_doi = bool(
            citation_doi
            and best.doi
            and (
                "10.48550/arxiv" in citation_doi.lower()
                or "10.48550/arxiv" in best.doi.lower()
            )
            and features.title_sim_fuzzy >= 0.85
            and author_sim >= 0.35
        )
        has_doi_conflict = bool(citation_doi and best.doi and not doi_match and not is_arxiv_vs_pub_doi)
        if (
            mapping_is_matched
            and features.title_sim_fuzzy >= 0.7
            and author_sim >= 0.3
            and year_dist <= self.year_tolerance
            and not has_doi_conflict
        ):
            triggered_rules.append("R-WELL-LINKED")
            author_note = (
                f"Author overlap={author_sim:.2f} (full match)."
                if author_sim >= 0.99
                else f"Partial author overlap (author_jaccard={author_sim:.2f}, likely due to 'et al.')."
            )
            return RuleOutcome(
                label=ValidationLabel.VERIFIED,
                confidence=max(0.0, 0.85 - style_penalty - provenance_penalty),
                reasoning=(
                    f"Citation is properly linked and has high title "
                    f"similarity ({features.title_sim_fuzzy:.2f}). {author_note} "
                    f"Verification succeeded.{provenance_note}"
                ),
                triggered_rules=triggered_rules,
                mismatched_fields=[],
                style_penalty=style_penalty,
            )

        # --- Rule 1c (NEW): Well-linked with moderate title similarity → VERIFIED ---
        if (
            mapping_is_matched
            and 0.5 <= features.title_sim_fuzzy < 0.7
            and author_sim >= 0.3
            and year_dist <= self.year_tolerance
            and not has_doi_conflict
            and (doi_match or consensus >= 2)
        ):
            triggered_rules.append("R-WELL-LINKED-MODERATE")
            return RuleOutcome(
                label=ValidationLabel.VERIFIED,
                confidence=max(0.0, 0.75 - style_penalty - provenance_penalty),
                reasoning=(
                    f"Citation is properly linked with moderate title "
                    f"similarity ({features.title_sim_fuzzy:.2f}), "
                    f"author_jaccard={author_sim:.2f}. "
                    f"Verified with minor metadata variation.{provenance_note}"
                ),
                triggered_rules=triggered_rules,
                mismatched_fields=[],
                style_penalty=style_penalty,
            )

        # --- Rule 1d (NEW v2.4): Cross-lingual translated title match → METADATA_ERROR ---
        # Per TDTU citation guidelines, foreign-language publication titles must be preserved in their
        # original language without translation.
        if (
            getattr(features, "cross_lingual_title_detected", False)
            and float(getattr(features, "cross_lingual_title_sim", 0.0) or 0.0) >= 0.58
            and features.title_sim_fuzzy < 0.65
            and not has_doi_conflict
            and (
                doi_match
                or (author_sim >= 0.50 and (year_dist <= max(self.year_tolerance, 2) or year_dist >= 900))
            )
        ):
            mismatched.append("title")
            if year_dist > self.year_tolerance and year_dist < 900:
                mismatched.append("year")
            if author_sim < self.author_jaccard_verified and not doi_match:
                mismatched.append("author")
            triggered_rules.append("R-CROSS-LINGUAL-TITLE-MATCH")
            xl_t_sim = float(getattr(features, "cross_lingual_title_sim", 0.0) or 0.0)
            orig_title = best.title if best and best.title else "original publication title"
            return RuleOutcome(
                label=ValidationLabel.METADATA_ERROR,
                confidence=max(0.0, 0.76 - style_penalty),
                reasoning=(
                    f"Cross-lingual translated title detected (VI ↔ EN semantic alignment={xl_t_sim:.2f}). "
                    f"Matched authentic work '{orig_title}', but per academic/TDTU citation standards, "
                    f"foreign-language titles must be kept in their original language without translation. "
                    f"Mismatched fields: {', '.join(mismatched)}."
                ),
                triggered_rules=triggered_rules,
                mismatched_fields=mismatched,
                style_penalty=style_penalty,
            )

        # --- Rule 2: DOI resolves + moderate title similarity → METADATA_ERROR ---
        # Only apply for live sources, not for local_db (which is handled above)
        if (
            not mapping_is_matched  # Only apply if not already well-linked
            and doi_match
            and self.title_sim_metadata_error <= title_sim < self.title_sim_verified
            and "local_db" not in source.sources_succeeded  # Skip if local_db matched
        ):
            mismatched.append("title")
            if year_dist > self.year_tolerance:
                mismatched.append("year")
            if author_sim < self.author_jaccard_verified:
                mismatched.append("author")
            triggered_rules.append("R-DOI-TITLE-MISMATCH")
            return RuleOutcome(
                label=ValidationLabel.METADATA_ERROR,
                confidence=max(0.0, 0.7 - style_penalty),
                reasoning=(
                    f"DOI resolved but title similarity is moderate ({title_sim:.2f}). "
                    f"Mismatched fields: {', '.join(mismatched)}."
                ),
                triggered_rules=triggered_rules,
                mismatched_fields=mismatched,
                style_penalty=style_penalty,
            )

        # --- Rule 2b: Spliced / Chimeric DOI hallucination (valid DOI belonging to a completely different paper) ---
        is_cross_lingual_title = bool(getattr(features, "cross_lingual_title_detected", False))
        _chimeric_zero_content_overlap = False
        if (
            doi_match
            and best
            and best.title
            and citation_raw
            and features.title_sim_fuzzy < 0.45
            and features.title_sim_semantic < 0.42
        ):
            _stop = {"with", "from", "into", "over", "under", "using", "based", "study", "analysis", "review", "journal", "proceedings", "conference"}
            _cand_tokens = {
                w
                for w in re.findall(r"[a-z0-9]{4,}", best.title.lower())
                if w not in _stop and not re.fullmatch(r"(?:18|19|20)\d{2}", w)
            }
            _raw_tokens = set(re.findall(r"[a-z0-9]{4,}", citation_raw.lower()))
            if len(_cand_tokens) >= 3 and len(_cand_tokens & _raw_tokens) == 0:
                _chimeric_zero_content_overlap = True

        _titleless_exempt_from_chimeric = bool(
            is_titleless_journal_ref
            and bool(citation_authors)
            and author_sim >= 0.34
            and titleless_venue_ok
        )
        _doi_check_norm = ((best.doi if best and best.doi else citation_doi) or "").strip().lower()
        _is_repo_doi_on_journal = bool(
            _doi_check_norm
            and any(
                _doi_check_norm.startswith(prefix)
                and not any(h in _norm_cit_venue for h in allowed_hosts)
                for prefix, allowed_hosts in _REPO_DOI_VENUE_PREFIXES
            )
        )
        _has_journal_vol_page_sig = bool(
            re.search(
                r"\b(?:18|19|20)\d{2}\b\s*,\s*[A-Za-z]?\d+\s*,|"
                r"\b\d+\s*(?:\([^)]+\))?\s*,\s*(?:pp?\.\s*)?[A-Za-z]?\d+\s*(?:[-–—]|\(\s*(?:18|19|20)\d{2})",
                _eff_raw or "",
            )
        )
        _cand_venue_str = (best.venue or "").strip() if best else ""
        _titleless_chimeric_venue_mismatch = bool(
            doi_match
            and is_titleless_journal_ref
            and not titleless_venue_ok
            and features.title_sim_fuzzy < 0.65
            and (
                (
                    bool(_cand_venue_str)
                    and float(getattr(features, "venue_sim", 0.0) or 0.0) < 0.25
                    and VenueNormalizer().similarity(citation_venue, _cand_venue_str) < 0.25
                )
                or _is_repo_doi_on_journal
                or (not _cand_venue_str and _has_journal_vol_page_sig)
            )
        )

        if (
            doi_match
            and _has_live_source(source, verified_sources)
            and not is_cross_lingual_title
            and not (not citation_authors and author_sim == 0.0 and title_sim >= 0.85)
            and not _titleless_exempt_from_chimeric
            and (
                (title_sim < 0.35 and author_sim < 0.20)
                or (features.title_sim_fuzzy < 0.25 and features.title_sim_semantic < 0.45)
                or _chimeric_zero_content_overlap
                or _titleless_chimeric_venue_mismatch
            )
        ):
            mismatched.extend(["doi", "title"])
            if _titleless_chimeric_venue_mismatch:
                mismatched.append("venue")
            if author_sim < 0.50:
                mismatched.append("author")
            if year_dist > self.year_tolerance and year_dist < 900:
                mismatched.append("year")
            triggered_rules.extend(["R-CHIMERIC-DOI-MISMATCH", "R-HALLUCINATED-SOURCE"])
            return RuleOutcome(
                label=ValidationLabel.SUSPECTED_HALLUCINATION,
                confidence=max(0.0, 0.88 - style_penalty),
                reasoning=(
                    f"Spliced/chimeric citation detected: cited DOI resolved to an unrelated work "
                    f"(fuzzy title similarity={features.title_sim_fuzzy:.2f}, author overlap={author_sim:.2f}). "
                    f"Mismatched fields: {', '.join(mismatched)}."
                ),
                triggered_rules=triggered_rules,
                mismatched_fields=mismatched,
                style_penalty=style_penalty,
            )

        # --- Rule 2c: Title-less chemistry/physics journal DOI match with metadata mismatch → METADATA_ERROR ---
        if (
            doi_match
            and _has_live_source(source, verified_sources)
            and is_titleless_journal_ref
            and bool(citation_authors)
        ):
            if year_dist is not None and 2 <= year_dist < 900:
                mismatched.append("year")
                triggered_rules.append("R-YEAR-MISMATCH")
            if author_sim < 0.50:
                mismatched.append("author")
            if not titleless_venue_ok:
                mismatched.append("venue")
            if mismatched:
                triggered_rules.append("R-DOI-METADATA-MISMATCH")
                return RuleOutcome(
                    label=ValidationLabel.METADATA_ERROR,
                    confidence=max(0.0, 0.72 - style_penalty),
                    reasoning=(
                        f"Exact DOI match on title-less journal citation with mismatched metadata "
                        f"({', '.join(mismatched)}); author overlap={author_sim:.2f}, "
                        f"year_distance={year_dist}."
                    ),
                    triggered_rules=triggered_rules,
                    mismatched_fields=mismatched,
                    style_penalty=style_penalty,
                )

        # --- Rule 3: ≥2 sources in consensus ---
        if consensus >= self.consensus_verified and title_sim >= self.title_sim_verified:
            if (
                author_sim >= self.author_jaccard_verified
                and year_dist <= self.year_tolerance
                and not has_doi_conflict
            ):
                triggered_rules.append("R-CONSENSUS-FULL")
                return RuleOutcome(
                    label=ValidationLabel.VERIFIED,
                    confidence=max(0.0, 0.8 - style_penalty - provenance_penalty),
                    reasoning=f"{consensus} scholarly sources agree on title, author, and year.{provenance_note}",
                    triggered_rules=triggered_rules,
                    mismatched_fields=[],
                    style_penalty=style_penalty,
                )
            if has_doi_conflict:
                mismatched.append("doi")
            if year_dist > self.year_tolerance:
                mismatched.append("year")
            if author_sim < self.author_jaccard_verified:
                mismatched.append("author")
            if (
                completeness.is_incomplete
                and not has_doi_conflict
                and not is_known_author
                and not _is_exempt_from_incomplete_metadata(
                    citation_raw or source.citation_raw,
                    citation_url=citation_url,
                    citation_doi=citation_doi,
                    citation_authors=citation_authors,
                )
            ):
                for mf in completeness.missing_fields:
                    if mf not in mismatched and not (mf == "authors" and "author" in mismatched):
                        mismatched.append(mf)
                triggered_rules.append("R-INCOMPLETE-METADATA")
            triggered_rules.append("R-CONSENSUS-PARTIAL")
            return RuleOutcome(
                label=ValidationLabel.METADATA_ERROR,
                confidence=max(0.0, 0.65 - style_penalty),
                reasoning=(
                    f"{consensus} scholarly sources matched the title but have mismatched fields: "
                    f"{', '.join(mismatched)}."
                ),
                triggered_rules=triggered_rules,
                mismatched_fields=mismatched,
                style_penalty=style_penalty,
            )

        # --- Rule 3b: 1 live source with high title + author + year match → VERIFIED ---
        if (
            consensus >= 1
            and _has_live_source(source, verified_sources)
            and features.title_sim_fuzzy >= 0.90
            and author_sim >= 0.80
            and year_dist <= self.year_tolerance
            and not has_doi_conflict
        ):
            triggered_rules.append("R-SINGLE-SOURCE-VERIFIED")
            return RuleOutcome(
                label=ValidationLabel.VERIFIED,
                confidence=max(0.0, 0.78 - style_penalty - provenance_penalty),
                reasoning=(
                    f"Verified via scholarly registry ({', '.join(source.sources_succeeded)}): "
                    f"title similarity={features.title_sim_fuzzy:.2f}, "
                    f"author overlap={author_sim:.2f}, year match.{provenance_note}"
                ),
                triggered_rules=triggered_rules,
                mismatched_fields=[],
                style_penalty=style_penalty,
            )

        # --- Rule 3b2: Book monograph verified via OpenLibrary across reprint/edition years → VERIFIED ---
        if (
            consensus >= 1
            and "openlibrary" in source.sources_succeeded
            and not citation_doi
            and not best.doi
            and features.title_sim_fuzzy >= 0.95
            and author_sim >= 0.90
            and 1 < year_dist <= 15
        ):
            triggered_rules.append("R-BOOK-EDITION-VERIFIED")
            return RuleOutcome(
                label=ValidationLabel.VERIFIED,
                confidence=max(0.0, 0.78 - style_penalty - provenance_penalty),
                reasoning=(
                    f"Verified book monograph via OpenLibrary: exact title ({features.title_sim_fuzzy:.2f}) "
                    f"and author ({author_sim:.2f}) match; edition/reprint year variation tolerated.{provenance_note}"
                ),
                triggered_rules=triggered_rules,
                mismatched_fields=[],
                style_penalty=style_penalty,
            )

        # --- Rule 3c: 1 live source with title + author match but year mismatch → METADATA_ERROR ---
        if (
            consensus >= 1
            and _has_live_source(source, verified_sources)
            and features.title_sim_fuzzy >= 0.85
            and author_sim >= self.author_jaccard_verified
            and year_dist > self.year_tolerance
            and not has_doi_conflict
        ):
            if features.title_sim_fuzzy < 0.90:
                mismatched.append("title")
            mismatched.append("year")
            triggered_rules.append("R-SINGLE-SOURCE-PARTIAL")
            return RuleOutcome(
                label=ValidationLabel.METADATA_ERROR,
                confidence=max(0.0, 0.68 - style_penalty),
                reasoning=(
                    f"Found paper by the same author on {', '.join(source.sources_succeeded)} "
                    f"(title_sim={features.title_sim_fuzzy:.2f}, author_sim={author_sim:.2f}) "
                    f"with mismatched fields: {', '.join(mismatched)}."
                ),
                triggered_rules=triggered_rules,
                mismatched_fields=mismatched,
                style_penalty=style_penalty,
            )

        # --- Rule 4 (NEW v1.2 #33): AMBIGUOUS_MAPPING → cap confidence ---
        # If linker could not disambiguate → force abstention band
        if mapping_status is not None and hasattr(mapping_status, "value"):
            if mapping_status.value == "ambiguous_mapping":
                triggered_rules.append("R-AMBIGUOUS-MAPPING")
                return RuleOutcome(
                    label=ValidationLabel.UNRESOLVED,
                    confidence=max(
                        0.0,
                        min(self.ambiguous_confidence_cap, title_sim)
                        - style_penalty,
                    ),
                    reasoning=(
                        f"Ambiguous citation mapping (linker could not uniquely resolve which reference "
                        f"entry corresponds to the occurrence). title_sim={title_sim:.2f}, "
                        f"consensus={consensus}. System abstains from a hard verdict."
                    ),
                    triggered_rules=triggered_rules,
                    mismatched_fields=[],
                    style_penalty=style_penalty,
                )

        # === NEW v1.3: Content Alignment Rule (Neural Layer) ===
        # Check if Neural layer provided content alignment signal
        # IMPORTANT: Neural should NOT override symbolic rules for MISSING_REFERENCE cases
        content_alignment_score = features.content_alignment_score
        content_is_aligned = features.content_is_aligned

        # NEW: Check if citation has MISSING_REFERENCE status
        # If missing reference, Neural cannot verify - this is a hard block
        is_missing_reference = (
            mapping_status is not None
            and hasattr(mapping_status, "value")
            and mapping_status.value == "missing_reference"
        )

        if content_alignment_score > 0 and not is_missing_reference:
            if (
                content_is_aligned
                and features.title_sim_fuzzy >= 0.6
                and author_sim >= 0.5
                and year_dist <= self.year_tolerance
                and not has_doi_conflict
            ):
                if (
                    consensus >= 2
                    or mapping_status is None
                    or (
                        mapping_status
                        and hasattr(mapping_status, "value")
                        and mapping_status.value == "matched"
                    )
                ):
                    triggered_rules.append("R-CONTENT-ALIGNMENT")
                    if getattr(features, "cross_lingual_detected", False):
                        triggered_rules.append("R-CROSS-LINGUAL-ALIGNMENT")
                    return RuleOutcome(
                        label=ValidationLabel.VERIFIED,
                        confidence=max(0.0, 0.85 - style_penalty),
                        reasoning=(
                            f"Neural content alignment verified (score={content_alignment_score:.2f}). "
                            f"Content semantic match confirmed with title sim={features.title_sim_fuzzy:.2f}, consensus={consensus}."
                        ),
                        triggered_rules=triggered_rules,
                        mismatched_fields=[],
                        style_penalty=style_penalty,
                    )

        # --- Rule 4a3: Local ACL / SQLite DB canonical match with metadata discrepancy → METADATA_ERROR ---
        local_meta_err = self._rule_local_db_metadata_error(
            source,
            features,
            style_penalty,
            citation_doi=citation_doi,
            citation_authors=citation_authors,
        )
        if local_meta_err:
            return local_meta_err

        if content_alignment_score > 0 and not is_missing_reference:
            triggered_rules.append("R-CONTENT-ALIGNMENT")
            if getattr(features, "cross_lingual_detected", False) and content_is_aligned:
                triggered_rules.append("R-CROSS-LINGUAL-ALIGNMENT")

            has_non_live_missing_abstract = bool(
                best
                and best.source_name in _NON_LIVE_SOURCES
                and not (best.abstract and str(best.abstract).strip())
            )
            # Rule: Low content alignment + high fuzzy title & author match = SUSPECTED_HALLUCINATION
            # Only applies when year is consistent and candidate is not a title-only local_db row
            if (
                not content_is_aligned
                and content_alignment_score >= 0.3
                and features.title_sim_fuzzy >= 0.75
                and author_sim >= 0.5
                and year_dist <= self.year_tolerance
                and not has_non_live_missing_abstract
            ):
                triggered_rules.append("R-CONTENT-MISMATCH")
                return RuleOutcome(
                    label=ValidationLabel.SUSPECTED_HALLUCINATION,
                    confidence=max(0.0, 0.80 - style_penalty),
                    reasoning=(
                        f"WARNING: Title matches (sim={features.title_sim_fuzzy:.2f}) but content NOT aligned "
                        f"(Neural score={content_alignment_score:.2f}). Citation may be misattributed."
                    ),
                    triggered_rules=triggered_rules,
                    mismatched_fields=["content"],
                    style_penalty=style_penalty,
                )

            # Rule: Moderate content alignment = UNRESOLVED (only when candidate plausibly matches author/year)
            if (
                not content_is_aligned
                and 0.2 <= content_alignment_score < 0.5
                and author_sim >= 0.3
                and year_dist <= self.year_tolerance
                and not (citation_url and not citation_doi and url_status in ("alive", "restricted_alive"))
            ):
                return RuleOutcome(
                    label=ValidationLabel.UNRESOLVED,
                    confidence=max(0.0, content_alignment_score - style_penalty),
                    reasoning=(
                        f"Content alignment uncertain (score={content_alignment_score:.2f}). "
                        f"Neural layer cannot confirm semantic match. Manual review recommended."
                    ),
                    triggered_rules=triggered_rules,
                    mismatched_fields=[],
                    style_penalty=style_penalty,
                )

        # Guard: Domestic Vietnamese theses, university textbooks, and unindexed periodicals
        # frequently collide on common Vietnamese author names (e.g. "Trần Thị Hồng", "Nguyễn Văn Trường")
        # or broad topic phrases against unrelated newer Crossref/DOAJ articles. Abstain to UNRESOLVED
        # instead of falsely blaming the student for METADATA_ERROR.
        if (
            not doi_match
            and not (citation_doi and str(citation_doi).strip())
            and not completeness.is_incomplete
            and title_sim < self.title_sim_verified
            and (year_dist > 2 or author_sim < 0.50)
        ):
            raw_for_vn = citation_raw or source.citation_raw or ""
            if re.search(
                r"[ăâđêôơưáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]",
                raw_for_vn,
                re.IGNORECASE,
            ):
                is_vn_unindexed, vn_unindexed_kind = _is_non_journal_or_unindexed_source(
                    raw_for_vn,
                    citation_url=citation_url,
                    citation_doi=citation_doi,
                    citation_authors=citation_authors,
                )
                if is_vn_unindexed and vn_unindexed_kind in (
                    "thesis_or_report",
                    "book_or_monograph",
                    "domestic_unindexed_periodical",
                ):
                    return RuleOutcome(
                        label=ValidationLabel.UNRESOLVED,
                        confidence=0.50,
                        reasoning=(
                            f"Domestic Vietnamese source ({vn_unindexed_kind.replace('_', ' ')}) is not indexed in "
                            f"international scholarly registries; weak cross-work search candidate rejected."
                        ),
                        triggered_rules=["R-UNINDEXED-BOOK-OR-SOURCE"],
                        mismatched_fields=[],
                        style_penalty=0.0,
                    )

        # --- Rule 4a2: Single/multi live source partial match (author/year/title discrepancy) → METADATA_ERROR ---
        if (
            consensus >= 1
            and _has_live_source(source, verified_sources)
            and not has_doi_conflict
            and (
                author_sim > 0.0
                or doi_match
                or (consensus >= 2 and title_sim >= 0.90 and year_dist <= 1)
            )
            and (
                (title_sim >= self.title_sim_verified and (author_sim < self.author_jaccard_verified or year_dist > self.year_tolerance))
                or (self.title_sim_metadata_error <= title_sim < self.title_sim_verified and (author_sim >= 0.30 or year_dist <= 2))
            )
        ):
            if title_sim < self.title_sim_verified:
                mismatched.append("title")
            if author_sim < self.author_jaccard_verified:
                mismatched.append("author")
            if year_dist > self.year_tolerance:
                mismatched.append("year")
            if not mismatched:
                mismatched.append("title")
            triggered_rules.append("R-SINGLE-SOURCE-PARTIAL")
            return RuleOutcome(
                label=ValidationLabel.METADATA_ERROR,
                confidence=max(0.0, 0.68 - style_penalty),
                reasoning=(
                    f"Scholarly record matched on {', '.join(source.sources_succeeded)} "
                    f"(title_sim={title_sim:.2f}, author_sim={author_sim:.2f}, year_dist={year_dist}) "
                    f"with metadata discrepancy in: {', '.join(mismatched)}."
                ),
                triggered_rules=triggered_rules,
                mismatched_fields=mismatched,
                style_penalty=style_penalty,
            )

        # --- Rule 4b (NEW v1.3): METADATA_ERROR detection for known authors ---
        # If citation has known academic author + title mismatch + year mismatch
        # -> This is METADATA_ERROR, not HALLUCINATION or UNRESOLVED
        # IMPORTANT: Only apply if we have VERIFIED sources with GOOD candidates
        # FIX v1.4: Only apply if sources returned QUALITY candidates (not just any candidate)
        has_verified_sources = len(source.sources_succeeded) > 0

        # FIX v1.4: Check if we have at least one quality candidate with decent title match
        has_quality_candidate = False
        best = source.best_candidate()
        if best and best.title and best.title.lower() not in ["", "unknown", "n/a"]:
            # Quality candidate: has title and reasonable score
            # Use citation_raw instead of citation (not available in apply method)
            title_sim_for_check = self.fuzzy.token_set_ratio(
                (citation_raw or "").lower(),
                best.title.lower()
            ) if best.title else 0
            has_quality_candidate = title_sim_for_check >= 0.3

        if is_known_author and has_verified_sources and has_quality_candidate and author_sim >= 0.5:
            # Only apply METADATA_ERROR if we have quality evidence
            if 0.3 <= title_sim < self.title_sim_verified:
                triggered_rules.append("R-KNOWN-AUTHOR-TITLE-MISMATCH")
                mismatched.append("title")
                if year_dist > self.year_tolerance:
                    mismatched.append("year")
                return RuleOutcome(
                    label=ValidationLabel.METADATA_ERROR,
                    confidence=0.65,
                    reasoning=(
                        f"Known academic author detected but title mismatch ({title_sim:.2f}). "
                        f"Mismatched fields: {', '.join(mismatched)}. "
                        f"Classified as a metadata error rather than a fabricated source."
                    ),
                    triggered_rules=triggered_rules,
                    mismatched_fields=mismatched,
                    style_penalty=style_penalty,
                )

        # --- Rule 4c: Non-existent / unresolvable DOI with low title similarity → SUSPECTED_HALLUCINATION ---
        if (
            citation_doi
            and str(citation_doi).strip()
            and _has_live_source(source, verified_sources)
            and not doi_match
            and title_sim < 0.60
            and not is_known_author
        ):
            triggered_rules.append("R-NONEXISTENT-DOI")
            return RuleOutcome(
                label=ValidationLabel.SUSPECTED_HALLUCINATION,
                confidence=max(0.0, 0.85 - style_penalty),
                reasoning=(
                    f"Cited DOI '{citation_doi}' did not resolve to any matching record and "
                    f"best candidate title similarity is low ({title_sim:.2f}). "
                    f"Suspected fabricated or non-existent DOI."
                ),
                triggered_rules=triggered_rules,
                mismatched_fields=["doi", "title"],
                style_penalty=style_penalty,
            )

        # --- Rule 4d: Dead URL with low title similarity and no DOI match → SUSPECTED_HALLUCINATION ---
        if (
            url_status == "dead_link"
            and not doi_match
            and title_sim < 0.60
            and not is_known_author
        ):
            triggered_rules.append("R-DEAD-URL")
            status_detail = f"HTTP {url_status_code}" if url_status_code else "unreachable"
            return RuleOutcome(
                label=ValidationLabel.SUSPECTED_HALLUCINATION,
                confidence=max(0.0, 0.85 - style_penalty),
                reasoning=(
                    f"Citation URL '{citation_url}' is dead ({status_detail}) and candidate title "
                    f"similarity is low ({title_sim:.2f}). Suspected hallucinated link/reference."
                ),
                triggered_rules=triggered_rules,
                mismatched_fields=["url", "title"],
                style_penalty=style_penalty,
            )

        # --- Rule 4e: Reachable or Wayback-archived URL resource with no DOI and no scholarly match → RESOURCE ---
        if (
            citation_url
            and not (citation_doi and str(citation_doi).strip())
            and url_status == "archived_alive"
            and not is_known_author
        ):
            archive_url = getattr(source, "archive_url", None) or "https://web.archive.org"
            return RuleOutcome(
                label=ValidationLabel.RESOURCE,
                confidence=0.90,
                reasoning=(
                    f"Citation URL '{citation_url}' experienced link rot, but an authentic snapshot "
                    f"was verified on Internet Archive Wayback Machine ({archive_url})."
                ),
                triggered_rules=["R-WAYBACK-ARCHIVED", "R-URL-RESOURCE"],
                mismatched_fields=[],
                style_penalty=0.0,
            )

        if (
            citation_url
            and not (citation_doi and str(citation_doi).strip())
            and url_status in ("alive", "restricted_alive")
            and not is_known_author
        ):
            status_code_str = f"HTTP {url_status_code}" if url_status_code else "HTTP 200 OK"
            return RuleOutcome(
                label=ValidationLabel.RESOURCE,
                confidence=0.95,
                reasoning=(
                    f"Citation URL '{citation_url}' is reachable ({status_code_str}) and represents an "
                    f"online documentation/web resource rather than an indexed scholarly paper."
                ),
                triggered_rules=["R-URL-RESOURCE"],
                mismatched_fields=[],
                style_penalty=0.0,
            )

        # --- Rule 4f (Subsystem A1): Incomplete bibliography entry (both high-sim bare title & low-sim noise) ---
        if (
            completeness.is_incomplete
            and not doi_match
            and not has_doi_conflict
            and (consensus >= 1 or _has_live_source(source, verified_sources))
            and not is_known_author
            and not _is_exempt_from_incomplete_metadata(
                citation_raw or source.citation_raw,
                citation_url=citation_url,
                citation_doi=citation_doi,
                citation_authors=citation_authors,
            )
        ):
            missing_f = list(completeness.missing_fields or ["authors", "year", "venue"])
            if title_sim >= 0.78:
                reason_msg = (
                    f"Incomplete bibliographic reference matching title (title_sim={title_sim:.2f}) "
                    f"but missing required metadata ({', '.join(missing_f)})."
                )
            else:
                reason_msg = (
                    f"Incomplete bibliographic reference missing {', '.join(missing_f)}; "
                    f"weak candidate match (title_sim={title_sim:.2f} < 0.78) reflects missing "
                    f"citation metadata rather than a fabricated academic source."
                )
            return RuleOutcome(
                label=ValidationLabel.METADATA_ERROR,
                confidence=max(0.0, 0.80 - style_penalty),
                reasoning=reason_msg,
                triggered_rules=triggered_rules + ["R-INCOMPLETE-METADATA"],
                mismatched_fields=missing_f,
                style_penalty=style_penalty,
            )

        # --- Rule 5: Border zone -> UNRESOLVED (abstention) ---
        is_semantic_only_noise = bool(
            features.title_sim_fuzzy < 0.65
            and author_sim == 0.0
            and not doi_match
            and consensus <= 1
            and len(source.sources_queried) >= 4
        )
        if self.abstention_low <= title_sim <= self.abstention_high and not is_semantic_only_noise:
            triggered_rules.append("R-ABSTENTION-BORDER")
            return RuleOutcome(
                label=ValidationLabel.UNRESOLVED,
                confidence=max(0.0, title_sim - style_penalty),
                reasoning=(
                    f"Title similarity ({title_sim:.2f}) falls within the abstention border zone "
                    f"[{self.abstention_low}, {self.abstention_high}] — system abstains for manual review."
                ),
                triggered_rules=triggered_rules,
                mismatched_fields=[],
                style_penalty=style_penalty,
            )

        # --- Rule 6 (NEW v1.2 #33): DOMAIN-EXCEPTION ---
        # URL broken + scholarly record exists → keep label + flag.
        if (
            doi_match
            and title_sim < self.title_sim_metadata_error
            and consensus >= 2
        ):
            triggered_rules.append("R-DOMAIN-EXCEPTION")
            # Keep label as METADATA_ERROR but flag domain_exception
            return RuleOutcome(
                label=ValidationLabel.METADATA_ERROR,
                confidence=max(0.0, 0.5 - style_penalty),
                reasoning=(
                    f"DOMAIN-EXCEPTION: Exact DOI matched across {consensus} sources but title "
                    f"similarity is low ({title_sim:.2f}). Record exists in scholarly registries "
                    f"with metadata/link discrepancy."
                ),
                triggered_rules=triggered_rules,
                mismatched_fields=["url"],
                style_penalty=style_penalty,
                domain_exception=True,
            )

        # --- Rule fallback ---
        triggered_rules.append("R-WEAK-EVIDENCE")
        if is_known_author and sources_found > 0 and author_sim >= 0.5:
            best = source.best_candidate()
            has_quality = best and best.title and best.title.lower() not in ["", "unknown", "n/a"]

            if has_quality and 0.2 <= title_sim < self.title_sim_verified:
                mismatched = []
                if title_sim < self.title_sim_verified:
                    mismatched.append("title")
                if year_dist > self.year_tolerance:
                    mismatched.append("year")
                triggered_rules.append("R-KNOWN-AUTHOR-WEAK-EVIDENCE")
                return RuleOutcome(
                    label=ValidationLabel.METADATA_ERROR,
                    confidence=max(0.0, 0.55 - style_penalty),
                    reasoning=(
                        f"Known academic author found with weak title evidence (title_sim={title_sim:.2f}). "
                        f"Mismatched fields: {', '.join(mismatched)}. "
                        f"Classified as a metadata error rather than a fabricated source."
                    ),
                    triggered_rules=triggered_rules,
                    mismatched_fields=mismatched,
                    style_penalty=style_penalty,
                )

        # When live sources were queried and the best candidate has very low similarity
        # (below abstention_low=0.40) and low author overlap (<0.30) without DOI match,
        # classify as SUSPECTED_HALLUCINATION rather than hiding in UNRESOLVED —
        # UNLESS the reference is a non-journal source (book, classical/Bible text, web URL,
        # thesis, or legal/gov report — BUG-22).
        if (
            (title_sim < self.abstention_low or is_semantic_only_noise)
            and author_sim < 0.30
            and not doi_match
            and _has_live_source(source, verified_sources)
            and not is_known_author
        ):
            is_non_journal, non_journal_kind = _is_non_journal_or_unindexed_source(
                citation_raw or source.citation_raw,
                citation_url=citation_url,
                citation_doi=citation_doi,
                citation_authors=citation_authors,
            )
            if is_non_journal:
                if non_journal_kind in ("web_resource", "legal_or_standard"):
                    return RuleOutcome(
                        label=ValidationLabel.RESOURCE,
                        confidence=0.85,
                        reasoning=(
                            f"Reference is a non-scholarly {non_journal_kind.replace('_', ' ')} "
                            f"and noisy scholarly search candidates (title_sim={title_sim:.2f}) were ignored."
                        ),
                        triggered_rules=["R-NON-SCHOLARLY-RESOURCE"],
                        mismatched_fields=[],
                        style_penalty=0.0,
                    )
                triggered_rules.append("R-UNINDEXED-BOOK-OR-SOURCE")
                return RuleOutcome(
                    label=ValidationLabel.UNRESOLVED,
                    confidence=max(0.0, 0.55 - style_penalty),
                    reasoning=(
                        f"Non-periodical source ({non_journal_kind.replace('_', ' ')}) is not indexed "
                        f"in academic paper databases (best paper candidate title_sim={title_sim:.2f}) — "
                        f"abstaining from hallucination verdict."
                    ),
                    triggered_rules=triggered_rules,
                    mismatched_fields=[],
                    style_penalty=style_penalty,
                )
            triggered_rules.append("R-HALLUCINATED-SOURCE")
            hallucination_conf = max(
                0.55,
                min(0.85, round(0.85 - features.title_sim_fuzzy * 0.5, 2) - style_penalty)
                if is_semantic_only_noise and title_sim >= self.abstention_low
                else min(0.85, round(0.85 - title_sim * 0.5, 2) - style_penalty),
            )
            if is_semantic_only_noise and title_sim >= self.abstention_low:
                sim_detail = (
                    f"fuzzy_title_sim={features.title_sim_fuzzy:.2f} < 0.65, "
                    f"semantic_sim={features.title_sim_semantic:.2f}, "
                    f"author_sim={author_sim:.2f}, DOI match={doi_match}"
                )
            else:
                sim_detail = (
                    f"title_sim={title_sim:.2f} < {self.abstention_low}, "
                    f"author_sim={author_sim:.2f}, DOI match={doi_match}"
                )
            return RuleOutcome(
                label=ValidationLabel.SUSPECTED_HALLUCINATION,
                confidence=hallucination_conf,
                reasoning=(
                    f"Extremely weak scholarly evidence across queried databases "
                    f"({sim_detail}). Suspected AI-hallucinated or fabricated citation."
                ),
                triggered_rules=triggered_rules,
                mismatched_fields=["title", "author"],
                style_penalty=style_penalty,
            )

        return RuleOutcome(
            label=ValidationLabel.UNRESOLVED,
            confidence=max(0.0, 0.4 - style_penalty),
            reasoning=(
                f"Candidate found with inconclusive evidence (title_sim={title_sim:.2f}, "
                f"author_sim={author_sim:.2f}, DOI match={doi_match}, consensus={consensus}) — "
                f"insufficient to verify."
            ),
            triggered_rules=triggered_rules,
            mismatched_fields=[],
            style_penalty=style_penalty,
        )
