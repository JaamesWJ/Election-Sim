// ═══════════════════════════════════════════════════════════
// viewer.js — Public Live Results Viewer
// ═══════════════════════════════════════════════════════════
import { db } from "./firebase-config.js";
import { doc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { accumulateTotals, computeResults, classifyResult, fmtNum } from "./simulator.js";
import { US_STATES, STATE_LABEL_POS } from "./states-data.js";

// ── STATE ──────────────────────────────────────────────────
let liveData = null;
let totals = {};           // { raceKey: { candidateId: count } }
let activeRaceType = "president";
let selectedState = null;

// ── CLOCK ──────────────────────────────────────────────────
setInterval(() => {
  document.getElementById("live-clock").textContent =
    new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}, 1000);

// Standby ticker duplication
const tickerText = document.getElementById("standby-ticker-text");
if (tickerText) tickerText.textContent = tickerText.textContent + tickerText.textContent;

// ── FIRESTORE SUBSCRIPTION ─────────────────────────────────
onSnapshot(doc(db, "election", "live"), (snap) => {
  if (!snap.exists() || !snap.data() || snap.data().status === "idle") {
    showScreen("standby");
    return;
  }

  liveData = snap.data();

  if (liveData.status === "live" || liveData.status === "ended") {
    showScreen("live");
    processLiveData();
  } else {
    showScreen("standby");
  }
});

onSnapshot(doc(db, "election", "config"), (snap) => {
  // Config updates handled through liveData.config
});

function showScreen(name) {
  document.getElementById("standby-screen").classList.toggle("active", name === "standby");
  document.getElementById("live-screen").classList.toggle("active", name === "live");
}

// ── MAIN PROCESSING ───────────────────────────────────────
function processLiveData() {
  if (!liveData) return;

  const config = liveData.config;
  const drops = liveData.drops || [];
  const totalDrops = liveData.totalDrops || 1;

  // Accumulate totals per race key
  totals = {};
  drops.forEach(drop => {
    Object.entries(drop.results || {}).forEach(([key, raceResults]) => {
      if (!totals[key]) totals[key] = {};
      Object.entries(raceResults).forEach(([cid, votes]) => {
        totals[key][cid] = (totals[key][cid] || 0) + votes;
      });
    });
  });

  // Update header
  document.getElementById("header-election-name").textContent = config.election?.name || "General Election";
  document.getElementById("header-date").textContent = new Date(liveData.startedAt).toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" });

  const pct = Math.round((drops.length / totalDrops) * 100);
  document.getElementById("pct-reporting").textContent = pct + "%";
  document.getElementById("pct-bar").style.width = pct + "%";

  // Next drop countdown
  if (liveData.status === "live") {
    const elapsed = Date.now() - liveData.startedAt;
    const dropsDone = drops.length;
    const nextDropTime = liveData.startedAt + (dropsDone + 1) * liveData.intervalMs;
    startCountdown(nextDropTime);
  } else {
    document.getElementById("next-drop-timer").textContent = "Ended";
  }

  // Build race tabs
  buildRaceTabs(config);

  // Build map
  buildMap(config);

  // Update map colors
  updateMapColors(config);

  // Summary bar
  updateSummaryBar(config);

  // Ticker
  updateTicker(config);

  // National EV summary
  updateNationalSummary(config);

  // Refresh sidebar if state selected
  if (selectedState) {
    showStateSidebar(selectedState, config);
  }
}

// ── COUNTDOWN ─────────────────────────────────────────────
let countdownTimer = null;
function startCountdown(targetTime) {
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = setInterval(() => {
    const remaining = Math.max(0, targetTime - Date.now());
    if (remaining === 0) { document.getElementById("next-drop-timer").textContent = "Updating…"; return; }
    const m = Math.floor(remaining / 60000).toString().padStart(2, "0");
    const s = Math.floor((remaining % 60000) / 1000).toString().padStart(2, "0");
    document.getElementById("next-drop-timer").textContent = `${m}:${s}`;
  }, 1000);
}

// ── RACE TABS ─────────────────────────────────────────────
function buildRaceTabs(config) {
  const levels = config.election?.globalLevels || ["president"];
  const labels = { president: "President", senate: "Senate", house: "House", governor: "Governor", state_leg: "State Legislature" };
  const container = document.getElementById("race-tabs");
  container.innerHTML = "";
  levels.forEach(level => {
    const tab = document.createElement("button");
    tab.className = "race-tab" + (level === activeRaceType ? " active" : "");
    tab.textContent = labels[level] || level;
    tab.addEventListener("click", () => {
      activeRaceType = level;
      document.querySelectorAll(".race-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      updateMapColors(config);
      if (selectedState) showStateSidebar(selectedState, config);
    });
    container.appendChild(tab);
  });
}

// ── MAP ───────────────────────────────────────────────────
let mapBuilt = false;

function buildMap(config) {
  if (mapBuilt) return;
  mapBuilt = true;

  const svg = document.getElementById("us-map");

  // Use simplified rectangles for continental states (real SVG paths would require topojson)
  // This renders a schematic map with labeled state boxes
  renderSchematicMap(svg, config);
}

function renderSchematicMap(svg, config) {
  svg.innerHTML = "";

  // State grid layout - approximate positions on 960x600 grid
  const stateGrid = getStateGridPositions();

  stateGrid.forEach(({ abbr, x, y, w, h }) => {
    const stateInfo = US_STATES.find(s => s.abbr === abbr);
    if (!stateInfo) return;

    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.dataset.abbr = abbr;

    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("x", x); rect.setAttribute("y", y);
    rect.setAttribute("width", w); rect.setAttribute("height", h);
    rect.setAttribute("rx", "2");
    rect.style.fill = "var(--surface2)";
    rect.style.stroke = "var(--bg)";
    rect.style.strokeWidth = "1.5";
    rect.style.cursor = "pointer";
    rect.style.transition = "fill 0.4s ease";

    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", x + w/2); text.setAttribute("y", y + h/2 + 4);
    text.setAttribute("text-anchor", "middle");
    text.style.fill = "rgba(255,255,255,0.7)";
    text.style.fontSize = w > 30 ? "8px" : "6px";
    text.style.fontFamily = "IBM Plex Mono, monospace";
    text.style.pointerEvents = "none";
    text.textContent = abbr;

    g.appendChild(rect);
    g.appendChild(text);

    g.addEventListener("click", () => {
      selectedState = abbr;
      showStateSidebar(abbr, liveData?.config);
    });
    g.addEventListener("mouseenter", (e) => showTooltip(e, abbr));
    g.addEventListener("mouseleave", hideTooltip);
    g.addEventListener("mousemove", (e) => moveTooltip(e));

    svg.appendChild(g);
  });
}

function updateMapColors(config) {
  if (!config) return;
  const states = config.states || [];
  const parties = config.parties || [];

  document.querySelectorAll("#us-map g[data-abbr]").forEach(g => {
    const abbr = g.dataset.abbr;
    const rect = g.querySelector("rect");
    const text = g.querySelector("text");
    if (!rect) return;

    const stateData = states.find(s => s.abbr === abbr);
    if (!stateData) { rect.style.fill = "var(--surface2)"; rect.style.opacity = "0.3"; return; }

    const stateLevel = stateData.levels || [];
    const globalLevels = config.election?.globalLevels || [];
    if (!stateLevel.includes(activeRaceType) || !globalLevels.includes(activeRaceType)) {
      rect.style.fill = "var(--surface2)";
      rect.style.opacity = "0.3";
      return;
    }

    rect.style.opacity = "1";

    const stateKey = activeRaceType === "president" ? "national" : abbr;
    const key = `${activeRaceType}:${stateKey}`;
    const candidates = config.candidates[key] || [];
    const raceTotals = totals[key] || {};

    if (candidates.length === 0) { rect.style.fill = "var(--surface2)"; return; }

    const results = computeResults(raceTotals, candidates);
    const classification = classifyResult(results, parties);
    const leader = results[0];

    if (!leader || leader.votes === 0) { rect.style.fill = "#2a2a3a"; return; }

    // Find party color
    const party = parties.find(p => p.abbr === leader.party || p.name === leader.party);
    const color = party?.color || getDefaultPartyColor(leader.party || "");

    const colorMap = {
      "dem": "#1a66cc", "lean-dem": "#3a7dd4",
      "rep": "#cc2a1a", "lean-rep": "#d44a3a",
      "toss-up": "#6b5a2a", "ind": "#22a86e", "no-data": "#2a2a3a"
    };

    // Use party color for solid wins, blend toward neutral for lean/toss
    if (classification === "toss-up") {
      rect.style.fill = "#4a4030";
    } else if (classification === "no-data") {
      rect.style.fill = "#2a2a3a";
    } else {
      rect.style.fill = color;
      if (classification.startsWith("lean")) {
        rect.style.opacity = "0.65";
      } else {
        rect.style.opacity = "1";
      }
    }

    // Winner label
    text.style.fill = "rgba(255,255,255,0.9)";
  });
}

function getDefaultPartyColor(partyName) {
  const n = partyName.toLowerCase();
  if (n.includes("dem") || n === "d") return "#1a66cc";
  if (n.includes("rep") || n === "r") return "#cc2a1a";
  if (n.includes("lib")) return "#d4a017";
  if (n.includes("green")) return "#22a86e";
  return "#666699";
}

// ── TOOLTIP ───────────────────────────────────────────────
function showTooltip(e, abbr) {
  const tooltip = document.getElementById("map-tooltip");
  const stateInfo = US_STATES.find(s => s.abbr === abbr) || { name: abbr };
  const config = liveData?.config;

  let html = `<div class="tooltip-state">${stateInfo.name}</div>`;

  if (config) {
    const stateKey = activeRaceType === "president" ? "national" : abbr;
    const key = `${activeRaceType}:${stateKey}`;
    const candidates = config.candidates[key] || [];
    const raceTotals = totals[key] || {};
    const results = computeResults(raceTotals, candidates);

    if (results.length > 0 && results[0].votes > 0) {
      results.slice(0, 3).forEach((r, i) => {
        html += `<div class="tooltip-row">
          <span class="${i === 0 ? "winner" : ""}">${r.name || r.party}</span>
          <span class="${i === 0 ? "winner" : ""}">${r.pct.toFixed(1)}%</span>
        </div>`;
      });
    } else {
      html += `<div class="tooltip-row"><span>No results yet</span></div>`;
    }
  }

  tooltip.innerHTML = html;
  tooltip.classList.add("visible");
  moveTooltip(e);
}

function moveTooltip(e) {
  const tooltip = document.getElementById("map-tooltip");
  const wrap = document.querySelector(".us-map-wrap");
  const rect = wrap.getBoundingClientRect();
  let x = e.clientX - rect.left + 12;
  let y = e.clientY - rect.top + 12;
  if (x + 180 > rect.width) x = e.clientX - rect.left - 180;
  tooltip.style.left = x + "px";
  tooltip.style.top = y + "px";
}

function hideTooltip() {
  document.getElementById("map-tooltip").classList.remove("visible");
}

// ── SIDEBAR ───────────────────────────────────────────────
document.getElementById("close-sidebar").addEventListener("click", () => {
  selectedState = null;
  document.getElementById("sidebar-race-title").textContent = "Select a state";
  document.getElementById("close-sidebar").style.display = "none";
  document.getElementById("sidebar-content").innerHTML = `
    <div class="sidebar-placeholder">
      <span class="ph-icon">🗺️</span>
      <p>Click any state on the map to see detailed results</p>
    </div>`;
});

function showStateSidebar(abbr, config) {
  if (!config) return;
  const stateInfo = config.states.find(s => s.abbr === abbr);
  const stateDisplay = US_STATES.find(s => s.abbr === abbr);
  const name = stateDisplay?.name || abbr;

  document.getElementById("sidebar-race-title").textContent = name;
  document.getElementById("close-sidebar").style.display = "block";

  const levels = config.election?.globalLevels || [];
  const stateLevels = stateInfo?.levels || [];
  const levelLabels = { president: "Presidential", senate: "U.S. Senate", house: "U.S. House", governor: "Governor", state_leg: "State Legislature" };

  let html = "";
  levels.forEach(level => {
    if (!stateLevels.includes(level)) return;
    const stateKey = level === "president" ? "national" : abbr;
    const key = `${level}:${stateKey}`;
    const candidates = config.candidates[key] || [];
    if (candidates.length === 0) return;

    const raceTotals = totals[key] || {};
    const results = computeResults(raceTotals, candidates);
    const grand = results.reduce((a, r) => a + r.votes, 0);

    html += `<div class="race-block">
      <div class="race-block-title">${levelLabels[level] || level}</div>`;

    results.forEach((r, i) => {
      const party = (config.parties || []).find(p => p.abbr === r.party || p.name === r.party);
      const color = party?.color || getDefaultPartyColor(r.party || "");
      html += `
        <div class="candidate-row">
          <div class="cand-color" style="background:${color}"></div>
          <div class="cand-info">
            <div class="cand-name">${r.name || r.party || "Unknown"}</div>
            <div class="cand-party">${r.party || ""}</div>
          </div>
          <div class="cand-bar-wrap">
            <div class="cand-bar"><div class="cand-bar-fill" style="width:${r.pct.toFixed(1)}%;background:${color}"></div></div>
            <div class="cand-pct">${r.pct.toFixed(1)}%</div>
          </div>
          <div style="text-align:right;min-width:70px">
            <div class="cand-votes">${fmtNum(r.votes)}</div>
            ${r.leading && grand > 0 ? `<div class="cand-winner-badge">LEADING</div>` : ""}
          </div>
        </div>`;
    });

    if (level === "president" && stateDisplay?.ev) {
      html += `<div style="font-family:var(--font-mono);font-size:0.65rem;color:var(--accent);margin-top:0.4rem">${stateDisplay.ev} Electoral Votes</div>`;
    }

    html += "</div>";
  });

  if (!html) html = `<p style="color:var(--text-dim);font-family:var(--font-mono);font-size:0.78rem;padding:1rem 0">No active races for this state.</p>`;

  document.getElementById("sidebar-content").innerHTML = html;
}

// ── SUMMARY BAR ───────────────────────────────────────────
function updateSummaryBar(config) {
  const bar = document.getElementById("summary-bar");
  bar.innerHTML = "";

  const levels = config.election?.globalLevels || [];
  const parties = config.parties || [];
  const levelLabels = { president: "PRESIDENT (EV)", senate: "SENATE SEATS", house: "HOUSE SEATS", governor: "GOVERNORS", state_leg: "STATE LEG." };

  levels.forEach(level => {
    const partyCounts = {};
    parties.forEach(p => { partyCounts[p.abbr] = 0; });

    config.states.forEach(s => {
      if (!(s.levels || []).includes(level)) return;
      const stateKey = level === "president" ? "national" : s.abbr;
      const key = `${level}:${stateKey}`;
      const candidates = config.candidates[key] || [];
      const raceTotals = totals[key] || {};
      const results = computeResults(raceTotals, candidates);
      if (results.length === 0 || results[0].votes === 0) return;

      const winner = results[0];
      const partyAbbr = winner.party;

      if (level === "president") {
        // Count EV
        const ev = s.ev || 0;
        if (!partyCounts[partyAbbr]) partyCounts[partyAbbr] = 0;
        partyCounts[partyAbbr] += ev;
      } else {
        if (!partyCounts[partyAbbr]) partyCounts[partyAbbr] = 0;
        partyCounts[partyAbbr]++;
      }
    });

    const div = document.createElement("div");
    div.className = "summary-race";

    const seatsHtml = Object.entries(partyCounts)
      .filter(([, c]) => c > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([abbr, count]) => {
        const p = parties.find(x => x.abbr === abbr);
        const color = p?.color || getDefaultPartyColor(abbr);
        return `<span class="summary-seat-block"><span class="seat-dot" style="background:${color}"></span>${count}</span>`;
      }).join(`<span class="summary-divider">·</span>`);

    div.innerHTML = `
      <span class="summary-race-label">${levelLabels[level] || level}</span>
      <div class="summary-seats">${seatsHtml || '<span style="color:var(--text-dim)">—</span>'}</div>
    `;
    bar.appendChild(div);
  });
}

// ── NATIONAL EV SUMMARY ───────────────────────────────────
function updateNationalSummary(config) {
  const ns = document.getElementById("national-summary");
  const levels = config.election?.globalLevels || [];
  if (!levels.includes("president")) { ns.innerHTML = ""; return; }

  const parties = config.parties || [];
  const evByParty = {};
  let totalEV = 0;

  config.states.forEach(s => {
    if (!(s.levels || []).includes("president")) return;
    const key = "president:national";
    const candidates = config.candidates[key] || [];
    const raceTotals = totals[key] || {};
    const results = computeResults(raceTotals, candidates);
    if (results.length === 0 || results[0].votes === 0) return;
    const winner = results[0];
    const ev = s.ev || 0;
    evByParty[winner.party] = (evByParty[winner.party] || 0) + ev;
    totalEV += ev;
  });

  if (totalEV === 0) { ns.innerHTML = ""; return; }

  const segments = Object.entries(evByParty)
    .sort((a, b) => b[1] - a[1])
    .map(([abbr, ev]) => {
      const p = parties.find(x => x.abbr === abbr);
      const color = p?.color || getDefaultPartyColor(abbr);
      const pct = (ev / 538 * 100).toFixed(1);
      return { abbr, ev, color, pct };
    });

  ns.innerHTML = `
    <h4>Electoral College</h4>
    <div class="ev-bar-wrap">
      <div class="ev-bar">
        ${segments.map(s => `<div class="ev-bar-seg" style="width:${s.pct}%;background:${s.color}"></div>`).join("")}
        <div class="ev-bar-seg" style="flex:1;background:var(--surface2)"></div>
      </div>
      <div class="ev-labels">
        ${segments.map(s => `<span class="ev-label" style="color:${s.color}">${s.abbr}: ${s.ev}</span>`).join("")}
        <span class="ev-label" style="color:var(--text-dim)">270 to win</span>
      </div>
    </div>
  `;
}

// ── TICKER ────────────────────────────────────────────────
function updateTicker(config) {
  const inner = document.getElementById("bottom-ticker-inner");
  const levels = config.election?.globalLevels || [];
  const parties = config.parties || [];

  let items = [];

  levels.forEach(level => {
    const levelLabel = { president: "PRES", senate: "SEN", house: "HOUSE", governor: "GOV", state_leg: "ST.LEG" }[level] || level.toUpperCase();
    config.states.forEach(s => {
      if (!(s.levels || []).includes(level)) return;
      const stateKey = level === "president" ? "national" : s.abbr;
      const key = `${level}:${stateKey}`;
      const candidates = config.candidates[key] || [];
      const raceTotals = totals[key] || {};
      const results = computeResults(raceTotals, candidates);
      if (results.length === 0 || results[0].votes === 0) return;

      const r0 = results[0];
      const r1 = results[1];
      const margin = r0.pct - (r1?.pct || 0);

      items.push(`${levelLabel} · ${s.abbr} · ${r0.name || r0.party} ${r0.pct.toFixed(1)}%${r1 ? ` / ${r1.name || r1.party} ${r1.pct.toFixed(1)}%` : ""} (${margin > 0 ? "+" : ""}${margin.toFixed(1)})`);
    });
  });

  if (items.length === 0) {
    inner.textContent = "Awaiting results · " + (config.election?.name || "Election Night") + " · Stay with Election Network for live coverage · ";
    return;
  }

  // Duplicate for seamless scroll
  const text = items.join("  ·  ") + "    ·    ";
  inner.textContent = text + text;
}

// ── SCHEMATIC MAP GRID ─────────────────────────────────────
function getStateGridPositions() {
  // Hex/grid layout approximating the US map, 960x580 SVG
  const W = 38, H = 28, GAP = 2;
  const g = W + GAP;
  const h = H + GAP;

  return [
    // Row 0
    { abbr: "WA", x: 0*g, y: 0*h }, { abbr: "MT", x: 1*g, y: 0*h }, { abbr: "ND", x: 2*g, y: 0*h },
    { abbr: "MN", x: 3*g, y: 0*h }, { abbr: "MI", x: 4*g, y: 0*h }, { abbr: "VT", x: 6*g, y: 0*h },
    { abbr: "NH", x: 7*g, y: 0*h }, { abbr: "ME", x: 8*g, y: 0*h },
    // Row 1
    { abbr: "OR", x: 0*g, y: 1*h }, { abbr: "ID", x: 1*g, y: 1*h }, { abbr: "SD", x: 2*g, y: 1*h },
    { abbr: "WI", x: 3*g, y: 1*h }, { abbr: "NY", x: 5*g, y: 1*h }, { abbr: "MA", x: 7*g, y: 1*h },
    // Row 2
    { abbr: "CA", x: 0*g, y: 2*h }, { abbr: "WY", x: 1*g, y: 2*h }, { abbr: "NE", x: 2*g, y: 2*h },
    { abbr: "IA", x: 3*g, y: 2*h }, { abbr: "IL", x: 4*g, y: 2*h }, { abbr: "OH", x: 5*g, y: 2*h },
    { abbr: "PA", x: 6*g, y: 2*h }, { abbr: "NJ", x: 7*g, y: 2*h }, { abbr: "CT", x: 8*g, y: 2*h },
    // Row 3
    { abbr: "NV", x: 0*g, y: 3*h }, { abbr: "CO", x: 1*g, y: 3*h }, { abbr: "KS", x: 2*g, y: 3*h },
    { abbr: "MO", x: 3*g, y: 3*h }, { abbr: "IN", x: 4*g, y: 3*h }, { abbr: "WV", x: 5*g, y: 3*h },
    { abbr: "VA", x: 6*g, y: 3*h }, { abbr: "MD", x: 7*g, y: 3*h }, { abbr: "DE", x: 8*g, y: 3*h },
    // Row 4
    { abbr: "AZ", x: 0*g, y: 4*h }, { abbr: "UT", x: 1*g, y: 4*h }, { abbr: "OK", x: 2*g, y: 4*h },
    { abbr: "AR", x: 3*g, y: 4*h }, { abbr: "KY", x: 4*g, y: 4*h }, { abbr: "NC", x: 5*g, y: 4*h },
    { abbr: "SC", x: 6*g, y: 4*h }, { abbr: "DC", x: 8*g, y: 4*h },
    // Row 5
    { abbr: "NM", x: 0*g, y: 5*h }, { abbr: "TX", x: 1*g, y: 5*h }, { abbr: "LA", x: 2*g, y: 5*h },
    { abbr: "MS", x: 3*g, y: 5*h }, { abbr: "AL", x: 4*g, y: 5*h }, { abbr: "GA", x: 5*g, y: 5*h },
    { abbr: "TN", x: 6*g, y: 5*h },
    // Row 6
    { abbr: "AK", x: 0*g, y: 6*h }, { abbr: "HI", x: 1*g, y: 6*h },
    { abbr: "FL", x: 4*g, y: 6*h }, { abbr: "RI", x: 8*g, y: 6*h },
  ].map(s => ({ ...s, w: W, h: H }));
}
