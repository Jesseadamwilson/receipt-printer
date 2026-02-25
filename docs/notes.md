# HA Receipt Printer Notes

## Purpose

- Home Assistant orchestrates triggers.
- Add-on service handles rendering, queueing, and printer transport.
- Target printer profile: 80mm thermal paper (576px raster width).

## Implemented MVP

- Preview-first API + ingress UI.
- Zone-based templates (`header`, `content`, `footer`) with dynamic payload-driven visibility.
- Theme overrides per request (font sizes, spacing, divider thickness, line-height).
- Printer transports:
  - `raw_tcp` (ESC/POS raster)
  - `star_webprnt` (Star WebPRNT bitImage)
  - `noop` fallback for pre-printer development.
- Queue with timeout and retry support.

## Daily agenda include toggles

Add-on options now provide default section toggles:

- header
- weather
- sleep
- events
- alerts
- notes
- footer

Requests can override defaults using payload `include` booleans.

## Local design loop

- Run `npm run dev` from `addon/app`.
- Edit templates in repo `templates/`.
- Browser preview at `http://localhost:8099`.
