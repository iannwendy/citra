#!/usr/bin/env python3
"""
Collect 100 BRAND-NEW, multi-disciplinary real student essays, course reports,
internship reports, graduation theses, and capstone projects (Tiểu luận, Báo cáo,
Khóa luận, Đồ án, Thuyết minh đồ án, Luận văn) in PDF format across Vietnamese
universities (North - Central - South) into VN_UNI_PDF_BATCH2/.

Uses a 12-worker ThreadPoolExecutor for concurrent repository tree inspection and
CDN PDF downloads while pacing /search/repositories at <=25 req/min.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import json
import os
import re
import subprocess
import sys
import threading
import time
import unicodedata
from pathlib import Path
from urllib.parse import quote

import fitz  # PyMuPDF
import requests
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

GITHUB_API = "https://api.github.com"
RAW_GITHUB = "https://raw.githubusercontent.com"
VNU_DSPACE7 = "https://repository.vnu.edu.vn/server/api"

# 10 Discipline Clusters (both accented Vietnamese & ASCII queries for maximum recall)
DISCIPLINE_QUERY_GROUPS: list[tuple[str, int, list[str]]] = [
    (
        "KinhTe_TaiChinh_KeToan_NganHang",
        13,
        [
            "Tiểu luận kinh tế",
            "Kinh tế lượng",
            "Kinh te luong",
            "Tài chính doanh nghiệp",
            "Tai chinh doanh nghiep",
            "Báo cáo thực tập kế toán",
            "Ke toan kiem toan",
            "Phân tích tài chính",
            "Thị trường chứng khoán tiểu luận",
            "Ngân hàng thương mại tiểu luận",
            "Kinh tế vĩ mô tiểu luận",
            "Kinh tế quốc tế tiểu luận",
            "UEH tiểu luận",
            "FTU khóa luận",
            "NEU tiểu luận",
        ],
    ),
    (
        "QTKD_Marketing_Logistics_TMDT_DuLich",
        13,
        [
            "Tiểu luận quản trị kinh doanh",
            "Quan tri kinh doanh",
            "Tiểu luận Marketing",
            "Tieu luan Marketing",
            "Thương mại điện tử báo cáo",
            "Thuong mai dien tu",
            "Quản trị chuỗi cung ứng",
            "Logistics tiểu luận",
            "Quản trị nhân lực tiểu luận",
            "Hành vi khách hàng tiểu luận",
            "Quản trị chiến lược tiểu luận",
            "Digital Marketing báo cáo",
            "Du lịch khách sạn báo cáo",
            "Quản trị dự án báo cáo",
        ],
    ),
    (
        "Luat_ChinhTri_TrietHoc_XaHoiHoc",
        13,
        [
            "Tiểu luận triết học",
            "Triết học Mác Lênin",
            "Tiểu luận kinh tế chính trị",
            "Kinh te chinh tri",
            "Chủ nghĩa xã hội khoa học",
            "Chu nghia xa hoi khoa hoc",
            "Tư tưởng Hồ Chí Minh tiểu luận",
            "Tu tuong Ho Chi Minh",
            "Lịch sử Đảng tiểu luận",
            "Lich su Dang",
            "Pháp luật đại cương tiểu luận",
            "Tiểu luận luật thương mại",
            "Tiểu luận luật dân sự",
            "Tiểu luận luật lao động",
            "Xã hội học tiểu luận",
        ],
    ),
    (
        "CoKhi_OTo_CoDienTu_CheTaoMay",
        11,
        [
            "Đồ án cơ khí",
            "Do an co khi",
            "Đồ án chi tiết máy",
            "Do an chi tiet may",
            "Công nghệ chế tạo máy đồ án",
            "Cong nghe che tao may",
            "Đồ án ô tô",
            "Đồ án cơ điện tử",
            "Do an co dien tu",
            "Thuyết minh đồ án cơ khí",
            "Kỹ thuật nhiệt lạnh đồ án",
            "Đồ án robot",
        ],
    ),
    (
        "Dien_DienTu_TuDongHoa_IoT_ViMach",
        11,
        [
            "Đồ án điện tử",
            "Do an dien tu",
            "Đồ án tự động hóa",
            "Do an tu dong hoa",
            "Đồ án vi điều khiển",
            "Do an vi dieu khien",
            "Đồ án PLC",
            "Do an PLC",
            "Đồ án hệ thống nhúng",
            "Đồ án cung cấp điện",
            "Truyền động điện đồ án",
            "Thiết kế vi mạch đồ án",
            "Đồ án viễn thông",
        ],
    ),
    (
        "XayDung_KienTruc_GiaoThong_MoiTruong",
        10,
        [
            "Đồ án xây dựng",
            "Do an xay dung",
            "Đồ án bê tông cốt thép",
            "Đồ án nền móng",
            "Do an nen mong",
            "Đồ án cầu đường",
            "Quản lý dự án xây dựng",
            "Đồ án cấp thoát nước",
            "Kỹ thuật môi trường đồ án",
            "Xử lý nước thải đồ án",
            "Thuyết minh đồ án xây dựng",
        ],
    ),
    (
        "HoaSinh_ThucPham_NongLam_YDuoc",
        10,
        [
            "Công nghệ thực phẩm đồ án",
            "Cong nghe thuc pham",
            "Kỹ thuật hóa học đồ án",
            "Công nghệ sinh học khóa luận",
            "Kỹ thuật y sinh đồ án",
            "Ky thuat y sinh",
            "Dược học khóa luận",
            "Y tế báo cáo nghiên cứu",
            "Nông nghiệp thông minh đồ án",
            "Thủy sản khóa luận",
            "HUFI khóa luận",
            "HUIT đồ án",
            "Hóa phân tích báo cáo",
        ],
    ),
    (
        "SuPham_NgonNgu_TamLy_TruyenThong",
        8,
        [
            "Phương pháp nghiên cứu khoa học tiểu luận",
            "Phuong phap nghien cuu khoa hoc",
            "Tâm lý học tiểu luận",
            "Giáo dục học tiểu luận",
            "Ngôn ngữ Anh khóa luận",
            "Truyền thông đa phương tiện báo cáo",
            "Văn hóa Việt Nam tiểu luận",
            "Kỹ năng mềm tiểu luận",
            "Thống kê ứng dụng tiểu luận",
            "Nghiên cứu khoa học sinh viên",
        ],
    ),
    (
        "HTTT_KhoaHocDuLieu_ATTT_Mang",
        8,
        [
            "Hệ thống thông tin quản lý báo cáo",
            "He thong thong tin quan ly",
            "Phân tích dữ liệu kinh doanh",
            "Khai phá dữ liệu báo cáo",
            "An toàn thông tin đồ án",
            "An toan thong tin do an",
            "Phân tích thiết kế hệ thống báo cáo",
            "Quản trị cơ sở dữ liệu đồ án",
            "Kiểm thử phần mềm báo cáo",
            "PTIT đồ án",
        ],
    ),
    (
        "CNTT_AI_PhanMem_DaTruong",
        9,
        [
            "Khóa luận tốt nghiệp",
            "Khoa luan tot nghiep",
            "Đồ án tốt nghiệp",
            "Do an tot nghiep",
            "Luận văn tốt nghiệp",
            "Báo cáo thực tập tốt nghiệp",
            "FPT Capstone Project",
            "TDTU khóa luận",
            "HCMUS khóa luận",
            "HCMUT luận văn",
            "CTU luận văn",
            "IUH khóa luận",
            "SGU đồ án",
            "HUTECH đồ án",
            "Văn Lang đồ án",
            "Phenikaa đồ án",
        ],
    ),
]

EXCLUDE_REPO_OR_PATH_RE = re.compile(
    r"("
    r"node_modules|vendor|assets/|third[_-]?party|packages/|site-packages|"
    r"textmesh|shader|polyspace|misra|turnitin|rulebook|manual|datasheet|"
    r"resume|cv[_.-]|certificate|bangdiem|bang_diem|score|transcript|"
    r"slide|presentation|poster|pitch|banner|brochure|powerpoint|pptx|"
    r"syllabus|de_cuong|decuong|đề\s*cương|de_bai|debai|de-bai|huong_dan|huongdan|guideline|rubric|"
    r"template|skeleton|boilerplate|sample|example|empty|thesis[_-]?kit|latex[_-]?template|"
    r"quy[_-]?dinh|quydinh|bieu[_-]?mau|bieumau|uitm|arctic|norway|tromso|"
    r"lab\s*0?\d|exercise|baitap|bai_tap|tutorial|cheat[_-]?sheet|checklist|"
    r"trac_nghiem|tracnghiem|trắc\s*nghiệm|cau_hoi|cauhoi|câu\s*hỏi|dap_an|dapan|đáp\s*án|"
    r"de_thi|dethi|đề\s*thi|on_tap|ontap|ôn\s*tập|giao_trinh|giaotrinh|giáo\s*trình|"
    r"bai_giang|baigiang|bài\s*giảng|sach_giao_khoa|catalog"
    r")",
    re.IGNORECASE,
)

CANDIDATE_PDF_NAME_RE = re.compile(
    r"("
    r"report|baocao|bao_cao|bao-cao|báo\s*cáo|"
    r"tieuluan|tieu_luan|tieu-luan|tiểu\s*luận|"
    r"khoaluan|khoa_luan|khoa-luan|khóa\s*luận|khoá\s*luận|"
    r"luanvan|luan_van|luận\s*văn|luanan|luan_an|luận\s*án|"
    r"doan|do_an|do-an|đồ\s*án|datn|kltn|lvtn|dacn|damh|dacs|btl|"
    r"thuyetminh|thuyet_minh|thuyet-minh|thuyết\s*minh|"
    r"thuctap|thuc_tap|thực\s*tập|chuyende|chuyen_de|chuyên\s*đề|"
    r"nckh|nghiencuu|nghiên\s*cứu|"
    r"midterm|final|giuaky|giua_ky|cuoiky|cuoi_ky|capstone|"
    r"essay|thesis|dissertation|graduation|project|nhom|nhóm|group|main|full|nop_bai"
    r")",
    re.IGNORECASE,
)

VN_DIACRITIC_RE = re.compile(
    r"[àáảãạăắằẳẵặâấầẩẫậđèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵ]",
    re.IGNORECASE,
)

VN_ENGLISH_UNI_RE = re.compile(
    r"("
    r"vietnam\s+national\s+university|ho\s+chi\s+minh\s+city|hanoi\s+university|"
    r"ton\s+duc\s+thang\s+university|can\s+tho\s+university|da\s+nang|"
    r"fpt\s+university|posts\s+and\s+telecommunications|foreign\s+trade\s+university|"
    r"national\s+economics\s+university|university\s+of\s+economics\s+ho\s+chi\s+minh|"
    r"international\s+university.*vietnam|industrial\s+university\s+of\s+ho\s+chi\s+minh|"
    r"van\s+lang\s+university|hoa\s+sen\s+university|phenikaa\s+university|"
    r"duy\s+tan\s+university|vietnam.*korea\s+university"
    r")",
    re.IGNORECASE,
)

UNI_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("TDTU", re.compile(r"(tôn\s+đức\s+thắng|ton\s+duc\s+thang|\btdtu\b|tổng\s+liên\s+đoàn\s+lao\s+động)", re.I)),
    ("UEH", re.compile(r"(đại\s+học\s+kinh\s+tế\s+tp|kinh\s+tế\s+thành\s+phố\s+hồ\s+chí\s+minh|university\s+of\s+economics\s+ho\s+chi\s+minh|\bueh\b)", re.I)),
    ("NEU", re.compile(r"(kinh\s+tế\s+quốc\s+dân|national\s+economics\s+university|\bneu\b)", re.I)),
    ("FTU", re.compile(r"(đại\s+học\s+ngoại\s+thương|foreign\s+trade\s+university|\bftu\b)", re.I)),
    ("AOF", re.compile(r"(học\s+viện\s+tài\s+chính|academy\s+of\s+finance|\bhvtc\b)", re.I)),
    ("BA", re.compile(r"(học\s+viện\s+ngân\s+hàng|banking\s+academy|\bhvnh\b)", re.I)),
    ("HUB", re.compile(r"(đại\s+học\s+ngân\s+hàng\s+tp|ngân\s+hàng\s+thành\s+phố\s+hồ\s+chí\s+minh|ho\s+chi\s+minh\s+city\s+university\s+of\s+banking|\bhub\b|\bbuh\b)", re.I)),
    ("UFM", re.compile(r"(tài\s+chính\s*[-–]\s*marketing|university\s+of\s+finance\s*[-–]?\s*marketing|\bufm\b)", re.I)),
    ("TMU", re.compile(r"(đại\s+học\s+thương\s+mại|thuongmai\s+university|\btmu\b)", re.I)),
    ("DUE_UDN", re.compile(r"(đại\s+học\s+đà\s+nẵng.*đại\s+học\s+kinh\s+tế|trường\s+đại\s+học\s+kinh\s+tế.*đà\s+nẵng)", re.I | re.S)),
    ("DUT_UDN", re.compile(r"(đại\s+học\s+bách\s+khoa.*đà\s+nẵng|da\s+nang\s+university\s+of\s+science\s+and\s+technology)", re.I | re.S)),
    ("VKU_UDN", re.compile(r"(công\s+nghệ\s+thông\s+tin\s+và\s+truyền\s+thông\s+việt\s*[-–]?\s*hàn|vietnam\s*[-–]?\s*korea\s+university|\bvku\b)", re.I)),
    ("UEL_VNUHCM", re.compile(r"(đại\s+học\s+kinh\s+tế\s*[-–]\s*luật|university\s+of\s+economics\s+and\s+law|\buel\b)", re.I)),
    ("USSH_VNUHCM", re.compile(r"(khoa\s+học\s+xã\s+hội\s+và\s+nhân\s+văn.*hồ\s+chí\s+minh)", re.I | re.S)),
    ("IU_VNUHCM", re.compile(r"(trường\s+đại\s+học\s+quốc\s+tế.*hồ\s+chí\s+minh|international\s+university.*vietnam\s+national\s+university\s+ho\s+chi\s+minh)", re.I | re.S)),
    ("UIT_VNUHCM", re.compile(r"(đại\s+học\s+công\s+nghệ\s+thông\s+tin|university\s+of\s+information\s+technology|\buit\b)", re.I)),
    ("HCMUT_VNUHCM", re.compile(r"(đại\s+học\s+bách\s+khoa.*hồ\s+chí\s+minh|ho\s+chi\s+minh\s+city\s+university\s+of\s+technology|\bhcmut\b)", re.I | re.S)),
    ("HCMUS_VNUHCM", re.compile(r"(đại\s+học\s+khoa\s+học\s+tự\s+nhiên.*hồ\s+chí\s+minh|university\s+of\s+science.*ho\s+chi\s+minh|\bhcmus\b)", re.I | re.S)),
    ("HUST", re.compile(r"(đại\s+học\s+bách\s+khoa\s+hà\s+nội|bách\s+khoa\s+hà\s+nội|hanoi\s+university\s+of\s+science\s+and\s+technology|\bhust\b)", re.I)),
    ("UET_VNUHN", re.compile(r"(đại\s+học\s+công\s+nghệ.*đại\s+học\s+quốc\s+gia\s+hà\s+nội|vnu\s+university\s+of\s+engineering)", re.I | re.S)),
    ("UEB_VNUHN", re.compile(r"(đại\s+học\s+kinh\s+tế.*đại\s+học\s+quốc\s+gia\s+hà\s+nội|vnu\s+university\s+of\s+economics)", re.I | re.S)),
    ("HUS_VNUHN", re.compile(r"(khoa\s+học\s+tự\s+nhiên.*đại\s+học\s+quốc\s+gia\s+hà\s+nội)", re.I | re.S)),
    ("USSH_VNUHN", re.compile(r"(khoa\s+học\s+xã\s+hội\s+và\s+nhân\s+văn.*hà\s+nội)", re.I | re.S)),
    ("ULIS_VNUHN", re.compile(r"(đại\s+học\s+ngoại\s+ngữ.*đại\s+học\s+quốc\s+gia\s+hà\s+nội)", re.I | re.S)),
    ("ULAW", re.compile(r"(đại\s+học\s+luật\s+tp|đại\s+học\s+luật\s+hà\s+nội|đại\s+học\s+luật\s+thành\s+phố|university\s+of\s+law)", re.I)),
    ("PTIT", re.compile(r"(bưu\s+chính\s+viễn\s+thông|posts\s+and\s+telecommunications|\bptit\b)", re.I)),
    ("KMA", re.compile(r"(kỹ\s+thuật\s+mật\s+mã|academy\s+of\s+cryptography|\bkma\b)", re.I)),
    ("HCMUTE", re.compile(r"(sư\s+phạm\s+kỹ\s+thuật\s+tp|sư\s+phạm\s+kỹ\s+thuật\s+thành\s+phố|technology\s+and\s+education|\bhcmute\b)", re.I)),
    ("HUCE", re.compile(r"(đại\s+học\s+xây\s+dựng|civil\s+engineering|\bhuce\b|\bnuce\b)", re.I)),
    ("UTC", re.compile(r"(đại\s+học\s+giao\s+thông\s+vận\s+tải|university\s+of\s+transport|\butc\b|\buth\b)", re.I)),
    ("HUMG", re.compile(r"(mỏ\s*[-–]?\s*địa\s+chất|mining\s+and\s+geology|\bhumg\b)", re.I)),
    ("TLU", re.compile(r"(đại\s+học\s+thủy\s+lợi|thuyloi\s+university|\btlu\b)", re.I)),
    ("HAUI", re.compile(r"(công\s+nghiệp\s+hà\s+nội|hanoi\s+university\s+of\s+industry|\bhaui\b)", re.I)),
    ("UAH", re.compile(r"(đại\s+học\s+kiến\s+trúc|university\s+of\s+architecture|\buah\b|\bhau\b)", re.I)),
    ("HUIT", re.compile(r"(công\s+thương\s+tp|công\s+thương\s+thành\s+phố|công\s+nghiệp\s+thực\s+phẩm|\bhuit\b|\bhufi\b)", re.I)),
    ("IUH", re.compile(r"(công\s+nghiệp\s+tp|công\s+nghiệp\s+thành\s+phố\s+hồ\s+chí\s+minh|industrial\s+university\s+of\s+ho\s+chi\s+minh|\biuh\b)", re.I)),
    ("HCMUAF", re.compile(r"(nông\s+lâm\s+tp|nông\s+lâm\s+thành\s+phố|nong\s+lam\s+university|\bhcmuaf\b)", re.I)),
    ("VNUA", re.compile(r"(học\s+viện\s+nông\s+nghiệp|vietnam\s+national\s+university\s+of\s+agriculture|\bvnua\b)", re.I)),
    ("NTU", re.compile(r"(đại\s+học\s+nha\s+trang|nha\s+trang\s+university)", re.I)),
    ("UMP", re.compile(r"(đại\s+học\s+y\s+dược|đại\s+học\s+y\s+hà\s+nội|đại\s+học\s+dược\s+hà\s+nội|phạm\s+ngọc\s+thạch|medicine\s+and\s+pharmacy)", re.I)),
    ("HCMUE", re.compile(r"(đại\s+học\s+sư\s+phạm\s+tp|đại\s+học\s+sư\s+phạm\s+thành\s+phố|đại\s+học\s+sư\s+phạm\s+hà\s+nội|university\s+of\s+education)", re.I)),
    ("HANU", re.compile(r"(trường\s+đại\s+học\s+hà\s+nội|hanoi\s+university)", re.I)),
    ("OU_HCM", re.compile(r"(đại\s+học\s+mở\s+tp|đại\s+học\s+mở\s+thành\s+phố|đại\s+học\s+mở\s+hà\s+nội|open\s+university)", re.I)),
    ("SGU", re.compile(r"(đại\s+học\s+sài\s+gòn|sai\s+gon\s+university|\bsgu\b)", re.I)),
    ("CTU", re.compile(r"(đại\s+học\s+cần\s+thơ|can\s+tho\s+university|\bctu\b)", re.I)),
    ("FPTU", re.compile(r"(đại\s+học\s+fpt|fpt\s+university)", re.I)),
    ("HUTECH", re.compile(r"(công\s+nghệ\s+tp\.?\s*hcm|công\s+nghệ\s+thành\s+phố\s+hồ\s+chí\s+minh|\bhutech\b)", re.I)),
    ("VLU", re.compile(r"(đại\s+học\s+văn\s+lang|van\s+lang\s+university|\bvlu\b)", re.I)),
    ("HSU", re.compile(r"(đại\s+học\s+hoa\s+sen|hoa\s+sen\s+university|\bhsu\b)", re.I)),
    ("NTTU", re.compile(r"(nguyễn\s+tất\s+thành|nguyen\s+tat\s+thanh\s+university|\bnttu\b)", re.I)),
    ("PHENIKAA", re.compile(r"(đại\s+học\s+phenikaa|phenikaa\s+university)", re.I)),
    ("DTU", re.compile(r"(đại\s+học\s+duy\s+tân|duy\s+tan\s+university)", re.I)),
    ("UEF", re.compile(r"(kinh\s+tế\s*[-–]\s*tài\s+chính\s+tp|kinh\s+tế\s+tài\s+chính|\buef\b)", re.I)),
    ("HUE_UNI", re.compile(r"(đại\s+học\s+huế|hue\s+university)", re.I)),
    ("VINH_UNI", re.compile(r"(đại\s+học\s+vinh|vinh\s+university)", re.I)),
    ("DLU", re.compile(r"(đại\s+học\s+đà\s+lạt|dalat\s+university)", re.I)),
    ("TDMU", re.compile(r"(thủ\s+dầu\s+một|thu\s+dau\s+mot\s+university)", re.I)),
    ("VNU", re.compile(r"(đại\s+học\s+quốc\s+gia|vietnam\s+national\s+university)", re.I)),
]

UNIVERSITY_HEADER_RE = re.compile(
    r"("
    r"bộ\s+giáo\s+dục\s+và\s+đào\s+tạo|bộ\s+công\s+thương|bộ\s+tài\s+chính|bộ\s+xây\s+dựng|"
    r"bộ\s+giao\s+thông\s+vận\s+tải|bộ\s+y\s+tế|bộ\s+nông\s+nghiệp|ngân\s+hàng\s+nhà\s+nước|"
    r"tổng\s+liên\s+đoàn\s+lao\s+động|ủy\s+ban\s+nhân\s+dân|"
    r"đại\s+học\s+quốc\s+gia|đại\s+học\s+đà\s+nẵng|đại\s+học\s+huế|đại\s+học\s+thái\s+nguyên|"
    r"trường\s+đại\s+học|đại\s+học\s+kinh\s+tế|đại\s+học\s+bách\s+khoa|học\s+viện|"
    r"vietnam\s+national\s+university|ton\s+duc\s+thang\s+university|fpt\s+university|"
    r"university\s+of\s+economics|foreign\s+trade\s+university|hanoi\s+university|"
    r"ho\s+chi\s+minh\s+city\s+university|can\s+tho\s+university|van\s+lang\s+university"
    r")",
    re.IGNORECASE,
)

STUDENT_WORK_MARKER_RE = re.compile(
    r"("
    r"khóa\s+luận|khoá\s+luận|đồ\s+án|thuyết\s+minh\s+đồ\s+án|tiểu\s+luận|luận\s+văn|luận\s+án|"
    r"báo\s+cáo\s+thực\s+tập|báo\s+cáo\s+cuối\s+kỳ|báo\s+cáo\s+bài\s+tập\s+lớn|báo\s+cáo\s+môn\s+học|"
    r"báo\s+cáo\s+đồ\s+án|báo\s+cáo\s+tổng\s+kết|bài\s+tập\s+lớn|chuyên\s+đề|đề\s+án|"
    r"nghiên\s+cứu\s+khoa\s+học|sinh\s+viên\s+thực\s+hiện|nhóm\s+thực\s+hiện|nhóm\s+sinh\s+viên|"
    r"học\s+viên\s+thực\s+hiện|mã\s+số\s+sinh\s+viên|\bmssv\b|\bmsv\b|"
    r"giảng\s+viên\s+hướng\s+dẫn|\bgvhd\b|người\s+hướng\s+dẫn|giáo\s+viên\s+hướng\s+dẫn|"
    r"thesis|dissertation|capstone\s+project|graduation\s+project|final\s+report|project\s+report|"
    r"student\s+id|supervisor|advisor|instructor"
    r")",
    re.IGNORECASE,
)

TEMPLATE_OR_TEXTBOOK_RE = re.compile(
    r"("
    r"lorem\s+ipsum|tên\s+đề\s+tài\s+khóa\s+luận|nhập\s+tên\s+đề\s+tài|"
    r"hướng\s+dẫn\s+sử\s+dụng\s+template|mẫu\s+báo\s+cáo\s+khóa\s+luận|"
    r"universiti\s+teknologi\s+mara|uit\s+the\s+arctic\s+university|"
    r"đề\s+cương\s+chi\s+tiết\s+học\s+phần|ngân\s+hàng\s+câu\s+hỏi\s+thi"
    r")",
    re.IGNORECASE,
)

REF_SECTION_RE = re.compile(
    r"("
    r"tài\s+liệu\s+tham\s+khảo|danh\s+mục\s+tham\s+khảo|danh\s+mục\s+tài\s+liệu|"
    r"nguồn\s+tham\s+khảo|tài\s+liệu\s+trích\s+dẫn|\breferences\b|\bbibliography\b|\bworks\s+cited\b"
    r")",
    re.IGNORECASE,
)


def norm_nfc(text: str) -> str:
    return unicodedata.normalize("NFC", text or "")


def slugify(text: str, max_len: int = 68) -> str:
    text = norm_nfc(text).replace("đ", "d").replace("Đ", "D")
    nfkd = unicodedata.normalize("NFKD", text)
    ascii_str = "".join(c for c in nfkd if not unicodedata.combining(c))
    slug = re.sub(r"[^a-zA-Z0-9]+", "_", ascii_str).strip("_")
    return slug[:max_len] or "student_report"


def detect_university(text: str, fallback: str = "VN_UNI") -> str:
    for code, pat in UNI_PATTERNS:
        if pat.search(text):
            return code
    return fallback


def inspect_pdf_bytes(
    pdf_bytes: bytes,
    title_or_path_hint: str = "",
    min_pages: int = 6,
    max_pages: int = 260,
    fallback_uni: str = "VN_UNI",
) -> dict | None:
    if not pdf_bytes or not pdf_bytes.startswith(b"%PDF"):
        return None
    hint_nfc = norm_nfc(title_or_path_hint)
    if EXCLUDE_REPO_OR_PATH_RE.search(hint_nfc):
        return None

    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    except Exception:
        return None

    try:
        if doc.is_encrypted or len(doc) < min_pages or len(doc) > max_pages:
            return None

        num_pages = len(doc)
        sample_check = min(5, num_pages)
        landscape = sum(
            1 for i in range(sample_check) if doc[i].rect.width > doc[i].rect.height * 1.15
        )
        if landscape >= (sample_check // 2 + 1):
            return None

        first_pages = norm_nfc(
            "\n".join(doc[i].get_text("text") for i in range(min(5, num_pages)))
        )
        last_pages = norm_nfc(
            "\n".join(doc[i].get_text("text") for i in range(max(0, num_pages - 8), num_pages))
        )
        tail_half = norm_nfc(
            "\n".join(doc[i].get_text("text") for i in range(max(0, num_pages // 2), num_pages))
        )
        combined = first_pages + "\n" + last_pages

        if len(combined.strip()) < 1500:
            return None

        if TEMPLATE_OR_TEXTBOOK_RE.search(first_pages[:2500]):
            return None

        p1 = norm_nfc(doc[0].get_text("text"))
        if re.search(r"^\s*giáo\s+trình\b", p1, re.I | re.M) and not re.search(
            r"(sinh\s+viên|mssv|gvhd|tiểu\s+luận|khóa\s+luận|đồ\s+án)", first_pages, re.I
        ):
            return None

        vn_diacritics = len(VN_DIACRITIC_RE.findall(first_pages))
        if vn_diacritics < 20 and not VN_ENGLISH_UNI_RE.search(first_pages):
            return None

        if not UNIVERSITY_HEADER_RE.search(first_pages):
            return None
        if not STUDENT_WORK_MARKER_RE.search(first_pages):
            return None

        uni_code = detect_university(first_pages, fallback=fallback_uni)
        has_references = bool(
            REF_SECTION_RE.search(tail_half) or REF_SECTION_RE.search(first_pages)
        )

        p1_lines = [line.strip() for line in first_pages.splitlines() if line.strip()]
        preview = " | ".join(p1_lines[:10])[:280]

        return {
            "num_pages": num_pages,
            "university": uni_code,
            "has_references": has_references,
            "preview": preview,
        }
    finally:
        doc.close()


def get_github_token() -> str | None:
    token = os.environ.get("GITHUB_TOKEN")
    if token:
        return token.strip()
    try:
        return subprocess.check_output(["gh", "auth", "token"], text=True).strip()
    except Exception:
        return None


def api_get(
    headers: dict[str, str],
    url: str,
    params: dict | None = None,
    is_search: bool = False,
) -> dict | list | None:
    if is_search:
        time.sleep(2.05)
    for attempt in range(1, 4):
        try:
            resp = requests.get(url, headers=headers, params=params, timeout=15)
            if resp.status_code == 200:
                return resp.json()
            if resp.status_code in (403, 429):
                reset = int(resp.headers.get("X-RateLimit-Reset", 0))
                wait = max(reset - int(time.time()) + 2, 5 * attempt) if reset else 8 * attempt
                wait = min(wait, 40)
                time.sleep(wait)
                continue
            return None
        except Exception:
            time.sleep(1.5 * attempt)
    return None


def download_github_raw(full_name: str, branch: str, path: str) -> bytes | None:
    encoded_path = "/".join(quote(part, safe="") for part in path.split("/"))
    url = f"{RAW_GITHUB}/{full_name}/{quote(branch, safe='')}/{encoded_path}"
    for attempt in range(1, 3):
        try:
            resp = requests.get(url, timeout=22, headers={"User-Agent": "CITRA/2.0"})
            if resp.status_code == 200 and resp.content.startswith(b"%PDF"):
                return resp.content
            return None
        except Exception:
            time.sleep(1.0 * attempt)
    return None


def preload_existing_workspace_dedup(exclude_dir: Path) -> tuple[set[str], set[str], set[str], set[str]]:
    seen_sha256: set[str] = set()
    seen_urls: set[str] = set()
    seen_blob_shas: set[str] = set()
    seen_repos: set[str] = set()

    for pdf_path in Path(".").rglob("*.pdf"):
        try:
            if exclude_dir.resolve() in pdf_path.resolve().parents:
                continue
            if pdf_path.is_file():
                seen_sha256.add(hashlib.sha256(pdf_path.read_bytes()).hexdigest())
        except Exception:
            continue

    for mf in (
        Path("TDTU_PDF/metadata.json"),
        Path("tdtu_github_reports/metadata.json"),
        Path("vn_legal_reports/metadata.json"),
    ):
        if mf.exists():
            try:
                data = json.loads(mf.read_text(encoding="utf-8"))
                items = data if isinstance(data, list) else data.get("documents", [])
                for item in items:
                    if item.get("sha256"):
                        seen_sha256.add(item["sha256"])
                    if item.get("blob_sha"):
                        seen_blob_shas.add(item["blob_sha"])
                    surl = item.get("source_url", "")
                    if surl:
                        seen_urls.add(surl)
                        if surl.startswith(RAW_GITHUB + "/"):
                            parts = surl.replace(RAW_GITHUB + "/", "").split("/")
                            if len(parts) >= 2:
                                seen_repos.add(f"{parts[0]}/{parts[1]}")
                    if item.get("repo"):
                        seen_repos.add(item["repo"])
            except Exception:
                pass

    return seen_sha256, seen_urls, seen_blob_shas, seen_repos


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--output", "-o", default="VN_UNI_PDF_BATCH2")
    ap.add_argument("--n", type=int, default=100)
    ap.add_argument("--max-per-uni", type=int, default=12)
    ap.add_argument("--max-no-ref", type=int, default=6)
    args = ap.parse_args()

    out_dir = Path(args.output)
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = out_dir / "metadata.json"

    seen_sha256, seen_urls, seen_blob_shas, seen_repos = preload_existing_workspace_dedup(out_dir)
    print(
        f"Loaded dedup guardrails: {len(seen_sha256)} existing SHA-256s, {len(seen_repos)} repos.",
        flush=True,
    )

    state_lock = threading.Lock()
    collected: list[dict] = []
    uni_counts: dict[str, int] = {}
    disc_counts: dict[str, int] = {}
    no_ref_count = 0

    if manifest_path.exists():
        try:
            existing = json.loads(manifest_path.read_text(encoding="utf-8"))
            for item in existing:
                fpath = out_dir / item["filename"]
                if not fpath.exists():
                    continue
                sha = item["sha256"]
                if sha in seen_sha256:
                    continue
                seen_sha256.add(sha)
                if item.get("source_url"):
                    seen_urls.add(item["source_url"])
                if item.get("blob_sha"):
                    seen_blob_shas.add(item["blob_sha"])
                if item.get("repo"):
                    seen_repos.add(item["repo"])
                collected.append(item)
                u = item.get("university", "VN_UNI")
                d = item.get("discipline_group", "Other")
                uni_counts[u] = uni_counts.get(u, 0) + 1
                disc_counts[d] = disc_counts.get(d, 0) + 1
                if not item.get("has_references", True):
                    no_ref_count += 1
            print(f"Resumed {len(collected)} verified PDFs already in {out_dir}/", flush=True)
        except Exception as e:
            print(f"Warning reading existing manifest: {e}", flush=True)

    def save_record(
        meta: dict,
        pdf_bytes: bytes,
        info: dict,
        blob_sha: str = "",
        repo_key: str = "",
        uni_cap_override: int | None = None,
    ) -> bool:
        nonlocal no_ref_count
        sha = hashlib.sha256(pdf_bytes).hexdigest()
        with state_lock:
            if len(collected) >= args.n:
                return False
            if sha in seen_sha256:
                return False
            if repo_key and repo_key in seen_repos:
                return False

            uni = info["university"]
            eff_cap = uni_cap_override or (args.max_per_uni if uni != "VN_UNI" else 12)
            if uni_counts.get(uni, 0) >= eff_cap:
                return False

            if not info["has_references"] and no_ref_count >= args.max_no_ref:
                return False

            seen_sha256.add(sha)
            if blob_sha:
                seen_blob_shas.add(blob_sha)
            if meta.get("source_url"):
                seen_urls.add(meta["source_url"])
            if repo_key:
                seen_repos.add(repo_key)

            idx = len(collected) + 1
            uni_slug = uni.lower()
            slug = slugify(meta.get("title") or "report")
            fname = f"{idx:03d}_{uni_slug}_{slug}.pdf"
            (out_dir / fname).write_bytes(pdf_bytes)

            dgroup = meta.get("discipline_group", "General")
            uni_counts[uni] = uni_counts.get(uni, 0) + 1
            disc_counts[dgroup] = disc_counts.get(dgroup, 0) + 1
            if not info["has_references"]:
                no_ref_count += 1

            rec = {
                "id": idx,
                "filename": fname,
                "university": uni,
                "discipline_group": dgroup,
                "source_type": meta["source_type"],
                "title": meta.get("title", ""),
                "author": meta.get("author", ""),
                "category": meta.get("category", ""),
                "repo": repo_key,
                "source_url": meta.get("source_url", ""),
                "size_kb": len(pdf_bytes) // 1024,
                "num_pages": info["num_pages"],
                "has_references": info["has_references"],
                "preview": info["preview"],
                "sha256": sha,
            }
            if blob_sha:
                rec["blob_sha"] = blob_sha
            collected.append(rec)

            ref_tag = "+Refs" if info["has_references"] else "NoRef"
            print(
                f"[{len(collected):03d}/{args.n:03d}] [{uni:13s}] [{dgroup[:20]:20s}] [{ref_tag}] "
                f"{fname} ({info['num_pages']}p, {rec['size_kb']}KB)",
                flush=True,
            )
            manifest_path.write_text(json.dumps(collected, ensure_ascii=False, indent=2), encoding="utf-8")
            return True

    token = get_github_token()
    gh_headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "CITRA-MultiDisciplineCollector/2.1",
    }
    if token:
        gh_headers["Authorization"] = f"Bearer {token}"
        print("✓ Authenticated with GitHub API token (12-thread concurrent harvester)", flush=True)

    checked_repos: set[str] = set(seen_repos)

    def inspect_repo_worker(
        repo_obj: dict, dgroup: str, query_used: str, quota: int, relax_cap: bool
    ) -> bool:
        with state_lock:
            if len(collected) >= args.n:
                return False
            if not relax_cap and disc_counts.get(dgroup, 0) >= quota:
                return False
        full_name = repo_obj.get("full_name")
        if not full_name or repo_obj.get("fork"):
            return False
        desc = norm_nfc(repo_obj.get("description") or "")
        if EXCLUDE_REPO_OR_PATH_RE.search(norm_nfc(full_name)):
            return False

        branch = repo_obj.get("default_branch") or "main"
        tree_data = api_get(
            gh_headers,
            f"{GITHUB_API}/repos/{full_name}/git/trees/{quote(branch, safe='')}?recursive=1",
            is_search=False,
        )
        if not isinstance(tree_data, dict):
            return False
        tree = tree_data.get("tree", [])
        if not isinstance(tree, list):
            return False

        total_pdfs_in_repo = sum(
            1 for n in tree if n.get("type") == "blob" and str(n.get("path", "")).lower().endswith(".pdf")
        )
        repo_matches_hint = bool(
            CANDIDATE_PDF_NAME_RE.search(norm_nfc(full_name))
            or CANDIDATE_PDF_NAME_RE.search(desc)
            or (1 <= total_pdfs_in_repo <= 4)
        )

        pdf_nodes = []
        for node in tree:
            if node.get("type") != "blob":
                continue
            path = node.get("path", "")
            path_nfc = norm_nfc(path)
            size = node.get("size", 0) or 0
            blob_sha = node.get("sha", "")
            if not path_nfc.lower().endswith(".pdf"):
                continue
            if size < 105_000 or size > 26_000_000:
                continue
            with state_lock:
                if blob_sha and blob_sha in seen_blob_shas:
                    continue
            if EXCLUDE_REPO_OR_PATH_RE.search(path_nfc):
                continue
            name_match = bool(CANDIDATE_PDF_NAME_RE.search(path_nfc))
            if not (name_match or repo_matches_hint):
                continue
            score = (2 if name_match else 0) + min(size / 2_000_000, 1.5)
            pdf_nodes.append((score, path, path_nfc, size, blob_sha))

        pdf_nodes.sort(key=lambda x: -x[0])

        for _sc, raw_path, path_nfc, _sz, blob_sha in pdf_nodes[:2]:
            with state_lock:
                if len(collected) >= args.n:
                    return False
                if not relax_cap and disc_counts.get(dgroup, 0) >= quota:
                    return False
            pdf_bytes = download_github_raw(full_name, branch, raw_path)
            if not pdf_bytes:
                continue
            info = inspect_pdf_bytes(
                pdf_bytes,
                title_or_path_hint=f"{full_name}/{path_nfc} {desc}",
                min_pages=6,
                max_pages=260,
            )
            if not info:
                with state_lock:
                    if blob_sha:
                        seen_blob_shas.add(blob_sha)
                continue

            meta = {
                "source_type": "github_vn_uni_multidiscipline",
                "discipline_group": dgroup,
                "title": f"{full_name.split('/')[-1]}_{Path(path_nfc).stem}",
                "author": full_name.split("/")[0],
                "category": f"{dgroup} ({query_used})",
                "source_url": f"{RAW_GITHUB}/{full_name}/{branch}/{raw_path}",
            }
            if save_record(
                meta,
                pdf_bytes,
                info,
                blob_sha=blob_sha,
                repo_key=full_name,
                uni_cap_override=18 if relax_cap else None,
            ):
                return True
        return False

    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
        print("\n=== Phase 2A: Balanced Concurrent Multi-Disciplinary Harvesting ===", flush=True)
        for dgroup, quota, queries in DISCIPLINE_QUERY_GROUPS:
            if len(collected) >= args.n:
                break
            print(f"\n>>> Discipline Cluster: {dgroup} (target quota ~{quota}) <<<", flush=True)
            for q in queries:
                if len(collected) >= args.n or disc_counts.get(dgroup, 0) >= quota:
                    break
                data = api_get(
                    gh_headers,
                    f"{GITHUB_API}/search/repositories",
                    params={"q": q, "per_page": 50, "page": 1},
                    is_search=True,
                )
                if not isinstance(data, dict):
                    continue
                batch_repos = []
                for r_obj in data.get("items", []):
                    fn = r_obj.get("full_name")
                    if fn and fn not in checked_repos and not r_obj.get("fork"):
                        checked_repos.add(fn)
                        batch_repos.append(r_obj)
                futs = [
                    pool.submit(inspect_repo_worker, r_obj, dgroup, q, quota, False)
                    for r_obj in batch_repos
                ]
                concurrent.futures.wait(futs)

        if len(collected) < args.n:
            print(f"\n=== Phase 2B: Top-Up Pass ({len(collected)}/{args.n} -> {args.n}) ===", flush=True)
            for dgroup, quota, queries in DISCIPLINE_QUERY_GROUPS:
                if len(collected) >= args.n:
                    break
                for q in queries:
                    if len(collected) >= args.n:
                        break
                    for page in (1, 2):
                        if len(collected) >= args.n:
                            break
                        data = api_get(
                            gh_headers,
                            f"{GITHUB_API}/search/repositories",
                            params={"q": q, "per_page": 60, "page": page},
                            is_search=True,
                        )
                        if not isinstance(data, dict):
                            break
                        items = data.get("items", [])
                        if not items:
                            break
                        batch_repos = []
                        for r_obj in items:
                            fn = r_obj.get("full_name")
                            if fn and fn not in checked_repos and not r_obj.get("fork"):
                                checked_repos.add(fn)
                                batch_repos.append(r_obj)
                        futs = [
                            pool.submit(inspect_repo_worker, r_obj, dgroup, q, 999, True)
                            for r_obj in batch_repos
                        ]
                        concurrent.futures.wait(futs)
                        if len(items) < 60:
                            break

    print("\n" + "=" * 80, flush=True)
    print(f"COMPLETED! Collected {len(collected)}/{args.n} brand-new PDFs into {out_dir}/", flush=True)
    refs_cnt = sum(1 for r in collected if r.get("has_references"))
    print(f"Documents with explicit Reference sections: {refs_cnt}/{len(collected)}", flush=True)
    print("\nBreakdown by Discipline Group:", flush=True)
    for d, c in sorted(disc_counts.items(), key=lambda x: -x[1]):
        print(f"  - {d:40s}: {c:2d} PDFs", flush=True)
    print("\nBreakdown by University:", flush=True)
    for u, c in sorted(uni_counts.items(), key=lambda x: -x[1]):
        print(f"  - {u:16s}: {c:2d} PDFs", flush=True)
    print("=" * 80, flush=True)
    return 0 if len(collected) >= args.n else 1


if __name__ == "__main__":
    sys.exit(main())
