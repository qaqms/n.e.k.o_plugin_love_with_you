"""Shared portrait catalog, bounded image cache and persistent display preferences."""

from __future__ import annotations

import base64
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
        self._lock = threading.RLock()
        self._catalog_stamp: tuple[int, int] | None = None
        self._items: dict[str, dict[str, Any]] = {}
        self._cache: OrderedDict[str, tuple[str, str]] = OrderedDict()
        self._cache_bytes = 0
        self._catalog_error = False
        raw, self.warning = store.load()
        raw = raw if isinstance(raw, dict) else {}
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

    def _path(self, relative: Any) -> Path:
        if not isinstance(relative, str) or not relative or "\\" in relative or ":" in relative:
            raise PortraitError("portrait_invalid_catalog")
        path = (self.root / relative).resolve()
        if not path.is_relative_to(self.root) or path.suffix.lower() not in _MIME:
            raise PortraitError("portrait_invalid_catalog")
        return path

    def _reload(self) -> None:
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
                    }
                except (AttributeError, PortraitError):
                    self._catalog_error = True
        except (OSError, ValueError, TypeError):
            self._catalog_error = True

    def _clear_cache(self) -> None:
        self._cache.clear()
        self._cache_bytes = 0

    def _meta(self, item: dict[str, Any]) -> dict[str, Any]:
        result = {key: item[key] for key in ("id", "name", "collection")}
        try:
            path = self._path(item["file"])
            stat = path.stat()
            result["available"] = path.is_file() and 0 < stat.st_size <= MAX_IMAGE_BYTES
            result["version"] = f"{item['id']}:{stat.st_mtime_ns}:{stat.st_size}"
        except (OSError, PortraitError):
            result["available"] = False
        return result

    def summary(self) -> dict[str, Any]:
        with self._lock:
            self._reload()
            available = [item for item in self._items.values() if self._meta(item)["available"]]
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
            revision = hashlib.sha256(repr(self._catalog_stamp).encode()).hexdigest()[:16]
            return {
                "settings": settings,
                "count": len(available),
                "ids": [item["id"] for item in available],
                "pool_count": len(candidates),
                "collections": sorted({item["collection"] for item in available}),
                "revision": revision,
                "catalog_error": self._catalog_error,
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
            self.store.save({**next_prefs, "last_id": self._last_id})
            self._prefs = next_prefs
            self._explicit_mode = True
            return self.summary()

    def choose(self, previous_id: Any = "") -> dict[str, Any]:
        if not isinstance(previous_id, str):
            raise PortraitError("portrait_invalid_settings")
        with self._lock:
            summary = self.summary()
            settings = summary["settings"]
            if settings["mode"] in ("off", "legacy"):
                return {"available": False}
            candidates = [self._meta(item) for item in self._items.values()]
            candidates = [item for item in candidates if item["available"]]
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
            self.store.save({**self._prefs, "last_id": chosen["id"]})
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
            path = self._path(item["thumbnail" if thumbnail else "file"])
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
