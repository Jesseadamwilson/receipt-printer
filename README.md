# HA Receipt Printer Spike (Fresh Start)

This is a clean Node.js baseline focused on reliable network printing, then exposing that flow over a local API.
Current package/add-on version: `0.8.5`.

## Win Sequence

1. Text print over TCP socket
2. Image print from PNG over TCP socket
3. HTML/CSS -> PNG (Playwright) -> print
4. Local API + single-worker queue + retries
5. Ingress UI for daily/message setup + template CSS + preview/print actions

## Setup

1. Install Node with Homebrew (if needed): `brew install node`
2. Copy `.env.example` to `.env` and adjust values.
3. Install project packages with npm: `npm install`
4. Run checks: `npm run check`

Local profile storage default is `output/profiles.json` unless `PROFILE_STORE_PATH` is set.

## Commands

- `npm run print:text`
- `npm run print:image`
- `npm run render`
- `npm run print:render`
- `npm run api` (or `npm start`)

## API (Step 1 + 2)

Start the service:

- `npm run api`

Health check:

- `curl "http://localhost:8099/health"`

Print text:

```bash
curl -X POST "http://localhost:8099/print/text" \
  -H "Content-Type: application/json" \
  -d '{
    "headline": "API Text Test",
    "message": "Line 1\nLine 2",
    "print": { "feedLines": 3, "cut": true }
  }'
```

Print message from message profile (or payload override):

```bash
curl -X POST "http://localhost:8099/print/message" \
  -H "Content-Type: application/json" \
  -d '{
    "profileId": "message_main",
    "print": { "feedLines": 3, "cut": true }
  }'
```

Print existing PNG:

```bash
curl -X POST "http://localhost:8099/print/image" \
  -H "Content-Type: application/json" \
  -d '{
    "imagePath": "output/rendered.png",
    "print": { "feedLines": 3, "cut": true }
  }'
```

Render then print:

```bash
curl -X POST "http://localhost:8099/print/render" \
  -H "Content-Type: application/json" \
  -d '{
    "headline": "Render API Test",
    "lines": ["Header zone", "Content zone", "Footer zone"],
    "print": { "feedLines": 3, "cut": true }
  }'
```

Print daily agenda:

```bash
curl -X POST "http://localhost:8099/print/daily-agenda" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Daily Agenda",
    "subtitle": "Wednesday",
    "weather": { "summary": "Cloudy", "temp": "64F", "high": "68F", "low": "54F" },
    "sleep": { "hours": "7.2" },
    "events": [{ "time": "09:00", "title": "Standup", "location": "Office" }],
    "batteries": [{ "name": "Phone", "level": "82%" }],
    "alerts": ["Litter box needs cleaning"],
    "notes": "Replace air filter",
    "include": {
      "header": true,
      "weather": true,
      "sleep": true,
      "events": true,
      "battery": true,
      "alerts": true,
      "notes": true,
      "footer": true
    },
    "source": "payload_only",
    "print": { "feedLines": 3, "cut": true }
  }'
```

Check a specific job:

- `curl "http://localhost:8099/jobs/<job-id>"`

Profiles API and UI:

- `GET /ui` (or `/`) -> profile editor
- `GET /api/profiles` -> current profile store
- `PUT /api/profiles` -> save profile store
- `GET /template/css` -> read custom receipt CSS
- `PUT /template/css` -> save custom receipt CSS
- `POST /preview/message` -> render message profile to PNG
- `POST /preview/daily-agenda` -> render daily agenda profile to PNG

Example: print daily agenda with a selected profile:

```bash
curl -X POST "http://localhost:8099/print/daily-agenda" \
  -H "Content-Type: application/json" \
  -d '{
    "profileId": "daily_agenda_main",
    "title": "Daily Agenda",
    "subtitle": "Today",
    "source": "auto",
    "print": { "feedLines": 3, "cut": true }
  }'
```

## Home Assistant Add-on (Step 3)

This repo now includes a Home Assistant add-on bundle in:

- `repository.yaml`
- `addon/config.json`
- `addon/Dockerfile`
- `addon/run.sh`
- `addon/app/*` (runtime app copied from this spike)

Install/update in HA:

1. Push this repo to GitHub.
2. In Home Assistant: `Settings -> Add-ons -> Add-on Store -> 3-dot menu -> Repositories`.
3. Add: `https://github.com/Jesseadamwilson/receipt-printer`
4. Open add-on `Receipt Printer Spike` and install/update.
5. Set options (minimum: `printer_host`, `printer_port`, `printer_language`), then start.

Recommended options for your current Star test printer:

- `printer_host`: `10.0.0.25`
- `printer_port`: `9100`
- `printer_language`: `star-prnt`
- `printer_model`: `star-mc-print3`
- `printer_cut_mode`: `full`
- `profile_store_path`: `/config/receipt-printer/profiles.json`
- `agenda_pre_refresh_enabled`: `true`
- `agenda_pre_refresh_services`: `icloud.update`
- `agenda_pre_refresh_delay_ms`: `2500`

Profile editor (v0.7.x):

- Open add-on ingress and go to `/ui`.
- Non-structured editor focused on two templates:
- `Daily Agenda`: add/remove rows, set row type, entity id, optional label, and reorder with Up/Down controls.
- `Message`: headline + freeform textarea (emoji-safe because `/print/message` now renders image first).
- `Template CSS + Preview`: edit CSS, preview daily/message as PNG, and print daily/message directly from ingress.
- Ingress UI mirrors Home Assistant theme variables and follows dark/light mode from HA.

If agenda prints only subtitle/no content:

1. Confirm `homeAssistantApi.hasToken` is `true` in `/health`.
2. Check add-on logs for `[ha-data-source]` warnings.
3. Verify entity IDs exist and have non-empty state values.
4. Confirm `/health` shows `agendaPreRefresh.enabled=true` and expected service list.

Validate add-on after start:

```bash
curl "http://homeassistant.local:8099/health"

curl -X POST "http://homeassistant.local:8099/print/text" \
  -H "Content-Type: application/json" \
  -d '{"headline":"HA Add-on Test","message":"Text from HA add-on","print":{"feedLines":3,"cut":true}}'
```

Template paths:

- Canonical template location is `/app/templates/*` (bundled in repo at `addon/app/templates/*`).
- `POST /preview/*` and `POST /print/*` use the same template files.
- Message print jobs use `/app/templates/message.html`.
- Daily agenda print jobs use `/app/templates/daily-agenda.html`.
- Generic render jobs use `/app/templates/receipt.html`.
- Template path overrides were removed from add-on options to keep one source of truth.

Agenda pre-refresh behavior:

- For `POST /preview/daily-agenda` and `POST /print/daily-agenda` with `source=auto`, the service can call HA services before fetching states/events.
- Default is `icloud.update`, once per agenda request.
- Optional per-request overrides in payload:
- `refreshBeforeFetch` (boolean)
- `refreshServices` (array or comma-separated string of `domain.service`)
- `refreshDelayMs` (int milliseconds to wait after refresh before reading states)

Template tokens:

- You can place tokens directly in template HTML, for example:
- `{{date}}`
- `{{current_temp}}`
- `{{hours_of_sleep}}`
- `{{todays_calendar_events}}`
- `{{{todays_calendar_events_html}}}`
- Double braces escape HTML (`{{token}}`).
- Triple braces render raw HTML (`{{{token}}}`), useful for list placeholders ending in `_html`.

## Home Assistant Wiring (Step 4)

Ready-to-copy Home Assistant config examples are included in:

- `home-assistant/helpers.yaml`
- `home-assistant/rest_commands.yaml`
- `home-assistant/scripts.yaml`
- `home-assistant/dashboard-card.yaml`

These provide:

- `input_boolean` toggles for daily agenda sections (`header/weather/sleep/events/battery/alerts/notes/footer`)
- message and notes `input_text` helpers
- scripts for `Print Message` and `Print Daily Agenda`
- a dashboard card layout with buttons and toggles

Apply these snippets in your HA config, reload helpers/scripts/rest commands, then test:

```bash
curl -X POST "http://homeassistant.local:8099/print/daily-agenda" \
  -H "Content-Type: application/json" \
  -d '{"title":"HA Agenda Test","source":"auto","include":{"weather":true,"sleep":false,"events":true,"battery":true,"alerts":true,"notes":true},"print":{"cut":true}}'
```

## Notes

- Homebrew installs Node itself, but project libraries are still installed with `npm install`.
- `PRINTER_LANGUAGE` should be set per printer command language.
- For Star mC-Print3 testing, use `star-prnt` and set `PRINTER_MODEL=star-mc-print3` (internally normalized to the closest supported model).
- For Epson TM-m30III, use `esc-pos`.
- Set `PRINTER_CUT_MODE=full` (recommended) or `partial`.
