# Báo Cáo Thực Nghiệm & Kiểm Định Mô Hình Neuro-Symbolic Quy Mô Lớn (120,000 Bài Báo Khoa Học, OOD Guardrail Stress Test & Kiểm Định Thống Kê)

> **Hệ thống:** CITRA (`SourceLogic` — Essay Integrity Checker v3.91.2)
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
| **1. Phân tách Độc lập theo Bài báo & Tiêu đề (*Strict Stratified Paper- & Title-Disjoint Split*)** | Từ `129,137` bản ghi trong `data/local_papers.db` (`128,115` bài báo hợp lệ duy nhất theo khóa tiêu đề chuẩn hóa; `98.42%` thuộc ACL Anthology), hệ thống lấy mẫu phân tầng **`120,000` bài báo thực tế độc lập** (`80,000` bài có đầy đủ abstract `>80` ký tự + `40,000` bài có đầy đủ metadata thư mục) và chia tách **trước** khi sinh bất kỳ biến nhiễu hay ghép chéo nào:<br>• **Train (`70%`)**: `84,000` bài báo (`56,000` full-abstract + `28,000` metadata)<br>• **Validation (`15%`)**: `18,000` bài báo (`12,000` full-abstract + `6,000` metadata)<br>• **Held-Out Test (`15%`)**: `18,000` bài báo (`12,000` full-abstract + `6,000` metadata)<br>• Mọi phép biến đổi chéo bài báo chỉ ghép các bài báo **nằm trong cùng một tập split** (`0 / 0 / 0` chồng lấp `paper_id` & tiêu đề chuẩn hóa). | **SciFact** (*Wadden et al., EMNLP 2020*) & **FEVER** (*Thorne et al., NAACL 2018*) |
| **2. Triệt tiêu Lối tắt Đặc trưng Một chiều (*4-Class Authentic Context Alignment*)** | Phân bổ tỷ lệ bài báo có full abstract (`66.7%`) đồng đều vào **cả 4 phân lớp** trong từng split để tính điểm đối sánh ngữ nghĩa đa câu `content_alignment_score` thực tế bằng chính toàn văn abstract gốc của bài báo đó trên cả 4 nhãn (không lọc trước câu nguồn bằng stemmer):<br>• `VERIFIED`: `50.0%` có ngữ cảnh trích dẫn (`median = 0.5840`)<br>• `METADATA_ERROR`: `44.8%` có ngữ cảnh trích dẫn (`median = 0.4633`, bao gồm cả ngữ cảnh khớp trên trích dẫn sai năm/tác giả/DOI và phân nhóm gán sai luận điểm 12 mẫu câu tự nhiên bất biến động từ `R-CONTENT-MISMATCH`)<br>• `SUSPECTED_HALLUCINATION`: `40.0%` số ca có ứng viên ở `H2/H4` (`8.8%` toàn nhãn, `median = 0.2152`)<br>• `UNRESOLVED`: `35.0%` của `U1` (`23.2%` toàn nhãn, `median = 0.3775`)<br>$\Rightarrow P(\text{VERIFIED} \mid \text{content\_alignment} > 0) = 54.06\%$, triệt tiêu hoàn toàn lối tắt `content_alignment > 0 => VERIFIED`. | **Poliak et al.** (*NAACL 2018*) & **Gururangan et al.** (*NAACL 2018 — Annotation Artifacts in NLI*) |
| **3. Mô phỏng Ảo giác LLM Cùng Chuyên ngành Thực tế (*Plausible Same-Domain Hallucinations*)** | Loại bỏ hoàn toàn các chuỗi giả lập viễn tưởng dễ đoán và chặn biên năm xuất bản thực tế (`1950 <= cited_year <= 2026`). Các nhóm `H1–H4` (`36,000` mẫu) ghép sạch cụm mở đầu học thuật đã cắt gọn phụ từ lơ lửng của `p1["title"]` với cụm phương pháp luận của `p3["title"]`, gán tên các học giả có thật (`[donor["authors"][0], donor["authors"][-1]]` không trùng ứng viên `p2`) và tên hội nghị/tạp chí học thuật thật (`ACL`, `EMNLP`, `COLING`, `TACL`, `LREC`, `NAACL`) hoàn toàn bên trong cùng một split. | **Walters & Wilder** (*Scientific Reports, 2023*) & **ALCE** (*Gao et al., EMNLP 2023*) |
| **4. Đồng nhất `BaselineRunner("proposed")` với `SymbolicRules` & Trích xuất Không Cắt Ngưỡng** | Không dùng `np.clip` theo nhãn đích và không sàng lọc trước câu trích dẫn bằng hàm nội bộ của bộ dò. Mã hóa **`419,109` câu/tiêu đề duy nhất** (từ `600,000` chuỗi thành phần bao gồm pooling đa câu abstract) bằng `Sentence-BERT (all-MiniLM-L6-v2)` trên GPU (`mps`) kết hợp `FeatureCalculator.compute_title_similarity` đối xứng, chuẩn hóa họ đa văn hóa (`author_matcher` bảo toàn họ particle độc lập & họ 1 ký tự Nam Á/Hungary), và cổng đặc trưng bất biến động từ có tỉ lệ neo từ vựng (`calibrate_monolingual_specificity`). Đồng thời `BaselineRunner("proposed")` gọi trực tiếp bộ luật sản xuất `SymbolicRules`, đảm bảo kết quả `Proposed` ở Bảng 5.1 và `SymbolicRules` ở Bảng 5.2 **khớp tuyệt đối 100%** (`99.67%` Accuracy, `0.9965` Macro-F1). | **Sentence-BERT** (*Reimers & Gurevych, EMNLP 2019*) |
| **5. Tối ưu Siêu tham số & Hiệu chỉnh Xác suất Hậu nghiệm (*Post-Hoc Platt Calibration*)** | • Trọng số `HybridMLScorer` học hoàn toàn trên **Train (`84,000` mẫu)**.<br>• Siêu tham số L2 $C^* = 0.25$ (`Val Macro-F1 = 0.9768`) và tham số **Logit-Space Platt Scaling** ($a = 1.891263, b = 1.138599$) khớp độc lập trên **Validation (`18,000` mẫu)**. | **Platt Scaling** (*Platt, 1999*) & **Modern Neural Calibration** (*Guo et al., ICML 2017*) |
| **6. Kiểm định Thống kê Bắt cặp, OOD Stress Test (`N = 2,400`) & Độ nhạy Trọng số `CIS`** | Thực hiện **kiểm định McNemar hiệu chỉnh liên tục**, **Paired Bootstrap $B = 1,000$ lần** với hiệu chỉnh mẫu hữu hạn Davison–Hinkley, kiểm định **Wilcoxon Signed-Rank** trên độ giảm Brier Score, bộ thử nghiệm **OOD Hard-Guardrail (`N = 2,400`)** chứng minh `Proposed` vượt trội có ý nghĩa thống kê trước `Pure ML B5` trên **cả ID (`99.67%` vs. `97.70%`, $p = 1.66 \times 10^{-73}$) lẫn OOD (`99.96%` vs. `57.33%`, $p = 4.89 \times 10^{-224}$)**, và phân tích độ nhạy `CIS` (`300` bản thảo $\times$ `20` vector trọng số). | **Dror et al.** (*ACL 2018*), **Berg-Kirkpatrick et al.** (*EMNLP 2012*) & **Dietterich** (*1998*) |

---

## 2. Nguồn Gốc Tập Dữ Liệu (`Corpus Provenance`), Kiểm Định Chống Rò Rỉ & Kiểm Định Chống Lối Tắt Đặc Trưng

### 2.1. Thống kê Kho Tri thức Học thuật Nội bộ (`data/local_papers.db`)

| Chỉ số Thống kê Nguồn Dữ liệu | Số lượng Bài báo | Tỷ lệ / Ghi chú Minh bạch |
| :--- | :---: | :--- |
| Tổng số bản ghi trong `data/local_papers.db` (`total_papers_in_db`) | `129,137` | `127,102` bài từ **ACL Anthology (`98.42%`)** + `2,035` bài (`1.58%`) từ Crossref, OpenAlex, OpenLibrary, DataCite, v.v. |
| Tổng số bài báo hợp lệ duy nhất theo khóa tiêu đề (`total_valid_scholarly_papers`) | `128,115` | `99.21%` tổng kho dữ liệu sau khử trùng lặp tiêu đề chuẩn hóa |
| Số bài báo có đầy đủ `abstract` dài (`> 80` ký tự, `eligible_with_full_abstract`) | `82,887` | Đủ điều kiện đối sánh ngữ nghĩa cấp độ câu |
| Số bài báo có đầy đủ metadata thư mục (`eligible_metadata_only`) | `45,228` | Các bài hội nghị/tạp chí lưu trữ metadata đầy đủ |
| **Tổng số bài báo lấy mẫu cho Benchmark (`sampled_total`)** | **`120,000`** | **`80,000` bài full-abstract + `40,000` bài metadata-complete** |

### 2.2. Kiểm định Phân tách Độc lập (`Strict Paper- & Title-Disjoint Split`)

| Tập Dữ liệu (`Split`) | Tỷ lệ | Tổng số Bài báo Độc lập | Bài báo Full Abstract (`66.7%`) | Bài báo Metadata-Complete (`33.3%`) | Số câu/tiêu đề duy nhất mã hóa SBERT | Kiểm định Giao tập (`paper_id` & `norm_title`) |
| :--- | :---: | :---: | :---: | :---: | :---: | :--- |
| **Train Split** | `70.0%` | **`84,000`** | `56,000` | `28,000` | `293,365` | `\|Train ∩ Val\| = 0` (`ID` & `Title`) |
| **Validation Split** | `15.0%` | **`18,000`** | `12,000` | `6,000` | `62,869` | `\|Train ∩ Test\| = 0` (`ID` & `Title`) |
| **Held-Out Test Split** | `15.0%` | **`18,000`** | `12,000` | `6,000` | `62,875` | `\|Val ∩ Test\| = 0` (`ID` & `Title`) |
| **Tổng cộng** | **`100.0%`** | **`120,000`** | **`80,000`** | **`40,000`** | **`419,109`** | **`zero_leakage_verified = True`** |

### 2.3. Kiểm định Phân bố `content_alignment_score` trên Cả 4 Nhãn (`Feature Shortcut Audit`, Test $N = 18,000$)

| Nhãn Thực tế (`Gold Label`) | Tổng số Mẫu ($N$) | Số mẫu `score > 0` | Tỷ lệ `score > 0` | Số mẫu `is_aligned = True` (`≥ 0.50`) | Trung bình (`score > 0`) | Phân vị `[P10, P50, P90]` |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **`VERIFIED`** | `6,480` | `3,240` | **`50.00%`** | `2,375` (`36.65%`) | `0.5795` | `[0.4078, 0.5840, 0.7429]` |
| **`METADATA_ERROR`** | `3,960` | `1,775` | **`44.82%`** | `766` (`19.34%`) | `0.4471` | `[0.1724, 0.4633, 0.7016]` |
| **`SUSPECTED_HALLUCINATION`** | `5,400` | `476` | **`8.81%`** *(40% H2/H4 có ứng viên)* | `1` (`0.02%`) | `0.2188` | `[0.0887, 0.2152, 0.3553]` |
| **`UNRESOLVED`** | `2,160` | `502` | **`23.24%`** *(35% U1)* | `181` (`8.38%`) | `0.4017` | `[0.1284, 0.3775, 0.6887]` |

> **Nhận xét Kiểm định:** Xác suất hậu nghiệm $P(\text{VERIFIED} \mid \text{content\_alignment\_score} > 0) = 0.5406$ (`54.06%`), và có tới `948` mẫu không thuộc `VERIFIED` (`766` `METADATA_ERROR` + `181` `UNRESOLVED` + `1` `SUSPECTED_HALLUCINATION`) vẫn đạt ngưỡng `content_is_aligned = True` ($\ge 0.50$). Điều này chứng minh mô hình bắt buộc phải kết hợp đa đặc trưng và kiểm tra ràng buộc thư mục – thực nghiệm chứ không thể dựa vào bất kỳ đặc trưng đơn lẻ nào.

---

## 3. Phân Bố 4 Nhãn Chính & 15 Phân Nhóm Lỗi (`15 Sub-Taxonomies`)

| Nhãn Chính (`Canonical Class`) | Mã Phân nhóm | Mô tả Kịch bản Trích dẫn Thực tế & Lỗi Học thuật | Train (`70%`) | Val (`15%`) | Test (`15%`) | **Tổng (`100%`)** |
| :--- | :---: | :--- | :---: | :---: | :---: | :---: |
| **`VERIFIED`**<br>*(36.0% — 43,200 mẫu)* | **`V1`** | Trích dẫn chuẩn xác hoàn toàn (`title`, `authors`, `year`, `venue`, `DOI`) | `7,560` | `1,620` | `1,620` | **`10,800`** |
| | **`V2`** | Rút gọn danh sách tác giả (`First Author et al.`, viết tắt tên) & lệch $\pm 1$ năm Online-First vs. Print | `7,560` | `1,620` | `1,620` | **`10,800`** |
| | **`V3`** | Lược bỏ phụ đề sau dấu `:`, `?`, `!`, `;` (*subtitle truncation*) hoặc biến thể dấu câu nhỏ | `7,560` | `1,620` | `1,620` | **`10,800`** |
| | **`V4`** | Nhiễu OCR ký tự / gạch nối PDF + cứu hộ ngữ nghĩa bằng `R-CONTENT-ALIGNMENT` | `7,560` | `1,620` | `1,620` | **`10,800`** |
| **`SUSPECTED_HALLUCINATION`**<br>*(30.0% — 36,000 mẫu)* | **`H1`** | Ảo giác LLM cùng chuyên ngành (ghép tiêu đề học thuật + tên học giả & hội nghị thật) $\rightarrow$ `0` ứng viên (`R-NO-SCHOLARLY-RECORD`) | `6,300` | `1,350` | `1,350` | **`9,000`** |
| | **`H2`** | Trích dẫn *Spliced* cùng miền NLP/CS có ứng viên nhiễu yếu + đối sánh chéo abstract (`R-HALLUCINATED-SOURCE`) | `6,300` | `1,350` | `1,350` | **`9,000`** |
| | **`H3`** | DOI có tiền tố nhà xuất bản thật (`10.18653/v1/*`, `10.1109/*`, `10.1145/*`, `10.1007/*`) nhưng mã bài không tồn tại (`R-NONEXISTENT-DOI`) | `6,300` | `1,350` | `1,350` | **`9,000`** |
| | **`H4`** | Nguồn ảo giác đi kèm liên kết chết (`HTTP 404` `R-DEAD-URL`) hoặc tên miền giữ chỗ RFC 2606 (`R-FAKE-URL`) | `6,300` | `1,350` | `1,350` | **`9,000`** |
| **`METADATA_ERROR`**<br>*(22.0% — 26,400 mẫu)* | **`M1`** | Sai năm xuất bản ($|\Delta\text{year}| \in \{2, 3, 4, 5, 6, 8\}$ năm) trên bài báo thật (bao gồm cả ngữ cảnh khớp cao) | `3,696` | `792` | `792` | **`5,280`** |
| | **`M2`** | Nhầm lẫn / thay thế đồng tác giả bằng tên học giả khác cùng lĩnh vực với tiêu đề khớp cao | `3,696` | `792` | `792` | **`5,280`** |
| | **`M3`** | DOI hợp lệ nhưng tiêu đề trích dẫn bị biến dạng mức trung bình (`R-DOI-TITLE-MISMATCH`) | `3,696` | `792` | `792` | **`5,280`** |
| | **`M4`** | Biến đổi tiêu đề mức trung bình không có DOI (`R-SINGLE-SOURCE-PARTIAL`) & trích dẫn đúng nguồn (đầy đủ tác giả / `First Author et al.`, đa nguồn) nhưng gán sai luận điểm qua 12 mẫu câu học thuật tự nhiên bất biến động từ (`R-CONTENT-MISMATCH`) | `3,696` | `792` | `792` | **`5,280`** |
| | **`M5`** | Sai lệch tổ hợp đa trường (`author + year + title`) hoặc ngoại lệ `R-DOMAIN-EXCEPTION` | `3,696` | `792` | `792` | **`5,280`** |
| **`UNRESOLVED`**<br>*(12.0% — 14,400 mẫu)* | **`U1`** | Bản thảo đổi tên từ preprint / dịch tiêu đề vùng biên có trùng tác giả chính (`author_jaccard >= 0.20`, `35%` có ngữ cảnh, `R-ABSTENTION-BORDER`) | `6,720` | `1,440` | `1,440` | **`9,600`** |
| | **`U2`** | DOI khu vực chưa có CSL (`10.11499/*`, `10.5109/*` — `R-DOI-RA-NO-CSL`) & nghẽn tần suất API HTTP 429 (`R-RATE-LIMITED-ABSTAIN`) | `3,360` | `720` | `720` | **`4,800`** |
| **Tổng cộng** | **15 Nhóm** | **Đầy đủ phổ kịch bản xác thực trích dẫn khoa học** | **`84,000`** | **`18,000`** | **`18,000`** | **`120,000`** |

---

## 4. Không Gian Đặc Trưng 16 Chiều & Tối Ưu Siêu Tham Số (`Hyperparameter Tuning`)

### 4.1. Kết quả Grid Search Hệ số Điều chuẩn L2 ($C$) trên Tập Validation ($N = 18,000$)

| Giá trị $C$ ứng viên | `0.1` | **`0.25` *(Được chọn)*** | `0.5` | `1.0` | `2.0` | `5.0` | `10.0` |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Validation Macro-F1** | `0.9742` | **`0.9768`** | `0.9721` | `0.9734` | `0.9743` | `0.9748` | `0.9751` |

- **Tham số kết hợp Symbolic – ML (`symbolic_blend_alpha`):** $\alpha = 0.72$ ($S_{\text{blend}} = 0.72 \cdot C_{\text{symbolic}} + 0.28 \cdot P_{\text{ML}}(y_{\text{sym}} \mid \mathbf{x})$).
- **Tham số Platt Scaling khớp độc lập trên tập Validation ($N = 18,000$):** $a = 1.891263$ (`1.8913`), $b = 1.138599$ (`1.1386`).

---

## 5. Kết Quả Thực Nghiệm Trên Tập Held-Out Test Trong Phân Phối ($N = 18,000$ Bài Báo Độc Lập)

### 5.1. Nghiên cứu Cắt bỏ & Đối sánh Baseline (`Ablation Study` — Đồng nhất 100% với Bộ Luật Sản xuất)

| Phương pháp / Baseline | Mô tả Cơ chế Quyết định | Accuracy | Macro-Precision | Macro-Recall | **Macro-F1** |
| :--- | :--- | :---: | :---: | :---: | :---: |
| **`B0` (`doi_only`)** | Chỉ xác thực khi có DOI khớp chính xác | `26.24%` | `0.2342` | `0.3489` | `0.1957` |
| **`B1` (`single_source_crossref`)** | Chỉ tra cứu đơn nguồn trên `Crossref` | `58.31%` | `0.5664` | `0.4813` | `0.4538` |
| **`B3` (`embedding_only`)** | Thuần ngữ nghĩa `Sentence-BERT` cosine similarity trên tiêu đề | `66.93%` | `0.4940` | `0.5211` | `0.4570` |
| **`B4` (`no_calibration`)** | Tổ hợp tuyến tính đa đặc trưng, tắt vùng abstention (`UNRESOLVED`) | `80.53%` | `0.6242` | `0.6652` | `0.6314` |
| **`B2` (`fuzzy_only`)** | Chỉ dùng so khớp từ vựng `RapidFuzz` tiêu đề + `AuthorJaccard` | `82.84%` | `0.6395` | `0.6914` | `0.6563` |
| **`B5` (`ml_hybrid`)** *(In-Distribution)* | `HybridMLScorer` (Multinomial Logistic Regression 16D, $C = 0.25$ — *sụp đổ xuống `57.33%` trên OOD ở mục 6*) | `97.70%` | `0.9758` | `0.9769` | `0.9763` |
| **`Proposed` (`Neuro-Symbolic`)** | **Bộ luật `SymbolicRules` sản xuất + Họ Đa văn hóa + Đối xứng Tiêu đề + Ngữ nghĩa Tỉ lệ Neo + Link Check + `PlattCalibrator` + Abstention** | **`99.67%`** | **`0.9965`** | **`0.9964`** | **`0.9965`** |

### 5.2. Hiệu năng Chi tiết Từng Nhãn của Hệ thống Đề xuất (`Proposed Neuro-Symbolic`)

| Nhãn Phán quyết (`ValidationLabel`) | Số mẫu Test ($N$) | Precision | Recall | **F1-Score** | Ý nghĩa Thực tiễn & Bất biến An toàn Học thuật |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **`VERIFIED`** | `6,480` | **`0.9943`** | **`0.9994`** | **`0.9968`** | **`0 / 6,480` bài báo hợp lệ bị kết luận oan là `SUSPECTED_HALLUCINATION`**; **`0 / 5,400` bài ảo giác lọt lưới thành `VERIFIED`** (`6,476 / 6,480` đúng tuyệt đối, `4` ca chuyển sang `METADATA_ERROR`, `0` ca chuyển sang `UNRESOLVED`). |
| **`SUSPECTED_HALLUCINATION`** | `5,400` | **`0.9993`** | **`0.9996`** | **`0.9994`** | Phát hiện **`5,398 / 5,400` (`99.96%` Recall, `99.93%` Precision)** trích dẫn ảo giác ghép chéo chuyên ngành với tên học giả thật (`2` ca biên ngoài chỉ mục chuyển thận trọng sang `UNRESOLVED`, `0` ca lọt thành `VERIFIED`). |
| **`METADATA_ERROR`** | `3,960` | **`0.9990`** | **`0.9866`** | **`0.9928`** | Đạt **`99.90%` Precision & `98.66%` Recall** trên toàn bộ 5 phân nhóm sai năm (`M1`), sai tác giả (`M2`), lệch tiêu đề (`M3`, `M4`), gán sai ngữ cảnh 12 mẫu câu tự nhiên (`R-CONTENT-MISMATCH`) và ngoại lệ tên miền (`M5`), kéo giảm ca lọt sang `VERIFIED` từ `101 → 37` (`-63.4%`). |
| **`UNRESOLVED` *(Abstention)*** | `2,160` | **`0.9936`** | **`1.0000`** | **`0.9968`** | Khoanh vùng chuẩn xác tuyệt đối **`2,160 / 2,160` (`100.00%` Recall, `99.36%` Precision)** ca vùng xám (`U1` `R-ABSTENTION-BORDER`, `U2` DOI khu vực `R-DOI-RA-NO-CSL` & nghẽn API `R-RATE-LIMITED-ABSTAIN`). |
| **Trung bình Vĩ mô / Tổng (`Macro / Total`)** | **`18,000`** | **`0.9965`** | **`0.9964`** | **`0.9965`** | **Overall Accuracy: `99.67%`** (`17,941 / 18,000` mẫu khớp nhãn gốc hoàn toàn, chỉ còn `59` lỗi, hạng #1 tuyệt đối trước tất cả `B0..B5`). |

### 5.3. Ma trận Nhầm lẫn (`4×4 Confusion Matrix` trên $N = 18,000$ Mẫu Test)

| Nhãn Thực tế (`Gold`) \ Dự đoán (`Pred`) | Dự đoán: `VERIFIED` | Dự đoán: `METADATA_ERROR` | Dự đoán: `SUSPECTED_HALLUCINATION` | Dự đoán: `UNRESOLVED` | **Tổng Thực tế (`Support`)** |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Thực tế: `VERIFIED`** | **`6,476`** | `4` | `0` | `0` | `6,480` |
| **Thực tế: `METADATA_ERROR`** | `37` | **`3,907`** | `4` | `12` | `3,960` |
| **Thực tế: `SUSPECTED_HALLUCINATION`** | `0` | `0` | **`5,398`** | `2` | `5,400` |
| **Thực tế: `UNRESOLVED`** | `0` | `0` | `0` | **`2,160`** | `2,160` |

### 5.4. Hiệu quả Hiệu chỉnh Xác suất (`Logit-Space Platt Scaling`) & Khoảng Tin cậy 95% Bootstrap ($B = 1,000$)

| Cấu hình Độ tin cậy | Macro-F1 | **ECE** *(95% CI)* | **Brier Score** *(95% CI)* | Acc @ `50%` Cov | Acc @ `70%` Cov | Acc @ `90%` Cov | Acc @ `95%` Cov | Acc @ `100%` Cov *(95% CI)* |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Chưa hiệu chỉnh (`Uncalibrated Raw`)** | `0.9965` | `0.2477` | `0.0843` | `99.76%` | `99.64%` | `99.69%` | `99.70%` | `99.67%` |
| **Đã hiệu chỉnh (`Platt-Calibrated`)** | **`0.9965`**<br>`[0.9955, 0.9974]` | **`0.0405`** *(↓ **6.12×** / `-83.6%`)*<br>`[0.0394, 0.0415]` | **`0.0067`** *(↓ **12.58×** / `-92.1%`)*<br>`[0.0060, 0.0076]` | **`99.60%`** | **`99.67%`** | **`99.73%`** | **`99.74%`** | **`99.67%`**<br>`[0.9958, 0.9976]` |

---

## 6. Kiểm Thử Sức Chịu Đựng Ngoài Phân Phối (`OOD Hard-Guardrail Stress Suite`, $N = 2,400$) — Tại Sao Kiến Trúc Neuro-Symbolic Vượt Trội Hơn Học Máy Thuần Túy (`Pure ML B5`)?

Ngay cả trên tập Test trong phân phối ($N = 18,000$) đã loại bỏ hoàn toàn mọi lối tắt đặc trưng nhân tạo và mọi sàng lọc trước bằng stemmer, hệ thống `Proposed Neuro-Symbolic` đã vượt lên dẫn đầu trước bộ phân loại hồi quy logistic 16 chiều `B5` (`99.67%` so với `97.70%`, $\Delta\text{Acc} = +1.97\%$, giảm `85.7%` số lỗi, McNemar $p = 1.66 \times 10^{-73}$). Hơn thế nữa, trong kiểm toán học thuật thực tế, hệ thống thường xuyên đối mặt với **các vi phạm ràng buộc biểu tượng bậc nhất (*First-Order Symbolic Constraints*)** mà vector tương đồng liên tục 16 chiều không thể biểu diễn.

Để chứng minh thực nghiệm luận điểm cốt lõi của khóa luận (không ghi đè thủ công bất kỳ trường nào trái với `raw_citation`), chúng tôi xây dựng bộ kiểm thử **Out-of-Distribution (OOD) Hard-Guardrail Stress Suite gồm `2,400` mẫu (`6` nhóm $\times$ `400` mẫu, trích xuất 100% từ `test_papers`, `0` chồng lấp Train/Val)**:

| Nhóm Kiểm thử Ràng buộc Thực tế (`OOD Category`, $N = 400$/nhóm) | Nhãn Gốc (`Gold`) | Luật Bảo vệ Biểu tượng | `B4` (`No Calib.`) | **Pure ML `B5` (`HybridMLScorer`)** | **`Proposed Neuro-Symbolic`** | **Chênh lệch ($\Delta = \text{NS} - \text{B5}$)** | Phân tích Nguyên nhân Sụp đổ của Pure ML `B5` |
| :--- | :---: | :--- | :---: | :---: | :---: | :---: | :--- |
| **1. Bài báo đã bị rút bài chính thức (`retracted_papers`)** | `metadata_error` | `R-RETRACTED-PAPER` | `0.00%` | **`0.00%`** *(400/400 gán `verified`)* | **`100.00%`** | **`+100.00%`** | Bài rút lại vẫn khớp tuyệt đối DOI, tiêu đề, tác giả, năm (`tf=1.0, aj=1.0, doi=1.0`) $\rightarrow$ `B5` xác nhận nhầm 100% công trình đã bị rút bài. |
| **2. Ghép chéo DOI thật vào bài bịa đặt cùng thời kỳ (`chimeric_spliced_dois`)** | `suspected_hallucination` | `R-CHIMERIC-DOI-MISMATCH` | `0.00%` | **`99.00%`** *(3 `meta`, 1 `unr`)* | **`99.75%`** | `+0.75%` | Nhờ cơ chế chấm tiêu đề đối xứng `compute_title_similarity` loại bỏ thổi phồng tập con, `Proposed` bắt `399/400` (`99.75%`) nhỉnh hơn `B5` (`396/400`, `99.00%`), trong khi `B4` vẫn sụp đổ về `0.00%`. |
| **3. Tên miền giả mạo / RFC 2606 trên tiêu đề gần đúng (`fake_placeholder_urls`)** | `suspected_hallucination` | `R-FAKE-URL` | `0.00%` | **`0.00%`** *(200 `verified`, 197 `meta`, 3 `unr`)* | **`100.00%`** | **`+100.00%`** | Vector liên tục của `B5` không kiểm tra cấu trúc DNS/RFC 2606 (`example.com`, `.invalid`, `fake-*`) nên bị tiêu đề khớp một phần đánh lừa. |
| **4. DOI khu vực hợp lệ chưa có CSL (`regional_dois_no_csl`)** | `unresolved` | `R-DOI-RA-NO-CSL` | `0.00%` | `100.00%`* | **`100.00%`** | `0.00%` | *`B5` chỉ sống sót nhờ đặc trưng chỉ báo biểu tượng `abstention_zone_indicator` (`vec[15]`) do tầng Symbolic cấp sẵn; `B4` sụp đổ về `0.00%`. |
| **5. Nghẽn tần suất HTTP 429 toàn cục (`http_429_rate_limit_abstention`)** | `unresolved` | `R-RATE-LIMITED-ABSTAIN` | `0.00%` | `100.00%`* | **`100.00%`** | `0.00%` | *Tương tự mục 4, nhờ cờ biểu tượng `api_exhausted` được truyền vào `vec[15]` để tránh kết luận oan khi API quá tải. |
| **6. Sai thẩm quyền & số hiệu văn bản luật Việt Nam (`vn_statutory_authority_mismatch`)** | `metadata_error` | `VNLegalVerifier` (`R-VN-LEGAL-MISMATCH`) | `25.00%` | **`45.00%`** *(200 `hal`, 180 `meta`, 20 `ver`)* | **`100.00%`** | **`+55.00%`** | Phân tích trực tiếp qua `parse_vn_legal_reference` (0 ghi đè): `B5` bắt được 180 ca sai cơ quan có ứng viên nhưng gán nhầm 200 ca không ứng viên thành `hallucination` và 20 ca sai số hiệu thành `verified`. |
| **Tổng hợp Toàn bộ OOD Suite ($N = 2,400$)** | **3 Nhãn OOD** | **Symbolic Guardrails + VNLegal** | `4.17%`<br>*(F1 `0.0697`)* | **`57.33%`**<br>*(Active F1 `0.6231`)* | **`99.96%`**<br>*(Active F1 `0.9996`)* | **`+42.63%`**<br>*(+0.3765 F1)* | **Kiểm định McNemar: $\chi^2 = 1,021.0010$, $n_{10} = 1,023$, $n_{01} = 0$, $p = 4.89 \times 10^{-224}$ ($\log_{10} p = -223.31$).** |

---

## 7. Kiểm Định Ý Nghĩa Thống Kê Bắt Cặp (`Paired Statistical Significance`, Dror et al., ACL 2018) & Phân Tích Độ Nhạy Trọng Số `CIS`

### 7.1. Kiểm định McNemar Hiệu chỉnh Liên tục & Paired Bootstrap ($B = 1,000$, $N = 18,000$)

| Cặp Đối sánh trên Tập Held-Out Test ($N = 18,000$) | $\Delta\text{Accuracy}$ *(95% CI)* | $\Delta\text{Macro-F1}$ *(95% CI)* | Cặp Bất đồng McNemar ($n_{10} \text{ / } n_{01}$) | Thống kê McNemar $\chi^2$ | McNemar $p$-value ($\log_{10} p$) | Paired Bootstrap $p$-value ($B=1,000$) | Kết luận ($\alpha = 0.001$) |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **`Proposed` vs. `B0` (`doi_only`)** | **`+73.43%`** `[+72.79%, +74.08%]` | **`+0.8008`** `[+0.7969, +0.8048]` | `13,218 / 1` | `13,213.0007` | `< 1e-16` (`-2871.33`) | **`< 0.001`** (`0.000999`) | **Có ý nghĩa thống kê ($p \ll 0.001$)** |
| **`Proposed` vs. `B1` (`crossref`)** | **`+41.36%`** `[+40.67%, +42.10%]` | **`+0.5427`** `[+0.5368, +0.5483]` | `7,449 / 4` | `7,435.0109` | `< 1e-16` (`-1616.53`) | **`< 0.001`** (`0.000999`) | **Có ý nghĩa thống kê ($p \ll 0.001$)** |
| **`Proposed` vs. `B3` (`embedding`)** | **`+32.74%`** `[+32.06%, +33.47%]` | **`+0.5394`** `[+0.5342, +0.5448]` | `5,901 / 7` | `5,878.0381` | `< 1e-16` (`-1278.38`) | **`< 0.001`** (`0.000999`) | **Có ý nghĩa thống kê ($p \ll 0.001$)** |
| **`Proposed` vs. `B4` (`no_calib`)** | **`+19.14%`** `[+18.59%, +19.72%]` | **`+0.3651`** `[+0.3612, +0.3691]` | `3,461 / 16` | `3,411.3132` | `< 1e-16` (`-742.62`) | **`< 0.001`** (`0.000999`) | **Có ý nghĩa thống kê ($p \ll 0.001$)** |
| **`Proposed` vs. `B2` (`fuzzy_only`)** | **`+16.83%`** `[+16.31%, +17.40%]` | **`+0.3401`** `[+0.3367, +0.3438]` | `3,045 / 16` | `2,995.3558` | `< 1e-16` (`-652.27`) | **`< 0.001`** (`0.000999`) | **Có ý nghĩa thống kê ($p \ll 0.001$)** |
| **`Proposed` vs. `B5` *(In-Dist.)*** | **`+1.97%`** `[+1.76%, +2.18%]` | **`+0.0202`** `[+0.0179, +0.0224]` | `368 / 13` | `328.9134` | `< 1e-16` (`-72.78`) | **`< 0.001`** (`0.000999`) | **Có ý nghĩa thống kê trên cả ID ($p = 1.66 \times 10^{-73}$) & OOD (`+42.63%`, $p = 4.89 \times 10^{-224}$)** |
| **`Platt-Calibrated` vs. `Uncalibrated`** | $\Delta\text{ECE} = \mathbf{-0.2072}$<br>`[-0.2089, -0.2056]` | $\Delta\text{Brier} = \mathbf{-0.0775}$<br>`[-0.0788, -0.0763]` | Wilcoxon $W = 1,014,685.0$ | — | Wilcoxon `< 1e-16` | **ECE `< 0.001` · Brier `< 0.001`** | **Giảm sai số xác suất có ý nghĩa thống kê tuyệt đối** |

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
- **Bộ đối kháng thực địa (`data/essays/adversarial_ground_truth.json`, $N = 15$ trên `essay_06..08`):** Đạt **`100.00%` Accuracy (`15 / 15`)**, **5-Class Macro-F1 = `1.0000` (`100.00%`)**, **4-Class Scholarly Accuracy = `100.00%` (`14 / 14`)**, `ECE = 0.0827`, `Brier = 0.0134` (`~4.2s`), bắt trọn lỗi tráo tác giả Sutskever, tráo tạp chí Hóa lượng tử trên bài BERT, sai cơ quan ban hành `Luật Doanh nghiệp` (`Bộ Tài chính`), URL giả `.invalid`, DOI ghép chéo chimeric và phân loại chuẩn `Bộ luật Dân sự 91/2015/QH13` thành `RESOURCE`.

### 8.1. Kết quả Tổng hợp & Từng Nhãn trên Tập Chuẩn Đa Miền (`N = 120` Tham khảo Thô, `7` Chuẩn, `6` Lĩnh vực)

- **5-Class End-to-End (`N = 120`):** **Accuracy = `100.00%` (`120 / 120`)** · Macro-Precision = **`100.00%`** (`1.0000`) · Macro-Recall = **`100.00%`** (`1.0000`) · **Macro-F1 = `100.00%` (`1.0000`)** · `ECE = 0.0831` · `Brier = 0.0202` (`~8.6s`).
- **4-Class Scholarly (`N = 103`, tách riêng `17` mục `RESOURCE`):** **Accuracy = `100.00%` (`103 / 103`)** · Macro-Precision = **`100.00%`** (`1.0000`) · Macro-Recall = **`100.00%`** (`1.0000`) · **Macro-F1 = `100.00%` (`1.0000`)**.

| Nhãn Phán quyết (`5-Class Taxonomy`) | Số mẫu ($N$) | Precision | Recall | **F1-Score** | Hàng Ma trận Nhầm lẫn (`[VER, META, HAL, UNR, RES]`) & Ghi chú |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **`verified`** | `31` | **`100.00%`** (`1.0000`) | **`100.00%`** (`1.0000`) | **`100.00%`** (`1.0000`) | `[31, 0, 0, 0, 0]` — `31 / 31` công trình hợp lệ xác thực chính xác từ chuỗi thô |
| **`metadata_error`** | `30` | **`100.00%`** (`1.0000`) | **`100.00%`** (`1.0000`) | **`100.00%`** (`1.0000`) | `[0, 30, 0, 0, 0]` — bắt trọn `30 / 30` lỗi sai năm, tác giả, DOI, và tráo tạp chí (kể cả `BMJ` `E2E-031`) |
| **`suspected_hallucination`** | `28` | **`100.00%`** (`1.0000`) | **`100.00%`** (`1.0000`) | **`100.00%`** (`1.0000`) | `[0, 0, 28, 0, 0]` — bắt trọn `28 / 28` trích dẫn bịa đặt đa ngành |
| **`unresolved`** | `14` | **`100.00%`** (`1.0000`) | **`100.00%`** (`1.0000`) | **`100.00%`** (`1.0000`) | `[0, 0, 0, 14, 0]` — khoanh vùng chính xác `14 / 14` ca vùng biên / nghẽn API / DOI khu vực |
| **`resource`** | `17` | **`100.00%`** (`1.0000`) | **`100.00%`** (`1.0000`) | **`100.00%`** (`1.0000`) | `[0, 0, 0, 0, 17]` — phân tách chuẩn xác văn bản pháp luật VN, RFC, tài liệu kỹ thuật & web |

### 8.2. Độ Chính xác Đầu-Cuối Theo Chuẩn Trích dẫn (`7 Styles`) & Theo Lĩnh vực Học thuật (`6 Domains`)

| Phân tích Theo `7` Chuẩn Trích dẫn | Kết quả (`Accuracy`) | Phân tích Theo `6` Lĩnh vực (`20` mẫu/miền) | Kết quả (`Accuracy`) |
| :--- | :---: | :--- | :---: |
| **`APA 7th`** | **`100.00%`** (`24 / 24`) | **Computer Science & AI/NLP** | **`100.00%`** (`20 / 20`) |
| **`TDTU Vietnamese`** | **`100.00%`** (`21 / 21`) | **Biomedical & Clinical** | **`100.00%`** (`20 / 20`) |
| **`IEEE`** | **`100.00%`** (`18 / 18`) | **Economics, Finance & Social Sciences** | **`100.00%`** (`20 / 20`) |
| **`Vancouver`** | **`100.00%`** (`15 / 15`) | **Engineering & Physics** | **`100.00%`** (`20 / 20`) |
| **`Chicago`** | **`100.00%`** (`15 / 15`) | **Vietnamese Legal Statutes** | **`100.00%`** (`20 / 20`) |
| **`Harvard`** | **`100.00%`** (`14 / 14`) | **Technical Standards & Software** | **`100.00%`** (`20 / 20`) |
| **`MLA 9th`** | **`100.00%`** (`13 / 13`) | **Tổng cộng (`N = 120`)** | **`100.00%`** (`120 / 120`) |

---

## 9. Các Đe Dọa Đối Với Tính Hợp Lệ Nghiên Cứu (`Threats to Validity`)

Để đảm bảo tính trung thực và minh bạch khoa học cao nhất theo chuẩn mực thẩm định của **ACL / EMNLP / IEEE Transactions**, chúng tôi phân tích rõ bốn nhóm giới hạn phương pháp luận và biện pháp giảm thiểu đã triển khai:

1. **Tính hợp lệ Nội tại (*Internal Validity* — Bán tổng hợp so với Lỗi Sinh viên Tự nhiên):**
   - *Giới hạn:* Tập benchmark `120,000` mẫu được kiến tạo theo phương pháp **bán tổng hợp có kiểm soát (*controlled semi-synthetic perturbation*)** trên `120,000` bài báo thật thay vì `120,000` trích dẫn lỗi do con người gõ tay hoàn toàn (vốn không tồn tại tập dữ liệu công khai có gán nhãn ở quy mô $10^5$). Các quy tắc tạo nhiễu nếu thiết kế sơ sài có thể tạo ra lối tắt đặc trưng (*annotation artifacts*).
   - *Giảm thiểu:* Hệ thống đã loại bỏ hoàn toàn `np.clip` theo nhãn, loại bỏ hoàn toàn việc sàng lọc trước câu trích dẫn bằng stemmer nội bộ, khử trùng lặp tiêu đề chuẩn hóa trước khi chia tập (`0/0/0` chồng lấp), kích hoạt điểm đối sánh ngữ nghĩa đa câu `Sentence-BERT` trên **cả 4 nhãn** ($P(\text{VERIFIED} \mid \text{score} > 0) = 54.06\%$), đánh giá bất biến trên **12 mẫu câu học thuật tự nhiên (kể cả câu không có động từ tường thuật)** với đầy đủ danh sách tác giả / `First Author et al.`, và sử dụng ghép chéo tiêu đề học thuật cùng miền + tên học giả thật thay cho mẫu chuỗi giả lập. Ngoài ra, tập kiểm thử đầu-cuối trên chuỗi tham khảo thô và `310` tệp PDF thực tế bổ trợ trực tiếp cho đánh giá cấp đặc trưng.
2. **Tính hợp lệ Ngoại tại (*External Validity* — Độ tập trung Miền CS/NLP trong Kho Nội bộ `local_papers.db`):**
   - *Giới hạn:* Trong `129,137` bản ghi của kho SQLite FTS5 nội bộ (`data/local_papers.db`), có **`127,102` bài (`98.42%`) thuộc ACL Anthology** (Khoa học Máy tính, Xử lý Ngôn ngữ Tự nhiên & Trí tuệ Nhân tạo), chỉ có `1.58%` thuộc các lĩnh vực khác. Do đó, kết quả `99.67%` trên benchmark `120,000` mẫu phản ánh mạnh nhất đặc thù ngôn ngữ học thuật tiếng Anh ngành CS/NLP.
   - *Giảm thiểu:* Khi vận hành thực tế trên khóa luận đa ngành (Y sinh, Hóa học, Kinh tế, Luật Việt Nam, Nhân văn), `RetrievalOrchestrator` không phụ thuộc riêng vào `local_papers.db` mà truy vấn song song **15+ cơ sở dữ liệu liên ngành trực tuyến** (`Crossref`, `OpenAlex`, `Europe PMC`, `NCBI/bioRxiv`, `DOAJ`, `DataCite`, `OpenAIRE/HAL`, `OpenLibrary`, `Global DOI RA`, `VNLegalVerifier`). Hiệu năng đa ngành được kiểm chứng độc lập qua bộ `310` PDF thực tế (`12` chuẩn trích dẫn) và bộ chuẩn đầu-cuối đa miền (`N = 120`, đạt `100.00%`).
3. **Tính hợp lệ Cấu trúc (*Construct Validity* — Khoảng trống Abstract sau Tường phí & Phụ thuộc Tầng Phân tích PDF):**
   - *Giới hạn:* Nhiều bài báo xuất bản thương mại (Elsevier, Wiley, IEEE Xplore cũ) hoặc chỉ mục DBLP không mở công khai toàn văn `abstract` trên Crossref/DOI CSL, khiến tầng đối sánh ngữ nghĩa cấp độ câu phải bỏ qua kiểm chứng luận điểm. Bên cạnh đó, các lỗi tách dòng PDF phức tạp hoặc lỗi nhận diện của GROBID ở Thượng nguồn có thể lan truyền xuống tầng đối sánh.
   - *Giảm thiểu:* Hệ thống triển khai cơ chế làm giàu abstract chéo qua 9 nguồn mở (`_enrich_missing_abstract` trên OpenAlex, Semantic/EuropePMC, arXiv, DataCite, DOAJ, OpenAIRE) kết hợp kế thừa abstract/authors đồng thuận sang `known_papers`, và tuyệt đối không phạt trích dẫn hợp lệ khi nguồn thiếu abstract công khai (`has_substantive_abstract` guardrail).
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
.venv/bin/python -m pytest tests/unit/test_calibration.py tests/unit/test_baselines.py tests/unit/test_wave3_eval_scripts_and_configs.py tests/unit/test_ground_truth_e2e_evaluation.py tests/unit/test_four_pillar_bottleneck_optimization.py -q
```
