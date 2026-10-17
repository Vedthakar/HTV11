import SwiftUI
import ARKit
import SceneKit
import CoreImage

@main
struct RoverCaptureApp: App {
    var body: some Scene { WindowGroup { CaptureView() } }
}

struct CaptureView: View {
    @StateObject private var recorder = Recorder()
    @AppStorage("server") private var server = "http://192.168.1.10:8008"
    @AppStorage("token") private var token = ""
    var body: some View {
        ZStack(alignment: .bottom) {
            CameraView(recorder: recorder).ignoresSafeArea()
            VStack(spacing: 12) {
                HStack { Text("ROVER CAPTURE").font(.headline); Spacer(); Text("\(recorder.count) frames") }
                Text(recorder.message).font(.caption).frame(maxWidth: .infinity, alignment: .leading)
                TextField("Laptop URL", text: $server).textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
                SecureField("Capture token (if configured)", text: $token)
                HStack {
                    Button(recorder.recording ? "Stop capture" : "Record") {
                        recorder.recording ? recorder.stop() : recorder.start()
                    }.buttonStyle(.borderedProminent).disabled(recorder.uploading)
                    Button("Upload to laptop") {
                        Task { await recorder.upload(to: server, token: token) }
                    }.buttonStyle(.bordered).disabled(recorder.recording || recorder.uploading || recorder.count == 0)
                }
            }.padding(20).background(.ultraThinMaterial).clipShape(RoundedRectangle(cornerRadius: 20)).padding()
        }.onAppear { recorder.runSession() }
    }
}

struct CameraView: UIViewRepresentable {
    let recorder: Recorder
    func makeUIView(context: Context) -> ARSCNView {
        let view = ARSCNView(frame: .zero)
        view.session = recorder.session
        view.automaticallyUpdatesLighting = true
        return view
    }
    func updateUIView(_ uiView: ARSCNView, context: Context) {}
}

final class Recorder: NSObject, ObservableObject, ARSessionDelegate {
    @Published var recording = false
    @Published var uploading = false
    @Published var count = 0
    @Published var message = "Record a small, static space. Move slowly."
    let session = ARSession()
    private let queue = DispatchQueue(label: "rover.capture")
    private let ci = CIContext()
    private var enabled = false
    private var lastTime: TimeInterval = -1
    private var index = 0
    private var directory: URL?

    override init() {
        super.init()
        session.delegate = self
        session.delegateQueue = queue
    }
    func runSession() {
        guard ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth) else {
            message = "This device does not expose ARKit scene depth. Use a LiDAR-equipped iPhone."; return
        }
        let config = ARWorldTrackingConfiguration()
        config.worldAlignment = .gravity
        config.frameSemantics = [.sceneDepth]
        session.run(config)
    }
    func start() {
        guard ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth) else { return }
        let base = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let folder = base.appendingPathComponent("scan-\(UUID().uuidString)")
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            queue.async {
                self.directory = folder; self.index = 0; self.lastTime = -1; self.enabled = true
                DispatchQueue.main.async { self.recording = true; self.count = 0; self.message = "Recording locally at up to 2 fps. Keep camera tracking stable." }
            }
        } catch { message = error.localizedDescription }
    }
    func stop() {
        queue.async {
            self.enabled = false
            DispatchQueue.main.async { self.recording = false; self.message = "Saved on iPhone. Upload when connected to the laptop’s Wi-Fi." }
        }
    }
    func session(_ session: ARSession, didUpdate frame: ARFrame) {
        guard enabled, frame.timestamp - lastTime >= 0.5,
              case .normal = frame.camera.trackingState,
              let depth = frame.sceneDepth, let folder = directory else { return }
        lastTime = frame.timestamp
        let image = CIImage(cvPixelBuffer: frame.capturedImage)
        guard let cg = ci.createCGImage(image, from: image.extent),
              let jpg = UIImage(cgImage: cg).jpegData(compressionQuality: 0.85) else { return }
        let n = index + 1
        let stem = String(format: "frame_%06d", n)
        let K = frame.camera.intrinsics; let T = frame.camera.transform
        let intrinsics = (0..<3).flatMap { r in (0..<3).map { c in Double(K[c][r]) } }
        let transform = (0..<4).flatMap { r in (0..<4).map { c in Double(T[c][r]) } }
        let dw = CVPixelBufferGetWidth(depth.depthMap), dh = CVPixelBufferGetHeight(depth.depthMap)
        let meta: [String: Any] = ["version": 1, "timestamp": frame.timestamp,
            "width": cg.width, "height": cg.height, "intrinsics": intrinsics, "transform": transform,
            "depthWidth": dw, "depthHeight": dh]
        do {
            try jpg.write(to: folder.appendingPathComponent(stem + ".jpg"), options: .atomic)
            try packed(depth.depthMap, bytesPerPixel: 4).write(to: folder.appendingPathComponent(stem + ".depth"), options: .atomic)
            if let confidence = depth.confidenceMap {
                try packed(confidence, bytesPerPixel: 1).write(to: folder.appendingPathComponent(stem + ".confidence"), options: .atomic)
            }
            // Metadata is the commit marker; only written after all payloads.
            try JSONSerialization.data(withJSONObject: meta).write(to: folder.appendingPathComponent(stem + ".json"), options: .atomic)
            index = n
            DispatchQueue.main.async { self.count = n; self.message = "Recording · \(n) frames · tracking normal" }
        } catch {
            enabled = false
            DispatchQueue.main.async { self.recording = false; self.message = "Storage error: \(error.localizedDescription)" }
        }
    }
    private func packed(_ buffer: CVPixelBuffer, bytesPerPixel: Int) -> Data {
        CVPixelBufferLockBaseAddress(buffer, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }
        let w = CVPixelBufferGetWidth(buffer), h = CVPixelBufferGetHeight(buffer)
        let stride = CVPixelBufferGetBytesPerRow(buffer)
        guard let base = CVPixelBufferGetBaseAddress(buffer) else { return Data() }
        var result = Data(capacity: w * h * bytesPerPixel)
        for row in 0..<h { result.append(base.advanced(by: row * stride).assumingMemoryBound(to: UInt8.self), count: w * bytesPerPixel) }
        return result
    }
    func session(_ session: ARSession, didFailWithError error: Error) {
        enabled = false
        DispatchQueue.main.async { self.recording = false; self.message = "ARKit: \(error.localizedDescription)" }
    }
    func sessionWasInterrupted(_ session: ARSession) {
        enabled = false
        DispatchQueue.main.async { self.recording = false; self.message = "Tracking interrupted. Keep this scan; start a new scan after tracking recovers." }
    }
    @MainActor
    func upload(to address: String, token: String) async {
        guard let folder = directory, let base = URL(string: address), ["http", "https"].contains(base.scheme ?? ""), base.host != nil else {
            message = "Enter a valid laptop URL, such as http://192.168.1.10:8008"; return
        }
        uploading = true; defer { uploading = false }
        do {
            var req = URLRequest(url: base.appendingPathComponent("api/sessions"));req.httpMethod = "POST"
            req.setValue(token, forHTTPHeaderField: "X-Capture-Token")
            let (data, response) = try await URLSession.shared.data(for: req)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200,
                  let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any], let id = obj["id"] as? String else {
                throw NSError(domain: "Upload", code: 1, userInfo: [NSLocalizedDescriptionKey: "Cannot create session. Check laptop URL and capture token."])
            }
            let files = try FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil).sorted { $0.lastPathComponent < $1.lastPathComponent }
            for (i, file) in files.enumerated() {
                message = "Uploading \(i + 1)/\(files.count) files…"
                var r = URLRequest(url: base.appendingPathComponent("api/sessions/\(id)/files/\(file.lastPathComponent)"))
                r.httpMethod = "PUT"; r.setValue(token, forHTTPHeaderField: "X-Capture-Token")
                let (_, res) = try await URLSession.shared.upload(for: r, fromFile: file)
                guard (res as? HTTPURLResponse)?.statusCode == 200 else { throw NSError(domain: "Upload", code: 2, userInfo: [NSLocalizedDescriptionKey: "Upload failed at \(file.lastPathComponent). Local capture is preserved; retry uploads as a new session."]) }
            }
            message = "Uploaded. On the laptop, select this scan and Prepare geometry."
        } catch { message = error.localizedDescription }
    }
}
