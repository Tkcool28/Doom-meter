/*
  Doomroom News — app.js (v3.1.5)
  ONLY changes vs “working” version:
  - About modal copy restored + close button label “On. I’m calm’ish.”
  - News list: more records + longer timespan + date sort + cache-bust + no-store
  - Crash-proof DOM setters so a missing id can’t blank the whole app
*/

const VERSION = "v3.1.5";

// Your worker proxy (unchanged)
const PROXY_BASE = "https://doom-proxy.toddkirschman.workers.dev";
const ROUTE = "/gdelt";

// Gentle defaults (fix “only 2 / old”)
const DEFAULT_QUERY = "world";
const MAX_RECORDS = 50;     // was too low in practice
const DEFAULT_TIMESPAN = "7d"; // was too short / easy to look “stale”

const CATEGORY_MAX = 30;

const CATS = [
  { key:"conflict", label:"Conflict Heat", keywords:["war","strike","attack","missile","drone","airstrike","invasion","ceasefire","shelling","hostage","terror","bomb","blast"] },
  { key:"climate", label:"Climate Weirdness", keywords:["heat","wildfire","flood","hurricane","cyclone","storm","drought","record heat","evacuation","blaze","tornado","smoke"] },
  { key:"econ", label:"Economic Drama", keywords:["recession","inflation","layoff","bank","rate","crash","default","debt","tariff","shutdown","market"] },
  { key:"democracy", label:"Democracy Melting", keywords:["election","coup","protest","riot","authoritarian","fraud","ban","court","impeach","corruption","arrested","martial law"] },
  { key:"cyber", label:"Cyber Chaos", keywords:["hack","breach","ransomware","outage","leak","cyber","malware","phishing","ddos"] },
  { key:"space", label:"Space Rocks", keywords:["asteroid","meteor","comet","space debris","nasa","impact","near-earth","solar flare"] },
  { key:"misc", label:"Misc. Chaos", keywords:["panic","crisis","emergency","collapse","killed","dead","explosion","chaos","scandal"] }
];

const $ = (id) => document.getElementById(id);

// Crash-proof text setter
function setText(node, value){
  if (!node) return;
  node.textContent = value;
}

// Crash-proof HTML setter (used sparingly)
function setHTML(node, value){
  if (!node) return;
  node.innerHTML = value;
}

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

  breakdown: $("breakdown"),
  drivers: $("drivers"),
  stories: $("stories"),
  ver: $("verText"),

  aboutOverlay: $("aboutOverlay"),
  closeAbout: $("btnCloseAbout"),
  aboutVersion: $("aboutVersion"),
};

// ----- helpers -----

function safeText(v){
  return (v == null) ? "" : String(v);
}

function parseDate(d){
  if (!d) return 0;
  const t = Date.parse(d);
  return Number.isFinite(t) ? t : 0;
}

function clamp01(n){
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function fillClassFromPct(p){
  if (p > 90) return "fire";
  if (p >= 80) return "red";
  if (p >= 35) return "yellow";
  return "green";
}

function labelFromIndex(idx){
  if (idx >= 90) return "On fire.";
  if (idx >= 80) return "Bad vibes.";
  if (idx >= 50) return "Spicy.";
  if (idx >= 25) return "Uneasy.";
  return "Chill (suspiciously).";
}

function tagFromIndex(idx){
  if (idx >= 90) return "Drink water. Touch grass. Possibly unplug the planet.";
  if (idx >= 80) return "Proceed with snacks and caution.";
  if (idx >= 50) return "The universe is doing that thing again.";
  if (idx >= 25) return "Mild dread, but manageable.";
  return "Take a breath. The universe is weird.";
}

function scoreHeadline(title){
  const t = safeText(title).toLowerCase();
  const scores = {};
  for (const c of CATS) scores[c.key] = 0;

  for (const c of CATS){
    for (const kw of c.keywords){
      if (t.includes(kw)) scores[c.key] += 3;
    }
    scores[c.key] = Math.min(scores[c.key], 12);
  }
  return scores;
}

function dedupeArticles(list){
  const seen = new Set();
  const out = [];
  for (const a of list){
    const url = safeText(a.url || a.link).trim();
    const title = safeText(a.title).trim();
    const key = url ? `u:${url}` : `t:${title.toLowerCase()}`;
    if (!title) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      title,
      url,
      source: safeText(a.source || a.domain || a.publisher),
      language: safeText(a.language),
      country: safeText(a.country),
      publishedAt: a.publishedAt || a.published || a.date || a.seendate || a.seenDate || ""
    });
  }
  return out;
}

// ----- UI rendering -----

function renderIndex(articles){
  setText(el.ver, VERSION);
  setText(el.aboutVersion, `${VERSION} • DoomWorks Interstellar`);

  // headline scoring
  const totals = {};
  for (const c of CATS) totals[c.key] = 0;

  for (const a of articles){
    const scores = scoreHeadline(a.title);
    for (const c of CATS){
      totals[c.key] += scores[c.key];
    }
  }

  // normalize by article count
  const n = Math.max(1, articles.length);
  const pctByCat = {};
  for (const c of CATS){
    // average per headline, then scale into 0..100 with CATEGORY_MAX as reference
    const avg = totals[c.key] / n;
    const pct = Math.round(100 * clamp01(avg / (CATEGORY_MAX / 10)));
    pctByCat[c.key] = pct;
  }

  // overall doom index = average of categories
  const overall = Math.round(
    CATS.reduce((sum, c) => sum + pctByCat[c.key], 0) / CATS.length
  );

  setText(el.doomNum, overall);
  setText(el.doomLabel, labelFromIndex(overall));
  setText(el.doomTag, tagFromIndex(overall));

  if (el.doomFill){
    el.doomFill.className = `fill ${fillClassFromPct(overall)}`;
    el.doomFill.style.width = `${overall}%`;
  }

  setText(el.sample, `Sample: ${articles.length} headlines`);

  // breakdown list
  if (el.breakdown){
    const parts = [];
    for (const c of CATS){
      const p = pctByCat[c.key];
      const cls = fillClassFromPct(p);
      parts.push(`
        <div class="breakItem">
          <div class="breakTop">
            <div>${c.label}</div>
            <div class="muted">${p}</div>
          </div>
          <div class="breakBar">
            <div class="fill ${cls}" style="width:${p}%"></div>
          </div>
        </div>
      `);
    }
    setHTML(el.breakdown, parts.join(""));
  }

  // top drivers = categories with highest pct
  if (el.drivers){
    const sorted = [...CATS]
      .map(c => ({ key:c.key, label:c.label, pct: pctByCat[c.key] }))
      .sort((a,b) => b.pct - a.pct);

    const top = sorted.filter(x => x.pct >= 25).slice(0, 3);
    if (!top.length){
      setHTML(el.drivers, `
        <div class="driverTitle">No clear drivers.</div>
        <div class="driverSub">The omens refuse to elaborate.</div>
      `);
    } else {
      setHTML(el.drivers, `
        <div class="driverTitle">${top.map(t => t.label).join(" • ")}</div>
        <div class="driverSub">Top signals based on keyword matches across headlines.</div>
      `);
    }
  }
}

function renderStories(articles){
  if (!el.stories) return;

  // Show more than 2 (this is the “stuck at 2” fix)
  const show = articles.slice(0, 12);

  if (!show.length){
    setHTML(el.stories, `
      <div class="story">
        <div class="storyTitle">No stories found.</div>
        <div class="storyMeta">The void is quiet. Try Refresh.</div>
      </div>
    `);
    return;
  }

  const cards = show.map(a => {
    const metaBits = [];
    if (a.source) metaBits.push(a.source);
    if (a.publishedAt) metaBits.push(new Date(parseDate(a.publishedAt)).toLocaleString());
    const meta = metaBits.join(" • ") || "—";
    const url = a.url ? a.url : "#";
    return `
      <a class="story" href="${url}" target="_blank" rel="noopener noreferrer">
        <div class="storyTitle">${escapeHTML(a.title)}</div>
        <div class="storyMeta">${escapeHTML(meta)}</div>
      </a>
    `;
  }).join("");

  setHTML(el.stories, cards);
}

// basic HTML escape
function escapeHTML(str){
  return safeText(str)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

// ----- data fetch -----

async function fetchArticles(){
  // Cache-buster prevents “yesterday forever”
  const cacheBust = Date.now();

  const url =
    `${PROXY_BASE}${ROUTE}` +
    `?q=${encodeURIComponent(DEFAULT_QUERY)}` +
    `&max=${encodeURIComponent(MAX_RECORDS)}` +
    `&timespan=${encodeURIComponent(DEFAULT_TIMESPAN)}` +
    `&_=${cacheBust}`;

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);

  const data = await res.json();

  // Accept multiple shapes from proxy
  let raw = [];
  if (Array.isArray(data)) raw = data;
  else if (Array.isArray(data.articles)) raw = data.articles;
  else if (Array.isArray(data.results)) raw = data.results;
  else if (Array.isArray(data.items)) raw = data.items;

  let articles = dedupeArticles(raw);

  // Prefer English/US but don’t destroy the list if fields are missing
  articles = articles.filter(a => {
    const lang = (a.language || "").toLowerCase();
    const country = (a.country || "").toLowerCase();
    const langOk = !lang || lang.includes("en");
    const countryOk = !country || country.includes("us") || country.includes("united states");
    return langOk && countryOk;
  });

  // Sort newest-first (fix stale ordering)
  articles.sort((a,b) => parseDate(b.publishedAt) - parseDate(a.publishedAt));

  return articles;
}

function setStatus(msg){
  setText(el.status, msg);
}

function setUpdated(date){
  setText(el.updated, date ? `Updated: ${date}` : "Updated: —");
}

async function refresh(){
  try{
    setStatus("Reading the omens…");
    const articles = await fetchArticles();

    renderIndex(articles);
    renderStories(articles);

    setUpdated(new Date().toLocaleString());
    setStatus("The omens are… readable.");
  } catch (err){
    setStatus("The omens are sulking. Try again.");
    // Keep app visible even if fetch fails
    console.error(err);
  }
}

// ----- About modal -----

function openAbout(){
  if (!el.aboutOverlay) return;
  el.aboutOverlay.classList.remove("hidden");
}

function closeAbout(){
  if (!el.aboutOverlay) return;
  el.aboutOverlay.classList.add("hidden");
}

// ----- boot -----

function wire(){
  if (el.refresh) el.refresh.addEventListener("click", refresh);
  if (el.about) el.about.addEventListener("click", openAbout);
  if (el.closeAbout) el.closeAbout.addEventListener("click", closeAbout);

  // click outside card closes
  if (el.aboutOverlay){
    el.aboutOverlay.addEventListener("click", (e) => {
      if (e.target === el.aboutOverlay) closeAbout();
    });
  }
}

wire();
refresh();
