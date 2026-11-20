from __future__ import annotations

import json

import pytest


def test_roundtrip(storage, tmp_path):
    state_file = storage.StateFile(tmp_path / "data" / "state.json")
    assert state_file.load() == (None, None)
    state_file.save({"a": 1, "名字": "小八"})
    assert state_file.load() == ({"a": 1, "名字": "小八"}, None)
    assert [p.name for p in (tmp_path / "data").iterdir()] == ["state.json"]


def test_corrupt_file_is_quarantined_not_deleted(storage, tmp_path):
    path = tmp_path / "state.json"
    path.write_text("{not json", encoding="utf-8")
    data, warning = storage.StateFile(path).load()
    assert data is None
    assert warning and "moved to" in warning
    quarantined = [p for p in tmp_path.iterdir() if p.name.startswith("state.corrupt-")]
    assert len(quarantined) == 1
    assert quarantined[0].read_text(encoding="utf-8") == "{not json"


def test_save_replaces_existing(storage, tmp_path):
    path = tmp_path / "state.json"
    state_file = storage.StateFile(path)
    state_file.save({"v": 1})
    state_file.save({"v": 2})
    assert json.loads(path.read_text(encoding="utf-8")) == {"v": 2}


def test_repeated_corruption_in_one_second_preserves_each_backup(
    storage, tmp_path, monkeypatch, module_clock
):
    module_clock.time = lambda: 1000
    monkeypatch.setattr(storage, "time", module_clock)
    path = tmp_path / "state.json"
    store = storage.StateFile(path)
    for content in ("{first broken file", "{second broken file"):
        path.write_text(content, encoding="utf-8")
        assert store.load()[1]
    assert sorted(item.read_text(encoding="utf-8") for item in tmp_path.glob("state.corrupt-*")) == [
        "{first broken file", "{second broken file",
    ]


def test_deeply_nested_state_is_quarantined_instead_of_crashing(storage, tmp_path):
    path = tmp_path / "state.json"
    raw = "[" * 2000 + "]" * 2000
    path.write_text(raw, encoding="utf-8")
    value, warning = storage.StateFile(path).load()
    assert value is None and warning
    assert next(tmp_path.glob("state.corrupt-*")).read_text(encoding="utf-8") == raw


def test_ambiguous_or_nonfinite_json_never_loads_as_a_valid_save(storage, tmp_path):
    path = tmp_path / "state.json"
    for raw in ('{"coins":1,"coins":999}', '{"value":NaN}', '{"value":Infinity}', '{"value":1e999}'):
        path.write_text(raw, encoding="utf-8")
        value, warning = storage.StateFile(path).load()
        assert value is None and warning


def test_large_state_read_is_bounded_and_keeps_recovery_bytes(storage, tmp_path):
    path = tmp_path / "state.json"
    original = '{"large":"' + "a" * 1000 + '"}'
    path.write_text(original, encoding="utf-8")
    data, warning = storage.StateFile(path, max_bytes=64).load()
    assert data is None and warning
    assert next(tmp_path.glob("state.corrupt-*")).read_text(encoding="utf-8") == original


@pytest.mark.parametrize("invalid", [float("nan"), float("inf"), "large" * 100])
def test_rejected_save_keeps_previous_bytes_and_leaves_no_temp_file(storage, tmp_path, invalid):
    path = tmp_path / "state.json"
    store = storage.StateFile(path, max_bytes=64)
    store.save({"value": 10})
    before = path.read_bytes()
    with pytest.raises(ValueError):
        store.save({"value": invalid})
    assert path.read_bytes() == before
    assert [item.name for item in tmp_path.iterdir()] == ["state.json"]


def test_storage_never_emits_a_save_its_depth_guard_would_reject(storage, tmp_path):
    store = storage.StateFile(tmp_path / "state.json")
    store.save({"value": 10})
    before = store.path.read_bytes()
    nested = []
    for _ in range(70):
        nested = [nested]
    with pytest.raises(ValueError, match="json_too_deep"):
        store.save(nested)
    assert store.path.read_bytes() == before
