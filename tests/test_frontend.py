"""The card bundle is served by the integration and registered with the frontend."""

from __future__ import annotations

import logging
from pathlib import Path

import pytest
from homeassistant.components.frontend import DATA_EXTRA_MODULE_URL
from homeassistant.setup import async_setup_component

from custom_components.factorio import frontend
from custom_components.factorio.const import DOMAIN


@pytest.fixture
async def http_hass(hass, enable_custom_integrations):
    assert await async_setup_component(hass, "http", {})
    return hass


def _version_urls(hass) -> list[str]:
    return [u for u in hass.data[DATA_EXTRA_MODULE_URL].urls if u.startswith(frontend.URL)]


async def test_static_path_and_js_url_registered(http_hass, hass_client, tmp_path, monkeypatch):
    hass = http_hass
    bundle = tmp_path / "factorio-cards.js"
    bundle.write_text("export const x = 1;")
    monkeypatch.setattr(frontend, "BUNDLE", bundle)

    await frontend.async_register_frontend(hass)
    await frontend.async_register_frontend(hass)  # idempotent

    urls = _version_urls(hass)
    assert len(urls) == 1
    assert urls[0].startswith(f"{frontend.URL}?v=")
    client = await hass_client()
    resp = await client.get(frontend.URL)
    assert resp.status == 200
    assert await resp.text() == "export const x = 1;"


async def test_missing_bundle_logs_warning(http_hass, tmp_path, monkeypatch, caplog):
    monkeypatch.setattr(frontend, "BUNDLE", Path(tmp_path / "nope.js"))
    with caplog.at_level(logging.WARNING):
        await frontend.async_register_frontend(http_hass)
    assert "nope.js" in caplog.text and "missing" in caplog.text
    assert _version_urls(http_hass) == []


async def test_component_setup_registers_frontend(http_hass, tmp_path, monkeypatch):
    bundle = tmp_path / "factorio-cards.js"
    bundle.write_text("//")
    monkeypatch.setattr(frontend, "BUNDLE", bundle)
    assert await async_setup_component(http_hass, DOMAIN, {})
    assert len(_version_urls(http_hass)) == 1
