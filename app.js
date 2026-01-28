/* Doomroom News — app.js (CORS-safe)
   Strategy:
   - Try direct fetch to GDELT (works if CORS allowed)
   - If blocked, fallback to https://api.allorigins.win/raw?url=...
   - Use ONE broad query (more reliable than many parallel calls)
*/

const els = {
  doomValue: document.getElementById("doomValue"),
  doomLabel: document.getElementById("doomLabel"),
  meterFill: document.getElementById("meterFill"),
  updatedAt: document.getElementById("updatedAt"),
  breakdownList: document.getElementById("breakdownList"),
  driversList: document.getElementById("driversList"),
  storiesList: document.getElementById("storiesList"),
  refreshBtn: document.getElementById("refreshBtn"),

  modal: document.getElementById("modal"),
  modalSheet: document.getElementById("modalSheet"),
  modalBackdrop: document.getElementById("modalBackdrop"),
  closeModal: document.getElementById("closeModal"),
  modalTitle: document.getElementById("modalTitle"),
  modalSatire: document.getElementById("modalSatire"),
  modalLink: document.getElementById("modalLink"),
};

const GDELT_BASE = "https://api.gdeltproject.org/api/v2/doc/doc";
const ALLORIGINS = "https://api.allorigins.win/raw?url=";

function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

function normalizeTitle(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[“”]/g, '"')
    .replace(/[’]/g, "'")
    .trim();
}

function dedupe(articles) {
  const seen = new Set();
  const out = [];
  for (const a of articles) {
    const key = normalizeTitle(a && a.title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

async function fetchText(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      cache: "no-store",
      headers: { "Accept": "application/json,text/plain,*/*" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

async function fetchJsonCORS(url) {
  // 1) try direct
  try {
    const txt = await fetchText(url, 15000);
    return JSON.parse(txt);
  } catch (e1) {
    // 2) fallback to proxy
    const proxied = ALLORIGINS + encodeURIComponent(url);
    const txt2 = await fetchText(proxied, 20000);
    return JSON.parse(txt2);
  }
}

async function fetchArticlesBroad(timespan = "12h", maxrecords = 120) {
  // One big net to catch headlines
  const broadQuery =
    "(" +
    [
      "war OR invasion OR strike OR missile OR troops OR attack",
      "climate OR wildfire OR flood OR heatwave OR drought",
      "election OR vote OR democracy OR parliament OR coup",
      "hack OR ransomware OR cyberattack OR breach OR outage",
      "nuclear OR reactor OR uranium OR ballistic OR ICBM",
      "economy OR inflation OR recession OR layoffs OR bank",
      "asteroid OR meteor OR comet OR space debris OR solar flare",
      "pandemic OR outbreak OR virus OR quarantine OR WHO",
    ].join(" OR ") +
    ")";

  const u = new URL(GDELT_BASE);
  u.searchParams.set("query", broadQuery);
  u.searchParams.set("mode", "artlist");
  u.searchParams.set("sort", "datedesc");
  u.searchParams.set("timespan", timespan);
  u.searchParams.set("maxrecords", String(maxrecords));
  u.searchParams.set("format", "json");

  const data = await fetchJsonCORS(u.toString());

  if (data && (data.error || data.errors)) {
    throw new Error(String(data.error || data.errors));
  }

  const articles = (data && Array.isArray(data.articles)) ? data.articles : [];
  return articles;
}

// ---------- Classification ----------
const K = {
  conflict: ["war", "invasion", "strike", "missile", "troops", "bomb", "shell", "hostage", "ceasefire", "attack"],
  climate: ["climate", "wildfire", "flood", "heatwave", "drought", "storm", "hurricane", "tornado", "emissions"],
  economy: ["inflation", "recession", "layoffs", "bank", "debt", "default", "economic", "market", "rates", "tariff"],
  democracy: ["election", "vote", "voting", "democracy", "parliament", "coup", "constitution", "supreme court"],
  cyber: ["hack", "hacked", "ransomware", "cyber", "breach", "leak", "outage", "ddos", "malware"],
  nuclear: ["nuclear", "reactor", "uranium", "plutonium", "icbm", "ballistic", "warhead"],
  space: ["asteroid", "meteor", "comet", "space", "satellite", "solar flare", "cosmic", "orbital", "debris"],
  health: ["pandemic", "outbreak", "virus", "quarantine", "who", "epidemic"],
};

function scoreHits(title, words) {
  const t = normalizeTitle(title);
  let hits = 0;
  for (const w of words) if (t.includes(w)) hits++;
  return hits;
}

function classify(title) {
  const breakdown = {
    conflict_heat: 0,
    climate_weirdness: 0,
    economy_panic: 0,
    democracy_melting: 0,
    cyber_chaos: 0,
    nuclear_words: 0,
    space_rocks: 0,
    misc_chaos: 0,
  };

  const c1 = scoreHits(title, K.conflict);
  const c2 = scoreHits(title, K.climate);
  const c3 = scoreHits(title, K.economy);
  const c4 = scoreHits(title, K.democracy);
  const c5 = scoreHits(title, K.cyber);
  const c6 = scoreHits(title, K.nuclear);
  const c7 = scoreHits(title, K.space);
  const c8 = scoreHits(title, K.health);

  breakdown.conflict_heat += c1 * 5;
  breakdown.climate_weirdness += c2 * 4;
  breakdown.economy_panic += c3 * 4;
  breakdown.democracy_melting += c4 * 4;
  breakdown.cyber_chaos += c5 * 4;
  breakdown.nuclear_words += c6 * 6;
  breakdown.space_rocks += c7 * 3;

  // health contributes to misc chaos (keeps UI simple)
  breakdown.misc_chaos += c8 * 3;

  let weight =
    breakdown.conflict_heat +
    breakdown.climate_weirdness +
    breakdown.economy_panic +
    breakdown.democracy_melting +
    breakdown.cyber_chaos +
    breakdown.nuclear_words +
    breakdown.space_rocks +
    breakdown.misc_chaos;

  const domains = [];
  if (c1) domains.push("conflict");
  if (c2) domains.push("climate");
  if (c3) domains.push("economy");
  if (c4) domains.push("democracy");
  if (c5) domains.push("cyber");
  if (c6) domains.push("nuclear");
  if (c7) domains.push("space");
  if (c8) domains.push("health");
  if (!domains.length) domains.push("misc");

  if (weight === 0) {
    breakdown.misc_chaos += 1;
    weight = 1;
  } else {
    breakdown.misc_chaos += Math.max(0, Math.round(weight * 0.12));
  }

  return { breakdown, weight, domains };
}

function labelFor(doomIndex) {
  if (doomIndex <= 10) return "We’re so back.";
  if (doomIndex <= 25) return "Mildly concerning vibes.";
  if (doomIndex <= 45) return "The timeline is doing that thing again.";
  if (doomIndex <= 65) return "Elevated 'uh-oh' levels detected.";
  if (doomIndex <= 80) return "Fasten seatbelts. The universe is spicy.";
  return "🚨 Maximum doom. Please consult snacks and blankets.";
}

function satireLine(title, domains) {
  const d = domains[0] || "misc";
  const openers = {
    conflict: "In today’s episode of ‘Surely This Won’t Have Consequences,’",
    climate: "In today’s episode of ‘The Atmosphere Chooses Violence,’",
    economy: "In today’s episode of ‘Numbers Go Brrr (Bad),’",
    democracy: "In today’s episode of ‘Democracy Jenga,’",
    cyber: "In today’s episode of ‘Password123 Strikes Again,’",
    nuclear: "In today’s episode of ‘Let’s Not Say The N-Word (Nuclear),’",
    space: "In today’s episode of ‘Rocks Falling From The Sky (Probably Fine),’",
    health: "In today’s episode of ‘Germs Are Ambitious,’",
    misc: "In today’s episode of ‘Reality Is A Little Crunchy,’",
  };
  const
