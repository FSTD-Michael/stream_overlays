(function () {
  function getParamBool(name, defaultValue = true) {
    const params = new URLSearchParams(window.location.search);
    const v = params.get(name);
    if (v === null) return defaultValue;
    return v !== "0" && v.toLowerCase() !== "false" && v.toLowerCase() !== "off";
  }

  function getParamNumber(name, defaultValue) {
    const params = new URLSearchParams(window.location.search);
    const v = params.get(name);
    if (v === null) return defaultValue;
    const n = Number(v);
    return Number.isFinite(n) ? n : defaultValue;
  }

  function addDarkBasemap(map) {
    // CARTO Dark Matter (raster). Free-ish and looks great for radar overlays.
    // We use a no-label basemap + a labels-only overlay above radar to keep city names readable.
    // https://carto.com/basemaps/
    const baseUrl = "https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png";
    const labelsUrl = "https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png";

    const baseLayer = L.tileLayer(baseUrl, {
      maxZoom: 20,
      subdomains: "abcd",
      updateWhenIdle: true,
      keepBuffer: 2,
      zIndex: 100,
    });
    baseLayer.addTo(map);

    // Optional label overlay (enabled by default)
    const labelsEnabled = getParamBool("labels", true);
    if (!labelsEnabled) return { baseLayer, labelsLayer: null };

    const labelsOpacity = Math.min(1, Math.max(0, getParamNumber("labelsOpacity", 0.95)));
    const labelsBrightness = Math.max(0.5, Math.min(3, getParamNumber("labelsBrightness", 1.35)));
    const labelsContrast = Math.max(0.5, Math.min(3, getParamNumber("labelsContrast", 1.1)));

    // Ensure a pane above radar (radar zIndex is ~350)
    if (!map.getPane("labelsPane")) {
      map.createPane("labelsPane");
      map.getPane("labelsPane").style.zIndex = 650;
      map.getPane("labelsPane").style.pointerEvents = "none";
    }

    const labelsLayer = L.tileLayer(labelsUrl, {
      maxZoom: 20,
      subdomains: "abcd",
      updateWhenIdle: true,
      keepBuffer: 2,
      opacity: labelsOpacity,
      pane: "labelsPane",
      zIndex: 650,
    }).addTo(map);

    labelsLayer.on("load", () => {
      const c = labelsLayer.getContainer && labelsLayer.getContainer();
      if (c) c.style.filter = `brightness(${labelsBrightness}) contrast(${labelsContrast})`;
    });

    return { baseLayer, labelsLayer };
  }

  function createHeadingMarker(map) {
    const icon = L.divIcon({
      className: "",
      html: `
        <div class="pulse-wrapper">
          <div class="pulse-ring"></div>
          <div class="heading-arrow" data-role="heading-arrow"></div>
          <div class="pulse"></div>
        </div>
      `,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    });

    let marker = null;

    function setHeadingOnElement(el, heading) {
      if (!el) return;
      const arrow = el.querySelector('[data-role="heading-arrow"]');
      if (!arrow) return;
      if (typeof heading !== "number" || !Number.isFinite(heading)) {
        arrow.style.display = "none";
        return;
      }
      arrow.style.display = "block";
      arrow.style.transform = `translate(-50%, -65%) rotate(${heading}deg)`;
    }

    function set(lat, lon, heading) {
      if (!marker) {
        marker = L.marker([lat, lon], { icon }).addTo(map);
      } else {
        marker.setLatLng([lat, lon]);
      }

      // Ensure the DOM exists before applying rotation.
      const el = marker.getElement && marker.getElement();
      setHeadingOnElement(el, heading);
    }

    return { set };
  }

  function createWarningsLayer(map) {
    const enabled = getParamBool("warnings", true);
    if (!enabled) return { update: async () => {} };

    const layer = L.geoJSON(null, {
      style: (feature) => {
        const event = (feature && feature.properties && feature.properties.event) || "";
        const ev = String(event).toLowerCase();

        // Defaults
        let color = "#ffcc00"; // severe-ish
        let fillColor = "#ffcc00";

        if (ev.includes("tornado")) {
          color = "#ff1a1a";
          fillColor = "#ff1a1a";
        } else if (ev.includes("severe thunderstorm")) {
          color = "#ffcc00";
          fillColor = "#ffcc00";
        } else if (ev.includes("flash flood") || ev.includes("flood")) {
          color = "#00d084";
          fillColor = "#00d084";
        } else if (ev.includes("winter") || ev.includes("blizzard") || ev.includes("ice")) {
          color = "#6ea8fe";
          fillColor = "#6ea8fe";
        }

        return {
          color,
          weight: 2,
          opacity: 0.9,
          fillColor,
          fillOpacity: 0.12,
        };
      },
    }).addTo(map);

    let lastFetchMs = 0;
    const minIntervalMs = 60000;

    async function update(lat, lon) {
      const now = Date.now();
      if (now - lastFetchMs < minIntervalMs) return;
      lastFetchMs = now;

      try {
        const url = `https://api.weather.gov/alerts/active?point=${lat},${lon}`;
        const res = await fetch(url, {
          cache: "no-store",
          headers: { Accept: "application/geo+json" },
        });
        if (!res.ok) return;
        const data = await res.json();
        layer.clearLayers();
        if (data) layer.addData(data);
      } catch {
        // ignore
      }
    }

    return { update };
  }

  function createRadarLayer(map, opts = {}) {
    const enabled = getParamBool("radar", true);
    if (!enabled) return { init: async () => {}, refresh: async () => {} };

    const opacity = Math.min(1, Math.max(0, getParamNumber("radarOpacity", 0.6)));
    const params = new URLSearchParams(window.location.search);
    const providerParam = (opts.provider || params.get("radarProvider") || "iem_site").toLowerCase();
    // Back-compat: `iem_site` was the old name for OpenGeo single-site WMS.
    let currentProvider = providerParam === "iem_site" ? "opengeo_site" : providerParam; // opengeo_site | ridge_site | thredds_cc | iem_mosaic | rainviewer
    const radarSiteOverride = (params.get("radarSite") || "").toUpperCase(); // e.g. KFTG
    const radarStationType = (params.get("radarStationType") || "WSR-88D").toUpperCase();
    const radarProductParam = (opts.product || params.get("radarProduct") || "bref").toLowerCase(); // bref | bvel | n0q | n0u | n0s | n0c
    // Optional CORS proxy for THREDDS (defaults to same-origin Worker if locationUrl points at it).
    let threddsProxyBase = String(opts.threddsProxy || params.get("threddsProxy") || "");
    if (!threddsProxyBase) {
      const locationUrlParam = params.get("locationUrl");
      if (locationUrlParam) {
        try {
          const u = new URL(locationUrlParam);
          threddsProxyBase = `${u.origin}/proxy/thredds`;
        } catch {
          // ignore
        }
      }
    }

    // RainViewer options (used only when radarProvider=rainviewer)
    const radarColor = Math.round(getParamNumber("radarColor", 2)); // RainViewer color scheme (2 looks good on dark basemap)
    const radarSmooth = Math.round(getParamNumber("radarSmooth", 0)); // 0 = more raw/pixel, 1 = smoothed
    const radarSnow = Math.round(getParamNumber("radarSnow", 0)); // 0/1
    const debug = getParamBool("radarDebug", false);
    let tileLayer = null;
    let imageLayer = null; // used by thredds_cc
    let lastInitMs = 0;
    let initBeganAt = null;
    let lastSiteId = null;
    let stationsPromise = null;
    let currentProduct = normalizeProduct(radarProductParam);
    let lastTileLoadAt = null;
    let lastTileErrorAt = null;
    const statusListeners = [];

    function normalizeProduct(p) {
      const v = String(p || "").toLowerCase();
      if (v === "n0q" || v.includes("n0q")) return "n0q";
      if (v === "n0u" || v.includes("n0u")) return "n0u";
      if (v === "n0s" || v.includes("n0s") || v.includes("srv") || v.includes("storm")) return "n0s";
      if (v === "n0c" || v.includes("n0c") || v.includes("cc") || v.includes("rho") || v.includes("corr")) return "n0c";
      if (v.includes("vel") || v === "bvel") return "bvel";
      return "bref";
    }

    function sectorFromSite(siteId) {
      const s = String(siteId || "").toUpperCase();
      if (s.length === 4 && s.startsWith("K")) return s.slice(1);
      return s;
    }

    function ridgeProdFor(product) {
      const p = normalizeProduct(product);
      if (p === "n0u" || p === "bvel") return "N0U";
      if (p === "n0s") return "N0S";
      if (p === "n0c") return "N0C";
      // bref / n0q default
      return "N0Q";
    }

    function xdrFindDataOffset(buf) {
      const bytes = new Uint8Array(buf);
      // ASCII "Data:\n"
      const marker = [68, 97, 116, 97, 58, 10];
      for (let i = 0; i < bytes.length - marker.length; i++) {
        let ok = true;
        for (let j = 0; j < marker.length; j++) {
          if (bytes[i + j] !== marker[j]) {
            ok = false;
            break;
          }
        }
        if (ok) return i + marker.length;
      }
      return -1;
    }

    function xdrDecodeFloat32Array(buf) {
      const off = xdrFindDataOffset(buf);
      if (off < 0) throw new Error("XDR Data marker not found");
      const view = new DataView(buf, off);
      const n = view.getInt32(0, false);
      const n2 = view.getInt32(4, false);
      if (n <= 0 || n !== n2) throw new Error("Unexpected XDR float array header");
      const out = new Float32Array(n);
      let p = 8;
      for (let i = 0; i < n; i++) {
        out[i] = view.getFloat32(p, false);
        p += 4;
      }
      return out;
    }

    function xdrDecodeByteArray(buf) {
      const off = xdrFindDataOffset(buf);
      if (off < 0) throw new Error("XDR Data marker not found");
      const view = new DataView(buf, off);
      const n = view.getInt32(0, false);
      const n2 = view.getInt32(4, false);
      if (n <= 0 || n !== n2) throw new Error("Unexpected XDR byte array header");
      const rawStart = off + 8;
      const rawEnd = rawStart + n;
      return new Uint8Array(buf.slice(rawStart, rawEnd));
    }

    function ccColorForRho(rho) {
      // Discrete cool->warm ramp for rhoHV; emphasize 0.5–1.0.
      if (!Number.isFinite(rho) || rho <= 0) return null;
      if (rho < 0.5) return null;
      const t = Math.max(0, Math.min(1, (rho - 0.5) / 0.5));
      const stops = [
        [40, 0, 80],
        [0, 70, 140],
        [0, 160, 170],
        [0, 200, 80],
        [220, 220, 60],
        [255, 150, 30],
        [255, 70, 70],
        [255, 110, 200],
      ];
      const idx = Math.min(stops.length - 1, Math.max(0, Math.floor(t * stops.length)));
      const c = stops[idx];
      return [c[0], c[1], c[2], 190];
    }

    async function threddsGetLatestN0CUrlPath(sector3) {
      const url = `https://thredds.ucar.edu/thredds/radarServer/nexrad/level3/IDD?stn=${encodeURIComponent(sector3)}&var=N0C&time=present`;
      const fetchUrl = threddsProxyBase ? new URL(threddsProxyBase, window.location.href) : null;
      const res = await fetch(fetchUrl ? (fetchUrl.searchParams.set("url", url), fetchUrl.toString()) : url, { cache: "no-store" });
      if (!res.ok) throw new Error(`THREDDS radarServer failed: ${res.status}`);
      const xml = await res.text();
      const m = xml.match(/urlPath=\"([^\"]+\\.nids)\"/);
      if (!m) throw new Error("THREDDS urlPath not found");
      return m[1];
    }

    async function threddsFetchDods(path, ce) {
      const url = `https://thredds.ucar.edu/thredds/dodsC/nexrad/level3/IDD/${path}.dods?${ce}`;
      const fetchUrl = threddsProxyBase ? new URL(threddsProxyBase, window.location.href) : null;
      const res = await fetch(fetchUrl ? (fetchUrl.searchParams.set("url", url), fetchUrl.toString()) : url, { cache: "no-store" });
      if (!res.ok) throw new Error(`THREDDS dods failed: ${res.status}`);
      return await res.arrayBuffer();
    }

    async function threddsBuildCCImageOverlay(lat, lon) {
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
      const site = await pickNearestSite(lat, lon);
      if (!site) return;
      lastSiteId = site;
      const sector = sectorFromSite(site);

      const urlPath = await threddsGetLatestN0CUrlPath(sector);
      if (debug) console.log("[radar] provider:", currentProvider, "site:", lastSiteId, "sector:", sector, "urlPath:", urlPath);

      const [rawBuf, gateBuf, azBuf] = await Promise.all([
        threddsFetchDods(urlPath, "CorrelationCoefficient_RAW.CorrelationCoefficient_RAW"),
        threddsFetchDods(urlPath, "gate[0:1:1199]"),
        threddsFetchDods(urlPath, "azimuth[0:1:359]"),
      ]);

      const raw = xdrDecodeByteArray(rawBuf);
      const gate = xdrDecodeFloat32Array(gateBuf);
      const az = xdrDecodeFloat32Array(azBuf);
      const gateCount = gate.length || 1200;
      const azCount = az.length || 360;
      if (raw.length !== gateCount * azCount) throw new Error(`Unexpected CC raw size: ${raw.length}`);

      const gateStepM = gateCount > 1 ? (gate[1] - gate[0]) : 250;
      const maxRangeM = gate[gateCount - 1] || (gateStepM * (gateCount - 1));
      const maxRangeKm = maxRangeM / 1000;

      const dLat = maxRangeKm / 111.0;
      const dLon = maxRangeKm / (111.0 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
      const bounds = L.latLngBounds([lat - dLat, lon - dLon], [lat + dLat, lon + dLon]);

      const size = 512;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      const img = ctx.createImageData(size, size);
      const data = img.data;
      const cx = size / 2;
      const cy = size / 2;
      const rMax = Math.min(cx, cy) - 1;

      const azLut = new Int16Array(360);
      for (let d = 0; d < 360; d++) azLut[d] = d;
      for (let i = 0; i < azCount; i++) {
        const deg = Math.round(((az[i] % 360) + 360) % 360);
        azLut[deg] = i;
      }

      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const dx = x - cx;
          const dy = y - cy;
          const r = Math.sqrt(dx * dx + dy * dy);
          const idx = (y * size + x) * 4;

          if (r > rMax) {
            data[idx + 3] = 0;
            continue;
          }

          const ang = (Math.atan2(dx, -dy) * 180) / Math.PI;
          const deg = Math.round((ang + 360) % 360);
          const azIdx = azLut[deg] || 0;

          const rangeM = (r / rMax) * maxRangeM;
          const gateIdx = Math.max(0, Math.min(gateCount - 1, Math.floor(rangeM / gateStepM)));
          const v = raw[azIdx * gateCount + gateIdx];

          // Byte -> rho in [0,1]
          const rho = v / 255.0;
          const c = ccColorForRho(rho);
          if (!c) {
            data[idx + 3] = 0;
            continue;
          }
          data[idx + 0] = c[0];
          data[idx + 1] = c[1];
          data[idx + 2] = c[2];
          data[idx + 3] = c[3];
        }
      }

      ctx.putImageData(img, 0, 0);

      const url = canvas.toDataURL("image/png");
      if (!imageLayer) {
        imageLayer = L.imageOverlay(url, bounds, { opacity, zIndex: 350 }).addTo(map);
      } else {
        imageLayer.setUrl(url);
        imageLayer.setBounds(bounds);
        imageLayer.setOpacity(opacity);
      }

      const el = imageLayer.getElement && imageLayer.getElement();
      if (el) {
        el.style.imageRendering = "pixelated";
        el.style.imageRendering = "crisp-edges";
      }

      lastTileLoadAt = Date.now();
      emitStatus();
    }

    function haversineKm(lat1, lon1, lat2, lon2) {
      const R = 6371;
      const toRad = (d) => (d * Math.PI) / 180;
      const dLat = toRad(lat2 - lat1);
      const dLon = toRad(lon2 - lon1);
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return R * c;
    }

    function getStations() {
      if (stationsPromise) return stationsPromise;
      stationsPromise = fetch("https://api.weather.gov/radar/stations", {
        cache: "no-store",
        headers: { Accept: "application/geo+json" },
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          const features = (data && data.features) || [];
          return features
            .map((f) => {
              const props = f.properties || {};
              const geom = f.geometry || {};
              const coords = geom.coordinates || [];
              const lon = coords[0];
              const lat = coords[1];
              return {
                id: props.id,
                stationType: (props.stationType || "").toUpperCase(),
                lat,
                lon,
              };
            })
            .filter((s) => typeof s.id === "string" && s.id.length === 4 && Number.isFinite(s.lat) && Number.isFinite(s.lon));
        })
        .catch(() => []);
      return stationsPromise;
    }

    async function pickNearestSite(lat, lon) {
      if (radarSiteOverride && radarSiteOverride.length === 4) return radarSiteOverride;
      const stations = await getStations();
      const filtered = radarStationType ? stations.filter((s) => s.stationType === radarStationType) : stations;
      if (!filtered.length) return null;

      let best = null;
      let bestD = Infinity;
      for (const s of filtered) {
        const d = haversineKm(lat, lon, s.lat, s.lon);
        if (d < bestD) {
          bestD = d;
          best = s;
        }
      }
      return best ? best.id : null;
    }

    async function init(lat, lon) {
      const now = Date.now();
      if (now - lastInitMs < 60000) return;
      lastInitMs = now;
      initBeganAt = now;
      lastTileLoadAt = null;
      lastTileErrorAt = null;

      try {
        if (tileLayer) {
          map.removeLayer(tileLayer);
          tileLayer = null;
        }
        if (imageLayer) {
          map.removeLayer(imageLayer);
          imageLayer = null;
        }

        let tileUrl;
        if (currentProvider === "rainviewer") {
          // NOTE: RainViewer may return 403 in some browser contexts (hotlink/referrer protection).
          const res = await fetch("https://api.rainviewer.com/public/weather-maps.json", { cache: "no-store" });
          if (!res.ok) return;
          const data = await res.json();
          const host = data && data.host;
          const past = data && data.radar && data.radar.past;
          if (!host || !Array.isArray(past) || past.length < 1) return;

          const latest = past[past.length - 1];
          const path = latest && latest.path;
          if (!path) return;

          // RainViewer v2 tile format:
          //   {host}{path}/256/{z}/{x}/{y}/{color}/{smooth}_{snow}.png
          tileUrl = `${host}${path}/256/{z}/{x}/{y}/${radarColor}/${radarSmooth}_${radarSnow}.png`;
        } else if (currentProvider === "iem_mosaic") {
          // IEM NEXRAD base reflectivity mosaic (WebMercator / 900913)
          tileUrl = "https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/{z}/{x}/{y}.png";
        } else if (currentProvider === "thredds_cc") {
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
          await threddsBuildCCImageOverlay(lat, lon);
          return;
        } else if (currentProvider === "ridge_site") {
          // IEM RIDGE per-radar Level III imagery (tiled WMS).
          // Uses a 3-letter "sector" (e.g. KFTG -> FTG) and a Level III product code (e.g. N0S).
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
          const site = await pickNearestSite(lat, lon);
          if (!site) return;
          lastSiteId = site;
          const sector = sectorFromSite(site);
          const prod = ridgeProdFor(currentProduct);
          if (debug) console.log("[radar] provider:", currentProvider, "site:", lastSiteId, "sector:", sector, "prod:", prod);

          tileLayer = L.tileLayer.wms("https://mesonet.agron.iastate.edu/cgi-bin/wms/nexrad/ridge.cgi", {
            layers: "single",
            format: "image/png",
            transparent: true,
            opacity,
            zIndex: 350,
            styles: "",
            version: "1.1.1",
            sector,
            prod,
            updateWhenIdle: true,
            keepBuffer: 1,
          }).addTo(map);

          tileLayer.on("load", () => {
            lastTileLoadAt = Date.now();
            emitStatus();
          });
          tileLayer.on("tileerror", () => {
            lastTileErrorAt = Date.now();
            emitStatus();
          });

          const container = tileLayer.getContainer && tileLayer.getContainer();
          if (container) {
            container.style.imageRendering = "pixelated";
            container.style.imageRendering = "crisp-edges";
          }

          emitStatus();
          return;
        } else {
          // Single-site base reflectivity/velocity via NOAA OpenGeo GeoServer WMS (tiled).
          // Layer naming convention: {siteLower}:{siteLower}_sr_bref
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
          const site = await pickNearestSite(lat, lon);
          if (!site) return;
          lastSiteId = site;
          const s = site.toLowerCase();
          const opengeoProduct = normalizeProduct(currentProduct) === "bvel" ? "bvel" : "bref";
          const layerName = `${s}:${s}_sr_${opengeoProduct}`;
          if (debug) console.log("[radar] provider:", currentProvider, "site:", lastSiteId, "product:", opengeoProduct, "wmsLayer:", layerName);

          tileLayer = L.tileLayer.wms("https://opengeo.ncep.noaa.gov/geoserver/ows", {
            layers: layerName,
            format: "image/png",
            transparent: true,
            opacity,
            zIndex: 350,
            styles: "",
            updateWhenIdle: true,
            keepBuffer: 1,
          }).addTo(map);

          tileLayer.on("load", () => {
            lastTileLoadAt = Date.now();
            emitStatus();
          });

          const container = tileLayer.getContainer && tileLayer.getContainer();
          if (container) {
            container.style.imageRendering = "pixelated";
            container.style.imageRendering = "crisp-edges";
          }

          emitStatus();
          return;
        }

        if (debug) console.log("[radar] provider:", currentProvider, "site:", lastSiteId, "tileUrl:", tileUrl);

        tileLayer = L.tileLayer(tileUrl, {
          opacity,
          zIndex: 350,
          updateWhenIdle: true,
          keepBuffer: 1,
        }).addTo(map);

        tileLayer.on("load", () => {
          lastTileLoadAt = Date.now();
          emitStatus();
        });
        tileLayer.on("tileerror", () => {
          lastTileErrorAt = Date.now();
          emitStatus();
        });

        const container = tileLayer.getContainer && tileLayer.getContainer();
        if (container) {
          container.style.imageRendering = "pixelated";
          container.style.imageRendering = "crisp-edges";
        }

        emitStatus();
      } catch {
        lastTileErrorAt = Date.now();
        emitStatus();
        // ignore
      }
    }

    async function refresh(lat, lon) {
      // If we're in single-site mode, rebuild if the nearest site changes.
      if (currentProvider === "opengeo_site" || currentProvider === "ridge_site" || currentProvider === "thredds_cc") {
        const site = radarSiteOverride && radarSiteOverride.length === 4 ? radarSiteOverride : await pickNearestSite(lat, lon);
        if (site && site !== lastSiteId) {
          lastInitMs = 0; // force rebuild
        }
      }
      return init(lat, lon);
    }

    function setProvider(p) {
      const next = String(p || "").toLowerCase();
      const norm = next === "iem_site" ? "opengeo_site" : next;
      if (norm && norm !== currentProvider) {
        currentProvider = norm;
        lastInitMs = 0;
        emitStatus();
      }
    }

    function setProduct(p) {
      const next = normalizeProduct(p);
      if (next !== currentProduct) {
        currentProduct = next;
        lastInitMs = 0; // force rebuild next refresh
        emitStatus();
      }
    }

    function getStatus() {
      return {
        provider: currentProvider,
        product: currentProduct,
        initBeganAt,
        lastTileLoadAt,
        lastTileErrorAt,
        site: lastSiteId,
      };
    }

    function emitStatus() {
      const s = getStatus();
      for (const cb of statusListeners) {
        try { cb(s); } catch { /* ignore */ }
      }
    }

    function subscribeStatus(cb) {
      if (typeof cb !== "function") return () => {};
      statusListeners.push(cb);
      // Immediately send current status
      try { cb(getStatus()); } catch { /* ignore */ }
      return () => {
        const idx = statusListeners.indexOf(cb);
        if (idx >= 0) statusListeners.splice(idx, 1);
      };
    }

    return { init, refresh, setProvider, setProduct, getStatus, subscribeStatus };
  }

  window.OverlayMapOverlays = {
    addDarkBasemap,
    createHeadingMarker,
    createWarningsLayer,
    createRadarLayer,
  };
})();

