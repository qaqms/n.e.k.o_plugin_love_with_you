"""Create a disposable development package with the host-required directory name."""

from __future__ import annotations

import shutil
import tempfile
import tomllib
from pathlib import Path

_EXCLUDED = {
    ".git", ".github", ".vscode", ".benchmarks", ".venv", "venv",
    "__pycache__", ".pytest_cache", ".ruff_cache", ".mypy_cache", "node_modules",
    "tests", "tools", "dist", "build", ".env", ".DS_Store",
}
_MARKER = ".prepared-source"


def prepare(source: Path) -> Path:
    source = source.resolve(strict=True)
    with (source / "plugin.toml").open("rb") as handle:
        plugin = tomllib.load(handle)["plugin"]
    plugin_id = plugin["id"]
    if not isinstance(plugin_id, str) or not plugin_id.isidentifier():
        raise ValueError("Development package requires a Python package identifier")
    if plugin["entry"].split(":", 1)[0] != f"plugin.plugins.{plugin_id}":
        raise ValueError("Development entry must match the plugin ID")
    # Keep the generated Python outside the source tree: the host's static
    # checker otherwise discovers every entry twice, even with build excludes.
    output_root = source.parent / ".neko-dev"
    output_root.mkdir(exist_ok=True)
    if output_root.resolve() != output_root:
        raise ValueError("Development output must stay beside the source directory")
    target = output_root / plugin_id
    if target.resolve() != target:
        raise ValueError("Development target must not be a link")
    if target.exists():
        marker = target / _MARKER
        if not marker.is_file() or marker.read_text(encoding="utf-8") != str(source):
            raise ValueError(f"Refusing to replace an unmanaged directory: {target}")

    def ignore(_directory: str, names: list[str]) -> set[str]:
        return {
            name for name in names
            if name in _EXCLUDED or name.startswith("pytest-of-") or name.endswith((".pyc", ".pyo"))
        }

    with tempfile.TemporaryDirectory(prefix="prepare-", dir=output_root) as temporary:
        staged = Path(temporary) / plugin_id
        shutil.copytree(source, staged, ignore=ignore)
        (staged / _MARKER).write_text(str(source), encoding="utf-8")
        # Only this script's verified, generated directory may be replaced.
        if target.exists():
            shutil.rmtree(target)
        staged.rename(target)
    return target


if __name__ == "__main__":
    print(prepare(Path(__file__).resolve().parents[1]))
