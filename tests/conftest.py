"""Load the plugin's pure modules by file path.

The plugin runs from different locations (``plugin/plugins/love_with_you`` in
CI, a standalone folder during local development), so tests never rely on a
package import path. ``_engine`` and ``_storage`` have no SDK imports.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

PLUGIN_ROOT = Path(__file__).resolve().parents[1]


def _load(name: str):
    module_name = f"_love_with_you_test_{name}"
    if module_name in sys.modules:
        return sys.modules[module_name]
    spec = importlib.util.spec_from_file_location(module_name, PLUGIN_ROOT / f"{name}.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="session")
def engine():
    return _load("_engine")


@pytest.fixture(scope="session")
def storage():
    return _load("_storage")


@pytest.fixture(scope="session")
def cal():
    return _load("_calendar")


@pytest.fixture(scope="session")
def conv():
    return _load("_conversation")


@pytest.fixture(scope="session")
def scoring():
    return _load("_scoring")


@pytest.fixture(scope="session")
def prompts():
    return _load("_prompts")


@pytest.fixture(scope="session")
def judge():
    return _load("_judge")
