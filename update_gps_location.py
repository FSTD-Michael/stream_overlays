import argparse
import json
import os
import time
from datetime import datetime, timezone
from math import atan2, cos, degrees, radians, sin
from typing import Optional

import pynmea2
import requests
import serial
from serial.tools import list_ports


DEFAULT_FIREBASE_URL = "https://tfoverlays-default-rtdb.firebaseio.com/location.json"


def pick_default_port() -> Optional[str]:
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


def push_to_endpoint(push_url: str, payload: dict, bearer_token: Optional[str], timeout_s: float = 5.0) -> None:
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

    prev_coords: Optional[tuple[float, float]] = None
    prev_location: Optional[str] = None
    geocode_cache: dict[tuple[float, float], str] = {}

    def bearing_deg(a_lat: float, a_lon: float, b_lat: float, b_lon: float) -> float:
        phi1 = radians(a_lat)
        phi2 = radians(b_lat)
        dlambda = radians(b_lon - a_lon)
        y = sin(dlambda) * cos(phi2)
        x = cos(phi1) * sin(phi2) - sin(phi1) * cos(phi2) * cos(dlambda)
        return (degrees(atan2(y, x)) + 360.0) % 360.0

    cycle_count = 0
    while True:
        try:
            cycle_count += 1
            print(f"[Cycle {cycle_count}] Opening serial port {port} at {args.baud} baud...")
            with serial.Serial(port, baudrate=args.baud, timeout=2) as ser:
                print(f"[Cycle {cycle_count}] Serial port opened. Waiting for GPS data...")
                start_time = time.time()
                lat: Optional[float] = None
                lon: Optional[float] = None
                heading: Optional[float] = None
                speed: Optional[float] = None  # Speed in knots
                last_status_time = start_time
                nmea_count = 0

                while time.time() - start_time < args.fix_timeout:
                    try:
                        line = ser.readline().decode("ascii", errors="replace").strip()
                    except Exception as e:
                        print(f"[Cycle {cycle_count}] Error reading from serial: {e}")
                        break
                    
                    if not line:
                        # Empty line - show we're still trying
                        if time.time() - last_status_time > 2:
                            print(f"[Cycle {cycle_count}] Waiting for GPS data... (no data received yet)")
                            last_status_time = time.time()
                        continue
                    
                    if not line.startswith("$"):
                        continue
                    
                    nmea_count += 1
                    # Show first few NMEA sentences to confirm data is coming
                    if nmea_count <= 3:
                        print(f"[Cycle {cycle_count}] Received NMEA: {line[:60]}...")

                    try:
                        msg = pynmea2.parse(line)
                    except Exception:
                        continue

                    st = getattr(msg, "sentence_type", "")
                    if st == "GGA":
                        gps_qual = getattr(msg, "gps_qual", 0)
                        if gps_qual not in [1, 2]:
                            if nmea_count <= 5:
                                print(f"  [GGA] GPS quality {gps_qual} (need 1 or 2), skipping...")
                            continue
                        try:
                            lat = round(msg.latitude, args.coord_precision)
                            lon = round(msg.longitude, args.coord_precision)
                            print(f"  [GGA] Got coordinates: {lat}, {lon} (quality: {gps_qual})")
                        except Exception as e:
                            if nmea_count <= 5:
                                print(f"  [GGA] Error extracting lat/lon: {e}")
                            continue
                    elif st == "RMC":
                        # Recommended Minimum Navigation Information
                        status = getattr(msg, "status", "")
                        if status != "A":
                            if nmea_count <= 5:
                                print(f"  [RMC] Status '{status}' (need 'A'), skipping...")
                            continue
                        try:
                            if getattr(msg, "latitude", None) and getattr(msg, "longitude", None):
                                lat = round(msg.latitude, args.coord_precision)
                                lon = round(msg.longitude, args.coord_precision)
                                print(f"  [RMC] Got coordinates: {lat}, {lon}")
                        except Exception as e:
                            if nmea_count <= 5:
                                print(f"  [RMC] Error extracting lat/lon: {e}")
                            continue
                        tc = getattr(msg, "true_course", None)
                        try:
                            if tc not in (None, ""):
                                heading = float(tc)
                        except Exception:
                            pass
                        # Extract speed over ground (in knots)
                        sog = getattr(msg, "spd_over_grnd", None)
                        try:
                            if sog not in (None, ""):
                                speed = float(sog)
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
                        # Extract ground speed (in knots)
                        gs = getattr(msg, "spd_over_grnd_kts", None) or getattr(msg, "spd_over_grnd", None)
                        try:
                            if gs not in (None, ""):
                                speed = float(gs)
                        except Exception:
                            pass

                    # Break once we have lat/lon (heading is optional)
                    if lat is not None and lon is not None:
                        print(f"[Cycle {cycle_count}] ✅ Got valid GPS fix: {lat}, {lon}")
                        break

                if lat is None or lon is None:
                    if nmea_count == 0:
                        print(f"[Cycle {cycle_count}] ⚠️  No NMEA data received from GPS! Check connection and baud rate.")
                    else:
                        print(f"[Cycle {cycle_count}] No valid GPS fix this cycle (received {nmea_count} NMEA sentences, waited {args.fix_timeout}s). Retrying in {args.interval}s...")
                    time.sleep(args.interval)
                    continue

                coords = (lat, lon)
                prev_coords_snapshot = prev_coords

                # Calculate heading if not provided and we have previous coords
                if heading is None and prev_coords_snapshot and coords != prev_coords_snapshot:
                    heading = round(bearing_deg(prev_coords_snapshot[0], prev_coords_snapshot[1], lat, lon), 1)

                # Get location (reverse geocode)
                if args.no_geocode:
                    location = prev_location or "Unknown"
                else:
                    # Cache by rounded coords to reduce geocode calls while stationary.
                    location = geocode_cache.get(coords) or prev_location
                    if not location or coords != prev_coords:
                        print(f"[Cycle {cycle_count}] Reverse geocoding {lat}, {lon}...")
                        location = reverse_geocode(lat, lon)
                        geocode_cache[coords] = location
                        prev_location = location

                updated_at = datetime.now(timezone.utc).isoformat()
                payload = {"lat": lat, "lon": lon, "location": location, "updatedAt": updated_at}
                if heading is not None and isinstance(heading, float):
                    payload["heading"] = heading
                if speed is not None and isinstance(speed, float):
                    payload["speed"] = round(speed, 1)  # Speed in knots

                if write_local_path:
                    atomic_write_json(write_local_path, payload)
                    print(f"[Cycle {cycle_count}] ✅ Wrote local JSON: {write_local_path} -> {location} ({lat}, {lon})")

                if not args.no_firebase:
                    # If a generic push endpoint is configured, prefer it and skip Firebase.
                    if args.push_url:
                        push_to_endpoint(args.push_url, payload, args.push_token)
                    else:
                        push_to_firebase(args.firebase_url, payload)

                prev_coords = coords
                print(f"[Cycle {cycle_count}] Waiting {args.interval}s before next cycle...")
            time.sleep(args.interval)
        except serial.SerialException as e:
            print(f"⚠️  Serial port error: {e}")
            print(f"   Retrying in {args.interval}s...")
            time.sleep(args.interval)
        except Exception as e:
            print(f"⚠️  Unexpected error: {e}")
            import traceback
            traceback.print_exc()
            time.sleep(args.interval)


if __name__ == "__main__":
    raise SystemExit(main())
