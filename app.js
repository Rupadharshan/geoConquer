// app.js — Main orchestrator for GeoConquer
// Wires together auth, map, territory, leaderboard, challenges and all UI events.

import { signup, login, googleLogin, logout, listenAuth } from "./auth.js";
import { initMap, startTracking, stopTracking, renderTerritories, panToUser } from "./map.js";
import {
  captureTerritory, getUserColor,
  updatePlayerStats, getPlayerStats, calculateArea, listenTerritories
} from "./territory.js";
import { listenLeaderboard, renderLeaderboard } from "./leaderboard.js";
import { getDailyChallenges, progressChallenges, renderChallenges } from "./challenges.js";

// ══════════════════════════════════════════════════════════════════════════════
//  App state
// ══════════════════════════════════════════════════════════════════════════════
let currentUser  = null;
let playerStats  = null;
let playerColor  = null;
let isTracking   = false;

let sessionDistKm    = 0;   // distance walked in the current session
let totalDistKm      = 0;   // lifetime distance (loaded from DB)
let activeChallenges = [];

let unsubTerritories = null;
let unsubLeaderboard = null;

// ══════════════════════════════════════════════════════════════════════════════
//  DOM shortcuts
// ══════════════════════════════════════════════════════════════════════════════
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
//  Auth screen helpers
// ══════════════════════════════════════════════════════════════════════════════

/** Switch the Login / Sign-up tabs in the auth screen. */
window.switchAuthTab = function(tab, btn) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  $('loginTab').style.display  = tab === 'login'  ? 'flex' : 'none';
  $('signupTab').style.display = tab === 'signup' ? 'flex' : 'none';
  setAuthError('');
};

function setAuthError(msg) {
  el.authError.textContent = msg || '';
}

function setAuthLoading(btn, loading) {
  btn.disabled    = loading;
  btn.textContent = loading ? 'Please wait…' : btn.dataset.label;
}

// Store button labels so we can restore them after loading state
el.loginBtn.dataset.label  = el.loginBtn.textContent;
el.signupBtn.dataset.label = el.signupBtn.textContent;

el.loginBtn.onclick = async () => {
  setAuthError('');
  setAuthLoading(el.loginBtn, true);
  try {
    await login(el.loginEmail.value.trim(), el.loginPass.value);
  } catch (e) {
    setAuthError(friendlyAuthError(e.code));
    setAuthLoading(el.loginBtn, false);
  }
};

el.signupBtn.onclick = async () => {
  setAuthError('');
  const name = el.signupName.value.trim();
  const email = el.signupEmail.value.trim();
  const pass  = el.signupPass.value;
  if (!name)  return setAuthError('Please enter a display name.');
  if (!email) return setAuthError('Please enter an email address.');
  if (pass.length < 6) return setAuthError('Password must be at least 6 characters.');
  setAuthLoading(el.signupBtn, true);
  try {
    await signup(email, pass, name);
  } catch (e) {
    setAuthError(friendlyAuthError(e.code));
    setAuthLoading(el.signupBtn, false);
  }
};

el.googleBtn.onclick = async () => {
  setAuthError('');
  try {
    await googleLogin();
  } catch (e) {
    setAuthError(friendlyAuthError(e.code));
  }
};

// ══════════════════════════════════════════════════════════════════════════════
//  Auth state listener — fires on login and logout
// ══════════════════════════════════════════════════════════════════════════════
listenAuth(async user => {
  if (user) {
    currentUser = user;
    playerColor = getUserColor(user.uid);
    await initGameSession();
  } else {
    currentUser = null;
    teardownGameSession();
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  Game session setup / teardown
// ══════════════════════════════════════════════════════════════════════════════

async function initGameSession() {
  // Swap screens
  el.authScreen.style.display = 'none';
  el.gameScreen.style.display = 'flex';

  // Load or create player record
  playerStats = await getPlayerStats(currentUser.uid);
  const displayName = currentUser.displayName
    || (playerStats && playerStats.displayName)
    || currentUser.email.split('@')[0];
  totalDistKm = playerStats?.totalDistance || 0;

  // Upsert player doc with latest info
  await updatePlayerStats(currentUser.uid, {
    displayName,
    email:     currentUser.email,
    color:     playerColor,
    photoURL:  currentUser.photoURL || null
  });
  playerStats = await getPlayerStats(currentUser.uid);

  // Update header
  refreshHeader(displayName, playerStats?.xp || 0, playerStats?.totalArea || 0);

  // Start the map using the device GPS
  navigator.geolocation.getCurrentPosition(
    pos => {
      initMap(pos.coords.latitude, pos.coords.longitude);
      showToast('📍 Map ready!');
    },
    err => {
      showToast('⚠️ Could not get your location. Enable GPS and refresh.', 5000);
      console.error("GPS permission denied:", err);
    },
    { enableHighAccuracy: true, timeout: 12000 }
  );

  // Real-time territory overlay
  unsubTerritories = listenTerritories(territories => {
    renderTerritories(territories, currentUser.uid);
  });

  // Real-time leaderboard
  unsubLeaderboard = listenLeaderboard(players => {
    renderLeaderboard(el.leaderboardList, players, currentUser.uid);
  });

  // Load today's challenges
  activeChallenges = await getDailyChallenges(currentUser.uid);
  renderChallenges(el.challengesList, activeChallenges);

  // Populate my-stats panel
  refreshMyStats();
}

function teardownGameSession() {
  stopTracking();
  isTracking = false;
  unsubTerritories && unsubTerritories();
  unsubLeaderboard && unsubLeaderboard();
  el.gameScreen.style.display = 'none';
  el.authScreen.style.display = 'flex';
  resetCaptureUI();
}

// ══════════════════════════════════════════════════════════════════════════════
//  Capture controls (Start / Stop)
// ══════════════════════════════════════════════════════════════════════════════

el.startBtn.onclick = () => {
  if (!currentUser) return showToast('Please log in first.');
  if (isTracking)   return;

  isTracking    = true;
  sessionDistKm = 0;

  el.startBtn.style.display = 'none';
  el.stopBtn.style.display  = 'inline-flex';
  el.statusText.textContent = '📍 Tracking… walk in a loop!';
  el.pathInfo.textContent   = 'Return to your start point to capture the area.';

  startTracking({
    // ── Called on every valid GPS fix ──────────────────────────────────────
    onPositionUpdate({ lat, lng, totalKm, points }) {
      sessionDistKm = totalKm;
      el.pathInfo.textContent = `📏 ${(totalKm * 1000).toFixed(0)} m walked · ${points} GPS fixes`;
    },

    // ── Called when the player closes their loop ───────────────────────────
    async onLoopClosed(closedPath, distKm) {
      isTracking = false;
      el.startBtn.style.display = 'inline-flex';
      el.stopBtn.style.display  = 'none';
      el.statusText.textContent = '⏳ Saving territory…';
      el.pathInfo.textContent   = '';

      const area = calculateArea(closedPath);
      const name = currentUser.displayName
        || playerStats?.displayName
        || currentUser.email.split('@')[0];

      const result = await captureTerritory(
        currentUser.uid, name, playerColor, closedPath
      );

      if (!result.success) {
        showToast(`❌ ${result.reason || 'Capture failed'}`, 4000);
        resetCaptureUI();
        return;
      }

      // ── Award XP ──────────────────────────────────────────────────────────
      const xpFromArea = Math.floor(result.area / 10);            // 1 XP per 10 m²
      const xpFromDist = Math.floor(distKm * 100);                // 100 XP per km
      const xpSteal    = (result.stolenFrom || 0) * 25;           // 25 XP per rival stolen
      const xpEarned   = xpFromArea + xpFromDist + xpSteal;

      totalDistKm += distKm;

      const newXP = (playerStats?.xp || 0) + xpEarned;
      await updatePlayerStats(currentUser.uid, {
        xp:            newXP,
        totalDistance: totalDistKm
      });
      playerStats = await getPlayerStats(currentUser.uid);

      // ── Progress challenges ────────────────────────────────────────────────
      const { challenges, xpAwarded, newlyCompleted } = await progressChallenges(
        currentUser.uid,
        {
          distanceKm:        distKm,
          captureCount:      1,
          areaCaptured:      result.area,
          territoriesStolen: result.stolenFrom || 0,
          singleArea:        result.area
        }
      );
      activeChallenges = challenges;
      renderChallenges(el.challengesList, activeChallenges);

      const totalXP = newXP + xpAwarded;
      await updatePlayerStats(currentUser.uid, { xp: totalXP });
      playerStats = await getPlayerStats(currentUser.uid);

      // ── Refresh UI ─────────────────────────────────────────────────────────
      refreshHeader(
        playerStats.displayName || name,
        playerStats.xp || 0,
        playerStats.totalArea || 0
      );
      refreshMyStats();
      panToUser();

      // ── Show celebration card ──────────────────────────────────────────────
      el.captureTitle.textContent = result.stolenFrom
        ? `Territory Captured! (stole from ${result.stolenFrom} rival${result.stolenFrom > 1 ? 's' : ''}!)`
        : 'Territory Captured!';

      let details = `<strong>${fmtArea(result.area)}</strong> claimed<br>`;
      details += `<strong>+${xpEarned} XP</strong> earned`;
      if (newlyCompleted.length) {
        details += `<br><br>🎯 <strong>Challenge${newlyCompleted.length > 1 ? 's' : ''} complete!</strong><br>`;
        details += newlyCompleted.map(t => `• ${t}`).join('<br>');
        details += `<br>+${xpAwarded} bonus XP`;
      }
      el.captureDetails.innerHTML = details;
      el.captureOverlay.style.display = 'flex';

      resetCaptureUI();
    },

    // ── Cheat detected ─────────────────────────────────────────────────────
    onCheatDetected(reason) {
      isTracking = false;
      stopTracking();
      showToast(`🚫 Anti-cheat: ${reason}`, 5000);
      resetCaptureUI();
    },

    // ── GPS hardware error ─────────────────────────────────────────────────
    onError(err) {
      showToast('⚠️ GPS error. Check permissions.', 4000);
      console.error("GPS error:", err);
    }
  });
};

el.stopBtn.onclick = () => {
  if (!isTracking) return;
  isTracking = false;
  stopTracking();
  showToast('🛑 Session cancelled.');
  resetCaptureUI();
};

// ══════════════════════════════════════════════════════════════════════════════
//  Side panel
// ══════════════════════════════════════════════════════════════════════════════

el.menuBtn.onclick = openPanel;

window.closePanel = function() {
  el.sidePanel.classList.remove('open');
  el.panelBackdrop.classList.remove('visible');
};

function openPanel() {
  el.sidePanel.classList.add('open');
  el.panelBackdrop.classList.add('visible');
  refreshMyStats();
}

/** Switch panel tabs: Leaderboard / Challenges / Stats */
window.showPanelTab = function(tabName, btn) {
  document.querySelectorAll('.panel-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  $('panelLeaderboard').style.display = tabName === 'Leaderboard' ? 'block' : 'none';
  $('panelChallenges').style.display  = tabName === 'Challenges'  ? 'block' : 'none';
  $('panelStats').style.display       = tabName === 'Stats'       ? 'block' : 'none';
};

el.logoutBtn.onclick = async () => {
  closePanel();
  await logout();
};

// ══════════════════════════════════════════════════════════════════════════════
//  UI refresh helpers
// ══════════════════════════════════════════════════════════════════════════════

function refreshHeader(name, xp, areaMsq) {
  el.playerName.textContent  = truncate(name, 18);
  el.playerXP.textContent    = `${xp.toLocaleString()} XP`;
  el.headerArea.textContent  = fmtArea(areaMsq);
  el.playerAvatar.textContent = name.charAt(0).toUpperCase();
  el.playerAvatar.style.background = playerColor || '#3b82f6';
}

function refreshMyStats() {
  if (!el.myStats || !playerStats) return;
  const p = playerStats;
  el.myStats.innerHTML = `
    <div class="stat-row">
      <span class="stat-label">Display name</span>
      <span class="stat-val">${htmlEsc(p.displayName || '—')}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Total XP</span>
      <span class="stat-val" style="color:var(--warning)">${(p.xp || 0).toLocaleString()} XP</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Territory owned</span>
      <span class="stat-val" style="color:var(--success)">${fmtArea(p.totalArea || 0)}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Distance walked</span>
      <span class="stat-val">${(totalDistKm).toFixed(2)} km</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Player colour</span>
      <span class="stat-val">
        <span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:${playerColor};vertical-align:middle;margin-right:6px"></span>
        ${playerColor}
      </span>
    </div>
  `;
}

function resetCaptureUI() {
  el.startBtn.style.display = 'inline-flex';
  el.stopBtn.style.display  = 'none';
  el.statusText.textContent = '🟢 Ready to explore';
  el.pathInfo.textContent   = 'Press Start and walk to capture territory';
  isTracking = false;
}

// ══════════════════════════════════════════════════════════════════════════════
//  Toast notification
// ══════════════════════════════════════════════════════════════════════════════

let toastTimer = null;
function showToast(msg, ms = 3000) {
  el.toast.textContent    = msg;
  el.toast.style.display  = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.style.display = 'none'; }, ms);
}

// ══════════════════════════════════════════════════════════════════════════════
//  Utility
// ══════════════════════════════════════════════════════════════════════════════

function fmtArea(m2) {
  if (!m2 || m2 <= 0) return '0 m²';
  if (m2 >= 1_000_000)  return (m2 / 1_000_000).toFixed(2) + ' km²';
  if (m2 >= 10_000)     return (m2 / 10_000).toFixed(2)    + ' ha';
  return Math.round(m2).toLocaleString() + ' m²';
}

function truncate(str, n) {
  return str.length > n ? str.slice(0, n - 1) + '…' : str;
}

function htmlEsc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function friendlyAuthError(code) {
  const map = {
    'auth/user-not-found':       'No account found with that email.',
    'auth/wrong-password':       'Incorrect password. Try again.',
    'auth/email-already-in-use': 'That email is already registered. Try logging in.',
    'auth/weak-password':        'Password must be at least 6 characters.',
    'auth/invalid-email':        'Please enter a valid email address.',
    'auth/popup-closed-by-user': 'Google sign-in was cancelled.',
    'auth/network-request-failed': 'Network error. Check your connection.',
    'auth/too-many-requests':    'Too many attempts. Please wait a moment.'
  };
  return map[code] || 'Something went wrong. Please try again.';
}