# Release 0.4.0

Released: 2026-11-12

## ✨ Features

- feat(cards): lines and drills lane in the timeline
- feat(cards): map rings show working machines, line callouts
- feat(cards): planets card shows machines, problem lines and depleted drills
- feat: per-planet machines, problem lines and depleted drills sensors
- feat: line problem rule in game time, line and drill events

## 🐛 Bug Fixes

- fix(cards): unknown stop reasons and resources read well, stopped never exceeds total
- fix: drills_depleted after loading an older save is not muted by an event from the future
- fix(cards): a callout that had to cover a label or lead across one gets a second chance in either band
- fix(cards): callout leads start past the sublabel under a body name
- fix(cards): the planets machines ring keeps its size (class name clashed with the 9 px ring marker)
- fix: only the live clock may reset the line tracker, not re-delivered retained data

## 📝 Documentation

- docs: stage 2b in the status and roadmap

## 🔧 Other Changes

- dev: lines and drills in dev scenarios
- dev: a local MQTT broker in the dev Home Assistant

## 🔄 Update Instructions

Requires factorio-ha-bridge 0.3.0 (relay and mod): machines and drills come from the mod, and the line rule runs on the relay's game clock (`factorio/<id>/tick`).

1. Update via HACS or manually pull the latest version
2. Restart Home Assistant
3. Clear browser cache if needed
