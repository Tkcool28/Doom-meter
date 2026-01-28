/* Doom-meter — app.js
   - Pulls headlines via GDELT DOC 2.1 API (JSONP) so it works on GitHub Pages
   - Computes a silly "Doom Index" and shows drivers + stories
   - Modal is mobile-safe: taps inside modal won't close it, and link is clickable
*/

(() => {
  // ----------------------------
  // Config
  // ----------------------------
  const GDELT_BASE = "https://api.gdeltproject.org/api/v2/doc/doc";

  // Queries used to fetch “drivers”
  // (Keep/adjust to taste.)
  const DRIVERS = [
    "war OR conflict OR invasion OR strike OR bombing",
    "climate OR wildfire OR flood OR hurricane OR drought",
    "inflation OR recession OR layoffs OR crisis",
    "election OR vote OR democracy OR authoritarian OR coup",
    "hack OR cyberattack OR ransomware OR breach",
    "nuclear OR uranium OR missile OR reactor",
    "asteroid OR meteor OR comet OR space debris",
    "chaos OR unrest OR riot OR collapse OR scandal",
  ];

  // ----------------------------
  // DOM
  // ----------------------------
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
    modalBackdrop: document.getElementById("modalBackdrop"),
    closeModal: document.getElementById("closeModal"),
    modalTitle: document.getElementById("modalTitle"),
    modalSatire: document.getElementById("modalSatire"),
    modalLink: document.getElementById("modalLink"),
  };

  // If any key elements are missing, fail loudly (helps debugging)
  const requiredIds = [
    "doomValue",
    "doomLabel",
    "meterFill",
    "updatedAt",
    "breakdownList",
    "driversList",
    "storiesList",
    "refreshBtn",
    "modal",
    "modalBackdrop",
    "closeModal",
    "modalTitle",
    "modalSatire",
    "modalLink",
  ];
  for (const id of requiredIds) {
    if (!document.getElementById(id)) {
      console.warn(`[doom-meter] Missing element #${id}. Check index.html.`);
    }
  }

  // ----------------------------
  // Helpers
  // ----------------------------
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

  function normalizeTitle(t) {
    return String(t || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .trim();
  }

  // JSONP helper (CORS-safe for GitHub Pages)
  function jsonp(url) {
    return new Promise((resolve, reject) => {
      const cb = `__doom_cb_${Math.random().toString(36).slice(2)}`;
      const script = document.createElement("script");

      const cleanup = () => {
        try {
          delete window[cb];
        } catch (_) {
          window[cb] = undefined;
        }
        if (script && script.parentNode) script.parentNode.removeChild(script);
      };

      window[cb] = (data) => {
        cleanup();
        resolve(data);
      };

      const u = new URL(url);
      // Ensure we append params correctly
      const joiner = u.toString().includes("?") ? "&" : "?";
      script.src = `${u.toString()}${joiner}format=jsonp&callback=${cb}`;

      script.onerror = () => {
        cleanup();
        reject(new Error("JSONP load error"));
      };

      document.body.appendChild(script);
    });
  }

  async function fetchDriver(query, timespan = "6h", maxrecords = 60) {
    const u = new URL(GDELT_BASE);
    u.searchParams.set("query", query);
    u.searchParams.set("mode", "artlist");
    u.searchParams.set("sort", "datedesc");
    u.searchParams.set("timespan", timespan);
    u.searchParams.set("maxrecords", String(maxrecords));

    const data = await jsonp(u.toString());
    // GDELT sometimes returns empty objects
    return data && data.articles ? data.articles : [];
  }

  function dedupe(articles) {
    const seen = new Set();
    const out = [];
    for (const a of articles) {
      const key = normalizeTitle(a.title);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(a);
    }
    return out;
  }

  // Classify a title into our breakdown buckets
  function classify(title) {
    const t = normalizeTitle(title);

    const has = (re) => re.test(t);

    // Defaults
    let domains = [];
    let weight = 1;
    let breakdown = {
      conflict_heat: 0,
      climate_weirdness: 0,
      economy_panic: 0,
      democracy_melting: 0,
      cyber_chaos: 0,
      nuclear_words: 0,
      space_rocks: 0,
      misc_chaos: 0,
    };

    // Conflict
    if (
      has(/\bwar\b|\bconflict\b|\binvasion\b|\bstrike\b|\bbomb\b|\bmissile\b|\battack\b|\bshelling\b|\bmilitary\b/)
    ) {
      breakdown.conflict_heat += 1;
      domains.push("conflict");
      weight += 2;
    }

    // Climate
    if (
      has(/\bclimate\b|\bwildfire\b|\bflood\b|\bhurricane\b|\bdrought\b|\bheatwave\b|\bstorm\b|\btemperature\b/)
    ) {
      breakdown.climate_weirdness += 1;
      domains.push("climate");
      weight += 1;
    }

    // Economy
    if (
      has(/\binflation\b|\brecession\b|\blayoff\b|\bdebt\b|\bcrisis\b|\bbank\b|\bstocks\b|\bmarket\b|\bdefault\b/)
    ) {
      breakdown.economy_panic += 1;
      domains.push("economy");
      weight += 1;
    }

    // Democracy / politics
    if (
      has(/\belection\b|\bvote\b|\bballot\b|\bdemocracy\b|\bcoup\b|\bauthoritarian\b|\bprotest\b|\bparliament\b/)
    ) {
      breakdown.democracy_melting += 1;
      domains.push("democracy");
      weight += 1;
    }

    // Cyber
    if (
      has(/\bhack\b|\bcyber\b|\bransomware\b|\bbreach\b|\bleak\b|\bmalware\b|\bphishing\b|\bddos\b/)
    ) {
      breakdown.cyber_chaos += 1;
      domains.push("cyber");
      weight += 1;
    }

    // Nuclear
    if (
      has(/\bnuclear\b|\buranium\b|\bplutonium\b|\breactor\b|\barmageddon\b|\bwarhead\b/)
    ) {
      breakdown.nuclear_words += 1;
      domains.push("nuclear");
      weight += 2;
    }

    // Space rocks
    if (has(/\basteroid\b|\bmeteor\b|\bcomet\b|\bspace debris\b|\bnear-?earth\b/)) {
      breakdown.space_rocks += 1;
      domains.push("space");
      weight += 1;
    }

    // If none matched, it’s miscellaneous chaos
    const sum =
      breakdown.conflict_heat +
      breakdown.climate_weirdness +
      breakdown.economy_panic +
      breakdown.democracy_melting +
      breakdown.cyber_chaos +
      breakdown.nuclear_words +
      breakdown.space_rocks;

    if (sum === 0) {
      breakdown.misc_chaos += 1;
      domains.push("misc");
      weight += 0; // keep it modest
    } else {
      // also add a small misc bump to reflect general "uh-oh"
      breakdown.misc_chaos += 0;
    }

    return { domains, weight, breakdown };
  }

  function satireLine(title) {
    // Short, consistent, PG satire
    const t = String(title || "Untitled headline").trim();
    return `In today’s episode of ‘Surely
