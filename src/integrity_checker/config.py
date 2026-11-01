"""Cấu hình ứng dụng — load từ YAML + .env, validate qua Pydantic Settings.

Module này là single source of truth cho mọi threshold / weight / path.
Mọi module khác chỉ import `get_settings()` và dùng — KHÔNG đọc file trực tiếp.

Đồng bộ với đề cương v1.2 (chốt với GVHD 2026-08-03).
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


PROJECT_ROOT = Path(__file__).resolve().parents[2]
MAIN_APP_DB_PATH = (PROJECT_ROOT / "data" / "app.db").resolve()


def is_test_runtime() -> bool:
    """Return True when running inside pytest or with APP_ENV=test."""
    import os
    import sys

    return (
        "pytest" in sys.modules
        or "PYTEST_CURRENT_TEST" in os.environ
        or os.getenv("APP_ENV", "").lower() in ("test", "testing")
    )


def is_main_app_db_url(url: str) -> bool:
    """Return True if a SQLite URL resolves to the main project data/app.db."""
    if not url.startswith("sqlite:///") or url == "sqlite:///:memory:":
        return False
    raw_path = url.removeprefix("sqlite:///").split("?", 1)[0]
    if not raw_path or raw_path == ":memory:":
        return False
    p = Path(raw_path)
    candidates = [p.resolve()]
    if not p.is_absolute():
        candidates.append((PROJECT_ROOT / p).resolve())
    return any(c == MAIN_APP_DB_PATH for c in candidates)


# ---------- Sub-configs ----------


class AppConfig(BaseModel):
    name: str = "Essay Integrity Checker"
    version: str = "0.2.0"   # v1.2 spec
    env: str = "development"
    debug: bool = False
    log_level: str = "INFO"


class DatabaseConfig(BaseModel):
    url: str = "sqlite:///./data/app.db"
    echo: bool = False


_INSECURE_JWT_SECRETS = frozenset({
    "change-me-in-production-use-env-var",
    "citra-secret-key-change-in-production-2026",
    "secret",
    "changeme",
})


class AuthConfig(BaseModel):
    """Authentication config for JWT tokens and Google OAuth2."""

    jwt_secret: str = "change-me-in-production-use-env-var"
    token_expire_hours: int = 24
    activation_expire_hours: int = 24
    reset_expire_minutes: int = 30
    google_client_id: str = ""
    google_client_secret: str = ""

    def validate_for_env(self, app_env: str) -> None:
        """Reject default/weak JWT secrets when running in production."""
        import logging
        import os

        effective_env = (app_env or os.getenv("APP_ENV", "")).strip().lower()
        is_prod = effective_env in ("production", "prod", "live")

        if self.jwt_secret in _INSECURE_JWT_SECRETS:
            if is_prod:
                raise ValueError(
                    "JWT_SECRET must be set via environment variable in production. "
                    "Generate a secure random secret: python -c \"import secrets; print(secrets.token_urlsafe(32))\""
                )
            logging.getLogger(__name__).warning(
                "Using default JWT secret. Set JWT_SECRET in .env for production."
            )
        if len(self.jwt_secret) < 32 and is_prod:
            raise ValueError(
                f"JWT_SECRET must be at least 32 characters in production. Got {len(self.jwt_secret)} characters."
            )

    @field_validator("jwt_secret")
    @classmethod
    def _validate_jwt_secret(cls, v: str) -> str:
        """Initial field validator (also re-validated in Settings after env overrides)."""
        import os

        app_env = os.getenv("APP_ENV", "").strip().lower()
        if app_env in ("production", "prod", "live"):
            if v in _INSECURE_JWT_SECRETS:
                raise ValueError(
                    "JWT_SECRET must be set via environment variable in production. "
                    "Generate a secure random secret: python -c \"import secrets; print(secrets.token_urlsafe(32))\""
                )
            if len(v) < 32:
                raise ValueError(
                    f"JWT_SECRET must be at least 32 characters. Got {len(v)} characters."
                )
        return v


class EmailConfig(BaseModel):
    """SMTP configuration for transactional HTML emails (activation, password reset)."""

    smtp_host: str = "smtp.gmail.com"
    smtp_port: int = 465
    smtp_user: str = "noreply@citra.edu.vn"
    smtp_password: str = ""
    from_email: str = "noreply@citra.edu.vn"
    from_name: str = "CITRA — Academic Source Verification"
    frontend_url: str = "http://localhost:5173"
    enabled: bool = True

    @property
    def normalized_password(self) -> str:
        """Return Google App Password with quotes and spaces stripped."""
        return (self.smtp_password or "").strip().strip('"').strip("'").replace(" ", "").strip()


class PathsConfig(BaseModel):
    data_dir: Path = Path("./data")
    essays_dir: Path = Path("./data/essays")
    cache_dir: Path = Path("./data/cache")
    grobid_output_dir: Path = Path("./data/cache/grobid")   # MỚI v1.2

    @field_validator("*", mode="before")
    @classmethod
    def _coerce_path(cls, v: Any) -> Any:
        return Path(v) if isinstance(v, str) else v


# --- Extraction (MỚI v1.2: GROBID section) ---


class GrobidConfig(BaseModel):
    """GROBID service config — MUST-HAVE trong MVP v1.2."""

    enabled: bool = True
    url: str = "http://localhost:8070"
    timeout_seconds: int = 30
    cache_by_file_sha256: bool = True
    consolidate_header: list[str] = Field(
        default_factory=lambda: [
            "abstract",
            "body",
            "bibliography",
            "footnote",
            "appendix",
        ]
    )


class ExtractionConfig(BaseModel):
    # v1.1: mupdf | pdfplumber | hybrid
    # v1.2: thêm grobid_hybrid — GROBID TEI XML + PyMuPDF bounding box
    parser: str = "grobid_hybrid"
    fallback_to_ocr: bool = False
    min_text_length: int = 50
    grobid: GrobidConfig = Field(default_factory=GrobidConfig)


# --- Citation style detection (MỚI v1.2) ---


class StyleFeaturesConfig(BaseModel):
    """Regex features cho style detection."""

    apa_author_year_pattern: str = (
        r"\([A-Z][^()]{0,80},\s*(19|20)\d{2}[a-z]?\)"
    )
    ieee_numeric_pattern: str = r"\[\d+(?:\s*[-,]\s*\d+)*\]"


class StyleOutputConfig(BaseModel):
    classes: list[str] = Field(
        default_factory=lambda: ["APA-like", "IEEE-like", "MIXED", "UNKNOWN"]
    )


class StyleDetectionConfig(BaseModel):
    """Document-level citation style profile (v1.2 §3.5)."""

    min_occurrences_to_classify: int = 5
    mixed_threshold: float = 0.3
    unknown_threshold: float = 0.15
    features: StyleFeaturesConfig = Field(default_factory=StyleFeaturesConfig)
    output: StyleOutputConfig = Field(default_factory=StyleOutputConfig)


# --- Bidirectional linking (MỚI v1.2) ---


class DuplicateDetectionConfig(BaseModel):
    """Duplicate detection trong reference entries."""

    exact_identifier_match: bool = True
    title_year_author_similarity: float = 0.92


class LinkingStatusesConfig(BaseModel):
    enabled: list[str] = Field(
        default_factory=lambda: [
            "MATCHED",
            "MISSING_REFERENCE",
            "UNCITED_REFERENCE",
            "IN_TEXT_MISMATCH",
            "DUPLICATE_REFERENCE",
            "AMBIGUOUS_MAPPING",
            "STYLE_INCONSISTENT",
        ]
    )


class SameAuthorYearResolutionConfig(BaseModel):
    use_title_metadata: bool = True
    use_first_author: bool = True


class LinkingConfig(BaseModel):
    """Bidirectional citation linking (v1.2 §3.5)."""

    exclude_sections: list[str] = Field(
        default_factory=lambda: [
            "references",
            "bibliography",
            "tài liệu tham khảo",
            "appendix",
            "phụ lục",
        ]
    )
    duplicate_detection: DuplicateDetectionConfig = Field(
        default_factory=DuplicateDetectionConfig
    )
    statuses: LinkingStatusesConfig = Field(default_factory=LinkingStatusesConfig)
    same_author_year_resolution: SameAuthorYearResolutionConfig = Field(
        default_factory=SameAuthorYearResolutionConfig
    )


# --- Retrieval (MỚI v1.2: retry config) ---


class SourceToggleConfig(BaseModel):
    crossref: bool = True
    openalex: bool = True
    dblp: bool = True
    arxiv: bool = True
    openlibrary: bool = True
    europepmc: bool = True
    datacite: bool = True
    doi_ra: bool = True
    doaj: bool = True
    openaire_hal: bool = True
    ncbi_biorxiv: bool = True
    huggingface: bool = True
    tech_standard: bool = True
    wikidata_opencitations: bool = True
    wayback_fallback: bool = True
    serpapi: bool = True  # Fallback khi các API free gặp lỗi mạng/timeout
    serpapi_quota_guard: bool = True  # Chặn đốt quota SerpAPI khi >=3 API free trả về HTTP 200 rỗng
    semantic_scholar: bool = False  # Replaced by DBLP/arXiv/OpenLibrary/EuropePMC
    coreapi: bool = False  # Replaced by DBLP/arXiv/OpenLibrary/EuropePMC


class RateLimitsConfig(BaseModel):
    # Crossref: moderate with polite pool (10 req/s)
    crossref_per_sec: float = 10.0
    # OpenAlex: high with polite pool (50 req/s)
    openalex_per_sec: float = 50.0
    # DBLP: CS/AI publication API (3 req/s polite rate)
    dblp_per_sec: float = 3.0
    # arXiv: preprint Atom API (2 req/s polite rate)
    arxiv_per_sec: float = 2.0
    # OpenLibrary / Google Books: book & textbook API (3 req/s)
    openlibrary_per_sec: float = 3.0
    # Europe PMC / PubMed: biomedical & psychology API (5 req/s)
    europepmc_per_sec: float = 5.0
    # DataCite: DOI & dataset/preprint metadata API (5 req/s)
    datacite_per_sec: float = 5.0
    # DOI Registration Agency & CSL-JSON negotiation (10 req/s)
    doi_ra_per_sec: float = 10.0
    # DOAJ: Open Access Journals API (2 req/s)
    doaj_per_sec: float = 2.0
    # OpenAIRE + HAL Open Science API (3 req/s)
    openaire_hal_per_sec: float = 3.0
    # NCBI Entrez E-Utilities + bioRxiv/medRxiv API (3 req/s without key)
    ncbi_biorxiv_per_sec: float = 3.0
    # Hugging Face Hub Models/Datasets/Papers API (5 req/s)
    huggingface_per_sec: float = 5.0
    # IETF Datatracker RFC, PyPI, NPM & GitHub API (5 req/s)
    tech_standard_per_sec: float = 5.0
    # Wikidata Knowledge Graph & OpenCitations API (5 req/s)
    wikidata_opencitations_per_sec: float = 5.0
    # SerpApi: conservative fallback (rate limit depends on subscription)
    serpapi_per_sec: float = 1.0
    # Legacy sources (disabled by default)
    semantic_scholar_per_sec: float = 1.0
    coreapi_per_sec: float = 0.5


class RetryBackoffConfig(BaseModel):
    """Exponential backoff config for retry logic.

    Defaults tuned for rate-limit recovery:
    - initial_seconds: Start at 5s (more aggressive than old 1s)
    - max_seconds: Cap at 60s (old: 10s) for sustained rate limits
    - multiplier: 2x per attempt
    """

    initial_seconds: float = 1.0
    max_seconds: float = 120.0  # FIX: Increased from 60 to 120 for sustained rate limits
    multiplier: float = 1.5


class RetryConfig(BaseModel):
    """Tenacity retry + exponential backoff — MỚI v1.2."""

    enabled: bool = True
    max_attempts: int = 5  # FIX: Increased from 3 to 5 for better resilience
    backoff: RetryBackoffConfig = Field(default_factory=RetryBackoffConfig)  # FIX: Was missing, now explicit


class RetrievalConfig(BaseModel):
    sources: SourceToggleConfig = Field(default_factory=SourceToggleConfig)
    per_source_top_k: int = 5
    parallel: bool = True
    retry: RetryConfig = Field(default_factory=RetryConfig)   # MỚI v1.2
    rate_limits: RateLimitsConfig = Field(default_factory=RateLimitsConfig)
    contact_email: str = "noreply@citra.edu.vn"


# --- Matching (giữ nguyên v1.1, sẽ tinh chỉnh ở tuần 10–11) ---


class FuzzyConfig(BaseModel):
    token_set_ratio_threshold: float = 0.85
    partial_ratio_threshold: float = 0.80


class MatchingConfig(BaseModel):
    title_sim_verified: float = 0.9
    title_sim_metadata_error: float = 0.6
    author_jaccard_verified: float = 0.5
    year_tolerance: int = 1
    embedding_model: str = "sentence-transformers/all-MiniLM-L6-v2"
    multilingual_embedding_model: str = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
    enable_multilingual_encoder: bool = False
    cross_lingual_sim_boost: float = 0.08
    fuzzy: FuzzyConfig = Field(default_factory=FuzzyConfig)


# --- Logic (MỚI v1.2: new_rules) ---


class NewRulesConfig(BaseModel):
    """Rule IDs mới v1.2 — bổ sung ở tuần 12–13."""

    domain_exception_broken_link: bool = True
    ambiguous_mapping: bool = True
    style_inconsistent_override: bool = False   # không tự sửa; hỏi giảng viên


class LogicConfig(BaseModel):
    abstention_low: float = 0.4
    abstention_high: float = 0.6
    require_consensus_for_verified: int = 2
    require_consensus_for_metadata_error: int = 1
    new_rules: NewRulesConfig = Field(default_factory=NewRulesConfig)


# --- CIS (v1.2 §3.9: weights 35/25/25/10/5) ---


class CISWeightsConfig(BaseModel):
    """Trọng số CIS — v1.2 §3.9.

    Tổng PHẢI = 1.0 (±0.01). Validate qua root model_validator.
    Hai component in_text_bib_consistency + format_consistency
    KHÔNG được là stub — phải tính từ linker + style detector.
    """

    verified_ratio: float = 0.35
    metadata_accuracy: float = 0.25
    in_text_bib_consistency: float = 0.25
    format_consistency: float = 0.10
    identifier_validity: float = 0.05


class RubricPenaltyConfig(BaseModel):
    """Trọng số phạt cho in_text_bib_consistency — v1.2 §3.9."""

    MISSING_REFERENCE: float = 0.20
    UNCITED_REFERENCE: float = 0.10
    IN_TEXT_MISMATCH: float = 0.15
    DUPLICATE_REFERENCE: float = 0.10
    AMBIGUOUS_MAPPING: float = 0.05
    STYLE_INCONSISTENT: float = 0.02


class CISConfig(BaseModel):
    weights: CISWeightsConfig = Field(default_factory=CISWeightsConfig)
    rubric_penalty: RubricPenaltyConfig = Field(default_factory=RubricPenaltyConfig)


# --- Disclaimer & out-of-scope (v1.2) ---


class DisclaimerConfig(BaseModel):
    short: str = "Decision-support only — not a final grade."
    long: str = (
        "Hệ thống này chỉ hỗ trợ giảng viên rà soát tính toàn vẹn trích dẫn "
        "trong tiểu luận. Hai lớp kết quả (đối chiếu in-text ↔ reference entry "
        "và độ tin cậy nguồn) đều là gợi ý dựa trên bằng chứng từ các cơ sở dữ "
        "liệu học thuật công khai (Crossref, OpenAlex, Semantic Scholar, CORE) "
        "và quy luật Neuro-Symbolic có thể giải thích. Kết luận "
        "`SUSPECTED_HALLUCINATION` chỉ là suspect — không đồng nghĩa nguồn bị "
        "bịa. Giảng viên là người ra quyết định cuối cùng. Hệ thống KHÔNG tự động "
        "kết luận gian lận học thuật, KHÔNG kiểm chứng claim-level, và KHÔNG xem "
        "việc trích cùng một nguồn nhiều lần là 'dư thừa'."
    )


# Default out-of-scope items (v1.2) — được override bởi YAML nếu có
_DEFAULT_OUT_OF_SCOPE: list[str] = [
    "Grading essay content / organization / language / vocabulary / mechanics",
    "AES rubric (QWK, holistic scoring)",
    "Full-text plagiarism detection",
    "AI-generated essay prose detection",
    "Automated academic misconduct adjudication without human review",
    "Treating repeated in-text citations to the same reference as redundant",
    "OCR for scanned image-only PDFs (future extension)",
]


# ---------- Root ----------


class Settings(BaseSettings):
    """Toàn bộ config của hệ thống."""

    app: AppConfig = Field(default_factory=AppConfig)
    database: DatabaseConfig = Field(default_factory=DatabaseConfig)
    auth: AuthConfig = Field(default_factory=AuthConfig)
    email: EmailConfig = Field(default_factory=EmailConfig)
    paths: PathsConfig = Field(default_factory=PathsConfig)
    extraction: ExtractionConfig = Field(default_factory=ExtractionConfig)
    style_detection: StyleDetectionConfig = Field(default_factory=StyleDetectionConfig)
    linking: LinkingConfig = Field(default_factory=LinkingConfig)
    retrieval: RetrievalConfig = Field(default_factory=RetrievalConfig)
    matching: MatchingConfig = Field(default_factory=MatchingConfig)
    logic: LogicConfig = Field(default_factory=LogicConfig)
    cis: CISConfig = Field(default_factory=CISConfig)
    disclaimer: DisclaimerConfig = Field(default_factory=DisclaimerConfig)
    out_of_scope: list[str] = Field(default_factory=lambda: list(_DEFAULT_OUT_OF_SCOPE))

    # Env override
    contact_email: str = "noreply@citra.edu.vn"
    s2_api_key: str = ""
    serpapi_api_key: str = ""  # SerpApi API key (SERPAPI_API_KEY)
    coreapi_api_key: str = ""  # CORE API key (COREAPI_API_KEY)
    config_file: Path | None = None

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        env_prefix="",
        case_sensitive=False,
        extra="ignore",
    )

    @model_validator(mode="after")
    def _validate_weights_sum(self) -> "Settings":
        """CIS weights PHẢI tổng = 1.0 (±0.01). Raise nếu sai."""
        import os

        env_db_url = os.getenv("DATABASE_URL")
        if env_db_url:
            self.database.url = env_db_url
        env_app_env = os.getenv("APP_ENV")
        if env_app_env:
            self.app.env = env_app_env
        env_app_debug = os.getenv("APP_DEBUG")
        if env_app_debug is not None and env_app_debug.strip() != "":
            self.app.debug = env_app_debug.strip().lower() in ("1", "true", "yes", "on")
        env_log_level = os.getenv("APP_LOG_LEVEL")
        if env_log_level and env_log_level.strip():
            self.app.log_level = env_log_level.strip().upper()
        env_grobid_url = os.getenv("GROBID_URL")
        if env_grobid_url and env_grobid_url.strip():
            self.extraction.grobid.url = env_grobid_url.strip()
        if os.getenv("JWT_SECRET"):
            self.auth.jwt_secret = os.environ["JWT_SECRET"]
        if os.getenv("GOOGLE_CLIENT_ID") is not None:
            self.auth.google_client_id = os.environ["GOOGLE_CLIENT_ID"].strip()
        if os.getenv("GOOGLE_CLIENT_SECRET") is not None:
            self.auth.google_client_secret = os.environ["GOOGLE_CLIENT_SECRET"].strip()

        # Email / SMTP env overrides
        if os.getenv("SMTP_HOST"):
            self.email.smtp_host = os.environ["SMTP_HOST"]
        if os.getenv("SMTP_PORT"):
            try:
                self.email.smtp_port = int(os.environ["SMTP_PORT"])
            except ValueError:
                pass
        if os.getenv("SMTP_USER"):
            self.email.smtp_user = os.environ["SMTP_USER"]
        if os.getenv("SMTP_PASSWORD"):
            self.email.smtp_password = os.environ["SMTP_PASSWORD"]
        if os.getenv("SMTP_FROM_EMAIL"):
            self.email.from_email = os.environ["SMTP_FROM_EMAIL"]
        elif os.getenv("SMTP_USER"):
            self.email.from_email = os.environ["SMTP_USER"]
        if os.getenv("SMTP_FROM_NAME"):
            self.email.from_name = os.environ["SMTP_FROM_NAME"]
        if os.getenv("FRONTEND_URL"):
            self.email.frontend_url = os.environ["FRONTEND_URL"].rstrip("/")

        # Retrieval / API keys env overrides
        if os.getenv("CONTACT_EMAIL"):
            self.contact_email = os.environ["CONTACT_EMAIL"]
            self.retrieval.contact_email = os.environ["CONTACT_EMAIL"]
        elif self.contact_email and self.contact_email != "noreply@citra.edu.vn":
            self.retrieval.contact_email = self.contact_email
        if os.getenv("S2_API_KEY"):
            self.s2_api_key = os.environ["S2_API_KEY"]
        if os.getenv("SERPAPI_API_KEY"):
            self.serpapi_api_key = os.environ["SERPAPI_API_KEY"]
        if os.getenv("COREAPI_API_KEY"):
            self.coreapi_api_key = os.environ["COREAPI_API_KEY"]

        is_explicit_prod = self.app.env.strip().lower() in ("production", "prod", "live")
        if is_test_runtime():
            if not is_explicit_prod:
                self.app.env = "test"
            if not env_db_url or is_main_app_db_url(self.database.url):
                self.database.url = "sqlite:///:memory:"
        elif is_main_app_db_url(self.database.url):
            self.database.url = f"sqlite:///{MAIN_APP_DB_PATH.as_posix()}"

        # Validate JWT secret against the effective environment (including YAML app.env + JWT_SECRET env)
        self.auth.validate_for_env(self.app.env)

        w = self.cis.weights
        s = (
            w.verified_ratio
            + w.metadata_accuracy
            + w.in_text_bib_consistency
            + w.format_consistency
            + w.identifier_validity
        )
        if abs(s - 1.0) >= 0.01:
            raise ValueError(
                f"CIS weights must sum to 1.0 (±0.01), got {s:.4f}. "
                f"Current: {w.model_dump()}"
            )
        return self

    def weights_sum_ok(self) -> bool:
        """Kiểm tra tổng CIS weights = 1.0 (±0.01)."""
        w = self.cis.weights
        s = (
            w.verified_ratio
            + w.metadata_accuracy
            + w.in_text_bib_consistency
            + w.format_consistency
            + w.identifier_validity
        )
        return abs(s - 1.0) < 0.01


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Lazy singleton — load .env + YAML nếu có, merge với env."""
    # Load .env file first
    from dotenv import load_dotenv
    # Respect process-level overrides (pytest, Docker, CI) over the local
    # developer .env file.  The previous ``override=True`` made APP_ENV=test
    # ineffective and accidentally enabled production report/local-db caches
    # during tests.
    env_path = Path(".env") if Path(".env").exists() else (PROJECT_ROOT / ".env")
    load_dotenv(env_path, override=False)

    config_file = Path("configs/config.yaml")
    if not config_file.exists():
        config_file = PROJECT_ROOT / "configs/config.yaml"
    if not config_file.exists():
        config_file = Path("configs/config.example.yaml")
    if not config_file.exists():
        config_file = PROJECT_ROOT / "configs/config.example.yaml"

    yaml_data: dict[str, Any] = {}
    if config_file.exists():
        with config_file.open("r", encoding="utf-8") as f:
            yaml_data = yaml.safe_load(f) or {}

    # YAML `out_of_scope` là list[str] trực tiếp — không cần normalize
    return Settings(config_file=config_file, **yaml_data)
