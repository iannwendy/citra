# CITRA — 60-second promo film

Programmatic marketing video for CITRA, built with [Remotion](https://remotion.dev).
Every frame is rendered from real UI captures of the running platform plus code-driven
motion design; the soundtrack is synthesised procedurally (royalty-free by construction).

| Item | Value |
| :--- | :--- |
| Output | `out/CITRA_Promo_4K60.mp4` |
| Resolution | 3840 × 2160 (UHD 4K), rendered at `--scale=2` from a 1920×1080 layout |
| Frame rate | 60 fps · 3,600 frames · 60 s |
| Video | H.264 High, CRF 14, `x264 slow`, yuv420p |
| Audio | AAC 320 kbps stereo, 48 kHz (from a 24-bit WAV master) |

## Storyboard (locked to 120 BPM — 1 bar = 2 s)

| Time | Scene | Feature |
| :--- | :--- | :--- |
| 0–10 s | Hook | A real reference verifies; an AI-fabricated one glitches → “Some of them never existed.” |
| 10–14 s | Brand reveal | Logo, “Verify every citation. Trace every source.” |
| 14–18 s | 01 Upload | PDF/DOCX drop + 5-stage pipeline (GROBID → 15+ APIs → SBERT → 28 rules → calibrated verdict) |
| 18–24 s | 02 Hallucination detection | Citation Debugger IDE, reasoning + `R-FABRICATED-DOI` rule |
| 24–28 s | 03 Retraction watch | Retracted-paper warning + field-by-field metadata diff |
| 28–32 s | 04 Explainable AI | 5-stage neuro-symbolic Logic Trace |
| 32–38 s | 05 1-Click Auto-Fix | Remediation studio, before → after, APA/IEEE/Harvard/BibTeX/RIS/.DOCX |
| 38–42 s | 06 Evidence graph | Evidence DAG from database hit to verdict |
| 42–48 s | 07 For educators | Shared AI-hallucination radar + faculty review queue |
| 48–52 s | Montage | Sandbox, consistency, document, issues, dashboard, batch, health, pricing (beat cuts) |
| 52–56 s | Proof | 15+ databases · 128K+ papers · 28 rules · 98.58 % benchmark accuracy |
| 56–60 s | End card | CTA `citra.io.vn` + Vietnamese tagline |

## Rebuild

```bash
npm install
# 1) UI captures (needs the local stack on :5173 / :8000)
node capture/capture.mjs && node capture/capture_extra.mjs
# 2) Soundtrack (numpy + scipy)
python3 audio/make_music.py
# 3) Preview / render
npx remotion studio
npx remotion render CitraPromo out/CITRA_Promo_4K60.mp4 --scale=2 --codec=h264 --crf=14 \
  --x264-preset=slow --image-format=jpeg --jpeg-quality=100 --audio-codec=aac --audio-bitrate=320k
```

### Web delivery (landing page `#film` section)

```bash
# grain-free 1440p60 master (animated grain wastes bitrate; the page overlays static CSS grain)
npx remotion render CitraPromo out/web_master_1440p.mp4 --scale=1.3333333333333333 --props='{"grain":false}' \
  --codec=h264 --crf=8 --image-format=jpeg --jpeg-quality=100 --audio-codec=aac --audio-bitrate=320k
# AV1 / HEVC / H.264 ladder + teaser + posters -> web/public/media/citra-film-v1/  (needs brew ffmpeg)
./scripts/encode_web.sh
```

The player lives in `web/src/components/landing/CitraFilm.tsx`. When re-encoding, bump the folder
version (`citra-film-v2`) in both the script and `BASE`, because `/media/` is served `immutable`.

Scene timing lives in `src/timeline.json` and is shared by the video and the music generator,
so whooshes, hits and cuts stay in sync if you retime a scene.

> Note: `remotion.config.ts` points Remotion at Playwright's Chromium headless shell because
> Remotion's own downloaded shell stalls on this machine.
