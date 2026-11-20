"""Appearance preferences must persist without mutating relationship state."""

import json

import pytest


def test_defaults_are_read_only_until_user_saves(appearance, storage, tmp_path):
    path = tmp_path / "appearance.json"
    prefs = appearance.AppearancePrefs(storage.StateFile(path))
    assert prefs.summary() == {"accent_color": "#7db9e8", "color_scheme": "system"}
    assert prefs.warning is None
    assert not path.exists()
    summary = prefs.summary()
    summary["accent_color"] = "#000000"
    assert prefs.summary()["accent_color"] == "#7db9e8"


def test_saved_preferences_survive_recreation(appearance, storage, tmp_path):
    path = tmp_path / "appearance.json"
    prefs = appearance.AppearancePrefs(storage.StateFile(path))
    result = prefs.update("#7DB9E8", "dark")
    expected = {"accent_color": "#7db9e8", "color_scheme": "dark"}
    assert result == expected
    assert json.loads(path.read_text(encoding="utf-8")) == expected
    assert appearance.AppearancePrefs(storage.StateFile(path)).summary() == expected
    result["color_scheme"] = "light"
    assert prefs.summary() == expected


@pytest.mark.parametrize("color,scheme", [
    (None, "system"), (True, "light"), (123, "dark"), ("#fff", "light"),
    ("#gggggg", "dark"), ("#123456\n", "light"), ("red", "light"),
    ("#123456;--bg:red", "system"), ("#123456", None), ("#123456", True),
    ("#123456", ["dark"]), ("#123456", "automatic"),
])
def test_invalid_choices_never_reach_disk(appearance, storage, tmp_path, color, scheme):
    path = tmp_path / "appearance.json"
    prefs = appearance.AppearancePrefs(storage.StateFile(path))
    with pytest.raises(appearance.AppearanceError, match="appearance_invalid_settings"):
        prefs.update(color, scheme)
    assert prefs.summary() == appearance.DEFAULTS
    assert not path.exists()


def test_failed_save_does_not_leak_into_memory_or_next_save(appearance, storage, tmp_path, monkeypatch):
    path = tmp_path / "appearance.json"
    store = storage.StateFile(path)
    prefs = appearance.AppearancePrefs(store)
    prefs.update("#7db9e8", "light")
    before = prefs.summary()
    with monkeypatch.context() as patch:
        patch.setattr(store, "save", lambda _: (_ for _ in ()).throw(OSError("disk full")))
        with pytest.raises(OSError):
            prefs.update("#70bda5", "dark")
    assert prefs.summary() == before
    assert json.loads(path.read_text(encoding="utf-8")) == before
    prefs.update("#aaa0d8", "system")
    assert json.loads(path.read_text(encoding="utf-8")) == {"accent_color": "#aaa0d8", "color_scheme": "system"}


@pytest.mark.parametrize("raw", [
    [], None, {"accent_color": "invalid", "color_scheme": []},
    {"accent_color": False, "color_scheme": {"dark": True}},
])
def test_invalid_saved_data_falls_back(appearance, storage, tmp_path, raw):
    path = tmp_path / "appearance.json"
    path.write_text(json.dumps(raw), encoding="utf-8")
    assert appearance.AppearancePrefs(storage.StateFile(path)).summary() == appearance.DEFAULTS


def test_corrupt_file_is_preserved_by_storage_recovery(appearance, storage, tmp_path):
    path = tmp_path / "appearance.json"
    path.write_text("{broken", encoding="utf-8")
    prefs = appearance.AppearancePrefs(storage.StateFile(path))
    assert prefs.summary() == appearance.DEFAULTS
    assert prefs.warning
    assert list(tmp_path.glob("appearance.corrupt-*.json"))
