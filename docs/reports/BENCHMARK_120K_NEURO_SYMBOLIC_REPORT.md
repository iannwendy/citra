# Báo Cáo Thực Nghiệm & Kiểm Định Mô Hình Neuro-Symbolic Quy Mô Lớn (120,000 Bài Báo Khoa Học)

> **Hệ thống:** CITRA (`SourceLogic` — Essay Integrity Checker v2.3)
> **Quy mô Benchmark:** `120,000` bài báo khoa học độc lập (`Train: 84,000` · `Validation: 18,000` · `Held-Out Test: 18,000`)
> **Phương pháp:** Strict Stratified Paper-Disjoint Split (`70 / 15 / 15`, `0%` chồng lấp bài báo) + Trích xuất đặc trưng thực tế qua `Sentence-BERT (all-MiniLM-L6-v2)` & `RapidFuzz`
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
| **1. Phân tách Độc lập theo Bài báo (*Strict Stratified Paper-Disjoint Split*)** | Từ `128,717` bản ghi trong [`data/local_papers.db`](../../data/local_papers.db) (`127,980` bài báo hợp lệ), hệ thống lấy mẫu phân tầng **`120,000` bài báo thực tế độc lập** (`80,000` bài có đầy đủ abstract `>80` ký tự + `40,000` bài có đầy đủ metadata thư mục) và chia tách **trước** khi sinh bất kỳ biến nhiễu hay ghép chéo nào:<br>• **Train (`70%`)**: `84,000` bài báo (`56,000` full-abstract + `28,000` metadata)<br>• **Validation (`15%`)**: `18,000` bài báo (`12,000` full-abstract + `6,000` metadata)<br>• **Held-Out Test (`15%`)**: `18,000` bài báo (`12,000` full-abstract + `6,000` metadata)<br>• Mọi phép biến đổi chéo bài báo (đổi tác giả, ghép tiêu đề chimeric, gán câu ngữ cảnh trái nghĩa) chỉ ghép các bài báo **nằm trong cùng một tập split**. | **SciFact** (*Wadden et al., EMNLP 2020*) & **FEVER** (*Thorne et al., NAACL 2018*) |
| **2. Phân bổ 100% Abstract thật cho Đối sánh Ngữ nghĩa** | Trong mỗi tập split, `66.7%` số bài báo có full abstract (`>80` ký tự) được phân bổ toàn bộ cho các phân nhóm cần tính điểm tương đồng ngữ nghĩa giữa câu trích dẫn và abstract (`VERIFIED` `36%` + `METADATA_ERROR` `22%` + `H4` `7.5%` = `65.5%` tổng số mẫu). Các phân nhóm `H1–H3` và `U1–U2` (`context_aligned_mode = "none"`) sử dụng phần bài báo còn lại trong cùng split. | **SciCite** (*Cohan et al., NAACL 2019*) & **ACL-ARC** (*Jurgens et al., TACL 2018*) |
| **3. Hệ phân loại 4 Nhãn Chính & 15 Phân nhóm Lỗi (*15 Sub-Taxonomies*)** | Mô hình hóa đầy đủ 4 trạng thái phán quyết hỗ trợ ra quyết định:<br>• `VERIFIED` (`43,200` mẫu — `36%`): `V1`–`V4` (`10,800` mẫu/nhóm)<br>• `SUSPECTED_HALLUCINATION` (`36,000` mẫu — `30%`): `H1`–`H4` (`9,000` mẫu/nhóm)<br>• `METADATA_ERROR` (`26,400` mẫu — `22%`): `M1`–`M5` (`5,280` mẫu/nhóm)<br>• `UNRESOLVED / ABSTENTION` (`14,400` mẫu — `12%`): `U1` (`9,600`), `U2` (`4,800`) | **Walters & Wilder** (*Scientific Reports, 2023*), **ALCE** (*Gao et al., EMNLP 2023*), **Selective Prediction** (*Chow, 1970; Geifman & El-Yaniv, NeurIPS 2017*) |
| **4. Trích xuất Đặc trưng Thực tế (*Zero Synthetic Similarity Numbers*)** | Không sinh số ngẫu nhiên cho điểm tương đồng. Hệ thống tạo chuỗi văn bản thực tế `(CitedReference, RetrievedCandidate)` và mã hóa **`323,848` câu/tiêu đề duy nhất** (từ `480,000` chuỗi thành phần) bằng **`Sentence-BERT (all-MiniLM-L6-v2)`** trên GPU (`mps`), kết hợp `FuzzyMatcher.token_set_ratio`, `author_match_score` và `VenueNormalizer.similarity`. | **Sentence-BERT** (*Reimers & Gurevych, EMNLP 2019*) |
| **5. Tối ưu Siêu tham số & Hiệu chỉnh Xác suất Hậu nghiệm (*Post-Hoc Calibration*)** | • Trọng số hồi quy logistic đa lớp (`HybridMLScorer`) được học hoàn toàn trên tập **Train (`84,000` mẫu)**.<br>• Siêu tham số điều chuẩn L2 $C \in \{0.1, 0.25, 0.5, 1.0, 2.0, 5.0, 10.0\}$ và cặp tham số hiệu chỉnh **Logit-Space Platt Scaling** ($a, b$) được khớp hoàn toàn trên tập **Validation (`18,000` mẫu)** để chống quá khớp (*overfitting*). | **Platt Scaling** (*Platt, 1999*) & **On Calibration of Modern Neural Networks** (*Guo et al., ICML 2017*) |
| **6. Kiểm định Ý nghĩa Thống kê (*Non-Parametric Bootstrap CI*)** | Đánh giá một lần duy nhất trên tập **Held-Out Test (`18,000` mẫu)** kèm lấy mẫu lại phi tham số $B = 1,000$ lần (*Bootstrap Resampling*) để xác định khoảng tin cậy 95% (`95% CI`) và sai số chuẩn (`SE`) cho `Accuracy`, `Macro-F1`, `ECE` và `Brier Score`. | **Dror et al.** (*ACL 2018 — Statistical Significance in NLP*) & **Efron & Tibshirani** (*1993*) |

---

## 2. Nguồn Gốc Tập Dữ Liệu (`Corpus Provenance`) & Kiểm Định Chống Rò Rỉ (`Leakage Audit`)

### 2.1. Thống kê Kho Tri thức Học thuật Nội bộ (`data/local_papers.db`)

| Chỉ số Thống kê Nguồn Dữ liệu | Số lượng Bài báo | Tỷ lệ / Ghi chú |
| :--- | :---: | :--- |
| Tổng số bản ghi trong `data/local_papers.db` (`total_papers_in_db`) | `128,717` | ACL Anthology & các công trình khoa học đa lĩnh vực |
| Tổng số bài báo hợp lệ (`title` 15–300 ký tự, `authors`, `year` 1950–2026) | `127,980` | `99.43%` tổng kho dữ liệu |
| Số bài báo có đầy đủ `abstract` dài (`> 80` ký tự) | `82,577` | Đủ điều kiện đối sánh ngữ nghĩa cấp độ câu |
| Số bài báo có đầy đủ metadata thư mục (nhưng không kèm `abstract`) | `45,403` | Các bài hội nghị ACL/COLING/LREC/EMNLP lưu trữ metadata |
| **Tổng số bài báo lấy mẫu cho Benchmark (`sampled_total`)** | **`120,000`** | **`80,000` bài full-abstract + `40,000` bài metadata-complete** |

### 2.2. Kiểm định Phân tách Độc lập (`Strict Paper-Disjoint Split & Zero-Leakage Audit`)

| Tập Dữ liệu (`Split`) | Tỷ lệ | Tổng số Bài báo Độc lập | Bài báo có Full Abstract (`66.7%`) | Bài báo Metadata-Complete (`33.3%`) | Số câu/tiêu đề duy nhất mã hóa SBERT | Kiểm định Giao tập (`Set Intersection`) |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Train Split** | `70.0%` | **`84,000`** | `56,000` | `28,000` | `226,518` | `\|Train ∩ Val\| = 0` |
| **Validation Split** | `15.0%` | **`18,000`** | `12,000` | `6,000` | `48,677` | `\|Train ∩ Test\| = 0` |
| **Held-Out Test Split** | `15.0%` | **`18,000`** | `12,000` | `6,000` | `48,653` | `\|Val ∩ Test\| = 0` |
| **Tổng cộng** | **`100.0%`** | **`120,000`** | **`80,000`** | **`40,000`** | **`323,848`** | **`zero_leakage_verified = True`** |

---

## 3. Phân Bố 4 Nhãn Chính & 15 Phân Nhóm Lỗi (`15 Sub-Taxonomies`)

| Nhãn Chính (`Canonical Class`) | Mã Phân nhóm | Mô tả Kịch bản Trích dẫn Thực tế & Lỗi Học thuật | Train (`70%`) | Val (`15%`) | Test (`15%`) | **Tổng (`100%`)** |
| :--- | :---: | :--- | :---: | :---: | :---: | :---: |
| **`VERIFIED`**<br>*(36.0% — 43,200 mẫu)* | **`V1`** | Trích dẫn chuẩn xác hoàn toàn (`title`, `authors`, `year`, `venue`, `DOI`) | `7,560` | `1,620` | `1,620` | **`10,800`** |
| | **`V2`** | Rút gọn danh sách tác giả (`First Author et al.`, viết tắt tên) & lệch $\pm 1$ năm Online-First vs. Print | `7,560` | `1,620` | `1,620` | **`10,800`** |
| | **`V3`** | Lược bỏ phụ đề sau dấu `:` (*subtitle truncation*) hoặc biến thể dấu câu nhỏ | `7,560` | `1,620` | `1,620` | **`10,800`** |
| | **`V4`** | Nhiễu OCR ký tự / gạch nối PDF + cứu hộ ngữ nghĩa bằng `R-CONTENT-ALIGNMENT` | `7,560` | `1,620` | `1,620` | **`10,800`** |
| **`SUSPECTED_HALLUCINATION`**<br>*(30.0% — 36,000 mẫu)* | **`H1`** | Bịa đặt hoàn toàn (*Complete Fabrication*) $\rightarrow$ `0` ứng viên trên mọi cơ sở dữ liệu (`R-NO-SCHOLARLY-RECORD`) | `6,300` | `1,350` | `1,350` | **`9,000`** |
| | **`H2`** | Trích dẫn *Chimeric* do LLM ghép từ khóa chuyên ngành + ứng viên nhiễu rất yếu (`sim < 0.40`, `R-HALLUCINATED-SOURCE`) | `6,300` | `1,350` | `1,350` | **`9,000`** |
| | **`H3`** | DOI giả mạo (`10.9999/fake.*`, `10.1016/j.nonexistent.*`) hoặc DOI không tồn tại (`R-FABRICATED-DOI`, `R-NONEXISTENT-DOI`) | `6,300` | `1,350` | `1,350` | **`9,000`** |
| | **`H4`** | Liên kết chết (`HTTP 404` / tên miền giả RFC 2606 `R-FAKE-URL`, `R-DEAD-URL`) hoặc trích dẫn sai lệch nội dung abstract (`R-CONTENT-MISMATCH`) | `6,300` | `1,350` | `1,350` | **`9,000`** |
| **`METADATA_ERROR`**<br>*(22.0% — 26,400 mẫu)* | **`M1`** | Sai năm xuất bản ($|\Delta\text{year}| \in \{2, 3, 4, 5, 6, 8\}$ năm) nhưng khớp đúng tiêu đề và tác giả | `3,696` | `792` | `792` | **`5,280`** |
| | **`M2`** | Sai hoặc nhầm lẫn danh sách đồng tác giả (*author swap / wrong co-authors*) với tiêu đề khớp cao | `3,696` | `792` | `792` | **`5,280`** |
| | **`M3`** | DOI hợp lệ và phân giải thành công nhưng tiêu đề trích dẫn bị biến dạng (`sim ∈ [0.61, 0.82]`, `R-DOI-TITLE-MISMATCH`) | `3,696` | `792` | `792` | **`5,280`** |
| | **`M4`** | Biến đổi tiêu đề mức trung bình (`sim ∈ [0.62, 0.83]`) trên nguồn đơn lẻ không có DOI (`R-SINGLE-SOURCE-PARTIAL`) | `3,696` | `792` | `792` | **`5,280`** |
| | **`M5`** | Sai lệch tổ hợp đa trường (`author + year + title`) hoặc ngoại lệ `R-DOMAIN-EXCEPTION` (DOI khớp $\ge 2$ nguồn nhưng tiêu đề sai lệch nặng) | `3,696` | `792` | `792` | **`5,280`** |
| **`UNRESOLVED`**<br>*(12.0% — 14,400 mẫu)* | **`U1`** | Ứng viên vùng xám (`title_sim ∈ [0.41, 0.58]`, đồng thuận thấp) $\rightarrow$ hệ thống từ chối phán quyết cứng (`R-ABSTENTION-BORDER`) | `6,720` | `1,440` | `1,440` | **`9,600`** |
| | **`U2`** | Ứng viên vùng biên khó (`title_sim ∈ [0.38, 0.62]`) vắt ngang ngưỡng quyết định cần giảng viên/hội đồng kiểm tra | `3,360` | `720` | `720` | **`4,800`** |
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
16. `abstention_zone_indicator`: Chỉ báo rơi vào vùng biên từ chối phán quyết $[0.40, 0.60)$ khi không có DOI.

### 4.2. Kết quả Grid Search Hệ số Điều chuẩn L2 ($C$) trên Tập Validation ($N = 18,000$)

| Giá trị $C$ ứng viên | `0.1` | `0.25` | `0.5` | `1.0` | `2.0` | **`5.0` *(Được chọn)*** | `10.0` |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Validation Macro-F1** | `0.9938` | `0.9952` | `0.9964` | `0.9969` | `0.9972` | **`0.9976`** | `0.9976` |

- **Tham số kết hợp Symbolic – ML (`symbolic_blend_alpha`):** $\alpha = 0.72$ ($S_{\text{blend}} = 0.72 \cdot C_{\text{symbolic}} + 0.28 \cdot P_{\text{ML}}(y_{\text{sym}} \mid \mathbf{x})$).
- **Tham số Platt Scaling khớp trên tập Validation ($N = 18,000$):** $a = 2.162054$, $b = 0.629903$ ($P_{\text{cal}} = \sigma(2.1621 \cdot \text{logit}(S_{\text{blend}}) + 0.6299)$).

---

## 5. Kết Quả Thực Nghiệm Trên Tập Held-Out Test ($N = 18,000$ Bài Báo Độc Lập)

### 5.1. Nghiên cứu Cắt bỏ & Đối sánh Baseline (`Ablation Study`)

| Phương pháp / Baseline | Mô tả Cơ chế Quyết định | Accuracy | Macro-Precision | Macro-Recall | **Macro-F1** |
| :--- | :--- | :---: | :---: | :---: | :---: |
| **`B0` (`doi_only`)** | Chỉ xác thực khi có DOI khớp chính xác | `30.19%` | `0.2233` | `0.3764` | `0.2184` |
| **`B3` (`embedding_only`)** | Thuần ngữ nghĩa `Sentence-BERT` cosine similarity trên tiêu đề | `64.85%` | `0.4500` | `0.5078` | `0.4559` |
| **`B1` (`single_source_crossref`)** | Chỉ tra cứu đơn nguồn trên `Crossref` | `69.66%` | `0.5559` | `0.5684` | `0.5339` |
| **`B4` (`no_calibration`)** | Tổ hợp tuyến tính đa đặc trưng, tắt vùng abstention (`UNRESOLVED`) | `77.29%` | `0.5770` | `0.6359` | `0.5996` |
| **`B2` (`fuzzy_only`)** | Chỉ dùng so khớp từ vựng `RapidFuzz` tiêu đề + `AuthorJaccard` | `78.28%` | `0.5959` | `0.6472` | `0.6131` |
| **`Proposed` (`Neuro-Symbolic`)** | **Đồng thuận Đa nguồn + Đối sánh Ngữ nghĩa Abstract + Kiểm tra Link HTTP + Luật Symbolic + Abstention** | **`98.58%`** | **`0.9848`** | **`0.9704`** | **`0.9764`** |
| **`B5` (`ml_hybrid`)** | `HybridMLScorer` (Multinomial Logistic Regression 16D, $C = 5.0$) | **`99.86%`** | **`0.9982`** | **`0.9976`** | **`0.9979`** |

### 5.2. Hiệu năng Chi tiết Từng Nhãn của Bộ Luật Sản xuất (`SymbolicRules` + `HybridMLScorer` + `PlattCalibrator`)

| Nhãn Phán quyết (`ValidationLabel`) | Số mẫu Test ($N$) | Precision | Recall | **F1-Score** | Ý nghĩa Thực tiễn & Cơ chế Bảo vệ Học thuật |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **`VERIFIED`** | `6,480` | **`1.0000`** | `0.9742` | **`0.9869`** | Đạt **100% Precision**: Không có bất kỳ bài giả mạo hay bài sai năm nào bị gán nhầm thành `VERIFIED`. `164` ca `V4` có tiêu đề biến dạng nặng kèm DOI được chuyển an toàn sang `METADATA_ERROR` (`R-DOI-TITLE-MISMATCH`). |
| **`SUSPECTED_HALLUCINATION`** | `5,400` | **`1.0000`** | **`1.0000`** | **`1.0000`** | Bắt trọn `5,400 / 5,400` trích dẫn ảo giác/bịa đặt; **`0%` tỷ lệ cáo buộc oan (*Zero False Accusations*)** đối với bài báo thật. |
| **`METADATA_ERROR`** | `3,960` | `0.9337` | `0.9394` | **`0.9366`** | Phát hiện chính xác các lỗi sai năm (`M1`), sai tác giả (`M2`), lệch tiêu đề (`M3`, `M4`). `240` ca `M5` biến dạng đa trường không có DOI được chuyển thận trọng sang `UNRESOLVED` (`R-WEAK-EVIDENCE`). |
| **`UNRESOLVED` *(Abstention)*** | `2,160` | `0.8945` | `0.9537` | **`0.9231`** | Khoanh vùng chính xác các trường hợp thiếu bằng chứng hoặc nằm ở ranh giới `[0.40, 0.60]` để giảng viên/hội đồng thẩm định. |
| **Trung bình Vĩ mô / Tổng (`Macro / Total`)** | **`18,000`** | **`0.9571`** | **`0.9668`** | **`0.9617`** | **Overall Accuracy: `97.18%`** (`17,493 / 18,000` mẫu phân loại chính xác tuyệt đối). |

### 5.3. Ma trận Nhầm lẫn (`4×4 Confusion Matrix` trên $N = 18,000$ Mẫu Test)

| Nhãn Thực tế (`Gold`) \ Dự đoán (`Pred`) | Dự đoán: `VERIFIED` | Dự đoán: `METADATA_ERROR` | Dự đoán: `SUSPECTED_HALLUCINATION` | Dự đoán: `UNRESOLVED` | **Tổng Thực tế (`Support`)** |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Thực tế: `VERIFIED`** | **`6,313`** | `164` | `0` | `3` | `6,480` |
| **Thực tế: `METADATA_ERROR`** | `0` | **`3,720`** | `0` | `240` | `3,960` |
| **Thực tế: `SUSPECTED_HALLUCINATION`** | `0` | `0` | **`5,400`** | `0` | `5,400` |
| **Thực tế: `UNRESOLVED`** | `0` | `100` | `0` | **`2,060`** | `2,160` |

### 5.4. Hiệu quả Hiệu chỉnh Xác suất (`Logit-Space Platt Scaling`) & Đường cong `Coverage–Accuracy`

| Cấu hình Độ tin cậy | Macro-F1 | **ECE** *(Expected Calibration Error)* | **Brier Score** | Acc @ `50%` Cov | Acc @ `70%` Cov | Acc @ `90%` Cov | Acc @ `95%` Cov | Acc @ `100%` Cov |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Chưa hiệu chỉnh (`Uncalibrated Raw`)** | `0.9617` | `0.2135` | `0.0794` | `100.00%` | `98.14%` | `98.37%` | `98.46%` | `97.18%` |
| **Đã hiệu chỉnh (`Platt-Calibrated`)** | **`0.9617`** | **`0.0433`** *(↓ **4.9×**)* | **`0.0095`** *(↓ **8.4×**)* | **`100.00%`** | **`100.00%`** | **`99.99%`** | **`99.99%`** | **`97.18%`** |

### 5.5. Khoảng Tin cậy 95% Bootstrap Phi tham số ($B = 1,000$ Resamples trên $N = 18,000$)

| Chỉ số Đánh giá (`Metric`) | Giá trị Điểm (`Point Estimate`) | Trung bình Bootstrap (`Mean`) | Sai số Chuẩn (`Std. Error`) | **Khoảng Tin cậy 95% (`95% CI Lower – Upper`)** |
| :--- | :---: | :---: | :---: | :---: |
| **Overall Accuracy** | `0.9718` (`97.18%`) | `0.9718` | `±0.0012` | **`[0.9693, 0.9741]`** (`96.93% – 97.41%`) |
| **Macro-F1 Score** | `0.9617` | `0.9617` | `±0.0016` | **`[0.9583, 0.9648]`** |
| **Expected Calibration Error (`ECE`)** | `0.0433` | `0.0433` | `±0.0007` | **`[0.0421, 0.0448]`** |
| **Brier Score** | `0.0095` | `0.0095` | `±0.0004` | **`[0.0087, 0.0102]`** |

---

## 6. Kết Luận Khoa Học (Trích Xuất Cho Báo Cáo Khóa Luận / Bài Báo)

1. **Sự thất bại của cách tiếp cận thuần Neural (`B3`, `Macro-F1 = 0.4559`) trước ảo giác trích dẫn của LLM:**
   Khi các mô hình ngôn ngữ lớn (LLM) tạo ra các trích dẫn giả mạo kiểu *chimeric* (ghép nối các thuật ngữ chuyên ngành có thật từ nhiều bài báo khác nhau), độ tương đồng ngữ nghĩa `Sentence-BERT` trên tiêu đề vẫn đạt mức trung bình – cao, đồng thời bỏ qua hoàn toàn sai lệch về năm xuất bản, danh sách tác giả và trạng thái liên kết. Do đó, sử dụng đơn độc mô hình embedding không thể phân biệt được trích dẫn bịa đặt tinh vi với lỗi biên tập thư mục.
2. **Hạn chế của tra cứu đơn nguồn (`B1`, `Macro-F1 = 0.5339`) và thiếu cơ chế từ chối phán quyết (`B4`, `Macro-F1 = 0.5996`):**
   Chỉ dựa vào một cơ sở dữ liệu duy nhất như Crossref sẽ bỏ sót lượng lớn bài báo hội nghị Khoa học Máy tính (DBLP/ACL), bản thảo arXiv, sách chuyên khảo (OpenLibrary) hoặc tài liệu kỹ thuật/pháp lý, dẫn đến nguy cơ kết luận oan trích dẫn hợp lệ là ảo giác. Mặt khác, việc ép hệ thống luôn đưa ra phán quyết cứng mà không có vùng `UNRESOLVED` (`B4`) làm suy giảm nghiêm trọng độ tin cậy ở vùng biên `[0.40, 0.60]`.
3. **Ưu thế vượt trội của kiến trúc Lai ghép Neuro-Symbolic (`Proposed` & `B5`):**
   Sự kết hợp giữa **vector đặc trưng tương tác 16 chiều (`HybridMLScorer`, `Macro-F1 = 0.9979`)**, **đối sánh ngữ nghĩa câu trích dẫn – abstract bằng `Sentence-BERT`** và **tập luật suy diễn tất định (`SymbolicRules`, `Accuracy = 97.18% – 98.58%`)** giúp hệ thống vừa đạt độ chính xác phân loại rất cao, vừa bảo toàn **tính giải thích được ở mức từng luật (`Rule-Level Explainability`)** và đảm bảo **100% Precision trên nhãn `VERIFIED` và `SUSPECTED_HALLUCINATION` (`0` ca cáo buộc oan bài báo thật)**.
4. **Hiệu quả của Hiệu chỉnh Xác suất Hậu nghiệm (`Logit-Space Platt Scaling`):**
   Việc kết hợp xác suất đa lớp từ `HybridMLScorer` với điểm tin cậy của `SymbolicRules` và hiệu chỉnh qua `PlattCalibrator` ($a = 2.1621, b = 0.6299$) giúp giảm **4.9 lần** sai số hiệu chỉnh kỳ vọng (`ECE` giảm từ `0.2135` xuống **`0.0433`**) và giảm **8.4 lần** sai số bình phương trung bình (`Brier Score` giảm từ `0.0794` xuống **`0.0095`**), đạt độ chính xác **`99.99%`–`100.00%`** trên nhóm `70%–95%` phán quyết có độ tin cậy cao nhất.

---

## 7. Lệnh Tái Lập Thực Nghiệm (`Reproducibility`)

```bash
# Chạy toàn bộ quy trình huấn luyện, hiệu chỉnh Platt và đánh giá Benchmark 120,000 bài báo
.venv/bin/python scripts/train_neuro_symbolic_model.py

# Chạy bộ kiểm thử tự động xác nhận tính toàn vẹn của trọng số và kiểm định Zero-Leakage
.venv/bin/python -m pytest tests/unit/test_calibration.py tests/unit/test_baselines.py -q
```
