// Doomroom News — 100% static, 100% free.
// Uses GDELT DOC API via JSONP to avoid CORS headaches.

const DOOM_LABELS = [
  { min: 0,  max: 20, label: "We’re so back." },
  { min: 21, max: 40, label: "Mildly cursed timeline." },
  { min: 41, max: 60, label: "This is why aliens don’t visit." },
  { min: 61, max: 80, label: "Please put your trays into their up right position, and fasten your seat belts" },
  { min: 81, max: 95, label: "Apocalypse-adjacent." },
  { min: 96, max: 100, label: "Final Boss Week unlocked." },
];

const DOMAIN_RULES = [
  { key: "nuclear_words",  weight: 6,  re: /(nuclear|reactor|wmd|warhead|icbm|ballistic missile|missile test)/i },
  { key: "conflict_heat",  weight: 5,  re: /(war|invasion|airstrike|bombing|missile|troops|ceasefire|hostage|militia|shelling)/i },
  { key: "climate_weirdness", weight: 4, re: /(wildfire|flood|hurricane|cyclone|heatwave|drought|earthquake|landslide)/i },
  { key: "democracy_melting", weight: 4, re: /(coup|martial law|crackdown|election violence|mass arrest|authorities detained)/i },
  { key: "economy_panic", weight: 3, re: /(crash|default|bank run|recession|inflation spike|debt crisis|currency plunges)/i },
  { key: "bio_health",    weight: 3,  re: /(outbreak|pandemic|epidemic|public health emergency|avian flu|h5n1)/i },
  { key: "cyber_chaos",   weight: 2,  re: /(ransomware|cyberattack|hack|outage|breach|ddos)/i },
  { key: "space_rocks",   weight: 2,  re: /(asteroid|meteor|solar flare|geomagnetic|coronal mass ejection)/i },
  { key: "hope_competence", weight: -2, re: /(agreement reached|peace talks|breakthrough|ceasefire holds|aid package approved)/i },
];

const DRIVERS = [
  "(war OR invasion OR airstrike OR missile OR bombing OR ceasefire OR hostage)",
  "(wildfire OR flood OR hurricane OR heatwave OR earthquake OR drought)",
  "(nuclear OR reactor OR wmd OR missile test)",
  "(cyberattack OR ransomware OR outage OR breach)",
  "(coup OR martial law OR crackdown OR election violence)",
  "(asteroid OR meteor OR solar flare OR geomagnetic)",
  "(world OR international OR global)"
];

const GDELT_BASE = "https://api.gdeltproject.org/api/v2/doc/doc";

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
  closeModal: document.getElementById("closeModal"),
  modalBackdrop: document.getElementById("modalBackdrop"),
  modalTitle: document.getElementById("modalTitle"),
  modalSatire: document.getElementById("modalSatire"),
  modalLink: document.getElementById("modalLink"),
};

function clamp(n, min, max){ return Math.max(min, Math.min(max, n)); }

function labelFor(score){
  const hit = DOOM_LABELS.find(x => score >= x.min && score <= x.max);
  return hit ? hit.label : "Uncategorized vibes.";
}

function normalizeTitle(t){
  return (t || "")
    .toLowerCase()
    .replace(/[“”‘’]/g, "'")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function satireLine(title){
  return `In today’s episode of ‘Surely This Won’t Have Consequences,’ ${title}. Analysts report elevated levels of ‘uh-oh.’`;
}

function classify(title){
  const domains = [];
  let weight = 0;
  const breakdown = {};
  let matched = false;

  for(const r of DOMAIN_RULES){
    if(r.re.test(title)){
      matched = true;
      weight += r.weight;
      domains.push(r.key);
      const k = r.key;
      breakdown[k] = (breakdown[k] || 0) + Math.abs(r.weight);
    }
  }

  if(!matched){
    weight = 1;
    domains.push("misc_chaos");
    breakdown["misc_chaos"] = (breakdown["misc_chaos"] || 0) + 1;
  }

  return { domains, weight, breakdown };
}

// JSONP helper
function jsonp(url, callbackName){
  return new Promise((resolve, reject) => {
    const cb = callbackName || `__gdelt_cb_${Math.random().toString(16).slice(2)}`;
    const script = document.createElement("script");
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("JSONP timeout"));
    }, 15000);

    function cleanup(){
      clearTimeout(timeout);
      script.remove();
      try { delete window[cb]; } catch {}
    }

    window[cb] = (data) => {
      cleanup();
      resolve(data);
    };

    script.src = url + (url.includes("?") ? "&" : "?") + "format=jsonp&callback=" + cb;
    script.onerror = () => {
      cleanup();
      reject(new Error("JSONP load error"));
    };

    document.body.appendChild(script);
  });
}

async function fetchDriver(query, timespan="6h", maxrecords=60){
  const u = new URL(GDELT_BASE);
  u.searchParams.set("query", query);
  u.searchParams.set("mode", "artlist");
  u.searchParams.set("sort", "datedesc");
  u.searchParams.set("timespan", timespan);
  u.searchParams.set("maxrecords", String(maxrecords));
  // JSONP params added by helper
  const data = await jsonp(u.toString());
  return data && data.articles ? data.articles : [];
}

function dedupe(articles){
  const seen = new Set();
  const out = [];
  for(const a of articles){
    const key = normalizeTitle(a.title);
    if(!key || seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

function compute(articles){
  const breakdown = {
    conflict_heat: 0,
    climate_weirdness: 0,
    economy_panic: 0,
    democracy_melting: 0,
    cyber_chaos: 0,
    nuclear_words: 0,
    space_rocks: 0,
    misc_chaos: 0,
    bio_health: 0,
    hope_competence: 0,
  };

  const stories = articles.map((a, idx) => {
    const title = a.title || "Untitled headline";
    const url = a.url || "#";
    const source = a.domain || a.sourceCountry || "Unknown source";
    const publishedAt = a.seendate || "";
    const { domains, weight, breakdown: b } = classify(title);

    Object.keys(b).forEach(k => breakdown[k] = (breakdown[k] || 0) + b[k]);

    return {
      id: `${idx}_${normalizeTitle(title).slice(0,40)}`,
      title,
      url,
      source,
      publishedAt,
      domains,
      weight,
      summary: a.sourceCollection || "",
      satire: satireLine(title),
    };
  });

  // DoomIndex: avg(weight) * scaling factor → 0..100
  const avg = stories.length ? stories.reduce((s,x)=>s+x.weight,0) / stories.length : 0;
  const doomIndex = clamp(Math.round(avg * 12), 0, 100);

  // Drivers = highest absolute weights
  const drivers = [...stories].sort((a,b)=>Math.abs(b.weight)-Math.abs(a.weight)).slice(0, 12);

  return { doomIndex, doomLabel: labelFor(doomIndex), breakdown, drivers, stories };
}

function renderBreakdown(breakdown){
  // choose the display keys (your requested list)
  const keys = [
    ["conflict_heat","Conflict Heat"],
    ["climate_weirdness","Climate Weirdness"],
    ["economy_panic","Economic Drama"],
    ["democracy_melting","Democracy Melting"],
    ["cyber_chaos","Cyber Chaos"],
    ["nuclear_words","Nuclear Words"],
    ["space_rocks","Space Rocks"],
    ["misc_chaos","Misc. Chaos"],
  ];

  const maxVal = Math.max(1, ...keys.map(([k]) => breakdown[k] || 0));
  els.breakdownList.innerHTML = "";

  keys.forEach(([k,label]) => {
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

function storyCard(story, clickable=true){
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

  if(clickable){
    div.style.cursor = "pointer";
    div.addEventListener("click", () => openModal(story));
  }

  return div;
}

function renderLists({drivers, stories}){
  els.driversList.innerHTML = "";
  drivers.forEach(s => els.driversList.appendChild(storyCard(s, true)));

  els.storiesList.innerHTML = "";
  stories.slice(0, 40).forEach(s => els.storiesList.appendChild(storyCard(s, true)));
}

function openModal(story){
  els.modalTitle.textContent = story.title;
  els.modalSatire.textContent = story.satire;
  els.modalLink.href = story.url;
  els.modal.classList.remove("hidden");
}
function closeModal(){
  els.modal.classList.add("hidden");
}
els.closeModal.addEventListener("click", closeModal);
els.modalBackdrop.addEventListener("click", closeModal);

async function refresh(){
  els.doomValue.textContent = "--";
  els.doomLabel.textContent = "Consulting the omens…";
  els.updatedAt.textContent = "";
  els.driversList.innerHTML = "";
  els.storiesList.innerHTML = "";
  els.breakdownList.innerHTML = "";

  try{
    const pulls = await Promise.all(DRIVERS.map(q => fetchDriver(q, "6h", 60).catch(()=>[])));
    const all = dedupe(pulls.flat()).slice(0, 140);

    const result = compute(all);

    els.doomValue.textContent = String(result.doomIndex);
    els.doomLabel.textContent = result.doomLabel;
    els.meterFill.style.width = `${result.doomIndex}%`;
    els.updatedAt.textContent = `Updated: ${new Date().toLocaleString()}`;

    renderBreakdown(result.breakdown);
    renderLists(result);

  } catch(err){
    els.doomValue.textContent = "!!";
    els.doomLabel.textContent = "Error loading headlines. (The universe refused to cooperate.)";
    els.updatedAt.textContent = String(err?.message || err);
  }
}

els.refreshBtn.addEventListener("click", refresh);
refresh();
