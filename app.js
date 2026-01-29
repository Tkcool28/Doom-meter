/* app.js — Doomroom News (GitHub Pages) */

const VERSION = "v3.0.3";
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

function normalizePayload(payload) {
  // Worker error shape you’re seeing: {error, routes, example}
  if (payload && (payload.error || payload.ok === false)) {
    return {
      articles: [],
      meta: {
        kind: "error",
        error: payload.error || "Unknown error",
        routes: payload.routes,
        example: payload.example,
        keys: Object.keys(payload),
      },
    };
  }

  // Happy-path shapes
  if (payload && Array.isArray(payload.articles)) {
    return { articles: payload.articles, meta: { kind: "articles" } };
  }
  if (payload && payload.data && Array.isArray(payload.data.articles)) {
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
      try {
        domain = new URL(a.url).hostname.replace("www.", "");
      } catch {}
    }

    meta.textContent = `${domain || "source"}${a.language ? " · " + a.language : ""}`;

    link.appendChild(title);
    link.appendChild(meta);
    grid.appendChild(link);
  }
}

async function fetchJson(url, timeoutMs = 12000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);

  try {
    const res = await fetch(url, { method: "GET", mode: "cors", cache: "no-store", signal: ctl.signal });
    const txt = await res.text();

    try {
      return { ok: res.ok, status: res.status, json: JSON.parse(txt), raw: txt };
    } catch {
      // Not JSON => treat as error
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
      json: { error: e?.name === "AbortError" ? "Timeout" : "Fetch failed", detail: String(e).slice(0, 250) },
      raw: "",
    };
  } finally {
    clearTimeout(t);
  }
}

async function fetchHeadlines() {
  setText("version", VERSION);
  setText("updatedAt", "Fetching headlines...");
  show("errorBox", false);
  setText("errorText", "");

  const query = "world"; // You can change this later or make it dynamic

  // ✅ Correct routes based on what your Worker is reporting:
  // - /gdel?query=...
  // - /gkg?query=...
  // We try both.
  const candidates = [
    `${PROXY_BASE}/gdel?query=${encodeURIComponent(query)}&t=${Date.now()}`,
    `${PROXY_BASE}/gkg?query=${encodeURIComponent(query)}&t=${Date.now()}`,
    // As a fallback, sometimes workers use /gdel?query=... without extra params
    `${PROXY_BASE}/gdel?query=${encodeURIComponent(query)}`,
    `${PROXY_BASE}/gkg?query=${encodeURIComponent(query)}`
  ];

  let last = { tried: "", meta: null };

  for (const url of candidates) {
    const { json } = await fetchJson(url);
    const norm = normalizePayload(json);

    last = { tried: url, meta: norm.meta, json };

    if (norm.articles && norm.articles.length > 0) {
      renderStories(norm.articles);
      setText("updatedAt", `Updated: ${nowStamp()}`);
      show("errorBox", false);
      return;
    }
  }

  // Nothing returned articles => show a useful error box
  show("errorBox", true);

  const keysLine = last.meta?.keys?.length ? `Response keys: ${last.meta.keys.join(", ")}` : "";
  const routesLine = last.meta?.routes ? `Routes: ${Array.isArray(last.meta.routes) ? last.meta.routes.join(", ") : String(last.meta.routes)}` : "";
  const exampleLine = last.meta?.example ? `Example: ${String(last.meta.example)}` : "";
  const errLine = last.meta?.error ? `Error: ${last.meta.error}` : "";
  const triedLine = last.tried ? `Tried: ${last.tried}` : "";

  setText("errorText", [ "No articles returned.", keysLine, errLine, routesLine, exampleLine, triedLine ].filter(Boolean).join("\n"));
  setText("updatedAt", "Updated: —");
  renderStories([]);
}

function hookButtons() {
  // If your HTML has an id on the refresh button, use it.
  const refreshBtn = $("refreshBtn");
  if (refreshBtn) refreshBtn.addEventListener("click", fetchHeadlines);

  // If not, fall back to “first button” (your UI has Refresh first).
  const btns = document.querySelectorAll("button");
  if (!refreshBtn && btns.length) btns[0].addEventListener("click", fetchHeadlines);
}

document.addEventListener("DOMContentLoaded", () => {
  hookButtons();
  fetchHeadlines();
});
