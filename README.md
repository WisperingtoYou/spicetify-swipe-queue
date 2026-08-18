# Spicetify Swipe Queue

A [Spicetify](https://spicetify.app) extension: two-finger trackpad swipe
gestures for Spotify's queue, plus a keybind fallback.

- **Swipe right on any track row** → add to queue, green flash. Or hover
  the row and press **Ctrl+Shift+Space**.
- **Swipe right on a queue row** → remove from queue, red flash. Or hover
  the row and press **Ctrl+Shift+Space**.

Purely additive — doesn't touch Spotify's own DOM/React tree.

## Requirements

- Spotify desktop app, macOS or Windows
- [Spicetify CLI](https://spicetify.app/docs/getting-started) installed and applied (tested on 2.44.0)
- A trackpad for the swipe — the keybind works with any input device

## Install

**macOS / Linux:**
```bash
cp swipe-queue.js ~/.config/spicetify/Extensions/
spicetify config extensions swipe-queue.js
spicetify apply
```

**Windows** (PowerShell):
```powershell
copy swipe-queue.js "$env:APPDATA\spicetify\Extensions\"
spicetify config extensions swipe-queue.js
spicetify apply
```

Windows hasn't been tested on real hardware — the swipe should work (same
trackpad events Chromium reports on macOS), but if it doesn't, the keybind
always will.

## Uninstall

```bash
spicetify config extensions swipe-queue.js-
spicetify apply
```

## Configuration

Tunable in `CONFIG` at the top of `swipe-queue.js` — edit, then `spicetify apply`.

| Key | Default | What it does |
|---|---|---|
| `NATURAL_SCROLL` | `true` | Flip if a gesture feels backwards. |
| `SENSITIVITY` | `0.45` | Lower = requires a more deliberate swipe. |
| `REVEAL_WIDTH` | `130` | Distance (px) to trigger the action. |
| `KEYBIND` | `Ctrl+Shift+Space` | Change the combo, or set `ENABLED: false` to disable. |
| `PLATFORM_OVERRIDES` | `{}` | Per-OS tuning hook, e.g. `PLATFORM_OVERRIDES.windows = { SENSITIVITY: 0.6 }`. |
| `DEBUG` | `false` | Logs gesture/keybind details to the console. |

## Troubleshooting

Set `DEBUG: true`, run `spicetify enable-devtools && spicetify apply`, open
DevTools in the app (Cmd+Option+I on macOS, Ctrl+Shift+I on Windows). If
neither the swipe nor the keybind triggers, `ROW_SELECTOR` or
`QUEUE_PANEL_SELECTOR` in `CONFIG` probably don't match your Spotify
build — inspect a row and update them.
