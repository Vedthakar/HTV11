# Capture studio

The studio at `/studio.html` loads captures and adds inspection and design tools. [Back to README](../README.md)

## Viewing a scan

Point clouds load from PLY and Gaussian splats load through SparkJS. Orbit with drag, pan with right-drag, zoom with scroll; **Fit view** frames the scan.

- **Point size** follows the scan's bounding-box diagonal, so a small room and a whole street both read clearly. The **Point size** slider scales it from 40% to 250%.
- **Colour points by height** repaints the cloud from low blue to high amber. It only changes the view, not the capture file, and turning it off restores the captured colours.
- **Measure** (top right of the viewport): click two points on the cloud to get the straight-line distance, in cm under a metre and m above. Dragging still orbits. Press Escape or click the button again to exit.
- **Show rover path** draws the capture's camera path, from a green start marker to an orange end marker.

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

## Proposed house

In the sidebar, enable **Show proposed house**. Sliders update width (3–16 m), depth (3–20 m), floors (1–3), and roof height (0.4–4 m). Change wall colour or include/remove the front porch. **Focus house** frames the proposal; **Fit view** frames both scan and proposal. **Reset house dimensions** restores defaults.

The model is built by `buildHouse(parameters)` in `web/src/house.js` from boxes, window frames/panes, a triangular extruded roof, and optional porch geometry. It lives in its own Three.js group and is automatically previewed beside the scan at the scan bounding box's lowest Y value. That is a preview anchor, not a detected ground plane or surveyed placement. Parameters stay while switching scans but reset on page reload. Floor height is fixed at 2.8 m.

The proposed house has no AI, interior rooms, construction plans, or building replacement. Feature 3 adds the placement and comparison tools described below. The house can also be previewed before loading any scan. Observation pins remain attached to the captured point cloud, not the proposed house.

## House placement and comparison

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

## Replacement region

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

## Gaussian splats

Select a saved capture under Scans, then **Train Gaussian splat**. The backend
prepares RoverCapture photos/poses and LiDAR geometry, then runs Brush for 1,500
steps with a 720 px maximum image resolution. LOTA imports with camera data can
also train; PLY-only imports cannot. **Open Gaussian splat** opens an existing
result; **Open point cloud for placement** in Notes returns to pin placement.
The selected capture opens automatically when its training finishes.

Restart the backend from this checkout to register POST `/api/sessions/{id}/train`.
Keep your existing capture token and HTV_DATA_DIR settings. The old backend from
another checkout may show old captures but does not necessarily support this endpoint.
Health reports `brush`; session responses include `splat_url`. Training logs are
available at `/api/sessions/{id}/assets/train.log`. A failed training run preserves
previous scene.ply and the point cloud.

Brush is bundled locally in ignored `tools/brush_app`, copied from the existing
HTV installation. On another machine, run `python3 scripts/install_brush.py` or
set BRUSH_BIN to an installed executable. This change was checked with mocked
training/export tests; a new GPU training run is not automatically started.
