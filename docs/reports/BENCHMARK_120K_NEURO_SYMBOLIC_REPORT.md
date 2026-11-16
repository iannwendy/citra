# Báo Cáo Thực Nghiệm & Kiểm Định Mô Hình Neuro-Symbolic Quy Mô Lớn (120,000 Bài Báo Khoa Học, OOD Guardrail Stress Test & Kiểm Định Thống Kê)

> **Hệ thống:** CITRA (`SourceLogic` — Essay Integrity Checker v3.81.0)
> **Quy mô Benchmark:** `120,000` bài báo khoa học độc lập (`Train: 84,000` · `Validation: 18,000` · `Held-Out Test: 18,000`) + `2,400` mẫu Out-of-Distribution (OOD) Hard-Guardrail Stress Test + `300 × 20` cấu hình Phân tích Độ nhạy Trọng số `CIS`
> **Phương pháp:** Strict Stratified Paper- & Normalized-Title-Disjoint Split (`70 / 15 / 15`, `0%` chồng lấp `paper_id` & tiêu đề chuẩn hóa) + Trích xuất đặc trưng thực tế không ép ngưỡng theo nhãn qua `Sentence-BERT (all-MiniLM-L6-v2)` & `RapidFuzz` trên cả **4 nhãn** (`VERIFIED`, `METADATA_ERROR`, `SUSPECTED_HALLUCINATION`, `UNRESOLVED`)
> **Artifacts xuất bản:**
> - Script huấn luyện & kiểm định: [`scripts/train_neuro_symbolic_model.py`](../../scripts/train_neuro_symbolic_model.py)
> - Trọng số `HybridMLScorer` & `PlattCalibrator`: [`data/models/neuro_symbolic_weights.json`](../../data/models/neuro_symbolic_weights.json)
> - Báo cáo JSON đầy đủ (RFC 8259 strict): [`data/models/neuro_symbolic_benchmark_report.json`](../../data/models/neuro_symbolic_benchmark_report.json)
> - Tóm tắt phân bố dữ liệu & mẫu thử: [`data/models/neuro_symbolic_dataset_summary.json`](../../data/models/neuro_symbolic_dataset_summary.json)

---

## 1. Quy Trình Phương Pháp Luận & Đối Chiếu Chuẩn Quốc Tế

Toàn bộ quy trình xây dựng tập dữ liệu, loại bỏ thiên lệch lối tắt đặc trưng (*shortcut bias*), huấn luyện mô hình kết hợp (`HybridMLScorer`), hiệu chỉnh xác suất hậu nghiệm (`PlattCalibrator`), kiểm định ý nghĩa thống kê bắt cặp và kiểm tra sức chịu đựng ngoài phân phối (*Out-of-Distribution Stress Testing*) được thiết kế bám sát các công trình chuẩn mực quốc tế:

| Khía cạnh Phương pháp luận | Quy trình Áp dụng trong Hệ thống CITRA (`120,000` mẫu + `2,400` OOD) | Công trình Quốc tế Chuẩn mực Tham chiếu |
| :--- | :--- | :--- |
| **1. Phân tách Độc lập theo Bài báo & Tiêu đề (*Strict Stratified Paper- & Title-Disjoint Split*)** | Từ `129,125` bản ghi trong [`data/local_papers.db`](../../data/local_papers.db) (`128,105` bài báo hợp lệ duy nhất theo khóa tiêu đề chuẩn hóa; `98.43%` thuộc ACL Anthology), hệ thống lấy mẫu phân tầng **`120,000` bài báo thực tế độc lập** (`80,000` bài có đầy đủ abstract `>80` ký tự + `40,000` bài có đầy đủ metadata thư mục) và chia tách **trước** khi sinh bất kỳ biến nhiễu hay ghép chéo nào:<br>• **Train (`70%`)**: `84,000` bài báo (`56,000` full-abstract + `28,000` metadata)<br>• **Validation (`15%`)**: `18,000` bài báo (`12,000` full-abstract + `6,000` metadata)<br>• **Held-Out Test (`15%`)**: `18,000` bài báo (`12,000` full-abstract + `6,000` metadata)<br>• Mọi phép biến đổi chéo bài báo chỉ ghép các bài báo **nằm trong cùng một tập split** (`0 / 0 / 0` chồng lấp `paper_id` & tiêu đề chuẩn hóa). | **SciFact** (*Wadden et al., EMNLP 2020*) & **FEVER** (*Thorne et al., NAACL 2018*) |
| **2. Triệt tiêu Lối tắt Đặc trưng Một chiều (*4-Class Authentic Context Alignment*)** | Phân bổ tỷ lệ bài báo có full abstract (`66.7%`) đồng đều vào **cả 4 phân lớp** trong từng split để tính điểm đối sánh ngữ nghĩa `content_alignment_score` thực tế bằng chính abstract gốc của bài báo đó trên cả 4 nhãn:<br>• `VERIFIED`: `50.0%` có ngữ cảnh trích dẫn (`median = 0.6053`)<br>• `METADATA_ERROR`: `44.5%` có ngữ cảnh trích dẫn (`median = 0.3751`, bao gồm cả ngữ cảnh khớp trên trích dẫn sai năm/tác giả/DOI và phân nhóm gán sai nội dung `R-CONTENT-MISMATCH`)<br>• `SUSPECTED_HALLUCINATION`: `40.0%` số ca có ứng viên ở `H2/H4` (`8.5%` toàn nhãn, `median = 0.1961`)<br>• `UNRESOLVED`: `35.0%` của `U1` (`22.6%` toàn nhãn, `median = 0.3179`)<br>$\Rightarrow P(\text{VERIFIED} \mid \text{content\_alignment} > 0) = 54.47\%$, triệt tiêu hoàn toàn lối tắt `content_alignment > 0 => VERIFIED`. | **Poliak et al.** (*NAACL 2018*) & **Gururangan et al.** (*NAACL 2018 — Annotation Artifacts in NLI*) |
| **3. Mô phỏng Ảo giác LLM Cùng Chuyên ngành Thực tế (*Plausible Same-Domain Hallucinations*)** | Loại bỏ hoàn toàn các chuỗi giả lập viễn tưởng dễ đoán và chặn biên năm xuất bản thực tế (`1950 <= cited_year <= 2026`). Các nhóm `H1–H4` (`36,000` mẫu) ghép sạch cụm mở đầu học thuật (`3–4` từ đầu của `p1["title"]`) với cụm phương pháp luận (`3–5` từ cuối của `p3["title"]`), gán tên các học giả có thật (`[p3["authors"][0], p4["authors"][-1]]` không trùng ứng viên `p2`) và tên hội nghị/tạp chí học thuật thật (`ACL`, `EMNLP`, `COLING`, `TACL`, `LREC`, `NAACL`) hoàn toàn bên trong cùng một split. | **Walters & Wilder** (*Scientific Reports, 2023*) & **ALCE** (*Gao et al., EMNLP 2023*) |
| **4. Đồng nhất `BaselineRunner("proposed")` với `SymbolicRules` & Trích xuất Không Cắt Ngưỡng** | Không dùng `np.clip` theo nhãn đích. Mã hóa **`330,705` câu/tiêu đề duy nhất** (từ `480,000` chuỗi thành phần) bằng `Sentence-BERT (all-MiniLM-L6-v2)` trên GPU (`mps`). Đồng thời `BaselineRunner("proposed")` gọi trực tiếp bộ luật sản xuất `SymbolicRules`, đảm bảo kết quả `Proposed` ở Bảng 5.1 và `SymbolicRules` ở Bảng 5.2 **khớp tuyệt đối 100%** (`96.67%` Accuracy, `0.9548` Macro-F1). | **Sentence-BERT** (*Reimers & Gurevych, EMNLP 2019*) |
| **5. Tối ưu Siêu tham số & Hiệu chỉnh Xác suất Hậu nghiệm (*Post-Hoc Platt Calibration*)** | • Trọng số `HybridMLScorer` học hoàn toàn trên **Train (`84,000` mẫu)**.<br>• Siêu tham số L2 $C^* = 10.0$ (`Val Macro-F1 = 0.9951`) và tham số **Logit-Space Platt Scaling** ($a = 1.971871, b = 0.848874$) khớp độc lập trên **Validation (`18,000` mẫu)**. | **Platt Scaling** (*Platt, 1999*) & **Modern Neural Calibration** (*Guo et al., ICML 2017*) |
| **6. Kiểm định Thống kê Bắt cặp, OOD Stress Test (`N = 2,400`) & Độ nhạy Trọng số `CIS`** | Thực hiện **kiểm định McNemar hiệu chỉnh liên tục**, **Paired Bootstrap $B = 1,000$ lần** với hiệu chỉnh mẫu hữu hạn Davison–Hinkley, kiểm định **Wilcoxon Signed-Rank** trên độ giảm Brier Score, bộ thử nghiệm **OOD Hard-Guardrail (`N = 2,400`)** chứng minh ưu thế vượt trội của Neuro-Symbolic trước Pure ML `B5` (`98.08%` so với `44.92%`), và phân tích độ nhạy `CIS` (`300` bản thảo $\times$ `20` vector trọng số). | **Dror et al.** (*ACL 2018*), **Berg-Kirkpatrick et al.** (*EMNLP 2012*) & **Dietterich** (*1998*) |

---

## 2. Nguồn Gốc Tập Dữ Liệu (`Corpus Provenance`), Kiểm Định Chống Rò Rỉ & Kiểm Định Chống Lối Tắt Đặc Trưng

### 2.1. Thống kê Kho Tri thức Học thuật Nội bộ (`data/local_papers.db`)

| Chỉ số Thống kê Nguồn Dữ liệu | Số lượng Bài báo | Tỷ lệ / Ghi chú Minh bạch |
| :--- | :---: | :--- |
| Tổng số bản ghi trong `data/local_papers.db` (`total_papers_in_db`) | `129,125` | `127,102` bài từ **ACL Anthology (`98.43%`)** + `2,023` bài (`1.57%`) từ Crossref, OpenAlex, OpenLibrary, DataCite, v.v. |
| Tổng số bài báo hợp lệ duy nhất theo khóa tiêu đề (`total_valid_scholarly_papers`) | `128,105` | `99.21%` tổng kho dữ liệu sau khử trùng lặp tiêu đề chuẩn hóa |
| Số bài báo có đầy đủ `abstract` dài (`> 80` ký tự, `eligible_with_full_abstract`) | `82,877` | Đủ điều kiện đối sánh ngữ nghĩa cấp độ câu |
| Số bài báo có đầy đủ metadata thư mục (`eligible_metadata_only`) | `45,228` | Các bài hội nghị/tạp chí lưu trữ metadata đầy đủ |
| **Tổng số bài báo lấy mẫu cho Benchmark (`sampled_total`)** | **`120,000`** | **`80,000` bài full-abstract + `40,000` bài metadata-complete** |

### 2.2. Kiểm định Phân tách Độc lập (`Strict Paper- & Title-Disjoint Split`)

| Tập Dữ liệu (`Split`) | Tỷ lệ | Tổng số Bài báo Độc lập | Bài báo Full Abstract (`66.7%`) | Bài báo Metadata-Complete (`33.3%`) | Số câu/tiêu đề duy nhất mã hóa SBERT | Kiểm định Giao tập (`paper_id` & `norm_title`) |
| :--- | :---: | :---: | :---: | :---: | :---: | :--- |
| **Train Split** | `70.0%` | **`84,000`** | `56,000` | `28,000` | `231,374` | `\|Train ∩ Val\| = 0` (`ID` & `Title`) |
| **Validation Split** | `15.0%` | **`18,000`** | `12,000` | `6,000` | `49,669` | `\|Train ∩ Test\| = 0` (`ID` & `Title`) |
| **Held-Out Test Split** | `15.0%` | **`18,000`** | `12,000` | `6,000` | `49,662` | `\|Val ∩ Test\| = 0` (`ID` & `Title`) |
| **Tổng cộng** | **`100.0%`** | **`120,000`** | **`80,000`** | **`40,000`** | **`330,705`** | **`zero_leakage_verified = True`** |

### 2.3. Kiểm định Phân bố `content_alignment_score` trên Cả 4 Nhãn (`Feature Shortcut Audit`, Test $N = 18,000$)

| Nhãn Thực tế (`Gold Label`) | Tổng số Mẫu ($N$) | Số mẫu `score > 0` | Tỷ lệ `score > 0` | Số mẫu `is_aligned = True` (`≥ 0.50`) | Trung bình (`score > 0`) | Phân vị `[P10, P50, P90]` |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **`VERIFIED`** | `6,480` | `3,239` | **`49.98%`** | `2,089` (`32.24%`) | `0.6549` | `[0.2969, 0.6053, 1.0000]` |
| **`METADATA_ERROR`** | `3,960` | `1,761` | **`44.47%`** | `518` (`13.08%`) | `0.3839` | `[0.1383, 0.3751, 0.6355]` |
| **`SUSPECTED_HALLUCINATION`** | `5,400` | `459` | **`8.50%`** *(40% H2/H4 có ứng viên)* | `3` (`0.06%`) | `0.2020` | `[0.0588, 0.1961, 0.3415]` |
| **`UNRESOLVED`** | `2,160` | `487` | **`22.55%`** *(35% U1)* | `133` (`6.16%`) | `0.3532` | `[0.1165, 0.3179, 0.6327]` |

> **Nhận xét Kiểm định:** Xác suất hậu nghiệm $P(\text{VERIFIED} \mid \text{content\_alignment\_score} > 0) = 0.5447$ (`54.47%`), và có tới `654` mẫu không thuộc `VERIFIED` (`518` `METADATA_ERROR` + `133` `UNRESOLVED` + `3` `SUSPECTED_HALLUCINATION`) vẫn đạt ngưỡng `content_is_aligned = True` ($\ge 0.50$). Điều này chứng minh mô hình bắt buộc phải kết hợp đa đặc trưng và kiểm tra ràng buộc thư mục chứ không thể dựa vào bất kỳ đặc trưng đơn lẻ nào.

---

## 3. Phân Bố 4 Nhãn Chính & 15 Phân Nhóm Lỗi (`15 Sub-Taxonomies`)

| Nhãn Chính (`Canonical Class`) | Mã Phân nhóm | Mô tả Kịch bản Trích dẫn Thực tế & Lỗi Học thuật | Train (`70%`) | Val (`15%`) | Test (`15%`) | **Tổng (`100%`)** |
| :--- | :---: | :--- | :---: | :---: | :---: | :---: |
| **`VERIFIED`**<br>*(36.0% — 43,200 mẫu)* | **`V1`** | Trích dẫn chuẩn xác hoàn toàn (`title`, `authors`, `year`, `venue`, `DOI`) | `7,560` | `1,620` | `1,620` | **`10,800`** |
| | **`V2`** | Rút gọn danh sách tác giả (`First Author et al.`, viết tắt tên) & lệch $\pm 1$ năm Online-First vs. Print | `7,560` | `1,620` | `1,620` | **`10,800`** |
| | **`V3`** | Lược bỏ phụ đề sau dấu `:` (*subtitle truncation*) hoặc biến thể dấu câu nhỏ | `7,560` | `1,620` | `1,620` | **`10,800`** |
| | **`V4`** | Nhiễu OCR ký tự / gạch nối PDF + cứu hộ ngữ nghĩa bằng `R-CONTENT-ALIGNMENT` | `7,560` | `1,620` | `1,620` | **`10,800`** |
| **`SUSPECTED_HALLUCINATION`**<br>*(30.0% — 36,000 mẫu)* | **`H1`** | Ảo giác LLM cùng chuyên ngành (ghép tiêu đề học thuật + tên học giả & hội nghị thật) $\rightarrow$ `0` ứng viên (`R-NO-SCHOLARLY-RECORD`) | `6,300` | `1,350` | `1,350` | **`9,000`** |
| | **`H2`** | Trích dẫn *Spliced* cùng miền NLP/CS có ứng viên nhiễu yếu + đối sánh chéo abstract (`R-HALLUCINATED-SOURCE`) | `6,300` | `1,350` | `1,350` | **`9,000`** |
| | **`H3`** | DOI có tiền tố nhà xuất bản thật (`10.18653/v1/*`, `10.1109/*`, `10.1145/*`, `10.1007/*`) nhưng mã bài không tồn tại (`R-NONEXISTENT-DOI`) | `6,300` | `1,350` | `1,350` | **`9,000`** |
| | **`H4`** | Nguồn ảo giác đi kèm liên kết chết (`HTTP 404` `R-DEAD-URL`) hoặc tên miền giữ chỗ RFC 2606 (`R-FAKE-URL`) | `6,300` | `1,350` | `1,350` | **`9,000`** |
| **`METADATA_ERROR`**<br>*(22.0% — 26,400 mẫu)* | **`M1`** | Sai năm xuất bản ($|\Delta\text{year}| \in \{2, 3, 4, 5, 6, 8\}$ năm) trên bài báo thật (bao gồm cả ngữ cảnh khớp cao) | `3,696` | `792` | `792` | **`5,280`** |
| | **`M2`** | Nhầm lẫn / thay thế đồng tác giả bằng tên học giả khác cùng lĩnh vực với tiêu đề khớp cao | `3,696` | `792` | `792` | **`5,280`** |
| | **`M3`** | DOI hợp lệ nhưng tiêu đề trích dẫn bị biến dạng mức trung bình (`R-DOI-TITLE-MISMATCH`) | `3,696` | `792` | `792` | **`5,280`** |
| | **`M4`** | Biến đổi tiêu đề mức trung bình không có DOI (`R-SINGLE-SOURCE-PARTIAL`) & trích dẫn đúng nguồn nhưng gán sai luận điểm (`R-CONTENT-MISMATCH`) | `3,696` | `792` | `792` | **`5,280`** |
| | **`M5`** | Sai lệch tổ hợp đa trường (`author + year + title`) hoặc ngoại lệ `R-DOMAIN-EXCEPTION` | `3,696` | `792` | `792` | **`5,280`** |
| **`UNRESOLVED`**<br>*(12.0% — 14,400 mẫu)* | **`U1`** | Bản thảo đổi tên từ preprint / dịch tiêu đề vùng biên có trùng tác giả chính (`author_jaccard >= 0.20`, `35%` có ngữ cảnh, `R-ABSTENTION-BORDER`) | `6,720` | `1,440` | `1,440` | **`9,600`** |
| | **`U2`** | DOI khu vực chưa có CSL (`10.11499/*`, `10.5109/*` — `R-DOI-RA-NO-CSL`) & nghẽn tần suất API HTTP 429 (`R-RATE-LIMITED-ABSTAIN`) | `3,360` | `720` | `720` | **`4,800`** |
| **Tổng cộng** | **15 Nhóm** | **Đầy đủ phổ kịch bản xác thực trích dẫn khoa học** | **`84,000`** | **`18,000`** | **`18,000`** | **`120,000`** |

---

## 4. Không Gian Đặc Trưng 16 Chiều & Tối Ưu Siêu Tham Số (`Hyperparameter Tuning`)

### 4.1. Kết quả Grid Search Hệ số Điều chuẩn L2 ($C$) trên Tập Validation ($N = 18,000$)

| Giá trị $C$ ứng viên | `0.1` | `0.25` | `0.5` | `1.0` | `2.0` | `5.0` | **`10.0` *(Được chọn)*** |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Validation Macro-F1** | `0.9894` | `0.9923` | `0.9929` | `0.9933` | `0.9939` | `0.9950` | **`0.9951`** |

- **Tham số kết hợp Symbolic – ML (`symbolic_blend_alpha`):** $\alpha = 0.72$ ($S_{\text{blend}} = 0.72 \cdot C_{\text{symbolic}} + 0.28 \cdot P_{\text{ML}}(y_{\text{sym}} \mid \mathbf{x})$).
- **Tham số Platt Scaling khớp độc lập trên tập Validation ($N = 18,000$):** $a = 1.971871$ (`1.9719`), $b = 0.848874$ (`0.8489`).

---

## 5. Kết Quả Thực Nghiệm Trên Tập Held-Out Test Trong Phân Phối ($N = 18,000$ Bài Báo Độc Lập)

### 5.1. Nghiên cứu Cắt bỏ & Đối sánh Baseline (`Ablation Study` — Đồng nhất 100% với Bộ Luật Sản xuất)

| Phương pháp / Baseline | Mô tả Cơ chế Quyết định | Accuracy | Macro-Precision | Macro-Recall | **Macro-F1** |
| :--- | :--- | :---: | :---: | :---: | :---: |
| **`B0` (`doi_only`)** | Chỉ xác thực khi có DOI khớp chính xác | `26.34%` | `0.2336` | `0.3496` | `0.1963` |
| **`B1` (`single_source_crossref`)** | Chỉ tra cứu đơn nguồn trên `Crossref` | `58.18%` | `0.5628` | `0.4802` | `0.4522` |
| **`B3` (`embedding_only`)** | Thuần ngữ nghĩa `Sentence-BERT` cosine similarity trên tiêu đề | `67.29%` | `0.4972` | `0.5278` | `0.4701` |
| **`B4` (`no_calibration`)** | Tổ hợp tuyến tính đa đặc trưng, tắt vùng abstention (`UNRESOLVED`) | `79.76%` | `0.6191` | `0.6565` | `0.6228` |
| **`B2` (`fuzzy_only`)** | Chỉ dùng so khớp từ vựng `RapidFuzz` tiêu đề + `AuthorJaccard` | `81.22%` | `0.6290` | `0.6731` | `0.6392` |
| **`Proposed` (`Neuro-Symbolic`)** | **Bộ luật `SymbolicRules` sản xuất + Đối sánh Ngữ nghĩa Abstract + Link Check + `PlattCalibrator` + Abstention** | **`96.67%`** | **`0.9527`** | **`0.9622`** | **`0.9548`** |
| **`B5` (`ml_hybrid`)** *(In-Distribution)* | `HybridMLScorer` (Multinomial Logistic Regression 16D, $C = 10.0$ — *xem mục 6 cho kiểm thử OOD*) | **`99.48%`** | **`0.9945`** | **`0.9949`** | **`0.9947`** |

### 5.2. Hiệu năng Chi tiết Từng Nhãn của Hệ thống Đề xuất (`Proposed Neuro-Symbolic`)

| Nhãn Phán quyết (`ValidationLabel`) | Số mẫu Test ($N$) | Precision | Recall | **F1-Score** | Ý nghĩa Thực tiễn & Bất biến An toàn Học thuật |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **`VERIFIED`** | `6,480` | **`0.9771`** | **`0.9991`** | **`0.9879`** | **`0 / 6,480` bài báo hợp lệ bị kết luận oan là `SUSPECTED_HALLUCINATION`**; **`0 / 5,400` bài ảo giác lọt lưới thành `VERIFIED`** (`6,474 / 6,480` đúng tuyệt đối, `5` ca chuyển sang `METADATA_ERROR`, `1` ca chuyển sang `UNRESOLVED`). |
| **`SUSPECTED_HALLUCINATION`** | `5,400` | **`0.9926`** | **`0.9931`** | **`0.9929`** | Phát hiện **`5,363 / 5,400` (`99.31%` Recall, `99.26%` Precision)** trích dẫn ảo giác ghép chéo chuyên ngành với tên học giả thật; `37` ca mang họ học giả kinh điển trùng danh sách bảo hộ được chuyển thận trọng sang `UNRESOLVED` thay vì bỏ lọt thành `VERIFIED`. |
| **`METADATA_ERROR`** | `3,960` | **`0.9953`** | **`0.8631`** | **`0.9245`** | Đạt **99.53% Precision** trên các lỗi sai năm (`M1`), sai tác giả (`M2`), lệch tiêu đề (`M3`, `M4`) và gán sai ngữ cảnh (`R-CONTENT-MISMATCH`). `353` ca vùng biên đa trường chuyển thận trọng sang `UNRESOLVED`. |
| **`UNRESOLVED` *(Abstention)*** | `2,160` | **`0.8459`** | **`0.9935`** | **`0.9138`** | Khoanh vùng chính xác **`2,146 / 2,160` (`99.35%` Recall)** ca vùng xám (`U1` `R-ABSTENTION-BORDER`, `U2` DOI khu vực `R-DOI-RA-NO-CSL` & nghẽn API `R-RATE-LIMITED-ABSTAIN`). |
| **Trung bình Vĩ mô / Tổng (`Macro / Total`)** | **`18,000`** | **`0.9527`** | **`0.9622`** | **`0.9548`** | **Overall Accuracy: `96.67%`** (`17,401 / 18,000` mẫu khớp nhãn gốc hoàn toàn, đồng nhất tuyệt đối giữa Bảng 5.1 và Bảng 5.2). |

### 5.3. Ma trận Nhầm lẫn (`4×4 Confusion Matrix` trên $N = 18,000$ Mẫu Test)

| Nhãn Thực tế (`Gold`) \ Dự đoán (`Pred`) | Dự đoán: `VERIFIED` | Dự đoán: `METADATA_ERROR` | Dự đoán: `SUSPECTED_HALLUCINATION` | Dự đoán: `UNRESOLVED` | **Tổng Thực tế (`Support`)** |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Thực tế: `VERIFIED`** | **`6,474`** | `5` | `0` | `1` | `6,480` |
| **Thực tế: `METADATA_ERROR`** | `152` | **`3,418`** | `37` | `353` | `3,960` |
| **Thực tế: `SUSPECTED_HALLUCINATION`** | `0` | `0` | **`5,363`** | `37` | `5,400` |
| **Thực tế: `UNRESOLVED`** | `0` | `11` | `3` | **`2,146`** | `2,160` |

### 5.4. Hiệu quả Hiệu chỉnh Xác suất (`Logit-Space Platt Scaling`) & Khoảng Tin cậy 95% Bootstrap ($B = 1,000$)

| Cấu hình Độ tin cậy | Macro-F1 | **ECE** *(95% CI)* | **Brier Score** *(95% CI)* | Acc @ `50%` Cov | Acc @ `70%` Cov | Acc @ `90%` Cov | Acc @ `95%` Cov | Acc @ `100%` Cov *(95% CI)* |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Chưa hiệu chỉnh (`Uncalibrated Raw`)** | `0.9548` | `0.2281` | `0.0964` | `98.30%` | `98.44%` | `98.47%` | `98.28%` | `96.67%` |
| **Đã hiệu chỉnh (`Platt-Calibrated`)** | **`0.9548`**<br>`[0.9510, 0.9582]` | **`0.0436`** *(↓ **5.23×** / `-80.9%`)*<br>`[0.0416, 0.0455]` | **`0.0183`** *(↓ **5.27×** / `-81.0%`)*<br>`[0.0169, 0.0198]` | **`99.14%`** | **`98.86%`** | **`99.05%`** | **`98.81%`** | **`96.67%`**<br>`[0.9641, 0.9693]` |

---

## 6. Kiểm Thử Sức Chịu Đựng Ngoài Phân Phối (`OOD Hard-Guardrail Stress Suite`, $N = 2,400$) — Tại Sao Kiến Trúc Neuro-Symbolic Vượt Trội Hơn Học Máy Thuần Túy (`Pure ML B5`)?

Trên tập Test trong phân phối ($N = 18,000$), bộ phân loại hồi quy logistic 16 chiều `B5` đạt `99.48%` vì phân phối Test khớp hoàn toàn với phân phối biên nhiễu lúc huấn luyện. Tuy nhiên, trong kiểm toán học thuật thực tế, hệ thống thường xuyên đối mặt với **các vi phạm ràng buộc biểu tượng bậc nhất (*First-Order Symbolic Constraints*)** mà vector tương đồng liên tục 16 chiều không thể biểu diễn.

Để chứng minh thực nghiệm luận điểm cốt lõi của khóa luận (không ghi đè thủ công bất kỳ trường nào trái với `raw_citation`), chúng tôi xây dựng bộ kiểm thử **Out-of-Distribution (OOD) Hard-Guardrail Stress Suite gồm `2,400` mẫu (`6` nhóm $\times$ `400` mẫu, trích xuất 100% từ `test_papers`, `0` chồng lấp Train/Val)**:

| Nhóm Kiểm thử Ràng buộc Thực tế (`OOD Category`, $N = 400$/nhóm) | Nhãn Gốc (`Gold`) | Luật Bảo vệ Biểu tượng | `B4` (`No Calib.`) | **Pure ML `B5` (`HybridMLScorer`)** | **`Proposed Neuro-Symbolic`** | **Chênh lệch ($\Delta = \text{NS} - \text{B5}$)** | Phân tích Nguyên nhân Sụp đổ của Pure ML `B5` |
| :--- | :---: | :--- | :---: | :---: | :---: | :---: | :--- |
| **1. Bài báo đã bị rút bài chính thức (`retracted_papers`)** | `metadata_error` | `R-RETRACTED-PAPER` | `0.00%` | **`0.00%`** *(400/400 gán `verified`)* | **`100.00%`** | **`+100.00%`** | Bài rút lại vẫn khớp tuyệt đối DOI, tiêu đề, tác giả, năm (`tf=1.0, aj=1.0, doi=1.0`) $\rightarrow$ `B5` xác nhận nhầm 100% công trình đã bị rút bài. |
| **2. Ghép chéo DOI thật vào bài bịa đặt cùng thời kỳ (`chimeric_spliced_dois`)** | `suspected_hallucination` | `R-CHIMERIC-DOI-MISMATCH` | `0.00%` | **`44.50%`** *(205 `unresolved`, 17 `meta`)* | **`88.50%`** | **`+44.00%`** | Khi sinh viên dán DOI thật của bài cùng năm (`yd ∈ {0,1,2}`) vào tiêu đề bịa đặt, `B5` bị đánh lừa bởi `doi_exact=1` và `year_match≈1`. |
| **3. Tên miền giả mạo / RFC 2606 trên tiêu đề gần đúng (`fake_placeholder_urls`)** | `suspected_hallucination` | `R-FAKE-URL` | `0.00%` | **`0.00%`** *(200 `verified`, 197 `meta`)* | **`100.00%`** | **`+100.00%`** | Vector liên tục của `B5` không kiểm tra cấu trúc DNS/RFC 2606 (`example.com`, `.invalid`, `fake-*`) nên bị tiêu đề khớp một phần đánh lừa. |
| **4. DOI khu vực hợp lệ chưa có CSL (`regional_dois_no_csl`)** | `unresolved` | `R-DOI-RA-NO-CSL` | `0.00%` | `100.00%`* | **`100.00%`** | `0.00%` | *`B5` chỉ sống sót nhờ đặc trưng chỉ báo biểu tượng `abstention_zone_indicator` (`vec[15]`) do tầng Symbolic cấp sẵn; `B4` sụp đổ về `0.00%`. |
| **5. Nghẽn tần suất HTTP 429 toàn cục (`http_429_rate_limit_abstention`)** | `unresolved` | `R-RATE-LIMITED-ABSTAIN` | `0.00%` | `100.00%`* | **`100.00%`** | `0.00%` | *Tương tự mục 4, nhờ cờ biểu tượng `api_exhausted` được truyền vào `vec[15]` để tránh kết luận oan khi API quá tải. |
| **6. Sai thẩm quyền & số hiệu văn bản luật Việt Nam (`vn_statutory_authority_mismatch`)** | `metadata_error` | `VNLegalVerifier` (`R-VN-LEGAL-MISMATCH`) | `20.00%` | **`25.00%`** *(200 `hal`, 100 `meta`, 100 `ver`)* | **`100.00%`** | **`+75.00%`** | Phân tích trực tiếp qua `parse_vn_legal_reference` (0 ghi đè): `B5` bắt được 100 ca sai cơ quan có ứng viên nhưng gán nhầm 200 ca không ứng viên thành `hallucination` và 100 ca sai số hiệu (`99/2015/QH13`, `59/2020/QH14` trên `Luật Đầu tư`) thành `verified`. |
| **Tổng hợp Toàn bộ OOD Suite ($N = 2,400$)** | **3 Nhãn OOD** | **Symbolic Guardrails + VNLegal** | `3.33%`<br>*(F1 `0.0584`)* | **`44.92%`**<br>*(Active F1 `0.4556`)* | **`98.08%`**<br>*(Active F1 `0.9808`)* | **`+53.17%`**<br>*(+0.5252 F1)* | **Kiểm định McNemar: $\chi^2 = 1,225.9615$, $n_{10} = 1,301$, $n_{01} = 25$, $p = 1.39 \times 10^{-268}$ ($\log_{10} p = -267.86$).** |

---

## 7. Kiểm Định Ý Nghĩa Thống Kê Bắt Cặp (`Paired Statistical Significance`, Dror et al., ACL 2018) & Phân Tích Độ Nhạy Trọng Số `CIS`

### 7.1. Kiểm định McNemar Hiệu chỉnh Liên tục & Paired Bootstrap ($B = 1,000$, $N = 18,000$)

| Cặp Đối sánh trên Tập Held-Out Test ($N = 18,000$) | $\Delta\text{Accuracy}$ *(95% CI)* | $\Delta\text{Macro-F1}$ *(95% CI)* | Cặp Bất đồng McNemar ($n_{10} \text{ / } n_{01}$) | Thống kê McNemar $\chi^2$ | McNemar $p$-value ($\log_{10} p$) | Paired Bootstrap $p$-value ($B=1,000$) | Kết luận ($\alpha = 0.001$) |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **`Proposed` vs. `B0` (`doi_only`)** | **`+70.33%`** `[+69.68%, +70.97%]` | **`+0.7585`** `[+0.7534, +0.7632]` | `12,674 / 15` | `12,627.0757` | `< 1e-16` (`-2744.08`) | **`< 0.001`** (`0.000999`) | **Có ý nghĩa thống kê ($p \ll 0.001$)** |
| **`Proposed` vs. `B1` (`crossref`)** | **`+38.49%`** `[+37.76%, +39.24%]` | **`+0.5026`** `[+0.4955, +0.5093]` | `7,095 / 166` | `6,610.2719` | `< 1e-16` (`-1437.41`) | **`< 0.001`** (`0.000999`) | **Có ý nghĩa thống kê ($p \ll 0.001$)** |
| **`Proposed` vs. `B3` (`embedding`)** | **`+29.38%`** `[+28.64%, +30.04%]` | **`+0.4846`** `[+0.4776, +0.4913]` | `5,473 / 185` | `4,940.3268` | `< 1e-16` (`-1074.72`) | **`< 0.001`** (`0.000999`) | **Có ý nghĩa thống kê ($p \ll 0.001$)** |
| **`Proposed` vs. `B4` (`no_calib`)** | **`+16.91%`** `[+16.32%, +17.53%]` | **`+0.3320`** `[+0.3267, +0.3374]` | `3,321 / 277` | `2,573.6101` | `< 1e-16` (`-560.66`) | **`< 0.001`** (`0.000999`) | **Có ý nghĩa thống kê ($p \ll 0.001$)** |
| **`Proposed` vs. `B2` (`fuzzy_only`)** | **`+15.45%`** `[+14.86%, +16.04%]` | **`+0.3156`** `[+0.3103, +0.3206]` | `3,038 / 257` | `2,345.4932` | `< 1e-16` (`-511.10`) | **`< 0.001`** (`0.000999`) | **Có ý nghĩa thống kê ($p \ll 0.001$)** |
| **`Proposed` vs. `B5` *(In-Dist.)*** | `-2.81%` `[-3.07%, -2.56%]` | `-0.0400` `[-0.0438, -0.0364]` | `40 / 546` | `435.1962` | `1.20e-96` (`-95.92`) | `1.0000` *(one-sided)* | Đánh đổi có chủ đích lấy **`+53.17%` OOD** ($p = 1.39 \times 10^{-268}$) |
| **`Platt-Calibrated` vs. `Uncalibrated`** | $\Delta\text{ECE} = \mathbf{-0.1845}$<br>`[-0.1869, -0.1819]` | $\Delta\text{Brier} = \mathbf{-0.0780}$<br>`[-0.0795, -0.0766]` | Wilcoxon $W = 2,781,065.0$ | — | Wilcoxon `< 1e-16` | **ECE `< 0.001` · Brier `< 0.001`** | **Giảm sai số xác suất có ý nghĩa thống kê tuyệt đối** |

### 7.2. Phân tích Độ nhạy Trọng số Điểm Toàn vẹn Trích dẫn (`CIS Rubric Weight Sensitivity Analysis`)

Trọng số chuẩn hóa mặc định trong `CISCalculator` (`configs/config.yaml`):
$$\mathbf{w}_0 = (\text{verified\_ratio}=0.35,\ \text{metadata\_accuracy}=0.25,\ \text{in\_text\_bib\_consistency}=0.25,\ \text{format\_consistency}=0.10,\ \text{identifier\_validity}=0.05)$$

Để chứng minh bảng xếp hạng chất lượng bản thảo **không nhạy cảm quá mức với việc chọn trọng số chủ quan**, chúng tôi biến thiên hệ thống $\pm 0.05$ và $\pm 0.10$ trên đơn hình xác suất ($\sum w_i = 1.0$) qua **`20` vector trọng số nhiễu** trên **`300` hồ sơ bản thảo đa dạng** (`8–42` tài liệu tham khảo/bản thảo, phủ đủ các mức chất lượng từ xuất sắc đến nghiêm trọng):

| Chỉ số Ổn định Xếp hạng & Điểm số (`300 Bản thảo × 20 Vector Trọng số = 6,000 phép đo`) | Giá trị Trung bình (`Mean`) | Giá trị Tối thiểu (`Min`) | Giá trị Tối đa (`Max`) | Ý nghĩa Kiểm định Độ vững (`Robustness`) |
| :--- | :---: | :---: | :---: | :--- |
| **Hệ số tương quan hạng Spearman ($\rho$)** | **`0.9987`** | **`0.9964`** | **`0.9997`** | Bảo toàn gần như tuyệt đối thứ tự xếp hạng chất lượng học thuật ($\rho > 0.996$ ở mọi cấu hình). |
| **Hệ số tương quan hạng Kendall ($\tau$)** | **`0.9765`** | **`0.9596`** | **`0.9902`** | Xác suất đồng thuận cặp xếp hạng giữa hai bản thảo bất kỳ đạt trên **`97.9%`**. |
| **Sai số tuyệt đối trung bình (`MAE`, thang `0–100`)** | **`1.7485` điểm** | `0.7434` điểm | `3.6156` điểm | Độ dịch chuyển điểm trung bình chưa tới `1.75 / 100` điểm khi thay đổi trọng số $\pm 5\%$ đến $\pm 10\%$. |
| **Độ lệch cực đại đơn lẻ (`Worst-Case Single Shift`)** | — | `2.91` điểm | `8.32` điểm | Ngay cả ở kịch bản nhiễu mạnh nhất $\pm 10\%$ (`P11`), không bản thảo nào đổi quá 1 bậc phân loại. |

---

## 8. Đánh Giá Thực Nghiệm Đầu-Cuối Đa Lĩnh Vực Trên Chuỗi Tham Khảo Thô (`End-to-End Raw-Reference Gold Benchmark`, $N = 120$ & Adversarial $N = 15$)

Để bổ trợ cho benchmark cấp đặc trưng `120,000` mẫu (vốn đánh giá riêng tầng đối sánh & suy diễn trên đầu vào đã phân tách trường), chúng tôi xây dựng bộ kiểm thử đầu-cuối hoàn toàn trên **chuỗi tài liệu tham khảo thô (`raw_reference`)** ([`data/essays/end_to_end_gold_benchmark.json`](../../data/essays/end_to_end_gold_benchmark.json) và [`scripts/evaluation/run_ground_truth_evaluation.py`](../../scripts/evaluation/run_ground_truth_evaluation.py)):
- **Quy trình đầu-cuối không dùng nhãn đích (*Zero Label-Oracle Blindness*):** Mọi chuỗi tham khảo thô đều đi qua đúng đường ống sản xuất: `ReferenceListParser` + `parse_vn_legal_reference` $\rightarrow$ `RetrievalOrchestrator` (`--mode offline` hoặc `--mode live`) $\rightarrow$ `NeuroSymbolicChecker` (giữ nguyên đầy đủ **5 nhãn chuẩn**, tuyệt đối không gộp `RESOURCE` vào `VERIFIED`; được chứng minh tự động bằng kiểm thử hoán vị nhãn mù `test_ground_truth_e2e_evaluation.py`).
- **Bộ đối kháng thực địa (`data/essays/adversarial_ground_truth.json`, $N = 15$ trên `essay_06..08`):** Đạt **`100.00%` Accuracy (`15 / 15`)**, **5-Class Macro-F1 = `1.0000` (`100.00%`)**, **4-Class Scholarly Accuracy = `100.00%` (`14 / 14`)**, `ECE = 0.0829`, `Brier = 0.0134` (`~2.7s`), bắt trọn lỗi tráo tác giả Sutskever, tráo tạp chí Hóa lượng tử trên bài BERT, sai cơ quan ban hành `Luật Doanh nghiệp` (`Bộ Tài chính`), URL giả `.invalid`, DOI ghép chéo chimeric và phân loại chuẩn `Bộ luật Dân sự 91/2015/QH13` thành `RESOURCE`.

### 8.1. Kết quả Tổng hợp & Từng Nhãn trên Tập Chuẩn Đa Miền (`N = 120` Tham khảo Thô, `7` Chuẩn, `6` Lĩnh vực)

- **5-Class End-to-End (`N = 120`):** **Accuracy = `99.17%` (`119 / 120`)** · Macro-Precision = **`99.38%`** (`0.9938`) · Macro-Recall = **`99.33%`** (`0.9933`) · **Macro-F1 = `99.34%` (`0.9934`)** · `ECE = 0.0878` · `Brier = 0.0376` (`~5.5s`; giữ nguyên `119 / 120` ngay cả khi chạy `--no-local-db`).
- **4-Class Scholarly (`N = 103`, tách riêng `17` mục `RESOURCE`):** **Accuracy = `99.03%` (`102 / 103`)** · Macro-Precision = **`99.22%`** (`0.9922`) · Macro-Recall = **`99.17%`** (`0.9917`) · **Macro-F1 = `99.18%` (`0.9918`)**.

| Nhãn Phán quyết (`5-Class Taxonomy`) | Số mẫu ($N$) | Precision | Recall | **F1-Score** | Hàng Ma trận Nhầm lẫn (`[VER, META, HAL, UNR, RES]`) & Ghi chú |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **`verified`** | `31` | `96.88%` (`0.9688`) | **`100.00%`** (`1.0000`) | **`98.41%`** (`0.9841`) | `[31, 0, 0, 0, 0]` — `31 / 31` công trình hợp lệ xác thực chính xác từ chuỗi thô |
| **`metadata_error`** | `30` | **`100.00%`** (`1.0000`) | `96.67%` (`0.9667`) | **`98.31%`** (`0.9831`) | `[1, 29, 0, 0, 0]` — `1` ca sai số còn lại (`E2E-031`: tên tạp chí viết tắt 1 từ `BMJ` CONSORT 2010 khi DOI+tiêu đề+tác giả+năm khớp tuyệt đối) |
| **`suspected_hallucination`** | `28` | **`100.00%`** (`1.0000`) | **`100.00%`** (`1.0000`) | **`100.00%`** (`1.0000`) | `[0, 0, 28, 0, 0]` — bắt trọn `28 / 28` trích dẫn bịa đặt đa ngành |
| **`unresolved`** | `14` | **`100.00%`** (`1.0000`) | **`100.00%`** (`1.0000`) | **`100.00%`** (`1.0000`) | `[0, 0, 0, 14, 0]` — khoanh vùng chính xác `14 / 14` ca vùng biên / nghẽn API / DOI khu vực |
| **`resource`** | `17` | **`100.00%`** (`1.0000`) | **`100.00%`** (`1.0000`) | **`100.00%`** (`1.0000`) | `[0, 0, 0, 0, 17]` — phân tách chuẩn xác văn bản pháp luật VN, RFC, tài liệu kỹ thuật & web |

### 8.2. Độ Chính xác Đầu-Cuối Theo Chuẩn Trích dẫn (`7 Styles`) & Theo Lĩnh vực Học thuật (`6 Domains`)

| Phân tích Theo `7` Chuẩn Trích dẫn | Kết quả (`Accuracy`) | Phân tích Theo `6` Lĩnh vực (`20` mẫu/miền) | Kết quả (`Accuracy`) |
| :--- | :---: | :--- | :---: |
| **`APA 7th`** | **`100.00%`** (`24 / 24`) | **Computer Science & AI/NLP** | **`100.00%`** (`20 / 20`) |
| **`TDTU Vietnamese`** | **`100.00%`** (`21 / 21`) | **Biomedical & Clinical** | **`95.00%`** (`19 / 20`, F1 `96.24%`) |
| **`IEEE`** | **`100.00%`** (`18 / 18`) | **Economics, Finance & Social Sciences** | **`100.00%`** (`20 / 20`) |
| **`Vancouver`** | **`100.00%`** (`15 / 15`) | **Engineering & Physics** | **`100.00%`** (`20 / 20`) |
| **`Chicago`** | **`93.33%`** (`14 / 15`, F1 `94.95%`) | **Vietnamese Legal Statutes** | **`100.00%`** (`20 / 20`) |
| **`Harvard`** | **`100.00%`** (`14 / 14`) | **Technical Standards & Software** | **`100.00%`** (`20 / 20`) |
| **`MLA 9th`** | **`100.00%`** (`13 / 13`) | **Tổng cộng (`N = 120`)** | **`99.17%`** (`119 / 120`) |

---

## 9. Các Đe Dọa Đối Với Tính Hợp Lệ Nghiên Cứu (`Threats to Validity`)

Để đảm bảo tính trung thực và minh bạch khoa học cao nhất theo chuẩn mực thẩm định của **ACL / EMNLP / IEEE Transactions**, chúng tôi phân tích rõ bốn nhóm giới hạn phương pháp luận và biện pháp giảm thiểu đã triển khai:

1. **Tính hợp lệ Nội tại (*Internal Validity* — Bán tổng hợp so với Lỗi Sinh viên Tự nhiên):**
   - *Giới hạn:* Tập benchmark `120,000` mẫu được kiến tạo theo phương pháp **bán tổng hợp có kiểm soát (*controlled semi-synthetic perturbation*)** trên `120,000` bài báo thật thay vì `120,000` trích dẫn lỗi do con người gõ tay hoàn toàn (vốn không tồn tại tập dữ liệu công khai có gán nhãn ở quy mô $10^5$). Các quy tắc tạo nhiễu nếu thiết kế sơ sài có thể tạo ra lối tắt đặc trưng (*annotation artifacts*).
   - *Giảm thiểu:* Hệ thống đã loại bỏ hoàn toàn `np.clip` theo nhãn, khử trùng lặp tiêu đề chuẩn hóa trước khi chia tập (`0/0/0` chồng lấp), kích hoạt điểm đối sánh ngữ nghĩa `Sentence-BERT` trên **cả 4 nhãn** ($P(\text{VERIFIED} \mid \text{score} > 0) = 54.47\%$), và sử dụng ghép chéo tiêu đề học thuật cùng miền + tên học giả thật thay cho mẫu chuỗi giả lập. Ngoài ra, tập kiểm thử đầu-cuối trên chuỗi tham khảo thô và `310` tệp PDF thực tế bổ trợ trực tiếp cho đánh giá cấp đặc trưng.
2. **Tính hợp lệ Ngoại tại (*External Validity* — Độ tập trung Miền CS/NLP trong Kho Nội bộ `local_papers.db`):**
   - *Giới hạn:* Trong `129,125` bản ghi của kho SQLite FTS5 nội bộ (`data/local_papers.db`), có **`127,102` bài (`98.43%`) thuộc ACL Anthology** (Khoa học Máy tính, Xử lý Ngôn ngữ Tự nhiên & Trí tuệ Nhân tạo), chỉ có `1.57%` thuộc các lĩnh vực khác. Do đó, kết quả `96.67%` trên benchmark `120,000` mẫu phản ánh mạnh nhất đặc thù ngôn ngữ học thuật tiếng Anh ngành CS/NLP.
   - *Giảm thiểu:* Khi vận hành thực tế trên khóa luận đa ngành (Y sinh, Hóa học, Kinh tế, Luật Việt Nam, Nhân văn), `RetrievalOrchestrator` không phụ thuộc riêng vào `local_papers.db` mà truy vấn song song **15+ cơ sở dữ liệu liên ngành trực tuyến** (`Crossref`, `OpenAlex`, `Europe PMC`, `NCBI/bioRxiv`, `DOAJ`, `DataCite`, `OpenAIRE/HAL`, `OpenLibrary`, `Global DOI RA`, `VNLegalVerifier`). Hiệu năng đa ngành được kiểm chứng độc lập qua bộ `310` PDF thực tế (`12` chuẩn trích dẫn) và bộ chuẩn đầu-cuối đa miền (`N = 120`).
3. **Tính hợp lệ Cấu trúc (*Construct Validity* — Khoảng trống Abstract sau Tường phí & Phụ thuộc Tầng Phân tích PDF):**
   - *Giới hạn:* Nhiều bài báo xuất bản thương mại (Elsevier, Wiley, IEEE Xplore cũ) không mở công khai toàn văn `abstract` trên Crossref/DOI CSL, khiến tầng đối sánh ngữ nghĩa cấp độ câu chỉ so khớp được với tiêu đề hoặc phải bỏ qua kiểm chứng luận điểm. Bên cạnh đó, các lỗi tách dòng PDF phức tạp hoặc lỗi nhận diện của GROBID ở Thượng nguồn có thể lan truyền xuống tầng đối sánh.
   - *Giảm thiểu:* Hệ thống triển khai cơ chế làm giàu abstract chéo qua 9 nguồn mở (`_enrich_missing_abstract` trên OpenAlex, Semantic/EuropePMC, arXiv, DataCite, DOAJ, OpenAIRE) và tuyệt đối không phạt trích dẫn hợp lệ khi nguồn thiếu abstract công khai (`has_non_live_missing_abstract` guardrail).
4. **Tính hợp lệ Sinh thái (*Ecological Validity* — Biến động API Bên thứ ba & Độ trễ Mạng Thực tế):**
   - *Giới hạn:* Khi chấm hàng loạt khóa luận vào mùa bảo vệ tốt nghiệp, các API công khai miễn phí (Crossref, OpenAlex, DBLP, arXiv) có thể trả lỗi giới hạn tần suất `HTTP 429` hoặc thay đổi chỉ mục theo thời gian (*index drift*).
   - *Giảm thiểu:* CITRA tích hợp bộ nhớ đệm bền vững khử trùng lặp truy vấn (`Singleflight + Persistent SQLite Cache`), bộ ngắt mạch (`Circuit Breaker`), và luật từ chối phán quyết an toàn `R-RATE-LIMITED-ABSTAIN` (đạt `100.00%` độ chính xác trên `400` mẫu nghẽn mạng ở mục 6), đảm bảo **không bao giờ cáo buộc oan sinh viên bịa đặt nguồn khi hệ thống mạng hoặc API bên ngoài gặp sự cố**.

---

## 10. Lệnh Tái Lập Thực Nghiệm (`Reproducibility`)

```bash
# 1. Huấn luyện lại từ đầu, hiệu chỉnh Platt, chạy OOD Stress Suite (N=2,400), McNemar/Bootstrap & CIS Sensitivity
.venv/bin/python scripts/train_neuro_symbolic_model.py

# 2. Chạy đánh giá đầu-cuối (End-to-End Raw-Reference) trên N=120 đa miền & N=15 đối kháng
.venv/bin/python scripts/evaluation/run_ground_truth_evaluation.py --mode offline
.venv/bin/python scripts/evaluation/run_ground_truth_evaluation.py --dataset data/essays/adversarial_ground_truth.json --mode offline

# 3. Kiểm thử hồi quy xác nhận Zero-Leakage, Zero-Clamping, 4-Class Alignment, E2E Blindness & Verbatim Parity
.venv/bin/python -m pytest tests/unit/test_calibration.py tests/unit/test_baselines.py tests/unit/test_wave3_eval_scripts_and_configs.py tests/unit/test_ground_truth_e2e_evaluation.py -q
```
