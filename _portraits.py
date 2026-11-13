"""Shared portrait catalog, bounded image cache and persistent display preferences."""

from __future__ import annotations

import base64
import binascii
import copy
import hashlib
import json
import random
import re
import threading
from collections import OrderedDict
from pathlib import Path
from typing import Any

MAX_IMAGE_BYTES = 1024 * 1024
MAX_THUMB_BYTES = 64 * 1024
MAX_CATALOG_BYTES = 512 * 1024
MAX_ITEMS = 2000
PAGE_SIZE = 12
_MIME = {".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif"}
_ID = re.compile(r"[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}\Z")


class PortraitError(ValueError):
    pass


class PortraitLibrary:
    def __init__(self, root: Path, store: Any) -> None:
        self.root = root.resolve()
        self.store = store
        self.custom_root = (Path(store.path).parent / "custom_portraits").resolve()
        self._lock = threading.RLock()
        self._catalog_stamp: tuple[int, int] | None = None
        self._items: dict[str, dict[str, Any]] = {}
        self._cache: OrderedDict[str, tuple[str, str]] = OrderedDict()
        self._cache_bytes = 0
        self._catalog_error = False
        raw, self.warning = store.load()
        raw = raw if isinstance(raw, dict) else {}
        self._custom_items: dict[str, dict[str, Any]] = {}
        self._custom_error = False
        for item in raw.get("custom_items", []) if isinstance(raw.get("custom_items", []), list) else [None]:
            if (
                not isinstance(item, dict) or not isinstance(item.get("id"), str)
                or not re.fullmatch(r"user-[0-9a-f]{40}", item["id"])
                or not isinstance(item.get("name"), str) or not item["name"].strip()
                or not isinstance(item.get("collection"), str) or not item["collection"].strip()
                or len(self._custom_items) >= MAX_ITEMS
            ):
                self._custom_error = True
                continue
            item_id = item["id"]
            self._custom_items[item_id] = {
                "id": item_id, "name": item["name"][:120], "collection": item["collection"][:80],
                "file": f"{item_id}/display.webp", "thumbnail": f"{item_id}/thumb.webp", "custom": True,
            }
        self._prefs = {
            "mode": raw.get("mode") if raw.get("mode") in ("fixed", "random", "off", "legacy") else "fixed",
            "selected_id": raw.get("selected_id") if isinstance(raw.get("selected_id"), str) else "",
            # null = all images, [] = an explicitly empty pool.
            "pool_ids": self._clean_ids(raw.get("pool_ids")),
        }
        self._last_id = raw.get("last_id") if isinstance(raw.get("last_id"), str) else ""
        self._explicit_mode = "mode" in raw

    @staticmethod
    def _clean_ids(value: Any) -> list[str] | None:
        if value is None:
            return None
        if not isinstance(value, list):
            return []
        return list(dict.fromkeys(item for item in value[:MAX_ITEMS] if isinstance(item, str) and _ID.fullmatch(item)))

    def _path(self, relative: Any, custom: bool = False) -> Path:
        if not isinstance(relative, str) or not relative or "\\" in relative or ":" in relative:
            raise PortraitError("portrait_invalid_catalog")
        root = self.custom_root if custom else self.root
        path = (root / relative).resolve()
        if not path.is_relative_to(root) or path.suffix.lower() not in _MIME:
            raise PortraitError("portrait_invalid_catalog")
        return path

    def _reload(self) -> None:
        self._reload_bundled()
        self._items = {key: item for key, item in self._items.items() if not item.get("custom")}
        self._items.update(self._custom_items)

    def _reload_bundled(self) -> None:
        catalog = self.root / "catalog.json"
        try:
            stat = catalog.stat()
            stamp = (stat.st_mtime_ns, stat.st_size)
        except OSError:
            self._items = {}
            self._catalog_stamp = None
            self._catalog_error = catalog.exists()
            self._clear_cache()
            return
        if stamp == self._catalog_stamp:
            return
        self._catalog_stamp = stamp
        self._items = {}
        self._catalog_error = False
        self._clear_cache()
        try:
            if stat.st_size > MAX_CATALOG_BYTES:
                raise PortraitError("portrait_invalid_catalog")
            raw = json.loads(catalog.read_text(encoding="utf-8"))
            if not isinstance(raw, dict) or raw.get("version") != 1 or not isinstance(raw.get("items"), list):
                raise PortraitError("portrait_invalid_catalog")
            if len(raw["items"]) > MAX_ITEMS:
                raise PortraitError("portrait_invalid_catalog")
            for item in raw["items"]:
                try:
                    item_id = item.get("id")
                    if not isinstance(item_id, str) or not _ID.fullmatch(item_id) or item_id in self._items:
                        raise PortraitError("portrait_invalid_catalog")
                    self._path(item.get("file"))
                    self._path(item.get("thumbnail"))
                    self._items[item_id] = {
                        "id": item_id,
                        "name": str(item.get("name") or item_id)[:120],
                        "collection": str(item.get("collection") or "")[:80],
                        "file": item["file"],
                        "thumbnail": item["thumbnail"],
                        "custom": False,
                    }
                except (AttributeError, PortraitError):
                    self._catalog_error = True
        except (OSError, ValueError, TypeError):
            self._catalog_error = True

    def _clear_cache(self) -> None:
        self._cache.clear()
        self._cache_bytes = 0

    def _meta(self, item: dict[str, Any]) -> dict[str, Any]:
        result = {key: item[key] for key in ("id", "name", "collection", "custom")}
        try:
            path = self._path(item["file"], item.get("custom", False))
            stat = path.stat()
            result["available"] = path.is_file() and 0 < stat.st_size <= MAX_IMAGE_BYTES
            result["version"] = f"{item['id']}:{stat.st_mtime_ns}:{stat.st_size}"
        except (OSError, PortraitError):
            result["available"] = False
        return result

    def _available(self) -> list[dict[str, Any]]:
        self._reload()
        return [meta for item in self._items.values() if (meta := self._meta(item))["available"]]

    def summary(self) -> dict[str, Any]:
        with self._lock:
            return self._summary(self._available())

    def _summary(self, available: list[dict[str, Any]]) -> dict[str, Any]:
        settings = copy.deepcopy(self._prefs)
        ids = {item["id"] for item in available}
        if settings["selected_id"] not in ids:
            settings["selected_id"] = available[0]["id"] if available else ""
        if settings["pool_ids"] is not None:
            settings["pool_ids"] = [item for item in settings["pool_ids"] if item in ids]
        if not self._explicit_mode and not self._items:
            settings["mode"] = "legacy"
        pool = settings["pool_ids"]
        candidates = ids if pool is None else ids.intersection(pool)
        revision = hashlib.sha256(
            (repr(self._catalog_stamp) + json.dumps(
                list(self._custom_items.values()), ensure_ascii=False, sort_keys=True,
            )).encode()
        ).hexdigest()[:16]
        return {
            "settings": settings,
            "count": len(available),
            "ids": [item["id"] for item in available],
            "pool_count": len(candidates),
            "collections": sorted({item["collection"] for item in available}),
            "revision": revision,
            "catalog_error": self._catalog_error or self._custom_error,
        }

    def list_items(self, page: Any = 0, collection: Any = "", query: Any = "") -> dict[str, Any]:
        if type(page) is not int or page < 0 or not isinstance(collection, str) or not isinstance(query, str):
            raise PortraitError("portrait_invalid_settings")
        with self._lock:
            self._reload()
            matches = [
                self._meta(item) for item in self._items.values()
                if (not collection or item["collection"] == collection)
                and query[:120].casefold() in f"{item['name']} {item['collection']}".casefold()
            ]
            matches = [item for item in matches if item["available"]]
            pages = max(1, (len(matches) + PAGE_SIZE - 1) // PAGE_SIZE)
            page = min(page, pages - 1)
            return {"items": matches[page * PAGE_SIZE:(page + 1) * PAGE_SIZE], "page": page,
                    "pages": pages, "total": len(matches)}

    def update(self, mode: Any, selected_id: Any, pool_ids: Any) -> dict[str, Any]:
        if mode not in ("fixed", "random", "off", "legacy"):
            raise PortraitError("portrait_invalid_settings")
        if not isinstance(selected_id, str) or (selected_id and not _ID.fullmatch(selected_id)):
            raise PortraitError("portrait_invalid_settings")
        if pool_ids is not None and (
            not isinstance(pool_ids, list) or len(pool_ids) > MAX_ITEMS
            or any(not isinstance(item, str) or not _ID.fullmatch(item) for item in pool_ids)
        ):
            raise PortraitError("portrait_invalid_settings")
        with self._lock:
            self._reload()
            if selected_id and (selected_id not in self._items or not self._meta(self._items[selected_id])["available"]):
                raise PortraitError("portrait_not_found")
            # Keep unknown pool IDs when reading old preferences, but reject new invalid choices.
            if pool_ids is not None and any(item not in self._items for item in pool_ids):
                raise PortraitError("portrait_not_found")
            next_prefs = {"mode": mode, "selected_id": selected_id, "pool_ids": self._clean_ids(pool_ids)}
            self._save(next_prefs)
            self._prefs = next_prefs
            self._explicit_mode = True
            return self.summary()

    def choose(self, previous_id: Any = "") -> dict[str, Any]:
        if not isinstance(previous_id, str):
            raise PortraitError("portrait_invalid_settings")
        with self._lock:
            candidates = self._available()
            summary = self._summary(candidates)
            settings = summary["settings"]
            if settings["mode"] in ("off", "legacy"):
                return {"available": False}
            if settings["mode"] == "fixed":
                return next((item for item in candidates if item["id"] == settings["selected_id"]), {"available": False})
            pool = settings["pool_ids"]
            if pool is not None:
                candidates = [item for item in candidates if item["id"] in pool]
            if not candidates:
                return {"available": False}
            previous = previous_id or self._last_id
            choices = [item for item in candidates if item["id"] != previous] if len(candidates) > 1 else candidates
            chosen = random.choice(choices)
            self._save(last_id=chosen["id"])
            self._last_id = chosen["id"]
            return chosen

    def image(self, item_id: Any, thumbnail: Any = False) -> dict[str, Any]:
        if not isinstance(item_id, str) or type(thumbnail) is not bool:
            raise PortraitError("portrait_invalid_settings")
        with self._lock:
            self._reload()
            item = self._items.get(item_id)
            if item is None:
                raise PortraitError("portrait_not_found")
            path = self._path(item["thumbnail" if thumbnail else "file"], item.get("custom", False))
            limit = MAX_THUMB_BYTES if thumbnail else MAX_IMAGE_BYTES
            try:
                stat = path.stat()
                if not path.is_file() or not 0 < stat.st_size <= limit:
                    raise PortraitError("portrait_too_large")
                version = f"{item_id}:{stat.st_mtime_ns}:{stat.st_size}"
                key = f"{item_id}:{thumbnail}"
                cached = self._cache.get(key)
                if cached and cached[0] == version:
                    self._cache.move_to_end(key)
                    url = cached[1]
                else:
                    with path.open("rb") as stream:
                        data = stream.read(limit + 1)
                    if len(data) > limit:
                        raise PortraitError("portrait_too_large")
                    url = f"data:{_MIME[path.suffix.lower()]};base64," + base64.b64encode(data).decode("ascii")
                    old = self._cache.pop(key, None)
                    if old:
                        self._cache_bytes -= len(old[1])
                    self._cache[key] = (version, url)
                    self._cache_bytes += len(url)
                    while self._cache_bytes > 8 * MAX_IMAGE_BYTES or len(self._cache) > 48:
                        _, evicted = self._cache.popitem(last=False)
                        self._cache_bytes -= len(evicted[1])
            except OSError as exc:
                raise PortraitError("portrait_not_found") from exc
            return {"available": True, "id": item_id, "version": version, "data_url": url}

    def _save(self, prefs: Any = None, custom_items: Any = None, last_id: Any = None) -> None:
        self.store.save({
            **(self._prefs if prefs is None else prefs),
            "last_id": self._last_id if last_id is None else last_id,
            "custom_items": list((self._custom_items if custom_items is None else custom_items).values()),
        })

    @staticmethod
    def _label(value: Any, limit: int) -> str:
        if not isinstance(value, str):
            raise PortraitError("portrait_invalid_settings")
        value = " ".join("".join(char for char in value if ord(char) >= 32).split())
        if not value or len(value) > limit:
            raise PortraitError("portrait_invalid_settings")
        return value

    @staticmethod
    def _decode_webp(value: Any, limit: int, bounds: tuple[int, int]) -> bytes:
        prefix = "data:image/webp;base64,"
        if not isinstance(value, str) or len(value) > len(prefix) + ((limit + 2) // 3) * 4:
            raise PortraitError("portrait_too_large")
        if not value.startswith(prefix):
            raise PortraitError("portrait_invalid_image")
        try:
            data = base64.b64decode(value[len(prefix):], validate=True)
        except (ValueError, binascii.Error) as exc:
            raise PortraitError("portrait_invalid_image") from exc
        if not 20 <= len(data) <= limit or data[:4] != b"RIFF" or data[8:12] != b"WEBP":
            raise PortraitError("portrait_invalid_image")
        if int.from_bytes(data[4:8], "little") + 8 != len(data):
            raise PortraitError("portrait_invalid_image")
        # Read the WebP container, including the dimensions in its actual image frame.
        offset, frames = 12, 0
        while offset < len(data):
            if offset + 8 > len(data):
                raise PortraitError("portrait_invalid_image")
            kind = data[offset:offset + 4]
            length = int.from_bytes(data[offset + 4:offset + 8], "little")
            chunk = data[offset + 8:offset + 8 + length]
            if len(chunk) != length:
                raise PortraitError("portrait_invalid_image")
            size = None
            if kind == b"VP8X":
                if length != 10 or chunk[0] & 2:
                    raise PortraitError("portrait_invalid_image")
                size = (int.from_bytes(chunk[4:7], "little") + 1, int.from_bytes(chunk[7:10], "little") + 1)
            elif kind == b"VP8 ":
                if length < 10 or chunk[3:6] != b"\x9d\x01\x2a":
                    raise PortraitError("portrait_invalid_image")
                size = (int.from_bytes(chunk[6:8], "little") & 0x3FFF, int.from_bytes(chunk[8:10], "little") & 0x3FFF)
                frames += 1
            elif kind == b"VP8L":
                if length < 5 or chunk[0] != 0x2F:
                    raise PortraitError("portrait_invalid_image")
                bits = int.from_bytes(chunk[1:5], "little")
                size = ((bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1)
                frames += 1
            elif kind in (b"ANIM", b"ANMF"):
                raise PortraitError("portrait_invalid_image")
            if size and not (0 < size[0] <= bounds[0] and 0 < size[1] <= bounds[1]):
                raise PortraitError("portrait_too_large")
            offset += 8 + length + (length % 2)
        if offset != len(data) or frames != 1:
            raise PortraitError("portrait_invalid_image")
        return data

    def import_image(self, name: Any, collection: Any, data_url: Any, thumbnail_url: Any) -> dict[str, Any]:
        name, collection = self._label(name, 120), self._label(collection, 80)
        data = self._decode_webp(data_url, MAX_IMAGE_BYTES, (960, 1440))
        thumb = self._decode_webp(thumbnail_url, MAX_THUMB_BYTES, (200, 280))
        item_id = "user-" + hashlib.sha256(data).hexdigest()[:40]
        with self._lock:
            self._reload()
            if item_id in self._custom_items and self._meta(self._custom_items[item_id])["available"]:
                return {"item": self._meta(self._custom_items[item_id]), "duplicate": True}
            if len(self._items) >= MAX_ITEMS and item_id not in self._items:
                raise PortraitError("portrait_library_full")
            target = self._path(f"{item_id}/display.webp", True).parent
            target.mkdir(parents=True, exist_ok=True)
            item = {"id": item_id, "name": name, "collection": collection, "custom": True,
                    "file": f"{item_id}/display.webp", "thumbnail": f"{item_id}/thumb.webp"}
            next_items = {**self._custom_items, item_id: item}
            # A failed metadata save leaves the old library intact. Content-addressed
            # image files are harmless and can be reused by the next attempt.
            self._path(item["file"], True).write_bytes(data)
            self._path(item["thumbnail"], True).write_bytes(thumb)
            self._save(custom_items=next_items)
            self._custom_items = next_items
            self._clear_cache()
            return {"item": self._meta(item), "duplicate": False}

    def edit_custom(self, item_id: Any, name: Any, collection: Any) -> dict[str, Any]:
        name, collection = self._label(name, 120), self._label(collection, 80)
        with self._lock:
            if not isinstance(item_id, str) or item_id not in self._custom_items:
                raise PortraitError("portrait_custom_only")
            item = {**self._custom_items[item_id], "name": name, "collection": collection}
            next_items = {**self._custom_items, item_id: item}
            self._save(custom_items=next_items)
            self._custom_items = next_items
            return {"item": self._meta(item)}

    def delete_custom(self, item_id: Any) -> dict[str, Any]:
        with self._lock:
            if not isinstance(item_id, str) or not re.fullmatch(r"user-[0-9a-f]{40}", item_id):
                raise PortraitError("portrait_custom_only")
            item = self._custom_items.get(item_id)
            if item is None:
                return self.summary()
            next_items = {key: value for key, value in self._custom_items.items() if key != item_id}
            next_prefs = copy.deepcopy(self._prefs)
            if next_prefs["selected_id"] == item_id:
                next_prefs["selected_id"] = ""
            if next_prefs["pool_ids"] is not None:
                next_prefs["pool_ids"] = [key for key in next_prefs["pool_ids"] if key != item_id]
            self._save(next_prefs, next_items, "" if self._last_id == item_id else self._last_id)
            self._custom_items, self._prefs = next_items, next_prefs
            if self._last_id == item_id:
                self._last_id = ""
            self._clear_cache()
            for field in ("file", "thumbnail"):
                try:
                    self._path(item[field], True).unlink(missing_ok=True)
                except OSError:
                    pass
            return self.summary()
