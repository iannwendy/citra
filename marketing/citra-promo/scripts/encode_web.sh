#!/usr/bin/env bash
# Encode the grain-free 1440p120 master into hybrid 120fps + 60fps web delivery variants for citra.io.vn:
#   - High-Refresh ProMotion / 120Hz Tier: 1440p120 AV1 · 1080p120 AV1 · 1080p120 H.264 (Level 5.1)
#   - Universal Hardware-Safe 60Hz Tier:   1440p60 AV1  · 1080p60 AV1/HEVC/H.264 · 720p60 AV1/H.264
#   - 4.0s Muted 30fps Teaser Loop (66.0s–70.0s 3D Spatial Bento reveal) + AVIF/WebP/JPG Posters (13.2s)
set -euo pipefail
cd "$(dirname "$0")/.."

SRC=${SRC:-out/web_master_1440p120.mp4}
OUT=${1:-../../web/public/media/citra-film-v2}
FF="ffmpeg -hide_banner -loglevel error -y"
mkdir -p "$OUT"

AUDIO="-c:a aac_at -b:a 192k -ac 2 -ar 48000"
COMMON120="-pix_fmt yuv420p -r 120 -g 240 -movflags +faststart -map_metadata -1"
COMMON60="-pix_fmt yuv420p -r 60 -g 120 -movflags +faststart -map_metadata -1"
AV1="-c:v libsvtav1 -preset 5 -svtav1-params tune=0:scd=1"
HEVC60="-c:v libx265 -preset slow -tag:v hvc1 -x265-params log-level=error:keyint=120:min-keyint=120"
H264="-c:v libx264 -preset slow -profile:v high"
S1080="-vf scale=1920:1080:flags=lanczos"
S720="-vf scale=1280:720:flags=lanczos"

enc() {
  local name=$1
  shift
  echo "→ $name"
  local t0=$SECONDS
  $FF "$@" "$OUT/$name"
  echo "  $(du -h "$OUT/$name" | cut -f1) in $((SECONDS - t0))s"
}

# ---- 120fps High-Refresh Tier (ProMotion / 120Hz Desktop & Flagship Devices) ----
enc film-1440p-120.av1.mp4  -i "$SRC"        $AV1  -crf 40 $COMMON120 $AUDIO
enc film-1080p-120.av1.mp4  -i "$SRC" $S1080 $AV1  -crf 40 $COMMON120 $AUDIO
enc film-1080p-120.h264.mp4 -i "$SRC" $S1080 $H264 -level 5.1 -crf 24 -maxrate 8M -bufsize 16M $COMMON120 $AUDIO

# ---- 60fps Universal Hardware-Safe Tier (Standard Displays, iOS & Mobile) -------
enc film-1440p.av1.mp4  -i "$SRC"        $AV1    -crf 42 $COMMON60 $AUDIO
enc film-1080p.av1.mp4  -i "$SRC" $S1080 $AV1    -crf 42 $COMMON60 $AUDIO
enc film-720p.av1.mp4   -i "$SRC" $S720  $AV1    -crf 44 $COMMON60 $AUDIO
enc film-1080p.hevc.mp4 -i "$SRC" $S1080 $HEVC60 -crf 28 $COMMON60 $AUDIO
enc film-1080p.h264.mp4 -i "$SRC" $S1080 $H264   -level 4.2 -crf 25 -maxrate 5M -bufsize 10M $COMMON60 $AUDIO
enc film-720p.h264.mp4  -i "$SRC" $S720  $H264   -level 3.2 -crf 26 -maxrate 2500k -bufsize 5M $COMMON60 $AUDIO

# ---- Teaser: 66.0s–70.0s 3D Spatial Bento Matrix, muted 30fps loop --------------
TEASER="-pix_fmt yuv420p -r 30 -g 60 -movflags +faststart -map_metadata -1 -an"
enc teaser-1080p.av1.mp4  -ss 66.0 -t 4.0 -i "$SRC" $S1080 $AV1  -crf 45 $TEASER
enc teaser-1080p.h264.mp4 -ss 66.0 -t 4.0 -i "$SRC" $S1080 $H264 -level 4.0 -crf 27 $TEASER

# ---- Responsive Posters: Brand Reveal Monument Frame (13.2s) --------------------
$FF -ss 13.2 -i "$SRC" -frames:v 1 out/poster.png
PY_BIN="../../.venv/bin/python"
if [ ! -x "$PY_BIN" ]; then PY_BIN="python3"; fi
"$PY_BIN" - "$OUT" <<'PY'
import sys
from PIL import Image
out = sys.argv[1]
im = Image.open('out/poster.png').convert('RGB')
for w in (2560, 1280):
    r = im.resize((w, w * 9 // 16), Image.LANCZOS)
    r.save(f'{out}/poster-{w}.avif', quality=58)
    r.save(f'{out}/poster-{w}.webp', quality=80, method=6)
    if w == 1280:
        r.save(f'{out}/poster-{w}.jpg', quality=84, optimize=True, progressive=True)
PY
ls -lh "$OUT"
