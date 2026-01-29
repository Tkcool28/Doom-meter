/* Doomroom News — app.js (single-file)
   - Fetches headlines via your Cloudflare Worker proxy
   - Filters English/US
   - Computes a silly Doom score + category breakdown
   - Renders side-aligned bars + clickable story cards
*/

const VERSION = "3.1.1";

// === IMPORTANT: set your worker/proxy base here ===
const PROXY_BASE = "https://doom-proxy.toddkirschman.workers.dev";

// Endpoint on the worker that returns articles.
// Your worker earlier showed routes like: /gdel?t=query params
// So we call: /gdel?query=world&mode=ArtList&format=json&maxrecords=50&timespan=1d
const ENDPOINT = "/gdel";

const DEFAULT_QUERY = "world";
const MAX_RECORDS = 30;
const TIME_SPAN = "1d";

// ---------- DOM helpers ----------
const $ = (id) => document.getElementById(id);

function setText(id, text) {
  const el = $(id);
  if (el) el.textContent = text;
}

function setStatus(text) {
  setText("statusPill", text);
}

function setUpdatedStamp(date) {
  const d = date instanceof Date ? date : new Date();
  setText("updatedPill", `Updated: ${d.toLocaleString()}`);
}

function openAbout() {
  const ov = $("aboutOverlay");
  if (!ov) return;
  setText("aboutVersion", `v${VERSION}`);
  ov.classList.remove("hidden");
  ov.setAttribute("aria-hidden", "false");
}

function closeAbout() {
  const ov = $("aboutOverlay");
  if (!ov) return;
  ov.classList.add("hidden");
  ov.setAttribute("aria-hidden", "true");
}

function wireAbout() {
  const btn = $("aboutBtn");
  const close = $("aboutCloseBtn");
  const ok = $("aboutOkBtn");
  const ov = $("aboutOverlay");

  if (btn) btn.addEventListener("click", openAbout);
  if (close) close.addEventListener("click", closeAbout);
  if (ok) ok.addEventListener("click", closeAbout);

  if (ov) {
    ov.addEventListener("click", (e) => {
      if (e.target === ov) closeAbout();
    });
  }
}

// ---------- Doom scoring ----------
const BUCKETS = [
  { key: "conflict", label: "Conflict Heat", words: ["war","strike","missile","attack","invasion","shelling","ceasefire","military","bomb","hostage","terror","airstrike","troops"] },
  { key: "climate", label: "Climate Weirdness", words: ["heat","storm","flood","wildfire","hurricane","tornado","drought","record heat","climate","extreme weather","blizzard"] },
  { key: "econ", label: "Economic Drama", words: ["recession","inflation","layoffs","bank","debt","rates","market crash","default","bailout","strike","oil prices"] },
  { key: "democracy", label: "Democracy Melting", words: ["coup","election fraud","authoritarian","ban","protest","martial law","rights","supreme court","impeachment","shutdown"] },
  { key: "cyber", label: "Cyber Chaos", words: ["hack","breach","ransomware","leak","cyberattack","outage","malware","zero-day"] },
  { key: "nuclear", label: "Nuclear Words", words: ["nuclear","uranium","plutonium","ICBM","missile test","enrichment","warhead"] },
  { key: "space", label: "Space Rocks", words: ["asteroid","meteor","comet","near-earth","impact","space rock"] },
  { key: "misc", label: "Misc. Chaos", words: ["riot","explosion","crash","collapse","panic","emergency","evacuation","shooting","hostage","disaster"] },
];

function normalize(s) {
  return (s || "").toLowerCase();
}

function countHits(text, wordList) {
  const t = normalize(text);
  let hits = 0;
  for (const w of wordList) {
    const ww = normalize(w);
    if (!ww) continue;
    if (t.includes(ww)) hits += 1;
  }
  return hits;
}

function scoreArticles(articles) {
  const bucketScores = {};
  for (const b of BUCKETS) bucketScores[b.key] = 0;

  for (const a of articles) {
    const title = a.title || "";
    const domain = a.domain || "";
    const blob = `${title} ${domain}`;

    for (const b of BUCKETS) {
      bucketScores[b.key] += countHits(blob, b.words);
    }
  }

  // Convert to a 0–100-ish doom score.
  // Intentionally soft so it doesn't pin at 100 constantly.
  const raw = Object.values(bucketScores).reduce((sum, v) => sum + v, 0);
  let doom = Math.round(Math.min(100, raw * 6)); // tweak multiplier for vibe
  if (!Number.isFinite(doom)) doom = 0;

  // Make buckets also 0–100 scale for bars.
  // We'll scale relative to max bucket hit count so one category can dominate without breaking the layout.
  const maxBucket = Math.max(1, ...Object.values(bucketScores));
  const breakdown = BUCKETS.map((b) => {
    const v = bucketScores[b.key];
    const scaled = Math.round((v / maxBucket) * 100);
    return { label: b.label, value: scaled, raw: v };
  });

  // Top drivers: pick titles that contributed hits (very rough)
  // We'll just take the first few.
  const drivers = articles.slice(0, 3).map((a) => ({
    title: a.title || "Untitled doom",
    url: a.url || "#",
    domain: a.domain || "",
    language: a.language || "",
  }));

  return { doom, breakdown, drivers, raw };
}

function doomLabelFor(doom) {
  if (doom >= 90) return "We are on fire.";
  if (doom >= 80) return "Bad vibes (confirmed).";
  if (doom >= 45) return "Uncomfy.";
  return "Chill (suspiciously).";
}

function colorClassFor(value) {
  if (value >= 90) return "cFire";
  if (value >= 80) return "cRed";
  if (value >= 45) return "cYellow";
  return "cGreen";
}

// ---------- Render ----------
function renderMain(doom) {
  setText("doomNumber", String(doom));
  setText("doomLabel", doomLabelFor(doom));

  const fill = $("doomFill");
  if (fill) {
    fill.className = `fill ${colorClassFor(doom)}`;
    fill.style.width = `${doom}%`;
  }

  // Calm pill
  const calm = $("calmPill");
  if (calm) {
    calm.textContent = doom < 45 ? "OK" : doom < 80 ? "Hmm" : doom < 90 ? "Yikes" : "🔥";
  }
}

function renderBreakdown(buckets) {
  const host = $("breakdown");
  if (!host) return;
  host.innerHTML = "";

  for (const b of buckets) {
    const v = Math.max(0, Math.min(100, Number(b.value) || 0));

    const row = document.createElement("div");
    row.className = "meterRow";

    const label = document.createElement("div");
    label.className = "meterLabel";
    label.textContent = b.label || "Unknown Doom";

    const track = document.createElement("div");
    track.className = "meterTrack";

    const fill = document.createElement("div");
    fill.className = `meterFill ${colorClassFor(v)}`;
    fill.style.width = `${v}%`;

    track.appendChild(fill);

    const value = document.createElement("div");
    value.className = "meterValue";
    value.textContent = String(v);

    row.appendChild(label);
    row.appendChild(track);
    row.appendChild(value);

    host.appendChild(row);
  }
}

function storyCard(a) {
  const link = document.createElement("a");
  link.className = "storyLink";
  link.href = a.url || "#";
  link.target = "_blank";
  link.rel = "noopener noreferrer";

  const title = document.createElement("div");
  title.className = "storyTitle";
  title.textContent = a.title || "Untitled";

  const meta = document.createElement("div");
  meta.className = "storyMeta";
  const lang = a.language ? ` · ${a.language}` : "";
  const country = a.sourcecountry ? ` · ${a.sourcecountry}` : "";
  meta.textContent = `${a.domain || "unknown"}${lang}${country}`;

  link.appendChild(title);
  link.appendChild(meta);
  return link;
}

function renderStories(articles) {
  const host = $("stories");
  if (!host) return;
  host.innerHTML = "";

  for (const a of articles) {
    host.appendChild(storyCard(a));
  }
}

function renderDrivers(drivers) {
  const host = $("drivers");
  if (!host) return;
  host.innerHTML = "";

  for (const d of drivers) {
    host.appendChild(storyCard(d));
  }
}

// ---------- Fetch ----------
function buildUrl() {
  const params = new URLSearchParams();
  params.set("query", DEFAULT_QUERY);
  params.set("mode", "ArtList");
  params.set("format", "json");
  params.set("maxrecords", String(MAX_RECORDS));
  params.set("timespan", TIME_SPAN);

  // cache buster
  params.set("t", String(Date.now()));

  return `${PROXY_BASE}${ENDPOINT}?${params.toString()}`;
}

function filterEnglishUS(items) {
  // Keep English; prefer United States but don't drop all if missing
  const english = items.filter((x) => normalize(x.language).includes("english"));

  const us = english.filter((x) => normalize(x.sourcecountry).includes("united states") || normalize(x.sourcecountry).includes("usa"));
  return us.length ? us : english;
}

async function refresh() {
  setStatus("Consulting the omens…");

  const url = buildUrl();

  try {
    const res = await fetch(url, { method: "GET" });
    const data = await res.json();

    // Worker sometimes returns {articles:[...]} and sometimes errors
    if (!data || !Array.isArray(data.articles)) {
      console.log("Unexpected response:", data);
      setStatus("The omens are… unclear.");
      setText("samplePill", "Sample: 0 headlines");
      return;
    }

    const filtered = filterEnglishUS(data.articles);
    setText("samplePill", `Sample: ${filtered.length} headlines`);

    const { doom, breakdown, drivers } = scoreArticles(filtered);

    renderMain(doom);
    renderBreakdown(breakdown);
    renderDrivers(drivers);
    renderStories(filtered);

    setUpdatedStamp(new Date());
    setStatus("Omens consulted.");
  } catch (err) {
    console.error(err);
    setStatus("The omens are… unclear.");
  }
}

// ---------- Init ----------
function init() {
  setText("versionText", VERSION);
  wireAbout();

  const r = $("refreshBtn");
  if (r) r.addEventListener("click", refresh);

  // first load
  refresh();
}

document.addEventListener("DOMContentLoaded", init);
