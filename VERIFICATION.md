# Verification

Passed: native iOS unsigned compile; production frontend build; 4 backend pipeline tests; point cloud rendered in browser.

Fixture: generated planar depth/image data, explicitly labeled synthetic. It demonstrates format/math/upload/render integration, not reconstruction quality on a physical space.

Not verified: iPhone deployment/signing, actual sensor capture or network transfer, real reconstruction quality, car control.

Brush training smoke test: failed before training because no Metal GPU adapter was visible in this restricted execution environment. CLI itself works. Retry from normal Terminal. Server records errors in each session and keeps geometry available.

Installed Xcode SDK: iOS 18.1. A newer iPhone OS can require a newer Xcode for device deployment.
