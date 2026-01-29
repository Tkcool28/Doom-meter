/* Doomroom News — v3.1.0
   Fix: Use Cloudflare Worker as a CORS-safe proxy to GDELT DOC API JSON.
   Worker endpoint: https://doom-proxy.toddkirschman.workers.dev/gkg?query=...
*/

const VERSION = "v3.1.0";

// --- Settings ---
const WORKER_BASE = "https://doom-proxy.toddkirschman.workers.dev";
const WORKER_ROUTE = "/gkg";

const DEFAULT_TIMESPAN = "1d";          // for your own messaging; we build query text instead of GDELT timespan param
const MAXRECORDS_PER_QUERY = 20;        // keep it light for phones
const PROXY_FORMAT = "json";
const PROXY_MODE = "ArtList";

// Keep keywords simple + broad. GDELT query language supports boolean terms.
const DRIVERS = [
  { key: "conflict_heat", label: "Conflict Heat", query: "war OR conflict OR strike OR missile OR invasion OR drone OR attack OR troops OR shelling" },
  { key: "climate_weirdness", label: "Climate Weirdness", query: "climate OR wildfire OR flood OR hurricane OR drought OR heatwave OR storm OR smoke OR pollution OR emissions" },
  { key: "economic_drama", label: "Economic Drama", query: "recession OR inflation OR layoffs OR debt OR bank OR crash OR tariff OR unemployment OR market OR bailout" },
  { key: "democracy_melting", label: "Democracy Melting", query: "election OR coup OR protest OR crackdown OR corruption OR tribunal OR fraud OR authoritarian OR censorship" },
  { key: "cyber_chaos", label: "Cyber Chaos", query: "cyberattack OR ransomware OR breach OR hack OR outage OR ddos OR leak" },
  { key: "nuclear_words", label: "Nuclear Words", query: "nuclear OR radiation OR reactor OR uranium OR bomb OR warhead OR enrichment" },
  { key: "space_rocks", label: "Space Rocks", query: "asteroid OR meteor OR comet OR solar storm OR geomagnetic OR rocket explosion" },
  { key: "misc_chaos", label: "Misc Chaos", query: "pandemic OR outbreak OR biohazard OR collapse OR riot OR explosion OR hostage" },
];

// --- DOM ---
const els = {
  refreshBtn: document.getElementById("refreshBtn"),
  aboutBtn: document.getElementById("aboutBtn"),
  doomValue: document.getElementById("doomValue"),
  doomLabel: document.getElementById("doomLabel"),
  meterFill: document.getElementById("meterFill"),
  updatedAt: document.getElementById("updatedAt"),
  breakdownList: document.getElementById("breakdownList"),
  driversList: document.getElementById("driversList"),
  storiesList: document.getElementById("storiesList"),
  modalBackdrop: document.getElementById("modalBackdrop"),
  modal: document.getElementById("modal"),
  modalTitle: document.getElementById("modalTitle"),
  modalBody: document.getElementById("modalBody"),
  modalLink: document.getElementById("modalLink"),
  closeModal: document.getElementById("closeModal"),
  statusLine: document.getElementById("statusLine"),
  errorBox: document.getElementById("errorBox"),
  versionLine: document.getElementById("versionLine"),
};

function setStatus(msg) {
  if (!els.statusLine) return;
  els.statusLine.textContent = msg || "";
}

function setError(msg) {
  if (!els.errorBox) return;
  if (!msg) {
    els.errorBox.classList.add("hidden");
    els.errorBox.textContent = "";
    return;
  }
  els.errorBox.classList.remove("hidden");
  els.errorBox.textContent = msg;
}

function nowStamp() {
  return new Date().toLocaleString();
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// --- Worker fetch ---
async function fetchFromWorker(query, maxrecords = MAXRECORDS_PER_QUERY) {
  const u = new URL(WORKER_BASE + WORKER_ROUTE);
  u.searchParams.set("query", query);
  u.searchParams.set("mode", PROXY_MODE);
  u.searchParams.set("format", PROXY_FORMAT);
  u.searchParams.set("maxrecords", String(maxrecords));

  const resp = await fetch(u.toString(), {
    method: "GET",
    headers: { "Accept": "application/json" },
    cache: "no-store",
  });

  const text = await resp.text();

  if (!resp.ok) {
    // Worker returns JSON errors; try parsing, else show text
    try {
      const j = JSON.parse(text);
      throw new Error(`Worker ${resp.status}: ${j.error || j.statusText || "Bad response"}`);
    } catch {
      throw new Error(`Worker ${resp.status}: ${text.slice(0, 200)}`);
    }
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error("Worker returned non-JSON (unexpected).");
  }

  // GDELT doc/doc returns { articles: [...] } most of the time
  const articles = Array.isArray(data.articles) ? data.articles : [];
  return { articles, raw: data, url: u.toString() };
}

// --- Doom index logic ---
function scoreArticle(title = "") {
  const t = String(title).toLowerCase();
  // a silly heuristic: spicy words add points
  const hot = [
    "war", "missile", "attack", "invasion", "strike", "bomb", "nuclear",
    "hack", "ransomware", "breach", "outage",
    "wildfire", "hurricane", "flood", "heatwave",
    "crash", "collapse", "recession", "layoffs",
    "coup", "riot", "protest", "crackdown"
  ];
  let s = 0;
  for (const w of hot) if (t.includes(w)) s += 2;
  if (t.includes("killed") || t.includes("dead")) s += 3;
  if (t.includes("emergency") || t.includes("catastrophe")) s += 3;
  return s;
}

function computeDoom(articlesByDriver) {
  // Sum driver hits + article spiciness, normalize to 0–100
  let breakdown = {};
  let totalHits = 0;
  let spice = 0;

  for (const d of DRIVERS) {
    const arr = articlesByDriver[d.key] || [];
    breakdown[d.key] = arr.length;
    totalHits += arr.length;
    for (const a of arr) spice += scoreArticle(a.title);
  }

  // Heuristic scaling
  let raw = totalHits * 4 + spice;
  let doom = clamp(Math.round(raw / 3), 0, 100);

  // label
  let label = "We’re so back.";
  if (doom >= 20) label = "Mildly concerning.";
  if (doom >= 40) label = "Moderate doom. Hydrate.";
  if (doom >= 60) label = "Severe doom. Touch grass now.";
  if (doom >= 80) label = "Maximum doom. The universe is laughing.";

  return { doom, label, breakdown, totalHits, spice };
}

function uniqueByUrl(articles) {
  const seen = new Set();
  const out = [];
  for (const a of articles) {
    const u = a.url || a.url_mobile || "";
    const key = u || (a.title + "|" + (a.seendate || ""));
    if (!seen.has(key)) {
      seen.add(key);
      out.push(a);
    }
  }
  return out;
}

function render({ doom, label, breakdown, topStories }) {
  // Header
  els.doomValue.textContent = String(doom);
  els.doomLabel.textContent = label;
  els.meterFill.style.width = `${doom}%`;
  els.updatedAt.textContent = `Updated: ${nowStamp()} • ${VERSION}`;

  // Breakdown list (counts)
  els.breakdownList.innerHTML = "";
  for (const d of DRIVERS) {
    const count = breakdown[d.key] || 0;
    const row = document.createElement("div");
    row.className = "break_row";
    row.innerHTML = `
      <div class="break_name">${d.label}</div>
      <div class="break_bar"><div class="break_bar_fill" style="width:${clamp(count * 10, 0, 100)}%"></div></div>
      <div class="break_val">${count}</div>
    `;
    els.breakdownList.appendChild(row);
  }

  // Top drivers (sorted)
  els.driversList.innerHTML = "";
  const sorted = [...DRIVERS]
    .map((d) => ({ d, c: breakdown[d.key] || 0 }))
    .sort((a, b) => b.c - a.c)
    .slice(0, 4);

  for (const item of sorted) {
    const li = document.createElement("div");
    li.className = "driver_chip";
    li.textContent = `${item.d.label}: ${item.c}`;
    els.driversList.appendChild(li);
  }

  // Stories
  els.storiesList.innerHTML = "";
  if (!topStories.length) {
    const empty = document.createElement("div");
    empty.className = "story_empty";
    empty.textContent = "No stories returned.";
    els.storiesList.appendChild(empty);
    return;
  }

  for (const a of topStories.slice(0, 12)) {
    const card = document.createElement("div");
    card.className = "story_card";
    const title = a.title || "(untitled)";
    const source = a.sourceCountry || a.domain || "—";
    const when = a.seendate ? new Date(a.seendate).toLocaleString() : "";
    card.innerHTML = `
      <div class="story_title">${escapeHtml(title)}</div>
      <div class="story_meta">${escapeHtml(source)} • ${escapeHtml(when)}</div>
    `;
    card.addEventListener("click", () => openModal(a));
    els.storiesList.appendChild(card);
  }
}

function openModal(article) {
  const title = article.title || "(untitled)";
  const url = article.url || article.url_mobile || "";
  const domain = article.domain || "";
  const source = article.sourceCountry || "";
  const when = article.seendate ? new Date(article.seendate).toLocaleString() : "";

  els.modalTitle.textContent = title;
  els.modalBody.innerHTML = `
    <div class="modal_meta">
      <div><strong>Source:</strong> ${escapeHtml(source || domain || "—")}</div>
      <div><strong>Seen:</strong> ${escapeHtml(when || "—")}</div>
      ${domain ? `<div><strong>Domain:</strong> ${escapeHtml(domain)}</div>` : ""}
    </div>
    <div class="modal_hint">Opens the original publisher in a new tab.</div>
  `;

  if (url) {
    els.modalLink.href = url;
    els.modalLink.classList.remove("hidden");
  } else {
    els.modalLink.classList.add("hidden");
  }

  els.modalBackdrop.classList.remove("hidden");
  els.modal.classList.remove("hidden");
}

function closeModal() {
  els.modalBackdrop.classList.add("hidden");
  els.modal.classList.add("hidden");
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// --- Main load ---
async function loadAll() {
  setError("");
  setStatus("Fetching headlines...");
  els.doomValue.textContent = "—";
  els.doomLabel.textContent = "Loading…";
  els.meterFill.style.width = "0%";
  els.updatedAt.textContent = `Updated: ${nowStamp()} • ${VERSION}`;

  const articlesByDriver = {};
  const errors = [];

  for (const d of DRIVERS) {
    try {
      // Small stagger so we don't spike requests
      await sleep(120);
      const { articles } = await fetchFromWorker(d.query, MAXRECORDS_PER_QUERY);
      articlesByDriver[d.key] = articles || [];
    } catch (e) {
      articlesByDriver[d.key] = [];
      errors.push(`${d.label}: ${String(e.message || e)}`);
    }
  }

  // Combine + dedupe stories
  const all = Object.values(articlesByDriver).flat();
  const unique = uniqueByUrl(all);

  // Rank stories by spiciness + recency-ish
  const ranked = unique
    .map((a) => ({ a, s: scoreArticle(a.title), t: a.seendate ? Date.parse(a.seendate) : 0 }))
    .sort((x, y) => (y.s - x.s) || (y.t - x.t))
    .map((x) => x.a);

  const result = computeDoom(articlesByDriver);

  // UI render
  render({ ...result, topStories: ranked });

  if (errors.length) {
    setError(`Some feeds failed:\n• ${errors.slice(0, 6).join("\n• ")}${errors.length > 6 ? "\n• …" : ""}`);
  }

  setStatus("");
}

// --- Events ---
els.refreshBtn?.addEventListener("click", () => loadAll());
els.aboutBtn?.addEventListener("click", () => {
  // scroll down to about section
  document.getElementById("aboutSection")?.scrollIntoView({ behavior: "smooth", block: "start" });
});

els.closeModal?.addEventListener("click", closeModal);
els.modalBackdrop?.addEventListener("click", closeModal);

// Kick off
document.addEventListener("DOMContentLoaded", () => {
  // Print version in a small line if present
  if (els.versionLine) els.versionLine.textContent = VERSION;
  loadAll();
});
