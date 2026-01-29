/* app.js — Doomroom News (GitHub Pages) */

const VERSION = "v3.0.3";

// ✅ Your Cloudflare Worker base URL:
const PROXY_BASE = "https://doom-proxy.toddkirschman.workers.dev";

// ---- Helpers ----
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

function setStatus(text) {
  // Your UI shows a pill that currently says "Idle"
  // If you have an element with id="statusPill" this will update it.
  // If you don't, no harm.
  setText("statusPill", text);
}

function setUpdated(text) {
  // Same idea for "Updated: —"
  setText("updatedPill", text);
  // If your HTML uses different ids, this just quietly does nothing.
}

function buildProxyUrl(query) {
  // ✅ Worker route is /gdel?query=...
  return `${PROXY_BASE}/gdel?query=${encodeURIComponent(query)}&t=${Date.now()}`;
}

function normalizePayload(payload) {
  // Worker error shape you've seen: { error, routes, example, upstream_url, body_preview, ok? }
  if (!payload) {
    return { articles: [], meta: { kind: "empty", keys: [] } };
  }

  // If the worker wraps in {ok:false,...} or {error:"Not found", ...}
  if (payload.error || payload.ok === false) {
    return {
      articles: [],
      meta: {
        kind: "error",
        error: payload.error || "Unknown error",
        routes: payload.routes,
        example: payload.example,
        upstream_url: payload.upstream_url,
        body_preview: payload.body_preview,
        keys: Object.keys(payload),
      },
    };
  }

  // Happy-path shapes
  if (Array.isArray(payload.articles)) {
    return { articles: payload.articles, meta: { kind: "articles" } };
  }

  if (payload.data && Array.isArray(payload.data.articles)) {
    return { articles: payload.data.articles, meta: { kind: "data.articles" } };
  }

  return {
    articles: [],
    meta: { kind: "unknown", keys: Object.keys(payload) },
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
      try {
        domain = new URL(a.url).hostname.replace(/^www\./, "");
      } catch (_) {}
    }

    meta.textContent = `${domain || "source"}${a.language ? " • " + a.language : ""}`;

    link.appendChild(title);
    link.appendChild(meta);
    grid.appendChild(link);
  }
}

async function fetchJson(url, timeoutMs = 12000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "GET",
      mode: "cors",
      cache: "no-store",
      signal: ctl.signal,
    });

    const txt = await res.text();

    // Attempt JSON parse
    try {
      return { ok: res.ok, status: res.status, json: JSON.parse(txt), raw: txt };
    } catch (_) {
      return {
        ok: false,
        status: res.status,
        json: { error: "Non-JSON response", body_preview: txt.slice(0, 250) },
        raw: txt,
      };
    }
  } catch (e) {
    return {
      ok: false,
      status: 0,
      json: { error: e?.name === "AbortError" ? "Request timed out" : String(e) },
      raw: "",
    };
  } finally {
    clearTimeout(t);
  }
}

function showError(meta, triedUrl) {
  show("errorBox", true);

  const keys = meta?.keys ? meta.keys.join(", ") : "(none)";
  const msg =
    `No articles returned. Response keys: ${keys}` +
    (meta?.error ? `\nError: ${meta.error}` : "") +
    (meta?.upstream_url ? `\nUpstream: ${meta.upstream_url}` : "") +
    (triedUrl ? `\nTried: ${triedUrl}` : "");

  setText("errorText", msg);
}

function clearError() {
  show("errorBox", false);
  setText("errorText", "");
}

async function loadHeadlines(query = "world") {
  setStatus("Loading...");
  clearError();

  const url = buildProxyUrl(query);
  const r = await fetchJson(url);

  const payload = normalizePayload(r.json);

  if (!payload.articles || payload.articles.length === 0) {
    showError(payload.meta, url);
    renderStories([]);
    setStatus("Idle");
    return;
  }

  renderStories(payload.articles);
  setStatus("Idle");
  setUpdated(nowStamp());
}

function wireUi() {
  // Put version text if you have <small id="version"></small>
  setText("version", VERSION);

  // Default state
  setStatus("Idle");
  setUpdated("—");
  clearError();

  // Buttons if they exist
  const refreshBtn = $("refreshBtn");
  if (refreshBtn) refreshBtn.addEventListener("click", () => loadHeadlines("world"));

  const aboutBtn = $("aboutBtn");
  if (aboutBtn) {
    aboutBtn.addEventListener("click", () => {
      const box = $("aboutBox");
      if (!box) return;
      box.style.display = box.style.display === "none" ? "" : "none";
    });
  }

  // Auto-load once on open
  loadHeadlines("world");
}

// Boot
document.addEventListener("DOMContentLoaded", wireUi);
