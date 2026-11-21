"""Regression & static verification suite for SE Holistic Audit Track 6 (DevOps, Configs & Docs).

Covers findings OPS-01, OPS-02, OPS-04..OPS-08, OPS-10..OPS-14:
- OPS-01: Reverse-proxy X-Forwarded-For spoofing & Uvicorn wildcard forwarded-allow-ips removal
- OPS-02: Zero-downtime CI/CD rollout (no `docker rm -f`), post-health image prune, PREV_TAG rollback,
          120s health loop, and `web.depends_on.api.condition: service_started`
- OPS-04: Dockerfile single-pass runtime apt-get (`fonts-dejavu-core`), no `TRANSFORMERS_CACHE`,
          `appuser:appgroup` ownership of `/app/src` after editable install, and `no-new-privileges:true`
- OPS-05: `.dockerignore` and `web/.dockerignore` build-context bloat exclusions & anchored negations
- OPS-06: `docker-compose.prod.yml` inline single-worker pinning (`--workers 1`) & README parity
- OPS-07: Nginx `Content-Security-Policy` on static locations (`always`), `X-Request-ID` propagation,
          HTTP `:80` non-loopback redirect to HTTPS, and `web/nginx.conf` CSP + auth `limit_req`
- OPS-08: CI `mypy src/integrity_checker`, `tsc -p tsconfig.e2e.json --noEmit`, 5-manifest SemVer parity,
          symmetric `SERPAPI_API_KEY` secret rotation, and dynamic GitHub repository URL
- OPS-10: `.env.example` dead `*_BASE_URL` removal & active env var parity, `docker-compose.yml`
          `APP_ENV=${APP_ENV:-development}`, and `configs/config*.yaml` metadata sync
- OPS-11: `README.md` production `/docs` & demo-account guidance accuracy
- OPS-12: Zero hardcoded `/Users/iannwendy` paths across `docs/architecture/*` & `docs/reports/*`,
          zero broken converted relative links, historical banners, and `TEACHER_SYSTEM.md` /
          `format_development_guide.md` accuracy
- OPS-13: 8 `CitationMappingStatus` & 68 `R-*` rule sync in `README.md`/`CLAUDE.md`, standalone
          inlined `.env.example` in `FinalReport_TDTU*/PhuLuc.tex`, and Vietnamese localization in
          `FinalReport_TDTU_VN/TaiLieuThamKhao.tex`
- OPS-14: `Makefile` `[dev,onnx]` + CPU torch + `.githooks` + `typecheck` + `clean`, `package.json`
          metadata (`private: true`, `license: MIT`, no `main`), and zero hardcoded Google OAuth
          Client ID fallbacks across Docker/Compose/CI files
"""

from __future__ import annotations

import json
import re
import subprocess
import tomllib
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[2]
LIVE_GOOGLE_CLIENT_ID_SUBSTR = "429053368516-7uia3j5uavajvbkhd7hq6lih9a65n22u"


class TestOps01ReverseProxyHardening:
    """OPS-01: Prevent X-Forwarded-For IP spoofing through Nginx & Uvicorn."""

    def test_prod_compose_removes_wildcard_forwarded_allow_ips(self) -> None:
        prod_compose_raw = (REPO_ROOT / "docker-compose.prod.yml").read_text(encoding="utf-8")
        assert '--forwarded-allow-ips="*"' not in prod_compose_raw
        assert "--forwarded-allow-ips=*" not in prod_compose_raw
        assert "--forwarded-allow-ips '*'" not in prod_compose_raw

        prod_cfg = yaml.safe_load(prod_compose_raw)
        api_cmd = str(prod_cfg["services"]["api"]["command"])
        if "--forwarded-allow-ips" in api_cmd:
            assert "127.0.0.1" in api_cmd

    def test_nginx_configs_overwrite_xff_with_remote_addr(self) -> None:
        for rel_path in ("web/nginx.conf", "web/nginx.prod.conf"):
            text = (REPO_ROOT / rel_path).read_text(encoding="utf-8")
            assert "$proxy_add_x_forwarded_for" not in text, (
                f"{rel_path} must not append untrusted client X-Forwarded-For headers"
            )
            xff_matches = re.findall(
                r"proxy_set_header\s+X-Forwarded-For\s+\$remote_addr;", text
            )
            expected_min = 3 if rel_path == "web/nginx.conf" else 6
            assert len(xff_matches) >= expected_min, (
                f"{rel_path} expected >= {expected_min} X-Forwarded-For $remote_addr directives, "
                f"found {len(xff_matches)}"
            )


class TestOps02AndOps08CiCdPipelineHardening:
    """OPS-02 & OPS-08: Zero-downtime rollout, rollback, post-health prune, typechecks & SemVer gate."""

    def test_ci_cd_zero_downtime_and_rollback_invariants(self) -> None:
        ci_text = (REPO_ROOT / ".github" / "workflows" / "ci-cd.yml").read_text(encoding="utf-8")
        # Parse valid YAML
        ci_yaml = yaml.safe_load(ci_text)
        assert "jobs" in ci_yaml

        # OPS-02.1: Never hard-kill running containers with `docker rm -f` before `compose up -d`
        assert "docker rm -f" not in ci_text

        # OPS-02.2: Capture sanitized PREV_TAG before overwriting CITRA_IMAGE_TAG, write .env
        # only AFTER `pull api web`, register EXIT trap for `docker logout`, and rollback cleanly
        assert "trap 'sudo docker logout ghcr.io" in ci_text
        assert "PREV_TAG=" in ci_text
        pull_idx = ci_text.index("docker compose -f docker-compose.prod.yml pull api web")
        write_tag_idx = ci_text.index('printf "GHCR_OWNER=%s\\nCITRA_IMAGE_TAG=%s\\n"')
        assert write_tag_idx > pull_idx, (
            "CITRA_IMAGE_TAG must be persisted to /opt/citra/.env only AFTER `pull api web` succeeds"
        )

        health_idx = ci_text.index("HEALTHY=0")
        prune_idx = ci_text.index("docker image prune -f")
        assert prune_idx > health_idx, "docker image prune -f must run AFTER healthcheck succeeds"

        failure_idx = ci_text.index('if [ "$HEALTHY" -ne 1 ]')
        rollback_tail = ci_text[failure_idx:prune_idx]
        assert "PREV_TAG" in rollback_tail, "Failed healthcheck branch must roll back to PREV_TAG"
        assert "docker compose -f docker-compose.prod.yml up -d" in rollback_tail
        assert '/^CITRA_IMAGE_TAG=/d' in rollback_tail, (
            "Fresh-VPS failed rollout (empty PREV_TAG) must remove unverified CITRA_IMAGE_TAG from .env"
        )
        assert "docker logout ghcr.io" not in ci_text[pull_idx:failure_idx], (
            "Must not run `docker logout` before rollback branch executes"
        )

        # OPS-02.3: Health timeout >= 120s (60 * 2s) to cover GROBID 120s start_period
        assert "seq 1 60" in ci_text

        # Validate bash -n syntax on the remote SSH heredoc script
        heredoc_match = re.search(r"<< 'EOF'\n(.*?)\n\s*EOF", ci_text, flags=re.DOTALL)
        assert heredoc_match is not None
        proc = subprocess.run(
            ["bash", "-n"],
            input=heredoc_match.group(1),
            text=True,
            capture_output=True,
            check=False,
        )
        assert proc.returncode == 0, f"SSH deploy heredoc failed bash -n:\n{proc.stderr}"

    def test_prod_compose_web_depends_on_api_service_started(self) -> None:
        prod_cfg = yaml.safe_load(
            (REPO_ROOT / "docker-compose.prod.yml").read_text(encoding="utf-8")
        )
        depends = prod_cfg["services"]["web"]["depends_on"]
        assert depends["api"]["condition"] == "service_started"

    def test_ci_cd_runs_mypy_e2e_tsc_semver_parity_and_symmetric_secret_rotation(self) -> None:
        ci_text = (REPO_ROOT / ".github" / "workflows" / "ci-cd.yml").read_text(encoding="utf-8")

        # OPS-08.1: Backend mypy & Frontend E2E tsconfig checks
        assert "mypy src/integrity_checker" in ci_text
        assert "tsc -p tsconfig.e2e.json --noEmit" in ci_text

        # OPS-08.2: 5-manifest SemVer parity gate in CI
        for manifest_tok in (
            "package.json",
            "web/package.json",
            "pyproject.toml",
            "src/integrity_checker/__version__.py",
            "web/src/version.ts",
        ):
            assert manifest_tok in ci_text, f"CI SemVer check missing {manifest_tok}"

        # OPS-08.3: Symmetric SERPAPI_API_KEY rotation (no `! grep -q "^SERPAPI_API_KEY=."` blocker)
        assert '! grep -q "^SERPAPI_API_KEY=."' not in ci_text
        assert "github.com/iannwendy/citra.git" not in ci_text

    def test_five_manifests_currently_in_semver_parity(self) -> None:
        root_pkg = json.loads((REPO_ROOT / "package.json").read_text(encoding="utf-8"))["version"]
        web_pkg = json.loads((REPO_ROOT / "web" / "package.json").read_text(encoding="utf-8"))[
            "version"
        ]
        pyproject_ver = tomllib.loads((REPO_ROOT / "pyproject.toml").read_text(encoding="utf-8"))[
            "project"
        ]["version"]
        py_ver_match = re.search(
            r'__version__\s*=\s*["\']([^"\']+)["\']',
            (REPO_ROOT / "src" / "integrity_checker" / "__version__.py").read_text(
                encoding="utf-8"
            ),
        )
        ts_ver_match = re.search(
            r"APP_VERSION\s*=\s*['\"]([^'\"]+)['\"]",
            (REPO_ROOT / "web" / "src" / "version.ts").read_text(encoding="utf-8"),
        )
        assert py_ver_match is not None and ts_ver_match is not None
        versions = {
            "package.json": root_pkg,
            "web/package.json": web_pkg,
            "pyproject.toml": pyproject_ver,
            "__version__.py": py_ver_match.group(1),
            "version.ts": ts_ver_match.group(1),
        }
        assert len(set(versions.values())) == 1, f"SemVer drift across manifests: {versions}"


class TestOps04Ops05Ops06Ops07ContainerAndNginxHardening:
    """OPS-04..OPS-07: Dockerfile, .dockerignore, Compose security_opt/workers & Nginx CSP/X-Request-ID."""

    def test_backend_dockerfile_hardening(self) -> None:
        dockerfile = (REPO_ROOT / "Dockerfile").read_text(encoding="utf-8")
        assert "TRANSFORMERS_CACHE" not in dockerfile

        # Runtime stage should run apt-get update only once (fonts-dejavu-core merged)
        runtime_stage = dockerfile.split("FROM python:3.11-slim AS runtime", maxsplit=1)[1]
        assert runtime_stage.count("apt-get update") == 1
        assert "fonts-dejavu-core" in runtime_stage

        # Editable install must leave /app/src (.egg-info) owned by appuser:appgroup
        editable_idx = runtime_stage.index("pip install --no-cache-dir --no-build-isolation --no-deps -e .")
        after_editable = runtime_stage[editable_idx:]
        assert re.search(r"chown\s+-R\s+appuser:appgroup\s+/app/src", after_editable)

        # Standalone image must bake trained 120K Neuro-Symbolic + Platt calibration weights
        assert (REPO_ROOT / "data" / "models" / "neuro_symbolic_weights.json").is_file()
        assert (
            "COPY --chown=appuser:appgroup data/models/neuro_symbolic_weights.json "
            "./data/models/neuro_symbolic_weights.json"
        ) in runtime_stage

    def test_prod_compose_security_opt_and_single_inline_worker(self) -> None:
        prod_raw = (REPO_ROOT / "docker-compose.prod.yml").read_text(encoding="utf-8")
        assert "UVICORN_WORKERS" not in prod_raw
        prod_cfg = yaml.safe_load(prod_raw)
        for svc_name in ("grobid", "api", "web"):
            sec_opts = prod_cfg["services"][svc_name].get("security_opt", [])
            assert "no-new-privileges:true" in sec_opts, (
                f"Service {svc_name} missing security_opt no-new-privileges:true"
            )
        api_cmd = str(prod_cfg["services"]["api"]["command"])
        assert "--workers 1" in api_cmd

    def test_dockerignore_excludes_bloat_and_anchors_negations(self) -> None:
        root_ignore = (REPO_ROOT / ".dockerignore").read_text(encoding="utf-8")
        for required_entry in (
            "**/__pycache__/",
            "**/*.py[cod]",
            "**/*$py.class",
            "**/*.so",
            "**/*.egg-info/",
            "**/.DS_Store",
            "graphify-out/",
            "FinalReport_TDTU/",
            "FinalReport_TDTU_VN/",
            ".superpowers/",
            "tests/",
            ".agents/",
            ".github/",
            ".githooks/",
            ".playwright-mcp/",
            "!/README.md",
            "!/requirements*.txt",
            "!/.env.example",
            "!/data/",
            "data/*",
            "!/data/models/",
            "data/models/*",
            "!/data/models/neuro_symbolic_weights.json",
        ):
            assert required_entry in root_ignore, f".dockerignore missing {required_entry}"
        assert "\ndata/\n" not in root_ignore, (
            ".dockerignore must use data/* + !/data/models/neuro_symbolic_weights.json, not bare data/"
        )

        web_ignore = (REPO_ROOT / "web" / ".dockerignore").read_text(encoding="utf-8")
        for required_web_entry in (
            "tests/",
            "*.md",
            "playwright.config*.ts",
            "vitest.config.ts",
            "tsconfig.e2e.json",
            "**/.DS_Store",
            "**/*.log",
            "**/*.tsbuildinfo",
        ):
            assert required_web_entry in web_ignore, f"web/.dockerignore missing {required_web_entry}"

    def test_nginx_prod_and_dev_csp_request_id_and_http_redirect(self) -> None:
        prod_conf = (REPO_ROOT / "web" / "nginx.prod.conf").read_text(encoding="utf-8")
        dev_conf = (REPO_ROOT / "web" / "nginx.conf").read_text(encoding="utf-8")

        # X-Request-ID correlation, deduplicated $citra_csp map & Permissions-Policy hide header
        for name, conf, expected_proxies in (
            ("nginx.prod.conf", prod_conf, 6),
            ("nginx.conf", dev_conf, 3),
        ):
            assert "$http_x_request_id" in conf, f"{name} missing $http_x_request_id map"
            assert 'map "" $citra_csp' in conf, f"{name} missing deduplicated $citra_csp map"
            assert "proxy_set_header X-Request-ID" in conf, f"{name} missing X-Request-ID proxy header"
            assert "Content-Security-Policy" in conf, f"{name} missing Content-Security-Policy"
            perm_hides = re.findall(r"proxy_hide_header\s+Permissions-Policy;", conf)
            assert len(perm_hides) == expected_proxies, (
                f"{name} expected {expected_proxies} `proxy_hide_header Permissions-Policy;`, "
                f"found {len(perm_hides)}"
            )

        # Static asset location blocks in nginx.prod.conf must preserve CSP + `always`
        assets_block = re.search(
            r"location\s+~\s+\^/\(assets\|fonts\|solva\|media\)/\s*\{([^}]*)\}",
            prod_conf,
            flags=re.DOTALL,
        )
        icons_block = re.search(
            r"location\s+~\*\s+\^/\(citra-logo\\\.png[^\{]*\{\s*([^}]*)\}",
            prod_conf,
            flags=re.DOTALL,
        )
        assert assets_block is not None and "Content-Security-Policy" in assets_block.group(1)
        assert "immutable\" always;" in assets_block.group(1)
        assert icons_block is not None and "Content-Security-Policy" in icons_block.group(1)

        # HTTP :80 default_server redirects non-loopback requests to HTTPS
        assert "if ($remote_addr != 127.0.0.1)" in prod_conf

        # Dev/container nginx.conf includes auth rate-limiting zone & location
        assert "limit_req_zone" in dev_conf
        assert "limit_req zone=citra_auth_limit" in dev_conf


class TestOps10ToOps14ConfigsDocsAndThesisParity:
    """OPS-10..OPS-14: Env/YAML configs, Makefile, package.json, Docs URI cleanup & LaTeX standalone."""

    def test_env_example_and_dev_compose_parity(self) -> None:
        env_example = (REPO_ROOT / ".env.example").read_text(encoding="utf-8")
        for dead_var in (
            "CROSSREF_BASE_URL",
            "OPENALEX_BASE_URL",
            "DBLP_BASE_URL",
            "ARXIV_BASE_URL",
            "OPENLIBRARY_BASE_URL",
            "EUROPEPMC_BASE_URL",
        ):
            assert dead_var not in env_example, f"Dead env var {dead_var} still in .env.example"

        for active_var in (
            "GROBID_URL=",
            "CORS_ALLOWED_ORIGINS=",
            "CITRA_WORKER_MODE=",
            "STRIPE_SECRET_KEY=",
            "VNPAY_RETURN_URL=",
            "NCBI_API_KEY=",
            "GITHUB_TOKEN=",
            "MAX_CONCURRENT_PIPELINES=",
            "SQLITE_JOURNAL_MODE=",
            "DEMO_USERS_ENABLED=",
        ):
            assert active_var in env_example, f"Active env var {active_var} missing from .env.example"

        dev_compose = (REPO_ROOT / "docker-compose.yml").read_text(encoding="utf-8")
        assert "APP_ENV=${APP_ENV:-development}" in dev_compose

        for cfg_name in ("config.yaml", "config.example.yaml"):
            cfg_txt = (REPO_ROOT / "configs" / cfg_name).read_text(encoding="utf-8")
            assert "(v3.76.0)" not in cfg_txt

    def test_makefile_package_json_and_zero_hardcoded_google_client_ids(self) -> None:
        makefile = (REPO_ROOT / "Makefile").read_text(encoding="utf-8")
        assert ".[dev,onnx]" in makefile
        assert "download.pytorch.org/whl/cpu" in makefile
        assert "core.hooksPath .githooks" in makefile
        assert "typecheck:" in makefile
        assert "mypy src/integrity_checker" in makefile
        assert "tsbuildinfo" in makefile
        assert "-m integration" not in makefile

        pkg = json.loads((REPO_ROOT / "package.json").read_text(encoding="utf-8"))
        assert pkg.get("private") is True
        assert pkg.get("license") == "MIT"
        assert "main" not in pkg

        for rel_file in (
            "web/Dockerfile",
            "docker-compose.yml",
            "docker-compose.prod.yml",
            ".github/workflows/ci-cd.yml",
        ):
            txt = (REPO_ROOT / rel_file).read_text(encoding="utf-8")
            assert LIVE_GOOGLE_CLIENT_ID_SUBSTR not in txt, (
                f"Hardcoded live Google OAuth Client ID found in {rel_file}"
            )

    def test_readme_and_claude_docs_accuracy(self) -> None:
        readme = (REPO_ROOT / "README.md").read_text(encoding="utf-8")
        claude = (REPO_ROOT / "CLAUDE.md").read_text(encoding="utf-8")

        # OPS-11: No broken https://citra.io.vn/docs links
        assert "https://citra.io.vn/docs" not in readme
        assert "citra.io.vn%2Fdocs" not in readme

        # OPS-06: Accurate prod compose description
        assert "Production Nginx + TLS + worker deployment stack" not in readme

        # OPS-13: 8 CitationMappingStatus values & 68 R-* rule IDs synced
        assert "8 link statuses" in readme
        assert "8 link statuses" in claude
        assert "`UNRESOLVED`" in claude
        assert "68" in readme and "68" in claude
        assert "`43+` Deterministic Symbolic Rules" not in readme

    def test_docs_architecture_and_reports_have_zero_machine_specific_paths(self) -> None:
        md_link_re = re.compile(r"\[([^\]]+)\]\(([^)]+)\)")
        tracked_files: set[str] | None = None
        if (REPO_ROOT / ".git").exists():
            git_ls = subprocess.run(
                ["git", "ls-files"],
                cwd=REPO_ROOT,
                capture_output=True,
                text=True,
                check=False,
            )
            if git_ls.returncode == 0 and git_ls.stdout.strip():
                tracked_files = set(git_ls.stdout.splitlines())

        for subdir in ("docs/architecture", "docs/reports"):
            dir_path = REPO_ROOT / subdir
            for md_file in sorted(dir_path.glob("*.md")):
                text = md_file.read_text(encoding="utf-8")
                assert "/Users/iannwendy" not in text, (
                    f"Hardcoded machine path found in {md_file.relative_to(REPO_ROOT)}"
                )
                assert "file://" not in text, (
                    f"file:// URI found in {md_file.relative_to(REPO_ROOT)}"
                )
                assert "https://citra.io.vn/docs" not in text, (
                    f"Broken prod Swagger link https://citra.io.vn/docs in {md_file.relative_to(REPO_ROOT)}"
                )
                for _label, target in md_link_re.findall(text):
                    if target.startswith(("http://", "https://", "mailto:", "#")):
                        continue
                    rel_part = target.split("#", maxsplit=1)[0].strip()
                    if not rel_part:
                        continue
                    resolved = (md_file.parent / rel_part).resolve()
                    assert resolved.exists(), (
                        f"Broken relative link in {md_file.relative_to(REPO_ROOT)}: {target}"
                    )
                    if tracked_files is not None and resolved.is_relative_to(REPO_ROOT):
                        rel_repo = resolved.relative_to(REPO_ROOT).as_posix()
                        is_tracked = rel_repo in tracked_files or any(
                            f.startswith(rel_repo + "/") for f in tracked_files
                        )
                        assert is_tracked, (
                            f"Untracked/gitignored relative link in {md_file.relative_to(REPO_ROOT)} "
                            f"(will fail in clean CI checkout): {target} -> {rel_repo}"
                        )

        # OPS-12 specific doc fixes
        teacher_doc = (REPO_ROOT / "docs" / "architecture" / "TEACHER_SYSTEM.md").read_text(
            encoding="utf-8"
        )
        assert "/api/citations/override" not in teacher_doc
        assert "/api/essays/{essay_id}/verdicts/{verdict_id}/override" in teacher_doc

        fmt_doc = (REPO_ROOT / "docs" / "architecture" / "format_development_guide.md").read_text(
            encoding="utf-8"
        )
        assert "from src.integrity_checker" not in fmt_doc
        assert "chưa đăng ký mặc định" not in fmt_doc

        for hist_name in (
            "SOURCELOGIC_CONCEPT.md",
            "PREMIUM_SUBSCRIPTION_PLAN.md",
            "PERFORMANCE_AND_SEO_OPTIMIZATION.md",
        ):
            hist_txt = (REPO_ROOT / "docs" / "architecture" / hist_name).read_text(encoding="utf-8")
            assert "> [!NOTE]" in hist_txt[:1200], (
                f"{hist_name} missing historical-design [!NOTE] banner near top"
            )

    def test_thesis_appendices_standalone_and_vietnamese_bibliography_localized(self) -> None:
        for thesis_dir in ("FinalReport_TDTU", "FinalReport_TDTU_VN"):
            phu_luc = (REPO_ROOT / thesis_dir / "PhuLuc.tex").read_text(encoding="utf-8")
            assert "../.env.example" not in phu_luc, (
                f"{thesis_dir}/PhuLuc.tex still uses fragile ../.env.example parent traversal"
            )
            assert r"label={app:env}" in phu_luc
            assert "DATABASE_URL=" in phu_luc

        vn_bib = (REPO_ROOT / "FinalReport_TDTU_VN" / "TaiLieuThamKhao.tex").read_text(
            encoding="utf-8"
        )
        assert "Accessed:" not in vn_bib
        assert "[Online]. Available:" not in vn_bib
        assert "[Trực tuyến]" in vn_bib

        en_phu_luc = (REPO_ROOT / "FinalReport_TDTU" / "PhuLuc.tex").read_text(encoding="utf-8")
        assert r"thirteen SHA-256 checksummed schema migrations (\texttt{0001}--\texttt{0013})" in en_phu_luc

    def test_conv05_configs_and_bilingual_theses_migration_status_test_count_and_semver_parity(
        self,
    ) -> None:
        py_ver_match = re.search(
            r'__version__\s*=\s*["\']([^"\']+)["\']',
            (REPO_ROOT / "src" / "integrity_checker" / "__version__.py").read_text(
                encoding="utf-8"
            ),
        )
        assert py_ver_match is not None
        expected_ver = py_ver_match.group(1)

        for cfg_name in ("config.yaml", "config.example.yaml"):
            cfg_txt = (REPO_ROOT / "configs" / cfg_name).read_text(encoding="utf-8")
            assert "3.89.5" not in cfg_txt, f"{cfg_name} still contains stale 3.89.5"
            assert f"(v{expected_ver})" in cfg_txt, (
                f"{cfg_name} missing current SemVer header (v{expected_ver})"
            )

        tex_names = (
            "chapter1_rewritten.tex",
            "chapter2_rewritten.tex",
            "chapter3_rewritten.tex",
            "chapter4_rewritten.tex",
            "chapter5_rewritten.tex",
            "chapter6_rewritten.tex",
            "PhuLuc.tex",
        )
        forbidden_substrings = (
            "0012",
            "3.89.5",
            "Yes (7)",
            "Có (7)",
            "twelve numbered",
            "twelve checksummed migrations",
            "12 checksummed migrations",
            "12 migrations",
            "12 bản di trú",
            "mười hai bản di trú",
            "2,197",
            "2.197",
            "2,203",
            "2.203",
            "472 ",
            "62 suites",
            "62 bộ",
            "2,689",
            "2.689",
        )

        for thesis_dir in ("FinalReport_TDTU", "FinalReport_TDTU_VN"):
            for tex_name in tex_names:
                tex_path = REPO_ROOT / thesis_dir / tex_name
                txt = tex_path.read_text(encoding="utf-8")
                for bad_tok in forbidden_substrings:
                    assert bad_tok not in txt, (
                        f"Stale token {bad_tok!r} found in {thesis_dir}/{tex_name}"
                    )
                assert expected_ver in txt, (
                    f"{thesis_dir}/{tex_name} missing synced SemVer {expected_ver}"
                )

            ch2 = (REPO_ROOT / thesis_dir / "chapter2_rewritten.tex").read_text(encoding="utf-8")
            expected_link_cell = (
                r"\textbf{Yes (8)}" if thesis_dir == "FinalReport_TDTU" else r"\textbf{Có (8)}"
            )
            assert expected_link_cell in ch2

            for mig_file in (
                "chapter1_rewritten.tex",
                "chapter3_rewritten.tex",
                "chapter5_rewritten.tex",
                "chapter6_rewritten.tex",
                "PhuLuc.tex",
            ):
                mig_txt = (REPO_ROOT / thesis_dir / mig_file).read_text(encoding="utf-8")
                assert r"\texttt{0001}--\texttt{0013}" in mig_txt, (
                    f"{thesis_dir}/{mig_file} missing \\texttt{{0001}}--\\texttt{{0013}}"
                )

            ch1 = (REPO_ROOT / thesis_dir / "chapter1_rewritten.tex").read_text(encoding="utf-8")
            ch5 = (REPO_ROOT / thesis_dir / "chapter5_rewritten.tex").read_text(encoding="utf-8")
            phu = (REPO_ROOT / thesis_dir / "PhuLuc.tex").read_text(encoding="utf-8")
            assert "2,320+" in ch1 and "487+" in ch1 and "63" in ch1
            assert "2,320+" in ch5 and "487+" in ch5 and "63" in ch5 and "2,827+" in ch5
            assert "487+" in phu and "63" in phu
            assert "VNPay v2.1.0" in phu
