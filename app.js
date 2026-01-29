/* Doomroom News — app.js (v3.1.4)
   Fixes:
   - Mobile-friendly breakdown (CSS handles layout)
   - Request more articles + longer span
   - De-dupe articles so repeats don't eat the list
   - Restore About copy + “OK, I’m calm’ish”
*/

const VERSION = "v3.1.4";

// ✅ your worker:
const PROXY_BASE = "https://doom-proxy.toddkirschman.workers.dev";
const ROUTE = "/gdelt";

const DEFAULT_QUERY = "world";
const MAX_RECORDS = 25;     // was 12
const TIMESPAN = "2d";      // was 1d

const CATEGORY_MAX = 30;

const CATS = [
  { key: "conflict", label: "Conflict Heat", keywords: ["war","strike","attack","missile","drone","airstrike","invasion","ceasefire","shelling","hostage","terror","bomb","blast"] },
  { key: "climate", label: "Climate Weirdness", keywords: ["heat","wildfire","flood","hurricane","cyclone","storm","drought","record heat","evacuation","blaze","tornado","smoke"] },
  { key: "econ", label: "Economic Drama", keywords: ["recession","inflation","layoffs","bank","rates","crash","default","debt","tariff","shutdown","market"] },
  { key: "democracy", label: "Democracy Melting", keywords: ["election","coup","protest","riot","authoritarian","fraud","ban","court","impeach","corruption","arrested","martial law"] },
  { key: "cyber", label: "Cyber Chaos", keywords: ["hack","breach","ransomware","outage","leak","cyber","malware","phishing","ddos"] },
  { key: "nuclear", label: "Nuclear Words", keywords: ["nuclear","uranium","warhead","enrichment","icbm","radiation","reactor"] },
  { key: "space", label: "Space Rocks", keywords: ["asteroid","meteor","comet","space debris","nasa","impact","near-earth","solar flare"] },
  { key: "misc", label: "Misc. Chaos", keywords: ["panic","crisis","emergency","collapse","killed","dead","explosion","chaos","scandal"] },
];

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
  ok: $("okPill"),
  breakdown: $("breakdown"),
  drivers: $("drivers"),
  stories: $("stories"),
  ver: $("verText"),

  aboutOverlay: $("aboutOverlay"),
  closeAbout: $("btnCloseAbout"),
  closeAbout2: $("btnCloseAbout2"),
  aboutVersion: $("aboutVersion"),
};

function setStatus(msg){ el.status.textContent = msg; }
function setUpdated(date){ el.updated.textContent = date ? `Updated: ${date}` : "Updated: —"; }
function safeText(s){ return (s ?? "").toString(); }

function pctFromScore(score){
  return Math.max(0, Math.min(100, Math.round((score / CATEGORY_MAX) * 100)));
}
function fillClassFromPct(p){
  if (p > 90) return "fire";
  if (p >= 80) return "red";
  if (p >= 35) return "yellow";
  return "";
}
function labelFromIndex(idx){
  if (idx >= 90) return "On fire.";
  if (idx >= 80) return "Bad vibes.";
  if (idx >= 50) return "Spicy.";
  if (idx >= 25) return "Uneasy.";
  return "Chill (suspiciously).";
}

function scoreHeadline(title){
  const t = title.toLowerCase();
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

function dedupeArticles(articles){
  const seen = new Set();
  const out = [];
  for (const a of articles) {
    const url = safeText(a.url).trim();
    const title = safeText(a.title).trim().toLowerCase();
    const key = url ? `u:${url}` : `t:${title}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

function filterEnglishUS(articles){
  return articles.filter(a => {
    const lang = (a.language || "").toLowerCase();
    const country = (a.sourcecountry || "").toLowerCase();
    return lang.includes("english") && (country.includes("united states") || country === "us");
  });
}

function computeFromArticles(articles){
  const totals = {};
  for (const c of CATS) totals[c.key] = 0;

  const filtered = filterEnglishUS(articles);
  for (const a of filtered) {
    const title = safeText(a.title);
    const s = scoreHeadline(title);
    for (const c of CATS) totals[c.key] += s[c.key];
  }

  let sum = 0;
  let weightSum = 0;
  for (const c of CATS) {
    const w = (c.key === "misc") ? 0.6 : 1.0;
    const p = pctFromScore(totals[c.key]);
    sum += p * w;
    weightSum += w;
  }
  const index = Math.round(sum / Math.max(1, weightSum));
  return { filtered, totals, index };
}

function setHero(index){
  el.doomNum.textContent = String(index);
  el.doomLabel.textContent = labelFromIndex(index);

  const p = Math.max(0, Math.min(100, index));
  el.doomFill.style.width = `${p}%`;
  el.doomFill.className = "meterFill " + fillClassFromPct(p);
}

function renderBars(totals){
  el.breakdown.innerHTML = "";
  for (const c of CATS) {
    const score = totals[c.key] || 0;
    const p = pctFromScore(score);

    const row = document.createElement("div");
    row.className = "bRow";

    const label = document.createElement("div");
    label.className = "bLabel";
    label.textContent = c.label;

    const barWrap = document.createElement("div");
    barWrap.className = "bBarWrap";

    const track = document.createElement("div");
    track.className = "meterTrack";
    track.style.height = "14px";

    const fill = document.createElement("div");
    fill.className = "meterFill " + fillClassFromPct(p);
    fill.style.width = `${p}%`;

    track.appendChild(fill);
    barWrap.appendChild(track);

    const val = document.createElement("div");
    val.className = "bVal";
    val.textContent = String(score);

    row.appendChild(label);
    row.appendChild(barWrap);
    row.appendChild(val);
    el.breakdown.appendChild(row);
  }
}

function renderStories(articles){
  el.stories.innerHTML = "";
  const show = articles.slice(0, 12);
  for (const a of show) {
    const link = document.createElement("a");
    link.className = "story";
    link.href = a.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";

    const t = document.createElement("div");
    t.className = "storyTitle";
    t.textContent = safeText(a.title) || "(untitled omen)";

    const m = document.createElement("div");
    m.className = "storyMeta";
    const domain = safeText(a.domain);
    const lang = safeText(a.language);
    const country = safeText(a.sourcecountry);
    m.textContent = [domain, lang, country].filter(Boolean).join(" • ");

    link.appendChild(t);
    link.appendChild(m);
    el.stories.appendChild(link);
  }
}

function renderDrivers(articles){
  const hits = [];
  for (const a of articles) {
    const title = safeText(a.title);
    const s = scoreHeadline(title);
    let sum = 0;
    for (const c of CATS) sum += s[c.key];
    if (sum > 0) hits.push({ a, sum });
  }
  hits.sort((x,y)=> y.sum - x.sum);

  el.drivers.innerHTML = "";
  const top = hits.slice(0, 3);
  if (!top.length) {
    const empty = document.createElement("div");
    empty.className = "story";
    empty.innerHTML = `<div class="storyTitle">No clear drivers.</div><div class="storyMeta">The omens refuse to elaborate.</div>`;
    el.drivers.appendChild(empty);
    return;
  }

  for (const it of top) {
    const a = it.a;
    const link = document.createElement("a");
    link.className = "story";
    link.href = a.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";

    const t = document.createElement("div");
    t.className = "storyTitle";
    t.textContent = safeText(a.title);

    const m = document.createElement("div");
    m.className = "storyMeta";
    m.textContent = `${safeText(a.domain)} • intensity ${it.sum}`;

    link.appendChild(t);
    link.appendChild(m);
    el.drivers.appendChild(link);
  }
}

async function fetchArticles(){
  const url =
    `${PROXY_BASE}${ROUTE}` +
    `?query=${encodeURIComponent(DEFAULT_QUERY)}` +
    `&mode=ArtList&format=json` +
    `&maxrecords=${encodeURIComponent(String(MAX_RECORDS))}` +
    `&timespan=${encodeURIComponent(TIMESPAN)}` +
    `&t=${Date.now()}`;

  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(), 12000);

  try {
    const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
    const data = await res.json().catch(()=> ({}));
    return { ok: res.ok, data };
  } finally {
    clearTimeout(timer);
  }
}

async function refresh(){
  setStatus("Conferring with the omens…");
  setUpdated(null);
  el.sample.textContent = "Sample: …";
  el.stories.innerHTML = "";
  el.drivers.innerHTML = "";
  el.breakdown.innerHTML = "";
  setHero(0);

  const { ok, data } = await fetchArticles().catch((e)=>({
    ok:false,
    data:{ error: e?.name === "AbortError" ? "Timeout" : "Network error" }
  }));

  if (!ok || data?.error) {
    const err = safeText(data?.error || "Unknown error");
    const routes = Array.isArray(data?.routes) ? ` Routes: ${data.routes.join(", ")}` : "";
    setStatus(`The omens are… unclear. (Worker says: ${err}.${routes})`);
    el.sample.textContent = "Sample: 0 headlines";
    el.ok.textContent = "OK";
    return;
  }

  let articles = Array.isArray(data.articles) ? data.articles : [];
  articles = dedupeArticles(articles);

  const { filtered, totals, index } = computeFromArticles(articles);

  setHero(index);
  renderBars(totals);
  renderDrivers(filtered);
  renderStories(filtered);

  el.sample.textContent = `Sample: ${filtered.length} headlines`;
  el.ok.textContent = "OK";
  setUpdated(new Date().toLocaleString());

  setStatus(filtered.length ? "The omens are… readable." : "The omens are… quiet.");
}

function openAbout(){
  el.aboutVersion.textContent = `${VERSION} • DoomWorks Interstellar`;
  el.aboutOverlay.style.display = "flex";
}
function closeAbout(){ el.aboutOverlay.style.display = "none"; }

function init(){
  el.ver.textContent = VERSION;
  el.refresh.addEventListener("click", refresh);
  el.about.addEventListener("click", openAbout);
  el.closeAbout.addEventListener("click", closeAbout);
  el.closeAbout2.addEventListener("click", closeAbout);
  el.aboutOverlay.addEventListener("click", (e)=>{ if (e.target === el.aboutOverlay) closeAbout(); });

  refresh();
}
init();
// PWA: register service worker
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}
