(function () {
  const cache = new Map(); // cacheKey -> cssGradient
  const DBZ_THRESHOLDS = [
    -35, -30, -25, -20, -15, -10, -5, 0,
    5, 10, 15, 20, 25, 30, 35, 40,
    45, 50, 55, 60, 65, 70, 75, 80, 85,
  ];

  function layerNameFor(siteId, product) {
    if (!siteId) return null;
    const s = String(siteId).toLowerCase();
    const p = String(product || "bref").toLowerCase();
    const prod = p.includes("vel") ? "bvel" : "bref";
    return `${s}:${s}_sr_${prod}`;
  }

  function legendUrlFor(layerName) {
    const u = new URL("https://opengeo.ncep.noaa.gov/geoserver/ows");
    u.searchParams.set("service", "WMS");
    u.searchParams.set("version", "1.3.0");
    u.searchParams.set("request", "GetLegendGraphic");
    u.searchParams.set("format", "image/png");
    u.searchParams.set("width", "512");
    u.searchParams.set("height", "32");
    u.searchParams.set("layer", layerName);
    return u.toString();
  }

  function rgbaToCss(r, g, b, a = 255) {
    const alpha = Math.max(0, Math.min(1, a / 255));
    return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
  }

  function rgbDist(a, b) {
    return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
  }

  function normalizeProduct(p) {
    const v = String(p || "").toLowerCase();
    if (v === "n0q" || v.includes("n0q")) return "n0q";
    if (v === "n0u" || v.includes("n0u")) return "n0u";
    if (v === "n0s" || v.includes("n0s") || v.includes("srv") || v.includes("storm")) return "n0s";
    if (v === "n0c" || v.includes("n0c") || v.includes("cc") || v.includes("rho") || v.includes("corr")) return "n0c";
    return v.includes("vel") ? "bvel" : "bref";
  }

  function degToSvgRad(cssDeg) {
    // CSS conic-gradient degrees: 0deg = top, increasing clockwise
    // SVG trig radians here: 0rad = right, increasing clockwise (y down)
    return ((cssDeg - 90) * Math.PI) / 180;
  }

  function clearSvg(svgEl) {
    while (svgEl.firstChild) svgEl.removeChild(svgEl.firstChild);
  }

  function addSvgEl(svgEl, tag, attrs) {
    const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, String(v));
    svgEl.appendChild(el);
    return el;
  }

  function renderDbzArcLabels(svgEl) {
    if (!svgEl) return;
    clearSvg(svgEl);

    const start = 120;
    const end = 240;
    const span = end - start;
    const min = -35;
    const max = 85;

    const center = 50;
    // Put text directly on the ring
    // Place text so the *bottom* of the glyph sits on the rim (a hair inside the border).
    const rText = 49.55;

    // Labels at 10s
    const labels = [];
    for (let v = -30; v <= 80; v += 10) labels.push(v);

    for (const v of labels) {
      // Reverse label direction to match the legend palette orientation (low->high is left->right)
      const tRaw = (v - min) / (max - min);
      const t = 1 - tRaw;
      const deg = start + t * span; // low on left, high on right
      const rad = degToSvgRad(deg);

      const xt = center + rText * Math.cos(rad);
      const yt = center + rText * Math.sin(rad);

      const text = addSvgEl(svgEl, "text", {
        x: xt,
        y: yt,
        "text-anchor": "middle",
        // "text-after-edge" aligns the *bottom* of the text to (x,y),
        // so it visually "rests" on the rim like notebook lettering.
        "dominant-baseline": "text-after-edge",
      });
      // Rotate 90deg clockwise from the previous (tangential) orientation.
      text.setAttribute("transform", `rotate(${(deg + 180).toFixed(2)} ${xt.toFixed(2)} ${yt.toFixed(2)})`);
      text.textContent = String(v);
    }
  }

  function renderVelArcLabels(svgEl) {
    if (!svgEl) return;
    clearSvg(svgEl);

    const start = 120;
    const end = 240;
    const span = end - start;
    // These ticks match the NOAA OpenGeo GeoServer legend for radar_velocity when requested with layout:vertical.
    const min = -100;
    const max = 100;
    const labels = [-100, -80, -60, -45, -20, 0, 20, 45, 60, 80, 100];

    const center = 50;
    const rText = 49.55;

    for (const v of labels) {
      const tRaw = (v - min) / (max - min);
      const t = 1 - tRaw;
      const deg = start + t * span;
      const rad = degToSvgRad(deg);

      const xt = center + rText * Math.cos(rad);
      const yt = center + rText * Math.sin(rad);
      const text = addSvgEl(svgEl, "text", {
        x: xt,
        y: yt,
        "text-anchor": "middle",
        "dominant-baseline": "text-after-edge",
      });
      text.setAttribute("transform", `rotate(${(deg + 180).toFixed(2)} ${xt.toFixed(2)} ${yt.toFixed(2)})`);
      text.textContent = v === 0 ? "0" : String(v);
    }
  }

  function renderCcArcLabels(svgEl) {
    if (!svgEl) return;
    clearSvg(svgEl);

    const start = 120;
    const end = 240;
    const span = end - start;
    // Correlation coefficient (ρhv) commonly plotted 0–1. Keep labels readable.
    const min = 0.5;
    const max = 1.0;
    const labels = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0];

    const center = 50;
    const rText = 49.55;

    for (const v of labels) {
      const tRaw = (v - min) / (max - min);
      const t = 1 - tRaw;
      const deg = start + t * span;
      const rad = degToSvgRad(deg);

      const xt = center + rText * Math.cos(rad);
      const yt = center + rText * Math.sin(rad);
      const text = addSvgEl(svgEl, "text", {
        x: xt,
        y: yt,
        "text-anchor": "middle",
        "dominant-baseline": "text-after-edge",
      });
      text.setAttribute("transform", `rotate(${(deg + 180).toFixed(2)} ${xt.toFixed(2)} ${yt.toFixed(2)})`);
      text.textContent = String(v);
    }
  }

  function gradientForPalette(colorsLowToHigh) {
    const inverted = colorsLowToHigh.slice().reverse();
    return buildBottomArcConicGradientStepped(inverted);
  }

  function ccPalette() {
    // Clean discrete ρhv ramp (low=cool/dark, high=warm/bright)
    return [
      "rgba(20, 20, 20, 1)",
      "rgba(40, 0, 80, 1)",
      "rgba(0, 70, 140, 1)",
      "rgba(0, 160, 170, 1)",
      "rgba(0, 200, 80, 1)",
      "rgba(220, 220, 60, 1)",
      "rgba(255, 150, 30, 1)",
      "rgba(255, 70, 70, 1)",
      "rgba(255, 110, 200, 1)",
    ];
  }

  function buildBottomArcConicGradientStepped(colors) {
    // Map colors across the bottom third (120deg -> 240deg)
    const start = 120;
    const end = 240;
    const span = end - start;

    // Collapse into runs so we get hard steps (no smoothing)
    const runs = [];
    const n = colors.length;

    function parseRGBA(css) {
      const m = String(css).match(/rgba\((\d+),\s*(\d+),\s*(\d+),/i);
      if (!m) return null;
      return [Number(m[1]), Number(m[2]), Number(m[3])];
    }

    function colorDist(a, b) {
      const pa = parseRGBA(a);
      const pb = parseRGBA(b);
      if (!pa || !pb) return 9999;
      return Math.abs(pa[0] - pb[0]) + Math.abs(pa[1] - pb[1]) + Math.abs(pa[2] - pb[2]);
    }

    for (let i = 0; i < n; i++) {
      const c = colors[i];
      if (!runs.length) runs.push({ color: c, startIdx: 0, endIdx: 0 });
      else {
        const last = runs[runs.length - 1];
        // Treat very small differences as the same bucket
        if (colorDist(last.color, c) <= 10) last.endIdx = i;
        else runs.push({ color: c, startIdx: i, endIdx: i });
      }
    }

    const stops = [];
    for (const r of runs) {
      const t0 = n === 1 ? 0 : r.startIdx / (n - 1);
      const t1 = n === 1 ? 1 : r.endIdx / (n - 1);
      const d0 = start + t0 * span;
      const d1 = start + t1 * span;
      stops.push(`${r.color} ${d0.toFixed(2)}deg ${d1.toFixed(2)}deg`);
    }

    return `conic-gradient(from 0deg, transparent 0deg ${start}deg, ${stops.join(", ")}, transparent ${end}deg 360deg)`;
  }

  async function sampleLegendToGradient(layerName, product) {
    const prod = normalizeProduct(product);
    const cacheKey = `${layerName}|${prod}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey);

    const url = legendUrlFor(layerName);
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`Legend fetch failed: ${res.status}`);

    const blob = await res.blob();
    const bmp = await createImageBitmap(blob);

    const canvas = document.createElement("canvas");
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);

    // Detect background color from top-left.
    const bgPx = ctx.getImageData(0, 0, 1, 1).data;
    const bg = [bgPx[0], bgPx[1], bgPx[2]];

    // Find columns that contain "real" bar colors (differs from background).
    const colHasBar = new Array(bmp.width).fill(false);
    for (let x = 0; x < bmp.width; x++) {
      for (let y = 0; y < bmp.height; y++) {
        const px = ctx.getImageData(x, y, 1, 1).data;
        if (px[3] < 160) continue;
        const d = rgbDist([px[0], px[1], px[2]], bg);
        if (d > 35) {
          colHasBar[x] = true;
          break;
        }
      }
    }

    let minX = colHasBar.indexOf(true);
    let maxX = colHasBar.lastIndexOf(true);
    if (minX === -1 || maxX === -1 || maxX <= minX) {
      // Fallback: use full width
      minX = 0;
      maxX = bmp.width - 1;
    }

    // Use NOAA dBZ thresholds bin count for reflectivity; for velocity just use 24 bins.
    const binCount = prod === "bref" ? (DBZ_THRESHOLDS.length - 1) : 24;
    const colors = [];
    let last = "rgba(255, 255, 255, 1)";

    for (let i = 0; i < binCount; i++) {
      const t = binCount === 1 ? 0 : (i + 0.5) / binCount; // bin center
      const x = Math.floor(minX + t * (maxX - minX));
      let best = null;

      for (let y = 0; y < bmp.height; y++) {
        const px = ctx.getImageData(x, y, 1, 1).data;
        if (px[3] < 160) continue;
        const rgb = [px[0], px[1], px[2]];
        const d = rgbDist(rgb, bg);
        if (d <= 35) continue;
        best = px;
        break;
      }

      if (!best) {
        colors.push(last);
        continue;
      }

      last = rgbaToCss(best[0], best[1], best[2], 255);
      colors.push(last);
    }

    // Invert so low values are on the left of the bottom arc and high on the right.
    const inverted = colors.slice().reverse();
    const gradient = buildBottomArcConicGradientStepped(inverted);
    cache.set(cacheKey, gradient);
    return gradient;
  }

  async function applyWmsLegendRing({ ringEl, siteId, product }) {
    if (!ringEl) return;
    const prod = normalizeProduct(product);

    // RIDGE SRV/CC: we render a ring without relying on RIDGE legend graphics.
    if (prod === "n0s" || prod === "n0u") {
      // Reuse the OpenGeo velocity legend so SRV matches the VEL palette you liked.
      const layerName = layerNameFor(siteId, "bvel");
      if (!layerName) return;
      try {
        const gradient = await sampleLegendToGradient(layerName, "bvel");
        ringEl.style.setProperty("--tf-legend-gradient", gradient);
        ringEl.setAttribute("data-product", prod);
      } catch {
        // keep existing/fallback
      }
      return;
    }

    if (prod === "n0c") {
      ringEl.style.setProperty("--tf-legend-gradient", gradientForPalette(ccPalette()));
      ringEl.setAttribute("data-product", prod);
      return;
    }

    const layerName = layerNameFor(siteId, prod);
    if (!layerName) return;

    try {
      const gradient = await sampleLegendToGradient(layerName, prod);
      ringEl.style.setProperty("--tf-legend-gradient", gradient);
      ringEl.setAttribute("data-product", prod);
    } catch {
      // keep existing/fallback
    }
  }

  function applyLegendLabels({ svgEl, product }) {
    if (!svgEl) return;
    const prod = normalizeProduct(product);
    if (prod === "bref") renderDbzArcLabels(svgEl);
    else if (prod === "bvel" || prod === "n0u" || prod === "n0s") renderVelArcLabels(svgEl);
    else if (prod === "n0c") renderCcArcLabels(svgEl);
    else clearSvg(svgEl);
  }

  window.OverlayLegend = {
    layerNameFor,
    applyWmsLegendRing,
    applyLegendLabels,
  };
})();

