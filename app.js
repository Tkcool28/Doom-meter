/* Doomroom News — GitHub Pages safe build
   Fix: avoid JSONP (often blocked / wrong MIME). Use JSON via CORS-safe proxies with fallbacks.
*/

const VERSION = "v2.0.0";

// ---- Settings ----
const DEFAULT_TIMESPAN = "6h";
const MAXRECORDS_PER_QUERY = 60;

// Prefer the official API domain, but keep a backup.
const GDELT_BASES = [
  "https://api.gdeltproject.org/api/v2/doc/doc",
  "https://i.gdeltproject.org/api/v2/doc/doc",
];

// CORS proxy fallbacks (public services can be flaky; we try multiple).
const PROXIES = [
  // returns raw body with permissive CORS
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  // simple proxy wrapper
  (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
];

// Topic “drivers” (your app’s categories)
const DRIVERS = [
  { key: "conflict_heat", label: "Conflict Heat", query: "war OR missile OR drone OR invasion OR ceasefire OR strike" },
  { key: "climate_weirdness", label: "Climate Weirdness", query: "climate OR heatwave OR wildfire OR flood OR drought OR storm" },
  { key: "economy_panic", label: "Economic Drama", query: "recession OR inflation OR layoffs OR rates OR bank OR debt OR GDP" },
  { key: "democracy_melting", label: "Democracy Melting", query: "election OR coup OR protest OR crackdown OR corruption OR fraud" },
  { key: "cyber_chaos", label: "Cyber Chaos", query: "hack OR ransomware OR breach OR malware OR leak OR ddos" },
  { key: "nuclear_words", label: "Nuclear Words", query: "nuclear OR radiation OR uranium OR reactor OR warhead" },
  { key: "space_rocks", label: "Space Rocks", query: "asteroid OR meteor OR comet OR rocket OR satellite OR lunar OR mars" },
  { key: "misc_chaos", label: "Misc. Chaos", query: "earthquake OR outbreak OR explosion OR hostage OR wildfire OR derailment" },
];

// ---- DOM ----
const els = {
  refreshBtn: document.getElementById("refreshBtn"),
  aboutBtn: document.getElementById("aboutBtn"),

  statusPill: document.getElementById("statusPill"),

  doomValue: document.getElementById("doomValue"),
  doomLabel: document.getElementById("doomLabel"),
  meterFill: document.getElementById("meterFill"),
  updatedAt: document.getElementById("updatedAt"),

  breakdownList: document.getElementById("breakdownList"),
  driversList: document.getElementById("driversList"),
  storiesList: document.getElementById("storiesList"),

  aboutCard: document.getElementById("aboutCard"),

  modalBackdrop: document.getElementById("modalBackdrop"),
  modal: document.getElementById("modal"),
  closeModal: document.getElementById("closeModal"),
  modalTitle: document.getElementById("modalTitle"),
  modalSatire: document.getElementById("modalSatire"),
  modalLink: document.getElementById("modalLink"),
};

// ---- Helpers ----
function setStatus(text, isError = false) {
  if (!els.statusPill) return;
  els.statusPill.textContent = text;
  els.statusPill.classList.toggle("error", !!isError);
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function safeJSONParse(text) {
  // handle occasional proxy prefixes
  const cleaned = text.trim().replace(/^\)\]\}',?\s*/, "");
  return JSON.parse(cleaned);
}

async function fetchTextWithTimeout(url, timeoutMs = 12000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "GET",
      signal: ctl.signal,
      cache: "no-store",
      redirect: "follow",
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

async function fetchGdeltJSON(url) {
  // Try direct first (sometimes works, depending on headers / browser)
  try {
    const text = await fetchTextWithTimeout(url, 9000);
    return safeJSONParse(text);
  } catch (_) {
    // ignore; fall through to proxies
  }

  // Try proxy fallbacks
  const errors = [];
  for (const makeProxyUrl of PROXIES) {
    const proxied = makeProxyUrl(url);
    try {
      const text = await fetchTextWithTimeout(proxied, 14000);
      return safeJSONParse(text);
    } catch (e) {
      errors.push(String(e?.message || e));
      // small backoff between flaky proxies
      await sleep(250);
    }
  }

  throw new Error(`Blocked or bad response. Tried proxies; last errors: ${errors.slice(-2).join(" | ")}`);
}

function buildGdeltUrl(base, query, timespan, maxrecords) {
  const u = new URL(base);
  u.searchParams.set("query", query);
  u.searchParams.set("mode", "ArtList");
  u.searchParams.set("format", "json");
  u.searchParams.set("sort", "datedesc");
  u.searchParams.set("timespan", timespan);
  u.searchParams.set("maxrecords", String(maxrecords));
  return u.toString();
}

async function fetchDriverArticles(driverQuery, timespan, maxrecords) {
  // Try each GDELT base URL, in order.
  let lastErr = null;
  for (const base of GDELT_BASES) {
    const url = buildGdeltUrl(base, driverQuery, timespan, maxrecords);
    try {
      const data = await fetchGdeltJSON(url);
      const articles = Array.isArray(data?.articles) ? data.articles : [];
      return articles;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("Unknown GDELT failure.");
}

function normalizeTitle(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\w\s]/g, "")
    .trim();
}

function dedupeArticles(articles) {
  const seen = new Set();
  const out = [];
  for (const a of articles) {
    const key = normalizeTitle(a?.title || "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

function satireLine(title) {
  const t = String(title || "").toLowerCase();
  if (t.includes("nuclear")) return "The Geiger counter is doing jazz hands.";
  if (t.includes("war") || t.includes("missile") || t.includes("strike")) return "Diplomacy has left the chat.";
  if (t.includes("hack") || t.includes("ransomware") || t.includes("breach")) return "Someone clicked the suspicious PDF again.";
  if (t.includes("election") || t.includes("coup") || t.includes("protest")) return "Democracy is speedrunning hard mode.";
  if (t.includes("heat") || t.includes("wildfire") || t.includes("flood")) return "The weather is being emotionally expressive.";
  if (t.includes("recession") || t.includes("inflation") || t.includes("rates")) return "Markets are interpretive dancing.";
  if (t.includes("asteroid") || t.includes("meteor")) return "Space has opinions, apparently.";
  return "The shot selection is… experimental.";
}

function classifyTitle(title) {
  const t = String(title || "").toLowerCase();

  const hit = (words) => words.some((w) => t.includes(w));

  const tags = [];
  if (hit(["war", "missile", "drone", "invasion", "ceasefire", "strike"])) tags.push("conflict_heat");
  if (hit(["climate", "heat", "wildfire", "flood", "drought", "storm"])) tags.push("climate_weirdness");
  if (hit(["recession", "inflation", "layoff", "rates", "bank", "debt", "gdp"])) tags.push("economy_panic");
  if (hit(["election", "coup", "protest", "crackdown", "corruption", "fraud"])) tags.push("democracy_melting");
  if (hit(["hack", "ransomware", "breach", "malware", "leak", "ddos"])) tags.push("cyber_chaos");
  if (hit(["nuclear", "radiation", "uranium", "reactor", "warhead"])) tags.push("nuclear_words");
  if (hit(["asteroid", "meteor", "comet", "rocket", "satellite", "lunar", "mars"])) tags.push("space_rocks");

  if (tags.length === 0) tags.push("misc_chaos");

  // Weight = number of matched buckets (simple, readable, works fine)
  return { tags, weight: tags.length };
}

function compute(articles) {
  const breakdown = {
    conflict_heat: 0,
    climate_weirdness: 0,
    economy_panic: 0,
    democracy_melting: 0,
    cyber_chaos: 0,
    nuclear_words: 0,
    space_rocks: 0,
    misc_chaos: 0,
  };

  const stories = articles.map((a) => {
    const title = a?.title || "Untitled headline";
    const url = a?.url || "#";
    const source = a?.domain || a?.sourceCountry || "Unknown source";
    const publishedAt = a?.seendate || a?.date || "";

    const { tags, weight } = classifyTitle(title);
    for (const k of tags) breakdown[k] = (breakdown[k] || 0) + 1;

    return {
      title,
      url,
      source,
      publishedAt,
      weight,
      tags,
      satire: satireLine(title),
    };
  });

  const avgWeight =
    stories.length > 0 ? stories.reduce((s, x) => s + x.weight, 0) / stories.length : 0;

  // DoomIndex: scale avgWeight up to 0..100
  const doomIndex = clamp(Math.round(avgWeight * 28), 0, 100);

  const doomLabel =
    doomIndex <= 10 ? "We’re so back." :
    doomIndex <= 25 ? "Mildly concerning vibes." :
    doomIndex <= 45 ? "Moderate doom. Hydrate." :
    doomIndex <= 65 ? "Return to your bunk." :
    doomIndex <= 85 ? "Severe doom. Touch grass now." :
    "Maximum doom. The universe is laughing.";

  // Drivers = most common breakdown buckets
  const drivers = Object.entries(breakdown)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([k, v]) => ({ k, v }));

  return { doomIndex, doomLabel, breakdown, drivers, stories };
}

function renderBreakdown(breakdown) {
  const keys = [
    ["conflict_heat", "Conflict Heat"],
    ["climate_weirdness", "Climate Weirdness"],
    ["economy_panic", "Economic Drama"],
    ["democracy_melting", "Democracy Melting"],
    ["cyber_chaos", "Cyber Chaos"],
    ["nuclear_words", "Nuclear Words"],
    ["space_rocks", "Space Rocks"],
    ["misc_chaos", "Misc. Chaos"],
  ];

  els.breakdownList.innerHTML = "";
  const maxVal = Math.max(1, ...keys.map(([k]) => breakdown[k] || 0));

  for (const [k, label] of keys) {
    const v = breakdown[k] || 0;
    const pct = Math.round((v / maxVal) * 100);

    const row = document.createElement("div");
    row.className = "row";

    const left = document.createElement("div");
    left.style.flex = "1";

    const name = document.createElement("div");
    name.className = "row__name";
    name.textContent = label;

    const bar = document.createElement("div");
    bar.className = "bar";
    const fill = document.createElement("div");
    fill.className = "bar__fill";
    fill.style.width = `${pct}%`;
    bar.appendChild(fill);

    left.appendChild(name);
    left.appendChild(bar);

    const right = document.createElement("div");
    right.className = "row__value";
    right.textContent = String(v);

    row.appendChild(left);
    row.appendChild(right);

    els.breakdownList.appendChild(row);
  }
}

function storyCard(story, clickable = true) {
  const div = document.createElement("div");
  div.className = "item";

  const title = document.createElement("div");
  title.className = "item__title";
  title.textContent = story.title;

  const meta = document.createElement("div");
  meta.className = "item__meta";
  meta.textContent = `${story.source || "Unknown"} • weight ${story.weight}`;

  const satire = document.createElement("div");
  satire.className = "item__satire";
  satire.textContent = story.satire;

  div.appendChild(title);
  div.appendChild(meta);
  div.appendChild(satire);

  if (clickable) {
    div.style.cursor = "pointer";
    div.addEventListener("click", () => openModal(story));
  }

  return div;
}

function renderLists(result) {
  els.driversList.innerHTML = "";
  els.storiesList.innerHTML = "";

  // Top drivers as small text items
  for (const d of result.drivers) {
    const name = DRIVERS.find((x) => x.key === d.k)?.label || d.k;
    const item = document.createElement("div");
    item.className = "item";
    item.innerHTML = `<div class="item__title">${name}</div><div class="item__meta">${d.v} hits</div>`;
    els.driversList.appendChild(item);
  }

  // Latest stories (limit 40)
  result.stories.slice(0, 40).forEach((s) => els.storiesList.appendChild(storyCard(s, true)));
}

function openModal(story) {
  els.modalTitle.textContent = story.title;
  els.modalSatire.textContent = story.satire;
  els.modalLink.href = story.url || "#";
  els.modal.classList.remove("hidden");
  els.modalBackdrop.classList.remove("hidden");
}

function closeModal() {
  els.modal.classList.add("hidden");
  els.modalBackdrop.classList.add("hidden");
}

// ---- Main refresh ----
async function refresh() {
  try {
    els.refreshBtn.disabled = true;
    setStatus(`Consulting the omens… (${VERSION})`);
    els.doomValue.textContent = "—";
    els.doomLabel.textContent = "Consulting the omens…";
    els.meterFill.style.width = "0%";
    els.updatedAt.textContent = "";

    els.breakdownList.innerHTML = "";
    els.driversList.innerHTML = "";
    els.storiesList.innerHTML = "";

    const timespan = DEFAULT_TIMESPAN;

    // Pull each category separately (keeps variety), then merge.
    const pulls = await Promise.all(
      DRIVERS.map(async (d) => {
        try {
          const arts = await fetchDriverArticles(d.query, timespan, MAXRECORDS_PER_QUERY);
          return { key: d.key, label: d.label, articles: arts, error: null };
        } catch (e) {
          return { key: d.key, label: d.label, articles: [], error: String(e?.message || e) };
        }
      })
    );

    const errors = pulls.filter((p) => p.error).map((p) => `${p.label}: ${p.error}`);

    const all = dedupeArticles(pulls.flatMap((p) => p.articles)).slice(0, 140);

    if (all.length === 0) {
      els.doomValue.textContent = "!!";
      els.doomLabel.textContent = "Error loading headlines.";
      setStatus("No articles returned. Something is blocking the requests.", true);

      // Render a “why” card in story list
      const warn = document.createElement("div");
      warn.className = "item";
      warn.innerHTML =
        `<div class="item__title">No articles returned.</div>` +
        `<div class="item__meta">Tried direct + proxy fetch.</div>` +
        `<div class="item__satire">${errors.length ? "Errors: " + errors.join(" | ") : "No errors captured."}</div>` +
        `<div class="item__satire">If you’re using an adblocker / strict privacy mode, it may block API/proxy requests.</div>`;
      els.storiesList.appendChild(warn);

      return;
    }

    const result = compute(all);

    els.doomValue.textContent = String(result.doomIndex);
    els.doomLabel.textContent = result.doomLabel;
    els.meterFill.style.width = `${result.doomIndex}%`;
    els.updatedAt.textContent = `Updated: ${new Date().toLocaleString()} • ${VERSION}`;

    renderBreakdown(result.breakdown);
    renderLists(result);

    setStatus(`Loaded ${all.length} headlines. (${VERSION})`);
  } catch (err) {
    els.doomValue.textContent = "!!";
    els.doomLabel.textContent = "Error loading headlines.";
    setStatus(String(err?.message || err), true);
  } finally {
    els.refreshBtn.disabled = false;
  }
}

// ---- Wire up ----
els.refreshBtn?.addEventListener("click", refresh);
els.aboutBtn?.addEventListener("click", () => {
  // simple scroll-to about
  els.aboutCard?.scrollIntoView({ behavior: "smooth", block: "start" });
});

els.closeModal?.addEventListener("click", closeModal);
els.modalBackdrop?.addEventListener("click", closeModal);

// Kick off
setStatus(`Ready. (${VERSION})`);
refresh();
