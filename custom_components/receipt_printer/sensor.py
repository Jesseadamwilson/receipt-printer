"""Printer endpoint sensors."""

from __future__ import annotations

from typing import Any

from homeassistant.components.sensor import SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN
from .entity import ReceiptPrinterEntity
from .models import ReceiptPrinterRuntimeData


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up a diagnostic endpoint entity for every printer."""
    runtime: ReceiptPrinterRuntimeData = hass.data[DOMAIN][entry.entry_id]
    async_add_entities(
        ReceiptPrinterEndpointSensor(entry, printer) for printer in runtime.printers
    )


class ReceiptPrinterEndpointSensor(ReceiptPrinterEntity, SensorEntity):
    """Expose the configured host and port for a printer."""

    _attr_name = "Endpoint"
    _attr_icon = "mdi:printer-pos"
    _attr_entity_category = EntityCategory.DIAGNOSTIC

    def __init__(self, entry: ConfigEntry, printer: dict[str, Any]) -> None:
        super().__init__(entry, printer)
        self._attr_unique_id = f"{entry.entry_id}_{self.printer_id}_endpoint"
        self._attr_native_value = f"{printer.get('host')}:{printer.get('port')}"

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Return the complete non-secret printer configuration."""
        return {
            "printer_id": self.printer_id,
            "host": self._printer.get("host"),
            "port": self._printer.get("port"),
            "language": self._printer.get("language"),
            "model": self._printer.get("model"),
            "cut_mode": self._printer.get("cutMode"),
            "paper_width": self._printer.get("paperWidth"),
        }
