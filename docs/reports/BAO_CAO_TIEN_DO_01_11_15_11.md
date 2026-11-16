# BÁO CÁO TIẾN ĐỘ ĐỒ ÁN TỐT NGHIỆP (01/11/2026 – 15/11/2026)

- **Đề tài:** Hệ thống Kiểm chứng Tính Toàn vẹn Trích dẫn Học thuật Neuro-Symbolic (**CITRA**)
- **Thời gian:** 2 tuần (`01/11/2026` – `15/11/2026`)
- **Tổng khối lượng:** **202 commits** — Tập trung kiểm toán diện rộng trên hàng nghìn tệp PDF, tối ưu tốc độ chịu tải mùa nộp bài và hoàn thiện tính năng sản phẩm.

---

## 1. BẢNG SO SÁNH TÍNH NĂNG TRƯỚC VÀ SAU CẢI TIẾN

| Hạng mục | Trước đây (Đến 01/11) | Hiện tại (15/11 — Sau 2 tuần) | Ý nghĩa thực tế |
| :--- | :--- | :--- | :--- |
| **Đọc PDF cũ & PDF scan** | Chỉ cảnh báo lỗi khi gặp PDF scan ảnh hoặc lỗi font TCVN3/VNI cũ. | Tự động chuyển mã **TCVN3/VNI-Windows**, **OCR chọn lọc trang** và có `PdfPlumber` dự phòng. | Đọc chuẩn xác khóa luận, giáo trình cũ tại các trường ĐH Việt Nam. |
| **Định dạng đầu vào** | Chỉ hỗ trợ tải lên file `.PDF` và `.DOCX`. | Hỗ trợ thêm tệp danh mục chuẩn **`.bib` (BibTeX)** và **`.ris` (RIS)**. | Sinh viên/nhà nghiên cứu kiểm tra nhanh trực tiếp từ Zotero, Mendeley, LaTeX. |
| **Xác thực nguồn đặc thù VN & Web** | Chủ yếu đối sánh bài báo quốc tế và văn bản luật cơ bản. | Bổ sung bộ xác thực **TCVN/QCVN**, giáo trình VN và đọc trực tiếp **HTML/Wayback Machine** (chống SSRF). | Giảm mạnh cảnh báo sai trên đồ án kỹ thuật, xây dựng và nguồn báo điện tử. |
| **Mô hình Ngữ nghĩa & Suy luận** | Dùng encoder tiêu chuẩn; dễ đánh đồng thiếu thông tin với bịa đặt. | Nén mô hình đa ngữ **ONNX INT8**; tách riêng lỗi thiếu thông tin (`R-INCOMPLETE-METADATA`) khỏi lỗi bịa đặt. | Tăng tốc suy luận trên CPU và chấm điểm công bằng, minh bạch hơn. |
| **Quản lý CSDL (Database)** | Chạy lệnh `ALTER TABLE` thủ công khi khởi động ứng dụng. | Chuẩn hóa **10 bản Alembic Migrations**, bật **SQLite WAL** tăng tốc ghi đồng thời và CLI sao lưu tự động. | Dễ dàng nâng cấp, khôi phục dữ liệu an toàn trên môi trường Production. |
| **Xuất báo cáo & Chia sẻ** | Chỉ xuất file PDF/DOCX tĩnh thông thường. | Tạo **Link chia sẻ bảo mật** và đóng dấu **Biên lai số + Mã QR** chống giả mạo vào PDF/DOCX. | Giảng viên quét QR đối chiếu kết quả gốc ngay lập tức, chống chỉnh sửa file. |
| **Thanh toán & Pháp lý** | Thanh toán cơ bản, chưa có cổng nội địa và trang pháp lý chuẩn VN. | Tích hợp **VNPay v2.1.0**, Stripe/Apple/Google Pay, mã giảm giá và tuân thủ **Luật BVDLCN VN (PDPL 2025)**. | Sẵn sàng vận hành thực tế tại Việt Nam với đầy đủ cơ chế tự xóa dữ liệu cá nhân. |

---

## 2. BẢNG SO SÁNH HIỆU NĂNG & TỐC ĐỘ XỬ LÝ (BEFORE vs. AFTER)

| Chỉ số Hiệu năng / Tốc độ | Trước tối ưu | Sau tối ưu (Hiện tại) | Cải thiện / Kết quả đạt được |
| :--- | :--- | :--- | :--- |
| **Tốc độ xử lý toàn trình (Cold vs. Warm Cache)** | `9.41s` / bài báo chuẩn (gọi trực tiếp API ngoài chưa cache). | **`0.48s` (`484.8 ms`)** / bài báo (kết hợp GROBID TEI Cache + SQLite FTS5). | **Nhanh gấp `19.4×`** toàn trình; riêng bước truy xuất nhanh gấp **`688.7×`** (`8,635ms` $\rightarrow$ `12.5ms`). |
| **Độ trễ khóa luận 35–40 trích dẫn (Mạng ngoài)** | `41.0s – 56.8s` (truy vấn tuần tự từng tài liệu). | **`8.0s – 13.5s`** (nhờ tải trước hàng loạt **Wave-0 Batch DOI/arXiv** + Circuit Breaker). | **Giảm `~75%` thời gian chờ** ở lần chấm đầu tiên chưa có cache. |
| **Nộp bài theo lớp 30–60 SV (Trùng tài liệu tham khảo)** | `35.0s – 50.0s` / bài, dễ bị chặn `HTTP 429` từ API học thuật. | **`2.0s – 4.5s` / bài** (nhờ **Persistent TTL Cache** dùng chung xuyên văn bản). | **Giảm `~90%` độ trễ**, triệt tiêu lỗi nghẽn hạn ngạch API bên thứ ba. |
| **Tốc độ Pipeline nội bộ theo quy mô tài liệu ($P_{50}$)** | Bị nghẽn do mã hóa lặp SBERT và chạy đồng bộ trên luồng chính. | • Bài báo **12 trang**: **`0.49s`**<br>• Khóa luận **50 trang**: **`1.31s`**<br>• Luận văn **156 trang**: **`4.16s`** | Tách bạch 8 bước bất đồng bộ; tổng RAM tiêu thụ giữ ổn định **`835 MB – 1,031 MB`** (`< 45%` trần container). |
| **Chịu tải mùa nộp bài (`20 – 50` SV nộp đồng thời)** | Dễ khóa cứng DB (`SQLite database is locked`) hoặc lỗi `502/429`. | **`100%` thành công (`50/50` bài)**, thông lượng đạt **`24.5 – 30.1` bài/giây**. | **`0` lỗi khóa SQLite, `0` lỗi HTTP 5xx/429** nhờ `DeadlineQueueManager` 4 lớp + chế độ `SQLite WAL`. |
| **Độ trễ cập nhật tiến trình lên Giao diện Web** | Hỏi lặp HTTP Polling mỗi `2,000 ms` (tạo `20–40 req/s` khi nộp theo lô). | Đẩy tức thì qua luồng **SSE (`< 50 ms`)** xuyên qua Nginx/GZip. | Hiển thị mượt theo thời gian thực, giảm tải hàng chục request thừa mỗi giây cho server. |
| **Mô hình AI Đa ngữ & Khôi phục sự cố** | Model nặng; nếu container restart giữa chừng sẽ mất bài đang chấm và mất lượt dùng. | Nén model đa ngữ **ONNX INT8 (`~118 MB`)**; tự chạy tiếp hoặc hoàn trả quota nguyên tử. | Tăng tốc chạy trên CPU thường và đảm bảo **`100%` không mất lượt upload** của sinh viên. |

---

## 3. THỐNG KÊ QUY MÔ XỬ LÝ PDF & TỶ LỆ KHẮC PHỤC BUG (AUDIT & QA)

### 3.1. Quy mô kiểm định thực nghiệm trên tệp PDF thực tế
| Hạng mục Thống kê | Con số Đạt được | Chi tiết Tập dữ liệu Thực nghiệm |
| :--- | :---: | :--- |
| **Tổng số tệp PDF kiểm toán toàn hệ thống** | **`1,064` PDF** (`844` file độc lập) | Quét qua toàn bộ **38 thư mục** dự án: Khóa luận ĐH quốc tế (`220` file), ĐH Việt Nam & TDTU (`276` file), 12 chuẩn trích dẫn quốc tế (`300` file), Pháp luật VN (`36` file) & kịch bản khó/đối kháng. |
| **Tổng số Tài liệu tham khảo & Trích dẫn đã bóc tách** | **`38,317` Refs · `67,504` In-text** | Tạo ra **`78,825` cạnh liên kết** kiểm chứng hai chiều (`cite` $\leftrightarrow$ `ref`). |
| **Tỷ lệ Upload ổn định & Khớp liên kết toàn cục** | **`100%` HTTP 200 OK** (`0` crash) | Kích hoạt thành công GROBID 0.9.1 trên **`96.05%`** tài liệu; tỷ lệ liên kết khớp chính xác đạt **`94.68%`** trước khi vá và đạt **`100%`** trên bộ chuẩn `525` PDF đa phong cách & ĐH Việt Nam. |

### 3.2. Tỷ lệ khắc phục lỗi qua 3 đợt Tổng rà soát (System Audits)
| Đợt Kiểm toán (Audit) | Phạm vi Rà soát | Số Bug Phát hiện | Đã Khắc phục | Tỷ lệ Fix | Kết quả Nghiệm thu |
| :--- | :--- | :---: | :---: | :---: | :--- |
| **Đợt 1 — Full Pipeline & Live Batch Check E2E** *(04/11)* | Luồng chấm trực tuyến 15+ API, luật suy diễn, điểm CIS & tải lên hàng loạt (`P0–P2`). | `20` bugs | **`20 / 20`** | **`100%`** | Xóa bỏ hoàn toàn lỗi lệch điểm CIS giữa đơn lẻ/hàng loạt, chặn file PDF hỏng cấu trúc và chuẩn hóa đối sánh năm/tác giả. |
| **Đợt 2 — Full-Stack UI/UX, Billing, A11y & Bảo mật** *(11–12/11)* | Thanh toán Stripe/VNPay, phân quyền, đa ngôn ngữ Anh–Việt, WCAG A11y & Linter. | `11` bugs | **`11 / 11`** | **`100%`** | Chặn lỗ hổng giả mạo trang thanh toán thành công, đồng bộ 100% song ngữ VI/EN và đạt `0` cảnh báo ESLint/Ruff. |
| **Đợt 3 — Parsing, Hybrid GROBID & Linking trên 1,064 PDF** *(13–15/11)* | Tách mục tham khảo, gộp dòng GROBID, rò rỉ header/footer, trích dẫn gộp & lưu trữ DB. | `16` bugs | **`16 / 16`** | **`100%`** | **`0` rơi mất kết quả** trên API `/report`, khôi phục 100% số thứ tự bị trượt và xử lý trọn vẹn trích dẫn gộp `14a/14b`, luật VN. |
| **TỔNG CỘNG TOÀN ĐỢT (01/11 – 15/11)** | **Toàn bộ Backend, AI Pipeline, Database & Web UI** | **`47` bugs** | **`47 / 47`** | **`100%`** | Hệ thống vượt qua **`1,800+` Backend Pytest**, **`247+` Vitest** và **`159+` Playwright E2E tests** (`100% PASS`). |

---

## 4. TÓM TẮT NGẮN GỌN CÁC HẠNG MỤC ĐÃ LÀM (DÙNG ĐỂ TRÌNH BÀY NHANH)

### 4.1. Lõi Trích xuất, Liên kết & Xác thực Trích dẫn (NLP & AI)
- **Nâng cấp GROBID 0.9.1 & Xử lý PDF khó:** Tích hợp bộ chuyển mã phông tiếng Việt cũ (TCVN3, VNI), OCR tự động trên các trang scan ảnh và trình đọc dự phòng `PdfPlumber`.
- **Chuẩn hóa liên kết đa chuẩn:** Hỗ trợ trích dẫn gộp hóa học ACS/RSC (`14a, 14b`), viết tắt tạp chí chuẩn ISO-4 và phát hiện tài liệu tham khảo trùng lặp (`DUPLICATE_REFERENCE`).
- **Mở rộng xác thực nguồn Việt Nam & Web:** Xây dựng danh mục kiểm chứng tiêu chuẩn quốc gia (TCVN/QCVN), giáo trình đại học VN và xác thực tiêu đề/metadata từ link web sống hoặc Wayback Machine.
- **Tối ưu Neuro-Symbolic & ONNX INT8:** Nén mô hình đa ngữ Việt–Anh sang ONNX INT8 chạy nhanh trên CPU; hoàn thiện 30 luật suy diễn và tách riêng lỗi thiếu thông tin khỏi lỗi bịa đặt nguồn.
- **Hỗ trợ file BibTeX & RIS:** Cho phép tải lên trực tiếp tệp `.bib` và `.ris` để kiểm tra danh mục tài liệu tham khảo độc lập.

### 4.2. Tính năng Hệ thống, Nghiệp vụ & Bảo mật
- **Biên lai xác thực số & QR Code:** Cấp liên kết chia sẻ báo cáo có chữ ký bảo mật, đính kèm con dấu xác thực và mã QR quét bằng camera vào file PDF/DOCX xuất ra.
- **Phân hệ Giảng viên, Batch Check & API Key:** Hoàn thiện luồng quản lý Lớp học – Sinh viên, tải lên chấm hàng loạt (3 luồng song song) và cấp `X-API-Key` cá nhân.
- **Cổng thanh toán & Quản trị:** Tích hợp thanh toán nội địa VNPay (HMAC-SHA512), ví Apple/Google Pay và trang quản lý mã khuyến mãi cho Admin.
- **Bảo mật & Tuân thủ luật Việt Nam:** Đáp ứng Nghị định 356 & Luật Bảo vệ dữ liệu cá nhân 91/2025 (trang chính sách riêng, tự xóa tài khoản) và chặn lỗ hổng đọc XML độc hại (`defusedxml`).

### 4.3. Tối ưu Hiệu năng, Chịu tải & Cơ sở dữ liệu
- **Tăng tốc truy vấn học thuật:** Áp dụng tải trước hàng loạt (Wave-0 batch pre-fetch) cho DOI/arXiv, bộ nhớ đệm LRU/TTL xuyên văn bản và tự động chuyển hướng dự phòng khi hết quota.
- **Kiến trúc chịu tải cao điểm:** Triển khai hàng đợi ưu tiên 4 lớp (`DeadlineQueueManager`), bộ ngắt mạch tự động 3 trạng thái (Circuit Breaker) và cơ chế tự phục hồi bài chấm dở khi server khởi động lại.
- **Luồng thời gian thực & Bất đồng bộ:** Đẩy tác vụ nặng và gửi email sang luồng nền; truyền tiến độ xử lý trực tiếp qua luồng **SSE** không trễ thay cho cơ chế hỏi lặp cũ.
- **Quản trị CSDL & Thực nghiệm Chương 5:** Triển khai hệ thống quản lý phiên bản DB Alembic (10 migrations), chế độ SQLite WAL và hoàn thành bộ đo kiểm tải thực tế (20–50 sinh viên nộp đồng thời) đưa vào khóa luận.

### 4.4. Giao diện (UI/UX), Đa ngôn ngữ & Kiểm thử Tự động
- **Trải nghiệm người dùng & Phông chữ Tiếng Việt:** Bổ sung hiệu ứng chuyển động 120fps, hiển thị trực tiếp luồng suy luận AI khi chờ chấm bài, bổ sung đủ 134 ký tự tiếng Việt cho bộ font hiển thị và đồng bộ song ngữ Anh–Việt 100%.
- **Kiểm thử & Tự động hóa triển khai (CI/CD):** Khắc phục **100% (`47/47`)** lỗi phát hiện qua 3 đợt kiểm toán trên `1,064` PDF, mở rộng test tự động Playwright đa thiết bị và tự động đẩy Docker image lên `ghcr.io`.
