/*
 * Doomroom News — Cloudflare Worker proxy
 *
 * Purpose:
 * - Fetch GDELT gently.
 * - Honor low maxrecords requests instead of forcing 75.
 * - Cache successful results for 8 hours so this unserious app does not bully GDELT.
 * - If live GDELT fails, serve stale cached data when available.
 */

const GDELT_DOC_API = "https://api.gdeltproject.org/api/v2/doc/doc";
const LIVE_REFRESH_SECONDS = 8 * 60 * 60; // 3 live pulls/day per normalized query
const STALE_CACHE_SECONDS = 7 * 24 * 60 * 60; // keep old omens around as emergency snacks
const FAILURE_COOLDOWN_SECONDS = 20 * 60; // after a GDELT failure, stop poking it for 20 minutes
const UPSTREAM_TIMEOUT_MS = 12_000; // do not let GDELT leave the app spinning forever
const DEFAULT_MAX_RECORDS = 25;
const HARD_MAX_RECORDS = 25;
const DEFAULT_TIMESPAN = "7d";
const DEFAULT_QUERY =
  "(war OR attack OR missile OR drone OR nuclear OR election OR protest OR coup OR inflation OR layoff OR ransomware OR breach OR wildfire OR flood OR hurricane)";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status || 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...CORS_HEADERS,
      ...(init.headers || {}),
    },
  });
}

function clampMaxRecords(value) {
  const n = Number.parseInt(value || `${DEFAULT_MAX_RECORDS}`, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_MAX_RECORDS;
  return Math.max(1, Math.min(HARD_MAX_RECORDS, n));
}

function normalizeParams(requestUrl) {
  const inParams = requestUrl.searchParams;
  const query = (inParams.get("query") || DEFAULT_QUERY).trim() || DEFAULT_QUERY;
  const timespan = (inParams.get("timespan") || DEFAULT_TIMESPAN).trim() || DEFAULT_TIMESPAN;
  const maxrecords = clampMaxRecords(inParams.get("maxrecords"));

  return {
    query,
    timespan,
    maxrecords,
    mode: "ArtList",
    format: "json",
  };
}

function makeGdeltUrl(params) {
  const upstream = new URL(GDELT_DOC_API);
  upstream.searchParams.set("format", params.format);
  upstream.searchParams.set("mode", params.mode);
  upstream.searchParams.set("maxrecords", String(params.maxrecords));
  upstream.searchParams.set("timespan", params.timespan);
  upstream.searchParams.set("query", params.query);
  return upstream;
}

function makeCacheRequest(request, params) {
  // Do NOT include random cache-busters from the app. Normalize by actual feed knobs.
  const cacheUrl = new URL(request.url);
  cacheUrl.pathname = "/__doomroom_cache/gdelt";
  cacheUrl.search = "";
  cacheUrl.searchParams.set("query", params.query);
  cacheUrl.searchParams.set("timespan", params.timespan);
  cacheUrl.searchParams.set("maxrecords", String(params.maxrecords));
  cacheUrl.searchParams.set("mode", params.mode);
  return new Request(cacheUrl.toString(), { method: "GET" });
}

function makeFailureCacheRequest(request, params) {
  const cacheUrl = new URL(request.url);
  cacheUrl.pathname = "/__doomroom_cache/gdelt_failure";
  cacheUrl.search = "";
  cacheUrl.searchParams.set("query", params.query);
  cacheUrl.searchParams.set("timespan", params.timespan);
  cacheUrl.searchParams.set("maxrecords", String(params.maxrecords));
  cacheUrl.searchParams.set("mode", params.mode);
  return new Request(cacheUrl.toString(), { method: "GET" });
}

async function readCached(cache, cacheRequest) {
  const cachedResponse = await cache.match(cacheRequest);
  if (!cachedResponse) return null;

  try {
    const payload = await cachedResponse.clone().json();
    const cachedAt = Number(payload.cachedAt || 0);
    const ageMs = Math.max(0, Date.now() - cachedAt);
    return { payload, cachedAt, ageMs };
  } catch {
    return null;
  }
}

function withCacheMetadata(payload, extra) {
  return {
    ...payload,
    ...extra,
    cacheAgeSeconds: Math.round((extra.cacheAgeMs || 0) / 1000),
  };
}

function classifyUpstreamFailure(resp, text) {
  const preview = (text || "").slice(0, 500);
  const lower = preview.toLowerCase();
  const retryAfter = Number.parseInt(resp.headers.get("Retry-After") || "", 10);
  const looksRateLimited = resp.status === 429 || lower.includes("too many requests") || lower.includes("limit requests");

  if (looksRateLimited) {
    return {
      error: "GDELT rate limit active",
      errorCode: "GDELT_RATE_LIMIT",
      userMessage: "GDELT is rate-limiting the news feed right now. Doomroom will pause live upstream pulls for 20 minutes instead of repeatedly hammering the API. If there is cached data, it will be reused; otherwise the app shows sample omens until GDELT calms down.",
      retryAfterSeconds: Number.isFinite(retryAfter) ? retryAfter : FAILURE_COOLDOWN_SECONDS,
      preview,
    };
  }

  if (!resp.ok) {
    return {
      error: `GDELT HTTP ${resp.status}`,
      errorCode: "GDELT_HTTP_ERROR",
      userMessage: `GDELT returned HTTP ${resp.status}. The Worker understood the response was an upstream error, so it is pausing live pulls briefly instead of retrying in a loop.`,
      retryAfterSeconds: FAILURE_COOLDOWN_SECONDS,
      preview,
    };
  }

  if (lower.includes("queries containing or'd terms") || lower.includes("surrounded by ()")) {
    return {
      error: "GDELT query syntax error",
      errorCode: "GDELT_QUERY_SYNTAX",
      userMessage: "GDELT rejected the query syntax. OR-based searches must be wrapped in parentheses. Doomroom has been updated to do that, and the Worker is pausing this failed query briefly so it does not retry the same bad request in a loop.",
      retryAfterSeconds: FAILURE_COOLDOWN_SECONDS,
      preview,
    };
  }

  return {
    error: "GDELT returned non-JSON response",
    errorCode: "GDELT_NON_JSON",
    userMessage: "GDELT responded, but not with the JSON article feed Doomroom expected. The Worker is pausing live pulls briefly so it does not keep retrying a bad upstream response.",
    retryAfterSeconds: FAILURE_COOLDOWN_SECONDS,
    preview,
  };
}

async function cacheFailure(cache, failureCacheRequest, live) {
  const payload = {
    ...live,
    ok: false,
    failureCachedAt: Date.now(),
    failureCooldownSeconds: FAILURE_COOLDOWN_SECONDS,
  };
  const responseForCache = jsonResponse(payload, {
    headers: {
      "Cache-Control": `public, max-age=${FAILURE_COOLDOWN_SECONDS}`,
    },
  });
  await cache.put(failureCacheRequest, responseForCache.clone());
  return payload;
}

async function readFailureCached(cache, failureCacheRequest) {
  const cachedResponse = await cache.match(failureCacheRequest);
  if (!cachedResponse) return null;
  try {
    const payload = await cachedResponse.clone().json();
    const cachedAt = Number(payload.failureCachedAt || 0);
    const ageMs = Math.max(0, Date.now() - cachedAt);
    const cooldownMs = Number(payload.failureCooldownSeconds || FAILURE_COOLDOWN_SECONDS) * 1000;
    if (!cachedAt || ageMs >= cooldownMs) return null;
    return { payload, ageMs, remainingSeconds: Math.max(1, Math.ceil((cooldownMs - ageMs) / 1000)) };
  } catch {
    return null;
  }
}

async function fetchGdelt(params) {
  const upstream = makeGdeltUrl(params);
  let resp;
  try {
    resp = await fetch(upstream.toString(), {
      method: "GET",
      headers: {
        // Identify the app politely. GDELT asks aggressive users to email them; don't pretend to be a browser swarm.
        "User-Agent": "DoomroomNews/1.0 (+https://github.com/Tkcool28/Doom-meter)",
      },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: "GDELT upstream timeout",
      errorCode: "GDELT_TIMEOUT",
      userMessage: `GDELT did not respond within ${Math.round(UPSTREAM_TIMEOUT_MS / 1000)} seconds. Doomroom is pausing live pulls for 20 minutes instead of leaving the app spinning or retrying in a loop.`,
      retryAfterSeconds: FAILURE_COOLDOWN_SECONDS,
      preview: String(err?.message || err || "upstream timeout").slice(0, 500),
      upstream: upstream.toString(),
    };
  }

  const text = await resp.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    const failure = classifyUpstreamFailure(resp, text);
    return {
      ok: false,
      status: resp.status,
      ...failure,
      upstream: upstream.toString(),
    };
  }

  if (!resp.ok) {
    const failure = classifyUpstreamFailure(resp, JSON.stringify(data));
    return {
      ok: false,
      status: resp.status,
      ...failure,
      upstream: upstream.toString(),
    };
  }

  return {
    ok: true,
    cachedAt: Date.now(),
    source: "gdelt",
    upstream: upstream.toString(),
    requested: params,
    articles: Array.isArray(data.articles) ? data.articles : [],
    raw: data,
  };
}

async function handleGdelt(request) {
  const requestUrl = new URL(request.url);
  const params = normalizeParams(requestUrl);
  const cache = caches.default;
  const cacheRequest = makeCacheRequest(request, params);
  const failureCacheRequest = makeFailureCacheRequest(request, params);
  const cached = await readCached(cache, cacheRequest);
  const failureCached = await readFailureCached(cache, failureCacheRequest);

  if (cached && cached.ageMs < LIVE_REFRESH_SECONDS * 1000) {
    return jsonResponse(withCacheMetadata(cached.payload, {
      ok: true,
      cacheStatus: "HIT_FRESH",
      liveRefreshSeconds: LIVE_REFRESH_SECONDS,
      cacheAgeMs: cached.ageMs,
    }), {
      headers: {
        "Cache-Control": "no-store",
        "X-Doomroom-Cache": "HIT_FRESH",
      },
    });
  }

  if (failureCached) {
    if (cached?.payload) {
      return jsonResponse(withCacheMetadata(cached.payload, {
        ok: true,
        cacheStatus: "STALE_FALLBACK_COOLDOWN",
        liveFailed: true,
        liveError: failureCached.payload.error,
        liveErrorCode: failureCached.payload.errorCode,
        liveUserMessage: failureCached.payload.userMessage,
        livePreview: failureCached.payload.preview,
        liveStatus: failureCached.payload.status,
        failureCooldownSeconds: FAILURE_COOLDOWN_SECONDS,
        failureCooldownRemainingSeconds: failureCached.remainingSeconds,
        liveRefreshSeconds: LIVE_REFRESH_SECONDS,
        cacheAgeMs: cached.ageMs,
      }), {
        headers: {
          "Cache-Control": "no-store",
          "X-Doomroom-Cache": "STALE_FALLBACK_COOLDOWN",
          "X-Doomroom-Failure-Cooldown": String(failureCached.remainingSeconds),
        },
      });
    }

    return jsonResponse({
      ...failureCached.payload,
      ok: false,
      cacheStatus: "FAILURE_COOLDOWN",
      failureCooldownRemainingSeconds: failureCached.remainingSeconds,
      requested: params,
    }, {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "X-Doomroom-Cache": "FAILURE_COOLDOWN",
        "X-Doomroom-Failure-Cooldown": String(failureCached.remainingSeconds),
      },
    });
  }

  const live = await fetchGdelt(params);

  if (live.ok) {
    const responseForCache = jsonResponse(live, {
      headers: {
        // Keep stale data longer than the live refresh window so failures can fall back gracefully.
        "Cache-Control": `public, max-age=${STALE_CACHE_SECONDS}`,
      },
    });
    await cache.put(cacheRequest, responseForCache.clone());

    return jsonResponse({
      ...live,
      cacheStatus: cached ? "REFRESHED_STALE" : "MISS_REFRESHED",
      liveRefreshSeconds: LIVE_REFRESH_SECONDS,
      cacheAgeSeconds: 0,
    }, {
      headers: {
        "Cache-Control": "no-store",
        "X-Doomroom-Cache": cached ? "REFRESHED_STALE" : "MISS_REFRESHED",
      },
    });
  }

  const cachedFailure = await cacheFailure(cache, failureCacheRequest, live);

  if (cached?.payload) {
    return jsonResponse(withCacheMetadata(cached.payload, {
      ok: true,
      cacheStatus: "STALE_FALLBACK",
      liveFailed: true,
      liveError: live.error,
      liveErrorCode: live.errorCode,
      liveUserMessage: live.userMessage,
      livePreview: live.preview,
      liveStatus: live.status,
      failureCooldownSeconds: FAILURE_COOLDOWN_SECONDS,
      failureCooldownRemainingSeconds: FAILURE_COOLDOWN_SECONDS,
      liveRefreshSeconds: LIVE_REFRESH_SECONDS,
      cacheAgeMs: cached.ageMs,
    }), {
      headers: {
        "Cache-Control": "no-store",
        "X-Doomroom-Cache": "STALE_FALLBACK",
      },
    });
  }

  return jsonResponse({
    ...cachedFailure,
    ok: false,
    cacheStatus: "MISS_LIVE_FAILED_COOLDOWN",
    failureCooldownRemainingSeconds: FAILURE_COOLDOWN_SECONDS,
    requested: params,
  }, {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
      "X-Doomroom-Cache": "MISS_LIVE_FAILED_COOLDOWN",
      "X-Doomroom-Failure-Cooldown": String(FAILURE_COOLDOWN_SECONDS),
    },
  });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (url.pathname === "/health") {
      return jsonResponse({ ok: true, service: "doomroom-worker", version: "2026-06-04-failure-cooldown-timeout", failureCooldownSeconds: FAILURE_COOLDOWN_SECONDS });
    }

    if (url.pathname === "/gdelt") {
      return handleGdelt(request);
    }

    return jsonResponse({ ok: false, error: "Not found", routes: ["/health", "/gdelt"] }, { status: 404 });
  },
};
