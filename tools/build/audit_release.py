"""Redacted secret and runtime-data checks for tracked files, history and packages.

These conservative patterns detect common credential formats and literal secret
assignments; a clean report cannot prove the absence of every possible secret.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import subprocess
import zipfile
from collections import Counter
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[2]
SIGNATURES = {
    "private-key": rb"-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----",
    "api-token": rb"\bsk-(?:proj-|ant-api\d+-)?[A-Za-z0-9_-]{20,}",
    "github-token": rb"\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})",
    "aws-access-key": rb"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b",
    "google-api-key": rb"\bAIza[A-Za-z0-9_-]{35}\b",
    "slack-token": rb"\bxox[baprs]-[A-Za-z0-9-]{20,}",
    "gitlab-token": rb"\bglpat-[A-Za-z0-9_-]{20,}",
    "npm-token": rb"\bnpm_[A-Za-z0-9]{36}\b",
    "telegram-token": rb"\b\d{8,10}:[A-Za-z0-9_-]{35}\b",
    "jwt": rb"\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}",
    "credential-url": rb"https?://[^/\s:@]+:[^/\s@]{4,}@",
}
ASSIGNMENT = re.compile(
    rb"""(?i)\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|secret[_-]?key|password|token)"""
    rb"""['"]?\s*[:=]\s*['"]([^'"\r\n]{16,200})['"]"""
)
RUNTIME_FILE = re.compile(
    r"(?i)^(?:(?:state|adventure)(?:[.-].*)?|appearance|portraits)\.json$"
)
PRIVATE_FILE = re.compile(
    r"(?i)(?:\.log|\.bak|\.backup(?:\..*)?|\.db|\.sqlite\d*|\.pem|\.key|\.p12|\.pfx)$"
)
FORBIDDEN_DIRS = {
    ".git", ".github", ".vscode", ".idea", "archive", "dist", "tools", "tests",
    "__pycache__", ".pytest_cache", ".ruff_cache", "node_modules", ".build-env",
    "data", "saves", "custom_portraits",
}
ROOT_FILES = {
    "__init__.py", "plugin.toml", "plugin.meta.json", "pyproject.toml",
    "README.md", "config.example.toml",
}
RUNTIME_DIRS = {"backend", "ui", "static", "assets", "i18n", "vendor"}


def sensitive_path(name: str) -> bool:
    path = PurePosixPath(name.replace("\\", "/"))
    return bool(
        RUNTIME_FILE.fullmatch(path.name) or PRIVATE_FILE.search(path.name)
        or path.name in {"config.toml", "plugin.config.toml"}
        or path.name == ".env" or path.name.startswith(".env.") and path.name != ".env.example"
        or {"data", "saves", "custom_portraits"}.intersection(path.parts)
    )


def package_path_allowed(name: str) -> bool:
    path = PurePosixPath(name)
    if not path.parts or path.is_absolute() or ".." in path.parts or "\\" in name:
        return False
    if FORBIDDEN_DIRS.intersection(path.parts) or sensitive_path(name):
        return False
    return (
        name in ROOT_FILES or path.parts[0] in RUNTIME_DIRS
        or name in {"docs/guide.md", "docs/gifts.md"}
    )


def scan_bytes(content: bytes, location: str) -> list[dict]:
    findings = []
    matches = []
    for rule, pattern in SIGNATURES.items():
        matches.extend((rule, match) for match in re.finditer(pattern, content))
    for match in ASSIGNMENT.finditer(content):
        value = match[1]
        if re.search(rb"(?i)example|placeholder|dummy|your[_-]|test[_-]|fake[_-]", value):
            continue
        counts = Counter(value)
        entropy = -sum(count / len(value) * math.log2(count / len(value)) for count in counts.values())
        if entropy >= 3.5 and re.fullmatch(rb"[A-Za-z0-9_./+=$!@-]+", value):
            matches.append(("literal-secret-review", match))
    for rule, match in matches:
        findings.append({
            "rule": rule, "location": location,
            "line": content.count(b"\n", 0, match.start()) + 1,
            "fingerprint": hashlib.sha256(match.group()).hexdigest()[:12],
        })
    return findings


def git(*args: str, input_data: bytes | None = None) -> bytes:
    return subprocess.run(
        ["git", *args], cwd=ROOT, input=input_data, stdout=subprocess.PIPE,
        stderr=subprocess.PIPE, check=True,
    ).stdout


def scan_history() -> tuple[list[dict], int, int]:
    objects = {}
    for line in git("rev-list", "--objects", "--all").decode("utf-8").splitlines():
        object_id, _, name = line.partition(" ")
        objects[object_id] = name
    response = git("cat-file", "--batch", input_data="".join(f"{oid}\n" for oid in objects).encode())
    findings, offset, blobs = [], 0, 0
    while offset < len(response):
        end = response.index(b"\n", offset)
        object_id, kind, length = response[offset:end].split()
        offset = end + 1
        length = int(length)
        content = response[offset:offset + length]
        offset += length + 1
        if kind != b"blob":
            continue
        blobs += 1
        oid = object_id.decode()
        location = f"git:{oid}:{objects[oid]}"
        findings.extend(scan_bytes(content, location))
        if sensitive_path(objects[oid]):
            findings.append({"rule": "historical-runtime-or-private-file", "location": location})
    return findings, blobs, int(git("rev-list", "--count", "--all"))


def scan_package(path: Path) -> tuple[list[dict], int]:
    findings, files = [], 0
    with zipfile.ZipFile(path) as archive:
        for member in archive.infolist():
            if member.is_dir():
                continue
            location = f"package:{member.filename}"
            findings.extend(scan_bytes(archive.read(member), location))
            prefix = "payload/plugins/love_with_you/"
            if member.filename.startswith(prefix):
                files += 1
                relative = member.filename.removeprefix(prefix)
                if not package_path_allowed(relative):
                    findings.append({"rule": "unexpected-package-file", "location": location})
    return findings, files


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--history", action="store_true")
    parser.add_argument("--package", type=Path)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    findings = []
    tracked = sorted({
        name for name in git("ls-files", "--cached", "--others", "--exclude-standard", "-z")
        .decode("utf-8").split("\0") if name
    })
    for name in tracked:
        path = ROOT / name
        if path.is_file():
            findings.extend(scan_bytes(path.read_bytes(), f"source:{name}"))
        if sensitive_path(name):
            findings.append({"rule": "tracked-runtime-or-private-file", "location": f"source:{name}"})
    report = {"tracked_files": len(tracked), "findings": findings}
    if args.history:
        historical, blobs, commits = scan_history()
        findings.extend(historical)
        report.update(history_blobs=blobs, history_commits=commits)
    if args.package:
        packaged, files = scan_package(args.package)
        findings.extend(packaged)
        report["package_files"] = files
    report["passed"] = not findings
    encoded = json.dumps(report, indent=2, ensure_ascii=True) + "\n"
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(encoded, encoding="utf-8")
    print(encoded, end="")
    raise SystemExit(0 if report["passed"] else 1)


if __name__ == "__main__":
    main()
