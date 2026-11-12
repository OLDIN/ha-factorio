"""Serve the Lovelace card bundle and load it in every dashboard (as a Lovelace resource where possible)."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from homeassistant.components import frontend
from homeassistant.components.http import StaticPathConfig
from homeassistant.core import HomeAssistant
from homeassistant.loader import async_get_integration

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)

URL = "/factorio_static/factorio-cards.js"
BUNDLE = Path(__file__).parent / "www" / "factorio-cards.js"
FONTS_URL = "/factorio_static/fonts"
FONTS_DIR = Path(__file__).parent / "www" / "fonts"
_DATA_KEY = f"{DOMAIN}_frontend_registered"


async def async_register_frontend(hass: HomeAssistant) -> None:
    """Register the static path and the extra JS module once per Home Assistant run."""
    if hass.data.get(_DATA_KEY):
        return
    if not BUNDLE.is_file():
        _LOGGER.warning(
            "Card bundle %s is missing; the Factorio dashboard cards are unavailable "
            "(build it with `npm run build` in frontend/)",
            BUNDLE,
        )
        return
    integration = await async_get_integration(hass, DOMAIN)
    paths = [StaticPathConfig(URL, str(BUNDLE), cache_headers=False)]
    if FONTS_DIR.is_dir():
        paths.append(StaticPathConfig(FONTS_URL, str(FONTS_DIR), cache_headers=True))
    else:
        _LOGGER.warning("Card fonts %s are missing; the cards fall back to system fonts", FONTS_DIR)
    await hass.http.async_register_static_paths(paths)
    url = f"{URL}?v={integration.version}"
    if not await _async_register_resource(hass, url):
        frontend.add_extra_js_url(hass, url)
    hass.data[_DATA_KEY] = True


def _storage_resources(hass: HomeAssistant) -> Any | None:
    """The Lovelace resource collection when it can be edited (storage mode), else None."""
    resources = getattr(hass.data.get("lovelace"), "resources", None)
    return resources if hasattr(resources, "async_create_item") else None


async def _async_register_resource(hass: HomeAssistant, url: str) -> bool:
    """Load the bundle as one Lovelace resource (storage mode); False when that is not possible.

    Resources load after the frontend has started. An extra module URL loads in parallel
    with it and can define the cards before the frontend's custom element registry is in
    place, so a page load now and then shows "Configuration error" for every card.
    """
    resources = _storage_resources(hass)
    if resources is None:
        return False
    await resources.async_get_info()  # loads the collection
    ours = [r for r in resources.async_items() if str(r.get("url", "")).split("?")[0] == URL]
    if not any(r["url"] == url for r in ours):
        await resources.async_create_item({"res_type": "module", "url": url})
    for item in ours:  # older versions
        if item["url"] != url:
            await resources.async_delete_item(item["id"])
    return True


async def async_remove_resource(hass: HomeAssistant) -> None:
    """Drop the bundle's Lovelace resource (the integration is being removed)."""
    resources = _storage_resources(hass)
    if resources is None:
        return
    await resources.async_get_info()
    for item in [r for r in resources.async_items() if str(r.get("url", "")).split("?")[0] == URL]:
        await resources.async_delete_item(item["id"])
