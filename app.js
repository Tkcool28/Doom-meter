/* app.js — Doomroom News (GitHub Pages) */
const VERSION = "v3.0.5";

// ✅ Your Worker base
const PROXY_BASE = "https://doom-proxy.toddkirschman.workers.dev";

// Helpers
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

// ✅ IMPORTANT: route is /gdelt (with a 't')
function buildGdeltUrl(query) {
  const q = encodeURIComponent(query || "world");
  return (
    `${PROXY_BASE}/gdelt` +
    `?query=${q}` +
    `&mode=ArtList` +
    `&format=json` +
    `&maxrecords=50` +
    `&timespan=1d`
  );
}

async function fetchText(url, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: "GET", cache: "no-store", signal: ctrl.signal });
    const txt = await res.text();
    return { ok: res.ok, status: res.status, text: txt };
  } finally {
    clearTimeout(t);
  }
}

function safeJsonParse(txt) {
  try {
    return { ok: true, json: JSON.parse(txt) };
  } catch {
    return { ok: false, json: null };
  }
}

function normalizePayload(payload) {
  // Worker error shape: { error, routes, example }
  if (!payload || payload.error || payload.ok === false) {
    return {
      articles: [],
      meta: {
        kind: "error",
        error: payload?.error || "Unknown error",
        routes: payload?.routes,
        example: payload?.example,
        keys: payload ? Object.keys(payload) : [],
      },
    };
  }

  // happy path: either { articles: [...] } OR { data: { articles: [...] } }
  if (Array.isArray(payload.articles)) {
    return { articles: payload.articles, meta: { kind: "articles" } };
  }
  if (payload.data && Array.isArray(payload.data.articles)) {
    return { articles: payload.data.articles, meta: { kind: "data.articles" } };
  }

  return {
    articles: [],
    meta: { kind: "unknown", keys: payload ? Object.keys(payload) : [] },
  };
}

function renderStories(articles) {
  const grid = $("stories");
  if (!grid) return;

  grid.innerHTML = "";

  if (!articles || articles.length === 0) {
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.textContent = "No articles returned.";
    grid.appendChild(empty);
    return;
  }

  for (const a of articles.slice(0, 12)) {
    const link = document.createElement("a");
    link.className = "story";
    link.href = a.url || "#";
    link.target = "_blank";
    link.rel = "noopener noreferrer";

    const title = document.createElement("div");
    title.className = "storyTitle";
    title.textContent = a.title || "(untitled)";

    const meta = document.createElement("div");
    meta.className = "storyMeta";

    let domain = a.domain;
    if (!domain && a.url) {
      try { domain = new URL(a.url).hostname.replace(/^www\./, ""); } catch {}
    }
    meta.textContent = `${domain || "source"}${a.language ? " • " + a.language : ""}`;

    link.appendChild(title);
    link.appendChild(meta);
    grid.appendChild(link);
  }
}

function setStatus(text) {
  setText("statusPill", text);
}

function setUpdated() {
  setText("updatedPill", "Updated: " + nowStamp());
}

function showErrorBox(message) {
  show("errorBox", true);
  setText("errorText", message);
}

function clearErrorBox() {
  show("errorBox", false);
  setText("errorText", "");
}

async function loadHeadlines(query = "world") {
  clearErrorBox();
  setStatus("Loading…");

  const url = buildGdeltUrl(query);

  const res = await fetchText(url);
  const parsed = safeJsonParse(res.text);

  if (!res.ok || !parsed.ok) {
    setStatus("Error");
    showErrorBox(
      `No articles returned.\n` +
      `HTTP: ${res.status}\n` +
      `Tried: ${url}\n` +
      `Body preview: ${res.text.slice(0, 240)}`
    );
    renderStories([]);
    return;
  }

  const normalized = normalizePayload(parsed.json);

  if (!normalized.articles || normalized.articles.length === 0) {
    setStatus("Idle");
    const m = normalized.meta || {};
    showErrorBox(
      `No articles returned. Response keys: ${m.keys ? m.keys.join(", ") : "(none)"}\n` +
      (m.error ? `Error: ${m.error}\n` : "") +
      (m.routes ? `Routes: ${m.routes.join(", ")}\n` : "") +
      (m.example ? `Example: ${m.example}\n` : "") +
      `Tried: ${url}`
    );
    renderStories([]);
    return;
  }

  setStatus("Idle");
  setUpdated();
  renderStories(normalized.articles);
}

function init() {
  setText("version", VERSION);

  const refreshBtn = $("refreshBtn");
  const aboutBtn = $("aboutBtn");

  if (refreshBtn) refreshBtn.addEventListener("click", () => loadHeadlines("world"));

  if (aboutBtn) {
    aboutBtn.addEventListener("click", () => {
      const about = $("aboutBox");
      if (!about) return;
      about.style.display = (about.style.display === "none" || !about.style.display) ? "" : "none";
    });
  }

  loadHeadlines("world");
}

document.addEventListener("DOMContentLoaded", init);
