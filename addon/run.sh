#!/usr/bin/with-contenv bashio
set -euo pipefail

export PORT=8099
export PRINTER_HOST="$(bashio::config 'printer_host')"
export PRINTER_PORT="$(bashio::config 'printer_port')"
export TRANSPORT="$(bashio::config 'transport')"
export PRINT_ENABLED="$(bashio::config 'print_enabled')"
export PAPER_WIDTH_PX="$(bashio::config 'paper_width_px')"
export DEFAULT_FEED_LINES="$(bashio::config 'default_feed_lines')"
export DEFAULT_CUT="$(bashio::config 'default_cut')"
export DEFAULT_THRESHOLD="$(bashio::config 'default_threshold')"
export QUEUE_TIMEOUT_MS="$(bashio::config 'queue_timeout_ms')"
export QUEUE_MAX_RETRIES="$(bashio::config 'queue_max_retries')"
export TEMPLATE_DIR="$(bashio::config 'template_dir')"
export AGENDA_INCLUDE_HEADER="$(bashio::config 'agenda_include_header')"
export AGENDA_INCLUDE_WEATHER="$(bashio::config 'agenda_include_weather')"
export AGENDA_INCLUDE_SLEEP="$(bashio::config 'agenda_include_sleep')"
export AGENDA_INCLUDE_EVENTS="$(bashio::config 'agenda_include_events')"
export AGENDA_INCLUDE_ALERTS="$(bashio::config 'agenda_include_alerts')"
export AGENDA_INCLUDE_NOTES="$(bashio::config 'agenda_include_notes')"
export AGENDA_INCLUDE_FOOTER="$(bashio::config 'agenda_include_footer')"

if command -v chromium-browser >/dev/null 2>&1; then
  export CHROMIUM_PATH="$(command -v chromium-browser)"
elif command -v chromium >/dev/null 2>&1; then
  export CHROMIUM_PATH="$(command -v chromium)"
fi

bashio::log.info "Starting receipt printer service"
bashio::log.info "Render width: ${PAPER_WIDTH_PX}px | print enabled: ${PRINT_ENABLED}"

exec node /app/server.js
