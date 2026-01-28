/* Doomroom News — Fix: use GDELT DOC API in true JSONP mode (format=JSONP).
   This avoids CORS + avoids flaky proxies that return HTML/403/404.
*/

const APP_VERSION = "v3.0.0";

// ---- GDELT JSONP endpoint (DOC 2.0) ----
const GDELT_BASE = "https://api.gdeltproject.org/api/v2/doc/doc";

// Keep queries simple & broad. You can tune these later.
const DRIVERS = [
  { key: "conflict_heat", label: "Conflict Heat", query: "war OR strike OR missile OR drone OR invasion OR troops OR shelling" },
  { key: "climate_weirdness", label: "Climate Weirdness", query: "wildfire OR heatwave OR flood OR hurricane OR drought OR storm OR climate" },
  { key: "economic_drama", label: "Economic Drama", query: "recession OR inflation OR layoffs OR default OR bank OR crash OR debt OR tariff" },
  { key: "democracy_melting", label: "Democracy Melting", query: "election OR coup OR protest OR crackdown OR corruption OR tribunal OR arrest OR censorship" },
  { key: "cyber_chaos", label: "Cyber Chaos", query: "cyberattack OR ransomware OR breach OR hack OR outage OR ddos OR leak" },
  { key: "nuclear_words", label: "Nuclear Words", query: "nuclear OR radiation OR reactor OR uranium OR ICBM OR warhead" },
  { key: "space_rocks", label: "Space Rocks", query: "asteroid OR meteor OR comet OR solar storm OR geomagnetic OR rocket explosion" },
];

// weights should sum roughly to 1.0 (not required but nice)
const WEIGHTS = {
  conflict_heat: 0.22,
  climate_weirdness: 0.16,
  economic_drama: 0.18,
  democracy_melting: 0.16,
  cyber_chaos: 0.12,
  nuclear_words: 0.10,
  space_rocks: 0.06,
};

const DEFAULT_TIMESPAN = "24 hours"; // GDELT supports strings like "24 hours", "7 days", etc.
const MAX_RECORDS = 60;              // per driver
const REQUEST_TIMEOUT_MS = 12000;    // jsonp timeout

// ---- DOM ----
const els = {
  refreshBtn: document.getElementById("refreshBtn"),
  aboutBtn: document.getElementById("aboutBtn"),
  aboutCard: document.getElementById("aboutCard"),

  statusLine: document.getElementById("statusLine"),
  doomValue: document.getElementById("doomValue"),
  doomLabel: document.getElementById("doomLabel"),
  meterFill: document.getElementById("meterFill"),
  updatedAt: document.getElementById("updatedAt"),
  buildMeta: document.getElementById("buildMeta"),

  breakdownList: document.getElementById("breakdownList"),
  driversList: document.getElementById("driversList"),
  storiesList: document.getElementById("storiesList"),
};

// ---- Utilities ----
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

function fmtTime(d = new Date()) {
  return d.toLocaleString();
}

function setStatus(msg) {
  els.statusLine.textContent = msg || "";
}

function setLoading(isLoading) {
  if (isLoading) {
    els.doomValue.textContent = "—";
    els.doomLabel.textContent = "Loading…";
    els.meterFill.style.width = "0%";
    setStatus("Fetching headlines…");
  } else {
    setStatus("");
  }
}

function dedupeArticles(articles) {
  const seen = new Set();
  const out = [];
  for (const a of articles) {
    const key = (a.url || "") + "||" + (a.title || "");
    if (!key.trim()) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

function labelForDoom(n) {
  if (n < 15) return "We’re so back.";
  if (n < 35) return "Mildly concerning vibes.";
  if (n < 55) return "Moderate doom. Hydrate.";
  if (n < 75) return "Severe doom. Touch grass now.";
  return "Maximum doom. The universe is laughing.";
}

// ---- JSONP core ----
function jsonp(url, { timeoutMs = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    const cbName = "__gdelt_cb_" + Math.random().toString(36).slice(2);
    const script = document.createElement("script");

    let done = false;
    let timer = null;

    function cleanup() {
      if (timer) clearTimeout(timer);
      timer = null;
      if (script && script.parentNode) script.parentNode.removeChild(script);
      try { delete window[cbName]; } catch (_) { window[cbName] = undefined; }
    }

    window[cbName] = (data) => {
      if (done) return;
      done = true;
      cleanup();
      resolve(data);
    };

    timer = setTimeout(() => {
      if (done) return;
      done = true;
      cleanup();
      reject(new Error("JSONP timeout"));
    }, timeoutMs);

    // If the script fails to load or parse, onerror usually fires (common when response is HTML/blocked)
    script.onerror = () => {
      if (done) return;
      done = true;
      cleanup();
      reject(new Error("JSONP script error (blocked request / bad response)"));
    };

    const sep = url.includes("?") ? "&" : "?";
    script.src = `${url}${sep}callback=${encodeURIComponent(cbName)}`;
    document.head.appendChild(script);
  });
}

function buildGdeltUrl({ query, timespan = DEFAULT_TIMESPAN, maxrecords = MAX_RECORDS, sort = "DateDesc" }) {
  const u = new URL(GDELT_BASE);
  u.searchParams.set("query", query);
  u.searchParams.set("mode", "ArtList");
  u.searchParams.set("format", "JSONP");        // <-- IMPORTANT FIX
  u.searchParams.set("timespan", timespan);
  u.searchParams.set("maxrecords", String(maxrecords));
  u.searchParams.set("sort", sort);
  return u.toString();
}

async function fetchDriverArticles(driver) {
  const url = buildGdeltUrl({ query: driver.query });
  const data = await jsonp(url, { timeoutMs: REQUEST_TIMEOUT_MS });

  // GDELT returns { articles: [...] } in ArtList mode.
  const articles = Array.isArray(data?.articles) ? data.articles : [];
  return articles;
}

// ---- Doom scoring ----
function scoreFromCounts(counts) {
  // Convert per-driver hit counts into a 0–100 index.
  // This is intentionally “soft”: lots of headlines -> rising doom, but saturates.
  const maxPerDriver = 50; // saturation point for a single driver
  const normalized = {};
  let weighted = 0;

  for (const d of DRIVERS) {
    const c = counts[d.key] || 0;
    const n = clamp(c / maxPerDriver, 0, 1);  // 0..1
    normalized[d.key] = n;
    weighted += n * (WEIGHTS[d.key] || 0);
  }

  // Weighted 0..1 -> 0..100, with a little curve so small values still show
  const curved = Math.pow(clamp(weighted, 0, 1), 0.65);
  const doom = Math.round(curved * 100);
  return { doom, normalized };
}

function topDrivers(normalized, topN = 3) {
  return [...DRIVERS]
    .map((d) => ({ key: d.key, label: d.label, value: normalized[d.key] || 0 }))
    .sort((a, b) => b.value - a.value)
    .slice(0, topN);
}

// ---- Render ----
function renderBreakdown(normalized, rawCounts) {
  els.breakdownList.innerHTML = "";
  for (const d of DRIVERS) {
    const pct = Math.round((normalized[d.key] || 0) * 100);
    const count = rawCounts[d.key] || 0;

    const row = document.createElement("div");
    row.className = "breakRow";

    const left = document.createElement("div");
    left.className = "breakLabel";
    left.textContent = d.label;

    const mid = document.createElement("div");
    mid.className = "breakBar";
    const fill = document.createElement("div");
    fill.className = "breakFill";
    fill.style.width = `${pct}%`;
    mid.appendChild(fill);

    const right = document.createElement("div");
    right.className = "breakValue";
    right.textContent = `${count}`;

    row.appendChild(left);
    row.appendChild(mid);
    row.appendChild(right);

    els.breakdownList.appendChild(row);
  }
}

function renderDrivers(drivers) {
  els.driversList.innerHTML = "";
  if (!drivers.length) {
    els.driversList.textContent = "—";
    return;
  }
  for (const d of drivers) {
    const item = document.createElement("div");
    item.className = "driverItem";
    const pct = Math.round(d.value * 100);
    item.textContent = `${d.label} (${pct}%)`;
    els.driversList.appendChild(item);
  }
}

function renderStories(allArticles) {
  els.storiesList.innerHTML = "";

  const articles = dedupeArticles(allArticles).slice(0, 12);

  if (!articles.length) {
    const empty = document.createElement("div");
    empty.className = "storyEmpty";
    empty.textContent = "No stories to show.";
    els.storiesList.appendChild(empty);
    return;
  }

  for (const a of articles) {
    const card = document.createElement("a");
    card.className = "story";
    card.href = a.url || "#";
    card.target = "_blank";
    card.rel = "noopener noreferrer";

    const title = document.createElement("div");
    title.className = "storyTitle";
    title.textContent = a.title || "(untitled)";

    const meta = document.createElement("div");
    meta.className = "storyMeta";
    const source = a.sourceCountry || a.domain || a.sourceCollection || "";
    const when = a.seendate ? String(a.seendate).slice(0, 8) : "";
    meta.textContent = [source, when].filter(Boolean).join(" • ");

    card.appendChild(title);
    card.appendChild(meta);

    els.storiesList.appendChild(card);
  }
}

// ---- Cache (so the app still shows something when GDELT is flaky) ----
const CACHE_KEY = "doomroom_cache_v1";

function saveCache(payload) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  } catch (_) {}
}

function loadCache() {
  try {
    const s = localStorage.getItem(CACHE_KEY);
    if (!s) return null;
    return JSON.parse(s);
  } catch (_) {
    return null;
  }
}

// ---- Main flow ----
async function refresh() {
  setLoading(true);
  els.buildMeta.textContent = APP_VERSION;

  const startedAt = new Date();
  els.updatedAt.textContent = `Updated: ${fmtTime(startedAt)}`;

  const rawCounts = {};
  const allArticles = [];
  const errors = [];

  // Fetch each driver via JSONP (no CORS headaches).
  for (const d of DRIVERS) {
    try {
      const arts = await fetchDriverArticles(d);
      rawCounts[d.key] = arts.length;
      allArticles.push(...arts);
    } catch (e) {
      rawCounts[d.key] = 0;
      errors.push(`${d.label}: ${e?.message || String(e)}`);
    }
  }

  // If everything failed, try cache
  const totalHits = Object.values(rawCounts).reduce((a, b) => a + b, 0);
  if (totalHits === 0) {
    const cached = loadCache();
    if (cached?.allArticles?.length) {
      setStatus("Live fetch failed — showing cached headlines.");
      applyResult(cached, { fromCache: true });
      setLoading(false);
      return;
    }

    // No cache either: show errors
    els.doomValue.textContent = "!!";
    els.doomLabel.textContent = "Error loading headlines.";
    els.meterFill.style.width = "0%";
    renderBreakdown({}, rawCounts);
    renderDrivers([]);
    renderStories([]);
    setStatus(
      errors.length
        ? `No articles returned. ${errors.join(" | ")}`
        : "No articles returned. Something is blocking the requests."
    );
    setLoading(false);
    return;
  }

  // Compute doom
  const { doom, normalized } = scoreFromCounts(rawCounts);

  const payload = {
    doom,
    normalized,
    rawCounts,
    allArticles: dedupeArticles(allArticles),
    updatedAt: startedAt.toISOString(),
  };

  saveCache(payload);
  applyResult(payload, { fromCache: false, errors });

  setLoading(false);
}

function applyResult(payload, { fromCache = false, errors = [] } = {}) {
  const doom = payload.doom ?? 0;

  els.doomValue.textContent = String(doom);
  els.doomLabel.textContent = labelForDoom(doom);
  els.meterFill.style.width = `${clamp(doom, 0, 100)}%`;

  const updated = payload.updatedAt ? new Date(payload.updatedAt) : new Date();
  els.updatedAt.textContent = `Updated: ${fmtTime(updated)}`;
  els.buildMeta.textContent = `${APP_VERSION}${fromCache ? " • cached" : ""}`;

  renderBreakdown(payload.normalized || {}, payload.rawCounts || {});
  renderDrivers(topDrivers(payload.normalized || {}, 3));
  renderStories(payload.allArticles || []);

  if (errors.length) {
    setStatus(`Partial fetch: ${errors.join(" | ")}`);
  } else {
    setStatus(fromCache ? "Showing cached headlines." : "");
  }
}

// ---- UI events ----
els.refreshBtn.addEventListener("click", () => refresh());

els.aboutBtn.addEventListener("click", () => {
  const shown = els.aboutCard.style.display !== "none";
  els.aboutCard.style.display = shown ? "none" : "block";
});

// ---- Boot ----
(function boot() {
  els.buildMeta.textContent = APP_VERSION;

  const cached = loadCache();
  if (cached?.allArticles?.length) {
    applyResult(cached, { fromCache: true });
  } else {
    els.doomValue.textContent = "—";
    els.doomLabel.textContent = "Tap Refresh.";
    els.updatedAt.textContent = "Updated: —";
  }

  // auto-refresh on load
  refresh();
})();
