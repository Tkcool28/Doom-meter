/* Doomroom News — app.js (v3.1.8)
   Fixes:
   - English-only without blank screens:
       * use language=en when provided
       * otherwise score English-likelihood
       * if strict yields 0, fallback to "best English-looking" results
   - Bars/stories markup matches your CSS (.breakItem/.breakBar/.fill and .stories/.story)
*/

const VERSION = "v3.1.8";

const PROXY_BASE = "https://doom-proxy.toddkirschman.workers.dev";
const ROUTE = "gdelt";

const DEFAULT_QUERY = "world";
const MAX_RECORDS = 60;
const TIMESPAN = "7d";

const CATS = [
  { key: "conflict", label: "Conflict Heat", keywords: ["war","strike","attack","missile","drone","airstrike","invasion","ceasefire","shelling","hostage","terror","bomb","blast"] },
  { key: "climate", label: "Climate Weirdness", keywords: ["heat","wildfire","flood","hurricane","cyclone","storm","drought","record heat","evacuation","blaze","tornado","smoke"] },
  { key: "econ", label: "Economic Drama", keywords: ["inflation","layoff","crash","default","debt","tariff","shutdown","market","bank","recession","strike"] },
  { key: "democracy", label: "Democracy Melting", keywords: ["election","coup","protest","riot","authoritarian","fraud","ban","court","impeach","corruption","arrested","martial law"] },
  { key: "cyber", label: "Cyber Chaos", keywords: ["hack","breach","ransomware","outage","leak","cyber","malware","phishing","ddos"] },
  { key: "nuclear", label: "Unranium", keywords: ["nuclear","uranium","warhead","enrichment","icbm","radiation","reactor"] },
  { key: "space", label: "Space Rocks", keywords: ["asteroid","meteor","comet","space debris","nasa","impact","near-earth","solar flare"] },
  { key: "misc", label: "Misc. Chaos", keywords: ["panic","crisis","emergency","collapse","killed","dead","explosion","chaos","scandal"] }
];

// ---------- DOM helpers ----------
const S = (id) => document.getElementById(id);

const el = {
  refresh: S("btnRefresh"),
  about: S("btnAbout"),
  status: S("statusPill"),
  updated: S("updatedPill"),
  doomNum: S("doomNum"),
  doomLabel: S("doomLabel"),
  doomTag: S("doomTag"),
  doomFill: S("doomFill"),
  sample: S("samplePill"),
  okPill: S("okPill"),
  filterPill: S("filterPill"),
  breakdown: S("breakdown"),
  drivers: S("drivers"),
  stories: S("stories"),
  ver: S("verText"),

  aboutOverlay: S("aboutOverlay"),
  closeAbout: S("btnCloseAbout"),
  closeAbout2: S("btnCloseAbout2"),
  aboutVersion: S("aboutVersion")
};

function safeText(node, txt) { if (node) node.textContent = String(txt ?? ""); }
function safeHTML(node, html) { if (node) node.innerHTML = html; }

function nowStamp() {
  try { return new Date().toLocaleString(); }
  catch { return String(new Date()); }
}

// ---------- About overlay ----------
function showAbout(){ el.aboutOverlay?.classList.remove("hidden"); }
function hideAbout(){ el.aboutOverlay?.classList.add("hidden"); }
function wireAbout() {
  el.about?.addEventListener("click", showAbout);
  el.closeAbout?.addEventListener("click", hideAbout);
  el.closeAbout2?.addEventListener("click", hideAbout);
  el.aboutOverlay?.addEventListener("click", (e) => { if (e.target === el.aboutOverlay) hideAbout(); });
}

// ---------- Dedupe ----------
function dedupeArticles(list) {
  const seen = new Set();
  const out = [];
  for (const a of list || []) {
    const url = (a?.url || a?.link || "").trim();
    const title = String(a?.title || "").trim();
    const key = url ? `u:${url}` : `t:${title.toLowerCase()}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({
      title,
      url,
      source: String(a?.source || a?.publisher || a?.domain || a?.site || "").trim(),
      time: String(a?.time || a?.publishedAt || a?.published || "").trim(),
      language: String(a?.language || a?.lang || "").trim()
    });
  }
  return out;
}

// ---------- English scoring / filtering (robust) ----------
const NON_LATIN = /[\u0400-\u04FF\u0500-\u052F\u0600-\u06FF\u0900-\u097F\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/;

const COMMON_EN = new Set([
  "the","a","an","and","or","but","to","of","in","on","for","with","from","as","at","by","after","before",
  "new","says","say","report","reports","amid","over","about","into","will","may","could","should"
]);

// A few high-signal non-English stopwords (single hit does NOT kill it, just lowers score)
const NON_EN = new Set([
  "el","la","los","las","un","una","unos","unas","y","de","del","en","por","para","con","sin","que",
  "o","os","as","um","uma","e","do","da","dos","das","em","não",
  "yang","dan","di","ke","dari","untuk","pada","dengan","tidak","ini","itu",
  "le","les","des","et","du","dans","pour","avec","sans",
  "der","die","das","und","mit","für","von","im","auf","nicht","ein","eine"
]);

function englishScore(title, langField) {
  if (!title) return -999;
  const t = String(title).trim();
  if (!t) return -999;
  if (NON_LATIN.test(t)) return -999; // hard reject for non-latin scripts

  const lang = String(langField || "").trim().toLowerCase();
  if (lang === "en" || lang.startsWith("en-")) return 999; // guaranteed keep if worker says en
  if (lang && lang !== "en" && !lang.startsWith("en-")) return -50; // worker claims non-en

  // Heuristic scoring
  // Allow accents sometimes (names/places), but penalize if there are many.
  const nonAsciiCount = (t.match(/[^\x00-\x7F]/g) || []).length;

  const words = t
    .toLowerCase()
    .replace(/[^a-z0-9'\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  if (words.length < 2) return -10;

  let score = 0;

  // English function words boost
  for (const w of words) {
    if (COMMON_EN.has(w)) score += 2;
    if (NON_EN.has(w)) score -= 3;
  }

  // Penalize lots of accents / non-ascii
  score -= nonAsciiCount * 2;

  // Boost if headline contains typical English punctuation patterns
  if (t.includes("'")) score += 1;
  if (t.includes(":")) score += 1;

  return score;
}

function filterEnglishOnly(list) {
  const scored = list.map(a => ({ a, s: englishScore(a.title, a.language) }));

  // Strict: keep only those strongly likely English OR explicitly en
  const strict = scored
    .filter(x => x.s >= 2 || x.s === 999)
    .sort((x, y) => y.s - x.s)
    .map(x => x.a);

  // If strict yields nothing, fallback to "best English-looking" (still avoids obvious non-English)
  if (strict.length > 0) return { out: strict, mode: "strict" };

  const fallback = scored
    .filter(x => x.s > -20)              // drops obvious non-English
    .sort((x, y) => y.s - x.s)
    .slice(0, 12)                         // keep the best-looking English-ish set
    .map(x => x.a);

  return { out: fallback, mode: "fallback" };
}

// ---------- Doom scoring ----------
function scoreHeadline(title) {
  const t = String(title || "").toLowerCase();
  const scores = {};
  for (const c of CATS) scores[c.key] = 0;

  for (const c of CATS) {
    for (const kw of c.keywords) if (t.includes(kw)) scores[c.key] += 3;
    scores[c.key] = Math.min(scores[c.key], 12);
  }
  return scores;
}

function pct(score, max) {
  if (!max || max <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((score / max) * 100)));
}
function pctForCategory(catScore, headlineCount) { return pct(catScore, headlineCount * 12); }
function pctForOverall(totalScore, headlineCount) { return pct(totalScore, headlineCount * CATS.length * 12); }

function classFromPct(p) {
  if (p > 90) return "fire";
  if (p >= 80) return "red";
  if (p >= 35) return "yellow";
  return "green";
}
function labelFromPct(p) {
  if (p > 90) return "On fire.";
  if (p >= 80) return "Bad vibes.";
  if (p >= 50) return "Spicy.";
  if (p >= 25) return "Uneasy.";
  return "Chill (suspiciously).";
}

// ---------- Fetch ----------
async function fetchJSON(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

async function fetchViaWorker(query) {
  const q = encodeURIComponent(query);
  const max = encodeURIComponent(String(MAX_RECORDS));
  const span = encodeURIComponent(TIMESPAN);

  const urlsLang = [
    `${PROXY_BASE}/${ROUTE}?query=${q}&max=${max}&timespan=${span}&lang=en`,
    `${PROXY_BASE}/${ROUTE}?q=${q}&max=${max}&timespan=${span}&lang=en`,
    `${PROXY_BASE}/${ROUTE}?g=${q}&max=${max}&timespan=${span}&lang=en`
  ];

  const urlsNoLang = [
    `${PROXY_BASE}/${ROUTE}?query=${q}&max=${max}&timespan=${span}`,
    `${PROXY_BASE}/${ROUTE}?q=${q}&max=${max}&timespan=${span}`,
    `${PROXY_BASE}/${ROUTE}?g=${q}&max=${max}&timespan=${span}`
  ];

  let lastErr = null;
  for (const u of urlsLang) { try { return await fetchJSON(u); } catch (e) { lastErr = e; } }
  for (const u of urlsNoLang) { try { return await fetchJSON(u); } catch (e) { lastErr = e; } }
  throw lastErr || new Error("Worker fetch failed");
}

// ---------- Render ----------
function setStatus(msg) { safeText(el.status, msg); }
function setUpdated(msg) { safeText(el.updated, `Updated: ${msg}`); }

function renderBars(catTotals) {
  if (!el.breakdown) return;
  const headlineCount = window.__HEADLINE_COUNT__ || 1;

  const rows = CATS.map(c => {
    const val = catTotals[c.key] || 0;
    const p = pctForCategory(val, headlineCount);
    const cls = classFromPct(p);
    return `
      <div class="breakItem">
        <div class="breakTop">
          <div>${c.label}</div>
          <div>${val}</div>
        </div>
        <div class="breakBar">
          <div class="fill ${cls}" style="width:${p}%"></div>
        </div>
      </div>
    `;
  }).join("");

  safeHTML(el.breakdown, rows);
}

function renderDrivers(topDrivers) {
  if (!el.drivers) return;
  if (!topDrivers.length) {
    safeHTML(el.drivers, `<div class="muted">No obvious drivers. Reality is being unusually polite.</div>`);
    return;
  }
  safeHTML(el.drivers, topDrivers.map(s => `<div class="pill">${escapeHtml(s)}</div>`).join(""));
}

function renderStories(items) {
  if (!el.stories) return;
  if (!items.length) {
    safeHTML(el.stories, `<div class="muted">No stories found. (English filter removed everything.)</div>`);
    return;
  }

  const cards = items.map(a => {
    const source = a.source ? a.source : "source unknown";
    const title = a.title || "(untitled)";
    const url = a.url || "#";
    return `
      <a class="story" href="${url}" target="_blank" rel="noopener noreferrer">
        <div class="storyTitle">${escapeHtml(title)}</div>
        <div class="storyMeta">${escapeHtml(source)} • English • Global</div>
      </a>
    `;
  }).join("");

  safeHTML(el.stories, `<div class="stories">${cards}</div>`);
}

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// ---------- Main pipeline ----------
async function run(query = DEFAULT_QUERY) {
  setStatus("Reading the omens…");
  safeText(el.sample, "Sample: —");

  try {
    const data = await fetchViaWorker(query);

    const rawList =
      Array.isArray(data) ? data :
      (data.articles || data.items || data.results || data.data || data.entries || []);

    let list = dedupeArticles(rawList);
    const before = list.length;

    safeText(el.filterPill, "Filter: English only / Global");

    const filtered = filterEnglishOnly(list);
    list = filtered.out;

    const after = list.length;
    safeText(el.sample, `Sample: ${after} headlines`);
    window.__HEADLINE_COUNT__ = Math.max(1, after);

    // Score doom
    const totals = {};
    for (const c of CATS) totals[c.key] = 0;

    const keywordHits = [];
    for (const a of list) {
      const scores = scoreHeadline(a.title);
      for (const c of CATS) totals[c.key] += scores[c.key];

      const t = (a.title || "").toLowerCase();
      for (const c of CATS) for (const kw of c.keywords) if (t.includes(kw)) keywordHits.push(kw);
    }

    const doomScore = Object.values(totals).reduce((s, n) => s + n, 0);
    const doomPct = pctForOverall(doomScore, window.__HEADLINE_COUNT__);
    const doomCls = classFromPct(doomPct);
    const doomLabel = labelFromPct(doomPct);

    safeText(el.doomNum, String(doomPct));
    safeText(el.doomLabel, doomLabel);
    safeText(el.doomTag, "Take a breath. The universe is weird.");

    if (el.doomFill) {
      el.doomFill.className = `fill ${doomCls}`;
      el.doomFill.style.width = `${doomPct}%`;
    }

    renderBars(totals);

    const driverCounts = {};
    for (const k of keywordHits) driverCounts[k] = (driverCounts[k] || 0) + 1;
    const topDrivers = Object.entries(driverCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([k]) => k);

    renderDrivers(topDrivers);
    renderStories(list.slice(0, 12));

    // status includes whether fallback happened
    const modeNote = filtered.mode === "fallback" ? " (fallback)" : "";
    setStatus(`Omens readable. (${before}→${after})${modeNote}`);
    setUpdated(nowStamp());
    safeText(el.okPill, "OK");
  } catch (err) {
    const msg = (err && err.message) ? err.message : String(err);
    setStatus(`Omen failure: ${msg}`);
    setUpdated(nowStamp());
    safeText(el.okPill, "OK");
    safeText(el.sample, "Sample: 0 headlines");
    renderStories([]);
    console.error(err);
  }
}

function wireRefresh() {
  el.refresh?.addEventListener("click", () => run(DEFAULT_QUERY));
}

window.addEventListener("DOMContentLoaded", () => {
  safeText(el.ver, VERSION);
  safeText(el.aboutVersion, VERSION);
  wireAbout();
  wireRefresh();
  run(DEFAULT_QUERY);
});
