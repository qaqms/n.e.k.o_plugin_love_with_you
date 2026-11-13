from __future__ import annotations

import base64
import json
from concurrent.futures import ThreadPoolExecutor
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
    assert summary["count"] == 64
    assert len(summary["collections"]) == 8
    assert library.list_items(collection="千恋万花")["total"] == 18
    assert library.list_items(collection="天使☆嚣嚣_RE-BOOT")["total"] == 9
    policy = json.loads((PLUGIN_ROOT / "tools" / "portrait_exclusions.json").read_text(encoding="utf-8"))
    catalog = json.loads((library.root / "catalog.json").read_text(encoding="utf-8"))
    for item in catalog["items"]:
        assert item["collection"] not in policy["collections"]
        assert item["source_file"] not in policy["source_files"]
    assert {path.name for path in library.root.iterdir() if path.is_dir()} == set(summary["ids"])
    assert not summary["catalog_error"]
    assert len(summary["ids"]) == len(set(summary["ids"]))
    for item_id in summary["ids"]:
        for thumbnail in (False, True):
            assert library.image(item_id, thumbnail)["data_url"].startswith("data:image/webp;base64,")


def import_urls():
    root = PLUGIN_ROOT / "assets" / "portraits"
    item = json.loads((root / "catalog.json").read_text(encoding="utf-8"))["items"][0]
    return tuple(
        "data:image/webp;base64," + base64.b64encode((root / item[key]).read_bytes()).decode("ascii")
        for key in ("file", "thumbnail")
    )


def test_custom_import_edit_restart_and_bundled_upgrade(tmp_path, portraits, storage):
    library, _ = make_library(tmp_path, portraits, storage)
    before_catalog = (library.root / "catalog.json").read_bytes()
    result = library.import_image(" My portrait ", " My game ", *import_urls())
    item_id = result["item"]["id"]
    assert not result["duplicate"]
    assert result["item"]["custom"]
    assert result["item"]["name"] == "My portrait"
    library.update("random", item_id, [item_id])
    library.edit_custom(item_id, "New name", "New game")
    reopened = portraits.PortraitLibrary(library.root, library.store)
    assert reopened.choose()["id"] == item_id
    assert reopened.list_items(collection="New game")["items"][0]["name"] == "New name"
    assert reopened.image(item_id)["data_url"] == import_urls()[0]
    assert reopened.custom_root.parent == library.store.path.parent
    assert not reopened.custom_root.is_relative_to(library.root)
    assert (library.root / "catalog.json").read_bytes() == before_catalog
    # Replacing the bundled catalog never replaces user imports.
    (library.root / "catalog.json").write_text('{"version":1,"items":[]}', encoding="utf-8")
    assert reopened.summary()["ids"] == [item_id]


def test_duplicate_import_is_idempotent_even_concurrently(tmp_path, portraits, storage):
    library, _ = make_library(tmp_path, portraits, storage)
    with ThreadPoolExecutor(max_workers=4) as executor:
        results = list(executor.map(lambda _: library.import_image("Name", "Game", *import_urls()), range(8)))
    assert len({result["item"]["id"] for result in results}) == 1
    assert sum(not result["duplicate"] for result in results) == 1
    library.edit_custom(results[0]["item"]["id"], "Renamed", "Moved")
    duplicate = library.import_image("Old", "Old", *import_urls())
    assert duplicate["duplicate"]
    assert duplicate["item"]["name"] == "Renamed"
    assert library.summary()["count"] == 4


def test_delete_cleans_selection_pool_files_and_survives_restart(tmp_path, portraits, storage):
    library, _ = make_library(tmp_path, portraits, storage)
    item_id = library.import_image("Name", "Game", *import_urls())["item"]["id"]
    library.update("random", item_id, [item_id])
    library.choose()
    library.delete_custom(item_id)
    assert library.summary()["settings"]["pool_ids"] == []
    assert library.summary()["settings"]["selected_id"] == "image-0"
    assert not library.choose()["available"]
    assert not (library.custom_root / item_id / "display.webp").exists()
    reopened = portraits.PortraitLibrary(library.root, library.store)
    assert item_id not in reopened.summary()["ids"]
    assert not reopened.choose()["available"]
    # A lost delete response can be retried without touching any other item.
    assert reopened.delete_custom(item_id)["count"] == 3
    with pytest.raises(portraits.PortraitError, match="portrait_custom_only"):
        reopened.delete_custom("image-0")


@pytest.mark.parametrize("operation", ["import", "edit", "delete"])
def test_custom_save_failure_keeps_previous_library(tmp_path, portraits, storage, operation):
    library, _ = make_library(tmp_path, portraits, storage)
    item_id = ""
    if operation != "import":
        item_id = library.import_image("Name", "Game", *import_urls())["item"]["id"]
    before = library.summary()
    saved = library.store.save

    def fail(_):
        raise OSError("disk full")

    library.store.save = fail
    with pytest.raises(OSError):
        if operation == "import":
            library.import_image("Name", "Game", *import_urls())
        elif operation == "edit":
            library.edit_custom(item_id, "Changed", "Moved")
        else:
            library.delete_custom(item_id)
    assert library.summary() == before
    library.store.save = saved
    assert portraits.PortraitLibrary(library.root, library.store).summary() == before
    if item_id:
        assert library.image(item_id)["available"]


@pytest.mark.parametrize("name,game", [("", "Game"), ("Name", ""), ([], "Game"), ("x" * 121, "Game")])
def test_import_rejects_bad_labels(tmp_path, portraits, storage, name, game):
    library, _ = make_library(tmp_path, portraits, storage)
    with pytest.raises(portraits.PortraitError):
        library.import_image(name, game, *import_urls())
    assert library.summary()["count"] == 3


def test_import_rejects_invalid_images_and_thumbnail_sizes(tmp_path, portraits, storage):
    library, _ = make_library(tmp_path, portraits, storage)
    display, thumb = import_urls()
    for bad in ["data:image/png;base64,AAAA", "data:image/webp;base64,@@@", None, display[:-8]]:
        with pytest.raises(portraits.PortraitError):
            library.import_image("Name", "Game", bad, thumb)
    with pytest.raises(portraits.PortraitError):
        library.import_image("Name", "Game", display, display)
    assert not library.custom_root.exists()


def test_custom_only_library_without_bundled_catalog(tmp_path, portraits, storage):
    library = portraits.PortraitLibrary(tmp_path / "absent", storage.StateFile(tmp_path / "data" / "prefs.json"))
    item_id = library.import_image("Name", "Game", *import_urls())["item"]["id"]
    assert library.summary()["count"] == 1
    assert library.summary()["settings"]["mode"] == "fixed"
    assert library.choose()["id"] == item_id


def test_choosing_a_portrait_scans_each_file_only_once(tmp_path, portraits, storage, monkeypatch):
    from unittest.mock import Mock

    library, items = make_library(tmp_path, portraits, storage)
    library.summary()
    probe = Mock(wraps=library._meta)
    monkeypatch.setattr(library, "_meta", probe)
    assert library.choose()["available"]
    assert probe.call_count == len(items)
