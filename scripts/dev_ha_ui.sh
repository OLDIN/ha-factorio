#!/usr/bin/env bash
# Runs a real Home Assistant (a process with its UI) with this integration installed from
# the working tree, and a local MQTT broker standing in for the relay's, to see the whole
# chain (MQTT -> integration -> entities -> cards) before a release.
#
#   scripts/dev_ha_ui.sh up                  build the cards, start the broker and HA, onboard
#                                            HA, add the MQTT and Factorio entries, the theme
#                                            and the example dashboard, publish a scenario
#   scripts/dev_ha_ui.sh scenario <name>     paused | running | calm (see dev_relay.py)
#   scripts/dev_ha_ui.sh rebuild             rebuild the cards and restart HA (reload the page after)
#   scripts/dev_ha_ui.sh down                stop HA and the broker
#
# The broker is amqtt run through uvx (pinned below). UI: http://127.0.0.1:8125 (dev / factorio-dev).
set -euo pipefail
cd "$(dirname "$0")/.."
VENV="$PWD/.venv-ha/bin"
CFG="$PWD/ha_config"
PORT=8125
BASE="http://127.0.0.1:$PORT"
DEV_USER=dev
DEV_PASS=factorio-dev # a throwaway local instance
MQTT_PORT=18830
AMQTT="amqtt==0.12.1"
UVX=/opt/homebrew/bin/uvx
[ -x "$UVX" ] || UVX=$(command -v uvx || true)

_wait_ha() { for _ in $(seq 1 60); do curl -sf -o /dev/null "$BASE/" 2>/dev/null && return 0; sleep 3; done; return 1; }
_stop_ha() {
  pkill -TERM -f "hass --config $CFG" 2>/dev/null || true
  for _ in $(seq 1 20); do pgrep -f "hass --config $CFG" >/dev/null || return 0; sleep 1; done
  pkill -9 -f "hass --config $CFG" 2>/dev/null || true
}
_start_ha() {
  nohup "$VENV/hass" --config "$CFG" >"$CFG/ha.log" 2>&1 &
  echo "hass PID $! (waiting for $BASE ...)"
  _wait_ha || { echo "Home Assistant did not start"; tail -20 "$CFG/ha.log"; exit 1; }
}
_token() { "$VENV/python" scripts/ha_auth.py "$BASE" "$DEV_USER" "$DEV_PASS" | tail -1; }
_stop_broker() { pkill -TERM -f "amqtt -c $CFG/mqtt-broker.yaml" 2>/dev/null || true; }
_start_broker() {
  [ -n "$UVX" ] || { echo "uvx is needed for the MQTT broker (https://docs.astral.sh/uv/)"; exit 1; }
  cat >"$CFG/mqtt-broker.yaml" <<YAML
listeners:
  default:
    type: tcp
    bind: 127.0.0.1:$MQTT_PORT
plugins:
  amqtt.plugins.authentication.AnonymousAuthPlugin:
    allow_anonymous: true
YAML
  nohup "$UVX" --from "$AMQTT" amqtt -c "$CFG/mqtt-broker.yaml" >"$CFG/mqtt-broker.log" 2>&1 &
  for _ in $(seq 1 60); do nc -z 127.0.0.1 "$MQTT_PORT" 2>/dev/null && { echo "broker on 127.0.0.1:$MQTT_PORT"; return 0; }; sleep 1; done
  echo "the MQTT broker did not start"; tail -10 "$CFG/mqtt-broker.log"; exit 1
}
_build() { (cd frontend && npm run build >/dev/null) && echo "cards built"; }

_check_frontend() {
  "$VENV/python" -c "import hass_frontend" 2>/dev/null && return 0
  local version
  version=$("$VENV/python" -c "import json, homeassistant.components.frontend as f, pathlib; print(json.loads((pathlib.Path(f.__file__).parent / 'manifest.json').read_text())['requirements'][0])")
  echo "The Home Assistant frontend is not installed in .venv-ha (the tests do not need it). Install it:"
  echo "  uv pip install --python .venv-ha/bin/python '$version'"
  exit 1
}

cmd_up() {
  _check_frontend
  _stop_ha
  _stop_broker
  _build
  rm -rf "$CFG"
  mkdir -p "$CFG/custom_components" "$CFG/themes"
  ln -sfn "$PWD/custom_components/factorio" "$CFG/custom_components/factorio"
  cp examples/themes/factorio.yaml "$CFG/themes/"
  # Home Assistant 2026.10 keeps the HTTP settings in .storage/http; settings from YAML become
  # a trial that has to be confirmed in the UI within minutes. Write them as confirmed.
  mkdir -p "$CFG/.storage"
  cat >"$CFG/.storage/http" <<JSON
{"version": 2, "minor_version": 2, "key": "http", "data": {"stable": {"server_port": $PORT,
 "server_host": ["127.0.0.1"], "cors_allowed_origins": ["https://cast.home-assistant.io"],
 "login_attempts_threshold": -1, "ip_ban_enabled": true, "ssl_profile": "modern",
 "use_x_frame_options": true, "created_at": "2026-01-01T00:00:00+00:00", "error": null,
 "error_message": null}, "pending": null, "yaml_migration_done": true}}
JSON
  cat >"$CFG/configuration.yaml" <<YAML
# No default_config: fewer integrations, faster start.
homeassistant:
  name: Factorio dev
  unit_system: metric
  time_zone: Europe/Kyiv
frontend:
  themes: !include_dir_merge_named themes
api:
config:
logger:
  default: warning
  logs:
    custom_components.factorio: debug
YAML
  _start_broker
  _start_ha
  [ -n "$(_token)" ] || { echo "onboarding failed"; tail -15 "$CFG/ha.log"; exit 1; }
  _stop_ha
  "$VENV/python" scripts/dev_inject.py "$CFG" "$MQTT_PORT"
  _start_ha
  cmd_scenario paused
  echo "Ready: $BASE ($DEV_USER / $DEV_PASS)"
}

cmd_scenario() { "$VENV/python" scripts/dev_relay.py 127.0.0.1 "$MQTT_PORT" "${1:?scenario: paused | running | calm}"; }

cmd_rebuild() {
  _build
  _stop_ha
  _start_ha
  cmd_scenario "${1:-paused}"
}

case "${1:-up}" in
  up) cmd_up ;;
  scenario) cmd_scenario "${2:-}" ;;
  rebuild) cmd_rebuild "${2:-paused}" ;;
  down) _stop_ha; _stop_broker; echo "stopped" ;;
  *) echo "usage: $0 {up|scenario <paused|running|calm>|rebuild [scenario]|down}"; exit 1 ;;
esac
