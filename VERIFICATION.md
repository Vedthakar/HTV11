# Verification

Passed: native iOS unsigned compile; production frontend build; 4 backend pipeline tests; point cloud rendered in browser.

Fixture: generated planar depth/image data, explicitly labeled synthetic. It demonstrates format/math/upload/render integration, not reconstruction quality on a physical space.

Not verified: iPhone deployment/signing, actual sensor capture or network transfer, real reconstruction quality, car control.

Brush training smoke test: failed before training because no Metal GPU adapter was visible in this restricted execution environment. CLI itself works. Retry from normal Terminal. Server records errors in each session and keeps geometry available.

Installed Xcode SDK: iOS 18.1. A newer iPhone OS can require a newer Xcode for device deployment.

## LOTA + Windows update (2026-10-17)

Passed on Windows 11 (Python 3.12, Node 24): 16 backend tests (original 8, plus 6 LOTA importer and 2 live-relay tests), 2 web tests, production build.
End-to-end on SYNTHETIC LOTA-style ZIPs: Nerfstudio + Depth and COLMAP imports through the web proxy, jolt-frame removal, cloud/path served; Brush 0.2.0 trained the imported Nerfstudio set to `ready` on Intel Iris Xe (~48 min for 1,500 steps). Live relay: simulator → TCP 9848 + OSC 9000 → WebSocket through the proxy, ~8 forwarded frames/s of 8,000 points with pose.

Not verified: a real LOTA export (folder layout, axis convention, depth PNG units), LOTA on iPhone 17 Pro, LOTA's live stream connection direction and coordinate space, the dashboard UI in a browser after these changes (built and served, not clicked through).
