# CITRA — 90-Second · 120fps Keynote Spatial Cinema Film (`v3.75.2`)

Programmatic 5-Act bilingual keynote film for **CITRA (`v3.75.2`)**, engineered with [Remotion](https://remotion.dev) at **true 120 fps (`10,800` frames · `90.0s`)** for both the **Software Engineering Graduation Thesis Defense (Tôn Đức Thắng University)** and the official **`citra.io.vn`** landing page.

| Item | Specification |
| :--- | :--- |
| **Masters** | `out/CITRA_Promo_90s_120fps.mp4` (`2560×1440` @ `120fps`) · `out/CITRA_Promo_1080p120.mp4` (`1920×1080` @ `120fps`) |
| **Web Delivery** | `web/public/media/citra-film-v2/` (Hybrid `120fps` + `60fps` AV1 / HEVC / H.264 ladder + `4s` teaser + AVIF/WebP/JPG posters) |
| **Frame Rate** | `120 fps` · `10,800` frames · `90.0 s` (`120 BPM` bar-locked: `1 bar = 2.0 s = 240 frames`) |
| **Audio** | Procedural 5-Act Stereo Score + Synchronized Foley (`48 kHz`, 24-bit WAV → AAC `320 kbps`) |
| **Copywriting** | International English display headlines (`Sentient`) + Vietnamese technical HUD captions (`Plus Jakarta Sans` & `Source Serif 4`) |

## 13-Scene · 5-Act Storyboard (`src/timeline.json`)

| Time | Scene ID | Theme | Spatial Layout & `v3.75.2` Highlights |
| :--- | :--- | :---: | :--- |
| `00–10s` | `hook` | Dark Obsidian | 3D Floating Manuscript + Volumetric Laser Scanner (`✓ Verified`, `⚠ Retracted`, `✕ Fake DOI Glitch`) → Keynote Statement |
| `10–16s` | `reveal` | Warm Ivory | Optical Iris Bloom + 3D Glass CITRA Emblem + Kinetic Wordmark + `v3.75.2 · R01–R30` |
| `16–22s` | `ingest` | Warm Ivory | Isometric Split Browser (`upload` → `report-consistency`) + `GROBID TEI-XML` & `12 Citation Styles + VN Legal` |
| `22–30s` | `architecture` | Dark Obsidian | Code-Driven **8-Stage Real-Time SSE Pipeline** + **15+ External & 128K+ Local FTS5 Constellation** |
| `30–38s` | `hallucination` | Warm Ivory | Full-Bleed $C^1$ Macro Camera Dive + Two 3D `GlassLoupe` Magnifiers (`0 / 15+ DBs` & `R-FABRICATED-DOI`) |
| `38–44s` | `retraction` | Warm Ivory | Asymmetric Dual-Plane Perspective (`processing` Wayback CDX + `tall-meta` Retraction Watch Alert) |
| `44–50s` | `trace` | Warm Ivory | Counter-Scrolling Twin Glass Viewports (`tall-trace` 5-Stage Trace + `tall-evgraph` Evidence DAG) |
| `50–58s` | `autofix` | Warm Ivory | 1-Click Auto-Remediation Studio + `Auto-Healed .DOCX` + **ISO/IEC 18004 QR Digital Verification Receipt** |
| `58–66s` | `educator` | Warm Ivory | 3-Plane Cascading Cohort Command Center (`Đồ án Tốt nghiệp CNTT 2026` Shared Hallucination Radar + Faculty Queue) |
| `66–72s` | `ecosystem` | Warm Ivory | 3D Spatial Bento Matrix Pulling Back Across 8 Live Screens (`Sandbox`, `100p Thesis`, `Batch`, `Admin`, etc.) |
| `72–80s` | `ablation` | Dark Obsidian | **120,000-Paper Paper-Disjoint Benchmark** (`98.58%` Neuro-Symbolic / `99.86%` 16D HybridML vs `64.85%` Pure SBERT, `100%` Hallucination F1, `0.0433` ECE) |
| `80–86s` | `scale` | Warm Ivory | Swiss-Grid Engineering Monument (`1,064` Audited PDFs · `228K+` LOC · `2,205+` Automated Tests · `R01–R30`) |
| `86–90s` | `endcard` | Warm Ivory | Grand Finale CITRA Lockup + `citra.io.vn` + `TON DUC THANG UNIVERSITY · 2026` |

## Verify, Render & Encode

```bash
cd marketing/citra-promo
npm test && npx tsc --noEmit

# 1) Synthesize 90s 48kHz 24-bit stereo soundtrack + foley
../../.venv/bin/python audio/make_music.py

# 2) Render 1440p120 master + presentation deliverables
npm run render:web-master
./scripts/encode_web.sh
```
