"""Prepare a local portrait folder for the plugin (development-only, needs Pillow)."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path

from PIL import Image, ImageOps


def excluded(collection: str, source_file: str) -> bool:
    policy = json.loads(Path(__file__).with_name("portrait_exclusions.json").read_text(encoding="utf-8"))
    normalized = f"{collection}/{Path(source_file).name}"
    return collection in policy["collections"] or normalized in policy["source_files"]


def prepare(source: Path, output: Path, *, merge: bool = False, grouped: bool = False, collection: str = "") -> None:
    source = source.resolve(strict=True)
    output = output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    catalog_path = output / "catalog.json"
    catalog = json.loads(catalog_path.read_text(encoding="utf-8")) if merge and catalog_path.exists() else {"version": 1, "items": []}
    items = {
        item["id"]: item for item in catalog["items"]
        if not excluded(item["collection"], item.get("source_file", ""))
    }
    for item in items.values():
        if catalog.get("title") == "千恋万花" and item["id"].startswith("sb-"):
            item["collection"] = "千恋万花"
    prepared = 0
    for path in sorted(source.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in {".png", ".webp", ".jpg", ".jpeg"}:
            continue
        relative = path.relative_to(source).as_posix()
        legacy = not grouped and (collection or source.name) in {"千恋万花", "千恋万花_立绘"}
        identity = relative if grouped or legacy else f"{collection or source.name}/{relative}"
        item_id = ("sb-" if legacy else "game-") + hashlib.sha256(identity.encode("utf-8")).hexdigest()[:12]
        name = re.sub(r"^\d+_", "", path.stem).replace("_", " ")
        game = path.relative_to(source).parts[0] if grouped else collection or source.name
        if excluded(game, relative):
            continue
        target = output / item_id
        target.mkdir(exist_ok=True)
        with Image.open(path) as original:
            image = ImageOps.exif_transpose(original).convert("RGBA")
            bounds = image.getbbox()
            if not bounds:
                continue
            image = image.crop(bounds)
            image.thumbnail((960, 1440), Image.Resampling.LANCZOS)
            image.save(target / "display.webp", "WEBP", quality=88, method=6)
            thumb = image.copy()
            thumb.thumbnail((200, 280), Image.Resampling.LANCZOS)
            thumb.save(target / "thumb.webp", "WEBP", quality=80, method=6)
        if (target / "display.webp").stat().st_size > 1024 * 1024:
            raise ValueError(f"Display image exceeds 1 MiB: {relative}")
        if (target / "thumb.webp").stat().st_size > 64 * 1024:
            raise ValueError(f"Thumbnail exceeds 64 KiB: {relative}")
        items[item_id] = {
            "id": item_id,
            "name": name,
            "collection": game,
            "file": f"{item_id}/display.webp",
            "thumbnail": f"{item_id}/thumb.webp",
            "source_file": relative,
        }
        prepared += 1
    if not prepared:
        raise ValueError("No images found")
    catalog = {"version": 1, "items": list(items.values())}
    catalog_path.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Prepared {prepared} portraits; library contains {len(items)} in {output}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1] / "assets" / "portraits")
    parser.add_argument("--merge", action="store_true", help="Keep existing items and IDs")
    parser.add_argument("--grouped", action="store_true", help="Use each top-level game directory as its collection")
    parser.add_argument("--collection", default="", help="Game name for a single-game source folder")
    args = parser.parse_args()
    prepare(args.source, args.output, merge=args.merge, grouped=args.grouped, collection=args.collection)
