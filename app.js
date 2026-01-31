/* Doomroom News — app.js (v3.3.0)
   Fixes:
   - Never stuck on Loading (timeout + always updates UI)
   - English-only filter that DOESN’T collapse to 2 articles
   - Blocks non-Latin scripts (Chinese/Cyrillic/Arabic/etc)
   - Blocks common non-English Latin headlines via “tripwire” words
   - Doom score is an average that "leans higher" (power-mean)
*/

const VERSION = "v3.3.0";

// Your Cloudflare Worker
const PROXY_BASE = "https://doom-proxy.toddkirschman.workers.dev";
const ROUTE = "gdelt";

// Content knobs
const DEFAULT_QUERY = "world";
const MAX_RECORDS = 160;     // fetch more so English filter has room
const TIMESAPAN = "7d";      // (kept name used earlier)  <-- not used; see TIMES
const TIMESPAN = "7d";

// Doom categories
const CATEGORY_MAX = 30; // per-category cap to normalize bars
const CATS = [
  { key: "conflict", label: "Conflict Heat", keywords: ["war","attack","strike","missile","drone","invasion","ceasefire","shelling","hostage","terror","bomb","blast"] },
  { key: "climate", label: "Climate Weirdness", keywords: ["heatwave","wildfire","flood","hurricane","cyclone","storm","drought","record heat","evacuation","blaze","tornado","smoke"] },
  { key: "econ", label: "Economic Drama", keywords: ["inflation","layoff","crash","default","debt","tariff","shutdown","market","bank","recession","strike"] },
  { key: "democracy", label: "Democracy Melting", keywords: ["election","coup","protest","riot","authoritarian","fraud","ban","court","impeach","corruption","arrested","martial law"] },
  { key: "cyber", label: "Cyber Chaos", keywords: ["hack","breach","ransomware","outage","leak","cyber","malware","phishing","ddos"] },
  { key: "nuclear", label: "Uranium", keywords: ["nuclear","uranium","warhead","enrichment","icbm","radiation","reactor"] },
  { key: "space", label: "Space Rocks", keywords: ["asteroid","meteor","comet","space debris","nasa","impact","near earth","solar flare"] },
  { key: "misc", label: "Misc. Chaos", keywords: ["panic","crisis","emergency","collapse","killed","dead","explosion","chaos","scandal"] }
];

// Query (works well with the worker)
const DEFAULT_QUERY_FALLBACK =
  "war OR attack OR missile OR drone OR nuclear OR election OR protest OR coup OR inflation OR layoff OR ransomware OR breach OR wildfire OR flood OR hurricane";

// DOM helpers
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
  okPill: $("okPill"),
  filterPill: $("filterPill"),
  breakdown: $("breakdown"),
  drivers: $("drivers"),
  stories: $("stories"),
  ver: $("verText"),

  aboutOverlay: $("aboutOverlay"),
  closeAbout: $("btnCloseAbout"),
  closeAbout2: $("btnCloseAbout2"),
  aboutVersion: $("aboutVersion"),
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
  if (el.aboutVersion) safeText(el.aboutVersion, VERSION);
}

// ---------- Crash reporting (prevents silent “stuck loading”) ----------
function showFatal(where, err) {
  const msg = `${where}: ${String(err && err.message ? err.message : err)}`.slice(0, 220);
  safeText(el.status, `Error — ${msg}`);
  if (el.status) el.status.style.opacity = "1";
  safeText(el.updated, `Updated: ${nowStamp()}`);
  safeText(el.sample, "Sample: —");
  safeText(el.ver, VERSION);
}
window.addEventListener("error", (e) => showFatal("JS error", e.error || e.message));
window.addEventListener("unhandledrejection", (e) => showFatal("Promise", e.reason));

// ---------- English-only filter (STRICT but not collapsing) ----------
// Blocks non-Latin scripts
const NON_LATIN = /[\u0400-\u04FF\u0500-\u052F\u0600-\u06FF\u0590-\u05FF\u3040-\u30FF\uAC00-\uD7AF]/;

// Tripwire words — if these appear, it’s almost never actually English
const NON_EN_TRIPWIRE = /\b(
  de|la|el|los|las|una|un|para|por|con|sin|del|al|que|y|en|
  da|do|dos|das|uma|um|para|com|sem|não|na|no|nos|nas|
  yang|dan|atau|dengan|untuk|pada|ini|itu|dari|ke|di|sebagai|
  telah|akan|juga|tidak|bisa|terkait|menjadi
)\b/ix;

// English “shape” hints (multiple signals so we don’t collapse)
const EN_COMMON = /\b(the|and|to|of|in|for|on|with|from|over|after|as|at|by|is|are|was|were|will|may|could|should|says|say|new|report|reports|amid|court|police|army|government|minister|crisis|attack|war|deal|talks|vote|election|trump|biden|u\.s\.|uk|eu|china|russia|iran|israel)\b/i;

// If it has non-Latin script -> reject.
// If it hits tripwire heavily -> reject.
// Otherwise require some “English shape”: EN_COMMON OR a decent vowel ratio.
function looksEnglish(title) {
  const t = String(title || "").trim();
  if (!t) return false;
  if (NON_LATIN.test(t)) return false;

  // tripwire check
  const tw = t.match(NON_EN_TRIPWIRE);
  if (tw && tw.length >= 2) return false;

  // English common words OR vowel ratio
  if (EN_COMMON.test(t)) return true;

  // vowel ratio heuristic (helps headlines like “Zelenskyy meets…”)
  const letters = t.toLowerCase().replace(/[^a-z]/g, "");
  if (letters.length < 10) return false;
  const vowels = (letters.match(/[aeiouy]/g) || []).length;
  const ratio = vowels / letters.length;
  return ratio >= 0.28; // English tends to be ~0.35-0.45; this is forgiving
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
    scores[c.key] = Math.min(scores[c.key], CATEGORY_MAX);
  }
  return scores;
}

// Power-mean average (leans higher than plain average; avoids “2” when bars are hot)
function doomFromCategoryScores(catScores) {
  const p = 1.35; // >1 biases upward
  let sum = 0;
  let k = 0;
  for (const c of CATS) {
    const n = Math.min(1, (catScores[c.key] || 0) / CATEGORY_MAX);
    sum += Math.pow(n, p);
    k++;
  }
  const mean = k ? Math.pow(sum / k, 1 / p) : 0;
  return Math.round(mean * 100);
}

function doomLabelFor(score) {
  // Your exact ranges & copy
  if (score <= 20) return { label: "We’re so back.", tag: "Things are calm. Suspiciously calm. Enjoy it while it lasts." };
  if (score <= 40) return { label: "Mildly cursed timeline.", tag: "Nothing is technically broken, but the vibes are off." };
  if (score <= 60) return { label: "This is why aliens don’t visit.", tag: "Patterns are emerging. None of them are flattering to humanity." };
  if (score <= 80) return { label: "Please put your trays into their upright position, and fasten your seat belts.", tag: "Multiple systems are wobbling. Turbulence ahead." };
  if (score <= 95) return { label: "Apocalypse-adjacent.", tag: "Not the end of the world, but it’s definitely in the waiting room." };
  return { label: "Final Boss Week unlocked.", tag: "Everything is happening everywhere all at once. Do not check the news before bed." };
}

function barClass(pct) {
  if (pct < 34) return "green";
  if (pct < 67) return "yellow";
  if (pct < 85) return "red";
  return "fire";
}

// ---------- Fetch with timeout (prevents infinite Loading…) ----------
async function fetchJsonWithTimeout(url, ms = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    const text = await resp.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error("Upstream returned non-JSON");
    }
  } finally {
    clearTimeout(timer);
  }
}

// ---------- Build GDELT URL ----------
function buildGdeltUrl(query, timespan, maxrecords) {
  const u = new URL(`${PROXY_BASE}/${ROUTE}`);
  u.searchParams.set("format", "json");
  u.searchParams.set("mode", "ArtList");
  u.searchParams.set("maxrecords", String(maxrecords));
  u.searchParams.set("timespan", timespan);

  // GDELT-side English request (still imperfect; we do client-side too)
  u.searchParams.set("sourcelang", "English");

  // Query text
  u.searchParams.set("query", query);

  return u.toString();
}

// ---------- Render ----------
function renderBreakdown(catTotals) {
  let html = "";
  for (const c of CATS) {
    const val = catTotals[c.key] || 0;
    const pct = Math.max(0, Math.min(100, Math.round((val / CATEGORY_MAX) * 100)));
    const klass = barClass(pct);
    html += `
      <div class="breakItem">
        <div class="breakTop">
          <div>${escapeHtml(c.label)}</div>
          <div>${val}</div>
        </div>
        <div class="breakBar"><div class="fill ${klass}" style="width:${pct}%"></div></div>
      </div>
    `;
  }
  safeHTML(el.breakdown, html);
}

function renderDrivers(driverCounts) {
  const entries = Object.entries(driverCounts)
    .sort((a,b) => b[1] - a[1])
    .slice(0, 10)
    .map(([w]) => w);

  if (!entries.length) {
    safeHTML(el.drivers, `<div class="driverSub">No obvious drivers. Reality is being unusually polite.</div>`);
    return;
  }
  const pills = entries.map(w => `<span class="pill">${escapeHtml(w)}</span>`).join(" ");
  safeHTML(el.drivers, pills);
}

function renderStories(articles) {
  if (!articles.length) {
    safeHTML(el.stories, `<div class="driverSub">No stories found.</div>`);
    return;
  }
  const html = articles.slice(0, 20).map(a => {
    const title = a.title || "(untitled)";
    const domain = a.domain || "";
    const lang = a.language || "";
    const sc = a.sourcecountry || "";
    const url = a.url || "#";
    return `
      <a class="story" href="${escapeHtml(url)}" target="_blank" rel="noopener">
        <div class="storyTitle">${escapeHtml(title)}</div>
        <div class="storyMeta">${escapeHtml(domain)} • ${escapeHtml(lang)} • ${escapeHtml(sc)}</div>
      </a>
    `;
  }).join("");
  safeHTML(el.stories, html);
}

// ---------- Main ----------
async function run() {
  safeText(el.status, "Loading…");
  safeText(el.updated, "Updated: —");
  safeText(el.sample, "Sample: —");
  safeText(el.ver, VERSION);

  // Fetch attempt 1: DEFAULT_QUERY
  let query = DEFAULT_QUERY;
  let url = buildGdeltUrl(query, TIMESPAN, MAX_RECORDS);

  let data;
  let usedFallback = false;

  try {
    data = await fetchJsonWithTimeout(url, 12000);
  } catch (e) {
    // Try fallback query
    usedFallback = true;
    query = DEFAULT_QUERY_FALLBACK;
    url = buildGdeltUrl(query, TIMESPAN, MAX_RECORDS);
    data = await fetchJsonWithTimeout(url, 12000);
  }

  const raw = Array.isArray(data?.articles) ? data.articles : [];

  // English-only filtering (client-side)
  const english = raw.filter(a => looksEnglish(a.title));

  // If we still got too few, we *don’t* loosen to non-English.
  // Instead, we show what we have and explain counts.
  const usable = english.slice(0, 80);

  // Count info
  safeText(el.status, `Omens readable. (English: ${english.length} → ${usable.length})${usedFallback ? " (fallback)" : ""}`);
  safeText(el.updated, `Updated: ${nowStamp()}`);
  safeText(el.sample, `Sample: ${usable.length} headlines`);
  safeText(el.filterPill, "Filter: English ONLY / Global");
  safeText(el.okPill, "OK");

  // Aggregate scores
  const catTotals = {};
  for (const c of CATS) catTotals[c.key] = 0;

  const driverCounts = {};

  for (const a of usable) {
    const scores = scoreHeadline(a.title);
    for (const c of CATS) catTotals[c.key] = Math.min(CATEGORY_MAX, (catTotals[c.key] || 0) + Math.min(6, scores[c.key] || 0));

    // driver words: just keyword hits
    const t = String(a.title || "").toLowerCase();
    for (const c of CATS) {
      for (const kw of c.keywords) {
        if (t.includes(kw)) driverCounts[kw] = (driverCounts[kw] || 0) + 1;
      }
    }
  }

  // Doom number (average leaning higher)
  const doom = doomFromCategoryScores(catTotals);
  const label = doomLabelFor(doom);

  safeText(el.doomNum, doom);
  safeText(el.doomLabel, label.label);
  safeText(el.doomTag, label.tag);

  // Main meter fill
  const doomPct = Math.max(0, Math.min(100, doom));
  const klass = barClass(doomPct);
  if (el.doomFill) {
    el.doomFill.className = `fill ${klass}`;
    el.doomFill.style.width = `${doomPct}%`;
  }

  renderBreakdown(catTotals);
  renderDrivers(driverCounts);
  renderStories(usable);

  safeText(el.ver, VERSION);
}

function wire() {
  wireAbout();
  if (el.refresh) el.refresh.addEventListener("click", () => run().catch(e => showFatal("run()", e)));
}

// Boot
document.addEventListener("DOMContentLoaded", () => {
  try {
    wire();
    run().catch(e => showFatal("run()", e));
  } catch (e) {
    showFatal("boot", e);
  }
});
