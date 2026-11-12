"""Sensors: game state, players, bodies, research, recent events; per planet: turrets, walls, evolution, machines, lines, drills."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity, SensorStateClass
from homeassistant.const import PERCENTAGE, Platform
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity import Entity
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.util import dt as dt_util

from . import FactorioConfigEntry
from .const import GAME_STATES
from .core import as_dict, as_list
from .entity import FactorioEntity


async def async_setup_entry(
    hass: HomeAssistant, entry: FactorioConfigEntry, async_add_entities: AddConfigEntryEntitiesCallback
) -> None:
    async_add_entities(
        [
            GameStateSensor(entry),
            PlayersOnlineSensor(entry),
            BodiesSensor(entry),
            ResearchSensor(entry),
            RecentEventsSensor(entry),
        ]
    )
    core = entry.runtime_data.core
    planets = entry.runtime_data.planets

    def planet_sensors(planet: str) -> list[Entity]:
        sensors: list[Entity] = [
            TurretsNoAmmoSensor(entry, planet),
            WallsDamagedSensor(entry, planet),
            MachinesWorkingSensor(entry, planet),
            ProblemLinesSensor(entry, planet),
            DrillsDepletedSensor(entry, planet),
        ]
        evolution = EvolutionSensor(entry, planet)
        # Only planets with enemies have a value; a sensor registered before (restart) stays.
        if core.evolution(planet) is not None or planets.known(Platform.SENSOR, evolution.unique_id):
            sensors.append(evolution)
        return sensors

    planets.register(Platform.SENSOR, planet_sensors, async_add_entities)


class GameStateSensor(FactorioEntity, SensorEntity):
    _attr_device_class = SensorDeviceClass.ENUM
    _attr_options = GAME_STATES

    def __init__(self, entry: FactorioConfigEntry) -> None:
        super().__init__(entry, Platform.SENSOR, "game_state")

    @property
    def native_value(self) -> str | None:
        return self._core.game_state

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        return {"reason": self._core.game_state_reason, "since": self._core.game_state_since}


class PlayersOnlineSensor(FactorioEntity, SensorEntity):
    _unrecorded_attributes = frozenset({"afk_minutes"})
    _attr_state_class = SensorStateClass.MEASUREMENT

    def __init__(self, entry: FactorioConfigEntry) -> None:
        super().__init__(entry, Platform.SENSOR, "players_online")

    @property
    def native_value(self) -> int | None:
        return self._core.players_online

    @property
    def extra_state_attributes(self) -> dict[str, Any] | None:
        players = self._core.players
        return None if players is None else {"players": players, "afk_minutes": self._core.afk_minutes}


class BodiesSensor(FactorioEntity, SensorEntity):
    """How many bodies are built; the map card reads all bodies from the attribute."""

    _unrecorded_attributes = frozenset({"bodies"})

    def __init__(self, entry: FactorioConfigEntry) -> None:
        super().__init__(entry, Platform.SENSOR, "bodies")

    @property
    def native_value(self) -> int | None:
        return None if self._core.category("planets") is None else len(self._core.built_planets)

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        return {"bodies": self._core.bodies}


class ResearchSensor(FactorioEntity, SensorEntity):
    def __init__(self, entry: FactorioConfigEntry) -> None:
        super().__init__(entry, Platform.SENSOR, "research")

    @property
    def native_value(self) -> str | None:
        research = self._core.research
        name = ((research or {}).get("current") or {}).get("name")
        return name if isinstance(name, str) else None

    @property
    def extra_state_attributes(self) -> dict[str, Any] | None:
        research = self._core.research
        if research is None:
            return None
        current = research["current"] or {}
        progress = current.get("progress")
        return {
            "progress": round(progress * 100, 1) if isinstance(progress, int | float) else None,
            "level": current.get("level"),
            "queue": research["queue"],
            "unlocks": current.get("unlocks", []),
        }


class RecentEventsSensor(FactorioEntity, SensorEntity):
    """Time of the newest event; the timeline card reads the last hour from the attribute."""

    _attr_device_class = SensorDeviceClass.TIMESTAMP
    _unrecorded_attributes = frozenset({"events"})

    def __init__(self, entry: FactorioConfigEntry) -> None:
        super().__init__(entry, Platform.SENSOR, "recent_events")

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        # Game events reach only the event listeners of the core.
        self.async_on_remove(self._core.add_event_listener(self._handle_game_event))

    @callback
    def _handle_game_event(self, name: str, data: dict[str, Any]) -> None:
        self.async_write_ha_state()

    @property
    def native_value(self) -> datetime | None:
        events = self._core.recent_events
        when = dt_util.parse_datetime(events[0]["time"]) if events else None
        if when is not None and when.tzinfo is None:
            when = when.replace(tzinfo=dt_util.UTC)
        return when

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        return {"events": self._core.recent_events}


class _PlanetDefenseSensor(FactorioEntity, SensorEntity):
    """A part of the planet's defense data; a planet missing from it has nothing to report."""

    _part: str

    def _data(self) -> dict[str, Any] | None:
        if self._core.category("defense") is None:
            return None
        return (self._core.defense(self._planet) or {}).get(self._part, {})


class TurretsNoAmmoSensor(_PlanetDefenseSensor):
    _part = "turrets"

    def __init__(self, entry: FactorioConfigEntry, planet: str) -> None:
        super().__init__(entry, Platform.SENSOR, "turrets_no_ammo", planet)

    @property
    def native_value(self) -> int | None:
        turrets = self._data()
        return None if turrets is None else turrets.get("no_ammo", 0)

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        turrets = self._data()
        if turrets is None:
            return {"total": None, "no_power": None, "positions": []}
        return {
            "total": turrets.get("total", 0),
            "no_power": turrets.get("no_power", 0),
            "positions": as_list(turrets.get("no_ammo_at")),
        }


class WallsDamagedSensor(_PlanetDefenseSensor):
    _part = "walls_damaged"

    def __init__(self, entry: FactorioConfigEntry, planet: str) -> None:
        super().__init__(entry, Platform.SENSOR, "walls_damaged", planet)

    @property
    def native_value(self) -> int | None:
        walls = self._data()
        return None if walls is None else walls.get("count", 0)

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        return {"positions": as_list((self._data() or {}).get("at"))}


class MachinesWorkingSensor(FactorioEntity, SensorEntity):
    """Share of working machines on the planet; unknown (never unavailable) without data."""

    _attr_native_unit_of_measurement = PERCENTAGE
    _attr_state_class = SensorStateClass.MEASUREMENT

    def __init__(self, entry: FactorioConfigEntry, planet: str) -> None:
        super().__init__(entry, Platform.SENSOR, "machines_working", planet)

    @property
    def native_value(self) -> int | None:
        machines = self._core.machines(self._planet)
        total = (machines or {}).get("total")
        if not total:
            return None
        return round((machines.get("working") or 0) / total * 100)

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        machines = self._core.machines(self._planet) or {}
        return {"total": machines.get("total"), "working": machines.get("working")}


class ProblemLinesSensor(FactorioEntity, SensorEntity):
    _unrecorded_attributes = frozenset({"lines"})

    def __init__(self, entry: FactorioConfigEntry, planet: str) -> None:
        super().__init__(entry, Platform.SENSOR, "problem_lines", planet)

    @property
    def native_value(self) -> int | None:
        lines = self._core.problem_lines(self._planet)
        return None if lines is None else len(lines)

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        return {"lines": self._core.problem_lines(self._planet) or []}


class DrillsDepletedSensor(FactorioEntity, SensorEntity):
    _unrecorded_attributes = frozenset({"by_resource"})

    def __init__(self, entry: FactorioConfigEntry, planet: str) -> None:
        super().__init__(entry, Platform.SENSOR, "drills_depleted", planet)

    def _by_resource(self) -> dict[str, dict[str, int]] | None:
        drills = self._core.drills(self._planet)
        if drills is None:
            return None
        result: dict[str, dict[str, int]] = {}
        for resource, stats in as_dict(drills.get("by_resource")).items():
            stats = as_dict(stats)
            result[resource] = {"depleted": stats.get("depleted") or 0, "total": stats.get("total") or 0}
        return result

    @property
    def native_value(self) -> int | None:
        by_resource = self._by_resource()
        return None if by_resource is None else sum(r["depleted"] for r in by_resource.values())

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        return {"by_resource": self._by_resource() or {}}


class EvolutionSensor(FactorioEntity, SensorEntity):
    _attr_native_unit_of_measurement = PERCENTAGE
    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_suggested_display_precision = 1

    def __init__(self, entry: FactorioConfigEntry, planet: str) -> None:
        super().__init__(entry, Platform.SENSOR, "evolution", planet)

    @property
    def native_value(self) -> float | None:
        value = self._core.evolution(self._planet)
        return None if value is None else round(value * 100, 2)
