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

from . import _calendar as cal
from . import _conversation as conv
from . import _engine as engine
from . import _host as host
from . import _judge as judge
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
# How often to look again for a model bound to the "judge" usage.
_MODEL_RECHECK_SECONDS = 60.0

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
        self._last_decay_day: str | None = None
        # Conversation bus -> exchanges -> scoring worker.
        self._cursor: conv.BusCursor | None = None
        self._tracker = conv.ExchangeTracker()
        self._jobs: queue.Queue[conv.Exchange | None] = queue.Queue(maxsize=_SCORE_QUEUE_MAX)
        self._worker: threading.Thread | None = None
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
        self._state_file = StateFile(self.data_path(_STATE_FILE))
        raw, warning = await asyncio.to_thread(self._state_file.load)
        if warning:
            self.logger.warning("与你相恋: {}", warning)
        with self._lock:
            self._state = engine.normalize_state(raw)
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
        await asyncio.to_thread(self._stop_worker)
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
        await self._poll_conversations()
        self._flush_context()
        # Also picks up day rollover: today's anniversaries live in the description.
        self._reconcile_tools()
        return Ok({"tools": len(self._registered)})

    # ------------------------------------------------------------ state helpers

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
        with self._lock:
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
            with self._lock:
                scope = self._effective_scope(bound_scope)
                record = engine.get_record(self._state, scope) or engine.new_record()
                if engine.mark_active(record):
                    self._try_save_locked()
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
                with self._lock:
                    scope = self._effective_scope(bound_scope)
                    record = engine.get_record(self._state, scope)
                    if record is None:
                        raise engine.EngineError("unknown_scope")
                    result = engine.apply_model_delta(record, delta, reason, gate=self._gate())
                    active = engine.mark_active(record)
                    if result["applied"] != 0 or active:
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
                with self._lock:
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
                self.push_message(
                    source=self.plugin_id,
                    visibility=[],
                    ai_behavior="read",
                    parts=[{"type": "text", "text": text}],
                    target_lanlan=target,
                    # Newest wins: an unread older state is dropped, not stacked.
                    coalesce_key=f"{self.plugin_id}:context:{target}",
                    metadata={"event_type": "relationship_context", "stage": stage},
                )
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
        messages = [message for message in (conv.parse_record(record) for record in records) if message]
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
        with self._lock:
            if message.role == "user":
                self._auto["seen"] += 1
                self._context_entry(message.lanlan)["turns"] += 1
                scope = engine.scope_key_for(self._state, message.lanlan)
                record = engine.get_record(self._state, scope)
                # A real chat message is the best activity signal decay can get.
                if record is not None and engine.mark_active(record):
                    self._try_save_locked()
            auto = bool(self._state["settings"].get("auto_score"))
        exchange = self._tracker.feed(message)
        if exchange is not None and auto:
            self._enqueue(exchange)

    # ------------------------------------------------------------ scoring worker

    def _enqueue(self, exchange: conv.Exchange) -> None:
        while True:
            try:
                self._jobs.put_nowait(exchange)
                return
            except queue.Full:
                try:
                    self._jobs.get_nowait()  # drop the oldest; the newest matters more
                except queue.Empty:
                    pass

    def _start_worker(self) -> None:
        if self._worker is not None and self._worker.is_alive():
            return
        self._stopping.clear()
        self._worker = threading.Thread(target=self._worker_main, name="love_with_you-score", daemon=True)
        self._worker.start()

    def _stop_worker(self) -> None:
        self._stopping.set()
        try:
            self._jobs.put_nowait(None)
        except queue.Full:
            pass
        worker = self._worker
        if worker is not None:
            worker.join(timeout=5.0)
        self._worker = None

    def _worker_main(self) -> None:
        loop = asyncio.new_event_loop()
        try:
            while not self._stopping.is_set():
                try:
                    job = self._jobs.get(timeout=1.0)
                except queue.Empty:
                    continue
                if job is None:
                    break
                try:
                    loop.run_until_complete(self._score(job))
                except Exception as exc:  # one bad exchange must not stop scoring
                    self._note_score_failure(f"crash_{type(exc).__name__}")
        finally:
            # The SDK keeps one gateway client per event loop; release ours.
            try:
                closer = getattr(self.ctx.models, "aclose", None)
                if callable(closer):
                    pending = closer()
                    if inspect.isawaitable(pending):
                        loop.run_until_complete(pending)
            except Exception:
                pass
            loop.close()

    async def _model_complete(self, prompt: str) -> tuple[str | None, str]:
        return await judge.complete(self.ctx.models, prompt)

    async def _score(self, exchange: conv.Exchange) -> None:
        with self._lock:
            if not self._state["settings"].get("auto_score"):
                return
            scope = engine.scope_key_for(self._state, exchange.lanlan)
            record = engine.get_record(self._state, scope) or engine.new_record()
            stage = engine.record_stage(record, int(record.get("affection", 0)))
            waiting = engine.awaiting_confession(record, self._gate())
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
        if time.monotonic() >= self._model_retry_at:
            text, status = await self._complete(prompt)
            verdict = scoring.parse_verdict(text) if text else None
            if text and verdict is None:
                status = "unparsable_reply"
            if status in (judge.UNBOUND, judge.UNAVAILABLE):
                # Binding changes are rare; re-check once a minute, not every turn.
                self._model_retry_at = time.monotonic() + _MODEL_RECHECK_SECONDS
            elif verdict is None:
                self._note_score_failure(status)
        mode = "model" if verdict is not None else "rules"
        if verdict is None:
            verdict = scoring.rule_verdict(exchange.user, exchange.reply, awaiting_confession=waiting)
        with self._lock:
            self._auto["mode"] = mode
            self._auto["model_status"] = "ok" if mode == "model" else status
        self._apply_verdict(scope, verdict, mode)

    def _apply_verdict(self, scope: str, verdict: scoring.Verdict, mode: str = "model") -> None:
        changes: list[tuple[str, str]] = []
        result: dict[str, Any] | None = None
        confessed = False
        with self._lock:
            record = engine.get_record(self._state, scope)
            if record is None:
                return
            gate = self._gate()
            if verdict.delta:
                result = engine.apply_model_delta(
                    record, verdict.delta, verdict.reason, gate=gate, cooldown=0, source="auto"
                )
                if result["stage_changed"]:
                    changes.append((result["previous_stage"], result["stage"]))
            if verdict.confession and engine.awaiting_confession(record, gate):
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
            if (result and result["applied"]) or confessed:
                self._try_save_locked()
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
        if changes:
            self._notify_stage_change(scope, changes[0][0], changes[-1][1])

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
        }

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
        with self._lock:
            try:
                result = engine.set_per_character(self._state, enabled, self._state["current_character"])
            except engine.EngineError as exc:
                return Err(SdkError(exc.code))
            if result["changed"]:
                # The switch itself counts as activity, so decay never bites a
                # record that was frozen while its mode was off.
                for _scope, record in engine.active_records(self._state):
                    engine.mark_active(record)
                self._save_locked()
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
            with self._lock:
                record = self._scope_record_locked(scope)
                result = engine.set_affection(record, value, source=source, gate=self._gate())
                self._save_locked()
        except engine.EngineError as exc:
            return Err(SdkError(exc.code))
        self.logger.info("与你相恋: {} scope={} value={}", source, scope, result["affection"])
        if result["stage_changed"]:
            self._notify_stage_change(str(scope), result["previous_stage"], result["stage"])
        self._reconcile_tools()
        return Ok(result)

    def _edit_scope(self, scope: Any, action: str, change: Callable[[dict[str, Any]], Any]):
        try:
            with self._lock:
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
            with self._lock:
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
        with self._lock:
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
        description=tr("entries.setSettings.description", default="开关告白门槛、好感随时间变淡和自动判断好感。"),
        input_schema={
            "type": "object",
            "properties": {
                "require_confession": {"type": "boolean"},
                "decay": {"type": "boolean"},
                "auto_score": {"type": "boolean"},
            },
        },
    )
    async def set_settings(self, require_confession: Any = None, decay: Any = None, auto_score: Any = None, **_: Any):
        changes = {
            key: value
            for key, value in (
                ("require_confession", require_confession),
                ("decay", decay),
                ("auto_score", auto_score),
            )
            if value is not None
        }
        notices: list[dict[str, str]] = []
        try:
            with self._lock:
                result = engine.update_settings(self._state, changes)
                active = {scope for scope, _record in engine.active_records(self._state)}
                notices = [change for change in result["stage_changes"] if change["scope"] in active]
                self._save_locked()
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
