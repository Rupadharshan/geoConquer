// map.js — Exactly like your working ChatGPT version, but with:
// • Arrow marker that rotates with phone compass
// • Trail line behind you
// • Live area fill preview
// • Map pans to follow you

let map;
let polyline;
let previewPoly;
let startMarker;
let playerMarker;     // the arrow showing your position + direction
let path = [];
let currentHeading = 0;  // degrees from compass

// ── Arrow icon — rotates based on compass heading ──────────────────────────
function makeArrow(deg) {
  return L.divIcon({
    className: '',
    iconSize:  [32, 32],
    iconAnchor:[16, 16],
    html: `<div style="transform:rotate(${deg}deg);width:32px;height:32px;
                display:flex;align-items:center;justify-content:center">
      <svg viewBox="0 0 24 24" width="32" height="32">
        <polygon points="12,2 20,22 12,17 4,22"
          fill="#3b82f6" stroke="white" stroke-width="1.5"
          style="filter:drop-shadow(0 2px 3px rgba(0,0,0,0.5))"/>
      </svg>
    </div>`
  });
}

// ── Called once after login — same as ChatGPT version ─────────────────────
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
    maxZoom: 20
  }).addTo(map);

  L.control.zoom({ position: 'topright' }).addTo(map);

  // 📍 re-centre button bottom right
  const recenter = L.control({ position: 'bottomright' });
  recenter.onAdd = () => {
    const d = L.DomUtil.create('div', 'leaflet-bar');
    d.innerHTML = `<a href="#" style="display:flex;align-items:center;
      justify-content:center;width:36px;height:36px;font-size:18px;
      text-decoration:none;background:white">📍</a>`;
    L.DomEvent.disableClickPropagation(d);
    L.DomEvent.on(d, 'click', e => {
      L.DomEvent.preventDefault(e);
      if (playerMarker) map.setView(playerMarker.getLatLng(), 17, { animate: true });
    });
    return d;
  };
  recenter.addTo(map);

  // Player arrow marker
  playerMarker = L.marker([lat, lng], {
    icon: makeArrow(0),
    zIndexOffset: 1000
  }).addTo(map);

  // Start compass listener
  _startCompass();

  // Also draw a polyline (start empty — same as ChatGPT)
  polyline = L.polyline([], {
    color: '#ef4444', weight: 5, opacity: 0.9,
    lineCap: 'round', lineJoin: 'round'
  }).addTo(map);
}

// ── Called on every GPS fix — SAME SIGNATURE as ChatGPT version ───────────
// app.js calls this exactly like: updatePath(lat, lng)
export function updatePath(lat, lng) {
  path.push([lat, lng]);

  // 1. Move the arrow marker to new position
  if (playerMarker) {
    playerMarker.setLatLng([lat, lng]);
    playerMarker.setIcon(makeArrow(currentHeading));
  }

  // 2. Pan map to follow player — this is the key line that was missing
  if (map) {
    map.panTo([lat, lng], { animate: true, duration: 0.8 });
  }

  // 3. Draw trail behind player
  if (polyline) {
    polyline.setLatLngs(path);
  }

  // 4. Show the area being captured as a live transparent polygon
  if (path.length >= 3) {
    if (!previewPoly) {
      previewPoly = L.polygon([], {
        color: '#10b981', fillColor: '#10b981',
        fillOpacity: 0.2, weight: 2,
        dashArray: '6 4'
      }).addTo(map);
    }
    previewPoly.setLatLngs(path);
  }

  // 5. Place start marker on first point
  if (path.length === 1) {
    startMarker = L.circleMarker([lat, lng], {
      radius: 10, color: '#10b981', fillColor: '#10b981',
      fillOpacity: 0.6, weight: 3
    }).bindTooltip('🟢 Return here to capture!', {
      permanent: true, direction: 'top', offset: [0, -12]
    }).addTo(map);
  }

  // 6. Pulse start marker orange when player is within ~60 m of closing the loop
  if (path.length >= 6 && startMarker) {
    const dx    = lat - path[0][0];
    const dy    = lng - path[0][1];
    const distM = Math.sqrt(dx * dx + dy * dy) * 111195;
    if (distM < 60) {
      startMarker.setStyle({ color: '#f59e0b', fillColor: '#f59e0b', radius: 14 });
      startMarker.setTooltipContent('🔁 Close the loop now!');
    } else {
      startMarker.setStyle({ color: '#10b981', fillColor: '#10b981', radius: 10 });
      startMarker.setTooltipContent('🟢 Return here to capture!');
    }
  }
}

// ── Return path and wipe map trail (called when loop closes) ──────────────
export function getAndClearPath() {
  const copy = [...path];
  clearPath();
  return copy;
}

// ── Wipe everything — same as what ChatGPT stopBtn does ───────────────────
export function clearPath() {
  path = [];
  if (polyline)    { polyline.setLatLngs([]); }
  if (previewPoly) { previewPoly.remove(); previewPoly = null; }
  if (startMarker) { startMarker.remove(); startMarker = null; }
}

// ── Flash the captured polygon briefly ────────────────────────────────────
export function flashCapture(latlngs) {
  if (!map) return;
  const f = L.polygon(latlngs, {
    color: '#10b981', fillColor: '#10b981', fillOpacity: 0.5, weight: 3
  }).addTo(map);
  setTimeout(() => { try { f.remove(); } catch(_) {} }, 2500);
}

// ── Draw all saved territories from Firestore ──────────────────────────────
let layers = {};
export function renderTerritories(territories, myUid) {
  Object.values(layers).forEach(l => { try { l.remove(); } catch(_) {} });
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
      poly.bindPopup(`<b>${t.displayName || 'Unknown'}</b><br>${_fmt(t.area)}${mine ? '<br>✓ Yours' : ''}`);
      layers[t.id] = poly;
    } catch(e) { console.warn('render err', e); }
  });
}

// ── Same function name as ChatGPT version ─────────────────────────────────
export function getPath() { return path; }

// ══════════════════════════════════════════════════════════════════════════
//  COMPASS — uses DeviceOrientationEvent to rotate the arrow
// ══════════════════════════════════════════════════════════════════════════
function _startCompass() {
  // iOS 13+ needs permission
  if (typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function') {
    // We request on first user interaction (handled in app.js startBtn)
    window._compassNeedsPermission = true;
  }

  window.addEventListener('deviceorientationabsolute', _onOrientation, true);
  window.addEventListener('deviceorientation',         _onOrientation, true);
}

function _onOrientation(e) {
  let heading = null;

  if (e.webkitCompassHeading != null) {
    // iOS — this is the true north heading directly
    heading = e.webkitCompassHeading;
  } else if (e.absolute && e.alpha != null) {
    // Android absolute
    heading = 360 - e.alpha;
  } else if (e.alpha != null) {
    // Android non-absolute fallback
    heading = 360 - e.alpha;
  }

  if (heading == null) return;

  currentHeading = heading;

  // Update arrow icon immediately if marker exists
  if (playerMarker) {
    playerMarker.setIcon(makeArrow(heading));
  }
}

// ── Format area helper ─────────────────────────────────────────────────────
function _fmt(m2) {
  if (!m2 || m2 <= 0) return '0 m²';
  if (m2 >= 1e6) return (m2/1e6).toFixed(2)+' km²';
  if (m2 >= 1e4) return (m2/1e4).toFixed(2)+' ha';
  return Math.round(m2).toLocaleString()+' m²';
}
