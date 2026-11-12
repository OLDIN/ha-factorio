#!/usr/bin/env bash
# Runs a real Home Assistant (a process with its UI) with this integration installed from
# the working tree, to see the cards in the real frontend before a release.
#
#   scripts/dev_ha_ui.sh up                  build the cards, start HA, onboard it, add the
#                                            config entry, the theme and the example dashboard
#   scripts/dev_ha_ui.sh scenario <name>     paused | running | calm (see dev_states.py)
#   scripts/dev_ha_ui.sh rebuild             rebuild the cards and restart HA (reload the page after)
#   scripts/dev_ha_ui.sh down                stop HA
#
# There is no MQTT broker: the config entry keeps retrying, and the entity states come from
# dev_states.py through the REST API. The cards only read states, so the view is the real
# one; the MQTT side is covered by pytest. UI: http://127.0.0.1:8125 (dev / factorio-dev).
set -euo pipefail
cd "$(dirname "$0")/.."
VENV="$PWD/.venv-ha/bin"
CFG="$PWD/ha_config"
PORT=8125
BASE="http://127.0.0.1:$PORT"
DEV_USER=dev
DEV_PASS=factorio-dev # a throwaway local instance

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
  _start_ha
  [ -n "$(_token)" ] || { echo "onboarding failed"; tail -15 "$CFG/ha.log"; exit 1; }
  _stop_ha
  "$VENV/python" scripts/dev_inject.py "$CFG"
  _start_ha
  cmd_scenario paused
  echo "Ready: $BASE ($DEV_USER / $DEV_PASS)"
}

cmd_scenario() { "$VENV/python" scripts/dev_states.py "$BASE" "$(_token)" "${1:?scenario: paused | running | calm}"; }

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
  down) _stop_ha; echo "stopped" ;;
  *) echo "usage: $0 {up|scenario <paused|running|calm>|rebuild [scenario]|down}"; exit 1 ;;
esac
