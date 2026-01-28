/* Doom-meter — app.js (JSONP-only, GitHub Pages safe)
   Uses GDELT DOC 2.1 endpoint via JSONP to avoid CORS issues.
*/

const VERSION = "v1.5.0";

// Use the domain you confirmed works on your phone:
const GDELT_BASE = "https://i.gdeltproject.org/api/v2/doc/doc";

// Short timeouts so the UI doesn’t hang forever
const JSONP_TIMEOUT_MS = 9000;

// How many articles per “driver” query to pull
const PER_DRIVER_MAX = 25;

// Timespan values GDELT accepts often include: 6h, 12h, 24h, 3d, 7d
const DEFAULT_TIMESPAN = "24h";

// A few broad “drivers” to get a decent mix of headlines
const DRIVERS = [
  { label: "Conflict", query: '(war OR conflict OR ceasefire OR missile OR invasion OR strike OR attack)' },
  { label: "Economy", query: '(inflation OR recession OR layoffs OR bankruptcy OR debt OR rates OR "central bank")' },
  { label: "Climate", query: '(wildfire OR heatwave OR hurricane OR flood OR drought OR "climate change")' },
  { label: "Cyber", query: '(ransomware OR hack OR breach OR "data leak" OR malware)' },
  { label: "Democracy", query: '(election OR protest OR coup OR "state of emergency" OR impeachment)' },
  { label: "Space", query: '(asteroid OR meteor OR "solar flare" OR "space junk")' },
];

// DOM refs (must match ids in index.html below)
const els = {
  refreshBtn: document.getElementById("refreshBtn"),
  aboutBtn: document.getElementById("aboutBtn"),

  doomValue: document.getElementById("doomValue"),
  doomLabel: document.getElementById("doomLabel"),
  meterFill: document.getElementById("meterFill"),
  updatedAt: document.getElementById("updatedAt"),
  versionTag: document.getElementById("versionTag"),

  breakdownList: document.getElementById("breakdownList"),
  driversList: document.getElementById("driversList"),
  storiesList: document.getElementById("storiesList"),

  modalBackdrop: document.getElementById("modalBackdrop"),
  modal: document.getElementById("modal"),
  modalTitle: document.getElementById("modalTitle"),
  modalSatire: document.getElementById("modalSatire"),
  modalLink: document.getElementById("modalLink"),
  closeModal: document.getElementById("closeModal"),
};

// ---------- Utilities ----------
function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function safeText(s) {
  return (s == null) ? "" : String(s);
}

function normalizeTitle(t) {
  return safeText(t)
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function formatWhen() {
  return new Date().toLocaleString();
}

// ---------- JSONP helper ----------
function jsonp(url) {
  return new Promise((resolve, reject) => {
    const cb = "__doom_cb_" + Math.random().toString(36).slice(2);
    const script = document.createElement("script");

    let done = false;
    const cleanup = () => {
      if (script.parentNode) script.parentNode.removeChild(script);
      try { delete window[cb]; } catch (e) { window[cb] = undefined; }
    };

    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      cleanup();
      reject(new Error("JSONP timeout (GDELT slow or blocked)"));
    }, JSONP_TIMEOUT_MS);

    window[cb] = (data) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      cleanup();
      resolve(data);
    };

    // Ensure callback is included
    const u = new URL(url);
    u.searchParams.set("format", "jsonp");
    u.searchParams.set("callback", cb);

    script.src = u.toString();
    script.onerror = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      cleanup();
      reject(new Error("JSONP script error (blocked request / bad response)"));
    };

    document.body.appendChild(script);
  });
}

// ---------- GDELT fetch ----------
async function fetchGdeltArticles(query, timespan = DEFAULT_TIMESPAN, maxrecords = PER_DRIVER_MAX) {
  const u = new URL(GDELT_BASE);
  u.searchParams.set("query", query);
  u.searchParams.set("mode", "artlist");
  u.searchParams.set("sort", "datedesc");
  u.searchParams.set("format", "jsonp"); // jsonp() will also enforce
  u.searchParams.set("format", "jsonp");
  u.searchParams.set("maxrecords", String(maxrecords));
  u.searchParams.set("format", "jsonp"); // redundant on purpose (some CDNs are weird)
  u.searchParams.set("format", "jsonp");
  u.searchParams.set("format", "jsonp");
  // timespan is supported by DOC 2.1; keep it simple
  u.searchParams.set("timespan", timespan);

  const data = await jsonp(u.toString());
  const articles = (data && Array.isArray(data.articles)) ? data.articles : [];
  return articles;
}

function dedupe(articles) {
  const seen = new Set();
  const out = [];

  for (const a of articles) {
    const key = normalizeTitle(a.title || "") + "|" + safeText(a.url || "");
    if (!key.trim() || seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

// ---------- Doom scoring ----------
function classify(title) {
  const t = normalizeTitle(title);

  // Very dumb, very proud keyword scoring (satire-friendly)
  const hits = {
    conflict_heat: /(war|conflict|missile|strike|attack|invasion|ceasefire|airstrike)/,
    climate_weirdness: /(wildfire|heatwave|hurricane|flood|drought|climate|storm)/,
    economy_panic: /(inflation|recession|layoff|layoffs|bankrupt|debt|rates|crash)/,
    democracy_melting: /(election|protest|coup|impeach|state of emergency|authoritarian)/,
    cyber_chaos: /(ransomware|hack|breach|malware|cyber|data leak)/,
    nuclear_words: /(nuclear|reactor|uranium|plutonium|icbm)/,
    space_rocks: /(asteroid|meteor|comet|solar flare|space junk)/,
    misc_chaos: /(shooting|earthquake|outbreak|pandemic|explosion|hostage|riot)/,
  };

  const breakdown = {
    conflict_heat: 0,
    climate_weirdness: 0,
    economy_panic: 0,
    democracy_melting: 0,
    cyber_chaos: 0,
    nuclear_words: 0,
    space_rocks: 0,
    misc_chaos: 0,
    hope_competence: 0, // unused but fun
  };

  // Add 1 for any bucket hit
  for (const k of Object.keys(hits)) {
    if (hits[k].test(t)) breakdown[k] = 1;
  }

  // Weight: some words just *feel* doomier
  const weight =
    breakdown.nuclear_words * 5 +
    breakdown.conflict_heat * 3 +
    breakdown.cyber_chaos * 2 +
    breakdown.democracy_melting * 2 +
    breakdown.economy_panic * 2 +
    breakdown.climate_weirdness * 2 +
    breakdown.space_rocks * 1 +
    breakdown.misc_chaos * 1;

  // Add a pinch of chaos if lots of punctuation / ALL CAPS
  const caps = (title.match(/[A-Z]{4,}/g) || []).length;
  const bangs = (title.match(/[!?!]{2,}/g) || []).length;
  const spice = clamp(caps + bangs, 0, 3);

  return { breakdown, weight: weight + spice };
}

function satireLine(title) {
  const t = safeText(title).trim();
  const templates = [
    `Experts confirm "${t}" is normal and good.`,
    `Scientists recommend blinking twice, slowly, after reading: "${t}".`,
    `"${t}" — the universe is doing bits again.`,
    `Breaking: "${t}". Time to become a forest hermit (economy permitting).`,
    `"${t}" reportedly caused three group chats to combust.`,
  ];
  return templates[Math.floor(Math.random() * templates.length)];
}

function labelFor(doomIndex) {
  if (doomIndex < 15) return "We’re so back.";
  if (doomIndex < 35) return "Mildly cursed vibes.";
  if (doomIndex < 55) return "Okay this is… a lot.";
  if (doomIndex < 75) return "The omens are loud.";
  if (doomIndex < 90) return "Call the council of elders.";
  return "Run. (But with dignity.)";
}

function computeResult(rawArticles) {
  const stories = rawArticles.map((a) => {
    const title = a.title || "Untitled headline";
    const url = a.url || "#";
    const source = a.domain || a.sourceCountry || "Unknown source";
    const publishedAt = a.seendate || a.datetime || "";

    const { breakdown, weight } = classify(title);
    return {
      id: normalizeTitle(title).slice(0, 60) + "|" + url,
      title,
      url,
      source,
      publishedAt,
      weight,
      breakdown,
      satire: satireLine(title),
    };
  });

  // Sum breakdown counts across stories (so bars show “how many headlines hit this bucket”)
  const totalBreakdown = {
    conflict_heat: 0,
    climate_weirdness: 0,
    economy_panic: 0,
    democracy_melting: 0,
    cyber_chaos: 0,
    nuclear_words: 0,
    space_rocks: 0,
    misc_chaos: 0,
    hope_competence: 0,
  };

  for (const s of stories) {
    for (const k of Object.keys(totalBreakdown)) {
      totalBreakdown[k] += (s.breakdown[k] || 0);
    }
  }

  const avgWeight = stories.length
    ? stories.reduce((sum, s) => sum + s.weight, 0) / stories.length
    : 0;

  // Map average weight to 0..100
  const doomIndex = clamp(Math.round(avgWeight * 12), 0, 100);

  // “Drivers” = biggest weighted stories
  const drivers = [...stories]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 8);

  // Latest stories list
  const latest = [...stories].slice(0, 40);

  return {
    doomIndex,
    doomLabel: labelFor(doomIndex),
    breakdown: totalBreakdown,
    drivers,
    stories: latest,
  };
}

// ---------- Rendering ----------
function clearLists() {
  els.breakdownList.innerHTML = "";
  els.driversList.innerHTML = "";
  els.storiesList.innerHTML = "";
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

  const maxVal = Math.max(1, ...keys.map(([k]) => breakdown[k] || 0));

  keys.forEach(([k, label]) => {
    const v = breakdown[k] || 0;
    const pct = Math.round((v / maxVal) * 100);

    const row = document.createElement("div");
    row.className = "row";

    const left = document.createElement("div");
    left.className = "row_left";

    const name = document.createElement("div");
    name.className = "row_name";
    name.textContent = label;

    const bar = document.createElement("div");
    bar.className = "bar";
    const fill = document.createElement("div");
    fill.className = "bar_fill";
    fill.style.width = `${pct}%`;
    bar.appendChild(fill);

    left.appendChild(name);
    left.appendChild(bar);

    const right = document.createElement("div");
    right.className = "row_value";
    right.textContent = String(v);

    row.appendChild(left);
    row.appendChild(right);

    els.breakdownList.appendChild(row);
  });
}

function storyCard(story) {
  const div = document.createElement("div");
  div.className = "item";
  div.style.cursor = "pointer";

  const title = document.createElement("div");
  title.className = "item__title";
  title.textContent = story.title;

  const meta = document.createElement("div");
  meta.className = "item__meta";
  meta.textContent = `${story.source} • weight ${story.weight}`;

  const satire = document.createElement("div");
  satire.className = "item__satire";
  satire.textContent = story.satire;

  div.appendChild(title);
  div.appendChild(meta);
  div.appendChild(satire);

  div.addEventListener("click", () => openModal(story));
  return div;
}

function renderLists({ drivers, stories }) {
  els.driversList.innerHTML = "";
  drivers.forEach((s) => els.driversList.appendChild(storyCard(s)));

  els.storiesList.innerHTML = "";
  stories.forEach((s) => els.storiesList.appendChild(storyCard(s)));
}

// ---------- Modal ----------
function openModal(story) {
  els.modalTitle.textContent = story.title;
  els.modalSatire.textContent = story.satire;

  els.modalLink.href = story.url || "#";
  els.modalLink.target = "_blank";
  els.modalLink.rel = "noopener noreferrer";

  els.modalBackdrop.classList.remove("hidden");
  els.modal.classList.remove("hidden");
}

function closeModal() {
  els.modalBackdrop.classList.add("hidden");
  els.modal.classList.add("hidden");
}

// ---------- Main refresh ----------
async function refresh() {
  els.versionTag.textContent = VERSION;

  els.doomValue.textContent = "…";
  els.doomLabel.textContent = "Consulting the omens…";
  els.meterFill.style.width = "0%";
  els.updatedAt.textContent = "";
  clearLists();

  const errors = [];

  try {
    // Pull all driver queries in parallel
    const pulls = await Promise.all(
      DRIVERS.map(async (d) => {
        try {
          const arts = await fetchGdeltArticles(d.query, DEFAULT_TIMESPAN, PER_DRIVER_MAX);
          return arts;
        } catch (e) {
          errors.push(`${d.label}: ${e.message}`);
          return [];
        }
      })
    );

    const all = dedupe(pulls.flat()).slice(0, 160);

    if (!all.length) {
      const msg = errors.length
        ? `GDELT error(s): ${errors.join(" | ")}`
        : "Empty result set (no articles returned).";

      els.doomValue.textContent = "!!";
      els.doomLabel.textContent = "Error loading headlines.";
      els.meterFill.style.width = "0%";
      els.updatedAt.textContent = `${VERSION} • ${formatWhen()}`;

      // Show a “no articles” box using the stories list area
      els.storiesList.innerHTML = `
        <div class="empty">
          <div class="empty__title">No articles returned.</div>
          <div class="empty__meta">${msg}</div>
          <div class="empty__hint">Tip: if you have a strict adblocker / privacy mode, it may block JSONP requests to i.gdeltproject.org.</div>
        </div>
      `;
      return;
    }

    const result = computeResult(all);

    els.doomValue.textContent = String(result.doomIndex);
    els.doomLabel.textContent = result.doomLabel;
    els.meterFill.style.width = `${result.doomIndex}%`;
    els.updatedAt.textContent = `${VERSION} • ${formatWhen()}`;

    renderBreakdown(result.breakdown);
    renderLists(result);
  } catch (err) {
    els.doomValue.textContent = "!!";
    els.doomLabel.textContent = "Error loading headlines.";
    els.meterFill.style.width = "0%";
    els.updatedAt.textContent = `${VERSION} • ${formatWhen()}`;

    els.storiesList.innerHTML = `
      <div class="empty">
        <div class="empty__title">Crash in refresh()</div>
        <div class="empty__meta">${safeText(err && err.message ? err.message : err)}</div>
      </div>
    `;
  }
}

// ---------- Wire up ----------
els.refreshBtn.addEventListener("click", refresh);
els.aboutBtn.addEventListener("click", () => {
  // Just scroll to the about card if present
  const about = document.getElementById("aboutCard");
  if (about) about.scrollIntoView({ behavior: "smooth", block: "start" });
});

els.closeModal.addEventListener("click", closeModal);
els.modalBackdrop.addEventListener("click", closeModal);

// Kick off
refresh();
