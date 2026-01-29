/* app.js — Doomroom News (GitHub Pages) */

const VERSION = "v3.0.2";
const PROXY_BASE = "https://doom-proxy.toddkirschman.workers.dev";

// DOM helpers (safe if element missing)
const $ = (id) => document.getElementById(id);

function setText(id, text) {
  const el = $(id);
  if (el) el.textContent = text;
}

function show(el, on = true) {
  if (!el) return;
  el.style.display = on ? "" : "none";
}

function nowStamp() {
  const d = new Date();
  return d.toLocaleString();
}

function normalizeArticles(payload) {
  // Accept common shapes
  if (!payload) return { articles: [], meta: { shape: "empty" } };

  // Worker error shape (you showed: keys ok, error, upstream_url, body_preview)
  if (payload.ok === false || payload.error) {
    return {
      articles: [],
      meta: {
        shape: "error",
        error: payload.error || "Upstream error",
        upstream_url: payload.upstream_url,
        body_preview: payload.body_preview,
        keys: Object.keys(payload),
      },
    };
  }

  // NewsAPI-ish
  if (Array.isArray(payload.articles)) {
    return { articles: payload.articles, meta: { shape: "articles" } };
  }

  // Sometimes you might return {data:{articles:[...]}}
  if (payload.data && Array.isArray(payload.data.articles)) {
    return { articles: payload.data.articles, meta: { shape: "data.articles" } };
  }

  return { articles: [], meta: { shape: "unknown", keys: Object.keys(payload) } };
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

  // Keep it simple + robust.
  for (const a of articles.slice(0, 12)) {
    const card = document.createElement("a");
    card.className = "story";
    card.href = a.url || "#";
    card.target = "_blank";
    card.rel = "noopener noreferrer";

    const title = document.createElement("div");
    title.className = "storyTitle";
    title.textContent = a.title || "(untitled)";

    const meta = document.createElement("div");
    meta.className = "storyMeta";
    const domain =
      a.domain ||
      (() => {
        try {
          return a.url ? new URL(a.url).hostname.replace("www.", "") : "";
        } catch {
          return "";
        }
      })();

    const lang = a.language ? ` · ${a.language}` : "";
    meta.textContent = `${domain || "source"}${lang}`;

    card.appendChild(title);
    card.appendChild(meta);
    grid.appendChild(card);
  }
}

async function tryFetchJson(url, timeoutMs = 12000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "GET",
      mode: "cors",
      cache: "no-store",
      signal: ctl.signal,
    });

    const text = await res.text();

    // Some upstreams might send HTML; we only want JSON
    try {
      return { ok: res.ok, status: res.status, json: JSON.parse(text), text };
    } catch {
      return {
        ok: false,
        status: res.status,
        json: {
          ok: false,
          error: "Non-JSON response",
          upstream_url: url,
          body_preview: text.slice(0, 300),
        },
        text,
      };
    }
  } catch (e) {
    return {
      ok: false,
      status: 0,
      json: {
        ok: false,
        error: e?.name === "AbortError" ? "Timeout" : "Fetch failed",
        upstream_url: url,
        body_preview: String(e || "").slice(0, 300),
      },
      text: "",
    };
  } finally {
    clearTimeout(t);
  }
}

async function fetchHeadlines() {
  const errorBox = $("errorBox");
  const errorText = $("errorText");

  // Hide error while loading
  show(errorBox, false);
  setText("errorText", "");
  setText("updatedAt", "Fetching headlines...");
  setText("version", VERSION);

  // 👇 This is the key part:
  // We try the most likely Worker routes, because earlier you proved the Worker returns articles.
  const candidates = [
    `${PROXY_BASE}/?t=${Date.now()}`,
    `${PROXY_BASE}/g?t=${Date.now()}`,
    `${PROXY_BASE}/g?q=world&t=${Date.now()}`,
  ];

  let lastMeta = null;

  for (const url of candidates) {
    const { json } = await tryFetchJson(url);
    const { articles, meta } = normalizeArticles(json);
    lastMeta = { url, ...meta };

    if (articles && articles.length) {
      renderStories(articles);
      setText("updatedAt", `Updated: ${nowStamp()}`);
      show(errorBox, false);
      return;
    }

    // If this attempt returned an explicit error, keep going but remember it
  }

  // Nothing worked — show the most informative error we have
  show(errorBox, true);

  const keysLine = lastMeta?.keys ? `Response keys: ${lastMeta.keys.join(", ")}` : "";
  const upstreamLine = lastMeta?.upstream_url ? `Upstream: ${lastMeta.upstream_url}` : `Tried: ${lastMeta?.url || ""}`;
  const previewLine = lastMeta?.body_preview ? `Preview: ${String(lastMeta.body_preview).slice(0, 160)}…` : "";

  const msgParts = [
    "No articles returned.",
    keysLine,
    lastMeta?.error ? `Error: ${lastMeta.error}` : "",
    upstreamLine,
    previewLine,
  ].filter(Boolean);

  setText("errorText", msgParts.join("\n"));
  setText("updatedAt", "Updated: —");
  renderStories([]);
}

function hookButtons() {
  // If you have buttons with ids, wire them. If not, no harm.
  const refreshBtn = $("refreshBtn");
  if (refreshBtn) refreshBtn.addEventListener("click", fetchHeadlines);

  // If your HTML uses plain buttons without ids, this will still work if you add ids later.
}

document.addEventListener("DOMContentLoaded", () => {
  hookButtons();
  fetchHeadlines();
});
