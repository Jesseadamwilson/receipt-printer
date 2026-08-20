"""Job action buttons for Receipt Printer."""

from __future__ import annotations

from typing import Any

from homeassistant.components.button import ButtonEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .api import ReceiptPrinterApi, ReceiptPrinterApiError
from .const import (
    CONF_AGENDA_ALERT_ENTITIES,
    CONF_AGENDA_BATTERY_ENTITIES,
    CONF_AGENDA_CALENDAR_ENTITIES,
    CONF_AGENDA_NOTES_ENTITY,
    CONF_AGENDA_SLEEP_ENTITY,
    CONF_AGENDA_WEATHER_ENTITY,
    CONF_DAILY_AGENDA_ENABLED,
    CONF_DAILY_AGENDA_PROFILE,
    CONF_MESSAGE_ENABLED,
    CONF_MESSAGE_PROFILE,
    DOMAIN,
    JOB_DAILY_AGENDA,
    JOB_MESSAGE,
)
from .entity import ReceiptPrinterEntity
from .models import ReceiptPrinterRuntimeData


def _first_job_id(jobs: list[dict[str, Any]], job_type: str) -> str:
    for job in jobs:
        if job.get("type") == job_type and job.get("id"):
            return str(job["id"])
    return ""


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up job buttons for every configured printer."""
    runtime: ReceiptPrinterRuntimeData = hass.data[DOMAIN][entry.entry_id]
    options = entry.options
    job_types: list[str] = []
    if options.get(CONF_DAILY_AGENDA_ENABLED, True):
        job_types.append(JOB_DAILY_AGENDA)
    if options.get(CONF_MESSAGE_ENABLED, True):
        job_types.append(JOB_MESSAGE)

    async_add_entities(
        ReceiptPrinterJobButton(
            entry,
            runtime.api,
            runtime.jobs,
            printer,
            job_type,
        )
        for printer in runtime.printers
        for job_type in job_types
    )


class ReceiptPrinterJobButton(ReceiptPrinterEntity, ButtonEntity):
    """Run one built-in print job on a specific printer."""

    _attr_icon = "mdi:printer"

    def __init__(
        self,
        entry: ConfigEntry,
        api: ReceiptPrinterApi,
        jobs: list[dict[str, Any]],
        printer: dict[str, Any],
        job_type: str,
    ) -> None:
        super().__init__(entry, printer)
        self._api = api
        self._job_type = job_type
        self._jobs = jobs
        self._last_job_id: str | None = None
        self._attr_unique_id = f"{entry.entry_id}_{self.printer_id}_{job_type}"
        self._attr_name = (
            "Print Daily Agenda" if job_type == JOB_DAILY_AGENDA else "Send Message"
        )

    @property
    def profile_id(self) -> str:
        """Return the configured profile, falling back to the first matching job."""
        option_key = (
            CONF_DAILY_AGENDA_PROFILE
            if self._job_type == JOB_DAILY_AGENDA
            else CONF_MESSAGE_PROFILE
        )
        return str(
            self._entry.options.get(option_key)
            or _first_job_id(self._jobs, self._job_type)
        )

    def _daily_agenda_data(self) -> dict[str, Any]:
        options = self._entry.options
        source_keys = {
            CONF_AGENDA_WEATHER_ENTITY: "agendaWeatherEntity",
            CONF_AGENDA_SLEEP_ENTITY: "agendaSleepEntity",
            CONF_AGENDA_CALENDAR_ENTITIES: "agendaCalendarEntities",
            CONF_AGENDA_BATTERY_ENTITIES: "agendaBatteryEntities",
            CONF_AGENDA_ALERT_ENTITIES: "agendaAlertEntities",
            CONF_AGENDA_NOTES_ENTITY: "agendaNotesEntity",
        }
        source_config = {
            api_key: options[option_key]
            for option_key, api_key in source_keys.items()
            if options.get(option_key) not in (None, "", [])
        }
        data: dict[str, Any] = {
            "source": "auto",
            "print": {"feedLines": 3, "cut": True},
        }
        if source_config:
            data["sourceConfig"] = source_config
        return data

    def _message_data(self) -> dict[str, Any]:
        return {"print": {"feedLines": 3, "cut": True}}

    async def async_press(self) -> None:
        """Submit exactly one print job."""
        data = (
            self._daily_agenda_data()
            if self._job_type == JOB_DAILY_AGENDA
            else self._message_data()
        )
        try:
            response = await self._api.async_run_job(
                self._job_type,
                self.printer_id,
                self.profile_id,
                data,
            )
        except ReceiptPrinterApiError as err:
            raise HomeAssistantError(str(err)) from err

        job = response.get("job")
        if isinstance(job, dict) and job.get("id"):
            self._last_job_id = str(job["id"])

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Expose the job mapping for diagnostics and automations."""
        return {
            "job_type": self._job_type,
            "profile_id": self.profile_id,
            "printer_id": self.printer_id,
            "last_job_id": self._last_job_id,
        }
