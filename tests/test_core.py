"""FactorioCore without Home Assistant."""

from custom_components.factorio.core import FactorioCore, build_config
from custom_components.factorio.providers.base import ProviderMessage

STATE = {
    "v": 1, "game_state": "running", "game_state_reason": None,
    "game_state_since": "2026-11-11T10:00:00+00:00", "tick": 300,
    "players_online": 2, "data": {"players": {"online": ["guest", "alice"]}},
}


def feed(core: FactorioCore, kind: str, payload) -> None:
    core.handle_message(ProviderMessage(kind=kind, payload=payload))


def test_running_when_online():
    core = FactorioCore("main")
    feed(core, "availability", "online")
    feed(core, "state", STATE)
    assert core.relay_online is True
    assert core.game_state == "running"
    assert core.game_state_since == "2026-11-11T10:00:00+00:00"


def test_no_connection_keeps_last_values():
    core = FactorioCore("main")
    feed(core, "availability", "online")
    feed(core, "state", STATE)
    feed(core, "availability", "offline")
    assert core.game_state == "no_connection"
    assert core.players_online == 2
    assert core.players == ["guest", "alice"]


def test_nothing_known_yet():
    core = FactorioCore("main")
    assert (core.relay_online, core.game_state, core.players_online, core.players) == (None, None, None, None)


def test_players_none_when_category_absent():
    core = FactorioCore("main")
    feed(core, "state", {**STATE, "data": {}})
    assert core.players is None


def test_paused_reason():
    core = FactorioCore("main")
    feed(core, "availability", "online")
    feed(core, "state", {**STATE, "game_state": "paused", "game_state_reason": "no_players"})
    assert (core.game_state, core.game_state_reason) == ("paused", "no_players")


def test_mod_version_from_hello():
    core = FactorioCore("main")
    feed(core, "hello", {"v": 1, "server_id": "main", "relay_version": "0.1.0", "mod_version": "0.1.0"})
    assert core.mod_version == "0.1.0"


def test_event_reaches_event_listeners():
    core = FactorioCore("main")
    got = []
    core.add_event_listener(lambda name, data: got.append((name, data)))
    feed(core, "event", {"v": 1, "event": "player_joined", "tick": 9, "time": "t", "data": {"player": "guest"}})
    assert got == [("player_joined", {"player": "guest"})]


def test_malformed_payloads_ignored():
    core = FactorioCore("main")
    calls = []
    core.add_listener(lambda: calls.append(1))
    feed(core, "state", "not a dict")
    feed(core, "event", {"no": "name"})
    assert (core.game_state, calls) == (None, [])


def test_listeners_notified_on_change_and_unsubscribe_works():
    core = FactorioCore("main")
    calls = []
    unsubscribe = core.add_listener(lambda: calls.append(1))
    feed(core, "availability", "online")
    feed(core, "state", STATE)
    unsubscribe()
    feed(core, "availability", "offline")
    assert calls == [1, 1]


def test_build_config_defaults_on():
    assert build_config({}) == {"v": 1, "categories": {"players": True, "planets": True, "defense": True, "evolution": True, "research": True}}
    assert build_config({"players": False}) == {"v": 1, "categories": {**{"players": True, "planets": True, "defense": True, "evolution": True, "research": True}, "players": False}}


# --- data categories (stage 2a) ------------------------------------------------

from datetime import timedelta  # noqa: E402

from homeassistant.util import dt as dt_util  # noqa: E402

from custom_components.factorio.core import as_dict, as_list  # noqa: E402


def data(core: FactorioCore, category: str, payload) -> None:
    feed(core, "data", {"category": category, "data": payload})


def event_msg(event: str, when, **payload) -> dict:
    return {"v": 1, "event": event, "tick": 1, "time": when if isinstance(when, str) else when.isoformat(), "data": payload}


def test_data_category_stored_and_cleared():
    core = FactorioCore("main")
    seen = []
    core.add_listener(lambda: seen.append(1))
    data(core, "evolution", {"by_planet": {"nauvis": 0.5}})
    assert core.category("evolution") == {"by_planet": {"nauvis": 0.5}}
    assert core.evolution("nauvis") == 0.5
    data(core, "evolution", None)
    assert core.category("evolution") is None
    assert core.evolution("nauvis") is None
    assert len(seen) == 2


def test_players_fall_back_to_state():
    core = FactorioCore("main")
    feed(core, "state", STATE)
    assert core.players == ["guest", "alice"]
    data(core, "players", None)
    assert core.players == ["guest", "alice"]


def test_players_prefer_data_topic():
    core = FactorioCore("main")
    feed(core, "state", STATE)
    data(core, "players", {"online": ["bob"], "afk_minutes": {"bob": 3}})
    assert core.players == ["bob"]
    assert core.afk_minutes == {"bob": 3}
    data(core, "players", {"online": {}, "afk_minutes": []})
    assert core.players == []
    assert core.afk_minutes == {}


def test_recent_events_window_and_cap():
    core = FactorioCore("main")
    now = dt_util.utcnow()
    feed(core, "event", event_msg("player_left", now - timedelta(minutes=61), player="old"))
    feed(core, "event", event_msg("player_left", "garbage", player="bad"))
    for i in range(61):
        feed(core, "event", event_msg("player_joined", now - timedelta(minutes=59, seconds=-i), player=f"p{i}"))
    events = core.recent_events
    assert len(events) == 50
    assert events[0]["data"]["player"] == "p60"
    assert events[0]["event"] == "player_joined"
    assert set(events[0]) == {"event", "time", "data"}
    assert all(e["data"]["player"] not in ("old", "bad") for e in events)


def test_recent_events_expire_with_time():
    core = FactorioCore("main")
    feed(core, "event", event_msg("turrets_ok", dt_util.utcnow() - timedelta(minutes=59, seconds=59), planet="nauvis"))
    assert len(core.recent_events) == 1
    feed(core, "event", event_msg("turrets_ok", dt_util.utcnow() - timedelta(minutes=61), planet="nauvis"))
    assert len(core.recent_events) == 1


def test_empty_lua_tables_normalized():
    assert as_dict([]) == {} and as_dict({"a": 1}) == {"a": 1} and as_dict(None) == {}
    assert as_list({}) == [] and as_list([1]) == [1] and as_list(None) == []
    core = FactorioCore("main")
    data(core, "planets", {"bodies": {}})
    data(core, "research", {"queue": {}})
    data(core, "defense", {"by_planet": []})
    data(core, "evolution", {"by_planet": []})
    assert core.bodies == []
    assert core.research == {"current": None, "queue": []}
    assert core.defense("nauvis") is None
    assert core.evolution("nauvis") is None
    data(core, "defense", {"by_planet": {"nauvis": {"turrets": [], "walls_damaged": {}}}})
    assert core.defense("nauvis") == {"turrets": {}, "walls_damaged": {}, "attack": None}
    data(core, "research", {"current": {"name": "x", "unlocks": {}}, "queue": ["a"]})
    assert core.research == {"current": {"name": "x", "unlocks": []}, "queue": ["a"]}


def test_built_planets_from_bodies():
    core = FactorioCore("main")
    assert core.built_planets == []
    data(core, "planets", {"bodies": [
        {"name": "nauvis", "kind": "planet", "state": "built"},
        {"name": "gleba", "kind": "planet", "state": "unlocked"},
        {"name": "vulcanus", "kind": "planet", "state": "built", "parent": None},
        {"name": "aquilo", "kind": "planet", "state": "locked"},
    ]})
    assert core.built_planets == ["nauvis", "vulcanus"]
    assert core.bodies[0]["parent"] is None and core.bodies[0]["unlocked_by"] is None
