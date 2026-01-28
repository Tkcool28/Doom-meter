/* Doomroom News — app.js
   Uses GDELT DOC API via JSONP (so it works on GitHub Pages without CORS pain).
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

// GDELT DOC API base
const GDELT_BASE = "https://api.gdeltproject.org/api/v2/doc/doc";

// Query drivers (feel free to tweak)
const DRIVERS = [
  "war OR invasion OR strikes OR missile OR troops",
  "climate OR wildfire OR flood OR heatwave OR drought",
  "election OR voting OR democracy OR parliament OR coup",
  "hack OR ransomware OR cyberattack OR outage OR breach",
  "nuclear OR reactor OR uranium OR ballistic OR ICBM",
  "economy OR inflation OR recession OR layoffs OR bank",
  "asteroid OR meteor OR comet OR space debris OR solar flare",
  "pandemic OR outbreak OR virus OR quarantine OR WHO",
];

// ---------- Utilities ----------
function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function normalizeTitle(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[“”]/g, '"')
    .replace(/[’]/g, "'")
    .trim();
}

// JSONP fetch with timeout
function jsonp(url, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const cb = "cb_" + Math.random().toString(36).slice(2);
    const script = document.createElement("script");

    let done = false;
    const cleanup = () => {
      if (script && script.parentNode) script.parentNode.removeChild(script);
      try { delete window[cb]; } catch (_) { window[cb] = undefined; }
    };

    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      cleanup();
      reject(new Error("JSONP timeout"));
    }, timeoutMs);

    window[cb] = (data) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      cleanup();
      resolve(data);
    };

    // Ensure format=jsonp and callback are on the URL
    const u = new URL(url);
    u.searchParams.set("format", "jsonp");
    u.searchParams.set("callback", cb);

    script.src = u.toString();
    script.onerror = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      cleanup();
      reject(new Error("JSONP load error"));
    };

    document.body.appendChild(script);
  });
}

async function fetchDriver(query, timespan = "6h", maxrecords = 60) {
  const u = new URL(GDELT_BASE);
  u.searchParams.set("query", query);
  u.searchParams.set("mode", "artlist");
  u.searchParams.set("sort", "datedesc");
  u.searchParams.set("timespan", timespan);
  u.searchParams.set("maxrecords", String(maxrecords));

  const data = await jsonp(u.toString());
  return (data && Array.isArray(data.articles)) ? data.articles : [];
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

// ---------- Classification (the silly science) ----------
const K = {
  conflict: ["war", "invasion", "strike", "missile", "troops", "bomb", "shell", "hostage", "ceasefire", "attack"],
  climate: ["climate", "wildfire", "flood", "heatwave", "drought", "storm", "hurricane", "tornado", "emissions"],
  economy: ["inflation", "recession", "layoffs", "bank", "debt", "default", "economic", "market", "rates", "tariff"],
  democracy: ["election", "vote", "voting", "democracy", "parliament", "coup", "constitution", "supreme court"],
  cyber: ["hack", "hacked", "ransomware", "cyber", "breach", "leak", "outage", "ddos", "malware"],
  nuclear: ["nuclear", "reactor", "uranium", "plutonium", "icbm", "ballistic", "warhead"],
  space: ["asteroid", "meteor", "comet", "space", "satellite", "solar flare", "cosmic", "orbital", "debris"],
};

function scoreHits(title, words) {
  const t = normalizeTitle(title);
  let hits = 0;
  for (const w of words) {
    if (t.includes(w)) hits++;
  }
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

  breakdown.conflict_heat += c1 * 5;
  breakdown.climate_weirdness += c2 * 4;
  breakdown.economy_panic += c3 * 4;
  breakdown.democracy_melting += c4 * 4;
  breakdown.cyber_chaos += c5 * 4;
  breakdown.nuclear_words += c6 * 6;
  breakdown.space_rocks += c7 * 3;

  let weight =
    breakdown.conflict_heat +
    breakdown.climate_weirdness +
    breakdown.economy_panic +
    breakdown.democracy_melting +
    breakdown.cyber_chaos +
    breakdown.nuclear_words +
    breakdown.space_rocks;

  if (weight === 0) {
    breakdown.misc_chaos = 1;
    weight = 1;
  } else {
    // extra misc spice so the bar isn't always zero
    breakdown.misc_chaos = Math.max(0, Math.round(weight * 0.15));
  }

  const domains = [];
  if (c1) domains.push("conflict");
  if (c2) domains.push("climate");
  if (c3) domains.push("economy");
  if (c4) domains.push("democracy");
  if (c5) domains.push("cyber");
  if (c6) domains.push("nuclear");
  if (c7) domains.push("space");
  if (!domains.length) domains.push("misc");

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
  const t = String(title || "Untitled headline");
  const openers = {
    conflict: "In today’s episode of ‘Surely This Won’t Have Consequences,’",
    climate: "In today’s episode of ‘The Atmosphere Chooses Violence,’",
    economy: "In today’s episode of ‘Numbers Go Brrr (Bad),’",
    democracy: "In today’s episode of ‘Democracy Jenga,’",
    cyber: "In today’s episode of ‘Password123 Strikes Again,’",
    nuclear: "In today’s episode of ‘Let’s Not Say The N-Word (Nuclear),’",
    space: "In today’s episode of ‘Rocks Falling From The Sky (Probably Fine),’",
    misc: "In today’s episode of ‘Reality Is A Little Crunchy,’",
  };
  return `${openers[d] || openers.misc} ${t}. Analysts report elevated levels of ‘uh-oh.’`;
}

// ---------- Rendering ----------
function renderBreakdown(breakdown) {
  const keys = [
    ["conflict_heat", "Conflict Heat"],
    ["climate_weirdness", "Climate Weirdness"],
    ["economy_panic", "Economic Drama"],
    ["democracy_melting", "Democracy Melting"],
    ["cyber_chaos", "Cyber Chaos"],
    ["nuclear_words", "Nuclear Words"],
    ["space_rocks", "Space Rocks"],
    ["misc_chaos", "Misc. Chaos"],
  ];

  els.breakdownList.innerHTML = "";

  const maxVal = Math.max(1, ...keys.map(([k]) => breakdown[k] || 0));

  keys.forEach(([k, label]) => {
    const v = breakdown[k] || 0;
    const pct = Math.round((v / maxVal) * 100);

    const row = document.createElement("div");
    row.className = "row";

    const left = document.createElement("div");
    left.style.flex = "1";

    const name = document.createElement("div");
    name.className = "row__name";
    name.textContent = label;

    const bar = document.createElement("div");
    bar.className = "bar";

    const fill = document.createElement("div");
    fill.className = "bar__fill";
    fill.style.width = `${pct}%`;

    bar.appendChild(fill);
    left.appendChild(name);
    left.appendChild(bar);

    const right = document.createElement("div");
    right.className = "row__value";
    right.textContent = String(v);

    row.appendChild(left);
    row.appendChild(right);

    els.breakdownList.appendChild(row);
  });
}

function storyCard(story, clickable = true) {
  const div = document.createElement("div");
  div.className = "item";

  const title = document.createElement("div");
  title.className = "item__title";
  title.textContent = story.title;

  const meta = document.createElement("div");
  meta.className = "item__meta";
  meta.textContent = `${story.source || "Unknown"} • weight ${story.weight}`;

  const satire = document.createElement("div");
  satire.className = "item__satire";
  satire.textContent = story.satire;

  div.appendChild(title);
  div.appendChild(meta);
  div.appendChild(satire);

  if (clickable) {
    div.style.cursor = "pointer";
    div.addEventListener("click", () => openModal(story));
  }

  return div;
}

function openModal(story) {
  els.modalTitle.textContent = story.title;
  els.modalSatire.textContent = story.satire;

  const safeUrl = story.url && story.url.startsWith("http") ? story.url : "#";
  els.modalLink.href = safeUrl;

  els.modal.classList.remove("hidden");
}

function closeModal() {
  els.modal.classList.add("hidden");
}

els.closeModal.addEventListener("click", closeModal);
els.modalBackdrop.addEventListener("click", closeModal);

// prevent taps inside the sheet from closing on some mobile browsers
els.modalSheet.addEventListener("click", (e) => e.stopPropagation());

function compute(articles) {
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

  const stories = articles.map((a, idx) => {
    const title = a.title || "Untitled headline";
    const url = a.url || "#";
    const source = a.domain || a.sourceCountry || "Unknown source";
    const publishedAt = a.seendate || "";

    const { breakdown: b, weight, domains } = classify(title);
    Object.keys(b).forEach((k) => (breakdown[k] = (breakdown[k] || 0) + (b[k] || 0)));

    return {
      id: `${idx}_${normalizeTitle(title).slice(0, 40)}`,
      title,
      url,
      source,
      publishedAt,
      domains,
      weight,
      satire: satireLine(title, domains),
    };
  });

  const avg = stories.length
    ? stories.reduce((s, x) => s + x.weight, 0) / stories.length
    : 0;

  const doomIndex = clamp(Math.round(avg * 12), 0, 100);

  // Drivers = highest absolute weights
  const drivers = [...stories].sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight)).slice(0, 8);

  return { doomIndex, doomLabel: labelFor(doomIndex), breakdown, drivers, stories };
}

function renderLists({ drivers, stories }) {
  els.driversList.innerHTML = "";
  drivers.forEach((s) => els.driversList.appendChild(storyCard(s, true)));

  els.storiesList.innerHTML = "";
  stories.slice(0, 40).forEach((s) => els.storiesList.appendChild(storyCard(s, true)));
}

// ---------- Main refresh ----------
async function refresh() {
  els.doomValue.textContent = "--";
  els.doomLabel.textContent = "Consulting the omens...";
  els.meterFill.style.width = "0%";
  els.updatedAt.textContent = "";

  els.driversList.innerHTML = "";
  els.storiesList.innerHTML = "";
  els.breakdownList.innerHTML = "";

  try {
    const pulls = await Promise.all(
      DRIVERS.map((q) => fetchDriver(q, "6h", 60).catch(() => []))
    );

    const all = dedupe(pulls.flat()).slice(0, 140);
    const result = compute(all);

    els.doomValue.textContent = String(result.doomIndex);
    els.doomLabel.textContent = result.doomLabel;
    els.meterFill.style.width = `${result.doomIndex}%`;
    els.updatedAt.textContent = `Updated: ${new Date().toLocaleString()}`;

    renderBreakdown(result.breakdown);
    renderLists(result);
  } catch (err) {
    els.doomValue.textContent = "!!";
    els.doomLabel.textContent = "Error loading headlines. (The universe refused to cooperate.)";
    els.updatedAt.textContent = String(err && err.message ? err.message : err);
  }
}

els.refreshBtn.addEventListener("click", refresh);
refresh();
