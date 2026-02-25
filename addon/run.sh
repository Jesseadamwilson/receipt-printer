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

if command -v chromium-browser >/dev/null 2>&1; then
  export CHROMIUM_PATH="$(command -v chromium-browser)"
elif command -v chromium >/dev/null 2>&1; then
  export CHROMIUM_PATH="$(command -v chromium)"
fi

bashio::log.info "Starting receipt printer API"
bashio::log.info "API: ${API_HOST}:${API_PORT} | printer: ${PRINTER_HOST}:${PRINTER_PORT}"
bashio::log.info "Language: ${PRINTER_LANGUAGE} | model: ${PRINTER_MODEL} | cut: ${PRINTER_CUT_MODE}"

exec node /app/src/index.js
