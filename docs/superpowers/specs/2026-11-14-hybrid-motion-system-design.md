# CITRA (SourceLogic) Hybrid Motion Architecture — Design Specification

**Date:** 2026-11-14  
**Scope:** Full-system upgrade across Landing Page, Pricing Page, Shared UI Primitives, and Authenticated Core Workspace (Option 2: Hybrid `transitions.dev` CSS Tokens + `motion` LazyMotion)

---

## 1. Design Philosophy: *"Editorial Calm × Verifiable Physics"*

CITRA combines a **Solva Warm Editorial** public presence (`#FBFAF6` warm alabaster, `#1C1A15` espresso ink, `Sentient` light serif + `Onest` sans + `JetBrains Mono`) with an explainable **Neuro-Symbolic Scholarly IDE** workspace. Motion across the platform obeys two strict laws:

1. **Editorial Layer (Landing & Pricing Copy, Headings, Static Scholarly Proofs):**
   - **One-Shot Entrance Latch:** Headings (`SolvaTwoToneHeading`) and editorial blocks (`SolvaScrollReveal`) animate into focus **once** upon entering the viewport, then latch permanently (`opacity: 1`, `filter: none`, `will-change: auto`). Scrolling back up never blurs or hides text the reader has already seen. Scroll-reversibility is reserved strictly for spatial depth (`SolvaPainterlyFrame` parallax and `SolvaStickyStackCard` 3D card deck).
   - **Data Honesty (Zero Slot-Machine Resets):** Static scholarly identifiers—DOIs (`10.1109/CVPR.2016.90`), symbolic rule codes (`R01`–`R24`), citation style labels (`APA 7th`, `IEEE [1]–[N]`), fixed publication years, and benchmark totals (`120,000`, `98.58%`)—never loop back to `0` every 5 seconds. Entrance counters run once; continuous ambient motion is restricted to genuine live micro-telemetry (e.g., API latency jitter via `#36 SubtleNumber` and active row scan highlights).

2. **Forensic Instrument Layer (Interactive Citation Debugger, Live Pipeline, Sandbox, App Shell, Modals/Menus):**
   - **Asymmetric Open/Close Timing (`transitions-polish`):** Entrances invite attention (`180ms–300ms` with `--ease-smooth-out` / `--ease-spring-gentle`); exits get out of the way ~25–35% faster (`130ms–190ms` with `--ease-exit`).
   - **Spatial Continuity (`motion/react` `LazyMotion` + `domMax`):** Shared-layout indicators (`layoutId`), directional stage slides (`#08`), and `AnimatePresence` exit retention ensure UI state transitions show *where* elements came from and *how* CITRA's Neuro-Symbolic engine reasons.

---

## 2. Subsystem Specifications

### 2.1 Hybrid Motion Foundation (`motion-primitives.tsx` + CSS Hygiene)
- Install `motion` (`motion/react`) and provide `<CitraMotionProvider>` wrapping `<MotionConfig reducedMotion="user">` + `<LazyMotion features={domMax} strict>`.
- Export `m`, `AnimatePresence`, and calibrated Solva/IDE spring constants (`SPRING_PILL`, `SPRING_LAYOUT`, `TRANSITION_ENTER`, `TRANSITION_EXIT`).
- Replace broad `transition-all` declarations in `web/src/index.css` with explicit compositor/paint properties (`transform`, `opacity`, `background-color`, `border-color`, `color`, `box-shadow`).
- Tighten `useStaggeredAnimation` default step from `100ms` to `45ms` (total sequence capped `<= 270ms`).

### 2.2 Core `transitions.dev` Primitives (`transitions.tsx` + `transitions-dev.css`)
- **`NumberPopIn` (#02 — Per-Digit 3D Drum):**
  - Diff previous vs. next formatted string (`prefix + formattedNumber + suffix`) character-by-character.
  - Mark shared leading characters (`$`, `+`, unchanged high-order digits) with `data-same` so they remain completely still.
  - Wrap changed characters in `.t-digit-slot` with `.t-digit` (incoming) and `.t-digit-old` (outgoing), applying `data-stagger="1"|"2"` (`40ms`) on the trailing two changed slots.
  - **DOM Purity Invariant:** `.t-digit-old` renders its outgoing character strictly via `data-char` + CSS `.t-digit-old::before { content: attr(data-char); }` and `aria-hidden="true"`, guaranteeing `element.textContent` equals the exact current value at every frame.
- **`TactileToggle` (#27):**
  - Accessible `role="switch"` button with `.t-toggle` and `.t-toggle-thumb`, `data-on="true"|"false"`, and `.is-init` applied only after first user interaction so initial mount never plays the off-bounce keyframe.
- **`ReasoningStream` (#29):**
  - Fixed-height viewport (`.t-reason` / `.t-reason-viewport`) using CSS `mask-image` top/bottom fades (`--reason-fade`) so any light or dark surface works without painted gradient bands.
  - Steps vertically by `--reason-lines` every `--reason-hold` (`840ms`) over `--reason-step` (`500ms`) with `--reason-ease`, supporting both seamless looped transcripts and live-appended SSE telemetry lines. Freezes cleanly under `prefers-reduced-motion: reduce`.
- **`DirectionalStageSlide` (#08 Enhanced):**
  - Animates horizontal stage transitions in causal index order (`nextIndex > prevIndex` enters from `+14px`, `nextIndex < prevIndex` enters from `-14px`) with `overflow-x: clip` so mobile viewports (`430px`) never overflow horizontally.

### 2.3 Real `transitions-ui-generation` Engine (`uiGenerationEngine.ts`)
- Port the authentic `ui-generation` DOM measurement & SVG wireframe scanline engine into typed TypeScript:
  - Measure real child boxes, interactive controls, text line rects (`Range.getClientRects()`), and small SVG icon paths (`getScreenCTM()`).
  - Render a **container-scoped** `.t-gen` SVG overlay inside `.t-gen-wrap` (`overflow: hidden`, `pointer-events: none`) with dot-matrix ripple/rain, construction guides, corner handles, targeting reticle, coordinate readouts, and synchronized scanline `clipPath` reveal.
  - Upon completion (or immediately when `prefers-reduced-motion: reduce` or zero-rect test environment is detected), remove temporary SVG child nodes, restore target inline styles, and set `data-phase="done"` on `.t-gen`.

### 2.4 Overlays & Navigation Menus (`dialog.tsx`, `dropdown-menu.tsx`, `SolvaHeader`)
- Bind dedicated asymmetric `@keyframes` to both `data-[state=open]` and `data-[state=closed]` on Radix `DialogOverlay`, `DialogContent`, `DropdownMenuContent`, and `DropdownMenuSubContent` so Radix `Presence` waits for exit completion (`140ms–150ms`) instead of unmounting in `0ms`.
- Preserve `translate3d(-50%, -50%, 0)` across all keyframes of `DialogContent` so centered modals never jump to the bottom-right quadrant during open/close.
- Upgrade `SolvaHeader` (and `PricingPage` header) Platform dropdown and mobile drawer to retain DOM mount during `.is-closing` (`150ms`) before unmounting.

### 2.5 Landing Page & Pricing Interactive Choreography
- **Interactive Citation Debugger (`#interactive-demo`):**
  - Render a `1.5px` Auto-Tour progress bar along the active left-column citation card (`4200ms` linear fill), pausing on pointer hover/focus and terminating auto-tour permanently on manual click.
  - Eliminate double-animation flashes on the right-hand Inspector pane; use per-digit `NumberPopIn` for confidence/CIS scores and `SoftTextSwap` for field-level metadata diffs.
- **4-Stage Pipeline (`#how-it-works`):**
  - Upgrade stage tabs with a shared sliding pill (`useSlidingPill` / `.t-tabs-pill`) + subtle auto-advance progress bar (`6000ms` while in viewport, paused on hover/interaction) + `DirectionalStageSlide` on `PipelineStageVisual`.
- **Pricing (`LandingPage` `#pricing` & `PricingPage` `/pricing`):**
  - Use `TactileToggle` (`#27`) on Landing Page billing switch (preserving `PricingPage`'s `#16` segmented pill and `data-testid` contracts), and upgrade Pro/Ultra price figures (`$16` ↔ `$20`, `$160` ↔ `$200`) to per-digit `NumberPopIn` (`#02`) + `SoftTextSwap` (`#34`) cadence labels.
- **FAQ (`LandingPage` & `PricingPage`):**
  - Asymmetric grid-row expansion (`300ms` open / `190ms` close) paired with `#21 SymmetricChevron` / smooth icon rotation.

### 2.6 Authenticated Workspace Continuity (`ProcessingPage`, `AppLayout`, `ThemeContext`, `LiveCitationSandbox`)
- **`ProcessingPage.tsx`:** Embed `<ReasoningStream />` (`data-testid="processing-reasoning-stream"`) inside the `integrity_pipeline.py` execution card, synthesizing live, human-readable Neuro-Symbolic reasoning lines from real SSE `EssayStatus` frames (`step`, `message`, `citations_found`, `references_found`, `linked`, `sources_queried`, `document_diagnostics`).
- **`AppLayout.tsx`:** Replace the jumping active sidebar bar with a shared-layout `m.span` (`layoutId="citra-sidebar-active-bar"`) and enable `viewTransition` on sidebar route `<Link>` items.
- **`ThemeContext.tsx`:** Keep `.light`/`.dark` class toggling 100% synchronous on `document.documentElement` while applying a transient `data-theme-switching="true"` attribute (`200ms`, skipped under `prefers-reduced-motion`) for smooth surface cross-fades without breaking synchronous theme checks or E2E luminance polls.
- **`LiveCitationSandbox.tsx`:** Wrap instant verification results in `AnimatePresence` + `m.div` for smooth entrance/exit transitions.

---

## 3. Non-Negotiable Contracts & Invariants
- Zero regressions across all 41 existing Vitest suites (283+ tests), `tsc -b && vite build`, `npm run lint`, and `deadCode.test.ts`.
- Full backward compatibility with all selectors and assertions in `web/tests/e2e/transitions-dev.spec.ts` (`.t-gen-wrap`, `.t-gen[data-phase="done"]`, `.t-tabs-pill`, `.t-dropdown.is-open`, `.t-tilt`, `.t-icon-swap`, `.t-digit-group`, `.t-donut`, `.t-matrix` light/dark luminance polarity).
- Strict zero horizontal overflow (`documentElement.scrollWidth <= 430`) across all public and authenticated routes on iPhone 14 Pro Max (`430×932`).
- Complete `prefers-reduced-motion: reduce` compliance across both CSS (`transitions-dev.css` / `index.css`) and JS (`MotionConfig reducedMotion="user"`, `uiGenerationEngine`, `ReasoningStream`).
