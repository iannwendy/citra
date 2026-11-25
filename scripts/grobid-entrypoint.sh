#!/bin/sh
# =====================================================================
# scripts/grobid-entrypoint.sh — Version-resilient GROBID config wrapper
#
# Patches only targeted performance/memory keys in GROBID's built-in
# `grobid.yaml` from environment variables instead of bind-mounting a
# full 438-line copy that could drift on future GROBID upgrades.
#
# Environment variables:
#   GROBID_CONCURRENCY        Worker engine pool size (default: 2)
#   GROBID_POOL_MAX_WAIT      Seconds to wait for a free engine (default: 30)
#   GROBID_PDFALTO_MEMORY_MB  pdfalto per-process memory cap MB (default: 1024)
#   GROBID_MODEL_PRELOAD      Preload CRF models at boot: true|false (default: true)
#   GROBID_CONFIG_PATH        Override path to grobid.yaml (for unit testing)
# =====================================================================
set -eu

CFG="${GROBID_CONFIG_PATH:-/opt/grobid/grobid-home/config/grobid.yaml}"
CONCURRENCY="${GROBID_CONCURRENCY:-2}"
POOL_MAX_WAIT="${GROBID_POOL_MAX_WAIT:-30}"
PDFALTO_MEM_MB="${GROBID_PDFALTO_MEMORY_MB:-1024}"
MODEL_PRELOAD="${GROBID_MODEL_PRELOAD:-true}"

require_pos_int() {
    case "$2" in
        ''|*[!0-9]*|0*)
            printf 'ERROR: %s must be a positive integer (no leading zeros), got: %s\n' "$1" "$2" >&2
            exit 1
            ;;
    esac
}

require_pos_int "GROBID_CONCURRENCY" "$CONCURRENCY"
require_pos_int "GROBID_POOL_MAX_WAIT" "$POOL_MAX_WAIT"
require_pos_int "GROBID_PDFALTO_MEMORY_MB" "$PDFALTO_MEM_MB"

case "$MODEL_PRELOAD" in
    true|false) ;;
    *)
        printf 'ERROR: GROBID_MODEL_PRELOAD must be true or false, got: %s\n' "$MODEL_PRELOAD" >&2
        exit 1
        ;;
esac

if [ ! -f "$CFG" ]; then
    printf 'ERROR: GROBID config file not found: %s\n' "$CFG" >&2
    exit 1
fi

CFG_DIR=$(dirname "$CFG")
if [ ! -w "$CFG_DIR" ] || [ ! -w "$CFG" ]; then
    printf 'ERROR: GROBID config path is not writable: %s\n' "$CFG" >&2
    exit 1
fi

# Snapshot pristine image config atomically once so container restarts remain idempotent.
ORIG="${CFG}.orig"
ORIG_TMP="${ORIG}.tmp.$$"
TMP="${CFG}.tmp.$$"
trap 'rm -f "$TMP" "$ORIG_TMP"' EXIT INT TERM HUP

if [ ! -f "$ORIG" ]; then
    cp "$CFG" "$ORIG_TMP"
    mv "$ORIG_TMP" "$ORIG"
fi

# Patch strictly within expected YAML parent blocks (POSIX awk using [ \t] for mawk/gawk/BSD portability).
awk \
    -v concurrency="$CONCURRENCY" \
    -v pool_max_wait="$POOL_MAX_WAIT" \
    -v pdfalto_mem="$PDFALTO_MEM_MB" \
    -v model_preload="$MODEL_PRELOAD" \
'
BEGIN {
    in_grobid = 0
    in_pdf = 0
    in_pdfalto = 0
    c_conc = 0
    c_wait = 0
    c_preload = 0
    c_pdfalto = 0
}
{
    line = $0
    sub(/\r$/, "", line)

    # Track top-level YAML keys (0-space indent, non-comment, including scalars and commented headers)
    if (line ~ /^[^ \t#][^:]*:/) {
        in_grobid = (line ~ /^grobid:[ \t]*(#.*)?$/) ? 1 : 0
        in_pdf = 0
        in_pdfalto = 0
    } else if (in_grobid && line ~ /^  [^ \t#][^:]*:/) {
        # 2-space indent key directly under grobid:
        in_pdf = (line ~ /^  pdf:[ \t]*(#.*)?$/) ? 1 : 0
        in_pdfalto = 0
    } else if (in_pdf && line ~ /^    [^ \t#][^:]*:/) {
        # 4-space indent key directly under grobid.pdf:
        in_pdfalto = (line ~ /^    pdfalto:[ \t]*(#.*)?$/) ? 1 : 0
    }

    if (in_grobid && line ~ /^  concurrency:[ \t]*[0-9]+([ \t]*(#.*)?)?$/) {
        print "  concurrency: " concurrency
        c_conc++
        next
    }
    if (in_grobid && line ~ /^  poolMaxWait:[ \t]*[0-9]+([ \t]*(#.*)?)?$/) {
        print "  poolMaxWait: " pool_max_wait
        c_wait++
        next
    }
    if (in_grobid && line ~ /^  modelPreload:[ \t]*(true|false)([ \t]*(#.*)?)?$/) {
        print "  modelPreload: " model_preload
        c_preload++
        next
    }
    if (in_pdfalto && line ~ /^      memoryLimitMb:[ \t]*[0-9]+([ \t]*(#.*)?)?$/) {
        print "      memoryLimitMb: " pdfalto_mem
        c_pdfalto++
        next
    }

    print $0
}
END {
    if (c_conc != 1 || c_wait != 1 || c_preload != 1 || c_pdfalto != 1) {
        printf("ERROR: GROBID config patch mismatch (concurrency=%d, poolMaxWait=%d, modelPreload=%d, pdfalto.memoryLimitMb=%d)\n", c_conc, c_wait, c_preload, c_pdfalto) > "/dev/stderr"
        exit 1
    }
}
' "$ORIG" > "$TMP"

mv "$TMP" "$CFG"
trap - EXIT INT TERM HUP

printf 'INFO: Configured GROBID (%s): concurrency=%s poolMaxWait=%s pdfalto.memoryLimitMb=%s modelPreload=%s\n' \
    "$CFG" "$CONCURRENCY" "$POOL_MAX_WAIT" "$PDFALTO_MEM_MB" "$MODEL_PRELOAD"

# Allow tests to invoke config patching without exec-ing GROBID server.
if [ "${GROBID_PATCH_ONLY:-0}" = "1" ]; then
    exit 0
fi

cd /opt/grobid
if [ "$#" -eq 0 ]; then
    set -- ./grobid-service/bin/grobid-service
fi
exec /tini -s -- "$@"
