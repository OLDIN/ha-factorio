# Factorio for Home Assistant

Live Factorio server state in Home Assistant: game state (running / paused /
stopped / no connection), players online and game events.

The game side — a Factorio mod and a small relay next to the server — lives in
[factorio-ha-bridge](https://github.com/OLDIN/factorio-ha-bridge); the protocol is
described in its [docs/protocol.md](https://github.com/OLDIN/factorio-ha-bridge/blob/main/docs/protocol.md).

```
Factorio mod ──UDP──▶ relay ──MQTT──▶ this integration
```

Status: stage 2a (planets, defense, evolution, research) with the dashboard cards.

## Install

1. Run the relay from factorio-ha-bridge next to your Factorio server and point it
   at your MQTT broker.
2. Home Assistant needs the MQTT integration (e.g. the Mosquitto add-on).
3. HACS / Marketplace → Custom repositories → `https://github.com/OLDIN/ha-factorio`
   (type Integration) → Download → restart Home Assistant.
4. The server shows up under Settings → Devices & services → Discovered
   (via `factorio/+/hello`), or add "Factorio" manually with the relay's `FHA_SERVER_ID`.

## Dashboard

The cards come with the integration: Home Assistant loads `factorio-cards.js`
by itself, so there is nothing to add under Dashboard resources. Every card takes
`server_id` and has a visual editor.

| Card | What it shows | Options |
|---|---|---|
| `custom:factorio-header-card` | title, game state, attacked planets, players online, research progress | `title` (default "Factorio") |
| `custom:factorio-map-card` | all space bodies on a system map, attacks and defense callouts | `height` 360-1200, `label_healthy` |
| `custom:factorio-planets-card` | planets that need attention first (attack, turrets, walls, evolution), then the healthy, unlocked and not yet unlocked ones | |
| `custom:factorio-players-card` | who is online or AFK, who left last, deaths of the last hour | |
| `custom:factorio-timeline-card` | events of the last hour on a log scale, with filters | `window_minutes` 5-60 |

In a Ukrainian interface the vanilla planets get Ukrainian names; mod planets keep
their names from the game.

**Theme.** Copy [examples/themes/factorio.yaml](examples/themes/factorio.yaml) to
`/config/themes/factorio.yaml` and make sure `configuration.yaml` has

```yaml
frontend:
  themes: !include_dir_merge_named themes
```

Reload themes (Developer tools → YAML → "Frontend: reload themes", or restart),
then pick "factorio" in your profile or set `theme: factorio` on a view.

**Example dashboard.** [examples/dashboard.yaml](examples/dashboard.yaml) is a
sections view laid out like the mockup: the header and the map, the planets with
the players on their right, and the last hour. It needs nothing but this
integration. Create a new dashboard, open it, then ⋮ → Edit → ⋮ → Raw
configuration editor, and paste the file. Replace `main` with your server id.

## Entities

| Entity | Meaning |
|---|---|
| `binary_sensor.factorio_<id>_connection` | the relay is online |
| `binary_sensor.factorio_<id>_game_running` | the game is ticking |
| `sensor.factorio_<id>_game_state` | `running` / `paused` / `stopped` / `no_connection` (attributes `reason`, `since`) |
| `sensor.factorio_<id>_players_online` | count; attributes `players`, `afk_minutes` |
| `sensor.factorio_<id>_bodies` | number of built bodies; attribute `bodies` (all space locations, read by the map card) |
| `sensor.factorio_<id>_research` | current research; attributes `progress` (%), `level`, `queue` (the current research is its first entry), `unlocks` |
| `sensor.factorio_<id>_recent_events` | time of the newest event; attribute `events` (last 60 minutes, at most 50; read by the timeline card) |
| `event.factorio_<id>_game_events` | all event types below; also fired on the bus as `factorio_<event>` |

Per planet (a device per planet; entity ids `<platform>.factorio_<id>_<planet>_<key>`),
appearing when the planet is built or reported by the defense / evolution data:

| Entity | Meaning |
|---|---|
| `binary_sensor.factorio_<id>_<planet>_under_attack` | on while an attack runs; attributes `since_tick`, `position`, `gps`, `losses` |
| `sensor.factorio_<id>_<planet>_turrets_no_ammo` | turrets without ammo; attributes `total`, `no_power`, `positions` |
| `sensor.factorio_<id>_<planet>_walls_damaged` | damaged walls and gates; attribute `positions` |
| `sensor.factorio_<id>_<planet>_evolution` | enemy evolution, % |

Event types: `player_joined`, `player_left`, `player_died`, `attack_started`,
`attack_ended`, `turrets_no_ammo`, `turrets_ok`, `research_finished`.

The planets, defense, evolution, research and AFK/death data need
factorio-ha-bridge relay and mod 0.2 or newer; with 0.1.x only the 0.1 entities exist.

Values never turn `unavailable`: when the connection is lost they keep the last
known value and `game_state` becomes `no_connection`. Removing the integration
clears its config, so the game stops collecting data.

## Roadmap

The goal: see what happens in a Factorio server that keeps running while you are
away — attacks, lines that ran out of resources, depleted ore patches — and react
with notifications or voice announcements. Data is grouped (per planet, per recipe)
so a big base gives dozens of entities, not thousands. Everything below is chosen in
the integration options, and the game collects only what is enabled.

### Done

v0.1 (proof of concept):

- [x] Relay ↔ Home Assistant over MQTT, with discovery (`factorio/+/hello`)
- [x] Game state: running / paused / stopped / no connection
- [x] Players online (count + names)
- [x] Config from Home Assistant: the game collects nothing until HA asks for it
- [x] Values never turn `unavailable`; survive relay, game and HA restarts

Stage 2a (v0.2, needs bridge 0.2):

- [x] Planets and other bodies, with a device per built planet
- [x] Defense per planet: attacks (merged by time and area, with position and losses), turrets without ammo or power, damaged walls
- [x] Enemy evolution per planet
- [x] Research: current, progress, queue
- [x] Players: AFK minutes, deaths
- [x] Events: `player_joined`, `player_left`, `player_died`, `attack_started`, `attack_ended`, `turrets_no_ammo`, `turrets_ok`, `research_finished`
- [x] Map card and timeline card (fonts are bundled, no third-party requests)

v0.3 (the dashboard as in the mockup):

- [x] Header, planets and players cards; the example dashboard needs no other cards
- [x] Attacks during a pause say so instead of counting minutes
- [x] Ukrainian names of the vanilla planets in a Ukrainian interface

### Next

- [ ] 2b: problem lines per planet (no ingredients / output full / no power), mining drills and depleted patches; events `line_problem` / `line_recovered`, `drills_depleted`
- [ ] 2c: space platforms (where they are, in transit, waiting, losses); events `platform_damaged`, arrived / departed
- [ ] Dedicated sensors for lines you pick in the options (e.g. iron plates on Nauvis)

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
