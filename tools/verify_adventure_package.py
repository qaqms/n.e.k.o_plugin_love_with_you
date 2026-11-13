"""Check a built adventure package against the current plugin sources."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys
import tomllib
import zipfile


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser()
    parser.add_argument("package", type=Path)
    parser.add_argument("--host", type=Path, default=root.parent / "N.E.K.O")
    args = parser.parse_args()
    sys.path.insert(0, str(args.host))
    from plugin.neko_plugin_cli.core import inspect_package

    expected = tomllib.loads((root / "plugin.toml").read_text(encoding="utf-8"))["plugin"]["version"]
    inspected = inspect_package(args.package)
    assert inspected.payload_hash_verified is True
    assert inspected.version == expected
    required = {
        "_adventure.py", "_adventure_skills.py", "static/adventure.mjs", "static/skills.json",
        "static/skills-v2.json", "static/skills.mjs", "static/combat.mjs", "static/frost.mjs",
        "static/study.mjs", "static/icons.mjs", "static/index.html", "static/adventure.css",
        "docs/adventure-frost-2026-11-12.md",
    }
    compared = set()
    with zipfile.ZipFile(args.package) as archive:
        assert archive.testzip() is None
        manifest = next(name for name in archive.namelist()
                        if name.startswith("payload/plugins/") and name.endswith("/plugin.toml"))
        prefix = manifest.removesuffix("plugin.toml")
        for member in archive.infolist():
            if member.is_dir() or not member.filename.startswith(prefix):
                continue
            relative = member.filename.removeprefix(prefix)
            assert not any(part in {"tests", "tools", "dist", "__pycache__", "node_modules"}
                           for part in Path(relative).parts)
            source = (root / relative).resolve()
            assert source.is_relative_to(root)
            if relative == "plugin.meta.json":
                assert isinstance(json.loads(archive.read(member)), dict)
                continue
            assert source.read_bytes() == archive.read(member), relative
            compared.add(relative)
    assert required <= compared
    print(json.dumps({
        "version": inspected.version, "payload_hash_verified": True, "crc_verified": True,
        "source_files_compared": len(compared), "bytes": args.package.stat().st_size,
        "sha256": hashlib.sha256(args.package.read_bytes()).hexdigest(),
    }, indent=2))


if __name__ == "__main__":
    main()
