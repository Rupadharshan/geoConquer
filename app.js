// app.js — Main orchestrator.
// watchPosition lives HERE for maximum mobile reliability.

import { signup, login, googleLogin, logout, listenAuth } from "./auth.js";
import {
  initMap, updatePath, getPath, getAndClearPath,
  clearPath, flashCapture, renderTerritories
} from "./map.js";
import { detectCheat, haversineKm } from "./anticheat.js";
import {
  captureTerritory, getUserColor,
  updatePlayerStats, getPlayerStats,
  calculateArea, listenTerritories
} from "./territory.js";
import { listenLeaderboard, renderLeaderboard } from "./leaderboard.js";
import { getDailyChallenges, progressChallenges, renderChallenges } from "./challenges.js";

// ── State ──────────────────────────────────────────────────────────────────────
let currentUser  = null;
let playerStats  = null;
let playerColor  = null;
let isTracking   = false;
let watchID      = null;

let prevPos     = null;
let prevTime    = null;
let sessionDist = 0;
let totalDistKm = 0;

let activeChallenges = [];
let unsubTerritories = null;
let unsubLeaderboard = null;

// ── DOM shortcuts ──────────────────────────────────────────────────────────────
const $  = id => document.getElementById(id);
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

// ══════════════════════════════════════════════════════════════════════════════
//  AUTH SCREEN
// ══════════════════════════════════════════════════════════════════════════════

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
  } catch (e) {
    el.authError.textContent = _authErr(e.code);
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
  el.signupBtn.textContent = 'Creating account…';
  try {
    await signup(email, pass, name);
  } catch (e) {
    el.authError.textContent = _authErr(e.code);
    el.signupBtn.disabled    = false;
    el.signupBtn.textContent = 'Create Account';
  }
};

el.googleBtn.onclick = async () => {
  el.authError.textContent = '';
  try { await googleLogin(); }
  catch (e) { el.authError.textContent = _authErr(e.code); }
};

// ══════════════════════════════════════════════════════════════════════════════
//  AUTH STATE LISTENER
// ══════════════════════════════════════════════════════════════════════════════

listenAuth(async user => {
  if (user) {
    currentUser = user;
    playerColor = getUserColor(user.uid);
    await _initGame();
  } else {
    currentUser = null;
    _teardown();
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  GAME INIT
// ══════════════════════════════════════════════════════════════════════════════

async function _initGame() {
  el.authScreen.style.display = 'none';
  el.gameScreen.style.display = 'flex';

  // Load or create player record
  playerStats = await getPlayerStats(currentUser.uid);
  const displayName = currentUser.displayName
    || playerStats?.displayName
    || currentUser.email.split('@')[0];
  totalDistKm = playerStats?.totalDistance || 0;

  await updatePlayerStats(currentUser.uid, {
    displayName,
    email:    currentUser.email,
    color:    playerColor,
    photoURL: currentUser.photoURL || null
  });
  playerStats = await getPlayerStats(currentUser.uid);
  _refreshHeader(displayName, playerStats?.xp || 0, playerStats?.totalArea || 0);

  // Get first GPS fix to initialise the map
  navigator.geolocation.getCurrentPosition(
    pos => {
      initMap(pos.coords.latitude, pos.coords.longitude);
      showToast('📍 Map ready! Press Start to capture territory.');
    },
    err => {
      showToast('⚠️ Enable GPS and refresh the page.', 6000);
      console.error("Initial GPS error:", err);
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  );

  // Firestore real-time listeners
  unsubTerritories = listenTerritories(list =>
    renderTerritories(list, currentUser.uid));
  unsubLeaderboard = listenLeaderboard(players =>
    renderLeaderboard(el.leaderboardList, players, currentUser.uid));

  // Daily challenges
  activeChallenges = await getDailyChallenges(currentUser.uid);
  renderChallenges(el.challengesList, activeChallenges);
  _refreshMyStats();
}

function _teardown() {
  _stopWatch();
  unsubTerritories && unsubTerritories();
  unsubLeaderboard && unsubLeaderboard();
  el.gameScreen.style.display = 'none';
  el.authScreen.style.display = 'flex';
  _resetUI();
}

// ══════════════════════════════════════════════════════════════════════════════
//  GPS watchPosition — THE CORE TRACKING LOOP
//  Lives here in app.js (not buried in map.js) for maximum reliability.
// ══════════════════════════════════════════════════════════════════════════════

el.startBtn.onclick = () => {
  if (!currentUser || isTracking) return;

  isTracking  = true;
  sessionDist = 0;
  prevPos     = null;
  prevTime    = null;

  clearPath();  // wipe any previous trail from map

  el.startBtn.style.display = 'none';
  el.stopBtn.style.display  = 'inline-flex';
  el.statusText.textContent = '📍 Tracking… walk in a loop!';
  el.pathInfo.textContent   = '0 m walked';

  watchID = navigator.geolocation.watchPosition(

    // ── SUCCESS callback — fires on every new GPS fix ──────────────────────
    function(pos) {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const now = Date.now();

      // Anti-cheat: compare to previous point (returns true = cheating)
      if (prevPos !== null) {
        const elapsedSec = (now - prevTime) / 1000;

        // Guard: ignore duplicate positions (0 elapsed seconds)
        if (elapsedSec < 0.5) return;

        const cheat = detectCheat(prevPos, { lat, lng }, elapsedSec);
        if (cheat) {
          showToast('🚫 Anti-cheat triggered. Session stopped.', 5000);
          _stopWatch();
          clearPath();
          _resetUI();
          return;
        }

        // Add distance
        sessionDist += haversineKm(prevPos, { lat, lng });
      }

      // Save position for next iteration
      prevPos  = { lat, lng };
      prevTime = now;

      // ── Tell map.js to: move arrow, draw trail, pan map ──────────────────
      updatePath(lat, lng);

      // ── Update the status bar ─────────────────────────────────────────────
      const distM = Math.round(sessionDist * 1000);
      const pts   = getPath().length;
      el.pathInfo.textContent   = `📏 ${distM} m walked · ${pts} GPS points`;
      el.statusText.textContent = distM >= 80
        ? '🔵 Walk back to your start to capture!'
        : '📍 Tracking… walk in a loop!';

      // ── Loop closure check ────────────────────────────────────────────────
      const path = getPath();
      if (path.length >= 6 && sessionDist >= 0.08) {

        const dx          = lat - path[0][0];
        const dy          = lng - path[0][1];
        const distToStart = Math.sqrt(dx * dx + dy * dy) * 111195; // metres

        if (distToStart < 20) {
          // Close the loop!
          _closeLoop();
        }
      }
    },

    // ── ERROR callback ─────────────────────────────────────────────────────
    function(err) {
      console.error("watchPosition error code:", err.code, err.message);
      if (err.code === 1) {
        showToast('❌ Location permission denied. Enable GPS in browser settings.', 6000);
        _stopWatch();
        _resetUI();
      } else {
        showToast('⚠️ GPS signal lost — keep the screen on and stay outdoors.', 4000);
      }
    },

    // ── OPTIONS — these settings are critical for live updates on mobile ───
    {
      enableHighAccuracy: true,   // use GPS chip, not WiFi/cell
      maximumAge:         0,      // NEVER use a cached position
      timeout:            20000   // wait up to 20s for a fix
    }
  );
};

el.stopBtn.onclick = () => {
  _stopWatch();
  clearPath();
  showToast('🛑 Session cancelled.');
  _resetUI();
};

// ── Stop the GPS watcher ──────────────────────────────────────────────────────
function _stopWatch() {
  if (watchID !== null) {
    navigator.geolocation.clearWatch(watchID);
    watchID = null;
  }
  isTracking = false;
}

// ── Called when player returns to start within 20 m ──────────────────────────
async function _closeLoop() {
  _stopWatch();

  const rawPath = getAndClearPath();
  if (rawPath.length < 4) {
    showToast('❌ Path too short to capture.');
    _resetUI();
    return;
  }

  // Close the polygon
  const closed = [...rawPath, rawPath[0]];

  el.statusText.textContent = '⏳ Saving territory…';
  el.pathInfo.textContent   = '';

  flashCapture(closed);  // brief green flash on map

  const displayName = currentUser.displayName
    || playerStats?.displayName
    || currentUser.email.split('@')[0];

  const result = await captureTerritory(
    currentUser.uid, displayName, playerColor, closed
  );

  if (!result.success) {
    showToast(`❌ ${result.reason || 'Capture failed'}`, 4000);
    _resetUI();
    return;
  }

  // ── Calculate and save XP ──────────────────────────────────────────────────
  const xpArea  = Math.floor(result.area / 10);
  const xpDist  = Math.floor(sessionDist * 100);
  const xpSteal = (result.stolenFrom || 0) * 25;
  const xpEarned = xpArea + xpDist + xpSteal;

  totalDistKm += sessionDist;

  const newXP = (playerStats?.xp || 0) + xpEarned;
  await updatePlayerStats(currentUser.uid, {
    xp: newXP,
    totalDistance: totalDistKm
  });

  // ── Progress challenges ────────────────────────────────────────────────────
  const { challenges, xpAwarded, newlyCompleted } = await progressChallenges(
    currentUser.uid, {
      distanceKm:        sessionDist,
      captureCount:      1,
      areaCaptured:      result.area,
      territoriesStolen: result.stolenFrom || 0,
      singleArea:        result.area
    }
  );
  activeChallenges = challenges;
  renderChallenges(el.challengesList, activeChallenges);

  const finalXP = newXP + xpAwarded;
  await updatePlayerStats(currentUser.uid, { xp: finalXP });
  playerStats = await getPlayerStats(currentUser.uid);

  _refreshHeader(
    playerStats.displayName || displayName,
    playerStats.xp || 0,
    playerStats.totalArea || 0
  );
  _refreshMyStats();

  // ── Show capture celebration card ──────────────────────────────────────────
  el.captureTitle.textContent = result.stolenFrom
    ? `Captured + stole from ${result.stolenFrom} rival${result.stolenFrom > 1 ? 's' : ''}! 🦊`
    : 'Territory Captured! 🎉';

  let details = `<strong>${_fmtArea(result.area)}</strong> claimed<br>`;
  details    += `<strong>+${xpEarned} XP</strong> earned`;
  if (newlyCompleted.length) {
    details += `<br><br>🎯 <strong>Challenge complete!</strong><br>`;
    details += newlyCompleted.map(t => `• ${t}`).join('<br>');
    details += `<br>+${xpAwarded} bonus XP`;
  }
  el.captureDetails.innerHTML = details;
  el.captureOverlay.style.display = 'flex';

  _resetUI();
}

// ══════════════════════════════════════════════════════════════════════════════
//  SIDE PANEL
// ══════════════════════════════════════════════════════════════════════════════

el.menuBtn.onclick = () => {
  el.sidePanel.classList.add('open');
  el.panelBackdrop.classList.add('visible');
  _refreshMyStats();
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

el.logoutBtn.onclick = async () => {
  window.closePanel();
  await logout();
};

// ══════════════════════════════════════════════════════════════════════════════
//  UI HELPERS
// ══════════════════════════════════════════════════════════════════════════════

function _refreshHeader(name, xp, area) {
  el.playerName.textContent   = name.length > 18 ? name.slice(0, 17) + '…' : name;
  el.playerXP.textContent     = `${xp.toLocaleString()} XP`;
  el.headerArea.textContent   = _fmtArea(area);
  el.playerAvatar.textContent = name.charAt(0).toUpperCase();
  el.playerAvatar.style.background = playerColor || '#3b82f6';
}

function _refreshMyStats() {
  if (!el.myStats || !playerStats) return;
  const p = playerStats;
  el.myStats.innerHTML = `
    <div class="stat-row">
      <span class="stat-label">Name</span>
      <span class="stat-val">${p.displayName || '—'}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Total XP</span>
      <span class="stat-val" style="color:var(--warning)">${(p.xp||0).toLocaleString()} XP</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Territory owned</span>
      <span class="stat-val" style="color:var(--success)">${_fmtArea(p.totalArea||0)}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Distance walked</span>
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

function _resetUI() {
  isTracking = false;
  el.startBtn.style.display = 'inline-flex';
  el.stopBtn.style.display  = 'none';
  el.statusText.textContent = '🟢 Ready to explore';
  el.pathInfo.textContent   = 'Press Start and walk to capture territory';
}

// ── Toast ──────────────────────────────────────────────────────────────────────
let _toastTimer = null;
function showToast(msg, ms = 3000) {
  el.toast.textContent   = msg;
  el.toast.style.display = 'block';
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { el.toast.style.display = 'none'; }, ms);
}

// ── Utilities ──────────────────────────────────────────────────────────────────
function _fmtArea(m2) {
  if (!m2 || m2 <= 0) return '0 m²';
  if (m2 >= 1_000_000) return (m2 / 1_000_000).toFixed(2) + ' km²';
  if (m2 >= 10_000)    return (m2 / 10_000).toFixed(2)    + ' ha';
  return Math.round(m2).toLocaleString() + ' m²';
}

function _authErr(code) {
  const m = {
    'auth/user-not-found':         'No account with that email.',
    'auth/wrong-password':         'Wrong password.',
    'auth/invalid-credential':     'Wrong email or password.',
    'auth/email-already-in-use':   'Email already registered — try logging in.',
    'auth/weak-password':          'Password needs 6+ characters.',
    'auth/invalid-email':          'Invalid email address.',
    'auth/popup-closed-by-user':   'Google sign-in cancelled.',
    'auth/network-request-failed': 'Network error — check your connection.',
    'auth/too-many-requests':      'Too many attempts — wait a moment.'
  };
  return m[code] || `Error: ${code}`;
}
