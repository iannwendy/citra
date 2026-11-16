# CITRA (`SourceLogic`) — Documentation Index

Tài liệu kỹ thuật, đặc tả kiến trúc, quy chuẩn trích dẫn, báo cáo kiểm toán/thực nghiệm và kế hoạch triển khai của dự án **CITRA (`essay-integrity-checker`)**.

## Cấu trúc thư mục (`docs/`)

```text
docs/
├── README.md                # Mục lục tài liệu tổng hợp (tệp này)
├── architecture/            # Đặc tả kiến trúc hệ thống, phân quyền, SaaS, tối ưu hiệu năng & hướng dẫn mở rộng
├── reference/               # Quy chuẩn trình bày trích dẫn học thuật (TDTU & 12 chuẩn quốc tế)
├── reports/                 # Báo cáo thực nghiệm 120K mẫu, kiểm toán toàn diện (Audit) & tiến độ ĐATN
├── plans/                   # Đặc tả thiết kế (Design Specs) & kế hoạch thực thi theo từng giai đoạn
└── screenshots/             # Ảnh chụp giao diện độ phân giải cao dùng cho README.md
```

---

## 1. Kiến trúc & Hướng dẫn Phát triển (`architecture/`)

- [**`SOURCELOGIC_CONCEPT.md`**](./architecture/SOURCELOGIC_CONCEPT.md) — Đặc tả nhận diện thương hiệu, hệ thống thiết kế *SourceLogic Scholarly* và trải nghiệm UX/UI kiểm chứng học thuật.
- [**`TEACHER_SYSTEM.md`**](./architecture/TEACHER_SYSTEM.md) — Kiến trúc phân quyền RBAC (`user` / `teacher` / `admin`), quản lý lớp học (`Classroom`) và quy trình giảng viên ghi đè phán quyết (`Verdict Override`).
- [**`PREMIUM_SUBSCRIPTION_PLAN.md`**](./architecture/PREMIUM_SUBSCRIPTION_PLAN.md) — Kiến trúc gói dịch vụ SaaS (`Basic` / `Pro` / `Ultra`), kiểm soát hạn mức (`Quota Gating`) và tích hợp thanh toán.
- [**`PERFORMANCE_AND_SEO_OPTIMIZATION.md`**](./architecture/PERFORMANCE_AND_SEO_OPTIMIZATION.md) — Thiết kế tối ưu hiệu năng 5 tầng (TanStack Query, SQLite FTS5 RAM/WAL, B-Tree index, xử lý bất đồng bộ) & Technical SEO.
- [**`format_development_guide.md`**](./architecture/format_development_guide.md) — Hướng dẫn dành cho lập trình viên khi bổ sung mẫu nhận diện chuẩn trích dẫn mới trong `src/integrity_checker/extraction/patterns/`.

---

## 2. Quy chuẩn Trích dẫn Tham chiếu (`reference/`)

- [**`tai_lieu_tham_khao_TDTU.md`**](./reference/tai_lieu_tham_khao_TDTU.md) — Quy định chính thức về trình bày tài liệu tham khảo và trích dẫn khóa luận tốt nghiệp của Trường Đại học Tôn Đức Thắng (TDTU).
- [**`citation-styles.md`**](./reference/citation-styles.md) — Tổng hợp đặc tả nhận diện, biểu thức chính quy gợi ý và ví dụ chuẩn/lỗi của các hệ thống trích dẫn quốc tế (APA, IEEE, Vancouver, Harvard, MLA, Chicago, ACM, ACS, AMA, CSE, Nature...).

---

## 3. Báo cáo Thực nghiệm, Kiểm toán & Tiến độ ĐATN (`reports/`)

### Thực nghiệm & Kiểm toán kỹ thuật (Benchmark & Audits)
- [**`BENCHMARK_120K_NEURO_SYMBOLIC_REPORT.md`**](./reports/BENCHMARK_120K_NEURO_SYMBOLIC_REPORT.md) — Báo cáo thực nghiệm & kiểm định mô hình Neuro-Symbolic quy mô lớn trên `120,000` bài báo khoa học độc lập (Stratified Paper-Disjoint Split, Ablation Study & 95% Bootstrap CI).
- [**`BAO_CAO_AUDIT_E2E_FULL_PIPELINE_VA_BATCH_CHECK.md`**](./reports/BAO_CAO_AUDIT_E2E_FULL_PIPELINE_VA_BATCH_CHECK.md) — Báo cáo kiểm định toàn diện luồng Full Pipeline E2E (GROBID + Live Scholarly APIs + Semantic Layer) và Batch Check.
- [**`BAO_CAO_BUG_TOAN_DIEN_2026-11-11.md`**](./reports/BAO_CAO_BUG_TOAN_DIEN_2026-11-11.md) — Báo cáo kiểm toán trình duyệt thực tế & khắc phục triệt để 11 nhóm lỗi (`BUG-01` → `BUG-11`).
- [**`BAO_CAO_AUDIT_PARSING_LINKING_TOAN_DIEN_2026-11-13.md`**](./reports/BAO_CAO_AUDIT_PARSING_LINKING_TOAN_DIEN_2026-11-13.md) — Báo cáo kiểm toán luồng Upload + Parsing + Linking trên toàn bộ `1,064` tệp PDF thuộc 38 thư mục dữ liệu.

### Đánh giá hiện trạng & Báo cáo tiến độ ĐATN
- [**`BAO_CAO_TIEN_DO_TUAN_25_10_01_11.md`**](./reports/BAO_CAO_TIEN_DO_TUAN_25_10_01_11.md) — Báo cáo tiến độ ĐATN giai đoạn `25/10/2026 – 01/11/2026` (`v3.5.0`).
- [**`DANH_GIA_DO_AN_KTPM_VA_LO_TRINH_2026-11-09.md`**](./reports/DANH_GIA_DO_AN_KTPM_VA_LO_TRINH_2026-11-09.md) — Báo cáo đánh giá tổng thể hiện trạng đồ án Kỹ thuật Phần mềm (`v3.43.18`) và lộ trình hoàn thiện cho Hội đồng bảo vệ.
- [**`BAO_CAO_TIEN_DO_01_11_15_11.md`**](./reports/BAO_CAO_TIEN_DO_01_11_15_11.md) — Báo cáo tiến độ ĐATN giai đoạn `01/11/2026 – 15/11/2026`.

---

## 4. Đặc tả Thiết kế & Kế hoạch Triển khai (`plans/`)

- [**`2026-11-10-db-schema-migration-design.md`**](./plans/2026-11-10-db-schema-migration-design.md) & [**`2026-11-10-db-schema-migration.md`**](./plans/2026-11-10-db-schema-migration.md) — Đặc tả & kế hoạch chuẩn hóa hệ thống quản lý phiên bản CSDL (`schema_migrations` + Alembic `batch_alter_table`).
- [**`2026-11-10-nfr-load-benchmark-design.md`**](./plans/2026-11-10-nfr-load-benchmark-design.md) & [**`2026-11-10-nfr-load-benchmark.md`**](./plans/2026-11-10-nfr-load-benchmark.md) — Đặc tả & kế hoạch kiểm thử hiệu năng phi chức năng (NFR Latency/RAM & Deadline Burst Load Benchmark).
- [**`PHAN_TICH_UI_UX_VA_DE_XUAT_TRANSITIONS_DEV.md`**](./plans/PHAN_TICH_UI_UX_VA_DE_XUAT_TRANSITIONS_DEV.md) — Phân tích UI/UX và đề xuất tích hợp hệ thống motion token `transitions.dev`.
- [**`2026-11-11-full-bugfix-plan.md`**](./plans/2026-11-11-full-bugfix-plan.md) — Kế hoạch xử lý toàn diện 11 nhóm lỗi hậu kiểm toán `2026-11-11`.
- [**`KE_HOACH_THIET_KE_CAI_TIEN_TOAN_DIEN_V3_61.md`**](./plans/KE_HOACH_THIET_KE_CAI_TIEN_TOAN_DIEN_V3_61.md) — Thiết kế kiến trúc & kế hoạch nâng cấp toàn diện `v3.61` (Accuracy `A1–A5` + Operations `B1–B4`).
- [**`2026-11-14-hybrid-motion-system-design.md`**](./plans/2026-11-14-hybrid-motion-system-design.md) & [**`2026-11-14-hybrid-motion-system.md`**](./plans/2026-11-14-hybrid-motion-system.md) — Đặc tả & kế hoạch triển khai hệ thống chuyển động lai (`transitions.dev` CSS Tokens + `motion` `LazyMotion`).
- [**`2026-11-15-citra-promo-90s-120fps-design.md`**](./plans/2026-11-15-citra-promo-90s-120fps-design.md) & [**`2026-11-15-citra-promo-90s-120fps.md`**](./plans/2026-11-15-citra-promo-90s-120fps.md) — Đặc tả & kế hoạch sản xuất phim giới thiệu sản phẩm CITRA 90s · 120fps (`marketing/citra-promo`).

---

## 5. Tài liệu ở gốc dự án (`../`)

- [**`../README.md`**](../README.md) — Tổng quan dự án, kiến trúc, hướng dẫn cài đặt nhanh, API và ảnh chụp giao diện.
- [**`../CLAUDE.md`**](../CLAUDE.md) — Sổ tay kỹ thuật tóm tắt dành cho lập trình viên và AI Coding Assistant.
