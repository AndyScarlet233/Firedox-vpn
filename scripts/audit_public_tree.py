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
    "build",
    "dist",
    "screenshots",
    "captures",
    "login_screenshots",
}
FORBIDDEN_SUFFIXES = {
    ".7z",
    ".bak",
    ".bz2",
    ".crt",
    ".der",
    ".dll",
    ".dylib",
    ".exe",
    ".gz",
    ".har",
    ".iso",
    ".jwt",
    ".key",
    ".log",
    ".msi",
    ".p12",
    ".pem",
    ".pfx",
    ".pyc",
    ".pyd",
    ".rar",
    ".so",
    ".tar",
    ".xz",
    ".zip",
}
ALLOWED_BINARY_SUFFIXES = {".gif", ".jpeg", ".jpg", ".png", ".svg", ".webp"}
BINARY_MAGICS = (
    (b"MZ", "PE/Windows executable"),
    (b"\x7fELF", "ELF executable"),
    (b"\xca\xfe\xba\xbe", "Mach-O executable"),
    (b"\xfe\xed\xfa\xce", "Mach-O executable"),
    (b"PK\x03\x04", "archive"),
)
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
            dirs[:] = [
                d
                for d in dirs
                if d not in {".git", ".dsh-uploads", "runtime", "build", "dist"}
            ]
            current_path = Path(current)
            paths.extend(current_path / name for name in names)
        return sorted(paths)
    return sorted(root / line for line in completed.stdout.splitlines() if line.strip())


def read_bytes(path: Path) -> bytes | None:
    try:
        return path.read_bytes()
    except OSError:
        return None


def inspect_content(relative: Path, raw: bytes) -> list[str]:
    """Return redacted finding labels without ever returning matching data."""
    findings: list[str] = []
    suffix = relative.suffix.lower()
    for magic, label in BINARY_MAGICS:
        if raw.startswith(magic):
            findings.append(f"binary magic: {label}")

    if b"\x00" in raw[:8192]:
        if suffix not in ALLOWED_BINARY_SUFFIXES:
            findings.append("binary or NUL-containing file")
        return findings
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        if suffix not in ALLOWED_BINARY_SUFFIXES:
            findings.append("binary or invalid UTF-8 file")
        return findings

    # The scanner's own regex literals intentionally mention secret-like
    # markers and path fragments; do not treat that implementation as data.
    if relative.as_posix() == "scripts/audit_public_tree.py":
        return findings
    for label, pattern in SECRET_PATTERNS:
        if pattern.search(text):
            findings.append(f"possible {label}")
    return findings


def inspect_relative_path(relative: Path) -> list[str]:
    reasons = [
        f"forbidden path component: {part}"
        for part in sorted({part.lower() for part in relative.parts} & FORBIDDEN_PARTS)
    ]
    if relative.suffix.lower() in FORBIDDEN_SUFFIXES:
        reasons.append(f"forbidden artifact suffix: {relative.suffix}")
    return reasons


def inspect_paths(root: Path, paths: list[Path]) -> list[tuple[str, str]]:
    findings: list[tuple[str, str]] = []
    for path in paths:
        try:
            relative = path.relative_to(root)
        except ValueError:
            continue
        findings.extend((relative.as_posix(), reason) for reason in inspect_relative_path(relative))
        if not path.is_file():
            continue
        raw = read_bytes(path)
        if raw is None:
            continue
        findings.extend((relative.as_posix(), reason) for reason in inspect_content(relative, raw))
    return findings


def inspect_history(root: Path) -> list[tuple[str, str]]:
    """Inspect reachable Git blobs so a removed secret cannot hide in history."""
    try:
        listed = subprocess.run(
            ["git", "rev-list", "--objects", "--all"],
            cwd=root,
            check=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
    except (OSError, subprocess.CalledProcessError):
        return []

    findings: list[tuple[str, str]] = []
    seen: set[str] = set()
    for line in listed.stdout.splitlines():
        fields = line.split(maxsplit=1)
        if len(fields) != 2 or fields[0] in seen:
            continue
        object_id, name = fields
        seen.add(object_id)
        try:
            object_type = subprocess.run(
                ["git", "cat-file", "-t", object_id],
                cwd=root,
                check=True,
                capture_output=True,
                text=True,
                encoding="ascii",
                errors="replace",
            ).stdout.strip()
            if object_type != "blob":
                continue
            raw = subprocess.run(
                ["git", "cat-file", "-p", object_id],
                cwd=root,
                check=True,
                capture_output=True,
            ).stdout
        except (OSError, subprocess.CalledProcessError):
            continue
        relative = Path(name)
        for reason in inspect_relative_path(relative):
            findings.append((relative.as_posix(), f"Git history: {reason}"))
        for reason in inspect_content(relative, raw):
            findings.append((relative.as_posix(), f"Git history: {reason}"))
    return findings


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    candidates = git_candidates(root)
    findings = inspect_paths(root, candidates)
    findings.extend(inspect_history(root))

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

    print(f"Public tree and reachable Git history audit passed ({len(candidates)} candidate files checked).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
