# Spicetify Swipe Queue

A [Spicetify](https://spicetify.app) extension for two-finger trackpad swipe
gestures in Spotify's desktop app, plus a keybind that does the same thing
without a trackpad:

- **Swipe right on any track row** (playlist, album, search, liked songs) →
  add to queue, green flash. Or hover the row and press **Ctrl+Shift+Space**.
- **Swipe right on a row in the queue panel** → remove from queue, red
  flash, row slides off. Or hover the row and press **Ctrl+Shift+Space**.

Purely additive — only sets `transform`/floating overlay elements, never
touches Spotify's own DOM/React tree.

## Requirements

- Spotify desktop app, macOS or Windows
- [Spicetify CLI](https://spicetify.app/docs/getting-started) installed and applied (tested on 2.44.0)
- A trackpad for the swipe gesture — the keybind works with any input device

**Platform note:** this file has no macOS-specific code — it only touches
Spotify's own web UI and the cross-platform Spicetify API, and two-finger
trackpad panning reports the same events on Windows Precision Touchpad as on
macOS, so the swipe gesture is expected to work on Windows unmodified. That
said, it hasn't been tested on real Windows hardware. If it doesn't work or
feels off on your machine, the **Ctrl+Shift+Space** keybind is a guaranteed
fallback — same actions, no trackpad required — and `PLATFORM_OVERRIDES` in
`CONFIG` is a ready-made hook for per-OS tuning if needed.

## Install

```bash
cp swipe-queue.js ~/.config/spicetify/Extensions/
spicetify config extensions swipe-queue.js
spicetify apply
```

## Uninstall

```bash
spicetify config extensions swipe-queue.js-
spicetify apply
```

## Configuration

Everything's tunable in the `CONFIG` object at the top of `swipe-queue.js` —
edit and re-run `spicetify apply`. Most useful:

| Key | Default | What it does |
|---|---|---|
| `NATURAL_SCROLL` | `true` | Flip if a gesture feels backwards. |
| `SENSITIVITY` | `0.45` | Lower = requires a more deliberate swipe. |
| `REVEAL_WIDTH` | `130` | Distance (px) to trigger the action. |
| `KEYBIND` | `Ctrl+Shift+Space` | Change `code`/`ctrlKey`/`shiftKey`/`altKey`/`metaKey`, or set `ENABLED: false` to turn it off. |
| `PLATFORM_OVERRIDES` | `{}` | Per-OS overrides merged into `CONFIG`, e.g. `PLATFORM_OVERRIDES.windows = { SENSITIVITY: 0.6 }`. Empty by default. |
| `DEBUG` | `false` | Logs gesture/keybind details to the console. |

## Troubleshooting

Set `DEBUG: true`, run `spicetify enable-devtools && spicetify apply`, open
DevTools in the app (Cmd+Option+I on macOS, Ctrl+Shift+I on Windows). If
neither the swipe nor the keybind triggers, `ROW_SELECTOR` or
`QUEUE_PANEL_SELECTOR` in `CONFIG` likely don't match your Spotify build's
DOM — both features use them to find rows and tell tracklist vs. queue
apart. Inspect a row and update the selectors to match.
