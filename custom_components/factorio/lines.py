"""Trackers for production lines and drills: the line problem rule and depletion events.

Pure logic, no Home Assistant imports. Time is the game clock in ticks (60 per
second), so a paused game does not advance any hold time.
"""

from __future__ import annotations

from typing import Any

TICKS_PER_MINUTE = 3600
REASONS = ("no_input", "output_full", "no_power")  # order breaks ties
BACKWARDS_RESET_TICKS = 3600  # a tick this far back means an older save was loaded
DRILL_EVENT_GAP_TICKS = 18000  # 5 game minutes per (planet, resource)
UNKNOWN_RESOURCE = "unknown"

Event = tuple[str, dict[str, Any]]


def _dict(value: Any) -> dict:
    return value if isinstance(value, dict) else {}


def _list(value: Any) -> list:
    return value if isinstance(value, list) else []


def _int(value: Any) -> int:
    return value if isinstance(value, int) and not isinstance(value, bool) else 0


class LineTracker:
    """Raises line_problem when a group has been stopped long enough, line_recovered likewise."""

    def __init__(self) -> None:
        self.reset()

    def reset(self) -> None:
        """Forget everything without events; the next data is a new baseline."""
        self._last_tick: int | None = None
        self._anchors: dict[tuple[str, str], int] = {}  # bad since (not yet reported)
        self._active: dict[tuple[str, str], dict[str, Any]] = {}  # reported problems
        self._since: dict[tuple[str, str], int] = {}  # reported problems: bad since
        self._ok_since: dict[tuple[str, str], int] = {}  # reported problems: fine since

    def update(self, by_planet: dict, tick: int, share: float, hold_ticks: int, *, from_clock: bool) -> list[Event]:
        """from_clock: the tick comes from the live game clock. Only the clock may detect an
        older save (tick far back, resets); a data tick can be a stale re-delivery, so it is
        clamped to the tracker clock and taken as-is only while there is no clock yet."""
        if self._last_tick is not None and tick < self._last_tick:
            if from_clock and self._last_tick - tick > BACKWARDS_RESET_TICKS:
                self.reset()
            else:
                tick = self._last_tick  # the clock never runs backwards
        self._last_tick = tick

        seen: dict[tuple[str, str], dict[str, Any]] = {}
        for planet, entry in _dict(by_planet).items():
            for group in _list(_dict(entry).get("groups")):
                group = _dict(group)
                recipe = group.get("recipe")
                total = _int(group.get("total"))
                if not isinstance(recipe, str) or total <= 0:
                    continue
                counts = {reason: _int(group.get(reason)) for reason in REASONS}
                stopped = sum(counts.values())
                if stopped / total < share:
                    continue
                seen[(planet, recipe)] = {
                    "recipe": recipe,
                    "total": total,
                    "stopped": stopped,
                    "reason": max(REASONS, key=lambda r: counts[r]),
                    "positions": _list(group.get("at")),
                }

        events: list[Event] = []
        for key, info in seen.items():
            self._ok_since.pop(key, None)
            if key in self._active:
                self._active[key] = info
                continue
            anchor = self._anchors.setdefault(key, tick)
            if tick - anchor >= hold_ticks:
                del self._anchors[key]
                self._active[key] = info
                self._since[key] = anchor
                events.append(("line_problem", {"planet": key[0], **{k: info[k] for k in ("recipe", "reason", "stopped", "total")}}))
        for key in [k for k in self._anchors if k not in seen]:
            del self._anchors[key]  # recovered before it was ever reported
        for key in [k for k in self._active if k not in seen]:
            ok_since = self._ok_since.setdefault(key, tick)
            if tick - ok_since >= hold_ticks:
                for table in (self._active, self._since, self._ok_since):
                    table.pop(key, None)
                events.append(("line_recovered", {"planet": key[0], "recipe": key[1]}))
        return events

    def problems(self, planet: str) -> list[dict[str, Any]]:
        now = self._last_tick or 0
        found = [
            {**info, "minutes": max(0, now - self._since[key]) // TICKS_PER_MINUTE}
            for key, info in self._active.items()
            if key[0] == planet
        ]
        return sorted(found, key=lambda p: (-p["stopped"] / p["total"], p["recipe"]))


class DrillTracker:
    """Raises drills_depleted when the depleted count of (planet, resource) grows."""

    def __init__(self) -> None:
        self.reset()

    def reset(self) -> None:
        self._depleted: dict[tuple[str, str], int] = {}
        self._event_tick: dict[tuple[str, str], int] = {}

    def update(self, by_planet: dict, tick: int) -> list[Event]:
        events: list[Event] = []
        for planet, entry in _dict(by_planet).items():
            for resource, stats in _dict(_dict(entry).get("by_resource")).items():
                stats = _dict(stats)
                key = (planet, resource)
                depleted = _int(stats.get("depleted"))
                previous = self._depleted.get(key)
                self._depleted[key] = depleted
                if previous is None or depleted <= previous or resource == UNKNOWN_RESOURCE:
                    continue  # first value is a baseline; drills depleted before the first scan are not news
                last = self._event_tick.get(key)
                if last is not None and 0 <= tick - last < DRILL_EVENT_GAP_TICKS:
                    continue  # an event "in the future" means an older save was loaded: no limit
                self._event_tick[key] = tick
                events.append(
                    ("drills_depleted", {"planet": planet, "resource": resource, "depleted": depleted, "total": _int(stats.get("total"))})
                )
        return events
