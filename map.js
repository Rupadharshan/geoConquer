// map.js — Leaflet map, live GPS tracking, trail drawing, area preview, territory rendering

import { detectCheat, haversineKm } from "./anticheat.js";

// ── Module state ───────────────────────────────────────────────────────────────
let map            = null;
let trailLine      = null;   // green polyline drawn as user walks
let previewPoly    = null;   // transparent polygon preview while walking
let startMarker    = null;   // pulsing circle at start point
let posMarker      = null;   // blue dot = current live position
let accuracyCircle = null;   // grey accuracy ring around position dot
let layers         = {};     // { [territoryId]: L.Polygon }

let path       = [];         // [{lat, lng, time}, …]
let watchID    = null;
let cbs        = {};         // callbacks set by startTracking()
let autoFollow = true;       // whether map pans to follow the user

// ── Tuning ─────────────────────────────────────────────────────────────────────
const CLOSE_RADIUS_KM = 0.020;  // 20 m  — auto-close loop
const MIN_PATH_KM     = 0.080;  // 80 m  — min walk before loop can close
const MIN_POINTS      = 6;

// ══════════════════════════════════════════════════════════════════════════════
//  PUBLIC API
// ══════════════════════════════════════════════════════════════════════════════

export function initMap(lat, lng) {
  if (map) {
    map.setView([lat, lng], 17);
    _moveDot(lat, lng, 20);
    return;
  }

  map = L.map("map", {
    zoomControl: false,
    attributionControl: true,
    tap: false
  }).setView([lat, lng], 17);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 20,
    keepBuffer: 4
  }).addTo(map);

  L.control.zoom({ position: 'topright' }).addTo(map);

  // Re-centre button
  const locCtrl = L.control({ position: 'bottomright' });
  locCtrl.onAdd = () => {
    const div = L.DomUtil.create('div', 'leaflet-bar');
    div.innerHTML = `<a href="#" title="Follow me"
      style="font-size:20px;display:flex;align-items:center;justify-content:center;
             width:36px;height:36px;text-decoration:none;background:white">📍</a>`;
    L.DomEvent.disableClickPropagation(div);
    L.DomEvent.on(div, 'click', e => {
      L.DomEvent.preventDefault(e);
      autoFollow = true;
      if (posMarker) map.setView(posMarker.getLatLng(), 17, { animate: true });
    });
    return div;
  };
  locCtrl.addTo(map);

  // Stop auto-follow when user drags
  map.on('dragstart', () => { autoFollow = false; });

  // Accuracy ring
  accuracyCircle = L.circle([lat, lng], {
    radius: 20, color: '#3b82f6', fillColor: '#3b82f6',
    fillOpacity: 0.08, weight: 1, opacity: 0.4
  }).addTo(map);

  // Position dot
  posMarker = L.circleMarker([lat, lng], {
    radius: 9, color: 'white', fillColor: '#3b82f6',
    fillOpacity: 1, weight: 3, zIndexOffset: 1000
  }).addTo(map);
}

export function startTracking(callbacks) {
  cbs        = callbacks || {};
  path       = [];
  autoFollow = true;

  _clearTrailLayers();

  // Walking trail line
  trailLine = L.polyline([], {
    color: '#10b981', weight: 5, opacity: 0.95,
    lineCap: 'round', lineJoin: 'round'
  }).addTo(map);

  // Live area preview (fills in as you walk)
  previewPoly = L.polygon([], {
    color: '#10b981', fillColor: '#10b981',
    fillOpacity: 0.15, weight: 2,
    dashArray: '6,5'
  }).addTo(map);

  if (!('geolocation' in navigator)) {
    cbs.onError && cbs.onError({ message: 'Geolocation not supported' });
    return;
  }

  watchID = navigator.geolocation.watchPosition(
    _onGPSUpdate,
    err => { console.error("GPS error:", err); cbs.onError && cbs.onError(err); },
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 }
  );
}

export function stopTracking() {
  if (watchID !== null) {
    navigator.geolocation.clearWatch(watchID);
    watchID = null;
  }
  _clearTrailLayers();
  path = [];
}

export function renderTerritories(territories, currentUserId) {
  Object.values(layers).forEach(l => { try { l.remove(); } catch (_) {} });
  layers = {};
  if (!map) return;

  territories.forEach(t => {
    if (!t.coordinates || t.coordinates.length < 3) return;
    try {
      const latlngs = _normCoords(t.coordinates);
      const mine    = t.userId === currentUserId;
      const poly    = L.polygon(latlngs, {
        color:       t.color || '#3b82f6',
        fillColor:   t.color || '#3b82f6',
        fillOpacity: mine ? 0.40 : 0.18,
        weight:      mine ? 3    : 1.5,
        opacity:     mine ? 1    : 0.7
      }).addTo(map);

      poly.bindPopup(
        `<div style="font-family:sans-serif;font-size:13px;padding:2px">
          <strong>${_esc(t.displayName || 'Unknown')}</strong><br>
          ${_fmtArea(t.area)} captured
          ${mine ? '<br><span style="color:#10b981;font-weight:700">✓ Yours</span>' : ''}
        </div>`
      );
      layers[t.id] = poly;
    } catch (e) { console.warn("Territory render error:", e); }
  });
}

export function panToUser() {
  if (posMarker && map) {
    autoFollow = true;
    map.setView(posMarker.getLatLng(), 17, { animate: true });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  GPS UPDATE — fires every time the device sends a new position
// ══════════════════════════════════════════════════════════════════════════════

function _onGPSUpdate(pos) {
  const lat      = pos.coords.latitude;
  const lng      = pos.coords.longitude;
  const accuracy = pos.coords.accuracy || 20;
  const now      = Date.now();

  // 1 ── Move position dot and accuracy ring
  _moveDot(lat, lng, accuracy);

  // 2 ── Auto-follow: keep map centred on player
  if (autoFollow && map) {
    map.panTo([lat, lng], { animate: true, duration: 0.5 });
  }

  // 3 ── Anti-cheat
  if (path.length > 0) {
    const prev    = path[path.length - 1];
    const elapsed = (now - prev.time) / 1000;
    const { cheat, reason } = detectCheat(prev, { lat, lng }, elapsed);
    if (cheat) {
      console.warn("Cheat detected:", reason);
      cbs.onCheatDetected && cbs.onCheatDetected(reason);
      return;
    }
  }

  // 4 ── Record point
  path.push({ lat, lng, time: now });

  const latlngs = path.map(p => [p.lat, p.lng]);

  // 5 ── Redraw trail line in real time
  if (trailLine) trailLine.setLatLngs(latlngs);

  // 6 ── Update live area preview polygon
  if (previewPoly && path.length >= 3) previewPoly.setLatLngs(latlngs);

  // 7 ── Start marker on first fix
  if (path.length === 1) {
    startMarker = L.circleMarker([lat, lng], {
      radius: 12, color: '#10b981', fillColor: '#10b981',
      fillOpacity: 0.4, weight: 2.5
    }).bindTooltip('🟢 Start — return here!', {
      permanent: true, direction: 'top', offset: [0, -14]
    }).addTo(map);
  }

  // 8 ── Cumulative distance
  let totalKm = 0;
  for (let i = 1; i < path.length; i++) totalKm += haversineKm(path[i - 1], path[i]);

  // 9 ── Notify app
  cbs.onPositionUpdate && cbs.onPositionUpdate({ lat, lng, totalKm, points: path.length, accuracy });

  // 10 ── Loop closure detection
  if (path.length < MIN_POINTS || totalKm < MIN_PATH_KM) return;

  const distToStart = haversineKm({ lat, lng }, path[0]);

  // Pulse start marker orange when player is close
  if (startMarker) {
    if (distToStart < CLOSE_RADIUS_KM * 4) {
      startMarker.setStyle({ color: '#f59e0b', fillColor: '#f59e0b', fillOpacity: 0.8, radius: 16 });
      startMarker.setTooltipContent('🔁 Almost there — close the loop!');
    } else {
      startMarker.setStyle({ color: '#10b981', fillColor: '#10b981', fillOpacity: 0.4, radius: 12 });
      startMarker.setTooltipContent('🟢 Start — return here!');
    }
  }

  // ── Auto-close the loop ─────────────────────────────────────────────────────
  if (distToStart < CLOSE_RADIUS_KM) {
    const closedPath = [...latlngs, [path[0].lat, path[0].lng]];

    stopTracking(); // clears trail layers

    // Brief green flash of the captured area
    if (map) {
      const flash = L.polygon(closedPath, {
        color: '#10b981', fillColor: '#10b981', fillOpacity: 0.5, weight: 3
      }).addTo(map);
      setTimeout(() => { try { flash.remove(); } catch (_) {} }, 2500);
    }

    cbs.onLoopClosed && cbs.onLoopClosed(closedPath, totalKm);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════════════════════════

function _moveDot(lat, lng, accuracy) {
  if (posMarker)     posMarker.setLatLng([lat, lng]);
  if (accuracyCircle) {
    accuracyCircle.setLatLng([lat, lng]);
    accuracyCircle.setRadius(Math.max(accuracy, 8));
  }
}

function _clearTrailLayers() {
  [trailLine, previewPoly, startMarker].forEach(l => {
    if (l) { try { l.remove(); } catch (_) {} }
  });
  trailLine = previewPoly = startMarker = null;
}

function _normCoords(arr) {
  return arr.map(c => Array.isArray(c) ? c : [c.lat, c.lng]);
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
