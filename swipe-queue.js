// ==[ swipe-queue.js ]========================================================
// Spicetify extension: mobile-style two-finger trackpad swipe gestures, plus
// a keybind that does the same thing without a trackpad.
//
//   Tracklist rows (playlists, albums, search, etc.)
//     swipe right          -> add track to queue, row snaps back, green flash
//     hover + KEYBIND       -> same, no trackpad needed
//
//   Queue panel rows (right-hand "Now Playing" queue list)
//     swipe right          -> remove track from queue, row slides off + collapses
//     hover + KEYBIND       -> same, no trackpad needed
//
// Platform: this file has no macOS-specific logic anywhere — it only touches
// Spotify's own web DOM and the cross-platform Spicetify API, and two-finger
// trackpad panning reports the same wheel deltaX events on Windows Precision
// Touchpad as it does on macOS. So the swipe gesture is expected to work on
// Windows unmodified; PLATFORM_OVERRIDES below exists as a ready-made hook to
// retune it per-OS if real-world testing (which this extension's author could
// not do on real Windows hardware) says it needs it. The KEYBIND, added
// 2026-08-17, works identically on every platform and every input device —
// hover any row and press it — and is the guaranteed fallback if a given
// touchpad/OS combination doesn't report gesture events the way this expects.
//
// Designed to be 100% additive: it does not move, wrap, or restructure any
// DOM nodes that belong to Spotify/Spicetify or other extensions/themes. It
// only (a) sets the `transform` inline style on the row being swiped — and
// always *composes* with whatever transform was already there, so it won't
// clobber any virtualization positioning a list might rely on — and (b)
// appends its own floating overlay elements to <body>, fully outside
// Spotify's React tree, so other code can't be affected by it.
//
// -----------------------------------------------------------------------
// INSTALL
//   1. Copy this file to: ~/.config/spicetify/Extensions/swipe-queue.js
//   2. spicetify config extensions swipe-queue.js
//   3. spicetify apply
//
// TROUBLESHOOTING
//   Flip DEBUG to true below, open DevTools (spicetify enable-devtools &&
//   spicetify apply, then open DevTools in the app — Cmd+Option+I on macOS,
//   Ctrl+Shift+I on Windows), and watch the console while you try the
//   gesture or keybind. See the README that ships alongside this file for
//   the full guide. The four things most likely to need a tweak for your
//   exact Spotify build/platform are marked "ADJUST ME" below.
// -----------------------------------------------------------------------

(function SwipeQueue() {
  // Avoid double-init if Spicetify reloads extensions (Ctrl+Shift+R, etc.)
  if (window.__swipeQueueLoaded) return;

  if (
    !(
      window.Spicetify &&
      Spicetify.Platform &&
      Spicetify.Player &&
      typeof Spicetify.addToQueue === "function" &&
      typeof Spicetify.removeFromQueue === "function" &&
      typeof Spicetify.showNotification === "function"
    )
  ) {
    setTimeout(SwipeQueue, 300);
    return;
  }

  window.__swipeQueueLoaded = true;

  try {
    init();
  } catch (err) {
    console.error("[SwipeQueue] failed to initialize:", err);
  }

  // ===========================================================================
  function init() {
    // ---- CONFIG ------------------------------------------------------------
    const CONFIG = {
      // If the swipe direction feels backwards (you swipe right and the
      // green/red panel grows from the wrong side, or it never triggers),
      // flip this. It compensates for macOS "natural scrolling" inverting
      // the sign of wheel deltaX for two-finger trackpad gestures.
      NATURAL_SCROLL: true,

      DEBUG: false,

      // Matches a single track row in any tracklist (playlist, album,
      // search results, liked songs) or the queue panel. Re-verified via
      // live DevTools inspection on 2026-08-17: regular tracklists (album/
      // playlist/search) now render rows as `.main-trackList-trackListRow`
      // (a `draggable="true"` div), NOT `data-encore-id="listRow"` — that
      // encore-id is now a generic design-system marker shared by lots of
      // unrelated small elements (shelf titles, artwork cells, etc.), which
      // is why swipes on regular rows previously fell through to Spotify's
      // own two-finger back/forward navigation instead of triggering the
      // gesture. The queue panel's "Next up" rows still use the old
      // data-encore-id="listRow" markup, so both patterns are kept.
      ROW_SELECTOR: '[data-encore-id="listRow"], .main-trackList-trackListRow',

      // ADJUST ME (#2): selectors (comma-separated) for ancestors that
      // identify the row as living inside the right-hand Queue panel,
      // rather than a regular tracklist. If a row matches none of these,
      // it's treated as a regular tracklist row (add-to-queue behaviour).
      QUEUE_PANEL_SELECTOR: [
        '[data-testid="now-playing-view"]',
        '[aria-label="Queue"]',
        '[data-testid="queue"]',
        ".main-queue-trackList",
      ].join(", "),

      // How far (px) the icon panel travels at full extension. Reaching
      // this distance is the trigger itself — see "instant commit" below —
      // there's no separate, earlier threshold anymore. That removes the
      // old mismatch where the action fired before the slider visually
      // looked finished, and means you can backtrack freely right up
      // until you actually hit the end.
      REVEAL_WIDTH: 130,

      // Purely visual: ratio of REVEAL_WIDTH at which the icon brightens
      // and scales up slightly, as an "almost there" cue before the real
      // trigger at 100%. Doesn't affect behavior.
      ARM_RATIO: 0.85,

      // Dampens raw trackpad deltaX before it's accumulated. macOS applies
      // its own acceleration curve to trackpad scroll/swipe deltas, so a
      // small finger movement can report a large pixel delta — this scales
      // it back down so the gesture requires a more deliberate, full swipe
      // rather than completing almost instantly. Lower = more travel needed
      // per cm of actual finger movement. Tune this first if it still feels
      // too twitchy or too sluggish.
      SENSITIVITY: 0.45,

      // How much the on-screen position eases toward the latest input each
      // animation frame (0–1). Lower = smoother/more "weighted" but laggier;
      // higher = snappier but more prone to feeling jumpy if wheel events
      // arrive in uneven bursts. This is what gives the continuous,
      // interruptible macOS-pan feel instead of frame-to-frame jumps.
      //
      // 0.28 measured out to ~2-3 frames of chronic trailing lag behind the
      // input on a 120Hz display (confirmed via live frame sampling on
      // 2026-08-17) — since the target moves on nearly every frame during
      // an active drag, that's a constant "always chasing" feel rather than
      // a one-time settle, which read as sluggish/weighted. 0.55 keeps
      // meaningful inter-frame interpolation (still not raw 1:1) while
      // roughly halving that lag.
      TRACKING_SMOOTHING: 0.55,

      // Minimum |deltaX| (px) before we even consider starting a gesture,
      // so normal vertical scrolling / tiny trackpad jitter doesn't trigger it.
      START_THRESHOLD_PX: 6,

      // How long (ms) after the last wheel event we treat the gesture as
      // "fingers lifted" without having reached full extension, and snap
      // back. Only matters for the cancel path now — the commit path fires
      // instantly mid-gesture, no debounce involved — so this can be fairly
      // short without risking a premature delete.
      GESTURE_END_DEBOUNCE_MS: 180,

      // Snap-back duration when you release before reaching full extension.
      CANCEL_SNAP_MS: 200,

      // Completion animation duration once you actually hit full extension
      // and the action fires. Kept short and decisive on purpose — this is
      // the "fast, premium, not clunky" bit.
      COMMIT_SNAP_MS: 130,

      COLOR_RED: "#e22134",
      COLOR_GREEN: "#1ed760",

      // Hover any row and press this to trigger the same action as the
      // swipe (add on a tracklist row, remove on a queue row) — works on
      // every platform and input device, no trackpad required. `code` is
      // the physical key (layout-independent); the modifiers are exact —
      // all four must match with no extras held.
      KEYBIND: {
        ENABLED: true,
        ctrlKey: true,
        shiftKey: true,
        altKey: false,
        metaKey: false,
        code: "Space",
        FLASH_MS: 220,
      },
    };

    // ADJUST ME (#4): this file has no macOS-specific logic — Spotify's web
    // DOM and the Spicetify API are the same on every platform, and Chromium
    // reports two-finger trackpad panning as the same wheel deltaX events on
    // Windows Precision Touchpad as on macOS — so the swipe gesture is
    // expected to work unmodified. This is here as a ready-made hook in case
    // real testing on Windows (not done by this file's author — no Windows
    // hardware available) finds it needs different tuning, e.g.:
    //   PLATFORM_OVERRIDES.windows = { SENSITIVITY: 0.6 };
    // If the gesture doesn't work at all on a given machine, the KEYBIND
    // above works regardless — hover a row and press it.
    const PLATFORM = (() => {
      const raw =
        (navigator.userAgentData && navigator.userAgentData.platform) ||
        navigator.platform ||
        navigator.userAgent ||
        "";
      if (/win/i.test(raw)) return "windows";
      if (/mac/i.test(raw)) return "mac";
      if (/linux/i.test(raw)) return "linux";
      return "unknown";
    })();
    const PLATFORM_OVERRIDES = { windows: {}, mac: {}, linux: {}, unknown: {} };
    Object.assign(CONFIG, PLATFORM_OVERRIDES[PLATFORM]);

    const ARM_THRESHOLD = CONFIG.REVEAL_WIDTH * CONFIG.ARM_RATIO;

    // How long (ms) after a queue-remove commit before new gestures are
    // accepted. Spotify's list-collapse animation runs for ~300ms after the
    // row is unmounted; without this guard, fingers still on the trackpad
    // will start a new gesture on the collapsing rows and produce a ghost
    // overlay with no card attached to it.
    const COMMIT_COOLDOWN_MS = 500;
    let lastCommitTime = 0;

    // ---- ICONS (plain inline SVG, no external assets/network calls) -------
    const ICON_BIN_SVG = `
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4 7h16"/>
        <path d="M9 7V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V7"/>
        <path d="M6 7l1 13a2 2 0 0 0 2 1.9h6a2 2 0 0 0 2-1.9l1-13"/>
        <path d="M10 11v6"/>
        <path d="M14 11v6"/>
      </svg>`;

    const ICON_QUEUE_SVG = `
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 6h12"/>
        <path d="M3 12h12"/>
        <path d="M3 18h7"/>
        <path d="M18 14v8"/>
        <path d="M14 18h8"/>
      </svg>`;

    // ---- STYLE INJECTION ----------------------------------------------------
    const style = document.createElement("style");
    style.id = "swipequeue-style";
    style.textContent = `
      .swipequeue-overlay {
        position: fixed;
        top: 0; left: 0;
        width: 0; height: 0;
        z-index: 9999;
        pointer-events: none;
        overflow: hidden;
        display: flex;
        align-items: stretch;
        border-radius: 4px;
      }
      .swipequeue-overlay-inner {
        width: ${CONFIG.REVEAL_WIDTH}px;
        margin-left: auto;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: filter 120ms ease;
      }
      .swipequeue-overlay[data-context="queue"] .swipequeue-overlay-inner {
        background: ${CONFIG.COLOR_RED};
      }
      .swipequeue-overlay[data-context="tracklist"] .swipequeue-overlay-inner {
        background: ${CONFIG.COLOR_GREEN};
      }
      .swipequeue-overlay.is-armed .swipequeue-overlay-inner {
        filter: brightness(1.2);
      }
      .swipequeue-overlay-inner svg {
        transition: transform 120ms ease;
      }
      .swipequeue-overlay.is-armed .swipequeue-overlay-inner svg {
        transform: scale(1.12);
      }
    `;
    document.head.appendChild(style);

    // ---- STATE ---------------------------------------------------------------
    /** @type {null | {
     *   row: HTMLElement, context: 'queue'|'tracklist', uri: string,
     *   rawOffset: number, baseTransform: string, originalRect: DOMRect,
     *   overlayEl: HTMLElement, rafScheduled: boolean, endTimer: any
     * }} */
    let activeGesture = null;

    // ---- TRACK URI EXTRACTION -------------------------------------------------
    // ADJUST ME (#3): if DEBUG logs show "no track URI found" for rows that
    // clearly are tracks, this is the function to extend. It tries several
    // strategies in order, from cheapest/most reliable to most fragile.
    function getTrackUriFromRow(row) {
      if (row.dataset && row.dataset.uri) return row.dataset.uri;

      const withUri = row.querySelector("[data-uri]");
      if (withUri && withUri.dataset.uri) return withUri.dataset.uri;

      const anchor = row.querySelector('a[href*="/track/"]');
      if (anchor) {
        const href = anchor.getAttribute("href") || "";
        const match = href.match(/track\/([a-zA-Z0-9]+)/);
        if (match) return `spotify:track:${match[1]}`;
      }

      // Fallback: walk the React fiber tree looking for a uri/track prop.
      try {
        const fiberKey = Object.keys(row).find(
          (k) =>
            k.startsWith("__reactFiber$") ||
            k.startsWith("__reactInternalInstance$")
        );
        if (fiberKey) {
          let fiber = row[fiberKey];
          for (let i = 0; i < 14 && fiber; i++) {
            const props = fiber.memoizedProps;
            if (props) {
              if (
                typeof props.uri === "string" &&
                props.uri.startsWith("spotify:track:")
              )
                return props.uri;
              if (props.item && typeof props.item.uri === "string")
                return props.item.uri;
              if (props.track && typeof props.track.uri === "string")
                return props.track.uri;
            }
            fiber = fiber.return;
          }
        }
      } catch (e) {
        if (CONFIG.DEBUG) console.warn("[SwipeQueue] fiber walk failed", e);
      }

      return null;
    }

    function getRowContext(row) {
      return row.closest(CONFIG.QUEUE_PANEL_SELECTOR) ? "queue" : "tracklist";
    }

    // ---- OVERLAY HELPERS -------------------------------------------------------
    function createOverlay(context) {
      const el = document.createElement("div");
      el.className = "swipequeue-overlay";
      el.dataset.context = context;
      const inner = document.createElement("div");
      inner.className = "swipequeue-overlay-inner";
      inner.innerHTML = context === "queue" ? ICON_BIN_SVG : ICON_QUEUE_SVG;
      el.appendChild(inner);
      document.body.appendChild(el);
      return el;
    }

    function positionOverlay(g, offset) {
      const r = g.originalRect;
      // The overlay must only fill the gap that's actually exposed to the
      // right of the album art. The leading padding (r.left → overlayLeft)
      // is left uncovered so it shows the normal background, not red/green.
      const leftPad = g.overlayLeft - r.left;
      const visibleWidth = Math.max(0, offset - leftPad);
      g.overlayEl.style.left   = g.overlayLeft + "px";
      g.overlayEl.style.top    = r.top + "px";
      g.overlayEl.style.height = r.height + "px";
      g.overlayEl.style.width  = visibleWidth + "px";
      g.overlayEl.classList.toggle("is-armed", offset >= ARM_THRESHOLD);
    }

    function applyTransform(g, offset) {
      g.row.style.transform =
        (g.baseTransform ? g.baseTransform + " " : "") +
        `translateX(${offset}px)`;
    }

    // ---- FRAME LOOP ---------------------------------------------------------
    // Runs continuously (not just on each wheel event) for as long as a
    // gesture is active, easing the displayed offset toward the latest
    // input target every frame. This decouples the visual smoothness from
    // the raw cadence of incoming wheel events, which is what gives the
    // continuous, interruptible feel rather than discrete jumps.
    function tick(g) {
      if (activeGesture !== g) return; // gesture ended/handed off to CSS transition
      if (!g.row.isConnected) {
        abortGesture(g);
        return;
      }

      const target = Math.min(g.rawOffset, CONFIG.REVEAL_WIDTH);
      g.displayOffset += (target - g.displayOffset) * CONFIG.TRACKING_SMOOTHING;
      if (Math.abs(target - g.displayOffset) < 0.4) g.displayOffset = target;

      applyTransform(g, g.displayOffset);
      positionOverlay(g, g.displayOffset);

      // Reaching full extension IS the trigger — fire immediately, mid-
      // gesture, rather than waiting for fingers to lift. This is what
      // makes it decisive: right up until this point you can always
      // backtrack, and the instant you hit it, it's already done.
      if (g.displayOffset >= CONFIG.REVEAL_WIDTH - 0.5) {
        clearTimeout(g.endTimer);
        commitGesture(g);
        return;
      }

      g.rafId = requestAnimationFrame(() => tick(g));
    }

    // ---- GESTURE LIFECYCLE -------------------------------------------------------
    function maybeStartGesture(e) {
      // Block new gestures during Spotify's post-remove list-collapse
      // animation — otherwise fingers still on the trackpad will attach
      // a gesture to a row that's in the middle of collapsing upward.
      if (Date.now() - lastCommitTime < COMMIT_COOLDOWN_MS) return;

      const row = e.target.closest(CONFIG.ROW_SELECTOR);
      if (!row) return;

      const { deltaX, deltaY } = e;
      if (Math.abs(deltaX) < CONFIG.START_THRESHOLD_PX) return;
      if (Math.abs(deltaX) < Math.abs(deltaY) * 1.5) return; // not clearly horizontal

      const swipingRight = CONFIG.NATURAL_SCROLL ? deltaX < 0 : deltaX > 0;
      if (!swipingRight) return; // left swipe does nothing, per spec

      const context = getRowContext(row);
      const uri = getTrackUriFromRow(row);
      if (!uri) {
        if (CONFIG.DEBUG)
          console.warn("[SwipeQueue] could not resolve track URI for row", row);
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      const rect = row.getBoundingClientRect();

      // Align the overlay's left edge with the album art image, not the
      // full row border. The row has leading padding (track number, drag
      // handle, etc.) before the art, and we don't want red/green bleeding
      // into that space.
      const imgEl = row.querySelector("img");
      const overlayLeft = imgEl
        ? Math.round(imgEl.getBoundingClientRect().left)
        : rect.left;

      const overlay = createOverlay(context);

      activeGesture = {
        row,
        context,
        uri,
        rawOffset: Math.abs(deltaX) * CONFIG.SENSITIVITY,
        displayOffset: 0,
        baseTransform: row.style.transform || "",
        originalRect: rect,
        overlayLeft,
        overlayEl: overlay,
        rafId: null,
        endTimer: null,
        committed: false,
      };

      row.style.transition = "none";
      tick(activeGesture);
      activeGesture.endTimer = setTimeout(
        () => endGesture(activeGesture),
        CONFIG.GESTURE_END_DEBOUNCE_MS
      );

      if (CONFIG.DEBUG)
        console.log("[SwipeQueue] gesture start", { context, uri, row });
    }

    function handleActiveGesture(e) {
      e.preventDefault();
      e.stopPropagation();
      const g = activeGesture;
      const sign = CONFIG.NATURAL_SCROLL ? -1 : 1;
      g.rawOffset = Math.max(0, g.rawOffset + e.deltaX * sign * CONFIG.SENSITIVITY);
      clearTimeout(g.endTimer);
      g.endTimer = setTimeout(() => endGesture(g), CONFIG.GESTURE_END_DEBOUNCE_MS);
    }

    // Only reached when fingers lift without ever hitting full extension —
    // the commit path fires from inside tick() instead, see above. So this
    // is always a cancel/snap-back.
    function endGesture(g) {
      if (activeGesture !== g || g.committed) return;
      cancelGesture(g);
    }

    function commitGesture(g) {
      // Flag immediately so the wheel listener swallows any further events
      // from fingers still on the trackpad — without this, a second gesture
      // would start on the same row before the animation finishes, producing
      // a duplicate overlay (the "ghost" red square).
      g.committed = true;
      if (g.rafId) cancelAnimationFrame(g.rafId);

      // Same easing for both row and overlay — overlay right edge tracks
      // row left edge perfectly throughout the animation.
      const COMMIT_EASE = "cubic-bezier(.2,.8,.2,1)";
      g.row.style.transition = `transform ${CONFIG.COMMIT_SNAP_MS}ms ${COMMIT_EASE}`;
      g.overlayEl.style.transition = `width ${CONFIG.COMMIT_SNAP_MS}ms ${COMMIT_EASE}`;

      if (g.context === "queue") {
        const fullOffset = g.originalRect.width + 80;
        const leftPad = g.overlayLeft - g.originalRect.left;
        applyTransform(g, fullOffset);
        g.overlayEl.style.width = (fullOffset - leftPad) + "px";

        setTimeout(() => {
          // Stamp cooldown BEFORE nulling activeGesture so the committed-
          // swallow and the cooldown guard together cover the full gap until
          // Spotify's list collapse animation finishes.
          lastCommitTime = Date.now();
          activeGesture = null;

          // Only remove our overlay — do NOT reset the row's transform.
          // The row is currently off-screen (transform = fullOffset). Calling
          // cleanupGesture would snap it back to position 0, briefly disturbing
          // layout mid-collapse and causing the ghost overlay bug. React will
          // unmount the row itself once removeFromQueue resolves.
          if (g.overlayEl && g.overlayEl.parentNode)
            g.overlayEl.parentNode.removeChild(g.overlayEl);

          Spicetify.removeFromQueue([{ uri: g.uri }]).catch((err) => {
            console.error("[SwipeQueue] removeFromQueue failed:", err);
            Spicetify.showNotification("Couldn't remove from queue", true);
          });
        }, CONFIG.COMMIT_SNAP_MS);
      } else {
        Spicetify.addToQueue([{ uri: g.uri }])
          .then(() => Spicetify.showNotification("Added to queue"))
          .catch((err) => {
            console.error("[SwipeQueue] addToQueue failed:", err);
            Spicetify.showNotification("Couldn't add to queue", true);
          });

        applyTransform(g, 0);
        g.overlayEl.style.width = "0px";
        setTimeout(() => {
          // Same cooldown stamp as the queue-remove branch above — without
          // it, fingers still resting on the trackpad right after a commit
          // (residual/inertial wheel events) could immediately start a
          // second gesture on the row that just snapped back, leaving a
          // small stuck overlay sliver instead of a clean, settled row.
          lastCommitTime = Date.now();
          activeGesture = null;
          cleanupGesture(g);
        }, CONFIG.COMMIT_SNAP_MS);
      }
    }

    function cancelGesture(g) {
      activeGesture = null;
      if (g.rafId) cancelAnimationFrame(g.rafId);
      g.row.style.transition = `transform ${CONFIG.CANCEL_SNAP_MS}ms cubic-bezier(.2,.8,.2,1)`;
      g.overlayEl.style.transition = `width ${CONFIG.CANCEL_SNAP_MS}ms ease`;
      applyTransform(g, 0);
      g.overlayEl.style.width = "0px";
      setTimeout(() => cleanupGesture(g), CONFIG.CANCEL_SNAP_MS);
    }

    function abortGesture(g) {
      clearTimeout(g.endTimer);
      if (g.overlayEl && g.overlayEl.parentNode)
        g.overlayEl.parentNode.removeChild(g.overlayEl);
      if (activeGesture === g) activeGesture = null;
    }

    function cleanupGesture(g) {
      if (g.overlayEl && g.overlayEl.parentNode)
        g.overlayEl.parentNode.removeChild(g.overlayEl);
      if (g.row && g.row.isConnected) {
        g.row.style.transform = g.baseTransform || "";
        g.row.style.transition = "";
      }
    }

    // ---- KEYBIND (no trackpad needed) ---------------------------------------
    // Hover a row, press CONFIG.KEYBIND — same add/remove logic as the swipe,
    // just without the drag. Deliberately kept separate from the drag/overlay
    // machinery above rather than reusing it, so this can't interfere with an
    // in-progress swipe gesture on some other row.

    let hoveredRow = null;

    document.addEventListener("mouseover", (e) => {
      const row = e.target.closest(CONFIG.ROW_SELECTOR);
      if (row) hoveredRow = row;
    });
    document.addEventListener("mouseout", (e) => {
      const row = e.target.closest(CONFIG.ROW_SELECTOR);
      // relatedTarget is null when the mouse leaves the window entirely, and
      // moving to a child element within the same row shouldn't count as
      // "leaving" it -- only clear hoveredRow once the pointer is genuinely
      // outside the row's own subtree.
      if (row && (!e.relatedTarget || !row.contains(e.relatedTarget))) {
        if (hoveredRow === row) hoveredRow = null;
      }
    });

    // Quick full-row flash for feedback. Reuses the same floating overlay
    // element the drag gesture uses (createOverlay) rather than touching
    // the row's own background-color directly — Spotify applies its own
    // hover/selection background to rows (with enough CSS priority to paint
    // over a plain inline background-color, confirmed empirically), and a
    // fully independent element appended to <body> can't be hidden by that
    // no matter what Spotify's own styling does. Also avoids touching
    // `position` on the row, since some rows may rely on `position:
    // absolute` for virtualization and forcing `relative` could disturb it.
    function flashRow(row, context) {
      const rect = row.getBoundingClientRect();
      const overlay = createOverlay(context);
      const inner = overlay.querySelector(".swipequeue-overlay-inner");
      if (inner) inner.style.width = "100%"; // full-row flash, not a REVEAL_WIDTH-wide strip

      overlay.style.left = rect.left + "px";
      overlay.style.top = rect.top + "px";
      overlay.style.width = rect.width + "px";
      overlay.style.height = rect.height + "px";
      overlay.style.opacity = "0";
      overlay.style.transition = `opacity ${CONFIG.KEYBIND.FLASH_MS}ms ease-out`;

      // Force a synchronous style flush so the browser can't coalesce the
      // opacity:0 -> opacity:1 flip below into a no-op (which would skip
      // the flash-in entirely). Deliberately not requestAnimationFrame for
      // any of this sequencing — rAF is paused indefinitely while the
      // window is unfocused/hidden, which would leave this overlay stuck
      // forever; setTimeout below fires regardless of focus.
      void overlay.offsetHeight;
      overlay.style.opacity = "1";

      setTimeout(() => {
        overlay.style.opacity = "0";
        setTimeout(() => {
          if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        }, CONFIG.KEYBIND.FLASH_MS);
      }, CONFIG.KEYBIND.FLASH_MS);
    }

    function triggerRowAction(row) {
      if (activeGesture) return; // a drag is already in progress elsewhere
      if (!row || !row.isConnected) return;
      if (Date.now() - lastCommitTime < COMMIT_COOLDOWN_MS) return;

      const context = getRowContext(row);
      const uri = getTrackUriFromRow(row);
      if (!uri) {
        if (CONFIG.DEBUG)
          console.warn("[SwipeQueue] keybind: could not resolve track URI for row", row);
        return;
      }

      lastCommitTime = Date.now();
      flashRow(row, context);

      if (context === "queue") {
        Spicetify.removeFromQueue([{ uri }]).catch((err) => {
          console.error("[SwipeQueue] removeFromQueue failed:", err);
          Spicetify.showNotification("Couldn't remove from queue", true);
        });
      } else {
        Spicetify.addToQueue([{ uri }])
          .then(() => Spicetify.showNotification("Added to queue"))
          .catch((err) => {
            console.error("[SwipeQueue] addToQueue failed:", err);
            Spicetify.showNotification("Couldn't add to queue", true);
          });
      }

      if (CONFIG.DEBUG)
        console.log("[SwipeQueue] keybind triggered", { context, uri, row });
    }

    document.addEventListener("keydown", (e) => {
      const k = CONFIG.KEYBIND;
      if (!k.ENABLED || e.repeat) return;
      if (
        e.code !== k.code ||
        e.ctrlKey !== k.ctrlKey ||
        e.shiftKey !== k.shiftKey ||
        e.altKey !== k.altKey ||
        e.metaKey !== k.metaKey
      )
        return;
      if (!hoveredRow) return;

      // Don't act while the user is typing somewhere (e.g. Spotify's
      // search box), even though this combo is an unlikely thing to type.
      const tag = e.target && e.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target && e.target.isContentEditable))
        return;

      e.preventDefault();
      e.stopPropagation();
      triggerRowAction(hoveredRow);
    });

    // ---- ENTRY POINT: single delegated, capturing wheel listener -----------
    // capture:true + passive:false lets us intercept the gesture before
    // macOS/Chromium's built-in two-finger back/forward navigation fires.
    document.addEventListener(
      "wheel",
      (e) => {
        if (activeGesture) {
          if (activeGesture.committed) {
            // Commit animation is running — fingers may still be on the
            // trackpad. Swallow the event so no second gesture starts on
            // the same row before it's fully removed from the DOM.
            e.preventDefault();
            e.stopPropagation();
          } else {
            handleActiveGesture(e);
          }
        } else {
          maybeStartGesture(e);
        }
      },
      { passive: false, capture: true }
    );

    console.log(
      `[SwipeQueue] loaded (platform: ${PLATFORM}, keybind: ${CONFIG.KEYBIND.ENABLED ? "on" : "off"})`
    );
  }
})();