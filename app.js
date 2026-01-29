// ====== CONFIG ======
// Put your Worker base URL here (NO trailing slash)
const PROXY_BASE = "https://doom-proxy.toddkirschman.workers.dev";

// Simple app version stamp
const VERSION = "v3.0.1";

// ====== DOM ======
const $ = (id) => document.getElementById(id);

const btnRefresh = $("btnRefresh");
const btnAbout = $("btnAbout");
const statusEl = $("status");
const updatedEl = $("updated");
const storiesEl = $("stories");

const errorBox = $("errorBox");
const errorText = $("errorText");
const debugText = $("debugText");
const aboutBox = $("aboutBox");
const versionEl = $("version");

versionEl.textContent = VERSION;

// ====== UTIL ======
function setStatus(text) {
  statusEl.textContent = text;
}

function setUpdated(date = new Date()) {
  updatedEl.textContent = `Updated: ${date.toLocaleString()}`;
}

function showError(userMsg, debugMsg = "") {
  errorBox.style.display = "block";
  errorText.textContent = userMsg;
  debugText.textContent = debugMsg || "";
}

function clearError() {
  errorBox.style.display = "none";
  errorText.textContent = "";
  debugText.textContent = "";
}

function clearStories() {
  storiesEl.innerHTML = "";
}

function addStory({ title, url, domain, sourcecountry, language, seendate }) {
  const div = document.createElement("div");
  div.className = "card";
  div.style.marginTop = "0";
  div.style.borderRadius = "14px";
  div.style.padding = "12px";
  div.style.background = "rgba(0,0,0,.18)";

  const a = document.createElement("a");
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.textContent = title || "(no title)";

  const meta = document.createElement("div");
  meta.className = "muted";
  meta.style.marginTop = "6px";
  meta.style.fontSize = "12px";
  meta.textContent = [
    domain ? `domain: ${domain}` : null,
    sourcecountry ? `country: ${sourcecountry}` : null,
    language ? `lang: ${language}` : null,
    seendate ? `seen: ${seendate}` : null,
  ].filter(Boolean).join(" • ");

  div.appendChild(a);
  div.appendChild(meta);
  storiesEl.appendChild(div);
}

async function fetchJson(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { signal: controller.signal });
    const text = await res.text();

    // Try JSON parse; if it fails, include a snippet for debugging.
    try {
      const data = JSON.parse(text);
      return { ok: res.ok, status: res.status, data, raw: text };
    } catch (e) {
      return {
        ok: false,
        status: res.status,
        data: null,
        raw: text,
        parseError: String(e),
      };
    }
  } finally {
    clearTimeout(t);
  }
}

// ====== GDELT QUERIES ======
// You can tune these later; keep it simple now.
function buildGdeltUrl(query, timespan = "1d", maxrecords = 30) {
  const u = new URL(PROXY_BASE + "/gdelt");
  u.searchParams.set("query", query);
  u.searchParams.set("mode", "ArtList");
  u.searchParams.set("format", "json");
  u.searchParams.set("maxrecords", String(maxrecords));
  u.searchParams.set("timespan", timespan);
  return u.toString();
}

async function loadHeadlines() {
  clearError();
  clearStories();
  setStatus("Fetching headlines…");

  // One “global doom” query (you can expand later)
  const query = [
    "conflict OR war OR missile OR drone OR invasion OR ceasefire",
    "OR climate OR wildfire OR flood OR earthquake OR outbreak",
    "OR inflation OR recession OR layoffs OR debt",
  ].join(" ");

  const url = buildGdeltUrl(query, "1d", 40);

  const result = await fetchJson(url, 15000);

  if (!result.ok || !result.data) {
    setStatus("Fetch failed");
    const snippet = (result.raw || "").slice(0, 240);
    showError(
      "No articles returned. Something is blocking the requests.",
      `status=${result.status} parseError=${result.parseError || "none"} snippet=${JSON.stringify(snippet)}`
    );
    return;
  }

  const articles = result.data.articles || [];
  if (!Array.isArray(articles) || articles.length === 0) {
    setStatus("No articles");
    showError(
      "No articles returned.",
      `Response keys: ${Object.keys(result.data).join(", ")}`
    );
    return;
  }

  // Render
  setStatus(`Loaded ${articles.length}`);
  setUpdated(new Date());

  articles.slice(0, 30).forEach(addStory);
}

// ====== EVENTS ======
btnRefresh.addEventListener("click", loadHeadlines);

btnAbout.addEventListener("click", () => {
  aboutBox.style.display = aboutBox.style.display === "none" ? "block" : "none";
});

// Load on start
loadHeadlines();
