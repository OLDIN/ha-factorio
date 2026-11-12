"""Stage 2b entities: per-planet machines, problem lines and drills sensors (mocked broker)."""

import json

import pytest
from homeassistant.const import STATE_UNAVAILABLE
from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.json import json_bytes
from pytest_homeassistant_custom_component.common import MockConfigEntry, async_fire_mqtt_message

from custom_components.factorio.const import DOMAIN
from custom_components.factorio.lines import TICKS_PER_MINUTE

NAUVIS = "sensor.factorio_main_nauvis_"
MACHINES_ID, LINES_ID, DRILLS_ID = (NAUVIS + k for k in ("machines_working", "problem_lines", "drills_depleted"))


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


def body(name: str, state: str = "built") -> dict:
    return {"name": name, "kind": "planet", "x": 0.0, "y": -15.0, "distance": 15, "orientation": 0.275,
            "magnitude": 1.0, "state": state}


def group(recipe: str, stopped: int, total: int = 100) -> dict:
    return {"recipe": recipe, "total": total, "working": total - stopped, "no_input": stopped, "output_full": 0,
            "no_power": 0, "at": [[1, 2]]}


def machines(groups: list[dict] | None = None, total: int = 200, working: int = 150) -> dict:
    return {"by_planet": {"nauvis": {"total": total, "working": working, "groups": groups or []}}}


DRILLS = {"by_planet": {"nauvis": {"total": 140, "working": 110, "by_resource": {
    "iron-ore": {"total": 96, "working": 80, "depleted": 14, "stuck": 2},
    "unknown": {"total": 4, "working": 0, "depleted": 3, "stuck": 0},
}}}}


async def built(hass: HomeAssistant) -> MockConfigEntry:
    entry = await setup(hass)
    await push(hass, "planets", {"bodies": [body("nauvis"), body("gleba", state="unlocked")]})
    return entry


async def test_sensors_exist_for_built_planet_without_data(hass: HomeAssistant, mqtt_mock):
    await built(hass)
    for entity_id in (MACHINES_ID, LINES_ID, DRILLS_ID):
        state = hass.states.get(entity_id)
        assert state is not None, entity_id
        assert state.state == "unknown", entity_id  # no category yet: unknown, never unavailable
    assert hass.states.get(LINES_ID).attributes["lines"] == []
    assert hass.states.get(DRILLS_ID).attributes["by_resource"] == {}
    for slug in ("machines_working", "problem_lines", "drills_depleted"):
        assert hass.states.get(f"sensor.factorio_main_gleba_{slug}") is None  # not built


async def test_machines_working_percent(hass: HomeAssistant, mqtt_mock):
    entry = await built(hass)
    await push(hass, "machines", machines(total=1551, working=1412))
    state = hass.states.get(MACHINES_ID)
    assert state.state == "91"  # round(1412 / 1551 * 100)
    assert state.attributes["unit_of_measurement"] == "%"
    assert (state.attributes["total"], state.attributes["working"]) == (1551, 1412)
    entity = er.async_get(hass).async_get(MACHINES_ID)
    assert entity.unique_id == "main_nauvis_machines_working"
    assert entity.translation_key == "machines_working"
    assert entry.state.value == "loaded"

    await push(hass, "machines", machines(total=0, working=0))
    assert hass.states.get(MACHINES_ID).state == "unknown"
    await push(hass, "machines", {"by_planet": {}})  # planet no longer listed
    assert hass.states.get(MACHINES_ID).state == "unknown"
    await push(hass, "machines", [])  # category switched off: Lua sends an empty table
    for entity_id in (MACHINES_ID, LINES_ID):
        assert hass.states.get(entity_id).state in ("unknown", "0"), entity_id
        assert hass.states.get(entity_id).state != STATE_UNAVAILABLE


async def test_problem_lines_state_and_attribute(hass: HomeAssistant, mqtt_mock):
    await built(hass)
    await push(hass, "machines", machines([group("iron-plate", 40)]), tick=1000)
    assert hass.states.get(LINES_ID).state == "0"  # held back by the 2 minute rule
    await push(hass, "machines", machines([group("iron-plate", 40), group("copper-plate", 50)]),
               tick=1000 + 2 * TICKS_PER_MINUTE)
    state = hass.states.get(LINES_ID)
    assert state.state == "1"  # iron held for 2 minutes; copper only just seen (clock starts)
    await push(hass, "machines", machines([group("iron-plate", 40), group("copper-plate", 50)]),
               tick=1000 + 4 * TICKS_PER_MINUTE)
    state = hass.states.get(LINES_ID)
    assert state.state == "2"
    lines = state.attributes["lines"]
    assert [line["recipe"] for line in lines] == ["copper-plate", "iron-plate"]  # worst first
    assert lines[0]["stopped"] == 50 and lines[0]["total"] == 100 and lines[0]["minutes"] >= 2


async def test_drills_depleted_sum_and_by_resource(hass: HomeAssistant, mqtt_mock):
    await built(hass)
    await push(hass, "drills", DRILLS)
    state = hass.states.get(DRILLS_ID)
    assert state.state == "17"  # unknown ore counts in the sensor
    assert state.attributes["by_resource"] == {"iron-ore": {"depleted": 14, "total": 96},
                                               "unknown": {"depleted": 3, "total": 4}}
    await push(hass, "drills", {"by_planet": {"nauvis": {"total": 0, "working": 0, "by_resource": []}}})
    assert hass.states.get(DRILLS_ID).state == "0"
    await push(hass, "drills", [])
    assert hass.states.get(DRILLS_ID).state in ("unknown", "0")
    assert hass.states.get(DRILLS_ID).state != STATE_UNAVAILABLE


async def test_big_attributes_not_recorded(hass: HomeAssistant, mqtt_mock):
    await built(hass)
    await push(hass, "machines", machines([group(f"some-long-recipe-name-{i}", 60 + i) for i in range(20)]), tick=0)
    await push(hass, "machines", machines([group(f"some-long-recipe-name-{i}", 60 + i) for i in range(20)]),
               tick=5 * TICKS_PER_MINUTE)
    await push(hass, "drills", DRILLS)
    lines = hass.states.get(LINES_ID)
    assert len(lines.attributes["lines"]) == 20
    assert "lines" in lines.state_info["unrecorded_attributes"]
    assert "by_resource" in hass.states.get(DRILLS_ID).state_info["unrecorded_attributes"]
    assert len(json_bytes(dict(lines.attributes))) < 16 * 1024


def test_translations_name_the_sensors():
    import pathlib

    base = pathlib.Path(__file__).parent.parent / "custom_components" / "factorio"
    expected = {
        "strings.json": ("Machines working", "Problem lines", "Depleted drills"),
        "translations/en.json": ("Machines working", "Problem lines", "Depleted drills"),
        "translations/uk.json": ("Машини працюють", "Проблемні лінії", "Вичерпані свердла"),
    }
    for name, names in expected.items():
        sensors = json.loads((base / name).read_text(encoding="utf-8"))["entity"]["sensor"]
        got = tuple(sensors[k]["name"] for k in ("machines_working", "problem_lines", "drills_depleted"))
        assert got == names, name
