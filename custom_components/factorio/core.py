"""Game state as Home Assistant should see it. Independent of HA and of the provider."""

from __future__ import annotations

from collections import deque
from collections.abc import Callable, Mapping
from datetime import timedelta
from typing import Any

from homeassistant.util import dt as dt_util

from .const import CATEGORIES, EVENT_WINDOW_MINUTES, MAX_RECENT_EVENTS, PROTOCOL_VERSION
from .providers.base import ProviderMessage


def build_config(options: Mapping[str, Any]) -> dict[str, Any]:
    """The 'what to collect' config sent to the game; categories default to on."""
    return {"v": PROTOCOL_VERSION, "categories": {c: bool(options.get(c, True)) for c in CATEGORIES}}


def as_dict(value: Any) -> dict:
    """Lua serialises an empty table as [] (or {}); anything but a dict is empty."""
    return value if isinstance(value, dict) else {}


def as_list(value: Any) -> list:
    """Lua serialises an empty table as {} (or []); anything but a list is empty."""
    return value if isinstance(value, list) else []


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

    # --- input --------------------------------------------------------------

    def handle_message(self, msg: ProviderMessage) -> None:
        if msg.kind == "availability":
            self.relay_online = msg.payload == "online"
        elif msg.kind == "state" and isinstance(msg.payload, dict):
            self._state = msg.payload
        elif msg.kind == "hello" and isinstance(msg.payload, dict):
            self._hello = msg.payload
        elif msg.kind == "data" and isinstance(msg.payload, dict) and isinstance(msg.payload.get("category"), str):
            data = msg.payload.get("data")
            if isinstance(data, dict):
                self._categories[msg.payload["category"]] = data
            else:
                self._categories.pop(msg.payload["category"], None)
        elif msg.kind == "event" and isinstance(msg.payload, dict) and isinstance(msg.payload.get("event"), str):
            data = msg.payload.get("data")
            self._remember_event(msg.payload["event"], msg.payload.get("time"), data)
            for listener in list(self._event_listeners):
                listener(msg.payload["event"], data if isinstance(data, dict) else {})
            return
        else:
            return
        for listener in list(self._listeners):
            listener()

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
