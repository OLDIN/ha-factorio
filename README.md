# Factorio for Home Assistant

Live Factorio server state in Home Assistant: game state (running / paused /
stopped / no connection), players online and game events.

The game side — a Factorio mod and a small relay next to the server — lives in
[factorio-ha-bridge](https://github.com/OLDIN/factorio-ha-bridge); the protocol is
described in its [docs/protocol.md](https://github.com/OLDIN/factorio-ha-bridge/blob/main/docs/protocol.md).

```
Factorio mod ──UDP──▶ relay ──MQTT──▶ this integration
```

Status: proof of concept.

## Install

1. Run the relay from factorio-ha-bridge next to your Factorio server and point it
   at your MQTT broker.
2. Home Assistant needs the MQTT integration (e.g. the Mosquitto add-on).
3. HACS / Marketplace → Custom repositories → `https://github.com/OLDIN/ha-factorio`
   (type Integration) → Download → restart Home Assistant.
4. The server shows up under Settings → Devices & services → Discovered
   (via `factorio/+/hello`), or add "Factorio" manually with the relay's `FHA_SERVER_ID`.

## Entities

| Entity | Meaning |
|---|---|
| `binary_sensor.factorio_<id>_connection` | the relay is online |
| `binary_sensor.factorio_<id>_game_running` | the game is ticking |
| `sensor.factorio_<id>_game_state` | `running` / `paused` / `stopped` / `no_connection` (attributes `reason`, `since`) |
| `sensor.factorio_<id>_players_online` | count; attribute `players` |
| `event.factorio_<id>_game_events` | `player_joined` / `player_left`; also fired on the bus as `factorio_<event>` |

Values never turn `unavailable`: when the connection is lost they keep the last
known value and `game_state` becomes `no_connection`. Removing the integration
clears its config, so the game stops collecting data.

## Development

```bash
uv venv --python 3.14 .venv-ha
uv pip install --python .venv-ha/bin/python -r requirements.txt
.venv-ha/bin/pytest
```
