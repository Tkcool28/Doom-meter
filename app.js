/* Doomroom News — app.js (v3.2.2)
   Fixes:
   - Builds a "doom query" so GDELT results match your doom keywords (not random stuff)
   - Bars ALWAYS render (uses your existing DOM IDs)
   - Uses worker for English filtering; also blocks obvious non-Latin scripts as safety net
   - Better “what happened” status text
*/

const VERSION = "v3.2.2";

// ✅ Your worker
const PROXY_BASE = "https://doom-proxy.toddkirschman.workers.dev";
const ROUTE = "gdelt";

// Content knobs
const MAX_RECORDS = 80;
const TIMESPAN = "7d";

// Doom categories
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
  try { return new Date().toLocaleString(); } catch { return String(new Date()); }
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
function showAbout() { el.aboutOverlay?.classList.remove("hidden"); }
function hideAbout() { el.aboutOverlay?.classList.add("hidden"); }

function wireAbout() {
  el.about?.addEventListener("click", showAbout);
  el.closeAbout?.addEventListener("click", hideAbout);
  el.closeAbout2?.addEventListener("click", hideAbout);
  el.aboutOverlay?.addEventListener("click", (e) => {
    if (e.target === el.aboutOverlay) hideAbout();
  });
}

// ---------- English safety net (worker already filters, this blocks obvious non-Latin) ----------
const NON_LATIN = /[\u0400-\u04FF\u0500-\u052F\u0600-\u06FF\u0900-\u097F\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/;
function keepEnglishish(title) {
  const t = String(title || "").trim();
  if (!t) return false;
  if (NON_LATIN.test(t)) return false;
  return true;
}

// ---------- Build a "doom query" so results match your doom keywords ----------
function buildDoomQuery() {
  // Unique keywords across all categories
  const set = new Set();
  for (const c of CATS) for (const k of c.keywords) set.add(k);

  // Keep it a reasonable size (GDELT queries can be touchy).
  // Pick up to 24 strongest terms.
  const words = Array.from(set).slice(0, 24);

  // OR query: (war OR attack OR inflation ...)
  return "(" + words.map(w => `"${w}"`).join(" OR ") + ")";
}

const DEFAULT_QUERY = buildDoomQuery();

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

// Normalize doom % by “per article max”
function computeOverallPct(totals, articleCount) {
  const n = Math.max(1, articleCount);
  const sum = Object.values(totals).reduce((a, b) => a + b, 0);
  const perArticle = sum / n;

  const maxPerArticle = CATS.length * 12; // each category max 12 in our scoring
  return Math.max(0, Math.min(100, Math.round((perArticle / maxPerArticle) * 100)));
}

// ---------- Fetch ----------
async function fetchJSON(u) {
  const res = await fetch(u, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

async function fetchViaWorker(query) {
  const q = encodeURIComponent(query);
  const max = encodeURIComponent(String(MAX_RECORDS));
  const span = encodeURIComponent(TIMESPAN);

  // Worker supports max + timespan + query
  const url = `${PROXY_BASE}/${ROUTE}?query=${q}&max=${max}&timespan=${span}`;
  return await fetchJSON(url);
}

// ---------- Render ----------
function setStatus(msg) { safeText(el.status, msg); }
function setUpdated(msg) { safeText(el.updated, `Updated: ${msg}`); }

function renderBars(catTotals) {
  if (!el.breakdown) return;

  // Uses your existing markup structure used by your CSS: breakItem / breakBar / fill
  const rows = CATS.map(c => {
    const val = catTotals[c.key] || 0;

    // Convert totals -> percent using a soft cap (keeps bars visible)
    // This avoids “everything looks empty” when totals are small.
    const pct = Math.max(0, Math.min(100, Math.round((val / 30) * 100)));
    const cls = classFromPct(pct);

    return `
      <div class="breakItem">
        <div class="breakTop">
          <div>${escapeHtml(c.label)}</div>
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
    const source = a.domain || a.source || "source unknown";
    const title = a.title || "(untitled)";
    const url = a.url || a.url_mobile || "#";

    return `
      <a class="storyCard" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">
        <div class="storyTitle">${escapeHtml(title)}</div>
        <div class="storyMeta muted">${escapeHtml(source)} • English • Global</div>
      </a>
    `;
  }).join("");

  safeHTML(el.stories, cards);
}

// ---------- Main ----------
async function run(query = DEFAULT_QUERY) {
  setStatus("Reading the omens…");
  safeText(el.sample, "Sample: —");
  safeText(el.okPill, "OK");
  safeText(el.filterPill, "Filter: English ONLY / Global");

  try {
    const data = await fetchViaWorker(query);

    // Worker returns { articles: [...] }
    const raw = Array.isArray(data) ? data : (data.articles || []);
    const listAll = raw
      .map(a => ({
        title: a?.title || "",
        url: a?.url || a?.url_mobile || "",
        domain: a?.domain || "",
        language: a?.language || ""
      }))
      .filter(a => a.title && a.url);

    // Safety net: block obvious non-Latin (worker already tries)
    const list = listAll.filter(a => keepEnglishish(a.title));

    safeText(el.sample, `Sample: ${list.length} headlines`);

    // Doom totals
    const totals = {};
    for (const c of CATS) totals[c.key] = 0;

    const keywordHits = [];
    for (const a of list) {
      const scores = scoreHeadline(a.title);
      for (const c of CATS) totals[c.key] += scores[c.key];

      const t = a.title.toLowerCase();
      for (const c of CATS) {
        for (const kw of c.keywords) {
          if (t.includes(kw)) keywordHits.push(kw);
        }
      }
    }

    const doomPct = computeOverallPct(totals, list.length);
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

    // Drivers
    const driverCounts = {};
    for (const k of keywordHits) driverCounts[k] = (driverCounts[k] || 0) + 1;
    const topDrivers = Object.entries(driverCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([k]) => k);

    renderDrivers(topDrivers);
    renderStories(list.slice(0, 12));

    // Status
    const proxyInfo = data?.doomProxy;
    if (proxyInfo && typeof proxyInfo === "object") {
      const eng = proxyInfo.englishFound ?? "?";
      const ret = proxyInfo.returned ?? list.length;
      setStatus(`Omens readable. (English ${eng} → ${ret})`);
    } else {
      setStatus(`Omens readable. (${list.length})`);
    }

    setUpdated(nowStamp());
    safeText(el.okPill, "OK");

  } catch (err) {
    const msg = err?.message ? err.message : String(err);
    setStatus(`Omen failure: ${msg}`);
    setUpdated(nowStamp());
    safeText(el.sample, "Sample: 0 headlines");
    renderStories([]);
    renderDrivers([]);
    renderBars(Object.fromEntries(CATS.map(c => [c.key, 0])));
    console.error(err);
  }
}

function wireRefresh() {
  el.refresh?.addEventListener("click", () => run(DEFAULT_QUERY));
}

// ---------- Boot ----------
window.addEventListener("DOMContentLoaded", () => {
  safeText(el.ver, VERSION);
  safeText(el.aboutVersion, VERSION);

  wireAbout();
  wireRefresh();
  run(DEFAULT_QUERY);
});
