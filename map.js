// map.js — Map drawing only. GPS is handled in app.js.
// Exposes simple functions: initMap, updatePath, clearPath, renderTerritories, panToUser

let map          = null;
let polyline     = null;   // the walking trail
let previewPoly  = null;   // live area fill while walking
let startMarker  = null;   // green dot at loop start
let posMarker    = null;   // arrow showing current position + direction
let layers       = {};     // rendered territory polygons
let path         = [];     // [[lat,lng], …] accumulated this session

// ── bearing helpers ────────────────────────────────────────────────────────────
function bearing(p1, p2) {
  const lat1 = p1[0] * Math.PI / 180, lat2 = p2[0] * Math.PI / 180;
  const dLng = (p2[1] - p1[1]) * Math.PI / 180;
  const x    = Math.sin(dLng) * Math.cos(lat2);
  const y    = Math.cos(lat1) * Math.sin(lat2) -
               Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (Math.atan2(x, y) * 180 / Math.PI + 360) % 360;
}

function arrowIcon(deg) {
  return L.divIcon({
    className: '',
    iconSize:  [28, 28],
    iconAnchor:[14, 14],
    html: `<div style="
      width:28px;height:28px;
      transform:rotate(${deg}deg);
      display:flex;align-items:center;justify-content:center;
      filter:drop-shadow(0 2px 4px rgba(0,0,0,.5))">
      <svg viewBox="0 0 24 24" width="28" height="28">
        <polygon points="12,2 20,22 12,17 4,22"
          fill="#3b82f6" stroke="white" stroke-width="1.5"/>
      </svg>
    </div>`
  });
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Create the Leaflet map. Must be called once before anything else.
 */
export function initMap(lat, lng) {
  if (map) {
    map.setView([lat, lng], 17);
    _movePosMarker(lat, lng, 0);
    return;
  }

  map = L.map("map", { zoomControl: false, tap: false })
         .setView([lat, lng], 17);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '© OpenStreetMap',
    maxZoom: 20,
    keepBuffer: 4
  }).addTo(map);

  L.control.zoom({ position: 'topright' }).addTo(map);

  // 📍 re-centre button
  const btn = L.control({ position: 'bottomright' });
  btn.onAdd = () => {
    const d = L.DomUtil.create('div', 'leaflet-bar');
    d.innerHTML = `<a href="#" style="
      display:flex;align-items:center;justify-content:center;
      width:36px;height:36px;font-size:20px;text-decoration:none;
      background:white;border-radius:4px" title="Centre on me">📍</a>`;
    L.DomEvent.disableClickPropagation(d);
    L.DomEvent.on(d, 'click', e => {
      L.DomEvent.preventDefault(e);
      if (posMarker) map.setView(posMarker.getLatLng(), 17, { animate: true });
    });
    return d;
  };
  btn.addTo(map);

  // Position arrow marker (starts pointing north)
  posMarker = L.marker([lat, lng], {
    icon: arrowIcon(0),
    zIndexOffset: 1000
  }).addTo(map);
}

/**
 * Call this on every GPS fix while tracking is active.
 * Moves the arrow, pans the map, draws the trail, updates the fill preview.
 */
export function updatePath(lat, lng) {
  path.push([lat, lng]);

  const n = path.length;

  // ── Move + rotate position arrow ─────────────────────────────────────────────
  const deg = n >= 2 ? bearing(path[n - 2], path[n - 1]) : 0;
  _movePosMarker(lat, lng, deg);

  // ── Pan map to follow the player ─────────────────────────────────────────────
  if (map) map.panTo([lat, lng], { animate: true, duration: 0.8 });

  // ── Place start marker on first point ────────────────────────────────────────
  if (n === 1) {
    startMarker = L.circleMarker([lat, lng], {
      radius: 12, color: '#10b981', fillColor: '#10b981',
      fillOpacity: 0.5, weight: 2.5
    }).bindTooltip('🟢 Start — return here!', {
      permanent: true, direction: 'top', offset: [0, -14]
    }).addTo(map);
  }

  // ── Draw trail behind the player ─────────────────────────────────────────────
  if (!polyline) {
    polyline = L.polyline([], {
      color: '#10b981', weight: 5, opacity: 0.95,
      lineCap: 'round', lineJoin: 'round'
    }).addTo(map);
  }
  polyline.setLatLngs(path);

  // ── Live area fill preview ────────────────────────────────────────────────────
  if (!previewPoly) {
    previewPoly = L.polygon([], {
      color: '#10b981', fillColor: '#10b981',
      fillOpacity: 0.15, weight: 2, dashArray: '6 5'
    }).addTo(map);
  }
  if (n >= 3) previewPoly.setLatLngs(path);

  // ── Pulse start marker orange when player is close to closing the loop ────────
  if (n >= 6 && startMarker) {
    const dx = lat - path[0][0], dy = lng - path[0][1];
    const distM = Math.sqrt(dx * dx + dy * dy) * 111195;
    if (distM < 60) {
      startMarker.setStyle({ color: '#f59e0b', fillColor: '#f59e0b', radius: 16 });
      startMarker.setTooltipContent('🔁 Almost there — close the loop!');
    } else {
      startMarker.setStyle({ color: '#10b981', fillColor: '#10b981', radius: 12 });
      startMarker.setTooltipContent('🟢 Start — return here!');
    }
  }
}

/**
 * Return the current recorded path and clear it.
 * Call this when the loop is closed.
 */
export function getAndClearPath() {
  const copy = [...path];
  clearPath();
  return copy;
}

/**
 * Clear all trail visuals and reset path.
 */
export function clearPath() {
  path = [];
  if (polyline)    { polyline.remove();    polyline    = null; }
  if (previewPoly) { previewPoly.remove(); previewPoly = null; }
  if (startMarker) { startMarker.remove(); startMarker = null; }
}

/**
 * Flash a green polygon over the captured area briefly.
 */
export function flashCapture(latlngs) {
  if (!map) return;
  const flash = L.polygon(latlngs, {
    color: '#10b981', fillColor: '#10b981', fillOpacity: 0.55, weight: 3
  }).addTo(map);
  setTimeout(() => { try { flash.remove(); } catch (_) {} }, 2500);
}

/**
 * Re-render all territory polygons from Firestore data.
 */
export function renderTerritories(territories, currentUserId) {
  Object.values(layers).forEach(l => { try { l.remove(); } catch (_) {} });
  layers = {};
  if (!map) return;

  territories.forEach(t => {
    if (!t.coordinates || t.coordinates.length < 3) return;
    try {
      const latlngs = t.coordinates.map(c =>
        Array.isArray(c) ? c : [c.lat, c.lng]
      );
      const mine = t.userId === currentUserId;

      const poly = L.polygon(latlngs, {
        color:       t.color || '#3b82f6',
        fillColor:   t.color || '#3b82f6',
        fillOpacity: mine ? 0.40 : 0.18,
        weight:      mine ? 3    : 1.5
      }).addTo(map);

      poly.bindPopup(`
        <div style="font-family:sans-serif;font-size:13px;padding:2px">
          <strong>${_esc(t.displayName || 'Unknown')}</strong><br>
          ${_fmtArea(t.area)}
          ${mine ? '<br><span style="color:#10b981;font-weight:700">✓ Your territory</span>' : ''}
        </div>`);

      layers[t.id] = poly;
    } catch (e) { console.warn("render error", e); }
  });
}

/**
 * Return the raw path array (without clearing).
 */
export function getPath() { return path; }

// ── Internal helpers ───────────────────────────────────────────────────────────

function _movePosMarker(lat, lng, deg) {
  if (!posMarker) return;
  posMarker.setLatLng([lat, lng]);
  posMarker.setIcon(arrowIcon(deg));
}

function _fmtArea(m2) {
  if (!m2 || m2 <= 0) return '0 m²';
  if (m2 >= 1_000_000) return (m2 / 1_000_000).toFixed(2) + ' km²';
  if (m2 >= 10_000)    return (m2 / 10_000).toFixed(2)    + ' ha';
  return Math.round(m2).toLocaleString() + ' m²';
}

function _esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
