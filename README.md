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

## Roadmap

The goal: see what happens in a Factorio server that keeps running while you are
away — attacks, lines that ran out of resources, depleted ore patches — and react
with notifications or voice announcements. Data is grouped (per planet, per recipe)
so a big base gives dozens of entities, not thousands. Everything below is chosen in
the integration options, and the game collects only what is enabled.

### Done (v0.1, proof of concept)

- [x] Relay ↔ Home Assistant over MQTT, with discovery (`factorio/+/hello`)
- [x] Game state: running / paused / stopped / no connection
- [x] Players online (count + names)
- [x] Events: `player_joined`, `player_left` (event entity + HA bus event)
- [x] Config from Home Assistant: the game collects nothing until HA asks for it
- [x] Values never turn `unavailable`; survive relay, game and HA restarts

### Sensors (planned)

- [ ] Machines per planet: % working, grouped by recipe
- [ ] Problem lines per planet: no ingredients / output full / no power (list in attributes)
- [ ] Dedicated sensors for lines you pick in the options (e.g. iron plates on Nauvis)
- [ ] Mining drills: depleted resource patches
- [ ] Enemy evolution per planet
- [ ] Research: current, progress, queue
- [ ] Space platforms: where they are, in transit, waiting, losses
- [ ] Recent events feed for dashboards

### Events (planned)

- [x] `player_joined` / `player_left`
- [ ] `player_died`
- [ ] `research_finished`
- [ ] `attack_started` / `attack_ended` — merged by time and area, with position and losses
- [ ] `line_problem` / `line_recovered`
- [ ] `drills_depleted`
- [ ] `platform_damaged`, platform arrived / departed

### Later

- [ ] Item, recipe and planet names from the game (English, Ukrainian)
- [ ] Dashboard examples
- [ ] Notification and voice announcement blueprints
- [ ] Direct stream provider (no MQTT broker needed)
- [ ] Mod on the Factorio mod portal; integration in the default HACS list
- Ideas: production rates, logistics storage, power network, platform ammo/fuel

## Releasing

```bash
python3 scripts/bump_version.py patch --pr   # or minor / major
```

Bumps `manifest.json`, writes `RELEASE_NOTES_X.Y.Z.md` from the commits since the
last tag and opens a PR. After the merge the `Release` workflow tags `vX.Y.Z` and
publishes the GitHub Release that HACS installs.

## Development

```bash
uv venv --python 3.14 .venv-ha
uv pip install --python .venv-ha/bin/python -r requirements.txt
.venv-ha/bin/pytest
```
