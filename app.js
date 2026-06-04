/*
 * Doomroom News — app.js
 * English-only fix:
 *  - DO NOT trust GDELT "language" field (often wrong)
 *  - Filter by title text (strict English heuristics)
 *  - Pill shows Strict English before→after
 */

const VERSION = "v3.4.7-local";

// Your worker
const PROXY_BASE = "https://doom-proxy.toddkirschman.workers.dev";
const ROUTE = "gdelt";

// Content knobs
const DEFAULT_QUERY = "world";
const MAX_RECORDS = 25;    // tiny, polite pulls; this joke app only needs a few omens
const TIMESSPAN = "7d";

// Doom categories
const CATEGORY_MAX = 30;
const CATS = [
  { key: "conflict",  icon: "⚔️", label: "Conflict Heat",     keywords: ["war","attack","missile","drone","strike","invasion","ceasefire","shelling","hostage","terror","bomb","blast"] },
  { key: "climate",   icon: "🌪️", label: "Climate Weirdness", keywords: ["heat","wildfire","flood","hurricane","cyclone","storm","drought","evacuation","tornado","smoke","record heat","blaze"] },
  { key: "economy",   icon: "📉", label: "Economic Drama",    keywords: ["inflation","layoff","crash","default","debt","tariff","shutdown","market","bank","recession","strike"] },
  { key: "democracy", icon: "🏛️", label: "Democracy Melting", keywords: ["election","coup","protest","riot","authoritarian","fraud","ban","court","impeach","corruption","arrested","martial law"] },
  { key: "cyber",     icon: "👾", label: "Cyber Gremlins",     keywords: ["hack","breach","ransomware","outage","leak","cyber","malware","phishing","ddos"] },
  { key: "nuclear",   icon: "☢️", label: "Uranium Mood Ring", keywords: ["nuclear","uranium","warhead","enrichment","icbm","radiation","reactor"] },
  { key: "space",     icon: "☄️", label: "Space Rocks",       keywords: ["asteroid","meteor","comet","space debris","nasa","impact","near-earth"] },
  { key: "misc",      icon: "🫠", label: "Misc. Chaos",       keywords: ["panic","crisis","emergency","collapse","killed","dead","explosion","chaos","scandal"] },
];

// Default query (works well with the worker)
const DEFAULT_Q =
  "(war OR attack OR missile OR drone OR nuclear OR election OR protest OR coup OR inflation OR layoff OR ransomware OR breach OR wildfire OR flood OR hurricane)";

const DEMO_ARTICLES = [
  { title: "NASA tracks near-earth asteroid as officials say impact risk remains low", url: "#demo-space-rocks", domain: "demo.doomroom", language: "English", sourcecountry: "US" },
  { title: "Nuclear talks resume after missile attack raises war fears", url: "#demo-uranium", domain: "demo.doomroom", language: "English", sourcecountry: "GB" },
  { title: "Wildfire smoke spreads over cities as heat warnings expand", url: "#demo-climate", domain: "demo.doomroom", language: "English", sourcecountry: "CA" },
  { title: "Ransomware attack causes hospital outage and data breach concerns", url: "#demo-cyber", domain: "demo.doomroom", language: "English", sourcecountry: "US" },
  { title: "Election court ruling sparks protest as corruption claims grow", url: "#demo-democracy", domain: "demo.doomroom", language: "English", sourcecountry: "AU" },
  { title: "Markets slide after inflation report and bank debt worries", url: "#demo-economy", domain: "demo.doomroom", language: "English", sourcecountry: "US" },
  { title: "Meteor shower delights skywatchers because space rocks can be wholesome actually", url: "#demo-wholesome-rocks", domain: "demo.doomroom", language: "English", sourcecountry: "NZ" },
  { title: "Drone strike and ceasefire talks dominate world briefing", url: "#demo-conflict", domain: "demo.doomroom", language: "English", sourcecountry: "IE" }
];

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
// JavaScript regexes do not support /x free-spacing mode, so keep this readable as data.
const NON_EN_TRIPWIRE_WORDS = [
  "da", "de", "do", "dos", "das", "uma", "um", "ao", "aos", "na", "nas", "no", "nos", "para", "por", "porque", "entre", "contra", "sobre", "mais", "menos", "tambem", "entao", "sao", "foi", "ser", "tem",
  "que", "seu", "sua", "seus", "suas", "mundo", "melhor", "denuncia",
  "yang", "dan", "di", "ke", "dari", "untuk", "pada", "ini", "itu", "atau", "kami", "kamu", "mereka", "bisa", "siap", "ajukan", "diri", "sebagai", "tuan", "rumah", "piala", "dunia", "batal", "begini", "kata", "pakar",
  "el", "la", "los", "las", "una", "un", "del", "al", "con", "como", "pero",
  "le", "les", "des", "une", "du", "au", "aux", "pour", "avec", "dans", "sur"
];
const NON_EN_TRIPWIRE = new RegExp(`\\b(${NON_EN_TRIPWIRE_WORDS.join("|")}|assassinad[ao]|delegad[oa])\\b`, "i");

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
  if (n <= 20) return { label: "We’re so back.", tag: "The apocalypse hit snooze. Suspicious, but we accept gifts." };
  if (n <= 40) return { label: "Mildly cursed timeline.", tag: "The vibes are wearing one sock and calling it fashion." };
  if (n <= 60) return { label: "Aliens left us on read.", tag: "Humanity is doing group-project energy again." };
  if (n <= 80) return { label: "Seatbelts, bestie.", tag: "Multiple systems are wobbling like a shopping cart with one cursed wheel." };
  if (n <= 95) return { label: "Apocalypse-adjacent.", tag: "Not the end of the world, but the world is absolutely subtweeting us." };
  return { label: "Final Boss Week unlocked.", tag: "Everything everywhere all at once, but somehow with worse patch notes." };
}

function scoreArticle(a) {
  const scores = scoreHeadline(a?.title || "");
  return Math.min(CATEGORY_MAX, Object.values(scores).reduce((sum, v) => sum + v, 0));
}

function severityForScore(score) {
  if (score >= 18) return "unhinged";
  if (score >= 10) return "spicy";
  if (score >= 4) return "sus";
  return "meh";
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
      <div class="breakItem ${cls}">
        <div class="breakTop">
          <div class="breakName"><span class="catIcon" aria-hidden="true">${escapeHtml(c.icon || "◇")}</span><span>${escapeHtml(c.label)}</span></div>
          <div class="breakScore">${v}</div>
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
    const articleScore = scoreArticle(a);
    const severity = severityForScore(articleScore);
    return `
      <a class="story ${severity}" href="${escapeHtml(url)}" target="_blank" rel="noopener">
        <div class="storyKicker">
          <span class="storyBadge">${escapeHtml(severity.toUpperCase())}</span>
          <span class="storyScore">+${articleScore} doom</span>
        </div>
        <div class="storyTitle">${escapeHtml(title)}</div>
        <div class="storyMeta">${escapeHtml(dom || "unknown source")}${lang ? " • " + escapeHtml(lang) : ""}${cc ? " • " + escapeHtml(cc) : ""}</div>
      </a>
    `;
  }).join("");

  safeHtml(el.stories, html);
}

// ---------- Fetch ----------
function formatCooldown(seconds) {
  const secs = Math.max(1, Number(seconds || 0));
  const mins = Math.ceil(secs / 60);
  return mins <= 1 ? "about 1 minute" : `about ${mins} minutes`;
}

function friendlyWorkerError(data) {
  const cooldown = formatCooldown(data?.failureCooldownRemainingSeconds || data?.retryAfterSeconds || data?.failureCooldownSeconds);
  const preview = String(data?.preview || data?.livePreview || "").trim();

  if (data?.errorCode === "GDELT_RATE_LIMIT" || data?.status === 429) {
    return `GDELT rate limit active. The news API is saying “too many requests,” so Doomroom is pausing live pulls for ${cooldown} instead of hammering it. Details from GDELT: ${preview || "HTTP 429 Too Many Requests."}`;
  }

  if (data?.errorCode === "GDELT_QUERY_SYNTAX") {
    return `GDELT query syntax issue. The upstream API rejected the search format: ${preview || "OR terms must be wrapped in parentheses."} Doomroom has been updated to wrap OR searches properly; this failed query is cooling down for ${cooldown}.`;
  }

  if (data?.errorCode === "GDELT_TIMEOUT") {
    return `GDELT upstream timeout. The news API did not answer quickly enough, so Doomroom is pausing live pulls for ${cooldown} instead of spinning forever or retrying in a loop.`;
  }

  if (data?.cacheStatus === "FAILURE_COOLDOWN" || data?.cacheStatus === "MISS_LIVE_FAILED_COOLDOWN") {
    return `${data?.error || "Live news pull failed"}. Doomroom is in upstream cooldown for ${cooldown}. ${data?.userMessage || "This prevents repeated retries while the upstream API is unhappy."}`;
  }

  if (data?.userMessage) return data.userMessage;
  if (data?.error) return `${data.error}${preview ? ` — ${preview}` : ""}`;
  return "Worker returned no usable data";
}

async function fetchGdelt(query) {
  const u = new URL(`${PROXY_BASE}/${ROUTE}`);
  u.searchParams.set("format", "json");
  u.searchParams.set("mode", "ArtList");
  u.searchParams.set("maxrecords", String(MAX_RECORDS));
  u.searchParams.set("timespan", TIMESSPAN);
  u.searchParams.set("query", query || DEFAULT_Q);

  // tiny cache-buster; Worker ignores this for its normalized cache keys
  u.searchParams.set("_", String(Date.now()));

  const resp = await fetch(u.toString(), { method: "GET" });
  if (!resp.ok) throw new Error(`Worker HTTP ${resp.status}`);
  const data = await resp.json();
  if (data && data.ok === false) throw new Error(friendlyWorkerError(data));
  return data;
}

let lastFetchAt = 0;
const MIN_REFRESH_MS = 6500;
const CACHE_KEY = "doomroom:last-readable-omens:v1";
const LIVE_REFRESH_MS = 8 * 60 * 60 * 1000; // 3 polite live pulls/day max per device

function cacheAgeMs(cached) {
  return Math.max(0, Date.now() - Number(cached?.savedAt || 0));
}

function isCacheFresh(cached) {
  return Boolean(cached?.articles?.length) && cacheAgeMs(cached) < LIVE_REFRESH_MS;
}

function formatDuration(ms) {
  const mins = Math.max(1, Math.ceil(Math.max(0, ms) / 60000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem ? `${hours}h ${rem}m` : `${hours}h`;
}

function nextLivePullIn(cached) {
  return formatDuration(LIVE_REFRESH_MS - cacheAgeMs(cached));
}

function setRefreshLoading(isLoading) {
  if (!el.refresh) return;
  el.refresh.disabled = Boolean(isLoading);
  el.refresh.textContent = isLoading ? "Scanning omens…" : "Refresh";
}

function loadCachedOmens() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw);
    if (!cached || !Array.isArray(cached.articles)) return null;
    return cached;
  } catch {
    return null;
  }
}

function saveCachedOmens(articles) {
  try {
    const trimmed = articles.slice(0, 25).map((a) => ({
      title: a.title || "",
      url: a.url || "#",
      domain: a.domain || "",
      language: a.language || "",
      sourcecountry: a.sourcecountry || ""
    }));
    localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), articles: trimmed }));
  } catch {
    // Cache is a nicety; never let storage weirdness break the doom desk.
  }
}

function formatCacheAge(savedAt) {
  const ms = Math.max(0, Date.now() - Number(savedAt || 0));
  const mins = Math.max(1, Math.round(ms / 60000));
  if (mins < 60) return `${mins}m old`;
  return `${Math.round(mins / 60)}h old`;
}

function renderHeadlineSet(strictEnglish, options = {}) {
  const before = Number.isFinite(options.before) ? options.before : strictEnglish.length;
  const after = strictEnglish.length;
  const statusText = options.statusText || `Omens readable. (Strict English: ${before} → ${after})`;

  safeText(el.status, statusText);
  safeText(el.sample, options.sampleText || `Sample: ${after} headlines`);
  safeText(el.updated, options.updatedText || `Updated: ${nowStamp()}`);
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
  safeText(el.doomLabel, options.label || meta.label);
  safeText(el.doomTag, options.tag || meta.tag);

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

// ---------- Main run ----------
async function run() {
  const params = new URLSearchParams(location.search);
  const demoMode = params.get("demo") === "1";
  if (demoMode) {
    setRefreshLoading(true);
    safeText(el.updated, "Updated: —");
    safeText(el.status, "Loading demo omens…");
    safeText(el.sample, "Sample: —");
    safeText(el.ver, VERSION);
    safeText(el.filterPill, "Filter: DEMO MODE / English-style sample");
    if (el.okPill) el.okPill.textContent = "DEMO";
    setTimeout(() => {
      renderHeadlineSet(DEMO_ARTICLES, {
        before: DEMO_ARTICLES.length,
        statusText: "Demo omens loaded. Real API is currently rate-limiting upstream.",
        sampleText: `Demo sample: ${DEMO_ARTICLES.length} headlines`,
        updatedText: `Updated: demo ${nowStamp()}`,
        label: "Demo doom, fully weaponized.",
        tag: "This is the populated app flow with sample headlines while GDELT takes a dramatic little timeout."
      });
      setRefreshLoading(false);
    }, 450);
    return;
  }

  const cached = loadCachedOmens();
  if (isCacheFresh(cached)) {
    safeText(el.filterPill, "Filter: English ONLY / Cached briefing");
    if (el.okPill) el.okPill.textContent = "NAP MODE";
    renderHeadlineSet(cached.articles, {
      statusText: `Cached omens are fresh enough. Next live pull in ${nextLivePullIn(cached)}.`,
      sampleText: `Cached sample: ${cached.articles.length} headlines`,
      updatedText: `Updated: cached ${formatCacheAge(cached.savedAt)}`,
      label: "Doom clock is napping.",
      tag: "This app is unserious, so it refuses to bully the news API. Tap back later for a fresh batch of nonsense."
    });
    setRefreshLoading(false);
    return;
  }

  const since = Date.now() - lastFetchAt;
  if (since < MIN_REFRESH_MS) {
    const wait = Math.ceil((MIN_REFRESH_MS - since) / 1000);
    safeText(el.status, `Cooling the doom engine. Retry in ${wait}s.`);
    return;
  }
  lastFetchAt = Date.now();
  setRefreshLoading(true);
  safeText(el.updated, "Updated: —");
  safeText(el.status, "Checking the twice-daily-ish omen bucket…");
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
    const cached = loadCachedOmens();
    if (cached?.articles?.length) {
      renderHeadlineSet(cached.articles, {
        statusText: `Live fetch failed; showing cached omens (${formatCacheAge(cached.savedAt)}). ${e?.message || ""}`,
        sampleText: `Cached sample: ${cached.articles.length} headlines`,
        updatedText: `Updated: cached ${formatCacheAge(cached.savedAt)}`,
        label: "Cached doom, fresh sarcasm.",
        tag: `Live news pipe said “${e?.message || "nope"}.” So here are the last readable omens instead of a sad blank screen.`
      });
      setRefreshLoading(false);
      return;
    }

    safeText(el.filterPill, "Filter: SAMPLE FALLBACK / Live pipe napping");
    if (el.okPill) el.okPill.textContent = "SAMPLE";
    renderHeadlineSet(DEMO_ARTICLES, {
      before: DEMO_ARTICLES.length,
      statusText: `Live pull paused: ${e?.message || "omen pipe clogged"} Showing sample omens.`,
      sampleText: `Sample fallback: ${DEMO_ARTICLES.length} headlines`,
      updatedText: `Updated: sample ${nowStamp()}`,
      label: "Sample doom, fully theatrical.",
      tag: "GDELT is taking a dramatic little timeout, so Doomroom is showing a clearly fake-but-functional briefing instead of sitting here looking unemployed."
    });
    setRefreshLoading(false);
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

  if (after) saveCachedOmens(strictEnglish);
  renderHeadlineSet(strictEnglish, { before });
  setRefreshLoading(false);
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
