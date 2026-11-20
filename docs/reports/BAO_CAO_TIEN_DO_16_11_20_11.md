# BÁO CÁO TIẾN ĐỘ ĐỒ ÁN TỐT NGHIỆP — GIAI ĐOẠN HOÀN THIỆN & TỐI ƯU TOÀN DIỆN (16/11/2026 – 20/11/2026)

- **Đề tài:** Hệ thống Kiểm chứng Tính Toàn vẹn Trích dẫn Học thuật Neuro-Symbolic (**CITRA** — `v3.76.0` $\rightarrow$ `v3.89.5`)
- **Thời gian:** 5 ngày nước rút (`16/11/2026` – `20/11/2026`)
- **Trọng tâm:** Gia cố bảo mật 3 đợt (RBAC/IDOR/Concurrency), tối ưu 4 trụ cột Neuro-Symbolic Zero-Regression trên `120,000` mẫu không đường tắt đặc trưng, thiết kế mới *Visual Action Studio* cho Giảng viên/Admin, đại tu toàn diện trải nghiệm Non-Tech *Solva Warm Editorial* (WCAG AA + PDPL 2025) và phân mảnh mã nguồn Frontend `< 251 kB`.

---

## 1. BẢNG ĐỐI SÁNH TRƯỚC VÀ SAU GIAI ĐOẠN 16/11 – 20/11/2026

| Hạng mục Nâng cấp | Trước đợt tối ưu (`v3.76.0` — 15/11) | Sau đợt tối ưu (`v3.89.5` — 20/11) | Giá trị Thực tiễn & Học thuật |
| :--- | :--- | :--- | :--- |
| **Thực nghiệm 120K & OOD Zero-Shortcut** | Còn hiện tượng nghẽn thứ tự luật trên DOI lỗi tiêu đề (`M3/M5`), gán sai luận điểm câu tự nhiên và viết tắt tạp chí y sinh (`BMJ`, `JAMA`, `PNAS`). | Triển khai **4 Trụ cột Neuro-Symbolic Zero-Regression**: đạt **`99.02%` ID Accuracy** (`0.9888` Macro-F1, $p = 6.17 \times 10^{-23}$ so với `B5`), **`99.75%` OOD** (`2,394/2,400`), **`100.00%` E2E** (`120/120`), **`0/6,480` cáo buộc oan**. | Củng cố chặt chẽ tính khách quan khoa học cho Chương 5 khóa luận (0% rò rỉ tiêu đề/ID, 0 ép ngưỡng theo nhãn). |
| **Gia cố Bảo mật & Đa luồng (3-Wave Hardening)** | Còn một số ca biên về DOI khu vực thiếu CSL (`JaLC`), cache không tách theo hạn mức gói và tái sử dụng event loop dưới thread-pool. | Xử lý triệt để 6 nhánh độc lập (`Wave 1–3`): `R-DOI-RA-NO-CSL` chuyển sang `UNRESOLVED`, cách ly khóa cache báo cáo theo quota, chống ZIP bomb `.docx` (`100 MB`), khóa phân quyền lớp học theo từng giảng viên & xuất `.zip` sổ điểm chuẩn UTF-8 BOM. | Đảm bảo an toàn vận hành thực tế đa người dùng trên môi trường Production (`citra.io.vn`). |
| **Không gian Giảng viên & Quản trị (*Visual Action Studio*)** | Giao diện bảng chữ dày đặc kiểu IDE kỹ thuật (`*.queue`, `*.json`, `*.log`), nhiều mã luật `R-*` thô ngoài mặt danh sách chờ duyệt. | Chuyển đổi toàn bộ 6 trang (`PendingReviews`, `MyClasses`, `ClassDetail`, `AccountManagement`, `PromoManagement`, `SystemHealth`, `AuditLog`) sang **Visual Action Studio** với duyệt 1 chạm tại chỗ, biểu đồ `DonutChart`/`ScoreRing` và sơ đồ luồng 3 chặng `PipelineStageFlow`. | Giảng viên các ngành Kinh tế, Luật, Nhân văn duyệt bài nộp theo lớp nhanh chóng mà không cần đọc mã kỹ thuật. |
| **Trải nghiệm Non-Tech, Pháp lý & WCAG AA** | Thuật ngữ kỹ thuật (`GROBID`, `ONNX INT8`, `SUSPECTED_HALLUCINATION`) xuất hiện ở mặt tiền; thẻ gói `Pro` đè chữ lên tranh hoa giảm độ tương phản; thiếu trang `/terms`. | Đại tu 4 Phase theo triết lý **Human-First Progressive Disclosure** (ẩn chi tiết kỹ thuật vào ngăn `aria-expanded` / `aria-controls`), bề mặt `.solva-pro-card-surface` đạt chuẩn **WCAG AA Sáng/Tối**, đăng nhập ưu tiên Email, hoàn thiện `/privacy` & `/terms` chuẩn **Luật BVDLCN 91/2025/QH15 & NĐ 356/2025/NĐ-CP**. | Thân thiện tức thì trong 5 giây đầu với người dùng phổ thông nhưng vẫn giữ nguyên 100% chiều sâu giải thích cho Hội đồng chuyên môn. |
| **Kiến trúc Bundle SPA & Chuẩn hóa Tailwind v3.4** | Gói khởi tạo `index-*.js` nặng **`788.24 kB`** (cảnh báo `> 500 kB`), tồn tại `232` vị trí dùng nhầm utility Tailwind v4 không sinh CSS (`shadow-xs`, `backdrop-blur-xs`, `py-0.2`...) và thiếu biến bóng `.dark`. | Dọn sạch 100% `232` vị trí sang chuẩn **Tailwind CSS v3.4**, bổ sung bộ khung xương đồng dạng chống nhảy bố cục (`0px` CLS) & đổ bóng `.dark`, tách chunk không chu trình kéo `index-*.js` xuống **`228.42 kB` (`-71.0%`, `gzip 66.39 kB`)**, toàn bộ **60/60 gói JS `<= 251.00 kB`**. | Tải trang tức thì ở frame `0` trên `/`, `/login`, `/register`; khôi phục độ nổi khối Sáng/Tối trên toàn bộ Workspace và khóa tự động trong CI. |
| **Quy mô Bộ Kiểm thử Tự động** | `2,085` Backend Pytest · `340` Frontend Vitest · `19` Playwright E2E suites. | **`2,197` passed / `2,203` Backend Pytest** (`0` lỗi) · **`472` passed trên `62` file Vitest** · **`20` bộ đặc tả Playwright E2E** (`132+` kịch bản đa thiết bị). | Mọi bất biến từ lõi AI, API, phân quyền đến CSS token & kích thước gói build đều được kiểm tra tự động. |

---

## 2. TÓM TẮT CHI TIẾT 5 CHẶNG KỸ THUẬT ĐÃ HOÀN THÀNH

### 2.1. Gia cố An toàn, Đa luồng & Nghiệp vụ Toàn Hệ thống (`Wave 1–3`, `v3.76` → `v3.80`)
- **Truy xuất & Chống DoS/SSRF:** Bảo vệ `DocxParser` trước tệp nén bất thường (`> 100 MB`), chuẩn hóa `WeakKeyDictionary` theo vòng đời event loop trong `LinkValidator` và `ArxivClient`, cô lập lỗi hủy luồng trong `_CrossLoopSingleflight`, và tách trạng thái `doi_ra_status="registered_no_csl"` để không gán nhầm nhãn ảo giác cho DOI khu vực Nhật Bản/châu Á.
- **Tài khoản, Thanh toán & Lớp học:** Khóa lỗ hổng chiếm trước email chưa kích hoạt khi đăng nhập Google OAuth, bổ sung chế độ `promo_waiver` cho mã giảm giá 100% trên Production, ràng buộc tên lớp duy nhất theo từng giảng viên `(teacher_id, name)` (Migration `0012`) và hoàn thiện xuất gói sổ điểm `.zip` (`gradebook_summary.csv`, `verdicts_detail.csv` chuẩn UTF-8 BOM).

### 2.2. Tối ưu 4 Trụ cột Neuro-Symbolic & Báo cáo Thực nghiệm 120K (`v3.81` → `v3.82.2`)
- **4 Trụ cột Cải tiến (`rules.py`, `semantic.py`, `venue_normalizer.py`):**
  1. Sắp xếp lại độ ưu tiên `R-DOMAIN-EXCEPTION` và bổ sung `R-TITLE-MISMATCH` có cổng đồng thuận tác giả – năm chặt chẽ trước vùng biên `R-ABSTENTION-BORDER`.
  2. Bổ sung cổng đặc trưng từ vựng bất biến động từ `calibrate_monolingual_specificity` (`< 0.2 ms` CPU, `+0 MB` RAM) phát hiện chính xác lỗi gán sai luận điểm (`R-CONTENT-MISMATCH`) trên bài báo thật.
  3. Siết chặt phát hiện DOI ghép chéo cùng miền (`R-CHIMERIC-DOI-MISMATCH`) và miễn trừ bài báo thật bị hỏng liên kết cũ (`link rot`) khỏi nhãn ảo giác.
  4. Mở rộng từ điển chuẩn hóa tên viết tắt tạp chí đa ngành & y sinh (`BMJ`, `JAMA`, `PNAS`, `PLOS ONE`, `Nucleic Acids Research`, `Nature Medicine`...), đưa độ chính xác bộ chuẩn nguyên văn 6 lĩnh vực lên **`120 / 120` (`100.00%`)**.

### 2.3. Thiết kế lại Phân hệ Giảng viên & Quản trị — *Visual Action Studio* (`v3.83`)
- Xây dựng module hướng dẫn song ngữ `web/src/lib/teacherGuidance.ts` và thư viện nguyên tử trực quan nhẹ không phụ thuộc ngoài `web/src/components/ui/studio-visuals.tsx` (`StudioWindowHeader`, `SlidingFilterPills`, `ProportionalBarRow`, `PipelineStageFlow`).
- Nâng cấp toàn bộ 6 màn hình quản lý sang thao tác trực quan 1 chạm (có khóa chống bấm đúp khi đang gửi API và tự động chuẩn hóa nhãn `unresolved` sang `metadata_error` khi giảng viên xác nhận lỗi).

### 2.4. Đại tu UI/UX Toàn trang theo Hướng *Non-Tech Human-First* (`v3.84` → `v3.89.4`)
- Thực thi quy trình kiểm định 3 tác tử độc lập (*Implementer $\rightarrow$ Spec/Code Reviewer $\rightarrow$ Principal UX & Non-Tech Critic*) xuyên suốt 13 tác vụ trên các trang công khai và luồng xác thực (`/`, `/pricing`, `/privacy`, `/terms`, `/login`, `/register`, `/forgot-password`, `404`).
- Chuẩn hóa thương hiệu **CITRA**, gỡ bỏ hoàn toàn các thông tin thử nghiệm trên bản Production (`IS_DEMO_EVALUATOR_MODE`), bổ sung bảng đối sánh gói dịch vụ dạng thẻ chuyển đổi trên di động, tối ưu hiển thị tiếng Việt có dấu trên phông `Sentient` (134/134 ký tự) và giữ mạch trình bày liền lạc từ `SolvaHeroSection` sang `SolvaFilmSection`.

### 2.5. Chuẩn hóa Token Tailwind v3.4, Khung Xương Đồng Dạng & Tối ưu Code-Splitting (`v3.89.5`)
- Rà quét và chuẩn hóa toàn bộ `232` vị trí utility sang chuẩn Tailwind CSS v3.4 trên `39` file giao diện, bổ sung hệ biến đổ bóng `.dark` (`--shadow-sm` $\rightarrow$ `--shadow-xl`) và bộ 3 khung xương đồng dạng (`WorkspaceShellSkeleton`, `AuthPageSkeleton`, `EditorialPageSkeleton`) triệt tiêu hiện tượng nhảy bố cục khi chuyển trang.
- Cấu hình phân tách gói bất tuần hoàn (`vendor`, `query`, `ui`, `i18n`, `motion`, `landing-widgets`, `auth`) trong `web/vite.config.ts` và `web/src/router.tsx`: giảm gói khởi tạo từ `788.24 kB` xuống **`228.42 kB` (`-71.0%`)**, xóa sạch cảnh báo `> 500 kB` và khóa vĩnh viễn bằng bộ test tĩnh `web/src/__tests__/tailwindV3AndBundleHygiene.test.ts`.
- Đồng bộ toàn diện số liệu phiên bản `v3.89.5`, kiến trúc giao diện và kết quả kiểm thử tự động sang quyển Báo cáo Khóa luận Tốt nghiệp LaTeX (`TDTU-MidtermReport/thesis.pdf`, 122 trang, biên dịch `xelatex` `0` lỗi).
