# Spicetify Swipe Queue

A [Spicetify](https://spicetify.app) extension that brings mobile-style
two-finger trackpad swipe gestures to Spotify's desktop app:

- **Swipe right on any track row** (playlist, album, search results, liked
  songs) → adds that track to the queue, row snaps back, brief green flash.
- **Swipe right on a row inside the queue panel** (the right-hand "Now
  Playing" queue list) → removes that track from the queue, row slides off
  and collapses, brief red flash.

Swiping left does nothing — it's a one-directional gesture by design.

Built to be fully additive: it never moves, wraps, or restructures any DOM
node belonging to Spotify, Spicetify, or other extensions/themes. It only
sets a `transform` on the row being swiped (always composing with whatever
transform was already there) and appends its own floating overlay elements
to `<body>`, entirely outside Spotify's React tree.

## Requirements

- **macOS**, with a trackpad (or a mouse/driver that reports horizontal
  `deltaX` on two-finger swipe — untested on non-Apple hardware)
- **Spotify desktop app**
- **[Spicetify CLI](https://spicetify.app/docs/getting-started)** installed
  and already applied at least once. Developed and tested against
  Spicetify **2.44.0**; should work on any reasonably recent 2.x release.

## Installation

1. Install Spicetify if you haven't already (see the
   [official guide](https://spicetify.app/docs/getting-started) —
   normally just):
   ```bash
   curl -fsSL https://raw.githubusercontent.com/spicetify/cli/main/install.sh | sh
   ```
2. Copy `swipe-queue.js` into your Spicetify Extensions folder:
   ```bash
   cp swipe-queue.js ~/.config/spicetify/Extensions/
   ```
3. Register it as an active extension:
   ```bash
   spicetify config extensions swipe-queue.js
   ```
4. Apply:
   ```bash
   spicetify apply
   ```
5. Restart Spotify if it doesn't reload automatically. Open DevTools-free —
   you should just be able to swipe right on a track row immediately.

## Configuration

All tuning lives in the `CONFIG` object at the top of `swipe-queue.js` —
edit the file directly and re-run `spicetify apply`. The knobs you're most
likely to want to touch:

| Key | Default | What it does |
|---|---|---|
| `NATURAL_SCROLL` | `true` | Compensates for macOS "natural scrolling" inverting swipe direction. Flip this if the gesture feels backwards. |
| `SENSITIVITY` | `0.45` | How much raw trackpad movement translates into on-screen travel. Lower = requires a more deliberate full swipe. |
| `REVEAL_WIDTH` | `130` | Distance (px) the icon panel must travel to trigger the action. |
| `TRACKING_SMOOTHING` | `0.28` | Easing per animation frame — lower feels smoother/laggier, higher feels snappier/twitchier. |
| `COLOR_RED` / `COLOR_GREEN` | `#e22134` / `#1ed760` | Overlay colors for remove/add. |
| `DEBUG` | `false` | Logs gesture start/URI-resolution failures to the console. |

Less commonly needed, but useful if Spotify changes its markup (see
Troubleshooting): `ROW_SELECTOR`, `QUEUE_PANEL_SELECTOR`.

## Troubleshooting

- **Gesture feels backwards** (panel grows from the wrong side, or never
  triggers) — flip `NATURAL_SCROLL` in the config.
- **Nothing happens at all** — enable DevTools and watch the console:
  ```bash
  spicetify enable-devtools
  spicetify apply
  ```
  Then open Spotify and press `Cmd+Option+I`. Set `DEBUG: true` in the
  config and re-apply; a gesture that starts but can't find a track URI
  logs `[SwipeQueue] could not resolve track URI for row`.
- **Selectors stopped matching after a Spotify update** — Spotify
  periodically changes its web UI's internal markup, which can break
  `ROW_SELECTOR` / `QUEUE_PANEL_SELECTOR`. Use DevTools to inspect a
  track row and update those selectors in the config to match.

## Uninstalling

```bash
spicetify config extensions swipe-queue.js-
spicetify apply
```

(Note the trailing `-` — that's Spicetify's syntax for removing an entry
from a config list.)

## How it works (implementation notes)

- A single delegated `wheel` listener on `document`, added with
  `capture: true` + `passive: false`, intercepts two-finger swipes before
  macOS/Chromium's built-in back/forward navigation gesture can fire.
- While a gesture is active, a `requestAnimationFrame` loop eases the
  displayed offset toward the latest input every frame, decoupling visual
  smoothness from the raw cadence of wheel events — this is what gives the
  continuous, interruptible "pan" feel instead of frame-to-frame jumps.
- Reaching full extension **is** the trigger — the action fires instantly
  mid-gesture rather than waiting for fingers to lift, so you can backtrack
  freely right up until the moment it commits.
- Track URIs are resolved via, in order: a `data-uri` attribute on the row,
  a `data-uri` attribute on a descendant, a `/track/<id>` link `href`, and
  finally a walk up the React fiber tree looking for a `uri`/`item`/`track`
  prop — a fallback for rows that don't expose the URI in the DOM directly.
