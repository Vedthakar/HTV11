# Capturing scans

How to get LiDAR captures from an iPhone into Premiere. [Back to README](../README.md)

## Scan with LOTA (recommended)

LOTA (LiDAR Over the Air) replaces the custom RoverCapture app. Settings for a rover-mounted phone:

1. Camera page → Point Cloud mode → **Point Cloud Settings**: Min Confidence **High Only**, Max Depth **3–4 m**.
2. Swipe right to the capture page, choose **N + Depth** (Nerfstudio + Depth; COLMAP also works), Capture Settings → Capture Rate **30 Hz**.
3. Folder icon (bottom left) → pick an iCloud Files folder. Record while driving slowly (~0.2–0.3 m/s, stop before turns). LOTA rejects motion-blurred frames and only keeps keyframes after 5 cm / 5° of motion.
4. Get the `LOTA_<timestamp>_<MODE>.zip` to the laptop and either click **Import LOTA capture**, drop it on the page, or watch the synced folder:

```bash
npm run watch -- "C:\Users\<you>\iCloudDrive\<folder>"
```

The importer (`backend/lota.py`) accepts Nerfstudio, Nerfstudio + Depth, COLMAP binary and PLY-only exports. It drops single-frame pose spikes (rover jolts), warns about permanent path jumps (tracking relocalised), removes isolated floaters, thins the cloud to 1 cm and caps it at 200,000 points for the viewer. The dataset (photos, depth, poses) is kept as exported; its photos back inspection observations. If a real export shows up rotated (Z-up), restart the backend with `HTV_LOTA_UP=z` (this rotates the point cloud and path). ZIP uploads are capped at 4 GB (`HTV_IMPORT_MAX_MB`).

Without a phone: `npm run fixtures` writes clearly marked SYNTHETIC LOTA-style ZIPs to `data/lota_fixtures/`.

## Live preview while driving (optional)

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

The app saves first to its Documents folder, accessible through Files/Finder file sharing. Upload is after capture, not live streaming. On upload failure, local data remains; retry creates a new server session. Backgrounding/interruption stops the scan to avoid silently mixing tracking coordinates.

## Tips for a first good capture

Start handheld before attaching to the rover. Use a textured, static scene with diffuse lighting, slow movement, substantial overlap, and several viewing angles. Keep the rear camera and LiDAR unobstructed. A straight forward-facing drive cannot capture surfaces behind objects or around unseen corners. ARKit can drift; tracking quality does not guarantee an accurate reconstruction.

## Capture format

The capture format uses `frame_000001.jpg`, `.depth`, `.confidence`, `.json`. JPEG is saved in the camera buffer's raw orientation. Matrices are serialized row-major; the camera transform is ARKit camera-to-world (+x right, +y up, -z forward). Depth is contiguous little-endian float32 in metres; confidence is uint8 (0/1/2). Image and depth calibration are scaled consistently. The COLMAP export inverts poses and flips camera y/z. Don't rotate JPEGs independently of their intrinsics/poses.

`transforms.json` is a convenient alternate export. The dataset's `images/` and `sparse/0/` hold COLMAP-format cameras and LiDAR initialization points. Large captures are capped to 200,000 sampled geometry points; this is not a watertight mesh, certified measurement, or collision map.

A Gaussian splat is a visual reconstruction; autonomous navigation requires a separate mapping/planning/control system.

## Build the legacy app without signing

```bash
xcodebuild -project ios/RoverCapture.xcodeproj -scheme RoverCapture -sdk iphoneos -configuration Debug -derivedDataPath .build/ios CODE_SIGNING_ALLOWED=NO build
```

## Reinstall dependencies

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
npm --prefix web ci --cache "$PWD/.npm-cache"
```

References: [SparkJS](https://sparkjs.dev/docs/) · [ARKit](https://developer.apple.com/documentation/arkit)
