(function () {
  function getTestLocationOverride() {
    const params = new URLSearchParams(window.location.search);
    const latRaw = params.get("testLat");
    const lonRaw = params.get("testLon");
    if (latRaw == null || lonRaw == null) return null;

    const lat = Number(latRaw);
    const lon = Number(lonRaw);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

    const location = params.get("testLocation") || "Test Location";
    const headingRaw = params.get("testHeading");
    const heading = headingRaw == null ? undefined : Number(headingRaw);

    return {
      lat,
      lon,
      location,
      updatedAt: new Date().toISOString(),
      heading: Number.isFinite(heading) ? heading : undefined,
    };
  }

  function getLocationUrl() {
    const params = new URLSearchParams(window.location.search);

    const explicitUrl = params.get("locationUrl");
    if (explicitUrl) return explicitUrl;

    const source = (params.get("locationSource") || "firebase").toLowerCase();
    if (source === "local") return "location.json";

    // Default: Firebase RTDB
    return "https://tfoverlays-default-rtdb.firebaseio.com/location.json";
  }

  async function fetchLocation() {
    const testOverride = getTestLocationOverride();
    if (testOverride) return testOverride;

    const url = getLocationUrl();
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`Location fetch failed: ${res.status} ${res.statusText}`);
    return await res.json();
  }

  window.OverlayLocation = {
    getLocationUrl,
    fetchLocation,
  };
})();

