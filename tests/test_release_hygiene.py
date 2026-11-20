from __future__ import annotations

import importlib.util
import json
import zipfile
from pathlib import Path

import pytest


@pytest.fixture
def audit():
    path = Path(__file__).resolve().parents[1] / "tools/build/audit_release.py"
    spec = importlib.util.spec_from_file_location("_love_release_audit", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_credentials_are_reported_without_echoing_the_value(audit):
    token = ("sk-" + "Ab19xyZq" * 6).encode()
    findings = audit.scan_bytes(b"header\nvalue = '" + token + b"'\n", "fixture.py")
    assert findings[0]["rule"] == "api-token"
    assert findings[0]["line"] == 2
    assert token.decode() not in json.dumps(findings)


@pytest.mark.parametrize("path", [
    ".env", "backend/.env.production", "assets/private.key", "backend/config.toml",
    "state.json", "assets/state.pre-economy-v2.json", "static/adventure.json",
    "assets/custom_portraits/image.webp", "docs/architecture.md", "AGENTS.md",
    "tools/build/audit_release.py", "archive/old.py.bak", "../state.json",
])
def test_release_rejects_private_data_and_development_files(audit, path):
    assert not audit.package_path_allowed(path)


@pytest.mark.parametrize("path", [
    "__init__.py", "plugin.toml", "plugin.meta.json", "pyproject.toml", "README.md",
    "config.example.toml", "backend/adventure/service.py", "static/journey.json",
    "assets/portraits/catalog.json", "ui/panel.tsx", "i18n/en.json", "docs/guide.md",
])
def test_runtime_resources_and_user_guide_remain_publishable(audit, path):
    assert audit.package_path_allowed(path)


def test_package_scan_detects_a_leaked_save_and_credential(audit, tmp_path):
    package = tmp_path / "fixture.neko-plugin"
    secret = "ghp_" + "aB73xP" * 6
    with zipfile.ZipFile(package, "w") as archive:
        archive.writestr("payload/plugins/love_with_you/backend/.env", secret)
        archive.writestr("payload/plugins/love_with_you/static/adventure.json", "{}")
        archive.writestr("payload/plugins/love_with_you/static/journey.json", "{}")
    findings, count = audit.scan_package(package)
    assert count == 3
    assert sum(item["rule"] == "unexpected-package-file" for item in findings) == 2
    assert any(item["rule"] == "github-token" for item in findings)
    assert secret not in json.dumps(findings)
