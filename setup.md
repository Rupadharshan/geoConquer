# GeoConquer — Setup & Deployment Guide

## 📁 File Structure

```
geo-territory-game/
├── index.html        ← Single-page app shell
├── style.css         ← All styling (dark theme)
├── app.js            ← Main orchestrator (start here to understand the flow)
├── firebase.js       ← Firebase init (YOU MUST EDIT THIS)
├── auth.js           ← Login / signup / Google OAuth
├── map.js            ← Leaflet map + GPS tracking + loop-closure detection
├── territory.js      ← Polygon capture, stealing (Turf.js), Firestore writes
├── anticheat.js      ← Speed / jump detection
├── leaderboard.js    ← Real-time leaderboard reads
├── challenges.js     ← Daily challenge generation, progress, rendering
└── vercel.json       ← Vercel deployment config
```

---

## Step 1 — Create a Firebase Project

1. Go to **https://console.firebase.google.com**
2. Click **"Add project"** → name it (e.g. `geoconquer`)
3. Disable Google Analytics if you don't need it → click **Continue**

### 1a. Enable Authentication

1. Left sidebar → **Build → Authentication → Get started**
2. **Sign-in method** tab:
   - Enable **Email/Password**
   - Enable **Google** (set your project's support email)
3. **Settings → Authorised domains**: add your Vercel domain later (e.g. `geoconquer.vercel.app`)

### 1b. Create Firestore Database

1. Left sidebar → **Build → Firestore Database → Create database**
2. Choose **"Start in production mode"** → pick your closest region
3. After creation, go to **Rules** tab and paste:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Players can read all profiles; write only their own
    match /players/{userId} {
      allow read: if true;
      allow write: if request.auth != null && request.auth.uid == userId;
    }

    // Territories: anyone authenticated can read; write handled server-side
    // For a production game, use Cloud Functions for writes to prevent spoofing.
    // For now, authenticated users can write:
    match /territories/{docId} {
      allow read:   if true;
      allow create: if request.auth != null;
      allow update, delete: if request.auth != null;
    }

    // Challenges: players can read/write only their own
    match /challenges/{docId} {
      allow read, write: if request.auth != null
        && docId.matches(request.auth.uid + '_.*');
    }
  }
}
```

4. Click **Publish**

### 1c. Get your Firebase config

1. Firebase Console → ⚙️ **Project Settings** → **Your apps**
2. Click **"</>"** (Web) → Register app → name it
3. Copy the `firebaseConfig` object

---

## Step 2 — Paste your Firebase config

Open **`firebase.js`** and replace the placeholder object:

```js
const firebaseConfig = {
  apiKey:            "AIzaSy...",          // ← your real key
  authDomain:        "geoconquer.firebaseapp.com",
  projectId:         "geoconquer",
  storageBucket:     "geoconquer.appspot.com",
  messagingSenderId: "123456789",
  appId:             "1:123:web:abc123"
};
```

---

## Step 3 — Deploy to Vercel

### Option A — Vercel CLI (recommended, 2 minutes)

```bash
# Install Vercel CLI once
npm install -g vercel

# From inside your project folder
cd geo-territory-game
vercel

# Follow the prompts:
# - "Set up and deploy" → Y
# - Link to existing project? → N  (create new)
# - What's your project name? → geoconquer
# - In which directory is your code? → ./  (current dir)
# - Want to override settings? → N
```

After deploy, Vercel gives you a URL like `https://geoconquer.vercel.app`.

### Option B — Vercel Dashboard (drag-and-drop)

1. Go to **https://vercel.com/new**
2. Click **"Import Git Repository"** or drag your project folder onto the page
3. Leave all settings as-is → click **Deploy**

### After deploy: Add your domain to Firebase

1. Firebase Console → **Authentication → Settings → Authorised domains**
2. Click **Add domain** → paste `geoconquer.vercel.app`
3. Also add `localhost` if you want to test locally

---

## Step 4 — Test locally (optional)

Because the project uses ES Modules, you **cannot just open `index.html` directly** — you need a local server.

```bash
# Option 1: Python (no install needed)
cd geo-territory-game
python3 -m http.server 3000
# open http://localhost:3000

# Option 2: Node.js serve package
npx serve .

# Option 3: VS Code → install "Live Server" extension → right-click index.html → "Open with Live Server"
```

---

## How the game works (technical summary)

| Feature | How it works |
|---|---|
| **Auth** | Firebase Auth — email+password and Google OAuth |
| **Map** | Leaflet.js with OpenStreetMap tiles (free, no API key needed) |
| **GPS tracking** | `navigator.geolocation.watchPosition` |
| **Loop detection** | When player returns within 20 m of start AND has walked ≥80 m |
| **Territory capture** | Closed path → Turf.js polygon → saved to Firestore `territories` |
| **Stealing** | `turf.intersect` + `turf.difference` clips existing polygons |
| **Leaderboard** | Firestore real-time listener on `players` ordered by `totalArea` |
| **Daily challenges** | 3 challenges seeded from today's date + user ID, tracked in Firestore |
| **Anti-cheat** | Speed >15 km/h or position jump >300 m in one GPS update = blocked |
| **XP system** | 1 XP / 10 m² captured + 100 XP / km walked + 25 XP / rival stolen |

---

## Common issues

| Problem | Fix |
|---|---|
| "This site can't be reached" after deploy | Wait 60 seconds — Vercel propagates within 1 min |
| Google login popup blocked | Make sure your domain is in Firebase Authorised Domains |
| GPS not working | The page must be served over **HTTPS** (Vercel does this automatically) |
| Map doesn't load | Check browser console for Leaflet errors; make sure you have internet |
| Territory not saving | Check Firestore Rules are published; check browser console for permission errors |
| Firebase config errors | Double-check you copied all 6 fields from Firebase Project Settings |