from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest


@pytest.mark.parametrize("phase", ["client", "completion"])
def test_judge_deadline_covers_client_acquisition_and_generation(judge, monkeypatch, phase):
    monkeypatch.setattr(judge, "TIMEOUT_SECONDS", 0.01)
    cancelled = []

    async def stall():
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.append(phase)

    async def create(**_):
        return await stall()

    client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))

    async def get_client():
        return await stall() if phase == "client" else client

    async def scenario():
        return await asyncio.wait_for(judge.complete(SimpleNamespace(get_client=get_client), "test"), 0.5)

    assert asyncio.run(scenario()) == (None, "timeout")
    assert cancelled == [phase]


def test_external_cancellation_stays_cancellation(judge):
    async def scenario():
        started = asyncio.Event()

        async def get_client():
            started.set()
            await asyncio.Event().wait()

        pending = asyncio.create_task(judge.complete(SimpleNamespace(get_client=get_client), "test"))
        await started.wait()
        pending.cancel()
        with pytest.raises(asyncio.CancelledError):
            await pending

    asyncio.run(scenario())
