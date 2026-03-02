(function () {
  function deriveStateUrlFromLocationUrl(locationUrl) {
    if (!locationUrl || typeof locationUrl !== "string") return null;
    try {
      const u = new URL(locationUrl, window.location.href);
      // If location endpoint ends with /location, swap to /state
      if (u.pathname.endsWith("/location")) {
        u.pathname = u.pathname.replace(/\/location$/, "/state");
        u.search = "";
        return u.toString();
      }
      // Firebase style: .../location.json -> .../state.json
      if (u.pathname.endsWith("/location.json")) {
        u.pathname = u.pathname.replace(/\/location\.json$/, "/state.json");
        u.search = "";
        return u.toString();
      }
      return null;
    } catch {
      return null;
    }
  }

  function getStateUrl() {
    const params = new URLSearchParams(window.location.search);
    const explicit = params.get("stateUrl");
    if (explicit) return explicit;

    // Best effort: derive from the current location URL helper if present.
    const locUrl =
      window.OverlayLocation && typeof window.OverlayLocation.getLocationUrl === "function"
        ? window.OverlayLocation.getLocationUrl()
        : null;

    return deriveStateUrlFromLocationUrl(locUrl) || "state.json";
  }

  async function fetchState() {
    const url = getStateUrl();
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`State fetch failed: ${res.status} ${res.statusText}`);
    return await res.json();
  }

  function startPolling(onState, intervalMs = 5000) {
    if (typeof onState !== "function") return null;

    let stopped = false;
    let inFlight = false;

    const tick = async () => {
      if (stopped || inFlight) return;
      inFlight = true;
      try {
        const state = await fetchState();
        onState(state);
      } catch {
        // ignore
      } finally {
        inFlight = false;
      }
    };

    tick();
    const id = window.setInterval(tick, intervalMs);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }

  window.OverlayState = {
    getStateUrl,
    fetchState,
    startPolling,
  };
})();

