# Vessels: live AIS positions, last sailing route, and the layout changes around them

This document records everything built for the two vessel features — the marker that
shows where a ship is now, the "last sailing route" playback with its 10-minute
marks, and the controls and layout changes those two things required.

It is written to be read before touching the code. Several of the decisions here are
counter-intuitive and were arrived at by measurement, not by preference; the
"why" is recorded next to each one so a future change does not undo a fix.

---

## 1. The vessels

| Vessel | MMSI | IMO | Colour on the map |
| --- | --- | --- | --- |
| NGON SHUEN II | `477997242` | 1046453 | `#38bdf8` (sky) |
| LAI WAN II | `477997306` | 1046465 | `#f472b6` (pink) |

Both are waste carriers working Hong Kong waters. They are **not** in the EPD
register — the 19 facilities in `src/data/waste-facilities.ts` are sites, and a ship
is a moving object with none of a site's properties (no category, no metrics, no
id). That distinction is the root cause of the crash described in §8.

Colours live in `VESSEL_COLORS` in `src/lib/vesselTracks.ts`, not in the map
component, because two places need the same value: the map draws the hull and the
route with it, and the vessel picker lists the ships with it. A picker swatch that
does not match the route it selects is worse than no swatch at all. The hues were
chosen to avoid the facility category colours (red / green / emerald / amber /
violet) so a ship can never be mistaken for a site.

---

## 2. Where the data comes from

Every point on a route is a real AIS position report the vessel broadcast, received
through **AISStream.io**. Nothing is interpolated in the data file, smoothed, or
invented. The only derived values are the interpolation helpers in §5, which place
the hull *between* two recorded reports so the animation reads as motion rather than
as a dot hopping from report to report.

Four AISStream behaviours shaped the design and are worth knowing before debugging:

1. **`FiltersMMSI` is silently ignored.** The subscription accepts only
   `BoundingBoxes` and `FilterMessageTypes`. A filter by MMSI is sent, accepted, and
   then has no effect — every vessel in the box arrives. MMSI filtering therefore
   happens client-side in the collector. Do not "fix" this by trusting the filter.
2. **Real-time only.** There is no history endpoint. A track exists only because
   someone was listening while the ship sailed.
3. **Browser connections are forbidden.** The API key must stay server-side, which
   is why collection runs on a machine, not in the page.
4. **`MetaData.latitude` / `longitude` are lowercase.** The position report body
   uses `Latitude` / `Longitude`; the envelope does not. Mixing them yields
   `undefined` coordinates that survive a surprising distance before failing.

The relay rate is roughly **one report per vessel per minute**, and a moored vessel
often sends nothing at all for long stretches.

---

## 3. The pipeline

```
AISStream WebSocket
        │  scripts/collect-ais.mjs        (npm run ais:collect, local, needs the key)
        ▼
src/data/vessel-tracks/tracks.json        (committed — this is how Vercel gets it)
        │  imported directly, not fetched
        ▼
src/lib/vesselTracks.ts                   (VESSEL_TRACKS + sampling helpers)
        │
        ▼
WasteMap3D.tsx                            (deck.gl layers, hover, click)
```

The JSON is **committed** for the same reason the weighbridge aggregates are: the
deployed site is static, so the file it imports is the file that ships. Collection
runs locally, and a push publishes whatever was collected.

`src/lib/vesselTracks.ts` imports the JSON statically rather than fetching it. It is
a few kilobytes and it is needed before the first paint of the overlay; a fetch would
add a waterfall for no benefit.

A track with **fewer than two points is dropped** at load. A single point cannot
define a route, and a vessel that has never been seen moving should simply not appear
rather than appear as a marker with a disabled toggle behind it.

---

## 4. The collector — `scripts/collect-ais.mjs`

```bash
npm run ais:collect                      # collect until Ctrl-C
npm run ais:collect -- --minutes 90      # stop and save after 90 minutes
npm run ais:collect -- --retain-hours 48 # keep a longer window than 24 h
npm run ais:status                       # print what is on file, change nothing
```

Requires `AISSTREAM_API_KEY` in the gitignored `.env`.

Two filters decide what is kept:

| Constant | Value | Why |
| --- | --- | --- |
| `MIN_MOVE_M` | **5 m** | Was 15 m. At 15 m a slow or moored vessel produced a track so short it could only be drawn as a straight segment. 5 m keeps genuine manoeuvring — a berth shift, a slow swing — while still rejecting GPS jitter, which is typically 1–3 m. |
| `MAX_AGE_MS` | 10 min | A stale replay is not a real sighting. |

`--minutes` is what makes an unattended run safe: the socket closes, the file is
written, the process exits. Without it the process runs until interrupted, and an
interrupted run that never reaches `stop()` saves nothing.

---

## 5. Retention: a rolling 24 hours

`DEFAULT_RETAIN_HOURS = 24`. Every save drops points older than the window, so the
file always holds *at most* a day — which is exactly what the map's time search
covers.

**The cutoff is anchored to each vessel's newest point, not to `Date.now()`.** This
is deliberate and was a near-miss: a `Date.now()`-anchored prune on a file last
written two days ago deletes the entire recording the first time the collector is
started, because every point is older than 24 hours relative to now. Anchoring to the
newest point means the window slides only as far as the data actually reaches, so
starting a collector after a pause *adds* to the old track instead of wiping it.

Retention is rolling, which has a real consequence: **if collection is not re-run,
the file ages out.** Once the newest report is more than a day old the map shows no
vessels at all — not an error, just an empty overlay, because there is no honest
position to draw.

`VESSEL_RETENTION_MS` in `src/lib/vesselTracks.ts` mirrors the same 24 hours for the
client-side span calculation. Keep the two in step.

---

## 6. The data layer — `src/lib/vesselTracks.ts`

| Export | Purpose |
| --- | --- |
| `VESSEL_TRACKS` | Tracks that can be drawn, points re-sorted by timestamp. AIS delivery order is not guaranteed and the interpolation assumes monotonic time. |
| `VESSEL_COLORS` / `vesselColor(mmsi)` | The single source of hull and route colour. |
| `trackSpan(track)` | First and last report, epoch ms. |
| `trackDurationMs(track)` | Recorded duration. |
| `sampleAt(track, ms)` | Position at an arbitrary moment **plus the two reports it sits between** (`fromT` / `toT`). |
| `positionAtTime(track, ms)` | `sampleAt` without the bracket — convenience for the animation. |
| `sampleTrack(track, from, to, step)` | The regular dots: every `step` across a window, aligned to the clock. |
| `trailBefore(track, now, trailMs)` | The wake polyline behind the animated hull. |
| `trackLengthKm(track)` | Straight-line length of the recording. |
| `VESSEL_RETENTION_MS` | 24 h, mirrors the collector. |

`sampleAt` returns **null outside the recorded span**. Nothing extrapolates: the
timeline never shows the ship somewhere it was not observed. Two consequences follow
— the animation stops at the ends of the recording instead of sailing off-screen, and
the time search cannot be dragged into empty time.

The `fromT` / `toT` bracket is not decoration. Because reports are minutes apart,
most moments on the timeline fall *between* two of them, so anything presenting a
position at a chosen time must be able to say which two measurements it came from
rather than implying the ship was seen there. The dot tooltip uses exactly this — see
§9.

`sampleTrack` aligns its first mark to the step boundary
(`Math.ceil(lo / stepMs) * stepMs`) rather than to the track start, so a 10-minute
step lands on :00, :10, :20 … and the times read as a clock instead of as "eleven
minutes after the ship left". The window is intersected with the recorded span first;
there is no mark outside the data.

---

## 7. The map overlay — `WasteMap3D.tsx`

Three props drive everything:

```ts
showVesselRoutes?: boolean
visibleVesselMmsis?: string[]
vesselWindow?: { from: number; to: number } | null
```

Constants:

| Constant | Value | Meaning |
| --- | --- | --- |
| `VESSEL_SIZE_PX` | 46 | Hull icon size, matched to `PIN_SIZE_PX`. |
| `VESSEL_ICON_SIZE` | 64 × 64, anchor 32/32 | The icon canvas; the silhouette fills only part of it. |
| `VESSEL_MARK_STEP_MS` | 10 min | Spacing of the dots along the route. |
| `VESSEL_TRAIL_MS` | 12 min | Length of the wake behind the animated hull. |
| `VESSEL_TIME_SCALE` | 60 | 1 real second plays 60 seconds of track. |
| `VESSEL_FRAME_MS` | 33 | Repaint throttle for the playback. |
| `VESSEL_COG_MIN_KN` | 1 kn | Below this, the broadcast course is not trusted (see §8). |

### Layers, per selected vessel

| Layer id | Type | What it draws |
| --- | --- | --- |
| `vessel-route-<mmsi>` | `PathLayer` | The recorded route, 2 px, alpha 110. Vertices are the real reports inside the window, closed at both edges by interpolation — so narrowing the time search shortens the line without inventing a bend in it. |
| `vessel-wake-<mmsi>` | `PathLayer` | The last `VESSEL_TRAIL_MS` behind the animated hull, 3 px, alpha 240. This is what makes the motion read as continuous. |
| `vessel-dot-<mmsi>` | `ScatterplotLayer` | The 10-minute marks: radius 2.6 px, white 0.9 px stroke, `pickable`. |
| `vessel-icon-<mmsi>` | `IconLayer` | The hull itself, `billboard: true`, `pickable`. Always drawn when a track exists, with or without the route. |

`TripsLayer` is **not** installed (`@deck.gl/geo-layers`) and must not be added: the
project's `node_modules` has to match `package-lock.json` exactly, and the wake is a
computed `PathLayer` that does the same job. See the note in
`.workbuddy-ai/memory/MEMORY.md`.

The geometry is memoised on `[visibleVesselMmsis, vesselWindow]`, **not** recomputed
per frame. The animation only re-samples a position; the dots are resampled only when
the selection or the time window changes.

### The two markers, and why there are two behaviours on one icon

A marker sits on the vessel's **last recorded report** whenever a track exists — that
is the default view, "where the ships are now". Switching the route on makes the same
icon ride the interpolated position through the selected window instead. Two
behaviours, one layer, one switch: `showVesselRoutes`.

### `focusVessels()`

Called when the route is switched on. Frames the bounding box of every point in the
selected window of the *visible* vessels only — framing a hidden ship would fly the
camera to empty water — with `padding: 90`, `pad: 0.25`, `bearing: 0`, `pitch: 0`,
`maxZoom: 14`.

Two details that are load-bearing:

- **`pitch: 0`.** The routes are flat lines on the sea; a pitched camera foreshortens
  them into the water and makes a correct route look wrong.
- **`maxZoom: 14` is the true tight fit.** It was measured against the actual extent.
  Do not "correct" it by hand.

`focusVessels` reads `vesselGeometryRef.current`, not the props. The imperative handle
is memoised on `[facilities]`, so a closure over `visibleVesselMmsis` would always see
the value from the first render — the handle would frame the vessels selected when the
map mounted, forever.

The fly is triggered from a `useEffect` on `showVesselRoutes`, **not** inside the
`setState` updater. React double-invokes updaters in development, which would fire the
camera move twice.

---

## 8. Heading: two separate bugs, both measured

The hull points along its course. Getting that right took two fixes, and neither was
visible from the code alone.

### Bug 1 — a stopped ship broadcasts a stale course

NGON SHUEN II reported COG **195°** at **SOG 0.0 kn** while its track ran **328°**.
The AIS course field keeps its last value when the vessel stops, so drawing it raw
leaves a moored ship pointing sideways across its own route.

`headingFor()` decides which source to trust:

```ts
const VESSEL_COG_MIN_KN = 1;

function headingFor(track, course, sog, fromT, toT): number {
  if (sog != null && sog >= VESSEL_COG_MIN_KN && course != null) return course;
  const a = track.points.find((p) => p.t === fromT);
  const b = track.points.find((p) => p.t === toT);
  if (a && b && (a.lng !== b.lng || a.lat !== b.lat)) {
    return bearingDeg([a.lng, a.lat], [b.lng, b.lat]);
  }
  return course ?? 0;
}
```

Above 1 kn the broadcast course is real. Below it, the direction between the two
reports that bracket the sample is the honest answer, with the broadcast course as the
last resort.

### Bug 2 — a billboard icon rotates in screen space

`IconLayer` with `billboard: true` rotates in **screen** space, not in the ground
plane. The landing view is rotated by `HK_BEARING = -18°`, so a north-heading hull was
drawn 18° off true — exactly the map bearing. A north-up test cannot catch this, which
is why the verification suite checks the heading at map bearing 0 **and** −18.

```ts
// AIS course is clockwise from north and deck.gl angles are
// counter-clockwise, hence the negation. The bearing is subtracted first
// because a billboard icon rotates in screen space.
getAngle: (d) => bearing - (d.course ?? 0),
```

The map bearing is tracked in state (`map.on("rotate", handleBearing)`, rounded to whole
degrees, with an identity guard so a rotate event that does not change the integer does
not re-render). It has to be a dependency of the layer memo.

After both fixes, the measured error is **0.1–0.4°**.

### The silhouette

Sharp bow, parallel sides, flat transom, symmetric about `y = 32` so the icon's anchor
is the vessel's centre:

```svg
<path d="M32 6 C37 16 40 25 40 33 L40 58 L24 58 L24 33 C24 25 27 16 32 6 Z" … />
```

Icons are cached by colour in `VESSEL_ICON_CACHE` and built as data URIs.
`loadOptions: { image: { type: "image" } }` is required: SVG sources can come back
blank when luma.gl decodes them through `ImageBitmap`.

The boat fills only ~16 × 43 of the 64 × 64 canvas, and deck.gl draws icons in the
ground plane, so at the default 50° pitch a 30 px icon measured about 11 px tall — a
poor hover target. 46 px matches the facility pins and gives a usable hit area.

---

## 9. Hover and click

`handleHover` branches on the **layer id**, because the vessel layers share one overlay
with the facility layers:

```ts
if (info.layer?.id?.startsWith("vessel-dot-"))  → { dot: … }
if (info.layer?.id?.startsWith("vessel-icon-")) → { vessel: … }
otherwise                                       → { facility: … }
```

`hovered` is a union of facility / vessel / dot, and each renders its own tooltip.

**Marker tooltip** — name, MMSI, position, the time of the AIS report it sits on, and
SOG:

```
NGON SHUEN II  WASTE CARRIER · MMSI 477997242
22.32753, 114.14135
AIS report 24/10 20:43 · 0.0 kn
```

**Dot tooltip** — leads with the mark's own time, then says which two reports it was
interpolated between:

```
24/10 19:40
NGON SHUEN II · MMSI 477997242
22.29903, 114.13111
Between reports at 24/10 19:38 and 24/10 20:26 (interpolated)
0.0 kn
```

That last line is the point. A dot every ten minutes is a *sample*, not an
observation, and the tooltip says so rather than letting the dot imply the ship was
seen there.

All times are **local** (`DD/MM HH:mm` via `formatVesselTime`), matching the time
search inputs, which are `datetime-local`.

### Click — the crash and its fix

`handleClick` originally forwarded every pick to `onSelectFacility`. A `VesselMarker`
has no `id`, `category` or `metrics`, and the facility drawer dereferences all three,
so clicking a ship unmounted the page: *"Application error: a client-side exception has
occurred"*.

Two guards now exist, and both should stay:

```ts
// 1. in handleClick — anything from a vessel- layer is handled here
if (info.layer?.id?.startsWith("vessel-")) {
  const { position } = info.object as VesselMarker | VesselDot;
  onSelectFacility(null);                       // clear any open site
  mapRef.current?.flyTo({ center: position, zoom: 14.5, duration: 1200, essential: true });
  return;
}

// 2. in handleSelect — the boundary guard, independent of layer ids
if (typeof facility.id !== "string") return;
```

The second guard is not redundant. It is the one that survives a future layer being
added without a matching branch — the failure mode is a blank page, so it is worth
paying for twice.

Clicking a ship therefore does not open the drawer. It clears whatever site was open
and frames the ship.

---

## 10. The state model — three switches, three jobs

State lives in `src/app/page.tsx`; `page.tsx` remains the single source of truth.

| State | Default | Job |
| --- | --- | --- |
| `visibleVessels: string[]` | `[]` | Which vessels exist on the map at all. |
| `vesselWindow: {from,to} \| null` | `null` (= whole recording) | Which stretch of the recording the time search selected. |
| `showVesselRoutes: boolean` | `false` | Whether to draw the route, its marks, its wake and the playback, on top of the marker. |

**Vessels are hidden by default.** This is a map of waste facilities first; the ships
are an overlay the user opts into. A first-time visitor should not have to work out
what two hulls in the harbour are.

Rules that keep the three consistent:

- Turning the **last** vessel off also sets `showVesselRoutes` to `false`. Leaving the
  route switch on with nothing to draw would offer a control that does nothing.
- The route toggle in the legend is **disabled** while `visibleVessels.length === 0`,
  with a title explaining why (`vesselRouteNeedsVessel`) rather than silently failing.
- `recordedSpan` is the union of all track spans, memoised once. `vesselWindow ===
  null` means "the whole recording", which *is* the 24-hour view — and unlike a window
  computed from `Date.now()` at mount, it does not go stale while the page sits open.
- `setWindowBound` swaps the bounds when a half-edited input inverts the range, so
  dragging "from" past "to" widens the window instead of emptying it.

---

## 11. Layout changes

### 11.1 The vessel switch, beside the font control

`renderControls(floatingPicker: boolean)` renders, left to right: font size, vessel
switch, map style, and the rest. The vessel switch sits immediately right of the font
control because both answer "what is on the map".

It is a `Ship` icon plus a **count that is always visible** — `Vessels 0` reads as a
state; a bare icon with no count reads as a button that is not working. It is tinted
sky when at least one vessel is on.

`renderVesselPicker(floating)` is defined **once** and rendered in two shapes:

```ts
floating ? "absolute right-0 top-full z-50 mt-2 w-64" : "mt-2 w-full"
```

- **Desktop (`display-toolbar`)**: `renderControls(true)` → a `right-0` popover.
- **Phone (`display-toolbar-phone`)**: `renderControls(false)` plus
  `{vesselMenuOpen && renderVesselPicker(false)}` rendered **inline**, so the header
  card grows instead.

### 11.2 Why the phone picker is inline — the −98 px bug

On a 390 px viewport the popover rendered at **x = −98**: a 16 rem `right-0` panel
anchored to a button sitting near the left edge of a narrow card. It hung off the left
of the screen.

The first attempt was a measured `fixed` anchor, which was wrong for two reasons that
compound: the header's `backdrop-blur` makes it a **containing block** *and* a
**stacking context**. A `fixed` child is positioned relative to the blurred card, not
the viewport, and a full-screen dismissal backdrop is trapped underneath it.

The fix was to stop fighting the stacking context: render the picker inline on phones
(the card grows, the layout reflows) and keep the popover only from `md` up. Dismissal
uses a document-level `pointerdown` listener plus Escape, filtered by
`closest("[data-vessel-menu]")` — not a backdrop element.

Measured afterwards: 344 × 146 at x = 23 in a 390 px viewport, and inside the header
card at 320, 360 and 390 px.

### 11.3 The legend

"Last sailing route" stays in the Legend, and draws only for the vessels selected in
the switch. Its swatch shows the selected vessel's own colour when exactly one is
selected, so it matches the route on the map; with two selected it falls back to the
sky tint.

The **time search** appears inside that block, only while `showVesselRoutes` is on —
narrowing a window with nothing drawn is a dead control. Two `datetime-local` fields,
bounded by `min` / `max` to the recording, since a window outside it can only ever be
empty.

**The legend was 432 px tall and is now 412 px.** The cause was two half-width fields,
each row mostly empty. The fix was inline label-beside-field layout (138 px fields on
one row, 24 px gap) and merging two footer lines into a single `legendPillarNote`.
`_vesselmobile.mjs` asserts the height, the field widths and that both fields share a
row, so this cannot silently regress.

### 11.4 Two toolbars in the DOM

Both display toolbars are present at every width; only one is visible. Any test that
queries `[data-testid="vessel-toggle"]` unscoped will hit a **Playwright strict-mode
violation** — two matches. Always scope to `display-toolbar` (desktop) or
`display-toolbar-phone` (phone).

---

## 12. i18n

New keys in `src/lib/i18n.ts`, each in both languages:

`vessels`, `vesselsHint`, `vesselsNone`, `vesselsShowAll`, `vesselRoute`,
`vesselRouteNeedsVessel`, `timeSearch`, `timeFrom`, `timeTo`, `timeReset`,
`timeEmpty`, `legendPillarNote`.

---

## 13. Verification

All suites honour `BASE` and run against a dev server or against production.

```bash
BASE=https://hkwastemap.vercel.app \
PW_PATH="C:/Users/Ansum/.workbuddy-ai/binaries/node/pwtest/node_modules/playwright-core/index.js" \
"C:/Users/Ansum/.workbuddy-ai/binaries/node/versions/22.22.2-6/node.exe" scripts/_vesselnew.mjs
```

| Script | Checks | Covers |
| --- | --- | --- |
| `_vesselnew.mjs` | 22 | Hidden by default, picker, route toggle, dots, dot tooltip, time search |
| `_vesselclick.mjs` | 7 | The click crash, no drawer, framing, hover after click |
| `_vesselmobile.mjs` | 14 | Picker inside the viewport at 320/360/390, legend height and field widths |
| `_vesselheading.mjs` | 5 | Hull orientation at map bearing 0 **and** −18 |
| `verify-browser.mjs` | 151 | Whole app |
| `verify-api.mjs` | 112 | Whole API (defaults to port 3000 — always set `BASE`) |

`_vesselheading.mjs` is worth understanding, because orientation cannot be eyeballed.
It crops a region around the marker, takes the **principal axis of the vessel-coloured
pixels** via second moments, and compares it with the bearing between the last two
reports, folded to 0–180. It reports the pixel count it measured on, so a false pass
from an empty crop is visible in the output.

Two harness notes that cost real time:

- `_playwright.mjs` passes `--enable-unsafe-swiftshader`; without it MapLibre never
  paints headless and every pixel probe reads zero.
- **Close the legend before any map pixel probe.** The sheet is a real overlay — a
  collapsed 133 × 42 pill, open ~523 × 352, the same DOM element. Presence is not
  openness; test `height > 200`. Three "false failures" came from sampling the dots
  through the legend and reading flat `(27, 40, 56)`.
- After a camera move, **re-project** screen coordinates. Anything captured before
  the move is stale.

Totals at the time of writing: `_vesselnew` 22/22, `_vesselclick` 7/7, `_vesselmobile`
14/14, `_vesselheading` 5/5, `verify-browser` 151/151, `verify-api` 112/112,
`tsc --noEmit` clean.

---

## 14. Known limits

**The route is a straight line because the ships are moored.** Probes of the live
feed found **0 raw `PositionReport`s in 60 s**, and a later 75 s probe found NGON SHUEN
II sending 2 reports at **SOG 0**. The recording holds 6 reports over 65 minutes (4 for
NGON SHUEN II, 2 for LAI WAN II). Between two points that are not moving, a straight
chord is the only honest rendering — a curve would be invented. Mitigations, not
fixes: `MIN_MOVE_M` 15 → 5 m, a dot on every real report and every 10-minute mark, and
legend text stating the report count.

**There is no history beyond what has been collected.** The app has the *capacity* for
24 hours (retention, time search, sampling) but only ~65 minutes has ever been
recorded, because collection has never been left running for a day. This cannot be
fixed in code: run `npm run ais:collect` while the ships are working, then commit
`tracks.json`. A day of collection is what makes the time search meaningful.

**Retention is rolling.** With no collection, the file ages out and the map returns to
no vessels once the newest report is a day old. That is correct behaviour, not a bug,
but it means `tracks.json` should be refreshed before a demo.

**Times are local, everywhere.** `datetime-local`, `formatVesselTime` and the tooltips
all use the viewer's timezone. The AIS file stores epoch milliseconds and UTC is never
displayed.

---

## 15. Quick reference — where to change what

| To change | Edit |
| --- | --- |
| Which vessels are tracked | `VESSELS` in `scripts/collect-ais.mjs` |
| Vessel colours | `VESSEL_COLORS` in `src/lib/vesselTracks.ts` |
| Retention window | `DEFAULT_RETAIN_HOURS` (collector) **and** `VESSEL_RETENTION_MS` (client) |
| Dot spacing | `VESSEL_MARK_STEP_MS` |
| Playback speed / wake | `VESSEL_TIME_SCALE`, `VESSEL_TRAIL_MS` |
| Hull size | `VESSEL_SIZE_PX` |
| Default selection | `useState` defaults in `src/app/page.tsx` |
| Toolbar order | `renderControls` in `src/app/page.tsx` |
| Tooltip wording | the `hovered` render block in `WasteMap3D.tsx` |

After any change: `npm run typecheck`, then the four `_vessel*.mjs` suites, then
`verify-browser` and `verify-api` with `BASE` set.
