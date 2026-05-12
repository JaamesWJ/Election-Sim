// ═══════════════════════════════════════════════════════════
// admin.js — Election Simulator Admin Panel
// ═══════════════════════════════════════════════════════════
import { db } from "../js/firebase-config.js";
import {
  doc, setDoc, getDoc, onSnapshot, collection, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { fetchBallots, tallyPlayerVotes, simulateDrop, fmtNum } from "../js/simulator.js";
import { US_STATES } from "../js/states-data.js";

// ── STATE ──────────────────────────────────────────────────
const ADMIN_KEY = (() => {
  // Change this to your desired admin password before deploying
  return "election2024admin";
})();

let appState = {
  election: {
    name: "General Election",
    sheetsUrl: "",
    sheetTab: "Form Responses 1",
    durationValue: 24,
    durationUnit: "hours",
    intervalValue: 1,
    intervalUnit: "hours",
    globalLevels: ["president"],
    playerModifierPct: 50
  },
  states: [],
  parties: [],
  candidates: {},      // { "president:national": [{id,name,party,columnHeader}] }
  modifiers: {},       // { "president:national": [{id,name,favorsCandidateId,pct}] }
  basePartisanship: {}, // { "president:national": {candidateId: pct} }
  liveElection: null   // null | { status, startedAt, drops: [], currentDrop }
};

// ── LOGIN ──────────────────────────────────────────────────
document.getElementById("login-btn").addEventListener("click", tryLogin);
document.getElementById("admin-key-input").addEventListener("keydown", e => {
  if (e.key === "Enter") tryLogin();
});

function tryLogin() {
  const key = document.getElementById("admin-key-input").value.trim();
  if (key === ADMIN_KEY) {
    document.getElementById("login-screen").classList.remove("active");
    document.getElementById("admin-dashboard").classList.add("active");
    initDashboard();
  } else {
    document.getElementById("login-error").textContent = "Incorrect key. Try again.";
  }
}

// ── NAV TABS ──────────────────────────────────────────────
document.querySelectorAll(".nav-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
  });
});

// ── INIT ──────────────────────────────────────────────────
async function initDashboard() {
  await loadFromFirestore();
  renderSetupTab();
  renderStatesTab();
  renderPartiesTab();
  renderModifiersTab();
  renderControlTab();
  subscribeToLiveState();
  updateStatusIndicator("online");
}

// ── FIRESTORE ─────────────────────────────────────────────
async function loadFromFirestore() {
  try {
    const snap = await getDoc(doc(db, "election", "config"));
    if (snap.exists()) {
      const data = snap.data();
      appState = { ...appState, ...data };
    }
  } catch (e) {
    console.warn("Could not load from Firestore:", e);
    toast("Using local state (Firestore may not be configured yet)", "error");
  }
}

async function saveToFirestore(extraData = {}) {
  try {
    const payload = {
      election: appState.election,
      states: appState.states,
      parties: appState.parties,
      candidates: appState.candidates,
      modifiers: appState.modifiers,
      basePartisanship: appState.basePartisanship,
      ...extraData
    };
    await setDoc(doc(db, "election", "config"), payload, { merge: true });
    toast("Saved ✓");
  } catch (e) {
    console.error("Firestore save error:", e);
    toast("Save failed — check Firestore config", "error");
  }
}

async function saveLiveState(liveData) {
  try {
    await setDoc(doc(db, "election", "live"), liveData, { merge: true });
  } catch (e) {
    console.error("Live state save error:", e);
  }
}

function subscribeToLiveState() {
  onSnapshot(doc(db, "election", "live"), (snap) => {
    if (snap.exists()) {
      appState.liveElection = snap.data();
      updateControlUI();
    }
  });
}

// ── SETUP TAB ─────────────────────────────────────────────
function renderSetupTab() {
  const el = appState.election;
  document.getElementById("election-name").value = el.name || "";
  document.getElementById("sheets-url").value = el.sheetsUrl || "";
  document.getElementById("sheet-tab").value = el.sheetTab || "Form Responses 1";
  document.getElementById("election-duration").value = el.durationValue || 24;
  document.getElementById("duration-unit").value = el.durationUnit || "hours";
  document.getElementById("drop-interval").value = el.intervalValue || 1;
  document.getElementById("interval-unit").value = el.intervalUnit || "hours";
  document.getElementById("player-modifier").value = el.playerModifierPct ?? 50;
  document.getElementById("player-modifier-val").textContent = (el.playerModifierPct ?? 50) + "%";

  document.querySelectorAll("#global-levels input").forEach(cb => {
    cb.checked = (el.globalLevels || []).includes(cb.value);
  });

  updateDropPreview();
}

function updateDropPreview() {
  const dur = parseInt(document.getElementById("election-duration").value) || 1;
  const interval = parseInt(document.getElementById("drop-interval").value) || 1;
  const drops = Math.floor(dur / interval);
  document.getElementById("drop-count-preview").textContent = `= ${drops} drops total`;
}

document.getElementById("election-duration").addEventListener("input", updateDropPreview);
document.getElementById("drop-interval").addEventListener("input", updateDropPreview);

document.getElementById("player-modifier").addEventListener("input", function() {
  document.getElementById("player-modifier-val").textContent = this.value + "%";
});

document.getElementById("save-setup-btn").addEventListener("click", () => {
  appState.election = {
    name: document.getElementById("election-name").value.trim(),
    sheetsUrl: document.getElementById("sheets-url").value.trim(),
    sheetTab: document.getElementById("sheet-tab").value.trim() || "Form Responses 1",
    durationValue: parseInt(document.getElementById("election-duration").value) || 24,
    durationUnit: document.getElementById("duration-unit").value,
    intervalValue: parseInt(document.getElementById("drop-interval").value) || 1,
    intervalUnit: document.getElementById("interval-unit").value,
    globalLevels: [...document.querySelectorAll("#global-levels input:checked")].map(cb => cb.value),
    playerModifierPct: parseInt(document.getElementById("player-modifier").value)
  };
  saveToFirestore();
  syncStateSelectsAcrossTabs();
});

// ── STATES TAB ────────────────────────────────────────────
const RACE_LEVELS = [
  { id: "president", label: "President" },
  { id: "senate", label: "Senate" },
  { id: "house", label: "House" },
  { id: "governor", label: "Governor" },
  { id: "state_leg", label: "State Leg." }
];

function renderStatesTab() {
  renderStatesList();
}

function renderStatesList(filter = "") {
  const container = document.getElementById("states-list");
  container.innerHTML = "";
  const filtered = appState.states.filter(s =>
    s.name.toLowerCase().includes(filter.toLowerCase()) ||
    s.abbr.toLowerCase().includes(filter.toLowerCase())
  );
  if (filtered.length === 0) {
    container.innerHTML = `<p style="color:var(--text-dim);font-family:var(--font-mono);font-size:0.8rem">No states added yet. Use "+ Add State" or "Add All 50 States".</p>`;
    return;
  }
  filtered.forEach(state => container.appendChild(buildStateCard(state)));
}

function buildStateCard(state) {
  const card = document.createElement("div");
  card.className = "state-card";
  card.dataset.abbr = state.abbr;

  const levels = state.levels || [];
  const levelCheckboxes = RACE_LEVELS.map(l => `
    <label class="state-level-cb">
      <input type="checkbox" data-state="${state.abbr}" data-level="${l.id}" ${levels.includes(l.id) ? "checked" : ""}>
      ${l.label}
    </label>
  `).join("");

  card.innerHTML = `
    <div class="state-card-header">
      <div>
        <div class="state-card-name">${state.name}</div>
        <div class="state-card-abbr">${state.abbr}</div>
      </div>
      <button class="state-card-delete" data-abbr="${state.abbr}" title="Remove state">✕</button>
    </div>
    <div class="state-levels">${levelCheckboxes}</div>
    <div class="state-turnout-row">
      <label>Total Turnout:</label>
      <input type="number" class="state-turnout" data-abbr="${state.abbr}" value="${state.turnout || 100000}" min="1" style="background:var(--surface3);border:1px solid var(--border);color:var(--text);padding:0.25rem 0.5rem;font-size:0.78rem;width:110px;" />
    </div>
    <div class="state-ev-row">
      <label>Electoral Votes:</label>
      <input type="number" class="state-ev" data-abbr="${state.abbr}" value="${state.ev || 0}" min="0" style="background:var(--surface3);border:1px solid var(--border);color:var(--text);padding:0.25rem 0.5rem;font-size:0.78rem;width:60px;" />
    </div>
  `;

  // Events
  card.querySelector(".state-card-delete").addEventListener("click", () => {
    appState.states = appState.states.filter(s => s.abbr !== state.abbr);
    renderStatesList();
    syncStateSelectsAcrossTabs();
    saveToFirestore();
  });

  card.querySelectorAll(".state-level-cb input").forEach(cb => {
    cb.addEventListener("change", () => {
      const s = appState.states.find(x => x.abbr === state.abbr);
      if (!s) return;
      const checked = [...card.querySelectorAll(".state-level-cb input:checked")].map(c => c.dataset.level);
      s.levels = checked;
      saveToFirestore();
    });
  });

  card.querySelector(".state-turnout").addEventListener("change", e => {
    const s = appState.states.find(x => x.abbr === state.abbr);
    if (s) s.turnout = parseInt(e.target.value) || 100000;
    saveToFirestore();
  });

  card.querySelector(".state-ev").addEventListener("change", e => {
    const s = appState.states.find(x => x.abbr === state.abbr);
    if (s) s.ev = parseInt(e.target.value) || 0;
    saveToFirestore();
  });

  return card;
}

document.getElementById("add-state-btn").addEventListener("click", () => {
  document.getElementById("add-state-modal").classList.add("open");
});
document.getElementById("cancel-add-state").addEventListener("click", () => {
  document.getElementById("add-state-modal").classList.remove("open");
});
document.getElementById("confirm-add-state").addEventListener("click", () => {
  const name = document.getElementById("new-state-name").value.trim();
  const abbr = document.getElementById("new-state-abbr").value.trim().toUpperCase();
  const ev = parseInt(document.getElementById("new-state-ev").value) || 0;
  if (!name || !abbr) { toast("Name and abbreviation required", "error"); return; }
  if (appState.states.find(s => s.abbr === abbr)) { toast("State already exists", "error"); return; }
  appState.states.push({ name, abbr, ev, turnout: 100000, levels: ["president"] });
  document.getElementById("add-state-modal").classList.remove("open");
  document.getElementById("new-state-name").value = "";
  document.getElementById("new-state-abbr").value = "";
  document.getElementById("new-state-ev").value = "0";
  renderStatesList();
  syncStateSelectsAcrossTabs();
  saveToFirestore();
});

document.getElementById("add-all-states-btn").addEventListener("click", () => {
  US_STATES.forEach(s => {
    if (!appState.states.find(x => x.abbr === s.abbr)) {
      appState.states.push({ name: s.name, abbr: s.abbr, ev: s.ev, turnout: 100000, levels: ["president"] });
    }
  });
  renderStatesList();
  syncStateSelectsAcrossTabs();
  saveToFirestore();
});

document.getElementById("state-search").addEventListener("input", e => {
  renderStatesList(e.target.value);
});

// ── PARTIES TAB ───────────────────────────────────────────
function renderPartiesTab() {
  renderPartiesList();
  syncStateSelectsAcrossTabs();
  renderCandidatesArea();
}

function renderPartiesList() {
  const container = document.getElementById("parties-list");
  container.innerHTML = "";
  appState.parties.forEach(p => {
    const tag = document.createElement("div");
    tag.className = "party-tag";
    tag.innerHTML = `
      <span class="party-swatch" style="background:${p.color}"></span>
      <span>${p.name} (${p.abbr})</span>
      <button class="party-tag-delete" data-abbr="${p.abbr}">✕</button>
    `;
    tag.querySelector(".party-tag-delete").addEventListener("click", () => {
      appState.parties = appState.parties.filter(x => x.abbr !== p.abbr);
      renderPartiesList();
      saveToFirestore();
    });
    container.appendChild(tag);
  });
}

document.getElementById("add-party-btn").addEventListener("click", () => {
  const name = document.getElementById("new-party-name").value.trim();
  const abbr = document.getElementById("new-party-abbr").value.trim().toUpperCase();
  const color = document.getElementById("new-party-color").value;
  if (!name || !abbr) { toast("Party name and abbreviation required", "error"); return; }
  if (appState.parties.find(p => p.abbr === abbr)) { toast("Party already exists", "error"); return; }
  appState.parties.push({ name, abbr, color });
  document.getElementById("new-party-name").value = "";
  document.getElementById("new-party-abbr").value = "";
  renderPartiesList();
  saveToFirestore();
});

function renderCandidatesArea() {
  const raceType = document.getElementById("candidate-race-type").value;
  const stateAbbr = document.getElementById("candidate-state-select").value;
  const key = `${raceType}:${stateAbbr}`;
  const candidates = appState.candidates[key] || [];

  const area = document.getElementById("candidates-area");
  area.innerHTML = "";
  candidates.forEach(c => area.appendChild(buildCandidateRow(c, key)));
}

function buildCandidateRow(c, key) {
  const row = document.createElement("div");
  row.className = "candidate-config-row";
  const isStateLeg = key.startsWith("state_leg");
  row.innerHTML = `
    ${!isStateLeg ? `<input type="text" class="cand-name-input" placeholder="Candidate name" value="${c.name || ""}" />` : ""}
    <select class="cand-party-select">
      <option value="">— Party —</option>
      ${appState.parties.map(p => `<option value="${p.abbr}" ${c.party === p.abbr ? "selected" : ""}>${p.name}</option>`).join("")}
    </select>
    <input type="text" class="cand-col-input" placeholder="Sheet column header" value="${c.columnHeader || ""}" style="flex:1.5" />
    <button class="cand-delete-btn" data-id="${c.id}">✕</button>
  `;

  if (!isStateLeg) {
    row.querySelector(".cand-name-input").addEventListener("input", e => {
      const cands = appState.candidates[key] || [];
      const found = cands.find(x => x.id === c.id);
      if (found) found.name = e.target.value;
    });
  }
  row.querySelector(".cand-party-select").addEventListener("change", e => {
    const cands = appState.candidates[key] || [];
    const found = cands.find(x => x.id === c.id);
    if (found) { found.party = e.target.value; found.name = found.name || e.target.value; }
  });
  row.querySelector(".cand-col-input").addEventListener("input", e => {
    const cands = appState.candidates[key] || [];
    const found = cands.find(x => x.id === c.id);
    if (found) found.columnHeader = e.target.value;
  });
  row.querySelector(".cand-delete-btn").addEventListener("click", () => {
    appState.candidates[key] = (appState.candidates[key] || []).filter(x => x.id !== c.id);
    renderCandidatesArea();
    saveToFirestore();
  });
  return row;
}

document.getElementById("candidate-race-type").addEventListener("change", renderCandidatesArea);
document.getElementById("candidate-state-select").addEventListener("change", renderCandidatesArea);

document.getElementById("add-candidate-btn").addEventListener("click", () => {
  const raceType = document.getElementById("candidate-race-type").value;
  const stateAbbr = document.getElementById("candidate-state-select").value;
  const key = `${raceType}:${stateAbbr}`;
  if (!appState.candidates[key]) appState.candidates[key] = [];
  const id = "c_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
  appState.candidates[key].push({ id, name: "", party: "", columnHeader: "" });
  renderCandidatesArea();
});

// Save candidates on blur (save button in setup handles the full save)
document.getElementById("candidates-area").addEventListener("blur", () => saveToFirestore(), true);

// ── MODIFIERS TAB ─────────────────────────────────────────
function renderModifiersTab() {
  renderModifiersList();
  renderBasePartisanship();
}

function getModifierKey() {
  return `${document.getElementById("modifier-race-type").value}:${document.getElementById("modifier-state-select").value}`;
}

function renderModifiersList() {
  const key = getModifierKey();
  const mods = appState.modifiers[key] || [];
  const list = document.getElementById("modifiers-list");
  list.innerHTML = "";
  mods.forEach(m => list.appendChild(buildModifierRow(m, key)));
}

function buildModifierRow(m, key) {
  const candidates = appState.candidates[key] || [];
  const row = document.createElement("div");
  row.className = "modifier-row";
  row.innerHTML = `
    <div class="modifier-row-header">
      <input type="text" placeholder="Modifier name (e.g. Endorsements)" value="${m.name || ""}" class="mod-name-input" />
      <button class="btn-ghost" style="padding:0.25rem 0.5rem;font-size:0.7rem" data-mod-id="${m.id}">Remove</button>
    </div>
    <div class="modifier-favor-row">
      <span>Favors:</span>
      <select class="mod-favors-select">
        <option value="">— Select candidate —</option>
        ${candidates.map(c => `<option value="${c.id}" ${m.favorsCandidateId === c.id ? "selected" : ""}>${c.name || c.party || c.id}</option>`).join("")}
      </select>
      <span>by</span>
      <input type="range" class="mod-pct-range" min="0" max="20" step="0.1" value="${m.pct || 0}" style="width:120px;accent-color:var(--accent)" />
      <span class="mod-pct-val">${(m.pct || 0).toFixed(1)}%</span>
    </div>
  `;

  row.querySelector(".mod-name-input").addEventListener("input", e => {
    const found = (appState.modifiers[key] || []).find(x => x.id === m.id);
    if (found) found.name = e.target.value;
  });
  row.querySelector(".mod-favors-select").addEventListener("change", e => {
    const found = (appState.modifiers[key] || []).find(x => x.id === m.id);
    if (found) found.favorsCandidateId = e.target.value;
  });
  row.querySelector(".mod-pct-range").addEventListener("input", function() {
    row.querySelector(".mod-pct-val").textContent = parseFloat(this.value).toFixed(1) + "%";
    const found = (appState.modifiers[key] || []).find(x => x.id === m.id);
    if (found) found.pct = parseFloat(this.value);
  });
  row.querySelector("[data-mod-id]").addEventListener("click", () => {
    appState.modifiers[key] = (appState.modifiers[key] || []).filter(x => x.id !== m.id);
    renderModifiersList();
    saveToFirestore();
  });
  return row;
}

document.getElementById("modifier-race-type").addEventListener("change", () => {
  renderModifiersList();
  renderBasePartisanship();
});
document.getElementById("modifier-state-select").addEventListener("change", () => {
  renderModifiersList();
  renderBasePartisanship();
});

document.getElementById("add-modifier-btn").addEventListener("click", () => {
  const key = getModifierKey();
  if (!appState.modifiers[key]) appState.modifiers[key] = [];
  appState.modifiers[key].push({
    id: "m_" + Date.now(),
    name: "",
    favorsCandidateId: "",
    pct: 0
  });
  renderModifiersList();
});

document.getElementById("modifiers-list").addEventListener("blur", () => saveToFirestore(), true);

function renderBasePartisanship() {
  const key = getModifierKey();
  const candidates = appState.candidates[key] || [];
  const bp = appState.basePartisanship[key] || {};
  const area = document.getElementById("base-partisanship-area");
  area.innerHTML = "";

  if (candidates.length === 0) {
    area.innerHTML = `<p style="color:var(--text-dim);font-size:0.8rem">No candidates defined for this race. Add them in Parties & Candidates first.</p>`;
    return;
  }

  candidates.forEach(c => {
    const row = document.createElement("div");
    row.className = "bp-row";
    const val = bp[c.id] ?? (100 / candidates.length);
    row.innerHTML = `
      <span class="bp-label">${c.name || c.party || c.id}</span>
      <input type="range" class="bp-slider" data-cid="${c.id}" min="0" max="100" step="0.5" value="${val}" />
      <span class="bp-val" id="bp-val-${c.id}">${val.toFixed(1)}%</span>
    `;
    row.querySelector(".bp-slider").addEventListener("input", function() {
      if (!appState.basePartisanship[key]) appState.basePartisanship[key] = {};
      appState.basePartisanship[key][c.id] = parseFloat(this.value);
      document.getElementById(`bp-val-${c.id}`).textContent = parseFloat(this.value).toFixed(1) + "%";
    });
    row.querySelector(".bp-slider").addEventListener("change", () => saveToFirestore());
    area.appendChild(row);
  });
}

// ── CONTROL TAB ───────────────────────────────────────────
function renderControlTab() {
  const live = appState.liveElection;
  updateControlUI();

  document.getElementById("live-player-modifier").value = appState.election.playerModifierPct ?? 50;
  document.getElementById("live-player-modifier-val").textContent = (appState.election.playerModifierPct ?? 50) + "%";

  document.getElementById("live-player-modifier").addEventListener("input", function() {
    document.getElementById("live-player-modifier-val").textContent = this.value + "%";
    appState.election.playerModifierPct = parseInt(this.value);
    saveToFirestore();
  });
}

function updateControlUI() {
  const live = appState.liveElection;
  const bigStatus = document.getElementById("big-status");
  const details = document.getElementById("status-details");
  const launchBtn = document.getElementById("launch-btn");
  const endBtn = document.getElementById("end-btn");

  if (!live || live.status === "idle") {
    bigStatus.textContent = "NO ELECTION";
    bigStatus.className = "big-status";
    details.textContent = "No election is currently live.";
    launchBtn.disabled = false;
    endBtn.disabled = true;
    updateStatusIndicator("online");
  } else if (live.status === "live") {
    bigStatus.textContent = "LIVE";
    bigStatus.className = "big-status live";
    const drops = (live.drops || []).length;
    const total = live.totalDrops || 1;
    details.textContent = `Drop ${drops}/${total} · Started ${new Date(live.startedAt).toLocaleTimeString()}`;
    launchBtn.disabled = true;
    endBtn.disabled = false;
    updateStatusIndicator("live");
  } else if (live.status === "ended") {
    bigStatus.textContent = "ENDED";
    bigStatus.className = "big-status ended";
    details.textContent = `Election ended. ${(live.drops || []).length} drops completed.`;
    launchBtn.disabled = false;
    endBtn.disabled = true;
    updateStatusIndicator("online");
  }
}

function updateStatusIndicator(state) {
  const dot = document.querySelector(".status-dot");
  const text = document.getElementById("status-text");
  dot.className = "status-dot " + state;
  text.textContent = state === "live" ? "Live" : state === "online" ? "Connected" : "Offline";
}

document.getElementById("launch-btn").addEventListener("click", launchElection);
document.getElementById("end-btn").addEventListener("click", endElection);
document.getElementById("force-drop-btn").addEventListener("click", forceDrop);

async function launchElection() {
  if (!confirm("Launch the election? Viewers will see it go live immediately.")) return;

  const el = appState.election;
  const durMs = el.durationValue * (el.durationUnit === "hours" ? 3600000 : 60000);
  const intervalMs = el.intervalValue * (el.intervalUnit === "hours" ? 3600000 : 60000);
  const totalDrops = Math.max(1, Math.floor(el.durationValue / el.intervalValue));

  const liveData = {
    status: "live",
    startedAt: Date.now(),
    durationMs,
    intervalMs,
    totalDrops,
    currentDrop: 0,
    drops: [],
    config: {
      election: el,
      states: appState.states,
      parties: appState.parties,
      candidates: appState.candidates,
      modifiers: appState.modifiers,
      basePartisanship: appState.basePartisanship
    }
  };

  await saveLiveState(liveData);
  appState.liveElection = liveData;

  // Start the drop scheduler
  scheduleDrops();
  toast("Election launched! 🚀");
  logDrop("Election launched", true);
}

async function endElection() {
  if (!confirm("End the election? This will stop further vote drops.")) return;
  clearAllTimers();
  await saveLiveState({ status: "ended" });
  toast("Election ended.");
  logDrop("Election ended", true);
}

// ── DROP SCHEDULER ────────────────────────────────────────
let dropTimer = null;
let countdownInterval = null;

function clearAllTimers() {
  if (dropTimer) clearTimeout(dropTimer);
  if (countdownInterval) clearInterval(countdownInterval);
}

async function scheduleDrops() {
  const live = appState.liveElection;
  if (!live || live.status !== "live") return;

  const done = (live.drops || []).length;
  const total = live.totalDrops;

  if (done >= total) {
    await saveLiveState({ status: "ended" });
    toast("All drops complete. Election ended.");
    return;
  }

  // Do a drop now, then schedule next
  await executeDrop();

  const nextDrop = done + 1;
  if (nextDrop < total) {
    const delay = live.intervalMs;
    dropTimer = setTimeout(scheduleDrops, delay);

    // Countdown timer display
    let remaining = Math.floor(delay / 1000);
    clearInterval(countdownInterval);
    // (countdown shown on viewer page, not admin)
  }
}

async function forceDrop() {
  clearAllTimers();
  await executeDrop();
  scheduleDrops();
  toast("Vote drop forced ⚡");
}

async function executeDrop() {
  const live = appState.liveElection;
  if (!live || live.status !== "live") return;

  const config = live.config;
  const dropIndex = (live.drops || []).length;
  const totalDrops = live.totalDrops;

  // Fetch player votes
  let playerBallots = [];
  try {
    if (config.election.sheetsUrl) {
      playerBallots = await fetchBallots(config.election.sheetsUrl, config.election.sheetTab);
    }
  } catch (e) {
    console.warn("Could not fetch player ballots:", e);
  }

  // Simulate each active race
  const dropResults = {};
  const raceKeys = buildRaceKeys(config);

  for (const key of raceKeys) {
    const [raceType, stateAbbr] = key.split(":");
    const candidates = config.candidates[key] || [];
    if (candidates.length === 0) continue;

    const stateData = config.states.find(s => s.abbr === stateAbbr);
    const totalVotes = stateData?.turnout || 100000;

    // Tally player votes for each candidate in this race
    const playerTally = {};
    candidates.forEach(c => {
      if (c.columnHeader) {
        const t = tallyPlayerVotes(playerBallots, c.columnHeader);
        Object.assign(playerTally, t);
      }
    });

    const drop = simulateDrop({
      candidates,
      basePartisanship: config.basePartisanship[key] || {},
      modifiers: config.modifiers[key] || [],
      totalVotes,
      dropIndex,
      totalDrops,
      playerVoteTally: playerTally,
      playerModifierPct: config.election.playerModifierPct
    });

    dropResults[key] = drop;
  }

  const updatedDrops = [...(live.drops || []), { index: dropIndex, results: dropResults, timestamp: Date.now() }];

  await saveLiveState({
    drops: updatedDrops,
    currentDrop: dropIndex + 1
  });

  logDrop(`Drop ${dropIndex + 1}/${totalDrops} — ${Object.keys(dropResults).length} races updated`);
  renderLivePreview(updatedDrops, config);
}

function buildRaceKeys(config) {
  const keys = [];
  const globalLevels = config.election.globalLevels || [];
  config.states.forEach(s => {
    const stateLevels = s.levels || [];
    globalLevels.forEach(level => {
      if (stateLevels.includes(level)) {
        const stateKey = level === "president" ? "national" : s.abbr;
        const key = `${level}:${stateKey}`;
        if (!keys.includes(key)) keys.push(key);
      }
    });
  });
  return keys;
}

function renderLivePreview(drops, config) {
  const container = document.getElementById("live-preview-table");
  if (drops.length === 0) { container.innerHTML = ""; return; }

  // Accumulate totals
  const totals = {};
  drops.forEach(d => {
    Object.entries(d.results || {}).forEach(([key, raceResults]) => {
      if (!totals[key]) totals[key] = {};
      Object.entries(raceResults).forEach(([cid, votes]) => {
        totals[key][cid] = (totals[key][cid] || 0) + votes;
      });
    });
  });

  let html = `<table><thead><tr><th>Race</th><th>Candidate</th><th>Votes</th><th>%</th></tr></thead><tbody>`;
  Object.entries(totals).forEach(([key, results]) => {
    const candidates = (config.candidates[key] || []);
    const grand = Object.values(results).reduce((a, b) => a + b, 0);
    candidates.sort((a, b) => (results[b.id] || 0) - (results[a.id] || 0)).forEach((c, i) => {
      const v = results[c.id] || 0;
      const pct = grand > 0 ? (v / grand * 100).toFixed(1) : "0.0";
      html += `<tr>
        ${i === 0 ? `<td rowspan="${candidates.length}" style="color:var(--accent)">${key}</td>` : ""}
        <td>${c.name || c.party}</td>
        <td>${fmtNum(v)}</td>
        <td>${pct}%</td>
      </tr>`;
    });
  });
  html += "</tbody></table>";
  container.innerHTML = html;
}

function logDrop(msg, important = false) {
  const log = document.getElementById("drop-log");
  const empty = log.querySelector(".log-empty");
  if (empty) empty.remove();
  const entry = document.createElement("div");
  entry.className = "log-entry" + (important ? " important" : "");
  const time = new Date().toLocaleTimeString();
  entry.innerHTML = `<span class="log-time">${time}</span>${msg}`;
  log.insertBefore(entry, log.firstChild);
}

// ── SYNC HELPERS ──────────────────────────────────────────
function syncStateSelectsAcrossTabs() {
  const selects = [
    document.getElementById("candidate-state-select"),
    document.getElementById("modifier-state-select")
  ];
  selects.forEach(sel => {
    const cur = sel.value;
    sel.innerHTML = `<option value="national">National</option>` +
      appState.states.map(s => `<option value="${s.abbr}" ${s.abbr === cur ? "selected" : ""}>${s.name}</option>`).join("");
  });
}

// ── TOAST ─────────────────────────────────────────────────
function toast(msg, type = "") {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className = "toast show" + (type ? " " + type : "");
  setTimeout(() => { t.className = "toast"; }, 3000);
}
