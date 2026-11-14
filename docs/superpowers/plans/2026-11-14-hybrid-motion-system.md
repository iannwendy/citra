# Hybrid Motion System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade CITRA (SourceLogic) across both the Solva Editorial Landing/Pricing pages and the Authenticated Core Workspace to a peak hybrid motion architecture (`transitions.dev` CSS tokens for 85% 120fps micro-interactions + `motion` `LazyMotion` `domMax` for 15% spatial continuity and exit orchestration), committing cleanly after every single task.

**Architecture:** CSS custom-property tokens (`transitions-dev.css`) drive high-frequency tactile primitives (buttons, per-digit 3D number drums, double-bounce switches, mask-faded reasoning streams, asymmetric Radix overlay keyframes, and a real DOM-measuring `ui-generation` SVG wireframe scanline engine). `motion/react` (`<CitraMotionProvider>` with `<MotionConfig reducedMotion="user">` + `<LazyMotion features={domMax} strict>`) handles shared-layout `layoutId` indicators, directional stage slides, and `AnimatePresence` exit retention without main-thread bloat.

**Tech Stack:** React 18.3, TypeScript 5.4, Tailwind CSS 3.4, `motion` (`motion/react`), Radix UI Dialog & DropdownMenu, React Router v6.30 (`viewTransition`), Vitest + Testing Library, Playwright E2E.

**Spec:** `docs/superpowers/specs/2026-11-14-hybrid-motion-system-design.md`

## Global Constraints

- Only `motion` may be added to `web/package.json`; all `motion` components must use `m.*` under `<LazyMotion features={domMax} strict>` with `<MotionConfig reducedMotion="user">`.
- `NumberPopIn` outgoing `.t-digit-old` spans MUST render via `data-char` + CSS `::before { content: attr(data-char) }` with zero text child nodes so `element.textContent` always equals the exact formatted string (`PricingAndBilling.test.tsx` and `LandingVietnameseTypography.test.tsx` invariants).
- Every existing test file (41 files / 283 tests), `deadCode.test.ts` barrel guards, `tsc -b && vite build`, `npm run lint`, and all 7 scenarios in `web/tests/e2e/transitions-dev.spec.ts` must remain green.
- Zero horizontal overflow (`document.documentElement.scrollWidth <= 430`) on iPhone 14 Pro Max (`430×932`) across all public and authenticated routes.
- Atomic Conventional Commit immediately after each task (`Task 1` through `Task 8`), never squashed into one giant commit.

## Review Focus

- **Mobile `430px` viewport bounds:** `.t-gen` SVG wireframe overlays and `DirectionalStageSlide` horizontal transforms must clip cleanly within their container so `documentElement.scrollWidth` never exceeds `430px`.
- **`textContent` & Unicode NFC purity:** Per-digit `NumberPopIn` slots inside `.font-solva-serif` or `data-testid="pro-price-display"` must never leak outgoing characters into `element.textContent`.
- **Synchronous `ThemeToggle` class update:** Clicking `ThemeToggle` must apply `.dark` / `.light` synchronously on `document.documentElement` in the same tick while using a short-lived `data-theme-switching` attribute (`200ms`) for smooth surface cross-fades.
- **Radix `Presence` close lifecycle & centering:** `DialogContent` must include `translate3d(-50%, -50%, 0)` in both open and close keyframes so modals never jump off-center, and `[data-state="closed"]` must disable animations under `prefers-reduced-motion: reduce`.
- **Timer & RAF lifecycle hygiene:** Every `requestAnimationFrame`, `setInterval`, `setTimeout`, and `IntersectionObserver` in `uiGenerationEngine`, `ReasoningStream`, Debugger Auto-Tour, and Pipeline Auto-Cycle must clean up on unmount without React warnings or memory leaks.

---

### Task 1: Hybrid Motion Foundation (`motion` + `CitraMotionProvider` + CSS Transition Hygiene)

**Files:**
- Modify: `web/package.json`
- Create: `web/src/components/ui/motion-primitives.tsx`
- Modify: `web/src/main.tsx:1-68`
- Modify: `web/src/index.css:200-350`
- Modify: `web/src/hooks/useScrollAnimation.ts:50-81`
- Test: `web/src/components/ui/motion-primitives.test.tsx`

**Interfaces:**
- Produces:
  - `CitraMotionProvider({ children }: { children: ReactNode }): JSX.Element`
  - `m`, `AnimatePresence` re-exported from `motion/react`
  - `SPRING_PILL`, `SPRING_LAYOUT`, `TRANSITION_ENTER`, `TRANSITION_EXIT` transition presets in `web/src/components/ui/motion-primitives.tsx`

- [x] **Step 1: Install `motion` in `web/` and write the failing test `web/src/components/ui/motion-primitives.test.tsx`**
  - Assert `<CitraMotionProvider>` renders `m.div` children and `AnimatePresence` unmounts exiting keys cleanly.
  - Assert `useStaggeredAnimation` defaults to `45ms` stagger capped at `<= 270ms`.
  - Assert `web/src/index.css` custom component classes (`.card-interactive`, `.card-glow`, `.badge-verified`, `.input-focus`) use explicit transition properties instead of `transition-all`.
- [x] **Step 2: Run test to verify it fails**
  - Run: `cd web && npx vitest run src/components/ui/motion-primitives.test.tsx`
  - Expected: FAIL (`Cannot find module './motion-primitives'`)
- [x] **Step 3: Implement `motion-primitives.tsx`, wire `<CitraMotionProvider>` in `main.tsx`, replace `transition-all` in `index.css`, and tune `useScrollAnimation.ts`**
- [x] **Step 4: Run Vitest + TypeScript check to verify green**
  - Run: `cd web && npx vitest run src/components/ui/motion-primitives.test.tsx && npm test && npx tsc -b`
  - Expected: PASS (all suites green, 0 TS errors)
- [x] **Step 5: Commit Task 1**
  - `git commit -m "feat(motion): add LazyMotion provider, editorial spring presets, and CSS transition hygiene"`

---

### Task 2: Core `transitions.dev` Primitives (`NumberPopIn` #02, `TactileToggle` #27, `ReasoningStream` #29, `DirectionalStageSlide` #08)

**Files:**
- Modify: `web/src/styles/transitions-dev.css`
- Modify: `web/src/components/ui/transitions.tsx`
- Test: `web/src/components/ui/transitions.test.tsx`

**Interfaces:**
- Consumes: `m`, `AnimatePresence` from `web/src/components/ui/motion-primitives.tsx`
- Produces:
  - Upgraded `NumberPopIn` (same props `NumberPopInProps`, per-character diffing with `data-same`, `.t-digit-slot`, `.t-digit-old[data-char]`, `data-stagger="1"|"2"`)
  - `TactileToggle({ checked, onCheckedChange, label, id, disabled, className, 'data-testid' }: TactileToggleProps)`
  - `ReasoningStream({ lines, className, heightPx, holdMs, stepMs, loop, 'data-testid' }: ReasoningStreamProps)`
  - `DirectionalStageSlide({ stageKey, stageIndex, children, className }: DirectionalStageSlideProps)`

- [x] **Step 1: Write the failing test `web/src/components/ui/transitions.test.tsx`**
  - Assert `NumberPopIn` changing from `$16` to `$20` marks `$` with `data-same`, wraps `1->2` and `6->0` in `.t-digit-slot` with `.t-digit-old[data-char]`, and preserves `container.textContent === '$20'` immediately during animation.
  - Assert `NumberPopIn` changing from `1,299` to `1,305` marks `1,` with `data-same` and applies `data-stagger="1"` and `data-stagger="2"` on the trailing two changed slots.
  - Assert `TactileToggle` omits `.is-init` on initial render, adds `.is-init` on first click, toggles `data-on` and `aria-checked`, and invokes `onCheckedChange`.
  - Assert `ReasoningStream` renders `.t-reason` + `.t-reason-viewport` + `.t-reason-scroll` with provided telemetry lines and disables stepping under `prefers-reduced-motion: reduce`.
  - Assert `DirectionalStageSlide` renders stage content cleanly with `data-direction="forward"|"backward"` when `stageIndex` increments/decrements.
- [x] **Step 2: Run test to verify it fails**
  - Run: `cd web && npx vitest run src/components/ui/transitions.test.tsx`
  - Expected: FAIL (`TactileToggle` / `ReasoningStream` / `DirectionalStageSlide` undefined and `NumberPopIn` missing `data-same` / `.t-digit-slot`)
- [x] **Step 3: Implement CSS rules in `transitions-dev.css` and React components in `transitions.tsx`**
- [x] **Step 4: Run tests and TypeScript check to verify green**
  - Run: `cd web && npx vitest run src/components/ui/transitions.test.tsx && npm test && npx tsc -b`
  - Expected: PASS
- [x] **Step 5: Commit Task 2**
  - `git commit -m "feat(transitions): upgrade per-digit NumberPopIn and add TactileToggle, ReasoningStream, and DirectionalStageSlide"`

---

### Task 3: Real `transitions-ui-generation` Engine Port (`UIGenerationReveal` 2.0)

**Files:**
- Create: `web/src/lib/uiGenerationEngine.ts`
- Modify: `web/src/styles/transitions-dev.css`
- Modify: `web/src/components/ui/transitions.tsx:1215-1310`
- Test: `web/src/lib/uiGenerationEngine.test.tsx`

**Interfaces:**
- Produces:
  - `runUIGeneration(targetEl: HTMLElement, overlayHostEl: HTMLElement, options?: UIGenerationOptions): UIGenerationHandle`
  - Upgraded `UIGenerationReveal` in `web/src/components/ui/transitions.tsx` preserving `.t-gen-wrap` and `.t-gen[data-phase="idle"|"building"|"done"]`

- [x] **Step 1: Write the failing test `web/src/lib/uiGenerationEngine.test.tsx`**
  - Assert `measureDomStructure` extracts boxes, interactive buttons, and SVG icon paths from a structured card element.
  - Assert `UIGenerationReveal` transitions `.t-gen` to `data-phase="done"` immediately under `prefers-reduced-motion: reduce`.
  - Assert `UIGenerationReveal` runs the RAF wireframe/scanline lifecycle, cleans up SVG child nodes upon completion, restores target element inline `opacity`/`clipPath`/`filter`, and sets `data-phase="done"`.
  - Assert unmounting mid-run cancels RAF cleanly without throwing or leaking nodes.
- [x] **Step 2: Run test to verify it fails**
  - Run: `cd web && npx vitest run src/lib/uiGenerationEngine.test.tsx`
  - Expected: FAIL (`Cannot find module './uiGenerationEngine'`)
- [x] **Step 3: Implement `uiGenerationEngine.ts`, scoped `.t-gen` CSS tokens (Light & Dark Solva palette, `overflow: hidden` inside `.t-gen-wrap`), and wire `UIGenerationReveal`**
- [x] **Step 4: Run tests and TypeScript check to verify green**
  - Run: `cd web && npx vitest run src/lib/uiGenerationEngine.test.tsx && npm test && npx tsc -b`
  - Expected: PASS
- [x] **Step 5: Commit Task 3**
  - `git commit -m "feat(ui-generation): port real DOM-measuring wireframe and scanline engine for UIGenerationReveal"`

---

### Task 4: Asymmetric Overlay & Header Menu Exit Animations (`Dialog`, `DropdownMenu`, `SolvaHeader`)

**Files:**
- Modify: `web/tailwind.config.ts:120-175`
- Modify: `web/src/styles/transitions-dev.css`
- Modify: `web/src/components/ui/dialog.tsx:11-53`
- Modify: `web/src/components/ui/dropdown-menu.tsx:35-68`
- Modify: `web/src/pages/LandingPage.tsx:447-760`
- Modify: `web/src/pages/PricingPage.tsx:1800-1960`
- Test: `web/src/components/ui/dialog-dropdown-motion.test.tsx`

**Interfaces:**
- Produces:
  - Asymmetric Radix open/close animations (`data-[state=open]` & `data-[state=closed]`) with preserved `-50% -50%` centering on `DialogContent`.
  - `usePresencePhase(isOpen: boolean, closeDurationMs: number)` hook (or `transitions.tsx` export) used by `SolvaHeader` and `PricingPage` nav dropdown + mobile menu so `.is-open` transitions through `.is-closing` before unmounting.

- [x] **Step 1: Write the failing test `web/src/components/ui/dialog-dropdown-motion.test.tsx`**
  - Assert `DialogContent` includes both `data-[state=open]:animate-dialog-in` and `data-[state=closed]:animate-dialog-out` (preserving `-50%` centering in keyframes).
  - Assert `DropdownMenuContent` includes both `data-[state=open]:animate-dropdown-in` and `data-[state=closed]:animate-dropdown-out`.
  - Assert `LandingPage` `SolvaHeader` Platform dropdown mounts with `.t-dropdown.is-open` on click, transitions to `.t-dropdown.is-closing` on second click/Escape, and unmounts after `150ms`.
- [x] **Step 2: Run test to verify it fails**
  - Run: `cd web && npx vitest run src/components/ui/dialog-dropdown-motion.test.tsx`
  - Expected: FAIL (`animate-dialog-out` missing and `SolvaHeader` unmounts synchronously in `0ms` without `.is-closing`)
- [x] **Step 3: Implement keyframes in `tailwind.config.ts` / `transitions-dev.css`, update `dialog.tsx` and `dropdown-menu.tsx`, and wire `.is-closing` presence retention in `LandingPage.tsx` and `PricingPage.tsx`**
- [x] **Step 4: Run tests and TypeScript check to verify green**
  - Run: `cd web && npx vitest run src/components/ui/dialog-dropdown-motion.test.tsx && npm test && npx tsc -b`
  - Expected: PASS
- [x] **Step 5: Commit Task 4**
  - `git commit -m "fix(overlays): add asymmetric close animations to Dialog, DropdownMenu, and SolvaHeader menus"`

---

### Task 5: Landing Page Editorial Calm & Scroll Engine Refinement (`SolvaPrimitives.tsx` & `SolvaMockupWidgets.tsx`)

**Files:**
- Modify: `web/src/components/landing/SolvaPrimitives.tsx:195-405,905-954`
- Modify: `web/src/components/landing/SolvaMockupWidgets.tsx:30-165,800-2152`
- Test: `web/src/components/landing/SolvaMotionCalm.test.tsx`

**Interfaces:**
- Consumes: `SubtleNumber` from `web/src/components/ui/transitions.tsx`
- Produces:
  - One-shot latched `SolvaScrollReveal` and `SolvaTwoToneHeading` (never re-blurring or hiding once settled).
  - One-shot `SolvaAnimatedMetric` and `useFloralCardAnimation` (zero periodic `replaySeed` resets to `0`), with static scholarly identifiers (`10.1109/CVPR.2016.90`, `R01`, `R05`, `APA 7th`, `#018`) rendered as stable text and live micro-telemetry rendered via `SubtleNumber`.

- [x] **Step 1: Write the failing test `web/src/components/landing/SolvaMotionCalm.test.tsx`**
  - Assert `SolvaAnimatedMetric` and `StickyCardWidget(0)` DO NOT reset their numbers or DOI `10.1109/CVPR.2016.90` back to `0` when advancing fake timers across `5000ms–15000ms`.
  - Assert `SolvaScrollReveal` and `SolvaTwoToneHeading` remain latched (`opacity: 1`, `filter: none`) after settling even if bounding rect moves back below viewport threshold on scroll-up.
- [x] **Step 2: Run test to verify it fails**
  - Run: `cd web && npx vitest run src/components/landing/SolvaMotionCalm.test.tsx`
  - Expected: FAIL (`replaySeed` increments after `4800ms–5800ms` resetting numbers toward `0`, and scroll-up re-applies `phase = 'below'`)
- [x] **Step 3: Refactor `SolvaPrimitives.tsx` and `SolvaMockupWidgets.tsx` to latch editorial text reveals and replace periodic `0`-resets with honest static identifiers + subtle ambient telemetry**
- [x] **Step 4: Run tests and TypeScript check to verify green**
  - Run: `cd web && npx vitest run src/components/landing/SolvaMotionCalm.test.tsx && npm test && npx tsc -b`
  - Expected: PASS
- [x] **Step 5: Commit Task 5**
  - `git commit -m "refactor(landing): latch editorial scroll reveals and eliminate periodic metric zero-resets"`

---

### Task 6: Landing Page & Pricing Interactive Choreography (`#interactive-demo`, `#how-it-works`, `#pricing`, `#faq`)

**Files:**
- Modify: `web/src/pages/LandingPage.tsx:2380-3045,3210-3325,3615-3820,4285-4380`
- Modify: `web/src/components/landing/SolvaMockupWidgets.tsx:1450-1738`
- Modify: `web/src/pages/PricingPage.tsx:590-880,1550-1750`
- Test: `web/src/pages/LandingInteractiveMotion.test.tsx`

**Interfaces:**
- Consumes: `NumberPopIn`, `TactileToggle`, `SoftTextSwap`, `DirectionalStageSlide`, `SymmetricChevron`, `useSlidingPill` from `web/src/components/ui/transitions.tsx`

- [x] **Step 1: Write the failing test `web/src/pages/LandingInteractiveMotion.test.tsx`**
  - Assert `#interactive-demo` renders `data-testid="debugger-autotour-progress"` on the active citation item while auto-tour is active, pauses on mouseEnter (`data-paused="true"`), and removes auto-tour on manual citation click.
  - Assert `#how-it-works` renders a `.t-tabs-pill` sliding indicator across the 4 pipeline stage tabs (`role="tab"`) and wraps `PipelineStageVisual` in `DirectionalStageSlide`.
  - Assert `LandingPage` `#pricing` uses `TactileToggle` (`.t-toggle[role="switch"]`) and both `LandingPage` and `PricingPage` render Pro/Ultra prices with `.t-digit-group` while keeping `pro-price-display` / `ultra-price-display` `textContent` strictly `'$16'` / `'$20'` and `'$160'` / `'$200'`.
  - Assert `#faq` accordion items apply asymmetric open/close durations (`300ms` open / `190ms` close).
- [x] **Step 2: Run test to verify it fails**
  - Run: `cd web && npx vitest run src/pages/LandingInteractiveMotion.test.tsx`
  - Expected: FAIL (`debugger-autotour-progress`, `#how-it-works` `.t-tabs-pill`, and `#pricing` `.t-toggle` missing)
- [x] **Step 3: Implement Interactive Debugger 2.0, 4-Stage Pipeline pill + directional slide, Pricing `TactileToggle` + per-digit `NumberPopIn`, and asymmetric FAQ on `LandingPage.tsx` & `PricingPage.tsx`**
- [x] **Step 4: Run tests (including `PricingAndBilling.test.tsx` & `LandingVietnameseTypography.test.tsx`) and TypeScript check**
  - Run: `cd web && npx vitest run src/pages/LandingInteractiveMotion.test.tsx src/pages/PricingAndBilling.test.tsx src/pages/LandingVietnameseTypography.test.tsx && npm test && npx tsc -b`
  - Expected: PASS
- [x] **Step 5: Commit Task 6**
  - `git commit -m "feat(landing,pricing): add debugger auto-tour progress, directional pipeline pill, tactile pricing drum, and asymmetric FAQ"`

---

### Task 7: Core Workspace Continuity (`ProcessingPage` Reasoning Stream, Sidebar `layoutId`, Theme & Route Transitions, Sandbox Presence)

**Files:**
- Modify: `web/src/pages/ProcessingPage.tsx:38-45,785-865`
- Modify: `web/src/components/AppLayout.tsx:1-40,340-405`
- Modify: `web/src/contexts/ThemeContext.tsx:60-115,190-245`
- Modify: `web/src/styles/transitions-dev.css`
- Modify: `web/src/components/LiveCitationSandbox.tsx:1-20,760-850`
- Test: `web/src/pages/WorkspaceMotionContinuity.test.tsx`

**Interfaces:**
- Consumes: `ReasoningStream` from `web/src/components/ui/transitions.tsx`; `m`, `AnimatePresence`, `SPRING_PILL` from `web/src/components/ui/motion-primitives.tsx`

- [x] **Step 1: Write the failing test `web/src/pages/WorkspaceMotionContinuity.test.tsx`**
  - Assert `ProcessingPage` renders `data-testid="processing-reasoning-stream"` (`.t-reason`) displaying live step & scholarly source telemetry lines synthesized from `EssayStatus` while `status === 'processing'`.
  - Assert `AppLayout` renders the active sidebar indicator `data-testid="sidebar-active-indicator"` and moves it seamlessly across route navigation (`/dashboard` -> `/history`) with `viewTransition` enabled on nav links.
  - Assert `ThemeToggle` updates `document.documentElement.classList.contains('dark')` synchronously on the exact click tick while setting transient `data-theme-switching="true"` (cleared after `220ms`, omitted under `prefers-reduced-motion: reduce`).
- [x] **Step 2: Run test to verify it fails**
  - Run: `cd web && npx vitest run src/pages/WorkspaceMotionContinuity.test.tsx`
  - Expected: FAIL (`processing-reasoning-stream` and `sidebar-active-indicator` missing)
- [x] **Step 3: Implement `ReasoningStream` telemetry feed in `ProcessingPage.tsx`, `m.span` `layoutId` active bar + `viewTransition` links in `AppLayout.tsx`, synchronous `data-theme-switching` cross-fade in `ThemeContext.tsx` + `transitions-dev.css`, and `AnimatePresence` result reveal in `LiveCitationSandbox.tsx`**
- [x] **Step 4: Run tests (including `ProcessingPage.test.tsx`) and TypeScript check**
  - Run: `cd web && npx vitest run src/pages/WorkspaceMotionContinuity.test.tsx src/pages/ProcessingPage.test.tsx && npm test && npx tsc -b`
  - Expected: PASS
- [x] **Step 5: Commit Task 7**
  - `git commit -m "feat(workspace): integrate live ReasoningStream on ProcessingPage, sidebar layoutId indicator, and smooth theme/route transitions"`

---

### Task 8: Playwright E2E Expansion, Full Build/Lint Gate & Independent `Gemini 4 Carbon (High)` Code + UX Review

**Files:**
- Modify: `web/tests/e2e/transitions-dev.spec.ts`

- [x] **Step 1: Expand `web/tests/e2e/transitions-dev.spec.ts` with end-to-end assertions covering all new hybrid motion upgrades**
  - Verify `SolvaHeader` Platform dropdown `.is-open` -> `.is-closing` smooth exit transition.
  - Verify `#interactive-demo` Auto-Tour progress bar + hover pause + per-digit `NumberPopIn` confidence update.
  - Verify `#how-it-works` 4-stage `.t-tabs-pill` + `DirectionalStageSlide`.
  - Verify Landing `#pricing` `TactileToggle` (`#27`) + per-digit `NumberPopIn` exact price text (`$16` ↔ `$20`).
  - Verify `ProcessingPage` `#29 ReasoningStream` (`.t-reason` + `mask-image`) alongside `MatrixDotLoader` light/dark polarity.
  - Verify `AppLayout` `sidebar-active-indicator` route transition & zero `430×932` horizontal overflow across every public and authenticated page.
- [x] **Step 2: Start local Vite dev server and run full Playwright E2E + Vitest + ESLint + Production Build**
  - Run: `cd web && npm test && npm run lint && npm run build` + Playwright `npx playwright test tests/e2e/transitions-dev.spec.ts` against live Vite server on `:5173`.
  - Expected: 100% PASS (0 Vitest failures, 0 ESLint warnings/errors, 0 TS/Vite build errors, all Playwright E2E tests green).
- [x] **Step 3: Commit Task 8**
  - `git commit -m "test(e2e): expand transitions-dev Playwright suite for hybrid motion choreography and workspace continuity"`
- [x] **Step 4: Dispatch fresh-context Senior Code & UX/UI Reviewer subagent (`Model: "inherit"` = Gemini 4 Carbon High Effort) over `BASE..HEAD`**
  - Address any Critical or Important findings via strict TDD (`RED -> GREEN`), re-run Vitest + Lint + Build + Playwright E2E, and commit any review fixes cleanly.
