"""Add the MQTT and Factorio config entries and the example dashboard to a stopped dev Home Assistant.

usage: dev_inject.py <config_dir> <mqtt_port>
MQTT points at the dev broker on 127.0.0.1; the dashboard is examples/dashboard.yaml as the
default dashboard (server id `main`).
"""

from __future__ import annotations

import json
import sys
import uuid
from datetime import UTC, datetime
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
cfg = Path(sys.argv[1])
storage = cfg / ".storage"
now = datetime.now(UTC).isoformat()

path = storage / "core.config_entries"
# Onboarding without default_config creates no entries and no store; Home Assistant migrates
# a minor version 1 store to its current shape.
store = (
    json.loads(path.read_text())
    if path.is_file()
    else {"version": 1, "minor_version": 1, "key": "core.config_entries", "data": {"entries": []}}
)
entries = [e for e in store["data"]["entries"] if e.get("domain") not in ("factorio", "mqtt")]
entries.append(
    {
        "created_at": now,
        "data": {"broker": "127.0.0.1", "port": int(sys.argv[2])},
        "disabled_by": None,
        "discovery_keys": {},
        "domain": "mqtt",
        "entry_id": uuid.uuid4().hex,
        "minor_version": 1,
        "modified_at": now,
        "options": {},
        "pref_disable_new_entities": False,
        "pref_disable_polling": False,
        "source": "user",
        "subentries": [],
        "title": "127.0.0.1",
        "unique_id": None,
        "version": 2,
    }
)
entries.append(
    {
        "created_at": now,
        "data": {"provider": "mqtt", "server_id": "main"},
        "disabled_by": None,
        "discovery_keys": {},
        "domain": "factorio",
        "entry_id": uuid.uuid4().hex,
        "minor_version": 1,
        "modified_at": now,
        "options": {c: True for c in ("players", "planets", "defense", "evolution", "research")},
        "pref_disable_new_entities": False,
        "pref_disable_polling": False,
        "source": "user",
        "subentries": [],
        "title": "Factorio main (dev)",
        "unique_id": "main",
        "version": 1,
    }
)
store["data"]["entries"] = entries
path.write_text(json.dumps(store, indent=2))

dashboard = yaml.safe_load((ROOT / "examples" / "dashboard.yaml").read_text())
(storage / "lovelace").write_text(
    json.dumps({"version": 1, "minor_version": 1, "key": "lovelace", "data": {"config": {"views": dashboard["views"]}}}, indent=2)
)
print("mqtt and factorio entries and the dashboard injected")
