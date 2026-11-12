"""Set the Factorio entities of a dev Home Assistant to a scenario through the REST API.

usage: dev_states.py <base_url> <token> <scenario>
Scenarios: paused (attack on a paused game, nobody online), running (players, research,
events), calm (nothing wrong). States set this way stand in for what the relay sends over
MQTT; the cards only read states.
"""

from __future__ import annotations

import json
import sys
import urllib.request
from datetime import UTC, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BODIES = json.loads((ROOT / "frontend" / "test" / "fixtures" / "bodies-21.json").read_text())
SID = "main"


def ago(minutes: float) -> str:
    return (datetime.now(UTC) - timedelta(minutes=minutes)).isoformat()


def scenario(name: str) -> dict[str, tuple[str, dict]]:
    running = name == "running"
    calm = name == "calm"
    s: dict[str, tuple[str, dict]] = {
        "sensor.factorio_main_bodies": (str(sum(b["state"] == "built" for b in BODIES)), {"bodies": BODIES}),
        "sensor.factorio_main_game_state": ("paused" if name == "paused" else "running", {}),
        "binary_sensor.factorio_main_connection": ("on", {}),
        "sensor.factorio_main_players_online": (
            "2" if running else "0",
            {"players": ["alice", "guest"] if running else [], "afk_minutes": {"guest": 4} if running else {}},
        ),
        "sensor.factorio_main_research": (
            ("planet-discovery-maraxsis", {"progress": 62, "level": 1, "queue": ["planet-discovery-maraxsis", "a", "b", "c"], "unlocks": ["maraxsis"]})
            if running
            else ("research-productivity", {"progress": 11.1, "level": 17, "queue": ["research-productivity", "a", "b", "c"], "unlocks": []})
        ),
    }
    evolution = {"nauvis": 92.4, "vulcanus": 79.2, "gleba": 88.9, "fulgora": 76.1, "aquilo": 53.0, "moshine": 61.0, "corrundum": 40.0}
    for planet, value in evolution.items():
        s[f"sensor.factorio_main_{planet}_evolution"] = (str(value), {"unit_of_measurement": "%"})
    attack = not calm
    s["binary_sensor.factorio_main_gleba_under_attack"] = (
        "on" if attack else "off",
        {
            "since_tick": 1,
            "position": [122, -259],
            "gps": "[gps=122,-259,gleba]",
            "losses": {"gun-turret": 7, "medium-electric-pole": 7, "bulk-inserter": 6, "rocket-turret": 4, "substation": 1},
        }
        if attack
        else {},
    )
    s["sensor.factorio_main_gleba_turrets_no_ammo"] = ("0" if calm else "14", {"total": 300, "no_power": 0, "positions": []})
    s["sensor.factorio_main_nauvis_turrets_no_ammo"] = ("0" if calm else "25", {"total": 4353, "no_power": 0 if calm else 2, "positions": []})
    s["sensor.factorio_main_corrundum_walls_damaged"] = ("0" if calm else "12", {"positions": []})
    events = (
        [
            {"event": "attack_started", "time": ago(4), "data": {"planet": "gleba"}},
            {"event": "turrets_no_ammo", "time": ago(8), "data": {"planet": "gleba", "count": 14}},
            {"event": "turrets_no_ammo", "time": ago(8.5), "data": {"planet": "nauvis", "count": 25}},
            {"event": "player_died", "time": ago(6), "data": {"player": "guest", "planet": "gleba"}},
            {"event": "player_joined", "time": ago(9), "data": {"player": "alice"}},
            {"event": "player_joined", "time": ago(31), "data": {"player": "guest"}},
            {"event": "research_finished", "time": ago(44), "data": {"name": "planet-discovery-gleba", "level": 1}},
        ]
        if running
        else []
    )
    s["sensor.factorio_main_recent_events"] = (events[0]["time"] if events else "unknown", {"events": events})
    return s


def main() -> None:
    base, token, name = sys.argv[1], sys.argv[2], sys.argv[3]
    if name not in ("paused", "running", "calm"):
        sys.exit(f"unknown scenario {name!r}: paused | running | calm")
    for entity_id, (state, attributes) in scenario(name).items():
        req = urllib.request.Request(
            f"{base}/api/states/{entity_id}",
            data=json.dumps({"state": state, "attributes": attributes}).encode(),
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            method="POST",
        )
        urllib.request.urlopen(req).close()
    print(f"scenario {name}: {len(scenario(name))} states set")


if __name__ == "__main__":
    main()
