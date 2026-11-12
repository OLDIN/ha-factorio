# Release 0.5.0

Released: 2026-11-12

## ✨ Features

- feat(cards): platforms lane in the timeline; platforms card in the example dashboard
- feat(cards): platforms on the system map: routes, diamonds, damage callout
- feat(cards): platforms card: where each platform is or flies, damage and problem lines
- feat: platforms sensor, travel and damage events, problem lines on platforms
- feat(cards): map shows problems on hover and click; only attacks keep a callout
- feat(cards): planets show the five worst problems and expand on demand; ring of machines without problems; old depleted drills stay in the sensor
- feat: output full counts as a standing machine only when the option says so; machines without problems

## 🐛 Bug Fixes

- fix: platform data that Python cannot convert (odd digits, huge or NaN progress) is skipped, not raised

## 🔧 Other Changes

- chore(dev): space platforms in the dev scenario
- chore(dev): planet status counters, six Fulgora lines without input and a Nauvis mall in the dev scenario

## 🔄 Update Instructions

1. Update via HACS or manually pull the latest version
2. Restart Home Assistant
3. Clear browser cache if needed
4. Space platforms need factorio-ha-bridge 0.4.0 (mod and relay); with bridge 0.3 everything else keeps working and the platforms sensor stays unknown
