"""Onboard a fresh Home Assistant (or log in to an onboarded one) and print an access token.

usage: ha_auth.py <base_url> <username> <password>
The access token is the last line of stdout.
"""

from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request


def _post(url: str, data: dict, headers: dict | None = None, form: bool = False) -> tuple[int, dict]:
    if form:
        body = "&".join(f"{k}={v}" for k, v in data.items()).encode()
        h = {"Content-Type": "application/x-www-form-urlencoded"}
    else:
        body = json.dumps(data).encode()
        h = {"Content-Type": "application/json"}
    if headers:
        h.update(headers)
    req = urllib.request.Request(url, data=body, headers=h, method="POST")
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode() or "{}")
        except Exception:
            return e.code, {}


def _get_json(url: str):
    try:
        with urllib.request.urlopen(url) as r:
            return json.loads(r.read().decode())
    except Exception:
        return None


def main() -> None:
    base, user, pw = sys.argv[1], sys.argv[2], sys.argv[3]
    client = base if base.endswith("/") else base + "/"

    for _ in range(30):  # wait for the onboarding API
        if isinstance(_get_json(f"{base}/api/onboarding"), list):
            break
        time.sleep(2)

    steps = _get_json(f"{base}/api/onboarding")
    user_done = isinstance(steps, list) and next((s["done"] for s in steps if s["step"] == "user"), True)

    if isinstance(steps, list) and not user_done:
        _, resp = _post(
            f"{base}/api/onboarding/users",
            {"client_id": client, "name": "Dev", "username": user, "password": pw, "language": "uk"},
        )
        _, tok = _post(
            f"{base}/auth/token",
            {"client_id": client, "grant_type": "authorization_code", "code": resp.get("auth_code")},
            form=True,
        )
        access = tok.get("access_token")
        auth = {"Authorization": f"Bearer {access}"}
        for step in ("core_config", "analytics"):
            _post(f"{base}/api/onboarding/{step}", {}, headers=auth)
        _post(f"{base}/api/onboarding/integration", {"client_id": client, "redirect_uri": client}, headers=auth)
        print(access)
        return

    # Already onboarded: log in through the login flow.
    _, flow = _post(
        f"{base}/auth/login_flow",
        {"client_id": client, "handler": ["homeassistant", None], "redirect_uri": client},
    )
    _, step = _post(f"{base}/auth/login_flow/{flow.get('flow_id')}", {"client_id": client, "username": user, "password": pw})
    _, tok = _post(
        f"{base}/auth/token",
        {"client_id": client, "grant_type": "authorization_code", "code": step.get("result")},
        form=True,
    )
    print(tok.get("access_token", ""))


if __name__ == "__main__":
    main()
