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

from audit_release import package_path_allowed, scan_package
from host_root import default_host


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
            assert service.skills.CATALOGS[service.RULES] and len(service.journey.NODES) == 9
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
            assert state_file.load()[0]["version"] == service.VERSION
            return len(modules)
        finally:
            for name in tuple(sys.modules):
                if name == package_name or name.startswith(package_name + "."):
                    del sys.modules[name]


def main() -> None:
    root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser()
    parser.add_argument("package", type=Path)
    parser.add_argument("--host", type=Path, default=default_host())
    args = parser.parse_args()
    sys.path.insert(0, str(args.host))
    from plugin.neko_plugin_cli.core import inspect_package

    manifest_plugin = tomllib.loads((root / "plugin.toml").read_text(encoding="utf-8"))["plugin"]
    expected = manifest_plugin["version"]
    panel_entry = next(panel["entry"] for panel in manifest_plugin["ui"]["panel"] if panel["id"] == "main")
    assert panel_entry == f"static/panel-{expected}.html"
    inspected = inspect_package(args.package)
    assert inspected.payload_hash_verified is True
    assert inspected.version == expected
    required = {
        "__init__.py", "backend/__init__.py", "backend/paths.py",
        "backend/adventure/__init__.py", "backend/infrastructure/__init__.py",
        "backend/relationship/__init__.py", "backend/infrastructure/storage.py",
        "backend/infrastructure/json_codec.py", "backend/adventure/economy.py",
        panel_entry, "ui/companion-game.tsx", "ui/cottage.tsx", "ui/portrait-touch-presets.ts",
        "backend/adventure/service.py", "backend/adventure/skills.py", "static/adventure.mjs", "static/skills.json",
        "static/skills-v2.json", "static/skills.mjs", "static/combat.mjs", "static/frost.mjs",
        "static/study.mjs", "static/icons.mjs", "static/index.html", "static/adventure.css",
        "static/encounters.json", "static/encounters.mjs", "static/encounter-rules.mjs",
        "static/journey.json", "static/journey.mjs", "static/journey-rules.mjs", "backend/adventure/journey.py",
        "static/mastery.json", "static/fire-art.mjs", "static/fire-line.json", "static/fire-line.mjs", "static/art/fx-fire-slash.jpg", "static/art/fx-lava-pool.png", "static/art/fx-hellfire.png", "static/art/fx-fire-bird.jpg", "static/ultimate.mjs", "static/art/ultimate-fire-cutin.jpg", "static/art/ult-fire-blast.jpg",
        "static/art/ult-fire-rune.jpg", "static/art/ult-fire-sun.jpg",
        "static/flame-line.json", "static/flame-line.mjs", "static/art/fx-flame-wall.jpg", "static/art/fx-flame-orb.jpg",
        "static/art/fx-flame-domain.png", "static/art/fx-flame-pillar.jpg",
        "static/sword-line.json", "static/sword-line.mjs", "static/sword-art.mjs", "static/art/ultimate-sword-cutin.jpg",
        "static/art/fx-sword-line.jpg", "static/art/fx-sword-ring.jpg", "static/art/fx-sword-wave.jpg", "static/art/fx-sword-sever.jpg",
        "static/art/fx-sword-phantom.jpg", "static/art/fx-sword-blade.jpg",
        "static/art/map-edge-ground.jpg", "static/art/map-edge-tree.png", "static/art/map-edge-rock.png", "static/art/map-edge-rubble.png", "static/art/map-edge-wall.png", "static/art/map-edge-column.png",
        "static/art/map-ruin-ground.jpg", "static/art/map-ruin-tree.png", "static/art/map-ruin-rock.png", "static/art/map-ruin-rubble.png", "static/art/map-ruin-wall.png", "static/art/map-ruin-column.png",
        "static/art/map-deep-ground.jpg", "static/art/map-deep-tree.png", "static/art/map-deep-rock.png", "static/art/map-deep-rubble.png", "static/art/map-deep-wall.png", "static/art/map-deep-column.png",
        "static/art/map-boss-ground.jpg", "static/art/map-boss-tree.png", "static/art/map-boss-rock.png", "static/art/map-boss-rubble.png", "static/art/map-boss-wall.png", "static/art/map-boss-column.png",
        "static/hazards.mjs",
        "static/dash-line.json", "static/dash-line.mjs", "static/art/fx-dash-star.jpg", "static/art/fx-dash-domain.jpg",
        "static/stops.json", "static/stop-rules.mjs", "static/art/stop-camp.jpg", "static/art/stop-shop.jpg", "static/art/stop-event.jpg",
        "docs/guide.md", "docs/gifts.md",
        "static/actor-art.mjs", "static/companion-art.mjs", "static/art/companion-yui.png",
        "static/art/companion-yui-guardian.png", "static/art/companion-yui-mage.png", "static/forest-art.mjs", "static/battle-art.mjs",
        "static/terrain-rules.mjs", "static/forest-map.mjs",
        "static/engine/astar-0.4.1.js", "static/engine/ASTAR-LICENSE.txt",
        "static/engine/NEKO-LICENSE.txt", "static/engine/NEKO-NOTICE.txt",
        "static/cottage.html", "static/cottage.css", "static/cottage.mjs", "static/cottage-scene.mjs", "static/cottage-icons.mjs",
        "static/cottage-record.mjs", "static/cottage-picture.mjs", "static/cottage-living.mjs", "static/cottage-company.mjs",
        "static/cottage-house.mjs", "static/cottage-layout.mjs", "static/cottage-card.mjs",
        "static/cottage-furnish.mjs", "static/cottage-ambient.mjs", "static/cottage-grounds.mjs", "static/cottage-grounds-life.mjs", "static/cottage-quality.mjs", "static/cottage-yui.mjs", "static/cottage-springs.mjs", "static/cottage-duvet.mjs", "static/cottage-yui-card.mjs", "static/cottage-hand.mjs", "static/cottage-routine.mjs", "static/cottage-yui-life.mjs", "static/cottage-style.mjs", "static/cottage-reach.mjs", "static/cottage-walk.mjs",
        "static/engine/three-gltf.mjs", "static/models/yui.glb", "static/models/hand.glb",
        "static/models/motion/idle01.vrma.gz", "static/models/motion/idle02.vrma.gz", "static/models/motion/idle03.vrma.gz", "static/models/motion/idle04.vrma.gz", "static/models/motion/idle05.vrma.gz", "static/models/motion/vsign.vrma.gz", "static/models/motion/liked.vrma.gz", "static/models/motion/walk.vrma.gz", "static/models/motion/sit.vrma.gz", "static/models/motion/type.vrma.gz", "static/models/motion/tablet.vrma.gz", "static/models/motion/sleep.vrma.gz", "static/models/motion/sleep-turn.vrma.gz", "static/models/motion/yawn.vrma.gz", "static/models/motion/stretch.vrma.gz", "static/models/motion/getup.vrma.gz", "static/models/motion/sit-laugh.vrma.gz", "static/models/motion/startle.vrma.gz", "static/models/skirt-seated.json", "static/models/motion/HANAMI_VRMA_NOTICE.md",
        "static/engine/three.module.min.js", "static/engine/three.core.min.js",
        "static/engine/three-rounded-box.mjs", "static/engine/three-post.mjs", "static/engine/THREE-LICENSE.txt",
        "static/skills-expanded.json", "static/routes.json", "static/expanded-combat.mjs",
        "static/build-mods.json", "static/buildcraft.mjs",
        "static/fx-art.mjs", "static/zone-art.mjs", "static/foe-art.mjs",
        "static/art/foe-slime.png", "static/art/foe-wisp.png", "static/art/foe-brute.png",
        "static/art/foe-charger.png", "static/art/foe-caster.png", "static/art/foe-sentinel.png",
        "static/art/foe-oracle.png", "static/art/foe-boss.png",
        "static/art/player-traveller.png", "static/art/player-traveller-guardian.png", "static/art/player-traveller-mage.png",
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
            assert package_path_allowed(relative), relative
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
    findings, payload_files = scan_package(args.package)
    assert not findings, findings
    print(json.dumps({
        "version": inspected.version, "payload_hash_verified": True, "crc_verified": True,
        "source_files_compared": len(compared), "bytes": args.package.stat().st_size,
        "extracted_backend_modules_loaded": loaded_modules, "synthetic_legacy_save_verified": True,
        "release_hygiene_verified": True, "payload_files": payload_files,
        "sha256": hashlib.sha256(args.package.read_bytes()).hexdigest(),
    }, indent=2))


if __name__ == "__main__":
    main()
