"""Synthetic local benchmarks. Never reads the installed plugin or user saves."""

from __future__ import annotations

import argparse
import asyncio
import copy
import hashlib
import importlib.util
import inspect
import json
import statistics
import sys
import tempfile
import time
import tracemalloc
import zipfile
from datetime import date, timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

ROOT = Path(__file__).resolve().parents[1]


def load_runtime(source: Path):
    spec = importlib.util.spec_from_file_location("benchmark_runtime", ROOT / "tests" / "test_runtime.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    module.PLUGIN_ROOT = source
    patches = pytest.MonkeyPatch()
    generator = module.runtime.__wrapped__(patches, SimpleNamespace(time=time.time, monotonic=time.monotonic))
    return next(generator), generator, patches


def populate(runtime, directory: Path, count: int, independent: bool):
    ctx = SimpleNamespace(logger=Mock(), models=SimpleNamespace(aclose=AsyncMock()), data_dir=directory)
    plugin = runtime.LoveWithYouPlugin(ctx)
    plugin._ready = True
    state = plugin._state
    state["per_character"] = independent
    state["known_characters"] = [f"Role-{index}" for index in range(count)]
    state["current_character"] = state["known_characters"][0]
    today = date.today()
    record = runtime.engine.new_record(45)
    record["history"] = [
        {"ts": time.time() - index * 60, "delta": 1, "value": 45,
         "reason": "synthetic benchmark", "source": "auto"}
        for index in range(runtime.engine.HISTORY_LIMIT)
    ]
    record["daily"] = {(today - timedelta(days=index)).isoformat(): 45 for index in range(400)}
    state["shared"] = copy.deepcopy(record)
    for index, name in enumerate(state["known_characters"]):
        state["characters"][name] = copy.deepcopy(record)
        experience = runtime.experiences.new_record()
        experience["memories"] = [
            {"id": f"memory_{index:03}_{item:03}", "title": "Synthetic note", "text": "content " * 70,
             "status": "saved", "created_at": 1000 + item, "recall": True}
            for item in range(10)
        ]
        state["experiences"]["characters"][name] = experience
    state["experiences"]["enabled"] = True
    return plugin


def measure(operation, repeats=9):
    times = []
    for _ in range(repeats):
        start = time.perf_counter()
        operation()
        times.append((time.perf_counter() - start) * 1000)
    tracemalloc.start()
    operation()
    _, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    return {"median_ms": round(statistics.median(times), 3), "peak_kib": round(peak / 1024, 1)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--baseline-package", type=Path)
    args = parser.parse_args()
    baseline = tempfile.TemporaryDirectory(prefix="love-benchmark-source-")
    source = ROOT
    if args.baseline_package:
        source = Path(baseline.name)
        prefix = "payload/plugins/love_with_you/"
        with zipfile.ZipFile(args.baseline_package) as package:
            for name in package.namelist():
                if name.startswith(prefix) and name.endswith(".py"):
                    relative = Path(name[len(prefix):])
                    target = (source / relative).resolve()
                    if not target.is_relative_to(source):
                        raise ValueError("invalid benchmark source path")
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(package.read(name))
    runtime, generator, patches = load_runtime(source)
    results = {}
    try:
        with tempfile.TemporaryDirectory(prefix="love-benchmark-") as temporary, asyncio.Runner() as runner:
            for count in (16, 64):
                for independent in (False, True):
                    plugin = populate(runtime, Path(temporary), count, independent)
                    prefix = f"{count}_roles_{'independent' if independent else 'shared'}"
                    results[prefix + "_dashboard"] = measure(lambda: runner.run(plugin.dashboard()))

                    def transaction():
                        args = ("shop",) if "namespaces" in inspect.signature(
                            plugin._state_transaction_locked
                        ).parameters else ()
                        with plugin._lock, plugin._state_transaction_locked(*args):
                            pass

                    results[prefix + "_income_transaction_snapshot"] = measure(transaction)

                    plugin._state_file = runtime.StateFile(Path(temporary) / "state.json")

                    def income():
                        now = time.time()
                        plugin._state["shop"] = runtime.shop.new_state()
                        fingerprint = hashlib.sha256(b"synthetic exchange").hexdigest()
                        plugin._income_pending.append({
                            "id": fingerprint, "text": fingerprint, "user_at": now - 1, "reply_at": now,
                        })
                        with plugin._lock:
                            plugin._flush_income_locked()
                        assert not plugin._income_error and not plugin._income_pending
                        assert plugin._state["shop"]["days"][date.today().isoformat()]["count"] == 1

                    results[prefix + "_income_with_atomic_save"] = measure(income)
            library = runtime.portraits.PortraitLibrary(
                ROOT / "assets" / "portraits", runtime.StateFile(Path(temporary) / "portraits.json"),
            )
            library.summary()
            results["64_portraits_fixed_choose"] = measure(library.choose)
    finally:
        generator.close()
        patches.undo()
        baseline.cleanup()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(results, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
