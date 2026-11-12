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


async def test_fonts_served(http_hass, hass_client, tmp_path, monkeypatch):
    bundle = tmp_path / "factorio-cards.js"
    bundle.write_text("//")
    fonts = tmp_path / "fonts"
    fonts.mkdir()
    (fonts / "unbounded-latin-500-normal.woff2").write_bytes(b"wOF2")
    monkeypatch.setattr(frontend, "BUNDLE", bundle)
    monkeypatch.setattr(frontend, "FONTS_DIR", fonts)

    await frontend.async_register_frontend(http_hass)

    client = await hass_client()
    resp = await client.get(f"{frontend.FONTS_URL}/unbounded-latin-500-normal.woff2")
    assert resp.status == 200
    assert await resp.read() == b"wOF2"


def test_shipped_fonts_cover_every_face():
    fonts = Path(__file__).parent.parent / "frontend" / "public" / "fonts"  # copied to www/ by the build
    names = {p.name for p in fonts.glob("*.woff2")}
    for family, weights in (("unbounded", (500, 600, 700)), ("golos-text", (400, 500, 600))):
        for weight in weights:
            for subset in ("latin", "cyrillic"):
                assert f"{family}-{subset}-{weight}-normal.woff2" in names
    assert (fonts / "OFL-Unbounded.txt").is_file()


# Storage-mode dashboards: the bundle is one Lovelace resource. Resources load after the
# frontend has started, so the cards are defined in the registry the frontend uses; an extra
# module URL loads in parallel with the frontend and sometimes defines them too early.


async def _lovelace_resources(hass):
    resources = hass.data["lovelace"].resources
    await resources.async_get_info()  # loads the collection
    return [r for r in resources.async_items() if str(r.get("url", "")).startswith(frontend.URL)]


@pytest.fixture
async def lovelace_hass(http_hass, tmp_path, monkeypatch):
    assert await async_setup_component(http_hass, "lovelace", {})
    bundle = tmp_path / "factorio-cards.js"
    bundle.write_text("//")
    monkeypatch.setattr(frontend, "BUNDLE", bundle)
    return http_hass


async def test_bundle_is_a_lovelace_resource_in_storage_mode(lovelace_hass):
    hass = lovelace_hass
    await frontend.async_register_frontend(hass)
    items = await _lovelace_resources(hass)
    assert len(items) == 1
    assert items[0]["type"] == "module"
    assert items[0]["url"].startswith(f"{frontend.URL}?v=")
    assert _version_urls(hass) == []  # not loaded a second time as an extra module


async def test_resource_of_an_older_version_is_replaced(lovelace_hass):
    hass = lovelace_hass
    resources = hass.data["lovelace"].resources
    await resources.async_create_item({"res_type": "module", "url": f"{frontend.URL}?v=0.0.1"})
    await resources.async_create_item({"res_type": "module", "url": "/hacsfiles/other/card.js"})
    await frontend.async_register_frontend(hass)
    ours = await _lovelace_resources(hass)
    assert len(ours) == 1
    assert not ours[0]["url"].endswith("v=0.0.1")
    assert any(r["url"] == "/hacsfiles/other/card.js" for r in resources.async_items())


async def test_resource_registration_survives_restarts(lovelace_hass):
    hass = lovelace_hass
    await frontend.async_register_frontend(hass)
    hass.data.pop(frontend._DATA_KEY)  # a new Home Assistant run
    await frontend.async_register_frontend(hass)
    assert len(await _lovelace_resources(hass)) == 1


async def test_yaml_mode_falls_back_to_an_extra_module(http_hass, tmp_path, monkeypatch):
    assert await async_setup_component(http_hass, "lovelace", {"lovelace": {"resource_mode": "yaml"}})
    bundle = tmp_path / "factorio-cards.js"
    bundle.write_text("//")
    monkeypatch.setattr(frontend, "BUNDLE", bundle)
    await frontend.async_register_frontend(http_hass)
    assert len(_version_urls(http_hass)) == 1


async def test_removing_the_resource(lovelace_hass):
    hass = lovelace_hass
    await frontend.async_register_frontend(hass)
    await frontend.async_remove_resource(hass)
    assert await _lovelace_resources(hass) == []
