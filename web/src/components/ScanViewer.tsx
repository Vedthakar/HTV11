import {useEffect, useRef, useState} from 'react';
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {PLYLoader} from 'three/addons/loaders/PLYLoader.js';

// Parsed clouds are cached per URL so reopening a site panel doesn't refetch a multi-MB PLY.
const clouds = new Map<string, Promise<THREE.BufferGeometry>>();
function loadCloud(url: string) {
  let p = clouds.get(url);
  if (!p) {
    p = new PLYLoader().loadAsync(url).then(g => { g.computeBoundingSphere(); return g; });
    p.catch(() => clouds.delete(url)); // allow a retry after a failed load
    clouds.set(url, p);
  }
  return p;
}

interface Props { cloudUrl: string; trajectoryUrl?: string | null; label: string; }

/** Small interactive point-cloud preview: auto-rotates, drag to orbit, scroll to zoom. */
export function ScanViewer({cloudUrl, trajectoryUrl, label}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    const el = host.current!;
    let disposed = false;
    const renderer = new THREE.WebGLRenderer({antialias: true, alpha: true});
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    el.prepend(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.autoRotate = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    controls.autoRotateSpeed = 0.8;
    // Stop spinning while the user handles it; resume a few seconds after they let go.
    let resume = 0;
    controls.addEventListener('start', () => { controls.autoRotate = false; clearTimeout(resume); });
    controls.addEventListener('end', () => { resume = window.setTimeout(() => { controls.autoRotate = !matchMedia('(prefers-reduced-motion: reduce)').matches; }, 4000); });

    const resize = () => {
      const {clientWidth: w, clientHeight: h} = el;
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    resize();

    const owned: {dispose(): void}[] = [];
    Promise.all([
      loadCloud(cloudUrl),
      trajectoryUrl ? fetch(trajectoryUrl).then(r => (r.ok ? r.json() as Promise<number[][]> : [])).catch(() => []) : Promise.resolve([]),
    ]).then(([geometry, path]) => {
      if (disposed) return;
      const material = new THREE.PointsMaterial({size: 0.022, vertexColors: geometry.hasAttribute('color'), color: geometry.hasAttribute('color') ? 0xffffff : 0xb8c4cc});
      owned.push(material);
      scene.add(new THREE.Points(geometry, material));
      if (path.length > 1) {
        const line = new THREE.BufferGeometry().setFromPoints(path.map(p => new THREE.Vector3(p[0], p[1], p[2])));
        const lineMat = new THREE.LineBasicMaterial({color: 0xf25c24, transparent: true, opacity: 0.9, depthTest: false});
        owned.push(line, lineMat);
        const trail = new THREE.Line(line, lineMat);
        trail.renderOrder = 2;
        scene.add(trail);
      }
      // Frame the whole cloud from a three-quarter view.
      const {center, radius} = geometry.boundingSphere!;
      controls.target.copy(center);
      camera.position.copy(center).add(new THREE.Vector3(1, 0.75, 1).normalize().multiplyScalar(radius * 1.6));
      camera.near = radius / 200; camera.far = radius * 20; camera.updateProjectionMatrix();
      controls.update();
      setState('ready');
    }).catch(() => { if (!disposed) setState('error'); });

    renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
    return () => {
      disposed = true;
      clearTimeout(resume);
      observer.disconnect();
      renderer.setAnimationLoop(null);
      controls.dispose();
      for (const o of owned) o.dispose(); // the cached cloud geometry is kept for next time
      renderer.dispose();
      renderer.forceContextLoss(); // release the WebGL context; the map already holds one
      renderer.domElement.remove();
    };
  }, [cloudUrl, trajectoryUrl]);

  return (
    <div ref={host} className="scan-viewer" role="img" aria-label={`Interactive 3D point cloud of ${label}. Drag to orbit, scroll to zoom.`}>
      {state === 'loading' && <span className="scan-viewer-state mono">Loading scan…</span>}
      {state === 'error' && <span className="scan-viewer-state mono">Scan unavailable</span>}
    </div>
  );
}
