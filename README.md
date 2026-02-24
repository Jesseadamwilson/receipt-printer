# HA Receipt Printer

Home Assistant-first receipt rendering + printing service for thermal printers (target: EPSON TM-m30III).

## Project model

- This project is a **Home Assistant Add-on** (not a native HA Integration yet).
- Home Assistant automations/scripts call the add-on REST API.
- The add-on handles:
  - HTML/CSS template rendering -> PNG (Playwright)
  - PNG -> ESC/POS raster conversion
  - queued print dispatch to printer transport

## Install into Home Assistant

1. Push this repo to GitHub.
2. In Home Assistant: `Settings -> Add-ons -> Add-on Store -> 3-dot menu -> Repositories`.
3. Add repository URL: `https://github.com/Jesseadamwilson/receipt-printer`.
4. Open add-on `Receipt Printer Service` and click `Install`.
5. Configure options (printer host, print mode, agenda defaults), then `Start`.
6. Open the add-on Web UI (Ingress) to preview/print.

This is installed as an **Add-on**. Your HA dashboard buttons/scripts are then built on top of `rest_command` calls.

## Local IDE template workflow (preview-first)

Edit templates in:

- `templates/message.html`
- `templates/daily-agenda.html`
- `templates/alert.html`

Run locally from repo root:

```bash
cd addon/app
npm install
npm run dev
```

Then open:

- `http://localhost:8099`

Notes:

- `npm run dev` uses `TEMPLATE_DIR=../../templates`, so edits in root `templates/` are used directly.
- Templates are loaded from disk per request, so refresh/preview immediately reflects changes.
- Dev mode defaults to `TRANSPORT=noop` and `PRINT_ENABLED=false`.

## Template zones and dynamic payloads

Templates now use three zones:

- `header`
- `content`
- `footer`

Pass `include` booleans to show/hide zones/sections dynamically.

Message example:

```json
{
  "headline": "Home Note",
  "message": "Trash day is tomorrow.",
  "footer": "- Jesse",
  "include": {
    "header": true,
    "content": true,
    "footer": true
  },
  "theme": {
    "header_size_px": 42,
    "content_size_px": 30,
    "footer_size_px": 18,
    "padding_x_px": 18,
    "padding_y_px": 24,
    "divider_thickness_px": 4,
    "line_height": 1.2
  }
}
```

Daily agenda example:

```json
{
  "title": "Daily Agenda",
  "subtitle": "Tuesday",
  "weather": { "summary": "Cloudy", "temp": "64°F", "high": "68°F", "low": "54°F" },
  "sleep": { "hours": "7.3" },
  "events": [
    { "time": "08:30", "title": "Standup", "location": "Office" },
    { "time": "13:00", "title": "Review", "location": "Zoom" }
  ],
  "alerts": ["Litter box needs cleaning"],
  "notes": "Buy coffee filters",
  "include": {
    "header": true,
    "weather": true,
    "sleep": true,
    "events": true,
    "alerts": true,
    "notes": false,
    "footer": true
  }
}
```

## Add-on options

Configured in `addon/config.json`:

- `printer_host`
- `printer_port` (default `9100`)
- `transport` (`raw_tcp` or `noop`)
- `print_enabled`
- `paper_width_px` (default `576`)
- `default_feed_lines`
- `default_cut`
- `default_threshold`
- `queue_timeout_ms`
- `queue_max_retries`
- `template_dir` (default `/config/receipt-printer/templates`)
- `agenda_include_header`
- `agenda_include_weather`
- `agenda_include_sleep`
- `agenda_include_events`
- `agenda_include_alerts`
- `agenda_include_notes`
- `agenda_include_footer`

Agenda include toggles in add-on config become defaults used by `/render/daily-agenda` and `/print/daily-agenda` unless overridden in request payload.

## API endpoints

- `GET /health`
- `POST /render/message`
- `POST /render/daily-agenda`
- `POST /render/template`
- `POST /print/message`
- `POST /print/daily-agenda`
- `POST /print/template`

## HA automation wiring example

```yaml
rest_command:
  receipt_print_daily_agenda:
    url: "http://127.0.0.1:8099/print/daily-agenda"
    method: POST
    content_type: application/json
    payload: >
      {
        "title": "Daily Agenda",
        "subtitle": "{{ now().strftime('%A, %b %-d') }}",
        "weather": {
          "summary": "{{ states('weather.home') }}",
          "temp": "{{ state_attr('weather.home', 'temperature') }}°"
        },
        "include": {
          "weather": {{ is_state('input_boolean.receipt_include_weather', 'on') }},
          "sleep": {{ is_state('input_boolean.receipt_include_sleep', 'on') }},
          "events": {{ is_state('input_boolean.receipt_include_events', 'on') }},
          "alerts": {{ is_state('input_boolean.receipt_include_alerts', 'on') }},
          "notes": {{ is_state('input_boolean.receipt_include_notes', 'on') }}
        }
      }
```

If `127.0.0.1` does not resolve in your HA install, replace it with your HA host IP (for example `http://192.168.1.50:8099/...`).

Optional helper booleans for dashboard toggles:

```yaml
input_boolean:
  receipt_include_weather:
    name: Receipt Include Weather
    icon: mdi:weather-partly-cloudy
  receipt_include_sleep:
    name: Receipt Include Sleep
    icon: mdi:sleep
  receipt_include_events:
    name: Receipt Include Events
    icon: mdi:calendar
  receipt_include_alerts:
    name: Receipt Include Alerts
    icon: mdi:alert
  receipt_include_notes:
    name: Receipt Include Notes
    icon: mdi:note-text
```

## File layout

```text
receipt-printer/
  repository.yaml
  addon/
    config.json
    Dockerfile
    run.sh
    app/
      server.js
      config.js
      renderer/
      printer/
      queue/
      templates/
      public/
  templates/
  assets/
    fonts/
    icons/
  docs/
    notes.md
```
