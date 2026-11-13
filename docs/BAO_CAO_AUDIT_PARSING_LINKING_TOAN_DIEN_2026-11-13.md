# Báo Cáo Kiểm Toán Toàn Diện Luồng Upload + Parsing + Linking Trên Toàn Bộ 38 Thư Mục PDF (`1.064` Tệp PDF)

- **Ngày thực hiện:** `2026-11-13`
- **Commit kiểm toán:** `c7be959` (`HEAD`, mã nguồn production và cơ sở dữ liệu [app.db](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/data/app.db) giữ nguyên `100%` không chỉnh sửa)
- **Phạm vi kiểm toán:** Upload tuần tự từng tệp một (`1 → 1.064`) toàn bộ các tệp PDF hiện có trong **38 thư mục chứa PDF** của dự án qua endpoint thực tế `POST /api/essays` → xử lý qua toàn bộ stack `GROBID 0.9.1-crf (:8070)` + `PyMuPDF` + `pdfplumber` + `SectionSegmenter` + `StyleDetector` + `CitationExtractor` + `ReferenceListParser` + `Hybrid Merge` + `CitationLinker` + `DuplicateDetector` + `SQLite Serialization` + `GET /api/essays/{id}/report`.

---

## 1. Tổng Quan & Phương Pháp Kiểm Toán

### 1.1. Quy trình thực thi Live-Stack cô lập (Zero-Side-Effect)
1. **Khởi chạy Live Stack đầy đủ:** Container `GROBID 0.9.1-crf` tại cổng `:8070` kết hợp FastAPI app thực tế ([essays.py](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/api/routes/essays.py), [report.py](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/api/routes/report.py), [integrity_pipeline.py](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/pipeline/integrity_pipeline.py)).
2. **Cô lập tuyệt đối dữ liệu:** Toàn bộ `1.064` lượt upload chạy trên bản sao SQLite tạm và thư mục upload tạm (đã dọn sạch sau khi hoàn tất), đồng thời ngắt gọi HTTP ra các API học thuật bên ngoài (CrossRef, OpenAlex, Semantic Scholar) để đo đạc chính xác **100% chất lượng nội tại của tầng Upload + Parsing + Segmentation + Linking + Duplicate Detection + API/DB Serialization**.
3. **Thu thập kép (Dual-Layer Telemetry):** Ở mỗi tệp PDF, hệ thống đồng thời ghi nhận:
   - Kết quả nội bộ tại tầng lõi (`DocumentParser` + `CitationLinker` + `DuplicateDetector`), kèm đầu ra đối chứng thuần `Regex` và thuần `GROBID`.
   - Kết quả JSON trả về thực tế từ `GET /api/essays/{id}/report` sau khi ghi/đọc qua SQLite ([repository.py](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/db/repository.py)) nhằm bắt trọn các lỗi rơi rụng hoặc lệch dữ liệu ở tầng đóng gói API/DB.

### 1.2. Bảng chỉ số tổng hợp toàn cục (`1.064` tệp upload & `844` tệp SHA-256 duy nhất)

> [!NOTE]
> Trong `1.064` tệp PDF nằm rải rác ở `38` thư mục có `220` bản sao trùng mã băm SHA-256 giữa các bộ dữ liệu (ví dụ `20-theses/21..220.pdf` trùng với `200-theses/001..200.pdf`, một số tệp trong `data/essays/uploads` trùng với tệp gốc). Phép kiểm tra tính tất định ghi nhận **`0` sai lệch (`nondeterministic_sha_copies = 0`)** giữa mọi cặp tệp cùng SHA-256.

| Nhóm chỉ số | Toàn bộ tệp upload (`1.064` PDF) | Tệp duy nhất theo SHA-256 (`844` PDF) | Ghi chú đánh giá |
| :--- | ---: | ---: | :--- |
| **HTTP `200 OK` khi `POST /api/essays`** | `1.064 / 1.064` (`100%`) | `844 / 844` (`100%`) | `0` lỗi HTTP 4xx/5xx, `0` crash pipeline |
| **PDF dạng ảnh quét (`SCANNED_PDF_DETECTED`)** | `1` | `1` | [4.pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/20-theses/4.pdf) (`0` ký tự text layer — bắt đúng) |
| **Tài liệu kích hoạt thành công `GROBID`** | `1.022 / 1.064` (`96,05%`) | `802 / 844` (`95,02%`) | `42` tệp fallback về `Regex` (PDF scan, bài tổng quan >200 refs timeout GROBID, hoặc `AMA`/`Nature` hard_cases) |
| **Phát hiện có mục Tài liệu tham khảo (`has_bib_section`)** | `986` | `766` | `78` tệp duy nhất không có mục TLTK (báo cáo Đồ án CNTT thiếu TLTK hoặc PDF cắt đoạn test ACL) |
| **Tài liệu trích xuất được `≥ 1` Reference** | `983` | `763` | `3` tệp có tiêu đề `TÀI LIỆU THAM KHẢO` nhưng sinh viên bỏ trống hoàn toàn phần nội dung |
| **Tổng số mục Tài liệu tham khảo (`total_refs`)** | `38.317` | `27.340` | Trung bình `35,8` TLTK / tài liệu có TLTK |
| **TLTK được trích dẫn (`matched_refs` / Tỷ lệ)** | `33.180` (`86,59%`) | `23.572` (`86,22%`) | Mức phủ rất cao trên tập đa chuẩn trích dẫn |
| **TLTK chưa được trích dẫn (`uncited_refs`)** | `5.016` | `3.680` | Phần lớn nằm ở các đồ án sinh viên liệt kê TLTK cuối bài nhưng không trích dẫn trong thân bài |
| **TLTK trùng lặp (`duplicate_refs`)** | `355` | `251` | Bao gồm cả lỗi trùng của tác giả và một số ca nhiễu DOI/URL từ hệ thống |
| **Tổng số cụm trích dẫn trong bài (`total_in_text`)** | `67.504` | `45.233` | Trước khi tách cụm đa trích dẫn `(A, 2020; B, 2021)` / `[1]-[5]` |
| **Tổng số cạnh liên kết (`total_links`)** | `78.825` | `53.662` | Sau khi bung cụm đa trích dẫn và dải số |
| **Cạnh liên kết khớp thành công (`matched_links`)** | `74.350` (**`94,32%`**) | `50.806` (**`94,68%`**) | Tỷ lệ liên kết chính xác toàn cục đạt gần `95%` |
| **Thiếu mục TLTK (`missing_links`)** | `3.640` | `2.374` | Gồm lỗi sinh viên bỏ sót TLTK + một số bug hệ thống đã định danh bên dưới |
| **Lệch năm xuất bản (`mismatch_links`)** | `783` | `446` | Đa số là lỗi sinh viên gõ nhầm năm `(2023)` vs `(2024)` |
| **Nhập nhằng đa mục (`ambiguous_links`)** | `52` | `36` | Cùng tác giả + cùng năm nhưng sinh viên không đánh hậu tố `a/b` |
| **TLTK khuyết `title` (`no_title_refs`)** | `93` | `92` (`30` tệp) | Gồm chuẩn ACS không in tiêu đề bài báo + lỗi tách đôi dòng DOI của GROBID |
| **TLTK nghi gộp dòng (`merged_refs`)** | `101` | `82` (`42` tệp) | Nổi bật nhất là luận văn luật chú thích chân trang [3.pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/20-theses/3.pdf) |
| **TLTK nhiễu trường `authors` / `title`** | `1.420` / `1.344` | `1.224` / `1.282` | Ghi đè nhầm từ `apa_fallback`, rò rỉ header/footer trang |
| **TLTK sót `url` / sót `doi` dù có trong `raw_text`** | `32` / `4` | `25` / `2` | URL dạng `www.` hoặc `<http...>` chưa bắt hết |
| **Tài liệu rơi mất Verdict ở `GET /report` (`ref_count != len(verdicts)`)** | `36` | **`23`** | **Bug hệ thống nghiêm trọng (`SYS-BUG-01`)** |
| **Tài liệu rơi mất cạnh `missing_reference` ở `GET /report`** | `15` | **`9`** | **Bug hệ thống mức cao (`SYS-BUG-02`)** |

---

## 2. Thống Kê Chi Tiết Trên Toàn Bộ 38 Thư Mục Chứa PDF

Bảng dưới đây ghi nhận đầy đủ kết quả chạy tuần tự trên cả **38 thư mục** (`Tổng cộng = 1.064 PDF`):

| # | Thư mục | Số PDF | GROBID | Có Bib | Tổng Refs | Refs Khớp | Refs Thừa (`Uncited`) | Refs Trùng | In-Text | Tổng Links | Links Khớp | `Missing` | `Mismatch` | `Ambig.` | Gộp Ref |
| ---: | :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | `.` (thư mục gốc dự án) | 6 | 6 | 6 | 125 | 118 | 7 | 0 | 169 | 189 | 181 | 8 | 0 | 0 | 0 |
| 2 | `20-theses` | 220 | 219 | 219 | 11.440 | 10.060 | 1.349 | 99 | 24.469 | 27.825 | 26.148 | 1.289 | 372 | 16 | 20 |
| 3 | `200-theses` | 200 | 200 | 200 | 10.721 | 9.363 | 1.327 | 99 | 21.937 | 24.782 | 23.172 | 1.257 | 337 | 16 | 19 |
| 4 | `6_ICCIES_2027` | 1 | 1 | 1 | 28 | 28 | 0 | 0 | 28 | 36 | 34 | 2 | 0 | 0 | 0 |
| 5 | `TDTU-MidtermReport` | 1 | 1 | 1 | 29 | 29 | 0 | 0 | 46 | 48 | 47 | 1 | 0 | 0 | 0 |
| 6 | `TDTU_PDF` | 100 | 83 | 52 | 753 | 505 | 247 | 2 | 1.307 | 1.349 | 1.200 | 138 | 11 | 0 | 3 |
| 7 | `VN_UNI_PDF_BATCH2` | 100 | 100 | 92 | 917 | 460 | 455 | 5 | 1.207 | 1.357 | 1.311 | 44 | 2 | 0 | 0 |
| 8 | `data/acl_data/python/tests/files_test` | 1 | 1 | 1 | 79 | 71 | 7 | 1 | 87 | 88 | 86 | 1 | 1 | 0 | 0 |
| 9 | `data/acl_data/tests/data` | 8 | 8 | 0 | 0 | 0 | 0 | 0 | 36 | 36 | 0 | 36 | 0 | 0 | 0 |
| 10 | `data/essays` | 6 | 6 | 6 | 25 | 22 | 2 | 1 | 25 | 27 | 27 | 0 | 0 | 0 | 0 |
| 11 | `data/essays/uploads` | 31 | 31 | 31 | 366 | 328 | 36 | 5 | 477 | 534 | 523 | 11 | 0 | 0 | 0 |
| 12 | `data/test_scenarios` | 2 | 2 | 2 | 20 | 16 | 4 | 1 | 25 | 33 | 27 | 6 | 0 | 0 | 1 |
| 13 | `data/uploads` | 2 | 2 | 2 | 20 | 20 | 0 | 0 | 20 | 20 | 20 | 0 | 0 | 0 | 0 |
| 14 | `style_corpora/ACM/hard_cases` | 5 | 5 | 5 | 33 | 28 | 3 | 3 | 75 | 75 | 69 | 6 | 0 | 0 | 0 |
| 15 | `style_corpora/ACM/real` | 20 | 20 | 19 | 794 | 746 | 47 | 9 | 875 | 1.109 | 1.081 | 27 | 1 | 0 | 0 |
| 16 | `style_corpora/ACS/hard_cases` | 5 | 5 | 5 | 34 | 28 | 4 | 3 | 75 | 75 | 69 | 6 | 0 | 0 | 0 |
| 17 | `style_corpora/ACS/real` | 20 | 19 | 20 | 2.516 | 2.350 | 163 | 12 | 2.268 | 3.430 | 3.396 | 34 | 0 | 0 | 1 |
| 18 | `style_corpora/AMA/hard_cases` | 5 | 0 | 5 | 33 | 29 | 3 | 3 | 75 | 75 | 71 | 4 | 0 | 0 | 0 |
| 19 | `style_corpora/AMA/real` | 20 | 12 | 20 | 837 | 749 | 87 | 2 | 918 | 1.294 | 1.280 | 13 | 1 | 0 | 7 |
| 20 | `style_corpora/APA/hard_cases` | 5 | 5 | 5 | 33 | 31 | 2 | 3 | 72 | 84 | 80 | 4 | 0 | 0 | 0 |
| 21 | `style_corpora/APA/real` | 20 | 20 | 20 | 1.008 | 950 | 56 | 9 | 1.371 | 1.615 | 1.493 | 112 | 10 | 0 | 5 |
| 22 | `style_corpora/CSE/hard_cases` | 5 | 5 | 5 | 33 | 29 | 4 | 3 | 68 | 80 | 76 | 4 | 0 | 0 | 0 |
| 23 | `style_corpora/CSE/real` | 20 | 20 | 20 | 1.625 | 1.342 | 283 | 3 | 2.124 | 2.516 | 2.290 | 178 | 28 | 20 | 5 |
| 24 | `style_corpora/Chicago/hard_cases` | 5 | 5 | 5 | 33 | 29 | 4 | 3 | 68 | 80 | 76 | 4 | 0 | 0 | 0 |
| 25 | `style_corpora/Chicago/real` | 20 | 20 | 20 | 1.222 | 1.022 | 190 | 33 | 2.262 | 2.382 | 2.201 | 173 | 8 | 0 | 1 |
| 26 | `style_corpora/Harvard/hard_cases` | 5 | 5 | 5 | 33 | 31 | 2 | 3 | 72 | 84 | 80 | 4 | 0 | 0 | 0 |
| 27 | `style_corpora/Harvard/real` | 20 | 20 | 20 | 932 | 822 | 103 | 12 | 1.278 | 1.580 | 1.467 | 110 | 3 | 0 | 0 |
| 28 | `style_corpora/IEEE/hard_cases` | 5 | 5 | 5 | 33 | 28 | 3 | 3 | 75 | 75 | 69 | 6 | 0 | 0 | 0 |
| 29 | `style_corpora/IEEE/real` | 20 | 20 | 20 | 750 | 662 | 71 | 23 | 992 | 1.313 | 1.297 | 15 | 1 | 0 | 2 |
| 30 | `style_corpora/MLA/hard_cases` | 5 | 5 | 5 | 33 | 25 | 8 | 3 | 62 | 80 | 76 | 4 | 0 | 0 | 0 |
| 31 | `style_corpora/MLA/real` | 20 | 16 | 20 | 1.055 | 1.000 | 55 | 1 | 1.233 | 1.618 | 1.536 | 75 | 7 | 0 | 33 |
| 32 | `style_corpora/Nature/hard_cases` | 5 | 0 | 5 | 33 | 29 | 3 | 3 | 75 | 75 | 71 | 4 | 0 | 0 | 0 |
| 33 | `style_corpora/Nature/real` | 20 | 19 | 20 | 956 | 897 | 59 | 0 | 1.696 | 2.192 | 2.184 | 8 | 0 | 0 | 1 |
| 34 | `style_corpora/Vancouver/hard_cases` | 5 | 5 | 5 | 33 | 28 | 3 | 3 | 75 | 75 | 69 | 6 | 0 | 0 | 0 |
| 35 | `style_corpora/Vancouver/real` | 20 | 20 | 20 | 990 | 966 | 23 | 5 | 1.029 | 1.758 | 1.730 | 28 | 0 | 0 | 1 |
| 36 | `tdtu_github_reports` | 75 | 75 | 63 | 448 | 62 | 386 | 0 | 150 | 150 | 133 | 16 | 1 | 0 | 1 |
| 37 | `vn_legal_reports` | 30 | 30 | 30 | 259 | 241 | 18 | 0 | 593 | 593 | 592 | 1 | 0 | 0 | 1 |
| 38 | `vn_legal_reports/hard_cases` | 6 | 6 | 6 | 38 | 36 | 2 | 0 | 90 | 93 | 88 | 5 | 0 | 0 | 0 |
| **Tổng** | **38 thư mục** | **1.064** | **1.022** | **986** | **38.317** | **33.180** | **5.016** | **355** | **67.504** | **78.825** | **74.350** | **3.640** | **783** | **52** | **101** |

---

## 3. Đối Chiếu Toàn Diện Với 4 Bộ Kết Quả Lịch Sử & Ground Truth

### 3.1. Đối chiếu tập `200-theses` (`20-theses/21..220.pdf`) với Baseline GROBID ngày `2026-11-09` ([after_results.json](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/200-theses/audit_results/after_results.json))
- **Kết quả:** `189 / 200` tệp khớp tuyệt đối `100%`; `11 / 200` tệp thay đổi ([22.pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/20-theses/22.pdf), [48.pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/20-theses/48.pdf), [71.pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/20-theses/71.pdf), [78.pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/20-theses/78.pdf), [79.pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/20-theses/79.pdf), [93.pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/20-theses/93.pdf), [120.pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/20-theses/120.pdf), [143.pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/20-theses/143.pdf), [177.pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/20-theses/177.pdf), [206.pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/20-theses/206.pdf), [217.pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/20-theses/217.pdf)).
- **Đánh giá:** **Cả `11 / 11` thay đổi đều là cải thiện tích cực (`0` hồi quy)**:
  - [71.pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/20-theses/71.pdf): `missing_links` giảm `4 → 2`, `matched_links` tăng `37 → 39`.
  - [120.pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/20-theses/120.pdf): `missing_links` giảm `15 → 14`.
  - [206.pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/20-theses/206.pdf): `matched_refs` tăng `63 → 64`, `uncited_refs` giảm `10 → 9`.
  - 8 tệp còn lại loại bỏ thành công các dòng nhiễu phụ lục / hậu TLTK (giảm `uncited_refs` ảo mà không mất bất kỳ `matched_ref` nào).

### 3.2. Đối chiếu tập `VN_UNI_PDF_BATCH2` (`100` PDF) với Baseline ngày `2026-11-08` ([audit_100_ext_link_after.json](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/reports/audit_100_ext_link_after.json))
- **Kết quả:** `92 / 100` tệp giữ nguyên; `8 / 100` tệp thay đổi — **không có hồi quy liên kết**:
  - **6 tệp tăng mạnh số liên kết khớp:** [001_ulis](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/VN_UNI_PDF_BATCH2/001_ulis_22040687-KLTN-NGUYEN-HONG-THAM.pdf) (`matched_links 24 → 26`, `uncited 1 → 0`), [002_ussh](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/VN_UNI_PDF_BATCH2/002_ussh_vnu_Luan-van_Nguyen-Thi-Thuy-Dung.pdf) (`matched_links 33 → 83` nhờ bung đa trích dẫn), [055_ctu](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/VN_UNI_PDF_BATCH2/055_ctu_60260-198817-1-PB.pdf) (`uncited 7 → 6`), [061_ueh](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/VN_UNI_PDF_BATCH2/061_ueh_luan-van-thac-si-kinh-te-ky-nang-giao-tiep-ung-xu-cua-can-bo-cong-chuc-van-phong-cap-huyen-tren-dia-ban-tinh-binh-duong.pdf) (`matched_links 18 → 23`), [088_ou_hcm](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/VN_UNI_PDF_BATCH2/088_ou_hcm_3954-7924-1-SM.pdf) (`matched_links 101 → 199` nhờ bung dải `[1]-[5]`), [094_uit](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/VN_UNI_PDF_BATCH2/094_uit_939_17121999164345175341835715061874.pdf) (`matched_links 4 → 6`).
  - [052_utc](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/VN_UNI_PDF_BATCH2/052_utc_DATN_ParkingYolo_LeCongMinh.pdf): giữ nguyên `uncited=11, missing=0`, đồng thời phát hiện thêm `1` cặp TLTK trùng lặp.
  - [097_hue_uni](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/VN_UNI_PDF_BATCH2/097_hue_uni_5236-19896-1-PB.pdf): loại bỏ `1` trích dẫn dương tính giả trong thân bài, đạt trạng thái hoàn hảo `7 refs = 7 matched, 0 uncited, 0 missing`.

### 3.3. Đối chiếu tập `Workspace 525` (`TDTU_PDF` + `tdtu_github_reports` + `vn_legal_reports`, `245` tệp giao nhau) với Baseline thuần Regex ngày `2026-11-02` ([audit_all_workspace_results.json](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/reports/audit_all_workspace_results.json))
- **Kết quả:** `187 / 245` tệp giữ nguyên; `58 / 245` tệp thay đổi.
- **56 / 58 tệp là bước nhảy vọt chất lượng nhờ Hybrid GROBID + Regex:** Điển hình như [055_uit](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/TDTU_PDF/055_uit_luanvan_tomtat.pdf) (`matched_links 111 → 130, uncited 8 → 0`), [063_hcmus](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/TDTU_PDF/063_hcmus_20120152-20120461.pdf) (`matched_refs 12 → 25, uncited 8 → 0`), [066_hust](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/TDTU_PDF/066_hust_KLTN_PhanThanhAn_20210009.pdf) (`matched_refs 17 → 31, uncited 13 → 2`), [060_tdtu](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/tdtu_github_reports/060_tdtu_iot-based-smart-agriculture-monitoring-and-irrigation-system__Midterm_Report_ES_Group_7.pdf) (`matched 25 → 30, missing 5 → 0`), và các báo cáo pháp luật Việt Nam (`001, 002, 010, 019, 023`).
- **Phát hiện 2 ca hồi quy thực sự từ GROBID Live:**
  1. [064_hcmus](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/TDTU_PDF/064_hcmus_21200072_NguyenHongDanh_BaoCaoDeCuongLVThs.pdf): `missing_links` tăng `0 → 4`, `uncited_refs` tăng `1 → 2` do GROBID tách đôi dòng URL `[24]` thành mục rác `[25] Accessed (2025)`, làm lệch toàn bộ chỉ số `[25]..[33]` (**`SYS-BUG-06`**).
  2. [086_uit](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/TDTU_PDF/086_uit_845_171219981702397804258183735687.pdf): tài liệu không có mục TLTK (`regex_refs = 0`), nhưng GROBID ảo giác 8 gạch đầu dòng mô tả tính năng tiếng Việt thành 8 `<biblStruct>` không tác giả, không năm, sinh ra `8` `uncited_refs` giả (**`SYS-BUG-13`**).

### 3.4. Đối chiếu `60` tệp Benchmark `hard_cases` (12 chuẩn trích dẫn) với `ground_truth.json`
- **Kết quả:** `38 / 60` tệp khớp tuyệt đối; `22 / 60` tệp khác biệt với file `ground_truth.json` cũ, phân tách rạch ròi thành:
  - **11 tệp tốt hơn `ground_truth.json` cũ:** Bộ `vn_legal_reports/hard_cases` (`hard_01, 02, 03, 05` bắt thêm đầy đủ các tham chiếu `Điều/Khoản` và khớp `100%`), `Chicago/hard_cases/hard_05` (`matched_links` tăng `5 → 13`, `uncited` giảm `2 → 1`), và nhóm `hard_02` của các hệ Author-Year phát hiện chính xác thêm cặp trùng DOI chimera `10.18653/v1/N19-1423` (`duplicate_groups: 1 → 2`).
  - **11 tệp lộ diện 3 Bug Hệ thống Nghiêm trọng mới phát sinh ở nhánh Hybrid GROBID:**
    1. `ACM, ACS, AMA, IEEE, Nature, Vancouver` — tệp `hard_02` (`matched_links` tụt `15 → 13`, `missing_links` tăng `0 → 2` tại `[4]`/`^4`) và tệp `hard_04` (`uncited_refs` lệch `4 → 3` tại `[3]`/`^3`) → **Do `grobid_by_doi` ghi đè `numeric_index` (`SYS-BUG-03`)**.
    2. [hard_01_acs_superscript_and_semicolons.pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/style_corpora/ACS/hard_cases/hard_01_acs_superscript_and_semicolons.pdf) (`ref_count` tăng `7 → 8`, `uncited` tăng `0 → 1`) → **Do GROBID tách đôi chuẩn IETF RFC của `Rescorla & Dierks (2018)` (`SYS-BUG-06`)**.
    3. [hard_04_vn_legal_linking_anomalies.pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/vn_legal_reports/hard_cases/hard_04_vn_legal_linking_anomalies.pdf) (`missing_links` giảm sai `7 → 5`, `matched_links` tăng sai `10 → 12`) → **Do `Bộ luật Tố tụng dân sự (2015)` bị khớp nhầm vào `Bộ luật Dân sự (2015)` (`SYS-BUG-09`)**.

---

## 4. Phân Định Rõ Ràng: Lỗi Từ Sinh Viên / Tác Giả / Dữ Liệu PDF Gốc (KHÔNG Phải Bug Hệ Thống)

> [!IMPORTANT]
> Qua giám định trực tiếp văn bản từng trang PDF gốc, các hiện tượng dưới đây được xác nhận **100% là lỗi học thuật thật của sinh viên/tác giả hoặc đặc thù nguyên bản của tệp PDF**. Hệ thống cảnh báo hoàn toàn đúng thiết kế; **tuyệt đối không được "ép khớp" hay nới lỏng ngưỡng khiến hệ thống bỏ lọt lỗi thật**.

1. **Tệp PDF quét ảnh không có lớp văn bản (Scanned Image PDF):**
   - [4.pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/20-theses/4.pdf): Toàn bộ các trang có `0` ký tự text layer. Cảnh báo `SCANNED_PDF_DETECTED` của hệ thống hoàn toàn chính xác.

2. **Đồ án / Báo cáo sinh viên không viết mục TLTK, bỏ trống mục TLTK, hoặc liệt kê TLTK cuối bài nhưng không hề trích dẫn trong thân bài:**
   - **Có tiêu đề `TÀI LIỆU THAM KHẢO` nhưng bỏ trống hoàn toàn bên dưới (`0` dòng mục lục):** [055_tdtu](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/tdtu_github_reports/055_tdtu_iot-smart-home-security-system-using-esp8266-blynk__522H0006_522H0046_522H0077_522H0003_ MidTermReport.pdf) (tr. 24), [101_tdtu](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/tdtu_github_reports/101_tdtu_Enterprise-Systems-Development-Project__521H0489_521H0304_521H0509_Report.pdf) (tr. 34), [084_uit](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/TDTU_PDF/084_uit_787_17121999164345175341835715061874.pdf) (tr. 30).
   - **Liệt kê danh sách link/sách cuối bài nhưng `0` lần trích dẫn `[N]` hay `(Author, Year)` trong thân bài:** Chiếm đa số `386 / 448` `uncited_refs` tại `tdtu_github_reports` và `455 / 917` `uncited_refs` tại `VN_UNI_PDF_BATCH2`. Đây chính xác là lỗi học thuật `UNCITED_REFERENCE` mà phần mềm cần bắt.
   - **Tệp PDF cắt lẻ chỉ chứa phần thân bài phục vụ unit test:** `8` tệp trong `data/acl_data/tests/data/*.pdf` không có trang References.

3. **Lỗi học thuật thật của sinh viên trong Luận văn (`MISSING_REFERENCE` & `IN_TEXT_MISMATCH`):**
   - [1.pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/20-theses/1.pdf): Sinh viên gõ sai năm `(Cheng, 2025)` trong thân bài trong khi References ghi `Cheng, S. (2024)`; gõ `(Nielsen et al., 2025)` nhưng References ghi `(2016)`; đồng thời trích dẫn 9 bài báo thời sự (`Franklin et al., 2025`, `Brenan, 2025`, `NYT, 2025`, `Media Helping Media, 2025`...) nhưng quên đưa vào References.
   - [2.pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/20-theses/2.pdf): 3 tài liệu trong Bibliography thực sự không được nhắc tới ở bất kỳ trang nào trong thân bài; mục đồng tác giả vợ chồng `Barrowman, J., & Barrowman, J. (1966)` (James & Judith Barrowman) là tên thật của hai tác giả.
   - [11.pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/20-theses/11.pdf), [12.pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/20-theses/12.pdf), [17.pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/20-theses/17.pdf), [57.pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/20-theses/57.pdf), [134.pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/20-theses/134.pdf): Hàng loạt lỗi sinh viên trích dẫn tài liệu ngoài luồng (`(Ang'udi, 2023, pp. 163-165)`, `(Rapid7, n.d.)`, `(Dennison et al., 2013)`, `(Forbes, 2025)`, `Brinthaupt, Hein & Kramer (2009)`, `(OECD, 2018)` khi TLTK chỉ có báo cáo khác năm `OECD (2019)`, hoặc trích dẫn phỏng vấn cá nhân `(Interview, Frans Beckers, 2017)` không nằm trong TLTK), gõ lệch năm `(Van Buggenhout, 2023)` vs `(2024)`, `(McDonough and Braungart, 2002)` vs `(2010)`, và bỏ sót tên sách `Bryman, A. (2012). Oxford University Press.`.

4. **Trích dẫn giả lập dùng làm ví dụ minh họa bên trong các bài báo viết về chính hệ thống kiểm tra trích dẫn:**
   - [main.pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/6_ICCIES_2027/main.pdf) (tr. 9–10): Cụm `(Chawla, 2008)` xuất hiện trong đoạn văn mô tả ảnh chụp giao diện minh họa của bài báo chuẩn IEEE `[1]..[28]`.
   - [thesis.pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/thesis.pdf) (tr. 48) & [thesis.pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/TDTU-MidtermReport/thesis.pdf) (tr. 50): Cụm `(Smith, 2020; Doe, 2021)` được chính tác giả gõ làm ví dụ minh họa cú pháp compound APA trong khóa luận.

5. **Đặc thù quy ước xuất bản của tạp chí hóa học/y sinh & lỗi cắt cụt URL của sinh viên:**
   - Chuẩn ACS truyền thống ([17_total_synthesis...pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/style_corpora/ACS/real/17_total_synthesis_of_natural_products_at_the_interface_between.pdf), [17_13_dipolar...pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/style_corpora/MLA/real/17_13_dipolar_cycloadditions_past_and_future.pdf)): Các mục `Chem. Abstr. 1966, 64, 14315g.` vốn không có tác giả và không in tiêu đề bài báo trong PDF gốc; hoặc tác giả gộp cả bản tiếng Đức (`Angew. Chem. 1963`) và bản quốc tế (`Angew. Chem., Int. Ed. Engl. 1963`) vào chung một số thứ tự chú thích `3.`.
   - Sinh viên dán URL bị cụt ngay từ file Word/PDF gốc: `https://viblo` tại [076_tdtu](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/tdtu_github_reports/076_tdtu_Midterm_Web_NodeJS__522H0081_522H0038_522H0019_522H0002.pdf), hoặc gõ hỏng `https:/ www./vi.wikipedia.org/wiki.` tại [058_ctu](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/VN_UNI_PDF_BATCH2/058_ctu_62826-205543-1-PB.pdf).

---

## 5. Danh Mục Chi Tiết 16 Bug Hệ Thống & Giải Pháp Fix Triệt Để (Zero-Regression)

Toàn bộ các bất thường thuộc lỗi hệ thống trên `1.064` tệp PDF quy tụ chính xác về **16 nguyên nhân gốc (Root-Cause System Bugs)** thuộc 5 phân hệ dưới đây.

---

### Phân hệ A — Tầng Đóng Gói Pipeline, DB & API `/report`

#### `[SYS-BUG-01]` (CRITICAL — `23` tài liệu duy nhất / `36` tệp upload): Rơi mất Verdict của mục TLTK và nhiễm chéo trạng thái khi `citation_key()` bị đụng độ khóa
- **Vị trí mã nguồn:**
  - [normalization.py](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/retrieval/normalization.py#L289-L302) (`citation_key`)
  - [integrity_pipeline.py](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/pipeline/integrity_pipeline.py#L821-L828) và [integrity_pipeline.py](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/pipeline/integrity_pipeline.py#L905-L918)
- **Bằng chứng thực tế:**
  - `23` tài liệu duy nhất có `len(api_verdicts) < ref_count` trên JSON trả về của `GET /api/essays/{id}/report`: [30.pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/20-theses/30.pdf) (`36 → 34`), [32.pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/20-theses/32.pdf) (`94 → 89`), [137.pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/20-theses/137.pdf) (`38 → 34`), [041_hust](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/VN_UNI_PDF_BATCH2/041_hust_2025_20215309_VuDucAnh_KLTN.pdf), [055_ctu](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/VN_UNI_PDF_BATCH2/055_ctu_60260-198817-1-PB.pdf), [024_tdtu](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/tdtu_github_reports/024_tdtu_Midterm_Dotnet__Report.pdf), v.v.
  - Ví dụ điển hình tại [30.pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/20-theses/30.pdf): Ba bài đăng mạng xã hội hoàn toàn khác nhau của cùng tác giả `Trump, D. (2019a)`, `Trump, D. (2019b)`, `Trump, D. (2019c)` (khác ngày đăng và khác URL) đều có cùng tiêu đề chung `[Tweet]. Twitter`. Hàm `citation_key()` cắt bỏ hậu tố `a/b/c` (`re.sub(r"[a-zA-Z]$", "", citation.year)` ở dòng `298`) và phớt lờ `citation.url` vì `title` khác rỗng → cả 3 mục gộp chung thành khóa `'trump|2019|tweet'`.
- **Cơ chế gây lỗi:** Vòng lặp khôi phục ở [integrity_pipeline.py](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/pipeline/integrity_pipeline.py#L905-L918) chỉ khôi phục những `ref` có `ref.reference_id in duplicate_ref_ids`. Do `DuplicateDetector` biết rõ `2019a/b/c` là 3 tài liệu khác nhau nên **không** gắn cờ `duplicate_ref_ids` → 2 trong 3 mục bị xóa sổ âm thầm khỏi danh sách `verdicts` và làm lệch `linking_summary` trên giao diện người dùng!
- **Giải pháp fix triệt để:**
  1. Tại [normalization.py](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/retrieval/normalization.py#L289-L302): Giữ nguyên `year_suffix` (ví dụ `2019a`) trong `citation_key()`, đồng thời bổ sung `url` chuẩn hóa vào khóa khi có `year_suffix` hoặc khi `title` là nhãn chung ngắn (`<= 3` từ).
  2. Tại [integrity_pipeline.py](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/pipeline/integrity_pipeline.py#L905-L918): Bỏ điều kiện lọc `and ref.reference_id in duplicate_ref_ids` khi khôi phục các `ref_citations` bị rơi khỏi `verdicts` (`if id(ref) not in in_verdicts:` phải luôn được tạo `Verdict` riêng theo đúng `ref.reference_id`), đảm bảo bất biến **`len(verdicts_for_refs) == len(ref_citations)` trên 100% tài liệu**.

---

#### `[SYS-BUG-02]` (HIGH — `9` tài liệu duy nhất / `15` tệp upload): Rơi mất các cạnh `MISSING_REFERENCE` thứ 2 trở đi trong cùng một cụm đa trích dẫn `(A, 2002; B, 1992)`
- **Vị trí mã nguồn:**
  - [integrity_pipeline.py](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/pipeline/integrity_pipeline.py#L2015-L2023) (`_build_link_lookup_multi`)
  - [citation_linker.py](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/linking/citation_linker.py#L546-L552)
- **Bằng chứng thực tế:**
  - [33.pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/20-theses/33.pdf) (`occ-0014`: `(Chiricos & Eschholz, 2002; Surrette, 1992; Young, 1985)` có 2 vế thiếu TLTK nhưng `/report` chỉ còn 1), [57.pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/20-theses/57.pdf), [63.pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/20-theses/63.pdf), [64.pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/20-theses/64.pdf) (`24` cạnh missing thật nhưng API `/report` chỉ báo `22`), [110.pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/20-theses/110.pdf), [218.pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/20-theses/218.pdf).
- **Cơ chế gây lỗi:** `CitationLink` là `@dataclass`. Khi 2 vế con trong cùng một `in_text_occurrence_id` cùng bị `MISSING_REFERENCE`, cả hai đối tượng `CitationLink` đều có `reference_id=None, status=MISSING_REFERENCE, method=NO_KEYS, evidence={"raw": cit.raw_text}` giống hệt nhau từng trường. Câu lệnh `if link not in bucket:` tại [integrity_pipeline.py](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/pipeline/integrity_pipeline.py#L2021) so sánh bằng giá trị (`__eq__`), dẫn tới việc nuốt mất cạnh `MISSING_REFERENCE` thứ 2!
- **Giải pháp fix triệt để:**
  1. Tại [citation_linker.py](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/linking/citation_linker.py#L546-L552): Ghi rõ vế con vào `evidence={"raw": cit.raw_text, "sub_citation": part}` cho từng phần của cụm đa trích dẫn (giúp UI hiển thị chính xác tác giả nào trong ngoặc đang bị thiếu).
  2. Tại [integrity_pipeline.py](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/pipeline/integrity_pipeline.py#L2021): Đổi kiểm tra chống trùng tham chiếu sang so sánh định danh đối tượng `if all(existing is not link for existing in bucket):`.

---

### Phân hệ B — Hợp Nhất Lai `GROBID TEI + Regex` (`Hybrid Merge`)

#### `[SYS-BUG-03]` (CRITICAL — Phá vỡ liên kết số `[N]` / `^N` trên 6 bộ `hard_cases` và các luận văn đánh số): `grobid_by_doi` & `overlap_g` ghi đè nhầm `numeric_index` giữa các mục TLTK khác số thứ tự
- **Vị trí mã nguồn:**
  - [document_parser.py](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/extraction/document_parser.py#L2282-L2293), [document_parser.py](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/extraction/document_parser.py#L2387-L2400), [document_parser.py](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/extraction/document_parser.py#L2521-L2545), [document_parser.py](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/extraction/document_parser.py#L2656-L2709)
- **Bằng chứng thực tế:**
  - Trên cả **6 bộ `hard_02` đánh số** (`ACM`, `ACS`, `AMA`, `IEEE`, `Nature`, `Vancouver`), trích dẫn `[4]` / `^4` bị báo sai `MISSING_REFERENCE` (`2` cạnh/tệp) dù mục `[4] Sutskever et al. (2014)` nằm rõ ràng trong References! Tương tự, mục `[3]` trong `hard_04` bị biến thành bản sao `[2]`.
  - Trên luận văn thực tế [72.pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/20-theses/72.pdf) (mất `[8]`, gây sai `[8]` `MISSING_REFERENCE`) và [85.pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/20-theses/85.pdf) (mất `[25]`, gây sai `3` cạnh `[25]` `MISSING_REFERENCE`).
- **Cơ chế gây lỗi:**
  1. Ở `hard_02`, mục `[2] Devlin (2019)` và mục chimera `[4] Sutskever (2014)` cố tình dùng chung DOI `10.18653/v1/N19-1423`. Từ điển đơn trị `grobid_by_doi = {g.doi.lower(): g ...}` (dòng `2521`) chỉ giữ lại phần tử cuối là `g = [4] Sutskever`. Khi duyệt `regex_refs` tới `c = [2] Devlin`, `grobid_by_doi.get(doi)` trả về `g = [4] Sutskever`, rồi `_enrich_grobid_ref(g, c)` (dòng `2282, 2393`) chép đè `donor.numeric_index = 2` lên `Sutskever`, xóa sổ hoàn toàn `numeric_index = 4`!
  2. Ở [72.pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/20-theses/72.pdf) và [85.pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/20-theses/85.pdf), GROBID gộp nhầm văn bản của `[8]` vào `[7]` (hoặc `[25]` vào `[24]`). Khi `regex_refs` mang mục `[8]` và `[25]` đã tách sạch sang bước bổ sung (dòng `2672`), nhánh `overlap_g` thấy tiêu đề con nằm trong chuỗi gộp của GROBID `[7]`/`[24]` nên nuốt mất mục `[8]`/`[25]` thay vì khôi phục!
- **Giải pháp fix triệt để:**
  1. Đổi `grobid_by_doi` và `grobid_by_url` sang `dict[str, list[Citation]]`. Khi `c.numeric_index is not None`, chỉ cho phép ghép donor-target qua DOI/URL nếu `g.numeric_index in (None, c.numeric_index)` **và** không xung đột họ tác giả đầu tiên.
  2. Trong `_enrich_grobid_ref` (dòng `2282, 2393`): **Tuyệt đối không ghi đè** `target.numeric_index` bằng `donor.numeric_index` khác số nếu trong `grobid_refs` đã có một phần tử khác giữ `donor.numeric_index`, hoặc khi `target` và `donor` khác họ tác giả đầu.
  3. Tại nhánh `overlap_g` (dòng `2656–2680`): Nếu `c.numeric_index = k` đang **khuyết hoàn toàn** trong tập `numeric_index` của `grobid_refs`, còn phần tử GROBID `g` có `g.numeric_index != k` và tác giả đầu của `c` không phải tác giả đầu của `g` (dấu hiệu GROBID gộp 2 mục số liên tiếp), không gộp vào `overlap_g` mà cho phép `c` được bổ sung để khôi phục đúng khe số `[k]`.

---

#### `[SYS-BUG-04]` (HIGH): Bất đối xứng định dạng năm có hậu tố (`"2026a"` vs `"2026"`) làm nhân bản TLTK ảo ở bước Hybrid Merge
- **Vị trí mã nguồn:**
  - [grobid_adapter.py](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/extraction/grobid_adapter.py#L628-L633), [grobid_adapter.py](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/extraction/grobid_adapter.py#L656-L659)
  - [document_parser.py](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/extraction/document_parser.py#L2541), [document_parser.py](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/extraction/document_parser.py#L2580), [document_parser.py](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/extraction/document_parser.py#L2657)
- **Bằng chứng thực tế:** [32.pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/20-theses/32.pdf) chỉ có `89` mục TLTK thật nhưng bị đẻ thành `94` mục (`5` bản sao ảo của `IEA 2026a/c/d` và `Office of the Historian 2017a/b` bị nối thêm vào cuối danh sách).
- **Cơ chế gây lỗi:** GROBID trích xuất `year="2026", year_suffix=None`, trong khi Regex trích xuất `year="2026", year_suffix="a"` (hoặc `year="2026a"`). Phép kiểm tra `str(cit.year) != str(existing_cit.year)` đánh giá `"2026a" != "2026"` là hai năm khác nhau nên từ chối khử trùng lặp dù trùng khít URL và tiêu đề.
- **Giải pháp fix triệt để:** Viết hàm chuẩn hóa `_same_or_compatible_year(c1, c2)`: so sánh 4 chữ số năm gốc (`y1 == y2`); chỉ coi là khác nhau khi **cả hai** đều có `year_suffix` khác rỗng và xung đột nhau (`s1 and s2 and s1 != s2`). Khi khớp thành công, cập nhật `target.year_suffix = donor.year_suffix` trong `_enrich_grobid_ref`.

---

#### `[SYS-BUG-05]` (HIGH): GROBID rò rỉ `<idno type="DOI">` từ mục TLTK lân cận trên trang PDF nhưng chưa đối chiếu lại với `raw_reference`
- **Vị trí mã nguồn:** [grobid_adapter.py](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/extraction/grobid_adapter.py#L510-L575) (`_grobid_bib_to_citation`)
- **Bằng chứng thực tế:** Tại [30.pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/20-theses/30.pdf) (tr. 29), mục `Fox, J. (2024). car: Companion to Applied Regression` (chỉ có URL `https://cran.r-project.org/...`, hoàn toàn không có DOI) bị GROBID gán nhầm DOI `10.1016/j.jfineco.2014.10.010` của mục `Fama & French (2015)` nằm ngay phía trên. Hậu quả là `DuplicateDetector` kết luận sai `Fox (2024)` trùng lặp với `Fama & French (2015)`!
- **Giải pháp fix triệt để:** Khi `consolidateCitations=0` (chế độ mặc định không tra cứu ngoài), mọi DOI do GROBID trả về phải xuất phát từ chính văn bản của mục đó. Trong `_grobid_bib_to_citation`, kiểm tra hậu tố cốt lõi của `bib.doi` (đã loại bỏ khoảng trắng/gạch nối ngắt dòng) có xuất hiện trong `bib.raw_reference` hay không; nếu **không** có trong `bib.raw_reference` nhưng lại nằm nguyên văn trong `raw_reference` của mục kề trước/kề sau thì xóa `doi = None`.

---

#### `[SYS-BUG-06]` (HIGH): GROBID tách đôi dòng DOI bị ngắt xuống hàng (`https://doi.org/10.\n1186/...`), dòng `Accessed 2025` và chuẩn IETF RFC thành mục `<biblStruct>` rác, làm trượt số thứ tự `[N]`
- **Vị trí mã nguồn:** [document_parser.py](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/extraction/document_parser.py#L2447-L2517) (bộ hàn mảnh vỡ GROBID — coalescing pass)
- **Bằng chứng thực tế:**
  - [20_clinical_outcomes...pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/style_corpora/AMA/real/20_clinical_outcomes_of_covid_19_infection_among_patients_with.pdf): **23 mục TLTK** của tạp chí Springer Nature bị ngắt dòng ngay sau dấu chấm `https://doi.org/10.` xuống dòng `1186/ s12882-022-02869-6 (2022).` → GROBID sinh ra 23 mục giả dạng `authors=['1186/ s12882-022-02869-6'], title=None`.
  - [06_academic_resilience...pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/style_corpora/APA/real/06_academic_resilience_in_challenging_times_exploring_strategi.pdf): sinh mục rác `ref-0075` (`1007/ s11218-023-09767-1 (2023).`).
  - [064_hcmus...pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/TDTU_PDF/064_hcmus_21200072_NguyenHongDanh_BaoCaoDeCuongLVThs.pdf): mục `[24]` bị tách đuôi URL thành mục `[25]` (`authors=['Accessed'], year='2025', title='d39400a_tilelink-spec-1.7.1.pdf'`), đẩy lệch toàn bộ `[25]..[33]` và làm `[32]` bị báo sai `MISSING_REFERENCE` 4 lần!
  - [hard_01_acs_superscript_and_semicolons.pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/style_corpora/ACS/hard_cases/hard_01_acs_superscript_and_semicolons.pdf): mục `7. Rescorla, E.; Dierks, T. The Transport Layer Security (TLS) Protocol Version 1.3; RFC 8446; (2018) Internet Engineering Task Force Standards Track.` bị GROBID cắt nửa sau thành `ref-0008` (`authors=[]`), sinh `1` `uncited_ref` giả.
- **Giải pháp fix triệt để:** Mở rộng bộ hàn mảnh vỡ GROBID tại [document_parser.py](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/extraction/document_parser.py#L2447-L2517) thêm **Pattern C**: tự động gộp `nxt` vào `cur` (và đánh số lại dải `numeric_index` liền sau nếu là danh sách đánh số tuần tự) khi:
  1. `cur.raw_text` kết thúc bằng tiền tố DOI dở dang (`(?:doi\.org/|doi:\s*)10\.?$`) hoặc `nxt.raw_text` mở đầu bằng mã đăng ký DOI (`^\s*\d{4,9}/\s*\S+`);
  2. `nxt.authors` chỉ chứa từ khóa truy cập `['Accessed']` / `['Retrieved']` kèm tên tệp `.pdf`/URL;
  3. `nxt.authors == []` và toàn bộ `nxt.raw_text` là phần đuôi của cùng một mục duy nhất bên `regex_refs`.

---

#### `[SYS-BUG-07]` (HIGH): `_enrich_grobid_ref` ghi đè danh sách tác giả & DOI sạch của GROBID bằng dữ liệu bẩn từ `apa_fallback`, đồng thời bỏ lỡ ca GROBID nhận nhầm từ viết tắt trong tiêu đề `(SOCS-3)` làm tên tác giả
- **Vị trí mã nguồn:** [document_parser.py](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/extraction/document_parser.py#L2307-L2350)
- **Bằng chứng thực tế:**
  - **Làm bẩn tác giả (dòng `2325`):** Tại [main.pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/6_ICCIES_2027/main.pdf) Ref #10, GROBID đã bắt đúng `['Mckie, J X']`, nhưng `donor` từ `apa_fallback` cắt nguyên cả tiêu đề thành 5 "tác giả" (`5 > 1`) nên ghi đè làm hỏng `target.authors`. Tại [19.pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/20-theses/19.pdf) Ref #3, `donor.authors` bị lặp đôi 9 tác giả thành 18 người (`18 > 9`) cũng ghi đè lên danh sách 9 người sạch của GROBID.
  - **Bỏ lỡ khôi phục tác giả bị GROBID đọc nhầm (dòng `2315`):** Tại [19.pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/20-theses/19.pdf) `ref-0069` (`Ueki, K., Kondo, T., & Kahn, C. R., 2004, Suppressor of Cytokine Signaling 1 (SOCS-1) and SOCS-3...`), GROBID gán nhầm `authors=['Socs-3']`, trong khi Regex bắt chuẩn xác `['Ueki, K.', 'Kondo, T.', 'Kahn, C. R.']`. Do `'socs-3' != 'ueki'` nên điều kiện `t_first == d_first` (dòng `2324`) bị chặn, khiến `(Ueki et al., 2004)` trong thân bài bị gãy liên kết!
  - **Làm bẩn DOI (dòng `2348`):** Điều kiện `donor.doi.lower().startswith(target.doi.lower()) and len(donor.doi) > len(target.doi)` nối thêm rác của Regex vào DOI sạch của GROBID: `10.1080/09603101003636204Nokia` ([203.pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/20-theses/203.pdf)), `10.1080/...1354551.73` ([213.pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/20-theses/213.pdf)), `10.1186/...-0066-7.pdf(Accessed` ([103.pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/20-theses/103.pdf)), và `?casa_token=...` ([112.pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/20-theses/112.pdf)).
- **Giải pháp fix triệt để:**
  1. Không bao giờ ghi đè `target.authors` khi `donor.matched_pattern == "apa_fallback"` hoặc khi phần tử trong `donor.authors` chứa dấu `:`, chữ số, hoặc dài quá `5` từ; khử trùng lặp tên tác giả trước khi so sánh độ dài.
  2. Bổ sung nhánh cứu hộ: khi `len(target.authors) == 1` mà tên tác giả duy nhất của GROBID chứa chữ số/gạch nối (như `Socs-3`) hoặc nằm bên trong `donor.title`, trong khi `donor.authors` đứng ngay đầu `raw_text`, cho phép thay thế `target.authors = donor.authors`.
  3. Chuẩn hóa làm sạch DOI (cắt bỏ `?casa_token=...`, query string `?`, đuôi `.pdf`, `(Accessed...`, từ viết hoa dính liền kiểu `...04Nokia`, và số trang đứng sau dấu chấm) trước khi so sánh độ dài ở dòng `2348`.

---

### Phân hệ C — Liên Kết Hai Chiều (`CitationLinker`) & Phát Hiện Trùng Lặp (`DuplicateDetector`)

#### `[SYS-BUG-08]` (HIGH): Nhãn viết tắt định nghĩa đứng trước dấu chấm phẩy trong ngoặc đơn `(SEIS; Schutte et al., 2009)` bị ghép nhầm thành họ tác giả đầu tiên
- **Vị trí mã nguồn:** [citation_linker.py](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/linking/citation_linker.py#L482-L495) (`_split_multi_citation`)
- **Bằng chứng thực tế:**
  - [5.pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/20-theses/5.pdf): `(SEIS; Schutte et al., 2009)` và `(IAPS; Kurdi et al., 2017)` bị báo sai `MISSING_REFERENCE` + đồng thời biến 2 tài liệu trong References thành `UNCITED_REFERENCE` giả.
  - [19.pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/20-theses/19.pdf): `(AVP; Rusch et al., 2023)`, `(MAG; Morigny et al., 2016)`, `(SOCS; Turpin et al., 2023)` bị lỗi tương tự.
- **Cơ chế gây lỗi:** Ở dòng `485–488`, khi gặp vế trước dấu `;` không có năm xuất bản, biểu thức `not rp_clean.isupper()` trả về `False` đối với từ viết tắt in hoa (`"SEIS"`). Thay vì bỏ qua nhãn viết tắt này, code đẩy `"SEIS"` vào `buf_semi` rồi nối dấu phẩy vào trước vế sau thành `"(SEIS, Schutte et al., 2009)"` → bộ trích xuất lấy `"SEIS"` làm họ tác giả chính thay vì `"Schutte"`!
- **Giải pháp fix triệt để:** Chỉ cho phép ghép `buf_semi` (tên tổ chức viết tắt kiểu `WHO`) vào vế sau dấu `;` khi vế sau **chỉ chứa năm xuất bản / trang** (ví dụ `(WHO; 2020)`). Nếu vế sau dấu `;` đã tự có cấu trúc `Author + Year` hoàn chỉnh (`re.search(r"[A-Za-zÀ-ỹ]{2,}.*\b(?:18|19|20)\d{2}\b", next_rp)`), lập tức hủy bỏ tiền tố viết tắt không năm ở vế trước.

---

#### `[SYS-BUG-09]` (CRITICAL cho Văn bản Pháp luật VN): `author_match_score` khớp nhầm hai Bộ luật khác nhau ban hành cùng năm (`Bộ luật Tố tụng dân sự (2015)` → `Bộ luật Dân sự (2015)`)
- **Vị trí mã nguồn:** [citation_linker.py](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/linking/citation_linker.py#L736-L747) (`_try_fuzzy_author_year`)
- **Bằng chứng thực tế:** Tại [hard_04_vn_legal_linking_anomalies.pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/vn_legal_reports/hard_cases/hard_04_vn_legal_linking_anomalies.pdf) (`occ-0004` và `occ-0013`), trích dẫn mồ côi `Bộ luật Tố tụng dân sự (2015)` (không có trong Danh mục TLTK) bị gắn nhãn `MATCHED` nhầm vào `ref-0001 Bộ luật Dân sự (2015)` với `confidence = 0.75`!
- **Cơ chế gây lỗi:** Bộ so khớp tên người `author_match_score` tách từ đầu/từ cuối (`"bộ"` và `"sự"`) như họ và tên người Việt, trả về điểm tuyệt đối `1.0` giữa `"Bộ luật Tố tụng dân sự"` và `"Bộ luật Dân sự"`, cộng cùng năm `2015` nên vượt ngưỡng khớp mờ!
- **Giải pháp fix triệt để:** Tại `_try_fuzzy_author_year` ([citation_linker.py](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/linking/citation_linker.py#L738-L742)), loại trừ hoàn toàn các mục `bib.matched_pattern == "vn_legal_document"` và các chuỗi truy vấn mở đầu bằng danh từ loại văn bản pháp quy (`^(?:bộ\s+luật|luật|pháp\s+lệnh|nghị\s+định|thông\s+tư|quyết\s+định|nghị\s+quyết|hiến\s+pháp)\b`) khỏi bộ khớp họ tên người `author_match_score` (văn bản pháp luật chỉ được phép khớp qua nhánh định danh số hiệu hoặc khớp chính xác tên đạo luật chuẩn hóa).

---

#### `[SYS-BUG-10]` (MEDIUM-HIGH): Trích dẫn gộp nhiều năm của cùng một nhóm tác giả `(Beck et al., 1979 & 2005)` chỉ giữ lại 1 năm, và cụm `"all cited by"` chưa được nhận diện là trích dẫn thứ cấp
- **Vị trí mã nguồn:** [citation_linker.py](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/linking/citation_linker.py#L465-L535) và [citation_linker.py](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/linking/citation_linker.py#L559-L610)
- **Bằng chứng thực tế:**
  - [57.pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/20-theses/57.pdf) (`occ-0047`): `(Beck et al., 1979 & 2005; Clark & Beck, 1999)` chỉ trích xuất năm `2005` (hoặc `1979`), bỏ rơi năm còn lại khiến `Beck et al. (1979)` (`ref-0006`) bị cảnh báo sai `UNCITED_REFERENCE`.
  - [18_organizational_interventions...pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/style_corpora/APA/real/18_organizational_interventions_for_improving_mental_health_of.pdf): `(Van der Doef & Maes, 1999; Siegrist, 1996; all cited by Fox et al., 2023)` — do `_SECONDARY_CITATION_RE` chỉ bắt `as cited in` / `cited in` mà chưa có `(?:all\s+)?cited\s+by`, nên hai nguồn gốc phía trước bị báo sai `MISSING_REFERENCE`.
- **Giải pháp fix triệt để:**
  1. Trong `_split_multi_citation`, tách chuỗi đa năm của cùng tác giả `Author, YYYY1(?:\s*(?:,|&|\band\b|\bvà\b)\s*YYYY2)+` thành các phần tử độc lập `(Author, YYYY1)` và `(Author, YYYY2)`.
  2. Mở rộng `_SECONDARY_CITATION_RE` hỗ trợ `(?:all\s+)?(?:as\s+)?cited\s+(?:in|by)\b`.

---

#### `[SYS-BUG-11]` (MEDIUM): `DuplicateDetector` bỏ sót cặp TLTK trùng khít URL cụ thể khi `authors == []`
- **Vị trí mã nguồn:** [duplicate_detector.py](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/linking/duplicate_detector.py#L106-L160)
- **Bằng chứng thực tế:** Tại [99.pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/20-theses/99.pdf), `ref-0096` và `ref-0097` giống hệt nhau (`Wikipedia, 2020. IKEA. https://en.wikipedia.org/wiki/IKEA#cite_note-19`) nhưng do GROBID để `authors=[]` và tiêu đề ngắn `IKEA`, `DuplicateDetector` không bắt được.
- **Giải pháp fix triệt để:** Bổ sung nhánh so khớp `url` chuẩn hóa có đường dẫn cụ thể (`path` dài `>= 6` ký tự, không phải trang chủ domain gốc như `https://www.who.int/`) tương tự nhánh khớp DOI/arXiv khi hai mục không xung đột tiêu đề hoặc hậu tố năm (`not self._explicitly_distinct(a, b)`).

---

### Phân hệ D — Phân Đoạn Tài Liệu (`SectionSegmenter`) & Lọc Rác Trang (`Page Furniture`)

#### `[SYS-BUG-12]` (HIGH): Bất đồng bộ ngưỡng nhảy số chú thích chân trang (`+12` ở `SectionSegmenter` vs `+2` ở `ReferenceListParser`) tạo ra mục TLTK khổng lồ dài `7.621` ký tự
- **Vị trí mã nguồn:**
  - [section_segmenter.py](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/extraction/section_segmenter.py#L877-L961) (`_synthesize_footnote_bibliography`)
  - [reference_parser.py](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/extraction/reference_parser.py#L709) và [reference_parser.py](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/extraction/reference_parser.py#L787) (`_split_sequential_dot_numbered`)
- **Bằng chứng thực tế:** Tại luận văn luật chuẩn Bluebook [3.pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/20-theses/3.pdf) (`180` footnotes, không có trang References riêng ở cuối bài):
  - Các footnote chuẩn Bluebook mở đầu bằng số tập như `5 21 U.S.C. § 355 (2018)` không khớp biểu thức `fn_start_re` (vốn đòi ký tự chữ cái ngay sau số thứ tự), làm danh sách tổng hợp nhảy từ footnote `4` sang thẳng footnote `8`.
  - `SectionSegmenter` cho phép bước nhảy tối đa `+12` (dòng `922`), nhưng khi chuyển sang `ReferenceListParser._split_sequential_dot_numbered` (dòng `709, 787`), bộ tách chỉ cho phép `n <= curr_num + 2` (`8 > 6`) → từ chối tách và gộp dính toàn bộ các footnote từ `4` đến `180` thành một `ref-0003` duy nhất dài `7.621` ký tự!
- **Giải pháp fix triệt để:**
  1. Mở rộng `fn_start_re` tại [section_segmenter.py](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/extraction/section_segmenter.py#L890) nhận diện cả chú thích Bluebook mở đầu bằng số tập (`^\s*(\d{1,3})(?:\.|\s)\s*(?:\d+\s+[A-Z]|[A-ZÀ-Ý“\"‘'])`).
  2. Khi phân đoạn mang cờ `synthetic_footnote_bibliography=True` (hoặc chuỗi đánh số tăng đơn điệu có `>= 8` mục), đồng bộ ngưỡng nhảy số trong `_split_sequential_dot_numbered` lên `+12` để không bao giờ gộp dính hàng trăm chú thích.

---

#### `[SYS-BUG-13]` (HIGH): `SectionSegmenter` bỏ sót mục `REFERENCES` khi dòng `[1].` đứng riêng một hàng, và `DocumentParser` nhận nhầm gạch đầu dòng văn xuôi / câu hỏi Phụ lục do GROBID ảo giác
- **Vị trí mã nguồn:**
  - [section_segmenter.py](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/extraction/section_segmenter.py#L610-L638)
  - [document_parser.py](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/extraction/document_parser.py#L2435-L2460)
- **Bằng chứng thực tế:**
  - **Bỏ sót toàn bộ mục `REFERENCES`:** Tại [061_tdtu...pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/tdtu_github_reports/061_tdtu_esp32-s3-object-detection-and-tracking-system__Midterm_Report.pdf) (tr. 49), tiêu đề `REFERENCES` nằm ngay dưới running header `Page 49/50` và mục đầu tiên ngắt dòng thành `[1].\nDesign, manufacture...`. Hàm kiểm tra tại `section_segmenter.py:630` viết `r"^\s*(?:\[\s*1\s*\]|1\.)\s+\S"` (bắt buộc có ký tự ngay trên cùng dòng sau `[1]` và không có dấu chấm `[1].`), nên từ chối tiêu đề `REFERENCES`, làm mất trắng cả 7 tài liệu tham khảo!
  - **Nhận nhầm ảo giác GROBID:** Tại [086_uit](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/TDTU_PDF/086_uit_845_171219981702397804258183735687.pdf) (`has_bib_section=False`, `regex_refs=[]`), GROBID tự biến 8 gạch đầu dòng liệt kê chức năng phần mềm tiếng Việt thành 8 mục TLTK rỗng (`authors=[], year=None, doi=None, url=None`). Tại [57.pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/20-theses/57.pdf) (`ref-0051`), GROBID nhặt câu hỏi thang đo trầm cảm CES-D ở Phụ lục tr. 39 (`"I could not get 'going'"`, `authors=['I'], year=None`) thành TLTK thừa!
- **Giải pháp fix triệt để:**
  1. Tại [section_segmenter.py](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/extraction/section_segmenter.py#L613-L635): Nhận diện running header `page \d+/\d+` và cho phép dấu hiệu mục đầu tiên dạng `^\s*(?:\[\s*1\s*\]\.?|1\.)(?:\s+\S|\s*$)`.
  2. Tại [document_parser.py](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/extraction/document_parser.py): Loại bỏ các mục `<biblStruct>` của GROBID khi đồng thời không có `year`, không có `doi`, không có `url`, tác giả rỗng hoặc chỉ là đại từ 1 ký tự (`['I']`), **và** văn bản gốc của mục đó không nằm trong vùng `bibliography` do `SectionSegmenter` xác định (hoặc nằm sau trang `appendix_start`).

---

#### `[SYS-BUG-14]` (MEDIUM-HIGH): Rò rỉ Running Header / Footer trang vào mục TLTK và nối dính số trang vào cuối URL / DOI
- **Vị trí mã nguồn:** [reference_parser.py](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/extraction/reference_parser.py#L1474-L1626) (`_strip_page_furniture`)
- **Bằng chứng thực tế:**
  - [34.pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/20-theses/34.pdf): Running header `'Honors Thesis: | N. Alice Droeger 49'` lọt qua bộ lọc, tạo thành 1 mục TLTK giả.
  - [134.pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/20-theses/134.pdf): Footer giãn cách ký tự `'62 | P a g e'` dính vào trường tác giả.
  - [32.pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/20-theses/32.pdf) & [213.pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/20-theses/213.pdf): Dòng nối trang tại `reference_parser.py:1572` thấy dòng trước kết thúc bằng URL/DOI có dấu chấm câu `.` ở cuối và dòng đầu trang mới là số trang `73` hoặc header MLA `Weitzel 45` → nối thẳng thành `10.1080/...1354551.73` và `.../.Weitzel45`!
  - [01_clinical_characteristics...pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/style_corpora/AMA/real/01_clinical_characteristics_and_risk_factors_for_mortality_in_a.pdf) & [01_associations_between...pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/style_corpora/APA/real/01_associations_between_screen_time_and_mental_health_in_childr.pdf): Footer lặp lại ở mọi trang của tạp chí `PLOS ONE | DOI:10.1371/journal.pone...` không bị xóa vì dòng `1622–1623` miễn trừ cứng mọi dòng chứa chuỗi `10.\d{4,9}/`.
- **Giải pháp fix triệt để:**
  1. Bổ sung mẫu lọc `P\s*a\s*g\s*e`, mẫu running header có dấu gạch đứng `^[^\n]{4,65}\|\s*[^\n]{2,40}\s+\d{1,3}$`, và cho phép xóa dòng lặp lại `counts[stripped] >= 2` ngay cả khi chứa DOI nếu đó chính là dòng footer tạp chí (`PLOS ONE | DOI:` hoặc trùng với DOI của chính bài báo).
  2. Tại dòng `1572`: Không bao giờ nối dòng chỉ chứa số trang `^\d{1,3}$` vào cuối URL/DOI kết thúc bằng dấu chấm câu `.`.

---

### Phân hệ E — Biểu Thức Chính Quy Tách Trường (`Patterns` & `In-Text False Positives`)

#### `[SYS-BUG-15]` (MEDIUM): Cắt nhầm tên miền URL thành `title='https://x'` / `'https://github'`, bỏ sót URL dạng `www.` / `<http...>`, và Regex bắt nhầm số kỳ tạp chí `(7553)` làm năm xuất bản `year='7553'`
- **Vị trí mã nguồn:**
  - [apa.py](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/extraction/patterns/apa.py#L103-L106), [apa.py](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/extraction/patterns/apa.py#L136), [apa.py](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/extraction/patterns/apa.py#L152)
  - [reference_parser.py](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/extraction/reference_parser.py#L117-L118) (`_URL_RE`)
- **Bằng chứng thực tế:**
  - [15.pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/20-theses/15.pdf) (`Author (2024). https://x.com/...`) và [main.pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/6_ICCIES_2027/main.pdf) (bản Regex r10 `https://github.com/...`): Nhóm `(?P<title>[^\.]+?)\.(?P<venue>.+)` tại `apa.py:103` cắt ngay tại dấu chấm đầu tiên của tên miền, sinh ra `title="https://x"` và `venue="com/..."`!
  - `16` tài liệu duy nhất ([73.pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/20-theses/73.pdf), [98.pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/20-theses/98.pdf), [108.pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/20-theses/108.pdf), [120.pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/20-theses/120.pdf), [026_tdtu](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/tdtu_github_reports/026_tdtu_Midterm_Java_SpringBoot__Report.pdf)...) chứa URL dạng `www.unb.ca/...` hoặc `<http://...>` bị để `citation.url = None`; `2` tài liệu ([138.pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/20-theses/138.pdf), [197.pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/20-theses/197.pdf)) có `https://doi.org/10....` nhưng `citation.doi = None`.
  - Tại [hard_01_acs_superscript_and_semicolons.pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/style_corpora/ACS/hard_cases/hard_01_acs_superscript_and_semicolons.pdf) (nhánh thuần Regex): chuỗi `Nature 2015, 521 (7553), 436–444.` khớp vào `(?P<year>\d{4})` tại `apa.py:136, 152` và gán `year="7553"`!
- **Giải pháp fix triệt để:**
  1. Tại `apa.py:103`: Thêm negative lookahead `(?P<title>(?!https?://|www\.)[^\.]+?)` để không bao giờ xẻ đôi URL tại dấu chấm tên miền.
  2. Tại `apa.py:136, 152`: Đổi `(?P<year>\d{4})` thành `(?P<year>(?:18|19|20)\d{2})` giống dòng `101`.
  3. Tại `reference_parser.py:117`: Mở rộng `_URL_RE` bắt cả `\bwww\.[A-Za-z0-9\-]+\.[A-Za-z]{2,}\S*` (tự chuẩn hóa thêm `https://`), tước bỏ dấu `< >` bao quanh URL và tự động rút trích `citation.doi` nếu URL có dạng `doi.org/(10\.\d{4,9}/\S+)`.

---

#### `[SYS-BUG-16]` (MEDIUM): Tên tác phẩm lịch sử / thuật ngữ viết hoa kèm `(Năm)` trong văn xuôi bị bắt nhầm thành trích dẫn tường thuật `Author (Year)`
- **Vị trí mã nguồn:** [apa.py](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/extraction/patterns/apa.py#L36-L52) và [apa.py](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/src/integrity_checker/extraction/patterns/apa.py#L78-L90) (`_APA_INTEXT_NARRATIVE`)
- **Bằng chứng thực tế:**
  - [02_john_pocock...pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/style_corpora/Chicago/real/02_john_pocock_and_the_cambridge_school_of_intellectual_history.pdf): Hàng loạt tên sách và khái niệm lịch sử trong câu văn như `Feudal Law (1957)`, `The Machiavellian Moment (1975)`, `History (1944)` bị bắt làm trích dẫn tác giả, gây ra `25` cạnh `MISSING_REFERENCE` giả!
  - [72.pdf](file:///Users/iannwendy/Desktop/DATN/essay-integrity-checker/20-theses/72.pdf): `The Second Industrial Revolution (1870)` và `The Third Industrial Revolution (1950)` bị bắt làm trích dẫn của tác giả tên `"Revolution"`.
- **Giải pháp fix triệt để:** Bổ sung danh sách từ khóa danh từ tên tác phẩm / sự kiện lịch sử (`Revolution`, `Moment`, `History`, `Law`, `Constitution`, `Treaty`, `War`, `Manifesto`, `Edition`, `Survey`, `Index`) vào tập loại trừ hậu tố của `_APA_INTEXT_NARRATIVE`, đồng thời chặn các cụm mở đầu bằng mạo từ `The + Tính từ/Danh từ` (`\bThe\s+(?:[A-Z][a-z]+\s+){1,3}(18|19|20)\d{2}`).

---

## 6. Lộ Trình Ưu Tiên Khắc Phục Đề Xuất (Zero-Regression Roadmap)

Để đưa độ chính xác toàn cục lên mức tối đa mà không gây bất kỳ hồi quy nào trên `1.064` tệp PDF hiện có, thứ tự triển khai tối ưu gồm 3 đợt ngắn gọn:

| Mức ưu tiên | Danh sách mã Bug | Tác động trực tiếp sau khi vá |
| :--- | :--- | :--- |
| **Đợt 1 — `P0` (Nghiêm trọng nhất)** | `SYS-BUG-01`, `SYS-BUG-02`, `SYS-BUG-03`, `SYS-BUG-09` | Khôi phục `100%` tính toàn vẹn dữ liệu giữa Pipeline và API `/report` (`0` rơi mất Verdict trên cả `23` tài liệu, `0` rơi cạnh `missing_reference`); xóa sạch lỗi mất số `[4]`/`[3]` trên cả 6 chuẩn đánh số (`IEEE, ACM, ACS, AMA, Nature, Vancouver`) và chặn triệt để lỗi khớp nhầm hai Bộ luật Việt Nam cùng năm. |
| **Đợt 2 — `P1` (Chất lượng Hybrid GROBID & Linking)** | `SYS-BUG-04`, `SYS-BUG-05`, `SYS-BUG-06`, `SYS-BUG-07`, `SYS-BUG-08`, `SYS-BUG-12`, `SYS-BUG-13` | Xóa bỏ hoàn toàn hiện tượng GROBID tách đôi dòng DOI/URL làm trượt số thứ tự (`064_hcmus`, `AMA/real/20`, `ACS/hard_01`), chặn rò rỉ DOI hàng xóm (`30.pdf`), chặn nhân bản năm `2026a` (`32.pdf`), cứu hộ hoàn chỉnh luận văn chú thích Bluebook (`3.pdf`), khôi phục mục `REFERENCES` của `061_tdtu`, và sửa lỗi tiền tố viết tắt `(SEIS; Author, Year)`. |
| **Đợt 3 — `P2` (Làm sạch trường & Chặn nhiễu văn xuôi)** | `SYS-BUG-10`, `SYS-BUG-11`, `SYS-BUG-14`, `SYS-BUG-15`, `SYS-BUG-16` | Xử lý trọn vẹn đa năm `(1979 & 2005)`, `"all cited by"`, trùng lặp URL không tác giả, dọn sạch header/footer trang dính vào URL/DOI, bắt đủ URL `www.`/`<http...>`, và triệt tiêu dương tính giả trên tên sách/sự kiện lịch sử kèm `(Năm)`. |
