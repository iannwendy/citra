# Phân Tích Chuyên Sâu & Đề Xuất Tối Ưu Hóa UI/UX Trang Báo Cáo (`Report Page`) — CITRA

> **Góc nhìn đánh giá:** Principal Product & UI/UX Designer (20+ năm kinh nghiệm thiết kế SaaS học thuật & công cụ kiểm định nội dung như Grammarly, Turnitin Clarity, Linear, Stripe)  
> **Đối tượng mục tiêu trọng tâm:** Người dùng phổ thông / phi kỹ thuật (*Non-tech Users*: Sinh viên đại học, Học viên cao học, Nghiên cứu sinh, Giảng viên các khối ngành Kinh tế, Luật, Y dược, Xã hội & Nhân văn) — đồng thời vẫn bảo toàn chiều sâu giải thích cho Hội đồng chuyên môn / Giảng viên kiểm định.  
> **Phạm vi kiểm toán thực tế:** Ảnh chụp màn hình `/verification/report/119` (`VietDepression_PLOS_ONE.pdf`) kết hợp đối chiếu trực tiếp mã nguồn tại [`EssayPage.tsx`](../../web/src/pages/EssayPage.tsx), [`EssayHeader.tsx`](../../web/src/pages/essay/EssayHeader.tsx), [`EssayActionBar.tsx`](../../web/src/pages/essay/EssayActionBar.tsx), [`IssuesPage.tsx`](../../web/src/pages/IssuesPage.tsx), [`DocumentInspectorPage.tsx`](../../web/src/pages/DocumentInspectorPage.tsx), [`OrphanDetectionPage.tsx`](../../web/src/pages/OrphanDetectionPage.tsx) và [`LogicTracePage.tsx`](../../web/src/pages/LogicTracePage.tsx).

---

## Mục lục

1. [Chẩn đoán Tổng thể: Vì sao Trang Report hiện tại gây "ngợp" cho Non-Tech User?](#1-chẩn-đoán-tổng-thể-vì-sao-trang-report-hiện-tại-gây-ngợp-cho-non-tech-user)
2. [Kiểm toán Chi tiết 8 Điểm Nghẽn UI/UX Hiện Tại (Root-Cause Audit)](#2-kiểm-toán-chi-tiết-8-điểm-nghẽn-uiux-hiện-tại-root-cause-audit)
3. [5 Nguyên tắc Thiết kế Cốt lõi cho Giao diện Mới (Design North Star)](#3-5-nguyên-tắc-thiết-kế-cốt-lõi-cho-giao-diện-mới-design-north-star)
4. [Kiến trúc Bố cục Đề xuất Mới: Trước vs. Sau & Ngân sách Khung nhìn](#4-kiến-trúc-bố-cục-đề-xuất-mới-trước-vs-sau--ngân-sách-khung-nhìn)
5. [Đặc tả Tối ưu Chi tiết Từng Khu vực (Section-by-Section Redesign)](#5-đặc-tả-tối-ưu-chi-tiết-từng-khu-vực-section-by-section-redesign)
6. [Từ điển Việt hóa & Bình dân hóa Ngôn ngữ Giao diện (Human-First Microcopy)](#6-từ-điển-việt-hóa--bình-dân-hóa-ngôn-ngữ-giao-diện-human-first-microcopy)
7. [Quy chuẩn Thị giác: Màu sắc, Chữ viết (Typography) & Nhãn Gói Cước (PRO)](#7-quy-chuẩn-thị-giác-màu-sắc-chữ-viết-typography--nhãn-gói-cước-pro)
8. [Lộ trình Triển khai Thực tế trên Codebase (`P0` → `P1` → `P2`)](#8-lộ-trình-triển-khai-thực-tế-trên-codebase-p0--p1--p2)

---

## 1. Chẩn đoán Tổng thể: Vì sao Trang Report hiện tại gây "ngợp" cho Non-Tech User?

CITRA sở hữu một lõi công nghệ kiểm chứng cực kỳ mạnh mẽ và nền tảng màu sắc ấm áp rất sang trọng (*Solva Warm Editorial* `#FBFAF6`). Tuy nhiên, trang Report hiện tại đang mắc phải **2 căn bệnh kinh điển của các sản phẩm xuất phát từ công trình nghiên cứu kỹ thuật sâu**:

### 1.1. Hội chứng "Giao diện cho Kỹ sư AI thay vì Người viết bài" (*Engine-First UI*)
Giao diện đang phơi bày trực diện toàn bộ cơ chế vận hành bên dưới của hệ thống ra mặt tiền: tên bộ phân tích cú pháp (`GROBID TEI-XML`), mô hình lượng tử hóa (`ONNX INT8`), mã cơ sở dữ liệu nội bộ (`ref-0007`, `ID #119`), mã trạng thái kiểu lập trình (`METADATA_ERROR`, `MATCHED`), biểu thức điều kiện logic (`IF title_sim_fuzzy >= 0.88...`), và ẩn dụ công cụ lập trình (`VERIFICATION REPORT IDE`, `>_ Citation Debugger`, `Split-Pane IDE`, `Logic Trace`).

Trong khi đó, một sinh viên hay giảng viên không chuyên CNTT khi mở trang báo cáo chỉ cần trả lời đúng **3 câu hỏi theo trình tự tự nhiên**:
1. **Bài của tôi đã ổn chưa?** *(Điểm tổng quan, có bao nhiêu tài liệu cần sửa ngay?)*
2. **Chỗ nào sai và sai cụ thể cái gì?** *(Trong bài tôi gõ năm 2020, nhưng bài báo gốc là năm 2021 — nhìn 1 giây hiểu ngay).*
3. **Tôi sửa nó bằng cách nào nhanh nhất?** *(Bấm 1 nút chép lại dòng trích dẫn chuẩn, hoặc tải bản Word đã sửa).*

### 1.2. Sự sụp đổ của Khung nhìn Đầu tiên (*Above-the-Fold Collapse*)
Quan sát trực tiếp trên ảnh chụp thực tế màn hình chuẩn `1920×1080` tại `/verification/report/119`:
- **4 lớp thẻ/thanh ngang** xếp chồng lên nhau từ trên xuống dưới chiếm mất **`~500px` (gần 60% chiều cao vùng hiển thị của trình duyệt)**.
- Hệ quả nghiêm trọng: Trước khi kịp cuộn chuột, người dùng **chỉ nhìn thấy được nửa dòng trích dẫn đầu tiên (`[1] Choudhuru et al.`)** ở danh sách bên trái, và ở khung bên phải **chỉ mới thấy tên bài báo chứ chưa hề thấy bài đó sai ở đâu hay bảng so sánh bên dưới**!

---

## 2. Kiểm toán Chi tiết 8 Điểm Nghẽn UI/UX Hiện Tại (*Root-Cause Audit*)

| # | Vấn đề UX/UI phát hiện | Bằng chứng trực tiếp trên Màn hình & Code | Tác động tiêu cực tới Non-tech User |
|---|---|---|---|
| **1** | **Trùng lặp thông tin nghiêm trọng giữa các tầng (Redundant Chrome)** | - Tên file `VietDepression_PLOS_ONE.pdf` lặp lại **2 lần** (Header + Thanh cửa sổ IDE).<br>- Số trang `20 pages` & chuẩn `IEEE-LIKE` lặp lại **2 lần**.<br>- Thống kê số lượng hợp lệ `50 / 53` lặp lại **3 lần** (Vòng CIS, Thanh cửa sổ IDE, Chip lọc `✓ Verified (50)`).<br>- Tính năng sửa tự động lặp lại ở **3 nơi** (`Auto-Healed .DOCX` trên Header, `Remediation Engine` trên thanh tab, `1-Click Auto-Fix & BibTeX` trên thanh IDE). | Mắt người dùng phải quét đi quét lại cùng một thông tin dưới nhiều tên gọi khác nhau, tạo cảm giác trang cực kỳ chật chội dù lượng thông tin mới rất ít. |
| **2** | **Mâu thuẫn số liệu trực diện: `115 citations` vs `53 citations`** | Trong [`EssayHeader.tsx`](../../web/src/pages/essay/EssayHeader.tsx#L223), hệ thống hiển thị `numCitations` (**`115 citations`** = tổng lượt nhắc trong thân bài), nhưng ngay bên dưới tại [`EssayPage.tsx`](../../web/src/pages/EssayPage.tsx#L3397) lại ghi **`53 citations`** (`verdicts.length` = số mục tài liệu được chấm). | Người dùng phổ thông lập tức bối rối và nghi ngờ độ chính xác: *"Ủa bài của mình có 115 trích dẫn hay 53 trích dẫn? Sao trên ghi 115 mà dưới ghi All (53)?"* |
| **3** | **Vi phạm Định luật Hick trên Thanh Header (6 nút dàn hàng ngang)** | Cụm xuất file có tới **6 nút cạnh nhau**: `JSON`, `CSV`, `PDF`, `DOCX`, `Auto-Healed .DOCX`, `Share Receipt`. Đặc biệt, `JSON` và `CSV` (định dạng cho lập trình viên) lại nằm **đầu tiên bên trái**. Vì 6 nút này chiếm nửa chiều ngang, tiêu đề bài báo bị bóp nghẹt và rớt dòng xấu xí thành `VietDepression_PLOS_O` / `NE.pdf`. | Quá nhiều lựa chọn ngang hàng làm tê liệt quyết định (*Choice Paralysis*). Sinh viên không biết nên bấm nút nào và không hiểu `JSON` hay `Audit Artifact` là gì. |
| **4** | **Banner So sánh Phiên bản (`v1 → v2`) chiếm chỗ lớn ngay cả khi `0 thay đổi`** | Trong ảnh chụp, dù `CIS: 99.1% → 99.1% (+0.0%)`, `Resolved Issues: 0`, `Metadata Errors: 1 → 1 [0]`, `Hallucinations: 0 → 0 [0]`, khối banner này vẫn bung rộng 3 dòng (~160px) với ký hiệu toán học `1 → 1 0`. | Chiếm mất "đất vàng" đầu trang để thông báo một tin tức không mang giá trị hành động (*không có gì thay đổi*), lại viết bằng cú pháp số học khó đọc. |
| **5** | **Trộn lẫn Điều hướng Trang (Navigation) với Hành động Mở Hộp thoại (Action) + Rớt dòng** | Trong [`EssayActionBar.tsx`](../../web/src/pages/essay/EssayActionBar.tsx#L50-L223), 5 mục đầu chuyển URL trang, riêng mục thứ 6 (`Remediation Engine · Auto-Fix Style...`) lại mở Modal và có nhãn quá dài, đẩy chỉ số quan trọng nhất trang (**CIS 99.1%**) rớt xuống dòng dưới lẻ loi. | Phá vỡ mô hình nhận thức (*Mental Model*) của thanh Tab. Điểm tổng kết toàn bài (99.1%) đáng lẽ phải là tâm điểm tự hào thì lại biến thành dòng chú thích nhỏ. |
| **6** | **Khung "Cửa sổ macOS giả" (Fake Window Chrome) & Bẫy cuộn lồng nhau (Nested Scroll)** | Ba chấm tròn Đỏ–Vàng–Xanh giả lập cửa sổ macOS nằm bên trong trình duyệt thật, bọc lấy danh sách có thanh cuộn riêng, lại ghim cứng hộp `MANUSCRIPT CONTEXT` dưới đáy cột trái ([`EssayPage.tsx`](../../web/src/pages/EssayPage.tsx#L3756)). | Tạo cảm giác tù túng ("hộp trong hộp trong hộp"). Trên màn hình laptop 13–14 inch, danh sách trích dẫn bị ép còn khe rất hẹp, cuộn ngoài và cuộn trong đá nhau. |
| **7** | **Xung đột ngữ nghĩa của 2 nhãn cạnh nhau (`METADATA_ERROR` + `MATCHED`) & Lạm dụng màu/font** | Góc phải hiển thị song song `[⚠ METADATA_ERROR]` và `[MATCHED]`. Toàn bộ tiêu đề bài báo 3 dòng bị tô màu cam/đỏ; hơn **95 vị trí** dùng `font-mono` (font chữ code). Khi chọn Tiếng Việt, nhiều nhãn vẫn giữ nguyên tiếng Anh (`Citation Debugger`, `Split-Pane IDE`). | Non-tech user không hiểu tại sao một trích dẫn vừa **"Bị lỗi"** lại vừa **"Đã khớp (MATCHED)"**. Tô màu cảnh báo lên cả đoạn chữ dài gây mỏi mắt và căng thẳng tâm lý. |
| **8** | **Phân mảnh Kiến trúc Thông tin (11 bề mặt xem) & Quá tải nhãn `🔒 PRO`** | Người dùng phải đứng trước 5 trang con (`Debugger`, `Issues`, `Document`, `Consistency`, `Logic Trace`) + 2 chế độ (`Split-Pane` / `Graph`) + 4 tab con bên phải (`Diff`, `Rules`, `Sources`, `Graph`) có nội dung trùng nhau tới 60%. Với gói Basic, màn hình hiện tới **13 biểu tượng ổ khóa `🔒 PRO`**. | Không biết phải bấm vào đâu để xem lỗi (`Issues` hay `Debugger`?). Quá nhiều nhãn `PRO` rải khắp nơi tạo cảm giác nặng nề thương mại thay vì hỗ trợ học thuật. |

---

## 3. 5 Nguyên tắc Thiết kế Cốt lõi cho Giao diện Mới (*Design North Star*)

Để bất kỳ sinh viên năm nhất hay giảng viên lớn tuổi nào mở trang ra cũng **hiểu ngay trong 3 giây và biết cách thao tác mà không cần hướng dẫn**, toàn bộ bản thiết kế lại tuân thủ nghiêm ngặt 5 nguyên tắc:

1. **Một Khu vực = Đúng Một Mục đích (*One Zone, One Job*):**
   Mỗi thành phần chỉ xuất hiện **một lần duy nhất** ở đúng vị trí cần nó. Tuyệt đối không lặp lại tên file, chuẩn trích dẫn, số đếm hay nút sửa lỗi ở hai nơi.
2. **Im lặng khi Bình thường — Chỉ lên tiếng khi Cần chú ý (*Silence When Normal*):**
   Ẩn toàn bộ các nhãn kỹ thuật mang tính "hệ thống vẫn chạy tốt" (`MATCHED`, `GROBID TEI-XML`, `ID #119`, `0 → 0 thay đổi`). Khi ít thông tin râu ria hơn, những cảnh báo thực sự quan trọng sẽ tự khắc nổi bật mà không cần tô đỏ rực cả trang.
3. **Tiết lộ Dần theo Nhu cầu (*Progressive Disclosure*):**
   - **Lớp 1 (Hiển thị ngay cho 100% người dùng):** Kết luận rõ ràng + Điểm sai cụ thể ("Bạn viết" vs "Bản gốc") + Nút chép câu sửa đúng.
   - **Lớp 2 (Thu gọn trong ngăn *"Xem cách hệ thống kiểm chứng"* — bấm mới mở):** Toàn bộ quy tắc suy diễn Neuro-Symbolic, độ tương đồng ngữ nghĩa, 15+ nguồn CSDL và Đồ thị bằng chứng. *Cách này giúp giao diện sạch tinh tươm cho non-tech user nhưng không mất đi bất kỳ tính năng học thuật đắt giá nào của đồ án!*
4. **Ngôn ngữ Đời thường Học thuật (*Human-First Microcopy*):**
   Loại bỏ 100% từ vựng lập trình (`IDE`, `Debugger`, `Trace`, `Artifact`, `Metadata_Error`, `Split-Pane`). Thay bằng ngôn ngữ biên tập học thuật tự nhiên, nhất quán một ngôn ngữ (khi chọn Tiếng Việt thì 100% nhãn giao diện phải là Tiếng Việt tự nhiên).
5. **Mực Trung tính, Màu Điểm nhấn (*Calm Editorial Hierarchy*):**
   Phát huy tối đa vẻ đẹp của nền giấy ấm *Solva* (`#FBFAF6`). Chữ tiêu đề và nội dung luôn dùng màu mực đen ấm sắc nét (`slate-900` / `#1C1A15`) để dễ đọc nhất; màu Đỏ / Vàng / Xanh ngọc **chỉ dùng cho chấm trạng thái, nhãn nhỏ (Badge) và đúng từ/con số bị sai**.

---

## 4. Kiến trúc Bố cục Đề xuất Mới: Trước vs. Sau & Ngân sách Khung nhìn

### 4.1. So sánh Ngân sách Chiều dọc (*Vertical Viewport Budget* trên màn hình Laptop `900px` vùng hiển thị)

| Tầng hiển thị (Từ trên xuống) | Hiện tại (`px`) | Đề xuất mới (`px`) | Thay đổi UX cốt lõi |
|---|---:|---:|---|
| **1. Thanh Tiêu đề Tài liệu (`Header`)** | `~180px` | **`68px`** | Gom gọn trên 1 hàng ngang; thu 6 nút xuất thành 1 nút chính + 1 menu `Xuất báo cáo ▾`; tên file không còn bị gãy dòng. |
| **2. Dải So sánh Phiên bản (`v1 → v2`)** | `~165px` | **`0px` – `40px`** | Ẩn thành 1 nhãn nhỏ cạnh điểm số nếu `0 thay đổi`; hoặc hiện 1 dòng thông báo mỏng `40px` nếu có tiến bộ. |
| **3. Thanh Chuyển góc nhìn + Tóm tắt Điểm** | `~92px` | **`64px`** | Đưa Điểm Độ tin cậy (99.1%) + Các chip đếm lỗi nằm gọn cùng hàng với 3 tab góc nhìn chính. |
| **4. Thanh Cửa sổ macOS giả (`Fake IDE Bar`)** | `~64px` | **`0px` (Xóa bỏ)** | Xóa hoàn toàn 3 chấm Đỏ-Vàng-Xanh và dòng lặp lại tên file / chuẩn trích dẫn. |
| **TỔNG PHẦN VỎ ĐẦU TRANG (CHROME)** | **`~501px` (56%)** | **`~132px`–`172px` (16%)** | **Tiết kiệm ~350px chiều dọc!** |
| **KHÔNG GIAN NỘI DUNG NGAY KHI MỞ TRANG** | `~350px` *(0.5 mục)* | **`~720px` *(6–7 mục + trọn vẹn bảng đối chiếu)*** | **Tăng hơn gấp đôi (+105%) diện tích làm việc thực tế mà không cần cuộn trang!** |

---

### 4.2. Sơ đồ Wireframe Trực quan — Giao diện Trang Report Sau Tối Ưu

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ ← Lịch sử   📄 VietDepression_PLOS_ONE.pdf                  [✨ Sửa & Chuẩn hóa] [Xuất file ▾]│
│                20 trang · 53 tài liệu tham khảo (115 lượt trích trong bài) · Chuẩn IEEE       │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│  ● 99.1% Độ tin cậy (Rất tốt)  │  [Danh mục trích dẫn]  [Xem trong bài viết]  [Khớp nối ✓]   │
│    Đã khớp 50/53 tài liệu      │                                     (So với bản v1: Không đổi)│
├────────────────────────────────┴──┬──────────────────────────────────────────────────────────┤
│ 🔍 Tìm tên bài, tác giả, số [7]...│  TÀI LIỆU [7] · Trang 2            [⚠ Sai thông tin năm] │
│                                   │                                                          │
│ [Cần kiểm tra (3)] [Hợp lệ (50)]  │  Negatively correlated noisy learners for at-risk user   │
│ [Tất cả (53)]                     │  detection on social networks: A study on depression...  │
│ ───────────────────────────────── │                                                          │
│ ┌───────────────────────────────┐ │  ┌─ Tóm tắt vấn đề ────────────────────────────────────┐ │
│ │ [7] Choudhury et al. (2013)   │ │  │ ⚠ Bài báo này có thật, nhưng NĂM XUẤT BẢN trong bài │ │
│ │ Negatively correlated noisy...│ │  │   của bạn (2013) lệch so với bản gốc công bố (2014).│ │
│ │ ⚠ Sai thông tin      Trang 2  │ │  │                                                     │ │
│ └───────────────────────────────┘ │  │ [📋 Chép trích dẫn chuẩn IEEE]  [Mở bài báo gốc ↗]  │ │
│                                   │  └─────────────────────────────────────────────────────┘ │
│   [12] Nguyen & Tran (2021)       │                                                          │
│   Deep learning for Vietnamese... │  ĐỐI CHIẾU THÔNG TIN                                     │
│   ? Chưa đủ thông tin   Trang 5   │  ┌────────────┬────────────────────┬───────────────────┐ │
│                                   │  │ Năm XB  ⚠  │ Bạn viết: 2013     │ Bản chuẩn: 2014   │ │
│ ── Đã xác thực hợp lệ (50) ────── │  ├────────────┼────────────────────┼───────────────────┤ │
│                                   │  │ Tiêu đề ✓  │ Khớp hoàn toàn với bản gốc             │ │
│   [1] Choudhury et al. (2013)     │  │ Tác giả ✓  │ M. De Choudhury, S. Counts, E. Horvitz │ │
│   Predicting depression via...    │  │ Nơi đăng ✓ │ ACM WebSci / PLOS ONE                  │ │
│   ✓ Hợp lệ              Trang 1   │  └────────────┴────────────────────┴───────────────────┘ │
│                                   │                                                          │
│   [2] Beck et al. (1961)          │  ĐOẠN TRÍCH TRONG BÀI CỦA BẠN (Trang 2)                  │
│   An inventory for measuring...   │  "...nghiên cứu trước đây trên mạng xã hội [7] cho thấy  │
│   ✓ Hợp lệ              Trang 1   │   các mô hình học máy có thể phát hiện sớm dấu hiệu..."  │
│                                   │                                                          │
│   [3] Devlin et al. (2019)        │  ▸ Xem chi tiết kiểm chứng (Nguồn tra cứu & Quy tắc AI)  │
└───────────────────────────────────┴──────────────────────────────────────────────────────────┘
```

---

## 5. Đặc tả Tối ưu Chi tiết Từng Khu vực (*Section-by-Section Redesign*)

### Khu vực 1: Thanh Tiêu đề Tinh gọn (`EssayHeader`) — *Mục đích duy nhất: Định danh tài liệu & Xuất kết quả*

1. **Giải quyết triệt để mâu thuẫn `115` vs `53`:**
   Hiển thị thành một dòng phụ đề rõ nghĩa, thân thiện với mọi chuyên ngành:
   > `20 trang` · **`53 tài liệu tham khảo`** *(115 lượt trích trong bài)* · `Chuẩn IEEE`
   *(Người đọc hiểu ngay bài có 53 đầu mục tài liệu ở cuối bài, được nhắc tới 115 lần trong phần nội dung).*
2. **Xóa các chi tiết gây nhiễu:**
   - Xóa badge `[🛡 VERIFICATION REPORT IDE]`.
   - Xóa nhãn `🕒 ID #119` (hoặc chỉ đưa mã `#119` vào tooltip khi di chuột lên tên file cho Admin).
   - Xóa dòng chữ nhỏ `EXPORT AUDIT ARTIFACT`.
3. **Thu gọn 6 nút bên phải thành đúng 2 cụm hành động rõ ràng (Áp dụng Định luật Hick):**
   - **Nút chính (Primary CTA):** `[✨ Chuẩn hóa & Sửa trích dẫn]` — gom cả 3 nút sửa rải rác hiện nay về đúng **1 vị trí quyền lực nhất này**! Khi bấm vào, người dùng có thể chọn tải ngay file `.DOCX` đã tự động sửa hoặc chép danh mục chuẩn APA/IEEE/TDTU/BibTeX.
   - **Menu gộp `[Tải báo cáo ▾]` (`DropdownMenu`):**
     - `📄 Báo cáo kiểm định (.PDF)` *(Khuyên dùng để nộp/lưu trữ)*
     - `📝 Báo cáo chi tiết (.DOCX)`
     - *Đường kẻ phân cách mảnh*
     - `🔗 Chia sẻ chứng nhận xác thực (Copy Link)`
     - `📊 Xuất dữ liệu thô (.CSV / .JSON)` *(Xếp dưới cùng cho người dùng kỹ thuật)*

---

### Khu vực 2: Dải Tổng quan Sức khỏe & Chuyển Góc nhìn — *Mục đích duy nhất: Cho biết tình trạng toàn bài & Chọn chế độ xem*

Thay vì tách rời Banner Tiến bộ + Thanh 6 nút + Dòng CIS Donut rớt dòng, ta thiết kế **1 thanh Summary & View Bar cân đối**:

1. **Bên trái — Cụm Điểm Độ Tin Cậy Dễ Hiểu:**
   - Vòng tròn tiến độ nhỏ gọn + Con số lớn: **`99.1%`** kèm nhãn đánh giá định tính bằng lời (**`Rất đáng tin cậy`** / **`Cần rà soát vài mục`** / **`Nhiều rủi ro trích dẫn`**) để non-tech user không phải tự đoán xem `99.1%` hay `78%` là cao hay thấp.
   - Dòng phụ nhỏ ngay cạnh: `50 hợp lệ · 1 cần sửa · 2 chưa rõ`.
2. **Bên phải — Thanh Chuyển Đổi 3 Góc Nhìn Đúng Mục Đích (Hợp nhất từ 5 trang rời rạc):**
   - **Tab 1: `Danh mục trích dẫn` *(Mặc định)*** — Hợp nhất trang `Citation Debugger` và trang `Issues` thành một nơi duy nhất! Không bắt người dùng phải tự hỏi *"Xem lỗi ở tab Issues hay ở bảng bên dưới?"*.
   - **Tab 2: `Xem trên bài viết`** *(Trang `Document` hiện tại)* — Xem trích dẫn đặt trong dòng chảy toàn văn của bài luận.
   - **Tab 3: `Kiểm tra khớp nối` *(Kèm dấu `✓` xanh nếu không có lỗi, hoặc số đỏ `2` nếu có trích dẫn thiếu/thừa)*** *(Trang `Consistency` hiện tại)* — Giúp sinh viên biết ngay có quên liệt kê tài liệu nào ở cuối bài hay liệt kê thừa tài liệu không dùng tới hay không.
   - *(Góc nhìn `Sơ đồ mạng lưới (Graph)` được đặt thành một nút chuyển nhỏ tinh tế `Sơ đồ` hoặc nằm trong menu phụ dành cho người dùng Pro/Giảng viên, tránh chiếm chỗ ngang hàng).*
3. **Banner So sánh Phiên bản (`v1 → v2`) thông minh theo ngữ cảnh:**
   - **Trường hợp `0 thay đổi` (như trong ảnh chụp `#118 → #119`):** Thu gọn thành 1 dòng chữ nhỏ nhẹ nhàng: `So với lần nộp trước (#118): Không có thay đổi` kèm link `Xem bản cũ`. **Không bung khối hộp lớn 160px!**
   - **Trường hợp CÓ thay đổi (VD: sinh viên vừa sửa bài nộp lại):** Hiện một dải thông báo mỏng 1 dòng đầy khích lệ:
     > 🎉 **Tiến bộ so với lần nộp trước:** Đã khắc phục **3 lỗi trích dẫn** · Điểm tin cậy tăng từ **91.0% → 99.1% (+8.1%)** — `[Xem chi tiết thay đổi ▾]`

---

### Khu vực 3: Cột Trái — Danh sách Tài liệu Ưu tiên Việc Cần Làm (*Action-First Queue*)

1. **Loại bỏ vỏ "Cửa sổ macOS giả":** Bỏ thanh tiêu đề 3 chấm tròn Đỏ–Vàng–Xanh. Hai cột Trái – Phải nằm trực tiếp trên mặt thẻ trắng tinh khiết (`rounded-2xl border bg-white`), thoáng như ứng dụng **Linear** hoặc **Grammarly**.
2. **Ưu tiên hiển thị "Việc cần sửa" lên đầu tiên (*Exception-First Sorting*):**
   - Khi bài có 50 nguồn đúng và chỉ có **1–3 nguồn lỗi**, sinh viên mở báo cáo là muốn tìm ngay 1–3 nguồn lỗi đó để sửa!
   - **Đề xuất:** Mặc định sắp xếp nhóm **`Cần kiểm tra`** nằm ở phần đầu danh sách (có tiêu đề phân nhóm nhỏ `CẦN KIỂM TRA (1)`), ngay bên dưới là nhóm `ĐÃ XÁC THỰC HỢP LỆ (50)` — kèm theo dãy nút lọc nhanh `[Tất cả (53)]` · `[Cần sửa (1)]` · `[Hợp lệ (50)]`. Nhờ vậy, mục `[7]` đang mở bên phải cũng **luôn nằm ngay dòng đầu tiên bên trái**, không bao giờ bị lệch pha "trái hiện `[1]`, phải hiện `[7]`" như ảnh chụp hiện tại!
3. **Tối giản thông tin trên mỗi thẻ danh sách (Chỉ giữ 3 yếu tố — Giảm 50% chữ):**
   - **Dòng 1:** `[7] Choudhury et al. (2013)` *(Chữ đậm, màu mực đen rõ nét)* + `Trang 2` *(Nhỏ góc phải)*.
   - **Dòng 2:** Tên bài báo cắt gọn 1 dòng (`line-clamp-1`, màu xám đậm trung tính — **tuyệt đối không tô cam/đỏ cả dòng tiêu đề**).
   - **Dòng 3:** **Chỉ 1 nhãn trạng thái duy nhất** bằng tiếng Việt dễ hiểu (VD: `⚠ Sai năm xuất bản` hoặc `✓ Hợp lệ`). **Ẩn hoàn toàn** nhãn `MATCHED` và `Conf: 87%` khỏi thẻ danh sách để mắt quét 50 mục nhẹ tênh trong vài giây!
4. **Di dời hộp `NGỮ CẢNH TRONG BÀI` sang Cột Phải:**
   Gỡ bỏ hộp xám ghim cứng dưới đáy cột trái để trả lại toàn bộ chiều cao cho danh sách trích dẫn cuộn mượt mà.

---

### Khu vực 4: Cột Phải — Hồ sơ Chi tiết 3 Tầng Rõ Mục Đích (*Human-First Reference Inspector*)

Khi người dùng bấm vào một tài liệu ở cột trái, cột phải trình bày theo **đúng mạch tư duy con người từ Tổng quan → Đối chiếu → Chuyên sâu**, không bắt bấm qua lại 4 tab nhỏ rối rắm:

#### Tầng 1: Hộp Chẩn đoán Ngắn gọn & Nút Sửa Nhanh (*1-Second Diagnosis & Action*)
- Hiển thị số hiệu `Tài liệu [7]` *(bỏ mã nội bộ `ref-0007` và chữ `INSPECTING REFERENCE`)* + Tiêu đề bài báo bằng màu mực đen sắc nét + **1 nhãn trạng thái duy nhất** (ẩn badge `MATCHED` trừ khi thực sự bị lỗi liên kết thiếu/thừa).
- **Hộp tóm tắt bằng lời nói tự nhiên (1–2 câu ngắn):**
  - *Thay vì:* Đoạn giải thích dài kèm `ONNX INT8 · 84%`, `Neural Reasoning`, `R-SINGLE-SOURCE-PARTIAL`.
  - *Đổi thành:* **"Tìm thấy bài báo gốc trên cơ sở dữ liệu Crossref, nhưng thông tin Năm xuất bản hoặc Tác giả trong bài của bạn đang lệch với bản gốc."**
- **Thanh hành động tại chỗ (Contextual Quick Actions):**
  - Nút `[📋 Sao chép trích dẫn chuẩn]` (Copy ngay chuỗi trích dẫn đã sửa đúng thông tin theo chuẩn IEEE/APA/TDTU của bài viết).
  - Nút phụ `[Mở bài báo gốc ↗]` (Mở link DOI / trang xuất bản thật để sinh viên kiểm chứng tận mắt).

#### Tầng 2: Bảng Đối chiếu Tinh gọn ("Bạn viết" vs. "Bản gốc chuẩn") + Đoạn văn trong bài
- **Cải tổ bảng `Metadata Diff`:**
  1. **Đưa dòng bị sai lệch lên trên cùng** với nền vàng nhạt/đỏ nhạt dịu mắt, làm nổi bật đúng phần khác biệt (Ví dụ: Bạn viết **`2013`** → Bản chuẩn **`2014`**).
  2. **Tự động ẩn các trường trống rỗng vô nghĩa:** Nếu cả trong bài lẫn bản thu thập đều không có `URL` (`—` và `—`), **ẩn dòng đó đi** thay vì bắt người dùng đọc 2 gạch ngang vô bổ!
  3. **Các trường đã khớp 100%:** Thu gọn nhẹ nhàng trên 1 dòng kèm tích xanh `✓` để người dùng lướt nhanh, tập trung toàn bộ sự chú ý vào đúng trường cần sửa.
- **Khối `Đoạn trích trong bài của bạn (Trang 2)`:**
  Đặt ngay dưới bảng đối chiếu (chuyển từ đáy cột trái sang). Người dùng vừa nhìn thông tin bài báo, vừa đọc ngay câu văn mình viết trong bài để kiểm tra xem mình trích dẫn có đúng chỗ không.

#### Tầng 3: Ngăn thu gọn `Chi tiết kiểm chứng chuyên sâu` (*Progressive Disclosure Accordion — Mặc định ĐÓNG*)
- Một thanh mở rộng thanh lịch ở cuối cột phải:
  > `▸ Xem chi tiết kiểm chứng (Nguồn dữ liệu tra cứu, Quy tắc AI & Dành cho Giảng viên)`
- **Khi đóng (mặc định cho 95% người dùng):** Trang báo cáo gọn gàng, sạch sẽ, không một dòng code hay thuật ngữ AI nào làm rối mắt!
- **Khi bấm mở ra (dành cho Giảng viên, Nghiên cứu sinh hoặc Hội đồng chấm ĐATN):** Hiển thị đầy đủ các tab chuyên sâu hiện có:
  - Danh sách các CSDL học thuật đã đối chiếu (`Crossref`, `OpenAlex`, `PubMed`, `Semantic Scholar`...).
  - Các quy tắc suy diễn (`Symbolic Rules`), điểm tương đồng đa ngôn ngữ và `Đồ thị bằng chứng (Evidence Graph)`.
  - Khung **Ghi đè phán quyết (`Override Verdict`)** dành riêng cho tài khoản Giảng viên / Admin *(riêng với vai trò Giảng viên đang chấm bài, có thể để khu vực Ghi đè kết quả hiển thị sẵn gọn gàng ở chân cột phải để thao tác nhanh)*.

---

## 6. Từ điển Việt hóa & Bình dân hóa Ngôn ngữ Giao diện (*Human-First Microcopy*)

Một quy tắc sống còn cho trải nghiệm Non-tech: **Nói ngôn ngữ của người viết luận văn, không nói ngôn ngữ của người viết trình biên dịch.** Dưới đây là bảng chuyển đổi đề xuất áp dụng đồng bộ cho cả Tiếng Việt (`vi.json`) và Tiếng Anh (`en.json`):

| Vị trí hiện tại | Thuật ngữ hiện tại (Gây khó hiểu / Jargon) | Đề xuất mới — Tiếng Việt (Dễ hiểu, tự nhiên) | Đề xuất mới — Tiếng Anh (Clean UX Copy) |
|---|---|---|---|
| Nhãn Header | `VERIFICATION REPORT IDE` | *(Xóa bỏ hoàn toàn)* | *(Remove completely)* |
| Nhãn cụm nút xuất | `EXPORT AUDIT ARTIFACT` | *(Xóa nhãn thừa, gom vào nút)* **`Xuất báo cáo ▾`** | **`Export ▾`** |
| Nút sửa tự động | `Auto-Healed .DOCX` / `Remediation Engine` / `1-Click Auto-Fix & BibTeX` | Gom thành 1 nút: **`Sửa & Chuẩn hóa trích dẫn`** | **`Fix & Format Citations`** |
| Số lượng trên Header | `115 citations` *(lệch với 53 bên dưới)* | **`53 tài liệu tham khảo · 115 lượt trích`** | **`53 references · 115 in-text mentions`** |
| Tab 1 thanh điều hướng | `>_ Citation Debugger` | **`Danh mục trích dẫn`** *(bỏ icon Terminal `>_`)* | **`Citations`** |
| Tab 2 thanh điều hướng | `Issues` *(trùng chức năng)* | *(Gộp thành bộ lọc **`Cần kiểm tra`** ngay trong Danh mục)* | *(Merged as **`Needs Review`** filter)* |
| Tab 3 thanh điều hướng | `Document` | **`Xem trong bài viết`** | **`In Document`** |
| Tab 4 thanh điều hướng | `Consistency` | **`Kiểm tra thiếu / thừa`** | **`In-Text Check`** |
| Tab 5 thanh điều hướng | `Logic Trace` | *(Đưa vào ngăn mở rộng)* **`Chi tiết kiểm chứng`** | **`How We Verified`** |
| Chuyển chế độ xem | `Split-Pane IDE` / `Citation Graph` | **`Danh sách`** / **`Sơ đồ liên kết`** | **`List View`** / **`Network View`** |
| Nhãn đầu cột phải | `INSPECTING REFERENCE [7] · ref-0007` | **`Tài liệu [7]`** | **`Reference [7]`** |
| Nhãn lỗi Metadata | `METADATA_ERROR` | **`Sai lệch thông tin`** *(hoặc cụ thể: `Sai năm XB` / `Sai tác giả`)* | **`Details Mismatch`** |
| Nhãn nghi vấn bịa đặt | `SUSPECTED_HALLUCINATION` | **`Không tìm thấy nguồn gốc`** | **`Source Not Found`** |
| Nhãn chưa xác minh | `UNRESOLVED` | **`Chưa đủ dữ liệu đối chiếu`** | **`Needs Manual Check`** |
| Nhãn tài nguyên Web/Luật | `RESOURCE` | **`Nguồn Web / Văn bản pháp luật`** | **`Web / Legal Source`** |
| Nhãn liên kết `MATCHED` | `MATCHED` *(hiện cạnh `METADATA_ERROR`)* | *(Ẩn khi bình thường; chỉ hiện khi lỗi: **`Chưa có ở cuối bài`** hoặc **`Chưa trích dẫn trong bài`**)* | *(Hide when normal; show only errors: **`Missing in Reference List`** / **`Uncited in Text`**)* |
| Giải thích AI | `Neuro-Symbolic Reasoning:` + `ONNX INT8` | **`Tóm tắt kiểm tra:`** *(Ngôn ngữ tự nhiên)* | **`Summary:`** |
| Bảng đối chiếu | `Cited in Manuscript` / `Canonical Retrieved` | **`Trong bài của bạn`** / **`Bản gốc đối chiếu`** | **`In Your Paper`** / **`Verified Source Record`** |

---

## 7. Quy chuẩn Thị giác: Màu sắc, Chữ viết (*Typography*) & Nhãn Gói Cước (`PRO`)

### 7.1. Thu hồi lạm dụng `font-mono` (Trả lại sự thân thiện cho trang đọc)
- **Hiện tại:** `font-mono` (`JetBrains Mono`) đang phủ khắp các nút bấm, nhãn tab, tiêu đề bảng, thông báo lỗi và bộ lọc (>95 chỗ), tạo cảm giác khô cứng của màn hình dòng lệnh.
- **Quy chuẩn mới:**
  - **Chữ giao diện chính (`Inter` / `Onest` Sans-serif):** Dùng cho **100%** nút bấm, thanh tab, bộ lọc, nhãn trạng thái, bảng đối chiếu và câu giải thích. Chữ Sans-serif giúp mắt người dùng phổ thông đọc tiếng Việt có dấu nhanh và êm hơn rất nhiều.
  - **Chữ có chân học thuật (`Sentient` Serif):** Chỉ dùng điểm xuyết cho đoạn trích văn bản gốc của bài luận (*Đoạn trích trong bài của bạn*) để phân biệt "văn của tôi" với "giao diện phần mềm".
  - **Chữ đơn cách (`JetBrains Mono`):** **Chỉ dùng duy nhất** cho mã định danh số học: `[1]`, `[7]`, mã `DOI` (`10.1371/journal...`), và các thông số bên trong ngăn kỹ thuật thu gọn.

### 7.2. Quy tắc "Mực đen cho Chữ — Màu sắc cho Tín hiệu" (*Color Restraint*)
- **Không bao giờ** tô màu cam (`text-amber-700`) hay màu đỏ (`text-red-600`) lên toàn bộ tiêu đề bài báo dài 2–3 dòng hoặc cả đoạn văn giải thích như hiện tại.
- Tiêu đề bài báo luôn giữ màu mực chính (`text-slate-900 dark:text-slate-100`).
- Tín hiệu cảnh báo chỉ nằm ở **3 điểm chạm tinh tế**:
  1. Đường viền dọc mảnh `3px` bên cạnh thẻ đang có lỗi (`border-l-4 border-amber-500` hoặc `border-red-500`).
  2. Một nhãn trạng thái nhỏ gọn góc phải (`bg-amber-50 text-amber-800`).
  3. Tô nền nhấn nhẹ (`bg-amber-100/70 font-semibold`) **đúng vào con số/chữ bị lệch** trong bảng đối chiếu (ví dụ tô nhẹ số `2013` vs `2014`).

### 7.3. Giảm từ 13 nhãn ổ khóa `🔒 PRO` xuống còn 1 điểm chạm tinh tế (Đối với người dùng Basic)
- Gom các định dạng xuất khóa (`PDF`, `DOCX`, `Auto-Healed DOCX`) vào bên trong menu xổ xuống **`Xuất báo cáo ▾`** — lúc chưa mở menu, thanh Header hoàn toàn sạch bóng ổ khóa!
- Các tính năng nâng cao (Sơ đồ bằng chứng, Quy tắc AI sâu) được đặt gọn trong ngăn thu gọn **`Chi tiết kiểm chứng chuyên sâu`** — chỉ khi người dùng chủ động mở ngăn này ra mới hiển thị **1 thẻ giới thiệu nâng cấp duy nhất**, lịch sự và thuyết phục hơn gấp nhiều lần so với 13 chiếc ổ khóa rải khắp mặt trang.

---

## 8. Lộ trình Triển khai Thực tế trên Codebase (`P0` → `P1` → `P2`)

Để nâng cấp giao diện mượt mà, rủi ro thấp và **tương thích an toàn với hệ thống 340+ bài kiểm thử Frontend Vitest hiện có**, việc tối ưu nên chia thành **3 bước gọn gàng**:

### Giai đoạn P0 — Dọn dẹp Nhanh & Giải phóng Khung nhìn Đầu trang (*High Impact, Low Effort*)
*Tác động ngay tới 70% cảm giác rối mắt mà chưa cần đổi cấu trúc Router:*
1. **[`EssayHeader.tsx`](../../web/src/pages/essay/EssayHeader.tsx):**
   - Gom 6 nút xuất file thành 1 nút chính **`Sửa & Chuẩn hóa`** + 1 `DropdownMenu` **`Xuất báo cáo ▾`**.
   - Xóa badge `VERIFICATION REPORT IDE`, xóa `EXPORT AUDIT ARTIFACT`, ẩn `ID #119` khỏi mặt tiền.
   - Sửa dòng thông tin phụ để hiển thị rõ cả **Số tài liệu tham khảo** lẫn **Số lượt trích dẫn trong bài** (xóa bỏ mâu thuẫn `115` vs `53`).
2. **[`EssayPage.tsx`](../../web/src/pages/EssayPage.tsx) (Phần đầu trang):**
   - Thu gọn `Revision Progress Tracker`: nếu `cis_delta === 0 && resolved_issues_count === 0`, chỉ hiển thị 1 dòng chip nhỏ gọn; nếu có thay đổi, hiển thị thanh 1 dòng thay vì khối card 3 tầng.
   - Xóa bỏ hoàn toàn thanh **"Fake macOS Window Bar"** (3 chấm tròn Đỏ–Vàng–Xanh + dòng lặp lại tên file, Style và `VERIFIED: 50/53`).

### Giai đoạn P1 — Tái cấu trúc Không gian Rà soát 2 Cột cho Non-Tech User (*Core UX Upgrade*)
1. **[`EssayPage.tsx`](../../web/src/pages/EssayPage.tsx) (Cột Trái & Cột Phải):**
   - **Cột Trái:** Ưu tiên nhóm các trích dẫn cần kiểm tra (`suspected_hallucination`, `metadata_error`, `unresolved`) lên đầu danh sách hoặc tự động cuộn tới mục đang chọn; rút gọn thẻ trích dẫn còn 3 thông tin; ẩn badge `MATCHED` và `Conf: %` khỏi thẻ danh sách; chuyển hộp `Ngữ cảnh trong bài` sang Cột Phải.
   - **Cột Phải:** Chuyển về bố cục **3 Tầng từ trên xuống** (Hộp tóm tắt ngôn ngữ tự nhiên + Nút copy bản sửa → Bảng đối chiếu tự ẩn trường rỗng `—` & đưa dòng sai lên đầu → Đoạn văn trong bài → Ngăn Accordion thu gọn *Chi tiết kiểm chứng chuyên sâu* chứa Rules, Sources & Evidence Graph).
   - Chuẩn hóa lại màu chữ (bỏ tô cam/đỏ cả tiêu đề dài) và giảm `font-mono` sang `font-sans`.
2. **[`vi.json`](../../web/src/i18n/locales/vi.json) & [`en.json`](../../web/src/i18n/locales/en.json):**
   - Áp dụng toàn bộ **Từ điển Ngôn ngữ Đời thường Học thuật** ở Mục 6; Việt hóa triệt để các chuỗi còn sót tiếng Anh (`Citation Debugger`, `Split-Pane IDE`, `1-Click Auto-Fix`...).

### Giai đoạn P2 — Tinh gọn Hệ thống Trang con & Tách nhỏ File `EssayPage.tsx`
1. **[`EssayActionBar.tsx`](../../web/src/pages/essay/EssayActionBar.tsx) & [`router.tsx`](../../web/src/router.tsx):**
   - Hợp nhất luồng `Issues` vào thẳng bộ lọc `Cần kiểm tra` của trang Báo cáo chính (giữ redirect an toàn từ `/issues` về `?filter=issues` để không hỏng link cũ).
   - Tinh gọn thanh chuyển góc nhìn còn **3 mục đích rõ ràng**: `Danh mục trích dẫn` · `Xem trong bài viết` · `Kiểm tra khớp nối` (kèm chỉ báo số lỗi thiếu/thừa).
2. **Kiến trúc Code (`Code Maintainability`):**
   - Tách file khổng lồ [`EssayPage.tsx`](../../web/src/pages/EssayPage.tsx) (hiện dài **4,612 dòng**) thành các component con độc lập, sạch sẽ trong `web/src/pages/essay/`:
     - `ReportSummaryBar.tsx` *(Điểm độ tin cậy + Chuyển góc nhìn + Chip so sánh bản cũ)*
     - `CitationQueuePane.tsx` *(Cột trái danh sách tinh gọn)*
     - `CitationDetailPane.tsx` *(Cột phải 3 tầng thân thiện)*
     - `DeepVerificationDrawer.tsx` *(Ngăn thu gọn chứa Rules, Sources & Evidence Graph)*

---

## Tóm tắt Giá trị Đạt được sau Tối ưu

| Tiêu chí Trải nghiệm | Trước khi tối ưu (Hiện tại) | Sau khi tối ưu (Đề xuất) |
|---|---|---|
| **Thời gian hiểu kết quả đầu tiên** | ~15–30 giây (phải đọc qua 4 tầng thẻ và cuộn trang) | **< 3 giây** (thấy ngay Điểm tin cậy + mục cần sửa đầu tiên) |
| **Chiều cao phần vỏ đầu trang** | `~501px` (chiếm gần 60% màn hình) | **`~140px`** (giải phóng >350px cho nội dung chính) |
| **Ngôn ngữ hiển thị** | Nặng thuật ngữ kỹ sư AI (`IDE`, `Debugger`, `METADATA_ERROR`, `ONNX`) | **100% ngôn ngữ học thuật đời thường**, dễ hiểu với mọi ngành học |
| **Số lượng nút/tab gây phân tâm** | 6 nút xuất + 6 nút action bar + 2 mode + 4 tab con = **18 nút điều khiển** | **2 nút hành động chính + 3 góc nhìn rõ mục đích** |
| **Chiều sâu công nghệ ĐATN** | Phơi bày hết ra mặt tiền gây quá tải | **Bảo toàn 100%** bên trong ngăn *Chi tiết kiểm chứng chuyên sâu* |
