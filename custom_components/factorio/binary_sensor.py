"""Binary sensors: relay connection, whether the game is running; per planet: under attack."""

from __future__ import annotations

from typing import Any

from homeassistant.components.binary_sensor import BinarySensorDeviceClass, BinarySensorEntity
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity import Entity
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from . import FactorioConfigEntry
from .core import as_dict, as_list
from .entity import FactorioEntity


async def async_setup_entry(
    hass: HomeAssistant, entry: FactorioConfigEntry, async_add_entities: AddConfigEntryEntitiesCallback
) -> None:
    async_add_entities([ConnectionBinarySensor(entry), GameRunningBinarySensor(entry)])

    def planet_binary_sensors(planet: str) -> list[Entity]:
        return [UnderAttackBinarySensor(entry, planet)]

    entry.runtime_data.planets.register(Platform.BINARY_SENSOR, planet_binary_sensors, async_add_entities)


class ConnectionBinarySensor(FactorioEntity, BinarySensorEntity):
    _attr_device_class = BinarySensorDeviceClass.CONNECTIVITY

    def __init__(self, entry: FactorioConfigEntry) -> None:
        super().__init__(entry, Platform.BINARY_SENSOR, "connection")

    @property
    def is_on(self) -> bool:
        return self._core.relay_online is True


class GameRunningBinarySensor(FactorioEntity, BinarySensorEntity):
    _attr_device_class = BinarySensorDeviceClass.RUNNING

    def __init__(self, entry: FactorioConfigEntry) -> None:
        super().__init__(entry, Platform.BINARY_SENSOR, "game_running")

    @property
    def is_on(self) -> bool:
        return self._core.game_state == "running"


class UnderAttackBinarySensor(FactorioEntity, BinarySensorEntity):
    _attr_device_class = BinarySensorDeviceClass.SAFETY  # on = unsafe

    def __init__(self, entry: FactorioConfigEntry, planet: str) -> None:
        super().__init__(entry, Platform.BINARY_SENSOR, "under_attack", planet)

    def _attack(self) -> dict[str, Any]:
        # No attack is an absent key or an empty table ({} or []).
        return as_dict((self._core.defense(self._planet) or {}).get("attack"))

    @property
    def is_on(self) -> bool | None:
        if self._core.category("defense") is None:
            return None
        return bool(self._attack())

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        attack = self._attack()
        return {
            "since_tick": attack.get("since_tick"),
            "position": as_list(attack.get("position")) or None,
            "gps": attack.get("gps"),
            "losses": as_dict(attack.get("losses")) if attack else None,
        }
