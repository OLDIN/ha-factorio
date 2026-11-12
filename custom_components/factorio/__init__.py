"""Factorio: live server state from the factorio-ha mod and relay."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers.typing import ConfigType

from .const import (
    CONF_LINE_MINUTES,
    CONF_LINE_SHARE,
    CONF_SERVER_ID,
    DEFAULT_LINE_MINUTES,
    DEFAULT_LINE_SHARE,
    DOMAIN,
    EVENT_TYPES,
)
from .core import FactorioCore, build_config
from .entity import server_device_info
from .frontend import async_register_frontend, async_remove_resource
from .planets import PlanetTracker
from .providers import create_provider
from .providers.base import Provider

_LOGGER = logging.getLogger(__name__)
PLATFORMS = [Platform.BINARY_SENSOR, Platform.SENSOR, Platform.EVENT]
CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)


@dataclass
class FactorioRuntime:
    core: FactorioCore
    provider: Provider
    server_device_id: str
    planets: PlanetTracker


type FactorioConfigEntry = ConfigEntry[FactorioRuntime]


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    await async_register_frontend(hass)
    return True


async def async_setup_entry(hass: HomeAssistant, entry: FactorioConfigEntry) -> bool:
    server_id: str = entry.data[CONF_SERVER_ID]
    core = FactorioCore(server_id)
    _apply_line_rule(core, entry)
    provider = create_provider(hass, entry)
    # Registered up front: planet devices link to it by device id.
    server_device = dr.async_get(hass).async_get_or_create(
        config_entry_id=entry.entry_id, **server_device_info(server_id)
    )
    planets = PlanetTracker(hass, entry.entry_id, core)
    entry.runtime_data = FactorioRuntime(
        core=core, provider=provider, server_device_id=server_device.id, planets=planets
    )

    @callback
    def fire_bus_event(name: str, data: dict[str, Any]) -> None:
        if name not in EVENT_TYPES:
            return
        # server_id last: data from the game must not override it.
        hass.bus.async_fire(f"{DOMAIN}_{name}", {**data, "server_id": server_id})

    known_version: dict[str, str | None] = {"mod": None}

    @callback
    def update_device_version() -> None:
        if core.mod_version == known_version["mod"]:
            return
        registry = dr.async_get(hass)
        device = registry.async_get_device_by_identifier((DOMAIN, server_id), entry.entry_id)
        if device is not None:
            known_version["mod"] = core.mod_version
            registry.async_update_device(device.id, sw_version=core.mod_version)

    entry.async_on_unload(core.add_event_listener(fire_bus_event))
    entry.async_on_unload(core.add_listener(update_device_version))
    entry.async_on_unload(core.add_listener(planets.async_update))

    await provider.async_start(core.handle_message)
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    await provider.async_send_config(build_config(entry.options))
    entry.async_on_unload(entry.add_update_listener(_async_options_updated))
    return True


def _apply_line_rule(core: FactorioCore, entry: FactorioConfigEntry) -> None:
    """The line problem rule is kept in the options only; the defaults apply until it is set."""
    share = entry.options.get(CONF_LINE_SHARE, DEFAULT_LINE_SHARE)
    minutes = entry.options.get(CONF_LINE_MINUTES, DEFAULT_LINE_MINUTES)
    core.set_line_rule(share / 100, int(minutes))


async def _async_options_updated(hass: HomeAssistant, entry: FactorioConfigEntry) -> None:
    _apply_line_rule(entry.runtime_data.core, entry)
    await entry.runtime_data.provider.async_send_config(build_config(entry.options))


async def async_unload_entry(hass: HomeAssistant, entry: FactorioConfigEntry) -> bool:
    unloaded = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unloaded:
        await entry.runtime_data.provider.async_stop()
    return unloaded


async def async_remove_entry(hass: HomeAssistant, entry: FactorioConfigEntry) -> None:
    """Integration removed: clear the retained config so the mod stops collecting.

    With the last server gone, the cards' Lovelace resource goes too.
    """
    try:
        await create_provider(hass, entry).async_send_config(None)
    except HomeAssistantError as err:
        _LOGGER.warning("Could not clear the Factorio config for %s: %s", entry.data[CONF_SERVER_ID], err)
    if not [e for e in hass.config_entries.async_entries(DOMAIN) if e.entry_id != entry.entry_id]:
        await async_remove_resource(hass)
