"""Config and options flows for Receipt Printer."""

from __future__ import annotations

import asyncio
from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigFlow, ConfigFlowResult, OptionsFlow
from homeassistant.core import callback
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.selector import (
    BooleanSelector,
    EntitySelector,
    EntitySelectorConfig,
    SelectSelector,
    SelectSelectorConfig,
    SelectSelectorMode,
    TextSelector,
    TextSelectorConfig,
    TextSelectorType,
)

from .api import ReceiptPrinterApi, ReceiptPrinterApiError
from .const import (
    CONF_AGENDA_ALERT_ENTITIES,
    CONF_AGENDA_BATTERY_ENTITIES,
    CONF_AGENDA_CALENDAR_ENTITIES,
    CONF_AGENDA_NOTES_ENTITY,
    CONF_AGENDA_SLEEP_ENTITY,
    CONF_AGENDA_WEATHER_ENTITY,
    CONF_API_URL,
    CONF_DAILY_AGENDA_ENABLED,
    CONF_DAILY_AGENDA_PROFILE,
    CONF_DAILY_AGENDA_SCRIPT,
    CONF_MESSAGE_ENABLED,
    CONF_MESSAGE_ENTITY,
    CONF_MESSAGE_PROFILE,
    CONF_MESSAGE_SCRIPT,
    CONF_VERIFY_SSL,
    DEFAULT_API_URL,
    DOMAIN,
    JOB_DAILY_AGENDA,
    JOB_MESSAGE,
)


def _profile_options(jobs: list[dict[str, Any]], job_type: str) -> list[dict[str, str]]:
    return [
        {"value": str(job["id"]), "label": str(job.get("name") or job["id"])}
        for job in jobs
        if job.get("type") == job_type and job.get("id")
    ]


def _suggested_optional(key: str, value: Any) -> vol.Optional:
    description = {"suggested_value": value} if value not in (None, "", []) else None
    return vol.Optional(key, description=description)


class ReceiptPrinterConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle a Receipt Printer config flow."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Connect to a Receipt Printer add-on API."""
        errors: dict[str, str] = {}
        if user_input is not None:
            api = ReceiptPrinterApi(
                async_get_clientsession(self.hass),
                user_input[CONF_API_URL],
                user_input[CONF_VERIFY_SSL],
            )
            try:
                await asyncio.gather(api.async_health(), api.async_printers())
            except ReceiptPrinterApiError:
                errors["base"] = "cannot_connect"
            else:
                await self.async_set_unique_id(api.base_url.lower())
                self._abort_if_unique_id_configured()
                return self.async_create_entry(
                    title="Receipt Printer",
                    data={
                        CONF_API_URL: api.base_url,
                        CONF_VERIFY_SSL: user_input[CONF_VERIFY_SSL],
                    },
                )

        submitted = user_input or {}
        schema = vol.Schema(
            {
                vol.Required(
                    CONF_API_URL,
                    default=submitted.get(CONF_API_URL, DEFAULT_API_URL),
                ): TextSelector(
                    TextSelectorConfig(type=TextSelectorType.URL)
                ),
                vol.Required(
                    CONF_VERIFY_SSL,
                    default=submitted.get(CONF_VERIFY_SSL, True),
                ): BooleanSelector(),
            }
        )
        return self.async_show_form(step_id="user", data_schema=schema, errors=errors)

    @staticmethod
    @callback
    def async_get_options_flow(config_entry) -> ReceiptPrinterOptionsFlow:
        """Return the options flow."""
        return ReceiptPrinterOptionsFlow(config_entry)


class ReceiptPrinterOptionsFlow(OptionsFlow):
    """Configure the built-in Daily Agenda and Send Message jobs."""

    def __init__(self, config_entry) -> None:
        self._config_entry = config_entry
        self._jobs: list[dict[str, Any]] = []

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Show structured job fields with native selectors."""
        errors: dict[str, str] = {}
        if user_input is not None:
            normalized = dict(user_input)
            for key in (
                CONF_DAILY_AGENDA_SCRIPT,
                CONF_AGENDA_WEATHER_ENTITY,
                CONF_AGENDA_SLEEP_ENTITY,
                CONF_AGENDA_NOTES_ENTITY,
                CONF_MESSAGE_ENTITY,
                CONF_MESSAGE_SCRIPT,
            ):
                normalized.setdefault(key, "")
            for key in (
                CONF_AGENDA_CALENDAR_ENTITIES,
                CONF_AGENDA_BATTERY_ENTITIES,
                CONF_AGENDA_ALERT_ENTITIES,
            ):
                normalized.setdefault(key, [])
            return self.async_create_entry(title="", data=normalized)

        api = ReceiptPrinterApi(
            async_get_clientsession(self.hass),
            self._config_entry.data[CONF_API_URL],
            self._config_entry.data.get(CONF_VERIFY_SSL, True),
        )
        try:
            self._jobs = await api.async_jobs()
        except ReceiptPrinterApiError:
            errors["base"] = "cannot_connect"

        current = self._config_entry.options
        agenda_profiles = _profile_options(self._jobs, JOB_DAILY_AGENDA)
        message_profiles = _profile_options(self._jobs, JOB_MESSAGE)
        current_agenda_profile = current.get(CONF_DAILY_AGENDA_PROFILE)
        current_message_profile = current.get(CONF_MESSAGE_PROFILE)
        if not agenda_profiles and current_agenda_profile:
            agenda_profiles = [
                {
                    "value": str(current_agenda_profile),
                    "label": str(current_agenda_profile),
                }
            ]
        if not message_profiles and current_message_profile:
            message_profiles = [
                {
                    "value": str(current_message_profile),
                    "label": str(current_message_profile),
                }
            ]
        schema: dict[Any, Any] = {
            vol.Required(
                CONF_DAILY_AGENDA_ENABLED,
                default=current.get(CONF_DAILY_AGENDA_ENABLED, True),
            ): BooleanSelector(),
        }

        if agenda_profiles:
            agenda_default = current.get(
                CONF_DAILY_AGENDA_PROFILE, agenda_profiles[0]["value"]
            )
            schema[vol.Required(CONF_DAILY_AGENDA_PROFILE, default=agenda_default)] = (
                SelectSelector(
                    SelectSelectorConfig(
                        options=agenda_profiles,
                        mode=SelectSelectorMode.DROPDOWN,
                    )
                )
            )

        schema.update(
            {
                _suggested_optional(
                    CONF_DAILY_AGENDA_SCRIPT,
                    current.get(CONF_DAILY_AGENDA_SCRIPT),
                ): EntitySelector(EntitySelectorConfig(domain="script")),
                _suggested_optional(
                    CONF_AGENDA_WEATHER_ENTITY,
                    current.get(CONF_AGENDA_WEATHER_ENTITY),
                ): EntitySelector(EntitySelectorConfig(domain="weather")),
                _suggested_optional(
                    CONF_AGENDA_SLEEP_ENTITY,
                    current.get(CONF_AGENDA_SLEEP_ENTITY),
                ): EntitySelector(EntitySelectorConfig(domain="sensor")),
                _suggested_optional(
                    CONF_AGENDA_CALENDAR_ENTITIES,
                    current.get(CONF_AGENDA_CALENDAR_ENTITIES, []),
                ): EntitySelector(
                    EntitySelectorConfig(domain="calendar", multiple=True)
                ),
                _suggested_optional(
                    CONF_AGENDA_BATTERY_ENTITIES,
                    current.get(CONF_AGENDA_BATTERY_ENTITIES, []),
                ): EntitySelector(
                    EntitySelectorConfig(
                        domain=["sensor", "binary_sensor"], multiple=True
                    )
                ),
                _suggested_optional(
                    CONF_AGENDA_ALERT_ENTITIES,
                    current.get(CONF_AGENDA_ALERT_ENTITIES, []),
                ): EntitySelector(
                    EntitySelectorConfig(
                        domain=["alert", "binary_sensor"], multiple=True
                    )
                ),
                _suggested_optional(
                    CONF_AGENDA_NOTES_ENTITY,
                    current.get(CONF_AGENDA_NOTES_ENTITY),
                ): EntitySelector(
                    EntitySelectorConfig(domain=["input_text", "text", "sensor"])
                ),
                vol.Required(
                    CONF_MESSAGE_ENABLED,
                    default=current.get(CONF_MESSAGE_ENABLED, True),
                ): BooleanSelector(),
            }
        )

        if message_profiles:
            message_default = current.get(
                CONF_MESSAGE_PROFILE, message_profiles[0]["value"]
            )
            schema[vol.Required(CONF_MESSAGE_PROFILE, default=message_default)] = (
                SelectSelector(
                    SelectSelectorConfig(
                        options=message_profiles,
                        mode=SelectSelectorMode.DROPDOWN,
                    )
                )
            )

        schema.update(
            {
                _suggested_optional(
                    CONF_MESSAGE_ENTITY,
                    current.get(CONF_MESSAGE_ENTITY),
                ): EntitySelector(
                    EntitySelectorConfig(domain=["input_text", "text", "sensor"])
                ),
                _suggested_optional(
                    CONF_MESSAGE_SCRIPT,
                    current.get(CONF_MESSAGE_SCRIPT),
                ): EntitySelector(EntitySelectorConfig(domain="script")),
            }
        )

        return self.async_show_form(
            step_id="init",
            data_schema=vol.Schema(schema),
            errors=errors,
        )
