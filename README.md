# HTV Rover — iPhone LiDAR to an explorable 3D capture

Local starter project for an iPhone 17 Pro mounted on a robot car. Capture RGB, LiDAR depth/confidence and ARKit camera poses, upload to this Mac, build geometry, then train and view Gaussian splats. This project uses Apple's frameworks, Three.js, SparkJS, and Brush directly.

## Start on the laptop

Dependencies are installed in `.venv/` and `web/node_modules/`. Apple Silicon Brush v0.3.0 is installed at `tools/brush_app` from its official release, with the archive checksum verified.

Terminal 1:

```bash
cd /Users/.../HTV
npm run backend
```

Terminal 2:

```bash
cd /Users/.../HTV
npm run dev
```

Open **http://127.0.0.1:5175**. Backend: http://127.0.0.1:8008/docs.

### Accept uploads from the iPhone

Stop the loopback backend first. In the same terminal:

```bash
export HTV_CAPTURE_TOKEN="choose-a-team-token"
npm run backend:lan
```

This deliberately listens on the local network on port 8008. Enter the same token in the iPhone app and the web viewer. Keep this development server on a trusted local network; don't port-forward it or expose it publicly. Upload/processing require the token when configured; read endpoints are intended for trusted teammates. HTTP is unencrypted and intended only for local development.

Find the Mac's Wi-Fi address in System Settings → Wi-Fi → Details → TCP/IP, or `ipconfig getifaddr en0`. Phone and Mac must be on the same network. Some hackathon networks isolate clients; use a network that permits device-to-device connections. Allow the macOS firewall prompt if it appears.

## Install the iPhone app

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
