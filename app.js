/* Doomroom News — app.js (v3.2.8)
   Fix:
   - If JS fails (syntax/runtime), the status pill shows the error (no DevTools needed).
   - Keeps your custom label/tag ranges.
   - Does NOT change your worker behavior or the scoring logic.
*/

const VERSION = "v3.2.8";

// Your worker
const PROXY_BASE = "https://doom-proxy.toddkirschman.workers.dev";
const ROUTE = "gdelt";

// Content knobs
const MAX_RECORDS = 80;
const TIMESPAN = "7d";

// Doom categories
const CATS = [
  { key: "conflict", label: "Conflict Heat", keywords: ["war","strike","attack","missile","drone","airstrike","invasion","ceasefire","shelling","hostage","terror","bomb","blast"] },
  { key: "climate", label: "Climate Weirdness", keywords: ["heat","wildfire","flood","hurricane","cyclone","storm","drought","evacuation","tornado","smoke"] },
  { key: "econ", label: "Economic Drama", keywords: ["inflation","layoff","crash","default","debt","tariff","shutdown","market","bank","recession","strike"] },
  { key: "democracy", label: "Democracy Melting", keywords: ["election","coup","protest","riot","authoritarian","fraud","ban","court","impeach","corruption","arrested","martial law"] },
  { key: "cyber", label: "Cyber Chaos", keywords: ["hack","breach","ransomware","outage","leak","cyber","malware","phishing","ddos"] },
  { key: "nuclear", label: "Unranium", keywords: ["nuclear","uranium","warhead","enrichment","icbm","radiation","reactor"] },
  { key: "space", label: "Space Rocks", keywords: ["asteroid","meteor","comet","space debris","nasa","impact","near-earth","solar flare"] },
  { key: "misc", label: "Misc. Chaos", keywords: ["panic","crisis","emergency","collapse","killed","dead","explosion","chaos","scandal"] }
];

// GDELT query (works well with the worker)
const DEFAULT_QUERY =
  "(war OR attack OR missile OR drone OR nuclear OR election OR protest OR coup OR inflation OR layoff OR ransomware OR breach OR wildfire OR flood OR hurricane)";

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

// ---------- Status helpers ----------
function setStatus(msg) { safeText(el.status, msg); }
function setUpdated(msg) { safeText(el.updated, `Updated: ${msg}`); }

function showFatal(where, err) {
  const msg = (err && err.message) ? err.message : String(err || "Unknown error");
  setStatus(`JS error (${where}): ${msg}`);
  setUpdated(nowStamp());
  // Keep UI from feeling dead
  safeText(el.okPill, "OK");
  safeText(el.sample, "Sample: 0 headlines");
  console.error(err);
}

// Catch unexpected errors and show them in the pill (super helpful on phones)
window.addEventListener("error", (e) => {
  try { showFatal("window.error", e.error || e.message); } catch {}
});
window.addEventListener("unhandledrejection", (e) => {
  try { showFatal("promise", e.reason); } catch {}
});

// ---------- About overlay ----------
function showAbout() { if (el.aboutOverlay) el.aboutOverlay.classList.remove("hidden"); }
function hideAbout() { if (el.aboutOverlay) el.aboutOverlay.classList.add("hidden"); }

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

// ✅ Your ranges
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

// Average doom normalization (keep your tuned value)
const REALISTIC_MAX_PER_HEADLINE = 24;

function computeOverallPct(totals, n) {
  const count = Math.max(1, n);
  const sum = Object.values(totals).reduce((a, b) => a + b, 0);
  const perHeadline = sum / count;

  return Math.max(0, Math.min(100, Math.round((perHeadline / REALISTIC_MAX_PER_HEADLINE) * 100)));
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
  const url = `${PROXY_BASE}/${ROUTE}?query=${q}&max=${max}&timespan=${span}`;
  return await fetchJSON(url);
}

// ---------- Render ----------
function renderBars(catTotals) {
  if (!el.breakdown) return;

  const rows = CATS.map(c => {
    const val = catTotals[c.key] || 0;
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
    const source = a.domain || "source unknown";
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
  safeText(el.okPill, "OK");
  safeText(el.filterPill, "Filter: English ONLY / Global");
  safeText(el.sample, "Sample: —");
  setUpdated(nowStamp());

  const data = await fetchViaWorker(query);
  const raw = Array.isArray(data) ? data : (data.articles || []);

  const list = raw
    .map(a => ({
      title: a?.title || "",
      url: a?.url || a?.url_mobile || "",
      domain: a?.domain || a?.source || "",
    }))
    .filter(a => a.title && a.url);

  safeText(el.sample, `Sample: ${list.length} headlines`);

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

  safeText(el.doomNum, String(doomPct));
  safeText(el.doomLabel, labelFromPct(doomPct));
  safeText(el.doomTag, tagFromPct(doomPct));

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

  const info = data?.doomProxy;
  if (info) {
    setStatus(`Omens readable. (English: ${info.englishFound ?? "?"} → ${info.returned ?? list.length})`);
  } else {
    setStatus(`Omens readable. (${list.length})`);
  }

  setUpdated(nowStamp());
}

function wireRefresh() {
  if (el.refresh) el.refresh.addEventListener("click", () => run(DEFAULT_QUERY));
}

// ---------- Boot ----------
function boot() {
  try {
    safeText(el.ver, VERSION);
    safeText(el.aboutVersion, VERSION);

    wireAbout();
    wireRefresh();

    // If you see this, JS is running:
    setStatus("Booting…");

    // Run with safety wrapper
    run(DEFAULT_QUERY).catch((err) => showFatal("run()", err));
  } catch (err) {
    showFatal("boot()", err);
  }
}

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
