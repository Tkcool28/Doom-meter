/*
 * Doomroom News — app.js
 * English-only fix:
 *  - DO NOT trust GDELT "language" field (often wrong)
 *  - Filter by title text (strict English heuristics)
 *  - Pill shows Strict English before→after
 */

const VERSION = "v3.3.0";

// Your worker
const PROXY_BASE = "https://doom-proxy.toddkirschman.workers.dev";
const ROUTE = "gdelt";

// Content knobs
const DEFAULT_QUERY = "world";
const MAX_RECORDS = 160;   // fetch more so English filter has room
const TIMESSPAN = "7d";

// Doom categories
const CATEGORY_MAX = 30;
const CATS = [
  { key: "conflict",  label: "Conflict Heat",     keywords: ["war","attack","missile","drone","strike","invasion","ceasefire","shelling","hostage","terror","bomb","blast"] },
  { key: "climate",   label: "Climate Weirdness", keywords: ["heat","wildfire","flood","hurricane","cyclone","storm","drought","evacuation","tornado","smoke","record heat","blaze"] },
  { key: "economy",   label: "Economic Drama",    keywords: ["inflation","layoff","crash","default","debt","tariff","shutdown","market","bank","recession","strike"] },
  { key: "democracy", label: "Democracy Melting", keywords: ["election","coup","protest","riot","authoritarian","fraud","ban","court","impeach","corruption","arrested","martial law"] },
  { key: "cyber",     label: "Cyber Chaos",       keywords: ["hack","breach","ransomware","outage","leak","cyber","malware","phishing","ddos"] },
  { key: "nuclear",   label: "Uranium",           keywords: ["nuclear","uranium","warhead","enrichment","icbm","radiation","reactor"] },
  { key: "space",     label: "Space Rocks",       keywords: ["asteroid","meteor","comet","space debris","nasa","impact","near-earth"] },
  { key: "misc",      label: "Misc. Chaos",       keywords: ["panic","crisis","emergency","collapse","killed","dead","explosion","chaos","scandal"] },
];

// Default query (works well with the worker)
const DEFAULT_Q =
  "war OR attack OR missile OR drone OR nuclear OR election OR protest OR coup OR inflation OR layoff OR ransomware OR breach OR wildfire OR flood OR hurricane";

// ---------- DOM helpers ----------
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
function safeHtml(node, html) {
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

// =========================================================
// ✅ ENGLISH-ONLY FIX (DO NOT TRUST GDELT "language")
// =========================================================

// Reject anything with non-Latin scripts (CJK/Cyrillic/Arabic etc)
const NON_LATIN =
  /[\u0400-\u04FF\u0500-\u052F\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\u0900-\u097F\u0E00-\u0E7F\u1100-\u11FF\u2E80-\u2EFF\u2F00-\u2FDF\u3040-\u30FF\u31F0-\u31FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF]/;

// Require >=2 common English words
const EN_COMMON_WORDS =
  /\b(the|and|of|to|in|for|on|with|as|by|from|at|after|before|over|under|into|out|about|near|amid|says|say|warns|new|plan|plans|report|reports|deal|talks|vote|war|attack|strike|missile|drone|election|court|police|government|minister|crisis)\b/gi;

// Non-English Latin “tripwire” words (Portuguese/Spanish/Indonesian/etc)
const NON_EN_TRIPWIRE = /\b(
  da|de|do|dos|das|uma|um|ao|aos|na|nas|no|nos|para|por|porque|entre|contra|sobre|mais|menos|tambem|entao|sao|foi|ser|tem|
  que|seu|sua|seus|suas|mundo|melhor|assassinad[ao]|denuncia|delegad[oa]|
  yang|dan|di|ke|dari|untuk|pada|ini|itu|atau|kami|kamu|mereka|bisa|siap|ajukan|diri|sebagai|tuan|rumah|piala|dunia|batal|begini|kata|pakar|
  el|la|los|las|una|un|del|al|por|para|con|como|pero|porque|mundo|
  le|la|les|des|une|un|du|au|aux|pour|avec|dans|sur
)\b/ix;

function asciiLetterRatio(s) {
  const letters = (s.match(/[A-Za-z]/g) || []).length;
  const nonAscii = (s.match(/[^\x00-\x7F]/g) || []).length;
  const total = letters + nonAscii;
  if (!total) return 0;
  return letters / total;
}

function isStrictEnglishTitle(title) {
  const t = String(title || "").trim();
  if (!t) return false;

  if (NON_LATIN.test(t)) return false;

  const lower = t.toLowerCase();
  if (NON_EN_TRIPWIRE.test(lower)) return false;

  const hits = (lower.match(EN_COMMON_WORDS) || []).length;
  if (hits < 2) return false;

  if (asciiLetterRatio(t) < 0.85) return false;

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
    scores[c.key] = Math.min(scores[c.key], 12);
  }
  return scores;
}

function colorClassForDoom(n) {
  if (n >= 80) return "fire";
  if (n >= 55) return "red";
  if (n >= 30) return "yellow";
  return "green";
}

// Your 0–100 labels (kept)
function labelForDoom(n) {
  if (n <= 20) return { label: "We’re so back.", tag: "Things are calm. Suspiciously calm. Enjoy it while it lasts." };
  if (n <= 40) return { label: "Mildly cursed timeline.", tag: "Nothing is technically broken, but the vibes are off." };
  if (n <= 60) return { label: "This is why aliens don’t visit.", tag: "Patterns are emerging. None of them are flattering to humanity." };
  if (n <= 80) return { label: "Please fasten your seat belts.", tag: "Multiple systems are wobbling. Turbulence ahead." };
  if (n <= 95) return { label: "Apocalypse-adjacent.", tag: "Not the end of the world, but it’s definitely in the waiting room." };
  return { label: "Final Boss Week unlocked.", tag: "Everything is happening everywhere all at once. Do not check the news before bed." };
}

// ---------- Render helpers ----------
function renderBreakdown(catTotals) {
  if (!el.breakdown) return;

  const maxVal = Math.max(1, ...Object.values(catTotals));
  const rows = CATS.map((c) => {
    const v = catTotals[c.key] || 0;
    const pct = Math.max(0, Math.min(100, Math.round((v / maxVal) * 100)));
    const cls = v >= 70 ? "fire" : v >= 40 ? "red" : v >= 20 ? "yellow" : "green";
    return `
      <div class="breakItem">
        <div class="breakTop">
          <div>${escapeHtml(c.label)}</div>
          <div class="muted">${v}</div>
        </div>
        <div class="breakBar"><div class="fill ${cls}" style="width:${pct}%"></div></div>
      </div>
    `;
  }).join("");

  safeHtml(el.breakdown, rows);
}

function renderDrivers(topDrivers) {
  if (!el.drivers) return;
  if (!topDrivers.length) {
    safeHtml(el.drivers, `<div class="driverSub">No obvious drivers. Reality is being unusually polite.</div>`);
    return;
  }
  const pills = topDrivers.map(w => `<span class="pill">${escapeHtml(w)}</span>`).join(" ");
  safeHtml(el.drivers, pills);
}

function renderStories(articles) {
  if (!el.stories) return;
  if (!articles.length) {
    safeHtml(el.stories, `<div class="driverSub">No stories found.</div>`);
    return;
  }

  const html = articles.slice(0, 25).map((a) => {
    const title = a.title || "(untitled)";
    const url = a.url || "#";
    const dom = a.domain || "";
    const lang = a.language || "";
    const cc = a.sourcecountry || "";
    return `
      <a class="story" href="${escapeHtml(url)}" target="_blank" rel="noopener">
        <div class="storyTitle">${escapeHtml(title)}</div>
        <div class="storyMeta">${escapeHtml(dom)}${lang ? " • " + escapeHtml(lang) : ""}${cc ? " • " + escapeHtml(cc) : ""}</div>
      </a>
    `;
  }).join("");

  safeHtml(el.stories, html);
}

// ---------- Fetch ----------
async function fetchGdelt(query) {
  const u = new URL(`${PROXY_BASE}/${ROUTE}`);
  u.searchParams.set("format", "json");
  u.searchParams.set("mode", "ArtList");
  u.searchParams.set("maxrecords", String(MAX_RECORDS));
  u.searchParams.set("timespan", TIMESSPAN);
  u.searchParams.set("query", query || DEFAULT_Q);

  // tiny cache-buster
  u.searchParams.set("_", String(Date.now()));

  const resp = await fetch(u.toString(), { method: "GET" });
  const data = await resp.json();
  return data;
}

// ---------- Main run ----------
async function run() {
  safeText(el.updated, "Updated: —");
  safeText(el.status, "Loading…");
  safeText(el.sample, "Sample: —");
  safeText(el.ver, VERSION);
  safeText(el.filterPill, "Filter: English ONLY / Global");
  if (el.okPill) el.okPill.textContent = "OK";

  // Clear old content
  if (el.breakdown) safeHtml(el.breakdown, "");
  if (el.drivers) safeHtml(el.drivers, "");
  if (el.stories) safeHtml(el.stories, "");

  // Skeleton values
  safeText(el.doomNum, "—");
  safeText(el.doomLabel, "—");
  safeText(el.doomTag, "—");
  if (el.doomFill) el.doomFill.style.width = "0%";

  let data;
  try {
    data = await fetchGdelt(DEFAULT_Q);
  } catch (e) {
    safeText(el.status, "Fetch failed.");
    safeText(el.updated, `Updated: ${nowStamp()}`);
    return;
  }

  const articles = Array.isArray(data?.articles) ? data.articles : [];
  const before = articles.length;

  // ✅ Strict English filtering by TITLE (not by a.language)
  let strictEnglish = articles.filter(a => isStrictEnglishTitle(a?.title));

  // de-dupe by title
  const seen = new Set();
  strictEnglish = strictEnglish.filter(a => {
    const key = String(a?.title || "").trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const after = strictEnglish.length;

  safeText(el.status, `Omens readable. (Strict English: ${before} → ${after})`);
  safeText(el.sample, `Sample: ${after} headlines`);
  safeText(el.updated, `Updated: ${nowStamp()}`);
  safeText(el.ver, VERSION);

  // If nothing, render empty state
  if (!after) {
    const doom = 0;
    const meta = labelForDoom(doom);
    safeText(el.doomNum, doom);
    safeText(el.doomLabel, meta.label);
    safeText(el.doomTag, meta.tag);
    if (el.doomFill) {
      el.doomFill.className = `fill ${colorClassForDoom(doom)}`;
      el.doomFill.style.width = "2px";
    }
    renderBreakdown(Object.fromEntries(CATS.map(c => [c.key, 0])));
    renderDrivers([]);
    renderStories([]);
    return;
  }

  // Score & aggregate
  const catTotals = Object.fromEntries(CATS.map(c => [c.key, 0]));
  const driverCounts = new Map();

  let totalPerArticle = 0;

  for (const a of strictEnglish) {
    const title = a.title || "";
    const s = scoreHeadline(title);

    // category totals
    let per = 0;
    for (const c of CATS) {
      catTotals[c.key] += s[c.key];
      per += s[c.key];
      // driver tokens: count keywords that matched
      for (const kw of c.keywords) {
        if (title.toLowerCase().includes(kw)) {
          driverCounts.set(kw, (driverCounts.get(kw) || 0) + 1);
        }
      }
    }
    // cap per article so one headline doesn't explode doom
    per = Math.min(per, CATEGORY_MAX);
    totalPerArticle += per;
  }

  // Convert to 0–100 doom index
  const avg = totalPerArticle / strictEnglish.length;         // 0..CATEGORY_MAX
  const doom = Math.max(0, Math.min(100, Math.round((avg / CATEGORY_MAX) * 100)));

  const meta = labelForDoom(doom);
  safeText(el.doomNum, doom);
  safeText(el.doomLabel, meta.label);
  safeText(el.doomTag, meta.tag);

  if (el.doomFill) {
    el.doomFill.className = `fill ${colorClassForDoom(doom)}`;
    el.doomFill.style.width = `${Math.max(2, doom)}%`;
  }

  // Render breakdown
  renderBreakdown(catTotals);

  // Top drivers
  const topDrivers = [...driverCounts.entries()]
    .sort((a,b) => b[1] - a[1])
    .slice(0, 8)
    .map(([kw]) => kw);

  renderDrivers(topDrivers);

  // Stories
  renderStories(strictEnglish);
}

function wireUI() {
  if (el.refresh) el.refresh.addEventListener("click", run);
}

// Init
(function init() {
  wireUI();
  wireAbout();
  safeText(el.ver, VERSION);
  run();
})();
