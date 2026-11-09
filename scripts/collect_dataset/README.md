# Corpus Collection Scripts

Thư mục này chứa các script tự động thu thập bộ dữ liệu thực nghiệm PDF từ các nguồn mở phục vụ đánh giá End-to-End:

- `collect_github_reports.py`: Thu thập báo cáo môn học và khóa luận sinh viên TDTU từ GitHub (`tdtu_github_reports/`).
- `collect_tdtu_idiscovery.py`: Thu thập 100 khóa luận/đồ án/tiểu luận/luận văn từ cổng thư viện `idiscovery.tdtu.edu.vn` (`TDTU_PDF/`). Hỗ trợ `--prefetch-only` khi ở ngoài mạng trường và tải PDF toàn văn khi kết nối Wi-Fi/VPN nội bộ TDTU.
- `collect_vn_uni_theses.py`: Thu thập 100 khóa luận/đồ án/tiểu luận/luận văn/luận án PDF thực tế từ các trường đại học Việt Nam (ĐH Kinh tế - ĐH Đà Nẵng DSpace `thuvien.due.udn.vn`, UIT, HCMUT, HCMUS, HUST, PTIT, HCMUTE, UEH, FPTU, TDTU...) vào `TDTU_PDF/`.
- `collect_style_corpora.py`: Thu thập tài liệu học thuật thực tế theo 11 chuẩn trích dẫn (`style_corpora/`).
- `collect_vn_legal_reports.py`: Thu thập báo cáo và khóa luận pháp lý tiếng Việt (`vn_legal_reports/`).
- `collect_200_open_theses.py`: Thu thập 200 khóa luận tốt nghiệp đại học/cao học tiếng Anh (`Bachelor's / Honors / Master's Theses`) từ các kho luận văn mở không chặn Cloudflare (Helda - University of Helsinki, Osuva - University of Vaasa, Zenodo Open Theses, OpenAlex OA Dissertations) vào `20-theses/21.pdf..220.pdf` và `200-theses/`.
