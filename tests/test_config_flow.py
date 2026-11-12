"""Config and options flows."""

import json
from pathlib import Path
from unittest.mock import patch

import pytest
from homeassistant.config_entries import SOURCE_MQTT, SOURCE_USER
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.helpers.service_info.mqtt import MqttServiceInfo
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.factorio.const import CATEGORIES, DOMAIN

DATA = {"provider": "mqtt", "server_id": "main"}


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(enable_custom_integrations):
    yield


@pytest.fixture(autouse=True)
def skip_entry_setup():
    with patch("custom_components.factorio.async_setup_entry", return_value=True):
        yield


def discovery(topic="factorio/main/hello", payload='{"v":1,"server_id":"main"}') -> MqttServiceInfo:
    return MqttServiceInfo(topic=topic, payload=payload, qos=1, retain=True,
                           subscribed_topic="factorio/+/hello", timestamp=0)


async def test_user_flow_creates_entry(hass: HomeAssistant, mqtt_mock):
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_USER})
    assert (result["type"], result["step_id"]) == (FlowResultType.FORM, "user")
    result = await hass.config_entries.flow.async_configure(result["flow_id"], DATA)
    assert (result["type"], result["step_id"]) == (FlowResultType.FORM, "categories")
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {"players": True})
    assert result["type"] == FlowResultType.CREATE_ENTRY
    assert result["title"] == "Factorio main"
    assert result["data"] == DATA
    assert result["options"] == dict.fromkeys(CATEGORIES, True)
    assert {"machines", "drills"} <= set(CATEGORIES)


async def test_user_flow_rejects_bad_server_id(hass: HomeAssistant, mqtt_mock):
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_USER})
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {"provider": "mqtt", "server_id": "Bad ID!"})
    assert result["errors"] == {"server_id": "invalid_server_id"}


async def test_mqtt_discovery_flow(hass: HomeAssistant, mqtt_mock):
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_MQTT}, data=discovery())
    assert (result["type"], result["step_id"]) == (FlowResultType.FORM, "confirm")
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {})
    assert result["step_id"] == "categories"
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {"players": True})
    assert result["type"] == FlowResultType.CREATE_ENTRY
    assert result["data"] == DATA


async def test_discovery_with_empty_payload_aborts(hass: HomeAssistant, mqtt_mock):
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_MQTT},
                                                       data=discovery(payload=""))
    assert result["type"] == FlowResultType.ABORT


async def test_duplicate_aborts(hass: HomeAssistant, mqtt_mock):
    MockConfigEntry(domain=DOMAIN, unique_id="main", data=DATA).add_to_hass(hass)
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_MQTT}, data=discovery())
    assert (result["type"], result["reason"]) == (FlowResultType.ABORT, "already_configured")
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_USER})
    result = await hass.config_entries.flow.async_configure(result["flow_id"], DATA)
    assert (result["type"], result["reason"]) == (FlowResultType.ABORT, "already_configured")


async def test_options_flow_toggles_players(hass: HomeAssistant, mqtt_mock):
    entry = MockConfigEntry(domain=DOMAIN, unique_id="main", data=DATA, options={"players": True})
    entry.add_to_hass(hass)
    result = await hass.config_entries.options.async_init(entry.entry_id)
    assert result["step_id"] == "init"
    result = await hass.config_entries.options.async_configure(result["flow_id"], {"players": False})
    assert result["type"] == FlowResultType.CREATE_ENTRY
    assert entry.options == {**dict.fromkeys(CATEGORIES, True), "line_problem_share": 30, "line_problem_minutes": 2, "players": False}


async def test_options_flow_has_all_categories(hass: HomeAssistant, mqtt_mock):
    entry = MockConfigEntry(domain=DOMAIN, unique_id="main", data=DATA, options={})
    entry.add_to_hass(hass)
    result = await hass.config_entries.options.async_init(entry.entry_id)
    schema = result["data_schema"].schema
    assert [str(key) for key in schema] == [*CATEGORIES, "line_problem_share", "line_problem_minutes"]
    assert all(key.default() is True for key in schema if str(key) in CATEGORIES)
    share = next(key for key in schema if str(key) == "line_problem_share")
    minutes = next(key for key in schema if str(key) == "line_problem_minutes")
    assert (share.default(), schema[share].config["min"], schema[share].config["max"]) == (30, 10, 100)
    assert (minutes.default(), schema[minutes].config["min"], schema[minutes].config["max"]) == (2, 1, 60)
    result = await hass.config_entries.options.async_configure(result["flow_id"], {})
    assert result["type"] == FlowResultType.CREATE_ENTRY
    assert entry.options == {**dict.fromkeys(CATEGORIES, True), "line_problem_share": 30, "line_problem_minutes": 2}
    assert isinstance(entry.options["line_problem_share"], int)

    # The rule is set only in the options, not in the setup step.
    first = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_USER})
    setup = await hass.config_entries.flow.async_configure(first["flow_id"], {**DATA, "server_id": "other"})
    assert [str(key) for key in setup["data_schema"].schema] == CATEGORIES

    # Every switch has a label, in the setup step and in the options, in every language.
    component = Path(__file__).parent.parent / "custom_components" / DOMAIN
    for name in ("strings.json", "translations/en.json", "translations/uk.json"):
        strings = json.loads((component / name).read_text(encoding="utf-8"))
        assert sorted(strings["config"]["step"]["categories"]["data"]) == sorted(CATEGORIES), name
        options = strings["options"]["step"]["init"]
        assert sorted(options["data"]) == sorted([*CATEGORIES, "line_problem_share", "line_problem_minutes"]), name
        assert sorted(options["data_description"]) == ["line_problem_minutes", "line_problem_share"], name
        for event in ("line_problem", "line_recovered", "drills_depleted"):
            assert event in strings["entity"]["event"]["game_events"]["state_attributes"]["event_type"]["state"], name
