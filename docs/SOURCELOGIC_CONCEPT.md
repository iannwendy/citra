# SourceLogic — Academic Source Verification, Refined.

> **Brand Identity · Design System · Academic Verification UX/UI · Neuro-Symbolic Architecture**  
> **Concept:** SourceLogic Scholarly — Explainable Precision Minimal  
> **Tagline:** Verify every citation. Trace every source.  
> **Brand promise:** Explainable evidence. Effortless academic verification.

## Mục tiêu dự án

Xây dựng **SourceLogic** (giao diện sản phẩm của **Essay Integrity Checker**) thành một không gian làm việc kiểm chứng trích dẫn học thuật (**Academic Source Verification Workspace**) hiện đại, minh bạch và phân cấp rõ ràng theo 3 vai trò (**Student / Teacher / Admin**), sử dụng nền tảng **shadcn/ui + Tailwind CSS + Radix UI**.

Ba mục tiêu cốt lõi:

1. **Scholarly Precision Minimal:** Giao diện sáng/tối chuẩn học thuật, typography phân tách rõ giữa UI điều khiển (**Inter**), nội dung học thuật (**Source Serif 4**) và dữ liệu kỹ thuật/mã trích dẫn (**JetBrains Mono**).
2. **Explainable Debugger UX:** Mô hình hóa quy trình kiểm tra như một **“IDE / Debugger cho trích dẫn”** — đi từ tài liệu gốc → trích xuất citation/reference → liên kết hai chiều → truy hồi nguồn học thuật → suy diễn Neuro-Symbolic → giải thích bằng chứng.
3. **Academic & Thesis Compliance:** Tuân thủ nghiêm ngặt định hướng **Decision-Support Tool** của đồ án tốt nghiệp: chỉ đánh giá tính toàn vẹn trích dẫn (**Citation Integrity**), tuyệt đối không tự động kết luận gian lận học thuật và không chấm điểm văn phong/ngữ pháp toàn bài.

> **Nguyên tắc ưu tiên:** Tài liệu đặc tả đồ án (**CLAUDE.md**, **README.md**, **docs/TEACHER_SYSTEM.md**) là nguồn yêu cầu nghiệp vụ bắt buộc. Tài liệu concept này định hướng thương hiệu, hệ thống thiết kế **shadcn/ui**, trải nghiệm UX/UI theo role và kiến trúc frontend/backend. Nếu có xung đột, luôn ưu tiên logic nghiệp vụ của đồ án gốc.
>
> Mọi quyết định của hệ thống phải kèm theo **Decision-Support Disclaimer** và khả năng truy ngược về **evidence (nguồn đối chiếu)** cùng **symbolic rule (luật suy diễn)**; giảng viên và hội đồng là người đưa ra kết luận cuối cùng.

---

# 1. Brand Identity

## 1.1. Brand foundation

| Thành phần | Giá trị |
|---|---|
| Brand name | SourceLogic |
| System / Repository name | Essay Integrity Checker |
| Student / Researcher interface | SourceLogic Workspace |
| Teacher interface | SourceLogic Classroom |
| Admin interface | SourceLogic Control |
| Primary logo | `[1] → ✓` icon + `SourceLogic` wordmark |
| Tagline | Verify every citation. Trace every source. |
| Brand promise | Explainable evidence. Effortless academic verification. |
| Brand personality | Scholarly, Objective, Transparent, Precise, Trustworthy |
| Positioning | Academic Source Verification Workspace / Citation Debugger |
| Visual direction | Scholarly Minimal, High-Clarity Data UI, Dual-Theme (Slate + Indigo) |
| Alternative headlines | Academic sources, verified. / Evidence before judgment. |
| Supporting copy | Detect invalid, mismatched, and potentially hallucinated academic references with explainable neuro-symbolic verification. |

SourceLogic **không** mang cảm giác của một công cụ AI đại trà (tránh icon robot, tia sáng lấp lánh, gradient tím-hồng sặc sỡ) và **không** mang cảm giác một phần mềm chấm điểm bài văn (Essay Grader). Thương hiệu tập trung vào tính khách quan khoa học, độ chính xác của metadata, khả năng giải thích từng bước suy luận (traceability) và hỗ trợ ra quyết định cho giảng viên.

## 1.2. Logo

- **Biểu tượng chính (Symbol):** Cặp dấu ngoặc vuông trích dẫn `[1]` nối bằng mũi tên liên kết `→` tới dấu kiểm xác thực `✓`, đặt trên nền bo góc `rounded-xl` màu Indigo `#4F46E5`.
- **Wordmark:** **`SourceLogic`** đặt bằng font serif học thuật (`Source Serif 4` Bold), đi kèm nhãn phụ `Academic Verification`.
- **Phiên bản sáng (Light mode):** Icon nền `#4F46E5` chữ `#FFFFFF`; wordmark `#0F172A` trên nền `#FFFFFF` hoặc `#F8FAFC`.
- **Phiên bản tối (Dark mode):** Icon nền `#6366F1` chữ `#FFFFFF`; wordmark `#F8FAFC` trên nền `#0F172A` hoặc `#020617`.
- Không dùng hiệu ứng neon,3D hoặc biểu tượng bộ não/robot AI.

```text
  ┌───────────────┐
  │  [1] ──→ ✓    │   SourceLogic
  └───────────────┘   Academic Verification
```

## 1.3. Brand voice và microcopy

| Ngữ cảnh | Nội dung (EN / VI) |
|---|---|
| Landing hero | **Verify Every Citation. Trace Every Source.** / Kiểm chứng mọi trích dẫn. Truy vết mọi nguồn học thuật. |
| Hero description | Detect invalid, mismatched, and potentially hallucinated academic references with explainable source verification. |
| New verification (`/upload`) | **New Verification.** Drop your PDF manuscript to extract and verify citations. |
| Batch upload (`/batch-upload`) | **Batch & Class Verification.** Queue multiple submissions for sequential analysis. |
| Processing (`/verification/processing/:id`) | **Analyzing document.** Tracing in-text citations, bibliography entries, and academic databases. |
| Report overview (`/verification/report/:id`) | **Source Verification Report.** Evidence-based citation integrity analysis. |
| Reference inspector (Drawer) | **Reference Inspector.** Side-by-side comparison between cited text and retrieved metadata. |
| Logic trace (`/trace`) | **Neuro-Symbolic Verification Trace.** Step-by-step from raw citation to symbolic rule evaluation. |
| Orphan detection (`/consistency`) | **Citation ↔ Reference Consistency.** Unlinked in-text citations and uncited bibliography entries. |
| Teacher classroom (`/teacher/classes`) | **My Classes.** Monitor cohort submissions and review flagged citations. |
| Mandatory disclaimer | **Decision-Support Tool:** Results assist academic review and do not automatically conclude academic misconduct. |

**Tone of voice:** Khách quan, chuẩn mực học thuật, giải thích rõ nguyên nhân, không phán xét cá nhân.
- Dùng thuật ngữ thận trọng: dùng *“Suspected Hallucination / Nghi ngờ bịa đặt”* thay vì *“Gian lận / Đạo văn”*; dùng *“Metadata Error / Lệch thông tin mô tả”* thay vì *“Sai hoàn toàn”*.
- Hỗ trợ song ngữ **Việt – Anh (`react-i18next`)** xuyên suốt toàn bộ giao diện, chuyển đổi tức thời không cần tải lại trang (`window.location.reload()` bị cấm).

---

# 2. Design System — SourceLogic UI (shadcn/ui)

## 2.1. Color palette

Hệ màu được thiết kế dựa trên CSS Variables (`HSL`) tương thích trực tiếp với **shadcn/ui** (`baseColor: "slate"`, `cssVariables: true`), hỗ trợ đầy đủ **Light Mode** và **Dark Mode**.

### Core UI Tokens

| Token | CSS Variable | Light Hex | Dark Hex | Sử dụng |
|---|---|---|---|---|
| Canvas / Background | `--background` | `#F8FAFC` (Slate 50) | `#020617` (Slate 950) | Nền tổng thể của workspace |
| Surface / Card | `--card` | `#FFFFFF` (White) | `#0F172A` (Slate 900) | Card, bảng dữ liệu, drawer, dialog |
| Ink / Foreground | `--foreground` | `#0F172A` (Slate 900) | `#F8FAFC` (Slate 50) | Chữ chính, tiêu đề |
| Muted Surface | `--muted` | `#F1F5F9` (Slate 100) | `#1E293B` (Slate 800) | Nền phụ, header bảng, skeleton |
| Secondary Text | `--muted-foreground` | `#475569` (Slate 600) | `#94A3B8` (Slate 400) | Chữ phụ, chú thích (đảm bảo contrast ≥ 4.5:1) |
| Primary Brand | `--primary` | `#4F46E5` (Indigo 600) | `#6366F1` (Indigo 500) | Primary CTA, active nav, focus ring |
| Border / Divider | `--border` | `#E2E8F0` (Slate 200) | `#1E293B` (Slate 800) | Đường viền card, table, input |

### Semantic Verdict Tokens (Lớp 2 — Source Verification)

| Verdict Label | Token | Hex | Badge Style (Light) | Ý nghĩa nghiệp vụ |
|---|---|---|---|---|
| `VERIFIED` | `--verdict-verified` | `#10B981` (Emerald) | Nền `#ECFDF5`, chữ `#047857`, viền `#A7F3D0` | Nguồn xác minh thành công, metadata khớp |
| `METADATA_ERROR` | `--verdict-metadata-error` | `#F59E0B` (Amber) | Nền `#FFFBEB`, chữ `#B45309`, viền `#FDE68A` | Nguồn tồn tại nhưng sai năm/tác giả/venue/title |
| `SUSPECTED_HALLUCINATION` | `--verdict-suspected` | `#EF4444` (Red) | Nền `#FEF2F2`, chữ `#B91C1C`, viền `#FECACA` | Không tìm thấy nguồn khớp trên mọi CSDL |
| `UNRESOLVED` | `--verdict-unresolved` | `#64748B` (Slate) | Nền `#F1F5F9`, chữ `#475569`, viền `#CBD5E1` | Không đủ bằng chứng để kết luận |
| `RESOURCE` | `--verdict-resource` | `#8B5CF6` (Violet) | Nền `#F5F3FF`, chữ `#6D28D9`, viền `#DDD6FE` | Liên kết URL/GitHub/Web (tách khỏi thống kê bài báo) |

### Mapping Status Tokens (Lớp 1 — Citation ↔ Reference Linking)

| Mapping Status | Token | Hex | Ý nghĩa |
|---|---|---|---|
| `MATCHED` | `--mapping-matched` | `#10B981` | In-text liên kết thành công với Reference |
| `MISSING_REFERENCE` | `--mapping-missing` | `#EF4444` | Trích dẫn trong bài không có trong danh mục tham khảo |
| `UNCITED_REFERENCE` | `--mapping-uncited` | `#F59E0B` | Tài liệu tham khảo không được trích dẫn trong bài |
| `IN_TEXT_MISMATCH` | `--mapping-mismatch` | `#F97316` | Liên kết được nhưng thông tin in-text và reference lệch nhau |
| `DUPLICATE_REFERENCE` | `--mapping-duplicate` | `#9333EA` | Hai mục tài liệu tham khảo trùng lặp |
| `AMBIGUOUS_MAPPING` | `--mapping-ambiguous` | `#8B5CF6` | Nhiều ứng viên tham khảo cùng khớp một trích dẫn |
| `STYLE_INCONSISTENT` | `--mapping-style` | `#0EA5E9` | Sai quy chuẩn định dạng (APA, IEEE, Vancouver...) |

### Role Identity Tokens

| Role | Token | Light Hex | Dark Hex | Ý nghĩa |
|---|---|---|---|---|
| `user` (Student) | `--role-user` | `#3B82F6` (Blue) | `#60A5FA` | Sinh viên / Người nộp bài |
| `teacher` (Instructor) | `--role-teacher` | `#16A34A` (Green) | `#4ADE80` | Giảng viên hướng dẫn / Phản biện |
| `admin` (Administrator) | `--role-admin` | `#A855F7` (Purple) | `#C084FC` | Quản trị viên hệ thống |

**Quy tắc phân bổ màu sắc:**
- **80%** nền trung tính (`#F8FAFC` / `#FFFFFF` ở Light mode; `#020617` / `#0F172A` ở Dark mode).
- **15%** chữ, cấu trúc bảng, đường viền và điều hướng (`Slate` + `Indigo`).
- **5%** màu ngữ nghĩa (`Emerald`, `Amber`, `Red`, `Violet`) **chỉ dành riêng cho trạng thái kiểm chứng** — tuyệt đối không dùng màu đỏ/vàng làm màu trang trí để tránh gây nhầm lẫn với cảnh báo lỗi trích dẫn.

## 2.2. Typography

- **Headings & Document Reader (`font-display`):** `Source Serif 4` (Georgia, serif) — tạo chiều sâu học thuật cho tiêu đề trang và vùng đọc văn bản bài báo.
- **UI Body & Controls (`font-sans`):** `Inter` (system-ui, sans-serif) — tối ưu độ rõ nét cho bảng dữ liệu, form, filter và điều hướng.
- **Technical Metadata & Citations (`font-mono`):** `JetBrains Mono` / `Fira Code` — dùng cho chỉ số trích dẫn `[1]`, `[24]`, mã `DOI`, `arXiv ID`, mã luật `R01–R12`, điểm tương đồng (`0.94`).

| Token | Desktop | Mobile | Line Height | Font Family |
|---|---|---|---|---|
| Display (Landing Hero) | 48–60px | 34–40px | 1.1 | `Source Serif 4` Bold |
| H1 (Page Title) | 30–36px | 24–28px | 1.2 | `Source Serif 4` Bold |
| H2 (Section Title) | 20–24px | 18–20px | 1.25 | `Source Serif 4` SemiBold |
| H3 (Card / Panel Title) | 16–18px | 16px | 1.35 | `Inter` SemiBold |
| Body | 14–16px | 14–16px | 1.65 | `Inter` Regular |
| Table / Compact UI | 13–14px | 13px | 1.5 | `Inter` Medium |
| Mono / Citation Tag | 12–13px | 12px | 1.4 | `JetBrains Mono` |

## 2.3. Spacing và layout tokens

| Token | Giá trị | Ghi chú |
|---|---|---|
| Spacing scale | `4 / 8 / 12 / 16 / 24 / 32 / 48 / 64px` | Chuẩn Tailwind (`p-1` → `p-16`) |
| Workspace max-width | `1152px` (`max-w-6xl`) | Vùng nội dung chính bên phải sidebar |
| Sidebar width | `288px` (`w-72`) | Cố định trên desktop (`lg:static`), Sheet drawer trên mobile |
| Detail Drawer width | `512px` (`max-w-lg`) | Slide-over bên phải khi inspect một citation/reference |
| Touch target minimum | `44 × 44px` (`min-h-11 min-w-11`) | Bắt buộc cho mọi nút icon và điều khiển trên mobile (WCAG 2.1) |
| Card radius | `12–16px` (`rounded-xl` / `rounded-2xl`) | Đồng bộ `--radius: 0.75rem` trong `shadcn/ui` |
| Badge differentiation | `rounded-full` (Verdict) vs `rounded-md` (Mapping) | Giúp phân biệt tức thì Lớp 2 (Nguồn) và Lớp 1 (Liên kết) |

## 2.4. Component library (shadcn/ui Foundation)

Toàn bộ giao diện sử dụng các primitive chuẩn của **shadcn/ui** (`web/src/components/ui/`) kết hợp với các domain component chuyên biệt của SourceLogic:

1. **shadcn/ui Primitives (`components/ui/`):**
   - `Button`, `Input`, `Textarea`, `Label`, `Select`, `Checkbox`, `Switch`, `Badge`
   - `Card` (`CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter`)
   - `Table` (`TableHeader`, `TableBody`, `TableRow`, `TableHead`, `TableCell`)
   - `Tabs` (`TabsList`, `TabsTrigger`, `TabsContent`)
   - `Dialog`, `AlertDialog`, `Sheet` (cho Reference Inspector Drawer & Mobile Sidebar)
   - `DropdownMenu`, `Tooltip`, `Popover`, `Progress`, `Skeleton`, `Separator`, `ScrollArea`, `Alert`
2. **SourceLogic Domain Components (`components/`):**
   - `DecisionSupportDisclaimer`: Banner/thông báo bắt buộc khẳng định vai trò hỗ trợ quyết định.
   - `VerdictBadge` & `MappingStatusBadge`: Hiển thị nhãn kiểm chứng 2 lớp kèm icon SVG (không dùng emoji thô).
   - `CISScoreCard` & `StyleProfileCard`: Hiển thị điểm toàn vẹn trích dẫn (0–100) và hồ sơ định dạng (APA/IEEE/Vancouver...).
   - `VerdictTable`: Bảng kết quả kiểm chứng có filter chips (`aria-pressed`), tìm kiếm toàn văn và phân trang.
   - `CitationDetailDrawer` + `MetadataDiff` + `SourceRetrievalUI` + `OverrideControls`: Ngăn kéo kiểm tra chi tiết từng trích dẫn.
   - `CitationGraphView` + `CitationGraphControls` + `EvidenceGraphNode`: Đồ thị bằng chứng và liên kết trích dẫn.
   - `RuleInspector` & `DocumentInspector` & `OrphanDetection`: Bộ công cụ chẩn đoán chuyên sâu cho giảng viên/admin.
   - `RoleGate` & `RoleBadge`: Kiểm soát hiển thị và nhận diện phân quyền (`user` / `teacher` / `admin`).

## 2.5. Motion system

| Tương tác | Thời gian | Hiệu ứng |
|---|---|---|
| Button / Row hover | `150ms` | Chuyển màu nền mượt (`cubic-bezier(0.4, 0, 0.2, 1)`) |
| Card interactive hover | `200ms` | Nâng nhẹ shadow (`shadow-sm` → `shadow-md`) + viền `primary/30` |
| Reference Inspector (`Sheet`) | `300ms` | Slide-in từ phải (`cubic-bezier(0.16, 1, 0.3, 1)`) + backdrop blur |
| Modal / Confirmation (`Dialog`) | `200ms` | Fade + scale (`0.95` → `1.0`) |
| Pipeline Step active | `2000ms` | Pulse nhẹ cho bước đang chạy, chuyển sang tích xanh khi hoàn tất |

- Không dùng hiệu ứng phóng đại làm xô lệch bố cục bảng (`layout-shifting hover`).
- Tôn trọng cấu hình hệ điều hành `@media (prefers-reduced-motion: reduce)`.

---

# 3. Landing Page & Authentication — Trang giới thiệu & Đăng nhập

## 3.1. Visual direction (`/`)

- **Định vị rõ ràng:** Giới thiệu SourceLogic là **Academic Source Verification Workspace**, tuyệt đối không nhắc đến “chấm điểm văn phạm”, “chấm điểm lập luận” hay “AI viết bài”.
- Header sáng, cố định (`sticky top-0`), hiển thị logo `SourceLogic` và nút `Sign in`.
- Hero trình bày trực quan luồng xử lý từ câu trích dẫn trong PDF đến kết quả đối chiếu CSDL học thuật.

## 3.2. Cấu trúc section trên Landing Page

| Section | Nội dung | Hành vi |
|---|---|---|
| Header | Logo `SourceLogic`, tagline, CTA `Sign in` | Sticky navigation |
| Hero | Headline **Verify Every Citation. Trace Every Source.**, mô tả pipeline, CTA **Check a Document →** | Điều hướng tới `/upload` hoặc `/login` |
| How It Works | Minh họa 4 giai đoạn: Extract → Link → Retrieve → Verify | Staggered reveal khi cuộn |
| Neuro-Symbolic Engine | Giải thích sự kết hợp giữa Fuzzy/Semantic Matching (Neural) và Rule Engine `R01–R12` (Symbolic) | So sánh với kiểm tra thủ công |
| Verification Taxonomy | Giới thiệu 5 nhãn Verdict (`VERIFIED`, `METADATA_ERROR`, `SUSPECTED_HALLUCINATION`, `UNRESOLVED`, `RESOURCE`) | Hiển thị `VerdictBadge` mẫu |
| Multi-Source Coverage | 4 API học thuật (**Crossref, OpenAlex, Semantic Scholar, CORE**) + **127K ACL Local FTS5 DB** | Thẻ nguồn dữ liệu |
| CTA & Footer | Kêu gọi trải nghiệm workspace + thông tin đồ án & tuyên bố Decision-Support | Internal links |

## 3.3. Authentication (`/login`)

- Form đăng nhập sử dụng `Card`, `Input`, `Label`, `Button` và `Alert` của `shadcn/ui`.
- Hỗ trợ xác thực JWT qua `/api/auth/login`, lưu trạng thái vào `AuthContext` và tự động điều hướng về `/dashboard`.
- **Bảo mật môi trường Production:** Khung hiển thị tài khoản demo (`admin`, `teacher`, `student`) chỉ được phép render khi `import.meta.env.VITE_DEMO_MODE === 'true'`.

---

# 4. Workspace & Document Upload — Không gian làm việc & Tải tài liệu

## 4.1. Dashboard tổng quan (`/dashboard`)

- **Header:** Tiêu đề `Dashboard`, mô tả ngắn, nút làm mới dữ liệu (`Refresh`) và Primary CTA **New Check (`/upload`)**.
- **KPI Grid (4 `StatCard` trên 1 hàng desktop):**
  1. **Total Documents:** Tổng số bài tiểu luận/bài báo đã tải lên.
  2. **Total Citations:** Tổng số trích dẫn đã bóc tách.
  3. **Average CIS Score:** Điểm toàn vẹn trích dẫn trung bình (`%`).
  4. **Verified Rate:** Tỷ lệ nguồn xác minh thành công (`%`).
- **Recent Documents Table (`shadcn/ui Table`):**
  - Tìm kiếm tức thì theo tên file (`Input` có icon `Search`).
  - Hiển thị trạng thái xử lý (`completed`, `processing`, `failed`), số trang, số trích dẫn, điểm CIS, thời gian tạo.
  - Hành động: **View Report** (`/verification/report/:id`) và **Delete** (mở `AlertDialog` xác nhận xóa, không dùng `window.confirm()`).

## 4.2. Single Document Upload (`/upload`)

```text
New Verification
Extract citations, resolve references, and verify academic sources.

┌───────────────────────────────────────────────────────────┐
│                         [ PDF ]                           │
│               Drop your PDF manuscript here               │
│                  or click to browse file                  │
│          Supports academic papers & essays (.pdf)         │
└───────────────────────────────────────────────────────────┘

  ✓ Auto-detect citation style (APA · IEEE · Vancouver · Chicago · MLA)
  ✓ Bidirectional In-text ↔ Reference linking
  ✓ Multi-source lookup (Local ACL FTS5 · Crossref · OpenAlex · S2 · CORE)

                                     [ Start Verification → ]
```

- Sử dụng vùng kéo-thả lớn (`dropzone`), kiểm tra định dạng `.pdf` ngay tại client trước khi gửi.
- Khi bấm **Start Verification**, gọi `POST /api/essays/upload` và chuyển hướng **ngay lập tức** sang màn hình tiến trình `/verification/processing/:id`.

## 4.3. Batch Upload / Class Submission (`/batch-upload`)

- Dành cho **Teacher** và **Admin** (được bảo vệ bởi capability `view_class_history`).
- Cho phép chọn lớp học mục tiêu qua `shadcn/ui Select` (`Class: [CS101 - T3 K67 ▼]`) để gán toàn bộ bài nộp vào lớp đó.
- Hàng đợi xử lý tuần tự (Sequential Queue), hiển thị `Progress` bar và trạng thái từng file (`Pending` → `Uploading` → `Processing` → `Completed` / `Failed`).

## 4.4. Real-time Processing Screen (`/verification/processing/:id`)

- Polling nhẹ tới `GET /api/essays/{id}/status` mỗi `1.5s` (không spam `/report` khi chưa xử lý xong).
- Hiển thị **Stepper 8 bước** trực quan:
  1. `Parsing document` (PyMuPDF + GROBID)
  2. `Detecting citation style` (APA / IEEE / Vancouver / Chicago / MLA)
  3. `Extracting citations & references`
  4. `Linking citations to references` (CitationLinker)
  5. `Retrieving source metadata` (Local DB + Crossref + OpenAlex + S2 + CORE)
  6. `Comparing candidate publications` (Fuzzy Author/Title/Venue/Year matching)
  7. `Applying neuro-symbolic rules` (Rules Engine & CIS)
  8. `Generating verification report`
- Bên cạnh stepper là 2 card thống kê trực tiếp: **Extraction Counters** (Citations found, References found, Linked) và **Retrieval Counters** (số lượng truy vấn tới từng nguồn).
- Tự động chuyển sang `/verification/report/:id` ngay khi `status === 'completed'`.

---

# 5. Verification Report — Báo cáo kiểm chứng 2 lớp

## 5.1. Bố cục tổng thể (`/verification/report/:id`)

1. **Mandatory Disclaimer (`DecisionSupportDisclaimer`):** Đặt ở đầu báo cáo, lấy nội dung từ backend `/api/health`, nhấn mạnh đây là công cụ hỗ trợ giảng viên ra quyết định.
2. **Essay Header (`EssayHeader`):** Breadcrumb, tên file PDF, số trang, tổng số trích dẫn, badge định dạng phát hiện được (ví dụ `IEEE`, `APA`).
3. **Summary Stats Grid (`EssayStatsGrid`):**
   - `Total Academic Citations` (không tính các URL `RESOURCE`)
   - `Verified` (Xanh lá)
   - `Metadata Issues` (Vàng hổ phách)
   - `Suspected Hallucination` (Đỏ)
   - `Verification Coverage (%)` + thanh `Progress`
4. **CIS Score Card (`CISScoreCard`):**
   - Hiển thị điểm **Citation Integrity Score (0–100)** cùng 5 thành phần trọng số:
     - **Verified Ratio:** `35%`
     - **Metadata Accuracy:** `25%`
     - **In-text ↔ Reference Consistency:** `25%`
     - **Format Consistency:** `10%`
     - **Identifier Validity:** `5%`
5. **Action & Diagnostic Bar (`EssayActionBar`):**
   - Nhóm nút chuyển nhanh sang các chế độ chẩn đoán sâu: **Issues**, **Logic Trace**, **Document Inspector**, **Orphan & Consistency**.
   - Nhóm nút **Export Report** (`DropdownMenu` hoặc nhóm `Button`): xuất báo cáo ra **JSON**, **CSV**, **PDF** và **DOCX**.

## 5.2. Ba chế độ xem chính (`shadcn/ui Tabs`)

| Tab | Nội dung hiển thị | Điểm nhấn UX |
|---|---|---|
| **Overview** | Bảng `VerdictTable` toàn diện kết hợp cả trạng thái liên kết và kết quả xác minh nguồn | Filter chips theo Verdict & Mapping Status (`aria-pressed`), tìm kiếm theo tác giả/tiêu đề, click mở Drawer |
| **Citations (`[N]`)** | Danh sách trích dẫn trong bài đã gom nhóm theo `raw_text` | Hiển thị badge số lần xuất hiện `×N` (ví dụ `[24] ×4`), hiển thị chính xác `Ref #N — Author (Year)` đã liên kết |
| **References (`#N`)** | Danh mục tài liệu tham khảo (Bibliography) đánh số `1-based` đồng bộ với backend (`ref-0001` = `#1`) | Cột **Cited in text** báo rõ số lần được gọi trong bài (`✓ ×3 trên trang 2, 5`) hoặc cảnh báo `— Not cited` |

---

# 6. Reference Inspector & Override — Ngăn kéo kiểm tra & Ghi đè kết quả

Khi người dùng bấm **View** hoặc click vào một dòng trong bảng báo cáo, `CitationDetailDrawer` (xây dựng bằng `shadcn/ui Sheet`) trượt ra từ cạnh phải, có bẫy tiêu điểm bàn phím (focus trap) và đầy đủ thuộc tính ARIA (`role="dialog"`, `aria-modal="true"`).

## 6.1. Cấu trúc Reference Inspector Drawer

```text
┌──────────────────────────────────────────────────────────┐
│ Reference #12                                      [ ✕ ] │
│ [METADATA_ERROR]  [MATCHED]              Confidence: 82% │
├──────────────────────────────────────────────────────────┤
│ CITED IN DOCUMENT                                        │
│ "Nguyen, T. H., Tran, P. K. (2021). Deep Learning for    │
│  Automatic Essay Evaluation. Journal of AI..."           │
├──────────────────────────────────────────────────────────┤
│ METADATA COMPARISON (Citation vs Best Retrieved Match)   │
│ Field        Cited                Retrieved       Status │
│ Title        ...Essay Evaluation  ...Assessment   ⚠ 82%  │
│ Authors      Nguyen, Tran         Nguyen, Tran    ✓ 100% │
│ Year         2021                 2020            ✕ Diff │
│ Venue        Journal of AI        Computers & Ed  ✕ Diff │
│ DOI          Missing              10.1016/j.cae.. ℹ Found│
├──────────────────────────────────────────────────────────┤
│ RETRIEVAL SOURCES & EVIDENCE                             │
│ [Crossref ✓ Match] [OpenAlex ✓ Match] [CORE — No result] │
│ → Open DOI / Source URL ↗                                │
├──────────────────────────────────────────────────────────┤
│ TEACHER / ADMIN VERDICT OVERRIDE (Role-gated)            │
│ New Verdict: [ Verified ▼ ]                              │
│ Reason:      [ Typo in publication year (online first) ] │
│                                        [ Save Override ] │
└──────────────────────────────────────────────────────────┘
```

## 6.2. Hành vi bắt buộc của Override (`OverrideControls`)

- **Phân quyền nghiêm ngặt:** Chỉ hiển thị đối với người dùng có capability `override_verdict` (**Teacher** phụ trách lớp của bài nộp đó hoặc **Admin**). Sinh viên (`user`) chỉ được xem kết quả và giải thích, tuyệt đối không thấy form chỉnh sửa.
- **Lý do bắt buộc:** Giảng viên khi đổi nhãn (ví dụ từ `METADATA_ERROR` sang `VERIFIED`) phải nhập lý do giải trình.
- **Lưu vết kiểm toán (Audit Persistence):** Gọi API cập nhật cơ sở dữ liệu, ghi vào bảng `audit_log` (ai sửa, thời gian nào, từ nhãn nào sang nhãn nào, lý do gì) và cập nhật giao diện tức thì qua React Query `useOverrideVerdict` mutation.

---

# 7. Deep-Dive Diagnostic Views — Bộ công cụ “Citation Debugger”

Đây là điểm khác biệt cốt lõi của SourceLogic, biến hệ thống hộp đen thành hệ thống **Explainable Neuro-Symbolic AI**:

| Màn hình | Route | Đối tượng | Chức năng UX/UI cốt lõi |
|---|---|---|---|
| **Issues Page** | `/verification/report/:id/issues` | Tất cả | Gom nhóm các vấn đề phát hiện được theo 3 mức độ: **Critical** (`SUSPECTED_HALLUCINATION`), **Warning** (`METADATA_ERROR`), **Info** (`UNRESOLVED` / `RESOURCE`). Cho phép lọc và mở rộng từng thẻ để xem chi tiết từng CSDL đã tra cứu. |
| **Document Inspector** | `/verification/report/:id/document` | Teacher, Admin | Giao diện chia đôi màn hình (Split-pane): bên trái hiển thị đoạn văn ngữ cảnh trong PDF với từ khóa trích dẫn được tô sáng `<mark>` và gạch chân màu theo trạng thái; bên phải là Inspector hiển thị chi tiết nguồn tương ứng khi click. |
| **Logic Trace & Rules** | `/verification/report/:id/trace` | Teacher, Admin | Trình bày chuỗi suy diễn 5 bước: `Parse` → `Search` → `Compare` → `Symbolic Rules` → `Verdict`. Kèm theo **Rule Inspector** hiển thị cấu trúc luật `IF ... AND ... THEN ...` (ví dụ `R04`, `R07`, `R11`) và **Evidence Graph** tương tác. |
| **Orphan & Consistency** | `/verification/report/:id/consistency` | Teacher, Admin | Phát hiện lỗi cấu trúc trích dẫn hai chiều: **Citations without Reference** (gọi trong bài nhưng quên liệt kê cuối bài), **References Never Cited** (liệt kê khống để làm đẹp danh mục tham khảo), và **Ambiguous Mappings**. |

---

# 8. Role-Based UX Architecture — Phân cấp Sinh viên · Giảng viên · Quản trị viên

Hệ thống vận hành theo kiến trúc phân quyền dựa trên năng lực (**Capability-Based Access Control**) thông qua hook `useRole()` và component `<RoleGate>`.

## 8.1. Ma trận phân cấp trải nghiệm 3 vai trò

| Tiêu chí | 🟢 Student (`user`) | 🟡 Teacher (`teacher`) | 🔴 Admin (`admin`) |
|---|---|---|---|
| **Triết lý UX** | *“Một nút bấm, một kết quả.”* Gọn gàng, tránh quá tải nhận thức. | *“Lớp học của tôi, sinh viên của tôi.”* Tập trung theo dõi tiến độ và thẩm định. | *“Toàn quyền kiểm soát và giám sát hệ thống.”* |
| **Sidebar Navigation** | 4 mục: `Dashboard`, `New Check`, `History`, `Settings`. | Thêm `Batch Check` và nhóm **Teaching**: `My Classes`, `Pending Reviews`. | Thêm nhóm **Administration**: `Accounts`, `System Health`, `Audit Log`. |
| **Phạm vi dữ liệu** | Chỉ xem và quản lý tài liệu do chính mình tải lên. | Xem bài cá nhân + toàn bộ bài nộp của sinh viên thuộc các lớp mình phụ trách. | Xem toàn bộ tài liệu, lớp học, người dùng và nhật ký hệ thống. |
| **Công cụ nâng cao** | Ẩn các trang `Logic Trace`, `Document Inspector`, `Orphan Detection`, `Override`. | Mở khóa toàn bộ công cụ Debugger và quyền **Override Verdict** trong phạm vi lớp. | Mở khóa toàn bộ công cụ Debugger + Override mọi bài nộp + Quản trị hệ thống. |

## 8.2. SourceLogic Classroom — Giao diện Giảng viên (`/teacher/*`)

1. **My Classes (`/teacher/classes`):**
   - 4 thẻ KPI đầu trang: `Total Classes`, `Total Students`, `Submissions`, `Needs Review`.
   - Danh sách các lớp học phụ trách (tên lớp, mã môn học `course_code`, số sinh viên, số bài nộp, badge cảnh báo số bài có lỗi cần duyệt).
   - Nút **+ Tạo lớp (`CreateClassDialog` dùng `shadcn/ui Dialog`)**.
2. **Class Detail (`/teacher/classes/:classId`):**
   - Quản lý danh sách sinh viên trong lớp (`AddStudentDialog`, xóa sinh viên).
   - Sử dụng `shadcn/ui Tabs` gồm 3 tab: **Students** | **Essays** | **Pending Reviews**.
   - Hỗ trợ xuất báo cáo điểm toàn vẹn trích dẫn của cả lớp ra file **CSV**.
3. **Pending Reviews (`/teacher/reviews`):**
   - Hàng đợi tập trung tất cả các bài nộp có `METADATA_ERROR` hoặc `SUSPECTED_HALLUCINATION` từ mọi lớp mà giảng viên đang dạy để duyệt nhanh.

## 8.3. SourceLogic Control — Giao diện Quản trị viên (`/admin/*`)

> **SourceLogic Control** chỉ bao gồm đúng 3 module quản trị phục vụ vận hành hệ thống kiểm chứng học thuật, không thêm CMS, blog hay tính năng ngoài phạm vi đồ án.

1. **Account Management (`/admin/users`):**
   - Bảng quản lý người dùng (`shadcn/ui Table`), lọc theo Role (`all` / `admin` / `teacher` / `user`) và trạng thái (`active` / `inactive`), tìm kiếm theo tên/email/username.
   - Tạo tài khoản mới, phân quyền role, kích hoạt/vô hiệu hóa, đặt lại mật khẩu (`UserFormDialog`, `DeleteUserDialog`).
2. **System Health (`/admin/system`):**
   - Thống kê tổng thể hệ thống: tổng số Users, Admins, Teachers, Students, Essays, Verdicts và phân bố nhãn Verdict (`verdict_label_counts`).
3. **Audit Log (`/admin/audit`):**
   - Bảng nhật ký kiểm toán mới nhất trước (mặc định 100 bản ghi), lọc theo username.
   - Ghi rõ thời gian, người thực hiện, mã trích dẫn, sự thay đổi nhãn (`from → to`) và ghi chú lý do override.

---

# 9. Responsive Design & Accessibility (WCAG 2.1 AA)

| Thành phần | Desktop (`>= 1024px`) | Tablet (`768–1023px`) | Mobile (`<= 767px`) |
|---|---|---|---|
| **Navigation Sidebar** | Sidebar cố định bên trái (`w-72`) | Drawer trượt (`Sheet`) mở bằng nút Menu | Drawer trượt (`Sheet`), nút đóng/mở ≥ `44×44px` |
| **Dashboard KPIs** | Grid 4 cột | Grid 2 cột | Grid 1–2 cột |
| **Report Tables** | Đầy đủ cột, hiển thị inline | Cuộn ngang mượt trong `ScrollArea` | Ưu tiên cột Citation + Badge + View |
| **Document Inspector** | Split-pane 2 cột cạnh nhau | Xếp chồng (Văn bản trên, Inspector dưới) | Xếp chồng + Bottom/Right Sheet |
| **Reference Inspector** | Right Sheet (`max-w-lg`) | Right Sheet (`max-w-md`) | Toàn màn hình (`w-full`) |

### Tiêu chuẩn Accessibility (A11y) bắt buộc:
- **Skip-to-content link:** Đặt ở đầu `AppLayout`, hiện rõ khi nhấn `Tab` để nhảy thẳng vào `<main id="main-content" tabIndex={-1}>`.
- **Keyboard Shortcuts:** Nhấn `Ctrl + /` (hoặc `Cmd + /`) mở ngay `HelpModal` hướng dẫn sử dụng và bảng phím tắt.
- **ARIA & Focus Management:** Mọi nút chỉ có icon phải có `aria-label`; các filter chip phải có `aria-pressed={isActive}` nằm trong `role="group"`; mọi Drawer/Modal phải bẫy focus (focus trap) và đóng được bằng phím `Escape`.
- **Color Contrast:** Văn bản nội dung đạt tối thiểu `4.5:1` (sử dụng `text-slate-600` trở lên ở chế độ sáng, không dùng `text-slate-400` cho văn bản chính).

---

# 10. Technology Stack và Architecture

## 10.1. Đối chiếu công nghệ dự án

| Thành phần | Công nghệ sử dụng | Vai trò trong dự án |
|---|---|---|
| **Frontend Framework** | **React 18 + TypeScript + Vite 5** | SPA tốc độ cao, code-splitting theo từng route (`React.lazy`) |
| **UI Component System** | **shadcn/ui + Radix UI** | Hệ thống UI primitives chuẩn WAI-ARIA, tùy biến bằng mã nguồn trong dự án |
| **Styling** | **Tailwind CSS 3.4** | Utility-first CSS kết hợp CSS Variables cho Light/Dark mode và token ngữ nghĩa |
| **Server State & Caching** | **TanStack React Query v5** | Quản lý fetching, caching, polling tiến trình và optimistic update khi override |
| **Routing & i18n** | **React Router v6 + i18next** | Điều hướng bảo vệ theo capability (`ProtectedRoute`) và đa ngôn ngữ Việt/Anh |
| **Icons** | **Lucide React** | Bộ icon SVG nét mảnh, đồng nhất |
| **Backend API** | **FastAPI (Python 3.11+)** | REST API bất đồng bộ, xác thực JWT, phân quyền Role/Capability |
| **PDF & Citation Parsing** | **PyMuPDF + GROBID 0.9.1** | Bóc tách văn bản PDF, nhận diện cấu trúc bài báo và danh mục tham khảo |
| **Local Database** | **SQLite + FTS5** | Lưu trữ ứng dụng (`app.db`) + Cơ sở dữ liệu 127.103 bài báo ACL (`local_papers.db`) |
| **External Retrieval** | **Crossref, OpenAlex, Semantic Scholar, CORE** | 4 nguồn truy hồi học thuật đa luồng kết hợp Whitelist các bài báo kinh điển |
| **Verification Engine** | **Neuro-Symbolic Checker + CIS** | Kết hợp so khớp mờ (fuzzy/semantic matching) với hệ luật suy diễn và tính điểm CIS |
| **Export Engine** | **JSON, CSV, PDF, DOCX** | Xuất báo cáo kiểm chứng phục vụ lưu trữ và chấm bài |
| **Testing** | **Pytest (Backend) + Vitest & Playwright (Web)** | Hơn 1.000 unit/integration tests ở backend + unit hooks & E2E flows ở frontend |
| **Deployment** | **Docker Compose** | Đóng gói đầy đủ 3 container: `grobid`, `api`, `web` |

## 10.2. Kiến trúc tổng thể (End-to-End Architecture)

```text
 ┌───────────────────────────────────────────────────────────────────────┐
 │                   React 18 + TypeScript + shadcn/ui                   │
 │     Student Workspace  ·  Teacher Classroom  ·  Admin Control UI      │
 └───────────────────────────────────┬───────────────────────────────────┘
                                     │ REST API (JWT + TanStack Query)
                                     ▼
 ┌───────────────────────────────────────────────────────────────────────┐
 │                        FastAPI Backend Server                         │
 │     Auth / RBAC  ·  Essays / Reports  ·  Teacher Classes  ·  Audit    │
 └─────────────────┬───────────────────────────────────┬─────────────────┘
                   │                                   │
                   ▼                                   ▼
 ┌───────────────────────────────────┐ ┌─────────────────────────────────┐
 │   8-Step Verification Pipeline    │ │       Persistence Layer         │
 │ 1. PDF Parser (GROBID + PyMuPDF)  │ │ • app.db (Users, Classes,       │
 │ 2. Modular Format Extractor       │ │   Essays, Verdicts, AuditLog)   │
 │ 3. Bidirectional Citation Linker  │ │ • Report Cache (SHA-256)        │
 │ 4. Retrieval Orchestrator ────────┼─┼►• local_papers.db (SQLite FTS5  │
 │ 5. Fuzzy Candidate Matcher        │ │   127,103 ACL Anthology papers) │
 │ 6. Neuro-Symbolic Rules Engine    │ └─────────────────────────────────┘
 │ 7. CIS Score Calculator           │                 │
 │ 8. Multi-Format Exporter          │                 ▼
 └───────────────────────────────────┘ ┌─────────────────────────────────┐
                                       │   External Academic Providers   │
                                       │ Crossref · OpenAlex · S2 · CORE │
                                       └─────────────────────────────────┘
```

## 10.3. Cấu trúc thư mục dự án

```text
essay-integrity-checker/
├── src/integrity_checker/          # Backend Python & Neuro-Symbolic Pipeline
│   ├── api/
│   │   ├── routes/                 # auth, essays, report, verdicts, export, teacher, users, system, audit, health
│   │   ├── services/               # essay_service, avatar_service
│   │   ├── deps.py                 # JWT & Role dependencies (require_teacher, require_admin)
│   │   ├── progress.py             # Real-time step status tracker
│   │   └── main.py                 # FastAPI entrypoint
│   ├── database/                   # SQLite + FTS5 local papers & app repository
│   ├── extraction/                 # Document parser (GROBID/PyMuPDF) & modular patterns (APA, IEEE, Vancouver, MLA, Chicago)
│   ├── linking/                    # Bidirectional Citation ↔ Reference linker
│   ├── retrieval/                  # Multi-source orchestrator (Local DB, Whitelist, Crossref, OpenAlex, S2, CORE)
│   ├── matching/                   # Author, Title, Venue, Year similarity matching
│   ├── logic/                      # Neuro-symbolic rules engine & CIS score calculation
│   ├── export/                     # JSON, CSV, PDF, DOCX report exporters
│   ├── models/                     # Pydantic data schemas
│   └── pipeline/                   # Main integrity_pipeline orchestration
├── web/                            # Frontend React + TypeScript + Vite + shadcn/ui
│   ├── src/
│   │   ├── api/client.ts           # Single consolidated API layer & TypeScript interfaces
│   │   ├── components/
│   │   │   ├── ui/                 # shadcn/ui primitives (button, card, table, dialog, sheet, tabs, badge, select...)
│   │   │   ├── CitationGraph/      # Interactive Evidence & Citation Graph
│   │   │   ├── AppLayout.tsx       # Role-aware sidebar layout & skip-to-content
│   │   │   ├── CISScoreCard.tsx    # Citation Integrity Score display
│   │   │   ├── VerdictTable.tsx    # Filterable & searchable verdicts table
│   │   │   ├── CitationDetailDrawer.tsx # Slide-over reference inspector
│   │   │   ├── MetadataDiff.tsx    # Cited vs Retrieved field comparison
│   │   │   ├── OverrideControls.tsx# Teacher/Admin verdict override form
│   │   │   ├── RuleInspector.tsx   # Symbolic rule trace viewer
│   │   │   ├── RoleGate.tsx        # Capability-based conditional renderer
│   │   │   └── DecisionSupportDisclaimer.tsx # Mandatory academic disclaimer
│   │   ├── contexts/               # AuthContext, ThemeContext, ToastContext
│   │   ├── hooks/                  # useRole, useEssays, useEssayReport, useOrphanReport, useDebounce...
│   │   ├── pages/                  # 18 lazy-loaded route pages + essay/ subcomponents
│   │   ├── router.tsx              # React Router v6 with ProtectedRoute & Suspense
│   │   └── index.css               # Tailwind & SourceLogic CSS variables
│   ├── components.json             # shadcn/ui CLI configuration
│   └── tailwind.config.ts          # Tailwind theme tokens
├── configs/                        # YAML configurations
├── tests/                          # Backend unit & integration tests
└── docker-compose.yml              # Multi-container setup (grobid + api + web)
```

---

# 11. Sitemap, URL Structure & Role Visibility Matrix

| Trang | Route URL | Component | `user` | `teacher` | `admin` | Capability yêu cầu |
|---|---|---|:---:|:---:|:---:|---|
| Landing Page | `/` | `LandingPage` | ✓ | ✓ | ✓ | Public |
| Sign In | `/login` | `LoginPage` | ✓ | ✓ | ✓ | Public (`PublicRoute`) |
| Dashboard | `/dashboard` | `DashboardPage` | ✓ | ✓ | ✓ | `upload_essay` |
| New Check | `/upload` | `UploadPage` | ✓ | ✓ | ✓ | `upload_essay` |
| Batch / Class Check | `/batch-upload` | `BatchUploadPage` | — | ✓ | ✓ | `view_class_history` |
| Processing Screen | `/verification/processing/:id` | `ProcessingPage` | ✓ | ✓ | ✓ | Authenticated (Owner/Teacher/Admin) |
| Verification Report | `/verification/report/:id` | `EssayPage` | ✓ | ✓ | ✓ | Authenticated (Owner/Teacher/Admin) |
| Issues Breakdown | `/verification/report/:id/issues` | `IssuesPage` | ✓ | ✓ | ✓ | Authenticated (Owner/Teacher/Admin) |
| Logic Trace & Rules | `/verification/report/:id/trace` | `LogicTracePage` | — | ✓ | ✓ | `view_logic_trace` |
| Document Inspector | `/verification/report/:id/document` | `DocumentInspectorPage` | — | ✓ | ✓ | `view_document_inspector` |
| Orphan & Consistency | `/verification/report/:id/consistency` | `OrphanDetectionPage` | — | ✓ | ✓ | `view_orphan_detection` |
| Verification History | `/history` | `HistoryPage` | ✓ | ✓ | ✓ | `view_own_history` |
| My Classes | `/teacher/classes` | `MyClassesPage` | — | ✓ | ✓ | `view_class_history` |
| Class Detail | `/teacher/classes/:classId` | `ClassDetailPage` | — | ✓ | ✓ | `view_class_history` |
| Pending Reviews | `/teacher/reviews` | `PendingReviewsPage` | — | ✓ | ✓ | `override_verdict` |
| Account Management | `/admin/users` | `AccountManagementPage` | — | — | ✓ | `manage_users` |
| System Health | `/admin/system` | `SystemHealthPage` | — | — | ✓ | `view_system_health` |
| Audit Log | `/admin/audit` | `AuditLogPage` | — | — | ✓ | `view_audit_log` |
| User Profile | `/profile` | `ProfilePage` | ✓ | ✓ | ✓ | Authenticated |
| Settings | `/settings` | `SettingsPage` | ✓ | ✓ | ✓ | Authenticated |

---

# 12. Requirement & Thesis Compliance Matrix

| Hạng mục | Giải pháp của SourceLogic | Mức độ ưu tiên |
|---|---|---|
| **Decision-Support Disclaimer** | Hiển thị rõ trên Header/Report, khẳng định không tự động kết luận đạo văn/gian lận | Bắt buộc |
| **Dual-Layer Verification** | Tách biệt rõ 7 trạng thái `CitationMappingStatus` (Lớp 1) và 5 nhãn `ValidationLabel` (Lớp 2) | Bắt buộc |
| **URL Resource Classification** | Phân loại các đường dẫn GitHub/website là `RESOURCE` (màu tím), không làm giảm điểm CIS học thuật | Bắt buộc |
| **Explainable AI (Neuro-Symbolic)** | Mọi kết luận đều hiển thị độ tương đồng metadata, nguồn truy hồi và các luật `Rxx` đã kích hoạt | Bắt buộc |
| **1-Based Reference Indexing** | Đồng bộ tuyệt đối `ref-0001` ở backend với `Ref #1` trên UI Citations & References | Bắt buộc |
| **Role-Based Access (3 Tiers)** | Phân tách rõ `user` (Student), `teacher` (Classroom) và `admin` (Control) ở cả API và UI | Bắt buộc |
| **Verdict Override & Audit** | Teacher/Admin có thể ghi đè nhãn kèm lý do; lưu lịch sử vào `audit_log` | Bắt buộc |
| **Multi-Format Export** | Xuất báo cáo ra 4 định dạng: `JSON`, `CSV`, `PDF`, `DOCX` | Bắt buộc |
| **Accessibility & Performance** | Bundle khởi tạo `< 250KB` (`React.lazy`), tương phản WCAG AA, hỗ trợ bàn phím và screen reader | Tiêu chí chất lượng |
| **Docker Compose Deployment** | Khởi chạy đồng bộ `grobid`, `api`, `web` qua `docker-compose up` | Bắt buộc |

## 12.1. Những điều tuyệt đối không bỏ qua

1. **Không biến sản phẩm thành công cụ chấm điểm bài luận (Essay Grader):** Tuyệt đối không thêm các chỉ số chấm điểm ngữ pháp, từ vựng hay lập luận. `CIS` là **Citation Integrity Score**, không phải điểm tổng của bài tiểu luận.
2. **Không bao giờ bỏ `<DecisionSupportDisclaimer />`:** Mọi kết quả hiển thị hoặc xuất file đều phải kèm tuyên bố miễn trừ trách nhiệm hỗ trợ quyết định.
3. **Không để lộ điều khiển Override hoặc trang Debugger nâng cao cho `user` thường:** Quyền `override_verdict` chỉ dành cho `teacher` (trong lớp mình dạy) và `admin`.
4. **Không gọi `fetch()` rời rạc hoặc tạo nhiều file API:** Toàn bộ giao tiếp HTTP trên frontend phải đi qua một nguồn duy nhất là `web/src/api/client.ts` kết hợp với các custom hooks của TanStack React Query.
5. **Không dùng `window.location.reload()`, `window.alert()`, `window.confirm()`:** Mọi thay đổi ngôn ngữ, theme, xóa dữ liệu hoặc ghi đè kết quả phải xử lý mượt qua React state, `ToastContext` và `ConfirmationModal` (`shadcn/ui AlertDialog`).
6. **Không để lộ tài khoản demo ở môi trường Production:** Khối thông tin tài khoản thử nghiệm trên `LoginPage` chỉ hiển thị khi `VITE_DEMO_MODE === 'true'`.

---

# 13. Frontend UI Libraries, shadcn/ui Components, Blocks & Assets

## 13.1. Nguyên tắc: Chuẩn hóa trên nền tảng `shadcn/ui`

Hiện tại dự án đã có cấu hình `web/components.json` và các gói `@radix-ui/*`, nhưng thư mục `web/src/components/ui/` mới chỉ có `placeholder.ts` và nhiều trang vẫn đang tự viết các thẻ `<button>`, `<input>`, `<table>`, modal thủ công bằng class Tailwind.

**Chiến lược nâng cấp UX/UI với `shadcn/ui`:**
1. **UI Primitives (`web/src/components/ui/`):** Sinh đầy đủ các component gốc từ `shadcn/ui` (Button, Card, Table, Tabs, Sheet, Dialog, AlertDialog, Select, Badge, Input, Tooltip, DropdownMenu, Progress, Skeleton, ScrollArea, Alert).
2. **Domain Blocks (`web/src/components/`):** Xây dựng các khối nghiệp vụ kiểm chứng học thuật (`VerdictTable`, `CitationDetailDrawer`, `CISScoreCard`, `MetadataDiff`, `OverrideControls`) bằng cách lắp ghép (compose) các primitive của `shadcn/ui` thay vì viết lại logic đóng/mở, focus trap hay keyboard navigation từ đầu.
3. **Giữ nguyên 100% logic nghiệp vụ và kết nối Backend:** Thay thế lớp vỏ UI sang `shadcn/ui` nhưng bảo toàn toàn bộ hệ thống React Query hooks (`useEssays`, `useEssayReport`, `useOverrideVerdict`), `useRole()` và các `data-testid` / `aria-label` phục vụ kiểm thử Vitest & Playwright.

## 13.2. Recommended frontend libraries

| Nhu cầu | Thư viện / Nguồn | Vai trò trong SourceLogic | Trang chủ |
|---|---|---|---|
| **UI Components** | **shadcn/ui** | Button, Card, Table, Tabs, Sheet, Dialog, AlertDialog, Badge, Select, Input, Progress, Skeleton | https://ui.shadcn.com/ |
| **Accessible Primitives** | **Radix UI** | Quản lý focus trap, keyboard navigation, WAI-ARIA cho Drawer, Modal, Dropdown, Tabs | https://www.radix-ui.com/ |
| **Styling** | **Tailwind CSS** | Hệ thống utility classes và CSS Variables (`--background`, `--primary`, `--verdict-*`) | https://tailwindcss.com/ |
| **Server State** | **TanStack Query v5** | Quản lý cache, tự động polling tiến trình xử lý PDF, mutation ghi đè kết quả | https://tanstack.com/query |
| **Icons** | **Lucide React** | Hệ thống icon học thuật & kỹ thuật (`FileSearch`, `Quote`, `Link2`, `GitBranch`, `Scale`...) | https://lucide.dev/ |
| **File Upload** | **react-dropzone** | Xử lý kéo-thả PDF đơn lẻ và hàng loạt (Batch Upload) | https://react-dropzone.js.org/ |
| **Internationalization** | **react-i18next** | Chuyển đổi ngôn ngữ Việt – Anh tức thời | https://react.i18next.com/ |

## 13.3. Phân công component `shadcn/ui` theo từng màn hình

| Màn hình | Component `shadcn/ui` sử dụng | Phần nghiệp vụ SourceLogic kết nối Backend |
|---|---|---|
| **AppLayout & Sidebar** | `Sheet` (Mobile nav), `Button`, `Tooltip`, `Separator`, `ScrollArea`, `Avatar` | `useRole()`, `SIDEBAR_GROUPS` lọc theo capability, `ThemeToggle`, phím tắt `Ctrl+/` mở `HelpModal` |
| **Dashboard (`/dashboard`)** | `Card`, `Table`, `Input`, `Button`, `Badge`, `Skeleton`, `AlertDialog` | `useEssays()`, `useDashboardStats()`, `useDeleteEssay()` |
| **Upload & Batch (`/upload`, `/batch-upload`)** | `Card`, `Button`, `Select` (chọn lớp học), `Progress`, `Alert`, `Badge` | `api.uploadEssay()`, hàng đợi xử lý tuần tự, gán `class_id` cho bài nộp |
| **Processing (`/verification/processing/:id`)** | `Card`, `Progress`, `Badge`, `Skeleton`, `Alert` | Polling `api.getEssayStatus(id)` mỗi `1.5s`, hiển thị 8 bước pipeline và bộ đếm nguồn |
| **Verification Report (`/verification/report/:id`)** | `Tabs` (`Overview`, `Citations`, `References`), `Card`, `Table`, `Badge`, `DropdownMenu` (Export), `Input` | `useEssayReport(id)`, `CISScoreCard`, dedupe trích dẫn in-text `×N`, liên kết `Ref #N`, xuất JSON/CSV/PDF/DOCX |
| **Reference Inspector Drawer** | `Sheet` (`SheetContent`, `SheetHeader`, `SheetTitle`), `Select`, `Textarea`, `Button`, `Separator`, `Badge` | `MetadataDiff` (Cited vs Retrieved), `OverrideControls` (`useOverrideVerdict`), kiểm tra quyền `override_verdict` |
| **Diagnostic Views (`Issues`, `Trace`, `Document`, `Orphan`)** | `Card`, `Collapsible` / `Accordion`, `Tabs`, `Badge`, `ScrollArea`, `Tooltip` | `RuleInspector` (`IF/AND/THEN`), `CitationGraphView`, inline `<mark>` context highlighting |
| **Teacher Classroom (`/teacher/*`)** | `Card`, `Tabs`, `Table`, `Dialog` (`CreateClassDialog`, `AddStudentDialog`), `Button`, `Badge` | `api.getTeacherDashboard()`, quản lý sinh viên theo lớp, hàng đợi `PendingReviews`, xuất CSV lớp |
| **Admin Control (`/admin/*`)** | `Card`, `Table`, `Dialog` (`UserFormDialog`), `AlertDialog` (`DeleteUserDialog`), `Select`, `Input`, `Badge` | Quản lý tài khoản, thống kê `SystemHealth`, truy vấn nhật ký kiểm toán `AuditLog` |

## 13.4. Cách tùy biến component `shadcn/ui` cho SourceLogic

- **`Button`:**
  - `default` (Primary): nền `bg-primary` (`#4F46E5`), chữ trắng, `rounded-xl`, `h-10` hoặc `h-11` (`min-h-11` trên mobile), shadow nhẹ.
  - `secondary`: nền `bg-slate-100 dark:bg-slate-800`, chữ `text-slate-900 dark:text-slate-100`, `rounded-xl`.
  - `outline`: viền `border-slate-200 dark:border-slate-700`, hiệu ứng hover `hover:bg-slate-50 dark:hover:bg-slate-800`.
  - `destructive`: nền `bg-red-600 hover:bg-red-700`, dùng cho hành động xóa tài liệu hoặc xóa tài khoản.
- **`Card`:** Nền `bg-card`, viền `border-slate-200 dark:border-slate-800`, bo góc `rounded-2xl`, `shadow-sm`.
- **`Badge`:** Mở rộng thêm 2 nhóm biến thể chuyên biệt trong `VerdictBadge` (`rounded-full` cho 5 nhãn Verdict) và `MappingStatusBadge` (`rounded-md` cho 7 trạng thái Mapping) cùng `RoleBadge` (`user`, `teacher`, `admin`).
- **`Sheet` (Reference Inspector):** Mở từ cạnh phải (`side="right"`), độ rộng `sm:max-w-lg`, có `ScrollArea` bên trong để cuộn mượt khi bảng so sánh metadata và danh sách nguồn dài.
- **`Table`:** Header nền `bg-slate-50 dark:bg-slate-800/50`, chữ `text-xs font-semibold uppercase tracking-wider text-slate-500`, dòng dữ liệu có `hover:bg-slate-50/80 dark:hover:bg-slate-800/40`.

## 13.5. Component inventory đề xuất

```text
web/src/components/
├── ui/                                 # shadcn/ui standard primitives
│   ├── alert.tsx
│   ├── alert-dialog.tsx
│   ├── avatar.tsx
│   ├── badge.tsx
│   ├── button.tsx
│   ├── card.tsx
│   ├── checkbox.tsx
│   ├── dialog.tsx
│   ├── dropdown-menu.tsx
│   ├── input.tsx
│   ├── label.tsx
│   ├── popover.tsx
│   ├── progress.tsx
│   ├── scroll-area.tsx
│   ├── select.tsx
│   ├── separator.tsx
│   ├── sheet.tsx
│   ├── skeleton.tsx
│   ├── switch.tsx
│   ├── table.tsx
│   ├── tabs.tsx
│   ├── textarea.tsx
│   └── tooltip.tsx
├── layout/                             # Layout & Navigation blocks
│   ├── AppLayout.tsx
│   ├── DecisionSupportDisclaimer.tsx
│   ├── HelpModal.tsx
│   └── PageSkeleton.tsx
├── verification/                       # Report & Verification domain blocks
│   ├── CISScoreCard.tsx
│   ├── StyleProfileCard.tsx
│   ├── VerdictBadge.tsx
│   ├── MappingStatusBadge.tsx
│   ├── VerdictTable.tsx
│   ├── UploadDropzone.tsx
│   └── ProcessingStep.tsx
├── inspector/                          # Deep-dive & Reference Inspector blocks
│   ├── CitationDetailDrawer.tsx
│   ├── MetadataDiff.tsx
│   ├── SourceRetrievalUI.tsx
│   ├── OverrideControls.tsx
│   ├── DocumentInspector.tsx
│   ├── RuleInspector.tsx
│   └── OrphanDetection.tsx
├── graph/                              # Evidence & Citation Graph blocks
│   ├── CitationGraphView.tsx
│   ├── CitationGraphControls.tsx
│   └── EvidenceGraphNode.tsx
└── role/                               # RBAC, Teacher & Admin blocks
    ├── RoleGate.tsx
    ├── RoleBadge.tsx
    ├── CreateClassDialog.tsx
    ├── AddStudentDialog.tsx
    ├── UserFormDialog.tsx
    └── DeleteUserDialog.tsx
```

*(Lưu ý: Có thể giữ các component nghiệp vụ ở đường dẫn hiện tại `web/src/components/*.tsx` để tránh phá vỡ import đang chạy, nhưng toàn bộ phần tử UI bên trong cần được chuẩn hóa sang sử dụng `web/src/components/ui/*`).*

## 13.6. Cài đặt và sinh component `shadcn/ui` cho dự án (Vite + TypeScript)

Dự án đã có sẵn file cấu hình `web/components.json` với `"tsx": true`, `"style": "default"`, `"baseColor": "slate"`, `"cssVariables": true`.

Để bổ sung đầy đủ bộ primitive `shadcn/ui` vào `web/src/components/ui/` (thay thế cho `placeholder.ts`), chạy lệnh trong thư mục `web/`:

```bash
cd web

# Nhóm core primitives & layout
npx shadcn@latest add button input textarea label card badge separator skeleton

# Nhóm overlays, dialogs & drawers
npx shadcn@latest add dialog alert-dialog sheet dropdown-menu tooltip popover

# Nhóm data display & forms
npx shadcn@latest add table tabs select checkbox switch progress scroll-area alert avatar
```

## 13.7. Asset & Visual guidelines

| Asset | Định hướng chuẩn trong SourceLogic |
|---|---|
| **Icons** | Chỉ dùng **Lucide React** (`FileSearch`, `Quote`, `Link2`, `Database`, `GitBranch`, `CheckCircle2`, `AlertTriangle`, `XCircle`, `Scale`). **Không dùng emoji làm icon UI.** |
| **Fonts** | `Source Serif 4` (Headings & Document Reader), `Inter` (UI Body), `JetBrains Mono` (Citation indices, DOIs, Rule IDs). |
| **Source Badges** | Nhãn nhận diện nguồn học thuật rõ ràng: `CROSSREF` (Emerald), `OPENALEX` (Indigo), `SEMANTIC SCHOLAR` (Amber), `CORE` (Orange), `LOCAL ACL DB` (Slate). |
| **Charts / Graphs** | Đồ thị bằng chứng (`CitationGraphView`) dùng node/edge вектор tối giản, màu sắc khớp với bảng màu Verdict/Mapping. |

## 13.8. Prompt triển khai cho AI Coding Agent (Claude Code / Cursor / Antigravity)

```text
Refactor and build the SourceLogic (Essay Integrity Checker) frontend in `web/`
using React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui, Radix UI,
TanStack React Query, and Lucide React.

Requirements:
1. Generate and use official shadcn/ui primitives in `web/src/components/ui/`
   (Button, Card, Table, Tabs, Sheet, Dialog, AlertDialog, Select, Input,
   Textarea, Badge, Progress, Skeleton, DropdownMenu, Tooltip, ScrollArea, Alert)
   instead of ad-hoc HTML elements or `placeholder.ts`.
2. Follow the SourceLogic Scholarly design system in `SOURCELOGIC_CONCEPT.md`:
   - Light mode (`#F8FAFC` background, `#FFFFFF` cards, `#0F172A` text) and
     Dark mode (`#020617` background, `#0F172A` cards, `#F8FAFC` text).
   - Primary accent `#4F46E5` (Indigo).
   - Strict semantic tokens for 5 Verdict labels (`VERIFIED`, `METADATA_ERROR`,
     `SUSPECTED_HALLUCINATION`, `UNRESOLVED`, `RESOURCE`) and 7 Mapping statuses.
   - Typography: `Source Serif 4` for headings/document context, `Inter` for UI,
     and `JetBrains Mono` for citation markers `[1]`, DOIs, and rule IDs `R01-R12`.
3. Preserve the 3-tier capability-based role architecture (`user`, `teacher`, `admin`)
   via `useRole()` and `<RoleGate>`:
   - Students (`user`) see a clean, focused workspace without override controls
     or advanced debugger views.
   - Teachers (`teacher`) access SourceLogic Classroom (`/teacher/classes`,
     `/teacher/reviews`), debugger views (`LogicTrace`, `DocumentInspector`,
     `OrphanDetection`), and scoped verdict overrides.
   - Admins (`admin`) access SourceLogic Control (`/admin/users`, `/admin/system`,
     `/admin/audit`) and global overrides.
4. Always include `<DecisionSupportDisclaimer />` on workspace/report views.
   Never frame the product as an general essay/grammar grader.
5. Route all API calls through `web/src/api/client.ts` and TanStack React Query
   hooks. Never use raw `fetch()`, `window.location.reload()`, `alert()`, or `confirm()`.
6. Maintain WCAG 2.1 AA accessibility (4.5:1 contrast, 44x44px touch targets,
   focus traps in Sheet/Dialog, skip-to-content link, `Ctrl+/` help shortcut)
   and ensure all Vitest + Playwright E2E tests pass.
```

---

# 14. Implementation Roadmap cho Coding Agent

## Phase 1 — shadcn/ui Primitives Foundation
- Khởi tạo đầy đủ các component trong `web/src/components/ui/` thông qua CLI `npx shadcn@latest add ...` và xóa `placeholder.ts`.
- Đồng bộ hệ thống CSS Variables trong `web/src/index.css` và `web/tailwind.config.ts` để các primitive của `shadcn/ui` nhận đúng màu `SourceLogic` ở cả Light mode và Dark mode.

## Phase 2 — Shared Layout, Navigation & Modals
- Chuẩn hóa `AppLayout.tsx` sử dụng `shadcn/ui Sheet` cho mobile sidebar, `ScrollArea` cho menu điều hướng, `Avatar` và `DropdownMenu` cho khu vực tài khoản người dùng.
- Chuyển đổi `ConfirmationModal`, `HelpModal`, `CreateClassDialog`, `AddStudentDialog`, `UserFormDialog`, `DeleteUserDialog` sang dùng `Dialog` và `AlertDialog` chuẩn của `shadcn/ui`.

## Phase 3 — Core Verification Flow (Dashboard, Upload, Processing)
- Nâng cấp `DashboardPage`, `HistoryPage` với `shadcn/ui Card`, `Table`, `Input`, `Badge`, `Skeleton`.
- Chuẩn hóa `UploadPage` và `BatchUploadPage` với `Select` (chọn lớp học), `Progress` (tiến độ hàng đợi), `Alert` (thông báo lỗi định dạng).
- Hoàn thiện `ProcessingPage` với stepper 8 bước và thẻ số liệu thời gian thực.

## Phase 4 — Dual-Layer Report & Reference Inspector Drawer
- Nâng cấp `EssayPage` với `shadcn/ui Tabs` (`Overview`, `Citations`, `References`), `DropdownMenu` cho nút xuất báo cáo (`JSON`, `CSV`, `PDF`, `DOCX`).
- Nâng cấp `CitationDetailDrawer` bằng `shadcn/ui Sheet`, tích hợp `MetadataDiff`, `SourceRetrievalUI` và form `OverrideControls` (`Select` + `Textarea` + `Button`).

## Phase 5 — Debugger Views, Teacher Classroom & Admin Control
- Đồng bộ giao diện `IssuesPage`, `LogicTracePage`, `DocumentInspectorPage`, `OrphanDetectionPage` bằng `Card`, `Badge`, `ScrollArea`, `Tooltip`.
- Hoàn thiện trải nghiệm bảng và tab trên `MyClassesPage`, `ClassDetailPage`, `PendingReviewsPage`, `AccountManagementPage`, `SystemHealthPage`, `AuditLogPage`.

## Phase 6 — QA, Accessibility & Thesis Defense Readiness
- Kiểm tra toàn diện Light/Dark mode, độ tương phản ≥ 4.5:1, vùng chạm ≥ `44×44px`, điều hướng bàn phím.
- Chạy kiểm thử `pytest`, `vitest`, `playwright test` và `pnpm build` (đảm bảo initial bundle `< 250KB`).

---

# 15. UI/UX Acceptance Checklist

- [ ] Toàn bộ primitives trong `web/src/components/ui/` được sinh chuẩn xác từ `shadcn/ui`, không còn `placeholder.ts`.
- [ ] Giao diện tuân thủ đúng bảng màu **SourceLogic Scholarly** ở cả Light mode và Dark mode.
- [ ] Typography phân tách rõ: `Source Serif 4` (tiêu đề & văn bản tài liệu), `Inter` (giao diện điều khiển), `JetBrains Mono` (chỉ số `[N]`, DOI, mã luật `Rxx`).
- [ ] Hiển thị `<DecisionSupportDisclaimer />` đầy đủ, không có từ ngữ gây hiểu lầm là chấm điểm văn phong hay tự động kết luận gian lận.
- [ ] Phân biệt trực quan 5 nhãn Verdict (`rounded-full`) và 7 trạng thái Mapping (`rounded-md`).
- [ ] Tab `Citations` gom nhóm đúng các trích dẫn trùng lặp kèm badge `×N`; tab `References` đánh số `1-based` khớp tuyệt đối với `ref-NNNN`.
- [ ] `CitationDetailDrawer` (`shadcn/ui Sheet`) bẫy focus đúng chuẩn, hiển thị bảng `MetadataDiff` và cho phép Teacher/Admin override kèm lý do.
- [ ] Phân quyền 3 vai trò (`user`, `teacher`, `admin`) qua `useRole()` và `<RoleGate>` hoạt động chặt chẽ; sinh viên không thấy điều khiển override hay trang quản trị.
- [ ] Chuyển đổi ngôn ngữ Việt/Anh (`i18next`) và Sáng/Tối (`ThemeContext`) mượt mà, không dùng `window.location.reload()`.
- [ ] Xuất báo cáo hoạt động đầy đủ ở cả 4 định dạng: `JSON`, `CSV`, `PDF`, `DOCX`.
- [ ] Responsive hoàn chỉnh trên Desktop (`>= 1024px`), Tablet (`768–1023px`) và Mobile (`<= 767px`), mọi nút icon đạt tối thiểu `44×44px`.
- [ ] Khởi chạy toàn bộ hệ thống (`grobid`, `api`, `web`) thành công qua `docker-compose up`.

---

# 16. Brand Direction Cuối Cùng

**SourceLogic — Academic Source Verification, Refined.**

- **Brand:** `SourceLogic` (`[1] → ✓`)
- **Style:** Scholarly Precision Minimal / Citation Debugger Workspace.
- **Core palette:** Slate Canvas `#F8FAFC` / `#020617`, Pure White / Deep Slate Surface `#FFFFFF` / `#0F172A`, Scholarly Indigo `#4F46E5`, cùng 5 màu ngữ nghĩa kiểm chứng (`#10B981`, `#F59E0B`, `#EF4444`, `#64748B`, `#8B5CF6`).
- **Typography:** `Source Serif 4` + `Inter` + `JetBrains Mono`.
- **Campaign headline:** **Verify Every Citation. Trace Every Source.**
- **Supporting line:** *Explainable neuro-symbolic verification for academic integrity.*
- **Workspace (`user`):** Tối giản, tập trung tải bài và xem kết quả kiểm chứng dễ hiểu.
- **Classroom (`teacher`):** Quản lý lớp học, duyệt hàng đợi trích dẫn đáng ngờ và ghi đè kết quả có kiểm toán.
- **Control (`admin`):** Quản lý người dùng, theo dõi sức khỏe hệ thống và nhật ký kiểm toán.
- **Engineering:** React 18, TypeScript, Vite, Tailwind CSS, **shadcn/ui**, TanStack React Query, FastAPI, SQLite FTS5 (127K ACL), GROBID, Docker Compose.

## Chỉ dẫn dành cho AI Coding Agent

1. **Đọc kỹ `CLAUDE.md`, `docs/TEACHER_SYSTEM.md` và `docs/SOURCELOGIC_CONCEPT.md` trước khi chỉnh sửa giao diện.**
2. Xem tài liệu này là **kim chỉ nam về thiết kế UX/UI và kiến trúc component `shadcn/ui`** cho dự án Essay Integrity Checker.
3. Không tự ý thay đổi công thức tính **CIS**, cấu trúc 5 nhãn **Verdict**, 7 trạng thái **Mapping** hoặc các luật suy diễn **Neuro-Symbolic** ở backend.
4. Khi nâng cấp giao diện sang `shadcn/ui`, phải giữ nguyên các `aria-label`, `role`, và cấu trúc dữ liệu trả về từ `web/src/api/client.ts` để không làm gãy hệ thống test.
5. Mọi thao tác bất đồng bộ phải có trạng thái `loading` (`Skeleton` / `Loader2`), `empty` (thông điệp rõ ràng theo từng role) và `error` (`Alert` / `Toast`).
6. Tuân thủ nguyên tắc commit nhỏ, độc lập theo từng task và luôn kiểm chứng bằng `pnpm build` + test trước khi hoàn tất.
