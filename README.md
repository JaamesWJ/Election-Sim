# 🗳️ Election Simulator

A real-time election results simulator with Google Sheets integration, Firebase sync, and a live broadcast-style results viewer.

---

## 🚀 Setup Guide

### Step 1: Firebase (Free — takes ~5 minutes)

1. Go to [https://console.firebase.google.com](https://console.firebase.google.com)
2. Click **Add project** → name it (e.g. `my-election-sim`) → Create
3. In your project, click **Web** (</>) to add a web app → Register
4. Copy the `firebaseConfig` object shown
5. Open `js/firebase-config.js` and replace the placeholder values with yours
6. In Firebase console, go to **Build → Firestore Database** → **Create database**
   - Choose **Start in test mode** (for development) → Next → Enable
7. *(Optional for production)* Update Firestore Rules to allow public reads:
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /election/config { allow read: if true; allow write: if true; }
       match /election/live   { allow read: if true; allow write: if true; }
     }
   }
   ```
   > For production, tighten write rules so only your admin panel can write.

### Step 2: Admin Password

Open `js/admin.js` and find:
```js
return "election2024admin";
```
Change this to your own secure password.

### Step 3: GitHub Pages

1. Push this entire folder to a **public GitHub repository**
2. Go to repo **Settings → Pages**
3. Set Source to `main` branch, `/ (root)` folder → Save
4. Your site will be live at `https://yourusername.github.io/your-repo-name/`

---

## 📁 File Structure

```
/
├── index.html              ← Public viewer (the live results page)
├── pages/
│   └── admin.html          ← Admin panel (password protected)
├── css/
│   ├── viewer.css          ← Broadcast-style results UI
│   └── admin.css           ← Admin dashboard UI
└── js/
    ├── firebase-config.js  ← 🔴 ADD YOUR FIREBASE CONFIG HERE
    ├── simulator.js        ← Core simulation engine
    ├── states-data.js      ← US state metadata
    ├── admin.js            ← Admin panel logic
    └── viewer.js           ← Live viewer logic
```

---

## 🎛️ How to Run an Election

### 1. Open the Admin Panel
Navigate to `your-site.com/pages/admin.html` and enter your admin key.

### 2. Setup Tab
- Enter your election name
- Paste your **Google Form response sheet URL** (share the sheet publicly with "anyone with link can view")
- Set the **Sheet tab name** (usually "Form Responses 1")
- Set duration (e.g. 24 hours) and drop interval (e.g. 1 hour = 24 drops)
- Choose which election levels are active (President, Senate, etc.)
- Set the **Player Vote Modifier** — how much real player ballots affect results

### 3. States Tab
- Add individual states or click **Add All 50 States**
- For each state: check which races it holds, set voter turnout, and EV count

### 4. Parties & Candidates Tab
- Add your political parties with colors
- For each race + state, add candidates and set which **Google Sheet column** corresponds to their race
  - The column header must exactly match the question label in your Google Form

### 5. Modifiers Tab
- Set **Base Partisanship** (the starting vote share for each candidate, summing to 100%)
- Add **event modifiers** (e.g. "Endorsements +2% to Candidate A")

### 6. Control Tab
- Click **🚀 Launch Election** — the public viewer immediately goes live
- Watch vote drops appear in the log
- Use **⚡ Force Drop** to release a drop early
- Click **⛔ End Election** when done

---

## 📊 How the Simulation Works

Each vote drop calculates:
```
Final Votes = SimulatedVotes × (1 - playerImpact) + PlayerVotes × playerImpact
```

**Simulated votes** are determined by:
1. Base Partisanship (your configured baseline)
2. + All active modifiers for that race (each shifts % toward a candidate)
3. Normalized so all candidates sum to 100%

**Player votes** come from the Google Sheet — each ballot row is counted per candidate based on which column header you mapped.

**Vote drops** divide total turnout into equal installments. With 100,000 voters and 24 drops, each drop releases ~4,167 votes.

---

## 🔗 URLs

| Page | URL |
|------|-----|
| Public viewer | `your-site.com/` |
| Admin panel | `your-site.com/pages/admin.html` |

---

## 💡 Tips

- **Google Sheet column matching**: The column header in the sheet must **exactly** match what you enter in the Candidates tab. For a Google Form question "Who is your pick for President?", the column will be named exactly that.
- **Multiple races on one form**: Add multiple questions to your Google Form — one per race. Map each to a separate candidate's column header.
- **Player modifier at 0%**: Ignores all player votes (pure simulation). At 100%, player votes fully determine outcomes.
- **Modifiers**: A +2% modifier favoring Candidate A means they get 2 percentage points more than their base partisanship suggests, split from all other candidates.
