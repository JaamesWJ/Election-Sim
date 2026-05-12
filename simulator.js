// ═══════════════════════════════════════════════════════════
// simulator.js — Core Election Simulation Engine
// ═══════════════════════════════════════════════════════════

/**
 * Parse a Google Sheets share URL into a CSV export URL.
 * Works with /edit, /view, and /pub links.
 */
export function sheetsUrlToCsv(shareUrl, tabName = "Form Responses 1") {
  try {
    const match = shareUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    if (!match) throw new Error("Invalid Sheets URL");
    const id = match[1];
    const encoded = encodeURIComponent(tabName);
    return `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&sheet=${encoded}`;
  } catch {
    return null;
  }
}

/**
 * Fetch raw ballot rows from Google Sheets CSV.
 * Returns an array of objects keyed by header names.
 */
export async function fetchBallots(sheetsUrl, tabName) {
  const csvUrl = sheetsUrlToCsv(sheetsUrl, tabName);
  if (!csvUrl) throw new Error("Could not parse Sheets URL");

  const resp = await fetch(csvUrl);
  if (!resp.ok) throw new Error("Failed to fetch sheet (check sharing settings)");

  const text = await resp.text();
  return parseCsv(text);
}

function parseCsv(text) {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map(line => {
    const vals = parseCsvLine(line);
    const row = {};
    headers.forEach((h, i) => { row[h] = (vals[i] || "").trim(); });
    return row;
  });
}

function parseCsvLine(line) {
  const result = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQ = !inQ; }
    else if (c === "," && !inQ) { result.push(cur); cur = ""; }
    else { cur += c; }
  }
  result.push(cur);
  return result.map(s => s.replace(/^"|"$/g, "").trim());
}

/**
 * Tally player ballots for a specific race.
 * @param {Array} ballotRows - raw rows from fetchBallots()
 * @param {string} columnHeader - column name in the sheet for this race
 * @returns {Object} map of candidateName → vote count
 */
export function tallyPlayerVotes(ballotRows, columnHeader) {
  const tally = {};
  for (const row of ballotRows) {
    const choice = (row[columnHeader] || "").trim();
    if (!choice) continue;
    tally[choice] = (tally[choice] || 0) + 1;
  }
  return tally;
}

/**
 * Simulate one vote drop for a race.
 *
 * @param {Object} config — race configuration
 *   config.candidates: Array of { id, name, party }
 *   config.basePartisanship: { candidateId: percentage (0–100), ... } — must sum to 100
 *   config.modifiers: Array of { name, favorsCandidateId, pct (0–100) }
 *   config.totalVotes: total votes for this race across all drops
 *   config.dropIndex: which drop this is (0-based)
 *   config.totalDrops: total number of drops
 *   config.playerVoteTally: { candidateName: count, ... } current player votes
 *   config.playerModifierPct: 0–100 (overall player vote impact)
 *
 * @returns {Object} { candidateId: voteCount, ... } for this drop
 */
export function simulateDrop(config) {
  const {
    candidates,
    basePartisanship,
    modifiers = [],
    totalVotes,
    dropIndex,
    totalDrops,
    playerVoteTally = {},
    playerModifierPct = 50
  } = config;

  // Votes for this specific drop (distribute evenly, last drop gets remainder)
  const votesPerDrop = Math.floor(totalVotes / totalDrops);
  const isLastDrop = dropIndex === totalDrops - 1;
  const dropVotes = isLastDrop
    ? totalVotes - votesPerDrop * (totalDrops - 1)
    : votesPerDrop;

  // 1. Start from base partisanship
  const shares = {};
  candidates.forEach(c => {
    shares[c.id] = (basePartisanship[c.id] || 0);
  });

  // 2. Apply modifiers — each shifts the share relative to base
  for (const mod of modifiers) {
    if (!mod.favorsCandidateId || !mod.pct) continue;
    const shift = mod.pct; // positive = favors favorsCandidateId
    const others = candidates.filter(c => c.id !== mod.favorsCandidateId);
    const perOther = others.length > 0 ? shift / others.length : 0;
    shares[mod.favorsCandidateId] = (shares[mod.favorsCandidateId] || 0) + shift;
    others.forEach(c => {
      shares[c.id] = (shares[c.id] || 0) - perOther;
    });
  }

  // Normalize shares so they sum to 100
  const total = Object.values(shares).reduce((a, b) => a + b, 0);
  candidates.forEach(c => { shares[c.id] = (shares[c.id] || 0) / total * 100; });

  // 3. Compute simulated votes
  const simVotes = {};
  candidates.forEach(c => {
    simVotes[c.id] = Math.round(dropVotes * shares[c.id] / 100);
  });

  // 4. Compute player votes for this drop
  // Player votes are spread across drops proportionally
  const totalPlayerVotes = Object.values(playerVoteTally).reduce((a, b) => a + b, 0);
  const playerDropShare = totalPlayerVotes / totalDrops;
  const playerImpact = playerModifierPct / 100; // 0 = no impact, 1 = full impact

  // Player votes nullify the same number of simulated votes
  const playerVotesThisDrop = {};
  candidates.forEach(c => {
    const cName = c.name;
    const playerCount = (playerVoteTally[cName] || 0) / totalDrops;
    playerVotesThisDrop[c.id] = playerCount;
  });

  // Blend: simVotes*(1-impact) + playerVotes*(impact) — scaled to dropVotes
  const finalVotes = {};
  candidates.forEach(c => {
    const sim = simVotes[c.id] || 0;
    const player = playerVotesThisDrop[c.id] || 0;
    // Scale player votes to same magnitude as sim votes
    const playerScaled = totalPlayerVotes > 0
      ? (player / totalPlayerVotes) * dropVotes
      : 0;
    finalVotes[c.id] = Math.max(0, Math.round(
      sim * (1 - playerImpact) + playerScaled * playerImpact
    ));
  });

  // Fix rounding so total == dropVotes
  fixRounding(finalVotes, dropVotes);

  return finalVotes;
}

function fixRounding(votes, target) {
  const keys = Object.keys(votes);
  let sum = keys.reduce((a, k) => a + votes[k], 0);
  let diff = target - sum;
  if (diff === 0) return;
  // Add/subtract from largest
  keys.sort((a, b) => votes[b] - votes[a]);
  votes[keys[0]] += diff;
}

/**
 * Accumulate all drops so far into running totals.
 * @param {Array} drops — array of { candidateId: count } objects
 * @returns {Object} { candidateId: totalCount }
 */
export function accumulateTotals(drops) {
  const totals = {};
  for (const drop of drops) {
    for (const [id, count] of Object.entries(drop)) {
      totals[id] = (totals[id] || 0) + count;
    }
  }
  return totals;
}

/**
 * Determine winner and percentages from vote totals.
 */
export function computeResults(totals, candidates) {
  const grandTotal = Object.values(totals).reduce((a, b) => a + b, 0);
  if (grandTotal === 0) return candidates.map(c => ({ ...c, votes: 0, pct: 0, leading: false }));

  const results = candidates.map(c => ({
    ...c,
    votes: totals[c.id] || 0,
    pct: ((totals[c.id] || 0) / grandTotal * 100)
  }));

  results.sort((a, b) => b.votes - a.votes);
  results[0].leading = true;
  return results;
}

/**
 * Classify a result for map coloring.
 * Returns: 'dem' | 'rep' | 'ind' | 'lean-dem' | 'lean-rep' | 'toss-up' | 'no-data'
 */
export function classifyResult(results, partyColors) {
  if (!results || results.length === 0) return 'no-data';
  const leader = results[0];
  const second = results[1];
  if (!leader || leader.votes === 0) return 'no-data';

  const margin = leader.pct - (second ? second.pct : 0);
  const partyKey = (leader.party || "").toLowerCase().replace(/\s+/g, "-");

  if (margin >= 10) {
    // Solid
    if (partyKey.includes("democrat") || partyKey === "dem" || partyKey === "d") return "dem";
    if (partyKey.includes("republican") || partyKey === "rep" || partyKey === "r") return "rep";
    return "ind";
  } else if (margin >= 3) {
    if (partyKey.includes("democrat") || partyKey === "dem" || partyKey === "d") return "lean-dem";
    if (partyKey.includes("republican") || partyKey === "rep" || partyKey === "r") return "lean-rep";
    return "toss-up";
  } else {
    return "toss-up";
  }
}

/**
 * Format a large number with commas.
 */
export function fmtNum(n) {
  return Math.round(n).toLocaleString();
}
