// map.js
// Fixes in this version:
//  • Compass uses exponential smoothing (no more jitter)
//  • Compass dead-zone: arrow only updates if heading changes >5°
//  • webkitCompassHeading for iOS, absolute deviceorientation for Android
//  • maxNativeZoom:19 prevents grey tiles when zooming too far in
//  • "Close loop" pulse only triggers after 100 m walked (was 60 m)

let map;
let polyline;
let previewPoly;
let startMarker;
let playerMarker;
let path = [];

// Compass state
let smoothHeading  = 0;     // exponentially smoothed heading
let lastIconDeg    = -999;  // last degree we actually updated the icon at
const SMOOTH_ALPHA = 0.15;  // lower = smoother but slower (0.1–0.25 is good)
const DEAD_ZONE    = 5;     // degrees — ignore changes smaller than this

// ── Arrow icon ────────────────────────────────────────────────────────────────
function makeArrow(deg) {
  return L.divIcon({
    className: '',
    iconSize:  [36, 36],
    iconAnchor:[18, 18],
    html: `<div style="transform:rotate(${deg}deg);width:36px;height:36px;
                display:flex;align-items:center;justify-content:center">
      <svg viewBox="0 0 24 24" width="36" height="36">
        <polygon points="12,2 20,22 12,17 4,22"
          fill="#3b82f6" stroke="white" stroke-width="1.5"
          style="filter:drop-shadow(0 2px 4px rgba(0,0,0,.55))"/>
      </svg>
    </div>`
  });
}

// ── initMap — called once after login ────────────────────────────────────────
export function initMap(lat, lng) {
  if (map) {
    map.setView([lat, lng], 17);
    if (playerMarker) playerMarker.setLatLng([lat, lng]);
    return;
  }

  map = L.map("map", { zoomControl: false, tap: false })
         .setView([lat, lng], 17);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '© OpenStreetMap',
    maxZoom:       20,
    maxNativeZoom: 19,   // ← FIX: prevents grey tiles on excessive zoom
    keepBuffer:     4
  }).addTo(map);

  L.control.zoom({ position: 'topright' }).addTo(map);

  // Re-centre button
  const btn = L.control({ position: 'bottomright' });
  btn.onAdd = () => {
    const d = L.DomUtil.create('div', 'leaflet-bar');
    d.innerHTML = `<a href="#" style="display:flex;align-items:center;
      justify-content:center;width:36px;height:36px;font-size:18px;
      text-decoration:none;background:white;border-radius:4px"
      title="Centre on me">📍</a>`;
    L.DomEvent.disableClickPropagation(d);
    L.DomEvent.on(d, 'click', e => {
      L.DomEvent.preventDefault(e);
      if (playerMarker) map.setView(playerMarker.getLatLng(), 17, { animate: true });
    });
    return d;
  };
  btn.addTo(map);

  // Player arrow
  playerMarker = L.marker([lat, lng], {
    icon: makeArrow(0), zIndexOffset: 1000
  }).addTo(map);

  // Start trail polyline
  polyline = L.polyline([], {
    color: '#ef4444', weight: 5, opacity: 0.9,
    lineCap: 'round', lineJoin: 'round'
  }).addTo(map);

  _startCompass();
}

// ── updatePath — called on every GPS fix from app.js ─────────────────────────
export function updatePath(lat, lng) {
  path.push([lat, lng]);
  const n = path.length;

  // Move arrow
  if (playerMarker) {
    playerMarker.setLatLng([lat, lng]);
    playerMarker.setIcon(makeArrow(smoothHeading));
  }

  // Pan map to follow
  if (map) map.panTo([lat, lng], { animate: true, duration: 0.8 });

  // Draw trail
  if (polyline) polyline.setLatLngs(path);

  // Draw live area fill
  if (n >= 3) {
    if (!previewPoly) {
      previewPoly = L.polygon([], {
        color: '#10b981', fillColor: '#10b981',
        fillOpacity: 0.18, weight: 2, dashArray: '6 4'
      }).addTo(map);
    }
    previewPoly.setLatLngs(path);
  }

  // Place start marker on first point
  if (n === 1) {
    startMarker = L.circleMarker([lat, lng], {
      radius: 11, color: '#10b981', fillColor: '#10b981',
      fillOpacity: 0.6, weight: 3
    }).bindTooltip('🟢 Return here to capture!', {
      permanent: true, direction: 'top', offset: [0, -13]
    }).addTo(map);
  }

  // ── Close-loop hint: only after 100 m walked ─────────────────────────────
  // Calculate total path distance in metres
  if (n >= 8 && startMarker) {
    let totalM = 0;
    for (let i = 1; i < n; i++) {
      const dx = path[i][0] - path[i-1][0];
      const dy = path[i][1] - path[i-1][1];
      totalM  += Math.sqrt(dx*dx + dy*dy) * 111195;
    }

    const dx          = lat - path[0][0];
    const dy          = lng - path[0][1];
    const distToStart = Math.sqrt(dx*dx + dy*dy) * 111195; // metres

    if (totalM >= 100 && distToStart < 60) {
      // Enough distance walked AND close to start
      startMarker.setStyle({ color: '#f59e0b', fillColor: '#f59e0b', radius: 15 });
      startMarker.setTooltipContent('🔁 Close the loop now!');
    } else {
      startMarker.setStyle({ color: '#10b981', fillColor: '#10b981', radius: 11 });
      startMarker.setTooltipContent('🟢 Return here to capture!');
    }
  }
}

export function getAndClearPath() {
  const copy = [...path];
  clearPath();
  return copy;
}

export function clearPath() {
  path = [];
  if (polyline)    polyline.setLatLngs([]);
  if (previewPoly) { previewPoly.remove(); previewPoly = null; }
  if (startMarker) { startMarker.remove(); startMarker = null; }
}

export function flashCapture(latlngs) {
  if (!map) return;
  const f = L.polygon(latlngs, {
    color: '#10b981', fillColor: '#10b981', fillOpacity: 0.5, weight: 3
  }).addTo(map);
  setTimeout(() => { try { f.remove(); } catch(_){} }, 2500);
}

let layers = {};
export function renderTerritories(territories, myUid) {
  Object.values(layers).forEach(l => { try { l.remove(); } catch(_){} });
  layers = {};
  if (!map) return;
  territories.forEach(t => {
    if (!t.coordinates || t.coordinates.length < 3) return;
    try {
      const ll   = t.coordinates.map(c => Array.isArray(c) ? c : [c.lat, c.lng]);
      const mine = t.userId === myUid;
      const poly = L.polygon(ll, {
        color:       t.color || '#3b82f6',
        fillColor:   t.color || '#3b82f6',
        fillOpacity: mine ? 0.4 : 0.15,
        weight:      mine ? 3   : 1.5
      }).addTo(map);
      poly.bindPopup(`<b>${t.displayName||'Unknown'}</b><br>${_fmt(t.area)}${mine?'<br>✓ Yours':''}`);
      layers[t.id] = poly;
    } catch(e) { console.warn('render err', e); }
  });
}

export function getPath() { return path; }

// ══════════════════════════════════════════════════════════════════════════════
//  COMPASS — smoothed + dead-zone filtered
// ══════════════════════════════════════════════════════════════════════════════

function _startCompass() {
  if (typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function') {
    window._compassNeedsPermission = true;
  }
  // Try absolute first (more accurate on Android), fall back to relative
  window.addEventListener('deviceorientationabsolute', _onOrientation, true);
  window.addEventListener('deviceorientation',         _onOrientation, true);
}

// Smoothing helper — handles 0°/360° wraparound correctly
function _smoothAngle(current, target, alpha) {
  let diff = target - current;
  // Wrap difference to [-180, 180]
  if (diff >  180) diff -= 360;
  if (diff < -180) diff += 360;
  return current + alpha * diff;
}

function _onOrientation(e) {
  let raw = null;

  if (e.webkitCompassHeading != null) {
    // iOS — already true north, no conversion needed
    raw = e.webkitCompassHeading;
  } else if (e.alpha != null) {
    // Android — alpha is degrees anticlockwise from north, so invert
    raw = (360 - e.alpha) % 360;
  }

  if (raw == null) return;

  // Exponential smoothing (handles wraparound)
  smoothHeading = _smoothAngle(smoothHeading, raw, SMOOTH_ALPHA);
  const rounded = Math.round(smoothHeading);

  // Dead-zone: only redraw icon if heading changed by > DEAD_ZONE degrees
  if (Math.abs(rounded - lastIconDeg) > DEAD_ZONE) {
    lastIconDeg = rounded;
    if (playerMarker) playerMarker.setIcon(makeArrow(rounded));
  }
}

function _fmt(m2) {
  if (!m2 || m2 <= 0) return '0 m²';
  if (m2 >= 1e6) return (m2/1e6).toFixed(2)+' km²';
  if (m2 >= 1e4) return (m2/1e4).toFixed(2)+' ha';
  return Math.round(m2).toLocaleString()+' m²';
}
