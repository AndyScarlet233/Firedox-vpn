#!/usr/bin/env python3
"""Fail closed when a public checkout contains obvious private artifacts."""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path

FORBIDDEN_PARTS = {
    ".dsh-uploads",
    "runtime",
    "tokens",
    "data",
    "export",
    "logs",
    "__pycache__",
}
FORBIDDEN_SUFFIXES = {
    ".bak",
    ".dll",
    ".exe",
    ".har",
    ".jwt",
    ".key",
    ".log",
    ".pem",
    ".pyc",
    ".pyd",
    ".so",
    ".zip",
}
SECRET_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("private key block", re.compile(r"-----BEGIN [A-Z0-9 ]+PRIVATE KEY-----")),
    ("JWT", re.compile(r"\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b")),
    ("64-character hex token", re.compile(r"(?<![A-Za-z0-9])[0-9a-fA-F]{64}(?![A-Za-z0-9])")),
    ("GitHub token", re.compile(r"\b(?:gh[pousr]|github_pat|glpat)-[A-Za-z0-9_-]{20,}\b", re.I)),
    ("AWS access key", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("absolute home path", re.compile(r"(?i)(?:[A-Z]:\\Users\\|/Users/|/home/)[^\s\"']+")),
)


def git_candidates(root: Path) -> list[Path]:
    try:
        completed = subprocess.run(
            ["git", "ls-files", "--cached", "--others", "--exclude-standard"],
            cwd=root,
            check=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
    except (OSError, subprocess.CalledProcessError):
        # A pre-commit checkout may not have a Git index yet. Ignore known
        # upload directories while still inspecting the rest of the tree.
        paths: list[Path] = []
        for current, dirs, names in os.walk(root):
            dirs[:] = [d for d in dirs if d not in {".git", ".dsh-uploads", "runtime"}]
            current_path = Path(current)
            paths.extend(current_path / name for name in names)
        return sorted(paths)
    return sorted(root / line for line in completed.stdout.splitlines() if line.strip())


def is_probably_text(path: Path) -> bool:
    try:
        sample = path.read_bytes()[:8192]
    except OSError:
        return False
    return b"\x00" not in sample


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    findings: list[tuple[str, str]] = []
    candidates = git_candidates(root)
    for path in candidates:
        try:
            relative = path.relative_to(root)
        except ValueError:
            continue
        parts = {part.lower() for part in relative.parts}
        for part in sorted(parts & FORBIDDEN_PARTS):
            findings.append((relative.as_posix(), f"forbidden path component: {part}"))
        if path.suffix.lower() in FORBIDDEN_SUFFIXES:
            findings.append((relative.as_posix(), f"forbidden artifact suffix: {path.suffix}"))
        if not path.is_file() or not is_probably_text(path):
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        # The scanner's own regex literals intentionally mention secret-like
        # markers and path fragments; do not treat that implementation as data.
        if relative.as_posix() == "scripts/audit_public_tree.py":
            continue
        for label, pattern in SECRET_PATTERNS:
            if pattern.search(text):
                findings.append((relative.as_posix(), f"possible {label}"))

    manifest = root / "extension" / "manifest.json"
    try:
        value = json.loads(manifest.read_text(encoding="utf-8"))
        if value.get("manifest_version") != 3:
            findings.append(("extension/manifest.json", "manifest_version is not 3"))
        if not value.get("name") or not value.get("version"):
            findings.append(("extension/manifest.json", "manifest name/version missing"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        findings.append(("extension/manifest.json", f"invalid manifest: {type(exc).__name__}"))

    if findings:
        print("Public tree audit failed:", file=sys.stderr)
        for path, reason in findings:
            # Never print matching lines: a real secret must not be echoed.
            print(f"- {path}: {reason}", file=sys.stderr)
        return 1

    print(f"Public tree audit passed ({len(candidates)} candidate files checked).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
