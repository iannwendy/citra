# CITRA 90-Second · 120fps Keynote Spatial Cinema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `marketing/citra-promo` into a 90-second, true 120fps, 5-act "Keynote Spatial Cinema" bilingual film showcasing CITRA `v3.75.2`, synthesize a synchronized 90s procedural stereo score, export 120fps Defense Hall masters, and re-encode + update the landing page player (`citra-film-v2`).

**Architecture:** `src/timeline.json` serves as the single bar-locked (`120 BPM`, `fps: 120`, `durationSec: 90`, `10,800` frames) contract shared between React/Remotion scenes and Python's procedural synthesizer (`audio/make_music.py`). A time-based $C^1$ monotone cubic Hermite spline engine drives continuous 3D camera choreography and elevated `GlassLoupe` magnifiers across 13 distinct spatial layouts alternating Dark Obsidian Cinema (`#0C0F0E`) and Warm Editorial Ivory (`#FAF8F3`), feeding both standalone 120fps H.264 masters and a hybrid 120fps/60fps AV1/HEVC/H.264 web streaming ladder in `CitraFilm.tsx`.

**Tech Stack:** Remotion `4.0.539`, React 18, TypeScript, Node 24 (`node --test`), Python 3 (`numpy`, `scipy`, `Pillow`), Homebrew `ffmpeg` (`libsvtav1`, `libx265`, `libx264`, `aac_at`), Vite + Vitest (`web/`).

**Spec:** `docs/superpowers/specs/2026-11-15-citra-promo-90s-120fps-design.md`

## Global Constraints

- Exact duration `90.0s` at `120 fps` (`10,800` frames); every scene boundary lands on an even-second `120 BPM` bar downbeat (`2.0s` multiples).
- Never render Vietnamese extended diacritics (`ơ, ư, ệ, ể, ễ, ậ, ẩ, ẫ, ộ, ổ, ỗ, ự, ử, ữ`) in `F.display` (`Sentient`); all Vietnamese copy MUST use `F.sans` (`Plus Jakarta Sans`), `F.serif` (`Source Serif 4`), or `F.mono` (`JetBrains Mono` with `vietnamese` subset).
- Canonical `v3.75.2` figures (`HEAD` & `productFacts.ts`): `15+` scholarly APIs, `128K+` (`128,717`) local FTS5 papers, `12` citation styles, `30` formal symbolic rule families (`R01–R30`), `120,000` benchmark papers (`98.58%` Neuro-Symbolic Acc / `99.86%` 16D HybridML vs `64.85%` Pure SBERT, `100.0%` Hallucination F1, `0.0433` Platt ECE), `1,064` audited PDFs, `228K+` LOC, `2,205+` automated tests.
- Do not touch or stage unrelated modified files in `src/integrity_checker/` or `web/src/pages/EssayPage.tsx`.
- Retain Playwright headless Chromium executable override in `marketing/citra-promo/remotion.config.ts`.

## Review Focus

1. **Font glyph fallback mid-word in headlines:** Any Vietnamese word containing `ơ, ư, ệ...` accidentally passed to a `Sentient` headline component must fail an automated copy-safety test (`assertSentientSafe`).
2. **Camera zoom inversion or zero-width NaN (`w <= 0`):** Log-space Hermite spline interpolation must keep `w` strictly within `[0.15, 1.25]` with zero overshoot past keyframe extrema (`monotoneHermite`).
3. **Hardcoded 60fps frame constants causing 2× speed playback at 120fps:** Every scene timing, cursor waypoint, Loupe window, and spring delay must derive from seconds (`sec(s)`), verified at `fps = 120`.
4. **Browser `MediaCapabilities` rejection of 120fps streams on 60Hz/mobile hardware:** `pickVariant()` in `CitraFilm.tsx` must probe each variant's actual `v.fps` (`120` vs `60`) rather than a hardcoded `60`, falling back cleanly to `60fps` streams when `120fps` is not `smooth && powerEfficient`.
5. **Frame-number zero-padding overflow at `frame >= 10000`:** `scripts-stills.mjs` and Remotion sequence math must pad 5 digits (`00000`–`10799`) and never clip the final scene (`86s–90s`, frames `10320–10799`).

---

### Task 1: 90s · 120fps Timeline Contract, Typography Safety & $C^1$ Spline Motion Engine

**Files:**
- Modify: `marketing/citra-promo/src/timeline.json`
- Modify: `marketing/citra-promo/src/theme.ts`
- Create: `marketing/citra-promo/src/components/motion.ts`
- Create: `marketing/citra-promo/src/__tests__/motion-and-timeline.test.ts`
- Modify: `marketing/citra-promo/package.json`

**Interfaces:**
- Produces:
  - `timeline.json`: `{ fps: 120, bpm: 120, durationSec: 90, scenes: SceneDef[], sfx: SfxConfig }`
  - `motion.ts`: `sec(seconds: number, fps?: number): number`, `monotoneHermite(xs: number[], ys: number[], x: number): number`, `camSplineAt(timeSec: number, keys: CamKey[]): CamPose`, `isSentientSafe(text: string): boolean`, `assertSentientSafe(text: string): string`
  - `CamKey`: `{ t: number; cx: number; cy: number; w: number; rotX?: number; rotY?: number; rotZ?: number }`

- [ ] **Step 1: Write failing unit tests in `marketing/citra-promo/src/__tests__/motion-and-timeline.test.ts`**
  Assert `timeline.fps === 120`, `timeline.durationSec === 90`, 13 contiguous bar-aligned scenes `[0..90]`, monotone Hermite spline $C^1$ continuity (non-zero midpoint velocity across 3 monotonic waypoints and zero overshoot), and `isSentientSafe` rejecting Vietnamese horn/hook/circumflex-dot codepoints while accepting ASCII/Latin-1 punctuation.
- [ ] **Step 2: Run `node --test src/__tests__/motion-and-timeline.test.ts` to verify RED**
- [ ] **Step 3: Update `timeline.json`, `theme.ts` (adding `Obsidian` palette + `vietnamese` subset on `JetBrainsMono`), `components/motion.ts`, and `package.json` scripts**
- [ ] **Step 4: Run `node --test src/__tests__/motion-and-timeline.test.ts` and `npx tsc --noEmit` to verify GREEN**

---

### Task 2: Spatial Backdrops, Bilingual Keynote Typography, 3D `CinemaBrowser` (`GlassLoupe`) & Transitions

**Files:**
- Create: `marketing/citra-promo/src/components/backdrops.tsx`
- Create: `marketing/citra-promo/src/components/typography.tsx`
- Create: `marketing/citra-promo/src/components/CinemaBrowser.tsx`
- Create: `marketing/citra-promo/src/components/transitions.tsx`

**Interfaces:**
- Consumes: `motion.ts`, `theme.ts`
- Produces:
  - `IvoryStage`, `ObsidianStage`, `PainterlyCard`, `Vignette`
  - `BilingualStageHeader`, `KineticWords`, `EditorialCaptionVi`, `EyebrowTag`, `MetricCounter`, `TechBadge`
  - `CinemaBrowser`, `ZoomShot3D`, `GlassLoupe` (`LoupeSpec`: `{ rect: [number, number, number, number]; fromSec: number; toSec?: number; x: number; y: number; width: number; zoom?: number; badge: string; sub?: string; accent?: string; anchorSide?: 'left' | 'right' | 'top' | 'bottom' }`), `SmoothCursor`
  - `ScenePortal` (`mode: 'bloom' | 'depth' | 'glide' | 'dissolve'`)

- [ ] **Step 1: Extend `src/__tests__/motion-and-timeline.test.ts` with pure geometry tests for `computeLoupeCrop` and `computeViewportLayout` (aspect `0.625` & `1.25`)**
- [ ] **Step 2: Run `node --test` to verify RED**
- [ ] **Step 3: Implement `backdrops.tsx`, `typography.tsx`, `CinemaBrowser.tsx`, and `transitions.tsx`**
- [ ] **Step 4: Run `node --test` and `npx tsc --noEmit` to verify GREEN**

---

### Task 3: Act I (`00–16s` Hook & Brand Reveal) & Act II (`16–30s` Ingest & 8-Stage / 15+ API Architecture)

**Files:**
- Create: `marketing/citra-promo/src/scenes/Act1HookReveal.tsx`
- Create: `marketing/citra-promo/src/scenes/Act2Architecture.tsx`

**Interfaces:**
- Consumes: `backdrops.tsx`, `typography.tsx`, `CinemaBrowser.tsx`, `motion.ts`, `timeline.json`
- Produces: `HookScene` (`0–10s`), `RevealScene` (`10–16s`), `IngestScene` (`16–22s`), `ArchitectureScene` (`22–30s`)

- [ ] **Step 1: Add headline copy-safety registry test in `src/__tests__/scene-copy.test.ts` checking all English `Sentient` headlines in Act I & II pass `isSentientSafe`**
- [ ] **Step 2: Run `node --test` to verify RED**
- [ ] **Step 3: Implement `Act1HookReveal.tsx` (3D Obsidian Manuscript Laser Scanner + Optical Iris Brand Reveal) and `Act2Architecture.tsx` (Isometric Split Ingest + Dark Obsidian 8-Stage Pipeline & 15+ API Constellation)**
- [ ] **Step 4: Run `node --test` and `npx tsc --noEmit` to verify GREEN**

---

### Task 4: Act III (`30–58s` Hallucination Dive, Retraction Watch, Dual Logic Trace & Auto-Fix + QR Seal)

**Files:**
- Create: `marketing/citra-promo/src/scenes/Act3Inspection.tsx`

**Interfaces:**
- Consumes: `backdrops.tsx`, `typography.tsx`, `CinemaBrowser.tsx`, `motion.ts`
- Produces: `HallucinationScene` (`30–38s`), `RetractionScene` (`38–44s`), `TraceScene` (`44–50s`), `AutoFixScene` (`50–58s`)

- [ ] **Step 1: Add Act III copy-safety & Loupe bounds assertions (`0 <= rx, ry <= 1`) to `src/__tests__/scene-copy.test.ts`**
- [ ] **Step 2: Run `node --test` to verify RED**
- [ ] **Step 3: Implement `Act3Inspection.tsx` with 4 distinct layouts (Full-Bleed Macro Dive + 3D Loupes, Asymmetric Dual-Plane Perspective, Synchronized Dual-Scroll Glass Inspector, Center-Stage Remediation Studio + ISO QR Digital Receipt)**
- [ ] **Step 4: Run `node --test` and `npx tsc --noEmit` to verify GREEN**

---

### Task 5: Act IV (`58–72s` Educator & 3D Bento) & Act V (`72–90s` 120K Ablation, Scale Monument & Finale) + Root Wiring

**Files:**
- Create: `marketing/citra-promo/src/scenes/Act4Ecosystem.tsx`
- Create: `marketing/citra-promo/src/scenes/Act5ProofFinale.tsx`
- Modify: `marketing/citra-promo/src/Video.tsx`
- Modify: `marketing/citra-promo/src/Root.tsx`
- Remove legacy unused files: `src/scenes/Hook.tsx`, `src/scenes/Reveal.tsx`, `src/scenes/Features.tsx`, `src/scenes/Closing.tsx`, `src/components/FeatureScene.tsx`, `src/components/Browser.tsx`, `src/components/primitives.tsx`

- [ ] **Step 1: Extend `src/__tests__/scene-copy.test.ts` to assert all 13 `timeline.scenes` IDs map to exported scene components, all English headlines are `Sentient`-safe, and canonical `v3.75.2` benchmark/scale numbers (`120,000`, `98.58`, `100.0`, `0.0433`, `1,064`, `228`, `2,205`, `R01–R30`) match spec**
- [ ] **Step 2: Run `node --test` to verify RED**
- [ ] **Step 3: Implement `Act4Ecosystem.tsx`, `Act5ProofFinale.tsx`, update `Video.tsx` (overlapping spatial `ScenePortal` transitions locked to `timeline.json`) and `Root.tsx`, and clean up superseded scene files**
- [ ] **Step 4: Run `node --test` and `npx tsc --noEmit` to verify GREEN**

---

### Task 6: 90-Second · 5-Act Procedural Soundtrack & Foley Synthesizer (`audio/make_music.py`)

**Files:**
- Create: `marketing/citra-promo/audio/test_make_music.py`
- Modify: `marketing/citra-promo/audio/make_music.py`

- [ ] **Step 1: Write failing Python test `audio/test_make_music.py` asserting `public/audio/soundtrack.wav` has duration `90.0s` (`4,320,000` frames), `48,000 Hz`, `2` channels, `3` bytes/sample, peak `<= 0.92`, non-zero RMS in each 15s window, and final 100ms RMS `< 0.01`**
- [ ] **Step 2: Run `.venv/bin/python -m pytest marketing/citra-promo/audio/test_make_music.py -q` to verify RED (current WAV is 60.0s)**
- [ ] **Step 3: Upgrade `audio/make_music.py` to a 90s 5-Act score + synchronized SFX (`laser`, `typeA`, `typeB`, `typeC`, `glitch`, `impacts`, `whooshes`, `chimes`, `apiPings`, `bentoTicks`, `ablationRiser`, `endHit`) and generate `public/audio/soundtrack.wav`**
- [ ] **Step 4: Run `.venv/bin/python -m pytest marketing/citra-promo/audio/test_make_music.py -q` to verify GREEN**

---

### Task 7: 13-Scene Visual QA Stills & Micro-Layout Polish

**Files:**
- Modify: `marketing/citra-promo/scripts-stills.mjs`

- [ ] **Step 1: Update `scripts-stills.mjs` to 5-digit zero padding (`f00000.jpg`) and render 18 representative frames covering all 13 scenes and transition midpoints**
- [ ] **Step 2: Visually inspect every rendered still image via `read_file` to check composition, contrast, Vietnamese typography, Loupe crop alignment, and zero text overlap**
- [ ] **Step 3: Apply any visual polish adjustments discovered during inspection, re-render affected stills, and confirm `npx tsc --noEmit` + `node --test` remain GREEN**

---

### Task 8: Full 120fps Masters Render, Hybrid 120fps/60fps Web Ladder (`citra-film-v2`), `CitraFilm.tsx` Update & Final Review

**Files:**
- Create: `web/src/components/landing/CitraFilm.test.tsx`
- Modify: `web/src/components/landing/CitraFilm.tsx`
- Modify: `marketing/citra-promo/scripts/encode_web.sh`
- Modify: `marketing/citra-promo/README.md`
- Remove: `web/public/media/citra-film-v1/` (after `citra-film-v2/` is verified)

- [ ] **Step 1: Write failing Vitest tests in `web/src/components/landing/CitraFilm.test.tsx` asserting `/media/citra-film-v2` asset paths, `90`s / `1:30` bilingual labels, and `MediaCapabilities.decodingInfo` probing `framerate: 120` before falling back to `framerate: 60`**
- [ ] **Step 2: Run `npm --prefix web test -- src/components/landing/CitraFilm.test.tsx` to verify RED**
- [ ] **Step 3: Update `CitraFilm.tsx`, `scripts/encode_web.sh` (hybrid 120fps + 60fps ladder, `66.0s` 4s teaser, `13.2s` poster), and `marketing/citra-promo/README.md`**
- [ ] **Step 4: Run `npm --prefix web test -- src/components/landing/CitraFilm.test.tsx` to verify GREEN**
- [ ] **Step 5: Render 120fps master `out/web_master_1440p120.mp4` (`10,800` frames @ `120 fps`), generate `out/CITRA_Promo_90s_120fps.mp4` (`1440p120`) and `out/CITRA_Promo_1080p120.mp4` (`1080p120`), run `./scripts/encode_web.sh` into `web/public/media/citra-film-v2/`, and remove `web/public/media/citra-film-v1/`**
- [ ] **Step 6: Verify all rendered MP4s with `ffprobe` (`120/1` fps, `90.0s`, `10,800` frames, `48000 Hz` stereo audio), run full `npm --prefix web test` + `npm --prefix web run build` + `node --test` + `pytest audio/test_make_music.py`, and dispatch fresh code-reviewer subagent**
