"""Planet devices: entities appear as planets get built, devices go when their body is gone."""

from __future__ import annotations

from collections.abc import Callable

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.entity import Entity
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .const import DOMAIN
from .core import FactorioCore, as_dict

type PlanetFactory = Callable[[str], list[Entity]]


class PlanetTracker:
    """Adds planet entities per (planet, key) once their condition holds; prunes gone planets.

    Planets with a device already registered (e.g. from before an HA restart) keep getting
    their entities even when not built or when bodies are unknown, so that their states never
    stay at the 'unavailable' HA restores at start.
    """

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
        self._add_new(self._planets(), platform, factory, add)

    @callback
    def async_update(self) -> None:
        # Prune first: adding an entity of a planet about to go would re-create its device.
        self._remove_gone()
        planets = self._planets()
        for platform, factory, add in self._platforms:
            self._add_new(planets, platform, factory, add)

    @callback
    def known(self, platform: str, unique_id: str | None) -> bool:
        """Whether this config entry already has the entity in the registry."""
        registry = er.async_get(self._hass)
        entity_id = registry.async_get_entity_id(platform, DOMAIN, unique_id) if unique_id else None
        entity = registry.async_get(entity_id) if entity_id else None
        return entity is not None and entity.config_entry_id == self._entry_id

    def _planets(self) -> list[str]:
        """Built planets, plus planets with a registered device that are not known to be gone."""
        planets = list(self._core.built_planets)
        if self._core.category("planets") is None:
            # The planets category is off (or not received): defense/evolution still name planets.
            for category in ("defense", "evolution"):
                by_planet = as_dict(as_dict(self._core.category(category)).get("by_planet"))
                planets += [p for p in by_planet if isinstance(p, str) and p not in planets]
        registered = self._registered()
        if self._core.category("planets") is not None:
            names = self._body_names()
            registered = {planet: device for planet, device in registered.items() if planet in names}
        return planets + [planet for planet in registered if planet not in planets]

    def _add_new(
        self, planets: list[str], platform: str, factory: PlanetFactory, add: AddConfigEntryEntitiesCallback
    ) -> None:
        new: list[Entity] = []
        for planet in planets:
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
        names = self._body_names()
        registry = dr.async_get(self._hass)
        for planet, device_id in self._registered().items():
            if planet not in names:
                # Its entities leave the entity registry and the state machine with it.
                registry.async_remove_device(device_id)
        for planet in [p for p in self._added if p not in names]:
            del self._added[planet]

    def _body_names(self) -> set[str]:
        return {body["name"] for body in self._core.bodies if isinstance(body.get("name"), str)}

    def _registered(self) -> dict[str, str]:
        """Planet -> device id of the planet devices registered for this config entry."""
        prefix = f"{self._core.server_id}:"
        registry = dr.async_get(self._hass)
        planets: dict[str, str] = {}
        for device in dr.async_entries_for_config_entry(registry, self._entry_id):
            for domain, ident in device.identifiers:
                if domain == DOMAIN and ident.startswith(prefix):
                    planets[ident[len(prefix):]] = device.id
        return planets
