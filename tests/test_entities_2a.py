"""Stage 2a entities: server sensors, planet devices and new events (mocked broker)."""

import json

import pytest
from homeassistant.const import STATE_UNAVAILABLE
from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.json import json_bytes
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_capture_events,
    async_fire_mqtt_message,
)

from custom_components.factorio.const import DOMAIN, EVENT_TYPES

SERVER_SENSORS = [
    "sensor.factorio_main_bodies",
    "sensor.factorio_main_research",
    "sensor.factorio_main_recent_events",
]
OLD_ENTITIES = [
    "binary_sensor.factorio_main_connection",
    "binary_sensor.factorio_main_game_running",
    "sensor.factorio_main_game_state",
    "sensor.factorio_main_players_online",
    "event.factorio_main_game_events",
]
ATTACK = {
    "since_tick": 100,
    "position": [-412, 1180],
    "gps": "[gps=-412,1180,nauvis]",
    "losses": {"gun-turret": 4, "stone-wall": 12},
}
DEFENSE = {
    "by_planet": {
        "nauvis": {
            "turrets": {"total": 120, "no_ammo": 6, "no_power": 1, "no_ammo_at": [[10, -4], [12, -4]]},
            "walls_damaged": {"count": 12, "at": [[-412, 1180]]},
            "attack": ATTACK,
        }
    }
}
NEW_EVENTS = {
    "attack_started": {"planet": "nauvis", "surface": "nauvis", "position": [-412, 1180], "gps": "[gps=-412,1180,nauvis]"},
    "attack_ended": {"planet": "nauvis", "surface": "nauvis", "position": [-412, 1180], "gps": "[gps=-412,1180,nauvis]",
                     "duration_s": 75, "losses": {"stone-wall": 12}},
    "turrets_no_ammo": {"planet": "nauvis", "count": 6},
    "turrets_ok": {"planet": "nauvis"},
    "research_finished": {"name": "planet-discovery-gleba", "level": 1},
    "player_died": {"player": "alice", "planet": "nauvis", "surface": "nauvis", "cause": "small-biter"},
}


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(enable_custom_integrations):
    yield


def add_entry(hass: HomeAssistant) -> MockConfigEntry:
    entry = MockConfigEntry(domain=DOMAIN, unique_id="main", title="Factorio main",
                            data={"provider": "mqtt", "server_id": "main"}, options={"players": True})
    entry.add_to_hass(hass)
    return entry


async def setup(hass: HomeAssistant, entry: MockConfigEntry | None = None) -> MockConfigEntry:
    entry = entry or add_entry(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


async def fire(hass: HomeAssistant, topic: str, payload) -> None:
    async_fire_mqtt_message(hass, topic, payload if isinstance(payload, str) else json.dumps(payload))
    await hass.async_block_till_done()


async def push(hass: HomeAssistant, category: str, data) -> None:
    await fire(hass, f"factorio/main/data/{category}", {"v": 1, "tick": 5, "data": data})


def body(name: str, state: str = "built", kind: str = "planet", **extra) -> dict:
    return {"name": name, "kind": kind, "x": 0.0, "y": -15.0, "distance": 15, "orientation": 0.275,
            "magnitude": 1.0, "state": state, **extra}


def planet_ids(planet_slug: str) -> list[str]:
    return [
        f"binary_sensor.factorio_main_{planet_slug}_under_attack",
        f"sensor.factorio_main_{planet_slug}_turrets_no_ammo",
        f"sensor.factorio_main_{planet_slug}_walls_damaged",
    ]


def device(hass: HomeAssistant, entry: MockConfigEntry, ident: str):
    return dr.async_get(hass).async_get_device_by_identifier((DOMAIN, ident), entry.entry_id)


async def test_server_entities_created(hass: HomeAssistant, mqtt_mock):
    await setup(hass)
    for entity_id in SERVER_SENSORS:
        state = hass.states.get(entity_id)
        assert state is not None, entity_id
        assert state.state != STATE_UNAVAILABLE, entity_id

    await push(hass, "planets", {"bodies": [body("nauvis"), body("gleba", state="unlocked")]})
    bodies = hass.states.get("sensor.factorio_main_bodies")
    assert bodies.state == "1"
    assert [b["name"] for b in bodies.attributes["bodies"]] == ["nauvis", "gleba"]

    await push(hass, "research", {
        "current": {"name": "planet-discovery-gleba", "level": 1, "progress": 0.62, "unlocks": ["gleba"]},
        "queue": ["kovarex-enrichment-process"],
    })
    research = hass.states.get("sensor.factorio_main_research")
    assert research.state == "planet-discovery-gleba"
    assert {k: research.attributes[k] for k in ("progress", "level", "queue", "unlocks")} == {
        "progress": 62.0, "level": 1, "queue": ["kovarex-enrichment-process"], "unlocks": ["gleba"],
    }

    await push(hass, "players", {"online": ["alice", "guest"], "afk_minutes": {"guest": 4}})
    players = hass.states.get("sensor.factorio_main_players_online")
    assert players.attributes["players"] == ["alice", "guest"]
    assert players.attributes["afk_minutes"] == {"guest": 4}


async def test_planet_device_appears_when_built(hass: HomeAssistant, mqtt_mock, caplog):
    from custom_components.factorio.entity import pretty

    assert (pretty("secretas"), pretty("planet-x"), pretty("planet_y")) == ("Secretas", "Planet x", "Planet y")
    entry = await setup(hass)
    await push(hass, "planets", {"bodies": [body("nauvis"), body("gleba", state="unlocked"), body("planet-x")]})
    for entity_id in planet_ids("nauvis") + planet_ids("planet_x"):
        state = hass.states.get(entity_id)
        assert state is not None and state.state != STATE_UNAVAILABLE, entity_id
    for entity_id in planet_ids("gleba"):
        assert hass.states.get(entity_id) is None, entity_id
    assert hass.states.get("sensor.factorio_main_nauvis_evolution") is None  # no value yet

    server = device(hass, entry, "main")
    nauvis = device(hass, entry, "main:nauvis")
    assert nauvis.name == "Factorio · Nauvis"
    assert nauvis.via_device_id == server.id
    assert device(hass, entry, "main:planet-x").name == "Factorio · Planet x"
    entity = er.async_get(hass).async_get("sensor.factorio_main_nauvis_turrets_no_ammo")
    assert (entity.unique_id, entity.device_id) == ("main_nauvis_turrets_no_ammo", nauvis.id)

    # The evolution sensor appears once the planet has a value (not only when the device is created).
    await push(hass, "evolution", {"by_planet": {"nauvis": 0.92, "gleba": 0.5}})
    evolution = hass.states.get("sensor.factorio_main_nauvis_evolution")
    assert float(evolution.state) == 92.0
    assert evolution.attributes["unit_of_measurement"] == "%"
    assert evolution.attributes["state_class"] == "measurement"
    assert hass.states.get("sensor.factorio_main_gleba_evolution") is None  # not built yet

    await push(hass, "planets", {"bodies": [body("nauvis"), body("gleba"), body("planet-x")]})
    for entity_id in planet_ids("gleba") + ["sensor.factorio_main_gleba_evolution"]:
        assert hass.states.get(entity_id) is not None, entity_id
    assert float(hass.states.get("sensor.factorio_main_gleba_evolution").state) == 50.0
    assert "deprecated" not in caplog.text
    assert "does not generate unique IDs" not in caplog.text


async def test_planet_entities_from_data_known_before_platforms(hass: HomeAssistant, mqtt_mock):
    """Retained data can reach the core before the platforms are set up."""
    from unittest.mock import patch

    from custom_components.factorio.core import FactorioCore
    from custom_components.factorio.providers.base import ProviderMessage

    class PrefilledCore(FactorioCore):
        def __init__(self, server_id: str) -> None:
            super().__init__(server_id)
            self.handle_message(ProviderMessage("data", {"category": "planets", "data": {"bodies": [body("nauvis")]}}))
            self.handle_message(ProviderMessage("data", {"category": "evolution", "data": {"by_planet": {"nauvis": 0.3}}}))

    entry = add_entry(hass)
    # A device left from before a restart, for a body the data already says is gone.
    dr.async_get(hass).async_get_or_create(config_entry_id=entry.entry_id, identifiers={(DOMAIN, "main:old-moon")},
                                           name="Factorio · Old moon")
    with patch("custom_components.factorio.FactorioCore", PrefilledCore):
        await setup(hass, entry)
    for entity_id in planet_ids("nauvis") + ["sensor.factorio_main_nauvis_evolution"]:
        assert hass.states.get(entity_id) is not None, entity_id
    for entity_id in planet_ids("old_moon"):
        assert hass.states.get(entity_id) is None, entity_id  # gone: no entities for it
    await push(hass, "evolution", {"by_planet": {"nauvis": 0.31}})
    assert device(hass, entry, "main:old-moon") is None


@pytest.mark.parametrize("planets", [None, {"bodies": [body("nauvis", state="unlocked")]}],
                         ids=["planets_data_absent", "body_not_built"])
async def test_known_planet_entities_available_after_restart(hass: HomeAssistant, mqtt_mock, planets):
    """HA writes a restored 'unavailable' state for every registered entity at start; ours must replace it."""
    entry = add_entry(hass)
    devices = dr.async_get(hass)
    entities = er.async_get(hass)
    nauvis = devices.async_get_or_create(config_entry_id=entry.entry_id, identifiers={(DOMAIN, "main:nauvis")},
                                         name="Factorio · Nauvis")
    known = planet_ids("nauvis") + ["sensor.factorio_main_nauvis_evolution"]
    for entity_id in known:
        platform, object_id = entity_id.split(".")
        unique_id = "main_nauvis_" + object_id.removeprefix("factorio_main_nauvis_")
        entities.async_get_or_create(platform, DOMAIN, unique_id, config_entry=entry, device_id=nauvis.id,
                                     suggested_object_id=object_id)
        entities.async_get(entity_id).write_unavailable_state(hass)
    assert all(hass.states.get(entity_id).state == STATE_UNAVAILABLE for entity_id in known)

    await setup(hass, entry)
    if planets is not None:
        await push(hass, "planets", planets)
    await push(hass, "defense", DEFENSE)  # defense keeps flowing without the planets category
    for entity_id in known:
        state = hass.states.get(entity_id)
        assert state is not None and state.state != STATE_UNAVAILABLE, entity_id
    assert hass.states.get("sensor.factorio_main_nauvis_turrets_no_ammo").state == "6"
    assert hass.states.get("binary_sensor.factorio_main_nauvis_under_attack").state == "on"
    assert hass.states.get("sensor.factorio_main_nauvis_evolution").state == "unknown"  # no value now
    assert device(hass, entry, "main:nauvis") is not None


async def test_planet_device_removed_when_body_gone(hass: HomeAssistant, mqtt_mock, caplog):
    entry = add_entry(hass)
    registry = dr.async_get(hass)
    entities = er.async_get(hass)
    # Left over from before an HA restart: the planet is gone from the game since.
    orphan = registry.async_get_or_create(config_entry_id=entry.entry_id, identifiers={(DOMAIN, "main:old-moon")},
                                          name="Factorio · Old moon")
    await setup(hass, entry)
    assert device(hass, entry, "main:old-moon") is not None  # nothing known about bodies yet

    await push(hass, "planets", {"bodies": [body("nauvis"), body("planet-x"), body("gleba", state="unlocked")]})
    assert registry.async_get(orphan.id) is None
    assert device(hass, entry, "main:old-moon") is None  # not re-created by a late entity add
    for entity_id in planet_ids("old_moon"):
        assert hass.states.get(entity_id) is None, entity_id
    assert device(hass, entry, "main:planet-x") is not None

    # No longer built, but still a body: the device stays.
    await push(hass, "planets", {"bodies": [body("nauvis"), body("planet-x", state="unlocked")]})
    assert device(hass, entry, "main:planet-x") is not None
    assert hass.states.get("binary_sensor.factorio_main_planet_x_under_attack") is not None

    # The body is gone (mod removed): device and entities go, server and other planets stay.
    await push(hass, "planets", {"bodies": [body("nauvis")]})
    assert device(hass, entry, "main:planet-x") is None
    for entity_id in planet_ids("planet_x"):
        assert hass.states.get(entity_id) is None, entity_id
        assert entities.async_get(entity_id) is None, entity_id
    assert device(hass, entry, "main:nauvis") is not None
    assert device(hass, entry, "main") is not None
    for entity_id in OLD_ENTITIES + SERVER_SENSORS + planet_ids("nauvis"):
        assert hass.states.get(entity_id) is not None, entity_id

    # Planets category switched off: nothing is known, so nothing is removed.
    await fire(hass, "factorio/main/data/planets", "")
    assert device(hass, entry, "main:nauvis") is not None

    # The planet comes back.
    await push(hass, "planets", {"bodies": [body("nauvis"), body("planet-x")]})
    for entity_id in planet_ids("planet_x"):
        assert hass.states.get(entity_id) is not None, entity_id
    assert "does not generate unique IDs" not in caplog.text


async def test_attack_binary_sensor_follows_defense(hass: HomeAssistant, mqtt_mock):
    await setup(hass)
    await push(hass, "planets", {"bodies": [body("nauvis")]})
    attack_id = "binary_sensor.factorio_main_nauvis_under_attack"
    assert hass.states.get(attack_id).state == "unknown"  # no defense data at all

    await push(hass, "defense", DEFENSE)
    attack = hass.states.get(attack_id)
    assert attack.state == "on"
    assert {k: attack.attributes[k] for k in ATTACK} == ATTACK
    turrets = hass.states.get("sensor.factorio_main_nauvis_turrets_no_ammo")
    assert turrets.state == "6"
    assert {k: turrets.attributes[k] for k in ("total", "no_power", "positions")} == {
        "total": 120, "no_power": 1, "positions": [[10, -4], [12, -4]],
    }
    walls = hass.states.get("sensor.factorio_main_nauvis_walls_damaged")
    assert (walls.state, walls.attributes["positions"]) == ("12", [[-412, 1180]])

    # Lua sends an empty table as {} or []: both mean "no attack".
    for empty in ({}, []):
        nauvis = {**DEFENSE["by_planet"]["nauvis"], "attack": empty}
        await push(hass, "defense", {"by_planet": {"nauvis": nauvis}})
        assert hass.states.get(attack_id).state == "off", empty
    nauvis = {k: v for k, v in DEFENSE["by_planet"]["nauvis"].items() if k != "attack"}
    await push(hass, "defense", {"by_planet": {"nauvis": {**nauvis, "turrets": [], "walls_damaged": {}}}})
    assert hass.states.get(attack_id).state == "off"
    assert hass.states.get("sensor.factorio_main_nauvis_turrets_no_ammo").state == "0"
    assert hass.states.get("sensor.factorio_main_nauvis_walls_damaged").attributes["positions"] == []

    # A planet without turrets, walls or attacks is not listed at all.
    await push(hass, "defense", {"by_planet": []})
    assert hass.states.get(attack_id).state == "off"
    assert hass.states.get("sensor.factorio_main_nauvis_walls_damaged").state == "0"


async def test_bodies_attribute_under_16kb_for_60_bodies(hass: HomeAssistant, mqtt_mock):
    await setup(hass)
    bodies = []
    for i in range(60):
        name = f"modded-planet-name-{i:02d}"
        entry = {
            "name": name,
            "kind": "planet" if i % 4 else "space-location",
            "x": round(-123.4567 + i * 7.1234, 4),
            "y": round(98.7654 - i * 5.4321, 4),
            "distance": round(15.1234 + i * 1.0123, 4),
            "orientation": round((i * 0.0173) % 1, 4),
            "magnitude": round(0.5 + (i % 7) * 0.1234, 4),
            "state": ("built", "unlocked", "locked")[i % 3],
            "unlocked_by": f"planet-discovery-{name}",
        }
        if i % 5 == 4:
            entry["parent"] = f"modded-planet-name-{i - 1:02d}"
        bodies.append(entry)
    await push(hass, "planets", {"bodies": bodies})
    state = hass.states.get("sensor.factorio_main_bodies")
    assert state.state == "20"
    assert len(state.attributes["bodies"]) == 60
    assert len(json_bytes(dict(state.attributes))) < 16 * 1024
    assert "bodies" in state.state_info["unrecorded_attributes"]


async def test_new_events_fire_on_bus(hass: HomeAssistant, mqtt_mock):
    captured = {name: async_capture_events(hass, f"{DOMAIN}_{name}") for name in NEW_EVENTS}
    await setup(hass)
    now = dt_util.utcnow().replace(microsecond=0)
    for name, data in NEW_EVENTS.items():
        await fire(hass, "factorio/main/event",
                   {"v": 1, "event": name, "tick": 9, "time": now.isoformat(), "data": data})
        state = hass.states.get("event.factorio_main_game_events")
        assert state.attributes["event_type"] == name
        assert {k: state.attributes[k] for k in data} == data
    for name, data in NEW_EVENTS.items():
        assert [e.data for e in captured[name]] == [{**data, "server_id": "main"}], name

    # The feed refreshes on events alone (they do not notify the regular listeners).
    recent = hass.states.get("sensor.factorio_main_recent_events")
    assert [e["event"] for e in recent.attributes["events"]] == list(reversed(NEW_EVENTS))
    assert recent.attributes["events"][0]["data"] == NEW_EVENTS["player_died"]
    assert dt_util.parse_datetime(recent.state) == now
    assert "events" in recent.state_info["unrecorded_attributes"]


async def test_entities_never_unavailable_when_relay_offline(hass: HomeAssistant, mqtt_mock):
    await setup(hass)
    await fire(hass, "factorio/main/availability", "online")
    await push(hass, "planets", {"bodies": [body("nauvis")]})
    await push(hass, "defense", DEFENSE)
    await push(hass, "evolution", {"by_planet": {"nauvis": 0.92}})
    await push(hass, "research", {"current": {"name": "rocket-silo", "progress": 0.5}, "queue": []})
    await fire(hass, "factorio/main/availability", "offline")
    planet = planet_ids("nauvis") + ["sensor.factorio_main_nauvis_evolution"]
    for entity_id in OLD_ENTITIES + SERVER_SENSORS + planet:
        state = hass.states.get(entity_id)
        assert state is not None and state.state != STATE_UNAVAILABLE, entity_id
    assert hass.states.get("binary_sensor.factorio_main_nauvis_under_attack").state == "on"
    assert hass.states.get("sensor.factorio_main_nauvis_turrets_no_ammo").state == "6"
    assert hass.states.get("sensor.factorio_main_research").state == "rocket-silo"
    assert hass.states.get("sensor.factorio_main_bodies").state == "1"


NAMES = {
    "en": {
        "sensor.bodies": "Bodies in system", "sensor.research": "Research", "sensor.recent_events": "Recent events",
        "binary_sensor.under_attack": "Under attack", "sensor.turrets_no_ammo": "Turrets without ammo",
        "sensor.walls_damaged": "Damaged walls", "sensor.evolution": "Enemy evolution",
    },
    "uk": {
        "sensor.bodies": "Тіла системи", "sensor.research": "Дослідження", "sensor.recent_events": "Останні події",
        "binary_sensor.under_attack": "Під атакою", "sensor.turrets_no_ammo": "Турелі без набоїв",
        "sensor.walls_damaged": "Пошкоджені стіни", "sensor.evolution": "Еволюція ворогів",
    },
}


@pytest.mark.parametrize("lang", ["en", "uk"])
async def test_new_names_and_event_types_translated(hass: HomeAssistant, mqtt_mock, lang):
    from homeassistant.helpers.translation import async_get_translations

    await setup(hass)
    tr = await async_get_translations(hass, lang, "entity", {DOMAIN})
    base = f"component.{DOMAIN}.entity"
    assert {key: tr.get(f"{base}.{key}.name") for key in NAMES[lang]} == NAMES[lang]
    event_types = f"{base}.event.game_events.state_attributes.event_type.state"
    assert [name for name in EVENT_TYPES if not tr.get(f"{event_types}.{name}")] == []
