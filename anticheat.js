// anticheat.js — Detect impossible GPS movement

const MAX_SPEED_KMH  = 15;   // Faster than a sprint → cheat (reduced from 40 for foot traffic only)
const MAX_JUMP_KM    = 0.3;  // Max single-step jump (300 m in one GPS update)
const MIN_INTERVAL_S = 0.5;  // Ignore updates closer than 500 ms

/**
 * Check whether movement between two GPS positions in a given time is physically possible.
 *
 * @param {{lat:number, lng:number}} prev     Previous position
 * @param {{lat:number, lng:number}} current  Current position
 * @param {number} elapsedSeconds             Time since previous position was recorded
 * @returns {{ cheat: boolean, reason: string|null, speedKmh: number, distKm: number }}
 */
export function detectCheat(prev, current, elapsedSeconds) {
  const dx    = current.lat - prev.lat;
  const dy    = current.lng - prev.lng;
  const distKm = Math.sqrt(dx * dx + dy * dy) * 111.195; // 1° ≈ 111.195 km

  // Ignore near-duplicate updates
  if (elapsedSeconds < MIN_INTERVAL_S) {
    return { cheat: false, reason: null, speedKmh: 0, distKm };
  }

  const speedKmh = distKm / (elapsedSeconds / 3600);

  if (distKm > MAX_JUMP_KM) {
    return { cheat: true, reason: `Position jumped ${(distKm * 1000).toFixed(0)} m instantly`, speedKmh, distKm };
  }

  if (speedKmh > MAX_SPEED_KMH) {
    return { cheat: true, reason: `Speed ${speedKmh.toFixed(1)} km/h exceeds limit`, speedKmh, distKm };
  }

  return { cheat: false, reason: null, speedKmh, distKm };
}

/**
 * Quick haversine distance (km) between two {lat,lng} objects.
 */
export function haversineKm(a, b) {
  const R  = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const chord = sinLat * sinLat +
    Math.cos(a.lat * Math.PI / 180) *
    Math.cos(b.lat * Math.PI / 180) *
    sinLng * sinLng;
  return R * 2 * Math.atan2(Math.sqrt(chord), Math.sqrt(1 - chord));
}