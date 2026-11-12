# Báo Cáo Kiểm Toán & Ghi Nhận Bug Toàn Diện — CITRA (SourceLogic)

- **Ngày kiểm toán:** `2026-11-11`
- **Dự án:** `essay-integrity-checker` — **CITRA (SourceLogic) v3.60.1**
- **Môi trường kiểm thử thực tế (Unmocked Live Stack):**
  - **Backend API:** FastAPI + SQLite/SQLAlchemy (`http://127.0.0.1:8000`)
  - **Frontend SPA:** React 18 + TypeScript + Vite (`http://localhost:5173`)
  - **Trình duyệt tự động:** Playwright Chromium (Interactive Live Audit + Full E2E Suite) ở cả `1440×900` (Desktop) & `375×812` / `430×932` (Mobile), giao diện Sáng (`Light`) & Tối (`Dark`), song ngữ Tiếng Việt (`vi`) & Tiếng Anh (`en`), trên cả 3 vai trò (`admin`, `teacher`, `user`) và khách vãng lai (`anonymous`).
- **Nguyên tắc kiểm toán:** Không chỉnh sửa bất kỳ dòng mã nguồn nào trước khi hoàn tất kiểm thử toàn diện và lập hồ sơ gốc (`git status` sạch 100%).

---

## 1. Kết Quả Chạy Bộ Test Tự Động Cơ Sở (Baseline Test Suites)

| Hạng mục kiểm tra | Lệnh thực thi | Kết quả Baseline | Ghi chú kỹ thuật |
| :--- | :--- | :--- | :--- |
| **Backend Unit Tests** | `.venv/bin/python -m pytest tests/unit/ -q` | **PASS** (`1712 passed, 1 skipped`) | Thời gian chạy `115.37s`, 0 lỗi |
| **Backend Linter** | `.venv/bin/ruff check src/ tests/` | **PASS** (`All checks passed!`) | 0 cảnh báo |
| **Frontend Typecheck** | `cd web && npx tsc -b` | **PASS** (`exit 0`) | 0 lỗi kiểu tĩnh TypeScript |
| **Frontend Unit Tests** | `cd web && npm test` | **PASS kèm Warning** (`37 files, 230 passed`) | Sinh cảnh báo `Warning: An update to SubtleNumber inside a test was not wrapped in act(...)` |
| **Frontend Linter** | `cd web && npm run lint` | **FAIL (`exit 127`)** | `sh: eslint: command not found` — thiếu cấu hình & gói `eslint` (**BUG-04**) |
| **Playwright E2E Suite** | `cd web && npx playwright test` | **PASS** (`158 passed`, `7.6m`) | Bao phủ luồng mocked & live cơ bản nhưng chưa bắt được 11 nhóm lỗi logic/bảo mật/a11y/i18n bên dưới |

---

## 2. Bảng Tổng Hợp Danh Mục Bug Phát Hiện (`BUG-01` → `BUG-11`)

| Mã Bug | Mức độ | Phân hệ | Tóm tắt lỗi | Vị trí mã nguồn gốc (`file:line`) |
| :--- | :---: | :--- | :--- | :--- |
| **BUG-01** | **Critical / High** | Billing & Security | Trang `/billing/success` bỏ qua xác thực phiên thanh toán: truy cập trực tiếp không cần `session_id` hoặc khi API xác thực lỗi vẫn hiển thị `"THANH TOÁN THÀNH CÔNG · STRIPE/VNPAY VERIFIED"` | `web/src/pages/BillingSuccessPage.tsx:52-86` |
| **BUG-02** | **High** | Backend Health Telemetry | `/api/health` trả thông điệp mâu thuẫn `"GROBID container running..."` dù `container_running: false`; `/api/system/health` thiếu trường `services` khiến `/admin/system` mù trạng thái dịch vụ con | `src/integrity_checker/api/routes/health.py:48-60`, `src/integrity_checker/api/routes/system.py:42-54` |
| **BUG-03** | **Medium** | Upload & Admin Telemetry | `UploadPage` gắn cứng `"GROBID v0.9.1 ONLINE"` (kể cả khi GROBID offline), gán nhãn `· GROBID / XML` cho cả file `.docx`/`.bib`/`.ris`, hiển thị `0.00 MB` cho file nhỏ; `SystemHealthPage` lộ khóa thô `snake_case` | `web/src/pages/UploadPage.tsx:394-397, 451, 650, 658`, `web/src/pages/SystemHealthPage.tsx:321, 376-386` |
| **BUG-04** | **High** | Frontend Tooling / CI | Lệnh `npm run lint` thất bại ngay lập tức (`exit 127: eslint: command not found`) do thiếu gói `eslint`, `typescript-eslint` và file cấu hình Flat Config | `web/package.json:11, 31-46` |
| **BUG-05** | **High** | Accessibility (A11y) & Modals | Hai hộp thoại tạo/sửa và xóa mã khuyến mãi trên `/admin/promos` thiếu `role="dialog"`, `aria-modal="true"`, bẫy tiêu điểm (focus trap) và không đóng được bằng phím `Escape` | `web/src/pages/PromoManagementPage.tsx:886-924, 1236-1278` |
| **BUG-06** | **Medium** | Semantic HTML / ARIA | Trang `/pricing` khi đã đăng nhập render thẻ `<main id="pricing-main-content">` lồng bên trong `<main id="main-content">` của `AppLayout` (vi phạm chuẩn HTML5/WCAG landmark) | `web/src/pages/PricingPage.tsx:357`, `web/src/router.tsx:149` |
| **BUG-07** | **Medium** | Pricing Links & Tier Logic | 4 logo nguồn học thuật trên `/pricing` render thẻ `<a>` không có `href`; nút `"Soi chiếu trực tiếp"` trỏ tới neo chết `#interactive-demo` trên `/pricing`; tài khoản `Ultra` vẫn thấy nút `"Upgrade to Pro"` hoạt động (nguy cơ hạ gói trả phí nhầm) | `web/src/components/landing/ScholarlySourceLogos.tsx:12-28`, `web/src/components/landing/SolvaMockupWidgets.tsx:2139-2148`, `web/src/pages/PricingPage.tsx:962-975, 1172-1185, 1231-1246` |
| **BUG-08** | **High** | Typography, Copy-Paste & Screen Reader | Hiệu ứng tách từ trên `AuthSplitShell` và tiêu đề hai tông `SolvaTwoToneHeading` thiếu ký tự khoảng trắng `' '` giữa các `<span>`, làm dính liền chữ khi copy-paste hoặc đọc bằng trình đọc màn hình (`"Xácminhmọitríchdẫn."`, `"integrity.Simple"`) | `web/src/components/AuthSplitShell.tsx:315-355`, `web/src/components/landing/SolvaPrimitives.tsx:413-420` |
| **BUG-09** | **Medium** | Multi-Format Metadata & Badges | File `.bib` và `.ris` bị gắn nhầm nhãn `GROBID TEI` trên `HistoryPage` & `DashboardPage`; `EssayHeader` hiện badge thô `UNKNOWN` khi không có trích dẫn trong bài và sai số nhiều `1 pages` | `web/src/pages/HistoryPage.tsx:274, 289-297`, `web/src/pages/DashboardPage.tsx:111, 404-412`, `web/src/pages/essay/EssayHeader.tsx:214, 220-224` |
| **BUG-10** | **Medium** | Song ngữ i18n (VI ↔ EN) | Trộn lẫn ngôn ngữ: API `/api/essays/sandbox-verify` chèn cứng chuỗi tiếng Việt vào kết quả tiếng Anh; `EssayPage`, `OrphanDetectionPage`, `MyClassesPage`, `SettingsPage` còn nhiều nhãn tiếng Anh cứng ở chế độ `VI`; `AuthSplitShell` ghi cũ `SourceLogic v2.3` | `src/integrity_checker/api/routes/essays.py:2148`, `web/src/pages/EssayPage.tsx`, `web/src/pages/OrphanDetectionPage.tsx`, `web/src/pages/MyClassesPage.tsx`, `web/src/pages/SettingsPage.tsx`, `web/src/components/AuthSplitShell.tsx:272` |
| **BUG-11** | **Low / Medium** | Runtime Console & Test Hygiene | Cảnh báo preload ảnh `/solva/hero-bg.webp` không sử dụng trên mọi trang con; cảnh báo React Router v7 future flags trên mọi lần tải trang; rò rỉ timer `SubtleNumber` gây cảnh báo `act(...)` trong Vitest | `web/index.html:30`, `web/src/router.tsx:249`, `web/src/main.tsx:60`, `web/src/components/ui/transitions.tsx:163-194` |

---

## 3. Phân Tích Kỹ Thuật Chi Tiết Từng Bug

### BUG-01 — Lỗ hổng xác thực trạng thái thanh toán trên `/billing/success`
- **Mức độ nghiêm trọng:** **Critical / High** (Logic thanh toán & tính toàn vẹn biên lai)
- **Các bước tái hiện (Playwright):**
  1. Đăng nhập bằng bất kỳ tài khoản nào (kể cả tài khoản gói `Basic` hoặc tài khoản có giao dịch cũ).
  2. Điều hướng trực tiếp tới `http://localhost:5173/billing/success` (không truyền `?session_id=...` và không có `vnp_*`), **hoặc** truyền `?session_id=forged_invalid_session_999`.
- **Hành vi thực tế:**
  - Giao diện vẫn hiển thị biểu ngữ xanh lục `"THANH TOÁN THÀNH CÔNG · STRIPE VERIFIED"` / `"PAYMENT SUCCEEDED · STRIPE VERIFIED"`, tiêu đề chúc mừng nâng cấp gói và hiển thị biên lai từ giao dịch lịch sử gần nhất (hoặc gói `Basic` hiện tại).
- **Hành vi kỳ vọng:**
  - Nếu truy cập `/billing/success` mà **không có** tham số phiên thanh toán hợp lệ (`session_id` hoặc bộ tham số chữ ký `vnp_SecureHash` + `vnp_TxnRef`), trang phải hiển thị trạng thái thông báo rõ ràng rằng không tìm thấy phiên thanh toán cần xác thực kèm nút quay lại `/pricing` hoặc `/settings`.
  - Nếu `api.verifyCheckoutSession()` hoặc `api.verifyVNPayReturn()` ném lỗi (phiên giả mạo, hết hạn, chữ ký `vnp_SecureHash` sai, hoặc thanh toán thất bại), trang **tuyệt đối không được nuốt lỗi** để hiển thị `"PAYMENT SUCCEEDED"`, mà phải hiển thị trạng thái xác thực thanh toán thất bại kèm thông báo lỗi cụ thể.
- **Nguyên nhân gốc (`file:line`):**
  - `web/src/pages/BillingSuccessPage.tsx:67-86`: Nhánh `else` (khi thiếu cả `vnpParams` lẫn `sessionId`) và khối `catch` (khi `verifyCheckoutSession` / `verifyVNPayReturn` trả lỗi `4xx/5xx`) đều gọi fallback `api.getMySubscription()` mà không đặt cờ lỗi `verificationError`, dẫn đến component render giao diện thành công giả tạo.

---

### BUG-02 — Mâu thuẫn dữ liệu telemetry tại `/api/health` và thiếu `services` tại `/api/system/health`
- **Mức độ nghiêm trọng:** **High** (Độ tin cậy giám sát vận hành hệ thống)
- **Các bước tái hiện:**
  1. Chạy backend khi Docker / container GROBID không bật.
  2. Gọi `GET http://127.0.0.1:8000/api/health` và `GET http://127.0.0.1:8000/api/system/health` (với token `admin`).
- **Bằng chứng thực tế (JSON trả về từ `/api/health`):**
  ```json
  {
    "status": "healthy",
    "grobid": {
      "status": "unhealthy",
      "available": false,
      "message": "GROBID container running but API not responding",
      "container_running": false
    },
    "parser_mode": "regex"
  }
  ```
- **Hành vi thực tế:**
  1. `container_running` là `false` nhưng `message` lại khẳng định `"GROBID container running but API not responding"`.
  2. `/api/system/health` không trả về trường `services` hay `parser_mode`, dù `SystemHealthPage.tsx:40-50` (`summarizeHealth`) được thiết kế để đọc `data.services` nhằm phát hiện dịch vụ bị suy giảm (ví dụ khi container GROBID đang chạy nhưng bị treo API).
- **Hành vi kỳ vọng:**
  1. Tại `health.py`: Kiểm tra `container_running` trước khi kết luận thông điệp `message`. Nếu `container_running is True` → `"GROBID container running but API not responding"`; nếu `container_running is False` → `"GROBID container is not running (using built-in regex parser fallback)"`; nếu Docker CLI không khả dụng (`None`) → `"GROBID API unreachable (using built-in regex parser fallback)"`.
  2. Tại `system.py`: Bổ sung `services` (`database: "ok"`, `cache: "ok"`, `parser: "ok"`, và nếu container GROBID đang bật nhưng treo HTTP thì gắn `grobid: "degraded"`) cùng `parser_mode` (`"grobid"` | `"regex"`) để admin nắm chính xác chế độ parser thực tế mà không báo động giả khi chạy chế độ fallback regex hợp lệ.
- **Nguyên nhân gốc (`file:line`):**
  - `src/integrity_checker/api/routes/health.py:48-60`
  - `src/integrity_checker/api/routes/system.py:42-54`

---

### BUG-03 — Hiển thị sai trạng thái GROBID cứng trên `UploadPage`, kích thước `0.00 MB`, và khóa thô `snake_case` trên `SystemHealthPage`
- **Mức độ nghiêm trọng:** **Medium**
- **Các bước tái hiện (Playwright):**
  1. Đăng nhập và mở `/upload` khi GROBID đang tắt (`parser_mode: "regex"`), chọn một tệp `.bib` dung lượng `1.2 KB` (hoặc `.docx` / `.ris`).
  2. Đăng nhập `admin`, chuyển sang Tiếng Việt (`VI`) và mở `/admin/system`.
- **Hành vi thực tế:**
  - Trên `/upload`: Thanh trạng thái góc phải luôn báo đèn xanh `"GROBID v0.9.1 ONLINE"` bất kể backend đang chạy `regex` hay `grobid`. Khi chọn tệp `.bib` nhỏ (`1.2 KB`), dòng thông tin tệp hiển thị `"0.00 MB · GROBID / XML"` (vừa làm tròn về `0.00 MB`, vừa gắn sai công cụ xử lý cho `.bib`/`.ris`/`.docx`). Ở chế độ Tiếng Việt còn chuỗi lai `"{planTier} PLAN"`.
  - Trên `/admin/system`: Phần thống kê bộ nhớ đệm render trực tiếp khóa kỹ thuật `total_hits`, `avg_hit_count`, `local_papers_count`, `local_queries_count`, `local_hit_rate_percent` và dòng `"{verdicts} total records"` chưa dịch sang Tiếng Việt.
- **Hành vi kỳ vọng:**
  - `UploadPage` truy vấn trạng thái thực tế từ `/api/health` để hiển thị đúng `"GROBID TEI-XML ONLINE"` hoặc `"REGEX PARSER READY"` (fallback an toàn); hiển thị kích thước theo `KB` khi tệp `< 1 MB` (hoặc `< 0.01 MB`); hiển thị đúng nhãn bộ phân tích theo định dạng tệp (`PDF → GROBID / PyMuPDF`, `DOCX → OpenXML`, `BIB → BibTeX Parser`, `RIS → RIS Parser`).
  - `SystemHealthPage` ánh xạ đầy đủ nhãn thân thiện song ngữ VI/EN cho các chỉ số `cache_stats` và dịch `total records`.
- **Nguyên nhân gốc (`file:line`):**
  - `web/src/pages/UploadPage.tsx:394-397, 451, 650, 658`
  - `web/src/pages/SystemHealthPage.tsx:321, 376-386`

---

### BUG-04 — Hỏng hoàn toàn cổng kiểm tra tĩnh `npm run lint` ở Frontend
- **Mức độ nghiêm trọng:** **High** (Đảm bảo chất lượng mã nguồn & CI/CD)
- **Các bước tái hiện:**
  - Chạy `cd web && npm run lint`.
- **Bằng chứng lỗi:**
  ```text
  > integrity-checker-web@2.2.0 lint
  > eslint . --ext ts,tsx
  sh: eslint: command not found (exit code 127)
  ```
- **Nguyên nhân gốc (`file:line`):**
  - `web/package.json:11, 31-46`: Script `"lint"` gọi `eslint` với cờ cũ `--ext ts,tsx` nhưng `devDependencies` hoàn toàn chưa cài đặt `eslint`, `@eslint/js`, `typescript-eslint`, `eslint-plugin-react-hooks`, `globals` và chưa có `web/eslint.config.js`.

---

### BUG-05 — Lỗi Accessibility (WCAG Dialog, Focus Trap & phím `Escape`) trên các Modal của `/admin/promos`
- **Mức độ nghiêm trọng:** **High** (Khả năng tiếp cận bàn phím & chuẩn WAI-ARIA)
- **Các bước tái hiện (Playwright):**
  1. Đăng nhập `admin` → mở `/admin/promos`.
  2. Nhấn nút tạo mã khuyến mãi (`data-testid="create-promo-btn"`) để mở `promo-form-modal`, sau đó nhấn phím `Escape`.
  3. Tương tự, nhấn nút xóa một mã khuyến mãi để mở `promo-delete-modal`, sau đó nhấn phím `Escape`.
- **Hành vi thực tế:**
  - Cả hai modal đều **không đóng** khi nhấn `Escape`, không có `role="dialog"` hay `aria-modal="true"`, và nhấn `Tab` làm tiêu điểm bàn phím thoát ra các nút phía sau lớp nền mờ.
- **Hành vi kỳ vọng:**
  - Cả `promo-form-modal` và `promo-delete-modal` đều sử dụng hook chuẩn sẵn có `useModalA11y` (`src/hooks/useModalA11y.ts`), có `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, tự động khóa tiêu điểm (`Tab` / `Shift+Tab`), đóng ngay khi nhấn `Escape` (trừ khi đang gửi request lưu/xóa), và trả lại focus về nút kích hoạt sau khi đóng.
- **Nguyên nhân gốc (`file:line`):**
  - `web/src/pages/PromoManagementPage.tsx:886-924` và `1236-1278`.

---

### BUG-06 — Thẻ ngữ nghĩa `<main>` bị lồng nhau (`<main><main>`) trên `/pricing` khi người dùng đã đăng nhập
- **Mức độ nghiêm trọng:** **Medium** (Chuẩn HTML5 & trình đọc màn hình)
- **Các bước tái hiện (Playwright):**
  1. Đăng nhập bằng tài khoản bất kỳ (`user`, `teacher`, hoặc `admin`).
  2. Mở `/pricing` và kiểm tra DOM `document.querySelectorAll('main main')`.
- **Hành vi thực tế:**
  - `document.querySelectorAll('main main').length === 1`: `<main id="pricing-main-content">` nằm lồng bên trong `<main id="main-content">` của `AppLayout`. Theo đặc tả HTML5, tài liệu không được có phần tử `<main>` là con cháu của một `<main>` khác.
- **Hành vi kỳ vọng:**
  - Khi hiển thị công khai (`!user`), `PricingPage` dùng `<main id="pricing-main-content">`. Khi hiển thị bên trong `AppLayout` (`Boolean(user)`), container của `PricingPage` render `<div id="pricing-main-content">` để chỉ có duy nhất một landmark `<main>` hợp lệ.
- **Nguyên nhân gốc (`file:line`):**
  - `web/src/pages/PricingPage.tsx:357` kết hợp `web/src/router.tsx:149` (`HybridPricingRoute`).

---

### BUG-07 — Thẻ `<a>` thiếu `href`, neo chết `#interactive-demo`, và logic nút chọn gói `Ultra` trên `/pricing`
- **Mức độ nghiêm trọng:** **Medium** (Điều hướng & UX thanh toán)
- **Các bước tái hiện (Playwright):**
  1. Mở `/pricing` và kiểm tra các liên kết nguồn học thuật trong phần liên hợp CSDL (`Retraction Watch`, `Wayback Machine`, `IETF RFC`, `VN Legal`).
  2. Kiểm tra liên kết `"Soi chiếu trực tiếp"` / `"Inspect live trace"` bên trong widget minh họa trên `/pricing`.
  3. Đăng nhập bằng tài khoản đang ở gói `Ultra` (`user` hoặc `teacher` có `plan_tier: 'ultra'`, `billing_cycle: null` hoặc `'annual'`) rồi mở `/pricing`.
- **Hành vi thực tế:**
  1. `getScholarlySourceUrl()` trả `undefined` cho `Retraction Watch`, `Wayback Machine`, `IETF RFC`, `VN Legal` → `PricingPage.tsx:1231-1246` render `<a target="_blank" rel="noopener noreferrer">` **không có thuộc tính `href`** (thẻ neo chết, không focus được bằng bàn phím).
  2. Liên kết `"Soi chiếu trực tiếp"` trong `SolvaMockupWidgets.tsx:2140` gắn cứng `href="#interactive-demo"`. Khi widget này đặt trên `/pricing`, phần tử `#interactive-demo` không tồn tại (chỉ có trên `/`), khiến cú nhấp chuột không dẫn đi đâu.
  3. Với người dùng đã ở gói `Ultra` (không phải admin): nút `select-pro-btn` vẫn hiển thị `"Nâng cấp lên Pro"` / `"Upgrade to Pro"` và cho phép bấm tạo phiên thanh toán hạ cấp xuống gói thấp hơn; đồng thời nếu `user.billing_cycle` là `null` (tài khoản Ultra được cấp theo học kỳ/phòng lab), nút `select-ultra-btn` vẫn hiện `"Upgrade to Ultra"` thay vì nhận diện đang ở gói `Ultra`.
- **Hành vi kỳ vọng:**
  1. Bổ sung đầy đủ URL chính thức trong `getScholarlySourceUrl()` cho tất cả nguồn học thuật & kỹ thuật (`Retraction Watch`, `Wayback Machine`, `IETF RFC`, `VN Legal`, `Wikidata`, `OpenAIRE`, `HAL`, `Hugging Face`, `OpenLibrary`).
  2. Trên `SolvaMockupWidgets.tsx:2140`, sử dụng `/#interactive-demo` khi không đứng ở trang chủ `/` để điều hướng mượt về trình gỡ lỗi trực tiếp.
  3. Trên `PricingPage.tsx`, nếu người dùng đã ở gói `Ultra`, vô hiệu hóa nút gói `Pro` (hiển thị `"Đã bao gồm trong Ultra"` / `"Included in Ultra"`) và nhận diện đúng trạng thái gói hiện tại trên thẻ `Ultra` khi `billing_cycle` trống hoặc trùng khớp.
- **Nguyên nhân gốc (`file:line`):**
  - `web/src/components/landing/ScholarlySourceLogos.tsx:12-28`
  - `web/src/components/landing/SolvaMockupWidgets.tsx:2139-2148`
  - `web/src/pages/PricingPage.tsx:962-975, 1172-1185, 1231-1246`

---

### BUG-08 — Dính liền từ trong DOM Text / Copy-Paste / Screen Reader trên các tiêu đề tách span
- **Mức độ nghiêm trọng:** **High** (Khả năng đọc máy, SEO & trải nghiệm sao chép văn bản)
- **Các bước tái hiện (Playwright):**
  1. Mở `/login` (hoặc `/register`, `/forgot-password`) và đọc `document.querySelector('h2')?.innerText` hoặc bôi đen sao chép khẩu hiệu bên cột trái.
  2. Mở `/pricing` hoặc `/privacy` và đọc `textContent` của các thẻ tiêu đề `SolvaTwoToneHeading` có cả `primary` và `secondary`.
- **Bằng chứng thực tế:**
  - Trên `/login`: `innerText` trả về `"Xácminhmọitríchdẫn.Truyvếtmọinguồntàiliệu."` (tiếng Việt) và `"Verifyeverycitation.Traceeverysource."` (tiếng Anh) do dùng `mr-[0.26em]` bằng CSS để tạo khoảng cách thị giác nhưng không có text node `' '` trong DOM!
  - Trên `/pricing` & `/privacy`: `SolvaTwoToneHeading` nối sát `primary` và `secondary` thành `"integrity.Simple, predictable pricing."` và `"policy& terms of service."`.
- **Hành vi kỳ vọng:**
  - Chèn khoảng trắng thực `' '` giữa các từ trong `AuthSplitShell` (và bỏ `mr-[0.26em]` dư thừa hoặc dùng khoảng trắng chuẩn giữa các `span` từ) để hiển thị thị giác đẹp tương đương nhưng sao chép & trình đọc màn hình tách từ chính xác 100%.
  - Trong `SolvaTwoToneHeading`, chèn `' '` trước `<span>` của `normalizedSecondary` (chỉ khi `normalizedSecondary` tồn tại để bảo toàn tuyệt đối trường hợp chỉ truyền `primary`).
- **Nguyên nhân gốc (`file:line`):**
  - `web/src/components/AuthSplitShell.tsx:315-355`
  - `web/src/components/landing/SolvaPrimitives.tsx:413-420`

---

### BUG-09 — Gắn sai nhãn `GROBID TEI` cho tệp `.bib`/`.ris`, hiện badge `UNKNOWN` và lỗi số nhiều `1 pages`
- **Mức độ nghiêm trọng:** **Medium** (Độ chính xác hiển thị siêu dữ liệu học thuật)
- **Các bước tái hiện (Playwright):**
  1. Tải lên một tệp danh mục tài liệu tham khảo `.bib` (ví dụ `sample.bib`) tại `/upload` và đợi hoàn tất phân tích.
  2. Mở `/verification/report/:id`, `/history`, và `/dashboard`.
- **Hành vi thực tế:**
  - Trên `/history` và `/dashboard`: Tệp `.bib` và `.ris` bị hiển thị nhãn công nghệ `"GROBID TEI"` do biểu thức điều kiện chỉ kiểm tra `=== 'docx' ? 'WORD DOCX · OPENXML' : 'GROBID TEI'`.
  - Trên `/dashboard`: Phụ đề thẻ tổng tài liệu ghi cứng `"Bản thảo PDF đã phân tích"` / `"Analyzed PDF manuscripts"` dù hệ thống hỗ trợ đa định dạng (`PDF`, `DOCX`, `BibTeX`, `RIS`).
  - Trên `EssayHeader` của báo cáo `.bib`: Hiển thị badge thô `UNKNOWN` (vì tệp `.bib` thuần danh mục không có trích dẫn nội văn để suy đoán chuẩn APA/IEEE) và hiển thị `"1 pages"` (sai ngữ pháp số ít tiếng Anh).
- **Hành vi kỳ vọng:**
  - Phân biệt chính xác 4 định dạng: `PDF → GROBID TEI`, `DOCX → WORD DOCX · OPENXML`, `BIB → BIBTEX · .BIB`, `RIS → RIS · BIBLIOGRAPHY`.
  - Ẩn hoặc hiển thị nhãn thân thiện (`Bibliography` / `Danh mục tham khảo`) thay cho chuỗi thô `UNKNOWN` trên `EssayHeader` & `EssayPage`, và chia đúng số ít/số nhiều `1 page` vs `N pages` (`1 citation` vs `N citations`).
- **Nguyên nhân gốc (`file:line`):**
  - `web/src/pages/HistoryPage.tsx:274, 289-297`
  - `web/src/pages/DashboardPage.tsx:111, 404-412`
  - `web/src/pages/essay/EssayHeader.tsx:214, 220-224`

---

### BUG-10 — Rò rỉ chuỗi khác ngôn ngữ (VI ↔ EN) trên Sandbox API và một số màn hình con
- **Mức độ nghiêm trọng:** **Medium** (Tính nhất quán song ngữ học thuật)
- **Các điểm phát hiện cụ thể:**
  1. **Backend Quick-Paste Sandbox (`src/integrity_checker/api/routes/essays.py:2148`):** Luôn gán cứng ghi chú tiếng Việt `"Kiểm tra trực tiếp danh mục tham khảo."` vào `layer1_statuses`, khiến giao diện Tiếng Anh (`EN`) trên `/sandbox` hiển thị câu giải thích nửa Anh nửa Việt: `"... Layer 1: Kiểm tra trực tiếp danh mục tham khảo."`.
  2. **`OrphanDetectionPage.tsx:134, 175, 283, 289, 301, 326`:** Ở chế độ Tiếng Việt (`VI`), vẫn hiện cứng tiếng Anh `"No Reference"`, `"Uncited"`, `"Error:"`, `"← Back to Reports"`, `"Loading citation data..."`, `"Citation Consistency · {n} entries analyzed"`.
  3. **`MyClassesPage.tsx:64, 190`:** Ở chế độ Tiếng Việt (`VI`), hiện cứng `"{n} ACTIVE COHORTS"`, `"SYNCING..."`, `"{n} cohorts"`.
  4. **`EssayPage.tsx:2099-2104, 2276-2286, 2393, 2659-2755`:** Ở chế độ Tiếng Việt (`VI`), các chip lọc (`All`, `✓ Verified`, `⚠ Metadata`, `✕ Hallucination`, `— Other`), nhãn `Conf:`, dòng tóm tắt `Citation Integrity Score (CIS): ... citations` và tiêu đề/trạng thái bảng đối chiếu Metadata (`Field`, `Cited in Manuscript`, `Canonical Retrieved`, `Status`, `100% Match`, `Diff`, `No canonical record found`) chưa được bản địa hóa sang Tiếng Việt như trên `LandingPage` và `LogicTracePage`.
  5. **`SettingsPage.tsx:873, 906-909` & `AuthSplitShell.tsx:272`:** Nút sao chép khóa API và trạng thái sử dụng khóa (`Copy` / `Copied!`, `Last used:`, `Never used`) chưa dịch theo ngôn ngữ; chân trang `AuthSplitShell` ghi phiên bản cũ `"SourceLogic v2.3"` thay vì đồng bộ `APP_VERSION` (`v3.60.1`).

---

### BUG-11 — Cảnh báo Console trình duyệt (Unused Preload, React Router v7 Flags) & Rò rỉ Timer `act(...)` trong Vitest
- **Mức độ nghiêm trọng:** **Low / Medium** (Hiệu năng tải tài nguyên & độ sạch Console/Test)
- **Chi tiết kỹ thuật:**
  1. **Unused Image Preload (`web/index.html:29-30`):** `<link rel="preload" as="image" href="/solva/hero-bg.webp" fetchpriority="high" />` được nạp cưỡng bức trên **mọi route** của SPA. Khi người dùng vào thẳng `/dashboard`, `/upload`, `/verification/report/:id` hoặc `/billing/checkout`, trình duyệt tải ảnh nền lớn của trang chủ vô ích và phát cảnh báo: *"The resource http://localhost:5173/solva/hero-bg.webp was preloaded using link preload but not used within a few seconds from the window's load event."*
  2. **React Router Future Flags (`web/src/router.tsx:249` & `web/src/main.tsx:60`):** Thiếu cấu hình `future={{ v7_relativeSplatPath: true, v7_fetcherPersist: true, v7_normalizeFormMethod: true, v7_partialHydration: true, v7_skipActionErrorRevalidation: true }}` trên `createBrowserRouter` và `future={{ v7_startTransition: true }}` trên `<RouterProvider>`, sinh 2 cảnh báo vàng trên Console ở mọi trang và trong toàn bộ log chạy Vitest.
  3. **Vitest `act(...)` Warning (`web/src/components/ui/transitions.tsx:163-194`):** `SubtleNumber` kích hoạt `requestAnimationFrame` + `setTimeout(..., 240)` khi giá trị số thay đổi trong môi trường kiểm thử JSDOM (nơi không có CSS animation thực), gây cập nhật state sau khi assertion kết thúc và in cảnh báo `Warning: An update to SubtleNumber inside a test was not wrapped in act(...)`.

---

## 4. Các Chức Năng Cốt Lõi Đã Kiểm Chứng Hoạt Động Tốt (Không Lỗi)

Để đảm bảo phạm vi sửa lỗi tập trung chính xác và không làm xáo trộn các thành phần ổn định, các luồng sau đã được kiểm chứng thực tế trên Playwright và hoạt động chuẩn xác:
- **Xác thực & Phân quyền (RBAC):** Đăng nhập, đăng ký (kèm đồng ý bảo vệ dữ liệu cá nhân NĐ 13/2023 & Luật BVDLCN), quên mật khẩu, phân tách quyền `user` / `teacher` / `admin` và chuyển hướng bảo vệ route (`/admin/*`, `/teacher/*`).
- **Luồng Tải lên & Kiểm chứng Thực tế:** Tải tệp thực → màn hình tiến trình thời gian thực `/verification/processing/:id` → báo cáo đầy đủ `/verification/report/:id` + 4 trang chuyên sâu (`/issues`, `/trace`, `/document`, `/consistency`) → xóa bản thảo (`DELETE /api/essays/:id` trả `200 OK`).
- **1-Click Auto-Fix Studio & Xuất Báo cáo:** Xuất chuẩn hóa `BibTeX` / `RIS` / `APA` / `IEEE` / `TDTU`, tải báo cáo `JSON`, `CSV`, `PDF`, `DOCX`, `Auto-Healed .DOCX`, tạo liên kết chia sẻ biên lai số kèm mã QR công khai (`/verify/share/:token`).
- **Quy tắc Mã Khuyến Mãi 6 Ký Tự (`^[A-Z0-9]{6}$`):** Đồng nhất giữa `billing.py:55` và `PromoManagementPage.tsx:48`, áp dụng mã hợp lệ (`TDTU50`) và từ chối mã sai định dạng chính xác trên trang Checkout.
- **Quản lý Lớp học & Kiểm toán Học thuật:** Tạo lớp, tham gia lớp bằng mã 6 ký tự, xuất điểm `CSV` lớp học, hàng đợi duyệt của giảng viên (`/teacher/reviews`), ghi đè nhãn phán quyết kèm nhật ký kiểm toán (`/admin/audit`).

---

## 5. Kết Quả Khắc Phục & Hậu Kiểm Toàn Diện (`100% Đã Khắc Phục`)

Toàn bộ **11/11 nhóm bug (`BUG-01` → `BUG-11`)** đã được triển khai sửa triệt để theo kế hoạch chi tiết tại `docs/superpowers/plans/2026-11-11-full-bugfix-plan.md` và vượt qua 100% cổng kiểm định tự động + trình duyệt thực tế:

| Hạng mục hậu kiểm | Lệnh / Công cụ kiểm chứng | Kết quả sau khi sửa | So với Baseline |
| :--- | :--- | :--- | :--- |
| **Backend Unit + Integration Tests** | `.venv/bin/python -m pytest tests/unit/ tests/integration/test_api.py tests/integration/test_auth.py -q` | **PASS** (`1733 passed, 1 skipped, 0 failed`) | `+3` unit tests mới cho `/api/health`, `/api/system/health` & `/api/essays/sandbox/verify` |
| **Backend Linter** | `.venv/bin/ruff check src/ tests/` | **PASS** (`All checks passed!`) | `0` lỗi, `0` cảnh báo |
| **Frontend Typecheck** | `cd web && npx tsc -b` | **PASS** (`0 errors`) | `0` lỗi kiểu tĩnh TypeScript |
| **Frontend Linter** | `cd web && npm run lint` | **PASS** (`0 errors`) | Khắc phục từ `FAIL (exit 127)` + dọn sạch `19` lỗi lint tiềm ẩn |
| **Frontend Unit Tests** | `cd web && npm test` | **PASS** (`38 test files, 247 passed, 0 failed`) | `+17` regression tests mới; triệt tiêu hoàn toàn cảnh báo `act(...)` và React Router v7 warnings |
| **Production Build** | `cd web && npm run build` | **PASS** (`✓ built in 2.12s`) | Đóng gói sạch 100% |
| **Playwright Full E2E Suite** | `cd web && npx playwright test` | **PASS** (`161 passed, 0 failed`, `7.7m`) | `+3` kịch bản E2E chuyên biệt (`audit-bugfixes-2026-11-11.spec.ts`) kiểm chứng trực tiếp `BUG-01` → `BUG-11` |
| **Playwright Live Interactive Audit** | Playwright MCP (`1440×900` & `375×812`, `Light`/`Dark`, `VI`/`EN`) | **PASS** (`Errors: 0, Warnings: 0`) | `0` lỗi/cảnh báo Console, `0` thẻ `<main>` lồng nhau, `0` liên kết rỗng, `0` tràn ngang Mobile |

