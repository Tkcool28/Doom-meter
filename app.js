/* Doomroom News — app.js (robust fetch + timeouts)
   - Never hangs: AbortController timeout
   - Tries multiple URL patterns (because Worker params evolved)
   - Shows real failure reasons in the UI
*/

const VERSION = "3.1.2";

// === SET THIS to your Cloudflare Worker base ===
const PROXY_BASE = "https://doom-proxy.toddkirschman.workers.dev";

// Worker endpoint
const ENDPOINT = "/gdel";

// Query defaults
const DEFAULT_QUERY = "world";
const MAX_RECORDS = 30;
const TIME_SPAN = "1d";

// Hard timeout so it can't "hang"
const FETCH_TIMEOUT_MS = 12000;

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
  { key: "econ", label: "Economic Drama", words: ["recession","inflation","layoffs","bank","debt","rates","market crash","default","bailout","oil prices"] },
  { key: "democracy", label: "Democracy Melting", words: ["coup","election fraud","authoritarian","ban","protest","martial law","rights","supreme court","impeachment","shutdown"] },
  { key: "cyber", label: "Cyber Chaos", words: ["hack","breach","ransomware","leak","cyberattack","outage","malware","zero-day"] },
  { key: "nuclear", label: "Nuclear Words", words: ["nuclear","uranium","plutonium","ICBM","missile test","enrichment","warhead"] },
  { key: "space", label: "Space Rocks", words: ["asteroid","meteor","comet","near-earth","impact","space rock"] },
  { key: "misc", label: "Misc. Chaos", words: ["riot","explosion","crash","collapse","panic","emergency","evacuation","shooting","disaster"] },
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

  const raw = Object.values(bucketScores).reduce((sum, v) => sum + v, 0);
  let doom = Math.round(Math.min(100, raw * 6));
  if (!Number.isFinite(doom)) doom = 0;

  const maxBucket = Math.max(1, ...Object.values(bucketScores));
  const breakdown = BUCKETS.map((b) => {
    const v = bucketScores[b.key];
    const scaled = Math.round((v / maxBucket) * 100);
    return { label: b.label, value: scaled, raw: v };
  });

  const drivers = articles.slice(0, 3).map((a) => ({
    title: a.title || "Untitled doom",
    url: a.url || "#",
    domain: a.domain || "",
    language: a.language || "",
    sourcecountry: a.sourcecountry || "",
  }));

  return { doom, breakdown, drivers };
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
  for (const a of articles) host.appendChild(storyCard(a));
}

function renderDrivers(drivers) {
  const host = $("drivers");
  if (!host) return;
  host.innerHTML = "";
  for (const d of drivers) host.appendChild(storyCard(d));
}

// ---------- Fetch utilities ----------
function buildCandidateUrls() {
  const t = String(Date.now());

  // Pattern A (most likely correct for your worker): only query is required
  const a = `${PROXY_BASE}${ENDPOINT}?query=${encodeURIComponent(DEFAULT_QUERY)}&t=${t}`;

  // Pattern B (expanded, but still simple)
  const b = `${PROXY_BASE}${ENDPOINT}?query=${encodeURIComponent(DEFAULT_QUERY)}&maxrecords=${MAX_RECORDS}&timespan=${encodeURIComponent(TIME_SPAN)}&t=${t}`;

  // Pattern C (the “ArtList” style — keep as fallback)
  const c = `${PROXY_BASE}${ENDPOINT}?query=${encodeURIComponent(DEFAULT_QUERY)}&mode=ArtList&format=json&maxrecords=${MAX_RECORDS}&timespan=${encodeURIComponent(TIME_SPAN)}&t=${t}`;

  return [a, b, c];
}

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      cache: "no-store",
    });

    const text = await res.text(); // read as text first (prevents “json hangs” on bad content)
    return { ok: res.ok, status: res.status, statusText: res.statusText, text, url };
  } finally {
    clearTimeout(timer);
  }
}

function safeJsonParse(text) {
  try {
    return { json: JSON.parse(text), error: null };
  } catch (e) {
    return { json: null, error: String(e) };
  }
}

function extractArticles(payload) {
  // Worker might return:
  // 1) { articles: [...] }
  // 2) { data: { articles: [...] } }
  // 3) [...] (raw array)
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.articles)) return payload.articles;
  if (payload && payload.data && Array.isArray(payload.data.articles)) return payload.data.articles;
  return null;
}

function filterEnglishUS(items) {
  const english = items.filter((x) => normalize(x.language).includes("english"));
  const us = english.filter((x) => {
    const sc = normalize(x.sourcecountry);
    return sc.includes("united states") || sc.includes("usa");
  });
  return us.length ? us : english;
}

// ---------- Main refresh ----------
async function refresh() {
  // Reset UI so you can distinguish "loading" from "dead"
  setText("doomNumber", "—");
  setText("doomLabel", "—");
  setText("samplePill", "Sample: — headlines");
  setStatus("Consulting the omens…");

  const urls = buildCandidateUrls();
  let lastErr = "";

  for (const url of urls) {
    try {
      const r = await fetchWithTimeout(url);

      // If worker returns HTML (cloudflare error page etc), bail early with clear info
      const trimmed = (r.text || "").trim();
      const looksHtml = trimmed.startsWith("<!doctype") || trimmed.startsWith("<html") || trimmed.startsWith("<");
      if (looksHtml) {
        lastErr = `Proxy returned HTML (not JSON) from ${new URL(url).pathname}`;
        continue;
      }

      const { json, error } = safeJsonParse(r.text);
      if (!json || error) {
        lastErr = `JSON parse failed (${error})`;
        continue;
      }

      const articlesRaw = extractArticles(json);
      if (!articlesRaw) {
        // Worker might be returning its "Not found" JSON shape
        if (json.error && json.routes) {
          lastErr = `Worker says: ${json.error}. Routes: ${json.routes.join(", ")}`;
        } else {
          lastErr = `No "articles" array found in response.`;
        }
        continue;
      }

      const filtered = filterEnglishUS(articlesRaw);
      setText("samplePill", `Sample: ${filtered.length} headlines`);

      if (!filtered.length) {
        setStatus("Omens consulted. (No English headlines found.)");
        setUpdatedStamp(new Date());
        return;
      }

      const { doom, breakdown, drivers } = scoreArticles(filtered);

      renderMain(doom);
      renderBreakdown(breakdown);
      renderDrivers(drivers);
      renderStories(filtered);

      setUpdatedStamp(new Date());
      setStatus("Omens consulted.");
      return; // success
    } catch (e) {
      // AbortError / network / CORS etc
      lastErr = String(e);
      continue;
    }
  }

  // If we got here, all URL patterns failed
  setText("samplePill", "Sample: 0 headlines");
  setStatus(`The omens are… unclear. (${lastErr || "unknown failure"})`);
}

// ---------- Init ----------
function init() {
  setText("versionText", VERSION);
  wireAbout();

  const r = $("refreshBtn");
  if (r) r.addEventListener("click", refresh);

  refresh();
}

document.addEventListener("DOMContentLoaded", init);
