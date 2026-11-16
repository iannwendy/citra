# Báo Cáo Thực Nghiệm & Kiểm Định Mô Hình Neuro-Symbolic Quy Mô Lớn (120,000 Bài Báo Khoa Học)

> **Hệ thống:** CITRA (`SourceLogic` — Essay Integrity Checker v3.77.0)
> **Quy mô Benchmark:** `120,000` bài báo khoa học độc lập (`Train: 84,000` · `Validation: 18,000` · `Held-Out Test: 18,000`)
> **Phương pháp:** Strict Stratified Paper- & Normalized-Title-Disjoint Split (`70 / 15 / 15`, `0%` chồng lấp `paper_id` & tiêu đề chuẩn hóa) + Trích xuất đặc trưng thực tế không ép ngưỡng theo nhãn qua `Sentence-BERT (all-MiniLM-L6-v2)` & `RapidFuzz`
> **Artifacts xuất bản:**
> - Script huấn luyện & đánh giá: [`scripts/train_neuro_symbolic_model.py`](../../scripts/train_neuro_symbolic_model.py)
> - Trọng số `HybridMLScorer` & `PlattCalibrator`: [`data/models/neuro_symbolic_weights.json`](../../data/models/neuro_symbolic_weights.json)
> - Báo cáo JSON đầy đủ: [`data/models/neuro_symbolic_benchmark_report.json`](../../data/models/neuro_symbolic_benchmark_report.json)
> - Tóm tắt phân bố dữ liệu & mẫu thử: [`data/models/neuro_symbolic_dataset_summary.json`](../../data/models/neuro_symbolic_dataset_summary.json)

---

## 1. Quy Trình Phương Pháp Luận & Đối Chiếu Chuẩn Quốc Tế

Toàn bộ quy trình xây dựng tập dữ liệu, trích xuất đặc trưng, huấn luyện mô hình kết hợp (`HybridMLScorer`), hiệu chỉnh xác suất (`PlattCalibrator`) và kiểm định thống kê được thiết kế bám sát các công trình nền tảng quốc tế về kiểm chứng thông tin khoa học (*Scientific Fact Verification*), phát hiện ảo giác trích dẫn (*Citation Hallucination Detection*) và phân loại có chọn lọc (*Selective Classification with Abstention*):

| Khía cạnh Phương pháp luận | Quy trình Áp dụng trong Hệ thống CITRA (`120,000` mẫu) | Công trình Quốc tế Chuẩn mực Tham chiếu |
| :--- | :--- | :--- |
| **1. Phân tách Độc lập theo Bài báo & Tiêu đề (*Strict Stratified Paper- & Title-Disjoint Split*)** | Từ `129,125` bản ghi trong [`data/local_papers.db`](../../data/local_papers.db) (`128,105` bài báo hợp lệ sau khử trùng lặp khóa tiêu đề chuẩn hóa), hệ thống lấy mẫu phân tầng **`120,000` bài báo thực tế độc lập** (`80,000` bài có đầy đủ abstract `>80` ký tự + `40,000` bài có đầy đủ metadata thư mục) và chia tách **trước** khi sinh bất kỳ biến nhiễu hay ghép chéo nào:<br>• **Train (`70%`)**: `84,000` bài báo (`56,000` full-abstract + `28,000` metadata)<br>• **Validation (`15%`)**: `18,000` bài báo (`12,000` full-abstract + `6,000` metadata)<br>• **Held-Out Test (`15%`)**: `18,000` bài báo (`12,000` full-abstract + `6,000` metadata)<br>• Mọi phép biến đổi chéo bài báo (đổi tác giả, ghép tiêu đề chimeric, gán câu ngữ cảnh trái nghĩa) chỉ ghép các bài báo **nằm trong cùng một tập split**. | **SciFact** (*Wadden et al., EMNLP 2020*) & **FEVER** (*Thorne et al., NAACL 2018*) |
| **2. Phân bổ 100% Abstract thật cho Đối sánh Ngữ nghĩa** | Trong mỗi tập split, `66.7%` số bài báo có full abstract (`>80` ký tự) được phân bổ toàn bộ cho các phân nhóm cần tính điểm tương đồng ngữ nghĩa giữa câu trích dẫn và abstract (`VERIFIED` `36%` + `METADATA_ERROR` `22%` + `H4` `7.5%` = `65.5%` tổng số mẫu). Các phân nhóm `H1–H3` và `U1–U2` (`context_aligned_mode = "none"`) sử dụng phần bài báo còn lại trong cùng split. | **SciCite** (*Cohan et al., NAACL 2019*) & **ACL-ARC** (*Jurgens et al., TACL 2018*) |
| **3. Hệ phân loại 4 Nhãn Chính & 15 Phân nhóm Lỗi (*15 Sub-Taxonomies*)** | Mô hình hóa đầy đủ 4 trạng thái phán quyết hỗ trợ ra quyết định:<br>• `VERIFIED` (`43,200` mẫu — `36%`): `V1`–`V4` (`10,800` mẫu/nhóm)<br>• `SUSPECTED_HALLUCINATION` (`36,000` mẫu — `30%`): `H1`–`H4` (`9,000` mẫu/nhóm)<br>• `METADATA_ERROR` (`26,400` mẫu — `22%`): `M1`–`M5` (`5,280` mẫu/nhóm)<br>• `UNRESOLVED / ABSTENTION` (`14,400` mẫu — `12%`): `U1` (`9,600`), `U2` (`4,800`) | **Walters & Wilder** (*Scientific Reports, 2023*), **ALCE** (*Gao et al., EMNLP 2023*), **Selective Prediction** (*Chow, 1970; Geifman & El-Yaniv, NeurIPS 2017*) |
| **4. Trích xuất Đặc trưng Thực tế Không Cắt Ngưỡng (*Zero Label-Conditioned Clamping*)** | Không sinh số ngẫu nhiên và không ép khoảng `np.clip` theo nhãn đích. Hệ thống tạo chuỗi văn bản thực tế `(CitedReference, RetrievedCandidate)` và mã hóa **`317,017` câu/tiêu đề duy nhất** (từ `480,000` chuỗi thành phần) bằng **`Sentence-BERT (all-MiniLM-L6-v2)`** trên GPU (`mps`), kết hợp `FuzzyMatcher.token_set_ratio`, `author_match_score` và `VenueNormalizer.similarity`. | **Sentence-BERT** (*Reimers & Gurevych, EMNLP 2019*) |
| **5. Tối ưu Siêu tham số & Hiệu chỉnh Xác suất Hậu nghiệm (*Post-Hoc Calibration*)** | • Trọng số hồi quy logistic đa lớp (`HybridMLScorer`) được học hoàn toàn trên tập **Train (`84,000` mẫu)**.<br>• Siêu tham số điều chuẩn L2 $C \in \{0.1, 0.25, 0.5, 1.0, 2.0, 5.0, 10.0\}$ ($C^* = 10.0$, `Val Macro-F1 = 0.9968`) và cặp tham số hiệu chỉnh **Logit-Space Platt Scaling** ($a = 1.799982, b = 0.898759$) được khớp hoàn toàn trên tập **Validation (`18,000` mẫu)** để chống quá khớp (*overfitting*). | **Platt Scaling** (*Platt, 1999*) & **On Calibration of Modern Neural Networks** (*Guo et al., ICML 2017*) |
| **6. Kiểm định Ý nghĩa Thống kê (*Non-Parametric Bootstrap CI*)** | Đánh giá một lần duy nhất trên tập **Held-Out Test (`18,000` mẫu)** kèm lấy mẫu lại phi tham số $B = 1,000$ lần (*Bootstrap Resampling*) để xác định khoảng tin cậy 95% (`95% CI`) và sai số chuẩn (`SE`) cho `Accuracy`, `Macro-F1`, `ECE` và `Brier Score`. | **Dror et al.** (*ACL 2018 — Statistical Significance in NLP*) & **Efron & Tibshirani** (*1993*) |

> [!NOTE]
> **Ghi chú Minh bạch Phương pháp luận Thực nghiệm (`Zero-Leakage, Zero-Clamping & Authentic Grey-Zone Alignment`):**
> 1. **Khử trùng lặp tiêu đề chuẩn hóa trước khi chia tập (`Pre-Split Normalized-Title Deduplication`):** `scripts/train_neuro_symbolic_model.py` khử trùng lặp cả `paper_id` lẫn khóa tiêu đề chuẩn hóa (`_normalize_title_key`) trước bước chia `70 / 15 / 15`, đảm bảo `0` bài báo (`train_val_overlap = 0`, `train_test_overlap = 0`, `val_test_overlap = 0`) và `0` tiêu đề trùng lặp (`train_val_title_overlap = 0`, `train_test_title_overlap = 0`, `val_test_title_overlap = 0`) giữa `Train`, `Validation` và `Test`.
> 2. **Loại bỏ hoàn toàn ép khoảng theo nhãn đích & Đồng bộ vùng xám `U1/U2` thực tế (`Zero Label-Conditioned Clamping`):** Hàm `build_split_dataset` giữ nguyên 100% điểm số thực tế tính từ `FuzzyMatcher.token_set_ratio`, `Sentence-BERT` cosine similarity, `author_match_score` và `VenueNormalizer.similarity` mà không dùng `np.clip` theo `true_label`. Phân nhóm `U1` (`9,600` mẫu) mô phỏng bản thảo đổi tên từ preprint / dịch tiêu đề biên bảo toàn tác giả chính (`author_jaccard >= 0.20`, `year_distance in {0, 1, 2}`), còn `U2` (`4,800` mẫu) mô phỏng DOI khu vực chưa có CSL (`10.11499/*`, `10.5109/*` — `doi_ra_status = "registered_no_csl"`) và kịch bản nghẽn tần suất HTTP 429 (`api_exhausted = True`).
> 3. **Đối chiếu hai bảng đánh giá dưới đây:** Bảng 5.1 đối chiếu các baseline bằng bộ luật xấp xỉ cấp đặc trưng trong `BaselineRunner` (`Proposed` đạt **`98.03%` Accuracy / `0.9807` Macro-F1**, `B5` `HybridMLScorer` 16D đạt **`99.68%` Accuracy / `0.9965` Macro-F1**), trong khi các Bảng 5.2–5.5 đánh giá trực tiếp bộ luật sản xuất đầy đủ `SymbolicRules + HybridMLScorer + PlattCalibrator` (**`Overall Accuracy = 97.79%`**, **`Macro-F1 = 0.9722`**, **`ECE = 0.0326`**, **`Brier = 0.0184`**), bảo toàn nguyên vẹn luật phòng vệ `is_semantic_only_noise` (`100.00%` Recall trên `SUSPECTED_HALLUCINATION`, `0` bài giả mạo lọt thành `VERIFIED`, `0` bài hợp lệ `VERIFIED` bị cáo buộc oan là ảo giác).

---

## 2. Nguồn Gốc Tập Dữ Liệu (`Corpus Provenance`) & Kiểm Định Chống Rò Rỉ (`Leakage Audit`)

### 2.1. Thống kê Kho Tri thức Học thuật Nội bộ (`data/local_papers.db`)

| Chỉ số Thống kê Nguồn Dữ liệu | Số lượng Bài báo | Tỷ lệ / Ghi chú |
| :--- | :---: | :--- |
| Tổng số bản ghi trong `data/local_papers.db` (`total_papers_in_db`) | `129,125` | ACL Anthology & các công trình khoa học đa lĩnh vực |
| Tổng số bài báo hợp lệ duy nhất theo khóa tiêu đề (`total_valid_scholarly_papers`) | `128,105` | `99.21%` tổng kho dữ liệu (khử trùng lặp tiêu đề chuẩn hóa) |
| Số bài báo có đầy đủ `abstract` dài (`> 80` ký tự, `eligible_with_full_abstract`) | `82,874` | Đủ điều kiện đối sánh ngữ nghĩa cấp độ câu |
| Số bài báo có đầy đủ metadata thư mục (`eligible_metadata_only`) | `45,231` | Các bài hội nghị ACL/COLING/LREC/EMNLP lưu trữ metadata |
| **Tổng số bài báo lấy mẫu cho Benchmark (`sampled_total`)** | **`120,000`** | **`80,000` bài full-abstract + `40,000` bài metadata-complete** |

### 2.2. Kiểm định Phân tách Độc lập (`Strict Paper- & Title-Disjoint Split & Zero-Leakage Audit`)

| Tập Dữ liệu (`Split`) | Tỷ lệ | Tổng số Bài báo Độc lập | Bài báo có Full Abstract (`66.7%`) | Bài báo Metadata-Complete (`33.3%`) | Số câu/tiêu đề duy nhất mã hóa SBERT | Kiểm định Giao tập (`paper_id` & `norm_title`) |
| :--- | :---: | :---: | :---: | :---: | :---: | :--- |
| **Train Split** | `70.0%` | **`84,000`** | `56,000` | `28,000` | `221,610` | `\|Train ∩ Val\| = 0` (`ID` & `Title`) |
| **Validation Split** | `15.0%` | **`18,000`** | `12,000` | `6,000` | `47,703` | `\|Train ∩ Test\| = 0` (`ID` & `Title`) |
| **Held-Out Test Split** | `15.0%` | **`18,000`** | `12,000` | `6,000` | `47,704` | `\|Val ∩ Test\| = 0` (`ID` & `Title`) |
| **Tổng cộng** | **`100.0%`** | **`120,000`** | **`80,000`** | **`40,000`** | **`317,017`** | **`zero_leakage_verified = True`** |

---

## 3. Phân Bố 4 Nhãn Chính & 15 Phân Nhóm Lỗi (`15 Sub-Taxonomies`)

| Nhãn Chính (`Canonical Class`) | Mã Phân nhóm | Mô tả Kịch bản Trích dẫn Thực tế & Lỗi Học thuật | Train (`70%`) | Val (`15%`) | Test (`15%`) | **Tổng (`100%`)** |
| :--- | :---: | :--- | :---: | :---: | :---: | :---: |
| **`VERIFIED`**<br>*(36.0% — 43,200 mẫu)* | **`V1`** | Trích dẫn chuẩn xác hoàn toàn (`title`, `authors`, `year`, `venue`, `DOI`) | `7,560` | `1,620` | `1,620` | **`10,800`** |
| | **`V2`** | Rút gọn danh sách tác giả (`First Author et al.`, viết tắt tên) & lệch $\pm 1$ năm Online-First vs. Print | `7,560` | `1,620` | `1,620` | **`10,800`** |
| | **`V3`** | Lược bỏ phụ đề sau dấu `:` (*subtitle truncation*) hoặc biến thể dấu câu nhỏ | `7,560` | `1,620` | `1,620` | **`10,800`** |
| | **`V4`** | Nhiễu OCR ký tự / gạch nối PDF + cứu hộ ngữ nghĩa bằng `R-CONTENT-ALIGNMENT` | `7,560` | `1,620` | `1,620` | **`10,800`** |
| **`SUSPECTED_HALLUCINATION`**<br>*(30.0% — 36,000 mẫu)* | **`H1`** | Bịa đặt hoàn toàn (*Complete Fabrication*) $\rightarrow$ `0` ứng viên trên mọi cơ sở dữ liệu (`R-NO-SCHOLARLY-RECORD`) | `6,300` | `1,350` | `1,350` | **`9,000`** |
| | **`H2`** | Trích dẫn *Chimeric* do LLM ghép từ khóa chuyên ngành + ứng viên nhiễu rất yếu (`R-HALLUCINATED-SOURCE`) | `6,300` | `1,350` | `1,350` | **`9,000`** |
| | **`H3`** | DOI giả mạo (`10.9999/fake.*`) hoặc DOI không tồn tại (`R-FABRICATED-DOI`, `R-NONEXISTENT-DOI`) | `6,300` | `1,350` | `1,350` | **`9,000`** |
| | **`H4`** | Liên kết chết (`HTTP 404` / tên miền giả RFC 2606 `R-FAKE-URL`, `R-DEAD-URL`) | `6,300` | `1,350` | `1,350` | **`9,000`** |
| **`METADATA_ERROR`**<br>*(22.0% — 26,400 mẫu)* | **`M1`** | Sai năm xuất bản ($|\Delta\text{year}| \in \{2, 3, 4, 5, 6, 8\}$ năm) nhưng khớp đúng tiêu đề và tác giả | `3,696` | `792` | `792` | **`5,280`** |
| | **`M2`** | Sai hoặc nhầm lẫn danh sách đồng tác giả (*author swap / wrong co-authors*) với tiêu đề khớp cao | `3,696` | `792` | `792` | **`5,280`** |
| | **`M3`** | DOI hợp lệ và phân giải thành công nhưng tiêu đề trích dẫn bị biến dạng (`R-DOI-TITLE-MISMATCH`) | `3,696` | `792` | `792` | **`5,280`** |
| | **`M4`** | Biến đổi tiêu đề mức trung bình trên nguồn đơn lẻ không có DOI (`R-SINGLE-SOURCE-PARTIAL`) | `3,696` | `792` | `792` | **`5,280`** |
| | **`M5`** | Sai lệch tổ hợp đa trường (`author + year + title`) hoặc ngoại lệ `R-DOMAIN-EXCEPTION` (DOI khớp $\ge 2$ nguồn nhưng tiêu đề sai lệch nặng) | `3,696` | `792` | `792` | **`5,280`** |
| **`UNRESOLVED`**<br>*(12.0% — 14,400 mẫu)* | **`U1`** | Bản thảo đổi tên từ preprint / dịch tiêu đề vùng biên có trùng tác giả chính (`author_jaccard >= 0.20`, `R-ABSTENTION-BORDER`) | `6,720` | `1,440` | `1,440` | **`9,600`** |
| | **`U2`** | DOI khu vực chưa có CSL (`10.11499/*`, `10.5109/*` — `R-DOI-RA-NO-CSL`) & nghẽn tần suất API HTTP 429 (`R-RATE-LIMITED-ABSTAIN`) | `3,360` | `720` | `720` | **`4,800`** |
| **Tổng cộng** | **15 Nhóm** | **Đầy đủ phổ kịch bản xác thực trích dẫn khoa học** | **`84,000`** | **`18,000`** | **`18,000`** | **`120,000`** |

---

## 4. Không Gian Đặc Trưng 16 Chiều & Tối Ưu Siêu Tham Số (`Hyperparameter Tuning`)

### 4.1. Vector Đặc trưng Tương tác Neuro-Symbolic 16 Chiều (`HybridMLScorer.FEATURE_NAMES`)
1. `title_sim_fuzzy`: Độ tương đồng từ vựng tiêu đề (`RapidFuzz token_set_ratio`).
2. `title_sim_semantic`: Độ tương đồng ngữ nghĩa tiêu đề (`Sentence-BERT cosine similarity`).
3. `title_sim_max`: $\max(\text{title\_sim\_fuzzy}, \text{title\_sim\_semantic})$.
4. `author_jaccard`: Độ khớp tập hợp họ tên tác giả đã chuẩn hóa (`author_match_score`).
5. `year_match_score`: Điểm khớp năm suy giảm hàm mũ $\exp(-0.5 \cdot \min(|\Delta\text{year}|, 10))$.
6. `doi_exact_match`: Chỉ báo khớp chính xác định danh DOI ($\{0, 1\}$).
7. `source_consensus_norm`: Mức độ đồng thuận liên nguồn chuẩn hóa $\min(\text{consensus}, 4) / 4.0$.
8. `venue_sim`: Độ tương đồng tên tạp chí/hội nghị (`VenueNormalizer`).
9. `content_alignment_signal`: Tín hiệu đối sánh ngữ nghĩa câu trích dẫn – abstract từ tầng Neural (`Sentence-BERT`).
10. `has_candidate`: Chỉ báo có ứng viên trả về từ các cơ sở dữ liệu học thuật ($\{0, 1\}$).
11. `title_x_author`: Đặc trưng tương tác phi tuyến $\text{title\_sim\_max} \times \text{author\_jaccard}$.
12. `title_x_year`: Đặc trưng tương tác phi tuyến $\text{title\_sim\_max} \times \text{year\_match\_score}$.
13. `title_mismatch_author`: Tín hiệu xung đột tiêu đề đúng nhưng sai tác giả $\mathbb{I}(\text{title} \ge 0.60) \cdot \text{title} \cdot (1 - \text{author})$.
14. `title_mismatch_year`: Tín hiệu xung đột tiêu đề đúng nhưng sai năm $\mathbb{I}(\text{title} \ge 0.60) \cdot \text{title} \cdot (1 - \text{year\_match})$.
15. `doi_mismatch_title`: Tín hiệu xung đột DOI khớp nhưng tiêu đề sai lệch $\text{doi\_ok} \cdot (1 - \text{title\_sim\_max})$.
16. `abstention_zone_indicator`: Chỉ báo rơi vào vùng biên từ chối phán quyết (biên `title_sim` kèm trùng tác giả một phần hoặc thiếu CSL/nghẽn tần suất API).

### 4.2. Kết quả Grid Search Hệ số Điều chuẩn L2 ($C$) trên Tập Validation ($N = 18,000$)

| Giá trị $C$ ứng viên | `0.1` | `0.25` | `0.5` | `1.0` | `2.0` | `5.0` | **`10.0` *(Được chọn)*** |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Validation Macro-F1** | `0.9918` | `0.9934` | `0.9946` | `0.9953` | `0.9961` | `0.9968` | **`0.9968`** |

- **Tham số kết hợp Symbolic – ML (`symbolic_blend_alpha`):** $\alpha = 0.72$ ($S_{\text{blend}} = 0.72 \cdot C_{\text{symbolic}} + 0.28 \cdot P_{\text{ML}}(y_{\text{sym}} \mid \mathbf{x})$).
- **Tham số Platt Scaling khớp trên tập Validation ($N = 18,000$):** $a = 1.799982$, $b = 0.898759$ ($P_{\text{cal}} = \sigma(1.8000 \cdot \text{logit}(S_{\text{blend}}) + 0.8988)$).

---

## 5. Kết Quả Thực Nghiệm Trên Tập Held-Out Test ($N = 18,000$ Bài Báo Độc Lập)

### 5.1. Nghiên cứu Cắt bỏ & Đối sánh Baseline (`Ablation Study`)

| Phương pháp / Baseline | Mô tả Cơ chế Quyết định | Accuracy | Macro-Precision | Macro-Recall | **Macro-F1** |
| :--- | :--- | :---: | :---: | :---: | :---: |
| **`B0` (`doi_only`)** | Chỉ xác thực khi có DOI khớp chính xác | `30.06%` | `0.2357` | `0.3754` | `0.2205` |
| **`B3` (`embedding_only`)** | Thuần ngữ nghĩa `Sentence-BERT` cosine similarity trên tiêu đề | `68.04%` | `0.5129` | `0.5359` | `0.4820` |
| **`B1` (`single_source_crossref`)** | Chỉ tra cứu đơn nguồn trên `Crossref` | `66.71%` | `0.5870` | `0.5528` | `0.5282` |
| **`B4` (`no_calibration`)** | Tổ hợp tuyến tính đa đặc trưng, tắt vùng abstention (`UNRESOLVED`) | `79.03%` | `0.6051` | `0.6483` | `0.6129` |
| **`B2` (`fuzzy_only`)** | Chỉ dùng so khớp từ vựng `RapidFuzz` tiêu đề + `AuthorJaccard` | `80.96%` | `0.6189` | `0.6703` | `0.6346` |
| **`Proposed` (`Neuro-Symbolic`)** | **Đồng thuận Đa nguồn + Đối sánh Ngữ nghĩa Abstract + Kiểm tra Link HTTP + Luật Symbolic + Abstention** | **`98.03%`** | **`0.9840`** | **`0.9779`** | **`0.9807`** |
| **`B5` (`ml_hybrid`)** | `HybridMLScorer` (Multinomial Logistic Regression 16D, $C = 10.0$) | **`99.68%`** | **`0.9963`** | **`0.9967`** | **`0.9965`** |

### 5.2. Hiệu năng Chi tiết Từng Nhãn của Bộ Luật Sản xuất (`SymbolicRules` + `HybridMLScorer` + `PlattCalibrator`)

| Nhãn Phán quyết (`ValidationLabel`) | Số mẫu Test ($N$) | Precision | Recall | **F1-Score** | Ý nghĩa Thực tiễn & Cơ chế Bảo vệ Học thuật |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **`VERIFIED`** | `6,480` | **`0.9896`** | **`0.9977`** | **`0.9936`** | **`0` ca giả mạo (`SUSPECTED_HALLUCINATION`) hoặc `UNRESOLVED` bị gán nhầm thành `VERIFIED`**; **`0` bài hợp lệ (`VERIFIED`) bị kết luận oan là `SUSPECTED_HALLUCINATION`** (`6,465 / 6,480` đúng tuyệt đối, `10` ca biến dạng tiêu đề kèm DOI chuyển sang `METADATA_ERROR`, `5` ca chuyển sang `UNRESOLVED`). |
| **`SUSPECTED_HALLUCINATION`** | `5,400` | **`0.9740`** | **`1.0000`** | **`0.9868`** | Bắt trọn **`5,400 / 5,400` (`100.00%` Recall)** trích dẫn ảo giác/bịa đặt với **`97.40%` Precision** nhờ bảo toàn nghiêm ngặt `is_semantic_only_noise` trên các trích dẫn chimeric `author_jaccard = 0`. |
| **`METADATA_ERROR`** | `3,960` | **`0.9915`** | **`0.9091`** | **`0.9485`** | Đạt **99.15% Precision** trên các lỗi sai năm (`M1`), sai tác giả (`M2`), lệch tiêu đề (`M3`, `M4`). `150` ca biến dạng đa trường không có DOI được chuyển thận trọng sang `UNRESOLVED`. |
| **`UNRESOLVED` *(Abstention)*** | `2,160` | **`0.9324`** | **`0.9894`** | **`0.9600`** | Khoanh vùng chính xác **`2,137 / 2,160` (`98.94%` Recall)** ca vùng xám thực tế (`U1` trùng tác giả chính ở biên `title_sim` `R-ABSTENTION-BORDER`, `U2` DOI khu vực `R-DOI-RA-NO-CSL` và nghẽn API `R-RATE-LIMITED-ABSTAIN`). |
| **Trung bình Vĩ mô / Tổng (`Macro / Total`)** | **`18,000`** | **`0.9719`** | **`0.9740`** | **`0.9722`** | **Overall Accuracy: `97.79%`** (`17,602 / 18,000` mẫu phân loại khớp nhãn gốc hoàn toàn trên đặc trưng thực tế không cắt ngưỡng). |

### 5.3. Ma trận Nhầm lẫn (`4×4 Confusion Matrix` trên $N = 18,000$ Mẫu Test)

| Nhãn Thực tế (`Gold`) \ Dự đoán (`Pred`) | Dự đoán: `VERIFIED` | Dự đoán: `METADATA_ERROR` | Dự đoán: `SUSPECTED_HALLUCINATION` | Dự đoán: `UNRESOLVED` | **Tổng Thực tế (`Support`)** |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Thực tế: `VERIFIED`** | **`6,465`** | `10` | `0` | `5` | `6,480` |
| **Thực tế: `METADATA_ERROR`** | `68` | **`3,600`** | `142` | `150` | `3,960` |
| **Thực tế: `SUSPECTED_HALLUCINATION`** | `0` | `0` | **`5,400`** | `0` | `5,400` |
| **Thực tế: `UNRESOLVED`** | `0` | `21` | `2` | **`2,137`** | `2,160` |

### 5.4. Hiệu quả Hiệu chỉnh Xác suất (`Logit-Space Platt Scaling`) & Đường cong `Coverage–Accuracy`

| Cấu hình Độ tin cậy | Macro-F1 | **ECE** *(Expected Calibration Error)* | **Brier Score** | Acc @ `50%` Cov | Acc @ `70%` Cov | Acc @ `90%` Cov | Acc @ `95%` Cov | Acc @ `100%` Cov |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Chưa hiệu chỉnh (`Uncalibrated Raw`)** | `0.9722` | `0.2045` | `0.0902` | `97.96%` | `98.22%` | `98.40%` | `98.49%` | `97.79%` |
| **Đã hiệu chỉnh (`Platt-Calibrated`)** | **`0.9722`** | **`0.0326`** *(↓ **6.27×** / `-84.1%`)* | **`0.0184`** *(↓ **4.90×** / `-79.6%`)* | **`99.74%`** | **`98.60%`** | **`98.77%`** | **`98.70%`** | **`97.79%`** |

### 5.5. Khoảng Tin cậy 95% Bootstrap Phi tham số ($B = 1,000$ Resamples trên $N = 18,000$)

| Chỉ số Đánh giá (`Metric`) | Giá trị Điểm (`Point Estimate`) | Trung bình Bootstrap (`Mean`) | Sai số Chuẩn (`Std. Error`) | **Khoảng Tin cậy 95% (`95% CI Lower – Upper`)** |
| :--- | :---: | :---: | :---: | :---: |
| **Overall Accuracy** | `0.9779` (`97.79%`) | `0.9778` | `±0.0011` | **`[0.9757, 0.9801]`** (`97.57% – 98.01%`) |
| **Macro-F1 Score** | `0.9722` | `0.9722` | `±0.0015` | **`[0.9695, 0.9750]`** |
| **Expected Calibration Error (`ECE`)** | `0.0326` | `0.0326` | `±0.0010` | **`[0.0305, 0.0345]`** |
| **Brier Score** | `0.0184` | `0.0185` | `±0.0008` | **`[0.0169, 0.0201]`** |

---

## 6. Kết Luận Khoa Học (Trích Xuất Cho Báo Cáo Khóa Luận / Bài Báo)

1. **Sự thất bại của cách tiếp cận thuần Neural (`B3`, `Accuracy = 68.04%`, `Macro-F1 = 0.4820`) trước ảo giác trích dẫn của LLM:**
   Khi các mô hình ngôn ngữ lớn (LLM) tạo ra các trích dẫn giả mạo kiểu *chimeric* (ghép nối các thuật ngữ chuyên ngành có thật từ nhiều bài báo khác nhau), độ tương đồng ngữ nghĩa `Sentence-BERT` trên tiêu đề vẫn đạt mức trung bình – cao, đồng thời bỏ qua hoàn toàn sai lệch về năm xuất bản, danh sách tác giả và trạng thái liên kết. Do đó, sử dụng đơn độc mô hình embedding không thể phân biệt được trích dẫn bịa đặt tinh vi với lỗi biên tập thư mục.
2. **Hạn chế của tra cứu đơn nguồn (`B1`, `Accuracy = 66.71%`, `Macro-F1 = 0.5282`) và thiếu cơ chế từ chối phán quyết (`B4`, `Accuracy = 79.03%`, `Macro-F1 = 0.6129`):**
   Chỉ dựa vào một cơ sở dữ liệu duy nhất như Crossref sẽ bỏ sót lượng lớn bài báo hội nghị Khoa học Máy tính (DBLP/ACL), bản thảo arXiv, sách chuyên khảo (OpenLibrary) hoặc tài liệu kỹ thuật/pháp lý, dẫn đến nguy cơ kết luận oan trích dẫn hợp lệ là ảo giác. Mặt khác, việc ép hệ thống luôn đưa ra phán quyết cứng mà không có vùng `UNRESOLVED` (`B4`) làm suy giảm độ tin cậy ở vùng biên.
3. **Ưu thế vượt trội và tính an toàn học thuật của kiến trúc Lai ghép Neuro-Symbolic (`Proposed` & `B5`):**
   Trên tập kiểm thử độc lập `18,000` bài báo hoàn toàn không ép ngưỡng đặc trưng, bộ phân loại học máy 16 chiều **`HybridMLScorer` (`B5`) đạt `99.68%` Accuracy (`Macro-F1 = 0.9965`)**, `BaselineRunner` `Proposed` đạt **`98.03%` Accuracy (`Macro-F1 = 0.9807`)**, và bộ luật sản xuất đầy đủ **`SymbolicRules + HybridMLScorer + PlattCalibrator` đạt `97.79%` Accuracy (`Macro-F1 = 0.9722`, `99.36%` F1 trên `VERIFIED`, `94.85%` F1 trên `METADATA_ERROR`, `96.00%` F1 trên `UNRESOLVED`, `100.00%` Recall / `98.68%` F1 trên `SUSPECTED_HALLUCINATION`)** — bảo toàn hai bất biến an toàn quan trọng nhất: **`0 / 6,480` bài báo hợp lệ bị cáo buộc nhầm là ảo giác** và **`0 / 5,400` trích dẫn bịa đặt lọt lưới thành `VERIFIED`**.
4. **Hiệu quả của Hiệu chỉnh Xác suất Hậu nghiệm (`Logit-Space Platt Scaling`):**
   Việc kết hợp xác suất đa lớp từ `HybridMLScorer` với điểm tin cậy của `SymbolicRules` và hiệu chỉnh qua `PlattCalibrator` ($a = 1.799982, b = 0.898759$) giúp giảm **84.1% sai số hiệu chỉnh kỳ vọng** (`ECE` giảm `6.27×` từ `0.2045` xuống **`0.0326`**) và giảm **79.6% sai số bình phương trung bình** (`Brier Score` giảm `4.90×` từ `0.0902` xuống **`0.0184`**), nâng độ chính xác tại ngưỡng bao phủ `50%` phán quyết tự tin nhất từ `97.96%` lên **`99.74%`** (`98.70%` tại `95%` độ bao phủ).

---

## 7. Lệnh Tái Lập Thực Nghiệm (`Reproducibility`)

```bash
# Chạy toàn bộ quy trình huấn luyện, hiệu chỉnh Platt và đánh giá Benchmark 120,000 bài báo
.venv/bin/python scripts/train_neuro_symbolic_model.py

# Chạy bộ kiểm thử tự động xác nhận tính toàn vẹn của trọng số và kiểm định Zero-Leakage
.venv/bin/python -m pytest tests/unit/test_calibration.py tests/unit/test_baselines.py -q
```
