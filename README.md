# Spicetify Swipe Queue

A [Spicetify](https://spicetify.app) extension for two-finger trackpad swipe
gestures in Spotify's desktop app:

- **Swipe right on any track row** (playlist, album, search, liked songs) →
  add to queue, green flash.
- **Swipe right on a row in the queue panel** → remove from queue, red
  flash, row slides off.

Purely additive — only sets `transform` on the swiped row and adds floating
overlay elements to `<body>`, never touches Spotify's own DOM/React tree.

## Requirements

- macOS with a trackpad
- Spotify desktop app
- [Spicetify CLI](https://spicetify.app/docs/getting-started) installed and applied (tested on 2.44.0)

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
| `DEBUG` | `false` | Logs gesture details to the console. |

## Troubleshooting

Set `DEBUG: true`, run `spicetify enable-devtools && spicetify apply`, open
Spotify, `Cmd+Option+I`. If nothing triggers, `ROW_SELECTOR` or
`QUEUE_PANEL_SELECTOR` in `CONFIG` may no longer match your Spotify build's
DOM — inspect a row and update them.
