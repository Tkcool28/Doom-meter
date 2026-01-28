/* Doomroom News — app.js
   Fix: GDELT DOC API is CORS-blocked + JSONP often fails due to nosniff/MIME.
   Solution: fetch JSON through a CORS-safe proxy (AllOrigins raw).
*/

const VERSION = "v1.6.0";

// ---- Settings ----
const GDELT_BASE = "https://api.gdeltproject.org/api/v2/doc/doc";
const PROXY_RAW = "https://api.allorigins.win/raw?url="; // CORS-safe proxy
const DEFAULT_TIMESPAN = "6h";
const MAXRECORDS_PER_QUERY = 30; // keep smaller to reduce timeouts

// Driver queries (tune however you like)
const DRIVERS = [
  { label: "Conflict", q: "war OR conflict OR invasion OR missile OR strike OR drone" },
  { label: "Climate", q: "climate OR wildfire OR flood OR hurricane OR drought OR heatwave" },
  { label: "Economy", q: "recession OR inflation OR layoffs OR debt OR default OR bank OR crash" },
  { label: "Democracy", q: "election OR coup OR protest OR crackdown OR corruption OR tribunal" },
  { label: "Cyber", q: "cyberattack OR ransomware OR breach OR hack OR outage" },
  { label: "Space", q: "asteroid OR meteor OR solar storm OR geomagnetic OR rocket explosion" }
];

// Doom category counters (used for breakdown bars)
const CATS = [
  ["conflict_heat", "Conflict Heat"],
  ["climate_weirdness", "Climate Weirdness"],
  ["economy_panic", "Economic Drama"],
  ["democracy_melting", "Democracy Melting"],
  ["cyber_chaos", "Cyber Chaos"],
  ["nuclear_words", "Nuclear Words"],
  ["space_rocks", "Space Rocks"],
  ["misc_chaos", "Misc. Chaos"]
];

// ---- DOM ----
const els = {
  refreshBtn: document.getElementById("refreshBtn"),
  aboutBtn: document.getElementById("aboutBtn"),

  doomValue: document.getElementById("doomValue"),
  doomLabel: document.getElementById("doomLabel"),
  meterFill: document.getElementById("meterFill"),
  updatedAt: document.getElementById("updatedAt"),

  breakdownList: document.getElementById("breakdownList"),
  driversList: document.getElementById("driversList"),
  storiesList: document.getElementById("storiesList"),

  modal: document.getElementById("modal"),
  modalBackdrop: document.getElementById("modalBackdrop"),
  closeModal: document.getElementById("closeModal"),
  modalTitle: document.getElementById("modalTitle"),
  modalSatire: document.getElementById("modalSatire"),
  modalLink: document.getElementById("modalLink"),
};

// ---- Helpers ----
function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function timeoutPromise(ms, label = "timeout") {
  return new Promise((_, rej) => setTimeout(() => rej(new Error(label)), ms));
}

function normalizeTitle(t) {
  return String(t || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\w\s]/g, "")
    .trim();
}

function dedupe(articles) {
  const seen = new Set();
  const out = [];
  for (const a of articles) {
    const key = normalizeTitle(a.title || "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

// Build a GDELT URL (no proxy applied here)
function buildGdeltUrl(query, timespan = DEFAULT_TIMESPAN, maxrecords = MAXRECORDS_PER_QUERY) {
  const u = new URL(GDELT_BASE);
  u.searchParams.set("query", query);
  u.searchParams.set("mode", "ArtList");
  u.searchParams.set("format", "json");
  u.searchParams.set("sort", "DateDesc");
  u.searchParams.set("timespan", timespan);
  u.searchParams.set("maxrecords", String(maxrecords));
  // You can add these if you want:
  // u.searchParams.set("sourcelang", "English");
  return u.toString();
}

// Fetch JSON via proxy (avoids CORS + JSONP issues)
async function fetchGdeltArticles(query, timespan, maxrecords) {
  const gdeltUrl = buildGdeltUrl(query, timespan, maxrecords);
  const proxied = PROXY_RAW + encodeURIComponent(gdeltUrl);

  // hard timeout so we never hang forever
  const resText = await Promise.race([
    fetch(proxied, { cache: "no-store" }).then((r) => {
      if (!r.ok) throw new Error(`proxy_http_${r.status}`);
      return r.text();
    }),
    timeoutPromise(12000, "proxy_timeout")
  ]);

  let data;
  try {
    data = JSON.parse(resText);
  } catch (e) {
    // Sometimes proxies return HTML error pages
    throw new Error("bad_json_from_proxy");
  }

  const arts = (data && Array.isArray(data.articles)) ? data.articles : [];
  return arts;
}

function satireLine(title) {
  const t = String(title || "");
  const seeds = [
    "Scientists confirm this is fine.",
    "Experts recommend screaming into the void.",
    "Markets respond by vibrating aggressively.",
    "Government promises a bold new PDF about it.",
    "Authorities urge calm while not being calm."
  ];
  // cheap deterministic-ish pick
  const idx = clamp((t.length * 7) % seeds.length, 0, seeds.length - 1);
  return seeds[idx];
}

function classify(title) {
  const t = String(title || "").toLowerCase();

  // Keywords → categories
  const hits = {
    conflict_heat: /(war|strike|missile|drone|invasion|attack|troops|shelling)/,
    climate_weirdness: /(wildfire|flood|hurricane|drought|heatwave|storm|tornado|climate)/,
    economy_panic: /(recession|inflation|layoffs|default|debt|bank|crash|slowdown)/,
    democracy_melting: /(election|coup|protest|crackdown|fraud|riot|authoritarian|corruption)/,
    cyber_chaos: /(cyber|ransomware|hack|breach|outage|ddos|leak)/,
    nuclear_words: /(nuclear|radiation|reactor|uranium|icbm|warhead)/,
    space_rocks: /(asteroid|meteor|comet|solar storm|geomagnetic|rocket|space)/,
  };

  const breakdown = {};
  let weight = 0;

  for (const [k, rx] of Object.entries(hits)) {
    if (rx.test(t)) {
      breakdown[k] = (breakdown[k] || 0) + 1;
      weight += 1;
    }
  }

  if (weight === 0) {
    breakdown.misc_chaos = 1;
    weight = 0.25;
  }

  // domain “oomph”
  // (tiny spice; keep stable + not too dramatic)
  const domains = [];
  if (/(breaking|urgent|crisis|emergency)/.test(t)) domains.push("breaking");

  return { domains, weight, breakdown };
}

function labelFor(doomIndex) {
  if (doomIndex <= 10) return "We’re so back.";
  if (doomIndex <= 25) return "Mildly concerning vibes.";
  if (doomIndex <= 45) return "Moderate doom. Hydrate.";
  if (doomIndex <= 65) return "High doom. Avoid mirrors.";
  if (doomIndex <= 80) return "Severe doom. Touch grass now.";
  return "Maximum doom. The universe is laughing.";
}

// ---- Rendering ----
function renderBreakdown(breakdown) {
  els.breakdownList.innerHTML = "";

  const maxVal = Math.max(
    1,
    ...CATS.map(([k]) => breakdown[k] || 0)
  );

  CATS.forEach(([k, label]) => {
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

function renderLists({ drivers, stories, errors }) {
  els.driversList.innerHTML = "";
  els.storiesList.innerHTML = "";

  if (errors && errors.length) {
    const warn = document.createElement("div");
    warn.className = "item";
    const t = document.createElement("div");
    t.className = "item__title";
    t.textContent = "No articles returned.";
    const m = document.createElement("div");
    m.className = "item__meta";
    m.textContent = "GDELT / proxy error(s): " + errors.join(" | ");
    warn.appendChild(t);
    warn.appendChild(m);
    els.storiesList.appendChild(warn);
    return;
  }

  drivers.forEach((s) => els.driversList.appendChild(storyCard(s, true)));
  stories.slice(0, 40).forEach((s) => els.storiesList.appendChild(storyCard(s, true)));
}

function openModal(story) {
  els.modalTitle.textContent = story.title;
  els.modalSatire.textContent = story.satire;
  els.modalLink.href = story.url || "#";
  els.modal.classList.remove("hidden");
}

function closeModal() {
  els.modal.classList.add("hidden");
}

// ---- Compute ----
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

    const { domains, weight, breakdown: b } = classify(title);
    Object.keys(b).forEach((k) => (breakdown[k] = (breakdown[k] || 0) + b[k]));

    return {
      id: `${idx}_${normalizeTitle(title).slice(0, 40)}`,
      title,
      url,
      source,
      publishedAt,
      domains,
      weight,
      summary: a.sourceCollection || "",
      satire: satireLine(title),
    };
  });

  // DoomIndex: avg(weight) scaled to 0..100
  const avg = stories.length ? stories.reduce((s, x) => s + x.weight, 0) / stories.length : 0;
  const doomIndex = clamp(Math.round(avg * 12), 0, 100);

  // Drivers: highest absolute weights
  const drivers = [...stories].sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight)).slice(0, 8);

  return { doomIndex, doomLabel: labelFor(doomIndex), breakdown, drivers, stories };
}

// ---- Main refresh ----
async function refresh() {
  // Reset UI immediately (no hanging “omens”)
  els.doomValue.textContent = "…";
  els.doomLabel.textContent = "Consulting the omens…";
  els.meterFill.style.width = "0%";
  els.updatedAt.textContent = `${VERSION} • ${new Date().toLocaleString()}`;
  els.driversList.innerHTML = "";
  els.storiesList.innerHTML = "";
  els.breakdownList.innerHTML = "";

  const errors = [];
  const pulls = [];

  // Pull each driver query separately (keeps variety)
  for (const d of DRIVERS) {
    pulls.push(
      (async () => {
        try {
          const arts = await fetchGdeltArticles(d.q, DEFAULT_TIMESPAN, MAXRECORDS_PER_QUERY);
          return arts;
        } catch (e) {
          errors.push(`${d.label}: ${e.message || "error"}`);
          return [];
        }
      })()
    );
  }

  const allRaw = (await Promise.all(pulls)).flat();
  const all = dedupe(allRaw).slice(0, 140);

  if (!all.length) {
    els.doomValue.textContent = "!!";
    els.doomLabel.textContent = "Error loading headlines.";
    els.updatedAt.textContent = `${VERSION} • ${new Date().toLocaleString()}`;
    renderBreakdown({
      conflict_heat: 0,
      climate_weirdness: 0,
      economy_panic: 0,
      democracy_melting: 0,
      cyber_chaos: 0,
      nuclear_words: 0,
      space_rocks: 0,
      misc_chaos: 0
    });
    renderLists({ drivers: [], stories: [], errors: errors.length ? errors : ["empty result set"] });
    return;
  }

  const result = compute(all);

  els.doomValue.textContent = String(result.doomIndex);
  els.doomLabel.textContent = result.doomLabel;
  els.meterFill.style.width = `${result.doomIndex}%`;
  els.updatedAt.textContent = `${VERSION} • ${new Date().toLocaleString()}`;

  renderBreakdown(result.breakdown);
  renderLists(result);
}

// ---- Events ----
els.refreshBtn.addEventListener("click", refresh);
els.aboutBtn.addEventListener("click", () => {
  // scroll to about area if you want; otherwise modal or nothing
  window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
});

els.closeModal.addEventListener("click", closeModal);
els.modalBackdrop.addEventListener("click", closeModal);

// Kick off
refresh();
