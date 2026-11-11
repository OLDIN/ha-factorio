"""Base entity: ids from internal names, never unavailable."""

from __future__ import annotations

from typing import TYPE_CHECKING

from homeassistant.core import callback
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity import Entity
from homeassistant.util import slugify

from .const import DOMAIN

if TYPE_CHECKING:
    from . import FactorioConfigEntry


def pretty(name: str) -> str:
    """A display name from an internal one: "planet-x" -> "Planet x"."""
    text = name.replace("-", " ").replace("_", " ")
    return text[:1].upper() + text[1:]


def server_device_info(server_id: str) -> DeviceInfo:
    return DeviceInfo(
        identifiers={(DOMAIN, server_id)},
        name=f"Factorio {server_id}",
        manufacturer="factorio-ha",
        model="Factorio server",
    )


class FactorioEntity(Entity):
    _attr_has_entity_name = True
    _attr_should_poll = False

    def __init__(self, entry: FactorioConfigEntry, platform: str, key: str, planet: str | None = None) -> None:
        self._core = entry.runtime_data.core
        server_id = self._core.server_id
        self._attr_translation_key = key
        # Internal names, independent of the UI language (spec: ids never change).
        if planet is None:
            self._attr_unique_id = f"{server_id}_{key}"
            self.entity_id = f"{platform}.factorio_{slugify(server_id)}_{key}"
            self._attr_device_info = server_device_info(server_id)
            return
        self._planet = planet
        self._attr_unique_id = f"{server_id}_{planet}_{key}"
        self.entity_id = f"{platform}.factorio_{slugify(server_id)}_{slugify(planet)}_{key}"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, f"{server_id}:{planet}")},
            name=f"Factorio · {pretty(planet)}",
            manufacturer="factorio-ha",
            model="Factorio planet",
            # The server device is registered before the platforms (via_device is deprecated).
            via_device_id=entry.runtime_data.server_device_id,
        )

    @property
    def available(self) -> bool:
        # Data entities never go unavailable; connection entities show the link state.
        return True

    async def async_added_to_hass(self) -> None:
        self.async_on_remove(self._core.add_listener(self._handle_core_update))

    @callback
    def _handle_core_update(self) -> None:
        self.async_write_ha_state()
