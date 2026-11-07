"""与你相恋 — relationship / affection layer for N.E.K.O characters.

Architecture (see DESIGN.md):

* ``_engine``    pure affection/stage/nickname rules (unit tested, no SDK imports)
* ``_calendar``  pure anniversary arithmetic (unit tested)
* ``_conversation`` conversation-bus records -> (user message, reply) exchanges
* ``_scoring``   prompt + verdict parsing + offline keyword judge (unit tested)
* ``_judge``     model judging through the official plugin model gateway
* ``_storage``   atomic JSON state file in the plugin data dir
* ``_host``      read-only loopback queries to main_server
* ``_prompts``   model-facing text (relationship context, tool descriptions)

Threading: entries run on the plugin command loop; the maintenance timer runs
in its own thread with its own event loop; scoring runs on one worker thread
so a slow model call never blocks the timer. All state access goes through one
``threading.RLock`` and the lock is never held across an ``await``.
"""

from __future__ import annotations

import asyncio
import base64
import copy
import hashlib
import inspect
import queue
import threading
import time
from collections.abc import Iterable
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any, Callable

from plugin.sdk.plugin import (
    Err,
    NekoPluginBase,
    Ok,
    SdkError,
    lifecycle,
    neko_plugin,
    plugin_entry,
    timer_interval,
    tr,
    ui,
)

from . import _appearance as appearance
from . import _calendar as cal
from . import _conversation as conv
from . import _engine as engine
from . import _host as host
from . import _judge as judge
from . import _portraits as portraits
from . import _prompts as prompts
from . import _scoring as scoring
from ._storage import StateFile

_STATE_FILE = "state.json"
_SHARED_STATE_TOOL = "love_state"
_SHARED_UPDATE_TOOL = "love_update"
# Only registered while a record waits for its confession (gate on, value >= 80).
_SHARED_CONFESS_TOOL = "love_confess"

_CHARACTER_SYNC_SECONDS = 60.0
_TOOL_VERIFY_SECONDS = 120.0
_UI_HISTORY_LIMIT = 20

# Relationship context is pushed again after this many user messages even when
# nothing changed: the host summarises old turns away every ~10 turns.
_CONTEXT_REFRESH_TURNS = 6
_CONTEXT_RETRY_SECONDS = 60.0
# Conversation bus: recent records read per tick (filtered locally).
_BUS_POLL_LIMIT = 50
_WARN_THROTTLE_SECONDS = 300.0
# Exchanges waiting for scoring; the oldest is dropped when full.
_SCORE_QUEUE_MAX = 8
_SCORE_STOP_SECONDS = 5.0
_SCORE_CLOSE_SECONDS = 2.0
# How often to look again for a model bound to the "judge" usage.
_MODEL_RECHECK_SECONDS = 60.0
# Proactive confession is opt-in and deliberately sparse.  The state itself
# lives in each relationship record so a restart cannot repeat a confession.
_PROACTIVE_CONFESSION_SETTING = engine.PROACTIVE_CONFESSION_SETTING

# Artwork: assets/decoration.<ext> is the default; assets/stage_<stage>.<ext>
# replaces it while the relationship is at that stage.
_ART_DEFAULT = "decoration"
_ART_MIME = {
    ".webp": "image/webp",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
}
# UI replies travel over a ~4 MiB control channel that silently drops
# oversized frames, so each image is capped well below that.
_ART_MAX_BYTES = 1024 * 1024
_ART_CACHE_LIMIT = 6


@dataclass(frozen=True)
class _ScoreJob:
    exchange: conv.Exchange
    scope: str
    generation: int
    revision: int


def _role_suffix(name: str) -> str:
    """Stable ASCII suffix for a character name (tool names must be ASCII)."""
    return hashlib.sha256(name.encode("utf-8")).hexdigest()[:8]


def _record_events(
    record: dict[str, Any], anniversaries: list[dict[str, Any]], today: date, *, upcoming: bool
) -> list[dict[str, Any]]:
    lover_since = (record.get("milestones") or {}).get("lover")
    if upcoming:
        return cal.upcoming(record.get("first_met"), lover_since, anniversaries, today)
    return cal.today_events(record.get("first_met"), lover_since, anniversaries, today)


def _met_day(record: dict[str, Any], today: date) -> int:
    start = cal.parse_date(record.get("first_met"))
    return cal.day_number(start, today) if start else 1


@neko_plugin
class LoveWithYouPlugin(NekoPluginBase):
    def __init__(self, ctx: Any) -> None:
        super().__init__(ctx)
        self._lock = threading.RLock()
        self._state: dict[str, Any] = engine.new_state()
        self._state_file: StateFile | None = None
        self._ready = False
        self._host_online = False
        # Roles main_server currently holds a session for; None = unknown yet.
        self._live_roles: set[str] | None = None
        # tool name -> (role or None, description it was registered with)
        self._registered: dict[str, tuple[str | None, str]] = {}
        self._last_character_sync = 0.0
        self._last_tool_verify = 0.0
        # image path -> (version, data URL); insertion-ordered for eviction
        self._art_cache: dict[str, tuple[str, str]] = {}
        self._portraits: portraits.PortraitLibrary | None = None
        self._appearance: appearance.AppearancePrefs | None = None
        self._last_decay_day: str | None = None
        # Conversation bus -> exchanges -> scoring worker.
        self._cursor: conv.BusCursor | None = None
        self._tracker = conv.ExchangeTracker()
        self._latest_message_ts: dict[str, float] = {}
        # Dialogue text stays in memory, never in the persisted relationship.
        self._pending_answers: dict[str, list[conv.Message]] = {}
        self._jobs: queue.Queue[_ScoreJob | None] = queue.Queue(maxsize=_SCORE_QUEUE_MAX)
        self._score_generation = 0
        self._score_revisions: dict[str, int] = {}
        self._worker: threading.Thread | None = None
        self._worker_loop: asyncio.AbstractEventLoop | None = None
        self._score_task: asyncio.Task[None] | None = None
        self._score_job: _ScoreJob | None = None
        self._stopping = threading.Event()
        # (prompt) -> (text | None, status); replaceable in tests.
        self._complete: Callable[[str], Any] = self._model_complete
        # While the "judge" usage is unbound, skip the model until this time.
        self._model_retry_at = 0.0
        self._auto: dict[str, Any] = {
            "bus_ok": None,
            "bus_error": "",
            "seen": 0,
            "scored": 0,
            "failed": 0,
            "last_ts": None,
            "last_delta": 0,
            "last_error": "",
            # "model" | "rules" for the latest exchange; None before the first.
            "mode": None,
            "model_status": "",
        }
        self._bus_warned = 0.0
        self._score_warned = 0.0
        # character -> {key, turns, transition, retry_at}: what we last told it.
        self._context: dict[str, dict[str, Any]] = {}

    # ------------------------------------------------------------ lifecycle

    @lifecycle(id="startup")
    async def startup(self, **_: Any):
        with self._lock:
            if self._worker is not None and self._worker.is_alive():
                return Err(SdkError("scoring_worker_already_running"))
        self._state_file = StateFile(self.data_path(_STATE_FILE))
        raw, warning = await asyncio.to_thread(self._state_file.load)
        if warning:
            self.logger.warning("与你相恋: {}", warning)
        self._portraits = await asyncio.to_thread(
            portraits.PortraitLibrary,
            self.plugin_dir / "assets" / "portraits",
            StateFile(self.data_path("portraits.json")),
        )
        if self._portraits.warning:
            self.logger.warning("与你相恋: {}", self._portraits.warning)
        self._appearance = await asyncio.to_thread(
            appearance.AppearancePrefs, StateFile(self.data_path("appearance.json")),
        )
        if self._appearance.warning:
            self.logger.warning("与你相恋: {}", self._appearance.warning)
        with self._lock:
            self._state = engine.normalize_state(raw)
            self._invalidate_scoring_locked()
            recovered = False
            recovery_now = time.time()
            for _scope, record in engine.iter_records(self._state):
                state = engine.proactive_confession_state(record)
                if state["status"] == "dispatching":
                    recovered = self._expire_proactive_locked(state, recovery_now) or recovered
            if recovered or raw != self._state:
                self._try_save_locked()
            self._ready = True
        # Only messages from now on are scored; history was never scored live.
        self._cursor = conv.BusCursor(time.time())
        self._start_worker()
        # Only local work here: startup blocks the command loop, and
        # main_server may not be up yet. The timer handles the rest.
        self._reconcile_tools()
        return Ok({"status": "ready", "per_character": self._state["per_character"]})

    @lifecycle(id="shutdown")
    async def shutdown(self, **_: Any):
        # State is persisted on every change; the host clears our LLM tools on stop.
        if not await asyncio.to_thread(self._stop_worker):
            return Err(SdkError("scoring_worker_stop_timeout"))
        return Ok({"status": "stopped"})

    # timer_interval(name=...) takes a plain string, not a tr() reference.
    @timer_interval(id="maintain", seconds=5, name="maintain", auto_start=True)
    async def maintain(self, **_: Any):
        if not self._ready:
            return Ok({"skipped": "not_ready"})
        now = time.monotonic()
        if now - self._last_character_sync >= _CHARACTER_SYNC_SECONDS:
            await self._sync_characters()
        if now - self._last_tool_verify >= _TOOL_VERIFY_SECONDS:
            await self._verify_tools()
        self._daily_decay()
        self._expire_proactive_confessions()
        await self._poll_conversations()
        self._flush_context()
        # Also picks up day rollover: today's anniversaries live in the description.
        self._reconcile_tools()
        return Ok({"tools": len(self._registered)})

    # ------------------------------------------------------------ state helpers

    @contextmanager
    def _state_transaction_locked(self):
        """Roll back a failed edit before any later operation can persist it."""
        before = copy.deepcopy(self._state)
        try:
            yield
        except BaseException:
            self._state = before
            raise

    def _save_locked(self) -> None:
        """Persist the current state. Caller holds ``self._lock``."""
        if self._state_file is None:
            return
        try:
            self._state_file.save(self._state)
        except OSError as exc:
            self.logger.error("与你相恋: failed to save state: {}", exc)
            raise SdkError(f"failed to save state: {type(exc).__name__}") from exc

    def _try_save_locked(self) -> None:
        """Save from a read path; failures are logged by _save_locked and not raised."""
        try:
            self._save_locked()
        except SdkError:
            pass

    def _gate(self) -> bool:
        return bool(self._state.get("settings", {}).get("require_confession"))

    def _daily_decay(self) -> None:
        """Once per local day: advance every record's decay marker, decay active ones."""
        today = engine.today_str()
        if self._last_decay_day == today:
            return
        self._last_decay_day = today
        changes: list[tuple[str, int, int]] = []
        with self._lock:
            enabled = bool(self._state["settings"].get("decay"))
            active = {scope for scope, _record in engine.active_records(self._state)}
            for scope, record in engine.iter_records(self._state):
                removed = engine.apply_decay(record, enabled and scope in active)
                if removed:
                    changes.append((scope, removed, int(record["affection"])))
            self._try_save_locked()
        for scope, removed, value in changes:
            self.logger.info("与你相恋: decay scope={} removed={} value={}", scope, removed, value)

    def _expire_proactive_confessions(self) -> None:
        """Release unanswered proactive confessions after their wait window."""
        now = time.time()
        changed = False
        with self._lock:
            if not self._state["settings"].get(_PROACTIVE_CONFESSION_SETTING):
                return
            for scope, record in engine.active_records(self._state):
                state = engine.proactive_confession_state(record)
                if self._expire_proactive_locked(state, now):
                    self._pending_answers.pop(scope, None)
                    changed = True
            if changed:
                self._try_save_locked()

    @staticmethod
    def _expire_proactive_locked(state: dict[str, Any], now: float) -> bool:
        if state["status"] == "dispatching":
            # A crash can leave the durable state between the pre-send save
            # and the SDK call. The queue has no delivery receipt, so treat
            # that attempt as undelivered and allow a later retry.
            state.update(
                status="idle",
                attempts=max(0, int(state.get("attempts") or 0) - 1),
                waiting_since=None,
                reply_seen=False,
                reply_at=None,
                delivery_seen=False,
                cooldown_until=now + engine.PROACTIVE_CONFESSION_UNDELIVERED_COOLDOWN_SECONDS,
            )
            return True
        waiting_since = state.get("waiting_since")
        if state["status"] != "waiting" or waiting_since is None:
            return False
        if now - waiting_since < engine.PROACTIVE_CONFESSION_WAIT_SECONDS:
            return False
        delivered = bool(state.get("delivery_seen"))
        attempts = int(state.get("attempts") or 0)
        if not delivered:
            # ``push_message(submitted=True)`` only means that the local
            # queue accepted the payload. If no proactive reply reached the
            # conversation bus, do not spend one of the three real attempts.
            attempts = max(0, attempts - 1)
        state.update(
            status="idle",
            attempts=attempts,
            waiting_since=None,
            reply_seen=False,
            reply_at=None,
            delivery_seen=False,
            cooldown_until=now + (
                engine.PROACTIVE_CONFESSION_TIMEOUT_COOLDOWN_SECONDS
                if delivered
                else engine.PROACTIVE_CONFESSION_UNDELIVERED_COOLDOWN_SECONDS
            ),
        )
        return True

    def _cancel_proactive_locked(self, scope: str | None = None) -> None:
        """User edits invalidate outstanding proposals, preserving their limits."""
        for key, record in engine.iter_records(self._state):
            if scope is not None and scope != key:
                continue
            state = engine.proactive_confession_state(record)
            if state["status"] == "waiting":
                state.update(
                    status="idle",
                    waiting_since=None,
                    reply_seen=False,
                    reply_at=None,
                    delivery_seen=False,
                )

    def _scope_record_locked(self, scope: Any) -> dict[str, Any]:
        """Validate a scope coming from the panel. Caller holds ``self._lock``."""
        if not isinstance(scope, str) or not scope:
            raise engine.EngineError("scope_required")
        per_character = self._state["per_character"]
        if scope == engine.SHARED_SCOPE:
            if per_character:
                raise engine.EngineError("shared_not_in_use")
        elif not per_character:
            raise engine.EngineError("per_character_off")
        elif scope.startswith(engine.CHAR_SCOPE_PREFIX):
            name = scope[len(engine.CHAR_SCOPE_PREFIX) :]
            known = set(self._state["known_characters"]) | {self._state["current_character"]}
            if name not in known and name not in self._state["characters"]:
                raise engine.EngineError("unknown_scope")
        record = engine.get_record(self._state, scope)
        if record is None:
            raise engine.EngineError("unknown_scope")
        return record

    async def _sync_characters(self) -> None:
        self._last_character_sync = time.monotonic()
        result = await asyncio.to_thread(host.fetch_characters)
        self._host_online = result is not None
        if result is None:
            return
        names, current = result
        with self._lock, self._state_transaction_locked():
            changed = names != self._state["known_characters"]
            if current and current != self._state["current_character"]:
                self._state["current_character"] = current
                changed = True
            if changed:
                self._state["known_characters"] = names
                self._save_locked()

    async def _verify_tools(self) -> None:
        """Self-heal after a main_server restart dropped our registrations."""
        self._last_tool_verify = time.monotonic()
        tools_by_role = await asyncio.to_thread(host.fetch_tools_by_role)
        if tools_by_role is None:
            self._host_online = False
            return
        self._host_online = True
        self._live_roles = set(tools_by_role)
        with self._lock:
            missing = [
                name
                for name, (role, _description) in self._registered.items()
                if (role is None and any(name not in tools for tools in tools_by_role.values()))
                or (role is not None and role in tools_by_role and name not in tools_by_role[role])
            ]
        for name in missing:
            self.logger.info("与你相恋: tool {} missing on main_server, re-registering", name)
            self._unregister_tool(name)
        # The next _reconcile_tools() call registers them again.

    # ------------------------------------------------------------ tool registry

    def _desired_tools(self) -> dict[str, tuple[str | None, str, str, str]]:
        """tool name -> (role, scope, kind, description). Caller holds the lock."""
        state = self._state
        today = date.today()
        anniversaries = state.get("anniversaries", [])
        gate = self._gate()
        decay = bool(state["settings"].get("decay"))
        auto = bool(state["settings"].get("auto_score"))
        state_description = prompts.auto_state_tool_description() if auto else prompts.state_tool_description()

        def tools_for(record: dict[str, Any], role: str | None, scope: str, suffix: str):
            if auto:
                # The plugin scores by itself; a second scorer would double count.
                return {f"{_SHARED_STATE_TOOL}{suffix}": (role, scope, "state", state_description)}
            stage = engine.record_stage(record, int(record.get("affection", 0)))
            confess_name = f"{_SHARED_CONFESS_TOOL}{suffix}"
            waiting = engine.awaiting_confession(record, gate)
            idle = engine.idle_days(record, today)
            description = prompts.update_tool_description(
                stage,
                engine.effective_nickname(record, stage),
                _record_events(record, anniversaries, today, upcoming=False),
                confess_tool=confess_name if waiting else "",
                idle_days=idle if decay and idle >= engine.DECAY_GRACE_DAYS else 0,
            )
            tools = {
                f"{_SHARED_STATE_TOOL}{suffix}": (role, scope, "state", state_description),
                f"{_SHARED_UPDATE_TOOL}{suffix}": (role, scope, "update", description),
            }
            if waiting:
                tools[confess_name] = (role, scope, "confess", prompts.confess_tool_description())
            return tools

        if not state["per_character"]:
            return tools_for(state["shared"], None, engine.SHARED_SCOPE, "")
        roles = state["known_characters"]
        if self._live_roles is not None:
            roles = [name for name in roles if name in self._live_roles]
        desired: dict[str, tuple[str | None, str, str, str]] = {}
        for name in roles:
            scope = engine.CHAR_SCOPE_PREFIX + name
            record = engine.get_record(state, scope, create=False) or engine.new_record()
            desired.update(tools_for(record, name, scope, f"_{_role_suffix(name)}"))
        return desired

    def _tool_spec(self, kind: str, scope: str) -> tuple[dict[str, Any], Callable[..., Any]]:
        if kind == "update":
            return prompts.UPDATE_PARAMETERS, self._make_update_handler(scope)
        if kind == "confess":
            return prompts.CONFESS_PARAMETERS, self._make_confess_handler(scope)
        return prompts.STATE_PARAMETERS, self._make_state_handler(scope)

    def _reconcile_tools(self) -> None:
        with self._lock:
            desired = self._desired_tools()
            current = dict(self._registered)
        # A changed description (stage, nickname, today's anniversaries, idle
        # days, confession) means re-registering under the same name; the host
        # syncs it to live sessions.
        for name, (role, description) in current.items():
            target = desired.get(name)
            if target is None or target[0] != role or target[3] != description:
                self._unregister_tool(name)
        for name, (role, scope, kind, description) in desired.items():
            if name in self._registered:
                continue
            parameters, handler = self._tool_spec(kind, scope)
            try:
                self.register_llm_tool(
                    name=name,
                    description=description,
                    parameters=parameters,
                    handler=handler,
                    timeout=10.0,
                    role=role,
                )
            except Exception as exc:  # never let one tool block the others
                self.logger.warning("与你相恋: failed to register tool {}: {}", name, exc)
                continue
            self._registered[name] = (role, description)

    def _unregister_tool(self, name: str) -> None:
        try:
            self.unregister_llm_tool(name)
        except Exception as exc:
            self.logger.debug("与你相恋: unregister {} failed: {}", name, exc)
        self._registered.pop(name, None)

    def _effective_scope(self, bound_scope: str) -> str:
        """A tool may outlive a mode switch by a few seconds; follow the current mode."""
        if not self._state["per_character"]:
            return engine.SHARED_SCOPE
        if bound_scope == engine.SHARED_SCOPE:
            return engine.scope_key_for(self._state, self._state["current_character"])
        return bound_scope

    def _make_state_handler(self, bound_scope: str) -> Callable[..., Any]:
        async def handler(**_: Any) -> dict[str, Any]:
            today = date.today()
            with self._lock, self._state_transaction_locked():
                scope = self._effective_scope(bound_scope)
                created = engine.get_record(self._state, scope, create=False) is None
                record = engine.get_record(self._state, scope) or engine.new_record()
                active = engine.mark_active(record)
                if active or created:
                    self._save_locked()
                view = engine.record_view(record, history_limit=0, gate=self._gate())
                events = _record_events(record, self._state.get("anniversaries", []), today, upcoming=False)
                met_day = _met_day(record, today)
            self.logger.debug("与你相恋: love_state scope={}", scope)
            hint = {"hint": "只差一次真正的告白。"} if view["awaiting_confession"] else {}
            return {
                **hint,
                "affection": view["affection"],
                "stage": prompts.stage_name(view["stage"]),
                "tone": prompts.stage_tone(view["stage"]),
                "next_stage": prompts.stage_name(view["next_stage"]) if view["next_stage"] else None,
                "points_to_next": view["points_to_next"],
                "nickname": view["nickname"] or None,
                "days_since_met": met_day,
                "today": [prompts.event_text(event) for event in events],
                "note": prompts.KEEP_QUIET,
            }

        return handler

    def _make_update_handler(self, bound_scope: str) -> Callable[..., Any]:
        async def handler(delta: Any = None, reason: Any = None, **_: Any) -> dict[str, Any]:
            scope = bound_scope
            try:
                with self._lock, self._state_transaction_locked():
                    scope = self._effective_scope(bound_scope)
                    created = engine.get_record(self._state, scope, create=False) is None
                    record = engine.get_record(self._state, scope)
                    if record is None:
                        raise engine.EngineError("unknown_scope")
                    result = engine.apply_model_delta(record, delta, reason, gate=self._gate())
                    active = engine.mark_active(record)
                    if result["applied"] != 0 or active or created:
                        self._save_locked()
            except engine.EngineError as exc:
                self.logger.info("与你相恋: love_update rejected scope={} code={}", scope, exc.code)
                return {"output": {"reason": str(exc)}, "is_error": True, "error": exc.code.upper()}
            self.logger.info(
                "与你相恋: love_update scope={} requested={} applied={} value={} stage={} limited_by={} reason={}",
                scope,
                result["requested"],
                result["applied"],
                result["affection"],
                result["stage"],
                result["limited_by"],
                engine.clean_text(reason, engine.REASON_MAX_CHARS),
            )
            if result["stage_changed"]:
                self._notify_stage_change(scope, result["previous_stage"], result["stage"])
            output: dict[str, Any] = {
                "applied": result["applied"],
                "stage": prompts.stage_name(result["stage"]),
                "stage_changed": result["stage_changed"],
                "note": prompts.KEEP_QUIET,
            }
            if result["limited_by"] == "cooldown":
                output["limit"] = prompts.COOLDOWN_NOTE
            elif result["limited_by"] in ("daily_gain", "daily_loss"):
                output["limit"] = prompts.LIMIT_NOTE
            return output

        return handler

    def _make_confess_handler(self, bound_scope: str) -> Callable[..., Any]:
        async def handler(moment: Any = None, **_: Any) -> dict[str, Any]:
            scope = bound_scope
            try:
                with self._lock, self._state_transaction_locked():
                    scope = self._effective_scope(bound_scope)
                    record = engine.get_record(self._state, scope)
                    if record is None:
                        raise engine.EngineError("unknown_scope")
                    if not self._gate():
                        raise engine.EngineError("not_needed")
                    result = engine.confess(record, moment)
                    engine.mark_active(record)
                    nickname = engine.effective_nickname(record, result["stage"])
                    self._save_locked()
            except engine.EngineError as exc:
                self.logger.info("与你相恋: love_confess rejected scope={} code={}", scope, exc.code)
                return {"output": {"reason": str(exc)}, "is_error": True, "error": exc.code.upper()}
            # No read push: the model sees the result in this very turn.
            self.logger.info("与你相恋: confession scope={} {} -> {}", scope, result["previous_stage"], result["stage"])
            return {
                "stage": prompts.stage_name(result["stage"]),
                "stage_changed": result["stage_changed"],
                "note": prompts.confess_result_note(nickname),
            }

        return handler

    def _notify_stage_change(self, scope: str, previous: str, current: str) -> None:
        """Mark the affected characters' context for an immediate refresh.

        Thread-safe (the scoring worker calls it); the push itself happens in
        the next maintenance tick, still before the user's next message is
        answered in most cases, and the host only delivers it then anyway.
        """
        self.logger.info("与你相恋: stage changed scope={} {} -> {}", scope, previous, current)
        with self._lock:
            for target in self._context_targets_for_scope(scope):
                entry = self._context_entry(target)
                earlier = entry.get("transition")
                entry["transition"] = (earlier[0] if earlier else previous, current)

    # ------------------------------------------------------------ relationship context

    def _context_entry(self, target: str) -> dict[str, Any]:
        """Caller holds the lock."""
        entry = self._context.get(target)
        if entry is None:
            entry = {"key": None, "turns": 0, "transition": None, "retry_at": 0.0}
            self._context[target] = entry
        return entry

    def _context_targets_for_scope(self, scope: str) -> list[str]:
        """Characters whose context shows ``scope``. Caller holds the lock."""
        if scope.startswith(engine.CHAR_SCOPE_PREFIX):
            return [scope[len(engine.CHAR_SCOPE_PREFIX) :]]
        targets = set(self._context)
        current = self._state.get("current_character")
        if current:
            targets.add(current)
        return sorted(targets)

    def _flush_context(self) -> None:
        """Push the relationship state to each character that needs it.

        A push happens when what the character should know changed (stage,
        nickname, today's events, confession, idle spell), when a stage just
        changed, or after _CONTEXT_REFRESH_TURNS user messages.
        """
        now = time.monotonic()
        today = date.today()
        pushes: list[tuple[str, str, str, Any]] = []
        with self._lock:
            current = self._state.get("current_character")
            if current:
                self._context_entry(current)
            gate = self._gate()
            decay = bool(self._state["settings"].get("decay"))
            anniversaries = self._state.get("anniversaries", [])
            for target, entry in self._context.items():
                if entry["retry_at"] > now:
                    continue
                scope = engine.scope_key_for(self._state, target)
                record = engine.get_record(self._state, scope, create=False) or engine.new_record()
                stage = engine.record_stage(record, int(record.get("affection", 0)))
                nickname = engine.effective_nickname(record, stage)
                events = _record_events(record, anniversaries, today, upcoming=False)
                waiting = engine.awaiting_confession(record, gate)
                idle = engine.idle_days(record, today)
                idle = idle if decay and idle >= engine.DECAY_GRACE_DAYS else 0
                key = (scope, stage, nickname, waiting, idle, tuple(prompts.event_text(e) for e in events))
                transition = entry["transition"]
                if key == entry["key"] and transition is None and entry["turns"] < _CONTEXT_REFRESH_TURNS:
                    continue
                text = prompts.relationship_context(
                    stage,
                    nickname,
                    events,
                    awaiting_confession=waiting,
                    idle_days=idle,
                    transition=transition,
                )
                pushes.append((target, text, stage, (key, transition)))
        for target, text, stage, (key, transition) in pushes:
            try:
                receipt = self.push_message(
                    source=self.plugin_id,
                    visibility=[],
                    ai_behavior="read",
                    parts=[{"type": "text", "text": text}],
                    target_lanlan=target,
                    # Newest wins: an unread older state is dropped, not stacked.
                    coalesce_key=f"{self.plugin_id}:context:{target}",
                    metadata={"event_type": "relationship_context", "stage": stage},
                )
                if isinstance(receipt, dict) and receipt.get("submitted") is False:
                    raise RuntimeError("submission_rejected")
            except Exception as exc:
                with self._lock:
                    self._context_entry(target)["retry_at"] = now + _CONTEXT_RETRY_SECONDS
                self.logger.warning("与你相恋: context push to {} failed: {}", target, exc)
                continue
            with self._lock:
                entry = self._context_entry(target)
                entry["key"] = key
                entry["turns"] = 0
                entry["retry_at"] = 0.0
                # A change that landed while we were pushing waits for the next tick.
                if entry["transition"] == transition:
                    entry["transition"] = None
            self.logger.info("与你相恋: context pushed to {} stage={}", target, stage)

    # ------------------------------------------------------------ conversation bus

    async def _poll_conversations(self) -> None:
        """Read new user messages and replies from the host's conversation bus."""
        cursor = self._cursor
        if cursor is None:
            return
        bus = getattr(self.ctx, "bus", None)
        conversations = getattr(bus, "conversations", None)
        getter = getattr(conversations, "get", None)
        if not callable(getter):
            self._note_bus(False, "bus_unavailable")
            return
        try:
            result = getter(max_count=_BUS_POLL_LIMIT, timeout=2.0)
            if inspect.isawaitable(result):
                result = await result
        except Exception as exc:
            self._note_bus(False, f"read_{type(exc).__name__}")
            return
        if type(result).__name__ == "Err":
            self._note_bus(False, "read_error")
            return
        if type(result).__name__ == "Ok":
            result = getattr(result, "value", None)
        try:
            records = list(result) if isinstance(result, Iterable) and not isinstance(result, (str, bytes)) else []
        except TypeError:
            records = []
        self._note_bus(True, "")
        messages: list[conv.Message] = []
        for record in records:
            message = conv.parse_proactive_record(record) or conv.parse_record(record)
            if message:
                messages.append(message)
        for message in cursor.fresh(messages):
            self._on_message(message)

    def _note_bus(self, ok: bool, error: str) -> None:
        with self._lock:
            was = self._auto["bus_ok"]
            self._auto["bus_ok"] = ok
            self._auto["bus_error"] = error
        if ok and was is not True:
            self.logger.info("与你相恋: conversation bus readable")
        elif not ok:
            now = time.monotonic()
            if now - self._bus_warned >= _WARN_THROTTLE_SECONDS:
                self._bus_warned = now
                self.logger.warning("与你相恋: conversation bus not readable: {}", error)

    def _on_message(self, message: conv.Message) -> None:
        stage_change: tuple[str, str, str] | None = None
        with self._lock:
            if not self._ready or self._stopping.is_set():
                return
            if message.role == conv.PROACTIVE_REPLY_TURN:
                stage_change = self._on_proactive_reply_locked(message)
            else:
                self._latest_message_ts[message.lanlan] = max(
                    message.said_at, self._latest_message_ts.get(message.lanlan, 0)
                )
                if message.role == "user":
                    self._auto["seen"] += 1
                    self._context_entry(message.lanlan)["turns"] += 1
                    scope = engine.scope_key_for(self._state, message.lanlan)
                    created = engine.get_record(self._state, scope, create=False) is None
                    record = engine.get_record(self._state, scope)
                    # A real chat message is the best activity signal decay can get.
                    if record is not None:
                        active = engine.mark_active(record)
                        if active or created:
                            self._try_save_locked()
                    stage_change = self._handle_proactive_response_locked(message)
                elif message.role == "reply":
                    self._note_intervening_reply_locked(message)
                exchange = self._tracker.feed(message)
                if exchange is not None:
                    self._enqueue(exchange)
        if stage_change:
            self._notify_stage_change(stage_change[0], stage_change[1], stage_change[2])

    def _on_proactive_reply_locked(self, message: conv.Message) -> tuple[str, str, str] | None:
        """Mark that the host delivered a proactive reply for this character."""
        if not self._state["settings"].get(_PROACTIVE_CONFESSION_SETTING):
            return None
        metadata = message.metadata
        if metadata.get("event_type") is not None and metadata.get("event_type") != "proactive_confession":
            return None
        if metadata.get("plugin_id") is not None and metadata.get("plugin_id") != self.plugin_id:
            return None
        scope = engine.scope_key_for(self._state, message.lanlan)
        record = engine.get_record(self._state, scope, create=False)
        if record is None:
            return None
        state = engine.proactive_confession_state(record)
        if self._expire_proactive_locked(state, time.time()):
            self._pending_answers.pop(scope, None)
            self._try_save_locked()
        if state["status"] != "waiting" or state["target"] != message.lanlan:
            return None
        if state["reply_seen"]:
            self._note_intervening_reply_locked(message)
            return None
        if (
            message.said_at <= state["waiting_since"] or message.truncated
            or not scoring.confession_proposal(message.content)
        ):
            return None
        pending = sorted(self._pending_answers.pop(scope, []), key=lambda item: item.said_at)
        state["reply_seen"] = True
        state["reply_at"] = message.said_at
        state["delivery_seen"] = True
        self._tracker.reset(message.lanlan)
        self._try_save_locked()
        stage_change: tuple[str, str, str] | None = None
        for answer in pending:
            current_state = engine.proactive_confession_state(record)
            if current_state["status"] != "waiting":
                break
            stage_change = self._handle_proactive_response_locked(answer) or stage_change
        return stage_change

    def _note_intervening_reply_locked(self, message: conv.Message) -> None:
        """Another character turn can make a later standalone yes ambiguous."""
        scope = engine.scope_key_for(self._state, message.lanlan)
        record = engine.get_record(self._state, scope, create=False)
        if record is None:
            return
        state = engine.proactive_confession_state(record)
        if (
            state["status"] == "waiting" and state["target"] == message.lanlan
            and state["reply_seen"] and message.said_at > state["reply_at"] and not state["answer_turns"]
        ):
            state["answer_turns"] = 1
            self._try_save_locked()

    def _handle_proactive_response_locked(self, message: conv.Message) -> tuple[str, str, str] | None:
        """Apply an explicit answer to a delivered proactive confession."""
        if not self._state["settings"].get(_PROACTIVE_CONFESSION_SETTING):
            return None
        scope = engine.scope_key_for(self._state, message.lanlan)
        record = engine.get_record(self._state, scope, create=False)
        if record is None:
            return None
        state = engine.proactive_confession_state(record)
        if self._expire_proactive_locked(state, time.time()):
            self._pending_answers.pop(scope, None)
            self._try_save_locked()
        if state["status"] != "waiting" or state["target"] != message.lanlan or not state["reply_seen"]:
            if (
                state["status"] == "waiting"
                and state["target"] == message.lanlan
                and not state["reply_seen"]
                and message.said_at > (state.get("waiting_since") or 0)
            ):
                pending = self._pending_answers.setdefault(scope, [])
                if message not in pending:
                    pending.append(message)
                    pending.sort(key=lambda item: item.said_at)
                    del pending[:-4]
            return None
        if message.said_at <= state["reply_at"]:
            return None
        decision = None if message.truncated else scoring.proactive_response(
            message.content, require_relationship=state["answer_turns"] > 0
        )
        state["answer_turns"] = min(100, state["answer_turns"] + 1)
        if decision is None:
            self._try_save_locked()
            return None
        now = time.time()
        if decision == "refuse":
            state.update(
                status="declined",
                waiting_since=None,
                reply_seen=False,
                cooldown_until=now + engine.PROACTIVE_CONFESSION_COOLDOWN_SECONDS,
                delivery_seen=False,
            )
            self._try_save_locked()
            self.logger.info("与你相恋: proactive confession declined scope={}", scope)
            return None
        if not self._gate() or not engine.awaiting_confession(record, True):
            state.update(
                status="idle",
                waiting_since=None,
                reply_seen=False,
                delivery_seen=False,
            )
            self._try_save_locked()
            return None
        try:
            outcome = engine.confess(record, "猫娘主动告白后，对方明确答应了")
        except engine.EngineError:
            return None
        state.update(
            status="accepted",
            waiting_since=None,
            reply_seen=False,
            delivery_seen=False,
        )
        engine.mark_active(record)
        self._try_save_locked()
        self.logger.info("与你相恋: proactive confession accepted scope={}", scope)
        if outcome["stage_changed"]:
            return scope, outcome["previous_stage"], outcome["stage"]
        return None

    def _maybe_trigger_proactive_confession(self, job: _ScoreJob, verdict: scoring.Verdict) -> None:
        """Ask the character to confess once the opt-in conditions are met."""
        now = time.time()
        with self._lock:
            if (
                not self._score_current_locked(job) or verdict.delta < 0
                or not self._state["settings"].get(_PROACTIVE_CONFESSION_SETTING)
            ):
                return
            character, scope = job.exchange.lanlan, job.scope
            if self._latest_message_ts.get(character, job.exchange.said_at) > job.exchange.said_at:
                return  # a newer user message/reply arrived while the judge was working
            record = engine.get_record(self._state, scope, create=False)
            if (
                record is None or record["stage"] != "ambiguous"
                or not engine.awaiting_confession(record, self._gate())
            ):
                return
            state = engine.proactive_confession_state(record)
            if self._expire_proactive_locked(state, now):
                self._try_save_locked()
            if state["status"] == "waiting" or state["status"] == "accepted":
                return
            if state["attempts"] >= engine.PROACTIVE_CONFESSION_MAX_ATTEMPTS:
                return
            if float(state.get("cooldown_until") or 0.0) > now:
                return
            with self._state_transaction_locked():
                state.update(
                    status="dispatching",
                    attempts=state["attempts"] + 1,
                    last_attempt_at=now,
                    waiting_since=now,
                    reply_seen=False,
                    reply_at=None,
                    answer_turns=0,
                    target=character,
                    cooldown_until=now + engine.PROACTIVE_CONFESSION_TIMEOUT_COOLDOWN_SECONDS,
                    delivery_seen=False,
                )
                self._save_locked()
            self._pending_answers.pop(scope, None)
            # SDK submission is synchronous and only enqueues a local payload.
            # Keep the lock through it so a setting edit cannot race the send.
            try:
                receipt = self.push_message(
                    source=self.plugin_id,
                    visibility=[],
                    ai_behavior="respond",
                    parts=[{"type": "text", "text": prompts.proactive_confession_prompt()}],
                    target_lanlan=character,
                    coalesce_key=f"{self.plugin_id}:confession:{character}",
                    metadata={"event_type": "proactive_confession"},
                )
                if isinstance(receipt, dict) and receipt.get("submitted") is False:
                    raise RuntimeError("submission_rejected")
            except Exception as exc:
                state.update(
                    status="idle",
                    waiting_since=None,
                    reply_seen=False,
                    reply_at=None,
                    delivery_seen=False,
                    cooldown_until=now + engine.PROACTIVE_CONFESSION_UNDELIVERED_COOLDOWN_SECONDS,
                )
                self._try_save_locked()
                self.logger.warning("与你相恋: proactive confession to {} failed: {}", character, type(exc).__name__)
                return
            state.update(
                status="waiting",
                cooldown_until=now + engine.PROACTIVE_CONFESSION_TIMEOUT_COOLDOWN_SECONDS,
            )
            self._save_locked()
        self.logger.info("与你相恋: proactive confession requested character={} attempt={}", character, state["attempts"])

    # ------------------------------------------------------------ scoring worker

    def _score_current_locked(self, job: _ScoreJob) -> bool:
        return (
            self._ready
            and not self._stopping.is_set()
            and bool(self._state["settings"].get("auto_score"))
            and job.generation == self._score_generation
            and job.revision == self._score_revisions.get(job.scope, 0)
            and job.scope == engine.scope_key_for(self._state, job.exchange.lanlan)
        )

    def _invalidate_scoring_locked(self, scope: str | None = None) -> None:
        """Invalidate queued/in-flight results. Caller holds the state lock."""
        if scope is None:
            self._score_generation += 1
            self._score_revisions.clear()
        else:
            self._score_revisions[scope] = self._score_revisions.get(scope, 0) + 1
        character = (
            scope[len(engine.CHAR_SCOPE_PREFIX):] if scope and scope.startswith(engine.CHAR_SCOPE_PREFIX) else None
        )
        self._tracker.reset(character)
        if scope is None:
            self._pending_answers.clear()
        else:
            self._pending_answers.pop(scope, None)
        # Cancellation saves time; the revision check is still authoritative
        # when a model client finishes despite cancellation.
        task, loop, job = self._score_task, self._worker_loop, self._score_job
        if task is not None and loop is not None and job is not None and (scope is None or job.scope == scope):
            try:
                loop.call_soon_threadsafe(task.cancel)
            except RuntimeError:
                pass  # the worker already closed this loop

    def _enqueue(self, exchange: conv.Exchange) -> None:
        with self._lock:
            if not self._ready or self._stopping.is_set() or not self._state["settings"].get("auto_score"):
                return
            scope = engine.scope_key_for(self._state, exchange.lanlan)
            job = _ScoreJob(exchange, scope, self._score_generation, self._score_revisions.get(scope, 0))
            while True:
                try:
                    self._jobs.put_nowait(job)
                    return
                except queue.Full:
                    try:
                        self._jobs.get_nowait()  # drop the oldest; the newest matters more
                    except queue.Empty:
                        pass

    def _start_worker(self) -> None:
        with self._lock:
            if self._worker is not None and self._worker.is_alive():
                if self._stopping.is_set():
                    raise SdkError("scoring_worker_still_stopping")
                return
            if self._stopping.is_set():
                while True:
                    try:
                        self._jobs.get_nowait()
                    except queue.Empty:
                        break
            self._stopping.clear()
            self._worker = threading.Thread(target=self._worker_main, name="love_with_you-score", daemon=True)
            self._worker.start()

    def _stop_worker(self) -> bool:
        with self._lock:
            self._ready = False
            self._stopping.set()
            self._invalidate_scoring_locked()
            while True:
                try:
                    self._jobs.get_nowait()
                except queue.Empty:
                    break
            self._jobs.put_nowait(None)
            worker = self._worker
        if worker is not None:
            worker.join(timeout=_SCORE_STOP_SECONDS)
            if worker.is_alive():
                self.logger.warning("与你相恋: scoring worker is still stopping")
                return False
        with self._lock:
            if self._worker is worker:
                self._worker = None
        return True

    def _worker_main(self) -> None:
        loop = asyncio.new_event_loop()
        with self._lock:
            self._worker_loop = loop
        try:
            while not self._stopping.is_set():
                try:
                    job = self._jobs.get(timeout=1.0)
                except queue.Empty:
                    continue
                if job is None:
                    break
                with self._lock:
                    if not self._score_current_locked(job):
                        continue
                    task = loop.create_task(self._score(job))
                    self._score_task = task
                    self._score_job = job
                try:
                    loop.run_until_complete(task)
                except asyncio.CancelledError:
                    pass
                except Exception as exc:  # one bad exchange must not stop scoring
                    with self._lock:
                        if self._score_current_locked(job):
                            self._note_score_failure(f"crash_{type(exc).__name__}")
                finally:
                    with self._lock:
                        self._score_task = None
                        self._score_job = None
        finally:
            # The SDK keeps one gateway client per event loop; release ours.
            try:
                closer = getattr(self.ctx.models, "aclose", None)
                if callable(closer):
                    pending = closer()
                    if inspect.isawaitable(pending):
                        loop.run_until_complete(asyncio.wait_for(pending, timeout=_SCORE_CLOSE_SECONDS))
            except Exception:
                pass
            loop.close()
            with self._lock:
                self._worker_loop = None

    async def _model_complete(self, prompt: str) -> tuple[str | None, str]:
        return await judge.complete(self.ctx.models, prompt)

    async def _score(self, job: _ScoreJob) -> None:
        with self._lock:
            if not self._score_current_locked(job):
                return
            exchange = job.exchange
            record = engine.get_record(self._state, job.scope, create=False) or engine.new_record()
            stage = engine.record_stage(record, int(record.get("affection", 0)))
            waiting = engine.awaiting_confession(record, self._gate())
            if exchange.truncated:
                waiting = False
            proactive = record.get("proactive_confession", {})
            if proactive.get("status") in {"waiting", "declined"} and not scoring.confession_proposal(exchange.user):
                waiting = False  # proactive consent is handled only by the explicit response path
            prompt = scoring.build_prompt(
                character=exchange.lanlan,
                stage_name=prompts.stage_name(stage),
                affection=int(record.get("affection", 0)),
                user=exchange.user,
                reply=exchange.reply,
                previous_user=exchange.previous_user,
                previous_reply=exchange.previous_reply,
                awaiting_confession=waiting,
            )
        verdict: scoring.Verdict | None = None
        status = judge.UNBOUND
        model_attempted = time.monotonic() >= self._model_retry_at
        if model_attempted:
            text, status = await self._complete(prompt)
            verdict = scoring.parse_verdict(text) if text else None
            if text and verdict is None:
                status = "unparsable_reply"
        mode = "model" if verdict is not None else "rules"
        if verdict is None:
            verdict = scoring.rule_verdict(
                exchange.user, exchange.reply, previous_user=exchange.previous_user,
                previous_reply=exchange.previous_reply, awaiting_confession=waiting,
            )
        else:
            verdict = scoring.guard_verdict(
                verdict, user=exchange.user, reply=exchange.reply, previous_user=exchange.previous_user,
                previous_reply=exchange.previous_reply, awaiting_confession=waiting,
            )
        self._apply_verdict(job, verdict, mode, status, model_attempted=model_attempted)

    def _apply_verdict(
        self, job: _ScoreJob, verdict: scoring.Verdict, mode: str, status: str, *, model_attempted: bool
    ) -> None:
        changes: list[tuple[str, str]] = []
        result: dict[str, Any] | None = None
        confessed = False
        with self._lock:
            if not self._score_current_locked(job):
                return
            scope = job.scope
            created = engine.get_record(self._state, scope, create=False) is None
            record = engine.get_record(self._state, scope)
            if record is None:
                return
            self._auto["mode"] = mode
            self._auto["model_status"] = "ok" if mode == "model" else status
            if model_attempted and status in (judge.UNBOUND, judge.UNAVAILABLE):
                self._model_retry_at = time.monotonic() + _MODEL_RECHECK_SECONDS
            elif model_attempted and mode == "rules":
                self._note_score_failure(status)
            gate = self._gate()
            if verdict.delta:
                result = engine.apply_model_delta(
                    record, verdict.delta, verdict.reason, gate=gate, cooldown=0, source="auto"
                )
                if result["stage_changed"]:
                    changes.append((result["previous_stage"], result["stage"]))
            # A pending proactive proposal is confirmed only by the direct,
            # role-matched response handler. A stale/other character's score
            # result cannot shortcut that decision via model JSON.
            proactive = record.get("proactive_confession", {})
            consent_for_pending = (
                proactive.get("status") in {"waiting", "declined"}
                and not scoring.confession_proposal(job.exchange.user)
            )
            if (
                verdict.confession and not job.exchange.truncated
                and not consent_for_pending and engine.awaiting_confession(record, gate)
            ):
                try:
                    outcome = engine.confess(record, verdict.reason)
                except engine.EngineError:
                    outcome = None
                if outcome is not None:
                    confessed = True
                    if outcome["stage_changed"]:
                        changes.append((outcome["previous_stage"], outcome["stage"]))
            self._auto["scored"] += 1
            self._auto["last_ts"] = time.time()
            self._auto["last_delta"] = result["applied"] if result else 0
            if mode == "model":
                self._auto["last_error"] = ""
            if created or (result and result["applied"]) or confessed:
                self._try_save_locked()
            if changes:
                self._notify_stage_change(scope, changes[0][0], changes[-1][1])
        self.logger.info(
            "与你相恋: auto score mode={} scope={} requested={} applied={} value={} limited_by={} confession={} reason={}",
            mode,
            scope,
            verdict.delta,
            result["applied"] if result else 0,
            result["affection"] if result else "-",
            result["limited_by"] if result else None,
            confessed,
            verdict.reason,
        )
        # Trigger only after this exchange has been fully scored.  This keeps
        # the proactive flow quiet during idle timer ticks and prevents a
        # second confession from being queued while one is awaiting an answer.
        self._maybe_trigger_proactive_confession(job, verdict)

    def _note_score_failure(self, reason: str) -> None:
        with self._lock:
            self._auto["failed"] += 1
            self._auto["last_error"] = reason
        now = time.monotonic()
        if now - self._score_warned >= _WARN_THROTTLE_SECONDS:
            self._score_warned = now
            self.logger.warning("与你相恋: auto score failed: {}", reason)

    # ------------------------------------------------------------ artwork

    def _art_path(self, base: str) -> Path | None:
        assets = self.plugin_dir / "assets"
        for ext in _ART_MIME:
            path = assets / f"{base}{ext}"
            if path.is_file():
                return path
        return None

    def _art_meta(self, base: str) -> dict[str, Any]:
        path = self._art_path(base)
        if path is None:
            return {"available": False}
        stat = path.stat()
        if stat.st_size > _ART_MAX_BYTES:
            return {"available": False, "error": "too_large", "file": path.name, "size": stat.st_size}
        return {"available": True, "version": f"{path.name}:{stat.st_size}:{stat.st_mtime_ns}"}

    def _decoration_meta(self) -> dict[str, Any]:
        default = self._art_meta(_ART_DEFAULT)
        stages = {key: self._art_meta(f"stage_{key}") for key in engine.STAGE_KEYS}
        too_large = [meta["file"] for meta in (default, *stages.values()) if meta.get("error") == "too_large"]
        return {"default": default, "stages": stages, "too_large": too_large, "max": _ART_MAX_BYTES}

    def _load_decoration(self, stage: Any) -> dict[str, Any]:
        candidates = []
        if isinstance(stage, str) and stage in engine.STAGE_KEYS:
            candidates.append(f"stage_{stage}")
        candidates.append(_ART_DEFAULT)
        for base in candidates:
            path = self._art_path(base)
            if path is None:
                continue
            stat = path.stat()
            if stat.st_size > _ART_MAX_BYTES:
                continue
            version = f"{path.name}:{stat.st_size}:{stat.st_mtime_ns}"
            key = str(path)
            with self._lock:
                cached = self._art_cache.get(key)
            if cached and cached[0] == version:
                return {"available": True, "data_url": cached[1], "version": version}
            mime = _ART_MIME.get(path.suffix.lower(), "image/png")
            data_url = f"data:{mime};base64," + base64.b64encode(path.read_bytes()).decode("ascii")
            with self._lock:
                self._art_cache.pop(key, None)
                self._art_cache[key] = (version, data_url)
                while len(self._art_cache) > _ART_CACHE_LIMIT:
                    self._art_cache.pop(next(iter(self._art_cache)))
            return {"available": True, "data_url": data_url, "version": version}
        return {"available": False}

    # ------------------------------------------------------------ UI

    # ui.context(title=...) is typed str | None; the visible panel title comes from plugin.toml.
    @ui.context(id="dashboard", title="与你相恋")
    async def dashboard(self, **_: Any) -> dict[str, Any]:
        # No network here: the context call has a tight budget on the command loop.
        with self._lock:
            state = copy.deepcopy(self._state)
            auto_status = dict(self._auto)
        today = date.today()
        anniversaries: list[dict[str, Any]] = state.get("anniversaries", [])
        per_character = state["per_character"]
        current = state["current_character"]
        gate = bool(state["settings"].get("require_confession"))

        def scope_entry(key: str, label: str | None, is_current: bool, record: dict[str, Any]) -> dict[str, Any]:
            return {
                "key": key,
                "label": label,
                "is_current": is_current,
                **engine.record_view(record, _UI_HISTORY_LIMIT, gate=gate),
                "met_day": _met_day(record, today),
                "idle_days": engine.idle_days(record, today),
                "trend": engine.trend_view(record, engine.TREND_DAYS, today),
                "today_events": _record_events(record, anniversaries, today, upcoming=False),
                "upcoming": _record_events(record, anniversaries, today, upcoming=True),
            }

        scopes: list[dict[str, Any]] = []
        if per_character:
            names = list(state["known_characters"])
            if current and current not in names:
                names.insert(0, current)
            for name in names:
                record = state["characters"].get(name) or engine.new_record()
                scopes.append(scope_entry(engine.CHAR_SCOPE_PREFIX + name, name, name == current, record))
        else:
            scopes.append(scope_entry(engine.SHARED_SCOPE, None, True, state["shared"]))
        return {
            "per_character": per_character,
            "current_character": current,
            "known_characters": state["known_characters"],
            "host_online": self._host_online,
            "today": today.isoformat(),
            "settings": dict(state["settings"]),
            "decay_rules": {"grace_days": engine.DECAY_GRACE_DAYS, "per_day": engine.DECAY_PER_DAY},
            "auto_status": auto_status,
            "scopes": scopes,
            "anniversaries": sorted(anniversaries, key=lambda item: (item["month"], item["day"], item["title"])),
            "stages": [{"key": key, "min": lower} for key, lower in engine.STAGES],
            "limits": {
                "per_call": engine.MAX_DELTA_PER_CALL,
                "daily_gain": engine.DAILY_GAIN_CAP,
                "daily_loss": engine.DAILY_LOSS_CAP,
                "nickname_chars": engine.NICKNAME_MAX_CHARS,
                "title_chars": engine.ANNIVERSARY_TITLE_MAX_CHARS,
                "anniversaries": engine.ANNIVERSARY_LIMIT,
            },
            "decoration": await asyncio.to_thread(self._decoration_meta),
            "portraits": await asyncio.to_thread(self._portraits.summary) if self._portraits else None,
            "appearance": self._appearance.summary() if self._appearance else dict(appearance.DEFAULTS),
        }

    @ui.action(label=tr("actions.setAppearance.label", default="保存外观"), refresh_context=True)
    @plugin_entry(
        id="set_appearance",
        name=tr("actions.setAppearance.label", default="保存外观"),
        description=tr("entries.setAppearance.description", default="保存所有角色共用的主题色和深浅色模式。"),
        input_schema={"type": "object", "properties": {
            "accent_color": {"type": "string", "pattern": "^#[0-9a-fA-F]{6}$"},
            "color_scheme": {"type": "string", "enum": ["system", "light", "dark"]},
        }, "required": ["accent_color", "color_scheme"]},
    )
    async def set_appearance(self, accent_color: Any = None, color_scheme: Any = None, **_: Any):
        if self._appearance is None:
            return Err(SdkError("appearance_not_ready"))
        try:
            return Ok(await asyncio.to_thread(self._appearance.update, accent_color, color_scheme))
        except appearance.AppearanceError as exc:
            return Err(SdkError(str(exc)))
        except OSError:
            return Err(SdkError("appearance_save_failed"))

    @ui.action(label=tr("actions.setPerCharacter.label", default="切换独立好感"), refresh_context=True)
    @plugin_entry(
        id="set_per_character",
        name=tr("entries.setPerCharacter.name", default="设置独立好感模式"),
        description=tr(
            "entries.setPerCharacter.description",
            default="开启后每个角色单独计算好感；切换不会重置任何角色的好感。",
        ),
        input_schema={
            "type": "object",
            "properties": {"enabled": {"type": "boolean"}},
            "required": ["enabled"],
        },
    )
    async def set_per_character(self, enabled: Any = None, **_: Any):
        if not isinstance(enabled, bool):
            return Err(SdkError("enabled must be a boolean"))
        await self._sync_characters()
        with self._lock, self._state_transaction_locked():
            try:
                result = engine.set_per_character(self._state, enabled, self._state["current_character"])
            except engine.EngineError as exc:
                return Err(SdkError(exc.code))
            if result["changed"]:
                self._cancel_proactive_locked()
                # The switch itself counts as activity, so decay never bites a
                # record that was frozen while its mode was off.
                for _scope, record in engine.active_records(self._state):
                    engine.mark_active(record)
                self._save_locked()
                self._invalidate_scoring_locked()
        if result["changed"]:
            self.logger.info("与你相恋: per_character={} current={}", enabled, result.get("current_character"))
        self._reconcile_tools()
        return Ok(result)

    # The panel confirms through its own slider modal; no second confirm here.
    @ui.action(label=tr("actions.setAffection.label", default="调整好感"), refresh_context=True)
    @plugin_entry(
        id="set_affection",
        name=tr("entries.setAffection.name", default="手动设置好感"),
        description=tr("entries.setAffection.description", default="把指定范围的好感度设为 0–100 的值。"),
        input_schema={
            "type": "object",
            "properties": {"scope": {"type": "string"}, "value": {"type": "integer"}},
            "required": ["scope", "value"],
        },
    )
    async def set_affection(self, scope: Any = None, value: Any = None, **_: Any):
        return self._manual_set(scope, value, source="manual")

    @ui.action(
        label=tr("actions.resetAffection.label", default="重置好感"),
        tone="danger",
        confirm=True,
        refresh_context=True,
    )
    @plugin_entry(
        id="reset_affection",
        name=tr("entries.resetAffection.name", default="重置好感"),
        description=tr("entries.resetAffection.description", default="把指定范围的好感度清零，记录会保留一条重置。"),
        input_schema={
            "type": "object",
            "properties": {"scope": {"type": "string"}},
            "required": ["scope"],
        },
    )
    async def reset_affection(self, scope: Any = None, **_: Any):
        return self._manual_set(scope, 0, source="reset")

    def _manual_set(self, scope: Any, value: Any, *, source: str):
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return Err(SdkError("value must be a number"))
        try:
            with self._lock, self._state_transaction_locked():
                record = self._scope_record_locked(scope)
                result = engine.set_affection(record, value, source=source, gate=self._gate())
                self._cancel_proactive_locked(str(scope))
                self._save_locked()
                self._invalidate_scoring_locked(str(scope))
        except engine.EngineError as exc:
            return Err(SdkError(exc.code))
        self.logger.info("与你相恋: {} scope={} value={}", source, scope, result["affection"])
        if result["stage_changed"]:
            self._notify_stage_change(str(scope), result["previous_stage"], result["stage"])
        self._reconcile_tools()
        return Ok(result)

    def _edit_scope(self, scope: Any, action: str, change: Callable[[dict[str, Any]], Any]):
        try:
            with self._lock, self._state_transaction_locked():
                record = self._scope_record_locked(scope)
                result = change(record)
                self._save_locked()
        except engine.EngineError as exc:
            return Err(SdkError(exc.code))
        self.logger.info("与你相恋: {} scope={}", action, scope)
        self._reconcile_tools()
        return Ok({"scope": scope, "result": result})

    @ui.action(label=tr("actions.setNicknames.label", default="保存称呼"), refresh_context=True)
    @plugin_entry(
        id="set_nicknames",
        name=tr("entries.setNicknames.name", default="设置称呼"),
        description=tr(
            "entries.setNicknames.description",
            default="设置角色在每个关系阶段对你的称呼；留空的阶段沿用上一阶段。",
        ),
        input_schema={
            "type": "object",
            "properties": {
                "scope": {"type": "string"},
                "nicknames": {"type": "object", "additionalProperties": {"type": "string"}},
            },
            "required": ["scope", "nicknames"],
        },
    )
    async def set_nicknames(self, scope: Any = None, nicknames: Any = None, **_: Any):
        return self._edit_scope(scope, "set_nicknames", lambda record: engine.set_nicknames(record, nicknames))

    @ui.action(label=tr("actions.setFirstMet.label", default="修改相识日"), refresh_context=True)
    @plugin_entry(
        id="set_first_met",
        name=tr("entries.setFirstMet.name", default="设置相识日"),
        description=tr(
            "entries.setFirstMet.description", default="修改你和角色相识的日期（YYYY-MM-DD），用于计算纪念日。"
        ),
        input_schema={
            "type": "object",
            "properties": {"scope": {"type": "string"}, "date": {"type": "string"}},
            "required": ["scope", "date"],
        },
    )
    async def set_first_met(self, scope: Any = None, date: Any = None, **_: Any):
        return self._edit_scope(scope, "set_first_met", lambda record: engine.set_first_met(record, date))

    @ui.action(label=tr("actions.addAnniversary.label", default="添加纪念日"), refresh_context=True)
    @plugin_entry(
        id="add_anniversary",
        name=tr("entries.addAnniversary.name", default="添加纪念日"),
        description=tr("entries.addAnniversary.description", default="添加每年重复的纪念日，所有角色都会记得。"),
        input_schema={
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "month": {"type": "integer"},
                "day": {"type": "integer"},
            },
            "required": ["title", "month", "day"],
        },
    )
    async def add_anniversary(self, title: Any = None, month: Any = None, day: Any = None, **_: Any):
        try:
            with self._lock, self._state_transaction_locked():
                item = engine.add_anniversary(self._state, title, month, day)
                self._save_locked()
        except engine.EngineError as exc:
            return Err(SdkError(exc.code))
        self.logger.info("与你相恋: anniversary added id={} {}-{}", item["id"], item["month"], item["day"])
        self._reconcile_tools()
        return Ok(item)

    @ui.action(label=tr("actions.removeAnniversary.label", default="删除纪念日"), tone="danger", refresh_context=True)
    @plugin_entry(
        id="remove_anniversary",
        name=tr("entries.removeAnniversary.name", default="删除纪念日"),
        description=tr("entries.removeAnniversary.description", default="删除一个自定义纪念日。"),
        input_schema={
            "type": "object",
            "properties": {"id": {"type": "string"}},
            "required": ["id"],
        },
    )
    async def remove_anniversary(self, id: Any = None, **_: Any):  # noqa: A002 - entry argument name
        with self._lock, self._state_transaction_locked():
            removed = engine.remove_anniversary(self._state, id)
            if removed:
                self._save_locked()
        if not removed:
            return Err(SdkError("not_found"))
        self.logger.info("与你相恋: anniversary removed id={}", id)
        self._reconcile_tools()
        return Ok({"removed": True})

    @ui.action(label=tr("actions.setSettings.label", default="保存设置"), refresh_context=True)
    @plugin_entry(
        id="set_settings",
        name=tr("entries.setSettings.name", default="修改设置"),
        description=tr(
            "entries.setSettings.description", default="开关告白门槛、主动告白、好感随时间变淡和自动判断好感。"
        ),
        input_schema={
            "type": "object",
            "properties": {
                "require_confession": {"type": "boolean"},
                "decay": {"type": "boolean"},
                "auto_score": {"type": "boolean"},
                "proactive_confession": {"type": "boolean"},
            },
        },
    )
    async def set_settings(
        self,
        require_confession: Any = None,
        decay: Any = None,
        auto_score: Any = None,
        proactive_confession: Any = None,
        **_: Any,
    ):
        changes = {
            key: value
            for key, value in (
                ("require_confession", require_confession),
                ("decay", decay),
                ("auto_score", auto_score),
                ("proactive_confession", proactive_confession),
            )
            if value is not None
        }
        notices: list[dict[str, str]] = []
        try:
            with self._lock, self._state_transaction_locked():
                before = dict(self._state["settings"])
                result = engine.update_settings(self._state, changes)
                invalidate = any(
                    before.get(key, False) != result["settings"].get(key, False)
                    for key in ("auto_score", "require_confession")
                )
                if invalidate:
                    self._cancel_proactive_locked()
                if before.get(_PROACTIVE_CONFESSION_SETTING, False) and not result["settings"].get(
                    _PROACTIVE_CONFESSION_SETTING, False
                ):
                    self._cancel_proactive_locked()
                active = {scope for scope, _record in engine.active_records(self._state)}
                notices = [change for change in result["stage_changes"] if change["scope"] in active]
                self._save_locked()
                if invalidate:
                    self._invalidate_scoring_locked()
                elif not result["settings"].get(_PROACTIVE_CONFESSION_SETTING, False):
                    self._pending_answers.clear()
        except engine.EngineError as exc:
            return Err(SdkError(exc.code))
        self.logger.info("与你相恋: settings {}", result["settings"])
        for change in notices:
            self._notify_stage_change(change["scope"], change["from"], change["to"])
        self._reconcile_tools()
        return Ok(result)

    @ui.action(label=tr("actions.getDecoration.label", default="读取装饰图"), refresh_context=False)
    @plugin_entry(
        id="get_decoration",
        name=tr("entries.getDecoration.name", default="读取装饰图"),
        description=tr("entries.getDecoration.description", default="读取插件 assets 目录中的装饰立绘。"),
        input_schema={"type": "object", "properties": {"stage": {"type": "string"}}},
    )
    async def get_decoration(self, stage: Any = None, **_: Any):
        try:
            return Ok(await asyncio.to_thread(self._load_decoration, stage))
        except OSError as exc:
            return Err(SdkError(f"decoration unreadable: {type(exc).__name__}"))

    async def _portrait_call(self, method: str, *args: Any):
        if self._portraits is None:
            return Err(SdkError("portrait_not_ready"))
        try:
            result = await asyncio.to_thread(getattr(self._portraits, method), *args)
            return Ok(result)
        except portraits.PortraitError as exc:
            return Err(SdkError(str(exc)))
        except OSError:
            return Err(SdkError("portrait_save_failed"))

    @ui.action(label=tr("actions.listPortraits.label", default="浏览立绘"), refresh_context=False)
    @plugin_entry(
        id="list_portraits",
        name=tr("actions.listPortraits.label", default="浏览立绘"),
        description=tr("entries.listPortraits.description", default="分页浏览共用立绘库。"),
        input_schema={"type": "object", "properties": {
            "page": {"type": "integer"}, "collection": {"type": "string"}, "query": {"type": "string"},
        }},
    )
    async def list_portraits(self, page: Any = 0, collection: Any = "", query: Any = "", **_: Any):
        return await self._portrait_call("list_items", page, collection, query)

    @ui.action(label=tr("actions.getPortrait.label", default="读取立绘"), refresh_context=False)
    @plugin_entry(
        id="get_portrait",
        name=tr("actions.getPortrait.label", default="读取立绘"),
        description=tr("entries.getPortrait.description", default="按图片 ID 读取展示图或缩略图。"),
        input_schema={"type": "object", "properties": {
            "item_id": {"type": "string"}, "thumbnail": {"type": "boolean"},
        }, "required": ["item_id"]},
    )
    async def get_portrait(self, item_id: Any = None, thumbnail: Any = False, **_: Any):
        return await self._portrait_call("image", item_id, thumbnail)

    @ui.action(label=tr("actions.choosePortrait.label", default="换一张立绘"), refresh_context=False)
    @plugin_entry(
        id="choose_portrait",
        name=tr("actions.choosePortrait.label", default="换一张立绘"),
        description=tr("entries.choosePortrait.description", default="按共用偏好选取立绘，随机时避免紧接着重复。"),
        input_schema={"type": "object", "properties": {"previous_id": {"type": "string"}}},
    )
    async def choose_portrait(self, previous_id: Any = "", **_: Any):
        return await self._portrait_call("choose", previous_id)

    @ui.action(label=tr("actions.setPortraits.label", default="保存立绘设置"), refresh_context=True)
    @plugin_entry(
        id="set_portraits",
        name=tr("actions.setPortraits.label", default="保存立绘设置"),
        description=tr("entries.setPortraits.description", default="保存所有角色共用的立绘模式、固定图片和随机范围。"),
        input_schema={"type": "object", "properties": {
            "mode": {"type": "string", "enum": ["fixed", "random", "off", "legacy"]},
            "selected_id": {"type": "string"},
            "pool_ids": {"type": ["array", "null"], "items": {"type": "string"}},
        }, "required": ["mode", "selected_id", "pool_ids"]},
    )
    async def set_portraits(self, mode: Any = None, selected_id: Any = "", pool_ids: Any = None, **_: Any):
        return await self._portrait_call("update", mode, selected_id, pool_ids)

    @ui.action(label=tr("actions.syncCharacters.label", default="刷新角色"), refresh_context=True)
    @plugin_entry(
        id="sync_characters",
        name=tr("entries.syncCharacters.name", default="刷新角色列表"),
        description=tr("entries.syncCharacters.description", default="从 N.E.K.O 重新读取角色列表与当前角色。"),
    )
    async def sync_characters(self, **_: Any):
        await self._sync_characters()
        self._reconcile_tools()
        with self._lock:
            return Ok(
                {
                    "host_online": self._host_online,
                    "characters": list(self._state["known_characters"]),
                    "current": self._state["current_character"],
                }
            )
