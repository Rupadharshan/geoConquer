// map.js — Leaflet map, GPS path tracking, loop-closure detection, territory rendering

import { detectCheat, haversineKm } from "./anticheat.js";

// ── Module state ───────────────────────────────────────────────────────────────
let map          = null;
let polyline     = null;   // current walking path drawn on the map
let startMarker  = null;   // pulsing circle at the start point
let posMarker    = null;   // blue dot for current position
let layers       = {};     // { [territoryId]: L.Polygon }

let path      = [];        // [{lat, lng, time}, …] accumulated GPS points
let watchID   = null;      // navigator.geolocation watchID
let cbs       = {};        // callbacks set by startTracking()

// ── Tuning knobs ──────────────────────────────────────────────────────────────
const CLOSE_RADIUS_KM = 0.020;   // 20 m — auto-close loop when within this distance of start
const MIN_PATH_KM     = 0.08;    // 80 m — minimum path before loop can close
const MIN_POINTS      = 6;       // need at least this many GPS fixes

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Initialise the Leaflet map centred on (lat, lng).
 * Safe to call multiple times – ignored after first call.
 */
export function initMap(lat, lng) {
  if (map) { map.setView([lat, lng], 17); return; }

  map = L.map("map", { zoomControl: false, attributionControl: true })
         .setView([lat, lng], 17);

  // OpenStreetMap tiles
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 20
  }).addTo(map);

  // Zoom control top-right
  L.control.zoom({ position: 'topright' }).addTo(map);

  // "Re-centre" button
  const locCtrl = L.control({ position: 'bottomright' });
  locCtrl.onAdd = () => {
    const div = L.DomUtil.create('div', 'leaflet-bar');
    div.innerHTML = '<a href="#" title="Centre on me" style="font-size:18px;display:flex;align-items:center;justify-content:center;width:34px;height:34px;text-decoration:none">📍</a>';
    L.DomEvent.on(div, 'click', L.DomEvent.stop);
    L.DomEvent.on(div, 'click', () => { if (posMarker) map.panTo(posMarker.getLatLng()); });
    return div;
  };
  locCtrl.addTo(map);

  // Player position marker
  posMarker = L.circleMarker([lat, lng], {
    radius: 8, color: 'white', fillColor: '#3b82f6',
    fillOpacity: 1, weight: 3, zIndexOffset: 1000
  }).addTo(map);
}

/**
 * Begin GPS tracking. Call after initMap().
 * @param {object} callbacks  { onPositionUpdate, onLoopClosed, onCheatDetected, onError }
 */
export function startTracking(callbacks) {
  cbs  = callbacks || {};
  path = [];

  // Fresh polyline
  if (polyline) { polyline.remove(); polyline = null; }
  if (startMarker) { startMarker.remove(); startMarker = null; }

  polyline = L.polyline([], {
    color: '#10b981', weight: 5, opacity: .9, lineCap: 'round', lineJoin: 'round'
  }).addTo(map);

  watchID = navigator.geolocation.watchPosition(
    onGPSUpdate,
    err => { console.error("GPS error:", err); cbs.onError && cbs.onError(err); },
    { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 }
  );
}

/**
 * Stop GPS tracking and clear the current path visuals.
 */
export function stopTracking() {
  if (watchID !== null) { navigator.geolocation.clearWatch(watchID); watchID = null; }
  if (polyline)    { polyline.remove();    polyline    = null; }
  if (startMarker) { startMarker.remove(); startMarker = null; }
  path = [];
}

/**
 * Re-render every territory polygon from the Firestore snapshot.
 * @param {Array}  territories   Array of territory objects from Firestore
 * @param {string} currentUserId UID of the logged-in player
 */
export function renderTerritories(territories, currentUserId) {
  // Remove old layers
  Object.values(layers).forEach(l => { try { l.remove(); } catch (_) {} });
  layers = {};
  if (!map) return;

  territories.forEach(t => {
    if (!t.coordinates || t.coordinates.length < 3) return;
    try {
      const latlngs = normCoords(t.coordinates);
      const mine    = t.userId === currentUserId;
      const poly    = L.polygon(latlngs, {
        color:       t.color || '#3b82f6',
        fillColor:   t.color || '#3b82f6',
        fillOpacity: mine ? 0.35 : 0.15,
        weight:      mine ? 3 : 1.5,
        opacity:     mine ? 1  : 0.7
      }).addTo(map);

      poly.bindPopup(
        `<div style="font-family:sans-serif;font-size:13px">
          <strong>${htmlEsc(t.displayName || 'Unknown')}</strong><br>
          ${fmtArea(t.area)}<br>
          ${mine ? '<span style="color:#10b981">✓ Your territory</span>' : ''}
        </div>`
      );
      layers[t.id] = poly;
    } catch (e) { console.warn("render territory error:", e); }
  });
}

/**
 * Pan the map to the player's current GPS position.
 */
export function panToUser() {
  if (posMarker && map) map.panTo(posMarker.getLatLng(), { animate: true });
}

// ── GPS update handler ────────────────────────────────────────────────────────

function onGPSUpdate(pos) {
  const lat = pos.coords.latitude;
  const lng = pos.coords.longitude;
  const now = Date.now();

  // Move position dot
  if (posMarker) posMarker.setLatLng([lat, lng]);

  // Anti-cheat vs previous point
  if (path.length > 0) {
    const prev = path[path.length - 1];
    const elapsed = (now - prev.time) / 1000;
    const { cheat, reason } = detectCheat(prev, { lat, lng }, elapsed);
    if (cheat) {
      console.warn("Cheat detected:", reason);
      cbs.onCheatDetected && cbs.onCheatDetected(reason);
      return;
    }
  }

  // Append point
  path.push({ lat, lng, time: now });
  if (polyline) polyline.setLatLngs(path.map(p => [p.lat, p.lng]));

  // Draw start marker on first fix
  if (path.length === 1) {
    startMarker = L.circleMarker([lat, lng], {
      radius: 11, color: '#10b981', fillColor: '#10b981', fillOpacity: 0.35, weight: 2
    }).addTo(map);
    startMarker.bindTooltip('Start', { permanent: true, direction: 'top', offset: [0, -10] });
  }

  // Cumulative path distance
  let totalKm = 0;
  for (let i = 1; i < path.length; i++) totalKm += haversineKm(path[i - 1], path[i]);

  // Notify app of position
  cbs.onPositionUpdate && cbs.onPositionUpdate({ lat, lng, totalKm, points: path.length });

  // ── Loop closure detection ──────────────────────────────────────────────────
  if (path.length < MIN_POINTS || totalKm < MIN_PATH_KM) return;

  const distToStart = haversineKm({ lat, lng }, path[0]);

  // Pulse start marker as player approaches
  if (startMarker) {
    if (distToStart < CLOSE_RADIUS_KM * 3) {
      startMarker.setStyle({ color: '#f59e0b', fillColor: '#f59e0b', fillOpacity: 0.7, radius: 16 });
      startMarker.setTooltipContent('🔁 Return here!');
    } else {
      startMarker.setStyle({ color: '#10b981', fillColor: '#10b981', fillOpacity: 0.35, radius: 11 });
      startMarker.setTooltipContent('Start');
    }
  }

  // Auto-close loop
  if (distToStart < CLOSE_RADIUS_KM) {
    const closedPath = [...path.map(p => [p.lat, p.lng]), [path[0].lat, path[0].lng]];
    stopTracking();
    cbs.onLoopClosed && cbs.onLoopClosed(closedPath, totalKm);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Accept [{lat,lng}] or [[lat,lng]] coordinate arrays. */
function normCoords(arr) {
  return arr.map(c => Array.isArray(c) ? c : [c.lat, c.lng]);
}

function fmtArea(m2) {
  if (!m2) return '0 m²';
  if (m2 > 1e6) return (m2 / 1e6).toFixed(2) + ' km²';
  if (m2 > 10000) return (m2 / 10000).toFixed(2) + ' ha';
  return Math.round(m2).toLocaleString() + ' m²';
}

function htmlEsc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}