#!/bin/bash
# =====================================================================
# docker-start.sh — Quick start script for Essay Integrity Checker
#
# Usage:
#   ./scripts/docker-start.sh        # Start all services
#   ./scripts/docker-start.sh build  # Rebuild images first
#   ./scripts/docker-start.sh stop   # Stop all services
#   ./scripts/docker-start.sh logs   # Tail logs
#   ./scripts/docker-start.sh test   # Run tests in container
#   ./scripts/docker-start.sh clean  # Remove containers + volumes
# =====================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check Docker is running
check_docker() {
    if ! docker info > /dev/null 2>&1; then
        log_error "Docker is not running. Please start Docker Desktop."
        exit 1
    fi
}

# Pull latest GROBID image
pull_grobid() {
    log_info "Pulling latest GROBID image..."
    docker pull grobid/grobid:0.9.1-crf || true
}

# Start all services
start_services() {
    log_info "Starting Essay Integrity Checker..."
    docker-compose up -d

    log_info "Waiting for services to be healthy..."
    sleep 5

    # Check service status
    echo ""
    echo "=========================================="
    echo "  Services Status"
    echo "=========================================="
    docker-compose ps

    echo ""
    echo "=========================================="
    echo "  URLs"
    echo "=========================================="
    echo "  API:    http://localhost:8000"
    echo "  Web:    http://localhost:5173"
    echo "  GROBID: http://localhost:8070"
    echo "=========================================="

    log_success "All services started!"
    log_info "Run './scripts/docker-start.sh logs' to watch logs"
}

# Rebuild and start
rebuild_and_start() {
    log_info "Rebuilding Docker images..."
    docker-compose build --no-cache

    pull_grobid

    log_info "Starting services..."
    docker-compose up -d

    start_services
}

# Stop all services
stop_services() {
    log_info "Stopping services..."
    docker-compose stop
    log_success "Services stopped."
}

# Show logs
show_logs() {
    docker-compose logs -f --tail=100
}

# Run tests
run_tests() {
    log_info "Running tests in API container..."
    docker-compose exec -T api pytest tests/ -v --tb=short
}

# Clean up everything
clean_all() {
    log_warn "This will remove all containers, images, and volumes!"
    read -p "Are you sure? [y/N] " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        log_info "Removing containers..."
        docker-compose down -v --remove-orphans
        log_info "Removing build cache..."
        docker builder prune -f
        log_success "Clean complete."
    else
        log_info "Clean cancelled."
    fi
}

# Print help
print_help() {
    echo "Essay Integrity Checker - Docker Management Script"
    echo ""
    echo "Usage: $0 [command]"
    echo ""
    echo "Commands:"
    echo "  (none)   Start all services"
    echo "  build    Rebuild images and start"
    echo "  stop     Stop all services"
    echo "  logs     Tail logs"
    echo "  test     Run tests in container"
    echo "  clean    Remove containers + volumes"
    echo "  status   Show service status"
    echo "  health   Check service health"
    echo "  help     Show this help"
    echo ""
}

# Show status
show_status() {
    echo ""
    echo "=========================================="
    echo "  Services Status"
    echo "=========================================="
    docker-compose ps
    echo ""
    echo "=========================================="
    echo "  Health Status"
    echo "=========================================="

    # Check API
    if curl -sf http://localhost:8000/health > /dev/null 2>&1; then
        echo -e "  API:    ${GREEN}healthy${NC}"
    else
        echo -e "  API:    ${RED}unhealthy${NC}"
    fi

    # Check GROBID
    if curl -sf http://localhost:8070/api/isalive > /dev/null 2>&1; then
        echo -e "  GROBID: ${GREEN}healthy${NC}"
    else
        echo -e "  GROBID: ${RED}unhealthy${NC}"
    fi

    # Check Web
    if curl -sf http://localhost:5173 > /dev/null 2>&1; then
        echo -e "  Web:    ${GREEN}healthy${NC}"
    else
        echo -e "  Web:    ${RED}unhealthy${NC}"
    fi

    echo "=========================================="
}

# Check health
check_health() {
    show_status
}

# Main
case "${1:-}" in
    build)
        check_docker
        rebuild_and_start
        ;;
    stop)
        check_docker
        stop_services
        ;;
    logs)
        check_docker
        show_logs
        ;;
    test)
        check_docker
        run_tests
        ;;
    clean)
        check_docker
        clean_all
        ;;
    status)
        check_docker
        show_status
        ;;
    health)
        check_docker
        check_health
        ;;
    help|--help|-h)
        print_help
        ;;
    "")
        check_docker
        start_services
        ;;
    *)
        log_error "Unknown command: $1"
        print_help
        exit 1
        ;;
esac
