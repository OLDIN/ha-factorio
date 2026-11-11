"""Planet devices: entities appear as planets get built, devices go when their body is gone."""

from __future__ import annotations

from collections.abc import Callable

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers.entity import Entity
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .const import DOMAIN
from .core import FactorioCore

type PlanetFactory = Callable[[str], list[Entity]]


class PlanetTracker:
    """Adds planet entities per (planet, key) once their condition holds; prunes gone planets."""

    def __init__(self, hass: HomeAssistant, entry_id: str, core: FactorioCore) -> None:
        self._hass = hass
        self._entry_id = entry_id
        self._core = core
        self._platforms: list[tuple[str, PlanetFactory, AddConfigEntryEntitiesCallback]] = []
        # planet -> (platform, unique_id) of the entities already handed to HA
        self._added: dict[str, set[tuple[str, str | None]]] = {}

    @callback
    def register(self, platform: str, factory: PlanetFactory, add: AddConfigEntryEntitiesCallback) -> None:
        self._platforms.append((platform, factory, add))
        # Retained data may have arrived before this platform was set up.
        self._add_new(platform, factory, add)

    @callback
    def async_update(self) -> None:
        for platform, factory, add in self._platforms:
            self._add_new(platform, factory, add)
        self._remove_gone()

    def _add_new(self, platform: str, factory: PlanetFactory, add: AddConfigEntryEntitiesCallback) -> None:
        new: list[Entity] = []
        for planet in self._core.built_planets:
            added = self._added.setdefault(planet, set())
            for entity in factory(planet):
                key = (platform, entity.unique_id)
                if key not in added:
                    added.add(key)
                    new.append(entity)
        if new:
            add(new)

    def _remove_gone(self) -> None:
        if self._core.category("planets") is None:
            return  # nothing known about bodies (not yet received, disabled, old relay): keep all
        names = {body.get("name") for body in self._core.bodies}
        prefix = f"{self._core.server_id}:"
        registry = dr.async_get(self._hass)
        for device in dr.async_entries_for_config_entry(registry, self._entry_id):
            planets = [ident[len(prefix):] for domain, ident in device.identifiers
                       if domain == DOMAIN and ident.startswith(prefix)]
            if planets and planets[0] not in names:
                # Its entities leave the entity registry and the state machine with it.
                registry.async_remove_device(device.id)
        for planet in [p for p in self._added if p not in names]:
            del self._added[planet]
