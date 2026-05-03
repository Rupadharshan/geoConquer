// challenges.js — Daily challenge generation, tracking, and rendering

import { db } from "./firebase.js";
import {
  doc, getDoc, setDoc
} from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";

// ── Challenge definitions ──────────────────────────────────────────────────────
// Each template generates a concrete challenge instance when needed.
const TEMPLATES = [
  {
    id: 'walk_500',
    title: '🚶 Take a 500 m walk',
    desc: 'Travel at least 500 m during a capture attempt.',
    target: 0.5,   // km
    metric: 'distanceKm',
    xp: 50
  },
  {
    id: 'walk_1k',
    title: '🏃 Run a full kilometre',
    desc: 'Cover 1 km in a single session.',
    target: 1.0,
    metric: 'distanceKm',
    xp: 100
  },
  {
    id: 'capture_once',
    title: '🏳️ First blood',
    desc: 'Capture 1 territory today.',
    target: 1,
    metric: 'captureCount',
    xp: 75
  },
  {
    id: 'capture_3',
    title: '⚔️ Triple threat',
    desc: 'Capture 3 territories today.',
    target: 3,
    metric: 'captureCount',
    xp: 150
  },
  {
    id: 'area_1000',
    title: '📐 Cover 1 000 m²',
    desc: 'Capture a combined area of 1 000 m² today.',
    target: 1000,
    metric: 'areaCaptured',
    xp: 100
  },
  {
    id: 'area_5000',
    title: '🗾 Land baron',
    desc: 'Capture 5 000 m² in a single day.',
    target: 5000,
    metric: 'areaCaptured',
    xp: 200
  },
  {
    id: 'steal_1',
    title: '🦊 Thief!',
    desc: 'Steal land from at least 1 other player.',
    target: 1,
    metric: 'territoriesStolen',
    xp: 125
  },
  {
    id: 'big_loop',
    title: '🔵 Big loop',
    desc: 'Capture a single territory larger than 2 500 m².',
    target: 2500,
    metric: 'singleArea',
    xp: 175
  }
];

// How many challenges per day
const DAILY_COUNT = 3;

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Return today's date string as "YYYY-MM-DD" in local time. */
function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Deterministically pick today's challenges for a given user.
 * Uses a simple seeded hash so the same user sees the same 3 challenges all day.
 */
function pickTodayChallenges(userId) {
  const seed = todayKey() + userId;
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;

  const shuffled = [...TEMPLATES];
  for (let i = shuffled.length - 1; i > 0; i--) {
    h = (Math.imul(h, 1664525) + 1013904223) | 0;
    const j = Math.abs(h) % (i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, DAILY_COUNT);
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Load or initialise today's challenges for a player.
 * Creates Firestore doc if it doesn't exist for today.
 * @returns {Promise<Array>}  Array of challenge objects with progress fields
 */
export async function getDailyChallenges(userId) {
  const key  = todayKey();
  const ref  = doc(db, "challenges", `${userId}_${key}`);
  const snap = await getDoc(ref);

  if (snap.exists()) {
    return snap.data().challenges;
  }

  // First time today — seed fresh challenges with 0 progress
  const fresh = pickTodayChallenges(userId).map(t => ({
    ...t,
    progress:  0,
    completed: false,
    dateKey:   key
  }));

  await setDoc(ref, { userId, dateKey: key, challenges: fresh });
  return fresh;
}

/**
 * After a successful capture, advance progress on all relevant metrics,
 * award XP for newly completed challenges, and persist.
 *
 * @param {string} userId
 * @param {object} event   { distanceKm, captureCount, areaCaptured, territoriesStolen, singleArea }
 * @returns {Promise<{ challenges:Array, xpAwarded:number, newlyCompleted:string[] }>}
 */
export async function progressChallenges(userId, event) {
  const key        = todayKey();
  const ref        = doc(db, "challenges", `${userId}_${key}`);
  const snap       = await getDoc(ref);
  const challenges = snap.exists() ? snap.data().challenges : await getDailyChallenges(userId);

  let xpAwarded      = 0;
  const newlyCompleted = [];

  const updated = challenges.map(ch => {
    if (ch.completed) return ch;

    const increment = event[ch.metric] || 0;

    // "singleArea" is a one-shot max, not cumulative
    const newProgress = ch.metric === 'singleArea'
      ? Math.max(ch.progress, increment)
      : ch.progress + increment;

    const nowDone = newProgress >= ch.target;

    if (nowDone && !ch.completed) {
      xpAwarded += ch.xp;
      newlyCompleted.push(ch.title);
    }

    return { ...ch, progress: newProgress, completed: nowDone };
  });

  await setDoc(ref, { userId, dateKey: key, challenges: updated }, { merge: true });

  return { challenges: updated, xpAwarded, newlyCompleted };
}

/**
 * Render challenge cards into a container element.
 * @param {HTMLElement} container
 * @param {Array}       challenges  From getDailyChallenges / progressChallenges
 */
export function renderChallenges(container, challenges) {
  if (!container) return;
  if (!challenges || challenges.length === 0) {
    container.innerHTML = '<p class="panel-loading">No challenges today.</p>';
    return;
  }

  container.innerHTML = challenges.map(ch => {
    const pct     = Math.min(100, Math.round((ch.progress / ch.target) * 100));
    const done    = ch.completed;
    const progTxt = formatProgress(ch);

    return `
      <div class="challenge-item ${done ? 'done' : ''}">
        <div class="ch-header">
          <div class="ch-title">${done ? '✅ ' : ''}${ch.title}</div>
          <div class="ch-xp">+${ch.xp} XP</div>
        </div>
        <div class="ch-bar">
          <div class="ch-fill" style="width:${pct}%"></div>
        </div>
        <div class="ch-sub">${progTxt} — ${ch.desc}</div>
      </div>
    `;
  }).join('');
}

// ── Internal ───────────────────────────────────────────────────────────────────

function formatProgress(ch) {
  const { progress, target, metric, completed } = ch;
  if (completed) return 'Completed!';

  switch (metric) {
    case 'distanceKm':
      return `${(progress || 0).toFixed(2)} / ${target} km`;
    case 'captureCount':
    case 'territoriesStolen':
      return `${progress || 0} / ${target}`;
    case 'areaCaptured':
    case 'singleArea':
      return `${Math.round(progress || 0).toLocaleString()} / ${target.toLocaleString()} m²`;
    default:
      return `${progress || 0} / ${target}`;
  }
}