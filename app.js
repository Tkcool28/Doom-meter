/* Doomroom News (GitHub Pages) */
const VERSION = "v3.1.0";

// IMPORTANT: must match your Worker base URL exactly (no trailing slash needed)
const PROXY_BASE = "https://doom-proxy.toddkirschman.workers.dev";

// What we want:
const WANT_LANG = "English";
const WANT_COUNTRY = "United States";

// Query settings
const QUERY = "world";     // try "climate" if you want it more doomy
const MODE = "ArtList";
const FORMAT = "json";
const MAXRECORDS = 40;     // more headlines = better doom signal
const TIMESPAN = "1d";     // last 1 day

// Helpers
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
      return { ok: false, status: res.status, json: { error: "Non-JSON response", body_preview: raw.slice(0, 250) }, raw };
    }
  } catch (e) {
    return { ok: false, status: 0, json: { error: String(e) }, raw: "" };
  } finally {
    clearTimeout(t);
  }
}

// Normalize payloads from your worker (you showed both shapes earlier)
function normalizePayload(payload) {
  // Worker error shape: { error, routes, example }
  if (payload && (payload.error || payload.ok === false)) {
    return {
      articles: [],
      meta: {
        kind: "error",
        error: payload.error || payload.err || "Unknown error",
        routes: payload.routes,
        example: payload.example,
        keys: Object.keys(payload || {}),
        body_preview: payload.body_preview,
        upstream_url: payload.upstream_url,
      },
    };
  }

  // Happy shapes
  if (payload && Array.isArray(payload.articles)) {
    return { articles: payload.articles, meta: { kind: "articles" } };
  }
  if (payload && payload.data && Array.isArray(payload.data.articles)) {
    return { articles: payload.data.articles, meta: { kind: "data.articles" } };
  }

  return { articles: [], meta: { kind: "unknown", keys: payload ? Object.keys(payload) : [] } };
}

function cleanDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function renderStories(articles) {
  const grid = $("stories");
  if (!grid) return;
  grid.innerHTML = "";

  if (!articles || articles.length === 0) {
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.textContent = "No articles returned.";
    grid.appendChild(empty);
    return;
  }

  for (const a of articles.slice(0, 18)) {
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
    const lang = a.language ? ` · ${a.language}` : "";
    meta.textContent = `${domain || "source"}${lang}`;

    link.appendChild(title);
    link.appendChild(meta);

    grid.appendChild(link);
  }
}

// --- Doom scoring (simple + readable) ---
const DOOM_KEYWORDS = [
  // war/violence
  "war", "strike", "attack", "missile", "bomb", "explosion", "killed", "dead", "massacre", "terror",
  // disaster
  "earthquake", "wildfire", "hurricane", "flood", "tsunami", "outbreak", "pandemic",
  // economy
  "crash", "recession", "inflation", "bankruptcy", "layoffs", "collapse",
  // climate/energy
  "climate", "heatwave", "drought", "emissions", "oil spill",
  // politics/instability
  "coup", "sanctions", "unrest", "riot", "emergency",
];

function doomScoreFromHeadlines(articles) {
  // Score 0–100
  if (!articles || articles.length === 0) return { score: 0, label: "No data", hits: [] };

  const titles = articles.map(a => (a.title || "").toLowerCase());

  let points = 0;
  const hits = [];

  for (const kw of DOOM_KEYWORDS) {
    const count = titles.reduce((acc, t) => acc + (t.includes(kw) ? 1 : 0), 0);
    if (count > 0) {
      // diminishing returns so one keyword doesn't dominate
      const add = Math.min(10, 2 + count); // 3..10
      points += add;
      hits.push({ kw, count, add });
    }
  }

  // normalize relative to sample size
  const n = Math.max(1, Math.min(articles.length, 40));
  const normalized = Math.round(Math.min(100, (points / (n * 2.2)) * 100));

  let label = "Mildly Concerning";
  if (normalized >= 80) label = "RED ALERT (vibes are bad)";
  else if (normalized >= 60) label = "Spicy Doom";
  else if (normalized >= 40) label = "Moderate Doom";
  else if (normalized >= 20) label = "Low Doom";
  else label = "Chill (Suspiciously)";

  return { score: normalized, label, hits };
}

function setDoomUI(scoreObj, articlesUsed) {
  const scoreEl = $("doomScore");
  const labelEl = $("doomLabel");
  const fillEl = $("doomFill");
  const metaEl = $("doomMeta");

  if (scoreEl) scoreEl.textContent = String(scoreObj.score);
  if (labelEl) labelEl.textContent = scoreObj.label;

  if (fillEl) {
    fillEl.style.width = `${scoreObj.score}%`;
  }

  if (metaEl) {
    const topHits = scoreObj.hits
      .sort((a, b) => b.add - a.add)
      .slice(0, 5)
      .map(h => `${h.kw}(${h.count})`)
      .join(", ");

    metaEl.textContent =
      `Sample: ${articlesUsed} headlines · Filter: ${WANT_LANG} / ${WANT_COUNTRY}` +
      (topHits ? ` · Signals: ${topHits}` : "");
  }
}

function explainError(meta, urlTried) {
  const keys = meta?.keys ? `Response keys: ${meta.keys.join(", ")}` : "";
  const routes = meta?.routes ? `Routes: ${meta.routes.join(", ")}` : "";
  const example = meta?.example ? `Example: ${meta.example}` : "";
  const upstream = meta?.upstream_url ? `Upstream: ${meta.upstream_url}` : "";
  const preview = meta?.body_preview ? `Body preview: ${meta.body_preview}` : "";

  const lines = [
    keys,
    meta?.error ? `Error: ${meta.error}` : "",
    routes,
    example,
    upstream,
    preview,
    urlTried ? `Tried: ${urlTried}` : "",
  ].filter(Boolean);

  return lines.join("\n");
}

function filterEnglishUS(articles) {
  // Your worker returns language + sourcecountry in each article (you posted that)
  return (articles || []).filter(a =>
    a &&
    (!a.language || a.language === WANT_LANG) &&
    (!a.sourcecountry || a.sourcecountry === "United States")
  );
}

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
  const payload = (result && result.json) ? result.json : { error: "No response json" };

  const norm = normalizePayload(payload);

  // If worker says Not found, you’re hitting the wrong path (/gdel vs /gdelt etc.)
  if (norm.meta.kind === "error") {
    setText("statusPill", "Error");
    show("errorBox", true);
    setText("errorText", explainError(norm.meta, url));
    renderStories([]);
    setDoomUI({ score: 0, label: "No data", hits: [] }, 0);
    return;
  }

  const all = norm.articles || [];

  // Filter to English/US (and if that empties it, fall back to “English anywhere”)
  let filtered = filterEnglishUS(all);

  if (filtered.length < 6) {
    filtered = all.filter(a => a && (!a.language || a.language === WANT_LANG));
  }

  // If still thin, fall back to whatever, but you’ll see it in the meta line
  const articlesToUse = filtered.length > 0 ? filtered : all;

  renderStories(articlesToUse);

  const doom = doomScoreFromHeadlines(articlesToUse);
  setDoomUI(doom, articlesToUse.length);

  setText("statusPill", "OK");
  setText("updatedPill", `Updated: ${nowStamp()}`);
}

function wireUI() {
  setText("version", VERSION);

  const refreshBtn = $("refreshBtn");
  const aboutBtn = $("aboutBtn");

  if (refreshBtn) refreshBtn.addEventListener("click", loadHeadlines);
  if (aboutBtn) aboutBtn.addEventListener("click", () => {
    const ab = $("aboutBox");
    const showing = ab && ab.style.display !== "none" && ab.style.display !== "";
    show("aboutBox", !showing);
  });
}

// Boot
wireUI();
loadHeadlines();
