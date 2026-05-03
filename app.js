// app.js
// watchPosition is structured EXACTLY like the working ChatGPT version —
// updatePath(lat, lng) is called first, THEN cheat check.
// Nothing blocks the map update.

import { signup, login, googleLogin, logout, listenAuth } from "./auth.js";
import {
  initMap, updatePath, getPath, getAndClearPath,
  clearPath, flashCapture, renderTerritories
} from "./map.js";
import { detectCheat } from "./anticheat.js";
import {
  captureTerritory, getUserColor,
  updatePlayerStats, getPlayerStats, listenTerritories
} from "./territory.js";
import { listenLeaderboard, renderLeaderboard } from "./leaderboard.js";
import { getDailyChallenges, progressChallenges, renderChallenges } from "./challenges.js";

// ── State ──────────────────────────────────────────────────────────────────
let currentUser  = null;
let playerStats  = null;
let playerColor  = null;
let watchID      = null;
let isTracking   = false;

// Same variables as ChatGPT version
let prevPos   = null;
let prevTime  = null;
let distance  = 0;    // km — same name as ChatGPT
let xp        = 0;
let totalDistKm = 0;

let activeChallenges = [];
let unsubTerritories = null;
let unsubLeaderboard = null;

// ── DOM ────────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const el = {
  authScreen:      $('authScreen'),
  gameScreen:      $('gameScreen'),
  loginEmail:      $('loginEmail'),
  loginPass:       $('loginPass'),
  loginBtn:        $('loginBtn'),
  googleBtn:       $('googleBtn'),
  signupName:      $('signupName'),
  signupEmail:     $('signupEmail'),
  signupPass:      $('signupPass'),
  signupBtn:       $('signupBtn'),
  authError:       $('authError'),
  menuBtn:         $('menuBtn'),
  sidePanel:       $('sidePanel'),
  panelBackdrop:   $('panelBackdrop'),
  leaderboardList: $('leaderboardList'),
  challengesList:  $('challengesList'),
  myStats:         $('myStats'),
  logoutBtn:       $('logoutBtn'),
  startBtn:        $('startBtn'),
  stopBtn:         $('stopBtn'),
  statusText:      $('statusText'),
  pathInfo:        $('pathInfo'),
  playerName:      $('playerName'),
  playerXP:        $('playerXP'),
  playerAvatar:    $('playerAvatar'),
  headerArea:      $('headerArea'),
  captureOverlay:  $('captureOverlay'),
  captureTitle:    $('captureTitle'),
  captureDetails:  $('captureDetails'),
  toast:           $('toast'),
};

// ══════════════════════════════════════════════════════════════════════════
//  AUTH SCREEN
// ══════════════════════════════════════════════════════════════════════════

window.switchAuthTab = function(tab, btn) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  $('loginTab').style.display  = tab === 'login'  ? 'flex' : 'none';
  $('signupTab').style.display = tab === 'signup' ? 'flex' : 'none';
  el.authError.textContent = '';
};

el.loginBtn.onclick = async () => {
  el.authError.textContent = '';
  el.loginBtn.disabled     = true;
  el.loginBtn.textContent  = 'Logging in…';
  try {
    await login(el.loginEmail.value.trim(), el.loginPass.value);
  } catch(e) {
    el.authError.textContent = authErr(e.code);
    el.loginBtn.disabled     = false;
    el.loginBtn.textContent  = 'Login';
  }
};

el.signupBtn.onclick = async () => {
  el.authError.textContent = '';
  const name  = el.signupName.value.trim();
  const email = el.signupEmail.value.trim();
  const pass  = el.signupPass.value;
  if (!name)           return (el.authError.textContent = 'Enter a display name.');
  if (!email)          return (el.authError.textContent = 'Enter an email address.');
  if (pass.length < 6) return (el.authError.textContent = 'Password needs 6+ characters.');
  el.signupBtn.disabled    = true;
  el.signupBtn.textContent = 'Creating…';
  try {
    await signup(email, pass, name);
  } catch(e) {
    el.authError.textContent = authErr(e.code);
    el.signupBtn.disabled    = false;
    el.signupBtn.textContent = 'Create Account';
  }
};

el.googleBtn.onclick = async () => {
  el.authError.textContent = '';
  try { await googleLogin(); }
  catch(e) { el.authError.textContent = authErr(e.code); }
};

// ══════════════════════════════════════════════════════════════════════════
//  AUTH STATE
// ══════════════════════════════════════════════════════════════════════════

listenAuth(async user => {
  if (user) {
    currentUser = user;
    playerColor = getUserColor(user.uid);
    await initGame();
  } else {
    currentUser = null;
    teardown();
  }
});

// ══════════════════════════════════════════════════════════════════════════
//  GAME INIT — same structure as ChatGPT's listenAuth + startLocation
// ══════════════════════════════════════════════════════════════════════════

async function initGame() {
  el.authScreen.style.display = 'none';
  el.gameScreen.style.display = 'flex';

  playerStats = await getPlayerStats(currentUser.uid);
  const displayName = currentUser.displayName
    || playerStats?.displayName
    || currentUser.email.split('@')[0];
  totalDistKm = playerStats?.totalDistance || 0;

  await updatePlayerStats(currentUser.uid, {
    displayName, email: currentUser.email,
    color: playerColor, photoURL: currentUser.photoURL || null
  });
  playerStats = await getPlayerStats(currentUser.uid);
  refreshHeader(displayName, playerStats?.xp || 0, playerStats?.totalArea || 0);

  // ── startLocation() — same as ChatGPT ───────────────────────────────────
  navigator.geolocation.getCurrentPosition(
    pos => {
      initMap(pos.coords.latitude, pos.coords.longitude);
      showToast('📍 Map ready! Press Start to capture.');
    },
    err => {
      console.error('GPS init error:', err);
      showToast('⚠️ Enable GPS permission and refresh.', 6000);
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  );

  // Firestore listeners
  unsubTerritories = listenTerritories(list =>
    renderTerritories(list, currentUser.uid));
  unsubLeaderboard = listenLeaderboard(players =>
    renderLeaderboard(el.leaderboardList, players, currentUser.uid));

  activeChallenges = await getDailyChallenges(currentUser.uid);
  renderChallenges(el.challengesList, activeChallenges);
  refreshMyStats();
}

function teardown() {
  stopWatch();
  unsubTerritories && unsubTerritories();
  unsubLeaderboard && unsubLeaderboard();
  el.gameScreen.style.display = 'none';
  el.authScreen.style.display = 'flex';
  resetUI();
}

// ══════════════════════════════════════════════════════════════════════════
//  START BUTTON
//  Structured identically to ChatGPT's working version.
//  updatePath is called FIRST — nothing blocks it.
// ══════════════════════════════════════════════════════════════════════════

el.startBtn.onclick = () => {
  if (!currentUser || isTracking) return;

  isTracking = true;
  prevPos    = null;
  prevTime   = null;
  distance   = 0;
  xp         = 0;

  clearPath();

  el.startBtn.style.display = 'none';
  el.stopBtn.style.display  = 'inline-flex';
  el.statusText.textContent = '📍 Tracking… walk in a loop!';
  el.pathInfo.textContent   = '0 m walked';

  // iOS 13+ compass permission — request on user gesture
  if (window._compassNeedsPermission &&
      typeof DeviceOrientationEvent.requestPermission === 'function') {
    DeviceOrientationEvent.requestPermission().catch(() => {});
  }

  // ── watchPosition — SAME STRUCTURE AS CHATGPT ──────────────────────────
  watchID = navigator.geolocation.watchPosition(
    pos => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const now = Date.now();

      // ── Step 1: UPDATE MAP IMMEDIATELY (like ChatGPT does first) ─────────
      updatePath(lat, lng);

      // ── Step 2: Then do cheat check + distance (same as ChatGPT) ─────────
      if (prevPos) {
        const elapsed = (now - prevTime) / 1000;

        if (elapsed > 0.3) {   // ignore duplicate rapid-fire updates
          const cheat = detectCheat(prevPos, { lat, lng }, elapsed);
          if (cheat) {
            showToast('🚫 Anti-cheat: movement too fast!', 4000);
            stopWatch();
            clearPath();
            resetUI();
            return;
          }
          // Accumulate distance (same formula as ChatGPT)
          const dx = lat - prevPos.lat;
          const dy = lng - prevPos.lng;
          distance += Math.sqrt(dx * dx + dy * dy) * 111;
          xp = Math.floor(distance * 100);
        }
      }

      prevPos  = { lat, lng };
      prevTime = now;

      // ── Step 3: Update status bar ────────────────────────────────────────
      const distM = Math.round(distance * 1000);
      el.pathInfo.textContent   = `📏 ${distM} m walked`;
      el.statusText.textContent = distM >= 80
        ? '🔵 Return to start to capture!'
        : '📍 Tracking… walk in a loop!';

      // ── Step 4: Check if loop is closed ──────────────────────────────────
      const path = getPath();
      if (path.length >= 6 && distance >= 0.05) {
        const dx      = lat - path[0][0];
        const dy      = lng - path[0][1];
        const distToStart = Math.sqrt(dx * dx + dy * dy) * 111195; // metres
        if (distToStart < 20) {
          closeLoop();
        }
      }
    },

    // Error handler
    err => {
      console.error('watchPosition err:', err.code, err.message);
      showToast(
        err.code === 1
          ? '❌ GPS permission denied — enable in browser settings.'
          : '⚠️ GPS signal lost — stay outdoors.',
        5000
      );
    },

    // Options — maximumAge:0 forces fresh GPS every time (critical for live updates)
    { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
  );
};

// ── Stop button — same as ChatGPT stopBtn ─────────────────────────────────
el.stopBtn.onclick = () => {
  stopWatch();
  clearPath();
  showToast('🛑 Session cancelled.');
  resetUI();
};

function stopWatch() {
  if (watchID !== null) {
    navigator.geolocation.clearWatch(watchID);
    watchID = null;
  }
  isTracking = false;
}

// ══════════════════════════════════════════════════════════════════════════
//  LOOP CLOSED — save territory
// ══════════════════════════════════════════════════════════════════════════

async function closeLoop() {
  stopWatch();

  const rawPath = getAndClearPath();
  if (rawPath.length < 4) {
    showToast('❌ Path too short.');
    resetUI();
    return;
  }

  const closed = [...rawPath, rawPath[0]];   // close the polygon
  el.statusText.textContent = '⏳ Saving territory…';
  el.pathInfo.textContent   = '';

  flashCapture(closed);

  const displayName = currentUser.displayName
    || playerStats?.displayName
    || currentUser.email.split('@')[0];

  const result = await captureTerritory(
    currentUser.uid, displayName, playerColor, closed
  );

  if (!result.success) {
    showToast(`❌ ${result.reason || 'Capture failed'}`, 4000);
    resetUI();
    return;
  }

  // XP
  const xpArea  = Math.floor(result.area / 10);
  const xpDist  = Math.floor(distance * 100);
  const xpSteal = (result.stolenFrom || 0) * 25;
  const xpTotal = xpArea + xpDist + xpSteal;

  totalDistKm += distance;
  const newXP  = (playerStats?.xp || 0) + xpTotal;

  await updatePlayerStats(currentUser.uid, { xp: newXP, totalDistance: totalDistKm });

  // Challenges
  const { challenges, xpAwarded, newlyCompleted } = await progressChallenges(
    currentUser.uid, {
      distanceKm:        distance,
      captureCount:      1,
      areaCaptured:      result.area,
      territoriesStolen: result.stolenFrom || 0,
      singleArea:        result.area
    }
  );
  activeChallenges = challenges;
  renderChallenges(el.challengesList, activeChallenges);

  await updatePlayerStats(currentUser.uid, { xp: newXP + xpAwarded });
  playerStats = await getPlayerStats(currentUser.uid);

  refreshHeader(
    playerStats.displayName || displayName,
    playerStats.xp || 0,
    playerStats.totalArea || 0
  );
  refreshMyStats();

  // Celebration
  el.captureTitle.textContent = result.stolenFrom
    ? `Captured + stole from ${result.stolenFrom} rival${result.stolenFrom > 1 ? 's':''}! 🦊`
    : 'Territory Captured! 🎉';

  let det = `<strong>${fmtArea(result.area)}</strong> claimed<br>`;
  det    += `<strong>+${xpTotal} XP</strong> earned`;
  if (newlyCompleted.length) {
    det += `<br><br>🎯 <strong>Challenge done!</strong><br>`;
    det += newlyCompleted.map(t => `• ${t}`).join('<br>');
    det += `<br>+${xpAwarded} bonus XP`;
  }
  el.captureDetails.innerHTML = det;
  el.captureOverlay.style.display = 'flex';

  resetUI();
}

// ══════════════════════════════════════════════════════════════════════════
//  SIDE PANEL
// ══════════════════════════════════════════════════════════════════════════

el.menuBtn.onclick = () => {
  el.sidePanel.classList.add('open');
  el.panelBackdrop.classList.add('visible');
  refreshMyStats();
};
window.closePanel = () => {
  el.sidePanel.classList.remove('open');
  el.panelBackdrop.classList.remove('visible');
};
window.showPanelTab = (name, btn) => {
  document.querySelectorAll('.panel-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  $('panelLeaderboard').style.display = name === 'Leaderboard' ? 'block' : 'none';
  $('panelChallenges').style.display  = name === 'Challenges'  ? 'block' : 'none';
  $('panelStats').style.display       = name === 'Stats'       ? 'block' : 'none';
};
el.logoutBtn.onclick = async () => { window.closePanel(); await logout(); };

// ══════════════════════════════════════════════════════════════════════════
//  UI HELPERS
// ══════════════════════════════════════════════════════════════════════════

function refreshHeader(name, xp, area) {
  el.playerName.textContent   = name.length > 18 ? name.slice(0,17)+'…' : name;
  el.playerXP.textContent     = `${xp.toLocaleString()} XP`;
  el.headerArea.textContent   = fmtArea(area);
  el.playerAvatar.textContent = name.charAt(0).toUpperCase();
  el.playerAvatar.style.background = playerColor || '#3b82f6';
}

function refreshMyStats() {
  if (!el.myStats || !playerStats) return;
  const p = playerStats;
  el.myStats.innerHTML = `
    <div class="stat-row">
      <span class="stat-label">Name</span>
      <span class="stat-val">${p.displayName||'—'}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Total XP</span>
      <span class="stat-val" style="color:var(--warning)">${(p.xp||0).toLocaleString()} XP</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Territory</span>
      <span class="stat-val" style="color:var(--success)">${fmtArea(p.totalArea||0)}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Distance</span>
      <span class="stat-val">${totalDistKm.toFixed(2)} km</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Colour</span>
      <span class="stat-val">
        <span style="display:inline-block;width:14px;height:14px;border-radius:50%;
          background:${playerColor};vertical-align:middle;margin-right:6px"></span>
        ${playerColor}
      </span>
    </div>`;
}

function resetUI() {
  isTracking = false;
  el.startBtn.style.display = 'inline-flex';
  el.stopBtn.style.display  = 'none';
  el.statusText.textContent = '🟢 Ready to explore';
  el.pathInfo.textContent   = 'Press Start and walk to capture territory';
}

let _tt = null;
function showToast(msg, ms = 3000) {
  el.toast.textContent   = msg;
  el.toast.style.display = 'block';
  clearTimeout(_tt);
  _tt = setTimeout(() => { el.toast.style.display = 'none'; }, ms);
}

function fmtArea(m2) {
  if (!m2 || m2 <= 0) return '0 m²';
  if (m2 >= 1e6) return (m2/1e6).toFixed(2)+' km²';
  if (m2 >= 1e4) return (m2/1e4).toFixed(2)+' ha';
  return Math.round(m2).toLocaleString()+' m²';
}

function authErr(code) {
  const m = {
    'auth/user-not-found':         'No account with that email.',
    'auth/wrong-password':         'Wrong password.',
    'auth/invalid-credential':     'Wrong email or password.',
    'auth/email-already-in-use':   'Email already registered.',
    'auth/weak-password':          'Password needs 6+ characters.',
    'auth/invalid-email':          'Invalid email address.',
    'auth/popup-closed-by-user':   'Google sign-in cancelled.',
    'auth/network-request-failed': 'Network error.',
    'auth/too-many-requests':      'Too many attempts — wait a moment.'
  };
  return m[code] || `Error (${code})`;
}
