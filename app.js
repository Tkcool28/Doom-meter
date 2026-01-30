/* Doomroom News — app.js (v3.1.9)
   Goal:
   - English only when possible
   - NEVER end up with 25→0 blank screen because heuristics guessed wrong

   Strategy:
   1) If article.language exists:
        - keep only en
        - drop non-en
   2) If language is missing (common):
        - use VERY LIGHT heuristic:
            - reject obvious non-latin scripts only
            - otherwise allow (because “english detection” is unreliable)
   3) If filtering results in 0:
        - show unfiltered list (but label it clearly)
*/

const VERSION = "v3.1.9";

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
function nowStamp() { try { return new Date().toLocaleString(); } catch { return String(new Date()); } }

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
    const title = String(a?.title || a?.headline || a?.name || "").trim();
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

// ---------- English filtering (safe, never blank) ----------
// Only hard-reject obvious non-latin scripts. Latin-language detection is unreliable without proper metadata.
const NON_LATIN = /[\u0400-\u04FF\u0500-\u052F\u0600-\u06FF\u0900-\u097F\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/;

function filterEnglishPreferred(list) {
  const withLang = list.filter(a => String(a.language || "").trim() !== "");
  const withoutLang = list.filter(a => String(a.language || "").trim() === "");

  // If language metadata exists, trust it strongly.
  const enFromLang = withLang.filter(a => {
    const l = String(a.language).trim().toLowerCase();
    return l === "en" || l.startsWith("en-");
  });

  // For items with no language: only reject obvious non-latin scripts.
  const latinOnly = withoutLang.filter(a => !NON_LATIN.test(String(a.title || "")));

  return {
    preferred: [...enFromLang, ...latinOnly],
    hadLangMeta: withLang.length > 0
  };
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
        <div class="storyMeta">${escapeHtml(source)} • ${escapeHtml(a.language || "—")} • Global</div>
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

    const raw = dedupeArticles(rawList);
    const before = raw.length;

    const { preferred, hadLangMeta } = filterEnglishPreferred(raw);

    // If preferred is empty, DO NOT BLANK THE APP. Show raw list and warn.
    let list = preferred;
    let filterNote = "English preferred / Global";

    if (list.length === 0 && raw.length > 0) {
      list = raw;
      filterNote = "Global (English filter unavailable)";
    } else if (hadLangMeta) {
      filterNote = "English only (by metadata) / Global";
    } else {
      filterNote = "English preferred (best-effort) / Global";
    }

    safeText(el.filterPill, `Filter: ${filterNote}`);

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

    setStatus(`Omens readable. (${before}→${after})`);
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

function wireRefresh() { el.refresh?.addEventListener("click", () => run(DEFAULT_QUERY)); }

window.addEventListener("DOMContentLoaded", () => {
  safeText(el.ver, VERSION);
  safeText(el.aboutVersion, VERSION);
  wireAbout();
  wireRefresh();
  run(DEFAULT_QUERY);
});
