# Báo Cáo Rà Soát & Kế Hoạch Tối Ưu Hiệu Năng (Performance) và SEO Toàn Diện — CITRA (`SourceLogic`)

Tài liệu này chuyển hóa mô hình **5 tầng kỹ thuật tối ưu (Frontend, Caching & Async, In-Memory/Local FTS5 Search, Database & ORM, Hạ tầng & Mạng)** cùng bộ tiêu chuẩn **Technical SEO & Structured Data** từ hệ thống tham chiếu `aevo.io.vn` sang kiến trúc thực tế của đồ án **CITRA (`essay-integrity-checker`)**, nhằm chuẩn bị cho việc triển khai Production mượt mà, phản hồi tức thì (TTFB & API latency thấp nhất) trên máy chủ cấu hình vừa phải (như `e2-medium` / VPS 2 vCPU, 4–8 GB RAM).

---

## 0. Nguyên Tắc Ràng Buộc ("Guardrails") Khi Tối Ưu Production

Trước khi áp dụng bất kỳ tối ưu nào, các nguyên tắc bất di bất dịch sau phải được đảm bảo:

1. **Giữ nguyên 100% logic nghiệp vụ 2 lớp (Two-Layer Orthogonal Output Model) và tập luật `R01–R12`:**
   - Không làm thay đổi kết quả phân loại `CitationMappingStatus` (Layer 1), `ValidationLabel` (Layer 2) hay điểm `CIS (Citation Integrity Score)`.
2. **Giữ nguyên cấu trúc `document.title` (`getDocumentTitle` → `CITRA - ...`) và toàn bộ `data-testid` / UI tekst:**
   - Bộ kiểm thử Vitest và Playwright E2E đang kiểm tra định dạng tiêu đề qua hàm [`getDocumentTitle`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/web/src/router.tsx#L110-L117). Mọi nâng cấp SEO Metadata (`OpenGraph`, `Twitter Card`, `Canonical`, `JSON-LD`, `robots`) **phải giữ nguyên `document.title`** hiện có.
3. **Đảm bảo 100% bộ kiểm thử hiện tại (`1,251` backend tests & toàn bộ frontend tests) PASS tuyệt đối:**
   - Mọi thay đổi ở tầng Caching, SQL Batching hoặc React Hooks (`useEssayPolling`, `useEssayReport`) phải tương thích ngược hoàn toàn với các unit/integration test hiện có.

---

## Tổng Quan Đối Chiếu 5 Tầng Kỹ Thuật (`aevo.io.vn` $\rightarrow$ `CITRA`)

| Tầng kỹ thuật | Giải pháp bên `aevo.io.vn` | Áp dụng thực tế cho `CITRA (essay-integrity-checker)` |
| :--- | :--- | :--- |
| **1. Tầng Frontend** | Khử Double-Fetching (SSR/CSR), `next/dynamic` Code Splitting, tối ưu ảnh LCP/CLS (`fetchPriority="high"`, `decoding="async"`). | • **Đồng bộ Cache đa tab (`useEssayPolling` $\leftrightarrow$ `TanStack Query`):** Khử hoàn toàn việc gọi lại `GET /api/essays/:id/report` mỗi khi chuyển qua lại giữa 5 tab (`Overview`, `Issues`, `Logic Trace`, `Document Inspector`, `Consistency`).<br>• **Tối ưu Vite Code Splitting (`manualChunks`):** Tách riêng `vendor`, `query`, `i18n`, `ui` để tăng tỷ lệ cache hit trình duyệt.<br>• **Tối ưu LCP/CLS:** Thêm `fetchPriority="high"`, `decoding="async"`, `width`/`height` tường minh cho ảnh/logo trên trang chủ & Header. |
| **2. Tầng Caching & Bất đồng bộ** | Read-Through Cache trên RAM (< 1ms) + Event-driven Cache Invalidation + Non-blocking background tasks. | • **Read-Through In-Memory TTL Cache + Event Invalidation:** Cache trên RAM cho các endpoint tổng hợp nặng (`/api/system/health`, `/api/cache/stats`, thống kê `local_papers.db` 127K+ bài báo) với thời gian phản hồi **< 1ms**, tự động invalidate ngay khi upload/xóa bài, override verdict hoặc xóa cache.<br>• **Non-blocking Pipeline Executor:** Giữ luồng upload PDF bất đồng bộ qua `BackgroundTasks` + `run_in_executor` để không bao giờ chặn HTTP event loop. |
| **3. Tầng Tìm kiếm Học thuật (BM25 + Fuzzy)** | In-Memory Inverted Index + BM25 + Fuzzy Search thay vì chạy cụm tìm kiếm nặng nề. | • **SQLite FTS5 Inverted Index (`bm25(papers_fts)`) + In-Memory Seminal Whitelist:** Tối ưu khởi tạo `LocalDatabase` (tránh chạy lại `INIT_STATEMENTS` và `PRAGMA journal_mode` ở mỗi lần gọi), kết hợp `PRAGMA mmap_size` và `cache_size` giúp truy vấn BM25 trên 127,000+ bài báo ACL Anthology đạt **1–5ms**. |
| **4. Tầng Cơ sở dữ liệu & ORM** | Hệ thống B-Tree Composite Indexes chiến lược + SQL Aggregation (`GROUP BY`/`DISTINCT`) + Khử N+1 Query. | • **Bổ sung hệ thống B-Tree Composite Indexes** vào [`models.py`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/db/models.py) & [`session.py`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/db/session.py) cho `essays`, `verdicts`, `citations`, `audit_logs`, `users`.<br>• **Khử triệt để lỗi N+1 Query** tại [`teacher.py`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/api/routes/teacher.py) và [`repository.py`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/db/repository.py) (`list_my_classes`, `teacher_dashboard`, `list_class_essays`, `list_pending_reviews`, `export_class_csv`) bằng Batch Query & SQL `GROUP BY`. |
| **5. Tầng Hạ tầng, Mạng & SEO** | Docker Bridge Network nội bộ (< 1ms), Nginx Gzip (mức 6) + HTTP/1.1 Keep-Alive, `robots.txt`, `sitemap.xml`, `OpenGraph`, `JSON-LD`. | • **Nginx Reverse Proxy + FastAPI `GZipMiddleware`:** Bật `gzip_comp_level 6`, cấu hình HTTP/1.1 `keepalive` giữa Nginx và container `api:8000`, thêm `GZipMiddleware` cho FastAPI.<br>• **Technical SEO & Rich Snippets:** Bổ sung `robots.txt`, `sitemap.xml`, `OpenGraph`, `Twitter Card`, `Canonical`, `JSON-LD (SoftwareApplication & WebSite)` trong [`web/index.html`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/web/index.html) và đồng bộ thẻ `meta[name="robots"]` + `<html lang>` theo route. |

---

## CHI TIẾT CÁC ĐIỂM NGHẼN & GIẢI PHÁP KỸ THUẬT THEO 4 PHASE TRIỂN KHAI

---

### PHASE 1: TỐI ƯU FRONTEND — KHỬ RE-FETCH ĐA TAB, CHIA NHỎ BUNDLE & TỐI ƯU LCP/CLS

#### 1.1. Khử tình trạng gọi lại API trùng lặp khi chuyển Tab báo cáo (`useEssayPolling` $\leftrightarrow$ `TanStack Query`)
* **Hiện trạng:**
  - Một báo cáo kiểm chứng có 5 màn hình con:
    1. `/verification/report/:id` ([`EssayPage.tsx`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/web/src/pages/EssayPage.tsx)) $\rightarrow$ dùng [`useEssayReport`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/web/src/hooks/useEssayReport.ts) (lưu vào TanStack Query với key `['essay-report', essayId]`).
    2. `/verification/report/:id/consistency` ([`OrphanDetectionPage.tsx`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/web/src/pages/OrphanDetectionPage.tsx)) $\rightarrow$ dùng [`useOrphanReport`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/web/src/hooks/useOrphanReport.ts) (cùng key `['essay-report', essayId]`).
    3. `/verification/report/:id/issues` ([`IssuesPage.tsx`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/web/src/pages/IssuesPage.tsx)) $\rightarrow$ dùng [`useEssayPolling`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/web/src/hooks/useEssayPolling.ts).
    4. `/verification/report/:id/trace` ([`LogicTracePage.tsx`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/web/src/pages/LogicTracePage.tsx)) $\rightarrow$ dùng [`useEssayPolling`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/web/src/hooks/useEssayPolling.ts).
    5. `/verification/report/:id/document` ([`DocumentInspectorPage.tsx`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/web/src/pages/DocumentInspectorPage.tsx)) $\rightarrow$ dùng [`useEssayPolling`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/web/src/hooks/useEssayPolling.ts).
  - Do [`useEssayPolling.ts`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/web/src/hooks/useEssayPolling.ts) chỉ dùng `useState` cục bộ và bỏ qua `queryClient`, mỗi lần người dùng bấm chuyển qua lại giữa các tab `Issues`, `Logic Trace`, `Document Inspector`, trình duyệt lại gọi mới `GET /api/essays/:id/report` (payload JSON lớn) và hiển thị spinner chờ tải lại từ đầu.
* **Giải pháp:**
  - Trong [`useEssayPolling.ts`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/web/src/hooks/useEssayPolling.ts), kiểm tra cache của `queryClient` tại key `['essay-report', essayId]` (nếu có dữ liệu hợp lệ `Array.isArray(cached.verdicts)` và chưa bị invalidate) để trả về ngay tức thì (**0ms, 0 request phụ**).
  - Khi `useEssayPolling` tải xong báo cáo đầy đủ (`Array.isArray(data.verdicts)`), tự động ghi vào `queryClient.setQueryData(['essay-report', essayId], data)` để `EssayPage` và `OrphanDetectionPage` tái sử dụng ngay lập tức.
  - Khi giảng viên Override Verdict (`useOverrideVerdict`), xóa/invalidate cache `['essay-report']` để mọi tab luôn nhận dữ liệu mới nhất.

#### 1.2. Tối ưu Code Splitting (`manualChunks`) trong [`web/vite.config.ts`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/web/vite.config.ts)
* **Hiện trạng:**
  - `manualChunks` mới chỉ tách `vendor` (`react`, `react-dom`, `react-router-dom`) và 4 gói UI. Các thư viện `@tanstack/react-query`, `i18next`, `react-i18next` và các gói `@radix-ui/*` còn lại vẫn bị gộp chung.
* **Giải pháp:**
  - Tách rõ các chunk độc lập: `vendor` (React core), `query` (`@tanstack/react-query`), `i18n` (`i18next`, `react-i18next`), và `ui` (toàn bộ `@radix-ui/*` + `lucide-react`).

#### 1.3. Tối ưu Hình ảnh & Core Web Vitals (LCP, CLS)
* **Giải pháp:**
  - Bổ sung `decoding="async"` và `fetchPriority="high"` cho logo thương hiệu ở [`LandingPage.tsx`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/web/src/pages/LandingPage.tsx) và [`AppLayout.tsx`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/web/src/components/AppLayout.tsx), kèm kích thước `width`/`height` tường minh để triệt tiêu **CLS (Cumulative Layout Shift)**.

---

### PHASE 2: TỐI ƯU DATABASE, KHỬ N+1 QUERY & BỔ SUNG IN-MEMORY READ-THROUGH CACHE

#### 2.1. Bổ sung hệ thống Composite B-Tree Indexes vào [`models.py`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/db/models.py) & [`session.py`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/db/session.py)
* **Hiện trạng:**
  - Các bảng chính trong `app.db` mới chỉ có index đơn cột trên khóa ngoại (`user_id`, `class_id`, `essay_id`, `verdict_id`), chưa có **Composite Index** cho các tổ hợp lọc + sắp xếp thường xuyên.
* **Giải pháp — Bổ sung các Composite Indexes chiến lược (tự động migrate cho cả DB hiện hữu):**
  - `essays`:
    - `idx_essays_user_uploaded` trên `(user_id, uploaded_at)` $\rightarrow$ Tăng tốc danh sách bài nộp của sinh viên theo thời gian.
    - `idx_essays_class_uploaded` trên `(class_id, uploaded_at)` $\rightarrow$ Tăng tốc truy vấn bài nộp theo lớp học.
    - `idx_essays_user_filename` trên `(user_id, filename)` $\rightarrow$ Tăng tốc gom nhóm khử trùng lặp (`get_all_essays_deduped`).
    - `idx_essays_uploaded_at` trên `(uploaded_at)` $\rightarrow$ Tăng tốc trang quản trị / lịch sử toàn cục.
  - `verdicts`:
    - `idx_verdicts_essay_override_label` trên `(essay_id, is_overridden, label)` $\rightarrow$ Đưa truy vấn hàng đợi duyệt của giảng viên (`Pending Reviews`) từ quét bảng $O(N)$ xuống $O(\log N)$.
    - `idx_verdicts_label` trên `(label)` $\rightarrow$ Tăng tốc `GROUP BY label` tại trang System Health.
  - `citations`:
    - `idx_citations_essay_type` trên `(essay_id, citation_type)` $\rightarrow$ Tăng tốc đếm `in_text` / `numeric` vs `reference_list`.
  - `audit_logs`:
    - `idx_audit_logs_user_logged` trên `(user, logged_at)` và `idx_audit_logs_logged_at` trên `(logged_at)`.
  - `users`:
    - `idx_users_role_username` trên `(role, username)` $\rightarrow$ Tăng tốc tìm danh sách sinh viên (`role = 'user'`) và thống kê theo role.

#### 2.2. Khử triệt để lỗi N+1 Query tại [`teacher.py`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/api/routes/teacher.py) & [`repository.py`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/db/repository.py)
* **Hiện trạng:**
  1. `GET /api/teacher/classes` & `GET /api/teacher/dashboard`: Với mỗi lớp học, `_class_to_response` gọi riêng lẻ `repo.count_students_in_class(cls.id)` và `repo.get_user_by_id(cls.teacher_id)` trong vòng lặp.
  2. `GET /api/teacher/classes/{class_id}/essays`: Chạy vòng lặp `for essay in essays: repo.get_user_by_id(essay.user_id)` (N+1 query).
  3. `GET /api/teacher/classes/{class_id}/pending-reviews`: Chạy vòng lặp `for v in verdicts:` gọi `repo.get_essay(v.essay_id)` rồi `repo.get_user_by_id(essay.user_id)` ($2 \times N$ queries).
  4. `GET /api/teacher/classes/{class_id}/export.csv`: Chạy vòng lặp gọi `get_user_by_id` và `get_verdicts` cho từng bài nộp ($2 \times N$ queries).
* **Giải pháp:**
  - Bổ sung các hàm Batch Loading (`get_users_by_ids`, `get_essays_by_ids`, `count_students_by_class_ids`, `get_verdicts_by_essay_ids`) sử dụng mệnh đề `WHERE id IN (...)` và `GROUP BY`, giảm số lượng câu truy vấn từ $O(N)$ về hằng số **1–2 queries** cố định.

#### 2.3. Tối ưu Tầng Tìm Kiếm Học Thuật FTS5 (`local_papers.db`) & Read-Through Cache trên RAM
* **Hiện trạng:**
  - Mỗi lần khởi tạo `LocalDatabase()`, phương thức `_init_db()` lại chạy lại toàn bộ 7 câu lệnh `CREATE TABLE/INDEX/TRIGGER IF NOT EXISTS` và `PRAGMA` trên file `local_papers.db` (~127,000 bài báo).
  - Mỗi lần Admin mở System Health (`/api/system/health`) hoặc `/api/cache/stats`, `Repository.get_cache_stats()` lại quét `COUNT(*)` và `GROUP BY source` trên toàn bộ 127,000+ dòng của `local_papers.db`.
* **Giải pháp:**
  - Lưu trạng thái đã khởi tạo schema theo đường dẫn file (`_INITIALIZED_DB_PATHS`) trong [`local_db.py`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/database/local_db.py) để chỉ chạy DDL 1 lần duy nhất cho mỗi file DB, đồng thời bổ sung `PRAGMA cache_size=-32000` (32MB RAM page cache) giúp FTS5 BM25 hoạt động hoàn toàn trên RAM.
  - Xây dựng lớp **Read-Through TTL Cache trên RAM** (30 giây) kèm hàm `invalidate_stats_cache()` khi có thay đổi dữ liệu (`clear_cache`, `add_paper`, `dedupe`), giảm thời gian phản hồi `/api/system/health` và `/api/cache/stats` xuống **< 1ms**.

---

### PHASE 3: TỐI ƯU TECHNICAL SEO, STRUCTURED DATA (JSON-LD), SITEMAP & ROBOTS

#### 3.1. Bổ sung `robots.txt` và `sitemap.xml` chuẩn Production
* **Hiện trạng:**
  - Thư mục [`web/public/`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/web/public) hiện mới chỉ có các file icon (`favicon.ico`, `favicon.png`, `apple-touch-icon.png`, `citra-logo.png`), **chưa có** `robots.txt` và `sitemap.xml`.
* **Giải pháp:**
  - Tạo `web/public/robots.txt`: Cho phép Googlebot index trang chủ công khai (`Allow: /$`), và chặn thu thập dữ liệu (`Disallow`) toàn bộ các đường dẫn nội bộ/xác thực (`/dashboard`, `/upload`, `/batch-upload`, `/verification/`, `/history`, `/profile`, `/settings`, `/admin/`, `/teacher/`, `/api/`).
  - Tạo `web/public/sitemap.xml`: Khai báo URL chuẩn của nền tảng CITRA với độ ưu tiên `priority: 1.0`.

#### 3.2. Làm giàu Metadata (`OpenGraph`, `Twitter Card`, `Canonical`, `Keywords`) & JSON-LD Rich Snippets trong [`web/index.html`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/web/index.html)
* **Hiện trạng:**
  - [`web/index.html`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/web/index.html) hiện chỉ có 15 dòng cơ bản, thiếu toàn bộ thẻ `description`, `keywords`, `OpenGraph`, `Twitter Card`, và `JSON-LD Schema.org`.
* **Giải pháp:**
  - Bổ sung đầy đủ bộ thẻ chuẩn SEO học thuật (`description`, `keywords`, `author`, `theme-color`, `og:title`, `og:description`, `og:type`, `og:image`, `og:locale`, `twitter:card`, `twitter:title`, `twitter:description`, `twitter:image`).
  - Nhúng `<script type="application/ld+json">` với 2 schema chuẩn `Schema.org`:
    1. **`SoftwareApplication`** (`applicationCategory: "EducationalApplication"`, `operatingSystem: "Web"`, mô tả hệ thống kiểm chứng trích dẫn Neuro-Symbolic 2 lớp).
    2. **`WebSite`** & **`Organization`** (`CITRA — SourceLogic Academic Integrity Platform`).
  - Trong [`web/src/router.tsx`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/web/src/router.tsx): Giữ nguyên 100% `document.title = getDocumentTitle(pathname)` (để vượt qua mọi bài test), đồng thời tự động cập nhật `<meta name="robots" content="index, follow">` cho trang chủ `/` và `"noindex, nofollow"` cho các trang chức năng nội bộ.

---

### PHASE 4: TỐI ƯU HẠ TẦNG, MẠNG & NÉN HTTP (NGINX KEEP-ALIVE, GZIP & FASTAPI)

#### 4.1. Nâng cấp cấu hình Nginx Production ([`web/nginx.conf`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/web/nginx.conf))
* **Hiện trạng:**
  - Đã bật `gzip on` nhưng thiếu `gzip_comp_level 6` và thiếu `font/woff2`, `application/manifest+json` trong `gzip_types`.
  - Chưa cấu hình `proxy_set_header Connection ""` để tái sử dụng kết nối HTTP/1.1 Keep-Alive tới backend `api:8000`.
  - Các tài nguyên tĩnh ở gốc (`/citra-logo.png`, `/favicon.png`, `/apple-touch-icon.png`) chưa có header cache dài hạn.
* **Giải pháp:**
  - Bổ sung `gzip_comp_level 6;` và mở rộng `gzip_types`.
  - Thêm `proxy_set_header Connection "";` và `proxy_buffering on;` cho khối `location /api/`.
  - Thêm rule cache cho các file ảnh/icon tĩnh và đảm bảo `robots.txt` / `sitemap.xml` được phục vụ trực tiếp với đúng `Content-Type`.

#### 4.2. Bật nén `GZipMiddleware` trực tiếp trên FastAPI ([`src/integrity_checker/api/main.py`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/api/main.py))
* **Hiện trạng:**
  - Khi gọi trực tiếp container `api:8000` (hoặc môi trường không qua Nginx), JSON báo cáo phân tích (`/api/essays/{id}/report`) có thể nặng từ 100KB đến >500KB nhưng chưa được nén Gzip.
* **Giải pháp:**
  - Đăng ký `app.add_middleware(GZipMiddleware, minimum_size=1000)` trong `create_app()` tại [`main.py`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/api/main.py), giúp giảm **75% – 85%** dung lượng truyền tải JSON API trên mọi môi trường.

---

## BẢNG TỔNG HỢP LỘ TRÌNH THỰC THI (4 PHASES)

| Phase | Hạng mục triển khai | File tác động chính | Tác động kỳ vọng | Rủi ro lệch Test / Flow |
| :---: | :--- | :--- | :--- | :---: |
| **Phase 1** | Đồng bộ Cache đa tab (`useEssayPolling` $\leftrightarrow$ `queryClient`), tối ưu Vite `manualChunks`, tối ưu ảnh LCP/CLS | [`useEssayPolling.ts`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/web/src/hooks/useEssayPolling.ts), [`useEssayReport.ts`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/web/src/hooks/useEssayReport.ts), [`vite.config.ts`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/web/vite.config.ts), [`LandingPage.tsx`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/web/src/pages/LandingPage.tsx) | Chuyển tab báo cáo **0ms** (giảm 100% request thừa khi đổi tab), giảm First Load JS | **0%** |
| **Phase 2** | Thêm B-Tree Composite Indexes, khử N+1 Query ở `teacher.py` & `repository.py`, thêm In-Memory TTL Cache & tối ưu `LocalDatabase` FTS5 | [`models.py`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/db/models.py), [`session.py`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/db/session.py), [`repository.py`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/db/repository.py), [`teacher.py`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/api/routes/teacher.py), [`local_db.py`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/database/local_db.py) | Truy vấn DB từ $O(N)$ xuống $O(\log N)$, khử N+1 ở Teacher Dashboard, `/api/system/health` < 1ms | **0%** |
| **Phase 3** | Bổ sung `robots.txt`, `sitemap.xml`, `OpenGraph`, `Twitter Card`, `JSON-LD` (`SoftwareApplication` + `WebSite`), dynamic `meta[name="robots"]` | [`web/index.html`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/web/index.html), `web/public/robots.txt`, `web/public/sitemap.xml`, [`web/src/router.tsx`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/web/src/router.tsx) | Đạt chuẩn SEO & Rich Snippets trên Google Search, chặn index các trang nội bộ | **0%** (Giữ nguyên `getDocumentTitle`) |
| **Phase 4** | Nâng cấp Nginx (`gzip_comp_level 6`, Keep-Alive, static caching) & bật FastAPI `GZipMiddleware` | [`web/nginx.conf`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/web/nginx.conf), [`src/integrity_checker/api/main.py`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/api/main.py) | Giảm 75%–85% băng thông JSON & JS/CSS, giữ kết nối Keep-Alive ổn định | **0%** |
