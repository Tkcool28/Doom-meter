/* Doomroom News — app.js (v3.2.8)
   ONLY CHANGE:
   - Strong English-only filter that blocks non-English Latin headlines (Spanish/Portuguese/Indonesian)
   - Fallback to non-English is DISABLED (English only means English only)

   Everything else stays the same style/behavior.
*/

const VERSION = "v3.2.8";

// Your worker (keep as-is)
const PROXY_BASE = "https://doom-proxy.toddkirschman.workers.dev";
const ROUTE = "gdelt";

// Content knobs
const DEFAULT_QUERY = "world";
const MAX_RECORDS = 80;
const TIMESPAN = "7d";

// Doom categories
const CATEGORY_MAX = 30;
const CATS = [
  { key: "conflict", label: "Conflict Heat", keywords: ["war","strike","attack","missile","drone","airstrike","invasion","ceasefire","shelling","hostage","terror","bomb","blast"] },
  { key: "climate", label: "Climate Weirdness", keywords: ["heat","wildfire","flood","hurricane","cyclone","storm","drought","record heat","evacuation","blaze","tornado","smoke"] },
  { key: "econ", label: "Economic Drama", keywords: ["inflation","layoff","crash","default","debt","tariff","shutdown","market","bank","recession","strike"] },
  { key: "democracy", label: "Democracy Melting", keywords: ["election","coup","protest","riot","authoritarian","fraud","ban","court","impeach","corruption","arrested","martial law"] },
  { key: "cyber", label: "Cyber Chaos", keywords: ["hack","breach","ransomware","outage","leak","cyber","malware","phishing","ddos"] },
  { key: "nuclear", label: "Uranium", keywords: ["nuclear","uranium","warhead","enrichment","icbm","radiation","reactor"] },
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
  try {
    return new Date().toLocaleString();
  } catch {
    return String(new Date());
  }
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

  // Tap backdrop closes too
  if (el.aboutOverlay) {
    el.aboutOverlay.addEventListener("click", (e) => {
      if (e.target === el.aboutOverlay) hideAbout();
    });
  }
}

// ---------- English filtering (STRICT) ----------
// Blocks non-English even if it uses Latin letters.
// Also blocks non-Latin scripts (Chinese/Cyrillic/Arabic/etc).
const NON_LATIN = /[\u0400-\u04FF\u0500-\u052F\u0600-\u06FF\u0900-\u097F\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/;

// Expanded English hint words (stopwords + common news words)
const EN_HINT_WORDS = /\b(the|and|for|with|from|after|over|into|amid|ahead|says|said|new|as|on|in|at|to|of|is|are|was|were|will|may|could|should|u\.s\.|us|uk|eu|china|russia|iran|israel|biden|trump|court|police|army|government|minister|crisis|attack|war)\b/i;

// Count all occurrences (not just one)
function countEnglishHints(t) {
  const all = String(t || "").toLowerCase().match(new RegExp(EN_HINT_WORDS.source, "g"));
  return all ? all.length : 0;
}

// STRICT English:
// - reject non-Latin scripts
// - require high ASCII ratio
// - reject too many accented characters
// - require at least 2 English hint words
function keepEnglishStrict(title) {
  if (!title) return false;
  const t = String(title).trim();
  if (!t) return false;

  // Blocks Chinese/Cyrillic/Arabic/etc.
  if (NON_LATIN.test(t)) return false;

  // ASCII ratio check (Spanish/Portuguese/Indonesian often pass ASCII, so we also do hint + accents)
  const asciiCount = (t.match(/[\x00-\x7F]/g) || []).length;
  const ratio = asciiCount / Math.max(1, t.length);
  if (ratio < 0.94) return false;

  // Reject “too many” accented / non-ASCII chars (é, ñ, Ê etc.)
  const nonAscii = (t.match(/[^\x00-\x7F]/g) || []).length;
  if (nonAscii > 2) return false;

  // Must contain multiple English hint words
  return countEnglishHints(t) >= 2;
}

// Fallback is DISABLED for English-only mode.
const ALLOW_FALLBACK = false;

// If you ever turn fallback on, this only blocks non-Latin scripts (will allow Spanish etc.)
function keepEnglishFallback(title) {
  if (!title) return false;
  const t = String(title).trim();
  if (!t) return false;
  if (NON_LATIN.test(t)) return false;
  return true;
}

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
      language: String(a?.language || "").trim()
    });
  }
  return out;
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
    scores[c.key] = Math.min(scores[c.key], 12);
  }
  return scores;
}

function pctFromScore(score) {
  return Math.max(0, Math.min(100, Math.round((score / CATEGORY_MAX) * 100)));
}

function classFromPct(p) {
  if (p > 90) return "fire";
  if (p >= 80) return "red";
  if (p >= 35) return "yellow";
  return "green";
}

// Your custom copy (ranges you provided)
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

// ---------- Fetch with fallback ----------
async function fetchJSON(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

async function fetchViaWorker(query) {
  const q = encodeURIComponent(query);
  const max = encodeURIComponent(String(MAX_RECORDS));
  const span = encodeURIComponent(TIMESPAN);

  // Try common param names (your worker forwards params)
  const urls = [
    `${PROXY_BASE}/${ROUTE}?query=${q}&maxrecords=${max}&timespan=${span}&format=json&mode=ArtList`,
    `${PROXY_BASE}/${ROUTE}?query=${q}&max=${max}&timespan=${span}`,
    `${PROXY_BASE}/${ROUTE}?q=${q}&max=${max}&timespan=${span}`,
    `${PROXY_BASE}/${ROUTE}?g=${q}&max=${max}&timespan=${span}`
  ];

  let lastErr = null;
  for (const u of urls) {
    try { return await fetchJSON(u); }
    catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("Worker fetch failed");
}

// ---------- Render ----------
function setStatus(msg) { safeText(el.status, msg); }
function setUpdated(msg) { safeText(el.updated, `Updated: ${msg}`); }

function renderBars(catTotals) {
  if (!el.breakdown) return;

  const rows = CATS.map(c => {
    const val = catTotals[c.key] || 0;
    const pct = pctFromScore(val);
    const cls = classFromPct(pct);
    return `
      <div class="breakItem">
        <div class="breakTop">
          <div>${escapeHtml(c.label)}</div>
          <div>${val}</div>
        </div>
        <div class="breakBar"><div class="fill ${cls}" style="width:${pct}%"></div></div>
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
        <div class="storyMeta muted">${escapeHtml(source)} • English • Global</div>
      </a>
    `;
  }).join("");

  safeHTML(el.stories, cards);
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
  safeText(el.filterPill, "Filter: English ONLY / Global");

  try {
    const data = await fetchViaWorker(query);

    const rawList =
      Array.isArray(data) ? data :
      (data.articles || data.items || data.results || data.data || data.entries || []);

    let list = dedupeArticles(rawList);
    const before = list.length;

    // STRICT English filter
    let strict = list.filter(a => keepEnglishStrict(a.title));
    const afterStrict = strict.length;

    // Optional fallback (disabled)
    if (ALLOW_FALLBACK && afterStrict === 0 && before > 0) {
      strict = list.filter(a => keepEnglishFallback(a.title));
      safeText(el.filterPill, "Filter: Global (English filter unavailable)");
      setStatus(`Omens readable. (${before}→${strict.length}) (fallback)`);
    } else {
      setStatus(`Omens readable. (English: ${before} → ${afterStrict})`);
    }

    list = strict;

    safeText(el.sample, `Sample: ${list.length} headlines`);

    // Score doom
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

    // Doom score (average-ish, not maxed all day)
    // Compute per-category pct, then average them (leans higher naturally when multiple categories spike)
    const catPcts = CATS.map(c => pctFromScore(totals[c.key] || 0));
    const doomPct = Math.round(catPcts.reduce((a,b)=>a+b,0) / Math.max(1, catPcts.length));
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

    renderBars(totals);

    const driverCounts = {};
    for (const k of keywordHits) driverCounts[k] = (driverCounts[k] || 0) + 1;
    const topDrivers = Object.entries(driverCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([k]) => k);

    renderDrivers(topDrivers);
    renderStories(list.slice(0, 12));

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
