/* Doom-meter — app.js
   Works on GitHub Pages via JSONP (no CORS).
*/
(() => {
  const APP_VERSION = "1.4.0";

  const GDELT_BASE = "https://api.gdeltproject.org/api/v2/doc/doc";

  // Use broad, reliable queries. Keep them simple.
  // sourcelang:english is appended automatically.
  const DRIVERS = [
    { key: "conflict_heat", label: "Conflict Heat", query: '(war OR missile OR airstrike OR "ground invasion" OR ceasefire OR hostage)' },
    { key: "climate_weirdness", label: "Climate Weirdness", query: '("climate change" OR wildfire OR hurricane OR flood OR drought OR heatwave)' },
    { key: "economy_panic", label: "Economic Drama", query: '(inflation OR recession OR layoffs OR "bank failure" OR "debt crisis" OR "rate hike")' },
    { key: "democracy_melting", label: "Democracy Melting", query: '(election OR coup OR protest OR "state of emergency" OR impeachment OR "martial law")' },
    { key: "cyber_chaos", label: "Cyber Chaos", query: '(ransomware OR "data breach" OR cyberattack OR "hacked" OR "leak" OR "zero-day")' },
    { key: "nuclear_words", label: "Nuclear Words", query: '(nuclear OR uranium OR ICBM OR "nuclear plant" OR "nuclear test")' },
    { key: "space_rocks", label: "Space Rocks", query: '(asteroid OR meteor OR "near-earth object" OR comet OR NASA)' },
    { key: "misc_chaos", label: "Misc. Chaos", query: '(earthquake OR volcano OR tsunami OR "mysterious illness" OR UFO OR "mass outage")' },

    // A little “hope” to allow the score to chill sometimes.
    { key: "hope_competence", label: "Hope & Competence", query: '(breakthrough OR "peace talks" OR "cease-fire" OR "new treatment" OR "cured" OR "record growth")' },
  ];

  // --- DOM helpers ---
  const $ = (id) => document.getElementById(id);

  const els = {
    refreshBtn: $("refreshBtn"),
    doomValue: $("doomValue"),
    doomLabel: $("doomLabel"),
    meterFill: $("meterFill"),
    updatedAt: $("updatedAt"),
    breakdownList: $("breakdownList"),
    driversList: $("driversList"),
    storiesList: $("storiesList"),

    modal: $("modal"),
    modalTitle: $("modalTitle"),
    modalSatire: $("modalSatire"),
    modalLink: $("modalLink"),
    closeModal: $("closeModal"),
    modalBackdrop: $("modalBackdrop"),
  };

  // --- Utilities ---
  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }

  function normalizeTitle(t) {
    return String(t || "")
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, "")
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function formatGdeltDate(seendate) {
    // Often: YYYYMMDDHHMMSS
    const s = String(seendate || "");
    if (!/^\d{14}$/.test(s)) return "";
    const y = s.slice(0, 4);
    const m = s.slice(4, 6);
    const d = s.slice(6, 8);
    const hh = s.slice(8, 10);
    const mm = s.slice(10, 12);
    return `${y}-${m}-${d} ${hh}:${mm}`;
  }

  // --- JSONP (no CORS) ---
  function jsonp(url, timeoutMs = 12000) {
    return new Promise((resolve, reject) => {
      const cb = "__gdelt_cb_" + Math.random().toString(36).slice(2);
      const script = document.createElement("script");
      let timer = null;

      function cleanup() {
        if (timer) clearTimeout(timer);
        script.remove();
        try { delete window[cb]; } catch (_) { window[cb] = undefined; }
      }

      window[cb] = (data) => {
        cleanup();
        resolve(data);
      };

      const join = url.includes("?") ? "&" : "?";
      script.src = `${url}${join}format=jsonp&callback=${cb}`;

      script.onerror = () => {
        cleanup();
        reject(new Error("JSONP script load error (blocked or offline)"));
      };

      timer = setTimeout(() => {
        cleanup();
        reject(new Error("JSONP timeout (GDELT slow or blocked)"));
      }, timeoutMs);

      document.body.appendChild(script);
    });
  }

  // --- GDELT fetch ---
  async function fetchDriverArticles(driverQuery, timespan = "24h", maxrecords = 60) {
    const q = `(${driverQuery}) sourcelang:english`;

    const u = new URL(GDELT_BASE);
    u.searchParams.set("query", q);
    u.searchParams.set("mode", "artlist");
    u.searchParams.set("sort", "datedesc");
    u.searchParams.set("timespan", timespan);
    u.searchParams.set("maxrecords", String(maxrecords));

    const data = await jsonp(u.toString());

    // GDELT sometimes returns { status, message } on issues
    if (data && (data.status === "error" || data.error || data.message)) {
      const msg = data.message || data.error || "GDELT returned an error.";
      throw new Error(msg);
    }

    const articles = (data && data.articles) ? data.articles : [];
    return articles;
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

  // --- Scoring / classification ---
  function classify(title) {
    const t = String(title || "").toLowerCase();

    const rules = [
      ["conflict_heat", /war|missile|airstrike|invasion|ceasefire|hostage|shelling|militia/],
      ["climate_weirdness", /climate|wildfire|hurricane|flood|drought|heatwave|storm|cyclone/],
      ["economy_panic", /inflation|recession|layoff|bank|debt|rate hike|yield|markets|stocks plunge/],
      ["democracy_melting", /election|coup|protest|impeach|martial law|state of emergency|riot/],
      ["cyber_chaos", /ransomware|data breach|cyber|hacked|leak|zero-day|ddos/],
      ["nuclear_words", /nuclear|uranium|icbm|reactor|nuke|enrichment/],
      ["space_rocks", /asteroid|meteor|comet|near-earth|nasa/],
      ["misc_chaos", /earthquake|volcano|tsunami|ufo|mysterious|outage|collapse/],
      ["hope_competence", /breakthrough|peace talks|cease-fire|new treatment|cured|record growth|deal reached/],
    ];

    const hits = {};
    for (const [k, rx] of rules) hits[k] = rx.test(t) ? 1 : 0;

    // Weighting: hope reduces doom a bit.
    const weight =
      hits.conflict_heat * 1.4 +
      hits.climate_weirdness * 1.2 +
      hits.economy_panic * 1.2 +
      hits.democracy_melting * 1.1 +
      hits.cyber_chaos * 1.1 +
      hits.nuclear_words * 1.4 +
      hits.space_rocks * 0.7 +
      hits.misc_chaos * 0.9 -
      hits.hope_competence * 1.3;

    return { hits, weight };
  }

  function doomLabelFor(idx) {
    if (idx <= 10) return "We’re so back.";
    if (idx <= 25) return "Mildly cursed.";
    if (idx <= 45) return "Vibes: concerning.";
    if (idx <= 65) return "The timeline is wobbling.";
    if (idx <= 80) return "Duck and cover-ish.";
    return "Hide under desk. The universe is screaming.";
  }

  function satireLine(title) {
    const t = String(title || "");
    const bits = [
      "Experts recommend turning it off and on again (society).",
      "Scientists confirm: this is not ideal.",
      "Officials say everything is under control. Narrator: it wasn’t.",
      "Local reality continues to do the most.",
      "Markets react by making that face.",
      "Humanity speedrunning a patch note.",
      "The vibes have entered the chat.",
      "Nature has selected ‘hard mode’ again.",
    ];
    // tiny deterministic-ish shuffle by title length
    const pick = bits[(t.length + t.charCodeAt(0 || 0)) % bits.length];
    return pick;
  }

  // --- Rendering ---
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
      ["hope_competence", "Hope & Competence"],
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

  function storyCard(story, clickable = true) {
    const div = document.createElement("div");
    div.className = "item";

    const title = document.createElement("div");
    title.className = "item__title";
    title.textContent = story.title;

    const meta = document.createElement("div");
    meta.className = "item__meta";
    const dateStr = story.publishedAt ? ` • ${story.publishedAt}` : "";
    meta.textContent = `${story.source || "Unknown"}${dateStr} • weight ${story.weight.toFixed(1)}`;

    const sat = document.createElement("div");
    sat.className = "item__satire";
    sat.textContent = story.satire;

    div.appendChild(title);
    div.appendChild(meta);
    div.appendChild(sat);

    if (clickable) {
      div.style.cursor = "pointer";
      div.addEventListener("click", () => openModal(story));
    }
    return div;
  }

  function renderLists(stories) {
    els.driversList.innerHTML = "";
    els.storiesList.innerHTML = "";

    // "Top Drivers" = highest absolute weight stories
    const drivers = [...stories]
      .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
      .slice(0, 10);

    drivers.forEach((s) => els.driversList.appendChild(storyCard(s, true)));

    // Latest Stories
    const latest = [...stories].slice(0, 40);
    latest.forEach((s) => els.storiesList.appendChild(storyCard(s, true)));
  }

  function openModal(story) {
    els.modalTitle.textContent = story.title;
    els.modalSatire.textContent = story.satire;
    els.modalLink.href = story.url || "#";
    els.modal.classList.remove("hidden");
  }

  function closeModal() {
    els.modal.classList.add("hidden");
  }

  // --- Main compute ---
  function compute(allArticles) {
    const breakdown = {
      conflict_heat: 0,
      climate_weirdness: 0,
      economy_panic: 0,
      democracy_melting: 0,
      cyber_chaos: 0,
      nuclear_words: 0,
      space_rocks: 0,
      misc_chaos: 0,
      hope_competence: 0,
    };

    const stories = allArticles.map((a) => {
      const title = a.title || "Untitled headline";
      const url = a.url || "#";
      const source = a.domain || a.sourceCountry || "Unknown source";
      const publishedAt = formatGdeltDate(a.seendate);

      const { hits, weight } = classify(title);
      Object.keys(breakdown).forEach((k) => (breakdown[k] += hits[k] || 0));

      return {
        id: normalizeTitle(title).slice(0, 60),
        title,
        url,
        source,
        publishedAt,
        weight,
        satire: satireLine(title),
      };
    });

    // DoomIndex mapped from average weight into 0..100
    const avgWeight = stories.length
      ? stories.reduce((s, x) => s + x.weight, 0) / stories.length
      : 0;

    // avgWeight ~ [-1.5 .. 4+] typically
    const doomIndex = clamp(Math.round((avgWeight + 2) * 12.5), 0, 100);

    return { doomIndex, doomLabel: doomLabelFor(doomIndex), breakdown, stories };
  }

  async function refresh() {
    // Always show version, even on error.
    els.doomValue.textContent = "--";
    els.doomLabel.textContent = "Consulting the omens…";
    els.updatedAt.textContent = `v${APP_VERSION} • loading…`;
    els.meterFill.style.width = "0%";

    els.driversList.innerHTML = "";
    els.storiesList.innerHTML = "";
    els.breakdownList.innerHTML = "";

    try {
      // Pull each driver query, then merge + dedupe.
      const timespan = "24h";
      const maxrecords = 60;

      const pulls = await Promise.all(
        DRIVERS.map((d) => fetchDriverArticles(d.query, timespan, maxrecords).catch((e) => {
          // Keep going even if one driver fails
          return { __error: String(e && e.message ? e.message : e) };
        }))
      );

      // If any pull returned an error object, collect it for debugging
      const errors = pulls
        .filter((x) => x && x.__error)
        .map((x) => x.__error);

      // Flatten only the arrays
      const flat = pulls.filter(Array.isArray).flat();
      const all = dedupe(flat).slice(0, 140);

      if (!all.length) {
        const msg = errors.length
          ? `GDELT error(s): ${errors.join(" | ")}`
          : "No articles returned from GDELT (empty result set).";

        throw new Error(msg);
      }

      const result = compute(all);

      els.doomValue.textContent = String(result.doomIndex);
      els.doomLabel.textContent = result.doomLabel;
      els.meterFill.style.width = `${result.doomIndex}%`;
      els.updatedAt.textContent = `Updated: ${new Date().toLocaleString()} • v${APP_VERSION} • ${all.length} articles`;

      renderBreakdown(result.breakdown);
      renderLists(result.stories);
    } catch (err) {
      els.doomValue.textContent = "!!";
      els.doomLabel.textContent = "Error loading headlines.";
      els.meterFill.style.width = "0%";
      els.updatedAt.textContent = `v${APP_VERSION} • ${new Date().toLocaleString()}`;

      const msg = String(err && err.message ? err.message : err);
      els.breakdownList.innerHTML = "";
      els.driversList.innerHTML = "";
      els.storiesList.innerHTML = "";

      // Show the error in the breakdown area so it's visible
      const div = document.createElement("div");
      div.className = "item";
      div.innerHTML = `
        <div class="item__title">No articles returned.</div>
        <div class="item__meta">${msg}</div>
        <div class="item__satire">If you’re using an adblocker / strict privacy mode, it may block api.gdeltproject.org JSONP requests.</div>
      `;
      els.storiesList.appendChild(div);
    }
  }

  // --- Events ---
  els.closeModal.addEventListener("click", closeModal);
  els.modalBackdrop.addEventListener("click", closeModal);
  els.refreshBtn.addEventListener("click", refresh);

  // Boot
  refresh();
})();
