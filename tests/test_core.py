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
    assert build_config({}) == {"v": 1, "categories": {"players": True, "planets": True, "defense": True, "evolution": True, "research": True, "machines": True, "drills": True}}
    assert build_config({"players": False}) == {"v": 1, "categories": {**{"players": True, "planets": True, "defense": True, "evolution": True, "research": True, "machines": True, "drills": True}, "players": False}}


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


# --- lines and drills (stage 2b) -----------------------------------------------

from custom_components.factorio.lines import TICKS_PER_MINUTE  # noqa: E402


def machines_payload(group_no_input=40) -> dict:
    groups = [{"recipe": "iron-plate", "total": 100, "working": 100 - group_no_input, "no_input": group_no_input,
               "output_full": 0, "no_power": 0, "at": [[1, 2]]}] if group_no_input else []
    return {"by_planet": {"nauvis": {"total": 200, "working": 160, "groups": groups}}}


def machines(core: FactorioCore, payload, tick: int | None) -> None:
    feed(core, "data", {"category": "machines", "data": payload, "tick": tick})


def clock(core: FactorioCore, tick: int) -> None:
    feed(core, "tick", {"tick": tick})


def collect(core: FactorioCore):
    events, changes = [], []
    core.add_event_listener(lambda name, data: events.append((name, data)))
    core.add_listener(lambda: changes.append(1))
    return events, changes


def test_machines_data_with_tick_gives_line_problem_event():
    core = FactorioCore("main")
    events, _ = collect(core)
    machines(core, machines_payload(), 1000)
    assert core.problem_lines("nauvis") == []
    machines(core, machines_payload(45), 1000 + 2 * TICKS_PER_MINUTE)
    assert [e[0] for e in events] == ["line_problem"]
    assert events[0][1]["planet"] == "nauvis"
    problem = core.problem_lines("nauvis")[0]
    assert (problem["recipe"], problem["reason"], problem["minutes"]) == ("iron-plate", "no_input", 2)
    assert [e["event"] for e in core.recent_events] == ["line_problem"]


def test_clock_tick_alone_brings_the_line_to_a_problem():
    core = FactorioCore("main")
    events, changes = collect(core)
    machines(core, machines_payload(), 1000)
    changes.clear()
    clock(core, 8199)
    assert events == [] and changes == []
    clock(core, 8200)
    assert [e[0] for e in events] == ["line_problem"]
    assert len(changes) == 1
    assert core.problem_lines("nauvis")[0]["minutes"] == 2
    clock(core, 8500)  # nothing changed: listeners stay quiet
    assert len(changes) == 1
    clock(core, 8200 + TICKS_PER_MINUTE)  # minutes grew: sensors must refresh
    assert len(changes) == 2
    assert core.problem_lines("nauvis")[0]["minutes"] == 3


def test_clock_tick_without_machines_data_does_nothing():
    core = FactorioCore("main")
    events, changes = collect(core)
    clock(core, 5000)
    assert events == [] and changes == []
    assert core.problem_lines("nauvis") is None


def test_set_line_rule_changes_threshold_and_hold():
    core = FactorioCore("main")
    events, _ = collect(core)
    core.set_line_rule(0.5, 1)
    machines(core, machines_payload(), 0)
    clock(core, 7200)
    assert events == []  # 40% is under 50%
    core.set_line_rule(0.3, 1)
    machines(core, machines_payload(45), 7200)
    clock(core, 7200 + TICKS_PER_MINUTE)
    assert [e[0] for e in events] == ["line_problem"]


def test_machines_and_drills_accessors():
    core = FactorioCore("main")
    assert core.machines("nauvis") is None and core.drills("nauvis") is None and core.problem_lines("nauvis") is None
    machines(core, machines_payload(), 10)
    assert core.machines("nauvis") == {"total": 200, "working": 160}
    assert core.machines("gleba") is None and core.problem_lines("gleba") is None
    by_resource = {"iron-ore": {"total": 96, "working": 80, "depleted": 14, "stuck": 2}}
    feed(core, "data", {"category": "drills", "tick": 10,
                        "data": {"by_planet": {"nauvis": {"total": 140, "working": 110, "by_resource": by_resource}}}})
    assert core.drills("nauvis") == {"total": 140, "working": 110, "by_resource": by_resource}


def test_drills_depleted_event_and_unknown_resource():
    core = FactorioCore("main")
    events, _ = collect(core)

    def drills(depleted, resource="iron-ore"):
        stats = {resource: {"total": 96, "working": 80, "depleted": depleted, "stuck": 0}}
        return {"by_planet": {"nauvis": {"total": 96, "working": 80, "by_resource": stats}}}

    feed(core, "data", {"category": "drills", "tick": 100, "data": drills(14)})
    feed(core, "data", {"category": "drills", "tick": 200, "data": drills(16)})
    assert events == [("drills_depleted", {"planet": "nauvis", "resource": "iron-ore", "depleted": 16, "total": 96})]
    feed(core, "data", {"category": "drills", "tick": 100000, "data": drills(3, "unknown")})
    feed(core, "data", {"category": "drills", "tick": 200000, "data": drills(8, "unknown")})
    assert len(events) == 1


def test_category_off_resets_trackers_silently():
    core = FactorioCore("main")
    events, _ = collect(core)
    machines(core, machines_payload(), 1000)
    clock(core, 8200)
    assert len(events) == 1
    machines(core, None, None)
    assert core.problem_lines("nauvis") is None and core.machines("nauvis") is None
    clock(core, 20000)
    assert len(events) == 1
    machines(core, machines_payload(), 21000)  # a new baseline: anchored again
    clock(core, 28100)
    assert len(events) == 1
    clock(core, 28200)
    assert len(events) == 2
    feed(core, "data", {"category": "drills", "tick": 1, "data": {"by_planet": {"nauvis": {"by_resource": {"iron-ore": {"total": 5, "depleted": 1}}}}}})
    feed(core, "data", {"category": "drills", "tick": 2, "data": None})
    feed(core, "data", {"category": "drills", "tick": 3, "data": {"by_planet": {"nauvis": {"by_resource": {"iron-ore": {"total": 5, "depleted": 4}}}}}})
    assert len(events) == 2  # not an event: the first value after the category came back


def test_data_without_tick_does_not_feed_the_tracker():
    core = FactorioCore("main")
    events, _ = collect(core)
    feed(core, "data", {"category": "machines", "data": machines_payload()})
    clock(core, 99999)
    assert events == []
    assert core.machines("nauvis") == {"total": 200, "working": 160}


def test_malformed_tick_ignored():
    core = FactorioCore("main")
    machines(core, machines_payload(), 1000)
    for bad in ({"tick": "x"}, {"tick": True}, {}, None):
        feed(core, "tick", bad)
    assert core.problem_lines("nauvis") == []


def test_redelivered_retained_machines_data_keeps_the_problem():
    core = FactorioCore("main")
    events, changes = collect(core)
    machines(core, machines_payload(), 1000)
    clock(core, 8200)
    clock(core, 50000)
    before = core.problem_lines("nauvis")
    minutes = before[0]["minutes"]
    seen: list = []
    core.add_listener(lambda: seen.append(core.problem_lines("nauvis")))
    events.clear()
    changes.clear()
    machines(core, machines_payload(), 1000)  # MQTT reconnect: retained data comes again
    assert events == []
    assert core.problem_lines("nauvis")[0]["minutes"] == minutes
    assert seen and all(snapshot == before for snapshot in seen)  # no flap seen by listeners
    clock(core, 50300)
    assert events == []
