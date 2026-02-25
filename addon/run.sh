#!/usr/bin/with-contenv bashio
set -euo pipefail

export API_HOST="0.0.0.0"
export API_PORT="8099"
export PRINTER_HOST="$(bashio::config 'printer_host')"
export PRINTER_PORT="$(bashio::config 'printer_port')"
export PRINTER_LANGUAGE="$(bashio::config 'printer_language')"
export PRINTER_MODEL="$(bashio::config 'printer_model')"
export PRINTER_CUT_MODE="$(bashio::config 'printer_cut_mode')"
export PRINT_TIMEOUT_MS="$(bashio::config 'print_timeout_ms')"
export PAPER_WIDTH="$(bashio::config 'paper_width')"
export QUEUE_MAX_RETRIES="$(bashio::config 'queue_max_retries')"
export QUEUE_RETRY_DELAY_MS="$(bashio::config 'queue_retry_delay_ms')"
export TEMPLATE_PATH="$(bashio::config 'template_path')"
export PROFILE_STORE_PATH="$(bashio::config 'profile_store_path')"
export HA_API_BASE_URL="$(bashio::config 'ha_api_base_url')"
export HA_API_TOKEN="$(bashio::config 'ha_api_token')"
export AGENDA_CALENDAR_ENTITIES="$(bashio::config 'agenda_calendar_entities')"
export AGENDA_WEATHER_ENTITY="$(bashio::config 'agenda_weather_entity')"
export AGENDA_SLEEP_ENTITY="$(bashio::config 'agenda_sleep_entity')"
export AGENDA_BATTERY_ENTITIES="$(bashio::config 'agenda_battery_entities')"
export AGENDA_ALERT_ENTITIES="$(bashio::config 'agenda_alert_entities')"
export AGENDA_NOTES_ENTITY="$(bashio::config 'agenda_notes_entity')"
export AGENDA_SECTION_ORDER="$(bashio::config 'agenda_section_order')"
export AGENDA_TIME_WINDOW_HOURS="$(bashio::config 'agenda_time_window_hours')"
export AGENDA_INCLUDE_HEADER="$(bashio::config 'agenda_include_header')"
export AGENDA_INCLUDE_WEATHER="$(bashio::config 'agenda_include_weather')"
export AGENDA_INCLUDE_SLEEP="$(bashio::config 'agenda_include_sleep')"
export AGENDA_INCLUDE_EVENTS="$(bashio::config 'agenda_include_events')"
export AGENDA_INCLUDE_BATTERY="$(bashio::config 'agenda_include_battery')"
export AGENDA_INCLUDE_ALERTS="$(bashio::config 'agenda_include_alerts')"
export AGENDA_INCLUDE_NOTES="$(bashio::config 'agenda_include_notes')"
export AGENDA_INCLUDE_FOOTER="$(bashio::config 'agenda_include_footer')"

if command -v chromium-browser >/dev/null 2>&1; then
  export CHROMIUM_PATH="$(command -v chromium-browser)"
elif command -v chromium >/dev/null 2>&1; then
  export CHROMIUM_PATH="$(command -v chromium)"
fi

bashio::log.info "Starting receipt printer API"
bashio::log.info "API: ${API_HOST}:${API_PORT} | printer: ${PRINTER_HOST}:${PRINTER_PORT}"
bashio::log.info "Language: ${PRINTER_LANGUAGE} | model: ${PRINTER_MODEL} | cut: ${PRINTER_CUT_MODE}"
bashio::log.info "Profile store: ${PROFILE_STORE_PATH}"
bashio::log.info "HA API base: ${HA_API_BASE_URL} | token configured: $( [ -n \"${HA_API_TOKEN}\" ] && echo yes || echo no )"

exec node /app/src/index.js
