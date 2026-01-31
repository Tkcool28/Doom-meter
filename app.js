/* Doomroom News — app.js (v3.2.8)
   Includes:
   - GDELT fetch via Cloudflare worker (/gdelt)
   - English-only (strict) with smart fallback if too few results
   - Per-category normalization (bars + main doom number match)
   - Slight "lean higher" curve on average doom
   - Your custom 0–100 label ranges + tag copy
*/

const VERSION = "v3.2.8";

// Cloudflare worker (yours)
const PROXY_BASE = "https://doom-proxy.toddkirschman.workers.dev";
const ROUTE = "gdelt";

// Content knobs
const DEFAULT_QUERY = "world";
const MAX_RECORDS = 80;
const TIMESPAN = "7d";

// Doom categories (same spirit as before)
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

function safeText(node, txt) {
  if (!node) return;
  node.textContent = String(txt ?? "");
}

function safeHTML(node, html) {
  if (!node) return;
  node.innerHTML = html;
}

function nowStamp() {
  try { return new Date().toLocaleString(); }
  catch { return String(new Date()); }
}

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// ---------- About overlay ----------
function showAbout() {
  if (!el.aboutOverlay) return;
  el.aboutOverlay.classList.remove("hidden");
}
function hideAbout() {
  if (!el.aboutOverlay) return;
  el.aboutOverlay.classList.add("hidden");
}
function wireAbout() {
  if (el.about) el.about.addEventListener("click", showAbout);
  if (el.closeAbout) el.closeAbout.addEventListener("click", hideAbout);
  if (el.closeAbout2) el.closeAbout2.addEventListener("click", hideAbout);
  if (el.aboutOverlay) {
    el.aboutOverlay.addEventListener("click", (e) => {
      if (e.target === el.aboutOverlay) hideAbout();
    });
  }
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

  // Standard route for your worker:
  // /gdelt?query=...&mode=ArtList&format=json&maxrecords=...&timespan=...
  const u = `${PROXY_BASE}/${ROUTE}?query=${q}&mode=ArtList&format=json&maxrecords=${max}&timespan=${span}`;
  return await fetchJSON(u);
}

// ---------- Article cleanup ----------
function dedupeArticles(list) {
  const seen = new Set();
  const out = [];

  for (const a of list || []) {
    const url = (a?.url || a?.url_mobile || a?.link || "").trim();
    const title = String(a?.title || "").trim();
    if (!title) continue;

    const key = url ? `u:${url}` : `t:${title.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      title,
      url: url || "#",
      source: String(a?.domain || a?.source || a?.publisher || "").trim(),
      language: String(a?.language || "").trim(),
      country: String(a?.sourcecountry || a?.sourceCountry || "").trim(),
      time: String(a?.seendate || a?.publishedAt || a?.published || "").trim()
    });
  }
  return out;
}

// ---------- English filtering (strict + fallback) ----------
// Strict tries to keep only obvious English-ish headlines.
// If it yields too few, we fall back to "Latin-script only" (still blocks Chinese/Cyrillic/Arabic/etc).

const NON_LATIN = /[\u0400-\u04FF\u0500-\u052F\u0600-\u06FF\u0900-\u097F\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/;

// Common English hints (lightweight, not a full language detector)
const EN_HINT = /\b(the|and|for|with|from|after|over|into|amid|says|said|new|as|on|in|at|to|of)\b/i;

// Strict: must be Latin script, mostly ASCII letters/spaces/punct, and have at least one English hint OR lots of letters.
function keepEnglishStrict(title) {
  if (!title) return false;
  const t = String(title).trim();
  if (!t) return false;
  if (NON_LATIN.test(t)) return false;

  // ratio of ASCII to total (helps reject weird mixed scripts)
  const asciiCount = (t.match(/[\x00-\x7F]/g) || []).length;
  const ratio = asciiCount / Math.max(1, t.length);
  if (ratio < 0.92) return false;

  // must look like a real sentence/headline
  const letters = (t.match(/[A-Za-z]/g) || []).length;
  if (letters < 18) return EN_HINT.test(t);

  // either has common English words OR just strongly English-looking
  return EN_HINT.test(t) || letters >= 25;
}

// Fallback: Latin script only (blocks obvious non-Latin floods)
function keepEnglishFallback(title) {
  if (!title) return false;
  const t = String(title).trim();
  if (!t) return false;
  if (NON_LATIN.test(t)) return false;
  return true;
}

// ---------- Doom scoring ----------
function scoreHeadline(title) {
  const t = String(title || "").toLowerCase();
  const scores = {};
  for (const c of CATS) scores[c.key] = 0;

  for (const c of CATS) {
    for (const kw of c.keywords) {
      if (t.includes(kw)) scores[c.key] += 3;
    }
    // cap per category per headline
    scores[c.key] = Math.min(scores[c.key], 12);
  }
  return scores;
}

// ---------- Per-category normalization (key fix) ----------
const PER_ARTICLE_CAP = 12;

// 1.0 = normal average, <1 leans higher in the middle.
// 0.85 = mild boost; 0.75 = bigger boost.
const DOOM_CURVE = 0.85;

function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

function pctFromCatTotal(total, articleCount) {
  const n = Math.max(1, Number(articleCount) || 1);
  const maxTotal = n * PER_ARTICLE_CAP;
  const pct = Math.round((Number(total || 0) / maxTotal) * 100);
  return clamp(pct, 0, 100);
}

function classFromPct(p) {
  if (p > 90) return "fire";
  if (p >= 80) return "red";
  if (p >= 35) return "yellow";
  return "green";
}

// Your 0–100 label lines + tag copy
function labelFromPct(p) {
  if (p <= 20) return "We’re so back.";
  if (p <= 40) return "Mildly cursed timeline.";
  if (p <= 60) return "This is why aliens don’t visit.";
  if (p <= 80) return "Please put your trays into their upright position, and fasten your seat belts.";
  if (p <= 95) return "Apocalypse-adjacent.";
  return "Final Boss Week unlocked.";
}

function tagFromPct(p) {
  if (p <= 20) return "Things are calm. Suspiciously calm. Enjoy it while it lasts.";
  if (p <= 40) return "Nothing is technically broken, but the vibes are off.";
  if (p <= 60) return "Patterns are emerging. None of them are flattering to humanity.";
  if (p <= 80) return "Multiple systems are wobbling. Turbulence ahead.";
  if (p <= 95) return "Not the end of the world, but it’s definitely in the waiting room.";
  return "Everything is happening everywhere all at once. Do not check the news before bed.";
}

// ---------- Render ----------
function setStatus(msg) { safeText(el.status, msg); }
function setUpdated(msg) { safeText(el.updated, `Updated: ${msg}`); }

function renderBars(catTotals, articleCount) {
  if (!el.breakdown) return;

  // Uses your CSS classes: breakItem/breakBar + fill.<color>
  const rows = CATS.map(c => {
    const raw = catTotals[c.key] || 0;
    const pct = pctFromCatTotal(raw, articleCount);
    const cls = classFromPct(pct);

    return `
      <div class="breakItem">
        <div class="breakTop">
          <div>${escapeHtml(c.label)}</div>
          <div>${raw}</div>
        </div>
        <div class="breakBar">
          <div class="fill ${cls}" style="width:${pct}%"></div>
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

function renderStories(items, metaLabel) {
  if (!el.stories) return;
  if (!items.length) {
    safeHTML(el.stories, `<div class="muted">No stories found.</div>`);
    return;
  }

  const cards = items.map(a => {
    const source = a.source ? a.source : "source unknown";
    const title = a.title || "(untitled)";
    const url = a.url || "#";
    return `
      <a class="story" href="${url}" target="_blank" rel="noopener noreferrer">
        <div class="storyTitle">${escapeHtml(title)}</div>
        <div class="storyMeta">${escapeHtml(source)} • ${escapeHtml(metaLabel)} • Global</div>
      </a>
    `;
  }).join("");

  // Your CSS expects .stories container to be flex column; your HTML uses id="stories" directly.
  safeHTML(el.stories, `<div class="stories">${cards}</div>`);
}

// ---------- Main pipeline ----------
async function run(query = DEFAULT_QUERY) {
  setStatus("Loading…");
  safeText(el.sample, "Sample: —");
  safeText(el.okPill, "OK");
  safeText(el.filterPill, "Filter: English ONLY / Global");

  try {
    const data = await fetchViaWorker(query);

    // GDELT doc API usually returns { articles: [...] }
    const rawList =
      Array.isArray(data) ? data :
      (data.articles || data.items || data.results || data.data || data.entries || []);

    let list = dedupeArticles(rawList);

    const before = list.length;

    // ---- English strict first ----
    let strict = list.filter(a => keepEnglishStrict(a.title));

    // If strict removes too much, fall back to Latin-script filter (still blocks Chinese/Cyrillic/Arabic/etc)
    // Minimum: keep at least 12 OR at least 20% of the original list (whichever is smaller threshold)
    const minKeep = Math.min(12, Math.ceil(before * 0.20));

    let usedFallback = false;
    if (strict.length < minKeep && before > 0) {
      usedFallback = true;
      strict = list.filter(a => keepEnglishFallback(a.title));
      safeText(el.filterPill, "Filter: Global (English filter unavailable)");
    } else {
      safeText(el.filterPill, "Filter: English ONLY / Global");
    }

    list = strict;

    const after = list.length;
    safeText(el.sample, `Sample: ${after} headlines`);

    // ---- Doom totals ----
    const totals = {};
    for (const c of CATS) totals[c.key] = 0;

    const keywordHits = [];
    for (const a of list) {
      const scores = scoreHeadline(a.title);
      for (const c of CATS) totals[c.key] += scores[c.key];

      const t = (a.title || "").toLowerCase();
      for (const c of CATS) {
        for (const kw of c.keywords) {
          if (t.includes(kw)) keywordHits.push(kw);
        }
      }
    }

    // ---- Normalized Doom Index (average of normalized category percents + curve) ----
    const catPcts = CATS.map(c => pctFromCatTotal(totals[c.key] || 0, list.length));
    const avg = catPcts.reduce((s, n) => s + n, 0) / Math.max(1, catPcts.length);
    const curved = 100 * Math.pow(avg / 100, DOOM_CURVE);
    const doomPct = Math.round(clamp(curved, 0, 100));

    const doomCls = classFromPct(doomPct);
    const doomLabel = labelFromPct(doomPct);
    const doomTag = tagFromPct(doomPct);

    safeText(el.doomNum, String(doomPct));
    safeText(el.doomLabel, doomLabel);
    safeText(el.doomTag, doomTag);

    if (el.doomFill) {
      el.doomFill.className = `fill ${doomCls}`;
      el.doomFill.style.width = `${doomPct}%`;
    }

    renderBars(totals, list.length);

    const driverCounts = {};
    for (const k of keywordHits) driverCounts[k] = (driverCounts[k] || 0) + 1;

    const topDrivers = Object.entries(driverCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([k]) => k);

    renderDrivers(topDrivers);
    renderStories(list.slice(0, 12), usedFallback ? "Global" : "English");

    // Status text matches your style
    if (usedFallback) {
      setStatus(`Omens readable. (English: ${before} → ${after}) (fallback)`);
    } else {
      setStatus(`Omens readable. (English: ${before} → ${after})`);
    }

    setUpdated(nowStamp());
    safeText(el.okPill, "OK");

  } catch (err) {
    const msg = (err && err.message) ? err.message : String(err);
    setStatus(`Omen failure: ${msg}`);
    setUpdated(nowStamp());
    safeText(el.okPill, "OK");
    safeText(el.sample, "Sample: 0 headlines");
    renderDrivers([]);
    renderStories([], "—");
    console.error(err);
  }
}

function wireRefresh() {
  if (el.refresh) el.refresh.addEventListener("click", () => run(DEFAULT_QUERY));
}

// ---------- Boot ----------
window.addEventListener("DOMContentLoaded", () => {
  safeText(el.ver, VERSION);
  safeText(el.aboutVersion, VERSION);

  wireAbout();
  wireRefresh();

  run(DEFAULT_QUERY);
});
