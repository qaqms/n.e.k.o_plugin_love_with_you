from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest


@pytest.fixture
def prepare():
    path = Path(__file__).resolve().parents[1] / "tools" / "prepare_development.py"
    spec = importlib.util.spec_from_file_location("_love_prepare_development", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.prepare


@pytest.fixture
def source(tmp_path):
    root = tmp_path / "repository.with.dots"
    root.mkdir()
    (root / "plugin.toml").write_text(
        '[plugin]\nid = "love_with_you"\nentry = "plugin.plugins.love_with_you:LoveWithYouPlugin"\n',
        encoding="utf-8",
    )
    (root / "__init__.py").write_text("class LoveWithYouPlugin: pass\n", encoding="utf-8")
    (root / "_engine.py").write_text("VALUE = 1\n", encoding="utf-8")
    (root / "ui").mkdir()
    (root / "ui" / "panel.tsx").write_text("export {};\n", encoding="utf-8")
    (root / "tests").mkdir()
    (root / "tests" / "test_sample.py").write_text("assert False\n", encoding="utf-8")
    return root


def test_prepare_builds_importable_package_and_refreshes_deleted_files(prepare, source, monkeypatch):
    target = prepare(source)
    assert target == source.parent / ".neko-dev" / "love_with_you"
    assert not (target / "tests").exists()
    assert (target / "ui" / "panel.tsx").read_bytes() == (source / "ui" / "panel.tsx").read_bytes()
    monkeypatch.syspath_prepend(str(target.parent))
    spec = importlib.util.find_spec("love_with_you")
    assert Path(spec.origin) == target / "__init__.py"
    (source / "_engine.py").unlink()
    (source / "__init__.py").write_text("class LoveWithYouPlugin: VALUE = 2\n", encoding="utf-8")
    assert prepare(source) == target
    assert not (target / "_engine.py").exists()
    assert "VALUE = 2" in (target / "__init__.py").read_text(encoding="utf-8")
    assert "love_with_you" not in sys.modules


def test_prepare_refuses_to_replace_unmanaged_directory(prepare, source):
    target = source.parent / ".neko-dev" / "love_with_you"
    target.mkdir(parents=True)
    important = target / "personal.txt"
    important.write_text("keep", encoding="utf-8")
    with pytest.raises(ValueError, match="unmanaged directory"):
        prepare(source)
    assert important.read_text(encoding="utf-8") == "keep"
