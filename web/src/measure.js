import * as THREE from 'three';

export function segmentLength(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function formatMetres(metres) {
  if (!Number.isFinite(metres) || metres < 0) return '—';
  if (metres < 1) return `${(metres * 100).toFixed(1)} cm`;
  return `${metres.toFixed(2)} m`;
}

// Two clicks on a point cloud. Dragging still orbits; only a short click picks a vertex.
export function createMeasure({scene, camera, canvas, getCloud, isBlocked, onActive}) {
  const button = document.querySelector('#measure');
  const readout = document.querySelector('#measure-readout');
  const group = new THREE.Group();
  scene.add(group);
  const ray = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let active = false;
  let down = null;
  let points = [];

  function clearGraphics() {
    for (const child of [...group.children]) {
      group.remove(child);
      child.geometry?.dispose();
      child.material?.dispose();
    }
  }
  function redraw() {
    clearGraphics();
    for (const position of points) {
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(1, 12, 8),
        new THREE.MeshBasicMaterial({color: 0xf25c24, depthTest: false})
      );
      marker.position.copy(position);
      marker.renderOrder = 90;
      marker.userData.measureMarker = true;
      group.add(marker);
    }
    const show = points.length === 2;
    readout.hidden = !show;
    readout.textContent = show ? formatMetres(segmentLength(points[0], points[1])) : '';
    if (!show) return;
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({color: 0xf25c24, depthTest: false})
    );
    line.renderOrder = 89;
    group.add(line);
  }
  function setActive(next) {
    if (next && isBlocked?.()) return;
    active = next;
    button.setAttribute('aria-pressed', String(active));
    button.textContent = active ? 'Measuring' : 'Measure';
    canvas.style.cursor = active ? 'crosshair' : '';
    if (!active) points = [];
    redraw();
    onActive?.(active);
  }
  function pick(event) {
    const cloud = getCloud();
    if (!cloud?.geometry?.attributes?.position) return null;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    ray.setFromCamera(pointer, camera);
    const box = cloud.userData.sourceGeometry?.boundingBox || cloud.geometry.boundingBox;
    const diagonal = box ? box.getSize(new THREE.Vector3()).length() : 1;
    ray.params.Points.threshold = Math.max(0.015, Math.min(0.12, diagonal * 0.008));
    const hit = ray.intersectObject(cloud)[0];
    if (!hit || hit.index == null) return null;
    const position = new THREE.Vector3().fromBufferAttribute(cloud.geometry.attributes.position, hit.index);
    cloud.localToWorld(position);
    return position;
  }

  button.addEventListener('click', () => { if (!button.disabled) setActive(!active); });
  canvas.addEventListener('pointerdown', event => {
    if (active && event.button === 0) down = {x: event.clientX, y: event.clientY, id: event.pointerId};
  });
  canvas.addEventListener('pointercancel', () => { down = null; });
  canvas.addEventListener('pointerup', event => {
    const start = down;
    down = null;
    if (!active || isBlocked?.() || !start || start.id !== event.pointerId || event.button !== 0) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 6) return;
    const position = pick(event);
    if (!position) return;
    if (points.length >= 2) points = [];
    points.push(position);
    redraw();
  });
  addEventListener('keydown', event => { if (event.key === 'Escape' && active) setActive(false); });

  return {
    get active() { return active; },
    setCloud(cloud) {
      button.disabled = !cloud;
      points = [];
      if (!cloud && active) setActive(false);
      else redraw();
    },
    stop() { if (active) setActive(false); },
    update() {
      const factor = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 10 / Math.max(canvas.clientHeight, 1);
      for (const child of group.children) {
        if (child.userData.measureMarker) child.scale.setScalar(camera.position.distanceTo(child.position) * factor);
      }
    },
  };
}
