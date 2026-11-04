#!/usr/bin/env bash
# =====================================================================
# scripts/grobid_docker_setup.sh — setup GROBID Docker container
# =====================================================================
#
# Reference: v1.2 §5.2 (Tuần 8 — GROBID Docker adapter)
#
# Usage:
#     ./scripts/grobid_docker_setup.sh start    # start container (default)
#     ./scripts/grobid_docker_setup.sh stop     # stop container
#     ./scripts/grobid_docker_setup.sh status   # show health status
#     ./scripts/grobid_docker_setup.sh logs     # tail container logs
#     ./scripts/grobid_docker_setup.sh restart  # stop + start
#     ./scripts/grobid_docker_setup.sh rm       # stop + remove container
#     ./scripts/grobid_docker_setup.sh pull     # pull image only
#     ./scripts/grobid_docker_setup.sh env      # print required env vars
#
# Requirements:
#     - Docker installed and daemon running
#     - ~1.5 GB free RAM (GROBID allocates 1.5 GB heap by default)
#     - Ports 8070-8071 free on host (GROBID server + admin)
#
# Environment variables (optional):
#     GROBID_IMAGE    Docker image to use (default: grobid/grobid:0.9.1-crf)
#     GROBID_HOST_PORT   Host port for GROBID server (default: 8070)
#     GROBID_CONTAINER_NAME  Container name (default: essay-check-grobid)
#     GROBID_MEMORY    JVM heap limit (default: 2g)
# =====================================================================

set -euo pipefail

# --- Defaults ---
GROBID_IMAGE="${GROBID_IMAGE:-grobid/grobid:0.9.1-crf}"
GROBID_HOST_PORT="${GROBID_HOST_PORT:-8070}"
GROBID_CONTAINER_NAME="${GROBID_CONTAINER_NAME:-essay-check-grobid}"
GROBID_MEMORY="${GROBID_MEMORY:-2g}"
GROBID_HEALTH_TIMEOUT="${GROBID_HEALTH_TIMEOUT:-120}"  # seconds

# --- Colors (only if stdout is a tty) ---
if [ -t 1 ]; then
    RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
    BLUE='\033[0;34m'; NC='\033[0m'
else
    RED=''; GREEN=''; YELLOW=''; BLUE=''; NC=''
fi

log_info() { printf "${BLUE}[INFO]${NC} %s\n" "$*"; }
log_ok() { printf "${GREEN}[OK]${NC} %s\n" "$*"; }
log_warn() { printf "${YELLOW}[WARN]${NC} %s\n" "$*" >&2; }
log_err() { printf "${RED}[ERROR]${NC} %s\n" "$*" >&2; }

# --- Helpers ---
docker_cmd() {
    if command -v docker >/dev/null 2>&1; then
        # Always target Docker Desktop.  A stale DOCKER_CONTEXT=colima in the
        # shell must not silently route this project to a dead Colima socket.
        DOCKER_CONTEXT=desktop-linux docker "$@"
    else
        log_err "docker not found in PATH. Install Docker Desktop or docker-ce."
        exit 1
    fi
}

check_docker() {
    if ! command -v docker >/dev/null 2>&1; then
        log_err "Docker chưa cài. Cài Docker Desktop (https://www.docker.com/products/docker-desktop/) hoặc docker-ce."
        exit 1
    fi
    if ! DOCKER_CONTEXT=desktop-linux docker info >/dev/null 2>&1; then
        log_err "Docker daemon không chạy. Khởi động Docker và thử lại."
        exit 1
    fi
}

container_running() {
    docker_cmd inspect -f '{{.State.Running}}' "$GROBID_CONTAINER_NAME" 2>/dev/null | grep -q true
}

container_exists() {
    docker_cmd inspect -f '{{.Id}}' "$GROBID_CONTAINER_NAME" 2>/dev/null >/dev/null
}

grobid_healthy() {
    local url="http://localhost:${GROBID_HOST_PORT}/api/isalive"
    local code
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$url" 2>/dev/null || echo "000")
    [ "$code" = "200" ]
}

wait_for_healthy() {
    local waited=0
    log_info "Chờ GROBID healthy (timeout ${GROBID_HEALTH_TIMEOUT}s)..."
    while ! grobid_healthy; do
        if [ "$waited" -ge "$GROBID_HEALTH_TIMEOUT" ]; then
            log_err "GROBID không healthy sau ${GROBID_HEALTH_TIMEOUT}s."
            log_err "Xem logs: $0 logs"
            return 1
        fi
        sleep 2
        waited=$((waited + 2))
        printf "."
    done
    echo ""
    log_ok "GROBID healthy sau ${waited}s."
}

# --- Commands ---

cmd_pull() {
    check_docker
    log_info "Pull GROBID image: $GROBID_IMAGE"
    docker_cmd pull "$GROBID_IMAGE"
    log_ok "Image ready."
}

cmd_start() {
    check_docker

    if container_running; then
        log_warn "Container '$GROBID_CONTAINER_NAME' đã chạy."
        if grobid_healthy; then
            log_ok "GROBID vẫn healthy. Không cần restart."
        else
            log_warn "Container chạy nhưng GROBID không healthy — đợi thêm..."
            wait_for_healthy || exit 1
        fi
        return 0
    fi

    if container_exists; then
        log_info "Container đã tồn tại (stopped). Khởi động lại..."
        docker_cmd start "$GROBID_CONTAINER_NAME"
    else
        # Make sure image exists locally; auto-pull if missing
        if ! docker_cmd image inspect "$GROBID_IMAGE" >/dev/null 2>&1; then
            log_info "Image chưa có — pulling..."
            cmd_pull
        fi

        log_info "Tạo container '$GROBID_CONTAINER_NAME' (port $GROBID_HOST_PORT)..."
        # GROBID 0.9.1-crf ships multi-arch (linux/amd64 + linux/arm64) with
        # /tini -s -- ./grobid-service/bin/grobid-service and JDK 21 --add-opens.
        docker_cmd run -d \
            --rm \
            --ulimit core=0 \
            --name "$GROBID_CONTAINER_NAME" \
            -p "${GROBID_HOST_PORT}:8070" \
            -p 8071:8071 \
            -e JAVA_OPTS="-Xmx${GROBID_MEMORY} -XX:+UseG1GC" \
            -e JDK_JAVA_OPTIONS="-Xmx${GROBID_MEMORY} -XX:+UseG1GC" \
            "$GROBID_IMAGE"
    fi

    wait_for_healthy || exit 1

    log_ok "GROBID ready: http://localhost:${GROBID_HOST_PORT}"
    log_info "Set environment để app biết GROBID URL:"
    log_info "  export GROBID_URL='http://localhost:${GROBID_HOST_PORT}'"
    log_info "  export GROBID_ENABLED=true"
}

cmd_stop() {
    check_docker
    if container_running; then
        log_info "Stop container '$GROBID_CONTAINER_NAME'..."
        docker_cmd stop "$GROBID_CONTAINER_NAME" >/dev/null
        log_ok "Stopped."
    elif container_exists; then
        log_info "Container tồn tại nhưng không chạy. Remove..."
        docker_cmd rm "$GROBID_CONTAINER_NAME" >/dev/null
        log_ok "Removed."
    else
        log_warn "Container '$GROBID_CONTAINER_NAME' không tồn tại."
    fi
}

cmd_restart() {
    cmd_stop || true
    cmd_start
}

cmd_status() {
    check_docker
    if container_running; then
        printf "Container: %s${GREEN}running${NC}\n" ""
        docker_cmd inspect -f '{{.State.Status}}' "$GROBID_CONTAINER_NAME" \
            | xargs -I{} printf "  State: %s\n" {}
        if grobid_healthy; then
            printf "Health: ${GREEN}OK${NC} (http://localhost:%s/api/isalive)\n" "$GROBID_HOST_PORT"
        else
            printf "Health: ${RED}FAIL${NC} (server up nhưng /api/isalive không 200)\n"
        fi
    elif container_exists; then
        printf "Container: ${YELLOW}stopped${NC}\n"
    else
        printf "Container: ${RED}not created${NC}\n"
        log_info "Run: $0 start"
    fi
}

cmd_logs() {
    check_docker
    if container_exists; then
        docker_cmd logs -f --tail 100 "$GROBID_CONTAINER_NAME"
    else
        log_err "Container '$GROBID_CONTAINER_NAME' không tồn tại."
        exit 1
    fi
}

cmd_rm() {
    check_docker
    cmd_stop
    log_ok "Removed (vì run với --rm nên container tự xoá khi stop)."
}

cmd_env() {
    cat <<EOF
# --- GROBID environment variables ---
# Source this file để app dùng GROBID:
#   source $0 env

export GROBID_URL="http://localhost:${GROBID_HOST_PORT}"
export GROBID_ENABLED="true"

# Optional: contact email cho scholarly APIs polite pool
export CONTACT_EMAIL="${CONTACT_EMAIL:-student@tdtu.edu.vn}"

# Optional: Semantic Scholar API key (tăng rate limit)
export S2_API_KEY="${S2_API_KEY:-}"

# Verify:
echo "GROBID health:"
curl -s "http://localhost:${GROBID_HOST_PORT}/api/isalive" && echo
EOF
}

cmd_help() {
    sed -n '2,30p' "$0"
}

# --- Main ---

ACTION="${1:-start}"

case "$ACTION" in
    start)   cmd_start ;;
    stop)    cmd_stop ;;
    restart) cmd_restart ;;
    status)  cmd_status ;;
    logs)    cmd_logs ;;
    rm|remove) cmd_rm ;;
    pull)    cmd_pull ;;
    env)     cmd_env ;;
    help|-h|--help) cmd_help ;;
    *)
        log_err "Unknown action: $ACTION"
        cmd_help
        exit 1
        ;;
esac
