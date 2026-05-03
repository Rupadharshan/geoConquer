// anticheat.js
// Returns TRUE if cheating detected (boolean, same as ChatGPT version)
// Also exports haversineKm for distance calculations in app.js

export function detectCheat(prev, current, elapsedSeconds) {
  const dx   = current.lat - prev.lat;
  const dy   = current.lng - prev.lng;
  const dist = Math.sqrt(dx * dx + dy * dy) * 111;        // km
  const speed = dist / (elapsedSeconds / 3600);            // km/h

  if (speed > 40)  return true;   // faster than a car
  if (dist > 0.5)  return true;   // jumped more than 500m instantly
  return false;
}

// Accurate haversine distance in km between two {lat,lng} points
export function haversineKm(a, b) {
  const R    = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const s    = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
               Math.cos(a.lat * Math.PI / 180) *
               Math.cos(b.lat * Math.PI / 180) *
               Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}
