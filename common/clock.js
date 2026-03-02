(function () {
  function parseClockOptions() {
    const params = new URLSearchParams(window.location.search);
    const timeFormat = (params.get("timeFormat") || "12h").toLowerCase(); // 12h | 24h
    const timeZone = params.get("timeZone") || undefined; // e.g. America/Chicago
    const showTimeZone = params.get("showTimeZone");
    return { timeFormat, timeZone };
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

  function startClock(elementId = "clock") {
    const el = document.getElementById(elementId);
    if (!el) return;

    const opts = parseClockOptions();
    const tick = () => {
      el.textContent = formatNow(opts);
    };

    tick();
    return window.setInterval(tick, 1000);
  }

  window.OverlayClock = { startClock };
})();

