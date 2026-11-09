# ĐÁNH GIÁ HIỆN TRẠNG ĐỒ ÁN KỸ THUẬT PHẦN MỀM (CITRA v3.43.18) & LỘ TRÌNH HOÀN THIỆN TIẾP THEO

- **Ngày lập báo cáo:** `2026-11-09`
- **Phiên bản hệ thống:** `v3.43.18`
- **Môi trường triển khai thực tế:** `https://citra.io.vn`
- **Tổng quy mô mã nguồn:** `172,467` dòng code (`70,771` LOC Python Backend + `62,325` LOC React/TypeScript Frontend + `39,371` LOC Automated Tests)

---

## PHẦN 1: THỐNG KÊ TỔNG SỐ LƯỢNG PDF ĐÃ CHẠY THỰC NGHIỆM & CẢI THIỆN HỆ THỐNG

Tính đến ngày `2026-11-09`, hệ thống đã được chạy kiểm thử, đối chiếu trực tiếp từng lỗi với file PDF gốc và tối ưu hóa qua tổng cộng **`841` file PDF độc lập (unique SHA256)** (tương ứng **`1,058` file PDF** lưu trong workspace nếu tính cả bản lưu trữ đối chiếu tại `200-theses/`).

| STT | Bộ dữ liệu (Thư mục) | Số lượng PDF độc lập | Đặc điểm & Phạm vi cải thiện | Bộ Unit / Regression Test tương ứng |
| :-: | :--- | :---: | :--- | :--- |
| 1 | **Khóa luận Quốc tế Tiếng Anh**<br>(`20-theses/` & `200-theses/`) | **220 PDF**<br>*(20 bài đợt 1 + 200 bài đợt 2)* | Khóa luận ĐH/ThS từ các kho mở châu Âu & Bắc Mỹ (Chalmers, Polimi, UTwente, Tartu, Tampere, Helsinki, Jyväskylä, Oulu/Theseus, DiVA, Padua...). Đã chạy full GROBID `0.9.1-crf` + Parsing + Linking. | `tests/unit/test_20_theses_bug_regressions.py`<br>`tests/unit/test_200_theses_bug_regressions.py` |
| 2 | **Chuẩn 11 Style Quốc tế**<br>(`style_corpora/`) | **275 PDF**<br>*(11 chuẩn × 25 bài)* | 11 chuẩn trích dẫn (`APA`, `IEEE`, `Vancouver`, `Harvard`, `Chicago`, `MLA`, `ACM`, `ACS`, `AMA`, `CSE`, `Nature`), mỗi chuẩn gồm 20 bài thực tế (`real`) + 5 bài khó (`hard_cases`). | `tests/unit/test_patterns_all_formats.py`<br>`tests/unit/test_ambiguous_and_hard_cases.py` |
| 3 | **Khóa luận & Tạp chí ĐH Việt Nam — Đợt 1**<br>(`TDTU_PDF/`) | **100 PDF** | Khóa luận, luận văn, bài báo khoa học tiếng Việt (TDTU và các trường ĐH Việt Nam). | `tests/unit/test_tdtu_full_bibliography.py`<br>`tests/unit/test_tdtu_intext_and_linking.py`<br>`tests/unit/test_tdtu_references.py` |
| 4 | **Khóa luận & Tạp chí ĐH Việt Nam — Đợt 2**<br>(`VN_UNI_PDF_BATCH2/`) | **100 PDF** | Mở rộng 100 bài khóa luận/tạp chí từ nhiều trường đại học Việt Nam với các biến thể trình bày phức tạp. | `tests/unit/test_vn_uni_batch2_hard_cases.py` |
| 5 | **Báo cáo Đồ án CNTT / Kỹ thuật**<br>(`tdtu_github_reports/`) | **75 PDF** | Báo cáo đồ án môn học, khóa luận CNTT xuất từ LaTeX/Word của sinh viên. | `tests/unit/test_parsing_and_segmentation_improvements.py` |
| 6 | **Báo cáo & Khóa luận Pháp luật Việt Nam**<br>(`vn_legal_reports/`) | **36 PDF**<br>*(30 bài thực tế + 6 hard cases)* | Chuyên sâu về trích dẫn văn bản quy phạm pháp luật VN (Hiến pháp, Bộ luật, Luật, Nghị định, Thông tư theo chuẩn TDTU §2.6.1). | `tests/unit/test_tdtu_legal_documents.py`<br>`tests/unit/test_vn_legal_and_multistyle_mvp.py` |
| 7 | **Kịch bản E2E, ACL & Bài báo mẫu**<br>(`data/`, `6_ICCIES_2027/`, `TDTU-MidtermReport/`) | **35 PDF**<br>*(unique)* | Các file test kịch bản E2E, ACL Anthology XML/PDF test data và bài báo nghiên cứu của nhóm. | `tests/unit/test_document_parser.py`<br>`tests/unit/test_pipeline_document_parser.py` |
| **Tổng** | **Toàn bộ hệ thống** | **`841` PDF độc lập** | **371 file đã có cache GROBID TEI XML tại `data/cache/grobid/`** | **`1,683` unit tests passed (100%)** |

---

## PHẦN 2: ĐỊNH VỊ HIỆN TẠI CỦA HỆ THỐNG TRONG MỘT ĐỒ ÁN NGÀNH KỸ THUẬT PHẦN MỀM

### 2.1. Đánh giá tổng quan
Về mặt **thực thi kỹ thuật (Engineering Execution)**, hệ thống **CITRA (`v3.43.18`)** đã **vượt rất xa chuẩn của một Đồ án Tốt nghiệp ngành Kỹ thuật Phần mềm (KTPM) bậc đại học thông thường** (vốn thường dừng ở mức ứng dụng CRUD + tích hợp 1 mô hình AI đơn giản chạy local). Hiện tại dự án đạt cấp độ **Production-Grade SaaS + Research-Backed Neuro-Symbolic Platform** (tương đương mức điểm **9.5 – 10/10** về phần mềm).

### 2.2. Bức tranh định lượng toàn bộ hệ thống hiện tại (`172,467` LOC)

1. **Backend Python (`src/integrity_checker/` — `70,771` LOC / `114` files):**
   Được thiết kế theo kiến trúc phân tầng (Layered & Modular Architecture) gồm 10 phân hệ rõ ràng:
   - **`extraction/` (`23,926` LOC / `31` files):** Kết hợp GROBID `0.9.1-crf` TEI-XML + PyMuPDF 2 cột + `python-docx` + BibTeX (`.bib`) / RIS (`.ris`), bộ lọc mục lục (TOC), làm giàu trường bằng Regex, hỗ trợ 12 chuẩn trích dẫn quốc tế và nhận diện văn bản quy phạm pháp luật Việt Nam (TDTU §2.6.1).
   - **`linking/` (`2,132` LOC / `4` files):** Đối sánh hai chiều (Bidirectional Linking) giữa trích dẫn trong bài (`in-text`) và danh mục tài liệu tham khảo (`reference list`) qua 7 phương pháp phân giải (ưu tiên `tei_link`), phát hiện 8 trạng thái lỗi cấu trúc & trùng lặp tài liệu (`DuplicateDetector`).
   - **`retrieval/` (`11,930` LOC / `23` files) & `database/` (`1,598` LOC / `4` files):**
     - Cơ sở dữ liệu nội bộ SQLite FTS5 (`128,717` bài báo, `82,577` abstracts) + danh sách bài báo kinh điển (`Seminal Whitelist`).
     - Định tuyến theo lĩnh vực (`Domain-Aware Orchestrator`) qua 15+ nguồn học thuật quốc tế (Crossref, OpenAlex, DBLP, arXiv, PubMed/NCBI, Europe PMC, DOAJ, DataCite, OpenAIRE/HAL, OpenLibrary, IETF RFC, Hugging Face, Global DOI RA, Retraction Watch, Wayback Machine).
     - Bộ định tuyến thông minh **Serper $\rightarrow$ SerpApi Scholar Fallback** (`scholar_router.py`).
     - Cơ chế chịu tải 4 tầng (**4-Layer Deadline Burst Queue & HTTP 429 Rate-Limit Protection**).
   - **`matching/` (`5,392` LOC / `10` files), `logic/` (`5,327` LOC / `7` files) & `pipeline/` (`2,675` LOC / `2` files):**
     - 5 trụ cột ngữ nghĩa Sentence-BERT (đối sánh bằng chứng abstract, phân loại ý định trích dẫn, kiểm tra quan điểm ủng hộ/bác bỏ, bắc cầu đa ngữ $\text{VI}\leftrightarrow\text{EN}$, và phát hiện trích dẫn ngầm — đã được tối ưu hóa gom lô `batch encoding` tại `checker.py`).
     - Cây quyết định Symbolic (16 nhóm / 43+ mã quy tắc), mô hình học máy kết hợp `HybridMLScorer` 16 đặc trưng, hiệu chỉnh xác suất Logit-Space `PlattCalibrator`, và cơ chế từ chối phán đoán có nhận thức nguồn gốc (`Provenance-Aware Selective Abstention` trong vùng biên $[0.4, 0.6]$).
   - **`api/` (`10,639` LOC / `20` files), `db/` (`2,647` LOC / `4` files), `export/` (`1,476` LOC / `3` files) & `billing/` (`1,079` LOC / `3` files):**
     - FastAPI bất đồng bộ, theo dõi tiến trình 8 bước thời gian thực qua SSE (có lưu trạng thái xuống DB để tự động phục hồi thanh tiến trình khi người dùng F5/chuyển trang).
     - Phân quyền RBAC 3 vai trò (`Student`, `Teacher`, `Admin`), quản lý lớp học (`Classroom` + mã tham gia `join_code`), giảng viên ghi đè phán quyết (`Teacher Verdict Override`), nhật ký kiểm toán bất biến (`Audit Log`).
     - Quản lý khóa API cá nhân (`X-API-Key`), thanh toán tự động qua VietQR/SePay, hệ thống mã khuyến mãi (`PromoCode`).
     - Xuất báo cáo PDF/DOCX/CSV/JSON đính kèm chứng thực số chống giả mạo (**Tamper-Evident Digital Verification Receipt + ISO/IEC 18004 QR Seal**) và liên kết chia sẻ công khai (`/shared/:token`).
     - Tuân thủ pháp luật Việt Nam về bảo vệ dữ liệu cá nhân (**Luật Bảo vệ Dữ liệu Cá nhân 91/2025 & Nghị định 356/2025**: trang `/privacy`, tự xóa tài khoản, ẩn danh hóa dữ liệu).

2. **Frontend SPA (`web/src/` — `62,325` LOC / `161` files):**
   - Xây dựng bằng React 18 + TypeScript + TailwindCSS + Vite, gồm `49` trang (`pages/`) và `65` thành phần giao diện (`components/`).
   - Các giao diện chuyên sâu: Split-pane Citation Debugger IDE, 5-Stage Logic Trace, Citation Evidence Graph, Document Context Inspector, Live Citation Sandbox, Auto-Remediation BibTeX, hỗ trợ song ngữ Anh–Việt (`en.json` / `vi.json`) và giao diện Sáng/Tối (Light/Dark Mode).

3. **Kiểm thử Tự động & Hạ tầng CI/CD (`tests/`, `.github/workflows/ci-cd.yml`, `docker-compose.prod.yml`):**
   - **Backend Tests:** `1,683` unit tests (`104` files, `37,926` LOC) + `6` file integration tests (`1,445` LOC) — pass 100%, kiểm tra cả `ruff` lint tự động.
   - **Frontend & E2E Tests:** `36` file Vitest unit tests + `15` file kịch bản kiểm thử trình duyệt Playwright E2E.
   - **CI/CD Pipeline:** Tự động hóa 4 giai đoạn trên GitHub Actions (Backend Test $\rightarrow$ Frontend Build & Vitest $\rightarrow$ Build & Push Docker Images lên `ghcr.io` $\rightarrow$ Zero-build SSH Deploy lên `https://citra.io.vn` kèm kiểm tra sức khỏe container tự động).

---

## PHẦN 3: NHỮNG ĐIỂM CẦN CẢI THIỆN KẾ TIẾP (THEO THỨ TỰ ƯU TIÊN CHO HỘI ĐỒNG ĐATN KTPM)

Đối với Hội đồng chấm Đồ án ngành **Kỹ thuật Phần mềm**, khi sản phẩm phần mềm đã hoàn thiện ở mức cao, rủi ro mất điểm **không nằm ở việc thiếu tính năng**, mà nằm ở:
1. **Sự lệch pha giữa quyển báo cáo khóa luận và codebase thực tế.**
2. **Khả năng bảo trì (Maintainability) của các file code lớn.**
3. **Cơ chế quản lý phiên bản cơ sở dữ liệu (Database Schema Migration).**
4. **Bằng chứng kiểm thử phi chức năng (Non-Functional Load & Latency Benchmarks).**

Dưới đây là **5 hạng mục cần cải thiện kế tiếp** theo thứ tự ưu tiên từ cao xuống thấp:

### Ưu tiên 1 (Quan trọng số 1): Đồng bộ hóa Quyển Báo cáo Khóa luận (`TDTU-MidtermReport/`) với Codebase hiện tại (`v3.43.18`)
Nội dung trong `TDTU-MidtermReport/chapter5_rewritten.tex` và `chapter6_rewritten.tex` hiện vẫn giữ số liệu của mốc Giữa kỳ, dẫn đến nhiều thông tin bị cũ so với code thực tế:
- **Cập nhật phiên bản công cụ & kiến trúc truy vấn:**
  - Sửa `GROBID 0.8.0` $\rightarrow$ **`GROBID 0.9.1-crf`**.
  - Sửa `6 keyless public APIs + SerpAPI` $\rightarrow$ **`15+ nguồn học thuật quốc tế + bộ định tuyến Serper -> SerpApi Scholar Fallback Router`** (`src/integrity_checker/retrieval/scholar_router.py`).
- **Cập nhật quy mô bộ kiểm thử tự động:**
  - Sửa `1,304 passing backend tests` và `41 frontend unit tests across 7 Vitest files` $\rightarrow$ **`1,683 passing backend unit tests (104 files)`** và **`36 Vitest test files`**.
- **Chuyển các mục ở "Directions for Next Steps" (Chương 6) thành kết quả đã hoàn thành:**
  - Trong `chapter6_rewritten.tex` (dòng 58–99), 6 mục từng được liệt kê là hướng phát triển tương lai lúc giữa kỳ (**đánh giá trên tập khóa luận thực tế, đối sánh đa ngữ VI–EN, chống nghẽn HTTP 429 & hàng đợi ưu tiên, tách luồng bất đồng bộ 8 bước, bảo mật & tuân thủ dữ liệu cá nhân PDPL, triển khai Docker/Nginx production**) đều **đã được hiện thực hóa 100% trong code**.
  - Cần đưa kết quả thực nghiệm trên **`841` file PDF** (đặc biệt là bộ 200 khóa luận quốc tế, 200 khóa luận ĐH Việt Nam, 275 bài chuẩn 11 style và 36 báo cáo pháp luật VN) vào Chương 4 và Chương 5.
- **Hoàn thiện các file LaTeX còn sơ sài:**
  - Ví dụ `TDTU-MidtermReport/TongKet.tex` hiện mới có duy nhất 1 dòng `\chapter*{TỔNG KẾT}`.

### Ưu tiên 2 (Kiến trúc & Clean Code): Refactor tách nhỏ các "God Files"
Qua quá trình tinh chỉnh hàng trăm trường hợp biên thực tế, một số file lõi đã vượt ngưỡng `2,000–3,300` dòng code:
- `src/integrity_checker/extraction/reference_parser.py` (**`3,388` dòng**)
- `src/integrity_checker/api/routes/essays.py` (**`~2,800` dòng**)
- `src/integrity_checker/pipeline/checker.py` (**`~2,480` dòng**)
- `src/integrity_checker/extraction/document_parser.py` (**`~2,250` dòng**)
- `src/integrity_checker/extraction/grobid_parser.py` (**`~1,950` dòng**)
- **Giải pháp:** Tách các cụm xử lý chuyên biệt ra các module con (ví dụ: tách bộ tiền xử lý/tách dòng bibliography, bộ parser truyền thống tiếng Việt, và bộ hòa trộn GROBID–Regex ra các file riêng nhưng vẫn giữ `re-export` tại file gốc để không làm gãy bất kỳ import hay unit test nào). Việc này giúp sơ đồ Class/Package Diagram trong báo cáo KTPM tuân thủ chặt chẽ nguyên lý **Single Responsibility Principle (SRP / SOLID)**.

### Ưu tiên 3 (Quản trị Cơ sở dữ liệu): Chuẩn hóa Database Schema Migration
- Hiện tại `src/integrity_checker/db/session.py` (dòng 84–350) đang sử dụng hàm `_run_inline_migrations(engine)` để kiểm tra cột và chạy hàng loạt lệnh `ALTER TABLE` trực tiếp mỗi khi khởi động ứng dụng.
- **Giải pháp:** Đóng gói thành bảng quản lý phiên bản `schema_migrations` tường minh hoặc tích hợp **Alembic**. Khi Hội đồng KTPM đặt câu hỏi: *"Làm thế nào để quản lý nâng cấp CSDL (schema evolution) và rollback an toàn trên môi trường production?"*, bạn sẽ có minh chứng kỹ thuật hoàn chỉnh.

### Ưu tiên 4 (Kiểm thử Phi chức năng — Non-Functional Requirements & Load Benchmark)
- Hội đồng KTPM luôn đánh giá cao chương **Kiểm thử hiệu năng & Chịu tải (Performance & Stress Testing)**.
- **Giải pháp:** Viết một script benchmark tự động (ví dụ `scripts/benchmark_pipeline_performance.py`) để đo đạc và xuất bảng số liệu đưa vào Chương 5 của quyển báo cáo:
  1. **Latency phân vị ($P_{50}, P_{90}, P_{99}$) và mức tiêu thụ RAM** của từng bước trong 8 bước xử lý theo quy mô tài liệu (bài báo ngắn 10 trang, khóa luận 50 trang, luận văn 100+ trang).
  2. **Throughput & khả năng chịu tải của `DeadlineQueueManager`** khi giả lập 20–50 sinh viên nộp bài đồng thời sát giờ deadline (chứng minh hệ thống xếp hàng mượt mà, không bị lỗi `SQLite database is locked` hay `HTTP 502/429`).

### Ưu tiên 5 (Tài liệu Đặc tả Kỹ thuật Phần mềm — Software Engineering Artifacts)
- Bổ sung/cập nhật vào quyển báo cáo và thư mục `docs/`:
  1. **Ma trận truy vết yêu cầu (Requirements Traceability Matrix — RTM):** Ánh xạ hai chiều từ Yêu cầu người dùng (`UR`) $\rightarrow$ Yêu cầu chức năng (`FR`) / Phi chức năng (`NFR`) $\rightarrow$ Module/API Endpoint $\rightarrow$ Test Case tự động (`test_*.py`).
  2. **Sơ đồ Sequence & Activity Diagram cập nhật:** Phản ánh đúng luồng 8 bước xử lý mới (sau khi đã tách riêng bước 2 `Section Segmentation & Style Detection` và bước 5 `Semantic & Context Matching`), luồng hàng đợi `DeadlineQueueManager`, và luồng ký số `Digital Verification Receipt`.
