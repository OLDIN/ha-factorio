"""Publish a scenario to a dev MQTT broker the way the relay does (docs/protocol.md in factorio-ha-bridge).

usage: dev_relay.py <host> <port> <scenario> [server_id]
Scenarios: paused (an attack on a paused game, nobody online), running (players, research,
events), calm (nothing wrong). availability, hello, state and data/* are retained, events
and the game clock are not, as with the real relay. Values are what the mod sends: evolution
and research progress are fractions, the integration turns them into percent.

paused and running carry a stopped line on Fulgora and depleted iron drills on Nauvis.
data/machines goes out once with tick TICK; then, while the game runs (running, calm), the
clock topic moves to TICK + CLOCK_AHEAD, as relay heartbeats would: two game minutes later
the default line rule (30% for 2 min) reports the Fulgora line, with no new machines data.
"""

from __future__ import annotations

import json
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

import paho.mqtt.client as mqtt

ROOT = Path(__file__).resolve().parent.parent
BODIES = json.loads((ROOT / "frontend" / "test" / "fixtures" / "bodies-21.json").read_text())
SCENARIOS = ("paused", "running", "calm")
TICK = 90_000_000
CLOCK_AHEAD = 7_200  # two game minutes: the default line_problem_minutes


def iso(minutes_ago: float = 0) -> str:
    return (datetime.now(UTC) - timedelta(minutes=minutes_ago)).isoformat().replace("+00:00", "Z")


def retained(name: str, sid: str) -> dict[str, object]:
    """Topic suffix → payload of the retained topics."""
    running = name == "running"
    calm = name == "calm"
    players = ["alice", "guest"] if running else []
    research = (
        {"current": {"name": "planet-discovery-maraxsis", "level": 1, "progress": 0.62, "unlocks": ["maraxsis"]},
         "queue": ["planet-discovery-maraxsis", "a", "b", "c"]}
        if running
        else {"current": {"name": "research-productivity", "level": 17, "progress": 0.111, "unlocks": []},
              "queue": ["research-productivity", "a", "b", "c"]}
    )
    attack = {
        "since_tick": TICK - 14_400,
        "position": [122, -259],
        "gps": "[gps=122,-259,gleba]",
        "losses": {"gun-turret": 7, "medium-electric-pole": 7, "bulk-inserter": 6, "rocket-turret": 4, "substation": 1},
    }

    def planet(no_ammo: int, no_power: int, walls: int, total: int, with_attack: bool = False) -> dict:
        entry = {
            "turrets": {"total": total, "no_ammo": no_ammo, "no_power": no_power, "no_ammo_at": []},
            "walls_damaged": {"count": walls, "at": []},
        }
        return {**entry, "attack": attack} if with_attack else entry

    defense = {
        "nauvis": planet(0 if calm else 25, 0 if calm else 2, 0, 4353),
        "gleba": planet(0 if calm else 14, 0, 0, 300, with_attack=not calm),
        "corrundum": planet(0, 0, 0 if calm else 12, 40),
    }
    evolution = {"nauvis": 0.924, "vulcanus": 0.792, "gleba": 0.889, "fulgora": 0.761, "aquilo": 0.53, "moshine": 0.61, "corrundum": 0.4}
    game_state = "paused" if name == "paused" else "running"

    def group(recipe: str, total: int, working: int, no_input: int = 0, output_full: int = 0, no_power: int = 0, at=()) -> dict:
        return {"recipe": recipe, "total": total, "working": working, "no_input": no_input,
                "output_full": output_full, "no_power": no_power, "at": [list(p) for p in at]}

    machines = {
        "nauvis": {"total": 1551, "working": 1551 if calm else 1512,
                   "groups": [] if calm else [group("iron-plate", 96, 80, no_input=16, at=[(-120, 40), (-118, 40)])]},
        "vulcanus": {"total": 300, "working": 300 if calm else 291, "groups": []},
        "gleba": {"total": 220, "working": 220 if calm else 204, "groups": []},
        "fulgora": {"total": 441, "working": 441 if calm else 388,
                    "groups": [] if calm else [group("scrap-recycling", 48, 17, output_full=31, at=[(310, -42), (312, -42), (314, -42)])]},
    }
    iron = {"total": 96, "working": 96 if calm else 80, "depleted": 0 if calm else 14, "stuck": 0 if calm else 2}
    drills = {
        "nauvis": {"total": 140, "working": 140 if calm else 124,
                   "by_resource": {"iron-ore": iron, "copper-ore": {"total": 44, "working": 44, "depleted": 0, "stuck": 0}}},
        "vulcanus": {"total": 30, "working": 30, "by_resource": {"tungsten-ore": {"total": 30, "working": 30, "depleted": 0, "stuck": 0}}},
    }

    def data(payload: dict) -> dict:
        return {"v": 1, "tick": TICK, "data": payload}

    return {
        "availability": "online",
        "hello": {"v": 1, "server_id": sid, "relay_version": "dev", "mod_version": "dev"},
        "state": {
            "v": 1,
            "game_state": game_state,
            "game_state_reason": "no_players" if game_state == "paused" else None,
            "game_state_since": iso(3 if game_state == "paused" else 90),
            "tick": TICK,
            "players_online": len(players),
            "data": {"players": {"online": players}},
        },
        "data/planets": data({"bodies": BODIES}),
        "data/research": data(research),
        "data/evolution": data({"by_planet": evolution}),
        "data/defense": data({"by_planet": defense}),
        "data/players": data({"online": players, "afk_minutes": {"guest": 4} if running else {}}),
        "data/machines": data({"by_planet": machines}),
        "data/drills": data({"by_planet": drills}),
    }


def events(name: str) -> list[dict]:
    """Events of the last hour, oldest first (the integration keeps them in memory)."""
    if name != "running":
        return []
    items = [
        (44, "research_finished", {"name": "planet-discovery-gleba", "level": 1}),
        (31, "player_joined", {"player": "guest"}),
        (9, "player_joined", {"player": "alice"}),
        (8.5, "turrets_no_ammo", {"planet": "nauvis", "count": 25}),
        (8, "turrets_no_ammo", {"planet": "gleba", "count": 14}),
        (6, "player_died", {"player": "guest", "planet": "gleba", "surface": "gleba"}),
        (4, "attack_started", {"planet": "gleba", "surface": "gleba", "position": [122, -259], "gps": "[gps=122,-259,gleba]"}),
    ]
    return [{"v": 1, "event": event, "tick": TICK, "time": iso(minutes), "data": payload} for minutes, event, payload in items]


def main() -> None:
    host, port, name = sys.argv[1], int(sys.argv[2]), sys.argv[3]
    sid = sys.argv[4] if len(sys.argv) > 4 else "main"
    if name not in SCENARIOS:
        sys.exit(f"unknown scenario {name!r}: {' | '.join(SCENARIOS)}")
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="factorio-ha-dev-relay")
    client.connect(host, port)
    client.loop_start()
    base = f"factorio/{sid}"
    for suffix, payload in retained(name, sid).items():
        body = payload if isinstance(payload, str) else json.dumps(payload, separators=(",", ":"))
        client.publish(f"{base}/{suffix}", body, qos=1, retain=True).wait_for_publish()
    for event in events(name):
        client.publish(f"{base}/event", json.dumps(event, separators=(",", ":")), qos=1).wait_for_publish()
    if name != "paused":  # the relay publishes the clock only while the game runs
        clock = {"v": 1, "tick": TICK + CLOCK_AHEAD}
        client.publish(f"{base}/tick", json.dumps(clock, separators=(",", ":")), qos=1).wait_for_publish()
    client.loop_stop()
    client.disconnect()
    print(f"scenario {name}: published to {host}:{port} as {base}")


if __name__ == "__main__":
    main()
