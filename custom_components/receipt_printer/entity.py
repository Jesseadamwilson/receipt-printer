"""Shared entities for Receipt Printer."""

from __future__ import annotations

from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity import Entity

from .const import DOMAIN


class ReceiptPrinterEntity(Entity):
    """Base entity attached to one configured printer."""

    _attr_has_entity_name = True
    _attr_should_poll = False

    def __init__(self, entry: ConfigEntry, printer: dict[str, Any]) -> None:
        self._entry = entry
        self._printer = printer
        printer_id = str(printer["id"])
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, f"{entry.entry_id}:{printer_id}")},
            name=str(printer.get("name") or printer_id),
            manufacturer="Receipt Printer",
            model=str(printer.get("model") or printer.get("language") or "Network printer"),
            configuration_url=entry.data.get("api_url"),
        )

    @property
    def printer_id(self) -> str:
        """Return the add-on printer ID."""
        return str(self._printer["id"])
