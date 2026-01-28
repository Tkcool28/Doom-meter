/* Doomroom News — app.js (GDELT JSONP / GitHub Pages safe)
   Version: 2026-01-28a
*/

const APP_VERSION = "2026-01-28a";

// ---------- DOM ----------
const els = {
  refreshBtn: document.getElementById("refreshBtn"),
  doomValue: document.getElementById("doomValue"),
  doomLabel: document.getElementById("doomLabel"),
  meterFill: document.getElementById("meterFill"),
  updatedAt: document.getElementById("updatedAt"),
  breakdownList: document.getElementById("breakdownList"),
  driversList: document.getElementById("driversList"),
  storiesList: document.getElementById("storiesList"),

  modal: document.getElementById("modal"),
  closeModal: document.getElementById("closeModal"),
  modalBackdrop: document.getElementById("modalBackdrop"),
  modalTitle: document.getElementById("modalTitle"),
  modalSatire: document.getElementById("modalSatire"),
  modalLink: document.getElementById("modalLink"),
};

// ---------- Helpers ----------
function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function escapeText(s) {
  return String(s ?? "");
}

function normalizeTitle(s) {
  return escapeText(s)
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function labelFor(doomIndex) {
  if (doomIndex >= 85) return "Full doom. The lamps are flickering.";
  if (doomIndex >= 65) return "This seems… actionable.";
  if (doomIndex >= 45) return "Elevated levels of ‘uh-oh.’";
  if (doomIndex >= 25) return "Mild doom. Keep snacks nearby.";
  return "We’re so back.";
}

// ---------- JSONP (CORS-proof) ----------
function jsonp(url, { timeoutMs = 12000 } = {}) {
  return new Promise((resolve, reject) => {
    const cb = `__doom_cb_${Math.random().toString(16).slice(2)}`;
    const script = document.createElement("script");

    let done = false;

    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      cleanup();
      reject(new Error(`JSONP timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      try {
        delete window[cb];
      } catch (_) {}
      if (script.parentNode) script.parentNode.removeChild(script);
    }

    window[cb] = (data) => {
      if (done) return;
      done = true;
      cleanup();
      resolve(data);
    };

    const fullUrl = url + (url.includes("?") ? "&" : "?") + `format=jsonp&callback=${cb}`;
    script.src = fullUrl;
    script.async = true;

    script.onerror = () => {
      if (done) return;
      done = true;
      cleanup();
      reject(new Error("JSONP script load error"));
    };

    document.body.appendChild(script);
  });
}

// ---------- GDELT ----------
const GDELT_BASE = "https://api.gdeltproject.org/api/v2/doc/doc";

async function fetchGdeltArticles(query, timespan = "6h", maxrecords = 60) {
  const u = new URL(GDELT_BASE);
  u.searchParams.set("query", query);
  u.searchParams.set("mode", "artlist");
  u.searchParams.set("sort", "datedesc");
  u.searchParams.set("format", "jsonp"); // kept for readability; jsonp() also appends it
  u.searchParams.set("timespan", timespan);
  u.searchParams.set("maxrecords", String(maxrecords));

  // JSONP returns an object with .articles usually
  const data = await jsonp(u.toString(), { timeoutMs: 14000 });
  const articles = Array.isArray(data?.articles) ? data.articles : [];
  return articles;
}

function dedupe(articles) {
  const seen = new Set();
  const out = [];
  for (const a of articles) {
    const key = normalizeTitle(a?.title || "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

// ---------- Doom classification ----------
function classify(title) {
  const t = normalizeTitle(title);

  // domains (feel free to tweak)
  const tags = {
    conflict_heat: [
      "war", "missile", "attack", "strike", "bomb", "military", "invasion", "troops",
      "hostage", "terror", "airstrike", "ceasefire", "border clashes"
    ],
    climate_weirdness: [
      "heatwave", "flood", "wildfire", "hurricane", "tornado", "drought", "storm",
      "record heat", "climate", "evacuation", "landslide"
    ],
    economy_panic: [
      "recession", "inflation", "rate hike", "market crash", "bank", "layoffs",
      "defaults", "debt crisis", "currency", "unemployment"
    ],
    democracy_melting: [
      "election", "coup", "martial law", "vote", "voting", "fraud", "protest crackdown",
      "authoritarian", "impeachment", "constitution"
    ],
    cyber_chaos: [
      "ransomware", "hack", "cyberattack", "breach", "leak", "outage", "ddos"
    ],
    nuclear_words: [
      "nuclear", "uranium", "plutonium", "reactor", "icbm", "atomic"
    ],
    space_rocks: [
      "asteroid", "meteor", "near-earth object", "comet", "impact risk"
    ],
    misc_chaos: [
      "shooting", "explosion", "collapse", "pandemic", "outbreak", "emergency",
      "evacuate", "riot", "crash", "derailment"
    ],
  };

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

  // Score: count keyword hits per bucket
  for (const [k, words] of Object.entries(tags)) {
    let hits = 0;
    for (const w of words) {
      if (t.includes(w)) hits += 1;
    }
    breakdown[k] = hits;
  }

  // weight: pick strongest bucket, plus a bit of the rest
  const maxBucket = Math.max(...Object.values(breakdown));
  const sum = Object.values(breakdown).reduce((a, b) => a + b, 0);

  // Lightly comic weighting
  const weight = clamp(Math.round(maxBucket * 5 + (sum - maxBucket) * 1.5), 0, 10);

  const domains = Object.entries(breakdown)
    .filter(([, v]) => v > 0)
    .map(([k]) => k);

  return { domains, weight, breakdown };
}

function satireLine(title) {
  const t = normalizeTitle(title);
  if (t.includes("nuclear")) return "Analysts report elevated levels of ‘do not press that button.’";
  if (t.includes("flood") || t.includes("wildfire") || t.includes("storm"))
    return "Experts recommend: sandbags, vibes, and a backup plan.";
  if (t.includes("election") || t.includes("vote"))
    return "Democracy makes a noise like a laptop fan under load.";
  if (t.includes("hack") || t.includes("breach"))
    return "Password strength upgraded from ‘bad’ to ‘tragic.’";
  if (t.includes("war") || t.includes("attack") || t.includes("strike"))
    return "Global mood: tense. Snacks: required.";
  return "In today’s episode of ‘Surely This Won’t Have Consequences’…";
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

  const maxVal = Math.max(1, ...keys.map(([k]) => breakdown[k] || 0));

  els.breakdownList.innerHTML = "";
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

function storyCard(story) {
  const div = document.createElement("div");
  div.className = "item";

  const title = document.createElement("div");
  title.className = "item__title";
  title.textContent = story.title;

  const meta = document.createElement("div");
  meta.className = "item__meta";
  meta.textContent = `${story.source} • weight ${story.weight}`;

  const satire = document.createElement("div");
  satire.className = "item__satire";
  satire.textContent = story.satire;

  div.appendChild(title);
  div.appendChild(meta);
  div.appendChild(satire);

  div.style.cursor = "pointer";
  div.addEventListener("click", () => openModal(story));

  return div;
}

function renderLists({ drivers, stories }) {
  els.driversList.innerHTML = "";
  drivers.forEach((s) => els.driversList.appendChild(storyCard(s)));

  els.storiesList.innerHTML = "";
  stories.slice(0, 40).forEach((s) => els.storiesList.appendChild(storyCard(s)));
}

// ---------- Modal ----------
function openModal(story) {
  els.modalTitle.textContent = story.title;
  els.modalSatire.textContent = story.satire;

  const href = story.url && story.url !== "#" ? story.url : "#";
  els.modalLink.setAttribute("href", href);

  // If url is missing, disable the link
  if (href === "#") {
    els.modalLink.textContent = "No link available";
    els.modalLink.classList.add("btn--disabled");
    els.modalLink.setAttribute("aria-disabled", "true");
    els.modalLink.addEventListener("click", (e) => e.preventDefault(), { once: true });
  } else {
    els.modalLink.textContent = "Open Original Article";
    els.modalLink.classList.remove("btn--disabled");
    els.modalLink.removeAttribute("aria-disabled");
  }

  els.modal.classList.remove("hidden");
}

function closeModal() {
  els.modal.classList.add("hidden");
}

els.closeModal.addEventListener("click", closeModal);
els.modalBackdrop.addEventListener("click", closeModal);

// ---------- Compute ----------
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
    const title = a?.title || "Untitled headline";
    const url = a?.url || "#";
    const source = a?.domain || a?.sourceCountry || "Unknown source";

    const { weight, breakdown: b } = classify(title);
    Object.keys(breakdown).forEach((k) => {
      breakdown[k] += b[k] || 0;
    });

    return {
      id: `${idx}_${normalizeTitle(title).slice(0, 40)}`,
      title,
      url,
      source,
      weight,
      satire: satireLine(title),
    };
  });

  const avg = stories.length ? stories.reduce((s, x) => s + x.weight, 0) / stories.length : 0;
  const doomIndex = clamp(Math.round(avg * 12), 0, 100);

  const drivers = [...stories]
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
    .slice(0, 10);

  return { doomIndex, doomLabel: labelFor(doomIndex), breakdown, drivers, stories };
}

// ---------- Main refresh ----------
const DRIVERS = [
  "war OR missile OR strike OR attack",
  "election OR voting OR coup OR protest",
  "wildfire OR flood OR hurricane OR storm OR drought",
  "nuclear OR uranium OR reactor",
  "hack OR ransomware OR cyberattack OR breach",
  "inflation OR recession OR layoffs OR debt crisis",
];

async function refresh() {
  els.doomValue.textContent = "—";
  els.doomLabel.textContent = "Loading omens…";
  els.meterFill.style.width = "0%";
  els.updatedAt.textContent = "";
  els.driversList.innerHTML = "";
  els.storiesList.innerHTML = "";
  els.breakdownList.innerHTML = "";

  try {
    const pulls = await Promise.all(
      DRIVERS.map((q) => fetchGdeltArticles(q, "6h", 60).catch(() => []))
    );

    const all = dedupe(pulls.flat()).slice(0, 140);

    if (!all.length) {
      throw new Error("No articles returned from GDELT (empty result set).");
    }

    const result = compute(all);

    els.doomValue.textContent = String(result.doomIndex);
    els.doomLabel.textContent = result.doomLabel;
    els.meterFill.style.width = `${result.doomIndex}%`;
    els.updatedAt.textContent = `Updated: ${new Date().toLocaleString()} • ${all.length} articles • v${APP_VERSION}`;

    renderBreakdown(result.breakdown);
    renderLists(result);
  } catch (err) {
    els.doomValue.textContent = "!!";
    els.doomLabel.textContent = "Error loading headlines.";
    els.updatedAt.textContent = String(err?.message || err);
  }
}

els.refreshBtn.addEventListener("click", refresh);
refresh();
