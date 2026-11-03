from __future__ import annotations

import json


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
