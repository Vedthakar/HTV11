// Regenerates web/src/mission/mock-route.json: street-following demo tracks for the mission map.
// Waypoints are real intersections (approximate); the public OSRM foot router snaps them to sidewalks/streets.
// Run once when changing waypoints: node scripts/build_mock_route.mjs. The app never calls the router.
import {writeFileSync} from 'node:fs';

const ROUTER = 'https://routing.openstreetmap.de/routed-foot/route/v1/foot/';
// Each route is a loop: the last waypoint is the base the rover started from.
const ROUTES = {
  'ROVER-01': [
    ['King St W & Bathurst St (base)', -79.4028, 43.6443],
    ['King St W & Tecumseth St', -79.4065, 43.6434],
    ['King St W & Strachan Ave', -79.4135, 43.6415],
    ['Strachan Ave & East Liberty St', -79.4102, 43.6378],
    ['Fleet St & Strachan Ave', -79.4085, 43.6352],
    ['Bathurst St & Fort York Blvd', -79.4003, 43.6392],
    ['Front St W & Bathurst St', -79.4022, 43.6420],
    ['King St W & Bathurst St (base)', -79.4028, 43.6443],
  ],
  'ROVER-02': [
    ['Queens Quay W & Bathurst St (base)', -79.3992, 43.6365],
    ['Queens Quay W & Spadina Ave', -79.3918, 43.6389],
    ['Spadina Ave & Bremner Blvd', -79.3928, 43.6413],
    ['Lake Shore Blvd W & Bathurst St', -79.3998, 43.6378],
    ['Queens Quay W & Bathurst St (base)', -79.3992, 43.6365],
  ],
};

const round = v => Math.round(v * 1e5) / 1e5;
const out = {source: 'OSRM foot profile via routing.openstreetmap.de, data © OpenStreetMap contributors', routes: {}};
for (const [rover, wps] of Object.entries(ROUTES)) {
  const url = ROUTER + wps.map(([, lng, lat]) => `${lng},${lat}`).join(';') + '?overview=full&geometries=geojson';
  const res = await fetch(url, {headers: {'User-Agent': 'htv11-mock-route-builder'}});
  if (!res.ok) throw new Error(`${rover}: router responded ${res.status}`);
  const {routes, waypoints} = await res.json();
  const coords = routes[0].geometry.coordinates.map(([lng, lat]) => [round(lng), round(lat)]);
  // Index of the track vertex nearest each snapped waypoint, so sites can sit exactly on the path.
  // Searches forward from the previous stop so a loop's start and end resolve to different indices.
  const d2 = (c, [lng, lat]) => (c[0] - lng) ** 2 + (c[1] - lat) ** 2;
  let from = 0;
  const stops = waypoints.map((w, k) => {
    let index = from;
    for (let i = from; i < coords.length; i++) if (d2(coords[i], w.location) < d2(coords[index], w.location)) index = i;
    if (k === waypoints.length - 1) index = coords.length - 1;
    from = index;
    return {name: wps[k][0], index};
  });
  out.routes[rover] = {distanceM: Math.round(routes[0].distance), coords, stops};
  console.log(rover, out.routes[rover].distanceM, 'm,', coords.length, 'points');
}
writeFileSync(new URL('../web/src/mission/mock-route.json', import.meta.url), JSON.stringify(out) + '\n');
