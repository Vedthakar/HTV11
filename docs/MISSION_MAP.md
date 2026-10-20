# Mission map

The landing page at `/`. [Back to README](../README.md)

The landing page (`web/index.html`, React + TypeScript + MapLibre GL) tracks rovers through Toronto: watch a mission **LIVE** or **REPLAY** a finished one. It uses a light-grey "point cloud" look: buildings are dotted LiDAR-style textures; the rover sheds a particle trail; and each site appears as a LiDAR ping (rings sweep out, a reticle locks on, a status chip with a mini scan thumbnail slides out). The left-hand mission log lists timestamped events (click one to seek there) under a slim play/scrub strip; the bottom-right card shows battery, signal, speed, scan progress and distance travelled. It runs on the same `npm run dev`; no API keys or paid services. Everything shown today is **demo data** (the HUD says `DEMO DATA`): two simulated rovers on street-following routes in Fort York / Liberty Village, with sites labelled by neighbourhood only.

- Controls: `Space` play/pause, `←/→` seek 30 s, `Ctrl/⌘ K` find a site or rover, `Esc` close, `N` reset north, `F` follow rover. Right-drag or Ctrl-drag rotates and tilts.
- Click a site's chip for the site panel (hazards flagged for follow-up, times, report status). "Confirm & submit report" and "View 3D scan" are stubs; submitting will later hand off to the reporting agent.
- Code: `web/src/mission/` holds types, mock data, the telemetry sources, pure track maths, mission events and the playback store; `web/src/map/` the basemap restyle, particle trail canvas (`ParticleTrail.ts`), site pings and scan thumbnails, and the imperative MapLibre controller; `web/src/components/` the React UI. Per-frame updates bypass React.
- Basemap: OpenFreeMap Liberty, forked in `web/src/map/liberty.json` and recoloured in `restyle.ts`. Hillshade uses AWS Terrarium DEM tiles. 3D terrain is opt-in with `?terrain=1`: Toronto is flat, and in MapLibre 5.6 runtime-added route lines vanish under the 3D buildings when terrain is on, so in that mode the route draws above the buildings.
- Mock routes come from `node scripts/build_mock_route.mjs`, which snaps intersection waypoints to streets with the public OSRM foot router once and writes `web/src/mission/mock-route.json`. The app never calls the router.

## Real telemetry

LIVE mode uses `MockTelemetrySource` (the demo mission re-run at 30×) unless `VITE_ROVER_TELEMETRY_URL` is set or the page is opened with `?telemetry=ws`. Then `WebSocketTelemetrySource` connects to that URL, or by default to `ws://<host>/api/rover/telemetry` (Vite already proxies `/api` with WebSockets to the backend). That endpoint does not exist yet; add it to `backend/main.py`. The source reconnects with backoff.

Send one JSON object per text message. Times are epoch ms; coordinates are `[lng, lat]`:

```jsonc
{"type": "mission", "mission": {"id": "M-1017-A", "roverId": "ROVER-01", "startedAt": 1792256700000, "plannedEndAt": 1792264509000,
  "plannedRoute": [[-79.3945, 43.6436], ...], "track": [], "color": "#C8642A",
  "sites": [{"id": "SITE-01", "label": "SITE 01", "area": "Fort York", "coord": [-79.4002, 43.6393], "status": "pending", "hazards": [], "reportStatus": "draft"}]}}
{"type": "telemetry", "missionId": "M-1017-A", "point": {"t": 1792256702000, "coord": [-79.3946, 43.6436], "heading": 254, "speed": 1.4, "batteryPct": 99.9, "signalPct": 82}}
{"type": "site", "missionId": "M-1017-A", "site": {"id": "SITE-01", "status": "inspecting", "arrivedAt": 1792257480000}}
{"type": "site", "missionId": "M-1017-A", "site": {"id": "SITE-01", "status": "hazards", "departedAt": 1792258140000, "hazards": [{"type": "Water damage", "confidence": "high"}]}}
{"type": "end", "missionId": "M-1017-A", "endedAt": 1792264509000}
```

Send `mission` first, and again after a reconnect. `site` messages are partial updates merged by `id`; status runs `pending` → `inspecting` → `cleared` | `hazards` | `failed`. `batteryPct` and `signalPct` are optional (the telemetry card shows — without them). The scan thumbnails are simulated until real scan renders are wired to `scanPreviewUrl`. Telemetry points must arrive in time order; the map interpolates between them, so 1–2 Hz is plenty. The wire format is also documented at the top of `web/src/mission/telemetry.ts`.

## Toronto dashboard and route planning

The dashboard at `/` now includes the integrated HTV civic features:
557,694 Toronto building-outline features loaded by geographic tile; apartment
score colours and location markers; selected building metadata; and an inspection
route planner using the public FOSSGIS pedestrian routing service. Use the civic
panel's **Plan inspection route** button. Default cutoff is 75, capped at eight
stops in a 2 km radius/current view, with configurable settings and GeoJSON export.
Cyan survey routes are proposals, not hardware commands; the orange mission
playback and hazard reports remain labelled demo data. Entrances and rover
clearance are not verified by pedestrian routing.

Clicking a real building stays on the map and prepares that location in **Scan
viewer**. The existing tabbed Capture Studio is embedded there, retaining LOTA
imports, live capture, rover paths, Gaussian training, notes and text labels.
No linked scans shows an empty list with **Show all scans**. Existing captures can
be attached explicitly; links persist in HTV_DATA_DIR/building-scans.json and use
the capture token. The backend must be restarted from this checkout to register
both building links and Gaussian training.

The city data resides in web/public/city; include it when deploying. Apartment
scores reflect the supplied CSV, not a live feed or structural assessment. Grey
means no score match. Records use latest evaluations by RSN and unambiguous
coordinate-in-footprint association; unmatched records remain dots. Where several
records share a footprint its colour uses the lowest score. The planner selects
lower scores and orders them heuristically, without a shortest-route guarantee.

Preparation scripts: scripts/prepare_city_tiles.py and
scripts/prepare_evaluations.py. City data: Toronto Topographic Mapping Building
Outlines and Apartment Building Evaluations. Contains information licensed under
the Open Government Licence – Toronto. External basemap: OpenFreeMap/OSM;
routing: FOSSGIS/OSRM, requiring internet and sending public waypoint coordinates.

Validation: npm --prefix web run build; npm --prefix web run typecheck;
node --test web/tests/*.test.js; Python test_building_scans.py and test_gaussian.py.

## Simulated playback of planned surveys

A successful survey plan now replaces the bundled demo mission with a SURVEY-SIM
mission. Its track uses the returned pedestrian-route geometry, stops are timed
from the route leg distances, speed is modelled at 1.2 m/s, and each visit has a
30-second simulated dwell. Playback starts automatically at the existing speed
multiplier, with follow enabled. Pause, seek and speed controls operate on this
new track; the old demo rover/path is removed. Clear/replan pauses the previous
survey. Selecting LIVE can still switch to the existing telemetry feed; REPLAY
returns to the planned survey. This remains simulation only: no scans, hazards
or safety conclusions are generated by visiting a stop.
