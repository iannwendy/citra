# Quy chuẩn Trình bày & Biên soạn Đồ án Tốt nghiệp TDTU (Bản Tiếng Việt — `FinalReport_TDTU_VN`)

Tài liệu đặc tả chuẩn mực bắt buộc khi viết, chỉnh sửa, định dạng và biên dịch báo cáo đồ án tốt nghiệp bản tiếng Việt (`FinalReport_TDTU_VN/thesis.pdf` và `thesis.docx`), tổng hợp đầy đủ từ **Hướng dẫn trình bày Khóa luận, Đồ án tốt nghiệp của Trường Đại học Tôn Đức Thắng** (*Mục 1–4 & Mẫu 1–10*) và **Quy định định dạng Bảng biểu & Chú thích cỡ 12 pt của Khoa Công nghệ Thông tin (CNTT)**, kèm quy ước giữ nguyên **chuẩn trích dẫn IEEE** của đề tài.

Mọi chỉnh sửa trong `FinalReport_TDTU_VN/` (Tiếng Việt) và `../FinalReport_TDTU/` (Tiếng Anh) phải luôn **đồng bộ 1–1 về bố cục mục, số liệu thực nghiệm, số bản di trú CSDL và phiên bản SemVer**.

---

## 1. Khổ giấy & Định dạng Văn bản Chính (Mục 2.1)

| Hạng mục | Quy định chuẩn TDTU | Hiện thực trong LaTeX (`format.tex`) |
| :--- | :--- | :--- |
| **Khổ giấy & Chiều in** | Giấy trắng khổ **A4 (`210 x 297 mm`)**, in một mặt, chiều đứng (portrait) | `\documentclass[12pt,a4paper]{report}` |
| **Căn lề trang** | Trên **3.5 cm** \| Dưới **3.0 cm** \| Trái **3.5 cm** \| Phải **2.0 cm** | `\usepackage[left=3.5cm, right=2cm, top=3.5cm, bottom=3cm]{geometry}` |
| **Font & Cỡ chữ thân bài** | **Times New Roman** (Unicode), cỡ **13 pt**, mật độ chữ bình thường (không nén hoặc kéo dãn khoảng cách chữ) | `\setmainfont{Times New Roman}` + `\changefontsizes{13pt}` |
| **Dãn dòng** | **1.5 lines** (`\parskip = 0pt`) | `\linespread{1.5}` / `\setstretch{1.5}` |
| **Thụt đầu dòng đoạn văn** | Dòng đầu tiên mỗi đoạn văn cách lề trái **1 tab (`1.27 cm` / `0.5 in`)** | `\usepackage{indentfirst}` + `\setlength{\parindent}{1.27cm}` |
| **Đánh số trang** | **Ở giữa, phía trên đầu mỗi trang giấy** (áp dụng cả trang mở đầu chương `plain`) | `\fancyhead[C]{\thepage}` cho cả `fancy` và `plain` |
| **Bảng/hình khổ ngang** | Hạn chế tối đa; nếu bắt buộc dùng thì đầu bảng/hình đặt tại lề trái trang | Ưu tiên bảng dọc khổ A4 với cột tỷ lệ `L`/`C`/`R` vừa khít `\textwidth` |

---

## 2. Bảng biểu, Tên bảng, Tên hình & Phương trình (Mục 2.3 + Quy định Khoa CNTT 12 pt)

### 2.1 Ma trận Cỡ chữ & Kiểu chữ Bảng/Hình (Bắt buộc theo chuẩn Khoa CNTT)

| Đối tượng | Cỡ chữ | Kiểu chữ & Nhấn mạnh | Căn chỉnh & Vị trí |
| :--- | :---: | :--- | :--- |
| **Nội dung bảng (`table`)** | **12 pt** | **Normal** (`\mdseries\upshape`) mặc định; **In đậm (`\textbf{...}`)** tại dòng tiêu đề cột, dòng phân nhóm, mã định danh/khóa chính ở cột đầu, dòng hệ thống đề xuất (**CITRA / Proposed**), trạng thái Đạt (`Pass`), ngưỡng SLA và các chỉ số tốt nhất | **Căn giữa ô theo chiều dọc (`Giữa ô`)** bằng cột `m{...}` (`L{w}`, `C{w}`, `R{w}`); cột mã/số liệu ngắn căn giữa cả ngang lẫn dọc (`C{w}`) |
| **Tên bảng (`Caption bảng`)** | **12 pt** | **Chữ thường, nghiêng (`\mdseries\itshape`)** — cả nhãn `Bảng X.Y:` lẫn nội dung tên bảng đều cỡ `12 pt`, không in đậm, in nghiêng | **Giữa, trên bảng** (`position=above, justification=centering`); dòng tiêu đề lặp trang tiếp theo của `longtable` cũng `12 pt` nghiêng căn giữa |
| **Tên hình (`Caption hình`)** | **12 pt** | **Chữ thường, nghiêng (`\mdseries\itshape`)** — cả nhãn `Hình X.Y:` lẫn nội dung tên hình đều cỡ `12 pt`, không in đậm, in nghiêng | **Giữa, dưới hình** (`position=below, justification=centering`) |
| **Tên đoạn mã (`Listing`)** | **12 pt** | **Chữ thường, nghiêng** | **Giữa, trên đoạn mã** (`captionpos=t`) |

> **Quy tắc phạm vi:** Cờ `\tdtudatatabletrue` (bật tại đầu `NoiDungChinh.tex`) tự động áp cỡ **12 pt** cho toàn bộ 32 bảng dữ liệu (`longtable` / `table`) từ Chương 1 đến Chương 6. Các bảng không viền dùng để căn lề chữ ký phần đầu (`LoiCamOn.tex`, `LoiCamDoan.tex`, `CamKet.tex`) và bảng 2 cột `P{0.22}P{0.78}` trong `DanhMucTuVietTat.tex` giữ nguyên cỡ **13 pt** của văn bản chính.

### 2.2 Quy tắc Đánh số, Đầu đề Tự thân & Tham chiếu Nội văn
- **Đánh số gắn với số chương:** Đánh số theo chương và thứ tự xuất hiện: `Bảng 4.1`, `Hình 3.2`, `Phương trình (2.1)`.
- **Đầu đề độc lập, dễ hiểu:** Đầu đề bảng/hình phải ngắn gọn, tự hiểu **mà không cần tham chiếu chéo sang chương khác** (viết *"đối chiếu với các mục tiêu nghiên cứu của đề tài"*, không viết *"đối chiếu với các mục tiêu tại Chương 1"*). Định nghĩa đầy đủ mọi ký hiệu, chữ viết tắt hoặc đơn vị tính.
- **Vị trí đặt & cách gọi trong bài:** Mọi bảng biểu và hình vẽ phải được nêu rõ số hiệu trong văn bản **trước** khi xuất hiện (`được nêu trong Bảng 4.1`, `xem Hình 3.4` — tuyệt đối không viết chung chung *"bảng dưới đây"*). Bảng ngắn và đồ thị nhỏ đặt liền ngay sau đoạn văn đề cập lần đầu.
- **Chất lượng hình vẽ & trích nguồn:** Giữ nguyên tỷ lệ hai chiều gốc (`keepaspectratio`), tuân thủ chuẩn đồ họa khoa học Q1 (`crafting-q1-scientific-figures`), và ghi rõ nguồn dưới chú thích nếu sử dụng hình ảnh có bản quyền từ tài liệu khác.
- **Phương trình toán học:** Thống nhất cách trình bày xuyên suốt báo cáo; đánh số trong ngoặc đơn `(2.1)` đặt sát **lề phải** (`\begin{equation}`); giải thích ngay ký hiệu mới và đơn vị tính khi xuất hiện lần đầu.

---

## 3. Chương & Tiểu mục (`Tiểu mục`, Mục 2.2 & Mẫu 6)

- **Tiêu đề Chương:** **16 pt In đậm IN HOA**, căn trái (`CHƯƠNG 1. GIỚI THIỆU`). Các trang mục đầu/cuối không đánh số chương (`\chapter*`): **16 pt In đậm IN HOA, Căn giữa**.
- **Độ sâu tối đa:** Tối đa **3 cấp độ tiểu mục** dưới chương (`4.1` đậm, `4.1.1` đậm, `4.1.1.1` nghiêng), chữ số đầu tiên chỉ số chương.
- **Quy tắc tối thiểu 02 tiểu mục (Không tiểu mục mồ côi):** Tại mỗi nhóm tiểu mục bắt buộc phải có **ít nhất 02 tiểu mục đồng cấp** (không được có `2.1.1` mà thiếu `2.1.2`, hoặc `4.1.1.1` mà thiếu `4.1.1.2`).

---

## 4. Viết tắt (`Viết tắt`, Mục 2.4 & Mẫu 9)

- Không lạm dụng viết tắt; chỉ viết tắt những từ, cụm từ, thuật ngữ hoặc tên tổ chức **được sử dụng nhiều lần** trong đồ án (không viết tắt mệnh đề dài hay cụm từ ít xuất hiện).
- Viết đầy đủ ở lần xuất hiện đầu tiên kèm chữ viết tắt trong ngoặc đơn, ví dụ: `Điểm toàn vẹn trích dẫn (Citation Integrity Score -- CIS)`.
- Liệt kê đầy đủ theo đúng **thứ tự bảng chữ cái A–Z** tại phần đầu báo cáo trong `DanhMucTuVietTat.tex` với tiêu đề chuẩn Mẫu 9: `DANH MỤC CÁC CHỮ VIẾT TẮT` (**16 pt In đậm, Căn giữa**).

---

## 5. Trình tự Bố cục Quyển Đồ án & Các Mẫu Chuẩn (Mục 1, Mục 3 & Mẫu 1–9)

Các tệp thành phần trong `thesis.tex` phải tuân thủ đúng thứ tự sau:

1. **Trang bìa chính (`coverpage.tex` trang 1 — Mẫu 1):** Không đánh số trang (`titlepage`).
   - `TỔNG LIÊN ĐOÀN LAO ĐỘNG VIỆT NAM` (**14 pt** thường)
   - `TRƯỜNG ĐẠI HỌC TÔN ĐỨC THẮNG` / `KHOA CÔNG NGHỆ THÔNG TIN` (**14 pt In đậm**)
   - Logo TDTU (`picture/logo`)
   - Họ và tên sinh viên (**14 pt In đậm**, không ghi MSSV trên bìa chính Mẫu 1)
   - Tên đề tài (**24 pt In đậm**, IN HOA)
   - `ĐỒ ÁN TỐT NGHIỆP` / `NGÀNH: KỸ THUẬT PHẦN MỀM` (**22 pt In đậm**, IN HOA)
   - `THÀNH PHỐ HỒ CHÍ MINH, NĂM 2026` (**14 pt In đậm**)
2. **Trang phụ bìa (`coverpage.tex` trang 2 — Mẫu 2):** Không đánh số trang (`titlepage`).
   - Cụm tiêu đề Trường/Khoa (**14 pt** thường / **14 pt In đậm**) + Logo TDTU
   - Họ và tên sinh viên `--` Mã số sinh viên (**14 pt In đậm**)
   - Tên đề tài (**22 pt In đậm**, IN HOA)
   - `ĐỒ ÁN TỐT NGHIỆP` / `NGÀNH: KỸ THUẬT PHẦN MỀM` (**20 pt In đậm**, IN HOA)
   - `Người hướng dẫn` (**14 pt** thường) + Học hàm/học vị & Họ tên GVHD (**14 pt In đậm**)
   - `THÀNH PHỐ HỒ CHÍ MINH, NĂM 2026` (**14 pt In đậm**)
3. **Trang Lời cảm ơn (`LoiCamOn.tex` — Mẫu 3):** `LỜI CẢM ƠN` (**16 pt In đậm, Căn giữa**), trình bày ngắn gọn, góc dưới bên phải in nghiêng ngày tháng năm và khối chữ ký tác giả. Không đánh số trang.
4. **Trang Xác nhận & Lời cam đoan (`LoiCamDoan.tex` Mẫu 4-1 + `CamKet.tex` Mẫu 4-2):**
   - `LoiCamDoan.tex`: Cán bộ hướng dẫn khoa học, dòng bảo vệ tại **Hội đồng đánh giá Đồ án tốt nghiệp của Trường Đại học Tôn Đức Thắng**, khối chữ ký `CHỦ TỊCH HỘI ĐỒNG` và `TRƯỞNG KHOA`. Không đánh số trang.
   - `CamKet.tex`: Tiêu đề chuẩn Mẫu 4-2 `CÔNG TRÌNH ĐƯỢC HOÀN THÀNH \\ TẠI TRƯỜNG ĐẠI HỌC TÔN ĐỨC THẮNG` (**16 pt In đậm, Căn giữa**), cam đoan tính trung thực và trích dẫn nguồn gốc, in đậm câu chịu trách nhiệm gian lận, khối chữ ký tác giả. Không đánh số trang.
5. *(Phiếu giao nhiệm vụ — chèn bản có chữ ký khi đóng quyển nộp Khoa nếu có yêu cầu.)*
6. **Tóm tắt / Abstract song ngữ (`TomTatVN.tex` + `TomTat.tex` — Mẫu 5):**
   - Tên đề tài + `TÓM TẮT` / `ABSTRACT` (**16 pt In đậm, Căn giữa**), nội dung cỡ **13 pt** trong 1–2 trang (tóm tắt vấn đề, hướng tiếp cận, phương pháp giải quyết, kết quả định lượng nổi bật và `Từ khóa` / `Keywords`). Không đánh số trang.
7. **Mục lục (`MucLuc.tex` — Mẫu 6):** `MỤC LỤC` (**16 pt In đậm, Căn giữa**), không đánh số trang, liệt kê đầy đủ từ `DANH MỤC HÌNH VẼ`, `DANH MỤC BẢNG BIỂU`, `DANH MỤC CÁC CHỮ VIẾT TẮT`, `CHƯƠNG 1. ...` đến `CHƯƠNG 6. ...`, `TÀI LIỆU THAM KHẢO` và `PHỤ LỤC`.
8. **Danh mục hình vẽ (`MucLuc.tex` — Mẫu 7):** `DANH MỤC HÌNH VẼ` (**16 pt In đậm, Căn giữa**), đánh số trang La Mã (`i, ii, ...`), định dạng dòng `Hình 1.1: Tên hình ... trang`.
9. **Danh mục bảng biểu (`MucLuc.tex` — Mẫu 8):** `DANH MỤC BẢNG BIỂU` (**16 pt In đậm, Căn giữa**), đánh số trang La Mã, định dạng dòng `Bảng 1.1: Tên bảng ... trang`.
10. **Danh mục các chữ viết tắt (`DanhMucTuVietTat.tex` — Mẫu 9):** `DANH MỤC CÁC CHỮ VIẾT TẮT` (**16 pt In đậm, Căn giữa**), đánh số trang La Mã, xếp theo thứ tự A–Z.
11. **Nội dung chính (`NoiDungChinh.tex` — Chương 1 đến Chương 6):** Đánh số trang Ả Rập bắt đầu từ `1` (`chapter1_rewritten.tex`..`chapter6_rewritten.tex`):
    - Chương 1: Giới thiệu (bối cảnh, bài toán, mục tiêu, phạm vi, đóng góp, bố cục)
    - Chương 2: Cơ sở lý thuyết và Các nghiên cứu liên quan (phân tích công trình trong/ngoài nước, khoảng trống nghiên cứu, cơ sở toán học)
    - Chương 3: Phân tích và Thiết kế hệ thống (FR theo IEEE 29148, NFR theo ISO/IEC 25010, RBAC/UML, CSDL 15 bảng, API & bảo mật)
    - Chương 4: Kiến trúc hệ thống và Hiện thực hóa (8 tầng phần mềm, 68 luật ký hiệu, MLR 16 chiều + Platt, CIS, giao diện React)
    - Chương 5: Kiểm định hệ thống và Kết quả thực nghiệm (RTM, kiểm thử tự động, 120K ID, 2.4K OOD, 310 PDF, độ trễ/chịu tải, đe dọa độ giá trị)
    - Chương 6: Kết luận và Hướng phát triển (trình bày ngắn gọn các kết quả đạt được theo Mục 1(5), hạn chế hiện tại và hướng nghiên cứu tiếp theo)
12. **Tài liệu tham khảo (`TaiLieuThamKhao.tex`) — QUY ƯỚC GIỮ NGUYÊN CHUẨN IEEE:**
    - **Bắt buộc giữ nguyên chuẩn đánh số IEEE (`[1]`, `[2]`, ...)** sử dụng `\begin{thebibliography}{99}` và lệnh `\cite{...}` xuyên suốt Chương 1–6 (thay cho phần trình bày APA trong hướng dẫn chung, theo yêu cầu cố định của tác giả và thông lệ đồ án ngành CNTT).
    - Mọi ý kiến, số liệu, công thức, hình vẽ, bộ dữ liệu hoặc chuẩn kỹ thuật không phải của riêng tác giả đều phải trích dẫn đầy đủ và khớp chính xác với danh mục tham khảo; không trích dẫn kiến thức phổ thông.
    - Tên các bài báo, sách, tài liệu bằng tiếng nước ngoài **giữ nguyên văn gốc, không phiên âm, không dịch**; riêng cụm thông tin truy cập trực tuyến trong bản tiếng Việt phải Việt hóa thống nhất: `Truy cập ngày DD/MM/YYYY. [Trực tuyến]. Địa chỉ: \url{...}` (tuyệt đối không để sót `Accessed:` hay `[Online]. Available:` trong `FinalReport_TDTU_VN/TaiLieuThamKhao.tex`).
    - Nếu trích dẫn nguyên văn đoạn dài thì tách thành đoạn riêng, in nghiêng, lùi lề trái thêm `2 cm`, không đặt trong dấu ngoặc kép (Mục 2.5).
13. **Phụ lục (`PhuLuc.tex` — Mục 2.7):** `PHỤ LỤC` (**16 pt In đậm, Căn giữa**). Chứa cấu hình mẫu, bảng phân loại nhãn, sơ đồ gói mã nguồn và nhật ký phân công thực hiện. Tổng số trang Phụ lục **không được dày hơn phần nội dung chính**.
14. **Đóng bìa & Nộp lưu trữ điện tử (Mục 4 & Mẫu 10):** Bìa simili xanh lá cây in chữ nhũ vàng (sau khi Hội đồng thông qua); thư mục điện tử đặt tên `MSSV_HoTenSV/` gồm `Readme`, `Word/` (`.docx`), `Pdf/` (`.pdf`), `Resource/` và `Source/`.

---

## 6. Quy trình Biên dịch & Kiểm tra Chất lượng (Bắt buộc trước khi hoàn tất)

Thực thi đầy đủ các bước sau mỗi khi cập nhật nội dung hoặc định dạng báo cáo:

```bash
# 1. Biên dịch XeLaTeX 3 lượt để hội tụ Mục lục, Danh mục Hình/Bảng và độ rộng longtable
cd FinalReport_TDTU_VN && xelatex -interaction=nonstopmode thesis.tex && xelatex -interaction=nonstopmode thesis.tex && xelatex -interaction=nonstopmode thesis.tex

# 2. Xuất lại tệp Word (.docx) khi cần thiết
cd FinalReport_TDTU_VN && pandoc thesis_docx.tex -f latex -t docx -o thesis.raw.docx && python3 format_docx.py thesis.raw.docx thesis.docx && rm -f thesis.raw.docx

# 3. Chạy kịch bản kiểm tra định dạng PDF tự động & bộ kiểm thử hồi quy từ thư mục gốc
.venv/bin/python scripts/verify_thesis_pdf.py
.venv/bin/python -m pytest tests/unit/test_se_audit_devops_configs_and_docs.py tests/unit/test_final_report_thesis_eng_vie_regressions.py -q
```

Tiêu chí hoàn thành: **0** tham chiếu/trích dẫn lỗi (`??`), **0** tiểu mục mồ côi, đúng cỡ **12 pt** cho toàn bộ nội dung bảng dữ liệu và tên bảng/tên hình (chữ thường nghiêng, căn giữa), đúng cỡ **13 pt** cho văn bản chính, Bìa 1 (`24 pt / 22 pt`) và Bìa 2 (`22 pt / 20 pt`) gói gọn mỗi bìa đúng 1 trang, và đồng bộ hoàn toàn số liệu/phiên bản giữa bản Tiếng Anh và Tiếng Việt.
