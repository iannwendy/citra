#!/usr/bin/env bash
# Encode the grain-free 1440p60 master into web delivery variants for the landing page.
#   AV1 (SVT-AV1) 1440p/1080p/720p · HEVC (x265, hvc1) 1080p · H.264 1080p/720p
# CRFs were picked from a VMAF + visual ladder on the UI-heavy 16–28s segment: SVT-AV1
# CRF 42 is visually identical to CRF 31 on this flat editorial UI at ~half the bitrate.
#   + 4s muted teaser loop (AV1 + H.264) + poster images (AVIF/WebP/JPG).
# AAC is encoded with Apple AudioToolbox (aac_at). All MP4s use +faststart (moov first) so playback starts after a few hundred KB,
# a 2s GOP for quick seeking, and AAC-LC 160k stereo audio.
set -euo pipefail
cd "$(dirname "$0")/.."

SRC=out/web_master_1440p.mp4
OUT=${1:-../../web/public/media/citra-film-v1}
# Needs an ffmpeg with libsvtav1 + libx265 + libx264 (Homebrew: brew install ffmpeg).
FF="ffmpeg -hide_banner -loglevel error -y"
mkdir -p "$OUT"

AUDIO="-c:a aac_at -b:a 160k -ac 2 -ar 48000"
COMMON="-pix_fmt yuv420p -r 60 -g 120 -movflags +faststart -map_metadata -1"
AV1="-c:v libsvtav1 -preset 4 -svtav1-params tune=0:scd=1"
HEVC="-c:v libx265 -preset slow -tag:v hvc1 -x265-params log-level=error:keyint=120:min-keyint=120"
H264="-c:v libx264 -preset slow -profile:v high"
S1080="-vf scale=1920:1080:flags=lanczos"
S720="-vf scale=1280:720:flags=lanczos"

enc() { local name=$1; shift; echo "→ $name"; local t0=$SECONDS; $FF "$@" "$OUT/$name"; echo "  $(du -h "$OUT/$name" | cut -f1) in $((SECONDS - t0))s"; }

# ---- full film -------------------------------------------------------------
enc film-1440p.av1.mp4  -i $SRC        $AV1  -crf 42 $COMMON $AUDIO
enc film-1080p.av1.mp4  -i $SRC $S1080 $AV1  -crf 42 $COMMON $AUDIO
enc film-720p.av1.mp4   -i $SRC $S720  $AV1  -crf 44 $COMMON $AUDIO
enc film-1080p.hevc.mp4 -i $SRC $S1080 $HEVC -crf 28 $COMMON $AUDIO
enc film-1080p.h264.mp4 -i $SRC $S1080 $H264 -level 4.2 -crf 25 -maxrate 5M -bufsize 10M $COMMON $AUDIO
enc film-720p.h264.mp4  -i $SRC $S720  $H264 -level 3.2 -crf 26 -maxrate 2500k -bufsize 5M $COMMON $AUDIO

# ---- teaser: 48.0s–51.75s montage, muted 30fps loop (decorative, sits under the Play button)
TEASER="-pix_fmt yuv420p -r 30 -g 60 -movflags +faststart -map_metadata -1 -an"
enc teaser-1080p.av1.mp4  -ss 48 -t 3.75 -i $SRC $S1080 $AV1  -crf 46 $TEASER
enc teaser-1080p.h264.mp4 -ss 48 -t 3.75 -i $SRC $S1080 $H264 -level 4.0 -crf 28 $TEASER

# ---- poster: brand reveal frame (13.0s) --------------------------------------
$FF -ss 13.0 -i $SRC -frames:v 1 out/poster.png
python3 - "$OUT" <<'PY'
import sys
from PIL import Image
out = sys.argv[1]
im = Image.open('out/poster.png').convert('RGB')
for w in (2560, 1280):
    r = im.resize((w, w * 9 // 16), Image.LANCZOS)
    r.save(f'{out}/poster-{w}.avif', quality=55)
    r.save(f'{out}/poster-{w}.webp', quality=78, method=6)
    if w == 1280:
        r.save(f'{out}/poster-{w}.jpg', quality=82, optimize=True, progressive=True)
PY
ls -la "$OUT"
