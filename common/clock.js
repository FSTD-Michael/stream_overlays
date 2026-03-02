(function () {
  let _opts = null;
  let _tzLastFetchMs = 0;
  let _tzLastLat = null;
  let _tzLastLon = null;
  let _tzInFlight = null;

  function parseClockOptions() {
    const params = new URLSearchParams(window.location.search);
    const timeFormat = (params.get("timeFormat") || "12h").toLowerCase(); // 12h | 24h
    const timeZone = params.get("timeZone") || undefined; // e.g. America/Chicago
    const showTimeZone = params.get("showTimeZone");
    return { timeFormat, timeZone, showTimeZone };
  }

  function formatNow({ timeFormat, timeZone, showTimeZone }) {
    const hour12 = timeFormat !== "24h";
    const showTz = showTimeZone == null ? true : (showTimeZone !== "0" && showTimeZone.toLowerCase() !== "false" && showTimeZone.toLowerCase() !== "off");

    const baseFmt = new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12,
      timeZone,
    });

    if (!showTz) return baseFmt.format(new Date());

    const tzFmt = new Intl.DateTimeFormat(undefined, { timeZoneName: "short", timeZone });
    const parts = tzFmt.formatToParts(new Date());
    const tz = (parts.find((p) => p.type === "timeZoneName") || {}).value;
    const t = baseFmt.format(new Date());
    return tz ? `${t} ${tz}` : t;
  }

  function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  async function fetchTimeZoneFromNws(lat, lon) {
    const url = `https://api.weather.gov/points/${lat},${lon}`;
    const res = await fetch(url, { cache: "no-store", headers: { Accept: "application/geo+json" } });
    if (!res.ok) return null;
    const data = await res.json();
    const tz = data && data.properties && data.properties.timeZone;
    return tz ? String(tz) : null;
  }

  async function updateTimeZoneFromLatLon(lat, lon) {
    if (!_opts) return;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

    // If user explicitly pinned a tz via ?timeZone=..., don't auto-override it.
    if (_opts.timeZone && (new URLSearchParams(window.location.search)).get("timeZone")) return;

    const now = Date.now();
    const minIntervalMs = 5 * 60 * 1000; // 5 minutes
    const minMoveKm = 50; // don't refetch unless we moved significantly

    if (_tzLastLat != null && _tzLastLon != null) {
      const moved = haversineKm(_tzLastLat, _tzLastLon, lat, lon);
      if (moved < minMoveKm && now - _tzLastFetchMs < minIntervalMs) return;
    } else {
      if (now - _tzLastFetchMs < minIntervalMs) return;
    }

    _tzLastFetchMs = now;
    _tzLastLat = lat;
    _tzLastLon = lon;

    if (_tzInFlight) return;
    _tzInFlight = (async () => {
      try {
        const tz = await fetchTimeZoneFromNws(lat, lon);
        if (tz) _opts.timeZone = tz;
      } catch {
        // ignore
      } finally {
        _tzInFlight = null;
      }
    })();
  }

  function startClock(elementId = "clock") {
    const el = document.getElementById(elementId);
    if (!el) return;

    const opts = parseClockOptions();
    _opts = opts;
    const tick = () => {
      el.textContent = formatNow(opts);
    };

    tick();
    return window.setInterval(tick, 1000);
  }

  window.OverlayClock = { startClock, updateTimeZoneFromLatLon };
})();

