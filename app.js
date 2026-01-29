/* Doomroom News — app.js (v3.1.5)
   Changes:
   - Enforce English-only (global) with a safe fallback
   - If language metadata is missing, use a light title-based heuristic
   - Update UI pill text in index.html separately
*/

const VERSION = "v3.1.5";

// ✅ your worker
const PROXY_BASE = "https://doom-proxy.toddkirschman.workers.dev";
const ROUTE = "/gdel";

// Query defaults
const DEFAULT_QUERY = "world";
const MAX_RECORDS = 25;
const TIMESPA N = "2d"; // keep your recency window

// Doom scoring configuration
const CATEGORY_MAX = 30;
const CATS = [
  { key: "conflict", label: "Conflict Heat", keywords: ["war","strike","attack","missile","drone","airstrike","invasion","ceasefire","shelling","hostage","terror","bomb","blast"] },
  { key: "climate",  label: "Climate Weirdness", keywords: ["heat","wildfire","flood","hurricane","cyclone","storm","drought","record heat","evacuation","blaze","tornado","smoke"] },
  { key: "econ",     label: "Economic Drama", keywords: ["recession","inflation","layoffs","bank","rate","crash","default","debt","tariff","shutdown","market"] },
  { key: "democracy",label: "Democracy Melting", keywords: ["election","coup","protest","riot","authoritarian","fraud","ban","court","impeach","corruption","arrested","martial law"] },
  { key: "cyber",    label: "Cyber Chaos", keywords: ["hack","breach","ransomware","outage","leak","cyber","malware","phishing","ddos"] },
  { key: "space",    label: "Space Rocks", keywords: ["asteroid","meteor","comet","space debris","nasa","impact","near-earth","solar flare"] },
  { key: "misc",     label: "Misc. Chaos", keywords: ["panic","crisis","emergency","collapse","killed","dead","explosion","chaos","scandal"] },
];

const $ = (id) => document.getElementById(id);

const el = {
  refresh: $("btnRefresh"),
  about: $("btnAbout"),
  status: $("statusPill"),
  updated: $("updatedPill"),
  doomNum: $("doomNum"),
  doomLabel: $("doomLabel"),
  doomTag: $("doomTag"),
  doomFill: $("doomFill"),
  sample: $("samplePill"),
  ok: $("okPill"),
  breakdown: $("breakdown"),
  drivers: $("drivers"),
  stories: $("stories"),
  ver: $("verText"),
  filter: $("filterPill"),
  aboutOverlay: $("aboutOverlay"),
  closeAbout: $("btnCloseAbout"),
  closeAbout2: $("btnCloseAbout2"),
  aboutVersion: $("aboutVersion"),
};

function safeStr(v) {
  return (v === null || v === undefined) ? "" : String(v);
}

function setStatus(msg) {
  if (el.status) el.status.textContent = msg;
}

function setUpdated(dateStr) {
  if (el.updated) el.updated.textContent = dateStr ? `Updated: ${dateStr}` : "Updated: —";
}

function clamp01(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function labelFromIndex(idx) {
  if (idx >= 90) return "On fire.";
  if (idx >= 80) return "Bad vibes.";
  if (idx >= 50) return "Spicy.";
  if (idx >= 25) return "Uneasy.";
  return "Chill (suspiciously).";
}

function fillClassFromPct(p) {
  if (p > 90) return "fire";
  if (p >= 80) return "red";
  if (p >= 35) return "yellow";
  return "";
}

function normalizeArticle(raw) {
  const title = safeStr(raw.title || raw.name || raw.headline).trim();
  const url = safeStr(raw.url || raw.link).trim();

  // Some feeds use "source" object, others string
  let source = "";
  if (raw.source) {
    source = typeof raw.source === "string" ? raw.source : safeStr(raw.source.name || raw.source.title);
  } else {
    source = safeStr(raw.site || raw.publisher);
  }

  const language = safeStr(raw.language || raw.lang || raw.locale || "").trim();

  // Published date varies wildly by feed
  const publishedAt =
    safeStr(raw.publishedAt || raw.pubDate || raw.date || raw.published || raw.updated || "").trim();

  return {
    title,
    url,
    source: source.trim(),
    language,
    publishedAt,
    raw,
  };
}

function dedupeArticles(list) {
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const a = normalizeArticle(raw);
    const key = a.url ? `u:${a.url}` : `t:${a.title.toLowerCase()}`;
    if (!a.title) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

/* --- English filter: strong + safe --- */

function looksEnglishByText(title) {
  const t = safeStr(title);
  if (!t) return false;

  let latin = 0, other = 0;

  for (const ch of t) {
    const code = ch.charCodeAt(0);

    // A–Z a–z
    if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) {
      latin++;
      continue;
    }

    // Ignore digits, whitespace, punctuation/basic ASCII symbols
    const isIgnorable =
      (code >= 48 && code <= 57) || // 0-9
      code === 32 || code === 9 ||  // space/tab
      (code >= 33 && code <= 47) ||
      (code >= 58 && code <= 64) ||
      (code >= 91 && code <= 96) ||
      (code >= 123 && code <= 126);

    if (isIgnorable) continue;

    // Anything else is "other" (CJK, Cyrillic, etc.)
    other++;
  }

  const total = latin + other;
  if (total === 0) return false;

  // If it’s mostly Latin letters, call it “English enough”
  return latin / total >= 0.6;
}

function filterEnglishOnly(list) {
  return list.filter((a) => {
    const lang = safeStr(a.language).toLowerCase();

    // If language is provided, enforce English.
    if (lang) {
      return lang.includes("en") || lang.includes("english");
    }

    // If language missing, guess from title.
    return looksEnglishByText(a.title);
  });
}

/* --- Doom scoring --- */

function scoreHeadline(title) {
  const t = safeStr(title).toLowerCase();
  const scores = {};
  for (const c of CATS) scores[c.key] = 0;

  for (const c of CATS) {
    for (const kw of c.keywords) {
      if (t.includes(kw)) scores[c.key] += 3;
    }
    // cap per-category so one headline doesn't nuke the meter
    scores[c.key] = Math.min(scores[c.key], 12);
  }
  return scores;
}

function computeDoomIndex(articles) {
  const totals = {};
  for (const c of CATS) totals[c.key] = 0;

  for (const a of articles) {
    const s = scoreHeadline(a.title);
    for (const k in s) totals[k] += s[k];
  }

  // normalize to 0..100 based on CATEGORY_MAX
  const sum = Object.values(totals).reduce((acc, v) => acc + v, 0);
  const idx = Math.max(0, Math.min(100, Math.round((sum / CATEGORY_MAX) * 100)));

  return { idx, totals };
}

/* --- Render --- */

function renderBreakdown(totals) {
  if (!el.breakdown) return;
  el.breakdown.innerHTML = "";

  for (const c of CATS) {
    const v = totals[c.key] || 0;

    const row = document.createElement("div");
    row.className = "breakRow";

    const label = document.createElement("div");
    label.className = "breakLabel";
    label.textContent = c.label;

    const meter = document.createElement("div");
    meter.className = "miniMeter";

    const fill = document.createElement("div");
    fill.className = "fill";
    fill.style.width = `${Math.min(100, Math.round((v / 12) * 100))}%`;

    meter.appendChild(fill);

    const num = document.createElement("div");
    num.className = "breakNum";
    num.textContent = String(v);

    row.appendChild(label);
    row.appendChild(meter);
    row.appendChild(num);

    el.breakdown.appendChild(row);
  }
}

function renderDrivers(articles) {
  if (!el.drivers) return;

  // pick top 3 “spikiest” headlines by sum of keyword hits
  const scored = articles.map((a) => {
    const s = scoreHeadline(a.title);
    const sum = Object.values(s).reduce((acc, v) => acc + v, 0);
    return { a, sum };
  }).sort((x, y) => y.sum - x.sum);

  const top = scored.filter(x => x.sum > 0).slice(0, 3);

  if (!top.length) {
    el.drivers.innerHTML = `
      <div class="smallCard">
        <div class="smallTitle">No clear drivers.</div>
        <div class="muted">The omens refuse to elaborate.</div>
      </div>`;
    return;
  }

  el.drivers.innerHTML = top.map(({ a }) => `
    <div class="smallCard">
      <div class="smallTitle">${escapeHtml(a.title)}</div>
      <div class="muted">${escapeHtml(a.source || "unknown source")}</div>
    </div>
  `).join("");
}

function escapeHtml(s) {
  return safeStr(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderStories(articles) {
  if (!el.stories) return;

  el.stories.innerHTML = articles.slice(0, 12).map((a) => `
    <a class="storyCard" href="${escapeHtml(a.url || "#")}" target="_blank" rel="noopener noreferrer">
      <div class="storyTitle">${escapeHtml(a.title)}</div>
      <div class="storyMeta">${escapeHtml(a.source || "unknown")} • English • Global</div>
    </a>
  `).join("");
}

/* --- Fetch --- */

async function fetchNews() {
  const url = `${PROXY_BASE}${ROUTE}?q=${encodeURIComponent(DEFAULT_QUERY)}&n=${encodeURIComponent(MAX_RECORDS)}&t=${encodeURIComponent(TIMESPA N)}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`news fetch failed: ${res.status}`);

  const data = await res.json();

  // your worker might return { articles: [...] } or just [...]
  const list = Array.isArray(data) ? data : (data.articles || data.items || []);
  if (!Array.isArray(list)) return [];

  return list;
}

/* --- Main refresh --- */

async function refresh() {
  try {
    setStatus("The omens are... readable.");
    if (el.ok) el.ok.textContent = "OK";

    const raw = await fetchNews();
    const deduped = dedupeArticles(raw);

    // ✅ English-only (global)
    const filtered = filterEnglishOnly(deduped);

    // Keep English-only if we have any; otherwise fall back so app doesn't look dead.
    const usable = filtered.length ? filtered : deduped;

    const { idx, totals } = computeDoomIndex(usable);

    if (el.doomNum) el.doomNum.textContent = String(idx);
    if (el.doomLabel) el.doomLabel.textContent = labelFromIndex(idx);

    // fill meter
    const pct = clamp01(idx / 100) * 100;
    if (el.doomFill) {
      el.doomFill.style.width = `${pct}%`;
      el.doomFill.className = `fill ${fillClassFromPct(idx)}`;
    }

    renderBreakdown(totals);
    renderDrivers(usable);
    renderStories(usable);

    // sample + timestamps
    if (el.sample) el.sample.textContent = `Sample: ${usable.length} headlines`;
    setUpdated(new Date().toLocaleString());

  } catch (err) {
    console.error(err);
    setStatus("The omens are... unavailable.");
    if (el.sample) el.sample.textContent = "Sample: 0 headlines";
  }
}

/* --- About modal --- */

function openAbout() {
  if (!el.aboutOverlay) return;
  el.aboutOverlay.classList.add("show");
  if (el.aboutVersion) el.aboutVersion.textContent = `${VERSION} • DoomWorks Interstellar`;
}

function closeAbout() {
  if (!el.aboutOverlay) return;
  el.aboutOverlay.classList.remove("show");
}

/* --- Boot --- */

function boot() {
  if (el.ver) el.ver.textContent = VERSION;

  if (el.refresh) el.refresh.addEventListener("click", refresh);
  if (el.about) el.about.addEventListener("click", openAbout);
  if (el.closeAbout) el.closeAbout.addEventListener("click", closeAbout);
  if (el.closeAbout2) el.closeAbout2.addEventListener("click", closeAbout);

  refresh();
}

document.addEventListener("DOMContentLoaded", boot);
