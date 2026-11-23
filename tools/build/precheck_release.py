"""Run the host's Market precheck on the files that a clean checkout contains."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from host_root import default_host

ROOT = Path(__file__).resolve().parents[2]


def source_files() -> list[str]:
    """Tracked and non-ignored files; a folder copied without .git is read through a throwaway index."""
    command = ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"]
    if (ROOT / ".git").exists():
        listed = subprocess.run(command, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True).stdout
    else:
        with tempfile.TemporaryDirectory(prefix="love-precheck-index-") as index:
            subprocess.run(["git", "init", "-q", "--bare", index], check=True)
            listed = subprocess.run(
                ["git", f"--git-dir={index}", f"--work-tree={ROOT}", *command[1:]],
                cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True,
            ).stdout
    return sorted({name for name in listed.decode("utf-8").split("\0") if name})


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", type=Path, default=default_host())
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    host = args.host.resolve(strict=True)
    output = ROOT / "dist" / "precheck"
    files = source_files()
    with tempfile.TemporaryDirectory(prefix="love-market-precheck-") as temporary:
        parent = Path(temporary).resolve()
        assert parent.parent == Path(tempfile.gettempdir()).resolve()
        assert parent.name.startswith("love-market-precheck-")
        source = parent / "love_with_you"
        source.mkdir()
        for name in files:
            original = ROOT / name
            target = source / name
            if not original.is_file():
                continue
            if original.is_symlink() or not original.resolve().is_relative_to(ROOT):
                raise ValueError(f"Source path is not a normal repository file: {name}")
            if not target.resolve().is_relative_to(source):
                raise ValueError(f"Invalid export path: {name}")
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(original, target)
        environment = {
            **os.environ,
            "PYTHONDONTWRITEBYTECODE": "1",
            "PYTHONIOENCODING": "utf-8",
            "PYTHONUTF8": "1",
            "PYTHONPATH": str(host),
            "PYTEST_ADDOPTS": f'-p no:cacheprovider --basetemp="{(parent / "pytest-data").as_posix()}"',
        }
        completed = subprocess.run(
            [
                sys.executable, "-B", "-m", "plugin.neko_plugin_cli", "precheck", str(source),
                "--target-dir", str(output), "--json",
            ],
            cwd=source, env=environment, text=True, encoding="utf-8",
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        lines = completed.stdout.strip().splitlines()
        if not lines:
            raise RuntimeError(f"Market precheck produced no report: {completed.stderr}")
        report = json.loads(lines[-1])
        report["source_export_files"] = len(files)
        report["source_export_uses_gitignore"] = True
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({
            "passed": report["passed"], "source_export_files": len(files),
            "ruff_version": report["ruff_version"],
            "stages": [{"name": stage["name"], "passed": stage["passed"]} for stage in report["stages"]],
            "report": str(args.report),
        }, indent=2))
        if completed.returncode:
            for stage in report["stages"]:
                if not stage["passed"]:
                    print(stage["output"][-12000:], file=sys.stderr)
        raise SystemExit(completed.returncode)


if __name__ == "__main__":
    main()
