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
            "Up to 5 MB & 15 pages per manuscript",
            "Up to 30 citations verified per document",
            "Layer 1 In-text <-> Bibliography Linking",
            "Core Scholarly DBs (Local 127K, Crossref, OpenAlex)",
            "Vietnamese Legal Statute & Regulatory Registry Check",
            "Overall CIS Integrity Score & Verdict Table",
            "7-day verification history retention",
        ),
        features_vi=(
            "3 lượt tải & kiểm tra PDF / Word (.docx) mỗi tháng",
            "Tối đa 5 MB & 15 trang mỗi tài liệu",
            "Kiểm chứng tối đa 30 trích dẫn / bài",
            "Layer 1: Đối chiếu trích dẫn trong bài & Danh mục",
            "Cơ sở dữ liệu cốt lõi (Local 127K, Crossref, OpenAlex)",
            "Kiểm định Văn bản Quy phạm Pháp luật Việt Nam",
            "Điểm toàn vẹn CIS tổng quát & Bảng kết luận",
            "Lưu trữ lịch sử kiểm tra 7 ngày",
        ),
        limitations_en=(
            "No PDF, Word (DOCX), CSV, BibTeX, or RIS export",
            "No Document Inspector, Logic Trace, or Evidence Graph",
            "No 1-Click Bibliography Auto-Remediation Studio",
            "No multi-file Batch Upload",
        ),
        limitations_vi=(
            "Không hỗ trợ xuất báo cáo PDF, Word (DOCX), CSV, BibTeX, RIS",
            "Khóa Document Inspector, Logic Trace & Đồ thị bằng chứng",
            "Khóa Studio 1-Click Tự động Sửa lỗi & Chuẩn hóa Tài liệu Tham khảo",
            "Không hỗ trợ tải lên hàng loạt (Batch Upload)",
        ),
    ),
    "pro": PlanPolicy(
        tier="pro",
        name="Pro",
        tagline_en="Full neuro-symbolic verification for thesis writers, researchers & lecturers.",
        tagline_vi="Kiểm chứng Neuro-Symbolic toàn diện cho luận văn, nghiên cứu sinh & giảng viên.",
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
            "Up to 25 MB & 100 pages per thesis/manuscript",
            "Up to 200 citations verified per document",
            "15+ Scholarly & Technical APIs (Crossref, OpenAlex, DataCite, DOAJ, OpenAIRE/HAL, NCBI/bioRxiv, arXiv, DBLP, Books, Hugging Face, IETF RFC)",
            "Retraction Watch Alerting & Wayback Machine Link-Rot Recovery",
            "1-Click Bibliography Auto-Fix Studio (APA, IEEE, TDTU, BibTeX, RIS)",
            "Interactive Citation Network & Neuro-Symbolic Evidence DAG Graph",
            "Split-Pane PDF Page Preview with Bounding-Box Highlighting",
            "Deep Neural Sentence-BERT Evidence & Bilingual VN <-> EN Bridge",
            "Export academic reports in PDF, DOCX (Word), CSV & JSON",
            "Batch upload up to 10 PDF/DOCX manuscripts concurrently",
            "1-year verification history retention",
        ),
        features_vi=(
            "50 lượt tải & kiểm tra PDF / Word (.docx) mỗi tháng",
            "Tối đa 25 MB & 100 trang mỗi luận văn / bài báo",
            "Kiểm chứng tới 200 trích dẫn / tài liệu",
            "Hơn 15 nguồn Học thuật & Kỹ thuật (Crossref, OpenAlex, DataCite, DOAJ, OpenAIRE/HAL, NCBI/bioRxiv, arXiv, DBLP, Books, Hugging Face, IETF RFC)",
            "Cảnh báo bài báo bị rút (Retraction Watch) & Khôi phục link Wayback Machine",
            "1-Click Auto-Fix Studio (Chuẩn hóa APA, IEEE, TDTU, BibTeX .bib, RIS)",
            "Đồ thị Mạng lưới Trích dẫn & Cây suy diễn Bằng chứng tương tác",
            "Document Inspector kèm Xem trước trang PDF & Highlight tọa độ",
            "Deep Neural Sentence-BERT & Cầu nối ngữ nghĩa Việt ↔ Anh",
            "Xuất báo cáo chuẩn hội đồng ra PDF, DOCX (Word), CSV, JSON",
            "Tải lên hàng loạt (Batch Check) tối đa 10 file PDF/DOCX / lần",
            "Lưu trữ lịch sử kiểm tra 1 năm",
        ),
        limitations_en=(),
        limitations_vi=(),
    ),
    "ultra": PlanPolicy(
        tier="ultra",
        name="Ultra",
        tagline_en="Unlimited institutional scale for research labs, faculties & doctoral boards.",
        tagline_vi="Quy mô không giới hạn cho Phòng thí nghiệm (Labs), Bộ môn & Hội đồng chấm luận án.",
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
            "Unlimited monthly checks (Fair-use: 1,000 manuscripts/mo)",
            "Up to 100 MB & 500 pages (Doctoral dissertations & books)",
            "Unlimited citations verified per manuscript",
            "Everything in Pro + SerpAPI Google Scholar Fallback",
            "Real-time Active DOI & URL Reachability Validator",
            "High-throughput Batch Upload (up to 50 PDFs at once)",
            "Unlimited Classroom Cohorts, Student Seats & Verdict Overrides",
            "Full Class ZIP & Aggregated CSV Gradebook Export",
            "Unlimited lifetime archive & 24/7 priority compute queue",
        ),
        features_vi=(
            "Không giới hạn lượt kiểm tra (Fair-use: 1.000 tài liệu/tháng)",
            "Tối đa 100 MB & 500 trang (Luận án Tiến sĩ & Sách chuyên khảo)",
            "Không giới hạn số lượng trích dẫn trong mỗi tài liệu",
            "Toàn bộ quyền lợi gói Pro + SerpAPI Google Scholar Fallback",
            "Kiểm tra sống/chết đường dẫn DOI & URL thời gian thực",
            "Batch Upload công suất lớn (tối đa 50 PDF cùng lúc)",
            "Không giới hạn Lớp học, Sinh viên & Quyền Override Verdict",
            "Xuất báo cáo tổng hợp cả lớp (Class ZIP & CSV Bảng điểm)",
            "Lưu trữ lịch sử vĩnh viễn & Luồng xử lý ưu tiên cao nhất",
        ),
        limitations_en=(),
        limitations_vi=(),
    ),
}


def default_plan_for_role(role: str | None) -> PlanTierLiteral:
    """Return the default subscription tier when a user is created."""
    if role == "admin":
        return "ultra"
    if role == "teacher":
        return "pro"
    return "basic"


def get_plan_policy(tier: str | None) -> PlanPolicy:
    """Lookup PlanPolicy by tier name, falling back to ``basic``."""
    normalized = (tier or "basic").strip().lower()
    return PLAN_CATALOG.get(normalized, PLAN_CATALOG["basic"])


def get_user_plan_policy(user: Any) -> PlanPolicy:
    """Return the effective PlanPolicy for a User ORM instance."""
    if user is None:
        return PLAN_CATALOG["basic"]
    role = getattr(user, "role", "user")
    if role == "admin":
        return PLAN_CATALOG["ultra"]
    raw_tier = getattr(user, "plan_tier", None)
    if not raw_tier:
        raw_tier = default_plan_for_role(role)
    return get_plan_policy(raw_tier)


def _ensure_utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt


def ensure_user_quota_current(user: Any) -> bool:
    """Lazy-reset monthly upload counter if quota window has elapsed.

    Also handles automatic downgrade to ``basic`` if a canceled subscription's
    billing period has ended.
    Returns True if any field on ``user`` was mutated.
    """
    now = datetime.now(UTC)
    mutated = False

    # Ensure plan_tier is populated
    if not getattr(user, "plan_tier", None):
        user.plan_tier = default_plan_for_role(getattr(user, "role", "user"))
        mutated = True

    # Check if paid subscription expired after cancel_at_period_end
    period_end = _ensure_utc(getattr(user, "current_period_end", None))
    if (
        period_end is not None
        and now >= period_end
        and getattr(user, "plan_tier", "basic") != "basic"
        and bool(getattr(user, "cancel_at_period_end", 0))
    ):
        user.plan_tier = "basic"
        user.billing_cycle = None
        user.subscription_status = "canceled"
        user.cancel_at_period_end = 0
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
