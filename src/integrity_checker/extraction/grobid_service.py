"""GROBID Service Manager — quản lý GROBID Docker container lifecycle.

Module này cung cấp:
- Auto-start/stop GROBID container khi app khởi động
- Health check endpoint
- Singleton pattern cho reuse connection
- Retry logic với exponential backoff

Requirements:
- Docker SDK (`pip install docker`)
- Docker daemon running
- Sufficient RAM (2GB+)

Usage:
    from integrity_checker.extraction.grobid_service import get_grobid_manager

    manager = get_grobid_manager()
    if manager.is_available():
        # Use GROBID
        tei_xml = manager.process_pdf(pdf_path)
    else:
        manager.start()
        manager.wait_until_ready()
"""

from __future__ import annotations

import logging
import os
import sys
import threading
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path

import requests  # type: ignore[import-untyped]

from integrity_checker.config import GrobidConfig, get_settings

logger = logging.getLogger(__name__)


class GROBID_STATUS(Enum):  # noqa: N801 - public enum name used across codebase/tests
    """GROBID container status."""

    AVAILABLE = "available"          # Container running, API responding
    UNHEALTHY = "unhealthy"         # Container running but API not responding
    STOPPED = "stopped"             # Container not running
    STARTING = "starting"           # Container starting
    UNKNOWN = "unknown"             # Cannot determine status


@dataclass
class GrobidStats:
    """Statistics cho GROBID service."""

    total_requests: int = 0
    successful_requests: int = 0
    failed_requests: int = 0
    cache_hits: int = 0
    cache_misses: int = 0
    last_used: float | None = None  # Unix timestamp
    container_id: str | None = None
    container_status: str = "unknown"


@dataclass
class GrobidServiceManager:
    """Manager cho GROBID Docker container.

    Attributes:
        config: GrobidConfig instance.
        stats: Processing statistics.
        _container_name: Docker container name.
        _image: Docker image to use.
        _memory: JVM heap limit.
        _started_automatically: True nếu container được start bởi manager.
    """

    config: GrobidConfig
    stats: GrobidStats = field(default_factory=GrobidStats)
    _status: GROBID_STATUS = field(default=GROBID_STATUS.UNKNOWN, repr=False)
    _started_automatically: bool = field(default=False, repr=False)
    _in_docker: bool = field(default=False, repr=False)
    _docker_daemon_available: bool = field(default=True, init=False, repr=False)
    _effective_url: str | None = field(default=None, init=False, repr=False)
    _stats_lock: threading.Lock = field(default_factory=threading.Lock, init=False, repr=False)

    # Docker container settings
    _container_name: str = "essay-check-grobid"
    _image: str = "grobid/grobid:0.9.1-crf"
    _memory: str = "768m"
    _container_memory_limit: str = "4g"
    _health_timeout: int = 120  # seconds

    def __post_init__(self) -> None:
        """Validate dependencies sau khi khởi tạo."""
        self._check_docker_available()
        self._check_docker_sdk()
        # Auto-detect Docker environment and adjust settings
        self._detect_environment()

    def _detect_environment(self) -> None:
        """Detect if running in Docker and adjust effective URL without mutating shared Settings."""
        import os as _os

        # Check if running in Docker container
        if _os.path.exists("/.dockerenv"):
            self._in_docker = True
            logger.debug("Running inside Docker container")
            # In Docker, use the internal network URL without mutating self.config.url in-place
            if self.config.url == "http://localhost:8070":
                self._effective_url = "http://grobid:8070"
                logger.info("Auto-switched GROBID effective URL to Docker internal network: http://grobid:8070")
            else:
                self._effective_url = None
        else:
            self._in_docker = False
            self._effective_url = None
            logger.debug("Running outside Docker container")

        # Check for Docker Compose service name resolution
        try:
            import socket
            socket.gethostbyname("grobid")
            if not self._in_docker:
                # Can resolve grobid hostname but not in docker - might be Docker network
                logger.debug("'grobid' hostname resolves - assuming Docker network")
        except socket.gaierror:
            pass

    def _check_docker_available(self) -> None:
        """Check nếu Docker CLI available."""
        import subprocess

        try:
            result = subprocess.run(
                ["docker", "info"],
                capture_output=True,
                timeout=5,
            )
            if result.returncode != 0:
                logger.warning("Docker daemon not running or not accessible")
                self._docker_daemon_available = False
                self._status = GROBID_STATUS.UNKNOWN
            else:
                self._docker_daemon_available = True
        except FileNotFoundError:
            logger.warning("Docker CLI not found in PATH")
            self._docker_daemon_available = False
            self._status = GROBID_STATUS.UNKNOWN
        except subprocess.TimeoutExpired:
            logger.warning("Docker daemon not responding")
            self._docker_daemon_available = False
            self._status = GROBID_STATUS.UNKNOWN

    @staticmethod
    def _can_connect_unix_socket(sock_path: str | Path) -> bool:
        """Probe an AF_UNIX socket inside a context manager so failed connects never leak FDs."""
        import socket as _socket

        af_unix = getattr(_socket, "AF_UNIX", None)
        if af_unix is None:
            return True
        p = Path(sock_path)
        if not p.exists():
            return False
        with _socket.socket(af_unix, _socket.SOCK_STREAM) as probe:
            probe.settimeout(0.5)
            try:
                probe.connect(str(p))
                return True
            except OSError:
                return False

    def _is_docker_socket_reachable(self) -> bool:
        """Return False when local Docker daemon/socket is unreachable (avoids unixconn FD leak)."""
        import types

        docker_mod = getattr(self, "_docker", None)
        if not isinstance(docker_mod, types.ModuleType):
            # Injected test mock (e.g. MagicMock) — allow unit tests to exercise SDK calls
            return True
        if not self._docker_daemon_available:
            return False
        if os.name != "posix":
            return True
        docker_host = os.environ.get("DOCKER_HOST", "").strip()
        if docker_host:
            if docker_host.startswith("unix://"):
                return self._can_connect_unix_socket(docker_host[len("unix://") :])
            return True
        desktop_socket = Path.home() / ".docker" / "run" / "docker.sock"
        if sys.platform == "darwin" and desktop_socket.exists():
            if self._can_connect_unix_socket(desktop_socket):
                return True
        return self._can_connect_unix_socket("/var/run/docker.sock")

    def _check_docker_sdk(self) -> bool:
        """Check nếu Docker SDK available."""
        try:
            import docker
            self._docker = docker
            return True
        except ImportError:
            logger.warning(
                "docker Python SDK not installed. "
                "Install with: pip install docker"
            )
            return False

    def _docker_client(self):
        """Return a client pinned to Docker Desktop on macOS.

        Docker CLI contexts are not consistently honored by every version of
        the Python SDK.  Prefer Desktop's socket when it exists, preventing a
        stale ``DOCKER_CONTEXT=colima`` from making GROBID appear unavailable.
        Tests and non-macOS environments retain the normal SDK behavior.
        """
        if not self._is_docker_socket_reachable():
            raise OSError("Docker daemon socket unreachable")
        desktop_socket = Path.home() / ".docker" / "run" / "docker.sock"
        if (
            desktop_socket.exists()
            and os.name == "posix"
            and sys.platform == "darwin"
            and (
                not isinstance(getattr(self, "_docker", None), __import__("types").ModuleType)
                or self._can_connect_unix_socket(desktop_socket)
            )
        ):
            return self._docker.DockerClient(
                base_url=f"unix://{desktop_socket}"
            )
        return self._docker.from_env()

    @property
    def status(self) -> GROBID_STATUS:
        """Lấy current GROBID status."""
        return self._status

    @property
    def is_available(self) -> bool:
        """True nếu GROBID đang available.

        Refreshes status by calling check_health() to ensure we detect
        if GROBID became available after initialization.
        """
        self.check_health()  # Refresh status
        return self._status == GROBID_STATUS.AVAILABLE

    @property
    def url(self) -> str:
        """GROBID API URL."""
        return (self._effective_url or self.config.url).rstrip("/")

    def check_health(self) -> GROBID_STATUS:
        """Check GROBID health qua /api/isalive endpoint.

        Returns:
            GROBID_STATUS enum value.
        """
        # Check Docker container status first (if Docker SDK available)
        container_status = self._check_container_status()

        if container_status == "running":
            # Container running, check API health
            return self._check_http_health()

        elif container_status == "exited":
            self._status = GROBID_STATUS.STOPPED

        elif container_status == "not_found":
            # Container not found via Docker SDK - try HTTP check anyway
            # (GROBID might be running without Docker SDK being able to detect it)
            logger.debug("Docker SDK cannot detect container, trying HTTP check")
            return self._check_http_health()

        else:
            # Docker SDK unavailable - try HTTP check directly
            # This allows GROBID to work even without Docker SDK
            logger.debug("Docker SDK unavailable, trying HTTP check")
            return self._check_http_health()

        return self._status

    def _check_http_health(self) -> GROBID_STATUS:
        """Check GROBID health via HTTP /api/isalive endpoint.

        Returns:
            GROBID_STATUS enum value.
        """
        try:
            response = requests.get(
                f"{self.url}/api/isalive",
                timeout=5,
                headers={"Connection": "close"},
            )
            try:
                if response.status_code == 200:
                    self._status = GROBID_STATUS.AVAILABLE
                else:
                    self._status = GROBID_STATUS.UNHEALTHY
            finally:
                close_fn = getattr(response, "close", None)
                if callable(close_fn):
                    close_fn()
        except requests.exceptions.ConnectionError:
            self._status = GROBID_STATUS.UNHEALTHY
        except requests.exceptions.Timeout:
            self._status = GROBID_STATUS.UNHEALTHY
        except Exception as exc:
            logger.warning("GROBID health check failed: %s", exc)
            self._status = GROBID_STATUS.UNHEALTHY

        return self._status

    @staticmethod
    def _close_docker_client(client: object | None) -> None:
        if client is None:
            return
        api_obj = getattr(client, "api", None)
        api_close = getattr(api_obj, "close", None)
        if callable(api_close):
            try:
                api_close()
            except Exception:
                pass
        close_fn = getattr(client, "close", None)
        if callable(close_fn):
            try:
                close_fn()
            except Exception:
                pass

    def _check_container_status(self) -> str:
        """Check Docker container status.

        Returns:
            'running', 'exited', 'not_found', or 'unavailable'
        """
        if not hasattr(self, "_docker") or not self._is_docker_socket_reachable():
            return "unavailable"

        client = None
        try:
            client = self._docker_client()
            container = client.containers.get(self._container_name)
            with self._stats_lock:
                self.stats.container_id = container.id[:12]
            return str(container.status)
        except self._docker.errors.NotFound:
            return "not_found"
        except Exception as exc:
            logger.debug("Cannot check container status: %s", exc)
            return "unavailable"
        finally:
            self._close_docker_client(client)

    def is_container_running(self) -> bool:
        """Check nếu GROBID container đang chạy."""
        status = self._check_container_status()
        if status == "running":
            return True
        if status == "unavailable":
            return self._status == GROBID_STATUS.AVAILABLE
        return False

    def start(self, auto_cleanup: bool = True) -> bool:
        """Start GROBID Docker container.

        Args:
            auto_cleanup: Nếu True, đánh dấu container được start tự động
                          và có thể stop khi app shutdown.

        Returns:
            True nếu start thành công.
        """
        if self.is_container_running():
            logger.info("GROBID container already running")
            return True

        if not hasattr(self, "_docker") or not self._is_docker_socket_reachable():
            logger.error("Docker SDK or daemon not available - cannot start container")
            return False

        client = None
        try:
            client = self._docker_client()

            # Reuse existing stopped/exited container if present (avoids Docker 409 Conflict)
            try:
                existing = client.containers.get(self._container_name)
                logger.info(
                    "Starting existing GROBID container: %s (status: %s, id: %s)",
                    self._container_name,
                    existing.status,
                    existing.id[:12],
                )
                existing.start()
                with self._stats_lock:
                    self.stats.container_id = existing.id[:12]
                self._started_automatically = auto_cleanup
                self._status = GROBID_STATUS.STARTING
                return True
            except self._docker.errors.NotFound:
                pass

            # Pull image nếu chưa có
            try:
                client.images.get(self._image)
                logger.info("Using existing image: %s", self._image)
            except self._docker.errors.NotFound:
                logger.info("Pulling GROBID image: %s", self._image)
                client.images.pull(self._image)

            # Start container (bind strictly to loopback 127.0.0.1:8070; never expose Dropwizard admin :8071)
            logger.info("Starting GROBID container: %s", self._container_name)

            container = client.containers.run(
                self._image,
                detach=True,
                name=self._container_name,
                ports={"8070/tcp": ("127.0.0.1", 8070)},
                environment={
                    "JAVA_OPTS": f"-Xms256m -Xmx{self._memory} -XX:+UseG1GC -XX:MaxGCPauseMillis=200 -XX:+ExitOnOutOfMemoryError",
                },
                mem_limit=self._container_memory_limit,
                remove=False,  # Giữ container để reuse
            )

            with self._stats_lock:
                self.stats.container_id = container.id[:12]
            self._started_automatically = auto_cleanup
            self._status = GROBID_STATUS.STARTING

            logger.info(
                "GROBID container started: %s (id: %s)",
                self._container_name,
                container.id[:12],
            )
            return True

        except Exception as exc:
            logger.error("Failed to start GROBID container: %s", exc)
            self._status = GROBID_STATUS.UNKNOWN
            return False
        finally:
            self._close_docker_client(client)

    def stop(self) -> bool:
        """Stop GROBID Docker container.

        Returns:
            True nếu stop thành công.
        """
        if not hasattr(self, "_docker") or not self._is_docker_socket_reachable():
            return False

        client = None
        try:
            client = self._docker_client()
            container = client.containers.get(self._container_name)
            container.stop(timeout=30)
            logger.info("GROBID container stopped")
            self._status = GROBID_STATUS.STOPPED
            return True
        except self._docker.errors.NotFound:
            logger.info("GROBID container not found - already stopped")
            return True
        except Exception as exc:
            logger.error("Failed to stop GROBID container: %s", exc)
            return False
        finally:
            self._close_docker_client(client)

    def wait_until_ready(self, timeout: int | None = None) -> bool:
        """Wait cho GROBID API ready.

        Args:
            timeout: Timeout in seconds. Defaults to _health_timeout.

        Returns:
            True nếu GROBID ready trong timeout.
        """
        timeout = timeout or self._health_timeout
        waited = 0
        interval = 2

        logger.info("Waiting for GROBID to be ready (timeout: %ds)...", timeout)

        while waited < timeout:
            status = self.check_health()
            if status == GROBID_STATUS.AVAILABLE:
                logger.info("GROBID ready after %ds", waited)
                return True

            time.sleep(interval)
            waited += interval
            logger.debug("Waiting for GROBID... (%ds/%ds)", waited, timeout)

        logger.error(
            "GROBID not ready after %ds. Status: %s",
            timeout,
            self._status.value,
        )
        return False

    def process_pdf(self, pdf_path: str) -> str:
        """Process PDF qua GROBID API.

        Args:
            pdf_path: Path to PDF file.

        Returns:
            TEI XML string, or empty string if failed.
        """
        from integrity_checker.extraction.grobid_parser import call_grobid_fulltext

        with self._stats_lock:
            self.stats.total_requests += 1
            self.stats.last_used = time.time()

        effective_cfg = (
            self.config.model_copy(update={"url": self.url})
            if self._effective_url and hasattr(self.config, "model_copy")
            else self.config
        )

        try:
            tei_xml = call_grobid_fulltext(pdf_path, effective_cfg)
            if tei_xml:
                with self._stats_lock:
                    self.stats.successful_requests += 1
                return tei_xml
            else:
                with self._stats_lock:
                    self.stats.failed_requests += 1
                return ""
        except Exception as exc:
            logger.error("GROBID process_pdf failed: %s", exc)
            with self._stats_lock:
                self.stats.failed_requests += 1
            return ""

    def get_cache_path(self, pdf_path: str) -> Path:
        """Get cache file path cho PDF.

        Args:
            pdf_path: Path to PDF file.

        Returns:
            Path to cache file.
        """
        from integrity_checker.extraction.grobid_parser import (
            compute_sha256,
            compute_sha256_hash,
        )

        settings = get_settings()
        cache_dir = settings.paths.grobid_output_dir
        cache_dir.mkdir(parents=True, exist_ok=True)

        sha = compute_sha256(pdf_path)
        tei_coords = str(getattr(self.config, "tei_coordinates", "") or "").strip()
        if tei_coords:
            coords_sig = compute_sha256_hash(tei_coords)[:8]
            return cache_dir / f"{sha}.coords-{coords_sig}.tei.xml"
        return cache_dir / f"{sha}.tei.xml"

    def get_from_cache(self, pdf_path: str) -> str | None:
        """Get cached TEI XML cho PDF.

        Args:
            pdf_path: Path to PDF file.

        Returns:
            Cached TEI XML, or None if not cached.
        """
        if not self.config.cache_by_file_sha256:
            return None

        cache_path = self.get_cache_path(pdf_path)
        if cache_path.exists():
            try:
                content = cache_path.read_text(encoding="utf-8")
                with self._stats_lock:
                    self.stats.cache_hits += 1
                logger.debug("Cache hit for: %s", pdf_path)
                return content
            except Exception as exc:
                logger.warning("Failed to read cache: %s", exc)
                return None

        with self._stats_lock:
            self.stats.cache_misses += 1
        return None

    def save_to_cache(self, pdf_path: str, tei_xml: str) -> bool:
        """Save TEI XML to cache atomically via unique temp file.

        Args:
            pdf_path: Path to PDF file.
            tei_xml: TEI XML content.

        Returns:
            True nếu save thành công.
        """
        if not self.config.cache_by_file_sha256:
            return False

        cache_path = self.get_cache_path(pdf_path)
        temp_path = cache_path.with_name(f"{cache_path.name}.{uuid.uuid4().hex}.tmp")
        try:
            cache_path.parent.mkdir(parents=True, exist_ok=True)
            temp_path.write_text(tei_xml, encoding="utf-8")
            temp_path.replace(cache_path)
            logger.debug("Cached TEI XML for: %s", pdf_path)
            return True
        except Exception as exc:
            logger.warning("Failed to save cache: %s", exc)
            return False
        finally:
            if temp_path.exists():
                try:
                    temp_path.unlink()
                except OSError:
                    pass

    def invalidate_cache(self, pdf_path: str | None = None) -> int:
        """Invalidate cache.

        Args:
            pdf_path: Nếu provided, chỉ invalidate cache cho file này.
                      Nếu None, invalidate tất cả cache.

        Returns:
            Số files invalidated.
        """
        settings = get_settings()
        cache_dir = settings.paths.grobid_output_dir

        if not cache_dir.exists():
            return 0

        if pdf_path:
            from integrity_checker.extraction.grobid_parser import compute_sha256

            sha = compute_sha256(pdf_path)
            removed = 0
            for variant in cache_dir.glob(f"{sha}*.tei.xml"):
                variant.unlink()
                removed += 1
            return removed

        # Invalidate all
        count = 0
        for cache_file in cache_dir.glob("*.tei.xml"):
            cache_file.unlink()
            count += 1

        logger.info("Invalidated %d cache files", count)
        return count

    def get_stats(self) -> dict:
        """Get service statistics.

        Returns:
            Dict với stats.
        """
        with self._stats_lock:
            return {
                "status": self._status.value,
                "url": self.url,
                "container_name": self._container_name,
                "container_id": self.stats.container_id,
                "started_automatically": self._started_automatically,
                "stats": {
                    "total_requests": self.stats.total_requests,
                    "successful_requests": self.stats.successful_requests,
                    "failed_requests": self.stats.failed_requests,
                    "cache_hits": self.stats.cache_hits,
                    "cache_misses": self.stats.cache_misses,
                    "last_used": self.stats.last_used,
                },
            }


# --- Singleton ---

_grobid_manager_lock = threading.Lock()
_grobid_manager: GrobidServiceManager | None = None


def get_grobid_manager(
    config: GrobidConfig | None = None,
    auto_start: bool = False,
) -> GrobidServiceManager:
    """Get singleton GROBID service manager.

    Args:
        config: Optional GrobidConfig. Defaults to settings.extraction.grobid.
        auto_start: Nếu True và GROBID chưa available, tự động start.

    Returns:
        GrobidServiceManager instance.
    """
    global _grobid_manager

    with _grobid_manager_lock:
        if _grobid_manager is None:
            resolved_cfg = config
            if resolved_cfg is None:
                settings = get_settings()
                resolved_cfg = settings.extraction.grobid
            _grobid_manager = GrobidServiceManager(config=resolved_cfg)
        manager = _grobid_manager

    if auto_start and not manager.is_available:
        if manager.start():
            manager.wait_until_ready()

    return manager


def reset_grobid_manager() -> None:
    """Reset singleton (for testing)."""
    global _grobid_manager
    with _grobid_manager_lock:
        _grobid_manager = None
