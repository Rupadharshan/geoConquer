// leaderboard.js — Fetch and render the global leaderboard

import { db } from "./firebase.js";
import {
  collection, query, orderBy, limit, getDocs, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";

const TOP_N = 20; // How many players to show

/**
 * One-time fetch of the top players sorted by total territory area.
 * @returns {Promise<Array>} Sorted player objects
 */
export async function loadLeaderboard() {
  const q = query(
    collection(db, "players"),
    orderBy("totalArea", "desc"),
    limit(TOP_N)
  );
  const snap = await getDocs(q);
  const list = [];
  snap.forEach(d => list.push({ id: d.id, ...d.data() }));
  return list;
}

/**
 * Real-time leaderboard listener — calls callback whenever rankings change.
 * @param {Function} callback  Called with (Array of player objects)
 * @returns {Function} unsubscribe
 */
export function listenLeaderboard(callback) {
  const q = query(
    collection(db, "players"),
    orderBy("totalArea", "desc"),
    limit(TOP_N)
  );
  return onSnapshot(q, snap => {
    const list = [];
    snap.forEach(d => list.push({ id: d.id, ...d.data() }));
    callback(list);
  });
}

/**
 * Render leaderboard into a DOM container element.
 * @param {HTMLElement} container  The element to render into
 * @param {Array}       players    Player objects from Firestore
 * @param {string}      myUid      Current user's UID (to highlight self)
 */
export function renderLeaderboard(container, players, myUid) {
  if (!container) return;
  if (!players || players.length === 0) {
    container.innerHTML = '<p class="panel-loading">No players yet. Be the first to capture territory!</p>';
    return;
  }

  const medals = ['🥇', '🥈', '🥉'];

  container.innerHTML = players.map((p, i) => {
    const isMe    = p.id === myUid;
    const rank    = medals[i] || `#${i + 1}`;
    const name    = htmlEsc(p.displayName || p.email?.split('@')[0] || 'Player');
    const area    = fmtArea(p.totalArea || 0);
    const xp      = (p.xp || 0).toLocaleString();
    const color   = p.color || '#3b82f6';

    return `
      <div class="lb-item ${isMe ? 'lb-me' : ''}">
        <div class="lb-rank">${rank}</div>
        <div class="lb-color-dot" style="background:${color}"></div>
        <div class="lb-info">
          <div class="lb-name">${name}${isMe ? ' <span style="color:var(--primary);font-size:10px">(you)</span>' : ''}</div>
          <div class="lb-sub">${area} · ${xp} XP</div>
        </div>
      </div>
    `;
  }).join('');
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtArea(m2) {
  if (!m2 || m2 <= 0) return '0 m²';
  if (m2 >= 1_000_000)  return (m2 / 1_000_000).toFixed(2) + ' km²';
  if (m2 >= 10_000)     return (m2 / 10_000).toFixed(2)    + ' ha';
  return Math.round(m2).toLocaleString() + ' m²';
}

function htmlEsc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}