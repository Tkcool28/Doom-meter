/* Doomroom News — app.js
   Uses Cloudflare Worker proxy:
   https://doom-proxy.toddkirschman.workers.dev

   Required worker routes:
   - GET /health
   - GET /gdel?query=...   (returns GDELT JSON, or a wrapper error object)
*/

const PROXY_BASE = "https://doom-proxy.toddkirschman.workers.dev";

// --- UI helpers ---
const $ = (sel) => document.querySelector(sel);

function setUpdated(text) {
  const el = $("#updated");
  if (el) el.textContent = text ?? "—";
}

function setStatus(text, isError = false) {
  const el = $("#status");
  if (!el) return;
  el.textContent = text;
  el.style.opacity = "1";
  el.style.color = isError ? "#ff6b6b" : "";
}

function setDebug(text) {
  const el = $("#debug");
  if (!el) return;
  el.textContent = text || "";
}

function renderArticles(list) {
  const container = $("#stories");
  if (!container) return;

  container.innerHTML = "";

  if (!Array.isArray(list) || list.length === 0) {
    container.innerHTML = `<div class="muted">No articles returned.</div>`;
    return;
  }

  for (const a of list) {
    const title = a.title || "(untitled)";
    const url = a.url || "#";
    const source = a.domain || a.sourceCountry || "";
    const when = a.seendate ? new Date(a.seendate).toLocaleString() : "";

    const card = document.createElement("div");
    card.className = "story";
    card.innerHTML = `
      <a class="story-title" href="${url}" target="_blank" rel="noopener noreferrer">${escapeHtml(title)}</a>
      <div class="story-meta">${escapeHtml(source)} ${when ? "• " + escapeHtml(when) : ""}</div>
    `;
    container.appendChild(card);
  }
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// --- Worker fetch helpers ---
async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  const text = await res.text();

  // Try JSON parse no matter what status is; Worker might return JSON errors
  try {
    return { ok: res.ok, status: res.status, json: JSON.parse(text), raw: text };
  } catch {
    return { ok: res.ok, status: res.status, json: null, raw: text };
  }
}

async function healthCheck() {
  const url = `${PROXY_BASE}/health`;
  const r = await fetchJson(url);
  if (r.json && r.json.ok) return true;
  return false;
}

/*
  Calls your worker’s /gdel route.
  Your worker should fetch GDELT internally, so the browser never touches GDELT directly.
*/
async function fetchGdeltArticles(query, max = 12) {
  const url = `${PROXY_BASE}/gdel?query=${encodeURIComponent(query)}&max=${encodeURIComponent(String(max))}`;
  const r = await fetchJson(url);

  // Case A: Worker returns raw GDELT JSON
  if (r.json && (r.json.articles || r.json.timeline)) {
    const articles = Array.isArray(r.json.articles) ? r.json.articles : [];
    return { ok: true, articles, meta: { via: "gdelt-raw", status: r.status } };
  }

  // Case B: Worker returns wrapper error object
  if (r.json && (r.json.ok === false || r.json.error)) {
    const msg = [
      `Proxy error: ${r.json.error || "unknown"}`,
      r.json.upstream_url ? `Upstream: ${r.json.upstream_url}` : "",
      r.json.body_preview ? `Preview: ${r.json.body_preview}` : "",
    ].filter(Boolean).join("\n");
    return { ok: false, articles: [], meta: { via: "worker-wrapper", status: r.status, msg } };
  }

  // Case C: Not JSON (HTML/403 page, etc.)
  const preview = (r.raw || "").slice(0, 220).replace(/\s+/g, " ");
  return { ok: false, articles: [], meta: { via: "non-json", status: r.status, msg: `Non-JSON response (${r.status}): ${preview}` } };
}

// --- Doom drivers (edit these freely) ---
const DRIVERS = [
  { key: "conflict", label: "Conflict Heat", query: "war OR drone OR missile OR strike", max: 10 },
  { key: "climate", label: "Climate Weirdness", query: "heatwave OR flood OR wildfire OR drought OR hurricane", max: 10 },
  { key: "econ", label: "Economic Drama", query: "recession OR inflation OR layoffs OR bank OR debt", max: 10 },
];

// --- Main flow ---
async function refresh() {
  setStatus("Fetching headlines…");
  setDebug("");
  setUpdated("—");
  renderArticles([]);

  const alive = await healthCheck();
  if (!alive) {
    setStatus("Worker health check failed. Open /health in a browser to verify.", true);
    return;
  }

  // Fetch all drivers and merge stories
  const all = [];
  const debugLines = [];

  for (const d of DRIVERS) {
    const r = await fetchGdeltArticles(d.query, d.max);
    if (!r.ok) {
      debugLines.push(`❌ ${d.label}: ${r.meta.msg || "failed"}`);
      continue;
    }
    debugLines.push(`✅ ${d.label}: ${r.articles.length} articles`);
    all.push(...r.articles);
  }

  // Deduplicate by URL
  const seen = new Set();
  const unique = [];
  for (const a of all) {
    const u = a.url || "";
    if (!u || seen.has(u)) continue;
    seen.add(u);
    unique.push(a);
  }

  // Sort newest first if seendate exists
  unique.sort((a, b) => (b.seendate || "").localeCompare(a.seendate || ""));

  // Render
  renderArticles(unique.slice(0, 30));
  setUpdated(new Date().toLocaleString());

  if (unique.length === 0) {
    setStatus("Error loading headlines. No articles returned.", true);
  } else {
    setStatus(`Loaded ${unique.length} articles.`);
  }

  setDebug(debugLines.join("\n"));
}

// Wire up button
window.addEventListener("DOMContentLoaded", () => {
  const btn = $("#refreshBtn");
  if (btn) btn.addEventListener("click", refresh);
  refresh();
});
