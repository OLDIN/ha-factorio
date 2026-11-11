"""The integration over the MQTT provider, end to end (mocked broker)."""

import json
from pathlib import Path

import pytest
from homeassistant.const import STATE_UNAVAILABLE
from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_capture_events,
    async_fire_mqtt_message,
)

from custom_components.factorio.const import DOMAIN

STATE = {
    "v": 1, "game_state": "running", "game_state_reason": None,
    "game_state_since": "2026-11-11T10:00:00+00:00", "tick": 300,
    "players_online": 1, "data": {"players": {"online": ["alice"]}},
}
ENTITIES = [
    "binary_sensor.factorio_main_connection",
    "binary_sensor.factorio_main_game_running",
    "sensor.factorio_main_game_state",
    "sensor.factorio_main_players_online",
    "event.factorio_main_game_events",
]


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(enable_custom_integrations):
    yield


async def setup_entry(hass: HomeAssistant, server_id="main", options=None) -> MockConfigEntry:
    entry = MockConfigEntry(domain=DOMAIN, unique_id=server_id, title=f"Factorio {server_id}",
                            data={"provider": "mqtt", "server_id": server_id},
                            options={"players": True} if options is None else options)
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


def published(mqtt_mock) -> list[tuple]:
    return [tuple(c.args[:4]) for c in mqtt_mock.async_publish.call_args_list]


async def fire(hass: HomeAssistant, topic: str, payload) -> None:
    async_fire_mqtt_message(hass, topic, payload if isinstance(payload, str) else json.dumps(payload))
    await hass.async_block_till_done()


async def test_setup_publishes_config_retained(hass: HomeAssistant, mqtt_mock):
    await setup_entry(hass)
    assert ("factorio/main/config", '{"v":1,"categories":{"players":true}}', 1, True) in published(mqtt_mock)


async def test_entities_from_state(hass: HomeAssistant, mqtt_mock):
    await setup_entry(hass)
    await fire(hass, "factorio/main/availability", "online")
    await fire(hass, "factorio/main/state", STATE)
    assert hass.states.get("sensor.factorio_main_game_state").state == "running"
    players = hass.states.get("sensor.factorio_main_players_online")
    assert players.state == "1"
    assert players.attributes["players"] == ["alice"]
    assert hass.states.get("binary_sensor.factorio_main_connection").state == "on"
    assert hass.states.get("binary_sensor.factorio_main_game_running").state == "on"


async def test_paused_state_has_reason(hass: HomeAssistant, mqtt_mock):
    await setup_entry(hass)
    await fire(hass, "factorio/main/availability", "online")
    await fire(hass, "factorio/main/state", {**STATE, "game_state": "paused", "game_state_reason": "no_players"})
    state = hass.states.get("sensor.factorio_main_game_state")
    assert (state.state, state.attributes["reason"]) == ("paused", "no_players")
    assert hass.states.get("binary_sensor.factorio_main_game_running").state == "off"


async def test_relay_offline_keeps_values_no_unavailable(hass: HomeAssistant, mqtt_mock):
    await setup_entry(hass)
    await fire(hass, "factorio/main/availability", "online")
    await fire(hass, "factorio/main/state", STATE)
    await fire(hass, "factorio/main/availability", "offline")
    assert hass.states.get("sensor.factorio_main_game_state").state == "no_connection"
    assert hass.states.get("sensor.factorio_main_players_online").state == "1"
    assert hass.states.get("binary_sensor.factorio_main_connection").state == "off"
    for entity_id in ENTITIES:
        assert hass.states.get(entity_id).state != STATE_UNAVAILABLE, entity_id


async def test_ha_restart_while_relay_down_restores_values(hass: HomeAssistant, mqtt_mock):
    """Retained state + retained 'offline' arrive at startup, before any 'online'."""
    await setup_entry(hass)
    await fire(hass, "factorio/main/state", STATE)
    await fire(hass, "factorio/main/availability", "offline")
    assert hass.states.get("sensor.factorio_main_game_state").state == "no_connection"
    assert hass.states.get("sensor.factorio_main_players_online").state == "1"


async def test_invalid_json_ignored(hass: HomeAssistant, mqtt_mock):
    await setup_entry(hass)
    await fire(hass, "factorio/main/state", "{not json")
    assert hass.states.get("sensor.factorio_main_game_state").state == "unknown"


async def test_event_entity_and_bus_event(hass: HomeAssistant, mqtt_mock):
    events = async_capture_events(hass, "factorio_player_joined")
    await setup_entry(hass)
    await fire(hass, "factorio/main/event",
               {"v": 1, "event": "player_joined", "tick": 9, "time": "t", "data": {"player": "guest"}})
    state = hass.states.get("event.factorio_main_game_events")
    assert state.attributes["event_type"] == "player_joined"
    assert state.attributes["player"] == "guest"
    assert [e.data for e in events] == [{"server_id": "main", "player": "guest"}]


async def test_options_change_republishes_config(hass: HomeAssistant, mqtt_mock):
    entry = await setup_entry(hass)
    hass.config_entries.async_update_entry(entry, options={"players": False})
    await hass.async_block_till_done()
    assert ("factorio/main/config", '{"v":1,"categories":{"players":false}}', 1, True) in published(mqtt_mock)


async def test_unload_keeps_config(hass: HomeAssistant, mqtt_mock):
    entry = await setup_entry(hass)
    assert await hass.config_entries.async_unload(entry.entry_id)
    assert ("factorio/main/config", "", 1, True) not in published(mqtt_mock)


async def test_remove_entry_clears_config(hass: HomeAssistant, mqtt_mock):
    entry = await setup_entry(hass)
    await hass.config_entries.async_remove(entry.entry_id)
    await hass.async_block_till_done()
    assert ("factorio/main/config", "", 1, True) in published(mqtt_mock)


async def test_entity_ids_independent_of_language(hass: HomeAssistant, mqtt_mock):
    hass.config.language = "uk"
    await setup_entry(hass)
    for entity_id in ENTITIES:
        assert hass.states.get(entity_id) is not None, entity_id


async def test_server_id_with_dash_gives_valid_entity_ids(hass: HomeAssistant, mqtt_mock):
    await setup_entry(hass, server_id="mac-dev")
    assert hass.states.get("sensor.factorio_mac_dev_game_state") is not None


async def test_bus_event_cannot_override_server_id(hass: HomeAssistant, mqtt_mock):
    events = async_capture_events(hass, "factorio_player_joined")
    await setup_entry(hass)
    await fire(hass, "factorio/main/event",
               {"v": 1, "event": "player_joined", "tick": 9, "time": "t",
                "data": {"player": "guest", "server_id": "spoofed"}})
    assert events[0].data["server_id"] == "main"


async def test_unknown_event_type_not_fired_on_bus(hass: HomeAssistant, mqtt_mock):
    events = async_capture_events(hass, "factorio_reboot_everything")
    await setup_entry(hass)
    await fire(hass, "factorio/main/event",
               {"v": 1, "event": "reboot_everything", "tick": 9, "time": "t", "data": {}})
    assert events == []


async def test_event_data_cannot_override_event_type(hass: HomeAssistant, mqtt_mock):
    await setup_entry(hass)
    await fire(hass, "factorio/main/event",
               {"v": 1, "event": "player_joined", "tick": 9, "time": "t",
                "data": {"player": "guest", "event_type": "player_left"}})
    assert hass.states.get("event.factorio_main_game_events").attributes["event_type"] == "player_joined"


def _device(hass: HomeAssistant, entry: MockConfigEntry):
    from homeassistant.helpers import device_registry as dr

    return dr.async_get(hass).async_get_device_by_identifier((DOMAIN, "main"), entry.entry_id)


async def test_device_named_after_server(hass: HomeAssistant, mqtt_mock):
    entry = await setup_entry(hass)
    assert _device(hass, entry).name == "Factorio main"


async def test_device_sw_version_follows_mod_hello(hass: HomeAssistant, mqtt_mock, caplog):
    entry = await setup_entry(hass)
    await fire(hass, "factorio/main/hello", {"v": 1, "server_id": "main", "relay_version": "0.1.0", "mod_version": "0.1.0"})
    assert _device(hass, entry).sw_version == "0.1.0"
    assert "deprecated" not in caplog.text  # no deprecated device-registry lookups


@pytest.mark.parametrize("lang,no_players,unknown", [("en", "No players", "Unknown"), ("uk", "Немає гравців", "Невідомо")])
async def test_pause_reason_is_translated(hass: HomeAssistant, mqtt_mock, lang, no_players, unknown):
    from homeassistant.helpers.translation import async_get_translations

    await setup_entry(hass)
    tr = await async_get_translations(hass, lang, "entity", {DOMAIN})
    base = f"component.{DOMAIN}.entity.sensor.game_state.state_attributes.reason.state"
    assert (tr.get(f"{base}.no_players"), tr.get(f"{base}.unknown")) == (no_players, unknown)


async def test_integration_ships_brand_icon(hass: HomeAssistant):
    from homeassistant.loader import async_get_custom_components

    integration = (await async_get_custom_components(hass))[DOMAIN]
    assert integration.has_branding
    assert (Path(integration.file_path) / "brand" / "icon.png").is_file()
