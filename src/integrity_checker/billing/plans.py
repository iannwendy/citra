"""Centralized SaaS Subscription Plan Catalog & Quota Enforcement Logic.

Defines the 3 tiers for CITRA (SourceLogic):
- ``basic`` ($0/mo): Default free tier for students with strict monthly upload,
  file size, page count, and export restrictions.
- ``pro`` ($20/mo or $16/mo billed annually at $192/yr — Save 20%):
  Most popular tier for graduate researchers, thesis writers, and lecturers.
- ``ultra`` ($200/mo or $160/mo billed annually at $1,920/yr — Save 20%):
  High-volume tier for research labs, university departments, and review boards.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

PlanTierLiteral = Literal["basic", "pro", "ultra"]
BillingCycleLiteral = Literal["monthly", "annual"]

PLAN_TIERS: tuple[str, ...] = ("basic", "pro", "ultra")
BILLING_CYCLES: tuple[str, ...] = ("monthly", "annual")

TIER_RANK: dict[str, int] = {
    "basic": 0,
    "pro": 1,
    "ultra": 2,
}


@dataclass(frozen=True)
class PlanPolicy:
    """Immutable quota and capability policy for a subscription tier."""

    tier: PlanTierLiteral
    name: str
    tagline_en: str
    tagline_vi: str
    badge_en: str | None
    badge_vi: str | None
    highlighted: bool

    # Pricing (USD)
    monthly_price_usd: int
    annual_price_usd: int
    annual_monthly_equiv_usd: int
    annual_savings_usd: int
    annual_discount_pct: int

    # Hard Quotas
    max_uploads_per_month: int
    max_file_size_mb: int
    max_pages_per_pdf: int
    max_citations_per_essay: int
    max_batch_files: int
    max_classes: int
    history_retention_days: int

    # Feature Gates
    allowed_export_formats: tuple[str, ...] = field(default_factory=lambda: ("json",))
    allow_batch_upload: bool = False
    allow_deep_inspector: bool = False
    allow_serpapi_fallback: bool = False
    priority_processing: bool = False

    # Marketing bullet points
    features_en: tuple[str, ...] = field(default_factory=tuple)
    features_vi: tuple[str, ...] = field(default_factory=tuple)
    limitations_en: tuple[str, ...] = field(default_factory=tuple)
    limitations_vi: tuple[str, ...] = field(default_factory=tuple)

    @property
    def max_file_size_bytes(self) -> int:
        return self.max_file_size_mb * 1024 * 1024

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["allowed_export_formats"] = list(self.allowed_export_formats)
        data["features_en"] = list(self.features_en)
        data["features_vi"] = list(self.features_vi)
        data["limitations_en"] = list(self.limitations_en)
        data["limitations_vi"] = list(self.limitations_vi)
        return data


PLAN_CATALOG: dict[str, PlanPolicy] = {
    "basic": PlanPolicy(
        tier="basic",
        name="Basic",
        tagline_en="Essential citation checks for individual course essays & short drafts.",
        tagline_vi="Kiểm tra trích dẫn cơ bản dành cho bài tập lớn & tiểu luận ngắn.",
        badge_en="FREE FOREVER",
        badge_vi="MIỄN PHÍ MẶC ĐỊNH",
        highlighted=False,
        monthly_price_usd=0,
        annual_price_usd=0,
        annual_monthly_equiv_usd=0,
        annual_savings_usd=0,
        annual_discount_pct=0,
        max_uploads_per_month=3,
        max_file_size_mb=5,
        max_pages_per_pdf=15,
        max_citations_per_essay=30,
        max_batch_files=1,
        max_classes=0,
        history_retention_days=7,
        allowed_export_formats=("json",),
        allow_batch_upload=False,
        allow_deep_inspector=False,
        allow_serpapi_fallback=False,
        priority_processing=False,
        features_en=(
            "3 PDF / Word (.docx) document checks per month",
            "Up to 5 MB & 15 pages per document",
            "Up to 30 citations verified per document",
            "In-text & reference list cross-checking",
            "Core academic libraries (Crossref, OpenAlex & built-in catalog)",
            "Vietnamese legal statute & regulatory verification",
            "Overall Citation Integrity Score (CIS) & summary report",
            "7-day verification history retention",
        ),
        features_vi=(
            "3 lượt tải và kiểm tra PDF / Word (.docx) mỗi tháng",
            "Tối đa 5 MB và 15 trang mỗi tài liệu",
            "Kiểm tra tối đa 30 trích dẫn / bài",
            "Đối chiếu trích dẫn trong bài với danh mục tài liệu tham khảo",
            "Tra cứu thư viện học thuật cốt lõi (Crossref, OpenAlex và thư viện tích hợp)",
            "Kiểm tra văn bản quy phạm pháp luật Việt Nam",
            "Điểm toàn vẹn trích dẫn (CIS) và bảng kết quả tổng quan",
            "Lưu trữ lịch sử kiểm tra trong 7 ngày",
        ),
        limitations_en=(
            "No PDF, Word (.docx), spreadsheet (CSV), BibTeX, or RIS export",
            "No visual page inspector or step-by-step verification breakdown",
            "No 1-Click Reference Formatter & Fix Studio",
            "No multi-file batch checking",
        ),
        limitations_vi=(
            "Không hỗ trợ xuất báo cáo PDF, Word (.docx), bảng tính (CSV), BibTeX, RIS",
            "Không có trình xem trực quan trên trang và sơ đồ giải thích từng bước",
            "Không có công cụ 1-Click tự động sửa và chuẩn hóa tài liệu tham khảo",
            "Không hỗ trợ kiểm tra nhiều tệp cùng lúc",
        ),
    ),
    "pro": PlanPolicy(
        tier="pro",
        name="Pro",
        tagline_en="Comprehensive citation verification for thesis writers, researchers & lecturers.",
        tagline_vi="Kiểm tra trích dẫn chuyên sâu cho khóa luận, luận văn, nghiên cứu sinh và giảng viên.",
        badge_en="MOST POPULAR",
        badge_vi="PHỔ BIẾN NHẤT",
        highlighted=True,
        monthly_price_usd=20,
        annual_price_usd=192,
        annual_monthly_equiv_usd=16,
        annual_savings_usd=48,
        annual_discount_pct=20,
        max_uploads_per_month=50,
        max_file_size_mb=25,
        max_pages_per_pdf=100,
        max_citations_per_essay=200,
        max_batch_files=10,
        max_classes=3,
        history_retention_days=365,
        allowed_export_formats=("json", "csv", "pdf", "docx"),
        allow_batch_upload=True,
        allow_deep_inspector=True,
        allow_serpapi_fallback=False,
        priority_processing=True,
        features_en=(
            "50 PDF & Word (.docx) document checks per month",
            "Up to 25 MB & 100 pages per thesis or paper",
            "Up to 200 citations verified per document",
            "15+ academic & technical libraries (Crossref, OpenAlex, DataCite, DOAJ, OpenAIRE/HAL, PubMed/bioRxiv, arXiv, DBLP, Open Library, Hugging Face, technical standards)",
            "Retracted paper alerts & archived web link recovery (Wayback Machine)",
            "1-Click Reference Formatter & Fix Studio (APA, IEEE, TDTU, BibTeX, RIS)",
            "Interactive Citation Map & Step-by-Step Visual Verification Breakdown",
            "Side-by-Side PDF Page Preview with In-Document Citation Highlighting",
            "Context & Claim Relevance Checking with Vietnamese ↔ English Support",
            "Export formatted reports in PDF, Word (.docx), CSV & JSON",
            "Batch check up to 10 PDF/Word documents at once",
            "1-year verification history retention",
        ),
        features_vi=(
            "50 lượt kiểm tra PDF / Word (.docx) mỗi tháng",
            "Tối đa 25 MB và 100 trang mỗi khóa luận / luận văn",
            "Kiểm tra tối đa 200 trích dẫn / tài liệu",
            "Hơn 15 thư viện học thuật và kỹ thuật (Crossref, OpenAlex, DataCite, DOAJ, OpenAIRE/HAL, PubMed/bioRxiv, arXiv, DBLP, sách, Hugging Face, tiêu chuẩn kỹ thuật)",
            "Cảnh báo bài báo đã bị rút (Retraction Watch) và khôi phục liên kết qua Wayback Machine",
            "Công cụ 1-Click tự động chuẩn hóa tài liệu tham khảo (APA, IEEE, TDTU, BibTeX, RIS)",
            "Sơ đồ trích dẫn tương tác và giải thích kết quả đối chiếu từng bước",
            "Xem trực tiếp từng trang PDF và tô sáng vị trí trích dẫn trong tài liệu",
            "Kiểm tra mức độ khớp ngữ cảnh và nội dung trích dẫn (hỗ trợ song ngữ Việt ↔ Anh)",
            "Xuất báo cáo đầy đủ định dạng PDF, Word (.docx), bảng tính (CSV) và JSON",
            "Kiểm tra hàng loạt tối đa 10 tệp PDF/Word cùng lúc",
            "Lưu trữ lịch sử kiểm tra trong 1 năm",
        ),
        limitations_en=(),
        limitations_vi=(),
    ),
    "ultra": PlanPolicy(
        tier="ultra",
        name="Ultra",
        tagline_en="High-volume institutional scale for research labs, departments & review boards.",
        tagline_vi="Quy mô lớn cho phòng thí nghiệm, bộ môn, khoa và hội đồng chấm luận án.",
        badge_en="INSTITUTION & LABS",
        badge_vi="PHÒNG LAB & HỌC THUẬT",
        highlighted=False,
        monthly_price_usd=200,
        annual_price_usd=1920,
        annual_monthly_equiv_usd=160,
        annual_savings_usd=480,
        annual_discount_pct=20,
        max_uploads_per_month=1000,
        max_file_size_mb=100,
        max_pages_per_pdf=500,
        max_citations_per_essay=2000,
        max_batch_files=50,
        max_classes=999,
        history_retention_days=36500,
        allowed_export_formats=("json", "csv", "pdf", "docx"),
        allow_batch_upload=True,
        allow_deep_inspector=True,
        allow_serpapi_fallback=True,
        priority_processing=True,
        features_en=(
            "High-volume monthly checks (Fair-use: 1,000 documents/mo)",
            "Up to 100 MB & 500 pages (Doctoral dissertations & books)",
            "Unlimited citations verified per document",
            "Everything in Pro plus extended Google Scholar lookup",
            "Real-time DOI & web link availability checks",
            "Large batch checking (up to 50 documents at once)",
            "Unlimited classes, student seats & instructor review controls",
            "Full class ZIP archive & aggregated CSV gradebook export",
            "Unlimited history archive & faster priority processing",
        ),
        features_vi=(
            "Kiểm tra khối lượng lớn mỗi tháng (hạn mức hợp lý: 1.000 tài liệu/tháng)",
            "Tối đa 100 MB và 500 trang (Luận án tiến sĩ và sách chuyên khảo)",
            "Không giới hạn số lượng trích dẫn trong mỗi tài liệu",
            "Toàn bộ tính năng gói Pro kèm tra cứu mở rộng trên Google Scholar",
            "Kiểm tra trạng thái hoạt động của mã DOI và đường dẫn web theo thời gian thực",
            "Kiểm tra hàng loạt quy mô lớn (tối đa 50 tài liệu cùng lúc)",
            "Không giới hạn lớp học, sinh viên và quyền duyệt chỉnh sửa kết quả cho giảng viên",
            "Xuất báo cáo tổng hợp cả lớp (tệp ZIP và bảng điểm CSV)",
            "Lưu trữ lịch sử không giới hạn và ưu tiên xử lý nhanh hơn",
        ),
        limitations_en=(),
        limitations_vi=(),
    ),
}


def default_plan_for_role(role: str | None) -> PlanTierLiteral:
    """Return the default subscription tier when a user is created."""
    clean_role = role if isinstance(role, str) else "user"
    if clean_role == "admin":
        return "ultra"
    if clean_role == "teacher":
        return "pro"
    return "basic"


def get_plan_policy(tier: str | None) -> PlanPolicy:
    """Lookup PlanPolicy by tier name, falling back to ``basic``."""
    normalized = tier.strip().lower() if isinstance(tier, str) and tier.strip() else "basic"
    return PLAN_CATALOG.get(normalized, PLAN_CATALOG["basic"])


def get_user_plan_policy(user: Any) -> PlanPolicy:
    """Return the effective PlanPolicy for a User ORM instance."""
    if user is None:
        return PLAN_CATALOG["basic"]
    raw_role = getattr(user, "role", "user")
    role = raw_role if isinstance(raw_role, str) else "user"
    if role == "admin":
        return PLAN_CATALOG["ultra"]
    raw_tier = getattr(user, "plan_tier", None)
    if not isinstance(raw_tier, str) or not raw_tier.strip():
        raw_tier = default_plan_for_role(role)
    period_end = _ensure_utc(getattr(user, "current_period_end", None))
    if (
        period_end is not None
        and datetime.now(UTC) >= period_end
        and raw_tier.strip().lower() != "basic"
    ):
        return PLAN_CATALOG["basic"]
    return get_plan_policy(raw_tier)


def _ensure_utc(dt: datetime | None) -> datetime | None:
    if not isinstance(dt, datetime):
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt


def ensure_user_quota_current(user: Any) -> bool:
    """Lazy-reset monthly upload counter if quota window has elapsed.

    Also handles automatic downgrade to ``basic`` once a paid subscription's
    billing period has ended (even when ``cancel_at_period_end == 0``, such as
    one-time VNPay or promo-waiver periods).
    Returns True if any field on ``user`` was mutated.
    """
    now = datetime.now(UTC)
    mutated = False
    raw_role = getattr(user, "role", "user")
    role = raw_role if isinstance(raw_role, str) else "user"

    # Ensure plan_tier is populated
    raw_tier = getattr(user, "plan_tier", None)
    if not isinstance(raw_tier, str) or not raw_tier.strip():
        user.plan_tier = default_plan_for_role(role)
        raw_tier = user.plan_tier
        mutated = True

    # Expire paid subscriptions once current_period_end has elapsed
    period_end = _ensure_utc(getattr(user, "current_period_end", None))
    if (
        period_end is not None
        and now >= period_end
        and raw_tier.strip().lower() != "basic"
        and role != "admin"
    ):
        cancel_raw = getattr(user, "cancel_at_period_end", 0)
        was_canceled = bool(cancel_raw) if isinstance(cancel_raw, (int, bool)) else False
        user.plan_tier = "basic"
        user.billing_cycle = None
        user.subscription_status = "canceled" if was_canceled else "expired"
        user.cancel_at_period_end = 0
        user.current_period_end = None
        user.stripe_subscription_id = None
        mutated = True

    reset_at = _ensure_utc(getattr(user, "quota_reset_at", None))
    if reset_at is None or now >= reset_at:
        user.monthly_uploads_used = 0
        user.quota_reset_at = now + timedelta(days=30)
        mutated = True

    return mutated


def get_user_subscription_summary(user: Any) -> dict[str, Any]:
    """Serialize subscription & quota details for API responses (/auth/me, /users/me, /billing)."""
    policy = get_user_plan_policy(user)
    used = int(getattr(user, "monthly_uploads_used", 0) or 0)
    limit = policy.max_uploads_per_month
    remaining = max(0, limit - used)

    reset_at = _ensure_utc(getattr(user, "quota_reset_at", None))
    if reset_at is None:
        reset_at = datetime.now(UTC) + timedelta(days=30)

    period_start = _ensure_utc(getattr(user, "current_period_start", None))
    period_end = _ensure_utc(getattr(user, "current_period_end", None))

    return {
        "plan_tier": policy.tier,
        "plan_name": policy.name,
        "billing_cycle": getattr(user, "billing_cycle", None),
        "subscription_status": getattr(user, "subscription_status", None) or "active",
        "cancel_at_period_end": bool(getattr(user, "cancel_at_period_end", 0)),
        "current_period_start": period_start.isoformat() if period_start else None,
        "current_period_end": period_end.isoformat() if period_end else None,
        "quota": {
            "monthly_uploads_used": used,
            "monthly_uploads_limit": limit,
            "monthly_uploads_remaining": remaining,
            "max_file_size_mb": policy.max_file_size_mb,
            "max_pages_per_pdf": policy.max_pages_per_pdf,
            "max_citations_per_essay": policy.max_citations_per_essay,
            "max_batch_files": policy.max_batch_files,
            "allowed_export_formats": list(policy.allowed_export_formats),
            "allow_batch_upload": policy.allow_batch_upload,
            "allow_deep_inspector": policy.allow_deep_inspector,
            "allow_serpapi_fallback": policy.allow_serpapi_fallback,
            "quota_reset_at": reset_at.isoformat(),
        },
    }


def get_plan_catalog_list() -> list[dict[str, Any]]:
    """Return ordered list of all plans (basic, pro, ultra) as dicts."""
    return [PLAN_CATALOG[k].to_dict() for k in PLAN_TIERS]
