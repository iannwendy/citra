# Báo Cáo Kiểm Thử Hiệu Năng Phi Chức Năng & Chịu Tải (`CITRA` Chapter 5 NFR Benchmark)

- **Thời điểm chạy:** `2026-11-10T07:43:20Z`
- **Môi trường:** `{'python_version': '3.14.6', 'platform': 'macOS-26.6.2-arm64-arm-64bit-Mach-O', 'machine': 'arm64', 'processor': 'arm', 'iterations': 5, 'warmup_runs': 1, 'sbert_enabled': True}`

---

## 1. Phân Vị Độ Trễ P50 / P90 / P99 ($P_{50}, P_{90}, P_{99}$) & Mức Tiêu Thụ RAM Theo 8 Bước Xử Lý

### Bài báo khoa học ngắn (~10 trang) — `TDTU_PDF/098_uit_vnuhcm_Vietnamese_Hate_Speech_Detection_in_Gaming_Domain_Edited_Report.pdf` (12 trang, 31 trích dẫn trong bài, 24 tài liệu tham khảo, $N=5$ lần chạy)

| Bước (`step_key`) | Mô tả công đoạn | P50 ($P_{50}$, ms) | P90 ($P_{90}$, ms) | P99 ($P_{99}$, ms) | Mean ± Std (ms) | Peak Heap $\Delta$ (MB) | Process RSS (MB) |
| :--- | :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| `parsing` | 1. Document Parsing & Section Segmentation | 100.10 | 126.33 | 141.97 | 108.47 ± 19.72 | 1.525 | 719.2 |
| `style_detection` | 2. Style Profile Detection & Diagnostics | 0.17 | 0.31 | 0.39 | 0.21 ± 0.10 | 0.005 | 719.2 |
| `extracting` | 3. Citation & Bibliography Extraction | 88.90 | 146.51 | 180.99 | 107.59 ± 43.18 | 0.839 | 719.2 |
| `linking` | 4. Bidirectional In-Text <-> Reference Linking | 21.60 | 29.21 | 33.70 | 24.02 ± 5.70 | 0.120 | 719.2 |
| `retrieving` | 5. Multi-Source Tiered Scholarly Retrieval | 18.74 | 19.92 | 20.34 | 19.06 ± 0.81 | 0.065 | 719.2 |
| `comparing` | 6. Lexical & Neural Semantic Evidence Alignment | 195.28 | 210.77 | 215.51 | 198.72 ± 11.11 | 0.163 | 719.2 |
| `checking` | 7. Neuro-Symbolic Rules & Platt Calibration | 80.55 | 86.04 | 86.91 | 81.78 ± 3.89 | 0.047 | 719.2 |
| `scoring` | 8. CIS Calculation & Report Generation | 0.61 | 0.66 | 0.68 | 0.61 ± 0.04 | 0.005 | 719.2 |
| **Tổng (`total`)** | **Toàn bộ luồng 8 bước** | **504.19** | **618.68** | **679.34** | **540.47 ± 81.84** | **1.615** | **719.2** |

### Khóa luận tốt nghiệp (~50 trang) — `20-theses/109.pdf` (50 trang, 108 trích dẫn trong bài, 32 tài liệu tham khảo, $N=5$ lần chạy)

| Bước (`step_key`) | Mô tả công đoạn | P50 ($P_{50}$, ms) | P90 ($P_{90}$, ms) | P99 ($P_{99}$, ms) | Mean ± Std (ms) | Peak Heap $\Delta$ (MB) | Process RSS (MB) |
| :--- | :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| `parsing` | 1. Document Parsing & Section Segmentation | 351.57 | 357.39 | 360.39 | 352.96 ± 4.46 | 4.380 | 748.2 |
| `style_detection` | 2. Style Profile Detection & Diagnostics | 0.76 | 0.79 | 0.80 | 0.76 ± 0.03 | 0.006 | 748.2 |
| `extracting` | 3. Citation & Bibliography Extraction | 371.11 | 374.94 | 376.21 | 372.27 ± 2.47 | 2.548 | 748.2 |
| `linking` | 4. Bidirectional In-Text <-> Reference Linking | 74.60 | 75.60 | 75.85 | 74.78 ± 0.81 | 0.253 | 748.2 |
| `retrieving` | 5. Multi-Source Tiered Scholarly Retrieval | 26.50 | 27.46 | 28.04 | 26.57 ± 0.95 | 0.072 | 748.3 |
| `comparing` | 6. Lexical & Neural Semantic Evidence Alignment | 467.37 | 495.92 | 512.11 | 472.76 ± 23.83 | 0.222 | 748.3 |
| `checking` | 7. Neuro-Symbolic Rules & Platt Calibration | 69.73 | 72.76 | 72.87 | 69.76 ± 3.08 | 0.138 | 748.3 |
| `scoring` | 8. CIS Calculation & Report Generation | 0.89 | 0.94 | 0.95 | 0.88 ± 0.06 | 0.005 | 748.3 |
| **Tổng (`total`)** | **Toàn bộ luồng 8 bước** | **1367.11** | **1397.23** | **1410.77** | **1370.74 ± 25.79** | **4.385** | **748.5** |

### Luận văn / Đồ án quy mô lớn (100+ trang) — `VN_UNI_PDF_BATCH2/088_ou_hcm_KLTN_IEEE_FULL_PAPER_VN.pdf` (156 trang, 101 trích dẫn trong bài, 87 tài liệu tham khảo, $N=5$ lần chạy)

| Bước (`step_key`) | Mô tả công đoạn | P50 ($P_{50}$, ms) | P90 ($P_{90}$, ms) | P99 ($P_{99}$, ms) | Mean ± Std (ms) | Peak Heap $\Delta$ (MB) | Process RSS (MB) |
| :--- | :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| `parsing` | 1. Document Parsing & Section Segmentation | 602.94 | 609.05 | 611.18 | 603.53 ± 5.25 | 11.099 | 945.7 |
| `style_detection` | 2. Style Profile Detection & Diagnostics | 0.68 | 0.69 | 0.70 | 0.67 ± 0.03 | 0.006 | 945.7 |
| `extracting` | 3. Citation & Bibliography Extraction | 679.84 | 687.33 | 691.15 | 681.41 ± 5.93 | 5.700 | 945.7 |
| `linking` | 4. Bidirectional In-Text <-> Reference Linking | 252.02 | 255.88 | 257.16 | 252.35 ± 3.36 | 0.245 | 945.7 |
| `retrieving` | 5. Multi-Source Tiered Scholarly Retrieval | 67.50 | 68.89 | 69.51 | 67.70 ± 1.15 | 0.146 | 945.7 |
| `comparing` | 6. Lexical & Neural Semantic Evidence Alignment | 2236.48 | 2247.23 | 2252.88 | 2239.53 ± 7.91 | 1.161 | 945.7 |
| `checking` | 7. Neuro-Symbolic Rules & Platt Calibration | 278.72 | 282.03 | 282.80 | 279.08 ± 2.75 | 0.205 | 945.7 |
| `scoring` | 8. CIS Calculation & Report Generation | 1.24 | 1.34 | 1.35 | 1.28 ± 0.06 | 0.006 | 945.7 |
| **Tổng (`total`)** | **Toàn bộ luồng 8 bước** | **4123.03** | **4133.27** | **4134.90** | **4125.56 ± 7.21** | **11.107** | **946.5** |

---

## 2. Kiểm Thử Chịu Tải `DeadlineQueueManager` & SQLite Khi 20–50 Sinh Viên Nộp Bài Đồng Thời

| Số SV đồng thời ($N$) | Worker tối đa | Tỷ lệ hoàn thành | Peak Active / Queue | FIFO chuẩn | Queue Wait $P_{50}/P_{90}/P_{99}$ (ms) | Processing $P_{50}/P_{90}/P_{99}$ (ms) | Throughput (bài/s · trích dẫn/s) | Lỗi `SQLite locked` | Lỗi `HTTP 502/429` |
| :---: | :---: | :---: | :---: | :---: | ---: | ---: | ---: | :---: | :---: |
| **20** | 3 | **20/20 (100.0%)** | 3 / 17 | `PASS` | 348.2 / 550.3 / 595.4 | 80.6 / 129.8 / 163.5 | **28.73** bài/s (431.0 cit/s) | **0** | **0** (rescued 60/60 429s) |
| **50** | 3 | **50/50 (100.0%)** | 3 / 47 | `PASS` | 2874.1 / 3399.6 / 3517.7 | 74.5 / 263.4 / 2042.8 | **13.71** bài/s (205.7 cit/s) | **0** | **0** (rescued 150/150 429s) |
