"""Serve the Lovelace card bundle and load it in every dashboard."""

from __future__ import annotations

import logging
from pathlib import Path

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
    frontend.add_extra_js_url(hass, f"{URL}?v={integration.version}")
    hass.data[_DATA_KEY] = True
