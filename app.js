/* Doom-meter app.js
   - Pulls recent headlines from GDELT DOC 2.1 (via JSONP)
   - Classifies titles into doom buckets
   - Shows a modal with a satire line + a button to open the original article
*/

const GDELT_BASE = "https://api.gdeltproject.org/api/v2/doc/doc";

const DRIVERS = [
  // Conflict / war
  "war OR conflict OR attack OR missile OR drone OR invasion OR bombing OR ceasefire OR militants OR troops OR strikes",
  // Climate / environment
  "climate OR wildfire OR hurricane OR flood OR drought OR heatwave OR earthquake OR storm OR emissions OR ice OR famine",
  // Economy / markets
  "inflation OR recession OR layoffs OR bank OR debt OR market crash OR unemployment OR default OR housing OR oil prices",
  // Democracy / politics
  "election OR coup OR corruption OR protest OR authoritarian OR democracy OR court ruling OR vote fraud OR gerrymander",
  // Cyber / tech chaos
  "cyberattack OR hack OR ransomware OR breach OR outage OR data leak OR spyware OR malware",
  // Nuclear
  "nuclear OR uranium OR reactor OR enrichment OR IAEA OR atomic",
  // Space rocks
  "asteroid OR meteor OR comet OR near-Earth object OR NEO OR impact",
  // Misc chaos
  "shooting OR explosion OR hostage OR riot OR scandal OR disaster OR emergency",
];

const els = {
  doomValue: document.getElementById("doomValue"),
  doomLabel: document.getElementById("doomLabel"),
  meterFill: document.getElementById("meterFill"),
  updatedAt: document.getElementById("updatedAt"),

  breakdownList: document.getElementById("breakdownList"),
  driversList: document.getElementById("driversList"),
  storiesList: document.getElementById("storiesList"),

  refreshBtn: document.getElementById("refreshBtn"),

  modal: document.getElementById("modal"),
  modalTitle: document.getElementById("modalTitle"),
  modalSatire: document.getElementById("modalSatire"),
  modalLink: document.getElementById("modalLink"), // optional if you kept it
  closeModal: document.getElementById("closeModal"),
  modalBackdrop: document.getElementById("modalBackdrop"),

  openOriginalBtn: document.getElementById("openOriginalBtn"), // if you add this button in index.html
};

// ---------- helpers ----------
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function normalizeTitle(t) {
  return String(t || "")
    .toLowerCase()
    .replace(/&amp;/g, "&")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function safeURL(u) {
  try {
    if (!u) return "";
    const url = new URL(u);
    return url.toString();
  } catch {
    return "";
  }
}

// JSONP fetch (avoids CORS)
function jsonp(url) {
  return new Promise((resolve, reject) => {
    const cb = "cb_" + Math.random().toString(36).slice(2);
    const script = document.createElement("script");

    const u = new URL(url);
    u.searchParams.set("format", "jsonp");
    u.searchParams.set("callback", cb);

    let done = false;

    window[cb] = (data) => {
      done = true;
      cleanup();
      resolve(data);
    };

    function cleanup() {
      try { delete window[cb]; } catch {}
      if (script && script.parentNode) script.parentNode.removeChild(script);
    }

    script.onerror = () => {
      if (done) return;
      cleanup();
      reject(new Error("JSONP load error"));
    };

    script.src = u.toString();
    document.body.appendChild(script);

    // Safety timeout
    setTimeout(() => {
      if (done) return;
      cleanup();
      reject(new Error("JSONP timeout"));
    }, 15000);
  });
}

async function fetchDriver(query, timespan = "6h", maxrecords = 60) {
  const u = new URL(GDELT_BASE);
  u.searchParams.set("query", query);
  u.searchParams.set("mode", "artlist");
  u.searchParams.set("sort", "datedesc");
  u.searchParams.set("format", "jsonp"); // jsonp helper also sets this, but harmless
  u.searchParams.set("format", "jsonp");
  u.searchParams.set("maxrecords", String(maxrecords));
  u.searchParams.set("format", "jsonp");
  u.searchParams.set("format", "jsonp");

  // GDELT DOC supports timespan like "6h", "1d" etc.
  u.searchParams.set("timespan", timespan);

  const data = await jsonp(u.toString());
  return data && data.articles ? data.articles : [];
}

function dedupe(articles) {
  const seen = new Set();
  const out = [];
  for (const a of articles) {
    const key = normalizeTitle(a && a.title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

// ---------- classification ----------
function classify(title) {
  const t = normalizeTitle(title);

  const domains = [];
  let weight = 1;

  // Basic keyword buckets
  const has = (re) => re.test(t);

  if (has(/\b(nuclear|uranium|reactor|enrichment|iaea|atomic)\b/)) domains.push("nuclear_words");
  if (has(/\b(asteroid|meteor|comet|neo|near earth|impact)\b/)) domains.push("space_rocks");
  if (has(/\b(cyberattack|hack|ransomware|breach|outage|data leak|malware|spyware)\b/)) domains.push("cyber_chaos");
  if (has(/\b(election|coup|corruption|authoritarian|democracy|vote|ballot|protest|court ruling|gerrymander)\b/)) domains.push("democracy_melting");
  if (has(/\b(inflation|recession|layoffs|unemployment|default|bank|debt|market crash|housing)\b/)) domains.push("economy_panic");
  if (has(/\b(climate|wildfire|hurricane|flood|drought|heatwave|emissions|storm|earthquake)\b/)) domains.push("climate_weirdness");
  if (has(/\b(war|conflict|attack|missile|drone|invasion|bombing|ceasefire|troops|strike)\b/)) domains.push("conflict_heat");

  // If nothing matched, call it misc chaos
  if (domains.length === 0) domains.push("misc_chaos");

  // Weighting: make scary words count more (purely for “doom index” vibes)
  if (has(/\b(killed|dead|massacre|genocide|chemical weapons|nuclear)\b/)) weight += 4;
  if (has(/\b(attack|explosion|bomb|missile|war|invasion)\b/)) weight += 3;
  if (has(/\b(hack|breach|ransomware|outage)\b/)) weight += 2;
  if (has(/\b(crisis|emergency|collapse|catastrophe)\b/)) weight += 2;

  return { domains, weight };
}

function satireLine(title) {
  const t = String(title || "").trim();
  if (!t) return "In today’s episode of ‘Surely This Won’t Have Consequences’… analysts report elevated levels of ‘uh-oh.’";
  return `In today’s episode of ‘Surely This Won’t Have Consequences’, ${t}. Analysts report elevated levels of ‘uh-oh.’`;
}

function labelFor(doomIndex) {
  if (doomIndex <= 10) return "Vibes: chill-ish.";
  if (doomIndex <= 25) return "We’re so back.";
  if (doomIndex <= 45) return "Mildly concerning.";
  if (doomIndex <= 65) return "Spicy timeline.";
  if (doomIndex <= 85) return "Respectfully: yikes.";
  return "Full doom wizard mode.";
}

// ---------- compute + render ----------
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

  const stories = articles.map((a, idx) => {
    const title = a.title || "Untitled headline";
    const url = safeURL(a.url || "");
    const source = a.domain || a.sourceCountry || "Unknown";
    const publishedAt = a.seendate || "";

    const { domains, weight } = classify(title);
    for (const d of domains) breakdown[d] = (breakdown[d] || 0) + weight;

    return {
      id: `${idx}_${normalizeTitle(title).slice(0, 40)}`,
      title,
      url,
      source,
      publishedAt,
      domains,
      weight,
      satire: satireLine(title),
    };
  });

  // DoomIndex: average weight scaled into 0..100 (pure vibes)
  const avg = stories.length ? stories.reduce((s, x) => s + (x.weight || 0), 0) / stories.length : 0;
  const doomIndex = clamp(Math.round(avg * 12), 0, 100);

  // Drivers: highest absolute weights
  const drivers = [...stories].sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight)).slice(0, 8);

  return { doomIndex, doomLabel: labelFor(doomIndex), breakdown, drivers, stories };
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
  els.breakdownList.innerHTML = "";

  keys.forEach(([k, label]) => {
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
  });
}

function storyCard(story) {
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

  div.style.cursor = "pointer";
  div.addEventListener("click", () => openModal(story));

  return div;
}

function renderLists({ drivers, stories }) {
  els.driversList.innerHTML = "";
  drivers.forEach((s) => els.driversList.appendChild(storyCard(s)));

  els.storiesList.innerHTML = "";
  stories.slice(0, 40).forEach((s) => els.storiesList.appendChild(storyCard(s)));
}

// ---------- modal ----------
let currentStory = null;

function openModal(story) {
  currentStory = story;

  els.modalTitle.textContent = story.title || "";
  els.modalSatire.textContent = story.satire || "";

  // If you kept the <a id="modalLink"> in index.html, update it too:
  if (els.modalLink) {
    els.modalLink.href = story.url || "#";
  }

  els.modal.classList.remove("hidden");
}

function closeModal() {
  els.modal.classList.add("hidden");
  currentStory = null;
}

// Make “Open Original Article” always clickable on mobile
function openOriginal() {
  const url = currentStory && currentStory.url ? currentStory.url : "";
  if (!url) {
    alert("No article URL available for this item.");
    return;
  }
  // Must be called from a user click to avoid popup blockers
  window.open(url, "_blank", "noopener,noreferrer");
}

// ---------- refresh flow ----------
async function refresh() {
  els.doomValue.textContent = "--";
  els.doomLabel.textContent = "Consulting the omens…";
  els.updatedAt.textContent = "";

  els.driversList.innerHTML = "";
  els.storiesList.innerHTML = "";
  els.breakdownList.innerHTML = "";

  try {
    const pulls = await Promise.all(
      DRIVERS.map((q) => fetchDriver(q, "6h", 60).catch(() => []))
    );

    const all = dedupe(pulls.flat()).slice(0, 140);
    const result = compute(all);

    els.doomValue.textContent = String(result.doomIndex);
    els.doomLabel.textContent = result.doomLabel;
    els.meterFill.style.width = `${result.doomIndex}%`;
    els.updatedAt.textContent = `Updated: ${new Date().toLocaleString()}`;

    renderBreakdown(result.breakdown);
    renderLists(result);
  } catch (err) {
    els.doomValue.textContent = "!!";
    els.doomLabel.textContent = "Error loading headlines (the universe refused to cooperate).";
    els.updatedAt.textContent = String(err && err.message ? err.message : err);
  }
}

// ---------- wire up ----------
if (els.refreshBtn) els.refreshBtn.addEventListener("click", refresh);
if (els.closeModal) els.closeModal.addEventListener("click", closeModal);
if (els.modalBackdrop) els.modalBackdrop.addEventListener("click", closeModal);

// This is IMPORTANT: modal “Open Original Article” should be a BUTTON with id="openOriginalBtn"
if (els.openOriginalBtn) els.openOriginalBtn.addEventListener("click", openOriginal);

// If you don’t have that button yet, we can still try to hook the anchor click
if (els.modalLink) {
  els.modalLink.addEventListener("click", (e) => {
    // Allow normal behavior if it’s a real link
    if (!currentStory || !currentStory.url) {
      e.preventDefault();
      alert("No article URL available for this item.");
    }
  });
}

refresh();
