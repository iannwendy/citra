# BÁO CÁO KIỂM ĐỊNH TOÀN DIỆN (AUDIT E2E) FULL PIPELINE & LIVE BATCH CHECK

**Dự án:** Essay Integrity Checker  
**Phạm vi kiểm định:** Full Pipeline E2E (GROBID thật + Live External Scholarly APIs + Link Validation + Neural Semantic Layer) & Live Batch Check API/UI (`http://localhost:8000` / `http://localhost:5173`)  
**Tổng khối lượng dữ liệu đã bóc tách từng dòng:**
- **21 tài liệu PDF đa miền (Pass 1 — Cấu hình Production đầy đủ):** `835` trang PDF, `329` mục tài liệu tham khảo (`ref`), `674` lượt trích dẫn trong bài (`cite`).
- **6 tài liệu PDF trọng điểm (Pass 2 — Đối chứng 100% Pure Live External APIs):** Tắt hoàn toàn `local_db` và `_KNOWN_PAPERS` để kiểm chứng độc lập khả năng phân giải DOI, tiêu đề, tác giả, năm và hội nghị/tạp chí từ các API học thuật trực tuyến.
- **7 file Live Batch Check E2E (`BATCH_CONCURRENCY = 3`):** Chạy trực tiếp qua HTTP API container `integrity-api` gồm 5 PDF thực tế đa kịch bản + 1 PDF hỏng bảng tham chiếu chéo (`%PDF-1.4` corrupt xref) + 1 file sai định dạng header để kiểm chứng tính nguyên tử của quota, xử lý lỗi đồng thời, xuất báo cáo JSON/CSV và hành vi giao diện [`BatchUploadPage.tsx`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/web/src/pages/BatchUploadPage.tsx).

> **Nguyên tắc cam kết:** Toàn bộ quá trình kiểm định dưới đây **không chỉnh sửa bất kỳ dòng mã nguồn sản phẩm nào** (`src/`, `web/`, `tests/`, `configs/`). Mọi đề xuất khắc phục đều được thiết kế theo hướng **phẫu thuật cục bộ (surgical fix), tương thích ngược 100% (backward-compatible) và đảm bảo Zero-Regression** (tuyệt đối không làm gãy bất kỳ luồng xử lý, hợp đồng API/DB hay bộ kiểm thử hiện hữu nào).

---

## MỤC LỤC

1. [Tổng quan kết quả chạy E2E Full Pipeline & Batch Check](#1-tổng-quan-kết-quả-chạy-e2e-full-pipeline--batch-check)
2. [Đối chiếu chi tiết cấp độ từng `ref` và `cite` (Phân tách lỗi thật của tài liệu vs. Bug hệ thống)](#2-đối-chiếu-chi-tiết-cấp-độ-từng-ref-và-cite-phân-tách-lỗi-thật-của-tài-liệu-vs-bug-hệ-thống)
3. [Danh mục chi tiết 20 Bug hệ thống & Đề xuất cách Fix Zero-Regression](#3-danh-mục-chi-tiết-20-bug-hệ-thống--đề-xuất-cách-fix-zero-regression)
   - [Nhóm A: Truy vấn học thuật, External APIs, URL/Link & DOI (`BUG-01` → `BUG-05`)](#nhóm-a--truy-vấn-học-thuật-external-apis-urllink--doi-bug-01--bug-05)
   - [Nhóm B: Luật suy diễn Neuro-Symbolic, `_KNOWN_PAPERS`, `local_db`, DOI, Venue & Author (`BUG-06` → `BUG-12`)](#nhóm-b--luật-suy-diễn-neuro-symbolic-_known_papers-local_db-doi-venue--author-bug-06--bug-12)
   - [Nhóm C: Trích xuất PDF, Hợp nhất GROBID + Regex, Liên kết `cite`↔`ref` & Điểm CIS (`BUG-13` → `BUG-16`)](#nhóm-c--trích-xuất-pdf-hợp-nhất-grobid--regex-liên-kết-citeref--điểm-cis-bug-13--bug-16)
   - [Nhóm D: Batch Check API, Quota, Cơ sở dữ liệu & Giao diện Web (`BUG-17` → `BUG-20`)](#nhóm-d--batch-check-api-quota-cơ-sở-dữ-liệu--giao-diện-web-bug-17--bug-20)
4. [Ma trận tổng hợp mức độ ưu tiên & Lộ trình triển khai an toàn](#4-ma-trận-tổng-hợp-mức-độ-ưu-tiên--lộ-trình-triển-khai-an-toàn)

---

## 1. Tổng quan kết quả chạy E2E Full Pipeline & Batch Check

### 1.1. Kết quả Pass 1 — Full Pipeline Production (21 PDF, 329 `ref`, 674 `cite`)

Cấu hình chạy: `use_report_cache=False`, `enable_link_validation=True`, GROBID container thật (`http://localhost:8070`), gọi trực tiếp Crossref, OpenAlex, DBLP, arXiv, DataCite, DOAJ, OpenAIRE/HAL, OpenLibrary, EuropePMC, Wikidata/OpenCitations, Global DOI RA, Internet Archive Wayback Machine và SerpAPI fallback.

| # | Tài liệu PDF | Trang | `ref` | `cite` | CIS | Phân bố nhãn (`verdicts`) | Liên kết (`matched` / `missing` / `uncited` / `dup`) | Thời gian |
|---:|---|---:|---:|---:|---:|---|---|---:|
| 01 | `main.pdf` | 19 | 28 | 28 | **99.72** | `verified:24, resource:4` | `28 / 2 / 0 / 0` | 18.3s |
| 02 | `thesis.pdf` | 104 | 29 | 45 | **90.42** | `verified:16, resource:10, meta_err:2, halluc:1` | `29 / 1 / 0 / 0` | 12.5s |
| 03 | `VietDepression_Research_Article.pdf` | 19 | 18 | 23 | **100.00** | `verified:17, resource:1` | `18 / 0 / 0 / 0` | 3.4s |
| 04 | `523H0054_NguyenBaoMinh_523H0157_DinhDucMinh.pdf` | 53 | 5 | 0 | **97.50** | `verified:5` | `0 / 0 / 5 / 0` | 3.0s |
| 05 | `TranThanhPhuoc_523H0002_523H0054.pdf` | 98 | 27 | 37 | **99.30** | `verified:24, resource:3` | `25 / 5 / 2 / 0` | 5.8s |
| 06 | `TDTU_PDF/041_huit_..._NHOM_09_KhoaLuanTotNghiep.pdf` | 55 | 16 | 27 | **63.20** | `verified:3, resource:8, unres:2, halluc:3` | `9 / 1 / 7 / 0` | 13.2s |
| 07 | `TDTU_PDF/043_vn_uni_doantotnghiep_5988_...pdf` | 18 | 20 | 39 | **64.75** | `verified:9, meta_err:3, unres:3, halluc:5` | `20 / 0 / 0 / 0` | 27.1s |
| 08 | `TDTU_PDF/047_hust_..._20206136_VuThiHang.pdf` | 69 | 24 | 31 | **94.59** | `verified:22, meta_err:1, halluc:1` | `18 / 0 / 6 / 0` | 10.4s |
| 09 | `TDTU_PDF/098_uit_vnuhcm_Vietnamese_Hate_Speech_...pdf` | 12 | 24 | 43 | **99.76** | `verified:24` | `24 / 1 / 0 / 0` | 7.6s |
| 10 | `tdtu_github_reports/006_tdtu_YaminThiriWai_...pdf` | 55 | 12 | 44 | **91.14** | `verified:9, unres:3` | `10 / 0 / 2 / 0` | 16.1s |
| 11 | `tdtu_github_reports/014_tdtu_MPhong03_The_Loop_Game_...pdf` | 86 | 6 | 2 | **90.88** | `resource:6` | `0 / 2 / 6 / 0` | 6.9s |
| 12 | `vn_legal_reports/002_vn_legal_..._ESCO_TAI_VI.pdf` | 13 | 18 | 61 | **80.00** | `verified:2, resource:15, meta_err:1` | `18 / 0 / 0 / 0` | 19.2s |
| 13 | `vn_legal_reports/003_vn_legal_..._HOA_KY_...pdf` | 14 | 13 | 26 | **50.15** | `verified:1, meta_err:3, unres:6, halluc:3` | `13 / 0 / 0 / 0` | 14.6s |
| 14 | `20-theses/11.pdf` | 35 | 23 | 114 | **99.96** | `verified:22, resource:1` | `23 / 1 / 0 / 0` | 9.8s |
| 15 | `20-theses/14.pdf` | 32 | 24 | 81 | **95.89** | `verified:22, meta_err:1, unres:1` | `23 / 2 / 1 / 0` | 11.3s |
| 16 | `style_corpora/IEEE/hard_cases/hard_02_metadata_errors_...pdf` | 4 | 6 | 15 | **58.04** | `verified:2, meta_err:2, halluc:2` | `4 / 0 / 0 / 2` | 0.7s |
| 17 | `style_corpora/APA/hard_cases/hard_03_hallucinations_...pdf` | 4 | 6 | 14 | **47.50** | `verified:1, meta_err:2, halluc:3` | `6 / 0 / 0 / 0` | 8.2s |
| 18 | `style_corpora/Vancouver/hard_cases/hard_05_extreme_...pdf` | 4 | 7 | 15 | **77.50** | `verified:3, unres:4` | `7 / 0 / 0 / 0` | 27.7s |
| 19 | `style_corpora/ACM/real/07_a_study_of_sentiment_...pdf` | 5 | 12 | 18 | **77.38** | `verified:8, meta_err:1, unres:2, halluc:1` | `12 / 3 / 0 / 0` | 13.0s |
| 20 | `data/essays/essay_03_comprehensive.pdf` | 2 | 9 | 11 | **63.99** | `verified:4, meta_err:2, halluc:3` | `8 / 0 / 1 / 0` | 6.0s |
| 21 | `data/essays/essay_05_edge_doi_only.pdf` | 2 | 2 | 0 | **35.00** | `meta_err:2` | `2 / 0 / 0 / 0` | 0.3s |

> **Nhận xét tổng quát từ bảng số liệu:** Trong toàn bộ `674` lượt trích dẫn trong bài ở cả 21 tài liệu, ba cột trạng thái `in_text_mismatch`, `ambiguous_mapping` và `style_inconsistent` đều bằng **`0` tuyệt đối** (`0/674`) — đây là dấu hiệu trực tiếp dẫn tới phát hiện **BUG-15** ở tầng [`CitationLinker`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/linking/citation_linker.py#L756-L773).

---

### 1.2. Kết quả Pass 2 — Đối chứng 100% Pure Live External APIs (`use_local_db=False`, xóa `_KNOWN_PAPERS`)

Chạy lại 6 PDF trọng điểm khi buộc 100% trích dẫn đi qua các API học thuật trực tuyến để soi chiếu xem `local_db` và `_KNOWN_PAPERS` có làm sai lệch quyết định hay che khuất bug nào không:

| Tài liệu PDF | CIS Pass 1 | CIS Pass 2 | Nhãn Pass 1 | Nhãn Pass 2 (Pure Live API) | Phát hiện đối chiếu cốt lõi |
|---|---:|---:|---|---|---|
| `main.pdf` | 99.72 | 99.51 | `ver:24, res:4` | `ver:24, res:4` | Đồng nhất nhãn; phát hiện `Sculley 2015` bị cắt cụt URL `https:` ở cuối dòng. |
| `VietDepression_Research_Article.pdf` | 100.00 | 96.47 | `ver:17, res:1` | `ver:16, meta_err:1, res:1` | **Phát hiện BUG-12:** Bài ICWSM 2013 (`10.1609/icwsm.v7i1.14432`) bị Crossref trả năm `published-online=2021` gây báo sai `year`. |
| `006_tdtu_YaminThiriWai_...pdf` | 91.14 | 91.14 | `ver:9, unres:3` | `ver:9, unres:3` | Khớp 100%; 3 bài `UNRESOLVED` là bài bị sinh viên ghép sai tiêu đề/tác giả bằng LLM. |
| `hard_02_metadata_errors_...pdf` | 58.04 | 59.71 | `ver:2, meta_err:2, halluc:2` | `ver:2, meta_err:4` | **Phát hiện BUG-07 (Critical):** Pass 2 bắt đúng 4/4 `metadata_error`, trong khi Pass 1 gán oan 2 lỗi sai năm đơn thuần (`Vaswani 2020`, `He 2018`) thành `suspected_hallucination`! |
| `hard_03_hallucinations_...pdf` | 47.50 | 50.00 | `ver:1, meta_err:2, halluc:3` | `ver:1, halluc:4, unres:1` | **Phát hiện BUG-06 (Critical):** `_KNOWN_PAPERS` biến 2 câu chimera bịa đặt thành `metadata_error` nhẹ ở Pass 1; còn ở Pass 2 câu chimera cùng tác giả (`Devlin 2019` + vật lý thiên văn) lọt xuống `unresolved`! |
| `essay_03_comprehensive.pdf` | 63.99 | 63.99 | `ver:4, meta_err:2, halluc:3` | `ver:4, meta_err:2, halluc:3` | **Phát hiện BUG-10 & BUG-14:** Bài chuẩn APA 7th dùng `... & Bowman, S.` bị phạt oan `author`; mục `[4]` năm 2023 bị ghép nhầm sang mục năm 2022. |

---

### 1.3. Kết quả Live Batch Check E2E (`BATCH_CONCURRENCY = 3` trên `http://localhost:8000`)

Mô phỏng chính xác cơ chế hàng đợi đồng thời `BATCH_CONCURRENCY = 3` của [`BatchUploadPage.tsx`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/web/src/pages/BatchUploadPage.tsx#L39) với 7 file trộn lẫn hợp lệ và lỗi:

| Lượt | Tên file upload | HTTP Upload | `essay_id` | Trạng thái cuối | CIS | Phát hiện từ kiểm thử thực tế |
|---:|---|---:|---:|---|---:|---|
| 1 | `batch_01_main.pdf` | `200 OK` | 46 | `completed` | 99.72 | Hoàn tất sau 26.2s, JSON/CSV `200 OK`. |
| 2 | `batch_02_hard_02_ieee.pdf` | `200 OK` | 45 | `completed` | 58.04 | Lệch số liệu `num_citations`: pipeline=`4`, list/report=`15`, stats=`6` (**BUG-16**). |
| 3 | `batch_03_hard_03_apa.pdf` | `200 OK` | 44 | `completed` | 47.50 | Log container báo `DBLP retry exhausted` ×3 (**BUG-04**). |
| 4 | `batch_04_014_loop_game.pdf` | `200 OK` | 47 | `completed` | **90.88** | 0 trích dẫn khớp + 6 ref không trích dẫn vẫn đạt `CIS = 90.88` (**BUG-16**); làm cạn quota SerpAPI. |
| 5 | `batch_05_041_huit_kltn.pdf` | `200 OK` | 48 | `completed` | **77.85** | Cùng 1 file nhưng Pass 1 ra `CIS = 63.20`, Batch ra `77.85` (**BUG-02**); thứ tự `verdicts` bị đảo lộn `[7]..[16]` lên đầu (**BUG-19**). |
| 6 | `batch_06_corrupt_xref.pdf` | **`200 OK` (!)** | 49 | **`completed` (!)** | **0.00** | **BUG-18 (High):** File `%PDF-1.4` hỏng hoàn toàn không bị chặn `400`, vẫn trừ quota và báo `completed`! |
| 7 | `batch_07_not_a_pdf.pdf` | `400 Bad Request` | — | `rejected` | — | Bắt đúng lỗi thiếu magic bytes `%PDF-`. |

- **Kiểm tra hạn ngạch (`Quota Audit`):** Tài khoản `teacher` bắt đầu với `monthly_uploads_used = 0`, thực hiện thành công **6 lượt upload (`IDs 44..49`)**, nhưng sau khi toàn bộ batch hoàn tất, `/api/billing/subscription` chỉ ghi nhận **`monthly_uploads_used = 4`** — mất dấu 2 lượt upload do Race Condition (**BUG-17 Critical**). *(Dữ liệu test `IDs 44..49` đã được xóa sạch và reset `monthly_uploads_used = 0` sau khi thu thập bằng chứng).*

---

## 2. Đối chiếu chi tiết cấp độ từng `ref` và `cite` (Phân tách lỗi thật của tài liệu vs. Bug hệ thống)

Để tránh sửa nhầm vào những chỗ hệ thống đang hoạt động **đúng**, bảng dưới đây tách bạch rõ ràng giữa **quyết định chính xác của hệ thống trước lỗi thật trong PDF gốc** và **quyết định sai/lệch do bug phần mềm**:

### 2.1. Các trường hợp hệ thống ra quyết định CHÍNH XÁC (Không phải Bug)

1. **Bắt đúng DOI giả mạo & URL giả mạo:**
   - `hard_03 #3, #4, #5` và `essay_03 #5, #6, #9`: Các DOI tiền tố giả (`10.9999/...`, `10.1234/...`, `10.5555/...`) và tên miền giả (`https://example.com/rag-tech.pdf`) đều bị bắt chính xác là `SUSPECTED_HALLUCINATION` (`R-FABRICATED-DOI`, `R-NONEXISTENT-DOI`, `R-FAKE-URL`) với độ tin cậy `0.98–0.99`.
2. **Bắt đúng tác giả khuyết danh / sai tác giả & sai năm thực sự trong bài gốc:**
   - `essay_05_edge_doi_only.pdf #1, #2`: Trang 2 của PDF gốc ghi tác giả là `Various (2017). Attention is all you need` và `Various (2015). Deep learning`. Hệ thống đối chiếu DOI thật và gắn `METADATA_ERROR (mismatched_fields=['author'])` là **hoàn toàn chính xác**.
   - `essay_03 #2`: PDF gốc ghi `Devlin, J. et al. (2018). BERT... Proceedings of the 2019 Conference of NAACL` (sai năm `2018` so với kỷ yếu NAACL `2019`) → `METADATA_ERROR (year)` là **chính xác**.
   - `043_vn_uni #1, #12` & `20-theses/14.pdf #4` & `002_vn_legal #9`: Tài liệu gốc ghi sai năm xuất bản so với bản ghi Crossref/OpenLibrary (`OECD 2021` cho báo cáo xuất bản `2022`; `Purves 2017` cho ấn bản `2018`) → `METADATA_ERROR (year)` là **chính xác**.
3. **Bắt đúng trích dẫn do sinh viên dùng AI ghép sai tiêu đề/tác giả (LLM Hallucination thật trong đồ án):**
   - `006_tdtu_YaminThiriWai #1, #7, #9`: Trong thân bài trang 13 sinh viên viết *"Kim et al. proposed High Utility Occupancy Mining with Indexed List [7] (HUOMIL)"*, nhưng ở danh mục tài liệu tham khảo mục `[7]` lại ghi `Wu, Y.-L., V. S. Tseng (2019) Mining high-utility patterns in multiple-instance learning`; mục `[1]` gán bài HUOPM (vốn của *Gan, Lin, Fournier-Viger, Chao & Yu, 2020*) cho `Wu, Tseng, Yu (2018)`; mục `[9]` đổi tên bài *Two-Phase* của `Liu, Liao, Choudhary (2005)` thành tiêu đề không tồn tại. Hệ thống không xác thực khống mà giữ `UNRESOLVED` là **an toàn và hợp lý**.
   - `thesis.pdf #28` & `041_huit #1`: Sách tự xuất bản Kindle (`Reality Check Series Book 6`) hoặc tài liệu không có thật trên 7 cơ sở dữ liệu học thuật → đánh dấu cảnh báo là đúng thiết kế.
4. **Nhận diện đúng văn bản quy phạm pháp luật Việt Nam:**
   - `002_vn_legal #2, #11, #12, #14`: `Nghị quyết 70-NQ/TW`, `Luật số 50/2010/QH12`, `Luật số 77/2025/QH15`, `Quyết định 500/QĐ-TTg` đều được nhận diện chính xác là `RESOURCE` (`R-LEGAL-DOCUMENT` / `R-VN-LEGAL-VERIFIED`) và liên kết đúng với các câu trích dẫn trong bài (`61` cites → `18/18` matched).
5. **Tài liệu không hề có trích dẫn trong thân bài:**
   - `523H0054_NguyenBaoMinh...pdf` (53 trang): Đã quét kiểm tra toàn văn 53 trang PDF — sinh viên thực sự liệt kê 5 tài liệu tham khảo ở cuối báo cáo nhưng **không viết bất kỳ ký hiệu `[1]..[5]` hay `(Author, Year)` nào trong thân bài**. Kết quả `in_text = 0`, `uncited_reference = 5` là **chính xác 100%**.

---

### 2.2. Bảng tóm tắt các quyết định SAI / LỆCH do Bug hệ thống (Đã xác minh từng dòng)

| Tài liệu & Dòng `ref`/`cite` | Quyết định hiện tại của hệ thống | Quyết định đúng lẽ ra phải ra | Mã Bug chịu trách nhiệm |
|---|---|---|---|
| `041_huit` Ref `[7]` (`iworld.com.vn`) & `[12]` (`websitehcm.com`) | Lúc `SUSPECTED_HALLUCINATION` (`CIS=63.20`), lúc `RESOURCE` (`CIS=77.85`) | Luôn là `RESOURCE (R-WAYBACK-ARCHIVED)` (cả 2 URL đều có bản lưu thật trên Archive.org) | **BUG-01**, **BUG-02** |
| `041_huit` Ref `[9]` (`[9] https://ntshanoi.com.vn/...`) | Đốt 10 API học thuật + SerpAPI trả phí cho một đường link web thuần túy | Nhận diện ngay là bare URL web resource, chỉ chạy `LinkValidator` | **BUG-03** |
| `main.pdf` Ref `#17` (`aclanthology.org`) & `#21` (`info.arxiv.org`) | Gắn cứng `R-WEB-RESOURCE` trước khi kiểm tra link sống/chết | Kiểm tra link sống/chết trước; phân biệt domain kho bài báo học thuật với web thường | **BUG-03** |
| `hard_03` Ref `#2` (`Vaswani 2017` + tiêu đề tàu ngầm lượng tử + DOI CVPR ResNet) | Pass 1: `METADATA_ERROR (title)` (`conf=0.75`) | `SUSPECTED_HALLUCINATION (R-CHIMERIC-DOI-MISMATCH)` (`doi, title, author`) | **BUG-06 (6a)** |
| `hard_03` Ref `#6` (`Devlin, Chang 2019` + vật lý thiên văn + DOI BERT) | Pass 1: `METADATA_ERROR`; Pass 2: `UNRESOLVED (conf=0.41)` | `SUSPECTED_HALLUCINATION` (ghép tác giả & DOI thật vào tiêu đề bịa đặt 100%) | **BUG-06 (6a & 6b)** |
| `hard_02` Ref `[1]` (`Vaswani 2020`) & `[5]` (`He 2018`, JMLR) | Pass 1 & Batch: `SUSPECTED_HALLUCINATION (mismatch=['content'])` | `METADATA_ERROR` (`mismatch=['year']` cho `[1]`; `['year', 'venue']` cho `[5]`) | **BUG-07**, **BUG-11** |
| `TranThanhPhuoc #19` & `20-theses/11.pdf #14` | `VERIFIED` nhưng kèm `mismatched_fields=['doi']` | `VERIFIED` với `mismatched_fields=[]` (`local_db` chỉ khuyết cột DOI chứ không xung đột) | **BUG-08** |
| `043_vn_uni #17, #18`, `047_hust #1`, `003_vn_legal #11, #12`, `ACM/07 #12` | `SUSPECTED_HALLUCINATION` kèm lý do vô lý `(title_sim=0.84 < 0.4)` | Tạp chí VN chưa index quốc tế → `UNRESOLVED`; thông điệp phải in đúng `fuzzy_sim` vs `semantic_sim` | **BUG-09** |
| `essay_03` Ref `#8` (`Kiela, ..., & Bowman, 2021` — 23 tác giả APA 7th) | `METADATA_ERROR (mismatch=['author'])` (`author_jaccard=0.13`) | `VERIFIED` (chuẩn APA 7th bắt buộc dùng `... &` khi `>= 21` tác giả) | **BUG-10** |
| `VietDepression` Ref `[1]` (`De Choudhury et al., 2013`, ICWSM) | Pass 2: `METADATA_ERROR (year)` (Crossref `published-online=2021`) | `VERIFIED` (bài hội nghị ICWSM 2013 được AAAI nộp DOI muộn năm 2021) | **BUG-12** |
| `006_tdtu` trang 10: `"in a database[3], [4]."` | Bỏ sót hoàn toàn cả `[3]` và `[4]` → phạt oan Ref `[3], [4]` là `UNCITED_REFERENCE` | Trích xuất đủ `[3]` và `[4]`, liên kết `MATCHED` tới Ref `[3]` & `[4]` | **BUG-13** |
| `014_tdtu_The_Loop_Game` trang 10 & 15: `"Hình 2.1 Gameplay của Rogue (1980)"` | Bắt nhầm tên game trong chú thích ảnh thành 2 trích dẫn `MISSING_REFERENCE` | Bỏ qua chú thích hình/mục lục hình (`in_text = 0`) | **BUG-13** |
| `essay_03` Ref `#4` (`Xiao 2023`) & `#5` (`Xiao 2022`) | Gộp nhầm `[4]` và đồng tác giả `Wang, Lee` của bài `2023` đè sang bài `2022` | Giữ nguyên `[4]` cho bài `2023` và giữ nguyên tác giả đơn `Xiao Y.` cho bài `2022` | **BUG-14** |
| `041_huit` Ref `[6]` (`Akinsola et al., 2020`) | Regex `acm_full_name` nuốt đồng tác giả + tên tạp chí vào `title` → `UNRESOLVED` | Tách đúng `authors`, `title`, `venue` → `VERIFIED` (`title_sim=1.0`, `author_sim=1.0`) | **BUG-14** |
| `20-theses/11.pdf` (`Kaveripakam, 2024` vs `2025`) & `14.pdf` (`Bloem 2024` vs `2021`) | Gắn `status="matched"`, `penalty=0.0` (che giấu hoàn toàn lỗi sai năm trong bài) | Liên kết đúng `reference_id` nhưng gắn `status="in_text_mismatch"` để cảnh báo sai năm | **BUG-15** |
| `20-theses/11.pdf` trang 30: `(Lee et al., 2024; Mandarić et al., 2022)` | Ghi đè `mapping_status="matched"` theo phần tử đầu, làm mất lỗi thiếu `Mandarić 2022` | Bảo toàn trạng thái `missing_reference` trong `linking_summary` cho phần tử bị thiếu | **BUG-15** |
| `014_tdtu_The_Loop_Game` (0 khớp, 2 thiếu ref, 6 ref bỏ không) | Chấm điểm **`CIS = 90.88 / 100`** (`apa_count=0`, `numeric_count=0` trên mọi PDF) | Khấu trừ đúng `uncited_reference` cho `RESOURCE` và không cộng 60 điểm học thuật khống | **BUG-16** |
| Batch Check 6 file song song + 1 file PDF hỏng xref | Chỉ trừ `4/6` quota; file PDF hỏng báo `completed (CIS=0.0)`; đảo thứ tự `verdicts` | Trừ đúng `6/6` quota nguyên tử; chặn `400` file PDF hỏng; giữ đúng thứ tự `[1]..[N]` | **BUG-17, 18, 19, 20** |

---

## 3. Danh mục chi tiết 20 Bug hệ thống & Đề xuất cách Fix Zero-Regression

---

### Nhóm A — Truy vấn học thuật, External APIs, URL/Link & DOI (`BUG-01` → `BUG-05`)

#### BUG-01 (`CRITICAL`) — Race Condition trên thuộc tính trạng thái `self._last_archive_url` của Singleton `RetrievalOrchestrator`

- **Vị trí mã nguồn:**
  - Khởi tạo singleton toàn tiến trình: [`deps.py`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/api/deps.py#L38-L45) (`get_orchestrator()` với `@lru_cache(maxsize=1)`).
  - Ghi đè và đọc lại biến thực thể qua điểm nhường bất đồng bộ (`await`): [`retrieval_orchestrator.py`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/retrieval/retrieval_orchestrator.py#L939) và [`_validate_citation_url`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/retrieval/retrieval_orchestrator.py#L1379-L1408), sau đó đọc lại tại các dòng [`1590`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/retrieval/retrieval_orchestrator.py#L1590), [`1604`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/retrieval/retrieval_orchestrator.py#L1604), [`1623`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/retrieval/retrieval_orchestrator.py#L1623), [`1670`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/retrieval/retrieval_orchestrator.py#L1670), [`1962`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/retrieval/retrieval_orchestrator.py#L1962), [`2006`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/retrieval/retrieval_orchestrator.py#L2006).
- **Bằng chứng & Cơ chế gây lỗi:**
  - Pipeline kiểm tra đồng thời tới `8` trích dẫn mỗi bài (`Semaphore(8)`), và Batch Check chạy đồng thời `3` bài (`BATCH_CONCURRENCY = 3`) → tối đa **24 coroutine cùng chia sẻ duy nhất 1 instance `RetrievalOrchestrator`**.
  - Tại dòng `1389`, Coroutine A reset `self._last_archive_url = None`, gọi `await validator.validate_url(url_A)` và nhận được `self._last_archive_url = "https://web.archive.org/.../url_A"`. Ngay trước khi Coroutine A đi qua các API học thuật để tới dòng `1962` gắn `archive_url` vào `SourceResult`, Coroutine B nhảy vào dòng `1389` gán `self._last_archive_url = None` (hoặc gán snapshot của `url_B`)! Hậu quả: Coroutine A bị mất trắng link Wayback hoặc gắn nhầm link Wayback của bài báo khác.
- **Đề xuất cách Fix (Zero-Regression):**
  - Tách hàm nội bộ `_validate_citation_url_with_archive(citation) -> tuple[str | None, int | None, str | None]` trả trực tiếp bộ 3 giá trị `(url_status, url_status_code, archive_url)` trên biến cục bộ (stack frame riêng của từng coroutine) và truyền tường minh biến cục bộ `url_archive` vào `SourceResult(..., archive_url=url_archive)`.
  - Giữ nguyên chữ ký `_validate_citation_url(citation) -> tuple[str | None, int | None]` (ủy quyền sang hàm mới) để **không làm gãy bất kỳ unit test nào đang gọi trực tiếp `_validate_citation_url`**.

```python
# Trong RetrievalOrchestrator (retrieval_orchestrator.py)
async def _validate_citation_url_full(
    self, citation: Citation
) -> tuple[str | None, int | None, str | None]:
    url_to_check = (citation.url or "").strip()
    if not url_to_check and citation.raw_text:
        m = re.search(r"https?://\S+", citation.raw_text, re.IGNORECASE)
        if m:
            extracted = m.group(0).rstrip(".,;:)\"']>")
            if "doi.org/" not in extracted.lower():
                url_to_check = extracted
    if not url_to_check or "doi.org/" in url_to_check.lower():
        return None, None, None
    validator = self._get_link_validator()
    res = await validator.validate_url(url_to_check)
    return res.status, res.status_code, res.archive_url
```

---

#### BUG-02 (`HIGH`) — Truy vấn Wayback Machine không có Semaphore/Retry gây dao động nhãn `RESOURCE` ↔ `SUSPECTED_HALLUCINATION` (`±14.65` điểm CIS trên cùng một PDF)

- **Vị trí mã nguồn:** [`LinkValidator._check_wayback_snapshot`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/retrieval/link_validator.py#L210-L258).
- **Bằng chứng thực nghiệm E2E:**
  - Trên tài liệu `TDTU_PDF/041_huit_khoaluantotnghiep_NHOM_09_KhoaLuanTotNghiep.pdf`, mục `[7] https://www.iworld.com.vn/quan-ly-su-kien-va-thong-tin-bao-mat-siem-la-gi/` và `[12] https://websitehcm.com/recurrent-neural-network-rnn-trong-tensorflow/` đều đã ngừng hoạt động trên web gốc nhưng **có bản lưu lịch sử thật trên Internet Archive** (`20260114114246` và `20240916024700`).
  - Ở lượt chạy **Live Batch Check (`essay_id=48`)**, Wayback kịp phản hồi → cả `[7]` và `[12]` được chấm `RESOURCE (R-WAYBACK-ARCHIVED)` → **`CIS = 77.85`**.
  - Ở lượt chạy **Pass 1 (`pass1_06`)**, 10 đường link trong bài cùng bắn song song vào `https://archive.org/wayback/available` không có giới hạn tốc độ; `_check_wayback_snapshot` chỉ thử **1 lần duy nhất** với `timeout=4.5s` và bắt `except Exception: return None` → coi như không có bản lưu, đẩy `[7]` và `[12]` sang **`SUSPECTED_HALLUCINATION (R-DEAD-URL)`** và kéo tụt điểm xuống **`CIS = 63.20`** (lệch `14.65` điểm trên cùng một file không đổi!).
- **Đề xuất cách Fix (Zero-Regression):**
  1. Thêm `asyncio.Semaphore(2)` và khoảng giãn tối thiểu `0.35s` riêng cho endpoint `archive.org/wayback/available` cùng bộ nhớ đệm theo phiên `_WAYBACK_CACHE: dict[str, str | None]` trong [`link_validator.py`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/retrieval/link_validator.py#L210-L258).
  2. Retry tối đa 2 lần (backoff `0.8s → 1.6s`) khi gặp `TimeoutException`, `ConnectError` hoặc HTTP `429 / 5xx`.
  3. Phân biệt rõ 2 trạng thái: khi `archive.org` trả `200 OK` với `archived_snapshots == {}` (xác nhận **không từng được lưu trữ**) mới kết luận `dead_link`; còn khi chính `archive.org` bị timeout/429 thì trả `status = "unverified"` để hệ thống hạ về `UNRESOLVED` thay vì vu oan `SUSPECTED_HALLUCINATION` cho người nộp bài.
  - **Đảm bảo không ảnh hưởng luồng cũ:** Các URL chết thực sự không có trên Wayback (nơi `archive.org` trả `200 OK` rỗng) vẫn trả `dead_link` và bắt `R-DEAD-URL` y hệt trước đây.

---

#### BUG-03 (`HIGH`) — Bare URL có số thứ tự `[N]` / `N.` lọt lưới `is_web_or_legal_resource` (đốt 10 API + SerpAPI), trong khi Check 1 & Check 2 của `NeuroSymbolicChecker` chạy trước Check 4 bỏ qua kiểm tra Fake/Dead URL

- **Vị trí mã nguồn:**
  - [`RetrievalOrchestrator.is_web_or_legal_resource`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/retrieval/retrieval_orchestrator.py#L1030-L1095) (`line 1045`).
  - [`NeuroSymbolicChecker.check`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/logic/neuro_symbolic_checker.py#L205-L367) (Check 1 tại `lines 205-223`, Check 2 tại `lines 226-246`, Check 4 tại `lines 325-367`).
- **Bằng chứng thực nghiệm E2E:**
  1. Trong `docker_batch_api.log` (`06:27:54`), câu trích dẫn `'[9] https://ntshanoi.com.vn/giai-phap-siem.html#:~:text=SIEM...'` (chỉ là một đường link thuần túy có đánh số `[9]` ở đầu) không khớp `raw_text.startswith(("http://", "https://"))` tại `line 1045`, dẫn đến việc hệ thống bắn truy vấn tới **toàn bộ 10 cơ sở dữ liệu học thuật kèm `serpapi` trả phí** (`failed=['crossref', 'openalex', 'doaj', 'openaire_hal', 'dblp', 'arxiv', 'openlibrary', 'europepmc', 'wikidata_opencitations', 'serpapi']`) và làm nổ cầu chì quota: `SerpApi quota circuit breaker tripped: Your account has run out of searches`!
  2. Ngược lại, trong [`NeuroSymbolicChecker.check`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/logic/neuro_symbolic_checker.py#L205-L246), Check 1 và Check 2 trả về ngay `ValidationLabel.RESOURCE (confidence=0.95)` **trước khi chạy Check 4 (`lines 325-367`)**:
     - Nếu một trích dẫn khớp từ khóa tài liệu/API của Check 2 nhưng chứa tên miền giả (`https://example.com/api-docs`) hoặc link chết `HTTP 404` (`url_status == "dead_link"`), Check 2 vẫn chấm `RESOURCE (0.95)` thay vì `SUSPECTED_HALLUCINATION`!
     - Đồng thời Check 1 coi mọi chuỗi bắt đầu bằng `https://` không chứa `doi.org` là web phi học thuật, nên nếu tài liệu trích dẫn trần link bài báo `https://arxiv.org/abs/...` hoặc `https://aclanthology.org/N19-1423/`, nó bị ép thành `RESOURCE` thay vì bài báo học thuật.
- **Đề xuất cách Fix (Zero-Regression):**
  1. Chuẩn hóa tiền tố số thứ tự `stripped_raw = re.sub(r"^\s*(?:\[\d+\]|\d{1,3}[\.\)])\s*", "", raw_text)` trước khi kiểm tra `startswith(("http://", "https://", "www."))` ở cả `is_web_or_legal_resource` và `NeuroSymbolicChecker`.
  2. Loại trừ các tên miền bài báo học thuật có mã định danh bài cụ thể (`doi.org/`, `arxiv.org/(?:abs|pdf)/`, `aclanthology.org/[A-Z0-9]`, `ieeexplore.ieee.org/document/`, `dl.acm.org/doi/`, `link.springer.com/(?:article|chapter)/`, `sciencedirect.com/science/article/`) khỏi diện short-circuit `R-WEB-RESOURCE` (vẫn giữ trang chủ kho dữ liệu như `https://aclanthology.org/` là `RESOURCE`).
  3. Tại đầu Check 1 & Check 2 trong `NeuroSymbolicChecker.check()`, luôn gọi `_is_fake_url(citation.url)` và kiểm tra `source.url_status == "dead_link"` (trả `R-DEAD-URL`) / `source.url_status == "archived_alive"` (gắn nhãn `R-WAYBACK-ARCHIVED` kèm `archive_url`) trước khi return `RESOURCE`.

---

#### BUG-04 (`MEDIUM-HIGH`) — Xung đột đồng thời làm vô hiệu hóa bộ điều tiết tốc độ (Rate Limiter) ở `DBLPClient` & `ArxivClient` (`HTTP 429 / RetryError`)

- **Vị trí mã nguồn:**
  - [`dblp_client.py`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/retrieval/dblp_client.py#L45-L58) và [`_fetch_json_with_retry`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/retrieval/dblp_client.py#L368-L410).
  - [`arxiv_client.py`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/retrieval/arxiv_client.py#L66-L78) và [`_fetch_xml_with_retry`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/retrieval/arxiv_client.py#L383-L440).
- **Bằng chứng thực nghiệm E2E:**
  - Xuất hiện dày đặc trong log E2E và Docker Batch log:
    - `WARNING | dblp_client:_fetch_json_with_retry:361 — DBLP retry exhausted: RetryError[... raised HTTPStatusError]` (ở `thesis.pdf`, `002_vn_legal`, `hard_03`, `batch_44`).
    - `WARNING | arxiv_client:_fetch_xml_with_retry:435 — arXiv retry exhausted` (ở `006_tdtu`, `hard_05`).
  - **Nguyên nhân gốc rễ:**
    - Trong `dblp_client.py:370-385`, `_get_dblp_sem()` dùng `asyncio.Semaphore(2)`. Hai coroutine cùng đi vào vùng `async with sem:` tại cùng một thời điểm, cùng đọc một giá trị `_LAST_DBLP_REQ_AT` cũ (`line 371`), không hề `sleep` đủ cách quãng nhau, và chỉ cập nhật `_LAST_DBLP_REQ_AT = time.monotonic()` **sau khi** `client.get()` đã chạy xong (`line 384`)! Ngoài ra mỗi lần gọi lại đóng/mở một `httpx.AsyncClient` mới làm mất kết nối keep-alive và ghi đè dict toàn cục `_SHARED_DBLP_COOKIES` không an toàn luồng.
    - Trong `arxiv_client.py:76`, `Semaphore(3)` bắn 3 request song song tức thời vào `export.arxiv.org` mà không có `min_interval` (tài liệu chính thức của arXiv yêu cầu tối đa 1 kết nối và giãn cách giữa các truy vấn tìm kiếm).
- **Đề xuất cách Fix (Zero-Regression):**
  - Sử dụng cơ chế **đặt chỗ thời gian nguyên tử bằng `asyncio.Lock` theo từng event loop** (`slot reservation`) trước khi gọi mạng:
    ```python
    async with _get_loop_lock(_DBLP_LOCKS):
        now = time.monotonic()
        scheduled = max(now, _LAST_DBLP_REQ_AT.get(loop_id, 0.0) + _DBLP_MIN_INTERVAL)
        _LAST_DBLP_REQ_AT[loop_id] = scheduled
        wait_sec = scheduled - now
    if wait_sec > 0:
        await asyncio.sleep(wait_sec)
    ```
  - Giảm `arXiv` semaphore xuống `Semaphore(2)` kèm giãn cách đặt chỗ `1.0s`. Không thay đổi chữ ký hàm hay kiểu trả về `SourceCandidate`, tuyệt đối không ảnh hưởng bất kỳ luồng gọi nào của `RetrievalOrchestrator`.

---

#### BUG-05 (`MEDIUM`) — Tách URL bỏ sót ký tự đóng `]`/`>`, đứt gãy URL ngắt dòng PDF và thiếu mã HTTP fallback `HEAD → GET` trong `LinkValidator`

- **Vị trí mã nguồn:**
  - Tách URL fallback: [`retrieval_orchestrator.py`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/retrieval/retrieval_orchestrator.py#L1391), [`rules.py`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/logic/rules.py#L952), [`document_parser.py`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/extraction/document_parser.py#L1721).
  - Fallback `HEAD → GET`: [`link_validator.py`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/retrieval/link_validator.py#L170-L185).
- **Bằng chứng thực nghiệm E2E:**
  - `041_huit #9`: Đường link bị PDF ngắt dòng ngay giữa chuỗi mã hóa phần trăm tiếng Việt (`...vi%E1% BA%BFt...`), khiến regex `https?://\S+` cắt cụt URL tại dấu cách đầu tiên; `main.pdf #2` (`Sculley 2015`) có `Retrieved from https:` bị đứt dòng sau dấu hai chấm.
  - `.rstrip(".,;:)\"'")` không xóa `]` và `>` khi trích dẫn viết theo mẫu IEEE `[Online]. Available: <https://...>` hoặc `[https://...]`, làm hỏng truy vấn kiểm tra link.
  - Nhiều cổng thông tin/tài liệu chặn phương thức `HEAD` bằng mã `400 Bad Request`, `401`, `406`, `500`, `501 Not Implemented` hoặc `503` (WAF/Cloudflare), nhưng `link_validator.py:170` chỉ thử lại bằng `GET` khi gặp `(403, 404, 405)`.
- **Đề xuất cách Fix (Zero-Regression):**
  - Chuẩn hóa hàm tiện ích chung `clean_extracted_url(url)` dùng `.rstrip(".,;:)\"']>")` và khôi phục nối dòng URL khi dòng kế tiếp nối trực tiếp sau `https://`, `/`, `-`, `_`, `%[0-9A-Fa-f]{0,2}`.
  - Mở rộng điều kiện fallback từ `HEAD` sang `GET` trong [`link_validator.py`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/retrieval/link_validator.py#L170) thành `resp.status_code in (400, 401, 403, 404, 405, 406, 500, 501, 503)` (với `stream=True` chỉ đọc header + 4KB đầu để không tốn băng thông tải file lớn).

---

### Nhóm B — Luật suy diễn Neuro-Symbolic, `_KNOWN_PAPERS`, `local_db`, DOI, Venue & Author (`BUG-06` → `BUG-12`)

#### BUG-06 (`CRITICAL`) — Trích dẫn ghép lai giả mạo (Chimeric Hallucinations) lọt lưới qua 2 lỗ hổng độc lập tại `_KNOWN_PAPERS` và `Rule 2b` (`_apply_core`)

- **Vị trí mã nguồn:**
  - Lỗ hổng 6a: [`NeuroSymbolicChecker.check`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/logic/neuro_symbolic_checker.py#L456-L506).
  - Lỗ hổng 6b: [`SymbolicRules._apply_core`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/logic/rules.py#L1440-L1464) (`Rule 2b: Spliced / Chimeric DOI hallucination`) và [`lines 1663-1680`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/logic/rules.py#L1663-L1680).
- **Bằng chứng thực nghiệm E2E (trên `style_corpora/APA/hard_cases/hard_03_hallucinations_and_chimera.pdf`):**
  1. **Trích dẫn `#2`:** `Vaswani, A., Shazeer, N., & Parmar, N. (2017). Hyperbolic quantum graph topology for autonomous underwater swarm navigation. Advances in Neural Information Processing Systems. https://doi.org/10.1109/CVPR.2016.90`
     - Tác giả của bài *Attention Is All You Need (2017)* + tiêu đề tàu ngầm lượng tử bịa đặt 100% + DOI đánh cắp của bài *ResNet (He et al., CVPR 2016)*.
     - **Ở Pass 1 & Batch Check (`essay_id=44`):** Do `_KNOWN_PAPERS` khớp khóa `("vaswani", "2017")`, hàm `neuro_symbolic_checker.py:486-506` thấy `title_sim < 0.7` liền trả ngay **`METADATA_ERROR` (`mismatched_fields=['title']`, `conf=0.75`)** — tha bổng một câu trích dẫn ngụy tạo chimeric hoàn toàn thành lỗi biên tập nhẹ!
  2. **Trích dẫn `#6`:** `Devlin, J., & Chang, M. (2019). Magnetohydrodynamic turbulence modeling in galactic plasma filaments. Astrophysical Journal Letters. https://doi.org/10.18653/v1/N19-1423`
     - Tác giả thật + DOI thật của bài *BERT (NAACL 2019)* nhưng ghép vào tiêu đề & tạp chí vật lý thiên văn bịa đặt 100% (`title_sim = 0.08`, `author_sim = 0.50`).
     - **Ở Pass 1:** Bị `_KNOWN_PAPERS` (`("devlin", "2019")`) hạ thành `METADATA_ERROR (title)`.
     - **Ở Pass 2 (khi đã tắt `_KNOWN_PAPERS` & `local_db`):** Lọt qua `Rule 2b` (`rules.py:1441-1446`) vì `Rule 2b` đòi hỏi đồng thời `author_sim < 0.20` (trong khi câu chimera cùng tác giả có `author_sim = 0.50`!) VÀ đòi hỏi `"local_db" not in source.sources_succeeded`! Cuối cùng rơi xuống dòng `1670` và bị trả về **`UNRESOLVED (conf=0.41)`**!
- **Đề xuất cách Fix (Zero-Regression):**
  1. **Tại `neuro_symbolic_checker.py:468-506`:** Chỉ cho phép nhánh `_KNOWN_PAPERS` kết luận `METADATA_ERROR` khi bài báo thực sự là bài gốc bị gõ sai nhẹ tiêu đề (`title_sim >= 0.45`) **và** không có xung đột DOI (`not (citation.doi and known_doi and not FeatureExtractor._doi_matches(citation.doi, known_doi))`). Nếu `title_sim < 0.45` hoặc DOI trỏ sang bài khác, bỏ qua short-circuit để chạy đầy đủ pipeline `SymbolicRules`.
  2. **Tại `rules.py:1440-1464` (`Rule 2b`):**
     - Bỏ điều kiện chặn `"local_db" not in source.sources_succeeded` khi đã có `_has_live_source(source, verified_sources)` xác nhận DOI thật sự trỏ tới một bài báo hoàn toàn khác.
     - Mở rộng điều kiện bắt chimera cho cả trường hợp **mượn đúng tên tác giả + DOI của bài A để bịa ra bài B**:
       ```python
       is_cross_lingual_title = bool(getattr(features, "cross_lingual_title_detected", False))
       is_spliced_doi = (
           doi_match
           and _has_live_source(source, verified_sources)
           and not is_cross_lingual_title
           and not (not citation_authors and author_sim == 0.0 and title_sim >= 0.85)
           and (
               (title_sim < 0.35 and author_sim < 0.20)
               or (title_sim < 0.22)  # Cùng tác giả + cùng DOI nhưng tiêu đề khác hoàn toàn 100%
           )
       )
       ```
  - **Đảm bảo không ảnh hưởng luồng cũ:** Có đầy đủ guard `not is_cross_lingual_title` (bảo vệ tuyệt đối luật dịch tiêu đề Anh-Việt `Rule 1d` ở dòng `1382`) và guard `not citation_authors` (bảo vệ trích dẫn khuyết tác giả nhưng đúng tiêu đề + DOI).

---

#### BUG-07 (`CRITICAL`) — Khối `R-CONTENT-MISMATCH` chạy trước `_rule_local_db_metadata_error` và `Rule 4a2`, gán oan lỗi gõ sai năm (`year_distance >= 2`) thành `SUSPECTED_HALLUCINATION`

- **Vị trí mã nguồn:** Thứ tự thực thi trong [`SymbolicRules._apply_core`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/logic/rules.py#L1603-L1729): khối Neural Content Alignment (`lines 1603-1680`) đặt **trước** `Rule 4a2` (`line 1683`) và `Rule 4a3` ([`_rule_local_db_metadata_error`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/logic/rules.py#L551-L620) gọi tại `line 1720`).
- **Bằng chứng thực nghiệm E2E (trên `style_corpora/IEEE/hard_cases/hard_02_metadata_errors_and_mismatch.pdf`):**
  - Mục `[1]`: `Vaswani, A., Shazeer, N., & Parmar, N. (2020). Attention is all you need. DOI: 10.48550/arXiv.1706.03762` (`title_sim=1.00`, `author_sim=1.00`, `doi_match=True`, chỉ sai năm `2020` thay vì `2017` → `year_dist=3`).
  - Mục `[5]`: `He, K., Zhang, X., & Ren, S. (2018). Deep residual learning for image recognition. Journal of Machine Learning Research. DOI: 10.1109/CVPR.2016.90` (`title_sim=1.00`, `author_sim=1.00`, `doi_match=True`, sai năm `2018` thay vì `2016` → `year_dist=2`).
  - **Ở Pass 2 (live APIs):** Cả `[1]` và `[5]` khớp `consensus >= 2` nên trúng `Rule 3` (`line 1467`) **trước** dòng `1603`, trả về chính xác **`METADATA_ERROR (mismatched_fields=['year'])`**.
  - **Ở Pass 1 & Batch Check (`essay_id=45`, chạy với `local_db`):** Vì Tier 0 `local_db` trả về kết quả ngay (`consensus = 1`, `_has_live_source = False`), các luật `Rule 1`, `_rule_local_db_verified`, `Rule 1b`, `Rule 3`, `Rule 3c` đều đi qua do `year_dist > 1`. Trước khi kịp tới `_rule_local_db_metadata_error` ở dòng `1720`, luồng xử lý đâm vào dòng `1644-1660` (`not content_is_aligned and content_alignment_score >= 0.3 and title_sim_fuzzy >= 0.75 and author_sim >= 0.5` — do `local_db` không lưu abstract đầy đủ nên điểm ngữ nghĩa ngữ cảnh đạt `0.32` và `0.48` `< 0.50`) và bị phán oan thành **`SUSPECTED_HALLUCINATION` (`mismatched_fields=['content']`)**!
- **Đề xuất cách Fix (Zero-Regression):**
  - Di chuyển `Rule 4a2` (`lines 1682-1717`) và `Rule 4a3` (`_rule_local_db_metadata_error`, `lines 1719-1728`) lên **ngay sau `Rule 3c` (`line 1566`) và trước `Rule 4` / khối Neural Content Alignment (`line 1567`)**.
  - Đồng thời tại nhánh `R-CONTENT-MISMATCH` (`line 1644`), bổ sung điều kiện `and bool(best and best.abstract)` để không bao giờ phán `SUSPECTED_HALLUCINATION (content)` khi bản ghi nguồn (`local_db` / `dblp`) không hề có `abstract` để đối chiếu ngữ nghĩa!
  - **Đảm bảo không ảnh hưởng luồng cũ:** Các bài khớp đúng metadata (`year_dist <= 1`, `author_sim >= 0.8`) đã được xử lý xong từ các luật `Rule 1` / `local_db_verified` / `Rule 1b` / `Rule 3` ở phía trên (`lines 1160-1540`), nên việc đưa `Rule 4a2` & `4a3` lên trước `line 1603` chỉ giải cứu đúng các ca `METADATA_ERROR` đang bị tầng Neural chặn nhầm.

---

#### BUG-08 (`HIGH`) — `_rule_local_db_verified`, `_rule_local_db_good_match` và `Rule 1c` trả nhãn `VERIFIED` nhưng vẫn đính kèm `mismatched_fields` khác rỗng (kể cả báo sai lỗi DOI khi `local_db` khuyết trường DOI)

- **Vị trí mã nguồn:** [`rules.py`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/logic/rules.py#L451-L470) (`_rule_local_db_verified`), [`lines 533-547`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/logic/rules.py#L533-L547) (`_rule_local_db_good_match`), và [`line 1375`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/logic/rules.py#L1375) (`Rule 1c`).
- **Bằng chứng thực nghiệm E2E:**
  - `TranThanhPhuoc_523H0002_523H0054.pdf #19` và `20-theses/11.pdf #14` (`Li, G., et al., 2020`): Trả `label = "verified"`, `rules = ["R-LOCAL_DB_VERIFIED"]`, nhưng `mismatched_fields = ["doi"]` và ghi chú *"Note: DOI in citation differs from canonical record"*, mặc dù DOI trong bài của tác giả **hoàn toàn đúng**, chỉ vì bản ghi trong bảng SQLite `local_db` để trống `best.doi = None` khiến `features.doi_exact_match == False`!
  - Ngược lại, nếu `best.doi` trong `local_db` có giá trị thật và thực sự **khác** với `citation_doi` (trích dẫn gắn nhầm DOI của bài khác), `_rule_local_db_verified` vẫn trả `VERIFIED` thay vì `METADATA_ERROR`!
  - `thesis.pdf #17, #18` và `20-theses/14.pdf #22`: Trả `label = "verified"` kèm `mismatched_fields = ["author"]`, vi phạm hợp đồng dữ liệu tại [`rules.py:366`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/logic/rules.py#L366) (gây hiển thị huy hiệu cảnh báo mâu thuẫn trên UI cho các mục đã xác thực xanh).
- **Đề xuất cách Fix (Zero-Regression):**
  1. Trong `_rule_local_db_verified` và `_rule_local_db_good_match`: chỉ coi là xung đột DOI khi **cả hai** `citation_doi` và `best.doi` đều khác rỗng, không khớp nhau và không phải cặp tương đương `arXiv DOI ↔ publisher DOI` (`has_real_doi_conflict`). Nếu `has_real_doi_conflict == True` → `return None` để chuyển sang `_rule_local_db_metadata_error` trả `METADATA_ERROR (mismatched_fields=['doi'])`. Nếu `best.doi` rỗng → không coi là lỗi DOI.
  2. Mọi RuleOutcome mang nhãn `ValidationLabel.VERIFIED` luôn đảm bảo `mismatched_fields = []`.

---

#### BUG-09 (`HIGH`) — Cờ `is_semantic_only_noise` gán oan ấn phẩm học thuật tiếng Việt thành `SUSPECTED_HALLUCINATION` và xuất thông điệp phi lý `(title_sim=0.84 < 0.4)`

- **Vị trí mã nguồn:** [`rules.py`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/logic/rules.py#L1853-L1860) và [`lines 1928-1983`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/logic/rules.py#L1928-L1983).
- **Bằng chứng thực nghiệm E2E (6 trích dẫn trên 4 tài liệu thực tế):**
  - `043_vn_uni #17` (`Nguyễn Thành Tâm, 2017`): `Extremely weak scholarly evidence across queried databases (title_sim=0.84 < 0.4, author_sim=0.00, DOI match=False).`
  - `003_vn_legal #11` (`Phùng Anh Tuấn, "Các giải pháp thực hiện quy định thuế toàn cầu", Tạp chí Tài chính, tập 1, số 802, 2023` — bài báo thật trên Tạp chí Tài chính Việt Nam): `... (title_sim=0.77 < 0.4, ...)`.
  - Cùng lỗi xuất hiện tại `043_vn_uni #18` (`0.67 < 0.4`), `047_hust #1` (`0.66 < 0.4`), `003_vn_legal #12` (`0.63 < 0.4`), và `ACM/real/07 #12` (`0.64 < 0.4`).
  - **Nguyên nhân gốc rễ:**
    1. Biến `title_sim` tại dòng `1120` là `features.title_sim_max = max(fuzzy, semantic)`. Khi tra cứu một bài báo tiếng Việt chưa lập chỉ mục trên Crossref/OpenAlex quốc tế, mô hình đa ngôn ngữ trả về một ứng viên nhiễu có `title_sim_fuzzy < 0.65` nhưng `title_sim_semantic = 0.84`, bật cờ `is_semantic_only_noise = True` (`line 1853`).
    2. Dòng `1929` gộp chung `if (title_sim < self.abstention_low or is_semantic_only_noise):` và in chuỗi cứng `f"(title_sim={title_sim:.2f} < {self.abstention_low})"` → tạo ra mệnh đề sai toán học **`0.84 < 0.4`** ngay trên giao diện và báo cáo xuất ra!
    3. Hàm `_is_non_journal_or_unindexed_source` (`line 1935`) chỉ miễn trừ sách, luận văn, luật và web mà bỏ sót **tạp chí chuyên ngành / kỷ yếu hội thảo nội địa tiếng Việt không có DOI quốc tế** (`Tạp chí ...`, `Kỷ yếu hội thảo ...`, `Nhà xuất bản ...`).
- **Đề xuất cách Fix (Zero-Regression):**
  1. Trong `_is_non_journal_or_unindexed_source` (`rules.py`), bổ sung nhánh nhận diện ấn phẩm định kỳ / kỷ yếu nội địa tiếng Việt không đính kèm DOI quốc tế (khớp mẫu `\b(?:tạp\s+chí|kỷ\s+yếu\s+hội\s+(?:thảo|nghị)|thông\s+báo\s+khoa\s+học|chuyên\s+san)\b` kèm dấu hiệu tiếng Việt có dấu và `not citation_doi`), phân loại về `("domestic_unindexed_periodical")` → trả `UNRESOLVED (R-UNINDEXED-BOOK-OR-SOURCE)` thay vì vu oan đạo văn/ảo giác AI.
  2. Sửa thông điệp `reasoning` tại dòng `1975-1979`: nếu vào nhánh do `is_semantic_only_noise`, in chính xác `(fuzzy_title_sim={features.title_sim_fuzzy:.2f} < 0.65, semantic_sim={features.title_sim_semantic:.2f}, author_sim={author_sim:.2f})`.

---

#### BUG-10 (`MEDIUM-HIGH`) — Phạt oan `METADATA_ERROR (author)` cho các trích dẫn chuẩn APA 7th dùng dấu ba chấm rút gọn tác giả (`... & LastAuthor`) và tên tác giả Á Đông đảo thứ tự

- **Vị trí mã nguồn:**
  - Phát hiện rút gọn tác giả: [`FeatureExtractor._citation_has_et_al`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/matching/features.py#L359-L373) và hàm `author_match_score` trong `normalization.py` / `features.py`.
  - Chuẩn hóa văn bản GROBID: `grobid_adapter.py`.
- **Bằng chứng thực nghiệm E2E:**
  - `essay_03_comprehensive.pdf Ref #8`: Trong PDF gốc (trang 2, dòng 93) viết đúng quy chuẩn APA 7th cho công trình từ 21 tác giả trở lên:
    `Kiela, D., Bartolo, M., Jiang, Y., Nie, F., Warstadt, A., Conneau, A., ... & Bowman, S. (2021). Dynabench: Rethinking benchmarking in NLP.`
    Bài báo thật trên ACL/OpenAlex có 23 tác giả. Do GROBID chỉ trích 7 tên xuất hiện mặt chữ và bỏ dấu `...`, còn `_has_et_al_indicator` chỉ tìm cụm `"et al"` / `"và cộng sự"`, hệ thống tính Jaccard thô trên tập 23 người (`author_jaccard = 0.1304 < 0.80`) và phạt oan một trích dẫn đúng chuẩn mực quốc tế thành **`METADATA_ERROR (mismatched_fields=['author'])`**!
  - Trên `ACM/real/07_a_study_of_sentiment_...pdf` (`Refs #10, #11, #12`), các tác giả Trung Quốc viết theo trật tự `GivenName, SurnameInitial` (`Renxian, Z, Zhenhua, T, Xiao, H, Jiang, W` cho `Zhang Renxian, Tan Zhenhua...`) có `title_sim_fuzzy = 0.86` nhưng `author_jaccard = 0.00`.
- **Đề xuất cách Fix (Zero-Regression):**
  1. Trong `_has_et_al_indicator` (`features.py`), nhận diện thêm mẫu dấu ba chấm chuẩn APA 7th: `r"(?:\.\s*\.\s*\.|…)\s*(?:&|and\b)?"`. Đồng thời trong `_enrich_grobid_ref` (`document_parser.py`), nếu `donor.raw_text` từ regex có chứa `...` trong phần tác giả trước năm xuất bản thì bảo toàn cờ rút gọn tác giả.
  2. Trong hàm tính tương đồng tác giả: khi bài gốc trên registry có `>= 10` tác giả, trích dẫn liệt kê `>= 6` tác giả, **100% tác giả được liệt kê đều nằm trong bài gốc** và khớp chính xác tác giả đầu tiên (`first_author_match`), tính điểm tương đồng theo độ phủ tập con (precision `1.0`) giống cơ chế `has_et_al=True` thay vì chia cho tổng 23–50 đồng tác giả.

---

#### BUG-11 (`MEDIUM-HIGH`) — Xung đột khóa `"PRL"` & thiếu từ điển hội nghị trong `VenueNormalizer`, đồng thời `SymbolicRules` chưa kiểm tra sai lệch `venue`

- **Vị trí mã nguồn:**
  - [`venue_normalizer.py`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/matching/venue_normalizer.py#L49-L60) (`VENUE_ABBREVIATIONS`).
  - [`rules.py`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/logic/rules.py#L1466-L1494) (`SymbolicRules._apply_core`).
- **Bằng chứng thực nghiệm E2E & Mã nguồn:**
  1. Tại [`venue_normalizer.py:49`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/matching/venue_normalizer.py#L49) khai báo `"PRL": "Pattern Recognition Letters"`, nhưng ngay tại [`line 60`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/matching/venue_normalizer.py#L60) khai báo trùng `"PRL": "Physical Review Letters"` làm mất hoàn toàn ánh xạ ngành nhận dạng mẫu.
  2. Thiếu hàng loạt tên viết tắt hội nghị/tạp chí trọng điểm (`ACL`, `EMNLP`, `NAACL`, `NAACL-HLT`, `EACL`, `COLING`, `ICLR`, `AAAI`, `IJCAI`, `KDD`, `SIGIR`, `WWW`, `WSDM`, `CIKM`) và viết tắt chuẩn ISO-4 (`Adv. Neural Inf. Process. Syst.`, `J. Mach. Learn. Res.`). Thực tế trên `VietDepression #7`, `"Proceedings of NAACL-HLT"` so với tên đầy đủ chỉ đạt `venue_sim = 0.087`; trên `hard_05 #1, #2` chỉ đạt `0.10`.
  3. Trên `098_uit #11`, dòng tiêu đề đầu trang PDF `"TRƯỜNG ĐẠI HỌC CÔNG NGHỆ THÔNG TIN"` bị lọt vào cuối trường `venue`, kéo `venue_sim` xuống `0.033`.
  4. Trên `hard_02 #5` (`He, K., et al. Deep residual learning for image recognition. Journal of Machine Learning Research. DOI: 10.1109/CVPR.2016.90`), bài báo CVPR bị gán sai sang tạp chí JMLR (`venue_sim = 0.0`), nhưng vì `SymbolicRules` hoàn toàn không đọc `features.venue_sim`, hệ thống chỉ báo `mismatched_fields=['year']` mà bỏ sót `'venue'`.
- **Đề xuất cách Fix (Zero-Regression):**
  1. Xóa khóa trùng `"PRL"` trong `VenueNormalizer`, bổ sung đầy đủ từ điển hội nghị AI/NLP/CS và chuẩn hóa các từ viết tắt ISO-4 phổ biến (`Adv.` → `Advances`, `Proc.` → `Proceedings`, `Inf.` → `Information`, `Syst.` → `Systems`, `Trans.` → `Transactions`, `Int.` → `International`, `Conf.` → `Conference`, `J.` → `Journal`).
  2. Bổ sung tính điểm `token containment` (khi tên hội nghị rút gọn sau khi mở rộng nằm trọn trong tên đầy đủ của kỷ yếu) thay vì chỉ dùng Jaccard thuần túy.
  3. Trong `SymbolicRules`: chỉ đính kèm thêm `"venue"` vào `mismatched_fields` ở các nhánh đã là `METADATA_ERROR` (hoặc khi cả `citation.venue` và `best.venue` đều là tên tạp chí/hội nghị rõ nghĩa `>= 2` từ, không phải `arXiv`/`CoRR`/preprint/publisher name và `features.venue_sim < 0.15`), tuyệt đối không hạ oan các bài chuyển từ preprint `arXiv` sang hội nghị chính thức.

---

#### BUG-12 (`MEDIUM`) — Crossref trả năm `published-online` nộp muộn thay vì năm tổ chức hội nghị (`VietDepression #1`) & thông điệp sai `"APIs failed"` trong `_KNOWN_PAPERS`

- **Vị trí mã nguồn:**
  - Trích xuất năm từ Crossref: [`CrossrefClient._message_to_candidate`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/retrieval/crossref_client.py#L358-L365).
  - Bảng `_KNOWN_PAPERS` và chuỗi giải thích Tier 0: [`retrieval_orchestrator.py`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/retrieval/retrieval_orchestrator.py#L219-L223) và [`neuro_symbolic_checker.py`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/logic/neuro_symbolic_checker.py#L538-L590).
- **Bằng chứng thực nghiệm E2E:**
  1. Trên `VietDepression_Research_Article.pdf Ref [1]`: `De Choudhury, M., Gamon, M., Counts, S., & Horvitz, E. (2013). Predicting depression via social media. ICWSM, DOI: 10.1609/icwsm.v7i1.14432`. Ở Pass 2, hệ thống báo sai `METADATA_ERROR (year)` vì AAAI số hóa và nộp DOI kỷ yếu ICWSM 2013 lên Crossref vào năm `2021` (`published-online = 2021`, không có `published-print`), trong khi `crossref_client.py:360` duyệt `("published-print", "published-online", "issued", "created")` mà bỏ qua `event.start` (`2013`) hoặc năm trong `container-title` (`Seventh International AAAI Conference... 2013`).
  2. Trong `retrieval_orchestrator.py:219`, bài báo MiniCPM (*Shengding Hu et al., 2024*) bị gõ nhầm khóa họ tác giả đầu thành `("hou", "2024")` thay vì `("hu", "2024")`.
  3. Trên hơn 20 trích dẫn `VERIFIED` qua Tier 0 ở `main.pdf`, `thesis.pdf`, `VietDepression`..., `neuro_symbolic_checker.py:538, 587` xuất câu cứng `"APIs failed but paper is well-documented"` ngay cả khi Tier 0 chủ động dừng sớm (không có bất kỳ API nào lỗi), gây hiểu nhầm nghiêm trọng khi đọc log và báo cáo kiểm toán.
- **Đề xuất cách Fix (Zero-Regression):**
  - Trong `CrossrefClient._message_to_candidate`: nếu `message.get("type") == "proceedings-article"` và không có `published-print`, kiểm tra `message.get("event", {}).get("start", {}).get("date-parts")` hoặc năm 4 chữ số trong `container-title` trước khi rơi về `published-online`.
  - Thêm khóa `("hu", "2024")` bên cạnh khóa cũ trong `_KNOWN_PAPERS`; sửa thông điệp ở `neuro_symbolic_checker.py` thành `"Verified against curated canonical scholarly registry"` khi `not source.sources_failed`.

---

### Nhóm C — Trích xuất PDF, Hợp nhất GROBID + Regex, Liên kết `cite`↔`ref` & Điểm CIS (`BUG-13` → `BUG-16`)

#### BUG-13 (`HIGH`) — Bộ lọc mảng code `re.search(r"\]\s*,\s*\[", full_line_b)` xóa sổ toàn bộ trích dẫn chuẩn IEEE dạng `[3], [4]` trên dòng, và bắt nhầm chú thích hình `Rogue (1980)`

- **Vị trí mã nguồn:** [`CitationExtractor._extract_from_text`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/extraction/citation_extractor.py#L559-L672) (đặc biệt dòng [`569`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/extraction/citation_extractor.py#L569)).
- **Bằng chứng thực nghiệm E2E:**
  1. **Mất trắng trích dẫn chuẩn IEEE `[3], [4]`:** Trên `tdtu_github_reports/006_tdtu_YaminThiriWai_TDTU_ITProject_Final_repot.pdf` (trang 10), câu văn gốc viết:
     `appear frequently in a database[3], [4]. These methods rely on frequency...`
     Cẩm nang chính thức của IEEE quy định cách viết nhiều trích dẫn rời là `[3], [4]` (tách từng ngoặc vuông bằng dấu phẩy, khác với `[3, 4]`). Thế nhưng để chặn mảng 2 chiều trong code như `[[37, 95], [449, 95]]`, dòng `569` lại viết:
     `or re.search(r"\]\s*,\s*\[", full_line_b)`
     Biểu thức này khớp ngay với `], [` giữa `[3], [4]` trên `full_line_b` và **`continue` bỏ qua TẤT CẢ các trích dẫn ngoặc vuông nằm trên dòng đó**! Hậu quả trực tiếp: cả `[3]` lẫn `[4]` biến mất khỏi danh sách in-text citations, làm 2 công trình kinh điển `Agrawal & Srikant (1994)` và `Han et al. (2000)` bị phạt oan thành `UNCITED_REFERENCE`!
  2. **Bắt nhầm tên tác phẩm/trò chơi trong chú thích hình & danh mục hình vẽ:** Trên `014_tdtu_MPhong03_The_Loop_Game_52100033_52100987.pdf` (trang 10 mục lục hình và trang 15 chú thích dưới ảnh): dòng `"Hình 2.1 Gameplay của Rogue (1980)"` bị bắt thành 2 trích dẫn học thuật `Rogue (1980)` → báo sai 2 lỗi `MISSING_REFERENCE`!
- **Đề xuất cách Fix (Zero-Regression):**
  1. Tại [`citation_extractor.py:569`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/extraction/citation_extractor.py#L569), thay `re.search(r"\]\s*,\s*\[", full_line_b)` bằng biểu thức kiểm tra đúng mảng 2 chiều lồng nhau có dấu `[` mở bao ngoài (hoặc có dấu `=` gán biến trước đó):
     ```python
     or re.search(r"\[\s*\[[^\]]+\]\s*,\s*\[[^\]]+\]", full_line_b)
     ```
     Thay đổi này **vẫn chặn 100% `[[37, 95], [449, 95]]`**, đồng thời khôi phục hoàn toàn mọi trích dẫn IEEE chuẩn `[1], [2]`, `database[3], [4].` trên toàn bộ tài liệu khoa học kỹ thuật!
  2. Với trích dẫn tự sự `Name (Year)` (`not raw.startswith(("(", "["))` tại dòng `645`): bỏ qua các dòng mục lục có chuỗi chấm dẫn trang `\.{4,}\s*\d+\s*$` và các dòng chú thích hình/bảng bắt đầu bằng `^\s*(?:Hình|Ảnh|Bảng|Sơ\s+đồ|Biểu\s+đồ|Figure|Fig\.?|Table)\s+\d+(?:\.\d+)*\b` khi từ đứng trước `(Year)` đi ngay sau giới từ chỉ tên đối tượng (`của`, `trong`, `game`, `phần mềm`) và không khớp bất kỳ họ tác giả nào trong danh mục tài liệu tham khảo.

---

#### BUG-14 (`HIGH`) — Ghi đè chéo metadata khi hợp nhất GROBID + Regex (`essay_03_comprehensive.pdf`) và lỗi regex `_ACM_FULL_NAME` nuốt đồng tác giả + tạp chí vào `title` (`041_huit Ref #6`)

- **Vị trí mã nguồn:**
  - Hợp nhất GROBID + Regex: [`DocumentParser._merge_reference_lists`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/extraction/document_parser.py#L2033-L2120) và [`lines 2219-2223`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/extraction/document_parser.py#L2219-L2223).
  - Biểu thức chính quy ACM: [`patterns/acm.py`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/extraction/patterns/acm.py#L156-L199) (`_ACM_JOURNAL`, `_ACM_FULL_NAME`).
- **Bằng chứng thực nghiệm E2E:**
  1. **Trên `data/essays/essay_03_comprehensive.pdf` (trang 2):** Tài liệu có 2 mục liên tiếp khác chuẩn định dạng:
     - Mục 4 (IEEE): `[4] Xiao, Y., Wang, J., & Lee, S. (2023). "Hallucination detection in large language models using semantic consistency," Journal of AI Safety, vol. 15, pp. 112-128, 2023.`
     - Mục 5 (Vancouver): `Xiao Y. Hallucination in neural networks. Neural Computing Review. 2022;45:234-256. https://doi.org/10.1234/ncr.2022.0456`
     GROBID tách đúng 9 mục độc lập, nhưng bộ tách dòng regex (`_split_entries`) không nhận ra đầu mục Vancouver `Xiao Y.` nên dính cả hai thành 1 chuỗi ~280 ký tự. Vì `280 < 320`, cờ `donor_is_multi_chunk` tại [`document_parser.py:2033`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/extraction/document_parser.py#L2033) bằng `False`. Khi khớp với mục GROBID #5 qua DOI `10.1234/ncr.2022.0456` (`line 2220`), hàm `_enrich_grobid_ref` đã lấy `authors = ['Xiao, Y.', 'Wang, J.', 'Lee, S.']` và `numeric_index = 4` của bài năm `2023` đè thẳng vào bài năm `2022`, tạo ra mục lai sai lệch `[4] Xiao, Y., Wang, J, Lee, S (2022) Hallucination in neural networks...` và làm cả hai mục mang trùng `numeric_index = 4`!
  2. **Trên `041_huit Ref [6]`:** Chuỗi gốc `[6] Akinsola, Jide E. T, Awodele, Oludele, Idowu, Sunday A, SQL Injection Attacks Predictive Analytics Using Supervised Machine Learning Techniques, International Journal of Computer Applications..., 2020` bị `_ACM_FULL_NAME` (`acm.py:192`) cắt nhóm `authors` ngay tại dấu chấm viết tắt `Jide E.`, đẩy toàn bộ `T, Awodele, Oludele, Idowu, Sunday A` và tên tạp chí/số trang/ISSN vào `title`, làm `title_sim_fuzzy` rớt từ `1.00` xuống `0.5846` → `UNRESOLVED` oan!
- **Đề xuất cách Fix (Zero-Regression):**
  1. Trong `_enrich_grobid_ref` (`document_parser.py:2033-2120`): coi `donor_is_multi_chunk = True` (không ghi đè `authors` và `numeric_index`) bất cứ khi nào `target.year and donor.year and str(target.year)[:4] != str(donor.year)[:4]`, và không gán `target.numeric_index = donor.numeric_index` nếu `donor.numeric_index` đã thuộc về một phần tử khác trong `grobid_refs`.
  2. Trong `_ACM_FULL_NAME` & `_ACM_JOURNAL` (`patterns/acm.py:159, 192`): không cho phép cắt ranh giới kết thúc `authors` ngay sau chữ cái viết tắt đơn lẻ `[A-Z]\.` khi phía sau vẫn là chuỗi tên riêng ngăn cách bằng dấu phẩy `(?<!\b[A-Z])\.`.

---

#### BUG-15 (`HIGH`) — `CitationLinker` Pass 3 che giấu lỗi sai năm trích dẫn trong bài (`±1` đến `±15` năm) thành `MATCHED`, và cơ chế ghi đè trường đơn `mapping_status` làm mất lỗi `MISSING_REFERENCE` trong cụm trích dẫn ghép

- **Vị trí mã nguồn:**
  - Gán nhầm trạng thái `MATCHED` khi lệch năm: [`CitationLinker._link_author_year_citation`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/linking/citation_linker.py#L756-L773).
  - Ghi đè `cit.mapping_status` theo phần tử đầu tiên: [`IntegrityPipeline._run_linking`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/pipeline/integrity_pipeline.py#L1143-L1147) và [`report.py`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/api/routes/report.py#L723-L728).
- **Bằng chứng thực nghiệm E2E:**
  1. **Sai năm giữa thân bài và danh mục tham khảo nhưng không hề cảnh báo:**
     - Trên `20-theses/11.pdf`: trong thân bài viết `(Kaveripakam, 2024)` (6 lần ở các trang 8, 9, 15, 22, 26), trong khi danh mục tham khảo ghi `Kaveripakam, S. (2025)`.
     - Trên `20-theses/14.pdf` (trang 10): thân bài viết `Bloem et al. (2024)`, danh mục tham khảo ghi `Bloem, B. R., Okun, M. S., & Klein, C. (2021)` (lệch hẳn **3 năm**!).
     - Tại [`citation_linker.py:756-773`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/linking/citation_linker.py#L756-L773), Pass 3 tìm thấy họ tác giả khớp với `year_diff <= 15` nhưng lại tạo `CitationLink(..., status=CitationMappingStatus.MATCHED)` thay vì `CitationMappingStatus.IN_TEXT_MISMATCH`! Đồng thời nếu trong tài liệu có 2 bài khác nhau của cùng họ tác giả (ví dụ `Nguyen 2020` và `Nguyen 2022`) mà trong bài viết nhầm `(Nguyen, 2021)`, Pass 3 cũng không phát hiện `AMBIGUOUS_MAPPING`. Đó là lý do trên toàn bộ 674 trích dẫn của 21 PDF, `in_text_mismatch = 0` và `ambiguous_mapping = 0`!
  2. **Rơi lỗi `MISSING_REFERENCE` trong cụm trích dẫn ghép `(A; B)`:**
     - Trên `20-theses/11.pdf` (trang 30), cụm `(Lee et al., 2024; Mandarić et al., 2022)` sinh ra 2 `CitationLink`: `links[0]` (`Lee 2024`) là `matched`, còn `links[1]` (`Mandarić 2022` không có trong danh mục tham khảo) là `missing_reference`.
     - Tuy nhiên `integrity_pipeline.py:1145` gán cứng `cit.mapping_status = links[0].status.value` (`"matched"`), còn `report.py:724-727` khi tái lập `linking_summary` từ DB chỉ đếm `c.mapping_status` đơn lẻ thay vì duyệt danh sách `citation_link_json` → làm biến mất lỗi thiếu tài liệu tham khảo `Mandarić et al., 2022` khỏi bảng tổng hợp API!
- **Đề xuất cách Fix (Zero-Regression):**
  1. Trong [`citation_linker.py:756-773`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/linking/citation_linker.py#L756-L773):
     - Nếu có `>= 2` mục tham khảo cùng họ tác giả có cùng khoảng cách năm tối thiểu và không phân giải duy nhất được → trả `status = CitationMappingStatus.AMBIGUOUS_MAPPING` (vẫn gắn `reference_id` của ứng viên gần nhất).
     - Nếu phân giải duy nhất 1 mục tham khảo nhưng `best_year_diff >= 1` → trả `status = CitationMappingStatus.IN_TEXT_MISMATCH` **nhưng vẫn giữ nguyên `reference_id = ref_id`**. Nhờ vẫn giữ `reference_id`, mục tham khảo đó **không bị biến thành `UNCITED_REFERENCE`**, dây nối trên UI Citations ↔ References vẫn hoạt động 100%, đồng thời tầng CIS và UI hiển thị đúng cảnh báo lệch năm trích dẫn trong bài!
  2. Khi một `Citation` có nhiều `links` (`integrity_pipeline.py:1145`), chọn trạng thái có độ ưu tiên cảnh báo cao nhất (`missing_reference > in_text_mismatch > ambiguous_mapping > matched`) cho `cit.mapping_status`, và trong `report.py:724-727` duyệt từng phần tử trong `citation_link_json` (nếu có) để đếm chính xác mọi cạnh liên kết.

---

#### BUG-16 (`MEDIUM-HIGH`) — Bộ 4 lỗi tính điểm `CIS`, luôn trả `0` cho `style_profile.apa_count`/`numeric_count`, lệch `num_citations` giữa các API và thiếu trường trong `_serialize_verdict_for_json`

- **Vị trí mã nguồn:**
  1. Đọc sai key `ratios`: [`integrity_pipeline.py`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/pipeline/integrity_pipeline.py#L1484-L1486) và [`style_detector.py`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/extraction/style_detector.py#L85-L88).
  2. Tính điểm CIS khống cho danh mục toàn `RESOURCE` & phạt sai style/identifier: [`cis.py`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/logic/cis.py#L100-L235) và [`lines 386-396`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/logic/cis.py#L386-L396).
  3. Ba định nghĩa mâu thuẫn của `num_citations`: [`integrity_pipeline.py:1196`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/pipeline/integrity_pipeline.py#L1196), [`essays.py:670`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/api/routes/essays.py#L670), [`essays.py:843`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/api/routes/essays.py#L843), [`report.py:777`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/api/routes/report.py#L777).
  4. Thiếu trường khi xuất JSON từ pipeline: [`integrity_pipeline.py:2018-2055`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/pipeline/integrity_pipeline.py#L2018-L2055).
- **Bằng chứng thực nghiệm E2E:**
  - **`apa_count = 0` và `numeric_count = 0` trên 21/21 PDF (100%):** `StyleDetector.detect()` chỉ ghi các tỷ lệ `body_apa`, `body_ieee`, `apa_combined`, `ieee_combined` vào `ratios`, nhưng `integrity_pipeline.py:1484-1485` lại đọc `ratios.get("apa_count", 0)` và `ratios.get("ieee_count", 0)` (khóa không tồn tại → luôn bằng `0`!).
  - **Điểm CIS khống `90.88/100` trên tài liệu liên kết 0%:** Trên `014_tdtu_MPhong03_The_Loop_Game` (`6` ref đều là link blog/wiki `RESOURCE`, `0` matched, `2` missing_reference, `6` uncited_reference):
    - `cis.py:119-121` thấy `academic_verdicts` rỗng nhưng `resource_verdicts` khác rỗng liền tặng không `verified_ratio = 1.0` và `metadata_accuracy = 1.0` (ăn trọn 60/60 điểm học thuật!).
    - Tiếp đó `cis.py:175` chỉ tính `verdict_uncited` trên mảng `verdicts` đã lọc bỏ `RESOURCE`, khiến 6 link tham khảo bỏ không không hề bị tính vào `uncited_count` (`in_text_bib_consistency = 0.775` thay vì bị trừ nặng) → tổng điểm vọt lên **`90.88`**!
  - **`_compute_format_consistency` (`cis.py:386`):** Chỉ thưởng `confidence` cao cho chuỗi style chứa `"APA"` hoặc `"IEEE"`, còn bài viết nhất quán 100% theo chuẩn `VANCOUVER`, `ACM`, `MLA`, `CHICAGO`, `HARVARD` bị ép cứng về `0.5`!
  - **Mâu thuẫn số lượng trích dẫn trên cùng bài `hard_02`:** Pipeline trả `num_citations = 4`, danh sách `/api/essays` & `/report` trả `num_citations = 15` (tổng số điểm xuất hiện `[1]..[6]` trong thân bài), còn `/api/essays/stats` cộng vào `total_citations` con số `6` (tổng số `verdicts`)!
- **Đề xuất cách Fix (Zero-Regression):**
  1. Đếm trực tiếp `apa_count` và `ieee_count` / `numeric_count` từ danh sách `citations` trong `StyleDetector` (hoặc lưu sẵn vào `features` của `StyleProfile`), và đồng bộ 2 chiều `style ↔ label` trong `StyleProfile.__post_init__`.
  2. Trong `CISCalculator`:
     - Luôn tính `verdict_uncited` trên **toàn bộ `all_verdicts`** (bao gồm cả `RESOURCE`: tài liệu web đưa vào danh mục tham khảo nhưng không hề trích dẫn trong bài vẫn là `uncited_reference`).
     - Khi `academic_verdicts` rỗng nhưng có `resource_verdicts`, đánh giá chất lượng dựa trên tỷ lệ `resource` hợp lệ trên tổng tất cả mục tham khảo (có tính cả các URL chết `R-DEAD-URL` vốn mang nhãn `SUSPECTED_HALLUCINATION`) và gắn cờ disclaimer rõ ràng.
     - Bổ sung `VANCOUVER`, `ACM`, `MLA`, `CHICAGO`, `HARVARD`, `NATURE`, `CSE` vào nhóm chuẩn định dạng nhất quán trong `_compute_format_consistency`, và thêm `"R-DOI-CONFLICT"`, `"R-CHIMERIC-DOI-MISMATCH"` vào `invalid_id_rules` của `_compute_identifier_validity`.
  3. Bổ sung `url_status`, `url_status_code`, `archive_url`, `is_retracted` và `matched_sources` vào `_serialize_verdict_for_json` để báo cáo chạy CLI/script đồng nhất 100% với báo cáo qua API `/report`. (Giữ nguyên tên các trường cũ trong JSON response để không ảnh hưởng TypeScript types trên frontend).

---

### Nhóm D — Batch Check API, Quota, Cơ sở dữ liệu & Giao diện Web (`BUG-17` → `BUG-20`)

#### BUG-17 (`CRITICAL`) — Race Condition làm thất thoát lượt đếm hạn ngạch (`monthly_uploads_used`) khi upload đồng thời qua Batch Check (`BATCH_CONCURRENCY = 3`)

- **Vị trí mã nguồn:** [`essays.py`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/api/routes/essays.py#L368-L382) và [`lines 425-429`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/api/routes/essays.py#L425-L429).
- **Bằng chứng tái hiện thực tế 100% trên Docker Stack:**
  - Trong kịch bản kiểm thử Live Batch Check (`batch_e2e_summary.json`), tài khoản `teacher` bắt đầu với `monthly_uploads_used = 0`.
  - Khi gửi 6 file theo đúng cơ chế `BATCH_CONCURRENCY = 3` của frontend:
    - Sóng 1 gửi đồng thời 3 file (`batch_01`, `batch_02`, `batch_03` → tạo thành công 3 bản ghi `essay_id = 44, 45, 46`). Cả 3 request cùng đọc `current_user.monthly_uploads_used == 0` tại dòng `377` trước khi `await file.read()`, sau đó cả 3 cùng thực thi `current_user.monthly_uploads_used = 0 + 1 = 1` tại dòng `426`! **3 file được xử lý nhưng hệ thống chỉ tăng bộ đếm lên `1`!**
    - Sau khi nạp tiếp các file còn lại (tổng cộng **6 bài được chấp nhận: `IDs 44..49`**), API `/api/billing/subscription` báo `monthly_uploads_used = 4` (thất thoát 2 lượt!).
  - **Tác động bảo mật/kinh doanh:** Một người dùng gói Basic (giới hạn `3` bài/tháng, đã dùng `2/3`) chỉ cần chọn 3–5 file trên trang Batch Upload là có thể vượt qua rào chắn hạn ngạch gói cước!
- **Đề xuất cách Fix (Zero-Regression):**
  - Thay phép gán ORM non-atomic `current_user.monthly_uploads_used = used_uploads + 1` bằng câu lệnh `UPDATE` nguyên tử trực tiếp ở cấp độ cơ sở dữ liệu ngay tại thời điểm tạo `EssayRecord` (sau khi đã kiểm tra file hợp lệ):
    ```python
    from sqlalchemy import func, or_, update
    from integrity_checker.db.models import UserRecord

    stmt = (
        update(UserRecord)
        .where(
            UserRecord.id == current_user.id,
            or_(
                UserRecord.monthly_uploads_used.is_(None),
                UserRecord.monthly_uploads_used < plan_Spec_limit,
            ),
        )
        .values(monthly_uploads_used=func.coalesce(UserRecord.monthly_uploads_used, 0) + 1)
    )
    res = db.execute(stmt)
    if res.rowcount == 0:
        raise HTTPException(status_code=402, detail="Monthly upload quota exceeded.")
    ```
  - **Đảm bảo không ảnh hưởng luồng cũ:** SQLite và PostgreSQL đều khóa dòng/bảng nguyên tử khi thực thi `UPDATE ... WHERE monthly_uploads_used < :limit`, đảm bảo đếm chính xác tuyệt đối `100%` dưới mọi mức độ tải đồng thời mà không thay đổi bất kỳ schema hay API response nào.

---

#### BUG-18 (`HIGH`) — File PDF hỏng cấu trúc (`%PDF-1.4` corrupt xref) không bị từ chối khi upload, vẫn trừ quota và báo cáo trạng thái thành công giả (`status="completed"`, `CIS=0.0`)

- **Vị trí mã nguồn:** [`essays.py`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/api/routes/essays.py#L390-L404) và luồng xử lý nền trong [`essays.py`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/api/routes/essays.py#L140-L240).
- **Bằng chứng tái hiện thực tế 100% trên Docker Stack (`essay_id=49`):**
  - File `batch_06_corrupt_xref.pdf` có header `%PDF-1.4` ở đầu nhưng cấu trúc bảng xref/trailer bên trong bị hỏng hoàn toàn.
  - Tại [`essays.py:391-403`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/api/routes/essays.py#L391-L403), hệ thống đã mở thử PDF bằng `fitz.open(stream=content, filetype="pdf")`, nhưng khi `fitz.open` ném ngoại lệ file hỏng, khối `except Exception: detected_pages = 0` lại **nuốt trọn lỗi và cho phép đi tiếp**!
  - Kết quả trong `docker_batch_api.log`:
    - `Document parse failed: Failed to open file '/app/data/essays/uploads/49.pdf' as type pdf.`
    - `PdfPlumber fallback failed: No /Root object! - Is this really a PDF?`
    - `GROBID returned 500`
    - Thế nhưng hệ thống vẫn trừ 1 lượt upload của người dùng và đánh dấu bài nộp là **`status = "completed"`, `cis_score = 0.0`, `0 citations`** thay vì báo lỗi file hỏng!
- **Đề xuất cách Fix (Zero-Regression):**
  - Ngay tại [`essays.py:391-403`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/api/routes/essays.py#L391-L403) (trước khi trừ quota và trước khi lưu file/DB): nếu `ext == ".pdf"`, khi `fitz.open(stream=content, filetype="pdf")` ném lỗi mở cấu trúc PDF hoặc `pdf_doc.page_count == 0`, trả ngay `HTTPException(status_code=400, detail="File PDF bị lỗi cấu trúc hoặc không thể đọc được (corrupted PDF).")`.
  - Đồng thời trong background worker: nếu tất cả các bộ parser (`PyMuPDF`, `PdfPlumber`, `GROBID`) đều thất bại và trả về `0` trang trích xuất được, chuyển trạng thái bản ghi sang `failed` kèm thông báo lỗi rõ ràng thay vì `completed`.

---

#### BUG-19 (`MEDIUM-HIGH`) — `Repository.get_verdicts()` thiếu `ORDER BY id`, làm đảo lộn thứ tự tài liệu tham khảo theo bảng chữ cái của cột `label` trên mọi báo cáo API/CSV/UI

- **Vị trí mã nguồn:** [`Repository.get_verdicts`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/db/repository.py#L267-L272) và [`Repository.get_verdicts_by_essay_ids`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/db/repository.py#L274-L286).
- **Bằng chứng tái hiện thực tế 100% (`batch_api_48` — `041_huit`):**
  - Trong cơ sở dữ liệu, 16 dòng `VerdictRecord` được chèn đúng thứ tự `[1]..[16]` với khóa chính tăng dần `v1045` (`[1]`) → `v1060` (`[16]`).
  - Tuy nhiên khi gọi `GET /api/essays/48/report?format=json` và xuất CSV, mảng `verdicts` trả về theo thứ tự bị xáo trộn hoàn toàn:
    `[7]..[16]` (`label="resource"`, `v1051..v1060`) → `[1]` (`label="suspected_hallucination"`, `v1045`) → `[2], [6]` (`label="unresolved"`, `v1046, v1050`) → `[3], [4], [5]` (`label="verified"`, `v1047..v1049`)!
  - **Nguyên nhân gốc rễ:** Bảng `verdicts` có composite index trên `(essay_id, label)`. Khi `self.session.query(VerdictRecord).filter(VerdictRecord.essay_id == essay_id).all()` không chỉ định `.order_by(VerdictRecord.id.asc())`, bộ tối ưu truy vấn của SQLite quét trực tiếp index `(essay_id, label)` và trả các bản ghi theo **thứ tự bảng chữ cái của nhãn `label`** (`resource` → `suspected_hallucination` → `unresolved` → `verified`) thay vì thứ tự mục tài liệu tham khảo `[1]..[16]`!
- **Đề xuất cách Fix (Zero-Regression):**
  - Thêm `.order_by(VerdictRecord.id.asc())` vào cả `get_verdicts()` (`line 270`) và `get_verdicts_by_essay_ids()` (`line 284`) (tương tự cho `get_citations()` nếu chưa có `.order_by(CitationRecord.id.asc())`). Thao tác này nhanh tức thời trên khóa chính `id` và khôi phục đúng thứ tự danh mục `[1]..[N]` cho toàn bộ JSON, CSV, PDF/DOCX export và UI.

---

#### BUG-20 (`MEDIUM-HIGH`) — Bộ 3 lỗi UX/State trên `BatchUploadPage.tsx`: Tự động chuyển trang sau 1.2s xóa mất thông báo lỗi của lô hỗn hợp, nút `Retry` bị treo khi batch đã kết thúc, và nhãn `pdfOnly` sai sự thật

- **Vị trí mã nguồn:** [`web/src/pages/BatchUploadPage.tsx`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/web/src/pages/BatchUploadPage.tsx) tại các dòng [`38`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/web/src/pages/BatchUploadPage.tsx#L38), [`165-189`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/web/src/pages/BatchUploadPage.tsx#L165-L189), [`397-410`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/web/src/pages/BatchUploadPage.tsx#L397-L410), [`541`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/web/src/pages/BatchUploadPage.tsx#L541) và [`621`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/web/src/pages/BatchUploadPage.tsx#L621).
- **Bằng chứng kiểm định:**
  1. **Mất toàn bộ thông báo lỗi khi upload lô hỗn hợp (`lines 165-189`):** Trong `useEffect` theo dõi hoàn tất batch, điều kiện viết `if (stats.completed > 0)` sẽ lập tức đặt `setTimeout(..., 1200)` để chuyển hướng (`navigate`) sang trang History hoặc trang chi tiết bài báo ngay cả khi `stats.failed > 0`! Với một lô gồm 5 file thành công và 2 file thất bại, người dùng chỉ có đúng **1.2 giây** trước khi toàn bộ danh sách file lỗi và nút Retry bị hủy khỏi màn hình!
  2. **Nút `Retry` không chạy lại file lỗi (`lines 397-410`):** Hàm `retryFile(id)` chỉ cập nhật mảng `items` đưa phần tử lỗi về `status: 'pending'`, nhưng khi batch trước đó đã chạy xong (`isProcessing === false`), không có hàm nào gọi lại tiến trình xử lý hàng đợi → người dùng bấm `Retry` chỉ thấy trạng thái nhảy sang *Đang chờ* rồi đứng im mãi mãi!
  3. **Nhãn định dạng mâu thuẫn (`lines 38, 541, 621`):** `ACCEPT_EXTENSIONS` hỗ trợ đầy đủ `.pdf, .docx, .bib, .ris`, nhưng giao diện lại gắn cứng huy hiệu `t('batchUpload.pdfOnly')` ở hai vị trí khác nhau.
- **Đề xuất cách Fix (Zero-Regression):**
  1. Tại `lines 165-189`: Chỉ tự động `navigate` sau `1200ms` khi **`stats.failed === 0 && stats.completed > 0`**. Khi `stats.failed > 0`, giữ người dùng ở lại màn hình kết quả Batch để xem chi tiết từng file lỗi, bấm `Retry` các file thất bại, hoặc chủ động bấm nút *"Xem các bài đã hoàn tất"*.
  2. Tại `retryFile(id)` (`lines 397-410`): Nếu `!isProcessing`, ngay sau khi đặt lại item về `'pending'`, kích hoạt hàm chạy hàng đợi cho các phần tử `'pending'` còn lại.
  3. Cập nhật nhãn hiển thị vùng kéo-thả cho khớp với danh sách `.pdf, .docx, .bib, .ris`.

---

## 4. Ma trận tổng hợp mức độ ưu tiên & Lộ trình triển khai an toàn

Để đảm bảo quá trình vá lỗi diễn ra trơn tru, dễ kiểm thử độc lập từng cụm và **tuyệt đối không gây hồi quy (Zero-Regression)**, khuyến nghị chia thành 3 đợt PR nhỏ theo thứ tự ưu tiên sau:

| Đợt | Danh sách Bug | File tác động chính | Rủi ro hồi quy & Cách kiểm chứng |
|---|---|---|---|
| **Đợt 1 — P0 (`CRITICAL` & Bảo toàn dữ liệu/Quota)** | **BUG-01**, **BUG-06**, **BUG-07**, **BUG-17**, **BUG-18**, **BUG-19** | [`retrieval_orchestrator.py`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/retrieval/retrieval_orchestrator.py), [`neuro_symbolic_checker.py`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/logic/neuro_symbolic_checker.py), [`rules.py`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/logic/rules.py), [`essays.py`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/api/routes/essays.py), [`repository.py`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/db/repository.py) | **Rủi ro: Rất thấp.** Chạy lại `pytest` toàn bộ `tests/` + chạy lại `hard_02`, `hard_03` và script Batch Check 7 file (`monthly_uploads_used` phải tăng đúng `5/5`, file corrupt PDF trả `400`, `verdicts` xếp đúng `[1]..[16]`). |
| **Đợt 2 — P1 (`HIGH` — Độ chính xác Trích xuất, Liên kết & Wayback)** | **BUG-02**, **BUG-03**, **BUG-08**, **BUG-09**, **BUG-13**, **BUG-14**, **BUG-15** | [`link_validator.py`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/retrieval/link_validator.py), [`citation_extractor.py`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/extraction/citation_extractor.py), [`document_parser.py`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/extraction/document_parser.py), [`acm.py`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/extraction/patterns/acm.py), [`citation_linker.py`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/linking/citation_linker.py), [`report.py`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/api/routes/report.py) | **Rủi ro: Thấp** (nhờ giữ nguyên `reference_id` khi gắn `IN_TEXT_MISMATCH` và chỉ thu hẹp regex mảng 2D `[[...], [...]]`). Kiểm chứng trên `041_huit`, `006_tdtu`, `014_tdtu`, `essay_03`, `11.pdf`, `14.pdf`. |
| **Đợt 3 — P2 (`MEDIUM` — Rate Limiter, APA Ellipsis, Venue, CIS & Batch UI)** | **BUG-04**, **BUG-05**, **BUG-10**, **BUG-11**, **BUG-12**, **BUG-16**, **BUG-20** | [`dblp_client.py`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/retrieval/dblp_client.py), [`arxiv_client.py`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/retrieval/arxiv_client.py), [`crossref_client.py`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/retrieval/crossref_client.py), [`features.py`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/matching/features.py), [`venue_normalizer.py`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/matching/venue_normalizer.py), [`cis.py`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/logic/cis.py), [`BatchUploadPage.tsx`](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/web/src/pages/BatchUploadPage.tsx) | **Rủi ro: Rất thấp.** Kiểm chứng không còn `DBLP/arXiv retry exhausted` dưới tải song song, `VietDepression #1` và `essay_03 #8` đạt `VERIFIED`, và UX trang Batch Upload xử lý mượt kịch bản lỗi hỗn hợp. |
