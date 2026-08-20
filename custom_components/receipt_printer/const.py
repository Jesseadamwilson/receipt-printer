"""Constants for the Receipt Printer integration."""

from homeassistant.const import Platform

DOMAIN = "receipt_printer"
PLATFORMS = (Platform.BUTTON, Platform.SENSOR)

CONF_API_URL = "api_url"
CONF_VERIFY_SSL = "verify_ssl"

CONF_DAILY_AGENDA_ENABLED = "daily_agenda_enabled"
CONF_DAILY_AGENDA_PROFILE = "daily_agenda_profile"
CONF_AGENDA_WEATHER_ENTITY = "agenda_weather_entity"
CONF_AGENDA_SLEEP_ENTITY = "agenda_sleep_entity"
CONF_AGENDA_CALENDAR_ENTITIES = "agenda_calendar_entities"
CONF_AGENDA_BATTERY_ENTITIES = "agenda_battery_entities"
CONF_AGENDA_ALERT_ENTITIES = "agenda_alert_entities"
CONF_AGENDA_NOTES_ENTITY = "agenda_notes_entity"

CONF_MESSAGE_ENABLED = "message_enabled"
CONF_MESSAGE_PROFILE = "message_profile"

DEFAULT_API_URL = "http://homeassistant.local:8099"

JOB_DAILY_AGENDA = "daily_agenda"
JOB_MESSAGE = "message"
