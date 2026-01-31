/* Doomroom News — app.js (v3.2.9)
   Fixes in this build:
   - English-only that DOESN’T collapse to 2 articles:
     * Looser English hint requirement (>=1 hint word)
     * Blocks common non-English Latin headlines with "tripwire" words
     * Still blocks non-Latin scripts (Chinese/Cyrillic/Arabic/etc)
   - No fallback to non-English (English ONLY means English ONLY)
   - Better status pill debug (shows before→after counts)
*/

const VERSION = "v3.2.9";

// Your worker (keep as-is)
const PROXY_BASE = "https://doom-proxy.toddkirschman.workers.dev";
const ROUTE = "gdelt";

// Content knobs
const DEFAULT_QUERY = "world";
const MAX_RECORDS = 160;      // fetch more so English filter has room
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
  try { return new Date().toLocaleString(); }
  catch { return String(new Date()); }
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

// ---------- English-only filter (STRICT but not too strict) ----------
// Blocks non-Latin scripts, allows real English, blocks common non-English Latin headlines
const NON_LATIN = /[\u0400-\u04FF\u0500-\u052F\u0600-\u06FF\u0900-\u097F\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/;

// light English hint words (>=1 required)
const EN_HINT_WORDS = /\b(
  the|and|for|with|from|after|over|into|amid|ahead|says|said|new|as|on|in|at|to|of|is|are|was|were|will|may|could|should|
  u\.s\.|us|uk|eu|china|russia|iran|israel|court|police|army|government|minister|crisis|attack|war|deal|talks|vote|biden|trump
)\b/ix;

// non-English Latin “tripwire” words (Spanish/Portuguese/Indonesian patterns)
const NON_EN_TRIPWIRE = /\b(
  de|del|la|las|el|los|una|un|que|por|para|con|sin|sobre|entre|tras|desde|hasta|mundo|hielo|nieve|
  em|da|das|do|dos|uma|um|na|no|nos|nas|ao|aos|às|está|ser|teme|
  dan|yang|dari|untuk|pada|dengan|tanpa|ini|itu|akan|jadi|bisa|siap|ajukan
)\b/ix;

function countEnglishHints(t) {
  const m = String(t || "").toLowerCase().match(new RegExp(EN_HINT_WORDS.source, "g"));
  return m ? m.length : 0;
}

function keepEnglishStrict(title) {
  if (!title) return false;
  const t = String(title).trim();
  if (!t) return false;

  // Block Chinese/Cyrillic/Arabic/etc
  if (NON_LATIN.test(t)) return false;

  // Block common Spanish/Portuguese/Indonesian structures
  if (NON_EN_TRIPWIRE.test(t)) return false;

  // Looser ASCII ratio so real English headlines survive
  const asciiCount = (t.match(/[\x00-\x7F]/g) || []).length;
  const ratio = asciiCount / Math.max(1, t.length);
  if (ratio < 0.88) return false;

  // Allow a few accents/publisher junk without nuking English
  const nonAscii = (t.match(/[^\x00-\x7F]/g) || []).length;
  if (nonAscii > 8) return false;

  // Only require 1 English hint word now
  return countEnglishHints(t) >= 1;
}

// English ONLY means English ONLY
const ALLOW_FALLBACK = false;

// ---------- Utilities ----------
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
      source: String(a?.source || a?.publisher || a?.domain || a?.site || a?.sourceDomain || "").trim(),
      time: String(a?.time || a?.publishedAt || a?.published || a?.seendate || "").trim(),
      language: String(a?.language || "").trim()
    });
  }
  return out;
}

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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

function classFromPct(p) {
  if (p > 95) return "fire";
  if (p >= 81) return "red";
  if (p >= 41) return "yellow";
  return "green";
}

// Your custom labels + tag copy
function labelTagFromPct(p) {
  if (p <= 20) {
    return {
      label: "We’re so back.",
      tag: "Things are calm. Suspiciously calm. Enjoy it while it lasts."
    };
  }
  if (p <= 40) {
    return {
      label: "Mildly cursed timeline.",
      tag: "Nothing is technically broken, but the vibes are off."
    };
  }
  if (p <= 60) {
    return {
      label: "This is why aliens don’t visit.",
      tag: "Patterns are emerging. None of them are flattering to humanity."
    };
  }
  if (p <= 80) {
    return {
      label: "Fasten your seat belts.",
      tag: "Multiple systems are wobbling. Turbulence ahead."
    };
  }
  if (p <= 95) {
    return {
      label: "Apocalypse-adjacent.",
      tag: "Not the end of the world, but it’s definitely in the waiting room."
    };
  }
  return {
    label: "Final Boss Week unlocked.",
    tag: "Everything is happening everywhere all at once. Do not check the news before bed."
  };
}

// ---------- Doom % calculation (average leaning higher) ----------
// We compute a per-category % (0..100) based on a cap, then average them.
// Then apply a gentle "doom bias" curve so it leans higher when some bars are red.
function doomPercentFromTotals(totals) {
  const perCat = CATS.map(c => {
    const raw = totals[c.key] || 0;
    // Cap per-category at CATEGORY_MAX, convert to %
    const capped = Math.min(raw, CATEGORY_MAX);
    return Math.round((capped / CATEGORY_MAX) * 100);
  });

  const avg = perCat.reduce((a,b)=>a+b,0) / Math.max(1, perCat.length);

  // "Lean higher" curve: nudges mid/high values upward without instantly maxing out.
  // 0..100 -> 0..100
  const biased = Math.round(100 * (1 - Math.pow(1 - (avg / 100), 1.35)));

  return Math.max(0, Math.min(100, biased));
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

  // Worker supports passing any GDELT params through. We use "query" + format/mode defaults in worker.
  const urls = [
    `${PROXY_BASE}/${ROUTE}?query=${q}&maxrecords=${max}&timespan=${span}&format=json&mode=ArtList`,
    `${PROXY_BASE}/${ROUTE}?query=${q}&maxRecords=${max}&timespan=${span}&format=json&mode=ArtList`,
    `${PROXY_BASE}/${ROUTE}?query=${q}&max=${max}&timespan=${span}&format=json&mode=ArtList`
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
    // convert to percent for width (cap)
    const capped = Math.min(val, CATEGORY_MAX);
    const pct = Math.max(0, Math.min(100, Math.round((capped / CATEGORY_MAX) * 100)));
    const cls = classFromPct(pct);

    return `
      <div class="breakItem">
        <div class="breakTop">
          <div>${c.label}</div>
          <div>${val}</div>
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
      <a class="storyCard" href="${url}" target="_blank" rel="noopener noreferrer">
        <div class="storyTitle">${escapeHtml(title)}</div>
        <div class="storyMeta muted">${escapeHtml(source)} • English • Global</div>
      </a>
    `;
  }).join("");

  safeHTML(el.stories, cards);
}

// ---------- Main pipeline ----------
async function run(query = DEFAULT_QUERY) {
  setStatus("Reading the omens…");
  safeText(el.sample, "Sample: —");
  safeText(el.okPill, "OK");
  safeText(el.filterPill, "Filter: English ONLY / Global");

  try {
    const data = await fetchViaWorker(query);

    // Worker may return { articles: [...] } OR raw [...] or other keys
    const rawList =
      Array.isArray(data) ? data :
      (data.articles || data.items || data.results || data.data || data.entries || data.articles?.articles || []);

    let list = dedupeArticles(rawList);

    const before = list.length;

    // ENGLISH ONLY filter
    const englishKept = list.filter(a => keepEnglishStrict(a.title));
    const after = englishKept.length;

    if (after === 0 && !ALLOW_FALLBACK) {
      // show empty in a controlled way
      safeText(el.sample, `Sample: 0 headlines`);
      renderStories([]);
      renderDrivers([]);
      renderBars(Object.fromEntries(CATS.map(c => [c.key, 0])));

      safeText(el.doomNum, "0");
      const lt = labelTagFromPct(0);
      safeText(el.doomLabel, lt.label);
      safeText(el.doomTag, lt.tag);
      if (el.doomFill) {
        el.doomFill.className = "fill green";
        el.doomFill.style.width = `2%`;
      }

      setStatus(`No English headlines returned. (${before} → 0)`);
      setUpdated(nowStamp());
      return;
    }

    list = englishKept;

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

    // Doom percent from per-category average (leans higher)
    const doomPct = doomPercentFromTotals(totals);
    const doomCls = classFromPct(doomPct);
    const lt = labelTagFromPct(doomPct);

    safeText(el.doomNum, String(doomPct));
    safeText(el.doomLabel, lt.label);
    safeText(el.doomTag, lt.tag);

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

    setStatus(`Omens readable. (English: ${before} → ${after})`);
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
