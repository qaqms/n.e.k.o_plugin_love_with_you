"""Check a built adventure package against the current plugin sources."""

from __future__ import annotations

import argparse
import hashlib
import importlib
import json
import pkgutil
import sys
import tempfile
import tomllib
import zipfile
from pathlib import Path
from types import ModuleType


def smoke_backend(archive: zipfile.ZipFile, prefix: str) -> int:
    """Load only extracted code/data and exercise a synthetic pre-v13 save."""
    package_name = "_love_package_verification"
    assert package_name not in sys.modules
    with tempfile.TemporaryDirectory(prefix="love-package-check-") as temporary:
        root = Path(temporary) / "love_with_you"
        root.mkdir()
        for member in archive.infolist():
            if member.is_dir() or not member.filename.startswith(prefix):
                continue
            relative = Path(member.filename.removeprefix(prefix))
            if not (relative.parts[0] == "backend" and relative.suffix == ".py"
                    or relative.parent == Path("static") and relative.suffix == ".json"):
                continue
            target = (root / relative).resolve()
            assert target.is_relative_to(root)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(archive.read(member))
        package = ModuleType(package_name)
        package.__path__ = [str(root)]
        sys.modules[package_name] = package
        try:
            backend = importlib.import_module(f"{package_name}.backend")
            modules = [
                importlib.import_module(info.name)
                for info in pkgutil.walk_packages(backend.__path__, backend.__name__ + ".")
            ]
            assert all(Path(module.__file__).resolve().is_relative_to(root) for module in modules)
            paths = importlib.import_module(f"{package_name}.backend.paths")
            assert paths.STATIC_ROOT == root / "static"
            service = importlib.import_module(f"{package_name}.backend.adventure.service")
            assert service.RULES == 12 and service.VERSION == 13
            assert service.skills.CATALOGS[12] and len(service.journey.NODES) == 9
            state_file = service.StateFile(Path(temporary) / "data" / "adventure.json")
            store = service.AdventureStore(state_file)
            store.execute(
                "start", "package_start_001", 0, "package_client_001", store.epoch,
                {"character": "YUI", "player_class": "guardian", "companion_class": "mage", "rules": 11},
                character="YUI", stage_index=2,
            )
            legacy, warning = state_file.load()
            assert not warning
            legacy["version"] = 12
            state_file.save(legacy)
            original = state_file.path.read_bytes()
            reloaded = service.AdventureStore(state_file)
            assert not reloaded.error
            assert reloaded.view()["run"] == legacy["run"]
            assert reloaded.view()["economy"] == legacy["economy"]
            assert state_file.path.read_bytes() == original
            reloaded.execute(
                "claim", "package_claim_001", legacy["revision"], "package_client_001", reloaded.epoch,
                {"run_id": legacy["run"]["id"], "takeover": False}, character="YUI", stage_index=2,
            )
            backups = list(state_file.path.parent.glob("adventure.v12-*.backup.json"))
            assert len(backups) == 1 and backups[0].read_bytes() == original
            assert state_file.load()[0]["version"] == 13
            return len(modules)
        finally:
            for name in tuple(sys.modules):
                if name == package_name or name.startswith(package_name + "."):
                    del sys.modules[name]


def main() -> None:
    root = Path(__file__).resolve().parents[2]
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
        "__init__.py", "backend/__init__.py", "backend/paths.py",
        "backend/adventure/__init__.py", "backend/infrastructure/__init__.py",
        "backend/relationship/__init__.py", "backend/infrastructure/storage.py",
        "backend/infrastructure/json_codec.py", "backend/adventure/economy.py",
        "static/panel.html", "ui/companion-game.tsx",
        "backend/adventure/service.py", "backend/adventure/skills.py", "static/adventure.mjs", "static/skills.json",
        "static/skills-v2.json", "static/skills.mjs", "static/combat.mjs", "static/frost.mjs",
        "static/study.mjs", "static/icons.mjs", "static/index.html", "static/adventure.css",
        "static/encounters.json", "static/encounters.mjs", "static/encounter-rules.mjs",
        "static/journey.json", "static/journey.mjs", "static/journey-rules.mjs", "backend/adventure/journey.py",
        "static/mastery.json", "static/fire-art.mjs", "static/fire-line.json", "static/fire-line.mjs", "static/art/fx-fire-slash.jpg", "static/art/fx-lava-pool.png", "static/art/fx-hellfire.png", "static/art/fx-fire-bird.jpg", "static/ultimate.mjs", "static/art/ultimate-fire-cutin.jpg", "static/art/ult-fire-blast.jpg",
        "static/art/ult-fire-rune.jpg", "static/art/ult-fire-sun.jpg",
        "docs/adventure/adventure-frost-2026-11-12.md", "docs/adventure/adventure-encounters-2026-11-13.md",
        "static/actor-art.mjs", "static/companion-art.mjs", "static/art/companion-yui.png",
        "static/art/companion-yui-guardian.png", "static/art/companion-yui-mage.png", "static/forest-art.mjs", "static/battle-art.mjs",
        "docs/adventure/adventure-visual-sample-2026-11-13.md",
        "static/terrain-rules.mjs", "static/forest-map.mjs",
        "static/engine/astar-0.4.1.js", "static/engine/ASTAR-LICENSE.txt",
        "docs/adventure/adventure-map-2026-11-13.md",
        "static/skills-expanded.json", "static/routes.json", "static/expanded-combat.mjs",
        "docs/adventure/adventure-build-expansion-2026-11-13.md",
        "static/build-mods.json", "static/buildcraft.mjs",
        "docs/adventure/adventure-free-builds-2026-11-13.md",
        "static/fx-art.mjs", "static/zone-art.mjs", "static/foe-art.mjs",
        "static/art/foe-slime.png", "static/art/foe-wisp.png", "static/art/foe-brute.png",
        "static/art/foe-charger.png", "static/art/foe-caster.png", "static/art/foe-sentinel.png",
        "static/art/foe-oracle.png", "static/art/foe-boss.png",
        "static/art/player-traveller.png", "static/art/player-traveller-guardian.png", "static/art/player-traveller-mage.png",
        "docs/adventure/adventure-foe-sprites-2026-11-15.md",
        "docs/adventure/adventure-combat-feedback-2026-11-14.md",
    }
    required.update(path.relative_to(root).as_posix() for path in (root / "backend").rglob("*.py"))
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
            assert not any(part in {"tests", "tools", "dist", "archive", "__pycache__", "node_modules"}
                           for part in Path(relative).parts)
            assert not ("/" not in relative and relative.startswith("_") and relative != "__init__.py")
            source = (root / relative).resolve()
            assert source.is_relative_to(root)
            if relative == "plugin.meta.json":
                assert isinstance(json.loads(archive.read(member)), dict)
                continue
            assert source.read_bytes() == archive.read(member), relative
            compared.add(relative)
        loaded_modules = smoke_backend(archive, prefix)
    assert required <= compared
    print(json.dumps({
        "version": inspected.version, "payload_hash_verified": True, "crc_verified": True,
        "source_files_compared": len(compared), "bytes": args.package.stat().st_size,
        "extracted_backend_modules_loaded": loaded_modules, "synthetic_legacy_save_verified": True,
        "sha256": hashlib.sha256(args.package.read_bytes()).hexdigest(),
    }, indent=2))


if __name__ == "__main__":
    main()
