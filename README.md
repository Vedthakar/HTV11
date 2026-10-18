# Premiere — Rover-Mounted iPhone LiDAR to an explorable 3D capture

Local starter project for an iPhone 17 Pro mounted on a robot car. Capture RGB, LiDAR depth/confidence and ARKit camera poses, upload to this Mac, build geometry, then train and view Gaussian splats. This project uses Apple's frameworks, Three.js, SparkJS, and Brush directly.

## Start on the laptop (Windows or macOS)

One-time setup (needs Python 3.12+ and Node 22+):

```bash
npm run setup                                  # .venv + backend packages + web packages
node scripts/py.mjs scripts/install_brush.py   # optional: Gaussian splat training
```

`scripts/py.mjs` runs the venv's Python on either OS, so every npm script works on Windows and macOS.
Brush is pinned per OS: 0.2.0 on Windows (v0.3.0 fails every dataset load there with "IO error ... early eof"), v0.3.0 on macOS/Linux. Training is GPU-bound: 1,500 steps on a small synthetic set took ~48 min on Intel Iris Xe, so prefer a discrete GPU or Apple Silicon for real captures.

Terminal 1: `npm run backend` (or `npm run backend:lan` for the live stream; see below)
Terminal 2: `npm run dev`

Open **http://127.0.0.1:5175** for the rover mission map; the capture studio is at **/studio.html**. Backend: http://127.0.0.1:8008/docs.

## Scan with LOTA (recommended capture path)

LOTA (LiDAR Over the Air) replaces the custom RoverCapture app. Settings for a rover-mounted phone:

1. Camera page → Point Cloud mode → **Point Cloud Settings**: Min Confidence **High Only**, Max Depth **3–4 m**.
2. Swipe right to the capture page, choose **N + Depth** (Nerfstudio + Depth; COLMAP also works), Capture Settings → Capture Rate **30 Hz**.
3. Folder icon (bottom left) → pick an iCloud Files folder. Record while driving slowly (~0.2–0.3 m/s, stop before turns). LOTA rejects motion-blurred frames and only keeps keyframes after 5 cm / 5° of motion.
4. Get the `LOTA_<timestamp>_<MODE>.zip` to the laptop and either click **Import LOTA capture**, drop it on the page, or watch the synced folder:

```bash
npm run watch -- "C:\Users\<you>\iCloudDrive\<folder>"
```

The importer (`backend/lota.py`) accepts Nerfstudio, Nerfstudio + Depth, COLMAP binary and PLY-only exports. It drops single-frame pose spikes (rover jolts), warns about permanent path jumps (tracking relocalised), removes isolated floaters, thins the cloud to 1 cm and caps it at 200,000 points for the viewer. The dataset is kept as exported so **Train Gaussian splat** can use it; PLY-only exports cannot be trained. If a real export shows up rotated (Z-up), restart the backend with `HTV_LOTA_UP=z` (this rotates the point cloud and path only; a trained splat stays in the export's axes). ZIP uploads are capped at 4 GB (`HTV_IMPORT_MAX_MB`).

Without a phone: `npm run fixtures` writes clearly marked SYNTHETIC LOTA-style ZIPs to `data/lota_fixtures/`.

### Live preview while driving (optional)

Start `npm run backend:lan`, enable **Show live point stream**, and in LOTA send the PLY point stream to `<laptop IP>`:**9848** (TCP) and OSC to **9000** (UDP). Allow both ports (and 8008) through the firewall. If LOTA only connects out to a receiver it discovers, set `HTV_LOTA_PHONE=<phone IP>:9848` to have the laptop dial the phone instead. Whether LOTA streams world- or camera-space points is undocumented: if the cloud smears when the rover turns, choose **Camera coordinates (apply pose)**. Frames are thinned to 10 fps / 8,000 points. Anyone on the network can send to these ports, so use a trusted network. This is a preview; the imported ZIP is the map. Test without a phone: `npm run simulate-live` (add `-- --space camera` for the other mode).

## Legacy: RoverCapture uploads from the iPhone

Stop the loopback backend first. In the same terminal:

```bash
export HTV_CAPTURE_TOKEN="choose-a-team-token"   # PowerShell: $env:HTV_CAPTURE_TOKEN="..."
npm run backend:lan
```

This deliberately listens on the local network on port 8008. Enter the same token in the iPhone app and the web viewer. Keep this development server on a trusted local network; don't port-forward it or expose it publicly. Upload/processing require the token when configured; read endpoints are intended for trusted teammates. HTTP is unencrypted and intended only for local development.

Phone and laptop must be on the same network. Some hackathon networks isolate clients; use a network that permits device-to-device connections.

## Install the RoverCapture iPhone app (legacy, macOS + Xcode only)

1. Open `ios/RoverCapture.xcodeproj` in Xcode.
2. Select the RoverCapture target → Signing & Capabilities → your development team. If needed, change the bundle identifier to one unique to your team.
3. Connect your iPhone, enable Developer Mode if prompted, select the phone, and Run. Xcode must support the iOS version installed on your iPhone; update Xcode if it reports the device OS is unsupported.
4. Grant camera/local-network access. Enter `http://<MAC-WIFI-IP>:8008` and your capture token.
5. Record a static scene for a short test. Capture runs at up to 2 fps and skips frames unless ARKit tracking is normal and depth is present.
6. Stop, then Upload. Select the uploaded session in the web viewer.
7. Click **Prepare geometry**, wait for `prepared`, then select the session again to load its point cloud.
8. Click **Train Gaussian splat**. Wait for `ready`, then select again to open the trained result.

The app saves first to its Documents folder, accessible through Files/Finder file sharing. Upload is after capture, not live streaming. On upload failure, local data remains; retry creates a new server session. Backgrounding/interruption stops the scan to avoid silently mixing tracking coordinates.

## First successful capture

Start handheld before attaching to the rover. Use a textured, static scene with diffuse lighting, slow movement, substantial overlap, and several viewing angles. Keep the rear camera and LiDAR unobstructed. A straight forward-facing drive cannot capture surfaces behind objects or around unseen corners. ARKit can drift; tracking quality does not guarantee an accurate reconstruction.

## What is implemented

- Native SwiftUI/ARKit app: local images, raw depth/confidence, camera calibration/poses, upload.
- FastAPI: sessions, bounded per-file streaming uploads, optional shared token, single-job processing queue, explicit errors and artifacts.
- Python exporter: row-stride-free depth, confidence filtering, ARKit → world point cloud, ARKit → COLMAP camera conversion, COLMAP-format dataset and transforms.json.
- Browser: real PLY point-cloud loader and SparkJS Gaussian-splat viewer, session status, fit/orbit/pan/zoom, local file import.
- Brush runner: 1,500-step low-resolution first pass, output and log saved per session.

## What still needs hardware work

- iPhone signing/install and an end-to-end scan on your physical phone.
- Assessment of actual camera tracking, reconstruction quality, and processing time.
- Car motor control, remote driving, collision avoidance, autonomous exploration, wheel odometry.
- Live streaming and continuous reconstruction. This version is capture → upload → process.

No autonomous-car code is invented without your controller/motor hardware. You can manually drive an existing car while the phone records.

## Architecture

```
ios/RoverCapture/              SwiftUI interface, ARKit recorder, local storage, uploader
backend/main.py                FastAPI routes and background job coordination
backend/capture.py             Coordinate conversion and dataset preparation
web/src/main.js                Three.js point/splat rendering and session controls
scripts/demo_capture.py        Explicitly synthetic fixture (never shown as a real scan)
tests/test_pipeline.py         Geometry-convention, corrupt-input, upload, and job tests
data/sessions/<id>/            Raw capture, dataset, cloud.ply, scene.ply, train.log
```

The capture format uses `frame_000001.jpg`, `.depth`, `.confidence`, `.json`. JPEG is saved in the camera buffer's raw orientation. Matrices are serialized row-major; the camera transform is ARKit camera-to-world (+x right, +y up, -z forward). Depth is contiguous little-endian float32 in metres; confidence is uint8 (0/1/2). Image and depth calibration are scaled consistently. The COLMAP export inverts poses and flips camera y/z. Don't rotate JPEGs independently of their intrinsics/poses.

`transforms.json` is a convenient alternate export. The dataset's `images/` and `sparse/0/` hold COLMAP-format cameras and LiDAR initialization points. Large captures are capped to 200,000 sampled geometry points; this is not a watertight mesh, certified measurement, or collision map.

## Checks

```bash
npm test
npm run build
xcodebuild -project ios/RoverCapture.xcodeproj -scheme RoverCapture -sdk iphoneos -configuration Debug -derivedDataPath .build/ios CODE_SIGNING_ALLOWED=NO build
```

`npm run demo` adds a clearly marked **SYNTHETIC TEST CAPTURE** to verify geometry/viewer plumbing without a phone. It is a small planar checkerboard, not a real room reconstruction. Remove its directory under `data/sessions/` when no longer needed.

## Reinstall dependencies

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
npm --prefix web ci --cache "$PWD/.npm-cache"
```

Brush is optional for point clouds. The installed release's `--help` is saved in `tools/brush-help.txt`. Set `BRUSH_BIN` to use a different executable. Training progress/errors are in `data/sessions/<id>/train.log`; the server marks failures instead of displaying synthetic content as success.

## References
- Brush: https://github.com/ArthurBrussee/brush (Apache-2.0; bundled release notices under tools/brush/)
- SparkJS renderer: https://sparkjs.dev/docs/
- ARKit: https://developer.apple.com/documentation/arkit

A Gaussian splat is a visual reconstruction; autonomous navigation requires a separate mapping/planning/control system.

## Verification in this setup session

- Four pipeline tests passed (known geometry/pose conversion, missing/corrupt depth, authenticated uploads and background preparation).
- Vite production build passed.
- Xcode unsigned device build passed with the installed iOS 18.1 SDK. Deployment to an iPhone 17 Pro running newer iOS may require updating Xcode.
- Browser loaded and rendered the synthetic point-cloud fixture.
- Official Brush v0.3.0 binary checksum verified; CLI help runs. A five-step training smoke test could not start: this restricted execution environment exposed no Metal GPU adapter. Run training from your normal Terminal to determine hardware compatibility. End-to-end real capture and Gaussian training quality remain unverified.

## Rover mission map (operator tracking view)

The landing page (`web/index.html`, React + TypeScript + MapLibre GL) tracks rovers through Toronto: watch a mission **LIVE** or **REPLAY** a finished one. It uses a light-grey "point cloud" look: buildings are dotted LiDAR-style textures; the rover sheds a particle trail; and each site appears as a LiDAR ping (rings sweep out, a reticle locks on, a status chip with a mini scan thumbnail slides out). The left-hand mission log lists timestamped events (click one to seek there) under a slim play/scrub strip; the bottom-right card shows battery, signal, speed, scan progress and distance travelled. It runs on the same `npm run dev`; no API keys or paid services. Everything shown today is **demo data** (the HUD says `DEMO DATA`): two simulated rovers on street-following routes in Fort York / Liberty Village, with sites labelled by neighbourhood only.

- Controls: `Space` play/pause, `←/→` seek 30 s, `Ctrl/⌘ K` find a site or rover, `Esc` close, `N` reset north, `F` follow rover. Right-drag or Ctrl-drag rotates and tilts.
- Click a site's chip for the site panel (hazards flagged for follow-up, times, report status). "Confirm & submit report" and "View 3D scan" are stubs; submitting will later hand off to the reporting agent.
- Code: `web/src/mission/` holds types, mock data, the telemetry sources, pure track maths, mission events and the playback store; `web/src/map/` the basemap restyle, particle trail canvas (`ParticleTrail.ts`), site pings and scan thumbnails, and the imperative MapLibre controller; `web/src/components/` the React UI. Per-frame updates bypass React.
- Basemap: OpenFreeMap Liberty, forked in `web/src/map/liberty.json` and recoloured in `restyle.ts`. Hillshade uses AWS Terrarium DEM tiles. 3D terrain is opt-in with `?terrain=1`: Toronto is flat, and in MapLibre 5.6 runtime-added route lines vanish under the 3D buildings when terrain is on, so in that mode the route draws above the buildings.
- Mock routes come from `node scripts/build_mock_route.mjs`, which snaps intersection waypoints to streets with the public OSRM foot router once and writes `web/src/mission/mock-route.json`. The app never calls the router.

### Real telemetry

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

## Inspection observations

Restart the backend after updating the code (Ctrl+C, then `npm run backend:lan` in the same terminal to retain your token environment). Refresh the browser.

1. Select a saved capture and prepare geometry if needed.
2. Open its point cloud. If viewing a splat, use **Open point cloud for placement**.
3. Choose **Add observation**, then click a captured surface. Dragging does not create a pin; Escape cancels placement.
4. Enter a title/description and optionally select an original capture photo. Photo association is manual; check the image actually documents the pin location.
5. Save. Click the marker or its list entry to edit it and select **Unreviewed**, **Confirmed observation**, or **Dismissed**.
6. Reload and reselect the session: records and pins are restored from `data/sessions/<id>/observations.json`.

Local PLY files can be viewed but must belong to a saved server session before persistent observations can be created. Pins can be viewed over splats in that session's shared coordinates; placement uses the LiDAR point cloud. Original capture photos can be opened at full size from the evidence preview. A confirmed observation records review of a visible feature; it is not a structural-safety determination.

New modules: `web/src/pins.js` (Three.js picking/markers), `web/src/observations.js` (form/state/API), `backend/observations.py` (validated routes, atomic JSON storage, original-photo endpoints).

Observation verification: four additional API tests cover disk persistence with a fresh router, token/field validation, source-photo scope, and cross-session isolation. Browser QA on isolated synthetic data covered placement, save, reload, status edit, evidence preview, and clicking a 3D marker. Existing real captures were not modified by QA.

## Parameter-built proposed house (feature 2)

In the sidebar, enable **Show proposed house**. Sliders update width (3–16 m), depth (3–20 m), floors (1–3), and roof height (0.4–4 m). Change wall colour or include/remove the front porch. **Focus house** frames the proposal; **Fit view** frames both scan and proposal. **Reset house dimensions** restores defaults.

The model is built by `buildHouse(parameters)` in `web/src/house.js` from boxes, window frames/panes, a triangular extruded roof, and optional porch geometry. It lives in its own Three.js group and is automatically previewed beside the scan at the scan bounding box's lowest Y value. That is a preview anchor, not a detected ground plane or surveyed placement. Parameters stay while switching scans but reset on page reload. Floor height is fixed at 2.8 m.

The proposed house has no AI, interior rooms, construction plans, or building replacement. Feature 3 adds the placement and comparison tools described below. The house can also be previewed before loading any scan. Observation pins remain attached to the captured point cloud, not the proposed house.

## House placement and comparison (feature 3)

Enable **Show proposed house**, then use the controls under **Placement**:

- X / Z move across scan coordinates; Y raises or lowers the house.
- Rotation turns the house around its vertical axis.
- Uniform scale multiplies the whole house (0.1–5); the scaled footprint/height readout updates accordingly.
- **Move gizmo** attaches draggable arrows/planes; **Rotate gizmo** shows a vertical-axis rotation ring. Orbit controls pause during a gizmo drag. Click **Finish placement**, toggle the active tool, or press Escape to return to normal exploration.
- **Reset placement beside scan** restores the automatic preview anchor, rotation 0, and scale 1. It does not change house dimensions.
- Changing house dimensions preserves manual placement. Switching between point cloud and splat in the same session also preserves placement. A different capture resets the anchor; page reload resets the design and placement.

View modes share the same camera, which does not move when toggling:

- **Existing**: captured scene and observation pins; proposed house hidden.
- **Proposed**: captured scene plus solid proposed house.
- **Compare**: wireframe/translucent proposal plus footprint over the unchanged capture. This is an overlay comparison, not a split screen.

No captured building is removed, and no ground plane is automatically inferred. Scan scale/alignment needs verification before treating proposal dimensions or placement as surveyed values. Placement changes affect only the proposed group, not the source geometry or saved observations.

The viewer uses Three.js TransformControls. Observation placement and house-gizmo editing are mutually exclusive to avoid accidental note placement while moving a house.

### Replacement region (feature 5)

Load a scan, enable **Show proposed house**, then enable **Hide capture inside a box**.
Use the orange outline and Center X/Y/Z plus Width/Height/Depth fields to enclose
what should disappear. **Fit box to proposed house** copies the current proposal's
world bounding box; **Fit box to entire scan** selects all captured geometry.
The region stays fixed when the house moves. Existing restores the original;
Proposed and Compare hide the selected capture region. Observation markers within
the hidden region are also hidden, while their saved notes remain available.

This is an axis-aligned visual cutout, not semantic building removal: everything
inside is hidden, including ground. It supports point clouds through a separate
indexed preview geometry and Gaussian splats through Spark's box opacity edit.
Gaussian edges can extend across the boundary. Original capture files remain
unchanged. Regions reset for a different capture and on page reload.

Verify region filtering and restoration with:

```sh
node --test web/tests/replacement.test.js
```
