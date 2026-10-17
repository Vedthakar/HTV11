// Live preview of LOTA's point stream, relayed by the backend over /api/live.
// Binary frame: Uint32 count, Float32[8] pose (px,py,pz,qx,qy,qz,qw,valid), Float32 xyz[3n], Uint8 rgb[3n].
import * as THREE from 'three';

const CAPACITY = 400000;

export function createLive({scene, notice, fitBox}) {
  const $ = s => document.querySelector(s);
  const positions = new THREE.BufferAttribute(new Float32Array(CAPACITY * 3), 3).setUsage(THREE.DynamicDrawUsage);
  const colors = new THREE.BufferAttribute(new Uint8Array(CAPACITY * 3), 3, true).setUsage(THREE.DynamicDrawUsage);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', positions); geometry.setAttribute('color', colors); geometry.setDrawRange(0, 0);
  const cloud = new THREE.Points(geometry, new THREE.PointsMaterial({size: .02, vertexColors: true}));
  cloud.frustumCulled = false;
  // Cone pointing along the camera's -Z (forward) axis.
  const rover = new THREE.Mesh(new THREE.ConeGeometry(.08, .22, 16).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({color: 0xf2b84b, depthTest: false, transparent: true}));
  rover.visible = false;
  const group = new THREE.Group(); group.add(cloud, rover); group.visible = false; scene.add(group);

  let socket = null, write = 0, count = 0, frames = 0, lastStatus = null, rate = 0, rateStart = performance.now(), rateFrames = 0;
  const pose = new THREE.Matrix4(), point = new THREE.Vector3(), q = new THREE.Quaternion(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);

  function setPose(position, rotation) {
    p.set(...position); q.set(...rotation); pose.compose(p, q, one);
    rover.position.copy(p); rover.quaternion.copy(q); rover.visible = true;
  }
  function onFrame(buffer) {
    const n = new DataView(buffer).getUint32(0, true);
    const head = new Float32Array(buffer, 4, 8), xyz = new Float32Array(buffer, 36, n * 3), rgb = new Uint8Array(buffer, 36 + 12 * n, n * 3);
    if (head[7]) setPose([head[0], head[1], head[2]], [head[3], head[4], head[5], head[6]]);
    const camera = $('#live-space').value === 'camera';
    if (camera && !head[7]) return; // Camera-space points are meaningless without a pose.
    if (!$('#live-accumulate').checked) { write = 0; count = 0; }
    for (let i = 0; i < n; i++) {
      point.fromArray(xyz, i * 3); if (camera) point.applyMatrix4(pose);
      point.toArray(positions.array, write * 3);
      colors.array[write * 3] = rgb[i * 3]; colors.array[write * 3 + 1] = rgb[i * 3 + 1]; colors.array[write * 3 + 2] = rgb[i * 3 + 2];
      write = (write + 1) % CAPACITY; count = Math.min(count + 1, CAPACITY);
    }
    positions.needsUpdate = true; colors.needsUpdate = true; geometry.setDrawRange(0, count);
    frames++; rateFrames++;
    const now = performance.now(); if (now - rateStart > 1000) { rate = rateFrames * 1000 / (now - rateStart); rateFrames = 0; rateStart = now; }
  }
  function showStatus() {
    const s = lastStatus;
    if (!socket) { $('#live-status').textContent = 'Not connected.'; return; }
    if (!s) { $('#live-status').textContent = 'Connecting to laptop server…'; return; }
    if (s.error) { $('#live-status').textContent = `Receiver problem: ${s.error}`; return; }
    const stream = s.stream_live ? `receiving from ${s.peer} · ${rate.toFixed(1)} fps shown` : s.stream_connected ? `connected (${s.peer}), waiting for frames` : `waiting for LOTA on TCP ${s.ply_port}`;
    $('#live-status').textContent = `${stream} · pose ${s.pose_live ? 'live' : `waiting on UDP ${s.osc_port}`} · ${count.toLocaleString()} points`;
  }
  function connect() {
    socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/live`);
    socket.binaryType = 'arraybuffer';
    socket.onmessage = e => {
      if (typeof e.data !== 'string') { onFrame(e.data); return; }
      const message = JSON.parse(e.data);
      if (message.type === 'status') { lastStatus = message; showStatus(); }
      else if (message.type === 'pose') setPose(message.position, message.rotation);
    };
    socket.onclose = () => {
      const wanted = $('#live-enabled').checked; socket = null; lastStatus = null; showStatus();
      if (wanted) { $('#live-status').textContent = 'Connection lost; retrying…'; setTimeout(() => { if ($('#live-enabled').checked && !socket) connect(); }, 2000); }
    };
    showStatus();
  }
  function clear() { write = 0; count = 0; geometry.setDrawRange(0, 0); showStatus(); }

  $('#live-enabled').onchange = e => {
    const on = e.target.checked; $('#live-settings').hidden = !on; group.visible = on;
    if (on && !socket) connect();
    if (!on && socket) { const s = socket; socket = null; s.onclose = null; s.close(); lastStatus = null; showStatus(); }
    if (on) notice('Live preview on. Point LOTA at this laptop: PLY stream TCP 9848, OSC UDP 9000.');
  };
  $('#live-space').onchange = clear;
  $('#live-clear').onclick = clear;
  $('#live-fit').onclick = () => {
    if (!count) { notice('No live points yet.'); return; }
    const box = new THREE.Box3(); // Only the filled part of the buffer.
    for (let i = 0; i < count; i++) box.expandByPoint(point.fromArray(positions.array, i * 3));
    fitBox(box);
  };
  return {get frames() { return frames; }};
}
