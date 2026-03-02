import argparse
import json
import os
import time
from datetime import datetime, timezone
from math import atan2, cos, degrees, radians, sin

import pynmea2
import requests
import serial
from serial.tools import list_ports


DEFAULT_FIREBASE_URL = "https://tfoverlays-default-rtdb.firebaseio.com/location.json"


def pick_default_port() -> str | None:
    """Try to pick a reasonable default serial port (macOS-friendly)."""
    ports = list(list_ports.comports())
    if not ports:
        return None

    # Prefer common macOS USB serial device names.
    preferred = []
    for p in ports:
        dev = getattr(p, "device", "") or ""
        if "usbserial" in dev or "usbmodem" in dev:
            preferred.append(dev)
    if preferred:
        return preferred[0]

    return getattr(ports[0], "device", None)


def reverse_geocode(lat: float, lon: float, timeout_s: float = 5.0) -> str:
    url = "https://nominatim.openstreetmap.org/reverse"
    params = {
        "format": "json",
        "lat": lat,
        "lon": lon,
        "zoom": 10,
        "addressdetails": 1,
    }
    headers = {"User-Agent": "TwisterFistersOverlay/1.0"}

    try:
        response = requests.get(url, params=params, headers=headers, timeout=timeout_s)
        response.raise_for_status()
        data = response.json()
        address = data.get("address") or {}
        city = (
            address.get("city")
            or address.get("town")
            or address.get("village")
            or address.get("county")
            or "Unknown"
        )
        state = address.get("state") or ""
        return f"{city}, {state}".strip(", ")
    except Exception as e:
        print("Reverse geocode error:", e)
        return "Unknown"


def atomic_write_json(path: str, payload: dict) -> None:
    tmp_path = f"{path}.tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(payload, f)
    os.replace(tmp_path, path)


def push_to_firebase(firebase_url: str, payload: dict, timeout_s: float = 5.0) -> None:
    try:
        response = requests.put(firebase_url, json=payload, timeout=timeout_s)
        if response.status_code == 200:
            print(f"Pushed to Firebase: {payload['lat']}, {payload['lon']} - {payload['location']}")
        else:
            print(f"Failed to push: {response.status_code} - {response.text}")
    except Exception as e:
        print("Firebase push error:", e)


def push_to_endpoint(push_url: str, payload: dict, bearer_token: str | None, timeout_s: float = 5.0) -> None:
    headers = {}
    if bearer_token:
        headers["Authorization"] = f"Bearer {bearer_token}"

    try:
        response = requests.put(push_url, json=payload, headers=headers, timeout=timeout_s)
        if response.status_code in (200, 201, 204):
            print(f"Pushed to endpoint: {payload['lat']}, {payload['lon']} - {payload['location']}")
        else:
            print(f"Endpoint push failed: {response.status_code} - {response.text}")
    except Exception as e:
        print("Endpoint push error:", e)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="USB GPS -> location JSON (Firebase + optional local file).")
    parser.add_argument("--port", default=os.environ.get("GPS_PORT"), help="Serial port device path.")
    parser.add_argument("--baud", type=int, default=int(os.environ.get("GPS_BAUD", "4800")), help="Serial baud rate.")
    parser.add_argument("--interval", type=int, default=10, help="Seconds between update cycles.")
    parser.add_argument("--fix-timeout", type=int, default=5, help="Seconds to wait for a valid GPS fix per cycle.")
    parser.add_argument("--coord-precision", type=int, default=5, help="Decimal precision for lat/lon comparison/output.")

    parser.add_argument(
        "--firebase-url",
        default=os.environ.get("FIREBASE_URL", DEFAULT_FIREBASE_URL),
        help="Firebase RTDB endpoint for location JSON.",
    )
    parser.add_argument("--no-firebase", action="store_true", help="Disable pushing to Firebase.")

    parser.add_argument(
        "--push-url",
        default=os.environ.get("PUSH_URL"),
        help="Preferred: push latest location to a generic endpoint (e.g. Cloudflare Worker) via HTTP PUT.",
    )
    parser.add_argument(
        "--push-token",
        default=os.environ.get("PUSH_TOKEN"),
        help="Bearer token for --push-url (sent as Authorization: Bearer ...).",
    )

    local_group = parser.add_mutually_exclusive_group()
    local_group.add_argument(
        "--write-local",
        default=os.environ.get("WRITE_LOCAL_JSON", "location.json"),
        help="Path to also write a local location.json (served alongside overlays).",
    )
    local_group.add_argument("--no-local", action="store_true", help="Disable writing a local JSON file.")

    parser.add_argument("--no-geocode", action="store_true", help="Skip reverse geocoding (location becomes 'Unknown').")
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    port = args.port or pick_default_port()
    if not port:
        print("No serial ports found. Plug in the GPS and/or pass --port.")
        return 2

    print(f"Using port={port} baud={args.baud}")
    if args.push_url:
        print(f"Push URL: {args.push_url}")
    elif not args.no_firebase:
        print(f"Firebase URL: {args.firebase_url}")
    write_local_path = None if getattr(args, "no_local", False) else args.write_local
    if write_local_path:
        print(f"Will also write local JSON: {write_local_path}")

    prev_coords: tuple[float, float] | None = None
    prev_location: str | None = None
    geocode_cache: dict[tuple[float, float], str] = {}

    def bearing_deg(a_lat: float, a_lon: float, b_lat: float, b_lon: float) -> float:
        phi1 = radians(a_lat)
        phi2 = radians(b_lat)
        dlambda = radians(b_lon - a_lon)
        y = sin(dlambda) * cos(phi2)
        x = cos(phi1) * sin(phi2) - sin(phi1) * cos(phi2) * cos(dlambda)
        return (degrees(atan2(y, x)) + 360.0) % 360.0

    while True:
        try:
            with serial.Serial(port, baudrate=args.baud, timeout=1) as ser:
                start_time = time.time()
                lat: float | None = None
                lon: float | None = None
                heading: float | None = None

                while time.time() - start_time < args.fix_timeout:
                    line = ser.readline().decode("ascii", errors="replace")
                    if not line.startswith("$"):
                        continue

                    try:
                        msg = pynmea2.parse(line)
                    except Exception:
                        continue

                    st = getattr(msg, "sentence_type", "")
                    if st == "GGA":
                        if getattr(msg, "gps_qual", 0) not in [1, 2]:
                            continue
                        lat = round(msg.latitude, args.coord_precision)
                        lon = round(msg.longitude, args.coord_precision)
                    elif st == "RMC":
                        # Recommended Minimum Navigation Information
                        if getattr(msg, "status", "") != "A":
                            continue
                        if getattr(msg, "latitude", None) and getattr(msg, "longitude", None):
                            lat = round(msg.latitude, args.coord_precision)
                            lon = round(msg.longitude, args.coord_precision)
                        tc = getattr(msg, "true_course", None)
                        try:
                            if tc not in (None, ""):
                                heading = float(tc)
                        except Exception:
                            pass
                    elif st == "VTG":
                        # Track Made Good and Ground Speed
                        tc = getattr(msg, "true_track", None) or getattr(msg, "true_course", None)
                        try:
                            if tc not in (None, ""):
                                heading = float(tc)
                        except Exception:
                            pass

                    if lat is not None and lon is not None and heading is not None:
                        break

                if lat is None or lon is None:
                    print("No valid GPS fix this cycle.")
                    time.sleep(args.interval)
                    continue

                coords = (lat, lon)
                prev_coords_snapshot = prev_coords

                if heading is None and prev_coords_snapshot and coords != prev_coords_snapshot:
                    heading = round(bearing_deg(prev_coords_snapshot[0], prev_coords_snapshot[1], lat, lon), 1)

                    if args.no_geocode:
                        location = prev_location or "Unknown"
                    else:
                        # Cache by rounded coords to reduce geocode calls while stationary.
                        location = geocode_cache.get(coords) or prev_location
                        if not location or coords != prev_coords:
                            location = reverse_geocode(lat, lon)
                            geocode_cache[coords] = location
                            prev_location = location

                    updated_at = datetime.now(timezone.utc).isoformat()
                    payload = {"lat": lat, "lon": lon, "location": location, "updatedAt": updated_at}
                    if heading is not None and isinstance(heading, float):
                        payload["heading"] = heading

                    if write_local_path:
                        atomic_write_json(write_local_path, payload)
                        print(f"Wrote local JSON: {write_local_path} -> {location} ({lat}, {lon})")

                    if not args.no_firebase:
                        # If a generic push endpoint is configured, prefer it and skip Firebase.
                        if args.push_url:
                            push_to_endpoint(args.push_url, payload, args.push_token)
                        else:
                            push_to_firebase(args.firebase_url, payload)

                    prev_coords = coords
            time.sleep(args.interval)
        except Exception as e:
            print("Error:", e)
            time.sleep(args.interval)


if __name__ == "__main__":
    raise SystemExit(main())
