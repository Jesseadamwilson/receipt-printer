"""Receipt Printer custom integration."""

from __future__ import annotations

import asyncio

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryNotReady
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .api import ReceiptPrinterApi, ReceiptPrinterApiError
from .const import CONF_API_URL, CONF_VERIFY_SSL, DOMAIN, PLATFORMS
from .models import ReceiptPrinterRuntimeData


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Receipt Printer from a config entry."""
    api = ReceiptPrinterApi(
        async_get_clientsession(hass),
        entry.data[CONF_API_URL],
        entry.data.get(CONF_VERIFY_SSL, True),
    )

    try:
        printers, jobs = await _async_fetch_metadata(api)
    except ReceiptPrinterApiError as err:
        raise ConfigEntryNotReady(str(err)) from err

    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = ReceiptPrinterRuntimeData(
        api=api,
        printers=printers,
        jobs=jobs,
    )
    entry.async_on_unload(entry.add_update_listener(_async_reload_entry))
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def _async_fetch_metadata(
    api: ReceiptPrinterApi,
) -> tuple[list[dict], list[dict]]:
    """Fetch printer and job metadata."""
    _, printers, jobs = await asyncio.gather(
        api.async_health(),
        api.async_printers(),
        api.async_jobs(),
    )
    if not printers:
        raise ReceiptPrinterApiError("The add-on has no configured printers")
    return printers, jobs


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a Receipt Printer config entry."""
    unloaded = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unloaded:
        hass.data[DOMAIN].pop(entry.entry_id, None)
    return unloaded


async def _async_reload_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Reload after options change."""
    await hass.config_entries.async_reload(entry.entry_id)
