/* Doomroom News — GitHub Pages */
const VERSION = "3.2.0";

/**
 * Your Cloudflare Worker proxy base
 * Must support:
 *  - GET /health
 *  - GET /gdelt?<query params>
 */
const PROXY_BASE = "https://doom-proxy.toddkirschman.workers.dev";

/** Default pull */
const DEFAULT_QUERY = "world";

/** Hard filter (what you wanted) */
const FILTER_LANGUAGE = "English";
const FILTER_COUNTRY = "United States";

/** Doom categories (working theory — tweak freely) */
const CATS = [
  { key: "conflict", label: "Conflict Heat", weight: 2.2, keywords: ["war","strike","missile","bomb","attack","ceasefire","invasion","airstrike","military","hostage","terror","drone","border","iran","israel","gaza","ukraine","russia","nato"] },
  { key: "climate",  label: "Climate Weirdness", weight: 1.6, keywords: ["climate","storm","hurricane","flood","wildfire","heat","drought","tornado","earthquake","eruption","blizzard","record heat","extreme weather","sea level"] },
  { key: "econ",     label: "Economic Drama", weight: 1.4, keywords: ["inflation","recession","layoffs","bank","market","stocks","crash","debt","rates","tariff","sanctions","oil price","housing"] },
  { key: "dem",      label: "Democracy Melting", weight: 1.8, keywords: ["election","coup","protest","riot","ban","censorship","authoritarian","court","impeach","corruption","fraud","democracy"] },
  { key: "cyber",    label: "Cyber Chaos", weight: 1.6, keywords: ["hack","breach","ransomware","cyber","leak","malware","ddos","data breach","security flaw"] },
  { key: "nuclear",  label: "Nuclear Words", weight: 2.5, keywords: ["nuclear","uranium","missile test","icbm","warhead","radiation","reactor"] },
  { key: "space",    label: "Space Rocks", weight: 1.1, keywords: ["asteroid","comet","meteor","space debris","solar flare","nasa"] },
  { key: "misc",     label: "Misc. Chaos", weight: 0.8, keywords: ["pandemic","outbreak","mystery","collapse","deadly","massive","emergency","evacuation","shooting","explosion"] },
];

const $ = (id) => document.getElementById(id);

function setText(id, txt){ const el = $(id); if (el) el.textContent = txt; }
function show(id, on=true){ const el = $(id); if (el) el.classList.toggle("hide", !on); }

function nowStamp(){ return new Date().toLocaleString(); }

function colorForScore(v){
  // 0–100
  if (v >= 95) return "fire";
  if (v >= 85) return "red";
  if (v >= 70) return "orange";
  if (v >= 40) return "yellow";
  return "green";
}

function paintFill(el, score){
  if (!el) return;
  const tier = colorForScore(score);
  // “on fire” is a gradient trick
  if (tier === "fire"){
    el.style.background = "repeating-linear-gradient(45deg, #ff3b30 0 10px, #ffcc00 10px 20px)";
  } else if (tier === "red"){
    el.style.background = "#ff3b30";
  } else if (tier === "orange"){
    el.style.background = "#ff9500";
  } else if (tier === "yellow"){
    el.style.background = "#ffcc00";
  } else {
    el.style.background = "#38c172";
  }
}

function normalizePayload(payload){
  // Error shape (what you saw earlier): {error, routes, example}
  if (!payload || payload.error || payload.ok === false){
    return {
      ok: false,
      error: payload?.error || "Unknown error",
      routes: payload?.routes,
      example: payload?.example,
      keys: payload ? Object.keys(payload) : [],
      articles: []
    };
  }

  // Common “happy” shapes we’ve seen:
  // 1) { articles: [...] }
  if (Array.isArray(payload.articles)) return { ok:true, articles: payload.articles };

  // 2) { data: { articles: [...] } }
  if (payload.data && Array.isArray(payload.data.articles)) return { ok:true, articles: payload.data.articles };

  return { ok:true, articles: [], keys: Object.keys(payload) };
}

async function fetchJSON(url, timeoutMs=14000){
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try{
    const res = await fetch(url, { method:"GET", mode:"cors", cache:"no-store", signal: ctrl.signal });
    const txt = await res.text();
    clearTimeout(t);
    try{
      return { ok: res.ok, status: res.status, json: JSON.parse(txt), raw: txt };
    } catch {
      return { ok:false, status: res.status, json: { error:"Non-JSON response", body_preview: txt.slice(0, 250) }, raw: txt };
    }
  } catch (e){
    clearTimeout(t);
    return { ok:false, status: 0, json: { error: String(e) } };
  }
}

function gdeltURL(query){
  // Keep it simple. Worker handles upstream.
  const u = new URL(PROXY_BASE + "/gdelt");
  u.searchParams.set("query", query);
  u.searchParams.set("mode", "ArtList");
  u.searchParams.set("format", "json");
  u.searchParams.set("maxrecords", "60");
  u.searchParams.set("timespan", "1d");
  return u.toString();
}

function domainFrom(url){
  try { return new URL(url).hostname.replace(/^www\./,""); } catch { return ""; }
}

function scoreArticles(articles){
  const scored = [];
  for (const a of articles){
    const title = (a.title || "").toLowerCase();
    const url = a.url || a.url_mobile || "";
    const lang = a.language || "";
    const country = a.sourcecountry || "";
    const dom = a.domain || domainFrom(url);

    // Filter: English + US
    if (FILTER_LANGUAGE && lang && lang !== FILTER_LANGUAGE) continue;
    if (FILTER_COUNTRY && country && country !== FILTER_COUNTRY) continue;

    // Category hits
    const hits = {};
    let total = 0;

    for (const c of CATS){
      let count = 0;
      for (const kw of c.keywords){
        if (title.includes(kw)) count++;
      }
      if (count > 0){
        hits[c.key] = count;
        total += count * c.weight;
      }
    }

    scored.push({
      raw: a,
      title: a.title || "(untitled)",
      url,
      lang,
      country,
      domain: dom || "source",
      hits,
      doomContribution: total
    });
  }

  // If filter is too strict and returns nothing, fall back to English-only
  if (scored.length === 0){
    for (const a of articles){
      const title = (a.title || "").toLowerCase();
      const url = a.url || a.url_mobile || "";
      const lang = a.language || "";
      const country = a.sourcecountry || "";
      const dom = a.domain || domainFrom(url);

      if (FILTER_LANGUAGE && lang && lang !== FILTER_LANGUAGE) continue;

      const hits = {};
      let total = 0;
      for (const c of CATS){
        let count = 0;
        for (const kw of c.keywords){
          if (title.includes(kw)) count++;
        }
        if (count > 0){
          hits[c.key] = count;
          total += count * c.weight;
        }
      }

      scored.push({
        raw: a,
        title: a.title || "(untitled)",
        url,
        lang,
        country,
        domain: dom || "source",
        hits,
        doomContribution: total
      });
    }
    setText("filterPill", "Filter: English");
  } else {
    setText("filterPill", `Filter: ${FILTER_LANGUAGE} / ${FILTER_COUNTRY}`);
  }

  // Sort: highest contribution first
  scored.sort((x,y) => (y.doomContribution - x.doomContribution));
  return scored;
}

function computeDoom(scored){
  // Aggregate category scores
  const catScores = {};
  for (const c of CATS) catScores[c.key] = 0;

  for (const s of scored){
    for (const c of CATS){
      const hits = s.hits[c.key] || 0;
      catScores[c.key] += hits * c.weight;
    }
  }

  // Convert to 0–100-ish:
  // cap each category so one spammy theme doesn’t instantly hit 100
  const caps = {
    conflict: 40,
    climate: 28,
    econ: 22,
    dem: 24,
    cyber: 18,
    nuclear: 28,
    space: 12,
    misc: 18,
  };

  let sum = 0;
  let max = 0;
  for (const c of CATS){
    const cap = caps[c.key] ?? 20;
    const v = Math.min(catScores[c.key], cap);
    sum += v;
    max += cap;
  }

  const doom = max > 0 ? Math.round((sum / max) * 100) : 0;

  return { doom, catScores };
}

function doomLabel(doom){
  if (doom >= 95) return "The sky is screaming.";
  if (doom >= 85) return "Uh oh.";
  if (doom >= 70) return "Spicy news day.";
  if (doom >= 40) return "Unsettling vibes.";
  if (doom >= 15) return "We’re so back.";
  return "Chill (suspiciously).";
}

function renderMeters(catScores){
  const wrap = $("meters");
  wrap.innerHTML = "";

  // Normalize each category score into 0–100 per-category bar
  // Use the same caps as computeDoom for consistent feel
  const caps = {
    conflict: 40,
    climate: 28,
    econ: 22,
    dem: 24,
    cyber: 18,
    nuclear: 28,
    space: 12,
    misc: 18,
  };

  for (const c of CATS){
    const cap = caps[c.key] ?? 20;
    const raw = catScores[c.key] || 0;
    const pct = Math.max(0, Math.min(100, Math.round((raw / cap) * 100)));

    const row = document.createElement("div");
    row.className = "meterRow";

    const name = document.createElement("div");
    name.className = "meterName";
    name.textContent = c.label;

    const track = document.createElement("div");
    track.className = "meterTrack";

    const fill = document.createElement("div");
    fill.className = "meterFill";
    fill.style.width = pct + "%";
    paintFill(fill, pct);

    track.appendChild(fill);

    const val = document.createElement("div");
    val.className = "meterValue";
    val.textContent = pct;

    row.appendChild(name);
    row.appendChild(track);
    row.appendChild(val);

    wrap.appendChild(row);
  }
}

function renderDrivers(scored){
  const wrap = $("drivers");
  wrap.innerHTML = "";

  const top = scored.slice(0, 5);
  if (top.length === 0){
    const d = document.createElement("div");
    d.className = "muted";
    d.textContent = "No drivers found (filters too strict or empty feed).";
    wrap.appendChild(d);
    return;
  }

  for (const a of top){
    const box = document.createElement("div");
    box.className = "driver";

    const t = document.createElement("div");
    t.className = "driverTitle";
    t.textContent = a.title;

    const m = document.createElement("div");
    m.className = "driverMeta";
    m.textContent = `${a.domain} • ${a.lang || "—"}${a.country ? " • " + a.country : ""}`;

    box.appendChild(t);
    box.appendChild(m);
    wrap.appendChild(box);
  }
}

function renderStories(scored){
  const wrap = $("stories");
  wrap.innerHTML = "";

  const list = scored.slice(0, 14);
  if (list.length === 0){
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.textContent = "No articles returned.";
    wrap.appendChild(empty);
    return;
  }

  for (const a of list){
    const link = document.createElement("a");
    link.className = "story";
    link.href = a.url || "#";
    link.target = "_blank";
    link.rel = "noopener noreferrer";

    const title = document.createElement("div");
    title.className = "storyTitle";
    title.textContent = a.title;

    const meta = document.createElement("div");
    meta.className = "storyMeta";
    meta.textContent = `${a.domain} • ${a.lang || "—"}`;

    link.appendChild(title);
    link.appendChild(meta);
    wrap.appendChild(link);
  }
}

async function refresh(){
  show("errorBox", false);
  setText("statusPill", "Loading…");
  $("statusPill").classList.remove("muted");

  const url = gdeltURL(DEFAULT_QUERY);
  const res = await fetchJSON(url);

  const payload = normalizePayload(res.json);
  if (!res.ok || !payload.ok){
    show("errorBox", true);
    const keys = payload.keys ? payload.keys.join(", ") : "";
    const routes = payload.routes ? `Routes: ${payload.routes.join(", ")}` : "";
    const example = payload.example ? `Example: ${payload.example}` : "";
    const tried = `Tried: ${url}`;
    setText("errorText",
      `No articles returned. Response keys: ${keys}\n` +
      `Error: ${payload.error || "Request failed"}\n` +
      (routes ? routes + "\n" : "") +
      (example ? example + "\n" : "") +
      tried
    );

    setText("statusPill", "No articles");
    $("statusPill").classList.add("muted");
    return;
  }

  const articles = payload.articles || [];
  const scored = scoreArticles(articles);
  const { doom, catScores } = computeDoom(scored);

  // Header
  setText("updatedPill", `Updated: ${nowStamp()}`);
  setText("statusPill", "OK");
  $("statusPill").classList.add("muted");
  setText("samplePill", `Sample: ${scored.length} headlines`);

  // Doom index
  setText("doomValue", String(doom));
  setText("doomLabel", doomLabel(doom));
  $("doomFill").style.width = `${doom}%`;
  paintFill($("doomFill"), doom);

  // Tag pill
  const tag = colorForScore(doom);
  setText("doomTag", tag === "fire" ? "ON FIRE" : tag.toUpperCase());

  // Breakdown meters + drivers + stories
  renderMeters(catScores);
  renderDrivers(scored);
  renderStories(scored);
}

function openAbout(){ show("aboutBox", true); }
function closeAbout(){ show("aboutBox", false); }

function init(){
  setText("version", VERSION);

  $("refreshBtn").addEventListener("click", refresh);
  $("aboutBtn").addEventListener("click", openAbout);
  $("closeAboutBtn").addEventListener("click", closeAbout);

  // Initial load
  refresh();
}

init();
