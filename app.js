/* Doomroom News — app.js (v3.1.5)
   Fixes:
   - No more null element crashes (guard every DOM write)
   - Restore About copy + "OK. I'm calm'ish."
   - Robust article fetching (fallback query params)
   - Filtering no longer deletes most results when fields are missing
*/

const VERSION = "v3.1.5";

// Your worker proxy (must be HTTPS)
const PROXY_BASE = "https://doom-proxy.toddkirschman.workers.dev";
const ROUTE = "/gdelt";

// Defaults
const DEFAULT_QUERY = "world";
const MAX_RECORDS = 40;
const TIMESPAN = "7d"; // wider net so you actually get "today"
const UI_LIMIT = 12;

// Categories / keywords (simple + goofy on purpose)
const CATS = [
  { key: "conflict", label: "Conflict Heat", keywords: ["war","strike","attack","missile","drone","airstrike","invasion","ceasefire","shelling","hostage","terror","bomb","blast"] },
  { key: "climate", label: "Climate Weirdness", keywords: ["heat","wildfire","flood","hurricane","cyclone","storm","drought","record heat","evacuation","blaze","tornado","smoke"] },
  { key: "econ", label: "Economic Drama", keywords: ["inflation","layoff","recession","tariff","crash","default","debt","market","rates","shutdown"] },
  { key: "policy", label: "Policy / Laws", keywords: ["election","bill","court","protest","riot","authoritarian","fraud","ban","corrupt","impeach","martial law"] },
  { key: "cyber", label: "Cyber Chaos", keywords: ["hack","breach","ransomware","outage","leak","cyber","malware","phishing","ddos"] },
  { key: "space", label: "Space Rocks", keywords: ["asteroid","meteor","comet","space debris","nasa","impact","near-earth"] },
  { key: "misc", label: "Misc. Chaos", keywords: ["panic","crisis","emergency","collapse","killed","dead","explosion","chaos","scandal"] }
];

// ---------- DOM helpers (NO CRASH ZONE) ----------
const $ = (id) => document.getElementById(id);

function setText(id, txt) {
  const n = $(id);
  if (n) n.textContent = txt;
}
function setHTML(id, html) {
  const n = $(id);
  if (n) n.innerHTML = html;
}
function setWidth(id, pct) {
  const n = $(id);
  if (n) n.style.width = `${pct}%`;
}
function show(id) {
  const n = $(id);
  if (n) n.classList.remove("hidden");
}
function hide(id) {
  const n = $(id);
  if (n) n.classList.add("hidden");
}

// ---------- UI labels ----------
function labelFromIndex(idx) {
  if (idx >= 90) return "On fire.";
  if (idx >= 80) return "Bad vibes.";
  if (idx >= 50) return "Spicy.";
  if (idx >= 25) return "Uneasy.";
  return "Chill (suspiciously).";
}
function tagFromIndex(idx) {
  if (idx >= 90) return "We live in a season finale.";
  if (idx >= 80) return "Avoid comment sections. Hydrate.";
  if (idx >= 50) return "Something is… off.";
  if (idx >= 25) return "Noticeable tremors in the doom-field.";
  return "Take a breath. The universe is weird.";
}
function classFromPct(p) {
  if (p >= 90) return "fire";
  if (p >= 80) return "red";
  if (p >= 35) return "yellow";
  return "";
}

// ---------- Fetch helpers ----------
async function fetchJSON(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchArticles(query) {
  // Try multiple query styles in case the worker expects different params.
  const tries = [
    `${PROXY_BASE}${ROUTE}?query=${encodeURIComponent(query)}&max=${MAX_RECORDS}&timespan=${encodeURIComponent(TIMESPAN)}`,
    `${PROXY_BASE}${ROUTE}?q=${encodeURIComponent(query)}&max=${MAX_RECORDS}&timespan=${encodeURIComponent(TIMESPAN)}`,
    `${PROXY_BASE}${ROUTE}?q=${encodeURIComponent(query)}`,
    `${PROXY_BASE}${ROUTE}?query=${encodeURIComponent(query)}`
  ];

  let lastErr = null;
  for (const u of tries) {
    try {
      const data = await fetchJSON(u);
      // We accept either {articles:[...]} or [...]
      if (Array.isArray(data)) return data;
      if (data && Array.isArray(data.articles)) return data.articles;
      if (data && Array.isArray(data.data)) return data.data;
      // If it’s “valid” but empty, keep trying other formats.
      lastErr = new Error("Empty/unknown payload shape");
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("Fetch failed");
}

// ---------- Article cleanup ----------
function safeStr(v) {
  return (v == null ? "" : String(v)).trim();
}

function dedupeArticles(list) {
  const seen = new Set();
  const out = [];
  for (const a of list) {
    const url = safeStr(a.url || a.link);
    const title = safeStr(a.title || a.name);
    const key = url ? `u:${url}` : `t:${title.toLowerCase()}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

function normalizeArticle(a) {
  return {
    title: safeStr(a.title || a.name || "Untitled omen"),
    url: safeStr(a.url || a.link || ""),
    source: safeStr(a.source || a.domain || a.publisher || ""),
    language: safeStr(a.language || a.lang || ""),
    country: safeStr(a.country || a.sourceCountry || a.location || ""),
    published: safeStr(a.published || a.publishedAt || a.datetime || a.date || "")
  };
}

// IMPORTANT: do NOT delete most results just because fields are missing.
function filterEnglishUS(list) {
  return list.filter((raw) => {
    const a = normalizeArticle(raw);
    const lang = a.language.toLowerCase();
    const ctry = a.country.toLowerCase();

    const langOk = !lang || lang.includes("en") || lang.includes("english");
    const countryOk = !ctry || ctry.includes("united states") || ctry === "us" || ctry === "usa";

    return langOk && countryOk;
  });
}

// ---------- Scoring ----------
function scoreHeadline(title) {
  const t = title.toLowerCase();
  const scores = {};
  for (const c of CATS) scores[c.key] = 0;

  for (const c of CATS) {
    for (const kw of c.keywords) {
      if (t.includes(kw)) scores[c.key] += 3;
    }
    scores[c.key] = Math.min(scores[c.key], 12);
  }
  return scores;
}

function computeIndex(scoresByCat) {
  // Simple sum with caps -> map to 0..100
  let sum = 0;
  for (const c of CATS) sum += (scoresByCat[c.key] || 0);
  const capped = Math.min(sum, 60);
  return Math.max(0, Math.min(100, Math.round((capped / 60) * 100)));
}

function topDriversFromScores(scoresByCat) {
  const arr = CATS.map((c) => ({ key: c.key, label: c.label, v: scoresByCat[c.key] || 0 }))
    .sort((a, b) => b.v - a.v)
    .filter((x) => x.v > 0);
  return arr.slice(0, 3);
}

// ---------- Render ----------
function renderBreakdown(scoresByCat) {
  const rows = CATS.map((c) => {
    const v = scoresByCat[c.key] || 0;
    return `
      <div class="breakRow">
        <div class="breakLabel">${c.label}</div>
        <div class="breakBar"><div class="breakFill" style="width:${Math.min(100, v * 8)}%"></div></div>
        <div class="breakVal">${v}</div>
      </div>
    `;
  }).join("");
  setHTML("breakdown", rows);
}

function renderDrivers(drivers) {
  if (!drivers.length) {
    setHTML("drivers", `<div class="driverEmpty"><b>No clear drivers.</b><br><span class="muted">The omens refuse to elaborate.</span></div>`);
    return;
  }
  const html = drivers.map((d) => `<div class="driverPill"><b>${d.label}</b> • ${d.v}</div>`).join("");
  setHTML("drivers", html);
}

function renderStories(list) {
  if (!list.length) {
    setHTML("stories", `<div class="storyEmpty"><b>No stories found.</b><br><span class="muted">Either the world is peaceful (lol) or the proxy returned nothing.</span></div>`);
    return;
  }
  const items = list.slice(0, UI_LIMIT).map((raw) => {
    const a = normalizeArticle(raw);
    const meta = [a.source, "English", "United States"].filter(Boolean).join(" • ");
    const href = a.url ? a.url : "#";
    const safeHref = href.replace(/"/g, "%22");
    return `
      <a class="story" href="${safeHref}" target="_blank" rel="noopener noreferrer">
        <div class="storyTitle">${a.title}</div>
        <div class="storyMeta">${meta}</div>
      </a>
    `;
  }).join("");
  setHTML("stories", items);
}

// ---------- Main update ----------
async function refresh() {
  setText("statusPill", "Summoning fresh omens…");
  setText("samplePill", "Sample: — headlines");

  try {
    const raw = await fetchArticles(DEFAULT_QUERY);

    const deduped = dedupeArticles(raw);
    const filtered = filterEnglishUS(deduped);

    // If the filter is too strict (because the proxy doesn’t supply fields),
    // fall back to deduped so you still get a feed.
    const usable = filtered.length >= 5 ? filtered : deduped;

    // Aggregate scores from titles
    const agg = {};
    for (const c of CATS) agg[c.key] = 0;

    for (const r of usable) {
      const a = normalizeArticle(r);
      const s = scoreHeadline(a.title);
      for (const c of CATS) agg[c.key] += s[c.key] || 0;
    }

    // Clamp category totals so one keyword spammy day doesn’t peg it
    for (const c of CATS) agg[c.key] = Math.min(agg[c.key], 30);

    const idx = computeIndex(agg);
    setText("doomNum", String(idx));
    setText("doomLabel", labelFromIndex(idx));
    setText("doomTag", tagFromIndex(idx));
    setWidth("doomFill", idx);

    const cls = classFromPct(idx);
    const fill = $("doomFill");
    if (fill) fill.className = `fill ${cls}`.trim();

    renderBreakdown(agg);
    renderDrivers(topDriversFromScores(agg));
    renderStories(usable);

    setText("statusPill", "The omens are… readable.");
    setText("samplePill", `Sample: ${usable.length} headlines`);

    const now = new Date();
    setText("updatedPill", `Updated: ${now.toLocaleDateString()} , ${now.toLocaleTimeString()}`);
  } catch (e) {
    setText("statusPill", "The omens are… unavailable. (Refresh again.)");
    renderDrivers([]);
    renderStories([]);
  }
}

// ---------- About overlay ----------
function openAbout() {
  setText("aboutVersion", `${VERSION} • DoomWorks Interstellar`);
  show("aboutOverlay");
}
function closeAbout() {
  hide("aboutOverlay");
}

// ---------- Boot ----------
document.addEventListener("DOMContentLoaded", () => {
  setText("verText", VERSION);

  const btnRefresh = $("btnRefresh");
  const btnAbout = $("btnAbout");
  const btnCloseAbout = $("btnCloseAbout");

  if (btnRefresh) btnRefresh.addEventListener("click", refresh);
  if (btnAbout) btnAbout.addEventListener("click", openAbout);
  if (btnCloseAbout) btnCloseAbout.addEventListener("click", closeAbout);

  const overlay = $("aboutOverlay");
  if (overlay) {
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeAbout();
    });
  }

  refresh();
});
