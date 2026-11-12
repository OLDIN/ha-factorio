"""Game state as Home Assistant should see it. Independent of HA and of the provider."""

from __future__ import annotations

from collections import deque
from collections.abc import Callable, Mapping
from datetime import timedelta
from typing import Any

from homeassistant.util import dt as dt_util

from .const import (
    CATEGORIES,
    CONF_LINE_OUTPUT_FULL,
    DEFAULT_LINE_OUTPUT_FULL,
    DEFAULT_LINE_MINUTES,
    DEFAULT_LINE_SHARE,
    EVENT_WINDOW_MINUTES,
    MAX_RECENT_EVENTS,
    PROTOCOL_VERSION,
)
from .lines import TICKS_PER_MINUTE, DrillTracker, LineTracker
from .providers.base import ProviderMessage


def build_config(options: Mapping[str, Any]) -> dict[str, Any]:
    """The 'what to collect' config sent to the game; categories default to on."""
    return {
        "v": PROTOCOL_VERSION,
        "categories": {c: bool(options.get(c, True)) for c in CATEGORIES},
        "lines": {"output_full": bool(options.get(CONF_LINE_OUTPUT_FULL, DEFAULT_LINE_OUTPUT_FULL))},
    }


def as_dict(value: Any) -> dict:
    """Lua serialises an empty table as [] (or {}); anything but a dict is empty."""
    return value if isinstance(value, dict) else {}


def as_list(value: Any) -> list:
    """Lua serialises an empty table as {} (or []); anything but a list is empty."""
    return value if isinstance(value, list) else []


def _is_tick(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


class FactorioCore:
    def __init__(self, server_id: str) -> None:
        self.server_id = server_id
        self.relay_online: bool | None = None
        self._state: dict[str, Any] = {}
        self._hello: dict[str, Any] = {}
        self._categories: dict[str, dict[str, Any]] = {}
        # Newest last; only the newest MAX_RECENT_EVENTS can ever be shown.
        self._events: deque[tuple[Any, dict[str, Any]]] = deque(maxlen=MAX_RECENT_EVENTS)
        self._listeners: list[Callable[[], None]] = []
        self._event_listeners: list[Callable[[str, dict[str, Any]], None]] = []
        self._lines = LineTracker()
        self._drills = DrillTracker()
        self._line_share = DEFAULT_LINE_SHARE / 100
        self._line_hold_ticks = DEFAULT_LINE_MINUTES * TICKS_PER_MINUTE
        self._line_output_full = DEFAULT_LINE_OUTPUT_FULL

    # --- input --------------------------------------------------------------

    def handle_message(self, msg: ProviderMessage) -> None:
        if msg.kind == "availability":
            self.relay_online = msg.payload == "online"
        elif msg.kind == "state" and isinstance(msg.payload, dict):
            self._state = msg.payload
        elif msg.kind == "hello" and isinstance(msg.payload, dict):
            self._hello = msg.payload
        elif msg.kind == "data" and isinstance(msg.payload, dict) and isinstance(msg.payload.get("category"), str):
            category = msg.payload["category"]
            data = msg.payload.get("data")
            tick = msg.payload.get("tick")
            if isinstance(data, dict):
                self._categories[category] = data
            else:
                self._categories.pop(category, None)
            events = self._track_category(category, data if isinstance(data, dict) else None, tick)
            self._emit(events, notify=False)  # the generic notification below covers it
        elif msg.kind == "tick" and isinstance(msg.payload, dict) and _is_tick(msg.payload.get("tick")):
            self._handle_clock(msg.payload["tick"])
            return
        elif msg.kind == "event" and isinstance(msg.payload, dict) and isinstance(msg.payload.get("event"), str):
            data = msg.payload.get("data")
            self._publish_event(msg.payload["event"], msg.payload.get("time"), data)
            return
        else:
            return
        for listener in list(self._listeners):
            listener()

    def _track_category(self, category: str, data: dict | None, tick: Any) -> list[tuple[str, dict[str, Any]]]:
        """Feed the line and drill trackers; a category that went away resets its tracker."""
        if category == "machines":
            if data is None:
                self._lines.reset()
            elif _is_tick(tick):
                return self._lines.update(
                    as_dict(data.get("by_planet")),
                    tick,
                    self._line_share,
                    self._line_hold_ticks,
                    from_clock=False,
                    output_full=self._line_output_full,
                )
        elif category == "drills":
            if data is None:
                self._drills.reset()
            elif _is_tick(tick):
                return self._drills.update(as_dict(data.get("by_planet")), tick)
        return []

    def _handle_clock(self, tick: int) -> None:
        """The game clock advances the hold time even when no category changes."""
        machines = self.category("machines")
        if machines is None:
            return
        before = self._all_problems()
        events = self._lines.update(
            as_dict(machines.get("by_planet")),
            tick,
            self._line_share,
            self._line_hold_ticks,
            from_clock=True,
            output_full=self._line_output_full,
        )
        self._emit(events, notify=bool(events) or self._all_problems() != before)

    def _all_problems(self) -> dict[str, list[dict]]:
        planets = as_dict(as_dict(self.category("machines")).get("by_planet"))
        return {planet: self._lines.problems(planet) for planet in planets}

    def _emit(self, events: list[tuple[str, dict[str, Any]]], notify: bool = True) -> None:
        now = dt_util.utcnow().isoformat()
        for name, data in events:
            self._publish_event(name, now, data)
        if notify:
            for listener in list(self._listeners):
                listener()

    def _publish_event(self, name: str, time: Any, data: Any) -> None:
        self._remember_event(name, time, data)
        for listener in list(self._event_listeners):
            listener(name, data if isinstance(data, dict) else {})

    def set_line_rule(self, share: float, minutes: int, output_full: bool = DEFAULT_LINE_OUTPUT_FULL) -> None:
        """A line is a problem when `share` (0..1) of a group stands for `minutes` of game time;
        `output_full`: an "output full" machine counts as standing."""
        self._line_share = share
        self._line_hold_ticks = minutes * TICKS_PER_MINUTE
        self._line_output_full = output_full

    # --- subscriptions --------------------------------------------------------

    def add_listener(self, callback: Callable[[], None]) -> Callable[[], None]:
        self._listeners.append(callback)
        return lambda: self._listeners.remove(callback)

    def add_event_listener(self, callback: Callable[[str, dict[str, Any]], None]) -> Callable[[], None]:
        self._event_listeners.append(callback)
        return lambda: self._event_listeners.remove(callback)

    # --- derived values -------------------------------------------------------

    @property
    def game_state(self) -> str | None:
        if self.relay_online is False:
            return "no_connection"
        return self._state.get("game_state")

    @property
    def game_state_reason(self) -> str | None:
        return None if self.relay_online is False else self._state.get("game_state_reason")

    @property
    def game_state_since(self) -> str | None:
        return self._state.get("game_state_since")

    @property
    def players_online(self) -> int | None:
        return self._state.get("players_online")

    def category(self, name: str) -> dict[str, Any] | None:
        return self._categories.get(name)

    @property
    def players(self) -> list[str] | None:
        players = self.category("players")
        if players is None:  # relay 0.1.x only has state.data.players
            players = as_dict(self._state.get("data")).get("players")
            if not isinstance(players, dict):
                return None
        return list(as_list(players.get("online")))

    @property
    def afk_minutes(self) -> dict[str, int]:
        return dict(as_dict((self.category("players") or {}).get("afk_minutes")))

    @property
    def bodies(self) -> list[dict]:
        bodies = []
        for body in as_list((self.category("planets") or {}).get("bodies")):
            if isinstance(body, dict):
                bodies.append({**body, "parent": body.get("parent"), "unlocked_by": body.get("unlocked_by")})
        return bodies

    @property
    def built_planets(self) -> list[str]:
        return [
            b["name"]
            for b in self.bodies
            if b.get("state") == "built" and isinstance(b.get("name"), str)
        ]

    @property
    def research(self) -> dict | None:
        research = self.category("research")
        if research is None:
            return None
        current = research.get("current")
        if isinstance(current, dict) or isinstance(current, list):
            current = {**as_dict(current), "unlocks": as_list(as_dict(current).get("unlocks"))}
        else:
            current = None
        return {"current": current, "queue": as_list(research.get("queue"))}

    def evolution(self, planet: str) -> float | None:
        value = as_dict(as_dict(self.category("evolution")).get("by_planet")).get(planet)
        return value if isinstance(value, int | float) and not isinstance(value, bool) else None

    def defense(self, planet: str) -> dict | None:
        entry = as_dict(as_dict(self.category("defense")).get("by_planet")).get(planet)
        if not isinstance(entry, dict | list):
            return None
        entry = as_dict(entry)
        attack = entry.get("attack")
        return {
            "turrets": as_dict(entry.get("turrets")),
            "walls_damaged": as_dict(entry.get("walls_damaged")),
            "attack": as_dict(attack) if isinstance(attack, dict | list) else None,
        }

    def machines(self, planet: str) -> dict | None:
        entry = self._planet_entry("machines", planet)
        if entry is None:
            return None
        total = entry.get("total")
        counts = {key: entry.get(key) for key in ("no_input", "output_full", "no_power")}
        ok = None  # machines without a problem under the line rule; needs the mod's planet counters (0.3.1+)
        if _is_tick(total) and all(_is_tick(v) for v in counts.values()):
            standing = counts["no_input"] + counts["no_power"] + (counts["output_full"] if self._line_output_full else 0)
            ok = max(0, total - standing)
        return {"total": total, "working": entry.get("working"), **counts, "ok": ok}

    def problem_lines(self, planet: str) -> list[dict] | None:
        if self._planet_entry("machines", planet) is None:
            return None
        return self._lines.problems(planet)

    def drills(self, planet: str) -> dict | None:
        entry = self._planet_entry("drills", planet)
        if entry is None:
            return None
        return {"total": entry.get("total"), "working": entry.get("working"), "by_resource": as_dict(entry.get("by_resource"))}

    def _planet_entry(self, category: str, planet: str) -> dict | None:
        entry = as_dict(as_dict(self.category(category)).get("by_planet")).get(planet)
        return as_dict(entry) if isinstance(entry, dict | list) else None

    @property
    def recent_events(self) -> list[dict]:
        cutoff = dt_util.utcnow() - timedelta(minutes=EVENT_WINDOW_MINUTES)
        return [e for when, e in reversed(self._events) if when >= cutoff]

    def _remember_event(self, event: str, time: Any, data: Any) -> None:
        when = dt_util.parse_datetime(time) if isinstance(time, str) else None
        if when is None:
            return
        if when.tzinfo is None:
            when = when.replace(tzinfo=dt_util.UTC)
        self._events.append((when, {"event": event, "time": time, "data": data if isinstance(data, dict) else {}}))

    @property
    def mod_version(self) -> str | None:
        return self._hello.get("mod_version")
