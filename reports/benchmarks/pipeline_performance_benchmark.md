# Báo Cáo Kiểm Thử Hiệu Năng Phi Chức Năng & Chịu Tải (`CITRA` Chapter 5 NFR Benchmark)

- **Thời điểm chạy:** `2026-11-10T08:32:10Z`
- **Môi trường:** `{'python_version': '3.14.6', 'platform': 'macOS-26.6.2-arm64-arm-64bit-Mach-O', 'machine': 'arm64', 'processor': 'arm', 'iterations': 5, 'warmup_runs': 1, 'sbert_enabled': True}`

---

## 1. Phân Vị Độ Trễ P50 / P90 / P99 ($P_{50}, P_{90}, P_{99}$) & Mức Tiêu Thụ RAM Theo 8 Bước Xử Lý

### Bài báo khoa học ngắn (~10 trang) — `TDTU_PDF/098_uit_vnuhcm_Vietnamese_Hate_Speech_Detection_in_Gaming_Domain_Edited_Report.pdf` (12 trang, 31 trích dẫn trong bài, 24 tài liệu tham khảo, $N=5$ lần chạy)

| Bước (`step_key`) | Mô tả công đoạn | P50 ($P_{50}$, ms) | P90 ($P_{90}$, ms) | P99 ($P_{99}$, ms) | Mean ± Std (ms) | Peak Heap $\Delta$ (MB) | Process RSS (MB) |
| :--- | :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| `parsing` | 1. Document Parsing & Section Segmentation | 97.49 | 123.71 | 138.66 | 106.00 ± 19.21 | 1.523 | 835.7 |
| `style_detection` | 2. Style Profile Detection & Diagnostics | 0.16 | 0.28 | 0.34 | 0.20 ± 0.09 | 0.005 | 835.7 |
| `extracting` | 3. Citation & Bibliography Extraction | 85.33 | 139.98 | 170.96 | 103.46 ± 39.69 | 0.837 | 835.7 |
| `linking` | 4. Bidirectional In-Text <-> Reference Linking | 20.85 | 28.38 | 32.62 | 23.10 ± 5.61 | 0.120 | 835.7 |
| `retrieving` | 5. Multi-Source Tiered Scholarly Retrieval | 18.79 | 19.57 | 19.90 | 18.88 ± 0.69 | 0.064 | 835.7 |
| `comparing` | 6. Lexical & Neural Semantic Evidence Alignment | 189.66 | 191.50 | 192.32 | 189.50 ± 2.18 | 0.163 | 835.7 |
| `checking` | 7. Neuro-Symbolic Rules & Platt Calibration | 77.95 | 82.39 | 83.49 | 78.81 ± 3.28 | 0.047 | 835.7 |
| `scoring` | 8. CIS Calculation & Report Generation | 0.57 | 0.61 | 0.61 | 0.58 ± 0.03 | 0.005 | 835.7 |
| **Tổng (`total`)** | **Toàn bộ luồng 8 bước** | **494.10** | **583.41** | **635.47** | **520.53 ± 67.70** | **1.612** | **835.7** |

### Khóa luận tốt nghiệp (~50 trang) — `20-theses/109.pdf` (50 trang, 108 trích dẫn trong bài, 32 tài liệu tham khảo, $N=5$ lần chạy)

| Bước (`step_key`) | Mô tả công đoạn | P50 ($P_{50}$, ms) | P90 ($P_{90}$, ms) | P99 ($P_{99}$, ms) | Mean ± Std (ms) | Peak Heap $\Delta$ (MB) | Process RSS (MB) |
| :--- | :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| `parsing` | 1. Document Parsing & Section Segmentation | 334.41 | 337.81 | 339.40 | 335.20 ± 2.55 | 4.380 | 843.1 |
| `style_detection` | 2. Style Profile Detection & Diagnostics | 0.74 | 0.82 | 0.85 | 0.75 ± 0.07 | 0.006 | 843.1 |
| `extracting` | 3. Citation & Bibliography Extraction | 358.70 | 365.12 | 365.90 | 360.97 ± 3.67 | 2.546 | 843.1 |
| `linking` | 4. Bidirectional In-Text <-> Reference Linking | 72.37 | 73.10 | 73.36 | 71.86 ± 1.37 | 0.253 | 843.1 |
| `retrieving` | 5. Multi-Source Tiered Scholarly Retrieval | 26.53 | 27.31 | 27.63 | 26.30 ± 1.15 | 0.069 | 843.2 |
| `comparing` | 6. Lexical & Neural Semantic Evidence Alignment | 441.88 | 460.35 | 464.79 | 446.96 ± 12.07 | 0.222 | 843.2 |
| `checking` | 7. Neuro-Symbolic Rules & Platt Calibration | 63.46 | 69.37 | 70.46 | 65.58 ± 3.36 | 0.138 | 843.2 |
| `scoring` | 8. CIS Calculation & Report Generation | 0.76 | 0.84 | 0.85 | 0.79 ± 0.04 | 0.005 | 843.2 |
| **Tổng (`total`)** | **Toàn bộ luồng 8 bước** | **1306.91** | **1325.12** | **1333.00** | **1308.41 ± 16.80** | **4.386** | **843.4** |

### Luận văn / Đồ án quy mô lớn (100+ trang) — `VN_UNI_PDF_BATCH2/088_ou_hcm_KLTN_IEEE_FULL_PAPER_VN.pdf` (156 trang, 101 trích dẫn trong bài, 87 tài liệu tham khảo, $N=5$ lần chạy)

| Bước (`step_key`) | Mô tả công đoạn | P50 ($P_{50}$, ms) | P90 ($P_{90}$, ms) | P99 ($P_{99}$, ms) | Mean ± Std (ms) | Peak Heap $\Delta$ (MB) | Process RSS (MB) |
| :--- | :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| `parsing` | 1. Document Parsing & Section Segmentation | 588.92 | 594.51 | 594.53 | 589.68 ± 4.65 | 11.093 | 1029.8 |
| `style_detection` | 2. Style Profile Detection & Diagnostics | 0.58 | 0.69 | 0.73 | 0.61 ± 0.07 | 0.006 | 1029.8 |
| `extracting` | 3. Citation & Bibliography Extraction | 668.47 | 678.65 | 681.67 | 671.24 ± 6.77 | 5.691 | 1029.8 |
| `linking` | 4. Bidirectional In-Text <-> Reference Linking | 249.16 | 252.04 | 252.96 | 249.60 ± 2.42 | 0.244 | 1029.8 |
| `retrieving` | 5. Multi-Source Tiered Scholarly Retrieval | 67.81 | 68.83 | 69.17 | 67.68 ± 1.14 | 0.145 | 1029.8 |
| `comparing` | 6. Lexical & Neural Semantic Evidence Alignment | 2313.80 | 2334.09 | 2336.45 | 2292.01 ± 53.10 | 1.161 | 1029.9 |
| `checking` | 7. Neuro-Symbolic Rules & Platt Calibration | 278.01 | 298.32 | 304.72 | 284.37 ± 12.86 | 0.205 | 1029.9 |
| `scoring` | 8. CIS Calculation & Report Generation | 1.21 | 1.38 | 1.48 | 1.26 ± 0.12 | 0.006 | 1029.9 |
| **Tổng (`total`)** | **Toàn bộ luồng 8 bước** | **4159.73** | **4215.29** | **4215.61** | **4156.45 ± 66.58** | **11.095** | **1030.8** |

---

## 2. Kiểm Thử Chịu Tải `DeadlineQueueManager` & SQLite Khi 20–50 Sinh Viên Nộp Bài Đồng Thời

| Số SV đồng thời ($N$) | Worker tối đa | Tỷ lệ hoàn thành | Peak Active / Queue | FIFO chuẩn | Queue Wait $P_{50}/P_{90}/P_{99}$ (ms) | Processing $P_{50}/P_{90}/P_{99}$ (ms) | Throughput (bài/s · trích dẫn/s) | Lỗi `SQLite locked` | Lỗi `HTTP 502/429` |
| :---: | :---: | :---: | :---: | :---: | ---: | ---: | ---: | :---: | :---: |
| **20** | 3 | **20/20 (100.0%)** | 3 / 17 | `PASS` | 315.5 / 520.7 / 566.8 | 79.8 / 134.9 / 161.8 | **30.07** bài/s (451.0 cit/s) | **0** | **0** (rescued 60/60 429s) |
| **50** | 3 | **50/50 (100.0%)** | 3 / 47 | `PASS` | 3361.1 / 4079.2 / 4197.7 | 76.7 / 288.4 / 2101.0 | **11.57** bài/s (173.5 cit/s) | **0** | **0** (rescued 150/150 429s) |

---

## 3. Đối Chiếu Thực Nghiệm Cold-Cache (Uncached PyMuPDF + Live WAN API) vs. Warm-Cache (GROBID Cache + Local SQLite FTS5)

- **Tài liệu đo:** `TDTU_PDF/098_uit_vnuhcm_Vietnamese_Hate_Speech_Detection_in_Gaming_Domain_Edited_Report.pdf` (12 trang, 24 tài liệu tham khảo)
- **Nguồn WAN API thực tế:** `crossref, openalex` (11 HTTP 200 responses / 24 truy vấn)

| Chế độ thực thi | `parsing` (ms) | `extracting` (ms) | `retrieving` (ms) | Tổng 8 bước (`total`, ms) | Hệ số tăng tốc Truy hồi (`retrieving`) | Hệ số tăng tốc Toàn cục (`End-to-End`) |
| :--- | ---: | ---: | ---: | ---: | :---: | :---: |
| **Cold-Cache (Uncached + Live WAN API)** | 76.18 | 243.06 | 8635.83 | **9407.61** | 1.00x (Baseline) | 1.00x (Baseline) |
| **Warm-Cache (GROBID TEI + Local FTS5)** | 95.98 | 87.08 | 12.54 | **484.76** | **688.72x nhanh hơn** | **19.41x nhanh hơn** |

---

## 4. Kiểm Thử Chịu Tải Tầng HTTP Multipart (`POST /api/essays` + `GET /api/essays/{id}/status`) Qua FastAPI Stack

| Số SV đồng thời ($N$) | HTTP 200 Upload | Background Hoàn tất | Bản ghi Verdict lưu DB | HTTP Upload $P_{50}/P_{90}/P_{99}$ (ms) | HTTP Status Poll $P_{50}/P_{90}/P_{99}$ (ms) | HTTP E2E $P_{50}/P_{90}/P_{99}$ (ms) | Throughput (HTTP uploads/s) | Lỗi `SQLite locked` / `HTTP 5xx,429` |
| :---: | :---: | :---: | :---: | ---: | ---: | ---: | ---: | :---: |
| **20** | **20/20** | **20/20** | 60 | 514.2 / 659.4 / 692.8 | 14.57 / 46.62 / 74.70 | 534.7 / 671.6 / 695.9 | **28.68** uploads/s | **0 / 0** |
| **50** | **50/50** | **50/50** | 150 | 1530.2 / 1948.0 / 2030.3 | 22.90 / 312.04 / 534.91 | 1629.7 / 1964.3 / 2035.3 | **24.49** uploads/s | **0 / 0** |
