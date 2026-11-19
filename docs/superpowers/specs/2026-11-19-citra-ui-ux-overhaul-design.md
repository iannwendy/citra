# CITRA (`citra.io.vn`) World-Class UI/UX & Non-Tech Experience Overhaul — Design Specification

**Date:** 2026-11-19  
**Product:** CITRA (`essay-integrity-checker` v3.83.0)  
**Target Users:** Non-technical academic users (undergraduate/graduate students, lecturers across Humanities/Economics/Law/STEM, academic editors) alongside technical evaluators and university administrators.

---

## 1. Intent & Why

CITRA possesses a strong "Warm Academic Editorial" visual identity (`#FAF9F6` paper palette, Sentient Serif display typography, and impressionist botanical artwork) backed by a rigorous Neuro-Symbolic citation verification engine. However, live full-site auditing revealed a sharp disconnect between **engineering pride** and **non-technical user comprehension**:

1. **First-5-Second Jargon Barrier:** Navigation (`Inspector`, `Pipeline`, `120K Benchmark`, `Taxonomy`), Hero metrics (`OOD Guardrail`, `Platt ECE`, `0% Leakage`), raw code snippets (`<biblStruct>` XML, `symbolic_verifier.py`, `ONNX INT8`), and raw uppercase enum badges (`SUSPECTED_HALLUCINATION`, `METADATA_ERROR`, `MISSING_REFERENCE`) alienate ordinary students and lecturers.
2. **Onboarding & Conversion Friction:** Every `"Try CITRA Free"` CTA routes to `/login` instead of letting visitors test a citation immediately or register cleanly; `/login` asks for `"Username"` even though the backend already supports email login; `/register` slices the submit button at `1440×900`.
3. **Production Trust Leaks:** `/privacy` displays a `LEGAL DRAFT` warning banner with unresolved `[CHECK: ...]` / `[KIỂM TRA: ...]` placeholders and raw DB column names; `/pricing` publicly advertises `Visa 4242` test-card autofill; brand naming oscillates between `CITRA` and `SourceLogic`.
4. **UI Craft & Responsive Defects:** The `Pro` plan card overlays body text directly on high-variance floral artwork (failing WCAG contrast in both Light and Dark modes); subpage headers wrap onto 2 lines at `1440px`; `#taxonomy` points to Pricing while `#workspaces` points to Testimonials; Mobile menu omits `Pricing`; Mobile `#compare-matrix` clips mid-word; several cards clip badges or drop orphan `)` and `→` characters.

**Goal:** Transform CITRA into an award-caliber, zero-defect frontend experience that feels as effortless and human as Grammarly/Apple on the surface while preserving Linear/Stripe-grade explainable technical depth one click away via Progressive Disclosure.

---

## 2. Goals, Non-Goals & Anti-Goals

### Goals
- **5-Second Non-Tech Clarity:** Any non-technical student or lecturer immediately understands what CITRA checks, how it protects their thesis/manuscript, and what each verdict means in plain English and natural Vietnamese.
- **Progressive Disclosure Architecture:** Keep technical traces (`R01–R30`, DOI resolution conditions, semantic similarity scores, XML/engine details) accessible inside an explicit collapsible *"Technical Trace / Xem Bằng Chứng Kỹ Thuật"* drawer rather than cluttering primary marketing and onboarding surfaces.
- **Instant "Aha! Moment" Without Login:** Provide a public, IP-rate-limited **Guest Instant Citation Checker** right on `LandingPage` (supporting 1-click real academic presets and custom 1–3 reference paste with <2.5s verification and graceful client fallback).
- **Zero-Defect UI Craft & WCAG Contrast:** Fix `Pro` card legibility in Light & Dark modes (`>= 7:1` contrast), eliminate all text truncation/clipping/orphan punctuation at `1440×900`, `1024×768`, `768×1024`, `390×844`, and `375×812`, fix subpage header wrapping, and replace Mobile's clipped comparison table with a segmented tier switcher.
- **Commercial Trust & Statutory Hygiene:** Remove all `LEGAL DRAFT` / `[CHECK: ...]` placeholders and public test-card instructions (gating demo helpers behind `VITE_DEMO_MODE === 'true'`), add `/terms` and an editorial `404` page, and preserve 100% of Vietnamese Personal Data Protection Law `91/2025/QH15` & Decree `356/2025/NĐ-CP` compliance.

### Non-Goals
- Changing core Neuro-Symbolic verification algorithms, ML weights, or scholarly API retrieval logic.
- Altering existing Stripe/VNPay backend billing math (`$0` / `$16`–`$20` / `$160`–`$200`) or breaking `StripeDemoCheckoutPage` sandbox execution.

### Anti-Goals (Failure Conditions Even If Code Builds)
- Replacing CITRA's warm editorial paper + Sentient serif + impressionist gallery identity with generic purple/neon SaaS gradients.
- Deleting explainable technical evidence completely instead of organizing it via Progressive Disclosure.
- Leaving any mixed English-inside-Vietnamese badges, truncated `...` marketing copy, horizontal mobile overflow, or broken existing Vitest/Pytest tests.

---

## 3. Selected Architecture & Design Decisions

1. **Progressive Disclosure Pattern:** Primary surfaces use human-first copy and plain-language verdict badges (`Verified Source`, `Citation Details Mismatch`, `Unverified — Likely AI-Invented`, `Missing in Bibliography`, `Needs Manual Check`). Expandable drawers reveal rule IDs (`R01–R30`), mathematical conditions, and engine telemetry.
2. **Framed Gallery Header + Frosted Solid Surface for `Pro` Tier Card:** Display `/solva/pricing-floral.webp` as an artistic top header band with soft gradient transition into an opaque/high-scrim body (`>= 94%` surface backing in Light and Dark themes) + aligned card grid rows.
3. **Guest Instant Checker (`POST /api/essays/sandbox/public-verify` + `GuestInstantChecker.tsx`):** Strictly IP-rate-limited (`6 req / 60s`, max 3 references, `allow_serpapi_flag=False`), paired with curated instant presets so visitors experience real verification before registration.
4. **Multi-Agent Triad Quality Gate per Task:** Every task runs through (1) Implementer Subagent (TDD + build/lint/test), (2) Independent Spec & Code Reviewer Subagent, and (3) Adversarial Principal UI/UX & Non-Tech User Critic Subagent + Responsive Browser Check, looping until zero defects before checkbox completion and atomic git commit.
