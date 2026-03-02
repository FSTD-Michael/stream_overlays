(function () {
  function parseClockOptions() {
    const params = new URLSearchParams(window.location.search);
    const timeFormat = (params.get("timeFormat") || "12h").toLowerCase(); // 12h | 24h
    const timeZone = params.get("timeZone") || undefined; // e.g. America/Chicago
    return { timeFormat, timeZone };
  }

  function formatNow({ timeFormat, timeZone }) {
    const hour12 = timeFormat !== "24h";
    const fmt = new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12,
      timeZone,
    });
    return fmt.format(new Date());
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

