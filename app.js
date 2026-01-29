/* Doomroom News (GitHub Pages) */
const VERSION = "v3.2.0";

// Your Worker base (must match exactly)
const PROXY_BASE = "https://doom-proxy.toddkirschman.workers.dev";

// Filters (tighten/loosen as you like)
const WANT_LANG = "English";
const WANT_COUNTRY = "United States";

// Query
const QUERY = "world";
const MODE = "ArtList";
const FORMAT = "json";
const MAXRECORDS = 60;
const TIMESPAN = "1d";

const $ = (id) => document.getElementById(id);

function setText(id, text) {
  const el = $(id);
  if (el) el.textContent = text;
}

function show(id, on = true) {
  const el = $(id);
  if (!el) return;
  el.style.display = on ? "" : "none";
}

function nowStamp() {
  return new Date().toLocaleString();
}

async function fetchJSON(url, timeoutMs = 12000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);

  try {
    const res = await fetch(url, { method: "GET", cache: "no-store", signal: ctl.signal });
    const raw = await res.text();
    try {
      const json = JSON.parse(raw);
      return { ok: res.ok, status: res.status, json, raw };
    } catch {
      return { ok: false, status: res.status, json: { error: "Non-JSON response", body_preview: raw.slice(0, 300) }, raw };
    }
  } catch (e) {
    return { ok: false, status: 0, json: { error: String(e) }, raw: "" };
  } finally {
    clearTimeout(t);
  }
}

// Normalize worker payload
function normalizePayload(payload) {
  if (payload && (payload.error || payload.ok === false)) {
    return {
      articles: [],
      meta: {
        kind: "error",
        error: payload.error || payload.err || "Unknown error",
        routes: payload.routes,
        example: payload.example,
        upstream_url: payload.upstream_url,
        body_preview: payload.body_preview,
        keys: Object.keys(payload || {}),
      },
    };
  }
  if (payload && Array.isArray(payload.articles)) return { articles: payload.articles, meta: { kind: "articles" } };
  if (payload && payload.data && Array.isArray(payload.data.articles)) return { articles: payload.data.articles, meta: { kind: "data.articles" } };
  return { articles: [], meta: { kind: "unknown", keys: payload ? Object.keys(payload) : [] } };
}

function cleanDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); }
  catch { return ""; }
}

function explainError(meta, urlTried) {
  const lines = [
    meta?.keys ? `Response keys: ${meta.keys.join(", ")}` : "",
    meta?.error ? `Error: ${meta.error}` : "",
    meta?.routes ? `Routes: ${meta.routes.join(", ")}` : "",
    meta?.example ? `Example: ${meta.example}` : "",
    meta?.upstream_url ? `Upstream: ${meta.upstream_url}` : "",
    meta?.body_preview ? `Body preview: ${meta.body_preview}` : "",
    urlTried ? `Tried: ${urlTried}` : "",
  ].filter(Boolean);
  return lines.join("\n");
}

/* ---------------------------
   Doom model (categories + bars)
---------------------------- */

const CATS = [
  { key: "conflict", label: "Conflict Heat", weight: 1.15, words: ["war","strike","attack","missile","bomb","explosion","killed","dead","terror","hostage","invasion","troops","airstrike","rocket","shooting"] },
  { key: "climate",  label: "Climate Weirdness", weight: 1.05, words: ["climate","heatwave","drought","wildfire","flood","hurricane","storm","emissions","record heat","ice","extreme weather"] },
  { key: "economy",  label: "Economic Drama", weight: 1.00, words: ["recession","inflation","crash","collapse","bankruptcy","layoffs","default","debt","panic","market turmoil"] },
  { key: "democracy",label: "Democracy Melting", weight: 1.05, words: ["coup","sanctions","unrest","riot","martial law","election fraud","authoritarian","arrested","crackdown","corruption"] },
  { key: "cyber",    label: "Cyber Chaos", weight: 0.95, words: ["hack","breach","ransomware","cyberattack","leak","outage","ddos","malware","data stolen"] },
  { key: "nuclear",  label: "Nuclear Words", weight: 1.10, words: ["nuclear","uranium","radiation","warhead","icbm","reactor","enrichment"] },
  { key: "space",    label: "Space Rocks", weight: 0.80, words: ["asteroid","meteor","comet","near-earth object","impact risk"] },
  { key: "misc",     label: "Misc. Chaos", weight: 0.70, words: ["emergency","disaster","outbreak","pandemic","evacuation","shortage","blackout","massive fire","explosion"] },
];

function scoreCategories(articles) {
  const titles = (articles || []).map(a => (a.title || "").toLowerCase());
  const n = Math.max(1, titles.length);

  // Raw points per category (count hits, mild diminishing returns)
  const catPoints = {};
  const catHits = {};

  for (const c of CATS) {
    let pts = 0;
    const hits = [];

    for (const w of c.words) {
      const count = titles.reduce((acc, t) => acc + (t.includes(w) ? 1 : 0), 0);
      if (count > 0) {
        const add = Math.min(10, 2 + count); // 3..10
        pts += add;
        hits.push({ w, count, add });
      }
    }

    // Normalize by sample size and weight
    // The divisor sets how “sensitive” the meter is. Tweak if you want more doom.
    const norm = Math.min(100, Math.round((pts * c.weight / (n * 1.8)) * 100));
    catPoints[c.key] = norm;
    catHits[c.key] = hits;
  }

  // Overall score: weighted-ish sum, then clamp
  const sum = Object.values(catPoints).reduce((a, b) => a + b, 0);
  const overall = Math.min(100, Math.round(sum / 4.2)); // scale factor for 0–100

  return { overall, catPoints, catHits };
}

function labelFor(score) {
  if (score >= 90) return "We are on fire.";
  if (score >= 70) return "This is… not ideal.";
  if (score >= 40) return "Moderately concerning.";
  if (score >= 20) return "Low doom. Suspicious.";
  return "We’re so back.";
}

function fillClass(score) {
  if (score >= 90) return "fill-fire";
  if (score >= 70) return "fill-red";
  if (score >= 40) return "fill-yellow";
  return "fill-green";
}

function setFill(el, score) {
  if (!el) return;
  el.style.width = `${Math.max(0, Math.min(100, score))}%`;
  el.classList.remove("fill-green", "fill-yellow", "fill-red", "fill-fire");
  el.classList.add(fillClass(score));
}

/* ---------------------------
   Rendering
---------------------------- */

function renderBreakdown(catPoints) {
  const wrap = $("breakdown");
  if (!wrap) return;
  wrap.innerHTML = "";

  for (const c of CATS) {
    const row = document.createElement("div");
    row.className = "bRow";

    const name = document.createElement("div");
    name.className = "bName";
    name.textContent = c.label;

    const track = document.createElement("div");
    track.className = "bTrack";

    const fill = document.createElement("div");
    fill.className = "bFill";
    setFill(fill, catPoints[c.key] ?? 0);

    track.appendChild(fill);

    row.appendChild(name);
    row.appendChild(track);

    wrap.appendChild(row);
  }
}

function renderDrivers(articles, catHits) {
  const drivers = $("drivers");
  if (!drivers) return;
  drivers.innerHTML = "";

  // Pick top 4 “driver” headlines: those that match the most categories/keywords
  const scored = (articles || []).map(a => {
    const t = (a.title || "").toLowerCase();
    let s = 0;
    for (const c of CATS) {
      for (const w of c.words) if (t.includes(w)) s += 1;
    }
    return { a, s };
  }).sort((x, y) => y.s - x.s);

  const top = scored.filter(x => x.s > 0).slice(0, 4);

  if (top.length === 0) {
    drivers.textContent = "No strong drivers detected (which is either good news… or the algorithm is sleeping).";
    drivers.classList.add("muted");
    return;
  }

  for (const item of top) {
    const a = item.a;

    const box = document.createElement("div");
    box.className = "driverItem";

    const title = document.createElement("div");
    title.className = "driverTitle";
    title.textContent = a.title || "(untitled)";

    const meta = document.createElement("div");
    meta.className = "driverMeta";
    const domain = a.domain || cleanDomain(a.url || "");
    meta.textContent = `${domain || "source"} · ${a.language || "—"}`;

    box.appendChild(title);
    box.appendChild(meta);

    drivers.appendChild(box);
  }
}

function renderStories(articles) {
  const wrap = $("stories");
  if (!wrap) return;
  wrap.innerHTML = "";

  const list = (articles || []).slice(0, 16);

  if (list.length === 0) {
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.textContent = "No articles returned.";
    wrap.appendChild(empty);
    return;
  }

  // remove duplicates by title
  const seen = new Set();
  for (const a of list) {
    const key = (a.title || "").trim().toLowerCase();
    if (key && seen.has(key)) continue;
    seen.add(key);

    const link = document.createElement("a");
    link.className = "story";
    link.href = a.url || "#";
    link.target = "_blank";
    link.rel = "noopener noreferrer";

    const title = document.createElement("div");
    title.className = "storyTitle";
    title.textContent = a.title || "(untitled)";

    const meta = document.createElement("div");
    meta.className = "storyMeta";
    const domain = a.domain || cleanDomain(a.url || "");
    meta.textContent = `${domain || "source"} · ${a.language || "—"}`;

    link.appendChild(title);
    link.appendChild(meta);
    wrap.appendChild(link);
  }
}

function filterArticles(all) {
  // strict: English + US
  let filtered = (all || []).filter(a =>
    a &&
    (!a.language || a.language === WANT_LANG) &&
    (!a.sourcecountry || a.sourcecountry === WANT_COUNTRY)
  );

  // fallback: English anywhere if too few
  if (filtered.length < 10) {
    filtered = (all || []).filter(a => a && (!a.language || a.language === WANT_LANG));
  }

  // fallback: everything
  return filtered.length ? filtered : (all || []);
}

/* ---------------------------
   Main loader
---------------------------- */

async function loadHeadlines() {
  show("errorBox", false);
  show("aboutBox", false);

  setText("statusPill", "Loading…");

  const url =
    `${PROXY_BASE}/gdelt` +
    `?query=${encodeURIComponent(QUERY)}` +
    `&mode=${encodeURIComponent(MODE)}` +
    `&format=${encodeURIComponent(FORMAT)}` +
    `&maxrecords=${encodeURIComponent(String(MAXRECORDS))}` +
    `&timespan=${encodeURIComponent(TIMESPAN)}` +
    `&t=${Date.now()}`;

  const result = await fetchJSON(url);
  const payload = result?.json ?? { error: "No JSON payload" };

  const norm = normalizePayload(payload);

  if (norm.meta.kind === "error") {
    setText("statusPill", "Error");
    show("errorBox", true);
    setText("errorText", explainError(norm.meta, url));
    setText("doomScore", "—");
    setText("doomLabel", "No data");
    setText("updatedPill", "Updated: —");
    setText("filterPill", "Filter: —");
    setText("samplePill", "Sample: —");
    renderBreakdown(Object.fromEntries(CATS.map(c => [c.key, 0])));
    $("drivers").textContent = "—";
    renderStories([]);
    return;
  }

  const all = norm.articles || [];
  const articles = filterArticles(all);

  // UI meta pills
  setText("statusPill", "OK");
  setText("updatedPill", `Updated: ${nowStamp()}`);
  setText("filterPill", `Filter: ${WANT_LANG} / ${WANT_COUNTRY}`);
  setText("samplePill", `Sample: ${articles.length} headlines`);

  // Doom scoring + rendering
  const scored = scoreCategories(articles);
  setText("doomScore", String(scored.overall));
  setText("doomLabel", labelFor(scored.overall));

  setFill($("doomFill"), scored.overall);
  renderBreakdown(scored.catPoints);
  renderDrivers(articles, scored.catHits);

  // Stories list
  renderStories(articles);
}

function wireUI() {
  setText("version", VERSION);

  $("refreshBtn")?.addEventListener("click", loadHeadlines);
  $("aboutBtn")?.addEventListener("click", () => {
    const box = $("aboutBox");
    const isOpen = box && box.style.display !== "none" && box.style.display !== "";
    show("aboutBox", !isOpen);
  });
}

// Boot
wireUI();
loadHeadlines();
