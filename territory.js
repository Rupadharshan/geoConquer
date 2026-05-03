// territory.js — Territory capture + stealing via Turf.js polygon operations

import { db } from "./firebase.js";
import {
  collection, addDoc, updateDoc, deleteDoc, doc,
  onSnapshot, getDocs, query, where, setDoc, getDoc
} from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";

// Palette of distinct player colours, assigned deterministically from uid hash
const PALETTE = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A',
  '#98FB98', '#DDA0DD', '#FFD700', '#87CEEB',
  '#FF69B4', '#20B2AA', '#FFA500', '#9370DB',
  '#00FA9A', '#FF4500', '#1E90FF', '#ADFF2F'
];

// ── Public helpers ────────────────────────────────────────────────────────────

/** Return a deterministic colour string for a given userId. */
export function getUserColor(userId) {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = userId.charCodeAt(i) + ((h << 5) - h);
  return PALETTE[Math.abs(h) % PALETTE.length];
}

/**
 * Calculate polygon area in square metres.
 * @param {Array} path  [[lat,lng], …] or [{lat,lng}, …]
 */
export function calculateArea(path) {
  try {
    const coords = toTurfRing(path);
    if (coords.length < 4) return 0;
    return Math.round(turf.area(turf.polygon([coords])));
  } catch (e) {
    console.warn("calculateArea error:", e);
    return 0;
  }
}

// ── Firestore listeners ───────────────────────────────────────────────────────

/**
 * Real-time listener that fires whenever the territories collection changes.
 * @returns unsubscribe function
 */
export function listenTerritories(callback) {
  return onSnapshot(collection(db, "territories"), snap => {
    const list = [];
    snap.forEach(d => list.push({ id: d.id, ...d.data() }));
    callback(list);
  });
}

// ── Core: capture a territory ─────────────────────────────────────────────────

/**
 * Save the player's captured loop to Firestore, stealing overlapping land from rivals.
 *
 * @param {string} userId
 * @param {string} displayName
 * @param {string} color        hex colour for this player
 * @param {Array}  path         closed [[lat,lng],…] array (last point === first point)
 * @returns {{ success:boolean, area?:number, stolenFrom?:number, reason?:string }}
 */
export async function captureTerritory(userId, displayName, color, path) {
  try {
    const area = calculateArea(path);
    if (area < 50) return { success: false, reason: "Territory too small (min ~50 m²). Try a wider loop!" };

    const newTurfPoly = pathToTurfPoly(path);
    if (!newTurfPoly) return { success: false, reason: "Invalid polygon shape." };

    // ── Load all existing territories and process overlaps ──────────────────
    const snap = await getDocs(collection(db, "territories"));
    let stolenFrom = 0;

    for (const docSnap of snap.docs) {
      const t = docSnap.data();
      if (t.userId === userId) continue;  // never steal from yourself

      try {
        const existingPoly = pathToTurfPoly(t.coordinates);
        if (!existingPoly) continue;

        // Is there any overlap at all?
        const intersection = turf.intersect(existingPoly, newTurfPoly);
        if (!intersection || turf.area(intersection) < 1) continue;

        stolenFrom++;
        const remaining = turf.difference(existingPoly, newTurfPoly);

        if (!remaining || turf.area(remaining) < 5) {
          // Entire territory consumed
          await deleteDoc(doc(db, "territories", docSnap.id));
        } else if (remaining.geometry.type === 'Polygon') {
          // Partially stolen
          const newCoords = turfRingToPath(remaining.geometry.coordinates[0]);
          await updateDoc(doc(db, "territories", docSnap.id), {
            coordinates: newCoords,
            area: Math.round(turf.area(remaining))
          });
        } else {
          // Polygon split into multiple pieces (MultiPolygon)
          await deleteDoc(doc(db, "territories", docSnap.id));
          for (const ring of remaining.geometry.coordinates) {
            const pieceArea = Math.round(turf.area(turf.polygon([ring[0]])));
            if (pieceArea > 5) {
              await addDoc(collection(db, "territories"), {
                userId:      t.userId,
                displayName: t.displayName,
                color:       t.color,
                coordinates: turfRingToPath(ring[0]),
                area:        pieceArea,
                timestamp:   Date.now()
              });
            }
          }
        }

        // Recalculate the victim's total area
        await recalcPlayerArea(t.userId);

      } catch (overlapErr) {
        console.warn("Overlap processing error for territory", docSnap.id, overlapErr);
      }
    }

    // ── Save the new territory ──────────────────────────────────────────────
    await addDoc(collection(db, "territories"), {
      userId,
      displayName,
      color,
      coordinates: path.map(p => Array.isArray(p) ? { lat: p[0], lng: p[1] } : p),
      area,
      timestamp: Date.now()
    });

    await recalcPlayerArea(userId);

    return { success: true, area, stolenFrom };

  } catch (err) {
    console.error("captureTerritory failed:", err);
    return { success: false, reason: "Save failed: " + err.message };
  }
}

// ── Player stat helpers ───────────────────────────────────────────────────────

/**
 * Merge stats into the player's Firestore document (creates if absent).
 * @param {string} userId
 * @param {object} stats  e.g. { xp, totalDistance, displayName, color, email }
 */
export async function updatePlayerStats(userId, stats) {
  await setDoc(doc(db, "players", userId), stats, { merge: true });
}

/**
 * Fetch the player's Firestore document.
 * @returns {object|null}
 */
export async function getPlayerStats(userId) {
  const snap = await getDoc(doc(db, "players", userId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Recompute and persist the total territory area for one player. */
async function recalcPlayerArea(userId) {
  const q = query(collection(db, "territories"), where("userId", "==", userId));
  const snap = await getDocs(q);
  let total = 0;
  snap.forEach(d => { total += d.data().area || 0; });
  await setDoc(doc(db, "players", userId), { totalArea: total }, { merge: true });
}

/**
 * Convert a path ([[lat,lng]] or [{lat,lng}]) to a Turf.js polygon.
 * Turf expects GeoJSON which is [lng, lat] order.
 */
function pathToTurfPoly(path) {
  try {
    const ring = toTurfRing(path);
    if (ring.length < 4) return null;
    return turf.polygon([ring]);
  } catch (e) {
    return null;
  }
}

/**
 * Build a closed GeoJSON coordinate ring ([lng,lat]) from a path.
 */
function toTurfRing(path) {
  const coords = path.map(p => {
    if (Array.isArray(p)) return [p[1], p[0]]; // [lng, lat]
    return [p.lng, p.lat];
  });
  // Ensure the ring is closed
  const first = coords[0], last = coords[coords.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) coords.push(first);
  return coords;
}

/**
 * Convert a GeoJSON ring back to [{lat,lng}] objects for Firestore storage.
 */
function turfRingToPath(ring) {
  return ring.map(c => ({ lat: c[1], lng: c[0] }));
}