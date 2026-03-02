## Cloudflare Worker (Firebase replacement)

This is a simple pattern that works well for public overlays:

- **Public read** endpoint for the overlay device(s) (Yolobox, OBS browser sources, etc.)
- **Authenticated write** endpoint for your GPS updater script

### Endpoints

- `GET /location` -> latest JSON
- `PUT /location` -> update JSON (requires `Authorization: Bearer <WRITE_TOKEN>`)
- `GET /state` -> overlay state (public)
- `PUT /state` -> update overlay state (requires `Authorization: Bearer <WRITE_TOKEN>`)

### Setup (high level)

1. Create a Cloudflare Worker.
2. Create a KV namespace and bind it as `LOCATION_KV`.
3. Add a secret `WRITE_TOKEN`.
4. (Optional) Set `ALLOW_ORIGIN` to a specific origin, otherwise it defaults to `*`.
5. Deploy `cloudflare-worker.js`.

### Overlay URL usage

Point your overlay at the Worker read endpoint:

- `Normal.html?locationUrl=https://YOUR_WORKER_DOMAIN/location`

Same for `Fisting.html` and `We_Got_Fisted.html`.

### GPS updater usage

Run:

```bash
python update_gps_location.py \
  --push-url https://YOUR_WORKER_DOMAIN/location \
  --push-token YOUR_WRITE_TOKEN
```

### Switching radar product without changing the overlay URL (Yolobox friendly)

Set reflectivity:

```bash
curl -X PUT https://YOUR_WORKER_DOMAIN/state \
  -H "Authorization: Bearer YOUR_WRITE_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"radarProduct":"bref"}'
```

Set velocity:

```bash
curl -X PUT https://YOUR_WORKER_DOMAIN/state \
  -H "Authorization: Bearer YOUR_WRITE_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"radarProduct":"bvel"}'
```

