# Offline display

Open `/display/` once online. Successful, validated content, settings and weather
are stored independently in localStorage. Startup renders those snapshots before
network requests finish. Failed requests (including HTTP errors, invalid JSON or
invalid payloads) retain the last successful state and rotation. Requests time out
after ten seconds. The status banner identifies unconfirmed data and its last
successful fetch time, including when the clock bar is disabled. Backend weather
with `stale: true` stays explicitly marked as saved; its `updatedAt` timestamp is
preserved rather than replaced by the current fetch time. Reconnection
retries immediately; ordinary polling continues. Weather tries the server, then
Open-Meteo, then the browser snapshot. Fetch time is not weather observation time.

The `/display/sw.js` worker has scope `/display/`. On HTTPS or localhost it installs
the HTML, CSS, display script, shared renderer and both vendor scripts atomically.
After installation, reloads work offline. Same-origin raster images requested by
the controlled display from anywhere under `/uploads/` (including media-library
images such as `/uploads/foo.png`) are cached
as they are viewed (up to 150); allow a full rotation online to warm this cache.
Images seen before the first worker takes control may need another rotation.
Only successful raster MIME responses are saved, never APIs, uploaded HTML/SVG,
iframes or external resources. External fonts use system fallbacks offline.
Unvisited/evicted images and external embeds are not guaranteed offline.

Plain LAN HTTP cannot register native service workers. It still retains running
content and saves snapshots, but cannot guarantee loading the app shell after an
offline reload. The display explicitly reports this limitation. Browser storage
can be disabled, exhausted, cleared or evicted; failures are reported and never
stop the running display. Snapshots may contain expired announcements and old
calendar/birthday information; the dated banner remains visible until verified.

Shell requests use network-first with a five-second deadline covering both headers
and body, bypassing the HTTP cache. Successful responses replace the saved resource;
network errors, HTTP errors, redirects and timeouts fall back to the saved resource.
Thus editing display.js at the same v16 URL is picked up on the next online reload
without editing sw.js. Updates do not hot-reload an already running display.
If asset URLs change, update the exact allowlist/precache URLs in `sw.js` together
with `index.html`. Resources refresh independently; deploy mutually compatible
shell changes because a partially offline reload can use mixed resource versions.
A new worker waits for existing display tabs to close. No unrelated caches or
user data are deleted. Image caching remains viewed-only, with no bulk prefetch.

Run automated VM rendering and worker policy tests with:

    node --test tests/display.test.js

These tests cover generated markup and application state, not pixel layout or a
real browser's worker lifecycle. To check deployment: visit via localhost/HTTPS,
wait for worker activation, rotate through images, disable network and reload
`/display/`; verify cached rendering and dated status, then restore connectivity.
