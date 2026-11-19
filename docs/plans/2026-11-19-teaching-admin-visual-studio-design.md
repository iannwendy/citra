# CITRA (`SourceLogic`) — Teaching & Admin "Visual Action Studio" Redesign Specification

**Date:** 2026-11-19  
**Scope:** Complete UX/UI, Data Visualization, Progressive Disclosure, and 120Hz Motion Redesign across all 6 Teaching & Admin Console pages (`MyClassesPage` + `ClassDetailPage`, `PendingReviewsPage`, `AccountManagementPage`, `PromoManagementPage`, `SystemHealthPage`, `AuditLogPage`)

---

## 1. Intent & The Why

CITRA's core report view (`EssayPage`) was previously modernized for non-technical clarity, yet all **6 Teaching & Admin Console pages** still expose a developer-centric "Forensic IDE" shell:
- Fake code filename headers (`pending_reviews.queue`, `teacher_classes.registry`, `iam_directory.users`, `billing_engine.promo_codes`, `telemetry_verdict_distribution.json`, `telemetry_upstream_circuits.json`, `immutable_audit_trail.log`) with `<Terminal />` icons instead of human section titles.
- Raw symbolic rule IDs (`R-STYLE-INCONSISTENT`, `R-CONTENT-ALIGNMENT`, `R-WEAK-EVIDENCE`, `R-HALLUCINATED-SOURCE`, `R-NO-CANDIDATE`), awkward machine fragments (`Mismatch: the title`, `Mismatch: the authors`), and raw database provider tags (`Crossref`) dumped onto teacher-facing cards.
- Passive, text-heavy tables and lists where a teacher opening **Pending Reviews** sees dozens of repetitive text blocks with **zero direct action buttons** and no immediate cue for *what they should do next*.
- Backend engineering internals (`SQLite WAL`, `B1 Singleflight`, `EMA Latency`, `25 / PAGE` page-size KPI) pushed to the top of Admin screens instead of visual diagrams, charts, and human health indicators.

**Core Mission:** Transform every single one of these 6 pages (plus `ClassDetailPage` one click inside `My Classes`) into a **Visual Action Studio** worthy of a 20-year Principal Product Designer:
1. **3-Second Visual Comprehension:** Charts, rings, flow diagrams, and proportional bars communicate status before the user reads a paragraph.
2. **Action-First Guidance:** Every flagged item tells a non-technical teacher *what happened* in plain Vietnamese/English and *what to do right now*, with 1-click inline resolution.
3. **Zero System Jargon on Surface, Consistent Signature Window Chrome:** Keep the signature 3-dot window accent (`red` / `amber` / `emerald` dots + vertical `<Separator />`) matching `DashboardPage`'s `RECENT ACTIVITY` bar, while eliminating 100% of fake filenames (`*.queue`, `*.registry`, `*.json`, `*.log`), `<Terminal />` icons, numbered `01–06` corner tags, and raw `R-*` / snake_case labels — replacing section headers with clean **UPPERCASE HUMAN TITLES** (e.g., `REVIEW QUEUE` / `DANH SÁCH CẦN DUYỆT`, `MY CLASSES` / `DANH SÁCH LỚP HỌC`, `MEMBER DIRECTORY` / `DANH BẠ TÀI KHOẢN`, `PROMO CAMPAIGNS` / `MÃ KHUYẾN MÃI`, `SERVICE CONNECTIONS` / `TRẠNG THÁI NGUỒN DỮ LIỆU`, `REVIEW HISTORY` / `LỊCH SỬ DUYỆT BÀI`).
4. **Tactile, Living Motion:** Leverage CITRA's existing `transitions.dev` + `motion/react` (`LazyMotion`) primitives (`DonutChart`, `ScoreRing`, `NumberPopIn`, `SubtleNumber`, `useSlidingPill`, `AccordionExpand`, `TactileToggle`, `CardHoverTilt`, `TextMorph`, `SuccessCheck`, `AnimatePresence`) so interactions feel responsive, alive, and effortless.

---

## 2. Goals, Non-Goals & Anti-Goals

### Goals
- Redesign all 6 sidebar routes (`/teacher/classes` + `/teacher/classes/:classId`, `/teacher/reviews`, `/admin/users`, `/admin/promos`, `/admin/system`, `/admin/audit`) with cohesive visual hierarchy, SVG data visualizations, concise bilingual copy (`vi` & `en`), and micro-interactions.
- Upgrade `PendingReviewsPage` from a passive click-through list into an **interactive, submission-grouped adjudication studio** with 1-click inline `Approve as Valid` (`verified`) and `Confirm Issue` (keep flagged label & mark overridden/reviewed) actions wired to `api.overrideVerdict`.
- Convert raw telemetry on `SystemHealthPage` and `AuditLogPage` into visual pipeline diagrams, health gauges, and transition timelines, using progressive disclosure (`AccordionExpand`) for low-level engine diagnostics.
- Maintain 100% bilingual parity (`vi` / `en`), dark/light theme polish, mobile responsiveness (`<= 430px` zero horizontal overflow), and `prefers-reduced-motion: reduce` accessibility.

### Non-Goals
- Changing backend FastAPI endpoints, database schemas, or Neuro-Symbolic scoring rules (existing REST APIs already provide every required field and action, including `POST /essays/{id}/verdicts/{verdict_id}/override`).
- Installing heavy third-party charting libraries (`recharts`, `chart.js`, `d3`) that bloat bundle size. All charts and diagrams use CITRA's calibrated SVG primitives (`DonutChart`, `ScoreRing`, proportional animated bars, and SVG flow nodes).
- Modifying Student Workspace pages (`DashboardPage`, `UploadPage`, `EssayPage`, `LandingPage`), except if shared helpers are cleanly extended without altering their behavior.

### Anti-Goals (Failure Modes Even If Code Compiles)
- Leaving *any* fake filename header (`*.queue`, `*.registry`, `*.json`, `*.log`), `<Terminal />` header icons, `FACULTY WORKSPACE IDE` / `IAM IDENTITY DIRECTORY` / `RBAC ENFORCED` / `IMMUTABLE COMPLIANCE LEDGER` banners, or raw `R-*` / `Mismatch: the ...` chips visible to non-technical users. (Note: **Keep** the 3 colored window dots `red-400/80` · `amber-400/80` · `emerald-400/80` + vertical separator + **UPPERCASE HUMAN TITLE** exactly matching `DashboardPage`'s `RECENT ACTIVITY` bar, per explicit user preference.)
- Replacing text clutter with *chart clutter* (oversized decorative charts that push the teacher's actual work below the fold).
- Breaking existing functional workflows (creating/editing/deleting/leaving classes, CSV/ZIP exports, user CRUD, promo code 6-char generation/toggling/deletion, cache clearing, circuit-breaker resets, audit pagination & deep links).

---

## 3. Approaches Considered

1. **Direction 1 — "Visual Action Studio" (Selected by User):**
   - Two-tier progressive disclosure: **Tier 1 (Surface)** pairs compact, high-signal SVG charts/diagrams (`DonutChart`, `ScoreRing`, 3-stage pipeline health diagram, grade bars, quota bars, visual timeline) with plain-language 1-line guidance and 1-click inline actions; **Tier 2 (Drawer)** tucks deep infrastructure metrics (`SQLite WAL`, `B1 Singleflight`, per-provider HTTP error tables) inside smooth `AccordionExpand` panels.
   - *Trade-off:* Higher UI craft effort across 7 page files + test updates, but zero bundle bloat, instant visual appeal, and immediate clarity for non-tech teachers and admins.
2. **Direction 2 — "Clean Minimal Tables" (Rejected):**
   - Strip IDE headers and `R-*` badges while keeping existing flat lists and tables.
   - *Trade-off:* Fast to implement, but remains visually flat and text-bound without diagrams, charts, or tactile motion.
3. **Direction 3 — "Heavy BI Analytics Dashboard" (Rejected):**
   - Add an external charting library and place large multi-axis charts atop every page.
   - *Trade-off:* Bloats JS bundle, clashes with CITRA's warm editorial/precision aesthetic, and pushes actionable rows below the fold.

---

## 4. Page-by-Page Design Specification

### 4.1 Global Visual Grammar Across All 6 Pages *(Designer's Call)*
- **Clean Page Header:** Replace multi-badge uppercase IDE headers (`FACULTY WORKSPACE IDE`, `01`–`06` index tags, `<Terminal />`) with a clean, breathable header: subtle tonal icon badge, crisp title (`font-display`), **one** short plain-language subtitle (max 12–16 words, no jargon), and primary CTA button(s) on the right.
- **Visual Summary Strip (Compact Above-the-Fold):** Every page opens with a compact visual overview (combining a `DonutChart` or `ScoreRing` or proportional distribution bar with `NumberPopIn` key metrics) capped at `~110–140px` desktop height so primary tasks remain immediately visible above the fold.
- **Consistent Signature Window Bar (Matching `DashboardPage`):** Main section cards preserve the signature 3 colored dots (`bg-red-400/80`, `bg-amber-400/80`, `bg-emerald-400/80`) + `<Separator orientation="vertical" className="h-4" />`, drop the `<Terminal />` icon and `*.queue`/`*.json` filenames, and render a clean **UPPERCASE HUMAN TITLE** (`font-mono text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300`) + count badge, matching `RECENT ACTIVITY` on `DashboardPage.tsx`.

---

### 4.2 Page 1: `PendingReviewsPage.tsx` (`/teacher/reviews`) — *Submission-Grouped Adjudication Studio* *(User Picked Option A)*

1. **Compact Visual Triage Banner:**
   - **Left — Issue Breakdown `DonutChart` (`size={84}`):** Segments for *Không tìm thấy nguồn / Nghi vấn* (Rose `#f43f5e`), *Sai lệch thông tin* (Amber `#f59e0b`), *Thiếu quy cách* (Orange `#fb923c`), and *Chưa đủ dữ liệu* (Slate `#94a3b8`), with center `<NumberPopIn value={reviews.length} />`. When `reviews.length === 0` (or after clearing items in session), displays a celebratory emerald `<SuccessCheck />` state (*"Tuyệt vời! Bạn đã duyệt xong mọi trích dẫn cần kiểm tra."* / *"All caught up! No citations waiting for review."*).
   - **Middle — Interactive Severity Filter Tiles:** Clickable compact stat pills (*Tất cả*, *Không tìm thấy nguồn*, *Sai thông tin*, *Thiếu quy cách*, *Chờ kiểm tra* — preserving `data-testid="pending-kpi-incomplete"` and `data-testid="pending-kpi-unresolved"`) so clicking any category filters the queue in place with smooth `useSlidingPill` / active ring feedback.
   - **Right / Toolbar — Class Filter & View Mode Switcher:**
     - Class selector pills (`Tất cả lớp` with `data-testid="pending-filter-all-classes"` + each class chip) enhanced with `useSlidingPill`.
     - View mode toggle (`Gom theo bài nộp` [default] vs `Danh sách phẳng`) so teachers with 10 citations in the same PDF see **1 clean collapsible submission group** instead of 10 repetitive headers.

2. **Submission Group Card (`AccordionExpand`, Open by Default):**
   - Header shows `<FileFormatIcon />`, `filename`, student badge (`student_username`, hiding literal `'user'` generic label only when missing, showing student name clearly with user icon), item count badge (`2 mục cần xem`), and a `"Mở toàn bộ báo cáo ↗"` link.

3. **Action-Oriented Citation Review Card (`data-testid="pending-review-row-${r.verdict_id}"`):**
   - **Strictly Removed from Surface:** Raw `R-*` badges (`R-STYLE-INCONSISTENT`, `R-CONTENT-ALIGNMENT`, `R-WEAK-EVIDENCE`, `R-HALLUCINATED-SOURCE`, `R-NO-CANDIDATE`, `R-NO-SCHOLARLY-RECORD`), raw `Mismatch: the title` / `Mismatch: the authors` chips, and raw database chips (`Crossref`, `OpenAlex`).
   - **What the Teacher Sees Instead (3 Clean Visual Elements):**
     1. **Top Status & Marker Row:** Citation marker pill (`[7]`, `[14a]` — `data-testid="pending-marker-${r.verdict_id}"`), human `<VerdictBadge />` (*Nghi vấn ngụy tạo* / *Thiếu quy cách trích dẫn* / *Sai lệch thông tin* / *Chờ rà soát*), urgent `RETRACTED` pill if retracted (`data-testid="pending-retracted-${r.verdict_id}"`), and clean link status pill only when actionable (e.g., Dead Link, Fake Domain, Wrong Page, or Wayback Archive link `data-testid="pending-url-status-${r.verdict_id}"` — omitting noisy `URL Unchecked` technical tags!).
     2. **Plain-Language Problem + "Việc cần làm" Callout (`getTeacherReviewGuidance`):**
        - Synthesizes `label`, `triggered_rules`, `mismatched_fields`, and `observedWeb` into **one concise headline + one concrete teacher action**:
          - *Retracted (`is_retracted` / `R-RETRACTED-PAPER`):* **Bài báo này đã bị tạp chí rút bỏ** → *Yêu cầu sinh viên thay thế bằng tài liệu còn hiệu lực.*
          - *Wrong URL Page (`R-URL-CONTENT-MISMATCH`):* **Đường link dẫn tới một trang web khác** (shows observed title box `data-testid="pending-observed-meta-${r.verdict_id}"`) → *Kiểm tra link sinh viên dán hoặc giữ cảnh báo sai nguồn.*
          - *Incomplete Reference (`R-INCOMPLETE-METADATA`):* **Trích dẫn ghi chưa đủ thông tin (thiếu năm/nơi công bố)** (*keeps localized phrase `chưa đủ thông tin định danh học thuật` / concise equivalent*) → *Nhắc sinh viên bổ sung đầy đủ thông tin tài liệu tham khảo.*
          - *Suspected Hallucination (`suspected_hallucination`):* **Không tìm thấy công trình này trên các kho học thuật** → *Kiểm tra xem sinh viên gõ sai tên bài hay tự bịa nguồn trích dẫn.*
          - *Metadata Mismatch (`metadata_error` with `mismatched_fields`):* Natural human phrasing, e.g., **Tìm thấy bài gốc nhưng lệch tên tác giả / năm xuất bản** (using clean human field names: *tên bài*, *tác giả*, *năm xuất bản*, *tạp chí*, *mã DOI*) → *Đối chiếu nhanh; nếu chỉ lỗi gõ nhẹ có thể chấp nhận hoặc giữ nhắc nhở.*
          - *Unresolved (`unresolved`):* **Chưa đủ dữ liệu tự động để kết luận** → *Mở đoạn trích trong bài để kiểm tra thủ công.*
     3. **Clean 2-Line Citation Quote** (`“Christopher Clark and Matt Gardner. 2018.”`) + **Inline Action Bar**:
        - **`✓ Chấp nhận` / `✓ Approve`** (`data-testid="pending-approve-btn-${r.verdict_id}"`): Calls `api.overrideVerdict(r.essay_id, { verdict_id: String(r.verdict_id), new_label: 'verified', reason: ... })`. Plays `<SuccessCheck />` flash (`220ms`), then smoothly collapses and removes the item from local `reviews` state via `AnimatePresence`, updating the `DonutChart` and counters immediately!
        - **`⚑ Giữ cảnh báo` / `⚑ Đánh dấu lỗi`** (`data-testid="pending-confirm-issue-btn-${r.verdict_id}"`) *(Designer's Call)*:
          - For items already flagged as `'suspected_hallucination'` or `'metadata_error'`, button reads **`⚑ Giữ cảnh báo` / `⚑ Keep Warning`** and sends `new_label: r.label` (`'suspected_hallucination'` or `'metadata_error'`), confirming the system's warning (`is_overridden = 1`), logging to `AuditLog`, and clearing it from the pending queue.
          - For `'unresolved'` (or legacy `'unverified'`, which the backend override validator does not accept raw), button reads **`⚑ Đánh dấu lỗi` / `⚑ Flag Issue`** and sends `new_label: 'metadata_error'`, cleanly resolving the undecided status into an actionable citation warning without risking an HTTP 422 or leaving a reviewed item stuck as "Chờ rà soát".
        - **`Xem bài ↗` / `Inspect ↗`**: Clicking the button (or clicking the card body itself, preserving existing row-click navigation contract!) navigates to `/verification/report/${r.essay_id}?citation=${r.verdict_id}` (with `e.stopPropagation()` on inline action buttons so clicking Approve/Confirm doesn't navigate away).

---

### 4.3 Page 2: `MyClassesPage.tsx` (`/teacher/classes`) & `ClassDetailPage.tsx` (`/teacher/classes/:classId`) — *Visual Classroom Hub*

#### `MyClassesPage.tsx`
1. **Header & Active Classes Pill:** Clean classroom header with localized active status badge (`"${n} lớp đang hoạt động"` / `"${n} active classes"` — preserving localized count semantics without `FACULTY WORKSPACE IDE`) and `+ Tạo lớp mới` primary CTA (`aria-label={t('teacher.createClass')}`).
2. **Visual Overview Strip (4 Tactile Cards, Zero `01–04` Tags):**
   - `Lớp phụ trách`, `Sinh viên`, `Bài đã nộp`, and an highlighted **`Cần duyệt` Action Card** (`data-testid="needs-review-kpi-link"` when `pending_reviews > 0`) featuring a live rose pulse badge and animated arrow inviting immediate triage. All numbers use `<NumberPopIn />`.
3. **Interactive Class Cards Grid (`grid-cols-1 md:grid-cols-2`):**
   - Replaces the flat `teacher_classes.registry` list with rich visual cohort cards wrapped in subtle `<CardHoverTilt maxTilt={3.5} />`.
   - Each card shows class title, concise description, **visual mini-stat pills** (Students icon + count, Submissions icon + count), an interactive **1-Click Copy Join Code Pill** (`e.stopPropagation()`, `<TextMorph>` swapping code/copy feedback + toast), delete icon button (`data-testid="delete-class-card-btn-${c.id}"`), and smooth chevron entry.
4. **Enrolled Classes Section (`data-testid="enrolled-classes-section"`):** Clean card grid/list without `<Terminal />`, preserving `leave-class-btn-${c.id}` and accessible confirmation modal (`confirm-leave-class-btn`).

#### `ClassDetailPage.tsx`
1. **Clean Cohort Header:** Back button, editable class title, interactive **Join Code Ticket Pill** (`data-testid="class-join-code-badge"`, copy + regenerate), and clean action buttons (`edit-class-btn`, CSV export, `export-class-zip-btn`, `delete-class-btn`) — zero `COHORT #ID` or `CROSS-STUDENT ANOMALY ENGINE` jargon.
2. **Visual Class Health Dashboard (`data-testid="cohort-analytics-panel"`):**
   - **Row 1 — Ring Gauges & Verdict Donut:**
     - `<ScoreRing>` for **Điểm tin cậy TB lớp (`avg_cis`)** + `<ScoreRing>` for **Tài liệu mới ≤ 5 năm (`recency_5yr_ratio`)** alongside Enrolled Students & Submissions `<NumberPopIn />` cards.
     - **`DonutChart` + Proportional Stacked Bar (`data-testid="cohort-verdict-breakdown"`)** visualizing the class's citation health across *Hợp lệ*, *Sai thông tin*, *Thiếu quy cách*, *Nghi vấn*, *Chờ duyệt*, *Tài nguyên Web* (preserving `verdict-breakdown-pill-${key}`).
   - **Row 2 — Visual Charts Instead of Raw Rule Codes:**
     - **Biểu đồ phân bố xếp loại bài nộp (A / B / C / D Visual Bar Histogram):** Animated proportional bars for `≥85 (A)`, `70–84 (B)`, `50–69 (C)`, `<50 (D)` so the teacher sees grade spread at a glance.
     - **Các lỗi trích dẫn phổ biến nhất trong lớp (Horizontal Bar Ranking):** Renders `getRuleDisplayName(r.rule_id, lang)` with proportional horizontal fill bars and `×count` — **hiding raw `R-*` rule IDs** from the surface!
     - **Cảnh báo nguồn nghi vấn trùng lặp giữa nhiều sinh viên:** Clean alert cards with human labels (*Nghi vấn ngụy tạo* / *Sai thông tin* instead of raw `suspected_hallucination`), highlighting shared student count (`2+ bài cùng trích dẫn nguồn lỗi này`) and clickable report chips (`data-testid="shared-hallucination-essay-link-${eid}"`).
3. **Clean Student Roster & Submissions List:** Uses the signature 3-dot + UPPERCASE section bar (`STUDENTS` / `SINH VIÊN`, `SUBMISSIONS` / `BÀI ĐÃ NỘP`), adds avatar initials, clean status badges (`Queued` / `Processing` / `Failed` / `Credit Refunded` smart links + `<ScoreRing size={32} />` for each completed essay's CIS score!).

---

### 4.4 Page 3: `AccountManagementPage.tsx` (`/admin/users`) — *Visual Member & Quota Directory*

1. **Clean Header + Visual Ecosystem Summary:**
   - Removes `IAM IDENTITY DIRECTORY`, `RBAC ENFORCED`, `iam_directory.users`, and `01–04` tags.
   - **Visual Summary Card:** Combines a **Role Breakdown `DonutChart`** (*Sinh viên*, *Giảng viên*, *Quản trị viên*) + **Plan Tier Stacked Bar** (*Basic*, *Pro*, *Ultra*) + `<NumberPopIn />` counters for Total, Active, Teachers, Admins.
2. **Tactile Filter Bar:**
   - Search input with clear button + **Sliding Role Filter Tabs (`useSlidingPill`)** (*Tất cả*, *Quản trị*, *Giảng viên*, *Sinh viên*) + Status pill toggle (*Tất cả*, *Hoạt động*, *Tạm khóa*).
3. **Visual User Rows:**
   - Crisp avatar/initials, full name + email, `<RoleBadge />`, and an upgraded **Visual Plan & Quota Cell (`data-testid="user-plan-quota-${u.id}"`)**: displays the plan pill (`BASIC` / `PRO` / `ULTRA`) alongside a **mini proportional quota progress bar** (turning amber >= 80%, rose >= 100%, or infinity icon + `Unlimited` / `Không giới hạn` for admins) while preserving exact `used/limit` text (`12/50`, `Unlimited`, `—`).

---

### 4.5 Page 4: `PromoManagementPage.tsx` (`/admin/promos`) — *Visual Campaign & Coupon Studio*

1. **Clean Header & Concise Subtitle:**
   - Removes `REVENUE & PROMO ENGINE`, `6-CHAR ISO COUPON STANDARD`, `billing_engine.promo_codes`, and the 30-word payment gateway paragraph; replaces with a crisp 1-line subtitle and `+ Tạo mã khuyến mãi` (`data-testid="create-promo-btn"`).
2. **Campaign Performance Visual Strip:**
   - 4 visual cards with `<NumberPopIn />` (`kpi-total-promos`, `kpi-active-promos`, `kpi-total-redemptions`, Total Discount Saved `$`) + a **Campaign Health Mini-Donut / Bar** showing *Đang chạy* vs *Tạm dừng / Hết hạn* and top-performing coupon highlight.
3. **Sliding Filter Pills + Coupon-Styled Rows:**
   - Search (`promo-search-input`) + sliding status/type filter pills (`useSlidingPill`).
   - Each promo row (`data-testid="promo-row-${promo.code}"`) renders a **perforated ticket-style coupon badge** (`CITRA2`) with 1-click `<IconSwap />` copy button, bold visual discount pill (`-20%` or `-$10`), **animated redemption progress bar** (`used / max` with color shift near exhaustion), and an inline **`<TactileToggle />` switch (`data-testid="promo-toggle-${promo.code}"`)** to activate/pause campaigns with spring physics alongside Edit & Delete (`promo-delete-${promo.code}`).

---

### 4.6 Page 5: `SystemHealthPage.tsx` (`/admin/system`) — *Visual System Pulse & Architecture Flow*

*Critical balance: Non-tech admins want an instant visual health dashboard without sysadmin jargon, while existing automated test suites verify deep circuit-breaker, SQLite WAL, and B1/persistent cache `data-testid`s. Solution: Progressive Disclosure!*

1. **Tier 1 (Surface — Designed for Non-Tech Humans):**
   - **Live System Pulse Header:** Clean status banner with animated emerald/amber/rose health orb + localized status pill (`data-testid="health-status-pill"`, `data-level={health.level}`, preserving exact `ALL SERVICES HEALTHY` / `DEGRADED: ...` / localized VI text) and `Dọn bộ nhớ tạm` (`data-testid="clear-cache-btn"`).
   - **Interactive 3-Stage System Flow Diagram (Visual Architecture Map):**
     - Horizontal connected SVG/card pipeline with animated pulse connectors:
       1. **Đọc & Lưu trữ Tài liệu** (*Document Parser & DB*) — Live status dot + total essays analyzed (`<NumberPopIn />`).
       2. **Mạng lưới 15+ Nguồn Học thuật** (*Scholarly Network*) — Live count of healthy vs slow/tripped sources (`closedCircuitsCount` ổn định · `openCircuitsCount` tạm ngắt) + 1-click `reset-all-breakers-btn` if any source is tripped.
       3. **Bộ nhớ Tăng tốc Tra cứu** (*Smart Lookup Cache*) — `<ScoreRing>` hit-rate gauge + instant comparison of *Kho học thuật tích hợp sẵn (`128,000` bài)* vs *Bộ nhớ lưu tạm gần đây*.
   - **Visual Charts Grid (2 Columns):**
     - **Left — Verdict Distribution `DonutChart` + Human Bars:** Replaces raw snake_case (`suspected_hallucination`, `metadata_error`) with localized human labels (*Hợp lệ*, *Sai thông tin*, *Nghi vấn*, *Chờ kiểm tra*, *Tài nguyên Web*), animated horizontal bars, and total count (`"${n} bản ghi tổng cộng"` / `"${n} total records"`).
     - **Right — Cache & Knowledge Library Visual Card (`data-testid="cache-stats"`):**
       - Side-by-side visual capacity cards for **Bộ nhớ đệm Trích dẫn Động** (`dynamic-citation-cache-card`, `dynamic-cache-entries-value`) and **Kho Học thuật Cục bộ Tĩnh** (`static-local-corpus-card`, `static-local-corpus-value`), plus visual horizontal source breakdown bars (`cache-by-source-section`, `cache-by-source-zero`, `local-corpus-by-source-section`).
   - **Scholarly Sources Visual Health Grid (`data-testid="upstream-sources-panel"`):**
     - Clean header (*Nguồn Học Thuật & Ngắt Mạch Tự Động* / *Scholarly Upstream Providers & Circuit Breakers*) with visual summary bar.
     - When `upstreamEntries.length === 0`, shows a friendly calm empty state (`data-testid="upstream-sources-empty"`).
     - When populated, renders a clean, scannable visual table (`data-testid="upstream-circuit-table"`) where latency is paired with a **visual speed bar** (emerald `<300ms`, amber `300–700ms`, rose `>700ms`) and success rate has a **mini health ring/bar**, while preserving `upstream-row-*`, `circuit-badge-*`, `circuit-cooldown-*`, `reset-breaker-*`, `upstream-latency-*`, `upstream-success-*`, `upstream-429-*`, and `upstream-last-error-*`.

2. **Tier 2 (Collapsible "Thông số Kỹ thuật Nâng cao / Engine Diagnostics" Drawer):**
   - Uses `<AccordionExpand>` (collapsed by default in UI, while keeping semantic DOM nodes accessible so screen/DOM queries remain deterministic!) to tuck away raw engine telemetry: `sqlite-wal-telemetry` (`journal_mode: WAL`, `synchronous`, `busy_timeout`), `b1-session-cache-panel` (`Wave-0`, `Singleflight`, `Neg Cache`), and granular `cache-stat-*` key-value tiles. Non-tech admins never have to stare at `WAL` or `Singleflight` unless they click *"Xem thông số kỹ thuật nâng cao ▾"*!

---

### 4.7 Page 6: `AuditLogPage.tsx` (`/admin/audit`) — *Visual Review History Timeline*

1. **Meaningful Visual Summary Strip:**
   - Removes `IMMUTABLE COMPLIANCE LEDGER`, `VERDICT OVERRIDE STREAM`, `immutable_audit_trail.log`, and replaces the meaningless third KPI look with a clean 3-card summary + **Visual Transition Breakdown Bar** (*Chuyển sang Hợp lệ* vs *Xác nhận lỗi/cảnh báo*), while keeping `audit-total-events`, `audit-unique-actors`, and a subtle pagination-density badge (`audit-page-size` tucked cleanly into the pagination bar so it doesn't waste a giant hero KPI card!).
2. **Visual Activity Timeline (Replaces Dry Log Table):**
   - Each log entry renders as a **connected vertical timeline card**:
     - **Reviewer Avatar Initials + Username** (`lecturer1`) & clean formatted timestamp.
     - **Visual State-Transition Diagram:** `[Human Old Badge]` ➔ `[Human New Badge]` (e.g., amber `Sai lệch thông tin` → emerald `✓ Hợp lệ` with colored pills and arrow icon, instead of raw snake_case `metadata_error -> verified`!).
     - **Clickable Citation Deep-Link Pill** (`data-testid="audit-verdict-link-${e.id}"` → `/verification/report/${e.essay_id}?citation=${e.verdict_id}`) and subtle quote bubble for the reviewer's note (if provided).
3. **Search & Pagination Bar:** Clean debounced username filter (`aria-label` preserved) + crisp Prev/Next pagination (`audit-pagination`, `audit-prev-page`, `audit-next-page`).

---

## 5. Constraints & Test Compatibility Matrix

To ensure **zero regressions** across CITRA's 340+ frontend Vitest suite while genuinely removing legacy IDE clutter:
1. **Preserved Functional & Test Contracts (`data-testid`s & ARIA):**
   - `PendingReviewsPage`: `pending-filter-all-classes`, `pending-kpi-incomplete`, `pending-kpi-unresolved`, `pending-review-row-${id}`, `pending-marker-${id}`, `pending-retracted-${id}`, `pending-url-status-${id}`, `pending-observed-meta-${id}`, row click → `/verification/report/${essay_id}?citation=${verdict_id}`.
   - `MyClassesPage` & `ClassDetailPage`: `createClass` button `aria-label`, `needs-review-kpi-link`, `delete-class-card-btn-${id}`, `enrolled-classes-section`, `leave-class-btn-${id}`, `confirm-leave-class-btn`, `class-join-code-badge`, `edit-class-btn`, `export-class-zip-btn`, `delete-class-btn`, `cohort-analytics-panel`, `cohort-verdict-breakdown`, `verdict-breakdown-pill-${key}`, `shared-hallucination-essay-link-${eid}`, localized active classes text (`2 lớp đang hoạt động` / `2 lớp học` — update case-sensitive assertion in `I18nAndHygiene.test.tsx` only if needed, or preserve uppercase pill text `'2 LỚP ĐANG HOẠT ĐỘNG'` cleanly).
   - `AccountManagementPage`: `user-plan-quota-${id}` containing tier + `used/limit` (`Unlimited` / `Không giới hạn` / `—`), `Plan / Quota` / `Gói / Hạn ngạch` label.
   - `PromoManagementPage`: `create-promo-btn`, `promo-search-input`, `kpi-total-promos`, `kpi-active-promos`, `kpi-total-redemptions`, `promo-row-${code}`, `promo-toggle-${code}`, `promo-delete-${code}`, `promo-form-modal`, `promo-delete-modal` (`role="dialog"`, `aria-modal="true"`, Escape close).
   - `SystemHealthPage`: `summarizeHealth` export, `health-status-pill` (`data-level`), `clear-cache-btn`, `sqlite-wal-telemetry`, `upstream-sources-panel`, `upstream-sources-empty`, `upstream-circuit-table`, `upstream-row-*`, `circuit-badge-*`, `circuit-cooldown-*`, `reset-breaker-*`, `reset-all-breakers-btn`, `upstream-latency-*`, `upstream-success-*`, `upstream-429-*`, `upstream-last-error-*`, `cache-stats`, `dynamic-citation-cache-card`, `dynamic-cache-entries-value`, `static-local-corpus-card`, `static-local-corpus-value`, `b1-session-cache-panel`, `b1-*`, `cache-stat-*`, `cache-by-source-section`, `cache-by-source-zero`, `local-corpus-by-source-section`.
   - `AuditLogPage`: `AUDIT_PAGE_SIZE` export, `audit-total-events`, `audit-unique-actors`, `audit-page-size`, `audit-verdict-link-${id}`, username filter `aria-label`, `audit-pagination`, `audit-prev-page`, `audit-next-page`.
2. **New Dedicated UX Redesign Test Suite (`TeachingAdminVisualStudio.test.tsx`):**
   - Verifies that **zero** IDE filenames (`pending_reviews.queue`, `teacher_classes.registry`, `iam_directory.users`, `billing_engine.promo_codes`, `telemetry_verdict_distribution.json`, `telemetry_upstream_circuits.json`, `immutable_audit_trail.log`) and **zero** raw `R-*` / `Mismatch: the ...` / `Crossref` chips appear on `PendingReviewsPage`.
   - Verifies inline 1-click **Approve (`verified`)** and **Confirm Issue** actions on `PendingReviewsPage` call `api.overrideVerdict`, show toast/feedback, and remove the adjudicated item from the queue.
   - Verifies submission grouping, severity filter pills, `DonutChart` / `ScoreRing` rendering, and progressive disclosure of advanced diagnostics on `SystemHealthPage`.

---

## 6. What's Left to the Builder

- Exact Tailwind spacing, color-stop tuning, and responsive breakpoints (`375px` / `430px` mobile to `1440px` desktop) within CITRA's existing slate/indigo/emerald/amber/rose palette.
- Organization of shared lightweight visual subcomponents (e.g., `web/src/lib/teacherGuidance.ts` for plain-language teacher directives and `web/src/components/ui/studio-visuals.tsx` for reusable horizontal bars / pipeline flow nodes, respecting `deadCode.test.ts` barrel rules — do **not** add exports to `web/src/pages/essay/index.ts`!).
