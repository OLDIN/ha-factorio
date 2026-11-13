"""Server health entities: UPS, server start time and versions (mocked broker)."""

import json

import pytest
from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er
from pytest_homeassistant_custom_component.common import MockConfigEntry, async_fire_mqtt_message

from custom_components.factorio.const import DOMAIN

UPS_ID = "sensor.factorio_main_ups"
STARTED_ID = "sensor.factorio_main_server_started"
VERSION_IDS = {
    "game_version": "sensor.factorio_main_game_version",
    "mod_version": "sensor.factorio_main_mod_version",
    "relay_version": "sensor.factorio_main_relay_version",
}
ALL_IDS = [UPS_ID, STARTED_ID, *VERSION_IDS.values()]
STATE = {"v": 1, "game_state": "running", "game_state_reason": None,
         "game_state_since": "2026-11-13T06:00:00+00:00", "tick": 300, "players_online": 1, "data": {}}


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(enable_custom_integrations):
    yield


async def setup(hass: HomeAssistant) -> MockConfigEntry:
    entry = MockConfigEntry(domain=DOMAIN, unique_id="main", title="Factorio main",
                            data={"provider": "mqtt", "server_id": "main"}, options={"players": True})
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


async def fire(hass: HomeAssistant, topic: str, payload) -> None:
    async_fire_mqtt_message(hass, f"factorio/main/{topic}", payload if isinstance(payload, str) else json.dumps(payload))
    await hass.async_block_till_done()


async def test_health_sensors_unknown_without_data(hass: HomeAssistant, mqtt_mock):
    await setup(hass)
    for entity_id in ALL_IDS:
        state = hass.states.get(entity_id)
        assert state is not None and state.state == "unknown", entity_id


async def test_ups_and_server_started_from_state(hass: HomeAssistant, mqtt_mock):
    await setup(hass)
    await fire(hass, "availability", "online")
    await fire(hass, "state", {**STATE, "ups": 59.8, "server_started": "2026-11-13T07:00:00+00:00"})
    ups = hass.states.get(UPS_ID)
    assert float(ups.state) == 59.8
    assert ups.attributes["state_class"] == "measurement"
    assert ups.attributes["unit_of_measurement"] == "UPS"
    assert hass.states.get(STARTED_ID).state == "2026-11-13T07:00:00+00:00"


async def test_ups_null_is_unknown(hass: HomeAssistant, mqtt_mock):
    await setup(hass)
    await fire(hass, "availability", "online")
    await fire(hass, "state", {**STATE, "ups": 59.8})
    await fire(hass, "state", {**STATE, "ups": None})
    assert hass.states.get(UPS_ID).state == "unknown"


async def test_ups_unknown_when_relay_offline(hass: HomeAssistant, mqtt_mock):
    await setup(hass)
    await fire(hass, "availability", "online")
    await fire(hass, "state", {**STATE, "ups": 59.8, "server_started": "2026-11-13T07:00:00+00:00"})
    await fire(hass, "availability", "offline")
    assert hass.states.get(UPS_ID).state == "unknown"  # never unavailable
    assert hass.states.get(STARTED_ID).state == "unknown"


async def test_versions_from_hello_are_diagnostic(hass: HomeAssistant, mqtt_mock):
    await setup(hass)
    await fire(hass, "hello", {"v": 1, "server_id": "main", "relay_version": "0.4.2",
                               "mod_version": "0.4.2", "game_version": "2.0.72"})
    assert hass.states.get(VERSION_IDS["game_version"]).state == "2.0.72"
    assert hass.states.get(VERSION_IDS["mod_version"]).state == "0.4.2"
    assert hass.states.get(VERSION_IDS["relay_version"]).state == "0.4.2"
    registry = er.async_get(hass)
    for entity_id in VERSION_IDS.values():
        assert registry.async_get(entity_id).entity_category == "diagnostic", entity_id


async def test_old_relay_without_health_fields(hass: HomeAssistant, mqtt_mock):
    await setup(hass)
    await fire(hass, "availability", "online")
    await fire(hass, "state", STATE)
    await fire(hass, "hello", {"v": 1, "server_id": "main", "relay_version": "0.4.1", "mod_version": "0.4.1"})
    assert hass.states.get(UPS_ID).state == "unknown"
    assert hass.states.get(STARTED_ID).state == "unknown"
    assert hass.states.get(VERSION_IDS["game_version"]).state == "unknown"
    assert hass.states.get(VERSION_IDS["relay_version"]).state == "0.4.1"
