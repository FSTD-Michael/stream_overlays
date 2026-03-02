/**
 * Cloudflare Worker: public read + authenticated write for live GPS location.
 *
 * Endpoints:
 *  - GET  /location        -> returns latest JSON
 *  - PUT  /location        -> writes latest JSON (requires Authorization: Bearer <WRITE_TOKEN>)
 *  - GET  /health          -> basic health
 *
 * Storage:
 *  - KV namespace binding: LOCATION_KV
 *  - key: "latest"
 *
 * Env vars (Worker secrets/vars):
 *  - WRITE_TOKEN (secret)
 *  - ALLOW_ORIGIN (optional; default "*")
 */

const KEY = "latest";
const STATE_KEY = "state";

function corsHeaders(request, allowOrigin) {
  const origin = request.headers.get("Origin") || "";
  const allow = allowOrigin && allowOrigin !== "*" ? allowOrigin : "*";
  // If you set a specific ALLOW_ORIGIN, we only reflect it when it matches.
  const resolved =
    allow === "*" ? "*" : origin === allowOrigin ? allowOrigin : allowOrigin;

  return {
    "Access-Control-Allow-Origin": resolved,
    "Access-Control-Allow-Methods": "GET,PUT,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
  };
}

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...(init.headers || {}),
    },
  });
}

function isValidPayload(payload) {
  if (!payload || typeof payload !== "object") return false;
  const { lat, lon, location } = payload;
  if (typeof lat !== "number" || typeof lon !== "number") return false;
  if (typeof location !== "string") return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  return true;
}

function getBearerToken(request) {
  const auth = request.headers.get("Authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const allowOrigin = env.ALLOW_ORIGIN || "*";

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request, allowOrigin) });
    }

    if (url.pathname === "/health") {
      return jsonResponse({ ok: true }, { headers: corsHeaders(request, allowOrigin) });
    }

    if (url.pathname === "/state") {
      if (request.method === "GET") {
        const raw = await env.LOCATION_KV.get(STATE_KEY);
        const body = raw ? raw : JSON.stringify({ radarProduct: "bref", updatedAt: null });
        return new Response(body, {
          status: 200,
          headers: {
            ...corsHeaders(request, allowOrigin),
            "Content-Type": "application/json; charset=utf-8",
          },
        });
      }

      if (request.method === "PUT") {
        const token = getBearerToken(request);
        if (!env.WRITE_TOKEN || token !== env.WRITE_TOKEN) {
          return jsonResponse(
            { error: "unauthorized" },
            { status: 401, headers: corsHeaders(request, allowOrigin) },
          );
        }

        let payload;
        try {
          payload = await request.json();
        } catch {
          return jsonResponse(
            { error: "invalid_json" },
            { status: 400, headers: corsHeaders(request, allowOrigin) },
          );
        }

        const radarProduct = (payload && payload.radarProduct) || "bref";
        const v = String(radarProduct).toLowerCase();
        const normalized = v.includes("vel") ? "bvel" : "bref";

        const toStore = {
          radarProduct: normalized,
          updatedAt: new Date().toISOString(),
        };

        await env.LOCATION_KV.put(STATE_KEY, JSON.stringify(toStore));
        return jsonResponse({ ok: true }, { headers: corsHeaders(request, allowOrigin) });
      }

      return jsonResponse(
        { error: "method_not_allowed" },
        { status: 405, headers: corsHeaders(request, allowOrigin) },
      );
    }

    if (url.pathname !== "/location") {
      return jsonResponse(
        { error: "not_found" },
        { status: 404, headers: corsHeaders(request, allowOrigin) },
      );
    }

    if (request.method === "GET") {
      const raw = await env.LOCATION_KV.get(KEY);
      if (!raw) {
        return jsonResponse(
          { lat: 0, lon: 0, location: "Unknown", updatedAt: null },
          { headers: corsHeaders(request, allowOrigin) },
        );
      }
      return new Response(raw, {
        status: 200,
        headers: {
          ...corsHeaders(request, allowOrigin),
          "Content-Type": "application/json; charset=utf-8",
        },
      });
    }

    if (request.method === "PUT") {
      const token = getBearerToken(request);
      if (!env.WRITE_TOKEN || token !== env.WRITE_TOKEN) {
        return jsonResponse(
          { error: "unauthorized" },
          { status: 401, headers: corsHeaders(request, allowOrigin) },
        );
      }

      let payload;
      try {
        payload = await request.json();
      } catch {
        return jsonResponse(
          { error: "invalid_json" },
          { status: 400, headers: corsHeaders(request, allowOrigin) },
        );
      }

      if (!isValidPayload(payload)) {
        return jsonResponse(
          { error: "invalid_payload", expected: { lat: "number", lon: "number", location: "string" } },
          { status: 400, headers: corsHeaders(request, allowOrigin) },
        );
      }

      const toStore = {
        lat: payload.lat,
        lon: payload.lon,
        location: payload.location,
        updatedAt: typeof payload.updatedAt === "string" ? payload.updatedAt : new Date().toISOString(),
      };

      if (typeof payload.heading === "number" && Number.isFinite(payload.heading)) {
        toStore.heading = payload.heading;
      }

      await env.LOCATION_KV.put(KEY, JSON.stringify(toStore));
      return jsonResponse({ ok: true }, { headers: corsHeaders(request, allowOrigin) });
    }

    return jsonResponse(
      { error: "method_not_allowed" },
      { status: 405, headers: corsHeaders(request, allowOrigin) },
    );
  },
};

