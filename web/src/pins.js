import * as THREE from 'three';

const COLORS = {unreviewed: 0xffc576, confirmed: 0x9bd2ac, dismissed: 0x87949e};

// Handles only scene markers and picking; storage and forms live in observations.js.
export function createPins({scene, camera, canvas, controls, onPlace, onSelect, isBlocked=()=>false, isVisible=()=>true}) {
  const group = new THREE.Group();
  scene.add(group);
  const geometry = new THREE.SphereGeometry(1, 14, 10);
  const ray = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let cloud = null, mode = false, down = null, selectedId = null;
  let items = [], draft = null, threshold = .05;

  function rebuild() {
    for (const child of [...group.children]) {group.remove(child);child.material.dispose();}
    for (const item of [...items, ...(draft ? [{id: '__draft', position: draft, reviewStatus: 'unreviewed'}] : [])]) {
      const marker = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({color: item.id === selectedId ? 0xffffff : COLORS[item.reviewStatus], depthTest: false, depthWrite: false}));
      marker.position.set(item.position.x, item.position.y, item.position.z);
      marker.userData.observationId = item.id;
      marker.renderOrder = 100;
      group.add(marker);
    }
  }
  function setMode(active) {
    mode = active;
    controls.enabled = !active;
    canvas.style.cursor = active ? 'crosshair' : '';
    down = null;
  }
  function setCloud(next) {
    cloud = next;
    if (cloud?.geometry.boundingBox) {
      const diagonal = cloud.geometry.boundingBox.getSize(new THREE.Vector3()).length();
      threshold = Math.max(.015, Math.min(.12, diagonal * .008));
    }
    if (!cloud) setMode(false);
  }
  canvas.addEventListener('pointerdown', event => {
    if (!isBlocked() && event.button === 0) down = {x: event.clientX, y: event.clientY, id: event.pointerId};
  });
  canvas.addEventListener('pointercancel', () => {down = null;});
  canvas.addEventListener('pointerup', event => {
    const start = down; down = null;
    if(isBlocked())return;
    if (!start || start.id !== event.pointerId || event.button !== 0 || Math.hypot(event.clientX-start.x, event.clientY-start.y) > 6) return;
    const rect = canvas.getBoundingClientRect();
    pointer.set((event.clientX-rect.left)/rect.width*2-1, -(event.clientY-rect.top)/rect.height*2+1);
    ray.setFromCamera(pointer, camera);
    if (!mode) {
      const hit = ray.intersectObjects(group.children).find(hit => hit.object.visible && hit.object.userData.observationId !== '__draft');
      if (hit) onSelect(hit.object.userData.observationId);
      return;
    }
    if (!cloud) return;
    ray.params.Points.threshold = threshold;
    const hit = ray.intersectObject(cloud)[0];
    if (!hit) {onPlace(null);return;}
    // Anchor to the actual captured vertex, not the ray's approximate closest point.
    const position = new THREE.Vector3().fromBufferAttribute(cloud.geometry.attributes.position, hit.index);
    cloud.localToWorld(position);
    setMode(false);
    draft = {x: position.x, y: position.y, z: position.z};rebuild();onPlace(draft);
  });
  return {
    setCloud, setMode,
    setItems(next) {items=next;rebuild();},
    select(id) {selectedId=id;rebuild();},
    clearDraft() {draft=null;rebuild();},
    reset() {setMode(false);cloud=null;items=[];draft=null;selectedId=null;rebuild();},
    update() {
      // Keep markers roughly constant in screen size while zooming.
      const factor = Math.tan(THREE.MathUtils.degToRad(camera.fov/2))*18/Math.max(canvas.clientHeight,1);
      for (const marker of group.children) {marker.visible=isVisible(marker.position);marker.scale.setScalar(camera.position.distanceTo(marker.position)*factor);}
    }
  };
}
