#!/usr/bin/env python3
"""
Automated Semantic Versioning (SemVer 2.0.0) & Build Date updater for CITRA.

Follows Conventional Commits specification (https://www.conventionalcommits.org):
  - BREAKING CHANGE / <type>!: -> MAJOR bump (X+1.0.0)
  - feat:                      -> MINOR bump (X.Y+1.0)
  - fix: / perf: / refactor:   -> PATCH bump (X.Y.Z+1)
  - chore: / docs: / test: ... -> No version bump

Synchronizes version across:
  1. web/src/version.ts (APP_VERSION & APP_BUILD_DATE used in UI)
  2. web/package.json
  3. package.json
  4. pyproject.toml
  5. src/integrity_checker/__version__.py
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
WEB_VERSION_TS = ROOT_DIR / "web" / "src" / "version.ts"
WEB_PACKAGE_JSON = ROOT_DIR / "web" / "package.json"
ROOT_PACKAGE_JSON = ROOT_DIR / "package.json"
PYPROJECT_TOML = ROOT_DIR / "pyproject.toml"
PY_VERSION_FILE = ROOT_DIR / "src" / "integrity_checker" / "__version__.py"
README_MD = ROOT_DIR / "README.md"
CLAUDE_MD = ROOT_DIR / "CLAUDE.md"
BENCHMARK_REPORT_MD = ROOT_DIR / "docs" / "reports" / "BENCHMARK_120K_NEURO_SYMBOLIC_REPORT.md"

VERSION_FILES = [
    WEB_VERSION_TS,
    WEB_PACKAGE_JSON,
    ROOT_PACKAGE_JSON,
    PYPROJECT_TOML,
    PY_VERSION_FILE,
    README_MD,
    CLAUDE_MD,
    BENCHMARK_REPORT_MD,
]

CONVENTIONAL_HEADER_RE = re.compile(
    r"^(?P<type>[a-zA-Z]+)(?:\([^)]+\))?(?P<breaking>!)?:\s+.+"
)
BREAKING_FOOTER_RE = re.compile(r"(?m)^BREAKING[ -]CHANGE:\s+.+")
SEMVER_RE = re.compile(r"^(\d+)\.(\d+)\.(\d+)$")


def get_current_version() -> str:
    """Read current APP_VERSION from web/src/version.ts."""
    if WEB_VERSION_TS.exists():
        content = WEB_VERSION_TS.read_text(encoding="utf-8")
        match = re.search(r"APP_VERSION\s*=\s*['\"](\d+\.\d+\.\d+)['\"]", content)
        if match:
            return match.group(1)
    if WEB_PACKAGE_JSON.exists():
        data = json.loads(WEB_PACKAGE_JSON.read_text(encoding="utf-8"))
        return str(data.get("version", "3.1.18"))
    return "3.1.18"


def parse_semver(version: str) -> tuple[int, int, int]:
    match = SEMVER_RE.match(version.strip())
    if not match:
        raise ValueError(f"Invalid SemVer string: {version!r}")
    return int(match.group(1)), int(match.group(2)), int(match.group(3))


def bump_semver(version: str, bump_type: str) -> str:
    major, minor, patch = parse_semver(version)
    if bump_type == "major":
        return f"{major + 1}.0.0"
    if bump_type == "minor":
        return f"{major}.{minor + 1}.0"
    if bump_type == "patch":
        return f"{major}.{minor}.{patch + 1}"
    raise ValueError(f"Unknown bump type: {bump_type!r}")


def detect_bump_from_message(message: str) -> str | None:
    """Return 'major', 'minor', 'patch', or None based on Conventional Commits."""
    lines = [line.strip() for line in message.strip().splitlines() if line.strip()]
    if not lines:
        return None

    header = lines[0]
    match = CONVENTIONAL_HEADER_RE.match(header)
    if not match:
        return None

    commit_type = match.group("type").lower()
    is_breaking = bool(match.group("breaking")) or bool(BREAKING_FOOTER_RE.search(message))

    if is_breaking:
        return "major"
    if commit_type == "feat":
        return "minor"
    if commit_type in {"fix", "perf", "refactor"}:
        return "patch"
    return None


def update_all_version_files(new_version: str, build_date: str) -> None:
    """Write new_version and build_date across all project manifests and UI config."""
    parse_semver(new_version)

    # 1. web/src/version.ts
    if WEB_VERSION_TS.exists():
        text = WEB_VERSION_TS.read_text(encoding="utf-8")
        text = re.sub(
            r"(export const APP_VERSION\s*=\s*['\"])[^'\"]+(['\"];)",
            rf"\g<1>{new_version}\2",
            text,
        )
        text = re.sub(
            r"(export const APP_BUILD_DATE\s*=\s*['\"])[^'\"]+(['\"];)",
            rf"\g<1>{build_date}\2",
            text,
        )
        WEB_VERSION_TS.write_text(text, encoding="utf-8")

    # 2. web/package.json & package.json
    for pkg_path in (WEB_PACKAGE_JSON, ROOT_PACKAGE_JSON):
        if pkg_path.exists():
            text = pkg_path.read_text(encoding="utf-8")
            text = re.sub(
                r'("version"\s*:\s*")[^"]+(")',
                rf"\g<1>{new_version}\2",
                text,
                count=1,
            )
            pkg_path.write_text(text, encoding="utf-8")

    # 3. pyproject.toml
    if PYPROJECT_TOML.exists():
        text = PYPROJECT_TOML.read_text(encoding="utf-8")
        text = re.sub(
            r'(?m)^(version\s*=\s*")[^"]+(")',
            rf"\g<1>{new_version}\2",
            text,
            count=1,
        )
        PYPROJECT_TOML.write_text(text, encoding="utf-8")

    # 4. src/integrity_checker/__version__.py
    if PY_VERSION_FILE.exists():
        text = PY_VERSION_FILE.read_text(encoding="utf-8")
        text = re.sub(
            r'(__version__\s*=\s*")[^"]+(")',
            rf"\g<1>{new_version}\2",
            text,
            count=1,
        )
        PY_VERSION_FILE.write_text(text, encoding="utf-8")

    # 5. README.md & CLAUDE.md (enforced by test_wave3_eval_scripts_and_configs.py)
    if README_MD.exists():
        text = README_MD.read_text(encoding="utf-8")
        text = re.sub(
            r"(Essay Integrity Checker v)\d+\.\d+\.\d+",
            rf"\g<1>{new_version}",
            text,
        )
        text = re.sub(
            r"(Python package metadata \(v)\d+\.\d+\.\d+(\))",
            rf"\g<1>{new_version}\2",
            text,
        )
        README_MD.write_text(text, encoding="utf-8")

    if CLAUDE_MD.exists():
        text = CLAUDE_MD.read_text(encoding="utf-8")
        text = re.sub(
            r"(?m)^(-\s*\*\*Version:\*\*\s*v)\d+\.\d+\.\d+",
            rf"\g<1>{new_version}",
            text,
            count=1,
        )
        text = re.sub(
            r"(\(v)\d+\.\d+\.\d+(\s*—\s*)\d{4}-\d{2}-\d{2}(\))",
            rf"\g<1>{new_version}\g<2>{build_date}\3",
            text,
        )
        CLAUDE_MD.write_text(text, encoding="utf-8")

    if BENCHMARK_REPORT_MD.exists():
        text = BENCHMARK_REPORT_MD.read_text(encoding="utf-8")
        text = re.sub(
            r"(Essay Integrity Checker v)\d+\.\d+\.\d+",
            rf"\g<1>{new_version}",
            text,
        )
        BENCHMARK_REPORT_MD.write_text(text, encoding="utf-8")


def _git_output(*args: str) -> str:
    res = subprocess.run(
        ["git", *args],
        cwd=ROOT_DIR,
        capture_output=True,
        text=True,
        check=False,
    )
    return res.stdout.strip() if res.returncode == 0 else ""


def _version_already_changed_in_head() -> bool:
    """Return True if HEAD already manually modified APP_VERSION compared to HEAD~1."""
    prev_content = _git_output("show", "HEAD~1:web/src/version.ts")
    if not prev_content:
        return False
    prev_match = re.search(r"APP_VERSION\s*=\s*['\"](\d+\.\d+\.\d+)['\"]", prev_content)
    if not prev_match:
        return False
    return prev_match.group(1) != get_current_version()


def handle_post_commit() -> int:
    if os.environ.get("CITRA_SKIP_VERSION_BUMP") == "1":
        return 0

    git_dir = ROOT_DIR / ".git"
    for state_marker in ("MERGE_HEAD", "REBASE_HEAD", "CHERRY_PICK_HEAD", "rebase-merge", "rebase-apply"):
        if (git_dir / state_marker).exists():
            return 0

    if _version_already_changed_in_head():
        return 0

    commit_msg = _git_output("log", "-1", "--pretty=%B")
    bump_type = detect_bump_from_message(commit_msg)
    if not bump_type:
        return 0

    current_version = get_current_version()
    new_version = bump_semver(current_version, bump_type)
    build_date = dt.date.today().isoformat()

    update_all_version_files(new_version, build_date)

    rel_paths = [str(p.relative_to(ROOT_DIR)) for p in VERSION_FILES if p.exists()]
    subprocess.run(["git", "add", "--", *rel_paths], cwd=ROOT_DIR, check=True)

    env = os.environ.copy()
    env["CITRA_SKIP_VERSION_BUMP"] = "1"
    subprocess.run(
        ["git", "commit", "--amend", "--no-edit", "--no-verify", "-q"],
        cwd=ROOT_DIR,
        env=env,
        check=True,
    )

    print(
        f"[SemVer] Auto-bumped version: {current_version} -> {new_version} ({bump_type.upper()}) | Build Date: {build_date}"
    )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="SemVer & Build Date automation for CITRA")
    parser.add_argument(
        "--post-commit",
        action="store_true",
        help="Run in Git post-commit hook mode (inspects HEAD commit message and amends version)",
    )
    parser.add_argument(
        "--bump",
        choices=["major", "minor", "patch"],
        help="Manually bump version by major, minor, or patch",
    )
    parser.add_argument(
        "--set",
        dest="set_version",
        help="Explicitly set version (e.g. 3.1.18)",
    )
    parser.add_argument(
        "--date",
        dest="build_date",
        default=dt.date.today().isoformat(),
        help="Build date in YYYY-MM-DD format (defaults to today)",
    )
    args = parser.parse_args()

    if args.post_commit:
        return handle_post_commit()

    current = get_current_version()
    if args.set_version:
        target = args.set_version
    elif args.bump:
        target = bump_semver(current, args.bump)
    else:
        print(f"Current version: {current}")
        return 0

    update_all_version_files(target, args.build_date)
    print(f"[SemVer] Updated version: {current} -> {target} | Build Date: {args.build_date}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
