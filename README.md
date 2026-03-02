## stream_overlays

Web-based overlays for storm chase livestreams.

### What you probably care about

- **Main overlays**:
  - `Normal.html`
  - `Fisting.html`
  - `We_Got_Fisted.html`
- **Banner style comparison (topo test)**:
  - `Normal_Topo.html`
  - `Fisting_Topo.html`
  - `We_Got_Fisted_Topo.html`
- **Velocity variants (separate Yolobox URLs)**:
  - `Normal_Velocity.html`
  - `Normal_StormRelativeVelocity.html`
  - `Normal_CorrelationCoefficient.html`
  - `Fisting_Velocity.html`
  - `Fisting_StormRelativeVelocity.html`
  - `Fisting_CorrelationCoefficient.html`
- **Assets**:
  - `fisters_logo.png`
  - `impact.mp3`
- **Live GPS updater (USB GPS -> Firebase + optional local file)**:
  - `update_gps_location.py`
  - `location.json` (optional local fallback + sanity check)

### How location works

The overlays fetch JSON shaped like:

```json
{"lat": 0, "lon": 0, "location": "City, ST"}
```

By default, the production overlays pull from Firebase:
`https://tfoverlays-default-rtdb.firebaseio.com/location.json`

Recommended (more secure + not Firebase-specific): host a tiny write-authenticated endpoint
(example Cloudflare Worker included) and point overlays at it via `?locationUrl=...`.

You can override the location source per overlay with URL params:

- `?locationSource=firebase` (default)
- `?locationSource=local` (loads `location.json` from the same server)
- `?locationUrl=...` (explicit URL; overrides `locationSource`)

### Overlay toggles (URL params)

- `timeFormat=12h|24h` (default `12h`)
- `timeZone=America/Chicago` (optional; defaults to device local time)
- `radar=1|0` (default `1`)
- `radarOpacity=0..1` (default `0.6`)
- `radarProvider=iem_site|iem_mosaic|rainviewer` (default `iem_site`)
- `radarSite=KFTG` (optional; pins nearest-site radar)
- `radarProduct=bref|bvel` (default `bref`) — can also be controlled live via `state.json` / Worker `/state`
- `warnings=1|0` (default `1`)
- **Radar HUD/legend**:
  - The overlays now show `RADAR: REF/VEL · AGE ...` based on last successful tile load.
  - A circular legend ring is shown around the map edge and switches palette with the product.
- `labels=1|0` (default `1`) – render a labels-only layer above radar so city names pop
- `labelsOpacity=0..1` (default `0.95`)
- `labelsBrightness=0.5..3` (default `1.35`)
- `labelsContrast=0.5..3` (default `1.1`)

Example for local testing (when served via a local HTTP server):
`Normal.html?locationSource=local`

### Hosting on GitHub Pages (Yolobox-friendly public URLs)

Yes — once the files are committed + pushed, you can host them publicly via **GitHub Pages** and load them on the Yolobox by URL.

1. In GitHub, go to the repo **Settings → Pages**
2. Set **Build and deployment** to **Deploy from a branch**
3. Pick **Branch: `main`**, **Folder: `/ (root)`**
4. Save, wait ~1–2 minutes for the Pages site to come up

Your overlay URLs will then look like:

- `https://FSTD-Michael.github.io/stream_overlays/Normal.html`
- `https://FSTD-Michael.github.io/stream_overlays/Fisting.html`
- `https://FSTD-Michael.github.io/stream_overlays/We_Got_Fisted.html`

For the CC overlays (and to use the built-in THREDDS CORS proxy), make sure you pass your Worker as `locationUrl`:

- `.../Normal_CorrelationCoefficient.html?locationUrl=https://YOUR_WORKER_DOMAIN/location`

### Running the GPS updater

1. Create a venv and install deps:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

2. Run the updater (auto-detect port if possible):

```bash
python update_gps_location.py
```

Useful options:

- `--port /dev/tty.usbserial-XXXX`
- `--baud 4800`
- `--firebase-url https://.../location.json` (or `--no-firebase`)
- `--push-url https://your-domain.example/location` (recommended) + `--push-token ...`
- `--write-local location.json` (writes a local JSON file as well)
- `--no-geocode` (skips reverse geocoding; uses `"Unknown"` for `location`)

### Repo cleanup note

Non-production/experimental overlays have been moved into `archive/` for reference.

