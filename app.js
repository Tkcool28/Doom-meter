/* Doomroom News (GitHub Pages) */
const VERSION = "v3.2.0";
const PROXY_BASE = "https://doom-proxy.toddkirschman.workers.dev";

/** UI helpers */
const $ = (id) => document.getElementById(id);

function setText(id, text) {
  const el = $(id);
  if (el) el.textContent = text;
}

function show(id, on = true) {
  const el = $(id);
  if (!el) return;
  el.style.display = on ? "" : "none";
}

function nowStamp() {
  return new Date().toLocaleString();
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function tierColor(val) {
  // 0-34 green, 35-69 yellow, 70-89 red, 90+ fire
  if (val >= 90) return "fire";
  if (val >= 70) return "red";
  if (val >= 35) return "yellow";
  return "green";
}

function applyFillColor(el, val) {
  const tier = tierColor(val);
  if (!el) return;

  if (tier === "green") {
    el.style.background = "var(--green)";
    el.style.boxShadow = "0 0 18px rgba(34,197,94,.22)";
  } else if (tier === "yellow") {
    el.style.background = "var(--yellow)";
    el.style.boxShadow = "0 0 18px rgba(251,191,36,.20)";
  } else if (tier === "red") {
    el.style.background = "var(--red)";
    el.style.boxShadow = "0 0 18px rgba(239,68,68,.20)";
  } else {
    // fire
    el.style.background = "linear-gradient(90deg, var(--fire1), var(--fire2))";
    el.style.boxShadow = "0 0 22px rgba(255,149,0,.28)";
  }
}

/** Fetch */
async function fetchText(url, timeoutMs = 12000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: "GET", mode: "cors", cache: "no-store", signal: ctl.signal });
    const txt = await res.text();
    return { ok: res.ok, status: res.status, text: txt };
  } catch (e) {
    return { ok: false, status: 0, text: String(e) };
  } finally {
    clearTimeout(t);
  }
}

function normalizePayload(rawText) {
  // Worker may return either {articles:[...]} or {data:{articles:[...]}} or an error shape
  let payload;
  try {
    payload = JSON.parse(rawText);
  } catch {
    return {
      ok: false,
      meta: { kind: "error", error: "Non-JSON response", preview: rawText.slice(0, 180) },
      articles: [],
    };
  }

  if (payload && (payload.error || payload.ok === false)) {
    return {
      ok: false,
      meta: {
        kind: "error",
        error: payload.error || "Unknown error",
        routes: payload.routes,
        example: payload.example,
        keys: Object.keys(payload),
      },
      articles: [],
    };
  }

  if (payload && Array.isArray(payload.articles)) {
    return { ok: true, meta: { kind: "articles" }, articles: payload.articles };
  }
  if (payload && payload.data && Array.isArray(payload.data.articles)) {
    return { ok: true, meta: { kind: "data.articles" }, articles: payload.data.articles };
  }

  return { ok: false, meta: { kind: "unknown", keys: Object.keys(payload || {}) }, articles: [] };
}

/** Doom scoring (simple + fun, not prophecy, not science, don’t @ me) */
const CATS = [
  {
    key: "conflict",
    name: "Conflict Heat",
    weight: 2.0,
    words: ["war", "strike", "missile", "attack", "invasion", "troops", "airstrike", "hostage", "shelling", "ceasefire", "iran", "gaza", "ukraine", "russia", "nato"],
  },
  {
    key: "climate",
    name: "Climate Weirdness",
    weight: 1.5,
    words: ["heat", "wildfire", "hurricane", "flood", "drought", "storm", "climate", "record temperatures", "tornado", "blizzard", "ice", "earthquake"],
  },
  {
    key: "economy",
    name: "Economic Drama",
    weight: 1.3,
    words: ["recession", "inflation", "crash", "layoffs", "defaults", "debt", "bank", "rates", "tariff", "sanctions", "market plunges"],
  },
  {
    key: "democracy",
    name: "Democracy Melting",
    weight: 1.4,
    words: ["election", "fraud", "authoritarian", "coup", "protest", "riot", "ban", "court", "impeach", "corruption", "press freedom", "martial law"],
  },
  {
    key: "cyber",
    name: "Cyber Chaos",
    weight: 1.6,
    words: ["hack", "breach", "ransomware", "leak", "cyberattack", "outage", "ddos", "zero-day", "data stolen"],
  },
  {
    key: "nuclear",
    name: "Nuclear Words",
    weight: 2.2,
    words: ["nuclear", "uranium", "warhead", "enrichment", "icbm", "reactor", "radiation"],
  },
  {
    key: "space",
    name: "Space Rocks",
    weight: 2.5,
    words: ["asteroid", "meteor", "comet", "impact", "near-earth", "nasa warns"],
  },
  {
    key: "misc",
    name: "Misc. Chaos",
    weight: 0.8,
    words: ["shooting", "killed", "explosion", "hostage", "massive fire", "collapse", "deadly", "evacuations", "pandemic", "outbreak"],
  },
];

function scoreArticles(articles) {
  const byCat = Object.fromEntries(CATS.map(c => [c.key, 0]));
  const drivers = [];

  for (const a of articles) {
    const title = String(a.title || "").toLowerCase();
    const url = a.url || "";
    const domain = a.domain || safeDomain(url);

    let points = 0;
    const hits = [];

    for (const c of CATS) {
      let hitCount = 0;
      for (const w of c.words) {
        if (title.includes(w)) hitCount++;
      }
      if (hitCount > 0) {
        // base points per hit scaled by category
        const add = Math.min(25, Math.round(hitCount * c.weight * 4));
        byCat[c.key] += add;
        points += add;
        hits.push({ cat: c.key, add });
      }
    }

    if (points > 0) {
      drivers.push({
        title: a.title || "(untitled)",
        url,
        domain,
        points,
      });
    }
  }

  // Clamp each category to 0..100 for display
  for (const c of CATS) {
    byCat[c.key] = clamp(byCat[c.key], 0, 100);
  }

  // Overall doom is a weighted-ish blend, then clamp
  const total = CATS.reduce((sum, c) => sum + byCat[c.key] * (c.weight / 2.0), 0);
  const doom = clamp(Math.round(total / 3.2), 0, 100);

  drivers.sort((a, b) => b.points - a.points);

  return { doom, byCat, drivers: drivers.slice(0, 5) };
}

function safeDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); }
  catch { return ""; }
}

/** Render */
function renderMeters(byCat) {
  const box = $("meters");
  if (!box) return;
  box.innerHTML = "";

  for (const c of CATS) {
    const val = byCat[c.key] ?? 0;

    const row = document.createElement("div");
    row.className = "meterRow";

    const name = document.createElement("div");
    name.className = "meterName";
    name.textContent = c.name;

    const track = document.createElement("div");
    track.className = "meterTrack";

    const fill = document.createElement("div");
    fill.className = "meterFill";
    fill.style.width = `${clamp(val, 0, 100)}%`;
    applyFillColor(fill, val);

    track.appendChild(fill);

    const out = document.createElement("div");
    out.className = "meterVal";
    out.textContent = String(val);

    row.appendChild(name);
    row.appendChild(track);
    row.appendChild(out);

    box.appendChild(row);
  }
}

function renderDrivers(list) {
  const box = $("drivers");
  if (!box) return;
  box.innerHTML = "";

  if (!list || list.length === 0) {
    const d = document.createElement("div");
    d.className = "muted";
    d.textContent = "No strong drivers detected. (The calm before the doom?)";
    box.appendChild(d);
    return;
  }

  for (const it of list) {
    const a = document.createElement("a");
    a.className = "story";
    a.href = it.url || "#";
    a.target = "_blank";
    a.rel = "noopener noreferrer";

    const t = document.createElement("div");
    t.className = "storyTitle";
    t.textContent = it.title;

    const m = document.createElement("div");
    m.className = "storyMeta";
    m.textContent = `${it.domain || "source"} • driver score ${it.points}`;

    a.appendChild(t);
    a.appendChild(m);
    box.appendChild(a);
  }
}

function renderStories(articles) {
  const box = $("stories");
  if (!box) return;
  box.innerHTML = "";

  if (!articles || articles.length === 0) {
    const d = document.createElement("div");
    d.className = "muted";
    d.textContent = "No articles returned.";
    box.appendChild(d);
    return;
  }

  for (const a0 of articles.slice(0, 12)) {
    const a = document.createElement("a");
    a.className = "story";
    a.href = a0.url || "#";
    a.target = "_blank";
    a.rel = "noopener noreferrer";

    const t = document.createElement("div");
    t.className = "storyTitle";
    t.textContent = a0.title || "(untitled)";

    const meta = document.createElement("div");
    meta.className = "storyMeta";
    const domain = a0.domain || safeDomain(a0.url || "");
    const lang = a0.language ? ` • ${a0.language}` : "";
    const country = a0.sourcecountry ? ` • ${a0.sourcecountry}` : "";
    meta.textContent = `${domain || "source"}${lang}${country}`;

    a.appendChild(t);
    a.appendChild(meta);
    box.appendChild(a);
  }
}

/** Main */
async function load() {
  setText("version", VERSION);
  show("errorBox", false);
  setText("statusPill", "Refreshing…");

  const query = "world";
  const url = `${PROXY_BASE}/gdelt?query=${encodeURIComponent(query)}&mode=ArtList&format=json&maxrecords=50&timespan=1d&t=${Date.now()}`;

  const res = await fetchText(url);
  const norm = normalizePayload(res.text);

  if (!res.ok || !norm.ok) {
    show("errorBox", true);
    setText("errorText", `No articles returned. Response keys: ${norm.meta?.keys?.join(", ") || "?"}\nError: ${norm.meta?.error || "Not found"}\nTried: ${url}`);
    setText("statusPill", "Idle");
    setText("updatedPill", `Updated: ${nowStamp()}`);
    setText("doomBig", "—");
    setText("doomLabel", "No data");
    $("doomFill").style.width = "0%";
    return;
  }

  // Filter English + United States (if present)
  const all = norm.articles || [];
  const filtered = all.filter(a =>
    String(a.language || "").toLowerCase() === "english" &&
    String(a.sourcecountry || "").toLowerCase() === "united states"
  );

  const sample = filtered.slice(0, 50);

  // Score
  const scored = scoreArticles(sample);

  // Hero
  setText("doomBig", String(scored.doom));
  setText("updatedPill", `Updated: ${nowStamp()}`);
  setText("samplePill", `Sample: ${sample.length} headlines`);
  setText("filterPill", "Filter: English / United States");

  const label =
    scored.doom >= 90 ? "We are so cooked." :
    scored.doom >= 70 ? "Not great, chief." :
    scored.doom >= 35 ? "Yellow flag vibes." :
    "Chill (suspiciously).";

  setText("doomLabel", label);

  const doomFill = $("doomFill");
  doomFill.style.width = `${scored.doom}%`;
  applyFillColor(doomFill, scored.doom);

  // Breakdown + lists
  renderMeters(scored.byCat);
  renderDrivers(scored.drivers);
  renderStories(sample);

  setText("statusPill", "OK");
}

function wire() {
  $("refreshBtn")?.addEventListener("click", load);
  $("aboutBtn")?.addEventListener("click", () => {
    alert(
      "This app is satire.\n\nIt uses real headlines.\nIt is not a forecast, prophecy, or financial advice.\n\nDoom responsibly."
    );
  });
}

wire();
load();
