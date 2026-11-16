"""Load backend packages without importing the SDK-dependent host entry.

The plugin runs from different locations (``plugin/plugins/love_with_you`` in
CI, a standalone folder during local development), so tests never rely on a
package import path. Business modules have no SDK imports.
"""

from __future__ import annotations

import importlib
import sys
import time
from pathlib import Path
from types import ModuleType, SimpleNamespace

import pytest

PLUGIN_ROOT = Path(__file__).resolve().parents[1]


def _load(name: str):
    package_name = "_love_with_you_test"
    if package_name not in sys.modules:
        package = ModuleType(package_name)
        package.__path__ = [str(PLUGIN_ROOT)]
        sys.modules[package_name] = package
    module_name = f"{package_name}.{name}"
    return importlib.import_module(module_name)


@pytest.fixture(scope="session")
def engine():
    return _load("backend.relationship.engine")


@pytest.fixture(scope="session")
def experiences():
    return _load("backend.relationship.experiences")


@pytest.fixture(scope="session")
def storage():
    return _load("backend.infrastructure.storage")


@pytest.fixture(scope="session")
def dashboard_projection():
    return _load("backend.relationship.dashboard")


@pytest.fixture(scope="session")
def appearance():
    return _load("backend.relationship.appearance")


@pytest.fixture(scope="session")
def portraits():
    return _load("backend.relationship.portraits")


@pytest.fixture(scope="session")
def shop():
    return _load("backend.relationship.shop")


@pytest.fixture(scope="session")
def commerce():
    return _load("backend.relationship.commerce")


@pytest.fixture(scope="session")
def cal():
    return _load("backend.relationship.calendar")


@pytest.fixture(scope="session")
def conv():
    return _load("backend.relationship.conversation")


@pytest.fixture(scope="session")
def scoring():
    return _load("backend.relationship.scoring")


@pytest.fixture(scope="session")
def prompts():
    return _load("backend.relationship.prompts")


@pytest.fixture(scope="session")
def judge():
    return _load("backend.infrastructure.judge")


@pytest.fixture
def module_clock():
    """Keep fake clocks inside the tested modules, away from other threads."""
    return SimpleNamespace(time=time.time, monotonic=time.monotonic)


@pytest.fixture
def host(monkeypatch, module_clock):
    module = _load("backend.infrastructure.host")
    monkeypatch.setattr(module, "time", module_clock)
    return module
