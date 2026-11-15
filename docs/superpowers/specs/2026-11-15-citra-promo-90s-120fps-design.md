# CITRA 90-Second · 120fps Keynote Spatial Cinema Promo — Design Specification

- **Date:** 2026-11-15
- **Target Scope:** `marketing/citra-promo` + full web media re-encode (`web/public/media/citra-film-v2/`) + landing player update (`web/src/components/landing/CitraFilm.tsx`)
- **System Version Showcased:** CITRA (`SourceLogic`) **`v3.75.2`** (latest `HEAD` codebase & `productFacts.ts`)
- **Output Specification:** `90.0` seconds · **`120 fps`** (`10,800` frames) · 16:9 (`1920×1080` logical layout, rendered to `1440p120` & `1080p120` masters + hybrid `120fps / 60fps` web AV1/HEVC/H.264 ladder) · `48 kHz` 24-bit procedural stereo soundtrack + SFX

---

## 1. Intent & Why

The video serves both as the **flagship opening showcase for CITRA's Software Engineering Graduation Thesis Defense (Hội đồng chấm Đồ án Tốt nghiệp KTPM — Tôn Đức Thắng University)** and as the **official product film on `citra.io.vn`**.

The legacy 60-second / 60fps film had four clear limitations:
1. **Repetitive layout monotony:** Seven consecutive scenes reused the same rigid 2-column layout (text on one side, single tilted browser on the other, cropped rectangular painting sticking out behind).
2. **Clunky visual annotations:** UI regions were highlighted with thick `3px` red/green borders and `4000px` dark cutout shadows rather than layered 3D Glass Magnifier Loupes and precision optical callouts.
3. **Stop-and-go camera & abrupt cuts:** Per-segment `easeInOut` camera keyframes reset velocity to zero at every intermediate waypoint, and scenes ended with plain 14-frame blur cuts.
4. **Outdated metrics & missing thesis highlights:** The old script missed CITRA `v3.75.2`'s strongest differentiators — the **120,000-paper strict paper-disjoint Ablation Study (`98.58%` Neuro-Symbolic Acc / `99.86%` 16D HybridML vs `64.85%` Pure SBERT, `100.0%` Hallucination F1, `0` false accusations)**, **8-stage real-time SSE pipeline + 15+ federated API router**, **`R01–R30` formal symbolic rule system**, **`1,064` audited real PDFs**, **`228K+` LOC**, and **`2,205+` automated tests**.

This redesign rebuilds the script, stage layouts, 120fps spline camera rig, transitions, procedural soundtrack, and web streaming ladder from the ground up so the Defense Committee experiences immediate visual and engineering awe.

---

## 2. Goals, Non-Goals, and Anti-Goals

### Goals
- **Exact `90.0s` duration at true `120 fps` (`10,800` frames)**, locked to a `120 BPM` musical grid (`1 beat = 0.5s = 60 frames`, `1 bar = 2.0s = 240 frames`) where every scene transition lands on an exact bar downbeat.
- **5-Act "Keynote Spatial Cinema" structure across 13 bespoke scenes**, alternating purposefully between **Dark Obsidian Cinema (`#0C0F0E`)** for code-driven architectural/empirical visualizations and **Warm Editorial Ivory (`#FAF8F3`)** for 3x Retina UI captures (`4320×2700` and `4320×5400`).
- **Zero consecutive layout repetition:** Every scene employs a distinct spatial stage (3D Manuscript Laser Scanner, Optical Iris Brand Reveal, Isometric Split-Deck, Full-Screen Interactive Architecture DAG, Macro Camera Dive with 3D Glass Loupes, Dual-Plane Perspective, Synchronized Dual-Scroll Inspector, Spotlight Remediation Studio + QR Seal, Cascading Multi-Window Command Center, 3D Spatial Bento Matrix, Ablation Racing Arena, Architectural Swiss-Grid Engineering Monument, Grand Finale Lockup).
- **Refined Bilingual Copywriting (Approved):** Concise international keynote **English** display headlines set in `Sentient` (`F.display`), paired with sharp **Vietnamese** technical HUD captions/subtitles set in `Plus Jakarta Sans` (`F.sans`) and `Source Serif 4` (`F.serif`) so committee members grasp every technical point immediately while keeping 100% visual harmony with the English UI screenshots.
- **Latest `HEAD` (`v3.75.2`) Canonical Metrics (Approved):**
  - Version: `v3.75.2`
  - Federated Scholarly & Technical APIs: `15+` (`productFacts.ts`)
  - Local Scholarly Knowledge Base: `128,717` (`128K+`) papers in SQLite FTS5
  - Citation Styles Supported: `12` international & Vietnamese styles + VN Legal statutes
  - Symbolic Rule Engine: `30` formal rule families (`R01–R30`, backed by `55+` diagnostic `R-*` codes)
  - Empirical Benchmark: `120,000` distinct papers (`0%` leakage, `N = 18,000` held-out test), `98.58%` Neuro-Symbolic Acc (`99.86%` 16D HybridML, `+33.7%` vs Pure SBERT `64.85%`), `100.0%` Hallucination F1 (`0` false accusations), `0.0433` Platt ECE (`↓4.9×`)
  - Software Engineering & Real-World Audit Scale: `1,064` audited PDFs (`38,317` extracted references, `100%` HTTP 200 zero-crash pipeline), `228,000+` LOC (`Python + TypeScript + Tests`), `2,205+` automated tests across Pytest, Vitest, and Playwright E2E.
- **Full 120fps Masters + Landing Page Upgrade (Approved):**
  - Produce true `120 fps` presentation masters in `marketing/citra-promo/out/`.
  - Re-encode the full web delivery ladder into `web/public/media/citra-film-v2/` (with **120fps high-tier variants** for ProMotion/120Hz hardware decoders + **60fps hardware-safe fallbacks** for mobile/standard devices), update `web/src/components/landing/CitraFilm.tsx` (`90s` / `1:30`, per-variant `fps` probing), and clean up obsolete `web/public/media/citra-film-v1/`.

### Non-Goals
- Re-capturing live Playwright screenshots (existing 49 `4320×2700` & `4320×5400` 3x Retina PNGs in `public/shots/` already cover all screens cleanly).
- Spoken voiceover / TTS (music + foley keynote format lets the presenter speak live or play standalone).

### Anti-Goals (Failure Conditions)
- **Never render Vietnamese diacritics (`ơ, ư, ệ, ậ, ổ...`) using `Sentient`:** `Sentient-Light.woff2` is a Latin-only subset; all Vietnamese strings MUST use `F.sans` (`Plus Jakarta Sans`), `F.serif` (`Source Serif 4`), or `F.mono` (`JetBrains Mono` with `vietnamese` subset).
- **Never use thick red/green `4000px` box-shadow cutouts** over UI screenshots — replace with elevated 3D `GlassLoupe` magnifier cards, subtle optical focus dimming, and vector connector lines.
- **Never repeat two identical 2-column browser layouts consecutively.**
- **Never hardcode 60fps frame indices:** All timing in scenes and components must be expressed in seconds via `sec(s)` / `useTime()` so motion is mathematically exact at `120 fps`.

---

## 3. Constraints

1. **Typography & Subset Safety (`src/theme.ts`):**
   - `F.display` (`Sentient`) → English headlines and numeric counters only.
   - `F.sans` (`Plus Jakarta Sans`, `latin` + `vietnamese`) → Vietnamese HUD subtitles, badges, UI labels.
   - `F.serif` (`Source Serif 4`, `latin` + `vietnamese`) → Vietnamese editorial taglines & academic citations.
   - `F.mono` (`JetBrains Mono`, `latin` + `latin-ext` + `vietnamese`) → Technical telemetry, rule IDs, timestamps.
2. **Playwright Headless Shell (`remotion.config.ts`):**
   - Retain Playwright's Chromium headless shell path on macOS so Remotion bundling/rendering never stalls.
3. **Codec & Hardware Decode Safety at 120 fps:**
   - H.264 `1080p120` uses Level `5.1` (`avc1.640033`); `1440p120` uses Level `5.2` (`avc1.640034`); AV1 `1440p120` uses Level `5.1` (`av01.0.13M.08`); `1080p120` AV1 uses Level `4.3` (`av01.0.11M.08`).
   - Web fallback streams (`1080p60` HEVC/H.264 and `720p60` AV1/H.264) remain at `60 fps` so iOS/older decoders always have a hardware-accelerated fallback via `MediaCapabilities.decodingInfo()`.

---

## 4. Approaches Considered

1. **Approach A — Keynote Spatial Cinema: 5-Act Multi-Layout Canvas Alternating Warm Editorial Ivory & Dark Obsidian Cinema (Selected)**
   - Pairs bright editorial product stages (matching the light-mode `4320px` Retina UI captures) with 3 high-contrast Dark Obsidian acts (`hook`, `architecture`, `ablation`) powered by pure code-driven 120fps motion graphics, continuous $C^1$ spline camera rigs, and 3D Glass Magnifier Loupes.
   - *Trade-off:* Requires custom engineering across 13 distinct scene layouts, a 90s procedural audio score, and a hybrid 120fps/60fps encode ladder, but delivers maximum visual drama and academic credibility.
2. **Approach B — Pure Dark 3D SaaS Showcase (Rejected)**
   - Clashes visually with CITRA's 49 warm light-mode UI screenshots and strips away the platform's signature academic-editorial identity.
3. **Approach C — Pure Light Swiss Editorial Documentary (Rejected)**
   - Clean 2D flat layouts lack the 3D spatial depth, lighting contrast, and kinetic energy required to awe a live defense committee.

---

## 5. Detailed 90-Second · 120fps Storyboard & Spatial Layout Design

Every scene cut lands on an exact `2.0s` musical bar boundary (`120 BPM`, `1 bar = 2.0s = 240 frames`). Adjacent scenes overlap via `0.45s` (`54`-frame) spatial/optical transitions while preserving exact downbeat synchronization with `audio/make_music.py`.

| # | Scene ID | Time (s) | Dur | Theme | Unique Spatial Layout | Content, Camera & Bilingual Copy |
| :-: | :--- | :---: | :---: | :---: | :--- | :--- |
| **01** | `hook` | `00 – 10` | `10s` | **Dark Obsidian** | **3D Floating Manuscript & Laser Scanner** | Tilted 3D manuscript sheet in deep Obsidian space (`#0C0F0E`) with volumetric emerald/crimson rim glow & live telemetry HUD. Optical laser beam scans 3 citations: `[1] Vaswani et al. (2017)` (`✓ VERIFIED · 12ms`), `[2] Mehra et al. (2020)` (`⚠ RETRACTED PAPER`), `[3] Kowalski (2024) doi:10.9999/fake.2024` (RGB chromatic aberration + fracture strikethrough `✕ AI HALLUCINATION · 0/15+ DBs`). At `6.4s`, camera flies forward into Keynote kinetic typography:<br>• **EN:** *"AI writes fluent citations in seconds. Some of them **never existed.**"* → *"Who verifies the **truth?**"*<br>• **VI:** *"AI tạo hàng chục trích dẫn trôi chảy trong tích tắc — nhưng nhiều nguồn hoàn toàn hư cấu."* |
| **02** | `reveal` | `10 – 16` | `6s` | **Light Ivory** | **Optical Iris Bloom & 3D Brand Emblem** | Sub-drop impact at `10.0s` blooms from Obsidian into luminous painterly Ivory (`hero-bg.png` + `feature-2-bg.png` depth layers). 3D glass CITRA emblem locks in beside masked kinetic `CITRA` letters + architecture pills (`v3.75` · `NEURO-SYMBOLIC AI` · `R01–R30 EXPLAINABLE RULES`).<br>• **EN:** *"Verify every citation. **Trace every source.**"*<br>• **VI:** *"Nền tảng Kiểm chứng & Truy vết Trích dẫn Học thuật Neuro-Symbolic có Giải thích."* |
| **03** | `ingest` | `16 – 22` | `6s` | **Light Ivory** | **Isometric Split Stage + Floating TEI-XML & L1 Cards** | 3D angled browser (`upload.png` → smooth cross-dissolve to `report-consistency.png`) with animated `thesis_final.pdf` drop, flanked by floating glass cards showing live `GROBID 0.9.1-crf TEI-XML` segmentation, legacy Vietnamese font/OCR support, and **Layer 1 Bidirectional Linking** (`In-Text ↔ Bibliography` across **12 citation styles** + VN Legal statutes).<br>• **EN:** *"Drop any manuscript. **Link every reference.**"*<br>• **VI:** *"Bóc tách PDF hai cột, DOCX, BibTeX · Đối sánh hai chiều trích dẫn qua 12 chuẩn quốc tế & văn bản pháp luật Việt Nam."* |
| **04** | `architecture` | `22 – 30` | `8s` | **Dark Obsidian** | **Full-Screen Interactive 8-Stage DAG & 15+ API Constellation** | Pure code-driven architectural blueprint. Upper track animates the **8-Stage Real-Time SSE Pipeline** (`GROBID TEI` → `12-Style Lock` → `L1 Linker` → `15+ API Router` → `SBERT + ONNX VI↔EN` → `R01–R30 Rules` → `16D HybridML` → `Platt Verdict`). Center-lower hub fires 120fps Bezier pulses to **15+ live scholarly nodes** (`128K+ Local FTS5`, `Crossref`, `OpenAlex`, `arXiv`, `DBLP`, `PubMed`, `Europe PMC`, `DataCite`, `DOAJ`, `OpenAIRE/HAL`, `OpenLibrary`, `HuggingFace`, `IETF RFC`, `Retraction Watch`, `Wayback`, `VN Legal`).<br>• **EN:** *"8-stage pipeline. **15+ global scholarly indexes.**"*<br>• **VI:** *"Định tuyến đa luồng theo lĩnh vực qua 15+ CSDL học thuật quốc tế, kho 128K+ bài báo nội bộ & bắc cầu ngữ nghĩa Đa ngữ."* |
| **05** | `hallucination` | `30 – 38` | `8s` | **Light Ivory** | **Full-Bleed Macro Camera Dive + 3D Glass Loupes** | Compact top Keynote HUD bar frees 85% of the screen for a continuous $C^1$-smooth 3D-to-macro camera dive across `report-halluc` → `report-halluc-retrieval` → `report-halluc-rules`. Two **Floating 3D Glass Magnifier Loupes** lift forward in Z-space to magnify `0 / 15+ Databases Matched` and rule `R-FABRICATED-DOI (10.9999/*)`.<br>• **EN:** *"Expose AI hallucinations with **zero guesswork.**"*<br>• **VI:** *"Bắt trọn DOI giả mạo & trích dẫn ghép nối tinh vi (Chimeric LLM) bằng đối chứng đa nguồn."* |
| **06** | `retraction` | `38 – 44` | `6s` | **Light Ivory** | **Asymmetric Dual-Plane Perspective (`tall-meta` + `processing`)** | Layered dual depth planes: rear window shows `processing.png` (`WAYBACK ARCHIVED` + `METADATA_ERROR`), foreground window glides smoothly down `tall-meta.png` while a Floating Glass Loupe spotlights `⚠ OFFICIALLY RETRACTED` (*The Lancet* COVID-19 study) and field-by-field canonical diffs.<br>• **EN:** *"Retracted papers & link rot, **caught instantly.**"*<br>• **VI:** *"Cảnh báo bài báo bị rút (Retraction Watch) & phân biệt thông minh link hỏng thật với bản lưu Wayback Machine."* |
| **07** | `trace` | `44 – 50` | `6s` | **Light Ivory** | **Synchronized Dual-Scroll Glass Inspector (`tall-trace` + `tall-evgraph`)** | Twin tilted vertical glass viewports scrolling in counter-parallax harmony: left viewport glides down the **5-Stage Logic Trace** (`tall-trace`), right viewport glides through the **Neuro-Symbolic Evidence DAG** (`tall-evgraph`), bridged by a floating formula badge (`R01–R30 Symbolic Rules · 16D HybridML · Platt Calibration`).<br>• **EN:** *"No black box. **Every verdict explained.**"*<br>• **VI:** *"Giải thích tường minh từng bước suy diễn `R01–R30`, độ tương đồng ngữ nghĩa Abstract và cây bằng chứng DAG."* |
| **08** | `autofix` | `50 – 58` | `8s` | **Light Ivory** | **Center-Stage Remediation Studio + QR Seal Showcase** | Cursor clicks `1-Click Auto-Fix & BibTeX` on `report-ide` → smooth zoom-morph into `tall-autofix` studio. Emerald sweep highlights Before → After canonical repair alongside format pills (`APA 7th`, `IEEE`, `Harvard/TDTU`, `.bib`, `.ris`, **`Auto-Healed .DOCX`**) and an elevated **ISO/IEC 18004 QR Tamper-Evident Digital Verification Receipt** card.<br>• **EN:** *"One-click remediation. **Tamper-evident export.**"*<br>• **VI:** *"Tự động chuẩn hóa danh mục tài liệu tham khảo, xuất file Word đã sửa lỗi kèm chứng thực số QR chống giả mạo."* |
| **09** | `educator` | `58 – 66` | `8s` | **Light Ivory** | **Cascading Multi-Window Cohort Command Center** | Three-plane spatial choreography for Faculty & Defense Committees: `tall-teacher` (`Đồ án Tốt nghiệp CNTT 2026` + `Shared AI Hallucination Radar` magnified via Glass Loupe) cascades smoothly into `teacher-reviews` (`Faculty Adjudication Queue` + Human-in-the-Loop Override & immutable Audit Log).<br>• **EN:** *"Cohort-wide radar for **committees & educators.**"*<br>• **VI:** *"Radar phát hiện ảo giác AI trùng lặp toàn khóa, hàng đợi thẩm định cho giảng viên & nhật ký kiểm toán bất biến."* |
| **10** | `ecosystem` | `66 – 72` | `6s` | **Light Ivory** | **3D Spatial Bento Matrix (8 Live Screens)** | Camera starts close on `sandbox-loaded` (`Live ACL Citation Sandbox`), then pulls back smoothly in 3D perspective (`rotateX(14deg) rotateZ(-4deg)`) to unveil an **8-tile Bento Wall** (`sandbox-loaded`, `report-thesis` 100-page thesis, `report-document`, `report-issues`, `batch`, `dashboard`, `admin-system`, `pricing`) with beat-synced spotlight pulses.<br>• **EN:** *"One unified workspace. **Built for production.**"*<br>• **VI:** *"Từ Live Sandbox thử nghiệm tức thì, kiểm chứng hàng loạt khóa luận 100+ trang đến giám sát vận hành thời gian thực."* |
| **11** | `ablation` | `72 – 80` | `8s` | **Dark Obsidian** | **120,000-Paper Empirical Benchmark & Ablation Arena** | High-contrast dark empirical arena (`Strict Paper-Disjoint Split · 0% Leakage · Held-Out Test N = 18,000`):<br>• Animated racing horizontal bars compare `B0 DOI-Only (30.19%)`, `B3 Pure Sentence-BERT (64.85%)`, `B1 Single-Source Crossref (69.66%)`, `B2 Lexical Fuzzy (78.28%)` vs **`CITRA Neuro-Symbolic (98.58%)` / `16D HybridML (99.86%)`** (`+33.7%` over pure SBERT).<br>• Glowing side KPI monoliths: **`100.0%` Hallucination F1 (`5,400/5,400` · `0` False Accusations)** & **`0.0433` Platt ECE (`↓4.9×`)**.<br>• **EN:** *"Proven on **120,000 papers.** Zero false accusations."*<br>• **VI:** *"Kiểm định độc lập không rò rỉ dữ liệu: vượt xa thuần SBERT +33.7%, đạt 100% F1 bắt ảo giác và 0% kết oan bài thật."* |
| **12** | `scale` | `80 – 86` | `6s` | **Light Ivory** | **Architectural Swiss-Grid Engineering Monument** | Editorial monument grid with animated tabular counters, micro-bars, and breakdown pills showcasing Software Engineering rigor:<br>• **`1,064`** Real PDFs Audited (`38,317` refs · `100%` zero-crash pipeline)<br>• **`228K+`** Lines of Code (`FastAPI` + `React 18 TS` + `Test Suites`)<br>• **`2,205+`** Automated Tests Passing (`Pytest` · `Vitest` · `Playwright E2E`)<br>• **`R01–R30`** Symbolic Rules · **`12`** Citation Styles · **`128K+`** Local Papers<br>• **EN:** *"Engineered at **research & production scale.**"*<br>• **VI:** *"Kiểm toán thực chiến trên 1.064 tệp PDF đa chuẩn, vận hành trên 228.000+ dòng mã nguồn & 2.205+ bài test tự động."* |
| **13** | `endcard` | `86 – 90` | `4s` | **Light Ivory** | **Grand Finale Keynote Lockup** | Luminous painterly backdrop (`hero-bg.png`), 3D glass CITRA emblem, crisp lockup, bilingual motto, live CTA pill `citra.io.vn`, and academic footer:<br>`SOFTWARE ENGINEERING GRADUATION THESIS · TON DUC THANG UNIVERSITY · 2026`. |

---

## 6. Architecture, Web Ladder & Builder Calls

### 6.1. Modular Source Structure (`marketing/citra-promo/src/`)
```text
marketing/citra-promo/src/
├── index.ts
├── Root.tsx                      # CitraPromo (1920x1080, fps=120, 10,800 frames)
├── Video.tsx                     # Beat-locked scene sequence + 0.45s spatial transitions + Audio
├── timeline.json                 # Shared contract: fps=120, bpm=120, durationSec=90, scenes[], sfx[]
├── theme.ts                      # Ivory + Obsidian palettes; Sentient, Jakarta, Source Serif 4, JetBrains Mono (VI)
├── components/
│   ├── motion.ts                 # sec(), useTime(), useSpringSec(), C1 monotone cubic Hermite spline helpers
│   ├── backdrops.tsx             # IvoryStage, ObsidianStage (radial aurora + coordinate grid), PainterlyPanel, Vignette
│   ├── typography.tsx            # BilingualStageHeader, KineticWords, EditorialCaptionVi, MetricOdometer
│   ├── CinemaBrowser.tsx         # C1 spline 3D camera rig, GlassLoupe magnifier cards, SVG callouts, Cursor
│   └── transitions.tsx           # OpticalBloom, DepthPortal, WhipGlide transition wrappers
└── scenes/
    ├── Act1HookReveal.tsx        # Scenes 01 (hook) & 02 (reveal)
    ├── Act2Architecture.tsx      # Scenes 03 (ingest) & 04 (architecture - 8-stage DAG + 15+ APIs)
    ├── Act3Inspection.tsx        # Scenes 05 (hallucination), 06 (retraction), 07 (trace), 08 (autofix + QR)
    ├── Act4Ecosystem.tsx         # Scenes 09 (educator multi-window) & 10 (ecosystem 3D Bento wall)
    └── Act5ProofFinale.tsx       # Scenes 11 (ablation 120K chart), 12 (engineering scale), 13 (endcard)
```

### 6.2. Builder Technical Calls
1. **Smooth $C^1$ Camera Spline (`CinemaBrowser.tsx`):** Monotone cubic Hermite interpolation over `(cx, cy, ln(w), rotX, rotY, rotZ)` preserves continuous velocity across multi-waypoint camera paths without overshoot or keyframe freeze.
2. **Elevated 3D Glass Magnifier Loupe (`GlassLoupe`):** Crops and scales (`1.35×–1.55×`) target coordinates directly from the `4320px` source PNG inside a floating specular glass card with subtle backdrop dimming (`0.16` max) and monospace rule badges.
3. **Hybrid `120fps` + `60fps` Web Delivery Ladder (`scripts/encode_web.sh` & `CitraFilm.tsx`):**
   - Bump `BASE` to `/media/citra-film-v2` and remove legacy `web/public/media/citra-film-v1/`.
   - Render `out/web_master_1440p120.mp4` (`2560×1440` @ `120 fps`, grain-free, CRF `10`, AAC `320k`) and also copy/export `out/CITRA_Promo_90s_120fps.mp4` (`1440p120` presentation master) + `out/CITRA_Promo_1080p120.mp4` (`1080p120` universal presentation master).
   - Encode **true 120 fps** high-tier web variants (`film-1440p-120.av1.mp4`, `film-1080p-120.av1.mp4`, `film-1080p-120.h264.mp4`) plus **60 fps** universal hardware-safe fallbacks (`film-1080p.hevc.mp4`, `film-1080p.h264.mp4`, `film-720p.av1.mp4`, `film-720p.h264.mp4`), a `4.0s` muted 30fps teaser loop (`66.0s–70.0s` 3D Bento reveal), and responsive AVIF/WebP/JPG posters (`13.2s` Brand Reveal frame).
   - Update `CitraFilm.tsx` `Variant` type to include `fps: 120 | 60` passed into `MediaCapabilities.decodingInfo()`, and update UI labels (`90 giây` / `90-second film` / `1:30 · 120fps`).

---

## 7. Verification Criteria

1. **Typecheck & Lint:** `npx tsc --noEmit` in `marketing/citra-promo` and `web` passes with 0 errors.
2. **Procedural Audio Master:** `python3 audio/make_music.py` outputs `public/audio/soundtrack.wav` at exact `90.0s`, `48,000 Hz`, 24-bit stereo, peak `<= -0.9 dBFS`.
3. **13-Scene Visual Stills Inspection:** Render preview stills across all 13 scenes via `scripts-stills.mjs` and visually inspect every frame for layout polish, Vietnamese diacritics, Loupe crop alignment, and visual contrast.
4. **120 fps Master & Web Ladder Verification:**
   - Verify `out/CITRA_Promo_90s_120fps.mp4` and `out/CITRA_Promo_1080p120.mp4` via `ffprobe` (`r_frame_rate=120/1`, `nb_frames=10800`, `duration=90.000000`, `48000 Hz` stereo AAC).
   - Run `./scripts/encode_web.sh` to populate `web/public/media/citra-film-v2/`, remove `citra-film-v1/`, and pass `npx vitest run` + `npm run build` in `web/`.
