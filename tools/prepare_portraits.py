"""Prepare a local portrait folder for the plugin (development-only, needs Pillow)."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path

from PIL import Image, ImageOps


def prepare(source: Path, output: Path) -> None:
    source = source.resolve(strict=True)
    output = output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    items = []
    for path in sorted(source.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in {".png", ".webp", ".jpg", ".jpeg"}:
            continue
        relative = path.relative_to(source).as_posix()
        item_id = "sb-" + hashlib.sha256(relative.encode("utf-8")).hexdigest()[:12]
        name = re.sub(r"^\d+_", "", path.stem).replace("_", " ")
        character = re.split(r"[_ ]", re.sub(r"^\d+_", "", path.stem))[0]
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
        items.append({
            "id": item_id,
            "name": name,
            "collection": character,
            "file": f"{item_id}/display.webp",
            "thumbnail": f"{item_id}/thumb.webp",
            "source_file": relative,
        })
    if not items:
        raise ValueError("No images found")
    catalog = {"version": 1, "title": "千恋万花", "items": items}
    (output / "catalog.json").write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Prepared {len(items)} portraits in {output}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1] / "assets" / "portraits")
    args = parser.parse_args()
    prepare(args.source, args.output)
