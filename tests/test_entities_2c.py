"""Stage 2c entities: the platforms sensor and platform events (mocked broker)."""

import json

import pytest
from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er
from pytest_homeassistant_custom_component.common import MockConfigEntry, async_fire_mqtt_message

from custom_components.factorio.const import DOMAIN, EVENT_TYPES

PLATFORMS_ID = "sensor.factorio_main_platforms"


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


async def push(hass: HomeAssistant, category: str, data, tick: int = 5) -> None:
    async_fire_mqtt_message(hass, f"factorio/main/data/{category}", json.dumps({"v": 1, "tick": tick, "data": data}))
    await hass.async_block_till_done()


def platform(index: int, **fields) -> dict:
    return {"index": index, "name": f"Hauler {index}", "state": "waiting_for_departure", "location": "nauvis", **fields}


async def test_platforms_sensor_counts_and_lists(hass: HomeAssistant, mqtt_mock):
    await setup(hass)
    state = hass.states.get(PLATFORMS_ID)
    assert state is not None and state.state == "unknown"  # no data yet: unknown, never unavailable
    assert state.attributes["platforms"] == []
    await push(hass, "platforms", {"list": [platform(1), platform(2, state="on_the_path", location=None,
                                                                   route={"from": "nauvis", "to": "gleba", "progress": 0.5})]})
    state = hass.states.get(PLATFORMS_ID)
    assert state.state == "2"
    assert [p["name"] for p in state.attributes["platforms"]] == ["Hauler 1", "Hauler 2"]
    assert state.attributes["platforms"][1]["route"]["to"] == "gleba"
    entity = er.async_get(hass).async_get(PLATFORMS_ID)
    assert entity.unique_id == "main_platforms" and entity.translation_key == "platforms"
    await push(hass, "platforms", {"list": []})
    assert hass.states.get(PLATFORMS_ID).state == "0"


async def test_platforms_attribute_stays_small_with_many_platforms(hass: HomeAssistant, mqtt_mock):
    await setup(hass)
    many = [platform(i, name=f"A rather long platform name {i:02d}", damage={"active": True, "since_tick": 1,
                                                                             "losses": {"transport-belt": 3, "solar-panel": 1}})
            for i in range(50)]
    groups = [{"recipe": f"some-long-recipe-name-{g}", "total": 10, "working": 2, "no_input": 8, "output_full": 0,
               "no_power": 0, "at": [[1, 2], [3, 4], [5, 6]]} for g in range(5)]
    await push(hass, "platforms", {"list": many})
    await push(hass, "machines", {"by_planet": {}, "by_platform": {
        str(i): {"name": f"A rather long platform name {i:02d}", "total": 50, "working": 10, "groups": groups} for i in range(50)}},
        tick=1000)
    async_fire_mqtt_message(hass, "factorio/main/tick", json.dumps({"v": 1, "tick": 1000 + 7200}))
    await hass.async_block_till_done()
    attrs = hass.states.get(PLATFORMS_ID).attributes
    # What the card shows: the two worst lines of each platform, without positions, and how many more.
    assert all(len(p["lines"]) == 2 and p["lines_more"] == 3 for p in attrs["platforms"])
    assert all("positions" not in line for p in attrs["platforms"] for line in p["lines"])
    assert len(json.dumps(attrs["platforms"])) < 32768
    # The list is not recorded (the recorder's 16 KB limit counts recorded attributes only).
    from custom_components.factorio.sensor import PlatformsSensor
    assert "platforms" in PlatformsSensor._unrecorded_attributes
    recorded = {k: v for k, v in attrs.items() if k != "platforms"}
    assert len(json.dumps(recorded)) < 16384


async def test_platform_events_are_event_types():
    for name in ("platform_departed", "platform_arrived", "platform_damaged"):
        assert name in EVENT_TYPES
