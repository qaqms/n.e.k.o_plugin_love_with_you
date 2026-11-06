from __future__ import annotations

import json
from pathlib import Path

import pytest

PLUGIN_ROOT = Path(__file__).resolve().parents[1]


def make_library(tmp_path, portraits, storage, count=3):
    root = tmp_path / "portraits"
    root.mkdir()
    items = []
    for index in range(count):
        item_id = f"image-{index}"
        (root / f"{item_id}.webp").write_bytes(b"image" + bytes([index % 256]))
        (root / f"{item_id}.thumb.webp").write_bytes(b"thumb" + bytes([index % 256]))
        items.append({
            "id": item_id, "name": f"Portrait {index}", "collection": f"Group {index % 2}",
            "file": f"{item_id}.webp", "thumbnail": f"{item_id}.thumb.webp",
        })
    (root / "catalog.json").write_text(json.dumps({"version": 1, "items": items}), encoding="utf-8")
    store = storage.StateFile(tmp_path / "data" / "portraits.json")
    return portraits.PortraitLibrary(root, store), items


def test_preferences_survive_restart_and_are_separate_from_relationship_data(tmp_path, portraits, storage):
    library, _ = make_library(tmp_path, portraits, storage)
    library.update("fixed", "image-2", ["image-0", "image-2"])
    reopened = portraits.PortraitLibrary(library.root, library.store)
    assert reopened.summary()["settings"] == {
        "mode": "fixed", "selected_id": "image-2", "pool_ids": ["image-0", "image-2"],
    }
    assert reopened.choose()["id"] == "image-2"
    assert not (tmp_path / "data" / "state.json").exists()
    assert "data_url" not in json.dumps(reopened.summary())


def test_random_pool_and_immediate_repeats_across_restart(tmp_path, portraits, storage):
    library, _ = make_library(tmp_path, portraits, storage)
    library.update("random", "image-0", ["image-0", "image-2"])
    previous = ""
    for _ in range(20):
        item = library.choose(previous)
        assert item["id"] in {"image-0", "image-2"}
        assert item["id"] != previous
        previous = item["id"]
    reopened = portraits.PortraitLibrary(library.root, library.store)
    assert reopened.choose()["id"] != previous


def test_empty_pool_is_not_all_and_singleton_is_stable(tmp_path, portraits, storage):
    library, _ = make_library(tmp_path, portraits, storage)
    library.update("random", "image-0", [])
    assert library.summary()["pool_count"] == 0
    assert not library.choose()["available"]
    library.update("random", "image-0", ["image-1"])
    assert library.choose("image-1")["id"] == "image-1"
    library.update("random", "image-0", None)
    assert library.summary()["pool_count"] == 3
    library.update("off", "image-0", None)
    assert not library.choose()["available"]


def test_missing_selection_falls_back_and_removed_pool_does_not_expand(tmp_path, portraits, storage):
    library, _ = make_library(tmp_path, portraits, storage)
    library.update("random", "image-1", ["image-1"])
    (library.root / "image-1.webp").unlink()
    assert library.summary()["settings"]["selected_id"] == "image-0"
    assert library.summary()["settings"]["pool_ids"] == []
    assert not library.choose()["available"]
    library.update("fixed", "", None)
    assert library.choose()["id"] == "image-0"


def test_catalog_pagination_filter_search_and_bounds(tmp_path, portraits, storage):
    library, _ = make_library(tmp_path, portraits, storage, count=27)
    assert len(library.list_items()["items"]) == 12
    assert library.list_items(999)["page"] == 2
    assert len(library.list_items(2)["items"]) == 3
    assert library.list_items(collection="Group 1")["total"] == 13
    assert library.list_items(query="portrait 25")["items"][0]["id"] == "image-25"
    assert library.list_items(query="absent")["total"] == 0
    for args in [(-1,), (True,), ("0",), (0, []), (0, "", {})]:
        with pytest.raises(portraits.PortraitError):
            library.list_items(*args)


def test_reject_paths_outside_library_and_unregistered_ids(tmp_path, portraits, storage):
    library, items = make_library(tmp_path, portraits, storage)
    bad = [
        {"id": "escape", "file": "../secret.webp", "thumbnail": "image-0.thumb.webp"},
        {"id": "absolute", "file": str(tmp_path / "secret.webp"), "thumbnail": "image-0.thumb.webp"},
        {"id": "windows", "file": "C:\\secret.webp", "thumbnail": "image-0.thumb.webp"},
    ]
    (library.root / "catalog.json").write_text(json.dumps({"version": 1, "items": items + bad}), encoding="utf-8")
    assert library.summary()["count"] == 3
    assert library.summary()["catalog_error"]
    for item_id in ["../secret", "escape", "absolute", "windows", {}, None]:
        with pytest.raises(portraits.PortraitError):
            library.image(item_id)
    with pytest.raises(portraits.PortraitError):
        library.image("image-0", "false")


def test_size_checks_bounded_cache_and_changed_image(tmp_path, portraits, storage):
    library, _ = make_library(tmp_path, portraits, storage, count=60)
    original = library.image("image-0")["data_url"]
    (library.root / "image-0.webp").write_bytes(b"new-image")
    assert library.image("image-0")["data_url"] != original
    for index in range(60):
        library.image(f"image-{index}", True)
    assert len(library._cache) <= 48
    assert library._cache_bytes <= 8 * portraits.MAX_IMAGE_BYTES
    (library.root / "image-1.webp").write_bytes(b"x" * (portraits.MAX_IMAGE_BYTES + 1))
    (library.root / "image-2.thumb.webp").write_bytes(b"x" * (portraits.MAX_THUMB_BYTES + 1))
    assert library.summary()["count"] == 59
    with pytest.raises(portraits.PortraitError):
        library.image("image-1")
    with pytest.raises(portraits.PortraitError):
        library.image("image-2", True)


def test_bad_catalog_and_legacy_fallback(tmp_path, portraits, storage):
    store = storage.StateFile(tmp_path / "preferences.json")
    library = portraits.PortraitLibrary(tmp_path / "absent", store)
    assert library.summary()["settings"]["mode"] == "legacy"
    library.update("off", "", None)
    assert library.summary()["settings"]["mode"] == "off"
    library.root.mkdir()
    (library.root / "catalog.json").write_text("not json", encoding="utf-8")
    assert library.summary()["catalog_error"]
    assert library.list_items()["items"] == []


def test_failed_save_does_not_apply_preferences(tmp_path, portraits, storage):
    library, _ = make_library(tmp_path, portraits, storage)
    before = library.summary()["settings"]

    def fail(_):
        raise OSError("disk full")

    library.store.save = fail
    with pytest.raises(OSError):
        library.update("off", "", None)
    assert library.summary()["settings"] == before


@pytest.mark.parametrize("mode,selected,pool", [
    ("unknown", "", None), ("fixed", "../file", None), ("fixed", "absent", None),
    ("random", "", "all"), ("random", "", [None]), ("random", "", ["absent"]),
])
def test_invalid_preferences(tmp_path, portraits, storage, mode, selected, pool):
    library, _ = make_library(tmp_path, portraits, storage)
    with pytest.raises(portraits.PortraitError):
        library.update(mode, selected, pool)


def test_bundled_catalog_and_images(portraits, storage, tmp_path):
    library = portraits.PortraitLibrary(PLUGIN_ROOT / "assets" / "portraits", storage.StateFile(tmp_path / "prefs.json"))
    summary = library.summary()
    assert summary["count"] >= 18
    assert not summary["catalog_error"]
    assert len(summary["ids"]) == len(set(summary["ids"]))
    for item_id in summary["ids"]:
        for thumbnail in (False, True):
            assert library.image(item_id, thumbnail)["data_url"].startswith("data:image/webp;base64,")
